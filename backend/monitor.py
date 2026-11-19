"""
monitor.py — PINJ Monitor: the control room for the PINJ server.

    ┌ header: time · users today · active · transmitting ───────────────────────────────┐
    │ [user 1]          [user 2]          [user 3]       ← one panel per user, 3 per row │
    │ [user 4]          [user 5]          …              ← the 4th user starts row 2       │
    ├ GENERAL: everybody's activity in one stream + the answers to your commands ────────┤
    └ pinj> _   type a command + Enter (who · status · benches · today · unlock … · help) ┘

Opened by  PINJ_MONITOR.bat  or by typing  monitor  in the PINJ server window. It READS the activity log
(logs\\server\\pinj_activity_<date>.log) and sends typed commands to the server (only from this PC, with the token
the server writes in data\\console_token) — it never disturbs the server; close it any time (Esc twice / Ctrl+C / X).

Commands run on the server: help who status benches agents pending approve unlock stop kick today last verbose beep logs
Commands of this window:    clear   pause / resume   watch <user…> / watch off   quit
                            page <n> / page next / page prev   rotate on|off   idle hide|show
Keys: Tab / Shift+Tab next / previous page · ↑ / ↓ earlier commands · Esc clears the line · PgUp / PgDn scroll
      the general pane

Many users: panels come in pages (as many as fit the window: 3 per row, 4 on a very wide window, up to 3 rows).
Page 1 always starts with whoever is transmitting, then whoever was active in the last 15 minutes, then idle users.

    PINJ_MONITOR.bat           browser polls hidden
    PINJ_MONITOR.bat all       also the polls (when the server runs verbose)
"""
import collections
import datetime as _dt
import hashlib
import json
import math
import os
import re
import sys
import threading
import time

from rich import box
from rich.console import Console, Group
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.text import Text

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
LOG_DIR = os.path.join(os.environ.get("PINJ_LOG_ROOT") or os.path.join(PROJECT, "logs"), "server")
TOKEN_FILE = os.path.join(os.environ.get("PINJ_DATA_ROOT") or os.path.join(PROJECT, "data"), "console_token")
SHOW_ALL = "all" in [a.lower() for a in sys.argv[1:]]
COLS = 3
ROTATE_S = 10                                           # "rotate on": next page every 10 s
ACTIVE_MIN = 15

# same colours as the server window (activity.py)
_USER_COLOURS = [51, 214, 141, 118, 205, 39, 226, 172, 99, 45, 156, 213, 81, 208]
_COL = {"g": "bright_green", "r": "bright_red", "y": "yellow", "m": "magenta", "b": "cyan", "c": "cyan",
        "w": "white", "d": "grey50"}
ANON = ("—", "?", "(signed out)")
ANON_KEY = "server"                                     # console actions + people not signed in

sys.path.insert(0, HERE)
try:
    import activity as _A                               # labels → colours, kept in one place
    LABEL_COLOUR = {lbl: col for lbl, col in _A.AUDIT_LABELS.values()}
    LABEL_COLOUR.update({lbl: "b" for lbl in _A.ENGINE_LABELS.values()})
except Exception:                                       # noqa: BLE001
    LABEL_COLOUR = {}
LABEL_COLOUR.update({"◇ OPENED": "d", "! REFUSED": "y", "✕ SERVER ERROR": "r", "⚠ BENCH ERROR": "r", "⚠ BENCH NOTE": "y"})

TX_START = ("▶ SERIAL TRANSMIT", "◉ SERIAL LISTEN")
TX_END = ("■ SERIAL STOP", "■ BENCH STOPPED", "⏻ SIGNED OUT", "⏏ SIGNED OUT BY SERVER", "■ LISTEN STOP")
REQ = re.compile(r"^(GET|POST|PUT|DELETE|PATCH) (\d{3})$")
LOCAL_CMDS = ("clear", "cls", "pause", "resume", "watch", "quit", "exit", "monitor", "page", "rotate", "idle")


def user_style(user: str) -> str:
    if user == ANON_KEY or user in ANON:
        return "grey62"
    h = int(hashlib.md5(user.lower().encode("utf-8")).hexdigest(), 16)
    return f"bold color({_USER_COLOURS[h % len(_USER_COLOURS)]})"


def ist_now() -> _dt.datetime:
    return (_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=5, minutes=30)).replace(tzinfo=None)


def label_colour(label: str) -> str:
    m = REQ.match(label)
    if m:
        st = int(m.group(2))
        return "r" if st >= 500 else "y" if st >= 400 else "d"
    return LABEL_COLOUR.get(label, "w")


def strip_ip(detail: str) -> str:
    return re.sub(r"\s*\[[0-9.:a-f]+\]$|\s*\[server PC\]$", "", detail)


class Feed:
    """Tails today's activity log: recent lines per user + one general stream."""

    def __init__(self):
        self.users = collections.OrderedDict()           # user → deque of (time, label, detail)
        self.last_seen = {}                              # user → datetime
        self.state = {}                                  # user → (label, detail, time) of a running transmit/listen
        self.general = collections.deque(maxlen=2000)    # Text lines: activity of everybody + command answers
        self.held = []                                   # while paused
        self.paused = False
        self.watch = set()
        self.path, self.pos, self.day = None, 0, None
        self.lock = threading.Lock()

    def file_for(self, day):
        return os.path.join(LOG_DIR, f"pinj_activity_{day:%Y-%m-%d}.log")

    def poll(self):
        day = ist_now().date()
        if day != self.day:                              # new day → new file, panels start fresh
            self.day, self.path, self.pos = day, self.file_for(day), 0
            self.users.clear(); self.last_seen.clear(); self.state.clear()
        try:
            with open(self.path, encoding="utf-8", errors="replace") as f:
                f.seek(self.pos)
                data = f.read()
                self.pos = f.tell()
        except OSError:
            return
        for raw in data.splitlines():
            self._add(raw)

    def say(self, text):
        """A line in the general pane (Text or str with ANSI colours)."""
        t = text if isinstance(text, Text) else Text.from_ansi(text)
        t.no_wrap, t.overflow = True, "ellipsis"
        with self.lock:
            (self.held if self.paused else self.general).append(t)

    def _add(self, raw: str):
        # "YYYY-MM-DD HH:MM:SS  user(12) label(26) detail"
        if len(raw) < 34 or raw[4] != "-":
            return
        t, user, label, detail = raw[11:19], raw[21:33].strip(), raw[34:60].strip(), raw[61:].strip()
        if REQ.match(label) and not SHOW_ALL:
            return                                       # raw request lines (server in verbose mode) — only with "all"
        key = ANON_KEY if (user in ANON or not user or user == "console") else user
        q = self.users.get(key)
        if q is None:
            q = self.users[key] = collections.deque(maxlen=300)
        q.append((t, label, detail))
        try:
            self.last_seen[key] = _dt.datetime.combine(self.day, _dt.datetime.strptime(t, "%H:%M:%S").time())
        except ValueError:
            pass
        if label in TX_START:
            self.state[key] = (label, detail, t)
        elif label in TX_END:
            self.state.pop(key, None)
        if label in ("■ BENCH STOPPED", "⏏ SIGNED OUT BY SERVER") and detail:
            self.state.pop(detail.split()[0], None)      # console / admin stopped someone else's bench
        if self.watch and key.lower() not in self.watch:
            return
        col = _COL.get(label_colour(label), "white")
        g = Text()
        g.append(t + "  ", style="grey42")
        g.append(f"{user[:12]:<12} ", style=user_style(key))
        g.append(f"{label} ", style=col)
        g.append(strip_ip(detail), style="grey70" if col != "bright_red" else col)
        ip = re.search(r"\[([0-9.]+|server PC)\]$", detail)
        if ip:
            g.append(f"  [{ip.group(1)}]", style="grey35")
        self.say(g)


def line_text(t: str, label: str, detail: str) -> Text:
    col = label_colour(label)
    txt = Text(no_wrap=True, overflow="ellipsis")
    txt.append(t[:5] + " ", style="grey42")
    txt.append(label + " ", style=_COL.get(col, "white"))
    txt.append(strip_ip(detail), style=_COL.get(col, "white") if col == "r" else "grey70")
    return txt


def last_ip(q) -> str:
    for _t, _l, d in reversed(q):
        m = re.search(r"\[([0-9.]+)\]$", d)
        if m:
            return m.group(1)
    return ""


def user_panel(feed: Feed, user: str, height: int) -> Panel:
    q = feed.users.get(user, ())
    now = ist_now()
    seen = feed.last_seen.get(user)
    active = seen is not None and (now - seen).total_seconds() < ACTIVE_MIN * 60
    st = feed.state.get(user)
    if st:
        head = Text(f"▶ {st[0][2:]} since {st[2][:5]}", style="bold magenta")
        if st[1]:
            head.append(f" · {strip_ip(st[1])}", style="magenta")
    else:
        head = Text("● active" if active else "○ idle", style="bright_green" if active else "grey50")
        if seen:
            head.append(f" · last {seen:%H:%M}", style="grey50")
    head.no_wrap, head.overflow = True, "ellipsis"
    lines = [line_text(*x) for x in list(q)[-max(1, height - 4):]]
    ip = last_ip(q)
    sub = Text(f" {ip} · {len(q)} lines " if ip else f" {len(q)} lines ", style="grey50")
    border = "magenta" if st else (user_style(user).replace("bold ", "") if active else "grey30")
    return Panel(Group(head, Text("─" * 200, style="grey23", no_wrap=True, overflow="crop"), *lines),
                 title=Text(f" {user} ", style=user_style(user)), title_align="left",
                 subtitle=sub, subtitle_align="right", border_style=border, box=box.ROUNDED, padding=(0, 1))


class Prompt:
    def __init__(self):
        self.text = ""
        self.history = []
        self.hpos = 0
        self.scroll = 0                                  # general pane: lines scrolled back
        self.esc_at = 0.0
        self.page = 0                                    # user panels: page shown (Tab / page n)
        self.pages = 1
        self.rotate = False                              # flip pages every ROTATE_S seconds
        self.rotate_at = time.monotonic()
        self.hide_idle = False                           # panels only for people active in the last ACTIVE_MIN


def render(feed: Feed, prompt: Prompt, console: Console, sending: bool) -> Layout:
    now = ist_now()
    users = list(feed.users.keys())
    people = [u for u in users if u != ANON_KEY]
    if feed.watch:
        people = [u for u in people if u.lower() in feed.watch]

    def is_active(u):
        return bool(feed.last_seen.get(u)) and (now - feed.last_seen[u]).total_seconds() < ACTIVE_MIN * 60

    active = sum(1 for u in people if is_active(u))
    tx = [u for u in people if u in feed.state]
    # busiest first: transmitting → active → idle; within each, the order people first appeared today
    order = sorted(people, key=lambda u: (0 if u in feed.state else 1 if is_active(u) else 2, users.index(u)))
    idle_hidden = 0
    if prompt.hide_idle:
        keep = [u for u in order if u in feed.state or is_active(u)]
        idle_hidden = len(order) - len(keep)
        order = keep
    if ANON_KEY in users and not feed.watch:
        order.append(ANON_KEY)

    # how many panels fit: columns by window width, rows by window height (a panel needs ~9 lines)
    width, total_h = console.size.width, console.size.height
    cols = 4 if width >= 240 else 2 if width < 110 else COLS
    gen_h = max(8, total_h // 3)
    grid_h = max(6, total_h - gen_h - 2)
    rows_fit = max(1, min(3, grid_h // 9))
    per_page = cols * rows_fit
    prompt.pages = max(1, math.ceil(len(order) / per_page))
    page = prompt.page % prompt.pages
    prompt.page = page
    on_page = order[page * per_page:(page + 1) * per_page]

    head = Text(no_wrap=True, overflow="ellipsis")
    head.append(" PINJ MONITOR ", style="bold black on bright_green")
    head.append(f"  {now:%H:%M:%S} IST   ", style="bold white")
    head.append(f"{len(people)} user(s) today   ", style="cyan")
    head.append(f"{active} active (last {ACTIVE_MIN} min)   ", style="bright_green")
    head.append(f"{len(tx)} transmitting{': ' + ', '.join(tx) if tx else ''}   ", style="magenta" if tx else "grey50")
    if prompt.pages > 1:
        head.append(f" page {page + 1}/{prompt.pages} ", style="bold black on cyan")
        head.append(f" {'rotating every ' + str(ROTATE_S) + 's' if prompt.rotate else 'Tab = next page'}   ", style="cyan")
    if idle_hidden:
        head.append(f"{idle_hidden} idle hidden (idle show)   ", style="yellow")
    if feed.watch:
        head.append(f"watching {', '.join(sorted(feed.watch))}   ", style="yellow")
    head.append(f"{'all lines' if SHOW_ALL else 'polls hidden'}", style="grey50")

    # general pane
    with feed.lock:
        gl = list(feed.general)
        held = len(feed.held)
    body_h = max(1, gen_h - 2)
    end = len(gl) - prompt.scroll
    shown = gl[max(0, end - body_h):max(0, end)]
    gtitle = Text(" GENERAL — everybody · command answers ", style="bold bright_green")
    gsub = Text(no_wrap=True)
    if feed.paused:
        gsub.append(f" PAUSED · {held} new line(s) held · type resume ", style="bold yellow")
    elif prompt.scroll:
        gsub.append(f" scrolled back {prompt.scroll} line(s) · PgDn ", style="yellow")
    else:
        gsub.append(" live ", style="grey50")
    general = Panel(Group(*shown) if shown else Text("Waiting for activity…", style="grey50"),
                    title=gtitle, title_align="left", subtitle=gsub, subtitle_align="right",
                    border_style="green" if not feed.paused else "yellow", box=box.HEAVY_HEAD, padding=(0, 1))

    # input line
    inp = Text(no_wrap=True, overflow="ellipsis")
    inp.append(" pinj> ", style="bold black on bright_green")
    inp.append(" " + prompt.text, style="bold white")
    inp.append("▌", style="blink bright_green")
    if sending:
        inp.append("   … sending to the server", style="yellow")
    elif not prompt.text:
        inp.append("   type a command + Enter — help · who · status · today · unlock <user> · page · rotate · idle · quit"
                   + ("   · Tab = next page" if prompt.pages > 1 else ""), style="grey42")

    root = Layout()
    root.split_column(Layout(head, size=1), Layout(name="grid", size=grid_h), Layout(general, name="gen"),
                      Layout(inp, size=1))
    if not on_page:
        msg = ("Nobody active right now — type  idle show  to see everybody." if prompt.hide_idle
               else "No user activity yet today — panels appear as people sign in.")
        root["grid"].update(Panel(Text(msg, style="grey50"), border_style="grey30"))
        return root
    # with several pages keep the same grid on every page, so panels don't jump in size
    rows = rows_fit if prompt.pages > 1 else math.ceil(len(on_page) / cols)
    height = max(5, grid_h // rows)
    row_layouts = []
    for r in range(rows):
        cells = []
        for c in range(cols):
            i = r * cols + c
            cells.append(Layout(user_panel(feed, on_page[i], height)) if i < len(on_page) else Layout(Text(" ")))
        rl = Layout()
        rl.split_row(*cells)
        row_layouts.append(rl)
    root["grid"].split_column(*row_layouts)
    return root


# ── commands ────────────────────────────────────────────────────────────────────────────
def send_to_server(cmd: str, feed: Feed, state: dict):
    import urllib.request                                # noqa: PLC0415 — standard library, no extra package
    try:
        with open(TOKEN_FILE, encoding="utf-8") as f:
            info = json.load(f)
        req = urllib.request.Request(f"http://127.0.0.1:{info.get('port', 8080)}/hub/console/run",
                                     data=json.dumps({"command": cmd}).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json", "X-PINJ-Console-Token": info["token"]})
        with urllib.request.urlopen(req, timeout=15) as r:
            lines = json.loads(r.read().decode("utf-8")).get("lines", [])
        for ln in lines:
            feed.say(ln)
    except FileNotFoundError:
        feed.say(Text("  ✕ the PINJ server is not running (no data\\console_token) — start START_PINJ.bat", style="bright_red"))
    except Exception as e:                               # noqa: BLE001
        feed.say(Text(f"  ✕ could not reach the PINJ server: {e} — is START_PINJ.bat running (restart it after an update)?",
                      style="bright_red"))
    finally:
        state["sending"] = False


def run_command(cmd: str, feed: Feed, prompt: Prompt, state: dict) -> bool:
    """False = quit."""
    parts = cmd.split()
    name, args = parts[0].lower(), parts[1:]
    echo = Text()
    echo.append(f"{ist_now():%H:%M:%S}  ", style="grey42")
    echo.append(f"pinj> {cmd}", style="bold bright_green")
    feed.say(echo)
    if name in ("quit", "exit"):
        return False
    if name in ("clear", "cls"):
        with feed.lock:
            feed.general.clear()
        prompt.scroll = 0
        return True
    if name == "pause":
        feed.paused = True
        feed.say(Text("  general pane paused — new lines are held · type resume", style="yellow"))
        return True
    if name == "resume":
        with feed.lock:
            n = len(feed.held)
            feed.general.extend(feed.held)
            feed.held.clear()
        feed.paused = False
        feed.say(Text(f"  live again ({n} held line(s) added)", style="bright_green"))
        return True
    if name == "watch":
        if not args or args[0].lower() in ("off", "all", "everybody"):
            feed.watch.clear()
            feed.say(Text("  showing everybody", style="bright_green"))
        else:
            feed.watch = {a.lower() for a in args}
            feed.say(Text(f"  showing only {', '.join(sorted(feed.watch))} (panels + general) · watch off to undo",
                          style="bright_green"))
        return True
    if name == "monitor":
        feed.say(Text("  this is the PINJ Monitor", style="grey50"))
        return True
    if name == "page":
        a = (args[0].lower() if args else "next")
        if a.isdigit():
            prompt.page = max(0, int(a) - 1)
        else:
            prompt.page += -1 if a in ("prev", "previous", "back") else 1
        prompt.rotate_at = time.monotonic()
        feed.say(Text(f"  page {prompt.page % prompt.pages + 1} of {prompt.pages}  (Tab / Shift+Tab also flip pages)", style="cyan"))
        return True
    if name == "rotate":
        prompt.rotate = not args or args[0].lower() in ("on", "1", "yes")
        prompt.rotate_at = time.monotonic()
        feed.say(Text(f"  pages {'flip every ' + str(ROTATE_S) + ' s' if prompt.rotate else 'stay put (Tab = next page)'}", style="cyan"))
        return True
    if name == "idle":
        prompt.hide_idle = bool(args) and args[0].lower() in ("hide", "off", "no")
        prompt.page = 0
        feed.say(Text("  panels only for people active in the last 15 min (idle show = everybody)" if prompt.hide_idle
                      else "  panels for everybody seen today", style="cyan"))
        return True
    state["sending"] = True
    threading.Thread(target=send_to_server, args=(cmd, feed, state), daemon=True).start()
    if name in ("help", "?"):
        feed.say(Text("  this window also has:  page <n>|next|prev · rotate on|off · idle hide|show · watch <user…> / watch off"
                      " · pause / resume · clear · quit", style="cyan"))
        feed.say(Text("  keys: Tab / Shift+Tab pages · ↑↓ earlier commands · Esc clears the line · PgUp / PgDn scroll general",
                      style="cyan"))
    return True


def _key(ev: str, prompt: Prompt, feed: Feed, state: dict) -> bool:
    """One key → prompt / page / scroll change. ev = 'up' 'down' 'pgup' 'pgdn' 'tab' 'stab' 'enter' 'bs' 'esc'
    'ctrlc' or one printable character. False = quit."""
    if ev == "up" and prompt.history:
        prompt.hpos = max(0, prompt.hpos - 1)
        prompt.text = prompt.history[prompt.hpos]
    elif ev == "down" and prompt.history:
        prompt.hpos = min(len(prompt.history), prompt.hpos + 1)
        prompt.text = prompt.history[prompt.hpos] if prompt.hpos < len(prompt.history) else ""
    elif ev == "pgup":
        prompt.scroll = min(len(feed.general), prompt.scroll + 10)
    elif ev == "pgdn":
        prompt.scroll = max(0, prompt.scroll - 10)
    elif ev in ("tab", "stab"):                          # Tab → next page, Shift+Tab → previous
        prompt.page += 1 if ev == "tab" else -1
        prompt.rotate_at = time.monotonic()
    elif ev == "enter":
        cmd = prompt.text.strip()
        prompt.text = ""
        prompt.scroll = 0
        if cmd:
            if not prompt.history or prompt.history[-1] != cmd:
                prompt.history.append(cmd)
            prompt.hpos = len(prompt.history)
            if not run_command(cmd, feed, prompt, state):
                return False
    elif ev == "bs":
        prompt.text = prompt.text[:-1]
    elif ev == "esc":                                    # Esc clears; Esc twice on an empty line closes
        now = time.monotonic()
        if not prompt.text and now - prompt.esc_at < 0.8:
            return False
        prompt.text, prompt.esc_at = "", now
    elif ev == "ctrlc":
        return False
    elif len(ev) == 1 and ev.isprintable() and len(prompt.text) < 200:
        prompt.text += ev
    return True


_WIN_SPECIAL = {"H": "up", "P": "down", "I": "pgup", "Q": "pgdn", "\x0f": "stab"}
_WIN_PLAIN = {"\t": "tab", "\r": "enter", "\x08": "bs", "\x1b": "esc", "\x03": "ctrlc"}


def read_keys(prompt: Prompt, feed: Feed, state: dict) -> bool:
    """Windows console keys (msvcrt). False = quit."""
    import msvcrt                                        # noqa: PLC0415
    while msvcrt.kbhit():
        ch = msvcrt.getwch()
        if ch in ("\x00", "\xe0"):                       # arrows / page keys
            ev = _WIN_SPECIAL.get(msvcrt.getwch())
            if ev and not _key(ev, prompt, feed, state):
                return False
            continue
        if not _key(_WIN_PLAIN.get(ch, ch), prompt, feed, state):
            return False
    return True


_VT_SEQ = {"[A": "up", "[B": "down", "[5~": "pgup", "[6~": "pgdn", "[Z": "stab", "OA": "up", "OB": "down"}
_VT_PLAIN = {"\t": "tab", "\r": "enter", "\n": "enter", "\x7f": "bs", "\x08": "bs", "\x03": "ctrlc"}


def read_keys_posix(prompt: Prompt, feed: Feed, state: dict) -> bool:
    """Linux / macOS terminal keys (stdin in cbreak mode, see main()). False = quit."""
    import select                                        # noqa: PLC0415
    while select.select([sys.stdin], [], [], 0)[0]:
        ch = sys.stdin.read(1)
        if ch == "\x1b":                                 # Esc alone, or the start of an arrow / page key
            seq = ""
            while select.select([sys.stdin], [], [], 0.02)[0] and len(seq) < 4:
                seq += sys.stdin.read(1)
                if seq[-1].isalpha() or seq[-1] == "~":
                    break
            ev = _VT_SEQ.get(seq) if seq else "esc"
            if ev and not _key(ev, prompt, feed, state):
                return False
            continue
        if not _key(_VT_PLAIN.get(ch, ch), prompt, feed, state):
            return False
    return True


def main():
    console = Console()
    os.makedirs(LOG_DIR, exist_ok=True)
    if os.name == "nt":
        os.system("title PINJ monitor")                 # noqa: S605
    feed = Feed()
    feed.poll()
    feed.say(Text(f"  PINJ Monitor · today's activity from {feed.file_for(ist_now().date())}", style="grey50"))
    feed.say(Text("  type  help  + Enter for commands · quit or Esc Esc closes this window (the server keeps running)",
                  style="grey50"))
    prompt, state = Prompt(), {"sending": False}
    tty_saved = None
    if os.name != "nt" and sys.stdin.isatty():           # Linux: keys one by one, no echo (restored on exit)
        import termios                                   # noqa: PLC0415
        import tty                                       # noqa: PLC0415
        tty_saved = termios.tcgetattr(sys.stdin)
        tty.setcbreak(sys.stdin.fileno())
    try:
        _run_live(console, feed, prompt, state)
    finally:
        if tty_saved is not None:
            import termios                               # noqa: PLC0415
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, tty_saved)


def _run_live(console, feed: Feed, prompt: Prompt, state: dict):
    keys = read_keys if os.name == "nt" else (read_keys_posix if sys.stdin.isatty() else None)
    with Live(render(feed, prompt, console, False), console=console, screen=True, auto_refresh=False) as live:
        last_draw = 0.0
        while True:
            if keys and not keys(prompt, feed, state):
                break
            feed.poll()
            now = time.monotonic()
            if prompt.rotate and prompt.pages > 1 and now - prompt.rotate_at >= ROTATE_S:
                prompt.page += 1
                prompt.rotate_at = now
            if now - last_draw > 0.12:
                live.update(render(feed, prompt, console, state["sending"]), refresh=True)
                last_draw = now
            time.sleep(0.03)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
