import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolDiffViewer, ToolWriteContentViewer } from "./tool-diff-viewer";
import type { ToolDiff } from "../core/tool-diff";

describe("ToolDiffViewer", () => {
  it("renders a compact unified diff with real old/new line numbers and skipped context", () => {
    const diff: ToolDiff = {
      version: 1,
      path: "src/server.ts",
      kind: "modify",
      oldLineCount: 10000,
      newLineCount: 10000,
      added: 1,
      removed: 1,
      skippedAfter: 4997,
      hunks: [{
        oldStart: 4997,
        newStart: 4997,
        skippedBefore: 4996,
        lines: [
          { type: "context", text: "const host = config.host;", oldLine: 4997, newLine: 4997 },
          { type: "remove", text: "const timeout = 5000;", oldLine: 5000 },
          { type: "add", text: "const timeout = 10000;", newLine: 5000 },
          { type: "context", text: "server.listen(host);", oldLine: 5001, newLine: 5001 },
        ],
      }],
    };

    const html = renderToStaticMarkup(<ToolDiffViewer diff={diff} />);
    expect(html).toContain("4996 unchanged lines");
    expect(html).toContain("4997 unchanged lines");
    expect(html).toContain("5000");
    expect(html).toContain("const timeout = 5000;");
    expect(html).toContain("const timeout = 10000;");
  });

  it("renders a compact fallback instead of thousands of changed rows", () => {
    const diff: ToolDiff = {
      version: 1,
      path: "generated.ts",
      kind: "modify",
      added: 4000,
      removed: 4000,
      hunks: [],
      truncated: true,
    };
    const html = renderToStaticMarkup(<ToolDiffViewer diff={diff} />);
    expect(html).toContain("Diff is too large or complex to render compactly");
    expect(html).toContain("+4000 −4000");
  });
  it("renders legacy write content without pretending it is an additions-only diff", () => {
    const html = renderToStaticMarkup(
      <ToolWriteContentViewer path="src/server.ts" content={'const reallyLongValue = "abc";\n'} />,
    );
    expect(html).toContain("Previous file state unavailable; showing written content.");
    expect(html).toContain("const reallyLongValue");
    expect(html).not.toContain("tool-diff-line-add");
  });

  it("keeps diff and legacy write viewers wrapped instead of horizontally scrolling", () => {
    const source = readFileSync(new URL("./tool-diff-viewer.tsx", import.meta.url), "utf8");
    expect(source).toContain("EditorView.lineWrapping");
    expect(source).toContain('overflowX: "hidden"');
    expect(source).toContain('overflowWrap: "anywhere"');
    expect(source).toContain("<ToolTextViewer");
    expect(source).toMatch(/<ToolTextViewer[\s\S]*?lineNumbers[\s\S]*?ariaLabel="Written file content"/);
  });

});
