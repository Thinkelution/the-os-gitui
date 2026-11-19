import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";
import { api } from "../lib/git";
import { Icon, type IconName } from "./Icon";

interface Cmd { id: string; label: string; group: string; icon: IconName; hint?: string; run: () => void }

/** All words of the query must appear in the label, in any order. */
function score(label: string, q: string): number {
  const l = label.toLowerCase();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  let s = 0;
  for (const w of words) {
    const i = l.indexOf(w);
    if (i < 0) return -1;
    s += i === 0 ? 3 : l[i - 1] === " " || l[i - 1] === "/" ? 2 : 1;
  }
  return s;
}

export function CommandPalette() {
  const openState = useStore((s) => s.palette);
  const setPalette = useStore((s) => s.setPalette);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openState) {
      setQ("");
      setIdx(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [openState]);

  const cmds = useMemo<Cmd[]>(() => {
    if (!openState) return [];
    const s = useStore.getState();
    const repo = s.active;
    const out: Cmd[] = [];
    const add = (c: Cmd) => out.push(c);
    add({ id: "open", group: "Repository", icon: "folder", label: "Open repository…", run: async () => {
      const r = await open({ directory: true });
      if (typeof r === "string") void s.openPath(r);
    } });
    add({ id: "clone", group: "Repository", icon: "clone", label: "Clone repository…", run: () => s.setDialog({ kind: "clone" }) });
    add({ id: "theme", group: "View", icon: s.theme === "dark" ? "sun" : "moon", label: `Switch to ${s.theme === "dark" ? "light" : "dark"} theme`, run: () => s.setTheme(s.theme === "dark" ? "light" : "dark") });
    for (const t of s.tabs) {
      if (t.path !== repo) add({ id: "tab:" + t.path, group: "Tabs", icon: "repo", label: `Switch to ${t.name}`, hint: t.path, run: () => s.activate(t.path) });
    }
    if (repo) {
      add({ id: "fetch", group: "Remote", icon: "fetch", label: "Fetch all", run: () => void s.op("Fetch", { op: "fetch" }) });
      add({ id: "pull", group: "Remote", icon: "pull", label: "Pull (fast-forward only)", run: () => void s.op("Pull", { op: "pull", mode: "ff-only" }) });
      add({ id: "pullr", group: "Remote", icon: "pull", label: "Pull (rebase)", run: () => void s.op("Pull", { op: "pull", mode: "rebase" }) });
      add({ id: "pullm", group: "Remote", icon: "pull", label: "Pull (merge)", run: () => void s.op("Pull", { op: "pull", mode: "merge" }) });
      add({ id: "push", group: "Remote", icon: "push", label: "Push", run: () => void s.op("Push", { op: "push", force: false }) });
      add({ id: "branch", group: "Branch", icon: "branch", label: "Create branch…", run: async () => {
        const r = await s.prompt({ title: "Create branch", label: "New branch name (starts from HEAD)", ok: "Create and switch" });
        const n = r?.value.trim();
        if (n) void s.op("Create branch", { op: "createBranch", name: n, start: null, checkout: true });
      } });
      add({ id: "stash", group: "Changes", icon: "stash", label: "Stash all changes", run: () => void s.op("Stash", { op: "stashPush", message: null, includeUntracked: true }) });
      if (s.refs?.stashes.length) add({ id: "pop", group: "Changes", icon: "pop", label: "Pop latest stash", run: () => void s.op("Pop stash", { op: "stashPop", index: "stash@{0}" }) });
      add({ id: "stageall", group: "Changes", icon: "plus", label: "Stage all changes", run: () => void s.run("Stage", (r) => api.stage(r, []), true) });
      add({ id: "unstageall", group: "Changes", icon: "minus", label: "Unstage all changes", run: () => void s.run("Unstage", (r) => api.unstage(r, []), true) });
      add({ id: "wip", group: "Changes", icon: "commit", label: "Go to working changes", run: () => { s.select({ kind: "wip" }); s.setView(null); } });
      add({ id: "agent", group: "AI", icon: "sparkle", label: "Start AI agent…", run: () => s.setDialog({ kind: "agent" }) });
      add({ id: "ag:claude", group: "AI", icon: "sparkle", label: "Start Claude Code here", run: () => void s.launch(repo, { kind: "agent", id: "claude", prompt: null }, `Claude Code · ${s.status?.branch ?? "HEAD"}`) });
      add({ id: "ag:codex", group: "AI", icon: "sparkle", label: "Start Codex here", run: () => void s.launch(repo, { kind: "agent", id: "codex", prompt: null }, `Codex CLI · ${s.status?.branch ?? "HEAD"}`) });
      add({ id: "term", group: "Repository", icon: "terminal", label: "New terminal (in app)", run: () => void s.launch(repo, { kind: "shell" }, "Terminal") });
      add({ id: "termx", group: "Repository", icon: "terminal", label: "Open external terminal", run: () => api.openTerminal(repo).catch((e) => s.toast("error", String(e))) });
      add({ id: "profiles", group: "Profile", icon: "user", label: "Manage git profiles…", run: () => s.setDialog({ kind: "profiles" }) });
      for (const p of s.profiles) {
        add({ id: "prof:" + p.id, group: "Profile", icon: "user", label: `Use profile ${p.label}`, hint: p.email, run: () => void s.useProfile(p) });
      }
      add({ id: "reveal", group: "Repository", icon: "folder", label: "Show repository in folder", run: () => api.reveal(repo).catch((e) => s.toast("error", String(e))) });
      add({ id: "refresh", group: "Repository", icon: "refresh", label: "Refresh", hint: "F5", run: () => void s.loadAll() });
      for (const b of s.refs?.local ?? []) {
        if (!b.head) add({ id: "co:" + b.name, group: "Checkout", icon: "branch", label: `Checkout ${b.name}`, run: () => void s.op("Checkout", { op: "checkout", name: b.name }) });
      }
      const locals = new Set(s.refs?.local.map((b) => b.name));
      for (const b of s.refs?.remote ?? []) {
        if (!locals.has(b.short)) add({ id: "cor:" + b.name, group: "Checkout", icon: "cloud", label: `Checkout ${b.name}`, run: () => void s.op("Checkout", { op: "checkoutRemote", remoteBranch: b.name, local: b.short }) });
      }
      for (const f of s.status?.files ?? []) {
        add({ id: "f:" + f.path, group: "Files", icon: "file", label: `History of ${f.path}`, run: () => s.setView({ kind: "history", path: f.path }) });
      }
    }
    return out;
  }, [openState]);

  const shown = useMemo(() => {
    if (!q.trim()) return cmds.filter((c) => c.group !== "Files").slice(0, 60);
    return cmds
      .map((c) => ({ c, s: score(c.label, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.c);
  }, [cmds, q]);

  useEffect(() => {
    list.current?.querySelector(".pal-item.on")?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  if (!openState) return null;
  const runAt = (i: number) => {
    const c = shown[i];
    if (!c) return;
    setPalette(false);
    c.run();
  };

  return (
    <div className="modal-overlay pal-overlay" onMouseDown={() => setPalette(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-input">
          <Icon name="search" />
          <input
            ref={input}
            placeholder="Type a command, branch or file…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPalette(false);
              else if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(shown.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              else if (e.key === "Enter") runAt(idx);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="pal-list" ref={list}>
          {shown.map((c, i) => (
            <div key={c.id} className={"pal-item" + (i === idx ? " on" : "")} onMouseMove={() => setIdx(i)} onClick={() => runAt(i)}>
              <Icon name={c.icon} />
              <span className="ellipsis">{c.label}</span>
              <span className="grow" />
              {c.hint && <span className="dim small ellipsis pal-hint">{c.hint}</span>}
              <span className="pal-group">{c.group}</span>
            </div>
          ))}
          {!shown.length && <div className="empty small">No matches</div>}
        </div>
      </div>
    </div>
  );
}
