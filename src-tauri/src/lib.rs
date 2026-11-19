mod accounts;
mod commands;
mod connect;
mod extra;
mod git;
mod graph;
mod mcp;
mod pty;

use tauri::{Emitter, Manager};

pub fn serve_mcp() {
    mcp::serve();
}

pub fn run() {
    tauri::Builder::default()
        // A second launch (`the-os-gitui <folder>`, or an agent's open_in_gitui)
        // hands its folder to the running window instead of opening another.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(arg) = argv.get(1).filter(|a| !a.starts_with('-')) {
                let p = std::path::Path::new(&cwd).join(arg);
                let _ = app.emit("open-path", p.to_string_lossy().into_owned());
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::startup_path,
            commands::repo_open,
            commands::repo_init,
            commands::repo_clone,
            commands::get_log,
            commands::get_status,
            commands::get_refs,
            commands::file_diff,
            commands::commit_details,
            commands::commit_file_diff,
            commands::stage,
            commands::unstage,
            commands::discard,
            commands::apply_patch,
            commands::commit,
            commands::last_message,
            commands::git_op,
            extra::file_history,
            extra::blame,
            extra::resolve_conflict,
            extra::rebase_list,
            extra::rebase_interactive,
            extra::reveal,
            extra::open_terminal,
            accounts::get_identity,
            accounts::apply_profile,
            accounts::worktree_list,
            accounts::worktree_add,
            accounts::worktree_remove,
            pty::agents_detect,
            pty::pty_launch,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            connect::agent_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OS GitUI");
}
