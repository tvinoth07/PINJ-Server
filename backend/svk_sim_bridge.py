"""
svk_sim_bridge.py  —  Python ctypes bridge for svk_sim.so
Loaded by main.py for the /svk/* endpoints.

On first import it tries to compile svk_sim.c → svk_sim.so if the .so
is missing or older than the .c source.

EXPORTED FUNCTIONS (all four from svk_sim.c):
  parse_station(xml_text)              → dict
  parse_storyboard(xml_text)           → dict
  encode_storyboard_csv(csv_text)      → list[dict]   ← ADDED
  transmit_storyboard_csv(cfg)         → int           ← ADDED
  stop_transmit()                      → None          ← ADDED

THREAD MODEL
------------
transmit_storyboard_csv() is a blocking call inside svk_sim.c (it loops
over TDMA frames with 2-second nanosleep() boundaries). It must be run
in a background thread from FastAPI so the HTTP endpoint can return
immediately. The stop_flag mechanism lets the /svk/transmit_stop endpoint
abort the running thread safely.

FASTAPI ENDPOINT SIGNATURES (add to your router / main.py):

    class TransmitCfg(BaseModel):
        csv:       str
        dest_ip:   str  = "127.0.0.1"
        dest_port: int  = 12345
        loop:      bool = False
        radio_id:  int  = 1     # ← ADDED: 1 (Radio1) or 2 (Radio2).
                                 #   Sets the Annexure-C §C.3.2.12
                                 #   Start-of-Frame prefix (0xF1/0xF2 0xA5 0xC3)
                                 #   prepended to every packet sent.

    @router.post("/svk/encode_storyboard_csv")
    async def encode_storyboard_csv_endpoint(body: dict):
        try:
            radio_id = int(body.get("radio_id", 1))
            result = bridge.encode_storyboard_csv(body["csv"], radio_id)
            return {"data": result}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/svk/transmit_storyboard_csv")
    async def transmit_storyboard_csv_endpoint(cfg: TransmitCfg):
        try:
            rc = await asyncio.get_event_loop().run_in_executor(
                None,
                bridge.transmit_storyboard_csv_blocking,
                cfg.csv, cfg.dest_ip, cfg.dest_port, int(cfg.loop), cfg.radio_id
            )
            if rc == 0:
                return {"status": "done"}
            if rc == -3:
                return {"status": "done_with_errors", "rc": rc}
            raise HTTPException(status_code=500, detail=f"C layer returned {rc}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/svk/transmit_stop")
    async def transmit_stop_endpoint():
        bridge.stop_transmit()
        return {"status": "stopped"}

SERIAL TRANSMIT PATH (/svk/serial_transmit, /svk/serial_test — not in this
file; presumably in main.py's own serial writer, e.g. using pyserial):
that endpoint is NOT part of svk_sim.c/svk_sim_bridge.py and I don't have
its source, so it isn't patched here. It must be updated by hand to prepend
the same prefix before every serial write, e.g.:

    prefix = bridge.get_frame_prefix(serial_cfg.radio_id)  # b'\\xF1\\xA5\\xC3' or b'\\xF2\\xA5\\xC3'
    packet_bytes = bytes.fromhex(encoded_row["hex"])       # pure KAVACH packet
    ser.write(prefix + packet_bytes)                       # what actually goes OTA

Do NOT use encoded_row["ota_hex"] here if your serial writer separately
computes/attaches CRC or MAC after receiving "hex" — always prepend the
prefix to raw bytes right before the physical write, after any such
post-processing, so the prefix is the very last thing added to the frame.
"""

import ctypes
import json
import os
import subprocess
import threading
from pathlib import Path

_HERE  = Path(__file__).parent
_C_SRC = _HERE / "svk_sim.c"
_SO    = _HERE / "svk_sim.so"

# ── Auto-compile if needed ────────────────────────────────────────────────────

def _compile():
    """Compile svk_sim.c → svk_sim.so using gcc."""
    cmd = [
        "gcc", "-shared", "-fPIC", "-O2",
        str(_C_SRC), "-o", str(_SO),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"SVK SIM: gcc compilation failed:\n{result.stderr}"
        )

def _ensure_compiled():
    if not _SO.exists():
        _compile()
        return
    if _C_SRC.stat().st_mtime > _SO.stat().st_mtime:
        _compile()

_ensure_compiled()

# ── Load shared library ───────────────────────────────────────────────────────

_lib = ctypes.CDLL(str(_SO))

# ── Function signatures ───────────────────────────────────────────────────────

# int parse_station_xml(const char *xml, char *out_json, int out_len)
_lib.parse_station_xml.restype  = ctypes.c_int
_lib.parse_station_xml.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]

# int parse_storyboard_xml(const char *xml, char *out_json, int out_len)
_lib.parse_storyboard_xml.restype  = ctypes.c_int
_lib.parse_storyboard_xml.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]

# int encode_storyboard_csv(const char *csv_text, int radio_id, char *out_json, int out_len)
# radio_id ADDED: 1 or 2 — which physical radio this preview is for (sets the
# Annexure-C §C.3.2.12 OTA Start-of-Frame prefix reported in frame_prefix/ota_hex).
_lib.encode_storyboard_csv.restype  = ctypes.c_int
_lib.encode_storyboard_csv.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]

# int transmit_storyboard_csv(
#     const char *csv_text,
#     const char *dest_ip,
#     int         dest_port,
#     int         loop,
#     int         radio_id,       ← ADDED (1 or 2; sets §C.3.2.12 OTA prefix)
#     volatile int *stop_flag
# )
_lib.transmit_storyboard_csv.restype  = ctypes.c_int
_lib.transmit_storyboard_csv.argtypes = [
    ctypes.c_char_p,       # csv_text
    ctypes.c_char_p,       # dest_ip
    ctypes.c_int,          # dest_port
    ctypes.c_int,          # loop
    ctypes.c_int,          # radio_id
    ctypes.POINTER(ctypes.c_int),  # stop_flag
]

# int svk_ota_prefix_hex(int radio_id, char *out_hex, int out_len)
# NEW: lets any OTHER TX path (e.g. a serial/UHF modem writer added to
# main.py) fetch the exact same Annexure-C §C.3.2.12 prefix used above,
# instead of hard-coding "F1A5C3"/"F2A5C3" a second time.
_lib.svk_ota_prefix_hex.restype  = ctypes.c_int
_lib.svk_ota_prefix_hex.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int]

# ── Track Profile (APD) bridge ────────────────────────────────────────────
# NOTE: these two exports are NOT present in the svk_sim.c that shipped
# with this bridge file — I don't have that source, only this bridge
# module, so I can't add or verify the C side. main.py's
# /svk/load_track_profile endpoint expects to import load_track_profile()
# and track_profile_count() from this module, so the wrappers below match
# that calling convention. If svk_sim.c does not yet export
# svk_load_track_profile()/svk_track_profile_count(), `import svk_sim_bridge`
# will raise AttributeError at load time (main.py already catches this via
# its _SVK_PROFILE_OK try/except and reports a 503 with the error message —
# it will not crash the server). Add these two C functions to svk_sim.c and
# share it with me if you'd like this wired up and verified end-to-end.

# int svk_load_track_profile(const char *text)
#   `text` is '\n'-separated rows of:
#     <S.No>|<PSR hex>|<Gradient hex>|<LC hex>|<Turnout hex>|<TLI hex>|<TCD hex>
#   Replaces any previously loaded table. Returns the number of rows
#   actually loaded (>= 0), or a negative value on a parse/allocation error.
_lib.svk_load_track_profile.restype  = ctypes.c_int
_lib.svk_load_track_profile.argtypes = [ctypes.c_char_p]

# int svk_track_profile_count(void)
#   Returns the number of rows currently held in the in-memory Track
#   Profile table (i.e. the size after the most recent successful
#   svk_load_track_profile() call).
_lib.svk_track_profile_count.restype  = ctypes.c_int
_lib.svk_track_profile_count.argtypes = []

# ── Output buffer sizes ───────────────────────────────────────────────────────

_PARSE_BUF  = 1 << 20   # 1 MB  — for station / storyboard parse output
_ENCODE_BUF = 8 << 20   # 8 MB  — encode output can be large for long storyboards

# ── Stop-flag (shared between transmit thread and stop endpoint) ──────────────

_stop_flag_int   = ctypes.c_int(0)          # the actual C-visible int
_stop_flag_ptr   = ctypes.pointer(_stop_flag_int)
_tx_lock         = threading.Lock()          # protects _stop_flag_int

# ── Public API ────────────────────────────────────────────────────────────────

def parse_station(xml_text: str) -> dict:
    """Parse Station XML string → Python dict."""
    buf = ctypes.create_string_buffer(_PARSE_BUF)
    rc  = _lib.parse_station_xml(xml_text.encode("utf-8"), buf, _PARSE_BUF)
    if rc != 0:
        raise ValueError(f"C parse_station_xml returned {rc}")
    return json.loads(buf.value.decode("utf-8"))


def parse_storyboard(xml_text: str) -> dict:
    """Parse StoryBoard XML string → Python dict."""
    buf = ctypes.create_string_buffer(_PARSE_BUF)
    rc  = _lib.parse_storyboard_xml(xml_text.encode("utf-8"), buf, _PARSE_BUF)
    if rc != 0:
        raise ValueError(f"C parse_storyboard_xml returned {rc}")
    return json.loads(buf.value.decode("utf-8"))


def encode_storyboard_csv(csv_text: str, radio_id: int = 1) -> list:
    """
    Encode StoryBoard CSV → list of dicts, one per valid data row.

    Each dict contains:
        row, line_num, tdma_slot, frame_num,
        pkt_type, pkt_type_name, byte_len, hex, error,
        radio_id, frame_prefix, ota_hex, ota_byte_len

    "hex" is the pure KAVACH packet (unchanged — use this for CRC/MAC checks).
    "ota_hex" = frame_prefix + hex, i.e. exactly what goes on air per
    Annexure-C §C.3.2.12 (0xF1/0xF2 0xA5 0xC3 Start-of-Frame prefix).

    @radio_id: 1 (Radio1) or 2 (Radio2) — which physical radio this preview
               is for. Defaults to 1.
    """
    if radio_id not in (1, 2):
        raise ValueError("radio_id must be 1 or 2")
    buf = ctypes.create_string_buffer(_ENCODE_BUF)
    rc  = _lib.encode_storyboard_csv(csv_text.encode("utf-8"), ctypes.c_int(radio_id), buf, _ENCODE_BUF)
    if rc != 0:
        raise ValueError(f"C encode_storyboard_csv returned {rc}")
    return json.loads(buf.value.decode("utf-8"))


def get_frame_prefix(radio_id: int = 1) -> bytes:
    """
    Return the 3-byte Annexure-C §C.3.2.12 OTA Start-of-Frame prefix for
    the given radio unit, as raw bytes: b'\\xF1\\xA5\\xC3' (Radio1) or
    b'\\xF2\\xA5\\xC3' (Radio2).

    Use this in ANY other TX path that writes raw bytes directly — e.g. a
    serial/UHF radio-modem writer — by prepending it to the packet bytes
    before writing to the port:

        prefix = bridge.get_frame_prefix(radio_id)
        ser.write(prefix + packet_bytes)

    This keeps the framing rule defined in exactly one place (svk_sim.c)
    rather than re-hard-coding "F1A5C3"/"F2A5C3" in Python.
    """
    if radio_id not in (1, 2):
        raise ValueError("radio_id must be 1 or 2")
    buf = ctypes.create_string_buffer(8)
    rc  = _lib.svk_ota_prefix_hex(ctypes.c_int(radio_id), buf, 8)
    if rc != 0:
        raise ValueError(f"C svk_ota_prefix_hex returned {rc}")
    return bytes.fromhex(buf.value.decode("ascii"))


def transmit_storyboard_csv_blocking(
    csv_text: str,
    dest_ip:  str  = "127.0.0.1",
    dest_port: int = 12345,
    loop: int      = 0,
    radio_id: int  = 1,
) -> int:
    """
    Blocking call into C transmit_storyboard_csv().

    Runs the full TDMA-paced transmission loop, prepending the Annexure-C
    §C.3.2.12 Start-of-Frame prefix (0xF1/0xF2 0xA5 0xC3, per radio_id) to
    every UDP packet sent. Call from a thread pool executor
    (asyncio.get_event_loop().run_in_executor) so FastAPI does not block.

    @radio_id: 1 (Radio1) or 2 (Radio2) — which physical radio is transmitting.
               Defaults to 1.

    Returns the C function's return code:
        0  – success / stopped cleanly
       -1  – bad args (incl. radio_id not 1 or 2)
       -2  – socket failure
       -3  – encoding errors encountered

    Abort via stop_transmit() from another thread.
    """
    if radio_id not in (1, 2):
        raise ValueError("radio_id must be 1 or 2")

    with _tx_lock:
        _stop_flag_int.value = 0

    rc = _lib.transmit_storyboard_csv(
        csv_text.encode("utf-8"),
        dest_ip.encode("utf-8"),
        ctypes.c_int(dest_port),
        ctypes.c_int(loop),
        ctypes.c_int(radio_id),
        _stop_flag_ptr,
    )
    return rc


def load_track_profile(text: str) -> int:
    """
    Load a Track Profile / APD table into the C layer, replacing any
    previously loaded table.

    `text` is the '|'-delimited, '\\n'-separated format main.py's
    _build_track_profile_text() produces from the uploaded .xlsx:
        <S.No>|<PSR hex>|<Gradient hex>|<LC hex>|<Turnout hex>|<TLI hex>|<TCD hex>

    Once loaded, encode_storyboard_csv() / transmit_storyboard_csv_blocking()
    can resolve a StoryBoard row's ROUTE1..ROUTE4 columns (each an S.No
    index into this table) into that route's six §C.4.2 sub-packets.

    Returns the number of rows the C layer actually loaded.
    Raises ValueError if the C layer reports a negative (parse/alloc) error.
    """
    rc = _lib.svk_load_track_profile(text.encode("utf-8"))
    if rc < 0:
        raise ValueError(f"C svk_load_track_profile returned {rc}")
    return rc


def track_profile_count() -> int:
    """Return the number of rows currently held in the C layer's Track
    Profile table (0 if none has been loaded yet)."""
    return _lib.svk_track_profile_count()


def stop_transmit() -> None:
    """
    Signal a running transmit_storyboard_csv_blocking() to abort.

    Sets the stop_flag that the C transmission loop polls between frames.
    Safe to call from any thread or async context.
    """
    with _tx_lock:
        _stop_flag_int.value = 1