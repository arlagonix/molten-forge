// Workspace file tools for the Electron main process.
//
// Implements the built-in file_read / file_find / file_search_text /
// file_replace_text / file_create / file_delete tools. Every operation is
// sandboxed to the chat's approved workspace roots: paths are resolved through
// fs.realpath and checked with pathIsInside so symlinks and ".." traversal
// cannot escape a root.

import { shell } from "electron";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import {
  FILE_READ_TOOL_NAME,
  FILE_FIND_TOOL_NAME,
  FILE_SEARCH_TEXT_TOOL_NAME,
  FILE_REPLACE_TEXT_TOOL_NAME,
  FILE_CREATE_TOOL_NAME,
  FILE_DELETE_TOOL_NAME,
} from "../src/lib/ai-chat/file-tool-names";
import {
  getErrorMessage,
  isPlainObject,
  normalizeWorkspaceRoots,
  readOptionalString,
  readOptionalStringArray,
  readPositiveIntegerArg,
  readRequiredRawString,
  readRequiredString,
  stringifyToolResult,
  type ToolExecutionContext,
  type WorkspaceRoot,
} from "./tool-utils";

type FileToolChangePreviewRow = {
  type: "add" | "delete" | "context";
  text: string;
  oldLine?: number;
  newLine?: number;
};

type FileToolChangePreview = {
  kind: "create" | "replace" | "delete";
  rootId?: string;
  rootName?: string;
  path: string;
  title?: string;
  truncated?: boolean;
  rows: FileToolChangePreviewRow[];
};

type FileToolResult = {
  content: string;
  isError: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: false;
  changePreview?: FileToolChangePreview;
};

const FILE_TOOL_READ_WINDOW_LINES = 100;
const FILE_TOOL_MAX_READ_OFFSET = 1_000_000_000;
const FILE_TOOL_MAX_READ_CHARS = 100_000;
const FILE_TOOL_MAX_TEXT_FILE_BYTES = 5_000_000;
const FILE_TOOL_MAX_SEARCH_FILE_BYTES = 2_000_000;
const FILE_TOOL_MAX_RESULTS = 200;
const FILE_TOOL_CHANGE_PREVIEW_MAX_LINES = 200;
const FILE_TOOL_CHANGE_PREVIEW_MAX_LINE_CHARS = 500;
const FILE_TOOL_DEFAULT_EXCLUDES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "release",
  "out",
  "coverage",
  ".turbo",
]);
const FILE_TOOL_TEXT_SAMPLE_BYTES = 64 * 1024;
const FILE_TOOL_TEXT_EXTENSIONS = new Set([
  ".astro",
  ".bash",
  ".bat",
  ".c",
  ".cc",
  ".cfg",
  ".cjs",
  ".clj",
  ".cmd",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".cts",
  ".dart",
  ".diff",
  ".dockerignore",
  ".editorconfig",
  ".ejs",
  ".env",
  ".fish",
  ".gitattributes",
  ".gitignore",
  ".go",
  ".gql",
  ".gradle",
  ".graphql",
  ".groovy",
  ".h",
  ".handlebars",
  ".hbs",
  ".hcl",
  ".hpp",
  ".htm",
  ".html",
  ".http",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".json5",
  ".jsonc",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lock",
  ".log",
  ".lua",
  ".mjs",
  ".md",
  ".mdx",
  ".mts",
  ".patch",
  ".php",
  ".pl",
  ".properties",
  ".ps1",
  ".pug",
  ".py",
  ".r",
  ".rb",
  ".rest",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".svx",
  ".swift",
  ".tf",
  ".tfvars",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".webmanifest",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);
const FILE_TOOL_BINARY_EXTENSIONS = new Set([
  ".7z",
  ".a",
  ".avi",
  ".avif",
  ".bin",
  ".bmp",
  ".bz2",
  ".class",
  ".db",
  ".dll",
  ".dmg",
  ".doc",
  ".docx",
  ".dylib",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".heic",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".rar",
  ".sqlite",
  ".so",
  ".tar",
  ".tgz",
  ".ttf",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".zip",
]);
const FILE_TOOL_TEXT_FILENAMES = new Set([
  ".dockerignore",
  ".editorconfig",
  ".env",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".prettierrc",
  "dockerfile",
  "license",
  "makefile",
  "readme",
]);

function pathIsInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function getRealWorkspaceRoot(root: WorkspaceRoot) {
  const realRootPath = await fs.realpath(path.resolve(root.path));
  const stats = await fs.stat(realRootPath);
  if (!stats.isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${root.name}`);
  }
  return { ...root, realPath: realRootPath };
}

async function resolveWorkspaceRootForPath(
  roots: WorkspaceRoot[],
  requestedPath: string,
  rootId?: string,
) {
  if (roots.length === 0) {
    throw new Error("No workspace folders are configured for this chat.");
  }

  if (rootId?.trim()) {
    const root = roots.find((candidate) => candidate.id === rootId.trim());
    if (!root) throw new Error(`Workspace root not found: ${rootId}`);
    return getRealWorkspaceRoot(root);
  }

  if (!path.isAbsolute(requestedPath)) {
    if (roots.length === 1) return getRealWorkspaceRoot(roots[0]);
    throw new Error(
      "rootId is required when the chat has multiple workspace roots and the path is relative.",
    );
  }

  const resolvedPath = path.resolve(requestedPath);
  for (const root of roots) {
    const realRoot = await getRealWorkspaceRoot(root);
    let realTarget = resolvedPath;
    try {
      realTarget = await fs.realpath(resolvedPath);
    } catch {
      // Missing paths are resolved against the original absolute path for error reporting.
    }
    if (pathIsInside(realRoot.realPath, realTarget)) return realRoot;
  }

  throw new Error(
    "The requested path is outside all approved workspace roots.",
  );
}

async function resolveWorkspaceTarget(
  context: ToolExecutionContext,
  requestedPath: string,
  rootId?: string,
) {
  const roots = normalizeWorkspaceRoots(context.workspaceRoots);
  const root = await resolveWorkspaceRootForPath(roots, requestedPath, rootId);
  const targetPath = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(root.realPath, requestedPath);

  let realTargetPath: string;
  try {
    realTargetPath = await fs.realpath(targetPath);
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === "ENOENT")
      throw new Error(`Path does not exist: ${requestedPath}`);
    throw error;
  }

  if (!pathIsInside(root.realPath, realTargetPath)) {
    throw new Error(
      "The requested path resolves outside the approved workspace root.",
    );
  }

  return {
    root,
    absolutePath: targetPath,
    realPath: realTargetPath,
    relativePath: path.relative(root.realPath, realTargetPath) || ".",
  };
}

async function findNearestExistingParent(startPath: string, rootPath: string) {
  let currentPath = path.resolve(startPath);

  while (pathIsInside(rootPath, currentPath)) {
    try {
      const stats = await fs.stat(currentPath);
      if (!stats.isDirectory()) {
        throw new Error(`Existing path is not a directory: ${currentPath}`);
      }
      return currentPath;
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code !== "ENOENT") throw error;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }

  throw new Error(
    "Could not resolve a valid parent inside the approved workspace root.",
  );
}

async function resolveWorkspaceTargetForCreate(
  context: ToolExecutionContext,
  requestedPath: string,
  rootId?: string,
  createParents = false,
) {
  const roots = normalizeWorkspaceRoots(context.workspaceRoots);
  const root = await resolveWorkspaceRootForPath(roots, requestedPath, rootId);
  const targetPath = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(root.realPath, requestedPath);

  if (!pathIsInside(root.realPath, targetPath)) {
    throw new Error(
      "The requested path is outside the approved workspace root.",
    );
  }

  try {
    await fs.lstat(targetPath);
    throw new Error(`Path already exists: ${requestedPath}`);
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code !== "ENOENT") throw error;
  }

  const parentPath = path.dirname(targetPath);
  if (!pathIsInside(root.realPath, parentPath)) {
    throw new Error(
      "The requested parent folder is outside the approved workspace root.",
    );
  }

  if (createParents) {
    const nearestParent = await findNearestExistingParent(
      parentPath,
      root.realPath,
    );
    const realNearestParent = await fs.realpath(nearestParent);
    if (!pathIsInside(root.realPath, realNearestParent)) {
      throw new Error(
        "The requested parent folder resolves outside the approved workspace root.",
      );
    }
    await fs.mkdir(parentPath, { recursive: true });
  }

  const realParentPath = await fs.realpath(parentPath);
  const parentStats = await fs.stat(realParentPath);
  if (!parentStats.isDirectory())
    throw new Error("Parent path is not a directory.");
  if (!pathIsInside(root.realPath, realParentPath)) {
    throw new Error(
      "The requested parent folder resolves outside the approved workspace root.",
    );
  }

  return {
    root,
    absolutePath: targetPath,
    realParentPath,
    relativePath:
      path.relative(root.realPath, targetPath) || path.basename(targetPath),
  };
}

function buildFileToolResult(
  payload: unknown,
  isError = false,
  changePreview?: FileToolChangePreview,
): FileToolResult {
  const content = stringifyToolResult(payload);
  return {
    content,
    isError,
    exitCode: isError ? 1 : 0,
    stdout: content,
    stderr: isError ? content : "",
    timedOut: false,
    changePreview,
  };
}

function getFileExtension(filePath: string) {
  return path.extname(filePath).toLowerCase();
}

function getFileBaseName(filePath: string) {
  return path.basename(filePath).toLowerCase();
}

function isKnownBinaryFilePath(filePath: string) {
  return FILE_TOOL_BINARY_EXTENSIONS.has(getFileExtension(filePath));
}

function isKnownTextFilePath(filePath: string) {
  const extension = getFileExtension(filePath);
  const baseName = getFileBaseName(filePath);
  return (
    FILE_TOOL_TEXT_EXTENSIONS.has(extension) ||
    FILE_TOOL_TEXT_FILENAMES.has(baseName)
  );
}

function looksLikeTextBuffer(buffer: Buffer) {
  if (buffer.length === 0) return true;
  if (buffer.includes(0)) return false;

  let suspiciousBytes = 0;
  for (const byte of buffer) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte === 127) suspiciousBytes += 1;
  }
  if (suspiciousBytes / buffer.length > 0.01) return false;

  const decoded = buffer.toString("utf8");
  if (!decoded) return true;
  const replacementCharacters = decoded.match(/�/g)?.length ?? 0;
  return replacementCharacters / decoded.length < 0.01;
}

async function readFileSample(filePath: string, size: number) {
  if (size <= 0) return Buffer.alloc(0);
  const handle = await fs.open(filePath, "r");
  try {
    const sample = Buffer.alloc(size);
    const { bytesRead } = await handle.read(sample, 0, size, 0);
    return sample.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function assertTextFile(filePath: string, maxBytes: number) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) throw new Error("Path is not a file.");
  if (stats.size > maxBytes) {
    throw new Error(
      `File is too large (${stats.size} bytes). Maximum is ${maxBytes} bytes.`,
    );
  }
  if (isKnownBinaryFilePath(filePath)) {
    throw new Error(
      `Refusing to treat this binary file type as text: ${getFileExtension(filePath) || "no extension"}`,
    );
  }

  const sampleSize = Math.min(FILE_TOOL_TEXT_SAMPLE_BYTES, stats.size);
  const sample = await readFileSample(filePath, sampleSize);
  if (!looksLikeTextBuffer(sample)) {
    const fileKind = isKnownTextFilePath(filePath)
      ? "known text file type with binary-looking contents"
      : "file that appears to be binary";
    throw new Error(`Refusing to read a ${fileKind}.`);
  }

  return stats;
}

function isLikelyTextFile(filePath: string) {
  return !isKnownBinaryFilePath(filePath);
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(0, maxChars), truncated: true };
}


function readOptionalPositiveIntegerArg(args: unknown, key: string, max: number) {
  if (!isPlainObject(args) || !(key in args)) return undefined;
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return Math.min(Math.floor(value), max);
}

function normalizeOptionalLineRange(args: unknown) {
  const startLine = readOptionalPositiveIntegerArg(
    args,
    "startLine",
    FILE_TOOL_MAX_READ_OFFSET,
  );
  const endLine = readOptionalPositiveIntegerArg(
    args,
    "endLine",
    FILE_TOOL_MAX_READ_OFFSET,
  );

  if (
    startLine !== undefined &&
    endLine !== undefined &&
    endLine < startLine
  ) {
    throw new Error("endLine must be greater than or equal to startLine.");
  }

  return { startLine, endLine };
}

function splitLinesForPreview(text: string) {
  if (!text) return [];
  return text.split(/\r?\n/);
}

function truncatePreviewLine(text: string) {
  if (text.length <= FILE_TOOL_CHANGE_PREVIEW_MAX_LINE_CHARS) return text;
  return `${text.slice(0, FILE_TOOL_CHANGE_PREVIEW_MAX_LINE_CHARS)}…`;
}

function limitChangePreviewRows(rows: FileToolChangePreviewRow[]) {
  if (rows.length <= FILE_TOOL_CHANGE_PREVIEW_MAX_LINES) {
    return { rows, truncated: false };
  }

  return {
    rows: rows.slice(0, FILE_TOOL_CHANGE_PREVIEW_MAX_LINES),
    truncated: true,
  };
}

function createChangePreview({
  kind,
  rootId,
  rootName,
  path: filePath,
  title,
  rows,
}: {
  kind: FileToolChangePreview["kind"];
  rootId?: string;
  rootName?: string;
  path: string;
  title?: string;
  rows: FileToolChangePreviewRow[];
}): FileToolChangePreview {
  const limited = limitChangePreviewRows(rows);
  return {
    kind,
    rootId,
    rootName,
    path: filePath,
    title,
    truncated: limited.truncated,
    rows: limited.rows,
  };
}

function createAddedRows(text: string, startLine = 1): FileToolChangePreviewRow[] {
  return splitLinesForPreview(text).map((line, index) => ({
    type: "add",
    text: truncatePreviewLine(line),
    newLine: startLine + index,
  }));
}

function createDeletedRows(text: string, startLine = 1): FileToolChangePreviewRow[] {
  return splitLinesForPreview(text).map((line, index) => ({
    type: "delete",
    text: truncatePreviewLine(line),
    oldLine: startLine + index,
  }));
}

function getLineStartOffsets(text: string) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function getLineNumberForOffset(lineStarts: number[], offset: number) {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }

  return Math.max(1, high + 1);
}

function getLineRangeOffsets(
  text: string,
  startLineArg?: number,
  endLineArg?: number,
) {
  const lineStarts = getLineStartOffsets(text);
  const totalLines = text.length === 0 ? 0 : lineStarts.length;
  const startLine = startLineArg ?? 1;
  const endLine = endLineArg ?? totalLines;

  if (totalLines === 0) {
    return {
      lineStarts,
      totalLines,
      startLine,
      endLine,
      startOffset: 0,
      endOffset: 0,
    };
  }

  const clampedStartLine = Math.min(startLine, totalLines + 1);
  const clampedEndLine = Math.min(endLine, totalLines);
  const startOffset =
    clampedStartLine <= totalLines ? lineStarts[clampedStartLine - 1] : text.length;
  const endOffset =
    clampedEndLine >= totalLines
      ? text.length
      : clampedEndLine >= clampedStartLine
        ? lineStarts[clampedEndLine]
        : startOffset;

  return {
    lineStarts,
    totalLines,
    startLine: clampedStartLine,
    endLine: clampedEndLine,
    startOffset,
    endOffset,
  };
}

function findAllOccurrences(text: string, needle: string) {
  const positions: number[] = [];
  if (!needle) return positions;

  let searchFrom = 0;
  while (searchFrom <= text.length) {
    const index = text.indexOf(needle, searchFrom);
    if (index < 0) break;
    positions.push(index);
    searchFrom = index + needle.length;
  }

  return positions;
}

async function tryReadTextFileForChangePreview(filePath: string, size: number) {
  if (size > FILE_TOOL_MAX_TEXT_FILE_BYTES) return undefined;
  if (!isLikelyTextFile(filePath)) return undefined;

  try {
    const sampleSize = Math.min(FILE_TOOL_TEXT_SAMPLE_BYTES, size);
    const sample = await readFileSample(filePath, sampleSize);
    if (!looksLikeTextBuffer(sample)) return undefined;
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function readTextFileWindow(filePath: string, offset: number) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  const lines: string[] = [];
  let lineNumber = 0;
  const requestedEndLine = offset + FILE_TOOL_READ_WINDOW_LINES - 1;

  try {
    for await (const line of reader) {
      lineNumber += 1;

      if (lineNumber >= offset && lineNumber <= requestedEndLine) {
        lines.push(line);
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  const startLine = lines.length > 0 ? offset : 0;
  const endLine = lines.length > 0 ? offset + lines.length - 1 : 0;
  const totalLines = lineNumber;
  const nextOffset = endLine > 0 && endLine < totalLines ? endLine + 1 : null;
  const rawContent = lines.join("\n");
  const truncated = truncateText(rawContent, FILE_TOOL_MAX_READ_CHARS);

  return {
    offset,
    startLine,
    endLine,
    totalLines,
    nextOffset,
    truncated: truncated.truncated,
    content: truncated.text,
  };
}

async function executeFileReadTool(
  args: unknown,
  context: ToolExecutionContext,
) {
  const requestedPath = readRequiredString(args, "path");
  const rootId = readOptionalString(args, "rootId");
  const offset = readPositiveIntegerArg(
    args,
    "offset",
    1,
    FILE_TOOL_MAX_READ_OFFSET,
  );
  const target = await resolveWorkspaceTarget(context, requestedPath, rootId);
  const stats = await assertTextFile(
    target.realPath,
    FILE_TOOL_MAX_TEXT_FILE_BYTES,
  );
  const window = await readTextFileWindow(target.realPath, offset);

  return buildFileToolResult({
    ok: true,
    type: "file",
    rootId: target.root.id,
    rootName: target.root.name,
    path: target.relativePath,
    offset: window.offset,
    startLine: window.startLine,
    endLine: window.endLine,
    totalLines: window.totalLines,
    nextOffset: window.nextOffset,
    bytes: stats.size,
    truncated: window.truncated,
    content: window.content,
  });
}

function normalizeExtensions(values: string[]) {
  return new Set(
    values
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .map((value) => (value.startsWith(".") ? value : `.${value}`)),
  );
}

function shouldSkipPath(
  relativePath: string,
  direntName: string,
  excludes: string[],
) {
  if (FILE_TOOL_DEFAULT_EXCLUDES.has(direntName)) return true;
  const normalizedRelative = relativePath
    .split(path.sep)
    .join("/")
    .toLowerCase();
  return excludes.some((item) => {
    const needle = item.split(path.sep).join("/").toLowerCase();
    return needle && normalizedRelative.includes(needle);
  });
}

async function collectWorkspaceFiles({
  context,
  rootId,
  include,
  exclude,
  maxResults,
  includeDirectories,
}: {
  context: ToolExecutionContext;
  rootId?: string;
  include: string[];
  exclude: string[];
  maxResults: number;
  includeDirectories: boolean;
}) {
  const roots = normalizeWorkspaceRoots(context.workspaceRoots);
  const selectedRoots = rootId?.trim()
    ? roots.filter((root) => root.id === rootId.trim())
    : roots;
  if (rootId?.trim() && selectedRoots.length === 0) {
    throw new Error(`Workspace root not found: ${rootId}`);
  }
  if (selectedRoots.length === 0) {
    throw new Error("No workspace folders are configured for this chat.");
  }

  const includeExts = normalizeExtensions(include);
  const results: Array<{
    root: WorkspaceRoot & { realPath: string };
    absolutePath: string;
    realPath: string;
    relativePath: string;
    type: "file" | "directory";
  }> = [];

  for (const root of selectedRoots) {
    const realRoot = await getRealWorkspaceRoot(root);
    const stack = [realRoot.realPath];

    while (stack.length > 0 && results.length < maxResults) {
      const currentDir = stack.pop();
      if (!currentDir) continue;

      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name));

      for (const entry of entries) {
        if (results.length >= maxResults) break;
        const absolutePath = path.join(currentDir, entry.name);
        const relativePath = path.relative(realRoot.realPath, absolutePath);
        if (shouldSkipPath(relativePath, entry.name, exclude)) continue;
        if (entry.isSymbolicLink()) continue;

        if (entry.isDirectory()) {
          if (includeDirectories) {
            results.push({
              root: realRoot,
              absolutePath,
              realPath: absolutePath,
              relativePath,
              type: "directory",
            });
          }
          stack.push(absolutePath);
          continue;
        }

        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (includeExts.size > 0 && !includeExts.has(ext)) continue;

        results.push({
          root: realRoot,
          absolutePath,
          realPath: absolutePath,
          relativePath,
          type: "file",
        });
      }
    }
  }

  return results;
}

async function executeFileFindTool(
  args: unknown,
  context: ToolExecutionContext,
) {
  const query = readOptionalString(args, "query")?.trim().toLowerCase() ?? "";
  const rootId = readOptionalString(args, "rootId");
  const include = readOptionalStringArray(args, "include");
  const exclude = readOptionalStringArray(args, "exclude");
  const maxResults = readPositiveIntegerArg(
    args,
    "maxResults",
    50,
    FILE_TOOL_MAX_RESULTS,
  );
  const candidates = await collectWorkspaceFiles({
    context,
    rootId,
    include,
    exclude,
    maxResults: Math.min(maxResults * 5, FILE_TOOL_MAX_RESULTS),
    includeDirectories: true,
  });

  const matches = candidates
    .filter((candidate) => {
      if (!query) return true;
      return candidate.relativePath.toLowerCase().includes(query);
    })
    .slice(0, maxResults)
    .map((candidate) => ({
      rootId: candidate.root.id,
      rootName: candidate.root.name,
      path: candidate.relativePath,
      type: candidate.type,
    }));

  return buildFileToolResult({
    ok: true,
    query,
    count: matches.length,
    results: matches,
  });
}

function makeSearchSnippet(
  line: string,
  query: string,
  caseSensitive: boolean,
) {
  const haystack = caseSensitive ? line : line.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const index = haystack.indexOf(needle);
  if (index < 0) return line.slice(0, 240);
  const start = Math.max(0, index - 80);
  const end = Math.min(line.length, index + needle.length + 120);
  return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
}

async function searchTextInCandidate({
  candidate,
  query,
  caseSensitive,
  maxResults,
  startLine,
  endLine,
}: {
  candidate: {
    root: WorkspaceRoot & { realPath: string };
    absolutePath: string;
    realPath: string;
    relativePath: string;
  };
  query: string;
  caseSensitive: boolean;
  maxResults: number;
  startLine?: number;
  endLine?: number;
}) {
  const stats = await assertTextFile(
    candidate.absolutePath,
    FILE_TOOL_MAX_SEARCH_FILE_BYTES,
  );
  const text = await fs.readFile(candidate.absolutePath, "utf8");
  const lines = text.split(/\r?\n/);
  const totalLines = text.length === 0 ? 0 : lines.length;
  const rangeStartLine = startLine ?? 1;
  const rangeEndLine = endLine ?? totalLines;
  const clampedStartLine = Math.max(1, Math.min(rangeStartLine, totalLines + 1));
  const clampedEndLine = Math.max(
    0,
    Math.min(rangeEndLine, totalLines),
  );
  const needle = caseSensitive ? query : query.toLowerCase();
  const results: Array<{
    rootId: string;
    rootName: string;
    path: string;
    line: number;
    snippet: string;
  }> = [];

  if (clampedStartLine <= clampedEndLine) {
    for (
      let lineNumber = clampedStartLine;
      lineNumber <= clampedEndLine;
      lineNumber += 1
    ) {
      const line = lines[lineNumber - 1] ?? "";
      const haystack = caseSensitive ? line : line.toLowerCase();
      if (!haystack.includes(needle)) continue;
      results.push({
        rootId: candidate.root.id,
        rootName: candidate.root.name,
        path: candidate.relativePath,
        line: lineNumber,
        snippet: makeSearchSnippet(line, query, caseSensitive),
      });
      if (results.length >= maxResults) break;
    }
  }

  return {
    stats,
    totalLines,
    startLine: clampedStartLine,
    endLine: clampedEndLine,
    results,
  };
}

async function executeFileSearchTextTool(
  args: unknown,
  context: ToolExecutionContext,
) {
  const query = readRequiredString(args, "query");
  const rootId = readOptionalString(args, "rootId");
  const requestedPath = readOptionalString(args, "path")?.trim();
  const include = readOptionalStringArray(args, "include");
  const exclude = readOptionalStringArray(args, "exclude");
  const caseSensitive = isPlainObject(args) && args.caseSensitive === true;
  const { startLine, endLine } = normalizeOptionalLineRange(args);
  const maxResults = readPositiveIntegerArg(
    args,
    "maxResults",
    50,
    FILE_TOOL_MAX_RESULTS,
  );

  if ((startLine !== undefined || endLine !== undefined) && !requestedPath) {
    throw new Error("startLine and endLine can only be used when path is provided.");
  }

  if (requestedPath) {
    const target = await resolveWorkspaceTarget(context, requestedPath, rootId);
    const searchResult = await searchTextInCandidate({
      candidate: {
        root: target.root,
        absolutePath: target.realPath,
        realPath: target.realPath,
        relativePath: target.relativePath,
      },
      query,
      caseSensitive,
      maxResults,
      startLine,
      endLine,
    });

    return buildFileToolResult({
      ok: true,
      query,
      rootId: target.root.id,
      rootName: target.root.name,
      path: target.relativePath,
      startLine: searchResult.startLine,
      endLine: searchResult.endLine,
      totalLines: searchResult.totalLines,
      bytes: searchResult.stats.size,
      count: searchResult.results.length,
      results: searchResult.results,
    });
  }

  const candidates = await collectWorkspaceFiles({
    context,
    rootId,
    include,
    exclude,
    maxResults: FILE_TOOL_MAX_RESULTS * 5,
    includeDirectories: false,
  });
  const results: Array<{
    rootId: string;
    rootName: string;
    path: string;
    line: number;
    snippet: string;
  }> = [];

  for (const candidate of candidates) {
    if (results.length >= maxResults) break;
    if (!isLikelyTextFile(candidate.absolutePath)) continue;

    try {
      const searchResult = await searchTextInCandidate({
        candidate,
        query,
        caseSensitive,
        maxResults: maxResults - results.length,
      });
      results.push(...searchResult.results);
    } catch {
      continue;
    }
  }

  return buildFileToolResult({
    ok: true,
    query,
    count: results.length,
    results,
  });
}

async function executeFileReplaceTextTool(
  args: unknown,
  context: ToolExecutionContext,
) {
  const requestedPath = readRequiredString(args, "path");
  const oldText = readRequiredRawString(args, "oldText");
  const newText = readOptionalString(args, "newText") ?? "";
  const rootId = readOptionalString(args, "rootId");
  const { startLine, endLine } = normalizeOptionalLineRange(args);
  const expectedReplacements =
    isPlainObject(args) &&
    typeof args.expectedReplacements === "number" &&
    Number.isFinite(args.expectedReplacements)
      ? Math.floor(args.expectedReplacements)
      : undefined;

  const target = await resolveWorkspaceTarget(context, requestedPath, rootId);
  const stats = await assertTextFile(
    target.realPath,
    FILE_TOOL_MAX_TEXT_FILE_BYTES,
  );
  const current = await fs.readFile(target.realPath, "utf8");
  const lineRange = getLineRangeOffsets(current, startLine, endLine);
  const scopedCurrent = current.slice(lineRange.startOffset, lineRange.endOffset);
  const matchPositions = findAllOccurrences(scopedCurrent, oldText);
  const replacementCount = matchPositions.length;

  if (replacementCount === 0) {
    const scopeText =
      startLine !== undefined || endLine !== undefined
        ? ` within lines ${lineRange.startLine}-${lineRange.endLine}`
        : "";
    throw new Error(`oldText was not found in the target file${scopeText}.`);
  }
  if (expectedReplacements === undefined) {
    if (replacementCount > 1) {
      throw new Error(
        `oldText matches ${replacementCount} times in the selected scope. Add surrounding context to make it unique, narrow startLine/endLine, or set expectedReplacements to ${replacementCount} to replace every match intentionally.`,
      );
    }
  } else if (replacementCount !== expectedReplacements) {
    throw new Error(
      `Expected ${expectedReplacements} replacement(s), but found ${replacementCount}.`,
    );
  }

  const nextScoped = scopedCurrent.split(oldText).join(newText);
  const next = `${current.slice(0, lineRange.startOffset)}${nextScoped}${current.slice(lineRange.endOffset)}`;
  const tempPath = `${target.realPath}.chatforge-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(tempPath, next, "utf8");
  await fs.rename(tempPath, target.realPath);

  const rows: FileToolChangePreviewRow[] = [];
  for (const matchPosition of matchPositions) {
    const oldStartLine = getLineNumberForOffset(
      lineRange.lineStarts,
      lineRange.startOffset + matchPosition,
    );
    rows.push(...createDeletedRows(oldText, oldStartLine));
    rows.push(...createAddedRows(newText, oldStartLine));
  }
  const changePreview = createChangePreview({
    kind: "replace",
    rootId: target.root.id,
    rootName: target.root.name,
    path: target.relativePath,
    title: `Replaced ${replacementCount} occurrence${replacementCount === 1 ? "" : "s"}`,
    rows,
  });

  return buildFileToolResult(
    {
      ok: true,
      rootId: target.root.id,
      rootName: target.root.name,
      path: target.relativePath,
      bytesBefore: stats.size,
      bytesAfter: Buffer.byteLength(next, "utf8"),
      replacements: replacementCount,
      ...(startLine !== undefined || endLine !== undefined
        ? {
            scopeStartLine: lineRange.startLine,
            scopeEndLine: lineRange.endLine,
          }
        : {}),
    },
    false,
    changePreview,
  );
}

async function executeFileCreateTool(
  args: unknown,
  context: ToolExecutionContext,
) {
  const requestedPath = readRequiredString(args, "path");
  const content = readOptionalString(args, "content") ?? "";
  const rootId = readOptionalString(args, "rootId");
  const createParents = isPlainObject(args) && args.createParents === true;

  if (Buffer.byteLength(content, "utf8") > FILE_TOOL_MAX_TEXT_FILE_BYTES) {
    throw new Error(
      `Content is too large. Maximum is ${FILE_TOOL_MAX_TEXT_FILE_BYTES} bytes.`,
    );
  }

  const target = await resolveWorkspaceTargetForCreate(
    context,
    requestedPath,
    rootId,
    createParents,
  );

  if (!isLikelyTextFile(target.absolutePath)) {
    throw new Error(
      `Refusing to create this file type as text: ${path.extname(target.absolutePath) || "no extension"}`,
    );
  }

  await fs.writeFile(target.absolutePath, content, {
    encoding: "utf8",
    flag: "wx",
  });

  const changePreview = createChangePreview({
    kind: "create",
    rootId: target.root.id,
    rootName: target.root.name,
    path: target.relativePath,
    title: "Created file",
    rows: createAddedRows(content),
  });

  return buildFileToolResult(
    {
      ok: true,
      rootId: target.root.id,
      rootName: target.root.name,
      path: target.relativePath,
      bytes: Buffer.byteLength(content, "utf8"),
      createdParents: createParents,
    },
    false,
    changePreview,
  );
}

async function executeFileDeleteTool(
  args: unknown,
  context: ToolExecutionContext,
) {
  const requestedPath = readRequiredString(args, "path");
  const rootId = readOptionalString(args, "rootId");
  const target = await resolveWorkspaceTarget(context, requestedPath, rootId);
  const linkStats = await fs.lstat(target.absolutePath);
  if (linkStats.isSymbolicLink()) {
    throw new Error("file_delete does not delete symbolic links.");
  }

  const stats = await fs.stat(target.realPath);
  if (!stats.isFile()) {
    throw new Error(
      "file_delete only supports files. Folder deletion is not supported.",
    );
  }

  const deletedContent = await tryReadTextFileForChangePreview(
    target.realPath,
    stats.size,
  );
  const changePreview = deletedContent
    ? createChangePreview({
        kind: "delete",
        rootId: target.root.id,
        rootName: target.root.name,
        path: target.relativePath,
        title: "Deleted file",
        rows: createDeletedRows(deletedContent),
      })
    : undefined;

  await shell.trashItem(target.absolutePath);

  return buildFileToolResult(
    {
      ok: true,
      rootId: target.root.id,
      rootName: target.root.name,
      path: target.relativePath,
      bytes: stats.size,
      deletedVia: "trash",
    },
    false,
    changePreview,
  );
}

export async function executeFileTool(
  toolName: string,
  args: unknown,
  context: ToolExecutionContext,
) {
  try {
    if (toolName === FILE_READ_TOOL_NAME)
      return executeFileReadTool(args, context);
    if (toolName === FILE_FIND_TOOL_NAME)
      return executeFileFindTool(args, context);
    if (toolName === FILE_SEARCH_TEXT_TOOL_NAME)
      return executeFileSearchTextTool(args, context);
    if (toolName === FILE_REPLACE_TEXT_TOOL_NAME)
      return executeFileReplaceTextTool(args, context);
    if (toolName === FILE_CREATE_TOOL_NAME)
      return executeFileCreateTool(args, context);
    if (toolName === FILE_DELETE_TOOL_NAME)
      return executeFileDeleteTool(args, context);
    throw new Error(`Unknown file tool: ${toolName}`);
  } catch (error) {
    const payload = { ok: false, error: getErrorMessage(error) };
    return buildFileToolResult(payload, true);
  }
}
