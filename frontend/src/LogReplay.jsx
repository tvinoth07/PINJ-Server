/**
 * LogReplay.jsx — Packet Simulator "📂 LOG REPLAY" page.
 *
 * Loads a PINJ / SVK SIM serial test log (logs/svk_test_*.log) and re-sends its radio
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
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { appSettingsStore } from "./SettingsAbout";

const INGEST_URL = "http://localhost:8000/ingest";
const TYPE_BY_NIBBLE = { 9: ["C.4.2", "#06b6d4"], 10: ["C.4.3", "#10b981"], 11: ["C.4.4", "#8b5cf6"], 12: ["C.4.5", "#ef4444"], 13: ["C.4.6", "#f59e0b"] };
const TYPE_NAME = { "C.4.2": "Station → Loco Regular", "C.4.3": "Loco → Station Regular", "C.4.4": "Access Authority", "C.4.5": "Additional Emergency", "C.4.6": "Loco Access Request" };
const CSS = `
@keyframes lrRowFlash { 0% { box-shadow: inset 0 0 0 2px var(--cyan), 0 0 22px rgba(6,182,212,.55); } 100% { box-shadow: inset 0 0 0 1px var(--cyan), 0 0 10px rgba(6,182,212,.25); } }
@keyframes lrCardIn   { 0% { transform: translateY(-6px); opacity: .35; } 100% { transform: none; opacity: 1; } }
@keyframes lrPulse    { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
`;
const SPEEDS = [[1, "1× real time"], [2, "2×"], [5, "5×"], [10, "10×"], [0, "FAST (100 ms)"]];

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
    return { c, ma: notes.filter(n => /^MA updated/.test(n.text)).length, notes: notes.length, dur };
  }, [rows, pkts]);

  const load = useCallback(f => {
    if (!f) return;
    setErr("");
    const rd = new FileReader();
    rd.onload = () => {
      const parsed = parseLog(String(rd.result || ""));
      if (!parsed.rows.some(r => r.kind === "pkt")) { setErr("No packet lines found — expected a PINJ log (#n  HH:MM:SS.mmm  TX|RX … HEX) or a KAVACH Event Log Viewer log (Event Name : … / Data : …)."); return; }
      stop(true);
      setFile({ name: f.name, ...parsed });
      setPos(0); posRef.current = 0; setStats({ sent: 0, ok: 0, err: 0 }); setLastSent(-1);
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

  /* keep the line being sent (else the next one) in the middle of the list */
  const focusRow = lastSent >= 0 ? lastSent : pos;
  useEffect(() => {
    const box = listRef.current, el = box?.querySelector(`[data-i="${focusRow}"]`);
    if (!box || !el || box.offsetParent === null) return;           // page hidden — nothing to scroll
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: state === "playing" ? "auto" : "smooth" });
  }, [focusRow, state]);
  const cur = lastSent >= 0 ? rows[lastSent] : null;
  const curNote = useMemo(() => {                           // the log comment written just before that packet
    if (lastSent < 0) return null;
    for (let k = lastSent - 1; k >= 0 && rows[k].kind === "note"; k--) if (!/^paused|storyboard/i.test(rows[k].text)) return rows[k].text;
    return null;
  }, [lastSent, rows]);

  const sentPkts = rows.slice(0, pos).filter(r => r.kind === "pkt").length;
  const pct = pkts.length ? Math.round(sentPkts / pkts.length * 100) : 0;
  const lab = { fontSize: 9, color: "var(--tm)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 7 };
  const btn = (on, col = "var(--cyan)") => ({ flex: 1, padding: "6px 0", borderRadius: 5, cursor: "pointer", fontSize: 9, fontFamily: "var(--mono)", fontWeight: on ? 700 : 400,
    border: `1px solid ${on ? col : "var(--bdr)"}`, background: on ? "rgba(6,182,212,.12)" : "var(--raised)", color: on ? col : "var(--ts)" });
  const big = (bg, dis) => ({ flex: 1, padding: "11px 0", borderRadius: 7, border: "none", cursor: dis ? "default" : "pointer", opacity: dis ? 0.45 : 1,
    fontSize: 11, fontWeight: 800, fontFamily: "var(--mono)", letterSpacing: ".08em", color: "#fff", background: bg });
  const view = useMemo(() => {                              // render a window around the current row
    const a = Math.max(0, focusRow - 150), b = Math.min(rows.length, focusRow + 350);
    return { a, b };
  }, [focusRow, rows.length]);

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "300px 1fr", overflow: "hidden", minHeight: 0 }}>
      <style>{CSS}</style>
      {/* controls */}
      <div style={{ background: "var(--surf)", borderRight: "1px solid var(--bdr)", overflowY: "auto", minHeight: 0 }}>
        <div style={{ padding: "7px 13px", background: "var(--raised)", borderBottom: "1px solid var(--bdr)", ...lab, marginBottom: 0 }}>📂 PINJ LOG REPLAY</div>

        <div style={{ padding: 13, borderBottom: "1px solid var(--bdr)" }}>
          <div
            onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files?.[0]); }}
            onClick={() => fileInput.current?.click()}
            style={{ border: `1.5px dashed ${drag ? "var(--cyan)" : file ? "var(--green)" : "var(--bdr2, var(--bdr))"}`, borderRadius: 8, padding: "16px 10px", textAlign: "center", cursor: "pointer",
              background: drag ? "rgba(6,182,212,.08)" : "var(--raised)", fontFamily: "var(--mono)" }}>
            <div style={{ fontSize: 22 }}>{file ? "✓" : "📂"}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: file ? "var(--green)" : "var(--tp)", marginTop: 4, wordBreak: "break-all" }}>{file ? file.name : "DROP A PINJ LOG HERE"}</div>
            <div style={{ fontSize: 8.5, color: "var(--tm)", marginTop: 4 }}>{file ? "click or drop to replace" : "or click — logs/svk_test_*.log"}</div>
            <input ref={fileInput} type="file" accept=".log,.txt" style={{ display: "none" }} onChange={e => { load(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
          {err && <div style={{ marginTop: 8, fontSize: 9, color: "var(--red)", fontFamily: "var(--mono)", lineHeight: 1.5 }}>{err}</div>}
          {file && (
            <div style={{ marginTop: 10, fontSize: 9, fontFamily: "var(--mono)", color: "var(--ts)", lineHeight: 1.75 }}>
              {file.header.title && <div style={{ color: "var(--tp)" }}>{file.header.title}</div>}
              {file.header.port && <div style={{ color: "var(--tm)" }}>{file.header.port}</div>}
              <div style={{ marginTop: 4 }}>{pkts.length} packets · {Math.round(summary.dur / 1000)} s · {summary.ma} MA updates · {summary.notes} notes</div>
              {Object.entries(summary.c).sort().map(([k, v]) => <div key={k}><span style={{ color: k.startsWith("TX") ? "#a855f7" : "#ec4899" }}>{k.split(" ")[0]}</span> {k.split(" ")[1]} × {v}</div>)}
            </div>
          )}
        </div>

        <div style={{ padding: 13, borderBottom: "1px solid var(--bdr)" }}>
          <div style={lab}>Replay speed</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {SPEEDS.map(([v, l]) => <button key={v} style={{ ...btn(speed === v, "var(--amber)"), flex: "1 1 30%" }} onClick={() => setSpeed(v)}>{l}</button>)}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9, fontSize: 9.5, color: "var(--ts)", fontFamily: "var(--mono)", cursor: "pointer" }}>
            <input type="checkbox" checked={skipGaps} onChange={e => setSkipGaps(e.target.checked)} /> Skip idle gaps longer than 3 s (paused periods)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 9.5, color: "var(--ts)", fontFamily: "var(--mono)", cursor: "pointer" }}>
            <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} /> Loop at the end
          </label>
        </div>

        <div style={{ padding: 13, borderBottom: "1px solid var(--bdr)" }}>
          <div style={lab}>Packets to send</div>
          <div style={{ display: "flex", gap: 4 }}>
            <button style={btn(useTx, "#a855f7")} onClick={() => setUseTx(v => !v)}>TX · station → loco</button>
            <button style={btn(useRx, "#ec4899")} onClick={() => setUseRx(v => !v)}>RX · loco → station</button>
          </div>
          <div style={{ fontSize: 8.5, color: "var(--tm)", fontFamily: "var(--mono)", marginTop: 7, lineHeight: 1.6 }}>
            TX C.4.2 carries the MA, signal, APD track profile and RFID tag list; RX C.4.3 / C.4.6 carries the loco speed, location, mode and tag. Keep both for a complete DMI.
          </div>
        </div>

        <div style={{ padding: 13, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {state === "playing"
              ? <button style={big("linear-gradient(135deg,#f59e0b,#d97706)")} onClick={pause}>⏸ PAUSE</button>
              : <button style={big("linear-gradient(135deg,#10b981,#059669)", !file || be === false)} disabled={!file || be === false} onClick={play}>▶ {state === "paused" ? "RESUME" : "PLAY"}</button>}
            <button style={{ ...big("linear-gradient(135deg,#475569,#334155)", !file), flex: "0 0 64px" }} disabled={!file} onClick={step} title="Send the next packet">⏭ STEP</button>
            <button style={{ ...big("linear-gradient(135deg,#dc2626,#991b1b)", !file), flex: "0 0 64px" }} disabled={!file} onClick={() => stop(false)}>⏹</button>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--raised)", overflow: "hidden", border: "1px solid var(--bdr)" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#06b6d4,#10b981)", transition: "width .3s" }} />
          </div>
          <div style={{ display: "flex", fontSize: 9, fontFamily: "var(--mono)", color: "var(--ts)" }}>
            <span>{sentPkts} / {pkts.length} packets ({pct}%)</span>
            <span style={{ marginLeft: "auto", color: state === "playing" ? "var(--green)" : state === "done" ? "var(--cyan)" : "var(--tm)", fontWeight: 700 }}>{state.toUpperCase()}</span>
          </div>
          <div style={{ display: "flex", gap: 5, fontSize: 9, fontFamily: "var(--mono)" }}>
            <span style={{ color: "var(--amber)" }}>SENT {stats.sent}</span><span style={{ color: "var(--green)" }}>OK {stats.ok}</span><span style={{ color: "var(--red)" }}>ERR {stats.err}</span>
          </div>
          {be === false && <div style={{ fontSize: 9, color: "var(--red)", fontFamily: "var(--mono)" }}>Backend offline — start it on port 8000.</div>}
          <div style={{ fontSize: 8.5, color: "var(--tm)", fontFamily: "var(--mono)", lineHeight: 1.6 }}>
            Open 📡 LIVE → 🚆 DMI in DECODEX to watch it. Source filter there: “Log replay”. Click a row on the right to start from it.
          </div>
        </div>
      </div>

      {/* packet list */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--base)" }}>
        {file && (
          <div key={lastSent} style={{ flexShrink: 0, margin: 10, marginBottom: 6, padding: "10px 14px", borderRadius: 10, fontFamily: "var(--mono)",
            border: `1.5px solid ${cur ? cur.color : "var(--bdr)"}`, background: cur ? `linear-gradient(90deg, ${cur.color}22, var(--surf) 60%)` : "var(--surf)",
            boxShadow: cur && state === "playing" ? `0 0 18px ${cur.color}40` : "none", animation: cur ? "lrCardIn .35s ease-out" : "none" }}>
            {cur ? <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".14em", color: state === "playing" ? "var(--green)" : "var(--amber)",
                  animation: state === "playing" ? "lrPulse 1s infinite" : "none" }}>{state === "playing" ? "● NOW SENDING" : "■ LAST SENT"}</span>
                <span style={{ padding: "2px 10px", borderRadius: 5, fontSize: 13, fontWeight: 800, color: "#fff", background: cur.color }}>{cur.type}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--tp)" }}>{TYPE_NAME[cur.type] || ""}</span>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: cur.dir === "TX" ? "#a855f7" : "#ec4899" }}>{cur.dir === "TX" ? "TX · station → loco" : "RX · loco → station"}</span>
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--ts)" }}>#{cur.n} · {cur.time}{cur.frame && cur.frame !== "--" ? ` · frame ${cur.frame}` : ""} · {cur.hex.length / 2} bytes</span>
              </div>
              {curNote && <div style={{ marginTop: 6, fontSize: 9.5, color: "var(--amber)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}># {curNote}</div>}
              {cur.desc && <div style={{ marginTop: 6, fontSize: 9.5, color: "var(--ts)", lineHeight: 1.5, wordBreak: "break-word" }}>{cur.event ? <b style={{ color: "var(--tp)" }}>{cur.event} · </b> : null}{cur.desc}</div>}
              {cur.radio && cur.radio !== "0xF1" && <div style={{ marginTop: 4, fontSize: 9.5, color: "var(--ts)" }}>radio {cur.radio} (F2 A5 C3)</div>}
              <div style={{ marginTop: 6, fontSize: 10.5, lineHeight: 1.55, color: cur.crcOk ? "var(--tp)" : "var(--red)", wordBreak: "break-all", letterSpacing: ".03em" }}>
                {cur.hex.match(/.{1,2}/g).join(" ")}
              </div>
            </> : <div style={{ fontSize: 10, color: "var(--ts)" }}>Press ▶ PLAY — the packet being sent appears here, highlighted in the list below.</div>}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "56px 96px 34px 50px 56px 1fr", gap: 6, padding: "6px 12px", background: "var(--surf)", borderBottom: "1px solid var(--bdr)",
          fontSize: 8, color: "var(--tm)", fontFamily: "var(--mono)", letterSpacing: ".1em" }}>
          <span>#</span><span>TIME</span><span>DIR</span><span>TYPE</span><span>FRAME</span><span>HEX</span>
        </div>
        <div ref={listRef} style={{ flex: 1, overflowY: "auto", minHeight: 0, position: "relative" }}>
          {!file && <div style={{ padding: 40, textAlign: "center", color: "var(--tm)", fontFamily: "var(--mono)", fontSize: 11 }}>Load a PINJ log to see its packets here.</div>}
          {view.a > 0 && <div style={{ padding: "4px 12px", fontSize: 8.5, color: "var(--tm)", fontFamily: "var(--mono)" }}>… {view.a} earlier lines</div>}
          {rows.slice(view.a, view.b).map((r, k) => {
            const i = view.a + k;
            const next = i === pos && lastSent !== i, sent = i === lastSent, done = i < pos && !sent;
            if (r.kind === "note") return (
              <div key={i} data-i={i} style={{ padding: "2px 12px 2px 68px", fontSize: 8.5, color: /^MA updated/.test(r.text) ? "var(--amber)" : "var(--tm)", fontFamily: "var(--mono)", fontStyle: "italic",
                opacity: done ? 0.6 : 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}># {r.text}</div>
            );
            const skip = !((r.dir === "TX" && useTx) || (r.dir === "RX" && useRx));
            return (
              <div key={i} data-i={i} onClick={() => startFrom(i)} title="Start the replay from this packet"
                style={{ display: "grid", gridTemplateColumns: "56px 96px 34px 50px 56px 1fr", gap: 6, padding: sent ? "7px 12px" : "3px 12px", cursor: "pointer",
                  fontSize: sent ? 11 : 9.5, fontWeight: sent ? 700 : 400, fontFamily: "var(--mono)", position: "relative", zIndex: sent ? 1 : 0,
                  borderLeft: `${sent ? 5 : 3}px solid ${sent ? "var(--cyan)" : r.color}`,
                  background: sent ? "linear-gradient(90deg, rgba(6,182,212,.28), rgba(6,182,212,.08))" : next ? "rgba(127,127,127,.10)" : "transparent",
                  animation: sent ? "lrRowFlash .6s ease-out forwards" : "none", borderRadius: sent ? 4 : 0,
                  opacity: skip ? 0.35 : done ? 0.6 : 1, borderBottom: "1px solid rgba(127,127,127,.12)" }}>
                <span style={{ color: sent ? "var(--cyan)" : "var(--tm)" }}>{sent ? "▶ " : next ? "› " : ""}#{r.n}</span>
                <span style={{ color: sent ? "var(--tp)" : "var(--ts)" }}>{r.time}</span>
                <span style={{ color: r.dir === "TX" ? "#a855f7" : "#ec4899", fontWeight: 700 }}>{r.dir}</span>
                <span style={{ color: r.color, fontWeight: 700 }}>{r.type}</span>
                <span style={{ color: "var(--tm)" }}>{r.frame}</span>
                <span style={{ color: !r.crcOk ? "var(--red)" : sent ? "var(--tp)" : "var(--ts)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.hex.match(/.{1,2}/g).join(" ")}</span>
              </div>
            );
          })}
          {view.b < rows.length && <div style={{ padding: "4px 12px", fontSize: 8.5, color: "var(--tm)", fontFamily: "var(--mono)" }}>… {rows.length - view.b} more lines</div>}
        </div>
      </div>
    </div>
  );
}
