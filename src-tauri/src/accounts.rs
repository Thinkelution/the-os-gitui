//! Git profiles (several accounts on one computer) and worktrees.
//!
//! A profile is applied to ONE repository through its local `.git/config`:
//! author name and email, the SSH key to push with, and the HTTPS user name
//! the credential manager should pick. Global git config is never changed,
//! and no password or token is ever stored by this app.

use crate::git;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

fn clean(s: &str, what: &str) -> Result<String, String> {
    let s = s.trim();
    if s.chars().any(|c| c.is_control()) {
        return Err(format!("{what} has invalid characters"));
    }
    Ok(s.to_string())
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub user_name: String,
    pub email: String,
    pub ssh_key: Option<String>,
    pub host: Option<String>,
    pub host_user: Option<String>,
}

/// `core.sshCommand` that forces one key. Git runs it through sh, so the
/// path is single-quoted and uses forward slashes on every OS.
pub fn ssh_command(key: &str) -> Result<String, String> {
    let mut k = clean(key, "SSH key path")?;
    if k.is_empty() {
        return Err("SSH key path is empty".into());
    }
    // `~` is not expanded inside single quotes, so expand it here.
    if let Some(rest) = k.strip_prefix("~/").or_else(|| k.strip_prefix("~\\")) {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            k = format!("{}/{}", home.to_string_lossy(), rest);
        }
    }
    let k = k.replace('\\', "/").replace('\'', "'\\''");
    Ok(format!("ssh -i '{k}' -o IdentitiesOnly=yes"))
}

fn host_of(p: &Profile) -> Result<String, String> {
    let h = clean(p.host.as_deref().unwrap_or("github.com"), "Host")?;
    if h.is_empty() || h.contains('/') || h.contains(' ') {
        return Err("Host must look like github.com".into());
    }
    Ok(h)
}

fn set(p: &Path, key: &str, val: &str) -> Result<(), String> {
    git::run(p, &["config", "--local", key, val]).map(|_| ())
}

fn unset(p: &Path, key: &str) {
    let _ = git::run(p, &["config", "--local", "--unset-all", key]);
}

pub fn apply(p: &Path, prof: &Profile) -> Result<(), String> {
    let name = clean(&prof.user_name, "Name")?;
    let email = clean(&prof.email, "Email")?;
    if name.is_empty() || !email.contains('@') {
        return Err("A profile needs a name and an email.".into());
    }
    set(p, "user.name", &name)?;
    set(p, "user.email", &email)?;
    match prof.ssh_key.as_deref().filter(|k| !k.trim().is_empty()) {
        Some(k) => set(p, "core.sshCommand", &ssh_command(k)?)?,
        None => unset(p, "core.sshCommand"),
    }
    let cred = format!("credential.https://{}.username", host_of(prof)?);
    match prof.host_user.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        Some(u) => set(p, &cred, &clean(u, "User name")?)?,
        None => unset(p, &cred),
    }
    Ok(())
}

/// Extra `-c` options so a clone already uses the profile's account.
pub fn clone_args(prof: &Profile) -> Result<Vec<String>, String> {
    let mut a = vec![];
    if let Some(k) = prof.ssh_key.as_deref().filter(|k| !k.trim().is_empty()) {
        a.push("-c".into());
        a.push(format!("core.sshCommand={}", ssh_command(k)?));
    }
    if let Some(u) = prof.host_user.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        a.push("-c".into());
        a.push(format!("credential.https://{}.username={}", host_of(prof)?, clean(u, "User name")?));
    }
    Ok(a)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    name: String,
    email: String,
    /// true when name/email come from this repo, not the global config.
    local: bool,
    ssh_command: Option<String>,
    remotes: Vec<String>,
}

fn get(p: &Path, args: &[&str]) -> Option<String> {
    git::run(p, args).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn identity_of(p: &Path) -> Identity {
    let mut remotes: Vec<String> = git::run(p, &["remote", "-v"])
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.split_whitespace().nth(1).map(String::from))
        .collect();
    remotes.dedup();
    Identity {
        name: get(p, &["config", "--get", "user.name"]).unwrap_or_default(),
        email: get(p, &["config", "--get", "user.email"]).unwrap_or_default(),
        local: get(p, &["config", "--local", "--get", "user.email"]).is_some(),
        ssh_command: get(p, &["config", "--local", "--get", "core.sshCommand"]),
        remotes,
    }
}

#[tauri::command]
pub async fn get_identity(repo: String) -> Result<Identity, String> {
    blocking(move || Ok(identity_of(Path::new(&repo)))).await
}

#[tauri::command]
pub async fn apply_profile(repo: String, profile: Profile) -> Result<(), String> {
    blocking(move || apply(Path::new(&repo), &profile)).await
}

// ---------------------------------------------------------------- worktrees

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    path: String,
    head: String,
    branch: Option<String>,
    main: bool,
    locked: bool,
    prunable: bool,
}

pub fn parse_worktrees(out: &str) -> Vec<Worktree> {
    let mut list: Vec<Worktree> = vec![];
    for block in out.split("\n\n") {
        let mut w = Worktree { path: String::new(), head: String::new(), branch: None, main: list.is_empty(), locked: false, prunable: false };
        for l in block.lines() {
            if let Some(v) = l.strip_prefix("worktree ") {
                w.path = v.to_string();
            } else if let Some(v) = l.strip_prefix("HEAD ") {
                w.head = v.to_string();
            } else if let Some(v) = l.strip_prefix("branch ") {
                w.branch = Some(v.trim_start_matches("refs/heads/").to_string());
            } else if l.starts_with("locked") {
                w.locked = true;
            } else if l.starts_with("prunable") {
                w.prunable = true;
            }
        }
        if !w.path.is_empty() {
            list.push(w);
        }
    }
    list
}

#[tauri::command]
pub async fn worktree_list(repo: String) -> Result<Vec<Worktree>, String> {
    blocking(move || Ok(parse_worktrees(&git::run(Path::new(&repo), &["worktree", "list", "--porcelain"])?))).await
}

/// Folder name for a branch: `feature/login` -> `feature-login`.
pub fn slug(branch: &str) -> String {
    let s: String = branch
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '-' })
        .collect();
    s.trim_matches(|c| c == '-' || c == '.').to_string()
}

/// Worktrees live next to the repo: `<parent>/<repo>-worktrees/<branch>`.
pub fn add(repo: &Path, branch: &str, base: Option<&str>) -> Result<String, String> {
    let branch = clean(branch, "Branch")?;
    if branch.is_empty() || branch.starts_with('-') {
        return Err("Enter a branch name".into());
    }
    let top = PathBuf::from(git::run(repo, &["rev-parse", "--show-toplevel"])?.trim());
    git::run(repo, &["check-ref-format", "--branch", &branch]).map_err(|_| format!("\"{branch}\" is not a valid branch name"))?;
    let name = top.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "repo".into());
    let dir = top.parent().unwrap_or(&top).join(format!("{name}-worktrees")).join(slug(&branch));
    if dir.exists() {
        return Err(format!("Folder already exists: {}", dir.display()));
    }
    let d = dir.to_string_lossy().into_owned();
    let exists = git::run(repo, &["rev-parse", "-q", "--verify", &format!("refs/heads/{branch}")]).is_ok();
    if exists {
        git::run(repo, &["worktree", "add", &d, &branch])?;
    } else {
        let base = base.map(str::trim).filter(|b| !b.is_empty()).unwrap_or("HEAD");
        if base.starts_with('-') {
            return Err("Invalid base".into());
        }
        git::run(repo, &["worktree", "add", "-b", &branch, &d, base])?;
    }
    Ok(d)
}

#[tauri::command]
pub async fn worktree_add(repo: String, branch: String, base: Option<String>) -> Result<String, String> {
    blocking(move || add(Path::new(&repo), &branch, base.as_deref())).await
}

#[tauri::command]
pub async fn worktree_remove(repo: String, path: String, force: bool) -> Result<(), String> {
    blocking(move || {
        let mut a = vec!["worktree", "remove"];
        if force {
            a.push("--force");
        }
        a.push(&path);
        git::run(Path::new(&repo), &a)?;
        let _ = git::run(Path::new(&repo), &["worktree", "prune"]);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_repo(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("osgitui-{tag}-{}", std::process::id())).join("proj");
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
        std::fs::create_dir_all(&dir).unwrap();
        let g = |a: &[&str]| git::run(&dir, a).unwrap();
        g(&["init", "-q", "-b", "main"]);
        g(&["config", "user.name", "Seed"]);
        g(&["config", "user.email", "seed@x"]);
        std::fs::write(dir.join("f"), "1").unwrap();
        g(&["add", "-A"]);
        g(&["commit", "-qm", "one"]);
        g(&["remote", "add", "origin", "git@github.com:Acme/proj.git"]);
        dir
    }

    #[test]
    fn ssh_command_is_quoted() {
        assert_eq!(ssh_command(r"C:\Users\me\.ssh\id_work").unwrap(), "ssh -i 'C:/Users/me/.ssh/id_work' -o IdentitiesOnly=yes");
        assert_eq!(ssh_command("/k/it's").unwrap(), "ssh -i '/k/it'\\''s' -o IdentitiesOnly=yes");
        assert!(ssh_command("a\nb").is_err());
    }

    #[test]
    fn applies_and_switches_profiles() {
        let dir = temp_repo("prof");
        let work = Profile { user_name: "Ada Work".into(), email: "ada@work.com".into(), ssh_key: Some("/keys/work".into()), host: None, host_user: Some("ada-work".into()) };
        apply(&dir, &work).unwrap();
        let id = identity_of(&dir);
        assert_eq!((id.name.as_str(), id.email.as_str(), id.local), ("Ada Work", "ada@work.com", true));
        assert_eq!(id.ssh_command.as_deref(), Some("ssh -i '/keys/work' -o IdentitiesOnly=yes"));
        assert_eq!(id.remotes, vec!["git@github.com:Acme/proj.git"]);
        assert_eq!(git::run(&dir, &["config", "--get", "credential.https://github.com.username"]).unwrap().trim(), "ada-work");

        let home = Profile { user_name: "Ada".into(), email: "ada@home.dev".into(), ssh_key: None, host: None, host_user: None };
        apply(&dir, &home).unwrap();
        let id = identity_of(&dir);
        assert_eq!(id.email, "ada@home.dev");
        assert!(id.ssh_command.is_none());
        assert!(git::run(&dir, &["config", "--local", "--get", "credential.https://github.com.username"]).is_err());
        assert!(apply(&dir, &Profile { email: "nope".into(), ..home }).is_err());
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn adds_lists_and_removes_worktrees() {
        let dir = temp_repo("wt");
        let path = add(&dir, "agent/fix-login", None).unwrap();
        assert!(path.replace('\\', "/").ends_with("proj-worktrees/agent-fix-login"));
        assert!(Path::new(&path).join("f").exists());
        let list = parse_worktrees(&git::run(&dir, &["worktree", "list", "--porcelain"]).unwrap());
        assert_eq!(list.len(), 2);
        assert!(list[0].main);
        assert_eq!(list[1].branch.as_deref(), Some("agent/fix-login"));
        assert!(add(&dir, "bad name", None).is_err());
        git::run(&dir, &["worktree", "remove", &path]).unwrap();
        assert_eq!(parse_worktrees(&git::run(&dir, &["worktree", "list", "--porcelain"]).unwrap()).len(), 1);
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn makes_folder_slugs() {
        assert_eq!(slug("feature/login"), "feature-login");
        assert_eq!(slug("../x"), "x");
    }
}
