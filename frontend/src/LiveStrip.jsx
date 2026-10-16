/**
 * LiveStrip.jsx — 📡 LIVE page "LIVE VISUALISER": the track drawn at real chainage with
 * every RFID tag from the tag table loaded in 🧩 SVK SIM (☰ LOADERS → RFID TAG TABLE),
 * and each loco moving on it from its ABS_LOCO_LOC (C.4.3 / C.4.6).
 * Only the tags under test are drawn: the ones the station sends in its C.4.2 packets
 * (LAST_REF_RFID + tag-linking list). Their km comes from the SVK SIM tag table when it
 * is loaded; otherwise it is derived from the C.4.2 distances, anchored where the loco
 * reported reading the reference tag.
 * From the latest C.4.2 addressed to the followed loco it also places the approaching
 * signal (LAST_REF_RFID location + APPR_SIG_DIST), the End of Authority
 * (+ MA_W_R_T_SIG) and the MA band — all from radio packets, no StoryBoard.
 * The followed loco uses the DMI engine (buildDmi): glitch-filtered position and the
 * tags fixed on the route, so a replay always draws the same.
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { tagTableStore, appSettingsStore, useStore } from "./SettingsAbout";
import { buildDmi, useSmoothValues } from "./DmiPanel";

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
const tMs = p => (p?.received_at ? p.received_at * 1000 : 0);
const ASPECT = { 1: ["#ef4444", "Red"], 2: ["#eab308", "Yellow"], 10: ["#eab308", "Double Yellow"], 11: ["#22c55e", "Green"],
  14: ["#ef4444", "AG Marker OFF"], 15: ["#ef4444", "Red + Calling-On"], 48: ["#ef4444", "Stop Board"] };
/* CUR_SIG_ASPECT → lamps top→bottom (YLW, GRN, YLW, RED) — same as the DMI */
const LAMPS = { 1: [0, 0, 0, 1], 2: [0, 0, 1, 0], 3: [0, 0, 1, 0], 4: [0, 0, 1, 0], 5: [0, 0, 1, 0], 6: [0, 0, 1, 0], 7: [0, 0, 1, 0], 8: [0, 0, 1, 0], 9: [0, 0, 1, 0], 10: [1, 0, 1, 0], 11: [0, 1, 0, 0], 14: [0, 0, 0, 1], 15: [0, 0, 0, 1], 48: [0, 0, 0, 1] };
const LOCO_COLORS = ["#06b6d4", "#a855f7", "#f97316", "#84cc16", "#ec4899", "#eab308"];
const km = m => (m / 1000).toFixed(3);

export default function LiveStrip({ packets }) {
  const { tags, fileName } = useStore(tagTableStore);
  const { liveStripOpen: open, liveStripLabels: showLabels, dmiSmooth } = useStore(appSettingsStore);   // ⚙ Settings → LIVE
  const setOpen = f => appSettingsStore.set(s => ({ liveStripOpen: typeof f === "function" ? f(s.liveStripOpen) : f }));
  const [focus, setFocus] = useState("auto");
  const wrap = useRef(null);
  const [W, setW] = useState(1200);
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(e => setW(Math.max(300, Math.round(e[0].contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [open]);

  const tableLoc = useMemo(() => Object.fromEntries((tags || []).filter(t => Number.isFinite(t.loc)).map(t => [t.id, t.loc])), [tags]);

  /* latest state of every loco + the latest C.4.2 addressed to it */
  const { locos, stnFor, sortedTags, s2lCount, derived, pending } = useMemo(() => {
    const L = new Map(), S = new Map(), lastBrake = new Map(), seenAt = new Map(), s2l = [];
    let bcast = null;
    for (const p of packets) {
      const t = Number(p.packet_type_value), m = fieldMap(p);
      if ((t === 10 || t === 13) && m.SOURCE_LOCO_ID > 0) {
        if (t === 10) lastBrake.set(m.SOURCE_LOCO_ID, m.Brake_Applied || 0);
        const abs = p._absF !== undefined ? p._absF : m.ABS_LOCO_LOC != null && m.ABS_LOCO_LOC !== 8388607 ? m.ABS_LOCO_LOC : null;
        const prev = L.get(m.SOURCE_LOCO_ID);
        if (m.LAST_RFID_TAG > 0 && abs != null && !seenAt.has(m.LAST_RFID_TAG)) seenAt.set(m.LAST_RFID_TAG, abs);
        L.set(m.SOURCE_LOCO_ID, {
          id: m.SOURCE_LOCO_ID, abs: abs ?? prev?.abs ?? null, speed: m.TRAIN_SPEED <= 400 ? m.TRAIN_SPEED : null,
          dir: m.MOVEMENT_DIR, len: m.TRAIN_LENGTH > 0 ? m.TRAIN_LENGTH : prev?.len ?? null, lastTag: m.LAST_RFID_TAG > 0 ? m.LAST_RFID_TAG : prev?.lastTag ?? null, link: m.TAG_LINK_INFO || 0,
          emg: m.EMERGENCY_STATUS || 0, brake: lastBrake.get(m.SOURCE_LOCO_ID) || 0, t: tMs(p),
        });
      } else if (t === 9) {
        const st = { ref: m.LAST_REF_RFID, appr: m.APPR_SIG_DIST, ma: m.REQ_SHORTEN_MA === 1 && m.NEW_MA != null ? m.NEW_MA : m.MA_W_R_T_SIG,
          aspect: m.CUR_SIG_ASPECT, pktDir: m.PKT_DIR };
        if (m.DEST_LOCO_ID === 0) bcast = st; else if (m.DEST_LOCO_ID > 0) S.set(m.DEST_LOCO_ID, st);
        // tag-linking list (distances chain from the profile start = DIST_PKT_START past the ref tag)
        const list = []; let cum = 0;
        for (let i = 1; i <= 62 && `DIST_NXT_RFID[${i}]` in m; i++) { cum += m[`DIST_NXT_RFID[${i}]`] || 0; list.push({ id: m[`NXT_RFID_TAG_ID[${i}]`], cum }); }
        if (m.LAST_REF_RFID > 0 || list.length) s2l.push({ ref: m.LAST_REF_RFID, dps: m.DIST_PKT_START || 0, sgn: m.PKT_DIR === 2 ? -1 : 1, list });
      }
    }
    // tags under test, from every C.4.2 received (later packets refine earlier ones)
    const T = new Map(); let pending = 0;
    for (const s of s2l) {
      const refLoc = tableLoc[s.ref] ?? seenAt.get(s.ref);
      if (s.ref > 0) { if (refLoc != null) T.set(s.ref, refLoc); else pending++; }
      for (const t of s.list) {
        if (!(t.id > 0)) continue;
        const loc = tableLoc[t.id] ?? (refLoc != null ? refLoc + s.sgn * (s.dps + t.cum) : null);
        if (loc != null) T.set(t.id, loc); else pending++;
      }
    }
    const placed = [...T.entries()].map(([id, loc]) => ({ id, loc })).sort((a, b) => a.loc - b.loc);
    const derived = placed.filter(t => tableLoc[t.id] == null).length;          // km not from the tag table
    return { locos: [...L.values()], stnFor: id => S.get(id) || bcast, sortedTags: placed, s2lCount: s2l.length, derived, pending: placed.length ? 0 : pending };
  }, [packets, tableLoc]);
  const colorOf = id => LOCO_COLORS[Math.abs(id) % LOCO_COLORS.length];
  const withPos0 = locos.filter(l => l.abs != null);
  const primaryId = (focus === "auto"
    ? [...withPos0].sort((a, b) => b.t - a.t)[0]
    : withPos0.find(l => l.id === focus) || [...withPos0].sort((a, b) => b.t - a.t)[0])?.id ?? null;
  // followed loco: same engine as the DMI (filtered position, route tags + read status)
  const dp = useMemo(() => (primaryId != null ? buildDmi(packets, primaryId, 0, tableLoc) : null), [packets, primaryId, tableLoc]);
  const withPos = withPos0.map(l => (dp && l.id === primaryId && dp.abs != null ? { ...l, abs: dp.abs } : l));
  const primary = withPos.find(l => l.id === primaryId) || null;
  const routeTags = (dp?.route || []).filter(r => r.loc != null);
  const drawTags = routeTags.length ? [...routeTags].sort((a, b) => a.loc - b.loc) : sortedTags;
  const tagLoc = Object.fromEntries(drawTags.map(t => [t.id, t.loc]));
  const pAbs = useSmoothValues({ a: primary?.abs ?? null }, dmiSmooth === false ? 0 : 800).a;      // glides between packets

  /* view: fixed to the TLI tags received in C.4.2 — it only changes when new tags arrive; locos move across it */
  let lo, hi;
  { const pts = drawTags.length ? drawTags.map(t => t.loc) : withPos.map(l => l.abs);
    if (pts.length) { lo = Math.min(...pts) - 150; hi = Math.max(...pts) + 150; if (hi - lo < 500) { const c = (lo + hi) / 2; lo = c - 250; hi = c + 250; } }
    else { lo = 0; hi = 3000; } }
  const PAD = 28, H = 132, RY = 88;                       // rail centre y
  const x = m => PAD + (m - lo) / (hi - lo) * (W - 2 * PAD);
  const inView = m => m >= lo && m <= hi;

  /* track-side info for the followed loco */
  const st = primary ? stnFor(primary.id) : null;
  const sgn = dp?.sg || (st?.pktDir === 2 || (st?.pktDir !== 1 && primary?.dir === 2) ? -1 : 1);
  const refLoc = st && st.ref != null ? tagLoc[st.ref] : undefined;
  const sigPos = refLoc != null && st.appr != null ? refLoc + sgn * st.appr : null;
  const eoaPos = refLoc != null && st.ma != null && st.ma !== 65535 ? refLoc + sgn * st.ma : null;   // MA is from LAST_REF_RFID
  const lastTagLoc = primary?.lastTag != null ? tagLoc[primary.lastTag] : undefined;
  const nextTag = primary ? (primary.dir === 2
    ? [...drawTags].reverse().find(t => t.loc < primary.abs - 1)
    : drawTags.find(t => t.loc > primary.abs + 1)) : null;

  /* tag labels: skip some when crowded */
  const vis = drawTags.filter(t => inView(t.loc));
  let lastLabelX = -1e9;
  const tagEls = vis.map(t => {
    const tx = x(t.loc);
    const isLast = primary && t.id === primary.lastTag;
    const isNext = nextTag && t.id === nextTag.id;
    const showLabel = isLast || isNext || tx - lastLabelX > 34;
    if (showLabel) lastLabelX = tx;
    const col = isLast ? (primary.link >= 1 && primary.link <= 3 ? "#ef4444" : "#22c55e") : isNext ? "#38bdf8" : "#f59e0b";
    return (
      <g key={t.id + "@" + t.loc}>
        <title>{`RFID #${t.id} · ${km(t.loc)} km`}</title>
        {isLast && <rect x={tx - 8} y={RY - 9} width={16} height={18} rx={3} fill={col} opacity={0.25} />}
        <rect x={tx - 4} y={RY - 5} width={8} height={10} rx={1.5} fill={col} stroke="rgba(0,0,0,.35)" />
        {showLabel && <text x={tx} y={RY + 22} textAnchor="middle" fontSize={10} fontWeight={isLast || isNext ? 800 : 600} fill={col}>{t.id}</text>}
      </g>
    );
  });

  const bar = { display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", fontFamily: "var(--font-mono)", fontSize: 9, flexWrap: "wrap" };
  const chip = on => ({ padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
    border: `1px solid ${on ? "var(--cyan)" : "var(--border)"}`, background: on ? "var(--cyan-glow)" : "transparent", color: on ? "var(--cyan)" : "var(--text-muted)" });

  return (
    <div style={{ flexShrink: 0, borderBottom: "1px solid var(--border)" }}>
      <div style={bar}>
        <button onClick={() => setOpen(o => !o)} style={{ ...chip(false), border: "none" }} title={open ? "Hide the visualiser" : "Show the visualiser"}>{open ? "▾" : "▸"}</button>
        <span style={{ color: "var(--text-secondary)", letterSpacing: ".12em", fontWeight: 700 }}>🚆 LIVE VISUALISER — TRACK · RFID TAGS · LOCO MOVEMENT</span>
        <span style={{ color: drawTags.length ? "var(--green)" : "var(--amber)" }}>
          {drawTags.length
            ? `📍 ${drawTags.length} tags from C.4.2 · km: ${routeTags.length ? (routeTags.every(r => tableLoc[r.id] != null) ? (fileName || "tag table") : routeTags.some(r => tableLoc[r.id] != null) ? `${fileName || "tag table"} + C.4.2 distances` : "C.4.2 distances") : derived === 0 ? (fileName || "tag table") : derived === sortedTags.length ? "derived from C.4.2 distances" : `${fileName || "tag table"} + derived`}`
            : s2lCount ? `📍 ${pending || dp?.route?.length || 0} tags in C.4.2 — waiting for the loco to read the reference tag (or load the tag table in SVK SIM)` : "📍 tags appear with the first Station → Loco (C.4.2) packet"}
        </span>
        {open && <>
          <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>FOLLOW</span>
          <button style={chip(focus === "auto")} onClick={() => setFocus("auto")}>AUTO</button>
          {withPos.map(l => <button key={l.id} style={{ ...chip(focus === l.id), color: focus === l.id ? colorOf(l.id) : "var(--text-muted)" }} onClick={() => setFocus(l.id)}>#{l.id}</button>)}
        </>}
      </div>

      {open && (
        <div ref={wrap} style={{ background: "var(--bg-base)", position: "relative" }}>
          <svg width={W} height={H} style={{ display: "block", fontFamily: "var(--font-mono)" }}>
            {/* MA band (loco → EoA) */}
            {primary && eoaPos != null && (() => {
              const pa = pAbs ?? primary.abs;
              const a = Math.max(lo, Math.min(pa, eoaPos)), b = Math.min(hi, Math.max(pa, eoaPos));
              return b > a ? <rect x={x(a)} y={RY + 9} width={x(b) - x(a)} height={4} fill="#008BCE" opacity={0.85} rx={2} /> : null;
            })()}

            {/* track: sleepers + rails */}
            {Array.from({ length: Math.floor((W - 2 * PAD) / 9) + 1 }, (_, i) => (
              <line key={i} x1={PAD + i * 9} y1={RY - 9} x2={PAD + i * 9} y2={RY + 9} stroke="var(--border-bright)" strokeWidth={2} opacity={0.55} />
            ))}
            <line x1={PAD} y1={RY - 6} x2={W - PAD} y2={RY - 6} stroke="var(--text-muted)" strokeWidth={2} />
            <line x1={PAD} y1={RY + 6} x2={W - PAD} y2={RY + 6} stroke="var(--text-muted)" strokeWidth={2} />

            {/* RFID tags */}
            {tagEls}

            {/* approaching signal + EoA */}
            {sigPos != null && inView(sigPos) && (
              <g transform={`translate(${x(sigPos)},0)`}>
                <title>{`Approaching signal · ${ASPECT[st.aspect]?.[1] || "aspect " + st.aspect} · ${km(sigPos)} km`}</title>
                <line x1={0} y1={RY - 8} x2={0} y2={RY - 12} stroke="var(--text-secondary)" strokeWidth={2} />
                <rect x={-6} y={RY - 46} width={12} height={34} rx={3} fill="#111" stroke="var(--text-secondary)" />
                {[0, 1, 2, 3].map(i => (
                  <circle key={i} cx={0} cy={RY - 41 + i * 8} r={3.2}
                    fill={(LAMPS[st.aspect] || [])[i] ? ["#eab308", "#22c55e", "#eab308", "#ef4444"][i] : "#2a2a2a"} />
                ))}
              </g>
            )}
            {eoaPos != null && inView(eoaPos) && (
              <g transform={`translate(${x(eoaPos)},0)`}>
                <title>{`End of Authority · ${km(eoaPos)} km`}</title>
                <line x1={0} y1={RY - 10} x2={0} y2={RY + 14} stroke="#ef4444" strokeWidth={3} />
                <text x={0} y={RY + 26} textAnchor="middle" fontSize={9} fontWeight={800} fill="#ef4444">EoA</text>
              </g>
            )}

            {/* locos */}
            {withPos.filter(l => inView(l.abs)).map(l => {
              const isP = primary && l.id === primary.id;
              const fwd = isP && dp?.sg ? dp.sg > 0 : l.dir !== 2;            // the front of the train points this way (ABS increasing)
              const edge = l.emg || l.brake === 4 ? "#ef4444" : l.brake >= 2 ? "#fb923c" : "none";
              const lx = isP && pAbs != null ? pAbs : l.abs;
              const pxPerM = (W - 2 * PAD) / (hi - lo);
              const bw = Math.max(70, (l.len || 0) * pxPerM);                 // train body (at least 70 px so it stays visible)
              const bx = fwd ? -bw : 0;                                       // ABS = front (yellow cab), body behind it
              const flip = x(lx) + bx + 120 > W;                              // keep the labels inside the strip
              const brk = l.brake >= 2 ? (l.brake === 4 ? " · EB" : l.brake === 3 ? " · FSB" : " · NSB") : "";
              const lines = [`Loco Id : ${l.id}`, `Length : ${l.len ?? "–"}`, `Speed : ${l.speed ?? "–"}${brk}`, `Rfid : ${l.lastTag ?? "–"}`, `Abs.Loc : ${Math.round(l.abs)}`];
              return (
                <g key={l.id} style={{ transform: `translate(${x(lx)}px,0px)`, transition: isP ? "none" : "transform 0.9s linear" }}>
                  <title>{`Loco #${l.id} · ${km(l.abs)} km · ${l.speed ?? "–"} km/h`}</title>
                  <rect x={bx} y={RY - 7} width={bw} height={14} fill="#1597D5" stroke={edge} strokeWidth={edge === "none" ? 0 : 2} opacity={isP ? 1 : 0.85} />
                  {Array.from({ length: Math.floor(bw / 5) }, (_, i) => (
                    <line key={i} x1={bx + 3 + i * 5} y1={RY - 5} x2={bx + 3 + i * 5} y2={RY + 5} stroke="#0E7DB4" strokeWidth={1} />
                  ))}
                  <rect x={fwd ? -5 : 0} y={RY - 7} width={5} height={14} fill="#E3D400" />
                  {showLabels !== false && <text textAnchor={flip ? "end" : "start"} fontSize={11.5} fontWeight={700} fill="#E8A33A" fontFamily="'Times New Roman', Times, serif">
                    {lines.map((t, i) => <tspan key={i} x={flip ? bx + bw : bx} y={RY - 12 - (lines.length - 1 - i) * 12}>{t}</tspan>)}
                  </text>}
                </g>
              );
            })}

            {/* status line */}
            <text x={PAD} y={H - 8} fontSize={10} fill="var(--text-secondary)">
              {primary
                ? `Loco #${primary.id} at ${km(primary.abs)} km${primary.lastTag != null ? ` · last tag #${primary.lastTag}${lastTagLoc != null ? ` (${km(lastTagLoc)} km)` : ""}` : ""}${nextTag ? ` · next tag #${nextTag.id} in ${Math.round(Math.abs(nextTag.loc - primary.abs))} m` : ""}${sigPos != null ? ` · signal in ${Math.round(Math.abs(sigPos - primary.abs))} m` : ""}${eoaPos != null ? ` · EoA in ${Math.round(Math.abs(eoaPos - primary.abs))} m` : ""}`
                : "Waiting for C.4.3 / C.4.6 loco packets…"}
            </text>
          </svg>
        </div>
      )}
    </div>
  );
}
