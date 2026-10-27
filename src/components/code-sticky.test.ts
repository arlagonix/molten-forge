import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
const rendererSource = readFileSync(fileURLToPath(new URL("./markdown-renderer.tsx", import.meta.url)), "utf8");
const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? "";
}

describe("sticky code header regression contract", () => {
  it("uses the old Molten Forge transform-free TanStack position mode", () => {
    expect(appSource).toMatch(/directDomUpdates:\s*true/);
    expect(appSource).toMatch(/directDomUpdatesMode:\s*["']position["']/);
    expect(appSource).toMatch(/virtualizer\.containerRef\(element\)/);
  });

  it("lets TanStack own the virtual list size through containerRef", () => {
    const list = appSource.match(/ref=\{setListElement\}[\s\S]{0,160}className=["']virtual-transcript-list["']/)?.[0] ?? "";
    expect(list).not.toContain("getTotalSize");
    expect(list).not.toMatch(/style=\{\{[^}]*height/);
  });

  it("does not position virtual transcript rows with React transforms", () => {
    const row = appSource.match(/className=["']virtual-transcript-row["'][\s\S]{0,180}/)?.[0] ?? "";
    expect(row).not.toContain("translateY");
    expect(row).not.toContain("translate3d");
    expect(row).not.toMatch(/style=\{\{[^}]*\btop\s*:/);
  });

  it("lets the virtualizer own the row main-axis position", () => {
    const rule = cssRule(".virtual-transcript-row");
    expect(rule).toContain("position: absolute;");
    expect(rule).not.toMatch(/\btop\s*:/);
    expect(rule).not.toMatch(/\btransform\s*:/);
  });

  it("keeps the normal code header before the code scroll surface", () => {
    const headerIndex = rendererSource.indexOf('<div className="chat-code-header"');
    const scrollIndex = rendererSource.indexOf('<div className="chat-code-scroll">');
    expect(headerIndex).toBeGreaterThan(-1);
    expect(scrollIndex).toBeGreaterThan(headerIndex);
  });

  it("keeps the normal header sticky and the code frame overflow visible", () => {
    expect(cssRule(".chat-code-header")).toMatch(/position:\s*sticky;/);
    expect(cssRule(".chat-code-header")).toMatch(/top:\s*var\(--chat-code-header-sticky-top,\s*0\);/);
    expect(cssRule(".chat-code-block")).toMatch(/overflow:\s*visible;/);
  });

  it("binds the sticky offset to the real transcript scroll container", () => {
    expect(cssRule(".transcript")).toContain("--chat-code-header-sticky-top: 0px;");
    expect(cssRule(".transcript")).toMatch(/overflow-y:\s*auto;/);
  });

  it("keeps fullscreen as the deliberate non-sticky exception", () => {
    const rule = cssRule(".chat-code-block-fullscreen .chat-code-header");
    expect(rule).toMatch(/position:\s*static;/);
  });
  it("keeps the inline code viewer unchanged while fullscreen enables the enhanced CodeMirror gutter", () => {
    const regularStart = rendererSource.indexOf("const regularFrame");
    const fullscreenStart = rendererSource.indexOf("const fullscreenFrame");
    const regularFrame = rendererSource.slice(regularStart, fullscreenStart);
    const fullscreenFrame = rendererSource.slice(fullscreenStart);
    expect(regularFrame).not.toContain("enhancedViewer");
    expect(fullscreenFrame).toMatch(/fullscreen[\s\S]*?enhancedViewer/);
    expect(rendererSource).toMatch(/lineNumbers=\{enhancedViewer\}/);
  });

  it("keeps ReactMarkdown component identities stable while streamed code grows", () => {
    const componentsIndex = rendererSource.indexOf("const MARKDOWN_COMPONENTS");
    const rendererIndex = rendererSource.indexOf("export function MarkdownRenderer");
    expect(componentsIndex).toBeGreaterThan(-1);
    expect(componentsIndex).toBeLessThan(rendererIndex);
    expect(rendererSource.slice(rendererIndex)).toContain("components={MARKDOWN_COMPONENTS}");
    expect(rendererSource.slice(rendererIndex)).not.toMatch(/components=\{\{/);
  });

  it("uses the full viewport height minus a 16px inset above and below", () => {
    expect(cssRule(".code-fullscreen-backdrop")).toMatch(/padding:\s*16px;/);
    expect(cssRule(".code-fullscreen-surface")).toMatch(/height:\s*calc\(100dvh - 32px\);/);
  });

  it("shows a pointer cursor for every code-toolbar action", () => {
    expect(cssRule("button.chat-code-action")).toMatch(/cursor:\s*pointer;/);
  });

});
