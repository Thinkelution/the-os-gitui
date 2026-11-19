import { useStore, type MenuItem } from "./store";
import { api } from "./lib/git";
import { copy } from "./lib/format";

/** Context-menu items shared by every file list. */
export function fileMenu(path: string, opts: { conflicted?: boolean } = {}): MenuItem[] {
  const s = useStore.getState();
  const repo = s.active ?? "";
  const full = repo.replace(/[\\/]+$/, "") + "/" + path;
  const items: MenuItem[] = [];
  if (opts.conflicted) {
    items.push(
      { label: "Resolve using mine (ours)", action: () => void s.run("Use ours", (r) => api.resolveConflict(r, path, "ours"), true) },
      { label: "Resolve using theirs", action: () => void s.run("Use theirs", (r) => api.resolveConflict(r, path, "theirs"), true) },
      { sep: true },
    );
  }
  items.push(
    { label: "File history", action: () => s.setView({ kind: "history", path }) },
    { label: "Blame", action: () => s.setView({ kind: "blame", path }) },
    { sep: true },
    { label: "Show in folder", action: () => api.reveal(full).catch((e) => s.toast("error", String(e))) },
    { label: "Copy file path", action: () => void copy(path) },
    { label: "Copy full path", action: () => void copy(full) },
  );
  return items;
}
