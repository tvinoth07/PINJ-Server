/**
 * DmiSim.jsx — 🚆 DMI SIM page of the Packet Simulator (/simulator).
 *
 * Left:  the SAME LP-OCIP screen as the 📡 LIVE → DMI page (DmiPanel.jsx DmiScreen + buildDmi),
 *        drawn from the packets this page sent, after the backend decoded them (/ws/live,
 *        source "dmi-*"). So what you see here is exactly what the LIVE DMI decodes.
 * Right: inputs for every packet field that drives a DMI region (Annexure-B A … M), grouped
 *        by packet: own loco (C.4.3 / C.4.6), station C.4.2 (header, MA + signal, track
 *        profile), station C.4.5 SoS and another loco (collision / SoS from loco).
 * Packets are built bit-exactly by dmiSimEncoder.js and posted to /ingest.
 */
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { DmiScreen, buildDmi, createDmiKeeper, mergeKept, MODES, LINE_ABBR, SIG_ABBR, ASPECT_NAME } from "./DmiPanel";
import { tagTableStore, appSettingsStore, useStore } from "./SettingsAbout";
import { buildC42, buildC43, buildC45, buildC46, sigInfo } from "./dmiSimEncoder";

const INGEST_URL = "http://localhost:8000/ingest";
const WS_URL = "ws://localhost:8000/ws/live";

/* ── option lists (values = Annexure-C codes) ── */
const MODE_OPTS = Object.entries(MODES).map(([v, m]) => [+v, `${m.key} · ${m.text}`]);
const ASPECT_OPTS = [[0, "0 · Unidentified (no signal shown)"], ...Object.entries(ASPECT_NAME).map(([v, n]) => [+v, `${v} · ${n}`])];
const NEXT_ASPECT_OPTS = [[0, "0 · Undefined (current is Red)"], ...Object.entries(ASPECT_NAME).map(([v, n]) => [+v, `${v} · ${n}`])];
const SIG_TYPE_OPTS = [[0, "0 · none"], ...Object.entries(SIG_ABBR).map(([v, n]) => [+v, `${(+v).toString(2).padStart(6, "0")} · ${n}`])];
const LINE_OPTS = Object.entries(LINE_ABBR).map(([v, n]) => [+v, `${(+v).toString(2).padStart(4, "0")} · ${n}`]);
const DIR_OPTS = [[1, "1 · Nominal (DOWN)"], [2, "2 · Reverse (UP)"], [0, "0 · Unidentified"]];
const EMG_OPTS = [[0, "0 · No emergency"], [1, "1 · Unusual stoppage / stopped in block"], [2, "2 · SoS (manual)"], [3, "3 · Roll back"],
  [4, "4 · Head-on collision"], [5, "5 · Rear-end collision"], [6, "6 · Parting SoS (train parted)"]];
const BRAKE_OPTS = [[0, "0 · None"], [1, "1 · Over speed, no brake"], [2, "2 · Normal Service Brake"], [3, "3 · Full Service Brake"], [4, "4 · Emergency Brake"]];
const TAGLINK_OPTS = [[0, "0 · No tag missing"], [1, "1 · Duplicate tag missing"], [2, "2 · Main tag missing"], [3, "3 · Both tags missing"],
  [4, "4 · Tag position interchanged"], [5, "5 · Same location info"], [6, "6 · Intertag < DIST_DUP_TAG"], [7, "7 · Intertag > DIST_DUP_TAG"]];
const SOS_OPTS = [[0, "0 · None"], [1, "1 · Foreign RFID"], [3, "3 · Onboard odo error ≥ 120 m"], [4, "4 · SPAD detected"], [5, "5 · Rear-end collision"],
  [6, "6 · Head-on collision"], [7, "7 · Shunting limits exceeded"], [8, "8 · Station General SoS (this loco)"]];
const AUTH_OPTS = [[2, "2 · FS authority"], [1, "1 · OS authority (+ speed)"], [3, "3 · SR authority"]];
const SECTION_OPTS = [[0, "0 · Station section"], [1, "1 · Absolute block"], [2, "2 · Autoblock"]];
const COND_OPTS = [[1, "1 · Dead stop"], [2, "2 · Radio hole"], [3, "3 · Non stopping area"], [4, "4 · Tunnel stopping area"], [5, "5 · Neutral section"],
  [6, "6 · Sound horn"], [7, "7 · Reversing area"], [8, "8 · Fouling mark"], [9, "9 · KAVACH territory exit"]];
const PKT_OPTS = [["c43", "C.4.3 Regular"], ["c46", "C.4.6 Access Request"], ["both", "C.4.3 + C.4.6"]];

/* ── defaults: a 3 km run from RFID 498 (values from the T498 MA table) ── */
const DEFAULT_PROFILE = {
  ssp: [{ len: 761, speed: 110 }, { len: 917, speed: 100 }, { len: 1600, speed: 90 }],
  grad: [{ dist: 0, up: 0, value: 0 }, { dist: 900, up: 1, value: 5 }],
  lc: [{ dist: 1450, id: 57, unmanned: 0 }],
  turnouts: [{ speed: 30, dist: 2700, release: 150 }],
  tags: [{ dist: 200, id: 500 }, { dist: 200, id: 502 }, { dist: 300, id: 504 }, { dist: 300, id: 506 }, { dist: 500, id: 508 }],
  conds: [],
  tsr: [],
};
const DEFAULT = {
  /* own loco — C.4.3 / C.4.6 */
  locoId: 188423, speed: 0, loc: 135000, trainLen: 650, mode: 4, dir: 1, emg: 0, brake: 0, lastTag: 498, tagLink: 0,
  autoRun: false, autoTags: true, missTags: "", locoPkt: "c43", locoMs: 1000, locoAuto: false,
  /* station — C.4.2 header */
  stnId: 431, toAll: false, refProfId: 1, lastRefRfid: 498, refTagAbs: 135000, dps: 0, pktDir: 1,
  stMs: 2000, stAuto: false, profEvery: true,
  /* C.4.2 MA sub-packet */
  destLocoSos: 0, sectionType: 1, sigStop: 0, sigOverride: 0, sigType: 0b011000, sigLine: 1, sigLineNo: 1,
  aspect: 11, nextAspect: 10, apprSigDist: 1202, authorityType: 2, authorizedSpeed: 25,
  maWrtSig: 3230, maUnknown: false, reqShortenMa: false, newMa: 1500,
  profile: DEFAULT_PROFILE,
  /* C.4.5 */
  stnLoc: 135000,
  /* other loco */
  oLocoId: 200001, oLoc: 135800, oSpeed: 0, oEmg: 0, oMode: 4, oDir: 1, oAuto: false,
};

/* ── scenario presets (each only changes what it names; signal presets also set the signal type) ── */
const HOME = 0b011000;
const PRESETS = [
  { k: "fs", label: "FS run · Green", c: "#10b981", p: { mode: 4, speed: 60, aspect: 11, nextAspect: 10, sigType: HOME, authorityType: 2, maUnknown: false, destLocoSos: 0, emg: 0, brake: 0, autoRun: true, locoAuto: true, stAuto: true } },
  { k: "dy", label: "Double Yellow", c: "#dfdf00", p: { aspect: 10, nextAspect: 2, sigType: HOME } },
  { k: "route", label: "Yellow + Route 2", c: "#dfdf00", p: { aspect: 4, nextAspect: 1, sigType: HOME } },
  { k: "red", label: "Red · EoA", c: "#ef4444", p: { aspect: 1, nextAspect: 0, sigType: HOME, maUnknown: false, maWrtSig: 1300, apprSigDist: 1300 } },
  { k: "calon", label: "Calling-On", c: "#ffffff", p: { aspect: 15, sigType: 0b000100, nextAspect: 0 } },
  { k: "os", label: "OS 25 kmph", c: "#06b6d4", p: { mode: 6, authorityType: 1, authorizedSpeed: 25, speed: 20, maUnknown: false } },
  { k: "sr", label: "SR · MA unknown", c: "#f59e0b", p: { mode: 2, authorityType: 3, maUnknown: true } },
  { k: "trip", label: "Trip · EB", c: "#ef4444", p: { mode: 7, brake: 4, speed: 0, autoRun: false } },
  { k: "over", label: "Over speed", c: "#f59e0b", p: { speed: 118, brake: 1 } },
  { k: "spad", label: "SPAD", c: "#ef4444", p: { destLocoSos: 4, brake: 4 } },
  { k: "stsos", label: "Station SoS", c: "#ef4444", p: { destLocoSos: 8 } },
  { k: "selfsos", label: "Self SoS", c: "#ef4444", p: { emg: 2 } },
  { k: "clear", label: "Clear alarms", c: "#8888aa", p: { destLocoSos: 0, emg: 0, brake: 0, oEmg: 0 } },
];

/* ── region sweeps: step one field through every value, so each region state can be checked
      on the DMI (here and on 📡 LIVE → DMI). [field, values, label of a value] ── */
const ASPECT_SWEEP = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 48];
const SWEEPS = [
  { k: "aspect", label: "Signal aspects + route indicators", r: "D1", field: "aspect", values: ASPECT_SWEEP, name: v => `${v} · ${ASPECT_NAME[v]}`, base: { sigType: HOME } },
  { k: "sigType", label: "Signal types (D3 name + marker)", r: "D1 D3", field: "sigType", values: Object.keys(SIG_ABBR).map(Number), name: v => SIG_ABBR[v], base: { aspect: 2 } },
  { k: "line", label: "Line names", r: "D3", field: "sigLine", values: Object.keys(LINE_ABBR).map(Number), name: v => LINE_ABBR[v] },
  { k: "mode", label: "Loco modes", r: "B10 G", field: "mode", values: Object.keys(MODES).map(Number), name: v => `${MODES[v].key} · ${MODES[v].text}` },
  { k: "brake", label: "Brake levels", r: "B8 I", field: "brake", values: [0, 1, 2, 3, 4], name: v => BRAKE_OPTS[v][1] },
  { k: "sos", label: "Station DEST_LOCO_SOS", r: "A H I", field: "destLocoSos", values: SOS_OPTS.map(o => o[0]), name: v => SOS_OPTS.find(o => o[0] === v)[1] },
  { k: "emg", label: "Own EMERGENCY_STATUS", r: "A H I", field: "emg", values: EMG_OPTS.map(o => o[0]), name: v => EMG_OPTS[v][1] },
  { k: "auth", label: "Authority type", r: "B3 C", field: "authorityType", values: [2, 1, 3], name: v => AUTH_OPTS.find(o => o[0] === v)[1] },
];

/* ═══════════════════════════════════════════════════════════════
   LIVE feed: this page's decoded packets, kept exactly like the LIVE page does
═══════════════════════════════════════════════════════════════ */
function useDmiSimFeed() {
  const [packets, setPackets] = useState([]);
  const [wsState, setWsState] = useState("connecting");
  const keeper = useRef(null);
  if (!keeper.current) keeper.current = createDmiKeeper();
  const [ver, setVer] = useState(0);
  const cutoff = useRef(0);                                  // packets received before this (ms) belong to an earlier run
  useEffect(() => {
    let ws, retry, dead = false;
    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setWsState("open");
      ws.onclose = () => { setWsState("closed"); if (!dead) retry = setTimeout(connect, 2000); };
      ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
      ws.onmessage = ev => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "session_cleared") { keeper.current.reset(); setPackets([]); setVer(v => v + 1); return; }
        // only live packets sent by this page (history from earlier runs is ignored)
        if (msg.type !== "packet" || !String(msg.data?.source || "").startsWith("dmi-")) return;
        const p = msg.data;
        if ((p.received_at || 0) * 1000 < cutoff.current) return;
        if (keeper.current.ingest(p)) setVer(v => v + 1);
        setPackets(prev => [...prev, p].slice(-600));
      };
    };
    connect();
    return () => { dead = true; clearTimeout(retry); try { ws.close(); } catch { /* ignore */ } };
  }, []);
  /* start a clean run: drop everything so far, and anything still in flight from the old run
     (stamped by the backend within the next 600 ms) */
  const reset = useCallback(() => {
    cutoff.current = Date.now() + 600;
    keeper.current.reset(); setPackets([]); setVer(v => v + 1);
  }, []);
  const merged = useMemo(() => mergeKept(packets, keeper.current.packets()), [packets, ver]);
  return { packets: merged, wsState, reset };
}

/* ═══════════════════════════════════════════════════════════════
   small form controls
═══════════════════════════════════════════════════════════════ */
const mono = { fontFamily: "var(--mono)" };
const inpS = { width: "100%", padding: "5px 7px", borderRadius: 5, background: "var(--inp)", border: "1px solid var(--bdr)", color: "var(--tp)", fontSize: 11, outline: "none", ...mono };
function Rg({ r }) {                                            // which DMI regions a field feeds
  return <span title="DMI region(s) this value drives" style={{ ...mono, fontSize: 8, fontWeight: 700, color: "#00FF00", border: "1px solid #00ff0040", borderRadius: 3, padding: "0 4px", marginLeft: 5, whiteSpace: "nowrap" }}>{r}</span>;
}
function Field({ label, r, children, span }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, gridColumn: span ? `span ${span}` : undefined }}>
      <span style={{ ...mono, fontSize: 9, color: "var(--ts)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}{r && <Rg r={r} />}</span>
      {children}
    </label>
  );
}
function Num({ label, r, value, onChange, min = 0, max, step = 1, span, disabled }) {
  return (
    <Field label={label} r={r} span={span}>
      <input type="number" value={value} min={min} max={max} step={step} disabled={disabled} style={{ ...inpS, opacity: disabled ? 0.45 : 1 }}
        onChange={e => { const v = e.target.value === "" ? 0 : Number(e.target.value); onChange(max != null ? Math.min(max, Math.max(min, v)) : Math.max(min, v)); }} />
    </Field>
  );
}
function Sel({ label, r, value, onChange, opts, span }) {
  return (
    <Field label={label} r={r} span={span}>
      <select value={value} onChange={e => { const o = opts.find(x => String(x[0]) === e.target.value); onChange(o ? o[0] : e.target.value); }} style={{ ...inpS, cursor: "pointer" }}>
        {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </Field>
  );
}
function Chk({ label, r, value, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", ...mono, fontSize: 10, color: value ? "var(--tp)" : "var(--ts)", alignSelf: "end", paddingBottom: 5 }}>
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} style={{ accentColor: "var(--amber)" }} />{label}{r && <Rg r={r} />}
    </label>
  );
}
function Grid({ cols = 3, children }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "7px 8px" }}>{children}</div>;
}
function Section({ title, sub, color, right, children, open: open0 = true }) {
  const [open, setOpen] = useState(open0);
  return (
    <div style={{ border: "1px solid var(--bdr)", borderLeft: `3px solid ${color}`, borderRadius: 8, background: "var(--surf)", flexShrink: 0 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", cursor: "pointer", borderBottom: open ? "1px solid var(--bdr)" : "none" }}>
        <span style={{ ...mono, fontSize: 10, fontWeight: 700, color, letterSpacing: ".08em" }}>{open ? "▾" : "▸"} {title}</span>
        {sub && <span style={{ ...mono, fontSize: 9, color: "var(--tm)" }}>{sub}</span>}
        <span style={{ marginLeft: "auto" }} onClick={e => e.stopPropagation()}>{right}</span>
      </div>
      {open && <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 9 }}>{children}</div>}
    </div>
  );
}
function Btn({ children, onClick, color = "var(--amber)", solid, disabled, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{ padding: "5px 11px", borderRadius: 5, border: `1px solid ${color}`, background: solid ? color : "transparent",
      color: solid ? "#05070b" : color, ...mono, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</button>
  );
}
/** editable list of profile rows */
function Rows({ title, r, cols, rows, onChange, max = 31, blank }) {
  const set = (i, k, v) => onChange(rows.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ ...mono, fontSize: 9, fontWeight: 700, color: "var(--tp)" }}>{title}</span>{r && <Rg r={r} />}
        <span style={{ ...mono, fontSize: 9, color: "var(--tm)" }}>{rows.length ? `${rows.length} row(s)` : "not sent"}</span>
        <span style={{ marginLeft: "auto" }}>
          <Btn color="var(--cyan)" disabled={rows.length >= max} onClick={() => onChange([...rows, { ...blank }])}>＋ row</Btn>
        </span>
      </div>
      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: `${cols.map(c => c.w || "1fr").join(" ")} 22px`, gap: "3px 5px", alignItems: "center" }}>
          {cols.map(c => <span key={c.k} style={{ ...mono, fontSize: 8, color: "var(--tm)" }}>{c.label}</span>)}<span />
          {rows.map((row, i) => [
            ...cols.map(c => c.opts ? (
              <select key={c.k + i} value={row[c.k]} onChange={e => set(i, c.k, Number(e.target.value))} style={{ ...inpS, padding: "3px 4px", fontSize: 10 }}>
                {c.opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            ) : c.chk ? (
              <input key={c.k + i} type="checkbox" checked={!!row[c.k]} onChange={e => set(i, c.k, e.target.checked ? 1 : 0)} style={{ accentColor: "var(--amber)", justifySelf: "start" }} />
            ) : (
              <input key={c.k + i} type="number" value={row[c.k]} min={c.min ?? 0} max={c.max} onChange={e => set(i, c.k, Math.min(c.max ?? 1e9, Math.max(c.min ?? 0, Number(e.target.value) || 0)))}
                style={{ ...inpS, padding: "3px 5px", fontSize: 10 }} />
            )),
            <button key={"x" + i} onClick={() => onChange(rows.filter((_, j) => j !== i))} title="remove row"
              style={{ border: "1px solid var(--bdr)", background: "transparent", color: "var(--red)", borderRadius: 4, fontSize: 10, height: 22 }}>✕</button>,
          ])}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   helpers
═══════════════════════════════════════════════════════════════ */
const missSet = s => new Set(String(s || "").split(/[\s,;]+/).map(Number).filter(n => n > 0));
/** RFID tags of the C.4.2 route on the ABS scale: ref tag + tag-linking list (as buildDmi places them) */
function routeTags(s, tagLoc) {
  const sg = s.dir === 2 ? -1 : 1;
  const ref = tagLoc[s.lastRefRfid] ?? s.refTagAbs;
  const out = [{ id: s.lastRefRfid, pos: ref }];
  let cum = 0;
  for (const t of s.profile.tags) { cum += t.dist || 0; out.push({ id: t.id, pos: tagLoc[t.id] ?? ref + sg * ((s.dps || 0) + cum) }); }
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   PAGE
═══════════════════════════════════════════════════════════════ */
export default function DmiSim({ be }) {
  const [s, setS] = useState(DEFAULT);
  const R = useRef(s);
  R.current = s;
  const upd = useCallback(patch => setS(p => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) })), []);
  const setProf = useCallback((k, rows) => setS(p => ({ ...p, profile: { ...p.profile, [k]: rows } })), []);

  const { packets, wsState, reset: resetFeed } = useDmiSimFeed();
  const { tags } = useStore(tagTableStore);
  const { dmiTagMissM } = useStore(appSettingsStore);
  const tagLoc = useMemo(() => Object.fromEntries((tags || []).map(t => [t.id, t.loc])), [tags]);
  const tagLocRef = useRef(tagLoc); tagLocRef.current = tagLoc;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const d = useMemo(() => buildDmi(packets, s.locoId, now, tagLoc, { tagMissM: dmiTagMissM }), [packets, s.locoId, now, tagLoc, dmiTagMissM]);

  /* ── sent-packet log ── */
  const [log, setLog] = useState([]);
  const [sent, setSent] = useState({ loco: 0, stn: 0, err: 0 });
  const post = useCallback(async (hex, label, source, radio) => {
    const ts = new Date().toTimeString().slice(0, 8);
    try {
      const r = await fetch(INGEST_URL, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packets: [{ activeRadio: radio, messagePayload: hex }], source, source_id: "DMI_SIM" }) });
      setLog(l => [{ ts, label, hex, ok: r.ok }, ...l].slice(0, 80));
      setSent(c => ({ ...c, [source === "dmi-station" ? "stn" : "loco"]: c[source === "dmi-station" ? "stn" : "loco"] + 1, err: c.err + (r.ok ? 0 : 1) }));
    } catch (e) {
      setLog(l => [{ ts, label, hex: e.message, ok: false }, ...l].slice(0, 80));
      setSent(c => ({ ...c, err: c.err + 1 }));
    }
  }, []);

  /* ── own loco: optional run (ABS from speed) + automatic tag reading, then C.4.3 / C.4.6 ── */
  const lastTick = useRef(null);
  const sendLoco = useCallback(async () => {
    let st = R.current;
    const t = performance.now(), dt = lastTick.current == null ? 0 : Math.min(5, (t - lastTick.current) / 1000);
    lastTick.current = t;
    if (st.autoRun && st.speed > 0 && dt > 0) {
      const sg = st.dir === 2 ? -1 : 1;
      const loc = Math.max(0, Math.round(st.loc + sg * (st.speed / 3.6) * dt));
      let lastTag = st.lastTag;
      if (st.autoTags) {
        const miss = missSet(st.missTags);
        const passed = routeTags(st, tagLocRef.current).filter(x => sg * (loc - x.pos) >= 0 && !miss.has(x.id));
        if (passed.length) lastTag = passed[passed.length - 1].id;
      }
      st = { ...st, loc, lastTag };
      R.current = st;
      upd({ loc, lastTag });
    }
    const l = { locoId: st.locoId, absLoc: st.loc, trainLen: st.trainLen, speed: st.speed, dir: st.dir, emg: st.emg, mode: st.mode,
      lastTag: st.lastTag, tagLink: st.tagLink, brake: st.brake, lastProfNum: st.refProfId, apprStnId: st.stnId };
    if (st.locoPkt !== "c46") await post(buildC43(l), "C.4.3", "dmi-loco", "0x01");
    if (st.locoPkt !== "c43") await post(buildC46(l), "C.4.6", "dmi-loco", "0x01");
    if (st.oAuto) {
      await post(buildC43({ locoId: st.oLocoId, absLoc: st.oLoc, trainLen: 600, speed: st.oSpeed, dir: st.oDir, emg: st.oEmg, mode: st.oMode,
        lastTag: 0, brake: 0 }), "C.4.3 other", "dmi-loco-other", "0x01");
    }
  }, [post, upd]);

  /* ── station: C.4.2 ── */
  const profSent = useRef("");
  const sendStation = useCallback(async () => {
    const st = R.current;
    const profKey = JSON.stringify([st.profile, st.lastRefRfid, st.dps, st.refProfId]);
    const withProfile = st.profEvery || profSent.current !== profKey;
    profSent.current = profKey;
    const hex = buildC42({
      stnId: st.stnId, destLocoId: st.toAll ? 0 : st.locoId, refProfId: st.refProfId, lastRefRfid: st.lastRefRfid,
      distPktStart: st.dps, pktDir: st.pktDir,
      ma: { destLocoSos: st.destLocoSos, trainSectionType: st.sectionType,
        curSigInfo: sigInfo({ stop: st.sigStop, override: st.sigOverride, type: st.sigType, line: st.sigLine, lineNo: st.sigLineNo }),
        curSigAspect: st.aspect, nextSigAspect: st.nextAspect, apprSigDist: st.apprSigDist, authorityType: st.authorityType,
        authorizedSpeed: st.authorizedSpeed, maWrtSig: st.maUnknown ? 65535 : st.maWrtSig, reqShortenMa: st.reqShortenMa, newMa: st.newMa },
      profile: withProfile ? st.profile : null,
    });
    await post(hex, withProfile ? "C.4.2 + profile" : "C.4.2", "dmi-station", "0xAA");
  }, [post]);
  const sendC45 = useCallback(() => { const st = R.current; post(buildC45({ stnId: st.stnId, stnLoc: st.stnLoc, sos: 1 }), "C.4.5 SoS", "dmi-station", "0xAA"); }, [post]);
  const sendOther = useCallback(() => {
    const st = R.current;
    post(buildC43({ locoId: st.oLocoId, absLoc: st.oLoc, trainLen: 600, speed: st.oSpeed, dir: st.oDir, emg: st.oEmg, mode: st.oMode, lastTag: 0, brake: 0 }),
      "C.4.3 other", "dmi-loco-other", "0x01");
  }, [post]);

  /* ── auto TX timers ── */
  useEffect(() => {
    if (!s.locoAuto) { lastTick.current = null; return undefined; }
    sendLoco();
    const t = setInterval(sendLoco, s.locoMs);
    return () => clearInterval(t);
  }, [s.locoAuto, s.locoMs, sendLoco]);
  useEffect(() => {
    if (!s.stAuto) return undefined;
    sendStation();
    const t = setInterval(sendStation, s.stMs);
    return () => clearInterval(t);
  }, [s.stAuto, s.stMs, sendStation]);

  /* ── region sweep: one value every `dwell` ms, sent at once so both DMIs change together ── */
  const [sweep, setSweep] = useState(null);                      // { k, i, loop }
  const [dwell, setDwell] = useState(4000);
  const [loopSweep, setLoopSweep] = useState(false);
  useEffect(() => {
    if (!sweep) return undefined;
    const sw = SWEEPS.find(x => x.k === sweep.k);
    upd({ ...(sw.base || {}), [sw.field]: sw.values[sweep.i] });
    const kick = setTimeout(() => { sendStation(); sendLoco(); }, 80);
    const next = setTimeout(() => setSweep(cur => {
      if (!cur || cur.k !== sweep.k) return cur;
      const n = cur.i + 1;
      return n < sw.values.length ? { ...cur, i: n } : cur.loop ? { ...cur, i: 0 } : null;
    }), dwell);
    return () => { clearTimeout(kick); clearTimeout(next); };
  }, [sweep, dwell, upd, sendStation, sendLoco]);
  // the swept field(s) go back to their value from before the sweep when it ends or is stopped
  const sweepOrig = useRef(null);
  useEffect(() => {
    if (sweep || !sweepOrig.current) return undefined;
    upd(sweepOrig.current);
    sweepOrig.current = null;
    const kick = setTimeout(() => { sendStation(); sendLoco(); }, 80);
    return () => clearTimeout(kick);
  }, [sweep, upd, sendStation, sendLoco]);
  const startSweep = k => {
    const sw = SWEEPS.find(x => x.k === k);
    const cur = { ...R.current, ...(sweepOrig.current || {}) };          // switching sweeps: start from the restored values
    if (sweepOrig.current) upd(sweepOrig.current);
    sweepOrig.current = Object.fromEntries([sw.field, ...Object.keys(sw.base || {})].map(f => [f, cur[f]]));
    upd({ locoAuto: true, stAuto: true });
    setSweep({ k, i: 0, loop: loopSweep });
  };
  const curSweep = sweep ? SWEEPS.find(x => x.k === sweep.k) : null;

  const resetRun = () => {
    const ref = tagLoc[s.lastRefRfid] ?? s.refTagAbs;
    upd({ loc: ref, lastTag: s.lastRefRfid });
    resetFeed();
  };
  const applyPreset = p => upd(p.p);

  const route = useMemo(() => routeTags(s, tagLoc), [s, tagLoc]);
  const miss = missSet(s.missTags);
  const backendDown = be === false;

  /* ═══════════════ render ═══════════════ */
  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(430px, 520px)", minHeight: 0, overflow: "hidden" }}>
      {/* ── LEFT: the LIVE DMI screen + what each region shows + sent packets ── */}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden", borderRight: "1px solid var(--bdr)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: "1px solid var(--bdr)", background: "var(--surf)", flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ ...mono, fontSize: 10, fontWeight: 700, color: "#00FF00", letterSpacing: ".1em" }}>LP-OCIP · ANNEXURE-B</span>
          <span style={{ ...mono, fontSize: 9, color: "var(--ts)" }}>same screen as 📡 LIVE → DMI, decoded from the packets sent below</span>
          <span style={{ marginLeft: "auto", ...mono, fontSize: 9, color: wsState === "open" ? "var(--green)" : "var(--red)" }}>
            ● LIVE feed {wsState === "open" ? "connected" : wsState} · loco {sent.loco} · station {sent.stn}{sent.err ? ` · ${sent.err} failed` : ""}
          </span>
        </div>
        {backendDown && <div style={{ padding: "6px 12px", background: "rgba(239,68,68,.1)", color: "var(--red)", ...mono, fontSize: 10 }}>Backend offline — start PINJ's backend (port 8000) to send and decode packets.</div>}

        <div style={{ flex: "1 1 auto", minHeight: 260, display: "flex", alignItems: "center", justifyContent: "center", padding: 10, background: "#050507" }}>
          <div style={{ height: "100%", maxWidth: "100%", aspectRatio: "4 / 3", border: "6px solid #2b2f3a", borderRadius: 10, overflow: "hidden", boxShadow: "0 12px 38px rgba(0,0,0,.45)" }}>
            <DmiScreen d={d} now={now} />
          </div>
        </div>

        <RegionTable d={d} />

        <div style={{ height: 120, flexShrink: 0, overflowY: "auto", borderTop: "1px solid var(--bdr)", background: "var(--surf)" }}>
          <div style={{ position: "sticky", top: 0, background: "var(--raised)", padding: "3px 12px", ...mono, fontSize: 8, color: "var(--tm)", letterSpacing: ".1em", display: "flex" }}>
            SENT PACKETS (newest first)<span style={{ marginLeft: "auto", cursor: "pointer", color: "var(--ts)" }} onClick={() => setLog([])}>✕ clear</span>
          </div>
          {log.length === 0 && <div style={{ padding: 10, ...mono, fontSize: 10, color: "var(--tm)", textAlign: "center" }}>Nothing sent yet — press SEND or AUTO TX.</div>}
          {log.map((e, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 110px 1fr 20px", gap: 6, padding: "2px 12px", ...mono, fontSize: 9.5, borderBottom: "1px solid var(--bdr)" }}>
              <span style={{ color: "var(--tm)" }}>{e.ts}</span>
              <span style={{ color: e.label.startsWith("C.4.2") ? "#06b6d4" : e.label.startsWith("C.4.5") ? "#ef4444" : "#10b981", fontWeight: 700 }}>{e.label}</span>
              <span style={{ color: "var(--ts)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.hex}>{e.hex}</span>
              <span style={{ color: e.ok ? "var(--green)" : "var(--red)" }}>{e.ok ? "✓" : "✗"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT: inputs ── */}
      <div style={{ overflowY: "auto", minHeight: 0, padding: 10, display: "flex", flexDirection: "column", gap: 9, background: "var(--base)" }}>
        {/* presets */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, flexShrink: 0 }}>
          <span style={{ ...mono, fontSize: 8, color: "var(--tm)", letterSpacing: ".1em", alignSelf: "center", marginRight: 4 }}>SCENARIOS</span>
          {PRESETS.map(p => <Btn key={p.k} color={p.c} onClick={() => applyPreset(p)}>{p.label}</Btn>)}
        </div>

        {/* region sweeps */}
        <Section title="🔁 REGION SWEEP" sub="steps one field through every value — check each on the DMI" color="#00FF00"
          right={<span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select value={dwell} onChange={e => setDwell(Number(e.target.value))} style={{ ...inpS, width: 74, padding: "3px 4px", fontSize: 10 }}>
              {[[2000, "2 s each"], [4000, "4 s each"], [6000, "6 s each"], [10000, "10 s each"]].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            <Chk label="loop" value={loopSweep} onChange={v => { setLoopSweep(v); setSweep(c => (c ? { ...c, loop: v } : c)); }} />
          </span>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
            {SWEEPS.map(sw => {
              const on = sweep?.k === sw.k;
              return (
                <button key={sw.k} onClick={() => (on ? setSweep(null) : startSweep(sw.k))}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", borderRadius: 5, textAlign: "left", ...mono, fontSize: 9.5, fontWeight: 700,
                    border: `1px solid ${on ? "#00FF00" : "var(--bdr2)"}`, background: on ? "rgba(0,255,0,.1)" : "var(--raised)", color: on ? "#00FF00" : "var(--ts)" }}>
                  {on ? "■" : "▶"} {sw.label} <span style={{ marginLeft: "auto" }}><Rg r={sw.r} /></span>
                </button>
              );
            })}
          </div>
          {curSweep && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, background: "rgba(0,255,0,.07)", border: "1px solid #00ff0040", ...mono, fontSize: 10.5 }}>
              <span style={{ color: "#00FF00", fontWeight: 700 }}>{curSweep.r}</span>
              <span style={{ color: "var(--tp)", fontWeight: 700 }}>{curSweep.name(curSweep.values[sweep.i])}</span>
              <span style={{ color: "var(--tm)" }}>({sweep.i + 1}/{curSweep.values.length})</span>
              <span style={{ marginLeft: "auto" }}><Btn color="var(--red)" onClick={() => setSweep(null)}>■ STOP</Btn></span>
            </div>
          )}
        </Section>

        {/* ── own loco ── */}
        <Section title="🚆 LOCO · C.4.3 / C.4.6" sub={`→ ${s.locoPkt === "both" ? "C.4.3 + C.4.6" : s.locoPkt === "c43" ? "C.4.3" : "C.4.6"} every ${s.locoMs / 1000} s`} color="#10b981"
          right={<span style={{ display: "flex", gap: 5 }}>
            <Btn color="#10b981" solid={s.locoAuto} onClick={() => upd({ locoAuto: !s.locoAuto })}>{s.locoAuto ? "■ STOP" : "▶ AUTO TX"}</Btn>
            <Btn color="#10b981" onClick={sendLoco}>⚡ SEND</Btn>
          </span>}>
          <Grid cols={3}>
            <Num label="SOURCE_LOCO_ID" r="B" value={s.locoId} max={999999} onChange={v => upd({ locoId: v })} />
            <Sel label="Packet" value={s.locoPkt} opts={PKT_OPTS} onChange={v => upd({ locoPkt: v })} />
            <Sel label="Interval" value={s.locoMs} opts={[[500, "0.5 s"], [1000, "1 s"], [2000, "2 s"]]} onChange={v => upd({ locoMs: v })} />
          </Grid>
          <Field label={`TRAIN_SPEED · ${s.speed} kmph`} r="B1 B3">
            <input type="range" min={0} max={200} value={s.speed} onChange={e => upd({ speed: Number(e.target.value) })} style={{ width: "100%", accentColor: "#10b981" }} />
          </Field>
          <Grid cols={3}>
            <Num label="ABS_LOCO_LOC (m)" r="B9" value={s.loc} max={8388606} onChange={v => upd({ loc: v })} />
            <Num label="TRAIN_LENGTH (m)" r="F" value={s.trainLen} max={2047} onChange={v => upd({ trainLen: v })} />
            <Sel label="MOVEMENT_DIR" r="L" value={s.dir} opts={DIR_OPTS} onChange={v => upd({ dir: v })} />
            <Sel label="LOCO_MODE" r="B10 G H" value={s.mode} opts={MODE_OPTS} onChange={v => upd({ mode: v })} span={2} />
            <Sel label="Brake_Applied (C.4.3)" r="B8 I" value={s.brake} opts={BRAKE_OPTS} onChange={v => upd({ brake: v })} />
            <Sel label="EMERGENCY_STATUS" r="A H I" value={s.emg} opts={EMG_OPTS} onChange={v => upd({ emg: v })} span={2} />
            <Sel label="TAG_LINK_INFO" value={s.tagLink} opts={TAGLINK_OPTS} onChange={v => upd({ tagLink: v })} />
          </Grid>
          <div style={{ border: "1px dashed var(--bdr2)", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 7 }}>
            <Grid cols={3}>
              <Chk label="Run (ABS from speed)" r="B9" value={s.autoRun} onChange={v => upd({ autoRun: v })} />
              <Chk label="Read route tags" r="L M" value={s.autoTags} onChange={v => upd({ autoTags: v })} />
              <Btn color="var(--cyan)" onClick={resetRun} title="Loco back to the LAST_REF_RFID tag, clear this page's DMI history">⟲ Reset run</Btn>
              <Num label="LAST_RFID_TAG" r="L M" value={s.lastTag} max={1023} onChange={v => upd({ lastTag: v })} />
              <Field label="Miss tag IDs (comma)" r="M H">
                <input value={s.missTags} placeholder="e.g. 502" onChange={e => upd({ missTags: e.target.value })} style={inpS} />
              </Field>
            </Grid>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {route.map(t => {
                const passed = (s.dir === 2 ? -1 : 1) * (s.loc - t.pos) >= 0;
                const col = miss.has(t.id) ? "var(--red)" : t.id === s.lastTag ? "#00FF00" : passed ? "var(--green)" : "var(--tm)";
                return <span key={t.id} title={`RFID #${t.id} at ${Math.round(t.pos)} m${miss.has(t.id) ? " — will be missed" : ""}`}
                  style={{ ...mono, fontSize: 9, padding: "1px 6px", borderRadius: 8, border: `1px solid ${col}`, color: col }}>#{t.id} · {Math.round(t.pos)}</span>;
              })}
            </div>
          </div>
        </Section>

        {/* ── station C.4.2 header + MA ── */}
        <Section title="📡 STATION · C.4.2 Regular" sub={`→ every ${s.stMs / 1000} s · RF bars = cycles with a station packet`} color="#06b6d4"
          right={<span style={{ display: "flex", gap: 5 }}>
            <Btn color="#06b6d4" solid={s.stAuto} onClick={() => upd({ stAuto: !s.stAuto })}>{s.stAuto ? "■ STOP" : "▶ AUTO TX"}</Btn>
            <Btn color="#06b6d4" onClick={sendStation}>⚡ SEND</Btn>
          </span>}>
          <Grid cols={3}>
            <Num label="SOURCE_STN_ID" r="I" value={s.stnId} max={65535} onChange={v => upd({ stnId: v })} />
            <Chk label="DEST_LOCO_ID = 0 (all)" value={s.toAll} onChange={v => upd({ toAll: v })} />
            <Sel label="Interval" r="J3" value={s.stMs} opts={[[2000, "2 s (5 bars)"], [4000, "4 s"], [6000, "6 s"], [10000, "10 s"]]} onChange={v => upd({ stMs: v })} />
            <Num label="REF_PROF_ID" value={s.refProfId} max={15} onChange={v => upd({ refProfId: v })} />
            <Num label="LAST_REF_RFID" r="C D2 L M" value={s.lastRefRfid} max={1023} onChange={v => upd({ lastRefRfid: v })} />
            <Num label="… tag ABS (m)" r="C D2" value={s.refTagAbs} max={8388606} onChange={v => upd({ refTagAbs: v })} disabled={tagLoc[s.lastRefRfid] != null} />
            <Num label="DIST_PKT_START (m)" value={s.dps} min={-16384} max={16383} onChange={v => upd({ dps: v })} />
            <Sel label="PKT_DIR" r="C D" value={s.pktDir} opts={DIR_OPTS.slice(0, 2)} onChange={v => upd({ pktDir: v })} />
            <Sel label="TRAIN_SECTION_TYPE" value={s.sectionType} opts={SECTION_OPTS} onChange={v => upd({ sectionType: v })} />
          </Grid>
          {tagLoc[s.lastRefRfid] != null && <div style={{ ...mono, fontSize: 9, color: "var(--ts)" }}>RFID #{s.lastRefRfid} is in ⚙ Settings → tag table at {tagLoc[s.lastRefRfid]} m — the DMI uses that location.</div>}

          <div style={{ ...mono, fontSize: 9, fontWeight: 700, color: "var(--tp)", marginTop: 2 }}>MOVEMENT AUTHORITY · SIGNAL</div>
          <Grid cols={3}>
            <Num label="MA_W_R_T_SIG (m)" r="C A" value={s.maWrtSig} max={65534} onChange={v => upd({ maWrtSig: v })} disabled={s.maUnknown} />
            <Chk label="MA unknown (65535)" r="C" value={s.maUnknown} onChange={v => upd({ maUnknown: v })} />
            <Chk label="REQ_SHORTEN_MA" r="C" value={s.reqShortenMa} onChange={v => upd({ reqShortenMa: v })} />
            <Num label="NEW_MA (m)" r="C" value={s.newMa} max={65535} onChange={v => upd({ newMa: v })} disabled={!s.reqShortenMa} />
            <Sel label="AUTHORITY_TYPE" r="B3" value={s.authorityType} opts={AUTH_OPTS} onChange={v => upd({ authorityType: v })} />
            <Num label="AUTHORIZED_SPEED (kmph)" r="B3" value={s.authorizedSpeed} min={5} max={250} step={5} onChange={v => upd({ authorizedSpeed: v })} disabled={s.authorityType !== 1} />
            <Sel label="CUR_SIG_ASPECT" r="D1" value={s.aspect} opts={ASPECT_OPTS} onChange={v => upd({ aspect: v })} span={2} />
            <Num label="APPR_SIG_DIST (m)" r="D2" value={s.apprSigDist} max={32767} onChange={v => upd({ apprSigDist: v })} />
            <Sel label="NEXT_SIG_ASPECT" value={s.nextAspect} opts={NEXT_ASPECT_OPTS} onChange={v => upd({ nextAspect: v })} span={2} />
            <Sel label="DEST_LOCO_SOS" r="A H I" value={s.destLocoSos} opts={SOS_OPTS} onChange={v => upd({ destLocoSos: v })} />
          </Grid>
          <div style={{ ...mono, fontSize: 9, fontWeight: 700, color: "var(--tp)", marginTop: 2 }}>CUR_SIG_INFO <span style={{ color: "var(--tm)", fontWeight: 400 }}>= {sigInfo({ stop: s.sigStop, override: s.sigOverride, type: s.sigType, line: s.sigLine, lineNo: s.sigLineNo })}</span></div>
          <Grid cols={3}>
            <Sel label="a14-a9 signal type" r="D3 D1" value={s.sigType} opts={SIG_TYPE_OPTS} onChange={v => upd({ sigType: v })} span={2} />
            <Sel label="a8-a5 line" r="D3" value={s.sigLine} opts={LINE_OPTS} onChange={v => upd({ sigLine: v })} />
            <Num label="a4-a0 line no" value={s.sigLineNo} max={31} onChange={v => upd({ sigLineNo: v })} />
            <Chk label="a15 override (running)" value={s.sigOverride} onChange={v => upd({ sigOverride: v ? 1 : 0 })} />
            <Chk label="a16 stop signal" value={s.sigStop} onChange={v => upd({ sigStop: v ? 1 : 0 })} />
          </Grid>
        </Section>

        {/* ── track profile ── */}
        <Section title="🗺 TRACK PROFILE · C.4.2 sub-packets" sub="distances from the packet start (LAST_REF_RFID + DIST_PKT_START)" color="#8b5cf6"
          right={<Chk label="in every C.4.2" value={s.profEvery} onChange={v => upd({ profEvery: v })} />}>
          <Rows title="Static speed profile (SSP)" r="B3 B7 B11 A H" rows={s.profile.ssp} onChange={v => setProf("ssp", v)} blank={{ len: 500, speed: 60 }}
            cols={[{ k: "len", label: "length (m)", max: 32767 }, { k: "speed", label: "speed (kmph)", max: 250 }]} />
          <Rows title="TSR" r="A B3 H" rows={s.profile.tsr} onChange={v => setProf("tsr", v)} blank={{ id: 1, start: 800, len: 300, speed: 45 }}
            cols={[{ k: "id", label: "TSR_ID", max: 255 }, { k: "start", label: "start (m)", max: 32767 }, { k: "len", label: "length (m)", max: 32767 }, { k: "speed", label: "speed (kmph)", max: 250 }]} />
          <Rows title="Turnouts (max 3)" r="A B3 H" rows={s.profile.turnouts} onChange={v => setProf("turnouts", v)} max={3} blank={{ speed: 30, dist: 1500, release: 150 }}
            cols={[{ k: "speed", label: "speed (kmph)", max: 90 }, { k: "dist", label: "start (m)", max: 32767 }, { k: "release", label: "release (m)", max: 4095 }]} />
          <Rows title="LC gates" r="H" rows={s.profile.lc} onChange={v => setProf("lc", v)} blank={{ dist: 1000, id: 1, unmanned: 0 }}
            cols={[{ k: "dist", label: "start (m)", max: 32767 }, { k: "id", label: "LC no", max: 1023 }, { k: "unmanned", label: "unmanned", chk: true, w: "60px" }]} />
          <Rows title="Track conditions" r="H J" rows={s.profile.conds} onChange={v => setProf("conds", v)} max={15} blank={{ type: 2, start: 1000, len: 300 }}
            cols={[{ k: "type", label: "type", opts: COND_OPTS, w: "1.6fr" }, { k: "start", label: "start (m)", max: 32767 }, { k: "len", label: "length (m)", max: 32767 }]} />
          <Rows title="Tag linking (RFID tags)" r="L M" rows={s.profile.tags} onChange={v => setProf("tags", v)} max={40} blank={{ dist: 300, id: 510 }}
            cols={[{ k: "dist", label: "from previous tag (m)", max: 2047 }, { k: "id", label: "RFID tag", max: 1023 }]} />
          <Rows title="Gradient" rows={s.profile.grad} onChange={v => setProf("grad", v)} blank={{ dist: 0, up: 0, value: 0 }}
            cols={[{ k: "dist", label: "start (m)", max: 32767 }, { k: "up", label: "uphill", chk: true, w: "60px" }, { k: "value", label: "value (0-30)", max: 31 }]} />
        </Section>

        {/* ── C.4.5 + other loco ── */}
        <Section title="🚨 EMERGENCIES · C.4.5 / other loco" color="#ef4444" open={false}>
          <Grid cols={3}>
            <Num label="STN_ILC_IBS_LOC (m)" value={s.stnLoc} max={8388606} onChange={v => upd({ stnLoc: v })} />
            <div style={{ gridColumn: "span 2", alignSelf: "end" }}>
              <Btn color="#ef4444" onClick={sendC45} title="GEN_SOS_CALL = 1 — shows on the DMI for 30 s">⚡ SEND C.4.5 SoS to all locos</Btn> <Rg r="A I" />
            </div>
          </Grid>
          <div style={{ ...mono, fontSize: 9, fontWeight: 700, color: "var(--tp)", marginTop: 2 }}>OTHER LOCO (C.4.3) <span style={{ color: "var(--tm)", fontWeight: 400 }}>— collision / SoS from loco, shown for 30 s</span></div>
          <Grid cols={3}>
            <Num label="SOURCE_LOCO_ID" value={s.oLocoId} max={999999} onChange={v => upd({ oLocoId: v })} />
            <Num label="ABS_LOCO_LOC (m)" r="A H" value={s.oLoc} max={8388606} onChange={v => upd({ oLoc: v })} />
            <Num label="TRAIN_SPEED" value={s.oSpeed} max={400} onChange={v => upd({ oSpeed: v })} />
            <Sel label="EMERGENCY_STATUS" r="A H I" value={s.oEmg} opts={EMG_OPTS} onChange={v => upd({ oEmg: v })} span={2} />
            <Sel label="MOVEMENT_DIR" value={s.oDir} opts={DIR_OPTS} onChange={v => upd({ oDir: v })} />
            <Chk label="send with own loco (AUTO TX)" value={s.oAuto} onChange={v => upd({ oAuto: v })} />
            <div style={{ alignSelf: "end" }}><Btn color="#ef4444" onClick={sendOther}>⚡ SEND once</Btn></div>
          </Grid>
        </Section>

        <div style={{ ...mono, fontSize: 9, color: "var(--tm)", lineHeight: 1.6, padding: "0 2px 6px" }}>
          Region E (DC) is always "DC –.––" on the LIVE DMI — no packet carries it. H and I messages come from the packet values (mode, emergency,
          DEST_LOCO_SOS, brake, MA ≤ 2000 m, LC gates, track conditions, TSR / PSR / turnout ahead), exactly as on the LIVE DMI.
          Packets go to the LIVE feed with source <b>dmi-loco</b> / <b>dmi-station</b>, so 📡 LIVE → DMI shows the same.
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   what each region currently shows (from the same buildDmi result)
═══════════════════════════════════════════════════════════════ */
const BRAKE_TXT = { 1: "Over speed", 2: "NSB", 3: "FSB", 4: "EB" };
function RegionTable({ d }) {
  const r = (v, u = "") => (v == null || v === "" ? "—" : `${typeof v === "number" ? Math.round(v) : v}${u}`);
  const rows = [
    ["A", "Target", d.target ? `${d.target.type === "Turnout" ? "Turn Out" : d.target.type} · ${Math.round(d.target.dist)} m · ${d.target.speed} kmph` : "—"],
    ["B1", "Speed", r(d.speed, " kmph")],
    ["B3", "Permitted", r(d.permitted, " kmph")],
    ["B7", "Next limit", d.speedTarget ? `${d.speedTarget.speed} kmph in ${Math.round(d.speedTarget.dist)} m` : "—"],
    ["B8", "Brake", BRAKE_TXT[d.brake] || "—"],
    ["B9", "Location", d.abs != null ? `${(d.abs / 1000).toFixed(3)} km` : "—"],
    ["B10 G", "Mode", d.mode ? `${d.mode.key} · ${d.mode.text}` : "—"],
    ["B11", "Section speed", r(d.sectionSpeed, " kmph")],
    ["C", "MA", r(d.ma, " m")],
    ["D1", "Signal", d.lamps ? `${d.aspectName}${d.marker ? ` · ${d.marker}` : ""}${d.routeInd ? ` · route ${d.routeInd}` : ""}` : "—"],
    ["D2", "Signal dist", d.lamps ? r(d.sigDist, " m") : "—"],
    ["D3", "Signal name", d.lamps && d.d3 ? d.d3 : "—"],
    ["F", "Train length", r(d.trainLen, " m")],
    ["H", "System msg", d.H.length ? d.H.join(" | ") : "—"],
    ["I", "Context msg", d.I.length ? d.I.join(" | ") : "—"],
    ["J", "Radio", d.radioHole ? "RADIO HOLE" : `${d.rf} / 5 bars`],
    ["L", "Tag", `Tid-${d.lastTag ?? "—"} · Dir-${d.dirN || "—"} · T Dist-${d.nextTag ? Math.round(d.nextTag.dist) : "—"}`],
    ["M", "Tag status", d.tags.length ? d.tags.map((t, i) => `M${i + 1} #${t.id} ${t.status === "read" ? "✓" : "✗ missed"}`).join(" · ") : "—"],
  ];
  return (
    <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", borderTop: "1px solid var(--bdr)", background: "var(--surf)", maxHeight: 132, overflowY: "auto" }}>
      {rows.map(([k, n, v]) => (
        <div key={k} title={`${k} · ${n}: ${v}`} style={{ display: "grid", gridTemplateColumns: "38px 70px 1fr", gap: 4, padding: "2px 8px", ...mono, fontSize: 9.5, borderBottom: "1px solid var(--bdr)", borderRight: "1px solid var(--bdr)", minWidth: 0 }}>
          <span style={{ color: "#00FF00", fontWeight: 700 }}>{k}</span>
          <span style={{ color: "var(--tm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n}</span>
          <span style={{ color: v === "—" ? "var(--tm)" : "var(--tp)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}
