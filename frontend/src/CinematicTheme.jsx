/**
 * CinematicTheme.jsx — the PINJ sign-in look (Auth.jsx) carried across every page.
 *
 * One theme layer, rendered AFTER the page (main.jsx), so it wins over the older per-page palettes
 * (App.jsx "railway terminal" amber, SvkSim.jsx green-black, LiveFeed.jsx, PacketSimulator.jsx):
 *   • the same deep teal-black glass, mint-green + cyan accents, soft text tones and glowing focus
 *   • app chrome restyled like the sign-in card: top bar, tab bars, primary buttons (light sweep),
 *     scrollbars, menus and dialogs (glass + glowing edge, pop-in)
 *   • smooth motion: pages and tab panes glide in, dialogs rise in, rows highlight softly
 *
 * Only presentation. Colours that carry MEANING in the data (amber / red / purple fields, alerts,
 * brake states, CRC pass/fail) are left exactly as they were. The light theme keeps its blueprint
 * colours and only gets the motion. Everything respects "reduce motion".
 */

const CSS = `
/* ═══ 1. palette (dark) — every variable family the pages use ═══════════════════════════ */
:root:not(.light) {
  /* App.jsx / SvkSim.jsx / SettingsAbout.jsx */
  --bg-void:        rgba(2,8,7,0.74);
  --bg-base:        rgba(4,11,10,0.84);
  --bg-surface:     rgba(6,14,13,0.86);
  --bg-raised:      rgba(9,20,18,0.88);
  --bg-hover:       rgba(14,30,26,0.9);
  --bg-input:       rgba(2,9,8,0.84);
  --bg-card:        rgba(7,17,15,0.86);
  --border:         rgba(140,220,180,0.12);
  --border-bright:  rgba(140,220,180,0.22);
  --border-glow:    rgba(53,240,154,0.38);
  --border-focus:   rgba(53,240,154,0.6);
  --green:          #35f09a;
  --green-dim:      #22c97c;
  --green-glow:     rgba(53,240,154,0.09);
  --green-deep:     #17b26a;
  --cyan:           #4fd8ff;
  --cyan-dim:       #2bb8e0;
  --cyan-glow:      rgba(79,216,255,0.09);
  --text-primary:   #eef7f2;
  --text-secondary: #9cb3a8;
  --text-muted:     #62807a;
  --text-dim:       #355249;
  --text-code:      #8ff7c6;
  --section-bg:     linear-gradient(90deg, rgba(53,240,154,0.10), transparent);
  --section-text:   #5cf7b0;
  --sidebar-active: rgba(53,240,154,0.10);
  --tag-bg:         rgba(53,240,154,0.06);
  --tag-border:     rgba(53,240,154,0.20);
  --topbar-bg:      #020605;
  --topbar-border:  rgba(140,220,180,0.12);
  --footer-bg:      rgba(2,8,7,0.92);
  --th-bg:          #03100c;
  --row-alt:        rgba(53,240,154,0.018);
  --btn-secondary:  rgba(9,20,18,0.9);
  --empty-border:   rgba(140,220,180,0.2);
  --empty-bg:       rgba(4,12,10,0.6);
  --toggle-track:   rgba(140,220,180,0.14);
  --toggle-thumb:   #35f09a;
  --scan-color:     rgba(53,240,154,0.25);
  --panel-bg:       linear-gradient(180deg, rgba(3,10,8,0.92) 0%, rgba(2,6,5,0.94) 100%);
  --panel-bg-alt:   linear-gradient(135deg, rgba(6,16,14,0.9) 0%, rgba(8,20,17,0.9) 60%, rgba(4,10,9,0.92) 100%);
  --tooltip-bg:     linear-gradient(135deg, rgba(7,18,15,0.97), rgba(4,11,9,0.97));
  --hex-strip-bg:   linear-gradient(135deg, #030b09, #020605);
  --hex-strip-border: rgba(53,240,154,0.16);
  --input-deep-bg:  linear-gradient(180deg, #020705, #030907);
  --divider:        rgba(140,220,180,0.10);
  /* LiveFeed.jsx (/live) */
  --bg:             #020605;
  --surface:        rgba(6,14,13,0.92);
  --raised:         rgba(9,20,18,0.92);
  --hover:          rgba(14,30,26,0.92);
  --border-b:       rgba(140,220,180,0.22);
  --text:           #eef7f2;
  --sub:            #9cb3a8;
  --muted:          #62807a;
  --dim:            #355249;
  --code:           #8ff7c6;
  /* PacketSimulator.jsx (/simulator) */
  --void:           #020605;
  --base:           #040b0a;
  --surf:           #06100e;
  --inp:            #020806;
  --bdr:            rgba(140,220,180,0.12);
  --bdr2:           rgba(140,220,180,0.22);
  --bdr3:           rgba(140,220,180,0.32);
  --tp:             #eef7f2;
  --ts:             #9cb3a8;
  --tm:             #62807a;
  --td:             #355249;
  --tc:             #8ff7c6;
  --topbg:          #020605;
  --topbdr:         rgba(140,220,180,0.12);
  --ftbg:           #030907;
  --trk:            rgba(140,220,180,0.14);
  --thm:            #35f09a;
  --alt:            rgba(53,240,154,0.02);
}

/* ═══ 2. chrome like the sign-in card (dark) ══════════════════════════════════════════ */
:root:not(.light) ::selection { background: rgba(53,240,154,0.28); color: #fff; }
:root:not(.light) ::-webkit-scrollbar-thumb { background: linear-gradient(180deg, rgba(53,240,154,0.55), rgba(79,216,255,0.45)) !important; border-radius: 4px; }
:root:not(.light) ::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #35f09a, #4fd8ff) !important; box-shadow: 0 0 8px rgba(53,240,154,0.6); }
:root:not(.light) ::-webkit-scrollbar-track { background: transparent !important; }

/* top bar: dark glass, mint/cyan edge light instead of amber */
:root:not(.light) .kv-topbar {
  background: linear-gradient(180deg, rgba(1,5,4,0.92) 0%, rgba(2,8,7,0.84) 100%) !important;
  border-bottom: 1px solid rgba(140,220,180,0.12) !important;
  /* no backdrop-filter here: it would trap the ⚙ menu (position:fixed) inside the 52 px top bar */
  box-shadow: 0 12px 40px rgba(0,0,0,0.55), 0 1px 0 rgba(53,240,154,0.08) !important;
}
:root:not(.light) .kv-topbar::before {
  background: linear-gradient(90deg, transparent, rgba(53,240,154,0.12) 20%, rgba(79,216,255,0.5) 50%, rgba(53,240,154,0.12) 80%, transparent) !important;
}
:root:not(.light) .kv-topbar::after {
  background: repeating-linear-gradient(90deg, #35f09a 0, #35f09a 3px, transparent 3px, transparent 9px) !important;
  opacity: 0.22 !important;
}

/* home page: the top bar floats over the night scene — no strip, no lines, just a soft shade for the logo
   (html:root … beats the ":root:not(.light) .kv-topbar" bar style above) */
html:root .kv-topbar.kv-topbar-float {
  background: linear-gradient(180deg, rgba(1,4,6,0.55) 0%, rgba(1,4,6,0.18) 70%, rgba(1,4,6,0) 100%) !important;
  border-bottom: none !important; box-shadow: none !important; overflow: visible !important;
}
html:root .kv-topbar.kv-topbar-float::before, html:root .kv-topbar.kv-topbar-float::after { display: none !important; }

/* the dock: every control of the bar in one rounded capsule, same height, grouped by thin separators.
   No backdrop-filter here — it would trap the ⚙ menu (position:fixed) inside the capsule. */
.kv-dock { display: flex; align-items: center; gap: 6px; padding: 4px 5px 4px 12px; border-radius: 14px; flex-shrink: 0;
  background: linear-gradient(180deg, rgba(8,20,17,0.82), rgba(3,10,8,0.82));
  border: 1px solid rgba(140,220,180,0.18);
  box-shadow: 0 10px 34px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05); }
.kv-dock-btns { gap: 6px !important; }
.kv-dock-sep, .kv-dock .kv-menu-sep { width: 1px !important; height: 20px !important; margin: 0 2px !important; flex-shrink: 0;
  background: linear-gradient(180deg, transparent, rgba(140,220,180,0.32), transparent) !important; display: inline-block; }
.kv-dock .kv-btn { height: 30px !important; padding: 0 13px !important; border-radius: 9px !important; font-size: 10.5px !important;
  letter-spacing: 0.1em !important; gap: 6px !important; }
.kv-dock .kv-btn-sim { border-color: rgba(53,240,154,0.28) !important; color: #7ff0bd !important; background: rgba(53,240,154,0.05) !important; }
.kv-dock .kv-btn-sim:hover, .kv-dock .kv-btn-sim.active { background: rgba(53,240,154,0.14) !important; color: #b6ffd9 !important;
  border-color: rgba(53,240,154,0.6) !important; box-shadow: 0 0 14px rgba(53,240,154,0.22) !important; }
.kv-dock .kv-btn-live { background: linear-gradient(135deg, #8f1d24, #c42b33) !important; border-color: rgba(255,120,120,0.35) !important;
  box-shadow: 0 0 12px rgba(220,38,38,0.25) !important; }
.kv-dock .kv-btn-live:hover, .kv-dock .kv-btn-live.active { background: linear-gradient(135deg, #c42b33, #ef4444) !important;
  box-shadow: 0 0 18px rgba(239,68,68,0.45) !important; }
.kv-dock .kv-btn-ghost { border-color: rgba(140,220,180,0.2) !important; color: #b9cdc4 !important; background: rgba(255,255,255,0.02) !important; }
.kv-dock .kv-btn-ghost:hover { border-color: rgba(79,216,255,0.55) !important; color: #4fd8ff !important; }
.kv-dock .kv-btn-decode:disabled { background: rgba(255,255,255,0.03) !important; color: #4f6a62 !important;
  border: 1px solid rgba(140,220,180,0.14) !important; box-shadow: none !important; animation: none !important; }
.kv-dock .kv-menu-btn { height: 30px !important; width: 34px !important; border-radius: 9px !important; }
.kv-dock .theme-toggle { transform: scale(0.92); }
.kv-dock-status { padding-right: 2px; }

/* tab bars + tabs: mint underline that grows, soft glow */
:root:not(.light) .kv-tabbar { background: linear-gradient(180deg, rgba(2,8,7,0.94), rgba(1,5,4,0.94)) !important; border-bottom: 1px solid rgba(140,220,180,0.10) !important; }
:root:not(.light) .kv-tabbar::before { background: linear-gradient(90deg, transparent, rgba(53,240,154,0.12), rgba(79,216,255,0.35), rgba(53,240,154,0.12), transparent) !important; }
:root:not(.light) .kv-tabbar::after { background: linear-gradient(90deg, transparent, rgba(53,240,154,0.08), rgba(53,240,154,0.25), rgba(53,240,154,0.08), transparent) !important; }
:root:not(.light) .kv-tab::before { background: linear-gradient(90deg, #35f09a, #4fd8ff) !important; }
:root:not(.light) .kv-tab.active::before { box-shadow: 0 0 12px rgba(53,240,154,0.8) !important; }
:root:not(.light) .kv-tab.active {
  color: #5cf7b0 !important;
  background: linear-gradient(180deg, rgba(53,240,154,0.09) 0%, rgba(53,240,154,0.02) 60%, transparent 100%) !important;
  text-shadow: 0 0 14px rgba(53,240,154,0.5), 0 0 30px rgba(53,240,154,0.15) !important;
}
:root:not(.light) .kv-tab:hover:not(.active) { color: rgba(92,247,176,0.8) !important; background: rgba(53,240,154,0.035) !important; text-shadow: none !important; }

/* buttons: the sign-in button's gradient, glow and light sweep */
:root:not(.light) .kv-btn-decode:not(:disabled) {
  background: linear-gradient(135deg, #5cf7b0 0%, #22c97c 55%, #19a8c9 130%) !important; color: #021208 !important;
  animation: cine-btn-pulse 2.6s ease-in-out infinite !important;
}
:root:not(.light) .kv-btn-decode:hover:not(:disabled) {
  animation: none !important;
  box-shadow: 0 14px 40px rgba(53,240,154,0.42), 0 0 50px rgba(53,240,154,0.18), inset 0 1px 0 rgba(255,255,255,0.45) !important;
}
@keyframes cine-btn-pulse {
  0%,100% { box-shadow: 0 8px 26px rgba(53,240,154,0.26), inset 0 1px 0 rgba(255,255,255,0.35); }
  50%     { box-shadow: 0 10px 36px rgba(53,240,154,0.45), 0 0 46px rgba(53,240,154,0.16), inset 0 1px 0 rgba(255,255,255,0.45); }
}
:root:not(.light) .kv-btn-ghost:hover { border-color: #35f09a !important; color: #5cf7b0 !important; background: rgba(53,240,154,0.06) !important; }
.kv-btn::after {
  background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.28) 50%, transparent 70%) !important;
  background-size: 250% 100% !important; background-position: 140% 0 !important;
  transition: background-position 0.65s ease !important;
}
.kv-btn:hover::after { background-position: -40% 0 !important; }

/* main call-to-action buttons (e.g. Packet Simulator ▶ START AUTO-SEND) */
:root:not(.light) .cine-cta:not(:disabled) {
  background: linear-gradient(135deg, #5cf7b0 0%, #22c97c 55%, #19a8c9 130%) !important; color: #021208 !important;
  box-shadow: 0 10px 30px rgba(53,240,154,0.28), inset 0 1px 0 rgba(255,255,255,0.4) !important;
}
:root:not(.light) .cine-cta:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 40px rgba(53,240,154,0.4), inset 0 1px 0 rgba(255,255,255,0.5) !important; }
.cine-cta::after { content: ""; position: absolute; top: 0; bottom: 0; left: -60%; width: 40%; transform: skewX(-20deg); pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent); transition: left 0.6s; }
.cine-cta:hover::after { left: 120%; }

/* app menu (⚙): glass like the card */
:root:not(.light) .kv-menu {
  background: linear-gradient(160deg, rgba(8,20,17,0.95), rgba(3,10,8,0.95)) !important;
  border-color: rgba(53,240,154,0.22) !important;
  box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 40px rgba(53,240,154,0.08) !important;
  backdrop-filter: blur(18px) saturate(1.3); -webkit-backdrop-filter: blur(18px) saturate(1.3);
  animation: cine-pop 0.28s cubic-bezier(.2,.7,.2,1) both;
}
:root:not(.light) .kv-menu-item:hover, :root:not(.light) .kv-menu-item:focus-visible { background: rgba(53,240,154,0.09) !important; }
:root:not(.light) .kv-menu-btn:hover { border-color: rgba(53,240,154,0.55) !important; color: #5cf7b0 !important; background: rgba(53,240,154,0.07) !important; }
:root:not(.light) .kv-menu-btn.open { border-color: #35f09a !important; color: #5cf7b0 !important; background: rgba(53,240,154,0.12) !important; box-shadow: 0 0 14px rgba(53,240,154,0.3) !important; }

/* dialogs (Settings, About, library picker …): glass, glowing edge, rise-in */
:root:not(.light) [role="dialog"] {
  border-color: rgba(53,240,154,0.24) !important;
  box-shadow: 0 40px 120px rgba(0,0,0,0.65), 0 0 0 1px rgba(53,240,154,0.10), 0 0 70px rgba(53,240,154,0.07) !important;
  backdrop-filter: blur(22px) saturate(1.3); -webkit-backdrop-filter: blur(22px) saturate(1.3);
}
[role="dialog"] { border-radius: 14px !important; animation: cine-pop 0.42s cubic-bezier(.2,.7,.2,1) both !important; }
:root:not(.light) .sa-nav-btn.on { background: linear-gradient(135deg, rgba(53,240,154,0.16), rgba(79,216,255,0.08)) !important; box-shadow: 0 6px 20px rgba(53,240,154,0.12); }
:root:not(.light) .sa-btn.primary { background: linear-gradient(135deg, rgba(92,247,176,0.22), rgba(34,201,124,0.18)) !important; border-color: rgba(53,240,154,0.6) !important; }
:root:not(.light) .sa-btn:hover { border-color: rgba(79,216,255,0.6) !important; color: #4fd8ff !important; }

/* inputs: the sign-in focus glow everywhere */
:root:not(.light) input:not([type=checkbox]):not([type=radio]):not([type=range]):focus,
:root:not(.light) textarea:focus, :root:not(.light) select:focus {
  outline: none !important;
  border-color: rgba(53,240,154,0.7) !important;
  box-shadow: 0 0 0 3px rgba(53,240,154,0.13), 0 0 22px rgba(53,240,154,0.12) !important;
}

/* ═══ 3. motion (both themes) ══════════════════════════════════════════════════════════ */
@keyframes cine-page-in { from { opacity: 0; transform: translateY(12px); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes cine-pane-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes cine-pop { from { opacity: 0; transform: translateY(14px) scale(0.98); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }
.cine-page { animation: cine-page-in 0.55s cubic-bezier(.2,.7,.2,1) both; }
.cine-panes > * { animation: cine-pane-in 0.38s cubic-bezier(.2,.7,.2,1) both; }
@media (prefers-reduced-motion: reduce) {
  .cine-page, .cine-panes > *, [role="dialog"], .kv-menu { animation: none !important; }
  :root:not(.light) .kv-btn-decode:not(:disabled) { animation: none !important; }
}
`;

export default function CinematicTheme() {
  return <style data-pinj="cinematic-theme">{CSS}</style>;
}
