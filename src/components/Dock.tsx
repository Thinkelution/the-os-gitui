import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useStore, type Term } from "../store";
import { api } from "../lib/git";
import { Icon } from "./Icon";

// ---- PTY output routing. Output can arrive before a terminal is on screen,
// so it is buffered per terminal until the xterm instance attaches.
const sinks = new Map<number, (d: string) => void>();
const pending = new Map<number, string[]>();
let started = false;

export function startPtyEvents() {
  if (started) return;
  started = true;
  void listen<{ id: number; data: string }>("pty-data", (e) => {
    const { id, data } = e.payload;
    const sink = sinks.get(id);
    if (sink) sink(data);
    else pending.set(id, [...(pending.get(id) ?? []), data]);
  });
  void listen<{ id: number; code: number | null }>("pty-exit", (e) => {
    const s = useStore.getState();
    s.termExited(e.payload.id, e.payload.code);
    void s.loadAll();
  });
}

const THEMES = {
  dark: { background: "#111317", foreground: "#e3e6eb", cursor: "#5b9dff", selectionBackground: "#2d4a6e" },
  light: { background: "#fbfbfc", foreground: "#1f2328", cursor: "#2563eb", selectionBackground: "#c8daf8" },
};

function TermView({ term, visible }: { term: Term; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const xt = useRef<{ x: XTerm; fit: FitAddon } | null>(null);
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    const x = new XTerm({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono") || "monospace",
      fontSize: 12.5,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: THEMES[useStore.getState().theme],
    });
    const fit = new FitAddon();
    x.loadAddon(fit);
    x.open(ref.current!);
    xt.current = { x, fit };
    const id = term.id;
    sinks.set(id, (d) => x.write(d));
    for (const d of pending.get(id) ?? []) x.write(d);
    pending.delete(id);
    const d1 = x.onData((d) => void api.ptyWrite(id, d).catch(() => undefined));
    const d2 = x.onResize(({ cols, rows }) => void api.ptyResize(id, cols, rows).catch(() => undefined));
    const ro = new ResizeObserver(() => {
      if (ref.current?.offsetParent) fit.fit();
    });
    ro.observe(ref.current!);
    requestAnimationFrame(() => {
      fit.fit();
      x.focus();
    });
    return () => {
      ro.disconnect();
      d1.dispose();
      d2.dispose();
      sinks.delete(id);
      x.dispose();
    };
  }, [term.id]);

  useEffect(() => {
    if (xt.current) xt.current.x.options.theme = THEMES[theme];
  }, [theme]);

  useEffect(() => {
    if (visible && xt.current) {
      requestAnimationFrame(() => {
        xt.current?.fit.fit();
        xt.current?.x.focus();
      });
    }
  }, [visible]);

  return <div className="term" ref={ref} style={{ display: visible ? "block" : "none" }} />;
}

export function Dock() {
  const terms = useStore((s) => s.terms);
  const activeTerm = useStore((s) => s.activeTerm);
  const dock = useStore((s) => s.dock);
  const active = useStore((s) => s.active);
  const setActiveTerm = useStore((s) => s.setActiveTerm);
  const closeTerm = useStore((s) => s.closeTerm);
  const setDock = useStore((s) => s.setDock);
  const launch = useStore((s) => s.launch);
  const setDialog = useStore((s) => s.setDialog);
  const [h, setH] = useState(() => Number(localStorage.getItem("dockH")) || 300);

  if (!terms.length) return null;

  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = h;
    const move = (ev: PointerEvent) => {
      const v = Math.max(140, Math.min(window.innerHeight - 220, h0 - (ev.clientY - y0)));
      setH(v);
      localStorage.setItem("dockH", String(v));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing-v");
    };
    document.body.classList.add("resizing-v");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="dock" style={{ height: dock ? h : 34 }}>
      {dock && <div className="dock-grip" onPointerDown={drag} />}
      <div className="dock-tabs">
        {terms.map((t) => (
          <div
            key={t.id}
            className={"dock-tab" + (t.id === activeTerm && dock ? " active" : "") + (t.exited ? " exited" : "")}
            title={t.cwd}
            onClick={() => {
              setActiveTerm(t.id);
              setDock(true);
            }}
          >
            <Icon name={t.agent ? "sparkle" : "terminal"} size={13} />
            <span className="ellipsis">{t.title}</span>
            {t.exited && <span className="dim small">{t.code === 0 ? "done" : `exit ${t.code ?? "?"}`}</span>}
            <button
              className="tab-x"
              title={t.exited ? "Close" : "Stop and close"}
              onClick={(e) => {
                e.stopPropagation();
                closeTerm(t.id);
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button className="icon-btn" title="New terminal in this repo" disabled={!active} onClick={() => active && void launch(active, { kind: "shell" }, "Terminal")}>
          <Icon name="plus" size={14} />
        </button>
        <button className="icon-btn" title="Start an AI agent" onClick={() => setDialog({ kind: "agent" })}>
          <Icon name="sparkle" size={14} />
        </button>
        <span className="grow" />
        <button className="icon-btn" title={dock ? "Hide panel" : "Show panel"} onClick={() => setDock(!dock)}>
          <Icon name={dock ? "chevronDown" : "chevronRight"} size={14} />
        </button>
      </div>
      <div className="dock-body" style={{ display: dock ? "block" : "none" }}>
        {terms.map((t) => (
          <TermView key={t.id} term={t} visible={dock && t.id === activeTerm} />
        ))}
      </div>
    </div>
  );
}
