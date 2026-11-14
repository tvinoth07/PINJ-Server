"""
console.py — commands typed into the PINJ server window (START_PINJ.bat), while PINJ keeps running.

Type a command and press Enter. Whoever sits at the server PC is trusted like an administrator; actions taken
here (approve, unlock, stop, kick) are written to the activity record as user "console".

    help                  this list
    who                   who is online now (signed in, seen in the last 15 min): name, role, PC, browser
    status                server overview: addresses, uptime, users online, benches, transmitting, agents, storage
    benches               every running bench: port, since, live connections, transmitting / idle
    agents                connected PINJ Modem Agents: user, PC, COM ports
    pending               account requests waiting for approval
    approve <user>        approve a waiting account
    unlock <user>         clear a lock-out after too many wrong passwords
    stop <user>           stop a user's bench (ends their transmit / listen)
    kick <user>           sign a user out everywhere and disconnect their modem agent
    today                 today's summary: sign-ins, failures, transmits per user, lock-outs
    last [user] [n]       recent activity from the database (default 20 lines)
    watch <user> [user…]  show only these users' lines in the feed ("watch off" = everybody again)
    pause / resume        freeze the feed to read it; held lines are shown on resume
    verbose on|off        every request (polls too) and every bench line — live, no restart
    beep on|off           beep on serious events (lock-outs, server errors, bench crashes) — on by default, remembered
    monitor               open the PINJ Monitor window: one panel per user, 3 per row
    logs                  open the activity log folder
    clear                 clear the window
"""
import asyncio
import datetime as _dt
import json
import os
import platform
import socket
import sys
import threading
import time

import activity as A

H = None                                               # the hub module (hub.py), set by start()
ONLINE_MIN = 15


def start(hub_module):
    """Read commands from the server window (only when it is a real console)."""
    global H
    H = hub_module
    _load_settings()
    A.banner(f"  beep {'ON' if A.BEEP else 'off'} for lock-outs, server errors and bench crashes "
             f"(type  beep {'off' if A.BEEP else 'on'}  to change — remembered)")
    A.banner("")
    try:
        if not sys.stdin or not sys.stdin.isatty():
            return
    except Exception:                                  # noqa: BLE001
        return
    threading.Thread(target=_loop, daemon=True, name="pinj-console").start()


def _loop():
    while True:
        try:
            raw = sys.stdin.readline()
        except Exception:                              # noqa: BLE001
            return
        if raw == "":                                  # console closed
            return
        cmd = raw.strip()
        if not cmd:
            continue
        try:
            run(cmd)
        except Exception as e:                         # noqa: BLE001 — a typo must never stop the server
            A.say(f"  ✕ {e}", "r")


# ── helpers ─────────────────────────────────────────────────────────────────────────────
def _h(title: str):
    A.say("")
    A.say(f"  ── {title} " + "─" * max(4, 60 - len(title)), "g")


def _row(*cols, colour="w"):
    A.say("  " + "  ".join(str(c) for c in cols), colour)


def _user(name: str):
    u = H.store.get_user_by_name(name or "")
    if not u:
        raise ValueError(f"no user '{name}' (see: who / pending)")
    return u


def _ago(ts_text) -> str:
    try:
        t = H.U.parse_ts(ts_text)
        s = int((H.U.now() - t).total_seconds())
    except Exception:                                  # noqa: BLE001
        return str(ts_text or "—")
    if s < 60:
        return f"{s}s ago"
    if s < 3600:
        return f"{s // 60}m ago"
    return f"{s // 3600}h{(s % 3600) // 60:02d}m ago"


def _lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def _online():
    since = H.U.ts(H.U.now() - _dt.timedelta(minutes=ONLINE_MIN))
    return H.store.q(
        "SELECT u.username, u.full_name, u.role, s.ip, s.user_agent, s.last_seen_at FROM sessions s "
        "JOIN users u ON u.id = s.user_id WHERE s.last_seen_at >= %s AND u.status = 'active' ORDER BY s.last_seen_at DESC",
        (since,))


def _close_agent(user_id: int):
    a = H._agents.get(user_id)
    if a and H._loop is not None:
        asyncio.run_coroutine_threadsafe(a.ws.close(code=4401), H._loop)


# ── commands ────────────────────────────────────────────────────────────────────────────
def run(line: str):
    parts = line.split()
    cmd, args = parts[0].lower(), parts[1:]
    fn = COMMANDS.get(cmd)
    if not fn:
        A.say(f"  ? unknown command '{cmd}' — type help", "y")
        return
    fn(args)


def c_help(_):
    _h("PINJ SERVER COMMANDS (type + Enter)")
    for ln in (__doc__ or "").splitlines():
        if ln.startswith("    ") and ln.strip():
            name, _, rest = ln.strip().partition("  ")
            A.say(f"  {A._C['c']}{name:<22}{A._C['x']} {rest.strip()}")
    A.say("")


def c_who(_):
    rows = _online()
    _h(f"ONLINE NOW · seen in the last {ONLINE_MIN} min · {len({r['username'] for r in rows})} user(s)")
    if not rows:
        _row("nobody signed in right now", colour="d")
    seen = set()
    for r in rows:
        key = (r["username"], r["ip"])
        if key in seen:
            continue
        seen.add(key)
        bench = "bench ●" if any(e.username == r["username"] and e.alive() for e in H._engines.values()) else "       "
        A.say(f"  {A.user_colour(r['username'])}{r['username']:<12}{A._C['x']} {r['full_name'][:22]:<22} "
              f"{r['role']:<7} {r['ip']:<15} {A.browser_name(r['user_agent']):<8} {bench}  "
              f"{A._C['d']}last seen {_ago(r['last_seen_at'])}{A._C['x']}")
    A.say("")


def c_status(_):
    up = int(time.time() - H.STARTED_AT)
    port = H._hub_port
    benches = [e for e in H._engines.values() if e.alive()]
    online = {r["username"] for r in _online()}
    pending = [u for u in H.store.list_users() if u["status"] == "pending"]
    _h("PINJ SERVER STATUS")
    _row(f"this PC        http://localhost:{port}    ·    other PCs  http://{_lan_ip()}:{port}"
         f"    ·    http://{platform.node().lower()}:{port}")
    _row(f"up for         {up // 3600}h {(up % 3600) // 60:02d}m        verbose {'ON' if A.VERBOSE else 'off'}"
         f"    beep {'ON' if A.BEEP else 'off'}    watch {', '.join(sorted(A.WATCH)) or 'everybody'}"
         f"    feed {'PAUSED' if A.PAUSED else 'live'}")
    _row(f"online         {len(online)} user(s): {', '.join(sorted(online)) or '—'}")
    _row(f"benches        {len(benches)} running: {', '.join(e.username for e in benches) or '—'}")
    tx = [f"{H.store.get_user(uid)['username']} ({s['what']})" for uid, s in H.TX_STATE.items() if uid in H._engines]
    _row(f"transmitting   {', '.join(tx) or '—'}", colour="m" if tx else "w")
    agents = ", ".join(a.user["username"] + "@" + a.hostname for a in H._agents.values())
    _row(f"modem agents   {len(H._agents)}: {agents or '—'}")
    _row(f"waiting        {len(pending)} account request(s){': ' + ', '.join(u['username'] for u in pending) if pending else ''}",
         colour="y" if pending else "w")
    _row(f"accounts       {H.store.where()}")
    _row(f"activity log   {os.path.join(H.LOG_ROOT, 'server')}")
    A.say("")


def c_benches(_):
    benches = [e for e in H._engines.values() if e.alive()]
    _h(f"BENCHES · {len(benches)} running")
    if not benches:
        _row("no bench running — a bench starts with a user's first PINJ action", colour="d")
    for e in benches:
        s = H.TX_STATE.get(e.user_id)
        state = f"{A._C['m']}▶ {s['what']} since {s['since'][11:16]} · {s['detail']}{A._C['x']}" if s else f"{A._C['d']}idle{A._C['x']}"
        A.say(f"  {A.user_colour(e.username)}{e.username:<12}{A._C['x']} port {e.port:<6} since {e.started[11:16]}  "
              f"live connections {e.ws_open:<2}  {state}")
    A.say("")


def c_agents(_):
    _h(f"MODEM AGENTS · {len(H._agents)} connected")
    if not H._agents:
        _row("no PINJ Modem Agent connected", colour="d")
    for a in H._agents.values():
        ports = ", ".join(p.get("device", "?") for p in a.ports) or "no COM port"
        A.say(f"  {A.user_colour(a.user['username'])}{a.user['username']:<12}{A._C['x']} {a.hostname:<18} {a.ip:<15} "
              f"since {a.connected_at[11:16]}  ports: {ports}  logs → {a.log_dir}")
    A.say("")


def c_pending(_):
    pend = [u for u in H.store.list_users() if u["status"] == "pending"]
    _h(f"ACCOUNT REQUESTS · {len(pend)} waiting")
    if not pend:
        _row("nothing waiting", colour="d")
    for u in pend:
        _row(f"{u['username']:<14} {u['full_name'][:24]:<24} {u['designation'][:20]:<20} requested {u['created_at']}"
             f"   → approve {u['username']}", colour="y")
    A.say("")


def c_approve(args):
    if not args:
        raise ValueError("usage: approve <user name>")
    u = _user(args[0])
    if u["status"] == "active":
        A.say(f"  {u['username']} is already active", "d")
        return
    H.store.set_status(u["id"], "active", by="console")
    H.store.audit("console", "user_approved", u["username"], "server PC")
    A.say(f"  ✓ {u['username']} approved — they can sign in now", "g")


def c_unlock(args):
    if not args:
        raise ValueError("usage: unlock <user name>")
    u = _user(args[0])
    H.store.x("UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=%s", (u["id"],))
    H.store.audit("console", "user_unlocked", u["username"], "server PC")
    A.say(f"  ✓ {u['username']} unlocked — they can try their password again", "g")


def c_stop(args):
    if not args:
        raise ValueError("usage: stop <user name>")
    u = _user(args[0])
    e = H._engines.get(u["id"])
    if not e:
        A.say(f"  {u['username']} has no bench running", "d")
        return
    H.stop_engine(e)
    H.store.audit("console", "bench_stopped", u["username"], "server PC")
    A.say(f"  ■ {u['username']}'s bench stopped", "y")


def c_kick(args):
    if not args:
        raise ValueError("usage: kick <user name>")
    u = _user(args[0])
    H.store.delete_user_sessions(u["id"])
    H._drop_cached(u["id"])
    _close_agent(u["id"])
    H.stop_engine(H._engines.get(u["id"]))
    H.store.audit("console", "user_kicked", u["username"], "server PC")
    A.say(f"  ⏏ {u['username']} signed out everywhere (bench stopped, agent disconnected) — they can sign in again", "y")


def c_today(_):
    start = H.U.ts(H.U.now().replace(hour=0, minute=0, second=0))
    rows = H.store.q("SELECT username, action FROM audit_log WHERE ts >= %s", (start,))
    count = {}
    per_user = {}
    for r in rows:
        count[r["action"]] = count.get(r["action"], 0) + 1
        if r["action"] in ("transmit_serial", "transmit_udp", "listen_serial", "login"):
            d = per_user.setdefault(r["username"], {"login": 0, "tx": 0})
            d["login" if r["action"] == "login" else "tx"] += 1
    _h(f"TODAY · {H.U.now():%d %b %Y} · {len(rows)} recorded actions")
    _row(f"sign-ins {count.get('login', 0)}    failed {count.get('login_failed', 0)}    "
         f"lock-outs {count.get('account_locked', 0)}    requests {count.get('signup', 0)}    approvals {count.get('user_approved', 0)}")
    _row(f"serial transmits {count.get('transmit_serial', 0)}    UDP transmits {count.get('transmit_udp', 0)}    "
         f"listens {count.get('listen_serial', 0)}    stops {count.get('stop_serial', 0)}    "
         f"library loads {count.get('library_file', 0)}    my-file uploads {count.get('myfile_uploaded', 0)}")
    for name, d in sorted(per_user.items(), key=lambda kv: -kv[1]["tx"]):
        A.say(f"    {A.user_colour(name)}{name:<12}{A._C['x']} sign-ins {d['login']:<3} transmits / listens {d['tx']}")
    A.say("")


def c_last(args):
    user, n = None, 20
    for a in args:
        if a.isdigit():
            n = max(1, min(int(a), 500))
        else:
            user = a.lower()
    rows = H.store.recent_audit(n, user)
    _h(f"LAST {n} ACTIONS{' OF ' + user if user else ''}")
    for r in reversed(rows):
        label, colour = A.AUDIT_LABELS.get(r["action"], (r["action"].upper(), "w"))
        A.say(f"  {A._C['d']}{str(r['ts'])[5:16]}{A._C['x']}  {A.user_colour(r['username'])}{r['username'][:12]:<12}{A._C['x']} "
              f"{A._C.get(colour, '')}{label:<26}{A._C['x']} {r['detail'][:80]}  {A._C['d']}{r['ip']}{A._C['x']}")
    A.say("")


def c_watch(args):
    if not args or args[0].lower() in ("off", "all", "everybody"):
        A.WATCH.clear()
        A.say("  feed: everybody", "g")
    else:
        A.WATCH.clear()
        A.WATCH.update(a.lower() for a in args)
        A.say(f"  feed: only {', '.join(sorted(A.WATCH))}  (the log file still gets everything · 'watch off' to undo)", "g")


def c_pause(_):
    A.pause()
    A.say("  feed paused — new lines are held · type resume", "y")


def c_resume(_):
    n = A.resume()
    A.say(f"  feed live again ({n} held line(s) shown above)", "g")


def c_verbose(args):
    A.VERBOSE = not args or args[0].lower() in ("on", "1", "yes")
    A.say(f"  verbose {'ON — every request and every bench line' if A.VERBOSE else 'off'}", "g")


def c_beep(args):
    if not args:
        A.say(f"  beep is {'ON' if A.BEEP else 'off'} — type  beep on  or  beep off  (remembered after a restart)", "g")
        return
    A.BEEP = args[0].lower() in ("on", "1", "yes")
    _save_settings()
    A.say(f"  beep {'ON — lock-outs, server errors and bench crashes beep' if A.BEEP else 'off'}"
          "  (remembered after a restart)", "g")


# ── settings kept across restarts (data/console_settings.json) ─────────────────────────
def _settings_path() -> str:
    return os.path.join(H.DATA_ROOT, "console_settings.json")


def _load_settings():
    """Beep is ON unless it was switched off here before."""
    A.BEEP = True
    try:
        with open(_settings_path(), encoding="utf-8") as f:
            A.BEEP = bool(json.load(f).get("beep", True))
    except (OSError, ValueError):
        pass


def _save_settings():
    try:
        os.makedirs(H.DATA_ROOT, exist_ok=True)
        with open(_settings_path(), "w", encoding="utf-8") as f:
            json.dump({"beep": A.BEEP}, f)
    except OSError:
        pass


def c_monitor(args):
    bat = os.path.join(H.PROJECT, "PINJ_MONITOR.bat")
    if not os.path.isfile(bat):
        raise ValueError(f"{bat} is missing")
    import subprocess                                  # noqa: PLC0415
    subprocess.Popen(["cmd", "/c", "start", "PINJ monitor", bat] + list(args), cwd=H.PROJECT)
    A.say("  PINJ Monitor opened in its own window (one panel per user) — close it any time", "g")


def c_logs(_):
    path = os.path.join(H.LOG_ROOT, "server")
    os.makedirs(path, exist_ok=True)
    if os.name == "nt":
        os.startfile(path)                             # noqa: S606 — opens Explorer on the server PC
    A.say(f"  {path}", "g")


def c_clear(_):
    os.system("cls" if os.name == "nt" else "clear")   # noqa: S605


COMMANDS = {
    "help": c_help, "?": c_help, "who": c_who, "status": c_status, "benches": c_benches, "agents": c_agents,
    "pending": c_pending, "approve": c_approve, "unlock": c_unlock, "stop": c_stop, "kick": c_kick,
    "today": c_today, "last": c_last, "watch": c_watch, "pause": c_pause, "resume": c_resume,
    "verbose": c_verbose, "beep": c_beep, "logs": c_logs, "monitor": c_monitor, "clear": c_clear, "cls": c_clear,
}
