import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { api, type TodoAction, type TodoCommit } from "../lib/git";
import { Icon } from "./Icon";

interface Row extends TodoCommit { action: TodoAction; message: string }

const ACTIONS: { id: TodoAction; key: string; label: string; hint: string }[] = [
  { id: "pick", key: "p", label: "Pick", hint: "Keep the commit" },
  { id: "reword", key: "r", label: "Reword", hint: "Keep it, change the message" },
  { id: "squash", key: "s", label: "Squash", hint: "Join into the commit above, keep both messages" },
  { id: "fixup", key: "f", label: "Fixup", hint: "Join into the commit above, drop this message" },
  { id: "drop", key: "d", label: "Drop", hint: "Remove the commit" },
];

export function RebaseView({ base }: { base: string }) {
  const active = useStore((s) => s.active);
  const status = useStore((s) => s.status);
  const setView = useStore((s) => s.setView);
  const run = useStore((s) => s.run);
  const confirm = useStore((s) => s.confirm);
  const toast = useStore((s) => s.toast);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [focus, setFocus] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const drag = useRef<number | null>(null);
  const orig = useRef<string[]>([]);
  const [over, setOver] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    api.rebaseList(active, base)
      .then((l) => {
        orig.current = l.map((c) => c.hash);
        setRows(l.map((c) => ({ ...c, action: "pick", message: c.body })));
      })
      .catch((e) => {
        toast("error", String(e));
        setView(null);
      });
  }, [active, base, toast, setView]);

  if (!rows) return <div className="view"><div className="empty">Loading…</div></div>;

  const setAction = (i: number, a: TodoAction) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, action: a } : r)));
    if (a === "reword") setEditing(i);
  };
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    setRows(next);
    setFocus(to);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (editing !== null) return;
    const a = ACTIONS.find((x) => x.key === e.key.toLowerCase());
    if (a) { e.preventDefault(); setAction(focus, a.id); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      if (e.altKey) move(focus, focus + d);
      else setFocus(Math.max(0, Math.min(rows.length - 1, focus + d)));
    }
  };

  const kept = rows.filter((r) => r.action !== "drop");
  const firstJoins = kept.length > 0 && (kept[0].action === "squash" || kept[0].action === "fixup");
  const hasMerge = rows.some((r) => r.merge);
  const dirty = (status?.files.length ?? 0) > 0;
  const changed = rows.some((r, i) => r.action !== "pick" || r.hash !== orig.current[i]);

  const start = async () => {
    const drops = rows.filter((r) => r.action === "drop").length;
    if (drops && !(await confirm({
      title: "Drop commits",
      message: `${drops} commit${drops === 1 ? "" : "s"} will be removed from this branch.`,
      ok: "Rebase",
      danger: true,
    }))) return;
    const items = rows.map((r) => ({ hash: r.hash, action: r.action, message: r.action === "reword" ? r.message : null }));
    const ok = await run("Interactive rebase", (repo) => api.rebaseInteractive(repo, base, items));
    if (ok) setView(null);
  };

  return (
    <div className="view" tabIndex={0} onKeyDown={onKey}>
      <div className="view-head">
        <Icon name="rebase" />
        <span className="view-title">Interactive rebase</span>
        <span className="dim">
          {rows.length} commit{rows.length === 1 ? "" : "s"} on <b>{status?.branch ?? "HEAD"}</b> after <span className="mono">{base.slice(0, 7)}</span>
        </span>
        <span className="grow" />
        <button onClick={() => setView(null)}>Cancel</button>
        <button className="primary" disabled={!rows.length || firstJoins || dirty || !changed} onClick={() => void start()}>
          Start rebase
        </button>
      </div>
      <div className="rb-help dim">
        Oldest commit at the top. Drag to reorder, or use Alt+↑/↓. Keys: P pick · R reword · S squash · F fixup · D drop.
      </div>
      {dirty && <div className="rb-warn"><Icon name="warning" /> Commit or stash your changes first.</div>}
      {firstJoins && <div className="rb-warn"><Icon name="warning" /> The first commit can't be squashed: there is nothing above it.</div>}
      {hasMerge && <div className="rb-warn"><Icon name="warning" /> Merge commits in this range will be flattened.</div>}
      <div className="view-body">
        {rows.map((r, i) => (
          <div
            key={r.hash}
            className={`rb-row a-${r.action}` + (focus === i ? " focus" : "") + (over === i ? " over" : "")}
            draggable
            onClick={() => setFocus(i)}
            onDragStart={() => { drag.current = i; }}
            onDragOver={(e) => { e.preventDefault(); setOver(i); }}
            onDragLeave={() => setOver(null)}
            onDrop={() => { if (drag.current !== null) move(drag.current, i); drag.current = null; setOver(null); }}
            onDragEnd={() => { drag.current = null; setOver(null); }}
          >
            <span className="rb-grip"><Icon name="grip" /></span>
            <div className="seg rb-actions">
              {ACTIONS.map((a) => (
                <button key={a.id} title={a.hint} className={r.action === a.id ? "on " + a.id : ""} onClick={(e) => { e.stopPropagation(); setAction(i, a.id); }}>
                  {a.label}
                </button>
              ))}
            </div>
            <span className="mono dim">{r.hash.slice(0, 7)}</span>
            <div className="rb-msg">
              {editing === i ? (
                <textarea
                  autoFocus
                  rows={Math.min(8, Math.max(2, r.message.split("\n").length))}
                  value={r.message}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, message: e.target.value } : x)))}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }}
                />
              ) : (
                <span className={"ellipsis" + (r.action === "drop" ? " struck" : "")} onDoubleClick={() => setAction(i, "reword")}>
                  {r.action === "reword" ? r.message.split("\n")[0] : r.subject}
                </span>
              )}
            </div>
            <span className="dim small">{r.author}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
