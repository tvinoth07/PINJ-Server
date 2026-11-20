/**
 * Library.jsx — 📂 the shared input files kept on the PINJ server PC (APD, MA tables, RFID tag files,
 * SVK / OVK storyboards), offered to every signed-in user from any PC.
 *
 * 👤 MY FILES: each user's own files on the server (data/user_files/<user>/…) — uploaded by them, seen only by them.
 *
 * LibraryButton sits under a loader's drop zone. Picking a file downloads it from the server and hands it to
 * the loader exactly as if it had been dropped there, so the loaders themselves are unchanged.
 * The folders are set by an administrator (Settings → 📂 LIBRARY, see LibraryAdminPanel).
 */
import { useEffect, useRef, useState } from "react";
import { hub } from "./Auth";

const fmtSize = n => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB";

let _cats = null;                                         // cached /hub/library
function loadCats() {
  if (!_cats) _cats = hub("/hub/library").then(r => r.categories).catch(e => { _cats = null; throw e; });
  return _cats;
}

export function LibraryButton({ categories, title, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="Pick a file kept on the PINJ server PC — no need to have it on this PC"
        style={{
          display: "block", width: "calc(100% - 20px)", margin: "0 10px 2px", padding: "5px 8px", borderRadius: 4,
          border: "1px dashed var(--cyan-dim)", background: "var(--cyan-glow)", color: "var(--cyan)", cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
        }}>📂 FROM PINJ SERVER LIBRARY · 👤 MY FILES</button>
      {open && <LibraryDialog categories={categories} title={title} onClose={() => setOpen(false)}
        onPick={f => { setOpen(false); onPick(f); }} />}
    </>
  );
}

function LibraryDialog({ categories, title, onClose, onPick }) {
  const [cats, setCats] = useState(null);
  const [cat, setCat] = useState(categories[0]);
  const [sub, setSub] = useState("");
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [filter, setFilter] = useState("");
  const [src, setSrc] = useState(() => { try { return localStorage.getItem("pinj-library-src") || "server"; } catch (_) { return "server"; } });
  const [note, setNote] = useState(null);
  const [reload, setReload] = useState(0);
  const upRef = useRef(null);
  const mine = src === "mine";
  const chooseSrc = v => { setSrc(v); setSub(""); setFilter(""); setNote(null); try { localStorage.setItem("pinj-library-src", v); } catch (_) { /* blocked */ } };

  useEffect(() => { loadCats().then(c => setCats(c.filter(x => categories.includes(x.id)))).catch(e => setErr(e.message)); }, []);
  useEffect(() => {
    setList(null); setErr(null);
    const url = mine ? `/hub/myfiles/${cat}` : `/hub/library/${cat}?sub=${encodeURIComponent(sub)}`;
    hub(url).then(setList).catch(e => setErr(e.message));
  }, [cat, sub, src, reload]);

  const upload = async files => {
    setNote(null); setErr(null);
    for (const f of files) {
      setBusy(f.name);
      try {
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetch(`/hub/myfiles/${cat}`, { method: "POST", body: fd, credentials: "same-origin" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
        setNote({ tone: "ok", text: `${j.name} ${j.replaced ? "replaced (newer copy saved)" : "saved"} in your files on the server.` });
      } catch (e) {
        setNote({ tone: "err", text: `${f.name}: ${e.message}` });
      } finally {
        setBusy(null);
      }
    }
    setReload(n => n + 1);
  };

  const remove = async (ev, entry) => {
    ev.stopPropagation();
    if (!window.confirm(`Remove ${entry.name} from your files on the server?`)) return;
    try {
      await hub(`/hub/myfiles/${cat}/file?name=${encodeURIComponent(entry.name)}`, { method: "DELETE" });
      setNote({ tone: "ok", text: `${entry.name} removed.` });
      setReload(n => n + 1);
    } catch (e) { setNote({ tone: "err", text: e.message }); }
  };
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const pick = async entry => {
    if (entry.dir) { setSub(sub ? sub + "/" + entry.name : entry.name); setFilter(""); return; }
    setBusy(entry.name); setErr(null);
    try {
      const path = sub ? sub + "/" + entry.name : entry.name;
      const url = mine ? `/hub/myfiles/${cat}/file?name=${encodeURIComponent(entry.name)}`
                       : `/hub/library/${cat}/file?path=${encodeURIComponent(path)}`;
      const r = await fetch(url, { credentials: "same-origin" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
      const blob = await r.blob();
      onPick(new File([blob], entry.name, { type: blob.type, lastModified: Date.now() }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  // ⬇ — save the file on this PC (the row itself still loads it into the loader)
  const download = (ev, entry) => {
    ev.stopPropagation();
    const path = sub ? sub + "/" + entry.name : entry.name;
    const a = document.createElement("a");
    a.href = mine ? `/hub/myfiles/${cat}/file?name=${encodeURIComponent(entry.name)}&download=1`
                  : `/hub/library/${cat}/file?path=${encodeURIComponent(path)}&download=1`;
    a.download = entry.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setNote({ tone: "ok", text: `${entry.name} — downloading to this PC (see your browser's downloads).` });
  };

  const crumbs = sub ? sub.split("/") : [];
  const entries = (list?.entries || []).filter(e => !filter || e.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 6000, background: "rgba(2,8,6,0.55)", backdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div role="dialog" aria-label="PINJ server library"
        onDragOver={e => { if (mine) e.preventDefault(); }}
        onDrop={e => { if (!mine) return; e.preventDefault(); const f = [...e.dataTransfer.files]; if (f.length) upload(f); }}
        style={{
        width: "min(640px, 100%)", maxHeight: "min(80vh, 700px)", display: "flex", flexDirection: "column",
        background: "var(--bg-surface)", border: "1px solid var(--border-bright)", borderRadius: 8, overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.45)", fontFamily: "var(--font-mono)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-raised)" }}>
          <span style={{ fontSize: 14 }}>📂</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", color: "var(--cyan)" }}>PINJ SERVER LIBRARY</span>
          <span style={{ fontSize: 9, color: "var(--text-secondary)" }}>· {title}</span>
          <button onClick={onClose} title="Close (Esc)" style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: 4, border: "1px solid var(--border)",
            background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 6, padding: "10px 14px 2px" }}>
          {[["server", "📂 PINJ LIBRARY", "Shared files on the PINJ server PC (read-only)"],
            ["mine", "👤 MY FILES", "Your own files, kept on the server in your folder — only you see them"]].map(([v, label, tip]) => (
            <button key={v} onClick={() => chooseSrc(v)} title={tip} style={{
              flex: 1, padding: "7px 0", borderRadius: 5, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
              border: "1px solid " + (src === v ? "var(--green-deep)" : "var(--border)"),
              background: src === v ? "var(--green-glow)" : "transparent", color: src === v ? "var(--green)" : "var(--text-secondary)",
            }}>{label}</button>
          ))}
        </div>

        {cats && cats.length > 1 && (
          <div style={{ display: "flex", gap: 4, padding: "8px 14px 0" }}>
            {cats.map(c => (
              <button key={c.id} onClick={() => { setCat(c.id); setSub(""); setFilter(""); }} style={{
                padding: "5px 12px", borderRadius: "5px 5px 0 0", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 700,
                border: "1px solid " + (cat === c.id ? "var(--cyan-dim)" : "var(--border)"), borderBottom: "none",
                background: cat === c.id ? "var(--cyan-glow)" : "transparent", color: cat === c.id ? "var(--cyan)" : "var(--text-secondary)",
              }}>{c.label.toUpperCase()}</button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 10, flexWrap: "wrap" }}>
          <button onClick={() => setSub("")} style={crumbBtn(!sub)}>{mine ? "My " : ""}{(cats || []).find(c => c.id === cat)?.label || cat}</button>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--text-secondary)" }}>›</span>
              <button onClick={() => setSub(crumbs.slice(0, i + 1).join("/"))} style={crumbBtn(i === crumbs.length - 1)}>{c}</button>
            </span>
          ))}
          {mine && <>
            <input ref={upRef} type="file" multiple accept={(list?.exts || []).join(",")} style={{ display: "none" }}
              onChange={e => { const f = [...e.target.files]; e.target.value = ""; if (f.length) upload(f); }} />
            <button onClick={() => upRef.current?.click()} disabled={!!busy} style={{
              marginLeft: 8, padding: "4px 12px", borderRadius: 4, border: "1px solid var(--green-deep)", background: "var(--green-glow)",
              color: "var(--green)", cursor: busy ? "wait" : "pointer", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 800, letterSpacing: "0.08em",
            }}>⬆ UPLOAD FROM THIS PC</button>
          </>}
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter…" style={{
            marginLeft: "auto", width: 150, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border-bright)",
            background: "var(--bg-input)", color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 10, outline: "none" }} />
        </div>

        <div style={{ flex: 1, minHeight: 120, overflowY: "auto" }}>
          {err && <div style={{ padding: 14, fontSize: 10.5, color: "var(--red)" }}>✖ {err}</div>}
          {!err && !list && <div style={{ padding: 14, fontSize: 10, color: "var(--text-secondary)" }}>Loading…</div>}
          {note && <div style={{ padding: "8px 14px", fontSize: 10, borderBottom: "1px solid var(--border)",
            color: note.tone === "err" ? "var(--red)" : "var(--green)" }}>{note.tone === "err" ? "✖ " : "✓ "}{note.text}</div>}
          {list && !entries.length && <div style={{ padding: 14, fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {mine && !filter ? <>No files of yours here yet. Press <b>⬆ UPLOAD FROM THIS PC</b> (or drop files on this window) — they are kept
              on the PINJ server in your own folder, so you can load them from any PC.</> : "No matching files here."}</div>}
          {entries.map(e => (
            <button key={(e.dir ? "d:" : "f:") + e.name} onClick={() => pick(e)} disabled={!!busy} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 14px", border: "none",
              borderBottom: "1px solid var(--border)", background: busy === e.name ? "var(--cyan-glow)" : "transparent",
              color: "var(--text-primary)", cursor: busy ? "wait" : "pointer", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: 10.5,
            }} onMouseEnter={ev => { ev.currentTarget.style.background = "var(--bg-raised)"; }}
               onMouseLeave={ev => { ev.currentTarget.style.background = busy === e.name ? "var(--cyan-glow)" : "transparent"; }}>
              <span style={{ width: 16, textAlign: "center" }}>{e.dir ? "📁" : /\.(csv|txt)$/i.test(e.name) ? "▦" : "▤"}</span>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", color: e.dir ? "var(--amber-text, var(--amber))" : undefined }}>{e.name}</span>
              <span style={{ color: "var(--text-secondary)", fontSize: 9, flexShrink: 0 }}>{e.modified}</span>
              <span style={{ color: "var(--text-secondary)", fontSize: 9, width: 56, textAlign: "right", flexShrink: 0 }}>
                {busy === e.name ? "⏳" : e.dir ? "" : fmtSize(e.size)}</span>
              {!e.dir ? <span role="button" title="Download to this PC" onClick={ev => download(ev, e)}
                style={{ flexShrink: 0, width: 22, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 4, border: "1px solid var(--cyan-dim)", color: "var(--cyan)", fontSize: 11 }}>⬇</span>
                : <span style={{ flexShrink: 0, width: 22 }} />}
              {mine && <span role="button" title="Remove from my files" onClick={ev => remove(ev, e)}
                style={{ flexShrink: 0, padding: "0 4px", color: "var(--red)", opacity: 0.8 }}>🗑</span>}
            </button>
          ))}
        </div>
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-raised)", fontSize: 9, color: "var(--text-secondary)" }}>
          {mine ? "Your files: kept on the PINJ server in your own folder — only you see them. Picking one loads it like dropping it on the loader; ⬇ saves a copy on this PC."
                : "Files stay on the PINJ server; picking one loads it here exactly like dropping it on the loader. ⬇ saves a copy on this PC."}
        </div>
      </div>
    </div>
  );
}

const crumbBtn = last => ({
  border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10,
  color: last ? "var(--cyan)" : "var(--text-secondary)", fontWeight: last ? 700 : 400,
});

/** Settings → 📂 LIBRARY (administrators): which folders on the server PC are offered to everybody. */
export function LibraryAdminPanel() {
  const [cats, setCats] = useState(null);
  const [paths, setPaths] = useState({});
  const [msg, setMsg] = useState(null);
  const load = () => hub("/hub/library").then(r => { setCats(r.categories); setPaths(Object.fromEntries(r.categories.map(c => [c.id, c.path || ""]))); })
    .catch(e => setMsg({ tone: "err", text: e.message }));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setMsg(null);
    try {
      const r = await hub("/hub/library", { method: "PUT", body: { paths } });
      setCats(r.categories);
      _cats = null;
      setMsg({ tone: "ok", text: "Saved — every user sees these folders now." });
    } catch (e) { setMsg({ tone: "err", text: e.message }); }
  };
  if (!cats) return <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>{msg?.text || "Loading…"}</div>;
  return (
    <>
      <div style={{ fontSize: 9.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
        Folders on <b>this server PC</b> whose files every signed-in user can load from any PC
        (📂 FROM PINJ SERVER LIBRARY under each SVK SIM loader). Users can only read them — nothing is changed or deleted.
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-card)", overflow: "hidden" }}>
        {cats.map((c, i) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <span style={{ width: 130, flexShrink: 0, fontSize: 10, color: "var(--text-primary)", fontWeight: 700 }}>{c.label}</span>
            <input value={paths[c.id] || ""} onChange={e => setPaths(p => ({ ...p, [c.id]: e.target.value }))} spellCheck={false} style={{
              flex: 1, minWidth: 0, padding: "6px 9px", borderRadius: 4, border: "1px solid var(--border-bright)", background: "var(--bg-input)",
              color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 10.5, outline: "none" }} />
            <span title={c.available ? "Folder found" : "Folder not found on the server PC"} style={{ color: c.available ? "var(--green)" : "var(--red)", fontSize: 12 }}>
              {c.available ? "●" : "✖"}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
          <button className="sa-btn primary" onClick={save}>✓ SAVE FOLDERS</button>
        </div>
        {msg && <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 10,
          color: msg.tone === "err" ? "var(--red)" : "var(--green)" }}>{msg.text}</div>}
      </div>
    </>
  );
}
