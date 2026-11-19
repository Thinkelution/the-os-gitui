mod accounts;
mod commands;
mod extra;
mod git;
mod graph;
mod pty;

pub fn run() {
    tauri::Builder::default()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running OS GitUI");
}
