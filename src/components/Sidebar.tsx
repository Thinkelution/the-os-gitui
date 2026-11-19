import { useState, type ReactNode } from "react";
import { useStore, type MenuItem } from "../store";
import type { Branch, RemoteBranch, Stash, Tag } from "../lib/git";
import { copy } from "../lib/format";

function Section(props: { title: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="side-section">
      <div className="side-head" onClick={props.onToggle}>
        <span className="caret">{props.open ? "▾" : "▸"}</span>
        <span>{props.title}</span>
        <span className="side-count">{props.count}</span>
      </div>
      {props.open && <div className="side-body">{props.children}</div>}
    </div>
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
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ local: true, remote: true, tags: false, stashes: true });

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

  const locals = refs.local.filter((b) => match(b.name));
  const remotes = refs.remote.filter((b) => match(b.name));
  const tags = refs.tags.filter((t) => match(t.name));
  const stashes = refs.stashes.filter((s) => match(s.message));

  return (
    <div className="sidebar">
      <input className="side-filter" placeholder="Filter branches, tags…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="side-scroll">
        <Section title="LOCAL" count={locals.length} open={open.local} onToggle={() => toggle("local")}>
          {locals.map((b) => (
            <div
              key={b.name}
              className={"side-item" + (b.head ? " current" : "")}
              title={b.upstream ? `${b.name} → ${b.upstream}` : b.name}
              onClick={() => goto(b.hash)}
              onDoubleClick={() => !b.head && op("Checkout", { op: "checkout", name: b.name })}
              onContextMenu={ctx(localMenu(b))}
            >
              <span className="side-ico">{b.head ? "✔" : "⑂"}</span>
              <span className="side-name">{b.name}</span>
              {b.ahead > 0 && <span className="ab">↑{b.ahead}</span>}
              {b.behind > 0 && <span className="ab">↓{b.behind}</span>}
              {b.gone && <span className="ab gone">gone</span>}
            </div>
          ))}
        </Section>

        <Section title="REMOTE" count={remotes.length} open={open.remote} onToggle={() => toggle("remote")}>
          {refs.remotes.map((r) => {
            const list = remotes.filter((b) => b.remote === r);
            return (
              <div key={r}>
                <div className="side-group">☁ {r}</div>
                {list.map((b) => (
                  <div
                    key={b.name}
                    className="side-item nested"
                    title={b.name}
                    onClick={() => goto(b.hash)}
                    onDoubleClick={() => void checkoutRemote(b)}
                    onContextMenu={ctx(remoteMenu(b))}
                  >
                    <span className="side-ico">⑂</span>
                    <span className="side-name">{b.short}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </Section>

        <Section title="TAGS" count={tags.length} open={open.tags} onToggle={() => toggle("tags")}>
          {tags.map((t) => (
            <div key={t.name} className="side-item" onClick={() => goto(t.hash)} onContextMenu={ctx(tagMenu(t))}>
              <span className="side-ico">⌂</span>
              <span className="side-name">{t.name}</span>
            </div>
          ))}
        </Section>

        <Section title="STASHES" count={stashes.length} open={open.stashes} onToggle={() => toggle("stashes")}>
          {stashes.map((s) => (
            <div
              key={s.index}
              className="side-item"
              title={`${s.index}: ${s.message}`}
              onClick={() => select({ kind: "commit", hash: s.hash })}
              onDoubleClick={() => void op("Apply stash", { op: "stashApply", index: s.index })}
              onContextMenu={ctx(stashMenu(s))}
            >
              <span className="side-ico">⊞</span>
              <span className="side-name">{s.message}</span>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}
