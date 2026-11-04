import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "./chat-logic";
import { buildTranscriptTurns, groupTranscriptItems } from "./chat-logic";
import { activeSemiCompactActivity, groupCompactActivityGroups, readTimelineMode, summarizeCompactActivity, splitCompletedWork, completedWorkDisclosure, firstUnsettledTurnIndex, isUnsettledWorkTurn } from "./timeline-detail";

const tool = (id: string, title: string, state: TranscriptItem["state"] = "done", toolBatchId?: string): TranscriptItem =>
  ({ id, kind: "tool", title, state, text: "", toolBatchId });
const thought = (id: string, state: TranscriptItem["state"] = "done"): TranscriptItem =>
  ({ id, kind: "thinking", state, text: `Thinking ${id}` });
const prose = (id: string, kind: TranscriptItem["kind"] = "assistant"): TranscriptItem =>
  ({ id, kind, text: id });

it("defaults to Compact, respects Full and survives unavailable storage", () => {
  expect(readTimelineMode({ getItem: () => null }, "pref")).toBe("compact");
  expect(readTimelineMode({ getItem: () => "full" }, "pref")).toBe("full");
  expect(readTimelineMode({ getItem: () => "semi-compact" }, "pref")).toBe("semi-compact");
  expect(readTimelineMode({ getItem: () => "unexpected" }, "pref")).toBe("compact");
  expect(readTimelineMode({ getItem: () => { throw Error("denied"); } }, "pref")).toBe("compact");
});

describe("Compact summary", () => {
  it("counts each tool explicitly in first-use order, not a confusing total", () => {
    expect(summarizeCompactActivity([thought("t"), tool("a", "read"), tool("b", "write"), tool("c", "read"), tool("d", "write"), tool("e", "read")]))
      .toEqual({ label: "Used 3 Read, 2 Write", running: false, errors: 0, interrupted: 0 });
  });
  it("shows thought counts only for groups without tools", () => {
    expect(summarizeCompactActivity([thought("a")]).label).toBe("Used 1 Thought");
    expect(summarizeCompactActivity([thought("a"), thought("b")]).label).toBe("Used 2 Thoughts");
    expect(summarizeCompactActivity([thought("a", "running")]).label).toBe("Thinking");
  });
  it("keeps running, error, and interrupted states from every activity", () => {
    expect(summarizeCompactActivity([thought("a"), tool("b", "Shell", "running"), tool("c", "Edit", "error"), tool("d", "Read", "interrupted")]))
      .toEqual({ label: "Using 1 Shell, 1 Edit, 1 Read", running: true, errors: 1, interrupted: 1 });
  });
  it("ignores maintenance, never infers parallelism from adjacency", () => {
    expect(summarizeCompactActivity([
      thought("a"), { ...tool("comp", "Compact"), runtimeRole: "session-maintenance" },
      tool("b", "Read", "done", "batch1"), tool("c", "Read", "done", "batch2"),
    ]).label).toBe("Used 2 Read");
  });
});

describe("Compact presentation grouping", () => {
  const shape = (items: TranscriptItem[]) => groupCompactActivityGroups(groupTranscriptItems(items)).map((entry) =>
    entry.kind === "single" ? entry.item.id : entry.blocks.map((block) => block.map((item) => item.id)),
  );

  it("keeps one disclosure across canonical thinking phases but separate bordered blocks inside", () => {
    expect(shape([thought("a"), tool("b", "Read"), thought("c"), tool("d", "Write"), tool("e", "Write"), thought("f")]))
      .toEqual([[ ["a", "b"], ["c", "d", "e"], ["f"] ]]);
  });
  it("retains thinking with the first parallel batch and separates the second inside the same disclosure", () => {
    expect(shape([thought("t"), tool("a", "Read", "done", "p1"), tool("b", "Write", "done", "p1"),
      tool("c", "Read", "done", "p2"), tool("d", "Read", "done", "p2")]))
      .toEqual([[ ["t", "a", "b"], ["c", "d"] ]]);
  });
  it("makes three internal blocks when a sequential call separates explicit parallel batches", () => {
    expect(shape([thought("t"), tool("a", "Read", "done", "p1"), tool("b", "Read", "done", "p1"),
      tool("single", "Bash"), tool("c", "Edit", "done", "p2"), tool("d", "Edit", "done", "p2")]))
      .toEqual([[ ["t", "a", "b"], ["single"], ["c", "d"] ]]);
  });
  it("groups consecutive ordinary sequential tools in one internal block", () => {
    expect(shape([thought("t"), tool("a", "Bash"), tool("b", "Read"), tool("c", "Write")]))
      .toEqual([[ ["t", "a", "b", "c"] ]]);
  });
  it("keeps maintenance, prose, retry, user and system as boundaries", () => {
    const maintenance = { ...tool("comp", "Compact"), runtimeRole: "session-maintenance" as const };
    expect(shape([thought("a"), tool("b", "Read"), prose("reply"), thought("c"), maintenance,
      thought("d"), prose("retry", "retry"), tool("e", "Bash"), prose("user", "user"), thought("f")]))
      .toEqual([[["a", "b"]], "reply", [["c"]], "comp", [["d"]], "retry", [["e"]], "user", [["f"]]]);
  });
  it("includes failures in the aggregated top-level summary across multiple phases", () => {
    const activity = groupCompactActivityGroups(groupTranscriptItems([
      tool("a", "Bash", "error"), thought("b"), tool("c", "Read"), tool("d", "Bash", "error"),
    ]));
    expect(activity).toHaveLength(1);
    if (activity[0].kind !== "activity") throw Error("expected disclosure");
    expect(activity[0].blocks.map((block) => block.map((item) => item.id))).toEqual([["a"], ["b", "c", "d"]]);
    expect(summarizeCompactActivity(activity[0].items)).toEqual({
      label: "Used 2 Bash, 1 Read", running: false, errors: 2, interrupted: 0,
    });
  });
  it("preserves tool batch IDs and item identity through the display projection", () => {
    const items = [thought("a"), tool("b", "Bash", "done", "batch-1"), tool("c", "Bash", "done", "batch-1"), thought("d")];
    const compact = groupCompactActivityGroups(groupTranscriptItems(items));
    expect(compact).toHaveLength(1);
    if (compact[0].kind !== "activity") throw Error("expected disclosure");
    expect(compact[0].blocks[0][1]).toBe(items[1]);
    expect(compact[0].blocks[0][1].toolBatchId).toBe("batch-1");
    expect(compact[0].blocks[1][0]).toBe(items[3]);
  });
  it("keeps single thinking-only activity and a one-tool batch as distinct runtime blocks", () => {
    expect(shape([thought("a"), thought("b"), tool("c", "Read", "done", "p1"), thought("d"), tool("e", "Read")]))
      .toEqual([[["a", "b", "c"], ["d", "e"]]]);
  });
});


describe("Semi Compact live activity frontier", () => {
  const activity = (items: TranscriptItem[], streaming = true) =>
    activeSemiCompactActivity(buildTranscriptTurns(items), streaming);

  it("reveals the current running thinking/tool episode", () => {
    const items = [prose("user", "user"), thought("reason", "running"), tool("bash", "Bash", "running")];
    expect(activity(items)).toEqual({ turnKey: buildTranscriptTurns(items)[0].key, groupKey: "compact-reason" });
  });

  it("keeps completed tool calls expanded between calls while Pi is still streaming", () => {
    const items = [prose("user", "user"), thought("reason"), tool("bash", "Bash", "done")];
    expect(activity(items)?.groupKey).toBe("compact-reason");
    expect(activity([...items, tool("read", "Read", "running")])?.groupKey).toBe("compact-reason");
  });

  it("collapses immediately when the assistant starts its answer or Pi settles", () => {
    const items = [prose("user", "user"), thought("reason"), tool("bash", "Bash", "done")];
    expect(activity(items, false)).toBeNull();
    expect(activity([...items, prose("answer")])).toBeNull();
  });

  it("reactivates only a new trailing episode after assistant prose", () => {
    const items = [prose("user", "user"), thought("first"), tool("one", "Bash"), prose("interim"),
      thought("second", "running"), tool("two", "Read", "running")];
    expect(activity(items)?.groupKey).toBe("compact-second");
    expect(activity([...items, prose("answer")])).toBeNull();
  });

  it("never reopens old turns when the next prompt is submitted", () => {
    const items = [prose("user1", "user"), tool("old", "Bash"), prose("answer"), prose("user2", "user")];
    expect(activity(items)).toBeNull();
    expect(activity([...items, thought("new", "running")])?.groupKey).toBe("compact-new");
  });

  it("does not reopen activity across retry, maintenance, or system boundaries", () => {
    const prefix = [prose("user", "user"), thought("reason"), tool("tool", "Bash")];
    expect(activity([...prefix, prose("retry", "retry")])).toBeNull();
    expect(activity([...prefix, { ...tool("compact", "Compact"), runtimeRole: "session-maintenance" }])).toBeNull();
    expect(activity([...prefix, prose("notice", "system")])).toBeNull();
  });

  it("handles empty and prose-only histories", () => {
    expect(activeSemiCompactActivity([], true)).toBeNull();
    expect(activity([prose("user", "user"), prose("hello")])).toBeNull();
  });
});

describe("completed work disclosure", () => {
  it("hides only earlier agent activity and preserves the final answer", () => {
    const items = [thought("t"), tool("bash", "Bash"), prose("update"), tool("read", "Read"), prose("final")];
    expect(splitCompletedWork(items)).toEqual({ earlier: items.slice(0, -1), visible: [items[4]] });
  });

  it("folds completed thinking-only and tool-only turns with no final prose", () => {
    expect(splitCompletedWork([prose("hello")])).toBeNull();
    expect(splitCompletedWork([thought("t")])).toEqual({ earlier: [thought("t")], visible: [] });
    const tools = [thought("t"), tool("bash", "Bash")];
    expect(splitCompletedWork(tools)).toEqual({ earlier: tools, visible: [] });
    const interim = [thought("t"), prose("answer"), tool("bash", "Bash")];
    expect(splitCompletedWork(interim)).toEqual({ earlier: interim, visible: [] });
  });

  it("keeps terminal failure details and the final answer outside the disclosure", () => {
    const failed = [thought("t"), tool("bash", "Bash", "error"), prose("error", "error")];
    expect(splitCompletedWork(failed)).toEqual({ earlier: failed.slice(0, -1), visible: failed.slice(-1) });
    const interrupted = [thought("t"), prose("answer"), tool("bash", "Bash", "interrupted"), prose("aborted", "error")];
    expect(splitCompletedWork(interrupted)).toEqual({ earlier: interrupted.slice(0, -1), visible: interrupted.slice(-1) });
    const afterAnswer = [thought("t"), tool("bash", "Bash", "error"), prose("answer"), prose("error", "error")];
    expect(splitCompletedWork(afterAnswer)).toEqual({ earlier: afterAnswer.slice(0, 2), visible: afterAnswer.slice(2) });
    expect(splitCompletedWork([thought("t"), prose("answer"), prose("error", "error")]))
      .toEqual({ earlier: [thought("t")], visible: [prose("answer"), prose("error", "error")] });
  });

  it("never folds maintenance-only, retries-only or plain assistant text", () => {
    expect(splitCompletedWork([{ ...tool("compact", "Compact"), runtimeRole: "session-maintenance" }])).toBeNull();
    expect(splitCompletedWork([prose("retry", "retry")])).toBeNull();
    expect(splitCompletedWork([prose("answer")])).toBeNull();
  });

  it("shows Worked for only after Pi settlement, in Compact and Semi Compact", () => {
    const items = [thought("thinking"), tool("read", "Read"), prose("last")];
    expect(completedWorkDisclosure(items, "compact", true)).toBeNull();
    expect(completedWorkDisclosure(items, "semi-compact", true)).toBeNull();
    expect(completedWorkDisclosure(items, "full", false)).toBeNull();
    expect(completedWorkDisclosure(items, "full", true)).toBeNull();
    expect(completedWorkDisclosure(items, "compact", false)?.visible[0].id).toBe("last");
    expect(completedWorkDisclosure(items, "semi-compact", false)?.earlier).toEqual(items.slice(0, -1));
  });

  it("holds every Steer-generated turn unfolded until the entire run settles", () => {
    const turns = buildTranscriptTurns([
      prose("historical", "user"), thought("old"), prose("old-final"),
      prose("new-prompt", "user"), thought("new"), prose("interim"),
      prose("steer", "user"), tool("bash", "Bash"), prose("current-final"),
    ]);
    const first = firstUnsettledTurnIndex(turns, "new-prompt");
    expect(first).toBe(1);
    expect(isUnsettledWorkTurn(0, first, turns.length - 1, true)).toBe(false);
    expect(isUnsettledWorkTurn(1, first, turns.length - 1, true)).toBe(true);
    expect(isUnsettledWorkTurn(2, first, turns.length - 1, true)).toBe(true);
    expect(isUnsettledWorkTurn(2, first, turns.length - 1, false)).toBe(false);
    // If agent_start was not observed, keep the current newest turn unfolded.
    expect(isUnsettledWorkTurn(2, -1, turns.length - 1, true)).toBe(true);
    expect(isUnsettledWorkTurn(0, -1, turns.length - 1, true)).toBe(false);
  });

  it("never folds session maintenance into a fake assistant work disclosure", () => {
    expect(splitCompletedWork([{ ...tool("compact", "Compact"), runtimeRole: "session-maintenance" }, prose("answer")])).toBeNull();
  });
});
