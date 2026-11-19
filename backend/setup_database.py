"""
setup_database.py — moves the PINJ accounts into MySQL (run by SETUP_DATABASE.bat).

  1. creates the database `pinj` (utf8mb4) and a limited MySQL login `pinj_app`
     (localhost only; it may use only the `pinj` database) with a long random password
  2. writes backend/pinj_db.json, so PINJ uses MySQL from the next start
  3. copies the accounts and the activity record from the local file data/pinj_users.sqlite
     (if PINJ was used before MySQL) — the local file itself is kept

Your MySQL root password is typed by YOU, into mysql.exe's own prompt. PINJ never sees it
and never stores it. Run it again any time: it renews the pinj_app password and keeps the data.
"""
import json
import os
import secrets
import sqlite3
import string
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import pinj_users as U  # noqa: E402

DB_NAME, APP_USER = "pinj", "pinj_app"
SQLITE_PATH = os.path.join(PROJECT, "data", "pinj_users.sqlite")


def find_mysql() -> str:
    if os.name != "nt":                                   # Ubuntu / Linux: the mysql client on PATH
        import shutil                                     # noqa: PLC0415
        return os.environ.get("PINJ_MYSQL_EXE", "") or shutil.which("mysql") or ""
    cands = [os.environ.get("PINJ_MYSQL_EXE", "")]
    for root in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", "")):
        base = os.path.join(root or "", "MySQL")
        if os.path.isdir(base):
            for name in sorted(os.listdir(base), reverse=True):
                cands.append(os.path.join(base, name, "bin", "mysql.exe"))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return ""


def main() -> int:
    mysql = find_mysql()
    if not mysql:
        print("  mysql.exe was not found (looked in Program Files\\MySQL\\…\\bin).")
        print("  Install MySQL Server 8, or set PINJ_MYSQL_EXE to the full path of mysql.exe.")
        return 1
    print(f"  Using {mysql}")

    alphabet = string.ascii_letters + string.digits
    app_pw = "".join(secrets.choice(alphabet) for _ in range(32))
    sql = f"""
CREATE DATABASE IF NOT EXISTS `{DB_NAME}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS '{APP_USER}'@'localhost' IDENTIFIED BY '{app_pw}';
CREATE USER IF NOT EXISTS '{APP_USER}'@'127.0.0.1' IDENTIFIED BY '{app_pw}';
ALTER USER '{APP_USER}'@'localhost' IDENTIFIED BY '{app_pw}';
ALTER USER '{APP_USER}'@'127.0.0.1' IDENTIFIED BY '{app_pw}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX ON `{DB_NAME}`.* TO '{APP_USER}'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX ON `{DB_NAME}`.* TO '{APP_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SELECT 'PINJ database ready' AS status;
"""
    fd, sql_path = tempfile.mkstemp(suffix=".sql", prefix="pinj_setup_")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(sql)
        print()
        if os.name != "nt" and hasattr(os, "geteuid") and os.geteuid() == 0:
            # Ubuntu's MySQL lets the Linux root user in as MySQL root through the local socket (auth_socket)
            print("  Signing in to MySQL as root through the local socket (Ubuntu default) ...")
            cmd = [mysql, "-u", "root", "--execute=source " + sql_path]
        else:
            print("  Type the MySQL ROOT password when asked (it is the one you chose when installing MySQL).")
            print("  It goes straight to mysql — PINJ does not see or keep it.")
            cmd = [mysql, "-u", "root", "-p", "-h", "localhost", "--protocol=TCP",
                   "--execute=source " + sql_path.replace("\\", "/")]
        print()
        r = subprocess.run(cmd)
    finally:
        try:
            os.remove(sql_path)                    # it held the new pinj_app password
        except OSError:
            pass
    if r.returncode != 0:
        print("\n  MySQL did not accept that — nothing was changed in PINJ. Check the root password and run again.")
        return 1

    cfg = {"engine": "mysql", "host": "127.0.0.1", "port": 3306, "user": APP_USER, "password": app_pw, "database": DB_NAME}
    try:
        store = U.Store(cfg)                        # creates the tables
    except Exception as e:                          # noqa: BLE001
        print(f"\n  The database was created, but PINJ could not sign in to it: {e}")
        return 1

    with open(U.DB_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    print(f"\n  Saved the PINJ database login in {U.DB_CONFIG_PATH}")
    print("  (keep this file private — it is the pinj_app password, not your root password)")

    migrate(store)
    print(f"\n  Done. Accounts are now kept in: {store.where()}")
    print("  You can see them in MySQL Workbench: schema 'pinj', tables users / sessions / audit_log.")
    print("  Restart PINJ (STOP_PINJ.bat, then START_PINJ.bat) to use MySQL.")
    return 0


def migrate(store: "U.Store"):
    if not os.path.isfile(SQLITE_PATH):
        return
    if store.user_count() > 0:
        print("\n  MySQL already has PINJ accounts — the local file was not copied again.")
        return
    src = sqlite3.connect(SQLITE_PATH)
    src.row_factory = sqlite3.Row
    users = [dict(r) for r in src.execute("SELECT * FROM users ORDER BY id")]
    audit = [dict(r) for r in src.execute("SELECT * FROM audit_log ORDER BY id")]
    src.close()
    if not users:
        return
    cols = [c for c in users[0].keys()]
    for u in users:
        store.x(f"INSERT INTO users ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})", tuple(u[c] for c in cols))
    if audit:
        acols = [c for c in audit[0].keys() if c != "id"]
        for a in audit:
            store.x(f"INSERT INTO audit_log ({', '.join(acols)}) VALUES ({', '.join(['%s'] * len(acols))})", tuple(a[c] for c in acols))
    store.audit("system", "accounts_moved", f"{len(users)} accounts copied from the local file into MySQL")
    print(f"\n  Copied {len(users)} account(s) and {len(audit)} activity entries from {SQLITE_PATH}")
    print("  (everyone signs in again once; passwords stay the same)")


if __name__ == "__main__":
    sys.exit(main())
