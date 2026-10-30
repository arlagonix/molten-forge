import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

const CONTEXT_LINES = 3;
const MAX_MYERS_DISTANCE = 480;
const MAX_PERSISTED_CHANGED_LINES = 2400;
const MAX_PERSISTED_CHANGED_CHARS = 200_000;
const MAX_PERSISTED_HUNKS = 120;

type DiffOperation = { type: "context" | "remove" | "add"; line: string };
type PersistedDiffLine = { type: "context" | "remove" | "add"; text: string; oldLine?: number; newLine?: number };
type PersistedDiffHunk = { oldStart: number; newStart: number; skippedBefore: number; lines: PersistedDiffLine[] };
type PersistedFileDiff = {
  version: 1;
  path: string;
  kind: "create" | "modify";
  oldLineCount: number;
  newLineCount: number;
  added: number;
  removed: number;
  hunks: PersistedDiffHunk[];
  skippedAfter: number;
  truncated: boolean;
  exactLineDiff: boolean;
  lineEndingChange?: string;
  finalNewlineChange?: "added" | "removed";
  applied?: boolean;
  executionError?: boolean;
};

function normalizeLf(text: unknown): string {
  return String(text ?? "").replace(/\r\n?/g, "\n");
}

function splitLines(text: unknown): string[] {
  const normalized = normalizeLf(text);
  if (!normalized) return [];
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function lineEnding(text: unknown): "none" | "crlf" | "lf" | "cr" | "mixed" {
  const value = String(text ?? "");
  const hasCrlf = /\r\n/.test(value);
  const withoutCrlf = value.replace(/\r\n/g, "");
  const hasLf = /\n/.test(withoutCrlf);
  const hasCr = /\r/.test(withoutCrlf);
  const kinds = Number(hasCrlf) + Number(hasLf) + Number(hasCr);
  if (kinds === 0) return "none";
  if (kinds > 1) return "mixed";
  if (hasCrlf) return "crlf";
  return hasCr ? "cr" : "lf";
}

function endsWithLineBreak(text: unknown): boolean {
  return /(?:\r\n|\r|\n)$/.test(String(text ?? ""));
}

function textFormatChanges(before: unknown | null, after: unknown | null) {
  if (before == null || after == null) return {};
  const beforeEnding = lineEnding(before);
  const afterEnding = lineEnding(after);
  const beforeFinalNewline = endsWithLineBreak(before);
  const afterFinalNewline = endsWithLineBreak(after);
  return {
    lineEndingChange:
      beforeEnding !== afterEnding && beforeEnding !== "none" && afterEnding !== "none"
        ? `${beforeEnding.toUpperCase()} → ${afterEnding.toUpperCase()}`
        : undefined,
    finalNewlineChange:
      beforeFinalNewline !== afterFinalNewline ? (afterFinalNewline ? "added" as const : "removed" as const) : undefined,
  };
}

function mapGet(map: Map<number, number>, key: number): number {
  const value = map.get(key);
  return value === undefined ? Number.NEGATIVE_INFINITY : value;
}

/**
 * Myers line diff. It is intentionally bounded because a complete rewrite is
 * more useful as a compact "diff too large" summary than as thousands of
 * persisted +/- rows in every Pi session.
 */
export function diffLineOperations(oldLines: string[], newLines: string[], maxDistance = MAX_MYERS_DISTANCE): DiffOperation[] | null {
  const n = oldLines.length;
  const m = newLines.length;
  if (n === 0) return newLines.map((line) => ({ type: "add", line }));
  if (m === 0) return oldLines.map((line) => ({ type: "remove", line }));

  const max = n + m;
  const limit = Math.min(max, maxDistance);
  const frontier = new Map([[1, 0]]);
  const trace: Array<Map<number, number>> = [];

  for (let distance = 0; distance <= limit; distance += 1) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let x;
      if (
        diagonal === -distance ||
        (diagonal !== distance && mapGet(frontier, diagonal - 1) < mapGet(frontier, diagonal + 1))
      ) {
        x = mapGet(frontier, diagonal + 1);
        if (!Number.isFinite(x)) x = 0;
      } else {
        x = mapGet(frontier, diagonal - 1) + 1;
        if (!Number.isFinite(x)) x = 0;
      }

      let y = x - diagonal;
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x += 1;
        y += 1;
      }
      frontier.set(diagonal, x);

      if (x >= n && y >= m) {
        const operations: DiffOperation[] = [];
        let backX = n;
        let backY = m;

        for (let backDistance = distance; backDistance >= 0; backDistance -= 1) {
          const previousFrontier = trace[backDistance];
          const backDiagonal = backX - backY;
          let previousDiagonal;

          if (
            backDiagonal === -backDistance ||
            (backDiagonal !== backDistance &&
              mapGet(previousFrontier, backDiagonal - 1) < mapGet(previousFrontier, backDiagonal + 1))
          ) {
            previousDiagonal = backDiagonal + 1;
          } else {
            previousDiagonal = backDiagonal - 1;
          }

          let previousX = mapGet(previousFrontier, previousDiagonal);
          if (!Number.isFinite(previousX)) previousX = 0;
          const previousY = previousX - previousDiagonal;

          while (backX > previousX && backY > previousY) {
            operations.push({ type: "context", line: oldLines[backX - 1] });
            backX -= 1;
            backY -= 1;
          }

          if (backDistance === 0) break;
          if (backX === previousX) {
            operations.push({ type: "add", line: newLines[backY - 1] });
            backY -= 1;
          } else {
            operations.push({ type: "remove", line: oldLines[backX - 1] });
            backX -= 1;
          }
        }

        return operations.reverse();
      }
    }
  }

  return null;
}

function countConsecutiveContextBefore(rows: Array<{ type: string }>, index: number): number {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && rows[cursor].type === "context"; cursor -= 1) count += 1;
  return count;
}

function countConsecutiveContextAfter(rows: Array<{ type: string }>, index: number): number {
  let count = 0;
  for (let cursor = index + 1; cursor < rows.length && rows[cursor].type === "context"; cursor += 1) count += 1;
  return count;
}

function rowsWithLineNumbers(operations: DiffOperation[]): PersistedDiffLine[] {
  let oldLine = 1;
  let newLine = 1;
  return operations.map((operation) => {
    if (operation.type === "context") {
      const row: PersistedDiffLine = { type: "context", text: operation.line, oldLine, newLine };
      oldLine += 1;
      newLine += 1;
      return row;
    }
    if (operation.type === "remove") {
      const row: PersistedDiffLine = { type: "remove", text: operation.line, oldLine };
      oldLine += 1;
      return row;
    }
    const row: PersistedDiffLine = { type: "add", text: operation.line, newLine };
    newLine += 1;
    return row;
  });
}

function buildHunks(rows: PersistedDiffLine[], contextLines = CONTEXT_LINES) {
  const changeGroups: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < rows.length;) {
    if (rows[index].type === "context") {
      index += 1;
      continue;
    }
    const start = index;
    while (index < rows.length && rows[index].type !== "context") index += 1;
    changeGroups.push({ start, end: index - 1 });
  }
  if (changeGroups.length === 0) return { hunks: [], skippedAfter: rows.length };

  const ranges = changeGroups.map((group) => ({
    start: group.start - Math.min(contextLines, countConsecutiveContextBefore(rows, group.start)),
    end: group.end + Math.min(contextLines, countConsecutiveContextAfter(rows, group.end)),
  }));

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }

  const hunks: PersistedDiffHunk[] = [];
  let previousEnd = -1;
  for (const range of merged) {
    const omitted = rows.slice(previousEnd + 1, range.start).filter((row) => row.type === "context").length;
    const lines = rows.slice(range.start, range.end + 1);
    const first = lines[0];
    hunks.push({
      oldStart: first.oldLine ?? (first.newLine ?? 1),
      newStart: first.newLine ?? (first.oldLine ?? 1),
      skippedBefore: omitted,
      lines,
    });
    previousEnd = range.end;
  }

  const skippedAfter = rows.slice(previousEnd + 1).filter((row) => row.type === "context").length;
  return { hunks, skippedAfter };
}

function fallbackOperations(oldLines: string[], newLines: string[]): DiffOperation[] {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;

  let oldSuffix = oldLines.length;
  let newSuffix = newLines.length;
  while (oldSuffix > prefix && newSuffix > prefix && oldLines[oldSuffix - 1] === newLines[newSuffix - 1]) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  return [
    ...oldLines.slice(0, prefix).map((line): DiffOperation => ({ type: "context", line })),
    ...oldLines.slice(prefix, oldSuffix).map((line): DiffOperation => ({ type: "remove", line })),
    ...newLines.slice(prefix, newSuffix).map((line): DiffOperation => ({ type: "add", line })),
    ...oldLines.slice(oldSuffix).map((line): DiffOperation => ({ type: "context", line })),
  ];
}

export function buildFileDiff(path: unknown, oldContent: unknown | null, newContent: unknown, options: Record<string, number> = {}): PersistedFileDiff {
  const contextLines = Number.isFinite(options.contextLines) ? Math.max(0, options.contextLines) : CONTEXT_LINES;
  const oldText = oldContent == null ? "" : String(oldContent);
  const newText = String(newContent ?? "");
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const kind: PersistedFileDiff["kind"] = oldContent == null ? "create" : "modify";

  let operations = diffLineOperations(oldLines, newLines, options.maxDistance ?? MAX_MYERS_DISTANCE);
  const exactLineDiff = operations !== null;
  if (!operations) operations = fallbackOperations(oldLines, newLines);

  const added = operations.filter((row) => row.type === "add").length;
  const removed = operations.filter((row) => row.type === "remove").length;
  const formatChanges = textFormatChanges(oldContent, newText);

  const changedChars = operations.reduce(
    (total, row) => total + (row.type === "context" ? 0 : row.line.length),
    0,
  );
  const tooLarge =
    added + removed > (options.maxPersistedChangedLines ?? MAX_PERSISTED_CHANGED_LINES) ||
    changedChars > (options.maxPersistedChangedChars ?? MAX_PERSISTED_CHANGED_CHARS);
  // If the bounded Myers pass gives up, keep only a summary. The fallback
  // operations are good enough to count changed lines, but not precise enough
  // to present as a trustworthy user-facing hunk.
  const omitHunks = tooLarge || !exactLineDiff;
  const numbered = omitHunks ? [] : rowsWithLineNumbers(operations);
  const { hunks, skippedAfter } = omitHunks ? { hunks: [], skippedAfter: 0 } : buildHunks(numbered, contextLines);
  const limitedHunks = hunks.length > (options.maxPersistedHunks ?? MAX_PERSISTED_HUNKS) ? [] : hunks;
  const truncated = omitHunks || limitedHunks.length !== hunks.length;

  return {
    version: 1,
    path: String(path ?? ""),
    kind,
    oldLineCount: oldLines.length,
    newLineCount: newLines.length,
    added,
    removed,
    hunks: limitedHunks,
    skippedAfter: limitedHunks.length ? skippedAfter : 0,
    truncated,
    exactLineDiff,
    ...formatChanges,
  };
}

function countPatchChanges(patch: unknown) {
  let added = 0;
  let removed = 0;
  for (const line of String(patch ?? "").split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function resolveToolPath(cwd: unknown, toolPath: unknown): string {
  const raw = String(toolPath ?? "");
  const baseCwd = typeof cwd === "string" && cwd ? cwd : process.cwd();
  return isAbsolute(raw) ? raw : resolve(baseCwd, raw);
}

function mutationPathKey(filePath: string) {
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

export default function moltenForgeDiffExtension(pi: any) {
  const pendingMutations = new Map<string, any>();
  const activeMutationsByPath = new Map<string, Set<string>>();

  pi.on("tool_call", async (event: any, ctx: any) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    const toolPath = event.input?.path;
    if (typeof toolPath !== "string" || !toolPath) return;

    const absolutePath = resolveToolPath(ctx?.cwd, toolPath);
    const pathKey = mutationPathKey(absolutePath);
    const activeCalls = activeMutationsByPath.get(pathKey) ?? new Set<string>();
    const baselineConflict = activeCalls.size > 0;
    activeCalls.add(event.toolCallId);
    activeMutationsByPath.set(pathKey, activeCalls);

    // `undefined` means the snapshot failed or a same-path mutation is already
    // in flight. `null` specifically means the path did not exist.
    let before: string | null | undefined;
    if (!baselineConflict) {
      try {
        before = await readTextIfExists(absolutePath);
      } catch {
        // Diff capture must never block the actual Pi tool.
      }
    }

    pendingMutations.set(event.toolCallId, {
      toolName: event.toolName,
      path: toolPath,
      absolutePath,
      pathKey,
      before,
      baselineConflict,
    });
  });

  pi.on("tool_result", async (event: any) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    const pending = pendingMutations.get(event.toolCallId);
    pendingMutations.delete(event.toolCallId);
    if (!pending) return;
    const activeCalls = activeMutationsByPath.get(pending.pathKey);
    activeCalls?.delete(event.toolCallId);
    if (activeCalls?.size === 0) activeMutationsByPath.delete(pending.pathKey);
    const finalPath = typeof event.input?.path === "string" ? event.input.path : pending.path;
    // Another extension may rewrite tool inputs after our pre-hook. If the
    // target path changed, the captured baseline no longer belongs to this
    // operation, so prefer no diff over a misleading one.
    if (finalPath !== pending.path) return;

    let actualAfter: string | null | undefined;
    if (event.isError || event.toolName === "edit") {
      try {
        actualAfter = await readTextIfExists(pending.absolutePath);
      } catch {
        // A failed follow-up read should only disable the diff, never affect
        // the real tool result.
      }
    }

    if (event.toolName === "write") {
      const requestedAfter = typeof event.input?.content === "string" ? event.input.content : null;
      if (requestedAfter == null || pending.before === undefined) return;

      if (event.isError) {
        // Pi's write checks abort both before and after writeFile. It can
        // therefore report an error after the bytes were already written.
        // Only show a diff in that case when the filesystem confirms it.
        if (actualAfter !== requestedAfter) return;
        const diff = buildFileDiff(pending.path, pending.before, actualAfter);
        diff.applied = true;
        diff.executionError = true;
        return {
          details: {
            ...(event.details && typeof event.details === "object" ? event.details : {}),
            moltenForgeDiff: diff,
          },
        };
      }

      // On success the requested content is the authoritative result of this
      // tool call. Do not re-read here: a subsequent queued write to the same
      // path may already have started by the time tool_result is observed.
      const diff = buildFileDiff(pending.path, pending.before, requestedAfter);
      diff.applied = true;
      diff.executionError = false;
      return {
        details: {
          ...(event.details && typeof event.details === "object" ? event.details : {}),
          moltenForgeDiff: diff,
        },
      };
    }

    if (event.toolName === "edit" && event.isError) {
      if (pending.before === undefined || typeof actualAfter !== "string") return;
      // Normally a failed edit is a no-op. If the filesystem differs, retain
      // the real before/after state and flag it so the UI does not imply a
      // clean success.
      if (actualAfter === pending.before) return;
      const diff = buildFileDiff(pending.path, pending.before, actualAfter);
      diff.applied = true;
      diff.executionError = true;
      return {
        details: {
          ...(event.details && typeof event.details === "object" ? event.details : {}),
          moltenForgeDiff: diff,
        },
      };
    }

    if (event.toolName === "edit" && event.details && typeof event.details === "object") {
      const patch = typeof event.details.patch === "string" ? event.details.patch : "";
      const counts = countPatchChanges(patch);
      const oldLineCount = typeof pending.before === "string" ? splitLines(pending.before).length : undefined;
      const newLineCount = typeof actualAfter === "string"
        ? splitLines(actualAfter).length
        : (oldLineCount == null ? undefined : oldLineCount + counts.added - counts.removed);
      return {
        details: {
          ...event.details,
          moltenForgeFile: {
            path: pending.path,
            oldLineCount,
            newLineCount,
            ...(pending.before !== undefined && actualAfter !== undefined
              ? textFormatChanges(pending.before, actualAfter)
              : {}),
          },
        },
      };
    }
  });
}
