import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
const lightRoot = css.match(/:root\[data-theme="light"\]\s*\{([^}]*)\}/)?.[1] ?? "";

const surfaceTokens = [
  "background", "card", "strong", "medium", "subtle", "tool", "message", "table",
];

describe("opaque dark/light theme surfaces", () => {
  it("keeps theme glass tokens solid in both modes", () => {
    for (const token of surfaceTokens) {
      const name = `--app-glass-${token}`;
      expect(css).toMatch(new RegExp(`${name}:\\s*(?:#[a-f\\d]+|var\\(--[a-z-]+\\));`, "i"));
      expect(lightRoot).toMatch(new RegExp(`${name}:\\s*var\\(--[a-z-]+\\);`));
    }
  });
  it("preserves distinct historical user-message tints instead of the generic card surface", () => {
    expect(css).toMatch(/--app-glass-user-message:\s*rgba\(52,\s*55,\s*59,\s*\.64\);/);
    expect(lightRoot).toMatch(/--app-glass-user-message:\s*oklch\(from var\(--primary\) l c h \/ \.90\);/);
    expect(css).toMatch(/\.user-bubble\s*\{[^}]*background:\s*var\(--app-glass-user-message\);/);
  });
  it("does not blur backdrop surfaces while preserving startup-image blur", () => {
    expect(css).not.toMatch(/(?:-webkit-)?backdrop-filter\s*:/);
    expect(css).toMatch(/\.app-loading-background\s*\{[^}]*filter:\s*blur\(18px\);/);
  });
  it("keeps settings and context surfaces solid instead of alpha tints", () => {
    expect(css).toMatch(/\.settings-main\s*\{[^}]*background:\s*var\(--app-glass-strong\);/);
    expect(css).toMatch(/\.context-popover\.context-popover-portal\s*\{[^}]*background:\s*var\(--app-glass-card\);/);
  });
});
