import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import SvkSim from "./SvkSim";
import DmiView, { createDmiKeeper, mergeKept } from "./DmiPanel";
import LiveStrip from "./LiveStrip";
import LiveTrackProfile from "./LiveTrackProfile";
import { appSettingsStore, tagTableStore, useStore, SettingsDialog, AboutDialog, AppMenu, playSosAlert, playBrakeAlert, sosCategory, SOS_SOUNDS, stopAlertSound } from "./SettingsAbout";

/* ═══════════════════════════════════════════════════════════════
   THEME DEFINITIONS
   Dark  → Railway Operations Terminal (graphite + amber)
   Light → Crisp Engineering Blueprint (warm white + deep navy)
/* ═══════════════════════════════════════════════════════════════ */
const DARK_THEME = `
  --bg-void:        rgba(6,6,8,0.72);
  --bg-base:        rgba(11,11,15,0.80);
  --bg-surface:     rgba(16,16,21,0.82);
  --bg-raised:      rgba(22,22,30,0.85);
  --bg-hover:       rgba(28,28,39,0.88);
  --bg-input:       rgba(9,16,10,0.85);
  --border:         #1e1e2e;
  --border-bright:  #2a2a42;
  --border-focus:   #f59e0baa;
  --amber:          #f5a623;
  --amber-dim:      #d4870a;
  --amber-glow:     rgba(245,166,35,0.15);
  --amber-text:     #ffc14d;
  --green:          #00e676;
  --cyan:           #00e5ff;
  --red:            #ff1744;
  --purple:         #aa00ff;
  --orange:         #ff6d00;
  --text-primary:   #e8e8f4;
  --text-secondary: #8888a8;
  --text-muted:     #484868;
  --text-dim:       #2e2e48;
  --text-code:      #b5f54a;
  --text-value:     #ea80fc;
  --shadow:         rgba(0,0,0,0.75);
  --scan-color:     rgba(245,166,35,0.3);
  --row-alt:        rgba(255,255,255,0.016);
  --row-alert:      rgba(255,23,68,0.08);
  --section-bg:     linear-gradient(90deg,#12122a,transparent);
  --section-text:   #f5a623;
  --sidebar-active: rgba(245,166,35,0.1);
  --tag-bg:         #181828;
  --tag-border:     #28283e;
  --tag-text:       #b5f54a;
  --topbar-bg:      #08080c;
  --topbar-border:  #181826;
  --footer-bg:      #0d0d12;
  --th-bg:          #0a0a10;
  --btn-secondary:  #16161e;
  --empty-border:   #2a2a42;
  --empty-bg:       #101015;
  --toggle-track:   #1e1e2e;
  --toggle-thumb:   #f5a623;
  --toggle-icon:    "🌙";
  --rail-gold:      #f5a623;
  --rail-steel:     #8899aa;
  --rail-danger:    #ff1744;
  --rail-safe:      #00e676;
  --kavach-blue:    #0055a4;
  --kavach-orange:  #ff6200;
  --ir-maroon:      #800000;
  /* surfaces that used to be hard-coded dark (now theme-aware) */
  --panel-bg:       linear-gradient(180deg,#060610 0%,#040408 100%);
  --panel-bg-alt:   linear-gradient(135deg,#0b0b14 0%,#10101c 60%,#080810 100%);
  --tooltip-bg:     linear-gradient(135deg,#0d0d1e,#0a0a16);
  --hex-strip-bg:   linear-gradient(135deg,#06060f,#040409);
  --hex-strip-border: #14143a;
  --input-deep-bg:  linear-gradient(180deg,#040409,#060608);
  --divider:        #12122a;
  --track-bg:       #1f2937;
  --track-fill-0:   #374151;
  --soft-overlay:   rgba(0,0,0,0.3);
`;

const LIGHT_THEME = `
  --bg-void:        #f0f0f5;
  --bg-base:        #f7f7fb;
  --bg-surface:     #ffffff;
  --bg-raised:      #f2f2f8;
  --bg-hover:       #eaeaf4;
  --bg-input:       #f8fff8;
  --border:         #d8d8e8;
  --border-bright:  #b8b8d0;
  --border-focus:   #1e3a8a88;
  --amber:          #b45309;
  --amber-dim:      #92400e;
  --amber-glow:     rgba(180,83,9,0.08);
  --amber-text:     #92400e;
  --green:          #059669;
  --cyan:           #0284c7;
  --red:            #dc2626;
  --purple:         #7c3aed;
  --orange:         #ea580c;
  --text-primary:   #1a1a2e;
  --text-secondary: #4a4a6a;
  --text-muted:     #7070a0;
  --text-dim:       #a0a0c0;
  --text-code:      #166534;
  --text-value:     #7c3aed;
  --shadow:         rgba(0,0,0,0.12);
  --scan-color:     rgba(180,83,9,0.15);
  --row-alt:        rgba(0,0,60,0.025);
  --row-alert:      rgba(220,38,38,0.06);
  --section-bg:     linear-gradient(90deg,#eff0ff,transparent);
  --section-text:   #1e3a8a;
  --sidebar-active: rgba(30,58,138,0.08);
  --tag-bg:         #f0f0ff;
  --tag-border:     #c8c8e8;
  --tag-text:       #166534;
  --topbar-bg:      #1e2235;
  --topbar-border:  #2a3050;
  --footer-bg:      #f4f4fa;
  --th-bg:          #f0f0f8;
  --btn-secondary:  #f2f2f8;
  --empty-border:   #c0c0da;
  --empty-bg:       #ffffff;
  --toggle-track:   #c8d8f8;
  --toggle-thumb:   #1e3a8a;
  --toggle-icon:    "☀️";
  --panel-bg:       linear-gradient(180deg,#f7f8fc 0%,#f0f2f8 100%);
  --panel-bg-alt:   linear-gradient(135deg,#ffffff 0%,#f6f7fc 60%,#eef0f7 100%);
  --tooltip-bg:     #ffffff;
  --hex-strip-bg:   linear-gradient(135deg,#ffffff,#f6f7fb);
  --hex-strip-border: #d8dcea;
  --input-deep-bg:  #ffffff;
  --divider:        #dfe2ee;
  --track-bg:       #e2e8f0;
  --track-fill-0:   #cbd5e1;
  --soft-overlay:   rgba(15,23,42,0.07);
`;

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Bebas+Neue&family=Exo+2:wght@400;500;600&family=DM+Sans:wght@300;400;500;600&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root { ${DARK_THEME}
  --font-mono:    'IBM Plex Mono', monospace;
  --font-display: 'Bebas Neue', sans-serif;
  --font-body:    'DM Sans', sans-serif;
}

:root.light { ${LIGHT_THEME} }

html, body, #root {
  height: 100%; width: 100%;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-body);
  overflow: hidden;
  transition: background 0.35s ease, color 0.35s ease;
}

* { transition: background-color 0.25s ease, border-color 0.25s ease, color 0.2s ease; }
button, input, textarea, select { transition: background-color 0.25s ease, border-color 0.25s ease, color 0.2s ease, box-shadow 0.2s ease; }

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: var(--bg-surface); }
::-webkit-scrollbar-thumb { background: var(--border-bright); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--amber); }

@keyframes pulse-amber {
  0%,100% { opacity:1; } 50% { opacity:0.35; }
}
@keyframes scan-line {
  0% { transform:translateY(-100%); opacity:0; }
  5% { opacity:1; }
  95% { opacity:1; }
  100% { transform:translateY(100vh); opacity:0; }
}
@keyframes fade-up {
  from { opacity:0; transform:translateY(8px); }
  to   { opacity:1; transform:translateY(0); }
}
@keyframes row-in {
  from { opacity:0; transform:translateX(-6px); }
  to   { opacity:1; transform:translateX(0); }
}
@keyframes theme-spin {
  0%   { transform: rotate(0deg) scale(1); }
  50%  { transform: rotate(180deg) scale(1.3); }
  100% { transform: rotate(360deg) scale(1); }
}
@keyframes toast-in {
  from { opacity:0; transform:translateX(110%); }
  to   { opacity:1; transform:translateX(0); }
}
@keyframes toast-out {
  from { opacity:1; transform:translateX(0); }
  to   { opacity:0; transform:translateX(110%); }
}
@keyframes toast-bar {
  from { width:100%; }
  to   { width:0%; }
}
@keyframes loco-move {
  0%   { transform: translateX(var(--loco-from,0px)); }
  100% { transform: translateX(var(--loco-to,0px)); }
}
@keyframes sos-ring {
  0%   { r:8;  opacity:0.9; stroke-width:3; }
  100% { r:60; opacity:0;   stroke-width:0.5; }
}
@keyframes sig-lamp-on {
  0%   { opacity:0.1; }
  60%  { opacity:1.1; }
  100% { opacity:1; }
}
@keyframes speed-sweep {
  from { stroke-dashoffset: var(--spd-from,251); }
  to   { stroke-dashoffset: var(--spd-to,251); }
}
@keyframes brake-fill {
  from { width: var(--brake-from,0%); }
  to   { width: var(--brake-to,0%); }
}
@keyframes timeline-pill-in {
  from { opacity:0; transform:scaleX(0); transform-origin:left; }
  to   { opacity:1; transform:scaleX(1); }
}
@keyframes panel-slide-down {
  from { opacity:0; transform:translateY(-8px); }
  to   { opacity:1; transform:translateY(0); }
}
@keyframes shockwave {
  0%   { transform:scale(0);   opacity:0.8; }
  100% { transform:scale(2.5); opacity:0; }
}
@keyframes loco-pulse {
  0%,100% { opacity:1;   transform:scale(1);   }
  50%      { opacity:0.6; transform:scale(1.4); }
}
@keyframes danger-flash {
  0%,100% { opacity:0.3; }
  50%      { opacity:0.9; }
}
.loco-sos-pulse { animation: loco-pulse 0.7s ease-in-out infinite; }
.danger-zone    { animation: danger-flash 1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .loco-sos-pulse, .danger-zone { animation: none; }
}

// .scan-line {
//   position: fixed; top:0; left:0; right:0; height:2px;
//   background: linear-gradient(90deg, transparent, var(--scan-color), transparent);
//   animation: scan-line 10s linear infinite;
//   pointer-events: none; z-index: 9999;
// }

.fade-up { animation: fade-up 0.3s ease forwards; }
.row-in  { animation: row-in  0.2s ease forwards; }

/* ── Theme Toggle Button ── */
.theme-toggle {
  position: relative;
  width: 52px; height: 26px;
  border-radius: 13px;
  border: 1.5px solid var(--border-bright);
  background: var(--toggle-track);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.3s ease, border-color 0.3s ease;
  overflow: visible;
}
.theme-toggle:hover { border-color: var(--amber); box-shadow: 0 0 8px var(--amber-glow); }
.theme-toggle-thumb {
  position: absolute;
  top: 3px; left: 3px;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: var(--toggle-thumb);
  transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), background 0.3s ease;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; box-shadow: 0 1px 4px var(--shadow);
}
.theme-toggle.light-mode .theme-toggle-thumb {
  transform: translateX(26px);
}
.theme-toggle-icon {
  position: absolute; top: 50%; right: 5px;
  transform: translateY(-50%);
  font-size: 9px; pointer-events: none; line-height: 1;
  opacity: 0.7;
}
.theme-toggle.light-mode .theme-toggle-icon { right: auto; left: 5px; }

button { cursor: pointer; font-family: var(--font-body); }
button:disabled { cursor: not-allowed; }
/* ── Search highlight ── */
.field-match { background: rgba(245,158,11,0.18) !important; }
.light .field-match { background: rgba(180,83,9,0.12) !important; }

/* ── CRC badge ── */
@keyframes badge-pop { 0%{transform:scale(0.7);opacity:0} 70%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
.badge-pop { animation: badge-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards; }

/* ══ KAVACH RAILWAY ANIMATIONS ══════════════════════════════════════════ */
@keyframes signal-green {
  0%   { box-shadow: 0 0 4px #10b981, 0 0 12px #10b98133; }
  50%  { box-shadow: 0 0 8px #10b981, 0 0 24px #10b98166; }
  100% { box-shadow: 0 0 4px #10b981, 0 0 12px #10b98133; }
}
@keyframes signal-red {
  0%   { box-shadow: 0 0 4px #ef4444, 0 0 12px #ef444433; }
  50%  { box-shadow: 0 0 10px #ef4444, 0 0 28px #ef444466; }
  100% { box-shadow: 0 0 4px #ef4444, 0 0 12px #ef444433; }
}
@keyframes track-pulse {
  0%,100% { opacity: 0.4; }
  50%      { opacity: 1; }
}
@keyframes train-slide-in {
  from { opacity:0; transform: translateX(-20px); }
  to   { opacity:1; transform: translateX(0); }
}
@keyframes rail-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position: 200% center; }
}
@keyframes decode-flash {
  0%   { background: rgba(245,158,11,0.25); }
  100% { background: transparent; }
}
@keyframes crc-pass-burst {
  0%   { box-shadow: 0 0 0 0 rgba(16,185,129,0.7); }
  70%  { box-shadow: 0 0 0 8px rgba(16,185,129,0); }
  100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
}
@keyframes crc-fail-burst {
  0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
  70%  { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
  100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
}
@keyframes file-node-in {
  from { opacity:0; transform: translateX(-10px); }
  to   { opacity:1; transform: translateX(0); }
}
@keyframes pkt-row-in {
  from { opacity:0; transform: translateX(-6px); }
  to   { opacity:1; transform: translateX(0); }
}
@keyframes chevron-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(90deg); }
}
@keyframes signal-lamp-blink {
  0%,49% { opacity:1; }
  50%,100%{ opacity:0.15; }
}
@keyframes track-flow {
  0%   { stroke-dashoffset: 20; }
  100% { stroke-dashoffset: 0; }
}
@keyframes header-glow {
  0%,100% { text-shadow: 0 0 8px rgba(245,158,11,0.3); }
  50%      { text-shadow: 0 0 16px rgba(245,158,11,0.7), 0 0 32px rgba(245,158,11,0.2); }
}
.crc-pass-anim { animation: crc-pass-burst 0.6s ease-out; }
.crc-fail-anim { animation: crc-fail-burst 0.6s ease-out; }
.train-slide-in { animation: train-slide-in 0.25s ease-out forwards; }
.file-node-in   { animation: file-node-in 0.3s cubic-bezier(0.34,1.4,0.64,1) forwards; }
.pkt-row-in     { animation: pkt-row-in 0.2s ease-out forwards; }
.decode-flash   { animation: decode-flash 0.8s ease-out forwards; }
.kavach-header-glow { animation: header-glow 3s ease-in-out infinite; }

/* ── Railway track decorative line ── */
.rail-track {
  height: 2px;
  background: repeating-linear-gradient(90deg, var(--amber) 0px, var(--amber) 8px, transparent 8px, transparent 14px);
  opacity: 0.25;
  flex-shrink: 0;
}
.rail-track-live {
  background: repeating-linear-gradient(90deg, var(--amber) 0px, var(--amber) 8px, transparent 8px, transparent 14px);
  background-size: 200%;
  animation: rail-shimmer 2s linear infinite;
  opacity: 0.4;
}

/* ── Signal lamp dots ── */
.sig-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  transition: background 0.3s, box-shadow 0.3s;
}
.sig-dot.pass { background:#10b981; animation: signal-green 2s ease-in-out infinite; }
.sig-dot.fail { background:#ef4444; animation: signal-red  1.2s ease-in-out infinite; }
.sig-dot.unkn { background:#4a4a6a; }

/* ── CRC pill badge ── */
.crc-pill {
  display:inline-flex; align-items:center; gap:3px;
  font-size:7px; font-weight:700; padding:2px 5px; border-radius:10px;
  font-family: var(--font-mono); flex-shrink:0; transition: all 0.2s;
}
.crc-pill.pass { background:#10b98120; color:#10b981; border:1px solid #10b98140; }
.crc-pill.fail { background:#ef444420; color:#ef4444; border:1px solid #ef444440; }
.crc-pill.unkn { background:#ffffff10; color:#50506a; border:1px solid #ffffff15; }

/* ── Log file node header ── */
.log-file-node {
  display:flex; align-items:center; gap:5px;
  padding:5px 8px;
  background: linear-gradient(90deg, rgba(245,158,11,0.06), transparent);
  border-bottom: 1px solid var(--border);
  border-left: 3px solid var(--amber);
  position: sticky; top:0; z-index:3;
  transition: background 0.2s;
}
.log-file-node:hover { background: linear-gradient(90deg, rgba(245,158,11,0.1), transparent); }
.log-file-node.has-fail { border-left-color: var(--red); background: linear-gradient(90deg, rgba(239,68,68,0.06), transparent); }
.log-file-node.has-fail:hover { background: linear-gradient(90deg, rgba(239,68,68,0.1), transparent); }

/* ── Pkt row ── */
.log-pkt-row {
  display:flex; align-items:flex-start; gap:4px;
  padding:4px 8px 4px 20px;
  border-bottom:1px solid var(--border);
  border-left:3px solid transparent;
  cursor:pointer; transition:background 0.1s, border-left-color 0.15s;
  min-width:0; width:100%; box-sizing:border-box; overflow:hidden; flex-wrap:wrap;
}
.log-pkt-row:hover { background: var(--bg-hover); }
.log-pkt-row.selected { background: var(--sidebar-active); border-left-color: var(--cyan); }
.log-pkt-row.crc-fail-row { border-left-color: rgba(239,68,68,0.5); background: rgba(239,68,68,0.04); }
.log-pkt-row.crc-fail-row:hover { background: rgba(239,68,68,0.08); }
.log-pkt-row.selected.crc-fail-row { border-left-color: var(--red); }
.log-pkt-row.just-decoded { animation: decode-flash 0.8s ease-out; }

/* ── Diff highlight ── */
.diff-changed { background: rgba(251,191,36,0.12) !important; border-left: 3px solid #f59e0b !important; }
.diff-changed.light { background: rgba(180,83,9,0.08) !important; }

/* ── Stats panel ── */
@keyframes count-up { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
.stat-val { animation: count-up 0.4s ease forwards; }

/* ── Tooltip spec box ── */
.spec-tooltip {
  position: absolute; z-index: 200;
  bottom: calc(100% + 8px); left: 0;
  min-width: 240px; max-width: 320px;
  background: #111118; border: 1px solid #f59e0b55;
  border-radius: 7px; padding: 10px 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  font-family: var(--font-mono); font-size: 10px;
  color: #c0c0d8; line-height: 1.6;
  animation: fade-up 0.15s ease forwards;
  pointer-events: none;
}
:root.light .spec-tooltip {
  background: #fff; border-color: #b4530944;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  color: #3a3a5a;
}

/* ── TDMA timeline ── */
.tdma-slot {
  width: 14px; height: 22px; border-radius: 3px;
  border: 1px solid var(--border);
  background: var(--bg-raised);
  cursor: default; transition: transform 0.1s ease;
  display: flex; align-items: center; justify-content: center;
  font-size: 7px; color: var(--text-dim);
}
.tdma-slot:hover { transform: scaleY(1.3); z-index: 5; }
.tdma-slot.active { border-color: var(--amber); }

/* ── Tab pills ── */
.tab-pill {
  padding: 4px 12px; border-radius: 5px; font-size: 11px; border: none;
  cursor: pointer; font-family: var(--font-mono); font-weight: 600;
  transition: all 0.15s ease; letter-spacing: 0.04em;
}
.tab-pill.active {
  background: var(--amber); color: #000;
  box-shadow: 0 0 10px var(--amber-glow);
}
.tab-pill:not(.active) {
  background: var(--bg-raised); color: var(--text-muted);
  border: 1px solid var(--border);
}
.tab-pill:not(.active):hover { border-color: var(--amber); color: var(--amber); background: rgba(245,166,35,0.05); }
/* Copy button hover */
tr:hover .copy-btn { opacity: 1 !important; }

/* Tooltip */
.has-tip { position: relative; }
.has-tip:hover::after {
  content: attr(data-tip);
  position: absolute; bottom: calc(100% + 6px); left: 50%;
  transform: translateX(-50%);
  padding: 3px 8px; border-radius: 4px;
  background: #111; color: #eee; font-size: 10px;
  white-space: nowrap; pointer-events: none;
  font-family: var(--font-mono); z-index: 100;
  border: 1px solid #333;
}

/* ══ KAVACH RAILWAY — FULL UI SUITE ═══════════════════════════════════ */

/* ── Scan line: amber beam ── */
.scan-line {
  background: linear-gradient(90deg, transparent 0%, rgba(245,166,35,0.04) 10%, rgba(245,166,35,0.7) 40%, #ffd066 50%, rgba(245,166,35,0.7) 60%, rgba(245,166,35,0.04) 90%, transparent 100%) !important;
  box-shadow: 0 0 12px rgba(245,166,35,0.6), 0 0 30px rgba(245,166,35,0.2), 0 0 60px rgba(245,166,35,0.06);
  height:1.5px !important;
  animation: scan-line 9s cubic-bezier(0.4,0,0.6,1) infinite !important;
}

/* ── Scrollbar: gold ── */
::-webkit-scrollbar-track { background: #040406 !important; }
::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, var(--amber-dim), var(--amber)) !important;
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover { background: var(--amber) !important; box-shadow: 0 0 6px var(--amber); }

/* ── Topbar ── */
.kv-topbar {
  background: linear-gradient(180deg, rgba(2,2,4,0.88) 0%, rgba(5,5,9,0.85) 40%, rgba(8,8,15,0.82) 100%) !important;
  border-bottom: 1px solid #12121e !important;
  position: relative; overflow: hidden;
  box-shadow: 0 2px 30px rgba(0,0,0,0.8), 0 1px 0 rgba(245,166,35,0.06);
}
.kv-topbar::before {
  content:''; position:absolute; top:0; left:0; right:0; height:1px;
  background: linear-gradient(90deg, transparent 0%, rgba(245,166,35,0.08) 20%, rgba(245,166,35,0.35) 50%, rgba(245,166,35,0.08) 80%, transparent 100%);
}
.kv-topbar::after {
  content:''; position:absolute; bottom:0; left:0; right:0; height:1px;
  background: repeating-linear-gradient(90deg, var(--amber) 0, var(--amber) 3px, transparent 3px, transparent 9px);
  opacity: 0.22;
  animation: kv-rail-scroll 3s linear infinite;
}
@keyframes kv-rail-scroll {
  0%   { background-position: 0 0; }
  100% { background-position: 48px 0; }
}

/* ── Logo box ── */
.kv-logo-box {
  background: linear-gradient(135deg, rgba(245,166,35,0.09), rgba(245,166,35,0.03), rgba(0,229,255,0.03));
  border: 1px solid rgba(245,166,35,0.22);
  border-radius: 8px; padding: 1px 11px 1px 7px;
  /* 48px tall: fits inside the 52px top bar (it used to be 54px and got
     clipped), and matches the NOVA brand card beside it exactly. */
  height: 48px; box-sizing: border-box;
  display:flex; align-items:center; gap:4px;
  transition: box-shadow 0.35s, border-color 0.35s;
  position:relative; overflow:hidden;
}
/* ── NOVA company brand card — same size/shape as .kv-logo-box, tinted in
   the NOVA logo's blue instead of KAVACH amber. ── */
.kv-nova-box {
  background: linear-gradient(135deg, rgba(56,189,248,0.09), rgba(56,189,248,0.03), rgba(124,58,237,0.03));
  border: 1px solid rgba(56,189,248,0.22);
  border-radius: 8px; padding: 1px 12px 1px 7px;
  height: 48px; box-sizing: border-box; flex-shrink: 0;
  display:flex; align-items:center; gap:8px;
  transition: box-shadow 0.35s, border-color 0.35s;
  position:relative; overflow:hidden;
}
.kv-nova-box::before {
  content:''; position:absolute; inset:0; border-radius:8px;
  background: radial-gradient(ellipse at 25% 50%, rgba(56,189,248,0.08), transparent 70%);
  pointer-events:none;
}
.kv-nova-box:hover {
  box-shadow: 0 0 22px rgba(56,189,248,0.2), 0 0 6px rgba(56,189,248,0.08);
  border-color: rgba(56,189,248,0.4);
}
/* ── NOVA company logo — plain mark + wordmark, no card, full header height ──
   Effects (all subtle, and switched off for reduced-motion users):
   • the cube "breathes" — a slow glow pulsing between the logo's cyan and
     purple, with a soft halo behind it
   • a light sheen sweeps across the NOVA letters every few seconds
   • hover: cube lifts slightly and glows brighter, letters brighten */
.kv-nova-logo {
  display:flex; align-items:center; gap:11px; flex-shrink:0; height:52px;
  padding: 0 6px 0 0; cursor: default; position:relative;
}
.kv-nova-logo-markwrap { position:relative; width:50px; height:50px; flex-shrink:0; }
.kv-nova-logo-markwrap::before {
  content:''; position:absolute; inset:7px; border-radius:50%; pointer-events:none;
  background: radial-gradient(circle, rgba(56,189,248,0.28), rgba(168,85,247,0.12) 55%, transparent 72%);
  animation: kv-nova-halo 4.2s ease-in-out infinite;
}
.kv-nova-logo-mark {
  position:relative; height:50px; width:50px; object-fit:contain; display:block;
  animation: kv-nova-breathe 4.2s ease-in-out infinite;
  transition: transform 0.35s cubic-bezier(0.22,1,0.36,1);
}
@keyframes kv-nova-breathe {
  0%, 100% { filter: drop-shadow(0 0 5px rgba(56,189,248,0.40)) drop-shadow(0 0 1px rgba(56,189,248,0.6)); }
  50%      { filter: drop-shadow(0 0 11px rgba(168,85,247,0.55)) drop-shadow(0 0 3px rgba(56,189,248,0.7)); }
}
@keyframes kv-nova-halo {
  0%, 100% { opacity: 0.45; transform: scale(0.92); }
  50%      { opacity: 0.95; transform: scale(1.08); }
}
.kv-nova-logo-wordwrap { position:relative; display:block; height:30px; }
.kv-nova-logo-word {
  height:30px; width:auto; object-fit:contain; display:block;
  filter: drop-shadow(0 0 4px rgba(226,232,240,0.18));
  transition: filter 0.35s;
}
/* Sheen: a bright band moving across, masked to the shape of the letters. */
.kv-nova-logo-shine {
  position:absolute; inset:0; pointer-events:none;
  -webkit-mask: url(/nova-text-dark.png) center / 100% 100% no-repeat;
          mask: url(/nova-text-dark.png) center / 100% 100% no-repeat;
  background: linear-gradient(105deg, transparent 0%, transparent 40%, rgba(125,211,252,0.95) 48%, #ffffff 50%, rgba(192,132,252,0.9) 53%, transparent 61%, transparent 100%);
  background-size: 300% 100%; background-repeat: no-repeat;
  animation: kv-nova-shine 5.5s ease-in-out infinite;
}
@keyframes kv-nova-shine {
  0%, 55%  { background-position: 120% 0; }
  85%,100% { background-position: -20% 0; }
}
.kv-nova-logo:hover .kv-nova-logo-mark { transform: translateY(-1px) scale(1.05); }
.kv-nova-logo:hover .kv-nova-logo-word { filter: drop-shadow(0 0 7px rgba(125,211,252,0.45)); }
@media (prefers-reduced-motion: reduce) {
  .kv-nova-logo-mark, .kv-nova-logo-markwrap::before, .kv-nova-logo-shine { animation: none; }
  .kv-nova-logo-shine { display: none; }
}
/* Thin vertical divider between the company logo and the app title card. */
.kv-nova-divider {
  width:1px; height:34px; flex-shrink:0; margin: 0 4px;
  background: linear-gradient(180deg, transparent, rgba(56,189,248,0.45) 30%, rgba(168,85,247,0.35) 70%, transparent);
}
/* ── Header brand typography, taken from the NOVA logo itself ──
   Title: light geometric caps in near-white (like the NOVA wordmark).
   Subtitle: small, widely-spaced caps in the logo's blue → cyan gradient
   (like "ENGINEERING SAFETY · POWERING INNOVATION"). Used by BOTH header
   cards so NOVA and PINJ read as one family. */
.kv-hdr-title {
  font-family: 'Exo 2', var(--font-body); font-size: 14px; font-weight: 500;
  letter-spacing: 0.16em; line-height: 16px; height: 16px; white-space: nowrap;
  background: linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 55%, #a5d8f3 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  filter: drop-shadow(0 0 6px rgba(56,189,248,0.18));
}
/* "PINJ" — the product name, a step bigger and bolder than the rest of the
   title; sits on the same baseline so the line height doesn't change. */
.kv-hdr-title .kv-hdr-accent {
  -webkit-text-fill-color: #38bdf8; font-size: 19px; font-weight: 700;
  letter-spacing: 0.12em; vertical-align: baseline;
  filter: drop-shadow(0 0 5px rgba(56,189,248,0.35));
}
.kv-hdr-sub {
  font-family: 'Exo 2', var(--font-body); font-size: 8px; font-weight: 600;
  letter-spacing: 0.22em; line-height: 8px; margin-top: 3px; white-space: nowrap;
  background: linear-gradient(90deg, #3b82f6 0%, #38bdf8 50%, #22d3ee 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
/* The PINJ train icon, tinted one even NOVA blue (a plain hue-rotate turned
   its cyan windows red, so it is desaturated first, then colourised). */
.kv-hdr-train { filter: grayscale(1) sepia(1) hue-rotate(160deg) saturate(3.2) brightness(1.15); display:flex; align-items:center; }
.kv-logo-box::before {
  content:''; position:absolute; inset:0; border-radius:8px;
  background: radial-gradient(ellipse at 30% 50%, rgba(245,166,35,0.07), transparent 70%);
  pointer-events:none;
}
.kv-logo-box:hover {
  box-shadow: 0 0 22px rgba(245,166,35,0.22), 0 0 6px rgba(245,166,35,0.08);
  border-color: rgba(245,166,35,0.4);
}

/* ── Train icon throb ── */
@keyframes kv-icon-throb {
  0%,100% { filter: drop-shadow(0 0 3px rgba(245,166,35,0.5)) drop-shadow(0 0 1px rgba(0,229,255,0.2)); }
  50%      { filter: drop-shadow(0 0 8px rgba(245,166,35,0.95)) drop-shadow(0 0 3px rgba(0,229,255,0.35)); }
}
.kv-train-icon { animation: kv-icon-throb 2.8s ease-in-out infinite; display:block; }

/* ── Headlamp flicker ── */
@keyframes kv-headlamp-flicker {
  0%,92%,100% { opacity:1; }
  94%          { opacity:0.4; }
  96%          { opacity:1; }
  98%          { opacity:0.6; }
}
.kv-headlamp      { animation: kv-headlamp-flicker 5s ease-in-out infinite; }
.kv-headlamp-ring { animation: kv-headlamp-flicker 5s ease-in-out infinite 0.1s; }

/* ══ SMOKE ANIMATIONS — realistic steam from chimney ══ */

/* Primary smoke puffs — rise + drift right + fade */
@keyframes smoke-rise-p1 {
  0%   { transform:translate(0,0)   scale(1);   opacity:0.55; }
  30%  { transform:translate(-2px,-8px) scale(1.3); opacity:0.42; }
  60%  { transform:translate(-5px,-16px) scale(1.7); opacity:0.24; }
  100% { transform:translate(-9px,-26px) scale(2.4); opacity:0; }
}
@keyframes smoke-rise-p2 {
  0%   { transform:translate(0,0)   scale(0.9); opacity:0; }
  10%  { opacity:0.42; }
  40%  { transform:translate(-3px,-10px) scale(1.4); opacity:0.35; }
  75%  { transform:translate(-7px,-20px) scale(1.9); opacity:0.18; }
  100% { transform:translate(-11px,-30px) scale(2.6); opacity:0; }
}
@keyframes smoke-rise-p3 {
  0%   { transform:translate(0,0)   scale(0.8); opacity:0; }
  15%  { opacity:0.30; }
  50%  { transform:translate(-4px,-12px) scale(1.5); opacity:0.22; }
  80%  { transform:translate(-8px,-22px) scale(2.0); opacity:0.10; }
  100% { transform:translate(-12px,-34px) scale(2.8); opacity:0; }
}
@keyframes smoke-rise-p4 {
  0%   { transform:translate(0,0)   scale(0.7); opacity:0; }
  20%  { opacity:0.20; }
  60%  { transform:translate(-5px,-15px) scale(1.6); opacity:0.13; }
  100% { transform:translate(-14px,-38px) scale(3.0); opacity:0; }
}
@keyframes smoke-rise-p5 {
  0%   { transform:translate(0,0) scale(0.6); opacity:0; }
  25%  { opacity:0.12; }
  100% { transform:translate(-16px,-44px) scale(3.4); opacity:0; }
}
@keyframes smoke-rise-s1 {
  0%   { transform:translate(0,0) scale(0.85); opacity:0; }
  8%   { opacity:0.38; }
  45%  { transform:translate(-2px,-9px) scale(1.35); opacity:0.28; }
  80%  { transform:translate(-6px,-18px) scale(1.8); opacity:0.12; }
  100% { transform:translate(-10px,-28px) scale(2.3); opacity:0; }
}
@keyframes smoke-rise-s2 {
  0%   { transform:translate(0,0) scale(0.75); opacity:0; }
  18%  { opacity:0.25; }
  55%  { transform:translate(-3px,-12px) scale(1.5); opacity:0.16; }
  100% { transform:translate(-12px,-32px) scale(2.5); opacity:0; }
}
@keyframes smoke-rise-s3 {
  0%   { transform:translate(0,0) scale(0.65); opacity:0; }
  22%  { opacity:0.16; }
  100% { transform:translate(-13px,-36px) scale(2.7); opacity:0; }
}

.smoke-p1 { animation: smoke-rise-p1 2.2s ease-out infinite 0.0s; transform-origin: center bottom; }
.smoke-p2 { animation: smoke-rise-p2 2.5s ease-out infinite 0.3s; transform-origin: center bottom; }
.smoke-p3 { animation: smoke-rise-p3 2.8s ease-out infinite 0.6s; transform-origin: center bottom; }
.smoke-p4 { animation: smoke-rise-p4 3.1s ease-out infinite 0.9s; transform-origin: center bottom; }
.smoke-p5 { animation: smoke-rise-p5 3.4s ease-out infinite 1.2s; transform-origin: center bottom; }
.smoke-s1 { animation: smoke-rise-s1 2.4s ease-out infinite 0.15s; transform-origin: center bottom; }
.smoke-s2 { animation: smoke-rise-s2 2.7s ease-out infinite 0.45s; transform-origin: center bottom; }
.smoke-s3 { animation: smoke-rise-s3 3.0s ease-out infinite 0.75s; transform-origin: center bottom; }

.kv-train-smoke-wrap { display:inline-flex; align-items:center; }

/* ── Brand title shimmer ── */
@keyframes kv-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}
.kv-brand-title {
  font-size:16px; font-weight:800; letter-spacing:0.14em;
  background: linear-gradient(90deg, #c8770a 0%, #f5a623 25%, #ffd066 50%, #f5a623 75%, #c8770a 100%);
  background-size: 280% auto;
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: kv-shimmer 3.5s linear infinite;
  text-shadow: none;
  filter: drop-shadow(0 0 8px rgba(245,166,35,0.25));
}

/* ── PKT type pills ── */
.kv-pkt-pill {
  padding:2px 9px; border-radius:20px; font-size:9px;
  font-family:var(--font-mono); font-weight:800; letter-spacing:0.05em;
  transition: all 0.18s; position:relative; overflow:hidden;
  cursor:default;
}
.kv-pkt-pill:hover { transform:translateY(-1px); filter:brightness(1.2); box-shadow:0 3px 10px rgba(0,0,0,0.4); }

/* ── Status pill slide-in ── */
@keyframes kv-status-in {
  from { opacity:0; transform:translateX(10px); }
  to   { opacity:1; transform:translateX(0); }
}
.kv-status { animation: kv-status-in 0.25s ease forwards; }

/* ── Backend dot checking pulse ── */
@keyframes kv-checking { 0%,100%{opacity:1;} 50%{opacity:0.2;} }
.kv-dot-checking { animation: kv-checking 1.1s infinite; }

/* ── Shared button base ── */
.kv-btn {
  padding:5px 14px; border-radius:6px; border:1px solid transparent;
  font-weight:800; font-size:11px; font-family:var(--font-mono);
  letter-spacing:0.08em; cursor:pointer; transition:all 0.2s;
  position:relative; overflow:hidden; display:inline-flex; align-items:center; gap:5px;
}
.kv-btn::after {
  content:''; position:absolute; inset:0;
  background:linear-gradient(180deg,rgba(255,255,255,0.07) 0%,transparent 100%);
  pointer-events:none;
}

/* ── Button variants ── */
.kv-btn-live {
  background: linear-gradient(135deg,#7f1d1d,#b91c1c);
  color:#fff; border-color:transparent;
  box-shadow:0 0 10px rgba(220,38,38,0.2);
}
.kv-btn-live:hover, .kv-btn-live.active {
  background: linear-gradient(135deg,#dc2626,#ef4444);
  box-shadow:0 0 18px rgba(239,68,68,0.5);
}
.kv-btn-sim {
  background:transparent; color:#4a8060;
  border-color:rgba(74,222,128,0.25);
}
.kv-btn-sim:hover, .kv-btn-sim.active {
  background:rgba(74,222,128,0.08); color:#4ade80;
  border-color:rgba(74,222,128,0.5);
  box-shadow:0 0 12px rgba(74,222,128,0.2);
}
.kv-btn-sim.active { background:rgba(74,222,128,0.12); }
.kv-btn-decode {
  background: linear-gradient(135deg,#f5a623,#f97316);
  color:#000; border-color:transparent;
  font-size:12px; padding:5px 22px;
  box-shadow:0 0 14px rgba(245,166,35,0.35), 0 2px 8px rgba(0,0,0,0.4);
}
.kv-btn-decode:hover:not(:disabled) {
  box-shadow:0 0 24px rgba(245,166,35,0.6), 0 4px 14px rgba(0,0,0,0.4);
  transform:translateY(-1px);
}
.kv-btn-decode:disabled {
  background:var(--bg-raised); color:var(--text-dim);
  box-shadow:none; cursor:not-allowed;
}
.kv-btn-ghost {
  background:transparent; color:var(--text-secondary);
  border-color:var(--border);
}
.kv-btn-ghost:hover {
  border-color:var(--amber); color:var(--amber);
  background:rgba(245,166,35,0.05);
}
.kv-btn-xlsx {
  background:transparent; color:#22c55e;
  border-color:rgba(34,197,94,0.3);
}
.kv-btn-xlsx:hover {
  background:rgba(34,197,94,0.07); border-color:#22c55e;
  box-shadow:0 0 10px rgba(34,197,94,0.2);
}

/* ── Tab bar ── */
.kv-tabbar {
  background: linear-gradient(180deg,#0a0a12 0%,#080810 100%);
  border-bottom: 1px solid var(--border);
  position:relative; padding:0 12px;
}
.kv-tabbar::after {
  content:''; position:absolute; bottom:0; left:0; right:0; height:1px;
  background:linear-gradient(90deg,transparent,rgba(245,166,35,0.15),transparent);
}
.kv-tab {
  padding:7px 16px; border:none; background:transparent; cursor:pointer;
  font-family:var(--font-mono); font-size:11px; font-weight:600;
  letter-spacing:0.05em; color:var(--text-muted);
  border-bottom:2px solid transparent;
  transition:all 0.18s; display:inline-flex; align-items:center; gap:5px;
  margin-bottom:-1px;
}
.kv-tab:hover { color:var(--text-secondary); background:rgba(255,255,255,0.02); }
.kv-tab.active {
  color:var(--amber); border-bottom-color:var(--amber);
  background:linear-gradient(180deg,rgba(245,166,35,0.06),transparent);
  text-shadow:0 0 12px rgba(245,166,35,0.4);
}

/* ── Loco panel ── */
.kv-loco-panel {
  background: linear-gradient(180deg,#080810 0%,#060608 100%);
  border-right:1px solid var(--border);
}
.kv-loco-header {
  padding:8px 12px 7px;
  background:linear-gradient(90deg,rgba(245,166,35,0.07),transparent);
  border-bottom:1px solid var(--border);
  position:relative; overflow:hidden;
}
.kv-loco-header::after {
  content:''; position:absolute; bottom:0; left:0; width:0; right:0; height:1px;
  background:var(--amber);
  animation: kv-underline-sweep 3s ease-in-out infinite alternate;
}
@keyframes kv-underline-sweep {
  0%   { left:100%; right:0;   }
  100% { left:0;    right:100%;}
}

/* ── Summary card fields ── */
@keyframes kv-field-in {
  from { opacity:0; transform:scale(0.95) translateY(4px); }
  to   { opacity:1; transform:scale(1)    translateY(0); }
}
.kv-field-tile {
  border-radius:6px; padding:6px 10px;
  animation: kv-field-in 0.25s cubic-bezier(0.34,1.2,0.64,1) both;
  transition: box-shadow 0.2s, transform 0.18s;
  cursor:default;
}
.kv-field-tile:hover { transform:translateY(-1px); box-shadow:0 4px 14px rgba(0,0,0,0.4); }

/* ── CRC badges ── */
@keyframes kv-badge-pop {
  from { opacity:0; transform:scale(0.7); }
  to   { opacity:1; transform:scale(1); }
}
.kv-crc-pass {
  animation: kv-badge-pop 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards;
  display:inline-flex; align-items:center; gap:4px;
  background:linear-gradient(135deg,rgba(0,230,118,0.18),rgba(0,230,118,0.08));
  border:1px solid rgba(0,230,118,0.4); color:#00e676;
  padding:3px 11px; border-radius:20px; font-size:10px;
  font-family:var(--font-mono); font-weight:800;
  box-shadow:0 0 10px rgba(0,230,118,0.2),inset 0 1px 0 rgba(255,255,255,0.08);
}
.kv-crc-fail {
  animation: kv-badge-pop 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards;
  display:inline-flex; align-items:center; gap:4px;
  background:linear-gradient(135deg,rgba(255,23,68,0.18),rgba(255,23,68,0.08));
  border:1px solid rgba(255,23,68,0.4); color:#ff1744;
  padding:3px 11px; border-radius:20px; font-size:10px;
  font-family:var(--font-mono); font-weight:800;
  box-shadow:0 0 10px rgba(255,23,68,0.2),inset 0 1px 0 rgba(255,255,255,0.08);
}
.kv-crc-err {
  display:inline-flex; align-items:center; gap:4px;
  background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
  color:var(--text-muted); padding:3px 11px; border-radius:20px;
  font-size:10px; font-family:var(--font-mono); font-weight:700;
}

/* ── HexDisplay bytes ── */
.kv-hex-byte {
  padding:2px 6px; border-radius:4px;
  background:linear-gradient(135deg,#1a1a28,#131320);
  border:1px solid #252540;
  color:var(--text-code); font-family:var(--font-mono); font-size:11px;
  letter-spacing:0.05em; font-weight:600;
  transition:all 0.15s; cursor:default; position:relative;
}
.kv-hex-byte:hover {
  background:linear-gradient(135deg,#252535,#1c1c2c);
  border-color:var(--amber); color:var(--amber);
  box-shadow:0 0 8px rgba(245,166,35,0.3); transform:translateY(-1px);
}

/* ── Footer status bar ── */
.kv-footer {
  background:linear-gradient(90deg,#050508,#070710);
  border-top:1px solid var(--border);
  padding:4px 16px; display:flex; align-items:center; gap:14px;
  font-size:9px; font-family:var(--font-mono); color:var(--text-dim);
  flex-shrink:0;
}
.kv-footer-sep { color:var(--border-bright); }

/* ── Input panel top border glow ── */
.kv-input-top {
  position:relative;
}
.kv-input-top::before {
  content:''; position:absolute; top:0; left:0; right:0; height:2px;
  background:linear-gradient(90deg,transparent,var(--amber),#f97316,var(--amber),transparent);
  animation: kv-shimmer 3s linear infinite;
  background-size:300% auto; z-index:1;
}

/* ── Empty state ── */
@keyframes kv-float {
  0%,100% { transform:translateY(0);   }
  50%      { transform:translateY(-8px);}
}
.kv-empty-icon { animation: kv-float 3s ease-in-out infinite; }
@keyframes kv-track-scroll {
  0%   { stroke-dashoffset: 200;  opacity:0.12; }
  50%  { stroke-dashoffset: 0;    opacity:0.35; }
  100% { stroke-dashoffset: -200; opacity:0.12; }
}
.kv-track-anim { animation: kv-track-scroll 4s linear infinite; }

/* ── Diff empty ── */
.kv-diff-empty { animation: kv-float 3s ease-in-out infinite; display:inline-block; }

/* ── Section header rows in field table ── */
.kv-section-row { background:linear-gradient(90deg,rgba(245,166,35,0.06),transparent) !important; }

/* ══ CINEMATIC UPGRADES — widget-level ══════════════════════════ */

/* ── CRC pass / fail — more cinematic burst ── */
.kv-crc-pass {
  animation: kv-badge-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards, kv-crc-glow-pass 2s ease-in-out infinite 0.5s !important;
  box-shadow: 0 0 12px rgba(0,230,118,0.3), inset 0 1px 0 rgba(255,255,255,0.1) !important;
}
.kv-crc-fail {
  animation: kv-badge-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards, kv-crc-glow-fail 1.4s ease-in-out infinite 0.5s !important;
  box-shadow: 0 0 12px rgba(255,23,68,0.35), inset 0 1px 0 rgba(255,255,255,0.07) !important;
}
@keyframes kv-crc-glow-pass {
  0%,100% { box-shadow: 0 0 8px rgba(0,230,118,0.25); }
  50%      { box-shadow: 0 0 18px rgba(0,230,118,0.55), 0 0 4px rgba(0,230,118,0.3); }
}
@keyframes kv-crc-glow-fail {
  0%,100% { box-shadow: 0 0 8px rgba(255,23,68,0.3); }
  50%      { box-shadow: 0 0 22px rgba(255,23,68,0.65), 0 0 5px rgba(255,23,68,0.4); }
}

/* ── Hex bytes — cinematic hover ── */
.kv-hex-byte {
  background: linear-gradient(135deg,#12121f,#0e0e1c) !important;
  border: 1px solid #1e1e35 !important;
  transition: all 0.12s ease !important;
}
.kv-hex-byte:hover {
  background: linear-gradient(135deg,#1e1e32,#161628) !important;
  border-color: var(--amber) !important; color: var(--amber) !important;
  box-shadow: 0 0 10px rgba(245,166,35,0.35), 0 0 20px rgba(245,166,35,0.1) !important;
  transform: translateY(-2px) !important;
}

/* ── PKT pills — cinematic glow ── */
.kv-pkt-pill {
  transition: all 0.2s ease !important;
  backdrop-filter: blur(2px);
}
.kv-pkt-pill:hover {
  transform:translateY(-2px) scale(1.04) !important;
  filter:brightness(1.3) !important;
  box-shadow:0 4px 14px rgba(0,0,0,0.5) !important;
}

/* ── Kv tab active — cinematic underline ── */
.kv-tab.active {
  color: var(--amber) !important;
  border-bottom-color: var(--amber) !important;
  background: linear-gradient(180deg, rgba(245,166,35,0.07), transparent) !important;
  text-shadow: 0 0 14px rgba(245,166,35,0.5), 0 0 30px rgba(245,166,35,0.15) !important;
}
.kv-tab:hover:not(.active) {
  color: var(--text-secondary) !important;
  background: rgba(255,255,255,0.025) !important;
  text-shadow: 0 0 8px rgba(245,166,35,0.2) !important;
}

/* ── Button decode — cinematic pulse ── */
@keyframes kv-decode-pulse {
  0%,100% { box-shadow: 0 0 14px rgba(245,166,35,0.35), 0 2px 8px rgba(0,0,0,0.4); }
  50%      { box-shadow: 0 0 28px rgba(245,166,35,0.6), 0 0 50px rgba(245,166,35,0.15), 0 2px 10px rgba(0,0,0,0.5); }
}
.kv-btn-decode:not(:disabled) {
  animation: kv-decode-pulse 2.5s ease-in-out infinite;
}
.kv-btn-decode:hover:not(:disabled) {
  animation: none;
  box-shadow: 0 0 36px rgba(245,166,35,0.75), 0 0 60px rgba(245,166,35,0.2), 0 4px 16px rgba(0,0,0,0.5) !important;
  transform: translateY(-2px) scale(1.015) !important;
}

/* ── Stat cards — cinematic glow on hover ── */
.kv-stat-card:hover {
  transform: translateY(-3px) !important;
  box-shadow: 0 8px 28px rgba(0,0,0,0.55), 0 0 0 1px rgba(245,166,35,0.08) !important;
}

/* ── Field tile — cinematic ── */
.kv-field-tile:hover {
  transform: translateY(-2px) !important;
  box-shadow: 0 6px 18px rgba(0,0,0,0.5), 0 0 0 1px rgba(245,166,35,0.1) !important;
}

/* ── Rail track — cinematic shimmer ── */
.rail-track-live {
  animation: rail-shimmer 1.6s linear infinite !important;
  opacity: 0.55 !important;
}

/* ── Section headers in loco panel ── */
.kv-loco-header::after {
  height: 1.5px;
  animation: kv-underline-sweep 2.5s ease-in-out infinite alternate;
  background: linear-gradient(90deg, transparent, var(--amber), #ffd066, var(--amber), transparent);
}

/* ── Backend dot — cinematic pulse ── */
@keyframes kv-backend-online {
  0%,100% { box-shadow: 0 0 6px var(--green), 0 0 2px var(--green); }
  50%      { box-shadow: 0 0 14px var(--green), 0 0 30px rgba(0,230,118,0.25); }
}
@keyframes kv-backend-offline {
  0%,100% { box-shadow: 0 0 6px var(--red), 0 0 2px var(--red); }
  50%      { box-shadow: 0 0 14px var(--red), 0 0 30px rgba(255,23,68,0.3); opacity:0.7; }
}

/* ── Empty state animated track — cinematic ── */
.kv-track-anim {
  animation: kv-track-scroll 3s linear infinite !important;
  opacity: 0.2 !important;
}

/* ── Score / decode button loading spin ── */
@keyframes kv-cog-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* ── Sidebar active card glow ── */
@keyframes kv-sidebar-active-glow {
  0%,100% { box-shadow: inset 0 0 0 1px rgba(245,166,35,0.25); }
  50%      { box-shadow: inset 0 0 0 1px rgba(245,166,35,0.5), 0 0 12px rgba(245,166,35,0.1); }
}

/* ── Log pkt row selected rail ── */
.log-pkt-row.selected {
  background: rgba(245,166,35,0.04) !important;
  border-left-color: var(--cyan) !important;
  box-shadow: inset 3px 0 8px rgba(0,229,255,0.06) !important;
}

/* ── SOS pulse — cinematic ── */
.loco-sos-pulse {
  animation: loco-pulse 0.65s ease-in-out infinite !important;
  filter: drop-shadow(0 0 6px rgba(255,23,68,0.8)) !important;
}

/* ══════════════════════════════════════════════════════════════════════════
   ██████╗██╗███╗   ██╗███████╗███╗   ███╗ █████╗ ████████╗██╗ ██████╗
  ██╔════╝██║████╗  ██║██╔════╝████╗ ████║██╔══██╗╚══██╔══╝██║██╔════╝
  ██║     ██║██╔██╗ ██║█████╗  ██╔████╔██║███████║   ██║   ██║██║
  ██║     ██║██║╚██╗██║██╔══╝  ██║╚██╔╝██║██╔══██║   ██║   ██║██║
  ╚██████╗██║██║ ╚████║███████╗██║ ╚═╝ ██║██║  ██║   ██║   ██║╚██████╗
   ╚═════╝╚═╝╚═╝  ╚═══╝╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝
   EXTREME CINEMATIC UI — ALL WIDGETS
══════════════════════════════════════════════════════════════════════════ */

/* ══ KEYFRAMES ══════════════════════════════════════════════════ */
@keyframes cin-float {
  0%,100%{ transform:translateY(0) }  50%{ transform:translateY(-6px) }
}
@keyframes cin-glow-amber {
  0%,100%{ box-shadow:0 0 8px rgba(245,166,35,0.2), 0 0 2px rgba(245,166,35,0.1) }
  50%    { box-shadow:0 0 22px rgba(245,166,35,0.55), 0 0 8px rgba(245,166,35,0.25) }
}
@keyframes cin-glow-cyan {
  0%,100%{ box-shadow:0 0 6px rgba(0,229,255,0.2) }
  50%    { box-shadow:0 0 18px rgba(0,229,255,0.5), 0 0 6px rgba(0,229,255,0.25) }
}
@keyframes cin-glow-green {
  0%,100%{ box-shadow:0 0 6px rgba(0,230,118,0.25) }
  50%    { box-shadow:0 0 20px rgba(0,230,118,0.6), 0 0 5px rgba(0,230,118,0.3) }
}
@keyframes cin-glow-red {
  0%,100%{ box-shadow:0 0 6px rgba(255,23,68,0.3) }
  50%    { box-shadow:0 0 24px rgba(255,23,68,0.7), 0 0 6px rgba(255,23,68,0.4) }
}
@keyframes cin-slide-in-left {
  from{ opacity:0; transform:translateX(-14px) }
  to  { opacity:1; transform:translateX(0) }
}
@keyframes cin-slide-in-up {
  from{ opacity:0; transform:translateY(10px) scale(0.97) }
  to  { opacity:1; transform:translateY(0)   scale(1) }
}
@keyframes cin-border-spin {
  0%  { background-position:0% 50% }
  100%{ background-position:200% 50% }
}
@keyframes cin-row-flash {
  0%  { background:rgba(245,166,35,0.18) }
  100%{ background:transparent }
}
@keyframes cin-shimmer-bg {
  0%  { background-position:-200% center }
  100%{ background-position: 200% center }
}
@keyframes cin-pulse-ring {
  0%  { transform:scale(1);   opacity:0.8 }
  100%{ transform:scale(2.2); opacity:0 }
}
@keyframes cin-counter {
  from{ opacity:0; transform:translateY(4px) }
  to  { opacity:1; transform:none }
}
@keyframes cin-tab-indicator {
  from{ transform:scaleX(0); transform-origin:left }
  to  { transform:scaleX(1) }
}
@keyframes cin-data-flow {
  0%  { stroke-dashoffset:100 }
  100%{ stroke-dashoffset:0   }
}
@keyframes cin-scanbar {
  0%  { top:-2px }
  100%{ top:100% }
}
@keyframes cin-hex-wave {
  0%,100%{ color:var(--text-code) }
  50%    { color:var(--amber); text-shadow:0 0 8px rgba(245,166,35,0.6) }
}
@keyframes cin-section-reveal {
  from{ opacity:0; transform:translateX(-8px) }
  to  { opacity:1; transform:none }
}
@keyframes cin-badge-in {
  0%  { transform:scale(0) rotate(-15deg); opacity:0 }
  60% { transform:scale(1.15) rotate(3deg) }
  100%{ transform:scale(1)    rotate(0);   opacity:1 }
}
@keyframes cin-field-pop {
  0%  { opacity:0; transform:scale(0.88) translateY(8px) }
  70% { transform:scale(1.03) translateY(-1px) }
  100%{ opacity:1; transform:scale(1) translateY(0) }
}
@keyframes cin-danger-strobe {
  0%,49%{ opacity:1 } 50%,100%{ opacity:0.25 }
}

/* ══ TAB BAR ══════════════════════════════════════════════════ */
.kv-tabbar {
  background: linear-gradient(180deg, #060610 0%, #040408 100%) !important;
  border-bottom: 1px solid #12121f !important;
  position: relative !important;
}
.kv-tabbar::before {
  content:''; position:absolute; top:0; left:0; right:0; height:1px;
  background: linear-gradient(90deg,transparent,rgba(245,166,35,0.12),rgba(245,166,35,0.35),rgba(245,166,35,0.12),transparent);
}
.kv-tabbar::after {
  content:''; position:absolute; bottom:0; left:0; right:0; height:1.5px;
  background: linear-gradient(90deg,transparent,rgba(245,166,35,0.08),rgba(245,166,35,0.22),rgba(245,166,35,0.08),transparent) !important;
}

.kv-tab {
  position: relative !important;
  padding: 8px 18px !important;
  font-size: 11px !important;
  letter-spacing: 0.08em !important;
  font-weight: 700 !important;
  color: var(--text-dim) !important;
  transition: all 0.2s ease !important;
  overflow: hidden !important;
}
.kv-tab::before {
  content:''; position:absolute; bottom:0; left:50%; right:50%;
  height:2px; background:var(--amber);
  transition:left 0.25s ease, right 0.25s ease;
}
.kv-tab:hover::before { left:10%; right:10%; }
.kv-tab.active::before { left:0; right:0; box-shadow:0 0 10px var(--amber); }
.kv-tab::after {
  content:''; position:absolute; inset:0;
  background:radial-gradient(ellipse at 50% 120%,rgba(245,166,35,0),transparent 70%);
  transition:opacity 0.25s;
  opacity:0; pointer-events:none;
}
.kv-tab:hover::after { opacity:1; }
.kv-tab.active {
  color: var(--amber) !important;
  background: linear-gradient(180deg,rgba(245,166,35,0.07) 0%,rgba(245,166,35,0.02) 60%,transparent 100%) !important;
  text-shadow: 0 0 14px rgba(245,166,35,0.5), 0 0 30px rgba(245,166,35,0.15) !important;
}
.kv-tab:hover:not(.active) {
  color: rgba(245,166,35,0.7) !important;
  background: rgba(245,166,35,0.03) !important;
}

/* ══ SUMMARY CARD / DECODE PANEL SURFACE ══════════════════════ */
/* The decode panel top area (SummaryCard wrapper) */
.kv-decode-surface {
  background: linear-gradient(180deg,#060610 0%,#08080e 100%) !important;
  border-bottom: 1px solid #12122a !important;
  position: relative;
}
.kv-decode-surface::before {
  content:''; position:absolute; top:0; left:0; right:0; height:1px;
  background:linear-gradient(90deg,transparent,rgba(245,166,35,0.12),rgba(0,229,255,0.08),rgba(245,166,35,0.12),transparent);
}

/* ══ FIELD TILES (Summary card quick-view boxes) ══════════════ */
.kv-field-tile {
  border-radius: 8px !important;
  padding: 8px 12px !important;
  animation: cin-field-pop 0.35s cubic-bezier(0.34,1.2,0.64,1) both !important;
  transition: all 0.2s ease !important;
  cursor: default !important;
  position: relative !important;
  overflow: hidden !important;
}
.kv-field-tile::before {
  content:''; position:absolute; inset:0; border-radius:8px;
  background:linear-gradient(135deg,rgba(255,255,255,0.04) 0%,transparent 60%);
  pointer-events:none;
}
.kv-field-tile::after {
  content:''; position:absolute; bottom:0; left:0; right:0; height:1px;
  background:linear-gradient(90deg,transparent,rgba(245,166,35,0.2),transparent);
  animation:cin-shimmer-bg 3s linear infinite;
  background-size:200% auto;
  opacity:0; transition:opacity 0.2s;
}
.kv-field-tile:hover::after { opacity:1; }
.kv-field-tile:hover {
  transform: translateY(-3px) scale(1.015) !important;
  box-shadow: 0 8px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,166,35,0.15) !important;
  animation: cin-glow-amber 2s ease-in-out infinite !important;
}

/* ══ HEX BYTES ════════════════════════════════════════════════ */
.kv-hex-byte {
  padding: 3px 7px !important;
  border-radius: 5px !important;
  background: linear-gradient(135deg,#0e0e1e,#0b0b16) !important;
  border: 1px solid #1a1a30 !important;
  color: var(--text-code) !important;
  font-family: var(--font-mono) !important;
  font-size: 11px !important;
  letter-spacing: 0.06em !important;
  font-weight: 600 !important;
  transition: all 0.12s ease !important;
  cursor: default !important;
  position: relative !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04) !important;
}
.kv-hex-byte:hover {
  background: linear-gradient(135deg,#1c1c38,#151528) !important;
  border-color: var(--amber) !important;
  color: var(--amber) !important;
  box-shadow: 0 0 12px rgba(245,166,35,0.45), 0 0 24px rgba(245,166,35,0.12), inset 0 1px 0 rgba(255,255,255,0.06) !important;
  transform: translateY(-3px) scale(1.08) !important;
}

/* ══ CRC BADGES ═══════════════════════════════════════════════ */
.kv-crc-pass {
  display:inline-flex; align-items:center; gap:5px;
  background: linear-gradient(135deg,rgba(0,230,118,0.2),rgba(0,230,118,0.08),rgba(0,230,118,0.04)) !important;
  border: 1px solid rgba(0,230,118,0.5) !important; color:#00e676 !important;
  padding:4px 14px; border-radius:20px; font-size:11px;
  font-family:var(--font-mono); font-weight:800;
  animation: cin-badge-in 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards, cin-glow-green 2.5s ease-in-out infinite 0.5s !important;
  position:relative; overflow:hidden;
}
.kv-crc-pass::before {
  content:''; position:absolute; inset:0; border-radius:20px;
  background:linear-gradient(90deg,transparent,rgba(0,230,118,0.08),transparent);
  animation:cin-shimmer-bg 2s linear infinite; background-size:200% auto;
}
.kv-crc-fail {
  display:inline-flex; align-items:center; gap:5px;
  background: linear-gradient(135deg,rgba(255,23,68,0.22),rgba(255,23,68,0.1),rgba(255,23,68,0.05)) !important;
  border: 1px solid rgba(255,23,68,0.55) !important; color:#ff1744 !important;
  padding:4px 14px; border-radius:20px; font-size:11px;
  font-family:var(--font-mono); font-weight:800;
  animation: cin-badge-in 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards, cin-glow-red 1.2s ease-in-out infinite 0.5s !important;
  position:relative; overflow:hidden;
}
.kv-crc-fail::before {
  content:''; position:absolute; inset:0; border-radius:20px;
  background:linear-gradient(90deg,transparent,rgba(255,23,68,0.1),transparent);
  animation:cin-shimmer-bg 1.2s linear infinite; background-size:200% auto;
}
.kv-crc-err {
  display:inline-flex; align-items:center; gap:4px;
  background:rgba(255,255,255,0.04) !important; border:1px solid rgba(255,255,255,0.1) !important;
  color:var(--text-muted) !important; padding:4px 14px; border-radius:20px;
  font-size:11px; font-family:var(--font-mono); font-weight:700;
}

/* ══ FIELD TABLE ══════════════════════════════════════════════ */
/* Table rows — cinematic alternating + hover */
tr { transition: background 0.15s ease !important; }
tr:not(:has(td.kv-section-row-cell)):hover td {
  background: rgba(245,166,35,0.04) !important;
}
tr.decode-row-new { animation: cin-row-flash 1s ease-out forwards; }

/* Section headers */
.kv-section-row {
  background: linear-gradient(90deg,rgba(245,166,35,0.1),rgba(245,166,35,0.04),transparent) !important;
  border-left: 2px solid rgba(245,166,35,0.5) !important;
  animation: cin-section-reveal 0.3s ease forwards !important;
}

/* Sticky th upgrade */
thead th {
  background: linear-gradient(180deg,#050510 0%,#040408 100%) !important;
  border-bottom: 1px solid #1a1a30 !important;
  letter-spacing: 0.1em !important;
  font-size: 10px !important;
  text-shadow: 0 0 10px rgba(245,166,35,0.2) !important;
}

/* ══ LOCO PANEL ═══════════════════════════════════════════════ */
.kv-loco-panel {
  background: linear-gradient(180deg,rgba(6,6,16,0.82) 0%,rgba(4,4,8,0.84) 100%) !important;
  border-right: 1px solid #12122a !important;
  position: relative !important;
}
.kv-loco-panel::after {
  content:''; position:absolute; top:0; bottom:0; right:0; width:1px;
  background:linear-gradient(180deg,transparent,rgba(245,166,35,0.2),rgba(245,166,35,0.08),transparent);
  pointer-events:none;
}
.kv-loco-header {
  padding: 10px 14px 9px !important;
  background: linear-gradient(90deg,rgba(245,166,35,0.09),rgba(245,166,35,0.03),transparent) !important;
  border-bottom: 1px solid #12122a !important;
  position: relative !important;
  overflow: hidden !important;
}
.kv-loco-header::before {
  content:''; position:absolute; top:0; left:0; right:0; height:1px;
  background:linear-gradient(90deg,var(--amber),transparent);
  opacity:0.3;
}
.kv-loco-header::after {
  content:''; position:absolute; bottom:0; left:0; right:0; height:1.5px;
  background:linear-gradient(90deg,transparent,var(--amber),#ffd066,var(--amber),transparent);
  animation:kv-underline-sweep 2.5s ease-in-out infinite alternate;
}

/* ══ SIDEBAR CARDS (Pkt list) ══════════════════════════════════ */
/* Packet list buttons */
button.cin-sidebar-card {
  transition: all 0.18s ease !important;
  position:relative !important; overflow:hidden !important;
}
button.cin-sidebar-card::before {
  content:''; position:absolute; left:0; top:0; bottom:0; width:3px;
  background:var(--amber); opacity:0;
  transition:opacity 0.2s; border-radius:0 2px 2px 0;
}
button.cin-sidebar-card:hover::before,
button.cin-sidebar-card[data-active="true"]::before { opacity:1; }
button.cin-sidebar-card:hover {
  background:rgba(245,166,35,0.05) !important;
  border-color:rgba(245,166,35,0.35) !important;
  transform:translateX(2px) !important;
}

/* ══ STAT CARDS ═══════════════════════════════════════════════ */
.kv-stat-card {
  border-radius: 10px !important;
  padding: 14px 18px !important;
  animation: cin-slide-in-up 0.4s cubic-bezier(0.34,1.2,0.64,1) both !important;
  transition: all 0.22s ease !important;
  position: relative !important;
  overflow: hidden !important;
}
.kv-stat-card::before {
  content:''; position:absolute; inset:0; border-radius:10px;
  background:linear-gradient(135deg,rgba(255,255,255,0.05) 0%,transparent 50%);
  pointer-events:none;
}
.kv-stat-card::after {
  content:''; position:absolute; bottom:0; left:0; right:0; height:2px;
  background:inherit; filter:brightness(2) blur(2px);
  opacity:0.4;
}
.kv-stat-card:hover {
  transform: translateY(-4px) scale(1.01) !important;
  box-shadow: 0 12px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,166,35,0.1) !important;
  animation: cin-glow-amber 2s ease-in-out infinite !important;
}

/* ══ FOOTER ═══════════════════════════════════════════════════ */
.kv-footer {
  background: linear-gradient(90deg,#030308,#040410,#030308) !important;
  border-top: 1px solid #0f0f1e !important;
  padding: 5px 18px !important;
  display: flex !important; align-items: center !important; gap:14px !important;
  font-size: 9px !important; font-family: var(--font-mono) !important;
  color: var(--text-dim) !important;
  flex-shrink: 0 !important;
  position: relative !important;
}
.kv-footer::before {
  content:''; position:absolute; top:0; left:0; right:0; height:1px;
  background:linear-gradient(90deg,transparent,rgba(245,166,35,0.06),rgba(245,166,35,0.15),rgba(245,166,35,0.06),transparent);
}
.kv-footer-sep { color: rgba(245,166,35,0.2) !important; }

/* ══ INPUT PANEL ══════════════════════════════════════════════ */
.kv-input-top {
  position: relative !important;
  background: linear-gradient(180deg,#05050c 0%,#030308 100%) !important;
}
.kv-input-top::before {
  content:''; position:absolute; top:0; left:0; right:0; height:2px;
  background:linear-gradient(90deg,transparent,#f97316,var(--amber),#ffd066,var(--amber),#f97316,transparent);
  animation:cin-shimmer-bg 2.5s linear infinite;
  background-size:300% auto; z-index:1;
  box-shadow:0 0 12px rgba(245,166,35,0.4), 0 0 30px rgba(245,166,35,0.1);
}
.kv-input-top textarea {
  background: linear-gradient(180deg,#060611,#040409) !important;
  border: 1px solid #1a1a30 !important;
  color: var(--text-code) !important;
  transition: border-color 0.2s, box-shadow 0.2s !important;
}
.kv-input-top textarea:focus {
  border-color: rgba(245,166,35,0.5) !important;
  box-shadow: 0 0 0 2px rgba(245,166,35,0.1), inset 0 0 20px rgba(245,166,35,0.03) !important;
  outline: none !important;
}

/* ══ PKT TYPE PILLS ═══════════════════════════════════════════ */
.kv-pkt-pill {
  transition: all 0.2s ease !important;
  backdrop-filter: blur(4px) !important;
  position: relative !important;
  overflow: hidden !important;
}
.kv-pkt-pill::before {
  content:''; position:absolute; inset:0; border-radius:20px;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent);
  animation:cin-shimmer-bg 3s linear infinite;
  background-size:300% auto; opacity:0;
  transition:opacity 0.2s;
}
.kv-pkt-pill:hover::before { opacity:1; }
.kv-pkt-pill:hover {
  transform: translateY(-2px) scale(1.06) !important;
  filter: brightness(1.35) saturate(1.2) !important;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5) !important;
}

/* ══ BUTTONS ══════════════════════════════════════════════════ */
/* Decode button — persistent pulse */
@keyframes kv-decode-pulse {
  0%,100%{ box-shadow:0 0 12px rgba(245,166,35,0.35),0 2px 8px rgba(0,0,0,0.4) }
  50%    { box-shadow:0 0 28px rgba(245,166,35,0.65),0 0 50px rgba(245,166,35,0.18),0 2px 10px rgba(0,0,0,0.5) }
}
.kv-btn-decode:not(:disabled) {
  animation: kv-decode-pulse 2.4s ease-in-out infinite !important;
}
.kv-btn-decode:hover:not(:disabled) {
  animation: none !important;
  box-shadow: 0 0 40px rgba(245,166,35,0.8),0 0 70px rgba(245,166,35,0.2),0 4px 18px rgba(0,0,0,0.6) !important;
  transform: translateY(-2px) scale(1.02) !important;
}

/* Live button */
.kv-btn-live {
  position:relative; overflow:hidden;
}
.kv-btn-live::before {
  content:''; position:absolute; inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent);
  animation:cin-shimmer-bg 2s linear infinite;
  background-size:300% auto;
}
.kv-btn-live:hover, .kv-btn-live.active {
  box-shadow:0 0 24px rgba(239,68,68,0.6),0 0 50px rgba(239,68,68,0.15) !important;
  transform:scale(1.02) !important;
}

/* ══ SEARCH INPUT ═════════════════════════════════════════════ */
input[placeholder="Search fields…"] {
  transition:all 0.2s ease !important;
}
input[placeholder="Search fields…"]:focus {
  box-shadow:0 0 0 2px rgba(245,166,35,0.2),0 0 12px rgba(245,166,35,0.1) !important;
}

/* ══ RAIL TRACK DECORATIONS ════════════════════════════════════ */
.rail-track {
  height: 2px !important;
  background: repeating-linear-gradient(90deg,var(--amber) 0px,var(--amber) 6px,transparent 6px,transparent 12px) !important;
  opacity: 0.3 !important;
  position:relative !important;
}
.rail-track::after {
  content:''; position:absolute; inset:0;
  background:linear-gradient(90deg,transparent,rgba(245,166,35,0.3),transparent);
  animation:cin-shimmer-bg 2s linear infinite;
  background-size:200% auto;
}
.rail-track-live {
  animation: rail-shimmer 1.4s linear infinite !important;
  opacity: 0.55 !important;
  box-shadow:0 0 6px rgba(245,166,35,0.3) !important;
}

/* ══ SIGNAL DOTS ══════════════════════════════════════════════ */
.sig-dot.pass {
  animation: signal-green 1.8s ease-in-out infinite !important;
  box-shadow:0 0 10px rgba(16,185,129,0.6) !important;
}
.sig-dot.fail {
  animation: signal-red 1s ease-in-out infinite !important;
  box-shadow:0 0 12px rgba(239,68,68,0.7) !important;
}

/* ══ CRC PILL (small, in log panel) ═══════════════════════════ */
.crc-pill.pass {
  animation: cin-glow-green 2.5s ease-in-out infinite !important;
}
.crc-pill.fail {
  animation: cin-glow-red 1.1s ease-in-out infinite !important;
}

/* ══ LOG FILE NODES ═══════════════════════════════════════════ */
.log-file-node {
  background: linear-gradient(90deg,rgba(245,158,11,0.07),rgba(245,158,11,0.02),transparent) !important;
  transition: all 0.18s ease !important;
}
.log-file-node:hover {
  background: linear-gradient(90deg,rgba(245,158,11,0.13),rgba(245,158,11,0.04),transparent) !important;
  border-left-color:rgba(245,166,35,0.9) !important;
}

/* ══ LOG PKT ROWS ══════════════════════════════════════════════ */
.log-pkt-row {
  transition:all 0.12s ease !important;
}
.log-pkt-row:hover {
  background:rgba(245,166,35,0.05) !important;
  border-left-color:rgba(245,166,35,0.4) !important;
}
.log-pkt-row.selected {
  background:rgba(0,229,255,0.05) !important;
  border-left-color:var(--cyan) !important;
  box-shadow:inset 3px 0 12px rgba(0,229,255,0.08) !important;
}

/* ══ EMPTY STATE ══════════════════════════════════════════════ */
.kv-empty-icon {
  animation:cin-float 3.5s ease-in-out infinite !important;
  filter:drop-shadow(0 0 16px rgba(245,166,35,0.3)) !important;
}

/* ══ DIFF EMPTY ═══════════════════════════════════════════════ */
.kv-diff-empty {
  animation:cin-float 3s ease-in-out infinite !important;
  display:inline-block !important;
  filter:drop-shadow(0 0 8px rgba(0,229,255,0.2)) !important;
}

/* ══ THEME TOGGLE ═════════════════════════════════════════════ */
.theme-toggle:hover {
  border-color:var(--amber) !important;
  box-shadow:0 0 12px rgba(245,166,35,0.35) !important;
}

/* ══ TRACK ANIM IN EMPTY ══════════════════════════════════════ */
.kv-track-anim {
  animation:kv-track-scroll 2.5s linear infinite !important;
}

/* ══ DECODE/ROW ANIMATION ══════════════════════════════════════ */
.row-in  { animation:cin-slide-in-left 0.2s ease forwards !important; }
.fade-up { animation:cin-slide-in-up   0.28s ease forwards !important; }
.file-node-in { animation:cin-slide-in-left 0.3s cubic-bezier(0.34,1.4,0.64,1) forwards !important; }
.pkt-row-in   { animation:cin-slide-in-left 0.18s ease-out forwards !important; }
.decode-flash { animation:cin-row-flash 0.9s ease-out forwards !important; }
.badge-pop    { animation:cin-badge-in  0.4s cubic-bezier(0.34,1.56,0.64,1) forwards !important; }

/* ══ BACKEND DOT ══════════════════════════════════════════════ */
@keyframes cin-dot-online  { 0%,100%{box-shadow:0 0 5px var(--green)}  50%{box-shadow:0 0 14px var(--green),0 0 28px rgba(0,230,118,0.3)} }
@keyframes cin-dot-offline { 0%,100%{box-shadow:0 0 5px var(--red)}    50%{box-shadow:0 0 14px var(--red),0 0 28px rgba(255,23,68,0.35);opacity:0.7} }
@keyframes cin-dot-check   { 0%,100%{opacity:1} 50%{opacity:0.25} }

/* ══ SCROLLBAR ════════════════════════════════════════════════ */
::-webkit-scrollbar { width:6px; height:6px; }
::-webkit-scrollbar-track { background:linear-gradient(180deg,#020206,#040408) !important; }
::-webkit-scrollbar-thumb {
  background:linear-gradient(180deg,#2a1f00,var(--amber-dim),var(--amber)) !important;
  border-radius:4px; border:none !important;
  box-shadow:0 0 4px rgba(245,166,35,0.2) !important;
}
::-webkit-scrollbar-thumb:hover {
  background:var(--amber) !important;
  box-shadow:0 0 8px var(--amber) !important;
}

/* ══ SPEC TOOLTIP ═════════════════════════════════════════════ */
.spec-tooltip {
  background:linear-gradient(135deg,#0c0c1e,#0a0a18) !important;
  border:1px solid rgba(245,166,35,0.4) !important;
  box-shadow:0 12px 40px rgba(0,0,0,0.8),0 0 0 1px rgba(245,166,35,0.08),0 0 20px rgba(245,166,35,0.06) !important;
  animation:cin-slide-in-up 0.15s ease forwards !important;
}

/* ══ INLINE COPY BTN ══════════════════════════════════════════ */
.copy-btn:hover {
  background:rgba(245,166,35,0.12) !important;
  border-color:rgba(245,166,35,0.4) !important;
  color:var(--amber) !important;
  box-shadow:0 0 8px rgba(245,166,35,0.2) !important;
}

/* ══ PROFILE VISUALIZER CONTROLS ══════════════════════════════ */
.pv-ctrl-btn {
  transition:all 0.15s ease !important;
}
.pv-ctrl-btn:hover {
  box-shadow:0 0 10px rgba(245,166,35,0.3) !important;
}

/* ══ TDMA SLOTS ═══════════════════════════════════════════════ */
.tdma-slot.active {
  border-color:var(--amber) !important;
  box-shadow:0 0 8px rgba(245,166,35,0.35) !important;
  animation:cin-glow-amber 2s ease-in-out infinite !important;
}

/* ══ LOCO SOS PULSE ═══════════════════════════════════════════ */
.loco-sos-pulse {
  animation:loco-pulse 0.6s ease-in-out infinite !important;
  filter:drop-shadow(0 0 8px rgba(255,23,68,0.9)) !important;
}
.danger-zone {
  animation:danger-flash 0.9s ease-in-out infinite !important;
}

/* ══ GLOBAL SURFACE ═══════════════════════════════════════════ */
/* Main content area */
#root > div > div:nth-child(2) {
  background:linear-gradient(180deg,rgba(6,6,16,0.78) 0%,rgba(4,4,10,0.80) 100%) !important;
}

/* Noise texture overlay for depth */
body::after {
  content:'';
  position:fixed; inset:0;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
  opacity:0.018; pointer-events:none; z-index:9998;
  mix-blend-mode:overlay;
}

/* ══ LIGHT THEME OVERRIDES ════════════════════════════════════ */
/* ── Top bar (shared by every page): light in the light theme ── */
:root.light .kv-topbar {
  background: linear-gradient(180deg, #ffffff 0%, #f6f8fc 60%, #eef2f8 100%) !important;
  border-bottom: 1px solid #d6dee9 !important;
  box-shadow: 0 2px 12px rgba(15,23,42,0.10), 0 1px 0 rgba(217,119,6,0.10);
}
:root.light .kv-topbar::before {
  background: linear-gradient(90deg, transparent 0%, rgba(217,119,6,0.15) 20%, rgba(217,119,6,0.45) 50%, rgba(217,119,6,0.15) 80%, transparent 100%);
}
:root.light .kv-topbar::after { opacity: 0.35; }
:root.light .kv-nova-logo-markwrap::before {
  background: radial-gradient(circle, rgba(2,132,199,0.18), rgba(124,58,237,0.08) 55%, transparent 72%);
}
:root.light .kv-nova-logo-word { filter: none; }
:root.light .kv-nova-logo:hover .kv-nova-logo-word { filter: drop-shadow(0 0 5px rgba(2,132,199,0.35)); }
:root.light .kv-nova-logo-shine {
  -webkit-mask-image: url(/nova-text-light.png); mask-image: url(/nova-text-light.png);
  background-image: linear-gradient(105deg, transparent 0%, transparent 40%, rgba(2,132,199,0.9) 48%, #7dd3fc 50%, rgba(124,58,237,0.85) 53%, transparent 61%, transparent 100%);
}
:root.light .kv-nova-divider {
  background: linear-gradient(180deg, transparent, rgba(2,132,199,0.40) 30%, rgba(124,58,237,0.30) 70%, transparent);
}
:root.light .kv-nova-box {
  background: linear-gradient(135deg, rgba(2,132,199,0.08), rgba(2,132,199,0.03), rgba(124,58,237,0.03));
  border-color: rgba(2,132,199,0.30);
}
:root.light .kv-nova-box::before { background: radial-gradient(ellipse at 25% 50%, rgba(2,132,199,0.07), transparent 70%); }
:root.light .kv-nova-box:hover { box-shadow: 0 0 16px rgba(2,132,199,0.18); border-color: rgba(2,132,199,0.5); }
:root.light .kv-hdr-title {
  background: linear-gradient(90deg, #0f172a 0%, #1e293b 55%, #075985 100%);
  -webkit-background-clip: text; background-clip: text; filter: none;
}
:root.light .kv-hdr-title .kv-hdr-accent { -webkit-text-fill-color: #0284c7; filter: none; }
:root.light .kv-hdr-sub {
  background: linear-gradient(90deg, #1d4ed8 0%, #0369a1 50%, #0e7490 100%);
  -webkit-background-clip: text; background-clip: text;
}
:root.light .kv-hdr-train { filter: grayscale(1) sepia(1) hue-rotate(160deg) saturate(3.2) brightness(0.72); }
:root.light .kv-btn-sim { color: #15803d; border-color: rgba(21,128,61,0.35); }
:root.light .kv-btn-sim:hover, :root.light .kv-btn-sim.active {
  background: rgba(22,163,74,0.10); color: #166534; border-color: rgba(21,128,61,0.6);
  box-shadow: 0 0 10px rgba(22,163,74,0.15);
}
:root.light .kv-tabbar {
  background:linear-gradient(180deg,#1e2235 0%,#1a1e2e 100%) !important;
}
:root.light .kv-tab { color:rgba(255,255,255,0.45) !important; }
:root.light .kv-tab.active { color:#fbbf24 !important; }
:root.light .kv-hex-byte {
  background:linear-gradient(135deg,#f0f0f8,#e8e8f4) !important;
  border-color:#c8c8e0 !important; color:#166534 !important;
}
:root.light .kv-hex-byte:hover {
  background:linear-gradient(135deg,#fef3c7,#fde68a) !important;
  border-color:#b45309 !important; color:#78350f !important;
  box-shadow:0 0 10px rgba(180,83,9,0.3) !important;
}
:root.light .kv-footer {
  background:linear-gradient(90deg,#f0f0f8,#f4f4fc,#f0f0f8) !important;
  border-top-color:#d0d0e8 !important;
}
:root.light .kv-loco-panel {
  background:linear-gradient(180deg,#f0f0f8,#ebebf4) !important;
  border-right-color:#c8c8e0 !important;
}
:root.light .spec-tooltip {
  background:linear-gradient(135deg,#fff,#f8f8ff) !important;
  box-shadow:0 8px 30px rgba(0,0,0,0.18) !important;
  color:#2a2a4a !important;
}
/* Surfaces that were forced dark with !important and had no light version */
:root.light #root > div > div:nth-child(2),
:root.light .kv-decode-surface {
  background:linear-gradient(180deg,#f7f8fc 0%,#f0f2f8 100%) !important;
}
:root.light thead th {
  background:#eef0f7 !important;
  color:#4a4a6a !important;
  border-bottom-color:#d8dcea !important;
}
:root.light .kv-input-top {
  background:linear-gradient(180deg,#f7f8fc 0%,#f0f2f8 100%) !important;
}
:root.light .kv-input-top textarea {
  background:#ffffff !important;
  color:#166534 !important;
}
:root.light ::-webkit-scrollbar-track { background:#eef0f6; }
:root.light ::-webkit-scrollbar-thumb { background:#c3c8da; }
/* ═══════════════════════════════════════════════════════════════ */
`;

/* ═══════════════════════════════════════════════════════════════
   PKT TYPE METADATA
/* ═══════════════════════════════════════════════════════════════ */
const PKT_META = {
  9:  { name:"Station to Loco Regular", abbr:"S2L Reg",  short:"C.4.2", color:"#06b6d4", lightColor:"#0284c7", icon:"📡" },
  10: { name:"Loco to Station Regular", abbr:"L2S Reg",  short:"C.4.3", color:"#10b981", lightColor:"#059669", icon:"🚆" },
  11: { name:"Access Authority",        abbr:"AccAuth",  short:"C.4.4", color:"#8b5cf6", lightColor:"#7c3aed", icon:"🔐" },
  12: { name:"Emergency",               abbr:"Emer",     short:"C.4.5", color:"#ef4444", lightColor:"#dc2626", icon:"🚨" },
  13: { name:"Access Request",          abbr:"AccReq",   short:"C.4.6", color:"#f59e0b", lightColor:"#b45309", icon:"📶" },
};

/* ═══════════════════════════════════════════════════════════════
   LOOKUP TABLES
/* ═══════════════════════════════════════════════════════════════ */
const VER_MAP = { 0:"Not used", 1:"Kavach Spec 3.2", 2:"Kavach Spec 4.0" };
const LOCO_MODE_MAP = { 1:"Stand_By",2:"Staff_Responsible",3:"Limited_Supervision",4:"Full_Supervision",5:"Override",6:"On_Sight",7:"Trip",8:"Post_Trip",9:"Reverse",10:"Shunting",11:"Non_Leading",12:"System_Failure",13:"Isolation" };
const EMRG_MAP = { 0:"No Emergency",1:"Unusual Stoppage",2:"SoS",3:"Roll Back",4:"Head-On Collision",5:"Rear-End Collision",6:"Parting SoS",7:"Spare" };
const DIR_MAP = { 0:"Unidentified",1:"Nominal (DOWN)",2:"Reverse (UP)",3:"Reserved" };
const TRAIN_INT_MAP = { 0:"No info",1:"By device",2:"By LP",3:"Reserved" };
const INFO_ACK_MAP = { 0:"No Ack",1:"Loco SoS Ack",2:"FS→LS",3:"LS→SR",4:"FS→SR",5:"OS→SR",6:"OV→SR",7:"Trip Ack",8:"PTRIP→SR",9:"Auto horn",10:"TLM Start",11:"TLM End",12:"Unusual Stop",13:"Manual SoS",14:"Spare",15:"Spare" };
const BRAKE_MAP = { 0:"No overspeed",1:"Overspeed, no brake",2:"Normal Service Brake",3:"Full Service Brake",4:"Emergency Brake" };
const AUTHORITY_MAP = { 0:"Not used",1:"OS Authority (On-Sight)",2:"FS Authority (Full Supervision)",3:"SR Authority (Staff Responsible)" };
const TRACK_COND_MAP = { 0:"Not used",1:"Dead Stop",2:"Radio hole",3:"Non stopping area",4:"Tunnel stopping",5:"Powerless section",6:"Sound horn",7:"Reversing area",8:"Fouling Mark",9:"KAVACH Territory Exit" };
const SUB_PKT_NAME = { 0:"Movement Authority",1:"Static Speed Profile",2:"Gradient Profile",3:"LC Gate Profile",4:"Turnout Speed Profile",5:"Tag Linking Information",6:"Track Condition Data",7:"Temporary Speed Restrictions" };

/* ═══════════════════════════════════════════════════════════════
   CRC-32 IEEE — matches KAVACH RDSO/SPN/196/2020 & python3.py spec
   Polynomial 0x04C11DB7 (reversed 0xEDB88320)
   Initial: 0x00000000 · Final XOR: none · Input/Result reflected
/* ═══════════════════════════════════════════════════════════════ */
const CRC32_TABLE = new Uint32Array([
  0x00000000,0x77073096,0xEE0E612C,0x990951BA,0x076DC419,0x706AF48F,0xE963A535,0x9E6495A3,
  0x0EDB8832,0x79DCB8A4,0xE0D5E91E,0x97D2D988,0x09B64C2B,0x7EB17CBD,0xE7B82D07,0x90BF1D91,
  0x1DB71064,0x6AB020F2,0xF3B97148,0x84BE41DE,0x1ADAD47D,0x6DDDE4EB,0xF4D4B551,0x83D385C7,
  0x136C9856,0x646BA8C0,0xFD62F97A,0x8A65C9EC,0x14015C4F,0x63066CD9,0xFA0F3D63,0x8D080DF5,
  0x3B6E20C8,0x4C69105E,0xD56041E4,0xA2677172,0x3C03E4D1,0x4B04D447,0xD20D85FD,0xA50AB56B,
  0x35B5A8FA,0x42B2986C,0xDBBBC9D6,0xACBCF940,0x32D86CE3,0x45DF5C75,0xDCD60DCF,0xABD13D59,
  0x26D930AC,0x51DE003A,0xC8D75180,0xBFD06116,0x21B4F4B5,0x56B3C423,0xCFBA9599,0xB8BDA50F,
  0x2802B89E,0x5F058808,0xC60CD9B2,0xB10BE924,0x2F6F7C87,0x58684C11,0xC1611DAB,0xB6662D3D,
  0x76DC4190,0x01DB7106,0x98D220BC,0xEFD5102A,0x71B18589,0x06B6B51F,0x9FBFE4A5,0xE8B8D433,
  0x7807C9A2,0x0F00F934,0x9609A88E,0xE10E9818,0x7F6A0DBB,0x086D3D2D,0x91646C97,0xE6635C01,
  0x6B6B51F4,0x1C6C6162,0x856530D8,0xF262004E,0x6C0695ED,0x1B01A57B,0x8208F4C1,0xF50FC457,
  0x65B0D9C6,0x12B7E950,0x8BBEB8EA,0xFCB9887C,0x62DD1DDF,0x15DA2D49,0x8CD37CF3,0xFBD44C65,
  0x4DB26158,0x3AB551CE,0xA3BC0074,0xD4BB30E2,0x4ADFA541,0x3DD895D7,0xA4D1C46D,0xD3D6F4FB,
  0x4369E96A,0x346ED9FC,0xAD678846,0xDA60B8D0,0x44042D73,0x33031DE5,0xAA0A4C5F,0xDD0D7CC9,
  0x5005713C,0x270241AA,0xBE0B1010,0xC90C2086,0x5768B525,0x206F85B3,0xB966D409,0xCE61E49F,
  0x5EDEF90E,0x29D9C998,0xB0D09822,0xC7D7A8B4,0x59B33D17,0x2EB40D81,0xB7BD5C3B,0xC0BA6CAD,
  0xEDB88320,0x9ABFB3B6,0x03B6E20C,0x74B1D29A,0xEAD54739,0x9DD277AF,0x04DB2615,0x73DC1683,
  0xE3630B12,0x94643B84,0x0D6D6A3E,0x7A6A5AA8,0xE40ECF0B,0x9309FF9D,0x0A00AE27,0x7D079EB1,
  0xF00F9344,0x8708A3D2,0x1E01F268,0x6906C2FE,0xF762575D,0x806567CB,0x196C3671,0x6E6B06E7,
  0xFED41B76,0x89D32BE0,0x10DA7A5A,0x67DD4ACC,0xF9B9DF6F,0x8EBEEFF9,0x17B7BE43,0x60B08ED5,
  0xD6D6A3E8,0xA1D1937E,0x38D8C2C4,0x4FDFF252,0xD1BB67F1,0xA6BC5767,0x3FB506DD,0x48B2364B,
  0xD80D2BDA,0xAF0A1B4C,0x36034AF6,0x41047A60,0xDF60EFC3,0xA867DF55,0x316E8EEF,0x4669BE79,
  0xCB61B38C,0xBC66831A,0x256FD2A0,0x5268E236,0xCC0C7795,0xBB0B4703,0x220216B9,0x5505262F,
  0xC5BA3BBE,0xB2BD0B28,0x2BB45A92,0x5CB36A04,0xC2D7FFA7,0xB5D0CF31,0x2CD99E8B,0x5BDEAE1D,
  0x9B64C2B0,0xEC63F226,0x756AA39C,0x026D930A,0x9C0906A9,0xEB0E363F,0x72076785,0x05005713,
  0x95BF4A82,0xE2B87A14,0x7BB12BAE,0x0CB61B38,0x92D28E9B,0xE5D5BE0D,0x7CDCEFB7,0x0BDBDF21,
  0x86D3D2D4,0xF1D4E242,0x68DDB3F8,0x1FDA836E,0x81BE16CD,0xF6B9265B,0x6FB077E1,0x18B74777,
  0x88085AE6,0xFF0F6A70,0x66063BCA,0x11010B5C,0x8F659EFF,0xF862AE69,0x616BFFD3,0x166CCF45,
  0xA00AE278,0xD70DD2EE,0x4E048354,0x3903B3C2,0xA7672661,0xD06016F7,0x4969474D,0x3E6E77DB,
  0xAED16A4A,0xD9D65ADC,0x40DF0B66,0x37D83BF0,0xA9BCAE53,0xDEBB9EC5,0x47B2CF7F,0x30B5FFE9,
  0xBDBDF21C,0xCABAC28A,0x53B39330,0x24B4A3A6,0xBAD03605,0xCDD70693,0x54DE5729,0x23D967BF,
  0xB3667A2E,0xC4614AB8,0x5D681B02,0x2A6F2B94,0xB40BBE37,0xC30C8EA1,0x5A05DF1B,0x2D02EF8D,
]);

/**
 * Compute CRC-32 over a Uint8Array. Matches python3.py calculate_crc32_ieee().
 */
function computeCRC32(bytes) {
  let crc = 0x00000000;
  for (let i = 0; i < bytes.length; i++) {
    const idx = (crc ^ bytes[i]) & 0xFF;
    crc = ((crc >>> 8) ^ CRC32_TABLE[idx]) >>> 0;
  }
  return crc >>> 0;
}

/**
 * Verify the PKT_CRC field of a raw KAVACH packet hex string.
 * CRC covers all bytes EXCEPT the last 4 (the PKT_CRC field itself).
 * Returns { match, computed_hex, stored_hex } or { match:false, error }.
 */
function verifyPacketCRC(payloadHex) {
  try {
    const clean = payloadHex.replace(/0x/gi,"").replace(/\s/g,"");
    if (clean.length % 2 !== 0) return { match:false, error:"Odd-length hex string" };
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = parseInt(clean.slice(i*2, i*2+2), 16);
    if (bytes.length < 5) return { match:false, error:"Payload too short to contain CRC" };
    const covered     = bytes.slice(0, bytes.length - 4);
    const storedBytes = bytes.slice(bytes.length - 4);
    const storedCRC   = ((storedBytes[0]<<24)|(storedBytes[1]<<16)|(storedBytes[2]<<8)|storedBytes[3]) >>> 0;
    const computedCRC = computeCRC32(covered);
    const toHex = v => "0x" + v.toString(16).toUpperCase().padStart(8,"0");
    return { match: computedCRC === storedCRC, computed_hex: toHex(computedCRC), stored_hex: toHex(storedCRC) };
  } catch(e) {
    return { match:false, error: String(e) };
  }
}

/* ═══════════════════════════════════════════════════════════════
   JS BIT DECODER ENGINE — used as fallback when backend is offline
   Decodes all packet types including C.4.2 with all sub-packets:
   MA · SSP · Gradient · LC Gate · Turnout · TLI · TC · TSR
   Field names match exactly what extractProfile expects.
   Spec: RDSO/SPN/196/2020 Annexure-C
═══════════════════════════════════════════════════════════════ */
function hexToBits(hex) {
  const c = hex.replace(/0x/gi,"").replace(/\s/g,"");
  return BigInt("0x"+c).toString(2).padStart(c.length*4,"0");
}
function b2i(b) { return b ? parseInt(b,2) : 0; }
function b2s(b) { if(!b) return 0; const v=parseInt(b,2); return b[0]==="1"?v-(1<<b.length):v; }
class BR {
  constructor(bits){this.bits=bits;this.pos=0;}
  read(n){const e=this.pos+n;const c=this.bits.slice(this.pos,e).padEnd(n,"0");this.pos+=n;return c;}
  peek(n){return this.bits.slice(this.pos,this.pos+n);}
  get rem(){return Math.max(0,this.bits.length-this.pos);}
}
function ft(fn){if(!fn)return"Invalid";const s=fn-1;return`${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;}
function spd(v){return v===0?"Reserved":v<=50?`${v*5} kmph`:v===62?"8 kmph":"Reserved";}
function tinD(v){return v===0?"Don't Care":v>=1&&v<=250?`TIN=${v}`:v===251?"Shed TIN":`Rsv(${v})`;}
function R(field,size,raw,decimal,description,group){return{Field:field,"Size (bits)":size,"Raw Bits":raw,"Decimal Value":decimal,Description:description,_group:group};}
function SEC(name){return{Field:name,"Size (bits)":"","Raw Bits":"","Decimal Value":"",Description:"",_is_section:true};}

function decodeMA(rd){
  const rows=[SEC("MOVEMENT AUTHORITY")];let b,v;
  const sos={0:"No SoS",1:"Foreign RFID",2:"Rsv",3:"Odo≥120m",4:"SPAD",5:"Rear-end",6:"Head-on",7:"Shunting violation",8:"Stn General SoS"};
  b=rd.read(4);v=b2i(b);rows.push(R("FRAME_OFFSET",4,b,v,`Offset = ${v}`,"ma"));
  b=rd.read(4);v=b2i(b);rows.push(R("DEST_LOCO_SOS",4,b,v,sos[v]||`Rsv(${v})`,"ma"));
  b=rd.read(2);v=b2i(b);rows.push(R("TRAIN_SECTION_TYPE",2,b,v,{0:"Station Sec",1:"Absolute Block",2:"Autoblock",3:"Rsv"}[v]||"?","ma"));
  b=rd.read(17);rows.push(R("CUR_SIG_INFO",17,b,b2i(b),"Signal composite (17-bit)","ma"));
  const asp={0:"Unidentified",1:"🔴 Red",2:"🟡 Yellow",10:"🟡🟡 Dbl Yellow",11:"🟢 Green",14:"AG OFF",15:"Red+Calling-On",48:"Stop Board"};
  b=rd.read(6);v=b2i(b);rows.push(R("CUR_SIG_ASPECT",6,b,v,asp[v]||`Code ${v}`,"ma"));
  b=rd.read(6);v=b2i(b);rows.push(R("NEXT_SIG_ASPECT",6,b,v,v===0?"Undefined (RED)":asp[v]||`Code ${v}`,"ma"));
  b=rd.read(15);v=b2i(b);rows.push(R("APPR_SIG_DIST",15,b,v,`${v} m from ref RFID`,"ma"));
  b=rd.read(2);const authType=b2i(b);rows.push(R("AUTHORITY_TYPE",2,b,authType,AUTHORITY_MAP[authType]||"?","ma"));
  if(authType===1){b=rd.read(6);v=b2i(b);rows.push(R("AUTHORIZED_SPEED",6,b,v,spd(v),"ma"));}
  else{rows.push(R("AUTHORIZED_SPEED",0,"","NA","Not present (only for OS authority)","ma"));}
  b=rd.read(16);v=b2i(b);rows.push(R("MA_W_R_T_SIG",16,b,v,v===65535?"SR Mode":""+v+" m","ma"));
  b=rd.read(1);v=b2i(b);rows.push(R("REQ_SHORTEN_MA",1,b,v,v?"Shorten req":"None","ma"));
  if(v===1&&rd.rem>=16){b=rd.read(16);rows.push(R("NEW_MA",16,b,b2i(b),`${b2i(b)} m`,"ma"));}
  b=rd.read(1);v=b2i(b);rows.push(R("TRN_LEN_INFO_STS",1,b,v,v?"TL Info follows":"None","ma"));
  if(v===1&&rd.rem>=26){const t=rd.read(1);rows.push(R("TRN_LEN_INFO_TYPE",1,t,b2i(t),b2i(t)?"END":"START","ma"));const f=rd.read(17);rows.push(R("REF_FRAME_NUM_TLM",17,f,b2i(f),ft(b2i(f)),"ma"));const o=rd.read(8);rows.push(R("REF_OFFSET_TLM",8,o,b2i(o),`${b2i(o)*10} ms`,"ma"));}
  if(rd.rem>=1){b=rd.read(1);v=b2i(b);rows.push(R("NEXT_STN_COMM",1,b,v,v?"Handover req":"None","ma"));if(v===1&&rd.rem>=16){b=rd.read(16);rows.push(R("APPR_STN_ID",16,b,b2i(b),`Stn ID=${b2i(b)}`,"ma"));}}
  return rows;
}
function decodeSSP(rd){
  /* SSP: each Distance[i] = cumulative END of zone i.
     Zone i runs from Distance[i-1] (or 0) to Distance[i] at Speed[i].
     extractProfile rebuilds startDist/endDist from this convention.    */
  const rows=[SEC("STATIC SPEED PROFILE")];let b,v;
  b=rd.read(5);const cnt=b2i(b);rows.push(R("SPEED_INFO_CNT",5,b,cnt,`${cnt} entries`,"ssp"));
  for(let i=0;i<Math.min(cnt,31);i++){
    b=rd.read(15);v=b2i(b);rows.push(R(`  Distance[${i+1}]`,15,b,v,`${v} m`,"ssp"));
    b=rd.read(1);const cl=b2i(b);rows.push(R(`  Class[${i+1}]`,1,b,cl,cl?"A/B/C classified":"Universal","ssp"));
    if(cl===0){b=rd.read(6);rows.push(R(`  Speed[${i+1}]`,6,b,b2i(b),spd(b2i(b)),"ssp"));}
    else{["A","B","C"].forEach(c=>{b=rd.read(6);rows.push(R(`  Speed_${c}[${i+1}]`,6,b,b2i(b),spd(b2i(b)),"ssp"));});}
  }
  return rows;
}
function decodeGrad(rd){
  /* Gradient: Distance[i] = cumulative END of zone i (same convention as SSP). */
  const rows=[SEC("GRADIENT PROFILE")];let b,v;
  b=rd.read(5);const cnt=b2i(b);rows.push(R("GRAD_INFO_CNT",5,b,cnt,`${cnt} entries`,"grad"));
  for(let i=0;i<Math.min(cnt,31);i++){
    b=rd.read(15);v=b2i(b);rows.push(R(`  Distance[${i+1}]`,15,b,v,`${v} m`,"grad"));
    b=rd.read(1);v=b2i(b);rows.push(R(`  GDIR[${i+1}]`,1,b,v,v?"⬆ Uphill":"⬇ Downhill","grad"));
    b=rd.read(5);v=b2i(b);rows.push(R(`  GRADIENT[${i+1}]`,5,b,v,v===0?"Level":v===31?"Rsv":v<30?`1:${Math.floor(1000/v)}`:"Steep>1:33","grad"));
  }
  return rows;
}
function decodeLC(rd){
  const rows=[SEC("LC GATE PROFILE")];let b,v;
  b=rd.read(5);const cnt=b2i(b);rows.push(R("LC_INFO_CNT",5,b,cnt,`${cnt} gates`,"lc"));
  const cls={0:"Special",1:"A",2:"B1",3:"B2",4:"B",5:"C",6:"D",7:"Spare"};
  for(let i=0;i<Math.min(cnt,31);i++){
    b=rd.read(15);v=b2i(b);rows.push(R(`  LC_Dist[${i+1}]`,15,b,v,`${v} m`,"lc"));
    b=rd.read(10);v=b2i(b);rows.push(R(`  LC_ID[${i+1}]`,10,b,v,`Gate #${v}`,"lc"));
    b=rd.read(3);v=b2i(b);rows.push(R(`  LC_Suffix[${i+1}]`,3,b,v,["−","a","b","c","d","e","OOR","Spare"][v]||"?","lc"));
    b=rd.read(1);v=b2i(b);rows.push(R(`  Manning[${i+1}]`,1,b,v,v?"Unmanned":"Manned","lc"));
    b=rd.read(3);v=b2i(b);rows.push(R(`  LC_Class[${i+1}]`,3,b,v,cls[v]||"?","lc"));
    b=rd.read(1);v=b2i(b);rows.push(R(`  Whistle_En[${i+1}]`,1,b,v,v?"Yes":"No","lc"));
    b=rd.read(2);v=b2i(b);rows.push(R(`  Whistle_Type[${i+1}]`,2,b,v,["Dist","Time","Config","Spare"][v]||"?","lc"));
  }
  return rows;
}
function decodeTurnout(rd){
  const rows=[SEC("TURNOUT SPEED PROFILE")];let b,v;
  b=rd.read(2);const cnt=b2i(b);rows.push(R("TO_CNT",2,b,cnt,`${cnt} turnouts`,"to"));
  for(let i=0;i<Math.min(cnt,3);i++){
    b=rd.read(5);v=b2i(b);rows.push(R(`  TO_SPEED[${i+1}]`,5,b,v,v===0?"Not Used":v<=18?`≤${v*5} kmph`:v===31?"Unrestricted":"Rsv","to"));
    b=rd.read(15);v=b2i(b);rows.push(R(`  DIFF_DIST[${i+1}]`,15,b,v,`${v} m`,"to"));
    b=rd.read(12);v=b2i(b);rows.push(R(`  REL_DIST[${i+1}]`,12,b,v,`${v} m`,"to"));
  }
  return rows;
}
function decodeTagLink(rd){
  const rows=[SEC("TAG LINKING INFORMATION")];let b,v;
  b=rd.read(4);v=b2i(b);rows.push(R("DIST_DUP_TAG",4,b,v,v===0?"<1 m":v===15?"Invalid":`${v} m`,"tl"));
  b=rd.read(6);const cnt=b2i(b);rows.push(R("ROUTE_RFID_CNT",6,b,cnt,cnt===0?"No tag (danger)":cnt===63?"Rsv":`${cnt} RFIDs`,"tl"));
  for(let i=0;i<Math.min(cnt,62);i++){
    b=rd.read(11);v=b2i(b);rows.push(R(`  DIST_NXT_RFID[${i+1}]`,11,b,v,`${v} m`,"tl"));
    b=rd.read(10);v=b2i(b);rows.push(R(`  NXT_RFID_ID[${i+1}]`,10,b,v,`ID=${v}`,"tl"));
    b=rd.read(1);v=b2i(b);rows.push(R(`  DUP_TAG_DIR[${i+1}]`,1,b,v,v?"Reverse(-)":"Nominal(+)","tl"));
  }
  b=rd.read(1);const alr=b2i(b);rows.push(R("ABS_LOC_RESET",1,b,alr,alr?"Correction follows":"No error","tl"));
  if(alr===1&&rd.rem>=40){b=rd.read(15);rows.push(R("START_DIST_RESET",15,b,b2i(b),`${b2i(b)} m`,"tl"));b=rd.read(2);v=b2i(b);rows.push(R("ADJ_LOCO_DIR",2,b,v,{0:"Unknown",1:"Nominal",2:"Reverse",3:"From Tags"}[v]||"?","tl"));b=rd.read(23);rows.push(R("ABS_LOC_CORRECTION",23,b,b2i(b),`${b2i(b)} m`,"tl"));}
  if(rd.rem>=3){b=rd.read(3);const c2=b2i(b);rows.push(R("ADJ_LINE_CNT",3,b,c2,c2===0?"No adj lines":`${c2} adj lines`,"tl"));for(let j=0;j<Math.min(c2||1,7)&&rd.rem>=9;j++){b=rd.read(9);rows.push(R(`  LINE_TIN[${j+1}]`,9,b,b2i(b),`TIN=${b2i(b)}`,"tl"));}}
  return rows;
}
function decodeTC(rd){
  const rows=[SEC("TRACK CONDITION DATA")];let b,v;
  b=rd.read(4);const cnt=b2i(b);rows.push(R("TRACKCOND_CNT",4,b,cnt,`${cnt} conditions`,"tc"));
  for(let i=0;i<Math.min(cnt,15);i++){
    b=rd.read(4);v=b2i(b);rows.push(R(`  TYPE[${i+1}]`,4,b,v,TRACK_COND_MAP[v]||`Rsv(${v})`,"tc"));
    b=rd.read(15);v=b2i(b);rows.push(R(`  START_DIST[${i+1}]`,15,b,v,`${v} m`,"tc"));
    b=rd.read(15);v=b2i(b);rows.push(R(`  LENGTH[${i+1}]`,15,b,v,`${v} m`,"tc"));
  }
  return rows;
}
function decodeTSR(rd){
  const rows=[SEC("TEMP SPEED RESTRICTIONS")];let b,v;
  b=rd.read(2);const sts=b2i(b);rows.push(R("TSR_STATUS",2,b,sts,{0:"No TSR",1:"No Latest (→SR)",2:"Latest present",3:"Rsv"}[sts]||"?","tsr"));
  if(sts===2){b=rd.read(5);const cnt=b2i(b);rows.push(R("TSR_CNT",5,b,cnt,`${cnt} entries`,"tsr"));for(let i=0;i<Math.min(cnt,31);i++){b=rd.read(8);rows.push(R(`  TSR_ID[${i+1}]`,8,b,b2i(b),`ID=${b2i(b)}`,"tsr"));b=rd.read(15);rows.push(R(`  TSR_Dist[${i+1}]`,15,b,b2i(b),`${b2i(b)} m`,"tsr"));b=rd.read(15);rows.push(R(`  TSR_Len[${i+1}]`,15,b,b2i(b),`${b2i(b)} m`,"tsr"));b=rd.read(1);v=b2i(b);rows.push(R(`  TSR_Class[${i+1}]`,1,b,v,v?"Classified":"Universal","tsr"));if(v===0){b=rd.read(6);rows.push(R(`  TSR_Speed[${i+1}]`,6,b,b2i(b),spd(b2i(b)),"tsr"));}else{["A","B","C"].forEach(c=>{b=rd.read(6);rows.push(R(`  TSR_Spd${c}[${i+1}]`,6,b,b2i(b),spd(b2i(b)),"tsr"));});}b=rd.read(2);rows.push(R(`  TSR_Whistle[${i+1}]`,2,b,b2i(b),b2i(b)===1?"Whistle":"None","tsr"));}}
  return rows;
}
const SUB_DEC={0:decodeMA,1:decodeSSP,2:decodeGrad,3:decodeLC,4:decodeTurnout,5:decodeTagLink,6:decodeTC,7:decodeTSR};

function decodePacketJS(packet,idx=0){
  const{activeRadio,messagePayload}=packet;
  if(!messagePayload)return{error:"Empty payload",fields:[]};
  let bits;
  try{bits=hexToBits(messagePayload);}catch(e){return{error:`Bad hex: ${e}`,fields:[]};}
  const rd=new BR(bits);
  if(rd.rem<4)return{error:"Too short",fields:[]};
  const ptb=rd.read(4);const ptv=b2i(ptb);
  const ptName=PKT_META[ptv]?.name||`Unknown (${ptv})`;
  const fields=[R("PKT_TYPE",4,ptb,ptv,ptName,"header")];

  function hdr7(){let b,v;b=rd.read(7);v=b2i(b);fields.push(R("PKT_LENGTH",7,b,v,`${v+1} bytes`,"header"));b=rd.read(17);v=b2i(b);fields.push(R("FRAME_NUM",17,b,v,ft(v),"header"));}
  function locoHdr(){let b,v;b=rd.read(20);v=b2i(b);fields.push(R("SOURCE_LOCO_ID",20,b,v,`Loco #${v}`,"header"));b=rd.read(3);v=b2i(b);fields.push(R("SOURCE_LOCO_VER",3,b,v,VER_MAP[v]||`Rsv(${v})`,"header"));}
  function stnHdr(){let b,v;b=rd.read(16);v=b2i(b);fields.push(R("SOURCE_STN_ID",16,b,v,`Stn/ILC/IBS #${v}`,"header"));b=rd.read(3);v=b2i(b);fields.push(R("SOURCE_STN_VER",3,b,v,VER_MAP[v]||`Rsv(${v})`,"header"));}
  function crc(){if(rd.rem>=64){let b=rd.read(32),v=b2i(b);fields.push(R("MAC_CODE",32,b,v,`0x${v.toString(16).toUpperCase().padStart(8,"0")}`,"crc"));}if(rd.rem>=32){let b=rd.read(32),v=b2i(b);fields.push(R("PKT_CRC",32,b,v,`0x${v.toString(16).toUpperCase().padStart(8,"0")}`,"crc"));}}

  if(ptv===13){hdr7();locoHdr();let b,v;
    b=rd.read(23);v=b2i(b);fields.push(R("ABS_LOCO_LOC",23,b,v,v===8388607?"Invalid":`${v} m`,"loco"));
    b=rd.read(11);v=b2i(b);fields.push(R("TRAIN_LENGTH",11,b,v,v===0?"Unident":`${v} m`,"loco"));
    b=rd.read(9);v=b2i(b);fields.push(R("TRAIN_SPEED",9,b,v,v<=400?`${v} kmph`:"Unident","loco"));
    b=rd.read(2);v=b2i(b);fields.push(R("MOVEMENT_DIR",2,b,v,DIR_MAP[v]||"?","loco"));
    b=rd.read(3);v=b2i(b);fields.push(R("EMERGENCY_STATUS",3,b,v,EMRG_MAP[v]||"?",v>0?"emergency":"loco"));
    b=rd.read(4);v=b2i(b);fields.push(R("LOCO_MODE",4,b,v,LOCO_MODE_MAP[v]||`?(${v})`,"loco"));
    b=rd.read(16);v=b2i(b);fields.push(R("APPROACHING_STN_ID",16,b,v,`Stn #${v}`,"loco"));
    b=rd.read(10);v=b2i(b);fields.push(R("LAST_RFID_TAG",10,b,v,`Tag #${v}`,"loco"));
    b=rd.read(9);v=b2i(b);fields.push(R("TIN",9,b,v,tinD(v),"loco"));
    b=rd.read(21);const lon=b2i(b);fields.push(R("LONGITUDE",21,b,lon,`${lon>>12}°`,"gps"));
    b=rd.read(20);const lat=b2i(b);fields.push(R("LATITUDE",20,b,lat,`${lat>>12}°`,"gps"));
    b=rd.read(16);v=b2i(b);fields.push(R("LOCO_RND_NUM_RL",16,b,v,`RandNum=${v}`,"session"));
    if(rd.rem>=5){b=rd.read(5);fields.push(R("Padding",5,b,b2i(b),"Alignment","pad"));}
    if(rd.rem>=32){b=rd.read(32);v=b2i(b);fields.push(R("PKT_CRC",32,b,v,`0x${v.toString(16).toUpperCase().padStart(8,"0")}`,"crc"));}
  } else if(ptv===10){hdr7();locoHdr();let b,v;
    b=rd.read(23);v=b2i(b);fields.push(R("ABS_LOCO_LOC",23,b,v,v===8388607?"Invalid":`${v} m`,"loco"));
    b=rd.read(9);v=b2i(b);fields.push(R("L_DOUBTOVER",9,b,v,`Over +${v} m`,"uncertainty"));
    b=rd.read(9);v=b2i(b);fields.push(R("L_DOUBTUNDER",9,b,v,`Under -${v} m`,"uncertainty"));
    b=rd.read(2);v=b2i(b);fields.push(R("TRAIN_INT",2,b,v,TRAIN_INT_MAP[v]||"?","integrity"));
    b=rd.read(11);v=b2i(b);fields.push(R("TRAIN_LENGTH",11,b,v,v===0?"Unident":`${v} m`,"loco"));
    b=rd.read(9);v=b2i(b);fields.push(R("TRAIN_SPEED",9,b,v,v<=400?`${v} kmph`:"Unident","loco"));
    b=rd.read(2);v=b2i(b);fields.push(R("MOVEMENT_DIR",2,b,v,DIR_MAP[v]||"?","loco"));
    b=rd.read(3);v=b2i(b);fields.push(R("EMERGENCY_STATUS",3,b,v,EMRG_MAP[v]||"?",v>0?"emergency":"loco"));
    b=rd.read(4);v=b2i(b);fields.push(R("LOCO_MODE",4,b,v,LOCO_MODE_MAP[v]||`?(${v})`,"loco"));
    b=rd.read(10);v=b2i(b);fields.push(R("LAST_RFID_TAG",10,b,v,`Tag #${v}`,"loco"));
    b=rd.read(1);v=b2i(b);fields.push(R("TAG_DUP",1,b,v,v?"Duplicate":"Main","loco"));
    const tlm={0:"OK",1:"Dup miss",2:"Main miss",3:"Both miss",4:"Swapped",5:"Same loc",6:"<DIST_DUP",7:">DIST_DUP"};
    b=rd.read(3);v=b2i(b);fields.push(R("TAG_LINK_INFO",3,b,v,tlm[v]||"?","loco"));
    b=rd.read(9);v=b2i(b);fields.push(R("TIN",9,b,v,tinD(v),"loco"));
    b=rd.read(3);v=b2i(b);fields.push(R("BRAKE_APPLIED",3,b,v,BRAKE_MAP[v]||`Spare(${v})`,v>0?"brake":"loco"));
    b=rd.read(2);v=b2i(b);fields.push(R("NEW_MA_REPLY",2,b,v,{0:"No shorten",1:"Granted",2:"Rejected",3:"Rsv"}[v]||"?","loco"));
    b=rd.read(4);v=b2i(b);fields.push(R("LAST_REF_PROFILE",4,b,v,v===0?"None":`Profile ${v}`,"loco"));
    b=rd.read(1);v=b2i(b);fields.push(R("SIG_OVERRIDE",1,b,v,v?"Active":"Inactive","loco"));
    b=rd.read(4);v=b2i(b);fields.push(R("INFO_ACK",4,b,v,INFO_ACK_MAP[v]||`?(${v})`,"loco"));
    b=rd.read(2);fields.push(R("Spare",2,b,b2i(b),"Future","pad"));
    b=rd.read(6);v=b2i(b);fields.push(R("LOCO_HEALTH",6,b,v,`0b${v.toString(2).padStart(6,"0")}`,"loco"));crc();
  } else if(ptv===9){
    /* ── C.4.2 Station→Loco Regular — full sub-packet decode ── */
    let b,v;
    b=rd.read(10);v=b2i(b);fields.push(R("PKT_LENGTH",10,b,v,`${v+1} bytes`,"header"));
    b=rd.read(17);v=b2i(b);fields.push(R("FRAME_NUM",17,b,v,ft(v),"header"));stnHdr();
    b=rd.read(20);v=b2i(b);fields.push(R("DEST_LOCO_ID",20,b,v,`Loco #${v}`+(v===0?" (Broadcast)":""),"station"));
    b=rd.read(4);v=b2i(b);fields.push(R("REF_PROF_ID",4,b,v,v===0?"None":`Profile ${v}`,"station"));
    b=rd.read(10);v=b2i(b);fields.push(R("LAST_REF_RFID",10,b,v,`Tag #${v}`,"station"));
    b=rd.read(15);v=b2s(b);fields.push(R("DIST_PKT_START",15,b,v,`${v} m from LAST_REF_RFID`,"station"));
    b=rd.read(2);v=b2i(b);fields.push(R("PKT_DIR",2,b,v,{0:"Unident",1:"Nominal",2:"Reverse",3:"Spare"}[v]||"?","station"));
    b=rd.read(3);fields.push(R("Padding",3,b,b2i(b),"Header align","pad"));
    /* Sub-packet loop — stop 64 bits before end (MAC+CRC).
       Each sub-packet is decoded from a BOUNDED reader spanning exactly its
       declared (SUB_PKT_LENGTH+1)*8-11 payload bits, so a variable-length
       sub-packet (optional NEW_MA / TRN_LEN_INFO / trailing padding, etc.)
       can never drift into the next sub-packet's header or into the
       MAC_CODE/PKT_CRC trailer. This mirrors decoder.py's bounded-reader
       fix for the duplicate/garbled sub-packet bug. */
    const MAC_CRC_BITS=64;
    const SUB_LEN_LABEL={0:"SUB_PKT_LENGTH_MA",1:"SUB_PKT_LENGTH_SSP",2:"SUB_PKT_LENGTH_GRAD",3:"SUB_PKT_LENGTH_LC",4:"SUB_PKT_LENGTH_TSP",5:"SUB_PKT_LENGTH_TLI",6:"SUB_PKT_LENGTH_TC",7:"SUB_PKT_LENGTH_TSR"};
    let sc=0;
    const seenSub=new Set();
    while(rd.rem>MAC_CRC_BITS&&rd.rem>=11&&sc<8){
      const sv=b2i(rd.peek(4));
      if(!SUB_DEC[sv]||seenSub.has(sv))break;
      rd.read(4);
      fields.push(R("SUB_PKT_TYPE",4,sv.toString(2).padStart(4,"0"),sv,SUB_PKT_NAME[sv]||`?(${sv})`,"sub-header"));
      const lenBits=rd.read(7);const lenVal=b2i(lenBits);
      fields.push(R(SUB_LEN_LABEL[sv]||"SUB_PKT_LENGTH",7,lenBits,lenVal,`Sub-packet length = ${lenVal+1} bytes`,"sub-header"));
      const payloadBits=(lenVal+1)*8-11;
      const available=Math.min(payloadBits,rd.rem);
      let subBits=rd.read(available);
      if(available<payloadBits)subBits=subBits.padEnd(payloadBits,"0");
      const subRd=new BR(subBits);
      fields.push(...SUB_DEC[sv](subRd));
      seenSub.add(sv);
      sc++;
    }
    crc();
  } else if(ptv===12){hdr7();stnHdr();let b,v;
    b=rd.read(23);v=b2i(b);fields.push(R("STN_LOC",23,b,v,`${v} m`,"station"));
    b=rd.read(1);v=b2i(b);fields.push(R("GEN_SOS_CALL",1,b,v,v?"🚨 SOS Button Pressed":"No Manual SoS",v?"emergency":"station"));
    b=rd.read(1);fields.push(R("Padding",1,b,b2i(b),"Alignment","pad"));crc();
  } else if(ptv===11){hdr7();stnHdr();let b,v;
    b=rd.read(23);v=b2i(b);fields.push(R("STN_LOC",23,b,v,`${v} m`,"station"));
    b=rd.read(20);v=b2i(b);fields.push(R("DEST_LOCO_ID",20,b,v,`Loco #${v}`,"station"));crc();
  } else {
    fields.push(R("DATA","-",bits.slice(4,68),"−",`No decoder for PKT_TYPE=${ptv}`,"unknown"));
  }
  // ── CRC-32 verification (same algorithm as python3.py / decoder.py) ──
  const crcCheck = verifyPacketCRC(messagePayload||"");
  // Annotate the PKT_CRC row with the computed result
  const pktCrcRow = fields.find(f=>f.Field==="PKT_CRC");
  if(pktCrcRow && !crcCheck.error){
    const status = crcCheck.match ? "✓ PASS" : "✗ FAIL";
    pktCrcRow.desc = `Packet CRC = ${crcCheck.stored_hex} | Computed = ${crcCheck.computed_hex} | ${status}`;
    pktCrcRow.Description = pktCrcRow.desc;
  }
  return{
    packet_index:idx+1,
    packet_type_value:ptv,packet_type_name:ptName,
    active_radio:activeRadio,payload_hex:messagePayload,
    total_bits:bits.length,fields,_source:"js",
    crc_check:crcCheck,
  };
}




/* ═══════════════════════════════════════════════════════════════
   EXCEL EXPORT — HORIZONTAL (LEFT→RIGHT) LAYOUT
   ─────────────────────────────────────────────────────────────
   • One header row (per packet-type sheet), one row per packet below it —
     instead of the old "one vertical block per packet" layout.
   • Fields are split into three zones per packet:
       1) HEADER FIELDS   — plain top-level fields (PKT_TYPE, FRAME_NUM, …)
       2) SUB-PACKETS      — MA / SSP / Gradient / LC Gate / Turnout / TLI /
                              TC / TSR profile blocks (only present on
                              packets that carry them, e.g. S2L / C.4.2)
       3) CRC / MAC TRAILER — MAC_CODE, PKT_CRC
   • Each zone (and each individual sub-packet type) gets its own colour,
     with a merged group-header row on top of the field-name row so the
     sheet reads like a "tree" — a colour-coded family of columns per
     sub-packet — while still being 100% flat/filterable Excel data.
   • Styling uses xlsx-js-style (a SheetJS fork that also serialises
     fill/font/border) with a safe fallback to plain SheetJS (values only,
     no colours) if that CDN can't be reached.
═══════════════════════════════════════════════════════════════ */

/** Load a styling-capable XLSX lib, falling back to plain SheetJS. */
async function loadStyledXLSX() {
  try {
    const mod = await import("https://esm.sh/xlsx-js-style@1.2.0");
    const XLSX = mod.default || mod;
    if (!XLSX?.utils?.book_new) throw new Error("bad module shape");
    return { XLSX, styled: true };
  } catch (e) {
    const XLSX = await import("xlsx");   // bundled locally (node_modules/xlsx 0.20.3) — no internet needed
    return { XLSX, styled: false };
  }
}

const THIN_BORDER = {
  top:    { style:"thin", color:{ rgb:"CBD5E1" } },
  bottom: { style:"thin", color:{ rgb:"CBD5E1" } },
  left:   { style:"thin", color:{ rgb:"CBD5E1" } },
  right:  { style:"thin", color:{ rgb:"CBD5E1" } },
};
function styleFor(fillHex, opts={}) {
  return {
    fill: { patternType:"solid", fgColor:{ rgb: fillHex } },
    font: { bold: !!opts.bold, sz: opts.sz||9, color:{ rgb: opts.color||"1A1A1A" } },
    alignment: { horizontal: opts.h||"center", vertical:"center", wrapText: !!opts.wrap },
    border: THIN_BORDER,
  };
}
/** Slightly darken a #RRGGBB hex string — used for zebra banding within a coloured block. */
function shadeHex(hex) {
  try {
    const n = parseInt(hex, 16);
    let r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    r=Math.max(0,r-12); g=Math.max(0,g-12); b=Math.max(0,b-12);
    return ((r<<16)|(g<<8)|b).toString(16).padStart(6,"0").toUpperCase();
  } catch(e) { return hex; }
}

// Fixed palette — every zone / sub-packet type keeps the SAME colour on every
// sheet, so once a user learns "orange = Movement Authority" it holds everywhere.
const ZONE_COLORS = {
  META:    { head:"455A64", sub:"CFD8DC", tint:"ECEFF1" }, // slate  — packet identity
  HEADER:  { head:"6D4C41", sub:"D7CCC8", tint:"EFEBE9" }, // brown  — top-level fields
  TRAILER: { head:"AD1457", sub:"F48FB1", tint:"FCE4EC" }, // pink   — MAC/CRC
};
const SUBPACKET_COLORS = {
  "MOVEMENT AUTHORITY":           { head:"E65100", sub:"FFCC80", tint:"FFF3E0" }, // orange
  "STATIC SPEED PROFILE":         { head:"1565C0", sub:"90CAF9", tint:"E3F2FD" }, // blue
  "GRADIENT PROFILE":             { head:"2E7D32", sub:"A5D6A7", tint:"E8F5E9" }, // green
  "LC GATE PROFILE":              { head:"C62828", sub:"EF9A9A", tint:"FFEBEE" }, // red
  "TURNOUT SPEED PROFILE":        { head:"6A1B9A", sub:"CE93D8", tint:"F3E5F5" }, // purple
  "TAG LINKING INFORMATION":      { head:"00838F", sub:"80DEEA", tint:"E0F7FA" }, // teal
  "TRACK CONDITION DATA":         { head:"F9A825", sub:"FFE082", tint:"FFF8E1" }, // amber
  "TEMP SPEED RESTRICTIONS":      { head:"8E24AA", sub:"E1BEE7", tint:"F3E5F5" }, // magenta
  "TEMPORARY SPEED RESTRICTIONS": { head:"8E24AA", sub:"E1BEE7", tint:"F3E5F5" },
};
function colorForSubpacket(name) {
  return SUBPACKET_COLORS[name] || { head:"37474F", sub:"B0BEC5", tint:"ECEFF1" };
}
// A single "decent red" used to flag invalid/unidentified/erroneous decoded
// values wherever they occur, overriding that column's normal zone tint.
const INVALID_RED = { tint:"F8C6CB", tintAlt:"F5AFB6", text:"7A0C14" };
/** A decoded field counts as "invalid" when its human-readable Description
 *  says so — e.g. "Invalid", "Unidentified", "No decoder for PKT_TYPE=…".
 *  Deliberately excludes "reserved"/"spare"/"rsv" — those mark normal unused
 *  bits, not a decode problem, and would otherwise paint half the sheet red. */
const INVALID_DESC_RE = /\binvalid\b|\bunident\w*|\berror\b|no decoder|\bunknown\b|\bundefined\b/i;
function isInvalidField(f) {
  return INVALID_DESC_RE.test(String(f?.Description || ""));
}

/** Format a raw integer as a zero-padded 32-bit hex string, e.g. 0xFA9B45BB. */
function toHex32(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return "0x" + (n >>> 0).toString(16).toUpperCase().padStart(8, "0");
}
/** Pull the first number out of a string, e.g. "Distance = 1198 m" → 1198,
 *  "Speed entries = 2" → 2, "80 kmph" → 80. Returns null if no digits found
 *  (e.g. purely categorical text like "Universal Speed"). */
function extractLeadingNumber(str) {
  if (str === undefined || str === null) return null;
  const m = String(str).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
/** Decode a raw bit-string ("0101…") straight to its integer value — the
 *  truest "just the decoded value" fallback when nothing else is numeric. */
function rawBitsToInt(rb) {
  if (typeof rb !== "string") return null;
  const clean = rb.trim();
  if (!clean || !/^[01]+$/.test(clean)) return null;
  return parseInt(clean, 2);
}

/** Cell value for one decoded field — ALWAYS a bare number/hex value, never
 *  a labelled string. The backend decoder sometimes puts human-readable text
 *  straight into "Decimal Value" (e.g. "Distance = 1198 m", "Speed entries = 2",
 *  "Universal Speed") — this strips that down to just the number:
 *    • MAC_CODE / PKT_CRC        → 0xHEX (matches CRC Stored/Computed columns)
 *    • SPEED-related fields (or Speed[i]) → the decoded km/h number (from Description,
 *                                   since the raw code is often a 5-kmph step
 *                                   index, not the km/h figure itself)
 *    • everything else           → the plain number, extracted from whatever
 *                                   text it's wrapped in; raw bits as a last
 *                                   resort if no number can be found at all. */
function fieldValue(f) {
  const fname = String(f?.Field || "").trim();
  const dv = f?.["Decimal Value"];
  const desc = f?.Description;
  const rb = f?.["Raw Bits"];

  if (fname === "MAC_CODE" || fname === "PKT_CRC") {
    const hex = toHex32(typeof dv === "number" ? dv : extractLeadingNumber(dv));
    if (hex) return hex;
    const m = String(desc || "").match(/0x[0-9A-Fa-f]+/);
    if (m) return m[0];
  }

  // PKT_LENGTH is stored on the wire as (actual length − 1); the decode
  // page's Description already shows the true length (e.g. "17 bytes" for
  // a raw value of 16) — mirror that exact value here instead of the raw one.
  if (/^PKT_LENGTH$/i.test(fname)) {
    const n = extractLeadingNumber(desc);
    if (n !== null) return n;
    if (typeof dv === "number" && Number.isFinite(dv)) return dv + 1;
    const dvn = extractLeadingNumber(dv);
    if (dvn !== null) return dvn + 1;
  }

  if (/speed/i.test(fname)) {
    const n = extractLeadingNumber(desc) ?? (typeof dv === "number" ? dv : extractLeadingNumber(dv));
    if (n !== null) return n;
  }

  if (typeof dv === "number" && Number.isFinite(dv)) return dv;
  const fromDv = extractLeadingNumber(dv);
  if (fromDv !== null) return fromDv;
  const fromRaw = rawBitsToInt(rb);
  if (fromRaw !== null) return fromRaw;
  if (dv !== undefined && dv !== null && dv !== "") return dv; // last resort — genuinely non-numeric field
  return rb !== undefined && rb !== null ? rb : "";
}

/** Strip decoration ("── STATIC SPEED PROFILE ──", extra spacing, mixed case)
 *  off a section/sub-packet name so it reliably matches a SUBPACKET_COLORS key
 *  — without this, any decorated variant silently falls back to the same
 *  default gray as every other unmatched name, making distinct sub-packets
 *  look identical in the exported sheet. */
function cleanSectionName(name) {
  return String(name || "")
    .replace(/[─—–_]+/g, " ")   // box-drawing / em / en dashes → space
    .replace(/-{2,}/g, " ")     // runs of hyphens (but keep single hyphenated words intact)
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Split one packet's flat `fields[]` into HEADER / SUB-PACKET / TRAILER zones.
 *  Works for both the JS decoder (which tags rows with _group) and backend
 *  results (normalizeResult only guarantees Field names + _is_section), because
 *  the split keys off the field NAMES that are constant across both sources:
 *  "SUB_PKT_TYPE" starts a new sub-packet, "SUB_PKT_LENGTH_*" is skipped,
 *  a _is_section row supplies that sub-packet's display name, and
 *  "MAC_CODE"/"PKT_CRC" always belong to the trailer.                        */
function splitFieldsForExport(fields) {
  const headerFields = [];
  const subBlocks = [];   // [{ name, fields: [...] }]
  const trailerFields = [];
  let current = null;
  let inSubZone = false;

  (fields || []).forEach(f => {
    const fname = String(f?.Field || "").trim();
    if (fname === "MAC_CODE" || fname === "PKT_CRC") { trailerFields.push(f); return; }
    if (fname === "SUB_PKT_TYPE") { inSubZone = true; current = { name:null, fields:[] }; subBlocks.push(current); return; }
    if (/^SUB_PKT_LENGTH/.test(fname)) return; // length marker — not a data column
    if (f?._is_section) { if (current) current.name = cleanSectionName(fname); return; }
    if (inSubZone) { (current ? current.fields : headerFields).push(f); return; }
    headerFields.push(f);
  });
  return { headerFields, subBlocks, trailerFields };
}

/** Union column lists (in first-seen order) across every packet in a sheet. */
function collectColumns(splitList) {
  const headerCols = [], headerSeen = new Set();
  const trailerCols = [], trailerSeen = new Set();
  const subOrder = [], subSeen = new Set();
  const subCols = {}; // name -> { list:[], seen:Set }

  splitList.forEach(sp => {
    sp.headerFields.forEach(f => { const n=String(f.Field||"").trim(); if(!headerSeen.has(n)){headerSeen.add(n);headerCols.push(n);} });
    sp.trailerFields.forEach(f => { const n=String(f.Field||"").trim(); if(!trailerSeen.has(n)){trailerSeen.add(n);trailerCols.push(n);} });
    sp.subBlocks.forEach(b => {
      const name = b.name || "SUB-PACKET";
      if (!subSeen.has(name)) { subSeen.add(name); subOrder.push(name); subCols[name] = { list:[], seen:new Set() }; }
      const bucket = subCols[name];
      b.fields.forEach(f => { const n=String(f.Field||"").trim(); if(!bucket.seen.has(n)){bucket.seen.add(n);bucket.list.push(n);} });
    });
  });
  return { headerCols, trailerCols, subOrder, subCols };
}

const META_COLS = ["#","Source File","Direction","Event Name","Timestamp","Payload (hex)","CRC Stored","CRC Computed","CRC Status"];

/** Build one styled workbook — one sheet per packet TYPE (S2L / L2S / AccAuth /
 *  AccReq / AddEmrg / …), each sheet laid out left→right: field names on row 2,
 *  one packet per data row, with a colour-coded merged group-header row on top
 *  so multi-sub-packet types (S2L / C.4.2) read as a neat colour-keyed tree. */
async function buildDecodedPacketsWorkbook(entries) {
  const { XLSX, styled } = await loadStyledXLSX();
  const wb = XLSX.utils.book_new();

  const groups = new Map(); // abbr -> [{pkt,result,fileName,idx}]
  entries.forEach(e => {
    const abbr = pktTypeAbbr(e.result, e.pkt);
    if (!groups.has(abbr)) groups.set(abbr, []);
    groups.get(abbr).push(e);
  });

  const usedNames = new Set();
  groups.forEach((group, abbr) => {
    let sn = abbr.replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "PKT";
    if (usedNames.has(sn)) {
      let n = 2, base = sn.slice(0, 27);
      while (usedNames.has(`${base}_${n}`.slice(0, 31))) n++;
      sn = `${base}_${n}`.slice(0, 31);
    }
    usedNames.add(sn);

    const splits = group.map(e => splitFieldsForExport(e.result?.fields || []));
    const { headerCols, trailerCols, subOrder, subCols } = collectColumns(splits);

    // Full ordered column list, each tagged with which coloured "zone" it belongs to.
    const colDefs = [];
    META_COLS.forEach(c => colDefs.push({ label:c, zone:"META" }));
    headerCols.forEach(c => colDefs.push({ label:c, zone:"HEADER" }));
    subOrder.forEach(name => subCols[name].list.forEach(c => colDefs.push({ label:c.trim(), zone:name, rawField:c })));
    trailerCols.forEach(c => colDefs.push({ label:c, zone:"TRAILER" }));
    const nCols = colDefs.length;

    // Row 0 = colour-coded zone labels (merged); Row 1 = field names; Row 2+ = data.
    const aoa = [ new Array(nCols).fill(""), colDefs.map(c => c.label) ];
    const invalidMasks = []; // parallel to aoa data rows — invalidMasks[i][c] = true if that cell's decoded value is invalid/unidentified/erroneous

    group.forEach((e, i) => {
      const split = splits[i];
      const crc = e.result?.crc_check || {};
      const metaVals = {
        "#": (e.idx != null ? e.idx + 1 : i + 1),
        "Source File": e.fileName || "-",
        "Direction": e.pkt?.direction || "-",
        "Event Name": e.pkt?.eventName || e.result?.packet_type_name || "-",
        "Timestamp": e.pkt?.ts || "-",
        "Payload (hex)": e.result?.payload_hex || e.pkt?.hex || "-",
        "CRC Stored": crc.stored_hex || e.pkt?.crcRecv || "-",
        "CRC Computed": crc.computed_hex || e.pkt?.crcCalc || "-",
        "CRC Status": crc.match===true ? "PASS" : crc.match===false ? "FAIL" : (e.pkt?.crcValid===true ? "PASS" : e.pkt?.crcValid===false ? "FAIL" : "-"),
      };
      const invalidMask = new Array(nCols).fill(false);
      const row = colDefs.map((c, ci) => {
        if (c.zone === "META") return metaVals[c.label] ?? "";
        let f = null;
        if (c.zone === "HEADER") f = split.headerFields.find(f => String(f.Field||"").trim()===c.label);
        else if (c.zone === "TRAILER") f = split.trailerFields.find(f => String(f.Field||"").trim()===c.label);
        else { const b = split.subBlocks.find(b => (b.name||"SUB-PACKET")===c.zone); f = b ? b.fields.find(f => String(f.Field||"").trim()===c.rawField) : null; }
        if (f && isInvalidField(f)) invalidMask[ci] = true;
        return f ? fieldValue(f) : "";
      });
      invalidMasks.push(invalidMask);
      aoa.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Merge each contiguous same-zone run in row 0 into one labelled band.
    const merges = [];
    for (let ci = 0; ci < nCols; ) {
      const zone = colDefs[ci].zone;
      let cj = ci; while (cj+1 < nCols && colDefs[cj+1].zone === zone) cj++;
      merges.push({ s:{r:0,c:ci}, e:{r:0,c:cj} });
      ci = cj + 1;
    }
    ws["!merges"] = merges;
    ws["!cols"] = colDefs.map(c => ({ wch: Math.max(11, Math.min(30, c.label.length + 4)) }));
    ws["!rows"] = [{ hpt:20 }, { hpt:32 }];
    // Filter dropdowns on every column, anchored on row 2 (the field-name
    // header row) so Excel shows the ▾ buttons there rather than on the
    // merged zone-label row above it.
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s:{ r:1, c:0 }, e:{ r: group.length + 1, c: nCols - 1 } }),
    };

    if (styled) {
      for (let ci = 0; ci < nCols; ) {
        const zone = colDefs[ci].zone;
        let cj = ci; while (cj+1 < nCols && colDefs[cj+1].zone === zone) cj++;
        const palette = ZONE_COLORS[zone] || colorForSubpacket(zone);
        const label = zone==="META" ? "PACKET INFO" : zone==="HEADER" ? "HEADER FIELDS" : zone==="TRAILER" ? "CRC / MAC TRAILER" : zone;

        for (let c = ci; c <= cj; c++) {
          const ref = XLSX.utils.encode_cell({ r:0, c });
          if (!ws[ref]) ws[ref] = { t:"s", v:"" };
          ws[ref].v = (c===ci ? label : "");
          ws[ref].t = "s";
          ws[ref].s = styleFor(palette.head, { bold:true, color:"FFFFFF", sz:11 });
        }
        for (let c = ci; c <= cj; c++) {
          const ref = XLSX.utils.encode_cell({ r:1, c });
          if (ws[ref]) ws[ref].s = styleFor(palette.sub, { bold:true, color:"1A1A1A", sz:9, wrap:true });
        }
        for (let r = 0; r < group.length; r++) {
          for (let c = ci; c <= cj; c++) {
            const ref = XLSX.utils.encode_cell({ r:r+2, c });
            if (!ws[ref]) ws[ref] = { t:"s", v:"" };
            const bad = invalidMasks[r]?.[c];
            ws[ref].s = bad
              ? styleFor(r%2===0 ? INVALID_RED.tint : INVALID_RED.tintAlt, { bold:true, color:INVALID_RED.text, sz:9, h:"left" })
              : styleFor(r%2===0 ? palette.tint : shadeHex(palette.tint), { bold:false, color:"222222", sz:9, h:"left" });
          }
        }
        ci = cj + 1;
      }
      // Highlight CRC Status specifically — green PASS / red FAIL.
      const statusCol = colDefs.findIndex(c => c.label === "CRC Status");
      if (statusCol >= 0) {
        for (let r = 0; r < group.length; r++) {
          const ref = XLSX.utils.encode_cell({ r:r+2, c:statusCol });
          const cell = ws[ref];
          if (!cell) continue;
          const pass = String(cell.v).toUpperCase() === "PASS";
          const fail = String(cell.v).toUpperCase() === "FAIL";
          if (pass) cell.s = styleFor("C8E6C9", { bold:true, color:"1B5E20", sz:9 });
          else if (fail) cell.s = styleFor("FFCDD2", { bold:true, color:"B71C1C", sz:9 });
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, sn);
  });

  return { wb, XLSX };
}

/* ═══════════════════════════════════════════════════════════════
   LOG PANEL EXCEL EXPORT — one sheet per decoded packet TYPE
   (S2L / L2S / AccAuth / AddEmrg / AccReq), horizontal layout,
   with colour-coded sub-packet "tree" columns for C.4.2 (S2L) packets.
═══════════════════════════════════════════════════════════════ */
const PKT_TYPE_ABBR = {
  9:  "S2L",     // Station/ILC/IBS → Onboard Regular Packet
  10: "L2S",     // Onboard → Station Regular Packet
  11: "AccAuth", // Access Authority Packet
  12: "AddEmrg", // Additional Emergency Packet
  13: "AccReq",  // Onboard Access Request Packet
};
function pktTypeAbbr(result, pkt) {
  if (result && PKT_TYPE_ABBR[result.packet_type_value]) return PKT_TYPE_ABBR[result.packet_type_value];
  // Fall back to guessing from the Event Name when a decoded result isn't available
  const name = (pkt?.eventName || result?.packet_type_name || "").toLowerCase();
  if (name.includes("station")) return "S2L";
  if (name.includes("loco"))    return "L2S";
  if (name.includes("access authority")) return "AccAuth";
  if (name.includes("emergency")) return "AddEmrg";
  if (name.includes("access request")) return "AccReq";
  return "PKT";
}

async function exportLogPacketsToExcel(entries) {
  // entries: [{ pkt, result, fileName }]
  if (!entries.length) return;
  const withIdx = entries.map((e, i) => ({ ...e, idx: e.idx ?? i }));
  const { wb, XLSX } = await buildDecodedPacketsWorkbook(withIdx);
  XLSX.writeFile(wb, `kavach_log_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* ═══════════════════════════════════════════════════════════════
   EXCEL EXPORT (main decoder results — same horizontal layout)
═══════════════════════════════════════════════════════════════ */
async function exportToExcel(results) {
  const entries = results.map((r, idx) => ({ pkt:null, fileName:null, result:r, idx }));
  const { wb, XLSX } = await buildDecodedPacketsWorkbook(entries);
  XLSX.writeFile(wb, `kavach_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* ═══════════════════════════════════════════════════════════════
   INPUT PARSER (robust — handles missing commas etc.)
/* ═══════════════════════════════════════════════════════════════ */
function parseInput(text) {
  const t = text.trim();
  if (!t) return null;
  try { const p=JSON.parse(t); return Array.isArray(p)?p.filter(x=>x&&typeof x==="object"):[p]; } catch(_) {}
  try {
    let fixed = t.replace(/\}\s*\{/g,"},{").replace(/\]\s*\[/g,"],[");
    if(!/^\s*\[/.test(fixed)) fixed=`[${fixed}]`;
    const p2=JSON.parse(fixed);
    if(Array.isArray(p2)&&p2.length) return p2.filter(x=>x&&typeof x==="object");
  } catch(_) {}
  try {
    const blocks=[]; let depth=0,start=-1;
    for(let i=0;i<t.length;i++){
      if(t[i]==="{"){if(depth===0)start=i;depth++;}
      else if(t[i]==="}"){depth--;if(depth===0&&start!==-1){try{blocks.push(JSON.parse(t.slice(start,i+1)));}catch(_){}start=-1;}}
    }
    if(blocks.length) return blocks;
  } catch(_) {}
  const lines=t.split("\n").map(l=>l.trim()).filter(Boolean);
  if(lines.every(l=>/^(0x)?[0-9a-fA-F]+$/i.test(l))) return lines.map(l=>({activeRadio:"0x00",messagePayload:l.replace(/^0x/i,"")}));
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   GROUP COLOR MAP — adapts per theme
/* ═══════════════════════════════════════════════════════════════ */
const GROUP_COLOR_DARK = {
  header:"#f59e0b", loco:"#06b6d4", station:"#8b5cf6",
  emergency:"#ef4444", brake:"#f97316", gps:"#10b981",
  freq:"#22d3ee", session:"#a78bfa", crc:"#6b7280", pad:"#374151",
  uncertainty:"#fbbf24", integrity:"#34d399",
  ma:"#f59e0b", ssp:"#10b981", grad:"#a78bfa", lc:"#f97316",
  to:"#06b6d4", tl:"#ec4899", tc:"#84cc16", tsr:"#fb7185",
  "sub-header":"#f59e0b", unknown:"#6b7280",
};
const GROUP_COLOR_LIGHT = {
  header:"#b45309", loco:"#0284c7", station:"#7c3aed",
  emergency:"#dc2626", brake:"#ea580c", gps:"#059669",
  freq:"#0891b2", session:"#6d28d9", crc:"#6b7280", pad:"#9ca3af",
  uncertainty:"#d97706", integrity:"#047857",
  ma:"#b45309", ssp:"#047857", grad:"#6d28d9", lc:"#ea580c",
  to:"#0284c7", tl:"#be185d", tc:"#4d7c0f", tsr:"#e11d48",
  "sub-header":"#b45309", unknown:"#9ca3af",
};

/* ═══════════════════════════════════════════════════════════════
   TRAIN LOGO WITH REALISTIC SMOKE ANIMATION
/* ═══════════════════════════════════════════════════════════════ */
function TrainLogoWithSmoke() {
  return (
    <div className="kv-train-smoke-wrap" style={{ position:"relative", width:56, height:44, flexShrink:0 }}>
      {/* Smoke particles SVG */}
      <svg
        style={{ position:"absolute", left:-8, top:-18, width:72, height:40, pointerEvents:"none", overflow:"visible" }}
        viewBox="0 0 72 40"
      >
        {/* Smoke puff 1 */}
        <circle className="smoke-p1" cx="22" cy="32" r="4" fill="rgba(180,180,200,0.55)" />
        {/* Smoke puff 2 */}
        <circle className="smoke-p2" cx="26" cy="28" r="3.2" fill="rgba(160,160,190,0.42)" />
        {/* Smoke puff 3 */}
        <circle className="smoke-p3" cx="29" cy="24" r="2.5" fill="rgba(140,140,175,0.30)" />
        {/* Smoke puff 4 */}
        <circle className="smoke-p4" cx="32" cy="19" r="2" fill="rgba(120,120,160,0.20)" />
        {/* Smoke puff 5 */}
        <circle className="smoke-p5" cx="35" cy="14" r="1.5" fill="rgba(100,100,145,0.12)" />
        {/* Secondary trail */}
        <circle className="smoke-s1" cx="20" cy="30" r="2.8" fill="rgba(200,195,220,0.38)" />
        <circle className="smoke-s2" cx="24" cy="25" r="2.1" fill="rgba(175,170,200,0.25)" />
        <circle className="smoke-s3" cx="28" cy="20" r="1.6" fill="rgba(150,148,182,0.16)" />
      </svg>

      {/* Train SVG icon */}
      <svg
        className="kv-train-icon"
        viewBox="0 0 48 36"
        width="48" height="36"
        style={{ position:"relative", zIndex:1 }}
      >
        {/* Train body */}
        <rect x="2" y="14" width="40" height="16" rx="3" fill="#1a1a28" stroke="rgba(245,166,35,0.7)" strokeWidth="1.2"/>
        {/* Cab / engine front */}
        <rect x="34" y="10" width="10" height="20" rx="2" fill="#141420" stroke="rgba(245,166,35,0.55)" strokeWidth="1"/>
        {/* Chimney */}
        <rect x="16" y="8" width="4" height="8" rx="1" fill="#0f0f1a" stroke="rgba(245,166,35,0.4)" strokeWidth="0.8"/>
        <rect x="14.5" y="7" width="7" height="2.5" rx="1" fill="#1c1c2e" stroke="rgba(245,166,35,0.5)" strokeWidth="0.7"/>
        {/* Windows */}
        <rect x="8" y="17" width="7" height="5" rx="1" fill="#0a0a18" stroke="rgba(0,229,255,0.45)" strokeWidth="0.8"/>
        <rect x="18" y="17" width="7" height="5" rx="1" fill="#0a0a18" stroke="rgba(0,229,255,0.35)" strokeWidth="0.8"/>
        {/* Cab window glow */}
        <rect x="35" y="13" width="6" height="6" rx="1" fill="rgba(245,166,35,0.18)" stroke="rgba(245,166,35,0.6)" strokeWidth="0.8"/>
        {/* Headlamp */}
        <circle cx="44" cy="22" r="2" fill="rgba(245,166,35,0.9)" className="kv-headlamp"/>
        <circle cx="44" cy="22" r="3.5" fill="none" stroke="rgba(245,166,35,0.3)" strokeWidth="0.6" className="kv-headlamp-ring"/>
        {/* Wheels */}
        <circle cx="10" cy="30" r="3.5" fill="#0c0c18" stroke="rgba(245,166,35,0.6)" strokeWidth="1.2"/>
        <circle cx="10" cy="30" r="1.5" fill="rgba(245,166,35,0.4)"/>
        <circle cx="22" cy="30" r="3.5" fill="#0c0c18" stroke="rgba(245,166,35,0.6)" strokeWidth="1.2"/>
        <circle cx="22" cy="30" r="1.5" fill="rgba(245,166,35,0.4)"/>
        <circle cx="34" cy="30" r="3.5" fill="#0c0c18" stroke="rgba(245,166,35,0.6)" strokeWidth="1.2"/>
        <circle cx="34" cy="30" r="1.5" fill="rgba(245,166,35,0.4)"/>
        {/* Connecting rod */}
        <line x1="10" y1="30" x2="34" y2="30" stroke="rgba(245,166,35,0.25)" strokeWidth="0.8"/>
        {/* Rail line below */}
        <line x1="0" y1="34.5" x2="48" y2="34.5" stroke="rgba(245,166,35,0.5)" strokeWidth="1.5"/>
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   THEME TOGGLE BUTTON COMPONENT
/* ═══════════════════════════════════════════════════════════════ */
function ThemeToggle({ isLight, onToggle }) {
  const [spinning, setSpinning] = useState(false);
  const handleClick = () => {
    setSpinning(true);
    onToggle();
    setTimeout(() => setSpinning(false), 400);
  };
  return (
    <button
      onClick={handleClick}
      className={`theme-toggle${isLight ? " light-mode" : ""}`}
      title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
      style={{ outline:"none", display:"flex", alignItems:"center" }}
    >
      <div
        className="theme-toggle-thumb"
        style={{ animation: spinning ? "theme-spin 0.4s ease" : "none" }}
      >
        {isLight ? "☀️" : "🌙"}
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HEX BYTE DISPLAY
/* ═══════════════════════════════════════════════════════════════ */
function HexDisplay({ hex, isLight }) {
  const [hovered, setHovered] = useState(null);
  if (!hex) return null;
  const clean = hex.replace(/0x/gi,"").replace(/\s/g,"");
  const bytes = clean.match(/.{1,2}/g) || [];
  return (
    <div style={{
      fontFamily:"var(--font-mono)", fontSize:11,
      display:"flex", flexWrap:"wrap", gap:"3px 4px", marginTop:10,
      padding:"8px 10px",
      background:"var(--hex-strip-bg)",
      border:"1px solid var(--hex-strip-border)",
      borderRadius:7,
      boxShadow:"inset 0 0 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.02)",
      position:"relative", overflow:"hidden",
    }}>
      {/* subtle scan effect */}
      <div style={{position:"absolute",top:0,left:"-100%",width:"60%",height:"100%",background:"linear-gradient(90deg,transparent,rgba(245,166,35,0.025),transparent)",animation:"cin-shimmer-bg 4s linear infinite",backgroundSize:"200% auto",pointerEvents:"none"}}/>
      {bytes.map((b,i) => (
        <span key={i} className="kv-hex-byte"
          onMouseEnter={()=>setHovered(i)} onMouseLeave={()=>setHovered(null)}
        >
          {b}
          {hovered===i && (
            <span style={{
              position:"absolute", bottom:"calc(100% + 6px)", left:"50%",
              transform:"translateX(-50%)", whiteSpace:"nowrap",
              background:"var(--tooltip-bg)",
              border:"1px solid rgba(245,166,35,0.5)",
              borderRadius:5, padding:"3px 8px", fontSize:8,
              color:"var(--amber)", fontFamily:"var(--font-mono)", fontWeight:700,
              boxShadow:"0 6px 18px rgba(0,0,0,0.7), 0 0 8px rgba(245,166,35,0.2)",
              pointerEvents:"none", zIndex:100,
              animation:"cin-slide-in-up 0.1s ease",
              letterSpacing:"0.05em",
            }}>byte #{i} · 0x{b} · {parseInt(b,16)}</span>
          )}
        </span>
      ))}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   SPEC ANNOTATIONS — per-field reference data from Annexure-C
/* ═══════════════════════════════════════════════════════════════ */
const SPEC_ANNOTATIONS = {
  "PKT_TYPE":           { range:"4-bit, 1001–1101 valid (V4.0)", page:"C.4.1", note:"Defines packet category. 0b1101=Access Req, 0b1001=Stn→Onboard" },
  "PKT_LENGTH":         { range:"N bytes (value+1)", page:"C.4.2", note:"Length of entire packet in bytes. Max 128 bytes (7-bit field)." },
  "FRAME_NUM":          { range:"1–86400", page:"C.3.1", note:"Frame number = (HH×3600 + MM×60 + SS) + 1. Frame 1 = 00:00:00. Each cycle = 2000ms." },
  "TRAIN_SPEED":        { range:"0–400 kmph; 511=unidentified", page:"C.4.3", note:"0 is reserved. 401–510 reserved for future. 511=unidentified." },
  "TRAIN_LENGTH":       { range:"1–2047 m; 0=unknown", page:"C.4.3", note:"Includes L_DoubtOver + L_DoubtUnder at both ends." },
  "EMERGENCY_STATUS":   { range:"3-bit; 000=normal", page:"C.4.3", note:"010=SoS, 100=Head-On, 101=Rear-End. Triggers emergency broadcast." },
  "LOCO_MODE":          { range:"4-bit; 0001–1101", page:"C.4.3", note:"Operating mode of onboard KAVACH. 0100=Full Supervision is normal." },
  "ABS_LOCO_LOC":       { range:"0–8388606 m; 8388607=invalid", page:"C.4.3", note:"Absolute location compensated for reader offset. Signed distance from datum." },
  "L_DOUBTOVER":        { range:"0–511 m", page:"C.4.3", note:"Over-reading = 5m RFID accuracy + 5% odometry error. Used for rear-end/PSR supervision." },
  "L_DOUBTUNDER":       { range:"0–511 m", page:"C.4.3", note:"Under-reading for head-on collision / tag discard beyond this length." },
  "MOVEMENT_DIR":       { range:"2-bit", page:"C.4.3", note:"01=Nominal(UP), 10=Reverse(DOWN). Determined from RFID tag sequence." },
  "TIN":                { range:"0–511; 1–250 valid", page:"C.4.3", note:"Track Identity Number. 0=don't care, 251=shed TIN, 252–511=reserved." },
  "LAST_RFID_TAG":      { range:"0–1023 (10-bit)", page:"C.4.3", note:"Tag ID of last RFID read. Used for Head-On/Rear-End collision detection." },
  "BRAKE_APPLIED":      { range:"3-bit", page:"C.4.3", note:"000=no brake, 010=Normal Service Brake, 100=Emergency Brake applied by KAVACH." },
  "SOURCE_LOCO_ID":     { range:"1–999999; 0=invalid", page:"C.4.6", note:"Unique loco identifier. Same as loco number stamped on rolling stock." },
  "SOURCE_STN_ILC_IBS_ID": { range:"1–65535", page:"C.4.2", note:"Unique station/ILC/IBS code assigned per KMS territory." },
  "Allotted_UpLink_Freq":  { range:"0=off; 1–2560=406–470MHz; 4094=WiFi/LTE", page:"C.4.4", note:"Base 406 MHz + channel × 0.025 MHz. Channel 2560 = 470.000 MHz." },
  "Allotted_DownLink_Freq":{ range:"0=off; 1–2560=406–470MHz", page:"C.4.4", note:"Downlink (S-KAVACH → L-KAVACH) frequency allocation." },
  "Allotted_TDMA_Timeslot":{ range:"0=none; 1–68=valid slot", page:"C.4.4", note:"Exact P-marker timeslot allocated. Frame has 70 slots × 22.5ms each." },
  "PKT_CRC":            { range:"32-bit CRC", page:"C.3.2", note:"Standard CRC-32 over entire packet except CRC field itself." },
  "MAC_CODE":           { range:"32-bit HMAC", page:"C.4.2", note:"Calculated from PKT_TYPE through last sub-packet padding bits." },
  "GEN_SOS_CALL":       { range:"1-bit; 1=SoS active", page:"C.4.5", note:"Set when manual SOS button pressed on Station Operating Interface Panel (SOIP)." },
  "APPR_SIG_DIST":      { range:"0–32767 m (15-bit)", page:"C.4.2", note:"Distance from last reference RFID tag to approaching signal." },
  "MA_W_R_T_SIG":       { range:"0–65534 m; 65535=SR mode", page:"C.4.2", note:"Movement Authority distance from signal. 65535 = unknown (onboard goes SR mode)." },
  "AUTHORITY_TYPE":     { range:"2-bit", page:"C.4.2", note:"00=not used, 01=OS(On-Sight), 10=FS(Full Supervision), 11=SR(Staff Responsible)." },
  "AUTHORIZED_SPEED":   { range:"1–50 (×5kmph); 62=8kmph night", page:"C.4.2", note:"Speed restriction for OS/SR authority. Value×5=kmph. Only valid if AUTHORITY_TYPE=01 or 11." },
  "DIST_PKT_START":     { range:"15-bit signed, metres", page:"C.4.2", note:"Signed distance from LAST_REF_RFID to packet start. Negative=supervise from rear." },
  "CUR_SIG_ASPECT":     { range:"6-bit", page:"C.4.2", note:"1=Red, 2=Yellow, 10=Dbl Yellow, 11=Green, 15=Red+CallingOn, 48=Stop Board." },
  "LONGITUDE":          { range:"21-bit: deg(9b)+min(6b)+sec(6b)", page:"C.4.6", note:"GPS Longitude. First 9 bits=degrees, next 6=minutes, last 6=seconds." },
  "LATITUDE":           { range:"20-bit: deg(8b)+min(6b)+sec(6b)", page:"C.4.6", note:"GPS Latitude. First 8 bits=degrees, next 6=minutes, last 6=seconds." },
};

/* ═══════════════════════════════════════════════════════════════
   CRC BADGE COMPONENT
/* ═══════════════════════════════════════════════════════════════ */
function CRCBadge({ crcCheck, isLight }) {
  if (!crcCheck) return null;
  const { match, computed_hex, stored_hex, error } = crcCheck;
  if (error) return (
    <span className="kv-crc-err">⚠ CRC N/A</span>
  );
  return (
    <span className={match ? "kv-crc-pass" : "kv-crc-fail"}
      title={match ? `CRC OK: ${stored_hex}` : `Stored: ${stored_hex} | Computed: ${computed_hex}`}>
      {match ? "✓ CRC PASS" : "✗ CRC FAIL"}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VALIDATION WARNINGS BADGE
/* ═══════════════════════════════════════════════════════════════ */
function ValidationBadge({ warnings, isLight }) {
  const [open, setOpen] = useState(false);
  if (!warnings || warnings.length === 0) return (
    <span style={{
      padding:"2px 8px", borderRadius:4, fontSize:9, fontFamily:"var(--font-mono)",
      background: isLight?"#dcfce7":"#10b98118", color: isLight?"#166534":"#34d399",
      border:"1px solid #10b98133",
    }}>✓ VALID</span>
  );
  return (
    <div style={{ position:"relative", display:"inline-block" }}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        padding:"2px 9px", borderRadius:4, fontSize:9, fontFamily:"var(--font-mono)", fontWeight:700,
        background: isLight?"#fef3c7":"#f59e0b18", color: isLight?"#92400e":"#fbbf24",
        border:"1px solid #f59e0b44", cursor:"pointer",
      }}>⚠ {warnings.length} WARNING{warnings.length>1?"S":""}</button>
      {open && (
        <div style={{
          position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:50,
          background: isLight?"#fff":"#0f0f18", border:`1px solid ${isLight?"#d8d8e8":"#2e2e45"}`,
          borderRadius:7, padding:10, minWidth:280, maxWidth:380,
          boxShadow:"0 8px 32px rgba(0,0,0,0.5)",
        }}>
          {warnings.map((w,i)=>(
            <div key={i} style={{
              fontSize:10, fontFamily:"var(--font-mono)", padding:"4px 0",
              borderBottom: i<warnings.length-1 ? `1px solid ${isLight?"#e8e8f0":"#1e1e30"}` : "none",
              color: isLight?"#5a2a00":"#fbbf24",
            }}>
              <span style={{color: isLight?"#92400e":"#f59e0b", fontWeight:700}}>{w.field}</span>
              {" = "}{w.value} <span style={{color:"var(--text-muted)"}}>({w.note})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STATS PANEL — aggregate view across all decoded packets
/* ═══════════════════════════════════════════════════════════════ */
function StatsPanel({ results, isLight }) {
  const stats = useMemo(() => {
    const byType = {};
    const speeds = [], locos = [], stations = [], emergencies = [];
    let totalBits = 0;
    results.forEach(r => {
      const tn = r.packet_type_name || "Unknown";
      byType[tn] = (byType[tn]||0) + 1;
      totalBits += r.total_bits || 0;
      (r.fields||[]).forEach(f => {
        const fn = (f.Field||"").trim();
        const v = f["Decimal Value"];
        if (fn==="TRAIN_SPEED" && typeof v==="number" && v>0 && v<=400) speeds.push(v);
        if (fn==="SOURCE_LOCO_ID" && typeof v==="number" && v>0) locos.push(v);
        if ((fn==="SOURCE_STN_ILC_IBS_ID"||fn==="SOURCE_STN_ID") && typeof v==="number" && v>0) stations.push(v);
        if ((fn==="EMERGENCY_STATUS"||fn==="GEN_SOS_CALL") && typeof v==="number" && v>0)
          emergencies.push({pkt: r.packet_index, field:fn, val:v, desc:f.Description});
      });
    });
    return { byType, speeds, locos:[...new Set(locos)], stations:[...new Set(stations)], emergencies, totalBits };
  }, [results]);

  const sv = (label, val, color, sub) => (
    <div className="kv-stat-card" style={{
      flex:"1 1 130px",
      background:`linear-gradient(135deg,${color}14,${color}07,rgba(0,0,0,0.3))`,
      borderRadius:10, padding:"14px 16px",
      border:`1px solid ${color}33`,
      borderTop:`2px solid ${color}`,
      boxShadow:`0 0 20px ${color}10, inset 0 1px 0 rgba(255,255,255,0.05)`,
      position:"relative", overflow:"hidden",
    }}>
      {/* corner glow */}
      <div style={{position:"absolute",top:-16,right:-16,width:60,height:60,borderRadius:"50%",background:`radial-gradient(circle,${color}20,transparent 70%)`,pointerEvents:"none"}}/>
      {/* bottom accent */}
      <div style={{position:"absolute",bottom:0,left:0,right:0,height:"2px",background:`linear-gradient(90deg,transparent,${color}50,transparent)`,animation:"cin-shimmer-bg 2.5s linear infinite",backgroundSize:"200% auto"}}/>
      <div style={{fontSize:8,color:"var(--text-muted)",fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:6,position:"relative"}}>{label}</div>
      <div className="stat-val" style={{fontSize:22,fontWeight:800,fontFamily:"var(--font-mono)",color,textShadow:`0 0 14px ${color}55, 0 0 30px ${color}22`,position:"relative",lineHeight:1}}>{val}</div>
      {sub && <div style={{fontSize:9,color:"var(--text-muted)",marginTop:5,fontFamily:"var(--font-mono)",position:"relative",opacity:0.8}}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ padding:"18px 20px", animation:"cin-slide-in-up 0.35s ease" }}>
      {/* Section title */}
      <div style={{
        fontSize:10, color:"var(--text-muted)", fontFamily:"var(--font-mono)",
        letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:16,
        display:"flex", alignItems:"center", gap:12,
      }}>
        <span style={{display:"inline-block",width:3,height:14,background:"var(--amber)",borderRadius:2,boxShadow:"0 0 8px rgba(245,166,35,0.6)"}}/>
        SESSION STATISTICS
        <span style={{color:"var(--amber)",fontWeight:700,textShadow:"0 0 10px rgba(245,166,35,0.4)"}}>{results.length} PACKETS DECODED</span>
        <div style={{flex:1,height:"1px",background:"linear-gradient(90deg,rgba(245,166,35,0.2),transparent)"}}/>
      </div>

      <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:18}}>
        {sv("Total Packets", results.length, "var(--amber)")}
        {sv("Total Bits", stats.totalBits.toLocaleString(), "var(--cyan)")}
        {sv("Unique Locos", stats.locos.length, "var(--green)",
          stats.locos.length ? `IDs: ${stats.locos.slice(0,3).join(", ")}${stats.locos.length>3?"…":""}` : "none")}
        {sv("Unique Stations", stats.stations.length, "var(--purple)",
          stats.stations.length ? `IDs: ${stats.stations.slice(0,3).join(", ")}` : "none")}
        {sv("Emergencies", stats.emergencies.length, stats.emergencies.length?"var(--red)":"var(--green)",
          stats.emergencies.length?"⚠ ALERT ACTIVE":"✓ all clear")}
        {stats.speeds.length > 0 && sv("Speed Range", `${Math.min(...stats.speeds)}–${Math.max(...stats.speeds)}`, "var(--orange)",
          `avg ${(stats.speeds.reduce((a,b)=>a+b,0)/stats.speeds.length).toFixed(0)} kmph`)}
      </div>

      {/* Packet Type Distribution */}
      <div style={{fontSize:9,color:"var(--text-muted)",fontFamily:"var(--font-mono)",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.12em",display:"flex",alignItems:"center",gap:10}}>
        <span style={{display:"inline-block",width:3,height:12,background:"var(--cyan)",borderRadius:2,boxShadow:"0 0 6px rgba(0,229,255,0.5)"}}/>
        Packet Type Distribution
        <div style={{flex:1,height:"1px",background:"linear-gradient(90deg,rgba(0,229,255,0.15),transparent)"}}/>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:18}}>
        {Object.entries(stats.byType).map(([name,count],i)=>{
          const meta = Object.values(PKT_META).find(m=>m.name===name)||{color:"#6b7280",short:"?",lightColor:"#6b7280"};
          const c = isLight ? meta.lightColor : meta.color;
          return (
            <div key={i} className="kv-pkt-pill" style={{
              display:"flex", alignItems:"center", gap:7, padding:"6px 12px", borderRadius:8,
              background:`linear-gradient(135deg,${c}1e,${c}0a)`,
              border:`1px solid ${c}44`,
              boxShadow:`0 2px 8px rgba(0,0,0,0.3), 0 0 12px ${c}10`,
              transition:"all 0.2s ease",
            }}>
              <div style={{width:9,height:9,borderRadius:3,background:c,boxShadow:`0 0 6px ${c}88`}}/>
              <span style={{fontSize:10,fontFamily:"var(--font-mono)",color:c,fontWeight:800,letterSpacing:"0.05em"}}>{meta.short}</span>
              <span style={{fontSize:10,color:"var(--text-secondary)"}}>{name}</span>
              <span style={{
                fontSize:12, fontFamily:"var(--font-mono)", fontWeight:800, color:c,
                textShadow:`0 0 8px ${c}66`,
              }}>{count}×</span>
            </div>
          );
        })}
      </div>

      {stats.emergencies.length > 0 && (
        <div style={{
          background:"linear-gradient(135deg,rgba(239,68,68,0.12),rgba(239,68,68,0.06))",
          border:"1px solid rgba(239,68,68,0.4)",
          borderLeft:"3px solid #ef4444",
          borderRadius:8, padding:"12px 16px",
          boxShadow:"0 0 20px rgba(239,68,68,0.1), inset 0 0 12px rgba(239,68,68,0.04)",
          animation:"cin-glow-red 1.4s ease-in-out infinite",
        }}>
          <div style={{fontSize:11,color:"var(--red)",fontFamily:"var(--font-mono)",fontWeight:800,marginBottom:8,letterSpacing:"0.08em",display:"flex",alignItems:"center",gap:6}}>
            <span style={{animation:"loco-pulse 0.7s ease-in-out infinite"}}>⚠</span>
            EMERGENCY CONDITIONS DETECTED
          </div>
          {stats.emergencies.map((e,i)=>(
            <div key={i} style={{
              fontSize:11, color:isLight?"#991b1b":"#fca5a5", fontFamily:"var(--font-mono)",
              padding:"3px 0", borderBottom:i<stats.emergencies.length-1?"1px solid rgba(239,68,68,0.15)":"none",
              letterSpacing:"0.02em",
            }}>
              <span style={{color:"var(--red)",marginRight:6}}>PKT #{e.pkt}</span>
              <span style={{opacity:0.7}}>—</span>
              <span style={{color:"#fca5a5",marginLeft:6}}>{e.field}: {e.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TDMA FRAME TIMELINE COMPONENT
   Shows all 70 P-marker slots in the 2-second frame cycle
   Highlights the active slot if known from decoded packet
/* ═══════════════════════════════════════════════════════════════ */
function TDMATimeline({ result, isLight }) {
  const slot = (result?.fields||[]).find(f=>f.Field==="Allotted_TDMA_Timeslot"||f.Field==="STN_TDMA")?.["Decimal Value"];
  const pktType = result?.packet_type_value;

  // Slot assignments per spec (C.3.2)
  const slotInfo = {
    1: "P-marker", 46: "P-marker",
    ...Object.fromEntries([...Array(12)].map((_,i)=>[[i*2+1,(i<6?12:14)+i*2],[`MBS-${i+1}`, "Onboard Block"]]).flat()),
  };
  const SLOT_TYPES = {
    // MBS 1-12: P13–P24, P37–P48 (Onboard block section)
    // ME 1-4: P53,P54,P65,P66 (Onboard emergency)
    // SE 1-4: P55,P56,P67,P68 (Station emergency)
    // SA 1-4: P57,P58,P69,P70 (Access Authority)
  };

  const getSlotColor = (n) => {
    if (n===1||n===46) return "#6b7280"; // P-markers
    if ([53,54,65,66].includes(n)) return isLight?"#dc2626":"#ef4444"; // ME emergency
    if ([55,56,67,68].includes(n)) return isLight?"#b45309":"#f59e0b"; // SE station emergency
    if ([57,58,69,70].includes(n)) return isLight?"#7c3aed":"#8b5cf6"; // SA access authority
    if ((n>=13&&n<=24)||(n>=37&&n<=48)) return isLight?"#0284c7":"#06b6d4"; // MBS onboard
    return null;
  };

  const meta = PKT_META[pktType]||{};
  const c = isLight?(meta.lightColor||meta.color):meta.color;

  return (
    <div style={{
      padding:"12px 16px", borderBottom:"1px solid var(--divider)",
      background:"var(--panel-bg)",
      position:"relative",
    }}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:"1px",background:"linear-gradient(90deg,transparent,rgba(245,166,35,0.15),transparent)"}}/>
      <div style={{fontSize:9,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
        <span style={{color:"var(--amber)",textShadow:"0 0 8px rgba(245,166,35,0.4)"}}>⏱</span>
        <span>TDMA FRAME — 2000ms CYCLE — 70 SLOTS × 22.5ms</span>
        {slot > 0 && <span style={{color:"var(--amber)",fontWeight:700,textShadow:"0 0 10px rgba(245,166,35,0.5)",animation:"cin-glow-amber 2s ease-in-out infinite"}}>ACTIVE SLOT: P{slot}</span>}
        <div style={{marginLeft:"auto",display:"flex",gap:8,fontSize:8}}>
          {[{c:"#06b6d4",l:"Onboard Block"},{c:"#ef4444",l:"Emergency"},{c:"#f59e0b",l:"Stn Emergency"},{c:"#8b5cf6",l:"Access Auth"}].map((x,i)=>(
            <span key={i} style={{display:"flex",alignItems:"center",gap:3}}>
              <span style={{width:8,height:8,borderRadius:2,background:isLight?x.c.replace("#ef","#dc").replace("#f5","#b4"):x.c,flexShrink:0,display:"inline-block",boxShadow:`0 0 4px ${x.c}66`}}/>
              <span style={{color:"var(--text-muted)"}}>{x.l}</span>
            </span>
          ))}
        </div>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:2,alignItems:"center"}}>
        {[...Array(70)].map((_,i)=>{
          const n = i+1;
          const slotColor = getSlotColor(n);
          const isActive = n === slot;
          return (
            <div key={n} title={`P${n}${slotColor?` (${n<=24?"Onboard Block":n<=48?"Block":n<=52?"Reserved":n<=54?"ME Emergency":n<=56?"SE Emergency":n<=58?"Access Auth":n<=64?"Reserved":n<=66?"ME Emergency":n<=68?"SE Emergency":"Access Auth"})`:""}`}
              className="tdma-slot"
              style={{
                background: isActive ? c : slotColor ? slotColor+"33" : undefined,
                borderColor: isActive ? c : slotColor ? slotColor+"77" : undefined,
                color: isActive ? "#000" : slotColor ? slotColor : undefined,
                fontWeight: isActive ? 800 : 400,
                transform: isActive ? "scaleY(1.5) scale(1.1)" : undefined,
                boxShadow: isActive ? `0 0 10px ${c}, 0 0 20px ${c}44` : slotColor ? `0 0 4px ${slotColor}22` : undefined,
                transition:"all 0.15s ease",
              }}
            >{isActive ? n : n%10===0?n:""}</div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DIFF VIEW — compare two packets side by side
/* ═══════════════════════════════════════════════════════════════ */
function DiffView({ results, isLight }) {
  const [idxA, setIdxA] = useState(0);
  const [idxB, setIdxB] = useState(Math.min(1, results.length-1));

  const ra = results[idxA], rb = results[idxB];
  if (!ra || !rb) return <div style={{padding:20,color:"var(--text-muted)",fontFamily:"var(--font-mono)",fontSize:12}}>Need at least 2 packets to diff.</div>;

  const fieldsA = Object.fromEntries((ra.fields||[]).filter(f=>!f._is_section).map(f=>[f.Field.trim(),f]));
  const fieldsB = Object.fromEntries((rb.fields||[]).filter(f=>!f._is_section).map(f=>[f.Field.trim(),f]));
  const allKeys = [...new Set([...Object.keys(fieldsA),...Object.keys(fieldsB)])];
  const diffs = allKeys.map(k=>({
    key:k,
    a:fieldsA[k],
    b:fieldsB[k],
    changed: fieldsA[k]?.["Decimal Value"] !== fieldsB[k]?.["Decimal Value"],
  }));
  const changedCount = diffs.filter(d=>d.changed).length;
  const [showOnlyChanged, setShowOnlyChanged] = useState(false);
  const visible = showOnlyChanged ? diffs.filter(d=>d.changed) : diffs;

  const sel = (label, val, setVal) => (
    <select value={val} onChange={e=>setVal(Number(e.target.value))} style={{
      padding:"4px 8px", borderRadius:5, fontSize:11,
      background:"var(--bg-raised)", border:"1px solid var(--border)",
      color:"var(--text-primary)", fontFamily:"var(--font-mono)",
    }}>
      {results.map((r,i)=>(
        <option key={i} value={i}>PKT #{r.packet_index||i+1} — {PKT_META[r.packet_type_value]?.short||"?"} {r.packet_type_name}</option>
      ))}
    </select>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>
      {/* Controls */}
      <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10,flexShrink:0,background:"var(--bg-surface)"}}>
        <span style={{fontSize:11,color:"var(--text-muted)",fontFamily:"var(--font-mono)"}}>PACKET A:</span>
        {sel("A",idxA,setIdxA)}
        <span style={{fontSize:18,color:"var(--text-muted)"}}>⇄</span>
        <span style={{fontSize:11,color:"var(--text-muted)",fontFamily:"var(--font-mono)"}}>PACKET B:</span>
        {sel("B",idxB,setIdxB)}
        <div style={{
          padding:"3px 10px",borderRadius:4,fontSize:10,fontFamily:"var(--font-mono)",fontWeight:700,
          background: changedCount>0?"var(--amber-glow)":"var(--bg-raised)",
          color: changedCount>0?"var(--amber)":"var(--text-muted)",
          border:`1px solid ${changedCount>0?"var(--amber)44":"var(--border)"}`,
        }}>{changedCount} CHANGED</div>
        <label style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"var(--text-secondary)",fontFamily:"var(--font-mono)",cursor:"pointer",marginLeft:8}}>
          <input type="checkbox" checked={showOnlyChanged} onChange={e=>setShowOnlyChanged(e.target.checked)} style={{accentColor:"var(--amber)"}}/>
          Show only changed
        </label>
      </div>

      {/* Diff table */}
      <div style={{flex:1,overflowY:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"var(--font-mono)",fontSize:11,tableLayout:"fixed"}}>
          <colgroup><col style={{width:"22%"}}/><col style={{width:"39%"}}/><col style={{width:"39%"}}/></colgroup>
          <thead>
            <tr style={{borderBottom:"2px solid var(--border-bright)"}}>
              <th style={{padding:"7px 10px",textAlign:"left",background:"var(--th-bg)",color:"var(--text-muted)",fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",position:"sticky",top:0,zIndex:2}}>FIELD</th>
              <th style={{padding:"7px 10px",textAlign:"left",background: isLight?"#e8f4ff":"#0a1020",color:isLight?"#0284c7":"#06b6d4",fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",position:"sticky",top:0,zIndex:2}}>PKT A — {PKT_META[ra.packet_type_value]?.short}</th>
              <th style={{padding:"7px 10px",textAlign:"left",background: isLight?"#fff8e8":"#1a0f00",color:isLight?"#b45309":"#f59e0b",fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",position:"sticky",top:0,zIndex:2}}>PKT B — {PKT_META[rb.packet_type_value]?.short}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d,i)=>(
              <tr key={i} style={{
                background: d.changed ? (isLight?"rgba(245,158,11,0.06)":"rgba(245,158,11,0.08)") : i%2===0?"transparent":"var(--row-alt)",
                borderBottom:"1px solid var(--border)",
                borderLeft: d.changed ? "3px solid var(--amber)" : "3px solid transparent",
              }}>
                <td style={{padding:"4px 10px",color: d.changed?"var(--amber)":"var(--text-primary)",fontWeight:d.changed?600:400}}>{d.key}</td>
                <td style={{padding:"4px 10px",color:isLight?"#0369a1":"#7dd3fc"}}>
                  {d.a ? <><span style={{color:"var(--text-value)",fontWeight:600}}>{d.a["Decimal Value"]}</span><span style={{color:"var(--text-muted)",marginLeft:6,fontSize:10}}>{d.a.Description}</span></> : <span style={{color:"var(--text-dim)"}}>—</span>}
                </td>
                <td style={{padding:"4px 10px",color:isLight?"#b45309":"#fbbf24"}}>
                  {d.b ? <><span style={{color:"var(--text-value)",fontWeight:600}}>{d.b["Decimal Value"]}</span><span style={{color:"var(--text-muted)",marginLeft:6,fontSize:10}}>{d.b.Description}</span></> : <span style={{color:"var(--text-dim)"}}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LIVE FEED TAB — embedded inside DECODEX
   WebSocket connects to ws://localhost:8000/ws/live
   Receives packets from ANY source (Simulator, external tool, etc.)
/* ═══════════════════════════════════════════════════════════════ */
const SOURCE_COLORS = {
  "manual-ui":"#8b5cf6","external":"#06b6d4","simulator":"#10b981",
  "mqtt":"#f59e0b","websocket":"#06b6d4",
  "SVK_SIM":"#22d3ee","serial_tx":"#a855f7","serial_rx":"#ec4899",
  "dmi-loco":"#10b981","dmi-station":"#10b981",
  "log-tx":"#a855f7","log-rx":"#ec4899",
};
/* LIVE source groups (toolbar filter) */
const LIVE_SOURCES = [
  ["all", "All sources"],
  ["SVK_SIM", "SVK SIM · UDP/HTTP"],
  ["serial_tx", "Serial TX (station → loco)"],
  ["serial_rx", "Serial RX (radio)"],
  ["sim", "Packet Simulator"],
  ["log", "Log replay (Simulator)"],
  ["other", "External / other"],
];
function liveSourceGroup(src) {
  if (src === "SVK_SIM" || src === "serial_tx" || src === "serial_rx") return src;
  if (src === "simulator" || String(src || "").startsWith("dmi-")) return "sim";
  if (String(src || "").startsWith("log-")) return "log";
  return "other";
}

function LiveFeedRow({ pkt, isLight }) {
  const [expanded, setExpanded] = useState(false);
  const meta = PKT_META[pkt.packet_type_value]||{name:"Unknown",short:"?",color:"#6b7280",icon:"📦"};
  const color = isLight?(meta.lightColor||meta.color):meta.color;
  const srcColor = SOURCE_COLORS[pkt.source]||"#6b7280";
  const fields = pkt.fields||[];
  const getF = (n) => fields.find(f=>(f.Field||"").trim()===n);
  const speed = getF("TRAIN_SPEED");
  const mode  = getF("LOCO_MODE");
  const emerg = getF("EMERGENCY_STATUS")||getF("GEN_SOS_CALL");
  const frame = getF("FRAME_NUM");
  const locoId= getF("SOURCE_LOCO_ID");
  const stnId = getF("SOURCE_STN_ID")||getF("SOURCE_STN_ILC_IBS_ID");
  const crc   = pkt.crc_check;
  const emergActive = emerg && typeof emerg["Decimal Value"]==="number" && emerg["Decimal Value"]>0;
  const fieldCount  = fields.filter(f=>!f._is_section).length;
  const GC = isLight ? GROUP_COLOR_LIGHT : GROUP_COLOR_DARK;

  return (
    <div style={{
      borderBottom:`1px solid var(--border)`,
      borderLeft:`3px solid ${emergActive?"var(--red)":color}`,
      background: emergActive?"rgba(239,68,68,0.04)":"transparent",
      animation:"row-in 0.25s ease forwards",
    }}>
      {/* Summary row */}
      <div
        onClick={()=>setExpanded(e=>!e)}
        style={{
          display:"grid",
          gridTemplateColumns:"40px 72px 76px 1fr 90px 90px 90px 54px 44px",
          alignItems:"center", gap:"0 6px", padding:"5px 12px",
          cursor:"pointer", userSelect:"none",
        }}
      >
        <span style={{fontSize:9,color:"var(--text-muted)",fontFamily:"var(--font-mono)",textAlign:"right"}}>#{pkt.packet_index}</span>
        <span style={{fontSize:10,color:"var(--text-secondary)",fontFamily:"var(--font-mono)"}}>{pkt.received_at_iso||"--:--:--"}</span>
        <span style={{
          display:"inline-flex",alignItems:"center",gap:3,padding:"1px 6px",borderRadius:3,
          fontSize:9,fontFamily:"var(--font-mono)",fontWeight:700,
          background:`${color}18`,color,border:`1px solid ${color}44`,
        }}><span>{meta.icon}</span>{meta.abbr||meta.short}</span>
        <span style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--text-secondary)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {locoId?<span style={{color:"var(--cyan)"}}>Loco #{locoId["Decimal Value"]}</span>
          :stnId?<span style={{color:"var(--purple)"}}>Stn #{stnId["Decimal Value"]}</span>
          :<span style={{color:"var(--text-muted)"}}>—</span>}
          {frame&&<span style={{color:"var(--text-muted)",marginLeft:8,fontSize:10}}>{frame.Description}</span>}
        </span>
        <span style={{fontSize:11,fontFamily:"var(--font-mono)"}}>
          {speed&&typeof speed["Decimal Value"]==="number"&&speed["Decimal Value"]<=400
            ?<span style={{color:"var(--amber)",fontWeight:700}}>{speed["Decimal Value"]} kmph</span>
            :<span style={{color:"var(--text-muted)"}}>—</span>}
        </span>
        <span style={{fontSize:10,color:"var(--text-secondary)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {mode?mode.Description:"—"}
        </span>
        <span style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap"}}>
          {emergActive&&<span style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:"rgba(239,68,68,0.15)",color:"var(--red)",border:"1px solid #ef444433",fontFamily:"var(--font-mono)",fontWeight:700}}>⚠ EMRG</span>}
          {crc&&<span style={{fontSize:8,padding:"1px 5px",borderRadius:3,fontFamily:"var(--font-mono)",fontWeight:700,background:crc.match===true?(isLight?"#dcfce7":"#10b98118"):(isLight?"#fee2e2":"#ef444418"),color:crc.match===true?"var(--green)":"var(--red)",border:`1px solid ${crc.match===true?"#10b98133":"#ef444433"}`}}>{crc.match===true?"✓CRC":"✗CRC"}</span>}
        </span>
        <span style={{fontSize:8,padding:"1px 5px",borderRadius:3,fontFamily:"var(--font-mono)",fontWeight:700,background:`${srcColor}15`,color:srcColor,border:`1px solid ${srcColor}33`,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pkt.source||"?"}</span>
        <button onClick={e=>{e.stopPropagation();setExpanded(x=>!x);}} style={{
          background:"none",border:`1px solid var(--border)`,borderRadius:3,cursor:"pointer",
          fontSize:9,padding:"2px 5px",color:"var(--text-muted)",fontFamily:"var(--font-mono)",
          transition:"all 0.15s",
        }}
        onMouseEnter={e=>{e.currentTarget.style.color="var(--amber)";e.currentTarget.style.borderColor="var(--amber)";}}
        onMouseLeave={e=>{e.currentTarget.style.color="var(--text-muted)";e.currentTarget.style.borderColor="var(--border)";}}
        >{expanded?"▲":`▼ ${fieldCount}`}</button>
      </div>

      {/* Expanded decoded fields */}
      {expanded && (
        <div style={{borderTop:`1px solid var(--border)`,background:isLight?"#f8f8ff":"#09090f",maxHeight:380,overflowY:"auto"}}>
          <FieldTable fields={fields} isLight={isLight} searchQuery="" showBits={false} />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PROFILE VISUALIZER  —  Tab inside Decodex main page
   Source: decoded C.4.2 (Station→Loco Regular) result.
   Draws a distance-based track map from LAST_REF_RFID (0 m) to
   end of Movement Authority, showing all sub-packet layers:
     ① Movement Authority  ② Static Speed Profile
     ③ Gradient Profile    ④ LC Gate Profile
     ⑤ Turnout Speed       ⑥ Tag Linking Information
     ⑦ Track Conditions    ⑧ Temp Speed Restrictions
   Spec: RDSO/SPN/196/2020 Annexure-C §C.4.2
═══════════════════════════════════════════════════════════════ */

/* ── Colour palette for each layer ── */
const PV_COLORS = {
  ma:   "#22d3ee",
  ssp:  "#34d399",
  grad: "#fbbf24",
  lc:   "#fb923c",
  to:   "#a78bfa",
  tli:  "#f472b6",
  tc:   "#2dd4bf",
  tsr:  "#f87171",
  rfid: "#bef264",
};

/* Decode AUTHORIZED_SPEED raw→kmph (value×5, 62→8) */
function pvSpd(v) {
  if (v===0) return 0;
  if (v===62) return 8;
  if (v<=50) return v*5;
  return 0;
}

/* Extract all profile layers from decoded fields of a C.4.2 result.
   Field names match EXACTLY what decodeSSP/decodeGrad/decodeLC/decodeTurnout/
   decodeTagLink/decodeTC/decodeTSR emit via the R() helper.

   Per Annexure-C §C.4.2:
   • LM_Static_Speed_Distance (→ Distance[i]) = cumulative dist to END of zone
     → seg i runs from dist[i-1] (or 0) TO dist[i] at speed[i]
   • Same convention for Gradient Distance[i]
   • LC_Dist[i] = start position of gate
   • DIFF_DIST[i] = start of turnout
   • TSR_Dist[i] = start, TSR_Len[i] = length
   • Track Condition: START_DIST[i], LENGTH[i]
*/
function extractProfile(fields) {
  /* ── Normalise section header name ── */
  const normSec = s => String(s||"").trim()
    .replace(/^──+\s*/,"").replace(/\s*──+$/,"").trim().toUpperCase();

  /* ── Safe numeric ── */
  const numV = f => (f && f["Decimal Value"] != null) ? Number(f["Decimal Value"]) : null;

  /* ── Header fields (top-level, before any sub-packet section) ──
     Accept both JS decoder names and backend names (aliases).     */
  const hdr = {};
  // Multi-alias lookup: first alias found wins
  const HDR_ALIASES = {
    "LAST_REF_RFID":      ["LAST_REF_RFID","LAST_REFERENCE_RFID","LAST_REF_RFID_TAG"],
    "DIST_PKT_START":     ["DIST_PKT_START","DIST_PKT_STRT","DISTANCE_PKT_START"],
    "PKT_DIR":            ["PKT_DIR","PACKET_DIR","PACKET_DIRECTION"],
    "DEST_LOCO_ID":       ["DEST_LOCO_ID","DESTINATION_LOCO_ID"],
    "SOURCE_STN_ID":      ["SOURCE_STN_ID","SOURCE_STN_ILC_IBS_ID","SOURCE_STATION_ID","STN_ID"],
    "CUR_SIG_ASPECT":     ["CUR_SIG_ASPECT","CUR_SIG_ASP","CURRENT_SIG_ASPECT","CURRENT_SIGNAL_ASPECT"],
    "CUR_SIG_INFO":       ["CUR_SIG_INFO","CURRENT_SIG_INFO"],
    "NEXT_SIG_ASPECT":    ["NEXT_SIG_ASPECT","NEXT_SIG_ASP","NEXT_SIGNAL_ASPECT"],
    "APPR_SIG_DIST":      ["APPR_SIG_DIST","APPR_SIG_DISTANCE","APPROACHING_SIG_DIST"],
    "AUTHORITY_TYPE":     ["AUTHORITY_TYPE","AUTH_TYPE","AUTHORITY_TYPE_VALUE"],
    "AUTHORIZED_SPEED":   ["AUTHORIZED_SPEED","AUTHORISED_SPEED","AUTH_SPEED","AUTHRISED_SPEED"],
    "MA_W_R_T_SIG":       ["MA_W_R_T_SIG","MA_WRT_SIG","MA_WITH_RESPECT_TO_SIG","MA_W_R_T_SIGNAL"],
  };
  for (const f of fields) {
    const fn = (f.Field||"").trim();
    for (const [key, aliases] of Object.entries(HDR_ALIASES)) {
      if (!(key in hdr) && aliases.includes(fn)) { hdr[key] = numV(f); break; }
    }
  }

  const refRFID   = hdr["LAST_REF_RFID"]  ?? null;
  const distStart = hdr["DIST_PKT_START"] ?? 0;
  const pktDir    = hdr["PKT_DIR"]        ?? 0;
  const destLoco  = hdr["DEST_LOCO_ID"]   ?? null;
  const stnId     = hdr["SOURCE_STN_ID"]  ?? null;
  const curSigAsp = hdr["CUR_SIG_ASPECT"] ?? null;
  const authSpeedR= hdr["AUTHORIZED_SPEED"];
  const authSpeed = authSpeedR!=null ? pvSpd(authSpeedR) : 0;
  const sigPos    = hdr["APPR_SIG_DIST"]  ?? 0;
  const authType  = hdr["AUTHORITY_TYPE"] ?? 0;
  const maWRT     = hdr["MA_W_R_T_SIG"]   ?? 0;
  const maEnd     = sigPos + (maWRT>0 && maWRT<65535 ? maWRT : 0);

  /* ── collect DEST_LOCO_SOS and TRAIN_SECTION_TYPE from MA sub-packet fields ── */
  let destLocoSos = 0, trainSectionType = null, frameOffset = null;
  const MA_ALIASES = {
    DEST_LOCO_SOS:      ["DEST_LOCO_SOS","DEST_LOCO_SOS_CODE"],
    TRAIN_SECTION_TYPE: ["TRAIN_SECTION_TYPE","TRAIN_SEC_TYPE","SECTION_TYPE"],
    FRAME_OFFSET:       ["FRAME_OFFSET","FRAME_OFFS"],
  };
  for (const f of fields) {
    const fn = (f.Field||"").trim();
    if (destLocoSos===0 && MA_ALIASES.DEST_LOCO_SOS.includes(fn)) destLocoSos = numV(f) ?? 0;
    if (trainSectionType===null && MA_ALIASES.TRAIN_SECTION_TYPE.includes(fn)) trainSectionType = numV(f);
    if (frameOffset===null && MA_ALIASES.FRAME_OFFSET.includes(fn)) frameOffset = numV(f);
  }

  /* ── Single-pass: collect rows per section ── */
  /* Section names EXACTLY as emitted by SEC() calls in decoders.
     normSec() uppercases and strips decorators, so backend names
     like "Static Speed Profile" → "STATIC SPEED PROFILE" match.  */
  const SEC_MA   = "MOVEMENT AUTHORITY";
  const SEC_SSP  = "STATIC SPEED PROFILE";
  const SEC_GRAD = "GRADIENT PROFILE";
  const SEC_LC   = "LC GATE PROFILE";
  const SEC_TO   = "TURNOUT SPEED PROFILE";
  const SEC_TLI  = "TAG LINKING INFORMATION";
  const SEC_TC   = "TRACK CONDITION DATA";
  const SEC_TSR  = "TEMP SPEED RESTRICTIONS";

  /* Backend may use slightly different section names — map them */
  const SEC_ALIAS = {
    "LC GATE PROFILE":           ["LC GATE PROFILE","LC GATE","LEVEL CROSSING GATE PROFILE"],
    "TURNOUT SPEED PROFILE":     ["TURNOUT SPEED PROFILE","TURNOUT PROFILE","TURNOUT"],
    "TAG LINKING INFORMATION":   ["TAG LINKING INFORMATION","TAG LINKING INFO","TLI","TAG LINKING"],
    "TRACK CONDITION DATA":      ["TRACK CONDITION DATA","TRACK CONDITION","TRACK CONDITIONS"],
    "TEMP SPEED RESTRICTIONS":   ["TEMP SPEED RESTRICTIONS","TEMPORARY SPEED RESTRICTIONS","TSR","TEMP SPEED RESTRICTION"],
    "GRADIENT PROFILE":          ["GRADIENT PROFILE","GRADIENT"],
    "STATIC SPEED PROFILE":      ["STATIC SPEED PROFILE","SSP","STATIC SPEED"],
    "MOVEMENT AUTHORITY":        ["MOVEMENT AUTHORITY","MA","MOVEMENT AUTHORITY PACKET"],
  };

  let curSec = null;
  let curSecAlreadySeen = false;   // skip duplicate sub-packets of same type
  const secRows = {};
  for (const f of fields) {
    if (f._is_section) {
      const rawNorm = normSec(f.Field);
      // Find canonical section name via alias lookup
      let found = rawNorm;
      for (const [canonical, aliases] of Object.entries(SEC_ALIAS)) {
        if (aliases.includes(rawNorm)) { found = canonical; break; }
      }
      // Per spec each sub-packet type appears AT MOST ONCE per packet.
      // If a second occurrence appears (e.g. backend bug / future extension),
      // ignore it completely so we never get doubled segment arrays.
      if (secRows[found]) {
        curSec = null;
        curSecAlreadySeen = true;
      } else {
        curSec = found;
        curSecAlreadySeen = false;
        secRows[curSec] = [];
      }
      continue;
    }
    if (curSec && !curSecAlreadySeen) {
      secRows[curSec].push(f);
    }
  }

  /* ── Helper: find non-indexed field in a section (multi-name) ── */
  const inSec = (sec, ...names) => {
    const rows = secRows[sec] || [];
    for (const name of names) {
      const f = rows.find(r => (r.Field||"").trim() === name);
      if (f) return numV(f);
    }
    return null;
  };

  /* ── Helper: find indexed field — handles both formats:
       JS decoder:  "  Name[i]"  (trimmed → "Name[i]")
       Backend:     "Name[i]" or "LM_FULL_NAME[i]"
     Pass primary name first, then aliases.                     ── */
  const idx = (sec, i, ...names) => {
    const rows = secRows[sec] || [];
    for (const name of names) {
      const target = `${name}[${i}]`;
      const f = rows.find(r => (r.Field||"").trim() === target);
      if (f) return numV(f);
    }
    return null;
  };

  /* ── SSP ──────────────────────────────────────────────────────
     JS decoder emits:  SPEED_INFO_CNT, Distance[i], Class[i], Speed[i] / Speed_A[i]…
     Backend may emit:  LM_Speed_Info_CNT, LM_Static_Speed_Distance[i],
                        LM_Static_Speed_Class[i], LM_Static_Speed_Value[i]
     Distance[i] = cumulative END of that speed zone (always increasing from 0).
     Segment i runs from dist[i-1] (or 0) to dist[i] at Speed[i].            */
  const sspCnt = inSec(SEC_SSP, "SPEED_INFO_CNT", "LM_Speed_Info_CNT", "LM_SPEED_INFO_CNT", "SPEED_CNT") ?? 0;
  const ssp = [];
  let sspPrev = 0;
  for (let i=1; i<=sspCnt; i++) {
    const endDist = idx(SEC_SSP, i, "Distance", "LM_Static_Speed_Distance", "LM_STATIC_SPEED_DISTANCE", "STATIC_SPEED_DISTANCE");
    if (endDist==null) break;
    const cl = idx(SEC_SSP, i, "Class", "LM_Static_Speed_Class", "LM_STATIC_SPEED_CLASS", "SPEED_CLASS") ?? 0;
    let spdRaw;
    if (cl===0) {
      spdRaw = idx(SEC_SSP, i, "Speed", "LM_Static_Speed_Value", "LM_STATIC_SPEED_VALUE", "SPEED_VALUE", "Universal_Speed", "Speed_Universal");
    } else {
      spdRaw = idx(SEC_SSP, i, "Speed_A", "LM_Static_Speed_A", "LM_Static_Speed_Value_A", "ClassA_Speed", "Speed_ClassA")
            ?? idx(SEC_SSP, i, "Speed_B", "LM_Static_Speed_B", "LM_Static_Speed_Value_B", "ClassB_Speed", "Speed_ClassB");
    }
    const speed = spdRaw!=null ? pvSpd(spdRaw) : 0;
    // endDist must always be greater than previous (left-to-right only)
    if (endDist > sspPrev) {
      ssp.push({ startDist: sspPrev, endDist, speed });
      sspPrev = endDist;
    } else if (endDist === sspPrev && ssp.length > 0) {
      // zero-length segment — skip silently
    }
  }

  /* ── Gradient ──────────────────────────────────────────────────
     JS decoder emits:  GRAD_INFO_CNT, Distance[i], GDIR[i], GRADIENT[i]
       → Distance[i] = cumulative END of that gradient zone (always increasing from 0).
     Backend may emit:  LM_Grad_Info_CNT, LM_Gradient_Distance[i], LM_GDIR[i], LM_GRADIENT_VALUE[i]
       → LM_Gradient_Distance[i] = individual segment LENGTH (not cumulative).
     We detect which convention is used by checking if values are monotonically increasing. */
  const gradCnt = inSec(SEC_GRAD, "GRAD_INFO_CNT", "LM_Grad_Info_CNT", "LM_GRAD_INFO_CNT", "GRAD_CNT") ?? 0;
  const gradEntries = [];

  /* First pass: collect raw distances to detect convention */
  const rawGradDists = [];
  for (let i=1; i<=gradCnt; i++) {
    const d = idx(SEC_GRAD, i, "Distance", "LM_Gradient_Distance", "LM_GRADIENT_DISTANCE", "GRADIENT_DISTANCE");
    if (d == null) break;
    rawGradDists.push(d);
  }

  /* Detect if backend emits per-segment lengths (non-monotonic) vs cumulative (monotonic) */
  let isGradCumulative = true;
  for (let i=1; i<rawGradDists.length; i++) {
    if (rawGradDists[i] < rawGradDists[i-1]) { isGradCumulative = false; break; }
  }
  /* Also treat as non-cumulative if all values repeat or second < first */
  if (rawGradDists.length >= 2 && rawGradDists[1] <= rawGradDists[0] && rawGradDists[1] > 0) {
    isGradCumulative = false;
  }

  let gradPrev = 0;
  for (let i=0; i<rawGradDists.length; i++) {
    const rawDist = rawGradDists[i];
    const dir  = idx(SEC_GRAD, i+1, "GDIR", "LM_GDIR", "LM_GRADIENT_DIR", "GRAD_DIR", "GRADIENT_DIR") ?? 0;
    const grad = idx(SEC_GRAD, i+1, "GRADIENT", "LM_GRADIENT_VALUE", "LM_GRADIENT", "GRADIENT_VALUE") ?? 0;
    let endDist;
    if (isGradCumulative) {
      endDist = rawDist;
      if (endDist > gradPrev) {
        gradEntries.push({ startDist: gradPrev, endDist, isUp: dir===1, grad });
        gradPrev = endDist;
      }
    } else {
      /* Per-segment length — accumulate */
      const segLen = Math.max(rawDist, 0);
      endDist = gradPrev + segLen;
      gradEntries.push({ startDist: gradPrev, endDist, isUp: dir===1, grad });
      gradPrev = endDist;
    }
  }

  /* ── LC Gates ──────────────────────────────────────────────────
     JS decoder: LC_INFO_CNT, LC_Dist[i], LC_ID[i], Manning[i], LC_Class[i]
     Backend:    LM_LC_Info_CNT, LM_LC_Distance[i], LM_LC_ID_Numeric[i], LM_LC_Manning_Type[i] */
  const lcCnt = inSec(SEC_LC, "LC_INFO_CNT", "LM_LC_Info_CNT", "LM_LC_INFO_CNT", "LC_CNT") ?? 0;
  const lcGates = [];
  for (let i=1; i<=lcCnt; i++) {
    const dist = idx(SEC_LC, i, "LC_Dist", "LM_LC_Distance", "LM_LC_DISTANCE", "LC_DISTANCE");
    if (dist==null) break;
    const id      = idx(SEC_LC, i, "LC_ID", "LM_LC_ID_Numeric", "LM_LC_ID", "LC_ID_NUMERIC") ?? i;
    const manning = idx(SEC_LC, i, "Manning", "LM_LC_Manning_Type", "LM_LC_MANNING_TYPE", "LC_MANNING");
    const lcClass = idx(SEC_LC, i, "LC_Class", "LM_LC_Class", "LM_LC_CLASS");
    lcGates.push({ dist, id, manned: manning===0 || manning==null, lcClass });
  }

  /* ── Turnouts ──────────────────────────────────────────────────
     JS decoder: TO_CNT, TO_SPEED[i], DIFF_DIST[i], REL_DIST[i]
     Backend:    TO_CNT, TO_SPEED[i], DIFF_DIST_TO[i], TO_SPEED_REL_DIST[i]           */
  const toCnt = inSec(SEC_TO, "TO_CNT", "TURNOUT_CNT") ?? 0;
  const turnouts = [];
  for (let i=1; i<=toCnt; i++) {
    const dist = idx(SEC_TO, i, "DIFF_DIST", "DIFF_DIST_TO", "LM_DIFF_DIST", "TURNOUT_DIST");
    if (dist==null) break;
    const rawSpd  = idx(SEC_TO, i, "TO_SPEED", "TURNOUT_SPEED") ?? 0;
    const relDist = idx(SEC_TO, i, "REL_DIST", "TO_SPEED_REL_DIST", "TO_REL_DIST") ?? 0;
    /* TO_SPEED: 0=NotUsed, 1-18 = N*5 kmph, 31=Unrestricted */
    const speed = rawSpd===0?0 : rawSpd===31?250 : rawSpd*5;
    turnouts.push({ dist, speed, relDist });
  }

  /* ── TLI — RFID tags ────────────────────────────────────────────
     JS decoder: ROUTE_RFID_CNT, DIST_NXT_RFID[i], NXT_RFID_ID[i]
     Backend:    ROUTE_RFID_CNT, DIST_NXT_RFID[i], NXT_RFID_TAG_ID[i]
     DIST_NXT_RFID[i] = distance FROM previous tag (inter-tag gap).
     We accumulate cumulative distance.                                       */
  const rfidCnt = inSec(SEC_TLI, "ROUTE_RFID_CNT") ?? 0;
  const rfidTags = [];
  let cumRfid = 0;
  for (let i=1; i<=rfidCnt; i++) {
    const dist = idx(SEC_TLI, i, "DIST_NXT_RFID", "DIST_NEXT_RFID", "NXT_RFID_DIST");
    if (dist==null) break;
    const id = idx(SEC_TLI, i, "NXT_RFID_ID", "NXT_RFID_TAG_ID", "NEXT_RFID_ID", "NXT_RFID_TAG") ?? i;
    cumRfid += dist;
    rfidTags.push({ dist, cumDist: cumRfid, id });
  }

  /* ── Track Conditions ──────────────────────────────────────────
     JS decoder: TRACKCOND_CNT, TYPE[i], START_DIST[i], LENGTH[i]
     Backend:    TRACKCOND_CNT, TRACKCOND_TYPE[i], START_DIST_TRACKCOND[i], LENGTH_TRACKCOND[i] */
  const tcCnt = inSec(SEC_TC, "TRACKCOND_CNT", "TRACK_COND_CNT") ?? 0;
  const TC_NAME = {
    0:"Not used",1:"Dead Stop",2:"Radio Hole",3:"Non-Stop Area",
    4:"Tunnel Stop",5:"Neutral Section",6:"Sound Horn",
    7:"Reversing Area",8:"Fouling Mark",9:"KAVACH Exit",
  };
  const trackConds = [];
  for (let i=1; i<=tcCnt; i++) {
    const type  = idx(SEC_TC, i, "TYPE", "TRACKCOND_TYPE", "TRACK_COND_TYPE");
    if (type==null) break;
    const start = idx(SEC_TC, i, "START_DIST", "START_DIST_TRACKCOND", "START_DIST_TRACK_COND", "TRACK_COND_START") ?? 0;
    const len   = idx(SEC_TC, i, "LENGTH", "LENGTH_TRACKCOND", "LENGTH_TRACK_COND", "TRACK_COND_LENGTH") ?? 0;
    trackConds.push({ type, typeName: TC_NAME[type]||`Type${type}`, start, length: len });
  }

  /* ── TSR ────────────────────────────────────────────────────────
     JS decoder: TSR_STATUS, TSR_CNT, TSR_ID[i], TSR_Dist[i], TSR_Len[i], TSR_Class[i], TSR_Speed[i]
     Backend:    TSR_STATUS, TSR_Info_CNT, TSR_ID[i], TSR_Distance[i], TSR_Length[i], TSR_Class[i], TSR_Universal_Speed[i] */
  const tsrStatus  = inSec(SEC_TSR, "TSR_STATUS");
  const tsrEntries = [];
  if (tsrStatus===2) {
    const tsrCnt = inSec(SEC_TSR, "TSR_CNT", "TSR_Info_CNT", "TSR_INFO_CNT") ?? 0;
    for (let i=1; i<=tsrCnt; i++) {
      const dist   = idx(SEC_TSR, i, "TSR_Dist", "TSR_Distance", "TSR_DIST");
      if (dist==null) break;
      const len    = idx(SEC_TSR, i, "TSR_Len", "TSR_Length", "TSR_LEN") ?? 0;
      const tsrId  = idx(SEC_TSR, i, "TSR_ID") ?? i;
      const cl     = idx(SEC_TSR, i, "TSR_Class", "TSR_CLASS") ?? 0;
      let spdRaw;
      if (cl===0) {
        spdRaw = idx(SEC_TSR, i, "TSR_Speed", "TSR_Universal_Speed", "TSR_UNIVERSAL_SPEED", "TSR_SPEED");
      } else {
        spdRaw = idx(SEC_TSR, i, "TSR_SpdA", "TSR_ClassA_Speed", "TSR_CLASS_A_SPEED", "TSR_Universal_Speed");
      }
      tsrEntries.push({
        dist, id: tsrId, length: len,
        speed: spdRaw!=null ? pvSpd(spdRaw) : 0,
      });
    }
  }

  /* ── World extent ──
     maxDist = furthest real data point (SSP, gradient, TLI, LC, TO, TC, TSR).
     MA end (sigPos + maWRT) is intentionally excluded — it can extend far
     beyond actual profile data and would leave a large empty area on the right.
     The MA/EOA line is still drawn and clipped to the data extent if needed.  */
  const dataOnlyDists = [
    ...ssp.map(x=>x.endDist),
    ...gradEntries.map(x=>x.endDist),
    ...rfidTags.map(x=>x.cumDist),
    ...lcGates.map(x=>x.dist),
    ...turnouts.map(x=>x.dist),
    ...trackConds.map(x=>x.start+x.length),
    ...tsrEntries.map(x=>x.dist+x.length),
  ].filter(v=>v!=null && !isNaN(v) && v>0);

  /* Fall back to maEnd only if there is genuinely no other data */
  const dataMax = dataOnlyDists.length > 0 ? Math.max(...dataOnlyDists) : 0;
  const maxDist = Math.max(500, dataMax > 0 ? dataMax : (sigPos > 0 ? sigPos + maWRT : 500));

  return {
    refRFID, distStart, pktDir, destLoco, stnId,
    curSigAsp, sigPos, maEnd, authType, authSpeed, maWRT,
    destLocoSos, trainSectionType, frameOffset,
    ssp, gradEntries, lcGates, turnouts, rfidTags, trackConds, tsrEntries,
    maxDist,
  };
}

/* ── Signal aspect code → label ── */
const PV_SIG_ASP = {
  0:"Undef", 1:"🔴 Red", 2:"🟡 Yellow",
  10:"🟡🟡 Dbl Yel", 11:"🟢 Green",
  14:"AG OFF", 15:"🔴+C Calling-On", 48:"Stop Board",
};

/* ── Authority type label ── */
const PV_AUTH = { 0:"—", 1:"OS (On-Sight)", 2:"FS (Full Sup.)", 3:"SR (Staff Resp.)" };

/* ─── Main ProfileVisualizer component ──────────────────────── */
/* ═══════════════════════════════════════════════════════════════
   PROFILE VISUALIZER  —  Multi-layer distance/speed chart
   X = distance from Ref RFID (m)   Y = speed (kmph)
   Layers: MA · SSP (step-function) · Gradient · TSR · LC Gate · Turnout · TLI · Track Conditions
   Hover tooltips on every dot.  Toggle layers via legend buttons.
   Spec: RDSO/SPN/196/2020 Annexure-C §C.4.2
═══════════════════════════════════════════════════════════════ */

/* ─── ProfileVisualizer — Premium Animated Chart ──────────────────────────
   SVG-based distance/speed chart with:
   • CSS keyframe draw-on animation for every line/path (strokeDashoffset)
   • Glowing neon strokes on dark mode, crisp bold on light mode
   • Gradient fills under SSP and MA zones
   • Animated dots that pop in with scale transforms
   • Per-segment glow pulses on hover
   • Smooth terrain wave for gradient profile
   • Crosshair cursor tracker that snaps to nearest feature
═══════════════════════════════════════════════════════════════════════════ */

/* Inject chart-specific CSS animations once */
const PV_ANIM_CSS = `
@keyframes pv-draw {
  from { stroke-dashoffset: var(--pv-len, 9999); }
  to   { stroke-dashoffset: 0; }
}
@keyframes pv-dot-pop {
  0%   { transform: scale(0); opacity:1; }
  60%  { transform: scale(1.35); opacity:1; }
  100% { transform: scale(1); opacity:1; }
}
@keyframes pv-fill-fade {
  from { opacity:0; }
  to   { opacity:1; }
}
@keyframes pv-glow-pulse {
  0%,100% { filter: drop-shadow(0 0 3px currentColor); }
  50%      { filter: drop-shadow(0 0 10px currentColor); }
}
@keyframes pv-scan {
  from { transform: translateX(0); opacity:0.6; }
  to   { transform: translateX(var(--pv-scan-w, 1200px)); opacity:0; }
}
@keyframes pv-badge-in {
  from { opacity:0; transform:translateY(-4px); }
  to   { opacity:1; transform:translateY(0); }
}
.pv-draw       { animation: pv-draw 1.4s cubic-bezier(0.4,0,0.2,1) forwards; }
.pv-draw-fast  { animation: pv-draw 0.8s cubic-bezier(0.4,0,0.2,1) forwards; }
.pv-dot        { animation: pv-dot-pop 0.45s cubic-bezier(0.34,1.56,0.64,1) both; opacity:1; }
.pv-dot.pv-done { animation: none !important; opacity: 1 !important; transform: scale(1) !important; }
.pv-dot:hover  { opacity: 1 !important; transform: scale(1.15) !important; }
.pv-fill       { animation: pv-fill-fade 0.9s ease forwards; opacity:0; }
.pv-badge      { animation: pv-badge-in 0.35s ease forwards; }
.pv-scan-line  { animation: pv-scan 2s ease-out forwards; }
.pv-glow       { animation: pv-glow-pulse 2.5s ease-in-out infinite; }
`;

function ProfileVisualizer({ result, isLight }) {
  const isC42 = result && result.packet_type_value === 9;

  const prof = useMemo(() => {
    if (!isC42) return null;
    return extractProfile(result.fields || []);
  }, [result, isC42]);

  const [vis, setVis]     = useState({ ma:true, ssp:true, grad:true, tsr:true, tc:true, lc:true, to:true, tli:true });
  const [tip, setTip]     = useState(null);
  const [animKey, setAnimKey] = useState(0);   // bump to re-trigger animations
  const crossXRef = useRef(null);              // crosshair X — DOM-updated, no state
  const crossGRef = useRef(null);             // ref to the crosshair <g> element
  const svgRef = useRef(null);

  // ── Zoom / Pan state ──
  // zoomRange = [viewStart, viewEnd] in metres (within [0, maxDist])
  const [zoomRange, setZoomRange] = useState(null);   // null = full view
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef(null);   // { clientX, viewStart, viewEnd }
  const zoomContainerRef = useRef(null);
  const mmDragRef = useRef(null);     // { clientX, viewStart, viewEnd } for minimap drag

  // Re-animate whenever the decoded packet changes
  const prevResult = useRef(null);
  useEffect(() => {
    if (result !== prevResult.current) {
      prevResult.current = result;
      setAnimKey(k => k + 1);
      // Don't reset zoom here — the auto-zoom effect will handle it
    }
  }, [result]);

  const toggle = k => { setVis(v => ({...v, [k]:!v[k]})); setAnimKey(k2 => k2+1); };

  /* ── Auto-zoom: when data range is very tight (< 2000m), zoom in automatically ── */
  useEffect(() => {
    if (!prof) { setZoomRange(null); return; }
    const totalRange = prof.maxDist;
    // If data spans less than 2000m, auto-zoom to show it with some padding
    if (totalRange > 0 && totalRange < 2000) {
      const pad = Math.max(50, totalRange * 0.08);
      setZoomRange([0, Math.min(prof.maxDist + pad, prof.maxDist * 1.1 + 100)]);
    } else {
      setZoomRange(null);
    }
    setAnimKey(k => k + 1);
  }, [prof]);

  /* ── Zoom helpers ── */
  const getViewRange = useCallback(() => {
    const md = prof?.maxDist || 500;
    if (!zoomRange) return [0, md];
    return [Math.max(0, zoomRange[0]), Math.min(md * 1.05 + 200, zoomRange[1])];
  }, [zoomRange, prof]);

  const handleZoomIn = useCallback(() => {
    const md = prof?.maxDist || 500;
    const [vs, ve] = getViewRange();
    const mid = (vs + ve) / 2;
    const newHalf = Math.max(50, (ve - vs) / 2 * 0.55);
    setZoomRange([Math.max(0, mid - newHalf), Math.min(md * 1.05 + 200, mid + newHalf)]);
    setAnimKey(k => k + 1);
  }, [getViewRange, prof]);

  const handleZoomOut = useCallback(() => {
    const md = prof?.maxDist || 500;
    const [vs, ve] = getViewRange();
    const mid = (vs + ve) / 2;
    const newHalf = Math.min(md * 0.6, (ve - vs) / 2 * 1.8);
    const newStart = Math.max(0, mid - newHalf);
    const newEnd   = Math.min(md * 1.05 + 200, mid + newHalf);
    if (newEnd - newStart >= md * 0.95) { setZoomRange(null); }
    else setZoomRange([newStart, newEnd]);
    setAnimKey(k => k + 1);
  }, [getViewRange, prof]);

  const handleZoomReset = useCallback(() => {
    setZoomRange(null);
    setAnimKey(k => k + 1);
  }, []);

  /* ── Scroll-wheel zoom ── */
  const handleWheel = useCallback((e) => {
    if (!prof) return;
    e.preventDefault();
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const md = prof.maxDist || 500;
    const [vs, ve] = getViewRange();
    // Mouse position as fraction across chart
    const W_svg = 1340, PAD_L = 76, PAD_R = 56;
    const GW = W_svg - PAD_L - PAD_R;
    const OX = PAD_L;
    const scaleX = W_svg / rect.width;
    const px = (e.clientX - rect.left) * scaleX;
    const frac = Math.max(0, Math.min(1, (px - OX) / GW));
    const focusDist = vs + frac * (ve - vs);
    const zoomFactor = e.deltaY < 0 ? 0.6 : 1.65;
    const curHalf = (ve - vs) / 2;
    const newHalf = Math.min(md * 0.6, Math.max(40, curHalf * zoomFactor));
    const newStart = Math.max(0, focusDist - frac * 2 * newHalf);
    const newEnd   = Math.min(md * 1.05 + 200, newStart + 2 * newHalf);
    if (newEnd - newStart >= md * 0.95) setZoomRange(null);
    else setZoomRange([newStart, newEnd]);
  }, [prof, getViewRange]);

  /* ── Pan handlers ── */
  const handlePanStart = useCallback((e) => {
    if (e.button !== 0) return;
    const [vs, ve] = getViewRange();
    setIsPanning(true);
    panStartRef.current = { clientX: e.clientX, viewStart: vs, viewEnd: ve };
  }, [getViewRange]);

  const handlePanMove = useCallback((e) => {
    if (!isPanning || !panStartRef.current || !prof) return;
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const W_svg = 1340, PAD_L = 76, PAD_R = 56;
    const GW = W_svg - PAD_L - PAD_R;
    const scaleX = W_svg / rect.width;
    const dx = (e.clientX - panStartRef.current.clientX) * scaleX;
    const { viewStart, viewEnd } = panStartRef.current;
    const viewSpan = viewEnd - viewStart;
    const distPerPx = viewSpan / GW;
    const shift = -dx * distPerPx;
    const md = prof.maxDist;
    const newStart = Math.max(0, viewStart + shift);
    const newEnd   = Math.min(md * 1.05 + 200, newStart + viewSpan);
    if (newEnd - newStart >= md * 0.95) setZoomRange(null);
    else setZoomRange([newStart, newEnd]);
  }, [isPanning, prof]);

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  /* ── empty states ── */
  if (!result) return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",
      flexDirection:"column",gap:14,color:"var(--text-muted)",fontFamily:"var(--font-mono)"}}>
      <span style={{fontSize:48}}>🗺</span>
      <span style={{fontSize:14}}>No packet decoded yet</span>
      <span style={{fontSize:11,opacity:.6}}>Decode a C.4.2 Station→Loco Regular packet</span>
    </div>
  );
  if (!isC42) return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",
      flexDirection:"column",gap:14,color:"var(--text-muted)",fontFamily:"var(--font-mono)"}}>
      <span style={{fontSize:48}}>🗺</span>
      <span style={{fontSize:14,color:"var(--amber)"}}>Profile requires a C.4.2 packet</span>
      <span style={{fontSize:11,opacity:.6}}>Current: {result.packet_type_name}</span>
    </div>
  );
  if (!prof) return null;

  /* ── theme tokens ── */
  const dark    = !isLight;
  const bgC     = dark ? "#06060e"  : "#f0f0f8";
  const surf    = dark ? "#0c0c14"  : "#ffffff";
  const bdr     = dark ? "#1a1a2e"  : "#d0d0e8";
  const gridC   = dark ? "#0f1020"  : "#e8e8f4";
  const textC   = dark ? "#5a5a80"  : "#7070a0";
  const axisC   = dark ? "#6060a0"  : "#4040a0";
  const titleC  = dark ? "#e8e8ff"  : "#1a1a3e";

  /* ── chart geometry ── */
  const W = 1340, H = 740;
  const PAD_L = 76, PAD_R = 56, PAD_T = 52, PAD_B = 220;
  const GW = W - PAD_L - PAD_R;
  const GH = H - PAD_T - PAD_B;
  const OX = PAD_L, OY = PAD_T + GH;

  // TLI zone: OY+20 … OY+90 (label+dot+dist pills — all within SVG PAD_B space)

  // Full data extent
  const maxD = prof.maxDist > 0 ? prof.maxDist : 500;

  // View range for zoom (in data-space metres)
  const [viewStart, viewEnd] = getViewRange();
  const viewSpan = Math.max(50, viewEnd - viewStart);

  // Zoom level indicator (1 = full view, higher = more zoomed)
  const zoomLevel = maxD > 0 ? (maxD / viewSpan).toFixed(1) : "1.0";
  const isZoomed = zoomRange !== null;

  const allSpeeds = [prof.authSpeed, ...prof.ssp.map(s=>s.speed), ...prof.tsrEntries.map(t=>t.speed)].filter(s=>s>0);
  const rawMax  = allSpeeds.length > 0 ? Math.max(...allSpeeds) : 30;
  const yStep   = rawMax <= 40 ? 10 : rawMax <= 80 ? 20 : rawMax <= 150 ? 20 : 50;
  // One step of headroom above max, so the top line is never cut off
  const maxSpd  = Math.ceil((rawMax + yStep * 0.5) / yStep) * yStep;

  // xS maps from data-space metres to SVG X coordinate, using viewStart/viewSpan
  const xS = d  => OX + Math.max(0, Math.min(d - viewStart, viewSpan)) / viewSpan * GW;
  const yS = sp => OY - Math.max(0, Math.min(sp, maxSpd)) / maxSpd * GH;
  // Check if a data distance is visible in current view (with small buffer)
  const inView = d => d >= viewStart - viewSpan * 0.02 && d <= viewEnd + viewSpan * 0.02;

  // X ticks: pick spacing so labels are never closer than ~60px apart
  const minTickPx = 70;
  const rawTickDist = viewSpan / (GW / minTickPx);
  const niceSteps = [10,20,25,50,100,200,250,500,1000,2000,2500,5000,10000];
  const xTick = niceSteps.find(s => s >= rawTickDist) || niceSteps[niceSteps.length-1];
  const xTicks = [];
  // Start from first nice tick at or after viewStart
  const firstTick = Math.ceil(viewStart / xTick) * xTick;
  for(let d=firstTick; d<=viewEnd+xTick*0.01; d+=xTick) {
    if (d >= viewStart - 0.1) xTicks.push(d);
  }
  const yTicks = []; for(let s=0;s<=maxSpd;s+=yStep) yTicks.push(s);

  /* ── crosshair distance readout ── */
  const crossDist = null; // computed live in handler via ref — not needed for render

  /* ── SVG mouse handlers — use DOM refs so mouse move never triggers React re-render ── */
  const handleMouseMove = (e) => {
    // Always update pan when dragging
    if (isPanning) { handlePanMove(e); return; }
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const px = (e.clientX - rect.left) * scaleX;
    const g = crossGRef.current;
    if (!g) return;
    if (px >= OX && px <= OX + GW) {
      crossXRef.current = px;
      const dist = Math.round(viewStart + (px - OX) / GW * viewSpan);
      const label = dist >= 1000 ? `${(dist/1000).toFixed(2)}km` : `${dist}m`;
      const [line, rect2, text] = g.children;
      line.setAttribute('x1', px); line.setAttribute('x2', px);
      rect2.setAttribute('x', px - 28);
      text.setAttribute('x', px);
      text.textContent = label;
      g.style.display = '';
    } else {
      crossXRef.current = null;
      g.style.display = 'none';
    }
  };
  const showTip = (e, lines) => {
    const svg = svgRef.current; if(!svg) return;
    const rect = svg.getBoundingClientRect();
    setTip({ px: e.clientX - rect.left, py: e.clientY - rect.top, lines });
  };
  const hideTip = () => setTip(null);

  /* ─── Animated path helper ───
     Computes total path length via a hidden measuring element concept.
     Since SVG is rendered in browser we use a generous estimate:
     path length ≈ GW * 1.5 for the draw animation dasharray.      */
  const animPath = (d, color, sw, cls, delay=0, opacity=1) => {
    const est = GW * 2;
    return (
      <path key={`${animKey}-${d.slice(0,20)}`}
        d={d} fill="none" stroke={color} strokeWidth={sw}
        strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={est} strokeDashoffset={est}
        className={cls}
        style={{
          '--pv-len': est,
          animationDelay: `${delay}s`,
          opacity,
          filter: dark ? `drop-shadow(0 0 4px ${color}88)` : 'none',
        }}
      />
    );
  };

  /* ── Animated dot ── */
  const AnimDot = ({cx, cy, r=5.5, fill, delay=0, tipLines, glow=false}) => (
    <circle key={`dot-${animKey}-${cx}-${cy}`}
      cx={cx} cy={cy} r={r}
      fill={fill}
      stroke={dark ? "#000010" : "#ffffff"}
      strokeWidth={1.8}
      className={`pv-dot${glow?" pv-glow":""}`}
      style={{
        '--pv-len': 0,
        animationDelay: `${delay}s`,
        transformOrigin: `${cx}px ${cy}px`,
        cursor:"crosshair",
        filter: dark ? `drop-shadow(0 0 5px ${fill})` : 'none',
      }}
      onAnimationEnd={e => {
        e.currentTarget.classList.add('pv-done');
      }}
      onMouseEnter={e => showTip(e, tipLines)}
      onMouseLeave={hideTip}
    />
  );

  /* ── defs: gradient fills ── */
  const Defs = () => (
    <defs>
      {/* MA fill gradient */}
      <linearGradient id="pvGradMA" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={PV_COLORS.ma} stopOpacity={dark?0.18:0.12}/>
        <stop offset="100%" stopColor={PV_COLORS.ma} stopOpacity={0}/>
      </linearGradient>
      {/* SSP fill gradient */}
      <linearGradient id="pvGradSSP" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={PV_COLORS.ssp} stopOpacity={dark?0.30:0.20}/>
        <stop offset="100%" stopColor={PV_COLORS.ssp} stopOpacity={dark?0.04:0.02}/>
      </linearGradient>
      {/* Gradient terrain fill */}
      <linearGradient id="pvGradTerrain" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={PV_COLORS.grad} stopOpacity={dark?0.25:0.15}/>
        <stop offset="100%" stopColor={PV_COLORS.grad} stopOpacity={0.0}/>
      </linearGradient>
      {/* TSR fill */}
      <linearGradient id="pvGradTSR" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={PV_COLORS.tsr} stopOpacity={0.35}/>
        <stop offset="100%" stopColor={PV_COLORS.tsr} stopOpacity={0.05}/>
      </linearGradient>
      {/* Grid background stripe */}
      <pattern id="pvStripe" x="0" y="0" width="80" height="1" patternUnits="userSpaceOnUse">
        <rect x="0" y="0" width="80" height="1" fill="none"/>
        <rect x="0" y="0" width="40" height="1" fill={dark?"rgba(255,255,255,0.008)":"rgba(0,0,60,0.015)"}/>
      </pattern>
      {/* Glow filter for lines */}
      <filter id="pvGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="pvGlowStrong" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
  );

  /* ══════════════════════════════════════════════
     LAYER: Movement Authority
  ══════════════════════════════════════════════ */
  const MaLayer = () => {
    if (!prof.maEnd) return null;
    const sigC = prof.curSigAsp===11?"#22c55e":prof.curSigAsp===2||prof.curSigAsp===10?"#eab308":"#ef4444";
    const authY = prof.authSpeed > 0 ? yS(prof.authSpeed) : OY - GH*0.5;
    const eoa   = xS(prof.maEnd);
    const pathLen = eoa - OX;
    return (
      <g key={`ma-${animKey}`}>
        {/* MA zone fill */}
        <rect x={OX} y={PAD_T} width={eoa-OX} height={GH}
          fill="url(#pvGradMA)" className="pv-fill" style={{animationDelay:"0.1s"}}/>

        {/* AUTH speed dashed line — glowing */}
        <line x1={OX} y1={authY} x2={eoa} y2={authY}
          stroke={PV_COLORS.ma} strokeWidth={2.5} strokeDasharray="12,6"
          style={{
            '--pv-len': pathLen,
            filter: dark ? `drop-shadow(0 0 6px ${PV_COLORS.ma})` : 'none',
            strokeDashoffset: pathLen,
            animation:`pv-draw 1.2s cubic-bezier(0.4,0,0.2,1) 0.2s forwards`,
          }}/>

        {/* EOA vertical */}
        <line x1={eoa} y1={PAD_T+2} x2={eoa} y2={OY}
          stroke={PV_COLORS.ma} strokeWidth={1.5} strokeDasharray="6,4" opacity={0.7}
          style={{
            '--pv-len': GH,
            strokeDashoffset: GH,
            animation:`pv-draw 0.6s ease 1.1s forwards`,
          }}/>

        {/* EOA badge */}
        <rect x={eoa-18} y={PAD_T} width={36} height={18} rx={4}
          fill={PV_COLORS.ma} opacity={0.9} className="pv-badge" style={{animationDelay:"1.2s"}}/>
        <text x={eoa} y={PAD_T+13} textAnchor="middle" fontSize={10} fontWeight="800"
          fill="#000" fontFamily="monospace" className="pv-badge" style={{animationDelay:"1.2s"}}>EOA</text>

        {/* AUTH label badge */}
        <rect x={OX+10} y={authY-16} width={76} height={15} rx={3}
          fill={dark?"#001a20":"#e0f7fb"} stroke={PV_COLORS.ma} strokeWidth={1}
          className="pv-badge" style={{animationDelay:"0.8s"}}/>
        <text x={OX+48} y={authY-5} textAnchor="middle" fontSize={10} fontWeight="700"
          fill={PV_COLORS.ma} fontFamily="monospace" className="pv-badge" style={{animationDelay:"0.8s"}}>
          AUTH {prof.authSpeed} kmph
        </text>

        {/* MA distance label */}
        <text x={(OX+eoa)/2} y={authY+16} textAnchor="middle" fontSize={9}
          fill={PV_COLORS.ma} fontFamily="monospace" opacity={0.7}
          className="pv-badge" style={{animationDelay:"1.0s"}}>
          MA = {prof.maWRT} m
        </text>

        {/* Signal marker */}
        {prof.sigPos > 0 && (() => {
          const sx = xS(prof.sigPos);
          return (
            <g>
              <line x1={sx} y1={OY} x2={sx} y2={PAD_T+6}
                stroke={sigC} strokeWidth={2.5} opacity={0.85}
                style={{'--pv-len':GH, strokeDashoffset:GH, animation:`pv-draw 0.5s ease 0.6s forwards`}}/>
              <circle cx={sx} cy={PAD_T+24} r={10} fill={sigC} opacity={0.9}
                className="pv-dot" style={{animationDelay:"0.7s", transformOrigin:`${sx}px ${PAD_T+24}px`}}/>
              <text x={sx} y={PAD_T+29} textAnchor="middle" fontSize={9} fontWeight="700"
                fill="#000" fontFamily="monospace" className="pv-badge" style={{animationDelay:"0.8s"}}>SIG</text>
              <text x={sx+2} y={PAD_T+44} textAnchor="start" fontSize={9}
                fill={sigC} fontFamily="monospace" className="pv-badge" style={{animationDelay:"0.9s"}}>
                {prof.sigPos}m
              </text>
            </g>
          );
        })()}

        {/* Dots */}
        <AnimDot cx={OX} cy={authY} r={6} fill={PV_COLORS.ma} delay={0.4}
          glow={dark}
          tipLines={[`MA Start (Ref RFID #${prof.refRFID??'?'})`,`Distance: 0 m`,`Auth speed: ${prof.authSpeed} kmph`]}/>
        <AnimDot cx={eoa} cy={authY} r={7} fill={PV_COLORS.ma} delay={1.3}
          glow={dark}
          tipLines={[`EOA — End of Authority`,`Distance: ${prof.maEnd} m`,`MA: ${prof.maWRT} m`,`Auth: ${prof.authSpeed} kmph`]}/>
      </g>
    );
  };

  /* ══════════════════════════════════════════════
     LAYER: Static Speed Profile (step function)
  ══════════════════════════════════════════════ */
  const SspLayer = () => {
    if (prof.ssp.length === 0) return null;

    /* Build step path */
    let d = `M${OX},${OY}`;
    for (let i = 0; i < prof.ssp.length; i++) {
      const seg = prof.ssp[i];
      const x0  = xS(seg.startDist), x1 = xS(seg.endDist);
      const sy  = yS(seg.speed);
      if (i === 0 && seg.startDist > 0) d += ` L${x0},${OY}`;
      d += ` L${x0},${sy} L${x1},${sy}`;
    }
    const lastSeg = prof.ssp[prof.ssp.length-1];
    const fillD   = d + ` L${xS(lastSeg.endDist)},${OY} Z`;
    const estLen  = GW * 2.5;

    return (
      <g key={`ssp-${animKey}`}>
        {/* Gradient fill */}
        <path d={fillD} fill="url(#pvGradSSP)" className="pv-fill" style={{animationDelay:"0.4s"}}/>

        {/* Outer glow stroke (thicker, lower opacity) */}
        {dark && (
          <path d={d.replace(`M${OX},${OY}`, `M${OX},${OY}`)} fill="none"
            stroke={PV_COLORS.ssp} strokeWidth={7} opacity={0.12}
            strokeDasharray={estLen} strokeDashoffset={estLen}
            style={{animation:`pv-draw 1.5s cubic-bezier(0.4,0,0.2,1) 0.35s forwards`}}/>
        )}

        {/* Main step line */}
        <path d={d} fill="none"
          stroke={PV_COLORS.ssp} strokeWidth={3}
          strokeLinecap="round" strokeLinejoin="miter"
          strokeDasharray={estLen} strokeDashoffset={estLen}
          style={{
            animation:`pv-draw 1.5s cubic-bezier(0.4,0,0.2,1) 0.35s forwards`,
            filter: dark ? `drop-shadow(0 0 5px ${PV_COLORS.ssp})` : 'none',
          }}/>

        {/* Per-segment labels and dots */}
        {prof.ssp.map((seg, i) => {
          const x0  = xS(seg.startDist), x1 = xS(seg.endDist);
          const sy  = yS(seg.speed);
          const midX= (x0+x1)/2;
          const len = seg.endDist - seg.startDist;
          const delay = 0.5 + i * 0.07;
          return (
            <g key={`ssp-seg-${i}`}>
              {(x1-x0) > 42 && (
                <g className="pv-badge" style={{animationDelay:`${delay+0.3}s`}}>
                  <rect x={midX-28} y={sy-22} width={56} height={15} rx={3}
                    fill={dark?"rgba(0,20,10,0.85)":"rgba(220,255,240,0.9)"}
                    stroke={PV_COLORS.ssp} strokeWidth={1}/>
                  <text x={midX} y={sy-11} textAnchor="middle" fontSize={10} fontWeight="700"
                    fill={PV_COLORS.ssp} fontFamily="monospace">{seg.speed} kmph</text>
                </g>
              )}
              {(x1-x0) > 60 && (
                <text x={midX} y={Math.min(sy+20, OY-8)} textAnchor="middle" fontSize={8}
                  fill={PV_COLORS.ssp} fontFamily="monospace" opacity={0.65}
                  className="pv-badge" style={{animationDelay:`${delay+0.4}s`}}>
                  {len} m
                </text>
              )}
              {/* Dashed vertical at transition */}
              {x0 > OX+3 && (
                <line x1={x0} y1={OY} x2={x0} y2={sy}
                  stroke={PV_COLORS.ssp} strokeWidth={1} strokeDasharray="3,4" opacity={0.25}/>
              )}
              <AnimDot cx={x0} cy={sy} r={5.5} fill={PV_COLORS.ssp} delay={delay}
                tipLines={[`SSP Segment ${i+1}`,`Start: ${seg.startDist} m`,`Speed: ${seg.speed} kmph`,`Length: ${len} m`]}/>
              <AnimDot cx={x1} cy={sy} r={4.5} fill={PV_COLORS.ssp} delay={delay+0.1}
                tipLines={[`SSP Seg ${i+1} End`,`Distance: ${seg.endDist} m`,`Speed: ${seg.speed} kmph`,i+1<prof.ssp.length?`↓ Next: ${prof.ssp[i+1].speed} kmph`:`↓ End of SSP`]}/>
            </g>
          );
        })}
      </g>
    );
  };

  /* ══════════════════════════════════════════════
     LAYER: Gradient terrain profile
  ══════════════════════════════════════════════ */
  const GradLayer = () => {
    if (prof.gradEntries.length === 0) return null;
    const LEVEL_Y  = OY - GH * 0.30;
    const MAX_RISE = GH * 0.22;

    const verts = [{ x: OX, y: LEVEL_Y }];
    let curY = LEVEL_Y;
    for (const seg of prof.gradEntries) {
      const x0 = xS(seg.startDist), x1 = xS(seg.endDist);
      const rise = seg.grad === 0 ? 0 : Math.min(MAX_RISE, (seg.grad / 20) * MAX_RISE);
      const deltaY = seg.isUp ? -rise : (seg.grad > 0 ? rise : 0);
      const endY = Math.max(PAD_T + 8, Math.min(OY - 4, curY + deltaY));
      if (verts[verts.length-1].x !== x0) verts.push({ x: x0, y: curY });
      verts.push({ x: x1, y: endY });
      curY = endY;
    }

    const pathD = verts.map((p,i) => `${i===0?'M':'L'}${p.x},${p.y}`).join(' ');
    const last  = verts[verts.length-1];
    const fillD = pathD + ` L${last.x},${LEVEL_Y} L${OX},${LEVEL_Y} Z`;
    const estLen = GW * 1.8;

    return (
      <g key={`grad-${animKey}`}>
        {/* Level baseline */}
        <line x1={OX} y1={LEVEL_Y} x2={OX+GW} y2={LEVEL_Y}
          stroke={PV_COLORS.grad} strokeWidth={1} strokeDasharray="5,5" opacity={0.22}/>
        <text x={OX-7} y={LEVEL_Y+4} textAnchor="end" fontSize={8}
          fill={PV_COLORS.grad} fontFamily="monospace" opacity={0.55}>Level</text>

        {/* Fill */}
        <path d={fillD} fill="url(#pvGradTerrain)" className="pv-fill" style={{animationDelay:"0.5s"}}/>

        {/* Outer glow */}
        {dark && (
          <path d={pathD} fill="none" stroke={PV_COLORS.grad} strokeWidth={8} opacity={0.1}
            strokeDasharray={estLen} strokeDashoffset={estLen}
            style={{animation:`pv-draw 1.6s ease 0.45s forwards`}}/>
        )}

        {/* Main line */}
        <path d={pathD} fill="none" stroke={PV_COLORS.grad} strokeWidth={2.5}
          strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={estLen} strokeDashoffset={estLen}
          style={{
            animation:`pv-draw 1.6s cubic-bezier(0.4,0,0.2,1) 0.45s forwards`,
            filter: dark ? `drop-shadow(0 0 4px ${PV_COLORS.grad})` : 'none',
          }}/>

        {/* Segment labels & dots */}
        {prof.gradEntries.map((seg, i) => {
          const x0  = xS(seg.startDist), x1 = xS(seg.endDist);
          /* Look up y positions from verts array by index, not by x proximity */
          /* verts[0] = origin. For seg i: startVert index = i+1 (or 0 for first),
             endVert index = i+2.
             Rebuild: verts has: [origin, ...one per seg endpoint].
             Each seg contributes:
               - if gap: {x:x0, y:curY} push THEN {x:x1, y:endY}
               - else: just {x:x1, y:endY}
             So we can't use simple index. Use x-proximity with wider tolerance. */
          const findVert = (x) => {
            let best = verts[0];
            let bestD = Math.abs(verts[0].x - x);
            for (const v of verts) {
              const d = Math.abs(v.x - x);
              if (d < bestD) { bestD = d; best = v; }
            }
            return best;
          };
          const v0  = findVert(x0);
          const v1  = findVert(x1);
          const c   = seg.isUp ? "#4ade80" : seg.grad > 0 ? "#fb923c" : "#94a3b8";
          const lbl = seg.grad===0 ? 'Level'
            : `${seg.isUp?'▲':'▼'} 1:${seg.grad>0&&seg.grad<31?Math.floor(1000/seg.grad):'?'}`;
          const delay = 0.55 + i * 0.08;
          return (
            <g key={`grad-seg-${i}`}>
              {(x1-x0) > 44 && (
                <g className="pv-badge" style={{animationDelay:`${delay+0.3}s`}}>
                  <rect x={(x0+x1)/2-24} y={Math.min(v0.y,v1.y)-20} width={48} height={14} rx={3}
                    fill={dark?"rgba(10,8,0,0.85)":"rgba(255,248,220,0.92)"}
                    stroke={c} strokeWidth={1}/>
                  <text x={(x0+x1)/2} y={Math.min(v0.y,v1.y)-9} textAnchor="middle"
                    fontSize={10} fontWeight="700" fill={c} fontFamily="monospace">{lbl}</text>
                </g>
              )}
              {/* Start dot */}
              <AnimDot cx={x0} cy={v0.y} r={5} fill={c} delay={delay}
                tipLines={[`Gradient Seg ${i+1}`,`Start: ${seg.startDist} m`,lbl,`Length: ${seg.endDist-seg.startDist} m`]}/>
              {/* End dot for each segment (shows all transitions) */}
              <AnimDot cx={x1} cy={v1.y} r={4} fill={c} delay={delay+0.05}
                tipLines={[`Gradient Seg ${i+1} End`,`Distance: ${seg.endDist} m`,lbl,`→ Next: ${i+1<prof.gradEntries.length?(prof.gradEntries[i+1].grad===0?'Level':`1:${Math.floor(1000/prof.gradEntries[i+1].grad)}`):'End'}`]}/>
            </g>
          );
        })}
      </g>
    );
  };

  /* ══════════════════════════════════════════════
     LAYER: TSR — Temporary Speed Restrictions
  ══════════════════════════════════════════════ */
  const TsrLayer = () => (
    <g key={`tsr-${animKey}`}>
      {prof.tsrEntries.map((t,i) => {
        const x1=xS(t.dist), x2=xS(t.dist+Math.max(t.length,30));
        const sy=yS(t.speed);
        const delay = 0.6 + i*0.12;
        return (
          <g key={`tsr-${i}`}>
            {/* Hazard fill */}
            <rect x={x1} y={sy} width={Math.max(4,x2-x1)} height={OY-sy}
              fill="url(#pvGradTSR)" className="pv-fill" style={{animationDelay:`${delay}s`}}
              rx={3}/>
            {/* Speed cap line */}
            <line x1={x1} y1={sy} x2={x2} y2={sy}
              stroke={PV_COLORS.tsr} strokeWidth={3.5}
              strokeDasharray={x2-x1} strokeDashoffset={x2-x1}
              style={{
                animation:`pv-draw 0.5s ease ${delay+0.1}s forwards`,
                filter: dark ? `drop-shadow(0 0 5px ${PV_COLORS.tsr})` : 'none',
              }}/>
            {/* Vertical entry marker */}
            <line x1={x1} y1={PAD_T} x2={x1} y2={OY}
              stroke={PV_COLORS.tsr} strokeWidth={1} strokeDasharray="4,4" opacity={0.4}/>
            {(x2-x1)>32 && (
              <g className="pv-badge" style={{animationDelay:`${delay+0.3}s`}}>
                <rect x={(x1+x2)/2-30} y={sy-22} width={60} height={15} rx={3}
                  fill={dark?"rgba(20,0,0,0.9)":"rgba(255,220,220,0.95)"}
                  stroke={PV_COLORS.tsr} strokeWidth={1}/>
                <text x={(x1+x2)/2} y={sy-11} textAnchor="middle" fontSize={10} fontWeight="700"
                  fill={PV_COLORS.tsr} fontFamily="monospace">TSR {t.speed} kmph</text>
              </g>
            )}
            <AnimDot cx={x1} cy={sy} r={5.5} fill={PV_COLORS.tsr} delay={delay+0.15}
              tipLines={[`TSR #${t.id}`,`Start: ${t.dist} m`,`Length: ${t.length} m`,`Speed: ${t.speed} kmph`]}/>
            <AnimDot cx={x2} cy={sy} r={4} fill={PV_COLORS.tsr} delay={delay+0.25}
              tipLines={[`TSR #${t.id} End`,`${t.dist+t.length} m`]}/>
          </g>
        );
      })}
    </g>
  );

  /* ══════════════════════════════════════════════
     LAYER: Track Conditions
  ══════════════════════════════════════════════ */
  const TcLayer = () => {
    const TC_C={1:"#dc2626",2:"#64748b",3:"#7c3aed",4:"#0e7490",5:"#d97706",
                6:"#16a34a",7:"#be185d",8:"#92400e",9:"#374151"};
    const BASE = OY - GH*0.06;
    return (
      <g key={`tc-${animKey}`}>
        {prof.trackConds.map((tc,i) => {
          const c = TC_C[tc.type]||PV_COLORS.tc;
          const x1=xS(tc.start), x2=xS(tc.start+Math.max(tc.length,30));
          return (
            <g key={`tc-${i}`}>
              <rect x={x1} y={BASE-10} width={Math.max(4,x2-x1)} height={20}
                fill={c} opacity={dark?0.75:0.6} rx={3}
                className="pv-fill" style={{animationDelay:`${0.7+i*0.1}s`}}/>
              {(x2-x1)>32 && (
                <text x={(x1+x2)/2} y={BASE+5} textAnchor="middle" fontSize={8}
                  fill="#fff" fontFamily="monospace" fontWeight="700">
                  {tc.typeName.slice(0,10)}
                </text>
              )}
              <AnimDot cx={x1} cy={BASE} r={4} fill={c} delay={0.75+i*0.1}
                tipLines={[`Track Cond: ${tc.typeName}`,`Start: ${tc.start} m`,`Length: ${tc.length} m`]}/>
            </g>
          );
        })}
      </g>
    );
  };

  /* ══════════════════════════════════════════════
     LAYER: LC Gates
  ══════════════════════════════════════════════ */
  const LcLayer = () => (
    <g key={`lc-${animKey}`}>
      {prof.lcGates.map((lc,i) => {
        const x = xS(lc.dist);
        const c = lc.manned ? PV_COLORS.lc : "#ef4444";
        const top = OY - GH*0.24;
        const delay = 0.65 + i*0.1;
        return (
          <g key={`lc-${i}`}>
            <line x1={x} y1={PAD_T} x2={x} y2={OY}
              stroke={c} strokeWidth={1} strokeDasharray="3,5" opacity={0.28}/>
            <line x1={x} y1={OY} x2={x} y2={top}
              stroke={c} strokeWidth={3}
              strokeDasharray={GH} strokeDashoffset={GH}
              style={{
                animation:`pv-draw 0.45s ease ${delay}s forwards`,
                filter: dark ? `drop-shadow(0 0 4px ${c})` : 'none',
              }}/>
            {/* Gate arm */}
            <line x1={x} y1={top} x2={x+28} y2={top+14}
              stroke={c} strokeWidth={2.5} strokeLinecap="round"
              className="pv-draw-fast" style={{animationDelay:`${delay+0.15}s`,'--pv-len':35}}/>
            <text x={x} y={top-12} textAnchor="middle" fontSize={10} fontWeight="800"
              fill={c} fontFamily="monospace" className="pv-badge" style={{animationDelay:`${delay+0.2}s`}}>
              LC#{lc.id}
            </text>
            <text x={x+15} y={top+13} fontSize={8} fill={c} fontFamily="monospace"
              fontWeight="700" className="pv-badge" style={{animationDelay:`${delay+0.25}s`}}>
              {lc.manned?"M":"U"}
            </text>
            <AnimDot cx={x} cy={top} r={5.5} fill={c} delay={delay+0.1}
              tipLines={[`LC Gate #${lc.id}`,`Distance: ${lc.dist} m`,`Manning: ${lc.manned?"Manned":"Unmanned"}`]}/>
          </g>
        );
      })}
    </g>
  );

  /* ══════════════════════════════════════════════
     LAYER: Turnout Speeds
  ══════════════════════════════════════════════ */
  const ToLayer = () => (
    <g key={`to-${animKey}`}>
      {prof.turnouts.map((to,i) => {
        const x = xS(to.dist);
        const BASE = OY - GH*0.16;
        const delay = 0.7 + i*0.1;
        return (
          <g key={`to-${i}`}>
            <line x1={x} y1={PAD_T} x2={x} y2={OY}
              stroke={PV_COLORS.to} strokeWidth={1} strokeDasharray="3,5" opacity={0.28}/>
            {/* Track symbol */}
            <line x1={x-16} y1={BASE} x2={x+16} y2={BASE}
              stroke={PV_COLORS.to} strokeWidth={3.5} strokeLinecap="round"
              className="pv-draw-fast" style={{animationDelay:`${delay}s`,'--pv-len':32}}/>
            <line x1={x+4} y1={BASE} x2={x+24} y2={BASE-20}
              stroke={PV_COLORS.to} strokeWidth={2.5} strokeLinecap="round"
              className="pv-draw-fast" style={{animationDelay:`${delay+0.1}s`,'--pv-len':30}}/>
            {to.speed > 0 && (
              <g className="pv-badge" style={{animationDelay:`${delay+0.2}s`}}>
                <rect x={x-24} y={BASE-36} width={48} height={14} rx={3}
                  fill={dark?"rgba(10,0,20,0.85)":"rgba(235,225,255,0.92)"}
                  stroke={PV_COLORS.to} strokeWidth={1}/>
                <text x={x} y={BASE-25} textAnchor="middle" fontSize={9} fontWeight="700"
                  fill={PV_COLORS.to} fontFamily="monospace">TO {to.speed}k</text>
              </g>
            )}
            <AnimDot cx={x} cy={BASE} r={5.5} fill={PV_COLORS.to} delay={delay+0.15}
              tipLines={[`Turnout`,`Start: ${to.dist} m`,`Speed: ${to.speed} kmph`,`Release: ${to.relDist} m`]}/>
          </g>
        );
      })}
    </g>
  );

  /* ══════════════════════════════════════════════
     LAYER: TLI — RFID Tag Chain
  ══════════════════════════════════════════════ */
  const TliLayer = () => {
    const refTag  = { id: prof.refRFID ?? '?', cumDist: 0, dist: 0 };
    const allTags = [refTag, ...prof.rfidTags];
    if (allTags.length === 0) return null;

    /* ── Three rows only ─────────────────────────────────────────
       LABEL_Y  : R-xxx pill  (above dot)
       DOT_Y    : dot on track rail
       DIST_Y   : inter-tag distance pill (below dot)
    ──────────────────────────────────────────────────────────── */
    const DOT_Y   = OY + 42;
    const LABEL_Y = OY + 28;
    const DIST_Y  = OY + 60;

    const lastX    = xS(allTags[allTags.length - 1]?.cumDist || 0);
    const chainLen = lastX - OX;
    const TAG_C    = PV_COLORS.rfid;   // #f472b6 pink
    const DIST_C   = "#67e8f9";         // cyan

    return (
      <g key={`tli-${animKey}`}>

        {/* Track rail */}
        <line x1={OX} y1={DOT_Y} x2={lastX} y2={DOT_Y}
          stroke={TAG_C} strokeWidth={1.5} opacity={0.25}
          strokeDasharray={chainLen} strokeDashoffset={chainLen}
          style={{animation:`pv-draw 1.8s ease 0.8s forwards`}}/>

        {/* Per-tag: dot + R-xxx label */}
        {allTags.map((tag, i) => {
          const x     = xS(tag.cumDist);
          const isRef = i === 0;
          const c     = isRef ? "#e2e8f0" : TAG_C;
          const label = `R-${tag.id}`;
          const delay = 0.85 + i * 0.05;
          const labelW = label.length * 5.8 + 8;
          return (
            <g key={`tli-tag-${i}`}>
              {isRef && (
                <line x1={x} y1={PAD_T} x2={x} y2={OY}
                  stroke={c} strokeWidth={1}
                  strokeDasharray="3,5" opacity={0.15}/>
              )}
              <AnimDot cx={x} cy={DOT_Y} r={isRef ? 6 : 4}
                fill={c} delay={delay} glow={isRef && dark}
                tipLines={[
                  isRef ? `Ref RFID  R-${tag.id}` : `RFID Tag  R-${tag.id}`,
                  `Cumulative: ${tag.cumDist} m`,
                  i > 0 ? `Inter-tag: ${tag.dist} m` : `Origin (0 m)`,
                ]}/>
              <rect x={x - labelW/2} y={LABEL_Y - 8} width={labelW} height={13} rx={3}
                fill={dark
                  ? isRef ? "rgba(226,232,240,0.12)" : "rgba(244,114,182,0.14)"
                  : isRef ? "rgba(0,0,0,0.08)"        : "rgba(244,114,182,0.15)"}
                stroke={c} strokeWidth={isRef ? 1.2 : 0.8}
                className="pv-badge" style={{animationDelay:`${delay+0.08}s`}}/>
              <text x={x} y={LABEL_Y+2} textAnchor="middle"
                fontSize={isRef ? 8 : 7.5} fontWeight={isRef ? "800" : "700"}
                fill={c} fontFamily="monospace"
                className="pv-badge" style={{animationDelay:`${delay+0.1}s`,
                  textShadow: dark ? `0 0 5px ${c}88` : 'none'}}>
                {label}
              </text>
            </g>
          );
        })}

        {/* Inter-tag distance pills */}
        {allTags.map((tag, i) => {
          if (i === 0) return null;
          const prev  = allTags[i - 1];
          const x1    = xS(prev.cumDist);
          const x2    = xS(tag.cumDist);
          const gap   = x2 - x1;
          if (gap < 20) return null;
          const mx    = (x1 + x2) / 2;
          const label = `${tag.dist}m`;
          const pilW  = Math.min(gap - 4, label.length * 6.2 + 12);
          const delay = 1.0 + i * 0.05;
          return (
            <g key={`dist-${i}`} className="pv-badge" style={{animationDelay:`${delay}s`}}>
              <rect x={mx - pilW/2} y={DIST_Y - 7} width={pilW} height={13} rx={3}
                fill={dark ? "rgba(6,182,212,0.12)" : "rgba(6,182,212,0.15)"}
                stroke={DIST_C} strokeWidth={0.8}/>
              <text x={mx} y={DIST_Y+3} textAnchor="middle"
                fontSize={7.5} fontWeight="700" fill={DIST_C} fontFamily="monospace">
                {label}
              </text>
            </g>
          );
        })}
      </g>
    );
  };

  /* ══════════════════════════════════════════════
     LEGEND BUTTONS
  ══════════════════════════════════════════════ */
  const BTNS = [
    {k:'ma',  l:'▸ MA',         c:PV_COLORS.ma},
    {k:'ssp', l:'▸ SSP',        c:PV_COLORS.ssp},
    {k:'grad',l:'▸ Gradient',   c:PV_COLORS.grad},
    {k:'tsr', l:'▸ TSR',        c:PV_COLORS.tsr},
    {k:'tc',  l:'▸ Track Cond', c:PV_COLORS.tc},
    {k:'lc',  l:'▸ LC Gate',    c:PV_COLORS.lc},
    {k:'to',  l:'▸ Turnout',    c:PV_COLORS.to},
    {k:'tli', l:'▸ TLI Tags',   c:PV_COLORS.rfid},
  ];

  /* ══════════════════════════════════════════════
     INFO CARDS
  ══════════════════════════════════════════════ */
  const TRAIN_SEC_MAP = {0:"Station Section",1:"Absolute Block",2:"Autoblock"};
  const SOS_LABELS    = {1:"Foreign RFID",2:"—",3:"Odo Error≥120m",4:"SPAD",
    5:"Rear-End Collision",6:"Head-On Collision",7:"Shunting Limit",8:"General SoS"};
  const cards = [
    {l:"REF RFID",  v:`#${prof.refRFID??"—"}`,                                   c:"#bef264"},
    {l:"DIRECTION", v:prof.pktDir===1?"Nominal":prof.pktDir===2?"Reverse":"—",    c:"#94a3b8"},
    {l:"SIGNAL",    v:PV_SIG_ASP[prof.curSigAsp??-1]??"—",
      c:prof.curSigAsp===11?"#22c55e":prof.curSigAsp===2?"#eab308":"#ef4444"},
    {l:"AUTH SPD",  v:prof.authSpeed>0?`${prof.authSpeed} kmph`:"—",              c:PV_COLORS.ssp},
    {l:"AUTH TYPE", v:PV_AUTH[prof.authType]??"—",                                c:PV_COLORS.ma},
    {l:"MA",        v:prof.maWRT&&prof.maWRT<65535?`${prof.maWRT} m`:"SR",        c:PV_COLORS.ma},
    {l:"SEC TYPE",  v:TRAIN_SEC_MAP[prof.trainSectionType]??"—",                  c:"#a78bfa"},
    {l:"SSP segs",  v:`${prof.ssp.length}`,                                       c:PV_COLORS.ssp},
    {l:"GRAD segs", v:`${prof.gradEntries.length}`,                               c:PV_COLORS.grad},
    {l:"LC gates",  v:`${prof.lcGates.length}`,                                   c:PV_COLORS.lc},
    {l:"Turnouts",  v:`${prof.turnouts.length}`,                                  c:PV_COLORS.to},
    {l:"TLI tags",  v:`${prof.rfidTags.length}`,                                  c:PV_COLORS.rfid},
    {l:"TSR",       v:`${prof.tsrEntries.length}`,                                c:PV_COLORS.tsr},
    {l:"Track Cond",v:`${prof.trackConds.length}`,                                c:PV_COLORS.tc},
    ...(prof.destLocoSos>0?[{l:"⚠ SoS",v:SOS_LABELS[prof.destLocoSos]||`Code ${prof.destLocoSos}`,c:"#ef4444"}]:[]),
  ].filter(x=>x.v!=="—"&&x.v!=="0");

  /* ══════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════ */
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:bgC}}>
      <style>{PV_ANIM_CSS}</style>

      {/* ── Info strip ── */}
      <div style={{
        flexShrink:0,display:"flex",gap:4,padding:"5px 12px",
        borderBottom:`1px solid ${bdr}`,background:surf,
        flexWrap:"wrap",alignItems:"center",
        boxShadow: dark ? "0 1px 12px rgba(0,0,0,0.4)" : "0 1px 4px rgba(0,0,60,0.07)",
      }}>
        {cards.map(({l,v,c}) => (
          <div key={l} style={{
            background: dark ? `${c}0a` : `${c}14`,
            border:`1px solid ${c}30`,
            borderTop:`2px solid ${c}`,
            borderRadius:5, padding:"2px 8px", minWidth:58,
            backdropFilter:"blur(4px)",
          }}>
            <div style={{fontSize:7,color:textC,fontFamily:"var(--font-mono)",
              textTransform:"uppercase",letterSpacing:".08em"}}>{l}</div>
            <div style={{fontSize:10,fontWeight:800,fontFamily:"var(--font-mono)",color:c,
              textShadow: dark ? `0 0 8px ${c}88` : 'none'}}>{v}</div>
          </div>
        ))}
        <div style={{marginLeft:"auto",fontSize:8.5,color:textC,fontFamily:"var(--font-mono)",opacity:0.7}}>
          C.4.2 · Stn #{prof.stnId??"?"} → Loco #{prof.destLoco??"?"} · RDSO/SPN/196/2020
        </div>
      </div>

      {/* ── Layer toggles + Zoom controls ── */}
      <div style={{
        flexShrink:0,display:"flex",gap:4,padding:"4px 12px",
        borderBottom:`1px solid ${bdr}`,background:surf,flexWrap:"wrap",alignItems:"center",
      }}>
        <span style={{fontSize:8,color:textC,fontFamily:"var(--font-mono)",
          textTransform:"uppercase",letterSpacing:".1em",marginRight:2,opacity:0.7}}>LAYERS:</span>
        {BTNS.map(({k,l,c}) => {
          const on = vis[k];
          return (
            <button key={k} onClick={() => toggle(k)} style={{
              display:"flex",alignItems:"center",gap:4,
              padding:"3px 10px",borderRadius:6,cursor:"pointer",
              fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:700,
              transition:"all .18s ease",userSelect:"none",
              border:`1.5px solid ${on ? c : dark?"#1e1e30":"#c8c8e0"}`,
              background: on
                ? dark ? `${c}18` : `${c}14`
                : dark ? "#0a0a10" : "#f4f4fc",
              color: on ? c : dark?"#2e2e50":"#a0a0c0",
              boxShadow: on && dark ? `0 0 8px ${c}44, inset 0 0 4px ${c}18` : 'none',
            }}>
              <div style={{
                width:7,height:7,borderRadius:"50%",flexShrink:0,
                background: on ? c : "transparent",
                border:`1.5px solid ${on ? c : dark?"#2e2e50":"#c8c8e0"}`,
                boxShadow: on && dark ? `0 0 5px ${c}` : 'none',
                transition:"all .18s ease",
              }}/>
              {l}
            </button>
          );
        })}

        {/* Zoom Controls */}
        <div style={{
          marginLeft:"auto",display:"flex",alignItems:"center",gap:4,
          padding:"2px 6px",borderRadius:6,
          border:`1px solid ${dark?"#1e1e30":"#c8c8e0"}`,
          background: dark?"#08080f":"#f8f8ff",
        }}>
          <span style={{fontSize:8,color:textC,fontFamily:"var(--font-mono)",
            textTransform:"uppercase",letterSpacing:".08em",opacity:0.6,marginRight:2}}>ZOOM</span>

          {/* Zoom out */}
          <button onClick={handleZoomOut} title="Zoom Out (or scroll ↓)"
            style={{
              padding:"2px 7px",borderRadius:4,cursor:"pointer",fontWeight:700,fontSize:12,
              border:`1px solid ${dark?"#2a2a44":"#c0c0d8"}`,
              background:dark?"#0e0e18":"#f0f0fc",color:dark?"#7070b0":"#6060a0",
              transition:"all .15s",lineHeight:1,
            }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--cyan)";e.currentTarget.style.color="var(--cyan)";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=dark?"#2a2a44":"#c0c0d8";e.currentTarget.style.color=dark?"#7070b0":"#6060a0";}}>
            −
          </button>

          {/* Zoom level display */}
          <div style={{
            padding:"2px 8px",borderRadius:4,minWidth:46,textAlign:"center",
            fontFamily:"var(--font-mono)",fontSize:9,fontWeight:700,
            background: isZoomed ? (dark?"rgba(6,182,212,0.1)":"rgba(2,132,199,0.08)") : "transparent",
            color: isZoomed ? (dark?"var(--cyan)":"#0284c7") : textC,
            border: isZoomed ? `1px solid ${dark?"rgba(6,182,212,0.3)":"rgba(2,132,199,0.2)"}` : "1px solid transparent",
            transition:"all 0.2s",
          }}>
            {zoomLevel}×
          </div>

          {/* Zoom in */}
          <button onClick={handleZoomIn} title="Zoom In (or scroll ↑)"
            style={{
              padding:"2px 7px",borderRadius:4,cursor:"pointer",fontWeight:700,fontSize:12,
              border:`1px solid ${dark?"#2a2a44":"#c0c0d8"}`,
              background:dark?"#0e0e18":"#f0f0fc",color:dark?"#7070b0":"#6060a0",
              transition:"all .15s",lineHeight:1,
            }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--cyan)";e.currentTarget.style.color="var(--cyan)";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=dark?"#2a2a44":"#c0c0d8";e.currentTarget.style.color=dark?"#7070b0":"#6060a0";}}>
            +
          </button>

          {/* Reset zoom */}
          {isZoomed && (
            <button onClick={handleZoomReset} title="Reset to full view"
              style={{
                padding:"2px 8px",borderRadius:4,cursor:"pointer",fontFamily:"var(--font-mono)",fontSize:8,fontWeight:700,
                border:`1px solid rgba(6,182,212,0.4)`,
                background:dark?"rgba(6,182,212,0.08)":"rgba(2,132,199,0.07)",color:dark?"var(--cyan)":"#0284c7",
                transition:"all .15s",
              }}>
              ⟲ FIT
            </button>
          )}
        </div>

        {/* Re-animate button */}
        <button onClick={() => setAnimKey(k => k+1)} style={{
          padding:"3px 10px",borderRadius:6,cursor:"pointer",
          fontFamily:"var(--font-mono)",fontSize:9,fontWeight:700,
          border:`1.5px solid ${dark?"#2a2a44":"#c0c0d8"}`,
          background: dark?"#0e0e18":"#f0f0fc",
          color:dark?"#5050a0":"#8080c0",
          transition:"all .15s",
        }}
        onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--amber)";e.currentTarget.style.color="var(--amber)";}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor=dark?"#2a2a44":"#c0c0d8";e.currentTarget.style.color=dark?"#5050a0":"#8080c0";}}>
          ↺ Replay
        </button>
      </div>

      {/* ── Zoom hint (shows when auto-zoomed) ── */}
      {isZoomed && (
        <div style={{
          flexShrink:0,padding:"3px 14px",
          background: dark ? "rgba(6,182,212,0.06)" : "rgba(2,132,199,0.05)",
          borderBottom:`1px solid ${dark?"rgba(6,182,212,0.12)":"rgba(2,132,199,0.15)"}`,
          display:"flex",alignItems:"center",gap:8,
          animation:"fade-up 0.3s ease",
        }}>
          <span style={{fontSize:8.5,fontFamily:"var(--font-mono)",color:dark?"var(--cyan)":"#0284c7",fontWeight:700}}>
            🔍 ZOOMED VIEW
          </span>
          <span style={{fontSize:8,fontFamily:"var(--font-mono)",color:textC,opacity:0.7}}>
            Showing {Math.round(viewStart)}m – {Math.round(viewEnd)}m of {Math.round(maxD)}m total
          </span>
          <span style={{fontSize:8,fontFamily:"var(--font-mono)",color:textC,opacity:0.5}}>
            · Scroll to zoom · Click+drag to pan
          </span>
        </div>
      )}

      {/* ── SVG Chart + Minimap wrapper ── */}
      <div style={{flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minHeight:0}}>

        {/* Scrollable chart area */}
        <div
          ref={zoomContainerRef}
          style={{flex:1,overflow:"auto",padding:"6px 10px 4px",position:"relative"}}
        >
        <svg ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{width:"100%",minHeight:340,display:"block",userSelect:"none",
            cursor: isPanning ? "grabbing" : "crosshair",
          }}
          preserveAspectRatio="xMidYMid meet"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            hideTip();
            if(crossGRef.current) crossGRef.current.style.display='none';
            crossXRef.current=null;
            handlePanEnd();
          }}>

          <Defs/>
          {/* Clip paths:
              pvChartClip  — chart area only (MA/SSP/Grad/TSR/TC/LC/TO)
              pvFullClip   — full chart + below-axis strip (TLI tags row) */}
          <defs>
            <clipPath id="pvChartClip">
              <rect x={OX} y={PAD_T-4} width={GW+4} height={GH+8}/>
            </clipPath>
            <clipPath id="pvFullClip">
              <rect x={OX} y={PAD_T-4} width={GW+4} height={GH + 160}/>
            </clipPath>
          </defs>

          {/* ── Background ── */}
          <rect x={0} y={0} width={W} height={H} fill={bgC}/>
          {/* Subtle alternating band pattern */}
          <rect x={OX} y={PAD_T} width={GW} height={GH} fill="url(#pvStripe)"/>

          {/* ── Y grid lines ── */}
          {yTicks.map(s => (
            <g key={`yg-${s}`}>
              <line x1={OX} y1={yS(s)} x2={OX+GW} y2={yS(s)}
                stroke={dark?"#0f1020":"#e0e0ee"} strokeWidth={s===0?1.5:1}
                strokeDasharray={s===0?"none":"4,6"} opacity={s===0?0.9:0.8}/>
              <text x={OX-10} y={yS(s)+4} textAnchor="end" fontSize={10}
                fill={textC} fontFamily="monospace" fontWeight={s===0?"700":"400"}>{s}</text>
              <line x1={OX-4} y1={yS(s)} x2={OX} y2={yS(s)} stroke={axisC} strokeWidth={1.5}/>
            </g>
          ))}

          {/* ── X grid lines ── */}
          {xTicks.map(d => (
            <g key={`xg-${d}`}>
              <line x1={xS(d)} y1={PAD_T} x2={xS(d)} y2={OY}
                stroke={dark?"#0f1020":"#e0e0ee"} strokeWidth={d===0?1.5:1}
                strokeDasharray={d===0?"none":"4,6"} opacity={0.8}/>
              <line x1={xS(d)} y1={OY} x2={xS(d)} y2={OY+5} stroke={axisC} strokeWidth={1.5}/>
              <text x={xS(d)} y={OY+16} textAnchor="middle" fontSize={9}
                fill={textC} fontFamily="monospace">{d>=1000?`${d/1000}k`:d}m</text>
            </g>
          ))}

          {/* ── Axes ── */}
          {/* Y axis */}
          <line x1={OX} y1={OY+2} x2={OX} y2={PAD_T-12}
            stroke={axisC} strokeWidth={2.5}/>
          <polygon points={`${OX-5},${PAD_T-12} ${OX+5},${PAD_T-12} ${OX},${PAD_T-24}`}
            fill={axisC}/>
          {/* X axis — ends exactly at the last data point (OX+GW), arrow just beyond */}
          <line x1={OX-2} y1={OY} x2={OX+GW} y2={OY}
            stroke={axisC} strokeWidth={2.5}/>
          <polygon points={`${OX+GW},${OY-5} ${OX+GW},${OY+5} ${OX+GW+12},${OY}`}
            fill={axisC}/>

          {/* ── Axis labels ── */}
          <text x={OX+GW/2} y={H-8} textAnchor="middle" fontSize={11} fontWeight="700"
            fill={axisC} fontFamily="monospace">
            {/* ← Distance from Ref RFID #{prof.refRFID??"?"} (metres) → */}
          </text>
          <text x={16} y={OY-GH/2} textAnchor="middle" fontSize={11} fontWeight="700"
            fill={axisC} fontFamily="monospace"
            transform={`rotate(-90,16,${OY-GH/2})`}>Speed (kmph) ↑</text>

          {/* ── Chart title ── */}
          <text x={OX+GW/2} y={PAD_T-18} textAnchor="middle" fontSize={13} fontWeight="800"
            fill={titleC} fontFamily="monospace"
            style={dark?{filter:`drop-shadow(0 0 8px rgba(180,180,255,0.4))`}:{}}>
            KAVACH C.4.2 Profile · Stn #{prof.stnId??"?"} → Loco #{prof.destLoco??"?"} · Auth {prof.authSpeed} kmph · MA {prof.maWRT<65535?prof.maWRT+"m":"SR"}{isZoomed?` · 🔍 ${Math.round(viewStart)}–${Math.round(viewEnd)}m`:""}
          </text>

          {/* ── Origin dot ── */}
          <circle cx={OX} cy={OY} r={5} fill={PV_COLORS.rfid}
            style={dark?{filter:`drop-shadow(0 0 6px ${PV_COLORS.rfid})`}:{}}/>

          {/* ── Profile layers (order matters — back to front) ── */}
          {/* Chart layers: clipped to chart area so nothing bleeds outside axes */}
          <g clipPath="url(#pvChartClip)">
            {vis.ma   && <MaLayer/>}
            {vis.tsr  && <TsrLayer/>}
            {vis.tc   && <TcLayer/>}
            {vis.grad && <GradLayer/>}
            {vis.ssp  && <SspLayer/>}
            {vis.lc   && <LcLayer/>}
            {vis.to   && <ToLayer/>}
          </g>
          {/* TLI renders below the X axis — needs wider clip (not chart clip) */}
          {vis.tli && (
            <g clipPath="url(#pvFullClip)">
              <TliLayer/>
            </g>
          )}

          {/* ── Crosshair — DOM-controlled via ref, never triggers re-render ── */}
          <g ref={crossGRef} style={{pointerEvents:"none", display:"none"}}>
            <line x1={OX} y1={PAD_T} x2={OX} y2={OY}
              stroke={dark?"rgba(255,255,255,0.25)":"rgba(0,0,60,0.2)"}
              strokeWidth={1} strokeDasharray="4,3"/>
            <rect x={OX-28} y={OY+5} width={56} height={14} rx={3}
              fill={dark?"#111120":"#eeeeff"} stroke={dark?"#2a2a50":"#c0c0e8"} strokeWidth={1}/>
            <text x={OX} y={OY+16} textAnchor="middle" fontSize={9}
              fill={axisC} fontFamily="monospace" fontWeight="700"></text>
          </g>

          {/* ── Chart-area interaction overlay — zoom & pan ONLY inside the graph ── */}
          <rect
            x={OX} y={PAD_T} width={GW} height={GH}
            fill="transparent"
            style={{cursor: isPanning ? "grabbing" : isZoomed ? "grab" : "crosshair"}}
            onWheel={e => { e.preventDefault(); handleWheel(e); }}
            onMouseDown={handlePanStart}
          />

          {/* ── Scan line animation (fires once on load) ── */}
          <line key={`scan-${animKey}`}
            x1={OX} y1={PAD_T} x2={OX} y2={OY}
            stroke={dark?"rgba(160,160,255,0.3)":"rgba(100,100,200,0.2)"}
            strokeWidth={2}
            className="pv-scan-line"
            style={{'--pv-scan-w': `${GW}px`}}/>

        </svg>

        {/* ── Floating tooltip ── */}
        {tip && (
          <div style={{
            position:"absolute",
            left: Math.min(tip.px+16, 9999),
            top:  Math.max(tip.py-14, 4),
            background: dark ? "rgba(8,8,20,0.97)" : "rgba(250,250,255,0.98)",
            border:`1px solid ${dark?"#2a2a5a":"#c0c0e0"}`,
            borderRadius:8, padding:"8px 12px", pointerEvents:"none",
            zIndex:100,
            boxShadow: dark
              ? "0 4px 24px rgba(0,0,0,0.7), 0 0 0 1px rgba(100,100,200,0.1)"
              : "0 4px 16px rgba(0,0,60,0.15)",
            minWidth:170, backdropFilter:"blur(8px)",
          }}>
            {tip.lines.map((line,i) => (
              <div key={i} style={{
                fontSize: i===0 ? 11 : 10,
                fontWeight: i===0 ? 800 : 400,
                color: i===0 ? (dark?"#e8e8ff":"#1a1a3e") : (dark?"#7070b0":"#6060a0"),
                fontFamily:"var(--font-mono)", lineHeight:1.7,
                borderBottom: i===0 ? `1px solid ${dark?"#1e1e3e":"#e0e0f0"}` : 'none',
                paddingBottom: i===0 ? 4 : 0,
                marginBottom: i===0 ? 4 : 0,
              }}>{line}</div>
            ))}
          </div>
        )}
        </div>{/* end scrollable chart div */}

        {/* ── Mini-map navigator — OUTSIDE scroll area, always visible at bottom ── */}
        {isZoomed && (() => {
          const totalRange = maxD || 500;
          const vsF = viewStart / totalRange;
          const veF = Math.min(viewEnd / totalRange, 1);
          const thumbL = vsF * 100;
          const thumbW = Math.max(2, (veF - vsF) * 100);

          const onThumbMouseDown = (e) => {
            e.stopPropagation();
            const startX = e.clientX;
            const startL = vsF;
            const span   = veF - vsF;
            const barEl  = e.currentTarget.parentElement;
            const onMove = (mv) => {
              const barW = barEl.offsetWidth;
              const delta = (mv.clientX - startX) / barW;
              const newL  = Math.max(0, Math.min(1 - span, startL + delta));
              setZoomRange([newL * totalRange, (newL + span) * totalRange]);
            };
            const onUp = () => {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          };

          const onTrackClick = (e) => {
            // Don't trigger if clicking on the thumb itself
            if (e.target === e.currentTarget.querySelector('.mm-thumb')) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = (e.clientX - rect.left) / rect.width;
            const span = veF - vsF;
            const newL = Math.max(0, Math.min(1 - span, frac - span / 2));
            setZoomRange([newL * totalRange, (newL + span) * totalRange]);
          };

          return (
            <div style={{
              flexShrink:0,
              padding:"5px 10px 6px",
              background: dark ? "#07070e" : "#f2f2fa",
              borderTop:`1px solid ${dark?"#141428":"#d0d0ec"}`,
            }}>
              {/* Header row */}
              <div style={{
                display:"flex", justifyContent:"space-between", alignItems:"center",
                fontSize:8, fontFamily:"var(--font-mono)",
                color: textC, marginBottom:4, userSelect:"none",
              }}>
                <span style={{opacity:0.55}}>0</span>
                <span style={{
                  color:dark?"var(--cyan)":"#0284c7", fontWeight:700, opacity:1,
                  display:"flex", alignItems:"center", gap:5,
                }}>
                  <span style={{
                    display:"inline-block", width:6, height:6, borderRadius:"50%",
                    background:dark?"var(--cyan)":"#0284c7",
                    animation:"pulse-amber 1.5s ease-in-out infinite",
                  }}/>
                  OVERVIEW · drag to pan · click to jump
                </span>
                <span style={{opacity:0.55}}>{maxD>=1000?`${(maxD/1000).toFixed(1)} km`:`${maxD} m`}</span>
              </div>

              {/* Track bar */}
              <div
                onClick={onTrackClick}
                style={{
                  position:"relative", height:22, borderRadius:5, cursor:"pointer",
                  background: dark?"#0d0d1c":"#e4e4f4",
                  border:`1px solid ${dark?"#1c1c38":"#c4c4e0"}`,
                }}
              >
                {/* SSP zones */}
                {prof.ssp.map((seg,i) => (
                  <div key={i} style={{
                    position:"absolute",
                    left:`${(seg.startDist/totalRange)*100}%`,
                    width:`${Math.max(0.3,(seg.endDist-seg.startDist)/totalRange*100)}%`,
                    top:2, bottom:2,
                    background:PV_COLORS.ssp, opacity:0.2, borderRadius:2,
                    pointerEvents:"none",
                  }}/>
                ))}
                {/* Gradient zones */}
                {prof.gradEntries.map((seg,i) => (
                  <div key={i} style={{
                    position:"absolute",
                    left:`${(seg.startDist/totalRange)*100}%`,
                    width:`${Math.max(0.3,(seg.endDist-seg.startDist)/totalRange*100)}%`,
                    top:2, bottom:2,
                    background:PV_COLORS.grad, opacity:0.12, borderRadius:2,
                    pointerEvents:"none",
                  }}/>
                ))}
                {/* RFID tag ticks */}
                {prof.rfidTags.map((tag,i) => (
                  <div key={i} style={{
                    position:"absolute",
                    left:`${(tag.cumDist/totalRange)*100}%`,
                    top:4, bottom:4, width:1,
                    background:PV_COLORS.rfid, opacity:0.4,
                    pointerEvents:"none",
                  }}/>
                ))}
                {/* MA end marker */}
                {prof.maEnd>0 && prof.maEnd<=totalRange && (
                  <div style={{
                    position:"absolute",
                    left:`${(prof.maEnd/totalRange)*100}%`,
                    top:0, bottom:0, width:2,
                    background:PV_COLORS.ma, opacity:0.65,
                    pointerEvents:"none",
                  }}/>
                )}
                {/* Viewport thumb */}
                <div
                  className="mm-thumb"
                  onMouseDown={onThumbMouseDown}
                  onClick={e => e.stopPropagation()}
                  style={{
                    position:"absolute",
                    left:`${thumbL}%`, width:`${thumbW}%`,
                    top:0, bottom:0,
                    background: dark?"rgba(6,182,212,0.22)":"rgba(2,132,199,0.18)",
                    border:`2px solid ${dark?"rgba(6,182,212,0.9)":"rgba(2,132,199,0.85)"}`,
                    borderRadius:4,
                    cursor:"ew-resize",
                    boxShadow: dark?"0 0 8px rgba(6,182,212,0.4)":"0 0 6px rgba(2,132,199,0.3)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    transition:"box-shadow 0.15s",
                    minWidth:8,
                  }}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow=dark?"0 0 14px rgba(6,182,212,0.7)":"0 0 12px rgba(2,132,199,0.55)"}
                  onMouseLeave={e=>e.currentTarget.style.boxShadow=dark?"0 0 8px rgba(6,182,212,0.4)":"0 0 6px rgba(2,132,199,0.3)"}
                >
                  {thumbW > 5 && (
                    <span style={{
                      fontSize:7, fontFamily:"var(--font-mono)", fontWeight:700, pointerEvents:"none",
                      color:dark?"rgba(6,182,212,0.95)":"rgba(2,132,199,0.9)", userSelect:"none",
                      whiteSpace:"nowrap", overflow:"hidden",
                    }}>
                      {(viewEnd-viewStart)>=1000
                        ? `${((viewEnd-viewStart)/1000).toFixed(1)}km`
                        : `${Math.round(viewEnd-viewStart)}m`}
                    </span>
                  )}
                </div>
              </div>

              {/* Current view range */}
              <div style={{
                display:"flex", justifyContent:"space-between",
                fontSize:7.5, fontFamily:"var(--font-mono)",
                color:dark?"var(--cyan)":"#0284c7",
                marginTop:3, userSelect:"none",
              }}>
                <span>{viewStart>=1000?`${(viewStart/1000).toFixed(2)}km`:`${Math.round(viewStart)}m`}</span>
                <span>{viewEnd>=1000?`${(viewEnd/1000).toFixed(2)}km`:`${Math.round(viewEnd)}m`}</span>
              </div>
            </div>
          );
        })()}

      </div>{/* end SVG+minimap wrapper */}
    </div>
  );
}
function LiveTab({ isLight }) {

  /* ── SOS field registry — defined first so checkSOS can reference it ── */
  const SOS_FIELDS = useMemo(() => ({
    "EMERGENCY_STATUS": {
      label:"Emergency Status",
      colors:{
        1:{bg:"#7f1d1d",border:"#ef4444",text:"#fca5a5",name:"Unusual Stoppage / Side Collision"},
        2:{bg:"#7f1d1d",border:"#ef4444",text:"#fca5a5",name:"SoS"},
        3:{bg:"#92400e",border:"#f97316",text:"#fed7aa",name:"Roll Back Detected"},
        4:{bg:"#7f1d1d",border:"#dc2626",text:"#fca5a5",name:"Head On Collision"},
        5:{bg:"#7f1d1d",border:"#dc2626",text:"#fca5a5",name:"Rear End Collision"},
        6:{bg:"#92400e",border:"#f97316",text:"#fed7aa",name:"Parting SoS"},
      },
    },
    "DEST_LOCO_SOS": {
      label:"Station → Loco SoS",
      colors:{
        1:{bg:"#1e3a5f",border:"#3b82f6",text:"#bfdbfe",name:"Foreign RFID"},
        3:{bg:"#1e3a5f",border:"#3b82f6",text:"#bfdbfe",name:"Onboard Odo error ≥ 120m"},
        4:{bg:"#7f1d1d",border:"#ef4444",text:"#fca5a5",name:"SPAD Detected"},
        5:{bg:"#7f1d1d",border:"#dc2626",text:"#fca5a5",name:"Rear-end Collision"},
        6:{bg:"#7f1d1d",border:"#dc2626",text:"#fca5a5",name:"Head-On Collision"},
        7:{bg:"#92400e",border:"#f97316",text:"#fed7aa",name:"Shunting Limit Violation"},
        8:{bg:"#7f1d1d",border:"#ef4444",text:"#fca5a5",name:"Station General SoS"},
      },
    },
    "GEN_SOS_CALL": {
      label:"General SoS Call",
      colors:{
        1:{bg:"#7f1d1d",border:"#ef4444",text:"#fca5a5",name:"Manual SOS Button Pressed"},
      },
    },
    "Brake_Applied": {
      label:"Brake Applied",
      colors:{
        4:{bg:"#92400e",border:"#f97316",text:"#fed7aa",name:"Emergency Brake by Kavach"},
      },
    },
  }), []);

  /* ── State ── */
  const [livePackets,    setLivePackets]    = useState([]);
  const [wsState,        setWsState]        = useState("connecting");
  const [paused,         setPaused]         = useState(false);
  const [liveFilter,     setLiveFilter]     = useState("all");
  const [sourceFilter,   setSourceFilter]   = useState("all");
  const [autoScroll,     setAutoScroll]     = useState(() => appSettingsStore.get().liveAutoScroll);
  const [totalReceived,  setTotalReceived]  = useState(0);
  const [liveToasts,     setLiveToasts]     = useState([]);
  const [showClearRange, setShowClearRange] = useState(false);
  const [clearFrom,      setClearFrom]      = useState("");
  const [clearTo,        setClearTo]        = useState("");
  const [dmiView,        setDmiView]        = useState(() => appSettingsStore.get().liveDefaultView === "dmi");      // ⚙ Settings → LIVE
  const [profileView,    setProfileView]    = useState(() => appSettingsStore.get().liveDefaultView === "profile");

  /* ── Refs ── */
  const pauseBuffer = useRef([]);
  const lastBrakeRef = useRef({});   // per source: last Brake_Applied + when it beeped
  const lastSosRef   = useRef({});   // per sender + field: last SOS value + when it alerted
  const totalRef    = useRef(0);
  const pausedRef   = useRef(false);
  // DMI / visualiser: key packets of the whole session + glitch-filtered positions, so the
  // result never depends on how many rows the LIVE list keeps (capture → identical replay)
  const dmiKeeper   = useRef(null);
  if (!dmiKeeper.current) dmiKeeper.current = createDmiKeeper();
  const [dmiKeepVer, setDmiKeepVer] = useState(0);
  const drainTimer  = useRef(null);
  const bottomRef   = useRef(null);
  const seenIdxRef  = useRef(new Set());     // packet_index already listed (history re-sent on reconnect is skipped)
  const listBoxRef  = useRef(null);          // packet list scroller
  const atBottomRef = useRef(true);          // user is at the newest packet → auto-scroll follows
  const seenTotalRef = useRef(0);            // TOTAL when the user scrolled up (for "n new")
  const [atBottom, setAtBottom] = useState(true);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const clearBoxRef = useRef(null);
  const liveCfg     = useStore(appSettingsStore);       // ⚙ Settings → LIVE
  const MAX_ROWS    = liveCfg.liveMaxRows || 300;
  const maxRowsRef  = useRef(MAX_ROWS);
  maxRowsRef.current = MAX_ROWS;

  /* ── Sync pausedRef with state ── */
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  /* ── Restore total on tab switch ── */
  useEffect(() => { setTotalReceived(totalRef.current); }, []);

  /* ── Toast helpers ── */
  const addLiveToast = useCallback((toast) => {
    const id = Date.now() + Math.random();
    const dur = (appSettingsStore.get().liveAlertSecs || 8) * 1000;
    setLiveToasts(prev => [...prev.slice(-3), { ...toast, id, exiting:false, duration:dur }]);
    setTimeout(() => {
      setLiveToasts(prev => prev.map(t => t.id===id ? {...t,exiting:true} : t));
      setTimeout(() => setLiveToasts(prev => prev.filter(t => t.id!==id)), 350);
    }, dur);
  }, []);

  const dismissToast = useCallback((id) => {
    stopAlertSound();                                    // closing an alert silences its buzzer
    setLiveToasts(prev => prev.map(t => t.id===id ? {...t,exiting:true} : t));
    setTimeout(() => setLiveToasts(prev => prev.filter(t => t.id!==id)), 350);
  }, []);

  /* ── SOS detection ── */
  const checkSOS = useCallback((pkt) => {
    // ⚙ Settings → LIVE → pop-up alerts on/off; the SOS buzzer (⚙ → 🔊 SOUND)
    // is decided separately, so it still sounds with the pop-ups switched off.
    const popups = appSettingsStore.get().liveAlerts;
    let buzz = null;                                       // most severe SOS buzzer for this packet
    const noteBuzz = c => { if (c && (!buzz || SOS_SOUNDS[c].prio > SOS_SOUNDS[buzz].prio)) buzz = c; };
    // A persistent condition (e.g. DEST_LOCO_SOS in every C.4.2, every 2 s) alerts — buzzer
    // and pop-up — when it first appears or changes, then again every 30 s while it lasts.
    // Without this the buzzer restarted on every packet and cut off the brake voice / beeps.
    const sosFresh = (key, val) => {
      const last = lastSosRef.current[key], t = Date.now();
      if (last && last.val === val && t - last.at < 30000) return false;
      lastSosRef.current[key] = { val, at: t };
      return true;
    };
    const fv = n => Number((fields.find(x => (x.Field||"").trim()===n) || {})["Decimal Value"]) || 0;
    const sosKey = fn => `${pkt.packet_type_value}|${fv("SOURCE_LOCO_ID")||fv("SOURCE_STN_ILC_IBS_ID")||fv("SOURCE_STN_ID")}|${fv("DEST_LOCO_ID")}|${fn}`;
    const fields = pkt.fields || [];
    const meta = PKT_META[pkt.packet_type_value] || {};

    // Helper: extract source identity from the packet fields
    const getSourceId = () => {
      const locoF = fields.find(f => (f.Field||"").trim()==="SOURCE_LOCO_ID");
      const stnF  = fields.find(f => (f.Field||"").trim()==="SOURCE_STN_ILC_IBS_ID"
                                  || (f.Field||"").trim()==="SOURCE_STN_ID");
      const destF = fields.find(f => (f.Field||"").trim()==="DEST_LOCO_ID");
      if (locoF && Number(locoF["Decimal Value"]) > 0)
        return { type:"loco", id: Number(locoF["Decimal Value"]), label:`Loco #${locoF["Decimal Value"]}` };
      if (stnF  && Number(stnF["Decimal Value"])  > 0)
        return { type:"station", id: Number(stnF["Decimal Value"]),  label:`Station #${stnF["Decimal Value"]}` };
      if (destF && Number(destF["Decimal Value"]) > 0)
        return { type:"loco", id: Number(destF["Decimal Value"]), label:`Loco #${destF["Decimal Value"]} (dest)` };
      return { type:"unknown", id:null, label:"Unknown origin" };
    };

    // C.4.5 — entire packet type is Emergency, always fire toast
    if (Number(pkt.packet_type_value) === 12) {
      const f1 = fields.find(f => (f.Field||"").trim()==="GEN_SOS_CALL");
      const f2 = fields.find(f => (f.Field||"").trim()==="EMERGENCY_STATUS");
      const v1 = Number(f1?.["Decimal Value"]) || 0;
      const v2 = Number(f2?.["Decimal Value"]) || 0;
      const cfg = SOS_FIELDS["GEN_SOS_CALL"].colors[v1]
               || SOS_FIELDS["EMERGENCY_STATUS"].colors[v2]
               || {bg:"#7f1d1d",border:"#ef4444",text:"#fca5a5",name:"Emergency Packet Received"};
      if (!sosFresh(sosKey("C45"), v1 * 8 + v2)) return;
      noteBuzz(sosCategory("GEN_SOS_CALL", v1) || sosCategory("EMERGENCY_STATUS", v2) || "call");
      playSosAlert(buzz, { source: "live" });
      if (popups) addLiveToast({
        kind:        "sos",
        packetType:  "C.4.5 Emergency", packetAbbr:"Emer",
        fieldName:   v1>0 ? "GEN_SOS_CALL" : v2>0 ? "EMERGENCY_STATUS" : "PKT_TYPE=12",
        fieldLabel:  "Additional Emergency Packet",
        sosName:     cfg.name,
        description: f1?.Description || f2?.Description || "Station-originated emergency packet received",
        bg:cfg.bg, border:cfg.border, text:cfg.text,
        origin:      getSourceId(),
        packetIndex: pkt.packet_index, source:pkt.source, time:pkt.received_at_iso,
      });
      return;
    }

    // 🛑 Brake beep (⚙ → 🔊 SOUND → brake beeps): Brake_Applied 2 NSB · 3 FSB
    // · 4 EB. Beeps on a new brake application per loco, and again every 10 s
    // while the same brake stays applied (packets keep arriving every 2 s).
    // An SOS in the same packet takes over (higher priority, played below).
    {
      const bf = fields.find(f => (f.Field||"").trim()==="Brake_Applied");
      const bv = Number(bf?.["Decimal Value"]) || 0;
      if (bf) {
        const who  = getSourceId().label;
        const last = lastBrakeRef.current[who];
        if (bv >= 1 && bv <= 4) {                       // 1 Overspeed = voice-over only
          if (!last || last.code !== bv || Date.now() - last.at > 10000) {
            playBrakeAlert(bv, { source: "live" });
            lastBrakeRef.current[who] = { code: bv, at: Date.now() };
          }
        } else {
          lastBrakeRef.current[who] = { code: bv, at: Date.now() };
        }
      }
    }

    // Scan all fields for SOS/emergency values that are non-zero
    for (const f of fields) {
      const fn  = (f.Field||"").trim();
      const val = Number(f["Decimal Value"]);
      if (!SOS_FIELDS[fn] || isNaN(val)) continue;
      if (val === 0) { lastSosRef.current[sosKey(fn)] = { val: 0, at: Date.now() }; continue; }   // cleared → next one alerts again
      const cfg = SOS_FIELDS[fn].colors[val];
      if (!cfg) continue;
      if (!sosFresh(sosKey(fn), val)) continue;
      // Distinguish brake from SOS
      const isBrake = fn === "Brake_Applied";
      noteBuzz(sosCategory(fn, val));
      if (popups) addLiveToast({
        kind:        isBrake ? "brake" : "sos",
        packetType:  meta.name || pkt.packet_type_name || "Unknown",
        packetAbbr:  meta.abbr || meta.short || "?",
        fieldName:   fn,
        fieldLabel:  SOS_FIELDS[fn].label,
        sosName:     cfg.name,
        description: f.Description || cfg.name,
        bg:cfg.bg, border:cfg.border, text:cfg.text,
        origin:      getSourceId(),
        packetIndex: pkt.packet_index,
        source:      pkt.source,
        time:        pkt.received_at_iso,
      });
    }
    if (buzz) playSosAlert(buzz, { source: "live" });
  }, [SOS_FIELDS, addLiveToast]);

  /* ── addPackets — uses refs only, no stale closures ── */
  const addPackets = useCallback((pkts, isHistory=false) => {
    let normalized = pkts.map(p => ({ ...normalizeResult(p), _isHistory: isHistory }));
    {                                      // each backend packet number is listed once (history re-sent on reconnect, or a duplicate delivery)
      const have = seenIdxRef.current;
      normalized = normalized.filter(p => p.packet_index == null || !have.has(p.packet_index));
      if (!normalized.length) return;
    }
    normalized.forEach(p => { if (p.packet_index != null) seenIdxRef.current.add(p.packet_index); });
    let kept = false;
    normalized.forEach(p => { if (dmiKeeper.current.ingest(p)) kept = true; });
    if (kept) setDmiKeepVer(v => v + 1);
    if (pausedRef.current && !isHistory) { pauseBuffer.current.push(...normalized); return; }
    setLivePackets(prev => {
      const all = [...prev, ...normalized];
      if (isHistory) all.sort((a, b) => (a.packet_index ?? 0) - (b.packet_index ?? 0));   // history fills the gap in order
      return all.slice(-maxRowsRef.current);
    });
    if (!isHistory) {
      totalRef.current += normalized.length;
      setTotalReceived(totalRef.current);
      normalized.forEach(p => checkSOS(p));
    }
  }, [checkSOS]);

  /* ── WebSocket ── */
  // ONE connection only. Before, closing the socket in the effect cleanup fired its onclose,
  // which scheduled a reconnect nobody cancelled — every effect re-run (and React's dev
  // double-mount) left one more live socket, so each packet was listed 2, 3, 4 … times.
  const addPacketsRef = useRef(addPackets);
  addPacketsRef.current = addPackets;
  useEffect(() => {
    let ws, reconnectTimer, disposed = false;
    const connect = () => {
      if (disposed) return;
      setWsState("connecting");
      ws = new WebSocket("ws://localhost:8000/ws/live");
      ws.onopen  = () => { if (!disposed) setWsState("open"); };
      ws.onclose = () => { if (disposed) return; setWsState("closed"); reconnectTimer = setTimeout(connect, 3000); };
      ws.onerror = () => { if (!disposed) setWsState("error"); };
      ws.onmessage = (evt) => {
        if (disposed) return;
        const addPackets = addPacketsRef.current;
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type==="packet")  addPackets([msg.data], false);
          if (msg.type==="history") addPackets([msg.data], true);
          if (msg.type==="history_batch" && Array.isArray(msg.data)) addPackets(msg.data, true);   // whole session on (re)connect
          if (msg.type==="connected") {
            // backend restarted (its counter is behind what we have seen) → packet numbers start again
            const maxSeen = Math.max(0, ...seenIdxRef.current);
            if ((msg.data?.total_packets ?? 0) < maxSeen) seenIdxRef.current = new Set();
          }
          if (msg.type==="connected" && msg.data?.total_packets && totalRef.current===0) {
            totalRef.current = msg.data.total_packets;
            setTotalReceived(msg.data.total_packets);
          }
          if (msg.type==="session_cleared") {
            setLivePackets([]); totalRef.current=0; setTotalReceived(0); pauseBuffer.current=[];
            seenIdxRef.current = new Set();
            dmiKeeper.current.reset(); setDmiKeepVer(v => v + 1);
          }
        } catch(_){}
      };
    };
    connect();
    return () => { disposed = true; clearTimeout(reconnectTimer); ws?.close(); };
  }, []);

  /* ── Auto-scroll: follows the newest packet only while the list is at the bottom.
        Scroll up to read older packets and it stays there; "↓ LATEST" jumps back. ── */
  useEffect(() => {
    const box = listBoxRef.current;
    if (autoScroll && box && !paused && atBottomRef.current) box.scrollTop = box.scrollHeight;
  }, [livePackets, autoScroll, paused, dmiView, profileView]);
  const onListScroll = e => {
    const b = e.currentTarget;
    const at = b.scrollHeight - b.scrollTop - b.clientHeight < 48;
    if (at === atBottomRef.current) return;
    if (!at) seenTotalRef.current = totalRef.current;
    atBottomRef.current = at; setAtBottom(at);
  };
  const jumpLatest = () => {
    const b = listBoxRef.current; if (!b) return;
    atBottomRef.current = true; setAtBottom(true);
    b.scrollTo({ top: b.scrollHeight, behavior: "smooth" });
  };

  /* CLEAR popover: Esc or a click outside closes it */
  useEffect(() => {
    if (!showClearRange) { setConfirmClearAll(false); return undefined; }
    const onDown = e => { if (clearBoxRef.current && !clearBoxRef.current.contains(e.target)) setShowClearRange(false); };
    const onKey = e => { if (e.key === "Escape") setShowClearRange(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [showClearRange]);
  useEffect(() => {                      // the "confirm" state of CLEAR ALL times out
    if (!confirmClearAll) return undefined;
    const t = setTimeout(() => setConfirmClearAll(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClearAll]);

  /* ── Resume: one packet per 80ms ── */
  const resume = useCallback(() => {
    setPaused(false);
    pausedRef.current = false;
    if (drainTimer.current) { clearInterval(drainTimer.current); drainTimer.current=null; }
    if (pauseBuffer.current.length===0) return;
    drainTimer.current = setInterval(() => {
      if (pauseBuffer.current.length===0) { clearInterval(drainTimer.current); drainTimer.current=null; return; }
      const pkt = pauseBuffer.current.shift();
      setLivePackets(prev => [...prev, pkt].slice(-maxRowsRef.current));
      totalRef.current += 1;
      setTotalReceived(totalRef.current);
      checkSOS(pkt);
    }, 80);
  }, [checkSOS]);

  /* ── Clear helpers ── */
  // packet # range currently in the list, and what a range clear would remove
  const listIdx = livePackets.map(p => p.packet_index).filter(Number.isFinite);
  const listMin = listIdx.length ? Math.min(...listIdx) : null, listMax = listIdx.length ? Math.max(...listIdx) : null;
  const rangeFrom = clearFrom === "" ? listMin : parseInt(clearFrom, 10);
  const rangeTo   = clearTo === "" ? listMax : parseInt(clearTo, 10);
  const rangeBad  = !Number.isFinite(rangeFrom) || !Number.isFinite(rangeTo) || rangeFrom > rangeTo;
  const rangeCount = rangeBad ? 0 : listIdx.filter(i => i >= rangeFrom && i <= rangeTo).length;
  const clearByRange = () => {
    if (rangeBad || !rangeCount) return;
    setLivePackets(prev => prev.filter(p => { const idx=p.packet_index||0; return idx<rangeFrom||idx>rangeTo; }));
    setShowClearRange(false); setClearFrom(""); setClearTo("");
  };
  const clearAll = async () => {
    setLivePackets([]); totalRef.current=0; setTotalReceived(0); pauseBuffer.current=[];
    seenIdxRef.current = new Set(); atBottomRef.current = true; setAtBottom(true);
    setShowClearRange(false); setConfirmClearAll(false); setClearFrom(""); setClearTo("");
    dmiKeeper.current.reset(); setDmiKeepVer(v => v + 1);
    if (drainTimer.current) { clearInterval(drainTimer.current); drainTimer.current=null; }
    await fetch("http://localhost:8000/live/clear",{method:"POST"}).catch(()=>{});
  };

  const dmiPackets = useMemo(() => mergeKept(livePackets, dmiKeeper.current.packets()), [livePackets, dmiKeepVer]);

  // 🗺 PROFILE = the SVK SIM "● LIVE MA (ON WIRE)" track view, fed with the LIVE packets as its
  // serial log: station packets → "tx", loco C.4.3 / C.4.6 → "rx". One event object per packet
  // (cached), because the view folds each Station→Loco packet exactly once by identity.
  const ltpEvCache = useRef(new WeakMap());
  const liveTrackLog = useMemo(() => dmiPackets.filter(p => p.payload_hex).map(p => {
    let ev = ltpEvCache.current.get(p);
    if (!ev) {
      const t = Number(p.packet_type_value);
      ev = { type: t === 10 || t === 13 ? "rx" : "tx", hex: p.payload_hex, ts: p.received_at ? p.received_at * 1000 : undefined, packet_index: p.packet_index };
      ltpEvCache.current.set(p, ev);
    }
    return ev;
  }), [dmiPackets]);
  const { tags: tagRows, fileName: tagFile } = useStore(tagTableStore);   // optional — exact tag km, as on the DMI
  const liveTagTable = useMemo(() => (tagRows?.length ? { fileName: tagFile, map: Object.fromEntries(tagRows.map(t => [t.id, t.loc])) } : null), [tagRows, tagFile]);

  const filtered = useMemo(() => livePackets.filter(p =>
      (liveFilter==="all" || String(p.packet_type_value)===liveFilter) &&
      (sourceFilter==="all" || liveSourceGroup(p.source)===sourceFilter)),
  [livePackets, liveFilter, sourceFilter]);

  const wsColor = {connecting:"var(--amber)",open:"var(--green)",closed:"var(--red)",error:"var(--red)"}[wsState];
  const wsLabel = {connecting:"CONNECTING…",open:"LIVE",closed:"RECONNECTING…",error:"ERROR"}[wsState];

  /* ── Render ── */
  return (
    <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>

      {/* SOS / Brake Toast notifications — fixed bottom-right */}
      <div style={{position:"fixed",bottom:24,right:20,zIndex:9999,display:"flex",flexDirection:"column-reverse",gap:10,pointerEvents:"none",width:350}}>
        {liveToasts.map(t => {
          const isBrake = t.kind === "brake";
          const origin  = t.origin || { type:"unknown", label:"Unknown origin" };
          const originIsLoco    = origin.type === "loco";
          const originIsStation = origin.type === "station";

          // Brake gets a completely different amber/orange palette — not red
          const brakeScheme = {
            headerBg:  "linear-gradient(135deg,#78350f,#92400e)",
            bodyBg:    "#1c1007",
            accent:    "#f59e0b",
            accentDim: "#fbbf2488",
            ring:      "#f59e0b55",
            textColor: "#fde68a",
          };

          return (
            <div key={t.id} style={{
              pointerEvents:"all",
              borderRadius:12, overflow:"hidden",
              boxShadow: isBrake
                ? "0 4px 28px rgba(245,158,11,0.35), 0 2px 8px rgba(0,0,0,0.6)"
                : `0 4px 28px ${t.border}55, 0 2px 8px rgba(0,0,0,0.6)`,
              animation:t.exiting?"toast-out 0.3s ease forwards":"toast-in 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards",
              background: isBrake ? brakeScheme.bodyBg : t.bg,
              border: isBrake ? `2px solid ${brakeScheme.accent}` : `2px solid ${t.border}`,
            }}>

              {/* ── Header ── */}
              <div style={{
                padding:"9px 12px",
                background: isBrake
                  ? brakeScheme.headerBg
                  : `linear-gradient(135deg, ${t.border}55, ${t.border}22)`,
                borderBottom: isBrake
                  ? `1px solid ${brakeScheme.accent}44`
                  : `1px solid ${t.border}55`,
                display:"flex", alignItems:"center", gap:9,
              }}>
                {/* Icon — different for brake vs SOS */}
                <span style={{fontSize:18,flexShrink:0,animation:"pulse-amber 1s infinite"}}>
                  {isBrake ? "🛑" : "🚨"}
                </span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{
                    fontFamily:"var(--font-display)", fontSize:13,
                    letterSpacing:"0.12em", lineHeight:1,
                    color: isBrake ? brakeScheme.accent : "#fff",
                  }}>
                    {isBrake ? "BRAKE APPLIED — KAVACH" : "SOS / EMERGENCY DETECTED"}
                  </div>
                  <div style={{fontSize:9,color:isBrake?brakeScheme.accentDim:`${t.text}bb`,fontFamily:"var(--font-mono)",marginTop:3}}>
                    Pkt #{t.packetIndex} · {t.packetAbbr} · {t.time}
                  </div>
                </div>
                <button onClick={()=>dismissToast(t.id)} style={{
                  background:"rgba(0,0,0,0.3)",border:"none",borderRadius:5,
                  width:22,height:22,cursor:"pointer",
                  color: isBrake ? brakeScheme.accent : "#fff",
                  fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
                }}>×</button>
              </div>

              {/* ── Origin ID strip — HIGHLIGHTED ── */}
              <div style={{
                padding:"7px 12px",
                background: isBrake
                  ? "rgba(245,158,11,0.1)"
                  : `${t.border}18`,
                borderBottom: isBrake
                  ? `1px solid ${brakeScheme.accent}33`
                  : `1px solid ${t.border}33`,
                display:"flex", alignItems:"center", gap:8,
              }}>
                {/* Origin type icon */}
                <span style={{fontSize:13,flexShrink:0}}>
                  {originIsLoco ? "🚆" : originIsStation ? "🏠" : "❓"}
                </span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:8,color:isBrake?brakeScheme.accentDim:`${t.text}88`,fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:1}}>
                    {originIsLoco ? "ORIGINATING LOCO" : originIsStation ? "ORIGINATING STATION" : "ORIGIN"}
                  </div>
                  {/* The ID itself — large and prominent */}
                  <div style={{
                    fontFamily:"var(--font-display)",
                    fontSize:18,
                    letterSpacing:"0.1em",
                    lineHeight:1,
                    color: isBrake ? brakeScheme.accent : t.text,
                    fontWeight:900,
                  }}>
                    {origin.label}
                  </div>
                </div>
                {/* Source label pill */}
                <div style={{
                  fontSize:8, padding:"2px 8px", borderRadius:5, flexShrink:0,
                  fontFamily:"var(--font-mono)", fontWeight:700,
                  background:"rgba(0,0,0,0.3)",
                  color:isBrake?brakeScheme.textColor:t.text,
                  border:`1px solid ${isBrake?brakeScheme.accent+"44":t.border+"44"}`,
                }}>
                  {t.source || "unknown"}
                </div>
              </div>

              {/* ── Body ── */}
              <div style={{padding:"10px 12px"}}>
                {/* Packet type + field badges */}
                <div style={{display:"flex",gap:5,marginBottom:8,flexWrap:"wrap"}}>
                  <span style={{
                    fontSize:9,padding:"2px 8px",borderRadius:4,fontFamily:"var(--font-mono)",fontWeight:700,
                    background:isBrake?`${brakeScheme.accent}22`:`${t.border}22`,
                    color:isBrake?brakeScheme.accent:t.text,
                    border:`1px solid ${isBrake?brakeScheme.accent+"44":t.border+"44"}`,
                  }}>{t.packetAbbr} — {t.packetType}</span>
                  <span style={{
                    fontSize:9,padding:"2px 8px",borderRadius:4,fontFamily:"var(--font-mono)",fontWeight:700,
                    background:"rgba(255,255,255,0.05)",
                    color:isBrake?brakeScheme.accentDim:`${t.text}bb`,
                    border:`1px solid rgba(255,255,255,0.1)`,
                  }}>{t.fieldName}</span>
                </div>

                {/* SOS type box — different border treatment for brake */}
                <div style={{
                  background:"rgba(0,0,0,0.3)",
                  border: isBrake
                    ? `1px solid ${brakeScheme.accent}44`
                    : `1px solid ${t.border}44`,
                  borderLeft: isBrake
                    ? `3px solid ${brakeScheme.accent}`
                    : `3px solid ${t.border}`,
                  borderRadius:6,
                  padding:"8px 11px",
                  marginBottom:7,
                }}>
                  <div style={{
                    fontSize:8,
                    color:isBrake?brakeScheme.accentDim:`${t.text}88`,
                    fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4,
                  }}>
                    {isBrake ? "🛑 BRAKE TYPE" : "⚠ SOS TYPE"}
                  </div>
                  <div style={{
                    fontSize:13,fontWeight:700,lineHeight:1.35,
                    color:isBrake?brakeScheme.accent:t.text,
                  }}>
                    {t.sosName}
                  </div>
                </div>

                {/* Description */}
                <div style={{fontSize:9,color:isBrake?brakeScheme.accentDim:`${t.text}bb`,lineHeight:1.55,fontFamily:"var(--font-mono)"}}>
                  {t.description}
                </div>
              </div>

              {/* ── Countdown bar ── */}
              <div style={{height:3,background:"rgba(0,0,0,0.3)"}}>
                <div style={{
                  height:"100%",
                  background: isBrake ? brakeScheme.accent : t.border,
                  animation:`toast-bar ${t.duration}ms linear forwards`,
                }}/>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 14px",borderBottom:`1px solid var(--border)`,background:"var(--bg-surface)",flexShrink:0,flexWrap:"wrap"}}>
        {/* WS status */}
        <div style={{display:"flex",alignItems:"center",gap:5,padding:"3px 9px",borderRadius:5,border:`1px solid ${wsColor}44`,background:`${wsColor}12`}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:wsColor,animation:wsState!=="open"?"pulse-amber 1.2s infinite":"none"}}/>
          <span style={{fontSize:9,fontFamily:"var(--font-mono)",fontWeight:700,color:wsColor}}>{wsLabel}</span>
        </div>
        {/* Total */}
        <div style={{padding:"3px 9px",borderRadius:5,background:"var(--bg-raised)",border:"1px solid var(--border)",fontSize:11,fontFamily:"var(--font-mono)"}}>
          <span style={{color:"var(--text-muted)"}}>TOTAL </span>
          <span style={{color:"var(--amber)",fontWeight:700}}>{totalReceived}</span>
          {filtered.length!==livePackets.length&&<span style={{color:"var(--text-muted)",fontSize:9}}> / {filtered.length} shown</span>}
        </div>
        {/* Filter */}
        <select value={liveFilter} onChange={e=>setLiveFilter(e.target.value)} style={{padding:"3px 8px",borderRadius:5,background:"var(--bg-raised)",border:"1px solid var(--border)",color:"var(--text-primary)",fontSize:11,fontFamily:"var(--font-mono)",outline:"none"}}>
          <option value="all">All types</option>
          {Object.entries(PKT_META).map(([k,m])=><option key={k} value={k}>{m.abbr} — {m.name}</option>)}
        </select>
        {/* Source filter — UDP/HTTP, serial TX, serial RX, simulator, external */}
        <select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)} title="Show packets from one source only" style={{padding:"3px 8px",borderRadius:5,background:"var(--bg-raised)",border:"1px solid var(--border)",color:"var(--text-primary)",fontSize:11,fontFamily:"var(--font-mono)",outline:"none"}}>
          {LIVE_SOURCES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
        {/* Auto-scroll */}
        <label style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",cursor:"pointer"}}>
          <input type="checkbox" checked={autoScroll} onChange={e=>setAutoScroll(e.target.checked)} style={{accentColor:"var(--amber)"}}/>
          auto-scroll
        </label>
        {/* Pause/Resume */}
        <button onClick={()=>paused?resume():setPaused(true)} style={{padding:"3px 10px",borderRadius:5,fontSize:10,fontFamily:"var(--font-mono)",fontWeight:700,border:`1px solid ${paused?"var(--amber)":"var(--border)"}`,background:paused?"var(--amber-glow)":"var(--bg-raised)",color:paused?"var(--amber)":"var(--text-muted)",cursor:"pointer",transition:"all 0.15s"}}>
          {paused?`▶ RESUME${pauseBuffer.current.length>0?` (${pauseBuffer.current.length})`:""}` : "⏸ PAUSE"}
        </button>
        {/* Clear with range */}
        <div ref={clearBoxRef} style={{position:"relative"}}>
          <button onClick={()=>setShowClearRange(r=>!r)} style={{padding:"3px 10px",borderRadius:5,fontSize:10,fontFamily:"var(--font-mono)",border:`1px solid ${showClearRange?"var(--red)":"var(--border)"}`,background:showClearRange?"rgba(239,68,68,0.08)":"var(--bg-raised)",color:showClearRange?"var(--red)":"var(--text-muted)",cursor:"pointer",transition:"all 0.15s"}}
            onMouseEnter={e=>{if(!showClearRange){e.currentTarget.style.color="var(--red)";e.currentTarget.style.borderColor="var(--red)";}}}
            onMouseLeave={e=>{if(!showClearRange){e.currentTarget.style.color="var(--text-muted)";e.currentTarget.style.borderColor="var(--border)";}}}
          >✕ CLEAR</button>
          {showClearRange && (() => {
            const mono = { fontFamily: "var(--font-mono)" };
            const cap = { ...mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" };
            const inp = { flex: 1, minWidth: 0, padding: "6px 9px", borderRadius: 6, background: "var(--bg-input, var(--bg-raised))", border: "1px solid var(--border-bright)",
              color: "var(--text-primary)", fontSize: 12, ...mono, outline: "none" };
            const canRange = !rangeBad && rangeCount > 0;
            return (
              <div role="dialog" aria-label="Clear packets" style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 300, width: 330,
                background: "var(--bg-surface)", border: "1px solid var(--border-bright)", borderRadius: 10, overflow: "hidden",
                boxShadow: "0 14px 36px rgba(0,0,0,0.45)", ...mono }}>
                {/* header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-raised)" }}>
                  <span style={{ color: "var(--red)", fontWeight: 800, fontSize: 11, letterSpacing: "0.1em" }}>✕ CLEAR PACKETS</span>
                  <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--text-secondary)" }}>
                    {listIdx.length ? <>list: <b style={{ color: "var(--text-primary)" }}>#{listMin} – #{listMax}</b> · {listIdx.length}</> : "list is empty"}
                  </span>
                  <button onClick={() => setShowClearRange(false)} title="Close (Esc)" style={{ marginLeft: 6, width: 22, height: 22, borderRadius: 5, border: "1px solid var(--border)",
                    background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, lineHeight: 1 }}>✕</button>
                </div>

                {/* range */}
                <div style={{ padding: "11px 12px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ ...cap, marginBottom: 8 }}>Remove a range from the list</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input value={clearFrom} onChange={e => setClearFrom(e.target.value)} onKeyDown={e => e.key === "Enter" && clearByRange()}
                      placeholder={listMin != null ? `from #${listMin}` : "from #"} type="number" min="1" style={inp} />
                    <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>→</span>
                    <input value={clearTo} onChange={e => setClearTo(e.target.value)} onKeyDown={e => e.key === "Enter" && clearByRange()}
                      placeholder={listMax != null ? `to #${listMax}` : "to #"} type="number" min="1" style={inp} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
                    <span style={{ fontSize: 9.5, color: rangeBad && (clearFrom !== "" || clearTo !== "") ? "var(--red)" : "var(--text-secondary)" }}>
                      {rangeBad ? (clearFrom !== "" || clearTo !== "" ? "“From” must not be after “To”" : "—") : `${rangeCount} packet${rangeCount === 1 ? "" : "s"} will be removed`}
                    </span>
                    <button onClick={clearByRange} disabled={!canRange} style={{ marginLeft: "auto", padding: "6px 14px", borderRadius: 6, fontSize: 10, fontWeight: 800, ...mono, letterSpacing: "0.06em",
                      border: "1px solid var(--red)", background: canRange ? "rgba(239,68,68,0.12)" : "transparent", color: "var(--red)",
                      opacity: canRange ? 1 : 0.4, cursor: canRange ? "pointer" : "default" }}>CLEAR RANGE</button>
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text-secondary)", opacity: 0.8, marginTop: 7, lineHeight: 1.5 }}>
                    Only hides rows in this list — the DMI and the LIVE VISUALISER keep the session.
                  </div>
                </div>

                {/* everything */}
                <div style={{ padding: "11px 12px" }}>
                  <div style={{ ...cap, marginBottom: 6 }}>Clear everything</div>
                  <div style={{ fontSize: 9.5, color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: 9 }}>
                    Empties the list, resets the DMI, tag read status and visualiser, and clears the backend session — do this before replaying a log again.
                  </div>
                  <button onClick={() => (confirmClearAll ? clearAll() : setConfirmClearAll(true))} style={{ width: "100%", padding: "8px 0", borderRadius: 7, border: "none",
                    fontSize: 10.5, fontWeight: 800, ...mono, letterSpacing: "0.08em", color: "#fff", cursor: "pointer",
                    background: confirmClearAll ? "linear-gradient(135deg,#b91c1c,#7f1d1d)" : "linear-gradient(135deg,#ef4444,#dc2626)",
                    boxShadow: confirmClearAll ? "0 0 0 2px rgba(239,68,68,0.35)" : "none" }}>
                    {confirmClearAll ? `⚠ CONFIRM — CLEAR ALL ${totalReceived || listIdx.length} PACKETS` : "CLEAR ALL"}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
        <span style={{marginLeft:"auto",fontSize:9,color:"var(--text-muted)",fontFamily:"var(--font-mono)"}}>
          External → <span style={{color:"var(--cyan)"}}>POST localhost:8000/ingest</span>
        </span>
        <button onClick={()=>addLiveToast({
          kind:"sos",
          packetType:"C.4.5 Emergency", packetAbbr:"Emer",
          fieldName:"GEN_SOS_CALL", fieldLabel:"General SoS Call",
          sosName:"Manual SOS Button Pressed",
          description:"TEST — General SoS Call. Manual SOS button pressed at station.",
          bg:"#7f1d1d", border:"#ef4444", text:"#fca5a5",
          origin:{type:"station", id:431, label:"Station #431"},
          packetIndex:"TEST", source:"ui-test", time:new Date().toISOString().slice(11,19),
        })} style={{
          fontSize:9, padding:"2px 8px", borderRadius:4, cursor:"pointer",
          border:"1px solid #ef444466", background:"rgba(239,68,68,0.1)",
          color:"#ef4444", fontFamily:"var(--font-mono)", fontWeight:700,
        }}>🚨 TEST SOS</button>
        <button onClick={()=>addLiveToast({
          kind:"brake",
          packetType:"Loco to Station Regular", packetAbbr:"L2S Reg",
          fieldName:"Brake_Applied", fieldLabel:"Brake Applied",
          sosName:"Emergency Brake by Kavach",
          description:"TEST — Emergency Brake applied by KAVACH system due to speed violation.",
          bg:"#1c1007", border:"#f59e0b", text:"#fde68a",
          origin:{type:"loco", id:65501, label:"Loco #65501"},
          packetIndex:"TEST", source:"ui-test", time:new Date().toISOString().slice(11,19),
        })} style={{
          fontSize:9, padding:"2px 8px", borderRadius:4, cursor:"pointer",
          border:"1px solid #f59e0b66", background:"rgba(245,158,11,0.1)",
          color:"#f59e0b", fontFamily:"var(--font-mono)", fontWeight:700,
        }}>🛑 TEST BRAKE</button>
        {paused&&<span style={{fontSize:10,color:"var(--amber)",fontFamily:"var(--font-mono)",fontWeight:700}}>⏸ {pauseBuffer.current.length} buffered</span>}

        {/* View — packet list · DMI (Annexure-B) · live track profile */}
        <div style={{display:"flex",gap:2,padding:2,borderRadius:6,border:"1px solid var(--border)",background:"var(--bg-raised)",marginLeft:4}}>
          {[["packets","📋 PACKETS"],["dmi","🚆 DMI"],["profile","🗺 PROFILE"]].map(([v,l])=>{
            const on = (v==="dmi"&&dmiView)||(v==="profile"&&profileView)||(v==="packets"&&!dmiView&&!profileView);
            return (
              <button key={v} onClick={()=>{ setDmiView(v==="dmi"); setProfileView(v==="profile"); }} style={{
                padding:"3px 11px",borderRadius:4,fontSize:10,fontFamily:"var(--font-mono)",fontWeight:700,border:"none",cursor:"pointer",
                background:on?"var(--cyan-glow)":"transparent",color:on?"var(--cyan)":"var(--text-muted)",transition:"all 0.15s",
              }}>{l}</button>
            );
          })}
        </div>
      </div>

      {/* 🚆 LIVE VISUALISER — track with the SVK SIM RFID tags + loco movement */}
      <LiveStrip packets={dmiPackets} />

      {/* 🗺 PROFILE — the SVK SIM LIVE TRACK view (profile on the wire + loco movement), live from
          these packets. Always mounted, only hidden in the other views, so it keeps following the
          run (profile, loco trail, brake dots) while DMI or PACKETS is on screen. */}
      <div style={{ display: profileView && !dmiView ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <LiveTrackProfile serialLog={liveTrackLog} rfidTagTable={liveTagTable} apdResult={null} liveOnly txScanAll alerts={false} />
      </div>

      {/* ── Content area: DMI / Packet list (PROFILE is above) ── */}
      {dmiView ? (
        <DmiView livePackets={dmiPackets} wsState={wsState} isLight={isLight}/>
      ) : profileView ? null : (<>
        {/* Column headers */}
        <div style={{display:"grid",gridTemplateColumns:"40px 72px 76px 1fr 90px 90px 90px 54px 44px",gap:"0 6px",padding:"4px 12px",background:"var(--th-bg)",borderBottom:`1px solid var(--border-bright)`,fontSize:9,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",textTransform:"uppercase",flexShrink:0}}>
          <span>#</span><span>TIME</span><span>TYPE</span><span>LOCO / STN · FRAME</span>
          <span>SPEED</span><span>MODE</span><span>ALERTS</span><span>SRC</span><span>EXP</span>
        </div>

        {/* Packet rows */}
        <div style={{flex:1,minHeight:0,position:"relative",display:"flex",flexDirection:"column"}}>
        {!atBottom && filtered.length > 0 && (
          <button onClick={jumpLatest} title="Back to the newest packet (auto-scroll follows again)" style={{
            position:"absolute", right:22, bottom:14, zIndex:5, padding:"7px 14px", borderRadius:18, cursor:"pointer",
            border:"1px solid var(--cyan)", background:"var(--bg-surface)", color:"var(--cyan)", fontFamily:"var(--font-mono)",
            fontSize:10.5, fontWeight:800, letterSpacing:"0.06em", boxShadow:"0 6px 18px rgba(0,0,0,0.35)" }}>
            ↓ LATEST{totalReceived - seenTotalRef.current > 0 ? ` · ${totalReceived - seenTotalRef.current} new` : ""}
          </button>
        )}
        <div ref={listBoxRef} onScroll={onListScroll} style={{flex:1,overflowY:"auto",overflowX:"hidden"}}>
          {filtered.length===0 ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:14,color:"var(--text-muted)",fontFamily:"var(--font-mono)"}}>
              <span style={{fontSize:36,animation:wsState==="open"?"pulse-amber 2s infinite":"none"}}>📡</span>
              <span style={{fontSize:13}}>{wsState==="open"?"Waiting for packets…":"Connecting to ws://localhost:8000/ws/live"}</span>
              <div style={{fontSize:10,color:"var(--text-dim)",textAlign:"center",lineHeight:1.9}}>
                From Packet Simulator: <span style={{color:"var(--green)"}}>{window.location.host}/simulator</span><br/>
                From SVK SIM: UDP / HTTP and serial TX / RX packets appear here automatically<br/>
                From external tool: <span style={{color:"var(--cyan)"}}>POST localhost:8000/ingest</span>
              </div>
            </div>
          ) : (
            filtered.map((pkt,i) => <LiveFeedRow key={pkt.packet_index||i} pkt={pkt} isLight={isLight} />)
          )}
          <div ref={bottomRef} />
        </div>
        </div>
      </>)}

      {/* Footer */}
      <div style={{borderTop:`1px solid var(--border)`,padding:"4px 14px",display:"flex",gap:14,fontSize:9,color:"var(--text-muted)",fontFamily:"var(--font-mono)",background:"var(--footer-bg)",flexShrink:0}}>
        <span>WS: <span style={{color:wsColor}}>ws://localhost:8000/ws/live</span></span>
        <span>Buffer: <span style={{color:"var(--amber)"}}>{MAX_ROWS} rows max</span></span>
        <span style={{marginLeft:"auto"}}>Sources: SVK SIM UDP/HTTP · serial TX · serial RX · <span style={{color:"var(--green)"}}>{window.location.host}/simulator</span> · POST /ingest</span>
      </div>
    </div>
  );
}
/* ═══════════════════════════════════════════════════════════════ */
function SummaryCard({ result, isLight }) {
  const meta = PKT_META[result.packet_type_value] || {};
  const color = isLight ? (meta.lightColor || meta.color) : meta.color;
  const keyFields = {
    13:["TRAIN_SPEED","LOCO_MODE","EMERGENCY_STATUS","ABS_LOCO_LOC","TIN"],
    10:["TRAIN_SPEED","LOCO_MODE","EMERGENCY_STATUS","Brake_Applied","L_DOUBTOVER"],
    9: ["DEST_LOCO_ID","FRAME_NUM","LAST_REF_RFID","PKT_DIR"],
    11:["DEST_LOCO_ID","Allotted_UpLink_Freq","Allotted_DownLink_Freq","Allotted_TDMA_Timeslot"],
    12:["GEN_SOS_CALL","STN_ILC_IBS_LOC","FRAME_NUM"],
  };
  // Also search trimmed field names for exact match (backend fields have exact casing)
  const hlFields = (result.fields||[]).filter(f => {
    const fn = (f.Field||"").trim();
    return (keyFields[result.packet_type_value]||[]).includes(fn);
  });
  return (
    <div style={{
      background:`linear-gradient(135deg,${color}18,${color}09,var(--soft-overlay))`,
      border:`1px solid ${color}40`,
      borderRadius:10, padding:"12px 16px",
      boxShadow:`0 0 30px ${color}14, 0 0 60px ${color}06, inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 30px var(--soft-overlay)`,
      position:"relative", overflow:"hidden",
      animation:"cin-slide-in-up 0.35s ease forwards",
    }}>
      {/* animated corner glow */}
      <div style={{position:"absolute",top:-20,right:-20,width:80,height:80,borderRadius:"50%",background:`radial-gradient(circle,${color}20,transparent 70%)`,pointerEvents:"none"}}/>
      {/* bottom shimmer line */}
      <div style={{position:"absolute",bottom:0,left:0,right:0,height:"1px",background:`linear-gradient(90deg,transparent,${color}60,transparent)`,animation:"cin-shimmer-bg 2.5s linear infinite",backgroundSize:"200% auto"}}/>
      {/* accent left rail */}
      <div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:`linear-gradient(180deg,${color},${color}60,${color}10)`,boxShadow:`0 0 12px ${color}88, 0 0 4px ${color}`}}/>
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:hlFields.length ? 10 : 0, paddingLeft:8 }}>
        <span style={{ fontSize:24, filter:`drop-shadow(0 0 8px ${color}99) drop-shadow(0 0 2px ${color})`, animation:"cin-float 3s ease-in-out infinite" }}>{meta.icon || "📦"}</span>
        <div>
          <div style={{ fontFamily:"var(--font-display)", fontSize:17, letterSpacing:"0.1em", color, lineHeight:1, textShadow:`0 0 16px ${color}77, 0 0 40px ${color}33` }}>
            {meta.abbr || meta.name || result.packet_type_name}
          </div>
          <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginTop:3, letterSpacing:"0.04em" }}>
            {meta.name || result.packet_type_name} · PKT#{result.packet_index??1} · {result.total_bits}b
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          <CRCBadge crcCheck={result.crc_check} isLight={isLight} />
          <ValidationBadge warnings={result.validation_warnings} isLight={isLight} />
        </div>
      </div>
      {hlFields.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:6, paddingLeft:8 }}>
          {hlFields.map((f,i) => {
            const isAlert = f._group === "emergency" || f._group === "brake";
            const alertActive = isAlert && f["Decimal Value"] > 0;
            return (
              <div key={i} className="kv-field-tile" style={{
                background: alertActive
                  ? "linear-gradient(135deg,rgba(255,23,68,0.18),rgba(255,23,68,0.09))"
                  : isLight ? "linear-gradient(135deg,#f8f8ff,#f0f0f8)" : "linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))",
                border:`1px solid ${alertActive ? "rgba(255,23,68,0.45)" : isLight?"var(--border)":"rgba(255,255,255,0.09)"}`,
                boxShadow: alertActive?"0 0 16px rgba(255,23,68,0.22), inset 0 0 8px rgba(255,23,68,0.06)":"inset 0 1px 0 rgba(255,255,255,0.04)",
                animationDelay:`${i*0.055}s`,
              }}>
                <div style={{ fontSize:8, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:4, textTransform:"uppercase", letterSpacing:"0.1em" }}>{f.Field}</div>
                <div style={{
                  fontSize:13, fontFamily:"var(--font-mono)", fontWeight:800,
                  color: alertActive ? "var(--red)" : "var(--text-primary)",
                  textShadow: alertActive?"0 0 10px rgba(255,23,68,0.6)":"0 0 4px rgba(255,255,255,0.05)",
                  letterSpacing:"0.02em",
                }}>{f.Description || f["Decimal Value"]}</div>
              </div>
            );
          })}
          {/* ── CRC status tile — always shown last in the key-fields row ── */}
          {result.crc_check && (() => {
            const { match, computed_hex, stored_hex, error } = result.crc_check;
            if (error) return null;
            return (
              <div className="kv-field-tile" style={{
                background: match
                  ? "linear-gradient(135deg,rgba(0,230,118,0.18),rgba(0,230,118,0.07))"
                  : "linear-gradient(135deg,rgba(255,23,68,0.18),rgba(255,23,68,0.07))",
                border:`1px solid ${match?"rgba(0,230,118,0.45)":"rgba(255,23,68,0.45)"}`,
                display:"flex", flexDirection:"column", justifyContent:"center",
                boxShadow: match?"0 0 16px rgba(0,230,118,0.18), inset 0 0 8px rgba(0,230,118,0.06)":"0 0 16px rgba(255,23,68,0.18), inset 0 0 8px rgba(255,23,68,0.06)",
              }}>
                <div style={{ fontSize:8, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:4, textTransform:"uppercase", letterSpacing:"0.1em" }}>PKT CRC</div>
                <div style={{
                  fontSize:14, fontFamily:"var(--font-mono)", fontWeight:800,
                  color: match ? "var(--green)" : "var(--red)",
                  textShadow: match?"0 0 8px rgba(0,230,118,0.5)":"0 0 8px rgba(255,23,68,0.5)",
                }}>
                  {match ? "✓ PASS" : "✗ FAIL"}
                </div>
                {!match && computed_hex && (
                  <div style={{ fontSize:7, fontFamily:"var(--font-mono)", color:"var(--text-muted)", marginTop:2 }}>
                    stored {stored_hex}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FIELD TABLE — sub-packet tree view for C.4.2
/* ═══════════════════════════════════════════════════════════════ */

// Normalise a raw section Field string to a canonical name.
// Python backend wraps with "── NAME ──"; JS uses plain "NAME".
// JS also uses "TEMP SPEED RESTRICTIONS" vs Python "TEMPORARY SPEED RESTRICTIONS".
function normaliseSectionName(raw) {
  let s = String(raw || "").trim();
  // strip Python decorator  ── … ──
  s = s.replace(/^──+\s*/, "").replace(/\s*──+$/, "").trim();
  // normalise TSR short name
  if (s === "TEMP SPEED RESTRICTIONS") s = "TEMPORARY SPEED RESTRICTIONS";
  return s;
}

// Canonical sub-packet names (used as lookup keys after normalisation)
const SUBPKT_SET = new Set([
  "MOVEMENT AUTHORITY","STATIC SPEED PROFILE","GRADIENT PROFILE",
  "LC GATE PROFILE","TURNOUT SPEED PROFILE","TAG LINKING INFORMATION",
  "TRACK CONDITION DATA","TEMPORARY SPEED RESTRICTIONS",
]);

const SUBPKT_META = {
  "MOVEMENT AUTHORITY":          { icon:"🚦", color:"#06b6d4" },
  "STATIC SPEED PROFILE":        { icon:"⚡", color:"#f59e0b" },
  "GRADIENT PROFILE":            { icon:"📐", color:"#10b981" },
  "LC GATE PROFILE":             { icon:"🚧", color:"#f97316" },
  "TURNOUT SPEED PROFILE":       { icon:"🔀", color:"#8b5cf6" },
  "TAG LINKING INFORMATION":     { icon:"🏷", color:"#ec4899" },
  "TRACK CONDITION DATA":        { icon:"🛤", color:"#14b8a6" },
  "TEMPORARY SPEED RESTRICTIONS":{ icon:"⚠", color:"#ef4444" },
};

function FieldTable({ fields, isLight, searchQuery, showBits: showBitsProp = true }) {
  const [tooltip,   setTooltip]  = useState(null);
  const [copied,    setCopied]   = useState(null);
  const [showBits,  setShowBits] = useState(showBitsProp);
  // collapsed is an array of collapseKeys — starts with ALL sub-packet sections collapsed
  const [collapsed, setCollapsed] = useState(() => {
    // Pre-collapse all sub-packet sections by scanning fields once at mount
    const keys = [];
    const occ = {};
    fields.forEach(f => {
      if (!f._is_section) return;
      const canon = normaliseSectionName(f.Field);
      if (!SUBPKT_SET.has(canon)) return;
      occ[canon] = (occ[canon] || 0);
      keys.push(`${canon}:${occ[canon]}`);
      occ[canon]++;
    });
    return keys;
  });
  const GC = isLight ? GROUP_COLOR_LIGHT : GROUP_COLOR_DARK;

  // Pre-process fields once: attach a collapseKey to every section header.
  // The same section can appear multiple times (e.g. 3× MOVEMENT AUTHORITY),
  // so we use "NAME:0", "NAME:1", "NAME:2" as independent keys.
  const annotated = useMemo(() => {
    const occurrence = {}; // count how many times each canonical name appeared
    return fields.map(f => {
      if (!f._is_section) return f;
      const canon = normaliseSectionName(f.Field);
      const isSubPkt = SUBPKT_SET.has(canon);
      if (!isSubPkt) return { ...f, _canon: canon, _isSubPkt: false, _collapseKey: null };
      occurrence[canon] = (occurrence[canon] || 0);
      const key = `${canon}:${occurrence[canon]}`;
      occurrence[canon]++;
      return { ...f, _canon: canon, _isSubPkt: true, _collapseKey: key };
    });
  }, [fields]);

  // Build visibleRows: hide field-rows that belong to a collapsed sub-packet section
  const { visibleRows, countMap } = useMemo(() => {
    const countMap = {}; // collapseKey -> field count
    let currentKey = null;
    annotated.forEach(f => {
      if (f._is_section) { currentKey = f._collapseKey; return; }
      if (currentKey) countMap[currentKey] = (countMap[currentKey] || 0) + 1;
    });

    const q = searchQuery?.trim().toLowerCase();
    let rows = annotated;
    if (q) {
      rows = annotated.filter(f =>
        f._is_section ||
        String(f.Field||"").toLowerCase().includes(q) ||
        String(f.Description||"").toLowerCase().includes(q) ||
        String(f["Decimal Value"]||"").toLowerCase().includes(q)
      );
    }

    let activeKey = null;
    const visibleRows = rows.filter(f => {
      if (f._is_section) { activeKey = f._collapseKey; return true; }
      if (activeKey && collapsed.includes(activeKey)) return false;
      return true;
    });

    return { visibleRows, countMap };
  }, [annotated, searchQuery, collapsed]);

  const toggleCollapse = (key) => {
    setCollapsed(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const copyField = (f) => {
    const text = JSON.stringify({field:f.Field,bits:f["Size (bits)"],raw:f["Raw Bits"],value:f["Decimal Value"],desc:f.Description});
    navigator.clipboard?.writeText(text).then(()=>{ setCopied(f.Field); setTimeout(()=>setCopied(null),1500); });
  };

  const colgroup = showBits ? (
    <colgroup>
      <col style={{width:"22%"}} /><col style={{width:"5%"}} />
      <col style={{width:"25%"}} /><col style={{width:"8%"}} />
      <col style={{width:"40%"}} />
    </colgroup>
  ) : (
    <colgroup>
      <col style={{width:"30%"}} /><col style={{width:"12%"}} /><col style={{width:"58%"}} />
    </colgroup>
  );

  const headers = showBits
    ? ["Field","Bits","Raw Bits","Value","Description"]
    : ["Field","Value","Description"];

  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:"var(--font-mono)", fontSize:11, tableLayout:"fixed" }}>
        {colgroup}
        <thead>
          <tr style={{ borderBottom:`2px solid var(--border-bright)` }}>
            {headers.map((h,hi) => (
              <th key={h} style={{
                padding:"6px 10px", textAlign: hi > 0 ? (h==="Value"?"right":"left") : "left",
                background:"var(--th-bg)",
                color:"var(--text-muted)", fontWeight:700, fontSize:10,
                letterSpacing:"0.1em", textTransform:"uppercase",
                position:"sticky", top:0, zIndex:2,
                borderBottom:`1px solid #1a1a30`,
                textShadow:"0 0 10px rgba(245,166,35,0.15)",
              }}>{h}</th>
            ))}
            <th style={{
              padding:"5px 8px", background:"var(--th-bg)",
              position:"sticky", top:0, zIndex:2,
              borderBottom:`1px solid var(--border-bright)`,
              textAlign:"right", width:80,
            }}>
              <button onClick={()=>setShowBits(b=>!b)} style={{
                fontSize:8, padding:"2px 7px", borderRadius:3, cursor:"pointer",
                border:`1px solid ${showBits?"var(--amber)":"var(--border)"}`,
                background:showBits?"var(--amber-glow)":"transparent",
                color:showBits?"var(--amber)":"var(--text-muted)",
                fontFamily:"var(--font-mono)", fontWeight:600,
                transition:"all 0.15s", whiteSpace:"nowrap",
              }}>
                {showBits ? "▣ bits" : "▢ bits"}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((f, i) => {
            if (f._is_section) {
              if (f._isSubPkt) {
                // ── Collapsible sub-packet tree node ──
                const key       = f._collapseKey;
                const canon     = f._canon;
                const isCollapsed = collapsed.includes(key);
                const meta      = SUBPKT_META[canon] || { icon:"📦", color:"#60a5fa" };
                const cnt       = countMap[key] || 0;
                // occurrence number shown when same profile appears multiple times
                const occNum    = key.split(":")[1];
                const showNum   = countMap[`${canon}:1`] !== undefined; // more than 1 occurrence exists
                return (
                  <tr key={`sec-${i}`}>
                    <td colSpan={showBits ? 6 : 4} style={{ padding:0,
                      background: isLight
                        ? `linear-gradient(90deg,${meta.color}20,${meta.color}09,transparent)`
                        : `linear-gradient(90deg,${meta.color}28,${meta.color}0e,transparent)`,
                      borderTop:`2px solid ${meta.color}66`,
                      borderBottom:`1px solid ${meta.color}33`,
                      position:"relative", overflow:"hidden",
                    }}>
                      {/* animated shimmer on section header */}
                      <div style={{position:"absolute",inset:0,background:`linear-gradient(90deg,transparent,${meta.color}10,transparent)`,animation:"cin-shimmer-bg 2.5s linear infinite",backgroundSize:"200% auto",pointerEvents:"none"}}/>
                      <button onClick={() => toggleCollapse(key)} style={{
                        width:"100%", padding:"8px 16px", background:"transparent",
                        border:"none", cursor:"pointer",
                        display:"flex", alignItems:"center", gap:10, textAlign:"left",
                        position:"relative",
                      }}>
                        {/* Chevron — rotates when collapsed */}
                        <span style={{
                          fontSize:9, color:meta.color, flexShrink:0,
                          display:"inline-block",
                          transition:"transform 0.22s cubic-bezier(0.34,1.2,0.64,1)",
                          transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                          filter:`drop-shadow(0 0 4px ${meta.color}88)`,
                        }}>▼</span>
                        {/* Profile icon */}
                        <span style={{fontSize:15, flexShrink:0, filter:`drop-shadow(0 0 6px ${meta.color})`}}>{meta.icon}</span>
                        {/* Canonical name */}
                        <span style={{
                          fontFamily:"var(--font-display)", fontSize:13,
                          letterSpacing:"0.12em", textTransform:"uppercase",
                          color: meta.color, flex:1,
                          textShadow:`0 0 12px ${meta.color}66, 0 0 30px ${meta.color}22`,
                        }}>{canon}{showNum ? ` #${Number(occNum)+1}` : ""}</span>
                        {/* Field count badge */}
                        <span style={{
                          fontSize:8, padding:"3px 10px", borderRadius:6,
                          background:`${meta.color}1e`,
                          color:meta.color,
                          border:`1px solid ${meta.color}55`,
                          fontFamily:"var(--font-mono)", fontWeight:700, flexShrink:0,
                          boxShadow:`0 0 8px ${meta.color}30`,
                          letterSpacing:"0.06em",
                        }}>
                          {isCollapsed ? `▶ ${cnt} fields` : `${cnt} fields`}
                        </span>
                      </button>
                    </td>
                  </tr>
                );
              }

              // ── Regular (non-sub-packet) section header ──
              return (
                <tr key={`sec-${i}`}>
                  <td colSpan={showBits ? 6 : 4} style={{
                    padding:"7px 12px 5px",
                    background:"linear-gradient(90deg,rgba(245,166,35,0.1),rgba(245,166,35,0.04),transparent)",
                    borderTop:`1px solid rgba(245,166,35,0.15)`,
                    borderBottom:`1px solid rgba(245,166,35,0.1)`,
                    borderLeft:"2px solid rgba(245,166,35,0.5)",
                    animation:"cin-section-reveal 0.3s ease forwards",
                  }}>
                    <span style={{
                      fontFamily:"var(--font-display)", fontSize:12,
                      letterSpacing:"0.15em", color:"var(--section-text)",
                      textTransform:"uppercase",
                      textShadow:"0 0 12px rgba(245,166,35,0.4), 0 0 30px rgba(245,166,35,0.1)",
                    }}>{normaliseSectionName(f.Field)}</span>
                  </td>
                </tr>
              );
            }

            const gcolor = GC[f._group] || (isLight ? "#6b7280" : "#6b7280");
            const isSpecial = ["PKT_TYPE","PKT_LENGTH","FRAME_NUM","PKT_CRC","MAC_CODE",
              "SUB_PKT_TYPE","LOCO_Specific_MAC_CODE"].includes(f.Field);
            const isAlert = (f._group === "emergency" || f._group === "brake") && f["Decimal Value"] > 0;
            const isIndent = String(f.Field).startsWith("  ");
            const isMeta = f._group === "pad" || f._group === "crc";
            const rowBg = isAlert
              ? "linear-gradient(90deg,rgba(255,23,68,0.1),rgba(255,23,68,0.05),transparent)"
              : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)";

            return (
              <tr key={i} style={{
                background: rowBg,
                borderBottom:`1px solid rgba(255,255,255,0.04)`,
                transition:"background 0.15s ease",
              }}
              onMouseEnter={e=>{ if(!isAlert) e.currentTarget.style.background="rgba(245,166,35,0.04)"; }}
              onMouseLeave={e=>{ e.currentTarget.style.background=rowBg; }}
              >
                {/* Field name */}
                <td style={{ padding:"5px 10px", paddingLeft: isIndent ? 22 : 10, position:"relative" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{
                      width:2.5, height:16, borderRadius:2, flexShrink:0,
                      background: isMeta ? `${gcolor}30` : `linear-gradient(180deg,${gcolor},${gcolor}60)`,
                      boxShadow: isMeta ? "none" : `0 0 4px ${gcolor}60`,
                    }} />
                    <span
                      style={{
                        color: isSpecial ? "var(--amber)" : isAlert ? "var(--red)" : isMeta ? "var(--text-dim)" : "var(--text-primary)",
                        fontWeight: isSpecial ? 700 : 400,
                        fontSize: isIndent ? 10 : 11,
                        cursor: SPEC_ANNOTATIONS[f.Field.trim()] ? "help" : "default",
                        borderBottom: SPEC_ANNOTATIONS[f.Field.trim()] ? "1px dashed rgba(245,166,35,0.3)" : "none",
                        textShadow: isSpecial ? "0 0 10px rgba(245,166,35,0.3)" : isAlert ? "0 0 8px rgba(255,23,68,0.4)" : "none",
                      }}
                      onMouseEnter={()=>SPEC_ANNOTATIONS[f.Field.trim()] && setTooltip({field:f.Field.trim()})}
                      onMouseLeave={()=>setTooltip(null)}
                    >{f.Field.trim()}{SPEC_ANNOTATIONS[f.Field.trim()] && <sup style={{fontSize:7,color:"var(--amber)",marginLeft:1}}>ⓘ</sup>}</span>
                    {tooltip?.field === f.Field.trim() && SPEC_ANNOTATIONS[f.Field.trim()] && (
                      <div className="spec-tooltip">
                        <div style={{color:"var(--amber)",fontWeight:700,marginBottom:4}}>{f.Field.trim()}</div>
                        <div><span style={{color:"var(--text-muted)"}}>Range: </span>{SPEC_ANNOTATIONS[f.Field.trim()].range}</div>
                        <div><span style={{color:"var(--text-muted)"}}>Spec §: </span>{SPEC_ANNOTATIONS[f.Field.trim()].page}</div>
                        <div style={{marginTop:4,opacity:0.85}}>{SPEC_ANNOTATIONS[f.Field.trim()].note}</div>
                      </div>
                    )}
                    <button
                      onClick={()=>copyField(f)}
                      style={{
                        marginLeft:"auto", opacity:0, fontSize:9, padding:"1px 4px",
                        borderRadius:2, border:"1px solid var(--border)", background:"var(--bg-raised)",
                        color: copied===f.Field ? "var(--green)" : "var(--text-muted)",
                        cursor:"pointer", fontFamily:"var(--font-mono)",
                        transition:"opacity 0.15s",
                      }}
                      className="copy-btn"
                    >{copied===f.Field ? "✓" : "⎘"}</button>
                  </div>
                </td>
                {showBits && (
                  <td style={{ padding:"4px 10px", color:"var(--text-muted)", textAlign:"right", fontSize:10 }}>
                    {f["Size (bits)"]}
                  </td>
                )}
                {showBits && (
                  <td style={{ padding:"4px 8px", color:"var(--text-code)", fontSize:10, wordBreak:"break-all", lineHeight:1.5 }}>
                    {typeof f["Raw Bits"]==="string"&&f["Raw Bits"].length>32
                      ? <span title={f["Raw Bits"]}>{f["Raw Bits"].slice(0,32)}<span style={{opacity:0.4}}>…</span></span>
                      : f["Raw Bits"]}
                  </td>
                )}
                <td style={{
                  padding:"4px 10px", textAlign:"right", fontWeight:700,
                  color: isSpecial ? "var(--amber)" : isAlert ? "var(--red)" : "var(--text-value)",
                  fontSize:11,
                }}>
                  {f["Decimal Value"]}
                </td>
                <td style={{ padding:"4px 10px", color:"var(--text-secondary)", fontSize:11, lineHeight:1.4 }}>
                  {f.Description}
                </td>
                <td/>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
/* ═══════════════════════════════════════════════════════════════ */
function SidebarCard({ r, i, isActive, isLight, onClick }) {
  const m = PKT_META[r.packet_type_value] || {};
  const color = isLight ? (m.lightColor || m.color) : m.color;
  return (
    <button onClick={onClick} style={{
      display:"block", width:"100%", padding:"9px 10px", marginBottom:5,
      borderRadius:7, cursor:"pointer", textAlign:"left",
      border:`1px solid ${isActive ? color+"66" : "var(--border)"}`,
      background: isActive ? "var(--sidebar-active)" : "transparent",
      transition:"all 0.15s",
    }}
    onMouseEnter={e=>{ if(!isActive){ e.currentTarget.style.background="var(--bg-hover)"; e.currentTarget.style.borderColor="var(--border-bright)"; } }}
    onMouseLeave={e=>{ if(!isActive){ e.currentTarget.style.background="transparent"; e.currentTarget.style.borderColor="var(--border)"; } }}
    >
      <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:2 }}>PKT #{r.packet_index||i+1}</div>
      <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
        <span style={{ fontSize:13 }}>{m.icon||"📦"}</span>
        <span style={{ fontSize:11, color, fontFamily:"var(--font-mono)", fontWeight:700 }}>{m.short||"?"}</span>
      </div>
      <div style={{ fontSize:10, color:"var(--text-secondary)", lineHeight:1.3 }}>{m.name||r.packet_type_name}</div>
      <div style={{ fontSize:9, color:"var(--text-muted)", marginTop:3, fontFamily:"var(--font-mono)" }}>
        {r.active_radio} · {r.total_bits}b
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN APP
/* ═══════════════════════════════════════════════════════════════ */
const SAMPLE = `[{"activeRadio":"0xF1","messagePayload":"D3900C103039407CFA80C8C9040413501800000000000000006B293B76"}]`;
/* Full C.4.2 with MA+SSP+Gradient+LC Gate+Turnout+TLI sub-packets for Profile tab testing */
const SAMPLE_C42 = `[{"activeRadio":"0xAA","messagePayload":"92ED5BEE035E8007D0D69084C8016204E88422C15B230254001081B98A6025D1138948320802EE100AF200FA048258804E20607D01471808578200324001909044D000320C09F8206E01049C1830C107061301805BE0F8005D8191770C95E0AECEF3E83C0FA0F13E83C8FA0F33E83D0FA0F53E83D8FA0F73E83E0FA0F93E83E8FA0FB3E83F0FA0FD3E83F8FA0FF3E8404FA1023E89643215F12C580FA1610C8588CCD630C8590CF9650C85999C4003EFF82D26982D995C2DE3A02B8E"}]`;

/* ── Normalize backend/WS results so extractProfile can read them.
   The Python backend may emit section headers WITHOUT _is_section:true
   (as rows with empty Size/Bits/Value). This function detects and tags them.
   Also maps "── SECTION NAME ──" style headers to plain uppercase names.    ── */
const SECTION_CANONICAL_NAMES = new Set([
  "MOVEMENT AUTHORITY","STATIC SPEED PROFILE","GRADIENT PROFILE",
  "LC GATE PROFILE","TURNOUT SPEED PROFILE","TAG LINKING INFORMATION",
  "TRACK CONDITION DATA","TEMP SPEED RESTRICTIONS","TEMPORARY SPEED RESTRICTIONS",
]);
const SECTION_HEADER_RE = /^(?:──+\s*)?([A-Z][A-Z0-9 \/_-]{2,}?)(?:\s*──+)?$/;
function normalizeResult(result) {
  if (!result || !Array.isArray(result.fields)) return result;
  const fields = result.fields.map(f => {
    if (f._is_section) return f;
    const fn  = String(f.Field||"").trim();
    const sz  = f["Size (bits)"];
    const rv  = f["Raw Bits"];
    const dv  = f["Decimal Value"];
    const emptyMeta = (sz==null||sz===""||sz===0)
                   && (rv==null||rv===""||rv==="")
                   && (dv==null||dv===""||dv===0||dv==="");
    if (emptyMeta && fn.length > 2) {
      const norm = fn.replace(/^──+\s*/,"").replace(/\s*──+$/,"").trim().toUpperCase();
      if (SECTION_CANONICAL_NAMES.has(norm) || SECTION_HEADER_RE.test(norm)) {
        return { ...f, Field: norm, _is_section: true };
      }
    }
    return f;
  });
  // Always re-verify CRC using JS engine so the badge is consistent with the table.
  // This ensures backend results also get a correctly computed crc_check.
  const payloadHex = result.payload_hex || result.messagePayload || "";
  const crc_check = payloadHex ? verifyPacketCRC(payloadHex) : (result.crc_check || null);
  // If the PKT_CRC row exists, annotate its Description with computed vs stored
  const pktCrcRow = fields.find(f => (f.Field||"").trim() === "PKT_CRC");
  if (pktCrcRow && crc_check && !crc_check.error) {
    const st = crc_check.match ? "✓ PASS" : "✗ FAIL";
    pktCrcRow.Description = `Packet CRC = ${crc_check.stored_hex} | Computed = ${crc_check.computed_hex} | ${st}`;
  }
  return { ...result, fields, crc_check };
}

/* ═══════════════════════════════════════════════════════════════
   LOCO PANEL — Vertical left sidebar showing all decoded locos
   Appears below the tab bar, left of tab content.
   Professional design: animated selection indicator, pulse dot,
   gradient active state, smooth slide-in per card.
═══════════════════════════════════════════════════════════════ */
function LocoPanel({ locoEntries, selectedLocoKey, onSelect, isLight }) {
  const dark = !isLight;
  return (
    <div className={dark?"kv-loco-panel":""} style={{
      width: 180, flexShrink:0,
      display:"flex", flexDirection:"column",
      borderRight:`1px solid #12122a`,
      background: dark
        ? "linear-gradient(180deg,#060610 0%,#040408 100%)"
        : "linear-gradient(180deg,#f4f4fa 0%,#eeeef6 100%)",
      overflow:"hidden",
    }}>
      {/* ── Panel header ── */}
      <div className="kv-loco-header" style={{ display:"flex", alignItems:"center", gap:7, flexShrink:0 }}>
        <div style={{
          width:8, height:8, borderRadius:"50%",
          background:"var(--amber)", boxShadow:"0 0 10px var(--amber), 0 0 20px rgba(245,166,35,0.3)",
          animation:"pulse-amber 1.8s ease-in-out infinite", flexShrink:0,
        }}/>
        <span style={{
          fontSize:9, fontFamily:"var(--font-mono)", fontWeight:800,
          letterSpacing:"0.14em", textTransform:"uppercase",
          color: dark ? "var(--amber-text)" : "var(--amber)",
          textShadow:"0 0 10px rgba(245,166,35,0.4)",
        }}>
          {locoEntries.length} LOCO{locoEntries.length!==1?"S":""}
        </span>
        <div style={{marginLeft:"auto",fontSize:7,fontFamily:"var(--font-mono)",color:"var(--text-dim)",letterSpacing:"0.06em"}}>ROSTER</div>
      </div>

      {/* animated rail track */}
      <div style={{height:2,position:"relative",overflow:"hidden",flexShrink:0}}>
        <div style={{position:"absolute",inset:0,background:"repeating-linear-gradient(90deg,var(--amber) 0,var(--amber) 6px,transparent 6px,transparent 14px)",opacity:0.3,animation:"kv-rail-scroll 2s linear infinite"}}/>
      </div>

      {/* ── Loco list ── */}
      <div style={{ flex:1, overflowY:"auto", padding:"7px 7px 10px" }}>
        {locoEntries.map(([key, entry], idx) => {
          const isActive = key === selectedLocoKey;
          const lastPkt  = entry.packets[entry.packets.length - 1];
          const m        = PKT_META[lastPkt?.packet_type_value] || {};
          const accentColor = isLight ? (m.lightColor || m.color || "#06b6d4") : (m.color || "#06b6d4");

          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "0", marginBottom: 6,
                border: "none", background: "none", cursor: "pointer",
                animation: `cin-slide-in-left 0.22s ease ${idx * 0.05}s both`,
              }}
            >
              <div style={{
                borderRadius: 9,
                border: `1px solid ${isActive ? accentColor + "66" : dark ? "#18182a" : "#d8d8e8"}`,
                background: isActive
                  ? dark
                    ? `linear-gradient(135deg, ${accentColor}20 0%, ${accentColor}0a 60%, rgba(0,0,0,0.2) 100%)`
                    : `linear-gradient(135deg, ${accentColor}16 0%, ${accentColor}07 100%)`
                  : dark ? "linear-gradient(135deg,#0c0c1a,#090912)" : "#f8f8ff",
                padding: "10px 12px",
                transition: "all 0.2s cubic-bezier(0.4,0,0.2,1)",
                position: "relative", overflow: "hidden",
                boxShadow: isActive
                  ? `0 0 0 1px ${accentColor}28, 0 4px 18px ${accentColor}20, inset 0 1px 0 rgba(255,255,255,0.04)`
                  : "none",
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  e.currentTarget.style.border = `1px solid ${accentColor}55`;
                  e.currentTarget.style.background = dark ? `linear-gradient(135deg,${accentColor}12,${accentColor}05,rgba(0,0,0,0.2))` : "#f0f0fc";
                  e.currentTarget.style.transform = "translateX(3px)";
                  e.currentTarget.style.boxShadow = `0 0 18px ${accentColor}25, inset 0 1px 0 rgba(255,255,255,0.03)`;
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  e.currentTarget.style.border = `1px solid ${dark ? "#18182a" : "#d8d8e8"}`;
                  e.currentTarget.style.background = dark ? "linear-gradient(135deg,#0c0c1a,#090912)" : "#f8f8ff";
                  e.currentTarget.style.transform = "translateX(0)";
                  e.currentTarget.style.boxShadow = "none";
                }
              }}
              >
                {/* Shimmer overlay on active */}
                {isActive && (
                  <div style={{position:"absolute",inset:0,borderRadius:9,background:`linear-gradient(90deg,transparent,${accentColor}08,transparent)`,animation:"cin-shimmer-bg 2.5s linear infinite",backgroundSize:"200% auto",pointerEvents:"none"}}/>
                )}

                {/* Active indicator stripe */}
                {isActive && (
                  <div style={{
                    position:"absolute", left:0, top:0, bottom:0,
                    width:3, borderRadius:"0 2px 2px 0",
                    background:`linear-gradient(180deg,${accentColor},${accentColor}88,${accentColor}22)`,
                    boxShadow:`0 0 12px ${accentColor}, 0 0 24px ${accentColor}55`,
                  }}/>
                )}

                {/* Row 1: icon + label */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  marginBottom: 5, paddingLeft: isActive ? 8 : 0,
                  transition: "padding-left 0.2s ease",
                }}>
                  <span style={{
                    fontSize:12, lineHeight:1,
                    filter: isActive ? `drop-shadow(0 0 5px ${accentColor}88)` : "none",
                    transition:"filter 0.2s",
                  }}>🚆</span>
                  <span style={{
                    fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 800,
                    color: isActive ? accentColor : dark ? "var(--text-primary)" : "#1a1a3e",
                    letterSpacing: "0.05em",
                    textShadow: isActive ? `0 0 10px ${accentColor}66` : "none",
                    transition: "all 0.2s ease",
                  }}>
                    {entry.label}
                  </span>
                </div>

                {/* Row 2: packet type + count */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  paddingLeft: isActive ? 8 : 0,
                  transition: "padding-left 0.2s ease",
                }}>
                  <span style={{
                    fontSize: 9, fontFamily: "var(--font-mono)",
                    color: isActive ? accentColor + "cc" : "var(--text-muted)",
                    fontWeight: 700,
                    letterSpacing:"0.06em",
                    transition: "color 0.2s ease",
                  }}>
                    {m.short || "PKT"}
                  </span>
                  <span style={{
                    fontSize: 9, fontFamily: "var(--font-mono)",
                    padding: "2px 7px", borderRadius: 5,
                    background: isActive
                      ? `${accentColor}28`
                      : dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,60,0.06)",
                    color: isActive ? accentColor : "var(--text-muted)",
                    border: `1px solid ${isActive ? accentColor + "44" : "transparent"}`,
                    fontWeight: 800,
                    boxShadow: isActive ? `0 0 8px ${accentColor}30` : "none",
                    transition: "all 0.2s ease",
                  }}>
                    {entry.packets.length}×
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PINJ HOME SCENE — the main page while no packets are decoded.
   Background: a realistic night photo-render (frontend/public/
   kavach-bg.webp, 1672×940). Everything that moves is an SVG layer
   drawn in the SAME 1672×940 coordinates, so beams, glows and labels
   sit on the tower / locos / station of the picture:
     GPS satellites → loco GPS fixes · RFID tags on the track
     radio tower ⇄ STN 523 ⇄ locos:
       S2L · C.4.2 (MA / SSP / gradient)   L2S · C.4.3 (loco position)
     Loco #12799 and Loco #12801 converge on the junction → MA is
     shortened → WARNING → AUTOMATIC BRAKING → stops short of EoA.
   The PINJ title, onboard-Kavach readout and the sample buttons are
   HTML overlays (always readable at any panel size).
   One 16 s loop shared by SVG (SMIL) and the readout (CSS);
   static (braking moment) when the OS asks for reduced motion.
═══════════════════════════════════════════════════════════════ */
const PH_REDUCED = typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const PH_T = 16;                       // loop length (s)
const PH_BG = "/kavach-bg-v3.webp";    // frontend/public/kavach-bg-v3.webp (1671×941, head-on trains)

const PH_CSS = `
  .pinj-home {
    --ph-cyan: #22d3ee; --ph-cyan-2: #a5f3fc; --ph-green: #34d399; --ph-amber: #f59e0b; --ph-amber-2: #fcd34d;
    --ph-red: #ef4444; --ph-gps: #facc15; --ph-text: #c8d3e6; --ph-text-dim: #8190ad; --ph-title: #f1f5f9;
    --ph-card: rgba(5,12,28,0.80); --ph-card-solid: #07112a;
    container-type: size;
  }
  @keyframes phFlow { to { stroke-dashoffset: -30; } }
  .ph-flow { animation: phFlow 0.9s linear infinite; }
  .ph-flow-r { animation: phFlow 0.9s linear infinite reverse; }
  @keyframes phWave { 0% { transform: scale(0.15); opacity: 0.9; } 100% { transform: scale(1); opacity: 0; } }
  .ph-wave { animation: phWave 2.4s ease-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes phSoft { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
  .ph-soft { animation: phSoft 1.8s ease-in-out infinite; }
  @keyframes phBlink { 50% { opacity: 0; } }
  .ph-blink { animation: phBlink 0.5s step-end infinite; }
  .ph-blink-slow { animation: phBlink 1.1s step-end infinite; }
  @keyframes phShimmer { to { background-position: 300% center; } }
  /* HUD values: visible only inside their window of the 16 s loop */
  @keyframes phWinCruise { 0%, 54.9% { opacity: 1; } 55%, 100% { opacity: 0; } }
  @keyframes phWinBrake  { 0%, 54.9% { opacity: 0; } 55%, 81.9% { opacity: 1; } 82%, 100% { opacity: 0; } }
  @keyframes phWinStop   { 0%, 81.9% { opacity: 0; } 82%, 100% { opacity: 1; } }
  @keyframes phWinMaOk   { 0%, 44.9% { opacity: 1; } 45%, 100% { opacity: 0; } }
  @keyframes phWinMaCut  { 0%, 44.9% { opacity: 0; } 45%, 100% { opacity: 1; } }
  .ph-hud { position: absolute; top: 175px; right: 18px; width: 272px; z-index: 3; pointer-events: none;
    background: var(--ph-card); border: 1px solid rgba(34,211,238,0.45); border-radius: 12px; overflow: hidden;
    backdrop-filter: blur(4px); box-shadow: 0 0 24px rgba(34,211,238,0.12); font-family: var(--font-mono); }
  .ph-hud-h { display: flex; align-items: center; gap: 7px; padding: 7px 12px; background: rgba(34,211,238,0.12);
    font-size: 10px; font-weight: 800; letter-spacing: 0.1em; color: var(--ph-cyan); }
  .ph-hud-r { display: flex; justify-content: space-between; align-items: center; padding: 4px 12px; font-size: 10px;
    border-top: 1px solid rgba(129,144,173,0.16); }
  .ph-hud-k { color: var(--ph-text-dim); font-weight: 700; letter-spacing: 0.05em; }
  .ph-hud-v { position: relative; font-weight: 800; font-size: 11px; text-align: right; min-width: 130px; height: 15px; }
  .ph-hud-v span { position: absolute; right: 0; top: 0; white-space: nowrap; }
  @container (max-height: 500px) { .ph-sub, .ph-hud { display: none; } }
  @media (prefers-reduced-motion: reduce) {
    .ph-flow, .ph-flow-r, .ph-wave, .ph-soft, .ph-blink, .ph-blink-slow { animation: none; }
    .ph-hud-v span { animation: none !important; }
  }
  /* ⚙ Settings → home animation off */
  .ph-still .ph-flow, .ph-still .ph-flow-r, .ph-still .ph-wave, .ph-still .ph-soft,
  .ph-still .ph-blink, .ph-still .ph-blink-slow { animation: none; }
  .ph-still .ph-hud-v span { animation: none !important; }
`;

/* pill label with an optional leader line to the object it names (tx, ty) */
function PhTag({ x, y, tx, ty, text, color, icon, size = 11 }) {
  const iw = icon ? size + 8 : 0;
  const w = Math.round(text.length * (size * 0.6 + 0.6) + iw + 26);
  const h = size + 13;
  return (
    <g>
      {tx != null && <>
        <line x1={x} y1={y} x2={tx} y2={ty} stroke={color} strokeWidth={1.4} strokeDasharray="3,3" opacity={0.9}/>
        <circle cx={tx} cy={ty} r={9} fill={color} opacity={0.25} className="ph-soft"/>
        <circle cx={tx} cy={ty} r={3.4} fill={color}/>
      </>}
      <g transform={`translate(${x},${y})`}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill="rgba(4,10,24,0.82)" stroke={color} strokeWidth={1.4}/>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill="none" stroke={color} strokeWidth={5} opacity={0.14}/>
        {icon && <text x={-w / 2 + 13} y={size * 0.4} fontSize={size + 1}>{icon}</text>}
        <text x={-w / 2 + 13 + iw} y={size * 0.36} fontSize={size} fontWeight={800} fill={color} fontFamily="var(--font-mono)" letterSpacing={0.6}>{text}</text>
      </g>
    </g>
  );
}

function PinjHomeScene({ onSampleC46, onSampleC42, still = false }) {
  const W = 1671, H = 941;                                // background image size
  const motion = !PH_REDUCED && !still;
  const T = `${PH_T}s`;
  const f = v => v.toFixed(3);
  const win = (a, b) => `0;${f(a)};${f(a + 0.02)};${f(b - 0.02)};${f(b)};1`;
  const show = kt => motion && <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes={kt} dur={T} repeatCount="indefinite"/>;
  const WARN = win(0.45, 0.97), BRAKE = win(0.55, 0.82), STOP = win(0.82, 0.97);

  // points on the picture (image px) — measured on kavach-bg-v3.webp
  const SAT = [{ x: 133, y: 70 }, { x: 1535, y: 128 }];
  const TOWER = { x: 468, y: 243 };                       // antenna panels
  const TOWER_LIGHT = { x: 469, y: 209 };                 // red aviation light on top
  const L1 = { gps: { x: 310, y: 480 }, radio: { x: 715, y: 479 },     // WAP-7, heading right
               lamp: [{ x: 774, y: 532 }, { x: 771, y: 552 }],
               wheels: [{ x: 320, y: 596 }, { x: 410, y: 596 }, { x: 600, y: 596 }, { x: 710, y: 596 }] };
  const L2 = { gps: { x: 1330, y: 482 }, radio: { x: 965, y: 484 },    // WAG goods, heading left
               lamp: [{ x: 911, y: 546 }, { x: 922, y: 533 }] };
  const STN = { x: 1385, y: 394 };                        // STN 523 radio (roof ridge)
  const STN_GPS = { x: 1480, y: 394 };                    // STN 523 GPS antenna (same roof)
  // 4-aspect signal in the picture: lenses top → bottom Yellow · Green · (3rd shown green in the
  // photo → repainted Yellow, as on Indian Railways) · Red — only the bottom RED lamp is lit
  const SIGNAL = { x: 41, y: 445 };                       // lit red lamp
  const SIG_LENS3 = { x: 40, y: 421 };                    // 3rd lens → unlit yellow
  const tags = [{ x: 590, y: 617 }, { x: 1120, y: 617 }]; // RFID tags between the rails
  const danger = "M784,554 L908,554 L916,622 L776,622 Z"; // track between the two loco fronts

  const hud = [
    { k: "SPEED", v: [["110 km/h", "var(--ph-green)", "phWinCruise"], ["▼ BRAKING", "var(--ph-red)", "phWinBrake"], ["0 km/h · STOP", "var(--ph-amber)", "phWinStop"]] },
    { k: "MA (C.4.2)", v: [["3230 m", "var(--ph-cyan)", "phWinMaOk"], ["▼ 240 m → EoA", "var(--ph-red)", "phWinMaCut"]] },
    { k: "SSP", v: [["130 km/h", "var(--ph-cyan)"]] },
    { k: "LAST RFID", v: [["#502 · 4.72 km", "var(--ph-amber-2)"]] },
    { k: "STATION", v: [["STN 523 · 2 s TDMA", "var(--ph-text)"]] },
    { k: "PACKET", v: [["S2L · FRM 47885", "var(--ph-text)"]] },
  ];
  const staticPick = { SPEED: 1, "MA (C.4.2)": 1 };       // reduced motion: braking moment

  return (
    <div className={"pinj-home" + (motion ? "" : " ph-still")} style={{ position: "relative", flex: 1, overflow: "hidden", background: "#030712" }}>
      <style>{PH_CSS}</style>

      {/* ── picture + live layer (same coordinates) ── */}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}>
        <defs>
          <filter id="phBlur" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5"/></filter>
          <filter id="phBlurBig" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="12"/></filter>
          <linearGradient id="phTopShade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#020617" stopOpacity="0.75"/><stop offset="100%" stopColor="#020617" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <image href={PH_BG} x={0} y={0} width={W} height={H} preserveAspectRatio="none"/>
        <rect x={0} y={0} width={W} height={150} fill="url(#phTopShade)"/>

        {/* GPS: satellites → loco GPS antennas */}
        {SAT.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={16} fill="var(--ph-gps)" opacity={0.35} filter="url(#phBlur)" className="ph-soft"/>
            {[L1.gps, L2.gps].map((g, j) => (
              <line key={j} x1={s.x} y1={s.y} x2={g.x} y2={g.y} stroke="var(--ph-gps)" strokeWidth={1.6} strokeDasharray="6,9" opacity={0.6} className="ph-flow"/>
            ))}
          </g>
        ))}

        {/* GPS: right satellite → STN 523 (station position / time fix) */}
        <line x1={SAT[1].x} y1={SAT[1].y} x2={STN_GPS.x} y2={STN_GPS.y} stroke="var(--ph-gps)" strokeWidth={1.6} strokeDasharray="6,9" opacity={0.6} className="ph-flow"/>
        <circle cx={STN_GPS.x} cy={STN_GPS.y} r={8} fill="var(--ph-gps)" opacity={0.3} filter="url(#phBlur)" className="ph-soft"/>
        <ellipse cx={STN_GPS.x} cy={STN_GPS.y} rx={4.5} ry={3} fill="var(--ph-gps)"/>

        {/* radio tower: pulses + links */}
        {[0, 0.8, 1.6].map(d => <circle key={d} cx={TOWER.x} cy={TOWER.y} r={90} fill="none" stroke="var(--ph-cyan)" strokeWidth={1.6} className="ph-wave" style={{ animationDelay: `${d}s` }}/>)}
        <circle cx={TOWER_LIGHT.x} cy={TOWER_LIGHT.y} r={9} fill="var(--ph-red)" opacity={0.6} filter="url(#phBlur)" className="ph-blink-slow"/>
        {/* tower ⇄ STN 523 (station-side communication) */}
        <path d={`M${TOWER.x + 10},${TOWER.y - 6} Q950,240 ${STN.x},${STN.y}`} fill="none" stroke="var(--ph-cyan)" strokeWidth={2.2} strokeDasharray="8,9" className="ph-flow"/>
        {[0, 1.2].map(d => <circle key={d} cx={STN.x} cy={STN.y} r={44} fill="none" stroke="var(--ph-cyan)" strokeWidth={1.3} className="ph-wave" style={{ animationDelay: `${d}s` }}/>)}
        {/* tower → Loco #12801 */}
        <line x1={TOWER.x + 8} y1={TOWER.y + 4} x2={L2.radio.x} y2={L2.radio.y} stroke="var(--ph-cyan)" strokeWidth={1.8} strokeDasharray="8,9" opacity={0.75} className="ph-flow"/>
        {/* tower ⇄ Loco #12799 : S2L (cyan) + L2S (green) */}
        {/* arcs out through the air (not down the lattice) */}
        {[{ c: "var(--ph-cyan)", bend: 150, cls: "ph-flow", w: 2.6 }, { c: "var(--ph-green)", bend: 120, cls: "ph-flow-r", w: 2 }].map(b => {
          const d = `M${TOWER.x + 20},${TOWER.y + 4} Q${TOWER.x + b.bend + 60},${(TOWER.y + L1.radio.y) / 2} ${L1.radio.x + 4},${L1.radio.y - 4}`;
          return (
            <g key={b.c}>
              <path d={d} fill="none" stroke={b.c} strokeWidth={b.w * 3.5} opacity={0.22} filter="url(#phBlur)"/>
              <path d={d} fill="none" stroke={b.c} strokeWidth={b.w} strokeDasharray="8,9" strokeLinecap="round" className={b.cls}/>
            </g>
          );
        })}
        {[L1.radio, L2.radio].map((p, i) => [0, 1.1].map(d => (
          <circle key={`${i}${d}`} cx={p.x} cy={p.y} r={30} fill="none" stroke="var(--ph-green)" strokeWidth={1.2} className="ph-wave" style={{ animationDelay: `${d + i * 0.5}s` }}/>
        )))}

        {/* signal: bottom RED lamp lit (as in the picture) + glow; 3rd lens repainted unlit yellow */}
        <circle cx={SIG_LENS3.x} cy={SIG_LENS3.y} r={7.5} fill="#07090b"/>
        <circle cx={SIG_LENS3.x} cy={SIG_LENS3.y} r={5.4} fill="#211903" stroke="#5c4708" strokeWidth={1.4}/>
        <circle cx={SIG_LENS3.x - 1.4} cy={SIG_LENS3.y - 1.6} r={1.2} fill="#5c4708" opacity={0.9}/>
        <circle cx={SIGNAL.x} cy={SIGNAL.y} r={14} fill="#ef4444" opacity={0.5} filter="url(#phBlur)" className="ph-soft"/>
        {/* headlights */}
        {[...L1.lamp, ...L2.lamp].map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={10} fill="#fef9c3" opacity={0.5} filter="url(#phBlur)" className="ph-soft" style={{ animationDelay: `${i * 0.3}s` }}/>)}

        {/* RFID tags on the track */}
        {tags.map((t, i) => (
          <g key={i}>
            <circle cx={t.x} cy={t.y} r={12} fill="var(--ph-amber)" opacity={0.45} filter="url(#phBlur)" className="ph-soft" style={{ animationDelay: `${i * 0.6}s` }}/>
            <rect x={t.x - 9} y={t.y - 3} width={18} height={6} rx={1.5} fill="var(--ph-amber)" transform={`rotate(-15 ${t.x} ${t.y})`}/>
          </g>
        ))}

        {/* warning: danger zone on the converging track */}
        <g opacity={motion ? 0 : 1}>
          {show(WARN)}
          <path d={danger} fill="var(--ph-red)" opacity={0.45} filter="url(#phBlurBig)" className="ph-soft"/>
          <path d={danger} fill="none" stroke="var(--ph-red)" strokeWidth={2} strokeDasharray="10,7" className="ph-flow"/>
          {[0, 1, 2].map(k => (
            <path key={k} d={`M${896 - k * 16},530 Q${880 - k * 16},565 ${896 - k * 16},600`} fill="none" stroke="var(--ph-red)"
              strokeWidth={3} opacity={0.85 - k * 0.22} className="ph-soft" style={{ animationDelay: `${k * 0.25}s` }}/>
          ))}
          <g transform="translate(818,620)">
            <rect x={-20} y={-30} width={40} height={18} rx={4} fill="var(--ph-red)"/>
            <text y={-17} textAnchor="middle" fontSize={11} fontWeight={900} fill="#fff" fontFamily="var(--font-mono)">EoA</text>
            <line x1={0} y1={-12} x2={0} y2={0} stroke="var(--ph-red)" strokeWidth={2}/>
          </g>
        </g>
        {/* automatic braking: brake glow under Loco #12799 */}
        <g opacity={motion ? 0 : 1}>
          {show(BRAKE)}
          {L1.wheels.map((p, i) => <ellipse key={i} cx={p.x} cy={p.y} rx={34} ry={10} fill="#fb923c" opacity={0.75} filter="url(#phBlur)" className="ph-blink"/>)}
        </g>

        {/* labels */}
        <PhTag x={300} y={140} tx={SAT[0].x} ty={SAT[0].y} text="GPS SATELLITES" color="var(--ph-gps)" icon="🛰"/>
        <PhTag x={660} y={205} tx={TOWER.x + 8} ty={TOWER.y} text="STATIONARY KAVACH · RADIO TOWER" color="var(--ph-cyan)" icon="📡"/>
        <PhTag x={850} y={335} tx={641} ty={361} text="S2L · C.4.2  MA · SSP · GRADIENT ▸" color="var(--ph-cyan)" size={10}/>
        <PhTag x={850} y={365} text="◂ L2S · C.4.3  LOCO POSITION" color="var(--ph-green)" size={10}/>
        <PhTag x={1000} y={235} text="STATION-SIDE COMMUNICATION" color="var(--ph-cyan)" icon="📶" size={10}/>
        <PhTag x={1190} y={350} tx={STN.x} ty={STN.y} text="STN 523 · STATIONARY KAVACH" color="var(--ph-cyan)" icon="🏢"/>
        <PhTag x={170} y={330} tx={SIGNAL.x} ty={SIGNAL.y} text="SIGNAL · RED" color="var(--ph-red)" icon="🚦" size={10}/>
        <PhTag x={420} y={690} tx={420} ty={560} text="LOCO #12799 · ONBOARD KAVACH" color="var(--ph-cyan)" icon="🔲"/>
        <PhTag x={1180} y={690} tx={1180} ty={560} text="LOCO #12801 · GOODS" color="var(--ph-text)" icon="🚆"/>
        <PhTag x={640} y={770} tx={tags[0].x} ty={tags[0].y} text="RFID TAGS #502 · #504" color="var(--ph-amber)" size={10}/>
        <g opacity={motion ? 0 : 1}>
          {show(WARN)}
          <g className="ph-soft"><PhTag x={845} y={425} text="WARNING · MA SHORTENED / OVER-SPEED" color="var(--ph-amber)" icon="⚠" size={12}/></g>
        </g>
        <g opacity={motion ? 0 : 1}>
          {show(BRAKE)}
          <PhTag x={845} y={462} text="AUTOMATIC BRAKING" color="var(--ph-red)" icon="🛑" size={13}/>
        </g>
        {motion && (
          <g opacity={0}>
            {show(STOP)}
            <PhTag x={845} y={462} text="✓ STOPPED SHORT OF EoA" color="var(--ph-green)" size={13}/>
          </g>
        )}
      </svg>

      {/* ── title ── */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 12, zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, pointerEvents: "none" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 34, letterSpacing: "0.16em", color: "var(--ph-title)", lineHeight: 1, textShadow: "0 2px 18px rgba(0,0,0,0.8)" }}>
          <span style={{
            background: "linear-gradient(90deg, var(--ph-amber), var(--ph-amber-2), var(--ph-cyan), var(--ph-amber-2), var(--ph-amber))", backgroundSize: "300% auto",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            animation: PH_REDUCED ? "none" : "phShimmer 6s linear infinite", filter: "drop-shadow(0 0 10px rgba(245,166,35,0.5))",
          }}>PINJ</span> — KAVACH PACKET INJECTOR &amp; DECODER
        </div>
        <div className="ph-sub" style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", color: "var(--ph-cyan)", display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}>
          <span>INJECT · TRANSMIT · RECEIVE · DECODE · VISUALISE</span>
        </div>
      </div>

      {/* ── onboard Kavach readout (sample values, changing with the loop) ── */}
      <div className="ph-hud">
        <div className="ph-hud-h"><span className="ph-blink-slow" style={{ color: "var(--ph-green)" }}>●</span>ONBOARD KAVACH · LOCO #12799</div>
        {hud.map(r => (
          <div key={r.k} className="ph-hud-r">
            <span className="ph-hud-k">{r.k}</span>
            <span className="ph-hud-v">
              {r.v.map(([t, c, anim], j) => (
                <span key={j} style={{ color: c,
                  ...(anim ? (!motion ? { opacity: j === (staticPick[r.k] ?? 0) ? 1 : 0 } : { animation: `${anim} ${PH_T}s step-end infinite` }) : null) }}>{t}</span>
              ))}
            </span>
          </div>
        ))}
      </div>

      {/* ── empty-state hint + samples over the bottom of the picture ── */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 2, paddingTop: 26,
        background: "linear-gradient(180deg, transparent, rgba(2,6,23,0.85) 55%)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap", padding: "9px 16px 11px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 16, letterSpacing: "0.14em", color: "var(--ph-amber)" }}>NO PACKETS DECODED</div>
          <div style={{ fontSize: 10.5, color: "var(--ph-text)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
            <span className="ph-blink-slow" style={{ color: "var(--ph-green)" }}>▌</span> Paste JSON · press ⚡ DECODE · or drop a log file
          </div>
          <button onClick={onSampleC46} className="kv-btn kv-btn-decode" style={{ fontSize: 11, padding: "7px 18px" }}>⚡ LOAD SAMPLE C.4.6</button>
          <button onClick={onSampleC42} className="kv-btn" style={{
              background: "rgba(0,229,255,0.08)", color: "var(--cyan)", border: "1px solid rgba(0,229,255,0.45)", padding: "7px 18px", fontSize: 11, transition: "all 0.2s ease" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,229,255,0.16)"; e.currentTarget.style.boxShadow = "0 0 18px rgba(0,229,255,0.25)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,229,255,0.08)"; e.currentTarget.style.boxShadow = "none"; }}>
            🗺 LOAD SAMPLE C.4.2
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CINEMATIC TRAIN SCENE — fixed canvas background
   Professional locomotive with parallax hills, particle systems,
   rail sparks, smoke volumetrics, speed streaks, blue+brown particles
═══════════════════════════════════════════════════════════════ */
function TrainSceneBackground({ isLight }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    /* ── sizing ── */
    let W = 0, H = 0;
    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    /* ── palette ── */
    const BLUE_PAL  = ["#051a3e","#0c3278","#1552c0","#2279ff","#55aaff","#90ccff","#c4e8ff"];
    const BROWN_PAL = ["#2e0e00","#5a1e00","#8c3200","#c45000","#f5a623","#ffc14d","#ffdfa0"];

    /* ═══════════════════════════════════════════════════
       TRAIN STATE
    ══════════════════════════════════════════════════ */
    let trainX    = -500;
    const TRAIN_Y = () => H * 0.60;
    let trainSpd  = 3.8;
    let wheelAngle = 0;

    /* ═══════════════════════════════════════════════════
       PARTICLES
    ══════════════════════════════════════════════════ */
    const NPARTICLES = 320;
    const parts = [];

    function mkPart(forced) {
      const isBrown = Math.random() > 0.44;
      const pal   = isBrown ? BROWN_PAL : BLUE_PAL;
      const tier  = Math.floor(Math.pow(Math.random(), 1.4) * pal.length);
      const big   = tier >= 4;
      const sz    = big ? 1.4 + Math.random() * 3.2 : 0.4 + Math.random() * 1.8;
      const fromEngine = forced || Math.random() > 0.42;
      let x, y;
      if (fromEngine) {
        x = trainX + 20 + (Math.random() - 0.5) * 60;
        y = TRAIN_Y() - 10 + (Math.random() - 0.5) * 30;
      } else {
        x = Math.random() * W;
        y = H * (0.25 + Math.random() * 0.45);
      }
      return {
        x, y,
        vx: fromEngine ? trainSpd * 0.18 + Math.random() * 3.5 : (Math.random() - 0.5) * 0.9,
        vy: fromEngine ? -(0.4 + Math.random() * 2.2) : (Math.random() - 0.5) * 0.7,
        ax: fromEngine ? 0.04 + Math.random() * 0.10 : 0.0,
        ay: 0.012 + Math.random() * 0.022,
        sz,
        col: pal[tier],
        alpha: 0,
        maxAlpha: big ? 0.55 + Math.random() * 0.40 : 0.20 + Math.random() * 0.35,
        life: 0,
        maxLife: 90 + Math.random() * 200,
        isBrown, big,
        shape: Math.random() > 0.68 ? 1 : 0, /* 0=circle 1=square */
        angle: Math.random() * Math.PI * 2,
        spin:  (Math.random() - 0.5) * 0.07,
      };
    }

    for (let i = 0; i < NPARTICLES; i++) {
      const p = mkPart(false);
      p.life = Math.random() * p.maxLife;
      parts.push(p);
    }

    function tickParts() {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.life++;
        if (p.life > p.maxLife) { parts[i] = mkPart(Math.random() > 0.45); continue; }
        p.x  += p.vx; p.y  += p.vy;
        p.vx += p.ax; p.vy += p.ay;
        p.angle += p.spin;
        const t = p.life / p.maxLife;
        p.alpha = (t < 0.12 ? t / 0.12 : t > 0.78 ? (1 - t) / 0.22 : 1) * p.maxAlpha;
      }
    }

    function drawParts() {
      for (const p of parts) {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        if (p.big) { ctx.shadowBlur = 7; ctx.shadowColor = p.col; }
        ctx.fillStyle = p.col;
        if (p.shape === 1) {
          ctx.fillRect(-p.sz * 0.5, -p.sz * 0.5, p.sz, p.sz);
        } else {
          ctx.beginPath(); ctx.arc(0, 0, p.sz * 0.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }

    /* ═══════════════════════════════════════════════════
       SPARKS
    ══════════════════════════════════════════════════ */
    const sparks = [];
    function spawnSpark() {
      if (Math.random() > 0.30) return;
      sparks.push({
        x: trainX - 60 + Math.random() * 160,
        y: TRAIN_Y() + 30,
        vx: (Math.random() - 0.4) * 2.8 + trainSpd * 0.25,
        vy: -(1.2 + Math.random() * 2.8),
        life: 0, maxLife: 18 + Math.random() * 28,
        col: Math.random() > 0.5 ? "#f5a623" : "#3a8fff",
        sz:  0.8 + Math.random() * 1.6,
      });
    }
    function tickDrawSparks() {
      spawnSpark();
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life++; if (s.life > s.maxLife) { sparks.splice(i, 1); continue; }
        s.x += s.vx; s.vy += 0.18; s.y += s.vy;
        const a = (1 - s.life / s.maxLife) * 0.92;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = s.col;
        ctx.shadowBlur = 5; ctx.shadowColor = s.col;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.sz, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    /* ═══════════════════════════════════════════════════
       SMOKE PUFFS
    ══════════════════════════════════════════════════ */
    const smokes = [];
    let smokeTimer = 0;
    function spawnSmoke() {
      const sx = trainX - 38, sy = TRAIN_Y() - 80;
      for (let k = 0; k < 2; k++) {
        smokes.push({
          x: sx + (Math.random() - 0.5) * 10,
          y: sy + Math.random() * 6,
          r: 4 + Math.random() * 6,
          vx: trainSpd * 0.20 + (Math.random() - 0.5) * 0.6,
          vy: -(0.8 + Math.random() * 1.4),
          life: 0, maxLife: 130 + Math.random() * 80,
          col: k === 0 ? "#12203a" : "#1c1208",
          dr: (Math.random() - 0.5) * 0.25,
        });
      }
    }
    function tickDrawSmoke() {
      smokeTimer++;
      if (smokeTimer % 7 === 0) spawnSmoke();
      for (let i = smokes.length - 1; i >= 0; i--) {
        const s = smokes[i];
        s.life++; if (s.life > s.maxLife) { smokes.splice(i, 1); continue; }
        s.x += s.vx; s.y += s.vy; s.r += 0.28; s.vx += s.dr; s.vy *= 0.985;
        const t = s.life / s.maxLife;
        const a = (t < 0.14 ? t / 0.14 : 1 - t) * 0.42;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = s.col;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    /* ═══════════════════════════════════════════════════
       SPEED STREAKS
    ══════════════════════════════════════════════════ */
    const streaks = Array.from({ length: 28 }, () => ({
      x: Math.random() * W * 1.5,
      y: H * (0.28 + Math.random() * 0.42),
      len: 20 + Math.random() * 90,
      spd: 5 + Math.random() * 14,
      alpha: 0.04 + Math.random() * 0.12,
      col: Math.random() > 0.5 ? BLUE_PAL[2] : BROWN_PAL[3],
      thick: 0.3 + Math.random() * 1.0,
    }));

    function tickDrawStreaks() {
      for (const s of streaks) {
        s.x -= s.spd;
        if (s.x + s.len < 0) {
          s.x = W + 30; s.y = H * (0.26 + Math.random() * 0.46);
          s.len = 20 + Math.random() * 90; s.spd = 5 + Math.random() * 14;
          s.alpha = 0.04 + Math.random() * 0.12;
        }
        const hex = Math.floor(s.alpha * 255).toString(16).padStart(2, "0");
        ctx.strokeStyle = s.col + hex;
        ctx.lineWidth = s.thick;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + s.len, s.y); ctx.stroke();
      }
    }

    /* ═══════════════════════════════════════════════════
       HORIZON + PARALLAX HILLS
    ══════════════════════════════════════════════════ */
    let hillOff = 0;
    function drawScene() {
      hillOff += trainSpd * 0.055;
      const HZ = H * 0.42;

      /* sky gradient */
      const sky = ctx.createLinearGradient(0, 0, 0, HZ + 80);
      sky.addColorStop(0, "#020208");
      sky.addColorStop(0.55, "#06060f");
      sky.addColorStop(1, "#0a0a1a");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, HZ + 80);

      /* star field */
      ctx.fillStyle = "rgba(160,200,255,0.45)";
      for (let i = 0; i < 90; i++) {
        const sx = ((i * 431 + hillOff * 0.04) % W);
        const sy = (i * 213) % (HZ * 0.88);
        const r  = 0.4 + (i % 3) * 0.35;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      }

      /* moon */
      const mx = W * 0.72, my = H * 0.08;
      const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 55);
      mg.addColorStop(0, "rgba(200,215,255,0.22)");
      mg.addColorStop(0.5, "rgba(120,155,255,0.06)");
      mg.addColorStop(1, "transparent");
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, 55, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(225,235,255,0.82)";
      ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2); ctx.fill();

      /* far hills – deep navy */
      ctx.fillStyle = "#090e20";
      ctx.beginPath(); ctx.moveTo(0, HZ + 35);
      for (let x = 0; x <= W + 80; x += 3) {
        const nx = (x - hillOff * 0.22 + W * 10) % (W + 160);
        const ny = HZ + 35 + Math.sin(nx * 0.009) * 30 + Math.sin(nx * 0.004) * 20;
        ctx.lineTo(x, ny);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

      /* mid hills – near-black brown-navy */
      const mhg = ctx.createLinearGradient(0, HZ, 0, HZ + 70);
      mhg.addColorStop(0, "#100a04"); mhg.addColorStop(1, "#070505");
      ctx.fillStyle = mhg;
      ctx.beginPath(); ctx.moveTo(0, HZ + 55);
      for (let x = 0; x <= W + 80; x += 3) {
        const nx = (x - hillOff * 0.58 + W * 10) % (W + 160);
        const ny = HZ + 55 + Math.sin(nx * 0.013) * 22 + Math.sin(nx * 0.006 + 1) * 16;
        ctx.lineTo(x, ny);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

      /* ground */
      const gy = H * 0.60 + 34;
      const fg = ctx.createLinearGradient(0, gy, 0, H);
      fg.addColorStop(0, "#0e0804"); fg.addColorStop(0.5, "#080503"); fg.addColorStop(1, "#040302");
      ctx.fillStyle = fg; ctx.fillRect(0, gy, W, H - gy);

      /* horizon amber glow */
      const hgr = ctx.createLinearGradient(0, HZ + 50, 0, HZ + 78);
      hgr.addColorStop(0, "rgba(245,166,35,0.055)"); hgr.addColorStop(1, "transparent");
      ctx.fillStyle = hgr; ctx.fillRect(0, HZ + 50, W, 28);
    }

    /* ═══════════════════════════════════════════════════
       RAIL TRACKS
    ══════════════════════════════════════════════════ */
    let tieOff = 0;
    function drawTracks() {
      const ty = TRAIN_Y() + 34;
      tieOff = (tieOff + trainSpd * 0.6) % 42;

      /* ballast */
      const rb = ctx.createLinearGradient(0, ty - 3, 0, ty + 14);
      rb.addColorStop(0, "rgba(22,14,4,0)"); rb.addColorStop(0.4, "rgba(32,18,5,0.5)"); rb.addColorStop(1, "rgba(8,5,2,0)");
      ctx.fillStyle = rb; ctx.fillRect(0, ty - 3, W, 18);

      /* sleepers */
      const cnt = Math.floor(W / 42) + 3;
      for (let i = -1; i < cnt; i++) {
        const x = i * 42 - tieOff;
        const tg = ctx.createLinearGradient(0, ty + 2, 0, ty + 12);
        tg.addColorStop(0, "rgba(55,28,6,0.72)"); tg.addColorStop(1, "rgba(22,10,2,0.42)");
        ctx.fillStyle = tg;
        ctx.beginPath(); ctx.roundRect(x - 2, ty + 3, 30, 9, 2); ctx.fill();
      }

      /* rails */
      for (const d of [-7, 7]) {
        const rg = ctx.createLinearGradient(0, ty + d - 1.5, 0, ty + d + 2.5);
        rg.addColorStop(0, "#9aadbe"); rg.addColorStop(0.5, "#bcd4e4"); rg.addColorStop(1, "#607888");
        ctx.fillStyle = rg; ctx.fillRect(0, ty + d - 1.5, W, 3.5);
        ctx.strokeStyle = "rgba(180,220,255,0.13)"; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(0, ty + d - 1.5); ctx.lineTo(W, ty + d - 1.5); ctx.stroke();
      }
    }

    /* ═══════════════════════════════════════════════════
       LOCOMOTIVE — detailed SVG-style on canvas
    ══════════════════════════════════════════════════ */
    function drawLoco(tx, ty) {
      ctx.save();
      ctx.translate(tx, ty);

      /* headlamp beam */
      ctx.save();
      ctx.globalAlpha = 0.06;
      const beam = ctx.createLinearGradient(108, -12, 420, 30);
      beam.addColorStop(0, "#ffe090"); beam.addColorStop(1, "transparent");
      ctx.fillStyle = beam;
      ctx.beginPath(); ctx.moveTo(108, -12); ctx.lineTo(440, -65); ctx.lineTo(440, 65); ctx.closePath(); ctx.fill();
      ctx.restore();

      /* cab body glow */
      const cabGlow = ctx.createRadialGradient(-80, -30, 0, -80, -30, 80);
      cabGlow.addColorStop(0, "rgba(245,166,35,0.07)"); cabGlow.addColorStop(1, "transparent");
      ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = cabGlow;
      ctx.beginPath(); ctx.arc(-80, -30, 80, 0, Math.PI * 2); ctx.fill(); ctx.restore();

      /* underframe */
      ctx.fillStyle = "#0f0f14";
      ctx.beginPath(); ctx.roundRect(-130, -18, 248, 44, 5); ctx.fill();

      /* boiler */
      const boilerG = ctx.createLinearGradient(0, -38, 0, 12);
      boilerG.addColorStop(0, "#2a2a36"); boilerG.addColorStop(0.35, "#363648"); boilerG.addColorStop(1, "#0d0d12");
      ctx.fillStyle = boilerG;
      ctx.beginPath(); ctx.roundRect(-78, -36, 168, 50, 22); ctx.fill();
      ctx.strokeStyle = "rgba(245,166,35,0.30)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.roundRect(-78, -36, 168, 50, 22); ctx.stroke();

      /* boiler band rings */
      for (const bx of [-30, 30, 70]) {
        ctx.strokeStyle = "rgba(245,166,35,0.12)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx, -32); ctx.lineTo(bx, 10); ctx.stroke();
      }

      /* cab section */
      const cabG = ctx.createLinearGradient(-130, -56, -130, 28);
      cabG.addColorStop(0, "#1e1e2c"); cabG.addColorStop(1, "#10101a");
      ctx.fillStyle = cabG;
      ctx.beginPath(); ctx.roundRect(-130, -56, 66, 80, [5, 5, 0, 0]); ctx.fill();
      ctx.strokeStyle = "rgba(245,166,35,0.18)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(-130, -56, 66, 80, [5, 5, 0, 0]); ctx.stroke();

      /* cab window with blue glow */
      const winG = ctx.createRadialGradient(-100, -34, 0, -100, -34, 20);
      winG.addColorStop(0, "rgba(30,120,255,0.65)"); winG.addColorStop(0.7, "rgba(10,60,180,0.30)"); winG.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = winG;
      ctx.beginPath(); ctx.roundRect(-122, -50, 40, 30, 3); ctx.fill();
      ctx.strokeStyle = "rgba(55,143,255,0.50)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(-122, -50, 40, 30, 3); ctx.stroke();

      /* secondary window */
      ctx.fillStyle = "rgba(8,40,120,0.45)";
      ctx.beginPath(); ctx.roundRect(-76, -50, 22, 18, 2); ctx.fill();
      ctx.strokeStyle = "rgba(55,143,255,0.25)"; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.roundRect(-76, -50, 22, 18, 2); ctx.stroke();

      /* smokestack base + cap */
      ctx.fillStyle = "#1a1a22";
      ctx.beginPath(); ctx.roundRect(-56, -72, 16, 40, [2, 2, 1, 1]); ctx.fill();
      ctx.fillStyle = "#262636";
      ctx.beginPath(); ctx.roundRect(-61, -76, 26, 8, 3); ctx.fill();
      ctx.strokeStyle = "rgba(245,166,35,0.25)"; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.roundRect(-61, -76, 26, 8, 3); ctx.stroke();

      /* dome */
      ctx.fillStyle = "#242434";
      ctx.beginPath(); ctx.arc(20, -36, 13, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = "rgba(245,166,35,0.20)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(20, -36, 13, Math.PI, 0); ctx.stroke();

      /* sand dome */
      ctx.fillStyle = "#1c1c2a";
      ctx.beginPath(); ctx.arc(-10, -38, 9, Math.PI, 0); ctx.fill();

      /* front plate */
      ctx.fillStyle = "#181820";
      ctx.beginPath(); ctx.roundRect(90, -22, 18, 38, [3, 3, 2, 2]); ctx.fill();
      ctx.strokeStyle = "rgba(245,166,35,0.22)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(90, -22, 18, 38, [3, 3, 2, 2]); ctx.stroke();

      /* headlamp */
      const hlTime = Date.now() * 0.001;
      const hlFlicker = 0.85 + Math.sin(hlTime * 7.3) * 0.06 + Math.sin(hlTime * 3.1) * 0.04;
      ctx.save();
      ctx.globalAlpha = hlFlicker;
      const hlg = ctx.createRadialGradient(110, -4, 0, 110, -4, 28);
      hlg.addColorStop(0, "rgba(255,230,120,1.0)"); hlg.addColorStop(0.3, "rgba(255,185,55,0.55)"); hlg.addColorStop(1, "transparent");
      ctx.fillStyle = hlg; ctx.beginPath(); ctx.arc(110, -4, 28, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,240,160,0.9)";
      ctx.beginPath(); ctx.arc(109, -4, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      /* coupling */
      ctx.fillStyle = "#555"; ctx.beginPath(); ctx.roundRect(-148, 4, 20, 10, 2); ctx.fill();
      ctx.fillStyle = "#444"; ctx.beginPath(); ctx.roundRect(-160, 7, 14, 5, 1); ctx.fill();

      /* step boards */
      ctx.fillStyle = "#222230";
      for (const sx of [-115, -100]) {
        ctx.beginPath(); ctx.roundRect(sx, 18, 12, 4, 1); ctx.fill();
      }

      /* ── WHEELS ── */
      const wheelData = [
        { x: -100, r: 16 }, // small lead
        { x: -58,  r: 20 }, // big drive 1
        { x: -2,   r: 20 }, // big drive 2
        { x: 54,   r: 20 }, // big drive 3
      ];

      for (const { x: wx, r } of wheelData) {
        /* shadow */
        ctx.save(); ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.ellipse(wx + 3, 32 + 3, r, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        /* rim glow */
        const wg = ctx.createRadialGradient(wx - 5, 22, 0, wx, 26, r);
        wg.addColorStop(0, "#4a4a5a"); wg.addColorStop(0.55, "#1e1e2e"); wg.addColorStop(1, "#0c0c18");
        ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(wx, 26, r, 0, Math.PI * 2); ctx.fill();

        /* tire */
        ctx.strokeStyle = "rgba(245,166,35,0.55)"; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(wx, 26, r - 1.5, 0, Math.PI * 2); ctx.stroke();

        /* spokes */
        ctx.strokeStyle = "#2e2e3e"; ctx.lineWidth = 1.2;
        const nSpokes = r > 18 ? 8 : 6;
        for (let s = 0; s < nSpokes; s++) {
          const a = wheelAngle + (s / nSpokes) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(wx, 26);
          ctx.lineTo(wx + Math.cos(a) * (r - 3), 26 + Math.sin(a) * (r - 3));
          ctx.stroke();
        }

        /* hub */
        ctx.fillStyle = "#f5a623"; ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.arc(wx, 26, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#1a1a28"; ctx.beginPath(); ctx.arc(wx, 26, 2, 0, Math.PI * 2); ctx.fill();
      }

      /* connecting rod */
      const rodY = 26 + Math.sin(wheelAngle) * 6;
      ctx.strokeStyle = "rgba(245,166,35,0.40)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-100, rodY); ctx.lineTo(54, rodY + Math.cos(wheelAngle) * 3); ctx.stroke();
      ctx.strokeStyle = "rgba(100,180,255,0.22)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-100, rodY); ctx.lineTo(54, rodY + Math.cos(wheelAngle) * 3); ctx.stroke();

      /* valve gear */
      ctx.strokeStyle = "rgba(245,166,35,0.22)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-58, 26); ctx.lineTo(-30, 26 + Math.sin(wheelAngle + 0.8) * 5); ctx.stroke();

      ctx.restore();
    }

    /* ═══════════════════════════════════════════════════
       VIGNETTE
    ══════════════════════════════════════════════════ */
    function drawVignette() {
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.78);
      vg.addColorStop(0, "transparent");
      vg.addColorStop(1, "rgba(0,0,0,0.72)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }

    /* ═══════════════════════════════════════════════════
       MAIN LOOP
    ══════════════════════════════════════════════════ */
    let last = 0;
    function loop(ts) {
      const dt = Math.min((ts - last) / 16, 3.0);
      last = ts;

      ctx.clearRect(0, 0, W, H);

      drawScene();
      drawTracks();
      tickDrawStreaks();

      /* update train */
      wheelAngle += 0.055 * trainSpd * dt;
      trainX     += trainSpd * dt;
      if (trainX > W + 520) trainX = -520;

      /* train shadow */
      ctx.save();
      ctx.globalAlpha = 0.20;
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.ellipse(trainX, TRAIN_Y() + 36, 140, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      tickDrawSmoke();
      drawLoco(trainX, TRAIN_Y());
      tickDrawSparks();
      tickParts();
      drawParts();
      drawVignette();

      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 0,
        opacity: isLight ? 0 : 1,
        transition: "opacity 0.4s ease",
      }}
    />
  );
}

export default function App() {
  // Saved theme is read HERE, when the state is created. (It used to be read
  // in a separate effect, but the "persist theme" effect below runs first on
  // mount and overwrote the saved "light" with "dark" — so the light theme
  // was lost on every reload.)
  const [isLight, setIsLight]     = useState(() => {
    try { return localStorage.getItem("kavach-theme") === "light"; } catch { return false; }
  });
  const [input, setInput]         = useState("");
  const [results, setResults]     = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [status, setStatus]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [dragging, setDragging]   = useState(false);
  const [backendOk, setBackendOk] = useState(null);
  // INPUT JSON + LOG / CRC VERIFY panels start hidden — opened with "▼ INPUT",
  // a LOAD SAMPLE button, or by dropping a file.
  const [inputOpen, setInputOpen] = useState(() => appSettingsStore.get().decoderInputOpen);
  // ⚙ Settings → General → "Open on start"
  const [activeTab, setActiveTab] = useState(() => ({ live: "live", svksim: "svksim" })[appSettingsStore.get().startPage] || "decode");
  const [searchQuery, setSearchQuery] = useState("");
  const [showTimeline, setShowTimeline] = useState(() => appSettingsStore.get().decoderTimeline);
  // ── Multi-Loco accumulation: { locoKey: { label, packets:[] } }
  const [locoMap, setLocoMap]         = useState({});
  const [selectedLocoKey, setSelectedLocoKey] = useState(null);
  const [selectedProfileIdx, setSelectedProfileIdx] = useState(0);
  const fileRef  = useRef();
  const logRef   = useRef();
  const tableRef = useRef();
  const [logFiles,      setLogFiles]      = useState([]);    // [{id,name,stats,packets,collapsed}]
  const [exportingLog,  setExportingLog]  = useState(false); // true while log-panel Excel export is running
  const [selectedLog,   setSelectedLog]   = useState(null);  // {fileId, pktIdx}
  const [crcPanelWidth, setCrcPanelWidth] = useState(300);   // resizable CRC panel width
  const crcResizeRef = useRef(null);
  const appSettings  = useStore(appSettingsStore);
  const [dialog, setDialog] = useState(null);        // null | "settings" | "about" (top bar, every page)
  useEffect(() => {
    const onKey = e => {
      if (e.key === "Escape" && dialog) { setDialog(null); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === ",") { e.preventDefault(); setDialog("settings"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  // Apply theme class to <html> + persist the preference
  useEffect(() => {
    document.documentElement.classList.toggle("light", isLight);
    try { localStorage.setItem("kavach-theme", isLight ? "light" : "dark"); } catch { /* storage blocked */ }
  }, [isLight]);
  // theme changed in another tab (e.g. the Packet Simulator) → follow it here
  useEffect(() => {
    const onStorage = e => { if (e.key === "kavach-theme" && e.newValue) setIsLight(e.newValue === "light"); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Backend health check
  useEffect(() => {
    fetch("http://localhost:8000/health", { signal: AbortSignal.timeout(1500) })
      .then(r=>r.json()).then(()=>setBackendOk(true)).catch(()=>setBackendOk(false));
  }, []);

  // ── Boot sound: plays once when the app loads ──────────────────────────
  useEffect(() => {
    if (!appSettingsStore.get().bootSound) return;      // ⚙ Settings → General → start-up sound
    const playBoot = () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const tone = (freq, start, dur, type = "sawtooth", gain = 0.15) => {
          const osc = ctx.createOscillator();
          const g   = ctx.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(freq, start);
          g.gain.setValueAtTime(0, start);
          g.gain.linearRampToValueAtTime(gain, start + 0.01);
          g.gain.exponentialRampToValueAtTime(0.001, start + dur);
          osc.connect(g); g.connect(ctx.destination);
          osc.start(start); osc.stop(start + dur);
        };
        const t = ctx.currentTime;
        // Rising scan sweep
        tone(180,  t,        0.08, "square",   0.10);
        tone(360,  t + 0.08, 0.06, "square",   0.09);
        tone(720,  t + 0.14, 0.06, "square",   0.11);
        tone(1440, t + 0.20, 0.04, "square",   0.13);
        // Deep power thud
        tone(55,   t + 0.22, 0.20, "sine",     0.20);
        // Sharp confirm beeps
        tone(2200, t + 0.26, 0.07, "sine",     0.16);
        tone(3000, t + 0.30, 0.05, "sine",     0.12);
        // Final warm power-up hum
        tone(440,  t + 0.34, 0.30, "sawtooth", 0.07);
        tone(880,  t + 0.36, 0.25, "sawtooth", 0.05);
      } catch (_) { /* AudioContext unavailable */ }
      document.removeEventListener("pointerdown", playBoot);
    };

    // Try immediately (works if page already had interaction),
    // otherwise fire on the very first pointer event (browser autoplay policy).
    try {
      const probe = new (window.AudioContext || window.webkitAudioContext)();
      if (probe.state === "running") { probe.close(); playBoot(); }
      else { probe.close(); document.addEventListener("pointerdown", playBoot, { once: true }); }
    } catch (_) {
      document.addEventListener("pointerdown", playBoot, { once: true });
    }

    return () => document.removeEventListener("pointerdown", playBoot);
  }, []);

  /* ── Normalize backend results — uses module-level normalizeResult() ── */

  /* ── Extract a stable loco-key from a decoded result ── */
  const getLocoKey = (r) => {
    if (!r || !Array.isArray(r.fields)) return `pkt-${r?.packet_index ?? Math.random()}`;
    const f = r.fields;
    const get = (...names) => { for (const n of names) { const fld = f.find(x=>(x.Field||"").trim()===n); if (fld && Number(fld["Decimal Value"])>0) return Number(fld["Decimal Value"]); } return null; };
    const locoId = get("DEST_LOCO_ID","SOURCE_LOCO_ID");
    if (locoId) return `loco-${locoId}`;
    const stnId  = get("SOURCE_STN_ILC_IBS_ID","SOURCE_STN_ID");
    if (stnId)  return `stn-${stnId}`;
    return `pkt-${r.packet_type_value}-${r.packet_index??0}`;
  };
  const getLocoLabel = (r) => {
    if (!r || !Array.isArray(r.fields)) return `PKT #${r?.packet_index??'?'}`;
    const f = r.fields;
    const get = (...names) => { for (const n of names) { const fld = f.find(x=>(x.Field||"").trim()===n); if (fld && Number(fld["Decimal Value"])>0) return Number(fld["Decimal Value"]); } return null; };
    const locoId = get("DEST_LOCO_ID","SOURCE_LOCO_ID");
    if (locoId) return `Loco #${locoId}`;
    const stnId  = get("SOURCE_STN_ILC_IBS_ID","SOURCE_STN_ID");
    if (stnId)  return `Stn #${stnId}`;
    return `PKT #${r.packet_index??'?'}`;
  };

  /* ── Merge new results into locoMap ── */
  const mergeIntoLocoMap = useCallback((normalized) => {
    setLocoMap(prev => {
      const next = { ...prev };
      for (const r of normalized) {
        const key   = getLocoKey(r);
        const label = getLocoLabel(r);
        if (!next[key]) next[key] = { label, packets: [] };
        // Replace packet if same packet_index, else append
        const idx = next[key].packets.findIndex(p => p.packet_index === r.packet_index && p.packet_index != null);
        if (idx >= 0) next[key].packets[idx] = r;
        else next[key].packets = [...next[key].packets, r];
        next[key].label = label; // update label with latest
      }
      return next;
    });
  }, []);

  /* ── Replace (not merge) a single decoded packet into locoMap ──
     Used when clicking a log packet so the table shows EXACTLY that
     packet instead of a previously accumulated packet at index 0.   */
  const replaceInLocoMap = useCallback((normalized) => {
    setLocoMap(prev => {
      const next = { ...prev };
      for (const r of normalized) {
        const key   = getLocoKey(r);
        const label = getLocoLabel(r);
        // Overwrite the packet list with just this result
        next[key] = { label, packets: [r] };
      }
      return next;
    });
  }, []);

  const decode = useCallback(async () => {
    const packets = parseInput(input);
    if (!packets) { setStatus({t:"error",m:"Could not parse input — check JSON format."}); return; }
    setLoading(true); setStatus(null);
    try {
      const res = await fetch("http://localhost:8000/decode", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({packets}), signal:AbortSignal.timeout(8000),
      });
      const d = await res.json();
      if (d.success && d.results) {
        const normalized = d.results.map(normalizeResult);
        setResults(normalized); setActiveIdx(0); setActiveTab("decode");
        mergeIntoLocoMap(normalized);
        const firstKey = getLocoKey(normalized[0]);
        setSelectedLocoKey(firstKey);
        setStatus({t:"ok",m:`${d.results.length} packet(s) decoded via backend`});
        setBackendOk(true); setInputOpen(false); setLoading(false); return;
      }
      // Backend responded but returned an error
      setStatus({t:"error",m:`Backend error: ${d.error||"Unknown error from server"}`});
      setBackendOk(true);
    } catch(err) {
      setBackendOk(false);
      /* ── JS fallback: decode in browser when backend is offline ── */
      try {
        const packets = parseInput(input);
        if (packets && packets.length > 0) {
          const jsResults = packets.map((pkt, i) => decodePacketJS(pkt, i));
          setResults(jsResults);
          setActiveIdx(0);
          setActiveTab("decode");
          mergeIntoLocoMap(jsResults);
          const firstKey = getLocoKey(jsResults[0]);
          setSelectedLocoKey(firstKey);
          setStatus({t:"warn",m:`${jsResults.length} packet(s) decoded (JS fallback — backend offline)`});
          setLoading(false);
          return;
        }
      } catch(jsErr) { /* fall through to error */ }
      setStatus({t:"error",m:"Backend offline — start the Python server (uvicorn / flask) on port 8000 to decode packets."});
    }
    setLoading(false);
  }, [input]);

  const loadFile = useCallback(file => {
    const r = new FileReader();
    r.onload = e => { setInput(e.target.result); setStatus({t:"info",m:`Loaded: ${file.name}`}); setInputOpen(true); };
    r.readAsText(file);
  }, []);

  /** Parse MIT log text → array of individual radio packet objects.
   *
   * ─── Supported line formats (confirmed from real log files) ───────────────
   *
   *  RX (new):   "[RX] HEX: [MS_MIDNIGHT:17300334] : F1 A5 C3 …"
   *  TX (new):   "TX HEX: [MS_MIDNIGHT:17301579] : F1 A5 C3 …"
   *  RX (legacy):"[RX] RX HEX: F1 A5 C3 …"
   *  TX (legacy):"Hex: F1 A5 C3 …"
   *
   * ─── Multi-packet lines ───────────────────────────────────────────────────
   *  One HEX line can contain multiple concatenated 32-byte packets.
   *  e.g. "[RX] HEX: [MS_MIDNIGHT:17281555] : F1 A5 C3 … F1 A5 C3 … F1 A5 C3 …"
   *       Bytes: 192 = 6 packets × 32 bytes
   *  Strategy: after stripping the radio framing prefix (F1 A5 C3),
   *  split the remaining hex on every occurrence of "F1A5C3" to extract
   *  each individual packet.
   *
   * ─── Radio framing bytes ─────────────────────────────────────────────────
   *  Every packet starts with 3 framing bytes:  F1  A5  C3
   *  These are the radio layer header — NOT part of the KAVACH payload.
   *  The actual KAVACH packet starts at byte 4 (offset 6 hex chars).
   *
   * ─── Meta / CRC info ─────────────────────────────────────────────────────
   *  The line immediately after the HEX line carries packet count, CRC result
   *  and TIMESTAMP. We parse this for the log stats badge and CRC colour.
   *  CRC is also independently verified by the JS CRC engine for every packet.
   */
  function parseMitLog(text) {
    const packets = [];

    // ── Regexes ──────────────────────────────────────────────────────────────

    // Matches both new and legacy HEX lines.
    // Group 1: MS_MIDNIGHT timestamp (may be absent for legacy)
    // Group 2: raw hex bytes (space-separated)
    const hexLineRe = /^(?:TX\s+HEX:|(?:\[RX\]\s+HEX:))\s+(?:\[MS_MIDNIGHT:(\d+)\]\s*:\s*)?((?:[0-9A-Fa-f]{2}\s*)+)/;
    // Legacy fallback — "[RX] RX HEX:" or "Hex:"
    const hexLineLegacyRe = /^(?:\[RX\]\s+RX\s+HEX:|Hex:)\s+((?:[0-9A-Fa-f]{2}\s*)+)/;

    // Direction from line start
    const directionOf = (line) => (line.startsWith('[RX]') ? 'RX' : 'TX');

    // Meta line: "[RX] Number of packets received: … CRC: VALID/INVALID (…) …"
    //         or "TX PKTS: … CRC: VALID/INVALID (…) …"
    const metaRe = /(?:TX PKTS|Number of packets received).*?Type:\s*(\w+).*?CRC:\s*(VALID|INVALID)\s*\(Recv:(0x[0-9A-Fa-f]+),\s*Calc:(0x[0-9A-Fa-f]+)\).*?TIMESTAMP\(us\):\s*(\d+)/;

    // TDMA frame/slot context
    const tdmaRe = /\[TDMA_(?:TX|RX)\]\s+FRAME=(\d+)\s+SLOT=(\d+)/;

    // ── Event Log Viewer format ──────────────────────────────────────────────
    //  Timestamp   : 12-08-26 12:33:48.095
    //  Event ID    : 0x03
    //  Event Name  : Station Registration Packet
    //  Event Count : 1
    //  Data        : F1 A5 C3 90 7D 61 52 04 16 80 C7 FC 00 00 00 00 …
    // The Data field is already the extracted radio payload (F1 A5 C3 framing
    // header followed by the KAVACH packet bytes, trailing FCS stripped) —
    // same shape as the HEX lines above, so it reuses splitPackets()/CRC logic.
    const eventTsRe    = /^Timestamp\s*:\s*(.+?)\s*$/;
    const eventIdRe    = /^Event ID\s*:\s*(0x[0-9A-Fa-f]+)/i;
    const eventNameRe  = /^Event Name\s*:\s*(.+?)\s*$/;
    const eventCountRe = /^Event Count\s*:\s*(\d+)/;
    const eventDataRe  = /^Data\s*:\s*((?:[0-9A-Fa-f]{2}\s*)+)/;

    // ── Radio framing constant ──
    // Every packet is prefixed by F1 A5 C3 (3 bytes = 6 hex chars).
    // This is the radio layer header; strip it to get the pure KAVACH payload.
    const FRAME_HDR = 'F1A5C3';
    const PKT_SIZE_BYTES = 32; // fallback size only — used when the real length can't be determined

    // ── PKT_LENGTH field width (bits) per KAVACH packet type ──────────────────
    // RDSO/SPN/196/2020 Annexure-C: the length field immediately follows the
    // 4-bit PKT_TYPE. Station→Onboard Regular packets (0b1001) carry a 10-bit
    // length because they can include variable-length sub-packets (Movement
    // Authority, Speed Profile, etc.) and are frequently LONGER than the other
    // packet types; every other supported type uses a 7-bit length field.
    // Declared "Packet Length" value v  →  total KAVACH-payload bytes = v + 1.
    const LEN_FIELD_BITS = { 9: 10, 10: 7, 11: 7, 12: 7, 13: 7 };

    // ── Helper: compute the TRUE total hex length (in hex chars, including the
    // 3-byte F1A5C3 framing) of the packet starting at index `idx` in `upperHex`,
    // by reading its own PKT_LENGTH field instead of assuming every packet is a
    // fixed 32 bytes. A fixed-size assumption truncates longer packet types
    // (e.g. Station→Onboard Regular is often 32+ bytes) and cuts into the
    // trailing PKT_CRC field, which is exactly why CRC verification was failing
    // for every Station→Onboard (S2L) packet while Onboard→Station (L2S) —
    // which happens to always be 29 bytes — passed. ────────────────────────────
    const packetHexLenAt = (upperHex, idx) => {
      const FALLBACK = PKT_SIZE_BYTES * 2; // 64 hex chars = old fixed 32-byte behaviour
      const headerHexNeeded = 6 + 8; // 3 framing bytes + up to 4 KAVACH payload bytes (covers 4+10 bit header)
      if (idx + headerHexNeeded > upperHex.length) return FALLBACK;
      let bits;
      try { bits = hexToBits(upperHex.slice(idx + 6, idx + headerHexNeeded)); } catch (_) { return FALLBACK; }
      const pktType = b2i(bits.slice(0, 4));
      const lenBits = LEN_FIELD_BITS[pktType];
      if (!lenBits) return FALLBACK; // unrecognized type — keep old safe default
      const totalKavachBytes = b2i(bits.slice(4, 4 + lenBits)) + 1;
      if (totalKavachBytes < 5 || totalKavachBytes > 250) return FALLBACK; // sanity guard vs corrupt data
      return (3 + totalKavachBytes) * 2; // + 3-byte framing, in hex chars
    };

    // ── Helper: split a concatenated hex string into individual packets ──
    // Packets are separated by the framing header "F1A5C3"; each packet's own
    // PKT_LENGTH field determines exactly where it ends.
    const splitPackets = (hexStr) => {
      const upper = hexStr.toUpperCase();
      const results = [];
      let pos = 0;
      while (pos < upper.length) {
        // Find next F1A5C3 framing boundary at or after pos
        const idx = upper.indexOf(FRAME_HDR, pos);
        if (idx === -1) break;
        // Determine THIS packet's true length from its own PKT_LENGTH field
        const hexLen = packetHexLenAt(upper, idx);
        const end = idx + hexLen;
        if (end > upper.length) {
          // Partial/truncated packet — take what's available
          results.push(upper.slice(idx));
          break;
        }
        results.push(upper.slice(idx, end));
        pos = end;
      }
      return results;
    };

    // ── Parse lines ──────────────────────────────────────────────────────────
    const lines = text.split(/\r?\n|\r/);
    let lastTdma = null;
    let pendingEvent = null; // accumulates Timestamp/Event ID/Event Name/Event Count until the Data line
    let total = 0, valid = 0, invalid = 0;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];

      // Track TDMA frame/slot context
      const tm = l.match(tdmaRe);
      if (tm) { lastTdma = { frame: tm[1], slot: tm[2] }; continue; }

      // ── Event Log Viewer metadata lines ── (order: Timestamp → Event ID → Event Name → Event Count → Data)
      const etm = l.match(eventTsRe);
      if (etm) { pendingEvent = { ...(pendingEvent || {}), ts: etm[1].trim() }; continue; }
      const eim = l.match(eventIdRe);
      if (eim) { pendingEvent = { ...(pendingEvent || {}), eventId: eim[1] }; continue; }
      const enm = l.match(eventNameRe);
      if (enm) { pendingEvent = { ...(pendingEvent || {}), eventName: enm[1].trim() }; continue; }
      const ecm = l.match(eventCountRe);
      if (ecm) { pendingEvent = { ...(pendingEvent || {}), eventCount: ecm[1] }; continue; }

      // ── Event Log Viewer "Data" line — build packet(s) from the already-extracted payload ──
      const edm = l.match(eventDataRe);
      if (edm) {
        const evFullHex = edm[1].replace(/\s+/g, '').toUpperCase();
        if (evFullHex.length >= 8) {
          const evRawPackets = splitPackets(evFullHex);
          const evPackets = evRawPackets.length ? evRawPackets : [evFullHex];
          evPackets.forEach((pktHex, subIdx) => {
            // pktHex starts with F1A5C3 — strip the 3-byte radio framing header
            const kavachPayload = pktHex.length > 6 ? pktHex.slice(6) : pktHex;
            const activeRadio   = '0x' + pktHex.slice(0, 2).toUpperCase();

            const crcResult = verifyPacketCRC(kavachPayload);
            const crcValid  = crcResult.error ? null : crcResult.match;

            if (crcValid === true)  valid++;
            if (crcValid === false) invalid++;
            total++;

            packets.push({
              idx:         packets.length,
              hex:         kavachPayload,
              rawHex:      pktHex,
              activeRadio,
              direction:   'RX',                              // Event Log Viewer only logs received events
              pktType:     pendingEvent?.eventName || 'UNKNOWN',
              crcValid,
              crcRecv:     crcResult.stored_hex   || null,
              crcCalc:     crcResult.computed_hex || null,
              ts:          subIdx === 0 ? (pendingEvent?.ts || null) : null,
              eventId:     pendingEvent?.eventId    || null,
              eventName:   pendingEvent?.eventName  || null,
              eventCount:  pendingEvent?.eventCount || null,
              tdmaFrame:   lastTdma?.frame,
              tdmaSlot:    lastTdma?.slot,
              multiPkt:    evPackets.length > 1,
              subIdx,
            });
          });
        }
        pendingEvent = null;
        continue;
      }

      // Try to match a HEX line (new format first, then legacy)
      let hm = l.match(hexLineRe) || l.match(hexLineLegacyRe);
      if (!hm) continue;

      // Extract fields
      // new format: hm[1]=MS_MIDNIGHT, hm[2]=hex bytes
      // legacy format: hm[1]=hex bytes (no MS_MIDNIGHT group)
      let msTs   = null;
      let rawHex = '';
      if (l.match(hexLineRe)) {
        msTs   = hm[1] || null;   // MS_MIDNIGHT timestamp (may be undefined)
        rawHex = hm[2] || '';
      } else {
        rawHex = hm[1] || '';     // legacy: group 1 is hex bytes directly
      }
      const fullHex = rawHex.replace(/\s+/g, '').toUpperCase();
      if (fullHex.length < 8) continue; // too short to be a real packet

      const direction = directionOf(l);

      // Look for meta/CRC line within ±2 lines
      let mm = null;
      for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
        if (j === i) continue;
        const m = lines[j].match(metaRe);
        if (m) { mm = m; break; }
      }
      const pktType = mm ? mm[1] : 'UNKNOWN';
      const crcRecvMeta = mm ? mm[3] : null;
      const crcCalcMeta = mm ? mm[4] : null;
      const tsMeta      = mm ? mm[5] : null;
      // Prefer MS_MIDNIGHT from the hex line itself; fall back to meta TIMESTAMP
      const ts = msTs || tsMeta;

      // ── Split concatenated multi-packet lines ──
      const rawPackets = splitPackets(fullHex);
      if (rawPackets.length === 0) continue;

      rawPackets.forEach((pktHex, subIdx) => {
        // pktHex starts with F1A5C3 — strip the 3-byte radio framing header
        const kavachPayload = pktHex.length > 6 ? pktHex.slice(6) : pktHex;
        const activeRadio   = '0x' + pktHex.slice(0, 2).toUpperCase();

        // JS CRC verification on the KAVACH payload
        const crcResult = verifyPacketCRC(kavachPayload);
        // For single packets, also cross-check against meta CRC if available
        const crcValid = crcResult.error ? null : crcResult.match;

        if (crcValid === true)  valid++;
        if (crcValid === false) invalid++;
        total++;

        packets.push({
          idx:         packets.length,
          hex:         kavachPayload,     // KAVACH packet bytes (no radio framing)
          rawHex:      pktHex,            // full 32-byte hex including F1 A5 C3 header
          activeRadio,
          direction,                      // 'TX' | 'RX'
          pktType,
          crcValid,
          // For the first sub-packet of a single-packet line, keep meta CRC for display
          crcRecv:     (rawPackets.length === 1 && subIdx === 0) ? crcRecvMeta : crcResult.stored_hex  || null,
          crcCalc:     (rawPackets.length === 1 && subIdx === 0) ? crcCalcMeta : crcResult.computed_hex || null,
          ts:          subIdx === 0 ? ts : null,  // timestamp only on first sub-packet
          tdmaFrame:   lastTdma?.frame,
          tdmaSlot:    lastTdma?.slot,
          multiPkt:    rawPackets.length > 1,     // flag: came from a concatenated line
          subIdx,                                  // position within multi-packet line
        });
      });
    }

    return { packets, stats: { total, valid, invalid } };
  }

  const loadLogFile = useCallback(file => {
    const r = new FileReader();
    r.onload = e => {
      const { packets, stats } = parseMitLog(e.target.result);
      const newFile = { id: Date.now() + Math.random(), name: file.name, stats, packets, collapsed: false };
      setLogFiles(prev => {
        const exists = prev.findIndex(f => f.name === file.name);
        if (exists >= 0) { const next = [...prev]; next[exists] = newFile; return next; }
        return [...prev, newFile];
      });
      setStatus({t:"info", m:`Log loaded: ${file.name} — ${stats.total} packet(s) found`});
    };
    r.readAsText(file);
  }, []);

  /** Decode every packet in the given log file(s) and export the results to
   *  an Excel workbook — one sheet per packet, correctly named from the
   *  Event Name (Event Log Viewer format) or packet type (MIT hex format).
   *  Tries the Python backend first (accurate + fast for large logs), then
   *  falls back to the in-browser JS decoder if the backend is offline.  */
  const exportLogFilesXlsx = useCallback(async (files) => {
    const flat = [];
    files.forEach(lf => lf.packets.forEach(pkt => flat.push({ pkt, fileName: lf.name })));
    if (flat.length === 0) { setStatus({t:"warn", m:"No packets loaded to export."}); return; }
    if (exportingLog) return;

    setExportingLog(true);
    setStatus({t:"info", m:`Decoding ${flat.length} packet(s) for export…`});
    const reqPkts = flat.map(({ pkt }) => ({ activeRadio: pkt.activeRadio, messagePayload: pkt.hex }));

    let normalized = null;
    try {
      const res = await fetch("http://localhost:8000/decode", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ packets: reqPkts }), signal: AbortSignal.timeout(30000),
      });
      const d = await res.json();
      if (d.success && d.results) normalized = d.results.map(normalizeResult);
      else throw new Error(d.error || "backend returned an error");
      setBackendOk(true);
    } catch (e) {
      setBackendOk(false);
      try {
        normalized = reqPkts.map((p, i) => decodePacketJS(p, i));
      } catch (jsErr) {
        setStatus({t:"error", m:"Export failed — could not decode packets."});
        setExportingLog(false);
        return;
      }
    }

    const entries = flat.map(({ pkt, fileName }, i) => ({ pkt, fileName, result: normalized[i] }));
    try {
      await exportLogPacketsToExcel(entries);
      setStatus({t:"ok", m:`Exported ${entries.length} packet(s) to Excel${normalized[0]?._source==="js" ? " (JS fallback)" : ""}.`});
    } catch (e) {
      setStatus({t:"error", m:`Excel export failed: ${e.message||e}`});
    } finally {
      setExportingLog(false);
    }
  }, [exportingLog]);

  // ── Active loco selection: show last packet for selected loco
  const locoEntries = Object.entries(locoMap); // [ [key, {label, packets}] ]
  const selectedLoco = selectedLocoKey ? locoMap[selectedLocoKey] : null;
  // For display/tabs: use all packets of selected loco (or fall back to all results)
  const activeLocoPackets = selectedLoco ? selectedLoco.packets : results;
  const activeResult = activeLocoPackets[activeIdx] ?? activeLocoPackets[0];
  const hasSidebar = locoEntries.length > 1;

  // Status colors
  const statusStyle = !status ? {} : {
    bg:   {ok:"var(--green)", warn:"var(--amber)", error:"var(--red)", info:"var(--cyan)"}[status.t],
    text: {
      ok:   isLight ? "#065f46" : "#6ee7b7",
      warn: isLight ? "#78350f" : "#fde68a",
      error:isLight ? "#7f1d1d" : "#fca5a5",
      info: isLight ? "#0c4a6e" : "#a5f3fc",
    }[status.t],
    border: {
      ok:   isLight ? "#6ee7b7" : "#10b98133",
      warn: isLight ? "#fcd34d" : "#f59e0b33",
      error:isLight ? "#fca5a5" : "#ef444433",
      info: isLight ? "#7dd3fc" : "#06b6d433",
    }[status.t],
    bg2: {
      ok:   isLight ? "#ecfdf5" : "#10b98110",
      warn: isLight ? "#fffbeb" : "#f59e0b10",
      error:isLight ? "#fef2f2" : "#ef444410",
      info: isLight ? "#eff6ff" : "#06b6d410",
    }[status.t],
  };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      {/* Old full-page train canvas + scan line — hidden while the PINJ home
          scene is showing (it has its own animated scene); still used behind
          the other pages. */}
      {activeTab === "live" ? (
        /* 📡 LIVE: a plain, still background (theme colour) — no moving train behind the packet list */
        <div aria-hidden="true" style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none", background:"var(--bg-base)" }} />
      ) : (activeTab === "svksim" || results.length > 0) ? <>
        <TrainSceneBackground isLight={isLight} />
        <div className="scan-line" />
      </> : (
        /* The page body is transparent and the top bar is only ~85 % opaque,
           so with the canvas hidden the white page showed through and the
           header looked grey / dim. This plain backdrop is the same dark sky
           the canvas paints. Needed in BOTH themes: the home page always shows
           the night picture and the top bar is dark navy in light mode too —
           without it the light theme's top bar turned grey again. */
        <div aria-hidden="true" style={{
          position:"fixed", inset:0, zIndex:0, pointerEvents:"none",
          background:"linear-gradient(180deg,#020208 0%,#03040b 40%,#06081a 100%)",
        }} />
      )}

      <div style={{
        display:"grid",
        gridTemplateRows: inputOpen && activeTab !== "live" && activeTab !== "svksim" ? "52px 1fr 220px" : "52px 1fr",
        gridTemplateColumns: "1fr",
        height:"100vh", width:"100vw", overflow:"hidden",
        transition:"grid-template-rows 0.3s ease",
        position:"relative", zIndex:1,
      }}>
        {dialog === "settings" && (
          <SettingsDialog onClose={() => setDialog(null)} isLight={isLight} setIsLight={setIsLight}
            initialTab={activeTab === "live" ? "live" : activeTab === "svksim" ? "svksim" : results.length ? "decoder" : "general"} />
        )}
        {dialog === "about" && (
          <AboutDialog onClose={() => setDialog(null)} page={activeTab} packetTypes={PKT_META} isLight={isLight}
            session={{ decoded: results.length, logFiles: logFiles.length, logPackets: logFiles.reduce((n, f) => n + f.packets.length, 0) }} />
        )}

        {/* ══ TOP BAR — KAVACH RAILWAY COMMAND CENTRE ══════════════ */}
        <div className="kv-topbar" style={{ gridColumn:1, display:"flex", alignItems:"center", gap:10, padding:"0 14px", zIndex:10, height:52 }}>

          {/* ── Company brand: NOVA (cube mark + wordmark) ──
              Images live in frontend/public/ (served from the site root).
              The header bar is dark navy in the dark theme and white in the
              light theme, so the wordmark switches: light letters on dark
              (nova-text-dark.png), navy letters on light (nova-text-light.png). */}
          {/* Shown as a plain company LOGO — no card, no tagline — at the
              full height of the header, then a thin divider before the app's
              own PINJ title card. */}
          <div className="kv-nova-logo" title="NOVA — Engineering Safety · Powering Innovation">
            <span className="kv-nova-logo-markwrap">
              <img src="/nova-mark.png" alt="" draggable={false} className="kv-nova-logo-mark" />
            </span>
            <span className="kv-nova-logo-wordwrap">
              <img src={isLight ? "/nova-text-light.png" : "/nova-text-dark.png"} alt="NOVA" draggable={false} className="kv-nova-logo-word" />
              <span className="kv-nova-logo-shine" aria-hidden="true" />
            </span>
          </div>
          <div className="kv-nova-divider" aria-hidden="true" />

          {/* ── PINJ product card — same card, same two-line type system as
              the NOVA card (see .kv-hdr-title / .kv-hdr-sub). ── */}
          <div className="kv-nova-box" style={{ marginRight:4, gap:6 }}>
            <div className="kv-hdr-train"><TrainLogoWithSmoke /></div>
            <div>
              <div className="kv-hdr-title"><span className="kv-hdr-accent">PINJ</span> — KAVACH PACKET INJECTOR &amp; DECODER</div>
              <div className="kv-hdr-sub">RDSO/SPN/196/2020 · ANNEXURE-C · v4.0 · INDIAN RAILWAYS</div>
            </div>
          </div>

          {/* ── PKT type pills ── */}
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            {Object.entries(PKT_META).map(([k,m]) => {
              const c = isLight ? m.lightColor : m.color;
              return (
                <div key={k} className="kv-pkt-pill" style={{
                  border:`1px solid ${c}55`, background:`linear-gradient(135deg,${c}1e,${c}0a)`,
                  color:c, padding:"3px 9px", borderRadius:7, fontSize:9,
                  fontFamily:"var(--font-mono)", fontWeight:700, letterSpacing:"0.05em",
                  boxShadow:`0 0 8px ${c}18, inset 0 1px 0 rgba(255,255,255,0.05)`,
                  display:"flex", alignItems:"center", gap:3,
                  textShadow:`0 0 8px ${c}66`,
                }}>
                  {m.icon && <span style={{fontSize:8,filter:`drop-shadow(0 0 3px ${c}88)`}}>{m.icon}</span>}{m.short}
                </div>
              );
            })}
          </div>

          {/* ── Status ── */}
          {status && (
            <div className="kv-status" style={{
              marginLeft:"auto", padding:"4px 13px", borderRadius:20,
              fontSize:11, fontFamily:"var(--font-mono)",
              background:statusStyle.bg2, color:statusStyle.text,
              border:`1px solid ${statusStyle.border}`,
              maxWidth:360, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
              boxShadow:`0 0 10px ${statusStyle.border}44`,
              display:"flex", alignItems:"center", gap:6,
            }}>
              <span style={{fontSize:8}}>{status.t==="ok"?"●":status.t==="error"?"●":status.t==="warn"?"▲":"ℹ"}</span>
              {status.m}
            </div>
          )}

          {/* ── Backend indicator ── */}
          <div style={{
            display:"flex", alignItems:"center", gap:5,
            fontSize:9, fontFamily:"var(--font-mono)", letterSpacing:"0.06em",
            borderLeft:`1px solid rgba(245,166,35,0.08)`,
            paddingLeft:12, marginLeft: status ? 0 : "auto",
          }}>
            <div style={{position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <div style={{
                width:7, height:7, borderRadius:"50%", flexShrink:0, position:"relative", zIndex:1,
                background: backendOk===true?"var(--green)":backendOk===false?"var(--red)":"var(--amber)",
                boxShadow: backendOk===true
                  ?"0 0 10px var(--green), 0 0 4px var(--green)"
                  :backendOk===false
                  ?"0 0 10px var(--red), 0 0 4px var(--red)"
                  :"0 0 10px var(--amber), 0 0 4px var(--amber)",
                animation: backendOk===true
                  ?"cin-glow-green 2s ease-in-out infinite"
                  :backendOk===false
                  ?"cin-glow-red 1.2s ease-in-out infinite"
                  :"pulse-amber 1s ease-in-out infinite",
              }}/>
              {/* pulse ring */}
              <div style={{
                position:"absolute", width:14, height:14, borderRadius:"50%",
                border:`1px solid ${backendOk===true?"var(--green)":backendOk===false?"var(--red)":"var(--amber)"}`,
                animation:"cin-pulse-ring 2s ease-out infinite",
                opacity:0.6,
              }}/>
            </div>
            <span style={{
              color: backendOk===true?"var(--green)":backendOk===false?"var(--red)":"var(--amber)",
              textShadow: backendOk===true?"0 0 8px rgba(0,230,118,0.5)":backendOk===false?"0 0 8px rgba(255,23,68,0.5)":"0 0 8px rgba(245,166,35,0.5)",
              fontWeight:700,
            }}>
              {backendOk===true?"BACKEND":backendOk===false?"OFFLINE":"CHECKING"}
            </span>
          </div>

          {/* ── Buttons ── */}
          <div style={{ display:"flex", gap:6, alignItems:"center", marginLeft:8 }}>
            <ThemeToggle isLight={isLight} onToggle={() => setIsLight(l => !l)} />

            <button onClick={() => setActiveTab(t => t==="live"?"decode":"live")}
              className={`kv-btn kv-btn-live${activeTab==="live"?" active":""}`}>
              <span style={{
                width:6,height:6,borderRadius:"50%",flexShrink:0,
                background: activeTab==="live"?"#fff":"#ef4444",
                animation: activeTab==="live"?"pulse-amber 0.8s infinite":"signal-red 1.5s infinite",
                boxShadow:"0 0 5px currentColor",
              }}/>
              {activeTab==="live"?"● LIVE":"📡 LIVE"}
            </button>

            <button onClick={() => setActiveTab(t => t==="svksim"?"decode":"svksim")}
              className={`kv-btn kv-btn-sim${activeTab==="svksim"?" active":""}`}>
              🧩 SVK SIM
            </button>

            {activeTab!=="live" && activeTab!=="svksim" && (
              <button onClick={() => setInputOpen(o => !o)} className="kv-btn kv-btn-ghost">
                {inputOpen?"▲ HIDE":"▼ INPUT"}
              </button>
            )}

            {activeTab!=="live" && activeTab!=="svksim" && (
              <button onClick={decode} disabled={loading||!input.trim()} className="kv-btn kv-btn-decode">
                {loading
                  ? <><span style={{animation:"pulse-amber 0.6s infinite",display:"inline-block"}}>⚙</span> DECODING…</>
                  : "⚡ DECODE"}
              </button>
            )}

            {results.length>0 && activeTab!=="live" && activeTab!=="svksim" && (
              <button
                onClick={() => logFiles.length>0 ? (!exportingLog && exportLogFilesXlsx(logFiles)) : exportToExcel(results)}
                className="kv-btn kv-btn-xlsx"
                title={logFiles.length>0 ? "Decode & export EVERY loaded log packet (one sheet each)" : "Export the currently decoded packet(s)"}
              >
                {logFiles.length>0
                  ? (exportingLog ? "⏳ EXPORTING…" : `⬇ XLSX (ALL ${logFiles.reduce((n,f)=>n+f.packets.length,0)} LOG PKTS)`)
                  : "⬇ XLSX"}
              </button>
            )}

            {/* ⚙ app menu — always the last item of the bar: Settings · Theme · About */}
            <AppMenu isLight={isLight} setIsLight={setIsLight} backendOk={backendOk}
              onSettings={() => setDialog("settings")} onAbout={() => setDialog("about")} />
          </div>
        </div>

        {/* ══ MAIN CONTENT ══════════════════════════════════════════ */}
        <div style={{
          gridRow:2, gridColumn:1,
          overflow:"hidden", display:"flex", flexDirection:"column",
          background:"var(--panel-bg)",
          position:"relative",
        }}>
          {/* subtle vignette overlay */}
          <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:0,
            background:"radial-gradient(ellipse at 50% 0%,rgba(245,166,35,0.025) 0%,transparent 55%)",
          }}/>
          {/* ══ LIVE tab — always accessible directly from top bar ══ */}

          {/* SvkSim is ALWAYS mounted so TX state survives tab switches.
              We just show/hide it with CSS display so the component never
              unmounts and loses its in-progress transmission. */}
          <div style={{ display: activeTab === "svksim" ? "flex" : "none",
                        flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}>
            <SvkSim isLight={isLight} />
          </div>

          {/* LiveTab is ALWAYS mounted too: its packet list, the DMI session data
              (tag read status, direction, retained key packets) and the LIVE feed
              connection survive page switches — the backend only re-sends its last
              50 packets on reconnect, which is not enough to rebuild the DMI. */}
          <div style={{ display: activeTab === "live" ? "flex" : "none",
                        flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}>
            <LiveTab isLight={isLight} />
          </div>

          {activeTab === "live" || activeTab === "svksim" ? null : results.length === 0 ? (
            /* Main page with nothing decoded yet → the PINJ home scene
               (inject → packet core → decode, over the railway). */
            <PinjHomeScene
              still={!appSettings.homeAnimation}
              onSampleC46={() => { setInput(SAMPLE); setInputOpen(true); setStatus({t:"info",m:"Sample C.4.6 loaded"}); }}
              onSampleC42={() => { setInput(SAMPLE_C42); setInputOpen(true); setStatus({t:"info",m:"Sample C.4.2 profile packet loaded"}); }}
            />
          ) : (
            <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>

              {/* ══ TAB BAR — KAVACH RAILWAY NAVIGATION ══ */}
              <div className="kv-tabbar" style={{ display:"flex", alignItems:"stretch", flexShrink:0 }}>
                {[
                  {id:"decode",  label:"DECODED PKTS", icon:"⚡"},
                  {id:"stats",   label:"STATS",         icon:"📊"},
                  {id:"diff",    label:"DIFF",           icon:"⇄"},
                  {id:"profile", label:"PROFILE",        icon:"🗺"},
                ].map(t => (
                  <button key={t.id} className={`kv-tab${activeTab===t.id?" active":""}`} onClick={()=>setActiveTab(t.id)}>
                    <span>{t.icon}</span><span>{t.label}</span>
                  </button>
                ))}
                {activeTab==="decode" && activeResult && (
                  <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,padding:"4px 8px"}}>
                    <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                      <span style={{position:"absolute",left:8,fontSize:10,color:"var(--text-muted)",pointerEvents:"none"}}>🔍</span>
                      <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Search fields…"
                        style={{
                          paddingLeft:26,paddingRight:searchQuery?24:10,height:26,width:160,
                          background:"var(--bg-raised)",border:`1px solid var(--border)`,
                          borderRadius:20,color:"var(--text-primary)",fontSize:10,
                          fontFamily:"var(--font-mono)",outline:"none",transition:"border-color 0.15s,width 0.2s,box-shadow 0.15s",
                        }}
                        onFocus={e=>{e.target.style.borderColor="var(--amber)";e.target.style.width="210px";e.target.style.boxShadow="0 0 0 2px rgba(245,166,35,0.15)";}}
                        onBlur={e=>{e.target.style.borderColor="var(--border)";if(!searchQuery)e.target.style.width="160px";e.target.style.boxShadow="none";}}
                      />
                      {searchQuery && <button onClick={()=>setSearchQuery("")} style={{position:"absolute",right:8,background:"none",border:"none",color:"var(--amber)",cursor:"pointer",fontSize:12,lineHeight:1}}>×</button>}
                    </div>
                    {searchQuery && (
                      <span style={{fontSize:9,color:"var(--amber)",fontFamily:"var(--font-mono)",background:"rgba(245,166,35,0.1)",padding:"2px 7px",borderRadius:10,border:"1px solid rgba(245,166,35,0.25)"}}>
                        {(activeResult.fields||[]).filter(f=>!f._is_section&&(String(f.Field||"").toLowerCase().includes(searchQuery.toLowerCase())||String(f.Description||"").toLowerCase().includes(searchQuery.toLowerCase())||String(f["Decimal Value"]||"").toLowerCase().includes(searchQuery.toLowerCase()))).length} match
                      </span>
                    )}
                    <button onClick={()=>setShowTimeline(t=>!t)} style={{
                      padding:"3px 10px",borderRadius:20,fontSize:9,fontFamily:"var(--font-mono)",fontWeight:700,
                      border:`1px solid ${showTimeline?"var(--amber)":"var(--border)"}`,
                      background:showTimeline?"rgba(245,166,35,0.12)":"transparent",
                      color:showTimeline?"var(--amber)":"var(--text-muted)",cursor:"pointer",transition:"all 0.15s",
                      boxShadow:showTimeline?"0 0 8px rgba(245,166,35,0.25)":"none",
                    }}>⏱ TDMA</button>
                    <button onClick={()=>{
                      const rows=(activeResult.fields||[]).filter(f=>!f._is_section).map(f=>[f.Field,f["Size (bits)"],f["Raw Bits"],f["Decimal Value"],f.Description].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(","));
                      const csv="Field,Size (bits),Raw Bits,Value,Description\n"+rows.join("\n");
                      const a=document.createElement("a");a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);a.download=`kavach_pkt${activeResult.packet_index||1}.csv`;a.click();
                    }} style={{
                      padding:"3px 10px",borderRadius:20,fontSize:9,fontFamily:"var(--font-mono)",fontWeight:700,
                      border:"1px solid rgba(0,230,118,0.3)",background:"transparent",color:"var(--green)",cursor:"pointer",transition:"all 0.15s",
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(0,230,118,0.08)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}
                    >↓ CSV</button>
                  </div>
                )}
              </div>{/* ══ end TAB BAR ══ */}

              {/* ══ BODY ROW: [Loco Panel] + [Tab Content] ══ */}
              <div style={{display:"flex",flex:1,overflow:"hidden"}}>

                {/* ══ LOCO PANEL ══ */}
                {hasSidebar && (
                  <LocoPanel
                    locoEntries={locoEntries}
                    selectedLocoKey={selectedLocoKey}
                    onSelect={(key)=>{setSelectedLocoKey(key);setActiveIdx(0);setSelectedProfileIdx(0);}}
                    isLight={isLight}
                  />
                )}

                {/* ══ TAB CONTENT ══ */}
                <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

                  {/* DECODE */}
                  {activeTab==="decode" && activeResult && (
                    <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>
                      <div style={{padding:"10px 16px",borderBottom:`1px solid var(--divider)`,flexShrink:0,background:"var(--panel-bg)",position:"relative"}}>
                        <div style={{position:"absolute",top:0,left:0,right:0,height:"1px",background:"linear-gradient(90deg,transparent,rgba(245,166,35,0.12),rgba(0,229,255,0.08),rgba(245,166,35,0.12),transparent)"}}/>
                        <SummaryCard result={activeResult} isLight={isLight} />
                        <HexDisplay hex={activeResult.payload_hex} isLight={isLight} />
                      </div>
                      {showTimeline && <TDMATimeline result={activeResult} isLight={isLight} />}
                      <div ref={tableRef} style={{flex:1,overflowY:"auto",overflowX:"hidden"}}>
                        <FieldTable fields={activeResult.fields||[]} isLight={isLight} searchQuery={searchQuery} />
                      </div>
                      <div className="kv-footer">
                        <span style={{display:"flex",alignItems:"center",gap:4,color:"var(--text-muted)"}}>
                          <span style={{color:"var(--amber)",textShadow:"0 0 8px rgba(245,166,35,0.6)"}}>◈</span>
                          FIELDS: <span style={{color:"var(--amber)",fontWeight:700}}>{(activeResult.fields||[]).filter(f=>!f._is_section).length}</span>
                        </span>
                        <span className="kv-footer-sep">·</span>
                        <span style={{color:"var(--text-dim)"}}>BITS: <span style={{color:"var(--text-secondary)"}}>{activeResult.total_bits}</span></span>
                        <span className="kv-footer-sep">·</span>
                        <span style={{color:"var(--text-dim)"}}>RADIO: <span style={{color:"var(--cyan)",textShadow:"0 0 6px rgba(0,229,255,0.4)"}}>{activeResult.active_radio}</span></span>
                        {searchQuery && <><span className="kv-footer-sep">·</span><span style={{color:"var(--amber)",textShadow:"0 0 6px rgba(245,166,35,0.4)"}}>FILTER: "{searchQuery}"</span></>}
                        <span style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5,opacity:0.6}}>
                          <span style={{width:5,height:5,borderRadius:"50%",background:"var(--green)",boxShadow:"0 0 8px var(--green), 0 0 2px var(--green)",display:"inline-block",animation:"cin-glow-green 2s ease-in-out infinite"}}/>
                          RDSO/SPN/196/2020 ANNEXURE-C · INDIAN RAILWAYS
                        </span>
                      </div>
                    </div>
                  )}

                  {/* STATS */}
                  {activeTab==="stats" && (
                    <div style={{flex:1,overflowY:"auto",background:"var(--panel-bg)"}}>
                      <StatsPanel results={results} isLight={isLight} />
                    </div>
                  )}

                  {/* DIFF */}
                  {activeTab==="diff" && (
                    results.length >= 2
                      ? <DiffView results={results} isLight={isLight} />
                      : <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,
                          background:"radial-gradient(ellipse at 50% 50%,rgba(0,229,255,0.03) 0%,transparent 60%), linear-gradient(135deg,#060610,#04040a)"}}>
                          <span className="kv-diff-empty" style={{fontSize:52,filter:"drop-shadow(0 0 16px rgba(0,229,255,0.3))"}}>⇄</span>
                          <span style={{fontSize:13,color:"var(--text-secondary)",fontFamily:"var(--font-mono)",letterSpacing:"0.06em",textShadow:"0 0 10px rgba(0,229,255,0.15)"}}>Decode at least 2 packets to compare</span>
                          <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"var(--font-mono)",letterSpacing:"0.04em"}}>Use the input panel to decode multiple packets at once</span>
                        </div>
                  )}

                  {/* PROFILE */}
                  {activeTab==="profile" && (() => {
                    // Collect all C.4.2 packets for the selected loco
                    const c42Packets = activeLocoPackets.filter(p => p.packet_type_value === 9);
                    const hasProfiles = c42Packets.length > 0;
                    const clampedProfileIdx = Math.min(selectedProfileIdx, Math.max(0, c42Packets.length - 1));
                    const activeProfile = hasProfiles ? c42Packets[clampedProfileIdx] : (activeResult || null);

                    // Helper: extract a short label for each C.4.2 packet
                    const profileLabel = (pkt, i) => {
                      if (!pkt || !Array.isArray(pkt.fields)) return `Profile ${i+1}`;
                      const rfidF = pkt.fields.find(f => ["LAST_REF_RFID","LAST_REFERENCE_RFID","LAST_REF_RFID_TAG"].includes((f.Field||"").trim()));
                      const distF = pkt.fields.find(f => ["DIST_PKT_START","DIST_PKT_STRT","DISTANCE_PKT_START"].includes((f.Field||"").trim()));
                      const rfid  = rfidF ? Number(rfidF["Decimal Value"]) : null;
                      const dist  = distF ? Number(distF["Decimal Value"]) : null;
                      if (rfid && dist != null) return `RFID ${rfid} · +${dist}m`;
                      if (rfid) return `RFID ${rfid}`;
                      if (dist != null) return `+${dist}m`;
                      return `Profile ${i+1}`;
                    };

                    return (
                      <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>
                        {/* ── Sub-packet selector bar (only when >1 C.4.2 packet) ── */}
                        {c42Packets.length > 1 && (
                          <div style={{
                            flexShrink:0,
                            borderBottom:`1px solid var(--border)`,
                            background: isLight
                              ? "linear-gradient(180deg,#f8f8ff,#f0f0fa)"
                              : "linear-gradient(180deg,#0c0c18,#09090f)",
                            padding:"0 14px",
                            display:"flex",
                            alignItems:"stretch",
                            gap:0,
                            overflowX:"auto",
                          }}>
                            {/* Label */}
                            <div style={{
                              display:"flex", alignItems:"center", gap:6,
                              paddingRight:14, marginRight:4,
                              borderRight:`1px solid var(--border)`,
                              flexShrink:0,
                            }}>
                              <span style={{
                                fontSize:9, fontFamily:"var(--font-mono)", fontWeight:700,
                                letterSpacing:"0.1em", color:"var(--text-muted)",
                                textTransform:"uppercase",
                              }}>🗺 Profiles</span>
                              <span style={{
                                fontSize:9, fontFamily:"var(--font-mono)", fontWeight:700,
                                padding:"1px 6px", borderRadius:10,
                                background:"var(--amber-glow)", color:"var(--amber)",
                                border:"1px solid var(--amber)44",
                              }}>{c42Packets.length}</span>
                            </div>

                            {/* Profile tabs */}
                            {c42Packets.map((pkt, i) => {
                              const isAct = i === clampedProfileIdx;
                              return (
                                <button
                                  key={pkt.packet_index ?? i}
                                  onClick={() => setSelectedProfileIdx(i)}
                                  style={{
                                    position:"relative",
                                    padding:"8px 16px",
                                    border:"none", borderBottom: isAct
                                      ? "2px solid var(--cyan)"
                                      : "2px solid transparent",
                                    background:"none", cursor:"pointer",
                                    display:"flex", alignItems:"center", gap:7,
                                    flexShrink:0,
                                    transition:"all 0.16s ease",
                                  }}
                                >
                                  {/* Active glow overlay */}
                                  {isAct && (
                                    <div style={{
                                      position:"absolute", inset:0,
                                      background: isLight
                                        ? "rgba(6,182,212,0.07)"
                                        : "rgba(6,182,212,0.1)",
                                      pointerEvents:"none",
                                    }}/>
                                  )}

                                  {/* Index badge */}
                                  <div style={{
                                    width:18, height:18, borderRadius:"50%",
                                    background: isAct
                                      ? "var(--cyan)"
                                      : isLight ? "#d0d0e8" : "#1e1e30",
                                    color: isAct ? "#000" : "var(--text-muted)",
                                    fontSize:9, fontWeight:800,
                                    fontFamily:"var(--font-mono)",
                                    display:"flex", alignItems:"center", justifyContent:"center",
                                    flexShrink:0,
                                    transition:"all 0.16s ease",
                                    boxShadow: isAct ? "0 0 8px rgba(6,182,212,0.5)" : "none",
                                  }}>{i+1}</div>

                                  {/* Label text */}
                                  <span style={{
                                    fontSize:10, fontFamily:"var(--font-mono)",
                                    fontWeight: isAct ? 700 : 500,
                                    color: isAct
                                      ? isLight ? "#0284c7" : "var(--cyan)"
                                      : "var(--text-muted)",
                                    letterSpacing:"0.03em",
                                    whiteSpace:"nowrap",
                                    transition:"color 0.16s ease",
                                  }}>{profileLabel(pkt, i)}</span>

                                  {/* Packet index badge */}
                                  {pkt.packet_index != null && (
                                    <span style={{
                                      fontSize:8, fontFamily:"var(--font-mono)",
                                      padding:"1px 4px", borderRadius:3,
                                      background: isAct
                                        ? "rgba(6,182,212,0.15)"
                                        : isLight ? "#e8e8f0" : "#14141e",
                                      color: isAct ? "var(--cyan)" : "var(--text-dim)",
                                      border:`1px solid ${isAct ? "rgba(6,182,212,0.3)" : "transparent"}`,
                                      transition:"all 0.16s ease",
                                    }}>PKT#{pkt.packet_index}</span>
                                  )}
                                </button>
                              );
                            })}

                            {/* Spacer + info */}
                            <div style={{
                              marginLeft:"auto", display:"flex", alignItems:"center",
                              paddingLeft:14, flexShrink:0,
                              borderLeft:`1px solid var(--border)`,
                            }}>
                              <span style={{
                                fontSize:9, fontFamily:"var(--font-mono)",
                                color:"var(--text-dim)",
                                whiteSpace:"nowrap",
                              }}>
                                {clampedProfileIdx+1} / {c42Packets.length}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* ── Profile chart ── */}
                        <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
                          <ProfileVisualizer result={activeProfile} isLight={isLight} />
                        </div>
                      </div>
                    );
                  })()}

                </div>{/* end tab-content */}
              </div>{/* end body-row */}
            </div>
          )}
        </div>

        {/* ══ INPUT PANEL ══════════════════════════════════════════ */}
        {inputOpen && activeTab !== "live" && activeTab !== "svksim" && (
          <div className="kv-input-top" style={{
            gridColumn: 1,
            background:"var(--panel-bg)",
            display:"grid", gridTemplateColumns:`1fr ${crcPanelWidth}px`,
            overflow:"hidden", animation:"cin-slide-in-up 0.25s ease",
            position:"relative",
          }}>
            {/* ── LEFT: INPUT JSON ── */}
            <div style={{ display:"flex", flexDirection:"column", borderRight:`1px solid #12122a` }}>
              <div style={{
                padding:"6px 16px",
                background:"linear-gradient(90deg,rgba(245,166,35,0.09),rgba(245,166,35,0.03),transparent)",
                borderBottom:`1px solid #12122a`,
                display:"flex", alignItems:"center", gap:8,
                fontSize:9, fontFamily:"var(--font-mono)", letterSpacing:"0.08em",
                position:"relative", overflow:"hidden",
              }}>
                <div style={{position:"absolute",bottom:0,left:0,right:0,height:"1px",background:"linear-gradient(90deg,transparent,rgba(245,166,35,0.25),transparent)",animation:"cin-shimmer-bg 2s linear infinite",backgroundSize:"200% auto"}}/>
                <span style={{color:"var(--amber)",fontSize:11,textShadow:"0 0 8px rgba(245,166,35,0.6)"}}>▶</span>
                <span style={{color:"var(--text-secondary)",fontWeight:800,letterSpacing:"0.12em",textShadow:"0 0 8px rgba(245,166,35,0.2)"}}>INPUT JSON</span>
                <span style={{marginLeft:"auto",color:"var(--text-dim)",fontSize:8}}>
                  activeRadio + messagePayload · <span style={{color:"rgba(245,166,35,0.6)",fontWeight:700}}>Ctrl+Enter</span> to decode
                </span>
              </div>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if((e.ctrlKey||e.metaKey)&&e.key==="Enter") decode(); }}
                placeholder={`Paste JSON here…\n${SAMPLE}`}
                style={{
                  flex:1, padding:"10px 14px",
                  background:"var(--input-deep-bg)",
                  border:"none", outline:"none",
                  color:"var(--text-code)", fontFamily:"var(--font-mono)", fontSize:11,
                  resize:"none", lineHeight:1.7,
                  caretColor:"var(--amber)",
                }}
              />
            </div>

            {/* ── RESIZE HANDLE ── */}
            <div
              onMouseDown={e => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = crcPanelWidth;
                const onMove = mv => {
                  const delta = startX - mv.clientX;
                  setCrcPanelWidth(Math.max(200, Math.min(700, startW + delta)));
                };
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                  document.body.style.cursor = '';
                };
                document.body.style.cursor = 'col-resize';
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
              style={{
                position:"absolute", left:`calc(100% - ${crcPanelWidth}px)`, top:0, bottom:0,
                width:5, cursor:"col-resize", zIndex:20,
                background:"transparent",
                transition:"background 0.15s",
              }}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(245,166,35,0.25)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
              title="Drag to resize CRC panel"
            />

            {/* ── RIGHT: LOG / QUICK LOAD FOR CRC — KAVACH RAILWAY EDITION ── */}
            {(() => {
              const allStats = logFiles.reduce(
                (acc, f) => ({ total: acc.total + f.stats.total, valid: acc.valid + f.stats.valid, invalid: acc.invalid + f.stats.invalid }),
                { total: 0, valid: 0, invalid: 0 }
              );
              const hasFiles = logFiles.length > 0;

              /* ─── decode handler ────────────────────────────────────── */
              const handlePktClick = (pkt, fileId, pktIdx) => {
                setSelectedLog({ fileId, pktIdx });
                const json = JSON.stringify([{ activeRadio: pkt.activeRadio, messagePayload: pkt.hex }], null, 2);
                setInput(json);
                const pkts = [{ activeRadio: pkt.activeRadio, messagePayload: pkt.hex }];
                setLoading(true); setStatus(null);
                const rowEl = document.getElementById(`pkt-row-${fileId}-${pktIdx}`);
                if (rowEl) { rowEl.classList.remove('just-decoded'); void rowEl.offsetWidth; rowEl.classList.add('just-decoded'); }
                const syncCrc = (result) => {
                  if (result?.crc_check) {
                    const m = result.crc_check.match;
                    setLogFiles(prev => prev.map(f => f.id !== fileId ? f : {
                      ...f, packets: f.packets.map((p, i) => i === pktIdx ? { ...p, crcValid: m } : p)
                    }));
                  }
                };
                fetch("http://localhost:8000/decode", {
                  method:"POST", headers:{"Content-Type":"application/json"},
                  body: JSON.stringify({ packets: pkts }), signal: AbortSignal.timeout(8000),
                }).then(r => r.json()).then(d => {
                  if (d.success && d.results) {
                    const normalized = d.results.map(normalizeResult);
                    setResults(normalized); setActiveIdx(0); setActiveTab("decode");
                    replaceInLocoMap(normalized); setSelectedLocoKey(getLocoKey(normalized[0]));
                    setStatus({ t:"ok", m:"Packet decoded via backend" }); setBackendOk(true);
                    syncCrc(normalized[0]);
                  } else { setStatus({ t:"error", m:`Backend error: ${d.error||"Unknown"}` }); }
                  setLoading(false);
                }).catch(() => {
                  setBackendOk(false);
                  try {
                    const jsR = pkts.map((p, i) => decodePacketJS(p, i));
                    setResults(jsR); setActiveIdx(0); setActiveTab("decode");
                    replaceInLocoMap(jsR); setSelectedLocoKey(getLocoKey(jsR[0]));
                    setStatus({ t:"warn", m:"Packet decoded (JS fallback)" });
                    syncCrc(jsR[0]);
                  } catch(e) { setStatus({ t:"error", m:"Decode failed — backend offline" }); }
                  setLoading(false);
                });
              };

              return (
                <div style={{ display:"flex", flexDirection:"column", overflow:"hidden", minWidth:0, background:"var(--bg-base)" }}>

                  {/* ══ KAVACH PANEL HEADER ════════════════════════════ */}
                  <div style={{
                    padding:"5px 10px", flexShrink:0,
                    background:"var(--panel-bg-alt)",
                    borderBottom:"1px solid var(--border-bright)",
                    position:"relative", overflow:"hidden",
                  }}>
                    <div style={{
                      position:"absolute", bottom:0, left:0, right:0, height:"2px",
                      background:"repeating-linear-gradient(90deg,var(--amber) 0,var(--amber) 6px,transparent 6px,transparent 12px)",
                      opacity:0.4,
                    }}/>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div className={`sig-dot ${allStats.invalid>0?"fail":hasFiles?"pass":"unkn"}`}/>
                      <span style={{
                        fontFamily:"var(--font-mono)", fontSize:9, fontWeight:700,
                        color:"var(--amber)", letterSpacing:"0.12em",
                        lineHeight:1,
                      }} className="kavach-header-glow">LOG / CRC VERIFY</span>
                      {hasFiles && (
                        <span style={{ marginLeft:"auto", display:"flex", gap:4, alignItems:"center" }}>
                          <span style={{ fontSize:7, padding:"1px 5px", borderRadius:10, background:"rgba(0,230,118,0.12)", color:"var(--green)", border:"1px solid rgba(0,230,118,0.25)", fontFamily:"var(--font-mono)", fontWeight:700 }}>{allStats.valid}✓</span>
                          {allStats.invalid>0 && <span style={{ fontSize:7, padding:"1px 5px", borderRadius:10, background:"rgba(255,23,68,0.12)", color:"var(--red)", border:"1px solid rgba(255,23,68,0.25)", fontFamily:"var(--font-mono)", fontWeight:700 }}>{allStats.invalid}✗</span>}
                          <span style={{ fontSize:7, color:"var(--text-dim)", fontFamily:"var(--font-mono)", padding:"1px 4px", borderRadius:8, background:"rgba(255,255,255,0.04)", border:"1px solid var(--border)" }}>{allStats.total} pkts</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ══ EMPTY DROP ZONE ════════════════════════════════ */}
                  {!hasFiles && (
                    <div
                      onDragOver={e=>{e.preventDefault();setDragging(true);}}
                      onDragLeave={()=>setDragging(false)}
                      onDrop={e=>{e.preventDefault();setDragging(false);Array.from(e.dataTransfer.files).forEach(f=>loadLogFile(f));}}
                      onClick={()=>logRef.current.click()}
                      style={{
                        flex:1, margin:8, borderRadius:6, cursor:"pointer",
                        border:`1.5px dashed ${dragging?"var(--cyan)":"var(--border-bright)"}`,
                        background: dragging ? "rgba(0,229,255,0.04)" : "transparent",
                        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                        gap:6, transition:"all 0.2s", position:"relative", overflow:"hidden",
                      }}
                    >
                      <svg width="100%" height="20" style={{position:"absolute",bottom:8,left:0,opacity:0.12}} aria-hidden>
                        <line x1="0" y1="5"  x2="100%" y2="5"  stroke="var(--amber)" strokeWidth="2"/>
                        <line x1="0" y1="15" x2="100%" y2="15" stroke="var(--amber)" strokeWidth="2"/>
                        {[0,1,2,3,4,5,6,7,8,9].map(n=>(
                          <line key={n} x1={`${n*12}%`} y1="3" x2={`${n*12}%`} y2="17" stroke="var(--amber)" strokeWidth="1.5"/>
                        ))}
                      </svg>
                      <input ref={logRef} type="file" accept=".txt,.log,*" multiple style={{display:"none"}}
                        onChange={e=>{Array.from(e.target.files).forEach(f=>loadLogFile(f));e.target.value="";}}/>
                      <div style={{fontSize:22}}>🚂</div>
                      <div style={{color:"var(--text-secondary)",fontSize:10,fontFamily:"var(--font-mono)",fontWeight:700,letterSpacing:"0.08em"}}>DROP MIT LOG FILE(S)</div>
                      <div style={{color:"var(--text-dim)",fontSize:8,fontFamily:"var(--font-mono)"}}>TX · RX · multiple files · drag &amp; drop</div>
                    </div>
                  )}

                  {/* ══ MULTI-FILE TREE ════════════════════════════════ */}
                  {hasFiles && (
                    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
                      <input ref={logRef} type="file" accept=".txt,.log,*" multiple style={{display:"none"}}
                        onChange={e=>{Array.from(e.target.files).forEach(f=>loadLogFile(f));e.target.value="";}}/>

                      {/* scrollable tree area — also a drop target */}
                      <div
                        style={{flex:1,overflowY:"auto",overflowX:"hidden"}}
                        onDragOver={e=>{e.preventDefault();setDragging(true);}}
                        onDragLeave={()=>setDragging(false)}
                        onDrop={e=>{e.preventDefault();setDragging(false);Array.from(e.dataTransfer.files).forEach(f=>loadLogFile(f));}}
                      >
                        {logFiles.map((lf, fi) => {
                          const expanded  = !lf.collapsed;
                          const hasFail   = lf.stats.invalid > 0;

                          return (
                            <div key={lf.id} className="file-node-in" style={{animationDelay:`${fi*0.04}s`}}>

                              {/* ── File node header ── */}
                              <div className={`log-file-node${hasFail?" has-fail":""}`} style={{position:"relative"}}>
                                {/* animated gold left rail */}
                                <div style={{
                                  position:"absolute",left:0,top:0,bottom:0,width:3,
                                  background: hasFail
                                    ? "linear-gradient(180deg,#ff1744,#ff174400)"
                                    : "linear-gradient(180deg,var(--amber),var(--amber)00)",
                                  boxShadow: hasFail ? "0 0 6px #ff174488" : "0 0 6px var(--amber-glow)",
                                }}/>

                                {/* chevron toggle */}
                                <button
                                  onClick={()=>setLogFiles(prev=>prev.map(f=>f.id===lf.id?{...f,collapsed:!f.collapsed}:f))}
                                  style={{
                                    background:"none",border:"none",cursor:"pointer",
                                    color:"var(--text-muted)",fontSize:8,padding:"1px 4px",
                                    transition:"transform 0.2s cubic-bezier(0.34,1.2,0.64,1)",
                                    transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                                    lineHeight:1, flexShrink:0,
                                  }}
                                  title={expanded?"Collapse":"Expand"}
                                >▶</button>

                                {/* signal lamp */}
                                <div className={`sig-dot ${hasFail?"fail":"pass"}`} style={{width:6,height:6}}/>

                                {/* file name */}
                                <span style={{
                                  flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                                  fontFamily:"var(--font-mono)", fontSize:8, fontWeight:700,
                                  color: hasFail ? "var(--red)" : "var(--amber-text)",
                                  paddingLeft:3,
                                }} title={lf.name}>{lf.name}</span>

                                {/* mini stats */}
                                <div style={{display:"flex",gap:3,flexShrink:0,alignItems:"center"}}>
                                  <span className="crc-pill pass">{lf.stats.valid}✓</span>
                                  {lf.stats.invalid>0 && <span className="crc-pill fail">{lf.stats.invalid}✗</span>}
                                </div>

                                {/* remove ✕ */}
                                <button
                                  onClick={()=>{
                                    setLogFiles(prev=>prev.filter(f=>f.id!==lf.id));
                                    setSelectedLog(prev=>prev?.fileId===lf.id?null:prev);
                                  }}
                                  style={{
                                    background:"none",border:"none",fontSize:9,
                                    color:"var(--text-dim)",cursor:"pointer",
                                    padding:"1px 3px",borderRadius:3,flexShrink:0,transition:"color 0.15s",
                                  }}
                                  onMouseEnter={e=>e.currentTarget.style.color="var(--red)"}
                                  onMouseLeave={e=>e.currentTarget.style.color="var(--text-dim)"}
                                  title="Remove file"
                                >✕</button>
                              </div>

                              {/* decorative rail between file header and packets */}
                              {expanded && <div className="rail-track"/>}

                              {/* ── Packet rows ── */}
                              {expanded && lf.packets.map((pkt, i) => {
                                const isSel  = selectedLog?.fileId===lf.id && selectedLog?.pktIdx===i;
                                const crcOk  = pkt.crcValid;
                                const crcCls = crcOk===true?"pass":crcOk===false?"fail":"unkn";
                                const isRx   = pkt.direction === 'RX';
                                // Format timestamp compactly — numeric MS_MIDNIGHT (µs/ms) or an
                                // Event Log Viewer date-time string ("12-08-26 12:33:48.095")
                                const tsRaw = pkt.ts ? String(pkt.ts) : null;
                                const tsLabel = tsRaw
                                  ? /^\d+$/.test(tsRaw)
                                    ? (parseInt(tsRaw) > 1000000
                                        ? `${(parseInt(tsRaw)/1000).toFixed(0)}ms`
                                        : `${tsRaw}µs`)
                                    : (tsRaw.includes(' ') ? tsRaw.split(' ').pop() : tsRaw)
                                  : null;
                                // Event Log Viewer badge (Event Name / Event Count) — abbreviated
                                const evName = pkt.eventName || null;
                                const evAbbr = evName
                                  ? (/loco/i.test(evName) ? "LOCO-REG" : /station/i.test(evName) ? "STN-REG" : evName.replace(/[^A-Za-z]/g,"").slice(0,8).toUpperCase())
                                  : null;
                                return (
                                  <div
                                    id={`pkt-row-${lf.id}-${i}`}
                                    key={i}
                                    className={[
                                      "log-pkt-row pkt-row-in",
                                      isSel          ? "selected"     : "",
                                      crcOk===false  ? "crc-fail-row" : "",
                                    ].filter(Boolean).join(" ")}
                                    onClick={()=>handlePktClick(pkt,lf.id,i)}
                                    style={{animationDelay:`${Math.min(i*0.012, 0.4)}s`, position:"relative"}}
                                  >
                                    {/* selection rail */}
                                    {isSel && (
                                      <div style={{
                                        position:"absolute",left:0,top:0,bottom:0,width:3,
                                        background:"var(--cyan)",
                                        boxShadow:"0 0 8px var(--cyan)",
                                        borderRadius:2,
                                      }}/>
                                    )}

                                    {/* index — fixed 22px */}
                                    <span style={{
                                      fontSize:7, fontFamily:"var(--font-mono)", fontWeight:600,
                                      color: isSel ? "var(--cyan)" : "var(--text-dim)",
                                      width:22, textAlign:"right", flexShrink:0,
                                    }}>#{i+1}</span>

                                    {/* TX / RX direction badge — fixed width */}
                                    <span style={{
                                      fontSize:6, fontFamily:"var(--font-mono)", fontWeight:800,
                                      padding:"1px 4px", borderRadius:3, flexShrink:0,
                                      background: isRx ? "rgba(6,182,212,0.15)" : "rgba(245,158,11,0.15)",
                                      color:       isRx ? "var(--cyan)" : "var(--amber)",
                                      border:`1px solid ${isRx ? "rgba(6,182,212,0.3)" : "rgba(245,158,11,0.3)"}`,
                                    }}>{pkt.direction||"TX"}</span>

                                    {/* Multi-packet sub-index badge (only for concatenated lines) */}
                                    {pkt.multiPkt && (
                                      <span style={{
                                        fontSize:6, fontFamily:"var(--font-mono)", fontWeight:700,
                                        padding:"1px 3px", borderRadius:3, flexShrink:0,
                                        background:"rgba(139,92,246,0.18)",
                                        color:"#a78bfa",
                                        border:"1px solid rgba(139,92,246,0.3)",
                                      }} title="Part of multi-packet line">M{(pkt.subIdx||0)+1}</span>
                                    )}

                                    {/* Event Log Viewer badge — Event Name / Event Count / Event ID */}
                                    {evAbbr && (
                                      <span style={{
                                        fontSize:6, fontFamily:"var(--font-mono)", fontWeight:700,
                                        padding:"1px 4px", borderRadius:3, flexShrink:0,
                                        background:"rgba(16,185,129,0.15)",
                                        color:"#10b981",
                                        border:"1px solid rgba(16,185,129,0.3)",
                                      }} title={`${evName}${pkt.eventId?` · ${pkt.eventId}`:""}${pkt.eventCount?` · Count ${pkt.eventCount}`:""}${pkt.ts?` · ${pkt.ts}`:""}`}>
                                        {evAbbr}{pkt.eventCount?`#${pkt.eventCount}`:""}
                                      </span>
                                    )}

                                    {/* Hex — full raw packet, wraps */}
                                    <span style={{
                                      fontSize:7, fontFamily:"var(--font-mono)",
                                      color: isSel ? "var(--text-secondary)" : "var(--text-muted)",
                                      flex:1, minWidth:0,
                                      wordBreak:"break-all", whiteSpace:"normal",
                                      lineHeight:1.5,
                                    }}>
                                      {pkt.hex.match(/.{1,2}/g)?.join(' ')}
                                    </span>

                                    {/* MS_MIDNIGHT timestamp */}
                                    {tsLabel && (
                                      <span style={{
                                        fontSize:6, fontFamily:"var(--font-mono)",
                                        color:"var(--text-dim)", flexShrink:0,
                                        maxWidth:46, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                                      }} title={`MS_MIDNIGHT: ${pkt.ts}`}>{tsLabel}</span>
                                    )}

                                    {/* CRC pill — always rightmost, fixed width */}
                                    <span className={`crc-pill ${crcCls}`} style={{flexShrink:0}}>
                                      {crcOk===true?"✓ OK":crcOk===false?"✗ FAIL":"?"}
                                    </span>
                                  </div>
                                );
                              })}

                              {/* rail after each file's packet list */}
                              {expanded && <div className="rail-track" style={{marginBottom:4,opacity:0.15}}/>}
                            </div>
                          );
                        })}

                        {/* drag-over hint */}
                        {dragging && (
                          <div style={{
                            margin:6,padding:"8px",borderRadius:5,textAlign:"center",
                            border:"1.5px dashed var(--cyan)",
                            background:"rgba(0,229,255,0.04)",
                            fontSize:8,fontFamily:"var(--font-mono)",color:"var(--cyan)",
                          }}>🚂 Drop to add log file…</div>
                        )}
                      </div>

                      {/* ══ BOTTOM BAR ════════════════════════════════ */}
                      <div style={{
                        display:"flex",alignItems:"center",flexShrink:0,
                        borderTop:"1px solid var(--border-bright)",
                        background:"var(--panel-bg-alt)",
                      }}>
                        <div
                          onClick={()=>logRef.current.click()}
                          style={{
                            flex:1, padding:"5px 10px", cursor:"pointer", textAlign:"center",
                            fontSize:8, fontFamily:"var(--font-mono)", color:"var(--text-dim)",
                            borderRight:"1px solid var(--border)", transition:"all 0.15s",
                            display:"flex", alignItems:"center", justifyContent:"center", gap:4,
                          }}
                          onMouseEnter={e=>{e.currentTarget.style.color="var(--cyan)";e.currentTarget.style.background="rgba(0,229,255,0.05)";}}
                          onMouseLeave={e=>{e.currentTarget.style.color="var(--text-dim)";e.currentTarget.style.background="transparent";}}
                        >📂 add / replace</div>
                        <div
                          onClick={()=>{ if(!exportingLog) exportLogFilesXlsx(logFiles); }}
                          style={{
                            flex:1, padding:"5px 10px", cursor: exportingLog?"wait":"pointer", textAlign:"center",
                            fontSize:8, fontFamily:"var(--font-mono)",
                            color: exportingLog ? "var(--green)" : "var(--text-dim)",
                            borderRight:"1px solid var(--border)", transition:"all 0.15s",
                            display:"flex", alignItems:"center", justifyContent:"center", gap:4,
                          }}
                          onMouseEnter={e=>{if(!exportingLog){e.currentTarget.style.color="var(--green)";e.currentTarget.style.background="rgba(0,230,118,0.06)";}}}
                          onMouseLeave={e=>{if(!exportingLog){e.currentTarget.style.color="var(--text-dim)";e.currentTarget.style.background="transparent";}}}
                          title="Decode every loaded packet and export to an Excel workbook (one sheet per packet type)"
                        >{exportingLog ? "⏳ exporting…" : "⬇ export xlsx"}</div>
                        <div
                          onClick={()=>{setLogFiles([]);setSelectedLog(null);}}
                          style={{
                            padding:"5px 10px", cursor:"pointer",
                            fontSize:8, fontFamily:"var(--font-mono)", color:"var(--text-dim)",
                            transition:"all 0.15s",
                            display:"flex", alignItems:"center", gap:4,
                          }}
                          onMouseEnter={e=>{e.currentTarget.style.color="var(--red)";e.currentTarget.style.background="rgba(255,23,68,0.06)";}}
                          onMouseLeave={e=>{e.currentTarget.style.color="var(--text-dim)";e.currentTarget.style.background="transparent";}}
                          title="Clear all files"
                        >🗑 clear all</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </>
  );
}