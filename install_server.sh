#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  install_server.sh - ONE command sets up PINJ on an Ubuntu PC, start to finish:
#
#      sudo bash install_server.sh
#
#  Run it from your normal user account (PINJ runs as that user). PINJ is installed in
#  the folder this script is in, e.g.  sudo bash /home/nmsremote/Documents/PINJ/install_server.sh
#  (started straight from a pen drive, it first copies PINJ to ~/PINJ).
#  Internet is needed once (Python packages). No questions are asked.
#
#    1. program folder (copied off a pen drive)   6. firewall: TCP 8080 (ufw, if active)
#    2. Python 3.10+ and venv (apt)               7. PINJ LIBRARY -> ~/PINJ/library
#    3. .venv + the Python packages               8. accounts: data/pinj_users.sqlite (no MySQL
#    4. the built web pages (frontend/dist)          needed) + Excel view PINJ_USERS.xlsx
#    5. serial ports: user joins "dialout"        9. ALWAYS ON: systemd service "pinj" starts at
#                                                    power-on, restarts 5 s after any stop; no sleep
#   10. checks that PINJ really answers on port 8080
#
#  Options:  --mysql   also move the accounts into MySQL (if mysql-server is installed)
#            --keep-sleep   do not switch off suspend / hibernate
#  Safe to run again (e.g. after copying a newer PINJ): it keeps data/, logs/ and library/.
# ---------------------------------------------------------------------------
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=""
SERVICE=pinj
USE_MYSQL=0
NO_SLEEP=1
while [ $# -gt 0 ]; do
  case "$1" in
    --mysql) USE_MYSQL=1 ;;
    --keep-sleep) NO_SLEEP=0 ;;
    --port) PORT="${2:-}"; shift ;;
    --port=*) PORT="${1#--port=}" ;;
  esac
  shift
done

say()  { echo " $*"; }
step() { echo; echo " [$1] $2"; }
die()  { echo; echo " !! $*"; echo; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run:  sudo bash install_server.sh"
RUN_USER="${SUDO_USER:-}"
[ -n "$RUN_USER" ] && [ "$RUN_USER" != "root" ] || die "Run it with sudo from your normal user account (PINJ runs as that user)."
RUN_GROUP="$(id -gn "$RUN_USER")"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
# PINJ is installed where this script is (e.g. /home/nmsremote/Documents/PINJ). Only when it is started
# straight from a pen drive (/media, /mnt, /run/media) is it first copied to ~/PINJ (or $PINJ_HOME).
case "$SRC" in
  /media/*|/mnt/*|/run/media/*) APP="${PINJ_HOME:-$RUN_HOME/PINJ}" ;;
  *)                            APP="${PINJ_HOME:-$SRC}" ;;
esac
as_user() { sudo -u "$RUN_USER" -H "$@"; }

echo
echo " =============================================================="
echo "   PINJ server - one-click installation on $(hostname)"
echo "   from: $SRC"
echo "   to:   $APP      runs as: $RUN_USER"
echo " =============================================================="

# ── 1. copy off the pen drive ────────────────────────────────────────────────
step "1/10" "Program folder"
if [ "$SRC" != "$APP" ]; then
  mkdir -p "$APP"
  # program files are replaced; the server's own data, logs and library are kept if PINJ was installed before
  ( cd "$SRC" && tar --exclude=./.venv --exclude=./frontend/node_modules \
      $( [ -d "$APP/data" ] && echo --exclude=./data ) \
      $( [ -d "$APP/logs" ] && echo --exclude=./logs ) \
      $( [ -d "$APP/library" ] && echo --exclude=./library ) \
      -cf - . ) | ( cd "$APP" && tar -xf - )
  say "      copied to $APP"
else
  say "      already in $APP"
fi
chown -R "$RUN_USER:$RUN_GROUP" "$APP"
find "$APP" -name "*.sh" -exec chmod +x {} +
VENV="$APP/.venv"

# ── 2-3. Python ────────────────────────────────────────────────────────────
step "2/10" "Python"
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null \
   || ! python3 -c 'import venv, ensurepip' 2>/dev/null; then
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q python3 python3-venv python3-pip
fi
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' \
  || die "Python 3.10 or newer is needed (Ubuntu 22.04 or newer has it)."
say "      $(python3 --version)"

step "3/10" "Python environment and packages"
[ -x "$VENV/bin/python" ] || as_user python3 -m venv "$VENV"
as_user "$VENV/bin/python" -m pip install --disable-pip-version-check -q -r "$APP/backend/requirements-windows.txt" \
  || die "Could not install the Python packages - check the internet connection and run this again."
say "      packages installed"

# ── 4. pages ───────────────────────────────────────────────────────────────
step "4/10" "Web pages"
if [ -f "$APP/frontend/dist/index.html" ]; then
  say "      built pages found"
elif command -v npm >/dev/null; then
  (cd "$APP/frontend" && as_user npm install --no-audit --no-fund && as_user npm run build) || die "Building the web pages failed."
else
  die "frontend/dist is missing and Node.js is not installed. Copy PINJ with MOVE_TO_NEW_PC.bat (it brings the built pages)."
fi

# ── 5-6. serial ports, firewall ──────────────────────────────────────────────
step "5/10" "Serial ports"
usermod -aG dialout "$RUN_USER"
say "      $RUN_USER may use the USB-serial radio modems (/dev/ttyUSB*)"

step "6/10" "Firewall"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  say "      ufw is active - the PINJ port is opened in step 9"
else
  say "      ufw is not active - nothing to open"
fi

# ── 7-8. library, accounts ───────────────────────────────────────────────────
step "7/10" "PINJ LIBRARY input files"
as_user "$VENV/bin/python" "$APP/backend/move_helper.py" setlib

step "8/10" "Accounts"
if [ -f "$APP/backend/pinj_db.json" ]; then
  say "      MySQL is set up for PINJ (backend/pinj_db.json)"
elif [ "$USE_MYSQL" = 1 ] && command -v mysql >/dev/null; then
  (cd "$APP/backend" && "$VENV/bin/python" setup_database.py) || true
  if [ -f "$APP/backend/pinj_db.json" ]; then
    chown "$RUN_USER:$RUN_GROUP" "$APP/backend/pinj_db.json"
    chmod 600 "$APP/backend/pinj_db.json"
  fi
else
  N=$(as_user "$VENV/bin/python" -c "import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute('select count(*) from users').fetchone()[0])" "$APP/data/pinj_users.sqlite" 2>/dev/null || echo 0)
  say "      kept in $APP/data/pinj_users.sqlite ($N user(s)) - no MySQL needed"
fi
(cd "$APP/backend" && as_user "$VENV/bin/python" users_report.py) >/dev/null 2>&1 && say "      Excel view: $APP/PINJ_USERS.xlsx (PINJ refreshes it by itself)"

# ── 9. always on ─────────────────────────────────────────────────────────────
step "9/10" "Always on"
systemctl stop "$SERVICE" >/dev/null 2>&1 || true            # free our own port before choosing one
port_busy() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }
if [ -z "$PORT" ] && [ -f "$APP/pinj.conf" ]; then
  PORT="$(sed -n 's/^PORT=\([0-9]\+\).*/\1/p' "$APP/pinj.conf" | head -1)"
fi
if [ -z "$PORT" ] || port_busy "$PORT"; then
  [ -n "$PORT" ] && say "      port $PORT is used by another program on this PC - choosing another one"
  PORT=""
  for p in 8080 8090 8091 8092 8093 8094 8095 9080 9090; do
    if ! port_busy "$p"; then PORT=$p; break; fi
  done
  [ -n "$PORT" ] || die "No free port found (8080, 8090-8095, 9080, 9090). Run again with:  --port <number>"
fi
echo "PORT=$PORT" > "$APP/pinj.conf"
chown "$RUN_USER:$RUN_GROUP" "$APP/pinj.conf"
if [ "$PORT" != 8080 ] && command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "$PORT/tcp" >/dev/null
fi
say "      PINJ uses port $PORT (saved in $APP/pinj.conf)"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=PINJ server (KAVACH Packet Injector & Decoder) on port $PORT
After=network-online.target mysql.service
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
SupplementaryGroups=dialout
WorkingDirectory=$APP/backend
Environment=PINJ_PORT=$PORT
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONIOENCODING=utf-8
ExecStart="$VENV/bin/python" -m uvicorn hub:app --host 0.0.0.0 --port $PORT --no-access-log
Restart=always
RestartSec=5
KillMode=control-group

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
say "      service '$SERVICE' enabled: starts at every power-on, restarts 5 s after any stop"
if [ "$NO_SLEEP" = 1 ]; then
  systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true
  say "      sleep / suspend / hibernate switched off"
fi

# ── 10. check ──────────────────────────────────────────────────────────────
step "10/10" "Check"
UP=0
for _ in $(seq 1 30); do
  if "$VENV/bin/python" -c "import urllib.request,json; r=json.load(urllib.request.urlopen('http://127.0.0.1:$PORT/hub/auth/state', timeout=2)); assert 'needs_setup' in r" 2>/dev/null; then
    UP=1; break
  fi
  sleep 1
done
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo " =============================================================="
if [ "$UP" = 1 ]; then
  echo "   PINJ is RUNNING on $(hostname) and starts by itself at every power-on."
else
  echo "   !! PINJ did not answer yet - see:  journalctl -u $SERVICE -n 50"
fi
echo
echo "   This PC:    http://localhost:$PORT"
echo "   Other PCs:  http://${IP:-<this-PC-IP>}:$PORT   or  http://$(hostname):$PORT"
echo
echo "   Accounts (Excel view):  $APP/PINJ_USERS.xlsx"
echo "   Control:  cd $APP  then  ./pinj.sh status | stop | start | restart | logs | monitor | users"
echo
echo "   Ask IT for a fixed IP address for this PC."
echo " =============================================================="
[ "$UP" = 1 ]
