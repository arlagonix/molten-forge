import { normalizeCodeLanguage } from "./code-rendering";

export type ToolDiffLineType = "context" | "remove" | "add";

export type ToolDiffLine = {
  type: ToolDiffLineType;
  text: string;
  oldLine?: number;
  newLine?: number;
};

export type ToolDiffHunk = {
  oldStart: number;
  newStart: number;
  skippedBefore: number;
  lines: ToolDiffLine[];
};

export type ToolDiff = {
  version: 1;
  path: string;
  kind: "modify" | "create" | "preview";
  oldLineCount?: number;
  newLineCount?: number;
  added: number;
  removed: number;
  hunks: ToolDiffHunk[];
  skippedAfter?: number;
  truncated?: boolean;
  exactLineDiff?: boolean;
  lineEndingChange?: string;
  finalNewlineChange?: "added" | "removed";
  applied?: boolean;
  executionError?: boolean;
};

export type InlineDiffSpan = { from: number; to: number };
export type InlineDiffPair = {
  removeIndex: number;
  addIndex: number;
  removed: InlineDiffSpan[];
  added: InlineDiffSpan[];
};

const DIFF_CONTEXT_LINES = 3;
const MAX_INLINE_DIFF_CHARS = 20_000;
const MAX_PAIRING_BLOCK_LINES = 48;

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseLine(raw: unknown): ToolDiffLine | undefined {
  const row = objectRecord(raw);
  if (!row || !["context", "remove", "add"].includes(String(row.type))) return undefined;
  if (typeof row.text !== "string") return undefined;
  const type = row.type as ToolDiffLineType;
  return {
    type,
    text: row.text,
    oldLine: finiteNumber(row.oldLine),
    newLine: finiteNumber(row.newLine),
  };
}

export function normalizePersistedToolDiff(value: unknown): ToolDiff | undefined {
  const diff = objectRecord(value);
  if (!diff || diff.version !== 1 || typeof diff.path !== "string") return undefined;
  if (!["modify", "create", "preview"].includes(String(diff.kind))) return undefined;
  const rawHunks = Array.isArray(diff.hunks) ? diff.hunks : [];
  const hunks: ToolDiffHunk[] = [];
  for (const rawHunk of rawHunks) {
    const hunk = objectRecord(rawHunk);
    if (!hunk || !Array.isArray(hunk.lines)) continue;
    const lines = hunk.lines.map(parseLine).filter((line): line is ToolDiffLine => Boolean(line));
    if (!lines.length) continue;
    hunks.push({
      oldStart: finiteNumber(hunk.oldStart) ?? lines[0].oldLine ?? lines[0].newLine ?? 1,
      newStart: finiteNumber(hunk.newStart) ?? lines[0].newLine ?? lines[0].oldLine ?? 1,
      skippedBefore: Math.max(0, finiteNumber(hunk.skippedBefore) ?? 0),
      lines,
    });
  }

  return {
    version: 1,
    path: diff.path,
    kind: diff.kind as ToolDiff["kind"],
    oldLineCount: finiteNumber(diff.oldLineCount),
    newLineCount: finiteNumber(diff.newLineCount),
    added: Math.max(0, finiteNumber(diff.added) ?? hunks.flatMap((hunk) => hunk.lines).filter((line) => line.type === "add").length),
    removed: Math.max(0, finiteNumber(diff.removed) ?? hunks.flatMap((hunk) => hunk.lines).filter((line) => line.type === "remove").length),
    hunks,
    skippedAfter: Math.max(0, finiteNumber(diff.skippedAfter) ?? 0),
    truncated: Boolean(diff.truncated),
    exactLineDiff: diff.exactLineDiff === undefined ? undefined : Boolean(diff.exactLineDiff),
    lineEndingChange: typeof diff.lineEndingChange === "string" ? diff.lineEndingChange : undefined,
    finalNewlineChange: diff.finalNewlineChange === "added" || diff.finalNewlineChange === "removed" ? diff.finalNewlineChange : undefined,
    applied: diff.applied === undefined ? undefined : Boolean(diff.applied),
    executionError: diff.executionError === undefined ? undefined : Boolean(diff.executionError),
  };
}

type RawPatchHunk = {
  oldStart: number;
  newStart: number;
  lines: ToolDiffLine[];
};

export function parseUnifiedPatch(patch: string): RawPatchHunk[] {
  const lines = String(patch ?? "").replace(/\r\n?/g, "\n").split("\n");
  const hunks: RawPatchHunk[] = [];
  let index = 0;

  while (index < lines.length) {
    const match = lines[index].match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!match) {
      index += 1;
      continue;
    }

    let oldLine = Number(match[1]);
    let newLine = Number(match[3]);
    const hunk: RawPatchHunk = { oldStart: oldLine, newStart: newLine, lines: [] };
    index += 1;

    while (index < lines.length && !lines[index].startsWith("@@ ")) {
      const line = lines[index];
      if (line.startsWith("\\ No newline at end of file")) {
        index += 1;
        continue;
      }
      const marker = line[0];
      const text = line.slice(1);
      if (marker === " ") {
        hunk.lines.push({ type: "context", text, oldLine, newLine });
        oldLine += 1;
        newLine += 1;
      } else if (marker === "-") {
        hunk.lines.push({ type: "remove", text, oldLine });
        oldLine += 1;
      } else if (marker === "+") {
        hunk.lines.push({ type: "add", text, newLine });
        newLine += 1;
      } else if (line.startsWith("--- ") || line.startsWith("+++ ") || line === "") {
        // Header/footer content outside a hunk. Empty source lines still arrive
        // with a leading patch marker, so a truly empty string is not a row.
        break;
      }
      index += 1;
    }
    if (hunk.lines.some((line) => line.type !== "context")) hunks.push(hunk);
  }

  return hunks;
}

function changedRanges(lines: ToolDiffLine[], contextLines: number) {
  const groups: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < lines.length;) {
    if (lines[index].type === "context") {
      index += 1;
      continue;
    }
    const start = index;
    while (index < lines.length && lines[index].type !== "context") index += 1;
    groups.push({ start, end: index - 1 });
  }

  const ranges = groups.map((group) => {
    let start = group.start;
    let before = contextLines;
    while (start > 0 && before > 0 && lines[start - 1].type === "context") {
      start -= 1;
      before -= 1;
    }
    let end = group.end;
    let after = contextLines;
    while (end + 1 < lines.length && after > 0 && lines[end + 1].type === "context") {
      end += 1;
      after -= 1;
    }
    return { start, end };
  });

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function countContext(lines: ToolDiffLine[]) {
  return lines.reduce((count, line) => count + (line.type === "context" ? 1 : 0), 0);
}

function reframePatchHunks(rawHunks: RawPatchHunk[], contextLines = DIFF_CONTEXT_LINES): ToolDiffHunk[] {
  const output: ToolDiffHunk[] = [];
  let previousOldEnd: number | undefined;
  let previousNewEnd: number | undefined;

  for (const raw of rawHunks) {
    const ranges = changedRanges(raw.lines, contextLines);
    for (const range of ranges) {
      const lines = raw.lines.slice(range.start, range.end + 1);
      if (!lines.length) continue;
      const first = lines[0];
      const last = lines[lines.length - 1];
      const firstOld = first.oldLine ?? first.newLine ?? raw.oldStart;
      const firstNew = first.newLine ?? first.oldLine ?? raw.newStart;
      const lastOld = last.oldLine ?? last.newLine ?? firstOld;
      const lastNew = last.newLine ?? last.oldLine ?? firstNew;
      const skippedBefore = previousOldEnd === undefined
        ? Math.max(0, Math.min(firstOld, firstNew) - 1)
        : Math.max(0, Math.min(firstOld - previousOldEnd - 1, firstNew - (previousNewEnd ?? previousOldEnd) - 1));

      output.push({ oldStart: firstOld, newStart: firstNew, skippedBefore, lines });
      previousOldEnd = lastOld;
      previousNewEnd = lastNew;
    }
  }
  return output;
}

function countChanges(hunks: ToolDiffHunk[]) {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") added += 1;
      else if (line.type === "remove") removed += 1;
    }
  }
  return { added, removed };
}

function lineCountFromMeta(details: Record<string, unknown> | undefined, key: "oldLineCount" | "newLineCount") {
  const file = objectRecord(details?.moltenForgeFile);
  return finiteNumber(file?.[key]);
}

function pathFromMeta(details: Record<string, unknown> | undefined, fallback: string) {
  const file = objectRecord(details?.moltenForgeFile);
  return typeof file?.path === "string" ? file.path : fallback;
}

function textFormatFromMeta(details: Record<string, unknown> | undefined) {
  const file = objectRecord(details?.moltenForgeFile);
  return {
    lineEndingChange: typeof file?.lineEndingChange === "string" ? file.lineEndingChange : undefined,
    finalNewlineChange: file?.finalNewlineChange === "added" || file?.finalNewlineChange === "removed"
      ? file.finalNewlineChange
      : undefined,
  } as Pick<ToolDiff, "lineEndingChange" | "finalNewlineChange">;
}

export function writeContentFromArgs(toolName: string, args: unknown): { path: string; content: string } | undefined {
  if (toolName.toLowerCase() !== "write") return undefined;
  const record = objectRecord(args);
  if (!record || typeof record.content !== "string") return undefined;
  const path = typeof record.path === "string" ? record.path.trim() : "";
  return { path, content: record.content };
}

export function toolDiffFromResult(
  toolName: string,
  args: unknown,
  resultDetails: unknown,
  isError: boolean,
): ToolDiff | undefined {
  if (isError) {
    const persisted = normalizePersistedToolDiff(objectRecord(resultDetails)?.moltenForgeDiff);
    return persisted?.applied ? persisted : undefined;
  }

  const name = toolName.toLowerCase();
  const details = objectRecord(resultDetails);
  if (name === "write") return normalizePersistedToolDiff(details?.moltenForgeDiff);
  if (name !== "edit") return undefined;

  const patch = typeof details?.patch === "string" ? details.patch : "";
  const formatChanges = textFormatFromMeta(details);
  if (!patch && !formatChanges.lineEndingChange && !formatChanges.finalNewlineChange) return undefined;
  const argsRecord = objectRecord(args);
  const raw = patch ? parseUnifiedPatch(patch) : [];
  const hunks = reframePatchHunks(raw, DIFF_CONTEXT_LINES);
  if (!hunks.length && !formatChanges.lineEndingChange && !formatChanges.finalNewlineChange) return undefined;
  const counts = countChanges(hunks);
  const oldLineCount = lineCountFromMeta(details, "oldLineCount");
  const newLineCount = lineCountFromMeta(details, "newLineCount");
  const finalHunk = hunks[hunks.length - 1];
  const finalLine = finalHunk?.lines[finalHunk.lines.length - 1];
  const finalOld = finalLine?.oldLine ?? finalLine?.newLine ?? 0;
  const finalNew = finalLine?.newLine ?? finalLine?.oldLine ?? 0;
  const skippedAfter = !finalLine || oldLineCount == null || newLineCount == null
    ? 0
    : Math.max(0, Math.min(oldLineCount - finalOld, newLineCount - finalNew));

  return {
    version: 1,
    path: pathFromMeta(details, typeof argsRecord?.path === "string" ? argsRecord.path : ""),
    kind: "modify",
    oldLineCount,
    newLineCount,
    added: counts.added,
    removed: counts.removed,
    hunks,
    skippedAfter,
    ...formatChanges,
  };
}

export function previewEditDiff(args: unknown): ToolDiff | undefined {
  const record = objectRecord(args);
  if (!record || typeof record.path !== "string") return undefined;
  let edits = Array.isArray(record.edits) ? record.edits : [];
  if (!edits.length && typeof record.oldText === "string" && typeof record.newText === "string") {
    edits = [{ oldText: record.oldText, newText: record.newText }];
  }
  const hunks: ToolDiffHunk[] = [];
  let added = 0;
  let removed = 0;
  for (const rawEdit of edits) {
    const edit = objectRecord(rawEdit);
    if (!edit || typeof edit.oldText !== "string" || typeof edit.newText !== "string") continue;
    const removedLines = edit.oldText.replace(/\r\n?/g, "\n").split("\n");
    const addedLines = edit.newText.replace(/\r\n?/g, "\n").split("\n");
    if (removedLines[removedLines.length - 1] === "") removedLines.pop();
    if (addedLines[addedLines.length - 1] === "") addedLines.pop();
    const lines: ToolDiffLine[] = [
      ...removedLines.map((text) => ({ type: "remove" as const, text })),
      ...addedLines.map((text) => ({ type: "add" as const, text })),
    ];
    removed += removedLines.length;
    added += addedLines.length;
    if (lines.length) hunks.push({ oldStart: 1, newStart: 1, skippedBefore: hunks.length ? 1 : 0, lines });
  }
  if (!hunks.length) return undefined;
  return { version: 1, path: record.path, kind: "preview", added, removed, hunks };
}

function tokenizeInlineDiff(text: string) {
  return text.match(/\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]+/g) ?? [];
}

function fallbackCharSpans(oldText: string, newText: string) {
  let prefix = 0;
  while (prefix < oldText.length && prefix < newText.length && oldText[prefix] === newText[prefix]) prefix += 1;
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > prefix && newEnd > prefix && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  return {
    removed: oldEnd > prefix ? [{ from: prefix, to: oldEnd }] : [],
    added: newEnd > prefix ? [{ from: prefix, to: newEnd }] : [],
  };
}

function wordSpans(oldText: string, newText: string) {
  if (oldText.length + newText.length > MAX_INLINE_DIFF_CHARS) return fallbackCharSpans(oldText, newText);
  const oldTokens = tokenizeInlineDiff(oldText);
  const newTokens = tokenizeInlineDiff(newText);
  if (oldTokens.length * newTokens.length > 18_000) return fallbackCharSpans(oldText, newText);

  const lcs = Array.from({ length: oldTokens.length + 1 }, () => new Uint16Array(newTokens.length + 1));
  for (let i = oldTokens.length - 1; i >= 0; i -= 1) {
    for (let j = newTokens.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = oldTokens[i] === newTokens[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const oldOffsets: number[] = [];
  const newOffsets: number[] = [];
  let offset = 0;
  for (const token of oldTokens) { oldOffsets.push(offset); offset += token.length; }
  offset = 0;
  for (const token of newTokens) { newOffsets.push(offset); offset += token.length; }

  const removed: InlineDiffSpan[] = [];
  const added: InlineDiffSpan[] = [];
  const pushMerged = (spans: InlineDiffSpan[], span: InlineDiffSpan) => {
    const previous = spans[spans.length - 1];
    if (previous?.to === span.from) previous.to = span.to;
    else spans.push(span);
  };

  let i = 0;
  let j = 0;
  while (i < oldTokens.length || j < newTokens.length) {
    if (i < oldTokens.length && j < newTokens.length && oldTokens[i] === newTokens[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (j >= newTokens.length || (i < oldTokens.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
      pushMerged(removed, { from: oldOffsets[i], to: oldOffsets[i] + oldTokens[i].length });
      i += 1;
    } else {
      pushMerged(added, { from: newOffsets[j], to: newOffsets[j] + newTokens[j].length });
      j += 1;
    }
  }
  return { removed, added };
}

function lineSimilarity(left: string, right: string) {
  if (left === right) return 1;
  const max = Math.max(left.length, right.length, 1);
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) suffix += 1;
  const leftWords = new Set(left.trim().split(/\s+/).filter(Boolean));
  const rightWords = new Set(right.trim().split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const word of leftWords) if (rightWords.has(word)) overlap += 1;
  const union = new Set([...leftWords, ...rightWords]).size || 1;
  return Math.max((prefix + suffix) / max, overlap / union);
}

function pairBlock(removes: Array<{ index: number; line: ToolDiffLine }>, adds: Array<{ index: number; line: ToolDiffLine }>) {
  if (!removes.length || !adds.length) return [] as Array<[typeof removes[number], typeof adds[number]]>;
  // A single adjacent -/+ line is the canonical replacement shape. Pair it
  // even when the texts share no tokens so the changed value still gets the
  // stronger intra-line treatment instead of looking like two unrelated rows.
  if (removes.length === 1 && adds.length === 1) return [[removes[0], adds[0]]];
  if (removes.length > MAX_PAIRING_BLOCK_LINES || adds.length > MAX_PAIRING_BLOCK_LINES) {
    const count = Math.min(removes.length, adds.length);
    return Array.from({ length: count }, (_, index) => [removes[index], adds[index]] as const);
  }

  const rows = removes.length + 1;
  const cols = adds.length + 1;
  const score = Array.from({ length: rows }, () => Array(cols).fill(0));
  const move = Array.from({ length: rows }, () => Array<"pair" | "remove" | "add" | null>(cols).fill(null));
  const gapPenalty = 0.34;

  for (let i = 1; i < rows; i += 1) {
    score[i][0] = score[i - 1][0] - gapPenalty;
    move[i][0] = "remove";
  }
  for (let j = 1; j < cols; j += 1) {
    score[0][j] = score[0][j - 1] - gapPenalty;
    move[0][j] = "add";
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const similarity = lineSimilarity(removes[i - 1].line.text, adds[j - 1].line.text);
      const pairScore = score[i - 1][j - 1] + similarity - 0.12;
      const removeScore = score[i - 1][j] - gapPenalty;
      const addScore = score[i][j - 1] - gapPenalty;
      if (pairScore >= removeScore && pairScore >= addScore) {
        score[i][j] = pairScore;
        move[i][j] = "pair";
      } else if (removeScore >= addScore) {
        score[i][j] = removeScore;
        move[i][j] = "remove";
      } else {
        score[i][j] = addScore;
        move[i][j] = "add";
      }
    }
  }

  const pairs: Array<[typeof removes[number], typeof adds[number]]> = [];
  let i = removes.length;
  let j = adds.length;
  while (i > 0 || j > 0) {
    const selected = move[i][j];
    if (selected === "pair") {
      const left = removes[i - 1];
      const right = adds[j - 1];
      if (lineSimilarity(left.line.text, right.line.text) >= 0.16) pairs.push([left, right]);
      i -= 1;
      j -= 1;
    } else if (selected === "remove") {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return pairs.reverse();
}

export function inlineDiffPairs(lines: ToolDiffLine[]): InlineDiffPair[] {
  const output: InlineDiffPair[] = [];
  for (let index = 0; index < lines.length;) {
    if (lines[index].type === "context") {
      index += 1;
      continue;
    }
    const start = index;
    while (index < lines.length && lines[index].type !== "context") index += 1;
    const block = lines.slice(start, index);
    const removes = block
      .map((line, offset) => ({ line, index: start + offset }))
      .filter((entry) => entry.line.type === "remove");
    const adds = block
      .map((line, offset) => ({ line, index: start + offset }))
      .filter((entry) => entry.line.type === "add");
    for (const [remove, add] of pairBlock(removes, adds)) {
      const spans = wordSpans(remove.line.text, add.line.text);
      output.push({ removeIndex: remove.index, addIndex: add.index, ...spans });
    }
  }
  return output;
}

export function languageFromFilePath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (/^dockerfile(?:\.|$)/i.test(name)) return "dockerfile";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return normalizeCodeLanguage(extension || "text");
}

export function diffSummary(diff: ToolDiff) {
  const additions = `+${diff.added}`;
  const removals = `−${diff.removed}`;
  return `${additions} ${removals}`;
}
