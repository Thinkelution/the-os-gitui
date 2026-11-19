import { describe, expect, it } from "vitest";
import { buildPatch, parseDiff, splitRows } from "./diff";

const DIFF = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,4 +1,5 @@
 one
-two
+TWO
+extra
 three
 four
@@ -10,2 +11,2 @@ ctx
 ten
-eleven
+ELEVEN
`;

describe("parseDiff", () => {
  it("reads files, hunks and line numbers", () => {
    const [f] = parseDiff(DIFF);
    expect(f.oldPath).toBe("a.txt");
    expect(f.hunks).toHaveLength(2);
    const h = f.hunks[0];
    expect(h.lines.map((l) => l.kind).join("")).toBe(" -++  ");
    expect(h.lines[1].oldNo).toBe(2);
    expect(h.lines[3].newNo).toBe(3);
    expect(f.hunks[1].oldStart).toBe(10);
  });

  it("flags binary files", () => {
    const [f] = parseDiff("diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n");
    expect(f.binary).toBe(true);
  });
});

describe("buildPatch", () => {
  const [f] = parseDiff(DIFF);

  it("stages a whole hunk", () => {
    const p = buildPatch(f, new Map([[0, "all"]]), false)!;
    expect(p).toContain("@@ -1,4 +1,5 @@\n one\n-two\n+TWO\n+extra\n three\n four\n");
    expect(p).not.toContain("eleven");
  });

  it("stages one added line: other + dropped, - kept as context", () => {
    const p = buildPatch(f, new Map([[0, new Set([2])]]), false)!;
    expect(p).toContain("@@ -1,4 +1,5 @@\n one\n two\n+TWO\n three\n four\n");
  });

  it("unstages one line (reverse): other + becomes context, - dropped", () => {
    const p = buildPatch(f, new Map([[0, new Set([3])]]), true)!;
    expect(p).toContain("@@ -1,4 +1,5 @@\n one\n TWO\n+extra\n three\n four\n");
  });

  it("shifts later hunk starts by earlier changes", () => {
    const p = buildPatch(f, new Map<number, Set<number> | "all">([[0, "all"], [1, "all"]]), false)!;
    expect(p).toContain("@@ -10,2 +11,2 @@");
  });

  it("returns null when nothing changes", () => {
    expect(buildPatch(f, new Map([[0, new Set([0])]]), false)).toBeNull();
  });
});

describe("splitRows", () => {
  it("pairs removed and added lines", () => {
    const [f] = parseDiff(DIFF);
    const rows = splitRows(f.hunks[0]);
    expect(rows).toHaveLength(5);
    expect(rows[1].left?.[0].text).toBe("two");
    expect(rows[1].right?.[0].text).toBe("TWO");
    expect(rows[2].left).toBeUndefined();
  });
});
