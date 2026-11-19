import { useLayoutEffect, useRef } from "react";
import { useStore } from "../store";

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const hideMenu = useStore((s) => s.hideMenu);
  const ref = useRef<HTMLDivElement>(null);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4))}px`;
  }, [menu]);

  if (!menu) return null;
  return (
    <div
      className="menu-overlay"
      onMouseDown={hideMenu}
      onContextMenu={(e) => {
        e.preventDefault();
        hideMenu();
      }}
    >
      <div ref={ref} className="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
        {menu.items.map((it, i) =>
          it.sep ? (
            <div key={i} className="menu-sep" />
          ) : (
            <button
              key={i}
              className={"menu-item" + (it.danger ? " danger" : "")}
              disabled={it.disabled}
              onClick={() => {
                hideMenu();
                it.action?.();
              }}
            >
              {it.label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
