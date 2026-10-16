"""
KAVACH Radio Packet Decoder — Backend v4.0
RDSO/SPN/196/2020 Annexure-C

Run: uvicorn main:app --reload --port 8000

ALL ENDPOINTS:
  POST http://localhost:8000/api/receive      ← your other tool sends packets HERE
  POST http://localhost:8000/ingest           ← alternative HTTP POST
  WS   ws://localhost:8000/ws/live            ← DECODEX browser subscribes here
  WS   ws://localhost:8000/ws/receive         ← WebSocket alternative for senders
  POST http://localhost:8000/decode           ← manual decode from DECODEX UI
  GET  http://localhost:8000/health           ← health check
  GET  http://localhost:8000/live/history     ← last N decoded packets
  GET  http://localhost:8000/live/stats       ← session statistics
  POST http://localhost:8000/live/clear       ← reset session
  POST http://localhost:8000/validate         ← CRC + field validation
  POST http://localhost:8000/diff             ← compare two packets
  POST http://localhost:8000/stats            ← aggregate stats
  POST http://localhost:8000/upload           ← upload JSON file
"""

import asyncio
import json
import sys
import time
import zlib
import datetime
from collections import deque
from typing import Any, Optional, Set

# ── IST (UTC+5:30) wall-clock helpers ────────────────────────────────────────
# KAVACH FRAME_NUM and all displayed timestamps MUST use IST, because
# RDSO/SPN/196/2020 Annexure-C defines FRAME_NUM as seconds elapsed since
# local midnight.  Running the server without TZ=Asia/Kolkata would produce
# UTC timestamps, causing a fixed 5h30m display error and wrong FRAME_NUM
# values in every encoded packet — a safety-critical defect.
# These helpers make the code timezone-independent regardless of server TZ.

def _ist_now() -> datetime.datetime:
    """Return the current wall-clock time in IST (UTC+5:30)."""
    return datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)

def _ist_time_str() -> str:
    """Return current IST time as HH:MM:SS string."""
    return _ist_now().strftime("%H:%M:%S")

def _ist_seconds_since_midnight() -> int:
    """
    Return the Annexure-C TDMA FRAME_NUM for the current IST wall-clock time.

    Per RDSO/SPN/196/2020 Annexure-C, FRAME_NUM must always be an ODD number.
    Each 2-second TDMA epoch is identified by its start second (1, 3, 5, …).

    Formula: floor(seconds_since_midnight / 2) * 2 + 1
      → always odd, range 1..86399, fits in 17 bits.
    """
    n = _ist_now()
    secs = n.hour * 3600 + n.minute * 60 + n.second
    return (secs // 2) * 2 + 1

# ── Project CRC-32 (custom MISRA-C variant) ──────────────────────────────────
# IMPORTANT: this is NOT the same algorithm as Python's built-in zlib.crc32().
#
#   zlib.crc32()      → init 0xFFFFFFFF, final XOR 0xFFFFFFFF  (standard CRC-32)
#   this project's CRC → init 0x00000000, NO final XOR         (custom variant)
#
# Both use the same reflected polynomial (0xEDB88320) and table, so they look
# deceptively similar, but they produce completely different 32-bit values for
# identical input bytes. Every packet on the wire is encoded with THIS custom
# variant — see svk_sim.c's crc32_calc()/resolve_pkt_crc(), python3.py's
# calculate_crc32_ieee(), and SvkSim.jsx's crc32Ieee(). Any backend code that
# needs to verify or recompute a PKT_CRC must use this function, not
# zlib.crc32(), or the comparison will always disagree with the real packet.

def _build_project_crc32_table() -> list:
    table = []
    for i in range(256):
        c = i
        for _ in range(8):
            c = (0xEDB88320 ^ (c >> 1)) if (c & 1) else (c >> 1)
        table.append(c & 0xFFFFFFFF)
    return table

_PROJECT_CRC32_TABLE = _build_project_crc32_table()

def project_crc32(data: bytes) -> int:
    """The project's custom CRC-32 — byte-for-byte identical to
    svk_sim.c's crc32_calc() / python3.py's calculate_crc32_ieee() /
    SvkSim.jsx's crc32Ieee(). Use this (never zlib.crc32()) whenever
    verifying or recomputing a PKT_CRC field."""
    crc = 0x00000000
    for b in data:
        crc = (crc >> 8) ^ _PROJECT_CRC32_TABLE[(crc ^ b) & 0xFF]
    return crc & 0xFFFFFFFF


from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── pyserial — imported lazily inside functions to avoid import-time warnings
# when the package is not installed.  SERIAL_AVAILABLE is set once at startup
# by probing the import; all serial endpoints check it before use.
def _try_import_serial():
    """Return (serial_module, list_ports_module) or (None, None)."""
    try:
        import serial                        # noqa: PLC0415
        import serial.tools.list_ports      # noqa: PLC0415
        return serial, serial.tools.list_ports
    except ImportError:
        return None, None

_serial_mod, _serial_list_ports_mod = _try_import_serial()
SERIAL_AVAILABLE: bool = _serial_mod is not None

# ── WSL detection ──────────────────────────────────────────────────────────
# The single most common cause of "Device Manager sees the USB adapter but
# the app doesn't": this backend is running inside WSL, and WSL does not
# automatically share host USB devices with the Linux kernel it runs. From
# inside WSL, pyserial only ever sees the legacy /dev/ttyS0.../dev/ttyS31
# virtual ports (always present, always hwid "n/a", never a real adapter)
# unless the device has been explicitly bridged in with usbipd-win. Surfacing
# this lets the frontend explain *why* instead of the user having to guess
# from the raw port list.
import platform as _platform

def _detect_wsl() -> bool:
    if _platform.system() != "Linux":
        return False
    try:
        with open("/proc/version") as f:
            return "microsoft" in f.read().lower()
    except OSError:
        return False

IS_WSL: bool = _detect_wsl()

from decoder import decode_all_packets

# ── SVK SIM bridge (C shared library via ctypes) ───────────────────────────
try:
    from svk_sim_bridge import parse_station, parse_storyboard
    SVK_AVAILABLE = True
except Exception as _svk_err:
    SVK_AVAILABLE = False
    _svk_err_msg = str(_svk_err)

app = FastAPI(title="KAVACH Decoder", version="4.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Session state ────────────────────────────────────────────────────────────
live_history: deque = deque(maxlen=3000)   # = the largest LIVE table size (⚙ Settings → LIVE)
live_subscribers: Set[WebSocket] = set()
packet_counter = 0
session_start = time.time()


# ── Helpers ──────────────────────────────────────────────────────────────────
async def broadcast(data: dict):
    msg = json.dumps(data)
    dead = set()
    for ws in list(live_subscribers):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    live_subscribers.difference_update(dead)


def crc32_check(hex_payload: str) -> dict:
    try:
        raw = bytes.fromhex(hex_payload.replace(
            "0x", "").replace(" ", "").strip())
        if len(raw) < 5:
            return {"match": None, "error": "Too short"}
        stored = int.from_bytes(raw[-4:], "big")
        computed = zlib.crc32(raw[:-4]) & 0xFFFFFFFF
        return {
            "computed": computed, "computed_hex": f"0x{computed:08X}",
            "stored": stored,   "stored_hex":   f"0x{stored:08X}",
            "match": computed == stored,
        }
    except Exception as e:
        return {"match": None, "error": str(e)}


FIELD_RANGES = {
    "FRAME_NUM": (1, 86400), "SOURCE_LOCO_ID": (1, 999999),
    "TRAIN_SPEED": (0, 511), "TRAIN_LENGTH": (0, 2047),
    "TIN": (0, 511), "SOURCE_STN_ILC_IBS_ID": (1, 65535),
    "Allotted_TDMA_Timeslot": (0, 127),
}


def validate_fields(fields: list) -> list:
    out = []
    for f in fields:
        name = (f.get("Field") or "").strip()
        val = f.get("Decimal Value")
        if name in FIELD_RANGES and isinstance(val, (int, float)):
            lo, hi = FIELD_RANGES[name]
            if not (lo <= val <= hi):
                out.append({"field": name, "value": val,
                            "expected": f"{lo}–{hi}", "severity": "warning"})
    return out


def enrich(r: dict) -> dict:
    if not r.get("error"):
        r["crc_check"] = crc32_check(r.get("payload_hex", ""))
        r["validation_warnings"] = validate_fields(r.get("fields", []))
    return r


async def pipeline(pkt_list: list, source: str, source_id: str = "") -> list:
    """Decode → enrich → store → broadcast → return results."""
    global packet_counter
    results = decode_all_packets(pkt_list)
    batch = []
    for r in results:
        packet_counter += 1
        r = enrich(r)
        r["packet_index"] = packet_counter
        r["received_at"] = time.time()
        r["received_at_iso"] = _ist_time_str()   # IST — not server local/UTC
        r["source"] = source
        r["source_id"] = source_id
        live_history.append(r)
        batch.append(r)
    for pkt in batch:
        await broadcast({"type": "packet", "data": pkt})
    return batch


# ── Pydantic models ──────────────────────────────────────────────────────────
class DecodeRequest(BaseModel):
    packets: Any


class IngestRequest(BaseModel):
    packets: Any
    source:    str = "external"
    source_id: str = ""


class DiffRequest(BaseModel):
    packet_a: dict
    packet_b: dict


class ReceiveRequest(BaseModel):
    """Flexible — accepts any field name the other tool uses."""
    activeRadio:    str = "0x00"
    messagePayload: str = ""
    packets:  Any = None
    source:   str = "external"
    source_id: str = ""
    hex:     str = ""
    payload: str = ""
    data:    str = ""


# ══════════════════════════════════════════════════════════════════════════════
#  SERIAL RADIO MODEM — models, config, dummy port, state
#  Guardian™ Serial Radio Modem · RDSO/SPN/196/2020 Annexure-C
# ══════════════════════════════════════════════════════════════════════════════

import os as _os
import re as _re

class SerialConfigPayload(BaseModel):
    """
    Serial port configuration — saved to serial_config.json.

    Defaults follow the Guardian™ Serial Radio Modem User Manual
    (PN 001-5006-000 Rev. B), Section 5.6.3 "COM Port":
      - Port Baud Rate range is 110 - 57,600 bps; factory default is 9600 bps
        (the SETUP port is a fixed 57,600 bps and is not used for data TX;
        the COM port is what carries user data to/from the radio).
      - Data format default is 8 data bits, No parity, 1 stop bit.
      - TX Activation Mode default is DOX (Data Operated Transmit — data is
        sent whenever present at the port, no flow control required).
        RTS/CTS mode requires the host to raise RTS and wait for the
        Guardian to return CTS before sending data.
    """
    mode:             str   = "decode_live"   # decode_live | sim_loopback
    tty_device:       str   = "/dev/ttyUSB0"
    baud_rate:        int   = 9600
    read_timeout_s:   float = 0.25
    write_timeout_s:  float = 1.0
    # extended fields used by UI (mapped from sample config keys)
    data_bits:  int   = 8
    stop_bits:  float = 1.0
    parity:     str   = "N"
    # Guardian COM Port panel — TX Activation Mode (§5.6.3)
    tx_mode:    str   = "DOX"   # "DOX" | "RTS_CTS"
    dox_delay:  int   = 6       # DOX Delay — only meaningful when tx_mode == "DOX"
    rts_control_enabled: int = 1  # 1 = RTS/CTS enabled, 0 = RTS/CTS disabled (no transmission)


class SerialResumePayload(BaseModel):
    """Optional body for /svk/serial_resume — a replacement storyboard."""
    csv: Optional[str] = None


class SerialTransmitPayload(BaseModel):
    csv:      str
    loop:     bool = False
    radio_id: int  = 1   # 1 (Radio1) or 2 (Radio2) — sets the §C.3.2.12
                         # OTA Start-of-Frame prefix (0xF1/0xF2 0xA5 0xC3)
                         # prepended to every byte actually written to the
                         # serial port.


# ── Config file ──────────────────────────────────────────────────────────────
_SERIAL_CFG_PATH = _os.path.join(_os.path.dirname(__file__), "serial_config.json")

_DEFAULT_SERIAL_CFG: dict = {
    "mode":            "sim_loopback",   # starts in simulation/loopback mode
    "tty_device":      "/dev/ttyUSB0",
    "baud_rate":       9600,     # Guardian COM Port factory default (§5.6.3)
    "read_timeout_s":  0.25,
    "write_timeout_s": 1.0,
    "data_bits":       8,
    "stop_bits":       1.0,
    "parity":          "N",
    "tx_mode":         "DOX",    # Guardian TX Activation Mode default (§5.6.3)
    "dox_delay":       6,
    "rts_control_enabled": 1,    # 1 = RTS/CTS enabled, 0 = disabled
}

# Guardian COM Port allowed baud rates — Section 5.6.3: "Port Baud Rate...
# 110 - 57,600 bps". 9600 is the modem's factory default. 115200 is technically
# above the documented Guardian COM Port range, but is included here anyway
# since some deployments run the UART overclocked (or through a USB-serial
# bridge/converter in front of the modem) at that rate — it's offered as a
# non-default option rather than silently rejected.
GUARDIAN_COM_PORT_BAUD_RATES = (110, 300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200)
GUARDIAN_COM_PORT_STANDARD_BAUD_RATES = (110, 300, 1200, 2400, 4800, 9600, 19200, 38400, 57600)

def _load_serial_cfg() -> dict:
    try:
        with open(_SERIAL_CFG_PATH) as f:
            on_disk = json.load(f)
        # merge with defaults so new keys are always present
        cfg = dict(_DEFAULT_SERIAL_CFG)
        cfg.update(on_disk)
        return cfg
    except Exception:
        return dict(_DEFAULT_SERIAL_CFG)

def _save_serial_cfg(cfg: dict) -> None:
    try:
        with open(_SERIAL_CFG_PATH, "w") as f:
            json.dump(cfg, f, indent=2)
    except Exception:
        pass

_serial_cfg: dict = _load_serial_cfg()

# Write default config file if it doesn't exist yet
if not _os.path.exists(_SERIAL_CFG_PATH):
    _save_serial_cfg(_serial_cfg)

# ── Runtime TX stop flag ─────────────────────────────────────────────────────
_serial_tx_stop: bool = False

# ── Runtime TX pause flag ────────────────────────────────────────────────────
# Set by POST /svk/serial_pause, cleared by /svk/serial_resume. The TX loop
# finishes the burst it is sending, then HOLDS at the next frame boundary
# (port stays open, PTT un-keyed, RX keeps being received) until resumed —
# and then continues from the NEXT frame, not from the first one.
_serial_tx_paused: bool = False

# ── Storyboard swap while paused ─────────────────────────────────────────────
# /svk/serial_resume may carry a NEW storyboard CSV (the user loaded another
# file while paused). It is encoded there and parked here; the TX loop picks
# it up the moment it resumes and continues with it from its first frame —
# in the SAME session (same port, same .log file, same packet numbering).
# None = no swap pending → resume continues from the frame where it paused.
_serial_tx_new_story: "dict | None" = None
_serial_tx_radio_id: int = 1          # radio unit of the running session (for re-encoding)

# Currently running serial TX asyncio Task.
# Tracked so a new /svk/serial_transmit request can cancel the previous task
# before starting fresh — prevents two tasks running simultaneously on the
# same port when the user loads a new storyboard and clicks Transmit again.
_serial_tx_task: "asyncio.Task | None" = None

# ── Continuous RX listener ────────────────────────────────────────────────────
# Runs for the entire lifetime a port is open — during an active TX session
# AND standalone (via /svk/serial_rx_start) when the user just wants to
# monitor incoming Guardian™ traffic without transmitting anything.
# Only one of these owns the physical port at a time; a running TX session's
# own RX loop takes priority (see /svk/serial_rx_start).
_serial_rx_task: "asyncio.Task | None" = None
_serial_rx_stop: bool = False

# Guardian on-air data rate ≈ 4800/9600/19200 bps (manual §5.6.2, RF Baud
# Rate), independent of the COM port baud rate the host talks to it at —
# but for inter-byte "end of burst" framing purposes we key off the
# configured COM port baud, since that's the rate bytes actually arrive at
# this end of the RS-232 link. This mirrors the classic Modbus-RTU framing
# rule: end a frame once no new byte has arrived within ~3.5 character
# times, which is when a Guardian burst (and any gap before the next one)
# has genuinely ended rather than being read in an arbitrarily-sized chunk.
#
# FLOOR RATIONALE (bumped 8ms → 40ms): at every baud rate Guardian actually
# runs at (4800–57600), 3.5 char-times is always well under 8ms, so the
# floor — not the formula — was the effective threshold in practice. 8ms
# is fine for a direct physical COM port, but this deployment bridges a
# real USB-RS232 adapter into a VM (usbipd-win → WSL), and that bridge
# adds its own scheduling/interrupt latency. A momentary pause mid-burst
# that's longer than 8ms but well short of genuine silence was being
# mistaken for the end of the frame, splitting one on-air burst into two
# (or more) truncated RX events — e.g. a 38-byte burst arriving as a 23B
# event immediately followed by a 15B "leftover" event. Guardian bursts
# are spaced 2s apart (one per TDMA epoch), so a larger floor costs
# nothing in real accuracy while absorbing that jitter.
def _rx_idle_threshold_s(baud_rate: int) -> float:
    baud = max(int(baud_rate or 9600), 110)
    char_time_s = 11.0 / baud   # ~11 bits/char at 8N1 incl. start/stop bits
    return max(0.040, char_time_s * 3.5)   # floor: 40ms, for polling granularity


async def _serial_read_chunk(ser, is_sim: bool) -> bytes:
    """
    Non-blocking-from-the-event-loop-perspective read of whatever bytes are
    currently waiting on the port. Real hardware I/O runs in a worker thread
    (asyncio.to_thread) so it never stalls the event loop — this is what
    lets an RX listener and an in-progress TX write make forward progress
    concurrently instead of RX only ever getting serviced in the gaps
    between TX writes.
    """
    if is_sim:
        return b""   # DummySerialPort never has unsolicited RX data
    try:
        waiting = await asyncio.to_thread(lambda: ser.in_waiting)
        if not waiting:
            return b""
        return await asyncio.to_thread(ser.read, waiting)
    except Exception:
        return b""


async def _serial_write_bytes(ser, data: bytes, is_sim: bool) -> None:
    """Write bytes to the port off the event loop (see _serial_read_chunk)."""
    if is_sim:
        ser.write(data)
        return
    await asyncio.to_thread(ser.write, data)
    await asyncio.to_thread(ser.flush)


# ── PTT (Push-To-Talk) TX keying ─────────────────────────────────────────────
# See the note in _open_serial_port() above: on this Guardian hardware, RTS
# is the real TX-key/PTT line. It must be pulsed HIGH only for the duration
# of each packet write and dropped LOW again right after — never held high
# for the whole session — or the modem's Tx LED stays lit continuously
# instead of blinking per packet. Values mirror guardian_terminal.py's
# proven-working PTT_KEYUP_DELAY / PTT_KEYDOWN_DELAY / RX_SETTLE_DELAY.
PTT_KEYUP_DELAY_S   = 0.15   # let the radio key up before data starts
PTT_KEYDOWN_DELAY_S = 0.15   # let the last byte clear the air before un-keying
PTT_RX_SETTLE_S     = 0.05   # brief RX turnaround after PTT drops


def _set_ptt(ser, active: bool, is_sim: bool, rts_enabled: int = 1) -> None:
    """Drive the RTS line (Guardian TX-key/PTT) HIGH (active=True) or LOW.
    No-op on DummySerialPort / any hardware error (best-effort, like every
    other RTS touch-point in this file).

    Args:
        rts_enabled: 1 = RTS control active, 0 = RTS control disabled (no transmission)
    """
    if not rts_enabled:
        return
    if is_sim:
        return
    try:
        ser.rts = bool(active)
    except Exception:
        pass


# ── §C.3.2.12 OTA Start-of-Frame prefix — RX-side stripping ──────────────────
# The TX side always writes frame_prefix + packet as one unit (see
# svk_serial_transmit's _run()). On loopback (or any real Guardian RX), the
# SAME bytes come back in, so a raw RX frame looks like:
#   F1 A5 C3 <29-38 byte KAVACH packet...>
# Everything downstream — CRC verification (which recomputes over the
# packet's own bytes and compares to its own trailing PKT_CRC field) and the
# decode pipeline (which expects a packet to start at byte 0) — must operate
# on the packet ALONE, never on frame_prefix + packet together. Feeding the
# raw bytes in unstripped is exactly why RX rows previously always failed
# CRC (the recompute silently included 3 bytes that were never part of the
# packet or its CRC) and why decode also misread the packet type.
_RADIO_OTA_PREFIXES = {1: bytes.fromhex("F1A5C3"), 2: bytes.fromhex("F2A5C3")}

def _strip_ota_prefix(frame: bytes):
    """
    If `frame` begins with a known radio's §C.3.2.12 SOF prefix, return
    (radio_id, prefix_bytes, packet_bytes). Otherwise — e.g. a mid-burst
    fragment that doesn't start at a real frame boundary — return
    (None, b"", frame) unchanged, so callers always have a sane fallback.
    """
    for radio_id, prefix in _RADIO_OTA_PREFIXES.items():
        if frame[:3] == prefix:
            return radio_id, prefix, frame[3:]
    return None, b"", frame


def verify_pkt_crc(hex_str: str):
    """
    True / False / None (unknown — too short or not valid hex). Mirrors
    SvkSim.jsx's verifyPacketCrc()/crc32Ieee() exactly: recomputes
    project_crc32() (NOT zlib.crc32() — see the note above project_crc32())
    over every byte except the trailing 4-byte PKT_CRC field and compares.
    """
    try:
        raw = bytes.fromhex((hex_str or "").replace(" ", "").strip())
    except ValueError:
        return None
    if len(raw) < 5:
        return None
    embedded = int.from_bytes(raw[-4:], "big")
    computed = project_crc32(raw[:-4])
    return computed == embedded


# ── Per-test .log files ───────────────────────────────────────────────────────
# Every click of TRANSMIT STORYBOARD (serial or UDP/HTTP) gets its own
# plain-text .log file under _TEST_LOG_DIR, named with today's date and a
# monotonically increasing test sequence number so successive runs never
# collide or overwrite each other.
_TEST_LOG_DIR = "/home/vinoth/Projects/DecodeX/logs"

# pkt_type → short code, for the log file only. Mirrors SvkSim.jsx's
# PKT_TYPE_META abbreviations — keep the two in sync if a new pkt_type is
# added.
_LOG_PKT_ABBR = {9: "S2L", 10: "L2S", 11: "AUTH", 12: "EMRG", 13: "AREQ"}

def _log_pkt_abbr(pkt_type) -> str:
    try:
        return _LOG_PKT_ABBR.get(int(pkt_type), "???")
    except (TypeError, ValueError):
        return "???"


def _next_test_seq() -> int:
    """Highest existing sequence number already used in _TEST_LOG_DIR, + 1
    (1 if the directory is empty, unreadable, or doesn't exist yet)."""
    try:
        _os.makedirs(_TEST_LOG_DIR, exist_ok=True)
        best = 0
        for name in _os.listdir(_TEST_LOG_DIR):
            m = _re.match(r"^svk_test_\d{8}_(\d{4,})\.log$", name)
            if m:
                best = max(best, int(m.group(1)))
        return best + 1
    except Exception:
        return 1


def _open_test_log(kind: str):
    """
    Open a new per-session .log file for a TRANSMIT STORYBOARD run.
    Filename: svk_test_<YYYYMMDD>_<NNNN>.log — date + sequence number, per
    the requested naming ("date, event test count").

    Best-effort: on ANY failure (dir not creatable/writable, disk full,
    etc.) returns (None, None, seq) rather than raising — a broken log
    path must never block an actual transmit.
    """
    seq = _next_test_seq()
    date_str = _ist_now().strftime("%Y%m%d")
    fname = f"svk_test_{date_str}_{seq:04d}.log"
    path = _os.path.join(_TEST_LOG_DIR, fname)
    try:
        _os.makedirs(_TEST_LOG_DIR, exist_ok=True)
        fh = open(path, "w", encoding="utf-8")
        fh.write(f"# DecodeX SVK SIM test log — {kind.upper()} — "
                  f"started {_ist_now().strftime('%Y-%m-%d %H:%M:%S')} IST\n")
        fh.write("# " + _log_header_line() + "\n")
        fh.flush()
        return fh, path, seq
    except Exception:
        return None, None, seq


# ── Fixed-width columns for the per-packet log line ─────────────────────────
# Every field except HEX (which is last and left ragged-right on purpose) is
# padded/aligned to these widths so TX and RX rows — and OK/WARN rows — all
# line up under one another regardless of hex length, error text, etc.
_LOG_COL_N     = 6    # "#123  "
_LOG_COL_TS    = 13   # "11:29:17.999"
_LOG_COL_DIR   = 4    # "TX" / "RX"
_LOG_COL_FRAME = 7    # "P123"
_LOG_COL_SLOT  = 5    # TDMA slot
_LOG_COL_TYPE  = 6    # abbreviation, e.g. "S2L"
_LOG_COL_LEN   = 6    # "35B"
_LOG_COL_CRC   = 11   # "✓ CRC OK" / "✗ CRC FAIL"


def _log_header_line() -> str:
    """Column header for the fixed-width packet-log table (see _log_pkt_line)."""
    return (
        f"{'#':<{_LOG_COL_N}}"
        f"{'TIME':<{_LOG_COL_TS}} "
        f"{'DIR':<{_LOG_COL_DIR}}"
        f"{'FRAME':<{_LOG_COL_FRAME}}"
        f"{'SLOT':<{_LOG_COL_SLOT}}"
        f"{'TYPE':<{_LOG_COL_TYPE}}"
        f"{'LEN':<{_LOG_COL_LEN}}"
        f"{'CRC':<{_LOG_COL_CRC}}"
        f"HEX"
    )


def _log_pkt_line(fh, counter: list, ts: str, csv_frame_num, tdma_slot,
                   pkt_type, hex_str: str, byte_len: int, error: str = "",
                   direction: str = "TX"):
    """
    Append one packet line to an open test-log file as a fixed-width table
    row (columns: see _log_header_line):
        #<n>  <ts>  TX  P<frame>  <slot>  <ABBR>  <len>B  <crc status>  <hex bytes>
        #<n>  <ts>  RX  --        --      --      <len>B  <crc status>  <hex bytes>
    or, for an unsupported/errored packet:
        #<n>  <ts>  TX  P<frame>  <slot>  ???     <len>B               ⚠ <error>

    Every column up to and including CRC is padded to a fixed width so TX
    and RX rows — and OK/WARN rows — all line up under one another
    regardless of hex length or error text. HEX is last and left ragged.

    direction is always written out explicitly as "TX" or "RX" (previously
    TX rows only showed their frame tag "P<n>" with no direction label,
    which made them easy to miss/confuse with RX rows).

    For RX (direction="RX"), csv_frame_num/tdma_slot/pkt_type are unknown —
    an inbound frame doesn't carry the storyboard's own bookkeeping — so
    those columns show "--" rather than printing misleading placeholders.

    `counter` is a 1-element list used as a mutable int (counter[0] += 1)
    so callers share one running "#n" sequence across TX and RX lines
    without needing a nonlocal/global. Best-effort — never raises.
    """
    if fh is None:
        return
    try:
        counter[0] += 1
        n = counter[0]
        is_rx = (direction == "RX")
        dir_tag = "RX" if is_rx else "TX"

        if is_rx:
            frame_tag, slot_tag, type_tag = "--", "--", "--"
        else:
            frame_tag = f"P{csv_frame_num}" if csv_frame_num not in (None, "") else "P?"
            slot_tag  = str(tdma_slot) if tdma_slot not in (None, "") else "?"
            type_tag  = "???" if error else (_log_pkt_abbr(pkt_type) or "--")

        len_tag = f"{byte_len}B"

        prefix = (
            f"#{n:<{_LOG_COL_N - 1}}"
            f"{ts:<{_LOG_COL_TS}} "
            f"{dir_tag:<{_LOG_COL_DIR}}"
            f"{frame_tag:<{_LOG_COL_FRAME}}"
            f"{slot_tag:<{_LOG_COL_SLOT}}"
            f"{type_tag:<{_LOG_COL_TYPE}}"
            f"{len_tag:<{_LOG_COL_LEN}}"
        )

        if error:
            line = f"{prefix}{'':<{_LOG_COL_CRC}}\u26a0 {error}"
        else:
            hex_clean  = (hex_str or "").replace(" ", "")
            hex_spaced = " ".join(hex_clean[i:i+2] for i in range(0, len(hex_clean), 2))
            ok = verify_pkt_crc(hex_clean)
            crc_field = "\u2713 CRC OK" if ok else ("\u2717 CRC FAIL" if ok is False else "")
            line = f"{prefix}{crc_field:<{_LOG_COL_CRC}}{hex_spaced}".rstrip()

        fh.write(line + "\n")
        fh.flush()
    except Exception:
        pass


def _log_note(fh, text: str):
    """Append a free-form '# ...' comment line (session open/close/status
    markers) to an open test-log file. Best-effort — never raises."""
    if fh is None:
        return
    try:
        fh.write(f"# {text}\n")
        fh.flush()
    except Exception:
        pass


async def _rx_drain_loop(ser, is_sim: bool, baud_rate: int, on_frame, should_stop) -> None:
    """
    Continuously accumulate inbound bytes and hand off a complete "frame"
    (one burst of back-to-back bytes with an idle gap on either side) to
    on_frame(hex_str) as soon as the line goes quiet. Runs until
    should_stop() returns True or the task is cancelled.

    NOTE ON FRAMING: the Guardian COM port hands us a plain byte stream —
    it does not insert any delimiter between packets. We can't reliably
    split a burst into individual Annexure-C packets here without
    duplicating the PKT_LENGTH-aware bit parser that already lives in the
    decode pipeline, so this loop's job is only to find frame BOUNDARIES
    (via the idle-time rule below) and hand the whole boundary-clean chunk
    onward — decode_all_packets()/pipeline() is what actually walks the
    bytes and pulls individual packets back out.
    """
    idle_s = _rx_idle_threshold_s(baud_rate)
    buf = bytearray()
    last_byte_at = None

    while not should_stop():
        chunk = await _serial_read_chunk(ser, is_sim)
        now = time.monotonic()
        if chunk:
            buf.extend(chunk)
            last_byte_at = now

        if buf and last_byte_at is not None and (now - last_byte_at) >= idle_s:
            frame, buf = bytes(buf), bytearray()
            last_byte_at = None
            try:
                await on_frame(frame)
            except asyncio.CancelledError:
                raise
            except Exception:
                pass   # a bad frame must never kill the RX loop

        await asyncio.sleep(0.005)   # ~5ms poll — well under the idle floor above

    # Flush any bytes still sitting in the buffer when told to stop, so the
    # tail end of a burst that was mid-flight isn't silently dropped.
    if buf:
        try:
            await on_frame(bytes(buf))
        except Exception:
            pass


# ── WebSocket subscribers for /ws/serial_log ─────────────────────────────────
serial_log_subscribers: Set[WebSocket] = set()

async def _serial_broadcast(event: dict) -> None:
    """Push one serial log event to all /ws/serial_log subscribers."""
    msg  = json.dumps(event)
    dead = set()
    for ws in list(serial_log_subscribers):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    serial_log_subscribers.difference_update(dead)


# ── Serial TX → LIVE feed ─────────────────────────────────────────────────────
# Every station packet transmitted over the serial radio modem is also decoded
# into the LIVE feed (source "serial_tx"), exactly like serial RX frames
# (source "serial_rx") and UDP/HTTP packets (/live/inject, source "SVK_SIM").
# This lets the LIVE page / DMI see the MA, signal and track profile the
# station actually sent. Scheduled as a background task so decoding can never
# delay the 2 s TDMA transmit timing; references are kept until it finishes.
_live_tx_tasks: Set[asyncio.Task] = set()

async def _live_feed_serial_tx(hex_str: str, radio: str, port: str) -> None:
    try:
        await pipeline([{"activeRadio": radio, "messagePayload": hex_str}],
                       source="serial_tx", source_id=port)
    except Exception:
        pass   # a decode problem must never affect the serial TX loop

def _schedule_live_feed_serial_tx(hex_str: str, radio: str, port: str) -> None:
    try:
        task = asyncio.get_event_loop().create_task(_live_feed_serial_tx(hex_str, radio, port))
        _live_tx_tasks.add(task)
        task.add_done_callback(_live_tx_tasks.discard)
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════════════════════
#  DUMMY / SIMULATION SERIAL PORT
#
#  When mode == "sim_loopback" (or pyserial is absent, or the tty_device
#  does not exist), DummySerialPort is used in place of serial.Serial.
#
#  Behaviour:
#    • write(data)  — records bytes in an internal rx_echo buffer (loopback)
#    • read(n)      — returns up to n bytes from the echo buffer
#    • in_waiting   — number of unread echo bytes
#    • flush()      — no-op
#    • close()      — no-op
#
#  This lets the full TX path (encode → patch FRAME_NUM → write → flush →
#  poll rx → broadcast log) run end-to-end without any physical hardware.
# ══════════════════════════════════════════════════════════════════════════════

class DummySerialPort:
    """
    Simulated serial port for Guardian™ Radio Modem loopback testing.

    All bytes written are echoed back as if the modem acknowledged them,
    with a small simulated propagation delay logged as RX events.
    """

    def __init__(self, cfg: dict):
        self.port      = cfg.get("tty_device", "/dev/ttyUSB0")
        self.baudrate  = cfg.get("baud_rate",  9600)
        self.rtscts    = cfg.get("tx_mode", "DOX") == "RTS_CTS"
        self._rx_buf   = bytearray()
        self._sim_mode = True
        # Loopback stand-ins for RTS/CTS state so code paths that check
        # these (see _open_serial_port's RTS_CTS branch) work identically
        # in simulation and on real hardware.
        self.rts = False
        self.cts = True

    # ── serial.Serial-compatible interface ────────────────────────────────────

    def write(self, data: bytes) -> int:
        # Simulation: discard written bytes — do NOT echo them into _rx_buf.
        # Echoing would make in_waiting > 0 after every TX, producing a
        # spurious RX event for every packet in the TX log.
        # Real RX (from a physical Guardian™ modem) uses serial.Serial instead.
        return len(data)

    def flush(self) -> None:
        pass   # nothing to flush in simulation

    def read(self, n: int) -> bytes:
        # Buffer is always empty in sim mode; kept for interface compatibility
        chunk = bytes(self._rx_buf[:n])
        del self._rx_buf[:n]
        return chunk

    @property
    def in_waiting(self) -> int:
        return len(self._rx_buf)   # always 0 — no echo in sim mode

    def close(self) -> None:
        self._rx_buf.clear()

    def __repr__(self) -> str:
        return f"DummySerialPort(port={self.port!r}, baud={self.baudrate}, sim=True)"


def _open_serial_port(cfg: dict):
    """
    Open and return the best available serial port for the given config.

    Priority:
      1. If mode == "sim_loopback"          → DummySerialPort (no hardware needed)
      2. If pyserial is absent              → DummySerialPort (with a log note)
      3. If tty_device does not exist       → DummySerialPort (with a log note)
      4. Otherwise                          → real serial.Serial
         (if the real port fails to open — busy, permission denied, unplugged,
          bad baud, etc. — falls back to DummySerialPort with the real error
          message attached, instead of raising and crashing the endpoint)
    """
    mode = cfg.get("mode", "sim_loopback")
    device = cfg.get("tty_device", "").strip()

    if mode == "sim_loopback":
        return DummySerialPort(cfg), "sim_loopback"

    if not SERIAL_AVAILABLE:
        return DummySerialPort(cfg), "sim_loopback (pyserial not installed)"

    if not device:
        return DummySerialPort(cfg), "sim_loopback (no tty_device configured)"

    # Existence check: only meaningful for POSIX device paths (/dev/ttyUSB0,
    # /dev/ttyACM0, /dev/cu.usbserial-*, etc.). Windows COM ports (COM1,
    # COM3, ...) are not filesystem paths, so os.path.exists() would always
    # return False for them and wrongly force sim mode on Windows even with
    # a real modem plugged in. Skip the filesystem check for COM-style names
    # and let pyserial's own open() call be the real test instead.
    is_windows_com_port = device.upper().startswith("COM")
    if not is_windows_com_port and not _os.path.exists(device):
        return DummySerialPort(cfg), f"sim_loopback (device {device!r} not found)"

    # ── Real hardware path ───────────────────────────────────────────────────
    # serial.Serial(...) can raise (port busy, permission denied, unplugged,
    # unsupported baud/parity combo, etc.). Catch it here so callers
    # (svk_serial_test, svk_serial_transmit) get a usable DummySerialPort
    # fallback with a clear reason instead of an unhandled 500 error.
    # Guardian TX Activation Mode (manual §5.6.3):
    #   DOX     — data is sent whenever present at the port; no flow control.
    #             All RS-422/RS-485 links always use DOX.
    #   RTS/CTS — the host must raise RTS and the Guardian returns CTS
    #             before it will accept data. pyserial's rtscts=True makes
    #             the OS driver perform exactly this handshake per write,
    #             so no manual RTS toggling is needed in the TX loop.
    tx_mode = cfg.get("tx_mode", "DOX").upper()
    use_rtscts = (tx_mode == "RTS_CTS")

    try:
        ser = _serial_mod.Serial(
            port      = device,
            baudrate  = cfg.get("baud_rate",      9600),
            bytesize  = cfg.get("data_bits",      8),
            stopbits  = cfg.get("stop_bits",      1.0),
            parity    = cfg.get("parity",         "N"),
            timeout   = cfg.get("read_timeout_s", 0.25),
            write_timeout = cfg.get("write_timeout_s", 1.0),
            rtscts    = use_rtscts,
            dsrdtr    = False,   # Guardian COM port does not gate TX on DTR/DSR
        )
        if not use_rtscts:
            # PTT / TX-key control — FIX (was: hold RTS permanently HIGH).
            #
            # Confirmed against guardian_terminal.py, the reference tool
            # where TX already keys correctly: on this Guardian hardware,
            # RTS is the actual transmit-key (PTT) line, not a flow-control
            # signal that "DOX ignores". guardian_terminal.py pulses RTS
            # HIGH only for the duration of each packet write and drops it
            # LOW immediately after (see set_ptt() in that file) — that is
            # exactly what makes its Tx LED blink.
            #
            # This code previously set ser.rts = True once, right here at
            # port-open, and never lowered it again for the life of the
            # session. That keys the transmitter continuously for as long
            # as the port stays open — which is why the modem's Tx LED
            # glowed solid instead of blinking, even though the actual
            # bytes were only written at the correct TDMA moments (hence
            # the RS-232/data LED still blinked correctly).
            #
            # Start in the idle/listen state (RTS LOW) here; the TX loop
            # (svk_serial_transmit._run()) now drives RTS high only around
            # each packet write via _set_ptt().
            try:
                ser.rts = False
            except Exception:
                pass
        return ser, "hardware"
    except Exception as exc:
        return DummySerialPort(cfg), f"sim_loopback (failed to open {device!r}: {exc})"


# ════════════════════════════════════════════════════════════════════════════
#  POST /api/receive
#  ─────────────────
#  Your other tool (localhost:3001) posts packets here.
#  Accepts ALL of these formats:
#
#  { "activeRadio":"0xF1", "messagePayload":"D3900C10..." }
#  { "packets": [...], "source": "my-tool" }
#  { "hex": "D3900C10..." }
#  [ {"activeRadio":"0xF1","messagePayload":"..."}, ... ]
# ════════════════════════════════════════════════════════════════════════════
@app.post("/api/receive")
async def api_receive(request: ReceiveRequest):
    try:
        pkt_list = []

        if request.packets is not None:
            pkt_list = request.packets if isinstance(
                request.packets, list) else [request.packets]
        elif request.messagePayload:
            pkt_list = [{"activeRadio": request.activeRadio,
                         "messagePayload": request.messagePayload}]
        elif request.hex:
            pkt_list = [{"activeRadio": request.activeRadio,
                         "messagePayload": request.hex}]
        elif request.payload:
            pkt_list = [{"activeRadio": request.activeRadio,
                         "messagePayload": request.payload}]
        elif request.data:
            pkt_list = [{"activeRadio": request.activeRadio,
                         "messagePayload": request.data}]
        else:
            raise HTTPException(status_code=422,
                                detail="No packet data. Send messagePayload, hex, payload, data, or packets.")

        results = await pipeline(pkt_list, request.source, request.source_id)
        return {
            "success": True,
            "decoded": len(results),
            "subscribers_notified": len(live_subscribers),
            "total_session_packets": packet_counter,
            "packet_types": [r.get("packet_type_name", "Unknown") for r in results],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── POST /api/receive/raw  (raw body fallback) ────────────────────────────
@app.post("/api/receive/raw")
async def api_receive_raw(req: Request):
    try:
        body = await req.body()
        text = body.decode("utf-8").strip()
        try:
            data = json.loads(text)
            pkt_list = data if isinstance(
                data, list) else data.get("packets", [data])
        except json.JSONDecodeError:
            pkt_list = [{"activeRadio": "0x00",
                         "messagePayload": text.replace("0x", "").replace(" ", "")}]
        source = req.headers.get("X-Source", "raw-post")
        results = await pipeline(pkt_list, source)
        return {"success": True, "decoded": len(results),
                "subscribers_notified": len(live_subscribers)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── WS /ws/receive  (WebSocket sender, optional) ─────────────────────────
@app.websocket("/ws/receive")
async def ws_receive(ws: WebSocket):
    await ws.accept()
    client = f"{ws.client.host}:{ws.client.port}" if ws.client else "unknown"
    source_label = "ws-module"
    await ws.send_text(json.dumps({"type": "ready", "message": "Send packets as JSON"}))
    try:
        while True:
            raw = await ws.receive_text()
            pkt_list = []
            source = source_label
            try:
                data = json.loads(raw)
                if isinstance(data, str):
                    pkt_list = [
                        {"activeRadio": "0x00", "messagePayload": data}]
                elif isinstance(data, dict):
                    if "messagePayload" in data:
                        pkt_list = [data]
                    elif "packets" in data:
                        pkt_list = data["packets"] if isinstance(
                            data["packets"], list) else [data["packets"]]
                        source = data.get("source", source_label)
                        source_label = source
                    else:
                        pkt_list = [data]
                elif isinstance(data, list):
                    pkt_list = data
            except json.JSONDecodeError:
                pkt_list = [{"activeRadio": "0x00",
                             "messagePayload": raw.strip().replace("0x", "").replace(" ", "")}]

            if not pkt_list:
                await ws.send_text(json.dumps({"status": "error", "message": "Empty"}))
                continue

            results = await pipeline(pkt_list, source, client)
            await ws.send_text(json.dumps({
                "status": "ok",
                "decoded": len(results),
                "subscribers_notified": len(live_subscribers),
                "packet_types": [r.get("packet_type_name", "?") for r in results],
            }))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


# ── POST /ingest  (HTTP alternative) ─────────────────────────────────────
@app.post("/ingest")
async def ingest(request: IngestRequest):
    try:
        pkt_list = request.packets
        if isinstance(pkt_list, dict):
            pkt_list = [pkt_list]
        results = await pipeline(pkt_list, request.source, request.source_id)
        return {
            "success": True,
            "ingested": len(results),
            "subscribers_notified": len(live_subscribers),
            "total_session_packets": packet_counter,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── WS /ws/live  (DECODEX browser subscribes here) ───────────────────────
@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    live_subscribers.add(ws)
    try:
        await ws.send_text(json.dumps({
            "type": "connected",
            "data": {
                "total_packets": packet_counter,
                "session_uptime_s": int(time.time() - session_start),
                "history_count": len(live_history),
            }
        }))
        # the whole session, in batches — a reconnecting / re-opened LIVE page gets every
        # packet back (not only the last 50), so the list and the DMI are complete again
        hist = list(live_history)
        for i in range(0, len(hist), 200):
            await ws.send_text(json.dumps({"type": "history_batch", "data": hist[i:i + 200]}))
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                await ws.send_text(json.dumps({
                    "type": "heartbeat",
                    "data": {
                        "total_packets": packet_counter,
                        "subscribers": len(live_subscribers),
                        "ts": _ist_time_str(),   # IST — not server local/UTC
                    }
                }))
    except WebSocketDisconnect:
        pass
    finally:
        live_subscribers.discard(ws)


# ── GET /health ───────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "KAVACH Decoder v4.0",
        "spec": "RDSO/SPN/196/2020 Amdt-10",
        "subscribers": len(live_subscribers),
        "total_packets": packet_counter,
        "uptime_s": int(time.time() - session_start),
    }


# ── GET /live/history ─────────────────────────────────────────────────────
@app.get("/live/history")
async def get_history(n: int = 100):
    items = list(live_history)[-n:]
    return {"success": True, "packets": items,
            "count": len(items), "total_session": packet_counter}


# ── GET /live/stats ───────────────────────────────────────────────────────
@app.get("/live/stats")
async def live_stats():
    items = list(live_history)
    by_type, speeds, emergencies, locos = {}, [], [], []
    for r in items:
        tn = r.get("packet_type_name", "Unknown")
        by_type[tn] = by_type.get(tn, 0) + 1
        for f in r.get("fields", []):
            fn = (f.get("Field") or "").strip()
            v = f.get("Decimal Value")
            if fn == "TRAIN_SPEED" and isinstance(v, int) and 0 < v <= 400:
                speeds.append(v)
            if fn == "SOURCE_LOCO_ID" and isinstance(v, int) and v > 0:
                locos.append(v)
            if fn in ("EMERGENCY_STATUS", "GEN_SOS_CALL") and isinstance(v, int) and v > 0:
                emergencies.append({"pkt": r.get("packet_index"), "field": fn,
                                    "val": v, "desc": f.get("Description", "")})
    return {
        "total_packets": packet_counter,
        "history_buffered": len(items),
        "subscribers": len(live_subscribers),
        "uptime_s": int(time.time() - session_start),
        "by_type": by_type,
        "speed_min": min(speeds) if speeds else None,
        "speed_max": max(speeds) if speeds else None,
        "speed_avg": round(sum(speeds) / len(speeds), 1) if speeds else None,
        "unique_locos": list(set(locos)),
        "emergencies": emergencies,
    }


# ── POST /live/clear ──────────────────────────────────────────────────────
@app.post("/live/clear")
async def clear_session():
    global packet_counter, session_start
    live_history.clear()
    packet_counter = 0
    session_start = time.time()
    await broadcast({"type": "session_cleared"})
    return {"success": True, "message": "Session cleared"}


# ── POST /decode ──────────────────────────────────────────────────────────
@app.post("/decode")
async def decode_packets(request: DecodeRequest):
    global packet_counter
    try:
        t0 = time.perf_counter()
        pkt_list = request.packets
        if isinstance(pkt_list, dict):
            pkt_list = [pkt_list]
        results = decode_all_packets(pkt_list)
        for r in results:
            packet_counter += 1
            r = enrich(r)
            r["packet_index"] = packet_counter
            r["received_at"] = time.time()
            r["received_at_iso"] = _ist_time_str()   # IST — not server local/UTC
            r["source"] = "manual-ui"
            live_history.append(r)
        elapsed = round((time.perf_counter() - t0) * 1000, 2)
        return {"success": True, "results": results,
                "count": len(results), "elapsed_ms": elapsed}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── POST /validate ────────────────────────────────────────────────────────
@app.post("/validate")
async def validate_packets(request: DecodeRequest):
    try:
        results = decode_all_packets(request.packets)
        report = []
        for r in results:
            issues = []
            if r.get("error"):
                issues.append(
                    {"type": "decode_error", "message": r["error"], "severity": "error"})
            else:
                crc = crc32_check(r.get("payload_hex", ""))
                if crc.get("match") is False:
                    issues.append({"type": "crc_mismatch",
                                   "message": f"CRC FAIL: {crc['computed_hex']} ≠ {crc['stored_hex']}",
                                   "severity": "error"})
                elif crc.get("match") is True:
                    issues.append(
                        {"type": "crc_ok", "message": "CRC PASS", "severity": "ok"})
                for w in validate_fields(r.get("fields", [])):
                    issues.append({"type": "range",
                                   "message": f"{w['field']}={w['value']} expected {w['expected']}",
                                   "severity": "warning"})
                for f in r.get("fields", []):
                    if (f.get("Field", "")).strip() in ("EMERGENCY_STATUS", "GEN_SOS_CALL"):
                        if isinstance(f.get("Decimal Value"), int) and f["Decimal Value"] > 0:
                            issues.append({"type": "emergency",
                                           "message": f"EMERGENCY: {f['Field']}={f['Description']}",
                                           "severity": "critical"})
            report.append({
                "packet_index": r.get("packet_index", 0),
                "packet_type":  r.get("packet_type_name", "Unknown"),
                "issues": issues,
                "has_errors": any(i["severity"] in ("error", "critical") for i in issues),
            })
        return {"success": True, "report": report,
                "total_errors": sum(r["has_errors"] for r in report)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── POST /diff ────────────────────────────────────────────────────────────
@app.post("/diff")
async def diff_packets(request: DiffRequest):
    try:
        a = decode_all_packets(request.packet_a)[0]
        b = decode_all_packets(request.packet_b)[0]
        fa = {f["Field"]: f for f in a.get(
            "fields", []) if not f.get("_is_section")}
        fb = {f["Field"]: f for f in b.get(
            "fields", []) if not f.get("_is_section")}
        all_keys = list(dict.fromkeys(list(fa.keys()) + list(fb.keys())))
        diff = [{
            "field":   k,
            "value_a": fa.get(k, {}).get("Decimal Value"),
            "value_b": fb.get(k, {}).get("Decimal Value"),
            "desc_a":  fa.get(k, {}).get("Description"),
            "desc_b":  fb.get(k, {}).get("Description"),
            "raw_a":   fa.get(k, {}).get("Raw Bits"),
            "raw_b":   fb.get(k, {}).get("Raw Bits"),
            "changed": fa.get(k, {}).get("Decimal Value") != fb.get(k, {}).get("Decimal Value"),
        } for k in all_keys]
        return {"success": True, "diff": diff,
                "changed_fields": sum(1 for d in diff if d["changed"]),
                "total_fields": len(diff)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── POST /upload ──────────────────────────────────────────────────────────
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        text = (await file.read()).decode("utf-8")
        try:
            data = json.loads(text)
        except Exception:
            fixed = text.replace("}\n{", "},{").replace("} {", "},{").strip()
            if not fixed.startswith("["):
                fixed = "[" + fixed + "]"
            data = json.loads(fixed)
        pkt_list = data if isinstance(data, list) else [data]
        results = decode_all_packets(pkt_list)
        for r in results:
            enrich(r)
        return {"success": True, "results": results,
                "count": len(results), "filename": file.filename}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── POST /stats ───────────────────────────────────────────────────────────
@app.post("/stats")
async def packet_stats(request: DecodeRequest):
    try:
        results = decode_all_packets(request.packets)
        by_type, speeds, locos, stations, emergencies = {}, {}, {}, {}, []
        for r in results:
            tn = r.get("packet_type_name", "Unknown")
            by_type[tn] = by_type.get(tn, 0) + 1
            for f in r.get("fields", []):
                fn = (f.get("Field") or "").strip()
                v = f.get("Decimal Value")
                if fn == "TRAIN_SPEED" and isinstance(v, int) and 0 < v <= 400:
                    speeds[v] = 1
                if fn == "SOURCE_LOCO_ID" and isinstance(v, int) and v > 0:
                    locos[v] = 1
                if fn == "SOURCE_STN_ILC_IBS_ID" and isinstance(v, int) and v > 0:
                    stations[v] = 1
                if fn in ("EMERGENCY_STATUS", "GEN_SOS_CALL") and isinstance(v, int) and v > 0:
                    emergencies.append({"pkt": r.get("packet_index"), "field": fn,
                                        "val": v, "desc": f.get("Description", "")})
        sp = list(speeds.keys())
        return {"success": True, "stats": {
            "total": len(results), "by_type": by_type,
            "unique_locos": list(locos.keys()), "unique_stations": list(stations.keys()),
            "speed_min": min(sp) if sp else None, "speed_max": max(sp) if sp else None,
            "speed_avg": round(sum(sp) / len(sp), 1) if sp else None,
            "emergencies": emergencies,
        }}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── GET /spec/packet-types ────────────────────────────────────────────────
@app.get("/spec/packet-types")
async def spec_packet_types():
    return {"packet_types": [
        {"code": 9,  "binary": "1001",
            "name": "Station to Onboard Regular Packet", "section": "C.4.2"},
        {"code": 10, "binary": "1010",
            "name": "Onboard to Station Regular Packet",  "section": "C.4.3"},
        {"code": 11, "binary": "1011",
            "name": "Access Authority Packet",             "section": "C.4.4"},
        {"code": 12, "binary": "1100",
            "name": "Additional Emergency Packet",         "section": "C.4.5"},
        {"code": 13, "binary": "1101",
            "name": "Onboard Access Request Packet",       "section": "C.4.6"},
    ]}


# ═══════════════════════════════════════════════════════════════════════════
#  SVK SIM ENDPOINTS  —  powered by svk_sim.c via ctypes
# ═══════════════════════════════════════════════════════════════════════════

class SvkXmlPayload(BaseModel):
    xml: str  # raw XML text sent from the browser


@app.get("/svk/status")
async def svk_status():
    """Check whether the C library compiled and loaded successfully."""
    if SVK_AVAILABLE:
        return {"available": True, "message": "svk_sim.so loaded OK"}
    return {"available": False, "message": _svk_err_msg}


@app.post("/svk/parse_station")
async def svk_parse_station(payload: SvkXmlPayload):
    """
    Parse a Station XML document using the C library.
    Returns structured JSON with stations, signals, and points.
    """
    if not SVK_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail=f"SVK SIM C library not available: {_svk_err_msg}",
        )
    if not payload.xml or not payload.xml.strip():
        raise HTTPException(status_code=400, detail="Empty XML payload")
    try:
        result = parse_station(payload.xml)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/svk/parse_storyboard")
async def svk_parse_storyboard(payload: SvkXmlPayload):
    """
    Parse a StoryBoard XML document using the C library.
    Returns structured JSON with stories, acts, events, and triggers.
    """
    if not SVK_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail=f"SVK SIM C library not available: {_svk_err_msg}",
        )
    if not payload.xml or not payload.xml.strip():
        raise HTTPException(status_code=400, detail="Empty XML payload")
    try:
        result = parse_storyboard(payload.xml)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))# ═══════════════════════════════════════════════════════════════════════════
#  SVK SIM — MISSING ENDPOINTS
#  Append these to the bottom of your existing main.py
#  (after the last existing @app route)
#
#  Adds:
#    POST /svk/encode_storyboard_csv   ← was causing 404
#    POST /svk/transmit_storyboard_csv
#    POST /svk/transmit_stop
#    POST /live/inject                 ← broadcasts decoded pkt to WS clients
# ═══════════════════════════════════════════════════════════════════════════

import ctypes as _ctypes

# ── Pull encode / transmit functions from svk_sim_bridge ─────────────────
# svk_sim_bridge.py already loads svk_sim.so.  We import the extra symbols
# that were NOT imported at the top of main.py.
try:
    from svk_sim_bridge import (
        encode_storyboard_csv      as _svk_encode_csv,
        transmit_storyboard_csv_blocking as _svk_transmit_blocking,
        stop_transmit              as _svk_stop,
        get_frame_prefix           as _svk_frame_prefix,
    )
    _SVK_ENCODE_OK = True
except Exception as _enc_err:
    _SVK_ENCODE_OK = False
    _enc_err_msg   = str(_enc_err)

# ── Pull Track Profile (APD) loader from svk_sim_bridge ──────────────────
# Requires svk_sim_bridge.py to expose thin ctypes wrappers around the C
# layer's svk_load_track_profile(const char*) / svk_track_profile_count()
# (added alongside encode_storyboard_csv() — see SECTION 10B in svk_sim.c).
# See the accompanying svk_sim_bridge_track_profile_patch.py for the exact
# snippet to merge into svk_sim_bridge.py if these two names don't exist yet.
try:
    from svk_sim_bridge import (
        load_track_profile   as _svk_load_track_profile,
        track_profile_count  as _svk_track_profile_count,
    )
    _SVK_PROFILE_OK = True
except Exception as _prof_err:
    _SVK_PROFILE_OK = False
    _prof_err_msg   = str(_prof_err)


# ── Pydantic models for new endpoints ────────────────────────────────────

class EncodeCsvPayload(BaseModel):
    csv:      str
    radio_id: int = 1   # 1 (Radio1) or 2 (Radio2) — sets the §C.3.2.12
                        # OTA Start-of-Frame prefix (0xF1/0xF2 0xA5 0xC3)
                        # reported back in frame_prefix / ota_hex.


class TransmitCsvPayload(BaseModel):
    csv:       str
    dest_ip:   str  = "127.0.0.1"
    dest_port: int  = 12345
    loop:      bool = False
    radio_id:  int  = 1   # 1 (Radio1) or 2 (Radio2) — sets the §C.3.2.12
                          # OTA Start-of-Frame prefix prepended to every
                          # UDP packet by the C layer.


class LiveInjectPayload(BaseModel):
    hex:         str
    activeRadio: str = "0xF1"
    source:      str = "SVK_SIM"


# ── POST /svk/load_track_profile ─────────────────────────────────────────
#
# Loads a Track Profile / APD workbook (e.g.
# "SKP_Track_TLI_Profile_Hex_Data_25Aug2026_1.xlsx") — the sheet with
# columns: S.No, Entry Signal, Exit Signal, Line, Reference TAG,
# Profile Span, PSR Count, PSR Data (HEX), Gradient Count,
# Gradient Data (HEX), LC Gate Count, LC Gate Data (HEX), TO Count,
# Turnout Data (HEX), TLI Count, TLI Data (HEX), TCD Count,
# TCD Data (HEX) — into the C layer's in-memory Track Profile table, so
# encode_pkt9() can resolve a storyboard row's ROUTE1..ROUTE4 columns
# (each an S.No index) into that row's six §C.4.2 sub-packets
# (Static Speed / Gradient / LC Gate / Turnout / TLI / Track Condition)
# and append them verbatim after the MA sub-packet.
#
# This REPLACES the earlier "Load Profile XML" slot on the SvkSim.jsx
# page — Track Profile data now comes from this .xlsx workbook instead.
#
# Only the S.No column and the six "... Data (HEX)" columns are read;
# Entry/Exit Signal, Line, Reference TAG, Profile Span, and the *_Count
# columns are for the operator's reference in the workbook only and are
# not transmitted (the sub-packet's own embedded SUB_PKT_LENGTH already
# tells the C layer how many bytes of each padded HEX column are real —
# see track_profile_field_len() in svk_sim.c).

_TRACK_PROFILE_HEX_COLS = {
    "PSR Data (HEX)":      0,
    "Gradient Data (HEX)": 1,
    "LC Gate Data (HEX)":  2,
    "Turnout Data (HEX)":  3,
    "TLI Data (HEX)":      4,
    "TCD Data (HEX)":      5,
}


def _build_track_profile_text(xlsx_bytes: bytes) -> tuple:
    """
    Parse a Track Profile / APD .xlsx (first sheet) into the '|'-delimited
    text svk_load_track_profile() expects — one line per row:
        <S.No>|<PSR hex>|<Gradient hex>|<LC hex>|<Turnout hex>|<TLI hex>|<TCD hex>

    Also captures every column of every valid row (not just S.No + the six
    hex columns) verbatim, in the workbook's own header order, so the caller
    can hand the *full* sheet content back to the frontend for display —
    not just a parsed-line-count summary.

    Returns (text, row_count, skipped_count, columns, full_rows) where
    `columns` is the header row (list[str]) and `full_rows` is a list of
    lists of stringified cell values, one list per valid row, aligned to
    `columns`.
    Raises ValueError if openpyxl is unavailable or the sheet is missing
    the "S.No" column.
    """
    try:
        import openpyxl
    except ImportError as e:
        raise ValueError(
            "openpyxl is required to read Track Profile .xlsx files "
            "(pip install openpyxl)"
        ) from e

    import io
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=True, read_only=True)
    ws = wb[wb.sheetnames[0]]

    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter, None)
    if not header:
        raise ValueError("Track Profile workbook is empty")

    header = [str(h).strip() if h is not None else "" for h in header]
    try:
        sno_col = header.index("S.No")
    except ValueError:
        raise ValueError('Track Profile workbook is missing an "S.No" column')

    hex_col_idx = {}
    for name, field_idx in _TRACK_PROFILE_HEX_COLS.items():
        if name not in header:
            raise ValueError(f'Track Profile workbook is missing column "{name}"')
        hex_col_idx[field_idx] = header.index(name)

    lines, full_rows, row_count, skipped = [], [], 0, 0
    for raw_row in rows_iter:
        if raw_row is None or raw_row[sno_col] in (None, ""):
            continue
        try:
            sno = int(raw_row[sno_col])
        except (TypeError, ValueError):
            skipped += 1
            continue
        fields = []
        for field_idx in range(6):
            val = raw_row[hex_col_idx[field_idx]]
            hex_str = "" if val is None else str(val).strip()
            # Guard against '|' ever slipping into a hex cell — it's the
            # line-level delimiter for svk_load_track_profile()'s parser.
            fields.append(hex_str.replace("|", " "))
        lines.append(f"{sno}|" + "|".join(fields))
        row_count += 1

        # Capture the row exactly as the workbook has it, one cell per
        # header column, so the frontend can render the complete sheet
        # (Entry Signal, Exit Signal, Line, Reference TAG, Profile Span,
        # every *_Count column, and the full un-padded hex strings) —
        # not just the six hex columns actually consumed by the C layer.
        full_rows.append([
            "" if (i >= len(raw_row) or raw_row[i] is None) else str(raw_row[i]).strip()
            for i in range(len(header))
        ])

    text = "\n".join(lines) + ("\n" if lines else "")
    return text, row_count, skipped, header, full_rows


@app.post("/svk/load_track_profile")
async def svk_load_track_profile_endpoint(file: UploadFile = File(...)):
    """
    Upload a Track Profile / APD .xlsx workbook. Parses it with openpyxl
    and loads it into the C layer for ROUTE1..ROUTE4 sub-packet lookups
    on every subsequent /svk/encode_storyboard_csv or
    /svk/transmit_storyboard_csv call. Replaces any previously loaded
    table.
    """
    if not SVK_AVAILABLE or not _SVK_PROFILE_OK:
        err = _svk_err_msg if not SVK_AVAILABLE else _prof_err_msg
        raise HTTPException(
            status_code=503,
            detail=f"Track Profile loader not available: {err}",
        )
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Expected an .xlsx/.xlsm file")

    try:
        raw = await file.read()
        text, row_count, skipped, columns, full_rows = _build_track_profile_text(raw)
        if row_count == 0:
            raise HTTPException(status_code=400, detail="No valid S.No rows found in workbook")
        loaded = _svk_load_track_profile(text)
        total  = _svk_track_profile_count()
        return {
            "success":  True,
            "filename": file.filename,
            "rows_parsed":  row_count,
            "rows_skipped": skipped,
            "rows_loaded":  loaded,
            "table_size":   total,
            # Full sheet content (header + every valid row, every column)
            # so the frontend can display the complete workbook, not just
            # this summary — see ApdResults in SvkSim.jsx.
            "columns": columns,
            "rows":    full_rows,
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /svk/encode_storyboard_csv ──────────────────────────────────────

@app.post("/svk/encode_storyboard_csv")
async def svk_encode_storyboard_csv(payload: EncodeCsvPayload):
    """
    Encode a StoryBoard CSV → list of KAVACH hex packets via svk_sim.c.
    Called by SvkSim.jsx on every TRANSMIT STORYBOARD click.

    Returns:
        { "data": [ { row, line_num, tdma_slot, frame_num,
                       pkt_type, pkt_type_name, byte_len, hex, error }, … ] }
    """
    if not SVK_AVAILABLE or not _SVK_ENCODE_OK:
        err = _svk_err_msg if not SVK_AVAILABLE else _enc_err_msg
        raise HTTPException(status_code=503,
                            detail=f"SVK SIM C library not available: {err}")
    if not payload.csv or not payload.csv.strip():
        raise HTTPException(status_code=400, detail="Empty CSV payload")
    if payload.radio_id not in (1, 2):
        raise HTTPException(status_code=400, detail="radio_id must be 1 or 2")
    try:
        # Apply MA table route1 overrides to CSV before encoding
        patched_csv = _apply_ma_route1_and_authtype_to_csv(payload.csv)
        result = _svk_encode_csv(patched_csv, payload.radio_id)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /svk/transmit_storyboard_csv ────────────────────────────────────

@app.post("/svk/transmit_storyboard_csv")
async def svk_transmit_storyboard_csv(payload: TransmitCsvPayload):
    """
    Run the full TDMA-paced UDP transmission in a thread-pool executor so
    FastAPI doesn't block.  Abort with POST /svk/transmit_stop.
    """
    if not SVK_AVAILABLE or not _SVK_ENCODE_OK:
        raise HTTPException(status_code=503, detail="SVK SIM not available")
    if not payload.csv or not payload.csv.strip():
        raise HTTPException(status_code=400, detail="Empty CSV payload")
    if payload.radio_id not in (1, 2):
        raise HTTPException(status_code=400, detail="radio_id must be 1 or 2")

    # ── Per-test .log file for this TRANSMIT STORYBOARD (UDP/HTTP) run ────────
    # Unlike the serial path, _svk_transmit_blocking() runs entirely inside
    # the C layer (which live-patches FRAME_NUM and paces each frame itself)
    # and only ever reports back a single final rc — no per-packet callback
    # exists to hook into. So this logs a pre-transmit SNAPSHOT of what's
    # about to be sent instead, with synthetic per-frame timestamps spaced
    # at the same 2s TDMA epoch the C layer paces itself with. That's called
    # out explicitly in the log's header note so it's never mistaken for a
    # live per-packet trace the way the serial log is. Best-effort — any
    # failure here must never block the actual transmit.
    _log_fh = _log_path = None
    try:
        # Apply MA table route1 overrides to CSV before encoding
        patched_csv = _apply_ma_route1_and_authtype_to_csv(payload.csv)
        preview = _svk_encode_csv(patched_csv, payload.radio_id)
        _log_fh, _log_path, _log_seq = _open_test_log("udp")
        _log_note(_log_fh,
            f"dest={payload.dest_ip}:{payload.dest_port} radio={payload.radio_id} "
            f"loop={payload.loop} -- NOTE: hex/timestamps below are a "
            f"pre-transmit snapshot, not a live per-packet trace; the C "
            f"layer live-patches FRAME_NUM and paces frames internally and "
            f"does not report individual packets back to Python.")
        _log_counter = [0]
        frame_groups: dict = {}
        for pkt in preview:
            if not pkt.get("error"):
                frame_groups.setdefault(pkt["frame_num"], []).append(pkt)
        t0 = _ist_now()
        for idx, (csv_frame_num, pkts) in enumerate(frame_groups.items()):
            t = t0 + datetime.timedelta(seconds=2 * idx)
            ts = t.strftime("%H:%M:%S.") + f"{t.microsecond // 1000:03d}"
            for pkt in pkts:
                _log_pkt_line(_log_fh, _log_counter, ts, csv_frame_num,
                              pkt["tdma_slot"], pkt["pkt_type"],
                              pkt["hex"], pkt["byte_len"], direction="TX")
        for pkt in preview:
            if pkt.get("error"):
                _log_pkt_line(_log_fh, _log_counter, _ist_time_str(),
                              pkt.get("frame_num"), pkt.get("tdma_slot"), None,
                              "", 0, error=pkt["error"])
    except Exception:
        pass   # logging is best-effort; never let it block the real transmit

    try:
        # Apply MA table route1 overrides to CSV before transmitting
        patched_csv_for_udp = _apply_ma_route1_and_authtype_to_csv(payload.csv)

        loop = asyncio.get_event_loop()
        rc = await loop.run_in_executor(
            None,
            _svk_transmit_blocking,
            patched_csv_for_udp,
            payload.dest_ip,
            payload.dest_port,
            int(payload.loop),
            payload.radio_id,
        )
        _log_note(_log_fh, f"C layer returned rc={rc}")
        if rc == 0:
            return {"status": "done", "log_file": _log_path}
        if rc == -3:
            return {"status": "done_with_errors", "rc": rc, "log_file": _log_path}
        raise HTTPException(status_code=500, detail=f"C layer returned {rc}")
    except HTTPException:
        raise
    except Exception as e:
        _log_note(_log_fh, f"transmit raised: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if _log_fh is not None:
            try:
                _log_fh.close()
            except Exception:
                pass


# ── POST /svk/transmit_stop ───────────────────────────────────────────────

@app.post("/svk/transmit_stop")
async def svk_transmit_stop():
    """Signal a running transmit_storyboard_csv to abort."""
    if not SVK_AVAILABLE or not _SVK_ENCODE_OK:
        raise HTTPException(status_code=503, detail="SVK SIM not available")
    try:
        _svk_stop()
        return {"status": "stopped"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /live/inject ─────────────────────────────────────────────────────

import time as _time


def _patch_frame_num_in_hex(hex_str: str) -> str:
    """
    Patch the FRAME_NUM field in a pre-encoded KAVACH packet hex string
    with the live wall-clock value: seconds elapsed since 00:00:00 midnight.

    Per Annexure-C, FRAME_NUM is a 17-bit field whose bit offset depends
    on PKT_TYPE:

        PKT9  (type=0x9): PKT_TYPE(4) + PKT_LENGTH(10) = bit 14  → bits 14..30
        PKT10 (type=0xA): PKT_TYPE(4) + PKT_LENGTH( 7) = bit 11  → bits 11..27
        PKT11 (type=0xB): PKT_TYPE(4) + PKT_LENGTH( 7) = bit 11  → bits 11..27
        PKT12 (type=0xC): PKT_TYPE(4) + PKT_LENGTH( 7) = bit 11  → bits 11..27
        PKT13 (type=0xD): PKT_TYPE(4) + PKT_LENGTH( 7) = bit 11  → bits 11..27

    The patch works entirely in the bit domain:
      1. Convert hex → bytearray
      2. Read the 4-bit PKT_TYPE nibble to determine bit offset
      3. Clear the 17 FRAME_NUM bits
      4. Write the live value into those bits
      5. Re-sync PKT_CRC to the patched bytes (see note below)
      6. Return the patched hex string (uppercase)

    CRC RE-SYNC (fixes serial-vs-UDP CRC mismatch)
    ------------------------------------------------
    encode_storyboard_csv() bakes PKT_CRC in at *encode* time, over
    whatever FRAME_NUM it assigned then. transmit_storyboard_csv() (the
    UDP path, in svk_sim.c) never has this problem because it re-encodes
    each row — and computes the CRC — fresh, right after setting the
    live FRAME_NUM, in a single pass (see resolve_pkt_crc()).

    This serial path instead patches FRAME_NUM into an already-encoded
    packet, *after* the CRC was computed — so if we don't also refresh
    PKT_CRC, the CRC on the wire no longer matches the FRAME_NUM on the
    wire, and every serial packet fails CRC verification downstream.

    To stay byte-for-byte consistent with the UDP path's resolve_pkt_crc()
    semantics, we only refresh the CRC when it was auto-generated in the
    first place (i.e. it already matches project_crc32(payload-before-CRC)
    as encoded). Intentional CRC-FAIL test vectors are a fixed literal
    value baked in by the CSV's own non-zero CRC column — independent of
    the packet bytes — and must be left untouched so they keep failing on
    purpose, exactly like the UDP path's pass-through behaviour.

    CRITICAL: the recompute MUST use project_crc32(), not zlib.crc32().
    svk_sim.c's crc32_calc() (and therefore every PKT_CRC on the wire)
    uses a custom variant — init 0x00000000, no final XOR — which is NOT
    the same algorithm as Python's built-in zlib.crc32() (init
    0xFFFFFFFF, final XOR 0xFFFFFFFF). Using zlib.crc32() here computes
    a value that will never match a real packet's CRC, silently
    defeating the whole re-sync.

    Returns the patched hex, or the original hex if patching fails.
    """
    try:
        raw = bytearray.fromhex(hex_str.strip())
        if len(raw) < 4:
            return hex_str

        # Read PKT_TYPE from the top 4 bits of byte 0
        pkt_type = (raw[0] >> 4) & 0xF

        # Determine FRAME_NUM start bit
        if pkt_type == 9:       # PKT9: 4-bit type + 10-bit length = offset 14
            fn_bit = 14
        elif pkt_type in (10, 11, 12, 13):  # PKT10-13: 4-bit type + 7-bit length = offset 11
            fn_bit = 11
        else:
            return hex_str      # unknown type — return unchanged

        # Was the existing CRC auto-generated? Check BEFORE touching any
        # bytes: an auto CRC always equals project_crc32(everything
        # before it); an intentional CRC-FAIL literal will not (with
        # overwhelming probability), same distinction resolve_pkt_crc()
        # makes at encode time in svk_sim.c.
        was_auto_crc = False
        if len(raw) >= 5:
            old_stored_crc = int.from_bytes(raw[-4:], "big")
            was_auto_crc = project_crc32(bytes(raw[:-4])) == old_stored_crc

        # Live FRAME_NUM = IST seconds since midnight (17-bit, max 86399)
        # CRITICAL: must use IST midnight — UTC would give a wrong value by 19800 seconds
        live_fn = _ist_seconds_since_midnight() & 0x1FFFF

        # Clear 17 bits starting at fn_bit, then write live_fn MSB-first
        for i in range(17):
            bit_pos  = fn_bit + i
            byte_idx = bit_pos // 8
            bit_idx  = 7 - (bit_pos % 8)      # MSB-first within byte
            if byte_idx >= len(raw):
                return hex_str
            # Clear the bit
            raw[byte_idx] &= ~(1 << bit_idx) & 0xFF
            # Write the bit from live_fn (MSB first → bit 16 down to 0)
            if (live_fn >> (16 - i)) & 1:
                raw[byte_idx] |= (1 << bit_idx)

        # Re-sync PKT_CRC so it matches the FRAME_NUM we just wrote —
        # only for auto-generated CRCs; intentional CRC-FAIL vectors are
        # left exactly as they were.
        if was_auto_crc and len(raw) >= 5:
            new_crc = project_crc32(bytes(raw[:-4]))
            raw[-4:] = new_crc.to_bytes(4, "big")

        return raw.hex().upper()

    except Exception:
        return hex_str          # any failure → return original unchanged


# ══════════════════════════════════════════════════════════════════════════════
#  REAL-TIME MA (MOVEMENT AUTHORITY) UPDATE FROM RECEIVED RFID TAGS
#  ───────────────────────────────────────────────────────────────────────────
#  KAVACH product behaviour being mirrored here: the Station updates the MA
#  it sends to the Loco every time the Loco reports (via its Onboard→Station /
#  "L2S" regular packet) that it has read a new RFID tag. This block wires
#  that same behaviour into the simulator's SERIAL path:
#
#    1. Operator uploads the MA table .xlsx via POST /svk/load_ma_table →
#       _ma_table = {rfid_tag: {field_key: value, ...}}. Currently
#       SKP_MA_PINJ.xlsx only has "S.No, LAST_RFID_TAG, MA" columns, but this
#       is written to also pick up the planned extra columns — "S.No,
#       LAST_RFID_TAG, curSigInfo, curSigAsp, nxtSigAsp, apprSigDist, MA" —
#       the moment they're added to the sheet, with ZERO further code
#       changes: see _MA_XLSX_COLUMN_MAP below, which is the only thing that
#       would ever need editing if a column gets renamed.
#    2. Every inbound serial frame is decoded as usual (pipeline()). If it
#       turns out to be an Onboard→Station packet (PKT_TYPE=10) whose
#       LAST_RFID_TAG matches a row in _ma_table, _live_ma is updated with
#       whichever fields that row has — see _update_live_ma_from_l2s(),
#       called from both serial RX paths (svk_serial_rx_start's _on_frame
#       AND svk_serial_transmit's _on_rx_frame).
#    3. Every Station→Onboard packet (PKT_TYPE=9) about to go out over the
#       serial TX path has whichever of its MOVEMENT AUTHORITY sub-packet
#       fields are present in _live_ma patched in — see
#       _patch_ma_fields_in_hex(), called from svk_serial_transmit's TX loop
#       alongside the existing _patch_frame_num_in_hex(). A table with only
#       "MA" patches only MA_W_R_T_SIG, exactly as today; once curSigInfo /
#       curSigAsp / nxtSigAsp / apprSigDist appear in the sheet, those get
#       patched too, automatically.
#
#  SCOPE NOTE: this only covers the SERIAL path (main.py), the same way
#  _patch_frame_num_in_hex() above only covers it — the UDP path
#  (/svk/transmit_storyboard_csv) runs entirely inside svk_sim.c's own
#  blocking transmit loop and re-encodes/re-CRCs each row fresh in C, so
#  wiring real-time MA into it would mean adding a new C export (e.g. a
#  svk_set_dynamic_ma_fields() the C loop polls before encoding each
#  PKT_TYPE=9 row) — that's a svk_sim.c change I haven't made/verified here.
#  Flagging it the same way svk_sim_bridge.py already flags its own
#  out-of-scope C-side gaps, rather than guessing at C changes I can't
#  compile-test.
# ══════════════════════════════════════════════════════════════════════════════

# Maps a normalized (upper-cased, spaces/underscores stripped) .xlsx header
# cell to the internal field key _patch_ma_fields_in_hex() understands, and
# that field's bit width — used both to parse the sheet and to clamp/validate
# each value on load. "MA" and "LAST_RFID_TAG" are the only mandatory
# columns; the rest are picked up automatically if/when present, per row (a
# row missing curSigInfo, say, just won't patch CUR_SIG_INFO for that tag —
# MA still gets patched).
#
# "distPktStart" specifically: LAST_RFID_TAG doubles as both the row-matching
# key AND a value patched into the outgoing packet's own LAST_REF_RFID header
# field (see _patch_ma_fields_in_hex). DIST_PKT_START is the distance (in
# metres) measured FROM that same LAST_REF_RFID tag — so once LAST_REF_RFID
# changes to a new tag, DIST_PKT_START needs a matching value too, or the
# packet ends up internally inconsistent (a distance measured from a
# reference point the packet no longer claims to use). Add a "distPktStart"
# column to the MA table and it'll be kept in sync automatically; leave it
# out and DIST_PKT_START is left exactly as the storyboard encoded it.
_MA_XLSX_COLUMN_MAP = {
    "LASTRFIDTAG":   ("last_rfid_tag",   10),   # LAST_REF_RFID (matching key)
    "DISTPKTSTART":  ("dist_pkt_start",  15),   # DIST_PKT_START — pairs with last_rfid_tag
    "CURSIGINFO":    ("cur_sig_info",    17),   # CUR_SIG_INFO
    "CURSIGASP":     ("cur_sig_aspect",   6),   # CUR_SIG_ASPECT
    "NXTSIGASP":     ("next_sig_aspect",  6),   # NEXT_SIG_ASPECT
    "APPRSIGDIST":   ("appr_sig_dist",   15),   # APPR_SIG_DIST
    "AUTHTYPE":      ("auth_type",        2),   # AUTHORITY_TYPE — see the
                                                  # structural caveat in
                                                  # _patch_ma_fields_in_hex():
                                                  # this field can only be
                                                  # safely live-patched when
                                                  # it doesn't change whether
                                                  # AUTHORIZED_SPEED (6 bits)
                                                  # is present in the packet.
    "MA":            ("ma_m",            16),   # MA_W_R_T_SIG
    "REFPROFID":     ("REF_PROF_ID",      4),   # REF_PROF_ID — 4-bit profile number in the S2L fixed
                                                  # header (0000 = no profile, 0001-1111 = valid profile).
                                                  # Comes ONLY from the MA table's "REF_PROF_ID" column
                                                  # (normalised REFPROFID). Never derived from route1.
    "ROUTE1":        ("route1",           8),   # ROUTE1 — INTERNAL use only: S.No used to fetch the
                                                  # matching Track Profile (APD) row for the profile
                                                  # sub-packets (8-bit: 0-255). NOT written into the
                                                  # REF_PROF_ID header field.
}

_ma_table: dict = {}                                    # {rfid_tag: {field_key: value, ...}}
_ma_table_meta: dict = {"filename": None, "row_count": 0, "columns_found": []}
_live_ma: dict = {"rfid_tag": None, "fields": {}, "updated_at": None}


def _normalize_ma_header(h) -> str:
    return _re.sub(r"[\s_]+", "", str(h or "")).upper()


def _apply_ma_route1_and_authtype_to_csv(csv_text: str) -> str:
    """
    Patch storyboard CSV with ALL values from the loaded MA table.

    For each CSV row with a lastRefRfid that matches an MA table entry,
    replace these columns with MA table values:
      - REF_PROF_ID (4-bit REF_PROF_ID header value, from the MA table's
        "REF_PROF_ID" column)
      - route1 (internal only — S.No used to fetch the Track Profile (APD)
        row whose sub-packets get appended; NOT the REF_PROF_ID value)
      - authType (AUTHORITY_TYPE)
      - ma_m (MA_W_R_T_SIG)
      - cur_sig_info (CUR_SIG_INFO)
      - cur_sig_aspect (CUR_SIG_ASPECT)
      - next_sig_aspect (NEXT_SIG_ASPECT)
      - appr_sig_dist (APPR_SIG_DIST)
      - dist_pkt_start (DIST_PKT_START)

    This ensures the storyboard is COMPLETE and CORRECT before encoding,
    using the MA table as the authoritative source for all these values.
    No live-patching needed — packets are born correct.

    Returns the modified CSV text with ALL MA table columns updated.
    """
    import sys
    log_msg = f"[CSV_PATCH] START: _ma_table has {len(_ma_table)} RFIDs, csv_len={len(csv_text) if csv_text else 0}"
    print(log_msg, file=sys.stderr)

    if not _ma_table or not csv_text or not csv_text.strip():
        print(f"[CSV_PATCH] SKIP: _ma_table={bool(_ma_table)}, csv_text={bool(csv_text)}", file=sys.stderr)
        return csv_text

    lines = csv_text.split('\n')
    if not lines:
        print(f"[CSV_PATCH] SKIP: no lines", file=sys.stderr)
        return csv_text

    print(f"[CSV_PATCH] Lines: {len(lines)}", file=sys.stderr)

    # Find the header line — starts with "#TDMASlot" (possibly after leading
    # whitespace) and contains the real column list, e.g.:
    #   #TDMASlot  pktType  pktLen  frameNum  srcStationId  srcStationVer
    #   locoId  REF_PROF_ID  lastRefRfid  distPktStart  pktDir  subPktType
    #   subPktLen  frameOffset  sos  secType  curSigInfo  curSigAsp
    #   nxtSigAsp  apprSigDist  authType  authSpeed  MA  shortMA  revMA
    #   TLsts  TLtype  refFN  refOff  nxtStnHO  nxtStationId  route1  route2
    #   route3  route4  CBCMAC  CRC
    #
    # IMPORTANT — two separate bugs were fixed here:
    #
    # 1) DELIMITER: the real storyboard CSV exported/pasted from the tool is
    #    TAB-delimited, not comma-delimited. The old code always did
    #    `line.split(',')`, which on a tab-delimited line returns the whole
    #    line as a single field — so `'route1' in headers` was always False,
    #    the function silently fell through its except/guard, and returned
    #    the CSV completely unchanged. We now detect the delimiter actually
    #    used in the header line (tab vs comma) instead of assuming comma.
    #
    # 2) COLUMN NAMES: "REF_PROF_ID" and "route1" are TWO DIFFERENT real
    #    columns in this format (see header above — REF_PROF_ID is column
    #    8, route1 is column 32) and each is patched from its OWN MA table
    #    column of the same name:
    #      * REF_PROF_ID (MA table "REF_PROF_ID") → the 4-bit REF_PROF_ID
    #        field in the S2L fixed header.
    #      * route1      (MA table "route1")      → internal only; the C
    #        encoder's encode_pkt9() uses route1..route4 to look up and
    #        append the Track Profile (APD) sub-packets (PSR/Gradient/
    #        LC-Gate/Turnout/TLI/TCD). It is never written into REF_PROF_ID.
    #    (The column used to be called "refProfileNum" — that name was
    #    wrong; the correct name is REF_PROF_ID.)
    header_line = None
    header_line_idx = -1
    for idx, line in enumerate(lines):
        if line.strip() and line.strip().lstrip('#').strip().startswith('TDMASlot'):
            header_line = line
            header_line_idx = idx
            break

    if not header_line:
        print(f"[CSV_PATCH] ERROR: No header line found", file=sys.stderr)
        return csv_text

    stripped_header = header_line.strip()
    if stripped_header.startswith('#'):
        stripped_header = stripped_header[1:]

    # Detect delimiter: prefer tab if the header actually has tabs, since
    # that's the real export/paste format; fall back to comma for CSVs that
    # genuinely use commas.
    delim = '\t' if stripped_header.count('\t') > stripped_header.count(',') else ','
    print(f"[CSV_PATCH] Delimiter: '{delim}' (tabs={stripped_header.count(chr(9))}, commas={stripped_header.count(',')})", file=sys.stderr)

    headers = [h.strip() for h in stripped_header.split(delim)]
    print(f"[CSV_PATCH] Headers ({len(headers)}): {headers[:10]}...", file=sys.stderr)

    if 'route1' not in headers or 'lastRefRfid' not in headers:
        print(f"[CSV_PATCH] ERROR: Missing columns - route1={('route1' in headers)}, lastRefRfid={('lastRefRfid' in headers)}", file=sys.stderr)
        return csv_text

    lastrefid_idx = headers.index('lastRefRfid')
    # BUG FIXED HERE: this function used to patch ANY row whose lastRefRfid
    # matched the MA table — AccAuth/EMRG/AREQ rows included — even though
    # only a Station→Onboard Regular Packet (pktType=9) actually carries a
    # MOVEMENT AUTHORITY sub-packet, and route1/authType/etc mean nothing (or
    # something else entirely) at those column positions for other pktTypes.
    # Gate on the pktType column so only S2L rows get patched — this is the
    # "only when transmitting the Station to Loco regular packet" restriction
    # that was already intended (see _patch_ma_fields_in_hex's own pkt_type==9
    # gate below) but was missing here at the CSV level.
    pkttype_idx = headers.index('pktType') if 'pktType' in headers else None
    if pkttype_idx is None:
        print(f"[CSV_PATCH] WARNING: no 'pktType' column found — cannot restrict "
              f"patching to S2L rows; patching every lastRefRfid match instead.", file=sys.stderr)
    print(f"[CSV_PATCH] lastrefid_idx={lastrefid_idx}, route1_idx={headers.index('route1')}, pkttype_idx={pkttype_idx}", file=sys.stderr)

    # Map CSV column names to MA table field keys
    # Build a dict of {csv_column_name: (csv_col_idx, ma_field_key, ma_field_width)}
    csv_to_ma_map = {}
    for csv_col_name in headers:
        if csv_col_name == 'lastRefRfid':
            continue  # This is the key, not a patchable field

        # Try to find this column's mapping in _MA_XLSX_COLUMN_MAP
        # The mapping keys are the normalized Excel column names
        for norm_key, (field_key, width) in _MA_XLSX_COLUMN_MAP.items():
            norm_csv_col = _normalize_ma_header(csv_col_name)
            if norm_csv_col == norm_key:
                csv_idx = headers.index(csv_col_name)
                csv_to_ma_map[csv_col_name] = (csv_idx, field_key, width)
                print(f"[CSV_PATCH] Mapped: {csv_col_name} (idx {csv_idx}) ← {field_key}", file=sys.stderr)
                break

    print(f"[CSV_PATCH] Total mapped columns: {len(csv_to_ma_map)}", file=sys.stderr)
    if not csv_to_ma_map:
        print(f"[CSV_PATCH] WARNING: No columns mapped! Headers: {headers}", file=sys.stderr)

    # Process data rows (start AFTER header) — patch ALL MA columns from the table
    modified_lines = []
    patched_count = 0
    skipped_count = 0

    for idx, line in enumerate(lines):
        # Skip header and comment/empty lines
        if idx <= header_line_idx or not line.strip() or line.strip().startswith('#'):
            modified_lines.append(line)
            continue

        try:
            fields = line.split(delim)

            # Only S2L (Station→Onboard Regular Packet, pktType=9) rows carry
            # a MOVEMENT AUTHORITY sub-packet — skip anything else untouched.
            if pkttype_idx is not None:
                try:
                    if int(fields[pkttype_idx].strip()) != 9:
                        modified_lines.append(line)
                        continue
                except (ValueError, IndexError):
                    modified_lines.append(line)
                    continue

            # Get the lastRefRfid value
            if lastrefid_idx < len(fields):
                try:
                    rfid_val = int(fields[lastrefid_idx].strip())

                    # Check if this RFID is in the MA table
                    if rfid_val in _ma_table:
                        patched = False
                        ma_fields = _ma_table[rfid_val]

                        # Patch ALL mapped columns with MA table values
                        for csv_col_name, (csv_idx, field_key, width) in csv_to_ma_map.items():
                            if field_key in ma_fields:
                                old_val = fields[csv_idx] if csv_idx < len(fields) else "?"
                                ma_val = int(ma_fields[field_key])

                                # Validate the value fits in the field width
                                if 0 <= ma_val <= ((1 << width) - 1):
                                    # Ensure we have enough fields
                                    while len(fields) <= csv_idx:
                                        fields.append('0')

                                    # Replace the value
                                    fields[csv_idx] = str(ma_val)
                                    patched = True
                                    if idx < header_line_idx + 5:  # Log first few patches
                                        print(f"[CSV_PATCH] Row {idx} RFID {rfid_val}: {csv_col_name} {old_val}→{ma_val}", file=sys.stderr)

                        if patched:
                            # Rejoin and add to modified lines
                            modified_lines.append(delim.join(fields))
                            patched_count += 1
                            continue
                    else:
                        skipped_count += 1
                except (ValueError, KeyError, TypeError) as e:
                    print(f"[CSV_PATCH] Row {idx} ERROR: {e}", file=sys.stderr)
                    pass
        except Exception as e:
            print(f"[CSV_PATCH] Row {idx} EXCEPTION: {e}", file=sys.stderr)
            pass

        # If no MA table match, keep original line
        modified_lines.append(line)

    print(f"[CSV_PATCH] DONE: patched {patched_count} rows, skipped {skipped_count}", file=sys.stderr)
    return '\n'.join(modified_lines)


def _apply_live_ma_to_csv(csv_text: str, live_ma_fields: dict) -> str:
    """
    Patch storyboard CSV with CURRENT LIVE MA values (from latest L2S packet).

    Unlike _apply_ma_route1_and_authtype_to_csv(), this does NOT try to match
    CSV RFID tags to MA table entries. Instead, it applies the current live MA
    values (from _live_ma) to ALL CSV rows uniformly. This is needed when:

    1. The storyboard CSV's RFIDs don't match the MA table's RFIDs
    2. We've received an L2S packet with a LAST_RFID_TAG that updated _live_ma
    3. We want to re-encode with the new route1 (and other MA fields) applied
       to the NEXT packets being transmitted, regardless of their storyboard RFIDs

    Args:
        csv_text: The storyboard CSV text
        live_ma_fields: Dict of {field_key: value} from _live_ma["fields"]

    Returns:
        Modified CSV text with live MA fields patched into all data rows
    """
    import sys
    if not live_ma_fields or not csv_text or not csv_text.strip():
        return csv_text

    lines = csv_text.split('\n')
    header_line = None
    header_line_idx = -1

    for idx, line in enumerate(lines):
        if line.strip() and line.strip().lstrip('#').strip().startswith('TDMASlot'):
            header_line = line
            header_line_idx = idx
            break

    if not header_line:
        print(f"[CSV_PATCH_LIVE] No header found", file=sys.stderr)
        return csv_text

    stripped_header = header_line.strip()
    if stripped_header.startswith('#'):
        stripped_header = stripped_header[1:]

    delim = '\t' if stripped_header.count('\t') > stripped_header.count(',') else ','
    headers = [h.strip() for h in stripped_header.split(delim)]

    # BUG FIXED HERE: this function's own docstring says it applies live MA
    # values "to ALL CSV rows uniformly" — with no pktType check at all, so
    # every AccAuth/EMRG/AREQ row got MA-sub-packet field values written into
    # whatever its own columns at those same positions actually mean. Gated
    # the same way as _apply_ma_route1_and_authtype_to_csv() above: only
    # pktType==9 (Station→Onboard Regular Packet) rows are patched.
    pkttype_idx = headers.index('pktType') if 'pktType' in headers else None
    if pkttype_idx is None:
        print(f"[CSV_PATCH_LIVE] WARNING: no 'pktType' column found — cannot "
              f"restrict patching to S2L rows; patching every row instead.", file=sys.stderr)

    # Build mapping of CSV column index → field key, only for patchable columns
    csv_col_to_field = {}
    for csv_col_name in headers:
        for norm_key, (field_key, width) in _MA_XLSX_COLUMN_MAP.items():
            norm_csv_col = _normalize_ma_header(csv_col_name)
            if norm_csv_col == norm_key:
                csv_col_to_field[headers.index(csv_col_name)] = (field_key, width)
                break

    print(f"[CSV_PATCH_LIVE] Applying live MA to all rows: {list(live_ma_fields.keys())}", file=sys.stderr)

    modified_lines = []
    patched_count = 0

    for idx, line in enumerate(lines):
        # Skip header and comment/empty lines
        if idx <= header_line_idx or not line.strip() or line.strip().startswith('#'):
            modified_lines.append(line)
            continue

        try:
            fields = line.split(delim)

            if pkttype_idx is not None:
                try:
                    if int(fields[pkttype_idx].strip()) != 9:
                        modified_lines.append(line)
                        continue
                except (ValueError, IndexError):
                    modified_lines.append(line)
                    continue

            # Patch this row's columns with live MA values
            for csv_idx, (field_key, width) in csv_col_to_field.items():
                if field_key in live_ma_fields:
                    ma_val = int(live_ma_fields[field_key])

                    if 0 <= ma_val <= ((1 << width) - 1):
                        while len(fields) <= csv_idx:
                            fields.append('0')

                        old_val = fields[csv_idx] if csv_idx < len(fields) else "?"
                        fields[csv_idx] = str(ma_val)

                        if idx == header_line_idx + 1:  # Log first data row
                            print(f"[CSV_PATCH_LIVE] Row {idx}: {field_key} {old_val}→{ma_val}", file=sys.stderr)

            modified_lines.append(delim.join(fields))
            patched_count += 1

        except Exception as e:
            print(f"[CSV_PATCH_LIVE] Row {idx} error: {e}", file=sys.stderr)
            modified_lines.append(line)

    print(f"[CSV_PATCH_LIVE] Patched {patched_count} rows", file=sys.stderr)
    return '\n'.join(modified_lines)


def _build_ma_table(xlsx_bytes: bytes) -> tuple:
    """
    Parse the MA table workbook (first sheet). Mandatory columns:
    "LAST_RFID_TAG" and "MA". Optionally also picks up "curSigInfo",
    "curSigAsp", "nxtSigAsp", "apprSigDist", "authType" if present (see
    _MA_XLSX_COLUMN_MAP) — column matching is whitespace/underscore/case
    insensitive, so "Cur_Sig_Info", "CUR SIG INFO" and "curSigInfo" all
    resolve to the same field.

    Returns (table, row_count, skipped_count, columns_found) where table is
    {rfid_tag: {field_key: value, ...}}.
    Raises ValueError if openpyxl is unavailable or a required column is missing.
    """
    try:
        import openpyxl
    except ImportError as e:
        raise ValueError(
            "openpyxl is required to read the MA table .xlsx file "
            "(pip install openpyxl)"
        ) from e

    import io
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=True, read_only=True)
    ws = wb[wb.sheetnames[0]]

    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter, None)
    if not header:
        raise ValueError("MA table workbook is empty")

    # normalized header cell → column index, then → (field_key, width) via _MA_XLSX_COLUMN_MAP
    col_idx_by_field: dict = {}
    for idx, cell in enumerate(header):
        norm = _normalize_ma_header(cell)
        if norm in _MA_XLSX_COLUMN_MAP:
            field_key, width = _MA_XLSX_COLUMN_MAP[norm]
            col_idx_by_field[field_key] = (idx, width)

    tag_col = None
    for idx, cell in enumerate(header):
        if _normalize_ma_header(cell) == "LASTRFIDTAG":
            tag_col = idx
            break
    if tag_col is None or "ma_m" not in col_idx_by_field:
        raise ValueError('MA table workbook must have "LAST_RFID_TAG" and "MA" columns')

    table: dict = {}
    row_count = 0
    skipped   = 0
    for raw_row in rows_iter:
        if raw_row is None:
            continue
        tag_cell = raw_row[tag_col] if tag_col < len(raw_row) else None
        if tag_cell in (None, ""):
            continue
        try:
            tag = int(tag_cell)
        except (TypeError, ValueError):
            skipped += 1
            continue

        row_fields: dict = {}
        for field_key, (col_idx, width) in col_idx_by_field.items():
            cell = raw_row[col_idx] if col_idx < len(raw_row) else None
            if cell in (None, ""):
                continue
            try:
                v = int(cell)
            except (TypeError, ValueError):
                continue
            # distPktStart (15 bits) can hold values 0-32767
            # For negative values, they are stored as two's complement unsigned equivalents
            # (e.g., -1 becomes 32767, -2 becomes 32766, etc.)
            # Range: -16384 to 16383 (standard 15-bit signed)
            # or 0 to 32767 (unsigned representation)
            if field_key == "dist_pkt_start":
                # Accept both positive and negative values: -16384 to 16383
                min_val = -16384
                max_val = 16383
                if not (min_val <= v <= max_val):
                    continue
            else:
                # All other fields are unsigned: 0 to (2^width - 1)
                if not (0 <= v <= (1 << width) - 1):
                    continue
            row_fields[field_key] = v

        if "ma_m" not in row_fields:
            # MA is mandatory per row — a row with an out-of-range/missing
            # MA is useless (nothing to authorize), so skip it entirely.
            skipped += 1
            continue

        table[tag] = row_fields
        row_count += 1

    columns_found = [
        field_key for field_key, _w in _MA_XLSX_COLUMN_MAP.values()
        if field_key in col_idx_by_field
    ]
    return table, row_count, skipped, columns_found


def _update_live_ma_from_l2s(decoded: dict):
    """
    If `decoded` (one entry from pipeline()'s return list) is a successfully
    decoded Onboard→Station packet (PKT_TYPE=10 / 0b1010) whose LAST_RFID_TAG
    matches a row in the loaded _ma_table, update the module-level _live_ma
    state that _patch_ma_fields_in_hex() reads on every subsequent
    Station→Onboard (PKT_TYPE=9) serial TX.

    Returns a small event dict (for broadcasting over /ws/serial_log) on a
    match, else None. Never raises — a bad/foreign frame must never break
    the RX loop, exactly like every other RX handler in this module.
    """
    global _live_ma
    try:
        if not decoded or decoded.get("error"):
            return None

        # BUG FIXED HERE: this used to check
        # decoded.get("packet_type_value") != 0b1010 — but decode_all_packets()
        # never sets a "packet_type_value" key (every other place in this file
        # reads "packet_type_name", a string, e.g. "Onboard to Station Regular
        # Packet" — see the /stats, /decode, /diff handlers above). So this
        # check was always None != 0b1010 → always True → always returned
        # None here, before LAST_RFID_TAG was ever looked at. Every L2S RX,
        # table loaded or not, silently no-opped — which is why the
        # "MA updated from tag" log line never printed.
        #
        # Fixed to check packet_type_name from decoded fields — this is populated
        # reliably by decode_all_packets() and clearly identifies L2S packets.
        # L2S packets have packet_type_name containing "Onboard to Station"
        pkt_type_name = decoded.get("packet_type_name", "").lower()
        is_l2s = "onboard to station" in pkt_type_name or pkt_type_name.startswith("pkt10")
        if not is_l2s:
            return None  # not an L2S / Onboard→Station packet
        if not _ma_table:
            return None   # no table loaded yet — nothing to look up

        tag = None
        for f in decoded.get("fields", []):
            if (f.get("Field") or "").strip() == "LAST_RFID_TAG":
                tag = f.get("Decimal Value")
                break
        if tag is None:
            return None
        tag = int(tag)
        if tag not in _ma_table:
            return None   # tag not in this MA table — leave _live_ma as-is

        fields = dict(_ma_table[tag])   # copy — never let callers mutate the table
        ts = _ist_now().strftime("%H:%M:%S.") + f"{_ist_now().microsecond // 1000:03d}"
        _live_ma = {"rfid_tag": tag, "fields": fields, "updated_at": ts}
        return {"type": "ma_update", "rfid_tag": tag, "fields": fields, "ts": ts}
    except Exception:
        return None


def _read_bits_be(raw: bytearray, bit_pos: int, n: int) -> int:
    """Read n bits starting at bit_pos (MSB-first within each byte) as an unsigned int."""
    v = 0
    for i in range(n):
        byte_idx = (bit_pos + i) // 8
        bit_idx  = 7 - ((bit_pos + i) % 8)
        v = (v << 1) | ((raw[byte_idx] >> bit_idx) & 1)
    return v


def _write_bits_be(raw: bytearray, bit_pos: int, n: int, value: int) -> None:
    """Write the low n bits of value into raw starting at bit_pos (MSB-first)."""
    for i in range(n):
        byte_idx = (bit_pos + i) // 8
        bit_idx  = 7 - ((bit_pos + i) % 8)
        raw[byte_idx] &= ~(1 << bit_idx) & 0xFF
        if (value >> (n - 1 - i)) & 1:
            raw[byte_idx] |= (1 << bit_idx)


def _patch_ma_fields_in_hex(hex_str: str, live_fields: dict) -> str:
    """
    Patch one or more MOVEMENT AUTHORITY sub-packet fields inside a
    pre-encoded Station→Onboard (S2L, PKT_TYPE=9) packet, using values
    resolved from the most recently received Onboard→Station packet's
    LAST_RFID_TAG (see _update_live_ma_from_l2s() / POST /svk/load_ma_table
    above).

    `live_fields` may contain any of (all optional except none required —
    only keys actually present get patched, everything else in the packet
    is left exactly as the storyboard encoded it):
        "last_rfid_tag"   → LAST_REF_RFID   (10 bits, FIXED HEADER — the
                                              MA table's own matching key,
                                              also patched into the packet)
        "dist_pkt_start"  → DIST_PKT_START  (15 bits, FIXED HEADER — kept
                                              in sync with last_rfid_tag;
                                              see the note above
                                              _MA_XLSX_COLUMN_MAP)
        "REF_PROF_ID" → REF_PROF_ID     ( 4 bits, FIXED HEADER — from the
                                              MA table's "REF_PROF_ID" column;
                                              0000 = no profile, 0001-1111 =
                                              valid profile)
        ("route1" is NOT patched into the packet header — it is internal
         only, used at encode time to fetch the Track Profile (APD) row.)
        "ma_m"            → MA_W_R_T_SIG    (16 bits, MA sub-packet)
        "cur_sig_info"    → CUR_SIG_INFO    (17 bits, MA sub-packet)
        "cur_sig_aspect"  → CUR_SIG_ASPECT  ( 6 bits, MA sub-packet)
        "next_sig_aspect" → NEXT_SIG_ASPECT ( 6 bits, MA sub-packet)
        "appr_sig_dist"   → APPR_SIG_DIST   (15 bits, MA sub-packet)
        "auth_type"       → AUTHORITY_TYPE  ( 2 bits, MA sub-packet — see
                                              the structural caveat just
                                              below the field list)

    AUTHORITY_TYPE CAVEAT: unlike every other field above, AUTHORITY_TYPE's
    value controls whether the 6-bit AUTHORIZED_SPEED field exists at all
    right after it (only present when AUTHORITY_TYPE==0b01) — and that
    presence/absence was baked in at *encode* time (it decides how many
    bits come before MA_W_R_T_SIG, i.e. the packet's actual byte layout).
    A live bit-patch can never insert or remove those 6 bits without
    corrupting every bit after them, so we only ever patch AUTHORITY_TYPE
    in place when the new value keeps that same presence/absence — i.e.
    old and new both equal 0b01, or old and new are both something else.
    If the MA table asks for a value that would flip AUTHORIZED_SPEED
    presence, the patch is skipped for that field (silently, same
    never-corrupt-a-packet policy as everywhere else here) — getting that
    case right requires re-encoding the row via encode_storyboard_csv, not
    a live bit-patch.

    This is forward-compatible with the MA table's evolving column layout
    ("…, distPktStart, curSigInfo, curSigAsp, nxtSigAsp, apprSigDist, MA")
    — a bare 3-column sheet (S.No, LAST_RFID_TAG, MA) only ever populates
    "last_rfid_tag" and "ma_m"; every other column is picked up
    automatically by _build_ma_table() the moment it exists in the sheet,
    with no further code changes needed here.

    No-ops (returns hex_str unchanged) when live_fields is empty/None, the
    packet isn't PKT_TYPE=9, or it has no MOVEMENT AUTHORITY sub-packet.

    BIT LAYOUT (mirrors decode_station_to_onboard() / decode_subpkt_movement_
    authority() in decoder.py exactly — keep these three in sync if any of
    them changes):

        S2L fixed header (before the sub-packet loop) = 104 bits:
            PKT_TYPE(4) PKT_LENGTH(10) FRAME_NUM(17) SOURCE_STN_ID(16)
            SOURCE_STN_VER(3) DEST_LOCO_ID(20) REF_PROF_ID(4)
            LAST_REF_RFID(10) DIST_PKT_START(15) PKT_DIR(2) Padding(3)

        Each sub-packet: SUB_PKT_TYPE(4) + SUB_PKT_LENGTH(7), payload =
        (SUB_PKT_LENGTH+1)*8 - 11 bits. Movement Authority = type 0b0000.
        The loop stops once <=64 bits remain (the LOCO_Specific_MAC_CODE +
        PKT_CRC trailer), same guard decode_station_to_onboard() uses.

        Inside the MA sub-packet:
            FRAME_OFFSET(4) DEST_LOCO_SOS(4) TRAIN_SECTION_TYPE(2)
            CUR_SIG_INFO(17) CUR_SIG_ASPECT(6) NEXT_SIG_ASPECT(6)
            APPR_SIG_DIST(15) AUTHORITY_TYPE(2)
            [AUTHORIZED_SPEED(6) — present ONLY when AUTHORITY_TYPE==0b01]
            MA_W_R_T_SIG(16)
        CUR_SIG_INFO/CUR_SIG_ASPECT/NEXT_SIG_ASPECT/APPR_SIG_DIST sit at
        FIXED offsets (they come before the conditional AUTHORIZED_SPEED);
        only MA_W_R_T_SIG's offset depends on AUTHORITY_TYPE.

    CRC re-sync: identical rule to _patch_frame_num_in_hex() above — only
    refreshed when the existing PKT_CRC was auto-generated (see that
    function's docstring for the full rationale), using project_crc32()
    (NOT zlib.crc32() — different algorithm/init, would silently break
    every downstream CRC check).

    Returns the patched hex (uppercase), or the original hex unchanged if
    there's nothing to patch or anything about the packet doesn't match
    what's expected — this must never raise or corrupt a packet.
    """
    if not live_fields:
        return hex_str
    try:
        raw = bytearray.fromhex(hex_str.strip())
        total_bits = len(raw) * 8
        if total_bits < 104 + 64:
            return hex_str

        pkt_type = (raw[0] >> 4) & 0xF
        if pkt_type != 9:
            return hex_str   # only Station→Onboard packets carry an MA sub-packet

        was_auto_crc = False
        if len(raw) >= 5:
            old_stored_crc = int.from_bytes(raw[-4:], "big")
            was_auto_crc = project_crc32(bytes(raw[:-4])) == old_stored_crc

        patched = False

        # Patch LAST_RFID_TAG in the fixed S2L header (bit 74, 10 bits)
        # This is the matching key from the MA table, patched to reflect which
        # row's MA values are currently active
        # Patch REF_PROF_ID at bit 70, 4 bits, from the MA table's
        # "REF_PROF_ID" column (field key "REF_PROF_ID"). This is the
        # profile number sent to onboard KAVACH (0000 = no profile,
        # 0001-1111 = valid profile).
        # NOTE: route1 is deliberately NOT used here. route1 is internal
        # only (Track Profile / APD lookup at encode time) and must never
        # be written into REF_PROF_ID.
        if "REF_PROF_ID" in live_fields and 70 + 4 <= total_bits:
            v = live_fields.get("REF_PROF_ID")
            if v is not None:
                v = max(0, min((1 << 4) - 1, int(v)))
                _write_bits_be(raw, 70, 4, v)
                patched = True

        if "last_rfid_tag" in live_fields and 74 + 10 <= total_bits:
            v = live_fields.get("last_rfid_tag")
            if v is not None:
                v = max(0, min((1 << 10) - 1, int(v)))
                _write_bits_be(raw, 74, 10, v)
                patched = True

        # Patch DIST_PKT_START right after LAST_REF_RFID (bit 84, 15 bits) —
        # this is the packet-start distance MEASURED FROM whatever tag
        # LAST_REF_RFID names, so it needs to move in lockstep with the
        # patch above or the packet ends up claiming a distance from a
        # reference point it no longer actually uses. Only patched when the
        # MA table's "distPktStart" column supplies a value for this tag;
        # otherwise DIST_PKT_START is left exactly as the storyboard encoded it.
        # DIST_PKT_START is a 15-bit signed field; range -16384 to 16383.
        # Negative values are converted to two's complement for encoding.
        if "dist_pkt_start" in live_fields and 84 + 15 <= total_bits:
            v = live_fields.get("dist_pkt_start")
            if v is not None:
                v = int(v)
                # Clamp to 15-bit signed range (-16384 to 16383)
                if v < -16384:
                    v = -16384
                elif v > 16383:
                    v = 16383
                # Convert negative values to two's complement unsigned representation
                if v < 0:
                    v = (1 << 15) + v  # e.g., -1 becomes 32767, -16384 becomes 16384
                _write_bits_be(raw, 84, 15, v)
                patched = True

        bit_pos     = 104     # end of the fixed S2L header, start of sub-packet loop
        seen_types  = set()

        while total_bits - bit_pos > 64 and len(seen_types) < 8:
            sp_type = _read_bits_be(raw, bit_pos, 4)
            if sp_type in seen_types:
                break   # drifted past real sub-packets into the MAC/CRC trailer
            seen_types.add(sp_type)

            length_val   = _read_bits_be(raw, bit_pos + 4, 7)
            payload_bits = (length_val + 1) * 8 - 11
            sub_start    = bit_pos + 11

            if sp_type == 0b0000:   # MOVEMENT AUTHORITY
                off_cur_sig_info    = sub_start + 4 + 4 + 2
                off_cur_sig_aspect  = off_cur_sig_info + 17
                off_next_sig_aspect = off_cur_sig_aspect + 6
                off_appr_sig_dist   = off_next_sig_aspect + 6
                off_authority_type  = off_appr_sig_dist + 15

                if off_authority_type + 2 > total_bits:
                    break
                auth_type = _read_bits_be(raw, off_authority_type, 2)
                off_ma = off_authority_type + 2
                if auth_type == 0b01:
                    off_ma += 6   # AUTHORIZED_SPEED only present for OS authority

                def _try_patch(off, width, key):
                    nonlocal patched
                    v = live_fields.get(key)
                    if v is None or off + width > total_bits:
                        return
                    v = max(0, min((1 << width) - 1, int(v)))
                    _write_bits_be(raw, off, width, v)
                    patched = True

                _try_patch(off_cur_sig_info,    17, "cur_sig_info")
                _try_patch(off_cur_sig_aspect,   6, "cur_sig_aspect")
                _try_patch(off_next_sig_aspect,  6, "next_sig_aspect")
                _try_patch(off_appr_sig_dist,   15, "appr_sig_dist")

                # AUTHORITY_TYPE is only safe to patch in place when doing so
                # doesn't change whether the 6-bit AUTHORIZED_SPEED field
                # exists right after it — that presence/absence is fixed by
                # the packet's byte layout at encode time, and a bit-patch
                # can't grow/shrink the packet. See the docstring caveat.
                new_auth_type = live_fields.get("auth_type")
                if new_auth_type is not None and off_authority_type + 2 <= total_bits:
                    new_auth_type = max(0, min(3, int(new_auth_type)))
                    if (new_auth_type == 0b01) == (auth_type == 0b01):
                        _write_bits_be(raw, off_authority_type, 2, new_auth_type)
                        patched = True
                    # else: would change AUTHORIZED_SPEED presence — skip,
                    # can't be done as a live bit-patch (see docstring).

                _try_patch(off_ma,              16, "ma_m")
                break

            if payload_bits < 0:
                break   # malformed length — bail out safely, never corrupt bytes
            bit_pos = sub_start + payload_bits
            if bit_pos > total_bits:
                break

        if not patched:
            return hex_str   # this row has no MOVEMENT AUTHORITY sub-packet — nothing to do

        if was_auto_crc and len(raw) >= 5:
            new_crc = project_crc32(bytes(raw[:-4]))
            raw[-4:] = new_crc.to_bytes(4, "big")

        return raw.hex().upper()

    except Exception:
        return hex_str   # any failure → return original unchanged, never raise


@app.post("/svk/load_ma_table")
async def svk_load_ma_table_endpoint(file: UploadFile = File(...)):
    """
    Upload the MA-from-RFID table. Currently SKP_MA_PINJ.xlsx has columns
    S.No, LAST_RFID_TAG, MA — the planned extended layout adds curSigInfo,
    curSigAsp, nxtSigAsp, apprSigDist alongside MA; both are accepted as-is,
    see _MA_XLSX_COLUMN_MAP. Replaces any previously loaded table.

    This does NOT change any packet immediately — it only takes effect the
    next time a received Onboard→Station (L2S) packet's LAST_RFID_TAG
    matches a row in this table (see _update_live_ma_from_l2s(), wired into
    both serial RX paths), which then updates _live_ma for the next
    Station→Onboard TX to pick up via _patch_ma_fields_in_hex().
    """
    global _ma_table, _ma_table_meta, _live_ma
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Expected an .xlsx/.xlsm file")
    try:
        raw = await file.read()
        table, row_count, skipped, columns_found = _build_ma_table(raw)
        if row_count == 0:
            raise HTTPException(
                status_code=400,
                detail="No valid LAST_RFID_TAG/MA rows found in workbook",
            )
        _ma_table = table
        # Live MA values matched from the PREVIOUS table no longer apply.
        _live_ma = {"rfid_tag": None, "fields": {}, "updated_at": None}
        _ma_table_meta = {
            "filename": file.filename,
            "row_count": row_count,
            "columns_found": columns_found,
        }
        return {
            "success":       True,
            "filename":      file.filename,
            "rows_loaded":   row_count,
            "rows_skipped":  skipped,
            "table_size":    row_count,
            "columns_found": columns_found,   # e.g. ["ma_m"] today; grows as the sheet does
            "table": [
                {"rfid_tag": k, **v}
                for k, v in table.items()  # ✅ Preserve Excel order (no sorting!)
            ],
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/svk/ma_table_status")
async def svk_ma_table_status():
    """Current MA table size/filename/columns, plus the most recently resolved live MA fields."""
    return {
        "loaded":        bool(_ma_table),
        "filename":      _ma_table_meta.get("filename"),
        "row_count":     _ma_table_meta.get("row_count", 0),
        "columns_found": _ma_table_meta.get("columns_found", []),
        "live_ma":       _live_ma,
    }


@app.post("/live/inject")
async def live_inject(payload: LiveInjectPayload):
    """
    Decode one KAVACH packet and broadcast it live to all WebSocket clients.

    FRAME_NUM fix (Annexure-C):
      FRAME_NUM = seconds elapsed since 00:00:00 midnight (17-bit field).
      This endpoint patches the FRAME_NUM bits in the incoming pre-encoded
      hex to the live wall-clock value before decoding, so the value shown
      on the Decode LIVE page is always the real-time frame counter — not
      the static storyboard sequence index baked in at encode time.
    """
    if not payload.hex or not payload.hex.strip():
        raise HTTPException(status_code=400, detail="Empty hex payload")

    # Patch FRAME_NUM to live wall-clock value
    patched_hex = _patch_frame_num_in_hex(payload.hex)

    pkt_list = [{
        "activeRadio":    payload.activeRadio,
        "messagePayload": patched_hex,
    }]

    try:
        results = await pipeline(pkt_list, payload.source, "SVK_SIM")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decode/broadcast error: {e}")

    if results:
        results[0]["_svk_sim"]       = True
        results[0]["source"]         = payload.source
        results[0]["live_frame_num"] = _ist_seconds_since_midnight()

    return {
        "status":             "ok",
        "injected":           len(results),
        "live_frame_num":     _ist_seconds_since_midnight(),
        "subscribers_notified": len(live_subscribers),
    }

# ══════════════════════════════════════════════════════════════════════════════
#  SERIAL RADIO MODEM ENDPOINTS
#  Guardian™ Serial Radio Modem · RDSO/SPN/196/2020 Annexure-C
#
#  GET  /svk/serial_ports        — list detected ports (real) + dummy entry
#  GET  /svk/serial_config       — read current config (serial_config.json)
#  POST /svk/serial_config       — save config to serial_config.json
#  POST /svk/serial_test         — open port (or dummy), send test byte
#  POST /svk/serial_transmit     — TDMA-paced CSV encode + serial TX
#  POST /svk/serial_stop         — abort running serial TX
#  WS   /ws/serial_log           — real-time serial TX/RX/status push feed
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/svk/serial_ports")
async def svk_serial_ports():
    """
    Return a list of available serial ports.
    Always includes the dummy simulation entry so the UI has something to
    show even when no physical modem is connected.
    """
    ports = [
        {
            "device":      "SIM_LOOPBACK",
            "description": "Simulation / Loopback (no hardware required)",
            "hwid":        "DUMMY",
            "sim":         True,
        }
    ]

    if SERIAL_AVAILABLE and _serial_list_ports_mod is not None:
        for p in _serial_list_ports_mod.comports():
            hwid = (p.hwid or "").strip()
            if hwid.lower() in ("", "n/a"):
                # Linux (including WSL) always enumerates /dev/ttyS0-31 as
                # legacy motherboard UARTs whether or not any hardware is
                # attached to them — pyserial reports these with hwid
                # "n/a". They never correspond to a real USB-serial
                # adapter, so listing them just buries the real cable
                # (which shows up as /dev/ttyUSB*, hwid populated) in noise.
                continue
            ports.append({
                "device":      p.device,
                "description": p.description or "",
                "hwid":        hwid,
                "sim":         False,
            })

    return {
        "available":         SERIAL_AVAILABLE,
        "pyserial_hint":     None if SERIAL_AVAILABLE else "pip install pyserial",
        "backend_platform":  _platform.system(),   # "Linux" (incl. WSL), "Windows", "Darwin"
        "is_wsl":            IS_WSL,
        "ports":             ports,
        "current_config":    _serial_cfg,
    }


@app.get("/svk/serial_config")
async def svk_get_serial_config():
    """Return current serial configuration."""
    return {"config": _serial_cfg}


@app.post("/svk/serial_config")
async def svk_set_serial_config(payload: SerialConfigPayload):
    """
    Save serial port configuration to serial_config.json.
    If tty_device == 'SIM_LOOPBACK' the mode is forced to sim_loopback.

    Rejects baud rates that aren't in GUARDIAN_COM_PORT_BAUD_RATES when
    targeting real hardware — a typo'd baud (e.g. 12000) would otherwise
    silently open the port and produce garbled framing on the wire.
    115200 is accepted (non-standard for the Guardian's documented
    110-57,600 bps range per manual §5.6.3, but offered for USB-serial
    bridges/adapters some deployments run ahead of the modem).
    """
    global _serial_cfg

    is_sim = payload.tty_device == "SIM_LOOPBACK" or payload.mode == "sim_loopback"
    if not is_sim and payload.baud_rate not in GUARDIAN_COM_PORT_BAUD_RATES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{payload.baud_rate} bps is not a supported baud rate. "
                f"Supported rates: {', '.join(str(b) for b in GUARDIAN_COM_PORT_BAUD_RATES)} "
                f"(manual §5.6.3 documents 9600 as the Guardian COM Port default; "
                f"115200 is offered for non-standard USB-serial setups)."
            ),
        )

    tx_mode = payload.tx_mode.upper().strip()
    if tx_mode not in ("DOX", "RTS_CTS"):
        raise HTTPException(status_code=400,
            detail="tx_mode must be 'DOX' or 'RTS_CTS' (Guardian §5.6.3).")

    # BUG FIXED HERE: this dict used to leave out "rts_control_enabled"
    # entirely (it's the last key in _DEFAULT_SERIAL_CFG / serial_config.json,
    # and also the last field on SerialConfigPayload) — so every save via this
    # endpoint silently dropped it from both the in-memory _serial_cfg and the
    # file _save_serial_cfg() writes to disk straight after. In-memory reads
    # of it elsewhere (_set_ptt's .get("rts_control_enabled", 1)) happened to
    # keep working off that default, which is why this only ever showed up as
    # "the last line keeps disappearing from the file" rather than a runtime
    # error. Now carries it through from the payload like every other field.
    _serial_cfg = {
        "mode":                "sim_loopback" if is_sim else payload.mode,
        "tty_device":          payload.tty_device.strip(),
        "baud_rate":           payload.baud_rate,
        "read_timeout_s":      payload.read_timeout_s,
        "write_timeout_s":     payload.write_timeout_s,
        "data_bits":           payload.data_bits,
        "stop_bits":           payload.stop_bits,
        "parity":              payload.parity.upper(),
        "tx_mode":             tx_mode,
        "dox_delay":           payload.dox_delay,
        "rts_control_enabled": payload.rts_control_enabled,
    }
    _save_serial_cfg(_serial_cfg)
    return {"status": "saved", "config": _serial_cfg}


@app.post("/svk/serial_test")
async def svk_serial_test():
    """
    Open the configured port (or DummySerialPort), write one NULL byte,
    read back any echo, then close.  Used by the UI TEST PORT button.
    """
    ser, port_mode = _open_serial_port(_serial_cfg)
    is_sim = isinstance(ser, DummySerialPort)
    use_manual_ptt = _serial_cfg.get("tx_mode", "DOX").upper() != "RTS_CTS"
    rx = b""
    write_error = ""
    try:
        if use_manual_ptt:
            _set_ptt(ser, True, is_sim, _serial_cfg.get("rts_control_enabled", 1))
            await asyncio.sleep(PTT_KEYUP_DELAY_S)
        await _serial_write_bytes(ser, b"\x00", is_sim)
        if use_manual_ptt:
            await asyncio.sleep(PTT_KEYDOWN_DELAY_S)
            _set_ptt(ser, False, is_sim, _serial_cfg.get("rts_control_enabled", 1))
        # Give a real modem a brief moment to turn the line around before
        # we check for an echo/response — a real UART round-trip isn't
        # instantaneous the way DummySerialPort's loopback is.
        await asyncio.sleep(0.05)
        rx = await _serial_read_chunk(ser, is_sim)
    except Exception as exc:
        # Real hardware can fail mid-write (unplugged, timeout, etc.) even
        # though open() succeeded — report this instead of letting it crash
        # the endpoint with an unhandled 500.
        write_error = str(exc)
        if use_manual_ptt:
            _set_ptt(ser, False, is_sim, _serial_cfg.get("rts_control_enabled", 1))
    finally:
        if use_manual_ptt:
            _set_ptt(ser, False, is_sim, _serial_cfg.get("rts_control_enabled", 1))
        try:
            ser.close()
        except Exception:
            pass

    if write_error:
        return {
            "status":    "error",
            "port":      _serial_cfg.get("tty_device"),
            "baud_rate": _serial_cfg.get("baud_rate"),
            "mode":      port_mode,
            "sim":       is_sim,
            "rx_echo":   "",
            "message":   f"Port opened but write/read failed: {write_error}",
        }

    return {
        "status":    "ok",
        "port":      _serial_cfg.get("tty_device"),
        "baud_rate": _serial_cfg.get("baud_rate"),
        "mode":      port_mode,
        "sim":       is_sim,
        "rx_echo":   rx.hex().upper() if rx else "",
        "message":   (
            f"[SIM] DummySerialPort opened — loopback echo: {rx.hex().upper() or '(none)'}"
            if is_sim else
            f"Port {_serial_cfg.get('tty_device')} opened OK at {_serial_cfg.get('baud_rate')} baud"
        ),
    }


@app.post("/svk/serial_stop")
async def svk_serial_stop():
    """Abort a running serial transmission and/or standalone RX listener."""
    global _serial_tx_stop, _serial_tx_task, _serial_rx_stop, _serial_rx_task, _serial_tx_paused, _serial_tx_new_story
    _serial_tx_stop = True
    _serial_tx_paused = False
    _serial_tx_new_story = None
    if _serial_tx_task and not _serial_tx_task.done():
        _serial_tx_task.cancel()
    _serial_tx_task = None

    _serial_rx_stop = True
    if _serial_rx_task and not _serial_rx_task.done():
        _serial_rx_task.cancel()
    _serial_rx_task = None
    return {"status": "stop_requested"}


@app.post("/svk/serial_pause")
async def svk_serial_pause():
    """Pause the running serial transmission at the next frame boundary.

    The burst currently on air finishes; then nothing more is transmitted
    (PTT stays un-keyed, RX keeps being received) until /svk/serial_resume.
    A "paused" serial_status event (with next_frame / total_frames) is pushed
    on /ws/serial_log the moment the TX loop actually holds."""
    global _serial_tx_paused
    if not (_serial_tx_task and not _serial_tx_task.done()):
        raise HTTPException(status_code=409, detail="No serial transmission is running")
    _serial_tx_paused = True
    return {"status": "pause_requested"}


@app.post("/svk/serial_resume")
async def svk_serial_resume(payload: Optional[SerialResumePayload] = None):
    """Resume a paused serial transmission.

    • No body / no csv → continue from the frame where it paused.
    • {"csv": "..."}    → a NEW storyboard loaded while paused: it is encoded
      now (errors come back here, and the run stays paused), then the TX loop
      continues with it from ITS first frame — same session, same .log file."""
    global _serial_tx_paused, _serial_tx_new_story
    if not (_serial_tx_task and not _serial_tx_task.done()):
        _serial_tx_paused = False
        raise HTTPException(status_code=409, detail="No serial transmission is running")
    new_info = None
    if payload is not None and payload.csv and payload.csv.strip():
        try:
            patched_csv = _apply_ma_route1_and_authtype_to_csv(payload.csv)
            encoded = _svk_encode_csv(patched_csv, _serial_tx_radio_id)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"New storyboard encode failed: {e}")
        valid = [p for p in encoded if not p.get("error")]
        if not valid:
            raise HTTPException(status_code=400, detail="New storyboard has no valid packets after encoding.")
        frame_map: dict = {}
        for pkt in valid:
            frame_map.setdefault(pkt["frame_num"], []).append(pkt)
        _serial_tx_new_story = {"frames": list(frame_map.items()), "csv": payload.csv, "packets": len(valid)}
        new_info = {"frames": len(frame_map), "packets": len(valid)}
    _serial_tx_paused = False
    return {"status": "resume_requested", "new_storyboard": new_info}


@app.post("/svk/serial_rx_start")
async def svk_serial_rx_start():
    """
    Start (or confirm) a standalone RX listener on the configured port —
    for monitoring inbound Guardian™ traffic (other stations, ACKs, etc.)
    without transmitting a storyboard. Every completed frame is pushed to
    /ws/serial_log as a serial_rx event AND run through the normal decode
    pipeline (source="serial_rx") so it shows up in /live/history same as
    any other ingestion path.

    A no-op if a TX session is already running: /svk/serial_transmit's own
    task already runs continuous RX for the entire time it holds the port
    open, since a single physical serial device only accepts one open
    handle at a time.
    """
    global _serial_rx_task, _serial_rx_stop

    if _serial_tx_task and not _serial_tx_task.done():
        return {
            "status": "already_listening",
            "message": "An active transmit session already owns the port and "
                       "is listening for RX continuously.",
        }
    if _serial_rx_task and not _serial_rx_task.done():
        return {"status": "already_listening", "message": "RX listener already running."}

    _serial_rx_stop = False
    ser, port_mode = _open_serial_port(_serial_cfg)
    is_sim = isinstance(ser, DummySerialPort)
    port_name = _serial_cfg.get("tty_device", "?")
    baud_rate = _serial_cfg.get("baud_rate", 9600)

    async def _on_frame(frame: bytes):
        radio_id, prefix_bytes, pkt_bytes = _strip_ota_prefix(frame)
        hex_str = pkt_bytes.hex().upper()
        decoded_ok = False
        try:
            batch = await pipeline([{"activeRadio": "0x00", "messagePayload": hex_str}],
                                    source="serial_rx", source_id=port_name)
            decoded_ok = bool(batch) and not batch[0].get("error")
            # Real-time MA update: if this turned out to be an Onboard→Station
            # packet whose LAST_RFID_TAG matches the loaded MA table, update
            # _live_ma so the next Station→Onboard TX carries the new MA
            # (see _patch_ma_fields_in_hex(), wired into svk_serial_transmit's TX loop).
            if batch:
                ma_ev = _update_live_ma_from_l2s(batch[0])
                if ma_ev:
                    await _serial_broadcast(ma_ev)
        except Exception:
            pass
        await _serial_broadcast({
            "type":         "serial_rx",
            "hex":          hex_str,                      # pure packet — prefix stripped
            "byte_len":     len(pkt_bytes),
            "radio_id":     radio_id,
            "frame_prefix": prefix_bytes.hex().upper() if prefix_bytes else "",
            "ota_hex":      frame.hex().upper(),           # exactly what arrived on the wire
            "ota_byte_len": len(frame),
            "decoded":      decoded_ok,
            "sim":          is_sim,
            "ts":           _ist_now().strftime("%H:%M:%S.") + f"{_ist_now().microsecond // 1000:03d}",
        })

    async def _listen():
        await _serial_broadcast({
            "type": "serial_status", "status": "listening", "sim": is_sim,
            "port": port_name, "mode": port_mode,
            "message": f"RX listener started on {port_name} @ {baud_rate} baud [{port_mode}]",
        })
        try:
            await _rx_drain_loop(ser, is_sim, baud_rate, _on_frame,
                                  should_stop=lambda: _serial_rx_stop)
        except asyncio.CancelledError:
            pass
        finally:
            try:
                ser.close()
            except Exception:
                pass
            await _serial_broadcast({
                "type": "serial_status", "status": "rx_stopped", "sim": is_sim,
                "message": "RX listener stopped.",
            })

    _serial_rx_task = asyncio.get_event_loop().create_task(_listen())
    return {
        "status": "started", "port": port_name, "baud_rate": baud_rate,
        "sim": is_sim, "mode": port_mode,
        "message": f"Listening for inbound Guardian™ traffic on {port_name}.",
    }


@app.post("/svk/serial_rx_stop")
async def svk_serial_rx_stop():
    """Stop the standalone RX listener (does not touch an active TX session)."""
    global _serial_rx_task, _serial_rx_stop
    _serial_rx_stop = True
    if _serial_rx_task and not _serial_rx_task.done():
        _serial_rx_task.cancel()
    _serial_rx_task = None
    return {"status": "stop_requested"}


@app.post("/svk/serial_transmit")
async def svk_serial_transmit(payload: SerialTransmitPayload):
    """
    Encode a StoryBoard CSV and transmit each TDMA burst over the configured
    serial port (real or DummySerialPort simulation) with correct 2-second
    epoch spacing.

    Uses a generation counter to discard stale events from a previous task
    that is still shutting down when a new transmission is requested — this
    prevents the "stopped" event from the old task resetting the UI button
    state after the new task has already sent "open" / "transmitting".

    All TX/RX events are pushed to /ws/serial_log subscribers.
    """
    global _serial_tx_stop, _serial_tx_task, _live_ma, _serial_tx_paused, _serial_tx_new_story, _serial_tx_radio_id

    if not SVK_AVAILABLE or not _SVK_ENCODE_OK:
        raise HTTPException(status_code=503,
            detail="SVK SIM C library not available")
    if not payload.csv or not payload.csv.strip():
        raise HTTPException(status_code=400, detail="Empty CSV payload")
    if payload.radio_id not in (1, 2):
        raise HTTPException(status_code=400, detail="radio_id must be 1 or 2")

    # ── Step 1: signal the old task to stop and cancel it ────────────────────
    _serial_tx_stop = True
    old_task = _serial_tx_task
    if old_task and not old_task.done():
        old_task.cancel()
        try:
            await asyncio.shield(asyncio.wait_for(asyncio.shield(old_task), timeout=0.5))
        except Exception:
            pass   # CancelledError / TimeoutError — old task is dead enough

    # ── Step 2: reset state AFTER old task is dead ───────────────────────────
    _serial_tx_task = None
    _serial_tx_stop = False
    _serial_tx_paused = False
    _serial_tx_new_story = None
    _serial_tx_radio_id = payload.radio_id
    # A new run starts with NO live MA. Otherwise the previous run's last
    # matched RFID row (its route1 + MA fields) leaked into this run: the TX
    # loop below saw route1 != None on its very first frame and re-encoded the
    # whole new run with the OLD route/MA until a fresh L2S tag matched.
    _live_ma = {"rfid_tag": None, "fields": {}, "updated_at": None}

    # Encode the NEW CSV now (outside _run) so any encode error surfaces
    # synchronously in the HTTP response before we start the task.
    try:
        # Apply MA table route1 overrides to CSV before encoding
        patched_csv = _apply_ma_route1_and_authtype_to_csv(payload.csv)
        encoded = _svk_encode_csv(patched_csv, payload.radio_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Encode failed: {e}")

    # Resolve the §C.3.2.12 OTA Start-of-Frame prefix once for this session
    # (0xF1 0xA5 0xC3 for Radio1, 0xF2 0xA5 0xC3 for Radio2) — prepended to
    # every raw byte string actually written to the serial port below, and
    # reported alongside each TX log entry so it's visible in the UI.
    _ota_prefix_bytes = _svk_frame_prefix(payload.radio_id)
    _ota_prefix_hex   = _ota_prefix_bytes.hex().upper()

    valid = [p for p in encoded if not p.get("error")]
    if not valid:
        raise HTTPException(status_code=400, detail="No valid packets after encoding.")

    # Group by CSV frame_num (TDMA burst grouping key) — done here so the
    # task closure holds its OWN local copy, never shared with any old task.
    frame_map: dict = {}
    for pkt in valid:
        frame_map.setdefault(pkt["frame_num"], []).append(pkt)
    frames = list(frame_map.items())   # local snapshot — not mutated by task
    # The storyboard this session is transmitting. Replaced (not mutated) when a
    # new storyboard is swapped in on resume — see _hold_if_paused().
    story = {"frames": frames, "csv": payload.csv, "packets": len(valid), "swaps": 0}
    sent_total = [0]                    # packets actually transmitted this session

    # Open this session's .log file now (outside _run) so its real path can
    # be returned in the synchronous HTTP response below, not just logged
    # after the fact.
    _log_fh, _log_path, _log_seq = _open_test_log("serial")
    _log_counter = [0]   # shared mutable "#n" counter across TX + RX lines

    async def _run():
        global _serial_tx_stop, _serial_tx_task

        import asyncio as _asyncio

        # Capture the task driving THIS _run() invocation once, synchronously,
        # before any await. This is the "session owner" used below to decide
        # whether a push is still current.
        #
        # BUG THIS FIXES: _push() used to compare against
        # asyncio.current_task() evaluated at push time. That's correct for
        # TX pushes (called directly from this coroutine, so
        # current_task() == _serial_tx_task), but serial_rx pushes happen
        # inside _on_rx_frame, which runs as part of the SEPARATELY CREATED
        # rx_task below — so current_task() there returns rx_task, never
        # _serial_tx_task, and the guard silently discarded every single
        # serial_rx event. TX log updated fine; RX log never did, with no
        # error anywhere since it was a quiet early-return, not an exception.
        _owner_task = asyncio.current_task()

        def _ts() -> str:
            n = _ist_now()
            return n.strftime("%H:%M:%S.") + f"{n.microsecond // 1000:03d}"

        async def _push(ev: dict):
            # Don't push events if a newer task has already taken over.
            # Compare against the captured _owner_task (this session), not
            # asyncio.current_task() — see note above; rx_task pushes on
            # behalf of the same session and must pass this check too.
            if _serial_tx_task is not _owner_task:
                return
            ev.setdefault("ts", _ts())
            await _serial_broadcast(ev)

        # ── Open port ────────────────────────────────────────────────────────
        ser, port_mode = _open_serial_port(_serial_cfg)
        is_sim = isinstance(ser, DummySerialPort)
        port_name = _serial_cfg.get("tty_device", "?")

        # ── Per-test .log file for this TRANSMIT STORYBOARD run ───────────────
        # (opened outside _run(), before this task was even scheduled — see
        # above — so its path could be returned in the HTTP response too)
        _log_note(_log_fh,
            f"port={port_name} mode={port_mode} sim={is_sim} "
            f"radio={payload.radio_id} prefix=0x{_ota_prefix_hex} "
            f"baud={_serial_cfg.get('baud_rate')}")

        # Log the rows that failed to encode (e.g. an unsupported pkt_type)
        # up front — they were skipped from `frames` before the loop below
        # ever runs, so this is the only place they'd otherwise be logged.
        for _bad in encoded:
            if _bad.get("error"):
                _log_pkt_line(_log_fh, _log_counter, _ts(),
                              _bad.get("frame_num"), _bad.get("tdma_slot"), None,
                              "", 0, error=_bad["error"])

        tx_mode = _serial_cfg.get("tx_mode", "DOX")
        await _push({
            "type":         "serial_status",
            "status":       "open",
            "sim":          is_sim,
            "port":         port_name,
            "mode":         port_mode,
            "tx_mode":      tx_mode,
            "radio_id":     payload.radio_id,
            "frame_prefix": _ota_prefix_hex,
            "message": (
                f"[SIM] DummySerialPort — {port_name} @ {_serial_cfg.get('baud_rate')} baud "
                f"(loopback mode — no physical modem required) · Radio{payload.radio_id} "
                f"OTA prefix 0x{_ota_prefix_hex}"
                if is_sim else
                f"Port {port_name} opened @ {_serial_cfg.get('baud_rate')} baud, "
                f"8{_serial_cfg.get('parity','N')}{int(_serial_cfg.get('stop_bits',1))}, "
                f"TX mode {tx_mode} [{port_mode}] · Radio{payload.radio_id} "
                f"OTA prefix 0x{_ota_prefix_hex}"
            ),
        })

        try:
            # ── Concurrent RX listener for the whole TX session ──────────────
            # Runs alongside TX writes (both off-loaded to worker threads on
            # real hardware — see _serial_write_bytes/_serial_read_chunk) so
            # inbound Guardian™ traffic is captured continuously: during the
            # burst-send portion of a frame, during the inter-frame gap, and
            # right up until the port is closed — not just in the old fixed
            # 2-second inter-frame window.
            baud_rate = _serial_cfg.get("baud_rate", 9600)

            async def _on_rx_frame(frame: bytes):
                radio_id, prefix_bytes, pkt_bytes = _strip_ota_prefix(frame)
                hex_str = pkt_bytes.hex().upper()
                decoded_ok = False
                try:
                    batch = await pipeline(
                        [{"activeRadio": "0x00", "messagePayload": hex_str}],
                        source="serial_rx", source_id=port_name)
                    decoded_ok = bool(batch) and not batch[0].get("error")
                    # Real-time MA update — see the block above _patch_ma_fields_in_hex()
                    # for the full picture. On a match, _live_ma is updated here
                    # and _patch_ma_fields_in_hex() picks it up on the very next
                    # Station→Onboard packet sent by the TX loop below.
                    if batch:
                        ma_ev = _update_live_ma_from_l2s(batch[0])
                        if ma_ev:
                            await _push(ma_ev)
                            _fields_str = ", ".join(f"{k}={v}" for k, v in ma_ev["fields"].items())
                            _log_note(_log_fh,
                                f"MA updated from tag {ma_ev['rfid_tag']}: {_fields_str}")
                except Exception:
                    pass
                await _push({
                    "type":         "serial_rx",
                    "hex":          hex_str,                      # pure packet — prefix stripped
                    "byte_len":     len(pkt_bytes),
                    "radio_id":     radio_id,
                    "frame_prefix": prefix_bytes.hex().upper() if prefix_bytes else "",
                    "ota_hex":      frame.hex().upper(),           # exactly what arrived on the wire
                    "ota_byte_len": len(frame),
                    "decoded":      decoded_ok,
                    "sim":          is_sim,
                })
                _log_pkt_line(_log_fh, _log_counter, _ts(), None, None, None,
                              hex_str, len(pkt_bytes),
                              error="" if pkt_bytes else "empty/undecoded RX frame",
                              direction="RX")

            rx_task = asyncio.get_event_loop().create_task(
                _rx_drain_loop(ser, is_sim, baud_rate, _on_rx_frame,
                                should_stop=lambda: _serial_tx_stop))

            # ═══════════════════════════════════════════════════════════════════════════
            # ROUTE1 RE-ENCODING CACHE: Store re-encoded packets when route1 changes
            # ═══════════════════════════════════════════════════════════════════════════
            _prev_route1 = None
            _original_payload_csv = payload.csv
            _reencoded_cache = {}  # {pkt_key: reencoded_pkt} cache for re-encoded packets

            # ── Pause / resume ────────────────────────────────────────────────
            # Blocks while _serial_tx_paused is set (see /svk/serial_pause),
            # telling the UI exactly which frame transmission will resume at.
            async def _hold_if_paused(next_frame_idx: int) -> bool:
                """Hold while paused. Returns True if a NEW storyboard was
                swapped in on resume (caller restarts from its first frame)."""
                global _serial_tx_new_story
                if not _serial_tx_paused or _serial_tx_stop:
                    return False
                total = len(story["frames"])
                await _push({"type": "serial_status", "status": "paused", "sim": is_sim,
                             "next_frame": next_frame_idx + 1, "total_frames": total,
                             "message": f"Paused — will resume at frame {next_frame_idx + 1} of {total}."})
                _log_note(_log_fh, f"paused — next frame {next_frame_idx + 1}/{total}")
                while _serial_tx_paused and not _serial_tx_stop:
                    await _asyncio.sleep(0.05)
                if _serial_tx_stop:
                    return False
                new_story = _serial_tx_new_story
                _serial_tx_new_story = None
                if new_story:
                    story["frames"]  = new_story["frames"]
                    story["csv"]     = new_story["csv"]
                    story["packets"] = new_story["packets"]
                    story["swaps"]  += 1
                    n_frames = len(story["frames"])
                    await _push({"type": "serial_status", "status": "resumed", "sim": is_sim,
                                 "next_frame": 1, "total_frames": n_frames, "new_storyboard": True,
                                 "message": f"Resumed with NEW storyboard — {n_frames} frames, "
                                            f"{new_story['packets']} packets (same session / log)."})
                    _log_note(_log_fh, f"storyboard replaced while paused — new storyboard: "
                                       f"{n_frames} frames, {new_story['packets']} packets; "
                                       f"resumed at its frame 1")
                    return True
                await _push({"type": "serial_status", "status": "resumed", "sim": is_sim,
                             "next_frame": next_frame_idx + 1, "total_frames": total,
                             "message": f"Resumed at frame {next_frame_idx + 1} of {total}."})
                _log_note(_log_fh, f"resumed at frame {next_frame_idx + 1}/{total}")
                return False

            def _use_new_story():
                # A swapped-in storyboard: re-base the route1 re-encoding on it.
                nonlocal _original_payload_csv, _prev_route1
                _original_payload_csv = story["csv"]
                _prev_route1 = None
                _reencoded_cache.clear()

            loop_flag = True
            while loop_flag:
                frame_idx = 0
                while frame_idx < len(story["frames"]):
                    if _serial_tx_stop:
                        break
                    if await _hold_if_paused(frame_idx):
                        _use_new_story()
                        frame_idx = 0
                    if _serial_tx_stop:
                        break
                    csv_frame_num, pkts = story["frames"][frame_idx]

                    # Check if route1 changed and re-encode if needed
                    current_route1 = _live_ma.get("fields", {}).get("route1")
                    if current_route1 is not None and current_route1 != _prev_route1:
                        print(f"[ROUTE1_REENC] Detected: {_prev_route1} → {current_route1}, re-encoding...", file=sys.stderr)
                        try:
                            # Apply LIVE MA values to all CSV rows (not trying to match RFIDs)
                            live_ma_fields = _live_ma.get("fields", {})
                            repatched_csv = _apply_live_ma_to_csv(_original_payload_csv, live_ma_fields)
                            new_encoded = _svk_encode_csv(repatched_csv, payload.radio_id)

                            # Build cache: map (frame_num, tdma_slot) → reencoded packet
                            _reencoded_cache.clear()  # Clear old cache for new route1
                            for new_pkt in new_encoded:
                                if not new_pkt.get("error"):
                                    pkt_key = (new_pkt["frame_num"], new_pkt["tdma_slot"])
                                    _reencoded_cache[pkt_key] = new_pkt

                            print(f"[ROUTE1_REENC] ✅ Cached {len(_reencoded_cache)} re-encoded packets for route1={current_route1}", file=sys.stderr)
                        except Exception as e:
                            print(f"[ROUTE1_REENC] ❌ Failed: {e}", file=sys.stderr)

                        _prev_route1 = current_route1

                    live_fn = _ist_seconds_since_midnight()

                    for pkt in pkts:
                        if _serial_tx_stop:
                            break

                        # ═══════════════════════════════════════════════════════════════════════════
                        # USE RE-ENCODED PACKET IF AVAILABLE (with correct profile subpackets!)
                        # ═══════════════════════════════════════════════════════════════════════════
                        pkt_key = (pkt.get("frame_num"), pkt.get("tdma_slot"))
                        if pkt_key in _reencoded_cache:
                            print(f"[ROUTE1_TX] Using re-encoded packet for frame={pkt_key[0]}, slot={pkt_key[1]}", file=sys.stderr)
                            pkt = _reencoded_cache[pkt_key]

                        patched_hex = _patch_frame_num_in_hex(pkt["hex"])

                        # Real-time MA (Movement Authority) update — ONLY for S2L packets (PKT_TYPE=9)
                        # Patches whichever MOVEMENT AUTHORITY sub-packet fields are
                        # present in _live_ma (today just MA_W_R_T_SIG; will
                        # also cover CUR_SIG_INFO/CUR_SIG_ASPECT/NEXT_SIG_ASPECT/
                        # APPR_SIG_DIST automatically once the MA table's extra
                        # columns are added — see _MA_XLSX_COLUMN_MAP), resolved
                        # from the most recent matching L2S packet's LAST_RFID_TAG.
                        # No-ops until the first matching L2S RX after the MA
                        # table is loaded — until then the storyboard's own
                        # baked-in MA values are sent unchanged.
                        #
                        # NOTE: Only apply to S2L packets (pkt_type=9); AccAuth and other
                        # packet types use their original storyboard values unchanged.
                        if pkt.get("pkt_type") == 9:
                            patched_hex = _patch_ma_fields_in_hex(patched_hex, _live_ma.get("fields"))
                        raw_bytes   = bytes.fromhex(patched_hex)

                        # Prepend the §C.3.2.12 OTA Start-of-Frame prefix
                        # (0xF1/0xF2 0xA5 0xC3, per radio_id) — this is the
                        # very last thing added, right before the physical
                        # write, so it's never included in PKT_CRC/MAC.
                        ota_bytes = _ota_prefix_bytes + raw_bytes
                        ota_hex   = ota_bytes.hex().upper()

                        tx_status = "ok"
                        tx_error  = ""
                        # Manual PTT keying (RTS) is only needed when we're
                        # driving RTS ourselves. In RTS_CTS mode pyserial's
                        # own rtscts handshake already owns RTS per write,
                        # so we must not fight it here.
                        use_manual_ptt = tx_mode.upper() != "RTS_CTS"
                        try:
                            if use_manual_ptt:
                                _set_ptt(ser, True, is_sim, _serial_cfg.get("rts_control_enabled", 1))
                                await _asyncio.sleep(PTT_KEYUP_DELAY_S)
                            await _serial_write_bytes(ser, ota_bytes, is_sim)
                            if use_manual_ptt:
                                await _asyncio.sleep(PTT_KEYDOWN_DELAY_S)
                                _set_ptt(ser, False, is_sim, _serial_cfg.get("rts_control_enabled", 1))
                                await _asyncio.sleep(PTT_RX_SETTLE_S)
                        except Exception as exc:
                            tx_status = "error"
                            tx_error  = str(exc)
                            if use_manual_ptt:
                                _set_ptt(ser, False, is_sim, _serial_cfg.get("rts_control_enabled", 1))

                        await _push({
                            "type":           "serial_tx",
                            "frame_num":      live_fn,
                            "csv_frame_num":  csv_frame_num,
                            "tdma_slot":      pkt["tdma_slot"],
                            "pkt_type":       pkt["pkt_type"],
                            "pkt_name":       pkt.get("pkt_type_name", ""),
                            "byte_len":       pkt["byte_len"],
                            "hex":            patched_hex,
                            "radio_id":       payload.radio_id,
                            "frame_prefix":   _ota_prefix_hex,
                            "ota_hex":        ota_hex,
                            "ota_byte_len":   len(ota_bytes),
                            "status":         tx_status,
                            "error":          tx_error,
                            "sim":            is_sim,
                        })
                        _log_pkt_line(_log_fh, _log_counter, _ts(),
                                      csv_frame_num, pkt["tdma_slot"], pkt["pkt_type"],
                                      patched_hex, pkt["byte_len"], error=tx_error,
                                      direction="TX")
                        # 📡 LIVE page: decode the packet just sent (see _live_feed_serial_tx)
                        if tx_status == "ok":
                            _schedule_live_feed_serial_tx(
                                patched_hex, f"0xF{payload.radio_id}", port_name)
                        sent_total[0] += 1

                    if _serial_tx_stop:
                        break

                    swapped = False
                    is_last_frame = (frame_idx == len(story["frames"]) - 1)
                    if is_last_frame and _serial_tx_paused:
                        # Paused on the LAST burst: keep the session open so a
                        # new storyboard can still be loaded and resumed into it.
                        swapped = await _hold_if_paused(frame_idx + 1)
                    if not is_last_frame or swapped:
                        waited = 0.0
                        while waited < 2.0 and not _serial_tx_stop:
                            # Paused mid-gap: hold here, then finish the REST of
                            # this 2 s TDMA gap after resuming — so the spacing
                            # between bursts on air is never shorter than 2 s.
                            if await _hold_if_paused(frame_idx + 1):
                                swapped = True
                            await _asyncio.sleep(0.05)
                            waited += 0.05
                        # RX during this gap is now handled by rx_task above,
                        # concurrently — nothing to poll here anymore.
                    if swapped:
                        _use_new_story()
                        frame_idx = 0          # new storyboard: start at its first frame
                    else:
                        frame_idx += 1

                if _serial_tx_stop or not payload.loop:
                    loop_flag = False

        except asyncio.CancelledError:
            pass   # silently exit — a new task has taken over, don't push "stopped"
        finally:
            # Let the RX task drain and report anything still in flight
            # (e.g. the tail of a burst the Guardian was mid-sending) before
            # the port is closed out from under it.
            try:
                rx_task.cancel()
                await asyncio.gather(rx_task, return_exceptions=True)
            except Exception:
                pass
            # Defensive un-key: guarantee the Tx LED can never be left
            # glowing if we exit mid-packet (stop request, cancellation,
            # exception) — mirrors guardian_terminal.py's stop().
            _set_ptt(ser, False, is_sim, _serial_cfg.get("rts_control_enabled", 1))
            try:
                ser.close()
            except Exception:
                pass

        # Only push final status if WE are still the active task
        if _serial_tx_task is _owner_task:
            if _serial_tx_stop:
                await _push({"type": "serial_status", "status": "stopped", "sim": is_sim,
                             "message": "Transmission stopped by user."})
                _log_note(_log_fh, "session stopped by user")
            else:
                await _push({"type": "serial_status", "status": "done", "sim": is_sim,
                             "message": f"Transmission complete. {sent_total[0]} packets sent"
                                        + (f" ({story['swaps']} storyboard change(s))." if story["swaps"] else ".")})
                _log_note(_log_fh, f"session done — {sent_total[0]} packets sent"
                                   + (f", {story['swaps']} storyboard change(s)" if story["swaps"] else ""))
            _serial_tx_task = None

        if _log_fh is not None:
            try:
                _log_fh.close()
            except Exception:
                pass

    _serial_tx_task = asyncio.get_event_loop().create_task(_run())
    return {
        "status":  "started",
        "port":    _serial_cfg.get("tty_device"),
        "mode":    _serial_cfg.get("mode"),
        "packets": len(valid),
        "frames":  len(frames),
        "log_file": _log_path,
        "message": f"Serial transmission started — {len(valid)} packets across {len(frames)} frames."
                   + (f" Logging to {_log_path}." if _log_path else " (test log unavailable — see server logs.)"),
    }


@app.websocket("/ws/serial_log")
async def ws_serial_log(ws: WebSocket):
    """
    WebSocket push feed for real-time serial TX/RX log.
    SvkSim.jsx connects here when the 📡 SERIAL tab is active.
    Events: serial_tx, serial_rx, serial_status, heartbeat.
    """
    await ws.accept()
    serial_log_subscribers.add(ws)
    try:
        await ws.send_text(json.dumps({
            "type":    "serial_status",
            "status":  "connected",
            "ts":      _ist_time_str(),
            "sim":     _serial_cfg.get("mode") == "sim_loopback",
            "port":    _serial_cfg.get("tty_device"),
            "message": "Serial log WebSocket connected.",
        }))
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=25.0)
            except asyncio.TimeoutError:
                await ws.send_text(json.dumps({"type": "heartbeat", "ts": _ist_time_str()}))
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        serial_log_subscribers.discard(ws)