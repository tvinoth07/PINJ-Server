"""
svk_sim_bridge.py — the SVK SIM encoder API used by main.py for the /svk/* endpoints.

Windows PINJ: backed by svk_sim_py.py, a pure-Python port of svk_sim.c. Windows Smart App
Control blocks any DLL we compile ourselves (unsigned), so the C library is not loaded here.
svk_sim.c stays in this folder as the reference; tools/compare_svk_sim.py proves the Python
port gives byte-for-byte the same packets (run it on Linux/WSL, where gcc can build the C).

EXPORTED FUNCTIONS (same names and behaviour as the ctypes bridge they replace):
  parse_station(xml_text)                       → dict
  parse_storyboard(xml_text)                    → dict
  encode_storyboard_csv(csv_text, radio_id=1)   → list[dict]
  get_frame_prefix(radio_id=1)                  → b'\\xF1\\xA5\\xC3' / b'\\xF2\\xA5\\xC3'
  transmit_storyboard_csv_blocking(csv_text, dest_ip, dest_port, loop, radio_id) → int
  stop_transmit()                               → None
  load_track_profile(text)                      → int
  track_profile_count()                         → int

THREAD MODEL
------------
transmit_storyboard_csv_blocking() loops over TDMA frames with 2-second boundaries. Run it in a
background thread (asyncio run_in_executor) so the HTTP endpoint returns immediately;
stop_transmit() aborts it safely from any thread.
"""

import json
import threading

import svk_sim_py as _impl

_stop_event = threading.Event()


def parse_station(xml_text: str) -> dict:
    """Parse Station XML string → Python dict."""
    return json.loads(_impl.parse_station_xml(xml_text))


def parse_storyboard(xml_text: str) -> dict:
    """Parse StoryBoard XML string → Python dict."""
    return json.loads(_impl.parse_storyboard_xml(xml_text))


def encode_storyboard_csv(csv_text: str, radio_id: int = 1) -> list:
    """
    Encode StoryBoard CSV → list of dicts, one per valid data row:
        row, line_num, tdma_slot, frame_num, pkt_type, pkt_type_name, byte_len, hex,
        radio_id, frame_prefix, ota_hex, ota_byte_len, error
    "hex" is the pure KAVACH packet (use it for CRC/MAC checks); "ota_hex" = frame_prefix + hex,
    exactly what goes on air per Annexure-C §C.3.2.12.
    """
    if radio_id not in (1, 2):
        raise ValueError("radio_id must be 1 or 2")
    return _impl.encode_storyboard_csv(csv_text, radio_id)


def get_frame_prefix(radio_id: int = 1) -> bytes:
    """Annexure-C §C.3.2.12 OTA Start-of-Frame prefix: b'\\xF1\\xA5\\xC3' (Radio1) / b'\\xF2\\xA5\\xC3' (Radio2)."""
    if radio_id not in (1, 2):
        raise ValueError("radio_id must be 1 or 2")
    return _impl.ota_prefix_bytes(radio_id)


def transmit_storyboard_csv_blocking(
    csv_text: str,
    dest_ip: str = "127.0.0.1",
    dest_port: int = 12345,
    loop: int = 0,
    radio_id: int = 1,
) -> int:
    """
    Blocking TDMA-paced UDP transmission of the storyboard (prefix per radio_id on every packet).
    Returns 0 success/stopped · -1 bad args · -2 socket failure · -3 encoding errors.
    Abort via stop_transmit() from another thread.
    """
    if radio_id not in (1, 2):
        raise ValueError("radio_id must be 1 or 2")
    _stop_event.clear()
    return _impl.transmit_storyboard_csv(csv_text, dest_ip, dest_port, loop, radio_id, _stop_event)


def load_track_profile(text: str) -> int:
    """
    Load a Track Profile / APD table ('<S.No>|<PSR>|<Gradient>|<LC>|<Turnout>|<TLI>|<TCD>' per
    line, as main.py's _build_track_profile_text() builds it), replacing any previous table.
    Returns the number of rows loaded.
    """
    rc = _impl.svk_load_track_profile(text)
    if rc < 0:
        raise ValueError(f"svk_load_track_profile returned {rc}")
    return rc


def track_profile_count() -> int:
    """Rows currently held in the Track Profile table (0 if none loaded yet)."""
    return _impl.svk_track_profile_count()


def stop_transmit() -> None:
    """Signal a running transmit_storyboard_csv_blocking() to abort."""
    _stop_event.set()
