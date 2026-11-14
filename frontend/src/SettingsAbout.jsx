/**
 * SettingsAbout.jsx — project-wide ⚙ SETTINGS and ⓘ ABOUT (top bar, every page).
 *
 *  • appSettingsStore  — PINJ home / decoder / LIVE preferences  (localStorage "pinj-app-settings")
 *  • svkSettingsStore  — SVK SIM preferences                     (localStorage "svk-sim-settings")
 *  • svkSessionStore   — what SVK SIM has loaded / is sending (in memory, for ⓘ ABOUT)
 *
 * All of these are UI preferences of this browser only: nothing is sent to the
 * backend and nothing here touches packet encoding / decoding.
 */
import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { API_BASE, WS_BASE } from "./apiBase";
import { LOCO_STYLES, LocoStylePreview } from "./LocoStyles";
import { CURRENT_USER_KEY, ProfilePanel, UsersPanel, useCurrentUser, signOut, hub } from "./Auth";
import { LibraryAdminPanel } from "./Library";

/* ═══════════════════════════════════════════════════════════════
   STORES
═══════════════════════════════════════════════════════════════ */
/* Multi-user PINJ: saved settings are kept per signed-in user ("u:<user>:<key>"). A user's
   first start in this browser begins from the browser's older (shared) settings, if any. */
function userKey(key) {
  let u = null;
  try { u = localStorage.getItem(CURRENT_USER_KEY); } catch (_) { /* storage blocked */ }
  return u ? `u:${u}:${key}` : key;
}

function createStore(baseKey, defaults) {
  const key = baseKey ? userKey(baseKey) : null;
  const read = () => {
    if (!key) return { ...defaults };
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? localStorage.getItem(baseKey) ?? "null");
      return { ...defaults, ...(saved && typeof saved === "object" ? saved : {}) };
    } catch (_) {
      return { ...defaults };
    }
  };
  let value = read();
  const subs = new Set();
  const commit = next => {
    value = next;
    if (key) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage blocked */ } }
    subs.forEach(fn => fn());
  };
  return {
    defaults,
    get: () => value,
    set: patch => commit({ ...value, ...(typeof patch === "function" ? patch(value) : patch) }),
    reset: () => commit({ ...defaults }),
    subscribe: fn => { subs.add(fn); return () => subs.delete(fn); },
  };
}

export const appSettingsStore = createStore("pinj-app-settings", {
  startPage:        "pinj",   // pinj | live | svksim — page shown when the app opens
  bootSound:        false,    // start-up chime (off by default)
  homeAnimation:    true,     // PINJ home scene animation (off = still picture)
  decoderInputOpen: false,    // INPUT JSON + LOG / CRC VERIFY panels open on start
  decoderTimeline:  false,    // TDMA timeline shown under a decoded packet
  liveAutoScroll:   true,     // LIVE feed follows the newest packet
  liveAlerts:       true,     // SOS / emergency / brake pop-up alerts on LIVE
  liveAlertSecs:    8,        // how long an alert stays on screen
  liveMaxRows:      300,      // packets kept in the LIVE table
  liveDefaultView:  "packets",// packets | dmi | profile — LIVE view when the app opens
  dmiSmooth:        true,     // DMI + visualiser values glide between packets (off = jump at once)
  dmiTagMissM:      100,      // an expected TLI tag not reported this far past its location turns red
  liveStripOpen:    true,     // 🚆 LIVE VISUALISER shown on the LIVE page
  liveStripLabels:  true,     // loco labels (Loco Id, Length, Speed, Rfid, Abs.Loc) on the visualiser
  replaySpeed:      1,        // Packet Simulator → LOG REPLAY default speed (0 = FAST 100 ms)
  replaySkipGaps:   true,     // skip idle gaps longer than 3 s
  replayLoop:       false,    // start again at the end
});

// one-time: the start-up chime used to default to ON — turn it off once
if (!appSettingsStore.get().bootDefaultOff) appSettingsStore.set({ bootSound: false, bootDefaultOff: true });

export const svkSettingsStore = createStore("svk-sim-settings", {
  drawerOnStart:  true,          // loaders drawer open when the page opens
  drawerInTrack:  false,         // 🚆 LIVE TRACK opens with the drawer closed (full screen)
  autoHideOnTx:   false,         // close the drawer when a transmission starts
  autoShowTables: true,          // jump to ▤ STATIC DATA after a file loads
  scanlines:      true,          // faint CRT scanline texture behind the page
  defaultDestIp:  "127.0.0.1",   // UDP / HTTP destination used at start-up
  defaultRadio:   1,             // Radio1 (0xF1 SoF) or Radio2 (0xF2 SoF)
  locoStyle:      "classic",     // 🚆 LIVE TRACK loco icon (see LocoStyles.jsx)
});

export const svkSessionStore = createStore(null, {
  files: [], txState: "idle", serialTxState: "idle", serialDevice: "—", baud: null, radioId: 1, destIp: "127.0.0.1",
});

/* RFID tag table loaded in 🧩 SVK SIM (☰ LOADERS → RFID TAG TABLE) — shared with the
   📡 LIVE page (track visualiser + DMI position), kept in this browser across reloads. */
export const tagTableStore = createStore("pinj-rfid-tag-table", { fileName: "", tags: [] });

/* ═══════════════════════════════════════════════════════════════
   🔊 KAVACH ALERT SOUNDS
   Synthesised with Web Audio (no sound files).
   • Brake beeps — 🚆 LIVE TRACK, when a brake dot (NSB / FSB / EB) is marked
   • SOS buzzer  — 📡 LIVE (SOS fields / C.4.5) and 🚆 LIVE TRACK (loco
                   EMERGENCY_STATUS), a different buzzer per SOS condition
   Later Kavach sounds (horn, …) plug into the same store + engine.
═══════════════════════════════════════════════════════════════ */
export const soundSettingsStore = createStore("pinj-sound-settings", {
  enabled:         true,   // master switch for every alert sound
  volume:          0.6,    // 0 … 1
  brakeNSB:        true,   // Normal Service Brake
  brakeFSB:        true,   // Full Service Brake
  brakeEB:         true,   // Emergency Brake
  beepCount:       3,      // beeps per brake application (EB plays twice as many, two-tone)
  beepGapMs:       600,    // pause between beeps
  startDelayMs:    500,    // wait after the brake dot appears
  onlyWhenVisible: true,   // 🚆 LIVE TRACK: only while it is on screen
  sosCollision:    true,   // collision / SPAD buzzer
  sosCall:         true,   // SoS call buzzer
  sosCaution:      true,   // caution buzzer
  sosRepeat:       2,      // how many times the SOS buzzer pattern is played
  sosOnLive:       true,   // buzzer for SOS on the 📡 LIVE page
  sosOnTrack:      true,   // buzzer for loco EMERGENCY_STATUS on 🚆 LIVE TRACK
  brakeOnLive:     true,   // brake beeps for Brake_Applied on the 📡 LIVE page
  brakeOnTrack:    true,   // brake beeps for brake dots on 🚆 LIVE TRACK
  modeOnLive:      true,   // beep on the 📡 LIVE page when a loco's LOCO_MODE changes
  brakeIndication: "beep", // brake indication: "beep" (synth beeps) OR "voice" (recordings) — one at a time
  voiceVolume:     1,      // 0 … 1 (own volume — recordings are usually quieter than beeps)
  voiceOverspeed:  true,
  voiceNSB:        true,
  voiceFSB:        true,
  voiceEB:         true,
  cuesEnabled:     true,   // 🗣 route announcements (signal / turnout / PSR) on the 📡 LIVE feed
  cueVolume:       1,      // 0 … 1
  cueSignalRepeatS: 10,    // repeat Danger / Attention / Caution this often until the signal is passed (0 = once)
  cueProfileRepeatS: 10,   // repeat Approaching Turnout / PSR this often until it is entered (0 = once)
  cueDanger:       true,
  cueAttention:    true,
  cueCaution:      true,
  cueProceed:      true,
  cueApproachTO:   true,
  cueEnterTO:      true,
  cueApproachPSR:  true,
  cueEnterPSR:     true,
});

/* Tone of each brake type — higher and more urgent for a heavier brake.
   prio: a higher alert replaces a lower one that is still sounding. */
export const BRAKE_SOUNDS = {
  2: { key: "brakeNSB", prio: 2, short: "NSB", name: "Normal Service Brake", freqs: [880],        dur: 0.18 },
  3: { key: "brakeFSB", prio: 3, short: "FSB", name: "Full Service Brake",   freqs: [1175],       dur: 0.22 },
  4: { key: "brakeEB",  prio: 4, short: "EB",  name: "Emergency Brake",      freqs: [1400, 1000], dur: 0.15, urgent: true },
};

/* SOS buzzer per condition class (all above every brake beep). */
const MORSE_DOT = 0.12, MORSE_DASH = 0.36;
const morse = code => code.split("").map((c, i, a) => ({
  f: 660, d: c === "." ? MORSE_DOT : MORSE_DASH,
  g: i === a.length - 1 ? 0 : (a[i + 1] === " " || c === " " ? 0.36 : 0.12),
})).filter((_, i) => code[i] !== " ");
export const SOS_SOUNDS = {
  collision: {
    key: "sosCollision", prio: 7, short: "COLLISION", name: "Collision / SPAD",
    desc: "Head-on · rear-end · side collision / unusual stoppage · SPAD — rapid two-tone klaxon.",
    tones: Array.from({ length: 14 }, (_, i) => ({ f: i % 2 ? 720 : 960, d: 0.12, g: 0.04 })),
  },
  call: {
    key: "sosCall", prio: 6, short: "SOS", name: "SoS call",
    desc: "SoS · manual SoS button · parting SoS · station general SoS · C.4.5 emergency packet — buzzes ··· ––– ··· (Morse SOS).",
    tones: morse("... --- ..."),
  },
  caution: {
    key: "sosCaution", prio: 5, short: "CAUTION", name: "Caution",
    desc: "Roll back · foreign RFID · odometer error ≥ 120 m · shunting limit — two long low buzzes.",
    tones: [{ f: 440, d: 0.6, g: 0.35 }, { f: 440, d: 0.6, g: 0 }],
  },
};

/* Mode change (📡 LIVE): two short rising beeps — the lowest priority, so it never cuts off a
   brake beep or SOS buzzer (they replace it). */
export const MODE_SOUND = {
  key: "modeOnLive", prio: 0, short: "MODE", name: "Mode change",
  tones: [{ f: 988, d: 0.12, g: 0.06 }, { f: 1319, d: 0.16, g: 0 }],
};

/** Which SOS buzzer a field value belongs to (null = no buzzer). */
export function sosCategory(field, value) {
  const v = Number(value) || 0;
  if (field === "EMERGENCY_STATUS") return { 1: "collision", 4: "collision", 5: "collision", 2: "call", 6: "call", 3: "caution" }[v] || null;
  if (field === "DEST_LOCO_SOS")    return { 4: "collision", 5: "collision", 6: "collision", 8: "call", 1: "caution", 3: "caution", 7: "caution" }[v] || null;
  if (field === "GEN_SOS_CALL")     return v ? "call" : null;
  if (field === "C45")              return "call";             // C.4.5 emergency packet without a known code
  return null;
}

let actx = null;
function audioCtx() {
  if (!actx) {
    const C = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!C) return null;
    try { actx = new C(); } catch (_) { return null; }
  }
  if (actx.state === "suspended") actx.resume().catch(() => {});
  return actx;
}
// Browsers only allow sound after the user has interacted with the page:
// wake the audio engine on the first click / key press.
if (typeof window !== "undefined") {
  const unlock = () => {
    audioCtx();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/* 🗣 Voice-over clips for the brake indication (recorded by the user).
   Put the files in frontend/public/sounds/voice/ — any of .mp3 .wav .m4a .ogg:
     brake-overspeed · brake-nsb · brake-fsb · brake-eb                     */
export const VOICE_DIR = "/sounds/voice/";
const VOICE_EXTS = [".mp3", ".wav", ".m4a", ".ogg"];
export const VOICE_CLIPS = {
  1: { key: "voiceOverspeed", short: "OVERSPEED", name: "Over speed",           file: "brake-overspeed" },
  2: { key: "voiceNSB",       short: "NSB",       name: "Normal Service Brake", file: "brake-nsb" },
  3: { key: "voiceFSB",       short: "FSB",       name: "Full Service Brake",   file: "brake-fsb" },
  4: { key: "voiceEB",        short: "EB",        name: "Emergency Brake",      file: "brake-eb" },
};
/* 🗣 Route announcements (recorded by the user), same folder: cue-*.mp3 */
export const VOICE_CUES = {
  danger:          { key: "cueDanger",      short: "DANGER",      name: "Approaching a Red signal",          file: "cue-danger" },
  attention:       { key: "cueAttention",   short: "ATTENTION",   name: "Approaching a Double Yellow signal", file: "cue-attention" },
  caution:         { key: "cueCaution",     short: "CAUTION",     name: "Approaching a Yellow signal",       file: "cue-caution" },
  proceed:         { key: "cueProceed",     short: "PROCEED",     name: "Approaching a Green signal",        file: "cue-proceed" },
  enteredTurnout:  { key: "cueEnterTO",     short: "ENTERED TURNOUT",     name: "Entered the turnout section",  file: "cue-entered-turnout" },
  enteredPsr:      { key: "cueEnterPSR",    short: "ENTERED PSR",         name: "Entered the PSR section",      file: "cue-entered-psr" },
  approachTurnout: { key: "cueApproachTO",  short: "APPROACHING TURNOUT", name: "Approaching a turnout",        file: "cue-approaching-turnout" },
  approachPsr:     { key: "cueApproachPSR", short: "APPROACHING PSR",     name: "Approaching a PSR",            file: "cue-approaching-psr" },
};
let voiceUrls = {};                       // code → found URL, or null when missing
/** URL of the recording for a brake code (null if no file is there). */
export async function findVoiceUrl(code) {
  if (code in voiceUrls) return voiceUrls[code];
  const clip = VOICE_CLIPS[code] || VOICE_CUES[code];
  let found = null;
  if (clip) {
    for (const ext of VOICE_EXTS) {
      try {
        const r = await fetch(VOICE_DIR + clip.file + ext, { method: "HEAD", cache: "no-store" });
        // the dev server answers unknown paths with index.html — only accept real audio
        if (r.ok && (r.headers.get("content-type") || "").startsWith("audio/")) { found = VOICE_DIR + clip.file + ext; break; }
      } catch (_) { /* offline / blocked */ }
    }
  }
  voiceUrls[code] = found;
  return found;
}
/** Forget the file look-ups (after adding / replacing recordings). */
export function recheckVoiceFiles() { voiceUrls = {}; startupUrl = undefined; }

/* 🎵 Start-up sound: your recording frontend/public/sounds/startup.(mp3|wav|m4a|ogg) if it is
   there, otherwise the synthesised start-up chime. */
export const STARTUP_FILE = "/sounds/startup";
let startupUrl;                           // undefined = not looked up yet, null = no file
async function findStartupUrl() {
  if (startupUrl !== undefined) return startupUrl;
  startupUrl = null;
  for (const ext of VOICE_EXTS) {
    try {
      const r = await fetch(STARTUP_FILE + ext, { method: "HEAD", cache: "no-store" });
      // the dev server answers unknown paths with index.html — only accept real audio
      if (r.ok && (r.headers.get("content-type") || "").startsWith("audio/")) { startupUrl = STARTUP_FILE + ext; break; }
    } catch (_) { /* offline / blocked */ }
  }
  return startupUrl;
}
function playStartupChime() {
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
}
/** Play the start-up sound (⚙ Settings → 🔊 SOUND → APP SOUNDS). Returns "file" or "chime". */
export async function playStartupSound() {
  const url = await findStartupUrl();
  if (url) {
    try { await new Audio(url).play(); return "file"; } catch (_) { /* blocked / unreadable → chime */ }
  }
  playStartupChime();
  return "chime";
}

let current = null;                       // the alert now waiting / playing: { prio, nodes, audio, timer }
/** Stop whatever alert is waiting / sounding (e.g. the alert pop-up was closed). */
export function stopAlertSound() {
  if (!current) return;
  clearTimeout(current.timer);
  current.nodes.forEach(n => { try { n.stop(); } catch (_) { /* already stopped */ } });
  if (current.audio) { try { current.audio.pause(); } catch (_) { /* gone */ } }
  current = null;
}

/* Start an alert after delayMs. A higher-priority alert replaces a lower /
   equal one; a lower one never interrupts a higher one. run(me) does the
   playing and must finish with done(me). */
function startAlert(prio, delayMs, test, run) {
  if (!test && current && current.prio > prio) return false;
  stopAlertSound();
  const me = { prio, nodes: [], audio: null, timer: null };
  current = me;
  me.timer = setTimeout(() => { if (current === me) run(me); }, Math.max(0, delayMs | 0));
  return true;
}
function done(me) { if (current === me) current = null; }

/* Schedule tones { f (Hz), d (s), g (gap after, s) }; returns their length in s. */
function scheduleTones(me, tones, { wave = "square", cutoff = 3200, gain = 0.25 } = {}) {
  const ctx = audioCtx();
  if (!ctx) return 0;
  const cfg = soundSettingsStore.get();
  const master = ctx.createGain();
  master.gain.value = Math.max(0, Math.min(1, Number(cfg.volume) || 0)) * gain;
  const tone = ctx.createBiquadFilter();             // soften the raw waveform
  tone.type = "lowpass";
  tone.frequency.value = cutoff;
  tone.connect(master);
  master.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.03;
  let t = t0;
  tones.forEach(({ f, d, g }) => {
    const o = ctx.createOscillator();
    const env = ctx.createGain();
    o.type = wave;
    o.frequency.value = f;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.008);
    env.gain.setValueAtTime(1, t + Math.max(0.01, d - 0.02));
    env.gain.linearRampToValueAtTime(0, t + d);
    o.connect(env);
    env.connect(tone);
    o.start(t);
    o.stop(t + d + 0.02);
    me.nodes.push(o);
    t += d + g;
  });
  return t - ctx.currentTime;
}

function playTones(prio, tones, { wave, cutoff, gain, delayMs = 0, test = false }) {
  return startAlert(prio, delayMs, test, me => {
    const s = scheduleTones(me, tones, { wave, cutoff, gain });
    me.timer = setTimeout(() => done(me), s * 1000 + 50);
  });
}

/* Play a recording inside an alert; then() runs when it ends (or fails). */
function playVoice(me, url, then, volKey = "voiceVolume") {
  const cfg = soundSettingsStore.get();
  let over = false;
  const fin = () => { if (!over) { over = true; if (current === me) then(); } };
  try {
    const a = new Audio(url);
    a.volume = Math.max(0, Math.min(1, Number(cfg[volKey]) || 0));
    a.onended = fin;
    a.onerror = fin;
    me.audio = a;
    a.play().catch(fin);
  } catch (_) { fin(); }
}

function brakeTones(snd, cfg) {
  const count = Math.max(1, cfg.beepCount | 0) * (snd.urgent ? 2 : 1);
  const gap = (snd.urgent ? cfg.beepGapMs / 2 : cfg.beepGapMs) / 1000;
  return Array.from({ length: count }, (_, i) => ({ f: snd.freqs[i % snd.freqs.length], d: snd.dur, g: gap }));
}

/**
 * Brake indication. code: 1 Overspeed · 2 NSB · 3 FSB · 4 EB.
 * ONE of the two, as chosen in ⚙ → 🔊 SOUND → BRAKE INDICATION:
 *   "beep"  — synthesised beeps (NSB / FSB / EB; overspeed has none)
 *   "voice" — the user's recording; if that recording is missing, the beeps
 *             play instead so a brake is never silent.
 * `test` = the ▶ TEST buttons of the beeps: beeps only, no switches, no delay.
 * Returns true when the alert was started.
 */
export function playBrakeAlert(code, { source = "track", test = false } = {}) {
  const cfg = soundSettingsStore.get();
  const snd = BRAKE_SOUNDS[code];
  const clip = VOICE_CLIPS[code];
  if (test) return snd ? playTones(snd.prio, brakeTones(snd, cfg), { test: true }) : false;
  if (!cfg.enabled || !(source === "live" ? cfg.brakeOnLive : cfg.brakeOnTrack)) return false;
  const useVoice = cfg.brakeIndication === "voice";
  const beep = !!(snd && cfg[snd.key]);
  const voice = !!(useVoice && clip && cfg[clip.key]);
  if (useVoice ? !voice : !beep) return false;          // that indication is switched off in ⚙
  return startAlert(snd ? snd.prio : 1, cfg.startDelayMs, false, async me => {
    const url = voice ? await findVoiceUrl(code) : null;
    if (current !== me) return;
    if (url) return playVoice(me, url, () => done(me));
    if (!snd) return done(me);                          // overspeed recording missing — it has no beeps
    const s = scheduleTones(me, brakeTones(snd, cfg));  // beeps — or the fallback for a missing recording
    me.timer = setTimeout(() => done(me), s * 1000 + 50);
  });
}

/** ▶ PLAY of a recording in ⚙ Settings (ignores the switches). false = no file. */
export async function playVoiceTest(code) {
  const url = await findVoiceUrl(code);
  if (!url) return false;
  return startAlert(99, 0, true, me => playVoice(me, url, () => done(me)));
}

/* Route announcements play one after another. They rank above the mode-change beep and below
   every brake / SOS sound, which cut them off; what is waiting then plays after that sound. */
const CUE_PRIO = 1, CUE_MAX_WAIT_MS = 12000;
let cueQueue = [], cueTimer = null;
function pumpCues() {
  clearTimeout(cueTimer);
  cueTimer = null;
  cueQueue = cueQueue.filter(c => Date.now() - c.at < CUE_MAX_WAIT_MS);
  if (!cueQueue.length) return;
  if (!current) {
    const { id } = cueQueue.shift();
    startAlert(CUE_PRIO, 0, false, async me => {
      const url = await findVoiceUrl(id);
      if (current !== me) return;
      if (!url) { done(me); pumpCues(); return; }
      playVoice(me, url, () => { done(me); pumpCues(); }, "cueVolume");
    });
  }
  if (cueQueue.length) cueTimer = setTimeout(pumpCues, 250);
}
/** Queue route announcements (ids of VOICE_CUES), honouring ⚙ → 🔊 SOUND → ROUTE ANNOUNCEMENTS. */
export function queueVoiceCues(ids) {
  const cfg = soundSettingsStore.get();
  if (!cfg.enabled || !cfg.cuesEnabled) return;
  ids.forEach(id => {
    const cue = VOICE_CUES[id];
    if (cue && cfg[cue.key] && !cueQueue.some(c => c.id === id)) cueQueue.push({ id, at: Date.now() });
  });
  pumpCues();
}
/** ▶ PLAY of an announcement in ⚙ Settings (ignores the switches). false = no file. */
export async function playCueTest(id) {
  const url = await findVoiceUrl(id);
  if (!url) return false;
  return startAlert(99, 0, true, me => playVoice(me, url, () => done(me), "cueVolume"));
}

/**
 * SOS buzzer. category: "collision" | "call" | "caution" (see sosCategory()).
 * source: "live" (📡 LIVE page) | "track" (🚆 LIVE TRACK) — each can be switched off.
 * Plays immediately (no delay) and repeats the pattern ⚙ sosRepeat times.
 */
export function playSosAlert(category, { source = "live", test = false } = {}) {
  const cfg = soundSettingsStore.get();
  const snd = SOS_SOUNDS[category];
  if (!snd) return false;
  if (!test && (!cfg.enabled || !cfg[snd.key] || !(source === "track" ? cfg.sosOnTrack : cfg.sosOnLive))) return false;
  const reps = Math.max(1, cfg.sosRepeat | 0);
  const tones = [];
  for (let r = 0; r < reps; r++) {
    snd.tones.forEach((t, i) => tones.push({ ...t, g: i === snd.tones.length - 1 && r < reps - 1 ? 0.9 : t.g }));
  }
  return playTones(snd.prio, tones, { wave: "sawtooth", cutoff: 2400, gain: 0.22, test });
}

/**
 * Mode-change beep: a loco's LOCO_MODE changed (📡 LIVE). Plays at once; skipped while a brake
 * beep / SOS buzzer is sounding. `test` = ▶ TEST in ⚙ Settings (ignores the switches).
 */
export function playModeAlert({ test = false } = {}) {
  const cfg = soundSettingsStore.get();
  if (!test && (!cfg.enabled || !cfg[MODE_SOUND.key])) return false;
  return playTones(MODE_SOUND.prio, MODE_SOUND.tones, { wave: "sine", cutoff: 4000, gain: 0.45, test });
}

export function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

const IP_RE = /^(\d{1,3})(\.\d{1,3}){3}$/;
const ipValid = v => IP_RE.test(v.trim()) && v.trim().split(".").every(n => +n <= 255);

/* ═══════════════════════════════════════════════════════════════
   UI PRIMITIVES
═══════════════════════════════════════════════════════════════ */
const SA_CSS = `
  @keyframes sa-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes sa-pop  { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
  .sa-row + .sa-row { border-top: 1px solid var(--border); }
  .sa-nav-btn { display: flex; align-items: center; gap: 9px; width: 100%; padding: 9px 12px; border-radius: 6px;
    border: 1px solid transparent; background: transparent; color: var(--text-secondary); cursor: pointer;
    font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-align: left; transition: all 0.15s; }
  .sa-nav-btn:hover { background: var(--bg-raised); color: var(--text-primary); }
  .sa-nav-btn.on { background: var(--green-glow); border-color: var(--green-deep); color: var(--green); }
  .sa-btn { padding: 5px 12px; border-radius: 4px; border: 1px solid var(--border-bright); background: transparent;
    color: var(--text-secondary); font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: 0.08em; cursor: pointer; }
  .sa-btn:hover { border-color: var(--cyan-dim); color: var(--cyan); }
  .sa-btn.primary { border-color: var(--green-deep); background: var(--green-glow); color: var(--green); padding: 5px 14px; }
  .sa-x:hover { border-color: var(--red) !important; color: var(--red) !important; }
  @media (max-width: 720px) {
    .sa-body { flex-direction: column !important; }
    .sa-nav { width: auto !important; flex-direction: row !important; overflow-x: auto; border-right: none !important; border-bottom: 1px solid var(--border); }
    .sa-nav-btn { width: auto; white-space: nowrap; }
  }
`;

function Dialog({ title, icon, onClose, children, footer, width = 640 }) {
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(2,8,6,0.55)", backdropFilter: "blur(3px)", padding: 16, animation: "sa-fade 0.15s ease-out",
    }}>
      <style>{SA_CSS}</style>
      <div role="dialog" aria-label={title} style={{
        width: "min(" + width + "px, 100%)", maxHeight: "min(88vh, 800px)", display: "flex", flexDirection: "column",
        background: "var(--bg-surface)", border: "1px solid var(--border-bright)", borderRadius: 8,
        boxShadow: "0 20px 60px rgba(0,0,0,0.45)", overflow: "hidden",
        fontFamily: "var(--font-mono)", animation: "sa-pop 0.18s ease-out",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-raised)", flexShrink: 0 }}>
          <span style={{ fontSize: 15, color: "var(--green)" }}>{icon}</span>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: "0.18em", color: "var(--green)" }}>{title}</span>
          <button className="sa-x" onClick={onClose} title="Close (Esc)" style={{
            marginLeft: "auto", width: 26, height: 26, borderRadius: 4, border: "1px solid var(--border)",
            background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 12,
          }}>✕</button>
        </div>
        {children}
        {footer && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-raised)", flexShrink: 0 }}>{footer}</div>}
      </div>
    </div>
  );
}

function Section({ title, children, disabled = false, note }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 9, fontWeight: 700, letterSpacing: "0.16em", color: "var(--amber-text)", marginBottom: 6, opacity: disabled ? 0.55 : 1 }}>
        {title}
        {disabled && note && <span style={{ fontSize: 8, letterSpacing: "0.08em", padding: "1px 7px", borderRadius: 8, border: "1px solid var(--border-bright)", color: "var(--text-secondary)" }}>{note}</span>}
      </div>
      <div aria-disabled={disabled || undefined} style={{
        border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-card)", overflow: "hidden",
        opacity: disabled ? 0.38 : 1, pointerEvents: disabled ? "none" : "auto", filter: disabled ? "grayscale(0.7)" : "none", transition: "opacity 0.2s",
      }}>{children}</div>
    </div>
  );
}

const SOUND_OFF = "OFF — turn on Sound alerts above (your settings are kept)";

function Row({ label, hint, children, disabled = false }) {
  return (
    <div className="sa-row" aria-disabled={disabled || undefined} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px",
      opacity: disabled ? 0.38 : 1, pointerEvents: disabled ? "none" : "auto", filter: disabled ? "grayscale(0.7)" : "none", transition: "opacity 0.2s" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, color: "var(--text-primary)", fontWeight: 700, letterSpacing: "0.03em" }}>{label}</div>
        {hint && <div style={{ fontSize: 9, color: "var(--text-secondary)", opacity: 0.85, marginTop: 2, lineHeight: 1.45 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} style={{
      width: 34, height: 18, borderRadius: 9, flexShrink: 0, cursor: "pointer", position: "relative", padding: 0,
      border: "1px solid " + (checked ? "var(--green-deep)" : "var(--border-bright)"),
      background: checked ? "var(--green-glow)" : "var(--bg-input)", transition: "all 0.2s",
    }}>
      <span style={{
        position: "absolute", top: 2, left: checked ? 18 : 2, width: 12, height: 12, borderRadius: "50%",
        background: checked ? "var(--green)" : "var(--text-muted)", transition: "all 0.2s",
        boxShadow: checked ? "0 0 6px var(--green)" : "none",
      }} />
    </button>
  );
}

function Choice({ value, options, onChange }) {
  return (
    <div style={{ display: "flex", gap: 3, padding: 2, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-input)", flexShrink: 0 }}>
      {options.map(([v, label]) => (
        <button key={String(v)} onClick={() => onChange(v)} style={{
          padding: "4px 10px", borderRadius: 3, border: "none", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
          background: value === v ? "var(--cyan-glow)" : "transparent", color: value === v ? "var(--cyan)" : "var(--text-secondary)",
          whiteSpace: "nowrap",
        }}>{label}</button>
      ))}
    </div>
  );
}

function KV({ k, v, color }) {
  return (
    <div className="sa-row" style={{ display: "flex", gap: 10, padding: "6px 12px", fontSize: 10 }}>
      <span style={{ width: 140, flexShrink: 0, color: "var(--text-secondary)", letterSpacing: "0.05em" }}>{k}</span>
      <span style={{ color: color || "var(--text-primary)", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ⚙ SETTINGS
═══════════════════════════════════════════════════════════════ */
const TABS = [
  { id: "general", icon: "◐", label: "GENERAL" },
  { id: "decoder", icon: "⚡", label: "PINJ DECODER" },
  { id: "live",    icon: "📡", label: "LIVE" },
  { id: "svksim",  icon: "🧩", label: "SVK SIM" },
  { id: "sound",   icon: "🔊", label: "SOUND" },
  { id: "profile", icon: "👤", label: "PROFILE" },
  { id: "users",   icon: "👥", label: "USERS", admin: true },
  { id: "library", icon: "📂", label: "LIBRARY", admin: true },
];
const ACCOUNT_TABS = ["profile", "users", "library"];               // kept on the PINJ server, not in this browser

/* 🗣 Voice-over rows — shows whether each recording was found in public/sounds/voice/ */
function VoiceSection({ snd, setSnd, disabled }) {
  const [files, setFiles] = useState({});               // code → url | null | undefined (checking)
  const check = () => {
    setFiles({});
    Object.keys(VOICE_CLIPS).forEach(code => findVoiceUrl(Number(code)).then(u => setFiles(f => ({ ...f, [code]: u }))));
  };
  useEffect(check, []);
  const found = Object.values(files).filter(Boolean).length;
  return (
    <Section title="🗣 VOICE · YOUR RECORDINGS" disabled={disabled} note={!snd.enabled ? SOUND_OFF : "NOT IN USE — select VOICE above"}>
      <Row label="Voice volume" hint={Math.round(snd.voiceVolume * 100) + " % · " + found + " of 4 recordings found. A missing recording plays its beeps instead."}>
        <input type="range" min={0} max={100} step={5} value={Math.round(snd.voiceVolume * 100)}
          onChange={e => setSnd("voiceVolume", Number(e.target.value) / 100)}
          style={{ width: 170, accentColor: "var(--green)", cursor: "pointer" }} />
      </Row>
      {[1, 2, 3, 4].map(code => {
        const c = VOICE_CLIPS[code];
        const u = files[code];
        const status = u === undefined ? "checking…" : u ? "✓ " + u.split("/").pop() : "✗ not found — add " + c.file + ".mp3 (or .wav / .m4a / .ogg) to frontend/public/sounds/voice/";
        return (
          <Row key={code} label={c.short + " — " + c.name + "  (Brake_Applied = " + code + ")"}
            hint={<span style={{ color: u ? "var(--green)" : u === null ? "var(--amber-text)" : undefined }}>{status}</span>}>
            <button className="sa-btn" disabled={!u} style={{ opacity: u ? 1 : 0.45, cursor: u ? "pointer" : "default" }}
              onClick={() => playVoiceTest(code)} title={u ? "Play this recording" : "No recording yet"}>▶ PLAY</button>
            <Toggle checked={snd[c.key]} onChange={v => setSnd(c.key, v)} />
          </Row>
        );
      })}
      <Row label="Re-check the recordings" hint="After adding or replacing files in frontend/public/sounds/voice/.">
        <button className="sa-btn" onClick={() => { recheckVoiceFiles(); check(); }}>↻ RE-CHECK</button>
      </Row>
    </Section>
  );
}

/* 🗣 Route announcement rows — same layout as the brake recordings above */
function CueSection({ snd, setSnd }) {
  const ids = Object.keys(VOICE_CUES);
  const [files, setFiles] = useState({});               // id → url | null | undefined (checking)
  const check = () => {
    setFiles({});
    ids.forEach(id => findVoiceUrl(id).then(u => setFiles(f => ({ ...f, [id]: u }))));
  };
  useEffect(check, []);
  const found = Object.values(files).filter(Boolean).length;
  return (
    <Section title="🗣 ROUTE ANNOUNCEMENTS · 📡 LIVE" disabled={!snd.enabled} note={SOUND_OFF}>
      <Row label="Route announcements" hint={"Spoken for each signal, turnout and PSR as the loco approaches and enters it. " + found + " of " + ids.length + " recordings found."}>
        <Toggle checked={snd.cuesEnabled} onChange={v => setSnd("cuesEnabled", v)} />
      </Row>
      <Row label="Volume" hint={Math.round(snd.cueVolume * 100) + " %"}>
        <input type="range" min={0} max={100} step={5} value={Math.round(snd.cueVolume * 100)}
          onChange={e => setSnd("cueVolume", Number(e.target.value) / 100)}
          style={{ width: 170, accentColor: "var(--green)", cursor: "pointer" }} />
      </Row>
      <Row label="Repeat the signal announcement every" hint="Danger, Attention, Caution and Proceed repeat while the moving loco approaches the signal, until it is passed.">
        <Choice value={snd.cueSignalRepeatS} options={[[0, "OFF"], [5, "5 s"], [10, "10 s"], [15, "15 s"], [20, "20 s"]]} onChange={v => setSnd("cueSignalRepeatS", v)} />
      </Row>
      <Row label="Repeat the turnout / PSR announcement every" hint="Approaching Turnout and Approaching PSR repeat while the moving loco approaches, until it enters. Entered plays once.">
        <Choice value={snd.cueProfileRepeatS} options={[[0, "OFF"], [5, "5 s"], [10, "10 s"], [15, "15 s"], [20, "20 s"]]} onChange={v => setSnd("cueProfileRepeatS", v)} />
      </Row>
      {ids.map(id => {
        const c = VOICE_CUES[id];
        const u = files[id];
        const status = u === undefined ? "checking…" : u ? c.name + " · ✓ " + u.split("/").pop() : c.name + " · ✗ not found — add " + c.file + ".mp3 to frontend/public/sounds/voice/";
        return (
          <Row key={id} label={c.short}
            hint={<span style={{ color: u === null ? "var(--amber-text)" : undefined }}>{status}</span>}>
            <button className="sa-btn" disabled={!u} style={{ opacity: u ? 1 : 0.45, cursor: u ? "pointer" : "default" }}
              onClick={() => playCueTest(id)} title={u ? "Play this recording" : "No recording yet"}>▶ PLAY</button>
            <Toggle checked={snd[c.key]} onChange={v => setSnd(c.key, v)} />
          </Row>
        );
      })}
    </Section>
  );
}

export function SettingsDialog({ initialTab = "general", isLight, setIsLight, onClose }) {
  const me = useCurrentUser();
  const tabs = TABS.filter(t => !t.admin || me?.role === "admin");
  const [tab, setTab] = useState(tabs.some(t => t.id === initialTab) ? initialTab : "general");
  const app = useStore(appSettingsStore);
  const svk = useStore(svkSettingsStore);
  const setApp = (k, v) => appSettingsStore.set({ [k]: v });
  const setSvk = (k, v) => svkSettingsStore.set({ [k]: v });
  const [ipDraft, setIpDraft] = useState(svk.defaultDestIp);
  const snd = useStore(soundSettingsStore);
  const setSnd = (k, v) => soundSettingsStore.set({ [k]: v });

  const resetTab = () => {
    if (tab === "svksim") { svkSettingsStore.reset(); setIpDraft(svkSettingsStore.defaults.defaultDestIp); return; }
    if (tab === "sound") { soundSettingsStore.reset(); appSettingsStore.set({ bootSound: appSettingsStore.defaults.bootSound }); return; }
    const d = appSettingsStore.defaults;
    const keys = {
      general: ["startPage", "homeAnimation"],
      decoder: ["decoderInputOpen", "decoderTimeline"],
      live:    ["liveAutoScroll", "liveAlerts", "liveAlertSecs", "liveMaxRows", "liveDefaultView", "dmiSmooth", "dmiTagMissM",
                "liveStripOpen", "liveStripLabels", "replaySpeed", "replaySkipGaps", "replayLoop"],
    }[tab];
    appSettingsStore.set(Object.fromEntries(keys.map(k => [k, d[k]])));
    if (tab === "general") setIsLight(false);
  };

  return (
    <Dialog title="SETTINGS" icon="⚙" width={820} onClose={onClose} footer={<>
      <span style={{ fontSize: 9, color: "var(--text-secondary)", opacity: 0.85 }}>
        {ACCOUNT_TABS.includes(tab) ? "Kept on the PINJ server" : `Saved automatically for ${me?.username || "you"} in this browser`} · Ctrl+, opens this window</span>
      {!ACCOUNT_TABS.includes(tab) &&
        <button className="sa-btn" style={{ marginLeft: "auto" }} onClick={resetTab}>↺ RESET {TABS.find(t => t.id === tab).label}</button>}
      {ACCOUNT_TABS.includes(tab) && <button className="sa-btn" style={{ marginLeft: "auto", color: "var(--red)" }} onClick={signOut}>⏻ SIGN OUT</button>}
      <button className="sa-btn primary" onClick={onClose}>✓ DONE</button>
    </>}>
      <div className="sa-body" style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div className="sa-nav" style={{ width: 180, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4, padding: 10, borderRight: "1px solid var(--border)", background: "var(--bg-surface)" }}>
          {tabs.map(t => (
            <button key={t.id} className={"sa-nav-btn" + (tab === t.id ? " on" : "")} onClick={() => setTab(t.id)}
              style={t.id === "profile" ? { marginTop: 10, borderTop: "1px solid var(--border)", borderRadius: "0 0 6px 6px", paddingTop: 12 } : undefined}>
              <span style={{ width: 16, textAlign: "center" }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, padding: "14px 16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {tab === "profile" && <ProfilePanel />}
          {tab === "users" && <UsersPanel />}
          {tab === "library" && <LibraryAdminPanel />}
          {tab === "general" && <>
            <Section title="◐ APPEARANCE">
              <Row label="Theme" hint="Applies to every page — PINJ, LIVE and SVK SIM (same as the ☀ / ☾ switch in the top bar).">
                <Choice value={isLight ? "light" : "dark"} options={[["dark", "☾ DARK"], ["light", "☀ LIGHT"]]} onChange={v => setIsLight(v === "light")} />
              </Row>
              <Row label="PINJ home animation" hint="Off = the home picture stays still (the signal, radio waves and the onboard readout stop moving).">
                <Toggle checked={app.homeAnimation} onChange={v => setApp("homeAnimation", v)} />
              </Row>
            </Section>
            <Section title="▶ START-UP">
              <Row label="Open on start" hint="The page shown when the app is opened or reloaded.">
                <Choice value={app.startPage} options={[["pinj", "PINJ"], ["live", "📡 LIVE"], ["svksim", "🧩 SVK SIM"]]} onChange={v => setApp("startPage", v)} />
              </Row>
            </Section>
          </>}

          {tab === "decoder" && <>
            <Section title="⚡ INPUT">
              <Row label="Show the INPUT JSON + LOG / CRC VERIFY panels on start" hint="Off = they stay hidden until ▼ INPUT, a LOAD SAMPLE button or a dropped file opens them.">
                <Toggle checked={app.decoderInputOpen} onChange={v => setApp("decoderInputOpen", v)} />
              </Row>
            </Section>
            <Section title="▤ DECODED PACKET">
              <Row label="Show the TDMA timeline by default" hint="The timeline under a decoded packet; it can still be switched per packet.">
                <Toggle checked={app.decoderTimeline} onChange={v => setApp("decoderTimeline", v)} />
              </Row>
            </Section>
          </>}

          {tab === "live" && <>
            <Section title="🖥 VIEW">
              <Row label="LIVE opens with" hint="The view selected when the app opens; the PACKETS / DMI / PROFILE switch on the LIVE page still changes it at any time.">
                <Choice value={app.liveDefaultView} options={[["packets", "▤ PACKETS"], ["dmi", "🚆 DMI"], ["profile", "🗺 PROFILE"]]} onChange={v => setApp("liveDefaultView", v)} />
              </Row>
            </Section>
            <Section title="🚆 DMI — LP-OCIP (ANNEXURE-B)">
              <Row label="Smooth value changes" hint="Speed pointer, permitted band, target / MA bars, distances and LOC glide between packets. Off = every value jumps at once. Display only — the decoded values are the same.">
                <Toggle checked={app.dmiSmooth} onChange={v => setApp("dmiSmooth", v)} />
              </Row>
              <Row label="Missed tag (Region M) after" hint="An expected tag from the C.4.2 tag-linking list turns RED when the loco runs this far past its location without reporting it (it also turns red as soon as a later tag is reported).">
                <Choice value={app.dmiTagMissM} options={[[60, "60 m"], [100, "100 m"], [150, "150 m"], [200, "200 m"]]} onChange={v => setApp("dmiTagMissM", v)} />
              </Row>
            </Section>
            <Section title="🛤 LIVE VISUALISER">
              <Row label="Show the LIVE VISUALISER" hint="The track strip with the C.4.2 tags and the loco above the LIVE views (also the ▾ / ▸ button on the strip).">
                <Toggle checked={app.liveStripOpen} onChange={v => setApp("liveStripOpen", v)} />
              </Row>
              <Row label="Loco labels" hint="Loco Id, Length, Speed, Rfid and Abs.Loc above each loco.">
                <Toggle checked={app.liveStripLabels} onChange={v => setApp("liveStripLabels", v)} />
              </Row>
            </Section>
            <Section title="📂 LOG REPLAY — PACKET SIMULATOR">
              <Row label="Default replay speed" hint="Used when the Packet Simulator page is opened (it can still be changed there).">
                <Choice value={app.replaySpeed} options={[[1, "1×"], [2, "2×"], [5, "5×"], [10, "10×"], [0, "FAST"]]} onChange={v => setApp("replaySpeed", v)} />
              </Row>
              <Row label="Skip idle gaps longer than 3 s" hint="Paused periods in the log are shortened to 3 s.">
                <Toggle checked={app.replaySkipGaps} onChange={v => setApp("replaySkipGaps", v)} />
              </Row>
              <Row label="Loop at the end" hint="Start the log again from the first packet when it ends.">
                <Toggle checked={app.replayLoop} onChange={v => setApp("replayLoop", v)} />
              </Row>
            </Section>
            <Section title="📡 FEED">
              <Row label="Auto-scroll to the newest packet" hint="Starting value of the auto-scroll box on the LIVE page.">
                <Toggle checked={app.liveAutoScroll} onChange={v => setApp("liveAutoScroll", v)} />
              </Row>
              <Row label="Packets kept in the table" hint="Older packets are dropped from the view beyond this number.">
                <Choice value={app.liveMaxRows} options={[[100, "100"], [300, "300"], [1000, "1000"], [3000, "3000"]]} onChange={v => setApp("liveMaxRows", v)} />
              </Row>
            </Section>
            <Section title="🚨 ALERTS">
              <Row label="SOS / emergency / brake pop-up alerts" hint="Pop-ups for C.4.5 emergency packets and SOS or brake fields in any packet.">
                <Toggle checked={app.liveAlerts} onChange={v => setApp("liveAlerts", v)} />
              </Row>
              <Row label="Alert stays on screen for" hint="Each alert can still be closed by hand.">
                <Choice value={app.liveAlertSecs} options={[[4, "4 s"], [8, "8 s"], [15, "15 s"], [30, "30 s"]]} onChange={v => setApp("liveAlertSecs", v)} />
              </Row>
            </Section>
          </>}

          {tab === "sound" && <>
            <Section title="🔊 KAVACH ALERT SOUNDS">
              <Row label="Sound alerts" hint="Master switch for every Kavach alert sound. Also on the 🚆 LIVE TRACK toolbar (🔊 / 🔇).">
                <Toggle checked={snd.enabled} onChange={v => setSnd("enabled", v)} />
              </Row>
              <Row label="Volume" hint={Math.round(snd.volume * 100) + " %"} disabled={!snd.enabled}>
                <input type="range" min={0} max={100} step={5} value={Math.round(snd.volume * 100)}
                  onChange={e => setSnd("volume", Number(e.target.value) / 100)}
                  style={{ width: 170, accentColor: "var(--green)", cursor: "pointer" }} />
              </Row>
              <Row disabled={!snd.enabled} label="🚆 LIVE TRACK sounds only while it is on screen" hint="Brake beeps and SOS buzzer of LIVE TRACK. Off = also sound when you are on another page or tab of the app.">
                <Toggle checked={snd.onlyWhenVisible} onChange={v => setSnd("onlyWhenVisible", v)} />
              </Row>
            </Section>

            <Section title="🛑 BRAKE INDICATION · 📡 LIVE + 🚆 LIVE TRACK" disabled={!snd.enabled} note={SOUND_OFF}>
              <Row label="Brake indication sound" hint="One at a time: the synthesised BEEP SOUND or your recorded VOICE. The other option is switched off.">
                <Choice value={snd.brakeIndication} options={[["beep", "🔔 BEEP SOUND"], ["voice", "🗣 VOICE"]]} onChange={v => setSnd("brakeIndication", v)} />
              </Row>
              <Row label="Delay before the indication" hint="After the brake packet arrives / the brake dot appears.">
                <Choice value={snd.startDelayMs} options={[[0, "NONE"], [500, "0.5 s"], [1000, "1 s"], [2000, "2 s"]]} onChange={v => setSnd("startDelayMs", v)} />
              </Row>
              <Row label="On the 📡 LIVE page" hint="Brake_Applied 1 – 4 in received C.4.3 packets — on a new brake application per loco, repeated every 10 s while the same brake stays applied.">
                <Toggle checked={snd.brakeOnLive} onChange={v => setSnd("brakeOnLive", v)} />
              </Row>
              <Row label="On 🚆 LIVE TRACK" hint="When a brake dot (NSB / FSB / EB) is marked on the chart, and on overspeed.">
                <Toggle checked={snd.brakeOnTrack} onChange={v => setSnd("brakeOnTrack", v)} />
              </Row>
            </Section>

            <Section title="🔔 BEEP SOUND" disabled={!snd.enabled || snd.brakeIndication !== "beep"} note={!snd.enabled ? SOUND_OFF : "NOT IN USE — select BEEP SOUND above"}>
              {[2, 3, 4].map(code => {
                const b = BRAKE_SOUNDS[code];
                return (
                  <Row key={code} label={b.short + " — " + b.name}
                    hint={code === 4 ? "Urgent two-tone alarm, twice as many beeps at half the gap." : (code === 2 ? "Steady tone." : "Higher tone.") + " Plays when Brake_Applied = " + code + " (" + b.short + ")."}>
                    <button className="sa-btn" onClick={() => playBrakeAlert(code, { test: true })} title={"Play the " + b.short + " beeps now"}>▶ TEST</button>
                    <Toggle checked={snd[b.key]} onChange={v => setSnd(b.key, v)} />
                  </Row>
                );
              })}
              <Row label="Beeps per brake application" hint="EB plays twice this number.">
                <Choice value={snd.beepCount} options={[[1, "1"], [2, "2"], [3, "3"], [5, "5"]]} onChange={v => setSnd("beepCount", v)} />
              </Row>
              <Row label="Gap between beeps" hint="beep … beep … beep · Overspeed has no beeps.">
                <Choice value={snd.beepGapMs} options={[[300, "0.3 s"], [600, "0.6 s"], [1000, "1 s"], [1500, "1.5 s"]]} onChange={v => setSnd("beepGapMs", v)} />
              </Row>
            </Section>

            <VoiceSection snd={snd} setSnd={setSnd} disabled={!snd.enabled || snd.brakeIndication !== "voice"} />

            <Section title="🚨 SOS BUZZER · 📡 LIVE + 🚆 LIVE TRACK" disabled={!snd.enabled} note={SOUND_OFF}>
              {["collision", "call", "caution"].map(c => {
                const s = SOS_SOUNDS[c];
                return (
                  <Row key={c} label={s.short + " — " + s.name} hint={s.desc}>
                    <button className="sa-btn" onClick={() => playSosAlert(c, { test: true })} title={"Play the " + s.name + " buzzer now"}>▶ TEST</button>
                    <Toggle checked={snd[s.key]} onChange={v => setSnd(s.key, v)} />
                  </Row>
                );
              })}
              <Row label="Repeat the buzzer" hint="How many times the pattern plays (0.9 s apart). Plays at once — no delay. Closing the alert pop-up on 📡 LIVE stops it.">
                <Choice value={snd.sosRepeat} options={[[1, "1×"], [2, "2×"], [3, "3×"], [5, "5×"]]} onChange={v => setSnd("sosRepeat", v)} />
              </Row>
              <Row label="On the 📡 LIVE page" hint="EMERGENCY_STATUS, DEST_LOCO_SOS, GEN_SOS_CALL and C.4.5 emergency packets — also when the LIVE pop-up alerts are switched off.">
                <Toggle checked={snd.sosOnLive} onChange={v => setSnd("sosOnLive", v)} />
              </Row>
              <Row label="On 🚆 LIVE TRACK" hint="When a loco's EMERGENCY_STATUS (C.4.3 / C.4.6 on serial RX) changes to an SOS condition.">
                <Toggle checked={snd.sosOnTrack} onChange={v => setSnd("sosOnTrack", v)} />
              </Row>
            </Section>

            <Section title="🔁 MODE CHANGE · 📡 LIVE" disabled={!snd.enabled} note={SOUND_OFF}>
              <Row label="Beep when the mode changes" hint="When a loco's LOCO_MODE in a received C.4.3 / C.4.6 differs from its previous packet (e.g. FS → SR) — two short rising beeps, per loco. A brake beep or SOS buzzer at the same moment takes over.">
                <button className="sa-btn" onClick={() => playModeAlert({ test: true })} title="Play the mode-change beep now">▶ TEST</button>
                <Toggle checked={snd.modeOnLive} onChange={v => setSnd("modeOnLive", v)} />
              </Row>
            </Section>

            <CueSection snd={snd} setSnd={setSnd} />

            <Section title="🎵 APP SOUNDS · not affected by Sound alerts">
              <Row label="Start-up sound" hint="Played when the app loads (separate from the Kavach alert switch above): your recording frontend/public/sounds/startup.mp3 (or .wav / .m4a / .ogg) if it is there, otherwise the short chime.">
                <button className="sa-btn" onClick={() => playStartupSound()} title="Play the start-up sound now">▶ TEST</button>
                <Toggle checked={app.bootSound} onChange={v => setApp("bootSound", v)} />
              </Row>
            </Section>
            <div style={{ fontSize: 9, color: "var(--text-secondary)", opacity: 0.8, lineHeight: 1.6 }}>
              Priority: Mode change → Route announcements → NSB → FSB → EB → Caution → SoS → Collision — a higher alert replaces a lower one that is still sounding; a lower one never cuts off a higher one. More Kavach sounds (horn, …) will be added to this tab.
            </div>
          </>}

          {tab === "svksim" && <>
            <Section title="☰ LOADERS DRAWER">
              <Row label="Open the drawer when the page opens" hint="Off = start with the loaders closed and the table area full width.">
                <Toggle checked={svk.drawerOnStart} onChange={v => setSvk("drawerOnStart", v)} />
              </Row>
              <Row label="Keep the drawer open in 🚆 LIVE TRACK" hint="Off = LIVE TRACK uses the complete screen; open the drawer any time with ☰ or Ctrl+B.">
                <Toggle checked={svk.drawerInTrack} onChange={v => setSvk("drawerInTrack", v)} />
              </Row>
              <Row label="Close the drawer when a transmission starts" hint="Gives the live TX / serial log the full width while it runs.">
                <Toggle checked={svk.autoHideOnTx} onChange={v => setSvk("autoHideOnTx", v)} />
              </Row>
            </Section>
            <Section title="🚆 LIVE TRACK">
              <Row label="Loco icon" hint="How each loco is drawn on the 🚆 LIVE TRACK chart. Every style keeps the loco's own colour, spinning wheels, headlight, brake lights / sparks and the emergency beacon." />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 6, padding: "0 12px 12px" }}>
                {LOCO_STYLES.map(ls => {
                  const on = (svk.locoStyle || "classic") === ls.id;
                  return (
                    <button key={ls.id} type="button" onClick={() => setSvk("locoStyle", ls.id)} aria-pressed={on} title={ls.name + " — " + ls.note}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 4px 7px", borderRadius: 6, cursor: "pointer",
                        border: "1.5px solid " + (on ? "var(--cyan)" : "var(--border)"), background: on ? "var(--cyan-glow, rgba(34,211,238,.12))" : "var(--bg-raised)",
                        color: on ? "var(--cyan)" : "var(--text-secondary)", fontFamily: "var(--font-mono)", transition: "border-color .15s, background .15s" }}>
                      <span style={{ background: "#050910", borderRadius: 4, padding: "2px 4px" }}><LocoStylePreview style={ls.id} width={96} speed={on ? 70 : 0} /></span>
                      <span style={{ fontSize: 9.5, fontWeight: 700 }}>{on ? "● " : ""}{ls.name}</span>
                      <span style={{ fontSize: 8, opacity: .8 }}>{ls.note}</span>
                    </button>
                  );
                })}
              </div>
            </Section>
            <Section title="▤ STATIC DATA">
              <Row label="Show the table after a file loads" hint="Jumps to ▤ STATIC DATA when APD / MA / RFID tables are loaded (never during a running transmission).">
                <Toggle checked={svk.autoShowTables} onChange={v => setSvk("autoShowTables", v)} />
              </Row>
            </Section>
            <Section title="◈ TRANSMISSION DEFAULTS">
              <Row label="Destination IP" hint="Used for UDP / HTTP transmit — changing it here also updates the SVK SIM page.">
                <input value={ipDraft} spellCheck={false}
                  onChange={e => { const v = e.target.value; setIpDraft(v); if (ipValid(v)) setSvk("defaultDestIp", v.trim()); }}
                  style={{
                    width: 140, padding: "5px 8px", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 10.5, outline: "none",
                    background: "var(--bg-input)", color: "var(--text-primary)",
                    border: "1px solid " + (ipValid(ipDraft) ? "var(--border-bright)" : "var(--red)"),
                  }} />
              </Row>
              <Row label="Radio" hint="Selects the OTA Start-of-Frame prefix (Annexure-C §C.3.2.12) for UDP and serial.">
                <Choice value={svk.defaultRadio} options={[[1, "RADIO1 · 0xF1"], [2, "RADIO2 · 0xF2"]]} onChange={v => setSvk("defaultRadio", v)} />
              </Row>
            </Section>
            <Section title="◐ DISPLAY">
              <Row label="Background scanlines" hint="The faint CRT line texture behind the SVK SIM page.">
                <Toggle checked={svk.scanlines} onChange={v => setSvk("scanlines", v)} />
              </Row>
            </Section>
          </>}
        </div>
      </div>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ⓘ ABOUT — a short user guide in tabs
═══════════════════════════════════════════════════════════════ */
const PAGE_NAMES = { decode: "PINJ — decoder / home", live: "📡 LIVE", svksim: "🧩 SVK SIM" };

const ABOUT_TABS = [
  { id: "overview", icon: "◈", label: "OVERVIEW" },
  { id: "modules",  icon: "▶", label: "MODULES & WORKFLOW" },
  { id: "dmi",      icon: "🚆", label: "LIVE DMI & REPLAY" },
  { id: "hardware", icon: "🔌", label: "SERIAL MODEM SETUP" },
  { id: "sound",    icon: "🔊", label: "ALERT SOUNDS" },
  { id: "help",     icon: "🛠", label: "TROUBLESHOOTING" },
  { id: "system",   icon: "▤", label: "SYSTEM & SESSION" },
];

function Para({ children, strong }) {
  return <div style={{ fontSize: strong ? 11.5 : 10.5, lineHeight: 1.7, color: strong ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: strong ? 600 : 400 }}>{children}</div>;
}
function Bullets({ items }) {
  return (
    <div style={{ padding: "6px 12px 8px" }}>
      {items.map(([head, text], i) => (
        <div key={i} style={{ display: "flex", gap: 8, padding: "5px 0", fontSize: 10.5, lineHeight: 1.6 }}>
          <span style={{ color: "var(--green)", flexShrink: 0 }}>▸</span>
          <span><b style={{ color: "var(--text-primary)" }}>{head}</b>{text ? <span style={{ color: "var(--text-secondary)" }}> — {text}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}
function Steps({ items }) {
  return (
    <div style={{ padding: "6px 12px 8px" }}>
      {items.map((t, i) => (
        <div key={i} style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 10.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: "50%", border: "1px solid var(--green-deep)", color: "var(--green)",
            display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800 }}>{i + 1}</span>
          <span style={{ paddingTop: 1 }}>{t}</span>
        </div>
      ))}
    </div>
  );
}
function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } finally { ta.remove(); }
  return Promise.resolve();
}
function Cmd({ cmd, note, where }) {
  const [done, setDone] = useState(false);
  return (
    <div className="sa-row" style={{ padding: "8px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {where && <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.1em", padding: "2px 6px", borderRadius: 4, flexShrink: 0,
          border: "1px solid " + (where === "WSL" ? "var(--purple)" : "var(--cyan-dim)"), color: where === "WSL" ? "var(--purple)" : "var(--cyan)" }}>{where}</span>}
        <code style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-code)", background: "var(--bg-input)",
          border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", overflowX: "auto", whiteSpace: "nowrap" }}>{cmd}</code>
        <button className="sa-btn" style={{ flexShrink: 0, minWidth: 72 }}
          onClick={() => copyText(cmd).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); })}>{done ? "✓ COPIED" : "⧉ COPY"}</button>
      </div>
      {note && <div style={{ fontSize: 9.5, color: "var(--text-secondary)", marginTop: 5, lineHeight: 1.5, paddingLeft: where ? 52 : 0 }}>{note}</div>}
    </div>
  );
}
function Callout({ tone = "info", children }) {
  const c = { info: "var(--cyan-dim)", warn: "var(--amber)", ok: "var(--green-deep)" }[tone];
  return (
    <div style={{ borderLeft: "3px solid " + c, background: "var(--bg-card)", border: "1px solid var(--border)", borderLeftWidth: 3, borderLeftColor: c,
      borderRadius: 6, padding: "9px 12px", fontSize: 10.5, lineHeight: 1.65, color: "var(--text-secondary)" }}>{children}</div>
  );
}
function Flow({ steps }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 6, padding: 10 }}>
      {steps.map(([t, s], i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ minWidth: 112, padding: "7px 9px", borderRadius: 6, border: "1px solid var(--border-bright)", background: "var(--bg-raised)" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "0.04em" }}>{t}</div>
            <div style={{ fontSize: 9, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.4 }}>{s}</div>
          </div>
          {i < steps.length - 1 && <span style={{ color: "var(--green)", fontSize: 13 }}>➜</span>}
        </div>
      ))}
    </div>
  );
}

export function AboutDialog({ onClose, page, packetTypes, isLight, session }) {
  const svk = useStore(svkSessionStore);
  const app = useStore(appSettingsStore);
  const snd = useStore(soundSettingsStore);
  const [tab, setTab] = useState("overview");
  const [busid, setBusid] = useState(() => { try { return localStorage.getItem("pinj-usb-busid") || "2-4"; } catch (_) { return "2-4"; } });
  const setBus = v => { setBusid(v); try { localStorage.setItem("pinj-usb-busid", v); } catch (_) { /* storage blocked */ } };
  const bus = (busid || "").trim() || "<BUSID>";
  const [backend, setBackend] = useState("checking");      // checking | online | offline
  useEffect(() => {
    let alive = true;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    fetch(API_BASE + "/health", { signal: ctl.signal })
      .then(r => { if (alive) setBackend(r.ok ? "online" : "offline"); })
      .catch(() => { if (alive) setBackend("offline"); })
      .finally(() => clearTimeout(t));
    return () => { alive = false; ctl.abort(); clearTimeout(t); };
  }, []);
  const be = {
    checking: ["◌ CHECKING…", "var(--text-secondary)"],
    online:   ["● ONLINE", "var(--green)"],
    offline:  ["● NOT REACHABLE — start the backend (FastAPI on port 8000)", "var(--red)"],
  }[backend];
  const txText = s => (s === "transmitting" ? "● TRANSMITTING" : s || "idle");

  return (
    <Dialog title="ABOUT PINJ" icon="ⓘ" width={900} onClose={onClose} footer={<>
      <span style={{ fontSize: 9, color: "var(--text-secondary)", opacity: 0.85 }}>© NOVA · Engineering Safety · Powering Innovation</span>
      <button className="sa-btn primary" style={{ marginLeft: "auto" }} onClick={onClose}>CLOSE</button>
    </>}>
      <div className="sa-body" style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div className="sa-nav" style={{ width: 200, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4, padding: 10, borderRight: "1px solid var(--border)", background: "var(--bg-surface)" }}>
          {ABOUT_TABS.map(t => (
            <button key={t.id} className={"sa-nav-btn" + (tab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>
              <span style={{ width: 16, textAlign: "center" }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, padding: "14px 16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>

          {tab === "overview" && <>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <img src="/nova-mark.png" alt="" draggable={false} style={{ width: 56, height: 56, objectFit: "contain", flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <img src={isLight ? "/nova-text-light.png" : "/nova-text-dark.png"} alt="NOVA" draggable={false} style={{ height: 22, display: "block" }} />
                <div style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.14em", color: "var(--green)", marginTop: 6 }}>
                  PINJ — KAVACH PACKET INJECTOR &amp; DECODER
                </div>
                <div style={{ fontSize: 9.5, color: "var(--text-secondary)", marginTop: 3 }}>
                  v4.0 · RDSO/SPN/196/2020 Annexure-C (Amendment-10) · Indian Railways
                </div>
              </div>
            </div>

            <Para strong>
              PINJ is NOVA's engineering workbench for the KAVACH Station ⇄ Loco radio interface. It injects, transmits, receives,
              decodes and visualises every Annexure-C packet — bit by bit, field by field — so that what is on the air can be
              generated on demand, verified against the specification and explained to anyone in seconds.
            </Para>
            <Para>
              One tool covers the complete test loop: build a scenario, send it through a real Guardian radio modem or over the
              network, watch the onboard response come back, and prove with CRC checks, live alerts and a moving track profile that
              the system behaved exactly as the specification demands.
            </Para>

            <Section title="◈ WHAT PINJ GIVES YOU">
              <Bullets items={[
                ["Bit-exact decoding", "every field of C.4.2 – C.4.6 with its size, raw bits, decimal value and meaning, plus packet CRC verification."],
                ["Specification-true encoding", "station packets are encoded by the svk_sim.c C library — the user interface never alters packet bits."],
                ["Real hardware, real air", "transmit and receive through a Guardian™ serial radio modem (Radio1 / Radio2 start-of-frame), or simulate it with SIM loopback."],
                ["Live situational awareness", "SOS, emergency and brake events raise pop-ups, Kavach-style beeps, a buzzer per SOS class and your own recorded voice."],
                ["Visual proof", "🚆 LIVE TRACK draws the track profile (SSP, gradient, LC gates, signals, RFID tags, EoA) and moves each loco on it in real time."],
                ["Onboard DMI view", "📡 LIVE → 🚆 DMI rebuilds the Annexure-B LP-OCIP screen of any loco from the radio packets alone — targets, MA, signal, tag read status."],
                ["Capture & replay", "replay a PINJ test log from the Packet Simulator (📂 LOG REPLAY) — the DMI and the LIVE VISUALISER give the identical result on every run."],
                ["Evidence on demand", "colour-coded Excel exports, PNG / SVG chart exports and a stand-alone offline decoder for Windows and Linux."],
              ]} />
            </Section>

            <Section title="⇄ HOW DATA FLOWS">
              <Flow steps={[
                ["SCENARIO", "StoryBoard CSV / XL · Packet Simulator"],
                ["ENCODE", "svk_sim.c via FastAPI backend"],
                ["TRANSMIT", "UDP / HTTP · Guardian serial modem"],
                ["RECEIVE", "serial RX · /ingest · WebSocket"],
                ["DECODE", "bit-level fields · CRC"],
                ["VISUALISE", "LIVE · LIVE TRACK · alerts · Excel"],
              ]} />
            </Section>

            <Section title="▦ PACKET TYPES (ANNEXURE-C)">
              {Object.entries(packetTypes || {}).map(([k, m]) => (
                <div key={k} className="sa-row" style={{ display: "flex", gap: 10, padding: "6px 12px", fontSize: 10, alignItems: "center" }}>
                  <span style={{ width: 58, flexShrink: 0, fontWeight: 700, color: isLight ? m.lightColor : m.color }}>{m.icon} {m.short}</span>
                  <span style={{ width: 62, flexShrink: 0, color: "var(--text-secondary)" }}>type {k}</span>
                  <span style={{ width: 70, flexShrink: 0, color: "var(--text-secondary)" }}>{m.abbr}</span>
                  <span style={{ color: "var(--text-primary)" }}>{m.name}</span>
                </div>
              ))}
            </Section>

            <Section title="⚖ DESIGN PRINCIPLES">
              <Bullets items={[
                ["The specification is the authority", "field names, sizes and value meanings follow RDSO/SPN/196/2020 Annexure-C (Amendment-10)."],
                ["Encoding stays in C", "all station-packet encoding is done exclusively in svk_sim.c (SIL-4 discipline); the browser only displays and sends."],
                ["Nothing is invented", "values that are not in the data are shown as “—”, never guessed."],
                ["A brake is never silent", "if a recorded voice is missing, the beeps play instead."],
              ]} />
            </Section>
          </>}

          {tab === "modules" && <>
            <Section title="⚡ PINJ DECODER — home page">
              <Para><span style={{ display: "block", padding: "8px 12px 0" }}>Decode any packet you have — from a log, a capture or a colleague's message — and see exactly what every bit means.</span></Para>
              <Steps items={[
                <>Press <b>▼ INPUT</b>, paste packet JSON or hex — or drop a log file — or use <b>LOAD SAMPLE C.4.6 / C.4.2</b>.</>,
                <>Press <b>⚡ DECODE</b>. Each packet opens with all fields, raw bits, values, descriptions and the CRC result (✓ PASS / ✗ FAIL).</>,
                <>Use the TDMA timeline and profile view to understand timing and track data; multiple locos are grouped automatically.</>,
                <>Press <b>⬇ XLSX</b> to export the decoded packets (or every packet of the loaded logs) to Excel.</>,
              ]} />
            </Section>

            <Section title="📡 LIVE — real-time feed">
              <Para><span style={{ display: "block", padding: "8px 12px 0" }}>Watch packets the moment they reach the backend — from the Packet Simulator, an external tool or the radio.</span></Para>
              <Steps items={[
                <>Open <b>📡 LIVE</b>. The feed connects to <code>{WS_BASE}/ws/live</code> and shows each packet as it arrives.</>,
                <>External tools post packets to <code>POST {API_BASE}/ingest</code>; the <b>Packet Simulator</b> (<code>/simulator</code>) does exactly this, field by field.</>,
                <>SOS, emergency and brake values raise pop-up alerts with the matching buzzer, beeps or your voice (⚙ Settings → 🔊 SOUND).</>,
                <>Filter by packet type and source (UDP/HTTP, serial TX, serial RX, simulator, log replay), pause / resume the feed, and switch <b>▤ PACKETS / 🚆 DMI / 🗺 PROFILE</b>.</>,
                <>The <b>🚆 LIVE VISUALISER</b> strip shows the tags of the received C.4.2 tag list, the signal, the EoA and each loco moving on the track; <b>🚆 DMI</b> shows the onboard screen (see <i>LIVE DMI &amp; replay</i>).</>,
                <><b>🗺 PROFILE</b> is the same live track view as SVK SIM's “● LIVE MA (ON WIRE)”: the track profile from the C.4.2 on the wire (SSP, gradient, LC gates, turnouts, track conditions, tags, signal, EoA) with each loco's speed trail and brake dots moving on it — from the LIVE packets, so it works for any source (serial, UDP/HTTP, simulator, log replay). Alert sounds play once, from the LIVE page.</>,
                <>Scroll up to read older packets — auto-scroll pauses there; <b>↓ LATEST · n new</b> jumps back to the newest. Each packet appears once, and on a reconnect or reload the backend re-sends the whole session (up to 3000 packets).</>,
                <><b>✕ CLEAR</b> opens a box: <b>CLEAR RANGE</b> (from # → to #, with a count of what goes) only hides rows; <b>CLEAR ALL</b> (click twice to confirm) also resets the DMI, tag status, visualiser and the backend session.</>,
              ]} />
            </Section>

            <Section title="🧪 PACKET SIMULATOR — /simulator">
              <Para><span style={{ display: "block", padding: "8px 12px 0" }}>A second page for test packets: build them field by field, play a DMI scenario or replay a recorded test log.</span></Para>
              <Steps items={[
                <><b>SIMULATOR</b> — choose a packet type and the field values to inject, send once or automatically.</>,
                <><b>DMI SIM</b> — drive loco and station values to exercise the DMI.</>,
                <><b>📂 LOG REPLAY</b> — drop a PINJ log (<code>logs/pinj_test_*.log</code>) or a KAVACH onboard <b>Event Log Viewer</b> log (<code>.txt</code> with <i>Event Name</i> / <i>Data</i> blocks; a leading <code>F1/F2 A5 C3</code> radio prefix is removed) and replay it to <code>/ingest</code> with its original timing (1× … 10×, FAST). Event-log replays are paced by each packet's FRAME_NUM; RFID Data events are shown, not sent.</>,
                <>All three pages keep their state when you switch between them — a loaded log and a running replay continue. The theme follows the DECODEX tab (☀ / ☾ in either tab switches both).</>,
              ]} />
            </Section>

            <Section title="🧩 SVK SIM — station Kavach simulator">
              <Para><span style={{ display: "block", padding: "8px 12px 0" }}>Act as the stationary Kavach: load the route data, play a StoryBoard and talk to the loco over the air.</span></Para>
              <Steps items={[
                <>Open the <b>☰ LOADERS</b> drawer (Ctrl+B) and load the <b>APD</b> track profile, the <b>MA table</b> and the <b>RFID tag table</b> — they appear under <b>▤ STATIC DATA</b>.</>,
                <>Load a <b>StoryBoard</b> (.csv or .xlsx / .xls; lines starting with # are comments). Formats by column count: <b>35 / 37</b> Station → Loco (C.4.2), <b>28</b> Loco → Station Regular (C.4.3 — every column is encoded: AbsLoc, L_DO / L_DU, TrnInt, TrnLen, speed in km/h, tag, TagDup, TagLinkInfo, TIN, Brake, NewMAReply, SigOV, Info-Ack, LocoHealth), <b>19</b> Access Request (C.4.6), <b>15</b> Access Authority (C.4.4), <b>10</b> Additional Emergency (C.4.5).</>,
                <><b>UDP / HTTP:</b> set the destination IP and port and press <b>◈ TRANSMIT STORYBOARD</b> — packets are sent in 2-second TDMA epochs with a live TX log.</>,
                <><b>Serial radio:</b> choose the Guardian port (see <i>Serial modem setup</i>), press <b>TEST PORT</b>, then transmit; the RX side is decoded in <b>📡 SERIAL</b>.</>,
                <>Every Loco → Station packet's LAST_RFID_TAG is looked up in the MA table, so the next Station → Loco packet carries the updated Movement Authority.</>,
                <>Open <b>🚆 LIVE TRACK</b> to see the profile, the loco moving on it, brake dots (NSB / FSB / EB) and the decoded packet strip.</>,
              ]} />
            </Section>

            <Section title="🖥 PINJ DECODER — desktop tool">
              <Para><span style={{ display: "block", padding: "8px 12px" }}>A stand-alone offline decoder for Windows and Linux: radio packets (Annexure-C) and RFID tags, CRC check and a coloured Excel export with one sheet per packet type — no browser or backend needed.</span></Para>
            </Section>
          </>}

          {tab === "dmi" && <>
            <Para strong>📡 LIVE → 🚆 DMI shows what the loco's LP-OCIP would show — built only from the decoded radio packets, region by region as in RDSO/SPN/196/2020 Annexure-B.</Para>

            <Section title="🖥 WHERE EACH REGION COMES FROM">
              <KV k="Loco side" v="C.4.3 / C.4.6 — speed, ABS location, train length, mode, direction, last RFID tag, brake, emergency" />
              <KV k="Track side" v="C.4.2 for this loco (or broadcast) — MA, signal aspect / type / distance, SSP, TSR, turnouts, LC gates, track conditions, tag-linking list (TLI), SoS" />
              <KV k="A · target" v="A4 type per B4.3.8: Collision or SoS first (station DEST_LOCO_SOS 5/6/8, C.4.5 SoS to all, own or nearby loco emergency), else the nearest restriction within 2000 m — EOA, PSR (speed drop in the SSP), TSR, Turn Out — with its distance bar" />
              <KV k="B · speed" v="pointer + speed, permitted band (light green) just outside the dial ticks with a tip at the permitted speed (red while NSB / FSB / EB is applied, yellow on an overspeed warning), target-speed band (dark green), overspeed / brake colours, B7 next lower limit, B11 section speed, LOC" />
              <KV k="Direction" v="MOVEMENT_DIR / PKT_DIR: 1 = Nominal (DOWN) · 2 = Reverse (UP)" />
              <KV k="C · MA" v="remaining Movement Authority = MA_W_R_T_SIG − distance run past LAST_REF_RFID" />
              <KV k="D · signal" v="CUR_SIG_ASPECT lamps, C / IB / G / A / AG marker, distance = APPR_SIG_DIST − run past the tag, D3 line + signal type" />
              <KV k="L · M · tags" v="last tag + direction + next tag distance · tag read status (below)" />
              <KV k="H · I" v="system and SOS messages — two at a time, alternating every 2 s" />
            </Section>

            <Section title="🎯 TARGETS — THE SAME AS THE SPEED GRAPH">
              <Bullets items={[
                ["SSP", "each entry is the speed for the next LM_Static_Speed_Distance metres, chained from the profile start — the same steps as the 🚆 LIVE TRACK speed graph."],
                ["Target", "a speed drop counts when it is below the static (profile) permitted speed; it counts down to 0 and hands over to the next one."],
                ["Braking", "while NSB / FSB / EB is applied, the green band ends at the loco speed."],
                ["Direction", "a C.4.2 is for its PKT_DIR; when the loco runs the other way (e.g. after a trip) its MA, targets and signal are not applied."],
              ]} />
            </Section>

            <Section title="🏷 TAG READ STATUS — REGION M">
              <Steps items={[
                <>All three markers start <b>grey</b>.</>,
                <>When the loco reports a tag (LAST_RFID_TAG), a <b style={{ color: "#16a34a" }}>green</b> marker enters at the top (M1) and the older ones move down (M2, M3).</>,
                <>The expected tags come from the C.4.2 tag-linking list. If the next expected tag is not reported — a later tag is reported first, or the loco runs {app.dmiTagMissM} m past it — a <b style={{ color: "#dc2626" }}>red</b> marker enters instead.</>,
                <>A tag reported late (after it turned red) changes back to green. The full history is in the DMI INPUTS table (“Tag read status”).</>,
              ]} />
            </Section>

            <Section title="🛤 LIVE VISUALISER">
              <Bullets items={[
                ["Track", "the tags of the received C.4.2 tag list at their km (tag table from 🧩 SVK SIM, else derived from the C.4.2 distances); the view stays still, only the loco moves."],
                ["Loco", "yellow cab at the front, body to train length, with Loco Id · Length · Speed · Rfid · Abs.Loc (⚙ Settings → LIVE)."],
                ["Track side", "approaching signal with its lamps, End of Authority and the MA band."],
              ]} />
            </Section>

            <Section title="📂 CAPTURE & REPLAY">
              <Steps items={[
                <>Open the Packet Simulator (<code>/simulator</code>) → <b>📂 LOG REPLAY</b> and drop a PINJ log or an onboard Event Log Viewer log.</>,
                <>In DECODEX press <b>CLEAR</b> on 📡 LIVE, choose <b>🚆 DMI</b> (source filter “Log replay” if other sources are active).</>,
                <>Press <b>▶ PLAY</b> — the <b>NOW SENDING</b> card and the highlighted row show the packet on the air; click any row to start from it.</>,
              ]} />
            </Section>

            <Callout tone="ok">
              <b>Same result on every replay.</b> The DMI depends only on the order of the packets — never on timing or on how many rows the LIVE list keeps:
              the key packets of the session (track profile, tag list, every tag report) are kept, a single ABS_LOCO_LOC glitch is ignored (a real relocation
              is accepted after two agreeing readings), and tags are fixed on the route once. Switching pages never resets it — only CLEAR does.
            </Callout>
          </>}

          {tab === "hardware" && <>
            <Para strong>Connect the Guardian™ serial radio modem to SVK SIM when the backend runs inside WSL.</Para>
            <Callout tone="info">
              WSL does not see Windows USB devices on its own — without these steps only the phantom <code>/dev/ttyS0 … ttyS31</code> ports appear and the real
              adapter never shows up, however often you refresh. <b>usbipd-win</b> shares the USB adapter with WSL; it is installed once with
              <code> winget install usbipd</code>.
            </Callout>

            <Section title="① WINDOWS — TERMINAL “RUN AS ADMINISTRATOR”">
              <div className="sa-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px" }}>
                <span style={{ fontSize: 10.5, color: "var(--text-primary)", fontWeight: 700 }}>BUSID of your adapter</span>
                <input value={busid} onChange={e => setBus(e.target.value)} spellCheck={false} placeholder="e.g. 2-4"
                  style={{ width: 90, padding: "4px 8px", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 11, outline: "none",
                    background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-bright)" }} />
                <span style={{ fontSize: 9.5, color: "var(--text-secondary)" }}>read it from <code>usbipd list</code> — the commands below update</span>
              </div>
              <Cmd where="WIN" cmd="usbipd list" note="Lists the USB devices with their BUSID — find the USB-serial adapter of the Guardian modem." />
              <Cmd where="WIN" cmd={"usbipd bind --busid " + bus} note="Shares the device (once per adapter / USB socket)." />
              <Cmd where="WIN" cmd={"usbipd attach --wsl --busid " + bus} note="Attaches it to WSL — repeat after every re-plug or reboot." />
            </Section>

            <Section title="② WSL — CHECK THE PORT AND GIVE PERMISSION">
              <Cmd where="WSL" cmd="ls -l /dev/ttyUSB*" note="The adapter appears as /dev/ttyUSB0 (or ttyUSB1 …)." />
              <Cmd where="WSL" cmd="sudo chmod 0777 /dev/ttyUSB0" note="Lets the backend open the port. Needed again after every re-attach." />
              <Cmd where="WSL" cmd="sudo usermod -aG dialout $USER" note="Optional, permanent alternative to chmod: add yourself to the dialout group, then restart WSL (wsl --shutdown)." />
            </Section>

            <Section title="③ SVK SIM — USE THE PORT">
              <Steps items={[
                <>Open <b>🧩 SVK SIM</b> → <b>☰ LOADERS</b> → <b>SERIAL RADIO MODEM</b> and press <b>↺</b> (re-scan) — <code>/dev/ttyUSB0</code> is listed.</>,
                <>Select it and set the Guardian COM settings — factory default 57600 baud, 8N1, DOX with DOX delay 6 (match the modem's own setup).</>,
                <>Press <b>TEST PORT</b>: <b>HARDWARE MODE — VERIFIED</b> means the backend really opened the modem; <b>NOT CONNECTED — USING SIMULATION</b> means it fell back to the loopback simulator.</>,
                <>Choose <b>Radio1 (0xF1)</b> or <b>Radio2 (0xF2)</b> — the start-of-frame prefix — and transmit.</>,
              ]} />
            </Section>

            <Callout tone="warn">
              <b>When you are done:</b> <code>usbipd detach --busid {bus}</code> (Windows) gives the adapter back to Windows. Use <b>SIM_LOOPBACK</b> whenever no
              hardware should be touched — it behaves like a modem without sending anything on air.
            </Callout>
          </>}

          {tab === "sound" && <>
            <Para strong>PINJ speaks the language of the cab: every safety-relevant event has its own sound, so you hear what happens before you look.</Para>
            <Section title="🛑 BRAKE INDICATION — BEEP SOUND OR YOUR VOICE (one at a time)">
              <KV k="NSB · Brake = 2" v="steady beep (880 Hz) · or your “Normal Service Brake” recording" />
              <KV k="FSB · Brake = 3" v="higher beep (1175 Hz) · or your “Full Service Brake” recording" />
              <KV k="EB · Brake = 4" v="urgent two-tone alarm · or your “Emergency Brake” recording" />
              <KV k="Overspeed · = 1" v="your “Overspeed” recording (voice only)" />
              <KV k="When" v="📡 LIVE: on a new brake per loco, repeated every 10 s while it stays applied · 🚆 LIVE TRACK: with each brake dot" />
              <KV k="Now selected" v={(snd.enabled ? "" : "SOUND ALERTS OFF · ") + (snd.brakeIndication === "voice" ? "🗣 VOICE" : "🔔 BEEP SOUND")} color={snd.enabled ? "var(--green)" : "var(--red)"} />
            </Section>
            <Section title="🚨 SOS BUZZER — ONE PATTERN PER CONDITION">
              <KV k="COLLISION" v="rapid two-tone klaxon — head-on, rear-end, side collision / unusual stoppage, SPAD" color="var(--red)" />
              <KV k="SOS" v="Morse ··· ––– ··· — SoS, manual SoS, parting SoS, station general SoS, C.4.5 emergency packet" color="var(--orange)" />
              <KV k="CAUTION" v="two long low buzzes — roll back, foreign RFID, odometer error ≥ 120 m, shunting limit" color="var(--amber-text)" />
            </Section>
            <Callout tone="ok">
              <b>Priority:</b> NSB → FSB → EB → Caution → SoS → Collision. A more serious alert always takes over; a lesser one never cuts it off.
              Everything is set in ⚙ Settings → 🔊 SOUND; the master switch mutes all alerts and keeps your choices.
            </Callout>
          </>}

          {tab === "help" && <>
            {[
              ["BACKEND shows OFFLINE", "Start the FastAPI backend on port 8000. Decoding, LIVE and SVK SIM all depend on it; the status dot turns green when it answers /health."],
              ["The USB adapter is not in the port list", "Run the usbipd attach step (🔌 Serial modem setup) and press ↺ in the SERIAL RADIO MODEM panel. Also make sure pyserial is installed in the backend's Python environment — without it no port can be listed."],
              ["“Permission denied” on /dev/ttyUSB0", "sudo chmod 0777 /dev/ttyUSB0 after each attach, or join the dialout group once."],
              ["TEST PORT says “NOT CONNECTED — USING SIMULATION”", "The backend could not open the real device and fell back to the simulator — check the device path, the cable and that no other program holds the port."],
              ["CRC FAIL on a packet", "The payload was altered, truncated or its bytes are in the wrong order. Compare the hex with the source; the decoded fields still show what was received."],
              ["LIVE shows no packets", `The LIVE status must read LIVE, not OFFLINE (it connects to ${WS_BASE}/ws/live). Tools must POST to /ingest; the Packet Simulator does this for you.`],
              ["No sound at all", "Click once anywhere on the page (browsers block audio until the first click), then check ⚙ → 🔊 SOUND → Sound alerts. LIVE TRACK sounds can be limited to when it is on screen."],
              ["Voice recording not playing", "⚙ → 🔊 SOUND → select 🗣 VOICE, press ↻ RE-CHECK; files go in frontend/public/sounds/voice/ (brake-overspeed / -nsb / -fsb / -eb)."],
              ["LIVE TRACK chart looks wrong after a new run", "Press ⟲ CLEAR — the next packets start a fresh chart (a new transmission does this automatically)."],
              ["DMI tag status / direction wrong after a replay", "Press CLEAR → CLEAR ALL on 📡 LIVE before replaying a log again — otherwise two runs are mixed in one session. Switching pages or reloading keeps the session: the backend re-sends it (up to 3000 packets)."],
              ["The same packet appears several times in LIVE", "Reload the page (F5) — an older version kept extra LIVE connections open. Now each backend packet # is listed once."],
              ["L2S (C.4.3) fields are 0 although the StoryBoard has values", "Restart the backend so svk_sim.so is rebuilt from the updated svk_sim.c (it rebuilds automatically when the .c file is newer). The 28-column L2S StoryBoard then sends every column."],
              ["Direction shows UP / DOWN the wrong way round", "1 = Nominal = DOWN, 2 = Reverse = UP everywhere (decoder, LIVE, DMI, SVK SIM, Simulator). Restart the backend if the decoded text still says “Nominal (UP)”."],
              ["DMI shows no MA, target or signal", "No C.4.2 for this loco yet, the MA is unknown (SR, 65535), or the loco is moving opposite to the C.4.2 PKT_DIR (e.g. after a trip) — the DMI INPUTS row “Position vs ref tag” says which."],
              ["A tag shows red on the DMI", "It is in the C.4.2 tag-linking list but the loco never reported it — a later tag came first or the loco ran past it (⚙ Settings → LIVE → Missed tag after)."],
            ].map(([q, a]) => (
              <Section key={q} title={"❓ " + q.toUpperCase()}>
                <div style={{ padding: "8px 12px", fontSize: 10.5, lineHeight: 1.65, color: "var(--text-secondary)" }}>{a}</div>
              </Section>
            ))}
          </>}

          {tab === "system" && <>
            <Section title="⚙ BACKEND">
              <KV k="Status" v={be[0]} color={be[1]} />
              <KV k="Web app" v={window.location.origin + "  ·  Packet Simulator: " + window.location.origin + "/simulator"} />
              <KV k="REST API" v={API_BASE + " — /decode · /health · /ingest · /live/* · /svk/*"} />
              <KV k="WebSockets" v="/ws/live (LIVE feed — one connection per page; the session, up to 3000 packets, is re-sent on connect) · /ws/serial_log (SVK SIM serial log)" />
              <KV k="Encoder" v="svk_sim_py.py (pure-Python port of svk_sim.c, byte-identical) through the FastAPI bridge (svk_sim_bridge.py)" />
            </Section>

            <Section title="▤ THIS SESSION">
              <KV k="Current page" v={PAGE_NAMES[page] || page} />
              <KV k="Decoded packets" v={session.decoded ? session.decoded + " packet(s)" : "none yet"} color={session.decoded ? undefined : "var(--text-secondary)"} />
              <KV k="Log files" v={session.logFiles ? session.logFiles + " file(s) · " + session.logPackets + " packet(s)" : "none loaded"} color={session.logFiles ? undefined : "var(--text-secondary)"} />
              {svk.files.map(f => <KV key={f.key} k={"SVK · " + f.label} v={f.info || "not loaded"} color={f.info ? undefined : "var(--text-secondary)"} />)}
              <KV k="SVK · UDP / HTTP TX" v={txText(svk.txState) + " · dest " + svk.destIp} color={svk.txState === "transmitting" ? "var(--orange)" : undefined} />
              <KV k="SVK · Serial TX" v={txText(svk.serialTxState) + " · " + svk.serialDevice + (svk.baud ? " @ " + svk.baud : "")} color={svk.serialTxState === "transmitting" ? "var(--purple)" : undefined} />
              <KV k="SVK · Radio" v={"RADIO" + svk.radioId + " · SoF 0xF" + svk.radioId + " 0xA5 0xC3"} />
              <KV k="Alert sounds" v={snd.enabled ? "ON · brake: " + (snd.brakeIndication === "voice" ? "voice" : "beeps") : "OFF"} color={snd.enabled ? undefined : "var(--red)"} />
            </Section>

            <Section title="⌨ SHORTCUTS">
              <KV k="Ctrl + ," v="open ⚙ Settings" />
              <KV k="Ctrl + B" v="SVK SIM — open / close the loaders drawer" />
              <KV k="Esc" v="close Settings / About / the ⚙ menu" />
            </Section>
          </>}
        </div>
      </div>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ☰ APP MENU — one gear button at the far right of the top bar;
   its dropdown holds Settings, theme, About and the shortcuts.
   The dropdown is position:fixed because .kv-topbar clips overflow.
═══════════════════════════════════════════════════════════════ */
const MENU_CSS = `
  .kv-menu-btn { position: relative; width: 34px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer; padding: 0; flex-shrink: 0; transition: all 0.18s;
    border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: #cbd5e1; }
  .kv-menu-btn svg { transition: transform 0.45s cubic-bezier(0.4,0,0.2,1); }
  .kv-menu-btn:hover { border-color: rgba(245,166,35,0.55); color: #f5a623; background: rgba(245,166,35,0.07); }
  .kv-menu-btn:hover svg, .kv-menu-btn.open svg { transform: rotate(60deg); }
  .kv-menu-btn.open { border-color: #f5a623; color: #f5a623; background: rgba(245,166,35,0.12); box-shadow: 0 0 10px rgba(245,166,35,0.25); }
  :root.light .kv-menu-btn { border-color: #d6dee9; background: #ffffff; color: #334155; box-shadow: 0 1px 2px rgba(15,23,42,0.06); }
  :root.light .kv-menu-btn:hover { border-color: #0284c7; color: #0284c7; background: #f0f9ff; }
  :root.light .kv-menu-btn.open { border-color: #0284c7; color: #0284c7; background: #e0f2fe; box-shadow: 0 0 0 3px rgba(2,132,199,0.12); }
  .kv-menu-sep { width: 1px; height: 22px; background: rgba(255,255,255,0.10); margin: 0 2px; flex-shrink: 0; }
  :root.light .kv-menu-sep { background: #d6dee9; }

  @keyframes kv-menu-in { from { opacity: 0; transform: translateY(-6px) scale(0.98); } to { opacity: 1; transform: none; } }
  .kv-menu { width: 272px; border-radius: 10px; overflow: hidden; font-family: var(--font-mono);
    background: #0a1019; border: 1px solid #22303f;
    box-shadow: 0 18px 50px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.2); animation: kv-menu-in 0.16s ease-out; transform-origin: top right; }
  :root.light .kv-menu { background: #ffffff; border-color: #d6dee9; box-shadow: 0 18px 50px rgba(15,23,42,0.18), 0 2px 8px rgba(15,23,42,0.08); }
  .kv-menu-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #1c2735; background: #0f1724; }
  :root.light .kv-menu-head { background: #f6f8fc; border-color: #e2e8f0; }
  .kv-menu-group { padding: 6px; }
  .kv-menu-group + .kv-menu-group { border-top: 1px solid #1c2735; }
  :root.light .kv-menu-group + .kv-menu-group { border-color: #e2e8f0; }
  .kv-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 6px; border: none;
    background: transparent; color: var(--text-primary); cursor: pointer; font-family: var(--font-mono); font-size: 11px;
    font-weight: 700; letter-spacing: 0.04em; text-align: left; }
  .kv-menu-item:hover, .kv-menu-item:focus-visible { background: #142032; outline: none; }
  :root.light .kv-menu-item { color: #0f172a; }
  :root.light .kv-menu-item:hover, :root.light .kv-menu-item:focus-visible { background: #f1f5f9; }
  .kv-menu-ico { width: 18px; text-align: center; font-size: 13px; color: var(--text-secondary); }
  .kv-menu-kbd { margin-left: auto; font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 4px;
    border: 1px solid var(--border-bright); color: var(--text-secondary); background: var(--bg-input); }
  :root.light .kv-menu-kbd { border-color: #d6dee9; background: #f8fafc; color: #475569; }
  .kv-menu-label { font-size: 8.5px; font-weight: 700; letter-spacing: 0.16em; color: var(--text-secondary); padding: 6px 10px 4px; opacity: 0.8; }
  .kv-menu-row { display: flex; align-items: center; gap: 10px; padding: 5px 10px; font-size: 10px; color: var(--text-secondary); }
  :root.light .kv-menu-row { color: #475569; }
`;

function GearIcon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function AppMenu({ isLight, setIsLight, backendOk, onSettings, onAbout }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen(o => !o);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = e => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = e => { if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); } };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    menuRef.current?.querySelector(".kv-menu-item")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);
  const pick = fn => () => { setOpen(false); fn(); };
  const me = useCurrentUser();
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (me?.role !== "admin") return;
    const poll = () => hub("/hub/users").then(r => setPending(r.pending || 0)).catch(() => { });
    poll();
    const t = setInterval(poll, 30000);
    return () => clearInterval(t);
  }, [me?.role]);
  const be = backendOk === true ? ["ONLINE", "var(--green)"] : backendOk === false ? ["OFFLINE", "var(--red)"] : ["CHECKING", "var(--amber)"];

  return (
    <>
      <style>{MENU_CSS}</style>
      <span className="kv-menu-sep" aria-hidden="true" />
      <button ref={btnRef} onClick={toggle} className={"kv-menu-btn" + (open ? " open" : "")}
        title="Menu — Settings · Theme · About" aria-haspopup="menu" aria-expanded={open}>
        <GearIcon />
        {pending > 0 && <span title={`${pending} account request(s) waiting`} style={{ position: "absolute", top: -3, right: -3, minWidth: 14, height: 14,
          borderRadius: 7, background: "var(--amber)", color: "#000", fontSize: 8.5, fontWeight: 800, lineHeight: "14px", textAlign: "center", padding: "0 3px" }}>{pending}</span>}
      </button>
      {open && pos && (
        <div ref={menuRef} role="menu" className="kv-menu" style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 4000 }}>
          <div className="kv-menu-head">
            <img src="/nova-mark.png" alt="" draggable={false} style={{ width: 30, height: 30, objectFit: "contain" }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.1em", color: "var(--text-primary)" }}>PINJ <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>v4.0</span></div>
              <div style={{ fontSize: 8.5, color: "var(--text-secondary)", marginTop: 2, letterSpacing: "0.05em" }}>Kavach Packet Injector &amp; Decoder</div>
            </div>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", color: be[1] }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: be[1], boxShadow: "0 0 6px " + be[1] }} />{be[0]}
            </span>
          </div>

          {me && (
            <div className="kv-menu-group">
              <div className="kv-menu-label">SIGNED IN AS</div>
              <div className="kv-menu-row" style={{ alignItems: "center" }}>
                <span className="kv-menu-ico">👤</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 11, fontWeight: 800, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me.full_name}</span>
                  <span style={{ display: "block", fontSize: 9, color: "var(--text-secondary)" }}>@{me.username} · {me.role}</span>
                </span>
              </div>
              <button role="menuitem" className="kv-menu-item" onClick={pick(() => onSettings("profile"))}>
                <span className="kv-menu-ico">✎</span>My profile
              </button>
              {me.role === "admin" && (
                <button role="menuitem" className="kv-menu-item" onClick={pick(() => onSettings("users"))}>
                  <span className="kv-menu-ico">👥</span>Users
                  {pending > 0 && <span className="kv-menu-kbd" style={{ color: "var(--amber)", borderColor: "var(--amber)" }}>{pending} waiting</span>}
                </button>
              )}
              <button role="menuitem" className="kv-menu-item" onClick={pick(signOut)} style={{ color: "var(--red)" }}>
                <span className="kv-menu-ico">⏻</span>Sign out
              </button>
            </div>
          )}

          <div className="kv-menu-group">
            <button role="menuitem" className="kv-menu-item" onClick={pick(() => onSettings())}>
              <span className="kv-menu-ico">⚙</span>Settings<span className="kv-menu-kbd">Ctrl+,</span>
            </button>
            <button role="menuitem" className="kv-menu-item" onClick={pick(onAbout)}>
              <span className="kv-menu-ico">ⓘ</span>About PINJ
            </button>
          </div>

          <div className="kv-menu-group">
            <div className="kv-menu-label">APPEARANCE</div>
            <div className="kv-menu-row">
              <span className="kv-menu-ico">◐</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>Theme</span>
              <span style={{ marginLeft: "auto" }}>
                <Choice value={isLight ? "light" : "dark"} options={[["dark", "☾ DARK"], ["light", "☀ LIGHT"]]} onChange={v => setIsLight(v === "light")} />
              </span>
            </div>
          </div>

          <div className="kv-menu-group">
            <div className="kv-menu-label">SHORTCUTS</div>
            <div className="kv-menu-row">Open settings<span className="kv-menu-kbd">Ctrl+,</span></div>
            <div className="kv-menu-row">SVK SIM loaders drawer<span className="kv-menu-kbd">Ctrl+B</span></div>
            <div className="kv-menu-row">Close a window / menu<span className="kv-menu-kbd">Esc</span></div>
          </div>
        </div>
      )}
    </>
  );
}
