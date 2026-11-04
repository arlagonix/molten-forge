import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
const session = readFileSync(fileURLToPath(new URL("../core/session-history.ts", import.meta.url)), "utf8");

describe("OpenCode-inspired polish", () => {
  it("keeps only the outer project hover surface", () => {
    expect(css).toMatch(/\.project-session-heading \.project-session-activate:hover[\s\S]*?background: transparent !important;/);
    expect(css).toContain(".project-session-heading:hover { background: var(--hover);");
  });
  it("uses the same typography for Steer and the model trigger", () => {
    expect(css).toMatch(/\.composer-delivery-trigger,[\s\S]*?\.composer-model\.model-switcher-trigger,[\s\S]*?font-size: 12px;[\s\S]*?font-weight: 400;/);
  });
  it("has a shimmer whose visible endpoints match", () => {
    expect(css).toContain("background-size: 350% 100%");
    expect(css).toContain("@keyframes mf-working-shimmer-seamless");
    expect(css).toContain("from { background-position: 0% center; }");
    expect(css).toContain("to { background-position: 100% center; }");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
  it("reveals message metadata on hover or keyboard focus without shifting layout", () => {
    expect(css).toMatch(/\.message-metadata \{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/);
    expect(css).toContain(".message:hover .message-metadata,");
    expect(css).toContain(".message:focus-within .message-metadata {");
    expect(css).toContain("@media (hover: none)");
    expect(app).toContain('className="message-metadata-separator" aria-hidden="true">·</span>');
    expect(app).toContain("modelName && readableDate &&");
  });
  it("resets Copy feedback to the original icon after 1.5s and clears its timer", () => {
    const metadata = app.slice(app.indexOf("function MessageMetadata("), app.indexOf("function Transcript(", app.indexOf("function MessageMetadata(")));
    expect(metadata).toContain('showCopyFeedback("copied")');
    expect(metadata).toContain('showCopyFeedback("failed")');
    expect(metadata).toContain('setCopyStatus("idle");');
    expect(metadata).toMatch(/window\.setTimeout\(\(\) => \{[\s\S]*?setCopyStatus\("idle"\);[\s\S]*?\}, 1500\)/);
    expect(metadata).toContain("window.clearTimeout(copyFeedbackTimerRef.current)");
  });
  it("exposes actual Pi-backed Fork and local Copy without pretending to have rewind", () => {
    expect(session).toContain("__mfEntryId: entry.id");
    expect(app).toContain('type: "fork", entryId');
    expect(app).toContain("navigator.clipboard.writeText(item.text)");
    expect(app).toContain("<MessageMetadata item={item}");
    expect(app).not.toContain('type: "rewind"');
  });
});
