import { describe, expect, it } from "vitest";
import {
  AUTO_FOLLOW_RESUME_THRESHOLD_PX,
  MANUAL_SCROLL_INPUT_MS,
  PROGRAMMATIC_SCROLL_GUARD_MS,
  STICKY_SCROLL_LERP,
  TOUCH_SCROLL_INPUT_MS,
  chatDistanceFromBottom,
  historyLandingPosition,
  keyboardActivatesReaderLayoutInteraction,
  keyboardMarksManualScroll,
  keyboardStopsAutoFollow,
  nextStickyScrollTop,
  pointerMarksManualScroll,
  readerScrollTopForAnchor,
  shouldResumeAutoFollow,
  shouldResumeAutoFollowFromManualScroll,
  shouldShowScrollToBottomButton,
  stickyScrollReachedTarget,
  stickyScrollTarget,
} from "./chat-autoscroll";

describe("old Molten Forge lerp auto-follow geometry", () => {
  it("targets the maximum legal scrollTop", () => {
    expect(stickyScrollTarget({ scrollHeight: 1500, scrollTop: 200, clientHeight: 600 })).toBe(900);
  });

  it("keeps the mature Electron lerp coefficient", () => {
    expect(STICKY_SCROLL_LERP).toBe(0.12);
    expect(PROGRAMMATIC_SCROLL_GUARD_MS).toBe(200);
  });

  it("eases downward toward the current moving bottom", () => {
    expect(nextStickyScrollTop(100, 300)).toBeCloseTo(124);
    expect(nextStickyScrollTop(299.7, 300)).toBe(300);
  });

  it("never adds an explicit upward write when real layout contracts", () => {
    expect(nextStickyScrollTop(500, 420)).toBe(500);
  });

  it("detects when the lerp has settled at the target", () => {
    expect(stickyScrollReachedTarget(499.6, 500)).toBe(true);
    expect(stickyScrollReachedTarget(490, 500)).toBe(false);
  });
});

describe("manual follow ownership", () => {
  it("only resumes once the reader actually reaches the bottom", () => {
    expect(AUTO_FOLLOW_RESUME_THRESHOLD_PX).toBe(2);
    expect(shouldResumeAutoFollow(2)).toBe(true);
    expect(shouldResumeAutoFollow(2.1)).toBe(false);
    expect(shouldResumeAutoFollow(80)).toBe(false);
  });

  it.each(["ArrowUp", "PageUp", "Home"])("treats %s as reader intent", (key) => {
    expect(keyboardStopsAutoFollow(key)).toBe(true);
  });

  it.each(["ArrowDown", "PageDown", "End", "Enter"])("does not stop follow for %s", (key) => {
    expect(keyboardStopsAutoFollow(key)).toBe(false);
  });

  it.each(["ArrowUp", "PageUp", "Home", "ArrowDown", "PageDown", "End", " "])("marks %j as manual scroll input", (key) => {
    expect(keyboardMarksManualScroll(key)).toBe(true);
  });

  it.each(["Enter", " "])("treats %j as keyboard activation for a layout control", (key) => {
    expect(keyboardActivatesReaderLayoutInteraction(key)).toBe(true);
  });

  it("keeps short manual-input windows only for recognizing a deliberate return to bottom", () => {
    expect(MANUAL_SCROLL_INPUT_MS).toBeGreaterThan(0);
    expect(TOUCH_SCROLL_INPUT_MS).toBeGreaterThan(MANUAL_SCROLL_INPUT_MS);
  });
});


describe("manual follow re-arm guards", () => {
  it("does not re-arm follow from an upward gesture that remains near bottom", () => {
    expect(shouldResumeAutoFollowFromManualScroll({
      previousScrollTop: 1000,
      currentScrollTop: 999,
      distanceFromBottom: 1,
    })).toBe(false);
  });

  it("re-arms only after a downward manual movement reaches the real bottom", () => {
    expect(shouldResumeAutoFollowFromManualScroll({
      previousScrollTop: 990,
      currentScrollTop: 999,
      distanceFromBottom: 1,
    })).toBe(true);
    expect(shouldResumeAutoFollowFromManualScroll({
      previousScrollTop: 990,
      currentScrollTop: 995,
      distanceFromBottom: 5,
    })).toBe(false);
  });
});

describe("scroll-to-bottom affordance", () => {
  it("stays hidden for small bottom offsets and appears once meaningfully away", () => {
    expect(shouldShowScrollToBottomButton(30)).toBe(false);
    expect(shouldShowScrollToBottomButton(119)).toBe(false);
    expect(shouldShowScrollToBottomButton(120)).toBe(true);
  });
});

describe("reader anchor correction", () => {
  it("keeps the viewport still inside the settle epsilon", () => {
    expect(readerScrollTopForAnchor({
      scrollTop: 500,
      maxScrollTop: 1500,
      currentViewportOffset: 8.3,
      desiredViewportOffset: 8,
    })).toBe(500);
  });

  it("preserves the same visual anchor through one final layout flush", () => {
    expect(readerScrollTopForAnchor({
      scrollTop: 500,
      maxScrollTop: 1500,
      currentViewportOffset: 38,
      desiredViewportOffset: 8,
    })).toBe(530);
  });

  it("clamps correction to the legal scroll range", () => {
    expect(readerScrollTopForAnchor({
      scrollTop: 4,
      maxScrollTop: 1500,
      currentViewportOffset: -20,
      desiredViewportOffset: 8,
    })).toBe(0);
    expect(readerScrollTopForAnchor({
      scrollTop: 1495,
      maxScrollTop: 1500,
      currentViewportOffset: 40,
      desiredViewportOffset: 8,
    })).toBe(1500);
  });
});

describe("manual input detection", () => {
  it("marks touch and pen drags as manual scroll input", () => {
    expect(pointerMarksManualScroll("touch", 10, 100, 100, 90)).toBe(true);
    expect(pointerMarksManualScroll("pen", 10, 100, 100, 90)).toBe(true);
  });

  it("recognizes pointer-down in the native scrollbar gutter", () => {
    expect(pointerMarksManualScroll("mouse", 193, 200, 200, 184)).toBe(true);
  });

  it("does not mark ordinary mouse clicks in transcript content", () => {
    expect(pointerMarksManualScroll("mouse", 120, 200, 200, 184)).toBe(false);
  });
});

describe("history landing", () => {
  it("keeps an empty session at the top", () => {
    expect(historyLandingPosition(0)).toBe("top");
  });

  it("lands populated history at the latest content", () => {
    expect(historyLandingPosition(1)).toBe("bottom");
    expect(historyLandingPosition(250)).toBe("bottom");
  });
});

describe("bottom distance", () => {
  it("clamps negative distance to zero", () => {
    expect(chatDistanceFromBottom({ scrollHeight: 400, scrollTop: 10, clientHeight: 500 })).toBe(0);
  });
});
