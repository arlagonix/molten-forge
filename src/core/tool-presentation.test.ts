import { describe, expect, it } from "vitest";
import {
  compactToolPath,
  compactionResultSummary,
  fileMutationToolSummary,
  mergeStreamingToolOutput,
  readToolSummary,
  readToolSummaryParts,
  terminalInputPreview,
} from "./tool-presentation";

describe("tool terminal summaries", () => {
  it("shortens project-local paths while preserving outside absolute paths", () => {
    expect(compactToolPath("C:\\work\\forge\\src\\App.tsx", "C:\\work\\forge")).toBe("src\\App.tsx");
    expect(compactToolPath("C:\\other\\App.tsx", "C:\\work\\forge")).toBe("C:\\other\\App.tsx");
    expect(compactToolPath("/work/forge/src/App.tsx", "/work/forge")).toBe("src/App.tsx");
    expect(fileMutationToolSummary({ path: "src/App.tsx" }, "/work/forge")).toBe("src/App.tsx");
  });

  it("shows the actual successful Read range and requested failed range", () => {
    expect(readToolSummary({
      args: { path: "README.md", offset: 166, limit: 356 },
      output: "one\ntwo\nthree\n",
      state: "done",
      cwd: "/work/forge",
    })).toBe("README.md · 166-168");
    expect(readToolSummary({
      args: { path: "README.md", offset: 166, limit: 356 },
      output: "",
      state: "error",
      cwd: "/work/forge",
    })).toBe("README.md · 166-521");
    expect(readToolSummary({ args: { path: "README.md" }, output: "all", state: "done", cwd: "/work/forge" }))
      .toBe("README.md");
    expect(readToolSummaryParts({
      args: { path: "README.md", offset: 166, limit: 356 },
      output: "one\ntwo\nthree\n",
      state: "done",
      cwd: "/work/forge",
    })).toEqual({ path: "README.md", range: "166-168" });
    expect(readToolSummaryParts({ args: { path: "README.md" }, output: "all", state: "done", cwd: "/work/forge" }))
      .toEqual({ path: "README.md" });
  });

  it("does not count Pi's Read continuation footer as source lines", () => {
    expect(readToolSummary({
      args: { path: "table.ts", limit: 10 },
      output: [
        "import {",
        "  visibleWidth,",
        "  truncateToWidth,",
        "  type Component,",
        "} from \"@earendil-works/pi-tui\";",
        "",
        "export class SimpleTable implements Component {",
        "  constructor(",
        "    private columns: string[],",
        "    private rows: string[][],",
        "",
        "[103 more lines in file. Use offset=11 to continue.]",
      ].join("\n"),
      state: "done",
      cwd: "/work/forge",
    })).toBe("table.ts · 1-10");

    expect(readToolSummary({
      args: { path: "table.ts", offset: 41, limit: 10 },
      output: "line 41\nline 42\n\n[61 more lines in file. Use offset=43 to continue.]",
      state: "done",
      cwd: "/work/forge",
    })).toBe("table.ts · 41-42");
  });


  it("prefers Pi structured Read truncation metadata over text parsing", () => {
    expect(readToolSummary({
      args: { path: "large.ts" },
      output: "line 1\nline 2\n[footer wording is irrelevant]",
      state: "done",
      cwd: "/work/forge",
      details: { truncation: { truncated: true, outputLines: 2 } },
    })).toBe("large.ts · 1-2");

    expect(readToolSummary({
      args: { path: "large.ts", offset: 21 },
      output: "line 21\nline 22\n\n[Showing lines 21-22 of 999. Use offset=23 to continue.]",
      state: "done",
      cwd: "/work/forge",
      details: {
        truncation: {
          truncated: true,
          outputLines: 2,
          truncatedBy: "lines",
        },
      },
    })).toBe("large.ts · 21-22");

    // Structured data wins even if a future/translated footer wording no longer
    // matches Molten Forge's textual fallback parser.
    expect(readToolSummary({
      args: { path: "large.ts", offset: 41 },
      output: "line 41\nline 42\n[Showing lines 41-42 of 999. Use offset=43 to continue.]",
      state: "done",
      cwd: "/work/forge",
    })).toBe("large.ts · 41-42");

    expect(readToolSummary({
      args: { path: "large.ts", offset: 41 },
      output: "line 41\nline 42\n[continuation metadata changed]",
      state: "done",
      cwd: "/work/forge",
      details: { truncation: { truncated: true, outputLines: 2 } },
    })).toBe("large.ts · 41-42");
  });

  it("flattens multiline terminal input and keeps the beginning up to the compact preview limit", () => {
    expect(terminalInputPreview("$ stat -c 'size=%s mtime=%y' file.pdf\ndate '+now=%Y-%m-%d %H:%M:%S'"))
      .toBe("stat -c 'size=%s mtime=%y' file.pdf date '+now=%Y-%m-%d %H:%M:%S'");
    expect(terminalInputPreview("first row\nsecond row\tthird row")).toBe("first row second row third row");
    expect(terminalInputPreview("$ " + "x".repeat(250), 200)).toBe(`${"x".repeat(200)}…`);
  });
});

describe("streaming tool output", () => {
  it("preserves output across empty sentinels, cumulative snapshots, and delta chunks", () => {
    expect(mergeStreamingToolOutput("first", "")).toBe("first");
    expect(mergeStreamingToolOutput("first", "first second")).toBe("first second");
    expect(mergeStreamingToolOutput("first", " second")).toBe("first second");
    expect(mergeStreamingToolOutput("first second", "second")).toBe("first second");
  });
});

describe("compaction summaries", () => {
  it("shows before, after, and saved tokens", () => {
    expect(compactionResultSummary(97_200, 41_500)).toBe("97.2k → 41.5k (−55.7k)");
  });

  it("keeps useful fallbacks when one side is unavailable", () => {
    expect(compactionResultSummary(97_200, undefined)).toBe("Context compacted from 97.2k tokens.");
    expect(compactionResultSummary(undefined, 41_500)).toBe("Context compacted to 41.5k tokens.");
  });
});
