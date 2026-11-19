// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `the-os-gitui mcp` runs the MCP server for coding agents, with no window.
    if std::env::args().nth(1).as_deref() == Some("mcp") {
        osgitui_lib::serve_mcp();
        return;
    }
    osgitui_lib::run()
}
