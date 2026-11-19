//! Thin wrapper around the `git` command line.
//!
//! Using the real git binary keeps hooks, credential helpers, SSH keys,
//! commit signing and every config option working exactly as in a terminal.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

pub struct Output {
    pub stdout: String,
    pub stderr: String,
    pub ok: bool,
}

/// A `git` command that runs in `dir`, never prompts on a terminal and
/// never opens a pager or an editor.
pub fn command(dir: &Path) -> Command {
    let mut c = Command::new("git");
    c.current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_PAGER", "cat")
        .args([
            "-c",
            "core.quotepath=false",
            "-c",
            "color.ui=false",
            "-c",
            "core.pager=cat",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

pub fn run_raw(dir: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Output, String> {
    let mut c = command(dir);
    c.args(args);
    if input.is_some() {
        c.stdin(Stdio::piped());
    }
    let mut child = c
        .spawn()
        .map_err(|e| format!("Could not start git ({e}). Is Git installed and on PATH?"))?;
    if let Some(data) = input {
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(data).map_err(|e| e.to_string())?;
        }
    }
    let o = child.wait_with_output().map_err(|e| e.to_string())?;
    Ok(Output {
        stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
        ok: o.status.success(),
    })
}

fn error_text(o: &Output) -> String {
    let e = o.stderr.trim();
    if e.is_empty() {
        o.stdout.trim().to_string()
    } else {
        e.to_string()
    }
}

/// Run git and return stdout, or stderr as the error.
pub fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    let o = run_raw(dir, args, None)?;
    if o.ok {
        Ok(o.stdout)
    } else {
        Err(error_text(&o))
    }
}

/// Run git with data on stdin.
pub fn run_input(dir: &Path, args: &[&str], input: &[u8]) -> Result<String, String> {
    let o = run_raw(dir, args, Some(input))?;
    if o.ok {
        Ok(o.stdout)
    } else {
        Err(error_text(&o))
    }
}

/// Run git and return stdout + stderr (push, pull etc. report on stderr).
pub fn run_both(dir: &Path, args: &[&str]) -> Result<String, String> {
    let o = run_raw(dir, args, None)?;
    if o.ok {
        Ok(format!("{}\n{}", o.stdout.trim(), o.stderr.trim()).trim().to_string())
    } else {
        Err(error_text(&o))
    }
}
