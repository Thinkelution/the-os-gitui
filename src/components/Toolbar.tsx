import { useState } from "react";
import { useStore } from "../store";
import type { PullMode } from "../lib/git";

const PULL_LABEL: Record<PullMode, string> = {
  "ff-only": "Fast-forward only",
  merge: "Pull (merge)",
  rebase: "Pull (rebase)",
};

function anchor(e: React.MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { clientX: r.left, clientY: r.bottom + 4 };
}

export function Toolbar() {
  const status = useStore((s) => s.status);
  const refs = useStore((s) => s.refs);
  const busy = useStore((s) => s.busy);
  const active = useStore((s) => s.active);
  const tabs = useStore((s) => s.tabs);
  const op = useStore((s) => s.op);
  const prompt = useStore((s) => s.prompt);
  const confirm = useStore((s) => s.confirm);
  const showMenu = useStore((s) => s.showMenu);
  const loadAll = useStore((s) => s.loadAll);
  const [pullMode, setPullMode] = useState<PullMode>(
    () => (localStorage.getItem("pullMode") as PullMode | null) ?? "ff-only",
  );

  const name = tabs.find((t) => t.path === active)?.name ?? "";
  const pull = (m: PullMode) => op("Pull", { op: "pull", mode: m });

  const pullMenu = (e: React.MouseEvent) =>
    showMenu(anchor(e), (Object.keys(PULL_LABEL) as PullMode[]).map((m) => ({
      label: (m === pullMode ? "✓ " : "    ") + PULL_LABEL[m],
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

  return (
    <div className="toolbar">
      <div className="tb-left">
        <span className="repo-name">{name}</span>
        <span className="tb-sep">/</span>
        <span className="branch-pill" title={status?.upstream ? `Tracking ${status.upstream}` : "No upstream"}>
          {status ? (status.detached ? `detached @ ${status.headHash?.slice(0, 7) ?? ""}` : status.branch ?? "") : "…"}
        </span>
      </div>

      <div className="tb-center">
        <div className="tb-split">
          <button className="tb-btn" disabled={b || !hasRemote} onClick={() => pull(pullMode)} title={PULL_LABEL[pullMode]}>
            <span className="ico">⤓</span>
            <span>Pull</span>
            {!!status?.behind && <span className="count">{status.behind}</span>}
          </button>
          <button className="tb-caret" disabled={b || !hasRemote} onClick={pullMenu} title="Pull options">▾</button>
        </div>
        <div className="tb-split">
          <button className="tb-btn" disabled={b || !hasRemote} onClick={() => op("Push", { op: "push", force: false })} title="Push current branch">
            <span className="ico">⤒</span>
            <span>Push</span>
            {!!status?.ahead && <span className="count">{status.ahead}</span>}
          </button>
          <button className="tb-caret" disabled={b || !hasRemote} onClick={pushMenu} title="Push options">▾</button>
        </div>
        <button className="tb-btn" disabled={b || !hasRemote} onClick={() => op("Fetch", { op: "fetch" })} title="Fetch all remotes">
          <span className="ico">⇣</span>
          <span>Fetch</span>
        </button>
        <span className="tb-gap" />
        <button className="tb-btn" disabled={b} onClick={newBranch} title="Create a branch at HEAD">
          <span className="ico">⑂</span>
          <span>Branch</span>
        </button>
        <button className="tb-btn" disabled={b || !dirty} onClick={stash} title="Stash local changes">
          <span className="ico">⊞</span>
          <span>Stash</span>
        </button>
        <button className="tb-btn" disabled={b || !hasStash} onClick={() => op("Pop stash", { op: "stashPop", index: "stash@{0}" })} title="Pop the latest stash">
          <span className="ico">⊟</span>
          <span>Pop</span>
        </button>
      </div>

      <div className="tb-right">
        {busy && (
          <span className="busy">
            <span className="spinner" /> {busy}…
          </span>
        )}
        <button className="tb-btn" disabled={b} onClick={() => void loadAll()} title="Refresh (F5)">
          <span className="ico">↻</span>
        </button>
      </div>
    </div>
  );
}
