export type ToolRuntimeState = "running" | "done" | "error" | "interrupted" | undefined;

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : undefined;
}

function finitePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : undefined;
}

function isWindowsAbsolute(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(path);
}

function isPosixAbsolute(path: string) {
  return path.startsWith("/");
}

function normalizedForCompare(path: string, windows: boolean) {
  const normalized = path.replace(/[\\/]+$/g, "").replace(/[\\/]+/g, "/");
  return windows ? normalized.toLowerCase() : normalized;
}

/**
 * Keep Pi's path spelling/separator style, but shorten absolute paths that are
 * inside the current project. Paths outside cwd remain absolute.
 */
export function compactToolPath(pathValue: unknown, cwdValue: unknown) {
  if (typeof pathValue !== "string") return "";
  const path = pathValue.trim();
  if (!path) return "";
  if (typeof cwdValue !== "string" || !cwdValue.trim()) return path;

  const cwd = cwdValue.trim();
  const pathWindows = isWindowsAbsolute(path);
  const cwdWindows = isWindowsAbsolute(cwd);
  const pathPosix = isPosixAbsolute(path);
  const cwdPosix = isPosixAbsolute(cwd);

  // Relative tool paths are already the most useful display form.
  if (!pathWindows && !pathPosix) return path;
  if (pathWindows !== cwdWindows || pathPosix !== cwdPosix) return path;

  const normalizedPath = normalizedForCompare(path, pathWindows);
  const normalizedCwd = normalizedForCompare(cwd, pathWindows);
  if (normalizedPath === normalizedCwd) return ".";
  if (!normalizedPath.startsWith(`${normalizedCwd}/`)) return path;

  // normalizedForCompare only changes separator spelling/case. Walk components
  // instead of slicing the original string by the normalized character count.
  const cwdParts = cwd.replace(/[\\/]+$/g, "").split(/[\\/]+/).filter(Boolean);
  const pathParts = path.split(/[\\/]+/).filter(Boolean);
  const relativeParts = pathParts.slice(cwdParts.length);
  if (!relativeParts.length) return ".";
  const separator = path.includes("\\") ? "\\" : "/";
  return relativeParts.join(separator);
}

function toolPathFromArgs(args: unknown) {
  const record = asRecord(args);
  const value = record?.path ?? record?.filePath ?? record?.filepath ?? record?.file ?? record?.filename;
  return typeof value === "string" ? value : "";
}

function countReturnedLines(text: string) {
  if (!text) return 0;
  const normalized = text.replace(/\r\n?/g, "\n");
  const withoutTrailingNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  if (!withoutTrailingNewline) return 0;
  return withoutTrailingNewline.split("\n").length;
}

function readContinuationOffset(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const match = normalized.match(
    /(?:^|\n)\s*\[[^\]\n]*\bUse offset=(\d+)\s+to continue\.\s*\]\s*$/i,
  );
  if (!match) return undefined;
  return finitePositiveInteger(Number(match[1]));
}

function readTruncationOutputLines(details: unknown) {
  const detailsRecord = asRecord(details);
  const truncation = asRecord(detailsRecord?.truncation);
  if (!truncation || truncation.truncated !== true) return undefined;
  const outputLines = Number(truncation.outputLines);
  return Number.isFinite(outputLines) && outputLines >= 0 ? Math.floor(outputLines) : undefined;
}

function actualReadReturnedLines(text: string, offset: number, limit: number | undefined, details: unknown) {
  // Pi exposes structured truncation metadata when its own byte/line ceiling
  // truncates a Read. Prefer that over parsing human-readable output.
  const structuredOutputLines = readTruncationOutputLines(details);
  if (structuredOutputLines !== undefined) return structuredOutputLines;

  // User-provided Read limits do not currently populate details.truncation. Pi
  // instead appends a continuation footer such as:
  //   [103 more lines in file. Use offset=11 to continue.]
  // That footer (and the blank separator before it) is not part of the file.
  const continuationOffset = readContinuationOffset(text);
  if (continuationOffset !== undefined && continuationOffset > offset) {
    return continuationOffset - offset;
  }

  const counted = countReturnedLines(text);
  return limit === undefined ? counted : Math.min(counted, limit);
}

export type ReadToolSummaryParts = {
  path: string;
  range?: string;
};

export function readToolSummaryParts({
  args,
  output,
  state,
  cwd,
  details,
}: {
  args: unknown;
  output: string;
  state: ToolRuntimeState;
  cwd: string;
  details?: unknown;
}): ReadToolSummaryParts | null {
  const record = asRecord(args);
  const path = compactToolPath(toolPathFromArgs(args), cwd);
  if (!path) return null;

  const offset = finitePositiveInteger(record?.offset) ?? 1;
  const limit = finitePositiveInteger(record?.limit);
  const requestedPartial = record?.offset !== undefined || record?.limit !== undefined;
  const structuredPartial = readTruncationOutputLines(details) !== undefined;
  const footerPartial = readContinuationOffset(output) !== undefined;
  if (!requestedPartial && !structuredPartial && !footerPartial) return { path };

  const returnedLines = actualReadReturnedLines(output, offset, limit, details);
  if (state === "done" && returnedLines > 0) {
    return { path, range: `${offset}-${offset + returnedLines - 1}` };
  }
  if (state === "done" && structuredPartial && returnedLines === 0) return { path };
  if (limit !== undefined) return { path, range: `${offset}-${offset + limit - 1}` };
  return offset > 1 ? { path, range: `${offset}+` } : { path };
}

export function readToolSummary(input: Parameters<typeof readToolSummaryParts>[0]) {
  const summary = readToolSummaryParts(input);
  if (!summary) return "";
  return summary.range ? `${summary.path} · ${summary.range}` : summary.path;
}

export function fileMutationToolSummary(args: unknown, cwd: string) {
  return compactToolPath(toolPathFromArgs(args), cwd);
}

export function terminalInputPreview(input: string, maxChars = 200) {
  const value = input
    .replace(/^\s*\$\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value || maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…`;
}

/**
 * Pi tool updates may be cumulative snapshots or incremental chunks depending on
 * the tool/provider. Preserve prior visible output in both cases, and never let
 * an empty transport sentinel erase text already streamed.
 */
export function mergeStreamingToolOutput(previous: string, incoming: string) {
  if (!incoming) return previous;
  if (!previous) return incoming;
  if (incoming === previous || incoming.startsWith(previous)) return incoming;
  if (previous.endsWith(incoming)) return previous;
  return `${previous}${incoming}`;
}

export function formatCompactTokenCount(value: number) {
  const safe = Math.max(0, value);
  if (safe >= 1_000_000) {
    const scaled = safe / 1_000_000;
    return `${scaled.toFixed(safe >= 10_000_000 ? 0 : 1)}M`;
  }
  if (safe >= 1_000) {
    const scaled = safe / 1_000;
    return `${scaled.toFixed(safe >= 100_000 ? 0 : 1)}k`;
  }
  return `${Math.round(safe)}`;
}

export function compactionResultSummary(beforeValue: unknown, afterValue: unknown) {
  const before = typeof beforeValue === "number" && Number.isFinite(beforeValue) && beforeValue >= 0
    ? beforeValue
    : undefined;
  const after = typeof afterValue === "number" && Number.isFinite(afterValue) && afterValue >= 0
    ? afterValue
    : undefined;

  if (before !== undefined && after !== undefined) {
    const saved = Math.max(0, before - after);
    return `${formatCompactTokenCount(before)} → ${formatCompactTokenCount(after)} (−${formatCompactTokenCount(saved)})`;
  }
  if (before !== undefined) return `Context compacted from ${formatCompactTokenCount(before)} tokens.`;
  if (after !== undefined) return `Context compacted to ${formatCompactTokenCount(after)} tokens.`;
  return "Context compacted.";
}
