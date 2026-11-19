# OS GitUI

A free, open-source Git GUI for macOS, Linux and Windows.

![OS GitUI](site/screenshot.png)

Website: https://thinkelution.github.io/the-os-gitui/

## Features (v0.1)

- Commit graph with colored lanes, branch and tag badges, search, keyboard navigation
- Repository tabs; open, clone (with progress) or init a repo
- Stage, unstage and discard by file, hunk, or selected lines
- Unified and side-by-side diffs for working changes and commits
- Commit and amend
- Branches: create, switch, rename, delete, track remote branches
- Merge, rebase, cherry-pick, revert, reset (soft / mixed / hard)
- Fetch, pull (fast-forward / merge / rebase), push, force push with lease
- Tags: create, push, delete
- Stashes: push (with untracked), apply, pop, drop
- Abort / continue banner for merge, rebase, cherry-pick and revert
- Open from a terminal: `the-os-gitui path/to/repo`

### v0.2

- New look: SVG icons, light and dark themes, resizable side panels, branch folders
- Command palette (`Ctrl/⌘ K`): every action, branch checkout, tab switch
- Interactive rebase: reorder by drag, pick / reword / squash / fixup / drop
- File history (follows renames) and blame
- Merge conflicts: take mine or theirs per file
- Open a terminal or the file manager at the repo
- Shortcuts: `Ctrl/⌘ T` new tab, `Ctrl/⌘ W` close tab, `F5` refresh, `Esc` close view

### v0.3

- **AI agents, one click**: start Claude Code, Codex, Gemini, Copilot CLI, OpenCode,
  Aider, Cursor Agent or your own command in a built-in terminal. Missing agents
  get an Install button. Optional task text is pasted in when the agent starts.
- **Agents on their own branch**: by default each agent gets a new branch in its
  own folder (git worktree), so your work is never touched. Worktrees show in
  the sidebar with a live dot while an agent runs.
- **Git profiles**: many accounts on one computer. A profile sets commit name and
  email, the SSH key, and the HTTPS user name, per repo only. Profiles can be
  picked automatically from the remote (e.g. `github.com/acme`), and when cloning.
- Built-in terminal panel (`+` for a shell), resizable

## Stack

| Part | Choice |
|---|---|
| App shell | [Tauri 2](https://tauri.app) (Rust) |
| UI | React 18 + TypeScript + Vite, Zustand for state |
| Commit graph | Lane layout in Rust, drawn on a canvas with a virtual list |
| Git | The `git` CLI, so hooks, SSH keys, credential helpers and signing work as in a terminal |

## Develop

Needs Node 20+, Rust stable, and Git 2.31+. On Linux also install the
[Tauri system libraries](https://tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev        # run the app with hot reload
npm test                 # UI tests
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
npm run tauri build      # build installers for this OS
```

## Release

Push a tag such as `v0.1.0`. The `Release` workflow builds installers for macOS
(Apple Silicon and Intel), Windows and Linux, and creates a draft GitHub release.
Builds are not code-signed yet, so macOS and Windows show a warning on first open.

## Roadmap

- Interactive rebase
- Merge conflict editor
- File history and blame
- GitHub / GitLab pull requests
- AI layer: commit messages, diff explanations, coding agents on branches

## License

MIT
