import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

describe("old Molten Forge light-theme parity", () => {
  it("uses a neutral wordmark instead of the molten gradient", () => {
    expect(styles).toMatch(/html\[data-theme="light"\] \.molten-forge-title\s*\{[\s\S]*?background:\s*none;[\s\S]*?color:\s*var\(--foreground\)\s*!important;[\s\S]*?animation:\s*none;/);
  });

  it("keeps ordinary session rows transparent until hover", () => {
    expect(styles).toMatch(/html\[data-theme="light"\] \.session-row,[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
    expect(styles).toMatch(/html\[data-theme="light"\] \.session-row:hover\s*\{[\s\S]*?background:\s*var\(--hover\);/);
    expect(styles).toMatch(/html\[data-theme="light"\] \.session-row\.active,[\s\S]*?border-color:\s*transparent\s*!important;[\s\S]*?background:\s*var\(--selected\);/);
  });

  it("does not paint nested runtime rows over the shared runtime surface", () => {
    expect(styles).toMatch(/html\[data-theme="light"\] \.runtime-group > \.thinking,[\s\S]*?\.parallel-tool-items > \.tool\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  });

  it("uses a quieter nested tool payload surface", () => {
    expect(styles).toMatch(/html\[data-theme="light"\] \.tool-detail-section pre,[\s\S]*?\.tool-text-viewer\s*\{[\s\S]*?background:\s*color-mix\(in oklab, var\(--card\) 54%, transparent\);/);
  });
});


describe("v0.36.56 runtime and composer polish", () => {
  it("shares a darker semantic token across thinking titles, Bash names, and previews", () => {
    expect(styles).toMatch(/:root\[data-theme="light"\]\s*\{[\s\S]*?--runtime-label-color:\s*color-mix\(in oklab, var\(--pi-thinking-text\) 72%, var\(--foreground\)\);/);
    expect(styles).toMatch(/\.thinking-header \.activity-title,[\s\S]*?\.tool-header \.activity-title,[\s\S]*?\.thinking-preview,[\s\S]*?\.tool-preview[\s\S]*?color:\s*var\(--runtime-label-color\) !important;/);
  });

  it("removes shadows from runtime boundaries but keeps their border styling", () => {
    expect(styles).toMatch(/\.runtime-group,[\s\S]*?html\[data-theme="light"\] \.tool\s*\{\s*box-shadow:\s*none !important;/);
    expect(styles).toMatch(/\.runtime-group\s*\{[\s\S]*?border:\s*1px dashed/);
  });

  it("makes icon hover/focus visible without restyling disabled buttons", () => {
    expect(styles).toMatch(/\.icon-button:hover:not\(:disabled\),[\s\S]*?\.icon-button:focus-visible:not\(:disabled\)[\s\S]*?color:\s*var\(--foreground\);/);
    expect(styles).toMatch(/background:\s*color-mix\(in oklab, var\(--foreground\) 11%, transparent\);/);
  });

  it("extends composer width by 2px without moving its physical center", () => {
    expect(styles).toMatch(/\.composer\s*\{\s*width:\s*calc\(var\(--chat-content-physical-width,[^\n]*\+ 2px\);/);
    expect(styles).toContain("--chat-content-center-offset");
  });
});
