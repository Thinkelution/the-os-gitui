import { invoke } from "@tauri-apps/api/core";

export interface RepoInfo { path: string; name: string }

/** [fromLane, toLane, color] */
export type Edge = [number, number, number];

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  subject: string;
  refs: string[];
  lane: number;
  color: number;
  up: Edge[];
  down: Edge[];
}

export interface FileChange {
  path: string;
  oldPath: string | null;
  index: string;
  worktree: string;
  conflicted: boolean;
  untracked: boolean;
}

export type RepoState = "" | "merging" | "rebasing" | "cherry-picking" | "reverting";

export interface Status {
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  headHash: string | null;
  files: FileChange[];
  state: RepoState;
}

export interface Branch { name: string; hash: string; upstream: string | null; ahead: number; behind: number; gone: boolean; head: boolean }
export interface RemoteBranch { name: string; remote: string; short: string; hash: string }
export interface Tag { name: string; hash: string }
export interface Stash { index: string; hash: string; message: string }
export interface Refs { local: Branch[]; remote: RemoteBranch[]; tags: Tag[]; stashes: Stash[]; remotes: string[] }

export interface CommitFile { status: string; path: string; oldPath: string | null }
export interface CommitDetails {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  committer: string;
  committerEmail: string;
  commitTime: number;
  body: string;
  files: CommitFile[];
}

export type PullMode = "ff-only" | "merge" | "rebase";
export type ResetMode = "soft" | "mixed" | "hard";

export type Op =
  | { op: "checkout"; name: string }
  | { op: "checkoutRemote"; remoteBranch: string; local: string }
  | { op: "checkoutDetached"; hash: string }
  | { op: "createBranch"; name: string; start: string | null; checkout: boolean }
  | { op: "deleteBranch"; name: string; force: boolean }
  | { op: "renameBranch"; old: string; new: string }
  | { op: "deleteRemoteBranch"; remote: string; name: string }
  | { op: "createTag"; name: string; target: string; message: string | null }
  | { op: "deleteTag"; name: string }
  | { op: "pushTag"; remote: string; name: string }
  | { op: "fetch" }
  | { op: "pull"; mode: PullMode }
  | { op: "push"; force: boolean }
  | { op: "merge"; name: string }
  | { op: "rebase"; onto: string }
  | { op: "cherryPick"; hash: string }
  | { op: "revert"; hash: string }
  | { op: "reset"; hash: string; mode: ResetMode }
  | { op: "stashPush"; message: string | null; includeUntracked: boolean }
  | { op: "stashApply"; index: string }
  | { op: "stashPop"; index: string }
  | { op: "stashDrop"; index: string }
  | { op: "abort" }
  | { op: "continue" };

export const api = {
  startupPath: () => invoke<string | null>("startup_path"),
  open: (path: string) => invoke<RepoInfo>("repo_open", { path }),
  init: (path: string) => invoke<RepoInfo>("repo_init", { path }),
  clone: (url: string, dest: string, profile: ProfileConfig | null = null) => invoke<RepoInfo>("repo_clone", { url, dest, profile }),
  identity: (repo: string) => invoke<Identity>("get_identity", { repo }),
  applyProfile: (repo: string, profile: ProfileConfig) => invoke<void>("apply_profile", { repo, profile }),
  worktrees: (repo: string) => invoke<Worktree[]>("worktree_list", { repo }),
  worktreeAdd: (repo: string, branch: string, base: string | null) => invoke<string>("worktree_add", { repo, branch, base }),
  worktreeRemove: (repo: string, path: string, force: boolean) => invoke<void>("worktree_remove", { repo, path, force }),
  agents: () => invoke<AgentInfo[]>("agents_detect"),
  ptyLaunch: (cwd: string, launch: Launch, cols: number, rows: number) => invoke<number>("pty_launch", { cwd, launch, cols, rows }),
  ptyWrite: (id: number, data: string) => invoke<void>("pty_write", { id, data }),
  ptyResize: (id: number, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  ptyKill: (id: number) => invoke<void>("pty_kill", { id }),
  agentConnection: (agent: "claude" | "codex", action: "status" | "connect" | "disconnect") =>
    invoke<ConnectStatus>("agent_connection", { agent, action }),
  log: (repo: string, limit: number) => invoke<Commit[]>("get_log", { repo, limit }),
  status: (repo: string) => invoke<Status>("get_status", { repo }),
  refs: (repo: string) => invoke<Refs>("get_refs", { repo }),
  fileDiff: (repo: string, path: string, staged: boolean, untracked: boolean) =>
    invoke<string>("file_diff", { repo, path, staged, untracked }),
  commitDetails: (repo: string, hash: string) => invoke<CommitDetails>("commit_details", { repo, hash }),
  commitFileDiff: (repo: string, hash: string, parent: string | null, path: string, oldPath: string | null) =>
    invoke<string>("commit_file_diff", { repo, hash, parent, path, oldPath }),
  stage: (repo: string, paths: string[]) => invoke<void>("stage", { repo, paths }),
  unstage: (repo: string, paths: string[]) => invoke<void>("unstage", { repo, paths }),
  discard: (repo: string, paths: string[], untracked: string[]) => invoke<void>("discard", { repo, paths, untracked }),
  applyPatch: (repo: string, patch: string, reverse: boolean, cached: boolean) =>
    invoke<void>("apply_patch", { repo, patch, reverse, cached }),
  commit: (repo: string, message: string, amend: boolean) => invoke<string>("commit", { repo, message, amend }),
  lastMessage: (repo: string) => invoke<string>("last_message", { repo }),
  op: (repo: string, op: Op) => invoke<string>("git_op", { repo, op }),
  fileHistory: (repo: string, path: string, limit = 2000) => invoke<HistoryEntry[]>("file_history", { repo, path, limit }),
  blame: (repo: string, path: string) => invoke<Blame>("blame", { repo, path }),
  resolveConflict: (repo: string, path: string, side: "ours" | "theirs") => invoke<void>("resolve_conflict", { repo, path, side }),
  rebaseList: (repo: string, base: string) => invoke<TodoCommit[]>("rebase_list", { repo, base }),
  rebaseInteractive: (repo: string, base: string, items: TodoItem[]) => invoke<string>("rebase_interactive", { repo, base, items }),
  reveal: (path: string) => invoke<void>("reveal", { path }),
  openTerminal: (path: string) => invoke<void>("open_terminal", { path }),
};

export interface HistoryEntry { hash: string; parents: string[]; author: string; email: string; time: number; subject: string; path: string }
export interface BlameLine { hash: string; line: number; text: string }
export interface Blame { lines: BlameLine[]; commits: Record<string, { author: string; time: number; summary: string }> }
export interface TodoCommit { hash: string; subject: string; body: string; author: string; merge: boolean }
export type TodoAction = "pick" | "reword" | "squash" | "fixup" | "drop";
export interface TodoItem { hash: string; action: TodoAction; message: string | null }

/** What the backend needs to apply a profile to a repo. */
export interface ProfileConfig { userName: string; email: string; sshKey: string | null; host: string | null; hostUser: string | null }
export interface Identity { name: string; email: string; local: boolean; sshCommand: string | null; remotes: string[] }
export interface Worktree { path: string; head: string; branch: string | null; main: boolean; locked: boolean; prunable: boolean }
export interface AgentInfo { id: string; name: string; installed: boolean; path: string | null; install: string | null; site: string }
export type Launch =
  | { kind: "shell" }
  | { kind: "agent"; id: string; prompt: string | null }
  | { kind: "install"; id: string }
  | { kind: "custom"; command: string; prompt: string | null };
export interface ConnectStatus { agent: string; installed: boolean; connected: boolean; command: boolean }
