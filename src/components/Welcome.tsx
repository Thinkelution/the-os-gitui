import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";
import { api } from "../lib/git";
import { Icon, type IconName } from "./Icon";
import { MOD } from "./Toolbar";

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

  const actions: { icon: IconName; title: string; text: string; run: () => void }[] = [
    { icon: "folder", title: "Open", text: "A repository on this computer", run: () => void openRepo() },
    { icon: "clone", title: "Clone", text: "From GitHub, GitLab or any URL", run: () => setDialog({ kind: "clone" }) },
    { icon: "plus", title: "Start", text: "A brand new repository", run: () => void initRepo() },
  ];

  return (
    <div className="welcome">
      <div className="welcome-glow" />
      <div className="welcome-card">
        <div className="welcome-logo">
          <svg viewBox="0 0 1024 1024" width="56" height="56" aria-hidden="true">
            <rect x="64" y="64" width="896" height="896" rx="200" fill="var(--logo-bg)" />
            <path d="M380 270 V754" stroke="#4fb3ff" strokeWidth="64" strokeLinecap="round" fill="none" />
            <path d="M660 340 C660 540 380 500 380 650" stroke="#ff6b9a" strokeWidth="64" strokeLinecap="round" fill="none" />
            <circle cx="380" cy="270" r="84" fill="#4fb3ff" />
            <circle cx="380" cy="754" r="84" fill="#4fb3ff" />
            <circle cx="660" cy="340" r="84" fill="#ff6b9a" />
          </svg>
          <div>
            <h1>OS GitUI</h1>
            <p className="dim">A free, open-source Git client.</p>
          </div>
        </div>
        <div className="welcome-actions">
          {actions.map((a) => (
            <button key={a.title} className="action" onClick={a.run}>
              <span className="action-ico"><Icon name={a.icon} size={20} /></span>
              <b>{a.title}</b>
              <span className="dim small">{a.text}</span>
            </button>
          ))}
        </div>
        {recent.length > 0 && (
          <>
            <div className="welcome-sub">Recent</div>
            <div className="recent">
              {recent.map((r) => (
                <div key={r.path} className="recent-item" onClick={() => void openPath(r.path)} title={r.path}>
                  <Icon name="repo" size={15} />
                  <b>{r.name}</b>
                  <span className="dim ellipsis">{r.path}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="welcome-keys dim small">
          <span><kbd>{MOD} K</kbd> commands</span>
          <span><kbd>{MOD} T</kbd> new tab</span>
          <span><kbd>F5</kbd> refresh</span>
        </div>
      </div>
    </div>
  );
}
