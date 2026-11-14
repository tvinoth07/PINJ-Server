/**
 * DmiPanel.jsx — LP-OCIP (DMI) for the 📡 LIVE page.
 *
 * Spec: RDSO/SPN/196/2020 Annexure-B (LP-OCIP Display Requirement, Amdt-3) — layout,
 *       regions A … M, colours (Table B.2), scales and message lists.
 * Data: decoded radio packets (Annexure-C) from the LIVE feed:
 *         • C.4.3 Loco → Station Regular / C.4.6 Access Request   → loco side
 *           (speed, location, train length, mode, direction, tag, brake, emergency)
 *         • C.4.2 Station → Loco Regular, DEST_LOCO_ID = loco (or 0) → track side
 *           (MA, signal aspect / type / distance, SSP, TSR, turnouts, LC gates,
 *            track conditions, tag linking, SoS)
 *         • C.4.5 Additional Emergency                               → station SoS
 *
 * buildDmi() is a pure function: packets in, everything the screen shows out —
 * each value with the packet it came from, so the display can always be traced.
 */
import { useState, useEffect, useMemo, useRef, useId, Fragment } from "react";
import { tagTableStore, appSettingsStore, useStore } from "./SettingsAbout";

/* ═══════════════════════════════════════════════════════════════
   SPEC CONSTANTS (Annexure-B)
═══════════════════════════════════════════════════════════════ */
export const DMI_COL = {          // Table B.2
  WHT: "#FFFFFF", BLK: "#000000", LGY: "#808080", MGY: "#969696", GRY: "#C0C0C0",
  LBL: "#008BCE", YLW: "#DFDF00", LOR: "#FFA500", ORG: "#FF8040", BRD: "#FF0000",
  LGR: "#80FF00", GRN: "#00FF00", DGR: "#008000",
};
const FONT = "Helvetica, Arial, 'Microsoft Sans Serif', sans-serif";

export const MODES = {                    // LOCO_MODE (Annexure-C) → Annexure-B symbol + full text
  1:  { key: "SB", text: "Stand By Mode" },
  2:  { key: "SR", text: "Staff Responsible Mode" },
  3:  { key: "LS", text: "Limited Supervision Mode" },
  4:  { key: "FS", text: "Full Supervision Mode" },
  5:  { key: "OV", text: "Override Mode" },
  6:  { key: "OS", text: "On Sight Mode" },
  7:  { key: "TR", text: "Trip Mode" },
  8:  { key: "PT", text: "Post Trip Mode" },
  9:  { key: "RV", text: "Reverse Mode" },
  10: { key: "SH", text: "Shunt Mode" },
  11: { key: "NL", text: "Non Leading Mode" },
  12: { key: "SF", text: "System Failure" },
  13: { key: "IS", text: "Isolation Mode" },
};

/* D3 — line (a8…a5) and signal type (a14…a9) abbreviations, Annexure-B §B4.6.4.3 */
export const LINE_ABBR = {
  0b0000: "UP", 0b0001: "DN", 0b0010: "UP FAST", 0b0011: "DN FAST", 0b1000: "UP SLOW", 0b1001: "DN SLOW",
  0b1010: "UP MAIN", 0b1011: "DN MAIN", 0b1100: "UP SUB", 0b1101: "DN SUB", 0b1110: "UP BI-DIR", 0b1111: "DN BI-DIR",
};
export const SIG_ABBR = {
  0b010000: "Dist", 0b010001: "Inr-Dist", 0b010010: "Gate-Dist", 0b010011: "Gate-Inr-Dist",
  0b010100: "IB-Dist", 0b010101: "IB-Inr-Dist", 0b010110: "Auto", 0b010111: "Semi-Auto",
  0b011000: "Home", 0b011001: "Home L-X", 0b011010: "R-Home", 0b011011: "R-Home L-X",
  0b011100: "M/L-Str L-X", 0b011101: "L/L-Str L-X", 0b011110: "Int-Str",
  0b000001: "Adv-Str", 0b000010: "IB-Stop", 0b000011: "Gate-Stop", 0b000100: "Calling-On",
  0b000101: "Adv-Str-cum-Gate", 0b000110: "Gate-cum-Dist", 0b000111: "Adv-Str-cum-Dist",
  0b100011: "Auto-Gate", 0b100100: "Semi-Auto", 0b100101: "Adv-Str-cum-G-ID", 0b100110: "Gate-cum-ID",
  0b100111: "Gate-ID-cum-Dist", 0b101000: "IB-cum-Gate-Dist", 0b101001: "IB-cum-Gate-ID", 0b101010: "IB-cum-Dist",
  0b101011: "Adv-Str-cum-IB-Dist", 0b101100: "Str-cum-IB-Dist", 0b101101: "Stop Board",
  0b101110: "Gate-cum-IB-Dist", 0b101111: "Gate-cum-IB-ID", 0b110000: "Adv-Str-cum-G-Dist",
};
/* small white marker circle in D1: C / IB / G / A / AG (one at a time) */
function sigMarker(type, aspect) {
  if (aspect === 15 || type === 0b000100) return "C";
  if (type === 0b100011 || aspect === 14) return "AG";
  if ([0b010110, 0b010111, 0b100100].includes(type)) return "A";
  if ([0b000010, 0b010100, 0b010101, 0b101000, 0b101001, 0b101010, 0b101011, 0b101100, 0b101110, 0b101111].includes(type)) return "IB";
  if ([0b000011, 0b010010, 0b010011, 0b000101, 0b000110, 0b100101, 0b100110, 0b100111, 0b110000].includes(type)) return "G";
  return null;
}
/* CUR_SIG_ASPECT → the 4 lamps (top→bottom: YLW, GRN, YLW, BRD) */
/* Annexure-C (Amdt-10) CUR_SIG_ASPECT: 3–8 = Yellow with Pos1…Pos6 junction-type route indication,
   24 = Stop Board / Buffer Stop, 32–63 = Yellow with Stencil route 1…32 (route = code − 31) — same yellow
   lamp as code 2. 9 = stencil without a route number (Amdt-9; Spare in Amdt-10), kept for older stations. */
export const STENCIL_MIN = 32, STENCIL_MAX = 63;
export const stencilNo = a => (a >= STENCIL_MIN && a <= STENCIL_MAX ? a - STENCIL_MIN + 1 : null);
const ASPECT_LAMPS = {
  1: [0, 0, 0, 1], 2: [0, 0, 1, 0], 3: [0, 0, 1, 0], 4: [0, 0, 1, 0], 5: [0, 0, 1, 0], 6: [0, 0, 1, 0], 7: [0, 0, 1, 0],
  8: [0, 0, 1, 0], 9: [0, 0, 1, 0], 10: [1, 0, 1, 0], 11: [0, 1, 0, 0],
  14: [0, 0, 0, 1], 15: [0, 0, 0, 1], 24: [0, 0, 0, 1],
};
for (let a = STENCIL_MIN; a <= STENCIL_MAX; a++) ASPECT_LAMPS[a] = [0, 0, 1, 0];
export const ASPECT_NAME = { 1: "Red", 2: "Yellow", 3: "Yellow + Route 1", 4: "Yellow + Route 2", 5: "Yellow + Route 3", 6: "Yellow + Route 4",
  7: "Yellow + Route 5", 8: "Yellow + Route 6", 9: "Yellow + Stencil (no route no.)", 10: "Double Yellow", 11: "Green", 14: "AG Marker OFF",
  15: "Red + Calling-On", 24: "Stop Board" };
export const aspectName = a => ASPECT_NAME[a] || (stencilNo(a) ? `Yellow + Stencil Route ${stencilNo(a)}` : null);
/* stencil route number as LCD 7-segment digits: lit segments + faint unlit ones, slightly slanted.
   Segments a (top) b (top right) c (bottom right) d (bottom) e (bottom left) f (top left) g (middle). */
const SEG_ON = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
function segPolys(x, y, w, h, t) {
  const ht = t / 2, g = t * 0.3, m = y + h / 2, L = x + ht, R = x + w - ht, T = y + ht, B = y + h - ht;
  const H = (x1, x2, yy) => `${x1},${yy} ${x1 + ht},${yy - ht} ${x2 - ht},${yy - ht} ${x2},${yy} ${x2 - ht},${yy + ht} ${x1 + ht},${yy + ht}`;
  const V = (xx, y1, y2) => `${xx},${y1} ${xx + ht},${y1 + ht} ${xx + ht},${y2 - ht} ${xx},${y2} ${xx - ht},${y2 - ht} ${xx - ht},${y1 + ht}`;
  return [["a", H(L + g, R - g, T)], ["b", V(R, T + g, m - g)], ["c", V(R, m + g, B - g)], ["d", H(L + g, R - g, B)],
    ["e", V(L, m + g, B - g)], ["f", V(L, T + g, m - g)], ["g", H(L + g, R - g, m)]];
}
function LcdDigits({ value, cx, cy, h, color, off }) {
  const s = String(value), w = h * 0.56, t = h * 0.14, gap = h * 0.2;
  const x0 = cx - (s.length * w + (s.length - 1) * gap) / 2, y0 = cy - h / 2;
  return (
    <g transform={`translate(${cx} ${cy}) skewX(-7) translate(${-cx} ${-cy})`}>
      {[...s].map((ch, i) => segPolys(x0 + i * (w + gap), y0, w, h, t).map(([k, pts]) => {
        const lit = (SEG_ON[ch] || "").includes(k);
        return <polygon key={i + k} points={pts} fill={lit ? color : off} style={lit ? { filter: `drop-shadow(0 0 1.5px ${color})` } : undefined} />;
      }))}
    </g>
  );
}
/* junction-type route indication: position 1…6 (aspect 3…8), "stencil" (aspect 9, 32…63) */
const routeOf = a => (a >= 3 && a <= 8 ? a - 2 : a === 9 || stencilNo(a) ? "stencil" : null);
/* Annexure-B Table B.4 route symbols: [X, Y] of the image's top-left (screen units) and the
   white shape of route1.bmp … route6.bmp (49 × 44; routes 3 and 6: 44 × 49), traced pixel by
   pixel from the images in the Annexure — so size, shape and position are exactly the spec's. */
const ROUTE_SYM = {
  1: [587, 24, "M10 4h5v1h-5zM9 5h7v1h-7zM8 6h10v1h-10zM7 7h12v1h-12zM7 8h13v1h-13zM7 9h14v1h-14zM7 10h15v1h-15zM7 11h16v1h-16zM8 12h15v1h-15zM8 13h16v1h-16zM9 14h16v1h-16zM10 15h16v1h-16zM11 16h16v1h-16zM12 17h16v1h-16zM14 18h15v1h-15zM15 19h15v1h-15zM16 20h15v1h-15zM17 21h14v1h-14zM18 22h14v1h-14zM19 23h14v1h-14zM20 24h14v1h-14zM21 25h14v1h-14zM22 26h14v1h-14zM23 27h14v1h-14zM24 28h14v1h-14zM25 29h14v1h-14zM27 30h13v1h-13zM27 31h14v1h-14zM29 32h12v1h-12zM30 33h12v1h-12zM31 34h11v1h-11zM32 35h10v1h-10zM33 36h9v1h-9zM34 37h8v1h-8zM38 38h4v1h-4zM41 39h1v1h-1z"],
  2: [580, 59, "M7 16h11v1h-11zM4 17h33v1h-33zM3 18h41v1h-41zM2 19h44v1h-44zM2 20h45v1h-45zM1 21h48v1h-48zM1 22h48v1h-48zM1 23h47v1h-47zM2 24h44v1h-44zM2 25h42v1h-42zM3 26h40v1h-40zM5 27h20v1h-20z"],
  3: [585, 85, "M33 7h7v1h-7zM31 8h8v1h-8zM30 9h9v1h-9zM29 10h10v1h-10zM28 11h10v1h-10zM27 12h11v1h-11zM26 13h12v1h-12zM25 14h13v1h-13zM24 15h13v1h-13zM23 16h13v1h-13zM22 17h13v1h-13zM20 18h14v1h-14zM19 19h14v1h-14zM18 20h14v1h-14zM17 21h15v1h-15zM16 22h14v1h-14zM15 23h15v1h-15zM14 24h15v1h-15zM13 25h15v1h-15zM11 26h16v1h-16zM10 27h16v1h-16zM9 28h16v1h-16zM8 29h16v1h-16zM7 30h16v1h-16zM6 31h16v1h-16zM6 32h15v1h-15zM5 33h15v1h-15zM4 34h15v1h-15zM4 35h14v1h-14zM4 36h14v1h-14zM4 37h13v1h-13zM4 38h12v1h-12zM5 39h10v1h-10zM6 40h8v1h-8zM7 41h5v1h-5z"],
  4: [706, 24, "M34 4h5v1h-5zM33 5h7v1h-7zM31 6h10v1h-10zM30 7h12v1h-12zM29 8h13v1h-13zM28 9h14v1h-14zM27 10h15v1h-15zM26 11h16v1h-16zM26 12h15v1h-15zM25 13h16v1h-16zM24 14h16v1h-16zM23 15h16v1h-16zM22 16h16v1h-16zM21 17h16v1h-16zM20 18h15v1h-15zM19 19h15v1h-15zM18 20h15v1h-15zM18 21h14v1h-14zM17 22h14v1h-14zM16 23h14v1h-14zM15 24h14v1h-14zM14 25h14v1h-14zM13 26h14v1h-14zM12 27h14v1h-14zM11 28h14v1h-14zM10 29h14v1h-14zM9 30h13v1h-13zM8 31h14v1h-14zM8 32h12v1h-12zM7 33h12v1h-12zM7 34h11v1h-11zM7 35h10v1h-10zM7 36h9v1h-9zM7 37h8v1h-8zM7 38h4v1h-4zM7 39h1v1h-1z"],
  5: [715, 59, "M31 16h11v1h-11zM12 17h33v1h-33zM5 18h41v1h-41zM3 19h44v1h-44zM2 20h45v1h-45zM0 21h48v1h-48zM0 22h48v1h-48zM1 23h47v1h-47zM3 24h44v1h-44zM5 25h42v1h-42zM6 26h40v1h-40zM24 27h20v1h-20z"],
  6: [710, 85, "M4 7h7v1h-7zM5 8h8v1h-8zM5 9h9v1h-9zM5 10h10v1h-10zM6 11h10v1h-10zM6 12h11v1h-11zM6 13h12v1h-12zM6 14h13v1h-13zM7 15h13v1h-13zM8 16h13v1h-13zM9 17h13v1h-13zM10 18h14v1h-14zM11 19h14v1h-14zM12 20h14v1h-14zM12 21h15v1h-15zM14 22h14v1h-14zM14 23h15v1h-15zM15 24h15v1h-15zM16 25h15v1h-15zM17 26h16v1h-16zM18 27h16v1h-16zM19 28h16v1h-16zM20 29h16v1h-16zM21 30h16v1h-16zM22 31h16v1h-16zM23 32h15v1h-15zM24 33h15v1h-15zM25 34h15v1h-15zM26 35h14v1h-14zM26 36h14v1h-14zM27 37h13v1h-13zM28 38h12v1h-12zM29 39h10v1h-10zM30 40h8v1h-8zM32 41h5v1h-5z"],
};
/* Signal head (Annexure-B B4.6.4.2 dimensions): 70 wide × 220 high with 45° corners, four lamps of
   44 units, 12 units from the top and 8 units apart — centred between the Table B.4 route symbols. */
const SIG_X = 636, SIG_Y = 70, SIG_W = 70, SIG_H = 220, SIG_CX = SIG_X + SIG_W / 2, SIG_C = 12;

const EMRG_SELF = { 1: "Stopped in Block section", 2: "Manual", 6: "Train Parted" };
const BRAKE_TXT = { 1: "Over speed", 2: "Normal Service Brake", 3: "Full Service Brake", 4: "Emergency Brake" };

/* ═══════════════════════════════════════════════════════════════
   PACKET HELPERS
═══════════════════════════════════════════════════════════════ */
const num = v => (v === "" || v == null || v === "NA" || v === "-") ? null : (Number.isFinite(+v) ? +v : null);
function fieldMap(pkt) {
  const m = {};
  for (const f of pkt?.fields || []) {
    if (f._is_section) continue;
    const k = String(f.Field || "").trim();
    if (k && !(k in m)) m[k] = num(f["Decimal Value"]);
  }
  return m;
}
/* "LM_Static_Speed_Distance[3]" → list[2] … */
function indexed(m, name) {
  const out = [];
  for (let i = 1; i <= 64; i++) {
    const k = `${name}[${i}]`;
    if (!(k in m)) break;
    out.push(m[k]);
  }
  return out;
}
const speedCode = v => (v == null ? null : v >= 1 && v <= 50 ? v * 5 : v === 62 ? 8 : null);
const turnoutCode = v => (v == null ? null : v >= 1 && v <= 18 ? v * 5 : v === 31 ? null : null);
const tMs = p => (p?.received_at ? p.received_at * 1000 : p?._rxMs || 0);
const ptype = p => Number(p?.packet_type_value);
const pad = (n, w) => String(Math.max(0, Math.round(n))).padStart(w, "0");
const pktRef = (p, label) => p ? `${label} #${p.packet_index ?? "?"} · ${(p.received_at_iso || "").slice(-8) || "—"}${p.source ? " · " + p.source : ""}` : "—";

/* ═══════════════════════════════════════════════════════════════
   DETERMINISM — same packets in, same DMI out (capture → replay)
═══════════════════════════════════════════════════════════════ */
const ABS_NA = 8388607;
const TAG_MISS_M = 100;            // an expected tag not reported this far past its location = missed

/**
 * ABS_LOCO_LOC plausibility filter for one loco (packets in arrival order).
 * A reading further from the last good one than the loco could have run since
 * (speed × FRAME_NUM gap × 1.5 + 60 m) is a glitch and is dropped — e.g. one C.4.6
 * reporting 137626 m between 136844 and 136893. A real relocation is accepted
 * after 2 readings that agree with each other.
 * @returns push(fieldMap) → filtered ABS, or null when the reading is rejected / absent
 */
export function createAbsFilter() {
  let good = null, gF = null, cand = [];
  return m => {
    const a = m.ABS_LOCO_LOC != null && m.ABS_LOCO_LOC !== ABS_NA ? m.ABS_LOCO_LOC : null;
    if (a == null) return null;
    const accept = () => { good = a; gF = m.FRAME_NUM ?? gF; cand = []; return a; };
    if (good == null) return accept();
    const dF = m.FRAME_NUM != null && gF != null && m.FRAME_NUM > gF ? Math.min(m.FRAME_NUM - gF, 600) : 1;
    const v = Math.max(m.TRAIN_SPEED != null && m.TRAIN_SPEED <= 400 ? m.TRAIN_SPEED : 0, 10);
    const lim = v / 3.6 * Math.max(dF, 1) * 1.5 + 60;
    if (Math.abs(a - good) <= lim) return accept();
    cand.push(a);
    if (cand.length >= 2 && Math.abs(cand[cand.length - 1] - cand[cand.length - 2]) <= lim) return accept();
    return null;
  };
}
/** filtered ABS for a list of loco field maps (one loco, arrival order) */
export function filterLocoAbs(maps) {
  const f = createAbsFilter();
  return maps.map(m => f(m));
}

const PROFILE_KEYS = ["LM_Static_Speed_Distance[1]", "DIST_NXT_RFID[1]", "TSR_Distance[1]", "DIFF_DIST_TO[1]", "LM_LC_Distance[1]", "TRACKCOND_TYPE[1]"];
/**
 * Keeps what the DMI needs from the whole session, independent of the LIVE list size:
 *  • annotates every loco packet with its filtered ABS (_absF), computed once, in arrival order;
 *  • retains the key packets — C.4.2 carrying the track profile / tag list, the loco packets
 *    where LAST_RFID_TAG changed (+ the next 3), the latest C.4.5 — so trimming the LIVE
 *    buffer never changes the DMI, the tag status or the visualiser.
 */
export function createDmiKeeper() {
  let filters, absOf, kept, lastTag, fill, seq;
  const reset = () => { filters = new Map(); absOf = new Map(); kept = new Map(); lastTag = new Map(); fill = new Map(); seq = 0; };
  reset();
  const prune = (cat, max) => {
    const ks = [...kept.entries()].filter(([, v]) => v.cat === cat).map(([k]) => k);
    for (let i = 0; i < ks.length - max; i++) kept.delete(ks[i]);
  };
  return {
    reset,
    /** @returns true when the retained set changed */
    ingest(p) {
      const t = ptype(p);
      if (t !== 9 && t !== 10 && t !== 12 && t !== 13) return false;
      const m = fieldMap(p);
      const key = p.packet_index ?? "s" + seq++;
      if (t === 10 || t === 13) {
        const id = m.SOURCE_LOCO_ID;
        if (!(id > 0)) return false;
        if (absOf.has(key)) { p._absF = absOf.get(key); return false; }       // re-sent (history) — same answer
        if (!filters.has(id)) filters.set(id, createAbsFilter());
        p._absF = filters.get(id)(m);
        absOf.set(key, p._absF);
        if (absOf.size > 50000) absOf.delete(absOf.keys().next().value);
        const tag = m.LAST_RFID_TAG;
        let keep = false;
        if (tag > 0 && lastTag.get(id) !== tag) { lastTag.set(id, tag); fill.set(id, 3); keep = true; }
        else if (fill.get(id) > 0) { fill.set(id, fill.get(id) - 1); keep = true; }
        if (!keep) return false;
        kept.set(key, { p, cat: "loco" + id }); prune("loco" + id, 400);
        return true;
      }
      if (t === 9 && PROFILE_KEYS.some(k => k in m)) { kept.set(key, { p, cat: "prof" }); prune("prof", 12); return true; }
      if (t === 12 && m.GEN_SOS_CALL === 1) { kept.set(key, { p, cat: "c45" }); prune("c45", 1); return true; }
      return false;
    },
    packets: () => [...kept.values()].map(v => v.p),
  };
}
/** LIVE list + retained key packets, in packet order (only up to the newest packet shown) */
export function mergeKept(livePackets, kept) {
  if (!kept.length || !livePackets.length) return livePackets;
  let maxIdx = -Infinity; const have = new Set();
  for (const p of livePackets) { have.add(p.packet_index); if (p.packet_index > maxIdx) maxIdx = p.packet_index; }
  const extra = kept.filter(p => p.packet_index != null && p.packet_index <= maxIdx && !have.has(p.packet_index));
  if (!extra.length) return livePackets;
  return [...extra, ...livePackets].sort((a, b) => (a.packet_index ?? 0) - (b.packet_index ?? 0));
}

/**
 * Eases numbers from their old to their new value (ease-out, ~0.7 s) so the dial, bars and
 * distances glide between packets instead of jumping. Display only — the decoded values
 * are unchanged. null ↔ number switches immediately, and so does a key whose identity
 * (ids[key], e.g. the target type + speed) changed — a new target appears at once.
 */
export function useSmoothValues(target, ms = 700, ids = {}) {
  const [, force] = useState(0);
  const st = useRef(null);
  if (st.current == null) st.current = { from: { ...target }, to: { ...target }, cur: { ...target }, ids: { ...ids } };
  const sig = Object.keys(target).map(k => `${k}=${target[k]}~${ids[k] ?? ""}`).join("|");
  const off = !(ms > 0);                                        // ⚙ Settings → LIVE → Smooth value changes off
  useEffect(() => {
    const s = st.current;
    if (off) { s.cur = { ...target }; s.ids = { ...ids }; return undefined; }
    s.from = { ...s.cur }; s.to = { ...target };
    for (const key of Object.keys(ids)) if (ids[key] !== s.ids[key]) s.from[key] = target[key];   // a different item → no sweep
    s.ids = { ...ids };
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      for (const key of Object.keys(s.to)) {
        const a = s.from[key], b = s.to[key];
        s.cur[key] = a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) ? b : a + (b - a) * e;
      }
      force(n => n + 1);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sig, ms]); // eslint-disable-line react-hooks/exhaustive-deps
  return off ? target : st.current.cur;
}

/* ═══════════════════════════════════════════════════════════════
   DMI ENGINE
═══════════════════════════════════════════════════════════════ */
/** All loco IDs present in the feed (from C.4.3 / C.4.6), newest activity first. */
const CUE_SAME_PLACE_M = 50;   // a speed drop this close to a turnout belongs to that turnout
const CUE_TURNOUT_M = 2000, CUE_PSR_M = 1500;   // the distances the DMI starts showing them (target ≤ 2000 m, PSR message ≤ 1500 m)

export function dmiLocoIds(packets) {
  const last = new Map();
  for (const p of packets) {
    const t = ptype(p);
    if (t !== 10 && t !== 13) continue;
    const id = fieldMap(p).SOURCE_LOCO_ID;
    if (id && id > 0) last.set(id, tMs(p) || p.packet_index || 0);
  }
  return [...last.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

function decodeStationTrack(m) {
  // SSP / gradient / TLI distances chain (delta from previous entry); LC gates,
  // turnouts, track conditions and TSRs are measured from the profile start.
  // SSP: entry i = speed for the next LM_Static_Speed_Distance[i] metres, segments chained
  // from the profile start (e.g. 110 kmph for 761 m, then 100 kmph for 917 m, …)
  const ssp = [];
  { const d = indexed(m, "LM_Static_Speed_Distance"); let cum = 0;
    d.forEach((dist, i) => {
      const from = cum; cum += dist || 0;
      const uni = speedCode(m[`LM_Static_Speed_Value[${i + 1}]`]);
      const cls = ["A", "B", "C"].map(c => speedCode(m[`LM_Static_Speed_${c}[${i + 1}]`])).filter(v => v != null);
      const sp = uni != null ? uni : cls.length ? Math.min(...cls) : null;
      if (sp != null) ssp.push({ from, to: cum, speed: sp });
    }); }
  const tsr = indexed(m, "TSR_Distance").map((d, i) => {
    const uni = speedCode(m[`TSR_Universal_Speed[${i + 1}]`]);
    const cls = ["A", "B", "C"].map(c => speedCode(m[`TSR_Class${c}_Speed[${i + 1}]`])).filter(v => v != null);
    return { start: d || 0, len: m[`TSR_Length[${i + 1}]`] || 0, speed: uni != null ? uni : cls.length ? Math.min(...cls) : null, id: m[`TSR_ID[${i + 1}]`] };
  }).filter(x => x.speed != null);
  const turnouts = indexed(m, "DIFF_DIST_TO").map((d, i) => ({
    start: d || 0, release: m[`TO_SPEED_REL_DIST[${i + 1}]`] || 0, speed: turnoutCode(m[`TO_SPEED[${i + 1}]`]),
  })).filter(x => x.speed != null);
  const lcs = indexed(m, "LM_LC_Distance").map((d, i) => ({
    at: d || 0, id: m[`LM_LC_ID_Numeric[${i + 1}]`], unmanned: m[`LM_LC_Manning_Type[${i + 1}]`] === 1,
  }));
  const conds = indexed(m, "TRACKCOND_TYPE").map((type, i) => ({
    type, start: m[`START_DIST_TRACKCOND[${i + 1}]`] || 0, len: m[`LENGTH_TRACKCOND[${i + 1}]`] || 0,
  }));
  const tags = []; { let cum = 0;
    indexed(m, "DIST_NXT_RFID").forEach((d, i) => { cum += d || 0; tags.push({ at: cum, id: m[`NXT_RFID_TAG_ID[${i + 1}]`] }); }); }
  return { ssp, tsr, turnouts, lcs, conds, tags };
}

/**
 * Everything the DMI shows for one loco.
 * @param {object[]} packets  decoded LIVE packets (oldest → newest)
 * @param {number}   locoId
 * @param {number}   now      ms
 */
export function buildDmi(packets, locoId, now = Date.now(), tagLoc = {}, opts = {}) {
  const tagMissM = opts.tagMissM > 0 ? opts.tagMissM : TAG_MISS_M;
  const loco = [], stnAll = [], otherLast = new Map();
  const stnRx = [];          // every station packet this loco receives (RF strength): C.4.2, C.4.4 Access Authority, C.4.5
  let c45 = null;
  for (let k = 0; k < packets.length; k++) {
    const p = packets[k];
    const t = ptype(p);
    const m = fieldMap(p);
    if (t === 10 || t === 13) {
      if (m.SOURCE_LOCO_ID === locoId) loco.push({ p, m, k });
      else if (m.SOURCE_LOCO_ID > 0) otherLast.set(m.SOURCE_LOCO_ID, { p, m });
    } else if (t === 9) {
      if (m.DEST_LOCO_ID === locoId || m.DEST_LOCO_ID === 0) { stnAll.push({ p, m, k }); stnRx.push({ p, m }); }
    } else if (t === 11) {
      if (m.DEST_LOCO_ID === locoId) stnRx.push({ p, m });          // Access Authority for this loco
    } else if (t === 12) {
      stnRx.push({ p, m });                                          // Additional Emergency — to all locos
      if (m.GEN_SOS_CALL === 1) c45 = { p, m };
    }
  }
  const last = loco[loco.length - 1] || null;
  const last10 = [...loco].reverse().find(x => ptype(x.p) === 10) || null;   // Brake_Applied only in C.4.3
  const stn = stnAll[stnAll.length - 1] || null;
  const L = last?.m || {}, S = stn?.m || {};
  const src = {};                                                              // value → packet it came from

  /* ── loco side ── */
  const rawSpd = L.TRAIN_SPEED;
  const speed = rawSpd != null && rawSpd <= 400 ? rawSpd : null;
  // ABS_LOCO_LOC with glitches removed (annotated once on arrival by the keeper, else filtered here)
  const absF = loco.length && loco.every(x => x.p._absF !== undefined) ? loco.map(x => x.p._absF) : filterLocoAbs(loco.map(x => x.m));
  let abs = null;
  for (let i = absF.length - 1; i >= 0; i--) if (absF[i] != null) { abs = absF[i]; break; }
  const trainLen = L.TRAIN_LENGTH > 0 ? L.TRAIN_LENGTH : null;
  const mode = MODES[L.LOCO_MODE] || null;
  const dirN = L.MOVEMENT_DIR === 1 ? "N" : L.MOVEMENT_DIR === 2 ? "R" : null;
  const emg = L.EMERGENCY_STATUS || 0;
  // Brake_Applied comes only in C.4.3; "overspeed" (1) is meaningless at standstill
  // (the latest packet may be a C.4.6 that carries no brake field).
  const brakeRaw = last10?.m.Brake_Applied || 0;
  const brake = brakeRaw === 1 && speed === 0 ? 0 : brakeRaw;
  const lastTag = L.LAST_RFID_TAG > 0 ? L.LAST_RFID_TAG : null;
  if (last) { const r = pktRef(last.p, ptype(last.p) === 13 ? "C.4.6" : "C.4.3");
    Object.assign(src, { speed: r, loc: r, tl: r, mode: r, dir: r, tag: r, emg: r }); }
  if (last10) src.brake = pktRef(last10.p, "C.4.3");

  /* tag history: each LAST_RFID_TAG the loco reported, with the (filtered) ABS where it first
     reported it — after a rejected glitch, the next valid reading */
  const tagSeen = [];
  loco.forEach(({ m }, i) => {
    const id = m.LAST_RFID_TAG, prev = tagSeen[tagSeen.length - 1];
    if (prev && prev.id === id) {
      if (prev.abs == null && absF[i] != null) prev.abs = absF[i];
      if (prev.link == null && m.TAG_LINK_INFO != null) prev.link = m.TAG_LINK_INFO;
      return;
    }
    if (!(id > 0)) return;
    tagSeen.push({ id, abs: absF[i], link: m.TAG_LINK_INFO ?? null, i });
  });
  // direction of travel on the ABS scale: the loco's first clear movement (> 20 m)
  let sg = 0;
  { const a0 = absF.find(a => a != null);
    if (a0 != null) for (const a of absF) if (a != null && Math.abs(a - a0) > 20) { sg = Math.sign(a - a0); break; } }

  /* ── track side (C.4.2) ── */
  const hasStn = !!stn;
  // Track profile: the station sends SSP / TSR / turnouts / LC / track conditions / tag
  // linking only when they change (normally the first C.4.2), so — like the onboard unit —
  // keep the most recent C.4.2 that carried them (it may reference an older RFID tag).
  let track = { ssp: [], tsr: [], turnouts: [], lcs: [], conds: [], tags: [] }, profileRef = null;
  for (let i = stnAll.length - 1; i >= 0; i--) {
    const t = decodeStationTrack(stnAll[i].m);
    if (t.ssp.length || t.tsr.length || t.turnouts.length || t.lcs.length || t.conds.length || t.tags.length) {
      track = t; profileRef = stnAll[i];
      break;
    }
  }
  if (profileRef) src.ssp = pktRef(profileRef.p, "C.4.2 profile");
  const pm = profileRef?.m || {}, pRef = pm.LAST_REF_RFID > 0 ? pm.LAST_REF_RFID : null, pDps = pm.DIST_PKT_START || 0;
  if (!sg) sg = (pm.PKT_DIR ?? S.PKT_DIR) === 2 ? -1 : 1;

  /* route: the profile's tags (LAST_REF_RFID + tag-linking list) fixed on the ABS scale,
     anchored once — tag table, else where the loco first reported the reference tag — so
     positions, MA, targets and tag status are always measured from the same points. */
  const pRead = pRef != null ? tagSeen.find(x => x.id === pRef && x.abs != null) || null : null;
  const anchorAbs = pRef != null ? (tagLoc[pRef] ?? pRead?.abs ?? null) : null;
  const route = [];
  if (pRef != null) {
    const list = track.tags.some(t => t.id === pRef) ? track.tags : [{ id: pRef, at: 0 }, ...track.tags];
    for (const t of list) {
      if (!(t.id > 0) || route.some(r => r.id === t.id)) continue;
      const loc = tagLoc[t.id] ?? (anchorAbs == null ? null : t.id === pRef ? anchorAbs : anchorAbs + sg * (pDps + t.at));
      route.push({ id: t.id, loc });
    }
  }

  /* Region M — tag read status, built in packet order like a shift register (M1 on top = latest):
       • the loco reports a new LAST_RFID_TAG          → GREEN goes in at M1, older ones move down
       • the next tag expected from the C.4.2 tag list (TLI) is not reported — a later tag is
         reported first, or the loco runs TAG_MISS_M past its location   → RED goes in at M1
       • nothing yet → all three GREY.
     Only the packet order matters (not timing / list size), so a replay always gives the same. */
  const tagEvents = [];
  {
    let rt = null, rtRef = null, rtDps = 0, exp = 0, lastId = null;
    const firstAbs = new Map();                                      // first valid ABS per reported tag
    const steps = [...loco.map((x, i) => ({ k: x.k, i })), ...stnAll.map(x => ({ k: x.k, s: x }))].sort((a, b) => a.k - b.k);
    for (const e of steps) {
      if (e.s) {                                                     // C.4.2: a (new) tag-linking list?
        const m = e.s.m;
        if (!("DIST_NXT_RFID[1]" in m) && !(m.LAST_REF_RFID > 0 && PROFILE_KEYS.some(key => key in m))) continue;
        const ref = m.LAST_REF_RFID > 0 ? m.LAST_REF_RFID : null;
        const tl = decodeStationTrack(m).tags;
        const list = ref != null && !tl.some(x => x.id === ref) ? [{ id: ref, at: 0 }] : [];
        for (const x of tl) if (x.id > 0 && !list.some(y => y.id === x.id)) list.push(x);
        if (!list.length || (rt && rt.length === list.length && rt.every((r, q) => r.id === list[q].id))) continue;
        rt = list; rtRef = ref; rtDps = m.DIST_PKT_START || 0;
        exp = lastId != null ? rt.findIndex(r => r.id === lastId) + 1 : 0;   // expect the tag after the last one read
        continue;
      }
      const m = loco[e.i].m, a = absF[e.i], id = m.LAST_RFID_TAG;
      if (id > 0 && a != null && !firstAbs.has(id)) firstAbs.set(id, a);
      if (id > 0 && id !== lastId) {                                 // tag reported
        lastId = id;
        const j = rt ? rt.findIndex(r => r.id === id) : -1;
        let late = -1;                                               // already marked missed by location, read late
        for (let q = tagEvents.length - 1; q >= Math.max(0, tagEvents.length - 4); q--) if (tagEvents[q].id === id && tagEvents[q].status === "missed") { late = q; break; }
        if (late >= 0) { tagEvents[late] = { id, status: "read" }; if (j >= 0) exp = Math.max(exp, j + 1); continue; }
        if (j >= 0) {
          for (let q = exp; q < j; q++) tagEvents.push({ id: rt[q].id, status: "missed" });   // skipped expected tags
          exp = j + 1;                                               // (j < exp: run restarted / reversed)
        }
        tagEvents.push({ id, status: "read" });
      }
      if (rt && a != null) {                                         // ran past the expected tag without a report
        const anc = rtRef != null ? (tagLoc[rtRef] ?? firstAbs.get(rtRef)) : null;
        while (exp < rt.length) {
          const r = rt[exp];
          const loc = tagLoc[r.id] ?? (anc == null ? null : r.id === rtRef ? anc : anc + sg * (rtDps + r.at));
          if (loc == null || sg * (a - loc) <= tagMissM) break;
          tagEvents.push({ id: r.id, status: "missed" }); exp++;
        }
      }
    }
  }
  const mTags = tagEvents.slice(-3).reverse();

  // loco offset past the LAST_REF_RFID of a C.4.2 — best available reference, method recorded
  const refLocOf = id => tagLoc[id] ?? route.find(r => r.id === id && r.loc != null)?.loc
    ?? [...tagSeen].reverse().find(x => x.id === id && x.abs != null)?.abs ?? null;
  const offsetFor = st => {
    const ref = st.m.LAST_REF_RFID, dps = st.m.DIST_PKT_START || 0;
    const rl = refLocOf(ref);
    if (rl != null && abs != null) {
      const o = sg * (abs - rl);
      const how = tagLoc[ref] != null ? "tag table" : route.some(r => r.id === ref && r.loc != null) ? `C.4.2 tag list, anchored at RFID #${pRef}` : "read by the loco";
      return { o, how: `RFID #${ref} at ${rl} m (${how}) → ${Math.round(o)} m past it` };
    }
    let atS2L = null;
    for (let i = loco.length - 1; i >= 0; i--) if (loco[i].k <= st.k && absF[i] != null) { atS2L = absF[i]; break; }
    if (atS2L != null && abs != null) {
      const run = Math.abs(abs - atS2L);
      return { o: Math.max(0, dps) + run, how: `DIST_PKT_START ${dps} m + ${run} m run since that C.4.2` };
    }
    return { o: Math.max(0, dps), how: `DIST_PKT_START = ${dps} m` };
  };
  const refTag = S.LAST_REF_RFID;
  // A C.4.2 is for the direction in PKT_DIR. A loco running the other way (e.g. after a trip,
  // MOVEMENT_DIR 2 while the station still sends PKT_DIR 1) must not use its MA / profile / signal.
  const dirOk = !([1, 2].includes(S.PKT_DIR) && [1, 2].includes(L.MOVEMENT_DIR) && S.PKT_DIR !== L.MOVEMENT_DIR);
  const { o: offset = null, how: offsetHow = "" } = !hasStn ? {}
    : dirOk ? offsetFor(stn)
    : { o: null, how: `loco moving ${L.MOVEMENT_DIR === 2 ? "Reverse" : "Nominal"}, C.4.2 is for PKT_DIR ${S.PKT_DIR === 2 ? "Reverse" : "Nominal"} — MA, targets and signal not applied` };
  const p = profileRef && dirOk ? offsetFor(profileRef).o - pDps : null;

  // signal + MA
  const sigInfo = S.CUR_SIG_INFO;
  const aspect = S.CUR_SIG_ASPECT;
  const lamps = hasStn && dirOk ? ASPECT_LAMPS[aspect] || null : null;
  const sigType = sigInfo != null ? (sigInfo >> 9) & 0x3f : null;
  const lineCode = sigInfo != null ? (sigInfo >> 5) & 0xf : null;
  const d3 = sigInfo != null ? [LINE_ABBR[lineCode], SIG_ABBR[sigType]].filter(Boolean).join(" ") : "";
  const sigDist = hasStn && S.APPR_SIG_DIST != null && offset != null ? Math.max(0, S.APPR_SIG_DIST - offset) : null;
  const maRaw = S.REQ_SHORTEN_MA === 1 && S.NEW_MA != null ? S.NEW_MA : S.MA_W_R_T_SIG;
  // MA_W_R_T_SIG and APPR_SIG_DIST are both measured from LAST_REF_RFID (498: 3230 / 1202,
  // 500: 3030 / 1002, … — EoA stays fixed), so the remaining MA = MA − run past that tag.
  const maKnown = hasStn && maRaw != null && maRaw !== 65535 && offset != null;
  const ma = maKnown ? Math.max(0, maRaw - offset) : null;
  const osSpeed = S.AUTHORITY_TYPE === 1 && dirOk ? speedCode(S.AUTHORIZED_SPEED) : null;
  const destSos = S.DEST_LOCO_SOS || 0;
  if (stn) { const r = pktRef(stn.p, "C.4.2"); Object.assign(src, { ma: r, sig: r, sigDist: r, target: r }); }

  // speed profile at the loco
  const sspAt = x => {
    const seg = track.ssp.find(e => x >= e.from && x < e.to);
    if (seg) return seg.speed;
    return x < (track.ssp[0]?.from ?? 0) ? track.ssp[0]?.speed ?? null : track.ssp[track.ssp.length - 1]?.speed ?? null;
  };
  const sectionSpeed = p != null && track.ssp.length ? sspAt(Math.max(0, p)) : null;
  const limits = [];
  if (sectionSpeed != null) limits.push(sectionSpeed);
  if (p != null) {
    track.tsr.forEach(t => { if (p >= t.start && p <= t.start + t.len) limits.push(t.speed); });
    track.turnouts.forEach(t => { if (p >= t.start && p <= t.start + Math.max(t.release, 1)) limits.push(t.speed); });
  }
  if (osSpeed != null) limits.push(osSpeed);
  const permittedStatic = limits.length ? Math.min(...limits) : null;
  // While Kavach is braking (NSB / FSB / EB) the permitted speed shown follows the train down:
  // the green band ends at the current speed instead of the (higher) static limit.
  const braking = brake >= 2 && brake <= 4;
  const permitted = braking && speed != null && permittedStatic != null ? Math.min(permittedStatic, speed) : permittedStatic;

  // targets ahead (Region A / B7 / H)
  // A4 target types (Annexure-B B4.3.8): EOA · Turn Out · TSR · PSR · Collision · SoS
  const targets = [];
  if (p != null) {
    if (ma != null) targets.push({ type: "EOA", dist: ma, speed: 0 });       // incl. SPAD (DEST_LOCO_SOS 4): MA is cut — EoA
    track.turnouts.forEach(t => { if (t.start > p) targets.push({ type: "Turnout", dist: t.start - p, speed: t.speed }); });
    track.tsr.forEach(t => { if (t.start > p) targets.push({ type: "TSR", dist: t.start - p, speed: t.speed }); });
    let cur = sectionSpeed;
    track.ssp.forEach(e => {
      if (e.from > p && cur != null && e.speed < cur) targets.push({ type: "PSR", dist: e.from - p, speed: e.speed });
      if (e.from > p) cur = e.speed;
    });
  }
  targets.sort((a, b) => a.dist - b.dist);

  /* Emergency targets — a stop that overrides the route targets:
       Collision: the station reports a rear-end / head-on collision for this loco
                  (DEST_LOCO_SOS 5 / 6), this loco reports one (EMERGENCY_STATUS 4 / 5),
                  or another loco reports one (EMERGENCY_STATUS 4 / 5, last 30 s) —
                  distance to that loco when both positions are known, else the MA.
       SoS:       Station General SoS for this loco (DEST_LOCO_SOS 8), C.4.5 SoS to all
                  locos (last 30 s), this loco's own SoS, or another loco's SoS
                  (EMERGENCY_STATUS 1 / 2 / 6, last 30 s, within 3 km). */
  const emergencies = [];
  const recent = o => now - tMs(o.p) < 30000;
  const oAbsOf = o => (o.m.ABS_LOCO_LOC != null && o.m.ABS_LOCO_LOC !== ABS_NA ? o.m.ABS_LOCO_LOC : null);
  const stopDist = ma != null ? ma : 0;
  if (destSos === 5 || destSos === 6 || emg === 4 || emg === 5) {
    let near = null;
    for (const o of otherLast.values()) { const a = oAbsOf(o); if (a != null && abs != null && recent(o)) near = Math.min(near ?? Infinity, Math.abs(abs - a)); }
    emergencies.push({ type: "Collision", dist: near ?? stopDist, speed: 0, prio: 2 });
  }
  for (const o of otherLast.values()) {
    const e = o.m.EMERGENCY_STATUS, a = oAbsOf(o);
    if ((e === 4 || e === 5) && recent(o) && a != null && abs != null) emergencies.push({ type: "Collision", dist: Math.abs(abs - a), speed: 0, prio: 2 });
  }
  const otherSos = [...otherLast.values()].some(o => EMRG_SELF[o.m.EMERGENCY_STATUS] && recent(o)
    && (oAbsOf(o) == null || abs == null || Math.abs(abs - oAbsOf(o)) <= 3000));
  if (destSos === 8 || (c45 && now - tMs(c45.p) < 30000) || EMRG_SELF[emg] || otherSos)
    emergencies.push({ type: "SoS", dist: stopDist, speed: 0, prio: 1 });
  emergencies.sort((a, b) => b.prio - a.prio || a.dist - b.dist);

  // a target only counts when it is below the static permitted speed (EoA / SoS / collision always)
  const restricts = t => t.speed === 0 || permittedStatic == null || t.speed < permittedStatic;
  const target = emergencies[0] || targets.find(t => t.dist <= 2000 && restricts(t)) || null;   // Region A: emergency first, else nearest ≤ 2000 m
  const speedTarget = targets.find(t => t.speed > 0 && t.dist <= 2000 && restricts(t)) || null;

  // track conditions / LC gates / tags ahead
  const inCond = type => p != null && track.conds.some(c => c.type === type && p >= c.start && p <= c.start + c.len);
  const ahead = (type, max) => p == null ? null : track.conds.filter(c => c.type === type && c.start > p && c.start - p <= max).sort((a, b) => a.start - b.start)[0] || null;
  const radioHole = inCond(2);
  const nextTag = p != null ? track.tags.find(t => t.at > p) || null : null;

  /* ── RF strength: in how many of the last 5 TDMA cycles (2 s each) this loco received a station
        packet — C.4.2 Regular, C.4.4 Access Authority or C.4.5. One per cycle (FRAME_NUM), so a
        C.4.2 and a C.4.4 in the same cycle still count as one bar. ── */
  const rfCycles = new Set();
  for (const x of stnRx) if (now - tMs(x.p) <= 10000) rfCycles.add(x.m.FRAME_NUM ?? Math.floor(tMs(x.p) / 2000));
  const rf = rfCycles.size;

  /* ── messages ── */
  const H = [];
  if (mode?.key === "TR") H.push("Train Tripped, Select  P_Trip");
  if (emg === 3) H.push("Rollback Protection, Brake Applied");
  if (destSos === 4) H.push("Brake Applied-SPAD detected");
  if (destSos === 7) H.push("Brake Applied- Shunting limits exceeded");
  if (destSos === 8) H.push("Brake Applied- Station General SoS");
  if (destSos === 1) H.push("ACK SR mode- Foreign Tag Detected");
  if (destSos === 3) H.push("Ack for SR mode - Odo Error detected");
  for (const [id, o] of otherLast) {
    const e = o.m.EMERGENCY_STATUS;
    const oAbs = o.m.ABS_LOCO_LOC;
    if ((e === 4 || e === 5) && abs != null && oAbs != null && oAbs !== 8388607 && now - tMs(o.p) < 30000) {
      H.push(`${e === 4 ? "Head On" : "Rear End"} Collision with Loco ${id} in ${pad(Math.abs(abs - oAbs), 4)} m`);
    }
  }
  if (target && target.type === "Turnout") H.push(`TurnOut in ${pad(target.dist, 4)}m with Speed Limit ${target.speed}kmph`);
  targets.filter(t => (t.type === "TSR" || t.type === "PSR") && t.dist <= 1500 && restricts(t)).slice(0, 2)
    .forEach(t => H.push(`${t.type} in ${pad(t.dist, 4)}m with Speed Limit ${t.speed}kmph`));
  if (ma != null && ma <= 2000) H.push(`End of Authority in ${pad(ma, 4)}m`);
  if (p != null) track.lcs.filter(g => g.at > p && g.at - p <= 1500).slice(0, 2)
    .forEach(g => H.push(`${g.unmanned ? "Unmanned" : "Manned"} LC Gate ${g.id ?? ""} in ${pad(g.at - p, 4)}m`));
  const rh = ahead(2, 2000); if (rh) H.push(`Approaching Radio Hole in ${pad(rh.start - p, 4)} m`);
  const ns = ahead(5, 1000); if (ns) H.push(`Neutral Section approaching in ${pad(ns.start - p, 3)} m`);
  if (inCond(8)) H.push("Fouling Mark Entry");
  if (inCond(9)) H.push("Ack SR  mode, KAVACH Territory Exit");

  const I = [];
  if (EMRG_SELF[emg]) I.push(`SOS – Self Loco ( ${EMRG_SELF[emg]} )`);
  for (const [id, o] of otherLast) {
    const e = o.m.EMERGENCY_STATUS;
    if (EMRG_SELF[e] && now - tMs(o.p) < 30000) I.push(`SOS – From Loco ${id} ( ${EMRG_SELF[e]} )`);
  }
  if (destSos === 8) I.push(`SOS – From Station ${S.SOURCE_STN_ILC_IBS_ID ?? ""} ( SOS to This Loco )`);
  if (c45 && now - tMs(c45.p) < 30000) I.push(`SOS – From Station ${c45.m.SOURCE_STN_ILC_IBS_ID ?? ""} ( SOS to All Locos )`);
  if (brake === 1) I.push("Over Speed, Please Reduce Speed");
  if (brake >= 2 && brake <= 4) I.push("Brake Applied, Speed Limit Exceeded");

  return {
    locoId, hasLoco: !!last, hasStn, ageLoco: last ? now - tMs(last.p) : null, ageStn: stn ? now - tMs(stn.p) : null,
    speed, abs, trainLen, mode, dirN, emg, brake, lastTag, tagLink: L.TAG_LINK_INFO ?? 0,
    tags: mTags,                                                              // M1 latest, M2, M3 — { id, status }
    route, sg, refLoc: refTag > 0 ? refLocOf(refTag) : null,
    tagEvents: tagEvents.slice(-12), missedTags: tagEvents.filter(t => t.status === "missed").map(t => t.id),
    lamps, aspect, aspectName: aspectName(aspect) || (hasStn ? `Code ${aspect}` : "—"), marker: sigMarker(sigType, aspect),
    routeInd: lamps ? routeOf(aspect) : null,
    stencil: lamps ? stencilNo(aspect) : null,          // stencil route number 1…32 (Amdt-10), else null
    nextAspect: hasStn && dirOk ? S.NEXT_SIG_ASPECT ?? null : null,
    nextAspectName: hasStn && dirOk && S.NEXT_SIG_ASPECT != null ? (S.NEXT_SIG_ASPECT === 0 ? "— (current is Red)" : aspectName(S.NEXT_SIG_ASPECT) || `Code ${S.NEXT_SIG_ASPECT}`) : null,
    d3, sigDist, ma, maRaw, sigInfo, sigType, lineCode, osSpeed, destSos, refTag, offset, offsetHow,
    sectionSpeed, permitted, target, speedTarget, nextTag: nextTag && p != null ? { id: nextTag.id, dist: nextTag.at - p } : null,
    rf: Math.min(5, rf), radioHole, H, I, src, stnId: S.SOURCE_STN_ILC_IBS_ID ?? null,
    // 🗣 route announcements: profile position + what lies on it (same PSR rule as the targets above)
    cueTrack: p == null ? null : {
      p,
      turnouts: track.turnouts.map(t => t.start),
      // The speed profile also drops at a turnout: that drop is the turnout, not a separate PSR.
      psrs: track.ssp.filter((e, i) => i > 0 && e.speed < track.ssp[i - 1].speed
        && !track.turnouts.some(t => Math.abs(t.start - e.from) <= CUE_SAME_PLACE_M)).map(e => e.from),
    },
  };
}

/**
 * 🗣 Route announcements for one loco at a time, from its buildDmi() result. A signal is announced
 * as soon as the C.4.2 gives it, then every repeatMs until it is passed. A turnout or PSR is announced
 * from the distance the DMI starts showing it, every profileRepeatMs until it is entered, then
 * once on entering. Repeats need a moving loco; the first announcement also plays at a standstill. Positions are compared on the ABS scale so a new C.4.2 profile (which restarts
 * the profile's own distances) doesn't announce the same turnout or PSR again.
 */
export function createVoiceCueTracker() {
  const locos = new Map();
  return {
    reset() { locos.clear(); },
    update(d, repeatMs = 0, profileRepeatMs = 0, now = Date.now()) {
      let st = locos.get(d.locoId);
      if (!st) { st = { abs: null, sigDist: null, sigCue: null, sigAt: 0, said: new Set(), saidAt: new Map() }; locos.set(d.locoId, st); }
      const cues = new Set();
      const moving = d.speed > 0;
      if (st.abs != null && d.abs != null && d.sg && d.sg * (d.abs - st.abs) < -200) {   // run restarted
        st.said.clear(); st.saidAt.clear(); st.sigCue = null; st.abs = null;
      }

      /* Signal ahead, from the lamps the DMI shows. Announced again if the aspect changes, or
         for the next signal (the distance jumps up). */
      const sigCue = !d.lamps ? null : d.lamps[3] ? "danger" : d.lamps[0] && d.lamps[2] ? "attention" : d.lamps[2] ? "caution" : d.lamps[1] ? "proceed" : null;
      const dist = d.sigDist;
      if (!sigCue || dist == null || dist <= 0) st.sigCue = null;
      else {
        if (st.sigDist != null && dist > st.sigDist + 300) st.sigCue = null;
        if (st.sigCue !== sigCue || (moving && repeatMs > 0 && now - st.sigAt >= repeatMs)) { cues.add(sigCue); st.sigCue = sigCue; st.sigAt = now; }
      }
      st.sigDist = dist;

      /* Turnouts and PSRs ahead */
      if (d.cueTrack && d.abs != null && d.sg) {
        const { p, turnouts, psrs } = d.cueTrack;
        const check = (starts, kind, nearM, approachCue, enteredCue) => starts.forEach(start => {
          const at = d.abs + d.sg * (start - p);
          const key = kind + Math.round(at / 50);
          const ahead = start - p;
          const crossed = st.abs != null && d.sg * (st.abs - at) < 0 && ahead <= 0 && ahead > -400;
          if (crossed && !st.said.has(key + "in")) {
            st.said.add(key + "in"); st.said.add(key); cues.add(enteredCue);
          } else if (ahead > 0 && ahead <= nearM && !st.said.has(key + "in")
            && (!st.said.has(key) || (moving && profileRepeatMs > 0 && now - st.saidAt.get(key) >= profileRepeatMs))) {
            st.said.add(key); st.saidAt.set(key, now); cues.add(approachCue);
          }
        });
        check(turnouts, "T", CUE_TURNOUT_M, "approachTurnout", "enteredTurnout");
        check(psrs, "P", CUE_PSR_M, "approachPsr", "enteredPsr");
      }
      if (d.abs != null) st.abs = d.abs;
      return ["danger", "attention", "caution", "proceed", "enteredTurnout", "enteredPsr", "approachTurnout", "approachPsr"].filter(c => cues.has(c));
    },
  };
}

/* ═══════════════════════════════════════════════════════════════
   DRAWING (800 × 600 units, Annexure-B)
═══════════════════════════════════════════════════════════════ */
/* Region A target scale (from region top): 2000@107 … 0@337 */
const A_MARKS = [[0, 337], [250, 272], [500, 207], [750, 182], [1000, 157], [1250, 141], [1500, 124], [2000, 107]];
/* Region C MA scale: 0@342 … 3000@77, +++@45 */
const C_MARKS = [[0, 342], [100, 308], [200, 274], [250, 259], [500, 198], [1000, 147], [2000, 112], [3000, 77]];
function scaleY(marks, v) {
  if (v <= 0) return marks[0][1];
  for (let i = 1; i < marks.length; i++) {
    const [v1, y1] = marks[i], [v0, y0] = marks[i - 1];
    if (v <= v1) return y0 + (y1 - y0) * (v - v0) / (v1 - v0);
  }
  return marks[marks.length - 1][1];
}

const CX = 274, CY = 188;                       // dial centre (Region B: x 92-457)
// speed bands: a small gap outside the tick marks; at the permitted speed a short tip (R_IN→R_MID)
// reaches in to the ticks — as in the Annexure-B picture
const R_TICK = 157, R_IN = 157, R_MID = 162, R_OUT = 173;
const ang = s => (-149 + Math.max(0, Math.min(250, s)) * 298 / 250) * Math.PI / 180;   // 0° = top, clockwise
const pt = (s, r) => [CX + r * Math.sin(ang(s)), CY - r * Math.cos(ang(s))];
function band(s1, s2, r1, r2) {
  if (s2 <= s1) return "";
  const [x1, y1] = pt(s1, r1), [x2, y2] = pt(s2, r1), [x3, y3] = pt(s2, r2), [x4, y4] = pt(s1, r2);
  const large = (s2 - s1) * 298 / 250 > 180 ? 1 : 0;
  return `M${x1},${y1} A${r1},${r1} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r2},${r2} 0 ${large} 0 ${x4},${y4} Z`;
}

function ModeSymbol({ k, x, y }) {                 // Region B10 — 55 × 35
  const w = 55, h = 35, c = DMI_COL.WHT;
  const box = <rect x={x} y={y} width={w} height={h} fill={k === "TR" ? DMI_COL.GRY : "#0a1426"} stroke={DMI_COL.GRY} />;
  const cx = x + w / 2, cy = y + h / 2;
  const sw = { stroke: c, strokeWidth: 2, fill: "none", strokeLinecap: "round" };
  let g = null;
  switch (k) {
    case "SB": g = <><path d={`M${cx - 7},${cy - 8} A11,11 0 1 0 ${cx + 7},${cy - 8}`} {...sw} /><line x1={cx} y1={cy - 13} x2={cx} y2={cy - 2} {...sw} /></>; break;
    case "SR": g = <><rect x={cx - 12} y={cy - 12} width={24} height={24} {...sw} /><line x1={cx - 12} y1={cy - 12} x2={cx + 12} y2={cy + 12} {...sw} /><line x1={cx + 12} y1={cy - 12} x2={cx - 12} y2={cy + 12} {...sw} /><circle cx={cx} cy={cy} r={5} {...sw} /></>; break;
    case "LS": g = <><rect x={cx - 13} y={cy - 12} width={26} height={24} {...sw} /><ellipse cx={cx} cy={cy} rx={9} ry={5.5} {...sw} /><circle cx={cx} cy={cy} r={2.5} fill={c} /><line x1={cx - 13} y1={cy} x2={cx - 9} y2={cy} {...sw} /><line x1={cx + 9} y1={cy} x2={cx + 13} y2={cy} {...sw} /></>; break;
    case "FS": g = <><rect x={cx - 13} y={cy - 12} width={26} height={24} {...sw} /><ellipse cx={cx} cy={cy} rx={9} ry={5.5} {...sw} /><circle cx={cx} cy={cy} r={2.5} fill={c} /></>; break;
    case "OV": g = <><rect x={cx - 4} y={cy - 13} width={8} height={18} {...sw} /><path d={`M${cx - 14},${cy + 9} H${cx + 12} M${cx + 8},${cy + 5} L${cx + 12},${cy + 9} L${cx + 8},${cy + 13}`} {...sw} /></>; break;
    case "OS": g = <><path d={`M${cx + 12},${cy - 13} L${cx - 12},${cy} L${cx + 12},${cy + 13}`} {...sw} /><ellipse cx={cx + 3} cy={cy} rx={6} ry={4} {...sw} /><circle cx={cx + 3} cy={cy} r={1.8} fill={c} /></>; break;
    case "TR": g = <><rect x={cx - 6} y={cy - 15} width={12} height={30} rx={3} fill="#1a1a1a" />{[-9, 0, 9].map(d => <circle key={d} cx={cx} cy={cy + d} r={3.6} fill={DMI_COL.BRD} />)}</>; break;
    case "PT": g = <><rect x={cx - 6} y={cy - 15} width={12} height={30} rx={3} {...sw} strokeWidth={1.5} />{[-9, 0, 9].map(d => <circle key={d} cx={cx} cy={cy + d} r={3.2} {...sw} strokeWidth={1.3} />)}</>; break;
    case "RV": g = <><path d={`M${cx + 8},${cy + 11} A9,9 0 1 0 ${cx + 6},${cy - 7}`} {...sw} /><path d={`M${cx - 14},${cy - 4} H${cx + 2} M${cx - 10},${cy - 8} L${cx - 14},${cy - 4} L${cx - 10},${cy}`} {...sw} /></>; break;
    case "SH": g = <><rect x={cx - 13} y={cy - 4} width={26} height={11} {...sw} /><rect x={cx + 2} y={cy - 11} width={9} height={7} {...sw} /><path d={`M${cx - 10},${cy + 1} H${cx + 6} M${cx - 6},${cy - 2} L${cx - 10},${cy + 1} L${cx - 6},${cy + 4}`} {...sw} strokeWidth={1.5} /></>; break;
    case "NL": g = <><path d={`M${cx - 14},${cy - 10} L${cx - 3},${cy} L${cx - 14},${cy + 10} M${cx + 14},${cy - 10} L${cx + 3},${cy} L${cx + 14},${cy + 10}`} {...sw} /><circle cx={cx} cy={cy} r={2.5} fill={c} /></>; break;
    case "SF": g = <><polygon points={`${cx},${cy - 14} ${cx + 15},${cy + 13} ${cx - 15},${cy + 13}`} fill={DMI_COL.BRD} /><rect x={cx - 1.6} y={cy - 6} width={3.2} height={11} fill={DMI_COL.WHT} /><circle cx={cx} cy={cy + 9} r={1.8} fill={DMI_COL.WHT} /></>; break;
    default: g = <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight="bold" fill={c} fontFamily={FONT}>{k}</text>;
  }
  return <g>{box}{g}</g>;
}

function BrakeSymbol({ level, x, y }) {             // Region B8
  if (!(level >= 2 && level <= 4)) return null;
  const col = level === 4 ? DMI_COL.BRD : level === 3 ? DMI_COL.ORG : DMI_COL.YLW;
  const lbl = level === 4 ? "EB" : level === 3 ? "FSB" : "NB";
  const cx = x + 18, cy = y + 17;
  return (
    <g>
      <rect x={x} y={y} width={70} height={34} fill="#000" stroke={DMI_COL.GRY} />
      <circle cx={cx} cy={cy} r={9} fill="none" stroke={col} strokeWidth={2.4} />
      <path d={`M${cx - 13},${cy - 9} A14,14 0 0 0 ${cx - 13},${cy + 9} M${cx + 13},${cy - 9} A14,14 0 0 1 ${cx + 13},${cy + 9}`} fill="none" stroke={col} strokeWidth={2.4} strokeLinecap="round" />
      <text x={cx} y={cy + 4.5} textAnchor="middle" fontSize={12} fontWeight="bold" fill={col} fontFamily={FONT}>!</text>
      <text x={x + 52} y={cy + 6} textAnchor="middle" fontSize={15} fontWeight="bold" fill={col} fontFamily={FONT}>{lbl}</text>
    </g>
  );
}

/* dial ticks (125 divisions × 2 kmph) — static */
const DIAL_TICKS = (() => {
  const out = [];
  for (let i = 0; i <= 125; i++) {
    const s = i * 2;
    const len = i % 10 === 0 ? 17 : i % 5 === 0 ? 15 : 6;
    const wdt = i % 5 === 0 ? 2 : 1;
    const [x1, y1] = pt(s, R_TICK), [x2, y2] = pt(s, R_TICK - len);
    out.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={DMI_COL.WHT} strokeWidth={wdt} />);
    if (i % 10 === 0) {
      const [lx, ly] = pt(s, R_TICK - 32);
      out.push(<text key={"l" + i} x={lx} y={ly + 7} textAnchor="middle" fontSize={20} fill={DMI_COL.WHT} fontFamily={FONT}>{s}</text>);
    }
  }
  return out;
})();

/* ═══════════════════════════════════════════════════════════════
   NOVA SPLASH — 5 s start-up screen over the DMI (the 📡 LIVE DMI and the DMI SIM), with the
   header's NOVA mark + wordmark and the PINJ title. It plays once, when the screen is first
   visible; then the DMI shows its normal state.
═══════════════════════════════════════════════════════════════ */
const SPLASH_MS = 5000;
const SPLASH_CSS = `
.nsp { animation: nspOut .6s ease-in 4.4s both; transform-box: view-box; transform-origin: 400px 300px; }
.nsp-bar  { transform-box: fill-box; animation: nspBar 1s cubic-bezier(.7,0,.2,1) .15s both; }
.nsp-bar.t { transform-origin: 50% 0; } .nsp-bar.b { transform-origin: 50% 100%; }
.nsp-glow { animation: nspFade 1.4s ease-out .4s both; }
.nsp-mark { transform-box: fill-box; transform-origin: center; animation: nspMark 1.3s cubic-bezier(.2,.7,.2,1) .6s both; }
.nsp-word { animation: nspWord 1.1s cubic-bezier(.2,.7,.2,1) 1s both; }
.nsp-shine { animation: nspShine 1s ease-in-out 1.9s both; }
.nsp-line { transform-box: fill-box; transform-origin: center; animation: nspLine .8s cubic-bezier(.2,.7,.2,1) 2s both; }
.nsp-title { animation: nspTitle 1s cubic-bezier(.2,.7,.2,1) 2.1s both; }
.nsp-tag { animation: nspFade .8s ease-out 2.7s both; }
.nsp-foot { animation: nspFade .8s ease-out 3s both; }
.nsp-prog { transform-box: fill-box; transform-origin: 0 50%; animation: nspProg 3.6s cubic-bezier(.4,0,.2,1) .8s both; }
.nsp-flare { animation: nspFlare 1.6s ease-in-out .9s both; }
@keyframes nspOut   { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(1.04); } }
@keyframes nspBar   { from { transform: scaleY(5); } to { transform: scaleY(1); } }
@keyframes nspFade  { from { opacity: 0; } to { opacity: 1; } }
@keyframes nspMark  { from { opacity: 0; transform: scale(1.35); filter: blur(10px); } to { opacity: 1; transform: scale(1); filter: blur(0); } }
@keyframes nspWord  { from { opacity: 0; transform: translateX(34px); filter: blur(6px); } to { opacity: 1; transform: none; filter: blur(0); } }
@keyframes nspShine { from { transform: translateX(-260px); } to { transform: translateX(360px); } }
@keyframes nspLine  { from { transform: scaleX(0); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }
@keyframes nspTitle { from { opacity: 0; letter-spacing: .55em; } to { opacity: 1; letter-spacing: .12em; } }
@keyframes nspProg  { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes nspFlare { 0% { opacity: 0; transform: translateX(-420px); } 35% { opacity: .9; } 100% { opacity: 0; transform: translateX(420px); } }
@media (prefers-reduced-motion: reduce) { .nsp * { animation-duration: .01s !important; animation-delay: 0s !important; } }
`;
function NovaSplash({ uid }) {
  const glow = `nspGlow${uid}`, shineG = `nspShineG${uid}`, wordM = `nspWordM${uid}`, flareG = `nspFlareG${uid}`;
  const WX = 318, WY = 186, WW = 302, WH = 89;                 // wordmark 112 × 33 → 302 × 89
  return (
    <g className="nsp" pointerEvents="none">
      <style>{SPLASH_CSS}</style>
      <defs>
        <radialGradient id={glow} cx="50%" cy="42%" r="60%">
          <stop offset="0" stopColor="#0d4a7a" stopOpacity=".55" /><stop offset=".55" stopColor="#06213a" stopOpacity=".25" /><stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={shineG} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".95" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={flareG} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0" /><stop offset=".5" stopColor="#bdf4ff" stopOpacity=".9" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
        <mask id={wordM} maskUnits="userSpaceOnUse" x="0" y="0" width="800" height="600">
          <image href="/nova-text-dark.png" x={WX} y={WY} width={WW} height={WH} preserveAspectRatio="none" />
        </mask>
      </defs>
      <rect x={0} y={0} width={800} height={600} fill="#000" />
      <rect className="nsp-glow" x={0} y={0} width={800} height={600} fill={`url(#${glow})`} />
      {/* NOVA mark + wordmark, as in the header */}
      <image className="nsp-mark" href="/nova-mark.png" x={180} y={170} width={122} height={122} />
      <g className="nsp-word">
        <image href="/nova-text-dark.png" x={WX} y={WY} width={WW} height={WH} />
        <g mask={`url(#${wordM})`}>
          <rect className="nsp-shine" x={WX - 40} y={WY - 10} width={90} height={WH + 20} fill={`url(#${shineG})`} transform="skewX(-18)" />
        </g>
      </g>
      {/* lens flare across the logo */}
      <rect className="nsp-flare" x={200} y={233} width={400} height={2} fill={`url(#${flareG})`} />
      <rect className="nsp-line" x={180} y={322} width={440} height={1.5} fill="#22d3ee" opacity=".7" />
      <text className="nsp-title" x={400} y={362} textAnchor="middle" fontSize={21} fontWeight="bold" fill="#fff" fontFamily={FONT}>
        <tspan fill="#22d3ee">PINJ</tspan> — KAVACH PACKET INJECTOR &amp; DECODER
      </text>
      <text className="nsp-tag" x={400} y={394} textAnchor="middle" fontSize={15} fontStyle="italic" fill="#9fb3c8" fontFamily={FONT}>
        Engineering Safety · Powering Innovation
      </text>
      <text className="nsp-foot" x={400} y={500} textAnchor="middle" fontSize={12} fill="#5f7286" letterSpacing="3" fontFamily={FONT}>
        LP-OCIP · RDSO/SPN/196/2020 · ANNEXURE-B
      </text>
      <rect x={250} y={524} width={300} height={3} rx={1.5} fill="#16202c" />
      <rect className="nsp-prog" x={250} y={524} width={300} height={3} rx={1.5} fill="#22d3ee" />
      {/* cinematic letterbox */}
      <rect className="nsp-bar t" x={0} y={0} width={800} height={60} fill="#000" />
      <rect className="nsp-bar b" x={0} y={540} width={800} height={60} fill="#000" />
    </g>
  );
}
/** "wait" until the screen is first displayed (e.g. the DMI SIM tab is opened — the page keeps it
    mounted but hidden), then "play" for SPLASH_MS, then "done" */
function useSplash(ref) {
  const [phase, setPhase] = useState("wait");
  useEffect(() => {
    if (phase !== "wait") return undefined;
    const shown = () => { const el = ref.current; return !!el && el.getClientRects().length > 0 && document.visibilityState === "visible"; };
    if (shown()) { setPhase("play"); return undefined; }
    const t = setInterval(() => { if (shown()) setPhase("play"); }, 200);
    return () => clearInterval(t);
  }, [phase, ref]);
  useEffect(() => {
    if (phase !== "play") return undefined;
    const t = setTimeout(() => setPhase("done"), SPLASH_MS);
    return () => clearTimeout(t);
  }, [phase]);
  return phase;
}

/** The LP-OCIP screen itself — always black, like the real panel. */
export function DmiScreen({ d, now }) {
  const { dmiSmooth } = useStore(appSettingsStore);
  const svgRef = useRef(null);
  const splash = useSplash(svgRef);                     // NOVA start-up screen first
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const date = new Date(now);
  const p2 = n => String(n).padStart(2, "0");
  const dateS = `${p2(date.getDate())}-${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][date.getMonth()]}-${date.getFullYear()}`;
  const timeS = `${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}`;
  const W = DMI_COL.WHT, G = DMI_COL.GRY;
  // displayed values glide between packets; colours / states follow the real values
  const sm = useSmoothValues({
    speed: d.speed, perm: d.permitted, stSpd: d.speedTarget?.speed ?? null, ma: d.ma,
    tgt: d.target?.dist ?? null, sig: d.sigDist, abs: d.abs,
  }, dmiSmooth === false ? 0 : 700, {
    tgt: d.target ? `${d.target.type}@${d.target.speed}` : "", stSpd: d.speedTarget?.speed ?? "",
    ma: d.refTag ?? "", sig: d.refTag ?? "",
  });
  const speed = sm.speed ?? 0;
  const perm = sm.perm;
  const braking = d.brake >= 2 && d.brake <= 4;
  const over = d.brake === 1 || (d.permitted != null && (d.speed ?? 0) > d.permitted + 0.5);
  const touch = !over && d.permitted != null && (d.speed ?? 0) >= d.permitted - 0.5 && (d.speed ?? 0) > 0;
  const ptrCol = braking ? DMI_COL.BRD : over ? DMI_COL.LOR : touch ? DMI_COL.YLW : W;
  const rot = i => (i.length ? i[Math.floor(now / 2000) % i.length] : "");   // alternate every 2 s (B4.7.3 e)
  const tgt = d.target ? { ...d.target, dist: sm.tgt ?? d.target.dist } : null;
  const st = d.speedTarget ? { ...d.speedTarget, speed: sm.stSpd ?? d.speedTarget.speed } : null;
  const ticks = DIAL_TICKS;
  const [px, py] = pt(speed, R_TICK - 4);
  const aN = ang(speed);                                                  // needle base, perpendicular to the needle
  const bx1 = CX + 6 * Math.cos(aN), by1 = CY + 6 * Math.sin(aN), bx2 = CX - 6 * Math.cos(aN), by2 = CY - 6 * Math.sin(aN);

  // MA bar
  const maS = d.ma == null ? null : sm.ma ?? d.ma;
  const maTop = maS == null ? null : maS > 3000 ? 45 : scaleY(C_MARKS, maS);

  return (
    <svg ref={svgRef} viewBox="0 0 800 600" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", background: DMI_COL.BLK, fontFamily: FONT }}>
      <rect x={0} y={0} width={800} height={600} fill={DMI_COL.BLK} />

      {/* ── Region A — target distance (92 × 388) ── */}
      <g>
        {tgt && <>
          <text x={46} y={22} textAnchor="middle" fontSize={18} fontWeight="bold" fill={W}>{tgt.type === "Turnout" ? "Turn Out" : tgt.type}</text>
          <text x={46} y={46} textAnchor="middle" fontSize={16} fill={W}>Target</text>
          <text x={46} y={66} textAnchor="middle" fontSize={16} fill={W}>Distance</text>
          {A_MARKS.map(([v, y]) => (
            <g key={v}>
              <line x1={45} y1={y} x2={75} y2={y} stroke={W} strokeWidth={1} />
              {[0, 250, 500, 1000, 2000].includes(v) && <text x={37} y={y + 5} textAnchor="end" fontSize={14} fill={W}>{v}</text>}
            </g>
          ))}
          <rect x={48} y={scaleY(A_MARKS, Math.min(tgt.dist, 2000))} width={24} height={337 - scaleY(A_MARKS, Math.min(tgt.dist, 2000))} fill={DMI_COL.LOR} />
          <text x={46} y={377} textAnchor="middle" fontSize={20} fontWeight="bold" fill={W}>{pad(tgt.dist, 4)} m</text>
        </>}
      </g>

      {/* ── Region B — speed and distance monitoring (365 × 388) ── */}
      <g>
        {d.hasLoco && <text x={100} y={27} fontSize={19} fontWeight="bold" fill={W}>{String(d.locoId).slice(0, 6)}</text>}
        <text x={450} y={24} textAnchor="end" fontSize={15} fontWeight="bold" fill={W}>{dateS}</text>
        <text x={450} y={44} textAnchor="end" fontSize={15} fontWeight="bold" fill={W}>{timeS}</text>

        {/* B3 — permitted / target / overspeed bands */}
        {perm != null && <>
          {st && st.speed < perm
            ? <><path d={band(0, st.speed, R_MID, R_OUT)} fill={DMI_COL.DGR} /><path d={band(st.speed, perm, R_MID, R_OUT)} fill={DMI_COL.LGR} /></>
            : <path d={band(0, perm, R_MID, R_OUT)} fill={DMI_COL.LGR} />}
          {/* tip at the permitted speed: red while any brake (NSB / FSB / EB) is applied, yellow on an overspeed warning */}
          <path d={band(Math.max(0, perm - 2.5), perm, R_IN, R_MID)}
            fill={braking ? DMI_COL.BRD : over ? DMI_COL.YLW : DMI_COL.LGR} />
          {(over || braking) && speed > perm && <path d={band(perm, speed, R_IN, R_OUT)} fill={braking ? DMI_COL.BRD : DMI_COL.LOR} />}
        </>}
        {perm == null && braking && <path d={band(0, speed, R_IN, R_OUT)} fill={DMI_COL.BRD} />}

        {/* B2 — dial */}
        {ticks}

        {/* B1 — pointer + speed */}
        {/* needle: a tapered triangle with a sharp tip at the speed (no round-capped line over it) */}
        <polygon points={`${px},${py} ${bx1},${by1} ${bx2},${by2}`} fill={ptrCol} />
        <circle cx={CX} cy={CY} r={26} fill={ptrCol === W ? W : ptrCol} />
        <text x={CX} y={CY + 7} textAnchor="middle" fontSize={21} fontWeight="bold" fill={DMI_COL.BLK}>{d.speed != null ? Math.round(speed) : "–"}</text>

        {/* B7 — next lower speed limit · B11 — section speed */}
        {st && <text x={146} y={336} textAnchor="end" fontSize={17} fontWeight="bold" fill={W}>{d.speedTarget.speed}</text>}
        {d.sectionSpeed != null && <text x={CX} y={334} textAnchor="middle" fontSize={19} fontWeight="bold" fill={W}>{d.sectionSpeed}</text>}

        {/* B8 — brake · B9 — location · B10 — mode */}
        <BrakeSymbol level={d.brake} x={100} y={346} />
        <text x={CX} y={372} textAnchor="middle" fontSize={19} fontWeight="bold" fill={W}>LOC : {d.abs != null ? ((sm.abs ?? d.abs) / 1000).toFixed(3) : "———.———"} km</text>
        {d.mode && <ModeSymbol k={d.mode.key} x={398} y={346} />}
      </g>

      {/* ── Region C — movement authority (112 × 388) ── */}
      <g transform="translate(457,0)">
        <text x={7} y={28} fontSize={16} fill={W}>Mov. Authority</text>
        {d.hasStn && <>
          <line x1={45} y1={45} x2={80} y2={45} stroke={W} />
          <text x={37} y={50} textAnchor="end" fontSize={14} fill={W}>+++</text>
          {C_MARKS.map(([v, y]) => (
            <g key={v}>
              <line x1={45} y1={y} x2={80} y2={y} stroke={W} strokeWidth={1} />
              {[0, 250, 500, 1000, 2000, 3000].includes(v) && <text x={37} y={y + 5} textAnchor="end" fontSize={14} fill={W}>{v}</text>}
            </g>
          ))}
          {maTop != null && maS > 0 && <rect x={48} y={maTop} width={29} height={342 - maTop} fill={DMI_COL.LBL} />}
          {/* C3 (B4.5.3): only the MA distance, 5 digits in metres. No MA distance given
              (MA_W_R_T_SIG = 65535 "unknown", or no position yet) → C3 stays blank. */}
          {maS != null && <text x={20} y={377} fontSize={19} fontWeight="bold" fill={W}>{`${pad(maS, 5)} m`}</text>}
        </>}
      </g>

      {/* ── Region D — signal (231 wide) ── */}
      <g>
        {d.lamps && <>
          {/* head: 70 × 220 with 45° corners (B4.6.4.2) */}
          <path d={`M${SIG_X + SIG_C},${SIG_Y} H${SIG_X + SIG_W - SIG_C} L${SIG_X + SIG_W},${SIG_Y + SIG_C} V${SIG_Y + SIG_H - SIG_C} L${SIG_X + SIG_W - SIG_C},${SIG_Y + SIG_H} H${SIG_X + SIG_C} L${SIG_X},${SIG_Y + SIG_H - SIG_C} V${SIG_Y + SIG_C} Z`}
            fill="none" stroke={DMI_COL.GRY} strokeWidth={2} />
          {[0, 1, 2, 3].map(i => {
            const on = d.lamps[i];
            const col = [DMI_COL.YLW, DMI_COL.GRN, DMI_COL.YLW, DMI_COL.BRD][i];
            // 44-unit lamps (outer edge of the 2-unit white ring), 12 from the top, 8 apart
            return <circle key={i} cx={SIG_CX} cy={SIG_Y + 12 + 22 + i * 52} r={21} fill={on ? col : DMI_COL.BLK} stroke={W} strokeWidth={2} />;
          })}
          {/* route indication (B4.6.4.1 e, Table B.4): junction route bar 1…6 beside the head,
              or the stencil indicator above it — from CUR_SIG_ASPECT 3…8 / 9, 32…63 (route 1…32 shown in it).
              Table B.4 places Stencil.bmp at X 660; the box is centred on the signal head (SIG_CX). */}
          {typeof d.routeInd === "number" && ROUTE_SYM[d.routeInd] && (() => {
            const [rx, ry, shape] = ROUTE_SYM[d.routeInd];
            return <path d={shape} fill={W} transform={`translate(${rx} ${ry})`} shapeRendering="crispEdges" />;
          })()}
          {d.routeInd === "stencil" && <g>
            <rect x={SIG_CX - 20} y={20} width={40} height={30} rx={3} fill={DMI_COL.BLK} stroke={W} strokeWidth={2} />
            {d.stencil ? <LcdDigits value={d.stencil} cx={SIG_CX} cy={35} h={20} color={W} off="#262626" />
              : [0, 1, 2, 3, 4].map(r => [0, 1, 2, 3, 4, 5, 6].map(c => <circle key={`${r}${c}`} cx={SIG_CX - 15 + c * 5} cy={25 + r * 5} r={1.1} fill={DMI_COL.LGY} />))}
          </g>}
          {/* post · marker circle (C / IB / G / A / AG — white with letter when active) · post */}
          <line x1={SIG_CX} y1={SIG_Y + SIG_H} x2={SIG_CX} y2={302} stroke={W} strokeWidth={2} />
          <circle cx={SIG_CX} cy={316} r={14} fill={d.marker ? W : DMI_COL.BLK} stroke={W} strokeWidth={2} />
          {d.marker && <text x={SIG_CX} y={321} textAnchor="middle" fontSize={d.marker.length > 1 ? 12 : 15} fontWeight="bold" fill={DMI_COL.BLK}>{d.marker}</text>}
          <line x1={SIG_CX} y1={330} x2={SIG_CX} y2={346} stroke={W} strokeWidth={2} />
        </>}
        {d.sigDist != null && d.lamps && <text x={680} y={372} textAnchor="middle" fontSize={20} fontWeight="bold" fill={W}>{pad(sm.sig ?? d.sigDist, 4)} m</text>}
      </g>

      {/* ── row: E (DC) · F (TL) · G (mode) · D3 ── */}
      <g>
        <text x={14} y={418} fontSize={18} fill={W}>DC –.––</text>
        <text x={171} y={418} fontSize={18} fill={W}>{d.trainLen != null ? `TL ${d.trainLen} m` : "TL"}</text>
        <text x={323} y={418} fontSize={18} fill={W}>{d.mode?.text || ""}</text>
        {/* D3: name of the approaching signal post + line — only with a displayed signal (as D2) */}
        {d.lamps && d.d3 && <text x={684} y={409} textAnchor="middle" fontSize={16} fontWeight="bold" fill={DMI_COL.ORG}>{d.d3}</text>}
      </g>

      {/* ── H — system messages · I — context messages ── */}
      <text x={10} y={477} fontSize={21} fontWeight="bold" fill={W}>{rot(d.H)}</text>
      <text x={10} y={533} fontSize={20} fontWeight="bold" fill={W}>{rot(d.I)}</text>

      {/* ── J — radio · L — tag ── */}
      <g>
        {d.radioHole ? <>
          <line x1={583} y1={430} x2={611} y2={470} stroke={DMI_COL.BRD} strokeWidth={4} />
          <line x1={611} y1={430} x2={583} y2={470} stroke={DMI_COL.BRD} strokeWidth={4} />
          <text x={620} y={458} fontSize={14} fontWeight="bold" fill={DMI_COL.BRD}>RADIO HOLE</text>
        </> : <>
          {/* J2 "RF" · J1 antenna: mast + top bar + two straight arms meeting the mast and the bar ends */}
          <text x={576} y={469} fontSize={17} fontWeight="bold" fill={DMI_COL.GRY}>RF</text>
          <g stroke={DMI_COL.GRY} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <line x1={610} y1={432} x2={610} y2={471} strokeWidth={3.5} />
            <line x1={596} y1={432} x2={624} y2={432} strokeWidth={2.5} />
            <path d="M610,450 L596,432 M610,450 L624,432" strokeWidth={2.5} />
          </g>
          {/* J3 signal strength: 5 bars, bottoms aligned with the mast; lit = station packets in the last 5 cycles */}
          {[0, 1, 2, 3, 4].filter(i => i < d.rf).map(i => {
            const h = 13 + i * 6.5;
            return <rect key={i} x={629 + i * 13} y={471 - h} width={6} height={h} rx={1} fill={W} />;
          })}
        </>}
        <text x={578} y={505} fontSize={15} fill={W}>{d.lastTag != null ? `Tid-${d.lastTag},` : "Tid-—,"}  Dir-{d.dirN || "—"}</text>
        <text x={578} y={528} fontSize={15} fill={W}>{d.nextTag ? `T Dist-${Math.round(d.nextTag.dist)}` : "T Dist-—"}</text>
      </g>

      {/* ── M — tag read status (Annexure-B B4.10.1): tags laid on a track, M1 = last tag on top,
             M2 last-to-last, M3 below. DGR = read · BRD = expected tag missed · GRY = none yet ── */}
      <g>
        <text x={751} y={437} textAnchor="middle" fontSize={14} fill={W}>Tag</text>
        {[[446.7, 713, 787], [460.7, 716.4, 783.8], [474.8, 719, 781], [488.6, 722, 778], [502.7, 725.6, 775], [516.7, 728.3, 771.6], [530.5, 731.6, 768.9]]
          .map(([y, x1, x2]) => <line key={y} x1={x1} y1={y} x2={x2} y2={y} stroke={DMI_COL.LGY} strokeWidth={1} />)}
        <line x1={721.8} y1={430} x2={742.3} y2={541} stroke={W} strokeWidth={0.8} />
        <line x1={777.2} y1={430} x2={759.8} y2={541} stroke={W} strokeWidth={0.8} />
        {[[732.1, 469.6, 36, 10.1], [738.5, 497.9, 23.5, 9.5], [741.2, 525.1, 17.8, 10.1]].map(([x0, y0, w, h], i) => {
          const t = d.tags[i];
          const col = !t ? DMI_COL.GRY : t.status === "read" ? DMI_COL.DGR : DMI_COL.BRD;
          return (
            <rect key={i} x={x0} y={y0} width={w} height={h} rx={3} fill={col} style={{ transition: "fill .3s" }}>
              {t && <title>{`M${i + 1}: RFID #${t.id} — ${t.status === "read" ? "read" : "MISSED (expected from the tag list, not reported by the loco)"}`}</title>}
            </rect>
          );
        })}
      </g>

      {/* ── grid / borders (GRY, 1 unit) ── */}
      <g stroke={G} strokeWidth={1} fill="none">
        <rect x={0.5} y={0.5} width={799} height={599} />
        <line x1={92} y1={0} x2={92} y2={388} /><line x1={457} y1={0} x2={457} y2={388} /><line x1={569} y1={0} x2={569} y2={548} />
        <line x1={0} y1={388} x2={569} y2={388} />
        <line x1={157} y1={388} x2={157} y2={433} /><line x1={309} y1={388} x2={309} y2={433} />
        <line x1={0} y1={433} x2={569} y2={433} /><line x1={0} y1={502} x2={569} y2={502} /><line x1={0} y1={548} x2={800} y2={548} />
        <line x1={569} y1={419} x2={800} y2={419} /><line x1={702} y1={419} x2={702} y2={548} /><line x1={569} y1={481} x2={702} y2={481} />
      </g>

      {/* ── K — display keys (labels only) ── */}
      {["P_TRP", "REV", "OVRD", "SHNT", "MBT", "SR", "CONFIG", "", "CNFM", "INFO"].map((k, i) => (
        <g key={i}>
          <rect x={2 + i * 79.6} y={554} width={76} height={42} fill="#0f1a33" stroke={G} />
          <text x={2 + i * 79.6 + 38} y={581} textAnchor="middle" fontSize={16} fontWeight="bold" fill={W}>{k}</text>
        </g>
      ))}

      {/* no data yet */}
      {!d.hasLoco && !d.hasStn && (
        <text x={10} y={477} fontSize={20} fill={DMI_COL.LGY}>Waiting for radio packets…</text>
      )}

      {/* NOVA start-up splash on top (black until the screen is visible, then 5 s) */}
      {splash === "wait" && <rect x={0} y={0} width={800} height={600} fill={DMI_COL.BLK} />}
      {splash === "play" && <NovaSplash uid={uid} />}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VIEW — loco selector · DMI · decoded inputs · packet log
═══════════════════════════════════════════════════════════════ */
const ageTxt = ms => (ms == null ? "—" : ms < 1500 ? "now" : ms < 60000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60000)} min ago`);

const DV_CSS = `
.dv-grid { flex: 1; display: grid; grid-template-columns: minmax(250px, 300px) minmax(0, 1fr) minmax(280px, 340px); grid-template-rows: minmax(0, 1fr); min-height: 0; overflow: hidden; }
/* side columns fit the screen height — no scrolling: two flexible cards (RFID tags / packets) take what is left */
.dv-side { display: flex; flex-direction: column; gap: 7px; padding: 8px; overflow: hidden; min-height: 0; background: var(--bg-surface); }
.dv-left  { border-right: 1px solid var(--border); }
.dv-right { border-left: 1px solid var(--border); }
.dv-right .dv-locoside { display: none; }
@media (max-width: 1380px) {
  .dv-grid { grid-template-columns: minmax(0, 1fr) minmax(290px, 330px); }
  .dv-left { display: none; }
  .dv-right { overflow-y: auto; }                       /* narrow screens: both columns in one — this one may scroll */
  .dv-right .dv-locoside { display: flex; flex-direction: column; gap: 7px; }
  .dv-right .dv-fill { flex: 0 0 auto; min-height: 150px; }
}
.dv-center { min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 12px;
  background: radial-gradient(ellipse at 50% 40%, rgba(34,211,238,.07), transparent 65%), var(--dv-stage); }

@keyframes dvIn     { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes dvFlash  { 0% { color: var(--cyan); text-shadow: 0 0 12px rgba(34,211,238,.7); } 100% { text-shadow: none; } }
@keyframes dvPulse  { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes dvAlarm  { 0%, 100% { box-shadow: inset 0 0 0 1px rgba(239,68,68,.25); } 50% { box-shadow: inset 0 0 0 2px rgba(239,68,68,.6), 0 0 18px rgba(239,68,68,.3); } }
@keyframes dvCalm   { 0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } 50% { box-shadow: 0 0 0 3px rgba(34,197,94,.18); } }
@keyframes dvGlow   { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
@keyframes dvRowIn  { from { opacity: 0; transform: translateX(-10px); background: rgba(34,211,238,.18); } to { opacity: 1; transform: none; } }
@keyframes dvPop    { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
@keyframes dvSweep  { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
@keyframes dvScan   { from { background-position: -60% 0; } to { background-position: 160% 0; } }
@keyframes dvStripe { from { background-position: 0 0; } to { background-position: 24px 0; } }
@keyframes dvRf     { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
@keyframes dvFlip   { from { transform: rotateX(90deg); } to { transform: none; } }

.dv-card { position: relative; flex-shrink: 0; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-raised); overflow: hidden;
  animation: dvIn .5s cubic-bezier(.2,.7,.2,1) both; transition: border-color .3s, box-shadow .3s; }
.dv-card:hover { border-color: var(--border-bright); box-shadow: 0 8px 22px rgba(0,0,0,.22); }
.dv-card::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.dv-card.alarm { border-color: rgba(239,68,68,.6); }
.dv-card.alarm::before { animation: dvAlarm 1.3s ease-in-out infinite; }
.dv-card.calm::before { animation: dvCalm 3.2s ease-in-out infinite; }
.dv-fill { flex: 1 1 0; min-height: 90px; display: flex; flex-direction: column; }
.dv-card-h { position: relative; display: flex; align-items: center; gap: 7px; padding: 5px 10px; border-bottom: 1px solid var(--border);
  font: 700 9px var(--font-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--text-secondary);
  background: linear-gradient(180deg, rgba(255,255,255,.025), transparent); flex-shrink: 0; }
/* a soft light runs along every card header */
.dv-card-h::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; pointer-events: none;
  background: linear-gradient(90deg, transparent, var(--dv-acc, rgba(34,211,238,.75)), transparent) no-repeat; background-size: 40% 100%;
  animation: dvScan 4.5s linear infinite; }
.dv-card-h .dv-ico { width: 17px; height: 17px; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px;
  background: var(--bg-surface); border: 1px solid var(--border); }
.dv-card-h .dv-right-x { margin-left: auto; font-weight: 600; letter-spacing: .04em; text-transform: none; color: var(--text-muted); }
.dv-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border); }
.dv-tiles.three { grid-template-columns: 1fr 1fr 1fr; }
.dv-tile { background: var(--bg-raised); padding: 5px 10px; min-width: 0; transition: background .3s; }
.dv-tile:hover { background: var(--bg-surface); }
.dv-tile.wide { grid-column: span 2; }
.dv-l { font: 600 8px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dv-v { font: 800 15px var(--font-mono); color: var(--text-primary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color .4s; }
.dv-v small { font-size: 9.5px; font-weight: 600; color: var(--text-secondary); margin-left: 3px; }
.dv-v.big { font-size: 24px; line-height: 1.05; }
.dv-v.wrap { font-size: 11.5px; white-space: normal; line-height: 1.25; }
.dv-flash { animation: dvFlash .9s ease-out; }
.dv-live { animation: dvPulse 1.4s ease-in-out infinite; }
.dv-bar { position: relative; height: 6px; border-radius: 3px; background: var(--bg-surface); overflow: hidden; border: 1px solid var(--border); }
.dv-bar > i { position: absolute; inset: 0 auto 0 0; border-radius: 3px; transition: width .6s cubic-bezier(.2,.7,.2,1), background .4s; }
.dv-bar.moving > i::after { content: ""; position: absolute; inset: 0; border-radius: inherit;
  background: repeating-linear-gradient(-45deg, rgba(255,255,255,.28) 0 6px, transparent 6px 12px); background-size: 24px 100%; animation: dvStripe .7s linear infinite; }
.dv-bar.sweep::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.25), transparent); animation: dvSweep 2.4s linear infinite; }
.dv-pad { padding: 5px 10px 6px; border-top: 1px solid var(--border); }
.dv-rows > div { display: grid; grid-template-columns: 76px 1fr; gap: 6px; padding: 3px 10px; font: 9.5px var(--font-mono); border-top: 1px solid var(--border); }
.dv-rows > div:first-child { border-top: none; }
.dv-rows .k { color: var(--text-muted); }
.dv-rows .v { color: var(--text-primary); overflow-wrap: anywhere; }
.dv-chips { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 5px; padding: 6px 10px; border-top: 1px solid var(--border); overflow: hidden; flex: 1 1 auto; min-height: 0; }
.dv-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 10px; font: 700 9.5px var(--font-mono);
  border: 1px solid var(--border-bright); color: var(--text-secondary); background: var(--bg-surface); white-space: nowrap; animation: dvPop .35s cubic-bezier(.2,.9,.3,1.3) both; }
.dv-msg { padding: 3px 10px; font: 600 9.5px var(--font-mono); border-top: 1px solid var(--border); animation: dvIn .4s both; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dv-msg:first-child { border-top: none; }
.dv-log-list { flex: 1; overflow: hidden; min-height: 0; }
.dv-log-list > div { display: grid; grid-template-columns: 46px 58px 46px 1fr; gap: 4px; padding: 3px 10px; font: 9.5px var(--font-mono); border-bottom: 1px solid var(--border); }
.dv-log-list > div:first-child { animation: dvRowIn .55s ease-out; }
.dv-bits { display: flex; gap: 2px; padding: 6px 10px 4px; perspective: 200px; }
.dv-bits span { width: 12px; height: 16px; display: inline-flex; align-items: center; justify-content: center; border-radius: 3px; font: 700 9.5px var(--font-mono);
  color: var(--text-muted); background: var(--bg-surface); border: 1px solid var(--border); animation: dvFlip .45s ease-out both; }
.dv-bits span.one { color: var(--cyan); border-color: rgba(34,211,238,.45); background: rgba(34,211,238,.12); }
.dv-bits i { width: 5px; }
.dv-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border); border-top: 1px solid var(--border); }
.dv-grid2 > div { background: var(--bg-raised); padding: 3px 10px; font: 9.5px var(--font-mono); min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dv-grid2 .k { display: block; font-size: 7.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted); }
.dv-rf-on { animation: dvRf 1.6s ease-in-out infinite; }
.dv-sig-lamp { transition: fill .35s; }
.dv-sig-glow { animation: dvGlow 1.8s ease-in-out infinite; }
.dv-route { animation: dvPop .4s both; transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: reduce) {
  .dv-card, .dv-card::before, .dv-card-h::after, .dv-chip, .dv-msg, .dv-log-list > div:first-child, .dv-flash, .dv-live, .dv-sig-glow, .dv-route,
  .dv-bar.sweep::after, .dv-bar.moving > i::after, .dv-bits span, .dv-rf-on { animation: none !important; }
}
`;
const DEST_SOS_TXT = { 0: "None", 1: "Foreign RFID", 3: "Odo error ≥ 120 m", 4: "SPAD detected", 5: "Rear-end collision", 6: "Head-on collision", 7: "Shunting limits exceeded", 8: "Station General SoS" };
const EMG_TXT = { 1: "Unusual stoppage", 2: "SoS", 3: "Roll back", 4: "Head-on", 5: "Rear-end", 6: "Parting SoS" };
const LAMP_COL = [DMI_COL.YLW, DMI_COL.GRN, DMI_COL.YLW, DMI_COL.BRD];
const MARKER_TXT = { C: "Calling-on", IB: "IB signal", G: "Gate signal", A: "Automatic", AG: "Auto Gate" };
/* route bars on the dashboard signal (viewBox 150 × 214): centre x, y, angle — mirrors Annexure-B Table B.4 */
const DV_ROUTE = { 1: [31, 40, 45], 2: [28, 62, 0], 3: [31, 84, -45], 4: [119, 40, -45], 5: [122, 62, 0], 6: [119, 84, 45] };

function DvCard({ icon, title, right, accent, children, className = "", delay = 0 }) {
  return (
    <div className={"dv-card " + className} style={{ ...(accent ? { borderTop: `2px solid ${accent}`, "--dv-acc": accent } : null), animationDelay: `${delay}ms` }}>
      <div className="dv-card-h"><span className="dv-ico">{icon}</span>{title}{right != null && <span className="dv-right-x">{right}</span>}</div>
      {children}
    </div>
  );
}
/* flash: a discrete value — its text briefly lights up when it changes */
function DvTile({ label, value, unit, color, src, big, wide, wrap, flash }) {
  return (
    <div className={"dv-tile" + (wide ? " wide" : "")} title={src || ""}>
      <div className="dv-l">{label}</div>
      <div className={"dv-v" + (big ? " big" : "") + (wrap ? " wrap" : "")} style={color ? { color } : undefined}>
        <span key={flash ? String(value) : "v"} className={flash ? "dv-flash" : undefined}>{value}</span>{unit && value !== "—" ? <small>{unit}</small> : null}
      </div>
    </div>
  );
}

/* the approaching signal as a post: route indication, head with 4 lamps, post, marker circle, post to ground */
function DvSignal({ d }) {
  const on = !!d.lamps;
  const head = on ? "#c9ced8" : "#4b5160";
  return (
    <svg viewBox="0 0 150 214" width="100" height="143" style={{ flexShrink: 0, overflow: "visible" }} aria-label={on ? `Signal ${d.aspectName}` : "No signal"}>
      <defs>
        {LAMP_COL.map((c, i) => (
          <radialGradient key={i} id={`dvl${i}`} cx="40%" cy="35%" r="70%"><stop offset="0%" stopColor="#fff" stopOpacity=".85" /><stop offset="35%" stopColor={c} /><stop offset="100%" stopColor={c} stopOpacity=".85" /></radialGradient>
        ))}
      </defs>
      {/* route indication: junction bar 1…6 or stencil (rotation on the group — a CSS animation transform would override it) */}
      {on && typeof d.routeInd === "number" && DV_ROUTE[d.routeInd] && (() => {
        const [x, y, a] = DV_ROUTE[d.routeInd];
        return <g key={d.routeInd} transform={`rotate(${a} ${x} ${y})`}><rect className="dv-route" x={x - 15} y={y - 4} width={30} height={8} rx={4} fill="#f8fafc" style={{ filter: "drop-shadow(0 0 4px rgba(255,255,255,.6))" }} /></g>;
      })()}
      {on && d.routeInd === "stencil" && <g className="dv-route">
        <rect x={56} y={2} width={38} height={22} rx={3} fill="#05070b" stroke="#f8fafc" strokeWidth={1.6} />
        {d.stencil ? <LcdDigits value={d.stencil} cx={75} cy={13} h={14} color="#f8fafc" off="#1c2230" />
          : [0, 1, 2, 3].map(r => [0, 1, 2, 3, 4, 5].map(c => <circle key={`${r}${c}`} cx={62 + c * 5.2} cy={7 + r * 4.4} r={1} fill="#94a3b8" />))}
      </g>}
      <path d="M62,28 H88 L100,40 V148 L88,160 H62 L50,148 V40 Z" fill="#0b0d12" stroke={head} strokeWidth={2} />
      {[0, 1, 2, 3].map(i => {
        const lit = on && d.lamps[i];
        const cy = 50 + i * 30;
        return (
          <g key={i}>
            {lit && <circle className="dv-sig-glow" cx={75} cy={cy} r={17} fill={LAMP_COL[i]} opacity={.35} style={{ filter: "blur(4px)" }} />}
            <circle className="dv-sig-lamp" cx={75} cy={cy} r={11} fill={lit ? `url(#dvl${i})` : "#151821"} stroke={on ? "#e5e7eb" : "#3a3f4b"} strokeWidth={1.6} />
          </g>
        );
      })}
      <line x1={75} y1={160} x2={75} y2={170} stroke={head} strokeWidth={2} />
      <circle cx={75} cy={181} r={11} fill={on && d.marker ? "#f8fafc" : "#0b0d12"} stroke={head} strokeWidth={1.8}
        style={on && d.marker ? { filter: "drop-shadow(0 0 5px rgba(255,255,255,.7))", transition: "fill .3s" } : { transition: "fill .3s" }} />
      {on && d.marker && <text x={75} y={185.5} textAnchor="middle" fontSize={d.marker.length > 1 ? 9.5 : 12} fontWeight="800" fill="#05070b" fontFamily="Helvetica, Arial, sans-serif">{d.marker}</text>}
      <line x1={75} y1={192} x2={75} y2={210} stroke={head} strokeWidth={2} />
      <line x1={60} y1={210} x2={90} y2={210} stroke={head} strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}

export default function DmiView({ livePackets, wsState, isLight }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const ids = useMemo(() => dmiLocoIds(livePackets), [livePackets]);
  const [sel, setSel] = useState(null);
  const [follow, setFollow] = useState(true);
  const locoId = follow ? ids[0] ?? null : (ids.includes(sel) ? sel : ids[0] ?? null);
  const { tags } = useStore(tagTableStore);
  const { dmiTagMissM, dmiSmooth } = useStore(appSettingsStore);
  const tagLoc = useMemo(() => Object.fromEntries((tags || []).map(t => [t.id, t.loc])), [tags]);
  const d = useMemo(() => buildDmi(livePackets, locoId, now, tagLoc, { tagMissM: dmiTagMissM }), [livePackets, locoId, now, tagLoc, dmiTagMissM]);

  // dashboard numbers glide between packets like the DMI (⚙ Settings → LIVE → Smooth value changes)
  const sv = useSmoothValues({
    speed: d.speed, perm: d.permitted, ma: d.ma, tgt: d.target?.dist ?? null, sig: d.sigDist,
    abs: d.abs, next: d.nextTag?.dist ?? null,
  }, dmiSmooth === false ? 0 : 700, { tgt: d.target ? `${d.target.type}@${d.target.speed}` : "", next: d.nextTag?.id ?? "", ma: d.refTag ?? "", sig: d.refTag ?? "" });
  const rnd = (v, fb = "—") => (v == null ? fb : Math.round(v));

  const log = useMemo(() => livePackets.filter(p => {
    const t = ptype(p), m = fieldMap(p);
    return ((t === 10 || t === 13) && m.SOURCE_LOCO_ID === locoId) || (t === 9 && (m.DEST_LOCO_ID === locoId || m.DEST_LOCO_ID === 0))
      || (t === 11 && m.DEST_LOCO_ID === locoId) || t === 12;
  }).slice(-60).reverse(), [livePackets, locoId]);

  // DMI frame: the largest 4:3 box that fits the centre column (no letterbox bands)
  const stageRef = useRef(null);
  const [box, setBox] = useState(null);
  useEffect(() => {
    const el = stageRef.current; if (!el) return undefined;
    const fit = () => { const w = el.clientWidth - 24, h = el.clientHeight - 24; if (w > 0 && h > 0) setBox(w / h > 4 / 3 ? { w: h * 4 / 3, h } : { w, h: w * 3 / 4 }); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, []);

  const mono = { fontFamily: "var(--font-mono)" };
  const stale = d.ageLoco != null && d.ageLoco > 10000;
  const dash = v => (v == null ? "—" : v);
  const braking = d.brake >= 2 && d.brake <= 4;
  const overspeed = d.brake === 1 || (d.permitted != null && d.speed > d.permitted + 0.5);
  const spdCol = braking ? "var(--red)" : overspeed ? "var(--amber)" : "var(--text-primary)";
  const dirTxt = d.dirN === "N" ? "Nominal (DOWN)" : d.dirN === "R" ? "Reverse (UP)" : "—";
  const live = !stale && d.hasLoco;
  const alarm = braking || !!d.emg || !!(d.destSos && d.destSos !== 0);
  const spdPct = d.permitted ? Math.min(100, ((sv.speed ?? 0) / Math.max(d.permitted, 1)) * 100) : 0;
  const msgs = [...new Set([...d.H, ...d.I])];
  const tagOcc = {};
  // next tag: progress over the distance first seen for this next tag (the bar fills as the loco runs towards it)
  const gapRef = useRef({ id: null, max: 0 });
  if (d.nextTag) {
    if (gapRef.current.id !== d.nextTag.id) gapRef.current = { id: d.nextTag.id, max: d.nextTag.dist };
    else gapRef.current.max = Math.max(gapRef.current.max, d.nextTag.dist);
  }
  const nextPct = d.nextTag && sv.next != null && gapRef.current.max > 0 ? Math.max(0, Math.min(100, 100 - (sv.next / gapRef.current.max) * 100)) : null;

  /* ── loco-side cards (left column; repeated in the right column on narrow screens) ── */
  const locoCards = (
    <>
      <DvCard icon="🚆" title="Loco" accent="var(--cyan)" delay={0}
        right={<span style={{ color: live ? "var(--green)" : stale ? "var(--red)" : "var(--text-muted)" }}>{live && <span className="dv-live">● </span>}{ageTxt(d.ageLoco)}</span>}>
        <div style={{ padding: "6px 10px 7px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ ...mono, fontSize: 22, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }} title={d.src.speed || ""}>#{dash(locoId)}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            <span key={d.mode?.key || "-"} className="dv-chip" title={d.mode?.text || ""}>{d.mode ? `${d.mode.key} · ${d.mode.text}` : "Mode —"}</span>
            <span key={dirTxt} className="dv-chip" title={d.src.dir || ""}>⇄ {dirTxt}</span>
          </div>
        </div>
      </DvCard>

      <DvCard icon="◔" title="Motion" delay={60} accent={braking ? "var(--red)" : overspeed ? "var(--amber)" : "var(--green)"}>
        <div className="dv-tiles">
          <DvTile label="Speed" value={rnd(sv.speed)} unit="kmph" color={spdCol} big src={d.src.speed} />
          <DvTile label="Permitted" value={rnd(sv.perm)} unit="kmph" color="var(--green)" big src={d.src.ssp} />
        </div>
        <div className="dv-pad" title="speed against the permitted speed">
          <div className={"dv-bar" + ((d.speed ?? 0) > 0 ? " moving" : "")}><i style={{ width: `${spdPct}%`, background: braking ? "var(--red)" : overspeed ? "var(--amber)" : "linear-gradient(90deg,#16a34a,#84cc16)" }} /></div>
        </div>
        <div className="dv-tiles" style={{ borderTop: "1px solid var(--border)" }}>
          <DvTile label="Section speed" value={dash(d.sectionSpeed)} unit="kmph" src={d.src.ssp} flash />
          <DvTile label="Next limit (B7)" value={d.speedTarget ? d.speedTarget.speed : "—"} unit="kmph" src={d.src.target} flash />
          <DvTile label="Location" value={sv.abs != null ? (sv.abs / 1000).toFixed(3) : "—"} unit="km" src={d.src.loc} />
          <DvTile label="Train length" value={dash(d.trainLen)} unit="m" src={d.src.tl} />
        </div>
      </DvCard>

      <DvCard icon="⚠" title="Safety" className={alarm ? "alarm" : "calm"} delay={120} accent={alarm ? "var(--red)" : d.brake === 1 ? "var(--amber)" : "var(--green)"}>
        <div className="dv-tiles three">
          <DvTile label="Brake" value={BRAKE_TXT[d.brake] || "None"} color={braking ? "var(--red)" : d.brake === 1 ? "var(--amber)" : "var(--green)"} src={d.src.brake} wrap flash />
          <DvTile label="Emergency" value={d.emg ? EMG_TXT[d.emg] || d.emg : "None"} color={d.emg ? "var(--red)" : "var(--green)"} src={d.src.emg} wrap flash />
          <DvTile label="Station SoS" value={DEST_SOS_TXT[d.destSos] ?? d.destSos} color={d.destSos ? "var(--red)" : "var(--green)"} src={`DEST_LOCO_SOS · ${d.src.sig || ""}`} wrap flash />
        </div>
        {msgs.length > 0 && <div style={{ borderTop: "1px solid var(--border)" }}>
          {msgs.slice(0, 2).map(t => <div key={t} className="dv-msg" title={t} style={{ color: /Brake|SOS|SoS|Collision|Trip/i.test(t) ? "var(--red)" : "var(--amber)" }}>▸ {t}</div>)}
          {msgs.length > 2 && <div className="dv-msg" style={{ color: "var(--text-muted)" }}>+{msgs.length - 2} more on the DMI</div>}
        </div>}
      </DvCard>

      <DvCard icon="🏷" title="RFID tags" right={d.tagEvents.length ? "latest first" : null} delay={180} className="dv-fill" accent="var(--green)">
        <div className="dv-tiles">
          <DvTile label="Last tag" value={dash(d.lastTag)} src={d.src.tag} flash />
          <DvTile label={d.nextTag ? `Next #${d.nextTag.id}` : "Next tag"} value={rnd(sv.next)} unit="m" src={d.src.ssp} />
        </div>
        {nextPct != null && <div className="dv-pad" title="run towards the next tag"><div className="dv-bar sweep"><i style={{ width: `${nextPct}%`, background: "linear-gradient(90deg,#15803d,#4ade80)" }} /></div></div>}
        <div className="dv-chips">
          {d.tagEvents.length ? [...d.tagEvents].reverse().map(t => {
            const k = `${t.id}${t.status}`; tagOcc[k] = (tagOcc[k] || 0) + 1;
            return (
              <span key={`${k}#${tagOcc[k]}`} className="dv-chip" title={t.status === "read" ? "read by the loco" : "MISSED — expected from the C.4.2 tag list, not reported"}
                style={{ borderColor: t.status === "read" ? "var(--green)" : "var(--red)", color: t.status === "read" ? "var(--green)" : "var(--red)" }}>
                {t.status === "read" ? "✓" : "✗"} {t.id}
              </span>
            );
          }) : <span style={{ ...mono, fontSize: 9.5, color: "var(--text-muted)" }}>no tags read yet</span>}
        </div>
        <div className="dv-rows" style={{ borderTop: "1px solid var(--border)" }}>
          <div title={d.offsetHow || ""}><span className="k">Position</span><span className="v" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.offsetHow || "—"}</span></div>
        </div>
      </DvCard>
    </>
  );

  const sigBits = d.sigInfo != null ? d.sigInfo.toString(2).padStart(17, "0") : null;
  const maPct = d.maRaw > 0 && d.maRaw !== 65535 && sv.ma != null ? Math.max(0, Math.min(100, (sv.ma / d.maRaw) * 100)) : null;
  const litCol = d.lamps ? LAMP_COL[d.lamps.findIndex(Boolean)] : null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, "--dv-stage": isLight ? "#e8ebf2" : "#050507" }}>
      <style>{DV_CSS}</style>
      {/* loco selector */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", flexWrap: "wrap" }}>
        <span style={{ ...mono, fontSize: 9, color: "var(--text-muted)", letterSpacing: ".1em" }}>🚆 LOCO</span>
        <button onClick={() => setFollow(true)} title="Always show the loco that sent the latest packet" style={{
          ...mono, fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 5, cursor: "pointer", transition: "all .2s",
          border: `1.5px solid ${follow ? "var(--cyan)" : "var(--border)"}`, background: follow ? "var(--cyan-glow)" : "var(--bg-raised)", color: follow ? "var(--cyan)" : "var(--text-muted)" }}>AUTO</button>
        {ids.length === 0 && <span style={{ ...mono, fontSize: 10, color: "var(--text-muted)" }}>waiting for C.4.3 / C.4.6 loco packets…</span>}
        {ids.map(id => {
          const on = !follow && id === locoId;
          return (
            <button key={id} onClick={() => { setSel(id); setFollow(false); }} style={{
              ...mono, fontSize: 10, fontWeight: 700, padding: "3px 12px", borderRadius: 5, cursor: "pointer", transition: "all .2s",
              border: `1.5px solid ${on ? "var(--green)" : id === locoId ? "var(--border-bright)" : "var(--border)"}`,
              background: on ? "var(--green-glow)" : "var(--bg-raised)", color: on || id === locoId ? "var(--green)" : "var(--text-muted)" }}>#{id}</button>
          );
        })}
        <span style={{ marginLeft: "auto", ...mono, fontSize: 9, color: stale ? "var(--red)" : "var(--text-muted)" }}>
          loco data {ageTxt(d.ageLoco)} · station data {ageTxt(d.ageStn)}{stale ? " · ⚠ NO RECENT LOCO PACKET" : ""}
        </span>
      </div>

      <div className="dv-grid">
        {/* ── LEFT: loco side (C.4.3 / C.4.6) ── */}
        <aside className="dv-side dv-left">{locoCards}</aside>

        {/* ── CENTRE: the LP-OCIP screen, 4:3, as large as the space allows ── */}
        <main className="dv-center" ref={stageRef}>
          <div style={{ width: box ? box.w : "100%", height: box ? box.h : "auto", aspectRatio: "4 / 3", boxSizing: "border-box", border: "6px solid #2b2f3a", borderRadius: 10,
            boxShadow: "0 12px 38px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04)", overflow: "hidden", opacity: stale ? 0.75 : 1, transition: "opacity .5s" }}>
            <DmiScreen d={d} now={now} />
          </div>
        </main>

        {/* ── RIGHT: track side (C.4.2) + packets ── */}
        <aside className="dv-side dv-right">
          <div className="dv-locoside">{locoCards}</div>

          <DvCard icon="🚦" title="Signal" right={d.stnId != null ? `Stn #${d.stnId}` : null} delay={0} accent={litCol || "var(--border-bright)"}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px 5px 4px" }} title={d.src.sig || ""}>
              <DvSignal d={d} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div key={d.aspectName} className="dv-flash" style={{ ...mono, fontSize: 14, fontWeight: 800, color: litCol || "var(--text-primary)", lineHeight: 1.2 }}>
                  {d.lamps ? d.aspectName : "No signal"}
                </div>
                <div style={{ ...mono, fontSize: 10, color: "var(--amber)", marginTop: 2 }}>{d.lamps && d.d3 ? d.d3 : "—"}</div>
                <div style={{ ...mono, fontSize: 10, color: "var(--text-secondary)", marginTop: 4 }}>
                  in <b style={{ fontSize: 19, color: "var(--text-primary)" }}>{d.lamps ? rnd(sv.sig) : "—"}</b> m
                </div>
                <div className="dv-rows" style={{ marginTop: 4, marginLeft: -10 }}>
                  <div><span className="k">Marker</span><span className="v">{d.lamps && d.marker ? `${d.marker} · ${MARKER_TXT[d.marker] || ""}` : "—"}</span></div>
                  <div><span className="k">Route</span><span className="v">{d.lamps && d.routeInd ? (d.routeInd === "stencil" ? (d.stencil ? `Stencil · route ${d.stencil}` : "Stencil") : `Junction · pos ${d.routeInd}`) : "—"}</span></div>
                  <div><span className="k">Next signal</span><span className="v">{d.nextAspectName || "—"}</span></div>
                </div>
              </div>
            </div>
          </DvCard>

          <DvCard icon="▮" title="Movement authority" accent="var(--cyan)" delay={60} right={d.refTag > 0 ? `ref RFID #${d.refTag}` : null}>
            <div className="dv-tiles">
              <DvTile label="Remaining MA" value={rnd(sv.ma)} unit="m" color="var(--cyan)" big src={d.src.ma} />
              <DvTile label="MA (packet)" value={d.maRaw == null ? "—" : d.maRaw === 65535 ? "65535 · unknown" : d.maRaw} unit={d.maRaw === 65535 ? "" : "m"} src={d.src.ma} flash />
            </div>
            {maPct != null && (
              <div className="dv-pad" title="remaining MA of the MA in the packet">
                <div className="dv-bar sweep"><i style={{ width: `${maPct}%`, background: "linear-gradient(90deg,#0284c7,#22d3ee)" }} /></div>
              </div>
            )}
            <div className="dv-tiles" style={{ borderTop: "1px solid var(--border)" }}>
              <DvTile label={d.target ? `Target · ${d.target.type === "Turnout" ? "Turn Out" : d.target.type}` : "Target"} value={rnd(sv.tgt)} unit="m"
                color={d.target && (d.target.type === "Collision" || d.target.type === "SoS") ? "var(--red)" : "var(--amber)"} src={d.src.target} />
              <DvTile label="Target speed" value={d.target ? d.target.speed : "—"} unit="kmph" src={d.src.target} flash />
            </div>
          </DvCard>

          <DvCard icon="◈" title="CUR_SIG_INFO" right={d.sigInfo != null ? d.sigInfo : null} delay={120} accent="var(--amber)">
            {sigBits ? <>
              <div className="dv-bits" title="a16 … a0">
                {sigBits.split("").map((b, i) => (
                  <Fragment key={i}>
                    {(i === 1 || i === 2 || i === 8 || i === 12) && <i />}
                    <span key={`${i}${b}`} className={b === "1" ? "one" : ""}>{b}</span>
                  </Fragment>
                ))}
              </div>
              <div className="dv-grid2">
                <div><span className="k">a16 stop</span>{(d.sigInfo >> 16) & 1}</div>
                <div><span className="k">a15 override</span>{(d.sigInfo >> 15) & 1 ? "running" : "standstill"}</div>
                <div><span className="k">a14-a9 type</span>{SIG_ABBR[d.sigType] || "undefined"}</div>
                <div><span className="k">a8-a5 line</span>{LINE_ABBR[d.lineCode] || "?"} · no {d.sigInfo & 0x1f}</div>
              </div>
            </> : <div style={{ padding: "6px 10px", ...mono, fontSize: 10, color: "var(--text-muted)" }}>no C.4.2 yet</div>}
          </DvCard>

          <DvCard icon="📡" title="Radio" right={`station data ${ageTxt(d.ageStn)}`} delay={180} accent="var(--text-secondary)">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12, padding: "6px 10px" }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 26 }}>
                {[0, 1, 2, 3, 4].map(i => <span key={i} className={i < d.rf ? "dv-rf-on" : ""} style={{ width: 6, height: 8 + i * 4.5, borderRadius: 1.5, transition: "background .4s, opacity .4s",
                  background: i < d.rf ? "var(--text-primary)" : "var(--border)", animationDelay: `${i * 0.15}s` }} />)}
              </div>
              <div style={{ ...mono, fontSize: 9.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                <b style={{ fontSize: 14, color: "var(--text-primary)" }}>{d.rf} / 5</b> cycles with a station packet<br />
                <span style={{ color: d.radioHole ? "var(--red)" : "var(--text-muted)" }}>C.4.2 · C.4.4 · C.4.5 · last 10 s{d.radioHole ? " · RADIO HOLE" : ""}</span>
              </div>
            </div>
          </DvCard>

          <DvCard icon="▤" title="Packets for this loco" right={log.length} className="dv-fill" delay={240}>
            <div className="dv-log-list">
              {log.map((p, i) => {
                const t = ptype(p);
                const lab = { 9: ["C.4.2", "#06b6d4"], 10: ["C.4.3", "#10b981"], 11: ["C.4.4", "#8b5cf6"], 12: ["C.4.5", "#ef4444"], 13: ["C.4.6", "#f59e0b"] }[t] || [`P${t}`, "#888"];
                return (
                  <div key={p.packet_index ?? i} style={{ borderLeft: `3px solid ${lab[1]}` }}>
                    <span style={{ color: "var(--text-muted)" }}>#{p.packet_index ?? "-"}</span>
                    <span style={{ color: "var(--text-muted)" }}>{(p.received_at_iso || "").slice(-8)}</span>
                    <span style={{ color: lab[1], fontWeight: 700 }}>{lab[0]}</span>
                    <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.source || "—"}</span>
                  </div>
                );
              })}
              {log.length === 0 && <div style={{ padding: 16, ...mono, fontSize: 10, color: "var(--text-muted)", textAlign: "center", display: "block" }}>{wsState === "open" ? "No packets for this loco yet." : "LIVE feed not connected."}</div>}
            </div>
          </DvCard>
        </aside>
      </div>
    </div>
  );
}
