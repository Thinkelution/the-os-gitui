import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";
import { api } from "../lib/git";

export function Welcome() {
  const recent = useStore((s) => s.recent);
  const openPath = useStore((s) => s.openPath);
  const setDialog = useStore((s) => s.setDialog);
  const toast = useStore((s) => s.toast);

  const openRepo = async () => {
    const r = await open({ directory: true, title: "Open a Git repository" });
    if (typeof r === "string") await openPath(r);
  };

  const initRepo = async () => {
    const r = await open({ directory: true, title: "Choose a folder for the new repository" });
    if (typeof r !== "string") return;
    try {
      const info = await api.init(r);
      await openPath(info.path);
    } catch (e) {
      toast("error", String(e));
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>
          <span className="brand-dot big" /> OS GitUI
        </h1>
        <p className="dim">A free, open-source Git client.</p>
        <div className="welcome-actions">
          <button className="action" onClick={openRepo}>
            <span className="ico">📂</span>
            <b>Open</b>
            <span className="dim">a repository on this computer</span>
          </button>
          <button className="action" onClick={() => setDialog({ kind: "clone" })}>
            <span className="ico">⇩</span>
            <b>Clone</b>
            <span className="dim">from GitHub, GitLab or any URL</span>
          </button>
          <button className="action" onClick={initRepo}>
            <span className="ico">✚</span>
            <b>Start</b>
            <span className="dim">a new repository</span>
          </button>
        </div>
        {recent.length > 0 && (
          <>
            <h3>Recent</h3>
            <div className="recent">
              {recent.map((r) => (
                <div key={r.path} className="recent-item" onClick={() => void openPath(r.path)} title={r.path}>
                  <b>{r.name}</b>
                  <span className="dim">{r.path}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
