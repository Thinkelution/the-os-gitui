import { useState } from "react";

/** A thin vertical drag handle. `onDrag` gets the total x movement since press. */
export function Splitter({ onStart, onDrag }: { onStart: () => void; onDrag: (dx: number) => void }) {
  const [active, setActive] = useState(false);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    onStart();
    setActive(true);
    const move = (ev: PointerEvent) => onDrag(ev.clientX - x0);
    const up = () => {
      setActive(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <div className={"splitter" + (active ? " active" : "")} onPointerDown={down} />;
}
