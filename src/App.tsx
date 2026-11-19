import { useEffect } from "react";
import { useStore } from "./store";
import { api } from "./lib/git";
import { TabBar } from "./components/TabBar";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { Graph } from "./components/Graph";
import { DiffView } from "./components/DiffView";
import { RightPanel } from "./components/RightPanel";
import { Welcome } from "./components/Welcome";
import { Dialogs } from "./components/Dialogs";
import { ContextMenu } from "./components/ContextMenu";
import { Toasts } from "./components/Toasts";

export default function App() {
  const active = useStore((s) => s.active);
  const diff = useStore((s) => s.diff);

  useEffect(() => {
    const st = useStore.getState();
    const restore = () => {
      if (st.active) st.activate(st.active);
    };
    api.startupPath()
      .then((p) => {
        if (p) void st.openPath(p);
        else restore();
      })
      .catch(restore);

    const onFocus = () => void useStore.getState().loadAll();
    const poll = setInterval(() => {
      if (document.hasFocus()) void useStore.getState().refreshStatus();
    }, 3000);
    const noNativeMenu = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest("input, textarea, .selectable")) e.preventDefault();
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        void useStore.getState().loadAll();
      } else if (e.key === "Escape") {
        const s = useStore.getState();
        if (s.menu) s.hideMenu();
        else if (s.diff && !s.dialog) s.closeDiff();
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("contextmenu", noNativeMenu);
    window.addEventListener("keydown", keys);
    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("contextmenu", noNativeMenu);
      window.removeEventListener("keydown", keys);
    };
  }, []);

  return (
    <div className="app">
      <TabBar />
      {active ? (
        <>
          <Toolbar />
          <div className="main">
            <Sidebar />
            <div className="center">{diff ? <DiffView /> : <Graph />}</div>
            <RightPanel />
          </div>
        </>
      ) : (
        <Welcome />
      )}
      <Dialogs />
      <ContextMenu />
      <Toasts />
    </div>
  );
}
