"""
svk_sim_py.py — pure-Python port of svk_sim.c (the SVK SIM storyboard encoder).

Why: on Windows, Smart App Control blocks any DLL we compile ourselves (unsigned),
so PINJ cannot load svk_sim.c as a library there. This module does the same job in
plain Python — no compiler, no DLL — and is the encoder used by svk_sim_bridge.py.

It is a line-by-line port of svk_sim.c and keeps its exact behaviour, including the
C details that decide the bytes on air:
  • CSV numbers are read like C strtoll() (leading spaces skipped, a field such as
    "5 ," ends the row), on the UTF-8 bytes of the text, lines cut at 2047 bytes;
  • the five storyboard layouts (35+/28/19/15/10 columns) and their remaps;
  • CBC_MAC / PKT_CRC anchored to the last two columns of a 35+ column row;
  • PKT_CRC: CSV value 0 → CRC-32 (reflected 0xEDB88320, init 0, no final XOR)
    over every byte before the CRC; any other value is sent as written;
  • FRAME_NUM in the preview = odd 2-s epoch of the UTC clock (time(NULL) % 86400);
  • Track Profile (APD) routes ROUTE1..ROUTE4 and their amalgamation.
Its output is checked byte-for-byte against the C library (tools/compare_svk_sim.py).

Public API (same as the C exports, used by svk_sim_bridge.py):
  parse_station_xml(xml)        → JSON text      parse_storyboard_xml(xml) → JSON text
  encode_storyboard_csv(csv, radio_id) → list[dict]
  transmit_storyboard_csv(csv, dest_ip, dest_port, loop, radio_id, stop_event) → int
  svk_load_track_profile(text) → int            svk_track_profile_count() → int
  ota_prefix_hex(radio_id) → "F1A5C3" / "F2A5C3"
"""

import socket
import sys
import threading
import time

_U64 = (1 << 64) - 1
_U32 = 0xFFFFFFFF
_WS = b" \t\n\v\f\r"          # C isspace() in the "C" locale


def _i32(v: int) -> int:
    """C (int) cast of a long long."""
    v &= _U32
    return v - (1 << 32) if v & 0x80000000 else v


def _strtoll(s: bytes, i: int):
    """C strtoll(s + i, &end, 10) → (value, end index). end == i when no digits."""
    n = len(s)
    j = i
    while j < n and s[j] in _WS:
        j += 1
    neg = False
    if j < n and s[j] in b"+-":
        neg = s[j] == 0x2D
        j += 1
    k = j
    while j < n and 0x30 <= s[j] <= 0x39:
        j += 1
    if j == k:
        return 0, i
    v = int(s[k:j])
    if neg:
        v = -v
    if v > (1 << 63) - 1:
        v = (1 << 63) - 1
    elif v < -(1 << 63):
        v = -(1 << 63)
    return v, j


# ════════════════════════════════════════════════════════════════════════════
# SECTION 1 – tiny XML helpers (byte strings, C semantics incl. buffer sizes)
# ════════════════════════════════════════════════════════════════════════════

def _find_tag(src: bytes, tag: bytes):
    """→ (content_start, tag_end) or None. tag_end = after </tag>, or content_start."""
    close = b"</" + tag + b">"
    p = src.find(b"<" + tag)
    if p < 0:
        return None
    gt = src.find(b">", p)
    if gt < 0:
        return None
    cs = gt + 1
    cl = src.find(close, cs)
    return cs, (cl + len(close) if cl >= 0 else cs)


def _get_tag_text(src: bytes, tag: bytes, dst_len: int) -> bytes:
    ft = _find_tag(src, tag)
    if ft is None:
        return b""
    start = ft[0]
    end = src.find(b"</" + tag + b">", start)
    if end < 0:
        return b""
    while start < end and src[start] in _WS:
        start += 1
    while end > start and src[end - 1] in _WS:
        end -= 1
    return src[start:end][:dst_len - 1]


def _get_attr(tag_open: bytes, attr: bytes, dst_len: int) -> bytes:
    search = attr + b'="'
    p = tag_open.find(search)
    if p < 0:
        return b""
    p += len(search)
    q = tag_open.find(b'"', p)
    if q < 0:
        return b""
    return tag_open[p:q][:dst_len - 1]


def _json_escape(src: bytes, dst_len: int) -> bytes:
    out = bytearray()
    for c in src:
        if not len(out) < dst_len - 2:
            break
        if (c == 0x22 or c == 0x5C) and len(out) < dst_len - 3:
            out.append(0x5C)
        out.append(c)
    return bytes(out)


class _Out:
    """buf_append(): bounded output; ValueError(-1) like the C return code."""
    def __init__(self, limit: int, fn: str):
        self.parts, self.n, self.limit, self.fn = [], 0, limit, fn

    def add(self, b: bytes):
        if self.n + len(b) >= self.limit:
            raise ValueError(f"C {self.fn} returned -1")
        self.parts.append(b)
        self.n += len(b)

    def text(self) -> str:
        return b"".join(self.parts).decode("utf-8")


_PARSE_BUF = 1 << 20


def _list_items(content: bytes, block: bytes, item: bytes, attrs, fields):
    """The <Signals>/<Points> loops of parse_station_xml() → JSON array bytes."""
    ft = _find_tag(content, block)
    if ft is None:
        return b"[]"
    start, block_end = ft
    buf = bytearray(b"[")
    first = True
    sc = start
    while True:
        tg = content.find(item, sc)
        if tg < 0 or tg >= block_end - len(item):
            break
        tg_end = content.find(b">", tg)
        if tg_end < 0:
            break
        tbuf = content[tg:tg_end + 1]
        vals = [_json_escape(_get_attr(tbuf, a, 32), 64) for a in attrs]
        if not first and len(buf) < 4094:
            buf += b","
        first = False
        buf += b"{" + b",".join(b'"' + f + b'":"' + v + b'"' for f, v in zip(fields, vals)) + b"}"
        sc = tg_end + 1
    if len(buf) < 4094:
        buf += b"]"
    return bytes(buf[:4095])


def parse_station_xml(xml: str) -> str:
    """SECTION 2 – Station Configuration XML → JSON text (same text as the C parser)."""
    x = xml.encode("utf-8").split(b"\0", 1)[0]
    out = _Out(_PARSE_BUF, "parse_station_xml")
    out.add(b'{"type":"station_config","stations":[')
    cursor, count = 0, 0
    while True:
        stag = x.find(b"<Station", cursor)
        if stag < 0:
            break
        stag_end = x.find(b">", stag)
        if stag_end < 0:
            break
        etag = x.find(b"</Station>", stag_end)
        if etag < 0:
            break
        content = x[stag_end + 1:etag] if etag - stag_end - 1 > 0 else b""
        tag_attr = x[stag:stag_end + 1]
        sid = _get_attr(tag_attr, b"id", 64)
        name = _get_attr(tag_attr, b"name", 128)
        typ = _get_attr(tag_attr, b"type", 32)
        km = _get_tag_text(content, b"KmPost", 32)
        section = _get_tag_text(content, b"Section", 64)
        lat = lon = b""
        loc = content.find(b"<Location")
        if loc >= 0:
            loc_end = content.find(b">", loc)
            if loc_end >= 0:
                ltag = content[loc:loc_end + 1]
                lat = _get_attr(ltag, b"lat", 32)
                lon = _get_attr(ltag, b"lon", 32)
        signals = _list_items(content, b"Signals", b"<Signal",
                              (b"id", b"type", b"aspect"), (b"id", b"type", b"aspect"))
        points = _list_items(content, b"Points", b"<Point",
                             (b"id", b"normal", b"status"), (b"id", b"normal", b"status"))
        if count > 0:
            out.add(b",")
        out.add(b'{"id":"' + _json_escape(sid, 128) + b'","name":"' + _json_escape(name, 256)
                + b'","type":"' + _json_escape(typ, 64) + b'","km_post":"' + _json_escape(km, 64)
                + b'","section":"' + _json_escape(section, 128) + b'","lat":"' + (lat or b"0")
                + b'","lon":"' + (lon or b"0") + b'","signals":' + signals + b',"points":' + points + b"}")
        count += 1
        cursor = etag + len(b"</Station>")
    out.add(b'],"station_count":%d}' % count)
    return out.text()


def _attr_of(src: bytes, tag: bytes, start: int, before: int, attrs):
    """First <tag ...> at/after start and before `before` → its attribute values."""
    t = src.find(tag, start)
    vals = [b""] * len(attrs)
    if t >= 0 and t < before:
        t_end = src.find(b">", t)
        if t_end >= 0:
            tb = src[t:t_end + 1]
            vals = [_get_attr(tb, a, size) for a, size in attrs]
    return vals


def parse_storyboard_xml(xml: str) -> str:
    """SECTION 3 – OpenSCENARIO-style StoryBoard XML → JSON text (same text as the C parser)."""
    x = xml.encode("utf-8").split(b"\0", 1)[0]
    out = _Out(_PARSE_BUF, "parse_storyboard_xml")
    board_name = board_version = b""
    sb = x.find(b"<StoryBoard")
    if sb >= 0:
        sb_end = x.find(b">", sb)
        if sb_end >= 0:
            tb = x[sb:sb_end + 1]
            board_name = _get_attr(tb, b"name", 128)
            board_version = _get_attr(tb, b"version", 32)
    meta_author = meta_date = meta_desc = b""
    ft = _find_tag(x, b"Meta")
    if ft is not None:
        mstart, mend = ft
        mlen = mend - len(b"</Meta>") - mstart
        if 0 < mlen < 1024:
            mc = x[mstart:mstart + mlen]
            meta_author = _get_tag_text(mc, b"Author", 128)
            meta_date = _get_tag_text(mc, b"Date", 32)
            meta_desc = _get_tag_text(mc, b"Description", 256)
    out.add(b'{"type":"storyboard","name":"' + _json_escape(board_name, 256) + b'","version":"'
            + _json_escape(board_version, 64) + b'","meta":{"author":"' + _json_escape(meta_author, 128)
            + b'","date":"' + meta_date + b'","description":"' + _json_escape(meta_desc, 512)
            + b'"},"stories":[')
    cursor, story_count = 0, 0
    while True:
        stag = x.find(b"<Story", cursor)
        if stag < 0:
            break
        stag_gt = x.find(b">", stag)
        if stag_gt < 0:
            break
        etag = x.find(b"</Story>", stag_gt)
        if etag < 0:
            break
        story_name = _get_attr(x[stag:stag_gt + 1], b"name", 128)
        sc = x[stag_gt + 1:etag] if etag - stag_gt - 1 > 0 else b""
        acts = bytearray(b"[")
        acur, act_count = 0, 0
        while True:
            atag = sc.find(b"<Act", acur)
            if atag < 0:
                break
            atag_gt = sc.find(b">", atag)
            if atag_gt < 0:
                break
            aetag = sc.find(b"</Act>", atag_gt)
            if aetag < 0:
                break
            act_name = _get_attr(sc[atag:atag_gt + 1], b"name", 128)
            ac = sc[atag_gt + 1:aetag] if aetag - atag_gt - 1 > 0 else b""
            events = bytearray(b"[")
            ecur, event_count = 0, 0
            while True:
                evtag = ac.find(b"<Event", ecur)
                if evtag < 0:
                    break
                evtag_gt = ac.find(b">", evtag)
                if evtag_gt < 0:
                    break
                evetag = ac.find(b"</Event>", evtag_gt)
                if evetag < 0:
                    break
                evb = ac[evtag:evtag_gt + 1]
                ev_name = _get_attr(evb, b"name", 128)
                ev_prio = _get_attr(evb, b"priority", 64)
                sv, su, ss = _attr_of(ac, b"<SpeedActionDynamics", evtag_gt, evetag,
                                      ((b"value", 32), (b"dynamicsUnit", 32), (b"dynamicsShape", 32)))
                (cn,) = _attr_of(ac, b"<Condition", evtag_gt, evetag, ((b"name", 128),))
                cv, cr = _attr_of(ac, b"<SimulationTimeCondition", evtag_gt, evetag,
                                  ((b"value", 64), (b"rule", 64)))
                if event_count > 0 and len(events) < 8190:
                    events += b","
                events += (b'{"name":"' + _json_escape(ev_name, 256) + b'","priority":"'
                           + _json_escape(ev_prio, 128) + b'","speed_action":{"value":"'
                           + _json_escape(sv, 64) + b'","unit":"' + _json_escape(su, 64)
                           + b'","shape":"' + _json_escape(ss, 64) + b'"},"trigger_condition":{"name":"'
                           + _json_escape(cn, 256) + b'","value":"' + _json_escape(cv, 64)
                           + b'","rule":"' + _json_escape(cr, 64) + b'"}}')
                event_count += 1
                ecur = evetag + len(b"</Event>")
            if len(events) < 8190:
                events += b"]"
            if act_count > 0 and len(acts) < 16382:
                acts += b","
            acts += (b'{"name":"' + _json_escape(act_name, 256) + b'","event_count":%d,"events":' % event_count
                     + bytes(events) + b"}")
            act_count += 1
            acur = aetag + len(b"</Act>")
        if len(acts) < 16382:
            acts += b"]"
        if story_count > 0:
            out.add(b",")
        out.add(b'{"name":"' + _json_escape(story_name, 256) + b'","act_count":%d,"acts":' % act_count
                + bytes(acts) + b"}")
        story_count += 1
        cursor = etag + len(b"</Story>")
    out.add(b'],"story_count":%d}' % story_count)
    return out.text()


# ════════════════════════════════════════════════════════════════════════════
# SECTION 4 – bit writer, PKT_CRC, OTA prefix
# ════════════════════════════════════════════════════════════════════════════

class _BW:
    """MSB-first bit writer (C BitWriter, 1024-byte buffer; grows instead of overflowing)."""
    __slots__ = ("buf", "bit_pos")

    def __init__(self):
        self.buf = bytearray(1024)
        self.bit_pos = 0

    def write(self, value: int, nbits: int):
        value &= _U64
        buf = self.buf
        for i in range(nbits - 1, -1, -1):
            bp = self.bit_pos
            if bp >> 3 >= len(buf):
                buf.extend(bytes(1024))
            if (value >> i) & 1:
                buf[bp >> 3] |= 1 << (7 - (bp & 7))
            self.bit_pos = bp + 1

    def write_signed(self, value: int, nbits: int):
        self.write(value & ((1 << nbits) - 1 if nbits < 64 else _U64), nbits)

    def byte_len(self) -> int:
        return (self.bit_pos + 7) // 8

    def backfill(self, bit_pos: int, val: int, nbits: int):
        for i in range(nbits):
            bp = bit_pos + i
            if (val >> (nbits - 1 - i)) & 1:
                self.buf[bp >> 3] |= 1 << (7 - (bp & 7))
            else:
                self.buf[bp >> 3] &= ~(1 << (7 - (bp & 7))) & 0xFF

    def backfill_7bit(self, bit_pos: int, val: int):
        self.backfill(bit_pos, val & 0xFF & 0x7F, 7)

    def bytes(self) -> bytes:
        return bytes(self.buf[:self.byte_len()])


def _crc_table():
    t = []
    for i in range(256):
        c = i
        for _ in range(8):
            c = (0xEDB88320 ^ (c >> 1)) if c & 1 else (c >> 1)
        t.append(c)
    return t


_CRC_TABLE = _crc_table()


def crc32_calc(data) -> int:
    crc = 0
    for b in data:
        crc = (crc >> 8) ^ _CRC_TABLE[(crc ^ b) & 0xFF]
    return crc


def _resolve_pkt_crc(bw: _BW, csv_crc: int) -> int:
    if csv_crc & _U32 == 0:
        return crc32_calc(bw.buf[:bw.bit_pos // 8])
    return csv_crc & _U32


def ota_prefix_bytes(radio_id: int) -> bytes:
    """§C.3.2.12 Start-of-Frame prefix: Radio1 F1 A5 C3, Radio2 F2 A5 C3."""
    if radio_id == 1:
        return b"\xF1\xA5\xC3"
    if radio_id == 2:
        return b"\xF2\xA5\xC3"
    raise ValueError("radio_id must be 1 or 2")


def ota_prefix_hex(radio_id: int) -> str:
    return ota_prefix_bytes(radio_id).hex().upper()


# ════════════════════════════════════════════════════════════════════════════
# SECTION 5 – CSV row parser (five storyboard layouts → canonical v[0..55])
# ════════════════════════════════════════════════════════════════════════════

_MAX_COLS = 56


class _Row:
    __slots__ = ("v", "n", "route", "l2s_ext", "live_frame_num")

    def __init__(self, v, n, route, l2s_ext):
        self.v, self.n, self.route, self.l2s_ext, self.live_frame_num = v, n, route, l2s_ext, 0


def _remap(raw, pairs):
    v = [0] * _MAX_COLS
    for dst, src in pairs:
        v[dst] = raw[src]
    return v


_REMAP_28 = ((0, 0), (1, 1), (2, 2), (3, 3), (5, 5), (6, 4), (7, 21), (8, 15), (9, 6), (10, 12),
             (14, 13), (15, 14), (21, 11), (33, 26), (34, 27), (35, 6), (36, 10), (37, 18),
             (41, 7), (42, 8), (43, 9), (44, 16), (45, 17), (46, 19), (47, 20), (48, 22),
             (49, 23), (50, 24), (51, 25))
_REMAP_15 = ((0, 0), (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 7), (33, 13), (34, 14),
             (35, 6), (36, 8), (37, 9), (38, 10), (39, 11), (40, 12))
_REMAP_10 = ((0, 0), (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (14, 7), (34, 9), (35, 6))
_REMAP_19 = ((0, 0), (1, 1), (2, 2), (3, 3), (4, 12), (5, 5), (6, 4), (8, 13), (10, 9), (14, 10),
             (15, 11), (21, 8), (34, 18), (35, 6), (36, 7), (37, 14), (38, 15), (39, 16), (40, 17))


def _parse_csv_row(line: bytes):
    """parse_csv_row(): None for comment / blank / malformed lines."""
    n = len(line)
    i = 0
    while i < n and line[i] in (0x20, 0x09):
        i += 1
    if i >= n or line[i] in (0x23, 0x0D, 0x0A):        # '#', CR, LF
        return None
    raw = [0] * _MAX_COLS
    col = 0
    p = i
    while p < n and line[p] not in (0x0D, 0x0A) and col < _MAX_COLS:
        val, e = _strtoll(line, p)
        raw[col] = val
        col += 1
        if e < n and line[e] == 0x2C:
            p = e + 1
        else:
            break
    if col < 10:
        return None
    route = [0, 0, 0, 0]
    l2s = 0
    if col >= 35:
        v = raw[:col] + [0] * (_MAX_COLS - col)
        v[33] = raw[col - 2]
        v[34] = raw[col - 1]
        nr = max(0, min(4, (col - 2) - 31))
        route = [raw[31 + k] if k < nr else 0 for k in range(4)]
    elif 28 <= col < 35:
        v = _remap(raw, _REMAP_28)
        l2s = 1
    elif col == 19:
        v = _remap(raw, _REMAP_19)
    elif col == 15:
        v = _remap(raw, _REMAP_15)
    elif col == 10:
        v = _remap(raw, _REMAP_10)
    else:
        return None
    return _Row(v, col, route, l2s)


# ════════════════════════════════════════════════════════════════════════════
# SECTION 5B – Track Profile (APD) table + route sub-packets + amalgamation
# ════════════════════════════════════════════════════════════════════════════

_TP_MAX_ROWS = 2048
_TP_HEX_LEN = 600
_TP_SUBPKT_MAX = 130
_TP_SUBPKT_MAX_BYTES = 128
_track_profile = []          # [(sno, [psr, gradient, lc, turnout, tli, tcd] as bytes)]
_tp_lock = threading.Lock()


def _tp_copy_field(b: bytes, p: int):
    n = len(b)
    start = p
    while p < n and b[p] not in (0x7C, 0x0A, 0x0D) and p - start < _TP_HEX_LEN - 1:
        p += 1
    field = b[start:p]
    while p < n and b[p] not in (0x7C, 0x0A, 0x0D):
        p += 1
    return field, p


def svk_load_track_profile(text: str) -> int:
    """'<S.No>|<PSR>|<Gradient>|<LC>|<Turnout>|<TLI>|<TCD>' per line → rows loaded."""
    b = text.encode("utf-8").split(b"\0", 1)[0]
    n = len(b)
    rows = []
    p = 0
    while p < n and len(rows) < _TP_MAX_ROWS:
        if b[p] in (0x0A, 0x0D):
            p += 1
            continue
        sno, e = _strtoll(b, p)
        if e == p:
            while p < n and b[p] != 0x0A:
                p += 1
            if p < n:
                p += 1
            continue
        p = e
        if p < n and b[p] == 0x7C:
            p += 1
        fields = []
        for k in range(6):
            f, p = _tp_copy_field(b, p)
            fields.append(f)
            if k < 5 and p < n and b[p] == 0x7C:
                p += 1
        rows.append((_i32(sno), fields))
        while p < n and b[p] != 0x0A:
            p += 1
        if p < n:
            p += 1
    with _tp_lock:
        _track_profile[:] = rows
    return len(rows)


def svk_track_profile_count() -> int:
    return len(_track_profile)


def _tp_find(sno: int):
    for s, fields in _track_profile:
        if s == sno:
            return fields
    return None


def _tp_hex_to_bytes(s: bytes, max_out: int) -> bytes:
    out = bytearray()
    hi = -1
    for c in s:
        if len(out) >= max_out:
            break
        if 0x30 <= c <= 0x39:
            v = c - 0x30
        elif 0x61 <= c <= 0x66:
            v = c - 0x61 + 10
        elif 0x41 <= c <= 0x46:
            v = c - 0x41 + 10
        else:
            continue
        if hi < 0:
            hi = v
        else:
            out.append((hi << 4) | v)
            hi = -1
    return bytes(out)


def _tp_real_len(b: bytes) -> int:
    n = len(b)
    if n < 2 or (b[0] >> 4) == 0xF:
        return 0
    real = (((b[0] & 0x0F) << 3) | (b[1] >> 5)) + 1
    return min(real, n)


class _TpReader:
    __slots__ = ("b", "nbits", "pos")

    def __init__(self, b: bytes, nbits: int, pos: int):
        self.b, self.nbits, self.pos = b, nbits, pos

    def read(self, n: int) -> int:
        v = 0
        for _ in range(n):
            p = self.pos
            self.pos = p + 1
            bit = (self.b[p >> 3] >> (7 - (p & 7))) & 1 if p < self.nbits else 0
            v = ((v << 1) | bit) & _U32
        return v


def _tp_count_width(sp_type: int) -> int:
    return {1: 5, 2: 5, 3: 5, 4: 2, 6: 4}.get(sp_type, 0)


def _tp_read_entry(sp_type: int, rd: _TpReader):
    """→ (fields, widths, dist_idx) — C.4.2 entry layouts."""
    f, w = [], []

    def F(width):
        w.append(width)
        f.append(rd.read(width))

    dist_idx = -1
    if sp_type == 0x1:                 # Static Speed Profile
        F(15); F(1)
        F(18) if f[1] else F(6)
    elif sp_type == 0x2:               # Gradient
        F(15); F(1); F(5)
    elif sp_type == 0x3:               # LC Gate
        F(15); dist_idx = 0
        F(10); F(3); F(1); F(3); F(3)
    elif sp_type == 0x4:               # Turnout
        F(5)
        if f[0] != 0x1F:
            F(15); dist_idx = 1
            F(12)
    elif sp_type == 0x6:               # Track Condition
        F(4); F(15); dist_idx = 1
        F(15)
    return f, w, dist_idx


def _tp_profile_span(sub: bytes, length: int) -> int:
    if length <= 0:
        return 0
    sp_type = sub[0] >> 4
    rd = _TpReader(sub, length * 8, 11)
    cnt = rd.read(_tp_count_width(sp_type))
    span = 0
    i = 0
    while i < cnt and rd.pos < rd.nbits:
        f, _w, _d = _tp_read_entry(sp_type, rd)
        span = (span + (f[0] if f else 0)) & _U32
        i += 1
    return span


def _tp_finish_subpkt(bw: _BW, max_out: int) -> bytes:
    nbytes = bw.byte_len()
    if nbytes > _TP_SUBPKT_MAX_BYTES or nbytes > max_out:
        return b""
    bw.backfill_7bit(4, nbytes - 1)
    return bytes(bw.buf[:nbytes])


def _tp_merge_list(sp_type, srcs, lens, offs, max_out) -> bytes:
    cw = _tp_count_width(sp_type)
    max_count = (1 << cw) - 1
    max_bits = _TP_SUBPKT_MAX_BYTES * 8
    bw = _BW()
    bw.write(sp_type, 4)
    bw.write(0, 7)
    cnt_pos = bw.bit_pos
    bw.write(0, cw)
    total = dropped = 0
    for s in range(len(srcs)):
        rd = _TpReader(srcs[s], lens[s] * 8, 11)
        cnt = rd.read(cw)
        for _ in range(cnt):
            f, w, di = _tp_read_entry(sp_type, rd)
            if rd.pos > rd.nbits:
                break
            if di >= 0:
                d = (f[di] + offs[s]) & _U32
                if d > 32767:
                    print(f"[PROFILE_MERGE] SUB_PKT_TYPE {sp_type}: distance {d} m clamped to 32767",
                          file=sys.stderr)
                    d = 32767
                f[di] = d
            if total >= max_count or bw.bit_pos + sum(w) > max_bits - 7:
                dropped += 1
                continue
            for k in range(len(f)):
                bw.write(f[k], w[k])
            total += 1
    if dropped:
        print(f"[PROFILE_MERGE] SUB_PKT_TYPE {sp_type}: {dropped} entr{'y' if dropped == 1 else 'ies'} "
              f"dropped (count/length limit reached)", file=sys.stderr)
    bw.backfill(cnt_pos, total, cw)
    return _tp_finish_subpkt(bw, max_out)


def _tp_merge_tli(srcs, lens, max_out) -> bytes:
    TLI_MAX_TAGS, TLI_MAX_TINS = 62, 6
    dist, tag, dirs = [], [], []
    dropped = 0
    dist_dup = 0
    alr = alr_start = alr_dir = alr_loc = 0
    first_adj = 0
    tins = []
    for s in range(len(srcs)):
        rd = _TpReader(srcs[s], lens[s] * 8, 11)
        dd = rd.read(4)
        cnt = rd.read(6)
        if s == 0:
            dist_dup = dd
        if cnt > TLI_MAX_TAGS:
            cnt = 0
        for i in range(cnt):
            d = rd.read(11)
            t = rd.read(10)
            r = rd.read(1)
            if i == 0 and dist and tag[-1] == t:
                dist[-1] = min((dist[-1] + d) & _U32, 2047)
                continue
            if len(dist) >= TLI_MAX_TAGS:
                dropped += 1
                continue
            dist.append(d); tag.append(t); dirs.append(r)
        a = rd.read(1)
        a_start = a_dir = a_loc = 0
        if a:
            a_start = rd.read(15)
            a_dir = rd.read(2)
            a_loc = rd.read(23)
        if a and not alr:
            alr, alr_start, alr_dir, alr_loc = 1, a_start, a_dir, a_loc
        adj = rd.read(3)
        if s == 0:
            first_adj = adj
        if adj <= 5:
            for _ in range(adj + 1):
                tin = rd.read(9)
                if tin in tins:
                    continue
                if len(tins) < TLI_MAX_TINS:
                    tins.append(tin)
                else:
                    print(f"[PROFILE_MERGE] TLI: TIN {tin} dropped (max {TLI_MAX_TINS})", file=sys.stderr)
    if dropped:
        print(f"[PROFILE_MERGE] TLI: {dropped} tag(s) dropped (ROUTE_RFID_CNT limit {TLI_MAX_TAGS} reached)",
              file=sys.stderr)
    bw = _BW()
    bw.write(0x5, 4)
    bw.write(0, 7)
    bw.write(dist_dup, 4)
    bw.write(len(dist), 6)
    for i in range(len(dist)):
        bw.write(dist[i], 11)
        bw.write(tag[i], 10)
        bw.write(dirs[i], 1)
    bw.write(alr, 1)
    if alr:
        bw.write(alr_start, 15)
        bw.write(alr_dir, 2)
        bw.write(alr_loc, 23)
    if first_adj > 5 or not tins:
        bw.write(first_adj, 3)
    else:
        bw.write(len(tins) - 1, 3)
        for t in tins:
            bw.write(t, 9)
    out = _tp_finish_subpkt(bw, max_out)
    if not out:
        print(f"[PROFILE_MERGE] TLI: amalgamated sub-packet exceeds {_TP_SUBPKT_MAX_BYTES} bytes "
              f"— ROUTE1's TLI sent instead", file=sys.stderr)
    return out


def _tp_route_subpackets(row: _Row, max_out: int) -> bytes:
    """track_profile_append_route_subpackets(): one sub-packet per type, routes amalgamated."""
    raw, raw_len, span = [], [], []
    with _tp_lock:
        for ridx in range(4):
            sno = row.route[ridx]
            if sno == 0:
                continue
            fields = _tp_find(_i32(sno))
            if fields is None:
                continue
            rb, rl = [], []
            for f in range(6):
                b = _tp_hex_to_bytes(fields[f], _TP_SUBPKT_MAX)
                rb.append(b)
                rl.append(_tp_real_len(b))
            raw.append(rb)
            raw_len.append(rl)
            span.append(_tp_profile_span(rb[0], rl[0]) if rl[0] > 0 else _tp_profile_span(rb[1], rl[1]))
    out = bytearray()
    for f in range(6):
        srcs, lens, offs = [], [], []
        cum = 0
        for k in range(len(raw)):
            if raw_len[k][f] > 0:
                srcs.append(raw[k][f])
                lens.append(raw_len[k][f])
                offs.append(cum)
            cum = (cum + span[k]) & _U32
        if not srcs:
            continue
        src = srcs[0][:lens[0]]
        sp_type = srcs[0][0] >> 4
        needs_shift = offs[0] != 0 and sp_type in (0x3, 0x4, 0x6)
        if len(srcs) > 1 or needs_shift:
            if sp_type == 0x5:
                merged = _tp_merge_tli(srcs, lens, _TP_SUBPKT_MAX_BYTES)
            elif _tp_count_width(sp_type) > 0:
                merged = _tp_merge_list(sp_type, srcs, lens, offs, _TP_SUBPKT_MAX_BYTES)
            else:
                merged = b""
            if merged:
                src = merged
        if len(out) + len(src) > max_out:
            return bytes(out)
        out += src
    return bytes(out)


# ════════════════════════════════════════════════════════════════════════════
# SECTION 7 – Annexure-C packet encoders (PKT_TYPE 9..13)
# ════════════════════════════════════════════════════════════════════════════

def _live_frame_num() -> int:
    """LIVE_FRAME_NUM(): odd 2-s epoch of the UTC clock, as the C code (time(NULL) % 86400)."""
    return ((int(time.time()) % 86400) // 2) * 2 + 1


def _frame(r: _Row) -> int:
    return r.live_frame_num if r.live_frame_num else _live_frame_num()


def _encode_pkt9(r: _Row, bw: _BW):
    v = r.v
    frameNum = _frame(r)
    sp = _BW()
    sp.write(0x0, 4)
    sp_len_pos = sp.bit_pos
    sp.write(0x0, 7)
    sp.write(v[13], 4)                         # FRAME_OFFSET
    sp.write(v[14], 4)                         # DEST_LOCO_SOS
    sp.write(v[15], 2)                         # TRAIN_SECTION_TYPE
    sp.write(v[16], 17)                        # CUR_SIG_INFO
    sp.write(v[17], 6)                         # CUR_SIG_ASPECT
    sp.write(v[18], 6)                         # NEXT_SIG_ASPECT
    sp.write(v[19], 15)                        # APPR_SIG_DIST
    sp.write(v[20], 2)                         # AUTHORITY_TYPE
    auth = v[21]
    sp.write(auth // 5 if auth > 50 else auth, 6)   # AUTHORIZED_SPEED (C integer division, auth > 0)
    sp.write(v[22], 16)                        # MA_W_R_T_SIG
    short_ma = v[23]
    sp.write(1 if short_ma != 0 else 0, 1)     # REQ_SHORTEN_MA
    if short_ma != 0:
        sp.write(short_ma, 16)                 # NEW_MA
    sp.write(v[25], 1)                         # TRN_LEN_INFO_STS
    if v[25]:
        sp.write(v[26], 1)
        sp.write(v[27], 17)
        sp.write(v[28], 8)
    sp.write(v[29], 1)                         # NEXT_STN_COMM
    if v[29]:
        sp.write(v[30], 16)                    # APPR_STN_ILC_IBS_ID
    sp_bits = sp.bit_pos
    sp_bytes = (sp_bits + 7) // 8
    if sp_bytes * 8 - sp_bits > 0:
        sp.write(0, sp_bytes * 8 - sp_bits)
    sp.backfill_7bit(sp_len_pos, sp_bytes - 1)

    profile = b""
    if any(x != 0 for x in r.route):
        profile = _tp_route_subpackets(r, _TP_SUBPKT_MAX * 6 * 4)

    total_bits = 4 + 10 + 90 + sp_bytes * 8 + len(profile) * 8 + 64
    total_bytes = (total_bits + 7) // 8
    bw.write(0x9, 4)
    bw.write(total_bytes - 1, 10)
    bw.write(frameNum, 17)
    bw.write(v[4], 16)                         # SOURCE_STN_ID
    bw.write(v[5], 3)                          # SOURCE_STN_VER
    bw.write(v[6], 20)                         # DEST_LOCO_ID
    bw.write(v[7], 4)                          # REF_PROF_ID
    bw.write(v[8], 10)                         # LAST_REF_RFID
    bw.write_signed(v[9], 15)                  # DIST_PKT_START (signed)
    bw.write(v[10], 2)                         # PKT_DIR
    bw.write(0, 3)
    for i in range(sp_bytes):
        bw.write(sp.buf[i], 8)
    for b in profile:
        bw.write(b, 8)
    bw.write(v[33] & _U32, 32)                 # CBC_MAC
    bw.write(_resolve_pkt_crc(bw, v[34]), 32)  # PKT_CRC
    return 0


def _encode_pkt10(r: _Row, bw: _BW):
    v = r.v
    x = r.l2s_ext

    def ext(i):
        return v[i] if x else 0

    bw.write(0xA, 4)
    bw.write(28, 7)
    bw.write(_frame(r), 17)
    bw.write(v[6], 20)                         # SOURCE_LOCO_ID
    bw.write(v[5], 3)                          # SOURCE_LOCO_VER
    bw.write(ext(35), 23)                      # ABS_LOCO_LOC
    bw.write(ext(41), 9)                       # L_DOUBTOVER
    bw.write(ext(42), 9)                       # L_DOUBTUNDER
    bw.write(ext(43), 2)                       # TRAIN_INT
    bw.write(ext(36), 11)                      # TRAIN_LENGTH
    bw.write(v[21], 9)                         # TRAIN_SPEED (raw km/h)
    bw.write(v[10], 2)                         # MOVEMENT_DIR
    bw.write(v[14], 3)                         # EMERGENCY_STATUS
    bw.write(v[15], 4)                         # LOCO_MODE
    bw.write(v[8], 10)                         # LAST_RFID_TAG
    bw.write(ext(44), 1)                       # TAG_DUP
    bw.write(ext(45), 3)                       # TAG_LINK_INFO
    bw.write(ext(37), 9)                       # TIN
    bw.write(ext(46), 3)                       # Brake_Applied
    bw.write(ext(47), 2)                       # NEW_MA_REPLY
    bw.write(v[7], 4)                          # LAST_REF_PROFILE
    bw.write(ext(48), 1)                       # SIG_OV
    bw.write(ext(49), 4)                       # Info_Ack
    bw.write(ext(50), 2)                       # Spare
    bw.write(ext(51), 6)                       # Loco_Health_Status
    bw.write(v[33] & _U32, 32)                 # MAC_CODE
    bw.write(_resolve_pkt_crc(bw, v[34]), 32)
    return 0


def _encode_pkt11(r: _Row, bw: _BW):
    v = r.v
    bw.write(0xB, 4)
    bw.write(25, 7)
    bw.write(_frame(r), 17)
    bw.write(v[4], 16)                         # SOURCE_STN_ID
    bw.write(v[5], 3)                          # SOURCE_STN_VER
    bw.write(v[35], 23)                        # STN_ILC_IBS_LOC
    bw.write(v[6], 20)                         # DEST_LOCO_ID
    bw.write(v[36], 12)                        # Allotted_UpLink_Freq
    bw.write(v[37], 12)                        # Allotted_DownLink_Freq
    bw.write(v[38], 7)                         # Allotted_TDMA_Timeslot
    bw.write(v[39], 16)                        # STN_RND_NUM_RS
    bw.write(v[40], 7)                         # STN_TDMA
    bw.write(v[33] & _U32, 32)                 # MAC_CODE
    bw.write(_resolve_pkt_crc(bw, v[34]), 32)
    return 0


def _encode_pkt12(r: _Row, bw: _BW):
    v = r.v
    bw.write(0xC, 4)
    bw.write(12, 7)
    bw.write(_frame(r), 17)
    bw.write(v[4], 16)                         # SOURCE_STN_ID
    bw.write(v[5], 3)                          # SOURCE_STN_VER
    bw.write(v[35], 23)                        # STN_ILC_IBS_LOC
    bw.write(1 if v[14] else 0, 1)             # GEN_SOS_CALL
    bw.write(0, 1)
    bw.write(_resolve_pkt_crc(bw, v[34]), 32)
    return 0


def _encode_pkt13(r: _Row, bw: _BW):
    v = r.v
    bw.write(0xD, 4)
    bw.write(28, 7)
    bw.write(_frame(r), 17)
    bw.write(v[6], 20)                         # SOURCE_LOCO_ID
    bw.write(v[5], 3)                          # SOURCE_LOCO_VER
    bw.write(v[35], 23)                        # ABS_LOCO_LOC
    bw.write(v[36], 11)                        # TRAIN_LENGTH
    bw.write(v[21], 9)                         # TRAIN_SPEED (raw km/h)
    bw.write(v[10], 2)                         # MOVEMENT_DIR
    bw.write(v[14], 3)                         # EMERGENCY_STATUS
    bw.write(v[15], 4)                         # LOCO_MODE
    bw.write(v[4], 16)                         # Approaching_STN_ID
    bw.write(v[8], 10)                         # LAST_RFID_TAG
    bw.write(v[37], 9)                         # TIN
    bw.write_signed(v[38], 21)                 # Longitude (signed)
    bw.write_signed(v[39], 20)                 # Latitude (signed)
    bw.write(v[40], 16)                        # LOCO_RND_NUM_RL
    bw.write(0, 5)
    bw.write(_resolve_pkt_crc(bw, v[34]), 32)
    return 0


_ENCODERS = {9: _encode_pkt9, 10: _encode_pkt10, 11: _encode_pkt11, 12: _encode_pkt12, 13: _encode_pkt13}


def _dispatch(r: _Row, bw: _BW) -> int:
    enc = _ENCODERS.get(_i32(r.v[1]))
    return enc(r, bw) if enc else -2


_PKT_TYPE_NAME = {9: "Station to Onboard Regular Packet", 10: "Onboard to Station Regular Packet",
                  11: "Access Authority Packet v2.0", 12: "Additional Emergency Packet",
                  13: "Onboard Access Request Packet"}


def _csv_lines(csv_text: str):
    """The C line loop: split on \\r / \\n, each line cut at 2047 bytes → (line_num, bytes)."""
    b = csv_text.encode("utf-8").split(b"\0", 1)[0]
    n = len(b)
    ls = 0
    line_num = 0
    while ls < n:
        le = ls
        while le < n and b[le] not in (0x0A, 0x0D):
            le += 1
        line_num += 1
        yield line_num, b[ls:min(le, ls + 2047)]
        ls = le
        if ls < n and b[ls] == 0x0D:
            ls += 1
        if ls < n and b[ls] == 0x0A:
            ls += 1


# ════════════════════════════════════════════════════════════════════════════
# SECTION 9 – encode_storyboard_csv()
# ════════════════════════════════════════════════════════════════════════════

def encode_storyboard_csv(csv_text: str, radio_id: int = 1) -> list:
    """Storyboard CSV → one dict per valid data row (same fields and values as the C encoder)."""
    prefix = ota_prefix_hex(radio_id)
    out = []
    row_idx = 0
    base_fn = -1
    last_csv_frame = 0
    group_idx = -1
    for line_num, line in _csv_lines(csv_text):
        row = _parse_csv_row(line)
        if row is None:
            continue
        row_idx += 1
        pkt_type = _i32(row.v[1])
        tdma_slot = row.v[0]
        frame_num = row.v[3]
        if base_fn < 0:
            base_fn = _live_frame_num()
        if row_idx == 1 or frame_num != last_csv_frame:
            group_idx += 1
            last_csv_frame = frame_num
        row.live_frame_num = (base_fn + group_idx * 2) % 86400
        if row.live_frame_num & 1 == 0:
            row.live_frame_num += 1
        bw = _BW()
        rc = _dispatch(row, bw)
        byte_len = bw.byte_len()
        hex_s = bw.bytes().hex().upper() if rc == 0 else ""
        name = _PKT_TYPE_NAME.get(pkt_type, "Unknown") if 0 <= pkt_type < 16 else "Unknown"
        err = (f"Unsupported pkt_type {pkt_type}" if rc == -2
               else f"Encoding error (pkt_type {pkt_type})" if rc != 0 else "")
        out.append({
            "row": row_idx, "line_num": line_num, "tdma_slot": tdma_slot, "frame_num": frame_num,
            "pkt_type": pkt_type, "pkt_type_name": name, "byte_len": byte_len, "hex": hex_s,
            "radio_id": radio_id, "frame_prefix": prefix,
            "ota_hex": prefix + hex_s if rc == 0 else "",
            "ota_byte_len": byte_len + 3 if rc == 0 else 0, "error": err,
        })
    return out


# ════════════════════════════════════════════════════════════════════════════
# SECTION 10 – transmit_storyboard_csv()  (UDP, paced on 2-s boundaries)
# ════════════════════════════════════════════════════════════════════════════

def _sleep_until_next_2s_boundary(stop_event):
    remain = 2.0 - (time.monotonic() % 2.0)
    if remain <= 0:
        remain = 2.0
    if stop_event is not None:
        stop_event.wait(remain)
    else:
        time.sleep(remain)


def transmit_storyboard_csv(csv_text: str, dest_ip: str, dest_port: int, loop: int,
                            radio_id: int, stop_event=None) -> int:
    """0 ok/stopped · -1 bad args · -2 socket/address failure · -3 encoding errors (C return codes)."""
    if csv_text is None or dest_ip is None:
        return -1
    if dest_port < 1 or dest_port > 65535:
        return -1
    if radio_id not in (1, 2):
        return -1
    prefix = ota_prefix_bytes(radio_id)
    rows = [r for _n, line in _csv_lines(csv_text) for r in [_parse_csv_row(line)] if r is not None]
    if not rows:
        return 0
    stopped = (lambda: stop_event is not None and stop_event.is_set())
    try:
        socket.inet_pton(socket.AF_INET, dest_ip)
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    except OSError:
        return -2
    enc_errors = 0
    try:
        while True:
            i = 0
            while i < len(rows):
                if stopped():
                    return -3 if enc_errors else 0
                group = rows[i].v[3]
                live_fn = _live_frame_num()
                while i < len(rows) and rows[i].v[3] == group:
                    r = rows[i]
                    r.live_frame_num = live_fn
                    bw = _BW()
                    rc = _dispatch(r, bw)
                    if rc == 0 and bw.byte_len() > 0:
                        try:
                            sock.sendto(prefix + bw.bytes(), (dest_ip, dest_port))
                        except OSError as e:
                            print(f"[svk_sim] sendto failed: live_frame={live_fn} tdma={r.v[0]} "
                                  f"pkt_type={_i32(r.v[1])} err={e}", file=sys.stderr)
                    elif rc == -1:
                        enc_errors += 1
                    i += 1
                if i < len(rows):
                    _sleep_until_next_2s_boundary(stop_event)
                    if stopped():
                        return -3 if enc_errors else 0
            if not loop or stopped():
                break
    finally:
        sock.close()
    return -3 if enc_errors else 0
