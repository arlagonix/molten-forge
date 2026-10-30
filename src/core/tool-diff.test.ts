import { describe, expect, it } from "vitest";
import {
  diffSummary,
  inlineDiffPairs,
  languageFromFilePath,
  parseUnifiedPatch,
  previewEditDiff,
  toolDiffFromResult,
  writeContentFromArgs,
} from "./tool-diff";

describe("tool diff parsing", () => {
  const patch = [
    "--- src/a.ts",
    "+++ src/a.ts",
    "@@ -8,9 +8,9 @@",
    " context 8",
    " context 9",
    " context 10",
    " context 11",
    "-const timeout = 5000;",
    "+const timeout = 10000;",
    " context 13",
    " context 14",
    " context 15",
    " context 16",
    "",
  ].join("\n");

  it("parses a unified patch and trims Pi's four-line context to three", () => {
    const parsed = parseUnifiedPatch(patch);
    expect(parsed).toHaveLength(1);
    const diff = toolDiffFromResult("edit", { path: "src/a.ts" }, {
      patch,
      moltenForgeFile: { path: "src/a.ts", oldLineCount: 10000, newLineCount: 10000 },
    }, false)!;
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].lines[0].oldLine).toBe(9);
    expect(diff.hunks[0].lines.at(-1)?.newLine).toBe(15);
    expect(diff.hunks[0].skippedBefore).toBe(8);
    expect(diff.skippedAfter).toBe(9985);
    expect(diffSummary(diff)).toBe("+1 −1");
  });

  it("uses persisted write diffs as-is", () => {
    const diff = toolDiffFromResult("write", { path: "a.ts" }, {
      moltenForgeDiff: {
        version: 1,
        path: "a.ts",
        kind: "modify",
        added: 1,
        removed: 1,
        hunks: [{ oldStart: 1, newStart: 1, skippedBefore: 0, lines: [
          { type: "remove", text: "old", oldLine: 1 },
          { type: "add", text: "new", newLine: 1 },
        ] }],
      },
    }, false)!;
    expect(diff.path).toBe("a.ts");
    expect(diff.hunks[0].lines).toHaveLength(2);
  });

  it("does not show an unapplied failed write as a successful diff", () => {
    const diff = toolDiffFromResult("write", {}, {
      moltenForgeDiff: { version: 1, path: "a", kind: "modify", added: 1, removed: 1, hunks: [], applied: false },
    }, true);
    expect(diff).toBeUndefined();
  });

  it("keeps an applied write diff even if the tool later reports an error", () => {
    const diff = toolDiffFromResult("write", {}, {
      moltenForgeDiff: { version: 1, path: "a", kind: "modify", added: 1, removed: 1, hunks: [], applied: true },
    }, true);
    expect(diff?.applied).toBe(true);
  });

  it("keeps format-only edit metadata even when there are no changed source rows", () => {
    const diff = toolDiffFromResult("edit", { path: "a.txt" }, {
      patch: "",
      moltenForgeFile: { path: "a.txt", oldLineCount: 2, newLineCount: 2, lineEndingChange: "CRLF → LF" },
    }, false)!;
    expect(diff.hunks).toHaveLength(0);
    expect(diff.lineEndingChange).toBe("CRLF → LF");
  });

  it("creates an edit preview without pretending to know file line numbers", () => {
    const preview = previewEditDiff({ path: "a.ts", edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }] })!;
    expect(preview.kind).toBe("preview");
    expect(preview.hunks[0].lines[0].oldLine).toBeUndefined();
  });
});

describe("intra-line diff", () => {
  it("highlights only the replaced word/value", () => {
    const lines = [
      { type: "remove" as const, text: "const timeout = 5000;", oldLine: 10 },
      { type: "add" as const, text: "const timeout = 10000;", newLine: 10 },
    ];
    const pair = inlineDiffPairs(lines)[0];
    expect(lines[0].text.slice(pair.removed[0].from, pair.removed[0].to)).toBe("5000");
    expect(lines[1].text.slice(pair.added[0].from, pair.added[0].to)).toBe("10000");
  });

  it("treats a one-line replacement as an intra-line pair even when every token changed", () => {
    const lines = [
      { type: "remove" as const, text: "disabled", oldLine: 10 },
      { type: "add" as const, text: "enabled", newLine: 10 },
    ];
    const pair = inlineDiffPairs(lines)[0];
    expect(lines[0].text.slice(pair.removed[0].from, pair.removed[0].to)).toBe("disabled");
    expect(lines[1].text.slice(pair.added[0].from, pair.added[0].to)).toBe("enabled");
  });

  it("pairs similar lines in an unequal changed block instead of blindly pairing by position", () => {
    const pairs = inlineDiffPairs([
      { type: "remove", text: "const one = 1;" },
      { type: "remove", text: "const two = 2;" },
      { type: "add", text: "const one = 10;" },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].removeIndex).toBe(0);
    expect(pairs[0].addIndex).toBe(2);
  });
});

describe("diff language detection", () => {
  it.each([
    ["src/App.tsx", "tsx"],
    ["C:\\work\\server.py", "python"],
    ["Dockerfile", "dockerfile"],
    ["README.md", "markdown"],
    ["LICENSE", "text"],
  ])("detects %s", (path, language) => expect(languageFromFilePath(path)).toBe(language));
  it("extracts exact written content for legacy write fallback without inventing a diff", () => {
    expect(writeContentFromArgs("write", { path: "src/a.ts", content: "const value = 1;\n" })).toEqual({
      path: "src/a.ts",
      content: "const value = 1;\n",
    });
    expect(writeContentFromArgs("edit", { path: "src/a.ts", content: "nope" })).toBeUndefined();
    expect(writeContentFromArgs("write", { path: "src/a.ts" })).toBeUndefined();
  });

});
