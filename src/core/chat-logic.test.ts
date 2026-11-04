import { describe, expect, it } from "vitest";
import {
  BUILT_INS,
  COMMAND_SOURCE_ORDER,
  buildTranscriptTurns,
  finalAssistantMessage,
  turnResponseDurationMs,
  validPiModelDurationMs,
  formatResponseDuration,
  withFinalAssistantDuration,
  commandSourceLabel,
  commandSourceRank,
  estimateTranscriptItemHeight,
  estimateTranscriptTurnHeight,
  findBlockIndexForOffset,
  groupTranscriptItems,
  interruptRunningRuntimeItems,
  segmentRuntimeGroupItems,
  getInitialActivityExpanded,
  resolveActivityExpanded,
  shouldFinalizeThinkingForAssistantEvent,
  shouldShowToolOutput,
  shouldShowToolPreview,
  normalizeThinkingContent,
  recoverFencedMarkdownTables,
  transcriptItemsShallowEqual,
  type TranscriptItem,
} from "./chat-logic";

function item(id: string, kind: TranscriptItem["kind"], text = id, extra: Partial<TranscriptItem> = {}): TranscriptItem {
  return { id, kind, text, ...extra };
}

describe("normalizeThinkingContent", () => {
  it("normalizes CRLF, trims trailing spaces and collapses excessive blank lines", () => {
    expect(normalizeThinkingContent("  First  \r\n\r\n\r\n\r\nSecond\t\r\n"))
      .toBe("First\n\nSecond");
  });

  it("preserves one Markdown paragraph break", () => {
    expect(normalizeThinkingContent("one\n\ntwo")).toBe("one\n\ntwo");
  });
});

describe("fenced Markdown table recovery", () => {
  it("unwraps a fenced GFM table", () => {
    const source = [
      "```markdown",
      "| Feature | Status |",
      "| --- | --- |",
      "| A | Done |",
      "```",
    ].join("\n");

    expect(recoverFencedMarkdownTables(source)).toBe([
      "| Feature | Status |",
      "| --- | --- |",
      "| A | Done |",
    ].join("\n"));
  });

  it("keeps typed source-code fences untouched", () => {
    const source = "```ts\nconst flags = a | b;\n```";
    expect(recoverFencedMarkdownTables(source)).toBe(source);
  });

  it("keeps non-table Markdown fences untouched", () => {
    const source = "```markdown\n# Heading\nplain text\n```";
    expect(recoverFencedMarkdownTables(source)).toBe(source);
  });
});

describe("command metadata", () => {
  it("contains unique built-in/wrapper command names", () => {
    const names = BUILT_INS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps command sections in the intended order", () => {
    expect(commandSourceRank("builtin")).toBeLessThan(commandSourceRank("skill"));
    expect(commandSourceRank("skill")).toBeLessThan(commandSourceRank("extension"));
    expect(commandSourceRank("extension")).toBeLessThan(commandSourceRank("prompt"));
    expect(commandSourceRank("prompt")).toBeLessThan(commandSourceRank("wrapper"));
    expect(commandSourceLabel("skill")).toBe("Skills");
  });

  it("exports the palette section order used by App", () => {
    expect(COMMAND_SOURCE_ORDER).toEqual(["builtin", "skill", "extension", "prompt", "wrapper"]);
  });
});

describe("runtime grouping", () => {
  it("groups thinking followed by tools into one runtime group", () => {
    const groups = groupTranscriptItems([
      item("think", "thinking"),
      item("read-1", "tool"),
      item("read-2", "tool"),
      item("answer", "assistant"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].kind).toBe("runtime");
    if (groups[0].kind === "runtime") expect(groups[0].items.map((entry) => entry.id)).toEqual(["think", "read-1", "read-2"]);
    expect(groups[1]).toEqual({ kind: "single", item: expect.objectContaining({ id: "answer" }) });
  });

  it("groups consecutive tools even without thinking or shared batch metadata", () => {
    const groups = groupTranscriptItems([
      item("tool-a", "tool"),
      item("tool-b", "tool"),
      item("tool-c", "tool"),
      item("answer", "assistant"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].kind).toBe("runtime");
    if (groups[0].kind === "runtime") expect(groups[0].items.map((entry) => entry.id)).toEqual(["tool-a", "tool-b", "tool-c"]);
  });

  it("starts a new runtime group when thinking appears after tools", () => {
    const groups = groupTranscriptItems([
      item("think-a", "thinking"),
      item("tool-a", "tool"),
      item("tool-b", "tool"),
      item("think-b", "thinking"),
      item("tool-c", "tool"),
      item("tool-d", "tool"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.kind)).toEqual(["runtime", "runtime"]);
    if (groups[0].kind === "runtime") expect(groups[0].items.map((entry) => entry.id)).toEqual(["think-a", "tool-a", "tool-b"]);
    if (groups[1].kind === "runtime") expect(groups[1].items.map((entry) => entry.id)).toEqual(["think-b", "tool-c", "tool-d"]);
  });

  it("splits a tool-only phase from later thinking", () => {
    const groups = groupTranscriptItems([
      item("tool-a", "tool"),
      item("tool-b", "tool"),
      item("think-b", "thinking"),
      item("tool-c", "tool"),
    ]);

    expect(groups).toHaveLength(2);
    if (groups[0].kind === "runtime") expect(groups[0].items.map((entry) => entry.id)).toEqual(["tool-a", "tool-b"]);
    if (groups[1].kind === "runtime") expect(groups[1].items.map((entry) => entry.id)).toEqual(["think-b", "tool-c"]);
  });

  it("keeps multiple pre-tool thinking blocks in the same phase", () => {
    const groups = groupTranscriptItems([
      item("think-a", "thinking"),
      item("think-b", "thinking"),
      item("tool-a", "tool"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("runtime");
    if (groups[0].kind === "runtime") expect(groups[0].items.map((entry) => entry.id)).toEqual(["think-a", "think-b", "tool-a"]);
  });

  it("keeps trailing post-tool thinking out of the previous runtime group", () => {
    const groups = groupTranscriptItems([
      item("think-a", "thinking"),
      item("tool-a", "tool"),
      item("think-b", "thinking"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].kind).toBe("runtime");
    if (groups[0].kind === "runtime") expect(groups[0].items.map((entry) => entry.id)).toEqual(["think-a", "tool-a"]);
    expect(groups[1]).toEqual({ kind: "single", item: expect.objectContaining({ id: "think-b" }) });
  });

  it("treats assistant prose as a hard grouping boundary", () => {
    const groups = groupTranscriptItems([
      item("think-a", "thinking"),
      item("tool-a", "tool"),
      item("answer", "assistant"),
      item("tool-b", "tool"),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups[0].kind).toBe("runtime");
    expect(groups[1]).toEqual({ kind: "single", item: expect.objectContaining({ id: "answer" }) });
    expect(groups[2]).toEqual({ kind: "single", item: expect.objectContaining({ id: "tool-b" }) });
  });


  it("treats compaction maintenance as a hard runtime-group boundary", () => {
    const groups = groupTranscriptItems([
      item("tool-a", "tool", "", { toolBatchId: "batch-1" }),
      item("tool-b", "tool", "", { toolBatchId: "batch-1" }),
      item("compact", "tool", "", {
        title: "compact",
        runtimeRole: "session-maintenance",
      }),
      item("think-b", "thinking"),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups[0].kind).toBe("runtime");
    expect(groups[1]).toEqual({
      kind: "single",
      item: expect.objectContaining({ id: "compact", runtimeRole: "session-maintenance" }),
    });
    expect(groups[2]).toEqual({ kind: "single", item: expect.objectContaining({ id: "think-b" }) });
  });
  it("does not let retry activity hide a later post-tool thinking boundary", () => {
    const groups = groupTranscriptItems([
      item("think-a", "thinking"),
      item("tool-a", "tool"),
      item("retry", "retry"),
      item("think-b", "thinking"),
      item("tool-b", "tool"),
    ]);

    expect(groups).toHaveLength(3);
    if (groups[0].kind === "runtime") expect(groups[0].items.map((entry) => entry.id)).toEqual(["think-a", "tool-a"]);
    expect(groups[1]).toEqual({ kind: "single", item: expect.objectContaining({ id: "retry" }) });
    if (groups[2].kind === "runtime") expect(groups[2].items.map((entry) => entry.id)).toEqual(["think-b", "tool-b"]);
  });
});

describe("retry grouping isolation", () => {
  it("keeps retries separate before, between, and after thinking/tool batches", () => {
    const groups = groupTranscriptItems([
      item("retry-1", "retry"), item("thinking-1", "thinking"), item("tool-1", "tool"),
      item("retry-2", "retry"), item("tool-2", "tool"), item("retry-3", "retry"),
    ]);
    expect(groups.map((group) => group.kind)).toEqual(["single", "runtime", "single", "single", "single"]);
    expect(groups.filter((group) => group.kind === "runtime").flatMap((group) => group.kind === "runtime" ? group.items.map((entry) => entry.id) : []))
      .toEqual(["thinking-1", "tool-1"]);
    expect(groups.filter((group) => group.kind === "single" && group.item.kind === "retry")).toHaveLength(3);
  });
});

describe("parallel runtime segmentation", () => {

  it("never includes session-maintenance blocks in a parallel tool subgroup", () => {
    const segments = segmentRuntimeGroupItems([
      item("tool-a", "tool", "", { toolBatchId: "batch-1" }),
      item("compact", "tool", "", {
        title: "compact",
        toolBatchId: "batch-1",
        runtimeRole: "session-maintenance",
      }),
      item("tool-b", "tool", "", { toolBatchId: "batch-1" }),
    ]);

    expect(segments.map((segment) => segment.kind)).toEqual(["item", "item", "item"]);
  });
  it("creates a parallel subgroup only for adjacent tools sharing an explicit batch id", () => {
    const segments = segmentRuntimeGroupItems([
      item("tool-a", "tool", "", { toolBatchId: "batch-1" }),
      item("tool-b", "tool", "", { toolBatchId: "batch-1" }),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("parallel-tools");
    if (segments[0].kind === "parallel-tools") expect(segments[0].items.map((entry) => entry.id)).toEqual(["tool-a", "tool-b"]);
  });

  it("keeps several tools from one explicit batch in one parallel subgroup", () => {
    const segments = segmentRuntimeGroupItems([
      item("tool-a", "tool", "", { toolBatchId: "batch-1" }),
      item("tool-b", "tool", "", { toolBatchId: "batch-1" }),
      item("tool-c", "tool", "", { toolBatchId: "batch-1" }),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("parallel-tools");
    if (segments[0].kind === "parallel-tools") expect(segments[0].items.map((entry) => entry.id)).toEqual(["tool-a", "tool-b", "tool-c"]);
  });

  it("groups thinking plus two parallel tool blocks as one reason-act phase", () => {
    const groups = groupTranscriptItems([
      item("think", "thinking"),
      item("tool-a", "tool", "", { toolBatchId: "batch-1" }),
      item("tool-b", "tool", "", { toolBatchId: "batch-1" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("runtime");
    if (groups[0].kind !== "runtime") return;

    const segments = segmentRuntimeGroupItems(groups[0].items);
    expect(segments.map((segment) => segment.kind)).toEqual(["item", "parallel-tools"]);
    if (segments[1].kind === "parallel-tools") expect(segments[1].items.map((entry) => entry.id)).toEqual(["tool-a", "tool-b"]);
  });

  it("keeps several explicit parallel batches separate inside one outer group", () => {
    const segments = segmentRuntimeGroupItems([
      item("tool-a", "tool", "", { toolBatchId: "batch-1" }),
      item("tool-b", "tool", "", { toolBatchId: "batch-1" }),
      item("tool-c", "tool", "", { toolBatchId: "batch-2" }),
      item("tool-d", "tool", "", { toolBatchId: "batch-2" }),
    ]);

    expect(segments.map((segment) => segment.kind)).toEqual(["parallel-tools", "parallel-tools"]);
    if (segments[0].kind === "parallel-tools") expect(segments[0].items.map((entry) => entry.id)).toEqual(["tool-a", "tool-b"]);
    if (segments[1].kind === "parallel-tools") expect(segments[1].items.map((entry) => entry.id)).toEqual(["tool-c", "tool-d"]);
  });

  it("handles thinking followed by two distinct parallel batches", () => {
    const groups = groupTranscriptItems([
      item("think", "thinking"),
      item("tool-a", "tool", "", { toolBatchId: "batch-1" }),
      item("tool-b", "tool", "", { toolBatchId: "batch-1" }),
      item("tool-c", "tool", "", { toolBatchId: "batch-2" }),
      item("tool-d", "tool", "", { toolBatchId: "batch-2" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("runtime");
    if (groups[0].kind !== "runtime") return;

    const segments = segmentRuntimeGroupItems(groups[0].items);
    expect(segments.map((segment) => segment.kind)).toEqual(["item", "parallel-tools", "parallel-tools"]);
    if (segments[0].kind === "item") expect(segments[0].item.id).toBe("think");
  });

  it("does not infer parallelism from adjacent tools without a shared explicit batch id", () => {
    const segments = segmentRuntimeGroupItems([
      item("tool-a", "tool"),
      item("tool-b", "tool"),
      item("tool-c", "tool", "", { toolBatchId: "batch-single" }),
    ]);

    expect(segments.map((segment) => segment.kind)).toEqual(["item", "item", "item"]);
  });

  it("does not reconnect the same batch id across an intervening block", () => {
    const segments = segmentRuntimeGroupItems([
      item("tool-a", "tool", "", { toolBatchId: "batch-1" }),
      item("thinking", "thinking"),
      item("tool-b", "tool", "", { toolBatchId: "batch-1" }),
    ]);

    expect(segments.map((segment) => segment.kind)).toEqual(["item", "item", "item"]);
  });

  it("preserves parallel metadata on both sides of a post-tool thinking boundary", () => {
    const groups = groupTranscriptItems([
      item("think-a", "thinking"),
      item("tool-a", "tool", "", { toolBatchId: "batch-1" }),
      item("tool-b", "tool", "", { toolBatchId: "batch-1" }),
      item("think-b", "thinking"),
      item("tool-c", "tool", "", { toolBatchId: "batch-2" }),
      item("tool-d", "tool", "", { toolBatchId: "batch-2" }),
    ]);

    expect(groups).toHaveLength(2);
    for (const [index, group] of groups.entries()) {
      expect(group.kind).toBe("runtime");
      if (group.kind !== "runtime") continue;
      const segments = segmentRuntimeGroupItems(group.items);
      expect(segments.map((segment) => segment.kind)).toEqual(["item", "parallel-tools"]);
      if (segments[1].kind === "parallel-tools") {
        expect(segments[1].items).toHaveLength(2);
        expect(segments[1].key).toBe(`parallel-batch-${index + 1}`);
      }
    }
  });
});

describe("turn construction", () => {
  it("keeps consecutive unanswered user messages in the same logical turn", () => {
    const turns = buildTranscriptTurns([
      item("u1", "user"),
      item("u2", "user"),
      item("t1", "thinking"),
      item("a1", "assistant"),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].userItems.map((entry) => entry.id)).toEqual(["u1", "u2"]);
    expect(turns[0].agentItems.map((entry) => entry.id)).toEqual(["t1", "a1"]);
  });

  it("starts a new turn after an agent response", () => {
    const turns = buildTranscriptTurns([
      item("u1", "user"),
      item("a1", "assistant"),
      item("u2", "user"),
      item("a2", "assistant"),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0].key).toBe("turn-u1");
    expect(turns[1].key).toBe("turn-u2");
  });

  it("includes the 32px user/agent boundary in the virtual height estimate", () => {
    const turn = buildTranscriptTurns([item("u", "user"), item("a", "assistant")])[0];
    const userOnly = estimateTranscriptTurnHeight(buildTranscriptTurns([item("u", "user")])[0]);
    const agentOnly = estimateTranscriptTurnHeight(buildTranscriptTurns([item("a", "assistant")])[0]);
    expect(estimateTranscriptTurnHeight(turn)).toBe(userOnly + agentOnly + 32);
  });

  it("caps giant user-message estimates to the scrollable bubble height", () => {
    expect(estimateTranscriptItemHeight({
      id: "huge",
      kind: "user",
      text: "x".repeat(100_000),
    })).toBe(480);
  });
});

describe("virtualization helpers", () => {
  it("finds the block containing an offset and clamps outside values", () => {
    const offsets = [0, 100, 250, 400];
    expect(findBlockIndexForOffset(offsets, -10)).toBe(0);
    expect(findBlockIndexForOffset(offsets, 0)).toBe(0);
    expect(findBlockIndexForOffset(offsets, 99)).toBe(0);
    expect(findBlockIndexForOffset(offsets, 100)).toBe(1);
    expect(findBlockIndexForOffset(offsets, 399)).toBe(2);
    expect(findBlockIndexForOffset(offsets, 999)).toBe(2);
  });

  it("uses identity semantics for memoized transcript arrays", () => {
    const first = item("x", "assistant");
    const same = [first];
    expect(transcriptItemsShallowEqual(same, same)).toBe(true);
    expect(transcriptItemsShallowEqual([first], [first])).toBe(true);
    expect(transcriptItemsShallowEqual([first], [{ ...first }])).toBe(false);
  });
});


describe("activity display state", () => {
  it("finalizes thinking as soon as the assistant leaves reasoning for text or tools", () => {
    expect(shouldFinalizeThinkingForAssistantEvent("text_start")).toBe(true);
    expect(shouldFinalizeThinkingForAssistantEvent("text_delta")).toBe(true);
    expect(shouldFinalizeThinkingForAssistantEvent("text_end")).toBe(true);
    expect(shouldFinalizeThinkingForAssistantEvent("toolcall_start")).toBe(true);
    expect(shouldFinalizeThinkingForAssistantEvent("toolcall_delta")).toBe(true);
    expect(shouldFinalizeThinkingForAssistantEvent("toolcall_end")).toBe(true);
    expect(shouldFinalizeThinkingForAssistantEvent("thinking_delta")).toBe(false);
  });

  it("finishes interrupted Thinking normally while preserving interrupted tool payloads", () => {
    const runningThinking = item("think", "thinking", "partial reasoning", { state: "running" });
    const runningTool = item("tool", "tool", "", {
      state: "running",
      toolInput: "{\"path\":\"src/App.tsx\"",
      toolOutput: "partial stdout",
      toolExecutionStarted: true,
    });
    const maintenance = item("compact", "tool", "", {
      state: "running",
      runtimeRole: "session-maintenance",
    });
    const done = item("done", "tool", "", { state: "done" });

    const next = interruptRunningRuntimeItems([runningThinking, runningTool, maintenance, done]);

    expect(next[0]).toMatchObject({ state: "done", text: "partial reasoning" });
    expect(next[1]).toMatchObject({
      state: "interrupted",
      toolInput: "{\"path\":\"src/App.tsx\"",
      toolOutput: "partial stdout",
      toolExecutionStarted: true,
    });
    expect(next[2]).toBe(maintenance);
    expect(next[3]).toBe(done);
  });

  it("does not show a fake tool output area before execution starts", () => {
    expect(shouldShowToolOutput(item("tool", "tool", "", { state: "running", toolExecutionStarted: false }))).toBe(false);
    expect(shouldShowToolOutput(item("tool", "tool", "", { state: "running", toolExecutionStarted: true }))).toBe(true);
    expect(shouldShowToolOutput(item("tool", "tool", "", { state: "done" }))).toBe(true);
  });

  it("shows tool preview only while collapsed", () => {
    expect(shouldShowToolPreview(false, "ls -la")).toBe(true);
    expect(shouldShowToolPreview(true, "ls -la")).toBe(false);
  });

  it("auto-expands only active blocks and respects saved manual state", () => {
    expect(getInitialActivityExpanded(undefined, true, true)).toBe(true);
    expect(getInitialActivityExpanded(undefined, true, false)).toBe(false);
    expect(getInitialActivityExpanded(undefined, false, true)).toBe(false);
    expect(getInitialActivityExpanded(true, false, false)).toBe(true);
  });

  it("derives activity expansion from lifecycle unless the user explicitly overrides it", () => {
    expect(resolveActivityExpanded(undefined, true, true)).toBe(true);
    expect(resolveActivityExpanded(undefined, false, true)).toBe(false);
    expect(resolveActivityExpanded(false, true, true)).toBe(false);
    expect(resolveActivityExpanded(true, false, true)).toBe(true);
  });
});

describe("one assistant metadata footer per logical turn", () => {
  it("selects only the last assistant prose and includes intervening tool time from Pi metadata", () => {
    const [turn] = buildTranscriptTurns([
      item("user", "user", "Run tests", { timestamp: 500 }),
      item("first", "assistant", "Starting", { timestamp: 1000, modelDurationMs: 1800 }),
      item("bash", "tool"),
      item("second", "assistant", "Verifying", { timestamp: 10000, modelDurationMs: 4000 }),
      item("more", "tool"),
      item("final", "assistant", "Done", { timestamp: 161000, modelDurationMs: 19000, model: "qwen" }),
    ]);
    expect(finalAssistantMessage(turn)?.id).toBe("final");
    expect(turnResponseDurationMs(turn)).toBe(179000);
    expect(formatResponseDuration(turnResponseDurationMs(turn))).toBe("2m 59s");
  });

  it("includes early tool-only and thinking-only model requests in restored run timing", () => {
    const [turn] = buildTranscriptTurns([
      item("user", "user", "Refactor"),
      item("thinking", "thinking", "Planning", { timestamp: 2000 }),
      item("tool", "tool", "", { timestamp: 2000, toolCallId: "x" }),
      item("final", "assistant", "Done", { timestamp: 18000, modelDurationMs: 4500 }),
    ]);
    expect(turnResponseDurationMs(turn)).toBe(20500);
  });

  it("uses Pi's native duration for a single model request even without timestamps", () => {
    const [turn] = buildTranscriptTurns([
      item("user", "user", "Hi"),
      item("assistant", "assistant", "Hello", { modelDurationMs: 18500 }),
    ]);
    expect(turnResponseDurationMs(turn)).toBe(18500);
  });

  it("uses the measured live run duration over historical Pi metadata", () => {
    const [turn] = buildTranscriptTurns([
      item("user", "user", "Hi", { timestamp: 1000 }),
      item("assistant", "assistant", "Hello", { timestamp: 900000, modelDurationMs: 18500, durationMs: 24600 }),
    ]);
    expect(turnResponseDurationMs(turn)).toBe(24600);
    expect(formatResponseDuration(turnResponseDurationMs(turn))).toBe("25s");
  });

  it("never infers timing from a user prompt and final model-start timestamp", () => {
    const [turn] = buildTranscriptTurns([
      item("user", "user", "Hi", { timestamp: 2500 }),
      item("assistant", "assistant", "Hello", { timestamp: 2500 }),
    ]);
    expect(turnResponseDurationMs(turn)).toBeUndefined();
    expect(formatResponseDuration(turnResponseDurationMs(turn))).toBe("");
  });

  it("does not guess complete run timing when the final Pi duration or message timestamps are missing", () => {
    const [noAssistant] = buildTranscriptTurns([item("user", "user"), item("tool", "tool")]);
    expect(turnResponseDurationMs(noAssistant)).toBeUndefined();
    const [noTimestamp] = buildTranscriptTurns([
      item("user", "user"), item("first", "assistant", "Starting"),
      item("final", "assistant", "Done", { timestamp: 10000, modelDurationMs: 2000 }),
    ]);
    expect(turnResponseDurationMs(noTimestamp)).toBeUndefined();
    const [noFinalDuration] = buildTranscriptTurns([
      item("user", "user"), item("first", "assistant", "Starting", { timestamp: 1000, modelDurationMs: 900 }),
      item("final", "assistant", "Done", { timestamp: 10000 }),
    ]);
    expect(turnResponseDurationMs(noFinalDuration)).toBeUndefined();
    const [reversed] = buildTranscriptTurns([
      item("user", "user"), item("first", "assistant", "Starting", { timestamp: 30000 }),
      item("final", "assistant", "Done", { timestamp: 10000, modelDurationMs: 2000 }),
    ]);
    expect(turnResponseDurationMs(reversed)).toBeUndefined();
  });

  it("accepts only numeric, finite, nonnegative Pi durations", () => {
    expect(validPiModelDurationMs(3000)).toBe(3000);
    expect(validPiModelDurationMs(0)).toBe(0);
    for (const value of ["0", "2000", null, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(validPiModelDurationMs(value)).toBeUndefined();
    }
  });

  it("formats subsecond, minute and hour durations and hides unknown values", () => {
    expect(formatResponseDuration(0)).toBe("<1s");
    expect(formatResponseDuration(100)).toBe("<1s");
    expect(formatResponseDuration(999)).toBe("<1s");
    expect(formatResponseDuration(24500)).toBe("25s");
    expect(formatResponseDuration(59000)).toBe("59s");
    expect(formatResponseDuration(59500)).toBe("1m 0s");
    expect(formatResponseDuration(60000)).toBe("1m 0s");
    expect(formatResponseDuration(3660000)).toBe("1h 1m");
    expect(formatResponseDuration(-1)).toBe("");
    expect(formatResponseDuration(Number.NaN)).toBe("");
    expect(formatResponseDuration(undefined)).toBe("");
  });

  it("stamps only the latest assistant response without mutating earlier items", () => {
    const original = [
      item("u1", "user"), item("a1", "assistant"), item("tool", "tool"),
      item("a2", "assistant"),
    ];
    const patched = withFinalAssistantDuration(original, 3600);
    expect(patched).not.toBe(original);
    expect(patched.slice(0, 3)).toEqual(original.slice(0, 3));
    expect(patched[0]).toBe(original[0]);
    expect(patched[1]).toBe(original[1]);
    expect(patched[2]).toBe(original[2]);
    expect(patched[3]).toEqual({ ...original[3], durationMs: 3600 });
    expect(original[3].durationMs).toBeUndefined();
  });

  it("stamps the final runtime item when a turn has no final assistant text", () => {
    const original = [item("u1", "user"), item("a1", "assistant"), item("u2", "user"), item("thinking", "thinking"), item("tool", "tool")];
    const result = withFinalAssistantDuration(original, 9000);
    expect(result[4]).toEqual({ ...original[4], durationMs: 9000 });
    expect(result.slice(0, 4)).toEqual(original.slice(0, 4));
    expect(withFinalAssistantDuration(original, Number.NaN)).toBe(original);
    expect(withFinalAssistantDuration([item("u1", "user"), item("a1", "assistant"), item("u2", "user")], 9000))
      .toEqual([item("u1", "user"), item("a1", "assistant"), item("u2", "user")]);
  });

  it("recovers thinking-only timing and tool-end timing from restored Pi messages", () => {
    const [thinkingOnly] = buildTranscriptTurns([
      item("u", "user"), item("thinking", "thinking", "reason", { modelDurationMs: 4200 }),
    ]);
    expect(turnResponseDurationMs(thinkingOnly)).toBe(4200);
    const [toolOnly] = buildTranscriptTurns([
      item("u", "user"), item("bash", "tool", "", { timestamp: 1000, modelDurationMs: 2000, completedAt: 12500 }),
    ]);
    expect(turnResponseDurationMs(toolOnly)).toBe(11500);
    const [failed] = buildTranscriptTurns([
      item("u", "user"), item("thinking", "thinking", "reason", { timestamp: 1000, modelDurationMs: 1500 }),
      item("bash", "tool", "", { timestamp: 1000, modelDurationMs: 1500, completedAt: 7000, state: "error" }),
      item("error", "error", "Aborted"),
    ]);
    expect(turnResponseDurationMs(failed)).toBe(6000);
    const [live] = buildTranscriptTurns([item("u", "user"), item("thinking", "thinking", "reason", { durationMs: 7321 })]);
    expect(turnResponseDurationMs(live)).toBe(7321);
    const [errorAfterLive] = buildTranscriptTurns([
      item("u", "user"), item("tool", "tool", "", { durationMs: 9000 }), item("error", "error", "Service unavailable"),
    ]);
    expect(turnResponseDurationMs(errorAfterLive)).toBe(9000);
    const [missingToolDuration] = buildTranscriptTurns([
      item("u", "user"), item("first", "assistant", "Starting", { timestamp: 1000, modelDurationMs: 900 }),
      item("tool", "tool", "", { timestamp: 5000, completedAt: 12000 }),
    ]);
    expect(turnResponseDurationMs(missingToolDuration)).toBeUndefined();
  });
});
