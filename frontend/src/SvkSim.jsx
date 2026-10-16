/**
 * SvkSim.jsx  —  SVK SIM Tab  (Redesigned UI · HTTP socket transmission)
 * Powered by svk_sim.c (C shared library) via Python/FastAPI backend.
 *
 * Three functional panels (left sidebar):
 *  ① Load Station XML       → POST /svk/parse_station
 *  ② Load StoryBoard CSV    → POST /svk/encode_storyboard_csv
 *                           → POST /svk/transmit_storyboard_csv  (HTTP transmit)
 *                           → POST /svk/transmit_stop            (abort transmit)
 *
 * TX DISPLAY: When transmitting, a full-screen animated panel overlays the
 * center area showing per-frame packet dispatch with 2-second countdown,
 * timestamps, packet type badges, byte counts, and a live hex ticker.
 *
 * DOCUMENT REFERENCE: RDSO/SPN/196/2020 Annexure-C (Amendment-10)
 * SAFETY NOTE       : SIL-4 – do not modify packet encoding logic here;
 *                     all encoding is done exclusively in svk_sim.c.
 *
 * FIXES vs original:
 *  • rawCsv is lifted to SvkSim state so CsvEncodeResults can decode fields
 *  • svk_sim_bridge.py wrappers for encode/transmit are documented (see bridge file)
 *  • TX display: new TxMissionControl component – full center-screen animated panel
 *  • Per-frame 2s countdown with animated progress arc
 *  • Live packet log scrolling during transmission
 *  • Frame epoch timestamps (wall-clock) shown per packet
 *  • Future: RX panel slot reserved below TX log (rxPackets state)
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import LiveTrackProfile from "./LiveTrackProfile";
import { svkSettingsStore, svkSessionStore, tagTableStore, useStore } from "./SettingsAbout";

/* ═══════════════════════════════════════════════════════════════════════════
 * GLOBAL STYLES
 * ═══════════════════════════════════════════════════════════════════════════ */

const GLOBAL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;600;700;900&family=Rajdhani:wght@400;500;600;700&display=swap');

  :root {
    --bg-void:        #020806;
    --bg-base:        #060f0a;
    --bg-surface:     #091410;
    --bg-raised:      #0d1e17;
    --bg-input:       #071209;
    --bg-card:        #0a1910;

    --border:         #1a3028;
    --border-bright:  #244838;
    --border-glow:    #2d6048;

    --amber:          #f5a623;
    --amber-dim:      #b87a1a;
    --amber-glow:     rgba(245,166,35,0.10);
    --amber-text:     #f5c060;

    --green:          #00ff88;
    --green-dim:      #00cc66;
    --green-glow:     rgba(0,255,136,0.08);
    --green-deep:     #00aa55;

    --cyan:           #00e5ff;
    --cyan-dim:       #00b8d4;
    --cyan-glow:      rgba(0,229,255,0.08);

    --red:            #ff3d5a;
    --red-glow:       rgba(255,61,90,0.10);

    --purple:         #b060ff;
    --purple-glow:    rgba(176,96,255,0.08);

    --orange:         #ff6b00;
    --orange-glow:    rgba(255,107,0,0.10);

    --text-primary:   #c8f0dc;
    --text-secondary: #7ab896;
    --text-muted:     #3d7a5e;
    --text-dim:       #25503c;
    --text-code:      #6effc0;
    --text-value:     #a0e8c4;

    --section-bg:     #0b1a14;
    --section-text:   #5a9c78;
    --th-bg:          #0a1810;
    --row-alt:        rgba(0,255,136,0.02);
    --shadow:         rgba(0,255,136,0.06);

    --empty-border:   #1a3028;
    --empty-bg:       rgba(0,255,136,0.03);
    --footer-bg:      #060f0a;

    --font-mono:      'Share Tech Mono', monospace;
    --font-display:   'Orbitron', monospace;
    --font-body:      'Rajdhani', sans-serif;
  }

  /* Panel surfaces that used to be hard-coded dark — now theme-aware. */
  :root {
    --card-shadow:       0 0 24px rgba(0,0,0,0.6);
    --panel-head-bg:     linear-gradient(180deg,#0a1910,#060f0a);
    --sheet-inset:       inset 0 0 24px rgba(0,0,0,0.35);
    --sheet-head-bg:     #0c1d16;
    --sheet-head-key-bg: #0f231b;
    --sheet-key-bg-a:    #091511;
    --sheet-key-bg-b:    #0c1b15;
    --sheet-key-shadow:  3px 0 8px rgba(0,0,0,0.4);
    --sheet-zebra:       rgba(255,255,255,0.028);
    --sheet-line:        rgba(255,255,255,0.045);
    --sheet-line-v:      rgba(255,255,255,0.03);
    --sheet-hover:       rgba(0,229,255,0.07);
    --sheet-key-hover:   #0f2a22;
    --scroll-thumb:      #1f3b31;
    --scroll-thumb-hover:#2c5a4a;
  }
  :root.light {
    --card-shadow:       0 2px 10px rgba(15,23,42,0.08);
    --panel-head-bg:     linear-gradient(180deg,#ffffff,#f2f4f9);
    --sheet-inset:       none;
    --sheet-head-bg:     #eef2f8;
    --sheet-head-key-bg: #e5ebf4;
    --sheet-key-bg-a:    #f6f8fc;
    --sheet-key-bg-b:    #eef2f8;
    --sheet-key-shadow:  2px 0 6px rgba(15,23,42,0.08);
    --sheet-zebra:       rgba(15,23,42,0.028);
    --sheet-line:        rgba(15,23,42,0.07);
    --sheet-line-v:      rgba(15,23,42,0.05);
    --sheet-hover:       rgba(2,132,199,0.08);
    --sheet-key-hover:   #dde8f4;
    --scroll-thumb:      #c3c8da;
    --scroll-thumb-hover:#a6aec6;
  }

  /* Light theme for the colour names only SvkSim defines (the shared ones —
     --bg-base, --text-primary, --green … — come from App.jsx LIGHT_THEME). */
  :root.light {
    --bg-card:      #ffffff;
    --border-glow:  #b9c3dc;
    --green-dim:    #047857;
    --green-glow:   rgba(5,150,105,0.08);
    --green-deep:   #059669;
    --cyan-dim:     #0369a1;
    --cyan-glow:    rgba(2,132,199,0.08);
    --red-glow:     rgba(220,38,38,0.08);
    --purple-glow:  rgba(124,58,237,0.08);
    --orange-glow:  rgba(234,88,12,0.08);
  }

  * { box-sizing: border-box; }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg-void); }
  ::-webkit-scrollbar-thumb { background: var(--border-glow); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--green-deep); }
  * { scrollbar-width: thin; scrollbar-color: var(--border-glow) var(--bg-void); }

  @keyframes fade-up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0);   }
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; box-shadow: 0 0 6px currentColor; }
    50%       { opacity: 0.4; box-shadow: 0 0 2px currentColor; }
  }
  @keyframes glow-pulse {
    0%, 100% { opacity: 0.6; }
    50%       { opacity: 1; }
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes data-stream {
    0%   { transform: translateX(-100%); opacity: 0; }
    20%  { opacity: 1; }
    80%  { opacity: 1; }
    100% { transform: translateX(300%); opacity: 0; }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }
  @keyframes row-reveal {
    from { opacity: 0; transform: translateX(-6px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes slide-in-left {
    from { opacity: 0; transform: translateX(-16px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes tx-countdown {
    from { stroke-dashoffset: 0; }
    to   { stroke-dashoffset: 283; }
  }
  @keyframes tx-packet-drop {
    from { opacity: 0; transform: translateY(-12px) scale(0.95); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes scanline-sweep {
    0%   { top: -4px; }
    100% { top: 100%; }
  }
  @keyframes hex-ticker {
    0%   { opacity: 0; letter-spacing: 0.3em; }
    30%  { opacity: 1; }
    70%  { opacity: 1; }
    100% { opacity: 0; letter-spacing: 0.05em; }
  }
  @keyframes frame-burst {
    0%   { box-shadow: 0 0 0px var(--orange); }
    30%  { box-shadow: 0 0 24px var(--orange), 0 0 8px var(--orange) inset; }
    100% { box-shadow: 0 0 4px var(--orange); }
  }
  @keyframes counter-tick {
    0%   { transform: translateY(0); opacity: 1; }
    45%  { transform: translateY(-8px); opacity: 0; }
    55%  { transform: translateY(8px); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
  }
  @keyframes progress-bar {
    from { width: 100%; }
    to   { width: 0%; }
  }
  @keyframes rx-flash {
    0%   { background: rgba(0,229,255,0.18); }
    100% { background: transparent; }
  }
  @keyframes serial-rx-drop {
    from { opacity: 0; transform: translateX(10px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  .serial-tx-row { animation: tx-packet-drop 0.18s ease both; }
  .serial-tx-row:nth-child(even) { background: rgba(176,96,255,0.018); }
  .serial-rx-row { animation: serial-rx-drop 0.18s ease both; }

  .drop-zone:hover {
    border-color: var(--green-dim) !important;
    background: rgba(0,255,136,0.04) !important;
  }
  .data-row:hover { background: rgba(0,255,136,0.04) !important; }
  .svk-btn:hover:not(:disabled) {
    filter: brightness(1.15);
    transform: translateY(-1px);
  }
  .svk-btn:active:not(:disabled) { transform: translateY(0); }
  .svk-btn { transition: all 0.15s ease; }
  .acc-row:hover { background: rgba(0,255,136,0.035) !important; }

  /* TX Mission Control */
  .tx-log-row {
    animation: tx-packet-drop 0.22s ease both;
  }
  .tx-log-row:nth-child(even) { background: rgba(0,255,136,0.018); }

  /* ── Guardian 400 hardware panel — LED activity ── */
  @keyframes led-hw-flash-green {
    0%   { background: #eafff5; box-shadow: 0 0 6px 2px #ffffff, 0 0 22px 8px var(--green), 0 0 40px 14px rgba(0,255,136,0.65); }
    12%  { background: #eafff5; box-shadow: 0 0 6px 2px #ffffff, 0 0 22px 8px var(--green), 0 0 40px 14px rgba(0,255,136,0.65); }
    100% { background: #0d2a1c; box-shadow: 0 0 3px 0 rgba(0,255,136,0.15) inset; }
  }
  @keyframes led-hw-flash-red {
    0%   { background: #fff0f2; box-shadow: 0 0 6px 2px #ffffff, 0 0 22px 8px var(--red), 0 0 40px 14px rgba(255,61,90,0.65); }
    12%  { background: #fff0f2; box-shadow: 0 0 6px 2px #ffffff, 0 0 22px 8px var(--red), 0 0 40px 14px rgba(255,61,90,0.65); }
    100% { background: #340a10; box-shadow: 0 0 3px 0 rgba(255,61,90,0.15) inset; }
  }
  @keyframes led-hw-flash-amber {
    0%   { background: #fff8e8; box-shadow: 0 0 6px 2px #ffffff, 0 0 18px 6px var(--amber), 0 0 32px 10px rgba(245,166,35,0.6); }
    12%  { background: #fff8e8; box-shadow: 0 0 6px 2px #ffffff, 0 0 18px 6px var(--amber), 0 0 32px 10px rgba(245,166,35,0.6); }
    100% { background: #2e2007; box-shadow: 0 0 3px 0 rgba(245,166,35,0.12) inset; }
  }
  .hw-led-flash-green { animation: led-hw-flash-green 0.9s cubic-bezier(0.16,0.9,0.3,1) both; }
  .hw-led-flash-red    { animation: led-hw-flash-red   0.9s cubic-bezier(0.16,0.9,0.3,1) both; }
  .hw-led-flash-amber  { animation: led-hw-flash-amber 0.9s cubic-bezier(0.16,0.9,0.3,1) both; }
  @keyframes led-hw-breathe {
    0%, 100% { opacity: 0.55; }
    50%       { opacity: 1; }
  }
  @keyframes hw-eq-bar {
    0%, 100% { transform: scaleY(0.55); opacity: 0.55; }
    50%       { transform: scaleY(1); opacity: 1; }
  }

  /* ── Loaders drawer ── */
  .svk-topbtn:hover { border-color: var(--cyan-dim) !important; color: var(--cyan) !important; }
  .svk-rail-btn {
    width: 28px; height: 28px; border-radius: 5px; border: 1px solid transparent; background: transparent;
    display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 12px;
    position: relative; transition: all 0.15s; padding: 0;
  }
  .svk-rail-btn:hover { background: var(--bg-raised); border-color: var(--border-bright); }
`;

/* ═══════════════════════════════════════════════════════════════════════════
 * DESIGN TOKENS
 * ═══════════════════════════════════════════════════════════════════════════ */

const ACCENT = {
  amber:  { border: "var(--amber)",  bg: "var(--amber-glow)",   text: "var(--amber-text)" },
  green:  { border: "var(--green)",  bg: "var(--green-glow)",   text: "var(--green)" },
  cyan:   { border: "var(--cyan)",   bg: "var(--cyan-glow)",    text: "var(--cyan)" },
  red:    { border: "var(--red)",    bg: "var(--red-glow)",     text: "var(--red)" },
  purple: { border: "var(--purple)", bg: "var(--purple-glow)",  text: "var(--purple)" },
  orange: { border: "var(--orange)", bg: "var(--orange-glow)",  text: "var(--orange)" },
  muted:  { border: "var(--border)", bg: "transparent",         text: "var(--text-muted)" },
};

/* ═══════════════════════════════════════════════════════════════════════════
 * SHARED ATOMS
 * ═══════════════════════════════════════════════════════════════════════════ */

function Badge({ color = "amber", children }) {
  const c = ACCENT[color] || ACCENT.muted;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 3,
      fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 700,
      letterSpacing: "0.06em",
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      textTransform: "uppercase",
    }}>{children}</span>
  );
}

function StatusDot({ color = "green", pulse = false }) {
  return (
    <span style={{
      display: "inline-block", width: 7, height: 7, borderRadius: "50%",
      background: `var(--${color})`, color: `var(--${color})`,
      boxShadow: `0 0 6px var(--${color})`,
      animation: pulse ? "pulse-dot 1.2s ease-in-out infinite" : "none",
      flexShrink: 0,
    }} />
  );
}

function Spinner({ size = 14, color = "var(--green)" }) {
  return (
    <span style={{
      display: "inline-block", width: size, height: size,
      border: `2px solid transparent`,
      borderTopColor: color, borderRightColor: color,
      borderRadius: "50%",
      animation: "spin 0.7s linear infinite",
      flexShrink: 0,
    }} />
  );
}

function SectionHeader({ icon, title, count, color = "green" }) {
  const c = ACCENT[color] || ACCENT.green;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 14px",
      background: "var(--section-bg)",
      borderBottom: `1px solid ${c.border}33`,
      fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
      color: c.text, letterSpacing: "0.1em", textTransform: "uppercase",
    }}>
      <span style={{ fontSize: 12 }}>{icon}</span>
      <span>{title}</span>
      {count !== undefined && <Badge color={color}>{count}</Badge>}
      <span style={{ marginLeft: "auto", width: 40, height: 1, background: `linear-gradient(90deg, ${c.border}66, transparent)` }} />
    </div>
  );
}

function GlowCard({ children, accentColor = "green", style = {} }) {
  const c = ACCENT[accentColor] || ACCENT.green;
  return (
    <div style={{
      background: "var(--bg-surface)",
      border: `1px solid var(--border)`,
      borderTop: `2px solid ${c.border}`,
      borderRadius: 6, overflow: "hidden",
      boxShadow: `var(--card-shadow), 0 1px 0 ${c.border}44 inset`,
      ...style,
    }}>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && (
        <label style={{
          fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 700,
          color: "var(--text-muted)", letterSpacing: "0.12em", textTransform: "uppercase",
        }}>{label}</label>
      )}
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text", min, max, error, accentColor = "orange" }) {
  const [focused, setFocused] = useState(false);
  const c = ACCENT[accentColor] || ACCENT.orange;
  return (
    <input
      type={type} min={min} max={max}
      value={value} onChange={onChange} placeholder={placeholder}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={{
        background: "var(--bg-input)",
        border: `1px solid ${error ? "var(--red)" : focused ? c.border : "var(--border)"}`,
        borderRadius: 4, color: "var(--text-primary)",
        fontFamily: "var(--font-mono)", fontSize: 11,
        padding: "6px 10px", outline: "none", width: "100%",
        boxShadow: focused ? `0 0 8px ${c.border}33` : "none",
        transition: "all 0.15s",
      }}
    />
  );
}

function ActionButton({ onClick, disabled, loading, children, accentColor = "green", variant = "primary", fullWidth = false }) {
  const c = ACCENT[accentColor] || ACCENT.green;
  const isPrimary = variant === "primary";
  return (
    <button
      className="svk-btn"
      onClick={onClick} disabled={disabled || loading}
      style={{
        width: fullWidth ? "100%" : undefined,
        padding: "8px 16px", borderRadius: 4,
        border: `1px solid ${disabled ? "var(--border)" : c.border}`,
        background: disabled ? "var(--bg-raised)" : isPrimary ? `linear-gradient(135deg, ${c.border}33, ${c.border}11)` : "transparent",
        color: disabled ? "var(--text-dim)" : c.text,
        fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 10,
        letterSpacing: "0.1em", textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : `0 0 16px ${c.border}33, inset 0 1px 0 ${c.border}22`,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}
    >
      {loading && <Spinner size={10} color={c.text} />}
      {children}
    </button>
  );
}

function TxProgressBar({ active }) {
  if (!active) return null;
  return (
    <div style={{ height: 2, background: "var(--bg-raised)", borderRadius: 1, overflow: "hidden" }}>
      <div style={{
        height: "100%", borderRadius: 1,
        background: "linear-gradient(90deg, transparent, var(--orange), var(--red), var(--orange), transparent)",
        backgroundSize: "200% 100%",
        animation: "data-stream 1.4s linear infinite",
        width: "60%",
      }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PACKET TYPE HELPERS
 * ═══════════════════════════════════════════════════════════════════════════ */

const SIG_ASP = {
  0:"Unidentified", 1:"🔴 Red", 2:"🟡 Yellow", 10:"🟡🟡 Dbl Yellow",
  11:"🟢 Green", 14:"AG OFF", 15:"Red + Calling-On", 48:"Stop Board",
};
const DIR_MAP2  = { 0:"Unidentified", 1:"Nominal (DOWN)", 2:"Reverse (UP)", 3:"Reserved" };
const AUTH_MAP  = { 0:"Not used", 1:"OS Authority", 2:"FS Authority", 3:"SR Authority" };
const SOS_MAP   = { 0:"No SoS", 1:"Foreign RFID", 2:"Reserved", 3:"Odo ≥120m",
                    4:"SPAD", 5:"Rear-end", 6:"Head-on", 7:"Shunting violation", 8:"Stn General SoS" };
const SEC_TYPE  = { 0:"Station Sec", 1:"Absolute Block", 2:"Autoblock", 3:"Reserved" };
const LOCO_MODE = { 1:"Stand_By",2:"Staff_Responsible",3:"Limited_Supervision",
                    4:"Full_Supervision",5:"Override",6:"On_Sight",7:"Trip",
                    8:"Post_Trip",9:"Reverse",10:"Shunting",11:"Non_Leading",
                    12:"System_Failure",13:"Isolation" };
const EMRG_MAP  = { 0:"No Emergency",1:"Unusual Stoppage",2:"SoS",3:"Roll Back",
                    4:"Head-On Collision",5:"Rear-End Collision",6:"Parting SoS",7:"Spare" };

function pktColor(pt) { return { 9:"amber", 10:"green", 11:"cyan", 12:"red", 13:"purple" }[pt] || "muted"; }
function pktLabel(pt) {
  return { 9:"STN→OB Regular", 10:"OB→STN Regular", 11:"Access Authority",
           12:"Emergency", 13:"OB Access Req" }[pt] || `PKT ${pt}`;
}
function pktShort(pt) {
  return { 9:"S→OB", 10:"OB→S", 11:"AUTH", 12:"EMRG", 13:"OREQ" }[pt] || `P${pt}`;
}

/**
 * parseCsvCols(line) — parse one storyboard CSV data row.
 *
 * Mirrors svk_sim.c's parse_csv_row()/strtoll() behaviour: a field that
 * doesn't start with a valid integer parses as 0 (matching strtoll, NOT
 * silently dropping the whole row). This matters for CRC-FAIL test rows
 * where the CRC column may intentionally hold non-numeric text — the C
 * encoder still transmits *something* for that row (a numeric column will
 * pass through as-is per resolve_pkt_crc(); non-numeric text parses to 0
 * and auto-generates a valid CRC, same as a real "0" entry) — so the UI
 * must decode the row too, not blank it out.
 */
function parseCsvCols(line) {
  if (!line || line.trim().startsWith("#") || !line.trim()) return null;
  const parts = line.trim().split(",").map(s => {
    const n = parseInt(s.trim(), 10);
    return isNaN(n) ? 0 : n;   // strtoll-style: non-numeric → 0
  });
  if (parts.length === 10) {
    // 10-column compact Additional Emergency Packet storyboard (PKT_TYPE 12)
    // Header: TDMASlot,PKT_TYPE,PKT_LENGTH,FRAME_NUM,SOURCE_STN_ILC_IBS_ID,
    //         SOURCE_STN_ILC_IBS_VERSION,STN_ILC_IBS_LOC,GEN_SOS_CALL,
    //         Padding bits,PKT_CRC
    // Mirrors svk_sim.c's remap_10col_addemer_to_35col(): STN_ILC_IBS_LOC has
    // no canonical slot, so it's placed at v[35] here too (kept out of the
    // last-two-columns range so cbcMacCol()/crcCol() below still resolve
    // correctly off array length).
    const v = new Array(35).fill(0);
    v[0]  = parts[0];  // TDMASlot
    v[1]  = parts[1];  // PKT_TYPE
    v[2]  = parts[2];  // PKT_LENGTH
    v[3]  = parts[3];  // FRAME_NUM
    v[4]  = parts[4];  // SOURCE_STN_ILC_IBS_ID
    v[5]  = parts[5];  // SOURCE_STN_ILC_IBS_VERSION
    v[14] = parts[7];  // GEN_SOS_CALL
    v[33] = 0;         // no CBC-MAC for PKT_TYPE 12
    v[34] = parts[9];  // PKT_CRC
    v.stnIlcIbsLoc = parts[6]; // STN_ILC_IBS_LOC (extension — no v[] slot)
    return v;
  }
  if (parts.length < 35) return null;
  return parts;
}

/** Index of the CBCMAC / CRC columns within a parsed row — always the last
 *  two columns, regardless of how many ROUTE columns (2, 4, or more) sit
 *  in between. Anchoring to a fixed index 33/34 breaks the moment a
 *  storyboard export adds extra route columns (see svk_sim.c parse_csv_row
 *  fix), silently reading an always-zero field instead of the real CRC. */
function cbcMacCol(cols) { return cols[cols.length - 2]; }
function crcCol(cols)    { return cols[cols.length - 1]; }

/* ═══════════════════════════════════════════════════════════════════════════
 * CRC-32 VERIFICATION
 * ─────────────────────────────────────────────────────────────────────────
 * Reference: calculate_crc32_ieee() (python3.py) — reflected CRC-32/IEEE
 * 802.3, table-driven, Init = 0x00000000, Final XOR = 0x00000000 (NOT the
 * zlib/PKZIP variant). Byte-for-byte identical to crc32_calc() in
 * svk_sim.c §4B, so a packet this verifies as PASS/FAIL will match the
 * decode-side "LOG / CRC VERIFY" checker exactly.
 *
 * Packet layout (svk_sim.c, all 5 packet types): the last 4 bytes of every
 * encoded packet are PKT_CRC, written MSB-first (bw_write "MSB first").
 * The CRC is computed over everything BEFORE it — payload + CBC_MAC — so
 * verification = crc32(bytes[0 .. len-5]) compared to bytes[len-4 .. len-1]
 * read as one big-endian uint32.
 * ═══════════════════════════════════════════════════════════════════════════ */

let _crc32Table = null;
function getCrc32Table() {
  if (_crc32Table) return _crc32Table;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  _crc32Table = table;
  return table;
}

function crc32Ieee(bytes) {
  const table = getCrc32Table();
  let crc = 0x00000000;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
  return crc >>> 0;
}

function hexToBytes(hexStr) {
  const clean = (hexStr || "").replace(/\s/g, "");
  if (clean.length < 2 || clean.length % 2 !== 0) return null;
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    const b = parseInt(clean.substr(i, 2), 16);
    if (isNaN(b)) return null;
    bytes.push(b);
  }
  return bytes;
}

/**
 * verifyPacketCrc(hexStr) → { status: "pass" | "fail" | "unknown", computed, embedded }
 * Recomputes CRC-32 over all bytes except the trailing 4-byte PKT_CRC field
 * and compares it against the embedded value.
 */
function verifyPacketCrc(hexStr) {
  const bytes = hexToBytes(hexStr);
  if (!bytes || bytes.length < 5) return { status: "unknown", computed: null, embedded: null };
  const payload  = bytes.slice(0, -4);
  const c        = bytes.slice(-4);
  const embedded = ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) >>> 0;
  const computed = crc32Ieee(payload);
  return { status: computed === embedded ? "pass" : "fail", computed, embedded };
}

/** Small pass/fail badge — used across every log/decode view so CRC status
 *  is always computed the same way, in one place. */
function CrcBadge({ hex, compact = false }) {
  const r = useMemo(() => verifyPacketCrc(hex), [hex]);
  if (r.status === "unknown") return null;
  const ok = r.status === "pass";
  const hex8 = v => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  return (
    <span
      title={`computed ${hex8(r.computed)} vs embedded ${hex8(r.embedded)}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap",
        fontSize: compact ? 8 : 9, fontFamily: "var(--font-mono)", fontWeight: 700,
        padding: compact ? "0px 4px" : "1px 6px", borderRadius: 3, letterSpacing: "0.03em",
        color: ok ? "var(--green)" : "var(--red)",
        border: `1px solid ${ok ? "var(--green)" : "var(--red)"}`,
        background: ok ? "rgba(0,255,136,0.08)" : "rgba(255,61,90,0.12)",
      }}
    >
      {ok ? "✓ CRC OK" : "✗ CRC FAIL"}
    </span>
  );
}

function decodePacketFields(cols, pktType) {
  if (!cols) return null;
  const common = [
    { label: "TDMA Slot",        value: cols[0],                           color: "cyan"   },
    { label: "Frame #",          value: cols[3],                           color: "orange" },
    { label: "Pkt Direction",    value: DIR_MAP2[cols[10]] || cols[10],    color: "amber"  },
    { label: "Src Station ID",   value: cols[4]  || "—",                   color: "amber"  },
    { label: "Src Station Ver",  value: cols[5]  || "—",                   color: "text"   },
    { label: "CBC-MAC",          value: `0x${cbcMacCol(cols).toString(16).toUpperCase().padStart(8,"0")}`, color: "purple" },
    { label: "CRC (CSV spec)",   value: `0x${crcCol(cols).toString(16).toUpperCase().padStart(4,"0")}`, color: "purple" },
  ];
  if (pktType === 9) return [...common,
    { label: "Dest Loco ID",   value: cols[6],                           color: "green"  },
    { label: "Ref Profile #",  value: cols[7],                           color: "text"   },
    { label: "Last Ref RFID",  value: `0x${cols[8].toString(16).toUpperCase()}`, color: "text" },
    { label: "Dist Pkt Start", value: `${cols[9]} m`,                    color: "text"   },
    { label: "Sub-Pkt Type",   value: cols[11],                          color: "cyan"   },
    { label: "SoS Type",       value: SOS_MAP[cols[14]] || cols[14],     color: cols[14] > 0 ? "red" : "text" },
    { label: "Section Type",   value: SEC_TYPE[cols[15]] || cols[15],    color: "amber"  },
    { label: "Cur Sig Aspect", value: SIG_ASP[cols[17]] || `Code ${cols[17]}`, color: cols[17]===1?"red":cols[17]===11?"green":"amber" },
    { label: "Nxt Sig Aspect", value: SIG_ASP[cols[18]] || `Code ${cols[18]}`, color: "text"   },
    { label: "Appr Sig Dist",  value: `${cols[19]} m`,                   color: "text"   },
    { label: "Auth Type",      value: AUTH_MAP[cols[20]] || cols[20],    color: "cyan"   },
    { label: "Auth Speed",     value: `${cols[21]} kmph`,                color: "green"  },
    { label: "MA",             value: cols[22],                          color: "green"  },
    { label: "Nxt Stn HO",    value: cols[29],                          color: "amber"  },
    { label: "Nxt Station ID", value: cols[30],                          color: "amber"  },
  ];
  if (pktType === 10) return [...common,
    { label: "Loco ID",        value: cols[6],                           color: "green"  },
    { label: "Loco Mode",      value: LOCO_MODE[cols[11]] || cols[11],   color: "cyan"   },
    { label: "Speed",          value: `${cols[21]} kmph`,                color: "green"  },
    { label: "SoS",            value: SOS_MAP[cols[14]] || cols[14],     color: cols[14]>0?"red":"text" },
    { label: "Cur Sig Aspect", value: SIG_ASP[cols[17]] || `Code ${cols[17]}`, color: cols[17]===1?"red":cols[17]===11?"green":"amber" },
    { label: "Auth Type",      value: AUTH_MAP[cols[20]] || cols[20],    color: "cyan"   },
  ];
  if (pktType === 11) return [...common,
    { label: "Dest Loco ID",  value: cols[6],                            color: "green"  },
    { label: "Auth Type",     value: AUTH_MAP[cols[20]] || cols[20],     color: "cyan"   },
    { label: "Auth Speed",    value: `${cols[21]} kmph`,                 color: "green"  },
    { label: "MA",            value: cols[22],                           color: "green"  },
    { label: "Nxt Stn HO",   value: cols[29],                           color: "amber"  },
    { label: "Nxt Station ID",value: cols[30],                           color: "amber"  },
  ];
  if (pktType === 12) return [
    { label: "TDMA Slot",       value: cols[0],                          color: "cyan"   },
    { label: "Frame #",         value: cols[3],                          color: "orange" },
    { label: "Src Stn/ILC/IBS ID",  value: cols[4]  || "—",              color: "amber"  },
    { label: "Src Stn/ILC/IBS Ver", value: cols[5]  || "—",              color: "text"   },
    { label: "Stn/ILC/IBS Loc", value: `${cols.stnIlcIbsLoc ?? 0} m`,    color: "text"   },
    { label: "Gen SOS Call",    value: cols[14] ? "SOS ACTIVE" : "No SoS", color: cols[14] ? "red" : "text" },
    { label: "CRC (CSV spec)",  value: `0x${crcCol(cols).toString(16).toUpperCase().padStart(4,"0")}`, color: "purple" },
  ];
  if (pktType === 13) return [...common,
    { label: "Loco ID",         value: cols[6],                          color: "green"  },
    { label: "Loco Mode",       value: LOCO_MODE[cols[11]] || cols[11],  color: "cyan"   },
    { label: "Auth Type Req",   value: AUTH_MAP[cols[20]] || cols[20],   color: "cyan"   },
    { label: "Speed",           value: `${cols[21]} kmph`,               color: "green"  },
  ];
  return common;
}

const FIELD_COLOR = {
  cyan: "var(--cyan)", orange: "var(--orange)", amber: "var(--amber-text)",
  green: "var(--green)", red: "var(--red)", purple: "var(--purple)",
  text: "var(--text-primary)", muted: "var(--text-muted)",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * TX MISSION CONTROL — center panel shown during transmission
 *
 * Props:
 *   txLog       : array of { frameNum, tdmaSlot, pktType, byteLen, hex,
 *                             timestamp, locoId, direction }
 *   txState     : "transmitting" | "done" | "stopped" | "error"
 *   txCountdown : seconds remaining in current 2s epoch (0..2)
 *   txFrameNum  : current frame number being dispatched
 *   txTotal     : total packet count expected
 *   txSent      : packets dispatched so far
 *   onStop      : callback
 *   encodedData : full encode result array (for stats)
 * ═══════════════════════════════════════════════════════════════════════════ */

function TxMissionControl({ txLog, txState, txCountdown, txFrameNum, txTotal, txSent, onStop, encodedData }) {
  const logRef  = useRef(null);
  const isLive  = txState === "transmitting";

  /* Auto-scroll log to bottom */
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [txLog.length]);

  /* Frame stats */
  const frameGroups = useMemo(() => {
    const groups = {};
    (encodedData || []).forEach(p => {
      if (!groups[p.frame_num]) groups[p.frame_num] = 0;
      groups[p.frame_num]++;
    });
    return groups;
  }, [encodedData]);
  const totalFrames = Object.keys(frameGroups).length;
  const uniqueFramesSent = useMemo(() => new Set(txLog.map(p => p.frameNum)).size, [txLog]);

  /* SVG arc for countdown ring */
  const RADIUS = 42;
  const CIRC   = 2 * Math.PI * RADIUS;
  const progress = isLive ? (txCountdown / 2) : (txState === "done" ? 1 : 0);
  const dashOffset = CIRC * (1 - progress);

  /* Packet type distribution of log so far */
  const pktDist = useMemo(() => {
    const d = {};
    txLog.forEach(p => { d[p.pktType] = (d[p.pktType] || 0) + 1; });
    return d;
  }, [txLog]);

  const statusColor = isLive ? "var(--orange)"
    : txState === "done"    ? "var(--green)"
    : txState === "stopped" ? "var(--cyan)"
    : "var(--red)";
  const statusLabel = isLive      ? "● TRANSMITTING"
    : txState === "done"    ? "✔ COMPLETE"
    : txState === "stopped" ? "■ STOPPED"
    : "✖ ERROR";

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "var(--bg-base)",
      animation: "fade-in 0.3s ease",
      position: "relative", overflow: "hidden",
    }}>
      {/* Scanline sweep overlay */}
      {isLive && (
        <div style={{
          position: "absolute", left: 0, right: 0, height: 2, zIndex: 10, pointerEvents: "none",
          background: "linear-gradient(transparent, rgba(255,107,0,0.25), transparent)",
          animation: "scanline-sweep 3s linear infinite",
        }} />
      )}

      {/* Grid backdrop */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
        backgroundImage: `
          linear-gradient(rgba(255,107,0,0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,107,0,0.025) 1px, transparent 1px)
        `,
        backgroundSize: "32px 32px",
      }} />

      {/* Top stats strip */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr auto",
        gap: 1, flexShrink: 0, zIndex: 1,
        borderBottom: `1px solid ${isLive ? "var(--orange)" : "var(--border)"}`,
        transition: "border-color 0.3s",
      }}>
        {[
          { label: "STATUS",   value: statusLabel,             color: statusColor, mono: true },
          { label: "PACKETS",  value: `${txSent} / ${txTotal}`, color: "var(--text-primary)" },
          { label: "FRAMES",   value: `${uniqueFramesSent} / ${totalFrames}`, color: "var(--amber-text)" },
          { label: "FRAME #",  value: txFrameNum ?? "—",       color: "var(--orange)" },
        ].map((stat, i) => (
          <div key={i} style={{
            padding: "10px 16px",
            background: "var(--bg-surface)",
            borderRight: "1px solid var(--border)",
          }}>
            <div style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-dim)", letterSpacing: "0.12em", marginBottom: 4 }}>{stat.label}</div>
            <div style={{ fontSize: 15, fontFamily: "var(--font-display)", color: stat.color, fontWeight: 700, letterSpacing: "0.08em" }}>{stat.value}</div>
          </div>
        ))}

        {/* 2-second epoch countdown ring */}
        <div style={{
          padding: "8px 20px", background: "var(--bg-surface)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
        }}>
          <div style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-dim)", letterSpacing: "0.12em" }}>EPOCH</div>
          <svg width={52} height={52} style={{ overflow: "visible" }}>
            {/* Track */}
            <circle cx={26} cy={26} r={RADIUS * 0.81} fill="none" stroke="var(--border)" strokeWidth={3} />
            {/* Progress arc */}
            <circle
              cx={26} cy={26} r={RADIUS * 0.81}
              fill="none"
              stroke={isLive ? "var(--orange)" : "var(--border-glow)"}
              strokeWidth={3}
              strokeDasharray={CIRC * 0.81}
              strokeDashoffset={dashOffset * 0.81}
              strokeLinecap="round"
              transform="rotate(-90 26 26)"
              style={{ transition: "stroke-dashoffset 0.1s linear, stroke 0.3s" }}
            />
            <text x={26} y={30} textAnchor="middle"
              style={{ fontFamily: "var(--font-display)", fontSize: 11, fill: isLive ? "var(--orange)" : "var(--text-dim)", fontWeight: 700 }}>
              {isLive ? `${txCountdown.toFixed(1)}s` : "—"}
            </text>
          </svg>
        </div>
      </div>

      {/* Body: left = live hex stream, right = packet log */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", zIndex: 1 }}>

        {/* LEFT: Live hex stream + pkt type distribution */}
        <div style={{
          width: 240, flexShrink: 0,
          borderRight: "1px solid var(--border)",
          display: "flex", flexDirection: "column",
        }}>
          {/* Hex ticker */}
          <div style={{
            padding: "10px 12px 8px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-surface)",
          }}>
            <div style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-dim)", letterSpacing: "0.12em", marginBottom: 6 }}>▦ LIVE HEX STREAM</div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 9,
              color: "var(--text-code)", lineHeight: 1.7,
              wordBreak: "break-all", letterSpacing: "0.08em",
              height: 80, overflowY: "hidden",
              background: "var(--bg-input)",
              padding: "6px 8px", borderRadius: 4,
              border: "1px solid var(--border)",
            }}>
              {txLog.length > 0 ? (() => {
                const last = txLog[txLog.length - 1];
                const fullHex = last?.otaHex || last?.hex || "";
                const prefixLen = last?.framePrefix ? last.framePrefix.length : 0;
                return (
                  <span key={fullHex} style={{ animation: "hex-ticker 1s ease both" }}>
                    {prefixLen > 0 && (
                      <span style={{ color: "var(--red)", fontWeight: 700 }}>
                        {fullHex.slice(0, prefixLen).match(/.{1,2}/g)?.join(" ")}{" "}
                      </span>
                    )}
                    {fullHex.slice(prefixLen).match(/.{1,2}/g)?.join(" ") || "—"}
                  </span>
                );
              })() : (
                <span style={{ color: "var(--text-dim)" }}>Waiting for first packet…</span>
              )}
            </div>
          </div>

          {/* Pkt type distribution */}
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-raised)" }}>
            <div style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-dim)", letterSpacing: "0.12em", marginBottom: 8 }}>◈ PKT TYPE DIST</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {[9,10,11,12,13].map(pt => {
                const cnt   = pktDist[pt] || 0;
                const total = txSent || 1;
                const pct   = cnt / total;
                const c     = ACCENT[pktColor(pt)] || ACCENT.muted;
                return (
                  <div key={pt} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: c.text, width: 28 }}>P{pt}</span>
                    <div style={{ flex: 1, height: 5, background: "var(--bg-input)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 3,
                        background: c.border,
                        width: `${pct * 100}%`,
                        transition: "width 0.3s ease",
                      }} />
                    </div>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)", width: 20, textAlign: "right" }}>{cnt}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Byte total */}
          <div style={{ padding: "10px 12px", background: "var(--bg-surface)", flex: 1 }}>
            <div style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-dim)", letterSpacing: "0.12em", marginBottom: 4 }}>▤ BYTES DISPATCHED</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--orange)", fontWeight: 700 }}>
              {txLog.reduce((s, p) => s + (p.byteLen || 0), 0)} B
            </div>
            {txLog.length > 0 && (
              <div style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-dim)", marginTop: 4 }}>
                Last: {txLog[txLog.length-1].timestamp}
              </div>
            )}
          </div>

          {/* Stop button */}
          {isLive && (
            <div style={{ padding: "10px" }}>
              <button
                className="svk-btn"
                onClick={onStop}
                style={{
                  width: "100%", padding: "10px 0",
                  border: "1px solid var(--red)", borderRadius: 4,
                  background: "rgba(255,61,90,0.12)", color: "var(--red)",
                  fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
                  letterSpacing: "0.12em", cursor: "pointer",
                  boxShadow: "0 0 16px rgba(255,61,90,0.25)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                <StatusDot color="red" pulse />
                ⏹ STOP TX
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: Packet log */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Log header */}
          <div style={{
            display: "grid", gridTemplateColumns: "50px 60px 80px 80px 1fr 70px 70px",
            padding: "6px 14px", gap: 8,
            background: "var(--th-bg)", borderBottom: "1px solid var(--border)",
            fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700,
            color: "var(--text-dim)", letterSpacing: "0.1em", textTransform: "uppercase",
            flexShrink: 0,
          }}>
            <span>#</span>
            <span>TIME</span>
            <span>FRM·TDMA</span>
            <span>PKT TYPE</span>
            <span>SUMMARY</span>
            <span>DIR</span>
            <span>BYTES</span>
          </div>

          {/* Log rows */}
          <div ref={logRef} style={{ flex: 1, overflowY: "auto" }}>
            {txLog.length === 0 ? (
              <div style={{
                padding: 40, textAlign: "center",
                fontFamily: "var(--font-mono)", fontSize: 10,
                color: "var(--text-dim)",
              }}>
                <div style={{ fontSize: 24, marginBottom: 10, opacity: 0.3 }}>◈</div>
                {isLive ? "Waiting for first frame…" : "No packets logged."}
              </div>
            ) : (
              txLog.map((pkt, idx) => {
                const pc   = pktColor(pkt.pktType);
                const ca   = ACCENT[pc] || ACCENT.muted;
                const dir  = DIR_MAP2[pkt.direction] || "—";
                const cols = pkt.csvCols;
                const sig  = cols ? SIG_ASP[cols[17]] : null;

                return (
                  <div
                    key={idx}
                    className="tx-log-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "50px 60px 80px 80px 1fr 70px 70px",
                      alignItems: "center",
                      padding: "5px 14px", gap: 8,
                      borderBottom: "1px solid var(--border)22",
                      animationDelay: `${Math.min(idx % 10 * 20, 200)}ms`,
                    }}
                  >
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-dim)" }}>
                      {idx + 1}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)" }}>
                      {pkt.timestamp}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}>
                      <span style={{ color: "var(--orange)" }}>{pkt.frameNum}</span>
                      <span style={{ color: "var(--text-dim)" }}>·</span>
                      <span style={{ color: "var(--cyan)" }}>{pkt.tdmaSlot}</span>
                    </span>
                    <span>
                      <Badge color={pc}>{pktShort(pkt.pktType)}</Badge>
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sig ? sig : pktLabel(pkt.pktType)}
                      {pkt.locoId ? <span style={{ color: "var(--text-dim)" }}> · LC{pkt.locoId}</span> : null}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)" }}>
                      {dir.split(" ")[0]}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-primary)", fontWeight: 700, textAlign: "right" }}>
                      {pkt.byteLen}B
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* 2s epoch progress bar */}
          {isLive && (
            <div style={{ height: 3, background: "var(--bg-raised)", flexShrink: 0 }}>
              <div style={{
                height: "100%",
                background: "linear-gradient(90deg, var(--orange), var(--red))",
                animation: "progress-bar 2s linear infinite",
                transformOrigin: "left",
              }} />
            </div>
          )}

          {/* RX RESERVED PANEL — future reception display */}
          {/* When RX packets arrive, render them below the TX log.
              State hook: rxPackets = [] of { timestamp, pktType, hex, srcLocoId, ... }
              Expand this section when reception is implemented. */}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * TRACK PROFILE (APD) XLSX LOADER PANEL
 *
 * Loads the "SKP_Track_TLI_Profile_Hex_Data" workbook (S.No, PSR Data (HEX),
 * Gradient Data (HEX), LC Gate Data (HEX), Turnout Data (HEX), TLI Data
 * (HEX), TCD Data (HEX), …) into the C layer via POST /svk/load_track_profile.
 * Once loaded, every subsequent StoryBoard CSV transmit/encode resolves
 * ROUTE1..ROUTE4 (S.No indices) into that row's §C.4.2 sub-packets and
 * appends them after the MA sub-packet — see encode_pkt9() in svk_sim.c.
 *
 * Binary .xlsx can't be usefully pasted as text, so unlike XmlLoader this
 * is file-only (drag/drop or click-to-browse), sent as multipart/form-data.
 * ═══════════════════════════════════════════════════════════════════════════ */

function XlsxLoader({ label, icon, accentColor, onLoad, loading, status }) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState(null);
  const fileRef = useRef();
  const c = ACCENT[accentColor] || ACCENT.green;

  const pick = (file) => {
    if (!file) return;
    setFileName(file.name);
    onLoad(file);
  };

  return (
    <GlowCard accentColor={accentColor} style={{ flexShrink: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
        background: "var(--bg-raised)", borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: c.text, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
        {loading && <Spinner size={11} color={c.text} />}
        {fileName && <span style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>▸ {fileName}</span>}
      </div>

      <div
        className="drop-zone"
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current.click()}
        style={{
          margin: "8px 10px 5px", borderRadius: 5, cursor: "pointer", textAlign: "center",
          border: `2px dashed ${dragging ? c.border : "var(--border-bright)"}`,
          padding: "10px 12px",
          background: dragging ? c.bg : "var(--bg-input)",
          transition: "all 0.2s", position: "relative", overflow: "hidden",
        }}
      >
        {dragging && <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, ${c.border}22, transparent 70%)`, pointerEvents: "none" }} />}
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; e.target.value = ""; if (f) pick(f); }} />
        <div style={{ fontSize: 20, marginBottom: 4, opacity: 0.7 }}>▤</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 10, fontFamily: "var(--font-mono)" }}>DROP <span style={{ color: c.text }}>.xlsx</span> HERE</div>
        <div style={{ color: "var(--text-dim)", fontSize: 9, marginTop: 2, fontFamily: "var(--font-mono)" }}>or click to browse — S.No, PSR/Gradient/LC/Turnout/TLI/TCD Data (HEX)</div>
      </div>

      {status && (
        <div style={{ padding: "0 10px 10px", fontSize: 9, fontFamily: "var(--font-mono)", color: c.text }}>
          ✓ {status.rows_loaded} profile row{status.rows_loaded === 1 ? "" : "s"} loaded
          {status.rows_skipped > 0 ? ` (${status.rows_skipped} skipped)` : ""}
          {" · table size: "}{status.table_size}
        </div>
      )}
      <TxProgressBar active={loading} />
    </GlowCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * XML LOADER PANEL
 * ═══════════════════════════════════════════════════════════════════════════ */

function XmlLoader({ label, icon, accentColor, onLoad, loading }) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [rawXml,   setRawXml]   = useState("");
  const fileRef = useRef();
  const c = ACCENT[accentColor] || ACCENT.green;

  const readFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => setRawXml(e.target.result);
    reader.readAsText(file);
  };

  return (
    <GlowCard accentColor={accentColor} style={{ flexShrink: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
        background: "var(--bg-raised)", borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: c.text, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
        {loading && <Spinner size={11} color={c.text} />}
        {fileName && <span style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>▸ {fileName}</span>}
      </div>

      <div
        className="drop-zone"
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current.click()}
        style={{
          margin: "8px 10px 5px", borderRadius: 5, cursor: "pointer", textAlign: "center",
          border: `2px dashed ${dragging ? c.border : "var(--border-bright)"}`,
          padding: "10px 12px",
          background: dragging ? c.bg : "var(--bg-input)",
          transition: "all 0.2s", position: "relative", overflow: "hidden",
        }}
      >
        {dragging && <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, ${c.border}22, transparent 70%)`, pointerEvents: "none" }} />}
        <input ref={fileRef} type="file" accept=".xml,.txt" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; e.target.value = ""; if (f) readFile(f); }} />
        <div style={{ fontSize: 20, marginBottom: 4, opacity: 0.7 }}>▤</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 10, fontFamily: "var(--font-mono)" }}>DROP <span style={{ color: c.text }}>.xml</span> HERE</div>
        <div style={{ color: "var(--text-dim)", fontSize: 9, marginTop: 2, fontFamily: "var(--font-mono)" }}>or click to browse</div>
      </div>

      <div style={{ padding: "5px 10px 3px", fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>— OR PASTE XML —</div>
      <PasteArea value={rawXml} onChange={v => { setRawXml(v); setFileName(null); }} placeholder={`<${label.replace(/\s+/g,"")} ...>\n  ...\n</${label.replace(/\s+/g,"")}>`} accentColor={accentColor} minHeight={60} maxHeight={100} />

      <div style={{ padding: "6px 10px 10px" }}>
        <ActionButton onClick={() => rawXml.trim() && onLoad(rawXml)} disabled={loading || !rawXml.trim()} loading={loading} accentColor={accentColor} fullWidth>
          {loading ? "PARSING…" : `⚡ PARSE ${label.toUpperCase()}`}
        </ActionButton>
      </div>
      <TxProgressBar active={loading} />
    </GlowCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * APD (TRACK PROFILE) LOADER — replaces the old "Load Station XML" slot.
 * Uploads an .xlsx/.xlsm Track Profile workbook via multipart/form-data to
 * POST /svk/load_track_profile (main.py parses it with openpyxl and loads
 * it into the C layer's Track Profile table). Unlike XmlLoader this is a
 * binary file upload, not a text paste, so there's no "or paste" textarea.
 * ═══════════════════════════════════════════════════════════════════════════ */
function ApdLoader({ label = "Load APD", icon = "▤", accentColor = "amber", loading, error, loadedInfo, onLoad,
                     kind = "Track Profile", buttonLabel = "LOAD TRACK PROFILE", hint = "Track Profile / APD workbook" }) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [file,     setFile]     = useState(null);
  const fileRef = useRef();
  const prevLoading = useRef(loading);
  const c = ACCENT[accentColor] || ACCENT.green;

  const pickFile = (f) => {
    if (!f) return;
    setFileName(f.name);
    setFile(f);
  };

  /* Once a load finishes successfully, drop the staged selection so the
   * drop-zone flips from "ready to load <file>" to a confirmation showing
   * what's actually loaded into the Track Profile table. On failure, keep
   * the selection staged so the user can just hit Load again. */
  useEffect(() => {
    if (prevLoading.current && !loading && !error) {
      setFile(null);
      setFileName(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    prevLoading.current = loading;
  }, [loading, error]);

  const isPending = !!file;
  const isLoaded  = !isPending && !!loadedInfo;
  const headerFileName = fileName || loadedInfo?.filename || null;

  return (
    <GlowCard accentColor={accentColor} style={{ flexShrink: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
        background: "var(--bg-raised)", borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: c.text, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
        {loading && <Spinner size={11} color={c.text} />}
        {isLoaded && !loading && (
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.06em", color: "var(--green)", background: "var(--green-glow)", border: "1px solid var(--green-deep)", borderRadius: 3, padding: "1px 5px" }}>✓ LOADED</span>
        )}
        {headerFileName && <span style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>▸ {headerFileName}</span>}
      </div>

      <div
        className="drop-zone"
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current.click()}
        style={{
          margin: "8px 10px 5px", borderRadius: 5, cursor: "pointer", textAlign: "center",
          border: `2px dashed ${dragging ? c.border : (isLoaded ? "var(--green-deep)" : "var(--border-bright)")}`,
          padding: "10px 12px",
          background: dragging ? c.bg : (isLoaded ? "var(--green-glow)" : "var(--bg-input)"),
          transition: "all 0.2s", position: "relative", overflow: "hidden",
        }}
      >
        {dragging && <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, ${c.border}22, transparent 70%)`, pointerEvents: "none" }} />}
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; e.target.value = ""; if (f) pickFile(f); }} />

        {isPending ? (
          <>
            <div style={{ fontSize: 20, marginBottom: 4, color: c.text }}>▤</div>
            <div style={{ color: c.text, fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</div>
            <div style={{ color: "var(--text-dim)", fontSize: 9, marginTop: 2, fontFamily: "var(--font-mono)" }}>
              {(file.size / 1024).toFixed(1)} KB staged · click <span style={{ color: c.text }}>{buttonLabel}</span> below
            </div>
          </>
        ) : isLoaded ? (
          <>
            <div style={{ fontSize: 20, marginBottom: 4, color: "var(--green)" }}>✓</div>
            <div style={{ color: "var(--green)", fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loadedInfo.filename}</div>
            <div style={{ color: "var(--text-dim)", fontSize: 9, marginTop: 2, fontFamily: "var(--font-mono)" }}>
              {loadedInfo.rows_loaded ?? loadedInfo.table_size ?? 0} row(s) loaded into {kind} table · drop or click to replace
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 20, marginBottom: 4, opacity: 0.7 }}>▤</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 10, fontFamily: "var(--font-mono)" }}>DROP <span style={{ color: c.text }}>.xlsx</span> HERE</div>
            <div style={{ color: "var(--text-dim)", fontSize: 9, marginTop: 2, fontFamily: "var(--font-mono)" }}>{hint} · or click to browse</div>
          </>
        )}
      </div>

      <div style={{ padding: "6px 10px 10px" }}>
        <ActionButton onClick={() => file && onLoad(file)} disabled={loading || !file} loading={loading} accentColor={accentColor} fullWidth>
          {loading ? "LOADING…" : isLoaded ? "⚡ LOAD A DIFFERENT FILE" : `⚡ ${buttonLabel}`}
        </ActionButton>
      </div>
      <TxProgressBar active={loading} />
    </GlowCard>
  );
}

/* ⏸ PAUSE / ▶ RESUME + ⏹ STOP — shown in place of the TRANSMIT button
 * while a transmission is running. Pausing holds at the next frame
 * boundary; RESUME continues from the frame where it stopped (not frame 1). */
function PauseStopButtons({ paused, onPause, onResume, onStop, pauseDisabled = false, stopLabel = "⏹ STOP" }) {
  const base = {
    flex: 1, padding: "10px 0", borderRadius: 4, fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 10,
    letterSpacing: "0.1em", textTransform: "uppercase", display: "flex", alignItems: "center",
    justifyContent: "center", gap: 6, transition: "all 0.2s",
  };
  return (
    <div style={{ display: "flex", gap: 6, width: "100%" }}>
      <button className="svk-btn" onClick={paused ? onResume : onPause} disabled={pauseDisabled}
        title={paused ? "Continue transmitting from the frame where it was paused" : "Pause after the current burst — resume continues from the next frame"}
        style={{ ...base,
          border: `1px solid ${paused ? "var(--green)" : "var(--amber, #f5a623)"}`,
          background: paused ? "linear-gradient(135deg, rgba(0,255,136,0.18), rgba(0,255,136,0.05))" : "rgba(245,166,35,0.12)",
          color: pauseDisabled ? "var(--text-dim)" : paused ? "var(--green)" : "var(--amber, #f5a623)",
          cursor: pauseDisabled ? "not-allowed" : "pointer",
          boxShadow: paused ? "0 0 14px var(--green)33" : "none" }}>
        {paused ? "▶ RESUME" : "⏸ PAUSE"}
      </button>
      <button className="svk-btn" onClick={onStop}
        style={{ ...base, border: "1px solid var(--red)", background: "rgba(255,61,90,0.12)", color: "var(--red)",
          cursor: "pointer", boxShadow: "0 0 14px var(--red)33" }}>
        {!paused && <StatusDot color="red" pulse />}{stopLabel}
      </button>
    </div>
  );
}

function PasteArea({ value, onChange, placeholder, accentColor = "green", minHeight = 70, maxHeight = 160 }) {
  const [focused, setFocused] = useState(false);
  const c = ACCENT[accentColor] || ACCENT.green;
  return (
    <textarea
      value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      spellCheck={false} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={{
        display: "block", margin: "0 10px 6px",
        background: "var(--bg-input)",
        border: `1px solid ${focused ? c.border : "var(--border)"}`,
        borderRadius: 4, color: "var(--text-code)",
        fontFamily: "var(--font-mono)", fontSize: 10, resize: "none",
        height: minHeight, maxHeight, overflowY: "auto",
        padding: "7px 10px", outline: "none", width: "calc(100% - 20px)",
        boxShadow: focused ? `0 0 10px ${c.border}22` : "none",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CSV LOADER PANEL
 * ═══════════════════════════════════════════════════════════════════════════ */

function CsvLoader({ onTransmit, onStop, onPause, onResume, txPaused = false, txPauseInfo = null, txCsv = "", txState, txEncodeLoading, rawCsv, setRawCsv, destIp, setDestIp, radioId, setRadioId }) {
  const [dragging,   setDragging]   = useState(false);
  const [fileName,   setFileName]   = useState(null);
  const [destPort,   setDestPort]   = useState("12345");
  const [portError,  setPortError]  = useState("");
  const [xlLoading,  setXlLoading]  = useState(false);
  const fileRef = useRef();

  /* ── Read CSV/TXT as plain text ── */
  const readCsvFile = (file) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => setRawCsv(e.target.result);
    reader.readAsText(file);
  };

  /* ── Read XLSX/XLS via SheetJS, convert sheet→CSV text ── */
  const readXlFile = async (file) => {
    setXlLoading(true);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");   // bundled locally (node_modules/xlsx 0.20.3) — no internet needed
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const csv  = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      setRawCsv(csv);
    } catch (e) {
      setRawCsv(`# Error reading Excel file: ${e.message}`);
    } finally {
      setXlLoading(false);
    }
  };

  const readFile = (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") readXlFile(file);
    else readCsvFile(file);
  };

  const validatePort = (val) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 1 || n > 65535) { setPortError("Port must be 1–65535"); return false; }
    setPortError(""); return true;
  };

  const handleTransmit = () => {
    if (!validatePort(destPort) || !rawCsv.trim()) return;
    onTransmit({ csv: rawCsv, dest_ip: destIp || "127.0.0.1", dest_port: parseInt(destPort, 10), loop: false, radio_id: radioId });
  };

  const isTransmitting = txState === "transmitting";
  const isEncoding     = txEncodeLoading;
  const isBusy         = isTransmitting || isEncoding || xlLoading;
  const canTransmit    = rawCsv.trim() && !portError && !isBusy;

  return (
    <GlowCard accentColor="orange" style={{ flexShrink: 0 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "var(--bg-raised)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 14 }}>◈</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: "var(--orange)", letterSpacing: "0.1em" }}>LOAD STORYBOARD CSV / XL</span>
        {(fileName || xlLoading) && (
          <span style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {xlLoading ? "⏳ reading XL…" : `▸ ${fileName}`}
          </span>
        )}
      </div>

      {/* ── Drop zone ── */}
      <div
        className="drop-zone"
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current.click()}
        style={{
          margin: "8px 10px 5px", borderRadius: 5, cursor: "pointer", textAlign: "center",
          border: `2px dashed ${dragging ? "var(--orange)" : "var(--border-bright)"}`,
          padding: "8px 12px",
          background: dragging ? "var(--orange-glow)" : "var(--bg-input)",
          transition: "all 0.2s",
        }}
      >
        <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" style={{ display: "none" }}
          onChange={e => { const f = e.target.files[0]; e.target.value = ""; if (f) readFile(f); }} />
        <div style={{ fontSize: 18, marginBottom: 3, opacity: 0.7 }}>▦</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 10, fontFamily: "var(--font-mono)" }}>
          DROP <span style={{ color: "var(--orange)" }}>.csv</span> or <span style={{ color: "var(--green)" }}>.xlsx/.xls</span> HERE
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: 9, marginTop: 2, fontFamily: "var(--font-mono)" }}>or click · # comments skipped · XL auto-converted</div>
      </div>

      <div style={{ padding: "5px 10px 3px", fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>— OR PASTE CSV —</div>
      <PasteArea value={rawCsv} onChange={v => { setRawCsv(v); setFileName(null); }} placeholder={"#TDMASlot,pktType,pktLen,frameNum,...\n10,9,0,1,431,2,..."} accentColor="orange" minHeight={65} maxHeight={130} />

      {/* ── Transmit config + single action button ── */}
      <div style={{
        margin: "6px 10px 10px", borderRadius: 5,
        border: `1px solid ${isTransmitting ? "var(--orange)" : isEncoding ? "rgba(255,107,0,0.5)" : "var(--border)"}`,
        background: "var(--bg-card)", overflow: "hidden",
        transition: "border-color 0.3s, box-shadow 0.3s",
        boxShadow: isTransmitting ? "0 0 18px rgba(255,107,0,0.12)" : "none",
      }}>
        {/* Sub-header */}
        <div style={{ padding: "7px 10px", background: "var(--bg-raised)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6 }}>
          {isTransmitting ? <StatusDot color="orange" pulse /> : <StatusDot color="orange" />}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, color: "var(--orange)", letterSpacing: "0.12em" }}>TX → DECODE LIVE PAGE</span>
          <span style={{ marginLeft: "auto", fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--cyan)", padding: "1px 5px", borderRadius: 3, border: "1px solid var(--cyan-dim)", background: "var(--cyan-glow)" }}>
            via /live/inject · WS
          </span>
        </div>

        {/* Info banner */}
        <div style={{ padding: "5px 10px", background: "rgba(0,229,255,0.03)", borderBottom: "1px solid var(--border)", fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
          <span>📡</span>
          <span>Encoded packets will appear in <span style={{ color: "var(--cyan)", fontWeight: 700 }}>Decode LIVE</span> tab — decoded &amp; displayed in real-time</span>
        </div>

        <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Radio unit — sets the §C.3.2.12 OTA Start-of-Frame prefix */}
          <Field label="RADIO UNIT (§C.3.2.12 SOF PREFIX)">
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2].map(rid => {
                const active = radioId === rid;
                const prefixHex = rid === 1 ? "F1A5C3" : "F2A5C3";
                return (
                  <button key={rid} onClick={() => setRadioId(rid)} style={{
                    flex: 1, padding: "6px 0", borderRadius: 4, cursor: "pointer",
                    fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                    border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                    background: active ? "var(--amber-glow, rgba(255,193,7,0.1))" : "var(--bg-input)",
                    color: active ? "var(--amber)" : "var(--text-dim)",
                  }}>
                    RADIO{rid} · 0x{prefixHex}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Destination IP */}
          <Field label="DESTINATION IP">
            <TextInput type="text" value={destIp}
              onChange={e => setDestIp(e.target.value)}
              placeholder="127.0.0.1" accentColor="cyan" />
          </Field>

          {/* UDP Port */}
          <Field label="UDP PORT (1–65535)">
            <TextInput type="number" min={1} max={65535} value={destPort}
              onChange={e => { setDestPort(e.target.value); validatePort(e.target.value); }}
              placeholder="12345" error={!!portError} accentColor="orange" />
          </Field>
          {portError && <div style={{ fontSize: 9, color: "var(--red)", fontFamily: "var(--font-mono)" }}>⚠ {portError}</div>}

          {/* While transmitting: ⏸ PAUSE / ▶ RESUME + ⏹ STOP */}
          {isTransmitting && !isEncoding ? (
            <PauseStopButtons paused={txPaused} onPause={onPause} onResume={onResume} onStop={onStop} stopLabel="⏹ STOP" />
          ) : (
          /* ── SINGLE UNIFIED BUTTON: ENCODE + TRANSMIT or STOP ── */
          <button
            className="svk-btn"
            onClick={isTransmitting ? onStop : handleTransmit}
            disabled={isTransmitting ? false : !rawCsv.trim() || !!portError || isEncoding || xlLoading}
            style={{
              width: "100%", padding: "10px 0", borderRadius: 4,
              border: `1px solid ${
                isTransmitting ? "var(--red)"
                : isEncoding    ? "var(--orange)"
                : !rawCsv.trim() || !!portError ? "var(--border)"
                : "var(--orange)"
              }`,
              background: isTransmitting
                ? "rgba(255,61,90,0.14)"
                : isEncoding
                ? "rgba(255,107,0,0.10)"
                : !rawCsv.trim() || !!portError
                ? "var(--bg-raised)"
                : "linear-gradient(135deg, rgba(255,107,0,0.22), rgba(255,61,90,0.10))",
              color: isTransmitting
                ? "var(--red)"
                : isEncoding
                ? "var(--orange)"
                : !rawCsv.trim() || !!portError
                ? "var(--text-dim)"
                : "var(--orange)",
              fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 11,
              letterSpacing: "0.12em", textTransform: "uppercase",
              cursor: (isTransmitting || (rawCsv.trim() && !portError && !isEncoding && !xlLoading)) ? "pointer" : "not-allowed",
              boxShadow: isTransmitting ? "0 0 18px var(--red)44" : !rawCsv.trim() ? "none" : "0 0 16px var(--orange)33",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              transition: "all 0.2s",
            }}
          >
            {isTransmitting && <StatusDot color="red" pulse />}
            {isEncoding     && <Spinner size={11} color="var(--orange)" />}
            {isTransmitting ? "⏹ STOP TRANSMISSION"
             : isEncoding   ? "ENCODING + PREPARING TX…"
             : xlLoading    ? "READING FILE…"
             : "◈ TRANSMIT STORYBOARD"}
          </button>
          )}

          {/* Status line */}
          {txState && txState !== "idle" && (
            <div style={{
              fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 700, textAlign: "center",
              letterSpacing: "0.08em",
              color: txState === "transmitting" ? (txPaused ? "var(--amber, #f5a623)" : "var(--orange)")
                   : txState === "done"         ? "var(--green)"
                   : txState === "stopped"      ? "var(--cyan)"
                   : "var(--red)",
              animation: "fade-in 0.3s ease",
            }}>
              {txState === "transmitting" && (txPaused
                ? (rawCsv.trim() && rawCsv !== txCsv
                    ? "⏸ PAUSED"
                    : `⏸ PAUSED${txPauseInfo ? ` — RESUMES AT FRAME ${txPauseInfo.next} OF ${txPauseInfo.total}` : ""}`)
                : "● ENCODING & TRANSMITTING…")}
              {txState === "transmitting" && txPaused && rawCsv.trim() && rawCsv !== txCsv && (
                <div style={{ marginTop: 5, fontSize: 9, color: "var(--cyan)", padding: "4px 6px", borderRadius: 4,
                  border: "1px dashed var(--cyan-dim)", background: "var(--cyan-glow)", letterSpacing: "0.06em" }}>
                  ⟳ NEW STORYBOARD LOADED — ▶ RESUME CONTINUES WITH IT FROM ITS FRAME 1 (SAME SESSION)
                </div>
              )}
              {txState === "done"         && "✔ TRANSMISSION COMPLETE"}
              {txState === "stopped"      && "■ STOPPED BY USER"}
              {txState === "error"        && "✖ TRANSMIT ERROR — CHECK SERVER LOG"}
            </div>
          )}
        </div>
        <TxProgressBar active={isTransmitting || isEncoding} />
      </div>
    </GlowCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ERROR ALERT
 * ═══════════════════════════════════════════════════════════════════════════ */

function ErrorAlert({ message }) {
  if (!message) return null;
  return (
    <div style={{
      padding: "8px 12px", borderRadius: 4, border: "1px solid var(--red)",
      background: "var(--red-glow)", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--red)",
      display: "flex", alignItems: "flex-start", gap: 6, animation: "fade-in 0.25s ease",
    }}>
      <span style={{ flexShrink: 0 }}>⚠</span>
      <span>{message}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * STATION RESULTS RENDERER
 * ═══════════════════════════════════════════════════════════════════════════ */

function StationResults({ data }) {
  const [expanded, setExpanded] = useState({});
  const toggle = (id) => setExpanded(s => ({ ...s, [id]: !s[id] }));

  if (!data?.stations?.length) return (
    <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>No stations found in XML.</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <SectionHeader icon="◉" title="Stations" count={data.station_count} color="amber" />
      {data.stations.map((stn, i) => {
        const key    = stn.id || i;
        const isOpen = expanded[key];
        return (
          <div key={i} style={{ borderBottom: "1px solid var(--border)", animation: "row-reveal 0.25s ease both", animationDelay: `${i * 35}ms` }}>
            <div className="acc-row" onClick={() => toggle(key)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", cursor: "pointer", background: isOpen ? "var(--amber-glow)" : "transparent", transition: "background 0.15s" }}>
              <span style={{ color: "var(--amber)", fontSize: 9, width: 10, fontFamily: "var(--font-mono)", transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "none" }}>▶</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: "var(--text-primary)", flex: 1 }}>{stn.name || stn.id || `Station ${i + 1}`}</span>
              {stn.id      && <Badge color="amber">{stn.id}</Badge>}
              {stn.type    && <Badge color="cyan">{stn.type}</Badge>}
              {stn.section && <Badge color="purple">{stn.section}</Badge>}
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>SIG:{stn.signals?.length ?? 0}  PTS:{stn.points?.length ?? 0}</span>
            </div>
            {isOpen && (
              <div style={{ padding: "8px 14px 12px 34px", display: "flex", flexDirection: "column", gap: 10, animation: "fade-up 0.2s ease" }}>
                {stn.signals?.length > 0 && (
                  <DataTable headers={["ID","Type","Aspect"]} rows={stn.signals.map(s => [
                    <span style={{ color: "var(--amber-text)", fontWeight: 700 }}>{s.id}</span>,
                    <span style={{ color: "var(--text-primary)" }}>{s.type}</span>,
                    <Badge color={s.aspect==="G"||s.aspect==="Green"?"green":s.aspect==="R"||s.aspect==="Red"?"red":"muted"}>{s.aspect||"—"}</Badge>,
                  ])} />
                )}
                {stn.points?.length > 0 && (
                  <DataTable headers={["ID","Normal","Status"]} rows={stn.points.map(p => [
                    <span style={{ color: "var(--amber-text)", fontWeight: 700 }}>{p.id}</span>,
                    <span style={{ color: "var(--text-primary)" }}>{p.normal}</span>,
                    <Badge color={p.status==="Normal"?"green":"red"}>{p.status||"—"}</Badge>,
                  ])} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * APD (TRACK PROFILE) RESULTS RENDERER
 * Shows the summary AND the full sheet content returned by
 * POST /svk/load_track_profile:
 *   { filename, rows_parsed, rows_skipped, rows_loaded, table_size,
 *     columns: string[], rows: string[][] }
 * `columns`/`rows` hold every column of every valid row exactly as the
 * workbook has it (Entry Signal, Exit Signal, Line, Reference TAG,
 * Profile Span, every *_Count column, and the full un-padded hex
 * strings) — not just the six hex columns the C layer actually consumes.
 *
 * The full-sheet table below is its OWN bounded scroll box (both axes),
 * independent of whatever ancestor panel it sits in — that's what makes
 * scrolling stay reliable even after a cell is expanded. It also gets a
 * dedicated slate/amber "data-grid" theme (sticky header, sticky S.No
 * column, colour-coded sub-packet column groups) distinct from the
 * generic green DataTable used elsewhere in the app.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* Colour a column by which §C.4.2 sub-packet group it belongs to, so the
 * six PSR/Gradient/LC/Turnout/TLI/TCD blocks are visually scannable across
 * a very wide sheet. Falls back to a neutral tone for the descriptive
 * (S.No / Entry Signal / …) columns. */
function apdGroupColor(colName) {
  const n = colName.toLowerCase();
  // Theme colours (not fixed neon hex) so headers stay readable in the light theme too.
  if (n.includes("psr"))                        return { text: "var(--cyan)",      glow: "transparent", accent: true };
  if (n.includes("gradient"))                    return { text: "var(--green)",     glow: "transparent", accent: true };
  if (n.includes("lc gate"))                     return { text: "var(--purple)",    glow: "transparent", accent: true };
  if (n.includes("turnout") || n.startsWith("to"))return { text: "var(--orange)",    glow: "transparent", accent: true };
  if (n.includes("tli"))                         return { text: "var(--amber-text)", glow: "transparent", accent: true };
  if (n.includes("tcd"))                         return { text: "var(--red)",       glow: "transparent", accent: true };
  return { text: "var(--text-secondary)", glow: "transparent", accent: false };
}

function ApdCell({ value }) {
  const [expanded, setExpanded] = useState(false);
  const str = value == null ? "" : String(value);
  const isLong = str.length > 34;
  return (
    <span
      onClick={isLong ? () => setExpanded(e => !e) : undefined}
      title={isLong ? (expanded ? "Click to collapse" : `${str}\n\n(click to expand)`) : undefined}
      style={{
        display: "inline-block",
        maxWidth: expanded ? 560 : 300,
        overflow: expanded ? "visible" : "hidden",
        textOverflow: "ellipsis",
        whiteSpace: expanded ? "normal" : "nowrap",
        wordBreak: expanded ? "break-all" : "normal",
        verticalAlign: "bottom",
        cursor: isLong ? "pointer" : "default",
        color: isLong ? "var(--amber-text)" : "inherit",
      }}
    >
      {str || "—"}
    </span>
  );
}

/* Row hover highlight + scrollbar styling for the full-sheet grid (inline
   styles can't express :hover). */
const SHEET_CSS = `
  .sheet-grid tbody tr:hover td { background: var(--sheet-hover) !important; }
  .sheet-grid tbody tr:hover td:first-child { background: var(--sheet-key-hover) !important; }
  .sheet-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
  .sheet-scroll::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border-radius: 6px; border: 2px solid transparent; background-clip: padding-box; }
  .sheet-scroll::-webkit-scrollbar-thumb:hover { background: var(--scroll-thumb-hover); background-clip: padding-box; border: 2px solid transparent; }
  .sheet-scroll::-webkit-scrollbar-corner { background: transparent; }
  .sheet-filter:focus { outline: none; border-color: var(--c, #00e5ff) !important; box-shadow: 0 0 0 3px rgba(0,229,255,0.12); }
`;

const isNumericCell = v => v != null && v !== "" && /^-?\d+(\.\d+)?$/.test(String(v).trim());

/* Big, readable full-sheet grid. Grows to fill the results panel's free
   height (the parent passes flex) and scrolls on both axes inside itself;
   with few rows it simply sizes to its content. Sticky header + sticky
   first (S.No) column; numbers right-aligned with even-width digits. */
function ApdFullSheetTable({ columns, rows }) {
  const groupColors = useMemo(() => columns.map(apdGroupColor), [columns]);
  // Columns whose every non-empty value is a plain number → right-align.
  const numericCols = useMemo(() => columns.map((_, ci) => {
    const vals = rows.map(r => r[ci]).filter(v => v != null && v !== "");
    return vals.length > 0 && vals.every(isNumericCell);
  }), [columns, rows]);
  // A narrow sheet (e.g. the 3-column RFID table) is NOT stretched across
  // the whole panel — that put each tag hundreds of px away from its
  // location value. It keeps a comfortable fixed column width instead.
  const compact = columns.length <= 5;
  return (
    <div
      className="sheet-scroll"
      style={{
        overflow: "auto",           // scrolls both axes, independent of any ancestor panel
        flex: "0 1 auto",           // fills the free height when there are many rows, shrinks to content otherwise
        minHeight: 140,
        alignSelf: compact ? "flex-start" : undefined,
        maxWidth: "100%",
        border: "1px solid var(--border-bright)",
        borderRadius: 10,
        background: "var(--bg-void)",
        boxShadow: "var(--sheet-inset)",
      }}
    >
      <table className="sheet-grid" style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5, fontFamily: "var(--font-mono)", width: "max-content", minWidth: compact ? undefined : "100%", fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr>
            {columns.map((h, ci) => (
              <th
                key={h + ci}
                style={{
                  position: "sticky", top: 0, zIndex: ci === 0 ? 3 : 2,
                  left: ci === 0 ? 0 : undefined,
                  padding: "11px 14px",
                  minWidth: compact && ci > 0 ? 220 : undefined,
                  textAlign: numericCols[ci] ? "right" : "left",
                  fontWeight: 700, fontSize: 11, letterSpacing: "0.06em",
                  whiteSpace: "nowrap",
                  color: groupColors[ci].text,
                  background: ci === 0 ? "var(--sheet-head-key-bg)" : "var(--sheet-head-bg)",
                  borderBottom: `2px solid ${groupColors[ci].accent ? `color-mix(in srgb, ${groupColors[ci].text} 45%, transparent)` : "var(--border-bright)"}`,
                  borderRight: "1px solid var(--border)",
                  boxShadow: ci === 0 ? "var(--sheet-key-shadow)" : "none",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {columns.map((_, ci) => (
                <td
                  key={ci}
                  style={{
                    position: ci === 0 ? "sticky" : undefined,
                    left: ci === 0 ? 0 : undefined,
                    zIndex: ci === 0 ? 1 : undefined,
                    padding: "9px 14px",
                    minWidth: compact && ci > 0 ? 220 : undefined,
                    lineHeight: 1.35,
                    textAlign: numericCols[ci] ? "right" : "left",
                    borderBottom: "1px solid var(--sheet-line)",
                    borderRight: "1px solid var(--sheet-line-v)",
                    background: ci === 0
                      ? (ri % 2 ? "var(--sheet-key-bg-b)" : "var(--sheet-key-bg-a)")
                      : (ri % 2 ? "var(--sheet-zebra)" : "transparent"),
                    boxShadow: ci === 0 ? "var(--sheet-key-shadow)" : undefined,
                    color: ci === 0 ? "var(--text-value)" : "var(--text-primary)",
                    fontWeight: ci === 0 ? 700 : 400,
                    transition: "background 0.12s",
                  }}
                >
                  <ApdCell value={row[ci]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Compact one-line summary as stat cards (replaces the tall Field/Value
   table above the sheet, leaving more height for the data itself). */
function SheetSummary({ items, accent }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 14px 4px" }}>
      {items.map(([k, v, wide]) => (
        <div key={k} style={{
          display: "flex", flexDirection: "column", gap: 3, padding: "7px 12px", borderRadius: 7, minWidth: 96,
          flex: wide ? "1 1 280px" : "0 0 auto", maxWidth: wide ? 560 : undefined,
          border: "1px solid var(--border)", background: "var(--bg-raised)",
        }}>
          <span style={{ fontSize: 9.5, letterSpacing: "0.08em", color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{k}</span>
          <span title={String(v)} style={{ fontSize: 14, fontWeight: 700, color: accent, fontFamily: "var(--font-mono)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

/* Title bar + live filter box + the grid, laid out to take ALL the height
   left in the results panel. */
function SheetSection({ icon, accent, columns, rows, hint, title = "FULL SHEET CONTENT" }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => r.some(v => v != null && String(v).toLowerCase().includes(needle)));
  }, [rows, q]);
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: "0 14px 14px" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        padding: "12px 0 8px", borderTop: "1px solid var(--border)", marginTop: 6, flexShrink: 0,
      }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: "0.08em", color: accent }}>
          {icon} {title}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
          {q ? `showing ${shown.length} of ${rows.length}` : `${rows.length} row(s)`} × {columns.length} column(s)
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {hint && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>{hint}</span>}
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-muted)", pointerEvents: "none" }}>⌕</span>
            <input className="sheet-filter" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter rows…"
              style={{ "--c": accent, width: 220, padding: "7px 28px 7px 26px", borderRadius: 7, fontSize: 12, fontFamily: "var(--font-mono)",
                border: "1px solid var(--border-bright)", background: "var(--bg-input)", color: "var(--text-primary)" }}/>
            {q && (
              <button onClick={() => setQ("")} title="Clear filter" style={{ position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)",
                border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, padding: "0 4px" }}>✕</button>
            )}
          </div>
        </div>
      </div>
      {shown.length > 0 ? (
        <ApdFullSheetTable columns={columns} rows={shown} />
      ) : (
        <div style={{ padding: 24, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)",
          border: "1px dashed var(--border-bright)", borderRadius: 10 }}>No rows match “{q}”.</div>
      )}
    </div>
  );
}

function ApdResults({ data }) {
  if (!data) return (
    <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>No Track Profile loaded.</div>
  );
  const summaryRows = [
    ["File",           data.filename ?? "—"],
    ["Rows parsed",    data.rows_parsed ?? 0],
    ["Rows skipped",   data.rows_skipped ?? 0],
    ["Rows loaded",    data.rows_loaded ?? 0],
    ["Table size now", data.table_size ?? 0],
  ];
  const columns  = Array.isArray(data.columns) ? data.columns : [];
  const fullRows = Array.isArray(data.rows) ? data.rows : [];

  return (
    // flex:1 + minHeight:0 — takes ALL the height of the results panel (which
    // is overflow:hidden), so the sheet below can grow into it instead of
    // being capped at a fixed height.
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <style>{SHEET_CSS}</style>
      <SectionHeader icon="▤" title="Track Profile (APD)" count={data.table_size ?? data.rows_loaded ?? 0} color="amber" />
      <SheetSummary accent="var(--amber-text)" items={summaryRows.map(([k, v]) => [k, v, k === "File"])}/>
      {data.rows_skipped > 0 && (
        <div style={{ padding: "4px 14px", fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {data.rows_skipped} row(s) skipped — missing or non-numeric S.No.
        </div>
      )}

      {columns.length > 0 && fullRows.length > 0 && (
        <SheetSection icon="▤" accent="var(--amber-text)" columns={columns} rows={fullRows}
          hint="click a long hex value to expand"/>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RFID TAG LOCATION TABLE RESULTS RENDERER
 * Shows the summary AND the full sheet content for the client-side-parsed
 * RFID Tag Table: { filename, rows_loaded, rows, map, columns, sheetRows }.
 * This is the calibration lookup 🚆 LIVE TRACK uses to work out the real
 * absolute chainage offset for the profile currently loaded above.
 * ═══════════════════════════════════════════════════════════════════════════ */

function RfidTagResults({ data }) {
  if (!data) return (
    <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>No RFID Tag Table loaded.</div>
  );
  const summaryRows = [
    ["File",        data.filename ?? "—"],
    ["Rows loaded", data.rows_loaded ?? 0],
  ];
  const columns  = Array.isArray(data.columns) ? data.columns : [];
  const fullRows = Array.isArray(data.sheetRows) ? data.sheetRows : [];

  return (
    // Same full-height layout as the APD view — see ApdResults.
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <style>{SHEET_CSS}</style>
      <SectionHeader icon="📍" title="RFID Tag Location Table" count={data.rows_loaded ?? 0} color="green" />
      <SheetSummary accent="var(--green)" items={summaryRows.map(([k, v]) => [k, v, k === "File"])}/>
      <div style={{ padding: "4px 14px 2px", fontSize: 11, lineHeight: 1.5, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
        Used by 🚆 LIVE TRACK to calibrate the profile's local (0-based) distance to real absolute chainage — see
        the "ANCHOR RFID …" readout there once a matching tag has been seen on the wire.
      </div>

      {columns.length > 0 && fullRows.length > 0 && (
        <SheetSection icon="📍" accent="var(--green)" columns={columns} rows={fullRows}/>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * MA TABLE RESULTS RENDERER
 * Shows the summary AND the full table content returned by POST /svk/load_ma_table:
 *   { filename, rows_loaded, rows_skipped, table_size, columns_found, table }
 *
 * columns_found always includes "last_rfid_tag" (the MA table's mandatory
 * matching-key column) — it's filtered out of the extra columns below since
 * it's already shown as the hardcoded "RFID_TAG" column; otherwise it would
 * render as a second, redundant column showing the exact same value.
 * ═══════════════════════════════════════════════════════════════════════════ */

function MaTableResults({ data }) {
  if (!data) return (
    <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>No MA table loaded.</div>
  );

  // Map field_key to display name
  const fieldKeyToLabel = {
    "ma_m": "MA (W.R.T. SIG)",
    "dist_pkt_start": "DIST_PKT_START",
    "cur_sig_info": "CUR_SIG_INFO",
    "cur_sig_aspect": "CUR_SIG_ASP",
    "next_sig_aspect": "NXT_SIG_ASP",
    "appr_sig_dist": "APPR_SIG_DIST",
    "route1": "ROUTE1",
    "route2": "ROUTE2",
    "route3": "ROUTE3",
    "route4": "ROUTE4",
  };

  // "last_rfid_tag" is filtered out here — it's the MA table's matching key,
  // already shown as the hardcoded RFID_TAG column below, so listing it again
  // as an extra column would just duplicate that value under a second header.
  const columnsPresent = (data.columns_found || ["ma_m"])
    .filter(col => col !== "last_rfid_tag")
    .map(col => ({
      key: col,
      label: fieldKeyToLabel[col] || col,
    }));

  const summaryRows = [
    ["File",           data.filename ?? "—"],
    ["Rows loaded",    data.rows_loaded ?? 0],
    ["Rows skipped",   data.rows_skipped ?? 0],
    ["Columns loaded", columnsPresent.map(c => c.label).join(" · ") || "MA only"],
  ];
  const tableData = Array.isArray(data.table) ? data.table : [];
  // Same big full-height grid as the APD / RFID views: RFID_TAG first (the
  // sticky key column), then every loaded MA column. A missing value is
  // passed as "" so the cell shows "—" and doesn't stop a numeric column
  // from being right-aligned.
  const gridColumns = ["RFID_TAG", ...columnsPresent.map(c => c.label)];
  const gridRows = tableData.map(row => [
    row.rfid_tag ?? "",
    ...columnsPresent.map(c => (row[c.key] === undefined || row[c.key] === null ? "" : String(row[c.key]))),
  ]);

  return (
    // flex:1 + minHeight:0 — fills the results panel's height (see ApdResults).
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <style>{SHEET_CSS}</style>
      <SectionHeader icon="🎯" title="MA Table (RFID → Movement Authority)" count={data.table_size ?? data.rows_loaded ?? 0} color="cyan" />
      <SheetSummary accent="var(--cyan)" items={summaryRows.map(([k, v]) => [k, v, k === "File" || k === "Columns loaded"])}/>
      {data.rows_skipped > 0 && (
        <div style={{ padding: "4px 14px", fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {data.rows_skipped} row(s) skipped — missing or non-numeric LAST_RFID_TAG/MA.
        </div>
      )}

      {tableData.length > 0 && (
        <>
          {/* Above the table (not below it): the table section takes all the
              remaining height, so a note after it was pushed to the very
              bottom of the panel, far from the rows it describes. */}
          <div style={{ padding: "4px 14px 2px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)", lineHeight: 1.6, flexShrink: 0 }}>
            <span style={{ color: "var(--green-dim)", fontWeight: 700 }}>✔ All columns from your Excel file are now active:</span>
            <span style={{ color: "var(--text-secondary)" }}>
              {" "}default storyboard CSV values are used initially · when an Onboard→Station (L2S) packet with a matching
              LAST_RFID_TAG is received, the MA table values OVERRIDE storyboard defaults for subsequent packets · watch the
              serial log for "● LIVE MA" indicators showing when values are active
            </span>
          </div>
          <SheetSection icon="🎯" accent="var(--cyan)" title={`LOADED MA TABLE · ${tableData.length} RFID TAG(S)`}
            columns={gridColumns} rows={gridRows} hint="values used for serial TX patching"/>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CSV ENCODE RESULTS RENDERER
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
 * TX LIVE LOG — Real-time transmission log panel shown alongside TX Mission
 * Control. Shows every packet encoded & sent to the Decode LIVE page with
 * packet type, frame, TDMA slot, byte count, hex preview, and timestamp.
 * ═══════════════════════════════════════════════════════════════════════════ */

const PKT_TYPE_META = {
  9:  { name: "S2L Reg",  abbr: "S2L",  color: "#00e5ff" },
  10: { name: "L2S Reg",  abbr: "L2S",  color: "#00ff88" },
  11: { name: "Acc Auth", abbr: "AUTH", color: "#b060ff" },
  12: { name: "Emergency",abbr: "EMRG", color: "#ff3d5a" },
  13: { name: "Acc Req",  abbr: "AREQ", color: "#f5a623" },
};

function TxLiveLog({ txLog, txState, txSent, txTotal, txFrameNum, txCountdown, onStop, destIp }) {
  const logRef   = useRef(null);
  const [filter, setFilter] = useState("all");
  const [searchHex, setSearchHex] = useState("");

  /* Auto-scroll log to bottom */
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [txLog]);

  const isLive  = txState === "transmitting";
  const isDone  = txState === "done";
  const isStopped = txState === "stopped";
  const isError   = txState === "error";

  /* CRC pass/fail tally over dispatched packets */
  const { crcPassCount, crcFailCount } = useMemo(() => {
    let pass = 0, fail = 0;
    txLog.forEach(row => {
      if (row.error) return;
      const r = verifyPacketCrc(row.hex);
      if (r.status === "pass") pass++;
      else if (r.status === "fail") fail++;
    });
    return { crcPassCount: pass, crcFailCount: fail };
  }, [txLog]);

  /* Filter rows */
  const visibleLog = txLog.filter(row => {
    if (filter !== "all" && String(row.pktType) !== filter) return false;
    if (searchHex && !row.hex.includes(searchHex.toUpperCase()) && !(row.otaHex || "").includes(searchHex.toUpperCase())) return false;
    return true;
  });

  /* Progress percent */
  const pct = txTotal > 0 ? Math.min(100, Math.round((txSent / txTotal) * 100)) : 0;

  /* Countdown arc */
  const arcR   = 18;
  const arcLen = 2 * Math.PI * arcR;
  const arcFill = arcLen * (1 - txCountdown / 2);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg-base)" }}>
      {/* ── Header ── */}
      <div style={{
        flexShrink: 0, padding: "10px 16px",
        background: "var(--panel-head-bg)",
        borderBottom: `1px solid ${isLive ? "rgba(255,107,0,0.5)" : "var(--border)"}`,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        {isLive && <StatusDot color="orange" pulse />}
        {isDone && <StatusDot color="green" />}
        {(isStopped || isError) && <StatusDot color="red" />}
        <span style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: "0.18em", color: isLive ? "var(--orange)" : isDone ? "var(--green)" : "var(--red)", textShadow: `0 0 14px currentColor66` }}>
          {isLive ? "TX LIVE LOG" : isDone ? "TX COMPLETE" : isStopped ? "TX STOPPED" : "TX ERROR"}
        </span>
        <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>→ DECODE LIVE PAGE</span>
        <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--cyan)", padding: "1px 6px", borderRadius: 3, border: "1px solid var(--cyan-dim)", background: "var(--cyan-glow)" }}>
          UDP → {destIp || "127.0.0.1"}
        </span>

        {/* Countdown arc */}
        {isLive && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
            <svg width={44} height={44} style={{ flexShrink: 0 }}>
              <circle cx={22} cy={22} r={arcR} fill="none" stroke="rgba(255,107,0,0.15)" strokeWidth={3}/>
              <circle cx={22} cy={22} r={arcR} fill="none" stroke="var(--orange)" strokeWidth={3}
                strokeDasharray={arcLen} strokeDashoffset={arcFill}
                strokeLinecap="round" transform="rotate(-90 22 22)"
                style={{ transition: "stroke-dashoffset 0.1s linear" }}/>
              <text x={22} y={26} textAnchor="middle" fontSize={10} fontWeight="700"
                fill="var(--orange)" fontFamily="monospace">{txCountdown.toFixed(1)}</text>
            </svg>
            <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              <div style={{ color: "var(--orange)", fontWeight: 700 }}>FRM {txFrameNum ?? "—"}</div>
              <div>next in {txCountdown.toFixed(1)}s</div>
            </div>
          </div>
        )}

        {/* Progress */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700, color: isLive ? "var(--orange)" : isDone ? "var(--green)" : "var(--text-muted)" }}>
            {txSent}<span style={{ color: "var(--text-dim)" }}>/{txTotal}</span>
          </div>
          <div style={{ width: 60, height: 4, borderRadius: 2, background: "var(--bg-raised)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: isLive ? "var(--orange)" : isDone ? "var(--green)" : "var(--red)", borderRadius: 2, transition: "width 0.4s ease" }}/>
          </div>
          <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{pct}%</span>
        </div>

        {isLive && (
          <button onClick={onStop} style={{
            padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
            letterSpacing: "0.1em", border: "1px solid var(--red)", background: "rgba(255,61,90,0.1)", color: "var(--red)",
          }}>⏹ STOP</button>
        )}
      </div>

      {/* ── Progress bar strip ── */}
      <div style={{ height: 3, flexShrink: 0, background: "var(--bg-raised)" }}>
        {isLive && <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, var(--orange), var(--amber))", transition: "width 0.4s ease", boxShadow: "0 0 8px var(--orange)" }}/>}
        {isDone && <div style={{ height: "100%", width: "100%", background: "var(--green)" }}/>}
      </div>

      {/* ── Filter bar ── */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        <span style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginRight: 2 }}>FILTER:</span>
        {[["all","ALL","muted"], ["9","S2L","cyan"], ["10","L2S","green"], ["11","AUTH","purple"], ["12","EMRG","red"], ["13","AREQ","amber"]].map(([v, l, c]) => (
          <button key={v} onClick={() => setFilter(v)} style={{
            padding: "2px 8px", borderRadius: 4, cursor: "pointer",
            fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700,
            letterSpacing: "0.06em", border: `1px solid ${filter===v ? `var(--${c})` : "var(--border)"}`,
            background: filter===v ? `var(--${c}-glow, rgba(0,255,136,0.08))` : "transparent",
            color: filter===v ? `var(--${c})` : "var(--text-dim)",
          }}>{l}</button>
        ))}
        <input value={searchHex} onChange={e => setSearchHex(e.target.value.toUpperCase())}
          placeholder="Search hex…"
          style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 4, fontSize: 9, background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-mono)", width: 110 }}/>
      </div>

      {/* ── Column headers ── */}
      <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "48px 60px 52px 54px 60px 1fr 70px 78px", gap: "0 6px", padding: "4px 12px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
        {["#", "TIME", "SLOT", "FRM", "PKT", "SOF PREFIX + HEX", "BYTES", "CRC"].map(h => (
          <span key={h} style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</span>
        ))}
      </div>

      {/* ── Log rows ── */}
      <div ref={logRef} style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {visibleLog.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            <span style={{ fontSize: 28 }}>◈</span>
            <span style={{ fontSize: 11 }}>{isLive ? "Waiting for first frame…" : "No packets match filter"}</span>
          </div>
        ) : visibleLog.map((row, i) => {
          const meta   = PKT_TYPE_META[row.pktType] || { abbr: "???", color: "#6b7280" };
          const isEmrg = row.pktType === 12 || row.error;
          /* Prefer the full on-air bytes (§C.3.2.12 SOF prefix + packet)
           * when the server reported one; fall back to the pure packet. */
          const fullHex   = (row.otaHex || row.hex || "").replace(/\s/g, "");
          const prefixLen = row.framePrefix ? row.framePrefix.length : 0;
          const prefixFmt = prefixLen > 0 ? fullHex.slice(0, prefixLen).match(/.{1,2}/g)?.join(" ") : "";
          const hexFmt    = fullHex.slice(prefixLen).match(/.{1,2}/g)?.join(" ") || "—";
          return (
            <div key={i} className="tx-log-row" style={{
              display: "grid",
              gridTemplateColumns: "48px 60px 52px 54px 60px 1fr 70px 78px",
              gap: "0 6px", padding: "9px 14px",
              borderBottom: "1px solid rgba(0,255,136,0.04)",
              borderLeft: `3px solid ${row.error ? "var(--red)" : meta.color}44`,
              background: isEmrg ? "rgba(255,61,90,0.04)" : i % 2 === 0 ? "transparent" : "var(--row-alt)",
              animationDelay: `${Math.min(i, 10) * 20}ms`,
              alignItems: "start",
            }}>
              <span style={{ fontSize: 13, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>#{txLog.indexOf(row)+1}</span>
              <span style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>{row.timestamp}</span>
              <span style={{ fontSize: 13, color: "var(--amber)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>P{row.tdmaSlot}</span>
              <span style={{ fontSize: 13, color: "var(--orange)", fontWeight: 700, fontFamily: "var(--font-mono)" }}>{row.frameNum}</span>
              <span style={{
                fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700, letterSpacing: "0.04em",
                padding: "1px 5px", borderRadius: 3,
                background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}44`,
                alignSelf: "center",
              }}>{meta.abbr}</span>
              <span style={{
                fontSize: 12, color: row.error ? "var(--red)" : "var(--text-code)",
                fontFamily: "var(--font-mono)", whiteSpace: "normal", wordBreak: "break-all",
                letterSpacing: "0.04em", lineHeight: 1.5,
              }}>
                {row.error ? `⚠ ${row.error}` : (
                  <>
                    {prefixFmt && (
                      <span title={`§C.3.2.12 SOF prefix · Radio${row.radioId ?? "?"}`} style={{ color: "var(--red)", fontWeight: 700 }}>
                        {prefixFmt}{" "}
                      </span>
                    )}
                    {hexFmt}
                  </>
                )}
              </span>
              <span style={{ fontSize: 13, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{row.otaByteLen ?? row.byteLen}B</span>
              <span style={{ alignSelf: "center" }}>{!row.error && <CrcBadge hex={row.hex} compact />}</span>
            </div>
          );
        })}
        {isLive && (
          <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 6, fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--orange)", animation: "glow-pulse 1.2s ease-in-out infinite" }}>
            <Spinner size={10} color="var(--orange)" /> transmitting…
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{ flexShrink: 0, padding: "5px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", gap: 12, alignItems: "center", fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
        <span>TOTAL: <span style={{ color: "var(--orange)", fontWeight: 700 }}>{txSent}</span> pkts</span>
        <span>DEST: <span style={{ color: "var(--cyan)" }}>{destIp || "127.0.0.1"}</span></span>
        <span>VISIBLE: <span style={{ color: "var(--text-secondary)" }}>{visibleLog.length}</span></span>
        {crcFailCount > 0 && <span>CRC: <span style={{ color: "var(--green)" }}>{crcPassCount} OK</span> / <span style={{ color: "var(--red)", fontWeight: 700 }}>{crcFailCount} FAIL</span></span>}
        {isDone && <span style={{ color: "var(--green)", fontWeight: 700, marginLeft: "auto" }}>✔ ALL PACKETS DISPATCHED → DECODE LIVE PAGE</span>}
        {isLive && <span style={{ color: "var(--orange)", fontWeight: 700, marginLeft: "auto" }}>● LIVE · packets visible in Decode LIVE tab</span>}
      </div>
    </div>
  );
}

function CsvEncodeResults({ data, rawCsv }) {
  const [expandedIdx, setExpandedIdx] = useState(null);

  const csvLines = rawCsv ? rawCsv.split(/\r?\n/) : [];
  const lineColsMap = {};
  csvLines.forEach((line, i) => {
    const cols = parseCsvCols(line);
    if (cols) lineColsMap[i + 1] = cols;
  });

  if (!data?.length) return (
    <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>No encoded packets. Load and encode a StoryBoard CSV.</div>
  );

  const totalBytes = data.reduce((s, r) => s + (r.byte_len || 0), 0);
  const errorRows  = data.filter(r => r.error).length;
  const frameCount = new Set(data.map(r => r.frame_num)).size;
  const pktDist    = {};
  data.forEach(r => { pktDist[r.pkt_type] = (pktDist[r.pkt_type] || 0) + 1; });
  const crcFailRows = data.filter(r => !r.error && verifyPacketCrc(r.hex).status === "fail").length;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <SectionHeader icon="◈" title="Encoded Radio Packets" count={data.length} color="orange" />
      <div style={{ padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: 16, borderBottom: "1px solid var(--border)", background: "var(--bg-raised)", animation: "fade-in 0.3s ease" }}>
        <MetaKV label="FRAMES" value={frameCount} color="orange" />
        <MetaKV label="TOTAL BYTES" value={`${totalBytes} B`} />
        <MetaKV label="PACKETS" value={data.length} />
        {errorRows > 0 && <MetaKV label="ERRORS" value={errorRows} color="red" />}
        {crcFailRows > 0 && <MetaKV label="CRC FAIL" value={crcFailRows} color="red" />}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {Object.entries(pktDist).map(([pt, cnt]) => <Badge key={pt} color={pktColor(+pt)}>PKT{pt}×{cnt}</Badge>)}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-dim)", alignSelf: "center" }}>RDSO/SPN/196/2020 · Annexure-C</div>
      </div>

      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {data.map((pkt, idx) => {
          const hasError  = !!pkt.error;
          const isOpen    = expandedIdx === idx;
          const cols      = lineColsMap[pkt.line_num] || null;
          const fields    = cols ? decodePacketFields(cols, pkt.pkt_type) : null;
          const hexPairs  = pkt.hex ? pkt.hex.match(/.{1,2}/g) || [] : [];
          const pc        = pktColor(pkt.pkt_type);
          const accentVar = ACCENT[pc]?.border || "var(--border)";
          const accentTxt = ACCENT[pc]?.text   || "var(--text-secondary)";
          const crcCheck  = !hasError ? verifyPacketCrc(pkt.hex) : { status: "unknown" };
          const crcFailed = crcCheck.status === "fail";

          return (
            <div key={idx} style={{
              borderRadius: 6, border: `1px solid ${hasError ? "var(--red)" : crcFailed ? "var(--red)" : isOpen ? accentVar : "var(--border)"}`,
              background: hasError ? "rgba(255,61,90,0.05)" : crcFailed ? "rgba(255,61,90,0.04)" : "var(--bg-surface)", overflow: "hidden",
              animation: "row-reveal 0.2s ease both", animationDelay: `${Math.min(idx * 15, 500)}ms`,
              transition: "border-color 0.2s",
            }}>
              <div onClick={() => setExpandedIdx(isOpen ? null : idx)} style={{
                display: "grid", gridTemplateColumns: "28px 90px 1fr auto 78px 70px 70px 26px",
                alignItems: "center", padding: "7px 12px", gap: 8, cursor: "pointer",
                background: isOpen ? `${accentVar}11` : "transparent", transition: "background 0.15s",
              }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-dim)" }}>#{pkt.row}</span>
                <Badge color={pc}>{pkt.pkt_type} · {pktShort(pkt.pkt_type)}</Badge>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: accentTxt, letterSpacing: "0.04em" }}>
                  {hasError ? <span style={{ color: "var(--red)" }}>⚠ {pkt.error}</span> : pkt.pkt_type_name}
                </span>
                <div style={{ display: "flex", gap: 10 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}>
                    <span style={{ color: "var(--text-dim)" }}>FRM </span>
                    <span style={{ color: "var(--orange)", fontWeight: 700 }}>{pkt.frame_num}</span>
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}>
                    <span style={{ color: "var(--text-dim)" }}>TDMA </span>
                    <span style={{ color: "var(--cyan)" }}>{pkt.tdma_slot}</span>
                  </span>
                </div>
                <span style={{ justifySelf: "end" }}>{!hasError && <CrcBadge hex={pkt.hex} compact />}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: hasError ? "var(--red)" : "var(--text-primary)", fontWeight: 700, textAlign: "right" }}>{hasError ? "ERR" : `${pkt.byte_len} B`}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-dim)", textAlign: "right" }}>L{pkt.line_num}</span>
                <span style={{ color: "var(--text-dim)", fontSize: 10, textAlign: "center", transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "none" }}>▾</span>
              </div>

              {isOpen && (
                <div style={{ padding: "0 12px 12px", borderTop: `1px solid ${accentVar}44`, animation: "fade-up 0.2s ease" }}>
                  {fields && fields.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.12em", marginBottom: 6, paddingBottom: 4, borderBottom: "1px solid var(--border)" }}>
                        ◈ DECODED RADIO PACKET FIELDS · §{pkt.pkt_type === 9?"C.4.2":pkt.pkt_type===10?"C.4.3":pkt.pkt_type===11?"C.4.4":pkt.pkt_type===12?"C.4.5":"C.4.6"}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "5px 12px" }}>
                        {fields.map((f, fi) => (
                          <div key={fi} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-dim)", letterSpacing: "0.04em", flexShrink: 0 }}>{f.label}</span>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, color: FIELD_COLOR[f.color] || "var(--text-primary)", textAlign: "right", wordBreak: "break-word" }}>{String(f.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!hasError && hexPairs.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.12em", marginBottom: 6, paddingBottom: 4, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span>▦ RAW HEX PAYLOAD — {pkt.byte_len} BYTES</span>
                        <CrcBadge hex={pkt.hex} />
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-code)", lineHeight: 1.8, wordBreak: "break-all", letterSpacing: "0.1em", background: "var(--bg-input)", padding: "8px 10px", borderRadius: 4, border: "1px solid var(--border)" }}>
                        {hexPairs.map((byte, bi) => (
                          <span key={bi}>
                            <span style={{ color: bi===0?"var(--amber)":bi===1?"var(--cyan)":bi>=pkt.byte_len-3?"var(--purple)":"var(--text-code)", padding: "0 1px" }}>{byte}</span>
                            {bi < hexPairs.length-1 && " "}
                            {(bi+1)%16===0 && bi < hexPairs.length-1 && <span style={{ display: "inline-block", width: "100%" }} />}
                          </span>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 12, marginTop: 5, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-dim)" }}>
                        <span><span style={{ color: "var(--amber)" }}>■</span> PKT TYPE</span>
                        <span><span style={{ color: "var(--cyan)" }}>■</span> SRC ID</span>
                        <span><span style={{ color: "var(--purple)" }}>■</span> CRC / CBC-MAC</span>
                      </div>
                    </div>
                  )}

                  {/* On-air bytes: §C.3.2.12 SOF prefix (0xF1/0xF2 0xA5 0xC3)
                      + the packet above. Never included in PKT_CRC/MAC —
                      shown separately so it's clear it's modem framing,
                      not part of the packet payload. */}
                  {!hasError && pkt.ota_hex && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.12em", marginBottom: 6, paddingBottom: 4, borderBottom: "1px solid var(--border)" }}>
                        📡 ON-AIR BYTES — RADIO{pkt.radio_id ?? "?"} · {pkt.ota_byte_len ?? pkt.byte_len} BYTES
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-code)", lineHeight: 1.8, wordBreak: "break-all", letterSpacing: "0.1em", background: "var(--bg-input)", padding: "8px 10px", borderRadius: 4, border: "1px solid var(--border)" }}>
                        <span style={{ color: "var(--red)", fontWeight: 700 }}>
                          {pkt.frame_prefix.match(/.{1,2}/g)?.join(" ")}
                        </span>{" "}
                        {pkt.hex.match(/.{1,2}/g)?.join(" ")}
                      </div>
                      <div style={{ marginTop: 5, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-dim)" }}>
                        <span style={{ color: "var(--red)" }}>■</span> SOF prefix (0x{pkt.frame_prefix}) — Annexure-C §C.3.2.12, never part of PKT_CRC/MAC
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SHARED COMPONENTS
 * ═══════════════════════════════════════════════════════════════════════════ */

function DataTable({ headers, rows }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "var(--font-mono)" }}>
      <thead>
        <tr style={{ background: "var(--th-bg)" }}>
          {headers.map(h => <th key={h} style={{ padding: "4px 8px", textAlign: "left", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 9, letterSpacing: "0.06em" }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="data-row" style={{ background: ri%2?"var(--row-alt)":"transparent" }}>
            {row.map((cell, ci) => <td key={ci} style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)22" }}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MetaKV({ label, value, color = "green" }) {
  const c = ACCENT[color] || ACCENT.green;
  return (
    <div style={{ fontSize: 10, fontFamily: "var(--font-mono)" }}>
      <span style={{ color: "var(--text-muted)", fontSize: 9, letterSpacing: "0.06em" }}>{label}: </span>
      <span style={{ color: c.text, fontWeight: 700 }}>{value ?? "—"}</span>
    </div>
  );
}

/* ── Distant goods train for the SVK idle scene's far line ───────────────
   Drawn facing LEFT with the loco front at x = 0 and the rake extending to
   the right; R is the far line's rail-top y. Indian-Railways style:
     WDG-4 type diesel loco — low short hood (nose), cab, long hood with
       grilles + roof fans, two 3-axle bogies, fuel tank, headlight beam
     BOXN open wagons (coal-loaded or empty), BCN covered wagons,
     BTPN tank wagons, and a BVZI brake van last with the blinking red
     tail lamp + LV ("last vehicle") board. */
const GD_LOCO_L = 76, GD_PITCH = 46, GD_VAN_L = 38;
const GD_RAKE = ["boxn", "boxn", "boxn", "boxe", "bcn", "bcn", "bcn", "tank", "tank", "tank", "tank", "boxn", "boxn", "boxe", "bcn", "boxn"];
const GD_LEN = GD_LOCO_L + GD_RAKE.length * GD_PITCH + GD_VAN_L;

function ScGoodsWagonBase({ R, len = 43 }) {
  const bog = [7, len - 7];
  return (
    <g>
      <rect x={-3} y={R - 9.6} width={4} height={1.3} fill="var(--sc-gd-edge)"/>
      <rect x={1} y={R - 10} width={len - 2} height={2.2} fill="var(--sc-gd-wheel)"/>
      {bog.map(c => (
        <g key={c}>
          <rect x={c - 6} y={R - 7.4} width={12} height={2.4} rx={0.8} fill="var(--sc-gd-wheel)"/>
          {[c - 3.3, c + 3.3].map(x => <g key={x}><circle cx={x} cy={R - 2.7} r={2.6} fill="var(--sc-gd-wheel)" stroke="var(--sc-gd-edge)" strokeWidth={0.5}/><circle cx={x} cy={R - 2.7} r={0.8} fill="var(--sc-gd-edge)"/></g>)}
        </g>
      ))}
    </g>
  );
}

function ScGoodsWagon({ type, R }) {
  const ribs = (y1, y2, step = 4.6, from = 4.5, to = 40) =>
    Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, k) =>
      <line key={k} x1={from + k * step} y1={y1} x2={from + k * step} y2={y2} stroke="var(--sc-gd-edge)" strokeWidth={0.7} strokeOpacity={0.55}/>);
  if (type === "tank") return (
    <g>
      <ScGoodsWagonBase R={R}/>
      <rect x={6} y={R - 13} width={4} height={4} fill="var(--sc-gd-wheel)"/><rect x={33} y={R - 13} width={4} height={4} fill="var(--sc-gd-wheel)"/>
      <rect x={2} y={R - 25} width={39} height={13} rx={6.5} fill="var(--sc-gd-tank)" stroke="var(--sc-gd-edge)" strokeWidth={0.6}/>
      <line x1={9} y1={R - 24.5} x2={9} y2={R - 12.5} stroke="var(--sc-gd-edge)" strokeWidth={0.8} strokeOpacity={0.7}/>
      <line x1={34} y1={R - 24.5} x2={34} y2={R - 12.5} stroke="var(--sc-gd-edge)" strokeWidth={0.8} strokeOpacity={0.7}/>
      <line x1={5} y1={R - 21.5} x2={38} y2={R - 21.5} stroke="var(--sc-gd-edge)" strokeWidth={0.5} strokeOpacity={0.4}/>
      <rect x={18.5} y={R - 28} width={6} height={3.4} rx={0.8} fill="var(--sc-gd-tank)" stroke="var(--sc-gd-edge)" strokeWidth={0.6}/>
      <line x1={21.5} y1={R - 25} x2={21.5} y2={R - 11} stroke="var(--sc-gd-edge)" strokeWidth={0.5} strokeDasharray="1,1.2"/>
    </g>
  );
  if (type === "bcn") return (
    <g>
      <ScGoodsWagonBase R={R}/>
      <rect x={1} y={R - 28} width={41} height={18} fill="var(--sc-gd-wagon-2)" stroke="var(--sc-gd-edge)" strokeWidth={0.6}/>
      <path d={`M0.5,${R - 28} Q21.5,${R - 32.5} 42.5,${R - 28} Z`} fill="var(--sc-gd-wagon-2)" stroke="var(--sc-gd-edge)" strokeWidth={0.6}/>
      {ribs(R - 27.5, R - 10.5, 4.6, 4, 13)}{ribs(R - 27.5, R - 10.5, 4.6, 30, 40)}
      <line x1={13} y1={R - 27.2} x2={30} y2={R - 27.2} stroke="var(--sc-gd-edge)" strokeWidth={0.9}/>
      <rect x={15} y={R - 26} width={13} height={15} fill="none" stroke="var(--sc-gd-edge)" strokeWidth={0.7}/>
      <line x1={21.5} y1={R - 26} x2={21.5} y2={R - 11} stroke="var(--sc-gd-edge)" strokeWidth={0.5} strokeOpacity={0.6}/>
    </g>
  );
  // BOXN open wagon — "boxe" is the empty one
  return (
    <g>
      <ScGoodsWagonBase R={R}/>
      {type === "boxn" && <path d={`M2,${R - 25} Q7,${R - 30.5} 12,${R - 27} Q18,${R - 31.5} 24,${R - 27.5} Q30,${R - 31} 35,${R - 27} Q39,${R - 29} 41,${R - 25} Z`} fill="var(--sc-gd-load)"/>}
      <rect x={1} y={R - 25} width={41} height={15} fill="var(--sc-gd-wagon)" stroke="var(--sc-gd-edge)" strokeWidth={0.6}/>
      <rect x={0.5} y={R - 26.2} width={42} height={1.6} fill="var(--sc-gd-edge)"/>
      {ribs(R - 24.6, R - 10.5)}
    </g>
  );
}

function ScGoodsVan({ R }) {
  return (
    <g>
      <ScGoodsWagonBase R={R} len={GD_VAN_L - 2}/>
      <rect x={6} y={R - 27} width={24} height={17} fill="var(--sc-gd-van)" stroke="var(--sc-gd-edge)" strokeWidth={0.6}/>
      <path d={`M3.5,${R - 27} Q18,${R - 31} 32.5,${R - 27} Z`} fill="var(--sc-gd-van)" stroke="var(--sc-gd-edge)" strokeWidth={0.6}/>
      <rect x={14} y={R - 31.5} width={8} height={3.5} rx={0.8} fill="var(--sc-gd-van)" stroke="var(--sc-gd-edge)" strokeWidth={0.6}/>
      <rect x={9} y={R - 24} width={5} height={5} rx={0.6} fill="var(--sc-win)" opacity={0.7} className="sc-win" style={{ animationDelay: "2.3s" }}/>
      <rect x={22} y={R - 24} width={5} height={5} rx={0.6} fill="var(--sc-win)" opacity={0.55}/>
      <rect x={15.5} y={R - 23} width={5} height={12.5} fill="none" stroke="var(--sc-gd-edge)" strokeWidth={0.6}/>
      {/* open verandahs with hand-railings at both ends */}
      {[[1, 6], [30, 35]].map(([a, b]) => (
        <g key={a} stroke="var(--sc-gd-edge)" strokeWidth={0.6}>
          <line x1={a} y1={R - 19} x2={b} y2={R - 19}/><line x1={a} y1={R - 19} x2={a} y2={R - 10}/><line x1={(a + b) / 2} y1={R - 19} x2={(a + b) / 2} y2={R - 10}/>
        </g>
      ))}
      {/* LV board + blinking red tail lamp at the very end */}
      <circle cx={33} cy={R - 15} r={1.7} fill="#f8fafc" stroke="var(--sc-gd-tail)" strokeWidth={0.8}/>
      <circle cx={36.4} cy={R - 22} r={5} fill="var(--sc-gd-tail)" opacity={0.35} filter="url(#scBlur)" className="sc-blink"/>
      <circle cx={36.4} cy={R - 22} r={1.5} fill="var(--sc-gd-tail)" className="sc-blink"/>
    </g>
  );
}

function ScGoodsLoco({ R }) {
  return (
    <g>
      {/* headlight beam ahead (to the left) */}
      <polygon points={`2,${R - 27} 2,${R - 21} -130,${R - 6} -130,${R - 44}`} fill="url(#scGdHead)" opacity={0.35} className="sc-head"/>
      {/* bogies (3 axles each) + underframe + fuel tank */}
      {[16, 58].map(c => (
        <g key={c}>
          <rect x={c - 12} y={R - 8.2} width={24} height={3} rx={1} fill="var(--sc-gd-wheel)"/>
          {[c - 8, c, c + 8].map(x => <g key={x}><circle cx={x} cy={R - 3.2} r={3.1} fill="var(--sc-gd-wheel)" stroke="var(--sc-gd-edge)" strokeWidth={0.5}/><circle cx={x} cy={R - 3.2} r={0.9} fill="var(--sc-gd-edge)"/></g>)}
        </g>
      ))}
      <rect x={2} y={R - 13} width={71} height={4.6} fill="var(--sc-gd-wheel)"/>
      <rect x={28} y={R - 11} width={20} height={6} rx={3} fill="var(--sc-gd-loco-2)" stroke="var(--sc-gd-edge)" strokeWidth={0.5}/>
      {/* short hood (nose) → cab → long hood */}
      <path d={`M2,${R - 13} V${R - 24} Q2,${R - 27} 5,${R - 27} H15 V${R - 13} Z`} fill="var(--sc-gd-loco)" stroke="var(--sc-gd-loco-edge)" strokeWidth={0.6}/>
      <path d={`M14,${R - 13} V${R - 35.5} Q14,${R - 38} 16.5,${R - 38} H27.5 Q29.5,${R - 38} 29.5,${R - 36} V${R - 13} Z`} fill="var(--sc-gd-loco)" stroke="var(--sc-gd-loco-edge)" strokeWidth={0.6}/>
      <path d={`M29,${R - 13} V${R - 30} H71 Q73,${R - 30} 73,${R - 28} V${R - 13} Z`} fill="var(--sc-gd-loco)" stroke="var(--sc-gd-loco-edge)" strokeWidth={0.6}/>
      {/* cab windows */}
      <rect x={15.6} y={R - 35} width={5.2} height={6} rx={0.8} fill="var(--sc-win)" opacity={0.8}/>
      <rect x={22.4} y={R - 35} width={5.2} height={6} rx={0.8} fill="var(--sc-win)" opacity={0.5}/>
      {/* long-hood doors, radiator grille, roof fans + exhaust stack */}
      {Array.from({ length: 5 }, (_, k) => <rect key={k} x={31.5 + k * 5.6} y={R - 27.5} width={4.4} height={9} rx={0.4} fill="none" stroke="var(--sc-gd-loco-edge)" strokeWidth={0.5} strokeOpacity={0.7}/>)}
      {Array.from({ length: 6 }, (_, k) => <line key={k} x1={60 + k * 2} y1={R - 28} x2={60 + k * 2} y2={R - 18.5} stroke="var(--sc-gd-loco-edge)" strokeWidth={0.6} strokeOpacity={0.8}/>)}
      <rect x={55} y={R - 32} width={7} height={2} rx={1} fill="var(--sc-gd-loco-2)"/><rect x={64} y={R - 32} width={7} height={2} rx={1} fill="var(--sc-gd-loco-2)"/>
      <rect x={40} y={R - 33} width={3.2} height={3} fill="var(--sc-gd-wheel)"/>
      {/* livery stripe + handrail */}
      <rect x={2} y={R - 18.5} width={71} height={1.8} fill="var(--sc-gd-stripe)" opacity={0.85}/>
      <line x1={30} y1={R - 15.5} x2={72} y2={R - 15.5} stroke="var(--sc-gd-loco-edge)" strokeWidth={0.5}/>
      {/* headlight + ditch lights */}
      <circle cx={3} cy={R - 24} r={1.6} fill="var(--sc-head)"/>
      <circle cx={2.6} cy={R - 15} r={0.9} fill="var(--sc-head)" opacity={0.85}/>
      {/* diesel exhaust drifting back */}
      {[0, 1.1, 2.2].map(d => <circle key={d} cx={41.6} cy={R - 35} r={2.2} fill="var(--sc-gd-smoke)" className="sc-exhaust" style={{ animationDelay: `${d}s` }}/>)}
      <rect x={73} y={R - 9.6} width={3} height={1.3} fill="var(--sc-gd-edge)"/>
    </g>
  );
}

function ScGoodsTrain({ R }) {
  return (
    <g>
      <ScGoodsLoco R={R}/>
      {GD_RAKE.map((t, i) => <g key={i} transform={`translate(${GD_LOCO_L + i * GD_PITCH},0)`}><ScGoodsWagon type={t} R={R}/></g>)}
      <g transform={`translate(${GD_LOCO_L + GD_RAKE.length * GD_PITCH},0)`}><ScGoodsVan R={R}/></g>
    </g>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SVK SIM IDLE SCENE (v2) — shown in UDP / HTTP while nothing is transmitting.
 *
 * A full-bleed cinematic KAVACH vignette:
 *   sky (moon, stars, shooting star, aurora) · far hills with town lights ·
 *   near hills · drifting ground fog · a distant goods train on a far line ·
 *   catenary · STN 523 (platform, lamps, radio mast + radar sweep) and a
 *   distant STN 524 · electric loco #12799 + 3 coaches with a telemetry card.
 *
 * Story of one run (SCENE_T s): the loco enters, STN 523's radio link comes
 * alive (S2L C.4.2 cyan / L2S C.4.3 green), RFID tags flash + label as the
 * loco crosses them, home signals drop to red behind the train, and mid-run
 * the link HANDS OVER to STN 524 — as KAVACH does between stations.
 *
 * Everything synced to the train runs on ONE SMIL clock (SCENE_T); ambient
 * effects are CSS. The art is drawn in a 1400×720 frame and fills the panel
 * ("slice"); the action stays inside the central safe zone. Theme-aware via
 * --sc-* variables; fully static when the OS asks for reduced motion.
 * ═══════════════════════════════════════════════════════════════════════════ */
const SCENE_T = 18;                       // seconds for one train run
const SCENE_REDUCED = typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const SCENE_CSS = `
  .svk-scene {
    --sc-sky-1: #02040b; --sc-sky-2: #071027; --sc-sky-3: #0d1c3a; --sc-aurora: #22d3ee;
    --sc-hill-far: #0b1730; --sc-hill-near: #0f2142; --sc-ground: #05080f; --sc-ground-2: #0a1120;
    --sc-rail: #7b8aa8; --sc-sleeper: #1a2438; --sc-mast: #3a4a68; --sc-wire: #8696b6;
    --sc-bldg: #0f1a30; --sc-bldg-2: #14223d; --sc-bldg-edge: #2b4170; --sc-plat: #1c2944; --sc-plat-edge: #facc15;
    --sc-win: #fcd34d; --sc-text: #a9bddc; --sc-text-dim: #5a6b8c; --sc-moon: #f1f5f9;
    --sc-loco: #38bdf8; --sc-loco-body: #0b4f7d; --sc-loco-body-2: #083a5e; --sc-stripe: #f8fafc; --sc-stripe-2: #facc15;
    --sc-coach: #17375c; --sc-coach-2: #10294a; --sc-fog: #93c5fd;
    --sc-s2l: #22d3ee; --sc-l2s: #34d399; --sc-tag: #bef264; --sc-star: #e2e8f0; --sc-head: #fef9c3;
    --sc-vignette: #000000; --sc-title-bg: #02040b;
    --sc-gd-loco: #1f4a7a; --sc-gd-loco-2: #163a61; --sc-gd-loco-edge: #6f93c2; --sc-gd-stripe: #e8d9a8;
    --sc-gd-wagon: #5b3b2c; --sc-gd-wagon-2: #4b3126; --sc-gd-tank: #262c38; --sc-gd-load: #0b0d12;
    --sc-gd-van: #6a3027; --sc-gd-edge: #8b6d58; --sc-gd-wheel: #070b14; --sc-gd-tail: #ef4444; --sc-gd-smoke: #94a3b8;
  }
  :root.light .svk-scene {
    --sc-sky-1: #cfe0f5; --sc-sky-2: #e3ecf8; --sc-sky-3: #f5f8fd; --sc-aurora: #38bdf8;
    --sc-hill-far: #c3d2e8; --sc-hill-near: #aec0dc; --sc-ground: #cdd7e5; --sc-ground-2: #dfe6f0;
    --sc-rail: #5b6b84; --sc-sleeper: #a3b1c6; --sc-mast: #8393ad; --sc-wire: #5b6b84;
    --sc-bldg: #eef3fa; --sc-bldg-2: #e2e9f4; --sc-bldg-edge: #8fa3c2; --sc-plat: #d5deeb; --sc-plat-edge: #d97706;
    --sc-win: #f59e0b; --sc-text: #334155; --sc-text-dim: #64748b; --sc-moon: #fbbf24;
    --sc-loco: #0284c7; --sc-loco-body: #0369a1; --sc-loco-body-2: #075985; --sc-stripe: #ffffff; --sc-stripe-2: #f59e0b;
    --sc-coach: #3b6ea8; --sc-coach-2: #2f5d93; --sc-fog: #ffffff;
    --sc-s2l: #0891b2; --sc-l2s: #059669; --sc-tag: #65a30d; --sc-star: #94a3b8; --sc-head: #fde68a;
    --sc-vignette: #64748b; --sc-title-bg: #f5f8fd;
    --sc-gd-loco: #3a6ea8; --sc-gd-loco-2: #2d5b8e; --sc-gd-loco-edge: #1e3a5f; --sc-gd-stripe: #fef3c7;
    --sc-gd-wagon: #9c6b52; --sc-gd-wagon-2: #87594a; --sc-gd-tank: #5d6574; --sc-gd-load: #3b3e46;
    --sc-gd-van: #a4483a; --sc-gd-edge: #5b4334; --sc-gd-wheel: #334155; --sc-gd-tail: #dc2626; --sc-gd-smoke: #94a3b8;
  }
  @keyframes scTwinkle { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.95; } }
  .sc-star { animation: scTwinkle 3.4s ease-in-out infinite; }
  @keyframes scShoot { 0%, 86% { opacity: 0; transform: translate(0,0); } 88% { opacity: 1; } 96% { opacity: 0; transform: translate(-260px, 120px); } 100% { opacity: 0; transform: translate(-260px, 120px); } }
  .sc-shoot { animation: scShoot 11s linear infinite; }
  @keyframes scAurora { 0%, 100% { opacity: 0.10; transform: translateX(0) scaleY(1); } 50% { opacity: 0.22; transform: translateX(-40px) scaleY(1.15); } }
  .sc-aurora { animation: scAurora 14s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes scDriftFar { from { transform: translateX(0); } to { transform: translateX(-70px); } }
  @keyframes scDriftNear { from { transform: translateX(0); } to { transform: translateX(-140px); } }
  .sc-hill-far { animation: scDriftFar 50s ease-in-out infinite alternate; }
  .sc-hill-near { animation: scDriftNear 50s ease-in-out infinite alternate; }
  @keyframes scFog { from { transform: translateX(-120px); } to { transform: translateX(120px); } }
  .sc-fog { animation: scFog 26s ease-in-out infinite alternate; }
  @keyframes scRing { 0% { transform: scale(0.15); opacity: 0.9; } 100% { transform: scale(1); opacity: 0; } }
  .sc-ring { animation: scRing 2.6s ease-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes scSweep { to { transform: rotate(360deg); } }
  .sc-sweep { animation: scSweep 4s linear infinite; transform-box: view-box; }
  @keyframes scFlowS2L { to { stroke-dashoffset: -32; } }
  @keyframes scFlowL2S { to { stroke-dashoffset: 32; } }
  .sc-s2l { animation: scFlowS2L 0.6s linear infinite; }
  .sc-l2s { animation: scFlowL2S 0.6s linear infinite; }
  @keyframes scHead { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.9; } }
  .sc-head { animation: scHead 1.3s ease-in-out infinite; }
  @keyframes scWin { 0%, 93%, 100% { opacity: 0.92; } 96% { opacity: 0.35; } }
  .sc-win { animation: scWin 7s steps(1, end) infinite; }
  @keyframes scLamp { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.85; } }
  .sc-lamp { animation: scLamp 3.6s ease-in-out infinite; }
  @keyframes scTdma { to { stroke-dashoffset: -88; } }
  .sc-tdma { animation: scTdma 2s linear infinite; }
  @keyframes scTitle { 0%, 100% { text-shadow: 0 0 14px rgba(34,211,238,0.35); } 50% { text-shadow: 0 0 28px rgba(34,211,238,0.8); } }
  .sc-title { animation: scTitle 3.5s ease-in-out infinite; }
  @keyframes scBlink { 50% { opacity: 0; } }
  .sc-blink { animation: scBlink 1.1s step-end infinite; }
  @keyframes scExhaust { 0% { opacity: 0.45; transform: translate(0, 0) scale(0.5); } 100% { opacity: 0; transform: translate(16px, -16px) scale(2); } }
  .sc-exhaust { animation: scExhaust 3.3s ease-out infinite; transform-box: fill-box; transform-origin: center; opacity: 0; }
  @media (prefers-reduced-motion: reduce) {
    .sc-star, .sc-shoot, .sc-aurora, .sc-hill-far, .sc-hill-near, .sc-fog, .sc-ring, .sc-sweep, .sc-s2l, .sc-l2s,
    .sc-head, .sc-win, .sc-lamp, .sc-tdma, .sc-title, .sc-blink, .sc-exhaust { animation: none; }
    .sc-shoot { opacity: 0; }
  }
`;

function SvkIdleScene({ lines = [] }) {
  const W = 1400, H = 720;
  const G = 572;                            // rail-top line
  const STN1 = 520, STN2 = 1010;            // station centres (STN 523 near, STN 524 distant)
  const ANT1 = { x: STN1 + 150, y: 190 };   // STN 523 mast top (beside the building)
  const ANT2 = { x: STN2 + 70, y: 300 };    // STN 524 mast top (smaller, further)
  const RUN_FROM = -20, RUN_LEN = 1900;     // loco FRONT x: -20 → 1880 over SCENE_T
  const LOCO_ANT_DX = -86;                  // loco roof antenna, relative to the front
  const frac = x => Math.min(0.999, Math.max(0.001, (x - RUN_FROM) / RUN_LEN));
  const f3 = v => v.toFixed(3);
  const motion = !SCENE_REDUCED;
  const T = `${SCENE_T}s`;

  const stars = Array.from({ length: 70 }, (_, i) => ({ x: (i * 227.3) % W, y: 10 + ((i * 89.7) % 240), r: i % 9 === 0 ? 1.6 : 0.9, d: (i % 11) * 0.31 }));
  const townLights = Array.from({ length: 26 }, (_, i) => ({ x: 120 + ((i * 131.7) % 1380), y: G - 150 + ((i * 37) % 26), d: (i % 7) * 0.5 }));
  const masts = Array.from({ length: 10 }, (_, i) => 30 + i * 160);
  const tags = [{ x: 300, id: 498 }, { x: 420, id: 500 }, { x: 760, id: 502 }, { x: 900, id: 504 }, { x: 1120, id: 506 }];

  // radio link windows (loco FRONT position) — STN 523 first, then handover to STN 524
  const win = (a, b) => `0;${f3(frac(a))};${f3(frac(a + 50))};${f3(frac(b - 50))};${f3(frac(b))};1`;
  const link1KT = win(200, 900), link2KT = win(860, 1560);
  // home signals: green → red once the train is past (block occupied) → yellow → green
  const sigKT = x => { const p = frac(x + 10); return `0;${f3(p)};${f3(Math.min(0.97, p + 0.2))};${f3(Math.min(0.99, p + 0.34))};1`; };

  const Wheel = ({ cx, r = 6.5 }) => (
    <g transform={`translate(${cx},${G - r})`}>
      <circle r={r} fill="#0b1220" stroke="var(--sc-rail)" strokeWidth={1.4}/>
      <g>
        <line x1={-r + 1.5} y1={0} x2={r - 1.5} y2={0} stroke="var(--sc-rail)" strokeWidth={1}/>
        <line x1={0} y1={-r + 1.5} x2={0} y2={r - 1.5} stroke="var(--sc-rail)" strokeWidth={1}/>
        {motion && <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.5s" repeatCount="indefinite"/>}
      </g>
      <circle r={1.6} fill="var(--sc-rail)"/>
    </g>
  );
  const Coach = ({ x }) => (
    <g>
      <path d={`M${x},${G - 14} V${G - 58} Q${x},${G - 64} ${x + 8},${G - 64} H${x + 96} Q${x + 104},${G - 64} ${x + 104},${G - 58} V${G - 14} Z`}
        fill="var(--sc-coach)" stroke="var(--sc-loco)" strokeOpacity={0.35}/>
      <rect x={x + 2} y={G - 62} width={100} height={5} rx={2.5} fill="var(--sc-coach-2)"/>
      {[0, 1, 2, 3, 4].map(k => (
        <rect key={k} x={x + 18 + k * 14.5} y={G - 51} width={10} height={11} rx={1.5} fill="var(--sc-win)" opacity={0.85}
          className="sc-win" style={{ animationDelay: `${(x + k) % 7}s` }}/>
      ))}
      <rect x={x + 5} y={G - 52} width={8} height={30} rx={1} fill="var(--sc-coach-2)" stroke="var(--sc-loco)" strokeOpacity={0.3}/>
      <rect x={x + 91} y={G - 52} width={8} height={30} rx={1} fill="var(--sc-coach-2)" stroke="var(--sc-loco)" strokeOpacity={0.3}/>
      <rect x={x} y={G - 32} width={104} height={2.5} fill="var(--sc-stripe-2)" opacity={0.75}/>
      <rect x={x} y={G - 28} width={104} height={1.5} fill="var(--sc-stripe)" opacity={0.6}/>
      <rect x={x + 10} y={G - 17} width={28} height={5} rx={1} fill="#0b1220"/><rect x={x + 66} y={G - 17} width={28} height={5} rx={1} fill="#0b1220"/>
      <Wheel cx={x + 16}/><Wheel cx={x + 32}/><Wheel cx={x + 72}/><Wheel cx={x + 88}/>
    </g>
  );
  const Signal = ({ x, scale = 1 }) => (
    <g transform={`translate(${x},${G}) scale(${scale}) translate(${-x},${-G})`}>
      <line x1={x} y1={G + 4} x2={x} y2={G - 92} stroke="var(--sc-mast)" strokeWidth={3}/>
      <rect x={x - 10} y={G - 140} width={20} height={50} rx={9} fill="#0b1220" stroke="var(--sc-mast)"/>
      {[["#ef4444", [0.15, 1, 0.15, 0.15, 0.15]], ["#facc15", [0.15, 0.15, 1, 0.15, 0.15]], ["#22c55e", [1, 0.15, 0.15, 1, 1]]].map(([c, vals], k) => (
        <g key={k}>
          <circle cx={x} cy={G - 128 + k * 13} r={9} fill={c} opacity={0} filter="url(#scBlur)">
            {motion && <animate attributeName="opacity" values={vals.map(v => (v === 1 ? 0.7 : 0)).join(";")} keyTimes={sigKT(x)} calcMode="discrete" dur={T} repeatCount="indefinite"/>}
          </circle>
          <circle cx={x} cy={G - 128 + k * 13} r={5} fill={c} opacity={k === 2 ? 1 : 0.15}>
            {motion && <animate attributeName="opacity" values={vals.join(";")} keyTimes={sigKT(x)} calcMode="discrete" dur={T} repeatCount="indefinite"/>}
          </circle>
        </g>
      ))}
    </g>
  );
  const Mast = ({ ant, h, scale = 1, ringR = 90, name }) => (
    <g>
      <line x1={ant.x} y1={ant.y + 10} x2={ant.x} y2={ant.y + h} stroke="var(--sc-mast)" strokeWidth={3.2 * scale}/>
      {Array.from({ length: Math.floor(h / 22) }, (_, k) => (
        <path key={k} d={`M${ant.x - 8 * scale},${ant.y + 18 + k * 22} L${ant.x + 8 * scale},${ant.y + 40 + k * 22} M${ant.x + 8 * scale},${ant.y + 18 + k * 22} L${ant.x - 8 * scale},${ant.y + 40 + k * 22}`}
          stroke="var(--sc-mast)" strokeWidth={0.9} opacity={0.8}/>
      ))}
      <circle cx={ant.x} cy={ant.y} r={34 * scale} fill="url(#scGlow)"/>
      {/* rotating radar sweep */}
      <g className="sc-sweep" style={{ transformOrigin: `${ant.x}px ${ant.y}px` }}>
        <path d={`M${ant.x},${ant.y} L${ant.x + ringR * 0.8},${ant.y - 22 * scale} A${ringR * 0.83},${ringR * 0.83} 0 0 1 ${ant.x + ringR * 0.8},${ant.y + 22 * scale} Z`} fill="url(#scSweepGrad)" opacity={0.55}/>
      </g>
      {[0, 0.85, 1.7].map(d => <circle key={d} cx={ant.x} cy={ant.y} r={ringR} fill="none" stroke="var(--sc-s2l)" strokeWidth={1.3} className="sc-ring" style={{ animationDelay: `${d}s` }}/>)}
      <path d={`M${ant.x - 12 * scale},${ant.y - 6 * scale} A${14 * scale},${14 * scale} 0 0 0 ${ant.x + 12 * scale},${ant.y + 8 * scale}`} fill="none" stroke="var(--sc-s2l)" strokeWidth={3.2 * scale} strokeLinecap="round"/>
      <circle cx={ant.x} cy={ant.y} r={3.2 * scale} fill="var(--sc-s2l)"/>
      <circle cx={ant.x} cy={ant.y - 20 * scale} r={2.6 * scale} fill="#ef4444">{motion && <animate attributeName="opacity" values="1;0.15;1" dur="1.2s" repeatCount="indefinite"/>}</circle>
      {name && <text x={ant.x} y={ant.y - 30 * scale} textAnchor="middle" fontSize={9 * scale + 1} fontWeight={700} letterSpacing={1.2} fill="var(--sc-s2l)" fontFamily="var(--font-mono)">{name}</text>}
    </g>
  );
  // radio beam pair (S2L + L2S) from a mast to the moving loco antenna
  const Link = ({ ant, kt, labelDx = 26 }) => (
    <g opacity={motion ? 0 : 0.9}>
      {motion && <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes={kt} dur={T} repeatCount="indefinite"/>}
      {[{ cls: "sc-s2l", col: "var(--sc-s2l)", dy: -3, w: 2.4 }, { cls: "sc-l2s", col: "var(--sc-l2s)", dy: 4, w: 1.8 }].map(b => (
        <g key={b.cls}>
          <line x1={ant.x} y1={ant.y + b.dy} x2={RUN_FROM + LOCO_ANT_DX} y2={G - 76 + b.dy} stroke={b.col} strokeWidth={b.w * 3.2} opacity={0.18} filter="url(#scBlur)">
            {motion && <animate attributeName="x2" from={RUN_FROM + LOCO_ANT_DX} to={RUN_FROM + RUN_LEN + LOCO_ANT_DX} dur={T} repeatCount="indefinite"/>}
          </line>
          <line x1={ant.x} y1={ant.y + b.dy} x2={RUN_FROM + LOCO_ANT_DX} y2={G - 76 + b.dy} stroke={b.col} strokeWidth={b.w} strokeDasharray="7,9" strokeLinecap="round" className={b.cls}>
            {motion && <animate attributeName="x2" from={RUN_FROM + LOCO_ANT_DX} to={RUN_FROM + RUN_LEN + LOCO_ANT_DX} dur={T} repeatCount="indefinite"/>}
          </line>
        </g>
      ))}
      <g transform={`translate(${ant.x + labelDx},${ant.y - 34})`} fontFamily="var(--font-mono)" fontSize={10} fontWeight={700}>
        <rect x={-6} y={-13} width={182} height={36} rx={6} fill="var(--sc-sky-1)" opacity={0.78} stroke="var(--sc-s2l)" strokeOpacity={0.45}/>
        <text fill="var(--sc-s2l)" letterSpacing={0.8}>▸ S2L · C.4.2 · MA / SSP</text>
        <text y={15} fill="var(--sc-l2s)" letterSpacing={0.8}>◂ L2S · C.4.3 · LOCO POS</text>
      </g>
    </g>
  );

  return (
    <div className="svk-scene" style={{ position: "relative", height: "100%", width: "100%", overflow: "hidden", background: "var(--sc-sky-1)" }}>
      <style>{SCENE_CSS}</style>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}>
        <defs>
          <linearGradient id="scSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--sc-sky-1)"/><stop offset="60%" stopColor="var(--sc-sky-2)"/><stop offset="100%" stopColor="var(--sc-sky-3)"/>
          </linearGradient>
          <linearGradient id="scGround" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--sc-ground-2)"/><stop offset="100%" stopColor="var(--sc-ground)"/>
          </linearGradient>
          <linearGradient id="scHead" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--sc-head)" stopOpacity="0.9"/><stop offset="100%" stopColor="var(--sc-head)" stopOpacity="0"/>
          </linearGradient>
          <linearGradient id="scLampCone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--sc-win)" stopOpacity="0.45"/><stop offset="100%" stopColor="var(--sc-win)" stopOpacity="0"/>
          </linearGradient>
          <linearGradient id="scLoco" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--sc-loco-body)"/><stop offset="100%" stopColor="var(--sc-loco-body-2)"/>
          </linearGradient>
          <linearGradient id="scGdHead" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--sc-head)" stopOpacity="0.9"/><stop offset="100%" stopColor="var(--sc-head)" stopOpacity="0"/>
          </linearGradient>
          <radialGradient id="scGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--sc-s2l)" stopOpacity="0.55"/><stop offset="100%" stopColor="var(--sc-s2l)" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="scMoon" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--sc-moon)" stopOpacity="0.5"/><stop offset="45%" stopColor="var(--sc-moon)" stopOpacity="0.12"/><stop offset="100%" stopColor="var(--sc-moon)" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="scVignette" cx="50%" cy="45%" r="75%">
            <stop offset="60%" stopColor="var(--sc-vignette)" stopOpacity="0"/><stop offset="100%" stopColor="var(--sc-vignette)" stopOpacity="0.55"/>
          </radialGradient>
          <linearGradient id="scSweepGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--sc-s2l)" stopOpacity="0.5"/><stop offset="100%" stopColor="var(--sc-s2l)" stopOpacity="0"/>
          </linearGradient>
          <pattern id="scSleepers" width="16" height="12" patternUnits="userSpaceOnUse"><rect x="2" y="0" width="10" height="12" rx="1.5" fill="var(--sc-sleeper)"/></pattern>
          <filter id="scBlur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.2"/></filter>
          <filter id="scFogBlur" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="18"/></filter>
        </defs>

        {/* ── sky ── */}
        <rect width={W} height={H} fill="url(#scSky)"/>
        <ellipse cx={820} cy={150} rx={460} ry={70} fill="var(--sc-aurora)" className="sc-aurora" filter="url(#scFogBlur)"/>
        {stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="var(--sc-star)" className="sc-star" style={{ animationDelay: `${s.d}s` }}/>)}
        <circle cx={1110} cy={118} r={90} fill="url(#scMoon)"/>
        <circle cx={1110} cy={118} r={26} fill="var(--sc-moon)" opacity={0.92}/>
        <circle cx={1101} cy={112} r={5} fill="var(--sc-sky-3)" opacity={0.18}/><circle cx={1119} cy={126} r={3.5} fill="var(--sc-sky-3)" opacity={0.15}/>
        <g className="sc-shoot"><line x1={980} y1={60} x2={1030} y2={37} stroke="var(--sc-star)" strokeWidth={1.6} strokeLinecap="round"/></g>

        {/* ── far hills, town lights, far line + goods train ── */}
        <g className="sc-hill-far">
          <path d={`M-120,${G - 110} L60,${G - 200} L220,${G - 140} L400,${G - 230} L580,${G - 150} L780,${G - 245} L980,${G - 150} L1160,${G - 215} L1360,${G - 140} L1560,${G - 205} L1760,${G - 130} L1760,${G - 90} L-120,${G - 90} Z`} fill="var(--sc-hill-far)"/>
          {townLights.map((l, i) => <circle key={i} cx={l.x} cy={l.y} r={1.3} fill="var(--sc-win)" className="sc-star" style={{ animationDelay: `${l.d}s` }} opacity={0.8}/>)}
        </g>
        <rect x={0} y={G - 92} width={W} height={1.4} fill="var(--sc-rail)" opacity={0.35}/>
        {/* distant goods train (right → left): WDG-4 loco, BOXN / BCN / BTPN rake, BVZI brake van */}
        <g opacity={0.62}>
          <g transform={`translate(${W + 140},0)`}>
            {motion && <animateTransform attributeName="transform" type="translate" from={`${W + 140} 0`} to={`${-GD_LEN - 40} 0`} dur="58s" repeatCount="indefinite"/>}
            <ScGoodsTrain R={G - 92}/>
          </g>
        </g>
        <g className="sc-hill-near">
          <path d={`M-200,${G - 40} Q0,${G - 100} 240,${G - 62} Q480,${G - 30} 720,${G - 66} Q960,${G - 98} 1200,${G - 58} Q1440,${G - 28} 1680,${G - 64} L1820,${G - 40} L1820,${G} L-200,${G} Z`} fill="var(--sc-hill-near)"/>
        </g>
        <rect x={-150} y={G - 70} width={W + 300} height={60} fill="var(--sc-fog)" opacity={0.07} filter="url(#scFogBlur)" className="sc-fog"/>

        {/* ── STN 524 (distant) ── */}
        <g opacity={0.85}>
          <rect x={STN2 - 70} y={G - 112} width={140} height={86} rx={3} fill="var(--sc-bldg)" stroke="var(--sc-bldg-edge)"/>
          <path d={`M${STN2 - 80},${G - 112} L${STN2},${G - 134} L${STN2 + 80},${G - 112} Z`} fill="var(--sc-bldg-2)" stroke="var(--sc-bldg-edge)"/>
          {[0, 1, 2, 3].map(k => <rect key={k} x={STN2 - 56 + k * 30} y={G - 100} width={16} height={18} rx={1.5} fill="var(--sc-win)" opacity={0.75} className="sc-win" style={{ animationDelay: `${k * 1.7}s` }}/>)}
          <rect x={STN2 - 52} y={G - 74} width={104} height={13} rx={2} fill="var(--sc-sky-1)" stroke="var(--sc-s2l)" strokeOpacity={0.5}/>
          <text x={STN2} y={G - 64.5} textAnchor="middle" fontSize={8} fontWeight={700} letterSpacing={1.2} fill="var(--sc-s2l)" fontFamily="var(--font-mono)">STN 524</text>
          <rect x={STN2 - 120} y={G - 26} width={240} height={12} fill="var(--sc-plat)"/>
          <Mast ant={ANT2} h={G - 26 - ANT2.y} scale={0.75} ringR={70}/>
        </g>

        {/* ── catenary ── */}
        {masts.map(x => (
          <g key={x}>
            <line x1={x} y1={G + 6} x2={x} y2={G - 150} stroke="var(--sc-mast)" strokeWidth={3.2}/>
            <line x1={x - 2} y1={G - 142} x2={x + 30} y2={G - 142} stroke="var(--sc-mast)" strokeWidth={2.2}/>
            <line x1={x + 22} y1={G - 142} x2={x + 22} y2={G - 128} stroke="var(--sc-mast)" strokeWidth={1}/>
          </g>
        ))}
        <path d={`M0,${G - 128} ${masts.map(x => `Q${x - 58},${G - 121} ${x + 22},${G - 128}`).join(" ")} L${W},${G - 128}`} fill="none" stroke="var(--sc-wire)" strokeWidth={1.3} opacity={0.8}/>

        {/* ── STN 523: platform, two-storey building, lamps, mast ── */}
        <g>
          <rect x={STN1 - 230} y={G - 30} width={460} height={16} fill="var(--sc-plat)" stroke="var(--sc-bldg-edge)" strokeWidth={1}/>
          <rect x={STN1 - 230} y={G - 16} width={460} height={2.5} fill="var(--sc-plat-edge)" opacity={0.85}/>
          <rect x={STN1 - 120} y={G - 210} width={240} height={180} rx={4} fill="var(--sc-bldg)" stroke="var(--sc-bldg-edge)" strokeWidth={1.4}/>
          <path d={`M${STN1 - 138},${G - 210} L${STN1},${G - 246} L${STN1 + 138},${G - 210} Z`} fill="var(--sc-bldg-2)" stroke="var(--sc-bldg-edge)" strokeWidth={1.4}/>
          <rect x={STN1 - 92} y={G - 202} width={184} height={22} rx={4} fill="var(--sc-sky-1)" stroke="var(--sc-s2l)" strokeOpacity={0.7}/>
          <text x={STN1} y={G - 186.5} textAnchor="middle" fontSize={12} fontWeight={800} letterSpacing={2.2} fill="var(--sc-s2l)" fontFamily="var(--font-mono)">KAVACH · STN 523</text>
          {[0, 1, 2, 3, 4, 5].map(k => (
            <rect key={k} x={STN1 - 104 + k * 36} y={G - 168} width={22} height={28} rx={2} fill="var(--sc-win)" opacity={0.85} className="sc-win" style={{ animationDelay: `${k * 0.9}s` }}/>
          ))}
          {[0, 1, 2, 3, 4, 5].map(k => (
            <rect key={k} x={STN1 - 104 + k * 36} y={G - 120} width={22} height={28} rx={2} fill="var(--sc-win)" opacity={0.55}/>
          ))}
          <rect x={STN1 - 14} y={G - 82} width={28} height={52} rx={2} fill="var(--sc-bldg-2)" stroke="var(--sc-bldg-edge)"/>
          {[STN1 - 200, STN1 + 200].map(x => (
            <g key={x}>
              <polygon points={`${x - 6},${G - 104} ${x + 6},${G - 104} ${x + 34},${G - 30} ${x - 34},${G - 30}`} fill="url(#scLampCone)" className="sc-lamp"/>
              <line x1={x} y1={G - 30} x2={x} y2={G - 106} stroke="var(--sc-mast)" strokeWidth={2}/>
              <rect x={x - 7} y={G - 110} width={14} height={5} rx={2} fill="var(--sc-win)"/>
            </g>
          ))}
          <Mast ant={ANT1} h={G - 30 - ANT1.y} ringR={96} name="RADIO · 0xF1A5C3"/>
        </g>

        {/* ── signals ── */}
        <Signal x={STN1 + 300}/>
        <Signal x={STN2 + 170} scale={0.85}/>

        {/* ── ground, sleepers, rails ── */}
        <rect x={0} y={G} width={W} height={H - G} fill="url(#scGround)"/>
        <rect x={0} y={G + 1} width={W} height={12} fill="url(#scSleepers)"/>
        <rect x={0} y={G - 1} width={W} height={3.2} fill="var(--sc-rail)"/>
        <rect x={0} y={G + 10} width={W} height={2.2} fill="var(--sc-rail)" opacity={0.65}/>

        {/* ── RFID tags (flash + label as the loco crosses) ── */}
        {tags.map(t => {
          const k = frac(t.x);
          const kt = `0;${f3(k)};${f3(Math.min(0.996, k + 0.01))};${f3(Math.min(0.998, k + 0.08))};1`;
          return (
            <g key={t.x}>
              <circle cx={t.x} cy={G + 6} r={12} fill="var(--sc-tag)" opacity={0} filter="url(#scBlur)">
                {motion && <animate attributeName="opacity" values="0;0;1;0;0" keyTimes={kt} dur={T} repeatCount="indefinite"/>}
              </circle>
              <rect x={t.x - 6} y={G + 3} width={12} height={7} rx={1.6} fill="var(--sc-tag)" opacity={0.8}/>
              <g opacity={0}>
                {motion && <animate attributeName="opacity" values="0;0;1;0;0" keyTimes={kt} dur={T} repeatCount="indefinite"/>}
                <rect x={t.x - 30} y={G + 22} width={60} height={15} rx={4} fill="var(--sc-sky-1)" stroke="var(--sc-tag)" strokeOpacity={0.7}/>
                <text x={t.x} y={G + 32.5} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="var(--sc-tag)" fontFamily="var(--font-mono)">TAG #{t.id}</text>
              </g>
            </g>
          );
        })}

        {/* ── radio links: STN 523, then handover to STN 524 ── */}
        <Link ant={ANT1} kt={link1KT}/>
        <Link ant={ANT2} kt={link2KT} labelDx={-196}/>

        {/* ── train: loco + 3 coaches (front at x = 0), running left → right ── */}
        <g transform={`translate(${motion ? RUN_FROM : 900},0)`}>
          {motion && <animateTransform attributeName="transform" type="translate" from={`${RUN_FROM} 0`} to={`${RUN_FROM + RUN_LEN} 0`} dur={T} repeatCount="indefinite"/>}
          <polygon points={`0,${G - 42} 260,${G - 82} 260,${G - 2} 0,${G - 26}`} fill="url(#scHead)" className="sc-head"/>
          <ellipse cx={120} cy={G + 4} rx={120} ry={6} fill="var(--sc-head)" opacity={0.14}/>
          <Coach x={-470}/><Coach x={-360}/><Coach x={-250}/>
          {/* loco body */}
          <path d={`M-140,${G - 14} V${G - 60} Q-140,${G - 68} -132,${G - 68} H-34 L-8,${G - 52} Q0,${G - 47} 0,${G - 40} V${G - 14} Z`}
            fill="url(#scLoco)" stroke="var(--sc-loco)" strokeWidth={1.5}/>
          <path d={`M-30,${G - 64} L-10,${G - 51} H-30 Z`} fill="#bae6fd" opacity={0.9}/>
          <rect x={-136} y={G - 46} width={130} height={3.2} fill="var(--sc-stripe)" opacity={0.9}/>
          <rect x={-136} y={G - 41} width={130} height={2} fill="var(--sc-stripe-2)" opacity={0.9}/>
          <rect x={-120} y={G - 60} width={14} height={10} rx={1.5} fill="var(--sc-win)" opacity={0.85}/>
          <rect x={-98} y={G - 60} width={14} height={10} rx={1.5} fill="var(--sc-win)" opacity={0.85}/>
          <rect x={-118} y={G - 76} width={40} height={8} rx={2} fill="var(--sc-loco-body-2)" stroke="var(--sc-loco)" strokeOpacity={0.6}/>
          <text x={-74} y={G - 25} fontSize={9.5} fontWeight={800} fill="#e0f2fe" fontFamily="var(--font-mono)" letterSpacing={1}>#12799</text>
          <circle cx={-3} cy={G - 33} r={3.2} fill="var(--sc-head)"/><circle cx={-3} cy={G - 24} r={2.4} fill="var(--sc-head)" opacity={0.8}/>
          <rect x={-1} y={G - 20} width={6} height={4} rx={1} fill="var(--sc-rail)"/>
          <path d={`M-4,${G - 14} L10,${G - 4} H-4 Z`} fill="var(--sc-rail)" opacity={0.8}/>
          {/* pantograph on the wire + spark */}
          <path d={`M-66,${G - 68} L-52,${G - 100} L-38,${G - 68} M-52,${G - 100} L-60,${G - 127} M-70,${G - 127} H-50`} fill="none" stroke="var(--sc-wire)" strokeWidth={1.7}/>
          <circle cx={-60} cy={G - 128} r={3.4} fill="#bae6fd" opacity={0} filter="url(#scBlur)">
            {motion && <animate attributeName="opacity" values="0;0;1;0;0;0;0.8;0" dur="1.6s" repeatCount="indefinite"/>}
          </circle>
          {/* loco radio antenna */}
          <line x1={LOCO_ANT_DX} y1={G - 68} x2={LOCO_ANT_DX} y2={G - 76} stroke="var(--sc-l2s)" strokeWidth={2}/>
          <circle cx={LOCO_ANT_DX} cy={G - 77} r={2.6} fill="var(--sc-l2s)"/>
          <Wheel cx={-124}/><Wheel cx={-104}/><Wheel cx={-40}/><Wheel cx={-20}/>
          {/* telemetry card riding above the loco */}
          <g transform={`translate(-150,${G - 196})`} fontFamily="var(--font-mono)">
            <line x1={64} y1={46} x2={64} y2={118} stroke="var(--sc-l2s)" strokeWidth={1} strokeDasharray="2,3" opacity={0.6}/>
            <rect width={128} height={44} rx={6} fill="var(--sc-sky-1)" opacity={0.82} stroke="var(--sc-l2s)" strokeOpacity={0.6}/>
            <rect width={3} height={44} rx={1.5} fill="var(--sc-l2s)"/>
            <text x={10} y={15} fontSize={10} fontWeight={800} fill="var(--sc-l2s)" letterSpacing={0.6}>LOCO #12799</text>
            <text x={10} y={28} fontSize={8.5} fill="var(--sc-text)">FS · 110 km/h · DN</text>
            <text x={10} y={39} fontSize={7.5} fill="var(--sc-text-dim)">L2S every 2 s · Radio1</text>
          </g>
        </g>

        {/* foreground: vignette */}
        <rect width={W} height={H} fill="url(#scVignette)" pointerEvents="none"/>
      </svg>

      {/* HUD (HTML so it hugs the panel corners at any size) */}
      {[["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]].map(([v, h]) => (
        <div key={v + h} style={{ position: "absolute", [v]: 14, [h]: 14, width: 26, height: 26, opacity: 0.6, pointerEvents: "none",
          [`border${v[0].toUpperCase() + v.slice(1)}`]: "2px solid var(--sc-s2l)", [`border${h[0].toUpperCase() + h.slice(1)}`]: "2px solid var(--sc-s2l)" }}/>
      ))}
      <div style={{ position: "absolute", top: 20, left: 50, fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.16em", color: "var(--sc-text-dim)" }}>
        RDSO/SPN/196/2020 · ANNEXURE-C · STATIONARY ⇄ ONBOARD KAVACH
      </div>
      <div style={{ position: "absolute", top: 16, right: 50, display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)" }}>
        <svg width="34" height="34" viewBox="-17 -17 34 34">
          <circle r={14} fill="none" stroke="var(--sc-text-dim)" strokeWidth={2} opacity={0.5}/>
          <circle r={14} fill="none" stroke="var(--sc-s2l)" strokeWidth={2.4} strokeDasharray="22,66" className="sc-tdma" transform="rotate(-90)"/>
          <text y={3} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--sc-text)">2s</text>
        </svg>
        <span style={{ fontSize: 9, letterSpacing: "0.14em", color: "var(--sc-text-dim)" }}>TDMA</span>
      </div>

      {/* title + hints over the bottom of the scene */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "54px 20px 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
        fontFamily: "var(--font-mono)", textAlign: "center", background: "linear-gradient(180deg, transparent, var(--sc-title-bg) 70%)" }}>
        <div className="sc-title" style={{ fontFamily: "var(--font-display)", fontSize: 24, letterSpacing: "0.26em", color: "var(--sc-s2l)" }}>SVK SIM ENGINE</div>
        <div style={{ fontSize: 10, color: "var(--sc-text)", letterSpacing: "0.12em" }}>C-POWERED · svk_sim.c · STATION ⇄ LOCO RADIO SIMULATOR</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
          {lines.map((line, i) => (
            <div key={i} style={{ fontSize: 9, letterSpacing: "0.08em", color: i === 1 ? "var(--sc-l2s)" : "var(--sc-text-dim)" }}>
              {i === 1 ? <><span className="sc-blink">▌</span>{" "}{line}</> : `> ${line}`}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ lines = ["SYSTEM INITIALISED", "AWAITING INPUT…", "LOAD STATION XML · STORYBOARD CSV", "RDSO/SPN/196/2020 Annexure-C · SIL-4"] }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: 40, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.04, backgroundImage: `linear-gradient(var(--green) 1px, transparent 1px), linear-gradient(90deg, var(--green) 1px, transparent 1px)`, backgroundSize: "40px 40px", pointerEvents: "none" }} />
      <div style={{ position: "relative", width: 100, height: 100 }}>
        <div style={{ position: "absolute", inset: 0, border: "2px solid var(--green)", borderRadius: "50%", opacity: 0.15, animation: "glow-pulse 2s ease-in-out infinite" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, opacity: 0.5, animation: "glow-pulse 3s ease-in-out infinite" }}>⬡</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--font-mono)", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, letterSpacing: "0.2em", color: "var(--green)", textShadow: "0 0 20px var(--green)88", animation: "glow-pulse 2.5s ease-in-out infinite" }}>SVK SIM ENGINE</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em" }}>C-POWERED · svk_sim.c · HTTP SOCKET TRANSMISSION</div>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3 }}>
          {lines.map((line, i) => (
            <div key={i} style={{ fontSize: 9, color: i===1?"var(--green)":"var(--text-dim)", letterSpacing: "0.08em", opacity: i===1?1:0.6 }}>
              {i===1 ? <><span style={{ animation: "blink 1.1s step-end infinite" }}>▌</span>{" "}{line}</> : `> ${line}`}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultTab({ active, color, onClick, children }) {
  const c = ACCENT[color] || ACCENT.green;
  return (
    <button onClick={onClick} style={{
      padding: "4px 12px", borderRadius: 4, fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 700,
      letterSpacing: "0.1em", cursor: "pointer", textTransform: "uppercase",
      border: `1px solid ${active ? c.border : "var(--border)"}`,
      background: active ? c.bg : "transparent",
      color: active ? c.text : "var(--text-dim)",
      boxShadow: active ? `0 0 10px ${c.border}44` : "none",
      transition: "all 0.15s",
    }}>{children}</button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SERIAL RADIO MODEM CONFIG — left sidebar panel
 *
 * Manages Guardian™ serial port config.  On first render it loads the saved
 * config from the server (serial_config.json).  The port list always includes
 * the SIM_LOOPBACK dummy entry so the UI works without any physical hardware.
 * ═══════════════════════════════════════════════════════════════════════════ */

function SerialConfig({
  serialCfg, setSerialCfg,
  availablePorts, portsLoading, portsError, pyserialHint, wslWarning, onRefreshPorts,
  serialTxState, onSerialTransmit, onSerialStop, onSerialPause, onSerialResume, serialTxPaused = false, serialPauseInfo = null,
  serialTxCsv = "", serialResumeError = null,
  rawCsv, onPortTestResult, portTest,
  radioId, setRadioId,
}) {
  const [testStatus, setTestStatus] = useState(null);  // null | "ok" | "error"
  const [testMsg,    setTestMsg]    = useState("");
  const [saving,     setSaving]     = useState(false);

  const isTransmitting = serialTxState === "transmitting";
  const configSaysSim = serialCfg.tty_device === "SIM_LOOPBACK"
             || serialCfg.mode === "sim_loopback";

  /* GROUND TRUTH vs CONFIGURED INTENT
   * ──────────────────────────────────
   * serialCfg only records what the user *asked* for. The backend can
   * silently fall back to DummySerialPort even when a real device path
   * is configured (device not found, permission denied, busy, etc.) —
   * that's by design so a bad port never crashes a transmission. But it
   * means a "HARDWARE MODE" banner driven purely off serialCfg can lie:
   * it said HARDWARE MODE while every actual TEST PORT / TRANSMIT call
   * was quietly using the loopback. portTest.sim (set from the real
   * `sim` field the backend returns on /svk/serial_test and every
   * serial_status "open" WS event) is the only trustworthy signal. */
  const verified   = portTest?.status === "ok";
  const actualSim  = verified ? portTest.sim : null;   // true | false | null (unverified)

  const set = (k, v) => setSerialCfg(prev => ({ ...prev, [k]: v }));

  const handlePortChange = (device) => {
    set("tty_device", device);
    if (device === "SIM_LOOPBACK") set("mode", "sim_loopback");
    else set("mode", "decode_live");
    /* Switching ports invalidates any previous test result — a stale
     * "OK" from a different port would misrepresent this one. */
    setTestStatus(null); setTestMsg("");
    onPortTestResult?.(null, "", null);
  };

  /* Save config to server */
  const saveConfig = async () => {
    setSaving(true); setTestStatus(null);
    try {
      const res = await fetch("http://localhost:8000/svk/serial_config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serialCfg),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Save failed");
      setTestStatus("ok"); setTestMsg("Config saved to serial_config.json");
    } catch (e) { setTestStatus("error"); setTestMsg(e.message); }
    finally { setSaving(false); }
  };

  /* Test port — asks the backend to actually open the physical serial
   * port and report back. This is the only place a *real* hardware
   * connection signal can come from (a browser can't read DSR/CTS
   * directly) — so its result (including whether it silently fell back
   * to DummySerialPort) is surfaced up via onPortTestResult. */
  const testPort = async () => {
    setTestStatus(null); setTestMsg("");
    try {
      await fetch("http://localhost:8000/svk/serial_config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serialCfg),
      });
      const res  = await fetch("http://localhost:8000/svk/serial_test", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Test failed");
      setTestStatus("ok");
      setTestMsg(body.message || "Port OK");
      onPortTestResult?.("ok", body.message || "Port OK", !!body.sim);
    } catch (e) {
      setTestStatus("error"); setTestMsg(e.message);
      onPortTestResult?.("error", e.message, null);
    }
  };

  const canTransmit = rawCsv.trim() && !isTransmitting;

  return (
    <GlowCard accentColor="purple" style={{ flexShrink: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "var(--bg-raised)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 13 }}>📡</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: "var(--purple)", letterSpacing: "0.1em" }}>SERIAL RADIO MODEM</span>
        <span style={{ marginLeft: "auto", fontSize: 8, fontFamily: "var(--font-mono)", padding: "1px 5px", borderRadius: 3, border: "1px solid var(--purple)", background: "var(--purple-glow)", color: "var(--purple)" }}>Guardian™</span>
      </div>

      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 7 }}>

        {/* Sim / hardware mode banner — driven by ground truth when available,
            never just by what was selected in the dropdown. */}
        {configSaysSim ? (
          <div style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid rgba(176,96,255,0.35)", background: "rgba(176,96,255,0.07)", fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--purple)", lineHeight: 1.7 }}>
            ⚠ <b>SIMULATION MODE</b> — DummySerialPort (loopback)<br/>No physical cable required. TX bytes are echoed back as RX.
          </div>
        ) : actualSim === true ? (
          <div style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid var(--red)", background: "var(--red-glow)", fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--red)", lineHeight: 1.7 }}>
            ✖ <b>NOT CONNECTED — USING SIMULATION</b><br/>
            {serialCfg.tty_device} could not be opened as real hardware, so the backend silently fell back to DummySerialPort. Any "successful" TX right now is a loopback echo, not a real radio transmission. {portTest?.message ? <>({portTest.message})</> : null}
          </div>
        ) : actualSim === false ? (
          <div style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid rgba(0,255,136,0.3)", background: "rgba(0,255,136,0.05)", fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--green)", lineHeight: 1.7 }}>
            ✔ <b>HARDWARE MODE — VERIFIED</b> · {serialCfg.tty_device}<br/>Backend confirmed a real open connection. TX/RX uses the physical Guardian™ modem.
          </div>
        ) : (
          <div style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid var(--border-bright)", background: "var(--bg-raised)", fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-muted)", lineHeight: 1.7 }}>
            ◌ <b>UNVERIFIED</b> — {serialCfg.tty_device || "no port selected"}<br/>
            Click <b>TEST PORT</b> before transmitting — until then this could silently be running on DummySerialPort.
          </div>
        )}

        {/* Port selector — real detected ports only, no free-text entry.
            A mistyped or stale manual device path (e.g. a leftover
            "/dev/ttyUSB0" on a Windows COM-port machine) used to be able
            to sit in serialCfg unverified and unnoticed; the dropdown is
            now the only way to pick a port, sourced live from the
            backend's own enumeration. */}
        <Field label="SERIAL PORT (real detected ports)">
          <div style={{ display: "flex", gap: 5 }}>
            <select value={serialCfg.tty_device} onChange={e => handlePortChange(e.target.value)}
              style={{ flex: 1, background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 10, padding: "5px 8px", outline: "none" }}>
              {(availablePorts || []).some(p => !p.sim) && (
                <optgroup label="REAL PORTS DETECTED">
                  {(availablePorts || []).filter(p => !p.sim).map(p => (
                    <option key={p.device} value={p.device}>
                      {p.device}{p.description ? ` · ${p.description}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="SIMULATION">
                {(availablePorts || []).filter(p => p.sim).map(p => (
                  <option key={p.device} value={p.device}>{p.device} [SIM]</option>
                ))}
              </optgroup>
            </select>
            <button onClick={onRefreshPorts} disabled={portsLoading} title="Re-scan for real serial ports"
              style={{ padding: "5px 9px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-raised)", color: "var(--text-muted)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 13 }}>
              {portsLoading ? <Spinner size={10}/> : "↺"}
            </button>
          </div>

          {/* Why the real cable might not be showing up */}
          {pyserialHint && (
            <div style={{ marginTop: 5, padding: "5px 8px", borderRadius: 4, border: "1px solid var(--red)", background: "var(--red-glow)", fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--red)", lineHeight: 1.6 }}>
              ✖ Backend reports <b>pyserial is not installed</b> in its Python env.<br/>
              comports() is never called, so no real port can ever appear here. Run <b>{pyserialHint}</b> in the same venv running <b>uvicorn main:app</b>, then restart it.
            </div>
          )}
          {!pyserialHint && wslWarning && (
            <div style={{ marginTop: 5, padding: "5px 8px", borderRadius: 4, border: "1px solid var(--red)", background: "var(--red-glow)", fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--red)", lineHeight: 1.6 }}>
              ✖ Backend is running inside <b>WSL</b> — Windows COM ports aren't visible to it.<br/>
              Windows Device Manager showing your adapter on a COM port doesn't help here: WSL has its own Linux kernel and doesn't auto-share host USB devices. Bridge it in with <b>usbipd-win</b> (from an admin PowerShell: <b>winget install usbipd</b>, <b>usbipd bind --busid &lt;id&gt;</b>, <b>usbipd attach --wsl --busid &lt;id&gt;</b>), then it'll appear here as <b>/dev/ttyUSB0</b> — or simplest, run <b>uvicorn main:app</b> from native Windows Python instead of WSL.
            </div>
          )}
          {!pyserialHint && !wslWarning && portsError && portsError !== "no_ports" && (
            <div style={{ marginTop: 5, padding: "5px 8px", borderRadius: 4, border: "1px solid var(--red)", background: "var(--red-glow)", fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--red)", lineHeight: 1.6 }}>
              ✖ Can't reach svk_sim_bridge.py at localhost:8000 ({portsError}).<br/>
              Confirm the Python backend is running and reachable — CORS or a wrong host/port will also land here.
            </div>
          )}
          {!pyserialHint && !wslWarning && portsError === "no_ports" && (
            <div style={{ marginTop: 5, padding: "5px 8px", borderRadius: 4, border: "1px solid var(--amber)", background: "var(--amber-glow)", fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--amber-text)", lineHeight: 1.6 }}>
              ⚠ Backend is up and pyserial is installed, but reports 0 real serial ports.<br/>
              Device Manager seeing the adapter only confirms Windows has a driver for it — the backend still enumerates independently. Check: the CH340/FTDI/PL2303 VCP driver is bound to a COM port, and no other program (e.g. another instance of this backend, or a terminal program) already has that COM port open.
            </div>
          )}
        </Field>

        {/* Baud rate — Guardian COM Port documents 110-57,600 bps, default
            9600 (manual §5.6.3). 115200 is included too for USB-serial
            bridges/adapters run ahead of the modem at that rate. */}
        <Field label="BAUD RATE">
          <select value={serialCfg.baud_rate} onChange={e => set("baud_rate", Number(e.target.value))}
            style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 10, padding: "5px 8px", outline: "none" }}>
            {[110,300,1200,2400,4800,9600,19200,38400,57600,115200].map(b => (
              <option key={b} value={b}>{b}{b === 9600 ? " (Guardian default)" : b === 115200 ? " (non-standard)" : ""}</option>
            ))}
          </select>
        </Field>

        {/* TX Activation Mode — Guardian COM Port panel §5.6.3.
            DOX: data sent whenever present, no flow control (default; the
                 only mode RS-422/RS-485 links use).
            RTS/CTS: host raises RTS, Guardian returns CTS, then data flows —
                     handled transparently by the OS driver once selected. */}
        <div style={{ display: "grid", gridTemplateColumns: serialCfg.tx_mode === "DOX" ? "1fr 1fr" : "1fr", gap: 5 }}>
          <Field label="TX ACTIVATION">
            <select value={serialCfg.tx_mode || "DOX"} onChange={e => set("tx_mode", e.target.value)}
              style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 10, padding: "5px 8px", outline: "none" }}>
              <option value="DOX">DOX (default)</option>
              <option value="RTS_CTS">RTS/CTS</option>
            </select>
          </Field>
          {serialCfg.tx_mode === "DOX" && (
            <Field label="DOX DELAY">
              <input type="number" min={0} max={255} value={serialCfg.dox_delay ?? 6}
                onChange={e => set("dox_delay", Number(e.target.value))}
                style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 10, padding: "5px 8px", outline: "none" }} />
            </Field>
          )}
        </div>

        {/* Parity / Data bits / Stop bits */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
          {[
            ["PARITY",    "parity",    [["N","None"],["E","Even"],["O","Odd"]]],
            ["DATA BITS", "data_bits", [[7,"7"],[8,"8"]]],
            ["STOP BITS", "stop_bits", [[1,"1"],[1.5,"1.5"],[2,"2"]]],
          ].map(([label, key, opts]) => (
            <Field key={key} label={label}>
              <select value={serialCfg[key]} onChange={e => set(key, isNaN(e.target.value) ? e.target.value : Number(e.target.value))}
                style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 10, padding: "4px 6px", outline: "none" }}>
                {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          ))}
        </div>

        {/* Timeouts */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
          <Field label="READ TIMEOUT (s)">
            <input type="number" step="0.05" min="0.05" max="5" value={serialCfg.read_timeout_s}
              onChange={e => set("read_timeout_s", parseFloat(e.target.value))}
              style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 10, padding: "5px 8px", outline: "none" }} />
          </Field>
          <Field label="WRITE TIMEOUT (s)">
            <input type="number" step="0.1" min="0.1" max="10" value={serialCfg.write_timeout_s}
              onChange={e => set("write_timeout_s", parseFloat(e.target.value))}
              style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 10, padding: "5px 8px", outline: "none" }} />
          </Field>
        </div>

        {/* Save + Test row */}
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={saveConfig} disabled={saving}
            style={{ flex: 1, padding: "6px 0", borderRadius: 4, border: "1px solid var(--border-glow)", background: "var(--bg-raised)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, cursor: "pointer", letterSpacing: "0.08em" }}>
            {saving ? "SAVING…" : "💾 SAVE CFG"}
          </button>
          <button onClick={testPort}
            style={{ flex: 1, padding: "6px 0", borderRadius: 4, border: "1px solid var(--cyan-dim)", background: "var(--cyan-glow)", color: "var(--cyan)", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, cursor: "pointer", letterSpacing: "0.08em" }}>
            🔌 TEST PORT
          </button>
        </div>

        {testStatus && (
          <div style={{ padding: "4px 8px", borderRadius: 3, fontSize: 9, fontFamily: "var(--font-mono)", border: `1px solid ${testStatus==="ok"?"var(--green-deep)":"var(--red)"}`, background: testStatus==="ok"?"var(--green-glow)":"var(--red-glow)", color: testStatus==="ok"?"var(--green)":"var(--red)", animation: "fade-in 0.2s ease" }}>
            {testStatus==="ok" ? "✔" : "✖"} {testMsg}
          </div>
        )}

        {/* Radio unit — sets the §C.3.2.12 OTA Start-of-Frame prefix
            prepended to every byte actually written to the serial port */}
        <Field label="RADIO UNIT (§C.3.2.12 SOF PREFIX)">
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 2].map(rid => {
              const active = radioId === rid;
              const prefixHex = rid === 1 ? "F1A5C3" : "F2A5C3";
              return (
                <button key={rid} onClick={() => setRadioId(rid)} disabled={isTransmitting} style={{
                  flex: 1, padding: "6px 0", borderRadius: 4, cursor: isTransmitting ? "not-allowed" : "pointer",
                  fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                  border: `1px solid ${active ? "var(--purple)" : "var(--border)"}`,
                  background: active ? "var(--purple-glow)" : "var(--bg-input)",
                  color: active ? "var(--purple)" : "var(--text-dim)",
                  opacity: isTransmitting ? 0.6 : 1,
                }}>
                  RADIO{rid} · 0x{prefixHex}
                </button>
              );
            })}
          </div>
        </Field>

        {/* While transmitting: ⏸ PAUSE / ▶ RESUME + ⏹ STOP; otherwise TRANSMIT */}
        {isTransmitting ? (
          <>
            <PauseStopButtons paused={serialTxPaused} onPause={onSerialPause} onResume={onSerialResume} onStop={onSerialStop} stopLabel="⏹ STOP SERIAL TX" />
            <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 700, textAlign: "center", letterSpacing: "0.08em",
              color: serialTxPaused ? "var(--amber, #f5a623)" : "var(--purple)" }}>
              {serialTxPaused
                ? (rawCsv.trim() && rawCsv !== serialTxCsv
                    ? "⏸ PAUSED"
                    : `⏸ PAUSED${serialPauseInfo ? ` — RESUMES AT FRAME ${serialPauseInfo.next} OF ${serialPauseInfo.total}` : " — HOLDING AFTER CURRENT BURST…"}`)
                : "● TRANSMITTING…"}
            </div>
            {serialTxPaused && rawCsv.trim() && rawCsv !== serialTxCsv && (
              <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 700, textAlign: "center", letterSpacing: "0.06em",
                color: "var(--cyan)", padding: "4px 6px", borderRadius: 4, border: "1px dashed var(--cyan-dim)", background: "var(--cyan-glow)" }}>
                ⟳ NEW STORYBOARD LOADED — ▶ RESUME CONTINUES WITH IT FROM ITS FRAME 1 (SAME SESSION &amp; LOG)
              </div>
            )}
            {serialResumeError && (
              <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--red)", textAlign: "center" }}>✖ {serialResumeError}</div>
            )}
          </>
        ) : (
        <button className="svk-btn"
          onClick={isTransmitting ? onSerialStop : () => onSerialTransmit({ csv: rawCsv, loop: false, radio_id: radioId })}
          disabled={isTransmitting ? false : !canTransmit}
          style={{
            width: "100%", padding: "9px 0", borderRadius: 4,
            border: `1px solid ${isTransmitting ? "var(--red)" : canTransmit ? "var(--purple)" : "var(--border)"}`,
            background: isTransmitting ? "rgba(255,61,90,0.12)" : canTransmit ? "linear-gradient(135deg, rgba(176,96,255,0.22), rgba(176,96,255,0.07))" : "var(--bg-raised)",
            color: isTransmitting ? "var(--red)" : canTransmit ? "var(--purple)" : "var(--text-dim)",
            fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 10,
            letterSpacing: "0.1em", textTransform: "uppercase",
            cursor: (isTransmitting || canTransmit) ? "pointer" : "not-allowed",
            boxShadow: isTransmitting ? "0 0 16px var(--red)33" : canTransmit ? "0 0 16px var(--purple)33" : "none",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            transition: "all 0.2s",
          }}>
          {isTransmitting && <StatusDot color="red" pulse />}
          {isTransmitting ? "⏹ STOP SERIAL TX"
            : !rawCsv.trim() ? "📡 LOAD CSV FIRST"
            : configSaysSim ? "📡 TRANSMIT (SIM LOOPBACK)"
            : actualSim === true ? "⚠ TRANSMIT (WILL FALL BACK TO SIM)"
            : "📡 TRANSMIT STORYBOARD (SERIAL)"}
        </button>
        )}

        <div style={{ fontSize: 8, color: "var(--text-dim)", fontFamily: "var(--font-mono)", textAlign: "center" }}>
          Config → <span style={{ color: "var(--text-muted)" }}>serial_config.json</span>
        </div>
      </div>
    </GlowCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SERIAL TX LOG PANEL — right-area panel showing live serial TX/RX events
 *
 * Receives events from WS /ws/serial_log.
 * TX packets → purple  |  RX echo bytes → cyan  |  Status → green/red
 * ═══════════════════════════════════════════════════════════════════════════ */

function SerialTxLog({ serialLog, serialTxState, serialTxStats, onStop, portTest, serialCfg }) {
  const logRef = useRef(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [serialLog]);

  const isLive    = serialTxState === "transmitting";
  const isDone    = serialTxState === "done";
  const isStopped = serialTxState === "stopped";

  /* CRC pass/fail tally over every TX/RX event carrying packet bytes —
   * recomputed with the same crc32Ieee() used across the whole app, so
   * this always reflects real byte-level verification, never the raw
   * (possibly tampered) CSV CRC column. */
  const { crcPass, crcFail } = useMemo(() => {
    let pass = 0, fail = 0;
    serialLog.forEach(e => {
      if (e.type !== "serial_tx" && e.type !== "serial_rx") return;
      const r = verifyPacketCrc(e.hex);
      if (r.status === "pass") pass++;
      else if (r.status === "fail") fail++;
    });
    return { crcPass: pass, crcFail: fail };
  }, [serialLog]);

  const visible = filter === "all"
    ? serialLog
    : filter === "crcfail"
    ? serialLog.filter(e => (e.type === "serial_tx" || e.type === "serial_rx") && verifyPacketCrc(e.hex).status === "fail")
    : serialLog.filter(e => e.type === `serial_${filter}`);

  const statusColor = isLive ? "var(--purple)" : isDone ? "var(--green)"
                    : isStopped ? "var(--cyan)" : "var(--text-muted)";

  /* Is the current session running in sim mode? Read from first status event */
  const isSim = serialLog.find(e => e.sim !== undefined)?.sim ?? true;

  /* Which radio is this session using? Read from the most recent event
   * carrying radio_id (serial_status "open" and every serial_tx event now
   * report it). */
  const sessionRadioId = [...serialLog].reverse().find(e => e.radio_id != null)?.radio_id ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg-base)" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, padding: "10px 16px", background: "var(--panel-head-bg)", borderBottom: `1px solid ${isLive ? "rgba(176,96,255,0.5)" : "var(--border)"}`, display: "flex", alignItems: "center", gap: 10 }}>
        <StatusDot color={isLive ? "purple" : isDone ? "green" : "cyan"} pulse={isLive} />
        <span style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: "0.18em", color: statusColor, textShadow: `0 0 14px ${statusColor}55` }}>
          {isLive ? "SERIAL TX LIVE" : isDone ? "SERIAL TX DONE" : isStopped ? "SERIAL TX STOPPED" : "SERIAL TX LOG"}
        </span>
        <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", padding: "1px 6px", borderRadius: 3, border: "1px solid var(--purple)", background: "var(--purple-glow)", color: "var(--purple)" }}>Guardian™</span>
        {sessionRadioId != null && (
          <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", padding: "1px 5px", borderRadius: 3, border: "1px solid var(--red)", background: "rgba(255,61,90,0.08)", color: "var(--red)" }}>
            RADIO{sessionRadioId} · 0x{sessionRadioId === 1 ? "F1A5C3" : "F2A5C3"}
          </span>
        )}
        {isSim && (
          <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", padding: "1px 5px", borderRadius: 3, border: "1px solid rgba(176,96,255,0.4)", background: "rgba(176,96,255,0.08)", color: "var(--purple)" }}>SIM · LOOPBACK</span>
        )}

        {/* Stats */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 14 }}>
          {[["TX", serialTxStats.tx, "purple"], ["RX", serialTxStats.rx, "cyan"], ["ERR", serialTxStats.err, serialTxStats.err > 0 ? "red" : "muted"],
            ["CRC OK", crcPass, "green"], ["CRC FAIL", crcFail, crcFail > 0 ? "red" : "muted"]].map(([l, v, c]) => (
            <div key={l} style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              {l} <span style={{ color: `var(--${c})`, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>

        {isLive && (
          <button onClick={onStop} style={{ padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", border: "1px solid var(--red)", background: "rgba(255,61,90,0.1)", color: "var(--red)" }}>⏹ STOP</button>
        )}
      </div>

      {/* Live front-panel hardware view — Rx (green) / Tx (red) LEDs flash in real time */}
      <GuardianModemPanel serialTxStats={serialTxStats} serialTxState={serialTxState} isSim={isSim} serialLog={serialLog} portTest={portTest} serialCfg={serialCfg} />

      {/* Progress shimmer */}
      {isLive && (
        <div style={{ height: 3, flexShrink: 0, background: "var(--bg-raised)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: "60%", background: "linear-gradient(90deg, transparent, var(--purple), var(--cyan), var(--purple), transparent)", backgroundSize: "200% 100%", animation: "data-stream 1.4s linear infinite" }} />
        </div>
      )}

      {/* Filter bar */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        <span style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>FILTER:</span>
        {[["all","ALL","muted"],["tx","TX PKT","purple"],["rx","RX DATA","cyan"],["status","STATUS","green"],["crcfail","CRC FAIL","red"]].map(([v,l,c]) => (
          <button key={v} onClick={() => setFilter(v)} style={{ padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700, border: `1px solid ${filter===v?`var(--${c})`:"var(--border)"}`, background: filter===v?"rgba(0,0,0,0.3)":"transparent", color: filter===v?`var(--${c})`:"var(--text-dim)" }}>{l}</button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>{visible.length} events</span>
      </div>

      {/* Column headers */}
      <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "86px 50px 72px 60px 1fr 54px", gap: "0 8px", padding: "5px 14px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
        {["TIME", "TYPE", "FRM / SLOT", "PKT", "SOF PREFIX + HEX PAYLOAD / MESSAGE", "BYTES"].map(h => (
          <span key={h} style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.07em", fontWeight: 700 }}>{h}</span>
        ))}
      </div>

      {/* Log rows */}
      <div ref={logRef} style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {visible.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            <span style={{ fontSize: 30 }}>📡</span>
            <span style={{ fontSize: 11 }}>{isLive ? "Waiting for first frame…" : "No events yet"}</span>
            <span style={{ fontSize: 9, color: "var(--text-dim)", textAlign: "center", maxWidth: 260 }}>
              {isSim ? "SIM_LOOPBACK active — one packet every 2 seconds." : "Click TRANSMIT STORYBOARD (SERIAL) to start."}
            </span>
          </div>
        ) : visible.map((ev, i) => {
          const isTx   = ev.type === "serial_tx";
          const isRx   = ev.type === "serial_rx";
          const isStat = ev.type === "serial_status";
          const isMa   = ev.type === "ma_update";
          const isErr  = ev.status === "error";
          const typeColor = isTx ? "var(--purple)" : isRx ? "var(--cyan)" : isMa ? "var(--cyan)" : isErr ? "var(--red)" : "var(--green)";
          const typeLabel = isTx ? "TX" : isRx ? "RX" : isMa ? "MA" : "STS";
          const rowBg     = isTx ? "rgba(176,96,255,0.04)" : isRx ? "rgba(0,229,255,0.04)" : isMa ? "rgba(0,229,255,0.06)" : "transparent";
          const meta      = PKT_TYPE_META[ev.pkt_type];
          const maFieldsStr = isMa ? Object.entries(ev.fields || {}).map(([k, v]) => `${k}=${v}`).join(" ") : "";

          /* Full on-air bytes formatted as "XX XX XX …" — prefer ota_hex
           * (§C.3.2.12 SOF prefix + packet, what the C layer actually
           * wrote to the port) and fall back to the pure packet if the
           * backend hasn't sent it (e.g. older events, RX frames). */
          const fullHex    = ev.ota_hex || ev.hex || "";
          const hexPairs   = fullHex.match(/.{1,2}/g) || [];
          const hexFull    = hexPairs.join(" ");
          const prefixLen  = ev.frame_prefix ? ev.frame_prefix.length / 2 : 0;

          return (
            <div key={i} className={isTx ? "serial-tx-row" : isRx ? "serial-rx-row" : ""}
              style={{ borderBottom: "1px solid rgba(26,48,40,0.5)", background: rowBg, padding: "7px 14px" }}>

              {/* Top row: metadata */}
              <div style={{ display: "grid", gridTemplateColumns: "86px 50px 72px 60px 1fr 54px", gap: "0 8px", alignItems: "center", marginBottom: hexFull ? 5 : 0 }}>

                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>{ev.ts || "—"}</span>

                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "2px 5px", borderRadius: 3, fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 700, border: `1px solid ${typeColor}55`, background: `${typeColor}12`, color: typeColor }}>
                  {ev.sim && <span title="Simulation" style={{ marginRight: 2, opacity: 0.6, fontSize: 8 }}>◈</span>}{typeLabel}
                </span>

                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                  {(isTx || isRx)
                    ? <><span style={{ color: isTx ? "var(--orange)" : "var(--cyan)", fontWeight: 700 }}>{ev.frame_num ?? "—"}</span><span style={{ color: "var(--text-dim)" }}>/{ev.tdma_slot ?? "—"}</span></>
                    : "—"}
                </span>

                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
                  {(isTx || isRx) && meta
                    ? <span style={{ color: meta.color, fontWeight: 700 }}>{meta.abbr}</span>
                    : isStat
                    ? <span style={{ color: typeColor, fontSize: 9 }}>STS</span>
                    : isMa
                    ? <span style={{ color: typeColor, fontSize: 9 }}>tag {ev.rfid_tag}</span>
                    : "—"}
                </span>

                {/* Status / message on right side for STS rows */}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: isErr ? "var(--red)" : (isStat || isMa) ? "var(--green-dim)" : "var(--text-muted)", fontStyle: (isStat || isMa) ? "italic" : "normal" }}>
                  {isMa ? maFieldsStr : isStat ? (ev.message || "—") : (ev.pkt_name || "—")}
                </span>

                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", textAlign: "right", fontWeight: 700 }}>
                  {(isTx || isRx) ? `${ev.ota_byte_len ?? ev.byte_len ?? 0} B` : "—"}
                </span>
              </div>

              {/* Hex payload block — shown for TX and RX rows */}
              {hexFull && (
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 11, color: isTx ? "var(--text-code)" : "var(--cyan)",
                  background: "var(--bg-input)", border: `1px solid ${typeColor}22`,
                  borderRadius: 4, padding: "6px 10px", marginTop: 2,
                  letterSpacing: "0.08em", lineHeight: 1.9, wordBreak: "break-all",
                }}>
                  {hexPairs.map((byte, bi) => {
                    const isPrefixByte = bi < prefixLen;
                    const pktBi = bi - prefixLen;   // index within the packet itself
                    const pktLen = hexPairs.length - prefixLen;
                    return (
                      <span key={bi}>
                        <span style={{
                          fontWeight: isPrefixByte ? 700 : 400,
                          color: isPrefixByte ? "var(--red)"
                               : pktBi === 0 ? "var(--amber)"
                               : pktBi === 1 ? "var(--cyan-dim)"
                               : pktBi >= pktLen - 4 ? "var(--purple)"
                               : isTx ? "var(--text-code)" : "var(--cyan)",
                        }}>{byte}</span>
                        {bi < hexPairs.length - 1 && (
                          bi === prefixLen - 1
                            ? <span style={{ color: "var(--red)", userSelect: "none", fontWeight: 700 }}> ┃ </span>
                            : (bi + 1) % 8 === 0
                            ? <span style={{ color: "var(--text-dim)", userSelect: "none" }}>  </span>
                            : " "
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
              {hexFull && <div style={{ marginTop: 4 }}><CrcBadge hex={ev.hex} /></div>}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ flexShrink: 0, padding: "4px 12px", borderTop: "1px solid var(--border)", background: "var(--footer-bg)", display: "flex", gap: 14, fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-dim)", alignItems: "center" }}>
        <span>📡 Guardian™ Serial Radio Modem</span>
        <span>RDSO/SPN/196/2020 Annexure-C · 2s TDMA · SIL-4</span>
        {isSim && <span style={{ color: "var(--purple)" }}>◈ SIM/LOOPBACK — no physical hardware</span>}
        <span style={{ marginLeft: "auto" }}>WS → /ws/serial_log</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GUARDIAN 400 — LIVE HARDWARE FRONT PANEL
 *
 * Visual replica of the physical Guardian™400 radio modem faceplate.
 * Purely presentational — driven off the same serialTxStats.tx / .rx
 * counters + serialTxState already used by SerialTxLog above; no new
 * data sources, no change to any transmit/receive logic.
 *
 * Rx LED (green)  → flashes each time a serial_rx event lands (a packet
 *                    was received by the modem).
 * Tx LED (red)    → flashes each time a serial_tx event is dispatched
 *                    (a packet was transmitted by the modem).
 * STATUS LED      → solid/breathing green while a session is live.
 * POWER LED       → solid green whenever the panel is mounted (powered).
 * RS/TD LED       → brief amber flicker on any TX activity (line drive).
 * ═══════════════════════════════════════════════════════════════════════════ */

function HwLed({ flashKey, colorVar, flashClass, size = 8, idle = "off" }) {
  /* idle: "off" (dark, unlit) | "on" (dim steady glow) | "breathe" (slow pulse) */
  const lit = idle === "on" || idle === "breathe";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size + 7, height: size + 7, borderRadius: "50%", flexShrink: 0,
      background: "radial-gradient(circle at 35% 30%, #45494c, #0a0c0d 72%)",
      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.08)",
    }}>
      <span
        key={flashKey}
        className={flashKey > 0 ? flashClass : ""}
        style={{
          display: "block", width: size, height: size, borderRadius: "50%",
          background: lit ? `var(${colorVar})` : "#1a1a1a",
          boxShadow: lit
            ? `0 0 5px 1px var(${colorVar}), inset 0 -1px 1px rgba(0,0,0,0.45), inset 0 1px 1px rgba(255,255,255,0.55)`
            : "inset 0 0 2px rgba(0,0,0,0.9)",
          animation: flashKey > 0 ? undefined : (idle === "breathe" ? "led-hw-breathe 1.8s ease-in-out infinite" : "none"),
        }}
      />
    </span>
  );
}

function HwLabel({ children }) {
  return (
    <span style={{ fontSize: 6.5, color: "#4a5154", fontFamily: "var(--font-mono)", fontWeight: 800, letterSpacing: "0.09em" }}>
      {children}
    </span>
  );
}

function HwPortLabel({ children }) {
  return (
    <span style={{ fontSize: 7, letterSpacing: "0.16em", color: "#8a9a92", fontWeight: 800, fontFamily: "var(--font-mono)" }}>
      {children}
    </span>
  );
}

/* Mounting flange with two chassis screw holes — sells the "rack hardware" look */
function MountEar({ side }) {
  return (
    <div style={{
      width: 14, flexShrink: 0, alignSelf: "stretch",
      background: "linear-gradient(180deg,#d3d8da,#9a9fa2 45%,#7d8284)",
      borderRight: side === "left" ? "1px solid #63686a" : "none",
      borderLeft: side === "right" ? "1px solid #63686a" : "none",
      display: "flex", flexDirection: "column", justifyContent: "space-evenly", alignItems: "center",
    }}>
      {[0, 1].map(i => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "radial-gradient(circle at 35% 30%,#5a6062,#101314)",
          boxShadow: "inset 0 1px 1px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.25)",
        }} />
      ))}
    </div>
  );
}

/* DB9-style serial port: tapered shell, 5-over-4 pin rows, screw-lug shoulders */
function Db9Port({ label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{
        position: "relative", width: 32, height: 24, borderRadius: "38% 38% 12% 12%",
        background: "linear-gradient(180deg,#4a4f52,#17191b 60%)",
        border: "1px solid #030405",
        boxShadow: "inset 0 1px 1px rgba(255,255,255,0.2), inset 0 -3px 4px rgba(0,0,0,0.75)",
      }}>
        <span style={{ position: "absolute", left: -3, top: "50%", transform: "translateY(-50%)", width: 3, height: 9, borderRadius: 1, background: "linear-gradient(90deg,#6b7174,#3a3d3f)" }} />
        <span style={{ position: "absolute", right: -3, top: "50%", transform: "translateY(-50%)", width: 3, height: 9, borderRadius: 1, background: "linear-gradient(90deg,#3a3d3f,#6b7174)" }} />
        <div style={{ position: "absolute", top: 4, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 2 }}>
          {Array.from({ length: 5 }).map((_, i) => <span key={i} style={{ width: 2, height: 2, borderRadius: "50%", background: "#b8bcbd" }} />)}
        </div>
        <div style={{ position: "absolute", bottom: 4, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 2.5 }}>
          {Array.from({ length: 4 }).map((_, i) => <span key={i} style={{ width: 2, height: 2, borderRadius: "50%", background: "#b8bcbd" }} />)}
        </div>
      </div>
      <HwPortLabel>{label}</HwPortLabel>
    </div>
  );
}

function ActivityBars({ active, colorVar = "--green" }) {
  const bars = 9;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2.5, height: 16 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const h = 5 + ((i % 5) * 2.2) + ((bars - Math.abs(i - bars / 2)) * 0.6);
        return (
          <span key={i} style={{
            width: 3, height: Math.min(16, h), borderRadius: 1,
            background: active ? `var(${colorVar})` : "#3d4245",
            opacity: active ? 0.85 : 0.5,
            boxShadow: active ? `0 0 4px var(${colorVar})` : "none",
            animation: active ? `hw-eq-bar 0.9s ease-in-out infinite` : "none",
            animationDelay: active ? `${i * 0.07}s` : "0s",
            transformOrigin: "bottom",
          }} />
        );
      })}
    </div>
  );
}

function GuardianModemPanel({ serialTxStats, serialTxState, isSim = true, serialLog = [], portTest = { status: null, message: "" }, serialCfg = { baud_rate: 9600, data_bits: 8, parity: "N", stop_bits: 1, tx_mode: "DOX" } }) {
  const isLive = serialTxState === "transmitting";
  const isDone = serialTxState === "done";
  const isStopped = serialTxState === "stopped";
  const stateLabel = isLive ? "TRANSMITTING" : isDone ? "SESSION DONE" : isStopped ? "STOPPED" : "STANDBY";
  const stateColorVar = isLive ? "--purple" : isDone ? "--green" : isStopped ? "--cyan" : "--text-muted";

  /* POWER LED reflects the *real* hardware link, not a simulated always-on
   * light: in SIM/LOOPBACK mode there's no physical device so it's simply
   * "virtually powered" (green). In hardware mode it reflects the last
   * result of the backend actually opening the physical COM/ttyUSB port
   * (via the TEST PORT button → /svk/serial_test) — green once verified
   * OK, red if the backend reported a real open/comm failure, amber if
   * hardware mode is selected but the port hasn't been tested yet. This
   * is the most a browser can honestly know, since DSR/CTS/CD line state
   * can only be read by the backend process, not by client-side JS.  */
  const powerColorVar = isSim ? "--green"
    : portTest.status === "ok" ? "--green"
    : portTest.status === "error" ? "--red"
    : "--amber";
  const powerTitle = isSim
    ? "SIM/LOOPBACK — virtual device, no physical hardware"
    : portTest.status === "ok" ? `Hardware link verified — ${portTest.message || "port opened OK"}`
    : portTest.status === "error" ? `Hardware fault — ${portTest.message || "port could not be opened"}`
    : "Hardware mode selected — click TEST PORT to verify the physical link";

  /* Live throughput (pkt/s) + session uptime — derived purely from the
   * existing tx counter and a 1s ticker, no new data source. */
  const [tick, setTick] = useState(0);
  const [rateHistory, setRateHistory] = useState([]);
  const sessionStartRef = useRef(null);
  const wasLiveRef = useRef(false);
  const lastSampleRef = useRef({ t: Date.now(), tx: serialTxStats.tx });

  useEffect(() => {
    if (isLive && !wasLiveRef.current) sessionStartRef.current = Date.now();
    wasLiveRef.current = isLive;
  }, [isLive]);

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastSampleRef.current.t) / 1000;
      const dTx = serialTxStats.tx - lastSampleRef.current.tx;
      const rate = dt > 0 ? dTx / dt : 0;
      lastSampleRef.current = { t: now, tx: serialTxStats.tx };
      setRateHistory(h => [...h.slice(-13), rate]);
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [isLive, serialTxStats.tx]);

  const uptimeSec = sessionStartRef.current ? Math.floor((Date.now() - sessionStartRef.current) / 1000) : 0;
  const uptimeStr = `${String(Math.floor(uptimeSec / 60)).padStart(2, "0")}:${String(uptimeSec % 60).padStart(2, "0")}`;
  const curRate = rateHistory.length ? rateHistory[rateHistory.length - 1] : 0;
  const maxRate = Math.max(1, ...rateHistory);

  /* Latest TX/RX packet — decoded straight from the same log the table below shows */
  const lastPkt = [...serialLog].reverse().find(e => e.type === "serial_tx" || e.type === "serial_rx");
  const lastMeta = lastPkt ? PKT_TYPE_META[lastPkt.pkt_type] : null;

  /* Detect edges on the tx/rx counters (already maintained by parent from
   * the live WS feed) and turn each new packet into a one-shot LED flash. */
  const [txFlash, setTxFlash] = useState(0);
  const [rxFlash, setRxFlash] = useState(0);
  const prevTx = useRef(serialTxStats.tx);
  const prevRx = useRef(serialTxStats.rx);

  useEffect(() => {
    if (serialTxStats.tx !== prevTx.current) {
      prevTx.current = serialTxStats.tx;
      setTxFlash(k => k + 1);
    }
  }, [serialTxStats.tx]);

  useEffect(() => {
    if (serialTxStats.rx !== prevRx.current) {
      prevRx.current = serialTxStats.rx;
      setRxFlash(k => k + 1);
    }
  }, [serialTxStats.rx]);

  return (
    <div style={{
      flexShrink: 0, margin: "8px 14px 4px", display: "flex",
      borderRadius: 9, overflow: "hidden",
      border: "1px solid #04120a",
      boxShadow: "0 10px 26px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,255,136,0.07), inset 0 0 0 1px rgba(255,255,255,0.04)",
    }}>
      <MountEar side="left" />

      <div style={{ flex: 1, background: "linear-gradient(180deg,#e2e6e7,#aeb4b6)" }}>
        {/* Top brushed-metal strip: logo + LED cluster */}
        <div style={{
          position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "7px 14px",
          background: "linear-gradient(180deg,#f2f4f5,#c6ccce)",
          borderBottom: "1px solid #888f91", overflow: "hidden",
        }}>
          {/* brushed-aluminium texture */}
          <div style={{
            position: "absolute", inset: 0, opacity: 0.35, pointerEvents: "none",
            background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 1px, transparent 1px, transparent 3px)",
          }} />
          <span style={{
            width: 12, height: 12, borderRadius: "50%", flexShrink: 0, position: "relative",
            border: "2px solid #262b2d", background: "radial-gradient(circle at 35% 30%,#fff,#c7cccd 60%)",
          }} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05, position: "relative" }}>
            <span style={{ fontFamily: "var(--font-body)", fontWeight: 800, fontSize: 12.5, color: "#1b2023", letterSpacing: "0.01em" }}>NextGen</span>
            <span style={{ fontSize: 6, letterSpacing: "0.22em", color: "#5c6366" }}>— RF DESIGN —</span>
          </div>

          <div style={{ width: 1, height: 22, background: "linear-gradient(180deg,transparent,rgba(0,0,0,0.18),transparent)", position: "relative" }} />

          {/* Device / firmware readout — fills the dead centre space */}
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3, position: "relative" }}>
            <span style={{ fontSize: 8.5, fontFamily: "var(--font-mono)", fontWeight: 800, color: "#2c3336", letterSpacing: "0.06em" }}>GRD-400-SIL4</span>
            <span style={{ fontSize: 6.5, fontFamily: "var(--font-mono)", color: "#6b7477" }}>FW v2.3.1 · {isSim ? "SIM/LOOPBACK" : "RF LIVE"}</span>
          </div>

          {/* Live equalizer — reacts to TX/RX line activity */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
            <ActivityBars active={isLive} colorVar="--green" />
            <span style={{ fontSize: 6.5, fontFamily: "var(--font-mono)", color: "#6b7477", letterSpacing: "0.1em" }}>LINK</span>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 18, position: "relative" }}>
            <div title={powerTitle} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "help" }}>
              <HwLed flashKey={0} colorVar={powerColorVar} idle="on" size={8} />
              <HwLabel>POWER</HwLabel>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <HwLed flashKey={0} colorVar="--green" idle={isLive ? "breathe" : "off"} size={8} />
              <HwLabel>STATUS</HwLabel>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <HwLed flashKey={rxFlash} colorVar="--green" flashClass="hw-led-flash-green" idle="off" size={8} />
              <HwLed flashKey={txFlash} colorVar="--red"   flashClass="hw-led-flash-red"   idle="off" size={8} />
              <HwLabel><span style={{ color: "#0d6b3e" }}>Rx</span>/<span style={{ color: "#8a1424" }}>Tx</span></HwLabel>
              <span style={{ fontSize: 6, color: "#5c6366", fontFamily: "var(--font-mono)", marginTop: -2 }}>
                {String(serialTxStats.rx ?? 0).padStart(3, "0")}/{String(serialTxStats.tx ?? 0).padStart(4, "0")}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <HwLed flashKey={txFlash} colorVar="--amber" flashClass="hw-led-flash-amber" idle="off" size={8} />
              <HwLabel>RS/TD</HwLabel>
            </div>
          </div>
        </div>

        {/* Main dark faceplate: title, PWR terminal, DB9s, USER conn, ANT */}
        <div style={{
          position: "relative", display: "flex", alignItems: "center", gap: 20, padding: "12px 16px",
          background: "linear-gradient(180deg,#20302a,#0a100d 70%)",
          backgroundImage: "linear-gradient(180deg,#20302a,#0a100d 70%), repeating-linear-gradient(90deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 4px)",
        }}>
          {/* PWR terminal block */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ display: "flex", gap: 1.5, padding: "3px 4px", borderRadius: 3, background: "linear-gradient(180deg,#f3c968,#c68f24)", border: "1px solid #6b4e12", boxShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <span key={i} style={{ width: 6, height: 10, borderRadius: 1, background: "radial-gradient(circle,#fff6d8,#c9932a)", border: "1px solid #6b4e12" }} />
              ))}
            </div>
            <span style={{ fontSize: 8, color: "var(--text-code)", fontFamily: "var(--font-mono)", fontWeight: 700, letterSpacing: "0.06em" }}>− + PWR</span>
          </div>

          <div style={{ width: 1, alignSelf: "stretch", background: "linear-gradient(180deg,transparent,rgba(255,255,255,0.08),transparent)" }} />

          {/* Title */}
          <div>
            <div style={{
              fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 19, letterSpacing: "0.02em",
              background: "linear-gradient(180deg,#ffffff 0%,#d6e6dc 45%,#8ba69a 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.6))",
            }}>
              GUARDIAN<span style={{ fontSize: 10, verticalAlign: "super" }}>™</span>400
            </div>
            <div style={{ height: 1.5, width: "88%", marginTop: 3, background: "linear-gradient(90deg,#e8b23c,rgba(232,178,60,0.15))", borderRadius: 1 }} />
          </div>

          {/* Integrated LCD status readout — fills the middle span with live telemetry */}
          <div style={{
            flex: 1, minWidth: 0, marginLeft: 6, borderRadius: 4, padding: "6px 14px",
            background: "linear-gradient(180deg,#0a1610,#050b08)",
            border: "1px solid #01100a", boxShadow: "inset 0 2px 5px rgba(0,0,0,0.85), inset 0 0 12px rgba(0,255,136,0.05)",
            position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: 18,
          }}>
            <div style={{
              position: "absolute", inset: 0, opacity: 0.06, pointerEvents: "none",
              background: "repeating-linear-gradient(180deg, #fff 0px, #fff 1px, transparent 1px, transparent 3px)",
            }} />

            {/* Column 1: state + link params */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 800, letterSpacing: "0.08em", color: `var(${stateColorVar})`, textShadow: `0 0 6px var(${stateColorVar})` }}>
                ● {stateLabel}
              </span>
              <div style={{ fontSize: 7.5, fontFamily: "var(--font-mono)", color: "#5fae86", marginTop: 2 }}>{serialCfg.baud_rate}·{serialCfg.data_bits}{serialCfg.parity}{serialCfg.stop_bits} · {serialCfg.tx_mode || "DOX"} · UP {uptimeStr}</div>
            </div>

            <div style={{ width: 1, alignSelf: "stretch", background: "rgba(79,216,138,0.15)" }} />

            {/* Column 2: counters + live rate */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "#4fd88a" }}>TX <b style={{ color: "#9dffc6" }}>{String(serialTxStats.tx ?? 0).padStart(4, "0")}</b></span>
                <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "#4fd88a" }}>RX <b style={{ color: "#9dffc6" }}>{String(serialTxStats.rx ?? 0).padStart(4, "0")}</b></span>
                <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: (serialTxStats.err ?? 0) > 0 ? "#ff8a97" : "#3a6b52" }}>ERR <b>{String(serialTxStats.err ?? 0).padStart(3, "0")}</b></span>
              </div>
              <div style={{ fontSize: 7.5, fontFamily: "var(--font-mono)", color: "#5fae86", marginTop: 2 }}>{curRate.toFixed(1)} pkt/s</div>
            </div>

            <div style={{ width: 1, alignSelf: "stretch", background: "rgba(79,216,138,0.15)" }} />

            {/* Column 3: throughput sparkline */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 22, flexShrink: 0, position: "relative" }}>
              {Array.from({ length: 14 }).map((_, i) => {
                const v = rateHistory[i] ?? 0;
                const h = 3 + (v / maxRate) * 19;
                return <span key={i} style={{ width: 3, height: h, borderRadius: 1, background: "var(--green)", opacity: 0.35 + (i / 14) * 0.55 }} />;
              })}
            </div>

            <div style={{ width: 1, alignSelf: "stretch", background: "rgba(79,216,138,0.15)" }} />

            {/* Column 4: last packet decoded from the same feed as the log below */}
            <div style={{ position: "relative", minWidth: 0, overflow: "hidden" }}>
              <div style={{ fontSize: 7, fontFamily: "var(--font-mono)", color: "#4a7a5f", letterSpacing: "0.08em" }}>LAST PACKET</div>
              {lastPkt ? (
                <div style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "#9dffc6", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  <span style={{ color: lastPkt.type === "serial_tx" ? "var(--purple)" : "var(--cyan)" }}>{lastPkt.type === "serial_tx" ? "TX" : "RX"}</span>
                  {" "}FRM {lastPkt.frame_num ?? "—"}/{lastPkt.tdma_slot ?? "—"}
                  {lastMeta && <> · <span style={{ color: lastMeta.color }}>{lastMeta.abbr}</span></>}
                  {" "}· {lastPkt.byte_len ?? 0}B
                </div>
              ) : (
                <div style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "#3a6b52", marginTop: 2 }}>— awaiting traffic —</div>
              )}
            </div>
          </div>

          <div style={{ marginLeft: 6, display: "flex", alignItems: "flex-start", gap: 16 }}>
            <Db9Port label="SETUP" />
            <Db9Port label="COM" />

            {/* USER connector — keyed shell (chamfered corner) */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 46, height: 27, background: "linear-gradient(180deg,#26292b,#0a0b0c)",
                border: "1px solid #000", boxShadow: "inset 0 1px 1px rgba(255,255,255,0.08)",
                clipPath: "polygon(14% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 14%)",
                display: "grid", gridTemplateColumns: "repeat(8,1fr)", gridTemplateRows: "repeat(2,1fr)", gap: 2.5, padding: "4px 5px",
              }}>
                {Array.from({ length: 16 }).map((_, i) => (
                  <span key={i} style={{ width: 2.4, height: 2.4, borderRadius: "50%", background: "radial-gradient(circle,#8b9698,#3d4547)" }} />
                ))}
              </div>
              <HwPortLabel>USER</HwPortLabel>
            </div>

            {/* Antenna connector — knurled ring + center pin, warning marker */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: "repeating-conic-gradient(from 0deg,#d8dcdd 0deg 5deg,#94999b 5deg 10deg)",
                border: "1px solid #050607", display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 1px 2px rgba(0,0,0,0.5)",
              }}>
                <div style={{
                  width: 17, height: 17, borderRadius: "50%",
                  background: "radial-gradient(circle at 35% 30%,#2c3532,#0c1210)",
                  border: "1px solid #000", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "linear-gradient(180deg,#f3c968,#a06a12)" }} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <HwPortLabel>ANT</HwPortLabel>
                <span style={{
                  display: "inline-block", width: 0, height: 0,
                  borderLeft: "5px solid transparent", borderRight: "5px solid transparent",
                  borderBottom: "8px solid var(--amber)", position: "relative",
                }}>
                  <span style={{ position: "absolute", left: -1.5, top: 2.5, fontSize: 6, fontWeight: 900, color: "#1a1300" }}>!</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <MountEar side="right" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * MAIN SVK SIM COMPONENT
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
 * LOADERS DRAWER — top-bar button. ⚙ Settings / ⓘ About are project-wide now
 * (main top bar, SettingsAbout.jsx); the SVK SIM preferences live in
 * svkSettingsStore there.
 * ═══════════════════════════════════════════════════════════════════════════ */
function SvkTopBtn({ onClick, title, active, children }) {
  return (
    <button onClick={onClick} title={title} className="svk-topbtn" style={{
      padding: "3px 10px", borderRadius: 4, fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: 700,
      border: "1px solid " + (active ? "var(--cyan-dim)" : "var(--border)"), cursor: "pointer",
      background: active ? "var(--cyan-glow)" : "var(--bg-raised)",
      color: active ? "var(--cyan)" : "var(--text-secondary)", letterSpacing: "0.06em",
      display: "inline-flex", alignItems: "center", gap: 5, transition: "all 0.15s",
    }}>{children}</button>
  );
}

export default function SvkSim() {
  /* Inject global styles */
  useEffect(() => {
    if (document.getElementById("svksim-styles")) return;
    const el = document.createElement("style");
    el.id = "svksim-styles";
    el.textContent = GLOBAL_STYLES;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  const [rawCsv,   setRawCsv]   = useState("");
  // Always-current copy of the loaded storyboard for callbacks (pause/resume)
  // that must not be re-created on every keystroke.
  const rawCsvRef = useRef(rawCsv);
  rawCsvRef.current = rawCsv;
  // The storyboard each running transmission is actually sending. If the
  // loaded storyboard differs from it while paused, RESUME switches the
  // running session over to the new one (same session / log).
  const serialTxCsvRef = useRef("");
  const [serialTxCsv, setSerialTxCsv] = useState("");
  const [serialResumeError, setSerialResumeError] = useState(null);
  const txCsvRef = useRef("");
  const [txCsv, setTxCsv] = useState("");
  const txNewStoryRef = useRef(null);   // { encoded, csv } waiting to be swapped in on resume
  const [destIp,   setDestIp]   = useState(() => svkSettingsStore.get().defaultDestIp);
  /* Which physical radio is transmitting — 1 (Radio1) or 2 (Radio2).
   * Per RDSO/SPN/196/2020 Annexure-C §C.3.2.12, this selects the OTA
   * Start-of-Frame prefix (0xF1 0xA5 0xC3 for Radio1, 0xF2 0xA5 0xC3 for
   * Radio2) that the backend prepends to every packet — UDP and serial
   * alike. Shared across both TX panels since the bench simulates one
   * radio unit at a time. */
  const [radioId,  setRadioId]  = useState(() => (svkSettingsStore.get().defaultRadio === 2 ? 2 : 1));

  /* ── Serial modem state ── */
  const [serialCfg, setSerialCfg] = useState({
    mode: "sim_loopback", tty_device: "SIM_LOOPBACK",
    // Guardian COM Port factory defaults (manual §5.6.3): 9600 baud, 8N1,
    // DOX TX activation with a DOX Delay of 6.
    baud_rate: 9600, data_bits: 8, stop_bits: 1.0,
    parity: "N", read_timeout_s: 0.25, write_timeout_s: 1.0,
    tx_mode: "DOX", dox_delay: 6,
  });
  const [availablePorts, setAvailablePorts] = useState([
    { device: "SIM_LOOPBACK", description: "Simulation / Loopback (no hardware)", sim: true },
  ]);
  const [portsLoading,  setPortsLoading]  = useState(false);
  /* Surfaces *why* the real Guardian™ USB/RS-232 adapter isn't showing up:
   * "backend unreachable" (svk_sim_bridge.py not running / wrong host:port /
   * CORS) is a completely different problem than "backend is up but
   * pyserial found zero COM/tty devices" (driver not installed, cable
   * unplugged, or the endpoint is filtering ports out). Previously both
   * cases failed silently (`catch (_) {}`) and looked identical in the UI. */
  const [portsError,    setPortsError]    = useState(null);
  /* pyserial itself may not be importable in the backend's Python env —
   * /svk/serial_ports reports this via `available` + `pyserial_hint`.
   * This is the #1 cause of "Device Manager sees it, the app doesn't":
   * comports() is never even called, so the real adapter can never appear
   * no matter how many times you click refresh. */
  const [pyserialHint,  setPyserialHint]  = useState(null);
  /* Backend running inside WSL is the #1 cause of "Device Manager sees the
   * USB adapter, the app doesn't": WSL never auto-shares host USB devices
   * with its Linux kernel, so pyserial there only sees the phantom
   * /dev/ttyS0-31 legacy ports, no matter how many times you refresh. */
  const [wslWarning,    setWslWarning]    = useState(false);
  const [serialLog,     setSerialLog]     = useState([]);
  const [serialTxState, setSerialTxState] = useState("idle");
  const [serialTxPaused, setSerialTxPaused] = useState(false);
  const [serialPauseInfo, setSerialPauseInfo] = useState(null); // { next, total } from the "paused" WS event
  const [serialTxStats, setSerialTxStats] = useState({ tx: 0, rx: 0, err: 0 });
  /* Last real result of the backend actually opening the physical serial
   * port (via /svk/serial_test, or a live serial_status "open" WS event
   * during transmit) — the only genuine hardware-presence signal
   * available, since the browser itself can't read DSR/CTS. `sim` is the
   * key field: true means the backend silently fell back to
   * DummySerialPort even though a real device was configured. */
  const [portTest, setPortTest] = useState({ status: null, message: "", sim: null }); // status: null | "ok" | "error"
  const [activeView,    setActiveView]    = useState("http");  // "http" | "serial"
  /* ⚙ SVK SIM preferences — edited in the project-wide ⚙ Settings (top bar) */
  const settings = useStore(svkSettingsStore);
  // a changed default destination / radio in ⚙ Settings is applied here too
  const firstDefaults = useRef(true);
  useEffect(() => {
    if (firstDefaults.current) { firstDefaults.current = false; return; }
    setDestIp(settings.defaultDestIp);
    setRadioId(settings.defaultRadio === 2 ? 2 : 1);
  }, [settings.defaultDestIp, settings.defaultRadio]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /* ☰ Loaders drawer: one open/closed state for the normal views and one for
   * 🚆 LIVE TRACK (which uses the full screen by default). Closing it only
   * hides the panel — the loaders stay mounted, so loaded files survive. */
  const [drawerOpen, setDrawerOpen] = useState(() => settings.drawerOnStart);
  const [showSidebarInTrack, setShowSidebarInTrack] = useState(() => settings.drawerInTrack);
  const rootRef = useRef(null);
  const serialWsRef = useRef(null);

  /* Load saved serial config + port list from server on mount */
  useEffect(() => {
    fetch("http://localhost:8000/svk/serial_config")
      .then(r => r.ok ? r.json() : null)
      .then(b => { if (b?.config) setSerialCfg(c => ({ ...c, ...b.config })); })
      .catch(() => {});
    refreshPorts();
  }, []);

  const SIM_ONLY = [{ device: "SIM_LOOPBACK", description: "Simulation / Loopback (no hardware)", sim: true }];

  const refreshPorts = async () => {
    setPortsLoading(true);
    try {
      const r = await fetch("http://localhost:8000/svk/serial_ports");
      if (!r.ok) throw new Error(`Backend returned HTTP ${r.status}`);
      const b = await r.json();
      const real = (b.ports || []).filter(p => !p.sim);
      /* Always show SIM_LOOPBACK plus whatever real ports the backend found.
       * Previously `if (b.ports?.length)` meant an empty/zero-port response
       * left the OLD list on screen with no feedback — so after plugging in
       * the RS-232 USB adapter and clicking refresh, a genuine "0 ports
       * found" looked identical to "refresh didn't run at all". */
      const merged = real.length ? [...SIM_ONLY, ...real] : SIM_ONLY;
      setAvailablePorts(merged);
      setPortsError(real.length ? null : "no_ports");
      setPyserialHint(b.available === false ? (b.pyserial_hint || "pyserial not installed") : null);
      setWslWarning(!!b.is_wsl && real.length === 0);

      /* Now that manual free-text entry is gone, the selected device can
       * only ever get out of sync with reality here: a previously-selected
       * real port got unplugged, or a stale value survived from before
       * this scan. Snap to the first real port if one showed up, otherwise
       * SIM_LOOPBACK — never leave serialCfg pointing at a device the
       * backend didn't just report. */
      const needsFallback = !merged.some(p => p.device === serialCfg.tty_device);
      if (needsFallback) {
        const fallback = real[0]?.device || "SIM_LOOPBACK";
        setSerialCfg(prev => ({ ...prev, tty_device: fallback, mode: fallback === "SIM_LOOPBACK" ? "sim_loopback" : "decode_live" }));
        setPortTest({ status: null, message: "", sim: null });
      }
    } catch (e) {
      setAvailablePorts(SIM_ONLY);
      setPortsError(e.message || "unreachable");
      setPyserialHint(null);
      setWslWarning(false);
    } finally { setPortsLoading(false); }
  };

  /* Re-scan automatically whenever the user switches into the Serial tab —
   * they just plugged the cable in and want to see it without a manual
   * click. Also catches the case where the backend wasn't up yet on
   * first page load but is running now. */
  useEffect(() => {
    if (activeView === "serial") refreshPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  /* ── Serial log WebSocket — always connected, independent of activeView ──
   *
   * The WS MUST stay alive even when the user switches to the UDP/HTTP tab.
   * If we close it on tab switch, ws.onclose fires and resets serialTxState
   * to "stopped", which flips the button back to "TRANSMIT (SIM LOOPBACK)"
   * even while a real transmission is running on the server.
   *
   * Connect once on mount, reconnect automatically if the server drops it,
   * and only close on component unmount.
   */
  useEffect(() => {
    let ws = null;
    let reconnectTimer = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      ws = new WebSocket("ws://localhost:8000/ws/serial_log");
      serialWsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type === "heartbeat") return;
          if (!ev.ts) {
            const n = new Date();
            ev.ts = n.toTimeString().slice(0, 8) + "." + String(n.getMilliseconds()).padStart(3, "0");
          }
          setSerialLog(prev => [...prev.slice(-499), ev]);
          if (ev.type === "serial_tx")
            setSerialTxStats(s => ({ ...s, tx: s.tx + 1, err: ev.status === "error" ? s.err + 1 : s.err }));
          else if (ev.type === "serial_rx")
            setSerialTxStats(s => ({ ...s, rx: s.rx + 1 }));
          else if (ev.type === "ma_update") {
            // Real-time Movement Authority update — fired by main.py the
            // moment a received Onboard→Station (L2S) packet's
            // LAST_RFID_TAG matched a row in the loaded MA table. Drives
            // the "● LIVE MA" indicator under the MA Table loader card;
            // the actual packet patching already happened server-side by
            // the time this arrives, so this is purely informational.
            setLiveMa({ rfid_tag: ev.rfid_tag, fields: ev.fields || {}, ts: ev.ts });
          }
          else if (ev.type === "serial_status") {
            // Only update state from authoritative server events — never from tab switching
            // Pause / resume (see /svk/serial_pause) — the run itself stays
            // "transmitting"; only the paused flag changes.
            if (ev.status === "paused")  { setSerialTxPaused(true);  setSerialPauseInfo(ev.next_frame ? { next: ev.next_frame, total: ev.total_frames } : null); }
            if (ev.status === "resumed") { setSerialTxPaused(false); setSerialPauseInfo(null); }
            if (["open", "done", "stopped", "error"].includes(ev.status)) { setSerialTxPaused(false); setSerialPauseInfo(null); }
            if (ev.status === "open")    setSerialTxState("transmitting");
            if (ev.status === "done")    setSerialTxState("done");
            if (ev.status === "stopped") setSerialTxState("stopped");
            if (ev.status === "error")   setSerialTxState("stopped");
            // "connected" (initial WS handshake) — do NOT reset txState here
            /* "open" carries the real `sim` flag for THIS transmission —
             * update ground truth here too, not just from the TEST PORT
             * button, so the SERIAL RADIO MODEM banner can never lag
             * behind what a transmit actually just did. */
            if (ev.status === "open" && typeof ev.sim === "boolean") {
              setPortTest({ status: "ok", message: ev.message || "", sim: ev.sim });
            }
          }
        } catch (_) {}
      };

      ws.onclose = () => {
        // Do NOT reset serialTxState on WS close — the server task may still be running.
        // Auto-reconnect after 2s so the log feed resumes.
        if (!unmounted) reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => { try { ws.close(); } catch (_) {} };
    };

    connect();

    return () => {
      unmounted = true;
      clearTimeout(reconnectTimer);
      try { if (ws) ws.close(); } catch (_) {}
      serialWsRef.current = null;
    };
  }, []);  // ← empty deps: connect once on mount, never re-run on tab switch

  const handleSerialTransmit = useCallback(async (cfg) => {
    // A new run starts clean: empty log (the Live Track chart resets itself on
    // this too), zeroed counters, and no "● LIVE MA" left over from the last run.
    setSerialLog([]); setSerialTxStats({ tx: 0, rx: 0, err: 0 }); setSerialTxState("transmitting"); setLiveMa(null);
    setSerialTxPaused(false); setSerialPauseInfo(null);
    serialTxCsvRef.current = cfg.csv; setSerialTxCsv(cfg.csv); setSerialResumeError(null);
    setActiveView("serial");     // SERIAL view = the serial log (tables are under ▤ STATIC DATA)
    try {
      const res = await fetch("http://localhost:8000/svk/serial_transmit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: cfg.csv, loop: cfg.loop || false, radio_id: cfg.radio_id || 1 }),
      });
      if (!res.ok) {
        const b = await res.json();
        const ts = new Date().toTimeString().slice(0, 12);
        setSerialLog(p => [...p, { type: "serial_status", status: "error", message: b.detail || "Failed", ts }]);
        setSerialTxState("stopped");
      }
    } catch (e) {
      const ts = new Date().toTimeString().slice(0, 12);
      setSerialLog(p => [...p, { type: "serial_status", status: "error", message: e.message, ts }]);
      setSerialTxState("stopped");
    }
  }, []);

  const handleSerialStop = useCallback(async () => {
    try { await fetch("http://localhost:8000/svk/serial_stop", { method: "POST" }); } catch (_) {}
    setSerialTxState("stopped");
    setSerialTxPaused(false); setSerialPauseInfo(null);
  }, []);

  /* ⏸ / ▶ — the backend holds at the next frame boundary and pushes a
   * "paused" event (with the frame it will resume at); RESUME continues from
   * that frame. The flag is set right away so the button responds instantly. */
  const handleSerialPause = useCallback(async () => {
    setSerialTxPaused(true);
    try {
      const r = await fetch("http://localhost:8000/svk/serial_pause", { method: "POST" });
      if (!r.ok) setSerialTxPaused(false);
    } catch (_) { setSerialTxPaused(false); }
  }, []);
  const handleSerialResume = useCallback(async () => {
    // A different storyboard loaded while paused → send it with RESUME; the
    // backend switches the running session over to it (from its frame 1),
    // keeping the same session and .log file. Otherwise plain resume →
    // continues from the frame where it paused.
    const loaded = rawCsvRef.current;
    const swap = loaded.trim() && loaded !== serialTxCsvRef.current;
    setSerialResumeError(null);
    try {
      const r = await fetch("http://localhost:8000/svk/serial_resume", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(swap ? { csv: loaded } : {}),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        setSerialResumeError(b.detail || `Resume failed (HTTP ${r.status})`);
        return;                                   // stay paused — nothing changed
      }
      if (swap) { serialTxCsvRef.current = loaded; setSerialTxCsv(loaded); }
      setSerialTxPaused(false); setSerialPauseInfo(null);
    } catch (e) {
      setSerialResumeError(e.message || "Backend unreachable");
    }
  }, []);

  /* ── Loading flags ── */
  const [stationLoading,  setStationLoading]  = useState(false);
  const [apdLoading,      setApdLoading]      = useState(false);
  const [txEncodeLoading, setTxEncodeLoading] = useState(false);
  const [maLoading,       setMaLoading]       = useState(false);
  const [rfidTagLoading,  setRfidTagLoading]  = useState(false);

  /* ── Results ── */
  const [stationResult,   setStationResult]   = useState(null);
  const [apdResult,       setApdResult]       = useState(null);
  const [csvEncodeResult, setCsvEncodeResult] = useState(null);
  const [maResult,        setMaResult]        = useState(null);
  const [rfidTagResult,   setRfidTagResult]   = useState(null); // { fileName, rows:[{sno,tagId,location}], map:{tagId:location} }

  /* ── Errors ── */
  const [stationError,    setStationError]    = useState(null);
  const [apdError,        setApdError]        = useState(null);
  const [csvError,        setCsvError]        = useState(null);
  const [maError,         setMaError]         = useState(null);
  const [rfidTagError,    setRfidTagError]    = useState(null);

  /* ── UI state ── */
  const [activeResult, setActiveResult] = useState(null);
  // ▤ STATIC DATA view: which loaded table is shown
  // ("apd" | "ma" | "rfidTag" | "station" | "csv").
  const [tablePane, setTablePane] = useState(null);
  // After a file loads, jump to STATIC DATA to show it — but never pull the
  // user away from a running transmission's log (refs: always current values).
  const busyRef = useRef(false);
  const showLoadedFiles = useCallback(() => {
    if (!busyRef.current && settingsRef.current.autoShowTables) setActiveView(v => (v === "loco_track" ? v : "tables"));
  }, []);
  const [txState,      setTxState]      = useState("idle");
  const [liveMa,        setLiveMa]      = useState(null);   // {rfid_tag, ma_m, ts} from ws "ma_update" events

  /* ── TX Mission Control state ──
   * txLog: packets already dispatched (reconstructed from encoded data + clock)
   * txCountdown: current epoch remaining seconds (0..2), updated by a timer
   * txFrameNum: current frame being dispatched
   * txSent: count of packets dispatched so far
   */
  const [txLog,       setTxLog]       = useState([]);
  const [txCountdown, setTxCountdown] = useState(2);
  const [txFrameNum,  setTxFrameNum]  = useState(null);
  const [txSent,      setTxSent]      = useState(0);

  const txTimerRef    = useRef(null);
  const txCounterRef  = useRef(null);
  const stopFlagRef   = useRef(false);  // for aborting the inject loop
  const txPausedRef   = useRef(false);  // ⏸ — inject loop + replay hold while set
  const replayStepRef = useRef(null);   // shows the next frame in the TX log (called per sent frame)
  const [txPaused,    setTxPaused]    = useState(false);
  const [txPauseInfo, setTxPauseInfo] = useState(null); // { next, total }

  /*
   * CLIENT-SIDE TX SIMULATION
   * ─────────────────────────
   * Because the actual C transmit runs server-side in a blocking loop,
   * the UI simulates the per-frame dispatch display by replaying the
   * encoded packet list at 2s intervals — mirroring the server's real
   * timing. This gives the operator a real-time live display without
   * needing a WebSocket push feed.
   *
   * When encodedData is available, startClientTxReplay() is called and
   * drives txLog, txFrameNum, txCountdown in lockstep with the server.
   */

  const startClientTxReplay = useCallback((encodedData, opts = {}) => {
    if (!encodedData || !encodedData.length) return;
    // keepLog: a storyboard swapped in on RESUME — keep the TX log/counters of
    // this session and append to them; its frames are shown by the inject
    // loop as they are sent (no immediate first-frame dispatch).
    const keepLog = !!opts.keepLog;
    if (!keepLog) {
      setTxLog([]);
      setTxSent(0);
      setTxFrameNum(null);
    }

    /* Group packets by frame_num, preserving CSV order */
    const frameMap = new Map();
    encodedData.forEach(pkt => {
      if (!frameMap.has(pkt.frame_num)) frameMap.set(pkt.frame_num, []);
      frameMap.get(pkt.frame_num).push(pkt);
    });
    const frames = [...frameMap.entries()]; // [ [frameNum, [pkts...]], ... ]

    let frameIdx = 0;
    const csvLines = (opts.csv ?? rawCsv).split(/\r?\n/);

    const dispatchFrame = () => {
      if (frameIdx >= frames.length) {
        /* Transmission complete */
        setTxState(prev => prev === "stopped" ? "stopped" : "done");
        clearInterval(txTimerRef.current);
        clearInterval(txCounterRef.current);
        setTxCountdown(0);
        return;
      }

      const [frameNum, pkts] = frames[frameIdx];
      setTxFrameNum(frameNum);

      /* Reset countdown */
      setTxCountdown(2);

      /* Emit all packets for this frame into the log */
      const now     = new Date();
      const hhmmss  = now.toTimeString().slice(0, 8);
      const ms      = String(now.getMilliseconds()).padStart(3, "0");

      const logEntries = pkts.map(pkt => {
        const cols = parseCsvCols(csvLines[pkt.line_num - 1] || "");
        return {
          frameNum:    pkt.frame_num,
          tdmaSlot:    pkt.tdma_slot,
          pktType:     pkt.pkt_type,
          byteLen:     pkt.byte_len,
          hex:         pkt.hex || "",
          // §C.3.2.12 OTA Start-of-Frame prefix — what actually goes on
          // the wire (frame_prefix + hex). "hex" above stays the pure
          // KAVACH packet, unchanged, for CRC verification.
          radioId:     pkt.radio_id     ?? null,
          framePrefix: pkt.frame_prefix ?? "",
          otaHex:      pkt.ota_hex      ?? "",
          otaByteLen:  pkt.ota_byte_len ?? null,
          timestamp: `${hhmmss}.${ms}`,
          locoId:    cols?.[6] ?? null,
          direction: cols?.[10] ?? 0,
          csvCols:   cols,
          error:     pkt.error || "",
        };
      });

      setTxLog(prev => [...prev, ...logEntries]);
      setTxSent(prev => prev + pkts.length);

      frameIdx++;
    };

    /* Dispatch first frame immediately (a swapped-in storyboard's first frame
       is shown by the inject loop instead, when it is actually sent) */
    if (!keepLog) dispatchFrame();
    else clearInterval(txCounterRef.current);

    /* Countdown timer (100ms tick) */
    let elapsed = 0;
    txCounterRef.current = setInterval(() => {
      if (txPausedRef.current) return;   // ⏸ countdown frozen while paused
      elapsed += 0.1;
      const remaining = Math.max(0, 2 - (elapsed % 2));
      setTxCountdown(remaining);
    }, 100);

    /* Next frames: shown by the inject loop in transmitCsv() at the moment
     * each frame is actually sent (replayStepRef), instead of by a separate
     * 2 s timer — a free-running timer drifted out of step with the real
     * sends (most visibly after a ⏸ pause), so the log could finish a frame
     * short ("7 PKTS" for an 8-frame run). */
    replayStepRef.current = dispatchFrame;
  }, [rawCsv]);

  /* Cleanup on unmount */
  useEffect(() => () => {
    clearInterval(txTimerRef.current);
    clearInterval(txCounterRef.current);
  }, []);

  const hasAnyResult = apdResult || maResult || rfidTagResult || stationResult || csvEncodeResult;

  /* Show TX overlay immediately when transmission starts — auto-activate */
  const showTxOverlay = txState !== "idle";

  /* ▤ STATIC DATA: the selected table, or the first loaded one. */
  const tableOrder = [["apd", apdResult], ["ma", maResult], ["rfidTag", rfidTagResult], ["station", stationResult], ["csv", csvEncodeResult]];
  const loadedCount = tableOrder.filter(([, r]) => r).length;
  const shownTable = (tablePane && tableOrder.find(([k, r]) => k === tablePane && r)) ? tablePane
    : (tableOrder.find(([, r]) => r) || [null])[0];
  busyRef.current = txState === "transmitting" || serialTxState === "transmitting";

  const sidebarVisible = activeView === "loco_track" ? showSidebarInTrack : drawerOpen;
  const toggleDrawer = useCallback(() => {
    if (activeView === "loco_track") setShowSidebarInTrack(v => !v);
    else setDrawerOpen(v => !v);
  }, [activeView]);
  const openDrawer = useCallback(() => {
    if (activeView === "loco_track") setShowSidebarInTrack(true);
    else setDrawerOpen(true);
  }, [activeView]);
  // keys only while this page is on screen (SvkSim stays mounted behind other tabs)
  useEffect(() => {
    const onKey = e => {
      if (!rootRef.current || rootRef.current.offsetParent === null) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        toggleDrawer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDrawer]);
  // ⚙ "Close the drawer when a transmission starts"
  const txBusy = busyRef.current;
  const prevTxBusy = useRef(txBusy);
  useEffect(() => {
    if (txBusy && !prevTxBusy.current && settingsRef.current.autoHideOnTx) {
      setDrawerOpen(false);
      setShowSidebarInTrack(false);
    }
    prevTxBusy.current = txBusy;
  }, [txBusy]);
  const drawerFiles = [
    { key: "apd",   icon: "▤",  label: "APD",           color: "var(--amber)",  info: apdResult ? (apdResult.filename || apdResult.fileName || "loaded") + " · " + (apdResult.table_size ?? apdResult.rows_loaded ?? "?") + " rows" : null },
    { key: "ma",    icon: "⇄",  label: "MA table",      color: "var(--cyan)",   info: maResult ? (maResult.filename || maResult.fileName || "loaded") + " · " + (maResult.table_size ?? maResult.rows_loaded ?? "?") + " rows" : null },
    { key: "rfid",  icon: "📍", label: "RFID tag table", color: "var(--green)",  info: rfidTagResult ? (rfidTagResult.filename || "loaded") + " · " + ((rfidTagResult.rows || []).length) + " rows" : null },
    { key: "story", icon: "◈",  label: "StoryBoard",    color: "var(--orange)", info: rawCsv.trim() ? rawCsv.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith("#")).length + " lines" + (csvEncodeResult ? " · " + csvEncodeResult.length + " pkts encoded" : "") : null },
  ];

  // 📍 RFID tag table → 📡 LIVE page (track visualiser + DMI position)
  useEffect(() => {
    if (!rfidTagResult) return;
    tagTableStore.set({
      fileName: rfidTagResult.filename || "",
      tags: (rfidTagResult.rows || []).map(r => ({ id: r.tagId, loc: r.location })),
    });
  }, [rfidTagResult]);

  useEffect(() => {
    svkSessionStore.set({
      files: drawerFiles.map(({ key, label, info }) => ({ key, label, info })),
      txState, serialTxState, serialDevice: serialCfg.tty_device || "—", baud: serialCfg.baud_rate, radioId, destIp,
    });
  }, [apdResult, maResult, rfidTagResult, rawCsv, csvEncodeResult, txState, serialTxState, serialCfg, radioId, destIp]); // eslint-disable-line react-hooks/exhaustive-deps

  /* A loaded table by its tab key; null when that table isn't loaded. */
  const renderTable = (key) =>
      key === "apd"     && apdResult       ? <ApdResults data={apdResult} />
    : key === "ma"      && maResult        ? <MaTableResults data={maResult} />
    : key === "rfidTag" && rfidTagResult   ? <RfidTagResults data={rfidTagResult} />
    : key === "station" && stationResult   ? <StationResults data={stationResult} />
    : key === "csv"     && csvEncodeResult ? <CsvEncodeResults data={csvEncodeResult} rawCsv={rawCsv} />
    : null;

  /* ── API: parse Station XML (kept for backend compat; no longer wired
   *  to a sidebar panel — that slot now loads the Track Profile / APD
   *  workbook instead, see loadApd() below) ── */
  const parseStation = useCallback(async (xml) => {
    setStationLoading(true); setStationError(null);
    try {
      const res  = await fetch("http://localhost:8000/svk/parse_station", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xml }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Parse failed");
      setStationResult(body.data);
      setActiveResult("station"); setTablePane("station"); showLoadedFiles();
    } catch (e) { setStationError(e.message); }
    finally { setStationLoading(false); }
  }, []);

  /* ── API: load Track Profile (APD) workbook ──
   * POSTs the .xlsx file as multipart/form-data to
   * /svk/load_track_profile, which parses it with openpyxl and loads it
   * into the C layer's Track Profile table for ROUTE1..ROUTE4 lookups
   * during storyboard encoding/transmission. */
  const loadApd = useCallback(async (file) => {
    setApdLoading(true); setApdError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res  = await fetch("http://localhost:8000/svk/load_track_profile", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Track Profile load failed");
      setApdResult(body);
      setActiveResult("apd"); setTablePane("apd"); showLoadedFiles();
    } catch (e) { setApdError(e.message); }
    finally { setApdLoading(false); }
  }, []);

  /* ── API: load MA-from-RFID table (SKP_MA_PINJ.xlsx) ──
   * POSTs the .xlsx file as multipart/form-data to /svk/load_ma_table
   * (columns S.No, LAST_RFID_TAG, MA). Once loaded, every Onboard→Station
   * (L2S) packet received over serial whose LAST_RFID_TAG matches a row
   * here updates the live MA value in real time — the very next
   * Station→Onboard (S2L) packet sent over serial then carries that MA
   * in its MOVEMENT AUTHORITY sub-packet's MA_W_R_T_SIG field. See
   * liveMa state (updated from the "ma_update" WS event, below) and the
   * indicator rendered in SerialTxLog. */
  const loadMaTable = useCallback(async (file) => {
    setMaLoading(true); setMaError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res  = await fetch("http://localhost:8000/svk/load_ma_table", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "MA table load failed");
      setMaResult(body);
      setActiveResult("ma"); setTablePane("ma"); showLoadedFiles();
    } catch (e) { setMaError(e.message); }
    finally { setMaLoading(false); }
  }, []);

  /* ── RFID Tag → real absolute location table ──
   * Parsed entirely client-side (via the same SheetJS reader the
   * StoryBoard loader below uses) — this is a pure lookup table used only
   * to calibrate the Live Track Profile chart, so it doesn't need a
   * backend round-trip. Expected columns: S.No, RFID Tag, RFID Tag
   * Location. Every profile's own RFID/TLI layer uses a LOCAL, 0-based
   * distance; this table gives each tag's real chainage, so
   * LiveTrackProfile can work out the constant offset between the two
   * and plot the loco (whose own ABS_LOCO_LOC field is already a real
   * absolute chainage) at its true location instead of relative to "0". */
  const loadRfidTagTable = useCallback(async (file) => {
    setRfidTagLoading(true); setRfidTagError(null);
    try {
      const rows = [];
      const map = {};
      const addRow = (cells) => {
        if (!cells || cells.length < 2) return;
        const tagId    = Number(cells[1]);
        const location = Number(cells[2]);
        if (!Number.isFinite(tagId) || !Number.isFinite(location)) return; // also skips the header row
        const sno = Number(cells[0]);
        rows.push({ sno: Number.isFinite(sno) ? sno : rows.length + 1, tagId, location });
        map[tagId] = location;
      };

      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "xlsx" || ext === "xls") {
        // Read the actual cell VALUES directly, not a re-parsed CSV
        // string — sidesteps a real gotcha: if the "RFID Tag Location"
        // column has a thousands-separator number format applied (very
        // common for chainage values, e.g. showing as "135,220"),
        // sheet_to_csv() renders that formatted text, so the comma
        // *inside* one cell splits it into two and silently drops every
        // row. sheet_to_json({raw:true}) returns the underlying number
        // itself, immune to that.
        const XLSX = await import("xlsx");   // bundled locally (node_modules/xlsx 0.20.3) — no internet needed
        const buf  = await file.arrayBuffer();
        const wb   = XLSX.read(buf, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
        grid.forEach(rowArr => addRow((rowArr || []).map(v => (v == null ? "" : String(v).trim()))));
      } else {
        const text = await file.text();
        text.split(/\r?\n/).forEach(line => {
          const raw = line.trim();
          if (!raw || raw.startsWith("#")) return;
          // Auto-detect delimiter — tab if the line has one (e.g. pasted
          // straight from a spreadsheet), otherwise comma.
          const delim = raw.includes("\t") ? "\t" : ",";
          addRow(raw.split(delim).map(c => c.trim()));
        });
      }

      if (!rows.length) throw new Error("No valid rows found — expected columns S.No, RFID Tag, RFID Tag Location");
      setRfidTagResult({
        filename: file.name, rows_loaded: rows.length, rows, map,
        columns: ["S.No", "RFID Tag", "RFID Tag Location"],
        sheetRows: rows.map(r => [r.sno, r.tagId, r.location]),
      });
      setActiveResult("rfidTag"); setTablePane("rfidTag"); showLoadedFiles();
    } catch (e) {
      setRfidTagError(e.message);
    } finally {
      setRfidTagLoading(false);
    }
  }, []);

  /*
   * ── API: transmit StoryBoard CSV ──
   *
   * Sends HTTP POST to /svk/transmit_storyboard_csv which calls
   *   transmit_storyboard_csv(csv, dest_ip, dest_port, loop, &stop_flag)
   * in the C layer.
   *
   * Simultaneously starts the client-side TX replay (visual simulation of
   * per-frame dispatch). The C layer drives actual UDP packet delivery;
   * the JS layer drives the display.
   *
   * NOTE: The server call is fire-and-await; the UI doesn't wait for it to
   * finish before starting the visual replay — both run in parallel.
   */
  const transmitCsv = useCallback(async (cfg) => {
    txCsvRef.current = cfg.csv; setTxCsv(cfg.csv); txNewStoryRef.current = null;
    setActiveResult("__tx__");
    setActiveView("http");       // UDP / HTTP view = the TX log (tables are under ▤ STATIC DATA)
    txPausedRef.current = false; setTxPaused(false); setTxPauseInfo(null);
    setCsvError(null);
    setTxLog([]);
    setTxSent(0);
    setTxFrameNum(null);

    /* ── Step 1: Encode ── */
    setTxEncodeLoading(true);
    setTxState("transmitting");
    let encodedData = null;
    try {
      const res  = await fetch("http://localhost:8000/svk/encode_storyboard_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: cfg.csv, radio_id: cfg.radio_id || 1 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Encode failed");
      encodedData = body.data;
      setCsvEncodeResult(encodedData);
    } catch (e) {
      setCsvError(e.message);
      setTxState("error");
      setTxEncodeLoading(false);
      return;
    }
    setTxEncodeLoading(false);

    if (!encodedData || !encodedData.length) {
      setCsvError("No packets to transmit after encoding.");
      setTxState("error");
      return;
    }

    /* ── Step 2: Start client visual replay ── */
    startClientTxReplay(encodedData);

    /* ── Step 3: Inject packets into the Decode LIVE page, frame by frame ──
     *
     * Group by frame_num; send each frame's packets to POST /live/inject
     * then wait 2 s (TDMA epoch) before the next frame.
     * /live/inject pushes the hex to the backend which decodes it and
     * broadcasts { type:"packet", data:decoded } to all WebSocket clients.
     * This makes packets appear on the Decode LIVE page in real-time.
     */
    stopFlagRef.current = false;

    const groupFrames = data => {
      const frameMap = new Map();
      data.forEach(pkt => {
        if (!frameMap.has(pkt.frame_num)) frameMap.set(pkt.frame_num, []);
        frameMap.get(pkt.frame_num).push(pkt);
      });
      return [...frameMap.entries()];
    };
    let frames = groupFrames(encodedData);
    const sleep  = ms => new Promise(r => setTimeout(r, ms));

    // ⏸ Hold while paused. On RESUME: if a NEW storyboard was loaded while
    // paused (see resumeTransmit), switch to it — same session, TX log kept —
    // and return true so the caller restarts at its frame 1; otherwise false
    // (continue from the frame where it paused).
    const hold = async (nextIdx) => {
      if (!txPausedRef.current) return false;
      setTxPauseInfo({ next: nextIdx + 1, total: frames.length });
      while (txPausedRef.current && !stopFlagRef.current) await sleep(100);
      setTxPauseInfo(null);
      const ns = txNewStoryRef.current;
      txNewStoryRef.current = null;
      if (!ns || stopFlagRef.current) return false;
      frames = groupFrames(ns.encoded);
      cfg = { ...cfg, csv: ns.csv };
      startClientTxReplay(ns.encoded, { keepLog: true, csv: ns.csv });
      setCsvEncodeResult(prev => [...(prev || []), ...ns.encoded]);
      return true;
    };

    let fi = 0, showNow = false;
    while (fi < frames.length) {
      if (stopFlagRef.current) break;
      if (await hold(fi)) { fi = 0; showNow = true; }
      if (stopFlagRef.current) break;
      const [, pkts] = frames[fi];
      // Show this frame in the TX log now, as it is sent (frame 1 of the
      // first storyboard was already shown by startClientTxReplay).
      if (fi > 0 || showNow) replayStepRef.current?.();
      showNow = false;

      /* POST each packet to /live/inject.
       * We send csv_row (the raw CSV line) alongside the pre-encoded hex
       * so the backend can re-encode it with the live wall-clock FRAME_NUM
       * (= seconds since midnight per Annexure-C) at the moment of injection,
       * ensuring the decoded packet on the LIVE page shows the correct value. */
      await Promise.all(
        pkts
          .filter(p => !p.error)
          .map(p =>
            fetch("http://localhost:8000/live/inject", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                csv_row:     p.csv_row  ?? "",   // raw CSV line for live re-encoding
                hex:         p.hex      ?? "",   // fallback pre-encoded hex
                activeRadio: "0xF1",
                source:      "SVK_SIM",
              }),
            }).catch(() => {})
          )
      );

      /* Wait the TDMA epoch before next frame */
      // 2 s TDMA epoch before the next frame — only un-paused time counts, so
      // after a pause the rest of the gap is still kept before the next burst.
      // Paused on the LAST frame: hold too, so a new storyboard can still be
      // loaded and resumed into this same session.
      let swapped = false;
      const isLast = fi === frames.length - 1;
      if (isLast && txPausedRef.current) swapped = await hold(fi + 1);
      if ((!isLast || swapped) && !stopFlagRef.current) {
        let waited = 0;
        while (waited < 2000 && !stopFlagRef.current) {
          if (txPausedRef.current && await hold(fi + 1)) swapped = true;
          await sleep(100);
          waited += 100;
        }
      }
      if (swapped) { fi = 0; showNow = true; } else fi += 1;
    }

    if (!stopFlagRef.current) {
      setTxState(prev => prev === "stopped" ? "stopped" : "done");
      clearInterval(txTimerRef.current);
      clearInterval(txCounterRef.current);
    }

    /* ── Step 4 (optional): UDP transmit to non-local target ──
     * Only attempted if dest differs from the default 127.0.0.1:12345.
     * Best-effort: errors are silently ignored.
     */
    if (cfg.dest_ip !== "127.0.0.1" || Number(cfg.dest_port) !== 12345) {
      fetch("http://localhost:8000/svk/transmit_storyboard_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      }).catch(() => {});
    }
  }, [startClientTxReplay]);

  /* ── API: stop transmission ── */
  const pauseTransmit  = useCallback(() => { txPausedRef.current = true;  setTxPaused(true); }, []);
  const resumeTransmit = useCallback(async () => {
    // A different storyboard loaded while paused → encode it now and hand it to
    // the running loop, which continues with it from its frame 1 (same session,
    // TX log kept). Otherwise → continue from the frame where it paused.
    const loaded = rawCsvRef.current;
    if (loaded.trim() && loaded !== txCsvRef.current) {
      try {
        const res  = await fetch("http://localhost:8000/svk/encode_storyboard_csv", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: loaded, radio_id: radioId || 1 }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail || "Encode failed");
        if (!body.data || !body.data.length) throw new Error("New storyboard has no packets after encoding.");
        txNewStoryRef.current = { encoded: body.data, csv: loaded };
        txCsvRef.current = loaded; setTxCsv(loaded);
        setCsvError(null);
      } catch (e) {
        setCsvError(`New storyboard not used: ${e.message}`);
        return;                                   // stay paused
      }
    }
    txPausedRef.current = false; setTxPaused(false); setTxPauseInfo(null);
  }, [radioId]);

  const stopTransmit = useCallback(async () => {
    stopFlagRef.current = true;
    txPausedRef.current = false; setTxPaused(false); setTxPauseInfo(null);
    setTxState("stopped");
    clearInterval(txTimerRef.current);
    clearInterval(txCounterRef.current);
    try { await fetch("http://localhost:8000/svk/transmit_stop", { method: "POST" }); } catch (_) {}
  }, []);

  /* When TX state goes to done/stopped/error but not idle, show TX panel;
     Switch back to CSV result view when user dismisses */
  const dismissTx = useCallback(() => {
    setActiveResult(a => (a === "__tx__" ? "csv" : a));   // closed TX tab → the encoded-packet table
    setTxState("idle");
    setTxLog([]);
    setTxSent(0);
    setTxFrameNum(null);
  }, []);

  /* ═══════════════════════════════════════════════════════════════════════
   * RENDER
   * ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div ref={rootRef} style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "var(--bg-base)", overflow: "hidden",
      fontFamily: "var(--font-mono)", position: "relative",
    }}>
      {/* Scanline texture (⚙ Settings → Display) */}
      {settings.scanlines && <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.012) 2px, rgba(0,255,136,0.012) 4px)" }} />}

      {/* ── TOP BAR ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "7px 16px",
        borderBottom: `1px solid ${txState === "transmitting" ? "rgba(255,107,0,0.5)" : "var(--border)"}`,
        background: "var(--bg-surface)", flexShrink: 0, position: "relative", zIndex: 1,
        transition: "border-color 0.3s",
      }}>
        <StatusDot color={txState === "transmitting" ? "orange" : "green"} pulse={txState === "transmitting"} />
        <span style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.2em", color: txState==="transmitting"?"var(--orange)":"var(--green)", textShadow: `0 0 16px ${txState==="transmitting"?"var(--orange)":"var(--green)"}66`, transition: "color 0.3s" }}>
          SVK SIM
        </span>
        <span style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.08em" }}>C-POWERED · RDSO/SPN/196/2020 ANNEXURE-C</span>
        <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", padding: "2px 7px", borderRadius: 3, background: "rgba(0,255,136,0.08)", border: "1px solid var(--green-deep)", color: "var(--green)", fontWeight: 700, letterSpacing: "0.08em" }}>svk_sim.c · SIL-4</span>
        <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", padding: "2px 7px", borderRadius: 3, background: "var(--cyan-glow)", border: "1px solid var(--cyan-dim)", color: "var(--cyan)", fontWeight: 700, letterSpacing: "0.08em" }}>HTTP SOCKET</span>

        {/* UDP / Serial view toggle */}
        <div style={{ marginLeft: 8, display: "flex", gap: 2, padding: "2px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-raised)" }}>
          <button onClick={() => setActiveView("tables")} title="Static data — APD track profiles, MA table, RFID tag locations and the encoded packets"
            style={{ padding: "3px 10px", borderRadius: 3, fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: 700, border: "none", cursor: "pointer", background: activeView==="tables" ? "var(--amber-glow, rgba(245,166,35,0.12))" : "transparent", color: activeView==="tables" ? "var(--amber, #f5a623)" : "var(--text-dim)", transition: "all 0.15s", letterSpacing: "0.06em", display: "inline-flex", alignItems: "center", gap: 5 }}>
            ▤ STATIC DATA
            {loadedCount > 0 && <span style={{ fontSize: 7.5, padding: "0 5px", borderRadius: 6, border: "1px solid currentColor", lineHeight: "11px" }}>{loadedCount}</span>}
          </button>
          <button onClick={() => setActiveView("http")} style={{ padding: "3px 10px", borderRadius: 3, fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: 700, border: "none", cursor: "pointer", background: activeView==="http" ? "var(--cyan-glow)" : "transparent", color: activeView==="http" ? "var(--cyan)" : "var(--text-dim)", transition: "all 0.15s", letterSpacing: "0.06em" }}>UDP / HTTP</button>
          <button onClick={() => setActiveView("serial")} style={{ padding: "3px 10px", borderRadius: 3, fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: 700, border: "none", cursor: "pointer", background: activeView==="serial" ? "var(--purple-glow)" : "transparent", color: activeView==="serial" ? "var(--purple)" : "var(--text-dim)", transition: "all 0.15s", letterSpacing: "0.06em" }}>📡 SERIAL</button>
          <button onClick={() => setActiveView("loco_track")} style={{ padding: "3px 10px", borderRadius: 3, fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: 700, border: "none", cursor: "pointer", background: activeView==="loco_track" ? "var(--cyan-glow)" : "transparent", color: activeView==="loco_track" ? "var(--cyan)" : "var(--text-dim)", transition: "all 0.15s", letterSpacing: "0.06em" }}>🚆 LIVE TRACK</button>
        </div>

        {/* ☰ Loaders drawer toggle (every view; LIVE TRACK keeps its own
            open/closed state and starts closed to use the full screen) */}
        <SvkTopBtn onClick={toggleDrawer} active={sidebarVisible} title={(sidebarVisible ? "Hide" : "Show") + " the loaders drawer (Ctrl+B)"}>
          ☰ {sidebarVisible ? "HIDE LOADERS" : "SHOW LOADERS"}
        </SvkTopBtn>

        {/* View tabs — each view has its own log tab plus the loaded-table
            tabs, so a running transmission never hides the loaded tables:
            switch to APD / MA / RFID while it keeps transmitting, and back. */}
        {/* Right side of the bar, per view:
            ▤ STATIC DATA → one tab per loaded table
            UDP / HTTP     → status of the UDP transmission (+ DISMISS when finished)
            SERIAL / LIVE TRACK → nothing extra (their own panels show status) */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          {activeView === "tables" && <>
            {apdResult        && <ResultTab active={shownTable === "apd"}     color="amber"  onClick={() => setTablePane("apd")}>▤ APD</ResultTab>}
            {maResult         && <ResultTab active={shownTable === "ma"}      color="cyan"   onClick={() => setTablePane("ma")}>🎯 MA TABLE</ResultTab>}
            {rfidTagResult    && <ResultTab active={shownTable === "rfidTag"} color="green"  onClick={() => setTablePane("rfidTag")}>📍 RFID TAGS</ResultTab>}
            {stationResult    && <ResultTab active={shownTable === "station"} color="amber"  onClick={() => setTablePane("station")}>◉ Station</ResultTab>}
            {csvEncodeResult  && <ResultTab active={shownTable === "csv"}     color="orange" onClick={() => setTablePane("csv")}>▦ Encoded Pkts</ResultTab>}
          </>}
          {activeView === "http" && showTxOverlay && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
              color: txState === "transmitting" ? (txPaused ? "var(--amber, #f5a623)" : "var(--orange)") : "var(--text-dim)" }}>
              {txState === "transmitting"
                ? (txPaused ? `⏸ TX PAUSED · ${txSent}/${(csvEncodeResult || []).length}` : `● TX LIVE · ${txSent}/${(csvEncodeResult || []).length}`)
                : `◈ TX ${txState === "done" ? "COMPLETE" : txState === "stopped" ? "STOPPED" : "ENDED"} · ${txSent} PKTS`}
            </span>
          )}
          {activeView === "http" && showTxOverlay && txState !== "transmitting" && (
            <button onClick={dismissTx} title="Close the TX log of the finished transmission"
              style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 8, cursor: "pointer", letterSpacing: "0.08em" }}>✕ DISMISS</button>
          )}
        </div>
      </div>

      {/* ── MAIN BODY ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>

        {/* LEFT: ☰ loaders drawer — slides between a 40 px rail (closed)
             and the 330 px panel (open). Never unmounted, so loaded files
             and the storyboard text survive while it is closed. */}
        <div style={{
          width: sidebarVisible ? 330 : 40, flexShrink: 0, position: "relative",
          borderRight: "1px solid var(--border)", background: "var(--bg-surface)",
          transition: "width 0.28s cubic-bezier(0.4,0,0.2,1)", overflow: "hidden", height: "100%", minHeight: 0,
        }}>
          {/* closed: rail with the load status of each file */}
          <div aria-hidden={sidebarVisible} style={{
            position: "absolute", top: 0, left: 0, bottom: 0, width: 40, display: "flex", flexDirection: "column", alignItems: "center",
            gap: 6, padding: "8px 0", opacity: sidebarVisible ? 0 : 1, pointerEvents: sidebarVisible ? "none" : "auto",
            transition: "opacity 0.2s",
          }}>
            <button className="svk-rail-btn" onClick={openDrawer} title="Open the loaders drawer (Ctrl+B)" style={{ color: "var(--cyan)", borderColor: "var(--border-bright)" }}>☰</button>
            <div style={{ width: 20, height: 1, background: "var(--border)", margin: "2px 0" }} />
            {drawerFiles.map(f => (
              <button key={f.key} className="svk-rail-btn" onClick={openDrawer} title={f.label + ": " + (f.info || "not loaded") + " — click to open the drawer"}
                style={{ color: f.info ? f.color : "var(--text-secondary)", opacity: f.info ? 1 : 0.55 }}>
                {f.icon}
                <span style={{ position: "absolute", right: 3, bottom: 3, width: 6, height: 6, borderRadius: "50%",
                  background: f.info ? "var(--green)" : "var(--border-bright)", boxShadow: f.info ? "0 0 5px var(--green)" : "none" }} />
              </button>
            ))}
            <button className="svk-rail-btn" onClick={openDrawer} title={"Serial modem: " + (serialCfg.tty_device || "—") + (serialTxState === "transmitting" ? " · transmitting" : "")}
              style={{ color: serialTxState === "transmitting" ? "var(--purple)" : "var(--text-muted)" }}>📡</button>
            <div onClick={openDrawer} style={{ marginTop: 8, writingMode: "vertical-rl", transform: "rotate(180deg)", cursor: "pointer",
              fontSize: 9, fontWeight: 700, letterSpacing: "0.3em", color: "var(--text-secondary)" }}>LOADERS · {loadedCount} LOADED</div>
          </div>

          {/* open: the loader panels */}
          <div style={{
            position: "absolute", top: 0, left: 0, bottom: 0, width: 330, display: "flex", flexDirection: "column",
            opacity: sidebarVisible ? 1 : 0, transform: sidebarVisible ? "none" : "translateX(-24px)",
            visibility: sidebarVisible ? "visible" : "hidden", pointerEvents: sidebarVisible ? "auto" : "none",
            transition: "opacity 0.22s, transform 0.28s cubic-bezier(0.4,0,0.2,1), visibility 0s linear " + (sidebarVisible ? "0s" : "0.28s"),
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px 7px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-raised)", flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "var(--text-secondary)" }}>☰ LOADERS</span>
              <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 8, border: "1px solid var(--green-deep)", color: "var(--green)" }}>{loadedCount} LOADED</span>
              <button onClick={toggleDrawer} title="Close the drawer (Ctrl+B)" style={{
                marginLeft: "auto", padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent",
                color: "var(--text-secondary)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700, letterSpacing: "0.08em",
              }}>◀ HIDE</button>
            </div>
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", gap: 8, padding: 10,
          overflowY: "auto", overflowX: "hidden", minHeight: 0,
        }}>
          {/* ① Track Profile (APD) — replaces the old "Load Station XML" slot */}
          <ApdLoader label="Load APD" icon="▤" accentColor="amber" loading={apdLoading} error={apdError} loadedInfo={apdResult} onLoad={loadApd} />
          <ErrorAlert message={apdError} />

          {/* ①b MA-from-RFID table (SKP_MA_PINJ.xlsx) — real-time Movement
           * Authority update: every Onboard→Station (L2S) packet received
           * over serial has its LAST_RFID_TAG looked up here; on a match,
           * the next Station→Onboard (S2L) TX carries that row's MA (and,
           * once the sheet has them, curSigInfo/curSigAsp/nxtSigAsp/
           * apprSigDist too) patched into its MOVEMENT AUTHORITY sub-packet.
           * See loadMaTable() / POST /svk/load_ma_table and the "ma_update"
           * WS events surfaced live in the serial log below. */}
          <ApdLoader
            label="Load MA Table" icon="⇄" accentColor="cyan"
            loading={maLoading} error={maError} loadedInfo={maResult} onLoad={loadMaTable}
            kind="MA (from RFID)" buttonLabel="LOAD MA TABLE"
            hint="SKP_MA_PINJ.xlsx — S.No, LAST_RFID_TAG, MA (+ optional distPktStart, curSigInfo, curSigAsp, nxtSigAsp, apprSigDist)"
          />
          <ErrorAlert message={maError} />
          {liveMa && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6, margin: "-2px 2px 2px",
              padding: "4px 8px", borderRadius: 4,
              background: "var(--cyan-glow)",
              border: "1px solid var(--cyan-dim)",
              fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--text-secondary)",
            }}>
              <span style={{ color: "var(--cyan)", fontWeight: 700 }}>● LIVE MA</span>
              <span>tag {liveMa.rfid_tag} →</span>
              {Object.entries(liveMa.fields || {}).map(([k, v]) => (
                <span key={k} style={{ color: "var(--text-code)" }}>{k}={v}</span>
              ))}
              <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>{liveMa.ts}</span>
            </div>
          )}

          {/* ①c RFID Tag → real absolute location table — pure client-side
           * calibration lookup for 🚆 LIVE TRACK (no backend round-trip).
           * Every profile's own RFID/TLI layer uses a LOCAL, 0-based
           * distance; this table gives each tag's REAL chainage, so
           * LiveTrackProfile can work out the constant offset between the
           * two and plot the loco (whose ABS_LOCO_LOC is already a real
           * absolute chainage) at its true location instead of relative
           * to "0". See loadRfidTagTable() and the chainageOffset
           * calibration inside LiveTrackProfile.jsx. */}
          <ApdLoader
            label="Load RFID Tag Table" icon="📍" accentColor="green"
            loading={rfidTagLoading} error={rfidTagError} loadedInfo={rfidTagResult} onLoad={loadRfidTagTable}
            kind="RFID Tag Location" buttonLabel="LOAD RFID TAG TABLE"
            hint="S.No, RFID Tag, RFID Tag Location"
          />
          <ErrorAlert message={rfidTagError} />

          {/* ② StoryBoard CSV */}
          <CsvLoader
            onTransmit={transmitCsv}
            onStop={stopTransmit}
            onPause={pauseTransmit}
            onResume={resumeTransmit}
            txPaused={txPaused}
            txPauseInfo={txPauseInfo}
            txCsv={txCsv}
            txEncodeLoading={txEncodeLoading}
            txState={txState}
            rawCsv={rawCsv}
            setRawCsv={setRawCsv}
            destIp={destIp}
            setDestIp={setDestIp}
            radioId={radioId}
            setRadioId={setRadioId}
          />
          <ErrorAlert message={csvError} />

          {/* ③ Serial Radio Modem config */}
          <SerialConfig
            serialCfg={serialCfg}
            setSerialCfg={setSerialCfg}
            availablePorts={availablePorts}
            portsLoading={portsLoading}
            portsError={portsError}
            pyserialHint={pyserialHint}
            wslWarning={wslWarning}
            onRefreshPorts={refreshPorts}
            serialTxState={serialTxState}
            onSerialTransmit={handleSerialTransmit}
            onSerialStop={handleSerialStop}
            onSerialPause={handleSerialPause}
            onSerialResume={handleSerialResume}
            serialTxPaused={serialTxPaused}
            serialPauseInfo={serialPauseInfo}
            serialTxCsv={serialTxCsv}
            serialResumeError={serialResumeError}
            rawCsv={rawCsv}
            onPortTestResult={(status, message, sim) => setPortTest({ status, message, sim })}
            portTest={portTest}
            radioId={radioId}
            setRadioId={setRadioId}
          />

          {/* engine notes + how-to are under ⓘ ABOUT (top bar) */}
          <div style={{ height: 8, flexShrink: 0 }} />
        </div>
          </div>
        </div>

        {/* RIGHT: Result / TX panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-base)", position: "relative" }}>

          {/* 🚆 LIVE TRACK — track profile (APD row or last-transmitted C.4.2
             * on the wire) with real-time loco movement decoded from every
             * Onboard→Station (L2S) packet on the existing serial RX feed.
             * Reuses the serialLog state already fed by /ws/serial_log above —
             * no second WebSocket connection.
             *
             * ALWAYS MOUNTED (never conditionally rendered) — only its CSS
             * visibility toggles with activeView. This is the fix for the
             * "chart resets when I switch tabs" bug: unmounting/remounting
             * this component was wiping its loco-position map, calibration
             * origin, and LIVE MA / APD TABLE ROW toggle every time. */}
          <div style={{ display: activeView === "loco_track" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
            <LiveTrackProfile apdResult={apdResult} serialLog={serialLog} rfidTagTable={rfidTagResult}/>
          </div>

          {activeView === "loco_track" ? null : activeView === "tables" ? (
            /* ▤ STATIC DATA — only the loaded tables, never the TX logs */
            renderTable(shownTable) || <EmptyState lines={["STATIC DATA", "NO STATIC DATA LOADED YET…", "LOAD APD · MA TABLE · RFID TAG TABLE (left)", "ENCODED PACKETS APPEAR HERE AFTER TRANSMIT"]} />
          ) : activeView === "serial" ? (
            <SerialTxLog
              serialLog={serialLog}
              serialTxState={serialTxState}
              serialTxStats={serialTxStats}
              onStop={handleSerialStop}
              portTest={portTest}
              serialCfg={serialCfg}
            />
          ) : showTxOverlay ? (
            /* UDP / HTTP — the transmission log only */
            <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>
              {/* Left split: TX Live Log */}
              <div style={{ flex: csvEncodeResult ? "0 0 55%" : 1, borderRight: csvEncodeResult ? "1px solid var(--border)" : "none", overflow: "hidden", display: "flex", flexDirection: "column" }}>                <TxLiveLog
                  txLog={txLog}
                  txState={txState}
                  txSent={txSent}
                  txTotal={(csvEncodeResult || []).length}
                  txFrameNum={txFrameNum}
                  txCountdown={txCountdown}
                  onStop={stopTransmit}
                  destIp={destIp}
                />
              </div>
              {/* Right split: Encoded packet table */}
              {csvEncodeResult && (
                <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
                  <CsvEncodeResults data={csvEncodeResult} rawCsv={rawCsv} />
                </div>
              )}
            </div>
          ) : (
            <SvkIdleScene lines={["UDP / HTTP TRANSMISSION", "NO TRANSMISSION YET…", "LOAD A STORYBOARD → ◈ TRANSMIT STORYBOARD (left)", "APD · MA · RFID TABLES ARE UNDER ▤ STATIC DATA"]} />
          )}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{
        borderTop: `1px solid ${txState==="transmitting"?"rgba(255,107,0,0.4)":"var(--border)"}`,
        padding: "4px 16px", flexShrink: 0,
        display: "flex", gap: 16, alignItems: "center",
        fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)",
        background: "var(--footer-bg)", position: "relative", zIndex: 1,
        transition: "border-color 0.3s",
      }}>
        {apdResult       && <span style={{ color: "var(--amber-dim)" }}>▤ APD ROWS: {apdResult.table_size ?? apdResult.rows_loaded}</span>}
        {maResult        && <span style={{ color: "var(--cyan-dim)" }}>🎯 MA TAGS: {maResult.table_size ?? maResult.rows_loaded}</span>}
        {stationResult   && <span style={{ color: "var(--amber-dim)" }}>◉ STATIONS: {stationResult.station_count}</span>}
        {csvEncodeResult && <span style={{ color: "var(--orange)" }}>▦ PKTS: {csvEncodeResult.length}</span>}
        {activeView === "serial" && serialTxState === "transmitting" && serialTxPaused && <span style={{ color: "var(--amber, #f5a623)", fontWeight: 700 }}>⏸ SERIAL TX PAUSED · {serialTxStats.tx} PKTS SENT{serialPauseInfo ? ` · RESUMES AT FRAME ${serialPauseInfo.next}/${serialPauseInfo.total}` : ""}</span>}
        {activeView === "serial" && serialTxState === "transmitting" && !serialTxPaused && <span style={{ color: "var(--purple)", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}><StatusDot color="purple" pulse />SERIAL TX · TX:{serialTxStats.tx} RX:{serialTxStats.rx} ERR:{serialTxStats.err}</span>}
        {activeView === "serial" && serialTxState === "done"    && <span style={{ color: "var(--green-dim)", fontWeight: 700 }}>✔ SERIAL TX DONE · {serialTxStats.tx} PKTS</span>}
        {activeView === "serial" && serialTxState === "stopped" && <span style={{ color: "var(--cyan-dim)", fontWeight: 700 }}>■ SERIAL TX STOPPED · {serialTxStats.tx} PKTS</span>}
        {txState === "transmitting" && txPaused && activeView !== "serial" && <span style={{ color: "var(--amber, #f5a623)", fontWeight: 700 }}>⏸ TX PAUSED · {txSent}/{(csvEncodeResult||[]).length} PKTS{txPauseInfo ? ` · RESUMES AT FRAME ${txPauseInfo.next}/${txPauseInfo.total}` : ""}</span>}
        {txState === "transmitting" && !txPaused && activeView !== "serial" && <span style={{ color: "var(--orange)", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}><StatusDot color="orange" pulse />TX LIVE · {txSent}/{(csvEncodeResult||[]).length} PKTS · FRM {txFrameNum ?? "—"}</span>}
        {txState === "done"    && activeView !== "serial" && <span style={{ color: "var(--green-dim)", fontWeight: 700 }}>✔ TX COMPLETE · {txSent} PKTS</span>}
        {txState === "stopped" && activeView !== "serial" && <span style={{ color: "var(--cyan-dim)", fontWeight: 700 }}>■ TX STOPPED · {txSent} PKTS</span>}
        <span style={{ marginLeft: "auto", letterSpacing: "0.06em" }}>⚙ svk_sim.c · RDSO/SPN/196/2020 · Annexure-C · SIL-4 · {activeView === "serial" ? "📡 SERIAL · Guardian™" : "HTTP SOCKET"} · 2s TDMA</span>
      </div>
    </div>
  );
}