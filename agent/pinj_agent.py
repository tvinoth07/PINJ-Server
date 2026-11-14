"""
pinj_agent.py — PINJ Modem Agent. Runs on the tester's own PC, where their radio modem is plugged in.

It connects OUT to the PINJ server (so nothing on this PC has to be opened in the firewall), shows the
server this PC's COM ports, and works the modem for the tester's PINJ bench: open the port, write the
TDMA bursts, key PTT (RTS), stream received bytes back. Finished test logs are saved on this PC too.

Fail-safe: whenever the server, the network or the bench goes away, PTT is dropped and the port closed.
Needs only Python 3.9+ (serial + websockets are included in lib/). Started by PINJ_AGENT.bat.
"""
import base64
import json
import os
import platform
import re
import socket
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))

import serial                                            # noqa: E402
import serial.tools.list_ports                           # noqa: E402
from websockets.sync.client import connect               # noqa: E402
from websockets.exceptions import ConnectionClosed       # noqa: E402

VERSION = "1.0"
CONFIG = os.path.join(HERE, "agent_config.json")
FAKE_PORT = os.environ.get("PINJ_AGENT_FAKE_PORT") == "1"  # tests: a loop-back "modem" (loop://)


def say(text: str):
    print(time.strftime("%H:%M:%S"), text, flush=True)


def load_config() -> dict:
    with open(CONFIG, encoding="utf-8") as f:
        cfg = json.load(f)
    if not cfg.get("log_dir"):
        cfg["log_dir"] = os.path.join(os.path.expanduser("~"), "Documents", "PINJ", "logs")
    return cfg


def list_ports() -> list:
    out = []
    for p in serial.tools.list_ports.comports():
        hwid = (p.hwid or "").strip()
        if hwid.lower() in ("", "n/a"):
            continue
        out.append({"device": p.device, "description": p.description or "", "hwid": hwid})
    if FAKE_PORT:
        out.append({"device": "loop://", "description": "TEST loop-back modem (echoes what it sends)", "hwid": "TEST"})
    return sorted(out, key=lambda x: x["device"])


class SharedPort:
    """One opened COM port, shared by all of the bench's handles (Windows allows a port to be opened once)."""

    def __init__(self, agent, device: str, cfg: dict):
        self.agent, self.device = agent, device
        self.handles = set()
        rtscts = str(cfg.get("tx_mode") or "DOX").upper() == "RTS_CTS"
        self.ser = serial.serial_for_url(
            device, baudrate=int(cfg.get("baud_rate") or 9600), bytesize=int(cfg.get("data_bits") or 8),
            stopbits=float(cfg.get("stop_bits") or 1), parity=str(cfg.get("parity") or "N").upper()[:1],
            timeout=0.02, write_timeout=float(cfg.get("write_timeout_s") or 1.0), rtscts=rtscts, dsrdtr=False)
        if not rtscts:
            try:
                self.ser.rts = False                     # idle = not transmitting
            except Exception:                            # noqa: BLE001
                pass
        self.alive = True
        threading.Thread(target=self._reader, daemon=True, name=f"rx-{device}").start()

    def _reader(self):
        while self.alive:
            try:
                n = self.ser.in_waiting
                data = self.ser.read(n or 1) if self.alive else b""
            except Exception as e:                       # noqa: BLE001 — unplugged
                if self.alive:
                    say(f"modem port {self.device} failed: {e}")
                    for h in list(self.handles):
                        self.agent.send({"op": "error", "h": h, "msg": f"modem port {self.device} on your PC failed: {e}"})
                    self.agent.drop_port(self)
                return
            if data:
                b64 = base64.b64encode(data).decode()
                for h in list(self.handles):
                    self.agent.send({"op": "rx", "h": h, "data": b64})

    def close(self):
        self.alive = False
        try:
            self.ser.rts = False                         # fail-safe: never leave the transmitter keyed
        except Exception:                                # noqa: BLE001
            pass
        try:
            self.ser.close()
        except Exception:                                # noqa: BLE001
            pass


class Agent:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.ws = None
        self.send_lock = threading.Lock()
        self.ports = {}                                  # device → SharedPort
        self.handle_port = {}                            # h → SharedPort
        self.stop = False

    # ── sending ──────────────────────────────────────────────────────────────
    def send(self, msg: dict):
        ws = self.ws
        if ws is None:
            return
        try:
            with self.send_lock:
                ws.send(json.dumps(msg))
        except Exception:                                # noqa: BLE001 — the main loop reconnects
            pass

    # ── ports ────────────────────────────────────────────────────────────────
    def drop_port(self, sp: SharedPort):
        sp.close()
        if self.ports.get(sp.device) is sp:
            self.ports.pop(sp.device, None)
        for h in list(sp.handles):
            self.handle_port.pop(h, None)

    def close_all(self, why: str = ""):
        if self.ports and why:
            say(f"modem released ({why}) — PTT off, port closed")
        for sp in list(self.ports.values()):
            self.drop_port(sp)

    def _open(self, msg: dict):
        h, device = msg.get("h"), str(msg.get("device") or "")
        known = {p["device"].upper() for p in list_ports()}
        if device.upper() not in known:
            self.send({"op": "opened", "h": h, "ok": False, "msg": f"{device} is not a serial port on {platform.node()}"})
            return
        try:
            sp = self.ports.get(device)
            if sp is None:
                sp = SharedPort(self, device, msg.get("cfg") or {})
                self.ports[device] = sp
                c = msg.get("cfg") or {}
                say(f"modem port {device} opened ({c.get('baud_rate')} bps, {c.get('tx_mode') or 'DOX'})")
            sp.handles.add(h)
            self.handle_port[h] = sp
            self.send({"op": "opened", "h": h, "ok": True})
        except Exception as e:                           # noqa: BLE001 — busy, unplugged, bad settings
            say(f"could not open {device}: {e}")
            self.send({"op": "opened", "h": h, "ok": False, "msg": f"{device} on {platform.node()}: {e}"})

    def _save_log(self, msg: dict):
        name = os.path.basename(str(msg.get("name") or ""))
        if not re.match(r"^[A-Za-z0-9._\- ~()]+\.log$", name):
            return
        try:
            os.makedirs(self.cfg["log_dir"], exist_ok=True)
            path = os.path.join(self.cfg["log_dir"], name)
            with open(path, "wb") as f:
                f.write(base64.b64decode(msg.get("data") or ""))
            say(f"test log saved: {path}")
            self.send({"op": "log_saved", "name": name, "path": path})
        except Exception as e:                           # noqa: BLE001
            say(f"could not save the log {name}: {e}")

    def handle(self, msg: dict):
        op, h = msg.get("op"), msg.get("h")
        sp = self.handle_port.get(h)
        try:
            if op == "open":
                self._open(msg)
            elif op == "write" and sp:
                sp.ser.write(base64.b64decode(msg.get("data") or ""))
            elif op == "flush" and sp:
                sp.ser.flush()
                self.send({"op": "flushed", "h": h, "seq": msg.get("seq", 0)})
            elif op == "rts" and sp:
                sp.ser.rts = bool(msg.get("v"))
            elif op == "close" and sp:
                sp.handles.discard(h)
                self.handle_port.pop(h, None)
                if not sp.handles:
                    self.drop_port(sp)
                    say(f"modem port {sp.device} closed")
            elif op == "close_all":
                self.close_all("your PINJ bench stopped")
            elif op == "save_log":
                self._save_log(msg)
            elif op == "welcome":
                say(f"connected to PINJ as {msg.get('full_name')} ({msg.get('user')}) — ready")
            elif op in ("write", "flush") and not sp:
                self.send({"op": "error", "h": h, "msg": "the modem port is not open on your PC"})
        except Exception as e:                           # noqa: BLE001 — write timeout, unplugged …
            say(f"modem error: {e}")
            if sp:
                self.send({"op": "error", "h": h, "msg": f"modem on your PC: {e}"})
                if op in ("write", "flush"):
                    self.drop_port(sp)

    # ── main loop ────────────────────────────────────────────────────────────
    def watch_ports(self):
        last = None
        while not self.stop:
            time.sleep(3)
            try:
                now = list_ports()
            except Exception:                            # noqa: BLE001
                continue
            if now != last and self.ws is not None:
                if last is not None:
                    say("COM ports now: " + (", ".join(p["device"] for p in now) or "none"))
                self.send({"op": "ports", "ports": now})
            last = now

    def run(self):
        server = self.cfg["server"].rstrip("/")
        url = re.sub(r"^http", "ws", server) + "/hub/agent/connect"
        threading.Thread(target=self.watch_ports, daemon=True).start()
        delay = 2
        say(f"PINJ Modem Agent {VERSION} for {self.cfg.get('user', '?')} on {platform.node()}")
        say(f"server: {server}   ·   logs saved in: {self.cfg['log_dir']}")
        while not self.stop:
            try:
                with connect(url, additional_headers={"X-PINJ-Agent-Key": self.cfg["key"]}, max_size=None,
                             open_timeout=10, ping_interval=10, ping_timeout=15) as ws:
                    self.ws = ws
                    delay = 2
                    ports = list_ports()
                    say("COM ports: " + (", ".join(f"{p['device']} ({p['description']})" for p in ports) or "none found"))
                    self.send({"op": "hello", "hostname": platform.node(), "version": VERSION,
                               "log_dir": self.cfg["log_dir"], "ports": ports})
                    for raw in ws:
                        msg = json.loads(raw)
                        if msg.get("op") == "replaced":
                            say(f"another PINJ Modem Agent for this user connected (from {msg.get('by')}) — this one stops.")
                            self.stop = True
                            break
                        if msg.get("op") == "revoked":
                            say("this agent key was withdrawn — download the agent again from PINJ (Settings → Profile).")
                            self.stop = True
                            break
                        self.handle(msg)
            except ConnectionClosed as e:
                code = getattr(getattr(e, "rcvd", None), "code", None)
                if code == 4401:
                    say("PINJ did not accept this agent key (account disabled, or a newer agent was downloaded).")
                    say("Download the agent again: PINJ → ⚙ → My profile → MODEM AGENT.")
                    self.stop = True
                elif code == 4409:
                    self.stop = True
                else:
                    say("connection to PINJ closed")
            except (OSError, TimeoutError) as e:
                say(f"cannot reach PINJ at {server} ({e.__class__.__name__}) — retrying in {delay}s")
            except Exception as e:                       # noqa: BLE001
                if "4401" in str(e) or "HTTP 403" in str(e):
                    say("PINJ did not accept this agent key — download the agent again from PINJ (Settings → Profile).")
                    self.stop = True
                else:
                    say(f"connection problem: {e} — retrying in {delay}s")
            finally:
                self.ws = None
                self.close_all("connection to PINJ lost")
            if not self.stop:
                time.sleep(delay)
                delay = min(delay * 2, 30)
        say("PINJ Modem Agent stopped.")


def main():
    try:
        cfg = load_config()
    except (OSError, ValueError) as e:
        print("agent_config.json is missing or damaged — download the agent again from PINJ.", e)
        return 1
    agent = Agent(cfg)
    try:
        agent.run()
    except KeyboardInterrupt:
        agent.close_all("agent closed")
        say("PINJ Modem Agent stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
