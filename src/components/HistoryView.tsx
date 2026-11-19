import { useEffect, useState } from "react";
import { useStore } from "../store";
import { api, type HistoryEntry } from "../lib/git";
import { fullTime, hue, initials, relTime } from "../lib/format";
import { Icon } from "./Icon";

export function HistoryView({ path }: { path: string }) {
  const active = useStore((s) => s.active);
  const commits = useStore((s) => s.commits);
  const selection = useStore((s) => s.selection);
  const setView = useStore((s) => s.setView);
  const select = useStore((s) => s.select);
  const openDiff = useStore((s) => s.openDiff);
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setList(null);
    api.fileHistory(active, path)
      .then((l) => alive && setList(l))
      .catch((e) => {
        if (alive) {
          setList([]);
          toast("error", String(e));
        }
      });
    return () => {
      alive = false;
    };
  }, [active, path, commits, toast]);

  const open = (h: HistoryEntry) => {
    select({ kind: "commit", hash: h.hash });
    openDiff({ kind: "commit", hash: h.hash, parent: h.parents[0] ?? null, path: h.path, oldPath: null });
  };

  return (
    <div className="view">
      <div className="view-head">
        <Icon name="history" />
        <span className="view-title">History</span>
        <span className="mono dim ellipsis">{path}</span>
        <span className="grow" />
        {list && <span className="dim">{list.length} commit{list.length === 1 ? "" : "s"}</span>}
        <button className="icon-btn" title="Close" onClick={() => setView(null)}><Icon name="close" /></button>
      </div>
      <div className="view-body">
        {!list && <div className="empty">Loading…</div>}
        {list?.length === 0 && <div className="empty">No history for this file.</div>}
        {list?.map((h, i) => (
          <div
            key={h.hash}
            className={"hist-row" + (selection.kind === "commit" && selection.hash === h.hash ? " sel" : "")}
            onClick={() => open(h)}
          >
            <div className="hist-dot" />
            {i < list.length - 1 && <div className="hist-line" />}
            <span className="avatar" style={{ background: `hsl(${hue(h.email)} 45% 42%)` }}>{initials(h.author)}</span>
            <div className="hist-main">
              <div className="ellipsis">{h.subject}</div>
              <div className="dim small">
                {h.author} · <span title={fullTime(h.time)}>{relTime(h.time)}</span>
                {h.path !== path && <> · <span className="mono">was {h.path}</span></>}
              </div>
            </div>
            <span className="mono dim">{h.hash.slice(0, 7)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
