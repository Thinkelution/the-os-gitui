import { useStore } from "../store";
import { Icon } from "./Icon";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const activate = useStore((s) => s.activate);
  const closeTab = useStore((s) => s.closeTab);

  return (
    <div className="tabbar">
      <div className="brand" title="OS GitUI">
        <span className="brand-dot" />
        <span>OS GitUI</span>
      </div>
      <div className="tabs">
        {tabs.map((t) => (
          <div
            key={t.path}
            className={"tab" + (t.path === active ? " active" : "")}
            title={t.path}
            onClick={() => t.path !== active && activate(t.path)}
            onAuxClick={(e) => e.button === 1 && closeTab(t.path)}
          >
            <Icon name="repo" size={13} />
            <span className="tab-name">{t.name}</span>
            <button
              className="tab-x"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.path);
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button className={"tab-add" + (active === null ? " active" : "")} title="Open, clone or create a repository" onClick={() => activate(null)}>
          <Icon name="plus" size={14} />
        </button>
      </div>
    </div>
  );
}
