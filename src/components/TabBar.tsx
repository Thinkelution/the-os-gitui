import { useStore } from "../store";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const activate = useStore((s) => s.activate);
  const closeTab = useStore((s) => s.closeTab);

  return (
    <div className="tabbar">
      <div className="brand" title="OS GitUI">
        <span className="brand-dot" /> OS GitUI
      </div>
      {tabs.map((t) => (
        <div
          key={t.path}
          className={"tab" + (t.path === active ? " active" : "")}
          title={t.path}
          onClick={() => t.path !== active && activate(t.path)}
          onAuxClick={(e) => e.button === 1 && closeTab(t.path)}
        >
          <span className="tab-name">{t.name}</span>
          <button
            className="tab-x"
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(t.path);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-add" title="Open, clone or create a repository" onClick={() => activate(null)}>
        +
      </button>
    </div>
  );
}
