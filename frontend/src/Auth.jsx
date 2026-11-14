/**
 * Auth.jsx — multi-user PINJ: sign-in, sign-up (approved by an administrator), first-run
 * administrator set-up, forced password change, and the 👤 PROFILE / 👥 USERS panels shown
 * in ⚙ SETTINGS.
 *
 * Talks only to the hub's own /hub/… endpoints (backend/hub.py). The session is an HttpOnly
 * cookie set by the hub, so nothing secret is kept in the browser.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/* ═══════════════════════════════════════════════════════════════
   current user
═══════════════════════════════════════════════════════════════ */
let _user = null;
const _subs = new Set();
export const authStore = {
  get: () => _user,
  set: u => { _user = u; _subs.forEach(fn => fn()); },
  subscribe: fn => { _subs.add(fn); return () => _subs.delete(fn); },
};
export const useCurrentUser = () => useSyncExternalStore(authStore.subscribe, authStore.get, authStore.get);

export const CURRENT_USER_KEY = "pinj-current-user";   // which user's saved settings this browser shows

function rememberUser(username) {
  try {
    if (username) localStorage.setItem(CURRENT_USER_KEY, username);
    else localStorage.removeItem(CURRENT_USER_KEY);
  } catch (_) { /* storage blocked */ }
}

/** JSON call to the hub; throws Error(message) with the hub's own explanation. */
export async function hub(path, { method = "GET", body } = {}) {
  const r = await fetch(path, {
    method, credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch (_) { /* not JSON */ }
  if (!r.ok) {
    let msg = j?.detail;
    if (Array.isArray(msg)) msg = msg.map(d => (d.loc ? d.loc[d.loc.length - 1] + ": " : "") + d.msg).join(" · ");
    const e = new Error(msg || `The PINJ server answered ${r.status}.`);
    e.status = r.status;
    throw e;
  }
  return j;
}

export async function signOut() {
  try { await hub("/hub/auth/logout", { method: "POST" }); } catch (_) { /* already signed out */ }
  rememberUser(null);
  window.location.reload();
}

/** Any PINJ call answered 401 (signed out elsewhere, disabled, password reset) → back to the sign-in page. */
let _guardInstalled = false;
function installFetchGuard() {
  if (_guardInstalled) return;
  _guardInstalled = true;
  const orig = window.fetch.bind(window);
  let reloading = false;
  window.fetch = async (...args) => {
    const res = await orig(...args);
    if (res.status === 401 && !reloading) {
      const url = String(args[0]?.url || args[0] || "");
      if (!url.includes("/hub/auth/")) {
        reloading = true;
        setTimeout(() => window.location.reload(), 300);
      }
    }
    return res;
  };
}

/* ═══════════════════════════════════════════════════════════════
   sign-in pages (shown before the app loads — own styles)
   Cinematic theme: the night station scene drifts slowly (camera move), letterbox bars open on
   arrival, a headlight beam sweeps the track, the PINJ title shimmers, and a live TDMA epoch
   instrument ticks on the real 2-second boundaries. The sign-in card is glass with a moving edge.
   Motion is switched off for users who ask their system for reduced motion.
═══════════════════════════════════════════════════════════════ */
const GATE_CSS = `
  @property --pg-ang { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
  .pg-root { --g:#35f09a; --g2:#17b26a; --cy:#4fd8ff; --t:#eef7f2; --t2:#9cb3a8; --t3:#6c8279;
    --line:rgba(140,220,180,0.16); --card:rgba(8,14,13,0.66); --in:rgba(2,8,7,0.62); --red:#ff6b6b; --amber:#ffc35c;
    position:fixed; inset:0; overflow:auto; background:#020605; color:var(--t);
    font-family:"JetBrains Mono","Cascadia Mono",Consolas,monospace; }

  /* ── scene layers ─────────────────────────────────────────── */
  .pg-scene { position:fixed; inset:0; overflow:hidden; pointer-events:none; }
  .pg-bg { position:absolute; inset:-4%; background:url(/kavach-bg-v3.webp) center 62%/cover no-repeat;
    filter:saturate(1.08) contrast(1.06) brightness(1.0); transform-origin:62% 55%;
    animation:pg-drift 38s ease-in-out infinite alternate, pg-fadein 1.6s ease-out both; }
  @keyframes pg-drift { from { transform:scale(1.04) translate3d(0,0,0); } to { transform:scale(1.13) translate3d(-1.6%,-1%,0); } }
  @keyframes pg-fadein { from { opacity:0; filter:brightness(0.2) blur(6px); } to { opacity:1; } }
  .pg-shade { position:absolute; inset:0; background:
      radial-gradient(120% 90% at 40% 50%, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.75) 100%),
      linear-gradient(90deg, rgba(1,6,5,0.82) 0%, rgba(1,6,5,0.45) 34%, rgba(1,6,5,0.05) 58%, rgba(1,6,5,0.35) 100%),
      linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.9) 100%); }
  .pg-beam { position:absolute; left:-40%; top:58%; width:40%; height:22%; filter:blur(18px); opacity:0;
    background:radial-gradient(50% 50% at 50% 50%, rgba(255,236,190,0.30), rgba(255,236,190,0) 70%);
    animation:pg-beam 16s cubic-bezier(.45,.05,.55,.95) 2.2s infinite; mix-blend-mode:screen; }
  @keyframes pg-beam { 0% { transform:translateX(0); opacity:0; } 10% { opacity:1; } 55% { opacity:0.9; }
    70% { transform:translateX(340%); opacity:0; } 100% { transform:translateX(340%); opacity:0; } }
  .pg-scan { position:absolute; inset:0; opacity:0.18;
    background:repeating-linear-gradient(180deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 3px); }
  .pg-glow { position:absolute; width:46vmax; height:46vmax; right:-12vmax; top:12%; border-radius:50%;
    background:radial-gradient(circle, rgba(53,240,154,0.10), rgba(53,240,154,0) 62%); filter:blur(10px);
    animation:pg-breathe 9s ease-in-out infinite; }
  @keyframes pg-breathe { 0%,100% { opacity:0.6; transform:scale(1); } 50% { opacity:1; transform:scale(1.08); } }
  .pg-bar { position:fixed; left:0; right:0; height:7vh; background:#000; z-index:3; pointer-events:none;
    animation:pg-bars 1.5s cubic-bezier(.7,0,.2,1) both; }
  .pg-bar.top { top:0; transform-origin:top; } .pg-bar.bot { bottom:0; transform-origin:bottom; }
  @keyframes pg-bars { from { height:50.5vh; } to { height:7vh; } }

  /* ── layout ───────────────────────────────────────────────── */
  .pg-stage { position:relative; z-index:2; min-height:100%; box-sizing:border-box; display:grid;
    grid-template-columns:minmax(0,1.25fr) minmax(330px,430px); align-items:center; gap:5vw; padding:11vh 7vw; }
  .pg-topbar { position:fixed; top:0; left:0; right:0; height:7vh; z-index:4; display:flex; align-items:center;
    justify-content:space-between; padding:0 2.4vw; font-size:10px; letter-spacing:0.22em; color:var(--t3);
    animation:pg-rise 1s ease-out 1.3s both; }
  .pg-topbar img { height:18px; opacity:0.9; }
  .pg-botbar { position:fixed; bottom:0; left:0; right:0; height:7vh; z-index:4; display:flex; align-items:center;
    justify-content:space-between; gap:16px; padding:0 2.4vw; font-size:9.5px; letter-spacing:0.16em; color:var(--t3);
    animation:pg-rise 1s ease-out 1.5s both; }
  .pg-botbar b { color:var(--t2); font-weight:600; }

  /* ── hero ─────────────────────────────────────────────────── */
  .pg-hero { animation:pg-rise 1.1s cubic-bezier(.2,.7,.2,1) 0.9s both; }
  @keyframes pg-rise { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:none; } }
  .pg-eyebrow { display:inline-flex; align-items:center; gap:10px; padding:6px 12px; border-radius:20px;
    border:1px solid rgba(53,240,154,0.28); background:rgba(53,240,154,0.07); font-size:10px; letter-spacing:0.24em; color:var(--g); }
  .pg-dot { width:7px; height:7px; border-radius:50%; background:var(--g); box-shadow:0 0 10px var(--g); }
  .pg-dot.tick { animation:pg-tick 0.6s ease-out; }
  @keyframes pg-tick { 0% { transform:scale(2.2); box-shadow:0 0 22px var(--g); } 100% { transform:scale(1); } }
  .pg-hero h1 { margin:22px 0 4px; font-size:clamp(64px, 11vw, 168px); line-height:0.9; font-weight:800; letter-spacing:0.14em;
    background:linear-gradient(100deg, #e9fff4 0%, #8ff7c6 28%, #35f09a 46%, #4fd8ff 62%, #e9fff4 80%);
    background-size:240% 100%; -webkit-background-clip:text; background-clip:text; color:transparent;
    filter:drop-shadow(0 8px 40px rgba(53,240,154,0.22)); animation:pg-shine 9s linear infinite; }
  @keyframes pg-shine { from { background-position:120% 0; } to { background-position:-120% 0; } }
  .pg-hero h2 { margin:0; font-size:clamp(12px, 1.25vw, 17px); font-weight:700; letter-spacing:0.42em; color:var(--t); }
  .pg-verbs { margin-top:14px; font-size:11px; letter-spacing:0.3em; color:var(--t2); }
  .pg-verbs i { font-style:normal; color:var(--g); padding:0 8px; }
  .pg-rule { width:120px; height:2px; margin:26px 0 22px; background:linear-gradient(90deg, var(--g), transparent); }
  .pg-chips { display:flex; flex-wrap:wrap; gap:8px; }
  .pg-chip { padding:5px 10px; border-radius:4px; border:1px solid var(--line); background:rgba(0,0,0,0.35);
    font-size:9.5px; letter-spacing:0.14em; color:var(--t2); }

  /* TDMA epoch instrument (real 2 s boundaries) */
  .pg-tdma { margin-top:28px; width:min(420px, 100%); padding:12px 14px; border-radius:8px; border:1px solid var(--line);
    background:rgba(0,0,0,0.38); backdrop-filter:blur(4px); }
  .pg-tdma-head { display:flex; justify-content:space-between; font-size:9.5px; letter-spacing:0.18em; color:var(--t3); }
  .pg-tdma-head b { color:var(--cy); font-weight:700; }
  .pg-slots { display:grid; grid-template-columns:repeat(20, 1fr); gap:3px; margin-top:10px; }
  .pg-slot { height:16px; border-radius:2px; background:rgba(79,216,255,0.08); border:1px solid rgba(79,216,255,0.12); transition:background .15s; }
  .pg-slot.on { background:rgba(79,216,255,0.55); box-shadow:0 0 10px rgba(79,216,255,0.6); border-color:rgba(79,216,255,0.9); }
  .pg-slot.done { background:rgba(53,240,154,0.22); border-color:rgba(53,240,154,0.35); }

  /* ── card ─────────────────────────────────────────────────── */
  .pg-cardwrap { position:relative; border-radius:18px; padding:1px; animation:pg-cardin 1.1s cubic-bezier(.2,.7,.2,1) 1.1s both;
    background:conic-gradient(from var(--pg-ang), rgba(53,240,154,0.0) 0deg, rgba(53,240,154,0.75) 60deg, rgba(79,216,255,0.6) 110deg,
      rgba(53,240,154,0.0) 170deg, rgba(255,255,255,0.08) 260deg, rgba(53,240,154,0.0) 360deg);
    box-shadow:0 40px 120px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.03); }
  .pg-cardwrap.spin { animation:pg-cardin 1.1s cubic-bezier(.2,.7,.2,1) 1.1s both, pg-spin 7s linear infinite; }
  @keyframes pg-spin { to { --pg-ang:360deg; } }
  @keyframes pg-cardin { from { opacity:0; transform:translateY(26px) scale(0.98); filter:blur(4px); } to { opacity:1; transform:none; filter:none; } }
  .pg-card { position:relative; border-radius:17px; padding:30px 30px 22px; background:var(--card);
    backdrop-filter:blur(22px) saturate(1.3); -webkit-backdrop-filter:blur(22px) saturate(1.3); overflow:hidden; }
  .pg-card::before { content:""; position:absolute; inset:0 0 auto 0; height:120px; pointer-events:none;
    background:radial-gradient(80% 100% at 50% 0%, rgba(53,240,154,0.10), transparent 70%); }
  .pg-brand { position:relative; display:flex; align-items:center; gap:14px; margin-bottom:22px; }
  .pg-brand img { width:46px; height:46px; object-fit:contain; filter:drop-shadow(0 0 14px rgba(53,240,154,0.35)); }
  .pg-title { font-size:15px; font-weight:800; letter-spacing:0.32em; color:var(--t); }
  .pg-title span { color:var(--g); }
  .pg-sub { font-size:10.5px; color:var(--t2); letter-spacing:0.04em; margin-top:5px; line-height:1.45; }
  .pg-lock { margin-left:auto; align-self:flex-start; font-size:8.5px; letter-spacing:0.16em; color:var(--t3);
    border:1px solid var(--line); border-radius:10px; padding:3px 8px; white-space:nowrap; }

  .pg-tabs { position:relative; display:flex; gap:4px; padding:4px; border:1px solid var(--line); border-radius:10px;
    margin-bottom:20px; background:rgba(0,0,0,0.3); }
  .pg-tab { flex:1; padding:9px 0; border:none; border-radius:7px; background:transparent; color:var(--t3); cursor:pointer;
    font:inherit; font-size:10.5px; font-weight:800; letter-spacing:0.14em; transition:color .2s, background .25s, box-shadow .25s; }
  .pg-tab:hover { color:var(--t); }
  .pg-tab.on { color:#021208; background:linear-gradient(135deg, #5cf7b0, #22c97c); box-shadow:0 6px 22px rgba(53,240,154,0.28); }

  .pg-field { display:block; margin-bottom:14px; position:relative; }
  .pg-field > span { display:flex; justify-content:space-between; font-size:9.5px; font-weight:700; letter-spacing:0.16em; color:var(--t2); margin-bottom:6px; }
  .pg-field > span em { font-style:normal; color:var(--amber); letter-spacing:0.08em; }
  .pg-inwrap { position:relative; }
  .pg-field input { width:100%; box-sizing:border-box; padding:12px 14px; border-radius:9px; border:1px solid var(--line);
    background:var(--in); color:var(--t); font:inherit; font-size:13px; outline:none; transition:border-color .2s, box-shadow .2s, background .2s; }
  .pg-field input::placeholder { color:var(--t3); opacity:0.7; }
  .pg-field input:hover { border-color:rgba(140,220,180,0.3); }
  .pg-field input:focus { border-color:var(--g); background:rgba(2,12,9,0.8); box-shadow:0 0 0 4px rgba(53,240,154,0.12), 0 0 26px rgba(53,240,154,0.12); }
  .pg-field input.pw { padding-right:44px; }
  .pg-eye { position:absolute; right:6px; top:50%; transform:translateY(-50%); width:32px; height:30px; border:none; border-radius:6px;
    background:transparent; color:var(--t3); cursor:pointer; font-size:14px; }
  .pg-eye:hover { color:var(--g); background:rgba(53,240,154,0.08); }
  .pg-row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }

  .pg-btn { position:relative; overflow:hidden; width:100%; padding:13px; margin-top:6px; border-radius:10px; border:none;
    background:linear-gradient(135deg, #5cf7b0 0%, #22c97c 55%, #19a8c9 130%); color:#021208;
    font:inherit; font-size:12.5px; font-weight:800; letter-spacing:0.24em; cursor:pointer;
    box-shadow:0 10px 30px rgba(53,240,154,0.28), inset 0 1px 0 rgba(255,255,255,0.4); transition:transform .15s, box-shadow .2s, filter .2s; }
  .pg-btn::after { content:""; position:absolute; top:0; bottom:0; left:-60%; width:40%; transform:skewX(-20deg);
    background:linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent); transition:left .6s; }
  .pg-btn:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 14px 40px rgba(53,240,154,0.38), inset 0 1px 0 rgba(255,255,255,0.5); }
  .pg-btn:hover:not(:disabled)::after { left:120%; }
  .pg-btn:active:not(:disabled) { transform:translateY(0); }
  .pg-btn:disabled { cursor:wait; filter:saturate(0.6) brightness(0.85); }
  .pg-btn:disabled::after { left:-60%; animation:pg-sweep 1.1s linear infinite; }
  @keyframes pg-sweep { to { left:120%; } }

  .pg-msg { font-size:11px; line-height:1.55; padding:10px 12px; border-radius:9px; margin-bottom:16px; animation:pg-rise .3s ease-out; }
  .pg-msg.err { color:#ff9a9a; border:1px solid rgba(255,107,107,0.4); background:rgba(255,107,107,0.09); }
  .pg-msg.ok { color:var(--g); border:1px solid rgba(53,240,154,0.4); background:rgba(53,240,154,0.08); }
  .pg-msg.info { color:var(--amber); border:1px solid rgba(255,195,92,0.4); background:rgba(255,195,92,0.08); }
  .pg-foot { margin-top:18px; padding-top:14px; border-top:1px solid var(--line); font-size:10px; color:var(--t2); text-align:center; line-height:1.7; }
  .pg-link { background:none; border:none; color:var(--g); cursor:pointer; font:inherit; padding:0; text-decoration:none;
    border-bottom:1px dashed rgba(53,240,154,0.5); }
  .pg-link:hover { border-bottom-style:solid; }

  /* ── depth (mouse parallax), sky, decode, access granted, ticker ── */
  .pg-par { position:absolute; inset:0; transform:translate3d(calc(var(--mx, 0) * -26px), calc(var(--my, 0) * -16px), 0);
    transition:transform .9s cubic-bezier(.2,.7,.2,1); }
  .pg-stars { position:absolute; inset:0; width:100%; height:100%; mix-blend-mode:screen; opacity:0.9; }
  .pg-depth { transform:translate3d(calc(var(--mx, 0) * 10px), calc(var(--my, 0) * 6px), 0); transition:transform .9s cubic-bezier(.2,.7,.2,1); }
  .pg-hero h1 span { white-space:pre; }
  .pg-card.shake { animation:pg-shake .55s cubic-bezier(.36,.07,.19,.97) both; }
  @keyframes pg-shake { 10%,90% { transform:translateX(-2px); } 20%,80% { transform:translateX(4px); }
    30%,50%,70% { transform:translateX(-7px); box-shadow:inset 0 0 0 1px rgba(255,107,107,0.55), 0 0 40px rgba(255,107,107,0.18); }
    40%,60% { transform:translateX(7px); } }
  .pg-card.ok { box-shadow:inset 0 0 0 1px rgba(53,240,154,0.7), 0 0 60px rgba(53,240,154,0.35); transition:box-shadow .3s; }
  .pg-granted { position:fixed; inset:0; z-index:10; display:flex; align-items:center; justify-content:center; pointer-events:all;
    animation:pg-gfade 1.6s ease-in both; }
  @keyframes pg-gfade { 0% { background:rgba(0,0,0,0); backdrop-filter:blur(0); } 18% { background:rgba(0,8,5,0.84); backdrop-filter:blur(8px); } 100% { background:#000; backdrop-filter:blur(8px); } }
  .pg-gline { position:absolute; left:0; right:0; height:2px; top:0; background:linear-gradient(90deg, transparent, var(--g), var(--cy), var(--g), transparent);
    box-shadow:0 0 24px var(--g), 0 0 80px rgba(53,240,154,0.6); animation:pg-gscan .9s cubic-bezier(.6,0,.3,1) both; }
  @keyframes pg-gscan { from { top:0; opacity:1; } 85% { opacity:1; } to { top:100%; opacity:0; } }
  .pg-gtext { text-align:center; animation:pg-gpop 1.5s cubic-bezier(.2,.7,.2,1) both; }
  @keyframes pg-gpop { 0% { opacity:0; transform:scale(0.94); letter-spacing:0.1em; } 25% { opacity:1; transform:scale(1); }
    75% { opacity:1; } 100% { opacity:0; transform:scale(1.04); letter-spacing:0.5em; } }
  .pg-gbig { font-size:clamp(22px, 3.4vw, 44px); font-weight:800; letter-spacing:0.38em; color:var(--g); text-shadow:0 0 30px rgba(53,240,154,0.55); }
  .pg-gsub { margin-top:12px; font-size:12px; letter-spacing:0.18em; color:var(--t2); }
  .pg-ticker { flex:1; min-width:0; overflow:hidden; white-space:nowrap; text-align:center; letter-spacing:0.12em; color:var(--t3); }
  .pg-ticker b { color:var(--cy); font-weight:600; }
  .pg-ticker span { display:inline-block; animation:pg-tickin .5s ease-out both; }
  @keyframes pg-tickin { from { opacity:0; transform:translateY(6px); filter:blur(2px); } to { opacity:1; transform:none; } }

  /* ── scene effects pinned to the picture (same drift as the background) ── */
  .pg-fx { position:absolute; inset:-4%; transform-origin:62% 55%; animation:pg-drift 38s ease-in-out infinite alternate; pointer-events:none; }
  .pg-fx > div { position:absolute; width:0; height:0; }
  .pg-tower i { position:absolute; left:0; top:0; width:calc(var(--s) * 420px); height:calc(var(--s) * 300px); border-radius:50%;
    border:1.5px solid rgba(79,216,255,0.6); box-shadow:0 0 18px rgba(79,216,255,0.35), inset 0 0 18px rgba(79,216,255,0.2);
    transform:translate(-50%,-50%) scale(0); opacity:0; animation:pg-ring 4.5s cubic-bezier(.2,.6,.3,1) infinite; }
  .pg-tower i:nth-child(2) { animation-delay:1.5s; } .pg-tower i:nth-child(3) { animation-delay:3s; }
  @keyframes pg-ring { 0% { transform:translate(-50%,-50%) scale(0.05); opacity:0.95; } 100% { transform:translate(-50%,-50%) scale(1); opacity:0; } }
  .pg-tower b { position:absolute; left:0; top:0; width:calc(var(--s) * 46px); height:calc(var(--s) * 46px); border-radius:50%;
    transform:translate(-50%,-50%); background:radial-gradient(circle, rgba(255,70,60,0.95) 0%, rgba(255,40,40,0.45) 30%, rgba(255,0,0,0) 70%);
    animation:pg-beacon 1.8s ease-in-out infinite; mix-blend-mode:screen; }
  @keyframes pg-beacon { 0%,100% { opacity:0.35; transform:translate(-50%,-50%) scale(0.8); } 50% { opacity:1; transform:translate(-50%,-50%) scale(1.25); } }
  .pg-tower.sending i { border-color:rgba(79,216,255,0.95); animation-duration:1.1s; }
  .pg-tower.sending i:nth-child(2) { animation-delay:0.36s; } .pg-tower.sending i:nth-child(3) { animation-delay:0.72s; }
  .pg-tower.granted i { border-color:rgba(53,240,154,0.95); box-shadow:0 0 30px rgba(53,240,154,0.6); animation-duration:0.9s; }
  .pg-tower.granted b { background:radial-gradient(circle, rgba(120,255,190,1) 0%, rgba(53,240,154,0.5) 35%, transparent 70%); }
  .pg-tower.denied i { border-color:rgba(255,90,90,0.95); box-shadow:0 0 30px rgba(255,80,80,0.55); animation-duration:0.9s; }
  .pg-flare i { position:absolute; left:0; top:0; width:calc(var(--s) * 120px); height:calc(var(--s) * 120px); border-radius:50%;
    transform:translate(-50%,-50%); mix-blend-mode:screen; animation:pg-flick 3.2s ease-in-out infinite;
    background:radial-gradient(circle, rgba(255,250,235,0.95) 0%, rgba(255,232,180,0.45) 18%, rgba(255,220,160,0.12) 45%, transparent 70%); }
  .pg-flare i::before { content:""; position:absolute; left:50%; top:50%; width:calc(var(--s) * 700px); height:calc(var(--s) * 3px); min-height:1px;
    transform:translate(-50%,-50%); background:linear-gradient(90deg, transparent, rgba(140,200,255,0.55) 30%, rgba(235,248,255,0.95) 50%, rgba(140,200,255,0.55) 70%, transparent); filter:blur(0.6px); }
  .pg-flare i::after { content:""; position:absolute; left:50%; top:50%; width:calc(var(--s) * 340px); height:calc(var(--s) * 26px);
    transform:translate(-50%,-50%); border-radius:50%; background:radial-gradient(closest-side, rgba(120,190,255,0.22), transparent); }
  .pg-flare.r i { animation-delay:1.1s; }
  @keyframes pg-flick { 0%,100% { opacity:0.82; } 40% { opacity:1; } 55% { opacity:0.9; } 70% { opacity:1; } }
  .pg-sig { }
  .pg-sig::before { content:""; position:absolute; left:0; top:0; width:calc(var(--s) * 70px); height:calc(var(--s) * 70px); border-radius:50%;
    transform:translate(-50%,-50%); background:radial-gradient(circle, rgba(255,60,50,0.7), rgba(255,0,0,0) 70%); mix-blend-mode:screen;
    animation:pg-breathe 4s ease-in-out infinite; }
  .pg-mist { position:absolute; left:-25%; right:-25%; top:50%; height:34%; mix-blend-mode:screen; filter:blur(14px); pointer-events:none;
    background:radial-gradient(38% 55% at 18% 60%, rgba(190,225,215,0.13), transparent 70%),
      radial-gradient(30% 50% at 52% 48%, rgba(190,225,215,0.09), transparent 70%),
      radial-gradient(34% 60% at 86% 64%, rgba(190,225,215,0.12), transparent 70%);
    animation:pg-mist 44s ease-in-out infinite alternate; }
  .pg-mist.b { top:60%; height:28%; opacity:0.8; animation-duration:63s; animation-direction:alternate-reverse; }
  @keyframes pg-mist { from { transform:translateX(-7%); } to { transform:translateX(7%); } }

  /* uplink: card → tower while signing in */
  .pg-uplink { position:fixed; inset:0; width:100%; height:100%; z-index:5; pointer-events:none; overflow:visible; }
  .pg-uplink path { fill:none; stroke-linecap:round; }
  .pg-uplink .trail { stroke:url(#pgUp); stroke-width:1.6; stroke-dasharray:100; stroke-dashoffset:100; opacity:0.85;
    animation:pg-draw .55s cubic-bezier(.4,0,.2,1) forwards; filter:drop-shadow(0 0 6px rgba(79,216,255,0.8)); }
  .pg-uplink .pulse { stroke:#eaffff; stroke-width:4; stroke-dasharray:4 96; stroke-dashoffset:100;
    animation:pg-flow .8s linear .2s infinite; filter:drop-shadow(0 0 10px #4fd8ff) drop-shadow(0 0 20px #4fd8ff); }
  .pg-uplink.granted .trail { stroke:#35f09a; filter:drop-shadow(0 0 8px rgba(53,240,154,0.9)); }
  .pg-uplink.granted .pulse { stroke:#d9ffee; filter:drop-shadow(0 0 12px #35f09a); }
  .pg-uplink.denied .trail { stroke:#ff6b6b; filter:drop-shadow(0 0 8px rgba(255,107,107,0.9)); animation:pg-draw .3s forwards, pg-fadeout .9s ease-in .4s forwards; }
  .pg-uplink.denied .pulse { display:none; }
  @keyframes pg-draw { to { stroke-dashoffset:0; } }
  @keyframes pg-flow { from { stroke-dashoffset:100; } to { stroke-dashoffset:0; } }
  @keyframes pg-fadeout { to { opacity:0; } }

  /* sign-in state line, welcome back */
  .pg-state { display:flex; align-items:center; justify-content:center; gap:8px; margin-top:12px; font-size:9.5px; font-weight:700;
    letter-spacing:0.22em; animation:pg-rise .25s ease-out; }
  .pg-state.sending { color:var(--cy); } .pg-state.granted { color:var(--g); } .pg-state.denied { color:#ff8a8a; }
  .pg-state.sending::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--cy); box-shadow:0 0 10px var(--cy);
    animation:pg-blink .5s steps(2) infinite; }
  @keyframes pg-blink { 50% { opacity:0.2; } }
  .pg-me { display:flex; align-items:center; gap:12px; padding:10px 12px; margin-bottom:16px; border-radius:11px;
    border:1px solid rgba(53,240,154,0.22); background:linear-gradient(135deg, rgba(53,240,154,0.08), rgba(79,216,255,0.05)); animation:pg-rise .4s ease-out; }
  .pg-avatar { width:38px; height:38px; flex-shrink:0; border-radius:50%; display:flex; align-items:center; justify-content:center;
    font-size:13px; font-weight:800; letter-spacing:0.04em; color:#021208; background:linear-gradient(135deg, #5cf7b0, #4fd8ff);
    box-shadow:0 0 0 3px rgba(53,240,154,0.15), 0 0 18px rgba(53,240,154,0.35); }
  .pg-me-k { font-size:8.5px; letter-spacing:0.22em; color:var(--t3); }
  .pg-me-n { font-size:12.5px; font-weight:800; color:var(--t); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pg-me .pg-link { margin-left:auto; font-size:9.5px; white-space:nowrap; }

  /* ── smaller screens ──────────────────────────────────────── */
  @media (max-width: 980px) {
    .pg-ticker { display:none; }
    .pg-stage { grid-template-columns:minmax(0,1fr); gap:28px; padding:10vh 20px 12vh; justify-items:center; }
    .pg-hero { text-align:center; }
    .pg-hero h1 { font-size:clamp(54px, 18vw, 110px); margin-top:16px; }
    .pg-rule, .pg-tdma { margin-left:auto; margin-right:auto; }
    .pg-chips { justify-content:center; }
    .pg-verbs { display:none; }
    .pg-cardwrap { width:min(430px, 100%); }
  }
  @media (max-width: 520px) {
    .pg-row2 { grid-template-columns:1fr; }
    .pg-tdma, .pg-chips, .pg-botbar span.hide-sm, .pg-topbar .hide-sm, .pg-ticker { display:none; }
    .pg-card { padding:24px 20px 18px; }
    .pg-hero h2 { letter-spacing:0.22em; line-height:1.6; }
    .pg-lock { display:none; }
  }
  @media (max-height: 700px) and (min-width: 981px) { .pg-tdma { display:none; } .pg-hero h1 { font-size:clamp(56px, 8vw, 120px); } }
  @media (prefers-reduced-motion: reduce) {
    .pg-root *, .pg-root *::before, .pg-root *::after { animation:none !important; transition:none !important; }
    .pg-bar { height:7vh; }
  }
`;

function isLightTheme() {
  try { return localStorage.getItem("kavach-theme") === "light"; } catch (_) { return false; }
}

function Field({ label, type, ...props }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const pw = type === "password";
  const capsCheck = e => { if (pw && e.getModifierState) setCaps(e.getModifierState("CapsLock")); };
  return (
    <label className="pg-field">
      <span>{label}{caps && <em>⇪ CAPS LOCK IS ON</em>}</span>
      <div className="pg-inwrap">
        <input {...props} type={pw && show ? "text" : type} className={pw ? "pw" : undefined}
          onKeyUp={capsCheck} onKeyDown={capsCheck} onBlur={() => setCaps(false)} />
        {pw && (
          <button type="button" className="pg-eye" tabIndex={-1} onClick={() => setShow(s => !s)}
            title={show ? "Hide password" : "Show password"} aria-label={show ? "Hide password" : "Show password"}>
            {show ? "◉" : "◎"}
          </button>
        )}
      </div>
    </label>
  );
}

/** Live TDMA epoch: ticks on the real 2-second boundaries of the clock (like the PINJ transmitter). */
function useEpoch() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let raf, last = 0;
    const loop = t => {
      if (t - last > 90) { last = t; setNow(Date.now()); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return now;
}

function TdmaStrip() {
  const now = useEpoch();
  const epoch = Math.floor(now / 2000);
  const phase = (now % 2000) / 2000;
  const slot = Math.floor(phase * 20);
  const ist = new Date(now + 5.5 * 3600 * 1000).toISOString().slice(11, 19);
  return (
    <div className="pg-tdma" aria-hidden="true">
      <div className="pg-tdma-head"><span>TDMA EPOCH <b>#{String(epoch % 100000).padStart(5, "0")}</b></span><span>IST <b>{ist}</b></span></div>
      <div className="pg-slots">
        {Array.from({ length: 20 }, (_, i) => <div key={i} className={"pg-slot" + (i === slot ? " on" : i < slot ? " done" : "")} />)}
      </div>
    </div>
  );
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Text that starts as scrambled hex and "decodes" letter by letter into the real words. */
const HEX = "0123456789ABCDEF";
function DecodeText({ text, delay = 0, dur = 1000 }) {
  const [out, setOut] = useState(() => prefersReducedMotion() ? text
    : text.split("").map(c => (/[A-Za-z0-9]/.test(c) ? HEX[Math.floor(Math.random() * 16)] : c)).join(""));
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const t0 = performance.now() + delay;
    const order = text.split("").map((_, i) => i / text.length + Math.random() * 0.18);
    let raf, last = 0;
    const step = now => {
      const k = (now - t0) / dur;
      if (k >= 1.2) { setOut(text); return; }
      raf = requestAnimationFrame(step);
      if (now - last < 55) return;
      last = now;
      setOut(text.split("").map((c, i) => (!/[A-Za-z0-9]/.test(c) || k > order[i]) ? c : HEX[Math.floor(Math.random() * 16)]).join(""));
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <span aria-label={text}>{out}</span>;
}

/** Twinkling stars and the odd shooting star over the night sky (canvas, ~30 fps, paused when hidden). */
function Starfield() {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || prefersReducedMotion()) return undefined;
    const ctx = cv.getContext("2d");
    let w = 0, h = 0, stars = [], shoot = null, nextShoot = performance.now() + 3500, raf, last = 0;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.round((w * h) / 11000) }, () => ({
        x: Math.random() * w, y: Math.pow(Math.random(), 1.5) * h * 0.36,
        r: Math.random() * 1.05 + 0.25, p: Math.random() * 6.283, s: 0.5 + Math.random() * 1.9,
      }));
    };
    size();
    window.addEventListener("resize", size);
    const draw = t => {
      raf = requestAnimationFrame(draw);
      if (t - last < 33 || document.hidden) return;
      last = t;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#eafff5";
      for (const st of stars) {
        ctx.globalAlpha = 0.15 + 0.7 * (0.5 + 0.5 * Math.sin(st.p + (t / 1000) * st.s));
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.283); ctx.fill();
      }
      if (!shoot && t > nextShoot) {
        shoot = { x: w * (0.35 + Math.random() * 0.6), y: h * (0.03 + Math.random() * 0.16), vx: -(8 + Math.random() * 6), vy: 2.4 + Math.random() * 1.6, life: 0 };
      }
      if (shoot) {
        shoot.life += 1; shoot.x += shoot.vx; shoot.y += shoot.vy;
        const tx = shoot.x - shoot.vx * 12, ty = shoot.y - shoot.vy * 12;
        const g = ctx.createLinearGradient(shoot.x, shoot.y, tx, ty);
        g.addColorStop(0, "rgba(225,255,242,0.95)"); g.addColorStop(1, "rgba(225,255,242,0)");
        ctx.globalAlpha = Math.max(0, 1 - shoot.life / 40);
        ctx.strokeStyle = g; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(tx, ty); ctx.stroke();
        if (shoot.life > 40) { shoot = null; nextShoot = t + 6000 + Math.random() * 9000; }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); };
  }, []);
  return <canvas ref={ref} className="pg-stars" />;
}

/** A frame of hex on every 2 s epoch, in the bottom strip (decorative — not real radio traffic). */
function PacketTicker() {
  const now = useEpoch();
  const epoch = Math.floor(now / 2000);
  let seed = epoch * 2654435761 >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed >>> 24; };
  const bytes = Array.from({ length: 18 }, () => rnd().toString(16).toUpperCase().padStart(2, "0")).join(" ");
  return (
    <div className="pg-ticker" aria-hidden="true">
      <span key={epoch}>EPOCH {epoch % 100000} ▸ <b>F1 A5 C3</b> {bytes}</span>
    </div>
  );
}

/* Points in kavach-bg-v3.webp (1671 × 941), as fractions of the picture — found by scanning its pixels. */
const BG_W = 1671, BG_H = 941;
const BG_ANCHORS = { tower: [0.2809, 0.2221], headL: [0.4598, 0.5687], headR: [0.5462, 0.578], signal: [0.0246, 0.4731] };

/** Effects pinned to the picture (tower radio rings, headlight flares, signal glow). Same box + drift as .pg-bg. */
function SceneFX({ phase, towerRef }) {
  const ref = useRef(null);
  const [geo, setGeo] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const calc = () => {                                 // background-size:cover, background-position:center 62%
      const cw = el.clientWidth, ch = el.clientHeight;
      const sc = Math.max(cw / BG_W, ch / BG_H);
      const w = BG_W * sc, h = BG_H * sc;
      setGeo({ sc, w, h, x0: (cw - w) * 0.5, y0: (ch - h) * 0.62 });
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    window.addEventListener("resize", calc);
    const late = setTimeout(calc, 600);                  // after fonts / first layout settle
    return () => { ro.disconnect(); window.removeEventListener("resize", calc); clearTimeout(late); };
  }, []);
  const at = k => geo ? { left: geo.x0 + BG_ANCHORS[k][0] * geo.w, top: geo.y0 + BG_ANCHORS[k][1] * geo.h, "--s": geo.sc.toFixed(3) }
                      : { display: "none" };
  return (
    <div className="pg-fx" ref={ref}>
      <div className={"pg-tower " + phase} style={at("tower")} ref={towerRef}><i /><i /><i /><b /></div>
      <div className="pg-flare" style={at("headL")}><i /></div>
      <div className="pg-flare r" style={at("headR")}><i /></div>
      <div className="pg-sig" style={at("signal")} />
    </div>
  );
}

/** The glowing link from the sign-in card up to the tower while the sign-in is checked. */
function Uplink({ phase, cardRef, towerRef }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    if (phase === "idle") { setD(null); return; }
    const c = cardRef.current?.getBoundingClientRect();
    const t = towerRef.current?.getBoundingClientRect();
    if (!c || !t || !t.left) return;
    const x1 = c.left + 4, y1 = c.top + c.height * 0.66, x2 = t.left, y2 = t.top;
    const cx = (x1 + x2) / 2, cy = Math.min(y1, y2) - Math.abs(x1 - x2) * 0.22;
    setD(`M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`);
  }, [phase]);
  if (!d) return null;
  return (
    <svg className={"pg-uplink " + phase} aria-hidden="true">
      <defs>
        <linearGradient id="pgUp" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4fd8ff" stopOpacity="0.15" /><stop offset="0.6" stopColor="#4fd8ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#eaffff" />
        </linearGradient>
      </defs>
      <path className="trail" d={d} pathLength="100" />
      <path className="pulse" d={d} pathLength="100" />
    </svg>
  );
}

/** "GOOD MORNING · 08:15 IST" in the top bar. */
function Greeting() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const h = ist.getUTCHours();
  const word = h < 5 ? "GOOD NIGHT" : h < 12 ? "GOOD MORNING" : h < 17 ? "GOOD AFTERNOON" : h < 21 ? "GOOD EVENING" : "GOOD NIGHT";
  return <span>{word} · {ist.toISOString().slice(11, 16)} IST<span className="hide-sm"> · INDIAN RAILWAYS · KAVACH</span></span>;
}

const LAST_LOGIN_KEY = "pinj-last-login";                 // user name + full name of the last sign-in on this PC (no password)
const readLastLogin = () => { try { return JSON.parse(localStorage.getItem(LAST_LOGIN_KEY) || "null"); } catch (_) { return null; } };
const initials = name => String(name || "?").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

function LiveDot() {
  const now = useEpoch();
  const epoch = Math.floor(now / 2000);
  return <span key={epoch} className="pg-dot tick" />;
}

function GateShell({ subtitle, children, foot, granted = null, errKey = 0, phase = "idle" }) {
  const host = typeof window !== "undefined" ? window.location.host : "";
  const rootRef = useRef(null);
  const cardRef = useRef(null);
  const towerRef = useRef(null);
  const onMove = e => {
    const r = rootRef.current;
    if (!r || prefersReducedMotion()) return;
    r.style.setProperty("--mx", (e.clientX / window.innerWidth - 0.5).toFixed(3));
    r.style.setProperty("--my", (e.clientY / window.innerHeight - 0.5).toFixed(3));
  };
  useEffect(() => {                                   // wrong password → the card shakes
    const c = cardRef.current;
    if (!errKey || !c) return;
    c.classList.remove("shake");
    void c.offsetWidth;
    c.classList.add("shake");
  }, [errKey]);
  const spin = typeof CSS !== "undefined" && CSS.registerProperty !== undefined;   // conic edge needs @property
  return (
    <div className="pg-root" ref={rootRef} onMouseMove={onMove}>
      <style>{GATE_CSS}</style>
      <div className="pg-scene" aria-hidden="true">
        <div className="pg-par">
          <div className="pg-bg" />
          <Starfield />
          <div className="pg-mist" /><div className="pg-mist b" />
          <SceneFX phase={phase} towerRef={towerRef} />
        </div>
        <div className="pg-shade" />
        <div className="pg-glow" />
        <div className="pg-beam" />
        <div className="pg-scan" />
      </div>
      <div className="pg-bar top" aria-hidden="true" />
      <div className="pg-bar bot" aria-hidden="true" />

      <div className="pg-topbar">
        <img src={isLightTheme() ? "/nova-text-dark.png" : "/nova-text-dark.png"} alt="NOVA" draggable={false} />
        <Greeting />
      </div>
      <Uplink phase={phase} cardRef={cardRef} towerRef={towerRef} />

      <main className="pg-stage">
        <section className="pg-hero"><div className="pg-depth">
          <span className="pg-eyebrow"><LiveDot />KAVACH TEST BENCH · ONLINE</span>
          <h1><DecodeText text="PINJ" delay={1000} dur={1100} /></h1>
          <h2><DecodeText text="KAVACH PACKET INJECTOR & DECODER" delay={1500} dur={1200} /></h2>
          <div className="pg-verbs">INJECT<i>·</i>TRANSMIT<i>·</i>RECEIVE<i>·</i>DECODE<i>·</i>VISUALISE</div>
          <div className="pg-rule" />
          <div className="pg-chips">
            <span className="pg-chip">RDSO/SPN/196/2020</span>
            <span className="pg-chip">ANNEXURE-C</span>
            <span className="pg-chip">v4.0</span>
            <span className="pg-chip">MULTI-USER BENCH</span>
          </div>
          <TdmaStrip />
        </div></section>

        <div className={"pg-cardwrap" + (spin ? " spin" : "")}>
          <div className={"pg-card" + (granted ? " ok" : "")} ref={cardRef}>
            <div className="pg-brand">
              <img src="/nova-mark.png" alt="" draggable={false} />
              <div style={{ minWidth: 0 }}>
                <div className="pg-title">PINJ <span>ACCESS</span></div>
                <div className="pg-sub">{subtitle}</div>
              </div>
              <span className="pg-lock">🔒 PRIVATE</span>
            </div>
            {children}
            {foot && <div className="pg-foot">{foot}</div>}
          </div>
        </div>
      </main>

      <div className="pg-botbar">
        <span>NOVA · <b>PINJ SERVER</b> · {host}</span>
        <PacketTicker />
        <span className="hide-sm">ONE ISOLATED BENCH PER USER · SIGN-IN REQUIRED</span>
      </div>

      {granted && (
        <div className="pg-granted" role="status">
          <div className="pg-gline" />
          <div className="pg-gtext">
            <div className="pg-gbig">ACCESS GRANTED</div>
            <div className="pg-gsub">WELCOME, {String(granted.full_name || granted.username).toUpperCase()} · OPENING YOUR BENCH</div>
          </div>
        </div>
      )}
    </div>
  );
}

function useForm(init) {
  const [f, setF] = useState(init);
  const bind = k => ({ value: f[k], onChange: e => setF(s => ({ ...s, [k]: e.target.value })) });
  return [f, bind, setF];
}

function SignIn({ onDone, notice }) {
  const [mode, setMode] = useState("signin");
  const [last, setLast] = useState(readLastLogin);
  const [f, bind, setF] = useForm({ username: last?.username || "", password: "", full_name: "", password2: "", email: "", phone: "", designation: "" });
  const [msg, setMsg] = useState(notice || null);
  const [busy, setBusy] = useState(false);
  const [granted, setGranted] = useState(null);
  const [errKey, setErrKey] = useState(0);
  const [phase, setPhase] = useState("idle");          // idle | sending | granted | denied (uplink to the tower)
  const forget = () => {
    try { localStorage.removeItem(LAST_LOGIN_KEY); } catch (_) { /* blocked */ }
    setLast(null); setF(s => ({ ...s, username: "", password: "" }));
    setTimeout(() => document.querySelector(".pg-card input")?.focus(), 30);
  };
  const welcome = mode === "signin" && last && f.username === last.username;

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "signin") {
        setPhase("sending");
        const wait = new Promise(res => setTimeout(res, prefersReducedMotion() ? 0 : 700));
        const [r] = await Promise.all([
          hub("/hub/auth/login", { method: "POST", body: { username: f.username, password: f.password } })
            .catch(async err => { await wait; throw err; }),
          wait,
        ]);
        try { localStorage.setItem(LAST_LOGIN_KEY, JSON.stringify({ username: r.user.username, full_name: r.user.full_name })); } catch (_) { /* blocked */ }
        setPhase("granted");
        setGranted(r.user);                           // short "ACCESS GRANTED" moment, then into the app
        setTimeout(() => onDone(r.user), prefersReducedMotion() ? 150 : 1500);
        return;
      } else {
        if (f.password !== f.password2) throw new Error("The two passwords are not the same.");
        const r = await hub("/hub/auth/signup", { method: "POST", body: {
          username: f.username, full_name: f.full_name, password: f.password, email: f.email, phone: f.phone, designation: f.designation } });
        setMsg({ tone: "ok", text: r.message || "Account requested — ask the administrator to approve it." });
        setF(s => ({ ...s, password: "", password2: "" }));
        setMode("signin");
      }
    } catch (err) {
      setMsg({ tone: "err", text: err.message });
      setErrKey(k => k + 1);
      if (mode === "signin") { setPhase("denied"); setTimeout(() => setPhase("idle"), 1400); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateShell granted={granted} errKey={errKey} phase={phase}
      subtitle={mode !== "signin" ? "Request an account — an administrator approves it"
        : welcome ? `Welcome back, ${String(last.full_name || last.username).split(" ")[0]} — enter your password` : "Sign in to your personal test bench"}
      foot={mode === "signin"
      ? <>New here? <button className="pg-link" onClick={() => { setMode("signup"); setMsg(null); }}>Request an account</button> — the administrator approves it.</>
      : <>Already approved? <button className="pg-link" onClick={() => { setMode("signin"); setMsg(null); }}>Sign in</button></>}>
      <div className="pg-tabs">
        <button className={"pg-tab" + (mode === "signin" ? " on" : "")} onClick={() => { setMode("signin"); setMsg(null); }}>SIGN IN</button>
        <button className={"pg-tab" + (mode === "signup" ? " on" : "")} onClick={() => { setMode("signup"); setMsg(null); }}>REQUEST ACCOUNT</button>
      </div>
      {welcome && (
        <div className="pg-me">
          <span className="pg-avatar">{initials(last.full_name || last.username)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="pg-me-k">WELCOME BACK</div>
            <div className="pg-me-n">{last.full_name || last.username}</div>
          </div>
          <button type="button" className="pg-link" onClick={forget}>Not you?</button>
        </div>
      )}
      {msg && <div className={"pg-msg " + msg.tone}>{msg.text}</div>}
      <form onSubmit={submit}>
        <Field label="USER NAME" autoFocus={!welcome} autoComplete="username" required {...bind("username")}
          placeholder={mode === "signup" ? "e.g. ravi.k (lowercase)" : ""} />
        {mode === "signup" && <Field label="FULL NAME" required autoComplete="name" {...bind("full_name")} />}
        <Field label="PASSWORD" type="password" required autoComplete={mode === "signin" ? "current-password" : "new-password"}
          autoFocus={!!welcome} {...bind("password")} placeholder={mode === "signup" ? "at least 8 characters, letters + numbers" : ""} />
        {mode === "signup" && <>
          <Field label="CONFIRM PASSWORD" type="password" required autoComplete="new-password" {...bind("password2")} />
          <div className="pg-row2">
            <Field label="E-MAIL (optional)" type="email" autoComplete="email" {...bind("email")} />
            <Field label="PHONE (optional)" autoComplete="tel" {...bind("phone")} />
          </div>
          <Field label="DESIGNATION (optional)" {...bind("designation")} />
        </>}
        <button className="pg-btn" disabled={busy || !!granted}>
          {phase === "sending" ? "TRANSMITTING…" : granted ? "✓ GRANTED" : busy ? "…" : mode === "signin" ? "SIGN IN" : "REQUEST ACCOUNT"}</button>
        {mode === "signin" && phase !== "idle" && (
          <div className={"pg-state " + phase}>
            {phase === "sending" ? "UPLINK · VERIFYING CREDENTIALS" : phase === "granted" ? "✓ SESSION ESTABLISHED" : "✕ ACCESS DENIED"}
          </div>
        )}
      </form>
    </GateShell>
  );
}

function FirstAdmin({ local, onDone }) {
  const [f, bind] = useForm({ username: "", full_name: "", password: "", password2: "", email: "", phone: "", designation: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!local) {
    return (
      <GateShell subtitle="First-time set-up">
        <div className="pg-msg info">PINJ is not set up yet. The administrator account is created once, on the server PC itself
          (open <b>http://localhost:8080</b> there). After that, everybody else can request an account from here.</div>
        <button className="pg-btn" onClick={() => window.location.reload()}>↻ CHECK AGAIN</button>
      </GateShell>
    );
  }
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (f.password !== f.password2) throw new Error("The two passwords are not the same.");
      const r = await hub("/hub/auth/setup", { method: "POST", body: {
        username: f.username, full_name: f.full_name, password: f.password, email: f.email, phone: f.phone, designation: f.designation } });
      onDone(r.user);
    } catch (err) {
      setMsg({ tone: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <GateShell subtitle="First-time set-up — create the administrator"
      foot="The administrator approves new accounts, manages users and can reset passwords (Settings → Users).">
      {msg && <div className={"pg-msg " + msg.tone}>{msg.text}</div>}
      <form onSubmit={submit}>
        <div className="pg-row2">
          <Field label="USER NAME" autoFocus required autoComplete="username" {...bind("username")} />
          <Field label="FULL NAME" required autoComplete="name" {...bind("full_name")} />
        </div>
        <div className="pg-row2">
          <Field label="PASSWORD" type="password" required autoComplete="new-password" {...bind("password")} />
          <Field label="CONFIRM" type="password" required autoComplete="new-password" {...bind("password2")} />
        </div>
        <div className="pg-row2">
          <Field label="E-MAIL (optional)" type="email" {...bind("email")} />
          <Field label="PHONE (optional)" {...bind("phone")} />
        </div>
        <Field label="DESIGNATION (optional)" {...bind("designation")} />
        <button className="pg-btn" disabled={busy}>{busy ? "…" : "CREATE ADMINISTRATOR"}</button>
      </form>
    </GateShell>
  );
}

function ForcedPassword({ user, onDone }) {
  const [f, bind] = useForm({ current: "", new: "", new2: "" });
  const [msg, setMsg] = useState({ tone: "info", text: "Your password was reset by the administrator — choose your own password to continue." });
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (f.new !== f.new2) throw new Error("The two new passwords are not the same.");
      await hub("/hub/profile/password", { method: "POST", body: { current: f.current, new: f.new } });
      const r = await hub("/hub/auth/me");
      onDone(r.user);
    } catch (err) {
      setMsg({ tone: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <GateShell subtitle={`Signed in as ${user.username}`}
      foot={<button className="pg-link" onClick={signOut}>Sign out</button>}>
      {msg && <div className={"pg-msg " + msg.tone}>{msg.text}</div>}
      <form onSubmit={submit}>
        <Field label="TEMPORARY PASSWORD" type="password" autoFocus required autoComplete="current-password" {...bind("current")} />
        <Field label="NEW PASSWORD" type="password" required autoComplete="new-password" {...bind("new")} />
        <Field label="CONFIRM NEW PASSWORD" type="password" required autoComplete="new-password" {...bind("new2")} />
        <button className="pg-btn" disabled={busy}>{busy ? "…" : "SAVE PASSWORD"}</button>
      </form>
    </GateShell>
  );
}

/**
 * Shown before the app: decides between first-run set-up, sign-in, forced password change,
 * or the app itself (`render(user)` is called once the user is signed in).
 */
export function AuthGate({ render }) {
  const [state, setState] = useState(null);         // /hub/auth/state
  const [err, setErr] = useState(null);

  const apply = s => { authStore.set(s.user || null); setState(s); };
  const load = () => hub("/hub/auth/state").then(s => { apply(s); setErr(null); }).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const signedIn = u => {
    const prev = (() => { try { return localStorage.getItem(CURRENT_USER_KEY); } catch (_) { return null; } })();
    rememberUser(u.username);
    // the app's saved settings are per user and read at start-up → a fresh start for a different user
    if (prev !== u.username) { window.location.reload(); return; }
    apply({ ...state, needs_setup: false, user: u });
  };

  if (err) {
    return (
      <GateShell subtitle="Connecting to the PINJ server">
        <div className="pg-msg err">Cannot reach the PINJ server: {err}</div>
        <button className="pg-btn" onClick={load}>↻ TRY AGAIN</button>
      </GateShell>
    );
  }
  if (!state) return <div style={{ position: "fixed", inset: 0, background: "#05090a" }} />;
  if (state.needs_setup) return <FirstAdmin local={state.local} onDone={signedIn} />;
  if (!state.user) {
    rememberUser(null);
    return <SignIn onDone={signedIn} />;
  }
  if (state.user.must_change_password) return <ForcedPassword user={state.user} onDone={u => apply({ ...state, user: u })} />;

  // signed in — make sure the saved settings in this browser are the ones of this user
  let known = null;
  try { known = localStorage.getItem(CURRENT_USER_KEY); } catch (_) { /* storage blocked */ }
  if (known !== state.user.username) {
    rememberUser(state.user.username);
    window.location.reload();
    return null;
  }
  installFetchGuard();
  return render(state.user);
}

/* ═══════════════════════════════════════════════════════════════
   panels for ⚙ SETTINGS (inside the app — use the app's CSS variables)
═══════════════════════════════════════════════════════════════ */
const P = {
  section: { fontSize: 9, fontWeight: 700, letterSpacing: "0.16em", color: "var(--amber-text, var(--amber))", marginBottom: 6 },
  box: { border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-card)", overflow: "hidden" },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", fontSize: 10.5, borderTop: "1px solid var(--border)" },
  label: { width: 130, flexShrink: 0, color: "var(--text-secondary)", letterSpacing: "0.05em", fontSize: 10 },
  input: { flex: 1, minWidth: 0, padding: "6px 9px", borderRadius: 4, border: "1px solid var(--border-bright)", background: "var(--bg-input)",
    color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 11, outline: "none" },
  muted: { fontSize: 9.5, color: "var(--text-secondary)", lineHeight: 1.5 },
};

const fmtSize = n => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";
const ACTION_NAMES = {
  admin_created: "Administrator created", signup: "Requested an account", login: "Signed in", logout: "Signed out",
  login_failed: "Sign-in failed", account_locked: "Account locked (wrong passwords)", password_changed: "Changed password",
  password_reset: "Reset a password", profile_updated: "Updated profile", user_approved: "Approved a user",
  user_rejected: "Rejected a user", user_disabled: "Disabled a user", user_enabled: "Enabled a user", role_changed: "Changed a role",
  bench_started: "Bench started", bench_stopped: "Bench stopped", agent_connected: "Modem agent connected",
  agent_disconnected: "Modem agent disconnected", agent_downloaded: "Downloaded the modem agent", agent_revoked: "Withdrew the agent key",
  library_file: "Loaded from library", library_changed: "Changed library folders",
  myfile_uploaded: "Uploaded to my files", myfile_removed: "Removed from my files", transmit_serial: "Serial transmit", transmit_udp: "UDP transmit",
  listen_serial: "Serial listen", stop_serial: "Serial stop", serial_settings: "Serial settings saved",
};

function Box({ title, right, children }) {
  return (
    <div>
      <div style={{ ...P.section, display: "flex", alignItems: "center", gap: 8 }}>{title}<span style={{ marginLeft: "auto" }}>{right}</span></div>
      <div style={P.box}>{children}</div>
    </div>
  );
}

function Note({ msg }) {
  if (!msg) return null;
  const c = msg.tone === "err" ? "var(--red)" : msg.tone === "ok" ? "var(--green)" : "var(--amber)";
  return <div style={{ fontSize: 10, color: c, padding: "8px 12px", borderTop: "1px solid var(--border)", lineHeight: 1.5 }}>{msg.text}</div>;
}

function Chip({ text, color }) {
  return <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", padding: "2px 7px", borderRadius: 9,
    border: "1px solid " + color, color, whiteSpace: "nowrap" }}>{text}</span>;
}

const STATUS_COLOR = { active: "var(--green)", pending: "var(--amber)", disabled: "var(--red)", rejected: "var(--text-secondary)" };

function ActivityList({ rows, showUser }) {
  if (!rows) return <div style={{ ...P.row, ...P.muted, borderTop: "none" }}>Loading…</div>;
  if (!rows.length) return <div style={{ ...P.row, ...P.muted, borderTop: "none" }}>Nothing yet.</div>;
  return (
    <div style={{ maxHeight: 260, overflowY: "auto" }}>
      {rows.map((a, i) => (
        <div key={a.id} style={{ ...P.row, borderTop: i ? P.row.borderTop : "none", fontSize: 10, alignItems: "baseline" }}>
          <span style={{ width: 130, flexShrink: 0, color: "var(--text-secondary)" }}>{a.ts}</span>
          {showUser && <span style={{ width: 90, flexShrink: 0, color: "var(--cyan)", overflow: "hidden", textOverflow: "ellipsis" }}>{a.username}</span>}
          <span style={{ color: a.action === "login_failed" || a.action === "account_locked" ? "var(--red)" : "var(--text-primary)" }}>
            {ACTION_NAMES[a.action] || a.action}</span>
          <span style={{ color: "var(--text-secondary)", minWidth: 0, overflowWrap: "anywhere" }}>{a.detail}</span>
          {a.ip && <span style={{ marginLeft: "auto", color: "var(--text-secondary)", opacity: 0.8, flexShrink: 0 }}>{a.ip}</span>}
        </div>
      ))}
    </div>
  );
}

/** 📡 MY MODEM AGENT — the small program that connects the modem on the user's own PC to their bench. */
function AgentBox() {
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = () => hub("/hub/agent/status").then(setSt).catch(() => { });
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  const download = () => {
    if (st?.key_created && !window.confirm("Download a new copy of the PINJ Modem Agent?\n\nIt gets a new personal key — "
      + "an agent you downloaded before stops working (close it and use the new one).")) return;
    window.location.href = "/hub/agent/download";
    setMsg({ tone: "ok", text: "Downloading PINJ_Agent_….zip — unzip it on the PC with the modem and double-click PINJ_AGENT.bat." });
    setTimeout(load, 1500);
  };
  const revoke = async () => {
    if (!window.confirm("Disconnect and withdraw your PINJ Modem Agent key? The agent stops at once.")) return;
    try { await hub("/hub/agent/revoke", { method: "POST" }); setMsg({ tone: "ok", text: "Agent key withdrawn." }); load(); }
    catch (e) { setMsg({ tone: "err", text: e.message }); }
  };
  return (
    <Box title="📡 MY MODEM AGENT" right={st && <Chip text={st.online ? "CONNECTED" : "NOT RUNNING"} color={st.online ? "var(--green)" : "var(--text-secondary)"} />}>
      <div style={{ ...P.row, borderTop: "none", ...P.muted, display: "block" }}>
        Runs on <b>your</b> PC, next to your radio modem, and connects it to your PINJ bench — your modem then appears in
        SVK SIM → SERIAL RADIO MODEM as <b style={{ color: "var(--cyan)" }}>AGENT:COMx</b>. Your test logs are also saved on that PC.
        Needs Python 3.9+ on that PC (python.org). Closing the agent window releases the modem (PTT off).
      </div>
      {st?.online ? <>
        <div style={P.row}><span style={P.label}>Running on</span><b style={{ color: "var(--green)" }}>{st.hostname}</b>
          <span style={P.muted}>· {st.ip} · since {st.connected_at} · agent {st.version}</span></div>
        <div style={P.row}><span style={P.label}>Modem ports</span>
          {(st.ports || []).length ? st.ports.map(p => p.device + (p.description ? ` (${p.description})` : "")).join(" · ")
            : <span style={{ color: "var(--amber)" }}>no COM port found on that PC — plug in the USB-serial cable</span>}</div>
        <div style={P.row}><span style={P.label}>Logs saved in</span><span style={{ overflowWrap: "anywhere" }}>{st.log_dir}</span></div>
      </> : (
        <div style={P.row}><span style={P.label}>Status</span>
          <span style={P.muted}>{st?.key_created ? `downloaded ${st.key_created}` + (st.last_seen ? ` · last connected ${st.last_seen} from ${st.last_hostname || "?"}` : " · not connected yet")
            : "not downloaded yet"}</span></div>
      )}
      <div style={{ ...P.row, justifyContent: "flex-end", gap: 8 }}>
        {st?.key_created && <button className="sa-btn" style={{ color: "var(--red)" }} onClick={revoke}>✕ WITHDRAW KEY</button>}
        <button className="sa-btn primary" onClick={download}>⬇ DOWNLOAD MODEM AGENT</button>
      </div>
      <Note msg={msg} />
    </Box>
  );
}

export function ProfilePanel() {
  const user = useCurrentUser();
  const [f, setF] = useState(() => ({ full_name: user?.full_name || "", email: user?.email || "", phone: user?.phone || "", designation: user?.designation || "" }));
  const [pw, setPw] = useState({ current: "", new: "", new2: "" });
  const [msg, setMsg] = useState(null);
  const [pwMsg, setPwMsg] = useState(null);
  const [logs, setLogs] = useState(null);
  const [activity, setActivity] = useState(null);

  useEffect(() => {
    hub("/hub/profile/logs").then(r => setLogs(r.logs)).catch(() => setLogs([]));
    hub("/hub/profile/activity").then(r => setActivity(r.activity)).catch(() => setActivity([]));
  }, []);
  if (!user) return null;

  const save = async () => {
    setMsg(null);
    try {
      const r = await hub("/hub/profile", { method: "PUT", body: f });
      authStore.set(r.user);
      setMsg({ tone: "ok", text: "Profile saved." });
    } catch (e) { setMsg({ tone: "err", text: e.message }); }
  };
  const changePw = async () => {
    setPwMsg(null);
    try {
      if (pw.new !== pw.new2) throw new Error("The two new passwords are not the same.");
      await hub("/hub/profile/password", { method: "POST", body: { current: pw.current, new: pw.new } });
      setPw({ current: "", new: "", new2: "" });
      setPwMsg({ tone: "ok", text: "Password changed. You stay signed in here; other PCs were signed out." });
    } catch (e) { setPwMsg({ tone: "err", text: e.message }); }
  };
  const inp = (k, extra = {}) => <input style={P.input} value={f[k]} onChange={e => setF(s => ({ ...s, [k]: e.target.value }))} {...extra} />;
  const pinp = k => <input type="password" style={P.input} value={pw[k]} autoComplete={k === "current" ? "current-password" : "new-password"}
    onChange={e => setPw(s => ({ ...s, [k]: e.target.value }))} />;

  return (
    <>
      <Box title="👤 MY ACCOUNT" right={<span style={{ display: "inline-flex", gap: 6 }}>
        <Chip text={user.role.toUpperCase()} color={user.role === "admin" ? "var(--cyan)" : "var(--green)"} />
        <Chip text={user.status.toUpperCase()} color={STATUS_COLOR[user.status]} /></span>}>
        <div style={{ ...P.row, borderTop: "none" }}><span style={P.label}>User name</span><b style={{ color: "var(--green)" }}>{user.username}</b></div>
        <div style={P.row}><span style={P.label}>Account created</span>{user.created_at || "—"}{user.approved_by && <span style={P.muted}>· approved by {user.approved_by}</span>}</div>
        <div style={P.row}><span style={P.label}>Last sign-in</span>{user.last_login_at || "—"}{user.last_login_ip && <span style={P.muted}>· from {user.last_login_ip}</span>}</div>
      </Box>

      <AgentBox />

      <Box title="✎ PROFILE">
        <div style={{ ...P.row, borderTop: "none" }}><span style={P.label}>Full name</span>{inp("full_name", { autoComplete: "name" })}</div>
        <div style={P.row}><span style={P.label}>E-mail</span>{inp("email", { type: "email", autoComplete: "email" })}</div>
        <div style={P.row}><span style={P.label}>Phone</span>{inp("phone", { autoComplete: "tel" })}</div>
        <div style={P.row}><span style={P.label}>Designation</span>{inp("designation")}</div>
        <div style={{ ...P.row, justifyContent: "flex-end" }}><button className="sa-btn primary" onClick={save}>✓ SAVE PROFILE</button></div>
        <Note msg={msg} />
      </Box>

      <Box title="🔑 PASSWORD">
        <div style={{ ...P.row, borderTop: "none" }}><span style={P.label}>Current password</span>{pinp("current")}</div>
        <div style={P.row}><span style={P.label}>New password</span>{pinp("new")}</div>
        <div style={P.row}><span style={P.label}>Confirm new</span>{pinp("new2")}</div>
        <div style={{ ...P.row, justifyContent: "space-between" }}>
          <span style={P.muted}>At least 8 characters, with letters and numbers (or symbols).</span>
          <button className="sa-btn primary" onClick={changePw} disabled={!pw.current || !pw.new}>✓ CHANGE PASSWORD</button>
        </div>
        <Note msg={pwMsg} />
      </Box>

      <Box title="🗎 MY TEST LOGS" right={<span style={{ ...P.muted, letterSpacing: 0, fontWeight: 400 }}>kept on the PINJ server</span>}>
        {!logs ? <div style={{ ...P.row, ...P.muted, borderTop: "none" }}>Loading…</div>
          : !logs.length ? <div style={{ ...P.row, ...P.muted, borderTop: "none" }}>No logs yet — every serial / UDP TRANSMIT writes one (with the Modem Agent running, a copy is also saved on your PC).</div>
          : <div style={{ maxHeight: 220, overflowY: "auto" }}>{logs.map((l, i) => (
            <div key={l.name} style={{ ...P.row, borderTop: i ? P.row.borderTop : "none", fontSize: 10 }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{l.name}</span>
              <span style={{ color: "var(--text-secondary)", flexShrink: 0 }}>{l.modified}</span>
              <span style={{ color: "var(--text-secondary)", width: 64, textAlign: "right", flexShrink: 0 }}>{fmtSize(l.size)}</span>
              <a className="sa-btn" href={"/hub/profile/logs/" + encodeURIComponent(l.name)} download style={{ textDecoration: "none" }}>⬇</a>
            </div>))}</div>}
      </Box>

      <Box title="⏱ MY ACTIVITY"><ActivityList rows={activity} /></Box>
    </>
  );
}

export function UsersPanel() {
  const me = useCurrentUser();
  const [data, setData] = useState(null);
  const [activity, setActivity] = useState(null);
  const [msg, setMsg] = useState(null);
  const [temp, setTemp] = useState(null);           // { username, temp_password } — shown once
  const [busy, setBusy] = useState(null);

  const load = () => {
    hub("/hub/users").then(setData).catch(e => setMsg({ tone: "err", text: e.message }));
    hub("/hub/audit?limit=150").then(r => setActivity(r.activity)).catch(() => setActivity([]));
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  const act = async (u, what, body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(u.id + what); setMsg(null);
    try {
      const r = await hub(`/hub/users/${u.id}/${what}`, { method: "POST", body });
      if (what === "reset_password") setTemp(r);
      else setMsg({ tone: "ok", text: `${u.username}: done.` });
      load();
    } catch (e) { setMsg({ tone: "err", text: e.message }); }
    finally { setBusy(null); }
  };

  const btn = (u, what, label, opts = {}) => (
    <button className={"sa-btn" + (opts.primary ? " primary" : "")} disabled={busy === u.id + what}
      onClick={() => act(u, what, opts.body, opts.confirm)} style={opts.danger ? { color: "var(--red)" } : undefined}>{label}</button>
  );

  return (
    <>
      {temp && (
        <div style={{ border: "1px solid var(--amber)", borderRadius: 6, padding: "10px 12px", background: "var(--bg-card)", fontSize: 10.5, lineHeight: 1.6 }}>
          <div style={{ color: "var(--amber)", fontWeight: 800, letterSpacing: "0.08em" }}>TEMPORARY PASSWORD FOR {temp.username.toUpperCase()}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0" }}>
            <code style={{ fontSize: 15, letterSpacing: "0.12em", color: "var(--text-primary)", userSelect: "all" }}>{temp.temp_password}</code>
            <button className="sa-btn" onClick={() => navigator.clipboard?.writeText(temp.temp_password)}>⧉ COPY</button>
            <button className="sa-btn" style={{ marginLeft: "auto" }} onClick={() => setTemp(null)}>✕ HIDE</button>
          </div>
          <div style={P.muted}>Shown only now. Give it to {temp.username} personally — they must choose a new password at the next sign-in.</div>
        </div>
      )}

      <Box title={"👥 USERS" + (data ? ` · ${data.users.length}` : "")} right={<button className="sa-btn" onClick={load}>↻ REFRESH</button>}>
        {!data ? <div style={{ ...P.row, ...P.muted, borderTop: "none" }}>Loading…</div> : data.users.map((u, i) => (
          <div key={u.id} style={{ ...P.row, borderTop: i ? P.row.borderTop : "none", flexWrap: "wrap", alignItems: "flex-start",
            background: u.status === "pending" ? "rgba(255,195,92,0.06)" : undefined }}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <b style={{ color: "var(--text-primary)", fontSize: 11 }}>{u.full_name}</b>
                <span style={{ color: "var(--cyan)" }}>@{u.username}</span>
                <Chip text={u.status.toUpperCase()} color={STATUS_COLOR[u.status]} />
                {u.role === "admin" && <Chip text="ADMIN" color="var(--cyan)" />}
                {u.bench && <Chip text={"BENCH ON" + (u.bench.ws ? " · " + u.bench.ws + " LIVE" : "")} color="var(--green)" />}
                {u.agent && <Chip text={"📡 AGENT · " + u.agent.hostname} color="var(--cyan)" />}
                {u.id === me?.id && <span style={P.muted}>(you)</span>}
              </div>
              <div style={{ ...P.muted, marginTop: 3 }}>
                {[u.designation, u.email, u.phone].filter(Boolean).join(" · ") || "no contact details"}
              </div>
              <div style={{ ...P.muted, opacity: 0.8 }}>
                joined {u.created_at || "—"} · last sign-in {u.last_login_at || "never"}{u.last_login_ip ? " from " + u.last_login_ip : ""} · {u.logs} log{u.logs === 1 ? "" : "s"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {u.status === "pending" && <>{btn(u, "approve", "✓ APPROVE", { primary: true })}{btn(u, "reject", "✕ REJECT", { danger: true })}</>}
              {u.status === "rejected" && btn(u, "approve", "✓ APPROVE")}
              {u.status === "active" && u.id !== me?.id && btn(u, "disable", "⏸ DISABLE", { danger: true, confirm: `Disable ${u.username}? They are signed out at once and their bench stops.` })}
              {u.status === "disabled" && btn(u, "enable", "▶ ENABLE", { primary: true })}
              {u.status === "active" && (u.role === "admin"
                ? u.id !== me?.id && btn(u, "role", "→ TESTER", { body: { role: "tester" }, confirm: `Remove administrator rights from ${u.username}?` })
                : btn(u, "role", "→ ADMIN", { body: { role: "admin" }, confirm: `Make ${u.username} an administrator? They can then manage every user.` }))}
              {u.status !== "pending" && u.id !== me?.id && btn(u, "reset_password", "🔑 RESET PW", { confirm: `Give ${u.username} a new temporary password? Their current password stops working.` })}
              {u.bench && btn(u, "stop_bench", "■ STOP BENCH", { confirm: `Stop ${u.username}'s bench? Any running transmit / listen ends.` })}
            </div>
          </div>
        ))}
        <Note msg={msg} />
      </Box>

      {data && <div style={P.muted}>Accounts are stored in: <span style={{ color: "var(--text-primary)" }}>{data.storage}</span></div>}

      <Box title="⏱ ACTIVITY — ALL USERS"><ActivityList rows={activity} showUser /></Box>
    </>
  );
}

/** Small "👤 name · ⏻" chip for pages without the ⚙ menu (/simulator, /live). */
export function UserChip() {
  const u = useCurrentUser();
  if (!u) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 4px 3px 9px", borderRadius: 14,
      border: "1px solid var(--border, rgba(128,128,128,0.35))", fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}
      title={`${u.full_name} (@${u.username}, ${u.role})`}>
      👤 {u.username}
      <button onClick={signOut} title="Sign out" style={{ border: "none", background: "transparent", color: "var(--red, #ff6b6b)",
        cursor: "pointer", fontSize: 12, padding: "0 4px" }}>⏻</button>
    </span>
  );
}
