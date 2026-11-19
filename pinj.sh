#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  pinj.sh - day-to-day control of PINJ on Ubuntu (after install_server.sh).
#
#    ./pinj.sh status      is it running?            ./pinj.sh logs       live server output
#    ./pinj.sh stop        stop (stays stopped until start or the next power-on)
#    ./pinj.sh start       start                     ./pinj.sh restart    after an update
#    ./pinj.sh monitor     PINJ Monitor: one panel per user + commands (who, approve, unlock ...)
#    ./pinj.sh run         run in this terminal, without the service (testing)
#    ./pinj.sh users       write PINJ_USERS.xlsx now (PINJ also refreshes it by itself every minute)
#    ./pinj.sh database    move the accounts into MySQL (optional; after: sudo apt install mysql-server)
# ---------------------------------------------------------------------------
APP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$APP/.venv"
PORT=8080
[ -f "$APP/pinj.conf" ] && . "$APP/pinj.conf"          # the port install_server.sh chose
SERVICE=pinj

case "${1:-status}" in
  start|stop|restart)
    sudo systemctl "$1" "$SERVICE" && echo " PINJ: $1 done"
    ;;
  status)
    systemctl is-enabled "$SERVICE" >/dev/null 2>&1 \
      && echo " Service : installed - PINJ starts at power-on" \
      || echo " Service : not installed (sudo bash install_server.sh)"
    systemctl is-active --quiet "$SERVICE" && echo " Server  : RUNNING on port $PORT" || echo " Server  : not running"
    ;;
  logs)
    journalctl -u "$SERVICE" -f -n 100
    ;;
  monitor)
    shift
    exec "$VENV/bin/python" "$APP/backend/monitor.py" "$@"
    ;;
  run)
    if systemctl is-active --quiet "$SERVICE"; then
      echo " PINJ is already running as the service - use ./pinj.sh stop first."
      exit 1
    fi
    cd "$APP/backend" && PINJ_PORT=$PORT exec "$VENV/bin/python" -m uvicorn hub:app --host 0.0.0.0 --port $PORT --no-access-log
    ;;
  users)
    (cd "$APP/backend" && "$VENV/bin/python" users_report.py)
    ;;
  database)
    (cd "$APP/backend" && sudo "$VENV/bin/python" setup_database.py) || exit 1
    if [ -f "$APP/backend/pinj_db.json" ]; then
      sudo chown "$(id -un):$(id -gn)" "$APP/backend/pinj_db.json" && chmod 600 "$APP/backend/pinj_db.json"
    fi
    echo " Now:  ./pinj.sh restart"
    ;;
  *)
    sed -n '3,13p' "$0"
    exit 1
    ;;
esac
