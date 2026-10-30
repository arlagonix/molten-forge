import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPiDeltaCoalescer } from "./pi-delta-coalescer";

const delta = (kind: "text_delta" | "thinking_delta", value: string, contentIndex = 0) => ({
  type: "message_update",
  assistantMessageEvent: { type: kind, contentIndex, delta: value },
});

const boundary = (kind: string) => ({ type: "message_update", assistantMessageEvent: { type: kind, contentIndex: 0 } });

describe("Pi streaming delta coalescer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("delivers consecutive text deltas as one update within 50ms without losing bytes", () => {
    const emitted: unknown[] = [];
    const queue = createPiDeltaCoalescer((record) => emitted.push(record));
    for (let i = 0; i < 100; i++) queue.push(delta("text_delta", String(i) + " "));
    vi.advanceTimersByTime(49);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual([delta("text_delta", Array.from({ length: 100 }, (_, i) => `${i} `).join(""))]);
    queue.dispose();
  });

  it("flushes pending delta before any non-delta RPC event, preserving temporal order", () => {
    const emitted: unknown[] = [];
    const queue = createPiDeltaCoalescer((record) => emitted.push(record));
    const ended = boundary("text_end");
    const settled = { type: "agent_settled" };
    queue.push(delta("text_delta", "hello"));
    queue.push(delta("text_delta", " world"));
    queue.push(ended);
    queue.push(settled);
    expect(emitted).toEqual([delta("text_delta", "hello world"), ended, settled]);
    vi.runAllTimers();
    expect(emitted).toHaveLength(3);
    queue.dispose();
  });

  it("does not combine thinking with text, different content indexes, or turns", () => {
    const emitted: unknown[] = [];
    const queue = createPiDeltaCoalescer((record) => emitted.push(record));
    queue.push(delta("thinking_delta", "think"));
    queue.push(delta("thinking_delta", " more"));
    queue.push(delta("text_delta", "answer"));
    queue.push(delta("text_delta", "other index", 1));
    queue.push({ type: "message_end", message: { role: "assistant" } });
    expect(emitted).toEqual([
      delta("thinking_delta", "think more"),
      delta("text_delta", "answer"),
      delta("text_delta", "other index", 1),
      { type: "message_end", message: { role: "assistant" } },
    ]);
    queue.dispose();
  });

  it("does not merge deltas that belong to different messages or carry different metadata", () => {
    const emitted: unknown[] = [];
    const queue = createPiDeltaCoalescer((record) => emitted.push(record));
    queue.push({ ...delta("text_delta", "old"), message: { id: "one" } });
    queue.push({ ...delta("text_delta", "new"), message: { id: "two" } });
    queue.flush();
    expect(emitted).toHaveLength(2);
    queue.dispose();
  });

  it("drops buffered updates and timer on teardown", () => {
    const emitted: unknown[] = [];
    const queue = createPiDeltaCoalescer((record) => emitted.push(record));
    queue.push(delta("thinking_delta", "partial"));
    queue.dispose();
    vi.runAllTimers();
    expect(emitted).toEqual([]);
  });

  it("dispatches other events immediately when no delta is pending", () => {
    const emitted: unknown[] = [];
    const queue = createPiDeltaCoalescer((record) => emitted.push(record));
    const status = { type: "queue_update", steering: ["x"], followUp: [] };
    queue.push(status);
    expect(emitted).toEqual([status]);
    queue.dispose();
  });
});
