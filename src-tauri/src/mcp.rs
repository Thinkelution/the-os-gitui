//! `the-os-gitui mcp`: a small MCP server (stdio, JSON lines) so coding agents
//! like Claude Code and Codex can open the GUI and read a repo overview.
//! It runs without a window and exits when the agent closes stdin.

use crate::git;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::Path;

const NAME: &str = "osgitui";

fn tools() -> Value {
    json!([
        {
            "name": "open_in_gitui",
            "description": "Open a git repository or worktree in the OS GitUI desktop app so the user can see the commit graph and review changes. Use it after making commits, or when the user asks to see or review changes.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Folder inside the repository. Use the current working directory." } },
                "required": ["path"]
            }
        },
        {
            "name": "repo_overview",
            "description": "Short overview of a git repository: current branch, ahead/behind, changed files, worktrees and a text commit graph of recent history.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Folder inside the repository." } },
                "required": ["path"]
            }
        }
    ])
}

fn arg_path(args: &Value) -> Result<String, String> {
    let p = args.get("path").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if p.is_empty() {
        return Err("path is required".into());
    }
    if !Path::new(&p).is_dir() {
        return Err(format!("Folder not found: {p}"));
    }
    Ok(p)
}

fn top_level(p: &str) -> Result<String, String> {
    git::run(Path::new(p), &["rev-parse", "--show-toplevel"])
        .map(|s| s.trim().to_string())
        .map_err(|_| format!("Not a git repository: {p}"))
}

fn open_in_gitui(args: &Value) -> Result<String, String> {
    let top = top_level(&arg_path(args)?)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut c = std::process::Command::new(exe);
    c.arg(&top)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    // A running window takes the path (single instance); otherwise a new one opens.
    c.spawn().map_err(|e| format!("Could not start OS GitUI: {e}"))?;
    Ok(format!("Opened {top} in OS GitUI."))
}

fn repo_overview(args: &Value) -> Result<String, String> {
    let top = top_level(&arg_path(args)?)?;
    let p = Path::new(&top);
    let head = git::run(p, &["status", "-sb", "--untracked-files=normal"]).unwrap_or_default();
    let mut lines = head.lines();
    let branch = lines.next().unwrap_or("").trim_start_matches("## ").to_string();
    let files: Vec<&str> = lines.collect();
    let shown: Vec<&str> = files.iter().take(40).copied().collect();
    let trees = git::run(p, &["worktree", "list"]).unwrap_or_default();
    let graph = git::run(p, &["log", "--graph", "--oneline", "--decorate", "--all", "-n", "25"]).unwrap_or_default();
    let mut out = format!("Repository: {top}\nBranch: {branch}\n\nChanged files ({}):\n", files.len());
    if shown.is_empty() {
        out.push_str("  (clean)\n");
    }
    for f in &shown {
        out.push_str(&format!("  {f}\n"));
    }
    if files.len() > shown.len() {
        out.push_str(&format!("  … and {} more\n", files.len() - shown.len()));
    }
    out.push_str(&format!("\nWorktrees:\n{}\nRecent history:\n{}", trees.trim_end(), graph.trim_end()));
    Ok(out)
}

/// Handle one JSON-RPC message. Returns the response, or None for notifications.
pub fn handle(msg: &Value) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => json!({
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": NAME, "version": env!("CARGO_PKG_VERSION") }
        }),
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            let r = match name {
                "open_in_gitui" => open_in_gitui(&args),
                "repo_overview" => repo_overview(&args),
                _ => Err(format!("Unknown tool: {name}")),
            };
            match r {
                Ok(t) => json!({ "content": [{ "type": "text", "text": t }] }),
                Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
            }
        }
        _ => {
            return Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("Method not found: {method}") } }))
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

pub fn serve() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => handle(&msg),
            Err(e) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": e.to_string() } })),
        };
        if let Some(r) = reply {
            if writeln!(out, "{r}").and_then(|_| out.flush()).is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speaks_mcp() {
        let init = handle(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}})).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert!(handle(&json!({"jsonrpc":"2.0","method":"notifications/initialized"})).is_none());
        let list = handle(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"})).unwrap();
        assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 2);
        let bad = handle(&json!({"jsonrpc":"2.0","id":3,"method":"nope"})).unwrap();
        assert_eq!(bad["error"]["code"], -32601);
    }

    #[test]
    fn overview_of_this_repo() {
        let here = env!("CARGO_MANIFEST_DIR");
        let r = handle(&json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"repo_overview","arguments":{"path":here}}})).unwrap();
        let text = r["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("Recent history:"), "{text}");
        let miss = handle(&json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"repo_overview","arguments":{"path":"/no/such/dir"}}})).unwrap();
        assert_eq!(miss["result"]["isError"], true);
    }
}
