# PINJ-Server v2.0.0 (Windows, multi-user)

GitHub repository: **PINJ-Server** (private). The WSL/Linux PINJ stays in its own repository, **PINJ** (v1.x).
Versions: `v2.0.0` = first multi-user Windows release (2026-11-14, also tagged `pinj-windows-2026-11-14`).

This folder is a **copy** of the WSL PINJ (`~/Projects/DecodeX`) made on 2026-11-09, changed so it runs
**natively on Windows — no WSL, no usbipd, no compiler** — and serves PINJ to every PC on the network,
with **sign-in, user accounts and a separate bench for each user**.
The WSL PINJ is untouched; keep testing there as before (it uses ports 8000/7000, this one uses **8080**).

## Use it

| What | How |
|---|---|
| Start the server | Double-click **`START_PINJ.bat`**. It opens PINJ in your browser and shows the address for other PCs |
| Open it on this PC | http://localhost:8080 (Packet Simulator: http://localhost:8080/simulator) |
| Open it from another PC | **http://192.168.1.119:8080** (the start window shows the current address) |
| Stop | Close the server window, or double-click **`STOP_PINJ.bat`** (every user's bench stops with it) |

The first start needs internet once. It creates `.venv` and installs the Python packages
(`backend\requirements-windows.txt`). The pages are already built in `frontend\dist`.

## First start: the administrator account

1. On **this PC**, open http://localhost:8080. PINJ asks you to **create the administrator** (user name, full name,
   password). This can only be done on the server PC itself, never from another PC.
2. Everyone else opens `http://<server-ip>:8080` and clicks **Request account**. The account stays *pending*
   until an administrator approves it.
3. The administrator opens **⚙ menu → Users** (the ⚙ button shows a number when requests are waiting) and clicks
   **✓ APPROVE**.

## Accounts and profiles

| Where | What |
|---|---|
| **⚙ menu** | Who is signed in, *My profile*, *Users* (administrators only), *Sign out* |
| **Settings → 👤 PROFILE** (everyone) | Account details, edit full name / e-mail / phone / designation, change password, **my test logs** (download), my activity |
| **Settings → 👥 USERS** (administrators) | Approve / reject requests, disable / enable, make administrator / tester, **reset password** (one-time temporary password, shown once; the user must choose a new one), stop a user's bench, activity of all users, where the accounts are stored |

Security rules:
- Passwords are stored hashed: PBKDF2-SHA256 with 240,000 rounds. Nobody, the administrator included, can read them.
- After 5 wrong passwords an account is locked for 10 minutes. One PC can make at most 20 sign-in attempts in 5 minutes.
- A sign-in lasts 12 hours of inactivity, and at most 7 days.
- Changing your password signs you out on your other PCs.
- When an account is disabled, or its password is reset, that user is signed out at once.
- PINJ always keeps at least one active administrator.

## One bench per user

Each signed-in user gets **their own PINJ engine**: their own serial session, MA / APD tables, LIVE feed and serial
settings. One user's TRANSMIT, LISTEN, CLEAR or settings never touch another user's.

| Per user | Kept in |
|---|---|
| Serial settings (starts at **SIM_LOOPBACK**) | `data\benches\<user>\serial_config.json` |
| Test logs (`pinj_test_…log`) | `logs\<user>\` (users download them from Settings → Profile) |
| Bench messages (if a bench fails to start) | `data\benches\<user>\engine.log` |
| Browser preferences (theme, LIVE, sounds…) | saved per user in each browser |

A bench starts on the user's first PINJ action. It runs on a private port that only this PC can reach, and it
answers only the hub. Serial TRANSMIT / LISTEN / STOP, UDP transmit and serial-settings changes are written to
the activity record.

## Keep the accounts in MySQL (recommended, run once)

Until this is done, accounts are kept in the local file `data\pinj_users.sqlite`. That works fine, but MySQL lets
you see and back up the accounts with **MySQL Workbench**.

1. Double-click **`SETUP_DATABASE.bat`**.
2. When asked, type **your MySQL root password**. You type it straight into MySQL's own prompt; PINJ never sees
   it and never stores it.
3. The script then:
   - creates the database **`pinj`**;
   - creates a limited login **`pinj_app`**, which works from this PC only and can use only `pinj`, with a long
     random password;
   - saves that login in `backend\pinj_db.json`;
   - copies any accounts that PINJ already has. Passwords stay the same, and the local file is kept.
4. Run **`STOP_PINJ.bat`**, then **`START_PINJ.bat`**.

To view the accounts in MySQL Workbench, open the `pinj` schema. It has three tables: **`users`**, **`sessions`**
and **`audit_log`** (the activity record). Keep `backend\pinj_db.json` private, because it holds the `pinj_app`
password.

## One-time network setup (so other PCs can connect)

1. Right-click **`ALLOW_NETWORK_ACCESS.bat`** → **Run as administrator**. This adds a firewall rule for TCP 8080 on
   Private and Domain networks only.
2. This PC's Wi-Fi is currently set to **Public**, and Windows blocks other PCs on Public networks. If this is your
   trusted office network, switch it to Private: *Settings → Network & internet → Wi-Fi → (your network) → Network
   profile type → Private*.

Good to know:
- PINJ uses plain HTTP inside your network, so use it only on a trusted network. HTTPS can be added later.
- Tools that post packets to `/ingest` now need a signed-in user.

## Move PINJ to another PC (pen drive) and keep it always on

**On this PC:** run **`MOVE_TO_NEW_PC.bat`** and give the pen-drive folder, e.g. `E:\PINJ` (about 80 MB).
It copies:
- the program, the built pages and the git history;
- logs and everyone's My Files;
- the accounts, exported to `data\pinj_users.sqlite` (passwords stay the same);
- the PINJ LIBRARY input files, into `library\`.

It leaves out `.venv`, `node_modules` and `backend\pinj_db.json` (this PC's MySQL password). Nothing on this PC
changes.

**On the new PC:**
1. Copy the folder to a fixed place, e.g. `C:\PINJ`. Keep it out of Downloads and off the pen drive.
2. Right-click **`INSTALL_SERVER.bat`** → **Run as administrator**. It does the following:
   - checks Python and offers to install Python 3.12;
   - installs the packages (internet needed once);
   - opens the firewall for TCP 8080;
   - points the library at `library\`;
   - asks to keep the PC awake;
   - asks to put the accounts into MySQL, if MySQL is installed;
   - asks to make PINJ **always on**.
3. Users sign in once more with their same passwords. Testers download their Modem Agent again.

**Always on** (`PINJ_SERVICE.bat`): PINJ runs as a Windows task under SYSTEM.
- It starts at every power-on, before anyone signs in.
- It has no window, so it cannot be closed by mistake.
- If it stops, it restarts within about 5 seconds.
- Watch it and type commands with **`PINJ_MONITOR.bat`**.
- Errors go to `logs\server\service.log`.

For maintenance, open Command Prompt **as administrator** in the PINJ folder:
- `PINJ_SERVICE.bat stop` stops PINJ. It stays stopped until `start`, or until the PC restarts.
- `PINJ_SERVICE.bat start` starts it again.
- `PINJ_SERVICE.bat status` shows whether it is installed and running.
- `PINJ_SERVICE.bat remove` goes back to starting it by hand with `START_PINJ.bat`.

### On an Ubuntu server instead of Windows

PINJ-Server runs on Ubuntu 22.04 or newer with the same code. It was tested on Ubuntu 26.04: hub, sign-in, benches,
SIM transmit, decode, library, Monitor.
**One command does everything.** Copy the `PINJ` folder from the pen drive to its place, e.g.
`/home/nmsremote/Documents/PINJ`. Then open a terminal from your normal account and run:

```
sudo bash /home/nmsremote/Documents/PINJ/install_server.sh
```

It asks no questions and installs PINJ in that folder. It does the following:
1. Uses the folder it is run from. Started straight from the pen drive, it first copies PINJ to `~/PINJ`.
2. Installs Python and the packages (internet needed once).
3. Gives you access to the USB-serial modems.
4. Opens TCP 8080 in `ufw`.
5. Points the library at the `library` folder inside PINJ.
6. Keeps the accounts in `data/pinj_users.sqlite` (**no MySQL needed**).
7. Installs the **always-on service `pinj`**: it starts at every power-on, before anyone signs in, and restarts
   5 s after any stop.
8. Switches off sleep.
9. Checks that PINJ answers on port 8080.

Run it again after copying a newer PINJ: it keeps `data/`, `logs/` and `library/`. Options: `--mysql` (use MySQL),
`--keep-sleep`.

**Accounts in Excel, instead of MySQL Workbench:** `PINJ_USERS.xlsx` in the PINJ folder has these sheets:
- **Users**: role, status, contact, created / approved, last sign-in, failed sign-ins, lock-out, modem agent;
- **Activity**: the activity record, newest first;
- **Modem agents**.

PINJ rewrites it within a minute of any change, on Windows too. It is a view only: change accounts in ⚙ → Users
or with the server commands. Passwords, sessions and agent keys are never written to it.

Day to day, in the PINJ folder, use **`./pinj.sh`**:
- `status`;
- `stop` (stays stopped until `start` or the next power-on);
- `start`, `restart`, `logs`;
- `monitor` (one panel per user, with commands);
- `users` (write the Excel file now);
- `database` (move the accounts into MySQL later, optional).

On Linux, modem ports are named `/dev/ttyUSB0` and so on. Testers still use the Windows PINJ Modem Agent on their
own PCs.

## What changed compared with the WSL PINJ

| Area | WSL PINJ | This Windows PINJ |
|---|---|---|
| Runs on | Ubuntu in WSL (uvicorn + Vite dev server) | Windows Python: `hub.py` on port **8080** plus one engine (`main.py`) per user |
| Sign-in | none | Sign-in, sign-up with approval, profiles, user administration (`backend\hub.py`, `backend\pinj_users.py`, `frontend\src\Auth.jsx`) |
| Pages | Vite dev server :7000 | Built once (`frontend\dist`) and served by the hub on the same port |
| Backend address in the pages | 46 hard-coded `localhost:8000` | The page's own address (`frontend\src\apiBase.js`), so it works from any PC |
| SVK SIM encoder | `svk_sim.c` compiled by gcc | **`backend\svk_sim_py.py`**, a pure-Python port (Smart App Control blocks self-built DLLs) |
| Radio modem | `/dev/ttyUSB0` via usbipd | Windows **COM ports** directly (SVK SIM → SERIAL RADIO MODEM → ↺) |
| Serial setting at start | `/dev/ttyUSB0` | **SIM_LOOPBACK**: nothing goes on air until you pick a COM port |
| Test logs | `~/Projects/DecodeX/logs` | `logs\<user>\` in this folder |

### The Python encoder is proven identical to the C encoder

`tools\compare_svk_sim.py` (run in WSL, where gcc can build the C reference) compared both encoders on
**2,703 checks / 213,355 encoded packets and found no difference**. The checks covered:
- all 21 real storyboards, on both radios;
- each of the 17 APD workbooks loaded (route amalgamation);
- 400 generated track profiles and storyboards;
- 800 generated XML documents;
- the paced UDP transmit (identical datagrams).

Re-run it after any encoder change:

```bash
cd /mnt/c/Users/Vinoth/Documents/Projects/PINJ
~/Projects/DecodeX/venv/bin/python tools/compare_svk_sim.py
```

## Files added / changed in this copy

- **Added (Phase 1):**
  - `START_PINJ.bat`, `STOP_PINJ.bat`, `ALLOW_NETWORK_ACCESS.bat`, `README_PINJ_SERVER.md`
  - `backend\svk_sim_py.py`, `backend\pinj_address.py`, `backend\requirements-windows.txt`
  - `frontend\src\apiBase.js`, `tools\compare_svk_sim.py`
- **Added (Phase 2):**
  - `SETUP_DATABASE.bat`
  - `backend\hub.py`, `backend\pinj_users.py`, `backend\setup_database.py`
  - `frontend\src\Auth.jsx`
- **Changed:**
  - `backend\svk_sim_bridge.py`: uses the Python encoder.
  - `backend\main.py`: per-user log folder and serial settings, the engine token check, and serving the pages.
  - `backend\serial_config.json`: SIM_LOOPBACK.
  - `frontend\vite.config.js`: dev port 7080, which forwards everything to 8080.
  - `frontend\src\main.jsx`: sign-in first.
  - `frontend\src\SettingsAbout.jsx`: Profile / Users tabs, the account section in the ⚙ menu, and per-user browser settings.
  - `App.jsx`, `PacketSimulator.jsx` and `LiveFeed.jsx`: the user chip and Settings tabs.
  - The other frontend `.jsx` files: the backend address now comes from `apiBase.js`.
- `PINJ_INSTALL_GUIDE.md` in this folder describes the **WSL** setup. It is not needed for this Windows server.

## 📂 Shared input files (library on the server PC)

Every SVK SIM loader has a **📂 FROM PINJ SERVER LIBRARY** button under its drop zone: APD, MA table, RFID tag
table, and storyboard (SVK and OVK). It lists the files kept in folders on the server PC. Picking one loads it
exactly as if it had been dropped on the loader, so testers don't need copies on their own PCs. Testers can
only read these folders; nothing in them is changed or deleted.

| Library | Folder on the server PC (default) |
|---|---|
| APD files | `C:\Users\Vinoth\Documents\VINOTH\Felix\APD FOR PINJ` |
| MA tables | `C:\Users\Vinoth\Documents\VINOTH\Suresh Sir\MA TABLES` |
| RFID tag files | `C:\Users\Vinoth\Documents\VINOTH\Felix\TAG` |
| SVK storyboards | `C:\Users\Vinoth\Documents\VINOTH\StoryBoard\NOVA\SKP\SVK STORY` |
| OVK storyboards | `C:\Users\Vinoth\Documents\VINOTH\StoryBoard\NOVA\SKP\OVK STORY` |

How it behaves:
- Sub-folders can be browsed.
- Excel lock files (`~$…`) are hidden.
- An administrator changes the folders in **Settings → 📂 LIBRARY**; the choice is saved in `data\library.json`.
- Each file loaded is written to the activity record.

## 👤 My files (each user's own input files on the server)

The same picker has a second tab, **👤 MY FILES**. Each user can **⬆ UPLOAD FROM THIS PC**, or drop files on the
picker window, to keep their own MA tables, APD files, tag files and storyboards on the server. They can then load
them from any PC with one click.

| | |
|---|---|
| Where | `data\user_files\<user>\<apd / ma / tag / svk_story / ovk_story>\` on the server PC |
| Who sees them | Only that user. Other users, testers and admins can't list, load or remove them through PINJ |
| Same file name | Uploading the same name again replaces the old file with the newer one |
| Remove (🗑) | Moves the file to `data\user_files\<user>\_removed\` (nothing is erased, so an admin can recover it) |
| Limits | Same file types as each loader (.xlsx/.xls/.csv…), max 25 MB per file. Uploads and removals are in the activity record |

## 📡 Phase 3: PINJ Modem Agent (the modem on each tester's own PC)

Each user has **one modem**: the one plugged into their own PC. The **PINJ Modem Agent** connects it to their PINJ bench.

1. In PINJ, open **⚙ menu → My profile → 📡 MY MODEM AGENT → ⬇ DOWNLOAD MODEM AGENT**. You get
   `PINJ_Agent_<user>.zip`, which holds your personal key.
2. Unzip it on the PC with the modem and double-click **`PINJ_AGENT.bat`**. Keep that window open while you test.
3. In **SVK SIM → SERIAL RADIO MODEM**, press ↺. Your modem appears as **`AGENT:COMx … on your PC`**. Pick it, save,
   then TEST PORT / TRANSMIT / LISTEN as usual.

| | |
|---|---|
| Needs | Python 3.9+ on the tester's PC ([python.org](https://www.python.org/downloads/), tick *Add python.exe to PATH*). Nothing else: the serial and websocket libraries are inside the zip (`lib\`) |
| Network | The agent connects **out** to `http://<server-ip>:8080`, so nothing has to be opened on the tester's firewall. The server address is the one in the browser when the agent was downloaded. If the server PC's IP changes, download the agent again (or edit `agent_config.json`). A fixed IP for the server PC is best |
| Timing | The TDMA pacing (2 s epochs), PTT keying (RTS up → 150 ms → data → flush → 150 ms → RTS down) and the storyboard engine stay on the server. The agent writes each burst and confirms the flush, so PTT drops only after the bytes have left the COM port |
| Fail-safe | If the network, the server or the bench goes away, the agent drops PTT and closes the port, then reconnects by itself. Closing the agent window does the same |
| One agent per user | Starting a second agent for the same user takes over, and the old one stops. Downloading again makes a new key and the old copy is refused. **✕ WITHDRAW KEY** stops it at once. Disabling a user also disconnects their agent |
| Test logs | Written on the server (`logs\<user>\`, Profile → *My test logs*) **and**, when the agent is running, saved on the tester's PC in **`Documents\PINJ\logs`** (change `log_dir` in `agent_config.json`) |
| Server PC ports | The server PC's own COM ports are listed and usable only from a browser on the server PC itself. From any other PC, testers can only use their own `AGENT:` ports, so nobody can key the server's modem from the network |

Admins see who has an agent running (📡 AGENT chip) in **Settings → 👥 USERS**. Agent connections, disconnections
and downloads are in the activity record.

Files added in Phase 3:
- `backend\agent_link.py`: the engine side of the agent.
- `agent\pinj_agent.py`, `agent\PINJ_AGENT.bat`, `agent\README_AGENT.txt`: these are zipped per user on download.
- `frontend\src\Library.jsx`: the library picker and the admin Library tab.

Files changed in Phase 3:
- `hub.py`: the library, and the agent connections.
- `main.py`: `AGENT:` ports, the server-PC port rule, and the log copy to the tester's PC.
- `pinj_users.py`: the `agent_keys` table.
- `SvkSim.jsx`, `Auth.jsx`, `SettingsAbout.jsx`.
