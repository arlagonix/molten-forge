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
  it("clips the Working/Composing highlight to text without a WebView2 gradient layer", () => {
    const statusStart = css.indexOf("/* Animate a clipped text-only highlight");
    const statusEnd = css.indexOf("/* The outer composer must not paint", statusStart);
    const shimmer = css.slice(statusStart, statusEnd);
    expect(shimmer).toContain("background: none;");
    expect(shimmer).toContain("-webkit-text-fill-color: currentColor;");
    expect(shimmer).toContain("clip-path: inset(0 100% 0 0);");
    expect(shimmer).toContain("animation: mf-working-highlight-sweep 1.8s linear infinite;");
    expect(shimmer).toContain("0%   { clip-path: inset(0 100% 0 0); }");
    expect(shimmer).toContain("100% { clip-path: inset(0 0 0 100%); }");
    expect(shimmer).toContain("prefers-reduced-motion: reduce");
    expect(shimmer).not.toMatch(/^\s*(?:-webkit-)?background-clip:\s*text;/m);
    expect(shimmer).not.toContain("background-position:");
    expect(css).not.toContain("mf-working-shimmer-seamless");
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

describe("single final assistant metadata row", () => {
  it("reserves metadata space only under the last assistant text of a completed turn", () => {
    expect(app).toContain('const lastAssistantId = !suppressAssistantMetadata ? finalAssistantMessage(turn)?.id : undefined;');
    expect(app).toContain('showAssistantMetadata={group.item.id === lastAssistantId}');
    expect(app).toContain('showAssistantMetadata && <MessageMetadata item={item} durationMs={assistantDurationMs} />');
    expect(app).toContain('suppressAssistantMetadata={isStreaming && virtualItem.index === turns.length - 1}');
  });

  it("reads persisted Pi model duration from both history and live message_end", () => {
    expect(app).toContain('modelDurationMs: validPiModelDurationMs(message.durationMs)');
    expect(app).toContain('modelDurationMs: validPiModelDurationMs(record.message?.durationMs)');
    expect(app).toContain('completedAt: message.timestamp ?? message.__mfEntryTimestamp');
  });

  it("measures Pi's settled generation duration, including tool calls, instead of every intermediate message", () => {
    expect(app).toContain('agentRunStartedAtRef.current = performance.now()');
    expect(app).toContain('withFinalAssistantDuration(current, durationMs)');
    expect(app).toContain('title="Pi response time, including tool calls"');
    expect(app).toContain('turnResponseDurationMs(turn)');
  });
});
