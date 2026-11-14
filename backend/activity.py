"""
activity.py — the PINJ server window as a readable live activity feed.

Instead of uvicorn's raw request log (mostly the browsers' /health polls every few seconds), every line is one
real thing somebody did, in time order:

    15:17:42  vinoth       ✓ SIGNED IN                  192.168.1.23 · Edge
    15:18:05  ravi.k       ▶ SERIAL TRANSMIT            AccAuth_for_SKP · radio 1
    15:18:40  ravi.k       ■ SERIAL STOP
    15:18:41  ravi.k       ⚠ ENGINE                     [CSV_PATCH] ERROR: No header line found

  • the same lines go to logs\\server\\pinj_activity_YYYY-MM-DD.log (plain text) for later debugging
  • START_PINJ.bat runs uvicorn with --no-access-log; set PINJ_VERBOSE=1 (START_PINJ.bat verbose) to also see
    every request, polls included, and every line the benches print
"""
import datetime as _dt
import hashlib
import os
import re
import sys
import threading

VERBOSE = os.environ.get("PINJ_VERBOSE", "") not in ("", "0")

# ANSI colours (Windows Terminal / Windows 10+ console)
_C = {"g": "\033[92m", "r": "\033[91m", "y": "\033[93m", "c": "\033[96m", "m": "\033[95m", "b": "\033[94m",
      "w": "\033[97m", "d": "\033[90m", "x": "\033[0m"}
if os.name == "nt":                                    # make sure VT colours are on in a classic console
    try:
        import ctypes
        k = ctypes.windll.kernel32
        h = k.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if k.GetConsoleMode(h, ctypes.byref(mode)):
            k.SetConsoleMode(h, mode.value | 0x0004)
    except Exception:                                  # noqa: BLE001
        pass
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:                                      # noqa: BLE001
    pass

# the detail column takes a softer shade of the action's colour
_DETAIL = {"g": "\033[32m", "r": "\033[31m", "y": "\033[33m", "m": "\033[35m", "b": "\033[36m", "c": "\033[36m",
           "w": "\033[37m", "d": "\033[90m"}
_ANSI = re.compile(r"\x1b\[[0-9;]*m")

# every user name keeps its own colour (same name -> same colour, also after a restart); no red: that means failure
_USER_COLOURS = [51, 214, 141, 118, 205, 39, 226, 172, 99, 45, 156, 213, 81, 208]


def user_colour(user: str) -> str:
    if not user or user in ("—", "?", "(signed out)"):
        return _C["d"]
    h = int(hashlib.md5(user.lower().encode("utf-8")).hexdigest(), 16)
    return f"\033[1;38;5;{_USER_COLOURS[h % len(_USER_COLOURS)]}m"

_lock = threading.Lock()
_LOG_DIR = None


def setup(log_root: str):
    global _LOG_DIR
    _LOG_DIR = os.path.join(log_root, "server")
    os.makedirs(_LOG_DIR, exist_ok=True)


def _ist() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=5, minutes=30)


def paint(text: str, colour: str) -> str:
    """Colour part of a detail text (e.g. a timing) — removed again for the log file."""
    return f"{_C.get(colour, _C['w'])}{text}{_C['x']}"


def speed(ms: float) -> str:
    return paint(f"{ms:.0f} ms", "g" if ms < 300 else "y" if ms < 2000 else "r")


def line(user: str, label: str, detail: str = "", colour: str = "w", ip: str = ""):
    """One activity line: time · user · label · detail (· ip). The detail is coloured to match the action."""
    t = _ist()
    user = (user or "—")[:12]
    detail = " ".join(str(detail or "").split())
    dcol = _DETAIL.get(colour, _DETAIL["w"])
    shown = f"{dcol}{detail.replace(_C['x'], _C['x'] + dcol)}{_C['x']}" if detail else ""
    if ip:
        shown = (shown + "  " if shown else "") + f"{_C['d']}[{ip}]{_C['x']}"
        detail = (detail + "  " if detail else "") + f"[{ip}]"
    plain = _ANSI.sub("", f"{t:%H:%M:%S}  {user:<12} {label:<26} {detail}").rstrip()
    col = _C.get(colour, _C["w"])
    ucol = user_colour(user)
    coloured = (f"{_C['d']}{t:%H:%M:%S}{_C['x']}  {ucol}{user:<12}{_C['x']} {col}{label:<26}{_C['x']} "
                f"{shown}").rstrip()
    with _lock:
        if not WATCH or user.lower() in WATCH:
            if PAUSED:
                if len(_held) < 5000:
                    _held.append(coloured)
            else:
                _out(coloured)
        if BEEP and colour == "r" and any(k in label for k in ("LOCKED", "SERVER ERROR", "BENCH ERROR", "CRASH")):
            _out("\a", end="")
        if _LOG_DIR:
            try:
                with open(os.path.join(_LOG_DIR, f"pinj_activity_{t:%Y-%m-%d}.log"), "a", encoding="utf-8") as f:
                    f.write(f"{t:%Y-%m-%d} {plain}\n")
            except OSError:
                pass


def banner(text: str):
    with _lock:
        _out(f"{_C['g']}{text}{_C['x']}")


# ── console controls (console.py): watch filter, pause / resume, beep ─────────────────────
WATCH = set()                                          # lower-case user names; empty = everybody
PAUSED = False
BEEP = False
_held = []


def _out(text: str, end: str = "\n"):
    try:
        print(text, end=end, flush=True)
    except Exception:                                  # noqa: BLE001 — console closed / encoding
        pass


_capture = threading.local()                            # PINJ Monitor: command answers go back to it, not the window


def say(text: str = "", colour: str = "w"):
    """Console answer to a typed command (not saved in the activity log, never held by pause)."""
    shown = f"{_C.get(colour, _C['w'])}{text}{_C['x']}" if text else ""
    buf = getattr(_capture, "lines", None)
    if buf is not None:
        buf.append(shown)
        return
    with _lock:
        _out(shown)


def capture_start():
    _capture.lines = []


def capture_end() -> list:
    lines = getattr(_capture, "lines", None) or []
    _capture.lines = None
    return lines


def pause():
    global PAUSED
    with _lock:
        PAUSED = True


def resume() -> int:
    global PAUSED
    with _lock:
        PAUSED = False
        n = len(_held)
        for t in _held:
            _out(t)
        _held.clear()
    return n


# ── audit actions (pinj_users.Store.audit) → console labels ───────────────────────────────
AUDIT_LABELS = {
    "admin_created": ("★ ADMINISTRATOR CREATED", "g"), "signup": ("✎ REQUESTED ACCOUNT", "y"),
    "login": ("✓ SIGNED IN", "g"), "logout": ("⏻ SIGNED OUT", "d"), "login_failed": ("✕ SIGN-IN FAILED", "r"),
    "account_locked": ("⛔ ACCOUNT LOCKED", "r"), "password_changed": ("🔑 CHANGED PASSWORD", "y"),
    "password_reset": ("🔑 RESET PASSWORD OF", "y"), "profile_updated": ("✎ UPDATED PROFILE", "d"),
    "user_approved": ("✓ APPROVED", "g"), "user_rejected": ("✕ REJECTED", "r"), "user_disabled": ("⏸ DISABLED", "r"),
    "user_enabled": ("▶ ENABLED", "g"), "role_changed": ("⇄ ROLE CHANGED", "y"),
    "bench_started": ("⚙ BENCH STARTED", "b"), "bench_stopped": ("■ BENCH STOPPED", "y"),
    "transmit_serial": ("▶ SERIAL TRANSMIT", "m"), "transmit_udp": ("▶ UDP TRANSMIT", "m"),
    "listen_serial": ("◉ SERIAL LISTEN", "m"), "stop_serial": ("■ SERIAL STOP", "m"),
    "serial_settings": ("⚙ SERIAL SETTINGS SAVED", "b"),
    "agent_connected": ("📡 MODEM AGENT CONNECTED", "g"), "agent_disconnected": ("📡 MODEM AGENT GONE", "y"),
    "agent_downloaded": ("⬇ DOWNLOADED AGENT", "d"), "agent_revoked": ("✕ AGENT KEY WITHDRAWN", "y"),
    "library_file": ("📂 LOADED FROM LIBRARY", "b"), "library_changed": ("📂 LIBRARY FOLDERS CHANGED", "y"),
    "myfile_uploaded": ("⬆ UPLOADED MY FILE", "b"), "myfile_removed": ("🗑 REMOVED MY FILE", "y"),
    "accounts_moved": ("⇄ ACCOUNTS MOVED", "y"),
    "user_unlocked": ("🔓 UNLOCKED", "g"), "user_kicked": ("⏏ SIGNED OUT BY SERVER", "y"),
}


def audit(username: str, action: str, detail: str = "", ip: str = ""):
    label, colour = AUDIT_LABELS.get(action, (action.upper().replace("_", " "), "w"))
    line(username, label, detail, colour, ip)


# ── engine (bench) requests worth a line; polls are skipped ───────────────────────────────
ENGINE_LABELS = {
    "/decode": "⚡ DECODE", "/diff": "⇄ DIFF", "/upload": "⬆ UPLOAD LOG", "/validate": "✓ VALIDATE",
    "/svk/load_track_profile": "▤ LOAD APD", "/svk/load_ma_table": "⇄ LOAD MA TABLE",
    "/svk/parse_station": "▤ LOAD STATION XML", "/svk/parse_storyboard": "◈ LOAD STORYBOARD",
    "/svk/encode_storyboard_csv": "◈ ENCODE STORYBOARD", "/svk/serial_test": "◎ TEST PORT",
    "/svk/serial_pause": "⏸ SERIAL PAUSE", "/svk/serial_resume": "▶ SERIAL RESUME (NEXT STORY)",
    "/svk/serial_rx_stop": "■ LISTEN STOP", "/svk/transmit_stop": "■ UDP STOP",
    "/live/clear": "✕ LIVE CLEARED", "/live/inject": "↳ LIVE INJECT", "/ingest": "↳ INGEST PACKETS",
    "/api/receive": "↳ RECEIVE PACKETS",
}
# GETs that browsers repeat on a timer — never shown (unless PINJ_VERBOSE=1)
QUIET_GET = ("/health", "/hub/auth/state", "/hub/auth/me", "/hub/users", "/hub/agent/status", "/hub/audit",
             "/hub/profile/", "/hub/library", "/hub/myfiles/", "/svk/status", "/svk/serial_config", "/svk/serial_ports",
             "/svk/ma_table_status", "/live/", "/stats", "/spec/", "/assets/", "/sounds/", "/favicon")
PAGES = {"/": "PINJ (decoder / SVK SIM / LIVE)", "/simulator": "PACKET SIMULATOR", "/live": "LIVE FEED"}


def browser_name(ua: str) -> str:
    ua = ua or ""
    for key, name in (("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari")):
        if key in ua:
            return name
    return "browser"
