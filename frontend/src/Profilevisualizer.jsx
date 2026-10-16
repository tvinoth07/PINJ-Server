/* ═══════════════════════════════════════════════════════════════════════════
   KAVACH DECODEX — Advanced ProfileVisualizer (Drop-in replacement)
   
   DESIGN:
   • X-axis  = Absolute distance from Ref RFID — ALL TLI tag IDs shown as
               vertical lane-markers with inter-tag distance labels
   • Left Y  = Speed (kmph)  — SSP step-function + MA + TSR
   • Right Y = Gradient axis per RDSO Annexure-I (0 = level, n = 1:1000/n)
               shown as a step-function with UP (positive) / DOWN (negative)
   • All 8 sub-packets visualised with layer toggles
   • Full hover-tooltip on every element
   
   USAGE — replace the existing ProfileVisualizer function in App.jsx.
   Everything from "function ProfileVisualizer" down to its closing "}" is
   replaced by this file.  PV_COLORS, pvSpd, extractProfile stay unchanged.
═══════════════════════════════════════════════════════════════════════════ */

/* ── Gradient value → "1:N" ratio label ── */
function gradRatioLabel(gval) {
  if (gval === 0)  return "Level";
  if (gval >= 30)  return ">1:33";
  return `1:${Math.floor(1000 / gval)}`;
}

/* ── Gradient value → approximate decimal slope ── */
function gradToSlope(gval) {
  if (gval === 0) return 0;
  if (gval >= 30) return 30;       // treat max as 30
  return gval;                     // use the encoded value directly as axis unit
}

/* ─── Main ProfileVisualizer component ──────────────────────── */
function ProfileVisualizer({ result, isLight }) {
  const isC42 = result && result.packet_type_value === 9;

  const prof = useMemo(() => {
    if (!isC42) return null;
    return extractProfile(result.fields || []);
  }, [result, isC42]);

  const [vis, setVis] = useState({
    ma: true, ssp: true, grad: true, tsr: true,
    tc: true, lc: true, to: true, tli: true
  });
  const toggle = k => setVis(v => ({ ...v, [k]: !v[k] }));
  const [tip, setTip] = useState(null);
  const svgRef = useRef(null);

  if (!result) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: 14, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
      <span style={{ fontSize: 48 }}>🗺</span>
      <span style={{ fontSize: 14 }}>No packet decoded yet</span>
      <span style={{ fontSize: 11, opacity: .6 }}>Decode a C.4.2 Station→Loco Regular packet</span>
    </div>
  );
  if (!isC42) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: 14, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
      <span style={{ fontSize: 48 }}>🗺</span>
      <span style={{ fontSize: 14, color: "var(--amber)" }}>Profile requires a C.4.2 packet</span>
      <span style={{ fontSize: 11, opacity: .6 }}>Current: {result.packet_type_name}</span>
    </div>
  );
  if (!prof) return null;

  /* ── theme ── */
  const bgC   = isLight ? "#f4f4fa" : "#07070d";
  const surf  = isLight ? "#ffffff" : "#0d0d11";
  const bdr   = isLight ? "#d4d4e8" : "#1e1e2e";
  const gridC = isLight ? "#e0e0f0" : "#131320";
  const textC = isLight ? "#5050a0" : "#6060a0";
  const axisC = isLight ? "#4040a0" : "#7070b0";

  /* ── chart geometry ─────────────────────────────────────────────
     Single viewport 1400 × 680 px.
     Left  margin = PAD_L  (speed axis labels + axis arrow)
     Right margin = PAD_R  (gradient axis labels + axis arrow)
     Top   margin = PAD_T  (chart title)
     Bottom margin = PAD_B (x-axis labels + RFID tag row)
  ── */
  const W = 1400, H = 680;
  const PAD_L = 72, PAD_R = 72, PAD_T = 52, PAD_B = 110;
  const GW = W - PAD_L - PAD_R;   // graph width
  const GH = H - PAD_T - PAD_B;   // graph height
  const OX = PAD_L;                // graph left x
  const OY = PAD_T + GH;          // graph bottom y (baseline)

  /* ── world extent (distance) ── */
  const maxD = Math.max(500, prof.maxDist);

  /* ── Left Y axis — Speed (kmph) ── */
  const allSpeeds = [
    prof.authSpeed,
    ...prof.ssp.map(s => s.speed),
    ...prof.tsrEntries.map(t => t.speed),
    30,
  ].filter(s => s > 0);
  const rawMaxSpd = Math.max(30, ...allSpeeds);
  const maxSpd = Math.ceil(rawMaxSpd / 20) * 20 + 20;

  /* ── Right Y axis — Gradient (annexure scale 0-30) ── */
  /* We show ± : uphill positive, downhill negative.
     Display range: -maxGrad to +maxGrad, centred on a "level" midline.  */
  const allGrads = prof.gradEntries.map(g => g.grad);
  const rawMaxGrad = Math.max(5, ...allGrads);
  const maxGrad = Math.min(30, Math.ceil(rawMaxGrad / 2) * 2 + 2);

  /* ── Scale functions ── */
  const xS  = d  => OX + Math.max(0, Math.min(d, maxD)) / maxD * GW;
  const ySp = sp => OY - Math.max(0, Math.min(sp, maxSpd)) / maxSpd * GH;

  /* Gradient Y: centre of plot is "Level" line, top = +maxGrad, bottom = -maxGrad */
  const GRAD_ZERO_Y = PAD_T + GH * 0.5;     // Y pixel for grad=0 (level)
  const GRAD_HALF   = GH * 0.40;             // half-height available for gradient
  const yGr = (gval, isUp) => {
    const sign  = isUp ? 1 : -1;
    const unit  = Math.min(gval, maxGrad) / maxGrad;
    return GRAD_ZERO_Y - sign * unit * GRAD_HALF;
  };

  /* ── X ticks: every Nth metre, plus every RFID tag ── */
  const xTickStep = maxD <= 500 ? 50 : maxD <= 1000 ? 100 : maxD <= 2000 ? 200
                  : maxD <= 5000 ? 500 : 1000;
  const xTicks = [];
  for (let d = 0; d <= maxD; d += xTickStep) xTicks.push(d);

  /* ── Speed Y ticks ── */
  const spdStep = maxSpd <= 60 ? 10 : maxSpd <= 150 ? 20 : 50;
  const spdTicks = [];
  for (let s = 0; s <= maxSpd; s += spdStep) spdTicks.push(s);

  /* ── Gradient Y ticks (right axis) ── */
  const gradTicks = [];
  for (let g = -maxGrad; g <= maxGrad; g += Math.max(1, Math.floor(maxGrad / 4))) {
    gradTicks.push(g);
  }
  if (!gradTicks.includes(0)) gradTicks.push(0);
  gradTicks.sort((a, b) => a - b);

  /* ── Tooltip helpers ── */
  const showTip = (e, lines) => {
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setTip({ px: e.clientX - rect.left, py: e.clientY - rect.top, lines });
  };
  const hideTip = () => setTip(null);

  const Dot = ({ cx, cy, r = 5, fill, stroke, tipLines }) => (
    <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke || bgC} strokeWidth={1.5}
      style={{ cursor: "crosshair" }}
      onMouseEnter={e => showTip(e, tipLines)}
      onMouseLeave={hideTip} />
  );

  /* ══════════════════════════════════════════════════════════════
     LAYER: RFID Tags (TLI) — BOTTOM ROW, X-AXIS MARKERS
     This is the primary X-axis reference. ALL tags shown with
     their IDs and inter-tag distances.
  ══════════════════════════════════════════════════════════════ */
  const TliLayer = () => {
    const refTag  = { id: prof.refRFID ?? '?', cumDist: 0, dist: 0 };
    const allTags = [refTag, ...prof.rfidTags];
    const TICK_Y  = OY + 4;      // where RFID tick meets x-axis
    const LABEL_Y = OY + 22;     // tag ID row
    const DIST_Y  = OY + 38;     // inter-tag distance label row
    const ABS_Y   = OY + 52;     // absolute distance label

    return (
      <g>
        {/* Track line at bottom */}
        <line x1={OX} y1={TICK_Y + 2} x2={xS(allTags[allTags.length - 1]?.cumDist || maxD)} y2={TICK_Y + 2}
          stroke={PV_COLORS.rfid} strokeWidth={1.5} opacity={0.35} />

        {allTags.map((tag, i) => {
          const x   = xS(tag.cumDist);
          const prev = i > 0 ? allTags[i - 1] : null;
          const next = i < allTags.length - 1 ? allTags[i + 1] : null;
          const isRef = i === 0;
          const fill  = isRef ? "#ffffff" : PV_COLORS.rfid;
          const stroke2 = isRef ? PV_COLORS.rfid : bgC;

          return (
            <g key={`tli_${i}`}>
              {/* Full-height hairline — dashed, very faint */}
              <line x1={x} y1={PAD_T} x2={x} y2={OY}
                stroke={PV_COLORS.rfid} strokeWidth={isRef ? 1.5 : 1}
                strokeDasharray={isRef ? "6,3" : "3,5"} opacity={isRef ? 0.4 : 0.2} />

              {/* Tick on baseline */}
              <line x1={x} y1={OY} x2={x} y2={TICK_Y + 6}
                stroke={PV_COLORS.rfid} strokeWidth={isRef ? 2 : 1.5} />

              {/* Tag dot */}
              <Dot cx={x} cy={TICK_Y + 2} r={isRef ? 6 : 4} fill={fill} stroke={stroke2}
                tipLines={[
                  isRef ? `🔷 Ref RFID #${tag.id}` : `📍 RFID #${tag.id}`,
                  `Cumulative dist: ${tag.cumDist} m`,
                  i > 0 ? `Inter-tag gap: ${tag.dist} m` : `Reference origin`,
                  next ? `→ Next tag #${next.id} in ${next.dist} m` : `← Last tag in route`,
                ]} />

              {/* Tag ID label */}
              <text x={x} y={LABEL_Y} textAnchor="middle" fontSize={isRef ? 10 : 9}
                fontWeight={isRef ? "bold" : "600"} fill={fill === "#ffffff" ? PV_COLORS.rfid : PV_COLORS.rfid}
                fontFamily="monospace">
                #{tag.id}
              </text>

              {/* Inter-tag distance (between this tag and NEXT) */}
              {next && (() => {
                const xNext = xS(next.cumDist);
                const mx = (x + xNext) / 2;
                const gapW = xNext - x;
                return (
                  <g key={`gap_${i}`}>
                    {gapW > 40 && (
                      <>
                        <line x1={x + 3} y1={DIST_Y} x2={xNext - 3} y2={DIST_Y}
                          stroke={PV_COLORS.rfid} strokeWidth={1} opacity={0.5}
                          markerStart="url(#arr-l)" markerEnd="url(#arr-r)" />
                        <text x={mx} y={DIST_Y - 4} textAnchor="middle" fontSize={8}
                          fill={textC} fontFamily="monospace" opacity={0.85}>
                          ←{next.dist}m→
                        </text>
                      </>
                    )}
                  </g>
                );
              })()}

              {/* Absolute position label (every other tag to avoid clutter) */}
              {tag.cumDist > 0 && (
                <text x={x} y={ABS_Y} textAnchor="middle" fontSize={7.5}
                  fill={textC} fontFamily="monospace" opacity={0.7}>
                  {tag.cumDist}m
                </text>
              )}
            </g>
          );
        })}

        {/* Arrow defs for inter-tag lines */}
        <defs>
          <marker id="arr-r" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
            <path d="M0,0 L4,2.5 L0,5" stroke={PV_COLORS.rfid} strokeWidth="1" fill="none" opacity="0.5" />
          </marker>
          <marker id="arr-l" markerWidth="5" markerHeight="5" refX="0" refY="2.5" orient="auto-start-reverse">
            <path d="M0,0 L4,2.5 L0,5" stroke={PV_COLORS.rfid} strokeWidth="1" fill="none" opacity="0.5" />
          </marker>
        </defs>
      </g>
    );
  };

  /* ══════════════════════════════════════════════════════════════
     LAYER: MOVEMENT AUTHORITY
  ══════════════════════════════════════════════════════════════ */
  const MaLayer = () => {
    if (!prof.maEnd) return null;
    const sigColor = prof.curSigAsp === 11 ? "#10b981"
                   : prof.curSigAsp === 2 || prof.curSigAsp === 10 ? "#fbbf24"
                   : "#ef4444";
    const authY = prof.authSpeed > 0 ? ySp(prof.authSpeed) : OY - GH * 0.5;
    return (
      <g>
        {/* MA shaded zone */}
        <rect x={OX} y={PAD_T} width={xS(prof.maEnd) - OX} height={GH}
          fill={PV_COLORS.ma} opacity={0.04} />

        {/* Auth speed horizontal dashed line */}
        <line x1={OX} y1={authY} x2={xS(prof.maEnd)} y2={authY}
          stroke={PV_COLORS.ma} strokeWidth={2} strokeDasharray="10,5" opacity={0.85} />
        <text x={OX + 8} y={authY - 9} fontSize={10} fontWeight="bold"
          fill={PV_COLORS.ma} fontFamily="monospace">
          AUTH {prof.authSpeed} kmph
        </text>
        <text x={(OX + xS(prof.maEnd)) / 2} y={authY + 14} textAnchor="middle" fontSize={9}
          fill={PV_COLORS.ma} fontFamily="monospace" opacity={0.7}>
          MA = {prof.maWRT < 65535 ? prof.maWRT + " m" : "SR Mode"}
        </text>

        {/* EOA vertical line */}
        <line x1={xS(prof.maEnd)} y1={PAD_T} x2={xS(prof.maEnd)} y2={OY}
          stroke={PV_COLORS.ma} strokeWidth={1.5} strokeDasharray="6,3" opacity={0.8} />
        <text x={xS(prof.maEnd) + 3} y={PAD_T + 14} fontSize={10} fontWeight="bold"
          fill={PV_COLORS.ma} fontFamily="monospace">EOA</text>

        {/* Signal marker */}
        {prof.sigPos > 0 && (
          <g>
            <line x1={xS(prof.sigPos)} y1={OY} x2={xS(prof.sigPos)} y2={PAD_T}
              stroke={sigColor} strokeWidth={1.5} strokeDasharray="5,3" opacity={0.7} />
            <polygon
              points={`${xS(prof.sigPos)},${PAD_T + 10} ${xS(prof.sigPos) + 14},${PAD_T + 24} ${xS(prof.sigPos) - 14},${PAD_T + 24}`}
              fill={sigColor} opacity={0.9} />
            <text x={xS(prof.sigPos)} y={PAD_T + 38} textAnchor="middle" fontSize={9}
              fontWeight="bold" fill={sigColor} fontFamily="monospace">
              SIG {prof.sigPos}m
            </text>
            <Dot cx={xS(prof.sigPos)} cy={authY} r={5} fill={sigColor}
              tipLines={[`Signal @ ${prof.sigPos} m`,
                `Aspect: ${PV_SIG_ASP[prof.curSigAsp] ?? '—'}`,
                `Auth speed: ${prof.authSpeed} kmph`]} />
          </g>
        )}

        {/* EOA dot */}
        <Dot cx={xS(prof.maEnd)} cy={authY} r={6} fill={PV_COLORS.ma}
          tipLines={[`EOA (End of Authority)`, `Distance: ${prof.maEnd} m`,
            `MA: ${prof.maWRT} m`, `Auth speed: ${prof.authSpeed} kmph`,
            `Auth type: ${PV_AUTH[prof.authType] ?? '—'}`]} />

        {/* Origin dot on MA line */}
        <Dot cx={OX} cy={authY} r={5} fill={PV_COLORS.ma}
          tipLines={[`MA start (Ref RFID #${prof.refRFID ?? '?'})`,
            `Distance: 0 m`, `Auth speed: ${prof.authSpeed} kmph`]} />
      </g>
    );
  };

  /* ══════════════════════════════════════════════════════════════
     LAYER: STATIC SPEED PROFILE (SSP)
     Step-function: each segment shows speed + width labels.
     Per your diagram: steps drop or rise between speed zones,
     with distance ("100 mtrs") labelled inside each step.
  ══════════════════════════════════════════════════════════════ */
  const SspLayer = () => {
    if (prof.ssp.length === 0) return null;

    /* Build the step polyline */
    let pathD = `M${OX},${OY}`;
    for (let i = 0; i < prof.ssp.length; i++) {
      const seg = prof.ssp[i];
      const x0  = xS(seg.startDist);
      const x1  = xS(seg.endDist);
      const sy  = ySp(seg.speed);
      if (i === 0) {
        if (seg.startDist > 0) pathD += ` L${x0},${OY}`;  // floor to first start
        pathD += ` L${x0},${sy}`;                          // rise
      } else {
        pathD += ` L${x0},${ySp(prof.ssp[i - 1].speed)}`; // horizontal at prev speed
        pathD += ` L${x0},${sy}`;                          // vertical step
      }
      pathD += ` L${x1},${sy}`;                            // horizontal run
    }
    /* close fill path */
    const lastSeg = prof.ssp[prof.ssp.length - 1];
    const fillD   = pathD + ` L${xS(lastSeg.endDist)},${OY} Z`;

    return (
      <g>
        <path d={fillD} fill={PV_COLORS.ssp} opacity={0.1} />
        <path d={pathD} fill="none" stroke={PV_COLORS.ssp}
          strokeWidth={2.5} strokeLinejoin="miter" />

        {prof.ssp.map((seg, i) => {
          const x0  = xS(seg.startDist);
          const x1  = xS(seg.endDist);
          const sy  = ySp(seg.speed);
          const cx  = (x0 + x1) / 2;
          const len = seg.endDist - seg.startDist;
          const pw  = x1 - x0;

          return (
            <g key={`ssp${i}`}>
              {/* Speed value label ABOVE the step line */}
              {pw > 36 && (
                <text x={cx} y={sy - 10} textAnchor="middle" fontSize={11}
                  fontWeight="bold" fill={isLight ? "#065f3a" : "#6ee7b7"}
                  fontFamily="monospace">
                  {seg.speed} kmph
                </text>
              )}
              {/* Width label INSIDE the shaded zone */}
              {pw > 50 && (
                <text x={cx} y={Math.min(sy + 20, OY - 8)} textAnchor="middle" fontSize={9}
                  fill={PV_COLORS.ssp} fontFamily="monospace" opacity={0.8}>
                  {len} m
                </text>
              )}
              {/* Vertical dashed guide at transition */}
              {x0 > OX + 3 && (
                <line x1={x0} y1={OY} x2={x0} y2={sy}
                  stroke={PV_COLORS.ssp} strokeWidth={1}
                  strokeDasharray="3,4" opacity={0.3} />
              )}
              {/* Corner dots with tooltips */}
              <Dot cx={x0} cy={sy} r={5} fill={PV_COLORS.ssp}
                tipLines={[`SSP Segment ${i + 1} — Start`,
                  `Start dist: ${seg.startDist} m`, `Speed: ${seg.speed} kmph`,
                  `Width: ${len} m`, `End at: ${seg.endDist} m`]} />
              <Dot cx={x1} cy={sy} r={4} fill={PV_COLORS.ssp}
                tipLines={[`SSP Segment ${i + 1} — End`,
                  `End dist: ${seg.endDist} m`, `Speed: ${seg.speed} kmph`,
                  i + 1 < prof.ssp.length
                    ? `↓ Next zone: ${prof.ssp[i + 1].speed} kmph`
                    : `← End of SSP profile`]} />
            </g>
          );
        })}
      </g>
    );
  };

  /* ══════════════════════════════════════════════════════════════
     LAYER: GRADIENT PROFILE
     Right Y-axis based. RDSO encodes gradient as:
       0 = level, 1 = 1:1000 to 1:500, 2 = 1:500 to 1:333 … n = 1:(1000/n)
     We render as a step-function on the right gradient axis.
     Uphill = positive (bar goes UP from level), Downhill = negative (bar DOWN).
     Step boxes filled green (up) or orange (down), labelled 1:N.
  ══════════════════════════════════════════════════════════════ */
  const GradLayer = () => {
    if (prof.gradEntries.length === 0) return null;

    const LEVEL_Y = GRAD_ZERO_Y;  // Y for gradient = 0

    /* Build the gradient step polyline */
    let gPath = `M${OX},${LEVEL_Y}`;
    for (let i = 0; i < prof.gradEntries.length; i++) {
      const seg = prof.gradEntries[i];
      const x0  = xS(seg.startDist);
      const x1  = xS(seg.endDist);
      const gy  = yGr(seg.grad, seg.isUp);

      if (i === 0) {
        if (seg.startDist > 0) gPath += ` L${x0},${LEVEL_Y}`;
        gPath += ` L${x0},${gy}`;
      } else {
        const prevSeg = prof.gradEntries[i - 1];
        gPath += ` L${x0},${yGr(prevSeg.grad, prevSeg.isUp)}`;
        gPath += ` L${x0},${gy}`;
      }
      gPath += ` L${x1},${gy}`;
    }
    const lastG   = prof.gradEntries[prof.gradEntries.length - 1];
    const gFillD  = gPath + ` L${xS(lastG.endDist)},${LEVEL_Y} Z`;

    return (
      <g>
        {/* Level (zero gradient) baseline — dashed across full chart */}
        <line x1={OX} y1={LEVEL_Y} x2={OX + GW} y2={LEVEL_Y}
          stroke={PV_COLORS.grad} strokeWidth={1} strokeDasharray="5,5" opacity={0.35} />
        <text x={OX - 6} y={LEVEL_Y + 4} textAnchor="end" fontSize={8}
          fill={PV_COLORS.grad} fontFamily="monospace" opacity={0.6}>Level</text>

        {/* Gradient filled step-function */}
        <path d={gFillD} fill={PV_COLORS.grad} opacity={0.08} />
        <path d={gPath} fill="none" stroke={PV_COLORS.grad}
          strokeWidth={2.5} strokeLinejoin="miter" />

        {/* Per-segment filled bars + labels */}
        {prof.gradEntries.map((seg, i) => {
          const x0   = xS(seg.startDist);
          const x1   = xS(seg.endDist);
          const gy   = yGr(seg.grad, seg.isUp);
          const cx   = (x0 + x1) / 2;
          const len  = seg.endDist - seg.startDist;
          const pw   = x1 - x0;
          const c    = seg.isUp ? "#10b981" : seg.grad > 0 ? "#f97316" : "#6b7280";
          const label = `${seg.isUp ? "▲ Up" : seg.grad === 0 ? "●" : "▼ Dn"} ${gradRatioLabel(seg.grad)}`;
          const topY  = Math.min(LEVEL_Y, gy);
          const boxH  = Math.abs(LEVEL_Y - gy);

          return (
            <g key={`grad${i}`}>
              {/* Coloured filled box between LEVEL and this step */}
              <rect x={x0} y={topY} width={Math.max(1, x1 - x0)} height={Math.max(1, boxH)}
                fill={c} opacity={0.18} />

              {/* Step label */}
              {pw > 40 && (
                <text x={cx}
                  y={seg.isUp ? gy - 9 : gy + 14}
                  textAnchor="middle" fontSize={10} fontWeight="bold"
                  fill={c} fontFamily="monospace">
                  {label}
                </text>
              )}
              {/* Width label */}
              {pw > 55 && (
                <text x={cx}
                  y={seg.isUp ? gy + 14 : Math.max(gy - 2, LEVEL_Y + 12)}
                  textAnchor="middle" fontSize={8.5}
                  fill={PV_COLORS.grad} fontFamily="monospace" opacity={0.8}>
                  {len} m
                </text>
              )}

              {/* Dots */}
              <Dot cx={x0} cy={gy} r={5} fill={c}
                tipLines={[`Gradient Seg ${i + 1} — Start`,
                  `Distance: ${seg.startDist} m`,
                  `Direction: ${seg.isUp ? "Uphill ▲" : seg.grad === 0 ? "Level ●" : "Downhill ▼"}`,
                  `Gradient: ${gradRatioLabel(seg.grad)} (code ${seg.grad})`,
                  `Width: ${len} m`]} />
              {i === prof.gradEntries.length - 1 && (
                <Dot cx={x1} cy={gy} r={4} fill={PV_COLORS.grad}
                  tipLines={[`Gradient profile end`, `${seg.endDist} m`]} />
              )}

              {/* Vertical guide at start */}
              {x0 > OX + 3 && (
                <line x1={x0} y1={LEVEL_Y} x2={x0} y2={gy}
                  stroke={c} strokeWidth={1} strokeDasharray="2,4" opacity={0.3} />
              )}
            </g>
          );
        })}

        {/* "Gradient" label on right axis */}
        <text
          x={OX + GW + PAD_R - 14}
          y={LEVEL_Y}
          textAnchor="middle"
          fontSize={8}
          fill={PV_COLORS.grad}
          fontFamily="monospace"
          opacity={0.7}
          transform={`rotate(-90, ${OX + GW + PAD_R - 14}, ${LEVEL_Y})`}>
          GRADIENT (Annexure-I) ↑Up ↓Down
        </text>
      </g>
    );
  };

  /* ══════════════════════════════════════════════════════════════
     LAYER: TSR (Temporary Speed Restrictions)
  ══════════════════════════════════════════════════════════════ */
  const TsrLayer = () => (
    <g>
      {prof.tsrEntries.map((t, i) => {
        const x1 = xS(t.dist);
        const x2 = xS(t.dist + Math.max(t.length, 20));
        const sy = ySp(t.speed);
        return (
          <g key={`tsr${i}`}>
            <rect x={x1} y={sy} width={Math.max(3, x2 - x1)} height={OY - sy}
              fill={PV_COLORS.tsr} opacity={0.18} rx={2} />
            <line x1={x1} y1={sy} x2={x2} y2={sy}
              stroke={PV_COLORS.tsr} strokeWidth={3.5} />
            <line x1={x1} y1={PAD_T} x2={x1} y2={OY}
              stroke={PV_COLORS.tsr} strokeWidth={1} strokeDasharray="3,4" opacity={0.4} />
            {(x2 - x1) > 28 && (
              <text x={(x1 + x2) / 2} y={sy - 9} textAnchor="middle" fontSize={10}
                fontWeight="bold" fill={PV_COLORS.tsr} fontFamily="monospace">
                TSR#{t.id} {t.speed} kmph
              </text>
            )}
            <Dot cx={x1} cy={sy} r={5} fill={PV_COLORS.tsr}
              tipLines={[`TSR #${t.id} — Start`, `Dist: ${t.dist} m`,
                `Length: ${t.length} m`, `Speed: ${t.speed} kmph`]} />
            <Dot cx={x2} cy={sy} r={4} fill={PV_COLORS.tsr}
              tipLines={[`TSR #${t.id} — End`, `${t.dist + t.length} m`]} />
          </g>
        );
      })}
    </g>
  );

  /* ══════════════════════════════════════════════════════════════
     LAYER: TRACK CONDITIONS
     Rendered as coloured bands near the top of the chart.
  ══════════════════════════════════════════════════════════════ */
  const TcLayer = () => {
    const TC_C = {
      1: "#dc2626", 2: "#6b7280", 3: "#7c3aed", 4: "#0e7490",
      5: "#d97706", 6: "#16a34a", 7: "#be185d", 8: "#92400e", 9: "#374151",
    };
    const BAND_Y = PAD_T + 8;
    const BAND_H = 16;
    return (
      <g>
        {prof.trackConds.map((tc, i) => {
          const c  = TC_C[tc.type] || PV_COLORS.tc;
          const x1 = xS(tc.start);
          const x2 = xS(tc.start + Math.max(tc.length, 20));
          return (
            <g key={`tc${i}`}>
              <rect x={x1} y={BAND_Y} width={Math.max(3, x2 - x1)} height={BAND_H}
                fill={c} opacity={0.8} rx={3} />
              {(x2 - x1) > 30 && (
                <text x={(x1 + x2) / 2} y={BAND_Y + 11} textAnchor="middle"
                  fontSize={8} fill="#fff" fontFamily="monospace">
                  {tc.typeName.slice(0, 10)}
                </text>
              )}
              <Dot cx={x1} cy={BAND_Y + BAND_H / 2} r={4} fill={c}
                tipLines={[`Track Condition: ${tc.typeName}`,
                  `Start: ${tc.start} m`, `Length: ${tc.length} m`]} />
              <Dot cx={x2} cy={BAND_Y + BAND_H / 2} r={3} fill={c}
                tipLines={[`${tc.typeName} end`, `${tc.start + tc.length} m`]} />
            </g>
          );
        })}
      </g>
    );
  };

  /* ══════════════════════════════════════════════════════════════
     LAYER: LC GATES
     Drawn as gate symbols (vertical bar + arm) at their distances.
  ══════════════════════════════════════════════════════════════ */
  const LcLayer = () => (
    <g>
      {prof.lcGates.map((lc, i) => {
        const x   = xS(lc.dist);
        const c   = lc.manned ? PV_COLORS.lc : "#ef4444";
        const top = OY - GH * 0.3;
        return (
          <g key={`lc${i}`}>
            {/* Full height dashed guide */}
            <line x1={x} y1={PAD_T + 28} x2={x} y2={OY}
              stroke={c} strokeWidth={1} strokeDasharray="3,4" opacity={0.3} />
            {/* Gate post */}
            <line x1={x} y1={OY} x2={x} y2={top}
              stroke={c} strokeWidth={3} />
            {/* Gate arm */}
            <line x1={x} y1={top} x2={x + 30} y2={top + 14}
              stroke={c} strokeWidth={2.5} />
            {/* Gate head */}
            <circle cx={x} cy={top} r={5} fill={c} />
            <text x={x} y={top - 12} textAnchor="middle" fontSize={10}
              fontWeight="bold" fill={c} fontFamily="monospace">
              LC#{lc.id}
            </text>
            <text x={x + 16} y={top + 13} fontSize={8} fill={c} fontFamily="monospace">
              {lc.manned ? "M" : "U"}
            </text>
            <Dot cx={x} cy={top} r={5} fill={c}
              tipLines={[`LC Gate #${lc.id}`,
                `Distance: ${lc.dist} m`,
                `Manning: ${lc.manned ? "Manned" : "Unmanned"}`,
                lc.lcClass != null ? `Class: ${lc.lcClass}` : ""
              ].filter(Boolean)} />
          </g>
        );
      })}
    </g>
  );

  /* ══════════════════════════════════════════════════════════════
     LAYER: TURNOUTS
     Drawn as a track-fork symbol.
  ══════════════════════════════════════════════════════════════ */
  const ToLayer = () => (
    <g>
      {prof.turnouts.map((to, i) => {
        const x    = xS(to.dist);
        const x2   = xS(to.dist + (to.relDist || 50));
        const BASE = OY - GH * 0.2;
        return (
          <g key={`to${i}`}>
            <line x1={x} y1={PAD_T + 28} x2={x} y2={OY}
              stroke={PV_COLORS.to} strokeWidth={1} strokeDasharray="3,4" opacity={0.3} />
            {/* Through rail */}
            <line x1={x - 16} y1={BASE} x2={x2} y2={BASE}
              stroke={PV_COLORS.to} strokeWidth={3} />
            {/* Diverging rail */}
            <line x1={x + 4} y1={BASE} x2={x + 28} y2={BASE - 22}
              stroke={PV_COLORS.to} strokeWidth={2} />
            {/* Frog point */}
            <circle cx={x + 4} cy={BASE} r={4.5} fill={PV_COLORS.to} />
            <text x={x} y={BASE - 28} textAnchor="middle" fontSize={10}
              fontWeight="bold" fill={PV_COLORS.to} fontFamily="monospace">
              TO{to.speed > 0 ? ` ${to.speed}k` : ''}
            </text>
            <Dot cx={x} cy={BASE} r={5} fill={PV_COLORS.to}
              tipLines={[`Turnout ${i + 1}`,
                `Start: ${to.dist} m`, `Speed: ${to.speed} kmph`,
                `Release dist: ${to.relDist} m`]} />
          </g>
        );
      })}
    </g>
  );

  /* ── Layer toggle buttons ── */
  const BTNS = [
    { k: 'ma',   l: 'MA',         c: PV_COLORS.ma   },
    { k: 'ssp',  l: 'SSP',        c: PV_COLORS.ssp  },
    { k: 'grad', l: 'Gradient',   c: PV_COLORS.grad },
    { k: 'tsr',  l: 'TSR',        c: PV_COLORS.tsr  },
    { k: 'tc',   l: 'Track Cond', c: PV_COLORS.tc   },
    { k: 'lc',   l: 'LC Gate',    c: PV_COLORS.lc   },
    { k: 'to',   l: 'Turnout',    c: PV_COLORS.to   },
    { k: 'tli',  l: 'TLI Tags',   c: PV_COLORS.rfid },
  ];

  /* ── Info cards (top strip) ── */
  const TRAIN_SEC_MAP = { 0: "Station Section", 1: "Absolute Block", 2: "Autoblock" };
  const SOS_LABELS = {
    1: "Foreign RFID", 2: "—", 3: "Odo Error≥120m", 4: "SPAD",
    5: "Rear-End", 6: "Head-On", 7: "Shunting Limit", 8: "General SoS"
  };
  const cards = [
    { l: "REF RFID",  v: `#${prof.refRFID ?? "—"}`,                                  c: "#a3e635" },
    { l: "DIRECTION", v: prof.pktDir === 1 ? "Nominal" : prof.pktDir === 2 ? "Reverse" : "—", c: "#94a3b8" },
    { l: "SIGNAL",    v: PV_SIG_ASP[prof.curSigAsp ?? -1] ?? "—",
                      c: prof.curSigAsp === 11 ? "#10b981" : prof.curSigAsp === 2 ? "#fbbf24" : "#ef4444" },
    { l: "AUTH SPD",  v: prof.authSpeed > 0 ? `${prof.authSpeed} kmph` : "—",         c: "#10b981" },
    { l: "AUTH TYPE", v: PV_AUTH[prof.authType] ?? "—",                               c: "#06b6d4" },
    { l: "MA",        v: prof.maWRT && prof.maWRT < 65535 ? `${prof.maWRT} m` : "SR", c: PV_COLORS.ma },
    { l: "SEC TYPE",  v: TRAIN_SEC_MAP[prof.trainSectionType] ?? "—",                 c: "#8b5cf6" },
    { l: "SSP segs",  v: `${prof.ssp.length}`,                                        c: PV_COLORS.ssp },
    { l: "GRAD segs", v: `${prof.gradEntries.length}`,                                c: PV_COLORS.grad },
    { l: "LC gates",  v: `${prof.lcGates.length}`,                                    c: PV_COLORS.lc },
    { l: "Turnouts",  v: `${prof.turnouts.length}`,                                   c: PV_COLORS.to },
    { l: "TLI tags",  v: `${prof.rfidTags.length}`,                                   c: PV_COLORS.rfid },
    { l: "TSR",       v: `${prof.tsrEntries.length}`,                                 c: PV_COLORS.tsr },
    { l: "Track Cond",v: `${prof.trackConds.length}`,                                 c: PV_COLORS.tc },
    ...(prof.destLocoSos > 0
      ? [{ l: "⚠ SoS", v: SOS_LABELS[prof.destLocoSos] || `Code ${prof.destLocoSos}`, c: "#ef4444" }]
      : []),
  ].filter(x => x.v !== "—" && x.v !== "0");

  /* ── Right axis: gradient ticks ── */
  const RightGradAxis = () => {
    const RX = OX + GW;
    return (
      <g>
        {/* Right vertical axis line */}
        <line x1={RX} y1={OY} x2={RX} y2={PAD_T - 10}
          stroke={axisC} strokeWidth={1.5} />
        {/* Arrow */}
        <polygon points={`${RX - 4},${PAD_T - 10} ${RX + 4},${PAD_T - 10} ${RX},${PAD_T - 20}`}
          fill={PV_COLORS.grad} opacity={0.7} />

        {/* Level tick + label */}
        <line x1={RX} y1={GRAD_ZERO_Y} x2={RX + 6} y2={GRAD_ZERO_Y}
          stroke={PV_COLORS.grad} strokeWidth={1.5} />
        <text x={RX + 8} y={GRAD_ZERO_Y + 4} fontSize={8}
          fill={PV_COLORS.grad} fontFamily="monospace">0 (Level)</text>

        {/* Positive (uphill) ticks */}
        {[1, 2, 3, 4, 5, 8, 10, 15, 20, 30].filter(g => g <= maxGrad).map(g => {
          const ty = yGr(g, true);
          if (ty < PAD_T + 5) return null;
          return (
            <g key={`rgt_u${g}`}>
              <line x1={RX} y1={ty} x2={RX + 5} y2={ty}
                stroke={PV_COLORS.grad} strokeWidth={1} />
              <text x={RX + 7} y={ty + 3.5} fontSize={7.5}
                fill={PV_COLORS.grad} fontFamily="monospace">
                +{g} ({gradRatioLabel(g)})
              </text>
            </g>
          );
        })}

        {/* Negative (downhill) ticks */}
        {[1, 2, 3, 4, 5, 8, 10, 15, 20, 30].filter(g => g <= maxGrad).map(g => {
          const ty = yGr(g, false);
          if (ty > OY - 4) return null;
          return (
            <g key={`rgt_d${g}`}>
              <line x1={RX} y1={ty} x2={RX + 5} y2={ty}
                stroke={PV_COLORS.grad} strokeWidth={1} />
              <text x={RX + 7} y={ty + 3.5} fontSize={7.5}
                fill={PV_COLORS.grad} fontFamily="monospace">
                -{g} ({gradRatioLabel(g)})
              </text>
            </g>
          );
        })}

        {/* Axis label */}
        <text x={RX + PAD_R - 10} y={GRAD_ZERO_Y} textAnchor="middle" fontSize={9}
          fontWeight="bold" fill={PV_COLORS.grad} fontFamily="monospace"
          transform={`rotate(-90, ${RX + PAD_R - 10}, ${GRAD_ZERO_Y})`}>
          Gradient (Annexure-I)
        </text>
      </g>
    );
  };

  /* ══════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════ */
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: bgC }}>

      {/* ── Info strip ── */}
      <div style={{ flexShrink: 0, display: "flex", gap: 5, padding: "5px 12px",
        borderBottom: `1px solid ${bdr}`, background: surf, flexWrap: "wrap", alignItems: "center" }}>
        {cards.map(({ l, v, c }) => (
          <div key={l} style={{ background: bgC, border: `1px solid ${c}33`,
            borderTop: `2px solid ${c}`, borderRadius: 4, padding: "2px 8px", minWidth: 60 }}>
            <div style={{ fontSize: 7, color: textC, fontFamily: "var(--font-mono)",
              textTransform: "uppercase", letterSpacing: ".07em" }}>{l}</div>
            <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", color: c }}>{v}</div>
          </div>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 9, color: textC, fontFamily: "var(--font-mono)" }}>
          C.4.2 · Stn #{prof.stnId ?? "?"} → Loco #{prof.destLoco ?? "?"} · RDSO/SPN/196/2020
        </div>
      </div>

      {/* ── Layer toggles ── */}
      <div style={{ flexShrink: 0, display: "flex", gap: 5, padding: "5px 12px",
        borderBottom: `1px solid ${bdr}`, background: surf, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 8, color: textC, fontFamily: "var(--font-mono)",
          textTransform: "uppercase", letterSpacing: ".1em", marginRight: 3 }}>LAYERS:</span>
        {BTNS.map(({ k, l, c }) => {
          const on = vis[k];
          return (
            <button key={k} onClick={() => toggle(k)} style={{
              display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
              borderRadius: 5, cursor: "pointer", fontFamily: "var(--font-mono)",
              fontSize: 10, fontWeight: 700, transition: "all .15s", userSelect: "none",
              border: `1.5px solid ${on ? c : isLight ? "#c0c0d0" : "#2a2a3a"}`,
              background: on ? `${c}1a` : isLight ? "#f0f0f8" : "#0e0e16",
              color: on ? c : isLight ? "#a0a0b0" : "#3a3a5a", opacity: on ? 1 : 0.5,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                background: on ? c : "transparent",
                border: `1.5px solid ${on ? c : isLight ? "#b0b0c0" : "#3a3a5a"}` }} />
              {l}
            </button>
          );
        })}

        {/* Gradient legend */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 8, color: "#10b981", fontFamily: "var(--font-mono)" }}>▲ Uphill</span>
          <span style={{ fontSize: 8, color: "#f97316", fontFamily: "var(--font-mono)" }}>▼ Downhill</span>
          <span style={{ fontSize: 8, color: "#6b7280", fontFamily: "var(--font-mono)" }}>● Level</span>
          <span style={{ fontSize: 8, color: textC, fontFamily: "var(--font-mono)", opacity: 0.7 }}>
            Grad: 1:N per Annexure-I
          </span>
        </div>
      </div>

      {/* ── SVG chart ── */}
      <div style={{ flex: 1, overflow: "auto", padding: "4px 8px", position: "relative" }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", minHeight: 360, display: "block", userSelect: "none" }}
          preserveAspectRatio="xMidYMid meet"
          onMouseLeave={hideTip}>

          {/* Background */}
          <rect x={0} y={0} width={W} height={H} fill={bgC} />

          {/* ── Grid lines ── */}
          {/* Horizontal speed grid */}
          {spdTicks.map(s => (
            <g key={`yg${s}`}>
              <line x1={OX} y1={ySp(s)} x2={OX + GW} y2={ySp(s)}
                stroke={gridC} strokeWidth={s === 0 ? 2 : 1} strokeDasharray={s === 0 ? "none" : "3,5"} />
              {/* Left Y axis ticks + labels */}
              <line x1={OX - 5} y1={ySp(s)} x2={OX} y2={ySp(s)} stroke={axisC} strokeWidth={1} />
              <text x={OX - 8} y={ySp(s) + 4} textAnchor="end" fontSize={10}
                fill={textC} fontFamily="monospace">{s}</text>
            </g>
          ))}

          {/* Vertical X grid */}
          {xTicks.map(d => (
            <g key={`xg${d}`}>
              <line x1={xS(d)} y1={PAD_T} x2={xS(d)} y2={OY}
                stroke={gridC} strokeWidth={1} strokeDasharray="3,5" opacity={0.6} />
              <line x1={xS(d)} y1={OY} x2={xS(d)} y2={OY + 5} stroke={axisC} strokeWidth={1} />
              <text x={xS(d)} y={OY + 68} textAnchor="middle" fontSize={9}
                fill={textC} fontFamily="monospace">{d}m</text>
            </g>
          ))}

          {/* ── Axes ── */}
          {/* Left Y axis */}
          <line x1={OX} y1={OY} x2={OX} y2={PAD_T - 12} stroke={axisC} strokeWidth={2.5} />
          <polygon points={`${OX - 5},${PAD_T - 12} ${OX + 5},${PAD_T - 12} ${OX},${PAD_T - 24}`}
            fill={axisC} />
          {/* X axis */}
          <line x1={OX} y1={OY} x2={OX + GW + 12} y2={OY} stroke={axisC} strokeWidth={2.5} />
          <polygon points={`${OX + GW + 12},${OY - 5} ${OX + GW + 12},${OY + 5} ${OX + GW + 24},${OY}`}
            fill={axisC} />

          {/* ── Axis labels ── */}
          {/* Speed Y axis label (left) */}
          <text x={15} y={OY - GH / 2} textAnchor="middle" fontSize={11}
            fontWeight="bold" fill={PV_COLORS.ssp} fontFamily="monospace"
            transform={`rotate(-90, 15, ${OY - GH / 2})`}>
            Speed (kmph) ↑
          </text>

          {/* X axis label */}
          <text x={OX + GW / 2} y={H - 6} textAnchor="middle" fontSize={11}
            fontWeight="bold" fill={axisC} fontFamily="monospace">
            ← Distance from Ref RFID #{prof.refRFID ?? "?"} (metres) →
          </text>

          {/* Chart title */}
          <text x={OX + GW / 2} y={PAD_T - 18} textAnchor="middle" fontSize={12.5}
            fontWeight="bold" fill={isLight ? "#1a1a2e" : "#e0e0f5"} fontFamily="monospace">
            KAVACH C.4.2 Profile · Stn #{prof.stnId ?? "?"} → Loco #{prof.destLoco ?? "?"} · Auth {prof.authSpeed} kmph · MA {prof.maWRT < 65535 ? prof.maWRT + "m" : "SR"}
          </text>

          {/* Right gradient axis */}
          {vis.grad && <RightGradAxis />}

          {/* Origin dot */}
          <circle cx={OX} cy={OY} r={5} fill={PV_COLORS.rfid}
            stroke={bgC} strokeWidth={1.5} />
          <text x={OX} y={OY + 14} textAnchor="middle" fontSize={8}
            fill={PV_COLORS.rfid} fontFamily="monospace">0m</text>

          {/* ── Profile layers (back-to-front) ── */}
          {vis.tc   && <TcLayer />}
          {vis.ma   && <MaLayer />}
          {vis.tsr  && <TsrLayer />}
          {vis.grad && <GradLayer />}
          {vis.ssp  && <SspLayer />}
          {vis.lc   && <LcLayer />}
          {vis.to   && <ToLayer />}
          {vis.tli  && <TliLayer />}

        </svg>

        {/* ── Floating tooltip ── */}
        {tip && (
          <div style={{
            position: "absolute",
            left: Math.min(tip.px + 14, W - 180),
            top: Math.max(tip.py - 10, 4),
            background: isLight ? "rgba(255,255,255,0.97)" : "rgba(10,10,20,0.97)",
            border: `1px solid ${isLight ? "#c0c0d8" : "#2a2a4a"}`,
            borderRadius: 6, padding: "7px 11px", pointerEvents: "none",
            zIndex: 100, boxShadow: "0 4px 16px rgba(0,0,0,0.35)", minWidth: 170,
          }}>
            {tip.lines.map((line, i) => (
              <div key={i} style={{
                fontSize: i === 0 ? 11 : 10, fontWeight: i === 0 ? 700 : 400,
                color: i === 0 ? (isLight ? "#1a1a2e" : "#e0e0f5") : (isLight ? "#5050a0" : "#8080b0"),
                fontFamily: "var(--font-mono)", lineHeight: 1.65,
              }}>{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}