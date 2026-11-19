import { useEffect, useRef, useState } from "react";
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
import { CommandPalette } from "./components/CommandPalette";
import { HistoryView } from "./components/HistoryView";
import { BlameView } from "./components/BlameView";
import { RebaseView } from "./components/RebaseView";
import { Splitter } from "./components/Splitter";
import { Dock, startPtyEvents } from "./components/Dock";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const stored = (k: string, d: number) => Number(localStorage.getItem(k)) || d;

function Center() {
  const diff = useStore((s) => s.diff);
  const view = useStore((s) => s.view);
  if (diff) return <DiffView />;
  if (view?.kind === "history") return <HistoryView path={view.path} />;
  if (view?.kind === "blame") return <BlameView path={view.path} />;
  if (view?.kind === "rebase") return <RebaseView base={view.base} />;
  return <Graph />;
}

export default function App() {
  const active = useStore((s) => s.active);
  const theme = useStore((s) => s.theme);
  const [sideW, setSideW] = useState(() => stored("sideW", 248));
  const [panelW, setPanelW] = useState(() => stored("panelW", 380));
  const start = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    startPtyEvents();
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
      // Terminals and agents own every key (Ctrl+R, Ctrl+W, Esc…).
      if ((e.target as HTMLElement | null)?.closest?.(".term")) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "F5" || (mod && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        void s.loadAll();
      } else if (mod && (e.key.toLowerCase() === "k" || (e.shiftKey && e.key.toLowerCase() === "p"))) {
        e.preventDefault();
        s.setPalette(!s.palette);
      } else if (mod && e.key.toLowerCase() === "t") {
        e.preventDefault();
        s.activate(null);
      } else if (mod && e.key.toLowerCase() === "w" && s.active) {
        e.preventDefault();
        s.closeTab(s.active);
      } else if (e.key === "Escape") {
        if (s.menu) s.hideMenu();
        else if (s.dialog || s.palette) return;
        else if (s.diff) s.closeDiff();
        else if (s.view && s.view.kind !== "rebase") s.setView(null);
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
            <div style={{ width: sideW }} className="col">
              <Sidebar />
            </div>
            <Splitter
              onStart={() => (start.current = sideW)}
              onDrag={(dx) => {
                const w = clamp(start.current + dx, 180, 480);
                setSideW(w);
                localStorage.setItem("sideW", String(w));
              }}
            />
            <div className="center">
              <div className="center-main">
                <Center />
              </div>
              <Dock />
            </div>
            <Splitter
              onStart={() => (start.current = panelW)}
              onDrag={(dx) => {
                const w = clamp(start.current - dx, 300, 700);
                setPanelW(w);
                localStorage.setItem("panelW", String(w));
              }}
            />
            <div style={{ width: panelW }} className="col">
              <RightPanel />
            </div>
          </div>
        </>
      ) : (
        <Welcome />
      )}
      <Dialogs />
      <ContextMenu />
      <CommandPalette />
      <Toasts />
    </div>
  );
}
