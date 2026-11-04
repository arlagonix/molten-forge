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
  it("keeps settings and context cards on the shared foreground surface", () => {
    expect(css).toMatch(/\.context-popover\.context-popover-portal\s*\{[^}]*background:\s*var\(--app-glass-card\);/);
    expect(css).toContain("--app-settings-tint: var(--app-workspace-tint);");
    expect(css).toMatch(/\.settings-main-titlebar,\s*html\[data-theme="light"\] \.settings-main-titlebar\s*\{[^}]*position:\s*absolute;[^}]*background:\s*var\(--mf-shell-frame-bg\);/);
  });
});

describe("OpenCode-computed Monokai workspace palette", () => {
  const dark = css.match(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/)?.[1] ?? "";
  it("uses exact computed OpenCode colors rather than its raw syntax palette", () => {
    for (const [name, value] of Object.entries({
      "--background": "#161712",
      "--foreground": "#f8f8f2",
      "--app-workspace-tint": "var(--mf-surface-workspace)",
      "--mf-shell-sidebar-bg": "var(--mf-surface-shell)",
      "--app-glass-medium": "#252621",
      "--border": "#373732",
    })) expect(dark).toContain(`${name}: ${value};`);
  });
  it("keeps the V2 Monokai surfaces independent from the foreground card color", () => {
    for (const [key, value] of Object.entries({
      "--mf-opencode-bg-deep": "#191a15",
      "--mf-opencode-bg-base": "#1d1e19",
      "--mf-opencode-bg-layer-01": "#282923",
      "--mf-surface-shell": "var(--mf-opencode-bg-deep)",
      "--mf-surface-composer": "var(--mf-opencode-bg-layer-01)",
      "--mf-surface-composer-border": "var(--mf-shell-edge)",
    })) expect(dark).toContain(`${key}: ${value};`);
    expect(css).toMatch(/:root:not\(\[data-theme="light"\]\) \.composer,\s*:root:not\(\[data-theme="light"\]\) \.composer:hover,[^{}]*\{[^}]*background:\s*var\(--mf-surface-composer\);/);
    expect(css).toMatch(/:root:not\(\[data-theme="light"\]\) \.composer:not\(\.composer-bash-mode\),[^{}]*\{[^}]*border-color:\s*var\(--mf-surface-composer-border\) !important;/);
  });
  it("uses a single shared OpenCode wallpaper layer above the composer and header", () => {
    expect(css).toMatch(/\.app-shell\.is-connected\s*\{[^}]*background-image:\s*none;/);
    expect(css).toMatch(/\.app-shell\.is-connected\.background-enabled:not\(\.background-disabled\)::after\s*\{/);
    expect(css).toMatch(/\.app-shell\.is-connected\.background-enabled:not\(\.background-disabled\)::after\s*\{[^}]*z-index:\s*5000;[^}]*opacity:\s*var\(--mf-wallpaper-overlay-opacity, 0\);/);
    expect(css).not.toContain("wallpaper-overlay-enabled");
  });
  it("reuses inset panel geometry, lifts the settings header, and clips card contents", () => {
    expect(css).toMatch(/\.chat-pane,\s*\.settings-main,\s*html\[data-theme="light"\] \.chat-pane\s*\{/);
    expect(css).toMatch(/\.chat-header,\s*\.settings-main-titlebar,\s*html\[data-theme="light"\] \.chat-header\s*\{/);
    expect(css).toMatch(/\.settings-sidebar-row\.active\s*\{[^}]*background:\s*var\(--selected\);/);
    expect(css).toMatch(/\.settings-panel\s*\{[^}]*overflow:\s*hidden;/);
  });
});
