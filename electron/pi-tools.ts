import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { BASH_TOOL_NAME, EDIT_TOOL_NAME, READ_TOOL_NAME, WRITE_TOOL_NAME } from "../src/lib/ai-chat/file-tool-names";
import type { FileToolChangePreview, TerminalExecutionResult, TerminalStreamEvent, ToolCommandResult } from "../src/lib/ai-chat/types";
import {
  getErrorMessage,
  isPlainObject,
  normalizeWorkspaceRoots,
  readRequiredRawString,
  readRequiredString,
  stringifyToolResult,
  type ToolExecutionContext,
  type WorkspaceRoot,
} from "./tool-utils";

const DEFAULT_MAX_LINES = 2_000;
const DEFAULT_MAX_BYTES = 128 * 1024;
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const fileMutationQueues = new Map<string, Promise<unknown>>();

type StreamEventCallback = (event: TerminalStreamEvent) => void;

type ResolvedToolPath = {
  root: WorkspaceRoot;
  requestedPath: string;
  absolutePath: string;
  relativePath: string;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Tool execution was cancelled.");
}

function normalizeContextTimeoutMs(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.round(value), 10 * 60_000)
    : 0;
}

function withConfiguredTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  toolName: string,
): Promise<T> {
  if (timeoutMs <= 0) return task;

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${toolName} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);

    task.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function getDefaultUserWorkspace(): WorkspaceRoot {
  const homePath = os.homedir();
  return {
    id: "home",
    name: path.basename(homePath) || "Home",
    path: homePath,
    kind: "manual",
  };
}

function getSelectedWorkspace(context: ToolExecutionContext): WorkspaceRoot {
  const roots = normalizeWorkspaceRoots(context.workspaceRoots);
  return roots.find((candidate) => candidate.kind !== "skill") ?? getDefaultUserWorkspace();
}

function getToolRoots(context: ToolExecutionContext): WorkspaceRoot[] {
  const roots = normalizeWorkspaceRoots(context.workspaceRoots);
  const hasPrimaryRoot = roots.some((candidate) => candidate.kind !== "skill");
  return hasPrimaryRoot ? roots : [getDefaultUserWorkspace(), ...roots];
}

function isSubPathOrSame(candidate: string, parent: string) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realpathIfExists(filePath: string) {
  try {
    return await fs.realpath(filePath);
  } catch {
    return undefined;
  }
}

async function resolveToolPath(
  requestedPath: string,
  context: ToolExecutionContext,
  options: { forWrite?: boolean } = {},
): Promise<ResolvedToolPath> {
  const roots = getToolRoots(context);
  const primaryRoot = roots.find((candidate) => candidate.kind !== "skill") ?? getDefaultUserWorkspace();

  const trimmedPath = requestedPath.trim();
  if (!trimmedPath) throw new Error("Path is required.");

  const primaryRootRealPath = await fs.realpath(primaryRoot.path);
  const absolutePath = path.resolve(
    path.isAbsolute(trimmedPath)
      ? trimmedPath
      : path.join(primaryRootRealPath, trimmedPath),
  );
  const targetRealPath = await realpathIfExists(absolutePath);
  const containmentPath = targetRealPath ?? absolutePath;

  for (const root of roots) {
    const rootRealPath = await fs.realpath(root.path);
    if (isSubPathOrSame(containmentPath, rootRealPath)) {
      return {
        root,
        requestedPath: trimmedPath,
        absolutePath,
        relativePath:
          path.relative(rootRealPath, absolutePath) || path.basename(absolutePath),
      };
    }
  }

  if (options.forWrite) {
    const nearestParent = await findExistingParent(path.dirname(absolutePath));
    const parentRealPath = await fs.realpath(nearestParent);
    for (const root of roots) {
      const rootRealPath = await fs.realpath(root.path);
      if (isSubPathOrSame(parentRealPath, rootRealPath)) {
        return {
          root,
          requestedPath: trimmedPath,
          absolutePath,
          relativePath:
            path.relative(rootRealPath, absolutePath) || path.basename(absolutePath),
        };
      }
    }
  }

  throw new Error(`Path is outside the selected workspace, user home, or loaded skill folders: ${trimmedPath}`);
}

async function findExistingParent(startPath: string) {
  let current = path.resolve(startPath);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`No existing parent directory for ${startPath}`);
    current = parent;
  }
  const stat = await fs.stat(current);
  if (!stat.isDirectory()) return path.dirname(current);
  return current;
}

function normalizeNewlines(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function detectLineEnding(value: string) {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

function restoreLineEndings(value: string, lineEnding: string) {
  return lineEnding === "\n" ? value : value.replace(/\n/g, lineEnding);
}

function truncateTextHead(text: string, maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES) {
  const lines = text.split("\n");
  let bytes = 0;
  const output: string[] = [];
  let truncatedBy: "lines" | "bytes" | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    if (output.length >= maxLines) {
      truncatedBy = "lines";
      break;
    }

    const next = lines[index];
    const nextBytes = Buffer.byteLength(next + (index < lines.length - 1 ? "\n" : ""), "utf8");
    if (bytes + nextBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }

    output.push(next);
    bytes += nextBytes;
  }

  return {
    text: output.join("\n"),
    truncated: Boolean(truncatedBy),
    truncatedBy,
    totalLines: lines.length,
    outputLines: output.length,
  };
}

function truncateTextTail(text: string, maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES) {
  const lines = text.split("\n");
  let bytes = 0;
  const output: string[] = [];
  let truncatedBy: "lines" | "bytes" | undefined;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (output.length >= maxLines) {
      truncatedBy = "lines";
      break;
    }

    const next = lines[index];
    const nextBytes = Buffer.byteLength(next + (index < lines.length - 1 ? "\n" : ""), "utf8");
    if (bytes + nextBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }

    output.unshift(next);
    bytes += nextBytes;
  }

  return {
    text: output.join("\n"),
    truncated: Boolean(truncatedBy),
    truncatedBy,
    totalLines: lines.length,
    outputLines: output.length,
  };
}

function readOptionalPositiveNumber(args: unknown, key: string) {
  if (!isPlainObject(args)) return undefined;
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function readOptionalNonNegativeNumber(args: unknown, key: string) {
  if (!isPlainObject(args)) return undefined;
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

async function executeReadTool(args: unknown, context: ToolExecutionContext): Promise<ToolCommandResult> {
  throwIfAborted(context.signal);
  const requestedPath = readRequiredString(args, "path");
  const resolved = await resolveToolPath(requestedPath, context);
  const stat = await fs.stat(resolved.absolutePath);
  if (!stat.isFile()) throw new Error(`Path is not a file: ${requestedPath}`);

  const ext = path.extname(resolved.absolutePath).toLowerCase();
  const imageMime = IMAGE_MIME_BY_EXT[ext];
  if (imageMime) {
    const buffer = await fs.readFile(resolved.absolutePath);
    const dataUrl = `data:${imageMime};base64,${buffer.toString("base64")}`;
    const content = stringifyToolResult({
      ok: true,
      type: "image",
      path: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      mimeType: imageMime,
      sizeBytes: buffer.byteLength,
      dataUrl,
    });
    return {
      toolName: READ_TOOL_NAME,
      content,
      exitCode: 0,
      stdout: content,
      stderr: "",
      timedOut: false,
    };
  }

  const raw = await fs.readFile(resolved.absolutePath, "utf8");
  const lines = raw.split(/\r?\n|\r/g);
  const offset = readOptionalPositiveNumber(args, "offset") ?? 1;
  const limit = readOptionalPositiveNumber(args, "limit");
  const startIndex = Math.max(0, offset - 1);
  const selected = lines.slice(startIndex, limit ? startIndex + limit : undefined).join("\n");
  const truncation = truncateTextHead(selected);
  const content = stringifyToolResult({
    ok: true,
    path: resolved.relativePath,
    absolutePath: resolved.absolutePath,
    offset,
    limit: limit ?? null,
    totalLines: lines.length,
    content: truncation.text,
    truncated: truncation.truncated,
    truncatedBy: truncation.truncatedBy ?? null,
    outputLines: truncation.outputLines,
  });

  return {
    toolName: READ_TOOL_NAME,
    content,
    exitCode: 0,
    stdout: truncation.text,
    stderr: "",
    timedOut: false,
  };
}

function findWindowsGitBash() {
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe",
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function getShellConfig() {
  if (process.platform === "win32") {
    const gitBash = findWindowsGitBash();
    return {
      shell: gitBash ?? "bash.exe",
      args: ["-lc"],
      displayShell: gitBash ? "git-bash" : "bash.exe",
      env: {
        ...process.env,
        MSYSTEM: process.env.MSYSTEM ?? "MINGW64",
        CHERE_INVOKING: process.env.CHERE_INVOKING ?? "1",
      },
    };
  }

  if (existsSync("/bin/bash")) {
    return { shell: "/bin/bash", args: ["-lc"], displayShell: "/bin/bash", env: process.env };
  }

  return { shell: "sh", args: ["-c"], displayShell: "sh", env: process.env };
}

async function executeBashTool(
  args: unknown,
  context: ToolExecutionContext,
  onEvent?: StreamEventCallback,
): Promise<ToolCommandResult> {
  throwIfAborted(context.signal);
  const command = readRequiredRawString(args, "command").trim();
  if (!command) throw new Error("Missing required bash tool argument: command");

  const timeoutSeconds = readOptionalNonNegativeNumber(args, "timeout");
  const configuredTimeoutMs = normalizeContextTimeoutMs(context.timeoutMs);
  const requestedTimeoutMs = timeoutSeconds && timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0;
  const timeoutMs = requestedTimeoutMs > 0
    ? configuredTimeoutMs > 0
      ? Math.min(requestedTimeoutMs, configuredTimeoutMs)
      : requestedTimeoutMs
    : configuredTimeoutMs;
  const workspace = getSelectedWorkspace(context);
  const cwd = await fs.realpath(workspace.path);
  const shellConfig = getShellConfig();
  const startedAt = performance.now();
  const warnings: string[] = [];

  onEvent?.({
    type: "started",
    command,
    shell: shellConfig.displayShell,
    cwd,
    timeoutMs,
    warnings,
  });

  return new Promise<ToolCommandResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const child = spawn(shellConfig.shell, [...shellConfig.args, command], {
      cwd,
      env: shellConfig.env,
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      context.signal?.removeEventListener("abort", abortHandler);
    };

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      const durationMs = Math.round(performance.now() - startedAt);
      const stdoutTruncation = truncateTextTail(stdout);
      const stderrTruncation = truncateTextTail(stderr);
      const outputTruncated = stdoutTruncation.truncated || stderrTruncation.truncated;
      const terminal: TerminalExecutionResult = {
        command,
        shell: shellConfig.displayShell,
        cwd,
        rootId: workspace.id,
        rootName: workspace.name,
        rootPath: workspace.path,
        stdout: stdoutTruncation.text,
        stderr: stderrTruncation.text,
        exitCode,
        timedOut,
        cancelled,
        durationMs,
        outputTruncated,
        stdoutTruncated: stdoutTruncation.truncated,
        stderrTruncated: stderrTruncation.truncated,
        warnings,
      };
      onEvent?.({ type: "finished", exitCode, timedOut, cancelled, durationMs, outputTruncated });
      const content = stringifyToolResult({
        ok: !timedOut && !cancelled && exitCode === 0,
        command,
        cwd,
        shell: shellConfig.displayShell,
        exitCode,
        timedOut,
        cancelled,
        durationMs,
        stdout: stdoutTruncation.text,
        stderr: stderrTruncation.text,
        outputTruncated,
      });
      resolve({
        toolName: BASH_TOOL_NAME,
        content,
        exitCode,
        stdout: stdoutTruncation.text,
        stderr: stderrTruncation.text,
        timedOut,
        terminal,
      });
    };

    const killChild = () => {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        } else if (child.pid) {
          process.kill(-child.pid, "SIGTERM");
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
    };

    const abortHandler = () => {
      cancelled = true;
      killChild();
    };

    context.signal?.addEventListener("abort", abortHandler);

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        killChild();
      }, timeoutMs);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      onEvent?.({ type: "stdout", text });
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      onEvent?.({ type: "stderr", text });
    });

    child.on("error", (error: Error) => {
      stderr += getErrorMessage(error);
      finish(null);
    });

    child.on("close", (code: number | null) => finish(code));
  });
}

type EditOperation = { oldText: string; newText: string };

function parseEditOperations(args: unknown): EditOperation[] {
  if (!isPlainObject(args)) throw new Error("edit arguments must be a JSON object.");
  const source = args as Record<string, unknown>;
  if (Array.isArray(source.edits)) {
    const edits = source.edits.map((item, index) => {
      if (!isPlainObject(item)) throw new Error(`edits[${index}] must be an object.`);
      const oldText = typeof item.oldText === "string" ? item.oldText : "";
      const newText = typeof item.newText === "string" ? item.newText : "";
      if (!oldText) throw new Error(`edits[${index}].oldText is required.`);
      return { oldText, newText };
    });
    if (edits.length === 0) throw new Error("edit requires at least one edit.");
    return edits;
  }

  if (typeof source.oldText === "string" && typeof source.newText === "string") {
    if (!source.oldText) throw new Error("oldText is required.");
    return [{ oldText: source.oldText, newText: source.newText }];
  }

  throw new Error("edit requires edits[] with oldText/newText.");
}

function applyExactEdits(original: string, edits: EditOperation[]) {
  const hadBom = original.charCodeAt(0) === 0xfeff;
  const content = hadBom ? original.slice(1) : original;
  const lineEnding = detectLineEnding(content);
  const normalizedContent = normalizeNewlines(content);
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeNewlines(edit.oldText),
    newText: normalizeNewlines(edit.newText),
  }));

  const ranges: Array<{ start: number; end: number; newText: string; oldText: string }> = [];
  for (let index = 0; index < normalizedEdits.length; index += 1) {
    const edit = normalizedEdits[index];
    const firstIndex = normalizedContent.indexOf(edit.oldText);
    if (firstIndex < 0) {
      throw new Error(`edits[${index}].oldText was not found in the file.`);
    }
    const secondIndex = normalizedContent.indexOf(edit.oldText, firstIndex + edit.oldText.length);
    if (secondIndex >= 0) {
      throw new Error(`edits[${index}].oldText occurs multiple times. Provide more unique context.`);
    }
    ranges.push({ start: firstIndex, end: firstIndex + edit.oldText.length, newText: edit.newText, oldText: edit.oldText });
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) {
      throw new Error("edit ranges overlap. Merge overlapping changes into one edit.");
    }
  }

  let nextContent = normalizedContent;
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    nextContent = nextContent.slice(0, range.start) + range.newText + nextContent.slice(range.end);
  }

  return {
    content: (hadBom ? "\ufeff" : "") + restoreLineEndings(nextContent, lineEnding),
    ranges,
    lineEnding,
  };
}

function previewRowsFromText(kind: FileToolChangePreview["kind"], pathLabel: string, before: string, after: string): FileToolChangePreview {
  const beforeLines = before.split(/\r?\n|\r/g);
  const afterLines = after.split(/\r?\n|\r/g);
  const maxRows = 80;
  const rows: FileToolChangePreview["rows"] = [];
  for (let index = 0; index < Math.min(beforeLines.length, maxRows); index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      rows.push({ type: "delete", text: beforeLines[index], oldLine: index + 1 });
      if (afterLines[index] !== undefined) rows.push({ type: "add", text: afterLines[index], newLine: index + 1 });
    } else if (rows.length > 0 && rows.length < maxRows) {
      rows.push({ type: "context", text: beforeLines[index], oldLine: index + 1, newLine: index + 1 });
    }
    if (rows.length >= maxRows) break;
  }
  if (rows.length === 0 && kind === "create") {
    for (let index = 0; index < Math.min(afterLines.length, maxRows); index += 1) {
      rows.push({ type: "add", text: afterLines[index], newLine: index + 1 });
    }
  }
  return { kind, path: pathLabel, rows, truncated: beforeLines.length + afterLines.length > maxRows };
}

async function withFileMutationQueue<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath).toLowerCase();
  const previous = fileMutationQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  fileMutationQueues.set(key, next.finally(() => {
    if (fileMutationQueues.get(key) === next) fileMutationQueues.delete(key);
  }));
  return next;
}

async function executeEditTool(args: unknown, context: ToolExecutionContext): Promise<ToolCommandResult> {
  throwIfAborted(context.signal);
  const requestedPath = readRequiredString(args, "path");
  const resolved = await resolveToolPath(requestedPath, context);
  const edits = parseEditOperations(args);

  return withFileMutationQueue(resolved.absolutePath, async () => {
    const original = await fs.readFile(resolved.absolutePath, "utf8");
    const result = applyExactEdits(original, edits);
    await fs.writeFile(resolved.absolutePath, result.content, "utf8");
    const content = stringifyToolResult({
      ok: true,
      path: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      edits: edits.length,
      message: `Applied ${edits.length} edit${edits.length === 1 ? "" : "s"}.`,
    });
    return {
      toolName: EDIT_TOOL_NAME,
      content,
      exitCode: 0,
      stdout: content,
      stderr: "",
      timedOut: false,
      changePreview: previewRowsFromText("replace", resolved.relativePath, original, result.content),
    };
  });
}

function readRequiredStringAllowEmpty(args: unknown, key: string) {
  if (!isPlainObject(args) || typeof args[key] !== "string") {
    throw new Error(`Missing required file tool argument: ${key}`);
  }
  return args[key] as string;
}

async function executeWriteTool(args: unknown, context: ToolExecutionContext): Promise<ToolCommandResult> {
  throwIfAborted(context.signal);
  const requestedPath = readRequiredString(args, "path");
  const content = readRequiredStringAllowEmpty(args, "content");
  const resolved = await resolveToolPath(requestedPath, context, { forWrite: true });

  return withFileMutationQueue(resolved.absolutePath, async () => {
    let previous = "";
    try {
      previous = await fs.readFile(resolved.absolutePath, "utf8");
    } catch {
      previous = "";
    }
    await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
    await fs.writeFile(resolved.absolutePath, content, "utf8");
    const resultContent = stringifyToolResult({
      ok: true,
      path: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      bytes: Buffer.byteLength(content, "utf8"),
      message: "File written.",
    });
    return {
      toolName: WRITE_TOOL_NAME,
      content: resultContent,
      exitCode: 0,
      stdout: resultContent,
      stderr: "",
      timedOut: false,
      changePreview: previewRowsFromText(previous ? "replace" : "create", resolved.relativePath, previous, content),
    };
  });
}

export async function executePiTool(
  toolName: string,
  args: unknown,
  context: ToolExecutionContext = {},
  onEvent?: StreamEventCallback,
): Promise<ToolCommandResult> {
  try {
    const timeoutMs = normalizeContextTimeoutMs(context.timeoutMs);
    if (toolName === READ_TOOL_NAME) return await withConfiguredTimeout(executeReadTool(args, context), timeoutMs, toolName);
    if (toolName === BASH_TOOL_NAME) return await executeBashTool(args, context, onEvent);
    if (toolName === EDIT_TOOL_NAME) return await withConfiguredTimeout(executeEditTool(args, context), timeoutMs, toolName);
    if (toolName === WRITE_TOOL_NAME) return await withConfiguredTimeout(executeWriteTool(args, context), timeoutMs, toolName);
    throw new Error(`Unsupported Pi tool: ${toolName}`);
  } catch (error) {
    const message = getErrorMessage(error);
    const content = stringifyToolResult({ ok: false, error: message });
    return {
      toolName,
      content,
      exitCode: 1,
      stdout: "",
      stderr: message,
      timedOut: false,
    };
  }
}
