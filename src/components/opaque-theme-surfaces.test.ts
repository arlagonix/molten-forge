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
    // The Settings main pane shares the full-height workspace tint with chat
    // (see docs/appearance.md), so its contract is the shared tint token rather
    // than the generic strong glass surface.
    expect(css).toMatch(/\.settings-main\s*\{[^}]*background:\s*var\(--app-settings-tint\);/);
    expect(css).toMatch(/--app-workspace-tint:\s*var\(--app-settings-tint\);/);
    expect(lightRoot).toMatch(/--app-settings-tint:\s*oklch\(from var\(--background\) l c h \/ \.80\);/);
    expect(css).toMatch(/\.settings-main-titlebar\s*\{[^}]*background:\s*var\(--app-chrome-tint\);/);
    expect(css).toMatch(/\.context-popover\.context-popover-portal\s*\{[^}]*background:\s*var\(--app-glass-card\);/);
  });

  it("tints both sidebars from the chat header surface so the chrome matches", () => {
    // Both full-height sidebars read the shared chrome token, which is the card
    // surface itself, so the sidebar reads as the same solid color as the chat
    // header instead of the historical bluish rgba tint.
    const darkRoot = css.match(/:root\s*\{[^}]*--app-chrome-tint:[^}]*\}/)?.[0] ?? "";
    expect(darkRoot).toContain("--app-chrome-tint:");
    expect(lightRoot).toContain("--app-chrome-tint:");
    expect(css).toMatch(/\.session-sidebar\s*\{[^}]*background:\s*var\(--app-chrome-tint\);/);
    expect(css).toMatch(/\.settings-sidebar\s*\{[^}]*background:\s*var\(--app-chrome-tint\);/);
  });
});

describe("unified chrome tint", () => {
  // One decision in one place: every horizontal chrome bar and both sidebars
  // read the same token, so no surface can drift back to the old bluish tint.
  const CHROME_SURFACES = [
    ".chat-header",
    ".launch-topbar",
    ".settings-main-titlebar",
    ".session-sidebar",
    ".settings-sidebar",
  ];

  /** Every declaration block declared for a bare class selector. */
  function blocksFor(selector: string): string[] {
    const blocks: string[] = [];
    let from = 0;
    for (;;) {
      const start = css.indexOf(`\n${selector} {`, from);
      if (start === -1) break;
      const open = css.indexOf("{", start);
      const close = css.indexOf("}", open);
      if (close === -1) break;
      blocks.push(css.slice(open, close));
      from = close;
    }
    return blocks;
  }

  it("defines one solid chrome surface in both themes", () => {
    const rootBlocks = [...css.matchAll(/:root\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1]);
    expect(rootBlocks.length).toBeGreaterThan(0);
    const darkChrome = rootBlocks.map((block) => block.match(/--app-chrome-tint:\s*([^;]+);/)?.[1]).filter(Boolean);
    // Chrome is the card surface itself: solid, aliased, no alpha mixing.
    expect(darkChrome).toContain("var(--app-glass-card)");
    expect(lightRoot).toMatch(/--app-chrome-tint:\s*var\(--app-glass-card\);/);
  });

  it("never makes chrome translucent again", () => {
    // The sidebars and chrome bars must read as one solid color with the chat
    // header. A color-mix with `transparent` is how they used to drift into a
    // half-transparent pane, so no chrome token may reintroduce one.
    expect(css).not.toMatch(/--app-chrome-tint:[^;]*transparent/);
    expect(css).not.toMatch(/--app-chrome-tint:\s*(?:rgba|oklch\()/);
  });

  it("applies the chrome tint to every chrome surface", () => {
    for (const selector of CHROME_SURFACES) {
      // A selector may be declared more than once; at least one block must paint
      // the shared tint, and no block may paint a competing surface.
      const blocks = blocksFor(selector);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks.some((block) => block.includes("background: var(--app-chrome-tint);"))).toBe(true);
      for (const block of blocks) {
        expect(block).not.toMatch(/background:\s*var\(--app-(?:glass-strong|glass-background|sidebar-tint)\);/);
      }
    }
  });

  it("paints no chrome surface with a translucent tint", () => {
    for (const selector of CHROME_SURFACES) {
      for (const block of blocksFor(selector)) {
        expect(block).not.toMatch(/background:\s*(?:rgba\([^)]*\.\d+\)|color-mix\([^)]*transparent\))/);
      }
    }
  });

  it("does not let theme overrides reintroduce a divergent titlebar surface", () => {
    // Light-theme overrides previously repainted the settings titlebar and the
    // launch/chat headers with a different token, which is how they drifted.
    expect(css).not.toMatch(/html\[data-theme="light"\] \.settings-main-titlebar\s*\{[^}]*background:\s*var\(--app-glass-strong\);/);
    expect(css).not.toMatch(/html\[data-theme="light"\] \.launch-topbar,\s*html\[data-theme="light"\] \.chat-header\s*\{[^}]*background:\s*var\(--app-glass-background\);/);
  });
});
