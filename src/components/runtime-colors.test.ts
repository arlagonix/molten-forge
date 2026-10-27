import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

describe("runtime visual emphasis", () => {
  it("keeps done/interrupted tool chrome muted while reserving red emphasis for real errors", () => {
    expect(styles).toMatch(/\.tool\.done \.activity-title\s*\{\s*color:\s*var\(--pi-thinking-text\);/);
    expect(styles).toMatch(/\.tool\.interrupted \.activity-title,[\s\S]*?\.tool-state\.interrupted\s*\{\s*color:\s*var\(--pi-thinking-text\);/);
    expect(styles).toMatch(/\.tool\.running \.activity-title/);
    expect(styles).toMatch(/\.tool\.error \.activity-title/);
    expect(styles).toMatch(/\.tool-state\.error,[\s\S]*?color:\s*var\(--pi-error\);/);
  });

  it("uses the same muted semantic tone for normal tool chrome and collapsed descriptions", () => {
    expect(styles).toMatch(/\.thinking-preview,[\s\S]*?\.tool-preview-range\s*\{[\s\S]*?color:\s*var\(--pi-thinking-text\)\s*!important;/);
    expect(styles).toMatch(/\.tool-header,[\s\S]*?\.tool-header \.activity-icon\s*\{[\s\S]*?color:\s*var\(--pi-thinking-text\);/);
    expect(styles).toMatch(/\.tool\.error \.activity-title,[\s\S]*?color:\s*var\(--pi-error\);/);
  });

  it("keeps tool rows and activity hover surfaces transparent in every theme", () => {
    expect(styles).toMatch(/\.tool,[\s\S]*?html\[data-theme="light"\] \.tool\s*\{[\s\S]*?background:\s*transparent\s*!important;[\s\S]*?box-shadow:\s*none\s*!important;/);
    expect(styles).toMatch(/\.activity-header:hover,[\s\S]*?html\[data-theme="light"\] \.tool-header:hover\s*\{[\s\S]*?background:\s*transparent\s*!important;/);
  });
});
