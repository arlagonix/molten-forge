import { describe, expect, it } from "vitest";
import { tailActivityPreview } from "./activity-preview";
import {
  THINKING_PREVIEW_INTERVAL_MS,
  cleanThinkingPreviewLine,
  displayedThinkingPreview,
  firstThinkingPreviewLine,
  lastThinkingPreviewLine,
  nextSampledThinkingLine,
  rollingThinkingPreview,
} from "./thinking-preview";

describe("collapsed thinking preview", () => {
  it("samples the live train twenty times per second", () => {
    expect(THINKING_PREVIEW_INTERVAL_MS).toBe(50);
  });

  it("strips common Markdown markers from compact rows", () => {
    expect(cleanThinkingPreviewLine("  **Useful thought**  ")).toBe("Useful thought");
    expect(cleanThinkingPreviewLine("### Heading")).toBe("Heading");
    expect(cleanThinkingPreviewLine("- item")).toBe("item");
    expect(cleanThinkingPreviewLine("1. step")).toBe("step");
  });

  it("finds the first non-empty cleaned row", () => {
    expect(firstThinkingPreviewLine("\n\n**First**\nSecond")).toBe("First");
  });

  it("finds the latest non-empty cleaned row while streaming", () => {
    expect(lastThinkingPreviewLine("First\n\n- Second\n**Latest**\n")).toBe("Latest");
  });

  it("returns an empty preview for whitespace/Markdown-only content", () => {
    expect(firstThinkingPreviewLine("\n***\n```\n")).toBe("");
    expect(lastThinkingPreviewLine("\n***\n```\n")).toBe("");
  });

  it("concatenates recent thinking rows without a literal ellipsis", () => {
    expect(rollingThinkingPreview("First thought\nSecond thought\nCurrent", 200)).toBe("First thought · Second thought · Current");
  });

  it("shows the sampled latest row while thinking is in progress", () => {
    expect(displayedThinkingPreview({ running: true, firstLine: "First", sampledLastLine: "Current" })).toBe("Current");
  });

  it("can show the tail of a long current row while thinking is active", () => {
    expect(tailActivityPreview("prefix-abcdefghijklmnopqrstuvwxyz", 10)).toBe("…rstuvwxyz");
  });

  it("switches to the first row immediately after thinking completes", () => {
    expect(displayedThinkingPreview({ running: false, firstLine: "First", sampledLastLine: "Last" })).toBe("First");
  });

  it("updates the sampled row only when the latest row changed", () => {
    const same = "Same";
    expect(nextSampledThinkingLine(same, same)).toBe(same);
    expect(nextSampledThinkingLine("Old", "New")).toBe("New");
  });
});

describe("thinking preview edge cases", () => {
  it("cleans blockquotes, numbered lists, and fenced-looking markers consistently", () => {
    expect(cleanThinkingPreviewLine("> quoted thought")).toBe("quoted thought");
    expect(cleanThinkingPreviewLine("12) numbered thought")).toBe("numbered thought");
    expect(cleanThinkingPreviewLine("`inline thought`")).toBe("inline thought");
  });

  it("keeps prose punctuation rather than over-cleaning content", () => {
    expect(cleanThinkingPreviewLine("- Is this correct? yes.")).toBe("Is this correct? yes.");
  });

  it("returns the first completed row even when the last streamed row is newer", () => {
    const content = "Plan the change\nInspect files\nRun tests";
    expect(displayedThinkingPreview({
      running: false,
      firstLine: firstThinkingPreviewLine(content),
      sampledLastLine: lastThinkingPreviewLine(content),
    })).toBe("Plan the change");
  });

  it("allows an empty completed preview when thinking never produced useful prose", () => {
    expect(displayedThinkingPreview({ running: false, firstLine: "", sampledLastLine: "Transient" })).toBe("");
  });
});
