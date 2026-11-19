import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { api } from "../lib/git";
import { buildPatch, parseDiff, splitRows, type DiffLine, type Selection } from "../lib/diff";
import { Icon } from "./Icon";

const LIMIT = 4000;
type Mode = "unified" | "split";

export function DiffView() {
  const src = useStore((s) => s.diff)!;
  const text = useStore((s) => s.diffText);
  const loading = useStore((s) => s.diffLoading);
  const closeDiff = useStore((s) => s.closeDiff);
  const run = useStore((s) => s.run);
  const confirm = useStore((s) => s.confirm);
  const setView = useStore((s) => s.setView);
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem("diffMode") as Mode | null) ?? "unified");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const last = useRef<{ h: number; l: number } | null>(null);

  const file = useMemo(() => parseDiff(text)[0], [text]);
  useEffect(() => {
    setSel(new Set());
    last.current = null;
  }, [text]);

  const work = src.kind === "work";
  const staged = work && src.staged;
  const editable = work && !src.untracked && !src.conflicted && !!file && !file.binary && !file.combined;

  const setModeSaved = (m: Mode) => {
    setMode(m);
    localStorage.setItem("diffMode", m);
  };

  const apply = (s: Selection, reverse: boolean, cached: boolean, label: string) => {
    if (!file) return;
    const patch = buildPatch(file, s, reverse);
    if (patch) void run(label, (repo) => api.applyPatch(repo, patch, reverse, cached), true);
  };
  const whole = (h: number): Selection => new Map<number, Set<number> | "all">([[h, "all"]]);
  const picked = (): Selection => {
    const m: Selection = new Map();
    for (const k of sel) {
      const [h, l] = k.split(":").map(Number);
      const cur = m.get(h);
      if (cur instanceof Set) cur.add(l);
      else m.set(h, new Set([l]));
    }
    return m;
  };

  const stageSel = (s: Selection, label: string) => apply(s, false, true, label);
  const unstageSel = (s: Selection, label: string) => apply(s, true, true, label);
  const discardSel = async (s: Selection, label: string) => {
    if (await confirm({ title: label, message: "Throw away these changes from your working files? This cannot be undone.", ok: "Discard", danger: true })) {
      apply(s, true, false, label);
    }
  };

  const toggle = (h: number, l: number, line: DiffLine, e: React.MouseEvent) => {
    if (!editable || (line.kind !== "+" && line.kind !== "-")) return;
    e.preventDefault();
    const next = new Set(sel);
    const key = `${h}:${l}`;
    if (e.shiftKey && last.current && last.current.h === h) {
      const [a, b] = [Math.min(last.current.l, l), Math.max(last.current.l, l)];
      const lines = file!.hunks[h].lines;
      for (let i = a; i <= b; i++) if (lines[i].kind === "+" || lines[i].kind === "-") next.add(`${h}:${i}`);
    } else if (next.has(key)) next.delete(key);
    else next.add(key);
    last.current = { h, l };
    setSel(next);
  };

  const path = src.path;
  const fileActions = work && (
    <>
      {staged ? (
        <button className="small" onClick={() => void run("Unstage", (repo) => api.unstage(repo, [path]), true)}>Unstage file</button>
      ) : (
        <>
          {!src.conflicted && (
            <button
              className="small danger-text"
              onClick={async () => {
                if (await confirm({ title: "Discard file", message: `Discard all changes to ${path}? This cannot be undone.`, ok: "Discard", danger: true })) {
                  void run("Discard", (repo) => api.discard(repo, src.untracked ? [] : [path], src.untracked ? [path] : []), true);
                }
              }}
            >
              Discard file
            </button>
          )}
          <button className="small success" onClick={() => void run("Stage", (repo) => api.stage(repo, [path]), true)}>
            {src.conflicted ? "Mark resolved" : "Stage file"}
          </button>
        </>
      )}
    </>
  );

  let shown = 0;
  const cls = (l: DiffLine) => (l.kind === "+" ? "add" : l.kind === "-" ? "del" : l.kind === "\\" ? "meta" : "ctx");

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="diff-path selectable" title={path}>
          {src.kind === "commit" && src.oldPath ? `${src.oldPath} → ` : ""}
          {path}
        </span>
        <span className={"pill " + (src.kind === "commit" ? "" : staged ? "pill-staged" : "pill-unstaged")}>
          {src.kind === "commit" ? src.hash.slice(0, 7) : staged ? "staged" : src.untracked ? "untracked" : src.conflicted ? "conflict" : "unstaged"}
        </span>
        <span className="grow" />
        {editable && sel.size > 0 && (
          <>
            <span className="dim">{sel.size} line{sel.size === 1 ? "" : "s"}</span>
            {staged ? (
              <button className="small" onClick={() => unstageSel(picked(), "Unstage lines")}>Unstage lines</button>
            ) : (
              <>
                <button className="small danger-text" onClick={() => void discardSel(picked(), "Discard lines")}>Discard lines</button>
                <button className="small success" onClick={() => stageSel(picked(), "Stage lines")}>Stage lines</button>
              </>
            )}
            <span className="tb-gap" />
          </>
        )}
        {fileActions}
        <div className="seg">
          <button className={mode === "unified" ? "on" : ""} onClick={() => setModeSaved("unified")}>Unified</button>
          <button className={mode === "split" ? "on" : ""} onClick={() => setModeSaved("split")}>Split</button>
        </div>
        <button className="icon-btn" title="File history" onClick={() => setView({ kind: "history", path })}><Icon name="history" /></button>
        <button className="icon-btn" title="Blame" onClick={() => setView({ kind: "blame", path })}><Icon name="blame" /></button>
        <button className="icon-btn" title="Close (Esc)" onClick={closeDiff}><Icon name="close" /></button>
      </div>

      <div className="diff-body selectable">
        {!text && loading && <div className="empty">Loading…</div>}
        {!loading && !file && <div className="empty">No changes</div>}
        {file?.binary && <div className="empty">Binary or very large file. No text preview.</div>}
        {file && !file.binary && !file.hunks.length && <div className="empty">No content changes (mode or rename only)</div>}
        {editable && file && file.hunks.length > 0 && sel.size === 0 && (
          <div className="diff-hint">Tip: click line numbers to pick lines, Shift+click for a range.</div>
        )}
        {file?.hunks.map((h, hi) => {
          if (!showAll && shown > LIMIT) return null;
          return (
            <div key={hi} className="hunk">
              <div className="hunk-head">
                <span className="mono">{h.header}</span>
                <span className="grow" />
                {editable &&
                  (staged ? (
                    <button className="small" onClick={() => unstageSel(whole(hi), "Unstage hunk")}>Unstage hunk</button>
                  ) : (
                    <>
                      <button className="small danger-text" onClick={() => void discardSel(whole(hi), "Discard hunk")}>Discard hunk</button>
                      <button className="small success" onClick={() => stageSel(whole(hi), "Stage hunk")}>Stage hunk</button>
                    </>
                  ))}
              </div>
              {mode === "unified"
                ? h.lines.map((l, li) => {
                    if (!showAll && shown++ > LIMIT) return null;
                    const on = sel.has(`${hi}:${li}`);
                    return (
                      <div key={li} className={`dl ${cls(l)}${on ? " picked" : ""}`}>
                        <span className={"no" + (editable ? " pick" : "")} onMouseDown={(e) => toggle(hi, li, l, e)}>{l.oldNo ?? ""}</span>
                        <span className={"no" + (editable ? " pick" : "")} onMouseDown={(e) => toggle(hi, li, l, e)}>{l.newNo ?? ""}</span>
                        <span className="sign">{l.kind === "\\" ? "" : l.kind}</span>
                        <span className="txt">{l.text}</span>
                      </div>
                    );
                  })
                : splitRows(h).map((row, ri) => {
                    if (!showAll && shown++ > LIMIT) return null;
                    const side = (cell: [DiffLine, number] | undefined, left: boolean) => {
                      if (!cell) return <div className="half empty-half" />;
                      const [l, li] = cell;
                      const on = sel.has(`${hi}:${li}`);
                      return (
                        <div className={`half ${cls(l)}${on ? " picked" : ""}`}>
                          <span className={"no" + (editable ? " pick" : "")} onMouseDown={(e) => toggle(hi, li, l, e)}>
                            {left ? l.oldNo ?? "" : l.newNo ?? ""}
                          </span>
                          <span className="sign">{l.kind === " " ? "" : l.kind}</span>
                          <span className="txt">{l.text}</span>
                        </div>
                      );
                    };
                    return (
                      <div key={ri} className="split-row">
                        {side(row.left, true)}
                        {side(row.right, false)}
                      </div>
                    );
                  })}
            </div>
          );
        })}
        {!showAll && shown > LIMIT && (
          <div className="empty">
            Large diff. <button className="small" onClick={() => setShowAll(true)}>Show everything</button>
          </div>
        )}
      </div>
    </div>
  );
}
