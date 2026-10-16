import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ══════════════════════════════════════════════════════════════
   KAVACH LIVE FEED PAGE
   Connects via WebSocket to ws://localhost:8000/ws/live
   Receives decoded packets in real-time, displays in a
   scrollable feed table. Each row is expandable.
   Can also receive packets from any external tool via
   POST http://localhost:8000/ingest
══════════════════════════════════════════════════════════════ */

const PKT_META = {
  9: { name: "Stn→Onboard", short: "C.4.2", color: "#06b6d4", icon: "📡" },
  10: { name: "Onboard→Stn", short: "C.4.3", color: "#10b981", icon: "🚆" },
  11: { name: "Access Auth", short: "C.4.4", color: "#8b5cf6", icon: "🔐" },
  12: { name: "Emergency", short: "C.4.5", color: "#ef4444", icon: "🚨" },
  13: { name: "Access Request", short: "C.4.6", color: "#f59e0b", icon: "📶" },
};

const SOURCE_COLOR = {
  "manual-ui": "#8b5cf6",
  "external": "#06b6d4",
  "mqtt": "#10b981",
  "websocket": "#f59e0b",
};

const LIVE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}

:root{
  --bg:#08080a; --surface:#0f0f14; --raised:#141420; --hover:#1a1a28;
  --border:#1e1e30; --border-b:#2a2a40;
  --amber:#f59e0b; --amber-g:rgba(245,158,11,0.1);
  --green:#10b981; --cyan:#06b6d4; --red:#ef4444; --purple:#8b5cf6;
  --text:#e8e8f5; --sub:#8888a8; --muted:#44445a; --dim:#2a2a40;
  --code:#a3e635; --val:#f0abfc;
  --font-mono:'IBM Plex Mono',monospace;
  --font-disp:'Bebas Neue',sans-serif;
  --font-body:'DM Sans',sans-serif;
}
:root.light{
  --bg:#f0f0f5; --surface:#ffffff; --raised:#f2f2f8; --hover:#eaeaf4;
  --border:#d8d8e8; --border-b:#b8b8d0;
  --amber:#b45309; --amber-g:rgba(180,83,9,0.07);
  --green:#059669; --cyan:#0284c7; --red:#dc2626; --purple:#7c3aed;
  --text:#1a1a2e; --sub:#4a4a6a; --muted:#7070a0; --dim:#a0a0c0;
  --code:#166534; --val:#7c3aed;
}

html,body,#root{height:100%;width:100%;background:var(--bg);color:var(--text);font-family:var(--font-body);overflow:hidden;}
::-webkit-scrollbar{width:4px;height:4px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--border-b);border-radius:2px;}
::-webkit-scrollbar-thumb:hover{background:var(--amber);}

*{transition:background-color 0.2s ease,border-color 0.2s ease,color 0.15s ease;}
button,input,select{transition:background-color 0.2s ease,border-color 0.2s ease,color 0.15s ease,box-shadow 0.15s ease;}

@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}
@keyframes slide-in{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}
@keyframes flash-new{0%{background:rgba(245,158,11,0.18)}100%{background:transparent}}
@keyframes blink{0%,100%{opacity:1}49%{opacity:1}50%{opacity:0}99%{opacity:0}}

.new-row{animation:slide-in 0.3s ease forwards,flash-new 1.2s ease forwards;}
.cursor::after{content:'█';animation:blink 1s step-end infinite;color:var(--amber);font-size:0.8em;}
.pulse{animation:pulse 1.2s ease-in-out infinite;}

.expand-btn{background:none;border:none;cursor:pointer;font-size:11px;padding:2px 6px;border-radius:3px;color:var(--muted);font-family:var(--font-mono);transition:color 0.15s,background 0.15s;}
.expand-btn:hover{color:var(--amber);background:var(--amber-g);}

.badge{display:inline-flex;align-items:center;padding:1px 7px;border-radius:3px;font-size:9px;font-family:var(--font-mono);font-weight:700;letter-spacing:0.04em;}

button{cursor:pointer;font-family:var(--font-body);}
`;

/* ── Shared field table (reused from main App) ── */
const GROUP_COLOR = {
  header: "#f59e0b", loco: "#06b6d4", station: "#8b5cf6", emergency: "#ef4444",
  brake: "#f97316", gps: "#10b981", freq: "#22d3ee", session: "#a78bfa",
  crc: "#6b7280", pad: "#374151", ma: "#f59e0b", ssp: "#10b981",
  grad: "#a78bfa", lc: "#f97316", to: "#06b6d4", tl: "#ec4899", tc: "#84cc16",
  tsr: "#fb7185", "sub-header": "#f59e0b", unknown: "#6b7280", uncertainty: "#fbbf24", integrity: "#34d399",
};
const GROUP_COLOR_LIGHT = {
  header: "#b45309", loco: "#0284c7", station: "#7c3aed", emergency: "#dc2626",
  brake: "#ea580c", gps: "#059669", freq: "#0891b2", session: "#6d28d9",
  crc: "#6b7280", pad: "#9ca3af", ma: "#b45309", ssp: "#047857",
  grad: "#6d28d9", lc: "#ea580c", to: "#0284c7", tl: "#be185d", tc: "#4d7c0f",
  tsr: "#e11d48", "sub-header": "#b45309", unknown: "#9ca3af", uncertainty: "#d97706", integrity: "#047857",
};

function ExpandedFields({ fields, isLight }) {
  const GC = isLight ? GROUP_COLOR_LIGHT : GROUP_COLOR;
  return (
    <div style={{ padding: "0 0 6px 0", background: isLight ? "#f8f8ff" : "#0a0a14", borderBottom: `1px solid var(--border)` }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 10, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "24%" }} /><col style={{ width: "5%" }} />
          <col style={{ width: "22%" }} /><col style={{ width: "8%" }} />
          <col style={{ width: "41%" }} />
        </colgroup>
        <tbody>
          {fields.map((f, i) => {
            if (f._is_section) return (
              <tr key={i}>
                <td colSpan={5} style={{ padding: "5px 12px 3px", background: isLight ? "#eeeefc" : "#0f0f20", borderTop: `1px solid var(--border)` }}>
                  <span style={{ fontFamily: "var(--font-disp)", fontSize: 11, letterSpacing: "0.1em", color: "var(--amber)", textTransform: "uppercase" }}>{f.Field}</span>
                </td>
              </tr>
            );
            const gcolor = GC[f._group] || "#6b7280";
            const isSpecial = ["PKT_TYPE", "PKT_LENGTH", "FRAME_NUM", "PKT_CRC", "MAC_CODE"].includes(f.Field);
            const isAlert = (f._group === "emergency" || f._group === "brake") && f["Decimal Value"] > 0;
            const isIndent = String(f.Field).startsWith("  ");
            const isMeta = f._group === "pad" || f._group === "crc";
            return (
              <tr key={i} style={{
                background: isAlert ? "rgba(239,68,68,0.07)" : i % 2 === 0 ? "transparent" : isLight ? "rgba(0,0,60,0.025)" : "rgba(255,255,255,0.018)",
                borderBottom: "1px solid var(--border)",
              }}>
                <td style={{ padding: "3px 10px", paddingLeft: isIndent ? 22 : 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 2, height: 12, borderRadius: 1, background: gcolor, opacity: isMeta ? 0.3 : 0.85, flexShrink: 0 }} />
                    <span style={{ color: isSpecial ? "var(--amber)" : isAlert ? "var(--red)" : isMeta ? "var(--dim)" : "var(--text)", fontWeight: isSpecial ? 600 : 400, fontSize: isIndent ? 9 : 10 }}>{f.Field.trim()}</span>
                  </div>
                </td>
                <td style={{ padding: "3px 8px", color: "var(--muted)", textAlign: "right", fontSize: 9 }}>{f["Size (bits)"]}</td>
                <td style={{ padding: "3px 8px", color: "var(--code)", fontSize: 9, wordBreak: "break-all" }}>{typeof f["Raw Bits"] === "string" && f["Raw Bits"].length > 28 ? f["Raw Bits"].slice(0, 28) + "…" : f["Raw Bits"]}</td>
                <td style={{ padding: "3px 8px", color: isSpecial ? "var(--amber)" : isAlert ? "var(--red)" : "var(--val)", textAlign: "right", fontWeight: 600, fontSize: 10 }}>{f["Decimal Value"]}</td>
                <td style={{ padding: "3px 8px", color: "var(--sub)", fontSize: 10 }}>{f.Description}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Single feed row ── */
function FeedRow({ pkt, idx, isNew, isLight }) {
  const [expanded, setExpanded] = useState(false);
  const meta = PKT_META[pkt.packet_type_value] || { name: "Unknown", short: "?", color: "#6b7280", icon: "📦" };
  const color = meta.color;
  const srcColor = SOURCE_COLOR[pkt.source] || "#6b7280";

  // Extract key fields for inline summary
  const fields = pkt.fields || [];
  const getField = (name) => fields.find(f => (f.Field || "").trim() === name);

  const speed = getField("TRAIN_SPEED");
  const mode = getField("LOCO_MODE");
  const emerg = getField("EMERGENCY_STATUS") || getField("GEN_SOS_CALL");
  const loc = getField("ABS_LOCO_LOC");
  const frame = getField("FRAME_NUM");
  const locoId = getField("SOURCE_LOCO_ID");
  const stnId = getField("SOURCE_STN_ID") || getField("SOURCE_STN_ILC_IBS_ID");
  const crc = pkt.crc_check;
  const emergActive = emerg && typeof emerg["Decimal Value"] === "number" && emerg["Decimal Value"] > 0;
  const fieldCount = fields.filter(f => !f._is_section).length;

  return (
    <div className={isNew ? "new-row" : ""} style={{
      borderBottom: `1px solid var(--border)`,
      borderLeft: `3px solid ${emergActive ? "var(--red)" : color}`,
      background: emergActive ? "rgba(239,68,68,0.04)" : "transparent",
    }}>
      {/* ── Summary row ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "44px 90px 80px 1fr 1fr 1fr 90px 64px 52px",
        alignItems: "center", gap: "0 8px", padding: "6px 12px",
        cursor: "pointer",
      }} onClick={() => setExpanded(e => !e)}>

        {/* Index */}
        <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--font-mono)", textAlign: "right" }}>#{pkt.packet_index}</span>

        {/* Time */}
        <span style={{ fontSize: 10, color: "var(--sub)", fontFamily: "var(--font-mono)" }}>{pkt.received_at_iso || "--:--:--"}</span>

        {/* Packet type badge */}
        <span className="badge" style={{ background: `${color}18`, color, border: `1px solid ${color}44`, gap: 4 }}>
          <span style={{ fontSize: 12 }}>{meta.icon}</span>{meta.short}
        </span>

        {/* Loco / Station ID */}
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--sub)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {locoId ? <span style={{ color: "var(--cyan)" }}>Loco #{locoId["Decimal Value"]}</span>
            : stnId ? <span style={{ color: "var(--purple)" }}>Stn #{stnId["Decimal Value"]}</span>
              : <span style={{ color: "var(--muted)" }}>—</span>}
        </span>

        {/* Frame time */}
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--sub)" }}>
          {frame ? <span>{frame.Description}</span> : "—"}
        </span>

        {/* Speed + Mode inline */}
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--sub)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {speed && typeof speed["Decimal Value"] === "number" && speed["Decimal Value"] <= 400
            ? <span style={{ color: "var(--amber)", fontWeight: 600 }}>{speed["Decimal Value"]} kmph</span>
            : null}
          {mode && <span style={{ color: "var(--sub)", marginLeft: 6, fontSize: 10 }}>{mode.Description}</span>}
        </span>

        {/* Emergency / CRC badge */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          {emergActive && (
            <span className="badge" style={{ background: "rgba(239,68,68,0.15)", color: "var(--red)", border: "1px solid #ef444444" }}>
              ⚠ {emerg.Description?.slice(0, 12) || "EMRG"}
            </span>
          )}
          {crc && (
            <span className="badge" style={{
              background: crc.match === true ? "rgba(16,185,129,0.12)" : crc.match === false ? "rgba(239,68,68,0.12)" : "transparent",
              color: crc.match === true ? "var(--green)" : crc.match === false ? "var(--red)" : "var(--muted)",
              border: `1px solid ${crc.match === true ? "#10b98144" : crc.match === false ? "#ef444444" : "var(--border)"}`,
            }}>
              {crc.match === true ? "✓CRC" : crc.match === false ? "✗CRC" : "CRC?"}
            </span>
          )}
        </div>

        {/* Source + bits */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span className="badge" style={{ background: `${srcColor}15`, color: srcColor, border: `1px solid ${srcColor}33` }}>{pkt.source || "?"}</span>
          <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{pkt.total_bits}b</span>
        </div>

        {/* Expand toggle */}
        <button className="expand-btn" onClick={e => { e.stopPropagation(); setExpanded(x => !x) }}
          style={{ justifySelf: "end" }}>
          {expanded ? "▲" : `▼ ${fieldCount}`}
        </button>
      </div>

      {/* ── Expanded fields ── */}
      {expanded && <ExpandedFields fields={fields} isLight={isLight} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   LIVE FEED APP
══════════════════════════════════════════════════════════════ */
const WS_URL = "ws://localhost:8000/ws/live";
const INGEST_URL = "http://localhost:8000/ingest";

export default function LiveFeed() {
  const [isLight, setIsLight] = useState(() => localStorage.getItem("kavach-theme") === "light");
  const [packets, setPackets] = useState([]);
  const [wsState, setWsState] = useState("connecting"); // connecting | open | closed | error
  const [newIds, setNewIds] = useState(new Set());
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState(null);
  const [filterType, setFilterType] = useState("all");
  const [filterEmerg, setFilterEmerg] = useState(false);
  const [maxRows, setMaxRows] = useState(200);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showIngestPanel, setShowIngestPanel] = useState(false);
  const [ingestJson, setIngestJson] = useState("");
  const [ingestSource, setIngestSource] = useState("external");
  const [ingestStatus, setIngestStatus] = useState(null);

  const wsRef = useRef(null);
  const bottomRef = useRef(null);
  const pauseBuffer = useRef([]);
  const containerRef = useRef(null);

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle("light", isLight);
    localStorage.setItem("kavach-theme", isLight ? "light" : "dark");
  }, [isLight]);

  const addPackets = useCallback((newPkts, isHistory = false) => {
    if (paused && !isHistory) {
      pauseBuffer.current.push(...newPkts);
      return;
    }
    const ids = new Set(newPkts.map(p => p.packet_index));
    setPackets(prev => {
      const combined = [...prev, ...newPkts];
      return combined.slice(-maxRows);
    });
    if (!isHistory) {
      setNewIds(ids);
      setTimeout(() => setNewIds(new Set()), 1500);
    }
  }, [paused, maxRows]);

  // WebSocket connection
  useEffect(() => {
    let ws;
    let reconnectTimer;
    let disposed = false;               // a closed-on-cleanup socket must not reconnect (no leaked duplicate sockets)

    const connect = () => {
      if (disposed) return;
      setWsState("connecting");
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setWsState("open");

      ws.onmessage = (evt) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "packet") addPackets([msg.data], false);
          if (msg.type === "history") addPackets([msg.data], true);
          if (msg.type === "history_batch" && Array.isArray(msg.data)) addPackets(msg.data, true);
          if (msg.type === "heartbeat") setStats(msg.data);
          if (msg.type === "connected") setStats(msg.data);
          if (msg.type === "session_cleared") { setPackets([]); setStats(null); }
        } catch (_) { }
      };

      ws.onerror = () => setWsState("error");
      ws.onclose = () => {
        if (disposed) return;
        setWsState("closed");
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => { disposed = true; clearTimeout(reconnectTimer); ws?.close(); };
  }, [addPackets]);

  // Resume from pause
  const resume = () => {
    setPaused(false);
    if (pauseBuffer.current.length > 0) {
      addPackets(pauseBuffer.current, false);
      pauseBuffer.current = [];
    }
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && bottomRef.current && !paused) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [packets, autoScroll, paused]);

  // Filtered packets
  const filtered = useMemo(() => {
    return packets.filter(p => {
      if (filterType !== "all" && String(p.packet_type_value) !== filterType) return false;
      if (filterEmerg) {
        const emg = (p.fields || []).find(f => (f.Field || "").trim() === "EMERGENCY_STATUS" || (f.Field || "").trim() === "GEN_SOS_CALL");
        if (!emg || emg["Decimal Value"] === 0) return false;
      }
      return true;
    });
  }, [packets, filterType, filterEmerg]);

  // Send via /ingest
  const sendIngest = async () => {
    if (!ingestJson.trim()) return;
    try {
      // Parse flexible JSON
      let data;
      const t = ingestJson.trim();
      try { data = JSON.parse(t); }
      catch { data = JSON.parse("[" + t.replace(/\}\s*\{/g, "},{").replace(/^\[?/, "[").replace(/\]?$/, "]") + "]"); }
      const pkt_list = Array.isArray(data) ? data : [data];

      const res = await fetch(INGEST_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packets: pkt_list, source: ingestSource }),
      });
      const json = await res.json();
      setIngestStatus({ ok: true, msg: `✓ Ingested ${json.ingested} packet(s)` });
      setTimeout(() => setIngestStatus(null), 3000);
    } catch (e) {
      setIngestStatus({ ok: false, msg: `✗ ${e.message}` });
    }
  };

  // Clear session
  const clearSession = async () => {
    await fetch("http://localhost:8000/live/clear", { method: "POST" }).catch(() => { });
    setPackets([]); setStats(null); pauseBuffer.current = [];
  };

  const statusColor = { connecting: "#f59e0b", open: "#10b981", closed: "#ef4444", error: "#ef4444" }[wsState];
  const statusLabel = { connecting: "CONNECTING", open: "LIVE", closed: "RECONNECTING…", error: "ERROR" }[wsState];

  return (
    <>
      <style>{LIVE_CSS}</style>

      <div style={{
        display: "grid",
        gridTemplateRows: "50px 1fr",
        height: "100vh", width: "100vw", overflow: "hidden",
      }}>

        {/* ══ TOP BAR ══ */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "0 14px",
          background: "#0a0a10", borderBottom: "1px solid #1a1a28", zIndex: 10,
        }}>
          {/* Back link */}
          <a href="/" style={{
            fontSize: 11, color: "var(--sub)", fontFamily: "var(--font-mono)",
            textDecoration: "none", padding: "3px 8px", borderRadius: 4,
            border: "1px solid var(--border)", background: "var(--raised)",
          }} onMouseEnter={e => e.target.style.color = "var(--amber)"}
            onMouseLeave={e => e.target.style.color = "var(--sub)"}>
            ← DECODER
          </a>

          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, paddingLeft: 8, borderLeft: "1px solid #1e1e30" }}>
            <div style={{ width: 24, height: 24, borderRadius: 5, background: "linear-gradient(135deg,#ef4444,#f97316)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0, boxShadow: "0 0 8px rgba(239,68,68,0.4)" }}>📡</div>
            <div>
              <div style={{ fontFamily: "var(--font-disp)", fontSize: 15, letterSpacing: "0.12em", color: "#ef4444", lineHeight: 1 }}>LIVE FEED</div>
              <div style={{ fontSize: 8, color: "#8090b0", fontFamily: "var(--font-mono)", lineHeight: 1, marginTop: 1 }}>KAVACH RADIO PACKETS · REAL-TIME STREAM</div>
            </div>
          </div>

          {/* WS Status */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 5, background: `${statusColor}15`, border: `1px solid ${statusColor}44`, marginLeft: 8 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%", background: statusColor,
              animation: wsState === "connecting" || wsState === "closed" ? "pulse 1s infinite" : "none"
            }} />
            <span style={{ fontSize: 10, color: statusColor, fontFamily: "var(--font-mono)", fontWeight: 700 }}>{statusLabel}</span>
            {wsState === "open" && stats && (
              <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "var(--font-mono)", marginLeft: 4 }}>
                {stats.subscribers || stats.total_packets || ""} {stats.subscribers ? "subs" : "pkts"}
              </span>
            )}
          </div>

          {/* Packet count */}
          <div style={{ padding: "3px 10px", borderRadius: 5, background: "var(--raised)", border: "1px solid var(--border)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
            <span style={{ color: "var(--muted)" }}>TOTAL </span>
            <span style={{ color: "var(--amber)", fontWeight: 700 }}>{packets.length}</span>
            {filtered.length !== packets.length && <span style={{ color: "var(--muted)", fontSize: 9 }}> / {filtered.length} shown</span>}
          </div>

          {/* Filter by type */}
          <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{
            padding: "3px 8px", borderRadius: 5, background: "var(--raised)", border: "1px solid var(--border)",
            color: "var(--text)", fontSize: 11, fontFamily: "var(--font-mono)", outline: "none",
          }}>
            <option value="all">All types</option>
            {Object.entries(PKT_META).map(([k, m]) => (
              <option key={k} value={k}>{m.short} {m.name}</option>
            ))}
          </select>

          {/* Emergency filter */}
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--sub)", fontFamily: "var(--font-mono)", cursor: "pointer" }}>
            <input type="checkbox" checked={filterEmerg} onChange={e => setFilterEmerg(e.target.checked)} style={{ accentColor: "var(--red)" }} />
            🚨 emergencies only
          </label>

          {/* Auto-scroll toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--sub)", fontFamily: "var(--font-mono)", cursor: "pointer" }}>
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} style={{ accentColor: "var(--amber)" }} />
            auto-scroll
          </label>

          {/* Right buttons */}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {/* Ingest panel toggle */}
            <button onClick={() => setShowIngestPanel(p => !p)} style={{
              padding: "4px 11px", borderRadius: 5, fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
              border: `1px solid ${showIngestPanel ? "var(--cyan)" : "var(--border)"}`,
              background: showIngestPanel ? "rgba(6,182,212,0.1)" : "var(--raised)",
              color: showIngestPanel ? "var(--cyan)" : "var(--sub)",
            }}>↑ INGEST</button>

            {/* Pause / Resume */}
            <button onClick={() => paused ? resume() : setPaused(true)} style={{
              padding: "4px 11px", borderRadius: 5, fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 700,
              border: `1px solid ${paused ? "var(--amber)" : "var(--border)"}`,
              background: paused ? "var(--amber-g)" : "var(--raised)",
              color: paused ? "var(--amber)" : "var(--sub)",
            }}>
              {paused ? `▶ RESUME (${pauseBuffer.current.length})` : "⏸ PAUSE"}
            </button>

            {/* Clear */}
            <button onClick={clearSession} style={{
              padding: "4px 11px", borderRadius: 5, fontSize: 10, fontFamily: "var(--font-mono)",
              border: "1px solid var(--border)", background: "var(--raised)", color: "var(--muted)",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--red)"; e.currentTarget.style.color = "var(--red)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--muted)"; }}
            >✕ CLEAR</button>

            {/* Theme */}
            <button onClick={() => setIsLight(l => !l)} style={{
              padding: "4px 8px", borderRadius: 5, fontSize: 14,
              border: "1px solid var(--border)", background: "var(--raised)",
            }}>{isLight ? "🌙" : "☀️"}</button>
          </div>
        </div>

        {/* ══ MAIN AREA ══ */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>

          {/* ── Ingest Panel ── */}
          {showIngestPanel && (
            <div style={{
              background: "var(--surface)", borderBottom: "2px solid rgba(6,182,212,0.3)",
              display: "grid", gridTemplateColumns: "1fr 200px", gap: 0, flexShrink: 0,
              maxHeight: 160, overflow: "hidden",
            }}>
              <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>
                <div style={{ padding: "4px 12px", background: "var(--raised)", borderBottom: "1px solid var(--border)", fontSize: 9, color: "var(--muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
                  ▶ MANUAL INGEST — paste JSON and POST to /ingest
                </div>
                <textarea value={ingestJson} onChange={e => setIngestJson(e.target.value)}
                  onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") sendIngest(); }}
                  placeholder={'[{"activeRadio":"0xF1","messagePayload":"D3900C10..."}]'}
                  style={{
                    flex: 1, padding: "8px 12px", background: "transparent", border: "none", outline: "none",
                    color: "var(--code)", fontFamily: "var(--font-mono)", fontSize: 10, resize: "none", lineHeight: 1.6,
                    caretColor: "var(--cyan)",
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
                <select value={ingestSource} onChange={e => setIngestSource(e.target.value)} style={{
                  padding: "4px 8px", borderRadius: 5, background: "var(--raised)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 11, fontFamily: "var(--font-mono)", outline: "none",
                }}>
                  <option value="external">external</option>
                  <option value="manual-ui">manual-ui</option>
                  <option value="mqtt">mqtt</option>
                  <option value="websocket">websocket</option>
                </select>
                <button onClick={sendIngest} style={{
                  padding: "6px 0", borderRadius: 5, border: "none",
                  background: "linear-gradient(135deg,var(--cyan),#0891b2)",
                  color: "#000", fontWeight: 700, fontSize: 11, fontFamily: "var(--font-mono)",
                  letterSpacing: "0.06em", cursor: "pointer",
                }}>⚡ SEND</button>
                {ingestStatus && (
                  <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: ingestStatus.ok ? "var(--green)" : "var(--red)", padding: "3px 0" }}>{ingestStatus.msg}</div>
                )}
                <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>
                  Ctrl+Enter to send<br />
                  External tool: POST /ingest
                </div>
              </div>
            </div>
          )}

          {/* ── Column headers ── */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "44px 90px 80px 1fr 1fr 1fr 90px 64px 52px",
            gap: "0 8px", padding: "4px 12px",
            background: "var(--raised)", borderBottom: "2px solid var(--border-b)",
            fontSize: 9, color: "var(--muted)", fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0,
          }}>
            <span>#</span><span>TIME</span><span>TYPE</span>
            <span>LOCO / STN</span><span>FRAME</span><span>SPEED · MODE</span>
            <span>ALERTS</span><span>SOURCE</span><span>EXP</span>
          </div>

          {/* ── Packet feed ── */}
          <div ref={containerRef} style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}
            onScroll={e => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              if (!atBottom && autoScroll) setAutoScroll(false);
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                <span className={wsState === "open" ? "pulse" : ""} style={{ fontSize: 36 }}>📡</span>
                <span style={{ fontSize: 13 }}>{wsState === "open" ? "Waiting for packets…" : "Connecting to ws://localhost:8000/ws/live"}</span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>
                  External tool: <span style={{ color: "var(--cyan)" }}>POST http://localhost:8000/ingest</span>
                </span>
              </div>
            ) : (
              filtered.map((pkt, i) => (
                <FeedRow
                  key={pkt.packet_index || i}
                  pkt={pkt}
                  idx={i}
                  isNew={newIds.has(pkt.packet_index)}
                  isLight={isLight}
                />
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* ── Status footer ── */}
          <div style={{
            borderTop: "1px solid var(--border)", padding: "4px 14px",
            display: "flex", gap: 16, fontSize: 9,
            color: "var(--muted)", fontFamily: "var(--font-mono)", flexShrink: 0,
            background: "var(--surface)",
          }}>
            <span>WS: <span style={{ color: statusColor }}>{WS_URL}</span></span>
            <span>INGEST: <span style={{ color: "var(--cyan)" }}>POST {INGEST_URL}</span></span>
            <span>BUFFER: <span style={{ color: "var(--amber)" }}>{maxRows} rows max</span></span>
            {paused && <span style={{ color: "var(--amber)", fontWeight: 700 }}>⏸ PAUSED — {pauseBuffer.current.length} buffered</span>}
            <span style={{ marginLeft: "auto" }}>RDSO/SPN/196/2020 Annexure-C · KAVACH Live Feed v3.0</span>
          </div>
        </div>
      </div>
    </>
  );
}