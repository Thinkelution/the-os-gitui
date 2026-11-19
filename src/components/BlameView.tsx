import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { api, type Blame } from "../lib/git";
import { fullTime, relTime } from "../lib/format";
import { Icon } from "./Icon";

const ZERO = /^0+$/;

export function BlameView({ path }: { path: string }) {
  const active = useStore((s) => s.active);
  const commits = useStore((s) => s.commits);
  const setView = useStore((s) => s.setView);
  const select = useStore((s) => s.select);
  const jumpTo = useStore((s) => s.jumpTo);
  const toast = useStore((s) => s.toast);
  const [blame, setBlame] = useState<Blame | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setBlame(null);
    api.blame(active, path)
      .then((b) => alive && setBlame(b))
      .catch((e) => alive && toast("error", String(e)));
    return () => {
      alive = false;
    };
  }, [active, path, commits, toast]);

  // Newer lines get a stronger accent stripe.
  const age = useMemo(() => {
    if (!blame) return (_: string) => 0;
    const times = Object.values(blame.commits).map((c) => c.time).filter(Boolean);
    const min = Math.min(...times);
    const max = Math.max(...times);
    return (h: string) => {
      const t = blame.commits[h]?.time ?? max;
      return max === min ? 1 : (t - min) / (max - min);
    };
  }, [blame]);

  return (
    <div className="view">
      <div className="view-head">
        <Icon name="blame" />
        <span className="view-title">Blame</span>
        <span className="mono dim ellipsis">{path}</span>
        <span className="grow" />
        <button className="icon-btn" title="Close" onClick={() => setView(null)}><Icon name="close" /></button>
      </div>
      <div className="view-body blame selectable">
        {!blame && <div className="empty">Loading…</div>}
        {blame?.lines.map((l, i) => {
          const c = blame.commits[l.hash];
          const first = i === 0 || blame.lines[i - 1].hash !== l.hash;
          const uncommitted = ZERO.test(l.hash);
          return (
            <div
              key={i}
              className={"bl-row" + (first ? " first" : "") + (hover === l.hash ? " hl" : "")}
              onMouseEnter={() => setHover(l.hash)}
            >
              <span className="bl-stripe" style={{ opacity: 0.15 + 0.85 * age(l.hash) }} />
              <span
                className="bl-meta"
                title={c && !uncommitted ? `${c.summary}\n${c.author} · ${fullTime(c.time)}` : "Not committed yet"}
                onClick={() => {
                  if (uncommitted) return;
                  select({ kind: "commit", hash: l.hash });
                  jumpTo(l.hash);
                }}
              >
                {first && (uncommitted ? <span className="dim">Not committed</span> : (
                  <>
                    <span className="mono">{l.hash.slice(0, 7)}</span>
                    <span className="ellipsis">{c?.author}</span>
                    <span className="dim">{c ? relTime(c.time) : ""}</span>
                  </>
                ))}
              </span>
              <span className="no">{l.line}</span>
              <span className="txt">{l.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
