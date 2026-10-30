import { describe, expect, it } from "vitest";
import {
  latestForkCandidate,
  mergeRecoveredPrompt,
  mergeRestoredQueuedText,
  queuedTextFromClearQueue,
  runtimeStateAfterInterrupt,
  unmatchedToolCallIds,
} from "./interruption-lifecycle";

describe("Pi interruption lifecycle", () => {
  it("restores steering before follow-up messages", () => expect(queuedTextFromClearQueue({ steering: [" steer "], followUp: ["later"] })).toEqual(["steer", "later"]));
  it("ignores malformed queue values", () => expect(queuedTextFromClearQueue({ steering: [null, "ok"], followUp: 4 })).toEqual(["ok"]));
  it("prepends restored queue text before an existing draft", () => expect(mergeRestoredQueuedText("draft", ["one", "two"])).toBe("one\n\ntwo\n\ndraft"));
  it("reports compaction as busy after abort", () => expect(runtimeStateAfterInterrupt({ isCompacting: true })).toEqual({ busy: true, isCompacting: true, status: "Stopping compaction…" }));
  it("reports pending queue as stopping", () => expect(runtimeStateAfterInterrupt({ pendingMessageCount: 1 })).toEqual({ busy: true, isCompacting: false, status: "Stopping" }));
  it("reports a settled runtime as idle", () => expect(runtimeStateAfterInterrupt({ isStreaming: false, pendingMessageCount: 0 })).toEqual({ busy: false, isCompacting: false, status: null }));
  it("detects an assistant tool call without a result", () => expect(unmatchedToolCallIds([{ role: "assistant", content: [{ type: "toolCall", id: "call-1" }] }])).toEqual(["call-1"]));
  it("removes a tool call after its matching result", () => expect(unmatchedToolCallIds([{ role: "assistant", content: [{ type: "toolCall", id: "call-1" }] }, { role: "toolResult", toolCallId: "call-1" }])).toEqual([]));
  it("tracks multiple independent tool calls", () => expect(unmatchedToolCallIds([{ role: "assistant", content: [{ type: "toolCall", id: "a" }, { type: "toolCall", id: "b" }] }, { role: "toolResult", toolCallId: "a" }])).toEqual(["b"]));
  it("picks the latest usable fork candidate", () => expect(latestForkCandidate({ messages: [{ entryId: "a", text: "old" }, { entryId: "b", text: "new" }] })).toEqual({ entryId: "b", text: "new" }));
  it("ignores unusable fork candidates", () => expect(latestForkCandidate({ messages: [{ entryId: "", text: "x" }] })).toBeNull());
  it("restores an interrupted prompt into an empty draft", () => expect(mergeRecoveredPrompt("", "continue me")).toBe("continue me"));
  it("does not duplicate the same recovered prompt", () => expect(mergeRecoveredPrompt("continue me", "continue me")).toBe("continue me"));
  it("preserves an existing draft after recovered text", () => expect(mergeRecoveredPrompt("extra", "continue me")).toBe("continue me\n\nextra"));
});
