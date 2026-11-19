// Unified diff parsing and partial-patch building (hunk / line staging).

export type LineKind = " " | "+" | "-" | "\\";

export interface DiffLine {
  kind: LineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  header: string[];
  oldPath: string | null;
  newPath: string | null;
  hunks: Hunk[];
  binary: boolean;
  /** `diff --cc` output (merge conflicts); shown read-only. */
  combined: boolean;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function cleanPath(p: string): string | null {
  const s = p.replace(/\t$/, "");
  if (s === "/dev/null") return null;
  return s.replace(/^[ab]\//, "");
}

export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let f: FileDiff | null = null;
  let h: Hunk | null = null;
  let o = 0;
  let n = 0;
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  for (const line of lines) {
    if (line.startsWith("diff --git ") || line.startsWith("diff --cc ") || line.startsWith("diff --combined ")) {
      f = { header: [line], oldPath: null, newPath: null, hunks: [], binary: false, combined: !line.startsWith("diff --git ") };
      files.push(f);
      h = null;
      continue;
    }
    if (!f) continue;

    if (f.combined && line.startsWith("@@@")) {
      h = { header: line, oldStart: 0, oldCount: 0, newStart: 0, newCount: 0, lines: [] };
      f.hunks.push(h);
      continue;
    }
    const m = f.combined ? null : HUNK.exec(line);
    if (m) {
      h = {
        header: line,
        oldStart: +m[1],
        oldCount: m[2] === undefined ? 1 : +m[2],
        newStart: +m[3],
        newCount: m[4] === undefined ? 1 : +m[4],
        lines: [],
      };
      f.hunks.push(h);
      o = h.oldStart;
      n = h.newStart;
      continue;
    }
    if (!h) {
      f.header.push(line);
      if (line.startsWith("--- ")) f.oldPath = cleanPath(line.slice(4));
      else if (line.startsWith("+++ ")) f.newPath = cleanPath(line.slice(4));
      else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) f.binary = true;
      continue;
    }
    if (f.combined) {
      const p = line.slice(0, 2);
      const kind: LineKind = p.includes("+") ? "+" : p.includes("-") ? "-" : " ";
      h.lines.push({ kind, text: line.slice(2), oldNo: null, newNo: null });
      continue;
    }
    const c = line[0];
    if (c === "+") h.lines.push({ kind: "+", text: line.slice(1), oldNo: null, newNo: n++ });
    else if (c === "-") h.lines.push({ kind: "-", text: line.slice(1), oldNo: o++, newNo: null });
    else if (c === "\\") h.lines.push({ kind: "\\", text: line, oldNo: null, newNo: null });
    else h.lines.push({ kind: " ", text: line.slice(1), oldNo: o++, newNo: n++ });
  }
  return files;
}

export type Selection = Map<number, Set<number> | "all">;

/**
 * Build a patch with only the selected lines of the selected hunks.
 *
 * `reverse` = the patch will be applied with `git apply -R`
 * (unstaging from the staged diff, or discarding from the unstaged diff).
 * Forward: unselected "-" lines become context, unselected "+" lines are dropped.
 * Reverse: unselected "+" lines become context, unselected "-" lines are dropped.
 */
export function buildPatch(file: FileDiff, sel: Selection, reverse: boolean): string | null {
  const out: string[] = file.header.filter((l) => !l.startsWith("Binary files"));
  let delta = 0;
  let any = false;

  file.hunks.forEach((h, hi) => {
    const s = sel.get(hi);
    if (!s) return;
    const body: string[] = [];
    let oc = 0;
    let nc = 0;
    let changes = 0;
    let lastKept = true;

    h.lines.forEach((l, li) => {
      const picked = s === "all" || s.has(li);
      if (l.kind === "\\") {
        if (lastKept) body.push(l.text);
        return;
      }
      if (l.kind === " ") {
        body.push(" " + l.text);
        oc++;
        nc++;
        lastKept = true;
        return;
      }
      if (l.kind === "+") {
        if (picked) { body.push("+" + l.text); nc++; changes++; lastKept = true; }
        else if (reverse) { body.push(" " + l.text); oc++; nc++; lastKept = true; }
        else lastKept = false;
        return;
      }
      if (picked) { body.push("-" + l.text); oc++; changes++; lastKept = true; }
      else if (!reverse) { body.push(" " + l.text); oc++; nc++; lastKept = true; }
      else lastKept = false;
    });

    if (!changes) return;
    any = true;
    // Keep the side that matches the file we apply to exactly where it was.
    const oldStart = reverse ? Math.max(0, h.newStart - delta) : h.oldStart;
    const newStart = reverse ? h.newStart : h.oldStart + delta;
    out.push(`@@ -${oldStart},${oc} +${newStart},${nc} @@`);
    out.push(...body);
    delta += nc - oc;
  });

  return any ? out.join("\n") + "\n" : null;
}

/** Pair lines for side-by-side view. */
export interface SplitRow { left?: [DiffLine, number]; right?: [DiffLine, number] }

export function splitRows(h: Hunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const L = h.lines;
  let i = 0;
  while (i < L.length) {
    const l = L[i];
    if (l.kind === " ") { rows.push({ left: [l, i], right: [l, i] }); i++; continue; }
    if (l.kind === "\\") { i++; continue; }
    const dels: number[] = [];
    const adds: number[] = [];
    while (i < L.length && (L[i].kind === "-" || L[i].kind === "\\")) { if (L[i].kind === "-") dels.push(i); i++; }
    while (i < L.length && (L[i].kind === "+" || L[i].kind === "\\")) { if (L[i].kind === "+") adds.push(i); i++; }
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      rows.push({
        left: dels[k] !== undefined ? [L[dels[k]], dels[k]] : undefined,
        right: adds[k] !== undefined ? [L[adds[k]], adds[k]] : undefined,
      });
    }
  }
  return rows;
}
