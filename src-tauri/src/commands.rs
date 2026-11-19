//! Tauri commands called by the UI.

use crate::{git, graph};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};

/// Run blocking git work off the UI thread.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// Reject values that git could read as an option, or that hold control chars.
fn safe(s: &str) -> Result<&str, String> {
    if s.is_empty() || s.starts_with('-') || s.chars().any(|c| c.is_control()) {
        return Err(format!("Invalid name: {s:?}"));
    }
    Ok(s)
}

fn has_head(p: &Path) -> bool {
    git::run(p, &["rev-parse", "-q", "--verify", "HEAD"]).is_ok()
}

/// Run `base -- paths...` in chunks so long file lists fit on a command line.
fn run_paths(p: &Path, base: &[&str], paths: &[String]) -> Result<(), String> {
    for chunk in paths.chunks(200) {
        let mut a: Vec<&str> = base.to_vec();
        a.push("--");
        a.extend(chunk.iter().map(|s| s.as_str()));
        git::run(p, &a)?;
    }
    Ok(())
}

// ---------------------------------------------------------------- repos

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
}

fn open_repo(path: &str) -> Result<RepoInfo, String> {
    let p = Path::new(path);
    if !p.is_dir() {
        return Err(format!("Folder not found: {path}"));
    }
    let top = git::run(p, &["rev-parse", "--show-toplevel"])
        .map_err(|_| format!("Not a Git repository: {path}"))?;
    let top = top.trim().to_string();
    let name = Path::new(&top)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| top.clone());
    Ok(RepoInfo { path: top, name })
}

#[tauri::command]
pub async fn repo_open(path: String) -> Result<RepoInfo, String> {
    blocking(move || open_repo(&path)).await
}

/// Folder passed on the command line (`the-os-gitui ./my-repo`), if any.
#[tauri::command]
pub fn startup_path() -> Option<String> {
    let arg = std::env::args().nth(1)?;
    let p = std::fs::canonicalize(&arg).ok()?;
    p.is_dir().then(|| {
        let s = p.to_string_lossy().into_owned();
        // Drop the Windows verbatim prefix that canonicalize adds.
        s.strip_prefix(r"\\?\").map(String::from).unwrap_or(s)
    })
}

#[tauri::command]
pub async fn repo_init(path: String) -> Result<RepoInfo, String> {
    blocking(move || {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        git::run(Path::new(&path), &["init"])?;
        open_repo(&path)
    })
    .await
}

/// Clone a repo, streaming git's progress lines as `clone-progress` events.
#[tauri::command]
pub async fn repo_clone(app: AppHandle, url: String, dest: String) -> Result<RepoInfo, String> {
    blocking(move || {
        let url = url.trim().to_string();
        safe(&url)?;
        let destp = PathBuf::from(&dest);
        let parent = destp
            .parent()
            .ok_or_else(|| "Choose a destination folder".to_string())?
            .to_path_buf();
        std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
        if destp.exists()
            && destp
                .read_dir()
                .map(|mut d| d.next().is_some())
                .unwrap_or(true)
        {
            return Err(format!("Destination is not empty: {dest}"));
        }

        let mut c = git::command(&parent);
        c.args(["clone", "--progress", "--", &url, &dest])
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let mut child = c.spawn().map_err(|e| format!("Could not start git: {e}"))?;
        let mut err = child.stderr.take().ok_or("no stderr")?;
        let mut buf = [0u8; 4096];
        let mut line: Vec<u8> = Vec::new();
        let mut last: VecDeque<String> = VecDeque::new();
        loop {
            let n = err.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            for &b in &buf[..n] {
                if b == b'\r' || b == b'\n' {
                    if !line.is_empty() {
                        let s = String::from_utf8_lossy(&line).into_owned();
                        let _ = app.emit("clone-progress", &s);
                        last.push_back(s);
                        if last.len() > 8 {
                            last.pop_front();
                        }
                        line.clear();
                    }
                } else {
                    line.push(b);
                }
            }
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            let msg: Vec<String> = last
                .into_iter()
                .filter(|l| !l.starts_with("Receiving") && !l.starts_with("Resolving"))
                .collect();
            return Err(msg.join("\n"));
        }
        open_repo(&dest)
    })
    .await
}

// ---------------------------------------------------------------- log + graph

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRow {
    hash: String,
    parents: Vec<String>,
    author: String,
    email: String,
    time: i64,
    subject: String,
    refs: Vec<String>,
    lane: u16,
    color: u16,
    up: Vec<[u16; 3]>,
    down: Vec<[u16; 3]>,
}

#[tauri::command]
pub async fn get_log(repo: String, limit: usize) -> Result<Vec<CommitRow>, String> {
    blocking(move || {
        let p = Path::new(&repo);
        let head = has_head(p);
        let n = format!("-n{}", limit.clamp(1, 1_000_000));
        let mut args = vec![
            "log",
            "--date-order",
            n.as_str(),
            "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D%x1e",
            "--branches",
            "--tags",
            "--remotes",
        ];
        if head {
            args.push("HEAD");
        }
        let out = match git::run(p, &args) {
            Ok(o) => o,
            Err(_) if !head => return Ok(vec![]), // empty repository
            Err(e) => return Err(e),
        };

        let mut fields: Vec<[&str; 7]> = Vec::new();
        for rec in out.split('\x1e') {
            let rec = rec.trim_start_matches(['\n', '\r']);
            if rec.is_empty() {
                continue;
            }
            let f: Vec<&str> = rec.splitn(7, '\0').collect();
            if f.len() == 7 {
                fields.push([f[0], f[1], f[2], f[3], f[4], f[5], f[6]]);
            }
        }
        let input: Vec<(&str, Vec<&str>)> = fields
            .iter()
            .map(|f| (f[0], f[1].split_whitespace().collect()))
            .collect();
        let rows = graph::layout(&input);

        Ok(fields
            .iter()
            .zip(input.iter())
            .zip(rows)
            .map(|((f, (_, parents)), row)| CommitRow {
                hash: f[0].to_string(),
                parents: parents.iter().map(|s| s.to_string()).collect(),
                author: f[2].to_string(),
                email: f[3].to_string(),
                time: f[4].parse().unwrap_or(0),
                subject: f[5].to_string(),
                refs: f[6]
                    .trim()
                    .split(", ")
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .collect(),
                lane: row.lane,
                color: row.color,
                up: row.up,
                down: row.down,
            })
            .collect())
    })
    .await
}

// ---------------------------------------------------------------- status

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    path: String,
    old_path: Option<String>,
    index: String,
    worktree: String,
    conflicted: bool,
    untracked: bool,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    branch: Option<String>,
    detached: bool,
    upstream: Option<String>,
    ahead: i64,
    behind: i64,
    head_hash: Option<String>,
    files: Vec<FileChange>,
    state: String,
}

fn repo_state(p: &Path) -> String {
    let gd = match git::run(p, &["rev-parse", "--absolute-git-dir"]) {
        Ok(s) => PathBuf::from(s.trim()),
        Err(_) => return String::new(),
    };
    let s = if gd.join("rebase-merge").exists() || gd.join("rebase-apply").exists() {
        "rebasing"
    } else if gd.join("MERGE_HEAD").exists() {
        "merging"
    } else if gd.join("CHERRY_PICK_HEAD").exists() {
        "cherry-picking"
    } else if gd.join("REVERT_HEAD").exists() {
        "reverting"
    } else {
        ""
    };
    s.to_string()
}

fn xy(code: &str) -> (String, String) {
    let mut c = code.chars();
    (
        c.next().unwrap_or('.').to_string(),
        c.next().unwrap_or('.').to_string(),
    )
}

fn parse_status(out: &str) -> Status {
    let mut st = Status::default();
    let mut it = out.split('\0');
    while let Some(e) = it.next() {
        if e.is_empty() {
            continue;
        }
        if let Some(rest) = e.strip_prefix("# ") {
            if let Some(v) = rest.strip_prefix("branch.oid ") {
                if v != "(initial)" {
                    st.head_hash = Some(v.to_string());
                }
            } else if let Some(v) = rest.strip_prefix("branch.head ") {
                if v == "(detached)" {
                    st.detached = true;
                } else {
                    st.branch = Some(v.to_string());
                }
            } else if let Some(v) = rest.strip_prefix("branch.upstream ") {
                st.upstream = Some(v.to_string());
            } else if let Some(v) = rest.strip_prefix("branch.ab ") {
                let mut parts = v.split(' ');
                st.ahead = parts
                    .next()
                    .and_then(|x| x.trim_start_matches('+').parse().ok())
                    .unwrap_or(0);
                st.behind = parts
                    .next()
                    .and_then(|x| x.trim_start_matches('-').parse().ok())
                    .unwrap_or(0);
            }
            continue;
        }
        let (kind, rest) = e.split_at(1);
        match kind {
            "1" => {
                let f: Vec<&str> = e.splitn(9, ' ').collect();
                if f.len() == 9 {
                    let (i, w) = xy(f[1]);
                    st.files.push(FileChange {
                        path: f[8].into(),
                        old_path: None,
                        index: i,
                        worktree: w,
                        conflicted: false,
                        untracked: false,
                    });
                }
            }
            "2" => {
                let f: Vec<&str> = e.splitn(10, ' ').collect();
                let orig = it.next().map(String::from);
                if f.len() == 10 {
                    let (i, w) = xy(f[1]);
                    st.files.push(FileChange {
                        path: f[9].into(),
                        old_path: orig,
                        index: i,
                        worktree: w,
                        conflicted: false,
                        untracked: false,
                    });
                }
            }
            "u" => {
                let f: Vec<&str> = e.splitn(11, ' ').collect();
                if f.len() == 11 {
                    let (i, w) = xy(f[1]);
                    st.files.push(FileChange {
                        path: f[10].into(),
                        old_path: None,
                        index: i,
                        worktree: w,
                        conflicted: true,
                        untracked: false,
                    });
                }
            }
            "?" => st.files.push(FileChange {
                path: rest.trim_start().into(),
                old_path: None,
                index: ".".into(),
                worktree: "?".into(),
                conflicted: false,
                untracked: true,
            }),
            _ => {}
        }
    }
    st
}

#[tauri::command]
pub async fn get_status(repo: String) -> Result<Status, String> {
    blocking(move || {
        let p = Path::new(&repo);
        let out = git::run(
            p,
            &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
        )?;
        let mut st = parse_status(&out);
        st.state = repo_state(p);
        Ok(st)
    })
    .await
}

// ---------------------------------------------------------------- refs

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    name: String,
    hash: String,
    upstream: Option<String>,
    ahead: i64,
    behind: i64,
    gone: bool,
    head: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranch {
    name: String,
    remote: String,
    short: String,
    hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    name: String,
    hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    index: String,
    hash: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refs {
    local: Vec<Branch>,
    remote: Vec<RemoteBranch>,
    tags: Vec<Tag>,
    stashes: Vec<Stash>,
    remotes: Vec<String>,
}

fn parse_track(t: &str) -> (i64, i64, bool) {
    if t == "gone" {
        return (0, 0, true);
    }
    let (mut a, mut b) = (0, 0);
    for part in t.split(", ") {
        if let Some(x) = part.strip_prefix("ahead ") {
            a = x.parse().unwrap_or(0);
        } else if let Some(x) = part.strip_prefix("behind ") {
            b = x.parse().unwrap_or(0);
        }
    }
    (a, b, false)
}

#[tauri::command]
pub async fn get_refs(repo: String) -> Result<Refs, String> {
    blocking(move || {
        let p = Path::new(&repo);
        let remotes: Vec<String> = git::run(p, &["remote"])?
            .lines()
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect();
        let out = git::run(
            p,
            &[
                "for-each-ref",
                "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
        )?;
        let mut refs = Refs {
            local: vec![],
            remote: vec![],
            tags: vec![],
            stashes: vec![],
            remotes: remotes.clone(),
        };
        for line in out.lines() {
            let f: Vec<&str> = line.split('\0').collect();
            if f.len() < 6 {
                continue;
            }
            let (r, oid, peeled, up, track, head) = (f[0], f[1], f[2], f[3], f[4], f[5]);
            if let Some(n) = r.strip_prefix("refs/heads/") {
                let (ahead, behind, gone) = parse_track(track);
                refs.local.push(Branch {
                    name: n.into(),
                    hash: oid.into(),
                    upstream: (!up.is_empty()).then(|| up.to_string()),
                    ahead,
                    behind,
                    gone,
                    head: head == "*",
                });
            } else if let Some(n) = r.strip_prefix("refs/remotes/") {
                if n.ends_with("/HEAD") {
                    continue;
                }
                let remote = remotes
                    .iter()
                    .filter(|rm| n.starts_with(&format!("{rm}/")))
                    .max_by_key(|rm| rm.len())
                    .cloned()
                    .unwrap_or_else(|| n.split('/').next().unwrap_or("").to_string());
                let short = n[remote.len().min(n.len())..].trim_start_matches('/').to_string();
                refs.remote.push(RemoteBranch {
                    name: n.into(),
                    remote,
                    short,
                    hash: oid.into(),
                });
            } else if let Some(n) = r.strip_prefix("refs/tags/") {
                refs.tags.push(Tag {
                    name: n.into(),
                    hash: if peeled.is_empty() { oid } else { peeled }.into(),
                });
            }
        }
        if let Ok(out) = git::run(p, &["stash", "list", "--format=%gd%x00%H%x00%s"]) {
            for line in out.lines() {
                let f: Vec<&str> = line.splitn(3, '\0').collect();
                if f.len() == 3 {
                    refs.stashes.push(Stash {
                        index: f[0].into(),
                        hash: f[1].into(),
                        message: f[2].into(),
                    });
                }
            }
        }
        Ok(refs)
    })
    .await
}

// ---------------------------------------------------------------- diffs

fn untracked_diff(repo: &Path, rel: &str) -> Result<String, String> {
    let full = repo.join(rel);
    let meta = std::fs::metadata(&full).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Ok(String::new());
    }
    let header = format!("diff --git a/{rel} b/{rel}\nnew file mode 100644\n");
    if meta.len() > 5 * 1024 * 1024 {
        return Ok(format!("{header}Binary files /dev/null and b/{rel} differ\n"));
    }
    let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
    if bytes.iter().take(8000).any(|&b| b == 0) {
        return Ok(format!("{header}Binary files /dev/null and b/{rel} differ\n"));
    }
    let text = String::from_utf8_lossy(&bytes);
    if text.is_empty() {
        return Ok(header);
    }
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let mut out = format!("{header}--- /dev/null\n+++ b/{rel}\n@@ -0,0 +1,{} @@\n", lines.len());
    for l in &lines {
        out.push('+');
        out.push_str(l);
        if !l.ends_with('\n') {
            out.push_str("\n\\ No newline at end of file\n");
        }
    }
    Ok(out)
}

/// Diff of one working-tree file: staged (index vs HEAD) or unstaged.
#[tauri::command]
pub async fn file_diff(
    repo: String,
    path: String,
    staged: bool,
    untracked: bool,
) -> Result<String, String> {
    blocking(move || {
        let p = Path::new(&repo);
        if untracked {
            return untracked_diff(p, &path);
        }
        let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-M"];
        if staged {
            args.push("--cached");
        }
        args.push("--");
        args.push(&path);
        git::run(p, &args)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    status: String,
    path: String,
    old_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    hash: String,
    parents: Vec<String>,
    author: String,
    email: String,
    time: i64,
    committer: String,
    committer_email: String,
    commit_time: i64,
    body: String,
    files: Vec<CommitFile>,
}

fn parse_name_status(out: &str) -> Vec<CommitFile> {
    let mut files = vec![];
    let mut it = out.split('\0').filter(|s| !s.is_empty());
    while let Some(st) = it.next() {
        let st = st.trim();
        if st.starts_with('R') || st.starts_with('C') {
            let old = it.next().unwrap_or_default().to_string();
            let new = it.next().unwrap_or_default().to_string();
            files.push(CommitFile {
                status: st[..1].into(),
                path: new,
                old_path: Some(old),
            });
        } else if let Some(path) = it.next() {
            files.push(CommitFile {
                status: st.chars().next().unwrap_or('M').to_string(),
                path: path.into(),
                old_path: None,
            });
        }
    }
    files
}

#[tauri::command]
pub async fn commit_details(repo: String, hash: String) -> Result<CommitDetails, String> {
    blocking(move || {
        let p = Path::new(&repo);
        let hash = safe(&hash)?;
        let out = git::run(
            p,
            &[
                "show",
                "-s",
                "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B",
                hash,
            ],
        )?;
        let f: Vec<&str> = out.splitn(9, '\0').collect();
        if f.len() < 9 {
            return Err("Could not read commit".into());
        }
        let parents: Vec<String> = f[1].split_whitespace().map(String::from).collect();
        let files_out = match parents.first() {
            Some(par) => git::run(p, &["diff", "-z", "-M", "--name-status", par, hash])?,
            None => git::run(
                p,
                &["diff-tree", "--root", "--no-commit-id", "-r", "-z", "-M", "--name-status", hash],
            )?,
        };
        Ok(CommitDetails {
            hash: f[0].into(),
            parents,
            author: f[2].into(),
            email: f[3].into(),
            time: f[4].parse().unwrap_or(0),
            committer: f[5].into(),
            committer_email: f[6].into(),
            commit_time: f[7].parse().unwrap_or(0),
            body: f[8].trim_end().into(),
            files: parse_name_status(&files_out),
        })
    })
    .await
}

#[tauri::command]
pub async fn commit_file_diff(
    repo: String,
    hash: String,
    parent: Option<String>,
    path: String,
    old_path: Option<String>,
) -> Result<String, String> {
    blocking(move || {
        let p = Path::new(&repo);
        let hash = safe(&hash)?.to_string();
        let mut args: Vec<String> = match parent {
            Some(par) => vec![
                "diff".into(),
                "--no-color".into(),
                "--no-ext-diff".into(),
                "-M".into(),
                safe(&par)?.into(),
                hash,
            ],
            None => vec![
                "diff-tree".into(),
                "-p".into(),
                "--root".into(),
                "--no-commit-id".into(),
                "-M".into(),
                "--no-color".into(),
                "--no-ext-diff".into(),
                hash,
            ],
        };
        args.push("--".into());
        if let Some(o) = old_path {
            args.push(o);
        }
        args.push(path);
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        git::run(p, &refs)
    })
    .await
}

// ---------------------------------------------------------------- staging + commit

#[tauri::command]
pub async fn stage(repo: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || {
        let p = Path::new(&repo);
        if paths.is_empty() {
            git::run(p, &["add", "-A"]).map(|_| ())
        } else {
            run_paths(p, &["add", "-A"], &paths)
        }
    })
    .await
}

#[tauri::command]
pub async fn unstage(repo: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || {
        let p = Path::new(&repo);
        let head = has_head(p);
        match (head, paths.is_empty()) {
            (true, true) => git::run(p, &["reset", "-q"]).map(|_| ()),
            (true, false) => run_paths(p, &["reset", "-q", "HEAD"], &paths),
            (false, true) => git::run(p, &["rm", "--cached", "-r", "-q", "."]).map(|_| ()),
            (false, false) => run_paths(p, &["rm", "--cached", "-r", "-q"], &paths),
        }
    })
    .await
}

/// Throw away unstaged changes. Tracked files go back to the index version;
/// untracked files are deleted.
#[tauri::command]
pub async fn discard(repo: String, paths: Vec<String>, untracked: Vec<String>) -> Result<(), String> {
    blocking(move || {
        let p = Path::new(&repo);
        if !paths.is_empty() {
            run_paths(p, &["restore"], &paths)?;
        }
        if !untracked.is_empty() {
            run_paths(p, &["clean", "-f", "-q"], &untracked)?;
        }
        Ok(())
    })
    .await
}

/// Apply a patch built by the UI (hunk or line staging).
#[tauri::command]
pub async fn apply_patch(
    repo: String,
    patch: String,
    reverse: bool,
    cached: bool,
) -> Result<(), String> {
    blocking(move || {
        let p = Path::new(&repo);
        let mut args = vec!["apply", "--recount", "--whitespace=nowarn"];
        if cached {
            args.push("--cached");
        }
        if reverse {
            args.push("-R");
        }
        args.push("-");
        git::run_input(p, &args, patch.as_bytes()).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn commit(repo: String, message: String, amend: bool) -> Result<String, String> {
    blocking(move || {
        if message.trim().is_empty() {
            return Err("Write a commit message first".into());
        }
        let p = Path::new(&repo);
        let mut args = vec!["commit", "-F", "-"];
        if amend {
            args.push("--amend");
        }
        git::run_input(p, &args, message.as_bytes()).map(|s| {
            s.lines().next().unwrap_or_default().to_string()
        })
    })
    .await
}

#[tauri::command]
pub async fn last_message(repo: String) -> Result<String, String> {
    blocking(move || git::run(Path::new(&repo), &["log", "-1", "--format=%B"])).await
}

// ---------------------------------------------------------------- operations

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Op {
    Checkout { name: String },
    CheckoutRemote { remote_branch: String, local: String },
    CheckoutDetached { hash: String },
    CreateBranch { name: String, start: Option<String>, checkout: bool },
    DeleteBranch { name: String, force: bool },
    RenameBranch { old: String, new: String },
    DeleteRemoteBranch { remote: String, name: String },
    CreateTag { name: String, target: String, message: Option<String> },
    DeleteTag { name: String },
    PushTag { remote: String, name: String },
    Fetch,
    Pull { mode: String },
    Push { force: bool },
    Merge { name: String },
    Rebase { onto: String },
    CherryPick { hash: String },
    Revert { hash: String },
    Reset { hash: String, mode: String },
    StashPush { message: Option<String>, include_untracked: bool },
    StashApply { index: String },
    StashPop { index: String },
    StashDrop { index: String },
    Abort,
    Continue,
}

fn is_merge(p: &Path, hash: &str) -> Result<bool, String> {
    let out = git::run(p, &["rev-list", "--parents", "-n1", hash])?;
    Ok(out.split_whitespace().count() > 2)
}

fn push(p: &Path, force: bool) -> Result<String, String> {
    let branch = git::run(p, &["symbolic-ref", "--short", "HEAD"])
        .map_err(|_| "You are not on a branch (detached HEAD).".to_string())?
        .trim()
        .to_string();
    let has_upstream =
        git::run(p, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).is_ok();
    let mut a: Vec<String> = vec!["push".into()];
    if force {
        a.push("--force-with-lease".into());
    }
    if !has_upstream {
        let remotes = git::run(p, &["remote"])?;
        let list: Vec<&str> = remotes.lines().filter(|l| !l.is_empty()).collect();
        let remote = if list.contains(&"origin") {
            "origin"
        } else {
            *list.first().ok_or("This repository has no remote to push to.")?
        };
        a.push("-u".into());
        a.push(remote.into());
        a.push(branch);
    }
    let refs: Vec<&str> = a.iter().map(|s| s.as_str()).collect();
    git::run_both(p, &refs)
}

fn exec(p: &Path, op: Op) -> Result<String, String> {
    let r = |args: &[&str]| git::run_both(p, args);
    match op {
        Op::Checkout { name } => r(&["switch", safe(&name)?]),
        Op::CheckoutRemote { remote_branch, local } => {
            r(&["switch", "-c", safe(&local)?, "--track", safe(&remote_branch)?])
        }
        Op::CheckoutDetached { hash } => r(&["switch", "--detach", safe(&hash)?]),
        Op::CreateBranch { name, start, checkout } => {
            let start = start.unwrap_or_else(|| "HEAD".into());
            if checkout {
                r(&["switch", "-c", safe(&name)?, safe(&start)?])
            } else {
                r(&["branch", safe(&name)?, safe(&start)?])
            }
        }
        Op::DeleteBranch { name, force } => {
            r(&["branch", if force { "-D" } else { "-d" }, safe(&name)?])
        }
        Op::RenameBranch { old, new } => r(&["branch", "-m", safe(&old)?, safe(&new)?]),
        Op::DeleteRemoteBranch { remote, name } => {
            r(&["push", safe(&remote)?, "--delete", safe(&name)?])
        }
        Op::CreateTag { name, target, message } => match message {
            Some(m) if !m.trim().is_empty() => {
                r(&["tag", "-a", safe(&name)?, "-m", &m, safe(&target)?])
            }
            _ => r(&["tag", safe(&name)?, safe(&target)?]),
        },
        Op::DeleteTag { name } => r(&["tag", "-d", safe(&name)?]),
        Op::PushTag { remote, name } => {
            let spec = format!("refs/tags/{}", safe(&name)?);
            r(&["push", safe(&remote)?, &spec])
        }
        Op::Fetch => r(&["fetch", "--all", "--prune"]),
        Op::Pull { mode } => {
            let m = match mode.as_str() {
                "rebase" => "--rebase",
                "merge" => "--no-rebase",
                _ => "--ff-only",
            };
            r(&["pull", "--no-edit", m])
        }
        Op::Push { force } => push(p, force),
        Op::Merge { name } => r(&["merge", "--no-edit", safe(&name)?]),
        Op::Rebase { onto } => r(&["rebase", safe(&onto)?]),
        Op::CherryPick { hash } => {
            let h = safe(&hash)?;
            if is_merge(p, h)? {
                r(&["cherry-pick", "-m", "1", h])
            } else {
                r(&["cherry-pick", h])
            }
        }
        Op::Revert { hash } => {
            let h = safe(&hash)?;
            if is_merge(p, h)? {
                r(&["revert", "--no-edit", "-m", "1", h])
            } else {
                r(&["revert", "--no-edit", h])
            }
        }
        Op::Reset { hash, mode } => {
            let m = match mode.as_str() {
                "soft" => "--soft",
                "hard" => "--hard",
                _ => "--mixed",
            };
            r(&["reset", "-q", m, safe(&hash)?])
        }
        Op::StashPush { message, include_untracked } => {
            let msg = message.unwrap_or_default();
            let mut a = vec!["stash", "push"];
            if include_untracked {
                a.push("--include-untracked");
            }
            if !msg.trim().is_empty() {
                a.push("-m");
                a.push(msg.trim());
            }
            r(&a)
        }
        Op::StashApply { index } => r(&["stash", "apply", safe(&index)?]),
        Op::StashPop { index } => r(&["stash", "pop", safe(&index)?]),
        Op::StashDrop { index } => r(&["stash", "drop", safe(&index)?]),
        Op::Abort => match repo_state(p).as_str() {
            "rebasing" => r(&["rebase", "--abort"]),
            "merging" => r(&["merge", "--abort"]),
            "cherry-picking" => r(&["cherry-pick", "--abort"]),
            "reverting" => r(&["revert", "--abort"]),
            _ => Err("Nothing to abort".into()),
        },
        Op::Continue => match repo_state(p).as_str() {
            "rebasing" => r(&["rebase", "--continue"]),
            "merging" => r(&["commit", "--no-edit"]),
            "cherry-picking" => r(&["cherry-pick", "--continue"]),
            "reverting" => r(&["revert", "--continue"]),
            _ => Err("Nothing to continue".into()),
        },
    }
}

#[tauri::command]
pub async fn git_op(repo: String, op: Op) -> Result<String, String> {
    blocking(move || exec(Path::new(&repo), op)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let out = "# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 h1 h2 src/a.ts\0\
2 R. N... 100644 100644 100644 h1 h2 R100 new name.ts\0old.ts\0\
u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.txt\0\
? new file.txt\0";
        let st = parse_status(out);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!((st.ahead, st.behind), (2, 1));
        assert_eq!(st.files.len(), 4);
        assert_eq!(st.files[0].path, "src/a.ts");
        assert_eq!(st.files[0].worktree, "M");
        assert_eq!(st.files[1].path, "new name.ts");
        assert_eq!(st.files[1].old_path.as_deref(), Some("old.ts"));
        assert!(st.files[2].conflicted);
        assert!(st.files[3].untracked);
        assert_eq!(st.files[3].path, "new file.txt");
    }

    #[test]
    fn parses_name_status() {
        let f = parse_name_status("M\0a.txt\0R087\0old.rs\0new.rs\0D\0gone.md\0");
        assert_eq!(f.len(), 3);
        assert_eq!(f[1].status, "R");
        assert_eq!(f[1].old_path.as_deref(), Some("old.rs"));
        assert_eq!(f[1].path, "new.rs");
    }

    #[test]
    fn rejects_option_like_names() {
        assert!(safe("--upload-pack=x").is_err());
        assert!(safe("").is_err());
        assert!(safe("feature/x").is_ok());
    }
}
