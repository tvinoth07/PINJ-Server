"""
hub.py — the PINJ front door for the whole network (port 8080).

  • login · sign-up (an administrator approves new accounts) · profile · user administration
  • one isolated PINJ engine (main.py) per signed-in user, started on demand on a private
    127.0.0.1 port with its own serial session, MA / APD tables, LIVE feed, serial settings
    (data/benches/<user>/serial_config.json) and test logs (logs/<user>/) — one person's test
    can never disturb another's
  • every PINJ API call and WebSocket of a signed-in user is forwarded to that user's engine
    (engines accept only requests carrying their secret token, so the login cannot be skipped)
  • serves the built pages (frontend/dist)
  • activity record (audit_log): sign-ups, approvals, logins, password changes, transmissions

Accounts: pinj_users.py (MySQL via backend/pinj_db.json, else data/pinj_users.sqlite).
Run:  python -m uvicorn hub:app --host 0.0.0.0 --port 8080   (START_PINJ.bat does this)
Hub endpoints live under /hub/… so they never clash with the engine's own /api/… routes.
"""
import asyncio
import collections
import contextlib
import json
import logging
import mimetypes
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time

import httpx
import websockets
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

import activity as A
import pinj_users as U

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
DATA_ROOT = os.environ.get("PINJ_DATA_ROOT") or os.path.join(PROJECT, "data")
LOG_ROOT = os.environ.get("PINJ_LOG_ROOT") or os.path.join(PROJECT, "logs")
DIST_DIR = os.path.join(PROJECT, "frontend", "dist")
COOKIE = "pinj_session"

# engine routes (main.py) — everything else is the hub's own or a page
ENGINE_PREFIXES = ("/api/receive", "/decode", "/diff", "/ingest", "/live/", "/spec/", "/stats", "/svk/",
                   "/upload", "/validate")
ENGINE_WS = ("live", "serial_log", "receive")
# engine calls written to the activity record
AUDITED = {"/svk/serial_transmit": "transmit_serial", "/svk/transmit_storyboard_csv": "transmit_udp",
           "/svk/serial_rx_start": "listen_serial", "/svk/serial_stop": "stop_serial",
           "/svk/serial_config": "serial_settings"}
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers",
       "transfer-encoding", "upgrade", "host", "cookie", "content-length", "content-encoding"}

for _ext, _type in ((".js", "application/javascript"), (".mjs", "application/javascript"), (".css", "text/css"),
                    (".svg", "image/svg+xml"), (".json", "application/json"), (".mp3", "audio/mpeg"),
                    (".wav", "audio/wav"), (".ogg", "audio/ogg"), (".m4a", "audio/mp4"), (".png", "image/png"),
                    (".webp", "image/webp"), (".ico", "image/x-icon")):
    mimetypes.add_type(_type, _ext)                     # Windows may map .js to text/plain

store = U.Store()
A.setup(LOG_ROOT)


class _QuietWebSockets(logging.Filter):
    def filter(self, rec):
        if A.VERBOSE:
            return True
        msg = rec.getMessage()
        return not ("WebSocket " in msg or msg in ("connection open", "connection closed"))


logging.getLogger("uvicorn.error").addFilter(_QuietWebSockets())
_store_audit = store.audit


def _audit_and_show(username, action, detail="", ip=""):
    """Every activity-record entry also appears, readable, in the server window (activity.py)."""
    A.audit(username, action, detail, ip)
    _store_audit(username, action, detail, ip)


store.audit = _audit_and_show
_loop = None                                              # the hub's event loop (for closing agents from sync handlers)


@contextlib.asynccontextmanager
async def _lifespan(_app):
    global _job, _loop
    _job = _windows_job()
    _loop = asyncio.get_running_loop()

    def _quiet_resets(loop, ctx):                        # a browser tab closing mid-request — harmless on Windows
        if isinstance(ctx.get("exception"), (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        loop.default_exception_handler(ctx)
    _loop.set_exception_handler(_quiet_resets)
    os.makedirs(DATA_ROOT, exist_ok=True)
    await run_in_threadpool(store.purge_sessions)
    A.banner("")
    A.banner("  PINJ hub ready — live activity of everybody below "
             "(full detail: START_PINJ.bat verbose · saved in logs\\server\\pinj_activity_<date>.log)")
    A.banner(f"  accounts: {store.where()}")
    A.banner("  type  help  + Enter here for server commands (who · status · benches · today · watch · pause …)")
    A.banner("")
    import console                                       # noqa: PLC0415 — the server-window commands
    console.start(sys.modules[__name__])
    _new_console_token()
    yield
    for e in list(_engines.values()):
        stop_engine(e)
    if _http is not None:
        await _http.aclose()


app = FastAPI(title="PINJ hub", docs_url=None, redoc_url=None, openapi_url=None, lifespan=_lifespan)


@app.middleware("http")
async def _activity_feed(request: Request, call_next):
    t0 = time.monotonic()
    try:
        resp = await call_next(request)
    except Exception:
        A.line("—", "✕ SERVER ERROR", f"{request.method} {request.url.path}", "r", client_ip(request))
        raise
    try:
        _show_request(request, resp.status_code, time.monotonic() - t0)
    except Exception:                                      # noqa: BLE001 — the feed must never break a request
        pass
    return resp


def _show_request(request: Request, status: int, secs: float):
    path, method = request.url.path, request.method
    tok = request.cookies.get(COOKIE)
    hit = _session_cache.get(tok) if tok else None        # cache first — a database look-up only when needed
    if hit:
        who = hit[0]["username"]
    elif tok and (A.VERBOSE or path in A.PAGES or method != "GET" or status >= 400):
        u = user_for_token(tok)
        who = u["username"] if u else "(signed out)"
    else:
        who = "—"
    ip = client_ip(request)
    if A.VERBOSE:
        A.line(who, f"{method} {status}", f"{path}  {A.speed(secs * 1000)}",
               "r" if status >= 500 else "y" if status >= 400 else "g" if method != "GET" else "d", ip)
        return
    if status >= 500:
        A.line(who, "✕ SERVER ERROR", f"{method} {path} → HTTP {status}", "r", ip)
        return
    if method == "GET" and path in A.PAGES and status == 200:
        A.line(who, "◇ OPENED", A.PAGES[path] + " · " + A.browser_name(request.headers.get("user-agent", "")), "d", ip)
        return
    if path in AUDITED:                                    # already a line from the activity record
        return
    if method != "GET" and path in A.ENGINE_LABELS:
        A.line(who, A.ENGINE_LABELS[path], "" if status < 400 else f"refused — HTTP {status}", "b" if status < 400 else "y", ip)
        return
    if 400 <= status < 500 and status != 401 and not path.startswith(("/hub/auth/", "/assets/")) and not path.startswith(A.QUIET_GET):
        A.line(who, "! REFUSED", f"{method} {path} → HTTP {status}", "y", ip)


# ═══════════════════════════════════════════════════════════════════════════
# sessions (short in-memory cache in front of the database)
# ═══════════════════════════════════════════════════════════════════════════
_session_cache = {}                                      # token → (user, cached_until)


def _drop_cached(user_id: int = None):
    for tok in [t for t, (u, _) in _session_cache.items() if user_id is None or u["id"] == user_id]:
        _session_cache.pop(tok, None)


def user_for_token(token: str):
    if not token:
        return None
    hit = _session_cache.get(token)
    if hit and hit[1] > time.monotonic():
        return hit[0]
    u = store.session_user(token)
    if u:
        _session_cache[token] = (u, time.monotonic() + 20)
    else:
        _session_cache.pop(token, None)
    return u


def client_ip(request) -> str:
    return request.client.host if request.client else ""


def is_local(request) -> bool:
    """True when the browser runs on the server PC itself (localhost, or this PC's own LAN address)."""
    ip = client_ip(request)
    server = (request.scope.get("server") or ("",))[0]
    return ip in ("127.0.0.1", "::1", "localhost") or (bool(ip) and ip == server)


def require_user(request: Request) -> dict:
    u = user_for_token(request.cookies.get(COOKIE))
    if not u:
        raise HTTPException(401, "Please sign in.")
    return u


def require_admin(request: Request) -> dict:
    u = require_user(request)
    if u["role"] != "admin":
        raise HTTPException(403, "Only an administrator can do this.")
    return u


def _set_cookie(resp: Response, token: str):
    resp.set_cookie(COOKIE, token, max_age=int(U.SESSION_MAX.total_seconds()), httponly=True, samesite="lax", path="/")


_login_tries = collections.defaultdict(collections.deque)   # ip → recent attempt times


def _throttle(ip: str):
    q = _login_tries[ip]
    t = time.monotonic()
    while q and t - q[0] > 300:
        q.popleft()
    if len(q) >= 20:
        raise HTTPException(429, "Too many attempts from this PC — wait a few minutes.")
    q.append(t)


# ═══════════════════════════════════════════════════════════════════════════
# per-user engines
# ═══════════════════════════════════════════════════════════════════════════
class Engine:
    def __init__(self, user, port, token, proc):
        self.user_id, self.username = user["id"], user["username"]
        self.port, self.token, self.proc = port, token, proc
        self.started = U.ts(U.now())
        self.last_used = time.monotonic()
        self.ws_open = 0

    def alive(self) -> bool:
        return self.proc.poll() is None


_engines = {}                                             # user_id → Engine
TX_STATE = {}                                             # user_id → last transmit / listen started (console)
STARTED_AT = time.time()
_engine_locks = collections.defaultdict(asyncio.Lock)
_job = None
_hub_port = int(os.environ.get("PINJ_PORT") or 8080)      # learnt from the first request (engines call back here)


def _note_hub_port(conn):
    global _hub_port
    srv = conn.scope.get("server")
    if srv and srv[1]:
        _hub_port = int(srv[1])


def _windows_job():
    """A Windows job object that kills every engine when the hub process ends (even if killed)."""
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in ("r", "w", "o", "rb", "wb", "ob")]

    class BASIC(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class EXTENDED(ctypes.Structure):
        _fields_ = [("Basic", BASIC), ("Io", IO_COUNTERS), ("ProcessMemoryLimit", ctypes.c_size_t),
                    ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                    ("PeakJobMemoryUsed", ctypes.c_size_t)]

    k32.CreateJobObjectW.restype = wintypes.HANDLE
    k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p]
    k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    job = k32.CreateJobObjectW(None, None)
    info = EXTENDED()
    info.Basic.LimitFlags = 0x2000                       # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info))
    return (k32, job)


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def bench_dirs(username: str):
    bench = os.path.join(DATA_ROOT, "benches", username)
    logs = os.path.join(LOG_ROOT, username)
    os.makedirs(bench, exist_ok=True)
    os.makedirs(logs, exist_ok=True)
    cfg = os.path.join(bench, "serial_config.json")
    if not os.path.isfile(cfg):                           # a new bench starts in SIM_LOOPBACK
        shutil.copyfile(os.path.join(HERE, "serial_config.json"), cfg)
    return bench, logs, cfg


async def ensure_engine(user: dict) -> Engine:
    e = _engines.get(user["id"])
    if e and e.alive():
        e.last_used = time.monotonic()
        return e
    async with _engine_locks[user["id"]]:
        e = _engines.get(user["id"])
        if e and e.alive():
            return e
        bench, logs, cfg = bench_dirs(user["username"])
        port, token = _free_port(), secrets.token_urlsafe(24)
        env = dict(os.environ, PINJ_SERIAL_CFG=cfg, PINJ_LOG_DIR=logs, PINJ_ENGINE_TOKEN=token, PYTHONUNBUFFERED="1",
                   PINJ_HUB_WS=f"ws://127.0.0.1:{_hub_port}/hub/agent/engine")
        flags = 0x08000000 if os.name == "nt" else 0          # CREATE_NO_WINDOW
        proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1",
                                 "--port", str(port), "--log-level", "warning"],
                                cwd=HERE, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=flags)
        threading.Thread(target=_pump_engine_output, args=(proc, os.path.join(bench, "engine.log"), user["username"]),
                         daemon=True, name=f"engine-out-{user['username']}").start()
        if _job:
            try:
                _job[0].AssignProcessToJobObject(_job[1], int(proc._handle))
            except Exception:                                 # noqa: BLE001
                pass
        e = Engine(user, port, token, proc)
        async with httpx.AsyncClient(timeout=2) as c:
            for _ in range(150):                              # up to ~30 s for the first start
                if not e.alive():
                    raise HTTPException(503, f"The PINJ engine for {user['username']} stopped — see {bench}\\engine.log")
                try:
                    r = await c.get(f"http://127.0.0.1:{port}/health", headers={"x-pinj-engine-token": token})
                    if r.status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                await asyncio.sleep(0.2)
            else:
                stop_engine(e)
                raise HTTPException(503, "The PINJ engine did not start in time.")
        _engines[user["id"]] = e
        store.audit(user["username"], "bench_started", f"engine port {port}")
        return e


_ENGINE_ALERT = re.compile(r"error|exception|traceback|failed|fail:|❌|warning|critical", re.I)


def _pump_engine_output(proc, path: str, username: str):
    """A bench's own output: all of it into its engine.log, errors / warnings also into the activity feed."""
    try:
        with open(path, "w", encoding="utf-8") as f:
            for raw in proc.stdout:
                text = raw.decode("utf-8", "replace").rstrip()
                if not text:
                    continue
                f.write(text + "\n")
                f.flush()
                if A.VERBOSE or _ENGINE_ALERT.search(text):
                    bad = re.search(r"error|exception|traceback|failed|❌|critical", text, re.I)
                    A.line(username, "⚠ BENCH " + ("ERROR" if bad else "NOTE"), text[:400], "r" if bad else "y")
    except Exception:                                     # noqa: BLE001 — engine gone
        pass


def stop_engine(e: Engine):
    if e is None:
        return
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(e.proc.pid), "/T", "/F"], capture_output=True, timeout=10)
        else:
            e.proc.terminate()
        e.proc.wait(timeout=10)
    except Exception:                                         # noqa: BLE001
        pass
    if _engines.get(e.user_id) is e:
        _engines.pop(e.user_id, None)
        TX_STATE.pop(e.user_id, None)


# ═══════════════════════════════════════════════════════════════════════════
# hub API — accounts
# ═══════════════════════════════════════════════════════════════════════════
class SignUp(BaseModel):
    username: str
    full_name: str
    password: str
    email: str = ""
    phone: str = ""
    designation: str = ""


class Login(BaseModel):
    username: str
    password: str


class Profile(BaseModel):
    full_name: str
    email: str = ""
    phone: str = ""
    designation: str = ""


class PasswordChange(BaseModel):
    current: str
    new: str


class RoleChange(BaseModel):
    role: str


def _check_fields(username: str, full_name: str, email: str, phone: str, designation: str):
    if not U.USERNAME_RE.match(username):
        raise HTTPException(400, "User name: 3–32 characters — lowercase letters, digits, dot, dash or underscore, "
                                 "starting with a letter or digit.")
    _check_profile(full_name, email, phone, designation)


def _check_profile(full_name: str, email: str, phone: str, designation: str):
    if not (2 <= len(full_name.strip()) <= 100):
        raise HTTPException(400, "Please enter your full name.")
    if email.strip() and not U.EMAIL_RE.match(email.strip()):
        raise HTTPException(400, "The e-mail address does not look right.")
    if len(phone) > 30 or (phone.strip() and not re.match(r"^[0-9+()\-\s]{6,30}$", phone.strip())):
        raise HTTPException(400, "The phone number does not look right.")
    if len(designation) > 100:
        raise HTTPException(400, "Designation is too long.")


@app.get("/health")
def health():
    return {"status": "ok", "service": "PINJ hub", "accounts": store.engine}


@app.get("/hub/auth/state")
def auth_state(request: Request):
    u = user_for_token(request.cookies.get(COOKIE))
    return {"needs_setup": store.user_count() == 0, "local": is_local(request), "user": store.public(u)}


@app.post("/hub/auth/setup")
def auth_setup(body: SignUp, request: Request):
    """First run only: create the administrator — allowed only on the server PC itself."""
    if store.user_count() > 0:
        raise HTTPException(409, "PINJ is already set up — please sign in.")
    if not is_local(request):
        raise HTTPException(403, "The first (administrator) account can only be created on the server PC.")
    username = body.username.strip().lower()
    _check_fields(username, body.full_name, body.email, body.phone, body.designation)
    p = U.password_problem(body.password, username)
    if p:
        raise HTTPException(400, p)
    uid = store.create_user(username, body.full_name, body.password, role="admin", status="active",
                            email=body.email, phone=body.phone, designation=body.designation, approved_by=username)
    store.audit(username, "admin_created", "first administrator", client_ip(request))
    store.x("UPDATE users SET last_login_at=%s, last_login_ip=%s WHERE id=%s", (U.ts(U.now()), client_ip(request), uid))
    token = store.create_session(uid, client_ip(request), request.headers.get("user-agent", ""))
    resp = JSONResponse({"user": store.public(store.get_user(uid))})
    _set_cookie(resp, token)
    return resp


@app.post("/hub/auth/signup")
def auth_signup(body: SignUp, request: Request):
    _throttle(client_ip(request))
    if store.user_count() == 0:
        raise HTTPException(409, "PINJ is not set up yet — the administrator must sign in first on the server PC.")
    username = body.username.strip().lower()
    _check_fields(username, body.full_name, body.email, body.phone, body.designation)
    p = U.password_problem(body.password, username)
    if p:
        raise HTTPException(400, p)
    if store.get_user_by_name(username):
        raise HTTPException(409, "This user name is already taken.")
    store.create_user(username, body.full_name, body.password, role="tester", status="pending",
                      email=body.email, phone=body.phone, designation=body.designation)
    store.audit(username, "signup", body.full_name.strip(), client_ip(request))
    return {"status": "pending", "message": "Account created — it works as soon as the administrator approves it."}


@app.post("/hub/auth/login")
def auth_login(body: Login, request: Request):
    ip = client_ip(request)
    _throttle(ip)
    u, err = store.verify_login(body.username.strip().lower(), body.password, ip)
    if not u:
        store.audit(body.username.strip().lower()[:32], "login_failed", err, ip)
        raise HTTPException(401, err)
    token = store.create_session(u["id"], ip, request.headers.get("user-agent", ""))
    store.audit(u["username"], "login", A.browser_name(request.headers.get("user-agent", "")), ip)
    resp = JSONResponse({"user": store.public(u)})
    _set_cookie(resp, token)
    return resp


@app.post("/hub/auth/logout")
def auth_logout(request: Request):
    token = request.cookies.get(COOKIE)
    u = user_for_token(token)
    store.delete_session(token)
    _session_cache.pop(token, None)
    if u:
        store.audit(u["username"], "logout", "", client_ip(request))
    resp = JSONResponse({"status": "signed_out"})
    resp.delete_cookie(COOKIE, path="/")
    return resp


@app.get("/hub/auth/me")
def auth_me(request: Request):
    return {"user": store.public(require_user(request))}


# ── own profile ───────────────────────────────────────────────────────────────
@app.put("/hub/profile")
def profile_update(body: Profile, request: Request):
    u = require_user(request)
    _check_profile(body.full_name, body.email, body.phone, body.designation)
    store.update_profile(u["id"], body.full_name, body.email, body.phone, body.designation)
    _drop_cached(u["id"])
    store.audit(u["username"], "profile_updated", "", client_ip(request))
    return {"user": store.public(store.get_user(u["id"]))}


@app.post("/hub/profile/password")
def profile_password(body: PasswordChange, request: Request):
    u = require_user(request)
    if not U.check_password(body.current, u["password_hash"]):
        raise HTTPException(400, "The current password is not correct.")
    p = U.password_problem(body.new, u["username"])
    if p:
        raise HTTPException(400, p)
    if body.new == body.current:
        raise HTTPException(400, "The new password must be different from the current one.")
    store.set_password(u["id"], body.new)
    store.delete_user_sessions(u["id"], keep_token=request.cookies.get(COOKIE))   # sign out other PCs
    _drop_cached(u["id"])
    store.audit(u["username"], "password_changed", "", client_ip(request))
    return {"status": "changed"}


def _user_logs(username: str):
    d = os.path.join(LOG_ROOT, username)
    if not os.path.isdir(d):
        return []
    out = []
    for name in os.listdir(d):
        p = os.path.join(d, name)
        if name.lower().endswith(".log") and os.path.isfile(p):
            st = os.stat(p)
            out.append({"name": name, "size": st.st_size, "modified": U.ts(U._dt.datetime.fromtimestamp(st.st_mtime))})
    return sorted(out, key=lambda x: x["modified"], reverse=True)


@app.get("/hub/profile/logs")
def profile_logs(request: Request):
    return {"logs": _user_logs(require_user(request)["username"])}


@app.get("/hub/profile/logs/{name}")
def profile_log_download(name: str, request: Request):
    u = require_user(request)
    if not re.match(r"^[A-Za-z0-9._\- ~]+\.log$", name):
        raise HTTPException(400, "Bad log name.")
    p = os.path.join(LOG_ROOT, u["username"], name)
    if not os.path.isfile(p):
        raise HTTPException(404, "No such log.")
    return FileResponse(p, media_type="text/plain", filename=name)


@app.get("/hub/profile/activity")
def profile_activity(request: Request):
    u = require_user(request)
    return {"activity": store.recent_audit(60, u["username"])}


# ── administrator ─────────────────────────────────────────────────────────────
def _target(user_id: int) -> dict:
    t = store.get_user(user_id)
    if not t:
        raise HTTPException(404, "No such user.")
    return t


def _not_last_admin(admin: dict, target: dict, what: str):
    if target["role"] == "admin" and target["status"] == "active" and store.admin_count() <= 1:
        raise HTTPException(400, f"Cannot {what} the only administrator — make another user administrator first.")


@app.get("/hub/users")
def users_list(request: Request):
    require_admin(request)
    users = store.list_users()
    running = {e.user_id: {"port": e.port, "started": e.started, "ws": e.ws_open} for e in _engines.values() if e.alive()}
    for u in users:
        u["bench"] = running.get(u["id"])
        u["logs"] = len(_user_logs(u["username"]))
        a = _agents.get(u["id"])
        u["agent"] = {"online": True, "hostname": a.hostname, "ports": len(a.ports)} if a else None
    return {"users": users, "storage": store.where(), "engine": store.engine,
            "pending": sum(1 for u in users if u["status"] == "pending")}


def _set_status(user_id: int, request: Request, status: str, action: str, allowed_from: tuple):
    admin = require_admin(request)
    t = _target(user_id)
    if t["status"] not in allowed_from:
        raise HTTPException(400, f"{t['username']} is {t['status']}.")
    if status in ("disabled",):
        if t["id"] == admin["id"]:
            raise HTTPException(400, "You cannot disable your own account.")
        _not_last_admin(admin, t, "disable")
    store.set_status(t["id"], status, by=admin["username"])
    if status != "active":
        store.delete_user_sessions(t["id"])
        _drop_cached(t["id"])
        stop_engine(_engines.get(t["id"]))
        a = _agents.get(t["id"])
        if a and _loop is not None:                      # their modem agent is signed out too
            asyncio.run_coroutine_threadsafe(a.ws.close(code=4401), _loop)
    store.audit(admin["username"], action, t["username"], client_ip(request))
    return {"user": store.public(store.get_user(t["id"]))}


@app.post("/hub/users/{user_id}/approve")
def users_approve(user_id: int, request: Request):
    return _set_status(user_id, request, "active", "user_approved", ("pending", "rejected"))


@app.post("/hub/users/{user_id}/reject")
def users_reject(user_id: int, request: Request):
    return _set_status(user_id, request, "rejected", "user_rejected", ("pending",))


@app.post("/hub/users/{user_id}/disable")
def users_disable(user_id: int, request: Request):
    return _set_status(user_id, request, "disabled", "user_disabled", ("active",))


@app.post("/hub/users/{user_id}/enable")
def users_enable(user_id: int, request: Request):
    return _set_status(user_id, request, "active", "user_enabled", ("disabled",))


@app.post("/hub/users/{user_id}/role")
def users_role(user_id: int, body: RoleChange, request: Request):
    admin = require_admin(request)
    t = _target(user_id)
    if body.role not in U.ROLES:
        raise HTTPException(400, "Role must be admin or tester.")
    if body.role != "admin":
        _not_last_admin(admin, t, "remove administrator rights from")
    store.set_role(t["id"], body.role)
    _drop_cached(t["id"])
    store.audit(admin["username"], "role_changed", f"{t['username']} → {body.role}", client_ip(request))
    return {"user": store.public(store.get_user(t["id"]))}


@app.post("/hub/users/{user_id}/reset_password")
def users_reset_password(user_id: int, request: Request):
    """A one-time temporary password (shown once to the admin); the user must change it at the next sign-in."""
    admin = require_admin(request)
    t = _target(user_id)
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    temp = "".join(secrets.choice(alphabet) for _ in range(10)) + secrets.choice("23456789")
    store.set_password(t["id"], temp, must_change=True)
    store.delete_user_sessions(t["id"])
    _drop_cached(t["id"])
    store.audit(admin["username"], "password_reset", t["username"], client_ip(request))
    return {"temp_password": temp, "username": t["username"]}


@app.post("/hub/users/{user_id}/stop_bench")
def users_stop_bench(user_id: int, request: Request):
    admin = require_admin(request)
    t = _target(user_id)
    stop_engine(_engines.get(t["id"]))
    store.audit(admin["username"], "bench_stopped", t["username"], client_ip(request))
    return {"status": "stopped"}


@app.get("/hub/audit")
def audit_list(request: Request, limit: int = 300):
    require_admin(request)
    return {"activity": store.recent_audit(max(1, min(limit, 2000)))}


# ═══════════════════════════════════════════════════════════════════════════
# forwarding to the user's engine
# ═══════════════════════════════════════════════════════════════════════════
_http = None


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=httpx.Timeout(None, connect=10.0))
    return _http


def _audit_detail(path: str, body: bytes, status: int) -> str:
    try:
        j = json.loads(body or b"{}")
    except ValueError:
        j = {}
    if not isinstance(j, dict):
        j = {}
    parts = []
    if j.get("name"):
        parts.append(str(j["name"]))
    if j.get("radio_id") not in (None, ""):
        parts.append(f"radio {j['radio_id']}")
    if j.get("dest_ip"):
        parts.append(f"to {j['dest_ip']}:{j.get('dest_port', '')}")
    if j.get("tty_device"):
        parts.append(f"port {j['tty_device']}")
    if j.get("baud_rate"):
        parts.append(f"{j['baud_rate']} bps")
    if j.get("tx_mode"):
        parts.append(str(j["tx_mode"]))
    if status >= 400:
        parts.append(f"REFUSED (HTTP {status})")
    return " · ".join(parts)


async def forward(request: Request, path: str):
    _note_hub_port(request)
    user = await run_in_threadpool(user_for_token, request.cookies.get(COOKIE))
    if not user:
        return JSONResponse({"detail": "Please sign in."}, status_code=401)
    if user.get("must_change_password"):
        return JSONResponse({"detail": "Choose your own password first."}, status_code=403)
    eng = await ensure_engine(user)
    eng.last_used = time.monotonic()
    body = await request.body()
    headers = [(k, v) for k, v in request.headers.items() if k.lower() not in HOP and not k.lower().startswith("x-pinj-")]
    headers.append(("x-pinj-engine-token", eng.token))
    headers.append(("x-pinj-user", user["username"]))
    if is_local(request):
        headers.append(("x-pinj-local", "1"))          # the server PC's own COM ports may be used
    try:
        r = await _client().request(request.method, f"http://127.0.0.1:{eng.port}{path}",
                                    params=list(request.query_params.multi_items()), headers=headers, content=body)
    except httpx.HTTPError as e:
        return JSONResponse({"detail": f"Your PINJ engine did not answer ({e.__class__.__name__})."}, status_code=502)
    if path in AUDITED and request.method == "POST":
        detail = _audit_detail(path, body, r.status_code)
        await run_in_threadpool(store.audit, user["username"], AUDITED[path], detail, client_ip(request))
        if r.status_code < 400:                          # for the server console's status / benches
            act = AUDITED[path]
            if act in ("transmit_serial", "listen_serial"):     # (a UDP transmit has finished when it answers)
                TX_STATE[user["id"]] = {"what": act.replace("_", " "), "detail": detail, "since": U.ts(U.now())}
            elif act == "stop_serial":
                TX_STATE.pop(user["id"], None)
    out = Response(content=r.content, status_code=r.status_code)
    for k, v in r.headers.multi_items():
        if k.lower() not in HOP:
            out.headers.append(k, v)
    return out


@app.websocket("/ws/{name}")
async def ws_forward(ws: WebSocket, name: str):
    origin = ws.headers.get("origin")
    if origin and origin.split("//", 1)[-1].rstrip("/") != ws.headers.get("host", ""):
        await ws.close(code=4403)                       # another web site trying to use the session
        return
    _note_hub_port(ws)
    user = await run_in_threadpool(user_for_token, ws.cookies.get(COOKIE))
    if not user or name not in ENGINE_WS or user.get("must_change_password"):
        await ws.close(code=4401)
        return
    await ws.accept()
    eng = None
    try:
        eng = await ensure_engine(user)
        eng.ws_open += 1
        async with websockets.connect(f"ws://127.0.0.1:{eng.port}/ws/{name}", max_size=None, open_timeout=20,
                                      additional_headers={"X-PINJ-Engine-Token": eng.token}) as up:
            async def to_engine():
                while True:
                    m = await ws.receive()
                    if m["type"] == "websocket.disconnect":
                        return
                    if m.get("text") is not None:
                        await up.send(m["text"])
                    elif m.get("bytes") is not None:
                        await up.send(m["bytes"])

            async def to_browser():
                async for m in up:
                    if isinstance(m, str):
                        await ws.send_text(m)
                    else:
                        await ws.send_bytes(m)

            tasks = [asyncio.create_task(to_engine()), asyncio.create_task(to_browser())]
            _done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
    except Exception:                                    # noqa: BLE001 — engine gone / browser gone
        pass
    finally:
        if eng:
            eng.ws_open = max(0, eng.ws_open - 1)
        try:
            await ws.close()
        except Exception:                                # noqa: BLE001
            pass


# ═══════════════════════════════════════════════════════════════════════════
# 📂 shared input-file library — folders on the server PC, listed to every signed-in user
# ═══════════════════════════════════════════════════════════════════════════
LIBRARY_FILE = os.path.join(DATA_ROOT, "library.json")
_XL = [".xlsx", ".xlsm", ".xls"]
LIBRARY_DEFAULTS = [
    {"id": "apd", "label": "APD files", "path": r"C:\Users\Vinoth\Documents\VINOTH\Felix\APD FOR PINJ", "exts": _XL},
    {"id": "ma", "label": "MA tables", "path": r"C:\Users\Vinoth\Documents\VINOTH\Suresh Sir\MA TABLES", "exts": _XL},
    {"id": "tag", "label": "RFID tag files", "path": r"C:\Users\Vinoth\Documents\VINOTH\Felix\TAG", "exts": _XL + [".csv"]},
    {"id": "svk_story", "label": "SVK storyboards", "path": r"C:\Users\Vinoth\Documents\VINOTH\StoryBoard\NOVA\SKP\SVK STORY",
     "exts": [".csv", ".txt"] + _XL},
    {"id": "ovk_story", "label": "OVK storyboards", "path": r"C:\Users\Vinoth\Documents\VINOTH\StoryBoard\NOVA\SKP\OVK STORY",
     "exts": [".csv", ".txt"] + _XL},
]


def library_config() -> list:
    cats = [dict(c) for c in LIBRARY_DEFAULTS]
    try:
        with open(LIBRARY_FILE, encoding="utf-8") as f:
            saved = {c["id"]: c for c in json.load(f).get("categories", [])}
        for c in cats:
            if c["id"] in saved and isinstance(saved[c["id"]].get("path"), str):
                c["path"] = saved[c["id"]]["path"]
    except (OSError, ValueError):
        pass
    return cats


def _library_cat(cat_id: str) -> dict:
    for c in library_config():
        if c["id"] == cat_id:
            return c
    raise HTTPException(404, "No such library folder.")


def _library_path(cat: dict, rel: str) -> str:
    root = os.path.realpath(cat["path"])
    target = os.path.realpath(os.path.join(root, rel or ""))
    if target != root and not target.startswith(root + os.sep):
        raise HTTPException(400, "Outside the library folder.")
    return target


@app.get("/hub/library")
def library_list(request: Request):
    u = require_user(request)
    out = []
    for c in library_config():
        item = {"id": c["id"], "label": c["label"], "exts": c["exts"], "available": os.path.isdir(c["path"])}
        if u["role"] == "admin":
            item["path"] = c["path"]
        out.append(item)
    return {"categories": out}


@app.get("/hub/library/{cat_id}")
def library_folder(cat_id: str, request: Request, sub: str = ""):
    require_user(request)
    cat = _library_cat(cat_id)
    if not os.path.isdir(cat["path"]):
        raise HTTPException(404, f"The {cat['label']} folder is not available on the PINJ server.")
    folder = _library_path(cat, sub)
    if not os.path.isdir(folder):
        raise HTTPException(404, "No such folder.")
    entries = []
    for name in os.listdir(folder):
        if name.startswith(("~$", ".")):                      # Excel lock files, hidden files
            continue
        p = os.path.join(folder, name)
        try:
            st = os.stat(p)
        except OSError:
            continue
        if os.path.isdir(p):
            entries.append({"name": name, "dir": True, "modified": U.ts(U._dt.datetime.fromtimestamp(st.st_mtime))})
        elif os.path.splitext(name)[1].lower() in cat["exts"]:
            entries.append({"name": name, "dir": False, "size": st.st_size,
                            "modified": U.ts(U._dt.datetime.fromtimestamp(st.st_mtime))})
    entries.sort(key=lambda e: (not e["dir"], e["name"].lower()))
    rel = os.path.relpath(folder, os.path.realpath(cat["path"]))
    return {"id": cat["id"], "label": cat["label"], "sub": "" if rel == "." else rel.replace(os.sep, "/"), "entries": entries}


@app.get("/hub/library/{cat_id}/file")
def library_file(cat_id: str, request: Request, path: str):
    u = require_user(request)
    cat = _library_cat(cat_id)
    p = _library_path(cat, path)
    if not os.path.isfile(p) or os.path.splitext(p)[1].lower() not in cat["exts"]:
        raise HTTPException(404, "No such file.")
    store.audit(u["username"], "library_file", f"{cat['label']}: {path}"[:500], client_ip(request))
    return FileResponse(p, filename=os.path.basename(p), media_type="application/octet-stream")


class LibraryPaths(BaseModel):
    paths: dict


@app.put("/hub/library")
def library_save(body: LibraryPaths, request: Request):
    admin = require_admin(request)
    ids = {c["id"] for c in LIBRARY_DEFAULTS}
    current = {c["id"]: c["path"] for c in library_config()}
    for k, v in body.paths.items():
        if k in ids and isinstance(v, str) and v.strip():
            current[k] = v.strip().strip('"')
    os.makedirs(DATA_ROOT, exist_ok=True)
    with open(LIBRARY_FILE, "w", encoding="utf-8") as f:
        json.dump({"categories": [{"id": k, "path": v} for k, v in current.items()]}, f, indent=2)
    store.audit(admin["username"], "library_changed", "; ".join(f"{k}={v}" for k, v in current.items())[:500],
                client_ip(request))
    return library_list(request)


# ═══════════════════════════════════════════════════════════════════════════
# 👤 MY FILES — each user's own input files (MA tables, APD, tags, storyboards) kept on the server
#   data/user_files/<user>/<library id>/<file>. Only that user sees them. "Remove" moves a file to
#   data/user_files/<user>/_removed/ (an administrator can still recover it).
# ═══════════════════════════════════════════════════════════════════════════
USER_FILES_ROOT = os.path.join(DATA_ROOT, "user_files")
MAX_USER_FILE = 25 * 1024 * 1024
_SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._()\-,&+#@~\[\]]{0,150}$")


def _my_dir(username: str, cat_id: str) -> str:
    _library_cat(cat_id)                                  # 404 for unknown ids
    return os.path.join(USER_FILES_ROOT, username, cat_id)


def _my_file(username: str, cat_id: str, name: str) -> str:
    cat = _library_cat(cat_id)
    name = os.path.basename(name or "").strip()
    if not _SAFE_NAME.match(name) or name.startswith("~$"):
        raise HTTPException(400, "Use a simple file name (letters, digits, space, . _ - ( )).")
    if os.path.splitext(name)[1].lower() not in cat["exts"]:
        raise HTTPException(400, f"{cat['label']}: only {', '.join(cat['exts'])} files.")
    return os.path.join(_my_dir(username, cat_id), name)


@app.get("/hub/myfiles/{cat_id}")
def myfiles_list(cat_id: str, request: Request):
    u = require_user(request)
    cat = _library_cat(cat_id)
    d = _my_dir(u["username"], cat_id)
    entries = []
    if os.path.isdir(d):
        for name in os.listdir(d):
            p = os.path.join(d, name)
            if os.path.isfile(p) and os.path.splitext(name)[1].lower() in cat["exts"]:
                st = os.stat(p)
                entries.append({"name": name, "dir": False, "size": st.st_size,
                                "modified": U.ts(U._dt.datetime.fromtimestamp(st.st_mtime))})
    entries.sort(key=lambda e: e["modified"], reverse=True)
    return {"id": cat_id, "label": cat["label"], "sub": "", "entries": entries, "exts": cat["exts"]}


@app.post("/hub/myfiles/{cat_id}")
async def myfiles_upload(cat_id: str, request: Request):
    u = await run_in_threadpool(require_user, request)
    form = await request.form()
    up = form.get("file")
    if up is None or not getattr(up, "filename", ""):
        raise HTTPException(400, "No file.")
    path = _my_file(u["username"], cat_id, up.filename)
    data = await up.read(MAX_USER_FILE + 1)
    if len(data) > MAX_USER_FILE:
        raise HTTPException(413, "The file is larger than 25 MB.")
    if not data:
        raise HTTPException(400, "The file is empty.")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    replaced = os.path.isfile(path)
    tmp = path + ".uploading"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)                                  # same name = the newer file replaces the old one
    await run_in_threadpool(store.audit, u["username"], "myfile_uploaded",
                            f"{cat_id}: {os.path.basename(path)} ({len(data)} B){' — replaced' if replaced else ''}",
                            client_ip(request))
    return {"status": "saved", "name": os.path.basename(path), "size": len(data), "replaced": replaced}


@app.get("/hub/myfiles/{cat_id}/file")
def myfiles_get(cat_id: str, name: str, request: Request):
    u = require_user(request)
    p = _my_file(u["username"], cat_id, name)
    if not os.path.isfile(p):
        raise HTTPException(404, "No such file in your files.")
    return FileResponse(p, filename=os.path.basename(p), media_type="application/octet-stream")


@app.delete("/hub/myfiles/{cat_id}/file")
def myfiles_remove(cat_id: str, name: str, request: Request):
    u = require_user(request)
    p = _my_file(u["username"], cat_id, name)
    if not os.path.isfile(p):
        raise HTTPException(404, "No such file in your files.")
    bin_dir = os.path.join(USER_FILES_ROOT, u["username"], "_removed", cat_id)
    os.makedirs(bin_dir, exist_ok=True)
    stamp = U.now().strftime("%Y%m%d_%H%M%S")
    shutil.move(p, os.path.join(bin_dir, f"{stamp}_{os.path.basename(p)}"))
    store.audit(u["username"], "myfile_removed", f"{cat_id}: {os.path.basename(p)}", client_ip(request))
    return {"status": "removed"}


# ═══════════════════════════════════════════════════════════════════════════
# 📡 PINJ Modem Agent — runs on each tester's own PC, next to their modem
#   agent  ──ws /hub/agent/connect (agent key)──▶  hub  ◀──ws /hub/agent/engine (engine token)──  user's engine
#   The engine opens the user's modem through the agent: open / write / flush / rts / close go out,
#   rx / flushed / opened come back. One modem (one agent) per user. Finished test logs are also saved
#   on the tester's PC by the agent.
# ═══════════════════════════════════════════════════════════════════════════
AGENT_VERSION = "1.0"


class AgentConn:
    def __init__(self, ws: WebSocket, user: dict, ip: str):
        self.ws, self.user, self.ip = ws, user, ip
        self.hostname, self.version, self.log_dir = "", "", ""
        self.ports = []
        self.connected_at = U.ts(U.now())
        self.lock = asyncio.Lock()

    async def send(self, msg: dict):
        async with self.lock:
            await self.ws.send_text(json.dumps(msg))

    def public(self) -> dict:
        return {"online": True, "hostname": self.hostname, "version": self.version, "ports": self.ports,
                "log_dir": self.log_dir, "ip": self.ip, "connected_at": self.connected_at}


_agents = {}                                              # user_id → AgentConn
_engine_links = {}                                        # user_id → (WebSocket, lock) of that user's engine


async def _to_engine(user_id: int, msg: dict):
    link = _engine_links.get(user_id)
    if not link:
        return
    try:
        async with link[1]:
            await link[0].send_text(json.dumps(msg))
    except Exception:                                    # noqa: BLE001 — engine went away
        pass


def agent_status(user_id: int) -> dict:
    a = _agents.get(user_id)
    info = store.agent_info(user_id) or {}
    out = a.public() if a else {"online": False}
    out["key_created"] = info.get("created_at")
    out["last_seen"] = info.get("last_seen_at")
    out["last_hostname"] = info.get("hostname")
    return out


@app.websocket("/hub/agent/connect")
async def agent_connect(ws: WebSocket):
    user = await run_in_threadpool(store.agent_key_user, ws.headers.get("x-pinj-agent-key", ""))
    if not user:
        await ws.close(code=4401)
        return
    await ws.accept()
    ip = client_ip(ws)
    me = AgentConn(ws, user, ip)
    old = _agents.get(user["id"])
    if old:
        try:
            await old.send({"op": "replaced", "by": ip})
            await old.ws.close(code=4409)
        except Exception:                                # noqa: BLE001
            pass
        await _to_engine(user["id"], {"op": "agent_gone"})
    _agents[user["id"]] = me
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            op = msg.get("op")
            if op == "hello":
                me.hostname = str(msg.get("hostname", ""))[:100]
                me.version = str(msg.get("version", ""))[:20]
                me.log_dir = str(msg.get("log_dir", ""))[:300]
                me.ports = msg.get("ports") or []
                await run_in_threadpool(store.agent_seen, user["id"], ip, me.hostname)
                await run_in_threadpool(store.audit, user["username"], "agent_connected",
                                        f"{me.hostname} · {len(me.ports)} port(s)", ip)
                await me.send({"op": "welcome", "user": user["username"], "full_name": user["full_name"],
                               "server_version": AGENT_VERSION})
            elif op == "ports":
                me.ports = msg.get("ports") or []
            elif op in ("opened", "rx", "flushed", "error", "closed", "log_saved"):
                await _to_engine(user["id"], msg)
    except Exception:                                    # noqa: BLE001 — agent disconnected
        pass
    finally:
        if _agents.get(user["id"]) is me:
            _agents.pop(user["id"], None)
            await _to_engine(user["id"], {"op": "agent_gone"})
            await run_in_threadpool(store.audit, user["username"], "agent_disconnected", me.hostname, ip)


@app.websocket("/hub/agent/engine")
async def agent_engine_link(ws: WebSocket):
    """The channel a user's engine uses to reach that user's agent (127.0.0.1 + engine token only)."""
    token = ws.headers.get("x-pinj-engine-token", "")
    eng = next((e for e in _engines.values() if e.alive() and secrets.compare_digest(e.token, token)), None)
    if client_ip(ws) not in ("127.0.0.1", "::1") or not eng:
        await ws.close(code=4403)
        return
    await ws.accept()
    uid = eng.user_id
    link = (ws, asyncio.Lock())
    _engine_links[uid] = link
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            op = msg.get("op")
            a = _agents.get(uid)
            if op == "ports":
                await _to_engine(uid, {"op": "ports", "req": msg.get("req"), **(a.public() if a else {"online": False})})
            elif a is None:
                if op == "open":
                    await _to_engine(uid, {"op": "opened", "h": msg.get("h"), "ok": False,
                                           "msg": "your PINJ Modem Agent is not running on your PC"})
                elif op in ("write", "flush"):
                    await _to_engine(uid, {"op": "error", "h": msg.get("h"), "msg": "PINJ Modem Agent disconnected"})
            else:
                try:
                    await a.send(msg)
                except Exception:                        # noqa: BLE001
                    await _to_engine(uid, {"op": "error", "h": msg.get("h"), "msg": "PINJ Modem Agent disconnected"})
    except Exception:                                    # noqa: BLE001
        pass
    finally:
        if _engine_links.get(uid) is link:
            _engine_links.pop(uid, None)
        a = _agents.get(uid)
        if a:                                            # engine gone → fail-safe: agent drops PTT, closes ports
            try:
                await a.send({"op": "close_all"})
            except Exception:                            # noqa: BLE001
                pass


# ═══════════════════════════════════════════════════════════════════════════
# PINJ Monitor (monitor.py, same PC) → server-window commands (console.py), answers sent back
# ═══════════════════════════════════════════════════════════════════════════
CONSOLE_TOKEN_FILE = os.path.join(DATA_ROOT, "console_token")
_console_token = None


def _new_console_token():
    global _console_token
    _console_token = secrets.token_urlsafe(24)
    try:
        os.makedirs(DATA_ROOT, exist_ok=True)
        with open(CONSOLE_TOKEN_FILE, "w", encoding="utf-8") as f:
            json.dump({"token": _console_token, "port": _hub_port}, f)
    except OSError:
        pass


class ConsoleCommand(BaseModel):
    command: str


@app.post("/hub/console/run")
def console_run(body: ConsoleCommand, request: Request):
    """Only from this PC, only with the token written at start-up (data/console_token)."""
    sent = request.headers.get("x-pinj-console-token", "")
    if client_ip(request) not in ("127.0.0.1", "::1") or not _console_token or not secrets.compare_digest(sent, _console_token):
        raise HTTPException(403, "Server commands can only be run from the PINJ Monitor on the server PC.")
    import console                                       # noqa: PLC0415
    A.capture_start()
    try:
        console.run(body.command.strip()[:300])
    except Exception as e:                               # noqa: BLE001
        A.say(f"  ✕ {e}", "r")
    finally:
        lines = A.capture_end()
    return {"lines": lines}


@app.get("/hub/agent/status")
def agent_status_api(request: Request):
    u = require_user(request)
    return agent_status(u["id"])


@app.post("/hub/agent/revoke")
async def agent_revoke(request: Request):
    u = await run_in_threadpool(require_user, request)
    await run_in_threadpool(store.delete_agent_key, u["id"])
    a = _agents.pop(u["id"], None)
    if a:
        try:
            await a.send({"op": "revoked"})
            await a.ws.close(code=4401)
        except Exception:                                # noqa: BLE001
            pass
        await _to_engine(u["id"], {"op": "agent_gone"})
    await run_in_threadpool(store.audit, u["username"], "agent_revoked", "", client_ip(request))
    return {"status": "revoked"}


AGENT_DIR = os.path.join(PROJECT, "agent")


def _agent_zip(server_url: str, key: str, username: str) -> bytes:
    import io
    import zipfile
    buf = io.BytesIO()
    site = os.path.dirname(os.path.dirname(httpx.__file__))          # .venv site-packages
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name in ("pinj_agent.py", "PINJ_AGENT.bat", "README_AGENT.txt"):
            z.write(os.path.join(AGENT_DIR, name), f"PINJ_Agent/{name}")
        z.writestr("PINJ_Agent/agent_config.json", json.dumps({
            "server": server_url, "user": username, "key": key,
            "log_dir": "", "_note": "Personal key of " + username + " — do not share. log_dir empty = Documents\\PINJ\\logs",
        }, indent=2))
        for pkg in ("serial", "websockets"):                          # pure-Python copies: no pip / internet needed
            root = os.path.join(site, pkg)
            for d, dirs, files in os.walk(root):
                dirs[:] = [x for x in dirs if x != "__pycache__"]
                for fn in files:
                    if fn.endswith((".py", ".typed")):
                        full = os.path.join(d, fn)
                        z.write(full, "PINJ_Agent/lib/" + os.path.relpath(full, site).replace(os.sep, "/"))
    return buf.getvalue()


@app.get("/hub/agent/download")
def agent_download(request: Request):
    """The PINJ Modem Agent for this user's PC, with a fresh personal key (the old key stops working)."""
    u = require_user(request)
    key = store.new_agent_key(u["id"])
    server = f"{request.url.scheme}://{request.headers.get('host', 'localhost:8080')}"
    data = _agent_zip(server, key, u["username"])
    store.audit(u["username"], "agent_downloaded", server, client_ip(request))
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="PINJ_Agent_{u["username"]}.zip"'})


# ═══════════════════════════════════════════════════════════════════════════
# pages + forwarding (registered last)
# ═══════════════════════════════════════════════════════════════════════════
@app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"], include_in_schema=False)
async def pages_or_engine(full_path: str, request: Request):
    path = "/" + full_path
    if path.startswith(ENGINE_PREFIXES):
        return await forward(request, path)
    if path.startswith("/hub/") or request.method != "GET":
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    index = os.path.join(DIST_DIR, "index.html")
    if not os.path.isfile(index):
        return JSONResponse({"detail": "PINJ pages are not built yet: run START_PINJ.bat "
                                       "(or `npm run build` in frontend/)."}, status_code=503)
    if full_path:
        root = os.path.realpath(DIST_DIR)
        target = os.path.realpath(os.path.join(root, full_path))
        if target.startswith(root + os.sep) and os.path.isfile(target):
            return FileResponse(target)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})
