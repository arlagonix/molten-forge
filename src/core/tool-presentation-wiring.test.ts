import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

describe("tool presentation wiring", () => {
  it("keeps active Edit/Write input raw instead of showing the old diff placeholder", () => {
    expect(app).not.toContain("Preparing file diff…");
    expect(app).toContain('<pre ref={inputScrollRef}>{input || "—"}</pre>');
  });

  it("only shows the terminal waiting placeholder after tool execution started", () => {
    expect(app).toContain('shouldShowToolOutput(item)');
    expect(app).toContain('running ? "Waiting for output…" : "—"');
  });

  it("preserves streamed tool output when later updates or the final wrapper are empty", () => {
    expect(app).toContain('mergeStreamingToolOutput(item.toolOutput ?? "", output)');
    expect(app).toContain('toolOutput: output || item.toolOutput || ""');
  });

  it("renders Read path and range as separate header elements", () => {
    expect(app).toContain('className="tool-preview-path"');
    expect(app).toContain('className="tool-preview-range"');
    expect(app).toContain('{readSummary.range}');
  });

  it("uses compact terminal summaries for Read, file mutations, Bash, and compaction", () => {
    expect(app).toContain("readToolSummary({ args: item.toolArgs, output, state: item.state, cwd, details: item.toolResultDetails })");
    expect(app).toContain("fileMutationToolSummary(item.toolArgs, cwd)");
    expect(app).toContain("terminalInputPreview(input, 200)");
    expect(app).toContain("compactionResultSummary(eventBefore, eventAfter)");
  });
});
