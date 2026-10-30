import { describe, expect, it } from "vitest";
import { chatContentGeometry } from "./chat-content-geometry";

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
