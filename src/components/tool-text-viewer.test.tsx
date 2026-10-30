import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolOutputContent, ToolTextViewer } from "./tool-text-viewer";

describe("ToolTextViewer", () => {
  it("renders read content as wrapped syntax-aware CodeMirror content", () => {
    const html = renderToStaticMarkup(
      <ToolTextViewer
        text={'export const value = "ok";'}
        toolName="read"
        args={{ path: "src/value.ts", offset: 50 }}
        lineNumbers
        lineNumberStart={50}
      />,
    );
    expect(html).toContain('class="tool-text-viewer"');
    expect(html).toContain('data-language="typescript"');
    expect(html).toContain('data-language-source="path"');
    expect(html).toContain("export const value");
    expect(html).toContain("chat-code-pre-wrap");
  });

  it("uses CodeMirror for terminal output but not grep/find/ls placeholders", () => {
    const terminal = renderToStaticMarkup(
      <ToolOutputContent toolName="bash" args={{ command: "npm test" }} text="PASS\n1 test passed" />,
    );
    expect(terminal).toContain("tool-text-viewer");

    const read = renderToStaticMarkup(
      <ToolOutputContent toolName="read" args={{ path: "src/a.ts" }} text={"line 1\nline 2"} />,
    );
    expect(read).toContain("tool-text-viewer-read");

    const grep = renderToStaticMarkup(
      <ToolOutputContent toolName="grep" args={{ pattern: "foo" }} text="src/a.ts:1:foo" />,
    );
    expect(grep).not.toContain("tool-text-viewer");
    expect(grep).toContain("<pre>");
  });

  it("labels structurally detected JSON", () => {
    const html = renderToStaticMarkup(
      <ToolOutputContent toolName="custom" text={'{"ok":true}'} />,
    );
    expect(html).toContain('data-language="json"');
    expect(html).toContain('data-language-source="structure"');
  });
  it("keeps read offset numbering and tool-output wiring in the shared viewer path", () => {
    const codeViewerSource = readFileSync(new URL("./code-viewer.tsx", import.meta.url), "utf8");
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(codeViewerSource).toContain("lineNumbers({");
    expect(codeViewerSource).toMatch(/lineNo \+ Math\.max\(1, Math\.floor\(lineNumberStart\)\) - 1/);
    expect(appSource).toMatch(/<ToolOutputContent[\s\S]*?text=\{output\}[\s\S]*?toolName=\{item\.title \?\? "tool"\}[\s\S]*?args=\{item\.toolArgs\}/);
  });

});
