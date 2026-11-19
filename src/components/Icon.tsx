// Small stroke icon set (24px grid, Lucide-style shapes drawn from scratch).

const P: Record<string, string> = {
  pull: "M12 4v12M6 11l6 6 6-6M5 20h14",
  push: "M12 20V8M6 13l6-6 6 6M5 4h14",
  fetch: "M4 14a8 8 0 0 0 15 3M20 10a8 8 0 0 0-15-3M4 4v4h4M20 20v-4h-4",
  branch: "M6 3v12M18 9a3 3 0 1 0 0-.01M6 21a3 3 0 1 0 0-.01M18 9c0 6-12 3-12 9",
  stash: "M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4",
  pop: "M12 15V3M7 8l5-5 5 5M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  terminal: "M4 17l6-6-6-6M12 19h8",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12l5 5L20 7",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  cloud: "M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.3 12 3.5 3.5 0 0 0 6 19z",
  tag: "M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM8 7.5a.5.5 0 1 0 0 .01",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3",
  blame: "M4 6h10M4 12h16M4 18h7",
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6",
  commit: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM2 12h6M16 12h6",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  rebase: "M6 3v18M18 3v6a6 6 0 0 1-6 6H6M15 6l3-3 3 3",
  command: "M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z",
  warning: "M12 3l10 18H2zM12 10v5M12 18h.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01",
  clone: "M12 3v12M7 10l5 5 5-5M5 21h14",
  repo: "M5 4a2 2 0 0 1 2-2h12v18H7a2 2 0 0 0-2 2zM5 20a2 2 0 0 1 2-2h12",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  pencil: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  worktree: "M4 5h6v6H4zM14 13h6v6h-6zM7 11v4a2 2 0 0 0 2 2h5",
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={"icon" + (className ? " " + className : "")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={P[name]} />
    </svg>
  );
}
