"""
users_report.py — PINJ_USERS.xlsx: an Excel view of the accounts, for PCs without MySQL Workbench.

PINJ keeps the accounts in its database (data/pinj_users.sqlite, or MySQL when set up). This module writes
an Excel copy of what an administrator would look at in Workbench, in the PINJ folder:

  sheet "Users"         one row per account: name, role, status, contact, created / approved, last sign-in,
                        failed sign-ins, lock-out, modem agent
  sheet "Activity"      the activity record, newest first (sign-ins, approvals, files, transmits ...)
  sheet "Modem agents"  each user's PINJ Modem Agent: PC name, last seen

Never in the file: password hashes, session tokens, agent keys. It is a READ-ONLY view: PINJ refreshes it
within a minute of any change (hub.py starts start_auto_refresh()), so editing it changes nothing — use
⚙ → Users or the server commands to change accounts.

  python users_report.py          write it now (also:  ./pinj.sh users)
"""
import datetime as _dt
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
REPORT_PATH = os.environ.get("PINJ_USERS_REPORT") or os.path.join(PROJECT, "PINJ_USERS.xlsx")
ACTIVITY_ROWS = 5000
REFRESH_S = 60

_USER_COLS = [("username", "User name", 16), ("full_name", "Full name", 24), ("role", "Role", 9), ("status", "Status", 11),
              ("designation", "Designation", 22), ("email", "E-mail", 28), ("phone", "Phone", 15),
              ("created_at", "Created", 19), ("approved_by", "Approved by", 14), ("approved_at", "Approved", 19),
              ("last_login_at", "Last sign-in", 19), ("last_login_ip", "From IP", 15), ("failed_logins", "Failed sign-ins", 9),
              ("locked_until", "Locked until", 19), ("must_change_password", "Must change password", 10)]


def _txt(v):
    if v is None:
        return ""
    if isinstance(v, _dt.datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    return v


def _fingerprint(store) -> tuple:
    u = store.q1("SELECT COUNT(*) AS n, MAX(id) AS m FROM users") or {}
    a = store.q1("SELECT COUNT(*) AS n, MAX(id) AS m FROM audit_log") or {}
    seen = store.q1("SELECT MAX(last_seen_at) AS s FROM agent_keys") or {}
    logins = store.q1("SELECT MAX(last_login_at) AS l, SUM(failed_logins) AS f FROM users") or {}
    return (u.get("n"), u.get("m"), a.get("n"), a.get("m"), str(seen.get("s")), str(logins.get("l")), logins.get("f"))


def write_report(store, path: str = REPORT_PATH) -> str:
    from openpyxl import Workbook                                  # noqa: PLC0415
    from openpyxl.styles import Alignment, Font, PatternFill      # noqa: PLC0415

    users = store.q("SELECT * FROM users ORDER BY id")
    activity = store.q(f"SELECT ts, username, action, detail, ip FROM audit_log ORDER BY id DESC LIMIT {ACTIVITY_ROWS}")
    agents = store.q("SELECT a.*, u.username FROM agent_keys a LEFT JOIN users u ON u.id = a.user_id ORDER BY u.username")

    wb = Workbook()
    head = Font(bold=True, color="FFFFFF")
    fill = PatternFill("solid", fgColor="1F4E5F")
    now = time.strftime("%Y-%m-%d %H:%M:%S")

    def sheet(ws, title, cols, rows):
        ws.title = title
        ws.append([c[1] for c in cols])
        for i, (_k, _h, w) in enumerate(cols, start=1):
            cell = ws.cell(row=1, column=i)
            cell.font, cell.fill = head, fill
            cell.alignment = Alignment(vertical="center")
            ws.column_dimensions[cell.column_letter].width = w
        for r in rows:
            ws.append([_txt(r.get(k)) for k, _h, _w in cols])
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions

    ws = wb.active
    sheet(ws, "Users", _USER_COLS + [("agent", "Modem agent PC", 18)],
          [dict(u, agent=next((a.get("hostname") for a in agents if a.get("user_id") == u.get("id")), "")) for u in users])
    sheet(wb.create_sheet(), "Activity", [("ts", "Time (IST)", 19), ("username", "User", 16), ("action", "Action", 22),
                                          ("detail", "Detail", 70), ("ip", "IP", 15)], activity)
    sheet(wb.create_sheet(), "Modem agents", [("username", "User", 16), ("hostname", "PC name", 22),
                                              ("created_at", "Key created", 19), ("last_seen_at", "Last connected", 19),
                                              ("last_ip", "From IP", 15)], agents)
    info = wb.create_sheet("About")
    info.column_dimensions["A"].width = 110
    for line in (f"PINJ accounts — written {now} from {store.where()}",
                 "Read-only view: PINJ rewrites this file within a minute of any change. Editing it changes nothing.",
                 "Change accounts in PINJ: ⚙ → Users (administrators), or the server commands (approve, unlock ...).",
                 "Not included on purpose: passwords (hashed), sign-in sessions and modem-agent keys."):
        info.append([line])

    tmp = path + ".tmp"
    wb.save(tmp)
    os.replace(tmp, path)                                          # never a half-written file
    return path


def start_auto_refresh(store, say=None):
    """Background thread: rewrite PINJ_USERS.xlsx whenever the accounts or the activity record change."""
    def loop():
        last = None
        while True:
            try:
                fp = _fingerprint(store)
                if fp != last:
                    write_report(store)
                    last = fp
            except PermissionError:
                pass                                               # the file is open in Excel on Windows — next round
            except Exception as e:                                 # noqa: BLE001 — a report must never stop PINJ
                if say:
                    say(f"  PINJ_USERS.xlsx not written: {e}", "y")
            time.sleep(REFRESH_S)
    threading.Thread(target=loop, daemon=True, name="pinj-users-report").start()


if __name__ == "__main__":
    sys.path.insert(0, HERE)
    import pinj_users as U                                         # noqa: PLC0415
    print("  written:", write_report(U.Store()))
