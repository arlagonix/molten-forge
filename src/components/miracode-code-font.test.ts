import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const load = (relativePath: string) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
const css = load("../styles.css");
const viewer = load("./code-viewer.tsx");
const diff = load("./tool-diff-viewer.tsx");

describe("selected Miracode font propagates through code surfaces", () => {
  it("keeps JetBrains Mono as the default code font for Sans and Mono", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--app-font-code:\s*var\(--app-font-mono\)/);
    expect(css).toMatch(/html\[data-app-font="mono"\]\s*\{\s*--app-font-family:\s*var\(--app-font-mono\)/);
  });

  it("selects Miracode for both application and code when requested", () => {
    expect(css).toMatch(/html\[data-app-font="miracode"\]\s*\{[^}]*--app-font-family:\s*var\(--app-font-miracode\);[^}]*--app-font-code:\s*var\(--app-font-miracode\);/);
    expect(css).toMatch(/code, pre\s*\{\s*font-family:\s*var\(--app-font-code\)/);
    expect(css).not.toMatch(/(?:^|[;{\n])\s*font-family:\s*var\(--app-font-mono\);/);
  });

  it("references exactly the upstream regular vector face, not missing weights", () => {
    expect(css).toContain('/fonts/Miracode.ttf');
    expect(css).not.toContain('Miracode-SemiBold.ttf');
    expect(css).not.toContain('Miracode-Bold.ttf');
    expect(css).toMatch(/html\[data-app-font="miracode"\]\s*\{[^}]*font-synthesis:\s*weight style;/);
  });

  it("uses the selectable code font in the regular CodeMirror and diff CodeMirror", () => {
    for (const source of [viewer, diff]) {
      expect(source).toMatch(/\.cm-scroller["']:\s*\{[^}]*fontFamily:\s*["']var\(--app-font-code\)["']/);
      expect(source).not.toContain('fontFamily: \'"JetBrains Mono"');
    }
  });
});
