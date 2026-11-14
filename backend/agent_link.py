"""
agent_link.py — the user's modem, on the user's own PC, used by this engine as if it were a local COM port.

Multi-user PINJ: every tester runs the PINJ Modem Agent (agent/pinj_agent.py) on the PC their radio modem is
plugged into. The hub joins this engine to that agent (ws /hub/agent/engine). RemoteSerialPort offers exactly
the serial.Serial calls the engine uses (write, flush, read, in_waiting, rts, close), so the TDMA transmit,
PTT keying and RX listener code in main.py work unchanged:

  open   → the agent opens the COM port with this bench's serial settings
  write  → bytes written in order on the agent's PC
  flush  → waits until the agent reports the bytes have left its COM port (so PTT drops only after the data)
  rts    → PTT line on the agent's PC
  rx     → bytes the modem received, streamed back as they arrive

If the agent disconnects, writes fail at once and the agent itself drops PTT and closes the port (fail-safe).
Device names of agent ports are "AGENT:<port>", e.g. "AGENT:COM3".
"""
import base64
import itertools
import json
import os
import threading
import time

AGENT_PREFIX = "AGENT:"
HUB_WS = os.environ.get("PINJ_HUB_WS", "")
ENGINE_TOKEN = os.environ.get("PINJ_ENGINE_TOKEN", "")
HUB_MODE = bool(ENGINE_TOKEN)


class AgentLinkError(IOError):
    pass


class _Link:
    """One WebSocket from this engine to the hub, shared by every open RemoteSerialPort."""

    def __init__(self):
        self._ws = None
        self._lock = threading.Lock()                     # connect / send
        self._handles = {}                                # h → RemoteSerialPort
        self._waiters = {}                                # req → [Event, reply]
        self._ids = itertools.count(1)

    def _connect(self):
        if self._ws is not None:
            return self._ws
        if not HUB_WS:
            raise AgentLinkError("no PINJ hub (this engine runs on its own)")
        from websockets.sync.client import connect      # noqa: PLC0415
        try:
            self._ws = connect(HUB_WS, additional_headers={"x-pinj-engine-token": ENGINE_TOKEN},
                               max_size=None, open_timeout=5, ping_interval=20, ping_timeout=20)
        except Exception as e:                           # noqa: BLE001
            raise AgentLinkError(f"cannot reach the PINJ hub: {e}") from e
        threading.Thread(target=self._reader, args=(self._ws,), daemon=True, name="agent-link").start()
        return self._ws

    def send(self, msg: dict):
        with self._lock:
            ws = self._connect()
            try:
                ws.send(json.dumps(msg))
            except Exception as e:                       # noqa: BLE001
                self._ws = None
                raise AgentLinkError(f"lost the PINJ hub: {e}") from e

    def request(self, msg: dict, timeout: float = 5.0) -> dict:
        req = next(self._ids)
        ev = threading.Event()
        self._waiters[req] = [ev, None]
        try:
            self.send(dict(msg, req=req))
            if not ev.wait(timeout):
                raise AgentLinkError("no answer from the PINJ hub")
            return self._waiters[req][1]
        finally:
            self._waiters.pop(req, None)

    def _reader(self, ws):
        try:
            for raw in ws:
                msg = json.loads(raw)
                op = msg.get("op")
                if "req" in msg and msg["req"] in self._waiters:
                    w = self._waiters[msg["req"]]
                    w[1] = msg
                    w[0].set()
                elif op == "agent_gone":
                    for h in list(self._handles.values()):
                        h._fail("your PINJ Modem Agent disconnected")
                else:
                    h = self._handles.get(msg.get("h"))
                    if h:
                        h._on_message(msg)
        except Exception:                                # noqa: BLE001
            pass
        finally:
            with self._lock:
                if self._ws is ws:
                    self._ws = None
            for h in list(self._handles.values()):
                h._fail("lost the PINJ hub")


LINK = _Link()


def agent_ports(timeout: float = 3.0) -> dict:
    """{online, hostname, ports:[{device, description, hwid}], …} of this user's agent ({online: False} if none)."""
    if not HUB_MODE:
        return {"online": False}
    try:
        return LINK.request({"op": "ports"}, timeout)
    except AgentLinkError:
        return {"online": False}


def save_log_on_agent(path: str):
    """Send a finished test log to the user's PC (the agent saves it in its log folder). Best effort."""
    if not HUB_MODE or not path or not os.path.isfile(path):
        return

    def _go():
        try:
            with open(path, "rb") as f:
                data = base64.b64encode(f.read()).decode()
            LINK.send({"op": "save_log", "name": os.path.basename(path), "data": data})
        except Exception:                                # noqa: BLE001 — the copy on the server stays
            pass
    threading.Thread(target=_go, daemon=True).start()


class RemoteSerialPort:
    """serial.Serial look-alike for a COM port on the user's PC (through their PINJ Modem Agent)."""

    def __init__(self, cfg: dict):
        self.port = cfg.get("tty_device", "")
        self.device = self.port[len(AGENT_PREFIX):] if self.port.upper().startswith(AGENT_PREFIX) else self.port
        self.baudrate = cfg.get("baud_rate", 9600)
        self.write_timeout = float(cfg.get("write_timeout_s", 1.0) or 1.0)
        self.h = f"p{next(LINK._ids)}"
        self._rx = bytearray()
        self._rx_lock = threading.Lock()
        self._seq = 0
        self._flushed = 0
        self._cond = threading.Condition()
        self._opened = None                              # None = waiting, True / error text
        self._broken = None
        self._rts = False
        self.cts = True
        self.is_open = False
        LINK._handles[self.h] = self
        try:
            LINK.send({"op": "open", "h": self.h, "device": self.device, "cfg": {
                k: cfg.get(k) for k in ("baud_rate", "data_bits", "stop_bits", "parity", "tx_mode",
                                        "read_timeout_s", "write_timeout_s", "rts_control_enabled")}})
            with self._cond:
                self._cond.wait_for(lambda: self._opened is not None, timeout=10)
        except AgentLinkError as e:
            self._opened = str(e)
        if self._opened is not True:
            LINK._handles.pop(self.h, None)
            raise AgentLinkError(self._opened or "the PINJ Modem Agent did not answer")
        self.is_open = True

    # messages from the agent ------------------------------------------------
    def _on_message(self, msg: dict):
        op = msg.get("op")
        with self._cond:
            if op == "opened":
                self._opened = True if msg.get("ok") else (msg.get("msg") or "the agent could not open the port")
            elif op == "rx":
                with self._rx_lock:
                    self._rx += base64.b64decode(msg.get("data", ""))
            elif op == "flushed":
                self._flushed = max(self._flushed, int(msg.get("seq", 0)))
            elif op in ("error", "closed"):
                self._broken = msg.get("msg") or "the modem port was closed on your PC"
            self._cond.notify_all()

    def _fail(self, why: str):
        with self._cond:
            self._broken = why
            if self._opened is None:
                self._opened = why
            self._cond.notify_all()

    def _check(self):
        if self._broken:
            raise AgentLinkError(self._broken)

    # serial.Serial interface ------------------------------------------------
    def write(self, data: bytes) -> int:
        self._check()
        self._seq += 1
        LINK.send({"op": "write", "h": self.h, "seq": self._seq, "data": base64.b64encode(bytes(data)).decode()})
        return len(data)

    def flush(self) -> None:
        self._check()
        target = self._seq
        LINK.send({"op": "flush", "h": self.h, "seq": target})
        with self._cond:
            ok = self._cond.wait_for(lambda: self._flushed >= target or self._broken, timeout=self.write_timeout + 10)
        self._check()
        if not ok:
            raise AgentLinkError("the PINJ Modem Agent did not confirm the write in time")

    @property
    def in_waiting(self) -> int:
        with self._rx_lock:
            return len(self._rx)

    def read(self, n: int = 1) -> bytes:
        with self._rx_lock:
            chunk = bytes(self._rx[:n])
            del self._rx[:n]
        return chunk

    def reset_input_buffer(self):
        with self._rx_lock:
            self._rx.clear()

    @property
    def rts(self) -> bool:
        return self._rts

    @rts.setter
    def rts(self, value: bool):
        self._rts = bool(value)
        if not self._broken:
            try:
                LINK.send({"op": "rts", "h": self.h, "v": self._rts})
            except AgentLinkError:
                pass

    def close(self) -> None:
        if not self.is_open:
            return
        self.is_open = False
        try:
            LINK.send({"op": "close", "h": self.h})
        except AgentLinkError:
            pass
        LINK._handles.pop(self.h, None)

    def __repr__(self) -> str:
        return f"RemoteSerialPort({self.port!r}, baud={self.baudrate})"
