import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "./markdown-renderer";

const source = readFileSync(fileURLToPath(new URL("./markdown-renderer.tsx", import.meta.url)), "utf8");
const rust = readFileSync(fileURLToPath(new URL("../../src-tauri/src/lib.rs", import.meta.url)), "utf8");

describe("external Markdown links", () => {
  it("renders HTTP(S) links as external links", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content="[Docs](https://example.com/docs)" />);
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("prevents in-webview navigation and routes HTTP(S) URLs through Tauri", () => {
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('invoke("open_external_url", { url: href })');
    expect(source).toContain('a: MarkdownLink');
    expect(rust).toContain('fn open_external_url(url: String) -> Result<(), String>');
    expect(rust).toContain('open_external_url,');
  });
});
