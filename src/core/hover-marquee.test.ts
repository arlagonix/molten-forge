import { describe, expect, it } from "vitest";
import { hoverMarqueeMetrics } from "./hover-marquee";

describe("hoverMarqueeMetrics", () => {
  it("keeps fitting labels stationary", () => {
    expect(hoverMarqueeMetrics(180, 220)).toEqual({ distancePx: 0, durationSeconds: 0 });
    expect(hoverMarqueeMetrics(220, 220)).toEqual({ distancePx: 0, durationSeconds: 0 });
  });

  it("travels exactly the hidden overflow distance", () => {
    expect(hoverMarqueeMetrics(360.2, 220.8).distancePx).toBe(140);
  });

  it("scales duration with distance and caps very long paths", () => {
    expect(hoverMarqueeMetrics(252, 220).durationSeconds).toBe(7);
    expect(hoverMarqueeMetrics(540, 220).durationSeconds).toBe(14);
    expect(hoverMarqueeMetrics(2000, 220).durationSeconds).toBe(14);
  });

  it("normalizes invalid dimensions safely", () => {
    expect(hoverMarqueeMetrics(Number.NaN, 100)).toEqual({ distancePx: 0, durationSeconds: 0 });
    expect(hoverMarqueeMetrics(100, -20).distancePx).toBe(100);
  });
});
