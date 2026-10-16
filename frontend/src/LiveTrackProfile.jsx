import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { playBrakeAlert, playSosAlert, sosCategory, SOS_SOUNDS, stopAlertSound, soundSettingsStore, useStore } from "./SettingsAbout";

/* ═══════════════════════════════════════════════════════════════════════════
 * LiveTrackProfile.jsx
 *
 * New "🚆 LIVE TRACK" tab for SvkSim.jsx.
 *
 * WHAT THIS DOES
 * ───────────────
 * 1. Draws the Track Profile (Static Speed / Gradient / LC Gate / Turnout /
 *    Track Condition / RFID-tag layers) exactly as decoded from real
 *    RDSO/SPN/196/2020 Annexure-C §C.4.2 sub-packet bytes — either:
 *      a) a row picked from the loaded APD ("Load APD" sidebar) workbook, or
 *      b) the most recently TRANSMITTED Station→Loco (C.4.2) packet on the
 *         serial feed — i.e. the profile actually in effect on the wire
 *         right now, auto-updating as the StoryBoard plays through frames.
 * 2. Overlays live loco position, using every Onboard→Station (L2S, C.4.3 /
 *    C.4.6) packet arriving on the serial RX feed — ABS_LOCO_LOC, speed,
 *    direction, mode, brake, last RFID tag, etc.
 *
 * INTEGRATION
 * ───────────
 * This file decodes RAW HEX PACKETS ITSELF (a compact, self-contained port
 * of decoder.py's bit layouts). It deliberately does NOT import anything
 * from App.jsx or SvkSim.jsx — it only needs two things passed in as props:
 *
 *   <LiveTrackProfile apdResult={apdResult} serialLog={serialLog} />
 *
 *   - apdResult : the exact object already held in SvkSim.jsx's apdResult
 *                 state (response of POST /svk/load_track_profile — has
 *                 `.columns` and `.rows`).
 *   - serialLog : the exact array already held in SvkSim.jsx's serialLog
 *                 state (fed by the existing ws://localhost:8000/ws/serial_log
 *                 socket — no second WebSocket connection is opened here).
 *
 * CALIBRATION NOTE (read before trusting absolute distances)
 * ────────────────────────────────────────────────────────────
 * The Track Profile's X-axis is "distance from the profile's own datum"
 * (the row's Reference TAG, or — in "live MA" mode — LAST_REF_RFID).
 * The loco's ABS_LOCO_LOC is the OBU's own absolute-location register,
 * which is only meaningful once it has been zeroed against a known RFID.
 * Neither svk_sim_bridge.py nor svk_sim.c hands us the geographic
 * distance between "profile datum" and "loco's absolute-location zero",
 * so this view calibrates by watching the loco: the FIRST valid
 * ABS_LOCO_LOC seen for a loco is treated as its 0 m mark on this chart,
 * and you can re-zero or nudge it manually (below the chart) once you
 * know the real offset for your test rig. Until you do, treat the loco
 * marker's position as RELATIVE MOVEMENT along the profile, not a
 * survey-grade absolute fix.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── bit-level helpers (self-contained — mirrors decoder.py exactly) ── */
function hexToBytesArr(hex) {
  const clean = String(hex || "").replace(/[^0-9a-fA-F]/g, "");
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.substr(i, 2), 16));
  return out;
}
function bytesToBitStr(bytes) {
  return bytes.map(b => (b & 0xff).toString(2).padStart(8, "0")).join("");
}
function mkReader(bits) {
  let pos = 0;
  return {
    get rem() { return Math.max(0, bits.length - pos); },
    peek(n) { return bits.substr(pos, n).padEnd(n, "0"); },
    read(n) { const s = bits.substr(pos, n).padEnd(n, "0"); pos += n; return s; },
  };
}
function b2i(bitstr) { const v = parseInt(bitstr, 2); return Number.isNaN(v) ? 0 : v; }
function b2s(bitstr) {
  const n = bitstr.length;
  let v = b2i(bitstr);
  if (bitstr[0] === "1") v -= Math.pow(2, n);
  return v;
}

/* Speed-code → kmph (RDSO §C.4.2: 0=Reserved, 1-50=v*5, 62=8kmph override) */
function speedNum(v) {
  if (v === 0) return 0;
  if (v >= 1 && v <= 50) return v * 5;
  if (v === 62) return 8;
  return 0;
}
function turnoutSpeedNum(v) {
  if (v === 0) return 0;
  if (v >= 1 && v <= 18) return v * 5;
  if (v === 31) return 250; // Unrestricted
  return 0;
}

/* ═══ §C.4.2 sub-packet layer decoders — bit-for-bit match to decoder.py ═══ */

function decodeSSPLayer(rd) {
  const cnt = b2i(rd.read(5));
  const out = [];
  // Each entry's DISTANCE is the delta from the PREVIOUS entry's chainage
  // (same encoding convention as the TLI/RFID layer below), not an absolute
  // position on its own — so we accumulate a running chainage here, in wire
  // order, and never sort by the raw per-entry value downstream.
  let cum = 0;
  for (let i = 0; i < Math.min(cnt, 31); i++) {
    if (rd.rem < 16) break;
    const distance = b2i(rd.read(15));
    const universal = b2i(rd.read(1)) === 0;
    cum += distance;
    if (universal) {
      const v = b2i(rd.read(6));
      out.push({ distance, cumDist: cum, universal: true, speed: speedNum(v) });
    } else {
      const a = b2i(rd.read(6)), b = b2i(rd.read(6)), c = b2i(rd.read(6));
      out.push({ distance, cumDist: cum, universal: false, speedA: speedNum(a), speedB: speedNum(b), speedC: speedNum(c) });
    }
  }
  return out;
}

function decodeGradLayer(rd) {
  const cnt = b2i(rd.read(5));
  const out = [];
  let cum = 0; // same delta-chaining convention as the SSP/TLI layers
  for (let i = 0; i < Math.min(cnt, 31); i++) {
    if (rd.rem < 21) break;
    const distance = b2i(rd.read(15));
    const uphill = b2i(rd.read(1)) === 1;
    const gradeCode = b2i(rd.read(5)); // 0=level, 1-29=steepness, 30=steeper than 1:33, 31=reserved
    cum += distance;
    out.push({ distance, cumDist: cum, uphill, gradeCode });
  }
  return out;
}

const LC_SUFFIX = { 0: "-", 1: "a", 2: "b", 3: "c", 4: "d", 5: "e", 6: "OOR", 7: "Spare" };
const LC_CLASS  = { 0: "Special", 1: "A", 2: "B1", 3: "B2", 4: "B", 5: "C", 6: "D", 7: "Spare" };
const LC_WHISTLE = { 0: "Distance based", 1: "Time based", 2: "Configured pattern", 3: "Spare" };
function decodeLCLayer(rd) {
  const cnt = b2i(rd.read(5));
  const out = [];
  // LM_LC_Distance is measured from the PROFILE START (0 m) for every gate —
  // not from the previous gate (unlike SSP / Gradient / TLI, which chain).
  for (let i = 0; i < Math.min(cnt, 31); i++) {
    if (rd.rem < 20) break;
    const distance = b2i(rd.read(15));
    const lcId     = b2i(rd.read(10));
    const suffix   = LC_SUFFIX[b2i(rd.read(3))] || "?";
    const unmanned = b2i(rd.read(1)) === 1;
    const lcClass  = LC_CLASS[b2i(rd.read(3))] || "?";
    const autoWhistle = b2i(rd.read(1)) === 1;            // LM_LC_Auto_Whistling_Enabled
    const whistleType = LC_WHISTLE[b2i(rd.read(2))] || "?"; // LM_LC_Auto_Whistling_Type
    out.push({ distance, cumDist: distance, lcId, suffix, manned: !unmanned, lcClass, autoWhistle, whistleType });
  }
  return out;
}

function decodeTurnoutLayer(rd) {
  const cnt = b2i(rd.read(2));
  const out = [];
  // Turnout start distance is measured from the PROFILE START (0 m) for every
  // turnout — not from the previous one. releaseDist is an offset FROM that
  // turnout's own start (where its speed restriction is released).
  for (let i = 0; i < Math.min(cnt, 3); i++) {
    if (rd.rem < 32) break;
    const rawSpeed   = b2i(rd.read(5));
    const startDist  = b2i(rd.read(15));
    const releaseDist= b2i(rd.read(12));
    out.push({ speed: turnoutSpeedNum(rawSpeed), startDist, startCumDist: startDist, releaseDist });
  }
  return out;
}

function decodeTLILayer(rd) {
  rd.read(4); // DIST_DUP_TAG — not needed for the chart
  const cnt = b2i(rd.read(6));
  const out = [];
  let cum = 0;
  for (let i = 0; i < Math.min(cnt, 62); i++) {
    if (rd.rem < 22) break;
    const dist  = b2i(rd.read(11));
    const tagId = b2i(rd.read(10));
    rd.read(1); // DUP_TAG_DIR
    cum += dist;
    out.push({ dist, cumDist: cum, tagId });
  }
  return out;
}

const TC_NAME = {
  0: "Not used", 1: "Dead Stop", 2: "Radio Hole", 3: "Non-Stop Area", 4: "Tunnel Stop",
  5: "Powerless Section", 6: "Sound Horn", 7: "Reversing Area", 8: "Fouling Mark", 9: "KAVACH Exit",
};
/* One look per TRACK_COND_TYPE: colour (theme-aware --ltp-tc-N), a short
   label and the decoration drawn on its zone (see the Track-conditions block
   in TrackChart). "point" types are drawn as a post even when length is 0. */
const TC_STYLE = {
  1: { color: "var(--ltp-tc-1)", short: "DEAD STOP",      fx: "stopbar" },
  2: { color: "var(--ltp-tc-2)", short: "RADIO HOLE",     fx: "static"  },
  3: { color: "var(--ltp-tc-3)", short: "NON-STOP AREA",  fx: "stripes" },
  4: { color: "var(--ltp-tc-4)", short: "TUNNEL STOP",    fx: "tunnel"  },
  5: { color: "var(--ltp-tc-5)", short: "POWERLESS SECTION", fx: "wire" },
  6: { color: "var(--ltp-tc-6)", short: "SOUND HORN",     fx: "horn"    },
  7: { color: "var(--ltp-tc-7)", short: "REVERSING AREA", fx: "reverse" },
  8: { color: "var(--ltp-tc-8)", short: "FOULING MARK",   fx: "post"    },
  9: { color: "var(--ltp-tc-9)", short: "KAVACH EXIT",    fx: "exit"    },
};
const TC_DEFAULT_STYLE = { color: "var(--ltp-teal)", short: "TRACK COND", fx: "" };

/* Small vector icon per track-condition type, centred on (0,0), ~10 units
   across. Drawn as SVG (not emoji) so it looks identical on every OS and in
   PNG/SVG exports. */
function TrackCondIcon({ type, color }) {
  const sw = { stroke: color, strokeWidth: 1.3, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" };
  switch (type) {
    case 1: return (<g><polygon points="-2,-5 2,-5 5,-2 5,2 2,5 -2,5 -5,2 -5,-2" fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.2}/>
                       <line x1={-2.6} y1={0} x2={2.6} y2={0} stroke={color} strokeWidth={1.8} strokeLinecap="round"/></g>);
    case 2: return (<g {...sw}><line x1={0} y1={4.5} x2={0} y2={-0.5}/><circle cx={0} cy={-1.5} r={0.9} fill={color}/>
                       <path d="M-3.2,-3.6 A4.2,4.2 0 0 0 -3.2,0.6 M3.2,-3.6 A4.2,4.2 0 0 1 3.2,0.6"/>
                       <line x1={-4.5} y1={4.5} x2={4.5} y2={-4.5} strokeWidth={1.5}/></g>);
    case 3: return (<g {...sw}><circle r={4.6}/><line x1={-3.2} y1={-3.2} x2={3.2} y2={3.2}/><line x1={3.2} y1={-3.2} x2={-3.2} y2={3.2}/></g>);
    case 4: return (<g {...sw}><path d="M-5,4.5 V0 A5,5 0 0 1 5,0 V4.5"/><path d="M-2.4,4.5 V1.2 A2.4,2.4 0 0 1 2.4,1.2 V4.5" strokeWidth={1}/></g>);
    case 5: return (<polygon points="1.6,-5 -3.2,0.6 -0.2,0.6 -1.6,5 3.2,-0.8 0.2,-0.8" fill={color} stroke={color} strokeWidth={0.6} strokeLinejoin="round"/>);
    case 6: return (<g><polygon points="-4.6,-1.6 -1.6,-1.6 2,-4.4 2,4.4 -1.6,1.6 -4.6,1.6" fill={color} fillOpacity={0.3} stroke={color} strokeWidth={1.1} strokeLinejoin="round"/>
                       <path d="M3.6,-2.2 A3,3 0 0 1 3.6,2.2" {...sw} strokeWidth={1}/></g>);
    case 7: return (<g {...sw}><path d="M-4.5,-1.8 H3.5 M1.6,-3.8 L3.6,-1.8 L1.6,0.2"/><path d="M4.5,1.8 H-3.5 M-1.6,-0.2 L-3.6,1.8 L-1.6,3.8"/></g>);
    case 8: return (<g><polygon points="0,-4.8 4.8,0 0,4.8 -4.8,0" fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.2}/>
                       <line x1={0} y1={-2.2} x2={0} y2={2.2} stroke={color} strokeWidth={1.4} strokeLinecap="round"/></g>);
    case 9: return (<g {...sw}><path d="M-1,-4.6 H-4.6 V4.6 H-1"/><path d="M-1.5,0 H4.6 M2.4,-2.2 L4.6,0 L2.4,2.2"/></g>);
    default: return <circle r={3.5} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={1.2}/>;
  }
}

function decodeTCLayer(rd) {
  const cnt = b2i(rd.read(4));
  const out = [];
  // Each condition's start is measured from the PROFILE START (0 m) — not from
  // the previous condition; "length" is the zone's own span from that start.
  for (let i = 0; i < Math.min(cnt, 15); i++) {
    if (rd.rem < 34) break;
    const type  = b2i(rd.read(4));
    const start = b2i(rd.read(15));
    const length= b2i(rd.read(15));
    out.push({ type, typeName: TC_NAME[type] || `Reserved(${type})`, start, startCumDist: start, length });
  }
  return out;
}

/* Minimal Movement-Authority skip — we only need to consume its declared
   bit-width correctly so the sub-packet loop stays aligned; MA's own fields
   (signal aspect, authorised speed ceiling, etc.) are outside this tab's
   scope (see ProfileVisualizer in App.jsx for that). */
function skipMA() { return null; }

const SUBPKT_DECODERS = {
  0: skipMA,
  1: decodeSSPLayer,
  2: decodeGradLayer,
  3: decodeLCLayer,
  4: decodeTurnoutLayer,
  5: decodeTLILayer,
  6: decodeTCLayer,
  7: () => null, // TSR — not part of the six APD columns, skipped here
};

/** Decode ONE pre-packed Track-Profile-table field (e.g. "PSR Data (HEX)"
 *  cell) exactly as svk_sim.c's track_profile_real_len() + the sub-packet
 *  loop interpret it: byte0 top nibble = SUB_PKT_TYPE (0xF = no data for
 *  this field), then an 11-bit header (4-bit type + 7-bit length) followed
 *  by (length+1)*8-11 bits of payload. */
function decodeApdField(hexStr) {
  const bytes = hexToBytesArr(hexStr);
  if (bytes.length < 2) return null;
  if ((bytes[0] >> 4) === 0xF) return null; // placeholder — nothing loaded for this route slot
  const len7 = ((bytes[0] & 0x0f) << 3) | (bytes[1] >> 5);
  const realLen = Math.max(1, Math.min(len7 + 1, bytes.length));
  const bits = bytesToBitStr(bytes.slice(0, realLen));
  const rd = mkReader(bits);
  if (rd.rem < 11) return null;
  const type = b2i(rd.read(4));
  const lenVal = b2i(rd.read(7));
  const payloadBits = (lenVal + 1) * 8 - 11;
  const avail = Math.min(payloadBits, rd.rem);
  let sub = rd.read(avail);
  if (avail < payloadBits) sub = sub.padEnd(payloadBits, "0");
  const decoder = SUBPKT_DECODERS[type];
  return decoder ? decoder(mkReader(sub)) : null;
}

function maxDistOfLayers(l) {
  const cands = [
    ...(l.ssp || []).map(x => x.cumDist),
    ...(l.gradient || []).map(x => x.cumDist),
    ...(l.lcGates || []).map(x => x.cumDist),
    ...(l.turnouts || []).map(x => x.startCumDist),
    ...(l.tli || []).map(x => x.cumDist),
    ...(l.trackConds || []).map(x => x.startCumDist + x.length),
    l.profileSpanNum,
  ].filter(v => v != null && !isNaN(v) && v > 0);
  return cands.length ? Math.max(...cands) : 500;
}

/** Fuzzy column lookup — matches on a lowercase substring so small naming
 *  variations in the loaded workbook (e.g. "Entry Aspect" vs "Entry Signal
 *  Aspect") still resolve, instead of requiring an exact header string. */
function findCol(columns, substrings) {
  const lower = columns.map(c => String(c).toLowerCase());
  for (const needle of substrings) {
    const i = lower.findIndex(c => c.includes(needle));
    if (i >= 0) return columns[i];
  }
  return null;
}

function parseNum(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

const APD_HEX_COLS = {
  ssp:        "PSR Data (HEX)",
  gradient:   "Gradient Data (HEX)",
  lcGates:    "LC Gate Data (HEX)",
  turnouts:   "Turnout Data (HEX)",
  tli:        "TLI Data (HEX)",
  trackConds: "TCD Data (HEX)",
};

/** Build a track-profile "layers" object from one row of the loaded APD
 *  (Track Profile) table — apdResult.columns / apdResult.rows shape, as
 *  returned by POST /svk/load_track_profile. */
function buildProfileFromApdRow(columns, row) {
  const idxOf = name => columns.indexOf(name);
  const get = name => { const i = idxOf(name); return i >= 0 ? row[i] : ""; };
  const getFuzzy = substrings => { const c = findCol(columns, substrings); return c ? get(c) : null; };
  const profileSpan = get("Profile Span");
  const layers = {
    source: "apd",
    sno: get("S.No"),
    entrySignal: get("Entry Signal") || null,
    exitSignal: get("Exit Signal") || null,
    // Aspect columns aren't part of the fixed six-column HEX schema this tab
    // otherwise decodes bit-for-bit, so — rather than guessing — we only show
    // an aspect if the loaded workbook actually has a column for it.
    entrySignalAspect: getFuzzy(["entry signal aspect", "entry aspect"]),
    exitSignalAspect: getFuzzy(["exit signal aspect", "exit aspect"]),
    line: get("Line"), refTag: get("Reference TAG"), profileSpan,
    profileSpanNum: parseNum(profileSpan),
  };
  for (const [key, col] of Object.entries(APD_HEX_COLS)) {
    layers[key] = decodeApdField(get(col)) || [];
  }
  layers.maxDist = maxDistOfLayers(layers);
  return layers;
}

/** Does this decoded packet actually carry any real profile geometry, or
 *  is it just a bare MA update (all six sub-packet layers empty)? Used to
 *  tell "the station resent the full profile" apart from "this is just a
 *  routine MA-only tick for the profile we already have". */
function hasProfileGeometry(layers) {
  return !!(layers && (
    (layers.ssp && layers.ssp.length) || (layers.gradient && layers.gradient.length) ||
    (layers.lcGates && layers.lcGates.length) || (layers.turnouts && layers.turnouts.length) ||
    (layers.tli && layers.tli.length) || (layers.trackConds && layers.trackConds.length)
  ));
}

/** Look up the loaded APD (Track Profile) workbook for the row whose
 *  "Reference TAG" matches the given RFID tag id, and build its layers —
 *  this is the authoritative source for a profile's full geometry once
 *  the station has stopped resending it on the wire (MA-only packets). */
function findApdRowByRefTag(apdResult, tagId) {
  if (!apdResult?.columns || !apdResult?.rows || tagId == null) return null;
  const refCol = findCol(apdResult.columns, ["reference tag"]);
  if (!refCol) return null;
  const idx = apdResult.columns.indexOf(refCol);
  const row = apdResult.rows.find(r => Number(r[idx]) === Number(tagId));
  return row ? buildProfileFromApdRow(apdResult.columns, row) : null;
}

/** Shifts every entry's chainage field by `offset` — used to splice a
 *  newly-referenced profile onto the END of the profile already being
 *  shown, so its distances continue chaining forward instead of
 *  restarting at 0 (which would otherwise fold the new segment back on
 *  top of the existing one). */
function shiftEntries(entries, offset, field = "cumDist") {
  if (!entries || !entries.length || !offset) return entries || [];
  return entries.map(e => ({ ...e, [field]: (e[field] ?? 0) + offset }));
}

/** Where does `incoming`'s local 0 m sit on `prev`'s local axis?
 *  Consecutive profiles share an RFID tag at the hand-over point (e.g. the
 *  profile referenced by REF_PROF_ID 1 ends at tag #354, and the one for
 *  REF_PROF_ID 2 starts at #354), so the first incoming tag that also exists
 *  in the displayed profile pins the splice exactly. Only when no tag is
 *  shared does it fall back to butting the new profile onto the old end. */
function spliceOffset(prev, incoming) {
  const prevTags = new Map((prev.tli || []).map(t => [t.tagId, t.cumDist]));
  for (const t of incoming.tli || []) {
    if (prevTags.has(t.tagId)) return prevTags.get(t.tagId) - t.cumDist;
  }
  return prev.maxDist || 0;
}

/** Keeps only the part of `prev` that lies BEFORE the splice point — from
 *  there on the newly transmitted profile is authoritative, so it replaces
 *  (rather than overlaps) whatever the old profile said about that stretch.
 *  SSP/gradient entries mark the END of a segment, so the segment that
 *  straddles the splice is kept but cut short at it. */
function trimBefore(prev, at) {
  const EPS = 0.5;
  const trimSegs = segs => {
    const out = [];
    let start = 0;
    for (const e of segs || []) {
      if (start >= at - EPS) break;
      const end = e.cumDist ?? e.distance;
      out.push(end > at ? { ...e, cumDist: at } : e);
      start = end;
    }
    return out;
  };
  return {
    ssp:        trimSegs(prev.ssp),
    gradient:   trimSegs(prev.gradient),
    lcGates:    (prev.lcGates || []).filter(g => (g.cumDist ?? g.distance) < at - EPS),
    turnouts:   (prev.turnouts || []).filter(t => t.startCumDist < at - EPS),
    tli:        (prev.tli || []).filter(t => t.cumDist < at - EPS),
    trackConds: (prev.trackConds || []).filter(c => c.startCumDist < at - EPS),
  };
}

/** Concatenates a newly transmitted profile onto the one already shown in
 *  "LIVE MA (ON WIRE)" mode. Called only when the S2L packet carries a NEW
 *  REF_PROF_ID together with its geometry; everything already on screen
 *  stays exactly as it was up to the splice point. */
function appendProfile(prev, incoming, header) {
  if (!prev) return incoming ? { ...incoming, source: "live" } : null;
  if (!incoming) return prev;
  const offset = spliceOffset(prev, incoming);
  const kept = trimBefore(prev, offset);
  const merged = {
    ...prev,
    source: "live",
    ssp:        [...kept.ssp,        ...shiftEntries(incoming.ssp, offset, "cumDist")],
    gradient:   [...kept.gradient,   ...shiftEntries(incoming.gradient, offset, "cumDist")],
    lcGates:    [...kept.lcGates,    ...shiftEntries(incoming.lcGates, offset, "cumDist")],
    turnouts:   [...kept.turnouts,   ...shiftEntries(incoming.turnouts, offset, "startCumDist")],
    tli:        [...kept.tli,        ...shiftEntries(incoming.tli, offset, "cumDist")],
    trackConds: [...kept.trackConds, ...shiftEntries(incoming.trackConds, offset, "startCumDist")],
    exitSignal: incoming.exitSignal ?? prev.exitSignal,
    exitSignalAspect: incoming.exitSignalAspect ?? prev.exitSignalAspect,
  };
  if (header) {
    merged.refProfId    = header.refProfId    ?? prev.refProfId;
    merged.lastRefRfid  = header.lastRefRfid  ?? prev.lastRefRfid;
    merged.distPktStart = header.distPktStart ?? prev.distPktStart;
  }
  merged.profileSpanNum = incoming.profileSpanNum != null ? offset + incoming.profileSpanNum : null;
  merged.maxDist = maxDistOfLayers(merged);
  return merged;
}

/* ═══ Onboard→Station (Loco→Station) header decode — C.4.3 / C.4.6 ═══
   Only the fields this tab needs: identity, position, speed, direction,
   mode, emergency, brake, last RFID tag, and (pkt10 only) the 4-bit
   LAST_REF_PROFILE the loco last received. Bit widths match
   decode_onboard_to_station() / the pkt13 branch in decoder.py exactly. */
function decodeLocoPacket(hexStr) {
  const bytes = hexToBytesArr(hexStr);
  if (!bytes.length) return null;
  const bits = bytesToBitStr(bytes);
  const rd = mkReader(bits);
  if (rd.rem < 4) return null;
  const pktType = b2i(rd.read(4));
  if (pktType !== 10 && pktType !== 13) return null;
  // Reject truncated / partially-received frames. The bit reader pads missing
  // bits with zeros, so a cut-off frame used to decode "successfully" into a
  // phantom loco (odd ID, ABS_LOCO_LOC = 0, speed 0, train length 0) — and that
  // phantom, sitting ~136 km away from the real profile, stretched the chart's
  // x-axis until the whole profile collapsed into a sliver at the right edge.
  // This only checks enough bits to cover locoId, ABS_LOCO_LOC, train length,
  // speed, dir, emergency and mode — the fields the icon's position and status
  // actually depend on (114 bits for pkt 10, 103 for pkt 13). It deliberately
  // does NOT require the full frame (155 / 129 bits): that stricter check
  // rejected every frame whenever this loco's own frames don't carry the last
  // few optional fields (LAST_RFID / brake / LAST_REF_PROFILE, or the pkt-13
  // approaching-station id) at the length this decoder assumed — which is
  // exactly what stopped the icon from updating at all. A frame this short
  // still can't reach ABS_LOCO_LOC with real bits, so the original phantom
  // (cut off before even that field) is still caught.
  if (bits.length < (pktType === 10 ? 114 : 103)) return null;

  rd.read(7);  // PKT_LENGTH
  const frameNum = b2i(rd.read(17)); // FRAME_NUM (used to de-duplicate brake events)
  const locoId = b2i(rd.read(20));
  rd.read(3);  // SOURCE_LOCO_VER

  const absLocRaw = b2i(rd.read(23));
  const absLoc = absLocRaw === 8388607 ? null : absLocRaw;

  let speed = null, dir = 0, emergency = 0, mode = 0, lastRfid = null, lastRefProfile = null, brake = 0, apprStnId = null;

  let trainLength = null;

  if (pktType === 10) {
    rd.read(9); rd.read(9); rd.read(2);            // L_DOUBTOVER, L_DOUBTUNDER, TRAIN_INT
    trainLength = b2i(rd.read(11));                 // TRAIN_LENGTH (m)
    const spdRaw = b2i(rd.read(9));
    speed = spdRaw <= 400 ? spdRaw : null;
    dir = b2i(rd.read(2));
    emergency = b2i(rd.read(3));
    mode = b2i(rd.read(4));
    lastRfid = b2i(rd.read(10));
    rd.read(1); rd.read(3);                         // TAG_DUP, TAG_LINK_INFO
    rd.read(9);                                     // TIN
    brake = b2i(rd.read(3));
    rd.read(2);                                     // NEW_MA_REPLY
    lastRefProfile = b2i(rd.read(4));
  } else {
    trainLength = b2i(rd.read(11));                 // TRAIN_LENGTH (m)
    const spdRaw = b2i(rd.read(9));
    speed = spdRaw <= 400 ? spdRaw : null;
    dir = b2i(rd.read(2));
    emergency = b2i(rd.read(3));
    mode = b2i(rd.read(4));
    apprStnId = b2i(rd.read(16));                   // APPROACHING_STN_ID
    lastRfid = b2i(rd.read(10));
  }

  return { pktType, locoId, frameNum, absLoc, speed, dir, emergency, mode, lastRfid, lastRefProfile, brake, trainLength, apprStnId };
}

/* ═══ Station→Loco (C.4.2) decode — "what profile is on the wire right now" ═══
   Reads only the header fields needed for calibration (REF_PROF_ID,
   LAST_REF_RFID, DIST_PKT_START) plus the same six sub-packet layers as
   the APD path, via the identical bounded sub-packet loop used in the
   real decoder. */
function decodeStationPacket(hexStr) {
  const bytes = hexToBytesArr(hexStr);
  if (!bytes.length) return null;
  const bits = bytesToBitStr(bytes);
  const rd = mkReader(bits);
  if (rd.rem < 4) return null;
  const pktType = b2i(rd.read(4));
  if (pktType !== 9) return null;

  rd.read(10); // PKT_LENGTH (10 bits for C.4.2)
  rd.read(17); // FRAME_NUM
  rd.read(16); rd.read(3); // SOURCE_STN_ID, SOURCE_STN_VER
  rd.read(20); // DEST_LOCO_ID
  const refProfId    = b2i(rd.read(4));
  const lastRefRfid  = b2i(rd.read(10));
  const distPktStart = b2s(rd.read(15));
  rd.read(2); rd.read(3); // PKT_DIR, header padding

  const layers = { source: "live", refProfId, lastRefRfid, distPktStart,
                    ssp: [], gradient: [], lcGates: [], turnouts: [], tli: [], trackConds: [] };
  const seen = new Set();
  let guard = 0;
  const MAC_CRC_BITS = 64;
  while (rd.rem > MAC_CRC_BITS && rd.rem >= 11 && guard < 8) {
    const sv = b2i(rd.peek(4));
    if (seen.has(sv) || sv > 7) break;
    rd.read(4);
    const lenVal = b2i(rd.read(7));
    const payloadBits = (lenVal + 1) * 8 - 11;
    const avail = Math.min(payloadBits, rd.rem);
    let subBits = rd.read(avail);
    if (avail < payloadBits) subBits = subBits.padEnd(payloadBits, "0");
    seen.add(sv); guard++;
    const decoder = SUBPKT_DECODERS[sv];
    const result = decoder ? decoder(mkReader(subBits)) : null;
    if (sv === 1) layers.ssp = result || [];
    else if (sv === 2) layers.gradient = result || [];
    else if (sv === 3) layers.lcGates = result || [];
    else if (sv === 4) layers.turnouts = result || [];
    else if (sv === 5) layers.tli = result || [];
    else if (sv === 6) layers.trackConds = result || [];
  }
  layers.maxDist = maxDistOfLayers(layers);
  return layers;
}

/* Loosely matches a serial-log event's direction against a handful of
 * common spellings ("serial_tx"/"serial_rx", "tx"/"rx", "s2l"/"l2s", a
 * `direction`/`dir` field instead of `type`, etc.) instead of requiring one
 * exact string. This is deliberately permissive because the *real* type
 * check is the packet header itself (decodeStationPacket/decodeLocoPacket
 * both return null unless the header's own pktType nibble matches), so a
 * loose label match here can't misclassify a packet — it can only recover
 * from the label not being exactly what this file originally assumed. */
function eventTag(ev) {
  return String(ev?.type ?? ev?.direction ?? ev?.dir ?? ev?.channel ?? "").toLowerCase();
}
function isTxEvent(ev) { const t = eventTag(ev); return t.includes("tx") || t.includes("s2l"); }
function isRxEvent(ev) { const t = eventTag(ev); return t.includes("rx") || t.includes("l2s"); }

/* ═══════════════════════════════════════════════════════════════════════
 * UI — small local lookups (kept self-contained, no cross-file imports)
 * ═══════════════════════════════════════════════════════════════════ */
const DIR_LABEL   = { 0: "Unidentified", 1: "Nominal (DOWN)", 2: "Reverse (UP)", 3: "Reserved" };
const MODE_LABEL  = { 1:"Stand-By",2:"Staff Resp.",3:"Ltd. Supv.",4:"Full Supv.",5:"Override",
                       6:"On-Sight",7:"Trip",8:"Post-Trip",9:"Reverse",10:"Shunting",
                       11:"Non-Leading",12:"Sys Failure",13:"Isolation" };
const EMRG_LABEL  = { 0:"—",1:"Unusual Stop",2:"SoS",3:"Roll Back",4:"Head-On",5:"Rear-End",6:"Parting SoS" };
const BRAKE_LABEL = { 0:"—",1:"Overspeed",2:"Service Brake",3:"Full Service",4:"Emergency Brake" };
/* One identity colour per loco (card border, connector, rings, trail).
   Deliberately NONE of the colours that already MEAN something on this chart:
   yellow / amber (Overspeed, NSB, turnouts), orange (FSB, gradient),
   red / rose (EB, EOA, LC gates, brakes), green (SSP line), teal (track
   conditions), lime (RFID tags). Red is still used for a loco in EMERGENCY,
   because that is its meaning. Hues: cyan, fuchsia, blue, violet, silver,
   indigo — ordered so the first few locos are the most different from each
   other. Theme-aware (deeper shades in light mode) via --ltp-loco-N in CINE_CSS. */
const LOCO_COLORS = ["var(--ltp-loco-1)", "var(--ltp-loco-2)", "var(--ltp-loco-3)",
                     "var(--ltp-loco-4)", "var(--ltp-loco-5)", "var(--ltp-loco-6)"];
/* A loco that hasn't sent a packet for this long (5 missed 2 s TDMA cycles)
   is shown as "NO SIGNAL": faded icon/trail/card with a seconds counter, so
   a finished or lost loco is never mistaken for a live one. It stays on the
   chart until it reports again, it's removed (×), or the chart is cleared. */
const LOCO_STALE_MS = 10000;
/* Seconds for one scanner sweep across the chart (see .ltp-scan / .ltp-ping). */
const SCAN_S = 9;
/* Scanner sweep line (and the marker flashes timed to it) — switched OFF.
   Set to true to bring the moving scan line back. */
const SCAN_ENABLED = false;

/* Brake-application markers on the chart.
   Every BRAKE_APPLIED code listed here gets a dot on the loco's trail the moment
   the loco reports it (0 → code, or one brake level changing to another).
   Only actual brake applications are shown: NSB, FSB, EB.
   Code 1 (Overspeed) is an alert only, not shown as a dot on the graph. */
const BRAKE_TYPES = {
  2: { short: "NSB", full: "Normal Service Brake", color: "#fbbf24" },
  3: { short: "FSB", full: "Full Service Brake",   color: "#fb923c" },
  4: { short: "EB",  full: "Emergency Brake",      color: "#ef4444" },
};

/* HH:MM:SS.mmm wall-clock time for the brake popup. */
function fmtClock(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
/* Best-effort "when did this packet arrive" — uses a timestamp on the serial-log
   event when it has a sane one (within a day of now), else the current time. */
function evTimeMs(ev) {
  const v = ev?.ts ?? ev?.timestamp ?? ev?.time ?? ev?.t;
  let ms = null;
  if (typeof v === "number" && Number.isFinite(v)) ms = v < 1e11 ? v * 1000 : v;
  else if (typeof v === "string") { const p = Date.parse(v); if (Number.isFinite(p)) ms = p; }
  return (ms != null && Math.abs(ms - Date.now()) < 86400000) ? ms : Date.now();
}

/** Standard railway aspect → colour. Falls back to a neutral grey whenever
 *  no aspect string is available for a signal (see buildProfileFromApdRow —
 *  we never fabricate an aspect that wasn't actually in the data). */
function aspectColor(aspect) {
  if (!aspect) return "#6b7280";
  const s = String(aspect).toLowerCase();
  if (s.includes("double") && s.includes("yellow")) return "#facc15";
  if (s.includes("yellow") || s.includes("caution") || s.includes("attention")) return "#eab308";
  if (s.includes("green") || s.includes("clear")) return "#22c55e";
  if (s.includes("red") || s.includes("danger") || s.includes("stop") || s.includes("off")) return "#ef4444";
  return "#6b7280";
}

/** Static Speed Profile is a step function: entries carry an ACCUMULATED
 *  chainage (cumDist) and hold that speed from the previous entry's cumDist
 *  up to their own. Given any distance along the profile, returns whichever
 *  entry's step it falls in (or the last entry's speed past the end) — used
 *  to test whether a loco marker's y-position currently sits on/near the
 *  green SSP line at its own x-position (see the highlight/dim logic in
 *  TrackChart), not just to draw the line itself. */
function speedAtDistance(universalEntries, d) {
  if (!universalEntries || !universalEntries.length || d == null) return null;
  for (const e of universalEntries) {
    if (d <= (e.cumDist ?? e.distance)) return e.speed;
  }
  return universalEntries[universalEntries.length - 1].speed;
}

/** Turns a flat point list into a smooth Catmull-Rom → cubic-bezier SVG path
 *  (tension = 6, the conventional default) instead of a straight-segment
 *  polyline. Used for the loco movement trail so the drawn speed-vs-distance
 *  curve reads as a continuous curve rather than sharp jagged segments. */
function smoothPathD(points) {
  if (!points || points.length < 2) return "";
  if (points.length === 2) return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  let d = `M ${points[0][0]} ${points[0][1]} `;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2[0]} ${p2[1]} `;
  }
  return d;
}

/** Simple side-lamp signal post — pole + one head, coloured by aspectColor().
 *  Drawn just above the grid at the signal's chainage. */
function SignalGlyph({ color, size = 15 }) {
  return (
    <g>
      <rect x={-size * 0.05} y={-size * 0.05} width={size * 0.1} height={size * 0.95} fill="var(--text-dim)"/>
      <rect x={-size * 0.34} y={-size * 0.95} width={size * 0.68} height={size * 0.62} rx={2.5}
        fill="var(--bg-base)" stroke={color} strokeWidth={1.4}/>
      <circle cx={0} cy={-size * 0.64} r={size * 0.18} fill={color}/>
    </g>
  );
}

/* ── Cinematic layer (visuals only) ─────────────────────────────────────
   CINE_REDUCED: SMIL <animate> can't be switched off by CSS, so every SMIL
   effect added below is simply not rendered when the OS asks for reduced
   motion. CINE_CSS: styles for the HTML parts of the screen (stat chips,
   toolbar title); the chart's own SVG effects live in TrackChart's <style>. */
const CINE_REDUCED = typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ── Smooth growth when LIVE MA appends a new route ──────────────────────
   Instead of the x-axis jumping to the new length and the whole profile
   redrawing from 0, the axis widens smoothly (old profile glides left) and
   then only the NEW stretch is drawn in, left to right, behind a glowing
   drawing head. growFrame() returns the in-between values for "now", or
   null once the animation is over. */
const GROW_AXIS_MS = 900;      // x-axis widening
const GROW_DRAW_DELAY = 350;   // new stretch starts drawing while the axis is still settling
const GROW_DRAW_MS = 1500;     // drawing the new stretch
const clamp01 = p => Math.max(0, Math.min(1, p));
const easeOutCubic = p => 1 - Math.pow(1 - p, 3);
const easeInOutCubic = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const FIRST_DRAW_DELAY = 150;  // first LIVE profile: drawn from 0 m …
const FIRST_DRAW_MS = 2200;    // … over a slightly longer sweep (whole profile)
function growFrame(a, now) {
  if (!a) return null;
  const t = now - a.t0;
  const delay = a.delay ?? GROW_DRAW_DELAY, dur = a.dur ?? GROW_DRAW_MS;
  if (t >= delay + dur) return null;
  const pA = easeOutCubic(clamp01(t / GROW_AXIS_MS));
  const pD = easeInOutCubic(clamp01((t - delay) / dur));
  return {
    scaleMax: a.fromMax + (a.toMax - a.fromMax) * pA,
    drawnTo:  a.fromDrawn + (a.toMax - a.fromDrawn) * pD,
    span:     a.fromSpan + (a.toSpan - a.fromSpan) * pD,
  };
}

const CINE_CSS = `
  @keyframes chipIn { from { opacity: 0; transform: translateY(10px) scale(0.96); } to { opacity: 1; transform: none; } }
  @keyframes chipShine { 0%, 68% { left: -60%; } 100% { left: 135%; } }
  @keyframes chipFlash { 0% { filter: brightness(2.1); text-shadow: 0 0 12px currentColor; } 100% { filter: none; text-shadow: 0 0 0 transparent; } }
  @keyframes titleGlow { 0%, 100% { text-shadow: 0 0 0 transparent; } 50% { text-shadow: 0 0 10px rgba(34,211,238,0.85), 0 0 22px rgba(34,211,238,0.35); } }
  .cine-chip {
    position: relative; overflow: hidden;
    animation: chipIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) backwards; animation-delay: var(--d, 0s);
    transition: transform 0.18s, box-shadow 0.25s, border-color 0.25s;
  }
  .cine-chip:hover { transform: translateY(-2px); border-color: var(--c, #22d3ee); box-shadow: 0 6px 18px -8px var(--c, #22d3ee); }
  .cine-chip::after {
    content: ""; position: absolute; top: 0; left: -60%; width: 40%; height: 100%; pointer-events: none;
    background: linear-gradient(100deg, transparent, rgba(255,255,255,0.10), transparent);
    animation: chipShine 7s ease-in-out infinite; animation-delay: var(--d, 0s);
  }
  .cine-chip-val { display: inline-block; animation: chipFlash 0.75s ease-out; }
  .cine-title { animation: titleGlow 4s ease-in-out infinite; }
  /* Track-chart colours — dark values = the original design; light values are
     deeper shades of the same hues so the chart stays readable on white. */
  :root {
    --ltp-red: #ef4444;
    --ltp-red-soft: #f87171;
    --ltp-sky: #38bdf8;
    --ltp-sky-text: #7dd3fc;
    --ltp-text-hi: #e0f2fe;
    --ltp-ssp: #34d399;
    --ltp-ssp-soft: #a7f3d0;
    --ltp-ssp-text: #6ee7b7;
    --ltp-spark: #ecfdf5;
    --ltp-amber: #f59e0b;
    --ltp-amber-text: #fbbf24;
    --ltp-amber-soft: #fcd34d;
    --ltp-yellow: #facc15;
    --ltp-orange: #fb923c;
    --ltp-orange-2: #f97316;
    --ltp-cyan: #22d3ee;
    --ltp-teal: #2dd4bf;
    --ltp-tag: #bef264;
    --ltp-tag-text: #a3e635;
    --ltp-text-strong: #e5e7eb;
    --ltp-muted: #94a3b8;
    --ltp-ink: #ffffff;
    --ltp-box-bg: #06101c;
    --ltp-ssp-box-bg: #052e22;
    --ltp-warn-box-bg: #1c1406;
    --ltp-plot-top: #0a1220;
    --ltp-plot-mid: #0b0f18;
    --ltp-plot-bot: #05070c;
    --ltp-vignette: #000000;
    /* Loco identity colours (see LOCO_COLORS) */
    --ltp-loco-1: #22d3ee;  /* cyan    */
    --ltp-loco-2: #e879f9;  /* fuchsia */
    --ltp-loco-3: #60a5fa;  /* blue    */
    --ltp-loco-4: #a78bfa;  /* violet  */
    --ltp-loco-5: #e2e8f0;  /* silver  */
    --ltp-loco-6: #818cf8;  /* indigo  */
    /* Track-condition types (TC_STYLE) */
    --ltp-tc-1: #f87171;  /* Dead Stop         */
    --ltp-tc-2: #c084fc;  /* Radio Hole        */
    --ltp-tc-3: #f472b6;  /* Non-Stop Area     */
    --ltp-tc-4: #94a3b8;  /* Tunnel Stop       */
    --ltp-tc-5: #fde047;  /* Powerless Section */
    --ltp-tc-6: #2dd4bf;  /* Sound Horn        */
    --ltp-tc-7: #60a5fa;  /* Reversing Area    */
    --ltp-tc-8: #fb923c;  /* Fouling Mark      */
    --ltp-tc-9: #e2e8f0;  /* KAVACH Exit       */
  }
  :root.light {
    --ltp-red: #dc2626;
    --ltp-red-soft: #dc2626;
    --ltp-sky: #0284c7;
    --ltp-sky-text: #0369a1;
    --ltp-text-hi: #0c4a6e;
    --ltp-ssp: #059669;
    --ltp-ssp-soft: #10b981;
    --ltp-ssp-text: #047857;
    --ltp-spark: #065f46;
    --ltp-amber: #d97706;
    --ltp-amber-text: #b45309;
    --ltp-amber-soft: #b45309;
    --ltp-yellow: #a16207;
    --ltp-orange: #ea580c;
    --ltp-orange-2: #c2410c;
    --ltp-cyan: #0891b2;
    --ltp-teal: #0d9488;
    --ltp-tag: #65a30d;
    --ltp-tag-text: #4d7c0f;
    --ltp-text-strong: #334155;
    --ltp-muted: #64748b;
    --ltp-ink: #0f172a;
    --ltp-box-bg: #ffffff;
    --ltp-ssp-box-bg: #ecfdf5;
    --ltp-warn-box-bg: #fffbeb;
    --ltp-plot-top: #ffffff;
    --ltp-plot-mid: #f8fafc;
    --ltp-plot-bot: #eef2f7;
    --ltp-vignette: #94a3b8;
    --ltp-loco-1: #0891b2;
    --ltp-loco-2: #c026d3;
    --ltp-loco-3: #2563eb;
    --ltp-loco-4: #7c3aed;
    --ltp-loco-5: #475569;
    --ltp-loco-6: #4f46e5;
    --ltp-tc-1: #dc2626;
    --ltp-tc-2: #9333ea;
    --ltp-tc-3: #db2777;
    --ltp-tc-4: #475569;
    --ltp-tc-5: #a16207;
    --ltp-tc-6: #0d9488;
    --ltp-tc-7: #2563eb;
    --ltp-tc-8: #ea580c;
    --ltp-tc-9: #334155;
  }
  @keyframes pktLed { 0% { box-shadow: 0 0 0 0 var(--c); transform: scale(1.5); } 100% { box-shadow: 0 0 0 7px transparent; transform: scale(1); } }
  .pkt-led { animation: pktLed 0.8s ease-out; }
  @media (prefers-reduced-motion: reduce) {
    .cine-chip, .cine-chip::after, .cine-chip-val, .cine-title, .pkt-led { animation: none; }
  }
`;

function StatChip({ label, value, color }) {
  return (
    <div className="cine-chip" title={`${label}: ${value}`} style={{
      display: "flex", flexDirection: "column", gap: 1, padding: "4px 8px", minWidth: 0,
      borderRadius: 4, background: "var(--bg-raised)", border: "1px solid var(--border)",
      "--d": `${(String(label).length % 7) * 0.06}s`, "--c": color || "#22d3ee",
    }}>
      <span style={{ fontSize: 7, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</span>
      <span key={String(value)} className="cine-chip-val" style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700, color: color || "var(--text-primary)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{value}</span>
    </div>
  );
}

/* One loco-packet type's latest values in a FIXED set of boxes. The Access
   Request (PKT 13, C.4.6) and Regular (PKT 10, C.4.3) packets carry different
   fields and arrive interleaved, so showing "whichever came last" made the
   strip swap boxes on every packet. Each type now has its own panel whose
   boxes never change — they just show "—" until that packet type arrives. */
function PacketPanel({ title, spec, accent, pkt, fields }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 5, minWidth: 0, padding: "6px 8px 7px",
      borderRadius: 6, border: `1px solid ${accent}40`,
      background: `linear-gradient(180deg, ${accent}10, transparent 70%)`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--font-mono)", whiteSpace: "nowrap", minWidth: 0 }}>
        <span key={pkt?.at ?? "none"} className={pkt ? "pkt-led" : undefined} style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: pkt ? accent : "var(--text-dim)", "--c": accent,
        }}/>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: accent }}>{title}</span>
        <span style={{ fontSize: 8, color: "var(--text-dim)" }}>{spec}</span>
        <span style={{ marginLeft: "auto", fontSize: 8, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis" }}>
          {pkt ? `#${pkt.locoId} · frame ${pkt.frameNum} · ${fmtClock(pkt.at)}` : "waiting for packet…"}
        </span>
      </div>
      {/* Fixed per-field widths (weights), never sized from the value itself —
          so a value changing length can't shift the boxes next to it. */}
      <div style={{ display: "grid", gridTemplateColumns: fields.map(f => `minmax(0, ${f.w || 1}fr)`).join(" "), gap: 5 }}>
        {fields.map(f => <StatChip key={f.label} label={f.label} value={pkt ? f.value(pkt) : "—"} color={pkt ? f.color?.(pkt) : undefined}/>)}
      </div>
    </div>
  );
}

/* Simple, crisp side-view train icon — replaces the old tiny dot marker
   (a lone circle at 4-6px read as "just a dot", especially since emoji
   glyph rendering varies a lot across fonts/platforms). Pure vector
   shapes so it always renders identically. */
function LocoIcon({ color, size = 22, speed = 0, reverse = false, brake = 0, emergency = 0, tilt = 0 }) {
  const w = size, h = size * 0.62;
  const BODY = "#facc15";                   // loco body: yellow
  const BODY_EDGE = "#a16207";              // darker yellow-brown outline so it stays crisp on any background
  const wr = h * 0.25;                      // wheel radius
  const wheelY = h * 0.22;
  // Wheel spin follows the loco: one revolution per (40 / speed) seconds, so
  // 40 kmph = 1 rev/s and 120 kmph = 3 rev/s; stopped (speed 0) freezes the
  // wheels in place instead of resetting them. The duration is a plain CSS
  // value, so a new speed from the next packet just changes the pace — the
  // animation isn't restarted, so there's no visible jump.
  const moving = speed > 0;
  const period = moving ? Math.min(6, Math.max(0.25, 40 / speed)) : 6;
  // (When the loco is reversing the whole icon is mirrored below, which also
  // mirrors the wheels' visual spin — so no separate "reverse" spin here.)
  const spin = {
    animationDuration: `${period.toFixed(2)}s`,
    animationPlayState: moving ? "running" : "paused",
  };
  const Wheel = ({ cx }) => (
    <g transform={`translate(${cx} ${wheelY})`}>
      <circle r={wr} fill="#1f2937" stroke={BODY} strokeWidth={1.4}/>
      <g className="loco-wheel" style={spin}>
        {/* spokes + crank pin: the off-centre pin is what makes the rotation readable at small sizes */}
        <line x1={-wr*0.85} y1={0} x2={wr*0.85} y2={0} stroke={BODY} strokeWidth={1}/>
        <line x1={0} y1={-wr*0.85} x2={0} y2={wr*0.85} stroke={BODY} strokeWidth={1}/>
        <circle cx={wr*0.55} cy={0} r={wr*0.22} fill={BODY}/>
      </g>
      <circle r={wr*0.16} fill={BODY}/>
    </g>
  );
  // Headlight: lamp on the front face + a soft forward beam. Both live in the
  // icon's own coordinates (front = +x); the mirror below turns them around
  // with the loco, so the light always leads in the direction of travel.
  const lampX = w / 2 - h * 0.02, lampY = -h * 0.2, lampR = h * 0.1;
  // Headlight scales with speed: dim "parked" glow when stopped, a longer,
  // brighter cone the faster the loco runs.
  const beamK = moving ? Math.min(1, 0.55 + speed / 260) : 0.35;
  const beamLen = w * (1.0 + Math.min(0.9, speed / 160)), beamHalf = h * 0.5;
  const railY = wheelY + wr;                       // top of rail = bottom of the wheels
  const fx = !CINE_REDUCED;                        // decorative motion allowed?
  const braking = brake >= 2 && brake <= 4;        // 2 NSB · 3 FSB · 4 EB
  const brakeLvl = braking ? brake - 1 : 0;        // 1..3 intensity
  const overspeed = brake === 1;
  const inEmergency = emergency > 0 || brake === 4;
  // Suspension bob: quicker the faster it runs, frozen when stopped.
  const bob = {
    animationDuration: `${(moving ? Math.max(0.16, 0.9 - speed / 180) : 1).toFixed(2)}s`,
    animationPlayState: moving && fx ? "running" : "paused",
  };
  const wheelXs = [-w * 0.24, w * 0.18];
  return (
    <g transform={reverse ? "scale(-1 1)" : undefined}>
      <defs>
        <linearGradient id="locoBeamGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85"/>
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.3"/>
          <stop offset="1" stopColor="#ffffff" stopOpacity="0"/>
        </linearGradient>
        <radialGradient id="locoPoolGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fffbe6" stopOpacity="0.9"/>
          <stop offset="1" stopColor="#fffbe6" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="locoShadowGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.7"/>
          <stop offset="1" stopColor="#000000" stopOpacity="0"/>
        </radialGradient>
      </defs>

      {/* ── Ground: soft contact shadow + a short glowing rail segment in the
           loco's identity colour, so it sits ON the track instead of floating. */}
      <ellipse cx={0} cy={railY + 1.2} rx={w * 0.72} ry={h * 0.16} fill="url(#locoShadowGrad)"/>
      <line x1={-w * 0.85} x2={w * 0.95} y1={railY + 0.6} y2={railY + 0.6} stroke={color}
        strokeWidth={1.1} strokeLinecap="round" opacity={0.55} className={fx ? "loco-rail-glow" : undefined}/>
      {/* headlight pool on the rail ahead — brighter at speed */}
      <ellipse cx={lampX + beamLen * 0.55} cy={railY + 0.6} rx={beamLen * 0.42} ry={h * 0.12}
        fill="url(#locoPoolGrad)" opacity={beamK * 0.8}/>

      {/* ── Body: bobs on its suspension and tilts with acceleration (nose up
           when speeding up, nose down when slowing). Wheels stay on the rail. */}
      <g style={{ transform: `rotate(${tilt.toFixed(2)}deg)`, transformOrigin: `0px ${railY}px`,
                  transition: "transform 0.7s cubic-bezier(0.22,1,0.36,1)" }}>
      <g className="loco-bob" style={bob}>
        {/* beam (drawn first, so the body sits on top of it) */}
        <polygon points={`${lampX},${lampY-lampR*0.6} ${lampX+beamLen},${lampY-beamHalf} ${lampX+beamLen},${lampY+beamHalf} ${lampX},${lampY+lampR*0.6}`}
          fill="url(#locoBeamGrad)" opacity={beamK} className={fx && moving ? "loco-beam-flicker" : undefined}/>

        {/* pantograph — electric loco; blue arc flashes at the contact wire while running */}
        <g stroke={BODY_EDGE} strokeWidth={0.9} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={`M ${w*0.02} ${-h*0.55} L ${w*0.14} ${-h*0.82} L ${w*0.26} ${-h*0.55}`}/>
          <path d={`M ${w*0.14} ${-h*0.82} L ${w*0.06} ${-h*1.0}`}/>
          <line x1={-w*0.06} x2={w*0.2} y1={-h*1.0} y2={-h*1.0} stroke="#cbd5e1" strokeWidth={1.1}/>
        </g>
        {fx && moving && (
          <g data-no-export="true" pointerEvents="none">
            {[{ dx: -w*0.02, dur: "2.3s", dl: "0s" }, { dx: w*0.13, dur: "3.7s", dl: "1.1s" }].map((s, k) => (
              <g key={k} transform={`translate(${s.dx} ${-h*1.02})`}>
                <g className="loco-arc" style={{ animationDuration: s.dur, animationDelay: s.dl }}>
                  <circle r={h*0.28} fill="#60a5fa" opacity={0.45}/>
                  <path d={`M 0 ${-h*0.22} L ${h*0.06} ${-h*0.04} L ${h*0.2} ${-h*0.02} L ${h*0.05} ${h*0.05} L ${h*0.1} ${h*0.24} L 0 ${h*0.08} L ${-h*0.12} ${h*0.2} L ${-h*0.06} ${h*0.02} L ${-h*0.2} ${-h*0.04} L ${-h*0.05} ${-h*0.06} Z`}
                    fill="#e0f2fe"/>
                </g>
              </g>
            ))}
          </g>
        )}

        {/* emergency beacon on the roof (rear) */}
        {inEmergency && (
          <g transform={`translate(${-w*0.36} ${-h*0.62})`}>
            <rect x={-h*0.1} y={-h*0.12} width={h*0.2} height={h*0.14} rx={h*0.04} fill="#7f1d1d"/>
            <circle cy={-h*0.12} r={h*0.13} fill="#ef4444" className={fx ? "loco-beacon" : undefined}/>
            {fx && <circle cy={-h*0.12} r={h*0.5} fill="#ef4444" className="loco-beacon-halo"/>}
          </g>
        )}

        {/* body + nose */}
        <rect x={-w/2} y={-h*0.55} width={w} height={h*0.75} rx={h*0.18}
          fill={BODY} stroke={BODY_EDGE} strokeWidth={1}/>
        <path d={`M ${w/2} ${-h*0.55} L ${w/2+h*0.32} ${-h*0.06} L ${w/2} ${h*0.2} Z`} fill={BODY} stroke={BODY_EDGE} strokeWidth={1} strokeLinejoin="round"/>
        {/* roof highlight — a glossy sheen line along the top */}
        <rect x={-w/2 + h*0.18} y={-h*0.52} width={w - h*0.36} height={h*0.07} rx={h*0.035} fill="#fff7cc" opacity={0.55}/>
        {/* thin stripe in the loco's own identity colour (keeps several locos tellable apart) */}
        <rect x={-w/2 + 1} y={h*0.06} width={w - 2} height={h*0.09} fill={color} opacity={0.9}/>
        {/* cab window — blinks amber on an Overspeed alert */}
        <rect x={-w*0.32} y={-h*0.42} width={w*0.28} height={h*0.32} rx={1.5} fill="#1f2937" opacity={0.85}/>
        {overspeed && (
          <rect x={-w*0.32} y={-h*0.42} width={w*0.28} height={h*0.32} rx={1.5} fill="#f59e0b"
            className={fx ? "loco-overspeed" : undefined} opacity={fx ? undefined : 0.6}/>
        )}
        {/* headlight lamp */}
        <circle cx={lampX} cy={lampY} r={lampR*1.6} fill="#ffffff" opacity={0.2 + beamK * 0.3}/>
        <circle cx={lampX} cy={lampY} r={lampR} fill="#ffffff" stroke={BODY_EDGE} strokeWidth={0.6}/>
        {/* rear brake lights — glow red while any brake is applied */}
        {braking && <>
          <circle cx={-w/2 + h*0.08} cy={-h*0.2} r={h*0.26} fill="#ef4444" opacity={0.25 + brakeLvl * 0.12}
            className={fx ? "loco-brake-glow" : undefined}/>
          <rect x={-w/2 - 0.4} y={-h*0.3} width={h*0.14} height={h*0.2} rx={h*0.04} fill="#ff4d4d"/>
        </>}
      </g>
      </g>

      <Wheel cx={wheelXs[0]}/>
      <Wheel cx={wheelXs[1]}/>

      {/* brake sparks — shower off the wheel/rail contact, backwards and up;
          more of them, and faster, for a heavier brake application */}
      {braking && moving && fx && (
        <g data-no-export="true" pointerEvents="none">
          {wheelXs.flatMap((cx, wi) => Array.from({ length: 2 + brakeLvl }, (_, k) => {
            const ang = 20 + ((k * 37 + wi * 23) % 50);               // 20°–70° up & back
            const len = h * (0.5 + ((k * 13 + wi * 7) % 5) * 0.12);
            const rad = ang * Math.PI / 180;
            return (
              <line key={`${wi}-${k}`} x1={cx} y1={railY} x2={cx - Math.cos(rad) * len} y2={railY - Math.sin(rad) * len}
                stroke={k % 2 ? "#fde047" : "#fb923c"} strokeWidth={0.9} strokeLinecap="round" pathLength={1}
                className="loco-spark" style={{ animationDuration: `${(0.55 - brakeLvl * 0.1).toFixed(2)}s`, animationDelay: `${((k * 0.13 + wi * 0.07) % 0.5).toFixed(2)}s` }}/>
            );
          }))}
        </g>
      )}
    </g>
  );
}

/* ── The SVG track-profile + loco-movement chart ──
   Colours use the app's existing CSS custom properties (var(--...)) rather
   than a JS light/dark branch, matching the rest of SvkSim.jsx — those
   variables already flip automatically with the :root.light class. */
/* Chart height as a fraction of its width. The chart used to stretch to fill
   ALL the vertical space it was given, which on a tall window made the plot
   far too tall. It now keeps this proportion (and still shrinks if the window
   is too short). Lower = flatter, higher = taller. */
const CHART_H_RATIO = 0.36;
// Toolbar row above the chart (layer switcher + zoom): reserved height and gap.
const TOOLBAR_H_PX = 32, TOOLBAR_GAP_PX = 8;

function TrackChart({ layers, locos, primaryId, chainageOffset = 0, absDir = 1, tagLocationMap = null, absKnown = false }) {
  // The viewBox is sized from the container's REAL pixel size divided by a
  // constant UNIT, so the plot always fills the whole area (no letterboxing)
  // and text/marker sizes come out the same physical size on every screen —
  // instead of being blown up 2x on a big monitor by a fixed 1000-unit
  // viewBox. UNIT = screen px per chart unit; it scales with the window
  // (about 1.6 on a 1920px-wide screen, never below 1.0) so text stays big and
  // bold on large monitors yet still fits on small laptops.
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 1250, h: 520 });
  const UNIT = Math.min(1.7, Math.max(1.0, size.w / 1200));
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setSize(prev => (Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1) ? prev : { w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = Math.min(2600, Math.max(560, Math.round(size.w / UNIT)));
  const H_FIT = Math.min(1400, Math.max(260, Math.round((size.h - TOOLBAR_H_PX - TOOLBAR_GAP_PX) / UNIT))); // all the height on offer (minus the toolbar row above the chart)
  const H = Math.max(260, Math.min(H_FIT, Math.round(W * CHART_H_RATIO))); // …but never taller than the ratio cap
  // PAD_T was 54; +12 makes room for the profile-length dimension bar that now
  // sits between the layer toggles and the plot's top edge.
  // PAD_T 66 → 50: the layer bar moved out of the chart box into its own
  // toolbar row above it, so the chart no longer reserves room for it.
  const PAD_L = 50, PAD_R = 24, PAD_T = 50, PAD_B = 76;
  const GW = W - PAD_L - PAD_R, GH = H - PAD_T - PAD_B;

  const locoListAll = Object.values(locos || {});

  const profileMaxDist = Math.max(200, layers?.maxDist || 500);
  const profileSpanTrue = layers?.profileSpanNum || profileMaxDist;

  // ── Smooth growth (see growFrame) ── decided DURING render, against a
  // snapshot of the previous profile, so not even one frame is drawn at the
  // new scale before the animation starts. `epoch` changes only when a
  // genuinely different profile is shown (APD row switch, first live
  // profile, …) — that still plays the full draw-in from 0; a live profile
  // that just got LONGER plays the growth animation instead.
  const growRef = useRef({ layers: undefined, max: 0, span: 0, sspCount: 0, epoch: 0, anim: null, smilReveal: true });
  const [, setGrowTick] = useState(0);
  {
    const g = growRef.current;
    if (layers !== g.layers) {
      const sspCount = (layers?.ssp || []).length;
      const extended = !CINE_REDUCED && layers?.source === "live" && g.layers?.source === "live"
        && profileMaxDist > g.max + 1;
      if (extended) {
        const now = performance.now();
        const cur = growFrame(g.anim, now); // a 2nd route mid-animation continues from what's on screen
        g.anim = {
          fromMax: cur ? cur.scaleMax : g.max, fromDrawn: cur ? cur.drawnTo : g.max,
          fromSpan: cur ? cur.span : g.span, toMax: profileMaxDist, toSpan: profileSpanTrue, t0: now,
        };
      } else if (Math.round(profileMaxDist) !== Math.round(g.max) || sspCount !== g.sspCount || !layers !== !g.layers) {
        g.epoch += 1;
        // First LIVE profile (nothing drawn before it): the same drawing head
        // as an appended route, sweeping the WHOLE profile in from 0 m — the
        // axis is already at its final length, only the drawing moves. Every
        // other new profile (e.g. an APD TABLE ROW pick) keeps the original
        // SSP reveal.
        const firstLive = !CINE_REDUCED && layers?.source === "live" && hasProfileGeometry(layers)
          && !hasProfileGeometry(g.layers);
        g.anim = firstLive ? {
          fromMax: profileMaxDist, toMax: profileMaxDist, fromDrawn: 0, fromSpan: 0, toSpan: profileSpanTrue,
          delay: FIRST_DRAW_DELAY, dur: FIRST_DRAW_MS, t0: performance.now(),
        } : null;
        g.smilReveal = !firstLive;
      }
      Object.assign(g, { layers, max: profileMaxDist, span: profileSpanTrue, sspCount });
    }
  }
  const growAnim = growRef.current.anim;
  const gf = growFrame(growAnim, typeof performance !== "undefined" ? performance.now() : 0);
  const profileEpoch = growRef.current.epoch;
  // false while the first LIVE profile uses the drawing head instead.
  const smilReveal = growRef.current.smilReveal;
  useEffect(() => {
    if (!growAnim) return;
    let raf;
    const step = () => {
      if (growRef.current.anim !== growAnim) return;
      if (!growFrame(growAnim, performance.now())) growRef.current.anim = null;
      setGrowTick(n => n + 1);
      if (growRef.current.anim) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [growAnim]);
  // Profile length used to FIT the x-axis — the animated value while growing.
  const fitProfileMax = gf ? gf.scaleMax : profileMaxDist;

  // A loco can sit a little before/after this profile (approaching, or just
  // past the end) and the chart still widens to include it. One that is
  // FAR from the profile — a glitchy/zeroed ABS_LOCO_LOC, a stale loco, the
  // wrong profile selected — must not be allowed to stretch the x-axis, or the
  // real profile is squashed into a sliver. Such locos are left off the chart
  // (and named in a small notice) instead.
  const NEAR_MARGIN_M = Math.max(1500, profileMaxDist);
  const nearProfile = d => typeof d === "number" && Number.isFinite(d)
    && d >= -NEAR_MARGIN_M && d <= profileMaxDist + NEAR_MARGIN_M;
  const locoList = locoListAll.filter(l => !Number.isFinite(l.monoDist) || nearProfile(l.monoDist));
  const offProfileLocos = locoListAll.filter(l => Number.isFinite(l.monoDist) && !nearProfile(l.monoDist));
  const allSpeeds = [
    ...(layers?.ssp || []).flatMap(s => s.universal ? [s.speed] : [s.speedA, s.speedB, s.speedC]),
    ...(layers?.turnouts || []).map(t => t.speed),
  ].filter(v => v > 0);
  // "Nice" y-axis: a round step (10/20/30/40/50/100 kmph) so the gridlines
  // read 0, 30, 60, 90 … instead of arbitrary quarter-fractions (33, 65, 98).
  const rawMaxSpeed = Math.max(40, allSpeeds.length ? Math.max(...allSpeeds) : 40);
  const yStep = [10, 20, 30, 40, 50, 100].find(st => rawMaxSpeed / st <= 7) || 100;
  const maxSpeed = Math.ceil(rawMaxSpeed / yStep) * yStep;
  const yTicks = Array.from({ length: Math.round(maxSpeed / yStep) + 1 }, (_, i) => i * yStep);

  // ── Expand the chart to fit the loco, not just the profile ──────────
  // A loco's position (monoDist) is computed from its own real ABS_LOCO_LOC
  // once calibrated against the RFID Tag Table — it has no reason to fall
  // neatly inside [0, profile length]. Clamping it to that range (the old
  // behaviour) just pinned the icon to whichever edge it overshot, hiding
  // where it actually is. So the visible domain now grows to cover every
  // tracked loco's current position too, with a small margin so the
  // marker/info-card never sit flush on the very edge.
  const locoDists = locoList.map(l => l.monoDist).filter(v => typeof v === "number" && Number.isFinite(v));
  let fitMin = 0, fitMax = fitProfileMax;
  if (locoDists.length) {
    const lo = Math.min(0, ...locoDists);
    const hi = Math.max(fitProfileMax, ...locoDists);
    const span = Math.max(hi - lo, 200);
    fitMin = lo - span * 0.06;
    fitMax = hi + span * 0.06;
  }

  // ── Zoom ── "Fit" (zoom = 1) always shows everything computed above; a
  // higher zoom shrinks the visible span, re-centred on the primary loco
  // when one is being tracked (otherwise the middle of the fitted range),
  // and re-clamped every render so panning never opens a gap past either
  // end of the actual data. Once the person manually zooms (mouse wheel)
  // or pans (middle-mouse drag) — see the effect/handlers below — that
  // manual centre point takes over from the auto-follow-the-loco one,
  // until "⟲ FIT" is clicked to resume auto-following.
  const [zoom, setZoom] = useState(1);
  const [manualCenter, setManualCenter] = useState(null);
  const [isZooming, setIsZooming] = useState(false);
  const zoomTimeoutRef = useRef(null);
  // Which profile layers are currently shown — lets the person declutter
  // the chart down to just what they care about right now (e.g. only SSP +
  // RFID tags while chasing a speed-restriction issue), or bring everything
  // back with one click. All on by default.
  const [visibleLayers, setVisibleLayers] = useState({
    ssp: true, gradient: true, lcGates: true, turnouts: true, trackConds: true, tags: true, signals: true, eoa: true, brakes: true,
  });
  // Key of the brake dot the mouse is currently over (drives the popup).
  const [hoverBrake, setHoverBrake] = useState(null);
  const fitSpan = fitMax - fitMin;
  const viewSpan = fitSpan / zoom;
  const focusAuto = (() => {
    const primary = locoList.find(l => l.locoId === primaryId);
    if (primary && typeof primary.monoDist === "number" && Number.isFinite(primary.monoDist)) return primary.monoDist;
    return (fitMin + fitMax) / 2;
  })();
  const focus = manualCenter != null ? manualCenter : focusAuto;
  let domainMin = focus - viewSpan / 2, domainMax = focus + viewSpan / 2;
  if (domainMin < fitMin) { domainMax += fitMin - domainMin; domainMin = fitMin; }
  if (domainMax > fitMax) { domainMin -= domainMax - fitMax; domainMax = fitMax; }
  domainMin = Math.max(domainMin, fitMin);
  const domainSpan = domainMax - domainMin;

  // ── Up-line vs Down-line orientation ─────────────────────────────────
  // The loaded APD row's own "Line" column (e.g. "Down Main" / "Up Main")
  // says which physical line this profile belongs to. A Down-line loco is
  // drawn left-to-right (chainage 0 on the left, growing rightward — the
  // existing/default behaviour). An Up-line loco runs the opposite way on
  // the ground, so its chart is mirrored: chainage 0 sits on the RIGHT and
  // grows leftward, and the loco (and everything else on the x-axis) is
  // drawn moving right-to-left instead. Every x-position in this chart is
  // computed through xS() below, so mirroring it there is the one change
  // that flips the whole picture consistently.
  const isUpLine = /^\s*up\b/i.test(String(layers?.line || ""));
  const xS = d => isUpLine
    ? PAD_L + GW - (d - domainMin) / domainSpan * GW
    : PAD_L + (d - domainMin) / domainSpan * GW;
  const yS = s => PAD_T + (1 - Math.max(0, Math.min(s, maxSpeed)) / maxSpeed) * GH;
  // Pixel x of the drawing head while a newly appended route is drawn in.
  const growDrawnX = gf ? xS(gf.drawnTo) : null;
  // A fixed-size badge (EOA, a turnout circle, a signal post, …) centred
  // exactly at the plot's clipped edge gets its far half sliced clean off —
  // it's a small discrete shape, so cutting it mid-way reads as broken,
  // unlike a continuous line/path which can meaningfully be clipped.
  // clampX keeps a badge's CENTRE far enough inside the plot rectangle that
  // its whole footprint (±halfWidth) always stays visible — it slides
  // inward near an edge instead of being truncated.
  const clampX = (x, halfWidth) => Math.min(Math.max(x, PAD_L + halfWidth), PAD_L + GW - halfWidth);
  // clampX is ONLY for sliding a badge/label inward when its TRUE position is
  // at (or within a badge-width of) an edge. It must never be applied to a
  // position that is genuinely outside the visible domain — that is what made
  // the EOA badge stay glued to the plot edge after zooming/panning away from
  // it. inPlotX() tells the two cases apart: outside the plot → don't draw.
  const PLOT_R = PAD_L + GW;
  const inPlotX = x => Number.isFinite(x) && x >= PAD_L - 0.5 && x <= PLOT_R + 0.5;
  const axisC  = "var(--text-secondary)";
  const gridC  = "var(--border)";
  const textC  = "var(--text-dim)";

  // ── Mouse wheel = zoom in/out at the cursor; middle-mouse drag = pan ──
  // Live values are mirrored into refs every render so the wheel handler
  // (registered once, below, since wheel needs a non-passive native
  // listener to be allowed to preventDefault the page scroll) always sees
  // the CURRENT domain/zoom rather than whatever was current when the
  // listener was first attached.
  const svgRef = useRef(null);
  const plotClipId = useRef(`plotClip-${Math.random().toString(36).slice(2)}`).current;
  const tagClipId  = useRef(`tagClip-${Math.random().toString(36).slice(2)}`).current;
  // Cinematic-dressing ids (gradients/filters) — visuals only, see <defs>.
  const plotBgId       = useRef(`plotBg-${Math.random().toString(36).slice(2)}`).current;
  const plotVignetteId = useRef(`plotVig-${Math.random().toString(36).slice(2)}`).current;
  const sweepGradId    = useRef(`sweep-${Math.random().toString(36).slice(2)}`).current;
  const bloomSoftId    = useRef(`bloom-${Math.random().toString(36).slice(2)}`).current;
  const trailGlowId    = useRef(`trailGlow-${Math.random().toString(36).slice(2)}`).current;
  const sspRevealId    = useRef(`sspReveal-${Math.random().toString(36).slice(2)}`).current;
  const growClipId     = useRef(`growClip-${Math.random().toString(36).slice(2)}`).current;
  const scanGradId     = useRef(`scan-${Math.random().toString(36).slice(2)}`).current;
  const cineIds = useRef((() => {
    const u = p => `${p}-${Math.random().toString(36).slice(2)}`;
    return { auroraA: u("auroraA"), auroraB: u("auroraB"), envelope: u("envelope"), hatch: u("hatch"),
             beamRed: u("beamRed"), beamCyan: u("beamCyan"), scanlines: u("scanlines"), restrictFill: u("restrictFill"),
             tcStatic: u("tcStatic"), tcStripes: u("tcStripes"), tcChecker: u("tcChecker"), tcFade: u("tcFade") };
  })()).current;
  const domainMinRef = useRef(domainMin);
  const domainSpanRef = useRef(domainSpan);
  const fitSpanRef = useRef(fitSpan);
  const isUpLineRef = useRef(isUpLine);
  const zoomRef = useRef(zoom);
  const focusRef = useRef(focus);
  domainMinRef.current = domainMin;
  domainSpanRef.current = domainSpan;
  fitSpanRef.current = fitSpan;
  isUpLineRef.current = isUpLine;
  zoomRef.current = zoom;
  focusRef.current = focus;

  const dragRef = useRef(null);
  const [isPanning, setIsPanning] = useState(false);
  // Hover crosshair — viewBox coordinates of the cursor while it's over the
  // plot (null otherwise). Updated at most once per animation frame so a
  // fast mouse can't flood the chart with re-renders.
  const [hoverPt, setHoverPt] = useState(null);
  const hoverRafRef = useRef(null);
  const hoverPendingRef = useRef(null);
  const handleSvgMouseMove = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    const vx = (e.clientX - rect.left) / rect.width * W;
    const vy = (e.clientY - rect.top) / rect.height * H;
    const inside = vx >= PAD_L && vx <= PAD_L + GW && vy >= PAD_T && vy <= PAD_T + GH;
    hoverPendingRef.current = inside ? { x: vx, y: vy } : null;
    if (hoverRafRef.current == null) {
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        setHoverPt(hoverPendingRef.current);
      });
    }
  };
  const handleSvgMouseLeave = () => {
    hoverPendingRef.current = null;
    if (hoverRafRef.current != null) { cancelAnimationFrame(hoverRafRef.current); hoverRafRef.current = null; }
    setHoverPt(null);
  };
  useEffect(() => () => { if (hoverRafRef.current != null) cancelAnimationFrame(hoverRafRef.current); }, []);
  const prevZoomRef = useRef(zoom);

  // Detect zoom changes and disable loco transition during zoom
  useEffect(() => {
    if (prevZoomRef.current !== zoom) {
      prevZoomRef.current = zoom;
      setIsZooming(true);
      clearTimeout(zoomTimeoutRef.current);
      zoomTimeoutRef.current = setTimeout(() => setIsZooming(false), 300);
    }
  }, [zoom]);

  // ── Detect PIXEL-SCALE changes and disable the loco transition then too ──
  // `isZooming` above only catches a manual mouse-wheel zoom (it watches the
  // `zoom` state). But xS()/yS() also change whenever:
  //   - the container is resized (ResizeObserver → size → GW/GH change), or
  //   - the auto-fit domain widens/narrows (fitMin/fitMax → domainSpan
  //     change) as the loco approaches/passes the profile edge, even though
  //     `zoom` itself is still 1.
  // When that happens, xS(monoDist)/yS(speed) suddenly map to a DIFFERENT
  // pixel scale than the previous render. The marker's <g> still has its
  // 1.6s CSS transition, so the browser tweens between the old translate
  // (old scale) and new translate (new scale) as if it were a normal
  // movement — visibly dragging the icon off the trail/curve for up to
  // 1.6s, even though the trail path and the frozen brake-event dots are
  // redrawn instantly and are always correct. Comparing GW/GH/domainSpan
  // across renders and forcing an instant (no-transition) snap on the
  // render where they actually change fixes this without touching the
  // normal smooth glide between ordinary position updates.
  // NOTE: this must be a plain value computed during render (comparing
  // against a ref snapshot of the LAST render), not state-set-in-an-effect —
  // an effect only runs after commit, which would mean the very render
  // whose scale changed (the one that needs the instant snap) still used
  // the old "no change" transition, i.e. exactly the one-render-late bug
  // this fix exists to close.
  const scaleSnapshotRef = useRef({ GW, GH, domainSpan, isUpLine });
  const prevScale = scaleSnapshotRef.current;
  const SCALE_EPS = 0.5; // px — ignores sub-pixel ResizeObserver noise
  const scaleJustChanged =
    Math.abs(prevScale.GW - GW) > SCALE_EPS ||
    Math.abs(prevScale.GH - GH) > SCALE_EPS ||
    Math.abs(prevScale.domainSpan - domainSpan) > SCALE_EPS ||
    prevScale.isUpLine !== isUpLine;
  scaleSnapshotRef.current = { GW, GH, domainSpan, isUpLine };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      // Cursor's current position on the DOMAIN axis, so it's the point
      // that stays fixed under the cursor as the zoom changes (the usual
      // "zoom toward what you're pointing at" feel) rather than the view
      // re-centring on whatever the loco happens to be doing.
      const fracX = (e.clientX - rect.left) / rect.width;
      const vbX = fracX * W;
      const dm = domainMinRef.current, ds = domainSpanRef.current;
      if (!ds) return;
      const d0 = isUpLineRef.current
        ? dm + (PAD_L + GW - vbX) / GW * ds
        : dm + (vbX - PAD_L) / GW * ds;
      const dir = e.deltaY < 0 ? 1 : -1; // wheel up/away = zoom in
      const factor = Math.exp(dir * 0.18);
      const newZoom = Math.min(20, Math.max(1, zoomRef.current * factor));
      const newSpan = fitSpanRef.current / newZoom;
      const frac = (d0 - dm) / ds;
      setZoom(newZoom);
      setManualCenter(d0 + newSpan * (0.5 - frac));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Middle mouse button (the "scroll button") press-and-drag pans the
  // chart — cursor switches to a grabbing hand for the duration of the
  // drag, and releasing the button (anywhere on the page, not just over
  // the chart) ends it.
  const handleSvgMouseDown = (e) => {
    if (e.button !== 1) return; // middle button only
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    dragRef.current = { startClientX: e.clientX, startCenter: focusRef.current, rectWidth: rect.width };
    setIsPanning(true);
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dxPx = ev.clientX - d.startClientX;
      const dxViewBox = dxPx / d.rectWidth * W;
      const dxDomain = dxViewBox / GW * domainSpanRef.current;
      // Dragging right pulls earlier chainage into view, like grabbing a
      // physical strip of the profile and sliding it under the cursor.
      // On a mirrored (Up-line) chart, chainage runs the opposite way
      // across the same pixels, so the sign flips too — otherwise the
      // profile would slide backwards under the cursor.
      setManualCenter(d.startCenter + (isUpLine ? 1 : -1) * dxDomain);
    };
    const endDrag = () => {
      dragRef.current = null;
      setIsPanning(false);
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", endDrag);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", endDrag);
  };

  // ── "Touching" detection — dims the profile chrome directly behind a
  // loco icon and brightens the icon itself, so the two never visually
  // fight for attention where they meet (a marker board, the SSP line, a
  // turnout, an LC gate, …). Two flavours of proximity:
  //   • TOUCH_PX_X  — point/line features anchored at a single chainage
  //     (RFID tags, turnouts, LC gates, SSP boundaries, signals): "touching"
  //     just means the loco has reached that x — its own vertical position
  //     on the chart doesn't matter, since these are markers for a place
  //     along the track, not something drawn at a particular speed.
  //   • TOUCH_PX_XY — the SSP speed line itself: this one genuinely has a
  //     y (a speed) at every x, so "touching" means the icon's actual
  //     plotted position (its real reported speed) is close to that line,
  //     not just that it's crossing that chainage underneath or above it.
  const TOUCH_PX_X = 14;
  const TOUCH_PX_XY = 11;
  const universalSSP = (layers?.ssp || []).filter(s => s.universal);
  const locoScreenPos = locoList
    .filter(l => l.monoDist != null)
    .map(l => ({ id: l.locoId, x: xS(l.monoDist), y: yS(l.speed || 0), dist: l.monoDist }));
  const nearLocoX = px => locoScreenPos.some(p => Math.abs(p.x - px) <= TOUCH_PX_X);
  const nearLocoXY = (px, py) => locoScreenPos.some(p => Math.hypot(p.x - px, p.y - py) <= TOUCH_PX_XY);
  // One "is this loco touching ANYTHING" flag per loco, reused for the
  // icon's own bright/glow treatment — same feature checks as the
  // individual dim conditions below, just from the loco's side.
  const touchingMap = {};
  locoList.forEach(l => {
    if (l.monoDist == null) { touchingMap[l.locoId] = false; return; }
    const lx = xS(l.monoDist), ly = yS(l.speed || 0);
    const onSsp = Math.abs(yS(speedAtDistance(universalSSP, l.monoDist) ?? -999) - ly) <= TOUCH_PX_XY;
    const pointDists = [
      ...(layers?.tli || []).map(t => t.cumDist),
      ...(layers?.turnouts || []).map(t => t.startCumDist ?? t.startDist),
      ...(layers?.lcGates || []).map(g => g.cumDist ?? g.distance),
    ];
    const onPoint = pointDists.some(d => Math.abs(xS(d) - lx) <= TOUCH_PX_X);
    const inBand = (layers?.trackConds || []).some(tc => {
      const start = tc.startCumDist ?? tc.start;
      return l.monoDist >= start && l.monoDist <= start + tc.length;
    });
    touchingMap[l.locoId] = onSsp || onPoint || inBand;
  });

  /* SSP step path (universal entries only — classified A/B/C shown via title tooltip).
     Each entry's raw `distance` is a DELTA from the previous entry (same
     convention as the TLI/RFID layer), already accumulated into `cumDist`
     at decode time — so entries must be walked in their original wire
     order and plotted at cumDist, never re-sorted by the raw delta value
     (sorting scrambles a 130→40→130 kmph sequence into 130→130→40 and
     drops the final segment). */
  const { sspPath, sspLabels, sspBoundaries } = useMemo(() => {
    const entries = (layers?.ssp || []).filter(s => s.universal);
    if (!entries.length) return { sspPath: "", sspLabels: [], sspBoundaries: [] };
    let d = "", prevDist = 0;
    const labels = [];
    // One boundary marker at chainage 0 (start of the very first segment),
    // then one at the END of every segment — since segment i's end IS
    // segment i+1's start, this also gives every interior "from → to"
    // transition without duplicating a boundary for each side.
    const boundaries = [0];
    d += `M ${xS(0)} ${yS(entries[0].speed)} `;
    entries.forEach(e => {
      const cum = e.cumDist ?? e.distance;
      d += `L ${xS(prevDist)} ${yS(e.speed)} L ${xS(cum)} ${yS(e.speed)} `;
      labels.push({ x: (xS(prevDist) + xS(cum)) / 2, y: yS(e.speed), speed: e.speed, len: cum - prevDist, from: prevDist, to: cum });
      boundaries.push(cum);
      prevDist = cum;
    });
    return { sspPath: d, sspLabels: labels, sspBoundaries: boundaries };
  }, [layers, domainMin, domainMax, maxSpeed, GW, GH, isUpLine]);

  /* Gradient ribbon segments (thin strip under the x-axis). Same delta-chain
     convention as SSP — walk in wire order using the accumulated cumDist,
     never sort by the raw per-entry distance. */
  const gradSegs = useMemo(() => {
    const entries = layers?.gradient || [];
    let prev = 0;
    return entries.map(g => {
      const cum = g.cumDist ?? g.distance;
      const seg = { x1: xS(prev), x2: xS(cum), uphill: g.uphill, grade: g.gradeCode };
      prev = cum;
      return seg;
    });
  }, [layers, domainMin, domainMax, GW, isUpLine]);

  const xTicks = useMemo(() => {
    const step = domainSpan <= 1000 ? 100 : domainSpan <= 5000 ? 500 : 1000;
    const start = Math.ceil(domainMin / step) * step;
    const out = [];
    for (let d = start; d <= domainMax; d += step) out.push(d);
    return out;
  }, [domainMin, domainMax, domainSpan]);

  return (
    <div ref={wrapRef} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
    <style>{`
      @keyframes locoWheelSpin { to { transform: rotate(360deg); } }
      .loco-wheel {
        transform-box: fill-box; transform-origin: center;
        animation-name: locoWheelSpin; animation-timing-function: linear;
        animation-iteration-count: infinite;
      }
      @media (prefers-reduced-motion: reduce) { .loco-wheel { animation: none; } }
      /* ── Loco icon cinematics (see LocoIcon): suspension bob, rail glow,
         headlight flicker, pantograph arcs, emergency beacon + strobe,
         overspeed cab blink, brake lights + wheel sparks, tag-pass burst. ── */
      @keyframes locoBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-0.7px); } }
      .loco-bob { animation: locoBob 0.5s ease-in-out infinite; }
      @keyframes locoRailGlow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.8; } }
      .loco-rail-glow { animation: locoRailGlow 1.8s ease-in-out infinite; }
      @keyframes locoBeamFlicker { 0%, 44%, 56%, 100% { filter: brightness(1); } 48% { filter: brightness(1.3); } 51% { filter: brightness(0.8); } 53% { filter: brightness(1.2); } }
      .loco-beam-flicker { animation: locoBeamFlicker 3.3s linear infinite; }
      @keyframes locoArc { 0%, 84%, 100% { opacity: 0; transform: scale(0.5); } 86% { opacity: 1; transform: scale(1.15); }
        89% { opacity: 0.25; } 91% { opacity: 1; transform: scale(0.9); } 95% { opacity: 0; transform: scale(1); } }
      .loco-arc { animation: locoArc 2.3s linear infinite; transform-box: fill-box; transform-origin: center; opacity: 0; }
      @keyframes locoBeacon { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
      .loco-beacon { animation: locoBeacon 0.5s steps(2, jump-none) infinite; }
      @keyframes locoBeaconHalo { 0% { opacity: 0.7; transform: scale(0.4); } 100% { opacity: 0; transform: scale(1.7); } }
      .loco-beacon-halo { animation: locoBeaconHalo 0.5s ease-out infinite; transform-box: fill-box; transform-origin: center; }
      @keyframes locoStrobe { 0%, 22%, 44%, 100% { opacity: 0; } 8%, 30% { opacity: 0.55; } }
      .loco-strobe { animation: locoStrobe 1.2s linear infinite; }
      @keyframes locoOverspeed { 0%, 100% { opacity: 0.85; } 50% { opacity: 0.12; } }
      .loco-overspeed { animation: locoOverspeed 0.6s ease-in-out infinite; }
      @keyframes locoBrakeGlow { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.85; } }
      .loco-brake-glow { animation: locoBrakeGlow 0.7s ease-in-out infinite; }
      @keyframes locoSpark { 0% { stroke-dashoffset: 0.3; opacity: 1; } 100% { stroke-dashoffset: -1; opacity: 0; } }
      .loco-spark { stroke-dasharray: 0.3 1; animation: locoSpark 0.5s linear infinite; }
      @keyframes locoTagBurst { 0% { opacity: 1; transform: scale(0.4); } 100% { opacity: 0; transform: scale(3.4); } }
      .loco-tag-burst { animation: locoTagBurst 1.1s ease-out 2 both; transform-box: fill-box; transform-origin: center; }
      @keyframes locoTagFlash { 0%, 100% { filter: none; } 20%, 60% { filter: brightness(1.8) drop-shadow(0 0 4px #bef264); } }
      .loco-tag-flash { animation: locoTagFlash 1.1s ease-in-out 2; }
      @media (prefers-reduced-motion: reduce) {
        .loco-bob, .loco-rail-glow, .loco-beam-flicker, .loco-beacon, .loco-beacon-halo, .loco-strobe,
        .loco-overspeed, .loco-brake-glow, .loco-tag-flash { animation: none; }
        .loco-arc, .loco-spark, .loco-tag-burst, .loco-beacon-halo, .loco-strobe { animation: none; opacity: 0; }
      }
      @keyframes locoPopIn {
        0%   { opacity: 0;   transform: scale(0.55) translateY(6px); }
        55%  { opacity: 1;   transform: scale(1.08)  translateY(-2px); }
        100% { opacity: 1;   transform: scale(1)      translateY(0); }
      }
      .live-track-pop {
        animation: locoPopIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
        transform-origin: center bottom;
      }
      @keyframes locoPingAnim {
        0%   { opacity: 0.85; transform: scale(0.5); }
        100% { opacity: 0;    transform: scale(2.1); }
      }
      .live-track-ping {
        animation: locoPingAnim 0.7s ease-out both;
        transform-origin: center;
        transform-box: fill-box;
      }
      @keyframes locoPingAnim2 {
        0%   { opacity: 0.5; transform: scale(0.5); }
        100% { opacity: 0;   transform: scale(2.7); }
      }
      .live-track-ping-2 {
        animation: locoPingAnim2 0.95s ease-out 0.08s both;
        transform-origin: center;
        transform-box: fill-box;
      }
      /* Idle "breathing" glow behind every loco icon — subtle at rest, and
         scaled up (via CSS var --pulseSpeed set inline per-loco) so a faster
         loco reads as visibly more energetic even before you look at its
         speed card. */
      @keyframes locoIdlePulse {
        0%, 100% { opacity: 0.35; transform: scale(0.92); }
        50%      { opacity: 0.7;  transform: scale(1.08); }
      }
      .live-track-idle-glow {
        animation: locoIdlePulse var(--pulseSpeed, 2.2s) ease-in-out infinite;
        transform-origin: center;
        transform-box: fill-box;
      }
      /* Slow-drifting energy dashes along the movement trail — a cinematic
         "current flowing through the line" read, purely decorative (drawn
         on top of the real, static trail path so the plotted data itself
         never moves). */
      @keyframes trailFlow { to { stroke-dashoffset: -300; } }
      .live-track-trail-flow { animation: trailFlow 9s linear infinite; }
      /* Very slow ambient shimmer on the dashed speed gridlines, staggered
         per-line via animation-delay so they don't all pulse in lockstep. */
      @keyframes gridShimmer { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.95; } }
      .live-track-grid-shimmer { animation: gridShimmer 5.5s ease-in-out infinite; }
      /* Card entrance: a soft blur-to-sharp resolve, layered with the
         existing pop-in scale/translate above. */
      @keyframes cardResolve { from { opacity: 0; filter: blur(3px); } to { opacity: 1; filter: blur(0); } }
      .live-track-pop { animation: locoPopIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both,
                                    cardResolve 0.35s ease-out both; }
      /* Faint horizontal sweep drifting across the plot background — the
         "scanning HUD" cinematic touch. Kept very low-opacity so it never
         competes with the data. */
      @keyframes hudSweep { from { transform: translateX(-35%); } to { transform: translateX(135%); } }
      .live-track-sweep { animation: hudSweep 7s linear infinite; }
      /* ── Extreme cinematic layer — every effect below is decoration only ── */
      @keyframes cineRise { from { opacity: 0; transform: translateY(12px) scale(0.94); } to { opacity: 1; transform: none; } }
      .live-track-rise { animation: cineRise 0.8s cubic-bezier(0.22,1,0.36,1) backwards; animation-delay: var(--d, 0s);
        transform-box: fill-box; transform-origin: center; }
      @keyframes cineDrop { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: none; } }
      .live-track-drop { animation: cineDrop 0.65s cubic-bezier(0.34,1.56,0.64,1) backwards; animation-delay: var(--d, 0s);
        transform-box: fill-box; transform-origin: center; }
      @keyframes neonPulse {
        0%, 100% { filter: drop-shadow(0 0 2px rgba(52,211,153,0.55)); }
        50%      { filter: drop-shadow(0 0 7px rgba(52,211,153,1)); }
      }
      .live-track-neon { animation: neonPulse 3.2s ease-in-out infinite; }
      @keyframes marchDash { to { stroke-dashoffset: -16; } }
      .live-track-march { animation: marchDash 1.1s linear infinite; }
      @keyframes marchDashSm { to { stroke-dashoffset: -8; } }
      .live-track-march-sm { animation: marchDashSm 1.8s linear infinite; }
      @keyframes particleRise {
        0%   { transform: translate(0,0); opacity: 0; }
        18%  { opacity: 0.8; }
        100% { transform: translate(var(--dx, 0px), -110px); opacity: 0; }
      }
      .live-track-particle { animation: particleRise var(--dur, 9s) ease-in-out infinite; animation-delay: var(--dl, 0s);
        transform-box: fill-box; }
      @keyframes cornerPulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
      .live-track-corner { animation: cornerPulse 3s ease-in-out infinite; }
      @keyframes borderBreath { 0%, 100% { opacity: 0.18; } 50% { opacity: 0.6; } }
      .live-track-border { animation: borderBreath 4.5s ease-in-out infinite; }
      @keyframes streakFlow { to { stroke-dashoffset: -12; } }
      .live-track-streak { animation: streakFlow 0.5s linear infinite; }
      @keyframes brakeRipple { 0% { opacity: 0.9; transform: scale(1); } 100% { opacity: 0; transform: scale(3.4); } }
      .live-track-brake-ripple { animation: brakeRipple 1.8s ease-out infinite; transform-box: fill-box; transform-origin: center; }
      @keyframes puffRise {
        0%   { opacity: 0.6; transform: translate(0,0) scale(0.5); }
        100% { opacity: 0;   transform: translate(-7px,-18px) scale(1.8); }
      }
      .live-track-puff { animation: puffRise 1.35s ease-out infinite; transform-box: fill-box; transform-origin: center; }
      @keyframes spanDraw { from { transform: scaleX(0); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }
      .live-track-span-draw { animation: spanDraw 1.1s cubic-bezier(0.22,1,0.36,1) 0.3s backwards; }
      @keyframes spanCap { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: none; } }
      .live-track-span-cap { animation: spanCap 0.5s cubic-bezier(0.34,1.56,0.64,1) 1s backwards; transform-box: fill-box; transform-origin: center; }
      @keyframes spanLabel { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      .live-track-span-label { animation: spanLabel 0.7s cubic-bezier(0.22,1,0.36,1) 0.8s backwards; transform-box: fill-box; transform-origin: center; }
      @keyframes stageIn { from { opacity: 0; filter: blur(6px); transform: scale(0.985); } to { opacity: 1; filter: none; transform: none; } }
      .live-track-stage { animation: stageIn 1s cubic-bezier(0.22,1,0.36,1) backwards; }
      .cine-toggle { transition: transform 0.15s, box-shadow 0.2s, background 0.2s; }
      .cine-toggle:hover { transform: translateY(-1px); }
      .cine-toggle[data-on="true"]:hover { box-shadow: 0 0 12px -2px currentColor; }
      .layer-bar {
        --lb-border: rgba(148,163,184,0.18);
        --lb-off-border: rgba(148,163,184,0.16);
        --lb-hover-bg: rgba(148,163,184,0.10);
        --lb-on-text: #e2e8f0;
        border: 1px solid var(--lb-border);
        background: linear-gradient(180deg, rgba(30,41,59,0.72), rgba(15,23,42,0.78));
        box-shadow: 0 8px 24px -8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05);
      }
      :root.light .layer-bar {
        --lb-border: rgba(15,23,42,0.12);
        --lb-off-border: rgba(15,23,42,0.12);
        --lb-hover-bg: rgba(15,23,42,0.06);
        --lb-on-text: #0f172a;
        background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(241,245,249,0.92));
        box-shadow: 0 6px 18px -8px rgba(15,23,42,0.28), inset 0 1px 0 rgba(255,255,255,0.8);
      }
      .layer-chip { transition: background 0.18s, border-color 0.18s, box-shadow 0.18s, opacity 0.18s, color 0.18s, transform 0.12s; }
      .layer-chip:hover { opacity: 1 !important; color: var(--lb-on-text) !important; border-color: var(--chip) !important; transform: translateY(-1px); }
      .layer-chip[data-on="false"]:hover { background: var(--lb-hover-bg) !important; }
      .layer-chip:active { transform: translateY(0) scale(0.97); }
      .layer-chip:focus-visible, .layer-quick:focus-visible { outline: 2px solid var(--chip, #7dd3fc); outline-offset: 2px; }
      .layer-quick { transition: background 0.15s, color 0.15s; }
      .layer-quick:not(:disabled):hover { background: var(--lb-hover-bg) !important; color: var(--lb-on-text) !important; }
      @media (prefers-reduced-motion: reduce) { .layer-chip, .layer-quick { transition: none; } .layer-chip:hover { transform: none; } }
      /* ── Cinematic layer 2: aurora, speed envelope, restriction zones,
         tag sonar, START/EOA beams, crosshair. Decoration only. ── */
      @keyframes auroraDriftA { 0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.55; } 50% { transform: translate(8%, 6%) scale(1.15); opacity: 0.9; } }
      @keyframes auroraDriftB { 0%, 100% { transform: translate(0, 0) scale(1.1); opacity: 0.7; } 50% { transform: translate(-10%, -4%) scale(0.95); opacity: 0.4; } }
      .live-track-aurora-a { animation: auroraDriftA 16s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
      .live-track-aurora-b { animation: auroraDriftB 21s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
      @keyframes envelopeBreath { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
      .live-track-envelope { animation: envelopeBreath 5s ease-in-out infinite; }
      @keyframes restrictPulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
      .live-track-restrict { animation: restrictPulse 2.4s ease-in-out infinite; }
      @keyframes restrictHatch { to { transform: translateX(12px); } }
      .live-track-restrict-hatch { animation: restrictHatch 1.6s linear infinite; }
      @keyframes sonarPing { 0% { opacity: 0.85; transform: scale(0.6); } 70% { opacity: 0; transform: scale(3.2); } 100% { opacity: 0; transform: scale(3.2); } }
      .live-track-sonar { animation: sonarPing 3.6s cubic-bezier(0.22,1,0.36,1) infinite; animation-delay: var(--d, 0s);
        transform-box: fill-box; transform-origin: center; opacity: 0; }
      @keyframes beamPulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.85; } }
      .live-track-beam { animation: beamPulse var(--beam, 2.8s) ease-in-out infinite; }
      @keyframes crossIn { from { opacity: 0; } to { opacity: 1; } }
      .live-track-cross { animation: crossIn 0.18s ease-out both; }
      /* ── Sub-packet markers: track conditions, LC gates, turnouts ── */
      @keyframes tcStatic { 0%, 100% { opacity: 0.05; } 12% { opacity: 0.22; } 18% { opacity: 0.06; } 46% { opacity: 0.18; } 52% { opacity: 0.04; } 80% { opacity: 0.16; } }
      .ltp-tc-static { animation: tcStatic 1.9s steps(1, end) infinite; }
      @keyframes tcStripes { to { transform: translateX(14px); } }
      .ltp-tc-stripes { animation: tcStripes 1.4s linear infinite; }
      @keyframes tcPulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
      .ltp-tc-pulse { animation: tcPulse 1.6s ease-in-out infinite; }
      @keyframes tcArc { 0% { opacity: 0; transform: scale(0.55); } 35% { opacity: 0.95; } 100% { opacity: 0; transform: scale(1.5); } }
      .ltp-tc-arc { animation: tcArc 1.8s ease-out infinite; transform-box: fill-box; transform-origin: left center; }
      @keyframes tcSlide { 0%, 100% { transform: translateX(-1.6px); } 50% { transform: translateX(1.6px); } }
      .ltp-tc-slide { animation: tcSlide 1.8s ease-in-out infinite; }
      @keyframes tcWire { to { stroke-dashoffset: -20; } }
      .ltp-tc-wire { animation: tcWire 1.2s linear infinite; }
      @keyframes tcIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
      .ltp-tc-in { animation: tcIn 0.6s cubic-bezier(0.22,1,0.36,1) backwards; }
      /* SCANNER — a beam sweeps the plot every SCAN_S seconds; every marker
         (track-condition pill, LC gate, turnout) flashes the moment the beam
         passes over it (its animation-delay = its x-position along the sweep). */
      @keyframes ltpScan { 0% { transform: translateX(0); opacity: 0; } 3% { opacity: 1; } 94% { opacity: 1; } 100% { transform: translateX(var(--scan-w)); opacity: 0; } }
      .ltp-scan { animation: ltpScan ${SCAN_S}s linear infinite; }
      @keyframes ltpPing { 0%, 5%, 100% { filter: none; transform: none; } 1.5% { filter: brightness(1.9) saturate(1.3); transform: translateY(-1.5px); } }
      .ltp-ping { ${SCAN_ENABLED ? `animation: ltpPing ${SCAN_S}s linear infinite;` : ""} transform-box: fill-box; transform-origin: center; }
      @keyframes ltpRailGlow { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.7; } }
      .ltp-rail-glow { animation: ltpRailGlow 2.8s ease-in-out infinite; }
      @keyframes ltpZoneIn { from { opacity: 0; transform: scaleY(0.2); } to { opacity: 1; transform: none; } }
      .ltp-zone-in { animation: ltpZoneIn 0.9s cubic-bezier(0.22,1,0.36,1) backwards; transform-box: fill-box; transform-origin: bottom; }
      @media (prefers-reduced-motion: reduce) { .ltp-scan, .ltp-ping, .ltp-rail-glow, .ltp-zone-in { animation: none; } .ltp-scan { opacity: 0; } }
      @keyframes lcBoom { 0%, 38%, 100% { transform: rotate(0deg); } 50%, 88% { transform: rotate(-58deg); } }
      .ltp-lc-boom { animation: lcBoom 6s ease-in-out infinite; transform-box: view-box; }
      @keyframes lcLamp { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.15; } }
      .ltp-lc-lamp { animation: lcLamp 0.9s steps(1, end) infinite; }
      .ltp-lc-lamp-b { animation: lcLamp 0.9s steps(1, end) infinite; animation-delay: -0.45s; }
      @keyframes toBlade { 0%, 40%, 100% { transform: rotate(0deg); } 50%, 90% { transform: rotate(-16deg); } }
      .ltp-to-blade { animation: toBlade 4s ease-in-out infinite; transform-box: view-box; }
      @media (prefers-reduced-motion: reduce) {
        .ltp-tc-static, .ltp-tc-stripes, .ltp-tc-pulse, .ltp-tc-arc, .ltp-tc-slide, .ltp-tc-wire, .ltp-tc-in,
        .ltp-lc-boom, .ltp-lc-lamp, .ltp-lc-lamp-b, .ltp-to-blade { animation: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .live-track-aurora-a, .live-track-aurora-b, .live-track-envelope, .live-track-restrict,
        .live-track-restrict-hatch, .live-track-beam, .live-track-cross { animation: none; }
        .live-track-sonar { animation: none; opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .live-track-ping, .live-track-ping-2, .live-track-idle-glow,
        .live-track-trail-flow, .live-track-grid-shimmer, .live-track-sweep,
        .live-track-rise, .live-track-drop, .live-track-neon, .live-track-march, .live-track-march-sm,
        .live-track-particle, .live-track-corner, .live-track-border,
        .live-track-streak, .live-track-brake-ripple, .live-track-puff, .live-track-stage,
        .live-track-span-draw, .live-track-span-cap, .live-track-span-label { animation: none; }
        .live-track-pop { animation: none; opacity: 1; filter: none; }
        .live-track-particle, .live-track-puff { opacity: 0; }
      }
    `}</style>
    {/* Chart box: exactly W:H in proportion, so the plot keeps a sensible shape
        and the zoom / layer / hint overlays below stay attached to the chart
        itself (not to the larger, taller area around it). */}
    {/* Chart toolbar row — off-profile warning (left) · layer switcher
        (centre) · zoom controls (right). In normal flow ABOVE the chart box
        instead of floating over the plot, so none of it can sit on top of
        the profile-length bar, the chainage labels or the START/EOA badges. */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center",
      gap: 10, width: "100%", marginBottom: TOOLBAR_GAP_PX, minHeight: TOOLBAR_H_PX, flexShrink: 0 }}>
      <div style={{ minWidth: 0, display: "flex", justifyContent: "flex-start" }}>
        {offProfileLocos.length > 0 && (
          <div style={{
            maxWidth: "100%", padding: "3px 6px", borderRadius: 4,
            border: "1px solid #f59e0b", background: "var(--bg-raised)", opacity: 0.95,
            fontFamily: "var(--font-mono)", fontSize: 7.5, lineHeight: 1.35, color: "var(--ltp-amber)",
          }} title="Its reported position is far outside this profile, so it is left off the chart rather than squashing the profile. Check the RFID Tag Table / selected profile, or wait for a valid position.">
            ⚠ {offProfileLocos.map(l => `#${l.locoId}`).join(", ")} off this profile — not drawn
          </div>
        )}
      </div>
      {/* Layer visibility toggles — declutter the chart down to just what
          matters right now (e.g. only SSP + RFID tags while chasing a
          speed-restriction issue), or bring everything back with one click.
          Sits in its own row ABOVE the chart (not overlaid on it), so it never
          crowds the profile-length bar or the START / EOA badges. */}
      {(() => {
        // Each layer gets a tiny glyph of what it actually draws on the chart,
        // so the switcher reads at a glance instead of as a row of look-alike
        // coloured labels.
        const LAYER_DEFS = [
          { key: "ssp",        label: "SSP",        color: "#34d399", icon: "M1 9H4V4H8V7H11" },
          { key: "gradient",   label: "Gradient",   color: "#fb923c", icon: "M1 10L11 3M1 10H11" },
          { key: "lcGates",    label: "LC Gate",    color: "#f87171", icon: "M2 11V2M2 4H11M5 4V6.5M8 4V6.5" },
          { key: "turnouts",   label: "Turnout",    color: "#facc15", icon: "M1 9H11M5 9L10 3.5" },
          { key: "trackConds", label: "Track Cond", color: "#2dd4bf", icon: "M1 3V9M11 3V9M1 6H11" },
          { key: "tags",       label: "RFID Tags",  color: "#bef264", icon: "M6 2L11 10H1Z" },
          { key: "signals",    label: "Signals",    color: "#7dd3fc", icon: "M6 6.5V11M3.5 11H8.5M6 1.8A2.2 2.2 0 1 1 5.99 1.8Z" },
          { key: "eoa",        label: "EOA",        color: "#ef4444", icon: "M3 11V1.5L10 4L3 6.5" },
          { key: "brakes",     label: "Brakes",     color: "#f43f5e", icon: "M6 1.5A4.5 4.5 0 1 1 5.99 1.5ZM6 4.5A1.5 1.5 0 1 1 5.99 4.5Z" },
        ];
        const onCount = LAYER_DEFS.filter(d => visibleLayers[d.key]).length;
        const setAll = val => setVisibleLayers(v => Object.fromEntries(Object.keys(v).map(k => [k, val])));
        const quickBtn = (label, val, disabled) => (
          <button type="button" onClick={() => setAll(val)} disabled={disabled}
            className="layer-quick" title={`${val ? "Show" : "Hide"} every layer`}
            style={{
              height: 22, padding: "0 9px", borderRadius: 999, border: "none",
              background: "transparent", cursor: disabled ? "default" : "pointer",
              fontFamily: "var(--font-mono)", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.6,
              color: disabled ? "var(--text-dim)" : "var(--text-secondary)", opacity: disabled ? 0.4 : 1,
            }}>{label}</button>
        );
        return (
          <div role="toolbar" aria-label="Chart layers" className="layer-bar" style={{
                      display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", justifyContent: "center",
            padding: "4px 5px 4px 12px", borderRadius: 16, maxWidth: "100%",
            backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
          }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 5, marginRight: 4,
              fontFamily: "var(--font-mono)", fontSize: 8.5, fontWeight: 700, letterSpacing: 1.2,
              color: "var(--text-dim)", whiteSpace: "nowrap" }}>
              LAYERS
              <span style={{ color: "var(--text-secondary)", letterSpacing: 0 }}>{onCount}/{LAYER_DEFS.length}</span>
            </span>
            {LAYER_DEFS.map(d => {
              const on = !!visibleLayers[d.key];
              return (
                <button key={d.key} type="button" aria-pressed={on}
                  onClick={() => setVisibleLayers(v => ({ ...v, [d.key]: !v[d.key] }))}
                  className="layer-chip" data-on={on ? "true" : "false"}
                  title={`${on ? "Hide" : "Show"} ${d.label}`}
                  style={{
                    "--chip": d.color,
                    display: "flex", alignItems: "center", gap: 5, height: 22, padding: "0 10px 0 8px",
                    borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
                    border: `1px solid ${on ? `${d.color}66` : "var(--lb-off-border)"}`,
                    background: on ? `linear-gradient(180deg, ${d.color}2e, ${d.color}14)` : "transparent",
                    boxShadow: on ? `inset 0 0 0 1px ${d.color}14, 0 0 10px -4px ${d.color}` : "none",
                    fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, letterSpacing: 0.3,
                    color: on ? "var(--lb-on-text)" : "var(--text-dim)",
                    opacity: on ? 1 : 0.62,
                  }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ flexShrink: 0 }}>
                    <path d={d.icon} fill="none" stroke={on ? d.color : "currentColor"}
                      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {d.label}
                </button>
              );
            })}
            <span aria-hidden="true" style={{ width: 1, height: 14, margin: "0 2px 0 4px", background: "var(--lb-border)" }}/>
            {quickBtn("ALL", true, onCount === LAYER_DEFS.length)}
            {quickBtn("NONE", false, onCount === 0)}
          </div>
        );
      })()}
      <div style={{ minWidth: 0, display: "flex", justifyContent: "flex-end" }}>
        {/* Zoom controls — in the toolbar row above the chart, not part of the SVG's own
            coordinate space, so they stay put regardless of pan/zoom. Also
            directly usable on the chart itself: mouse wheel zooms toward the
            cursor, and holding the middle mouse button drags/pans it (cursor
            turns into a grabbing hand while held). Re-centres on the primary
            loco automatically whenever one is being tracked and nothing has
            been manually panned/zoomed yet; otherwise on the middle of the
            fitted profile. "⟲ FIT" always clears any manual pan and resumes
            auto-following. */}
        <div style={{
          display: "flex", gap: 2,
          padding: 2, borderRadius: 5, border: "1px solid var(--border)",
          background: "var(--bg-raised)", opacity: 0.92,
        }}>
          <button onClick={() => setZoom(z => Math.min(20, z * 1.6))} title="Zoom in"
            style={{ width: 20, height: 20, padding: 0, borderRadius: 3, border: "none", cursor: "pointer", background: "transparent", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700 }}>+</button>
          <button onClick={() => setZoom(z => Math.max(1, z / 1.6))} title="Zoom out"
            style={{ width: 20, height: 20, padding: 0, borderRadius: 3, border: "none", cursor: "pointer", background: "transparent", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700 }}>−</button>
          <button onClick={() => { setZoom(1); setManualCenter(null); }} title="Reset zoom (fit all) and resume auto-follow"
            style={{ padding: "0 6px", height: 20, borderRadius: 3, border: "none", cursor: "pointer", background: "transparent", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700 }}>⟲ FIT</button>
          {zoom > 1.01 && (
            <span style={{ display: "flex", alignItems: "center", padding: "0 4px", fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-dim)" }}>{zoom.toFixed(1)}×</span>
          )}
        </div>
      </div>
    </div>
    <div className="live-track-stage" style={{ position: "relative", width: "100%", aspectRatio: `${W} / ${H}`, flexShrink: 0 }}>
    <svg ref={svgRef} data-track-chart="true" viewBox={`0 0 ${W} ${H}`} onMouseDown={handleSvgMouseDown}
      onMouseMove={handleSvgMouseMove} onMouseLeave={handleSvgMouseLeave}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", cursor: isPanning ? "grabbing" : "default" }}>
      <defs>
        {/* Soft bright halo used behind a loco icon once it's "touching"
            some piece of profile chrome — see touchingMap above. Cheap
            blur so it reads as a glow rather than a hard-edged ring. */}
        <filter id="locoTouchGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        {/* Bounds every piece of profile/loco content (SSP, gradient, tags,
            turnouts, signals, EOA, trail, loco markers) to the plot
            rectangle. Without this, zooming/panning in far enough that an
            element's real distance falls outside the currently-visible
            domain computes an x well to the left of PAD_L (or right of
            PAD_L+GW) — a raw SVG coordinate, which just renders past the
            axis into the margin instead of being hidden, since SVG
            doesn't clip children to anything by default. */}
        <clipPath id={plotClipId}>
          <rect x={PAD_L} y={0} width={GW} height={H}/>
        </clipPath>
        {/* Slightly wider than the plot, so a tag tick sitting exactly on the
            first/last chainage isn't sliced in half by the plot's own edge. */}
        <clipPath id={tagClipId}>
          <rect x={PAD_L - 10} y={0} width={GW + 20} height={H}/>
        </clipPath>
        {/* While a newly appended route is being drawn in: only the part of
            the profile up to the drawing head is visible. */}
        {growDrawnX != null && (
          <clipPath id={growClipId}>
            <rect x={isUpLine ? growDrawnX : 0} y={0} width={isUpLine ? Math.max(0, W - growDrawnX) : Math.max(0, growDrawnX)} height={H}/>
          </clipPath>
        )}
        {/* ── Cinematic dressing (pure visuals — no data/logic depends on
             any of these; every one is additive on top of the existing
             flat-fill background, grid and trail). ── */}
        <linearGradient id={plotBgId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="var(--ltp-plot-top)" stopOpacity={0.55}/>
          <stop offset="55%" stopColor="var(--ltp-plot-mid)" stopOpacity={0.30}/>
          <stop offset="100%" stopColor="var(--ltp-plot-bot)" stopOpacity={0.6}/>
        </linearGradient>
        <radialGradient id={plotVignetteId} cx="50%" cy="38%" r="75%">
          <stop offset="0%"  stopColor="var(--ltp-vignette)" stopOpacity={0}/>
          <stop offset="78%" stopColor="var(--ltp-vignette)" stopOpacity={0}/>
          <stop offset="100%" stopColor="var(--ltp-vignette)" stopOpacity={0.35}/>
        </radialGradient>
        <linearGradient id={sweepGradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="var(--ltp-sky-text)" stopOpacity={0}/>
          <stop offset="50%"  stopColor="var(--ltp-sky-text)" stopOpacity={0.06}/>
          <stop offset="100%" stopColor="var(--ltp-sky-text)" stopOpacity={0}/>
        </linearGradient>
        <linearGradient id={scanGradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="var(--ltp-sky)" stopOpacity={0}/>
          <stop offset="50%"  stopColor="var(--ltp-sky-text)" stopOpacity={0.55}/>
          <stop offset="100%" stopColor="var(--ltp-sky)" stopOpacity={0}/>
        </linearGradient>
        {/* Soft coloured bloom used behind every loco marker (always on,
            not just while "touching" chrome) and behind the movement
            trail — a wider, gentler blur than locoTouchGlow so it reads
            as ambient light rather than a hard ring. */}
        <filter id={bloomSoftId} x="-160%" y="-160%" width="420%" height="420%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5.5"/>
        </filter>
        <filter id={trailGlowId} x="-40%" y="-200%" width="180%" height="500%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3"/>
        </filter>
        {/* ── Cinematic layer 2 paint servers ── */}
        <radialGradient id={cineIds.auroraA} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#10b981" stopOpacity={0.16}/>
          <stop offset="60%" stopColor="#0d9488" stopOpacity={0.05}/>
          <stop offset="100%" stopColor="#0d9488" stopOpacity={0}/>
        </radialGradient>
        <radialGradient id={cineIds.auroraB} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.14}/>
          <stop offset="60%" stopColor="#6366f1" stopOpacity={0.04}/>
          <stop offset="100%" stopColor="#6366f1" stopOpacity={0}/>
        </radialGradient>
        <linearGradient id={cineIds.envelope} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ltp-ssp)" stopOpacity={0.22}/>
          <stop offset="45%" stopColor="var(--ltp-ssp)" stopOpacity={0.07}/>
          <stop offset="100%" stopColor="var(--ltp-ssp)" stopOpacity={0}/>
        </linearGradient>
        <linearGradient id={cineIds.restrictFill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ltp-amber)" stopOpacity={0.02}/>
          <stop offset="70%" stopColor="var(--ltp-amber)" stopOpacity={0.10}/>
          <stop offset="100%" stopColor="var(--ltp-amber)" stopOpacity={0.18}/>
        </linearGradient>
        <pattern id={cineIds.hatch} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <g className="live-track-restrict-hatch">
            <line x1="0" y1="0" x2="0" y2="12" stroke="var(--ltp-amber)" strokeWidth="1.2" strokeOpacity="0.22"/>
            <line x1="12" y1="0" x2="12" y2="12" stroke="var(--ltp-amber)" strokeWidth="1.2" strokeOpacity="0.22"/>
            <line x1="-12" y1="0" x2="-12" y2="12" stroke="var(--ltp-amber)" strokeWidth="1.2" strokeOpacity="0.22"/>
          </g>
        </pattern>
        <linearGradient id={cineIds.beamRed} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--ltp-red)" stopOpacity={0}/>
          <stop offset="50%" stopColor="var(--ltp-red)" stopOpacity={0.32}/>
          <stop offset="100%" stopColor="var(--ltp-red)" stopOpacity={0}/>
        </linearGradient>
        <linearGradient id={cineIds.beamCyan} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--ltp-sky)" stopOpacity={0}/>
          <stop offset="50%" stopColor="var(--ltp-sky)" stopOpacity={0.24}/>
          <stop offset="100%" stopColor="var(--ltp-sky)" stopOpacity={0}/>
        </linearGradient>
        {/* Track-condition zones: light rising from the rail, fading out upward (one per type) */}
        {Object.entries(TC_STYLE).map(([t, st]) => (
          <linearGradient key={t} id={`${cineIds.tcFade}-${t}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={st.color} stopOpacity={0.26}/>
            <stop offset="35%" stopColor={st.color} stopOpacity={0.09}/>
            <stop offset="100%" stopColor={st.color} stopOpacity={0}/>
          </linearGradient>
        ))}
        {/* Track-condition fills: radio-hole static, non-stop stripes, KAVACH-exit checker */}
        <pattern id={cineIds.tcStatic} width="9" height="7" patternUnits="userSpaceOnUse">
          <rect x="1" y="1" width="2" height="1" fill="var(--ltp-tc-2)"/>
          <rect x="6" y="3" width="1" height="1" fill="var(--ltp-tc-2)"/>
          <rect x="3" y="5" width="3" height="1" fill="var(--ltp-tc-2)"/>
        </pattern>
        <pattern id={cineIds.tcStripes} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
          <g className="ltp-tc-stripes">
            <line x1="0" y1="0" x2="0" y2="14" stroke="var(--ltp-tc-3)" strokeWidth="2.2" strokeOpacity="0.28"/>
            <line x1="-14" y1="0" x2="-14" y2="14" stroke="var(--ltp-tc-3)" strokeWidth="2.2" strokeOpacity="0.28"/>
          </g>
        </pattern>
        <pattern id={cineIds.tcChecker} width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="var(--ltp-tc-9)"/><rect x="3" y="3" width="3" height="3" fill="var(--ltp-tc-9)"/>
        </pattern>
        <pattern id={cineIds.scanlines} width="4" height="3" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" fill="var(--ltp-ink)" fillOpacity="0.022"/>
        </pattern>
      </defs>
      {/* plot surface + grid + axes — layered gradient fill + soft vignette
          for a cinematic "instrument panel" depth instead of a flat tint,
          plus a slow HUD-style light sweep drifting across it. */}
      <rect x={PAD_L} y={PAD_T} width={GW} height={GH} rx={2} fill="var(--bg-raised)" opacity={0.28}/>
      <rect x={PAD_L} y={PAD_T} width={GW} height={GH} rx={2} fill={`url(#${plotBgId})`}/>
      {/* Aurora — two large, soft colour fields drifting very slowly behind
          the plot for depth. Plain gradient fills (no blur filter), so the
          continuous animation stays cheap. */}
      <g clipPath={`url(#${plotClipId})`} pointerEvents="none">
        <ellipse className="live-track-aurora-a" cx={PAD_L + GW * 0.28} cy={PAD_T + GH * 0.35}
          rx={GW * 0.38} ry={GH * 0.55} fill={`url(#${cineIds.auroraA})`}/>
        <ellipse className="live-track-aurora-b" cx={PAD_L + GW * 0.74} cy={PAD_T + GH * 0.62}
          rx={GW * 0.34} ry={GH * 0.5} fill={`url(#${cineIds.auroraB})`}/>
      </g>
      <g clipPath={`url(#${plotClipId})`}>
        <rect className="live-track-sweep" x={PAD_L} y={PAD_T} width={GW * 0.4} height={GH} fill={`url(#${sweepGradId})`}/>
      </g>
      <rect data-no-export="true" x={PAD_L} y={PAD_T} width={GW} height={GH} fill={`url(#${cineIds.scanlines})`} pointerEvents="none"/>
      <rect x={PAD_L} y={PAD_T} width={GW} height={GH} rx={2} fill={`url(#${plotVignetteId})`}/>
      {/* ── Ambient cinematic dressing (decoration only): drifting dust motes,
           glowing HUD corner brackets and a breathing plot border. Positions are derived from the index, so they're stable
           across renders and never depend on any data. ── */}
      <g clipPath={`url(#${plotClipId})`} pointerEvents="none">
      </g>
      <g pointerEvents="none" fill="none" stroke="var(--ltp-sky-text)" strokeWidth={1.5} strokeLinecap="round">
        <path className="live-track-corner" d={`M${PAD_L},${PAD_T + 14} V${PAD_T} H${PAD_L + 14}`}/>
        <path className="live-track-corner" style={{ animationDelay: "0.75s" }} d={`M${PAD_L + GW - 14},${PAD_T} H${PAD_L + GW} V${PAD_T + 14}`}/>
        <path className="live-track-corner" style={{ animationDelay: "1.5s" }} d={`M${PAD_L + GW},${PAD_T + GH - 14} V${PAD_T + GH} H${PAD_L + GW - 14}`}/>
        <path className="live-track-corner" style={{ animationDelay: "2.25s" }} d={`M${PAD_L + 14},${PAD_T + GH} H${PAD_L} V${PAD_T + GH - 14}`}/>
        <rect className="live-track-border" x={PAD_L} y={PAD_T} width={GW} height={GH} rx={2} strokeWidth={1} stroke="var(--ltp-sky)"/>
      </g>
      {xTicks.map(d => (
        <line key={d} x1={xS(d)} x2={xS(d)} y1={PAD_T} y2={PAD_T+GH} stroke={gridC} strokeWidth={1} opacity={0.55}/>
      ))}
      {yTicks.map(v => {
        const gy = PAD_T + GH * (1 - v / maxSpeed);
        return (
          <g key={v}>
            <line x1={PAD_L} x2={PAD_L+GW} y1={gy} y2={gy} stroke={gridC} strokeWidth={1}
              strokeDasharray={v === 0 ? undefined : "3,4"}
              className={v === 0 ? undefined : "live-track-grid-shimmer"}
              style={v === 0 ? undefined : { animationDelay: `${(v / (maxSpeed || 1)) * -3}s` }}
              opacity={v === 0 ? 0 : 0.85}/>
            <text x={PAD_L-8} y={gy+3} fontSize={8.5} fill={axisC} opacity={0.8} textAnchor="end" fontFamily="var(--font-mono)">{v}</text>
          </g>
        );
      })}
      <text x={PAD_L-8} y={PAD_T-12} fontSize={7.5} fill={textC} textAnchor="end" fontFamily="var(--font-mono)" letterSpacing={0.6}>KMPH</text>
      <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T+GH} stroke={axisC} strokeWidth={1.3}/>
      <line x1={PAD_L} x2={PAD_L+GW} y1={PAD_T+GH} y2={PAD_T+GH} stroke={axisC} strokeWidth={1.3}/>

      <g clipPath={`url(#${plotClipId})`}>
      <g clipPath={growDrawnX != null ? `url(#${growClipId})` : undefined}>
      {/* Static Speed Profile step line, with the speed value labelled on
          each segment so a 130→40→130 kmph sequence reads clearly at a
          glance instead of only being inferable from the y-axis. */}
      {visibleLayers.ssp && <>
      {/* Speed-restriction zones — any SSP segment at or below HALF the
          profile's top speed (e.g. the 30 / 15 kmph stretch in a 130 kmph
          profile) gets a pulsing amber hatched band, so the slow stretch
          jumps out before you even read the numbers. */}
      {(() => {
        const topSpeed = Math.max(0, ...sspLabels.map(l => l.speed || 0));
        if (!(topSpeed > 0) || sspLabels.length < 2) return null;
        // Consecutive restricted segments (e.g. 30 → 15 kmph) merge into ONE
        // zone with one tag, instead of two cramped look-alike bands.
        const zones = [];
        sspLabels.forEach(l => {
          const restricted = l.speed > 0 && l.speed <= topSpeed * 0.5;
          const last = zones[zones.length - 1];
          if (!restricted) return;
          if (last && Math.abs(last.to - l.from) < 0.5) { last.to = l.to; last.minSpeed = Math.min(last.minSpeed, l.speed); }
          else zones.push({ from: l.from, to: l.to, minSpeed: l.speed });
        });
        return zones.map((z, i) => {
          const xa = xS(z.from), xb = xS(z.to);
          const x1 = Math.min(xa, xb), x2 = Math.max(xa, xb);
          if (x2 - x1 < 2) return null;
          const tagW = 108, showTag = x2 - x1 >= 60;
          const tagX = Math.min(Math.max((x1 + x2) / 2, PAD_L + tagW / 2 + 2), PAD_L + GW - tagW / 2 - 2);
          return (
            <g key={`restrict-${i}`} pointerEvents="none">
              <g className="live-track-restrict" style={{ animationDelay: `${i * 0.3}s` }}>
                <rect x={x1} y={PAD_T} width={x2 - x1} height={GH} fill={`url(#${cineIds.restrictFill})`}/>
                <rect x={x1} y={PAD_T} width={x2 - x1} height={GH} fill={`url(#${cineIds.hatch})`}/>
                <line x1={x1} x2={x1} y1={PAD_T} y2={PAD_T + GH} stroke="var(--ltp-amber)" strokeOpacity={0.35} strokeWidth={1}/>
                <line x1={x2} x2={x2} y1={PAD_T} y2={PAD_T + GH} stroke="var(--ltp-amber)" strokeOpacity={0.35} strokeWidth={1}/>
              </g>
              {showTag && (
                <g transform={`translate(${tagX},${PAD_T + GH * 0.3})`} className="live-track-rise" style={{ "--d": `${1.2 + i * 0.1}s` }}>
                  <rect x={-tagW / 2} y={-8} width={tagW} height={24} rx={6} fill="var(--ltp-warn-box-bg)" fillOpacity={0.85}
                    stroke="var(--ltp-amber)" strokeOpacity={0.6} strokeWidth={0.8}/>
                  <text x={0} y={2} textAnchor="middle" fontSize={7} fontWeight={700} letterSpacing={0.8}
                    fill="var(--ltp-amber-text)" fontFamily="var(--font-mono)">⚠ SPEED RESTRICTION</text>
                  <text x={0} y={12} textAnchor="middle" fontSize={7} fill="var(--ltp-amber-soft)" opacity={0.8}
                    fontFamily="var(--font-mono)">{`${Math.round(z.to - z.from)} m · min ${z.minSpeed} kmph`}</text>
                </g>
              )}
            </g>
          );
        });
      })()}
      {sspPath && (
        /* Keyed on the profile's shape (segment count + span) — NOT on
           zoom/pan — so the reveal replays when a different profile is
           loaded but never on every zoom. The clip rect's real width is
           the full width; SMIL only animates it from 0 on mount, so PNG/SVG
           exports (which read the real attribute) always contain the line. */
        <g key={`ssp-reveal-${profileEpoch}`}>
          <clipPath id={sspRevealId}>
            <rect x={PAD_L - 2} y={0} width={GW + PAD_R + 4} height={H}>
              {!CINE_REDUCED && smilReveal && <animate attributeName="width" from="0" to={GW + PAD_R + 4} dur="1.8s" fill="freeze"
                calcMode="spline" keyTimes="0;1" keySplines="0.22 1 0.36 1"/>}
            </rect>
          </clipPath>
          <g clipPath={`url(#${sspRevealId})`}>
            {/* Speed envelope — soft emerald light pooled under the whole
                step line, breathing slowly; the area the loco is allowed in. */}
            {sspBoundaries.length > 1 && (
              <path className="live-track-envelope" pointerEvents="none"
                d={`${sspPath} L ${xS(sspBoundaries[sspBoundaries.length - 1])} ${PAD_T + GH} L ${xS(0)} ${PAD_T + GH} Z`}
                fill={`url(#${cineIds.envelope})`} stroke="none"/>
            )}
            <path d={sspPath} fill="none" stroke="var(--ltp-ssp)" strokeWidth={5} opacity={0.3} filter={`url(#${trailGlowId})`}/>
            <path d={sspPath} fill="none" stroke="var(--ltp-ssp)" strokeWidth={2}/>
            <path d={sspPath} fill="none" stroke="var(--ltp-ssp-soft)" strokeWidth={1.4} strokeDasharray="1,22"
              opacity={0.85} className="live-track-trail-flow"/>
            {/* Energy pulses — two glowing comets riding the SSP line end to
                end (SMIL animateMotion along the very same path), each a
                bright head with a short fading tail of trailing sparks. */}
            {!CINE_REDUCED && [0, 3.2].map(start => (
              <g key={`comet-${start}`} pointerEvents="none" data-no-export="true">
                {[0, 0.05, 0.1, 0.15].map((lag, k) => (
                  <g key={k} opacity={0}>
                    <circle r={k === 0 ? 7 : 5 - k} fill="var(--ltp-ssp)" opacity={0.45} filter={`url(#${bloomSoftId})`}/>
                    <circle r={k === 0 ? 2.4 : 1.8 - k * 0.35} fill={k === 0 ? "var(--ltp-spark)" : "var(--ltp-ssp-soft)"} opacity={1 - k * 0.22}/>
                    <animateMotion path={sspPath} dur="6.4s" begin={`${1.9 + start + lag}s`} repeatCount="indefinite"
                      calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.45 0 0.55 1"/>
                    <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.92;1"
                      dur="6.4s" begin={`${1.9 + start + lag}s`} repeatCount="indefinite"/>
                  </g>
                ))}
              </g>
            ))}
          </g>
          {!CINE_REDUCED && smilReveal && (
            <rect x={PAD_L} y={PAD_T} width={2} height={GH} fill="var(--ltp-ssp-soft)" opacity={0} filter={`url(#${bloomSoftId})`} pointerEvents="none">
              <animate attributeName="x" from={PAD_L} to={PAD_L + GW} dur="1.8s" fill="freeze"
                calcMode="spline" keyTimes="0;1" keySplines="0.22 1 0.36 1"/>
              <animate attributeName="opacity" values="0;0.95;0.95;0" keyTimes="0;0.06;0.88;1" dur="1.8s" fill="freeze"/>
            </rect>
          )}
        </g>
      )}
      {sspLabels.map((l,i) => {
        const lenY = Math.min(l.y + 13, PAD_T + GH - 3);
        return (
          <g key={i} className="live-track-rise" style={{ "--d": `${0.5 + i * 0.14}s` }}>
            <text x={l.x} y={l.y - 6} fontSize={9} fontWeight={700} textAnchor="middle" className="live-track-neon"
              fill="var(--ltp-ssp)" fontFamily="var(--font-mono)">{l.speed} kmph</text>
            <text x={l.x} y={lenY} fontSize={7.5} textAnchor="middle"
              fill="var(--ltp-ssp)" fontFamily="var(--font-mono)" opacity={0.75}>{Math.round(l.len)}m</text>
          </g>
        );
      })}

      {/* SSP segment boundary chainages — the Abs Location (real, calibrated
          via chainageOffset) at every point the green SSP line steps to a
          new speed, written vertically alongside each riser so each
          segment's "from → to" location is readable directly off the
          chart (boundary[i] → boundary[i+1] = one segment's span). Dims
          when a loco has reached this exact chainage, same as every other
          point marker below, so it doesn't visually clash with the icon. */}
      {/* Colour kept distinct from the SSP line's own green (#34d399) — the
          boundary lines/labels used to share that colour, which made them
          hard to tell apart from the speed profile itself right where they
          overlap it. Sky-blue reads as clearly separate against the green
          line, the amber gridlines and every other layer's own colour. */}
      {sspBoundaries.map((b,i) => {
        const bx = xS(b);
        const absLoc = Math.round(chainageOffset + absDir * b);
        const dim = nearLocoX(bx);
        return (
          <g key={i} transform={`translate(${bx},${PAD_T})`} opacity={dim ? 0.22 : 1}>
            <line y1={0} y2={GH} stroke="var(--ltp-sky)" strokeWidth={0.5} strokeDasharray="1,3" opacity={0.45} className="live-track-march-sm"/>
            <text x={4} y={10} fontSize={7} fontFamily="var(--font-mono)" fill="var(--ltp-sky-text)" opacity={0.85}
              transform="rotate(90, 4, 10)">{absKnown ? `${absLoc}m` : `+${Math.round(b)}m`}</text>
            <title>{`SSP boundary · local ${Math.round(b)}m${absKnown ? ` · abs ${absLoc}m` : " · abs unknown (RFID Tag Table not matched)"}`}</title>
          </g>
        );
      })}

      {/* Local "spotlight" dim on the SSP line itself, right where a loco's
          actual plotted position (its real reported speed) sits on top of
          it — muting a short stretch of the green line so the bright icon
          reads clearly against it, without touching the rest of the line
          which stays at full brightness. Drawn after the line/labels but
          before everything else, so the loco icon (rendered much later)
          still ends up on top of this dim strip too. */}
      {locoScreenPos.map(p => {
        const segSpeed = speedAtDistance(universalSSP, p.dist);
        if (segSpeed == null) return null;
        const segY = yS(segSpeed);
        if (Math.abs(segY - p.y) > TOUCH_PX_XY) return null;
        return (
          <line key={`ssp-dim-${p.id}`} x1={p.x - 18} x2={p.x + 18} y1={segY} y2={segY}
            stroke="var(--bg-base)" strokeWidth={5} strokeLinecap="round" opacity={0.6}/>
        );
      })}
      </>}

      {/* Gradient — a compact ELEVATION SILHOUETTE just under the x-axis:
          each segment rises (UPHILL) or falls (DOWNHILL) by its grade ×
          length, filled green uphill / orange downhill / grey level, with
          chevrons flowing in the slope direction and "▲ G6 / ▼ G12 / LEVEL"
          labels. GRADE_CODE 0 = level, 1–29 steepness, 30 = steeper than
          1:33 (drawn as 33), 31 = reserved (flat). */}
      {visibleLayers.gradient && (layers?.gradient || []).length > 0 && (() => {
        const pts = [{ d: 0, z: 0 }];
        let dPrev = 0, zc = 0;
        (layers.gradient || []).forEach(g => {
          const end = g.cumDist ?? g.distance;
          const code = g.gradeCode >= 31 ? 0 : g.gradeCode === 30 ? 33 : (g.gradeCode || 0);
          zc += (g.uphill ? 1 : -1) * code * (end - dPrev) / 1000;
          dPrev = end;
          pts.push({ d: end, z: zc, g });
        });
        const zs = pts.map(p => p.z), zMin = Math.min(...zs), zMax = Math.max(...zs);
        const top = PAD_T + GH + 4, bot = PAD_T + GH + 19;
        const yZ = v => (zMax - zMin < 1e-6 ? bot - 4 : bot - 1 - (v - zMin) / (zMax - zMin) * (bot - top - 1));
        return pts.slice(1).map((p, k) => {
          const a = pts[k], g = p.g;
          const x1 = xS(a.d), x2 = xS(p.d), y1 = yZ(a.z), y2 = yZ(p.z);
          const up = g.uphill && g.gradeCode > 0 && g.gradeCode < 31;
          const down = !g.uphill && g.gradeCode > 0 && g.gradeCode < 31;
          const col = up ? "var(--ltp-ssp)" : down ? "var(--ltp-orange-2)" : "var(--ltp-muted)";
          const label = g.gradeCode === 0 ? "LEVEL" : g.gradeCode === 30 ? ">1:33" : g.gradeCode === 31 ? "—" : `G${g.gradeCode}`;
          const dim = locoScreenPos.some(q => q.x >= Math.min(x1, x2) && q.x <= Math.max(x1, x2));
          const flowFwd = (up || !down) === (x2 >= x1);
          return (
            <g key={`gr-${k}`} opacity={dim ? 0.35 : 1}>
              <polygon points={`${x1},${y1} ${x2},${y2} ${x2},${bot} ${x1},${bot}`} fill={col} opacity={0.16}/>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={5} opacity={0.22} filter={`url(#${trailGlowId})`}/>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={1.8} strokeLinecap="round"/>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ltp-ink)" strokeWidth={1} strokeDasharray="2,12" opacity={0.55}
                className="live-track-march" style={{ animationDirection: flowFwd ? "normal" : "reverse" }}/>
              {Math.abs(x2 - x1) > 40 && (
                <text x={(x1 + x2) / 2} y={bot + 8} textAnchor="middle" fontSize={6.5} fontWeight={700} fill={col}
                  fontFamily="var(--font-mono)">{`${up ? "▲" : down ? "▼" : "▬"} ${label}`}</text>
              )}
              <title>{`Gradient · ${up ? "Uphill" : down ? "Downhill" : "Level"} · code ${g.gradeCode} (${label}) · ${Math.round(a.d)} m → ${Math.round(p.d)} m`}</title>
            </g>
          );
        });
      })()}

      {/* LC gates — a soft dotted guide down the plot at each gate's chainage,
          an animated barrier (lifting red/white boom, alternating lamps) at
          the top, and a compact caption card "LC 40a" + "B1 · M · W" beside it.
          Unmanned gates: solid red boom + "!" badge; auto-whistling: sound arcs
          on the approach side. Cards of gates that are close together are
          staggered in rows so they never overlap. cumDist = distance from the
          profile start (0 m). */}
      {visibleLayers.lcGates && (() => {
        const gates = (layers?.lcGates || []).map((lc, i) => ({ lc, i, gx: xS(lc.cumDist ?? lc.distance) }))
          .filter(g => inPlotX(g.gx)).sort((p, q) => p.gx - q.gx);
        let lastX = -1e9, row = 0;
        gates.forEach(g => { row = g.gx - lastX < 74 ? (row + 1) % 2 : 0; g.row = row; lastX = g.gx; });
        const approach = absDir >= 0 ? -1 : 1;
        return gates.map(({ lc, i, gx, row: r }) => {
          const dim = nearLocoX(gx);
          const col = lc.manned ? "var(--ltp-red-soft)" : "var(--ltp-red)";
          const name = `LC ${lc.lcId}${lc.suffix && lc.suffix !== "-" ? lc.suffix : ""}`;
          const sub = `${lc.lcClass} · ${lc.manned ? "M" : "UM"}${lc.autoWhistle ? " · W" : ""}`;
          const gy = PAD_T + 16;
          const cardW = Math.max(name.length, sub.length) * 4.4 + 12;
          const cardX = Math.min(Math.max(gx + 8, PAD_L + 2), PAD_L + GW - cardW - 2);
          const cardY = PAD_T + 4 + r * 24;
          const delay = Math.max(0, (gx - PAD_L) / GW) * SCAN_S;
          return (
            <g key={`lc-${i}`} opacity={dim ? 0.25 : 1} style={{ transition: "opacity 0.3s" }}>
              <line x1={gx} x2={gx} y1={PAD_T + 26} y2={PAD_T + GH} stroke={col} strokeDasharray="2,5" strokeWidth={1} opacity={0.4}/>
              <g className="ltp-tc-in" style={{ animationDelay: `${0.2 + i * 0.08}s` }}>
                <g className="ltp-ping" style={{ animationDelay: `${delay}s` }}>
                  <circle cx={gx} cy={gy} r={13} fill={col} opacity={0.14} filter={`url(#${bloomSoftId})`}/>
                  <g transform={`translate(${gx},0)`}>
                    <rect x={-1.6} y={gy - 9} width={3.2} height={15} rx={1} fill={col}/>
                    <rect x={-4.5} y={gy + 5} width={9} height={2.2} rx={1} fill={col} opacity={0.8}/>
                    <g className="ltp-lc-boom" style={{ transformOrigin: `0px ${gy - 7}px` }}>
                      <line x1={0} y1={gy - 7} x2={-15} y2={gy - 7} stroke={col} strokeWidth={3} strokeLinecap="round"/>
                      {lc.manned && <line x1={-2} y1={gy - 7} x2={-15} y2={gy - 7} stroke="var(--ltp-ink)" strokeWidth={1.6} strokeDasharray="2.5,2.5" opacity={0.85}/>}
                    </g>
                    <circle cx={-4} cy={gy - 3} r={1.6} fill={col} className="ltp-lc-lamp"/>
                    <circle cx={4} cy={gy - 3} r={1.6} fill={col} className="ltp-lc-lamp-b"/>
                    {!lc.manned && (
                      <g transform={`translate(6,${gy - 10})`}>
                        <circle r={4} fill="var(--ltp-red)"/>
                        <text y={2.5} textAnchor="middle" fontSize={6.5} fontWeight={800} fill="#fff" fontFamily="var(--font-mono)">!</text>
                      </g>
                    )}
                    {lc.autoWhistle && [0, 0.6, 1.2].map(d => (
                      <path key={d} d={`M${approach * 8},${gy - 8} a4,4 0 0 ${approach < 0 ? 0 : 1} 0,8`} fill="none" stroke={col} strokeWidth={1.1}
                        className="ltp-tc-arc" style={{ animationDelay: `${d}s`, transformOrigin: "center" }}/>
                    ))}
                  </g>
                </g>
                {/* caption card */}
                <g transform={`translate(${cardX},${cardY})`}>
                  <rect width={cardW} height={20} rx={5} fill="var(--ltp-box-bg)" fillOpacity={0.88} stroke={col} strokeWidth={0.9}/>
                  <rect width={2.5} height={20} rx={1.2} fill={col}/>
                  <text x={7} y={8.5} fontSize={7} fontWeight={700} fill={col} fontFamily="var(--font-mono)" letterSpacing={0.3}>{name}</text>
                  <text x={7} y={16.5} fontSize={6} fill="var(--ltp-text-strong)" opacity={0.85} fontFamily="var(--font-mono)">{sub}</text>
                </g>
              </g>
              <title>{`Level Crossing ${name} · Class ${lc.lcClass} · ${lc.manned ? "Manned" : "Unmanned"} · Auto-whistling ${lc.autoWhistle ? `ON (${lc.whistleType})` : "OFF"} · ${Math.round(lc.cumDist ?? lc.distance)} m`}</title>
            </g>
          );
        });
      })()}

      {/* Turnouts — startCumDist is the distance from the profile start (0 m); releaseDist
          stays as an offset FROM the start, per its own field semantics.
          Positioned at the turnout's OWN speed level (not a fixed spot at
          the top of the chart), so it reads directly off the same speed
          axis as the SSP profile — e.g. a 30 kmph turnout sits right at
          the 30 kmph gridline. */}
      {visibleLayers.turnouts && (layers?.turnouts || []).map((to,i) => {
        const cum = to.startCumDist ?? to.startDist;
        const y = to.speed ? yS(to.speed) : PAD_T;
        const dim = nearLocoX(xS(cum));
        const tx = xS(cum);
        if (!inPlotX(tx)) return null;
        const labelDx = clampX(tx, 40) - tx; // slide only the "NN kmph" label inward near an edge; marker stays on its true chainage
        // Restriction runs from the turnout start to start + releaseDist (the
        // point where its speed limit is released) — drawn as a dashed bar at
        // the turnout's own speed so it reads straight off the speed axis.
        const relX = to.releaseDist ? xS(cum + to.releaseDist) - tx : 0;
        return (
          <g key={i} transform={`translate(${tx},0)`} opacity={dim ? 0.25 : 1} style={{ transition: "opacity 0.3s" }}>
            <line y1={PAD_T+GH} y2={y} stroke="var(--ltp-yellow)" strokeDasharray="2,4" strokeWidth={1} opacity={0.45}/>
            {relX !== 0 && <>
              <rect x={Math.min(0, relX)} y={y - 3} width={Math.abs(relX)} height={6} rx={3} fill="var(--ltp-yellow)" opacity={0.12}/>
              <line x1={0} x2={relX} y1={y} y2={y} stroke="var(--ltp-yellow)" strokeWidth={1.6} strokeDasharray="5,4"
                className="ltp-tc-wire" opacity={0.85}/>
              <line x1={relX} x2={relX} y1={y - 5} y2={y + 5} stroke="var(--ltp-yellow)" strokeWidth={1.2} opacity={0.8}/>
            </>}
            <g transform={`translate(0,${y})`}><g className="ltp-ping" style={{ animationDelay: `${Math.max(0, (tx - PAD_L) / GW) * SCAN_S}s` }}><g className="ltp-tc-in" style={{ animationDelay: `${0.3 + i * 0.1}s` }}>
              <circle className="live-track-idle-glow" r={11} fill="var(--ltp-yellow)" filter={`url(#${bloomSoftId})`}
                style={{ "--pulseSpeed": "2.4s" }}/>
              <circle r={8} fill="var(--ltp-box-bg)" fillOpacity={0.9} stroke="var(--ltp-yellow)" strokeWidth={1.4}/>
              {/* diverging track: straight road + a switch blade that throws */}
              <line x1={-5} y1={2.2} x2={5} y2={2.2} stroke="var(--ltp-yellow)" strokeWidth={1.5} strokeLinecap="round"/>
              <line x1={-5} y1={2.2} x2={4.5} y2={-3.6} stroke="var(--ltp-yellow)" strokeWidth={1.5} strokeLinecap="round"
                className="ltp-to-blade" style={{ transformOrigin: "-5px 2.2px" }}/>
            </g></g></g>
            <text x={labelDx} y={y-13} textAnchor="middle" fontSize={7} fontWeight={700}
              fontFamily="var(--font-mono)" fill="var(--ltp-yellow)">{`TURNOUT ≤${to.speed} kmph${to.releaseDist ? ` · ${to.releaseDist} m` : ""}`}</text>
            <title>{`Turnout — max ${to.speed} kmph · start ${Math.round(cum)} m · speed released after ${to.releaseDist} m`}</title>
          </g>
        );
      })}

      {/* Track conditions (Annexure-C TRACK_COND_TYPE) — every type has its
          own colour, icon and animation (TC_STYLE / TrackCondIcon):
            Dead Stop: pulsing stop bar · Radio Hole: flickering "no signal"
            static · Non-Stop Area: moving stripes · Tunnel Stop: tunnel arch
            · Powerless Section: broken overhead wire · Sound Horn: sound arcs
            · Reversing Area: sliding two-way arrows · Fouling Mark: post
            · KAVACH Exit: chequered end line.
          Each zone = faint full-height band + a coloured rail at the bottom
          of the plot + a label pill; pills are stacked in rows so zones that
          are close together never overlap. startCumDist is the distance from the profile start (0 m)
          to the zone's start; length is the zone's own span. */}
      {visibleLayers.trackConds && (() => {
        const items = (layers?.trackConds || []).map((tc, i) => {
          const start = tc.startCumDist ?? tc.start;
          const end = start + (tc.length || 0);
          const xA = xS(start), xB = xS(end);
          const st = TC_STYLE[tc.type] || TC_DEFAULT_STYLE;
          const bandX = Math.min(xA, xB), bandW = Math.abs(xB - xA);
          const text = `${st.short}${tc.length ? ` · ${Math.round(tc.length)} m` : ""}`;
          const pillW = 22 + text.length * 4.6;
          const pillX = Math.min(Math.max(bandX, PAD_L + 2), PAD_L + GW - pillW - 2);
          return { tc, i, start, end, xA, xB, st, bandX, bandW, text, pillW, pillX };
        }).filter(it => it.bandX + it.bandW >= PAD_L - 2 && it.bandX <= PAD_L + GW + 2);
        // Greedy row packing for the label pills (bottom row first).
        const rowEnds = [];
        [...items].sort((a, b) => a.pillX - b.pillX).forEach(it => {
          let r = rowEnds.findIndex(e => e < it.pillX - 4);
          if (r < 0) { r = rowEnds.length; rowEnds.push(0); }
          rowEnds[r] = it.pillX + it.pillW;
          it.row = r;
        });
        const railY = PAD_T + GH - 5;
        return items.map(({ tc, i, start, end, xA, xB, st, bandX, bandW, text, pillW, pillX, row }) => {
          const c = st.color;
          const dim = locoScreenPos.some(p => p.dist >= start && p.dist <= end);
          const isPoint = bandW < 3;
          const pillY = railY - 20 - row * 18;
          const endX = xB;                       // zone end (chainage start+length)
          return (
            <g key={`tc-${i}`} opacity={dim ? 0.35 : 1} style={{ transition: "opacity 0.3s" }} pointerEvents="none">
              {!isPoint && <>
                {/* zone: light rising from the rail (fades out upward) + soft edges */}
                <rect x={bandX} width={bandW} y={PAD_T} height={GH} fill={`url(#${cineIds.tcFade}-${tc.type})`}
                  className="ltp-zone-in" style={{ animationDelay: `${0.15 + i * 0.07}s` }}/>
                <rect x={bandX} width={bandW} y={PAD_T} height={GH} fill={c} opacity={0.035}/>
                <line x1={xA} x2={xA} y1={PAD_T + GH * 0.35} y2={PAD_T + GH} stroke={c} strokeWidth={1} strokeDasharray="4,3" opacity={0.45}/>
                <line x1={xB} x2={xB} y1={PAD_T + GH * 0.35} y2={PAD_T + GH} stroke={c} strokeWidth={1} strokeDasharray="4,3" opacity={0.45}/>
                {/* type-specific decoration */}
                {st.fx === "static" && (
                  <g className="ltp-tc-static">
                    <rect x={bandX} width={bandW} y={PAD_T} height={GH} fill={`url(#${cineIds.tcStatic})`}/>
                  </g>
                )}
                {st.fx === "stripes" && (
                  <rect x={bandX} width={bandW} y={PAD_T} height={GH} fill={`url(#${cineIds.tcStripes})`} opacity={0.9}/>
                )}
                {st.fx === "tunnel" && [xA, xB].map((px, k) => (
                  /* tunnel portals at the entry and exit */
                  <g key={k} transform={`translate(${px},${railY})`} opacity={0.85}>
                    <path d="M-9,0 V-9 A9,9 0 0 1 9,-9 V0" fill={c} fillOpacity={0.18} stroke={c} strokeWidth={1.4}/>
                    <path d="M-5,0 V-8 A5,5 0 0 1 5,-8 V0" fill="var(--ltp-plot-bot)" fillOpacity={0.9} stroke="none"/>
                  </g>
                ))}
                {st.fx === "wire" && <>
                  <line x1={bandX} x2={bandX + bandW} y1={PAD_T + 6} y2={PAD_T + 6} stroke={c} strokeWidth={1.6}
                    strokeDasharray="9,6" className="ltp-tc-wire" opacity={0.85}/>
                  <line x1={bandX} x2={bandX + bandW} y1={PAD_T + 6} y2={PAD_T + 6} stroke={c} strokeWidth={5} opacity={0.12}/>
                </>}
                {st.fx === "stopbar" && (
                  <rect x={xA - 2} width={4} y={PAD_T} height={GH} fill={c} className="ltp-tc-pulse"/>
                )}
                {st.fx === "exit" && (
                  <rect x={endX - 3} width={6} y={PAD_T} height={GH} fill={`url(#${cineIds.tcChecker})`} opacity={0.85}/>
                )}
                {/* bottom rail + breathing glow */}
                <rect x={bandX} width={bandW} y={railY - 2} height={8} rx={4} fill={c} filter={`url(#${trailGlowId})`} className="ltp-rail-glow"/>
                <rect x={bandX} width={bandW} y={railY} height={4} rx={2} fill={c} opacity={0.9}/>
              </>}
              {isPoint && <>
                {/* point condition (e.g. fouling mark): a post */}
                <line x1={xA} x2={xA} y1={PAD_T} y2={PAD_T + GH} stroke={c} strokeWidth={1.4} strokeDasharray="2,3" opacity={0.85}/>
                <g transform={`translate(${xA},${railY})`}><TrackCondIcon type={tc.type} color={c}/></g>
              </>}
              {/* label pill: icon + name + length (pings when the scanner passes) */}
              <g className="ltp-tc-in" style={{ animationDelay: `${0.25 + i * 0.07}s` }}>
              <g className="ltp-ping" style={{ animationDelay: `${Math.max(0, (pillX + 9 - PAD_L) / GW) * SCAN_S}s` }}>
                <line x1={pillX + 9} x2={pillX + 9} y1={pillY + 14} y2={railY} stroke={c} strokeWidth={0.8} opacity={0.5}/>
                <rect x={pillX} y={pillY} width={pillW} height={14} rx={7} fill="var(--ltp-box-bg)" fillOpacity={0.92}
                  stroke={c} strokeWidth={0.9}/>
                {/* position on the outer <g>, animation on the inner one — a CSS
                    transform animation would otherwise replace the translate */}
                <g transform={`translate(${pillX + 9},${pillY + 7}) scale(0.95)`}>
                  <g className={st.fx === "reverse" ? "ltp-tc-slide" : st.fx === "stopbar" ? "ltp-tc-pulse" : undefined}>
                    <TrackCondIcon type={tc.type} color={c}/>
                  </g>
                </g>
                {st.fx === "horn" && [0, 0.6, 1.2].map(d => (
                  <path key={d} d={`M${pillX + 13},${pillY + 3.5} a3.5,3.5 0 0 1 0,7`} fill="none" stroke={c} strokeWidth={1}
                    className="ltp-tc-arc" style={{ animationDelay: `${d}s` }}/>
                ))}
                <text x={pillX + 18} y={pillY + 10} fontSize={7} fontWeight={700} fill={c} fontFamily="var(--font-mono)"
                  letterSpacing={0.4}>{text}</text>
              </g>
              </g>
              <title>{`${tc.typeName} · ${Math.round(start)} m → ${Math.round(end)} m · length ${tc.length} m`}</title>
            </g>
          );
        });
      })()}

      {/* SCANNER beam — sweeps the plot every SCAN_S s; markers ping as it passes */}
      {SCAN_ENABLED && !CINE_REDUCED && (
        <g pointerEvents="none" data-no-export="true" className="ltp-scan"
          style={{ "--scan-w": `${GW}px` }}>
          <rect x={PAD_L - 30} y={PAD_T} width={30} height={GH} fill={`url(#${scanGradId})`} opacity={0.22}/>
          <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + GH} stroke="var(--ltp-sky-text)" strokeWidth={1.2} opacity={0.55}/>
        </g>
      )}

      {/* RFID tag ticks along the baseline with tag number, Abs Location
          (from the loaded RFID Tag Table when available, else the
          calibrated local→real chainage) and inter-tag distance.
          Every tag ALWAYS gets its tick mark (the small triangle), so the
          true position of every tag stays visible no matter how zoomed
          out — but when several tags land close enough together on screen
          that their TEXT would overlap, only every label that clears a
          minimum on-screen gap from the last one actually shown gets
          drawn (same idea for the inter-tag arrow+distance text, gated on
          that specific gap's own width). Hovering any tick still shows
          full details via its tooltip even when the label itself is
          thinned out. */}
      </g>{/* end of growth-clipped group */}
      </g>{/* end of plot-clipped group; tags get their own slightly wider clip */}
      <g clipPath={`url(#${tagClipId})`}>
      <g clipPath={growDrawnX != null ? `url(#${growClipId})` : undefined}>
      {visibleLayers.tags && (() => {
        const tagList = layers?.tli || [];
        const MIN_LABEL_GAP_PX = 34;
        const MIN_ARROW_GAP_PX = 40;
        const MIN_EDGE_ARROW_GAP_PX = 64; // a gap cut by the plot edge needs more room (its label sits on the edge)
        const LABEL_HALF = 16;            // half-width of the widest tag text ("#512" / "138900m")
        let lastLabelX = -Infinity;
        return tagList.map((t,i) => {
          const prevTag = i > 0 ? tagList[i-1] : null;
          const distBetweenTags = prevTag ? Math.round(t.cumDist - prevTag.cumDist) : null;
          const tagX = xS(t.cumDist);
          const prevX = prevTag ? xS(prevTag.cumDist) : null;
          const tagAbsLoc = tagLocationMap && tagLocationMap[t.tagId] != null
            ? tagLocationMap[t.tagId]
            : (absKnown ? Math.round(chainageOffset + absDir * t.cumDist) : `+${Math.round(t.cumDist)}`);

          // Inter-tag arrow: centred on the VISIBLE part of the gap, so the
          // distance text stays readable when one end of the gap is
          // scrolled/zoomed off-screen (before, it was centred on the true
          // midpoint — which could be outside the plot and get clipped).
          let arrowMidX = null;
          if (prevX != null) {
            const loX = Math.min(prevX, tagX), hiX = Math.max(prevX, tagX);
            const gapLo = Math.max(loX, PAD_L), gapHi = Math.min(hiX, PLOT_R);
            const vis = gapHi - gapLo;
            const cut = loX < PAD_L || hiX > PLOT_R;
            if (vis >= (cut ? MIN_EDGE_ARROW_GAP_PX : MIN_ARROW_GAP_PX)) arrowMidX = (gapLo + gapHi) / 2;
          }

          const tagVisible = inPlotX(tagX);
          // Tag text slides inward near either edge so the first/last tag's
          // "#NNN" and Abs Location are never cut in half by the plot edge.
          const labelDx = clampX(tagX, LABEL_HALF) - tagX;
          const labelX = tagX + labelDx;
          const showLabel = tagVisible && Math.abs(labelX - lastLabelX) >= MIN_LABEL_GAP_PX;
          if (showLabel) lastLabelX = labelX;   // off-screen tags never suppress a visible label
          const dim = nearLocoX(tagX);

          return (
            <g key={i}>
              {arrowMidX != null && (
                <g transform={`translate(${arrowMidX},${PAD_T+GH+33})`} opacity={nearLocoX(arrowMidX) ? 0.25 : 1}>
                  <line x1={-15} y1={0} x2={-3} y2={0} stroke="var(--ltp-ink)" strokeWidth={1}/>
                  <polygon points="-3,0 -6,-2 -6,2" fill="var(--ltp-ink)"/>
                  <text x={0} y={-4} textAnchor="middle" fontSize={7.5} fontFamily="var(--font-mono)"
                    fill="var(--ltp-text-strong)" fontWeight={600}>{distBetweenTags}m</text>
                  <line x1={3} y1={0} x2={15} y2={0} stroke="var(--ltp-ink)" strokeWidth={1}/>
                  <polygon points="3,0 6,-2 6,2" fill="var(--ltp-ink)"/>
                </g>
              )}

              {tagVisible && (
                <g transform={`translate(${tagX},${PAD_T+GH+41})`} opacity={dim ? 0.25 : 1}>
                  <line x1={0} x2={0} y1={-41} y2={-36} stroke="var(--ltp-tag)" strokeWidth={1} opacity={0.6}/>
                  <circle cy={2} r={6} className="live-track-idle-glow" fill="var(--ltp-tag)"
                    filter={`url(#${bloomSoftId})`} style={{ "--pulseSpeed": "3.2s" }}/>
                  {/* Sonar wave — delay follows the tag's on-screen x, so the
                      ping rolls across the track like a radar sweep. */}
                  <circle cy={3} r={4} fill="none" stroke="var(--ltp-tag)" strokeWidth={1} className="live-track-sonar"
                    data-no-export="true" style={{ "--d": `${2 + ((tagX - PAD_L) / Math.max(1, GW)) * 1.6}s` }}/>
                  <polygon points="0,0 -3.5,6 3.5,6" fill="var(--ltp-tag)" className="live-track-drop" style={{ "--d": `${0.9 + i * 0.07}s` }}/>
                  {showLabel && (
                    <>
                      <text x={labelDx} y={17} textAnchor="middle" fontSize={8.5} fontFamily="var(--font-mono)"
                        fill="var(--ltp-tag)" fontWeight={700}>#{t.tagId}</text>
                      <text x={labelDx} y={27} textAnchor="middle" fontSize={7} fontFamily="var(--font-mono)"
                        fill="var(--ltp-tag-text)" opacity={0.75}>{tagAbsLoc}m</text>
                    </>
                  )}
                  <title>{`RFID Tag #${t.tagId} · Abs Location: ${tagAbsLoc} m · Local: ${Math.round(t.cumDist)} m${distBetweenTags ? ` · +${distBetweenTags}m from previous tag` : ''}`}</title>
                </g>
              )}
              {tagVisible && (
                <g transform={`translate(${tagX},${PAD_T+GH+41})`}>
                    {/* Tag-pass burst — a loco just reported this tag as its new
                        LAST_RFID: two expanding rings + a bright flash, keyed on
                        the moment it happened so it plays once per pass. */}
                    {(() => {
                      const hit = locoList.find(l => l.lastRfid === t.tagId && l.rfidFlashAt && Date.now() - l.rfidFlashAt < 3000);
                      if (!hit || CINE_REDUCED) return null;
                      const c = hit.emergency > 0 ? "var(--ltp-red)" : LOCO_COLORS[hit.colorIdx % LOCO_COLORS.length];
                      return (
                        <g key={`burst-${hit.rfidFlashAt}`} data-no-export="true" pointerEvents="none">
                          <circle cy={3} r={5} fill="none" stroke={c} strokeWidth={1.6} className="loco-tag-burst"/>
                          <circle cy={3} r={5} fill="none" stroke="var(--ltp-tag)" strokeWidth={1} className="loco-tag-burst" style={{ animationDelay: "0.25s" }}/>
                          <polygon points="0,0 -3.5,6 3.5,6" fill="#f7fee7" className="loco-tag-flash"/>
                        </g>
                      );
                    })()}
                </g>
              )}
            </g>
          );
        });
      })()}
      </g>{/* end of growth-clipped tags */}
      </g>
      <g clipPath={`url(#${plotClipId})`}>

      {/* Drawing head — the glowing edge that draws a newly appended route in. */}
      {growDrawnX != null && inPlotX(growDrawnX) && (() => {
        const spd = speedAtDistance(universalSSP, Math.max(0, gf.drawnTo - 0.5));
        return (
          <g pointerEvents="none" data-no-export="true">
            <rect x={growDrawnX - 7} y={PAD_T} width={14} height={GH} fill="var(--ltp-ssp-soft)" opacity={0.18} filter={`url(#${bloomSoftId})`}/>
            <line x1={growDrawnX} x2={growDrawnX} y1={PAD_T} y2={PAD_T + GH} stroke="var(--ltp-ssp-soft)" strokeWidth={1.2} opacity={0.85}/>
            {spd != null && <>
              <circle cx={growDrawnX} cy={yS(spd)} r={8} fill="var(--ltp-ssp)" opacity={0.5} filter={`url(#${bloomSoftId})`}/>
              <circle cx={growDrawnX} cy={yS(spd)} r={3} fill="var(--ltp-spark)"/>
            </>}
          </g>
        );
      })()}

      {/* Entry / Exit signal posts — chainage taken from the loaded APD row
          (§Entry/Exit Signal columns). Aspect colour only shows if the
          workbook actually carries an aspect column for it; otherwise the
          lamp is drawn neutral grey rather than guessing a colour, since the
          six-layer HEX schema this tab decodes doesn't itself carry aspect. */}
      {visibleLayers.signals && layers?.entrySignal && layers?.source === "live" && inPlotX(xS(0)) && (
        <g transform={`translate(${clampX(xS(0), 14)},${PAD_T})`} opacity={nearLocoX(xS(0)) ? 0.25 : 1}>
          <circle r={11} className="live-track-idle-glow" fill={aspectColor(layers.entrySignalAspect)}
            filter={`url(#${bloomSoftId})`} style={{ "--pulseSpeed": "2.6s" }}/>
          <SignalGlyph color={aspectColor(layers.entrySignalAspect)}/>
          <text y={-19} textAnchor="middle" fontSize={7} fill="var(--text-dim)" fontFamily="var(--font-mono)">{layers.entrySignal}</text>
          <title>{`Entry Signal ${layers.entrySignal}${layers.entrySignalAspect ? ` · Aspect: ${layers.entrySignalAspect}` : " · Aspect not present in loaded data"}`}</title>
        </g>
      )}
      {visibleLayers.signals && layers?.exitSignal && layers?.source === "live" && inPlotX(xS(layers.profileSpanNum || profileMaxDist)) && (
        <g transform={`translate(${clampX(xS(layers.profileSpanNum || profileMaxDist), 14)},${PAD_T})`} opacity={nearLocoX(xS(layers.profileSpanNum || profileMaxDist)) ? 0.25 : 1}>
          <circle r={11} className="live-track-idle-glow" fill={aspectColor(layers.exitSignalAspect)}
            filter={`url(#${bloomSoftId})`} style={{ "--pulseSpeed": "2.6s" }}/>
          <SignalGlyph color={aspectColor(layers.exitSignalAspect)}/>
          <text y={-19} textAnchor="middle" fontSize={7} fill="var(--text-dim)" fontFamily="var(--font-mono)">{layers.exitSignal}</text>
          <title>{`Exit Signal ${layers.exitSignal}${layers.exitSignalAspect ? ` · Aspect: ${layers.exitSignalAspect}` : " · Aspect not present in loaded data"}`}</title>
        </g>
      )}

      {/* EOA (End of Authority) marker — a small, fixed-size red badge
          pinned above the plot area (not floating at a large fixed size
          mid-chart), so it can never grow to hide a loco's info card —
          important once multiple locos may be on this profile at once. */}
      {visibleLayers.eoa && layers?.source === "apd" && (layers?.profileSpanNum || profileMaxDist) && inPlotX(xS(layers.profileSpanNum || profileMaxDist)) && (
        <g opacity={nearLocoX(xS(layers.profileSpanNum || profileMaxDist)) ? 0.3 : 1}>
          {/* Red light beam standing on the EOA line — the "wall" of the
              movement authority, pulsing faster than the calm START beam. */}
          <rect x={xS(layers.profileSpanNum || profileMaxDist) - 22} y={PAD_T} width={44} height={GH}
            fill={`url(#${cineIds.beamRed})`} className="live-track-beam" style={{ "--beam": "1.6s" }} pointerEvents="none"/>
          <line x1={xS(layers.profileSpanNum || profileMaxDist)} y1={PAD_T} x2={xS(layers.profileSpanNum || profileMaxDist)} y2={PAD_T+GH}
            stroke="var(--ltp-red)" strokeWidth={1.5} strokeDasharray="4,4" opacity={0.6} className="live-track-march"/>
          <g transform={`translate(${clampX(xS(layers.profileSpanNum || profileMaxDist), 26)},${PAD_T-12})`}>
            <rect x={-26} y={-11} width={52} height={15} rx={3} className="live-track-idle-glow"
              fill="var(--ltp-red)" filter={`url(#${bloomSoftId})`} style={{ "--pulseSpeed": "1.5s" }}/>
            <rect x={-26} y={-11} width={52} height={15} rx={3} fill="var(--ltp-red)" fillOpacity={0.16} stroke="var(--ltp-red)" strokeWidth={1.2}/>
            <text x={0} y={0.5} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--ltp-red)" fontFamily="var(--font-mono)">⚠ EOA</text>
          </g>
          <title>End of Authority (EOA) · Position can change, like SOS location</title>
        </g>
      )}

      {/* ── Profile length — a dimension bar above the plot spanning the WHOLE
           profile (chainage 0 → span), so the total length is readable at a
           glance instead of being implied. It follows zoom/pan: only the
           visible part is drawn, the end caps appear only when that end of
           the profile is actually on screen, and off-screen ends get a
           chevron instead. Span uses the same value the EOA marker uses. ── */}
      {(() => {
        // While a new route is being drawn in, the bar (and its length) grow with it.
        const spanM = gf ? gf.span : profileSpanTrue;
        if (!(spanM > 0)) return null;
        const xa = xS(0), xb = xS(spanM);
        const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
        const vLo = Math.max(lo, PAD_L), vHi = Math.min(hi, PLOT_R);
        if (vHi - vLo < 90) return null;
        const y = PAD_T - 33;
        const absAt = d => absKnown ? `${Math.round(chainageOffset + absDir * d)} m` : `+${Math.round(d)} m`;
        const leftD = xa <= xb ? 0 : spanM, rightD = xa <= xb ? spanM : 0;
        const lenTxt = `PROFILE LENGTH  ${Math.round(spanM).toLocaleString()} m` + (spanM >= 1000 ? `  ·  ${(spanM / 1000).toFixed(2)} km` : "");
        const midX = (vLo + vHi) / 2, pillW = Math.min(vHi - vLo - 24, lenTxt.length * 4.9 + 20);
        const capL = lo >= PAD_L - 0.5, capR = hi <= PLOT_R + 0.5;
        return (
          <g key={`span-bar-${profileEpoch}`} pointerEvents="none">
            <line x1={vLo} x2={vHi} y1={y} y2={y} stroke="var(--ltp-sky)" strokeWidth={1.2} opacity={0.75}
              className="live-track-span-draw" style={{ transformOrigin: `${midX}px ${y}px` }}/>
            <line x1={vLo} x2={vHi} y1={y} y2={y} stroke="var(--ltp-text-hi)" strokeWidth={1.4} strokeDasharray="2,30"
              opacity={0.9} className="live-track-march"/>
            {capL
              ? <g className="live-track-span-cap"><line x1={vLo} x2={vLo} y1={y - 5} y2={y + 5} stroke="var(--ltp-sky)" strokeWidth={1.4}/>
                  <polygon points={`${vLo},${y} ${vLo + 6},${y - 3} ${vLo + 6},${y + 3}`} fill="var(--ltp-sky)"/></g>
              : <text x={vLo + 2} y={y + 3} fontSize={9} fill="var(--ltp-sky)" opacity={0.8}>«</text>}
            {capR
              ? <g className="live-track-span-cap"><line x1={vHi} x2={vHi} y1={y - 5} y2={y + 5} stroke="var(--ltp-sky)" strokeWidth={1.4}/>
                  <polygon points={`${vHi},${y} ${vHi - 6},${y - 3} ${vHi - 6},${y + 3}`} fill="var(--ltp-sky)"/></g>
              : <text x={vHi - 2} y={y + 3} fontSize={9} fill="var(--ltp-sky)" opacity={0.8} textAnchor="end">»</text>}
            <g className="live-track-span-label">
              <rect x={midX - pillW / 2} y={y - 8} width={pillW} height={16} rx={8}
                fill="var(--bg-base)" stroke="var(--ltp-sky)" strokeWidth={1} opacity={0.96}/>
              <text x={midX} y={y + 3} fontSize={8} fontWeight={700} textAnchor="middle" fill="var(--ltp-sky-text)"
                fontFamily="var(--font-mono)" letterSpacing={0.6}>{lenTxt}</text>
            </g>
            {capL && <text x={vLo + 9} y={y - 8} fontSize={7} fill="var(--ltp-sky-text)" opacity={0.85} fontFamily="var(--font-mono)">{absAt(leftD)}</text>}
            {capR && <text x={vHi - 9} y={y - 8} fontSize={7} fill="var(--ltp-sky-text)" opacity={0.85} textAnchor="end" fontFamily="var(--font-mono)">{absAt(rightD)}</text>}
            <title>{`Profile length ${Math.round(spanM)} m · ${absAt(leftD)} ↔ ${absAt(rightD)}`}</title>
          </g>
        );
      })()}

      {/* START flag — mirrors the EOA badge at the profile's other end. */}
      {(() => {
        const xs0 = xS(0);
        if (!inPlotX(xs0) || !(layers?.profileSpanNum || profileMaxDist)) return null;
        return (
          <g pointerEvents="none">
          <rect x={xs0 - 18} y={PAD_T} width={36} height={GH} fill={`url(#${cineIds.beamCyan})`}
            className="live-track-beam" style={{ "--beam": "3.4s" }}/>
          <g transform={`translate(${clampX(xs0, 22)},${PAD_T - 12})`}>
            <rect x={-22} y={-11} width={44} height={15} rx={3} fill="var(--ltp-sky)" fillOpacity={0.14} stroke="var(--ltp-sky)" strokeWidth={1.1}/>
            <text x={0} y={0.5} textAnchor="middle" fontSize={7.5} fontWeight={700} fill="var(--ltp-sky-text)" fontFamily="var(--font-mono)">▶ START</text>
            <title>Profile start (chainage 0)</title>
          </g>
          </g>
        );
      })()}

      {/* ── Loco movement trail — always exactly ONE line per loco, the
           whole history of (distance, speed) points connected in order.
           Distance is kept strictly monotonic (see monoDist below) so
           this single path can never fold back on itself, and it is
           never split into multiple segments — a jump just shows as a
           fast-rising/falling stretch of the same one line. ── */}
      {locoList.map(loco => {
        if (!loco.trail || loco.trail.length < 2) return null;
        const color = loco.emergency > 0 ? "var(--ltp-red)" : (LOCO_COLORS[loco.colorIdx % LOCO_COLORS.length]);
        const pts = loco.trail.filter(p => nearProfile(p.d)).map(p => [xS(p.d), yS(p.spd)]);
        if (pts.length < 2) return null;
        const d = smoothPathD(pts);
        return (
          <g key={`trail-${loco.locoId}`} opacity={loco.silentSec ? 0.35 : 1} style={{ transition: "opacity 0.6s" }}>
            {/* Soft ambient glow underneath the real line — purely a blurred
                duplicate of the same path, so it can never diverge from the
                actual plotted data. */}
            <path d={d} fill="none" stroke={color} strokeWidth={4} strokeLinejoin="round"
              strokeLinecap="round" opacity={0.35} filter={`url(#${trailGlowId})`}/>
            {/* The real, static trail — unchanged. */}
            <path d={d} fill="none" stroke={color}
              strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" opacity={0.55}/>
            {/* Slow-drifting "energy flow" highlight riding along the same
                path — decorative only, drawn on top, never affects the
                data line beneath it. */}
            <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round"
              strokeLinecap="round" opacity={0.8} strokeDasharray="2,26"
              className="live-track-trail-flow"/>
          </g>
        );
      })}

      {/* ── Loco markers ── */}
      {locoList.map(loco => {
        if (loco.monoDist == null) return null;
        const x = xS(loco.monoDist);
        const y = yS(loco.speed || 0);
        const isPrimary = loco.locoId === primaryId;
        const color = loco.emergency > 0 ? "var(--ltp-red)" : (LOCO_COLORS[loco.colorIdx % LOCO_COLORS.length]);
        const touching = !!touchingMap[loco.locoId];
        // "Touching" a marker/line brightens the icon to compensate for the
        // chrome we just dimmed behind it above — a bit bigger, a soft
        // white glow filter, and a brighter/faster halo ring, so it always
        // reads as the foreground element right where the two meet.
        const iconSize = (isPrimary ? 26 : 20) * (touching ? 1.12 : 1);
        const braking = loco.brake >= 1 && loco.brake <= 3;
        const brakeColor = loco.brake === 1 ? "var(--ltp-amber)" : loco.brake === 2 ? "var(--ltp-orange)" : "var(--ltp-red)";
        const boxW = 164, boxH = 96;
        // Card placement. Default is above the icon; if there isn't room
        // above (loco near the top of the speed axis) it flips BELOW the
        // icon instead of being cut off by the top of the chart. Near the
        // left/right edge it slides inward, with its pointer still aimed at
        // the icon, so the whole card is always visible.
        // Acceleration → body tilt (nose up while speeding up, nose down while
        // slowing), from the last two trail samples. Level when stopped or
        // cruising, so a steady loco never sits permanently tilted.
        const tilt = (() => {
          const tr = loco.trail || [], spd = loco.speed || 0;
          if (!spd || tr.length < 2) return 0;
          const last = tr[tr.length - 1], prev = tr[tr.length - 2];
          const accel = last.spd === spd ? spd - prev.spd : spd - last.spd;
          return Math.max(-7, Math.min(7, -accel * 0.5));
        })();
        // Gap between the icon's centre and the card: just enough to clear
        // the pantograph (~0.62× iconSize) and the "B" brake badge
        // (~0.9× iconSize) above the body — scales with iconSize, so the
        // bigger primary / "touching" icon gets a matching gap. (The old
        // fixed 22px sat on the pantograph; 1.6× was too far away.)
        const cardGap = Math.round(iconSize * 1.05 + 10);
        const flipBelow = (y - cardGap - boxH - 10) < 4;
        const cardTop = flipBelow ? cardGap : -cardGap - boxH;
        const cardDx = clampX(x, boxW / 2 + 4) - x;
        const ptrX = Math.max(-boxW / 2 + 12, Math.min(boxW / 2 - 12, -cardDx));
        // Connector from the card's pointer tip to THIS loco — so with several
        // locos on one chart, every card visibly belongs to its own loco.
        // Coordinates are loco-local (0,0 = icon centre).
        const tipX = cardDx + ptrX;
        const tipY = flipBelow ? cardTop - 8 : cardTop + boxH + 8;
        const anchorY = flipBelow ? iconSize * 0.45 : -iconSize * 0.7;
        return (
          <g key={loco.locoId}
             style={{
               transform: `translate(${x}px, ${y}px)`,
               transition: (isZooming || scaleJustChanged) ? "opacity 0.6s" : "transform 1.6s linear, opacity 0.6s",
               opacity: loco.silentSec ? 0.5 : 1,   // NO SIGNAL — faded, see LOCO_STALE_MS
             }}>
            {loco.emergency > 0 && (
              <circle r={16} fill={color} opacity={0.25}>
                <animate attributeName="r" values="12;18;12" dur="1s" repeatCount="indefinite"/>
              </circle>
            )}
            {/* Emergency strobe — a double red flash around the loco (like a
                hazard light) whenever it reports an emergency or an EB. */}
            {(loco.emergency > 0 || loco.brake === 4) && !CINE_REDUCED && (
              <circle r={iconSize * 1.7} fill="var(--ltp-red)" className="loco-strobe" data-no-export="true"
                filter={`url(#${bloomSoftId})`} pointerEvents="none"/>
            )}

            {/* Always-on ambient bloom — a soft "breathing" halo behind every
                loco, faster and brighter the faster it's actually going, so
                a stationary loco reads as calm and a fast one reads as
                energetic even at a glance across the whole chart. Purely
                decorative: doesn't affect touching/emergency states above. */}
            <circle className="live-track-idle-glow" r={iconSize * 0.9} fill={color}
              filter={`url(#${bloomSoftId})`}
              style={{ "--pulseSpeed": `${Math.max(0.9, 2.6 - (loco.speed || 0) / 70)}s` }}/>

            {/* Bright halo — only while the icon is actually touching some
                piece of profile chrome (see touchingMap), so it acts as a
                deliberate "look here, this is the loco, not the marker"
                signal rather than a constant decoration. */}
            {touching && (
              <circle r={iconSize * 0.82} fill="none" stroke="var(--ltp-ink)" strokeWidth={2}>
                <animate attributeName="r" values={`${iconSize*0.7};${iconSize*0.98};${iconSize*0.7}`} dur="0.85s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.95;0.55;0.95" dur="0.85s" repeatCount="indefinite"/>
              </circle>
            )}

            {/* Cinematic loco dressing (decoration only, no pointer events):
                motion streaks trailing behind the loco (longer + faster with
                speed), two counter-rotating radar rings and pulsing
                target-lock brackets. */}
            {!CINE_REDUCED && (
              <g pointerEvents="none">
                {(loco.speed || 0) > 0 && (() => {
                  const back = (isUpLine ? loco.dir !== 1 : loco.dir === 2) ? 1 : -1;
                  const len = Math.min(70, 12 + (loco.speed || 0) * 0.5);
                  return [-0.14, 0, 0.14].map((oy, k) => (
                    <line key={k} x1={back * iconSize * 0.62} x2={back * (iconSize * 0.62 + len * (1 - k * 0.2))}
                      y1={iconSize * (oy - 0.05)} y2={iconSize * (oy - 0.05)} stroke={color} strokeWidth={1.1}
                      strokeLinecap="round" strokeDasharray="7,5" opacity={0.6 - k * 0.12} className="live-track-streak"
                      style={{ animationDuration: `${Math.max(0.15, 0.7 - (loco.speed || 0) / 250)}s` }}/>
                  ));
                })()}
                <g transform={`translate(0,${-iconSize * 0.12})`}>
                  <circle r={iconSize * 1.15} fill="none" stroke={color} strokeWidth={1} strokeDasharray="10 34" opacity={0.6}>
                    <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="4s" repeatCount="indefinite"/>
                  </circle>
                  <circle r={iconSize * 1.4} fill="none" stroke={color} strokeWidth={0.8} strokeDasharray="3 22" opacity={0.35}>
                    <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="7s" repeatCount="indefinite"/>
                  </circle>
                  {(() => {
                    const bs = iconSize * 0.8, bl = iconSize * 0.24;
                    return (
                      <path fill="none" stroke={color} strokeWidth={1.3} strokeLinecap="round" opacity={0.8}
                        d={`M${-bs},${-bs + bl} V${-bs} H${-bs + bl} M${bs - bl},${-bs} H${bs} V${-bs + bl} M${bs},${bs - bl} V${bs} H${bs - bl} M${-bs + bl},${bs} H${-bs} V${bs - bl}`}>
                        <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.4s" repeatCount="indefinite"/>
                      </path>
                    );
                  })()}
                </g>
              </g>
            )}

            {/* Brief "ping" ring on every fresh packet — remounts on each
                flashAt so it always replays, but it's a small transient
                accent, not the whole info card, so nothing flickers. */}
            <g key={`ping-${loco.flashAt || "init"}`} className="live-track-ping">
              <circle r={iconSize * 0.75} fill="none" stroke={color} strokeWidth={1.5}/>
            </g>
            <g key={`ping2-${loco.flashAt || "init"}`} className="live-track-ping-2">
              <circle r={iconSize * 0.75} fill="none" stroke={color} strokeWidth={1}/>
            </g>

            <g filter={touching ? "url(#locoTouchGlow)" : undefined}>
              <LocoIcon color={color} size={iconSize} speed={loco.speed || 0} reverse={isUpLine ? loco.dir !== 1 : loco.dir === 2}
                brake={loco.brake || 0} emergency={loco.emergency || 0} tilt={tilt}/>
            </g>

            {/* Brake badge — shown right on the icon whenever BRAKE_APPLIED
                is Overspeed(1) / Service Brake(2) / Full Service(3), per
                the loco→station packet's own BRAKE_APPLIED field. */}
            {braking && (
              <g transform={`translate(${iconSize * 0.46}, ${-iconSize * 0.62})`}>
                <circle r={7.5} fill={brakeColor} stroke="var(--bg-base)" strokeWidth={1.2}/>
                <text y={2.6} textAnchor="middle" fontSize={8} fontWeight={800}
                  fill="#0b0f14" fontFamily="var(--font-mono)">B</text>
              </g>
            )}

            <title>{`Loco #${loco.locoId} · ${loco.speed ?? "?"} kmph · ${DIR_LABEL[loco.dir]||"?"} · ${BRAKE_LABEL[loco.brake]||"—"} · dist ${loco.distFromOrigin}m from ${loco.anchor ? `RFID #${loco.anchor.tagId}` : "origin"}`}</title>

            {/* ── Loco-movement info card — mounted ONCE per loco (key is
                 the stable locoId, not the packet timestamp), so it never
                 remounts/re-flashes on every packet. Its text just updates
                 in place; only the very first appearance plays the pop-in
                 animation, giving a constant, non-flickering display. ── */}
            {/* Connector: card pointer → this loco, in the loco's own colour. */}
            <g className="live-track-pop" pointerEvents="none">
              <line x1={tipX} y1={tipY} x2={0} y2={anchorY} stroke={color} strokeWidth={1.2} opacity={0.85}/>
              <circle cx={0} cy={anchorY} r={2.4} fill={color}/>
            </g>
            {/* Card border + pointer always use the LOCO's colour (not the brake
                colour) so it matches its own loco; brake state is shown by the
                Brake row (and the "B" badge on the icon). */}
            <g transform={`translate(${cardDx}, ${cardTop})`}>
              <g className="live-track-pop">
                <rect x={-boxW/2} y={0} width={boxW} height={boxH} rx={7}
                  fill="var(--bg-raised)" stroke={color} strokeWidth={1.3} opacity={0.97}/>
                {flipBelow
                  ? <polygon points={`${ptrX-6},0 ${ptrX+6},0 ${ptrX},-8`} fill={color} />
                  : <polygon points={`${ptrX-6},${boxH} ${ptrX+6},${boxH} ${ptrX},${boxH+8}`} fill={color} />}
                {(() => {
                  const L = -boxW/2 + 11, R = boxW/2 - 11;
                  const rows = [
                    ["Abs Loc", loco.absLoc != null ? `${loco.absLoc} m` : "—", null],
                    ["Speed",   loco.speed != null ? `${loco.speed} kmph` : "—", null],
                    ["DOM",     DIR_LABEL[loco.dir] || "—", null],
                    ["Train Len", loco.trainLength != null ? `${loco.trainLength} m` : "—", null],
                    ["Brake",   BRAKE_LABEL[loco.brake] || "—", braking ? brakeColor : null],
                  ];
                  return (
                    <>
                      <text x={L} y={17} fontSize={10} fontWeight={700} fill={color} fontFamily="var(--font-mono)">Loco #{loco.locoId}</text>
                      {loco.silentSec > 0 && (
                        <text x={R} y={16.5} fontSize={7.5} fontWeight={700} textAnchor="end" fill="var(--text-secondary)"
                          fontFamily="var(--font-mono)" letterSpacing={0.4}>{`NO SIGNAL ${loco.silentSec}s`}</text>
                      )}
                      <line x1={L} x2={R} y1={25} y2={25} stroke={color} strokeWidth={0.8} opacity={0.35}/>
                      {rows.map(([k, v, c], ri) => (
                        <g key={k} transform={`translate(0, ${40 + ri * 13})`}>
                          <text x={L} y={0} fontSize={8} fill="var(--text-secondary)" opacity={0.85} fontFamily="var(--font-mono)">{k}</text>
                          <text x={R} y={0} fontSize={8.5} textAnchor="end" fontWeight={c ? 700 : 500}
                            fill={c || "var(--text-primary, #e5e7eb)"} fontFamily="var(--font-mono)">{v}</text>
                        </g>
                      ))}
                    </>
                  );
                })()}
              </g>
            </g>
          </g>
        );
      })}

      {/* ── Brake-application dots — one per brake event (NSB / FSB / EB),
           frozen at the exact chainage + speed where the loco reported it,
           so they stay on the trail as the loco moves on. Drawn last so
           they sit above the loco icon and its info card and stay hoverable. ── */}
      {visibleLayers.brakes && locoList.flatMap(loco => (loco.brakeEvents || []).map(b => {
        const bt = BRAKE_TYPES[b.code];
        if (!bt || !Number.isFinite(b.d)) return null;
        const bx = xS(b.d), by = yS(b.spd);
        if (!inPlotX(bx)) return null;
        const hot = hoverBrake === b.key;
        return (
          <g key={b.key} transform={`translate(${bx},${by})`} style={{ cursor: "pointer" }}
             onMouseEnter={() => setHoverBrake(b.key)}
             onMouseLeave={() => setHoverBrake(k => (k === b.key ? null : k))}>
            <circle r={11} fill="rgba(0,0,0,0)" pointerEvents="all"/>
            <circle r={9} fill={bt.color} opacity={0.35} filter={`url(#${bloomSoftId})`} pointerEvents="none"/>
            {!CINE_REDUCED && (
              <circle r={5} fill="none" stroke={bt.color} strokeWidth={1.2} opacity={0} pointerEvents="none"
                className="live-track-brake-ripple" style={{ animationDuration: b.code === 4 ? "1s" : "1.8s" }}/>
            )}
            {hot && <circle r={10} fill="none" stroke={bt.color} strokeWidth={1.4} opacity={0.65}/>}
            <circle r={hot ? 6.5 : 5} fill={bt.color} stroke="var(--bg-base)" strokeWidth={1.5}/>
          </g>
        );
      }))}
      </g>

      {/* ── Brake popup — outside the plot clip so it never gets cut off at
           the edges; pointer-events off so it can't steal the hover from
           its own dot (which would make it flicker). ── */}
      {visibleLayers.brakes && hoverBrake && (() => {
        let hit = null;
        for (const loco of locoList) {
          const b = (loco.brakeEvents || []).find(e => e.key === hoverBrake);
          if (b) { hit = { b, loco }; break; }
        }
        if (!hit) return null;
        const { b, loco } = hit;
        const bt = BRAKE_TYPES[b.code];
        if (!bt || !Number.isFinite(b.d)) return null;
        const px = xS(b.d), py = yS(b.spd);
        if (!inPlotX(px)) return null;
        const boxW = 184, boxH = 92, gap = 12;
        const flipBelow = (py - gap - boxH) < 34;
        const cx = Math.min(Math.max(px, PAD_L + boxW / 2 + 2), PAD_L + GW - boxW / 2 - 2);
        const top = flipBelow ? py + gap : py - gap - boxH;
        const ptrX = Math.max(-boxW / 2 + 12, Math.min(boxW / 2 - 12, px - cx));
        const L = -boxW / 2 + 11, R = boxW / 2 - 11;
        const rows = [
          ["Abs Location", b.absLoc != null ? `${b.absLoc} m` : "—", null],
          ["Brake Type",   bt.short, bt.color],
          ["Speed",        `${b.spd} kmph`, null],
          ["Time",         fmtClock(b.t), null],
        ];
        return (
          <g transform={`translate(${cx}, ${top})`} pointerEvents="none">
            <rect x={-boxW/2} y={0} width={boxW} height={boxH} rx={7}
              fill="var(--bg-raised)" stroke={bt.color} strokeWidth={1.3} opacity={0.98}/>
            {flipBelow
              ? <polygon points={`${ptrX-6},0 ${ptrX+6},0 ${ptrX},-8`} fill={bt.color}/>
              : <polygon points={`${ptrX-6},${boxH} ${ptrX+6},${boxH} ${ptrX},${boxH+8}`} fill={bt.color}/>}
            <text x={L} y={17} fontSize={10} fontWeight={800} fill={bt.color} fontFamily="var(--font-mono)" letterSpacing={0.5}>
              {bt.full.toUpperCase()}{locoList.length > 1 ? ` · #${loco.locoId}` : ""}
            </text>
            <line x1={L} x2={R} y1={25} y2={25} stroke={bt.color} strokeWidth={0.8} opacity={0.35}/>
            {rows.map(([k, v, c], ri) => (
              <g key={k} transform={`translate(0, ${40 + ri * 13})`}>
                <text x={L} y={0} fontSize={8} fill="var(--text-secondary)" opacity={0.85} fontFamily="var(--font-mono)">{k}</text>
                <text x={R} y={0} fontSize={8.5} textAnchor="end" fontWeight={c ? 700 : 500}
                  fill={c || "var(--text-primary, #e5e7eb)"} fontFamily="var(--font-mono)">{v}</text>
              </g>
            ))}
          </g>
        );
      })()}

      {/* ── Hover crosshair + readout ── the exact chainage under the cursor
           and the SSP speed allowed there, with a glowing lock-on dot on the
           speed line. Interactive only: marked data-no-export so PNG/SVG
           exports never capture a stray cursor. */}
      {hoverPt && !isPanning && (() => {
        const hx = hoverPt.x;
        const d = isUpLine
          ? domainMin + (PAD_L + GW - hx) / GW * domainSpan
          : domainMin + (hx - PAD_L) / GW * domainSpan;
        const spanM = layers?.profileSpanNum || profileMaxDist;
        const onProfile = d >= 0 && d <= spanM;
        const spd = onProfile && visibleLayers.ssp ? speedAtDistance(universalSSP, d) : null;
        const sy = spd != null ? yS(spd) : null;
        const absTxt = absKnown ? `${Math.round(chainageOffset + absDir * d).toLocaleString()} m` : `+${Math.round(d)} m`;
        const line2 = !onProfile ? "outside profile" : spd != null ? `SSP ${spd} kmph` : `local ${Math.round(d)} m`;
        const boxW = 118, boxH = 30;
        // Readout sits right of the cursor, flipping to the left near the edge.
        const boxX = hx + 12 + boxW > PAD_L + GW - 2 ? Math.max(PAD_L + 2, hx - 12 - boxW) : hx + 12;
        const boxY = Math.min(Math.max((sy ?? hoverPt.y) - boxH - 10, PAD_T + 4), PAD_T + GH - boxH - 4);
        return (
          <g pointerEvents="none" data-no-export="true" className="live-track-cross">
            <line x1={hx} x2={hx} y1={PAD_T} y2={PAD_T + GH} stroke="var(--ltp-sky-text)" strokeWidth={0.8} strokeDasharray="3,3" opacity={0.7}/>
            {sy != null && <>
              <line x1={PAD_L} x2={PAD_L + GW} y1={sy} y2={sy} stroke="var(--ltp-ssp)" strokeWidth={0.6} strokeDasharray="2,4" opacity={0.45}/>
              <circle cx={hx} cy={sy} r={9} fill="var(--ltp-ssp)" opacity={0.35} filter={`url(#${bloomSoftId})`}/>
              <circle cx={hx} cy={sy} r={4.5} fill="none" stroke="var(--ltp-ssp-soft)" strokeWidth={1}/>
              <circle cx={hx} cy={sy} r={1.8} fill="var(--ltp-spark)"/>
              <rect x={PAD_L - 36} y={sy - 7} width={32} height={13} rx={3} fill="var(--ltp-ssp-box-bg)" stroke="var(--ltp-ssp)" strokeWidth={0.8}/>
              <text x={PAD_L - 20} y={sy + 2.5} textAnchor="middle" fontSize={7.5} fontWeight={700} fill="var(--ltp-ssp-text)" fontFamily="var(--font-mono)">{spd}</text>
            </>}
            <g transform={`translate(${boxX},${boxY})`}>
              <rect width={boxW} height={boxH} rx={5} fill="var(--ltp-box-bg)" fillOpacity={0.92} stroke="var(--ltp-sky)" strokeOpacity={0.7} strokeWidth={0.9}/>
              <rect width={3} height={boxH} rx={1.5} fill={spd != null ? "var(--ltp-ssp)" : "var(--ltp-sky)"}/>
              <text x={10} y={12} fontSize={8} fontWeight={700} fill="var(--ltp-text-hi)" fontFamily="var(--font-mono)">{absTxt}</text>
              <text x={10} y={23} fontSize={7.5} fill={spd != null ? "var(--ltp-ssp-text)" : "var(--ltp-muted)"} fontFamily="var(--font-mono)">{line2}</text>
            </g>
          </g>
        );
      })()}
    </svg>

    </div>
    {/* Mouse-gesture + brake-key hint — used to float over the bottom-left
        corner of the plot (position: absolute, bottom/left) where it could
        end up sitting directly on top of the SSP boundary / Abs Location
        labels and the RFID tag row underneath the axis. Moved into normal
        document flow BELOW the whole chart box instead, so it can never
        touch any profile drawing — just a slim caption under the chart. */}
    <div style={{
      display: "flex", justifyContent: "center", gap: 10, flexShrink: 0,
      padding: "2px 6px", opacity: 0.5, pointerEvents: "none",
    }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 7, color: "var(--text-dim)" }}>⚲ scroll to zoom</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 7, color: "var(--text-dim)" }}>✋ middle-drag to pan</span>
      {visibleLayers.brakes && Object.values(BRAKE_TYPES).map(t => (
        <span key={t.short} style={{ fontFamily: "var(--font-mono)", fontSize: 7, fontWeight: 700, color: t.color }}>● {t.short}</span>
      ))}
    </div>
    </div>
  );
}

/** Accepts the RFID Tag Table in whichever shape SvkSim hands it over —
 *  { map: {tagId: loc} }, a bare {tagId: loc} object, { columns, rows }, or an
 *  array of row objects — and returns one { [tagId]: realLocationMetres } map. */
function buildTagLocationMap(t) {
  if (!t) return null;
  const finish = m => (m && Object.keys(m).length ? m : null);
  if (t.map && typeof t.map === "object" && !Array.isArray(t.map) && Object.keys(t.map).length) {
    const m = {};
    Object.entries(t.map).forEach(([k, v]) => { const n = parseNum(v); if (n != null) m[k] = n; });
    return finish(m);
  }
  const fromRows = (cols, rows, get) => {
    const tagC = findCol(cols, ["rfid tag", "tag id", "tag"]);
    const locC = findCol(cols.filter(c => c !== tagC), ["location", "chainage", "km", "loc"]);
    if (!tagC || !locC) return null;
    const m = {};
    rows.forEach(r => { const id = parseNum(get(r, tagC)), loc = parseNum(get(r, locC)); if (id != null && loc != null) m[id] = loc; });
    return finish(m);
  };
  if (Array.isArray(t.columns) && Array.isArray(t.rows)) {
    const r = fromRows(t.columns, t.rows, (row, c) => row[t.columns.indexOf(c)]);
    if (r) return r;
  }
  const arr = Array.isArray(t) ? t : (Array.isArray(t.rows) ? t.rows : null);
  if (arr && arr.length && typeof arr[0] === "object" && !Array.isArray(arr[0])) {
    const r = fromRows(Object.keys(arr[0]), arr, (row, c) => row[c]);
    if (r) return r;
  }
  if (typeof t === "object" && !Array.isArray(t)) {
    const m = {};
    Object.entries(t).forEach(([k, v]) => { const n = parseNum(v); if (/^\d+$/.test(k) && n != null) m[Number(k)] = n; });
    return finish(m);
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════
 * Main exported component
 * ═══════════════════════════════════════════════════════════════════ */
/* Optional props used by 📡 LIVE → 🗺 PROFILE (SVK SIM passes none of them, so it behaves as before):
 *   liveOnly  — no "APD TABLE ROW" source (LIVE has no APD file); always the profile on the wire
 *   txScanAll — fold every Station→Loco packet of the log, not only the last ~60 events, so the
 *               profile geometry (sent once, early) is found even when the view opens later
 *   alerts    — false = no brake / SOS / overspeed sounds here (the LIVE page already plays them) */
export default function LiveTrackProfile({ apdResult, serialLog, rfidTagTable: rfidTagTableProp, rfidTags, tagTable, rfidTagResult,
                                           liveOnly = false, txScanAll = false, alerts = true }) {
  const rfidTagTable = rfidTagTableProp ?? rfidTags ?? tagTable ?? rfidTagResult ?? null;
  const [source, setSource] = useState("live"); // "live" | "apd"
  const [selectedSno, setSelectedSno] = useState(null);
  const [liveProfile, setLiveProfile] = useState(null);
  const [locos, setLocos] = useState({});          // { [locoId]: {...} }
  const [primaryId, setPrimaryId] = useState(null);
  const colorIdxRef = useRef({});
  const nextColorRef = useRef(0);
  // ── Tab-hidden tracking (for the run-gap check below) ──────────────────
  // Browsers throttle or fully pause a background tab's timers, so simply
  // switching tabs (or minimizing the window) for more than a few seconds
  // could, on its own, make it LOOK like this loco went quiet for longer
  // than RUN_GAP_MS — which then wiped its trail/brake history as a "new
  // run" the moment you switched back, even though the loco itself never
  // actually stopped reporting. hiddenAccumRef totals up real-world time
  // spent hidden since mount; that total gets subtracted back out of the
  // elapsed-time check below, so only genuine on-screen inactivity (the
  // loco really did stop sending packets while you were watching) counts.
  const hiddenAccumRef = useRef(0);
  const hiddenSinceRef = useRef(typeof document !== "undefined" && document.hidden ? Date.now() : null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => {
      if (document.hidden) {
        hiddenSinceRef.current = Date.now();
      } else if (hiddenSinceRef.current != null) {
        hiddenAccumRef.current += Date.now() - hiddenSinceRef.current;
        hiddenSinceRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  // Holds the last Station→Loco (C.4.2) serial-log EVENT already folded into
  // the live profile — every TX event after it in the log is new and gets
  // processed in order; nothing before it is re-decoded. (Compared by object
  // identity rather than hex, because two different packets can carry
  // identical bytes and the same packet must never be applied twice.)
  const lastTxEvRef = useRef(null);

  // ── Run / session control (no page reload needed between tests) ────────
  // The serial log keeps its last ~500 events, and the effect below
  // re-scans the newest of them on every update. So "clearing" the chart
  // can't just empty the state — the very next update would rebuild it from
  // the same old packets. Instead a MARK (the newest serial event at the
  // moment of clearing) is remembered, and only events AFTER it count:
  //   • clearMarkRef        — whole chart (⟲ CLEAR button)
  //   • locoMarkRef[locoId] — one loco (× on its chip)
  // A new transmission empties the serial log itself (SvkSim does that on
  // TRANSMIT), which resets everything automatically — see the effect below.
  const serialLogRef = useRef(serialLog);
  serialLogRef.current = serialLog;
  const clearMarkRef = useRef(null);
  const locoMarkRef = useRef({});
  const lastEvent = () => { const l = serialLogRef.current; return l && l.length ? l[l.length - 1] : null; };
  // Mirrors `activeLayers` outside of the effect's dependency array (see
  // below) so the loco-telemetry effect can read the current profile's RFID
  // layer without re-running every time that profile object changes.
  const layersRef = useRef(null);
  // Mirrors `liveProfile` specifically (not whichever of live/APD is
  // currently active) so the wire-decode logic below can see the profile
  // it's building up across packets without depending on its own output —
  // same anti-feedback-loop trick as layersRef, just scoped to "live" mode.
  const liveProfileRef = useRef(null);
  useEffect(() => { liveProfileRef.current = liveProfile; }, [liveProfile]);
  // Same trick for the real-world chainage offset (below) — read fresh
  // inside the effect without making it a dependency.
  const chainageOffsetRef = useRef(0);

  /* ── APD rows available for the picker ── */
  const apdRows = useMemo(() => {
    if (!apdResult?.columns || !apdResult?.rows) return [];
    const snoIdx = apdResult.columns.indexOf("S.No");
    if (snoIdx < 0) return [];
    return apdResult.rows.map(r => r[snoIdx]).filter(v => v !== "" && v != null);
  }, [apdResult]);

  useEffect(() => {
    if (source === "apd" && selectedSno == null && apdRows.length) setSelectedSno(apdRows[0]);
  }, [source, apdRows, selectedSno]);

  const apdProfile = useMemo(() => {
    if (source !== "apd" || !apdResult?.columns || !apdResult?.rows || selectedSno == null) return null;
    const snoIdx = apdResult.columns.indexOf("S.No");
    const row = apdResult.rows.find(r => String(r[snoIdx]) === String(selectedSno));
    return row ? buildProfileFromApdRow(apdResult.columns, row) : null;
  }, [source, apdResult, selectedSno]);

  const activeLayers = source === "apd" ? apdProfile : liveProfile;

  // Keep the ref in sync with the latest profile on every render, so the
  // effect below always reads current data without needing `activeLayers`
  // in its own dependency array.
  useEffect(() => { layersRef.current = activeLayers; }, [activeLayers]);

  // ── Real-world chainage calibration ──────────────────────────────────
  // The profile's own RFID/TLI layer uses a LOCAL, 0-based distance
  // (cumDist: distance-from-start-of-this-profile). The loco's own
  // ABS_LOCO_LOC field, though, turns out to already be a real absolute
  // chainage — the same scale as the "RFID Tag Location" column in the
  // loaded RFID Tag Table (S.No / RFID Tag / RFID Tag Location). That's
  // exactly why the chart used to start at "0m" instead of the loco's
  // real location: cumDist and ABS_LOCO_LOC live on two different scales.
  //
  // Fix: for every tag that's both in this profile's TLI layer AND in the
  // loaded RFID Tag Table, the difference (real location − cumDist) is
  // the constant offset between the two scales. Average it across all
  // matching tags (protects against a single mistyped row) to get one
  // profile-wide offset. Chart internals (axis, gradient, tags, signals,
  // MA span) keep using the local 0-based cumDist exactly as before —
  // only the axis tick LABELS and the loco's own position are converted,
  // so nothing else needs to change.
  const tagLocationMap = useMemo(() => buildTagLocationMap(rfidTagTable), [rfidTagTable]);
  const calib = useMemo(() => {
    // Chainage direction along this profile (absDir): +1 when the real
    // chainage GROWS with local distance, −1 when it SHRINKS (e.g. an Up-line
    // profile whose tags read 144011 → 141117 as local distance grows).
    // Detected from the tag table: compare the real location of the
    // nearest-to-start and furthest matched tags. Everything converts with
    //   abs = offset + absDir·local   /   local = absDir·(abs − offset)
    // Assuming +1 unconditionally mapped a decreasing-chainage loco to a
    // NEGATIVE local distance, so it was drawn beyond START and swept away
    // from EOA as its Abs Loc fell.
    const tli = activeLayers?.tli || [];
    const matched = tagLocationMap
      ? tli.filter(t => tagLocationMap[t.tagId] != null).sort((a, b) => a.cumDist - b.cumDist)
      : [];
    let absDir = 1;
    if (matched.length >= 2) {
      const first = matched[0], last = matched[matched.length - 1];
      if (last.cumDist > first.cumDist && tagLocationMap[last.tagId] < tagLocationMap[first.tagId]) absDir = -1;
    }
    // Tier 0 — APD row: the profile's local 0 m IS its Reference TAG, so the
    // abs location at any point = table location of the Ref tag ± distance.
    if (tagLocationMap && activeLayers?.source === "apd") {
      const rt = parseNum(activeLayers.refTag);
      if (rt != null && tagLocationMap[rt] != null) return { offset: tagLocationMap[rt], absDir, calibrated: true, mode: "ref" };
    }
    // Tier 1 — RFID Tag Table: real location of every tag in this profile's
    // TLI layer. MEDIAN (not mean) of the per-tag differences, so a segment
    // appended in LIVE mode with a slightly-off splice distance can't drag
    // the offset away from the majority.
    if (matched.length) {
      const diffs = matched
        .map(t => tagLocationMap[t.tagId] - absDir * t.cumDist)
        .sort((x, y) => x - y);
      if (diffs.length) {
        const m = Math.floor(diffs.length / 2);
        const med = diffs.length % 2 ? diffs[m] : (diffs[m - 1] + diffs[m]) / 2;
        return { offset: med, absDir, calibrated: true, mode: "table" };
      }
    }
    // Tier 2 — no tag table: use the loco's own RFID read. At the moment it
    // reported LAST_RFID = a tag that is in this profile's TLI layer, its
    // ABS_LOCO_LOC ≈ that tag's real location, so (abs − tag local dist) is
    // the offset. Latched at the tag read (anchor.absAtTag), not live.
    // Tier 3 — nothing to match against: treat the loco's first ABS_LOCO_LOC
    // as 0 m so the icon still appears and moves (relative movement only).
    const lp = locos[primaryId] || Object.values(locos)[0];
    if (lp?.anchor?.absAtTag != null) return { offset: lp.anchor.absAtTag - absDir * lp.anchor.tagDist, absDir, calibrated: true, mode: "anchor" };
    if (lp?.firstAbs != null) return { offset: lp.firstAbs, absDir, calibrated: true, mode: "relative" };
    return { offset: 0, absDir, calibrated: false, mode: "none" };
  }, [tagLocationMap, activeLayers, locos, primaryId]);
  const chainageOffset = calib.offset;
  const absDir = calib.absDir;
  const calibrated = calib.calibrated;
  useEffect(() => { chainageOffsetRef.current = chainageOffset; }, [chainageOffset]);


  /* ── Fold the serial feed into loco telemetry + "profile on the wire" ──
     IMPORTANT: this effect depends ONLY on `serialLog`. It used to also
     depend on `activeLayers`, which caused a feedback loop in "LIVE MA (ON
     WIRE)" mode: decodeStationPacket() builds a brand-new object every time
     it runs, even for the exact same on-wire packet — so every run of this
     effect produced a new `liveProfile`, which changed `activeLayers`, which
     (being a dependency) re-ran this very effect again, forever. That
     constant re-firing repeatedly restarted the loco marker's position
     update mid-flight, so instead of smoothly animating between samples it
     kept snapping straight to the latest point — which is exactly the
     "only a straight line is updating" symptom. Reading the profile via
     `layersRef` (updated by the effect above, but not a dependency here)
     breaks that loop while still always seeing the current profile. */
  useEffect(() => {
    if (!serialLog || !serialLog.length) {
      // Empty log = a NEW transmission just started (SvkSim clears the log on
      // TRANSMIT). Start the chart fresh: no live profile, no locos, trails,
      // brake dots or cards left over from the previous test.
      liveProfileRef.current = null;
      lastTxEvRef.current = null;
      clearMarkRef.current = null;
      locoMarkRef.current = {};
      colorIdxRef.current = {};
      nextColorRef.current = 0;
      setLiveProfile(p => (p ? null : p));
      setLocos(p => (Object.keys(p).length ? {} : p));
      setPrimaryId(null);
      return;
    }
    // Only events after the last ⟲ CLEAR count (see clearMarkRef). If the
    // mark has already scrolled out of the log, every event is newer.
    const markIdx = clearMarkRef.current ? serialLog.lastIndexOf(clearMarkRef.current) : -1;
    const recent = serialLog.slice(Math.max(markIdx + 1, serialLog.length - 60));
    const recentBase = serialLog.length - recent.length;   // index of recent[0] in serialLog
    const locoMarkIdx = {};
    for (const [id, ev] of Object.entries(locoMarkRef.current)) locoMarkIdx[id] = serialLog.lastIndexOf(ev);

    // Most recently DECODABLE transmitted Station→Loco (C.4.2) packet →
    // "live" profile. Scans backward and, if the newest matching frame
    // fails to decode (e.g. a partial/truncated hex string mid-transmission),
    // keeps trying older ones instead of giving up and freezing the display
    // on whatever was last shown. Also tolerant of a few common event-type
    // spellings ("serial_tx", "tx", "s2l", …) rather than requiring an exact
    // "serial_tx" + numeric pkt_type match — decodeStationPacket() itself
    // already verifies the real packet type from the header bits, so
    // loosening this outer filter can't misclassify a genuine loco (RX)
    // packet as a station one.
    //
    // IMPORTANT — why this doesn't just setLiveProfile(dec) every time:
    // the station only resends the full profile geometry (SSP, gradient,
    // RFID/TLI, …) for the first few packets after it changes; after that
    // it keeps transmitting MA-only updates that share the same header
    // fields but carry NO geometry at all. Replacing the whole profile with
    // that empty one every time was exactly why "LIVE MA (ON WIRE)" looked
    // broken while "APD TABLE ROW" (a static pick, never replaced) didn't:
    // every MA-only tick was wiping out the good profile that had just been
    // shown. So: keep whatever profile is already being displayed; only
    // touch it when the header's LAST_REF_RFID actually changes (a genuine
    // new profile), and even then APPEND the new segment's geometry onto
    // the end of what's already there (pulled from the loaded APD table,
    // since the wire packet itself may not carry it) rather than replacing.
    //
    // What marks a NEW profile is REF_PROF_ID, not LAST_REF_RFID. The
    // simulator only attaches Track Profile geometry to the rows whose
    // ROUTE1..4 column is set (e.g. MA-table row 1 → APD S.No 13, row 7 →
    // APD S.No 4), and REF_PROF_ID changes on exactly those rows. LAST_REF_RFID
    // changes on EVERY row (498, 500, 502 …) as the loco passes tags. Keying on
    // it made every tag read look like a "new profile", which re-appended /
    // replaced the displayed profile each tick. Now:
    //   • packet with geometry + a REF_PROF_ID not yet shown → concatenate it
    //     at the shared RFID tag (appendProfile)
    //   • anything else → header refresh only; geometry stays exactly as-is
    //     until the next new profile is transmitted.
    //
    // Every new S2L packet since the last run is folded IN ORDER (not just
    // the newest one), so a geometry-carrying packet can't be skipped when a
    // couple of packets land between two renders.
    const txEvents = (txScanAll ? serialLog.slice(markIdx + 1) : recent).filter(ev => ev && ev.hex && isTxEvent(ev));
    const lastIdx = lastTxEvRef.current ? txEvents.lastIndexOf(lastTxEvRef.current) : -1;
    const pending = txEvents.slice(lastIdx + 1);
    if (pending.length) {
      let cur = liveProfileRef.current;
      let changed = false;
      for (const ev of pending) {
        lastTxEvRef.current = ev;
        const dec = decodeStationPacket(ev.hex);
        if (!dec) continue; // truncated / undecodable frame — skip it
        const header = { refProfId: dec.refProfId, lastRefRfid: dec.lastRefRfid, distPktStart: dec.distPktStart };
        const hasGeom = hasProfileGeometry(dec);
        if (!cur) {
          // Bootstrap. Normally the first packet carries the geometry. If we
          // joined mid-stream (MA-only packet), fall back to the APD table so
          // something is shown, but leave geomProfId unset so the real wire
          // geometry replaces it as soon as it's transmitted.
          const seed = hasGeom ? dec : (findApdRowByRefTag(apdResult, dec.lastRefRfid) || dec);
          cur = { ...seed, ...header, source: "live", geomProfId: hasGeom ? dec.refProfId : null };
          changed = true;
        } else if (hasGeom && cur.geomProfId == null) {
          // First real wire geometry after an APD-table fallback — use it as-is.
          cur = { ...dec, ...header, source: "live", geomProfId: dec.refProfId };
          changed = true;
        } else if (hasGeom && dec.refProfId !== cur.geomProfId) {
          // New profile transmitted — concatenate at the shared RFID tag.
          cur = { ...appendProfile(cur, dec, header), geomProfId: dec.refProfId };
          changed = true;
        } else if (cur.refProfId !== header.refProfId || cur.lastRefRfid !== header.lastRefRfid
                   || cur.distPktStart !== header.distPktStart) {
          // MA-only tick (or a resend of the profile already shown): keep the
          // geometry untouched, refresh only the header fields.
          cur = { ...cur, ...header };
          changed = true;
        }
      }
      if (changed) {
        liveProfileRef.current = cur;
        setLiveProfile(cur);
      }
    }

    // Every received Onboard→Station (L2S) packet → loco telemetry
    const tliList = layersRef.current?.tli || [];
    setLocos(prev => {
      let changed = false;
      const next = { ...prev };
      recent.forEach((ev, ri) => {
        if (!ev || !ev.hex || !isRxEvent(ev)) return;
        const dec = decodeLocoPacket(ev.hex);
        if (!dec || dec.locoId == null) return;
        const id = dec.locoId;
        // This loco was removed (× on its chip): ignore its packets from
        // before the removal; a genuinely NEW packet brings it back fresh.
        if (locoMarkIdx[id] != null && recentBase + ri <= locoMarkIdx[id]) return;
        const existing = next[id];
        if (colorIdxRef.current[id] == null) colorIdxRef.current[id] = nextColorRef.current++;

        // ── Process every packet exactly once ───────────────────────────
        // `recent` is the last ~60 serial events, re-scanned from scratch on
        // every update — so on a normal (slow-arriving) feed, most of the
        // packets in it were already folded into `existing` on an earlier
        // pass. Reprocessing an OLD packet here used to still update
        // `lastSeen` to `Date.now()` (now, not when that packet actually
        // arrived) and still run it through the position/trail logic below.
        // That's harmless most of the time — except that the very next
        // real-time comparison (the run-gap check further down) measures
        // "time since lastSeen", and reprocessing a genuinely old packet
        // makes that gap look artificially large (it's comparing against
        // *this instant*, not the packet's real arrival time) — occasionally
        // large enough to look like the simulator stopped and restarted,
        // which wipes the trail/brake history even though the loco never
        // actually went quiet. That's what caused the speed line to
        // intermittently erase itself (worse right after the tab was
        // backgrounded, since throttled timers make updates land further
        // apart — but it could happen in a continuously-visible tab too).
        // Fix: each packet is identified by (type, frame, position, speed)
        // and is only ever run through the logic below the first time it's
        // seen; every later re-scan just skips straight past it.
        const procSig = `${dec.pktType}|${dec.frameNum}|${dec.absLoc}|${dec.speed}`;
        const procSeen = existing?.procSeen || [];
        if (procSeen.includes(procSig)) return;
        const nextProcSeen = [...procSeen, procSig].slice(-200);

        // ── Real-world position — direct from ABS_LOCO_LOC ──────────────
        // ABS_LOCO_LOC is already a real absolute chainage (see the
        // calibration note above), so the loco's position no longer needs
        // any tag-anchoring/dead-reckoning at all — that whole mechanism
        // was the source of every earlier instability (bad tag reads
        // swinging the plotted position back and forth). It's simply
        // recentred into this profile's own local 0-based coordinate
        // space by subtracting the calibrated chainageOffset.
        //
        // `anchor` is kept purely for the on-screen "ANCHOR RFID #… @ …m"
        // readout — informational only, it no longer drives the plot.
        const manualOffset = existing?.manualOffset || 0;
        let anchor = existing?.anchor || null;
        if (dec.lastRfid != null) {
          const tag = tliList.find(t => t.tagId === dec.lastRfid);
          if (tag) anchor = {
            tagId: dec.lastRfid, tagDist: tag.cumDist,
            absAtTag: (anchor && anchor.tagId === dec.lastRfid) ? anchor.absAtTag : dec.absLoc,
          };
        }
        // Stored in ABSOLUTE chainage (offset NOT baked in). The conversion to
        // this profile's local 0-based axis happens at render time (locosLocal
        // below), so a late/changed calibration re-bases the whole history
        // instead of leaving stale, wrongly-offset values pinned in state.
        const distAbs = dec.absLoc != null
          ? dec.absLoc + manualOffset
          : (existing?.distAbs ?? null);

        // ── Run-reset detection ──────────────────────────────────────
        // If this loco has gone quiet for a while (the run ended — e.g.
        // the storyboard/session stopped) and then a fresh packet arrives,
        // that new packet starts a NEW run and should be trusted outright,
        // not smoothed against wherever the OLD run happened to leave off.
        // Without this, the monotonic clamp below would permanently pin
        // the icon at the old run's furthest point, since a genuinely
        // lower position from a fresh run looks identical to "backward
        // jitter" otherwise.
        // 8s (~4x a normal TDMA tick) sounds generous, but it only tolerates
        // a perfectly steady feed — any ordinary jitter, a slightly slower
        // tick rate, or a couple of retried/missed packets on the radio link
        // pushes the real gap between two consecutive packets past 8s, and
        // this used to read that as "the simulator stopped and restarted,"
        // wiping the trail and brake history for no real reason (this is
        // the "erases after some time" symptom even with the tab left open
        // the whole time — separate from the tab-hidden case tracked by
        // hiddenAccumRef above, which handles the other symptom, after
        // switching tabs). 45s tolerates that ordinary jitter while still
        // catching an actual restart, which leaves a much longer silence.
        const RUN_GAP_MS = 45000;
        // Real elapsed time since this loco's last packet, minus however much
        // of that gap the tab spent hidden/backgrounded (see hiddenAccumRef
        // above) — so a background-tab pause can no longer masquerade as the
        // simulator having actually stopped and restarted.
        const hiddenNow = hiddenAccumRef.current + (hiddenSinceRef.current != null ? Date.now() - hiddenSinceRef.current : 0);
        const hiddenDuringGap = existing ? hiddenNow - (existing.lastSeenHiddenAccum || 0) : 0;
        const activeElapsed = existing ? (Date.now() - existing.lastSeen) - Math.max(0, hiddenDuringGap) : Infinity;
        const isNewRun = !existing || activeElapsed > RUN_GAP_MS;

        // ── Outlier rejection ─────────────────────────────────────────
        // A single noisy/erroneous ABS_LOCO_LOC packet used to get baked
        // straight into monoDist below — and because the monotonic clamp
        // never lets that value decrease again *within the same run*, one
        // bad reading permanently pinned the icon ahead of where the loco
        // actually is, until enough real forward movement eventually caught
        // up to it (the "stuck, then jumps after a few seconds" symptom,
        // and also why it could render past tags/markers the loco hadn't
        // truly reached yet). Fix: take the MEDIAN of the last 3 raw
        // readings before it ever reaches the clamp. A lone outlier needs a
        // second corroborating sample to actually move the filtered value,
        // so it can no longer contaminate the displayed position by
        // itself — while genuine, sustained movement still comes through
        // essentially immediately (2 of 3 samples agreeing is normal). A
        // new run starts this window fresh too, so a stale sample from the
        // old run can't bias the very first filtered reading of the new one.
        // This only affects the drawn icon/trail; the "Abs Loc" readout
        // always shows the raw, un-filtered, instantaneous value.
        const prevRawHist = isNewRun ? [] : (existing?.rawHistory || []);
        const rawHistory = (distAbs != null ? [...prevRawHist, distAbs] : prevRawHist).slice(-3);
        const filteredDist = rawHistory.length
          ? [...rawHistory].sort((a, b) => a - b)[Math.floor((rawHistory.length - 1) / 2)]
          : distAbs;

        // ── Monotonic display position ──────────────────────────────
        // Exactly one (distance, speed) point should exist per packet,
        // connected in order. Distance only ever advances in the loco's
        // own reported direction *within a run*, so a tiny residual
        // correction can't make the drawn line double back on itself —
        // the true corrected value is still what's shown as Abs Loc, this
        // only affects the line/marker position. A new run (above) resets
        // this baseline outright instead of being clamped against the
        // previous run's position.
        let monoAbs = existing?.monoAbs ?? null;
        if (filteredDist != null) {
          if (monoAbs == null || isNewRun) {
            monoAbs = filteredDist;
          } else if (dec.dir === 2) {
            // TEMPORARILY reverted to the original, unconditional rule —
            // see the note further down asking which way Abs Loc actually
            // moves for a "Reverse (UP)" loco. Making this depend on the
            // line's mirroring (as a previous attempt did) caused the
            // marker to freeze in place instead of just sweeping the wrong
            // way: Math.max()/Math.min() only ever grows toward one extreme,
            // so if the raw readings for "Reverse (UP)" actually trend
            // DOWN (which the freeze suggests), clamping them with max()
            // pins the display at the first/highest value ever seen and it
            // never updates again. This plain, always-updating version is
            // the known-safe baseline while that's confirmed.
            monoAbs = Math.min(monoAbs, filteredDist);
          } else {
            monoAbs = Math.max(monoAbs, filteredDist);
          }
        }

        // Movement trail — always exactly ONE line: a flat history of
        // (distance, speed) samples in chronological order, never split
        // into multiple pieces. Gated by a minimum distance change (3 m)
        // so near-stationary jitter doesn't pack in points that are close
        // in x but far apart in y (the thing that destabilises the
        // Catmull-Rom fit into looking like extra strands). A new run
        // starts a fresh trail rather than dragging in the old run's path.
        const MIN_STEP_M = 0.5;
        const prevTrail = isNewRun ? [] : (existing?.trail || []);
        const lastPt = prevTrail[prevTrail.length - 1];
        let trail = prevTrail;
        if (monoAbs != null) {
          if (!lastPt) {
            trail = [{ d: monoAbs, spd: dec.speed || 0 }];
          } else if (Math.abs(monoAbs - lastPt.d) > MIN_STEP_M || prevTrail.length < 2) {
            trail = [...prevTrail, { d: monoAbs, spd: dec.speed || 0 }].slice(-3000);
          }
        }

        // ── Brake-application events ─────────────────────────────────────
        // One event each time BRAKE_APPLIED changes to a marked brake type
        // (NSB / FSB / EB — see BRAKE_TYPES): 0 → NSB, NSB → FSB, FSB → EB, …
        // Each event freezes the position/speed/time of that exact packet, so
        // the dot stays put on the trail while the loco moves on.
        // The 60-event window is re-scanned on every update, so an event is
        // identified by (loco, FRAME_NUM, brake code, ABS_LOCO_LOC) and added
        // only once. The first pkt-10 in the window has no predecessor, so it
        // can't be judged a transition (unless the loco was never seen before).
        let brakeEvents = isNewRun ? [] : (existing?.brakeEvents || []);
        let brakeSeen = isNewRun ? [] : (existing?.brakeSeen || []);   // signatures of pkt-10s already judged
        let brakePrev = isNewRun ? null : (existing?.brakePrev ?? null); // BRAKE_APPLIED of the last fresh pkt-10
        if (dec.pktType === 10) {
          // Every update re-walks the last 60 serial events, so most packets
          // here were already handled on an earlier pass. Judging them again
          // is what produced stray dots: an OLD braking packet compared
          // against the loco's CURRENT brake state looks like a brand-new
          // brake application, and it was then pinned at the loco's CURRENT
          // position (monoAbs has moved on) with the old packet's speed —
          // i.e. a dot floating off the plotted line, only sometimes (when
          // a braking packet happened to be first in the window). Now a
          // packet is judged exactly once: identified by its signature, and
          // compared with the brake state of the last packet that was
          // judged (kept in the loco state, so it also works when the
          // previous packet has already left the window). Fresh packets are
          // processed in arrival order, so monoAbs is that packet's own
          // position and the dot lands exactly on the trail.
          const sig = `${dec.frameNum}|${dec.absLoc}|${dec.speed}|${dec.brake}`;
          if (!brakeSeen.includes(sig)) {
            const prevB = brakePrev != null ? brakePrev : 0;
            brakeSeen = [...brakeSeen, sig].slice(-200);
            brakePrev = dec.brake;
            if (dec.brake !== prevB && BRAKE_TYPES[dec.brake] && monoAbs != null) {
              const key = `${id}|${dec.frameNum}|${dec.brake}|${dec.absLoc}`;
              if (!brakeEvents.some(b => b.key === key)) {
                const spd = dec.speed || 0;
                brakeEvents = [...brakeEvents, {
                  key, code: dec.brake, absLoc: dec.absLoc, spd,
                  d: monoAbs, t: evTimeMs(ev),
                }].slice(-300);
                // The trail only takes a point when the loco has moved > MIN_STEP_M.
                // If this packet didn't add one (slow / nearly stopped), add this
                // exact (distance, speed) point so the dot always sits ON the line.
                const tp = trail[trail.length - 1];
                if (!tp || tp.d !== monoAbs || tp.spd !== spd) {
                  trail = [...trail, { d: monoAbs, spd }].slice(-3000);
                }
              }
            }
          }
        }

        // Only replay the "ping" flash when something actually changed —
        // avoids re-pinging on every unrelated WS tick (the sliding
        // 60-event window re-processes recent packets each time).
        const dataChanged = !existing
          || existing.absLoc !== dec.absLoc
          || existing.speed !== dec.speed
          || existing.dir !== dec.dir
          || existing.trainLength !== dec.trainLength;
        const flashAt = dataChanged ? Date.now() : (existing?.flashAt ?? null);
        // Moment this loco reported a NEW last-read RFID tag — drives the
        // one-shot "tag passed" burst on that tag in the chart's tag row.
        const rfidFlashAt = (existing && dec.lastRfid != null && existing.lastRfid !== dec.lastRfid)
          ? Date.now() : (existing?.rfidFlashAt ?? null);
        const firstAbs = (isNewRun || existing?.firstAbs == null) ? distAbs : existing.firstAbs;
        // Latest decoded packet of EACH type (10 = C.4.3 Regular, 13 = C.4.6
        // Access Request), kept separately so the bottom strip can show both
        // side by side instead of flipping between them on every packet.
        const pkts = { ...(existing?.pkts || {}), [dec.pktType]: { ...dec, at: Date.now() } };
        next[id] = { ...dec, anchor, firstAbs, manualOffset, distAbs, monoAbs, rawHistory, trail, brakeEvents, brakeSeen, brakePrev, procSeen: nextProcSeen, colorIdx: colorIdxRef.current[id], lastSeen: Date.now(), lastSeenHiddenAccum: hiddenNow, flashAt, rfidFlashAt, pkts };
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [serialLog]);

  /* 🔊 Brake beeps — once for every NEW brake dot (NSB / FSB / EB).
   * Brake events already on the chart when this first runs are only noted,
   * so a remount never replays old beeps; stale events (> 20 s old, e.g.
   * from a replayed log window) stay silent too. Several new dots at once
   * → one alert for the heaviest brake. ⚙ Settings → 🔊 SOUND. */
  const sound = useStore(soundSettingsStore);
  const rootRef = useRef(null);
  const heardBrakesRef = useRef(null);
  useEffect(() => {
    const all = Object.values(locos).flatMap(l => l.brakeEvents || []);
    if (heardBrakesRef.current === null) { heardBrakesRef.current = new Set(all.map(b => b.key)); return; }
    const heard = heardBrakesRef.current;
    const fresh = all.filter(b => !heard.has(b.key));
    if (!fresh.length) return;
    fresh.forEach(b => heard.add(b.key));
    if (heard.size > 2000) heardBrakesRef.current = new Set(all.map(b => b.key));
    const cfg = soundSettingsStore.get();
    if (!alerts) return;
    if (cfg.onlyWhenVisible && (document.hidden || !rootRef.current || rootRef.current.offsetParent === null)) return;
    const recent = fresh.filter(b => !b.t || Date.now() - b.t < 20000);
    if (!recent.length) return;
    playBrakeAlert(Math.max(...recent.map(b => b.code)));
  }, [locos]);

  /* 🚨 SOS buzzer — when a loco's EMERGENCY_STATUS changes to an SOS
   * condition (Unusual stop / SoS / Roll back / Head-on / Rear-end / Parting
   * SoS), including a new loco that first appears in emergency. The state
   * when this first runs is only noted. Several at once → the most severe. */
  const lastEmrgRef = useRef(null);
  useEffect(() => {
    const now = {};
    Object.entries(locos).forEach(([id, lc]) => { now[id] = lc.emergency || 0; });
    const prev = lastEmrgRef.current;
    lastEmrgRef.current = now;
    if (prev === null) return;
    let worst = null;
    Object.entries(now).forEach(([id, e]) => {
      if (!e || e === (prev[id] || 0)) return;
      const c = sosCategory("EMERGENCY_STATUS", e);
      if (c && (!worst || SOS_SOUNDS[c].prio > SOS_SOUNDS[worst].prio)) worst = c;
    });
    if (!worst || !alerts) return;
    if (soundSettingsStore.get().onlyWhenVisible && (document.hidden || !rootRef.current || rootRef.current.offsetParent === null)) return;
    playSosAlert(worst, { source: "track" });
  }, [locos]);

  /* 🗣 Overspeed voice-over — when a loco's BRAKE_APPLIED changes to 1
   * (Overspeed, no brake dot). NSB / FSB / EB are announced with their
   * brake dot above. The state when this first runs is only noted. */
  const lastBrakeStateRef = useRef(null);
  useEffect(() => {
    const now = {};
    Object.entries(locos).forEach(([id, lc]) => { now[id] = lc.brake || 0; });
    const prev = lastBrakeStateRef.current;
    lastBrakeStateRef.current = now;
    if (prev === null) return;
    if (!alerts || !Object.entries(now).some(([id, b]) => b === 1 && (prev[id] || 0) !== 1)) return;
    if (soundSettingsStore.get().onlyWhenVisible && (document.hidden || !rootRef.current || rootRef.current.offsetParent === null)) return;
    playBrakeAlert(1);
  }, [locos]);

  /* Auto-pick a primary loco (most recently active) if none chosen */
  useEffect(() => {
    const ids = Object.keys(locos);
    if (!ids.length) return;
    if (primaryId != null && locos[primaryId]) return;
    const latest = ids.reduce((a,b) => (locos[a].lastSeen > locos[b].lastSeen ? a : b));
    setPrimaryId(Number(latest));
  }, [locos, primaryId]);

  const primary = primaryId != null ? locos[primaryId] : null;

  // 1-second clock, only while locos are shown — drives the "no signal for
  // Ns" state of a loco that has stopped reporting (see LOCO_STALE_MS).
  const [nowTick, setNowTick] = useState(() => Date.now());
  const hasLocos = Object.keys(locos).length > 0;
  useEffect(() => {
    if (!hasLocos) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasLocos]);
  const silentFor = l => Math.max(0, Math.round((nowTick - (l.lastSeen || nowTick)) / 1000));

  // Chart-local view of the locos (same field names TrackChart already reads:
  // monoDist / distFromOrigin / trail[].d). Recomputed whenever the calibration
  // offset changes, and withheld entirely until a calibration exists — an
  // uncalibrated absolute chainage (e.g. 137178 m) must never reach the chart,
  // or it stretches the x-domain and squashes the real profile into a sliver.
  const locosLocal = useMemo(() => {
    if (!calibrated) return {};
    const out = {};
    for (const [id, l] of Object.entries(locos)) {
      out[id] = {
        ...l,
        monoDist: l.monoAbs != null ? absDir * (l.monoAbs - chainageOffset) : null,
        distFromOrigin: l.distAbs != null ? absDir * (l.distAbs - chainageOffset) : null,
        trail: (l.trail || []).map(p => ({ ...p, d: absDir * (p.d - chainageOffset) })),
        brakeEvents: (l.brakeEvents || []).map(b => ({ ...b, d: absDir * (b.d - chainageOffset) })),
        // Seconds since this loco's last packet, once it counts as silent.
        silentSec: (nowTick - (l.lastSeen || nowTick)) >= LOCO_STALE_MS ? silentFor(l) : 0,
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locos, chainageOffset, absDir, calibrated, nowTick]);

  const rezero = useCallback(() => {
    if (primaryId == null) return;
    setLocos(prev => {
      const loco = prev[primaryId];
      if (!loco) return prev;
      const distAbs = loco.absLoc != null ? loco.absLoc : loco.distAbs;
      const delta = (distAbs != null && loco.distAbs != null) ? distAbs - loco.distAbs : 0;
      const monoAbs = loco.monoAbs != null ? loco.monoAbs + delta : distAbs;
      return { ...prev, [primaryId]: { ...loco, manualOffset: 0, distAbs, monoAbs } };
    });
  }, [primaryId]);

  // ⟲ CLEAR — wipe the chart (live profile, every loco, trail, brake dot and
  // card) without reloading the page. Packets already in the serial log are
  // ignored from here on; the next NEW packets rebuild the chart.
  const clearChart = useCallback(() => {
    clearMarkRef.current = lastEvent();
    locoMarkRef.current = {};
    liveProfileRef.current = null;
    lastTxEvRef.current = null;
    colorIdxRef.current = {};
    nextColorRef.current = 0;
    setLiveProfile(null);
    setLocos({});
    setPrimaryId(null);
  }, []);

  // × on a loco chip — remove just that loco (its icon, trail, brake dots,
  // card). If it reports again later it comes back as a fresh run.
  const removeLoco = useCallback((id) => {
    locoMarkRef.current = { ...locoMarkRef.current, [id]: lastEvent() };
    delete colorIdxRef.current[id];
    setLocos(prev => { const next = { ...prev }; delete next[id]; return next; });
    setPrimaryId(p => (p === id ? null : p));
  }, []);

  const setManualOffset = useCallback((val) => {
    if (primaryId == null) return;
    setLocos(prev => {
      const loco = prev[primaryId];
      if (!loco) return prev;
      const distAbs = loco.absLoc != null ? loco.absLoc + val : loco.distAbs;
      const delta = (distAbs != null && loco.distAbs != null) ? distAbs - loco.distAbs : 0;
      const monoAbs = loco.monoAbs != null ? loco.monoAbs + delta : distAbs;
      return { ...prev, [primaryId]: { ...loco, manualOffset: val, distAbs, monoAbs } };
    });
  }, [primaryId]);

  // ── Export the chart as a downloadable report (PNG or SVG) ──────────
  // The chart is plain SVG using the app's var(--...) design-token colors
  // for on-screen theming. Those tokens only resolve inside this page's
  // own CSS context — a standalone file (or a PNG rasterised from one)
  // opened elsewhere has no access to them, so every var(--x) is resolved
  // to its actual computed colour before the file is written out.
  const chartWrapRef = useRef(null);
  const [exportBusy, setExportBusy] = useState(false);

  // NOVA company brand for exported reports — the logo images (frontend/
  // public/) are read once as data: URIs so they can be embedded inside the
  // exported SVG/PNG, which is opened outside the app and can't load /files.
  const brandRef = useRef({ mark: null, text: null, textLight: null });
  useEffect(() => {
    const toDataUri = url => fetch(url)
      .then(r => (r.ok ? r.blob() : Promise.reject()))
      .then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))
      .catch(() => null);
    Promise.all([toDataUri("/nova-mark.png"), toDataUri("/nova-text-dark.png"), toDataUri("/nova-text-light.png")])
      .then(([mark, text, textLight]) => { brandRef.current = { mark, text, textLight }; });
  }, []);

  const buildExportSvg = useCallback(() => {
    // The CHART's own <svg> specifically — not just the first <svg> in the
    // area: the toolbar row above the chart (layer-chip icons) now comes
    // first in the DOM, and a bare querySelector("svg") exported a 12×12
    // chip icon instead of the chart.
    const svgEl = chartWrapRef.current?.querySelector("svg[data-track-chart]");
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const computed = getComputedStyle(svgEl);
    // An opaque background: --bg-base is semi-transparent (rgba) in the app
    // theme, which would come out see-through in a standalone file / PNG.
    // Exported from the light theme → light report; from the dark theme → dark.
    const lightExport = document.documentElement.classList.contains("light");
    const bgRaw = (computed.getPropertyValue("--bg-base") || "").trim();
    const bg = /^rgba?\(/.test(bgRaw) || !bgRaw ? (lightExport ? "#ffffff" : "#0b0b0f") : bgRaw;

    const clone = svgEl.cloneNode(true);
    // Interactive / purely-animated overlays (hover crosshair, moving comets,
    // sonar rings, scanlines) would freeze at a random frame in a static
    // export — drop them so the report shows the clean profile.
    clone.querySelectorAll("[data-no-export]").forEach(n => n.remove());
    // SMIL animations restart from frame 0 in a standalone file — the SSP
    // "reveal" starts at width 0, so a PNG rendered from it could miss the
    // speed line entirely. Strip them; the static attributes are the final state.
    clone.querySelectorAll("animate, animateMotion, animateTransform, set").forEach(n => n.remove());
    clone.removeAttribute("data-track-chart");
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    // ── Branded report footer (NOVA logo + export timestamp) — a strip added
    //    BELOW the chart by extending the viewBox, so nothing on the chart
    //    itself is covered. ──
    const vb = svgEl.viewBox?.baseVal;
    const VW = vb?.width || w, VH = vb?.height || h;
    const FOOT = 30;                                      // footer height, in chart (viewBox) units
    const hOut = Math.round(h * (VH + FOOT) / VH);         // output pixel height incl. footer
    clone.setAttribute("viewBox", `0 0 ${VW} ${VH + FOOT}`);
    {
      const NS = "http://www.w3.org/2000/svg";
      const el = (tag, attrs, text) => {
        const n = document.createElementNS(NS, tag);
        Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v)));
        if (text != null) n.textContent = text;
        return n;
      };
      const g = el("g", { "font-family": "monospace" });
      g.appendChild(el("line", { x1: 12, x2: VW - 12, y1: VH + 2, y2: VH + 2, stroke: lightExport ? "#d8dcea" : "#25423a", "stroke-width": 1 }));
      const { mark, text: textDark, textLight } = brandRef.current;
      const text = lightExport ? (textLight || textDark) : textDark;
      let x = 12;
      if (mark) { g.appendChild(el("image", { href: mark, x, y: VH + 6, width: 20, height: 20 })); x += 25; }
      if (text) { g.appendChild(el("image", { href: text, x, y: VH + 10, width: 41, height: 12 })); x += 48; }
      else { g.appendChild(el("text", { x, y: VH + 20, "font-size": 11, "font-weight": 700, fill: lightExport ? "#1f3654" : "#e8f0f8" }, "NOVA")); x += 40; }
      g.appendChild(el("text", { x, y: VH + 19.5, "font-size": 7.5, fill: lightExport ? "#4b6f86" : "#5f8f9f", "letter-spacing": 0.8 }, "ENGINEERING SAFETY · POWERING INNOVATION"));
      const stamp = new Date().toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      g.appendChild(el("text", { x: VW - 12, y: VH + 19.5, "font-size": 8, fill: lightExport ? "#64748b" : "#7f9a8e", "text-anchor": "end" },
        `PINJ · Live Track Profile · ${stamp}`));
      clone.appendChild(g);
    }

    clone.setAttribute("width", w);
    clone.setAttribute("height", hOut);
    // Replace (not prepend to) the live element's inline style — it carries
    // position/size/cursor for the page layout, and prepending a second
    // style="" attribute made the file invalid XML ("attribute redefined").
    clone.setAttribute("style", `background:${bg}`);

    let svgString = new XMLSerializer().serializeToString(clone);
    // Resolve every var(--token) reference to its current computed value —
    // this is what actually makes the exported file render correctly
    // outside the app (a new browser tab, an emailed image, a printed
    // report, etc.) instead of coming out blank/black where colors were.
    // Also handles var(--x, fallback), and makes the value safe to sit inside
    // an XML attribute: a font stack like "JetBrains Mono",monospace carries
    // double quotes that would otherwise end font-family="…" early and make
    // the whole file invalid XML.
    const xmlSafe = v => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "'");
    svgString = svgString.replace(/var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (match, name, fallback) => {
      const val = computed.getPropertyValue(name).trim() || (fallback || "").trim();
      return val ? xmlSafe(val) : match;
    });
    // Opaque backdrop as the first painted element too — some viewers (and
    // the PNG path's <img> decode) ignore a CSS background on the root <svg>.
    svgString = svgString.replace(/(<svg\b[^>]*>)/, `$1<rect x="0" y="0" width="100%" height="100%" fill="${bg}"/>`);
    return { svgString, w, h: hOut, bg };
  }, []);

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const exportChartAsSvg = useCallback(() => {
    const built = buildExportSvg();
    if (!built) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBlob(new Blob([built.svgString], { type: "image/svg+xml" }), `live-track-profile-${stamp}.svg`);
  }, [buildExportSvg]);

  const exportChartAsPng = useCallback(() => {
    const built = buildExportSvg();
    if (!built) return;
    setExportBusy(true);
    const scale = 2; // export at 2x for a crisp, printable image
    const svgBlob = new Blob([built.svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = built.w * scale;
      canvas.height = built.h * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);
      ctx.fillStyle = built.bg;
      ctx.fillRect(0, 0, built.w, built.h);
      ctx.drawImage(img, 0, 0, built.w, built.h);
      URL.revokeObjectURL(url);
      canvas.toBlob(pngBlob => {
        setExportBusy(false);
        if (!pngBlob) return;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        downloadBlob(pngBlob, `live-track-profile-${stamp}.png`);
      }, "image/png");
    };
    img.onerror = () => { setExportBusy(false); URL.revokeObjectURL(url); };
    img.src = url;
  }, [buildExportSvg]);

  const c = { text: "var(--cyan)", border: "var(--cyan-dim)" };

  return (
    <div ref={rootRef} style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{CINE_CSS}</style>
      {/* ── Toolbar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <span className="cine-title" style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: c.text, letterSpacing: "0.08em" }}>🚆 LIVE TRACK PROFILE</span>

        <div style={{ display: liveOnly ? "none" : "flex", gap: 2, padding: 2, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-raised)" }}>
          <button onClick={() => setSource("live")} style={{ padding: "3px 9px", borderRadius: 3, fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: 700, border: "none", cursor: "pointer", background: source==="live" ? "rgba(34,211,238,0.15)" : "transparent", color: source==="live" ? c.text : "var(--text-dim)" }}>● LIVE MA (ON WIRE)</button>
          <button onClick={() => setSource("apd")} style={{ padding: "3px 9px", borderRadius: 3, fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: 700, border: "none", cursor: "pointer", background: source==="apd" ? "rgba(245,166,35,0.15)" : "transparent", color: source==="apd" ? "var(--amber)" : "var(--text-dim)" }}>▤ APD TABLE ROW</button>
        </div>

        {source === "apd" && (
          apdRows.length ? (
            <select value={selectedSno ?? ""} onChange={e => setSelectedSno(e.target.value)}
              style={{ fontFamily: "var(--font-mono)", fontSize: 9, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)" }}>
              {apdRows.map(sno => <option key={sno} value={sno}>S.No {sno}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>No APD workbook loaded — use "Load APD" in the sidebar</span>
          )
        )}

        {source === "live" && (
          <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
            {liveProfile ? `Profile #${liveProfile.refProfId} · Ref RFID #${liveProfile.lastRefRfid}` : "No Station→Loco (C.4.2) TX observed yet"}
          </span>
        )}

        {/* Loco chips — click to make primary · × to remove that loco ·
            a loco that stopped reporting shows "no signal Ns" and fades. */}
        <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexWrap: "wrap", alignItems: "center" }}>
          {Object.values(locos).map(loco => {
            const lc = loco.emergency > 0 ? "var(--ltp-red)" : LOCO_COLORS[(loco.colorIdx ?? 0) % LOCO_COLORS.length];
            const silent = nowTick - (loco.lastSeen || nowTick) >= LOCO_STALE_MS;
            const isPri = loco.locoId === primaryId;
            return (
              <span key={loco.locoId} style={{
                display: "inline-flex", alignItems: "center", borderRadius: 10, overflow: "hidden",
                border: `1px solid ${isPri ? lc : "var(--border)"}`, background: "var(--bg-raised)",
                opacity: silent ? 0.6 : 1, transition: "opacity 0.6s",
              }}>
                <button onClick={() => setPrimaryId(loco.locoId)} title="Show this loco's telemetry below"
                  style={{
                    fontFamily: "var(--font-mono)", fontSize: 8, padding: "3px 4px 3px 8px", border: "none", cursor: "pointer",
                    background: "transparent", color: loco.emergency > 0 ? "var(--ltp-red)" : "var(--text-secondary)",
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: lc, boxShadow: silent ? "none" : `0 0 5px ${lc}` }}/>
                  {loco.emergency > 0 ? "🚨 " : ""}#{loco.locoId} · {silent ? `no signal ${silentFor(loco)}s` : `${loco.speed ?? "—"}kmph`}
                </button>
                <button onClick={() => removeLoco(loco.locoId)} title={`Remove loco #${loco.locoId} (icon, trail, brake dots, card) from the chart`}
                  style={{ fontFamily: "var(--font-mono)", fontSize: 9, lineHeight: 1, padding: "3px 7px 3px 4px", border: "none",
                    cursor: "pointer", background: "transparent", color: "var(--text-dim)" }}>×</button>
              </span>
            );
          })}
          {!Object.keys(locos).length && (
            <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>Waiting for an Onboard→Station (L2S) packet on serial RX…</span>
          )}
        </div>

        {/* 🔊 brake-beep mute — same switch as ⚙ Settings → 🔊 SOUND */}
        <button onClick={() => { if (sound.enabled) stopAlertSound(); soundSettingsStore.set({ enabled: !sound.enabled }); }}
          title={sound.enabled ? "Brake beeps + SOS buzzer ON — click to mute (⚙ Settings → 🔊 SOUND for volume, delay, …)" : "Alert sounds muted — click to turn on"}
          style={{ padding: "3px 9px", borderRadius: 5, fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: 700, cursor: "pointer",
            border: "1px solid " + (sound.enabled ? "var(--cyan-dim)" : "var(--border)"),
            background: sound.enabled ? "var(--cyan-glow)" : "var(--bg-raised)",
            color: sound.enabled ? "var(--cyan)" : "var(--text-dim)" }}>
          {sound.enabled ? "🔊 BEEP" : "🔇 MUTED"}
        </button>

        {/* Start a fresh chart without reloading the page. (A new TRANSMIT
            also starts fresh automatically.) */}
        <button onClick={clearChart} disabled={!liveProfile && !Object.keys(locos).length}
          title="Clear the live profile, every loco, trail, brake dot and card — the next new packets start a fresh chart. (Starting a new transmission does this automatically.)"
          style={{ padding: "3px 9px", borderRadius: 5, fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: 700,
            border: "1px solid var(--border)", background: "var(--bg-raised)",
            cursor: (!liveProfile && !Object.keys(locos).length) ? "default" : "pointer",
            color: (!liveProfile && !Object.keys(locos).length) ? "var(--text-dim)" : "var(--text-secondary)" }}>
          ⟲ CLEAR
        </button>

        {/* Export the current chart as a report */}
        <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-raised)" }}>
          <button onClick={exportChartAsPng} disabled={exportBusy} title="Download a PNG image of the chart exactly as shown"
            style={{ padding: "3px 9px", borderRadius: 3, fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: 700, border: "none", cursor: exportBusy ? "default" : "pointer", background: "transparent", color: exportBusy ? "var(--text-dim)" : "var(--text-secondary)" }}>
            {exportBusy ? "⏳ …" : "⬇ PNG"}
          </button>
          <button onClick={exportChartAsSvg} title="Download a vector SVG of the chart (scales without quality loss)"
            style={{ padding: "3px 9px", borderRadius: 3, fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: 700, border: "none", cursor: "pointer", background: "transparent", color: "var(--text-secondary)" }}>
            ⬇ SVG
          </button>
        </div>
      </div>

      {activeLayers && calib.mode !== "table" && calib.mode !== "ref" && (() => {
        const n = tagLocationMap ? Object.keys(tagLocationMap).length : 0;
        const prof = (activeLayers.tli || []).slice(0, 6).map(t => t.tagId).join(", ");
        const sample = tagLocationMap ? Object.keys(tagLocationMap).slice(0, 6).join(", ") : "";
        return (
          <div style={{ padding: "3px 12px", fontSize: 9, fontFamily: "var(--font-mono)", color: "#f59e0b" }}>
            ⚠ Absolute locations unavailable — {!tagLocationMap
              ? "this tab received no RFID Tag Table (rfidTagTable prop is empty/unrecognised). Showing +m from the Ref tag."
              : `RFID Tag Table has ${n} tag(s) [${sample}…] but none match this profile's tags [${prof}…]${activeLayers.refTag ? `, Ref tag ${activeLayers.refTag}` : ""}.`}
          </div>
        );
      })()}
      {!calibrated && Object.keys(locos).length > 0 && (
        <div style={{ padding: "3px 12px", fontSize: 9, fontFamily: "var(--font-mono)", color: "#f59e0b" }}>
          ⚠ Loco hidden — waiting for a valid ABS_LOCO_LOC from the loco.
        </div>
      )}
      {/* ── Chart ── */}
      <div ref={chartWrapRef} style={{ flex: 1, minHeight: 0, padding: "2px 8px 0" }}>
        {activeLayers ? (
          <TrackChart layers={activeLayers} locos={locosLocal} primaryId={primaryId} chainageOffset={chainageOffset} absDir={absDir} tagLocationMap={tagLocationMap} absKnown={calib.mode === "table" || calib.mode === "ref"}/>
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            <span style={{ fontSize: 32 }}>🗺</span>
            <span style={{ fontSize: 11 }}>
              {source === "apd" ? "Pick an S.No above once an APD workbook is loaded" : "Waiting for a transmitted C.4.2 packet…"}
            </span>
          </div>
        )}
      </div>

      {/* ── Telemetry strip for the primary loco ── */}
      {(() => {
        // Fields both packet types carry, in the same order in both panels.
        // `w` = fixed relative box width, sized for that field's longest value.
        const common = [
          { label: "Speed",        w: 1,    value: p => p.speed != null ? `${p.speed} kmph` : "—", color: () => "#34d399" },
          { label: "DOM",          w: 1.4,  value: p => DIR_LABEL[p.dir] || "—" },
          { label: "Mode",         w: 1.1,  value: p => MODE_LABEL[p.mode] || `?(${p.mode})` },
          { label: "Emergency",    w: 0.95, value: p => EMRG_LABEL[p.emergency] || "—", color: p => p.emergency > 0 ? "#ef4444" : undefined },
          { label: "Last RFID",    w: 0.8,  value: p => p.lastRfid ?? "—" },
          { label: "Abs Loc",      w: 1.05, value: p => p.absLoc != null ? `${p.absLoc} m` : "—" },
          { label: "Train Len",    w: 0.85, value: p => p.trainLength != null ? `${p.trainLength} m` : "—" },
        ];
        const accessFields = [...common, { label: "Appr Stn ID", w: 0.95, value: p => p.apprStnId ?? "—" }];
        const regularFields = [...common,
          { label: "Brake", w: 1.55, value: p => BRAKE_LABEL[p.brake] || "—", color: p => p.brake > 0 ? "#f59e0b" : undefined },
          { label: "Ref Profile#", w: 0.9, value: p => p.lastRefProfile ?? "—",
            color: p => source === "live" && liveProfile && liveProfile.refProfId === p.lastRefProfile ? "#34d399" : undefined },
        ];
        const sumW = fs => fs.reduce((s, f) => s + (f.w || 1), 0);
        const pk = primary?.pkts || {};
        return (
      <div style={{ display: "grid",
        // Panels sized by their total box weight, so a box is the same width in both.
        gridTemplateColumns: primary ? `minmax(0,${sumW(accessFields)}fr) minmax(0,${sumW(regularFields)}fr) auto` : "1fr",
        gap: 8, padding: "6px 12px 8px", borderTop: "1px solid var(--border)", alignItems: "stretch" }}>
        {primary ? (
          <>
            <PacketPanel title="ACCESS REQUEST" spec="C.4.6 · PKT 13" accent="#a78bfa" pkt={pk[13]} fields={accessFields}/>
            <PacketPanel title="LOCO → STATION REGULAR" spec="C.4.3 · PKT 10" accent="#22d3ee" pkt={pk[10]} fields={regularFields}/>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: 5, minWidth: 0 }}>
              <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-dim)", textAlign: "right", maxWidth: 230 }}>
                {primary.anchor
                  ? `LAST RFID #${primary.anchor.tagId} @ ${Math.round(chainageOffset + absDir * primary.anchor.tagDist)}m real${chainageOffset ? "" : " (load RFID Tag Table to calibrate)"}`
                  : "NO RFID TAG MATCHED YET"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>OFFSET</span>
                <input type="number" value={primary.manualOffset || 0} onChange={e => setManualOffset(Number(e.target.value)||0)}
                  style={{ width: 64, fontFamily: "var(--font-mono)", fontSize: 9, padding: "2px 5px", borderRadius: 3, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)" }}/>
                <button onClick={rezero} style={{ fontFamily: "var(--font-mono)", fontSize: 8, padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-raised)", color: "var(--text-secondary)", cursor: "pointer" }}>⟲ RESET OFFSET</button>
              </div>
            </div>
          </>
        ) : (
          <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>No loco telemetry yet.</span>
        )}
      </div>
        );
      })()}
    </div>
  );
}