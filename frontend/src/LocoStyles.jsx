/**
 * LocoStyles.jsx — selectable loco icons for 🚆 LIVE TRACK (⚙ Settings → SVK SIM → Loco icon).
 *
 * Every style takes the same props as LiveTrackProfile's classic LocoIcon
 *   { color, size, speed, reverse, brake, emergency, tilt }
 * and is drawn in a ~100-unit box (front = +x, rail top at y = 0), scaled to `size` and placed so
 * its wheels sit on the same rail line as the classic icon. Animations are plain CSS (LOCO_STYLE_CSS)
 * whose speed is set through style props, so a new packet only changes the pace — nothing restarts.
 */

export const LOCO_STYLE_CSS = `
  @keyframes lsxSpin { to { transform: rotate(360deg); } }
  .lsx-wheel { animation: lsxSpin linear infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes lsxBob { from { transform: translateY(0); } to { transform: translateY(-1px); } }
  .lsx-bob { animation: lsxBob ease-in-out infinite alternate; }
  @keyframes lsxFlick { 0%, 100% { opacity: .85; } 50% { opacity: .55; } }
  .lsx-flick { animation: lsxFlick 1.6s ease-in-out infinite; }
  @keyframes lsxBeacon { 50% { opacity: .15; } }
  .lsx-beacon { animation: lsxBeacon .6s steps(2) infinite; }
  @keyframes lsxSpark { 0% { stroke-dashoffset: 1; opacity: 1; } 100% { stroke-dashoffset: -1; opacity: 0; } }
  .lsx-spark { animation: lsxSpark .45s linear infinite; stroke-dasharray: 1; stroke-dashoffset: 1; }
  @keyframes lsxPuff { 0% { opacity: .7; transform: translate(0,0) scale(.45); } 100% { opacity: 0; transform: translate(-16px,-20px) scale(2); } }
  .lsx-puff { animation: lsxPuff 1.4s ease-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes lsxRod { 0% { transform: translate(3.2px,0); } 25% { transform: translate(0,3.2px); } 50% { transform: translate(-3.2px,0); } 75% { transform: translate(0,-3.2px); } 100% { transform: translate(3.2px,0); } }
  .lsx-rod { animation: lsxRod linear infinite; }
  @keyframes lsxChev { 0% { opacity: .15; } 50% { opacity: 1; } 100% { opacity: .15; } }
  .lsx-chev { animation: lsxChev 1s linear infinite; }
  @keyframes lsxArc { 0%, 88% { opacity: 0; } 90% { opacity: 1; } 94% { opacity: .2; } 96% { opacity: .9; } }
  .lsx-arc { animation: lsxArc 2.6s steps(1) infinite; }
  @media (prefers-reduced-motion: reduce) {
    .lsx-wheel, .lsx-bob, .lsx-flick, .lsx-beacon, .lsx-spark, .lsx-puff, .lsx-rod, .lsx-chev, .lsx-arc { animation: none !important; }
  }
`;

/* gradients shared by the styles (identical in every icon, so repeated ids are harmless) */
function LsxDefs() {
  return (
    <defs>
      <linearGradient id="lsxBeam" x1="0" x2="1"><stop offset="0" stopColor="#fff" stopOpacity=".85"/><stop offset=".55" stopColor="#fff" stopOpacity=".28"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></linearGradient>
      <radialGradient id="lsxPool"><stop offset="0" stopColor="#fffbe6" stopOpacity=".9"/><stop offset="1" stopColor="#fffbe6" stopOpacity="0"/></radialGradient>
      <radialGradient id="lsxShadow"><stop offset="0" stopColor="#000" stopOpacity=".7"/><stop offset="1" stopColor="#000" stopOpacity="0"/></radialGradient>
      <radialGradient id="lsxWheel" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#6b7280"/><stop offset="1" stopColor="#111827"/></radialGradient>
      <linearGradient id="lsxRed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ef5350"/><stop offset=".45" stopColor="#c62828"/><stop offset="1" stopColor="#7f1010"/></linearGradient>
      <linearGradient id="lsxBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3f86e0"/><stop offset=".5" stopColor="#1f5fb8"/><stop offset="1" stopColor="#133f80"/></linearGradient>
      <linearGradient id="lsxWhite" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff"/><stop offset=".6" stopColor="#eef2f7"/><stop offset="1" stopColor="#c8d1dc"/></linearGradient>
      <linearGradient id="lsxSteel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f8fafc"/><stop offset=".35" stopColor="#cbd5e1"/><stop offset=".7" stopColor="#e2e8f0"/><stop offset="1" stopColor="#94a3b8"/></linearGradient>
      <linearGradient id="lsxSkirt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#64748b"/><stop offset="1" stopColor="#334155"/></linearGradient>
      <linearGradient id="lsxRoof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#cbd5e1"/><stop offset="1" stopColor="#64748b"/></linearGradient>
      <linearGradient id="lsxGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1e3a5f"/><stop offset=".45" stopColor="#0b1626"/><stop offset=".55" stopColor="#263f63"/><stop offset="1" stopColor="#070d18"/></linearGradient>
      <linearGradient id="lsxTank" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4b5563"/><stop offset="1" stopColor="#1f2937"/></linearGradient>
      <linearGradient id="lsxBlack" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4b5563"/><stop offset=".35" stopColor="#1f2937"/><stop offset="1" stopColor="#030712"/></linearGradient>
      <linearGradient id="lsxSilver" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f1f5f9"/><stop offset=".5" stopColor="#94a3b8"/><stop offset="1" stopColor="#475569"/></linearGradient>
      <radialGradient id="lsxFire" cx="50%" cy="80%" r="80%"><stop offset="0" stopColor="#fde68a"/><stop offset=".6" stopColor="#f59e0b"/><stop offset="1" stopColor="#7c2d12"/></radialGradient>
      <filter id="lsxGlow" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
  );
}

/* ── timing helpers (pace follows the speed; stopped = frozen in place) ── */
const moving = sp => sp > 0;
const spinS = sp => ({ animationDuration: `${moving(sp) ? Math.max(0.25, 40 / sp).toFixed(2) : 6}s`, animationPlayState: moving(sp) ? "running" : "paused" });
const bobS = sp => ({ animationDuration: `${moving(sp) ? Math.max(0.16, 0.9 - sp / 180).toFixed(2) : 1}s`, animationPlayState: moving(sp) ? "running" : "paused" });

/* ── shared parts ── */
function DiscWheel({ x, y, r, sp }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill="url(#lsxWheel)" stroke="#0b0f14" strokeWidth={0.5}/>
      <circle r={r * 0.82} fill="none" stroke="#9aa5b4" strokeWidth={r * 0.14} opacity={0.85}/>
      <g className="lsx-wheel" style={spinS(sp)}>
        <rect x={-0.5} y={-r * 0.78} width={1} height={r * 0.55} fill="#d1d5db"/>
        <circle cx={r * 0.45} cy={r * 0.2} r={r * 0.12} fill="#6b7280"/>
      </g>
      <circle r={r * 0.28} fill="#6b7280" stroke="#d1d5db" strokeWidth={0.4}/>
    </g>
  );
}
function SpokeWheel({ x, y, r, sp, rim = "#b91c1c" }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill="#111827" stroke={rim} strokeWidth={r * 0.16}/>
      <g className="lsx-wheel" style={spinS(sp)}>
        {Array.from({ length: 10 }, (_, i) => {
          const a = i * Math.PI / 5;
          return <line key={i} x1={0} y1={0} x2={(Math.cos(a) * r * 0.86).toFixed(2)} y2={(Math.sin(a) * r * 0.86).toFixed(2)} stroke={rim} strokeWidth={r * 0.09}/>;
        })}
        <path d={`M0 0 L${r * 0.7} ${-r * 0.3} A${r * 0.76} ${r * 0.76} 0 0 1 ${r * 0.7} ${r * 0.3} Z`} fill={rim} opacity={0.9}/>
      </g>
      <circle r={r * 0.2} fill="#fca5a5"/>
    </g>
  );
}
/* Co-Co / Bo-Bo bogie: wheels, then the side frame with axle boxes, coil springs and brake blocks */
function Bogie({ cx, n, sp, r = 4.6, gap = 11, frame = "#2b313a" }) {
  const xs = Array.from({ length: n }, (_, i) => cx - (n - 1) * gap / 2 + i * gap);
  const L = xs[0] - r - 2.5, R = xs[n - 1] + r + 2.5;
  return (
    <g>
      {xs.map(x => <DiscWheel key={x} x={x} y={-r} r={r} sp={sp}/>)}
      <path d={`M${L} ${-r * 2 - 3} L${R} ${-r * 2 - 3} L${R + 1.2} ${-r * 2 + 1.5} L${R - 1} ${-r * 2 + 3.2} L${L + 1} ${-r * 2 + 3.2} L${L - 1.2} ${-r * 2 + 1.5} Z`}
        fill={frame} stroke="#0b0f14" strokeWidth={0.5}/>
      {xs.map(x => (
        <g key={`f${x}`}>
          <rect x={x - 2.2} y={-r - 2.4} width={4.4} height={4.8} rx={0.8} fill="#3b4350" stroke="#0b0f14" strokeWidth={0.4}/>
          <rect x={x - 1.7} y={-r * 2 - 2.6} width={3.4} height={3} rx={0.9} fill="#7c8796"/>
          {[0, 1, 2].map(k => <line key={k} x1={x - 1.7} x2={x + 1.7} y1={-r * 2 - 2 + k} y2={-r * 2 - 1.6 + k} stroke="#2b313a" strokeWidth={0.45}/>)}
          <rect x={x + r - 0.6} y={-r - 2} width={1.6} height={3.4} fill="#1f2937"/>
        </g>
      ))}
    </g>
  );
}
/* single-arm pantograph standing on the roof line `roof` */
function Panto({ x, roof, up = true, flip = false }) {
  const s = flip ? -1 : 1;
  return (
    <g>
      <rect x={x - 7} y={roof - 2} width={14} height={2} rx={0.6} fill="#475569"/>
      <rect x={x - 6} y={roof - 4} width={2} height={2} fill="#cbd5e1"/><rect x={x + 4} y={roof - 4} width={2} height={2} fill="#cbd5e1"/>
      {up ? <>
        <path d={`M${x - 5 * s} ${roof - 4} L${x + 8 * s} ${roof - 13} L${x - 1 * s} ${roof - 21}`} fill="none" stroke="#94a3b8" strokeWidth={1.3} strokeLinejoin="round"/>
        <path d={`M${x + 8 * s} ${roof - 13} L${x - 3 * s} ${roof - 8}`} stroke="#64748b" strokeWidth={0.8}/>
        <path d={`M${x - 8} ${roof - 21} L${x + 6} ${roof - 21} M${x - 8} ${roof - 21} q-2 0 -2.5 1.8 M${x + 6} ${roof - 21} q2 0 2.5 1.8`} fill="none" stroke="#e2e8f0" strokeWidth={1.3} strokeLinecap="round"/>
        <line x1={x - 18} x2={x + 18} y1={roof - 22.3} y2={roof - 22.3} stroke="#475569" strokeWidth={0.6} opacity={0.7}/>
      </> : <>
        <path d={`M${x - 5 * s} ${roof - 4} L${x + 7 * s} ${roof - 5} L${x - 4 * s} ${roof - 6}`} fill="none" stroke="#94a3b8" strokeWidth={1.1} strokeLinejoin="round"/>
        <rect x={x - 8} y={roof - 7} width={9} height={1.2} rx={0.5} fill="#cbd5e1"/>
      </>}
    </g>
  );
}
function Arc({ x, y, sp }) {
  if (!moving(sp)) return null;
  return (
    <g className="lsx-arc" style={{ animationDuration: `${(2 + (Math.abs(x) % 3) * 0.7).toFixed(1)}s` }}>
      <circle cx={x} cy={y} r={5} fill="#60a5fa" opacity={0.45}/>
      <path d={`M${x} ${y - 4} l1 3 l3 .3 l-2.6 1.4 l1.2 3.4 l-2.6 -2.2 l-2.8 2.4 l1 -3.4 l-2.8 -1.4 l3 -.3 z`} fill="#e0f2fe"/>
    </g>
  );
}
function Beam({ x, y, sp, spread = 14 }) {
  const k = moving(sp) ? Math.min(1, 0.55 + sp / 260) : 0.35, len = 70 + Math.min(60, sp * 0.5);
  return (
    <g>
      <polygon className="lsx-flick" points={`${x},${y - 1.6} ${x + len},${y - spread} ${x + len},${y + spread} ${x},${y + 1.6}`} fill="url(#lsxBeam)" opacity={k}/>
      <ellipse cx={x + len * 0.6} cy={0} rx={len * 0.45} ry={2.6} fill="url(#lsxPool)" opacity={k * 0.8}/>
    </g>
  );
}
const Lamp = ({ x, y, r = 2.2 }) => <g><circle cx={x} cy={y} r={r * 2} fill="#fff" opacity={0.28}/><circle cx={x} cy={y} r={r} fill="#fffdf2" stroke="#64748b" strokeWidth={0.4}/></g>;
const Tail = ({ x, y, brake }) => brake >= 2
  ? <g><circle cx={x} cy={y} r={6.5} fill="#ef4444" opacity={0.35}/><rect x={x - 1.4} y={y - 2.4} width={2.8} height={4.8} rx={0.9} fill="#ff4d4d"/></g>
  : <rect x={x - 1} y={y - 2} width={2} height={4} rx={0.7} fill="#7f1d1d"/>;
const Beacon = ({ x, y, on }) => on ? (
  <g transform={`translate(${x} ${y})`}>
    <rect x={-3} y={-2} width={6} height={3} rx={1} fill="#7f1d1d"/>
    <circle cy={-3} r={3} fill="#ef4444" className="lsx-beacon"/><circle cy={-3} r={9} fill="#ef4444" opacity={0.25} className="lsx-beacon"/>
  </g>
) : null;
function Sparks({ xs, sp, brake }) {
  if (!(brake >= 2 && moving(sp))) return null;
  const out = [];
  xs.forEach((x, wi) => {
    for (let k = 0; k < 2 + (brake - 1); k++) {
      const a = (25 + ((k * 37 + wi * 23) % 45)) * Math.PI / 180, L = 9 + ((k * 13 + wi * 7) % 5) * 2.2;
      out.push(<line key={`${wi}-${k}`} className="lsx-spark" pathLength={1} x1={x} y1={0} x2={(x - Math.cos(a) * L).toFixed(1)} y2={(-Math.sin(a) * L).toFixed(1)}
        stroke={k % 2 ? "#fde047" : "#fb923c"} strokeWidth={1.5} strokeLinecap="round" style={{ animationDelay: `${((k * 0.13 + wi * 0.07) % 0.45).toFixed(2)}s` }}/>);
    }
  });
  return <g data-no-export="true" pointerEvents="none">{out}</g>;
}
const Coupler = ({ x, dir }) => <g><rect x={dir > 0 ? x : x - 5} y={-12.5} width={5} height={2.6} rx={0.6} fill="#374151"/><rect x={dir > 0 ? x + 4 : x - 6} y={-13.6} width={2} height={4.8} rx={0.5} fill="#4b5563"/></g>;
const Glass = ({ d }) => <path d={d} fill="url(#lsxGlass)" stroke="#0b0f14" strokeWidth={0.5}/>;
function Puffs({ x, y, sp, color = "#9ca3af", n = 3 }) {
  const dur = `${Math.max(0.6, 1.6 - sp / 120).toFixed(2)}s`;
  if (!moving(sp)) return <circle className="lsx-puff" cx={x} cy={y} r={2.6} fill={color} style={{ animationDuration: "3s" }}/>;
  return <g data-no-export="true">{Array.from({ length: n }, (_, i) => <circle key={i} className="lsx-puff" cx={x} cy={y} r={3.6} fill={color} style={{ animationDelay: `${(i * 0.42).toFixed(2)}s`, animationDuration: dur }}/>)}</g>;
}

/* ═══════════════ the styles ═══════════════ */
function Classic({ sp, brake, emg, c }) {           // small stand-in for the Settings thumbnail
  return <>
    <Beam x={50} y={-24} sp={sp}/>
    <g className="lsx-bob" style={bobS(sp)}>
      <g stroke="#a16207" strokeWidth={1.3} fill="none" strokeLinecap="round"><path d="M1 -40 L8 -51 L15 -40"/><path d="M8 -51 L4 -58"/><line x1={-2} x2={12} y1={-58} y2={-58} stroke="#cbd5e1"/></g>
      <Beacon x={-34} y={-42} on={emg}/>
      <rect x={-50} y={-40} width={100} height={34} rx={8} fill="#facc15" stroke="#a16207" strokeWidth={1.5}/>
      <path d="M50 -40 L64 -18 L50 -6 Z" fill="#facc15" stroke="#a16207" strokeWidth={1.5} strokeLinejoin="round"/>
      <rect x={-49} y={-13} width={98} height={4} fill={c}/>
      <rect x={-32} y={-34} width={28} height={14} rx={1.5} fill="#1f2937" opacity={0.85}/>
      <Lamp x={50} y={-26} r={2.6}/><Tail x={-50} y={-24} brake={brake}/>
    </g>
    <SpokeWheel x={-24} y={-11} r={11} sp={sp} rim="#facc15"/><SpokeWheel x={18} y={-11} r={11} sp={sp} rim="#facc15"/>
    <Sparks xs={[-24, 18]} sp={sp} brake={brake}/>
  </>;
}

function Wap7({ sp, brake, emg, c }) {
  return <>
    <Beam x={51} y={-40} sp={sp} spread={12}/>
    <g className="lsx-bob" style={bobS(sp)}>
      <rect x={-41} y={-46} width={82} height={3.2} rx={1} fill="url(#lsxRoof)"/>
      <rect x={-10} y={-49} width={20} height={3.4} rx={1} fill="#64748b"/><rect x={-6} y={-51} width={12} height={2} rx={0.6} fill="#94a3b8"/>
      <Panto x={24} roof={-46} up/><Arc x={24} y={-68} sp={sp}/><Panto x={-24} roof={-46} up={false} flip/>
      <Beacon x={-6} y={-51} on={emg}/>
      <path d="M-48 -13.5 L48 -13.5 L50 -33 Q50 -41 45 -43 L-45 -43 Q-50 -41 -50 -33 Z" fill="url(#lsxRed)" stroke="#5c0b0b" strokeWidth={0.8}/>
      <path d="M-46 -42.4 L46 -42.4" stroke="#ff8a80" strokeWidth={0.8} opacity={0.6}/>
      <rect x={-49.4} y={-21.5} width={99} height={4.2} fill="#f8fafc"/>
      <rect x={-49.2} y={-17.3} width={98.6} height={1.2} fill="#fbbf24"/>
      <rect x={-49} y={-16.1} width={98} height={2.1} fill={c}/>
      <Glass d="M38.5 -40.5 L45.5 -40.5 Q48.5 -39.5 48.8 -35 L49 -31 L38.5 -31 Z"/>
      <Glass d="M-38.5 -40.5 L-45.5 -40.5 Q-48.5 -39.5 -48.8 -35 L-49 -31 L-38.5 -31 Z"/>
      <path d="M40 -39.6 L44 -39.6 L41 -32" stroke="#fff" strokeWidth={0.7} opacity={0.45} fill="none"/>
      {[30, -36.4].map(x => <g key={x}><rect x={x} y={-39.5} width={6.4} height={24} rx={0.8} fill="none" stroke="#5c0b0b" strokeWidth={0.7}/><rect x={x + 1.2} y={-37.6} width={4} height={5.4} rx={0.6} fill="url(#lsxGlass)"/></g>)}
      {[-25, -14, -3, 8, 19].map(x => (
        <g key={x}><rect x={x} y={-38.6} width={8} height={14} rx={0.8} fill="#9b1c1c" stroke="#5c0b0b" strokeWidth={0.5}/>
          {[0, 1, 2, 3, 4].map(k => <line key={k} x1={x + 1} x2={x + 7} y1={-36.4 + k * 2.4} y2={-36.4 + k * 2.4} stroke="#e57373" strokeWidth={0.55}/>)}</g>
      ))}
      <line x1={-28} x2={28} y1={-23.2} y2={-23.2} stroke="#d1d5db" strokeWidth={0.6}/>
      <rect x={-50} y={-13.5} width={100} height={2.6} fill="#1f2937"/>
      <rect x={-14} y={-11} width={28} height={4} rx={1} fill="#2b313a"/>
      <Lamp x={48.5} y={-41.5} r={2}/><Lamp x={49.6} y={-24.5} r={1.3}/><Tail x={-49.6} y={-24.5} brake={brake}/>
      <path d="M48 -10.5 L54 -2.5 L48 -2.5 Z" fill="#374151"/>
      <Coupler x={49} dir={1}/><Coupler x={-49} dir={-1}/>
    </g>
    <Bogie cx={-29} n={3} sp={sp}/><Bogie cx={29} n={3} sp={sp}/>
    <Sparks xs={[-29, 29]} sp={sp} brake={brake}/>
  </>;
}

function VandeBharat({ sp, brake, emg, c }) {
  return <>
    <Beam x={54} y={-16} sp={sp} spread={11}/>
    {[-36, -25, 25, 36].map(x => <DiscWheel key={x} x={x} y={-3.8} r={3.8} sp={sp}/>)}
    <g className="lsx-bob" style={bobS(sp)}>
      {[-40, -18].map(x => <rect key={x} x={x} y={-47} width={14} height={4} rx={2} fill="url(#lsxRoof)"/>)}
      <Beacon x={4} y={-45} on={emg}/>
      <path d="M-50 -5.6 L18 -5.6 C40 -5.6 54 -10 56.5 -17.5 C57.6 -22 52 -30 40 -36.5 C31 -41.4 21 -43.5 11 -43.5 L-50 -43.5 Z" fill="url(#lsxWhite)" stroke="#94a3b8" strokeWidth={0.7}/>
      <path d="M-50 -15.4 L-50 -5.6 L18 -5.6 C38 -5.6 51 -9 55.6 -15.4 Z" fill="url(#lsxSkirt)"/>
      {[-30.5, 30.5].map(x => <path key={x} d={`M${x - 11} -5.6 L${x - 11} -8 Q${x} -10.4 ${x + 11} -8 L${x + 11} -5.6 Z`} fill="#1f2937"/>)}
      <path d="M-50 -21.5 L46 -21.5 C51 -21.5 55 -20 56.6 -17.6 C55.4 -16.6 53.6 -15.9 51.4 -15.4 L-50 -15.4 Z" fill="#1d4ed8"/>
      <rect x={-50} y={-17.6} width={100} height={1.4} fill={c}/>
      <path d="M-48 -37 L14 -37 L14 -27.5 L-48 -27.5 Z" fill="url(#lsxGlass)"/>
      {[-44, -33, -22, -11, 0].map(x => <rect key={x} x={x} y={-36} width={9} height={7.4} rx={1.2} fill="none" stroke="#94a3b8" strokeWidth={0.5} opacity={0.7}/>)}
      {[-49, 8].map(x => <rect key={x} x={x} y={-39} width={5} height={24} rx={1} fill="none" stroke="#94a3b8" strokeWidth={0.6}/>)}
      <Glass d="M15 -41.6 C27 -41 37 -37 44.5 -30.5 L46.5 -28 L28 -27.5 C24 -27.5 18 -30 15 -33 Z"/>
      <path d="M19 -40 C28 -39 35 -36 40 -32" stroke="#fff" strokeWidth={0.8} opacity={0.5} fill="none"/>
      <path d="M49 -19.5 L55.2 -19.2" stroke="#fffdf2" strokeWidth={1.6} strokeLinecap="round"/>
      <Lamp x={55} y={-18.6} r={1.6}/><Tail x={-50} y={-24} brake={brake}/>
      <Coupler x={55} dir={1}/>
    </g>
    <Sparks xs={[-30, 30]} sp={sp} brake={brake}/>
  </>;
}

function Wdg4({ sp, brake, emg, c }) {
  return <>
    <Beam x={51} y={-31} sp={sp} spread={12}/>
    <Puffs x={-6} y={-44} sp={sp}/>
    <g className="lsx-bob" style={bobS(sp)}>
      <Beacon x={34} y={-48} on={emg}/>
      <rect x={-9} y={-43} width={6} height={7} rx={1} fill="#1f2937"/><rect x={-10} y={-44} width={8} height={1.6} fill="#374151"/>
      {[-40, -28].map(x => <ellipse key={x} cx={x} cy={-37} rx={5.4} ry={1.6} fill="#1f2937"/>)}
      <rect x={-47} y={-37} width={71} height={22} rx={1.5} fill="url(#lsxBlue)" stroke="#0f1d4a" strokeWidth={0.7}/>
      <rect x={-45.5} y={-35} width={15} height={12} fill="#0f2f63"/>
      {Array.from({ length: 6 }, (_, k) => <line key={k} x1={-45} x2={-31} y1={-34 + k * 2} y2={-34 + k * 2} stroke="#5b9be8" strokeWidth={0.55}/>)}
      {[-28, -18, -8, 2, 12].map(x => <g key={x}><rect x={x} y={-35} width={8.6} height={12.5} rx={0.6} fill="none" stroke="#0f2f63" strokeWidth={0.6}/><rect x={x + 2} y={-33} width={4.6} height={2.2} fill="#0f2f63"/></g>)}
      <path d="M24 -45 L42 -45 L44 -41 L44 -15 L24 -15 Z" fill="url(#lsxBlue)" stroke="#0f1d4a" strokeWidth={0.7} strokeLinejoin="round"/>
      <path d="M44 -34 L50 -32 L50 -15 L44 -15 Z" fill="url(#lsxBlue)" stroke="#0f1d4a" strokeWidth={0.7}/>
      <Glass d="M28 -42.5 L39.5 -42.5 L39.5 -34.5 L28 -34.5 Z"/>
      <Glass d="M41.4 -43 L43 -43 L44.5 -36 L41.4 -36 Z"/>
      <rect x={-48} y={-23} width={99} height={3.6} fill="#facc15"/>
      <rect x={-48} y={-19.4} width={99} height={1.6} fill="#f8fafc"/>
      <rect x={-48} y={-17.8} width={99} height={1.8} fill={c}/>
      <rect x={-49} y={-15} width={100} height={2.4} fill="#1f2937"/>
      <line x1={-46} x2={24} y1={-40.5} y2={-40.5} stroke="#d1d5db" strokeWidth={0.55}/>
      {[-44, -32, -20, -8, 4, 16].map(x => <line key={x} x1={x} x2={x} y1={-40.5} y2={-37} stroke="#d1d5db" strokeWidth={0.5}/>)}
      <rect x={-17} y={-12.6} width={34} height={6.6} rx={2.6} fill="url(#lsxTank)" stroke="#0b0f14" strokeWidth={0.5}/>
      <Lamp x={50} y={-31.6} r={1.9}/><Lamp x={50.4} y={-17.6} r={1.2}/><Tail x={-48.4} y={-26} brake={brake}/>
      <path d="M49 -12.5 L55 -2.5 L49 -2.5 Z" fill="#374151"/>
      <Coupler x={50} dir={1}/><Coupler x={-48} dir={-1}/>
    </g>
    <Bogie cx={-29} n={3} sp={sp} frame="#262b33"/><Bogie cx={30} n={3} sp={sp} frame="#262b33"/>
    <Sparks xs={[-29, 30]} sp={sp} brake={brake}/>
  </>;
}

function MetroEmu({ sp, brake, emg, c }) {
  return <>
    <Beam x={51} y={-17} sp={sp} spread={11}/>
    <g className="lsx-bob" style={bobS(sp)}>
      {[-36, 8].map(x => <rect key={x} x={x} y={-47.4} width={14} height={4} rx={2} fill="url(#lsxRoof)"/>)}
      <Panto x={-10} roof={-43.6} up flip/><Arc x={-10} y={-66} sp={sp}/>
      <Beacon x={30} y={-45} on={emg}/>
      <path d="M-49 -10 L40 -10 C47 -10 51 -13 51 -18.5 L48 -37 C47 -41.4 43.4 -43.6 38 -43.6 L-49 -43.6 Z" fill="url(#lsxSteel)" stroke="#64748b" strokeWidth={0.7}/>
      {Array.from({ length: 12 }, (_, k) => <line key={k} x1={-48} x2={36} y1={-42 + k * 2.4} y2={-42 + k * 2.4} stroke="#fff" strokeWidth={0.25} opacity={0.25}/>)}
      <Glass d="M37 -41 C42 -41 45 -38.6 46 -35 L48.4 -24.5 L37 -24.5 Z"/>
      <path d="M39 -40 C42 -40 43.4 -38.4 44 -36" stroke="#fff" strokeWidth={0.7} opacity={0.5} fill="none"/>
      {[-45, -16, 13].map(x => <rect key={x} x={x} y={-38.5} width={12} height={9.4} rx={1.6} fill="url(#lsxGlass)"/>)}
      {[-31, -2, 27].map(x => (
        <g key={x}><rect x={x} y={-40.4} width={9} height={28} rx={1} fill="#e2e8f0" stroke="#64748b" strokeWidth={0.6}/>
          <line x1={x + 4.5} x2={x + 4.5} y1={-40.4} y2={-12.4} stroke="#64748b" strokeWidth={0.5}/>
          <rect x={x + 1} y={-38} width={2.8} height={7} rx={0.6} fill="url(#lsxGlass)"/><rect x={x + 5.2} y={-38} width={2.8} height={7} rx={0.6} fill="url(#lsxGlass)"/></g>
      ))}
      <rect x={-49} y={-21.6} width={99.5} height={5} fill={c}/>
      <rect x={-49} y={-12.2} width={91} height={2.2} fill="#475569"/>
      <path d="M44.6 -18 L50.2 -18" stroke="#fffdf2" strokeWidth={1.6} strokeLinecap="round"/>
      <Lamp x={50.4} y={-17.4} r={1.4}/><Tail x={-49} y={-26} brake={brake}/>
      <Coupler x={50} dir={1}/>
    </g>
    <Bogie cx={-30} n={2} sp={sp} r={4.2}/><Bogie cx={28} n={2} sp={sp} r={4.2}/>
    <Sparks xs={[-30, 28]} sp={sp} brake={brake}/>
  </>;
}

function SteamWp({ sp, brake, emg, c }) {
  const rod = { animationDuration: `${moving(sp) ? Math.max(0.25, 40 / sp).toFixed(2) : 6}s`, animationPlayState: moving(sp) ? "running" : "paused" };
  return <>
    <Beam x={50} y={-29} sp={sp} spread={12}/>
    <Puffs x={31} y={-50} sp={sp} color="#e5e7eb" n={4}/>
    <g className="lsx-bob" style={bobS(sp)}>
      <Beacon x={-28} y={-51} on={emg}/>
      <path d="M27 -46 L35 -46 L34 -36 L28 -36 Z" fill="#111827" stroke="#374151" strokeWidth={0.6}/><rect x={26} y={-47.6} width={10} height={2.2} rx={0.8} fill="#374151"/>
      <rect x={-12} y={-37} width={50} height={21} rx={10} fill="url(#lsxBlack)" stroke="#000" strokeWidth={0.6}/>
      {[-2, 12, 26].map(x => <line key={x} x1={x} x2={x} y1={-36.6} y2={-16.4} stroke="#cbd5e1" strokeWidth={0.9} opacity={0.8}/>)}
      <path d="M6 -37 a5 4 0 0 1 10 0 Z" fill="#cbd5e1"/><path d="M18 -37 a3.6 3 0 0 1 7.2 0 Z" fill="#9ca3af"/>
      <path d="M37 -36.6 C44 -35.6 48.6 -31 48.6 -26.5 C48.6 -22 44 -17.4 37 -16.4 Z" fill="url(#lsxSilver)" stroke="#475569" strokeWidth={0.6}/>
      <path d="M44.2 -29.4 l.9 2 l2.2 .2 l-1.7 1.4 l.6 2.1 l-2 -1.2 l-1.9 1.2 l.6 -2.1 l-1.7 -1.4 l2.2 -.2 z" fill="#fde047"/>
      <path d="M-44 -48 L-10 -48 L-8 -45 L-46 -45 Z" fill="#1f2937"/>
      <rect x={-44} y={-45} width={33} height={31} rx={1.5} fill="url(#lsxBlack)" stroke="#000" strokeWidth={0.6}/>
      <rect x={-38} y={-41} width={13} height={10} rx={1} fill="url(#lsxFire)"/>
      <rect x={-21} y={-41} width={7} height={10} rx={1} fill="url(#lsxGlass)"/>
      <rect x={-46} y={-16.6} width={92} height={2.4} fill="#111827"/>
      <rect x={-46} y={-14.4} width={92} height={3} fill="#b91c1c"/>
      <rect x={-46} y={-11.4} width={92} height={1.6} fill={c}/>
      <rect x={44} y={-17} width={4} height={7.4} fill="#b91c1c"/>
      <path d="M46 -9.8 L55 -1.2 L46 -1.2 Z" fill="#b91c1c" stroke="#7f1d1d" strokeWidth={0.5}/>
      {[48.6, 51, 53.2].map(x => <line key={x} x1={x} x2={x - 2} y1={-9.8 + (x - 46) * 0.95} y2={-1.2} stroke="#111827" strokeWidth={0.6}/>)}
      <Lamp x={47.6} y={-29} r={2.2}/><Tail x={-45} y={-26} brake={brake}/>
      <Coupler x={-46} dir={-1}/>
    </g>
    {[-30, -8, 14].map(x => <SpokeWheel key={x} x={x} y={-10} r={10} sp={sp}/>)}
    {[32, 42].map(x => <SpokeWheel key={x} x={x} y={-4.6} r={4.6} sp={sp}/>)}
    <g className="lsx-rod" style={rod}>
      <rect x={-31.5} y={-11.2} width={47} height={2.4} rx={1.2} fill="#d1d5db" stroke="#6b7280" strokeWidth={0.4}/>
      {[-30, -8, 14].map(x => <circle key={x} cx={x} cy={-10} r={1.5} fill="#9ca3af"/>)}
    </g>
    <rect x={18} y={-21} width={16} height={6} rx={1.5} fill="#374151"/>
    <Sparks xs={[-30, -8, 14]} sp={sp} brake={brake}/>
  </>;
}

function NeonHud({ sp, brake, emg, c }) {
  const fill = brake >= 2 ? "#ef4444" : c;
  const per = moving(sp) ? Math.max(0.35, 1.4 - sp / 110) : 1;
  return <>
    <Beam x={46} y={-20} sp={sp}/>
    <g className="lsx-bob" style={bobS(sp)}>
      <Beacon x={-26} y={-40} on={emg}/>
      <path d="M-46 -36 L18 -36 L48 -20 L18 -4 L-46 -4 L-34 -20 Z" fill={fill} fillOpacity={0.16} stroke={fill} strokeWidth={3} strokeLinejoin="round" filter="url(#lsxGlow)"/>
      {[-26, -10, 6].map((x, i) => (
        <path key={x} className="lsx-chev" d={`M${x} -28 L${x + 8} -20 L${x} -12`} fill="none" stroke={fill} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round"
          style={{ animationDuration: `${per.toFixed(2)}s`, animationDelay: `${(i * per / 3).toFixed(2)}s`, animationPlayState: moving(sp) ? "running" : "paused" }}/>
      ))}
      <circle cx={38} cy={-20} r={3} fill="#fff"/><Tail x={-44} y={-20} brake={brake}/>
    </g>
    <line x1={-42} x2={40} y1={-1} y2={-1} stroke={fill} strokeWidth={2} strokeLinecap="round" opacity={0.7}/>
    <Sparks xs={[-30, 26]} sp={sp} brake={brake}/>
  </>;
}

/** All styles, in the order the Settings picker shows them. "classic" = LiveTrackProfile's own LocoIcon. */
export const LOCO_STYLES = [
  { id: "classic", name: "Classic", note: "the original yellow loco", Draw: Classic },
  { id: "wap7", name: "WAP-7 Electric", note: "Indian Railways electric", Draw: Wap7 },
  { id: "vandebharat", name: "Vande Bharat", note: "semi high-speed train", Draw: VandeBharat },
  { id: "wdg4", name: "WDG-4G Diesel", note: "Indian Railways diesel", Draw: Wdg4 },
  { id: "metro", name: "Metro EMU", note: "stainless car, line band", Draw: MetroEmu },
  { id: "steam", name: "Steam WP", note: "heritage bullet nose", Draw: SteamWp },
  { id: "hud", name: "Neon HUD", note: "abstract, clearest small", Draw: NeonHud },
];

/**
 * One loco in the chosen style — same props as the classic LocoIcon. Scaled from the 100-unit
 * drawing to `size`, with the rail on the same line as the classic icon (0.29 × size below its centre).
 */
export function StyledLoco({ style, color, size = 22, speed = 0, reverse = false, brake = 0, emergency = 0, tilt = 0 }) {
  const S = LOCO_STYLES.find(x => x.id === style) || LOCO_STYLES[0];
  const Draw = S.Draw;
  const railY = size * 0.62 * 0.47, s = size / 100;
  const emg = emergency > 0 || brake === 4;
  return (
    <g transform={`translate(0 ${railY.toFixed(2)})`}>
      <LsxDefs/>
      <g style={{ transform: `rotate(${(Number(tilt) || 0).toFixed(2)}deg)`, transformOrigin: "0px 0px", transition: "transform 0.7s cubic-bezier(0.22,1,0.36,1)" }}>
        <g transform={`scale(${s.toFixed(4)})${reverse ? " scale(-1 1)" : ""}`}>
          <ellipse cx={0} cy={1.2} rx={60} ry={4.6} fill="url(#lsxShadow)"/>
          <line x1={-70} x2={76} y1={0.8} y2={0.8} stroke={color} strokeWidth={1.3} opacity={0.5} strokeLinecap="round"/>
          <Draw sp={speed > 0 ? speed : 0} brake={brake} emg={emg} c={color}/>
        </g>
      </g>
    </g>
  );
}

/** Small animated preview of a style (⚙ Settings picker) */
export function LocoStylePreview({ style, color = "#22d3ee", speed = 60, width = 96 }) {
  return (
    <svg width={width} height={width * 0.5} viewBox="-62 -46 124 62" aria-hidden="true" style={{ display: "block" }}>
      <style>{LOCO_STYLE_CSS}</style>
      <line x1={-62} x2={62} y1={0} y2={0} stroke="#334155" strokeWidth={1}/>
      <g transform={`translate(0 ${(-100 * 0.62 * 0.47).toFixed(2)})`}>
        <StyledLoco style={style} color={color} size={100} speed={speed}/>
      </g>
    </svg>
  );
}
