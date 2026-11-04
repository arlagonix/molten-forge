import { groupTranscriptItems, segmentRuntimeGroupItems, type TranscriptGroup, type TranscriptItem, type TranscriptTurn } from "./chat-logic";

export type TimelineMode = "compact" | "semi-compact" | "full";

/** Keep the preference independent of Pi's existing per-activity expansion settings. */
export function readTimelineMode(storage: Pick<Storage, "getItem">, key: string): TimelineMode {
  try {
    const stored = storage.getItem(key);
    return stored === "full" || stored === "semi-compact" ? stored : "compact";
  }
  catch { return "compact"; }
}

export type CompactActivityGroup =
  | { kind: "activity"; key: string; items: TranscriptItem[]; blocks: TranscriptItem[][] }
  | { kind: "single"; item: TranscriptItem };

/**
 * One activity disclosure spans adjacent canonical runtime phases, stopping at
 * any non-runtime item (including maintenance and retry). Its independent
 * bordered child blocks preserve the existing smart thinking/tool boundaries
 * and the explicit Pi parallel batches. This never modifies execution groups.
 */
export function groupCompactActivityGroups(groups: readonly TranscriptGroup[]): CompactActivityGroup[] {
  const result: CompactActivityGroup[] = [];
  let blocks: TranscriptItem[][] = [];
  const flush = () => {
    if (!blocks.length) return;
    const items = blocks.flat();
    result.push({ kind: "activity", key: `compact-${items[0].id}`, items, blocks });
    blocks = [];
  };

  const addRuntimeBlocks = (items: TranscriptItem[]) => {
    let current: TranscriptItem[] = [];
    let hasTools = false;
    const flushBlock = () => {
      if (current.length) blocks.push(current);
      current = [];
      hasTools = false;
    };
    for (const segment of segmentRuntimeGroupItems(items)) {
      if (segment.kind === "parallel-tools") {
        // Leading Thinking belongs to the first explicit parallel batch.
        // The next batch always receives its own visual container.
        if (hasTools) flushBlock();
        current.push(...segment.items);
        flushBlock();
      } else {
        current.push(segment.item);
        if (segment.item.kind === "tool") hasTools = true;
      }
    }
    flushBlock();
  };

  for (const group of groups) {
    if (group.kind === "runtime") {
      addRuntimeBlocks(group.items);
    } else if (group.item.kind === "thinking" ||
      (group.item.kind === "tool" && group.item.runtimeRole !== "session-maintenance")) {
      blocks.push([group.item]);
    } else {
      flush();
      result.push({ kind: "single", item: group.item });
    }
  }
  flush();
  return result;
}


/** The live activity at the frontier of Pi's current run. Completed tools
 * remain visible between calls; only prose/maintenance/retry/user boundaries
 * or agent settlement collapse the episode. Never reopen historical turns. */
export function activeSemiCompactActivity(
  turns: readonly TranscriptTurn[], isStreaming: boolean,
): { turnKey: string; groupKey: string } | null {
  if (!isStreaming || !turns.length) return null;
  const turn = turns[turns.length - 1];
  if (!turn.agentItems.length) return null;
  const groups = groupCompactActivityGroups(groupTranscriptItems(turn.agentItems));
  const last = groups[groups.length - 1];
  return last?.kind === "activity" ? { turnKey: turn.key, groupKey: last.key } : null;
}

/** Fold completed Thinking/tool activity and intermediate prose, even when
 * Pi finishes without a final text message (thinking-only, tool-only, abort).
 * Retain the final assistant answer, if any, and all trailing terminal notices
 * outside the disclosure. A tool failure does not itself break a turn. */
export function splitCompletedWork(items: readonly TranscriptItem[]): {
  earlier: TranscriptItem[];
  visible: TranscriptItem[];
} | null {
  let lastActivity = -1;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.kind === "thinking" || (item.kind === "tool" && item.runtimeRole !== "session-maintenance")) {
      lastActivity = index;
    }
  }
  if (lastActivity < 0) return null;

  // A final answer must follow the last runtime activity, otherwise it is
  // intermediate prose that belongs in the collapsed details.
  let visibleFrom = lastActivity + 1;
  for (let index = items.length - 1; index > lastActivity; index--) {
    if (items[index].kind === "assistant") {
      visibleFrom = index;
      break;
    }
  }
  return { earlier: items.slice(0, visibleFrom), visible: items.slice(visibleFrom) };
}

/** Never surface "Worked for" for an unsettled Pi run (including turns
 * produced by Steer while the same run is still in progress). */
export function completedWorkDisclosure(
  items: readonly TranscriptItem[], mode: TimelineMode, isUnsettledRunTurn: boolean,
): ReturnType<typeof splitCompletedWork> {
  return mode === "full" || isUnsettledRunTurn ? null : splitCompletedWork(items);
}

/** Pi Steer can create multiple user turns without completing the active run.
 * Mark the full suffix beginning with the run's first prompt as unsettled. */
export function firstUnsettledTurnIndex(turns: readonly TranscriptTurn[], firstUserId: string | null): number {
  return firstUserId ? turns.findIndex((turn) => turn.userItems.some((item) => item.id === firstUserId)) : -1;
}

export function isUnsettledWorkTurn(
  index: number, firstRunIndex: number, lastIndex: number, isStreaming: boolean,
): boolean {
  return isStreaming && (firstRunIndex >= 0 ? index >= firstRunIndex : index === lastIndex);
}

export type CompactActivitySummary = {
  label: string;
  running: boolean;
  errors: number;
  interrupted: number;
};

/**
 * Explicit per-tool counts instead of an ambiguous total followed by tool types.
 * Thought is only listed if a group contains no tools; it stays accessible inside
 * mixed groups. Preserve first-use order and report failures even when collapsed.
 */
export function summarizeCompactActivity(items: readonly TranscriptItem[]): CompactActivitySummary {
  const counts = new Map<string, number>();
  let thoughts = 0;
  let running = false;
  let errors = 0;
  let interrupted = 0;
  for (const item of items) {
    if (item.kind === "tool" && item.runtimeRole === "session-maintenance") continue;
    if (item.kind !== "tool" && item.kind !== "thinking") continue;
    if (item.kind === "thinking") thoughts++;
    else {
      const name = (item.title || "Tool").trim() || "Tool";
      const label = name.toLowerCase() === "bash" ? "Bash" : name[0].toUpperCase() + name.slice(1);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    if (item.state === "running") running = true;
    if (item.state === "error") errors++;
    if (item.state === "interrupted") interrupted++;
  }
  const label = counts.size
    ? `${running ? "Using" : "Used"} ${[...counts].map(([name, count]) => `${count} ${name}`).join(", ")}`
    : running ? "Thinking" : `Used ${thoughts} ${thoughts === 1 ? "Thought" : "Thoughts"}`;
  return { label, running, errors, interrupted };
}
