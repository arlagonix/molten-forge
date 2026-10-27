import { describe, expect, it } from "vitest";
import { contextEstimateAfterCompaction, resolveContextUsage } from "./context-usage";

describe("context usage", () => {
  it("uses authoritative Pi context usage when available", () => {
    expect(resolveContextUsage({ tokens: 60_000, contextWindow: 200_000, percent: 30 }, 128_000, 32_000)).toEqual({
      tokens: 60_000,
      contextWindow: 200_000,
      percent: 30,
      estimated: false,
    });
  });

  it("uses the post-compaction estimate while Pi reports null tokens", () => {
    expect(resolveContextUsage({ tokens: null, contextWindow: 200_000, percent: null }, 128_000, 32_000)).toEqual({
      tokens: 32_000,
      contextWindow: 200_000,
      percent: 16,
      estimated: true,
    });
  });

  it("falls back to the model context window when stats omit it", () => {
    expect(resolveContextUsage({ tokens: null, percent: null }, 128_000, 16_000)).toMatchObject({
      tokens: 16_000,
      contextWindow: 128_000,
      percent: 12.5,
      estimated: true,
    });
  });

  it("keeps a real zero authoritative instead of replacing it with an estimate", () => {
    expect(resolveContextUsage({ tokens: 0, contextWindow: 100_000, percent: 0 }, 100_000, 30_000)).toEqual({
      tokens: 0,
      contextWindow: 100_000,
      percent: 0,
      estimated: false,
    });
  });

  it("reports unknown instead of a false zero when neither Pi nor compaction has a value", () => {
    expect(resolveContextUsage({ tokens: null, contextWindow: 100_000, percent: null }, 100_000, null)).toEqual({
      tokens: null,
      contextWindow: 100_000,
      percent: null,
      estimated: false,
    });
  });

  it("extracts Pi's estimatedTokensAfter from successful compaction results", () => {
    expect(contextEstimateAfterCompaction({ estimatedTokensAfter: 31_234 })).toBe(31_234);
  });

  it("accepts zero as a valid compaction estimate", () => {
    expect(contextEstimateAfterCompaction({ estimatedTokensAfter: 0 })).toBe(0);
  });

  it.each([null, {}, { estimatedTokensAfter: -1 }, { estimatedTokensAfter: "32000" }])(
    "rejects malformed compaction estimates %#",
    (value) => expect(contextEstimateAfterCompaction(value)).toBeNull(),
  );
});
