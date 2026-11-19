import { useStore } from "../store";
import { Icon } from "./Icon";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={"toast " + t.kind} onClick={() => dismiss(t.id)} title="Click to dismiss">
          <Icon name={t.kind === "error" ? "warning" : "info"} className="toast-ico" />
          <pre className="selectable">{t.text}</pre>
        </div>
      ))}
    </div>
  );
}
