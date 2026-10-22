/**
 * dmiSimEncoder.js — bit-exact packet builders for the 🚆 DMI SIM page.
 *
 * Every field is written in the order, width and condition that backend/decoder.py reads it
 * (RDSO/SPN/196/2020 Annexure-C), so what the simulator sends is exactly what the LIVE DMI
 * decodes:
 *   C.4.2 Station → Loco Regular   (PKT_TYPE 9)  header + MA / SSP / gradient / LC gate /
 *                                                  turnout / tag linking / track condition / TSR
 *   C.4.3 Loco → Station Regular   (PKT_TYPE 10)
 *   C.4.5 Additional Emergency     (PKT_TYPE 12)
 *   C.4.6 Loco Access Request      (PKT_TYPE 13)
 * PKT_CRC = project CRC-32 (init 0, no final XOR — same as svk_sim.c crc32_calc() and
 * decoder.py calculate_crc32_ieee()) over every byte before it. MAC codes are 0.
 * Pure functions — no React, so they can be tested on their own.
 */

/* ── bit writer ── */
class Bits {
  constructor() { this.s = ""; }
  /** unsigned value, n bits, MSB first (values are clamped to the field) */
  u(v, n) {
    const max = 2 ** n - 1;
    const x = Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    this.s += x.toString(2).padStart(n, "0");
    return this;
  }
  /** two's-complement signed value, n bits */
  sgn(v, n) {
    const lo = -(2 ** (n - 1)), hi = 2 ** (n - 1) - 1;
    let x = Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
    if (x < 0) x += 2 ** n;
    this.s += x.toString(2).padStart(n, "0");
    return this;
  }
  add(b) { this.s += b.s; return this; }
  get length() { return this.s.length; }
  /** pad with 0 to the next byte */
  pad() { const r = this.s.length % 8; if (r) this.s += "0".repeat(8 - r); return this; }
}

/* ── project CRC-32 (reflected poly 0xEDB88320, init 0, no final XOR) ── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
export function projectCrc32(bytes) {
  let crc = 0;
  for (const b of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xff];
  return crc >>> 0;
}

/** bit string (multiple of 8) + trailing CRC → upper-case hex */
function finish(bits) {
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const crc = projectCrc32(bytes);
  bytes.push((crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff);
  return bytes.map(b => b.toString(16).toUpperCase().padStart(2, "0")).join("");
}

/** KAVACH FRAME_NUM: second of the day + 1 (decoder.py frame_num_to_time) */
export function frameNumNow(date = new Date()) {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + 1;
}

/* speed (kmph) → 6-bit speed code (v × 5 kmph, 1…50) — Annexure-C speed fields */
export const speedCode = kmph => Math.max(1, Math.min(50, Math.round((Number(kmph) || 0) / 5)));
/* turnout speed (kmph) → 5-bit code (v × 5 kmph, 1…18) */
export const turnoutCode = kmph => Math.max(1, Math.min(18, Math.round((Number(kmph) || 0) / 5)));

/* ═══════════════════════════════════════════════════════════════
   C.4.2 — sub-packets
   Each sub-packet: SUB_PKT_TYPE(4) + SUB_PKT_LENGTH(7) + body, padded to whole bytes.
   SUB_PKT_LENGTH = N with (N + 1) bytes in total (decoder.py: payload = (N+1)*8 − 11 bits).
═══════════════════════════════════════════════════════════════ */
function subPkt(type, body) {
  const total = Math.ceil((11 + body.length) / 8);          // bytes, incl. the 11-bit header
  const b = new Bits().u(type, 4).u(total - 1, 7).add(body).pad();
  return b;
}

/** MA sub-packet (type 0) */
function maSub(ma) {
  const b = new Bits()
    .u(ma.frameOffset || 0, 4)                 // FRAME_OFFSET
    .u(ma.destLocoSos || 0, 4)                 // DEST_LOCO_SOS
    .u(ma.trainSectionType ?? 1, 2)            // TRAIN_SECTION_TYPE
    .u(ma.curSigInfo || 0, 17)                 // CUR_SIG_INFO a16…a0
    .u(ma.curSigAspect || 0, 6)                // CUR_SIG_ASPECT
    .u(ma.nextSigAspect || 0, 6)               // NEXT_SIG_ASPECT
    .u(ma.apprSigDist || 0, 15)                // APPR_SIG_DIST
    .u(ma.authorityType ?? 2, 2);              // AUTHORITY_TYPE
  if ((ma.authorityType ?? 2) === 1) b.u(speedCode(ma.authorizedSpeed), 6);   // AUTHORIZED_SPEED — OS only
  b.u(ma.maWrtSig ?? 0, 16);                   // MA_W_R_T_SIG (65535 = unknown)
  b.u(ma.reqShortenMa ? 1 : 0, 1);             // REQ_SHORTEN_MA
  if (ma.reqShortenMa) b.u(ma.newMa || 0, 16); // NEW_MA
  b.u(0, 1);                                   // TRN_LEN_INFO_STS
  b.u(0, 1);                                   // NEXT_STN_COMM
  return subPkt(0, b);
}

/** Static speed profile (type 1): [{ len (m), speed (kmph) }] — entry i covers the next len metres */
function sspSub(list) {
  const b = new Bits().u(list.length, 5);
  for (const e of list) b.u(e.len, 15).u(0, 1).u(speedCode(e.speed), 6);   // universal speed
  return subPkt(1, b);
}

/** Gradient profile (type 2): [{ dist, up, value }] */
function gradSub(list) {
  const b = new Bits().u(list.length, 5);
  for (const e of list) b.u(e.dist, 15).u(e.up ? 1 : 0, 1).u(e.value || 0, 5);
  return subPkt(2, b);
}

/** LC gate profile (type 3): [{ dist, id, unmanned }] */
function lcSub(list) {
  const b = new Bits().u(list.length, 5);
  for (const e of list) {
    b.u(e.dist, 15).u(e.id, 10).u(0, 3)          // LM_LC_Distance · LM_LC_ID_Numeric · suffix
      .u(e.unmanned ? 1 : 0, 1).u(e.cls ?? 4, 3) // LM_LC_Manning_Type · LM_LC_Class
      .u(0, 1).u(0, 2);                          // auto whistling enabled · type
  }
  return subPkt(3, b);
}

/** Turnout speed profile (type 4): [{ speed, dist, release }] — max 3 */
function turnoutSub(list) {
  const l = list.slice(0, 3);
  const b = new Bits().u(l.length, 2);
  for (const e of l) b.u(turnoutCode(e.speed), 5).u(e.dist, 15).u(e.release || 0, 12);
  return subPkt(4, b);
}

/** Tag linking information (type 5): [{ dist (from the previous tag), id }] */
function tliSub(list) {
  const b = new Bits().u(1, 4).u(list.length, 6);   // DIST_DUP_TAG = 1 m · ROUTE_RFID_CNT
  for (const e of list) b.u(e.dist, 11).u(e.id, 10).u(0, 1);
  b.u(0, 1);                                         // ABS_LOC_RESET
  b.u(0, 3);                                         // ADJ_LINE_CNT
  b.u(0, 9);                                         // LINE_TIN[1] (self TIN, don't care)
  return subPkt(5, b);
}

/** Track condition data (type 6): [{ type, start, len }] — max 15 */
function trackCondSub(list) {
  const l = list.slice(0, 15);
  const b = new Bits().u(l.length, 4);
  for (const e of l) b.u(e.type, 4).u(e.start, 15).u(e.len, 15);
  return subPkt(6, b);
}

/** TSR profile (type 7): [{ id, start, len, speed }] */
function tsrSub(list) {
  const b = new Bits().u(2, 2).u(list.length, 5);    // TSR_STATUS = latest TSR info present
  for (const e of list) b.u(e.id, 8).u(e.start, 15).u(e.len, 15).u(0, 1).u(speedCode(e.speed), 6).u(0, 2);
  return subPkt(7, b);
}

/**
 * C.4.2 Station → Loco Regular.
 * @param {object} s  { frameNum, stnId, stnVer, destLocoId, refProfId, lastRefRfid, distPktStart, pktDir,
 *                      ma: {…}, profile: { ssp, grad, lc, turnouts, tags, conds, tsr } | null }
 *   profile = null → MA sub-packet only (the station sends the profile only when it changes)
 */
export function buildC42(s) {
  const subs = new Bits().add(maSub(s.ma || {}));
  const p = s.profile;
  if (p) {
    if (p.ssp?.length) subs.add(sspSub(p.ssp));
    if (p.grad?.length) subs.add(gradSub(p.grad));
    if (p.lc?.length) subs.add(lcSub(p.lc));
    if (p.turnouts?.length) subs.add(turnoutSub(p.turnouts));
    if (p.tags?.length) subs.add(tliSub(p.tags));
    if (p.conds?.length) subs.add(trackCondSub(p.conds));
    if (p.tsr?.length) subs.add(tsrSub(p.tsr));
  }
  const bodyBits = 104 - 14 + subs.length + 64;      // header after type+length, subs, MAC + CRC
  const totalBytes = (14 + bodyBits) / 8;
  const b = new Bits()
    .u(9, 4).u(totalBytes - 1, 10)                   // PKT_TYPE · PKT_LENGTH
    .u(s.frameNum ?? frameNumNow(), 17)              // FRAME_NUM
    .u(s.stnId, 16).u(s.stnVer ?? 2, 3)              // SOURCE_STN_ILC_IBS_ID · VERSION
    .u(s.destLocoId || 0, 20)                        // DEST_LOCO_ID (0 = all locos)
    .u(s.refProfId || 0, 4)                          // REF_PROF_ID
    .u(s.lastRefRfid || 0, 10)                       // LAST_REF_RFID
    .sgn(s.distPktStart || 0, 15)                    // DIST_PKT_START (signed)
    .u(s.pktDir ?? 1, 2)                             // PKT_DIR
    .u(0, 3)                                         // padding
    .add(subs)
    .u(0, 32);                                       // LOCO_Specific_MAC_CODE (PKT_CRC added by finish)
  return finish(b.s);
}

/**
 * C.4.3 Loco → Station Regular (29 bytes).
 * @param {object} l { frameNum, locoId, absLoc (m, null = invalid), trainLen, speed, dir (1 N / 2 R),
 *                     emg, mode, lastTag, tagLink, brake, lastProfNum }
 */
export function buildC43(l) {
  const b = new Bits()
    .u(10, 4).u(28, 7)                               // PKT_TYPE · PKT_LENGTH (29 bytes)
    .u(l.frameNum ?? frameNumNow(), 17)
    .u(l.locoId, 20).u(2, 3)                         // SOURCE_LOCO_ID · VERSION
    .u(l.absLoc == null ? 8388607 : l.absLoc, 23)    // ABS_LOCO_LOC
    .u(0, 9).u(0, 9)                                 // L_DOUBTOVER · L_DOUBTUNDER
    .u(1, 2)                                         // TRAIN_INT
    .u(l.trainLen || 0, 11)                          // TRAIN_LENGTH
    .u(l.speed, 9)                                   // TRAIN_SPEED
    .u(l.dir ?? 1, 2)                                // MOVEMENT_DIR
    .u(l.emg || 0, 3)                                // EMERGENCY_STATUS
    .u(l.mode || 1, 4)                               // LOCO_MODE
    .u(l.lastTag || 0, 10)                           // LAST_RFID_TAG
    .u(0, 1)                                         // TAG_DUP
    .u(l.tagLink || 0, 3)                            // TAG_LINK_INFO
    .u(0, 9)                                         // TIN
    .u(l.brake || 0, 3)                              // Brake_Applied
    .u(0, 2)                                         // NEW_MA_REPLY
    .u(l.lastProfNum || 0, 4)                        // LAST_REF_PROFILE_NUM
    .u(0, 1).u(0, 4).u(0, 2).u(0, 6)                 // SIG_OV · Info_Ack · Spare · Loco_Health_Status
    .u(0, 32);                                       // MAC_CODE
  return finish(b.s);
}

/** C.4.6 Loco Access Request (29 bytes) — same loco fields, no tag link / brake */
export function buildC46(l) {
  const b = new Bits()
    .u(13, 4).u(28, 7)
    .u(l.frameNum ?? frameNumNow(), 17)
    .u(l.locoId, 20).u(2, 3)
    .u(l.absLoc == null ? 8388607 : l.absLoc, 23)
    .u(l.trainLen || 0, 11)
    .u(l.speed, 9)
    .u(l.dir ?? 1, 2)
    .u(l.emg || 0, 3)
    .u(l.mode || 1, 4)
    .u(l.apprStnId || 0, 16)                         // Approaching Station ID
    .u(l.lastTag || 0, 10)                           // LAST_RFID_TAG
    .u(0, 9)                                         // TIN
    .u(0, 21).u(0, 20)                               // Longitude · Latitude
    .u(0, 16)                                        // LOCO_RND_NUM_RL
    .u(0, 5);                                        // padding
  return finish(b.s);
}

/** C.4.5 Additional Emergency (13 bytes): station General SoS to all locos */
export function buildC45(e) {
  const b = new Bits()
    .u(12, 4).u(12, 7)                               // PKT_TYPE · PKT_LENGTH (13 bytes)
    .u(e.frameNum ?? frameNumNow(), 17)
    .u(e.stnId, 16).u(2, 3)
    .u(e.stnLoc || 0, 23)                            // STN_ILC_IBS_LOC
    .u(e.sos ? 1 : 0, 1)                             // GEN_SOS_CALL
    .u(0, 1);                                        // padding
  return finish(b.s);
}

/** CUR_SIG_INFO (17 bits): a16 stop · a15 override · a14…a9 signal type · a8…a5 line · a4…a0 line no */
export function sigInfo({ stop = 0, override = 0, type = 0, line = 0, lineNo = 0 }) {
  return ((stop & 1) << 16) | ((override & 1) << 15) | ((type & 0x3f) << 9) | ((line & 0xf) << 5) | (lineNo & 0x1f);
}
