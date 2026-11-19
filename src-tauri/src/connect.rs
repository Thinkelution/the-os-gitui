//! One-click "Connect to Claude Code / Codex".
//!
//! Registers `<this app> mcp` as an MCP server named `osgitui` with the agent's
//! own CLI, and adds a `/gitui` command. Programs run with argument lists
//! (Rust escapes `.cmd` shims safely), never through a shell string.

use serde::Serialize;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const SERVER: &str = "osgitui";

const COMMAND_TEXT: &str = "---\ndescription: Open this repository in OS GitUI\n---\n\
Call the `open_in_gitui` tool from the `osgitui` MCP server with the current working directory as `path`. \
If the user asked a question about the repository, call `repo_overview` first and answer from it. $ARGUMENTS\n";

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

/// Where the `/gitui` command file goes for each agent.
fn command_file(agent: &str) -> Option<PathBuf> {
    let h = home()?;
    match agent {
        "claude" => Some(h.join(".claude").join("commands").join("gitui.md")),
        "codex" => Some(h.join(".codex").join("prompts").join("gitui.md")),
        _ => None,
    }
}

fn bin(agent: &str) -> Result<PathBuf, String> {
    let name = match agent {
        "claude" => "claude",
        "codex" => "codex",
        _ => return Err("Only Claude Code and Codex can be connected".into()),
    };
    which::which(name).map_err(|_| format!("{name} is not installed"))
}

fn run(prog: &PathBuf, args: &[&str]) -> Result<String, String> {
    let mut c = Command::new(prog);
    c.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let o = c.output().map_err(|e| e.to_string())?;
    let text = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
    if o.status.success() {
        Ok(text)
    } else {
        Err(text.trim().to_string())
    }
}

/// The arguments each CLI needs, given this app's path.
pub fn add_args(agent: &str, exe: &str) -> Vec<String> {
    let mut a: Vec<String> = match agent {
        "claude" => vec!["mcp", "add", "--scope", "user", SERVER, "--"],
        _ => vec!["mcp", "add", SERVER, "--"],
    }
    .into_iter()
    .map(String::from)
    .collect();
    a.push(exe.to_string());
    a.push("mcp".into());
    a
}

fn remove_args(agent: &str) -> Vec<&'static str> {
    match agent {
        "claude" => vec!["mcp", "remove", "--scope", "user", SERVER],
        _ => vec!["mcp", "remove", SERVER],
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectStatus {
    agent: String,
    installed: bool,
    connected: bool,
    command: bool,
}

fn status_of(agent: &str) -> ConnectStatus {
    let Ok(b) = bin(agent) else {
        return ConnectStatus { agent: agent.into(), installed: false, connected: false, command: false };
    };
    let connected = match agent {
        "claude" => run(&b, &["mcp", "get", SERVER]).is_ok(),
        _ => run(&b, &["mcp", "list"]).map(|o| o.lines().any(|l| l.split_whitespace().next() == Some(SERVER))).unwrap_or(false),
    };
    let command = command_file(agent).map(|f| f.exists()).unwrap_or(false);
    ConnectStatus { agent: agent.into(), installed: true, connected, command }
}

fn connect(agent: &str) -> Result<String, String> {
    let b = bin(agent)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_string_lossy().into_owned();
    // Replace an older registration (for example from a previous install path).
    let _ = run(&b, &remove_args(agent));
    let args = add_args(agent, &exe);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run(&b, &refs)?;
    if let Some(f) = command_file(agent) {
        if let Some(dir) = f.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&f, COMMAND_TEXT).map_err(|e| e.to_string())?;
    }
    let how = if agent == "claude" { "/gitui" } else { "/prompts:gitui" };
    Ok(format!("Connected. Restart the agent, then type {how} or ask it to open the repo in OS GitUI."))
}

fn disconnect(agent: &str) -> Result<String, String> {
    let b = bin(agent)?;
    run(&b, &remove_args(agent))?;
    if let Some(f) = command_file(agent) {
        if std::fs::read_to_string(&f).map(|t| t == COMMAND_TEXT).unwrap_or(false) {
            let _ = std::fs::remove_file(f);
        }
    }
    Ok("Disconnected.".into())
}

#[tauri::command]
pub async fn agent_connection(agent: String, action: String) -> Result<ConnectStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        match action.as_str() {
            "connect" => {
                connect(&agent)?;
            }
            "disconnect" => {
                disconnect(&agent)?;
            }
            _ => {}
        }
        Ok(status_of(&agent))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_add_args() {
        let exe = r"C:\Program Files\OS GitUI\the-os-gitui.exe";
        assert_eq!(add_args("claude", exe), vec!["mcp", "add", "--scope", "user", "osgitui", "--", exe, "mcp"]);
        assert_eq!(add_args("codex", exe), vec!["mcp", "add", "osgitui", "--", exe, "mcp"]);
        assert!(bin("other").is_err());
    }
}
