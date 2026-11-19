import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore, type MenuItem } from "../store";
import type { Commit, ResetMode } from "../lib/git";
import { badges, copy, fullTime, hue, initials, relTime } from "../lib/format";
import { Icon } from "./Icon";

const ROW = 30;
const LANE = 16;
const PAD = 10;
const MAX_LANES = 24;
const COLORS = ["#4fb3ff", "#ff6b9a", "#7ee787", "#f2cc60", "#c58bff", "#ff9e64", "#56d4c8", "#ff7b72", "#a5d6ff", "#e3b341"];
export const laneColor = (c: number) => COLORS[c % COLORS.length];
const laneX = (l: number) => PAD + Math.min(l, MAX_LANES - 1) * LANE + LANE / 2;

export function Graph() {
  const commits = useStore((s) => s.commits);
  const status = useStore((s) => s.status);
  const refs = useStore((s) => s.refs);
  const selection = useStore((s) => s.selection);
  const jump = useStore((s) => s.jump);
  const select = useStore((s) => s.select);
  const jumpTo = useStore((s) => s.jumpTo);
  const loadMore = useStore((s) => s.loadMore);
  const limit = useStore((s) => s.limit);
  const op = useStore((s) => s.op);
  const prompt = useStore((s) => s.prompt);
  const confirm = useStore((s) => s.confirm);
  const showMenu = useStore((s) => s.showMenu);
  const setView = useStore((s) => s.setView);
  const theme = useStore((s) => s.theme);

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);

  const hasWip = !!status && status.files.length > 0;
  const off = hasWip ? 1 : 0;
  const total = commits.length + off;
  const localNames = useMemo(() => new Set(refs?.local.map((b) => b.name) ?? []), [refs]);
  const headIdx = useMemo(
    () => (status?.headHash ? commits.findIndex((c) => c.hash === status.headHash) : -1),
    [commits, status?.headHash],
  );
  const lanes = useMemo(() => {
    let m = 1;
    for (const c of commits) {
      m = Math.max(m, c.lane + 1);
      for (const e of c.down) m = Math.max(m, e[0] + 1, e[1] + 1);
    }
    return Math.min(m, MAX_LANES);
  }, [commits]);
  const gw = Math.max(PAD * 2 + lanes * LANE, 64);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as number[];
    const out: number[] = [];
    commits.forEach((c, i) => {
      if (c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.hash.startsWith(q)) out.push(i);
    });
    return out;
  }, [commits, query]);
  const matchSet = useMemo(() => new Set(matches), [matches]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const scrollToRow = (row: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const y = row * ROW;
    if (y < el.scrollTop || y + ROW > el.scrollTop + el.clientHeight) el.scrollTop = y - el.clientHeight / 3;
  };

  useEffect(() => {
    if (!jump) return;
    const i = commits.findIndex((c) => c.hash === jump);
    if (i >= 0) {
      scrollToRow(i + off);
      jumpTo(null);
    }
  }, [jump, commits, off, jumpTo]);

  // Draw the visible part of the graph.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = gw * dpr;
    cv.height = height * dpr;
    cv.style.width = `${gw}px`;
    cv.style.height = `${height}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, gw, height);
    const bg = theme === "dark" ? "#16181d" : "#ffffff";
    const fg = theme === "dark" ? "#ffffff" : "#1f2328";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";

    const first = Math.max(0, Math.floor(scrollTop / ROW) - 1);
    const last = Math.min(total, Math.ceil((scrollTop + height) / ROW) + 1);

    const seg = (a: number, y1: number, b: number, y2: number, color: number) => {
      const x1 = laneX(a);
      const x2 = laneX(b);
      ctx.strokeStyle = laneColor(color);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      if (x1 === x2) ctx.lineTo(x2, y2);
      else {
        const my = (y1 + y2) / 2;
        ctx.bezierCurveTo(x1, my, x2, my, x2, y2);
      }
      ctx.stroke();
    };

    for (let r = first; r < last; r++) {
      const c = commits[r - off];
      if (!c) continue;
      const yT = r * ROW - scrollTop;
      const yM = yT + ROW / 2;
      for (const e of c.up) seg(e[0], yT, e[1], yM, e[2]);
      for (const e of c.down) seg(e[0], yM, e[1], yT + ROW, e[2]);
    }

    if (hasWip) {
      const lane = headIdx >= 0 ? commits[headIdx].lane : 0;
      const yM = ROW / 2 - scrollTop;
      const yEnd = headIdx >= 0 ? (headIdx + off) * ROW + ROW / 2 - scrollTop : yM;
      ctx.strokeStyle = "#8b919a";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(laneX(lane), yM);
      ctx.lineTo(laneX(lane), yEnd);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(laneX(lane), yM, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (let r = first; r < last; r++) {
      const c = commits[r - off];
      if (!c) continue;
      const x = laneX(c.lane);
      const y = r * ROW - scrollTop + ROW / 2;
      const merge = c.parents.length > 1;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(x, y, merge ? 5.5 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = laneColor(c.color);
      ctx.beginPath();
      ctx.arc(x, y, merge ? 3.5 : 5.5, 0, Math.PI * 2);
      ctx.fill();
      if (c.hash === status?.headHash) {
        ctx.strokeStyle = fg;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }, [commits, scrollTop, height, gw, total, off, hasWip, headIdx, status?.headHash, theme]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setScrollTop(el.scrollTop);
    if (el.scrollTop + el.clientHeight > el.scrollHeight - ROW * 50 && commits.length >= limit) loadMore();
  };

  const selIdx = selection.kind === "commit" ? commits.findIndex((c) => c.hash === selection.hash) : -1;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    let row = selection.kind === "wip" ? (hasWip ? 0 : -1) : selIdx + off;
    row += e.key === "ArrowDown" ? 1 : -1;
    row = Math.max(0, Math.min(total - 1, row));
    if (hasWip && row === 0) select({ kind: "wip" });
    else if (commits[row - off]) select({ kind: "commit", hash: commits[row - off].hash });
    scrollToRow(row);
  };

  const nextMatch = (dir: 1 | -1) => {
    if (!matches.length) return;
    const n = (matchIdx + dir + matches.length) % matches.length;
    setMatchIdx(n);
    const i = matches[n];
    select({ kind: "commit", hash: commits[i].hash });
    scrollToRow(i + off);
  };

  const reset = (c: Commit, mode: ResetMode) => async () => {
    if (mode === "hard") {
      const ok = await confirm({
        title: "Hard reset",
        message: `Move ${status?.branch ?? "HEAD"} to ${c.hash.slice(0, 7)} and throw away all uncommitted changes? This cannot be undone.`,
        ok: "Hard reset",
        danger: true,
      });
      if (!ok) return;
    }
    void op("Reset", { op: "reset", hash: c.hash, mode });
  };

  const commitMenu = (c: Commit): MenuItem[] => {
    const short = c.hash.slice(0, 7);
    const isHead = c.hash === status?.headHash;
    const branchHere = badges(c.refs, localNames).filter((b) => b.kind === "local" && !b.current);
    const cur = status?.branch ?? "HEAD";
    return [
      ...branchHere.map((b) => ({ label: `Checkout ${b.name}`, action: () => void op("Checkout", { op: "checkout", name: b.name }) })),
      { label: `Checkout ${short} (detached HEAD)`, disabled: isHead, action: () => void op("Checkout", { op: "checkoutDetached", hash: c.hash }) },
      {
        label: "Create branch here…",
        action: async () => {
          const r = await prompt({ title: "Create branch", label: `New branch at ${short}`, ok: "Create", check: { label: "Switch to it", value: true } });
          const n = r?.value.trim();
          if (r && n) void op("Create branch", { op: "createBranch", name: n, start: c.hash, checkout: r.checked });
        },
      },
      {
        label: "Create tag here…",
        action: async () => {
          const r = await prompt({ title: "Create tag", label: `Tag name at ${short}`, ok: "Create" });
          const n = r?.value.trim();
          if (n) void op("Create tag", { op: "createTag", name: n, target: c.hash, message: null });
        },
      },
      { sep: true },
      { label: `Cherry-pick ${short} onto ${cur}`, disabled: isHead, action: () => void op("Cherry-pick", { op: "cherryPick", hash: c.hash }) },
      { label: `Revert ${short}`, action: () => void op("Revert", { op: "revert", hash: c.hash }) },
      {
        label: `Interactive rebase ${cur} onto ${short}…`,
        disabled: isHead || !status?.branch,
        action: () => setView({ kind: "rebase", base: c.hash }),
      },
      { sep: true },
      { label: `Reset ${cur} here: soft (keep staged)`, disabled: isHead, action: reset(c, "soft") },
      { label: `Reset ${cur} here: mixed (keep files)`, disabled: isHead, action: reset(c, "mixed") },
      { label: `Reset ${cur} here: hard (discard all)…`, danger: true, action: reset(c, "hard") },
      { sep: true },
      { label: "Copy commit SHA", action: () => void copy(c.hash) },
      { label: "Copy commit message", action: () => void copy(c.subject) },
    ];
  };

  const start = Math.max(0, Math.floor(scrollTop / ROW) - 10);
  const end = Math.min(total, Math.ceil((scrollTop + height) / ROW) + 10);
  const rows: JSX.Element[] = [];
  for (let r = start; r < end; r++) {
    if (hasWip && r === 0) {
      rows.push(
        <div
          key="wip"
          className={"g-row wip" + (selection.kind === "wip" ? " sel" : "")}
          style={{ top: 0, height: ROW, paddingLeft: gw }}
          onClick={() => select({ kind: "wip" })}
        >
          <span className="g-msg">
            <span className="wip-tag">// WIP</span>
            <span className="dim">
              {status!.files.length} uncommitted change{status!.files.length === 1 ? "" : "s"}
            </span>
          </span>
        </div>,
      );
      continue;
    }
    const i = r - off;
    const c = commits[i];
    if (!c) continue;
    const bs = badges(c.refs, localNames);
    const sel = selection.kind === "commit" && selection.hash === c.hash;
    rows.push(
      <div
        key={c.hash}
        className={"g-row" + (sel ? " sel" : "") + (matchSet.has(i) ? " match" : "") + (c.hash === status?.headHash ? " head" : "")}
        style={{ top: r * ROW, height: ROW, paddingLeft: gw }}
        onClick={() => select({ kind: "commit", hash: c.hash })}
        onDoubleClick={() => {
          const b = bs.find((x) => x.kind === "local" && !x.current);
          if (b) void op("Checkout", { op: "checkout", name: b.name });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          select({ kind: "commit", hash: c.hash });
          showMenu(e, commitMenu(c));
        }}
      >
        <span className="g-msg">
          {bs.map((b) => (
            <span
              key={b.kind + b.name}
              className={`badge b-${b.kind}${b.current ? " current" : ""}`}
              style={{ borderColor: laneColor(c.color) }}
              title={b.kind === "remote" ? `remote: ${b.name}` : b.name}
            >
              {b.current && "✔ "}
              {b.kind === "tag" ? "⌂ " : b.kind === "remote" ? "☁ " : ""}
              {b.name}
            </span>
          ))}
          <span className="subject">{c.subject}</span>
        </span>
        <span className="g-author" title={c.email}>
          <span className="avatar" style={{ background: `hsl(${hue(c.email)} 45% 40%)` }}>
            {initials(c.author)}
          </span>
          {c.author}
        </span>
        <span className="g-date" title={fullTime(c.time)}>{relTime(c.time)}</span>
        <span className="g-hash">{c.hash.slice(0, 7)}</span>
      </div>,
    );
  }

  return (
    <div className="graph">
      <div className="graph-header">
        <span style={{ width: gw, flex: "none" }} className="dim">GRAPH</span>
        <span className="g-msg dim">COMMIT MESSAGE</span>
        <div className="g-search">
          <Icon name="search" size={13} />
          <input
            placeholder="Search commits (message, author, SHA)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMatchIdx(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") nextMatch(e.shiftKey ? -1 : 1);
            }}
          />
          {query && <span className="dim">{matches.length ? `${Math.max(matchIdx + 1, 0)}/${matches.length}` : "0"}</span>}
        </div>
        <span className="g-author dim">AUTHOR</span>
        <span className="g-date dim">DATE</span>
        <span className="g-hash dim">SHA</span>
      </div>
      <div className="graph-body">
        <canvas ref={canvasRef} className="graph-canvas" />
        <div ref={scrollRef} className="graph-scroll" onScroll={onScroll} tabIndex={0} onKeyDown={onKey}>
          <div style={{ height: total * ROW, position: "relative" }}>{rows}</div>
          {!total && status && <div className="empty">No commits yet. Stage files and make the first commit.</div>}
        </div>
      </div>
    </div>
  );
}
