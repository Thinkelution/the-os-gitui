import { useEffect, useState } from "react";
import { useStore } from "../store";
import { api, type CommitDetails, type FileChange, type RepoState } from "../lib/git";
import { copy, fullTime, hue, initials, splitPath } from "../lib/format";
import { fileMenu } from "../fileMenu";
import { Icon } from "./Icon";
import { MOD } from "./Toolbar";

export function RightPanel() {
  const selection = useStore((s) => s.selection);
  return (
    <div className="panel">
      {selection.kind === "commit" ? <CommitPanel hash={selection.hash} /> : <StagingPanel />}
    </div>
  );
}

const STATE_LABEL: Record<Exclude<RepoState, "">, string> = {
  merging: "Merge in progress",
  rebasing: "Rebase in progress",
  "cherry-picking": "Cherry-pick in progress",
  reverting: "Revert in progress",
};

function FileRow(props: { status: string; path: string; oldPath?: string | null; selected: boolean; onClick: () => void; actions?: React.ReactNode; conflicted?: boolean }) {
  const showMenu = useStore((s) => s.showMenu);
  const { dir, name } = splitPath(props.path);
  const s = props.status === "?" ? "A" : props.status;
  return (
    <div
      className={"file" + (props.selected ? " sel" : "")}
      onClick={props.onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        showMenu(e, fileMenu(props.path, { conflicted: props.conflicted }));
      }}
      title={props.oldPath ? `${props.oldPath} → ${props.path}` : props.path}
    >
      <span className={"fstat s-" + s}>{s}</span>
      <span className="fname">{name}</span>
      <span className="fdir">{dir}</span>
      {props.actions && <span className="factions" onClick={(e) => e.stopPropagation()}>{props.actions}</span>}
    </div>
  );
}

function StagingPanel() {
  const status = useStore((s) => s.status);
  const busy = useStore((s) => s.busy);
  const active = useStore((s) => s.active);
  const diff = useStore((s) => s.diff);
  const run = useStore((s) => s.run);
  const op = useStore((s) => s.op);
  const openDiff = useStore((s) => s.openDiff);
  const confirm = useStore((s) => s.confirm);
  const toast = useStore((s) => s.toast);
  const [summary, setSummary] = useState("");
  const [desc, setDesc] = useState("");
  const [amend, setAmend] = useState(false);

  if (!status || !active) return null;

  const unstaged = status.files.filter((f) => f.untracked || f.conflicted || f.worktree !== ".");
  const staged = status.files.filter((f) => !f.untracked && !f.conflicted && f.index !== ".");
  const isOpen = (f: FileChange, st: boolean) => diff?.kind === "work" && diff.path === f.path && diff.staged === st;

  const stage = (paths: string[]) => run("Stage", (repo) => api.stage(repo, paths), true);
  const unstage = (paths: string[]) => run("Unstage", (repo) => api.unstage(repo, paths), true);
  const discard = async (files: FileChange[]) => {
    const ok = await confirm({
      title: "Discard changes",
      message: files.length === 1
        ? `Discard all changes to ${files[0].path}? This cannot be undone.`
        : `Discard changes in ${files.length} files? Untracked files are deleted. This cannot be undone.`,
      ok: "Discard",
      danger: true,
    });
    if (!ok) return;
    const tracked = files.filter((f) => !f.untracked).map((f) => f.path);
    const untracked = files.filter((f) => f.untracked).map((f) => f.path);
    await run("Discard", (repo) => api.discard(repo, tracked, untracked), true);
  };

  const toggleAmend = async (v: boolean) => {
    setAmend(v);
    if (v && !summary.trim()) {
      try {
        const msg = (await api.lastMessage(active)).trim();
        const [s, ...rest] = msg.split("\n");
        setSummary(s ?? "");
        setDesc(rest.join("\n").trim());
      } catch (e) {
        toast("error", String(e));
      }
    }
  };

  const canCommit = summary.trim().length > 0 && (staged.length > 0 || amend) && !busy;
  const commit = async () => {
    if (!canCommit) return;
    const msg = summary.trim() + (desc.trim() ? "\n\n" + desc.trim() : "");
    const ok = await run(amend ? "Amend" : "Commit", (repo) => api.commit(repo, msg, amend));
    if (ok) {
      setSummary("");
      setDesc("");
      setAmend(false);
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void commit();
    }
  };

  const openWork = (f: FileChange, st: boolean) =>
    openDiff({ kind: "work", path: f.path, staged: st, untracked: f.untracked, conflicted: f.conflicted });

  return (
    <div className="staging">
      {status.state && (
        <div className="banner">
          <span>{STATE_LABEL[status.state]}</span>
          <span className="grow" />
          <button onClick={() => op("Abort", { op: "abort" })}>Abort</button>
          <button className="primary" onClick={() => op("Continue", { op: "continue" })}>Continue</button>
        </div>
      )}
      <div className="panel-head">
        {status.files.length} file change{status.files.length === 1 ? "" : "s"} on{" "}
        <b>{status.detached ? "detached HEAD" : status.branch}</b>
      </div>

      <div className="file-section">
        <div className="fs-head">
          <span>Unstaged Files ({unstaged.length})</span>
          <span className="grow" />
          {unstaged.length > 0 && (
            <>
              <button className="small danger-text" onClick={() => discard(unstaged)} title="Discard all unstaged changes">Discard all</button>
              <button className="small success" onClick={() => stage([])}>Stage all</button>
            </>
          )}
        </div>
        <div className="fs-list">
          {unstaged.map((f) => (
            <FileRow
              key={"u" + f.path}
              status={f.conflicted ? "C" : f.untracked ? "?" : f.worktree}
              path={f.path}
              selected={isOpen(f, false)}
              conflicted={f.conflicted}
              onClick={() => openWork(f, false)}
              actions={
                f.conflicted ? (
                  <>
                    <button className="chip-btn" title="Keep my version" onClick={() => void run("Use ours", (r) => api.resolveConflict(r, f.path, "ours"), true)}>Mine</button>
                    <button className="chip-btn" title="Take their version" onClick={() => void run("Use theirs", (r) => api.resolveConflict(r, f.path, "theirs"), true)}>Theirs</button>
                    <button className="icon-btn ok" title="Mark resolved (stage as is)" onClick={() => stage([f.path])}><Icon name="check" size={14} /></button>
                  </>
                ) : (
                  <>
                    <button className="icon-btn" title="Discard changes" onClick={() => discard([f])}><Icon name="undo" size={14} /></button>
                    <button className="icon-btn ok" title="Stage file" onClick={() => stage([f.path])}><Icon name="plus" size={14} /></button>
                  </>
                )
              }
            />
          ))}
          {!unstaged.length && <div className="empty small">No unstaged changes</div>}
        </div>
      </div>

      <div className="file-section">
        <div className="fs-head">
          <span>Staged Files ({staged.length})</span>
          <span className="grow" />
          {staged.length > 0 && <button className="small" onClick={() => unstage([])}>Unstage all</button>}
        </div>
        <div className="fs-list">
          {staged.map((f) => (
            <FileRow
              key={"s" + f.path}
              status={f.index}
              path={f.path}
              oldPath={f.oldPath}
              selected={isOpen(f, true)}
              onClick={() => openWork(f, true)}
              actions={<button className="icon-btn" title="Unstage file" onClick={() => unstage([f.path])}><Icon name="minus" size={14} /></button>}
            />
          ))}
          {!staged.length && <div className="empty small">Stage files to commit them</div>}
        </div>
      </div>

      <div className="commit-box">
        <div className="summary-wrap">
          <input
            className="summary"
            placeholder="Commit summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onKeyDown={onKey}
          />
          <span className={"chars" + (summary.length > 72 ? " over" : "")}>{summary.length}</span>
        </div>
        <textarea placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={onKey} rows={4} />
        <label className="check">
          <input type="checkbox" checked={amend} onChange={(e) => void toggleAmend(e.target.checked)} /> Amend previous commit
        </label>
        <button className="primary big" disabled={!canCommit} onClick={() => void commit()} title={`${MOD} + Enter`}>
          {amend ? "Amend previous commit" : staged.length ? `Commit changes to ${staged.length} file${staged.length === 1 ? "" : "s"}` : "Stage changes to commit"}
        </button>
      </div>
    </div>
  );
}

function CommitPanel({ hash }: { hash: string }) {
  const active = useStore((s) => s.active);
  const commits = useStore((s) => s.commits);
  const diff = useStore((s) => s.diff);
  const openDiff = useStore((s) => s.openDiff);
  const select = useStore((s) => s.select);
  const jumpTo = useStore((s) => s.jumpTo);
  const toast = useStore((s) => s.toast);
  const [d, setD] = useState<CommitDetails | null>(null);

  // Reload when the commit list changes too (e.g. after amend).
  useEffect(() => {
    if (!active) return;
    let alive = true;
    api.commitDetails(active, hash)
      .then((x) => alive && setD(x))
      .catch((e) => alive && toast("error", String(e)));
    return () => {
      alive = false;
    };
  }, [active, hash, commits, toast]);

  if (!d || d.hash !== hash && !d.hash.startsWith(hash)) return <div className="empty">Loading…</div>;

  const [subject, ...rest] = d.body.split("\n");
  const body = rest.join("\n").trim();
  const goto = (h: string) => {
    select({ kind: "commit", hash: h });
    jumpTo(h);
  };

  return (
    <div className="commit-panel">
      <div className="cp-sha">
        commit: <span className="mono selectable" onClick={() => void copy(d.hash)} title="Click to copy">{d.hash.slice(0, 10)}</span>
        {d.parents.length > 0 && (
          <span className="cp-parents">
            parent{d.parents.length > 1 ? "s" : ""}:{" "}
            {d.parents.map((p) => (
              <a key={p} onClick={() => goto(p)} className="mono">{p.slice(0, 7)}</a>
            ))}
          </span>
        )}
      </div>
      <div className="cp-subject selectable">{subject}</div>
      {body && <pre className="cp-body selectable">{body}</pre>}
      <div className="cp-author">
        <span className="avatar big" style={{ background: `hsl(${hue(d.email)} 45% 40%)` }}>{initials(d.author)}</span>
        <div>
          <div><b>{d.author}</b> <span className="dim">{d.email}</span></div>
          <div className="dim">authored {fullTime(d.time)}</div>
          {(d.committer !== d.author || d.commitTime !== d.time) && (
            <div className="dim">committed by {d.committer} {fullTime(d.commitTime)}</div>
          )}
        </div>
      </div>
      <div className="fs-head">
        <span>{d.files.length} changed file{d.files.length === 1 ? "" : "s"}</span>
      </div>
      <div className="fs-list grow-list">
        {d.files.map((f) => (
          <FileRow
            key={f.path}
            status={f.status}
            path={f.path}
            oldPath={f.oldPath}
            selected={diff?.kind === "commit" && diff.hash === d.hash && diff.path === f.path}
            onClick={() => openDiff({ kind: "commit", hash: d.hash, parent: d.parents[0] ?? null, path: f.path, oldPath: f.oldPath })}
          />
        ))}
      </div>
    </div>
  );
}
