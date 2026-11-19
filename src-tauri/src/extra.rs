//! File history, blame, conflicts, interactive rebase and OS helpers.

use crate::git;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

fn safe(s: &str) -> Result<&str, String> {
    if s.is_empty() || s.starts_with('-') || s.chars().any(|c| c.is_control()) {
        return Err(format!("Invalid name: {s:?}"));
    }
    Ok(s)
}

// ---------------------------------------------------------------- file history

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    hash: String,
    parents: Vec<String>,
    author: String,
    email: String,
    time: i64,
    subject: String,
    /// The file's path in this commit (changes across renames).
    path: String,
}

fn parse_history(out: &str, fallback: &str) -> Vec<HistoryEntry> {
    let mut list = vec![];
    for rec in out.split('\x1e') {
        let mut lines = rec.lines().filter(|l| !l.trim().is_empty());
        let Some(head) = lines.next() else { continue };
        let f: Vec<&str> = head.splitn(6, '\0').collect();
        if f.len() < 6 {
            continue;
        }
        let path = lines.next().unwrap_or(fallback).to_string();
        list.push(HistoryEntry {
            hash: f[0].into(),
            parents: f[1].split_whitespace().map(String::from).collect(),
            author: f[2].into(),
            email: f[3].into(),
            time: f[4].parse().unwrap_or(0),
            subject: f[5].into(),
            path,
        });
    }
    list
}

#[tauri::command]
pub async fn file_history(repo: String, path: String, limit: usize) -> Result<Vec<HistoryEntry>, String> {
    blocking(move || {
        let n = format!("-n{}", limit.clamp(1, 100_000));
        let out = git::run(
            Path::new(&repo),
            &[
                "log",
                "--follow",
                &n,
                "--name-only",
                "--format=%x1e%H%x00%P%x00%an%x00%ae%x00%at%x00%s",
                "--",
                &path,
            ],
        )?;
        Ok(parse_history(&out, &path))
    })
    .await
}

// ---------------------------------------------------------------- blame

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    author: String,
    time: i64,
    summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    hash: String,
    line: u32,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    lines: Vec<BlameLine>,
    commits: HashMap<String, BlameCommit>,
}

fn parse_blame(out: &str) -> Blame {
    let mut lines = vec![];
    let mut commits: HashMap<String, BlameCommit> = HashMap::new();
    let mut cur_hash = String::new();
    let mut cur_line = 0u32;
    let mut pending = BlameCommit { author: String::new(), time: 0, summary: String::new() };
    for l in out.lines() {
        if let Some(text) = l.strip_prefix('\t') {
            commits.entry(cur_hash.clone()).or_insert_with(|| pending.clone());
            lines.push(BlameLine { hash: cur_hash.clone(), line: cur_line, text: text.to_string() });
            continue;
        }
        let mut parts = l.split(' ');
        let first = parts.next().unwrap_or("");
        if first.len() >= 40 && first.chars().all(|c| c.is_ascii_hexdigit()) {
            cur_hash = first.to_string();
            parts.next();
            cur_line = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            if !commits.contains_key(&cur_hash) {
                pending = BlameCommit { author: String::new(), time: 0, summary: String::new() };
            }
        } else if let Some(v) = l.strip_prefix("author ") {
            pending.author = v.to_string();
        } else if let Some(v) = l.strip_prefix("author-time ") {
            pending.time = v.parse().unwrap_or(0);
        } else if let Some(v) = l.strip_prefix("summary ") {
            pending.summary = v.to_string();
        }
    }
    Blame { lines, commits }
}

#[tauri::command]
pub async fn blame(repo: String, path: String) -> Result<Blame, String> {
    blocking(move || {
        let out = git::run(Path::new(&repo), &["blame", "--porcelain", "--", &path])?;
        Ok(parse_blame(&out))
    })
    .await
}

// ---------------------------------------------------------------- conflicts

/// Resolve a conflicted file by taking one whole side, then stage it.
#[tauri::command]
pub async fn resolve_conflict(repo: String, path: String, side: String) -> Result<(), String> {
    blocking(move || {
        let p = Path::new(&repo);
        let flag = match side.as_str() {
            "ours" => "--ours",
            "theirs" => "--theirs",
            _ => return Err("side must be ours or theirs".into()),
        };
        git::run(p, &["checkout", flag, "--", &path])?;
        git::run(p, &["add", "--", &path])?;
        Ok(())
    })
    .await
}

// ---------------------------------------------------------------- interactive rebase

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoCommit {
    hash: String,
    subject: String,
    body: String,
    author: String,
    merge: bool,
}

/// Commits after `base` up to HEAD, oldest first.
#[tauri::command]
pub async fn rebase_list(repo: String, base: String) -> Result<Vec<TodoCommit>, String> {
    blocking(move || {
        let p = Path::new(&repo);
        let range = format!("{}..HEAD", safe(&base)?);
        git::run(p, &["merge-base", "--is-ancestor", &base, "HEAD"])
            .map_err(|_| "That commit is not part of the current branch.".to_string())?;
        let out = git::run(
            p,
            &["log", "--reverse", "--format=%x1e%H%x00%P%x00%an%x00%s%x00%B", &range],
        )?;
        let mut list = vec![];
        for rec in out.split('\x1e') {
            let f: Vec<&str> = rec.splitn(5, '\0').collect();
            if f.len() < 5 {
                continue;
            }
            list.push(TodoCommit {
                hash: f[0].trim().into(),
                merge: f[1].split_whitespace().count() > 1,
                author: f[2].into(),
                subject: f[3].into(),
                body: f[4].trim_end().into(),
            });
        }
        Ok(list)
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    hash: String,
    action: String,
    message: Option<String>,
}

static SEQ: AtomicU32 = AtomicU32::new(0);

fn sh_path(p: &Path) -> String {
    // Git runs editors through sh; forward slashes work there on Windows too.
    format!("'{}'", p.to_string_lossy().replace('\\', "/").replace('\'', "'\\''"))
}

pub fn build_todo(items: &[TodoItem], msg_file: &dyn Fn(usize) -> Result<PathBuf, String>) -> Result<String, String> {
    let mut todo = String::new();
    for (i, it) in items.iter().enumerate() {
        let h = safe(&it.hash)?;
        if !h.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!("Bad commit id {h}"));
        }
        match it.action.as_str() {
            "pick" | "drop" | "squash" | "fixup" => {
                if i == 0 && (it.action == "squash" || it.action == "fixup") {
                    return Err("The first commit cannot be squashed into a previous one.".into());
                }
                todo.push_str(&format!("{} {}\n", it.action, h));
            }
            "reword" => {
                let msg = it.message.clone().unwrap_or_default();
                if msg.trim().is_empty() {
                    return Err("A reworded commit needs a message.".into());
                }
                let f = msg_file(i)?;
                std::fs::write(&f, msg.as_bytes()).map_err(|e| e.to_string())?;
                todo.push_str(&format!("pick {h}\nexec git commit --amend --allow-empty -q -F {}\n", sh_path(&f)));
            }
            other => return Err(format!("Unknown action {other}")),
        }
    }
    Ok(todo)
}

#[tauri::command]
pub async fn rebase_interactive(repo: String, base: String, items: Vec<TodoItem>) -> Result<String, String> {
    blocking(move || rebase_run(Path::new(&repo), &base, &items)).await
}

fn rebase_run(p: &Path, base: &str, items: &[TodoItem]) -> Result<String, String> {
    {
        safe(base)?;
        let dir = std::env::temp_dir().join(format!(
            "osgitui-rebase-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let todo = build_todo(items, &|i| Ok(dir.join(format!("msg{i}.txt"))))?;
        let todo_file = dir.join("todo.txt");
        std::fs::write(&todo_file, todo).map_err(|e| e.to_string())?;
        let editor = format!("cp {}", sh_path(&todo_file));
        let o = git::run_env(p, &["rebase", "-i", base], None, &[("GIT_SEQUENCE_EDITOR", &editor)])?;
        // Message files must stay until the rebase is finished; a paused
        // rebase (conflict) still needs them for its exec lines.
        if o.ok {
            let _ = std::fs::remove_dir_all(&dir);
            Ok(format!("{}\n{}", o.stdout.trim(), o.stderr.trim()).trim().to_string())
        } else {
            let e = o.stderr.trim();
            Err(if e.is_empty() { o.stdout.trim().to_string() } else { e.to_string() })
        }
    }
}

// ---------------------------------------------------------------- OS helpers

fn spawn(cmd: &mut Command) -> Result<(), String> {
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Show a file or folder in Explorer / Finder / the Linux file manager.
#[tauri::command]
pub fn reveal(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("Not found: {path}"));
    }
    #[cfg(target_os = "windows")]
    {
        let win = path.replace('/', "\\");
        return spawn(Command::new("explorer").arg(format!("/select,{win}")));
    }
    #[cfg(target_os = "macos")]
    {
        return spawn(Command::new("open").arg("-R").arg(&p));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = if p.is_dir() { p.clone() } else { p.parent().map(Path::to_path_buf).unwrap_or(p.clone()) };
        return spawn(Command::new("xdg-open").arg(dir));
    }
}

/// Open a terminal window in the repository folder.
#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(format!("Folder not found: {path}"));
    }
    #[cfg(target_os = "windows")]
    {
        let win = path.replace('/', "\\");
        if spawn(Command::new("wt").arg("-d").arg(&win)).is_ok() {
            return Ok(());
        }
        return spawn(Command::new("cmd").args(["/C", "start", "cmd", "/K"]).current_dir(&win));
    }
    #[cfg(target_os = "macos")]
    {
        return spawn(Command::new("open").args(["-a", "Terminal"]).arg(&p));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for (bin, args) in [
            ("x-terminal-emulator", vec![]),
            ("gnome-terminal", vec!["--working-directory"]),
            ("konsole", vec!["--workdir"]),
            ("xfce4-terminal", vec!["--working-directory"]),
            ("xterm", vec![]),
        ] {
            let mut c = Command::new(bin);
            c.current_dir(&p);
            if !args.is_empty() {
                c.args(args).arg(&p);
            }
            if spawn(&mut c).is_ok() {
                return Ok(());
            }
        }
        Err("No terminal app found".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_history_with_renames() {
        let out = "\x1eaaa\0p1\0Ada\0a@x\0100\0Rename\n\nnew.rs\n\x1ebbb\0\0Ada\0a@x\x0050\0Add\n\nold.rs\n";
        let h = parse_history(out, "new.rs");
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].path, "new.rs");
        assert_eq!(h[1].path, "old.rs");
        assert!(h[1].parents.is_empty());
    }

    #[test]
    fn parses_blame_porcelain() {
        let h1 = "a".repeat(40);
        let h2 = "b".repeat(40);
        let out = format!(
            "{h1} 1 1 2\nauthor Ada\nauthor-time 100\nsummary First\nfilename f\n\tline one\n{h1} 2 2\n\tline two\n{h2} 3 3 1\nauthor Bob\nauthor-time 200\nsummary Second\nfilename f\n\tline three\n"
        );
        let b = parse_blame(&out);
        assert_eq!(b.lines.len(), 3);
        assert_eq!(b.lines[1].hash, h1);
        assert_eq!(b.lines[2].line, 3);
        assert_eq!(b.commits[&h2].author, "Bob");
        assert_eq!(b.commits[&h1].summary, "First");
    }

    /// End-to-end: real git, real repo. Reorder, reword, fixup and drop.
    #[test]
    fn interactive_rebase_on_real_repo() {
        let dir = std::env::temp_dir().join(format!("osgitui-it-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let g = |args: &[&str]| git::run(&dir, args).unwrap();
        g(&["init", "-q", "-b", "main"]);
        g(&["config", "user.name", "T"]);
        g(&["config", "user.email", "t@x"]);
        for (f, m) in [("base", "base"), ("a", "A"), ("b", "B"), ("c", "C"), ("d", "D")] {
            std::fs::write(dir.join(f), m).unwrap();
            g(&["add", "-A"]);
            g(&["commit", "-qm", m]);
        }
        let base = g(&["rev-parse", "HEAD~4"]).trim().to_string();
        let hashes: Vec<String> = g(&["log", "--reverse", "--format=%H", &format!("{base}..HEAD")])
            .lines()
            .map(String::from)
            .collect();
        let it = |i: usize, a: &str, m: Option<&str>| TodoItem {
            hash: hashes[i].clone(),
            action: a.into(),
            message: m.map(String::from),
        };
        // Order: B (reworded), A, C fixup into A, D dropped.
        let items = vec![it(1, "reword", Some("B renamed")), it(0, "pick", None), it(2, "fixup", None), it(3, "drop", None)];
        rebase_run(&dir, &base, &items).unwrap();
        let log = g(&["log", "--format=%s", &format!("{base}..HEAD")]);
        assert_eq!(log.lines().collect::<Vec<_>>(), vec!["A", "B renamed"]);
        assert!(dir.join("c").exists());
        assert!(!dir.join("d").exists());

        let hist = parse_history(
            &g(&["log", "--follow", "--name-only", "--format=%x1e%H%x00%P%x00%an%x00%ae%x00%at%x00%s", "--", "a"]),
            "a",
        );
        assert_eq!(hist.len(), 1);
        let b = parse_blame(&g(&["blame", "--porcelain", "--", "c"]));
        assert_eq!(b.lines.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn builds_rebase_todo() {
        let dir = std::env::temp_dir();
        let items = vec![
            TodoItem { hash: "abc123".into(), action: "pick".into(), message: None },
            TodoItem { hash: "def456".into(), action: "reword".into(), message: Some("New msg".into()) },
            TodoItem { hash: "fed789".into(), action: "fixup".into(), message: None },
        ];
        let t = build_todo(&items, &|i| Ok(dir.join(format!("osgitui-test-msg{i}.txt")))).unwrap();
        assert!(t.starts_with("pick abc123\npick def456\nexec git commit --amend"));
        assert!(t.ends_with("fixup fed789\n"));
        let bad = vec![TodoItem { hash: "abc".into(), action: "squash".into(), message: None }];
        assert!(build_todo(&bad, &|_| Ok(dir.clone())).is_err());
    }
}
