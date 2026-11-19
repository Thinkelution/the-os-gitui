export function relTime(sec: number): string {
  const d = Date.now() / 1000 - sec;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}d ago`;
  return new Date(sec * 1000).toLocaleDateString();
}

export const fullTime = (sec: number) => new Date(sec * 1000).toLocaleString();

export function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function hue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => undefined);

export type BadgeKind = "head" | "local" | "remote" | "tag";
export interface Badge { kind: BadgeKind; name: string; current?: boolean }

/** Turn `git log %D` decorations into badges. */
export function badges(refs: string[], localNames: Set<string>): Badge[] {
  const out: Badge[] = [];
  for (const r of refs) {
    if (r.startsWith("HEAD -> ")) out.push({ kind: "local", name: r.slice(8), current: true });
    else if (r === "HEAD") out.push({ kind: "head", name: "HEAD" });
    else if (r.startsWith("tag: ")) out.push({ kind: "tag", name: r.slice(5) });
    else if (localNames.has(r)) out.push({ kind: "local", name: r });
    else if (!r.endsWith("/HEAD")) out.push({ kind: "remote", name: r });
  }
  return out;
}
