# PINJ — Install on a new machine

PINJ (KAVACH Packet Injector & Decoder) runs on **Windows 11 + WSL2 Ubuntu**:

| Part | What it is | Port |
|---|---|---|
| Backend | Python FastAPI (`backend/main.py`) + a C library (`svk_sim.c`, compiled automatically by gcc) | **8000** |
| Frontend | React + Vite (`frontend/`) — the pages you open in the browser | **7000** |
| Radio modem | Guardian™ modem on a USB-RS232 cable, shared from Windows into WSL with **usbipd-win** | — |

Reference machine this guide was written from: Ubuntu 26.04 LTS on WSL 2.7, Python 3.14.4, Node 18.20.8, gcc 15.2.

Do the steps in order. `<you>` = your Windows user name, `$USER` = your Ubuntu user name.

---

## 1. Windows side (once)

Open **PowerShell as Administrator**:

```powershell
wsl --install -d Ubuntu
winget install usbipd
```

Restart Windows. On first start Ubuntu asks for a **user name and password**.

> **Tip:** use the **same Ubuntu user name as the old machine (`vinoth`)**. PINJ has one path with the user name in it (see step 4) — with the same name nothing needs editing.

Check:

```powershell
wsl --version
usbipd --version
```

---

## 2. Ubuntu packages (once)

Open the **Ubuntu** terminal:

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip build-essential git curl
```

Node.js 18 (what PINJ uses today; Node 20 also works — Vite 5 needs 18 or newer):

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

Check:

```bash
python3 --version
node --version
npm --version
gcc --version
```

---

## 3. Copy the project

The project must live **inside Ubuntu** at `~/Projects/DecodeX` (not under `C:\` / `/mnt/c` — that is slow and breaks auto-reload).

Leave out the machine-specific folders — they are rebuilt in steps 5–6:
`venv/`, `frontend/node_modules/`, `__pycache__/`, `backend/svk_sim.so`.

**On the OLD machine** (Ubuntu terminal) — pack it onto the Windows Desktop:

```bash
cd ~/Projects
tar --exclude=DecodeX/venv \
    --exclude=DecodeX/frontend/node_modules \
    --exclude='__pycache__' \
    --exclude=DecodeX/backend/svk_sim.so \
    -czf /mnt/c/Users/<you>/Desktop/PINJ_DecodeX.tar.gz DecodeX
```

The archive is about 10 MB. It keeps `logs/` (old test logs) and `.git/` (history + the `pinj-frozen-2026-10-16` baseline tag). To leave the logs behind, add `--exclude=DecodeX/logs/*.log`.

Copy `PINJ_DecodeX.tar.gz` to the new PC (USB stick / network), e.g. onto its Desktop.

**On the NEW machine** (Ubuntu terminal):

```bash
mkdir -p ~/Projects
tar -xzf /mnt/c/Users/<you>/Desktop/PINJ_DecodeX.tar.gz -C ~/Projects
mkdir -p ~/Projects/DecodeX/logs
cd ~/Projects/DecodeX && ls
```

You should see `backend  frontend  logs  scripts  ...`.

---

## 4. Machine-specific settings

### 4a. Test-log folder (only if your Ubuntu user is NOT `vinoth`)

`backend/main.py` writes the test logs to a fixed path:

```python
_TEST_LOG_DIR = "/home/vinoth/Projects/DecodeX/logs"
```

With another user name this folder doesn't exist and **no test logs are written** (transmit still works, silently without a log). Fix it once:

```bash
cd ~/Projects/DecodeX
sed -i "s#^_TEST_LOG_DIR = \"/home/vinoth/#_TEST_LOG_DIR = \"/home/$USER/#" backend/main.py
grep -n "^_TEST_LOG_DIR" backend/main.py
```

### 4b. Serial port setting

`backend/serial_config.json` comes from the old machine (`/dev/ttyUSB0`, 57600 baud). On a PC without a modem attached the backend automatically falls back to the **SIM_LOOPBACK** simulator — nothing to change. Select the real port later in the app (step 8).

---

## 5. Backend — Python environment

```bash
cd ~/Projects/DecodeX
python3 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install "fastapi==0.141.1" "uvicorn[standard]==0.52.1" "pydantic==2.13.4" \
                     "python-multipart==0.0.32" "pyserial==3.5" "openpyxl==3.1.5"
```

These are the exact versions running on the reference machine. If pip can't find one of them (a different Python version), install the project's own list instead:

```bash
venv/bin/pip install -r backend/requirements
```

The C library `backend/svk_sim.so` is **compiled automatically** by gcc the first time the backend starts. To build it by hand:

```bash
gcc -shared -fPIC -O2 backend/svk_sim.c -o backend/svk_sim.so
```

---

## 6. Frontend — Node packages

```bash
cd ~/Projects/DecodeX/frontend
npm install
```

Needs internet (one package, `xlsx`, comes from `cdn.sheetjs.com`).
**No internet on the new PC?** Copy `frontend/node_modules/` from the old machine as well (same Linux x64 + same Node major version).

---

## 7. Start PINJ

Two Ubuntu terminals.

**Terminal 1 — backend:**

```bash
cd ~/Projects/DecodeX/backend
../venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Wait for `Application startup complete`.

**Terminal 2 — frontend:**

```bash
cd ~/Projects/DecodeX/frontend
npm run dev
```

Open in the **Windows** browser (Edge / Chrome):

| Page | Address |
|---|---|
| PINJ (LIVE, DMI, SVK SIM, ⚙ Settings) | http://localhost:7000 |
| Packet Simulator (DMI SIM, LOG REPLAY) | http://localhost:7000/simulator |
| Backend health check | http://localhost:8000/health |

Stop with **Ctrl+C** in each terminal.

### Optional: one command to start both

Create `~/pinj_start.sh` once:

```bash
cat > ~/pinj_start.sh <<'EOF'
#!/bin/bash
# Starts the PINJ backend (8000) and frontend (7000) in the background.
P=~/Projects/DecodeX
pkill -f "uvicorn main:app --host 0.0.0.0 --port 8000" 2>/dev/null
pkill -f "DecodeX/frontend/node_modules/.bin/vite" 2>/dev/null
sleep 1
cd $P/backend  && nohup ../venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload > /tmp/pinj_backend.log 2>&1 &
cd $P/frontend && nohup npm run dev > /tmp/pinj_frontend.log 2>&1 &
sleep 5
curl -s http://localhost:8000/health | head -c 80; echo
echo "PINJ: http://localhost:7000   (logs: /tmp/pinj_backend.log, /tmp/pinj_frontend.log)"
EOF
chmod +x ~/pinj_start.sh
```

Then every time: `~/pinj_start.sh`.
Stop: `pkill -f "uvicorn main:app"; pkill -f vite`

---

## 8. Connect the Guardian radio modem (USB)

**Windows — PowerShell as Administrator:**

```powershell
usbipd list
usbipd bind --busid <BUSID>
usbipd attach --wsl --busid <BUSID>
```

- `usbipd list` shows the USB-serial adapter of the modem and its **BUSID** (e.g. `2-4`).
- `bind` is needed **once** per adapter / USB socket.
- `attach` is needed **after every re-plug or Windows restart**.

**Ubuntu:**

```bash
ls -l /dev/ttyUSB*
sudo chmod 0777 /dev/ttyUSB0
```

`chmod` is needed again after every attach. Permanent alternative (once):

```bash
sudo usermod -aG dialout $USER
```

then in Windows `wsl --shutdown` and reopen Ubuntu.

**In PINJ:** 🧩 SVK SIM → ☰ LOADERS → SERIAL RADIO MODEM
1. Press ↺ (re-scan) — `/dev/ttyUSB0` appears.
2. Select it; set the Guardian COM settings: **57600 baud, 8N1, DOX, DOX delay 6** (must match the modem).
3. Press **TEST PORT** → **HARDWARE MODE — VERIFIED** = the real modem is open.
   **NOT CONNECTED — USING SIMULATION** = it fell back to the simulator.
4. Pick Radio1 (0xF1) or Radio2 (0xF2) and transmit.

> Use **SIM_LOOPBACK** for anything that must not go on air.

Give the adapter back to Windows when done: `usbipd detach --busid <BUSID>`.

---

## 9. Check that everything works

- [ ] http://localhost:8000/health answers `{"status":"ok", ...}`
- [ ] http://localhost:7000 opens; the top bar shows **BACKEND** green
- [ ] `ls ~/Projects/DecodeX/backend/svk_sim.so` exists (C library compiled)
- [ ] SVK SIM → SERIAL RADIO MODEM lists `SIM_LOOPBACK`; TRANSMIT in SIM works and a new `logs/pinj_test_…log` appears
- [ ] Packet Simulator → 📂 LOG REPLAY loads an old log and plays it to LIVE
- [ ] Voice / sounds: click once anywhere on the page (browsers block sound until the first click), then ⚙ Settings → sound test. The clips are in `frontend/public/sounds/voice/` and come with the project.

---

## 10. Things that are NOT copied

| What | Where it lives | What to do |
|---|---|---|
| ⚙ Settings, theme, USB BUSID field | Stored in the **browser** (localStorage) | Set them again on the new PC |
| Python packages | `venv/` | Rebuilt in step 5 |
| Node packages | `frontend/node_modules/` | Rebuilt in step 6 |
| C library binary | `backend/svk_sim.so` | Rebuilt automatically at first start |
| usbipd bind / dialout | Windows / Ubuntu | Steps 8 |

The repository also contains older Docker files (`docker-compose.yml`, `DOCKER_SETUP.md`, from August). They are **not** how PINJ runs today — use this guide.

---

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| `address already in use` on 8000 / 7000 | Another PINJ is running: `pkill -f "uvicorn main:app"; pkill -f vite` |
| Backend error `gcc compilation failed` | `sudo apt install -y build-essential`, restart the backend |
| `ModuleNotFoundError` when starting the backend | Started with the wrong Python — use `../venv/bin/uvicorn` (step 7), or redo step 5 |
| Page shows **BACKEND** red / "Backend offline" | Terminal 1 not running or crashed — check its output / `/tmp/pinj_backend.log` |
| `npm install` fails | No internet → copy `frontend/node_modules/` from the old machine (step 6) |
| No `/dev/ttyUSB0` | Run `usbipd attach --wsl --busid <BUSID>` again (step 8) |
| `Permission denied: /dev/ttyUSB0` | `sudo chmod 0777 /dev/ttyUSB0` or join `dialout` (step 8) |
| TEST PORT says USING SIMULATION | Port not attached / wrong port selected / permissions — step 8 |
| Transmit works but no new log file | User name isn't `vinoth` → step 4a; and `mkdir -p ~/Projects/DecodeX/logs` |
| http://localhost:7000 doesn't open in Windows | In PowerShell: `wsl --shutdown`, reopen Ubuntu, start PINJ again |

---

## Quick reference — all commands

```powershell
# Windows (PowerShell as Administrator) — once
wsl --install -d Ubuntu
winget install usbipd
```

```bash
# Ubuntu — once
sudo apt update
sudo apt install -y python3 python3-venv python3-pip build-essential git curl
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

mkdir -p ~/Projects
tar -xzf /mnt/c/Users/<you>/Desktop/PINJ_DecodeX.tar.gz -C ~/Projects
mkdir -p ~/Projects/DecodeX/logs
cd ~/Projects/DecodeX
sed -i "s#^_TEST_LOG_DIR = \"/home/vinoth/#_TEST_LOG_DIR = \"/home/$USER/#" backend/main.py   # only if user ≠ vinoth

python3 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install "fastapi==0.141.1" "uvicorn[standard]==0.52.1" "pydantic==2.13.4" \
                     "python-multipart==0.0.32" "pyserial==3.5" "openpyxl==3.1.5"
cd frontend && npm install && cd ..
```

```bash
# Ubuntu — every time
cd ~/Projects/DecodeX/backend  && ../venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload   # terminal 1
cd ~/Projects/DecodeX/frontend && npm run dev                                                        # terminal 2
# browser: http://localhost:7000
```

```powershell
# Windows — every time you want the real modem
usbipd attach --wsl --busid <BUSID>
```

```bash
# Ubuntu — after the attach
sudo chmod 0777 /dev/ttyUSB0
```
