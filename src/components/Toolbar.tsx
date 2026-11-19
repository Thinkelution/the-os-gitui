import { useState } from "react";
import { useStore } from "../store";
import { api, type PullMode } from "../lib/git";
import { Icon, type IconName } from "./Icon";

const PULL_LABEL: Record<PullMode, string> = {
  "ff-only": "Fast-forward only",
  merge: "Pull (merge)",
  rebase: "Pull (rebase)",
};

const isMac = navigator.userAgent.includes("Mac");
export const MOD = isMac ? "⌘" : "Ctrl";

function anchor(e: React.MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { clientX: r.left, clientY: r.bottom + 6 };
}

function TB(props: { icon: IconName; label: string; title: string; disabled?: boolean; count?: number; onClick: () => void }) {
  return (
    <button className="tb-btn" disabled={props.disabled} onClick={props.onClick} title={props.title}>
      <Icon name={props.icon} size={18} />
      <span>{props.label}</span>
      {!!props.count && <span className="count">{props.count}</span>}
    </button>
  );
}

export function Toolbar() {
  const status = useStore((s) => s.status);
  const refs = useStore((s) => s.refs);
  const busy = useStore((s) => s.busy);
  const active = useStore((s) => s.active);
  const tabs = useStore((s) => s.tabs);
  const theme = useStore((s) => s.theme);
  const op = useStore((s) => s.op);
  const prompt = useStore((s) => s.prompt);
  const confirm = useStore((s) => s.confirm);
  const showMenu = useStore((s) => s.showMenu);
  const loadAll = useStore((s) => s.loadAll);
  const setTheme = useStore((s) => s.setTheme);
  const setPalette = useStore((s) => s.setPalette);
  const toast = useStore((s) => s.toast);
  const [pullMode, setPullMode] = useState<PullMode>(
    () => (localStorage.getItem("pullMode") as PullMode | null) ?? "ff-only",
  );

  const name = tabs.find((t) => t.path === active)?.name ?? "";
  const pull = (m: PullMode) => op("Pull", { op: "pull", mode: m });

  const pullMenu = (e: React.MouseEvent) =>
    showMenu(anchor(e), (Object.keys(PULL_LABEL) as PullMode[]).map((m) => ({
      label: (m === pullMode ? "✓  " : "     ") + PULL_LABEL[m],
      action: () => {
        setPullMode(m);
        localStorage.setItem("pullMode", m);
        void pull(m);
      },
    })));

  const pushMenu = (e: React.MouseEvent) =>
    showMenu(anchor(e), [
      { label: "Push", action: () => void op("Push", { op: "push", force: false }) },
      {
        label: "Force push (with lease)…",
        danger: true,
        action: async () => {
          const ok = await confirm({
            title: "Force push",
            message: `Overwrite the remote branch with your local "${status?.branch}"? Commits on the remote that you don't have will be lost.`,
            ok: "Force push",
            danger: true,
          });
          if (ok) void op("Force push", { op: "push", force: true });
        },
      },
    ]);

  const newBranch = async () => {
    const r = await prompt({ title: "Create branch", label: "New branch name (starts from HEAD)", ok: "Create and switch" });
    const n = r?.value.trim();
    if (n) void op("Create branch", { op: "createBranch", name: n, start: null, checkout: true });
  };

  const stash = async () => {
    const r = await prompt({
      title: "Stash changes",
      label: "Message (optional)",
      ok: "Stash",
      check: { label: "Include untracked files", value: true },
    });
    if (r) void op("Stash", { op: "stashPush", message: r.value.trim() || null, includeUntracked: r.checked });
  };

  const dirty = (status?.files.length ?? 0) > 0;
  const hasStash = (refs?.stashes.length ?? 0) > 0;
  const hasRemote = (refs?.remotes.length ?? 0) > 0;
  const b = !!busy;
  const fail = (e: unknown) => toast("error", String(e));

  return (
    <div className="toolbar">
      <div className="tb-left">
        <div className="repo-chip" title={active ?? ""}>
          <Icon name="repo" />
          <span className="repo-name">{name}</span>
        </div>
        <div className="branch-chip" title={status?.upstream ? `Tracking ${status.upstream}` : "No upstream"}>
          <Icon name="branch" size={14} />
          <span className="ellipsis">
            {status ? (status.detached ? `detached @ ${status.headHash?.slice(0, 7) ?? ""}` : status.branch ?? "") : "…"}
          </span>
          {!!status?.ahead && <span className="ab">↑{status.ahead}</span>}
          {!!status?.behind && <span className="ab">↓{status.behind}</span>}
        </div>
      </div>

      <div className="tb-center">
        <div className="tb-group">
          <div className="tb-split">
            <TB icon="pull" label="Pull" title={PULL_LABEL[pullMode]} disabled={b || !hasRemote} count={status?.behind} onClick={() => void pull(pullMode)} />
            <button className="tb-caret" disabled={b || !hasRemote} onClick={pullMenu} title="Pull options"><Icon name="chevronDown" size={12} /></button>
          </div>
          <div className="tb-split">
            <TB icon="push" label="Push" title="Push current branch" disabled={b || !hasRemote} count={status?.ahead} onClick={() => void op("Push", { op: "push", force: false })} />
            <button className="tb-caret" disabled={b || !hasRemote} onClick={pushMenu} title="Push options"><Icon name="chevronDown" size={12} /></button>
          </div>
          <TB icon="fetch" label="Fetch" title="Fetch all remotes" disabled={b || !hasRemote} onClick={() => void op("Fetch", { op: "fetch" })} />
        </div>
        <div className="tb-group">
          <TB icon="branch" label="Branch" title="Create a branch at HEAD" disabled={b} onClick={() => void newBranch()} />
          <TB icon="stash" label="Stash" title="Stash local changes" disabled={b || !dirty} onClick={() => void stash()} />
          <TB icon="pop" label="Pop" title="Pop the latest stash" disabled={b || !hasStash} onClick={() => void op("Pop stash", { op: "stashPop", index: "stash@{0}" })} />
        </div>
        <div className="tb-group">
          <TB icon="terminal" label="Terminal" title="Open a terminal in this repo" onClick={() => active && api.openTerminal(active).catch(fail)} />
          <TB icon="folder" label="Folder" title="Show this repo in the file manager" onClick={() => active && api.reveal(active).catch(fail)} />
        </div>
      </div>

      <div className="tb-right">
        {busy && (
          <span className="busy">
            <span className="spinner" /> {busy}…
          </span>
        )}
        <button className="cmdk" onClick={() => setPalette(true)} title="Command palette">
          <Icon name="search" size={14} />
          <span>Commands</span>
          <kbd>{MOD} K</kbd>
        </button>
        <button className="icon-btn lg" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle light / dark">
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <button className="icon-btn lg" disabled={b} onClick={() => void loadAll()} title="Refresh (F5)">
          <Icon name="refresh" />
        </button>
      </div>
    </div>
  );
}
