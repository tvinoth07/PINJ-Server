"""
compare_svk_sim.py — proves backend/svk_sim_py.py (pure Python) gives exactly the same
output as backend/svk_sim.c (the original C encoder).

Runs on Linux / WSL (needs gcc to build the C reference into a temp folder):
    python3 tools/compare_svk_sim.py [--storyboards DIR] [--apd DIR] [--fuzz N]

Compared, byte for byte / value for value:
  • encode_storyboard_csv() on every real storyboard (.csv, .xlsx first sheet), radio 1 and 2,
    with no track profile and with each real APD workbook loaded (real ROUTE1..4 combinations)
  • thousands of generated rows in all five layouts (35+/28/19/15/10 columns) with awkward values
  • generated track profiles that exercise every amalgamation rule (count limits, clamping, TLI joins)
  • svk_load_track_profile() row counts, parse_station_xml() / parse_storyboard_xml() JSON text
  • transmit_storyboard_csv(): the UDP datagrams both send for the same storyboard
Exit code 0 = everything identical.
"""
import argparse, ast, ctypes, glob, io, json, os, random, socket, subprocess, sys, tempfile, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "backend")
sys.path.insert(0, BACKEND)
import svk_sim_py as P                                      # noqa: E402

# ── build + load the C reference ────────────────────────────────────────────
_tmp = tempfile.mkdtemp(prefix="svkcmp_")
_so = os.path.join(_tmp, "svk_sim.so")
subprocess.check_call(["gcc", "-shared", "-fPIC", "-O2", os.path.join(BACKEND, "svk_sim.c"), "-o", _so])
C = ctypes.CDLL(_so)
C.encode_storyboard_csv.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
C.parse_station_xml.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
C.parse_storyboard_xml.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
C.svk_load_track_profile.argtypes = [ctypes.c_char_p]
C.svk_ota_prefix_hex.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
C.transmit_storyboard_csv.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_int,
                                      ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
_EBUF = ctypes.create_string_buffer(8 << 20)
_PBUF = ctypes.create_string_buffer(1 << 20)

stats = {"checks": 0, "rows": 0, "fail": 0}
fails = []


def fail(label, detail):
    stats["fail"] += 1
    if len(fails) < 15:
        fails.append(f"{label}: {detail}")


def c_encode(csv, rid):
    rc = C.encode_storyboard_csv(csv.encode("utf-8"), rid, _EBUF, len(_EBUF))
    return ("err", rc) if rc != 0 else json.loads(_EBUF.value.decode("utf-8"))


def py_encode(csv, rid):
    try:
        return P.encode_storyboard_csv(csv, rid)
    except Exception as e:                                  # noqa: BLE001
        return ("exc", repr(e))


def check_encode(csv, rid, label):
    """C before and after Python must agree (same 2-s epoch), then Python must equal C.
    C's time() reads the coarse kernel clock (a few ms behind Python's time.time()), so right at a
    2-s edge Python can already be in the next epoch while both C calls are not — such a run is
    repeated; only a difference that persists across several runs counts."""
    c1 = py = None
    for _ in range(12):
        c1 = c_encode(csv, rid)
        py = py_encode(csv, rid)
        c2 = c_encode(csv, rid)
        if c1 == c2 and py == c1:
            break
        if c1 == c2:
            time.sleep(0.05)                             # move away from the epoch edge, try again
    else:
        if c1 != c2:
            fail(label, "clock kept changing")
            return
    stats["checks"] += 1
    if isinstance(c1, list):
        stats["rows"] += len(c1)
    if py != c1:
        if isinstance(c1, list) and isinstance(py, list):
            for a, b in zip(c1, py):
                if a != b:
                    diff = {k: (a.get(k), b.get(k)) for k in set(a) | set(b) if a.get(k) != b.get(k)}
                    fail(label, f"line {a.get('line_num')}: {diff}")
                    return
            fail(label, f"row count C {len(c1)} vs Py {len(py)}")
        else:
            fail(label, f"C {str(c1)[:120]} vs Py {str(py)[:120]}")


def load_profile_both(text, label):
    rc = C.svk_load_track_profile(text.encode("utf-8"))
    rp = P.svk_load_track_profile(text)
    stats["checks"] += 1
    if rc != rp:
        fail(label, f"track profile rows C {rc} vs Py {rp}")


def check_xml(kind, xml, label):
    fn_c = C.parse_station_xml if kind == "station" else C.parse_storyboard_xml
    fn_p = P.parse_station_xml if kind == "station" else P.parse_storyboard_xml
    rc = fn_c(xml.encode("utf-8"), _PBUF, len(_PBUF))
    if rc != 0:
        c = ("err", rc)
    else:
        try:
            c = _PBUF.value.decode("utf-8")
        except UnicodeDecodeError:
            c = ("decode",)
    try:
        p = fn_p(xml)
    except UnicodeDecodeError:
        p = ("decode",)
    except ValueError:
        p = ("err", -1)
    stats["checks"] += 1
    if c != p:
        fail(label, f"C {str(c)[:150]} | Py {str(p)[:150]}")


# ── real data ───────────────────────────────────────────────────────────────
def xlsx_to_csv(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb[wb.sheetnames[0]]
    lines = []
    for row in ws.iter_rows(values_only=True):
        lines.append(",".join("" if v is None else (str(int(v)) if isinstance(v, float) and v.is_integer() else str(v))
                              for v in row))
    return "\n".join(lines)


def build_track_profile_text(xlsx_path):
    """main.py's own _build_track_profile_text(), taken from its source (no main import)."""
    src = open(os.path.join(BACKEND, "main.py"), encoding="utf-8").read()
    tree = ast.parse(src)
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_build_track_profile_text")
    used = {n.id for n in ast.walk(fn) if isinstance(n, ast.Name)}
    ns = {}
    for node in tree.body:                               # the module constants the function reads
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
        if any(isinstance(t, ast.Name) and t.id in used for t in targets):
            try:
                exec(compile(ast.Module(body=[node], type_ignores=[]), "main.py", "exec"), ns)
            except Exception:                            # noqa: BLE001
                pass
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "main.py", "exec"), ns)
    text = ns["_build_track_profile_text"](open(xlsx_path, "rb").read())[0]
    return text


# ── generators ──────────────────────────────────────────────────────────────
R = random.Random(20261109)


def rnd_val():
    k = R.random()
    if k < 0.30:
        return str(R.randint(0, 15))
    if k < 0.55:
        return str(R.randint(0, 200000))
    if k < 0.65:
        return str(-R.randint(0, 40000))
    if k < 0.72:
        return str(R.choice([0, 1, 31, 32767, 65535, 131071, 2 ** 23 - 1, 2 ** 32 - 1, 2 ** 32, 2 ** 40]))
    if k < 0.76:
        return ""
    if k < 0.79:
        return " " + str(R.randint(0, 999))
    if k < 0.81:
        return "+" + str(R.randint(0, 999))
    if k < 0.82:
        return str(R.randint(0, 99)) + R.choice([" ", "x", ".5", " 7"])
    if k < 0.83:
        return R.choice(["99999999999999999999", "-99999999999999999999"])
    return str(R.randint(0, 4095))


def rnd_row(snos):
    ncol = R.choice([35, 35, 35, 36, 37, 37, 39, 28, 28, 30, 34, 19, 19, 15, 15, 10, 10,
                     5, 12, 20, 27, 41, 56, 60])
    vals = [rnd_val() for _ in range(ncol)]
    if ncol > 1 and R.random() < 0.9:
        vals[1] = str(R.choice([9, 9, 9, 10, 11, 12, 13, 7, 14]))
    if ncol >= 35 and snos and R.random() < 0.8:
        nr = max(0, min(4, (ncol - 2) - 31))
        for k in range(nr):
            vals[31 + k] = str(R.choice(snos + [0, 0, 999]))
    if ncol >= 35 and R.random() < 0.5:
        vals[-1] = "0"
    line = ",".join(vals)
    k = R.random()
    if k < 0.05:
        line = "#" + line
    elif k < 0.08:
        line = "  \t" + line
    elif k < 0.10:
        line = ""
    elif k < 0.11:
        line = line + ","
    return line


def rnd_storyboard(snos, nrows):
    eol = R.choice(["\n", "\r\n", "\r"])
    frame = 1
    lines = ["#TDMASlot,pktType,... (header)"]
    for _ in range(nrows):
        line = rnd_row(snos)
        if R.random() < 0.4:
            frame += 2
        parts = line.split(",")
        if len(parts) > 3 and not line.startswith("#"):
            parts[3] = str(frame)
            line = ",".join(parts)
        lines.append(line)
    return eol.join(lines) + R.choice(["", eol])


class Bits:
    def __init__(self):
        self.s = ""

    def w(self, v, n):
        self.s += format(v & ((1 << n) - 1), f"0{n}b")

    def hexs(self, typ):
        bits = format(typ, "04b") + "0000000" + self.s
        bits += "0" * (-len(bits) % 8)
        nb = len(bits) // 8
        ln = format((nb - 1) & 0x7F, "07b")
        bits = bits[:4] + ln + bits[11:]
        b = bytes(int(bits[i:i + 8], 2) for i in range(0, len(bits), 8))
        sep = R.choice([" ", ",", "", "  "])
        pad = R.choice([0, 0, 10, 40])
        return sep.join(f"{x:02X}" for x in b + bytes(pad))


def rnd_subpkt(typ):
    b = Bits()
    if typ in (1, 2):
        cnt = R.choice([1, 2, 3, 8, 31, 0])
        b.w(cnt, 5)
        for _ in range(cnt):
            b.w(R.choice([R.randint(0, 2000), R.randint(0, 32767)]), 15)
            if typ == 1:
                cls = R.randint(0, 1)
                b.w(cls, 1)
                b.w(R.randint(0, 2 ** 18 - 1), 18 if cls else 6)
            else:
                b.w(R.randint(0, 1), 1)
                b.w(R.randint(0, 31), 5)
    elif typ == 3:
        cnt = R.choice([1, 2, 5, 31])
        b.w(cnt, 5)
        for _ in range(cnt):
            b.w(R.choice([R.randint(0, 3000), 32000]), 15)
            for wdt in (10, 3, 1, 3, 3):
                b.w(R.randint(0, (1 << wdt) - 1), wdt)
    elif typ == 4:
        cnt = R.randint(0, 3)
        b.w(cnt, 2)
        for _ in range(cnt):
            sp = R.choice([0x1F, R.randint(0, 30)])
            b.w(sp, 5)
            if sp != 0x1F:
                b.w(R.choice([R.randint(0, 3000), 32700]), 15)
                b.w(R.randint(0, 4095), 12)
    elif typ == 5:
        b.w(R.randint(0, 15), 4)
        cnt = R.choice([1, 2, 3, 10, 30, 63])
        b.w(cnt, 6)
        for i in range(min(cnt, 40)):
            b.w(R.randint(0, 2047), 11)
            b.w(R.choice([498, 500, 502, 504, R.randint(0, 1023)]), 10)
            b.w(R.randint(0, 1), 1)
        alr = R.randint(0, 1)
        b.w(alr, 1)
        if alr:
            b.w(R.randint(0, 32767), 15)
            b.w(R.randint(0, 3), 2)
            b.w(R.randint(0, 2 ** 23 - 1), 23)
        adj = R.randint(0, 7)
        b.w(adj, 3)
        if adj <= 5:
            for _ in range(adj + 1):
                b.w(R.choice([1, 2, 3, R.randint(0, 511)]), 9)
    elif typ == 6:
        cnt = R.choice([1, 2, 15])
        b.w(cnt, 4)
        for _ in range(cnt):
            b.w(R.randint(0, 15), 4)
            b.w(R.choice([R.randint(0, 3000), 32767]), 15)
            b.w(R.randint(0, 32767), 15)
    return b.hexs(typ)


def rnd_profile_text(nrows):
    lines = []
    for s in range(1, nrows + 1):
        fields = []
        for typ in (1, 2, 3, 4, 5, 6):
            k = R.random()
            fields.append("F0 00 00 00" if k < 0.25 else rnd_subpkt(typ) if k < 0.97 else "zz 1")
        lines.append(f"{s}|" + "|".join(fields))
    if R.random() < 0.3:
        lines.insert(R.randint(0, len(lines)), "S.No|junk")
    return R.choice(["\n", "\r\n"]).join(lines)


def rnd_text(n):
    alphabet = 'abcXYZ 012_-"\\<>/=éß'
    return "".join(R.choice(alphabet) for _ in range(n))


def rnd_station_xml():
    parts = ["<?xml?>", "<Stations>"]
    for _ in range(R.randint(0, 4)):
        parts.append(f'<Station id="{rnd_text(R.randint(0, 70))}" name="{rnd_text(R.randint(0, 140))}" '
                     f'type="{rnd_text(R.randint(0, 40))}">')
        parts.append(f"<KmPost> {rnd_text(R.randint(0, 40))} </KmPost><Section>{rnd_text(R.randint(0, 70))}</Section>")
        if R.random() < 0.7:
            parts.append(f'<Location lat="{R.random()*30:.5f}" lon="{rnd_text(R.randint(0, 40))}"/>')
        if R.random() < 0.8:
            parts.append("<Signals>" + "".join(
                f'<Signal id="{rnd_text(R.randint(0, 40))}" type="S" aspect="{rnd_text(R.randint(0, 40))}"/>'
                for _ in range(R.randint(0, 8))) + R.choice(["</Signals>", ""]))
        if R.random() < 0.8:
            parts.append("<Points>" + "".join(
                f'<Point id="P{i}" normal="{rnd_text(R.randint(0, 40))}" status="N"/>'
                for i in range(R.randint(0, 8))) + "</Points>")
        parts.append(R.choice(["</Station>", "</Station>", ""]))
    parts.append("</Stations>")
    return "".join(parts)


def rnd_storyboard_xml():
    parts = [f'<StoryBoard name="{rnd_text(R.randint(0, 140))}" version="{rnd_text(R.randint(0, 40))}">']
    if R.random() < 0.8:
        parts.append(f"<Meta><Author>{rnd_text(R.randint(0, 140))}</Author><Date>{rnd_text(20)}</Date>"
                     f"<Description>{rnd_text(R.randint(0, 300))}</Description>{R.choice(['</Meta>', ''])}")
    for _ in range(R.randint(0, 3)):
        parts.append(f'<Story name="{rnd_text(R.randint(0, 140))}">')
        for _ in range(R.randint(0, 3)):
            parts.append(f'<Act name="{rnd_text(R.randint(0, 140))}">')
            for _ in range(R.randint(0, 3)):
                parts.append(f'<Event name="{rnd_text(R.randint(0, 140))}" priority="{rnd_text(R.randint(0, 70))}">')
                if R.random() < 0.7:
                    parts.append(f'<SpeedActionDynamics value="{rnd_text(R.randint(0, 40))}" '
                                 f'dynamicsUnit="kmph" dynamicsShape="{rnd_text(R.randint(0, 40))}"/>')
                if R.random() < 0.7:
                    parts.append(f'<Condition name="{rnd_text(R.randint(0, 140))}">'
                                 f'<SimulationTimeCondition value="{R.randint(0, 99)}" rule="{rnd_text(R.randint(0, 70))}"/>'
                                 f"</Condition>")
                parts.append("</Event>")
            parts.append("</Act>")
        parts.append("</Story>")
    parts.append("</StoryBoard>")
    return "".join(parts)


# ── transmit (UDP) ──────────────────────────────────────────────────────────
def capture(port, out, stop):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", port))
    s.settimeout(0.2)
    while not stop.is_set():
        try:
            out.append(s.recvfrom(4096)[0])
        except socket.timeout:
            pass
    s.close()


def check_transmit(csv, rid, label):
    for _ in range(4):
        while not (0.4 < time.time() % 2 < 0.8):            # start away from a 2-s wall-clock edge
            time.sleep(0.02)
        got_c, got_p, stop = [], [], threading.Event()
        caps = [threading.Thread(target=capture, args=(47011, got_c, stop)),
                threading.Thread(target=capture, args=(47012, got_p, stop))]
        for t in caps:
            t.start()
        time.sleep(0.05)
        flag = ctypes.c_int(0)
        res = {}
        tc = threading.Thread(target=lambda: res.__setitem__("c", C.transmit_storyboard_csv(
            csv.encode(), b"127.0.0.1", 47011, 0, rid, ctypes.pointer(flag))))
        tp = threading.Thread(target=lambda: res.__setitem__("p", P.transmit_storyboard_csv(
            csv, "127.0.0.1", 47012, 0, rid, threading.Event())))
        tc.start(); tp.start(); tc.join(); tp.join()
        time.sleep(0.3)
        stop.set()
        for t in caps:
            t.join()
        if got_c == got_p and res.get("c") == res.get("p"):
            stats["checks"] += 1
            return len(got_c)
    fail(label, f"UDP differs: C {len(got_c)} rc {res.get('c')} vs Py {len(got_p)} rc {res.get('p')}")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--storyboards", default="/mnt/c/Users/Vinoth/Documents/VINOTH/StoryBoard")
    ap.add_argument("--apd", default="/mnt/c/Users/Vinoth/Documents/VINOTH/Felix/APD FOR PINJ")
    ap.add_argument("--fuzz", type=int, default=400)
    a = ap.parse_args()

    # OTA prefix
    for rid in (1, 2):
        buf = ctypes.create_string_buffer(8)
        C.svk_ota_prefix_hex(rid, buf, 8)
        stats["checks"] += 1
        if buf.value.decode() != P.ota_prefix_hex(rid):
            fail("ota_prefix", rid)

    sbs = []
    for path in sorted(glob.glob(os.path.join(a.storyboards, "**", "*"), recursive=True)):
        low = path.lower()
        if low.endswith(".csv"):
            sbs.append((os.path.basename(path), open(path, encoding="utf-8", errors="replace").read()))
        elif low.endswith(".xlsx") and not os.path.basename(path).startswith("~$"):
            sbs.append((os.path.basename(path), xlsx_to_csv(path)))
    profiles = []
    for path in sorted(glob.glob(os.path.join(a.apd, "*.xlsx"))):
        if os.path.basename(path).startswith("~$"):
            continue
        try:
            profiles.append((os.path.basename(path), build_track_profile_text(path)))
        except Exception as e:                              # noqa: BLE001
            print(f"  (skipped APD {os.path.basename(path)}: {e})")
    print(f"real storyboards: {len(sbs)} · APD workbooks: {len(profiles)}")

    # 1. real storyboards, no profile, both radios
    load_profile_both("", "empty profile")
    for name, csv in sbs:
        for rid in (1, 2):
            check_encode(csv, rid, f"{name} r{rid}")
    print(f"[1] real storyboards: {stats['checks']} checks, {stats['rows']} rows, fails {stats['fail']}")

    # 2. each real APD profile + real storyboards + routed fuzz using its S.No values
    for pname, text in profiles:
        load_profile_both(text, pname)
        snos = sorted({int(l.split("|", 1)[0]) for l in text.splitlines() if l.split("|", 1)[0].strip().isdigit()})
        for name, csv in sbs:
            check_encode(csv, 1, f"{pname} + {name}")
        for k in range(40):
            check_encode(rnd_storyboard(snos, R.randint(5, 25)), R.choice((1, 2)), f"{pname} fuzz#{k}")
    print(f"[2] + real APD profiles: {stats['checks']} checks, {stats['rows']} rows, fails {stats['fail']}")

    # 3. generated profiles stressing amalgamation, generated storyboards
    for k in range(a.fuzz):
        text = rnd_profile_text(R.randint(2, 12))
        load_profile_both(text, f"gen profile #{k}")
        snos = list(range(1, 13))
        check_encode(rnd_storyboard(snos, R.randint(3, 30)), R.choice((1, 2)), f"gen #{k}")
    print(f"[3] + generated profiles/storyboards: {stats['checks']} checks, {stats['rows']} rows, fails {stats['fail']}")

    # 4. XML parsers
    for k in range(a.fuzz):
        check_xml("station", rnd_station_xml(), f"station xml #{k}")
        check_xml("storyboard", rnd_storyboard_xml(), f"storyboard xml #{k}")
    print(f"[4] + XML parsers: {stats['checks']} checks, fails {stats['fail']}")

    # 5. paced UDP transmit (3 frame groups each)
    load_profile_both(profiles[-1][1] if profiles else "", "tx profile")
    tx_sb = "\n".join(l for l in sbs[0][1].splitlines()[:12]) if sbs else ""
    for name, csv in [s for s in sbs if "S2S" in s[0] or "AccAuth" in s[0] or "L2S" in s[0]][:3]:
        rows = [l for l in csv.splitlines() if l.strip() and not l.lstrip().startswith("#")]
        frames = []
        for l in rows:
            f = l.split(",")[3] if len(l.split(",")) > 3 else ""
            if f not in frames:
                frames.append(f)
        keep = set(frames[:3])
        short = "\n".join(l for l in rows if (l.split(",")[3] if len(l.split(",")) > 3 else "") in keep)
        n = check_transmit(short, 1, f"transmit {name}")
        print(f"    transmit {name[:60]}: {n} datagrams identical" if n else f"    transmit {name}: DIFFERENT")
    print(f"[5] + UDP transmit: {stats['checks']} checks, fails {stats['fail']}")

    print("\n=== RESULT:", "IDENTICAL" if stats["fail"] == 0 else f"{stats['fail']} DIFFERENCES",
          f"— {stats['checks']} checks, {stats['rows']} encoded rows ===")
    for f in fails:
        print("  ✗", f)
    sys.exit(0 if stats["fail"] == 0 else 1)


if __name__ == "__main__":
    main()
