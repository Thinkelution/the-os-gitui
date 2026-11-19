import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore, type Dialog } from "../store";
import { api } from "../lib/git";

export function Dialogs() {
  const d = useStore((s) => s.dialog);
  if (!d) return null;
  if (d.kind === "prompt") return <PromptDialog d={d} />;
  if (d.kind === "confirm") return <ConfirmDialog d={d} />;
  return <CloneDialog />;
}

function Modal(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-overlay" onMouseDown={props.onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{props.title}</div>
        {props.children}
      </div>
    </div>
  );
}

function PromptDialog({ d }: { d: Extract<Dialog, { kind: "prompt" }> }) {
  const [value, setValue] = useState(d.value ?? "");
  const [checked, setChecked] = useState(d.check?.value ?? false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const ok = () => d.resolve({ value, checked });
  const cancel = () => d.resolve(null);
  return (
    <Modal title={d.title} onClose={cancel}>
      {d.label && <label className="field-label">{d.label}</label>}
      <input
        ref={ref}
        className="field"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") ok();
          if (e.key === "Escape") cancel();
        }}
      />
      {d.check && (
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {d.check.label}
        </label>
      )}
      <div className="modal-actions">
        <button onClick={cancel}>Cancel</button>
        <button className="primary" onClick={ok}>{d.ok ?? "OK"}</button>
      </div>
    </Modal>
  );
}

function ConfirmDialog({ d }: { d: Extract<Dialog, { kind: "confirm" }> }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Modal title={d.title} onClose={() => d.resolve(false)}>
      <p className="modal-msg">{d.message}</p>
      <div className="modal-actions">
        <button ref={ref} onClick={() => d.resolve(false)} onKeyDown={(e) => e.key === "Escape" && d.resolve(false)}>Cancel</button>
        <button className={d.danger ? "danger" : "primary"} onClick={() => d.resolve(true)}>{d.ok ?? "OK"}</button>
      </div>
    </Modal>
  );
}

export function repoNameFromUrl(url: string): string {
  return url.trim().replace(/[/\\]+$/, "").replace(/\.git$/, "").split(/[/:\\]/).pop() ?? "";
}

function CloneDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const openPath = useStore((s) => s.openPath);
  const [url, setUrl] = useState("");
  const [dir, setDir] = useState(localStorage.getItem("cloneDir") ?? "");
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!touched) setName(repoNameFromUrl(url));
  }, [url, touched]);

  useEffect(() => {
    const un = listen<string>("clone-progress", (e) => setProgress(e.payload));
    return () => void un.then((f) => f());
  }, []);

  const browse = async () => {
    const r = await open({ directory: true, title: "Clone into which folder?" });
    if (typeof r === "string") setDir(r);
  };

  const close = () => !busy && setDialog(null);
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      const dest = dir.replace(/[\\/]+$/, "") + "/" + name.trim();
      const info = await api.clone(url.trim(), dest);
      localStorage.setItem("cloneDir", dir);
      setDialog(null);
      await openPath(info.path);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  const ready = url.trim() && dir.trim() && name.trim() && !busy;

  return (
    <Modal title="Clone a repository" onClose={close}>
      <label className="field-label">Repository URL</label>
      <input className="field" autoFocus placeholder="https://github.com/user/repo.git or git@github.com:user/repo.git" value={url} onChange={(e) => setUrl(e.target.value)} />
      <label className="field-label">Where to clone</label>
      <div className="row-field">
        <input className="field" placeholder="Parent folder" value={dir} onChange={(e) => setDir(e.target.value)} />
        <button onClick={browse}>Browse…</button>
      </div>
      <label className="field-label">Folder name</label>
      <input className="field" value={name} onChange={(e) => { setTouched(true); setName(e.target.value); }} />
      {busy && <div className="progress mono">{progress || "Starting…"}</div>}
      {err && <div className="error-box mono">{err}</div>}
      <div className="modal-actions">
        <button onClick={close} disabled={busy}>Cancel</button>
        <button className="primary" disabled={!ready} onClick={go} onKeyDown={(e) => e.key === "Enter" && ready && go()}>
          {busy ? "Cloning…" : "Clone"}
        </button>
      </div>
    </Modal>
  );
}
