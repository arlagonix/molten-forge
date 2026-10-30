import type { ToolDiff } from "./tool-diff";
import type { ManagedAttachment } from "./attachments";

export type CommandInfo = {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "builtin" | "wrapper";
  sourceInfo?: {
    path?: string;
    source?: string;
    scope?: "user" | "project" | "temporary";
    origin?: "package" | "top-level";
    baseDir?: string;
  };
};

export type TranscriptItem = {
  id: string;
  kind: "user" | "assistant" | "thinking" | "tool" | "retry" | "system" | "error";
  title?: string;
  text: string;
  attachments?: ManagedAttachment[];
  state?: "running" | "done" | "error" | "interrupted";
  toolInput?: string;
  toolOutput?: string;
  toolArgs?: unknown;
  toolResultDetails?: unknown;
  toolDiff?: ToolDiff;
  toolCallId?: string;
  toolBatchId?: string;
  toolExecutionStarted?: boolean;
  runtimeRole?: "agent" | "session-maintenance";
};

export type TranscriptGroup =
  | { kind: "single"; item: TranscriptItem }
  | { kind: "runtime"; key: string; items: TranscriptItem[] };

export type RuntimeGroupSegment =
  | { kind: "item"; item: TranscriptItem }
  | { kind: "parallel-tools"; key: string; items: TranscriptItem[] };

export type TranscriptTurn = {
  key: string;
  userItems: TranscriptItem[];
  agentItems: TranscriptItem[];
};

export const BUILT_INS: CommandInfo[] = [
  { name: "login", description: "Manage provider credentials", source: "builtin" },
  { name: "logout", description: "Clear provider credentials", source: "builtin" },
  { name: "llama", description: "Manage llama.cpp router models", source: "builtin" },
  { name: "model", description: "Switch models", source: "builtin" },
  { name: "thinking", description: "Switch thinking level", source: "builtin" },
  { name: "scoped-models", description: "Choose models used for model cycling", source: "builtin" },
  { name: "settings", description: "Open Pi settings", source: "builtin" },
  { name: "resume", description: "Resume a previous session", source: "builtin" },
  { name: "new", description: "Start a new session", source: "builtin" },
  { name: "name", description: "Set or show the session name", source: "builtin" },
  { name: "session", description: "Show session statistics", source: "builtin" },
  { name: "tree", description: "Jump to a point in the session tree", source: "builtin" },
  { name: "trust", description: "Save the project trust decision", source: "builtin" },
  { name: "fork", description: "Create a new session from a previous user message", source: "builtin" },
  { name: "clone", description: "Clone the current active branch", source: "builtin" },
  { name: "compact", description: "Compact context; optional instructions", source: "builtin" },
  { name: "copy", description: "Copy the last assistant text", source: "builtin" },
  { name: "export", description: "Export the current session", source: "builtin" },
  { name: "import", description: "Import and resume a JSONL session", source: "builtin" },
  { name: "share", description: "Share the current session", source: "builtin" },
  { name: "bug", description: "Report a Pi bug", source: "builtin" },
  { name: "reload", description: "Reload Pi resources", source: "builtin" },
  { name: "hotkeys", description: "Show Pi keyboard shortcuts", source: "builtin" },
  { name: "changelog", description: "Show Pi version history", source: "builtin" },
  { name: "quit", description: "Stop the Pi process", source: "builtin" },

  // Wrapper-only RPC conveniences. These are intentionally separated from
  // Pi's interactive built-ins so the palette mirrors Pi more accurately.
  { name: "commands", description: "List commands available to this wrapper", source: "wrapper" },
  { name: "state", description: "Show raw Pi RPC state", source: "wrapper" },
  { name: "messages", description: "Show raw conversation messages", source: "wrapper" },
  { name: "abort", description: "Abort current agent operation", source: "wrapper" },
];

export const TUI_ONLY = new Set([
  "settings",
  "scoped-models",
  "login",
  "logout",
  "llama",
  "import",
  "share",
  "bug",
  "trust",
  "hotkeys",
  "changelog",
]);

export const COMMAND_SOURCE_ORDER: CommandInfo["source"][] = ["builtin", "skill", "extension", "prompt", "wrapper"];

export function commandSourceLabel(source: CommandInfo["source"]) {
  switch (source) {
    case "builtin": return "Built-in";
    case "skill": return "Skills";
    case "extension": return "Extensions";
    case "prompt": return "Prompt templates";
    case "wrapper": return "Wrapper";
  }
}

export function commandSourceRank(source: CommandInfo["source"]) {
  const index = COMMAND_SOURCE_ORDER.indexOf(source);
  return index === -1 ? COMMAND_SOURCE_ORDER.length : index;
}

export function normalizeThinkingContent(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    // Preserve Markdown paragraphs/lists while preventing models from producing
    // huge vertical gaps with repeated blank lines.
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();
}

export function looksLikeMarkdownPipeTable(lines: string[]) {
  const content = [...lines];
  while (content.length > 0 && !content[0].trim()) content.shift();
  while (content.length > 0 && !content[content.length - 1].trim()) content.pop();
  if (content.length < 2) return false;

  const header = content[0].trim();
  const delimiter = content[1].trim();
  if (!header.includes("|")) return false;

  // GFM delimiter row: | --- | :---: | ---: |
  return /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(delimiter);
}

/**
 * Some models unnecessarily fence Markdown tables. GFM must treat fenced text as
 * code, so recover only fences that are clearly tables. This is intentionally
 * conservative: typed source-code fences are never touched.
 */
export function recoverFencedMarkdownTables(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  const allowedFenceLabels = new Set(["", "md", "markdown", "gfm", "table"]);

  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].match(/^(\s*)(`{3,}|~{3,})\s*([^\s`]*)\s*$/);
    if (!opening) {
      output.push(lines[index]);
      continue;
    }

    const [, , marker, rawLabel] = opening;
    const label = rawLabel.toLowerCase();
    if (!allowedFenceLabels.has(label)) {
      output.push(lines[index]);
      continue;
    }

    let closingIndex = -1;
    for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
      const closing = lines[candidate].match(/^\s*(`{3,}|~{3,})\s*$/);
      if (!closing) continue;
      const closingMarker = closing[1];
      if (closingMarker[0] === marker[0] && closingMarker.length >= marker.length) {
        closingIndex = candidate;
        break;
      }
    }

    if (closingIndex === -1) {
      output.push(lines[index]);
      continue;
    }

    const fencedLines = lines.slice(index + 1, closingIndex);
    if (!looksLikeMarkdownPipeTable(fencedLines)) {
      output.push(...lines.slice(index, closingIndex + 1));
      index = closingIndex;
      continue;
    }

    output.push(...fencedLines);
    index = closingIndex;
  }

  return output.join("\n");
}

export function isRuntimeTranscriptItem(item: TranscriptItem) {
  if (item.kind === "tool" && item.runtimeRole === "session-maintenance") return false;
  return item.kind === "thinking" || item.kind === "tool";
}

/**
 * Group one continuous runtime/reasoning episode. Consecutive tools stay together
 * even without a thinking block. A thinking block that appears after at least one
 * tool starts a new reasoning episode and therefore closes the previous runtime
 * group. Non-runtime transcript content (including Retry notices) is always a hard boundary.
 *
 * Parallel tool-call batches are intentionally not handled here. They are nested
 * presentation segments inside an outer runtime group and are derived separately
 * by segmentRuntimeGroupItems().
 */
export function groupTranscriptItems(items: TranscriptItem[]): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];
  let runtime: TranscriptItem[] = [];
  let runtimeHasTool = false;

  const flushRuntime = () => {
    if (!runtime.length) return;
    if (runtime.length === 1) groups.push({ kind: "single", item: runtime[0] });
    else groups.push({ kind: "runtime", key: `runtime-${runtime[0].id}`, items: runtime });
    runtime = [];
    runtimeHasTool = false;
  };

  for (const item of items) {
    if (!isRuntimeTranscriptItem(item)) {
      flushRuntime();
      groups.push({ kind: "single", item });
      continue;
    }

    // Once tools have run, later thinking is post-tool reasoning. It belongs to
    // the next reason -> act phase rather than being absorbed into the old group.
    if (item.kind === "thinking" && runtimeHasTool) flushRuntime();

    runtime.push(item);
    if (item.kind === "tool") runtimeHasTool = true;
  }

  flushRuntime();
  return groups;
}

/**
 * Preserve explicit Pi tool-batch boundaries inside an outer runtime group. Only
 * adjacent tools with the same non-empty batch id are considered parallel. Tool
 * adjacency alone must never imply parallel execution, and distinct explicit
 * batches must never be merged together.
 */
export function segmentRuntimeGroupItems(items: TranscriptItem[]): RuntimeGroupSegment[] {
  const segments: RuntimeGroupSegment[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index];
    if (
      item.kind !== "tool"
      || item.runtimeRole === "session-maintenance"
      || !item.toolBatchId
    ) {
      segments.push({ kind: "item", item });
      index += 1;
      continue;
    }

    const batchId = item.toolBatchId;
    const batch: TranscriptItem[] = [];
    while (
      index < items.length
      && items[index].kind === "tool"
      && items[index].runtimeRole !== "session-maintenance"
      && items[index].toolBatchId === batchId
    ) {
      batch.push(items[index]);
      index += 1;
    }

    if (batch.length > 1) {
      segments.push({ kind: "parallel-tools", key: `parallel-${batchId}`, items: batch });
    } else {
      segments.push({ kind: "item", item: batch[0] });
    }
  }

  return segments;
}

export function shouldFinalizeThinkingForAssistantEvent(eventType: string) {
  return eventType === "text_start"
    || eventType === "text_delta"
    || eventType === "text_end"
    || eventType === "toolcall_start"
    || eventType === "toolcall_delta"
    || eventType === "toolcall_end";
}


export function interruptRunningRuntimeItems(items: TranscriptItem[]): TranscriptItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (
      item.state !== "running"
      || (item.kind !== "thinking" && item.kind !== "tool")
      || (item.kind === "tool" && item.runtimeRole === "session-maintenance")
    ) {
      return item;
    }
    changed = true;
    return item.kind === "thinking"
      ? { ...item, state: "done" as const }
      : { ...item, state: "interrupted" as const };
  });
  return changed ? next : items;
}

export function shouldShowToolOutput(item: TranscriptItem) {
  return Boolean(item.toolExecutionStarted || item.toolOutput || item.state === "done" || item.state === "error");
}

export function shouldShowToolPreview(expanded: boolean, preview: string) {
  return !expanded && preview.trim().length > 0;
}

export function getInitialActivityExpanded(
  saved: boolean | undefined,
  running: boolean,
  autoExpand: boolean,
) {
  if (saved !== undefined) return saved;
  return running && autoExpand;
}

export function resolveActivityExpanded(
  manualOverride: boolean | undefined,
  running: boolean,
  autoExpand: boolean,
) {
  return manualOverride ?? (running && autoExpand);
}

export function buildTranscriptTurns(items: TranscriptItem[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let current: TranscriptTurn | null = null;

  const pushCurrent = () => {
    if (!current) return;
    if (current.userItems.length || current.agentItems.length) turns.push(current);
    current = null;
  };

  for (const item of items) {
    if (item.kind === "user") {
      if (current?.agentItems.length) pushCurrent();
      if (!current) current = { key: `turn-${item.id}`, userItems: [], agentItems: [] };
      current.userItems.push(item);
      continue;
    }

    if (!current) current = { key: `turn-${item.id}`, userItems: [], agentItems: [] };
    current.agentItems.push(item);
  }

  pushCurrent();
  return turns;
}

export function transcriptItemsShallowEqual(left: TranscriptItem[], right: TranscriptItem[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function estimateTranscriptItemHeight(item: TranscriptItem) {
  const textLength = item.text?.length ?? 0;
  if (item.kind === "user") return Math.min(480, 48 + Math.ceil(textLength / 72) * 24);
  if (item.kind === "assistant") return Math.min(3000, 24 + Math.ceil(textLength / 82) * 24);
  if (item.kind === "thinking" || item.kind === "tool" || item.kind === "retry") return 42;
  return Math.min(500, 44 + Math.ceil(textLength / 82) * 22);
}

export function estimateTranscriptTurnHeight(turn: TranscriptTurn) {
  const userHeight = turn.userItems.reduce((total, item) => total + estimateTranscriptItemHeight(item), 0)
    + Math.max(0, turn.userItems.length - 1) * 8;
  const agentHeight = turn.agentItems.reduce((total, item) => total + estimateTranscriptItemHeight(item), 0)
    + Math.max(0, turn.agentItems.length - 1) * 8;
  const boundaryGap = turn.userItems.length && turn.agentItems.length ? 32 : 0;
  return Math.max(42, userHeight + boundaryGap + agentHeight);
}

export function findBlockIndexForOffset(offsets: number[], offset: number) {
  if (offsets.length <= 1) return 0;
  let low = 0;
  let high = offsets.length - 2;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (offset < offsets[middle]) high = middle - 1;
    else if (offset >= offsets[middle + 1]) low = middle + 1;
    else return middle;
  }
  return Math.max(0, Math.min(offsets.length - 2, low));
}
