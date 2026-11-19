//! Built-in terminals (PTY) for shells and AI coding agents.
//!
//! Programs are started with an argument list, never through a shell string,
//! so nothing the user types (like an agent prompt) is ever parsed by a shell.
//! A prompt is "pasted" into the agent once its screen has settled.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

fn sessions() -> &'static Mutex<HashMap<u32, Session>> {
    static S: OnceLock<Mutex<HashMap<u32, Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

static NEXT: AtomicU32 = AtomicU32::new(1);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Decode a chunk as UTF-8, keeping an incomplete trailing character for later.
pub fn decode(carry: &mut Vec<u8>, chunk: &[u8]) -> String {
    carry.extend_from_slice(chunk);
    let mut out = String::new();
    loop {
        match std::str::from_utf8(carry) {
            Ok(s) => {
                out.push_str(s);
                carry.clear();
                return out;
            }
            Err(e) => {
                let good = e.valid_up_to();
                out.push_str(std::str::from_utf8(&carry[..good]).unwrap_or_default());
                match e.error_len() {
                    None => {
                        carry.drain(..good);
                        return out;
                    }
                    Some(n) => {
                        out.push('\u{FFFD}');
                        carry.drain(..good + n);
                    }
                }
            }
        }
    }
}

/// A program and its arguments, ready to start.
#[derive(Debug, Clone, PartialEq)]
pub struct Spec {
    pub program: String,
    pub args: Vec<String>,
}

/// Find a program on PATH. On Windows, npm installs `.cmd` shims, which must
/// run through cmd.exe; our own fixed arguments are the only ones passed.
pub fn resolve(bin: &str, args: &[&str]) -> Option<Spec> {
    let path: PathBuf = which::which(bin).ok()?;
    let p = path.to_string_lossy().into_owned();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mut a: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    if cfg!(windows) && (ext == "cmd" || ext == "bat") {
        let mut v = vec!["/d".to_string(), "/c".to_string(), p];
        v.append(&mut a);
        return Some(Spec { program: "cmd.exe".into(), args: v });
    }
    Some(Spec { program: p, args: a })
}

/// The user's normal interactive shell.
pub fn shell() -> Spec {
    if cfg!(windows) {
        for s in ["pwsh", "powershell"] {
            if let Some(mut sp) = resolve(s, &[]) {
                sp.args.push("-NoLogo".into());
                return sp;
            }
        }
        return Spec { program: "cmd.exe".into(), args: vec![] };
    }
    let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    Spec { program: sh, args: vec!["-l".into()] }
}

/// Run a command line through the shell (install commands, custom agents).
pub fn shell_command(line: &str) -> Spec {
    let mut s = shell();
    if cfg!(windows) {
        if s.program == "cmd.exe" {
            s.args = vec!["/d".into(), "/k".into(), line.into()];
        } else {
            s.args = vec!["-NoLogo".into(), "-NoExit".into(), "-Command".into(), line.into()];
        }
    } else {
        s.args = vec!["-lc".into(), format!("{line}; exec \"$SHELL\" -l")];
    }
    s
}

pub struct Callbacks {
    pub on_data: Box<dyn Fn(u32, String) + Send + Sync>,
    pub on_exit: Box<dyn Fn(u32, Option<u32>) + Send + Sync>,
}

pub fn spawn(spec: &Spec, cwd: &Path, cols: u16, rows: u16, paste: Option<String>, cb: Callbacks) -> Result<u32, String> {
    if !cwd.is_dir() {
        return Err(format!("Folder not found: {}", cwd.display()));
    }
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(5), cols: cols.max(20), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(&spec.program);
    cmd.args(&spec.args);
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Could not start {}: {e}", spec.program))?;
    drop(pair.slave);

    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    sessions().lock().unwrap().insert(id, Session { writer, master: pair.master, killer });

    let cb = Arc::new(cb);
    let last_out = Arc::new(AtomicU64::new(0));

    {
        let cb = cb.clone();
        let last_out = last_out.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut carry = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        last_out.store(now_ms(), Ordering::Relaxed);
                        let s = decode(&mut carry, &buf[..n]);
                        if !s.is_empty() {
                            (cb.on_data)(id, s);
                        }
                    }
                }
            }
        });
    }
    {
        let cb = cb.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            // Dropping the session closes the PTY, which ends the reader.
            sessions().lock().unwrap().remove(&id);
            (cb.on_exit)(id, code);
        });
    }
    if let Some(text) = paste.filter(|t| !t.trim().is_empty()) {
        std::thread::spawn(move || {
            // Wait for the agent to draw its screen, then for 1.2 s of quiet.
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(25) {
                std::thread::sleep(Duration::from_millis(200));
                let last = last_out.load(Ordering::Relaxed);
                if last > 0 && now_ms().saturating_sub(last) > 1200 {
                    break;
                }
            }
            let clean: String = text.chars().filter(|c| *c != '\x1b').collect();
            let _ = write(id, &format!("\x1b[200~{clean}\x1b[201~"));
            std::thread::sleep(Duration::from_millis(400));
            let _ = write(id, "\r");
        });
    }
    Ok(id)
}

pub fn write(id: u32, data: &str) -> Result<(), String> {
    let mut map = sessions().lock().unwrap();
    let s = map.get_mut(&id).ok_or("Terminal has ended")?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())
}

pub fn resize(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let map = sessions().lock().unwrap();
    let s = map.get(&id).ok_or("Terminal has ended")?;
    s.master
        .resize(PtySize { rows: rows.max(5), cols: cols.max(20), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

pub fn kill(id: u32) -> Result<(), String> {
    let mut map = sessions().lock().unwrap();
    if let Some(s) = map.get_mut(&id) {
        s.killer.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------- agents

pub struct AgentDef {
    pub id: &'static str,
    pub name: &'static str,
    pub bin: &'static str,
    pub install: Option<&'static str>,
    pub site: &'static str,
}

pub const AGENTS: &[AgentDef] = &[
    AgentDef { id: "claude", name: "Claude Code", bin: "claude", install: Some("npm install -g @anthropic-ai/claude-code"), site: "https://docs.anthropic.com/en/docs/claude-code" },
    AgentDef { id: "codex", name: "Codex CLI", bin: "codex", install: Some("npm install -g @openai/codex"), site: "https://github.com/openai/codex" },
    AgentDef { id: "gemini", name: "Gemini CLI", bin: "gemini", install: Some("npm install -g @google/gemini-cli"), site: "https://github.com/google-gemini/gemini-cli" },
    AgentDef { id: "copilot", name: "GitHub Copilot CLI", bin: "copilot", install: Some("npm install -g @github/copilot"), site: "https://github.com/github/copilot-cli" },
    AgentDef { id: "opencode", name: "OpenCode", bin: "opencode", install: Some("npm install -g opencode-ai"), site: "https://opencode.ai" },
    AgentDef { id: "aider", name: "Aider", bin: "aider", install: Some("python -m pip install aider-install && aider-install"), site: "https://aider.chat" },
    AgentDef { id: "cursor", name: "Cursor Agent", bin: "cursor-agent", install: None, site: "https://cursor.com/cli" },
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    id: String,
    name: String,
    installed: bool,
    path: Option<String>,
    install: Option<String>,
    site: String,
}

// ---------------------------------------------------------------- tauri commands

#[derive(Serialize, Clone)]
struct DataEvent {
    id: u32,
    data: String,
}

#[derive(Serialize, Clone)]
struct ExitEvent {
    id: u32,
    code: Option<u32>,
}

fn callbacks(app: AppHandle) -> Callbacks {
    let a2 = app.clone();
    Callbacks {
        on_data: Box::new(move |id, data| {
            let _ = app.emit("pty-data", DataEvent { id, data });
        }),
        on_exit: Box::new(move |id, code| {
            let _ = a2.emit("pty-exit", ExitEvent { id, code });
        }),
    }
}

#[tauri::command]
pub fn agents_detect() -> Vec<AgentInfo> {
    AGENTS
        .iter()
        .map(|a| {
            let path = which::which(a.bin).ok().map(|p| p.to_string_lossy().into_owned());
            AgentInfo {
                id: a.id.into(),
                name: a.name.into(),
                installed: path.is_some(),
                path,
                install: a.install.map(String::from),
                site: a.site.into(),
            }
        })
        .collect()
}

/// What to start in a terminal: a shell, a known agent, its installer,
/// or a custom command line the user set up.
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Launch {
    Shell,
    Agent { id: String, prompt: Option<String> },
    Install { id: String },
    Custom { command: String, prompt: Option<String> },
}

pub fn plan(l: &Launch) -> Result<(Spec, Option<String>), String> {
    Ok(match l {
        Launch::Shell => (shell(), None),
        Launch::Agent { id, prompt } => {
            let a = AGENTS.iter().find(|a| a.id == id).ok_or("Unknown agent")?;
            let spec = resolve(a.bin, &[]).ok_or_else(|| format!("{} is not installed.", a.name))?;
            (spec, prompt.clone())
        }
        Launch::Install { id } => {
            let a = AGENTS.iter().find(|a| a.id == id).ok_or("Unknown agent")?;
            (shell_command(a.install.ok_or("No installer known for this agent")?), None)
        }
        Launch::Custom { command, prompt } => {
            if command.trim().is_empty() {
                return Err("Empty command".into());
            }
            (shell_command(command.trim()), prompt.clone())
        }
    })
}

#[tauri::command]
pub fn pty_launch(app: AppHandle, cwd: String, launch: Launch, cols: u16, rows: u16) -> Result<u32, String> {
    let (spec, paste) = plan(&launch)?;
    spawn(&spec, Path::new(&cwd), cols, rows, paste, callbacks(app))
}

#[tauri::command]
pub fn pty_write(id: u32, data: String) -> Result<(), String> {
    write(id, &data)
}

#[tauri::command]
pub fn pty_resize(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    resize(id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(id: u32) -> Result<(), String> {
    kill(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn decode_keeps_split_characters() {
        let mut carry = Vec::new();
        let bytes = "héllo ✓".as_bytes();
        let cut = bytes.len() - 1;
        let a = decode(&mut carry, &bytes[..cut]);
        let b = decode(&mut carry, &bytes[cut..]);
        assert_eq!(format!("{a}{b}"), "héllo ✓");
        assert!(carry.is_empty());
        assert_eq!(decode(&mut carry, &[b'a', 0xFF, b'b']), "a\u{FFFD}b");
    }

    #[test]
    fn plans_agents_and_installers() {
        assert!(plan(&Launch::Agent { id: "nope".into(), prompt: None }).is_err());
        let (s, p) = plan(&Launch::Install { id: "codex".into() }).unwrap();
        assert!(s.args.iter().any(|a| a.contains("@openai/codex")));
        assert!(p.is_none());
        assert!(plan(&Launch::Custom { command: "  ".into(), prompt: None }).is_err());
    }

    /// Start a real program in a PTY and read its output back.
    #[test]
    fn runs_a_program_in_a_pty() {
        let spec = if cfg!(windows) {
            Spec { program: "cmd.exe".into(), args: vec!["/d".into(), "/c".into(), "echo osgitui-pty-ok".into()] }
        } else {
            Spec { program: "/bin/sh".into(), args: vec!["-c".into(), "echo osgitui-pty-ok".into()] }
        };
        let (tx, rx) = mpsc::channel::<String>();
        let (etx, erx) = mpsc::channel::<Option<u32>>();
        let tx = Mutex::new(tx);
        let etx = Mutex::new(etx);
        spawn(
            &spec,
            &std::env::temp_dir(),
            80,
            24,
            None,
            Callbacks {
                on_data: Box::new(move |id, d| {
                    // Windows ConPTY waits for a cursor-position reply, as a real
                    // terminal (xterm.js in the app) sends.
                    if d.contains("\x1b[6n") {
                        let _ = write(id, "\x1b[1;1R");
                    }
                    let _ = tx.lock().unwrap().send(d);
                }),
                on_exit: Box::new(move |_, c| {
                    let _ = etx.lock().unwrap().send(c);
                }),
            },
        )
        .unwrap();
        let code = erx.recv_timeout(Duration::from_secs(20)).expect("program did not exit");
        assert_eq!(code, Some(0));
        let mut out = String::new();
        while let Ok(s) = rx.recv_timeout(Duration::from_millis(500)) {
            out.push_str(&s);
        }
        assert!(out.contains("osgitui-pty-ok"), "output was {out:?}");
    }
}
