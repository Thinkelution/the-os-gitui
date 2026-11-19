import { create } from "zustand";
import { api, type Commit, type Op, type Refs, type RepoInfo, type Status } from "./lib/git";

export type Selection = { kind: "wip" } | { kind: "commit"; hash: string };

export type DiffSource =
  | { kind: "work"; path: string; staged: boolean; untracked: boolean; conflicted: boolean }
  | { kind: "commit"; hash: string; parent: string | null; path: string; oldPath: string | null };

/** What the center area shows instead of the graph. A diff always wins. */
export type CenterView =
  | { kind: "history"; path: string }
  | { kind: "blame"; path: string }
  | { kind: "rebase"; base: string };

export type Theme = "dark" | "light";

export interface MenuItem { label?: string; action?: () => void; danger?: boolean; disabled?: boolean; sep?: boolean; hint?: string }
export interface Toast { id: number; kind: "error" | "info"; text: string }

export interface PromptResult { value: string; checked: boolean }
export interface PromptOpts { title: string; label?: string; value?: string; ok?: string; check?: { label: string; value: boolean } }
export interface ConfirmOpts { title: string; message: string; ok?: string; danger?: boolean }

export type Dialog =
  | ({ kind: "prompt"; resolve: (v: PromptResult | null) => void } & PromptOpts)
  | ({ kind: "confirm"; resolve: (v: boolean) => void } & ConfirmOpts)
  | { kind: "clone" };

const PAGE = 5000;

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
const save = (key: string, v: unknown) => localStorage.setItem(key, JSON.stringify(v));

interface State {
  tabs: RepoInfo[];
  active: string | null;
  recent: RepoInfo[];
  commits: Commit[];
  limit: number;
  status: Status | null;
  refs: Refs | null;
  selection: Selection;
  diff: DiffSource | null;
  diffText: string;
  diffLoading: boolean;
  busy: string | null;
  toasts: Toast[];
  menu: { x: number; y: number; items: MenuItem[] } | null;
  dialog: Dialog | null;
  jump: string | null;
  view: CenterView | null;
  theme: Theme;
  palette: boolean;

  setView(v: CenterView | null): void;
  setTheme(t: Theme): void;
  setPalette(open: boolean): void;
  openPath(path: string): Promise<boolean>;
  activate(path: string | null): void;
  closeTab(path: string): void;
  loadAll(): Promise<void>;
  refreshStatus(): Promise<void>;
  loadMore(): void;
  run(label: string, fn: (repo: string) => Promise<unknown>, quiet?: boolean): Promise<boolean>;
  op(label: string, op: Op): Promise<boolean>;
  select(sel: Selection): void;
  openDiff(src: DiffSource): void;
  closeDiff(): void;
  loadDiff(): Promise<void>;
  toast(kind: Toast["kind"], text: string): void;
  dismiss(id: number): void;
  showMenu(at: { clientX: number; clientY: number }, items: MenuItem[]): void;
  hideMenu(): void;
  prompt(o: PromptOpts): Promise<PromptResult | null>;
  confirm(o: ConfirmOpts): Promise<boolean>;
  setDialog(d: Dialog | null): void;
  jumpTo(hash: string | null): void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  tabs: load<RepoInfo[]>("tabs", []),
  active: load<string | null>("active", null),
  recent: load<RepoInfo[]>("recent", []),
  commits: [],
  limit: PAGE,
  status: null,
  refs: null,
  selection: { kind: "wip" },
  diff: null,
  diffText: "",
  diffLoading: false,
  busy: null,
  toasts: [],
  menu: null,
  dialog: null,
  jump: null,
  view: null,
  theme: load<Theme>("theme", "dark"),
  palette: false,

  setView(v) {
    set({ view: v, diff: null, diffText: "" });
  },
  setTheme(t) {
    set({ theme: t });
    save("theme", t);
  },
  setPalette(open) {
    set({ palette: open });
  },

  async openPath(path) {
    try {
      const info = await api.open(path);
      const { tabs, recent } = get();
      const nextTabs = tabs.some((t) => t.path === info.path) ? tabs : [...tabs, info];
      const nextRecent = [info, ...recent.filter((r) => r.path !== info.path)].slice(0, 12);
      set({ tabs: nextTabs, recent: nextRecent });
      save("tabs", nextTabs);
      save("recent", nextRecent);
      get().activate(info.path);
      return true;
    } catch (e) {
      get().toast("error", String(e));
      return false;
    }
  },

  activate(path) {
    set({ active: path, commits: [], status: null, refs: null, limit: PAGE, selection: { kind: "wip" }, diff: null, diffText: "", view: null });
    save("active", path);
    if (path) void get().loadAll();
  },

  closeTab(path) {
    const tabs = get().tabs.filter((t) => t.path !== path);
    set({ tabs });
    save("tabs", tabs);
    if (get().active === path) get().activate(tabs.length ? tabs[tabs.length - 1].path : null);
  },

  async loadAll() {
    const repo = get().active;
    if (!repo) return;
    try {
      const [commits, status, refs] = await Promise.all([api.log(repo, get().limit), api.status(repo), api.refs(repo)]);
      if (get().active !== repo) return;
      set({ commits, status, refs });
    } catch (e) {
      if (get().active === repo) get().toast("error", String(e));
    }
  },

  async refreshStatus() {
    const repo = get().active;
    if (!repo || get().busy) return;
    try {
      const status = await api.status(repo);
      if (get().active !== repo) return;
      const prev = get().status;
      if (prev && JSON.stringify(prev) === JSON.stringify(status)) return;
      set({ status });
      const moved = !prev || prev.headHash !== status.headHash || prev.branch !== status.branch ||
        prev.ahead !== status.ahead || prev.behind !== status.behind;
      if (moved) {
        const [commits, refs] = await Promise.all([api.log(repo, get().limit), api.refs(repo)]);
        if (get().active === repo) set({ commits, refs });
      }
      if (get().diff?.kind === "work") void get().loadDiff();
    } catch {
      // The repo may be mid-operation (index.lock); the next poll retries.
    }
  },

  loadMore() {
    const { commits, limit } = get();
    if (commits.length < limit) return;
    set({ limit: limit + PAGE });
    void get().loadAll();
  },

  async run(label, fn, quiet) {
    const repo = get().active;
    if (!repo) return false;
    set({ busy: label });
    try {
      const out = await fn(repo);
      if (!quiet && typeof out === "string" && out.trim()) {
        get().toast("info", out.trim().split("\n").slice(-6).join("\n"));
      }
      return true;
    } catch (e) {
      get().toast("error", String(e));
      return false;
    } finally {
      set({ busy: null });
      await get().loadAll();
      if (get().diff) await get().loadDiff();
    }
  },

  op(label, op) {
    return get().run(label, (repo) => api.op(repo, op));
  },

  select(sel) {
    set({ selection: sel, diff: null, diffText: "" });
  },

  openDiff(src) {
    set({ diff: src, diffText: "" });
    void get().loadDiff();
  },

  closeDiff() {
    set({ diff: null, diffText: "" });
  },

  async loadDiff() {
    const repo = get().active;
    const d = get().diff;
    if (!repo || !d) return;
    set({ diffLoading: true });
    try {
      const text = d.kind === "work"
        ? await api.fileDiff(repo, d.path, d.staged, d.untracked)
        : await api.commitFileDiff(repo, d.hash, d.parent, d.path, d.oldPath);
      if (get().diff === d) set({ diffText: text });
    } catch (e) {
      if (get().diff === d) {
        set({ diffText: "" });
        get().toast("error", String(e));
      }
    } finally {
      set({ diffLoading: false });
    }
  },

  toast(kind, text) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }].slice(-5) });
    setTimeout(() => get().dismiss(id), kind === "error" ? 12000 : 4000);
  },

  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  showMenu(at, items) {
    set({ menu: { x: at.clientX, y: at.clientY, items } });
  },

  hideMenu() {
    set({ menu: null });
  },

  prompt(o) {
    return new Promise((resolve) =>
      set({ dialog: { kind: "prompt", ...o, resolve: (v) => { set({ dialog: null }); resolve(v); } } }),
    );
  },

  confirm(o) {
    return new Promise((resolve) =>
      set({ dialog: { kind: "confirm", ...o, resolve: (v) => { set({ dialog: null }); resolve(v); } } }),
    );
  },

  setDialog(d) {
    set({ dialog: d });
  },

  jumpTo(hash) {
    set({ jump: hash });
  },
}));
