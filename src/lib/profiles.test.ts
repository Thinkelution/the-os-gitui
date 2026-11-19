import { describe, expect, it } from "vitest";
import { currentProfile, matchProfile, normalizeRemote, type Profile } from "./profiles";

const p = (id: string, email: string, match: string[]): Profile => ({
  id, label: id, userName: id, email, match, sshKey: null, host: null, hostUser: null,
});

describe("normalizeRemote", () => {
  it.each([
    ["git@github.com:Acme/App.git", "github.com/acme/app"],
    ["https://user@github.com/Acme/App", "github.com/acme/app"],
    ["https://github.com/Acme/App.git/", "github.com/acme/app"],
    ["ssh://git@gitlab.example.com:2222/team/x.git", "gitlab.example.com/team/x"],
    ["github.com/acme", "github.com/acme"],
  ])("%s", (url, want) => expect(normalizeRemote(url)).toBe(want));
});

describe("matchProfile", () => {
  const work = p("work", "a@work.com", ["github.com/acme"]);
  const team = p("team", "a@team.com", ["github.com/acme/secret"]);
  const home = p("home", "a@home.dev", ["github.com"]);
  it("picks the longest matching rule", () => {
    expect(matchProfile([home, work, team], ["git@github.com:Acme/secret.git"])?.id).toBe("team");
    expect(matchProfile([home, work, team], ["https://github.com/acme/web"])?.id).toBe("work");
    expect(matchProfile([home, work], ["git@github.com:me/blog.git"])?.id).toBe("home");
  });
  it("does not match a longer owner name by prefix", () => {
    expect(matchProfile([work], ["git@github.com:acme-labs/x.git"])).toBeNull();
  });
  it("finds the current profile by email", () => {
    const id = { name: "", email: "A@Work.com", local: true, sshCommand: null, remotes: [] };
    expect(currentProfile([home, work], id)?.id).toBe("work");
  });
});
