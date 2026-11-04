import { describe, expect, it } from "vitest";
import { chatContentGeometry, chatResizeMarkerY } from "./chat-content-geometry";

describe("shared chat content geometry", () => {
  it("captures a transcript column shifted left by a native scrollbar gutter", () => {
    expect(chatContentGeometry(100, 1000, 147, 900)).toEqual({
      width: 900,
      centerOffset: -3,
    });
  });

  it("reports zero offset when the transcript is physically centered", () => {
    expect(chatContentGeometry(100, 1000, 150, 900)).toEqual({
      width: 900,
      centerOffset: 0,
    });
  });

  it("sanitizes invalid measurements instead of emitting NaN CSS values", () => {
    expect(chatContentGeometry(Number.NaN, Number.NaN, Number.NaN, -20)).toEqual({
      width: 0,
      centerOffset: 0,
    });
  });
});


describe("chat resize marker alignment", () => {
  it("centers the marker on the pointer using the rendered guide top, not an old titlebar offset", () => {
    expect(chatResizeMarkerY(200, 111, 400)).toBe(89);
    expect(chatResizeMarkerY(200, 152, 400)).toBe(48);
  });

  it("clamps at the guide bounds so the 42px marker remains visible", () => {
    expect(chatResizeMarkerY(10, 100, 400)).toBe(18);
    expect(chatResizeMarkerY(1000, 100, 400)).toBe(382);
    expect(chatResizeMarkerY(200, 100, 20)).toBe(10);
  });
});
