import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

describe("model switcher visual contracts", () => {
  it("anchors the model popover above the composer trigger", () => {
    expect(styles).toMatch(/\.model-popover\s*\{[\s\S]*?bottom:\s*calc\(100% \+ 8px\);/);
  });

  it("keeps the searchbar fixed while the model list owns scrolling", () => {
    expect(styles).toMatch(/\.model-popover\s*\{[\s\S]*?overflow:\s*hidden;/);
    expect(styles).toMatch(/\.model-popover-list\s*\{[\s\S]*?overflow-y:\s*auto;/);
  });

  it("styles a compact searchbar inside the picker", () => {
    expect(styles).toMatch(/\.model-search-wrap\s*\{[\s\S]*?min-height:\s*32px;/);
    expect(styles).toMatch(/\.model-search-input\s*\{[\s\S]*?background:\s*transparent;/);
  });

  it("keeps provider headings visible while scrolling models", () => {
    expect(styles).toMatch(/\.model-provider-heading\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/);
  });

  it("styles the keyboard-highlighted model like pointer hover", () => {
    expect(styles).toMatch(/\.model-option:hover,[\s\S]*?\.model-option\.highlighted\s*\{[\s\S]*?background:/);
  });

  it("removes the search focus ring in both dark and light themes", () => {
    expect(styles).toMatch(/\.model-search-input:focus,[\s\S]*?box-shadow:\s*none !important;/);
    expect(styles).toMatch(/\.model-search-wrap:focus-within\s*\{[\s\S]*?box-shadow:\s*none;/);
    expect(styles).toMatch(/html\[data-theme="light"\] \.model-search-wrap:focus-within\s*\{[\s\S]*?box-shadow:\s*none;/);
  });

  it("defines explicit light-theme picker colors", () => {
    expect(styles).toContain('html[data-theme="light"] .model-provider-heading');
    expect(styles).toContain('html[data-theme="light"] .model-option');
    expect(styles).toContain('html[data-theme="light"] .model-search-wrap');
  });
});
