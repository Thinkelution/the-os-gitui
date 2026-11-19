import { useState, type ReactNode } from "react";
import { useStore, type MenuItem } from "../store";
import { api, type Branch, type RemoteBranch, type Stash, type Tag, type Worktree } from "../lib/git";
import { copy } from "../lib/format";
import { Icon, type IconName } from "./Icon";

function Section(props: { title: string; icon: IconName; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="side-section">
      <div className="side-head" onClick={props.onToggle}>
        <Icon name={props.open ? "chevronDown" : "chevronRight"} size={12} />
        <Icon name={props.icon} size={14} />
        <span>{props.title}</span>
        <span className="side-count">{props.count}</span>
      </div>
      {props.open && <div className="side-body">{props.children}</div>}
    </div>
  );
}

interface TreeNode<T> { name: string; path: string; items: { leaf: string; value: T }[]; dirs: Map<string, TreeNode<T>> }

/** Group "feature/a/b" style names into folders. */
function buildTree<T>(entries: { name: string; value: T }[]): TreeNode<T> {
  const root: TreeNode<T> = { name: "", path: "", items: [], dirs: new Map() };
  for (const e of entries) {
    const parts = e.name.split("/");
    let node = root;
    for (const p of parts.slice(0, -1)) {
      let next = node.dirs.get(p);
      if (!next) {
        next = { name: p, path: node.path ? `${node.path}/${p}` : p, items: [], dirs: new Map() };
        node.dirs.set(p, next);
      }
      node = next;
    }
    node.items.push({ leaf: parts[parts.length - 1], value: e.value });
  }
  return root;
}

function Tree<T>(props: { node: TreeNode<T>; depth: number; id: string; render: (leaf: string, v: T, depth: number) => ReactNode; closed: Set<string>; toggle: (k: string) => void }) {
  const { node, depth } = props;
  return (
    <>
      {[...node.dirs.values()].map((d) => {
        const key = props.id + ":" + d.path;
        const open = !props.closed.has(key);
        return (
          <div key={d.path}>
            <div className="side-item folder" style={{ paddingLeft: 14 + depth * 14 }} onClick={() => props.toggle(key)}>
              <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
              <Icon name="folder" size={14} />
              <span className="side-name">{d.name}</span>
            </div>
            {open && <Tree {...props} node={d} depth={depth + 1} />}
          </div>
        );
      })}
      {node.items.map((it) => props.render(it.leaf, it.value, depth))}
    </>
  );
}

export function Sidebar() {
  const refs = useStore((s) => s.refs);
  const status = useStore((s) => s.status);
  const select = useStore((s) => s.select);
  const jumpTo = useStore((s) => s.jumpTo);
  const op = useStore((s) => s.op);
  const prompt = useStore((s) => s.prompt);
  const confirm = useStore((s) => s.confirm);
  const showMenu = useStore((s) => s.showMenu);
  const worktrees = useStore((s) => s.worktrees);
  const terms = useStore((s) => s.terms);
  const openPath = useStore((s) => s.openPath);
  const setDialog = useStore((s) => s.setDialog);
  const launch = useStore((s) => s.launch);
  const run = useStore((s) => s.run);
  const toast = useStore((s) => s.toast);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ local: true, remote: true, tags: false, stashes: true });
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggleDir = (k: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  if (!refs) return <div className="sidebar" />;

  const f = filter.trim().toLowerCase();
  const match = (s: string) => !f || s.toLowerCase().includes(f);
  const current = status?.detached ? null : status?.branch ?? null;
  const localNames = new Set(refs.local.map((b) => b.name));
  const defaultRemote = refs.remotes.includes("origin") ? "origin" : refs.remotes[0];
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const goto = (hash: string) => {
    select({ kind: "commit", hash });
    jumpTo(hash);
  };
  const ctx = (items: MenuItem[]) => (e: React.MouseEvent) => {
    e.preventDefault();
    showMenu(e, items);
  };

  const mergeRebase = (name: string, disabled: boolean): MenuItem[] => [
    { label: `Merge ${name} into ${current ?? "HEAD"}`, disabled: disabled || !current, action: () => void op("Merge", { op: "merge", name }) },
    { label: `Rebase ${current ?? "HEAD"} onto ${name}`, disabled: disabled || !current, action: () => void op("Rebase", { op: "rebase", onto: name }) },
  ];

  const createFrom = (start: string) => async () => {
    const r = await prompt({ title: "Create branch", label: `New branch from ${start}`, ok: "Create", check: { label: "Switch to it", value: true } });
    const n = r?.value.trim();
    if (r && n) void op("Create branch", { op: "createBranch", name: n, start, checkout: r.checked });
  };

  const checkoutRemote = (rb: RemoteBranch) =>
    localNames.has(rb.short)
      ? op("Checkout", { op: "checkout", name: rb.short })
      : op("Checkout", { op: "checkoutRemote", remoteBranch: rb.name, local: rb.short });

  const localMenu = (b: Branch): MenuItem[] => [
    { label: `Checkout ${b.name}`, disabled: b.head, action: () => void op("Checkout", { op: "checkout", name: b.name }) },
    ...mergeRebase(b.name, b.head),
    { sep: true },
    { label: "Create branch from here…", action: createFrom(b.name) },
    {
      label: "Rename…",
      action: async () => {
        const r = await prompt({ title: "Rename branch", value: b.name, ok: "Rename" });
        const n = r?.value.trim();
        if (n && n !== b.name) void op("Rename branch", { op: "renameBranch", old: b.name, new: n });
      },
    },
    { label: "Copy branch name", action: () => void copy(b.name) },
    { sep: true },
    {
      label: "Delete…",
      danger: true,
      disabled: b.head,
      action: async () => {
        if (!(await confirm({ title: "Delete branch", message: `Delete local branch "${b.name}"?`, ok: "Delete", danger: true }))) return;
        const ok = await op("Delete branch", { op: "deleteBranch", name: b.name, force: false });
        if (!ok && (await confirm({
          title: "Branch is not merged",
          message: `"${b.name}" has commits that are not merged anywhere. Delete it anyway? Those commits may be lost.`,
          ok: "Force delete",
          danger: true,
        }))) void op("Delete branch", { op: "deleteBranch", name: b.name, force: true });
      },
    },
  ];

  const remoteMenu = (rb: RemoteBranch): MenuItem[] => [
    { label: `Checkout ${rb.short}`, disabled: current === rb.short, action: () => void checkoutRemote(rb) },
    ...mergeRebase(rb.name, false),
    { sep: true },
    { label: "Create branch from here…", action: createFrom(rb.name) },
    { label: "Copy branch name", action: () => void copy(rb.name) },
    { sep: true },
    {
      label: `Delete from ${rb.remote}…`,
      danger: true,
      action: async () => {
        if (await confirm({ title: "Delete remote branch", message: `Delete "${rb.short}" on ${rb.remote}? Other people lose it too.`, ok: "Delete", danger: true })) {
          void op("Delete remote branch", { op: "deleteRemoteBranch", remote: rb.remote, name: rb.short });
        }
      },
    },
  ];

  const tagMenu = (t: Tag): MenuItem[] => [
    { label: `Checkout ${t.name} (detached)`, action: () => void op("Checkout", { op: "checkoutDetached", hash: t.name }) },
    { label: "Create branch from here…", action: createFrom(t.name) },
    { label: `Push to ${defaultRemote ?? "remote"}`, disabled: !defaultRemote, action: () => void op("Push tag", { op: "pushTag", remote: defaultRemote!, name: t.name }) },
    { label: "Copy tag name", action: () => void copy(t.name) },
    { sep: true },
    {
      label: "Delete (local)…",
      danger: true,
      action: async () => {
        if (await confirm({ title: "Delete tag", message: `Delete local tag "${t.name}"?`, ok: "Delete", danger: true })) {
          void op("Delete tag", { op: "deleteTag", name: t.name });
        }
      },
    },
  ];

  const stashMenu = (s: Stash): MenuItem[] => [
    { label: "Apply", action: () => void op("Apply stash", { op: "stashApply", index: s.index }) },
    { label: "Pop", action: () => void op("Pop stash", { op: "stashPop", index: s.index }) },
    { sep: true },
    {
      label: "Delete…",
      danger: true,
      action: async () => {
        if (await confirm({ title: "Delete stash", message: `Delete ${s.index} "${s.message}"? This cannot be undone.`, ok: "Delete", danger: true })) {
          void op("Delete stash", { op: "stashDrop", index: s.index });
        }
      },
    },
  ];

  const wtMenu = (w: Worktree): MenuItem[] => [
    { label: "Open in new tab", action: () => void openPath(w.path) },
    { label: "Start AI agent here…", action: () => setDialog({ kind: "agent", cwd: w.path }) },
    { label: "Terminal here", action: () => void launch(w.path, { kind: "shell" }, `Terminal · ${w.branch ?? "detached"}`) },
    { label: "Show in folder", action: () => api.reveal(w.path).catch((e) => toast("error", String(e))) },
    { label: "Copy path", action: () => void copy(w.path) },
    { sep: true },
    {
      label: "Remove worktree…",
      danger: true,
      disabled: w.main,
      action: async () => {
        if (!(await confirm({ title: "Remove worktree", message: `Delete the folder ${w.path}? The branch "${w.branch ?? ""}" and its commits are kept.`, ok: "Remove", danger: true }))) return;
        const ok = await run("Remove worktree", (r) => api.worktreeRemove(r, w.path, false), true);
        if (!ok && (await confirm({ title: "Worktree has changes", message: "It has uncommitted changes. Remove it anyway? Those changes are lost.", ok: "Remove anyway", danger: true }))) {
          void run("Remove worktree", (r) => api.worktreeRemove(r, w.path, true), true);
        }
      },
    },
  ];
  const trees = worktrees.filter((w) => !w.main && match(w.branch ?? w.path));

  const locals = refs.local.filter((b) => match(b.name));
  const remotes = refs.remote.filter((b) => match(b.name));
  const tags = refs.tags.filter((t) => match(t.name));
  const stashes = refs.stashes.filter((s) => match(s.message));

  const pad = (depth: number) => ({ paddingLeft: 30 + depth * 14 });

  return (
    <div className="sidebar">
      <div className="side-filter-wrap">
        <Icon name="search" size={13} />
        <input className="side-filter" placeholder="Filter branches, tags…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="side-scroll">
        <Section title="Local" icon="branch" count={locals.length} open={open.local} onToggle={() => toggle("local")}>
          <Tree
            id="local"
            node={buildTree(locals.map((b) => ({ name: b.name, value: b })))}
            depth={0}
            closed={closed}
            toggle={toggleDir}
            render={(leaf, b, depth) => (
              <div
                key={b.name}
                className={"side-item" + (b.head ? " current" : "")}
                style={pad(depth)}
                title={b.upstream ? `${b.name} → ${b.upstream}` : b.name}
                onClick={() => goto(b.hash)}
                onDoubleClick={() => !b.head && op("Checkout", { op: "checkout", name: b.name })}
                onContextMenu={ctx(localMenu(b))}
              >
                {b.head ? <Icon name="check" size={13} className="ok" /> : <span className="dot" />}
                <span className="side-name">{leaf}</span>
                {b.ahead > 0 && <span className="ab">↑{b.ahead}</span>}
                {b.behind > 0 && <span className="ab">↓{b.behind}</span>}
                {b.gone && <span className="ab gone">gone</span>}
              </div>
            )}
          />
        </Section>

        <Section title="Remote" icon="cloud" count={remotes.length} open={open.remote} onToggle={() => toggle("remote")}>
          <Tree
            id="remote"
            node={buildTree(remotes.map((b) => ({ name: `${b.remote}/${b.short}`, value: b })))}
            depth={0}
            closed={closed}
            toggle={toggleDir}
            render={(leaf, b, depth) => (
              <div
                key={b.name}
                className="side-item"
                style={pad(depth)}
                title={b.name}
                onClick={() => goto(b.hash)}
                onDoubleClick={() => void checkoutRemote(b)}
                onContextMenu={ctx(remoteMenu(b))}
              >
                <span className="dot" />
                <span className="side-name">{leaf}</span>
              </div>
            )}
          />
        </Section>

        <Section title="Tags" icon="tag" count={tags.length} open={open.tags} onToggle={() => toggle("tags")}>
          {tags.map((t) => (
            <div key={t.name} className="side-item" style={pad(0)} onClick={() => goto(t.hash)} onContextMenu={ctx(tagMenu(t))}>
              <span className="dot tag" />
              <span className="side-name">{t.name}</span>
            </div>
          ))}
        </Section>

        <Section title="Stashes" icon="stash" count={stashes.length} open={open.stashes} onToggle={() => toggle("stashes")}>
          {stashes.map((s) => (
            <div
              key={s.index}
              className="side-item"
              style={pad(0)}
              title={`${s.index}: ${s.message}`}
              onClick={() => select({ kind: "commit", hash: s.hash })}
              onDoubleClick={() => void op("Apply stash", { op: "stashApply", index: s.index })}
              onContextMenu={ctx(stashMenu(s))}
            >
              <span className="dot stash" />
              <span className="side-name">{s.message}</span>
            </div>
          ))}
        </Section>

        <Section title="Worktrees" icon="worktree" count={trees.length} open={open.worktrees ?? true} onToggle={() => toggle("worktrees")}>
          {trees.map((w) => {
            const running = terms.some((t) => !t.exited && t.cwd.replace(/\\/g, "/") === w.path.replace(/\\/g, "/"));
            return (
              <div
                key={w.path}
                className="side-item"
                style={pad(0)}
                title={w.path}
                onClick={() => {
                  const b = refs.local.find((x) => x.name === w.branch);
                  if (b) goto(b.hash);
                }}
                onDoubleClick={() => void openPath(w.path)}
                onContextMenu={ctx(wtMenu(w))}
              >
                <span className={"dot" + (running ? " live" : "")} />
                <span className="side-name">{w.branch ?? w.head.slice(0, 7)}</span>
                {running && <Icon name="sparkle" size={12} className="ok" />}
                {w.prunable && <span className="ab gone">missing</span>}
              </div>
            );
          })}
          {!trees.length && (
            <div className="side-hint dim small" onClick={() => setDialog({ kind: "agent" })}>
              Start an AI agent on a new branch to get one.
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
