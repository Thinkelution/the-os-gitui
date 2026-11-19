import { useEffect, useState } from "react";
import { useStore } from "../store";
import { api, type AgentInfo } from "../lib/git";
import { newId } from "../lib/profiles";
import { Icon } from "./Icon";

interface Custom { id: string; name: string; command: string }

const loadCustom = (): Custom[] => {
  try {
    return JSON.parse(localStorage.getItem("customAgents") ?? "[]") as Custom[];
  } catch {
    return [];
  }
};

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export function AgentDialog({ cwd }: { cwd?: string }) {
  const active = useStore((s) => s.active);
  const status = useStore((s) => s.status);
  const identity = useStore((s) => s.identity);
  const setDialog = useStore((s) => s.setDialog);
  const launch = useStore((s) => s.launch);
  const loadAll = useStore((s) => s.loadAll);
  const toast = useStore((s) => s.toast);
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [custom, setCustom] = useState<Custom[]>(loadCustom);
  const [pick, setPick] = useState(localStorage.getItem("lastAgent") ?? "claude");
  const [where, setWhere] = useState<"here" | "worktree">((localStorage.getItem("agentWhere") as "here" | "worktree") ?? "worktree");
  const [branch, setBranch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [adding, setAdding] = useState(false);
  const [cName, setCName] = useState("");
  const [cCmd, setCCmd] = useState("");
  const [busy, setBusy] = useState(false);

  const detect = () => void api.agents().then(setAgents).catch((e) => toast("error", String(e)));
  useEffect(detect, [toast]);

  const all = [
    ...(agents ?? []).map((a) => ({ id: a.id, name: a.name, ready: a.installed, info: a })),
    ...custom.map((c) => ({ id: "custom:" + c.id, name: c.name, ready: true, info: null })),
  ];
  const chosen = all.find((a) => a.id === pick && a.ready) ?? all.find((a) => a.ready);
  const agentSlug = (chosen?.name ?? "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const branchName = branch.trim() || `agent/${agentSlug}-${stamp()}`;
  const close = () => setDialog(null);
  const root = cwd ?? active;

  const saveCustom = (list: Custom[]) => {
    setCustom(list);
    localStorage.setItem("customAgents", JSON.stringify(list));
  };

  const install = (a: AgentInfo) => {
    if (!root) return;
    void launch(root, { kind: "install", id: a.id }, `Install ${a.name}`);
    toast("info", `Installing ${a.name} in the terminal below. Press "Check again" when it finishes.`);
  };

  const go = async () => {
    if (!chosen || !root) return;
    setBusy(true);
    try {
      let dir = root;
      let label = status?.branch ?? "HEAD";
      if (!cwd && where === "worktree") {
        dir = await api.worktreeAdd(root, branchName, null);
        label = branchName;
        await loadAll();
      }
      const p = prompt.trim() || null;
      const title = `${chosen.name} · ${label}`;
      const ok = chosen.id.startsWith("custom:")
        ? await launch(dir, { kind: "custom", command: custom.find((c) => "custom:" + c.id === chosen.id)!.command, prompt: p }, title)
        : await launch(dir, { kind: "agent", id: chosen.id, prompt: p }, title);
      if (ok !== null) {
        localStorage.setItem("lastAgent", chosen.id);
        if (!cwd) localStorage.setItem("agentWhere", where);
        close();
      }
    } catch (e) {
      toast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={() => !busy && close()}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title row">
          <Icon name="sparkle" /> Start an AI coding agent
          <span className="grow" />
          <button className="small" onClick={detect}>Check again</button>
        </div>

        <div className="agent-grid">
          {!agents && <div className="dim">Looking for installed agents…</div>}
          {all.map((a) => (
            <div
              key={a.id}
              className={"agent-card" + (chosen?.id === a.id ? " on" : "") + (a.ready ? "" : " missing")}
              onClick={() => a.ready && setPick(a.id)}
              title={a.info?.path ?? (a.info ? "Not installed" : "Custom command")}
            >
              <b>{a.name}</b>
              {a.ready ? (
                <span className="ok small">{a.info ? "Ready" : "Custom"}</span>
              ) : a.info?.install ? (
                <button className="small" title={a.info.install} onClick={(e) => { e.stopPropagation(); install(a.info!); }}>
                  Install
                </button>
              ) : (
                <a className="small" href={a.info?.site} target="_blank" rel="noreferrer">How to install</a>
              )}
              {a.id.startsWith("custom:") && (
                <button
                  className="icon-btn card-x"
                  title="Remove"
                  onClick={(e) => { e.stopPropagation(); saveCustom(custom.filter((c) => "custom:" + c.id !== a.id)); }}
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          ))}
          <div className="agent-card add" onClick={() => setAdding(true)}>
            <Icon name="plus" /> <span className="small">Custom</span>
          </div>
        </div>

        {adding && (
          <div className="row-field">
            <input className="field" placeholder="Name" value={cName} onChange={(e) => setCName(e.target.value)} style={{ maxWidth: 140 }} />
            <input className="field mono" placeholder="Command, e.g. claude --model opus" value={cCmd} onChange={(e) => setCCmd(e.target.value)} />
            <button
              disabled={!cName.trim() || !cCmd.trim()}
              onClick={() => {
                const c = { id: newId(), name: cName.trim(), command: cCmd.trim() };
                saveCustom([...custom, c]);
                setPick("custom:" + c.id);
                setAdding(false);
                setCName("");
                setCCmd("");
              }}
            >
              Add
            </button>
          </div>
        )}

        {!cwd ? (
          <>
            <label className="field-label">Where should it work?</label>
            <div className="choice">
              <label className={where === "worktree" ? "on" : ""}>
                <input type="radio" checked={where === "worktree"} onChange={() => setWhere("worktree")} />
                <div>
                  <b>New branch, own folder</b>
                  <span className="dim small">Safe. Your files stay untouched. (git worktree)</span>
                </div>
              </label>
              <label className={where === "here" ? "on" : ""}>
                <input type="radio" checked={where === "here"} onChange={() => setWhere("here")} />
                <div>
                  <b>Right here</b>
                  <span className="dim small">Works on {status?.branch ?? "HEAD"} in this folder.</span>
                </div>
              </label>
            </div>
            {where === "worktree" && (
              <input className="field mono" placeholder={branchName} value={branch} onChange={(e) => setBranch(e.target.value)} />
            )}
          </>
        ) : (
          <div className="dim small mono ellipsis">Folder: {cwd}</div>
        )}

        <label className="field-label">Task (optional, sent to the agent when it starts)</label>
        <textarea rows={3} placeholder="e.g. Add tests for the login form" value={prompt} onChange={(e) => setPrompt(e.target.value)} />

        {identity && (
          <div className="dim small">
            Commits will use <b>{identity.name || "?"}</b> &lt;{identity.email || "no email"}&gt;
            {!identity.local && " (global git config)"}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={close} disabled={busy}>Cancel</button>
          <button className="primary" disabled={!chosen || !root || busy} onClick={() => void go()}>
            {busy ? "Starting…" : `Start ${chosen?.name ?? "agent"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
