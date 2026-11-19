import type { Identity, ProfileConfig } from "./git";

export interface Profile extends ProfileConfig {
  id: string;
  /** Shown in the UI, e.g. "Work" or "Personal". */
  label: string;
  /** Remotes that should use this profile, e.g. "github.com/acme". */
  match: string[];
}

const KEY = "profiles";

export function loadProfiles(): Profile[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Profile[];
  } catch {
    return [];
  }
}

export const saveProfiles = (p: Profile[]) => localStorage.setItem(KEY, JSON.stringify(p));

export const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * Turn any remote URL into "host/owner/repo" (lower case).
 *   git@github.com:Acme/App.git      -> github.com/acme/app
 *   https://user@github.com/Acme/App -> github.com/acme/app
 *   ssh://git@host:22/acme/app.git   -> host/acme/app
 */
export function normalizeRemote(url: string): string {
  let u = url.trim().toLowerCase();
  u = u.replace(/^[a-z+]+:\/\//, "");
  u = u.replace(/^[^@/]+@/, "");
  u = u.replace(/^([^/:]+):(\d+)\//, "$1/");
  u = u.replace(/^([^/:]+):/, "$1/");
  return u.replace(/\/+$/, "").replace(/\.git$/, "");
}

/** The profile whose match rule fits one of the remotes; the longest rule wins. */
export function matchProfile(profiles: Profile[], remotes: string[]): Profile | null {
  const norm = remotes.map(normalizeRemote);
  let best: Profile | null = null;
  let len = 0;
  for (const p of profiles) {
    for (const m of p.match) {
      const rule = normalizeRemote(m);
      if (!rule) continue;
      if (norm.some((r) => r === rule || r.startsWith(rule + "/")) && rule.length > len) {
        best = p;
        len = rule.length;
      }
    }
  }
  return best;
}

/** The saved profile this repo currently uses, by email. */
export function currentProfile(profiles: Profile[], id: Identity | null): Profile | null {
  if (!id?.email) return null;
  return profiles.find((p) => p.email.toLowerCase() === id.email.toLowerCase()) ?? null;
}

export const toConfig = (p: Profile): ProfileConfig => ({
  userName: p.userName,
  email: p.email,
  sshKey: p.sshKey || null,
  host: p.host || null,
  hostUser: p.hostUser || null,
});
