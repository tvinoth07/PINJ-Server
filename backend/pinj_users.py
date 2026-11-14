"""
pinj_users.py — PINJ user accounts, login sessions and the activity record.

Storage (backend/pinj_db.json, written by SETUP_DATABASE.bat):
  {"engine": "mysql", "host": "localhost", "port": 3306, "user": "pinj_app", "password": "…", "database": "pinj"}
  → the MySQL 8.0 server on this PC (open it in MySQL Workbench: schema `pinj`, tables users / sessions / audit_log)
Without that file the accounts are kept in data/pinj_users.sqlite (same tables), so PINJ works straight away;
SETUP_DATABASE.bat later moves them into MySQL.

Security:
  • passwords: PBKDF2-HMAC-SHA256, 240 000 rounds, 16-byte random salt per user — never stored or logged in clear
  • sessions: 32-byte random token in an HttpOnly cookie; only its SHA-256 is stored; 12 h idle / 7 days max
  • 5 wrong passwords → the account is locked for 10 minutes
  • accounts made on the sign-up page start as "pending" and work only after an administrator approves them
Times are IST (UTC+5:30), 'YYYY-MM-DD HH:MM:SS', like the rest of PINJ.
"""
import base64
import datetime as _dt
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
DB_CONFIG_PATH = os.path.join(HERE, "pinj_db.json")

ROLES = ("admin", "tester")
STATUSES = ("pending", "active", "disabled", "rejected")
PBKDF2_ROUNDS = 240_000
SESSION_IDLE = _dt.timedelta(hours=12)
SESSION_MAX = _dt.timedelta(days=7)
LOCK_AFTER = 5
LOCK_FOR = _dt.timedelta(minutes=10)
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def now() -> _dt.datetime:
    return (_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=5, minutes=30)).replace(tzinfo=None, microsecond=0)


def ts(t: _dt.datetime) -> str:
    return t.strftime("%Y-%m-%d %H:%M:%S")


def parse_ts(v):
    if v is None or v == "":
        return None
    if isinstance(v, _dt.datetime):
        return v.replace(microsecond=0)
    return _dt.datetime.strptime(str(v)[:19], "%Y-%m-%d %H:%M:%S")


# ── password hashing ─────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return "pbkdf2_sha256${}${}${}".format(PBKDF2_ROUNDS, base64.b64encode(salt).decode(), base64.b64encode(dk).decode())


def check_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt, dk = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        test = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), base64.b64decode(salt), int(rounds))
        return hmac.compare_digest(test, base64.b64decode(dk))
    except Exception:                                       # noqa: BLE001 — malformed hash = no match
        return False


_DUMMY_HASH = hash_password(secrets.token_hex(8))            # equal work for unknown user names


def password_problem(password: str, username: str = "") -> str:
    """'' when acceptable, else the reason shown to the user."""
    if len(password) < 8:
        return "The password must have at least 8 characters."
    if len(password) > 128:
        return "The password is too long (max 128 characters)."
    if username and password.lower() == username.lower():
        return "The password must not be the user name."
    if password.isdigit() or password.isalpha():
        return "Use letters and numbers (or symbols) in the password."
    return ""


# ── database ────────────────────────────────────────────────────────────────

_SCHEMA_MYSQL = [
    """CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(32) NOT NULL UNIQUE,
        full_name VARCHAR(100) NOT NULL,
        email VARCHAR(120) NOT NULL DEFAULT '',
        phone VARCHAR(30) NOT NULL DEFAULT '',
        designation VARCHAR(100) NOT NULL DEFAULT '',
        role VARCHAR(10) NOT NULL DEFAULT 'tester',
        status VARCHAR(10) NOT NULL DEFAULT 'pending',
        password_hash VARCHAR(255) NOT NULL,
        must_change_password TINYINT NOT NULL DEFAULT 0,
        failed_logins INT NOT NULL DEFAULT 0,
        locked_until DATETIME NULL,
        created_at DATETIME NOT NULL,
        approved_by VARCHAR(32) NULL,
        approved_at DATETIME NULL,
        last_login_at DATETIME NULL,
        last_login_ip VARCHAR(45) NULL
    ) CHARACTER SET utf8mb4 COMMENT='PINJ accounts (times IST)'""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token_hash CHAR(64) PRIMARY KEY,
        user_id INT NOT NULL,
        created_at DATETIME NOT NULL,
        last_seen_at DATETIME NOT NULL,
        expires_at DATETIME NOT NULL,
        ip VARCHAR(45) NOT NULL DEFAULT '',
        user_agent VARCHAR(255) NOT NULL DEFAULT '',
        INDEX idx_sessions_user (user_id)
    ) CHARACTER SET utf8mb4 COMMENT='PINJ login sessions (only a SHA-256 of each token)'""",
    """CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ts DATETIME NOT NULL,
        username VARCHAR(32) NOT NULL DEFAULT '',
        action VARCHAR(40) NOT NULL,
        detail VARCHAR(500) NOT NULL DEFAULT '',
        ip VARCHAR(45) NOT NULL DEFAULT '',
        INDEX idx_audit_ts (ts)
    ) CHARACTER SET utf8mb4 COMMENT='PINJ activity record (logins, approvals, transmissions)'""",
    """CREATE TABLE IF NOT EXISTS agent_keys (
        user_id INT PRIMARY KEY,
        key_hash CHAR(64) NOT NULL UNIQUE,
        created_at DATETIME NOT NULL,
        last_seen_at DATETIME NULL,
        last_ip VARCHAR(45) NOT NULL DEFAULT '',
        hostname VARCHAR(100) NOT NULL DEFAULT ''
    ) CHARACTER SET utf8mb4 COMMENT='PINJ Modem Agent key of each user (only a SHA-256)'""",
]
_SCHEMA_SQLITE = [
    """CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        designation TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'tester',
        status TEXT NOT NULL DEFAULT 'pending',
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT NULL,
        created_at TEXT NOT NULL,
        approved_by TEXT NULL,
        approved_at TEXT NULL,
        last_login_at TEXT NULL,
        last_login_ip TEXT NULL)""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        ip TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '')""",
    "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
    """CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT '')""",
    "CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts)",
    """CREATE TABLE IF NOT EXISTS agent_keys (
        user_id INTEGER PRIMARY KEY,
        key_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NULL,
        last_ip TEXT NOT NULL DEFAULT '',
        hostname TEXT NOT NULL DEFAULT '')""",
]

USER_FIELDS = ("id", "username", "full_name", "email", "phone", "designation", "role", "status",
               "must_change_password", "created_at", "approved_by", "approved_at", "last_login_at", "last_login_ip")


def load_db_config() -> dict:
    """pinj_db.json, else the local SQLite file (PINJ_USERS_DB env overrides the SQLite path, for tests)."""
    if os.environ.get("PINJ_USERS_DB"):
        return {"engine": "sqlite", "path": os.environ["PINJ_USERS_DB"]}
    if os.path.isfile(DB_CONFIG_PATH):
        with open(DB_CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {"engine": "sqlite", "path": os.path.join(PROJECT, "data", "pinj_users.sqlite")}


class Store:
    """Users / sessions / audit — the same calls on MySQL (PyMySQL) or SQLite. Thread-safe."""

    def __init__(self, cfg: dict = None):
        self.cfg = cfg or load_db_config()
        self.engine = self.cfg.get("engine", "sqlite")
        self._local = threading.local()
        if self.engine == "sqlite":
            os.makedirs(os.path.dirname(os.path.abspath(self.cfg["path"])), exist_ok=True)
        self.init_schema()

    # connections ------------------------------------------------------------
    def _conn(self):
        c = getattr(self._local, "conn", None)
        if self.engine == "mysql":
            import pymysql
            if c is not None:
                try:
                    c.ping(reconnect=True)
                    return c
                except Exception:                           # noqa: BLE001
                    c = None
            c = pymysql.connect(host=self.cfg.get("host", "localhost"), port=int(self.cfg.get("port", 3306)),
                                user=self.cfg["user"], password=self.cfg["password"], database=self.cfg["database"],
                                charset="utf8mb4", autocommit=True, connect_timeout=5,
                                cursorclass=pymysql.cursors.DictCursor)
        elif c is None:
            c = sqlite3.connect(self.cfg["path"], timeout=10, isolation_level=None, check_same_thread=False)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA busy_timeout=10000")
        self._local.conn = c
        return c

    def _sql(self, sql: str) -> str:
        return sql.replace("%s", "?") if self.engine == "sqlite" else sql

    def q(self, sql: str, args=()):
        cur = self._conn().cursor()
        cur.execute(self._sql(sql), args)
        rows = cur.fetchall()
        return [{k: (ts(v) if isinstance(v, _dt.datetime) else v) for k, v in dict(r).items()} for r in rows]

    def q1(self, sql: str, args=()):
        r = self.q(sql, args)
        return r[0] if r else None

    def x(self, sql: str, args=()):
        cur = self._conn().cursor()
        cur.execute(self._sql(sql), args)
        return cur.lastrowid

    def init_schema(self):
        for stmt in (_SCHEMA_MYSQL if self.engine == "mysql" else _SCHEMA_SQLITE):
            self.x(stmt)

    def where(self) -> str:
        """For the admin page: where the accounts are kept."""
        if self.engine == "mysql":
            return f"MySQL {self.cfg.get('host', 'localhost')}:{self.cfg.get('port', 3306)} · database {self.cfg['database']}"
        return f"Local file {self.cfg['path']} (run SETUP_DATABASE.bat to move the accounts into MySQL)"

    # users ------------------------------------------------------------------
    @staticmethod
    def public(u: dict) -> dict:
        return {k: u.get(k) for k in USER_FIELDS} if u else None

    def user_count(self) -> int:
        return int(self.q1("SELECT COUNT(*) AS n FROM users")["n"])

    def admin_count(self) -> int:
        return int(self.q1("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'")["n"])

    def get_user(self, user_id: int):
        return self.q1("SELECT * FROM users WHERE id=%s", (user_id,))

    def get_user_by_name(self, username: str):
        return self.q1("SELECT * FROM users WHERE username=%s", (username.strip().lower(),))

    def list_users(self):
        return [self.public(u) for u in self.q("SELECT * FROM users ORDER BY status='pending' DESC, username")]

    def create_user(self, username, full_name, password, role="tester", status="pending",
                    email="", phone="", designation="", approved_by=None) -> int:
        t = ts(now())
        return self.x("INSERT INTO users (username, full_name, email, phone, designation, role, status, password_hash,"
                      " created_at, approved_by, approved_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                      (username.strip().lower(), full_name.strip(), email.strip(), phone.strip(), designation.strip(),
                       role, status, hash_password(password), t, approved_by, t if approved_by else None))

    def update_profile(self, user_id: int, full_name: str, email: str, phone: str, designation: str):
        self.x("UPDATE users SET full_name=%s, email=%s, phone=%s, designation=%s WHERE id=%s",
               (full_name.strip(), email.strip(), phone.strip(), designation.strip(), user_id))

    def set_password(self, user_id: int, password: str, must_change: bool = False):
        self.x("UPDATE users SET password_hash=%s, must_change_password=%s, failed_logins=0, locked_until=NULL WHERE id=%s",
               (hash_password(password), 1 if must_change else 0, user_id))

    def set_status(self, user_id: int, status: str, by: str = None):
        if status == "active":
            self.x("UPDATE users SET status=%s, approved_by=COALESCE(approved_by, %s), approved_at=COALESCE(approved_at, %s),"
                   " failed_logins=0, locked_until=NULL WHERE id=%s", (status, by, ts(now()), user_id))
        else:
            self.x("UPDATE users SET status=%s WHERE id=%s", (status, user_id))

    def set_role(self, user_id: int, role: str):
        self.x("UPDATE users SET role=%s WHERE id=%s", (role, user_id))

    # login ------------------------------------------------------------------
    def verify_login(self, username: str, password: str, ip: str = ""):
        """→ (user, '') or (None, reason). Counts failures, locks after LOCK_AFTER."""
        u = self.get_user_by_name(username or "")
        if not u:
            check_password(password or "", _DUMMY_HASH)
            return None, "Wrong user name or password."
        t = now()
        locked = parse_ts(u.get("locked_until"))
        if locked and locked > t:
            mins = max(1, int((locked - t).total_seconds() // 60) + 1)
            return None, f"Too many wrong passwords — this account is locked for {mins} more minute(s)."
        if not check_password(password or "", u["password_hash"]):
            fails = int(u.get("failed_logins") or 0) + 1
            if fails >= LOCK_AFTER:
                self.x("UPDATE users SET failed_logins=0, locked_until=%s WHERE id=%s", (ts(t + LOCK_FOR), u["id"]))
                self.audit(u["username"], "account_locked", f"{fails} wrong passwords", ip)
                return None, f"Too many wrong passwords — this account is locked for {int(LOCK_FOR.total_seconds() // 60)} minutes."
            self.x("UPDATE users SET failed_logins=%s WHERE id=%s", (fails, u["id"]))
            return None, "Wrong user name or password."
        if u["status"] == "pending":
            return None, "Your account is waiting for the administrator's approval."
        if u["status"] == "rejected":
            return None, "Your sign-up was not approved. Please contact the administrator."
        if u["status"] != "active":
            return None, "Your account is disabled. Please contact the administrator."
        self.x("UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=%s, last_login_ip=%s WHERE id=%s",
               (ts(t), ip, u["id"]))
        return self.get_user(u["id"]), ""

    # sessions ---------------------------------------------------------------
    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def create_session(self, user_id: int, ip: str = "", user_agent: str = "") -> str:
        token = secrets.token_urlsafe(32)
        t = now()
        self.x("INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)"
               " VALUES (%s,%s,%s,%s,%s,%s,%s)",
               (self._token_hash(token), user_id, ts(t), ts(t), ts(t + SESSION_MAX), ip[:45], (user_agent or "")[:255]))
        return token

    def session_user(self, token: str):
        """The active user of a session token, or None (expired / idle / user no longer active)."""
        if not token:
            return None
        s = self.q1("SELECT * FROM sessions WHERE token_hash=%s", (self._token_hash(token),))
        if not s:
            return None
        t = now()
        last = parse_ts(s["last_seen_at"])
        if parse_ts(s["expires_at"]) <= t or (last and t - last > SESSION_IDLE):
            self.x("DELETE FROM sessions WHERE token_hash=%s", (s["token_hash"],))
            return None
        u = self.get_user(s["user_id"])
        if not u or u["status"] != "active":
            return None
        if not last or (t - last).total_seconds() > 60:
            self.x("UPDATE sessions SET last_seen_at=%s WHERE token_hash=%s", (ts(t), s["token_hash"]))
        return u

    def delete_session(self, token: str):
        if token:
            self.x("DELETE FROM sessions WHERE token_hash=%s", (self._token_hash(token),))

    def delete_user_sessions(self, user_id: int, keep_token: str = None):
        if keep_token:
            self.x("DELETE FROM sessions WHERE user_id=%s AND token_hash<>%s", (user_id, self._token_hash(keep_token)))
        else:
            self.x("DELETE FROM sessions WHERE user_id=%s", (user_id,))

    def purge_sessions(self):
        t = now()
        self.x("DELETE FROM sessions WHERE expires_at<=%s OR last_seen_at<=%s", (ts(t), ts(t - SESSION_IDLE)))

    # modem agent keys (one per user; a new download replaces the old key) --------
    def new_agent_key(self, user_id: int) -> str:
        key = "pinjagent_" + secrets.token_urlsafe(32)
        self.x("DELETE FROM agent_keys WHERE user_id=%s", (user_id,))
        self.x("INSERT INTO agent_keys (user_id, key_hash, created_at) VALUES (%s,%s,%s)",
               (user_id, self._token_hash(key), ts(now())))
        return key

    def agent_key_user(self, key: str):
        """The active user owning this agent key, or None."""
        if not key or not key.startswith("pinjagent_"):
            return None
        k = self.q1("SELECT * FROM agent_keys WHERE key_hash=%s", (self._token_hash(key),))
        if not k:
            return None
        u = self.get_user(k["user_id"])
        return u if u and u["status"] == "active" else None

    def agent_seen(self, user_id: int, ip: str, hostname: str):
        self.x("UPDATE agent_keys SET last_seen_at=%s, last_ip=%s, hostname=%s WHERE user_id=%s",
               (ts(now()), (ip or "")[:45], (hostname or "")[:100], user_id))

    def agent_info(self, user_id: int):
        return self.q1("SELECT created_at, last_seen_at, last_ip, hostname FROM agent_keys WHERE user_id=%s", (user_id,))

    def delete_agent_key(self, user_id: int):
        self.x("DELETE FROM agent_keys WHERE user_id=%s", (user_id,))

    # activity record ----------------------------------------------------------
    def audit(self, username: str, action: str, detail: str = "", ip: str = ""):
        try:
            self.x("INSERT INTO audit_log (ts, username, action, detail, ip) VALUES (%s,%s,%s,%s,%s)",
                   (ts(now()), (username or "")[:32], action[:40], (detail or "")[:500], (ip or "")[:45]))
        except Exception:                                   # noqa: BLE001 — the record must never break a request
            pass

    def recent_audit(self, limit: int = 200, username: str = None):
        if username:
            return self.q("SELECT * FROM audit_log WHERE username=%s ORDER BY id DESC LIMIT %s", (username, int(limit)))
        return self.q("SELECT * FROM audit_log ORDER BY id DESC LIMIT %s", (int(limit),))
