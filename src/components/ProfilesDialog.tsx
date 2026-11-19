import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";
import { currentProfile, matchProfile, newId, type Profile } from "../lib/profiles";
import { Icon } from "./Icon";

const blank = (): Profile => ({
  id: newId(), label: "", userName: "", email: "", sshKey: null, host: "github.com", hostUser: null, match: [],
});

export function ProfilesDialog() {
  const profiles = useStore((s) => s.profiles);
  const identity = useStore((s) => s.identity);
  const active = useStore((s) => s.active);
  const setProfiles = useStore((s) => s.setProfiles);
  const useProfile = useStore((s) => s.useProfile);
  const setDialog = useStore((s) => s.setDialog);
  const confirm = useStore((s) => s.confirm);
  const [edit, setEdit] = useState<Profile | null>(profiles.length ? null : blank());
  const [matchText, setMatchText] = useState("");

  const cur = currentProfile(profiles, identity);
  const suggested = identity ? matchProfile(profiles, identity.remotes) : null;

  const startEdit = (p: Profile) => {
    setEdit({ ...p });
    setMatchText(p.match.join(", "));
  };
  const saveEdit = () => {
    if (!edit) return;
    const p: Profile = { ...edit, label: edit.label.trim() || edit.email, match: matchText.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) };
    const exists = profiles.some((x) => x.id === p.id);
    setProfiles(exists ? profiles.map((x) => (x.id === p.id ? p : x)) : [...profiles, p]);
    setEdit(null);
  };
  const pickKey = async () => {
    const r = await open({ title: "Choose the PRIVATE key file (not .pub)", multiple: false, directory: false });
    if (typeof r === "string" && edit) setEdit({ ...edit, sshKey: r.replace(/\.pub$/, "") });
  };
  const valid = !!edit && edit.userName.trim() && /\S+@\S+/.test(edit.email);
  const f = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement>) => edit && setEdit({ ...edit, [k]: e.target.value });

  return (
    <div className="modal-overlay" onMouseDown={() => setDialog(null)}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title row">
          <Icon name="user" /> Git profiles
          <span className="grow" />
          {!edit && <button className="small" onClick={() => { setEdit(blank()); setMatchText(""); }}>New profile</button>}
        </div>
        <p className="dim small" style={{ margin: 0 }}>
          A profile sets who you commit as and which account you push with, for one repo at a time.
          Your global git settings stay the same.
        </p>

        {!edit && (
          <div className="prof-list">
            {profiles.map((p) => (
              <div key={p.id} className={"prof" + (cur?.id === p.id ? " on" : "")}>
                <span className="avatar big" style={{ background: "var(--accent)" }}>{(p.label[0] ?? "?").toUpperCase()}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div>
                    <b>{p.label}</b> {cur?.id === p.id && <span className="pill pill-staged">in use</span>}
                    {suggested?.id === p.id && cur?.id !== p.id && <span className="pill pill-unstaged">suggested</span>}
                  </div>
                  <div className="dim small ellipsis">{p.userName} &lt;{p.email}&gt;</div>
                  <div className="dim small ellipsis">
                    {p.sshKey ? `SSH key: ${p.sshKey}` : "Default SSH key"}
                    {p.hostUser ? ` · HTTPS user: ${p.hostUser}@${p.host || "github.com"}` : ""}
                    {p.match.length ? ` · auto for ${p.match.join(", ")}` : ""}
                  </div>
                </div>
                {active && cur?.id !== p.id && <button className="small primary" onClick={() => void useProfile(p)}>Use here</button>}
                <button className="icon-btn" title="Edit" onClick={() => startEdit(p)}><Icon name="pencil" size={14} /></button>
                <button
                  className="icon-btn"
                  title="Delete"
                  onClick={async () => {
                    if (await confirm({ title: "Delete profile", message: `Delete "${p.label}"? Repos keep their settings.`, ok: "Delete", danger: true })) {
                      setDialog({ kind: "profiles" });
                      setProfiles(profiles.filter((x) => x.id !== p.id));
                    } else setDialog({ kind: "profiles" });
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            {!profiles.length && <div className="empty small">No profiles yet.</div>}
          </div>
        )}

        {edit && (
          <div className="prof-form">
            <label className="field-label">Profile name</label>
            <input className="field" placeholder="Work, Personal, Client X…" value={edit.label} onChange={f("label")} autoFocus />
            <div className="two">
              <div>
                <label className="field-label">Commit name</label>
                <input className="field" placeholder="Ada Lovelace" value={edit.userName} onChange={f("userName")} />
              </div>
              <div>
                <label className="field-label">Commit email</label>
                <input className="field" placeholder="ada@company.com" value={edit.email} onChange={f("email")} />
              </div>
            </div>
            <label className="field-label">SSH key for this account (optional)</label>
            <div className="row-field">
              <input className="field mono" placeholder="~/.ssh/id_ed25519_work" value={edit.sshKey ?? ""} onChange={f("sshKey")} />
              <button onClick={() => void pickKey()}>Browse…</button>
            </div>
            <div className="two">
              <div>
                <label className="field-label">HTTPS user name (optional)</label>
                <input className="field" placeholder="ada-work" value={edit.hostUser ?? ""} onChange={f("hostUser")} />
              </div>
              <div>
                <label className="field-label">Host</label>
                <input className="field" placeholder="github.com" value={edit.host ?? ""} onChange={f("host")} />
              </div>
            </div>
            <label className="field-label">Use automatically for remotes starting with (optional)</label>
            <input className="field mono" placeholder="github.com/acme, gitlab.com/client-x" value={matchText} onChange={(e) => setMatchText(e.target.value)} />
            <div className="modal-actions">
              <button onClick={() => setEdit(null)}>Cancel</button>
              <button className="primary" disabled={!valid} onClick={saveEdit}>Save profile</button>
            </div>
          </div>
        )}

        {!edit && (
          <div className="modal-actions">
            <button onClick={() => setDialog(null)}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
