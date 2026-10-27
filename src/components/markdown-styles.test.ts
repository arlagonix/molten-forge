import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
const codeViewerSource = readFileSync(fileURLToPath(new URL("./code-viewer.tsx", import.meta.url)), "utf8");

describe("Pi semantic Markdown/code visual contracts", () => {
  it.each([
    ["--pi-md-heading", "#cd9a22"],
    ["--pi-md-link", "#69add0"],
    ["--pi-md-code", "#a798d7"],
    ["--pi-md-code-block", "#68b78d"],
    ["--pi-thinking-text", "#96a0a4"],
    ["--pi-syntax-comment", "#9da5a9"],
    ["--pi-syntax-keyword", "#69add0"],
    ["--pi-syntax-function", "#cd9a22"],
    ["--pi-syntax-variable", "#5db3ba"],
    ["--pi-syntax-string", "#de8d5a"],
    ["--pi-syntax-number", "#68b78d"],
    ["--pi-syntax-type", "#a798d7"],
  ])("defines the dark Pi token %s", (name, value) => {
    expect(styles).toContain(`${name}: ${value};`);
  });

  it("defines Pi's separate light semantic palette", () => {
    expect(styles).toContain(':root[data-theme="light"]');
    expect(styles).toContain("--pi-md-heading: #8f6802;");
    expect(styles).toContain("--pi-md-link: #2f7899;");
    expect(styles).toContain("--pi-md-code: #7459b4;");
    expect(styles).toContain("--pi-md-code-block: #337e58;");
    expect(styles).toContain("--pi-thinking-text: #7c868c;");
    expect(styles).toContain("--pi-syntax-string: #a45417;");
  });

  it("keeps the old neutral code foreground while routing syntax accents through Pi tokens", () => {
    expect(styles).toContain("--code-fg: #d4d4d4;");
    expect(styles).toContain("--code-fg: oklch(0.24 0.01 95);");
    expect(styles).not.toContain("--code-fg: var(--pi-md-code-block);");
    expect(styles).toContain("--code-comment: var(--pi-syntax-comment);");
    expect(styles).toContain("--code-keyword: var(--pi-syntax-keyword);");
    expect(styles).toContain("--code-string: var(--pi-syntax-string);");
    expect(styles).toContain("--code-number: var(--pi-syntax-number);");
    expect(styles).toContain("--code-title: var(--pi-syntax-type);");
    expect(styles).toContain("--code-attr: var(--pi-syntax-variable);");
    expect(styles).toContain("--code-built-in: var(--pi-syntax-function);");
  });

  it("maps CodeMirror operators and punctuation to Pi's dedicated syntax tokens", () => {
    expect(codeViewerSource).toContain('tag: tags.operator, color: "var(--pi-syntax-operator)"');
    expect(codeViewerSource).toContain('tag: tags.punctuation, color: "var(--pi-syntax-punctuation)"');
    expect(codeViewerSource).toContain('tags.standard(tags.typeName)');
  });

  it("applies Pi semantic colors to Markdown structure", () => {
    expect(styles).toMatch(/\.markdown-body h1,[\s\S]*?color:\s*var\(--pi-md-heading\);/);
    expect(styles).toMatch(/\.markdown-body a\s*\{\s*color:\s*var\(--pi-md-link\);/);
    expect(styles).toMatch(/\.markdown-body code\s*\{[\s\S]*?color:\s*var\(--pi-md-code\);/);
    expect(styles).toMatch(/\.markdown-body li::marker\s*\{\s*color:\s*var\(--pi-md-list-bullet\);/);
    expect(styles).toMatch(/\.thinking-preview,[\s\S]*?color:\s*var\(--pi-thinking-text\);/);
  });

  it("keeps tables horizontally scrollable without forcing the chat wider", () => {
    expect(styles).toMatch(/\.markdown-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto;/);
    expect(styles).toMatch(/\.markdown-table-scroll\s*>\s*table\s*\{[\s\S]*?width:\s*max-content;[\s\S]*?min-width:\s*100%;/);
  });

  it("keeps the code toolbar sticky in normal chat", () => {
    expect(styles).toMatch(/\.chat-code-header\s*\{[^}]*position:\s*sticky;[^}]*background:\s*var\(--app-glass-medium/);
  });

  it("gives CodeMirror its own internal scrolling boundary", () => {
    expect(styles).toMatch(/\.chat-code-viewer \.cm-scroller\s*\{[\s\S]*?overflow:\s*auto;/);
  });

  it("only shows the fullscreen horizontal scrollbar when code actually overflows", () => {
    expect(styles).toMatch(/\.chat-code-block-fullscreen \.chat-code-viewer \.cm-scroller\s*\{[\s\S]*?overflow-x:\s*auto;[\s\S]*?overflow-y:\s*auto;/);
    expect(styles).toMatch(/\.chat-code-block-fullscreen \.chat-code-viewer \.cm-content\s*\{[\s\S]*?min-width:\s*0;/);
  });

  it("keeps the sticky line-number gutter opaque over horizontally scrolled code", () => {
    expect(codeViewerSource).toMatch(/"\.cm-gutters"[\s\S]*?backgroundColor:\s*"var\(--code-bg\)"/);
    expect(codeViewerSource).toMatch(/"\.cm-gutters"[\s\S]*?zIndex:\s*"3"/);
  });


  it("commits CodeMirror geometry before paint and keeps its scrollbar gutter stable", () => {
    expect(codeViewerSource).toContain('import { useEffect, useLayoutEffect, useRef } from "react";');
    expect(codeViewerSource).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*?new EditorView/);
    expect(codeViewerSource).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*?calculateDocumentChange\(currentValue, code\)/);
    expect(styles).toMatch(/\.chat-code-viewer \.cm-scroller\s*\{[\s\S]*?scrollbar-gutter:\s*stable;/);
    expect(styles).toMatch(/\.chat-code-viewer \.cm-scroller\s*\{[\s\S]*?overflow-anchor:\s*none;/);
    // Lazy language loading may recolor tokens, but it must not change text
    // metrics and trigger a second wrap/height pass while streaming.
    expect(codeViewerSource).not.toMatch(/tag:\s*tags\.emphasis[^\n]*fontStyle/);
    expect(codeViewerSource).not.toMatch(/tag:\s*tags\.strong[^\n]*fontWeight/);
  });
  it("keeps thinking prose, previews, and code fragments italic", () => {
    expect(styles).toMatch(/\.thinking-preview,[\s\S]*?\.thinking-content,[\s\S]*?\.thinking-content \.markdown-body\s*\{[\s\S]*?font-style:\s*italic;/);
    expect(styles).toMatch(/\.thinking-content \.markdown-body code,[\s\S]*?font-style:\s*italic;/);
  });

  it("bundles real JetBrains Mono italic faces because font synthesis is disabled", () => {
    expect(styles).toContain('@import "@fontsource/jetbrains-mono/400-italic.css";');
    expect(styles).toContain('@import "@fontsource/jetbrains-mono/500-italic.css";');
    expect(styles).toContain('@import "@fontsource/jetbrains-mono/600-italic.css";');
    expect(styles).toContain('@import "@fontsource/jetbrains-mono/700-italic.css";');
    expect(styles).toContain("font-synthesis: none;");
  });
});
