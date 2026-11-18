"""
move_helper.py — used by MOVE_TO_NEW_PC.bat and INSTALL_SERVER.bat to move PINJ to another PC.

  python move_helper.py export <dest folder>
      • copies the accounts (users + activity record) from wherever PINJ keeps them now
        (MySQL or the local SQLite file) into <dest>\\data\\pinj_users.sqlite
        — passwords stay hashed; sessions and modem-agent keys are not copied
          (everyone signs in once more; testers download their modem agent again)
      • copies each PINJ LIBRARY folder (APD, MA tables, tags, SVK / OVK storyboards)
        into <dest>\\library\\<category>\\

  python move_helper.py setlib
      • on the new PC: points the PINJ LIBRARY at the folders in <PINJ>\\library\\ (writes data\\library.json)
"""
import json
import os
import shutil
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

CATEGORIES = ("apd", "ma", "tag", "svk_story", "ovk_story")


def _library_paths() -> dict:
    """{category id: folder} exactly as the running PINJ sees it (data\\library.json, else the defaults)."""
    import hub                                     # noqa: PLC0415 — only for its library settings
    return {c["id"]: c["path"] for c in hub.library_config()}


def export_accounts(dest: str) -> None:
    import pinj_users as U                         # noqa: PLC0415
    src = U.Store()
    out_path = os.path.join(dest, "data", "pinj_users.sqlite")
    if os.path.exists(out_path):
        os.remove(out_path)
    dst = U.Store({"engine": "sqlite", "path": out_path})
    con = sqlite3.connect(out_path)
    dst_cols = {t: [r[1] for r in con.execute(f"PRAGMA table_info({t})")] for t in ("users", "audit_log")}
    con.close()
    users = src.q("SELECT * FROM users ORDER BY id")
    audit = src.q("SELECT * FROM audit_log ORDER BY id")
    for u in users:
        cols = [c for c in u if c in dst_cols["users"]]
        dst.x(f"INSERT INTO users ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})",
              tuple(u[c] for c in cols))
    for a in audit:
        cols = [c for c in a if c in dst_cols["audit_log"] and c != "id"]
        dst.x(f"INSERT INTO audit_log ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})",
              tuple(a[c] for c in cols))
    print(f"  accounts : {len(users)} user(s), {len(audit)} activity entries  (from {src.where()})")


def export_library(dest: str) -> None:
    for cat, path in _library_paths().items():
        target = os.path.join(dest, "library", cat)
        if not os.path.isdir(path):
            print(f"  library  : {cat:<9} folder not found, skipped ({path})")
            continue
        shutil.copytree(path, target, dirs_exist_ok=True)
        n = sum(len(files) for _, _, files in os.walk(target))
        print(f"  library  : {cat:<9} {n} file(s)")


def set_library() -> None:
    base = os.path.join(PROJECT, "library")
    cats = [{"id": c, "path": os.path.join(base, c)} for c in CATEGORIES if os.path.isdir(os.path.join(base, c))]
    if not cats:
        print("  library  : no library folder here - set the folders later in Settings > LIBRARY")
        return
    os.makedirs(os.path.join(PROJECT, "data"), exist_ok=True)
    with open(os.path.join(PROJECT, "data", "library.json"), "w", encoding="utf-8") as f:
        json.dump({"categories": cats}, f, indent=2)
    print(f"  library  : {len(cats)} folder(s) in {base}")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "export":
        export_accounts(sys.argv[2])
        export_library(sys.argv[2])
    elif len(sys.argv) == 2 and sys.argv[1] == "setlib":
        set_library()
    else:
        print(__doc__)
        sys.exit(2)
