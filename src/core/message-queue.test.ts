import { describe, expect, it } from "vitest";
import { composerFadeInset, composerOverlayClearance, createPiUserMessageDelivery, normalizePiQueue, sendBehavior, textareaHeightLimit } from "./message-queue";

describe("Pi message queue", () => {
  it("treats each queue_update as a complete snapshot", () => {
    expect(normalizePiQueue({ steering: ["A", null, "B"], followUp: ["C"] })).toEqual({ steering: ["A", "B"], followUp: ["C"] });
    expect(normalizePiQueue({ steering: [], followUp: [] })).toEqual({ steering: [], followUp: [] });
  });
  it("uses the chosen delivery mode only while generating", () => {
    expect(sendBehavior(false, "followUp")).toBeUndefined();
    expect(sendBehavior(true, "steer")).toBe("steer");
    expect(sendBehavior(true, "followUp")).toBe("followUp");
  });
  it("renders delivered steering and follow-up messages, but not a second copy of the initial prompt", () => {
    const visibility = createPiUserMessageDelivery();
    visibility.noteLocallyRenderedPrompt();
    expect(visibility.shouldAppendDeliveredMessage()).toBe(false); // Pi echoes the initial prompt
    expect(visibility.shouldAppendDeliveredMessage()).toBe(true); // steer delivered by Pi
    expect(visibility.shouldAppendDeliveredMessage()).toBe(true); // follow-up delivered by Pi
  });
  it("preserves identical queued message texts as distinct delivered user turns", () => {
    const visibility = createPiUserMessageDelivery();
    visibility.noteLocallyRenderedPrompt();
    expect(visibility.shouldAppendDeliveredMessage()).toBe(false);
    expect(visibility.shouldAppendDeliveredMessage()).toBe(true);
    expect(visibility.shouldAppendDeliveredMessage()).toBe(true);
  });
  it("does not suppress a later queued message after a stopped or intercepted prompt", () => {
    const visibility = createPiUserMessageDelivery();
    visibility.noteLocallyRenderedPrompt();
    visibility.reset();
    expect(visibility.shouldAppendDeliveredMessage()).toBe(true);
  });
  it("reserves actual overlap and reflows after window size changes", () => {
    expect(composerOverlayClearance(800, 500)).toBe(316);
    expect(composerOverlayClearance(800, 740)).toBe(190);
    expect(composerOverlayClearance(520, 240)).toBe(296);
  });
  it("positions the fade at the actual composer top even when the clearance minimum dominates", () => {
    expect(composerFadeInset(800, 680)).toBe(120);
    expect(composerOverlayClearance(800, 680)).toBe(190); // not the same number
    expect(composerFadeInset(800, 500)).toBe(300);
    expect(composerFadeInset(520, 580)).toBe(0);
  });
  it("caps input growth in a short chat pane", () => {
    expect(textareaHeightLimit(480, 24, 13, 13)).toBeLessThanOrEqual(168);
    expect(textareaHeightLimit(1200, 24, 13, 13)).toBe(290);
  });
});
