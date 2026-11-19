import { useEffect, useState } from "react";
import { useStore } from "../store";
import { api, type ConnectStatus } from "../lib/git";
import { Icon } from "./Icon";

const AGENTS = [
  { id: "claude" as const, name: "Claude Code", cmd: "/gitui" },
  { id: "codex" as const, name: "Codex", cmd: "/prompts:gitui" },
];

/** "Use OS GitUI from inside Claude Code / Codex": one click each. */
export function ConnectAgents() {
  const toast = useStore((s) => s.toast);
  const [st, setSt] = useState<Record<string, ConnectStatus | undefined>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    for (const a of AGENTS) {
      api.agentConnection(a.id, "status").then((s) => setSt((o) => ({ ...o, [a.id]: s }))).catch(() => undefined);
    }
  }, []);

  const act = async (id: "claude" | "codex", action: "connect" | "disconnect") => {
    setBusy(id);
    try {
      const s = await api.agentConnection(id, action);
      setSt((o) => ({ ...o, [id]: s }));
      const a = AGENTS.find((x) => x.id === id)!;
      toast("info", action === "connect"
        ? `${a.name} is connected. Restart it, then type ${a.cmd} or say "open this in OS GitUI".`
        : `${a.name} is disconnected.`);
    } catch (e) {
      toast("error", String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="connect">
      <div className="connect-head">
        <Icon name="sparkle" size={14} />
        <b>Use OS GitUI from inside your agent</b>
      </div>
      <div className="dim small">
        Adds an <span className="mono">osgitui</span> tool to the agent, so it can open the repo here for you to review.
      </div>
      <div className="connect-row">
        {AGENTS.map((a) => {
          const s = st[a.id];
          return (
            <div key={a.id} className="connect-item">
              <span>{a.name}</span>
              {!s ? (
                <span className="dim small">…</span>
              ) : !s.installed ? (
                <span className="dim small">not installed</span>
              ) : s.connected ? (
                <>
                  <span className="ok small">✓ connected · {a.cmd}</span>
                  <button className="small" disabled={busy === a.id} onClick={() => void act(a.id, "disconnect")}>Disconnect</button>
                </>
              ) : (
                <button className="small primary" disabled={busy === a.id} onClick={() => void act(a.id, "connect")}>
                  {busy === a.id ? "Connecting…" : "Connect"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
