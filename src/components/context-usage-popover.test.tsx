import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextUsagePanel, ContextUsagePopover, type ContextUsageDetails } from "./context-usage-popover";

const details: ContextUsageDetails = {
  inputTokens: 2_800_000,
  outputTokens: 239_000,
  cachedTokens: 76_000_000,
  cacheHitPercent: 97,
  usedTokens: 97_200,
  contextLimit: 262_000,
  contextPercent: 37.1,
  estimated: false,
  systemPromptTokens: 8_200,
  toolDefinitionTokens: 17_600,
  messageTokens: 71_400,
  breakdownEstimated: true,
};

describe("ContextUsagePopover", () => {
  it("renders context percent as its own compact header item", () => {
    const html = renderToStaticMarkup(<ContextUsagePopover variant="header" details={details} />);
    expect(html).toContain('class="token-stat token-stat-input">↓2.8M</span>');
    expect(html).toContain('class="token-stat token-stat-output">↑239k</span>');
    expect(html).toContain('class="token-stat token-stat-cache" title="Cached input tokens">C76M</span>');
    expect(html).toContain('class="token-stat token-stat-hit" title="Cache hit = cached / (input + cached)">H97%</span>');
    expect(html).toContain('class="token-stat token-stat-context">97.2k/262k</span>');
    expect(html).toContain('class="token-stat token-stat-context-percent">37%</span>');
    expect(html).not.toContain("97.2k/262k · 37%");
  });

  it("reuses the same component for the compact ring trigger", () => {
    const html = renderToStaticMarkup(<ContextUsagePopover variant="ring" details={details} />);
    expect(html).toContain("context-button");
    expect(html).toContain("context-ring-core");
    expect(html).toContain("37.1%");
  });

  it("renders the agreed usage fields", () => {
    const html = renderToStaticMarkup(<ContextUsagePanel details={details} />);
    for (const label of ["Input", "Cached", "Cache hit", "Output"]) expect(html).toContain(`>${label}<`);
    expect(html).toContain(">2.8M<");
    expect(html).toContain(">76M<");
    expect(html).toContain(">97%<");
    expect(html).toContain(">239K<");
    expect(html).toContain('class="context-usage-value-input"');
    expect(html).toContain('class="context-usage-value-cache"');
    expect(html).toContain('class="context-usage-value-hit"');
    expect(html).toContain('class="context-usage-value-output"');
  });

  it("renders current context used, limit, remaining, and percent", () => {
    const html = renderToStaticMarkup(<ContextUsagePanel details={details} />);
    for (const label of ["Used", "Limit", "Remaining", "Used %"]) expect(html).toContain(`>${label}<`);
    expect(html).toContain("164.8K remaining");
  });

  it("renders the current context breakdown without KV cache", () => {
    const html = renderToStaticMarkup(<ContextUsagePanel details={details} />);
    expect(html).toContain("System / instructions");
    expect(html).toContain("Tool definitions");
    expect(html).toContain("Messages");
    expect(html).toContain("Estimated");
    expect(html).not.toContain("KV cache");
  });

  it("keeps estimated context visually calm without a tilde", () => {
    const html = renderToStaticMarkup(<ContextUsagePanel details={{ ...details, estimated: true }} />);
    expect(html).toContain("Estimated");
    expect(html).not.toContain("~97.2K");
  });

  it("shows unknown values without inventing zero context usage", () => {
    const unknown = { ...details, usedTokens: null, contextPercent: null };
    const header = renderToStaticMarkup(<ContextUsagePopover variant="header" details={unknown} />);
    const panel = renderToStaticMarkup(<ContextUsagePanel details={unknown} />);
    expect(header).toContain('class="token-stat token-stat-context">?/262k</span>');
    expect(header).toContain('class="token-stat token-stat-context-percent">?</span>');
    expect(panel).toContain("— remaining");
  });
  it("keeps the popover open state local while rendering portal chrome only when opened", () => {
    const source = readFileSync(fileURLToPath(new URL("./context-usage-popover.tsx", import.meta.url)), "utf8");
    expect(source).toContain('createPortal');
    expect(source).toContain('context-popover-portal');
    expect(source).toContain('document.body');
    expect(source).toContain('popoverRef.current?.contains(target)');
  });

});
