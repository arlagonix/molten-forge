import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("tool text viewer styles", () => {
  it("wraps verbatim tool text without horizontal scrolling", () => {
    expect(styles).toMatch(/\.tool-text-viewer\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/);
    expect(styles).toMatch(/\.tool-text-viewer \.cm-line\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  });

  it("gives read output a substantially taller viewport than generic tool logs", () => {
    expect(styles).toMatch(/\.tool-text-viewer\.tool-text-viewer-read\s*\{[\s\S]*?max-height:\s*min\(70dvh,\s*900px\);/);
  });

  it("keeps read line numbers visually separate from source content", () => {
    expect(styles).toMatch(/\.tool-text-viewer \.cm-gutters\s*\{[\s\S]*?border-right:\s*1px solid var\(--tool-diff-divider\);/);
    expect(styles).toMatch(/\.tool-text-viewer \.cm-lineNumbers \.cm-gutterElement\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/);
  });

  it("does not add a nested frame inside historical write diffs", () => {
    expect(styles).toMatch(/\.tool-write-content-viewer \.tool-text-viewer\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/);
  });
});
