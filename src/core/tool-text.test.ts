import { describe, expect, it } from "vitest";
import {
  detectToolTextLanguage,
  extractToolResultText,
  readLineNumberStart,
  toolFilePath,
  toolTextViewerDecision,
} from "./tool-text";

describe("tool text language detection", () => {
  it("prefers explicit language metadata over file paths and content", () => {
    expect(detectToolTextLanguage({
      toolName: "custom",
      args: { language: "python", path: "script.ts" },
      text: '{"looks":"json"}',
    })).toEqual({ language: "python", source: "explicit" });
  });

  it("uses a read file path before content sniffing", () => {
    expect(detectToolTextLanguage({
      toolName: "read",
      args: { path: "src/App.tsx" },
      text: '{"looks":"json"}',
    })).toEqual({ language: "tsx", source: "path" });
  });

  it.each([
    ['{"ok":true}', "json"],
    ['diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new', "diff"],
    ['<!doctype html><html><body>ok</body></html>', "html"],
    ['<?xml version="1.0"?><root></root>', "xml"],
    ['# Title\n\n## Details\n\n- one\n- two', "markdown"],
  ])("recognizes unambiguous structured output", (text, language) => {
    expect(detectToolTextLanguage({ toolName: "custom", text })).toEqual({
      language,
      source: "structure",
    });
  });

  it("falls back to plain text instead of guessing source languages", () => {
    expect(detectToolTextLanguage({
      toolName: "bash",
      text: "const maybeCode = value + 1;",
    })).toEqual({ language: "text", source: "fallback" });
  });

  it("accepts MIME metadata when an extension tool provides it", () => {
    expect(detectToolTextLanguage({
      toolName: "fetch",
      args: { contentType: "application/json; charset=utf-8" },
      text: "not parsed yet",
    })).toEqual({ language: "json", source: "explicit" });
  });

  it("honors an explicit plain-text declaration instead of re-detecting the path/content", () => {
    expect(detectToolTextLanguage({
      toolName: "custom",
      args: { language: "plaintext", path: "data.json" },
      text: '{"ok":true}',
    })).toEqual({ language: "text", source: "explicit" });
    expect(detectToolTextLanguage({
      toolName: "custom",
      args: { contentType: "text/plain", path: "page.html" },
      text: "<html><body>not syntax highlighted</body></html>",
    })).toEqual({ language: "text", source: "explicit" });
  });
});

describe("tool text viewer decisions", () => {
  it("renders read output with source line numbers starting at the requested offset", () => {
    expect(toolTextViewerDecision({
      toolName: "read",
      args: { path: "src/server.ts", offset: 500, limit: 20 },
      text: "export const server = true;",
    })).toMatchObject({
      useViewer: true,
      language: "typescript",
      source: "path",
      lineNumbers: true,
      lineNumberStart: 500,
      filePath: "src/server.ts",
    });
    expect(readLineNumberStart("read", { offset: 0 })).toBe(1);
  });

  it("renders terminal output in CodeMirror without editor line numbers", () => {
    expect(toolTextViewerDecision({
      toolName: "bash",
      args: { command: "npm test" },
      text: "PASS src/core/example.test.ts\n1 test passed",
    })).toMatchObject({ useViewer: true, lineNumbers: false, language: "text" });
  });

  it("leaves grep/find/ls available for specialized rendering", () => {
    for (const toolName of ["grep", "find", "ls"]) {
      expect(toolTextViewerDecision({
        toolName,
        args: { path: "src" },
        text: '{"even":"json"}\nsecond line',
      }).useViewer).toBe(false);
    }
  });

  it("keeps tiny plain status outputs lightweight", () => {
    expect(toolTextViewerDecision({ toolName: "write", text: "Written" }).useViewer).toBe(false);
    expect(toolTextViewerDecision({ toolName: "compact", text: "Context compacted." }).useViewer).toBe(false);
  });

  it("uses CodeMirror for generic structured or substantial textual output", () => {
    expect(toolTextViewerDecision({ toolName: "custom", text: '{"value":1}' }).useViewer).toBe(true);
    expect(toolTextViewerDecision({ toolName: "custom", text: "line one\nline two" }).useViewer).toBe(true);
  });

  it("extracts conventional file path fields without touching the filesystem", () => {
    expect(toolFilePath("custom", { filePath: "foo/bar.py" })).toBe("foo/bar.py");
    expect(toolFilePath("custom", { path: 123 })).toBeUndefined();
  });
});

describe("tool result text extraction", () => {
  it("treats Pi's empty streaming content wrapper as no output yet", () => {
    expect(extractToolResultText({ content: [] })).toBe("");
    expect(extractToolResultText({ content: [{ type: "text", text: "" }] })).toBe("");
  });

  it("extracts textual tool output and preserves unknown structured results", () => {
    expect(extractToolResultText({ content: [{ type: "text", text: "line one" }, { type: "text", text: "line two" }] }))
      .toBe("line one\nline two");
    expect(extractToolResultText({ content: [{ type: "image", data: "opaque" }] }))
      .toContain('"type": "image"');
    expect(extractToolResultText({ content: [], custom: { future: true } }))
      .toContain('"custom"');
  });
});
