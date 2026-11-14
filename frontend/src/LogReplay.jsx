/**
 * LogReplay.jsx — Packet Simulator "📂 LOG REPLAY" page.
 *
 * Loads a PINJ / SVK SIM serial test log (logs/pinj_test_*.log, older logs/svk_test_*.log) and re-sends its radio
 * packets, in order and with their original timing, to POST /ingest — so the 📡 LIVE
 * page, its DMI and the LIVE VISUALISER can be tested completely and independently
 * of the radio hardware.
 *
 * Everything the DMI needs is inside the logged packets themselves:
 *   TX  C.4.2 Station → Loco  — MA (already patched from the MA table), signal, APD track
 *                               profile (SSP, gradient, …) and the RFID tag-linking list
 *   TX  C.4.4 Access Authority
 *   RX  C.4.3 / C.4.6 Loco → Station — speed, location, mode, tag, brake, emergency
 * Comment lines (# MA updated from tag …, # paused …) are shown but not sent.
 *
 * Also reads the KAVACH onboard "Event Log Viewer" text logs (e.g. 01_Version_7_LKV_*.txt):
 * blocks with "Event Name : Access Request | Loco Regular Packet | Station Regular Packet |
 * Access Authority" and "Data : <hex>". A leading "F1/F2 A5 C3" on Data is the radio
 * start-of-frame (Radio1 / Radio2) — stripped, and the radio is kept for the replay. RFID Data
 * events are shown as notes. These logs time-stamp only every few seconds, so the replay is
 * paced by the packets' own FRAME_NUM (1 frame = 1 s), as on the air.
 *
 * Layout: left — log file, replay speed, packets to send, transport; right — the packet
 * being sent, a timeline of the whole log (click to jump), a filter bar and the log itself.
 * The SHOW filter and search only change what is listed — what is sent follows PACKETS TO SEND.
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { API_BASE } from "./apiBase";
import { appSettingsStore } from "./SettingsAbout";

const INGEST_URL = API_BASE + "/ingest";
const TYPE_BY_NIBBLE = { 9: ["C.4.2", "#06b6d4"], 10: ["C.4.3", "#10b981"], 11: ["C.4.4", "#8b5cf6"], 12: ["C.4.5", "#ef4444"], 13: ["C.4.6", "#f59e0b"] };
const TYPE_NAME = { "C.4.2": "Station → Loco Regular", "C.4.3": "Loco → Station Regular", "C.4.4": "Access Authority", "C.4.5": "Additional Emergency", "C.4.6": "Loco Access Request" };
const TX_COL = "#a855f7", RX_COL = "#ec4899";
const SPEEDS = [[1, "1×", "real time"], [2, "2×", ""], [5, "5×", ""], [10, "10×", ""], [0, "FAST", "100 ms"]];
const BUCKETS = 160;                                        // timeline columns
const CSS = `
@keyframes lrRowFlash { 0% { box-shadow: inset 0 0 0 2px var(--cyan), 0 0 22px rgba(6,182,212,.55); } 100% { box-shadow: inset 0 0 0 1px var(--cyan), 0 0 10px rgba(6,182,212,.25); } }
@keyframes lrCardIn   { 0% { transform: translateY(-3px); } 100% { transform: none; } }
@keyframes lrPulse    { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes lrDash     { to { background-position: 40px 0, 0 40px, -40px 100%, 100% -40px; } }
@keyframes lrSheen    { 0% { transform: translateX(-120%); } 100% { transform: translateX(220%); } }
@keyframes lrSpin     { to { transform: rotate(360deg); } }
.lr-card { flex-shrink: 0; background: var(--surf); border: 1px solid var(--bdr); border-radius: 12px; overflow: hidden; }
.lr-card-h { display: flex; align-items: center; gap: 8px; padding: 9px 13px; border-bottom: 1px solid var(--bdr);
  background: linear-gradient(180deg, var(--raised), var(--surf)); font: 700 9.5px var(--mono); letter-spacing: .12em; color: var(--ts); text-transform: uppercase; }
.lr-card-h .lr-ic { width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; font-size: 11px; }
.lr-card-b { padding: 12px 13px; }
.lr-drop { position: relative; border-radius: 10px; padding: 18px 12px; text-align: center; cursor: pointer; font-family: var(--mono);
  background: var(--raised); transition: background .2s, transform .15s; }
.lr-drop:hover { transform: translateY(-1px); }
.lr-drop.idle { background-image: linear-gradient(90deg, var(--bdr2) 50%, transparent 50%), linear-gradient(90deg, var(--bdr2) 50%, transparent 50%),
  linear-gradient(0deg, var(--bdr2) 50%, transparent 50%), linear-gradient(0deg, var(--bdr2) 50%, transparent 50%);
  background-repeat: repeat-x, repeat-x, repeat-y, repeat-y; background-size: 14px 1.5px, 14px 1.5px, 1.5px 14px, 1.5px 14px;
  background-position: 0 0, 0 100%, 0 0, 100% 0; }
.lr-drop.drag { background-color: rgba(6,182,212,.10); animation: lrDash 1s linear infinite; }
.lr-seg { display: flex; gap: 3px; padding: 3px; border-radius: 9px; background: var(--raised); border: 1px solid var(--bdr); }
.lr-seg button { flex: 1; border: 0; border-radius: 7px; padding: 6px 0 5px; cursor: pointer; background: transparent; color: var(--ts);
  font-family: var(--mono); transition: background .15s, color .15s, box-shadow .15s; line-height: 1.15; }
.lr-seg button:hover { color: var(--tp); background: var(--hover); }
.lr-seg button.on { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; box-shadow: 0 2px 10px rgba(245,158,11,.35); }
.lr-sw { display: flex; align-items: center; gap: 10px; padding: 7px 0; cursor: pointer; font: 10px var(--mono); color: var(--ts); user-select: none; }
.lr-sw .t { position: relative; width: 30px; height: 17px; border-radius: 9px; background: var(--trk); border: 1px solid var(--bdr2); flex-shrink: 0; transition: background .2s; }
.lr-sw .t::after { content: ""; position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%; background: var(--tm); transition: transform .2s, background .2s; }
.lr-sw.on .t { background: rgba(16,185,129,.25); border-color: var(--green); }
.lr-sw.on .t::after { transform: translateX(13px); background: var(--green); }
.lr-dir { flex: 1; text-align: left; border-radius: 10px; padding: 9px 10px; cursor: pointer; font-family: var(--mono); background: var(--raised);
  border: 1.5px solid var(--bdr); transition: all .15s; }
.lr-dir:hover { transform: translateY(-1px); }
.lr-big { position: relative; overflow: hidden; border: 0; border-radius: 10px; color: #fff; font: 800 11.5px var(--mono); letter-spacing: .08em; padding: 13px 0; cursor: pointer; transition: transform .12s, box-shadow .2s, opacity .2s; }
.lr-big:not(:disabled):hover { transform: translateY(-1px); }
.lr-big:disabled { opacity: .4; cursor: default; }
.lr-big.glow::after { content: ""; position: absolute; inset: 0; width: 40%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.28), transparent); animation: lrSheen 2.2s ease-in-out infinite; }
.lr-tile { flex: 1; border-radius: 9px; padding: 8px 10px; background: var(--raised); border: 1px solid var(--bdr); }
.lr-tile .l { font: 700 8px var(--mono); letter-spacing: .1em; color: var(--tm); text-transform: uppercase; }
.lr-tile .v { font: 700 18px var(--mono); line-height: 1.15; margin-top: 2px; }
.lr-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font: 700 9px var(--mono); letter-spacing: .04em;
  border: 1px solid var(--bdr); background: var(--raised); color: var(--ts); cursor: pointer; transition: all .14s; white-space: nowrap; }
.lr-chip:hover { color: var(--tp); border-color: var(--bdr2); }
.lr-chip.on { color: #fff; }
.lr-row { display: grid; grid-template-columns: 64px 92px 40px 64px 60px 1fr; gap: 8px; align-items: center; cursor: pointer;
  font-family: var(--mono); position: relative; border-bottom: 1px solid rgba(127,127,127,.10); transition: background .12s; }
.lr-row:hover { background: rgba(127,127,127,.09) !important; }
.lr-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-weight: 700; font-size: 9px; letter-spacing: .03em; text-align: center; }
.lr-tl { position: relative; height: 54px; display: flex; align-items: flex-end; gap: 1px; padding: 0 2px; cursor: pointer; }
.lr-tl > i { flex: 1; border-radius: 1.5px 1.5px 0 0; min-height: 2px; transition: opacity .15s; }
.lr-tl:hover > i { opacity: .7; }
.lr-tl > i:hover { opacity: 1 !important; }
.lr-ma { flex-shrink: 0; padding: 1px 7px; border-radius: 4px; font-weight: 800; font-size: 8.5px; letter-spacing: .06em; font-style: normal;
  color: var(--amber); background: rgba(245,158,11,.10); border: 1px solid rgba(245,158,11,.35); }
.lr-ma.new { color: #fff; background: linear-gradient(135deg, #f59e0b, #d97706); border-color: #f59e0b; box-shadow: 0 0 10px rgba(245,158,11,.35); }
.lr-kv { flex-shrink: 0; padding: 1px 6px; border-radius: 4px; font-size: 8.5px; color: var(--tp); background: var(--raised); border: 1px solid var(--bdr); font-style: normal; }
.lr-kv i { font-style: normal; color: var(--tm); margin-right: 4px; }
.lr-kbd { display: inline-block; min-width: 16px; padding: 0 4px; border-radius: 4px; text-align: center; font: 700 8.5px var(--mono); color: var(--ts);
  background: var(--raised); border: 1px solid var(--bdr2); box-shadow: 0 1px 0 var(--bdr2); }
.lr-hx > span { margin-right: 9px; }
.lr-row .lr-go { position: absolute; right: 10px; opacity: 0; font-size: 8.5px; font-weight: 700; color: var(--cyan); background: var(--surf); padding: 1px 6px; border-radius: 4px; border: 1px solid var(--cyan); transition: opacity .12s; }
.lr-row:hover .lr-go { opacity: 1; }
.lr-trail { display: flex; gap: 3px; align-items: flex-end; }
.lr-trail > i { width: 8px; border-radius: 2px; transition: height .2s, opacity .2s; }
@media (prefers-reduced-motion: reduce) { .lr-big.glow::after, .lr-drop.drag { animation: none; } }
`;

/* one log line → { kind:"pkt", n, t (ms of day), dir, frame, slot, type, len, hex } | { kind:"note", text } */
/* FRAME_NUM (17 bits) follows PKT_TYPE (4) + PKT_LENGTH — 10 bits in C.4.2 (type 9), 7 bits in the others */
function frameOf(hex) {
  const v = parseInt(String(hex).slice(0, 8), 16);
  if (!Number.isFinite(v) || hex.length < 8) return null;
  const lenBits = parseInt(hex[0], 16) === 9 ? 10 : 7;
  return Math.floor(v / 2 ** (32 - 4 - lenBits - 17)) % 131072;
}

/* KAVACH onboard "Event Log Viewer" text log → same rows as parseLog() */
function parseEventLog(text) {
  const rows = [];
  const header = { title: "KAVACH Event Log Viewer log" };
  let pend = {}, n = 0, tPrev = null, tsPrev = null, fMax = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/Connected to (.+)$/i))) { header.port = "Connected to " + m[1].trim(); continue; }
    if (/^-{3,}[^-].*[^-]-{3,}$/.test(line)) { pend.title = line.replace(/^-+|-+$/g, "").trim(); continue; }   // ------ Access Request ------
    if (/^-+$/.test(line)) continue;
    // the viewer warns "Packet truncated" on every C.4.2 (it misreads the 10-bit PKT_LENGTH) — those packets
    // decode with a good CRC, so the warning is not shown; a really damaged packet still fails CRC in 📡 LIVE
    if (/^WARNING/i.test(line)) continue;
    if ((m = line.match(/^Timestamp\s*:\s*(?:\S+\s+)?(\d{1,2}):(\d\d):(\d\d)(?:\.(\d+))?/))) {
      pend.ts = ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + (m[4] ? Math.round(+("0." + m[4]) * 1000) : 0);
      pend.time = `${m[1].padStart(2, "0")}:${m[2]}:${m[3]}.${(m[4] || "0").padEnd(3, "0").slice(0, 3)}`;
      continue;
    }
    if ((m = line.match(/^Event Name\s*:\s*(.+)$/))) { pend.name = m[1].trim(); continue; }
    if ((m = line.match(/^Data\s*:\s*(.*)$/))) {
      let toks = m[1].trim().split(/\s+/).filter(t => /^[0-9A-Fa-f]{2}$/.test(t)).map(t => t.toUpperCase());
      let radio = "0xF1";
      if (toks.length > 3 && /^F[12]$/.test(toks[0]) && toks[1] === "A5" && toks[2] === "C3") { radio = "0x" + toks[0]; toks = toks.slice(3); }
      const name = pend.name || pend.title || "";
      if (/RFID/i.test(name) || toks.length < 4) {                 // not a radio packet (RFID reader data …)
        if (name) rows.push({ kind: "note", text: `${name}: ${toks.join(" ")}` });
        pend = {}; continue;
      }
      const hex = toks.join("");
      const nib = parseInt(hex[0], 16);
      const frame = frameOf(hex);
      // timing: advance by FRAME_NUM (1 frame = 1 s); fall back to the coarse Timestamp
      let t;
      if (tPrev == null) t = pend.ts ?? 0;
      else {
        let dt = null;
        if (frame != null && fMax != null) {
          const dF = (frame - fMax + 131072) % 131072;
          if (dF <= 300) dt = dF * 1000;                            // ahead (or same frame)
          else if (131072 - dF <= 300) dt = 0;                      // a little behind the newest frame
        }
        if (dt == null) dt = pend.ts != null && tsPrev != null ? Math.max(0, (pend.ts - tsPrev + 86400000) % 86400000) : 0;
        t = tPrev + dt;
      }
      if (frame != null && (fMax == null || ((frame - fMax + 131072) % 131072) <= 300)) fMax = frame;
      tPrev = t; if (pend.ts != null) tsPrev = pend.ts;
      rows.push({ kind: "pkt", n: ++n, t, time: pend.time || "—", dir: [9, 11, 12].includes(nib) ? "TX" : "RX",
        frame: frame != null ? String(frame) : "--", slot: "", type: TYPE_BY_NIBBLE[nib]?.[0] || "?", color: TYPE_BY_NIBBLE[nib]?.[1] || "#888",
        crcOk: true, hex, radio, event: name, desc: pend.desc || null });
      pend = {};
      continue;
    }
    if (pend.title && !pend.desc && /\w\s*:/.test(line) && !/^Event (ID|Count)\s*:/.test(line)) pend.desc = line;   // decoded summary line
  }
  return { rows, header };
}

export function parseLog(text) {
  if (/^Event Name\s*:/m.test(text) && /^Data\s*:/m.test(text)) return parseEventLog(text);
  const rows = [];
  let header = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^#(\d+)\s+(\d\d):(\d\d):(\d\d)(?:\.(\d+))?\s+(TX|RX)\s+(.*)$/);
    if (m) {
      const toks = m[7].split(/\s+/);
      const hexToks = [];
      for (let i = toks.length - 1; i >= 0 && /^[0-9A-Fa-f]{2}$/.test(toks[i]); i--) hexToks.unshift(toks[i]);
      if (hexToks.length < 4) continue;
      const ms = ((+m[2] * 60 + +m[3]) * 60 + +m[4]) * 1000 + (m[5] ? Math.round(+("0." + m[5]) * 1000) : 0);
      const hex = hexToks.join("").toUpperCase();
      const nib = parseInt(hex[0], 16);
      rows.push({ kind: "pkt", n: +m[1], t: ms, time: `${m[2]}:${m[3]}:${m[4]}.${(m[5] || "0").padEnd(3, "0").slice(0, 3)}`,
        dir: m[6], frame: toks[0], slot: toks[1], type: TYPE_BY_NIBBLE[nib]?.[0] || "?", color: TYPE_BY_NIBBLE[nib]?.[1] || "#888",
        crcOk: !/FAIL|✗/.test(m[7]), hex });
    } else if (line.startsWith("#")) {
      const note = line.replace(/^#\s*/, "");
      if (/^DecodeX .*log/i.test(note)) header.title = note;
      else if (/^port=/.test(note)) header.port = note;
      else if (/^#\s*#?\s*TIME\b/.test(line) || /^#\s+TIME/.test(note)) { /* column header */ }
      else rows.push({ kind: "note", text: note });
    }
  }
  return { rows, header };
}

const fmtDur = ms => {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
const hexGroups = hex => { const b = hex.match(/.{1,2}/g), out = []; for (let i = 0; i < b.length; i += 4) out.push(b.slice(i, i + 4).join(" ")); return out; };
const fmtClock = ms => { const s = Math.floor(((ms % 86400000) + 86400000) % 86400000 / 1000);
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const noteColor = text => /^MA updated/.test(text) ? "var(--amber)" : /^(REF_PROF_ID|LAST_REF_PROFILE)/.test(text) ? "var(--cyan)" : /stopped|done|error/i.test(text) ? "var(--red)" : "var(--tm)";

/* "MA updated from tag 498: a=1, b=2, …" → { tag, kv:[[a,1],…] } (field names exactly as logged); other notes → null */
function parseMaNote(text) {
  const m = /^MA updated from tag (\S+):\s*(.*)$/.exec(text);
  if (!m) return null;
  return { tag: m[1], kv: m[2].split(/,\s*/).map(p => p.split("=")).filter(p => p.length === 2 && p[0] !== "last_rfid_tag").map(([k, v]) => [k.trim(), v.trim()]) };
}
function NoteLine({ text, fresh }) {
  const ma = parseMaNote(text);
  if (!ma) return <span style={{ fontStyle: "italic", color: noteColor(text), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}># {text}</span>;
  return (
    <span title={text} style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, overflow: "hidden", opacity: fresh ? 1 : 0.5 }}>
      <span className={`lr-ma${fresh ? " new" : ""}`}>MA ← TAG {ma.tag}{fresh ? "" : " · same"}</span>
      {ma.kv.map(([k, v]) => <span key={k} className="lr-kv"><i>{k}</i>{v}</span>)}
    </span>
  );
}
function Ring({ pct, playing }) {
  const r = 31, c = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: 78, height: 78, flexShrink: 0 }}>
      <svg width="78" height="78" viewBox="0 0 78 78">
        <defs><linearGradient id="lrRingG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#06b6d4" /><stop offset="1" stopColor="#10b981" /></linearGradient></defs>
        <circle cx="39" cy="39" r={r} fill="none" stroke="var(--raised)" strokeWidth="7" />
        <circle cx="39" cy="39" r={r} fill="none" stroke="url(#lrRingG)" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
          transform="rotate(-90 39 39)" style={{ transition: "stroke-dashoffset .35s", filter: playing ? "drop-shadow(0 0 5px rgba(16,185,129,.6))" : "none" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontFamily: "var(--mono)", fontWeight: 800, fontSize: 15, color: "var(--tp)" }}><span style={{ whiteSpace: "nowrap" }}>{pct}<span style={{ fontSize: 9, marginLeft: 1, color: "var(--ts)" }}>%</span></span></div>
    </div>
  );
}
const Kbd = ({ children }) => <span className="lr-kbd">{children}</span>;

function CardHead({ icon, color, title, right }) {
  return (
    <div className="lr-card-h">
      <span className="lr-ic" style={{ background: `${color}22`, color, boxShadow: `inset 0 0 0 1px ${color}55` }}>{icon}</span>
      <span>{title}</span>
      {right && <span style={{ marginLeft: "auto", letterSpacing: ".04em", textTransform: "none", fontWeight: 600 }}>{right}</span>}
    </div>
  );
}

export default function LogReplay({ be }) {
  const [file, setFile] = useState(null);                  // { name, rows, header }
  const [speed, setSpeed] = useState(() => appSettingsStore.get().replaySpeed ?? 1);       // defaults: ⚙ Settings → LIVE
  const [useTx, setUseTx] = useState(true);
  const [useRx, setUseRx] = useState(true);
  const [skipGaps, setSkipGaps] = useState(() => appSettingsStore.get().replaySkipGaps !== false);
  const [loop, setLoop] = useState(() => !!appSettingsStore.get().replayLoop);
  const [state, setState] = useState("idle");              // idle | playing | paused | done
  const [pos, setPos] = useState(0);                        // index into rows (next to send)
  const [stats, setStats] = useState({ sent: 0, ok: 0, err: 0 });
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");
  const [lastSent, setLastSent] = useState(-1);            // row index of the packet sent last (the "reading line")
  const [show, setShow] = useState("all");                 // list filter: all | TX | RX | notes | a packet type
  const [query, setQuery] = useState("");                  // list search (hex / note text / time)
  const [trail, setTrail] = useState([]);                  // row indices of the last packets sent (newest last)
  const timer = useRef(null), posRef = useRef(0), stateRef = useRef("idle"), cfgRef = useRef({});
  const listRef = useRef(null), fileInput = useRef(null);
  cfgRef.current = { speed, useTx, useRx, skipGaps, loop };

  const rows = file?.rows || [];
  const pkts = useMemo(() => rows.filter(r => r.kind === "pkt"), [rows]);
  const summary = useMemo(() => {
    const c = {};
    pkts.forEach(p => { const k = `${p.dir} ${p.type}`; c[k] = (c[k] || 0) + 1; });
    const notes = rows.filter(r => r.kind === "note");
    const dur = pkts.length > 1 ? (pkts[pkts.length - 1].t - pkts[0].t + 86400000) % 86400000 : 0;
    const crcFail = pkts.filter(p => !p.crcOk).length;
    return { c, ma: notes.filter(n => /^MA updated/.test(n.text)).length, notes: notes.length, dur, crcFail };
  }, [rows, pkts]);
  /* MA notes whose values differ from the MA note before — where the MA really changed */
  const maNew = useMemo(() => {
    const s = new Set(); let prev = null;
    rows.forEach((r, i) => { if (r.kind === "note" && /^MA updated/.test(r.text)) { if (r.text !== prev) s.add(i); prev = r.text; } });
    return s;
  }, [rows]);

  const load = useCallback(f => {
    if (!f) return;
    setErr("");
    const rd = new FileReader();
    rd.onload = () => {
      const parsed = parseLog(String(rd.result || ""));
      if (!parsed.rows.some(r => r.kind === "pkt")) { setErr("No packet lines found — expected a PINJ log (#n  HH:MM:SS.mmm  TX|RX … HEX) or a KAVACH Event Log Viewer log (Event Name : … / Data : …)."); return; }
      stop(true);
      setFile({ name: f.name, size: f.size, ...parsed });
      setPos(0); posRef.current = 0; setStats({ sent: 0, ok: 0, err: 0 }); setLastSent(-1); setTrail([]);
    };
    rd.readAsText(f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async row => {
    try {
      const r = await fetch(INGEST_URL, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packets: [{ activeRadio: row.radio || "0xF1", messagePayload: row.hex }], source: row.dir === "TX" ? "log-tx" : "log-rx", source_id: file?.name || "log" }) });
      if (!r.ok) throw new Error(r.status);
      setStats(s => ({ ...s, sent: s.sent + 1, ok: s.ok + 1 }));
    } catch (_) {
      setStats(s => ({ ...s, sent: s.sent + 1, err: s.err + 1 }));
    }
  }, [file]);

  const wanted = r => r.kind === "pkt" && ((r.dir === "TX" && cfgRef.current.useTx) || (r.dir === "RX" && cfgRef.current.useRx));

  /* send the next wanted packet at index ≥ i; returns the index after it, or -1 at the end */
  const sendNext = useCallback(async i => {
    let j = i;
    while (j < rows.length && !wanted(rows[j])) j++;
    if (j >= rows.length) return -1;
    setLastSent(j);
    setTrail(t => [...t.slice(-23), j]);
    await send(rows[j]);
    return j + 1;
  }, [rows, send]); // eslint-disable-line react-hooks/exhaustive-deps

  const delayAfter = i => {                                 // gap from the packet before i to the next wanted one
    let a = i - 1; while (a >= 0 && rows[a].kind !== "pkt") a--;
    let b = i; while (b < rows.length && !wanted(rows[b])) b++;
    if (a < 0 || b >= rows.length) return 0;
    let gap = (rows[b].t - rows[a].t + 86400000) % 86400000;
    const { speed: sp, skipGaps: sk } = cfgRef.current;
    if (sk) gap = Math.min(gap, 3000);
    return sp === 0 ? 100 : gap / sp;
  };

  const tick = useCallback(async () => {
    if (stateRef.current !== "playing") return;
    const nx = await sendNext(posRef.current);
    if (stateRef.current !== "playing") return;
    if (nx === -1) {
      if (cfgRef.current.loop) { posRef.current = 0; setPos(0); timer.current = setTimeout(tick, 500); return; }
      stateRef.current = "done"; setState("done"); return;
    }
    posRef.current = nx; setPos(nx);
    timer.current = setTimeout(tick, delayAfter(nx));
  }, [sendNext]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = () => { if (!file) return; if (state === "done") { posRef.current = 0; setPos(0); }
    stateRef.current = "playing"; setState("playing"); clearTimeout(timer.current); tick(); };
  const pause = () => { stateRef.current = "paused"; setState("paused"); clearTimeout(timer.current); };
  function stop(silent) { clearTimeout(timer.current); stateRef.current = "idle"; if (!silent) { setState("idle"); posRef.current = 0; setPos(0); setLastSent(-1); } }
  const step = async () => { if (!file) return; pause(); const nx = await sendNext(posRef.current); if (nx === -1) { setState("done"); stateRef.current = "done"; } else { posRef.current = nx; setPos(nx); } };
  const startFrom = i => { pause(); posRef.current = i; setPos(i); };
  useEffect(() => () => clearTimeout(timer.current), []);

  /* keyboard: Space play/pause · → step · Esc stop — only while this page is on screen and not typing */
  useEffect(() => {
    const onKey = e => {
      if (!file || !listRef.current || listRef.current.offsetParent === null) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.code === "Space") { e.preventDefault(); if (stateRef.current === "playing") pause(); else if (be !== false) play(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(); }
      else if (e.key === "Escape") { stop(false); setTrail([]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ── list: SHOW filter + search (display only) ── */
  const matchRow = useCallback((r, i) => {
    if (show === "notes") { if (r.kind !== "note") return false; }
    else if (show === "ma") { if (!maNew.has(i)) return false; }
    else if (show === "TX" || show === "RX") { if (r.kind !== "pkt" || r.dir !== show) return false; }
    else if (show !== "all") { if (r.kind !== "pkt" || r.type !== show) return false; }
    if (!query.trim()) return true;
    const q = query.trim().toUpperCase().replace(/\s+/g, "");
    return r.kind === "pkt" ? (r.hex.includes(q) || r.time.replace(/[:.]/g, "").includes(q.replace(/[:.]/g, "")) || `#${r.n}` === q || String(r.n) === q)
      : r.text.toUpperCase().replace(/\s+/g, "").includes(q);
  }, [show, query, maNew]);
  const listIdx = useMemo(() => {
    const out = [];
    rows.forEach((r, i) => { if (matchRow(r, i)) out.push(i); });
    return out;
  }, [rows, matchRow]);
  const filtered = show !== "all" || !!query.trim();

  /* keep the line being sent (else the next one) in the middle of the list */
  const focusRow = lastSent >= 0 ? lastSent : pos;
  useEffect(() => {
    const box = listRef.current, el = box?.querySelector(`[data-i="${focusRow}"]`);
    if (!box || !el || box.offsetParent === null) return;           // page hidden — nothing to scroll
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: state === "playing" ? "auto" : "smooth" });
  }, [focusRow, state, show, query]);
  const cur = lastSent >= 0 ? rows[lastSent] : null;
  const curNote = useMemo(() => {                           // the log comment written just before that packet
    if (lastSent < 0) return null;
    for (let k = lastSent - 1; k >= 0 && rows[k].kind === "note"; k--) if (!/^paused|storyboard/i.test(rows[k].text)) return { text: rows[k].text, i: k };
    return null;
  }, [lastSent, rows]);

  const sentPkts = rows.slice(0, pos).filter(r => r.kind === "pkt").length;
  const pct = pkts.length ? Math.round(sentPkts / pkts.length * 100) : 0;
  const view = useMemo(() => {                              // render a window around the current row
    let k = listIdx.findIndex(i => i >= focusRow); if (k < 0) k = listIdx.length;
    const a = Math.max(0, k - 150), b = Math.min(listIdx.length, k + 350);
    return { a, b };
  }, [focusRow, listIdx]);

  /* ── time: elapsed / remaining in log time, and how long that takes at this speed ── */
  const t0 = pkts[0]?.t ?? 0;
  const atT = cur?.kind === "pkt" ? (cur.t - t0 + 86400000) % 86400000 : 0;
  const leftLog = Math.max(0, summary.dur - atT);
  const leftWall = speed === 0 ? Math.max(0, pkts.length - sentPkts) * 100 : (skipGaps ? Math.min(leftLog, Math.max(0, pkts.length - sentPkts) * 3000) : leftLog) / speed;

  /* ── timeline: packets per time slice, coloured by direction; the playhead follows the replay ── */
  const timeline = useMemo(() => {
    if (!pkts.length) return null;
    const span = Math.max(1, summary.dur);
    const b = Array.from({ length: BUCKETS }, () => ({ tx: 0, rx: 0, crc: 0, first: -1 }));
    rows.forEach((r, i) => {
      if (r.kind !== "pkt") return;
      const k = Math.min(BUCKETS - 1, Math.floor(((r.t - t0 + 86400000) % 86400000) / span * BUCKETS));
      if (r.dir === "TX") b[k].tx++; else b[k].rx++;
      if (!r.crcOk) b[k].crc++;
      if (b[k].first < 0) b[k].first = i;
    });
    const max = Math.max(1, ...b.map(x => x.tx + x.rx));
    const marks = [];                                       // MA changes, at the packet that follows the note
    maNew.forEach(i => {
      let j = i; while (j < rows.length && rows[j].kind !== "pkt") j++;
      if (j < rows.length) marks.push({ at: Math.min(100, ((rows[j].t - t0 + 86400000) % 86400000) / span * 100), i: j, text: rows[i].text });
    });
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ f, label: fmtClock(t0 + f * span) }));
    return { b, max, marks, ticks };
  }, [rows, pkts, summary.dur, t0, maNew]);
  const head = summary.dur ? Math.min(100, atT / summary.dur * 100) : 0;

  const typeChips = useMemo(() => [...new Set(pkts.map(p => p.type))].sort(), [pkts]);
  const typeCount = t => pkts.filter(p => p.type === t).length;

  const big = bg => ({ flex: 1, background: bg });

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "320px 1fr", overflow: "hidden", minHeight: 0, background: "var(--void)" }}>
      <style>{CSS}</style>

      {/* ═══════════ LEFT — controls ═══════════ */}
      <div style={{ overflowY: "auto", minHeight: 0, padding: 12, display: "flex", flexDirection: "column", gap: 12, borderRight: "1px solid var(--bdr)", background: "var(--base)" }}>

        {/* 1 · log file */}
        <div className="lr-card">
          <CardHead icon="📂" color="#06b6d4" title="Log file" right={file ? <span style={{ color: "var(--green)" }}>● loaded</span> : null} />
          <div className="lr-card-b">
            <div className={`lr-drop ${drag ? "drag idle" : file ? "" : "idle"}`}
              style={file && !drag ? { padding: "10px 12px", border: "1.5px solid rgba(16,185,129,.55)", background: "rgba(16,185,129,.07)" } : undefined}
              onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files?.[0]); }}
              onClick={() => fileInput.current?.click()}>
              {file && !drag ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
                  <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, display: "grid", placeItems: "center", fontSize: 16,
                    background: "rgba(16,185,129,.15)", color: "var(--green)", boxShadow: "0 0 14px rgba(16,185,129,.25)" }}>✓</div>
                  <div style={{ minWidth: 0 }}>
                    <div title={file.name} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--green)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</div>
                    <div style={{ fontSize: 9, color: "var(--tm)", marginTop: 3 }}>{(file.size / 1024).toFixed(0)} KB · click or drop to replace</div>
                  </div>
                </div>
              ) : <>
                <div style={{ width: 42, height: 42, margin: "0 auto", borderRadius: 12, display: "grid", placeItems: "center", fontSize: 20,
                  background: "rgba(6,182,212,.12)", color: "var(--cyan)", boxShadow: "0 0 18px rgba(6,182,212,.2)" }}>⇪</div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--tp)", marginTop: 8 }}>{file ? "Drop to replace the log" : "Drop a PINJ log here"}</div>
                <div style={{ fontSize: 9, color: "var(--tm)", marginTop: 4 }}>or click to browse · pinj_test_*.log · svk_test_*.log · Event Log .txt</div>
              </>}
              <input ref={fileInput} type="file" accept=".log,.txt" style={{ display: "none" }} onChange={e => { load(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
            {err && <div style={{ marginTop: 9, padding: "8px 10px", borderRadius: 8, fontSize: 9.5, color: "var(--red)", fontFamily: "var(--mono)", lineHeight: 1.5, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.3)" }}>{err}</div>}
            {file && <>
              {(file.header.title || file.header.port) && (
                <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "var(--raised)", fontFamily: "var(--mono)", fontSize: 9, lineHeight: 1.6 }}>
                  {file.header.title && <div style={{ color: "var(--tp)", fontWeight: 600 }}>{file.header.title.replace(/^DecodeX /, "")}</div>}
                  {file.header.port && <div style={{ color: "var(--tm)", wordBreak: "break-word" }}>{file.header.port}</div>}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
                {[["Packets", pkts.length, "var(--tp)", `${pkts.filter(p => p.dir === "TX").length} TX · ${pkts.filter(p => p.dir === "RX").length} RX`],
                  ["Duration", fmtDur(summary.dur), "var(--cyan)", pkts.length ? `${pkts[0].time.slice(0, 8)} →` : ""],
                  ["MA updates", summary.ma, "var(--amber)", `${maNew.size} changes`],
                  ["CRC fail", summary.crcFail, summary.crcFail ? "var(--red)" : "var(--green)", summary.crcFail ? "check the log" : "all packets OK"]].map(([l, v, c, s]) => (
                  <div key={l} className="lr-tile"><div className="l">{l}</div><div className="v" style={{ color: c, fontSize: 15 }}>{v}</div>
                    <div style={{ fontSize: 8, color: "var(--tm)", fontFamily: "var(--mono)", marginTop: 1 }}>{s}</div></div>
                ))}
              </div>
              <div style={{ marginTop: 10, display: "flex", height: 7, borderRadius: 4, overflow: "hidden", background: "var(--raised)" }}>
                {Object.entries(summary.c).sort().map(([k, v]) => (
                  <div key={k} title={`${k} × ${v}`} style={{ width: `${v / pkts.length * 100}%`, background: TYPE_BY_NIBBLE[Object.keys(TYPE_BY_NIBBLE).find(n => TYPE_BY_NIBBLE[n][0] === k.split(" ")[1])]?.[1] || "#888" }} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 7, fontFamily: "var(--mono)", fontSize: 9 }}>
                {Object.entries(summary.c).sort().map(([k, v]) => (
                  <span key={k} style={{ color: "var(--ts)" }}><b style={{ color: k.startsWith("TX") ? TX_COL : RX_COL }}>{k.split(" ")[0]}</b> {k.split(" ")[1]} <b style={{ color: "var(--tp)" }}>{v}</b></span>
                ))}
                {summary.notes > 0 && <span style={{ color: "var(--tm)" }}># notes <b style={{ color: "var(--tp)" }}>{summary.notes}</b></span>}
              </div>
            </>}
          </div>
        </div>

        {/* 2 · transport */}
        <div className="lr-card" style={{ borderColor: state === "playing" ? "rgba(16,185,129,.5)" : "var(--bdr)", boxShadow: state === "playing" ? "0 0 22px rgba(16,185,129,.12)" : "none" }}>
          <CardHead icon={state === "playing" ? "▶" : "■"} color={state === "playing" ? "#10b981" : state === "done" ? "#06b6d4" : "#64748b"} title="Replay"
            right={<span style={{ color: state === "playing" ? "var(--green)" : state === "done" ? "var(--cyan)" : state === "paused" ? "var(--amber)" : "var(--tm)",
              animation: state === "playing" ? "lrPulse 1.2s infinite" : "none" }}>● {state.toUpperCase()}</span>} />
          <div className="lr-card-b" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {state === "playing"
                ? <button className="lr-big" style={big("linear-gradient(135deg,#f59e0b,#d97706)")} onClick={pause}>⏸ PAUSE</button>
                : <button className="lr-big glow" style={big("linear-gradient(135deg,#10b981,#059669)")} disabled={!file || be === false} onClick={play}>▶ {state === "paused" ? "RESUME" : state === "done" ? "REPLAY" : "PLAY"}</button>}
              <button className="lr-big" style={{ flex: "0 0 62px", background: "linear-gradient(135deg,#475569,#334155)" }} disabled={!file} onClick={step} title="Send the next packet">⏭</button>
              <button className="lr-big" style={{ flex: "0 0 62px", background: "linear-gradient(135deg,#dc2626,#991b1b)" }} disabled={!file} onClick={() => { stop(false); setTrail([]); }} title="Stop and go back to the start">⏹</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Ring pct={pct} playing={state === "playing"} />
              <div style={{ flex: 1, minWidth: 0, fontFamily: "var(--mono)", display: "grid", gridTemplateColumns: "auto 1fr", gap: "5px 10px", fontSize: 9.5, alignItems: "baseline" }}>
                <span style={{ color: "var(--tm)", fontSize: 8, letterSpacing: ".1em" }}>PACKETS</span>
                <span style={{ color: "var(--ts)", textAlign: "right" }}><b style={{ color: "var(--tp)", fontSize: 12 }}>{sentPkts}</b> / {pkts.length}</span>
                <span style={{ color: "var(--tm)", fontSize: 8, letterSpacing: ".1em" }}>LOG TIME</span>
                <span style={{ color: "var(--ts)", textAlign: "right" }}><b style={{ color: "var(--cyan)" }}>{fmtDur(atT)}</b> / {fmtDur(summary.dur)}</span>
                <span style={{ color: "var(--tm)", fontSize: 8, letterSpacing: ".1em" }}>TIME LEFT</span>
                <span style={{ color: state === "done" ? "var(--green)" : "var(--tp)", textAlign: "right", fontWeight: 700 }}>{!file ? "—" : state === "done" ? "finished" : `≈ ${fmtDur(leftWall)}`}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <div className="lr-tile"><div className="l">SENT</div><div className="v" style={{ color: "var(--amber)" }}>{stats.sent}</div></div>
              <div className="lr-tile"><div className="l">OK</div><div className="v" style={{ color: "var(--green)" }}>{stats.ok}</div></div>
              <div className="lr-tile"><div className="l">ERR</div><div className="v" style={{ color: stats.err ? "var(--red)" : "var(--tm)" }}>{stats.err}</div></div>
            </div>
            {be === false && <div style={{ padding: "7px 9px", borderRadius: 8, fontSize: 9.5, color: "var(--red)", fontFamily: "var(--mono)", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.3)" }}>Backend offline — start it on port 8000.</div>}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 8.5, color: "var(--tm)", fontFamily: "var(--mono)" }}>
              <span><Kbd>Space</Kbd> play / pause</span><span><Kbd>→</Kbd> step</span><span><Kbd>Esc</Kbd> stop</span>
            </div>
            <div style={{ fontSize: 9, color: "var(--tm)", fontFamily: "var(--mono)", lineHeight: 1.6 }}>
              Watch it in PINJ → 📡 LIVE → 🚆 DMI (source filter “Log replay”). Click a packet in the log, or the timeline, to start from there.
            </div>
          </div>
        </div>
        {/* 3 · speed */}
        <div className="lr-card">
          <CardHead icon="⏱" color="#f59e0b" title="Replay speed" right={<span style={{ color: "var(--amber)" }}>{speed === 0 ? "100 ms / packet" : `${speed}×`}</span>} />
          <div className="lr-card-b">
            <div className="lr-seg">
              {SPEEDS.map(([v, l, s]) => (
                <button key={v} className={speed === v ? "on" : ""} onClick={() => setSpeed(v)}>
                  <div style={{ fontSize: 11, fontWeight: 800 }}>{l}</div>
                  <div style={{ fontSize: 7.5, opacity: .75, minHeight: 9 }}>{s}</div>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 6 }}>
              <div className={`lr-sw${skipGaps ? " on" : ""}`} onClick={() => setSkipGaps(v => !v)}><span className="t" />Skip idle gaps longer than 3 s</div>
              <div className={`lr-sw${loop ? " on" : ""}`} onClick={() => setLoop(v => !v)}><span className="t" />Loop at the end</div>
            </div>
          </div>
        </div>

        {/* 4 · packets to send */}
        <div className="lr-card">
          <CardHead icon="⇄" color="#a855f7" title="Packets to send" />
          <div className="lr-card-b">
            <div style={{ display: "flex", gap: 6 }}>
              {[["TX", useTx, setUseTx, TX_COL, "Station → Loco", "C.4.2 · C.4.4 · C.4.5"], ["RX", useRx, setUseRx, RX_COL, "Loco → Station", "C.4.3 · C.4.6"]].map(([d, on, set, col, l, s]) => (
                <button key={d} className="lr-dir" onClick={() => set(v => !v)}
                  style={{ borderColor: on ? col : "var(--bdr)", background: on ? `${col}14` : "var(--raised)", opacity: on ? 1 : 0.6, boxShadow: on ? `0 0 14px ${col}22` : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: col }}>{d}</span>
                    <span style={{ marginLeft: "auto", width: 14, height: 14, borderRadius: 4, display: "grid", placeItems: "center", fontSize: 9, color: "#fff",
                      background: on ? col : "transparent", border: `1.5px solid ${on ? col : "var(--bdr2)"}` }}>{on ? "✓" : ""}</span>
                  </div>
                  <div style={{ fontSize: 9.5, color: "var(--tp)", marginTop: 3 }}>{l}</div>
                  <div style={{ fontSize: 8, color: "var(--tm)", marginTop: 1 }}>{s}</div>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 9, color: "var(--tm)", fontFamily: "var(--mono)", marginTop: 8, lineHeight: 1.6 }}>
              Keep both for a complete DMI: TX carries the MA, signal, track profile and RFID tag list; RX carries the loco's speed, location, mode and tag.
            </div>
          </div>
        </div>

      </div>

      {/* ═══════════ RIGHT — now sending · timeline · log ═══════════ */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--base)" }}>
        {!file ? (
          <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
            <div style={{ textAlign: "center", fontFamily: "var(--mono)", maxWidth: 420, padding: 20 }}>
              <div style={{ width: 84, height: 84, margin: "0 auto", borderRadius: 24, display: "grid", placeItems: "center", fontSize: 36,
                background: "linear-gradient(135deg, rgba(6,182,212,.18), rgba(168,85,247,.14))", boxShadow: "0 0 40px rgba(6,182,212,.2), inset 0 0 0 1px rgba(6,182,212,.35)" }}>📂</div>
              <div style={{ marginTop: 18, fontSize: 14, fontWeight: 700, color: "var(--tp)", letterSpacing: ".04em" }}>No log loaded</div>
              <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--ts)", lineHeight: 1.7 }}>
                Drop a PINJ test log (<span style={{ color: "var(--cyan)" }}>logs/pinj_test_*.log</span>) or a KAVACH onboard Event Log Viewer log on the left.
                Its packets are replayed to PINJ LIVE with their original timing.
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 16, flexWrap: "wrap" }}>
                {Object.values(TYPE_BY_NIBBLE).map(([t, c]) => <span key={t} className="lr-badge" style={{ background: `${c}1c`, color: c, border: `1px solid ${c}55`, padding: "3px 8px" }}>{t} · {TYPE_NAME[t]}</span>)}
              </div>
            </div>
          </div>
        ) : <>
          {/* now sending */}
          <div key={lastSent} style={{ flexShrink: 0, margin: "12px 12px 0", padding: "12px 16px", borderRadius: 12, fontFamily: "var(--mono)", position: "relative", overflow: "hidden",
            border: `1.5px solid ${cur ? cur.color : "var(--bdr)"}`, background: cur ? `linear-gradient(100deg, ${cur.color}26, var(--surf) 55%)` : "var(--surf)",
            boxShadow: cur && state === "playing" ? `0 0 26px ${cur.color}38` : "none", animation: cur && state !== "playing" ? "lrCardIn .25s ease-out" : "none" }}>
            {cur ? <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".16em", color: state === "playing" ? "var(--green)" : "var(--amber)",
                  animation: state === "playing" ? "lrPulse 1s infinite" : "none" }}>{state === "playing" ? "● NOW SENDING" : "■ LAST SENT"}</span>
                <span style={{ padding: "3px 11px", borderRadius: 6, fontSize: 13, fontWeight: 800, color: "#fff", background: cur.color, boxShadow: `0 0 14px ${cur.color}66` }}>{cur.type}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--tp)" }}>{TYPE_NAME[cur.type] || ""}</span>
                <span className="lr-badge" style={{ fontSize: 10, color: cur.dir === "TX" ? TX_COL : RX_COL, background: `${cur.dir === "TX" ? TX_COL : RX_COL}18`, border: `1px solid ${cur.dir === "TX" ? TX_COL : RX_COL}55` }}>
                  {cur.dir === "TX" ? "TX · station → loco" : "RX · loco → station"}</span>
                {!cur.crcOk && <span className="lr-badge" style={{ fontSize: 10, color: "var(--red)", background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.45)" }}>CRC FAIL</span>}
                <span style={{ marginLeft: "auto", display: "flex", gap: 14, fontSize: 10, color: "var(--ts)" }}>
                  <span>#<b style={{ color: "var(--tp)" }}>{cur.n}</b></span>
                  <span>{cur.time}</span>
                  {cur.frame && cur.frame !== "--" && <span>frame <b style={{ color: "var(--tp)" }}>{cur.frame}</b></span>}
                  <span><b style={{ color: "var(--tp)" }}>{cur.hex.length / 2}</b> bytes</span>
                </span>
              </div>
              {curNote && <div style={{ marginTop: 8, fontSize: 9.5, display: "flex" }}><NoteLine text={curNote.text} fresh={!/^MA updated/.test(curNote.text) || maNew.has(curNote.i)} /></div>}
              {cur.desc && <div style={{ marginTop: 6, fontSize: 9.5, color: "var(--ts)", lineHeight: 1.5, wordBreak: "break-word" }}>{cur.event ? <b style={{ color: "var(--tp)" }}>{cur.event} · </b> : null}{cur.desc}</div>}
              {cur.radio && cur.radio !== "0xF1" && <div style={{ marginTop: 4, fontSize: 9.5, color: "var(--ts)" }}>radio {cur.radio} (F2 A5 C3)</div>}
              <div style={{ display: "flex", gap: 12, alignItems: "stretch", marginTop: 8 }}>
                <div className="lr-hx" style={{ flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8, background: "var(--raised)", border: "1px solid var(--bdr)", fontSize: 11, lineHeight: 1.7, color: cur.crcOk ? "var(--tp)" : "var(--red)", letterSpacing: ".04em" }}>
                  {hexGroups(cur.hex).map((g, k) => <span key={k} style={{ display: "inline-block" }}>
                    {k === 0 ? <><b style={{ color: cur.color }}>{g.slice(0, 2)}</b>{g.slice(2)}</> : g}</span>)}
                </div>
                {trail.length > 1 && (
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 5 }}>
                    <span style={{ fontSize: 8, letterSpacing: ".12em", color: "var(--tm)" }}>LAST {trail.length} SENT</span>
                    <div className="lr-trail" style={{ height: 30 }}>
                      {trail.map((j, k) => <i key={k} title={`#${rows[j].n} ${rows[j].dir} ${rows[j].type} ${rows[j].time}`}
                        style={{ height: rows[j].dir === "TX" ? 30 : 18, background: rows[j].color, opacity: 0.35 + 0.65 * (k + 1) / trail.length,
                          boxShadow: k === trail.length - 1 ? `0 0 8px ${rows[j].color}` : "none" }} />)}
                    </div>
                  </div>
                )}
              </div>
            </> : <div style={{ fontSize: 10.5, color: "var(--ts)", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>▶</span> Press PLAY — the packet being sent appears here and is highlighted in the log below.
            </div>}
          </div>

          {/* timeline */}
          {timeline && (
            <div style={{ flexShrink: 0, margin: "10px 12px 0", padding: "8px 10px 6px", borderRadius: 12, background: "var(--surf)", border: "1px solid var(--bdr)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--mono)", fontSize: 8.5, color: "var(--tm)", letterSpacing: ".1em", marginBottom: 4 }}>
                <span style={{ fontWeight: 700, color: "var(--ts)" }}>TIMELINE</span>
                <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: TX_COL, marginRight: 4 }} />TX</span>
                <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: RX_COL, marginRight: 4 }} />RX</span>
                {timeline.marks.length > 0 && <span><i style={{ display: "inline-block", width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: "7px solid #f59e0b", marginRight: 4 }} />MA CHANGE</span>}
                <span style={{ marginLeft: "auto", letterSpacing: ".04em" }}>click a bar or a ▼ to start there</span>
              </div>
              <div style={{ position: "relative", height: 9, margin: "0 2px" }}>
                {timeline.marks.map((m, k) => <span key={k} title={`${rows[m.i].time} · ${m.text}`} onClick={() => startFrom(m.i)}
                  style={{ position: "absolute", left: `${m.at}%`, top: 0, transform: "translateX(-50%)", width: 0, height: 0, cursor: "pointer",
                    borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "8px solid #f59e0b", filter: "drop-shadow(0 0 3px rgba(245,158,11,.6))" }} />)}
              </div>
              <div className="lr-tl">
                {timeline.b.map((x, k) => {
                  const h = (x.tx + x.rx) / timeline.max * 100;
                  const txH = x.tx + x.rx ? x.tx / (x.tx + x.rx) * 100 : 0;
                  const done = k / BUCKETS * 100 < head;
                  return <i key={k} title={x.first >= 0 ? `${rows[x.first].time} · ${x.tx} TX · ${x.rx} RX${x.crc ? ` · ${x.crc} CRC fail` : ""}` : "no packets"}
                    onClick={() => x.first >= 0 && startFrom(x.first)}
                    style={{ height: `${Math.max(4, h)}%`, opacity: x.first < 0 ? 0.25 : done ? 0.95 : 0.45,
                      background: x.first < 0 ? "var(--bdr)" : x.crc ? "var(--red)" : `linear-gradient(0deg, ${TX_COL} ${txH}%, ${RX_COL} ${txH}%)` }} />;
                })}
                {timeline.marks.map((m, k) => <span key={"m" + k} style={{ position: "absolute", left: `${m.at}%`, top: 0, bottom: 0, width: 1, background: "rgba(245,158,11,.45)", pointerEvents: "none" }} />)}
                <div style={{ position: "absolute", top: -2, bottom: -2, left: `calc(${head}% )`, width: 2, background: "var(--cyan)", boxShadow: "0 0 8px var(--cyan)", pointerEvents: "none", transition: "left .3s" }} />
              </div>
              <div style={{ position: "relative", height: 13, marginTop: 3, fontFamily: "var(--mono)", fontSize: 8, color: "var(--tm)" }}>
                {timeline.ticks.map(t => <span key={t.f} style={{ position: "absolute", left: `${t.f * 100}%`, transform: t.f === 0 ? "none" : t.f === 1 ? "translateX(-100%)" : "translateX(-50%)" }}>{t.label}</span>)}
              </div>
            </div>
          )}

          {/* filter bar */}
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "10px 12px 8px" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: ".12em", color: "var(--tm)", marginRight: 2 }}>SHOW</span>
            {[["all", "All", "#64748b", rows.length], ["TX", "TX", TX_COL, pkts.filter(p => p.dir === "TX").length], ["RX", "RX", RX_COL, pkts.filter(p => p.dir === "RX").length],
              ...typeChips.map(t => [t, t, TYPE_BY_NIBBLE[Object.keys(TYPE_BY_NIBBLE).find(n => TYPE_BY_NIBBLE[n][0] === t)]?.[1] || "#888", typeCount(t)]),
              ["notes", "# notes", "#64748b", summary.notes], ...(maNew.size ? [["ma", "▼ MA changes", "#f59e0b", maNew.size]] : [])].map(([k, l, c, n]) => (
              <button key={k} className={`lr-chip${show === k ? " on" : ""}`} onClick={() => setShow(k)}
                style={show === k ? { background: c, borderColor: c, boxShadow: `0 0 10px ${c}55` } : { borderColor: `${c}44` }}>
                {l}<span style={{ opacity: .75, fontWeight: 600 }}>{n}</span>
              </button>
            ))}
            <div style={{ marginLeft: "auto", position: "relative" }}>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search hex, time or #n…"
                style={{ width: 220, padding: "6px 26px 6px 10px", borderRadius: 8, border: "1px solid var(--bdr)", background: "var(--surf)", color: "var(--tp)", fontSize: 10, outline: "none" }}
                onFocus={e => (e.target.style.borderColor = "var(--cyan)")} onBlur={e => (e.target.style.borderColor = "var(--bdr)")} />
              {query && <button onClick={() => setQuery("")} style={{ position: "absolute", right: 6, top: 4, border: 0, background: "transparent", color: "var(--tm)", cursor: "pointer", fontSize: 12 }}>✕</button>}
            </div>
          </div>

          {/* log */}
          <div style={{ flex: 1, minHeight: 0, margin: "0 12px 12px", borderRadius: 12, border: "1px solid var(--bdr)", background: "var(--surf)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="lr-row" style={{ cursor: "default", padding: "8px 14px", background: "var(--raised)", fontSize: 8.5, color: "var(--tm)", letterSpacing: ".12em", fontWeight: 700 }}>
              <span>#</span><span>TIME</span><span>DIR</span><span>TYPE</span><span>FRAME</span><span>HEX</span>
            </div>
            <div ref={listRef} style={{ flex: 1, overflowY: "auto", minHeight: 0, position: "relative" }}>
              {filtered && listIdx.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "var(--tm)", fontFamily: "var(--mono)", fontSize: 10.5 }}>Nothing matches this filter.</div>}
              {view.a > 0 && <div style={{ padding: "5px 14px", fontSize: 9, color: "var(--tm)", fontFamily: "var(--mono)" }}>… {view.a} earlier lines</div>}
              {listIdx.slice(view.a, view.b).map(i => {
                const r = rows[i];
                const next = i === pos && lastSent !== i, sent = i === lastSent, done = i < pos && !sent;
                if (r.kind === "note") return (
                  <div key={i} data-i={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 14px 3px 89px", fontSize: 9, color: noteColor(r.text), fontFamily: "var(--mono)",
                    opacity: done ? 0.6 : 1, whiteSpace: "nowrap", overflow: "hidden", borderBottom: "1px solid rgba(127,127,127,.08)",
                    background: maNew.has(i) ? "linear-gradient(90deg, rgba(245,158,11,.12), transparent 70%)" : "rgba(245,158,11,.025)" }}>
                    <NoteLine text={r.text} fresh={!/^MA updated/.test(r.text) || maNew.has(i)} />
                  </div>
                );
                const skip = !((r.dir === "TX" && useTx) || (r.dir === "RX" && useRx));
                const dc = r.dir === "TX" ? TX_COL : RX_COL;
                return (
                  <div key={i} data-i={i} className="lr-row" onClick={() => startFrom(i)} title="Start the replay from this packet"
                    style={{ padding: sent ? "9px 14px" : "5px 14px", fontSize: sent ? 11 : 9.8, fontWeight: sent ? 700 : 400, zIndex: sent ? 1 : 0,
                      borderLeft: `${sent ? 5 : 3}px solid ${sent ? "var(--cyan)" : r.color}`,
                      background: sent ? "linear-gradient(90deg, rgba(6,182,212,.26), rgba(6,182,212,.06))" : next ? "rgba(245,158,11,.08)" : i % 2 ? "var(--alt)" : "transparent",
                      animation: sent ? "lrRowFlash .6s ease-out forwards" : "none", opacity: skip ? 0.32 : done ? 0.62 : 1 }}>
                    <span style={{ color: sent ? "var(--cyan)" : next ? "var(--amber)" : "var(--tm)" }}>{sent ? "▶ " : next ? "› " : ""}#{r.n}</span>
                    <span style={{ color: sent ? "var(--tp)" : "var(--ts)" }}>{r.time}</span>
                    <span><span className="lr-badge" style={{ color: dc, background: `${dc}18`, border: `1px solid ${dc}44` }}>{r.dir}</span></span>
                    <span><span className="lr-badge" style={{ color: r.color, background: `${r.color}18`, border: `1px solid ${r.color}44` }}>{r.type}</span></span>
                    <span style={{ color: "var(--tm)" }}>{r.frame}</span>
                    <span className="lr-hx" style={{ color: !r.crcOk ? "var(--red)" : sent ? "var(--tp)" : "var(--ts)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: ".03em" }}>
                      {!r.crcOk && <b style={{ marginRight: 6 }}>✗ CRC</b>}{hexGroups(r.hex).map((g, k) => <span key={k}>{g}</span>)}</span>
                    {!sent && <span className="lr-go">▶ START HERE</span>}
                  </div>
                );
              })}
              {view.b < listIdx.length && <div style={{ padding: "5px 14px", fontSize: 9, color: "var(--tm)", fontFamily: "var(--mono)" }}>… {listIdx.length - view.b} more lines</div>}
            </div>
            <div style={{ flexShrink: 0, display: "flex", gap: 14, padding: "6px 14px", borderTop: "1px solid var(--bdr)", background: "var(--raised)", fontFamily: "var(--mono)", fontSize: 9, color: "var(--tm)" }}>
              <span>{filtered ? `${listIdx.length} of ${rows.length} lines shown` : `${rows.length} lines`}</span>
              <span>{pkts.length} packets · {summary.notes} notes</span>
              <span style={{ marginLeft: "auto" }}>→ PINJ LIVE · POST /ingest</span>
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}
