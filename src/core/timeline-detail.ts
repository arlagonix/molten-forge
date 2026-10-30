import { segmentRuntimeGroupItems, type TranscriptGroup, type TranscriptItem } from "./chat-logic";

export type TimelineMode = "compact" | "full";

/** Keep the preference independent of Pi's existing per-activity expansion settings. */
export function readTimelineMode(storage: Pick<Storage, "getItem">, key: string): TimelineMode {
  try { return storage.getItem(key) === "full" ? "full" : "compact"; }
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
