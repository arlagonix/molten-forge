import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { TERMINAL_EXEC_TOOL_NAME, isTerminalExecShell, type TerminalExecShell } from "../src/lib/ai-chat/terminal-tool";
import {
  getErrorMessage,
  isPlainObject,
  safeString,
  type ToolExecutionContext,
  type WorkspaceRoot,
} from "./tool-utils";

type TerminalExecArgs = {
  command: string;
  rootId?: string;
  cwd?: string;
  shell: TerminalExecShell;
  timeoutMs: number;
  maxOutputChars: number;
};

type TerminalStreamEvent =
  | { type: "started"; command: string; shell: string; cwd: string; timeoutMs: number; warnings: string[] }
  | { type: "stdout"; text: string }
  | { type: "stderr"; text: string }
  | { type: "finished"; exitCode: number | null; timedOut: boolean; cancelled: boolean; durationMs: number; outputTruncated: boolean };

type TerminalExecutionPreview = {
  command: string;
  args: string[];
  cwd?: string;
  inputMode: "none";
  displayCommand: string;
  usesStdin: false;
  usesPlaceholders: false;
};

type TerminalCommandResult = {
  toolName: string;
  content: string;
  isError: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  execution: TerminalExecutionPreview;
  terminal: {
    command: string;
    shell: string;
    requestedShell: TerminalExecShell;
    cwd: string;
    rootId: string;
    rootName: string;
    rootPath: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    cancelled: boolean;
    durationMs: number;
    outputTruncated: boolean;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    warnings: string[];
  };
};

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MODEL_OUTPUT_CHARS = 20_000;
const MAX_MODEL_OUTPUT_CHARS = 80_000;
const MAX_CAPTURED_STREAM_CHARS = 200_000;

function readPositiveNumber(value: unknown, fallback: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(value), max);
}

function parseTerminalExecArgs(args: unknown): TerminalExecArgs {
  if (!isPlainObject(args)) {
    throw new Error("terminal_exec arguments must be a JSON object.");
  }

  const command = safeString(args.command).trim();
  if (!command) throw new Error("terminal_exec requires command.");

  const shell = isTerminalExecShell(args.shell) ? args.shell : "auto";

  return {
    command,
    rootId: safeString(args.rootId).trim() || undefined,
    cwd: safeString(args.cwd).trim() || ".",
    shell,
    timeoutMs: readPositiveNumber(args.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxOutputChars: readPositiveNumber(
      args.maxOutputChars,
      DEFAULT_MODEL_OUTPUT_CHARS,
      MAX_MODEL_OUTPUT_CHARS,
    ),
  };
}

function normalizePathForCompare(value: string) {
  return path.resolve(value);
}

function isPathInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative ? !relative.startsWith("..") && !path.isAbsolute(relative) : true;
}

function resolveWorkspaceRoot(roots: WorkspaceRoot[], rootId?: string) {
  if (!roots.length) {
    throw new Error("terminal_exec requires at least one workspace root.");
  }

  if (rootId) {
    const root = roots.find((candidate) => candidate.id === rootId);
    if (!root) throw new Error(`Workspace root not found: ${rootId}`);
    return root;
  }

  if (roots.length === 1) return roots[0];

  throw new Error(
    "terminal_exec requires rootId when the chat has multiple workspace roots.",
  );
}

function resolveTerminalCwd(root: WorkspaceRoot, requestedCwd: string) {
  const rootPath = path.resolve(root.path);
  const requestedPath = path.isAbsolute(requestedCwd)
    ? path.resolve(requestedCwd)
    : path.resolve(rootPath, requestedCwd || ".");

  const realRootPath = existsSync(rootPath) ? realpathSync(rootPath) : rootPath;
  const realRequestedPath = existsSync(requestedPath)
    ? realpathSync(requestedPath)
    : requestedPath;

  const normalizedRoot = normalizePathForCompare(realRootPath);
  const normalizedRequested = normalizePathForCompare(realRequestedPath);

  if (!isPathInside(normalizedRoot, normalizedRequested)) {
    throw new Error("terminal_exec cwd must stay inside the selected workspace root.");
  }

  return normalizedRequested;
}

function resolveShell(requestedShell: TerminalExecShell) {
  const shell = requestedShell === "auto"
    ? process.platform === "win32"
      ? "powershell"
      : "sh"
    : requestedShell;

  if (shell === "powershell") {
    const command = process.platform === "win32" ? "powershell.exe" : "pwsh";
    return { shell, command, argsPrefix: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"] };
  }

  if (shell === "cmd") {
    if (process.platform !== "win32") {
      throw new Error("cmd shell is only available on Windows.");
    }
    return { shell, command: "cmd.exe", argsPrefix: ["/d", "/s", "/c"] };
  }

  if (shell === "bash") return { shell, command: "bash", argsPrefix: ["-lc"] };
  if (shell === "sh") return { shell, command: "sh", argsPrefix: ["-c"] };

  throw new Error(`Unsupported terminal shell: ${shell}`);
}

function appendWithLimit(current: string, chunk: string) {
  if (!chunk) return { value: current, truncated: false };
  if (current.length >= MAX_CAPTURED_STREAM_CHARS) return { value: current, truncated: true };

  const remaining = MAX_CAPTURED_STREAM_CHARS - current.length;
  if (chunk.length <= remaining) return { value: current + chunk, truncated: false };

  return { value: current + chunk.slice(0, remaining), truncated: true };
}

function headTailTruncate(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return { text: value, truncated: false, omittedChars: 0 };
  }

  const marker = `\n\n[... truncated ${value.length - maxChars} characters ...]\n\n`;
  const available = Math.max(0, maxChars - marker.length);
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);

  return {
    text: `${value.slice(0, headLength)}${marker}${value.slice(value.length - tailLength)}`,
    truncated: true,
    omittedChars: value.length - maxChars,
  };
}

function detectTerminalRiskWarnings(command: string, cwd: string) {
  const warnings: string[] = [];
  const normalized = command.toLowerCase();

  const patterns: Array<[RegExp, string]> = [
    [/\b(rm|del|erase|remove-item|rmdir|rd)\b/i, "Command may delete files or folders."],
    [/\b(git\s+(reset|clean|push|checkout|switch|rebase))\b/i, "Command may mutate Git state or remote branches."],
    [/\b(npm\s+install|pnpm\s+(add|install)|yarn\s+(add|install)|pip\s+install|cargo\s+install)\b/i, "Command may install or update dependencies."],
    [/\b(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm|ssh|scp|ftp)\b/i, "Command may access the network. Prefer web_fetch for simple web reads."],
    [/\b(taskkill|kill|shutdown|restart-computer|stop-process)\b/i, "Command may stop processes or affect the system."],
    [/\b(reg\s+add|reg\s+delete|set-executionpolicy|chmod|chown)\b/i, "Command may change permissions or system configuration."],
  ];

  for (const [pattern, warning] of patterns) {
    if (pattern.test(command)) warnings.push(warning);
  }

  if (/(^|\s)([a-zA-Z]:[\\/]|\\\\|\/|~[\\/])/.test(command)) {
    warnings.push("Command contains an absolute or home-relative path.");
  }

  if (/(^|[\\/])\.\.($|[\\/])/.test(command) || command.includes("..\\") || command.includes("../")) {
    warnings.push("Command references a parent path.");
  }

  if (normalized.includes("env:") || /\b(printenv|set|env)\b/.test(normalized)) {
    warnings.push("Command may print environment variables or secrets.");
  }

  if (!cwd) warnings.push("Working directory could not be resolved.");

  return [...new Set(warnings)];
}

function buildTerminalExecutionPreview(command: string, cwd: string): TerminalExecutionPreview {
  return {
    command,
    args: [],
    cwd,
    inputMode: "none",
    displayCommand: command,
    usesStdin: false,
    usesPlaceholders: false,
  };
}

function buildTerminalModelContent(result: {
  command: string;
  shell: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  outputTruncated: boolean;
  warnings: string[];
}) {
  return JSON.stringify(
    {
      ok: !result.timedOut && !result.cancelled && result.exitCode === 0,
      command: result.command,
      shell: result.shell,
      cwd: result.cwd,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      durationMs: result.durationMs,
      outputTruncated: result.outputTruncated,
      warnings: result.warnings,
      stdout: result.stdout,
      stderr: result.stderr,
    },
    null,
    2,
  );
}

function killProcessTree(child: ReturnType<typeof spawn>) {
  if (child.pid && process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    }).on("error", () => undefined);
    return;
  }

  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Fall back to killing only the child process.
    }
  }

  child.kill();
}

export async function executeTerminalExecTool(
  args: unknown,
  context: ToolExecutionContext = {},
  onEvent?: (event: TerminalStreamEvent) => void,
): Promise<TerminalCommandResult> {
  const parsedArgs = parseTerminalExecArgs(args);
  const root = resolveWorkspaceRoot(context.workspaceRoots ?? [], parsedArgs.rootId);
  const cwd = resolveTerminalCwd(root, parsedArgs.cwd ?? ".");
  const shellInfo = resolveShell(parsedArgs.shell);
  const warnings = detectTerminalRiskWarnings(parsedArgs.command, cwd);
  const startedAt = Date.now();
  const execution = buildTerminalExecutionPreview(parsedArgs.command, cwd);

  return new Promise<TerminalCommandResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timedOut = false;
    let cancelled = false;

    const child = spawn(shellInfo.command, [...shellInfo.argsPrefix, parsedArgs.command], {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: process.env,
    });

    const cleanup = () => {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", abortHandler);
    };

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();

      const durationMs = Date.now() - startedAt;
      const stdoutForModel = headTailTruncate(stdout, Math.floor(parsedArgs.maxOutputChars / 2));
      const stderrForModel = headTailTruncate(stderr, Math.floor(parsedArgs.maxOutputChars / 2));
      const outputTruncated =
        stdoutTruncated ||
        stderrTruncated ||
        stdoutForModel.truncated ||
        stderrForModel.truncated;

      onEvent?.({
        type: "finished",
        exitCode,
        timedOut,
        cancelled,
        durationMs,
        outputTruncated,
      });

      const content = buildTerminalModelContent({
        command: parsedArgs.command,
        shell: shellInfo.shell,
        cwd,
        stdout: stdoutForModel.text,
        stderr: stderrForModel.text,
        exitCode,
        timedOut,
        cancelled,
        durationMs,
        outputTruncated,
        warnings,
      });

      resolve({
        toolName: TERMINAL_EXEC_TOOL_NAME,
        content,
        isError: timedOut || cancelled || exitCode !== 0,
        exitCode,
        stdout: stdoutForModel.text,
        stderr: stderrForModel.text,
        timedOut,
        execution,
        terminal: {
          command: parsedArgs.command,
          shell: shellInfo.shell,
          requestedShell: parsedArgs.shell,
          cwd,
          rootId: root.id,
          rootName: root.name,
          rootPath: root.path,
          stdout,
          stderr,
          exitCode,
          timedOut,
          cancelled,
          durationMs,
          outputTruncated,
          stdoutTruncated: stdoutTruncated || stdoutForModel.truncated,
          stderrTruncated: stderrTruncated || stderrForModel.truncated,
          warnings,
        },
      });
    };

    const abortHandler = () => {
      cancelled = true;
      killProcessTree(child);
      finish(null);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
      finish(null);
    }, parsedArgs.timeoutMs);

    if (context.signal?.aborted) {
      abortHandler();
      return;
    }

    context.signal?.addEventListener("abort", abortHandler, { once: true });

    onEvent?.({
      type: "started",
      command: parsedArgs.command,
      shell: shellInfo.shell,
      cwd,
      timeoutMs: parsedArgs.timeoutMs,
      warnings,
    });

    child.stdout?.on("data", (chunk: { toString(): string }) => {
      const text = chunk.toString();
      const appended = appendWithLimit(stdout, text);
      stdout = appended.value;
      stdoutTruncated = stdoutTruncated || appended.truncated;
      onEvent?.({ type: "stdout", text });
    });

    child.stderr?.on("data", (chunk: { toString(): string }) => {
      const text = chunk.toString();
      const appended = appendWithLimit(stderr, text);
      stderr = appended.value;
      stderrTruncated = stderrTruncated || appended.truncated;
      onEvent?.({ type: "stderr", text });
    });

    child.on("error", (error: Error) => {
      const message = getErrorMessage(error);
      const appended = appendWithLimit(stderr, message);
      stderr = appended.value;
      stderrTruncated = stderrTruncated || appended.truncated;
      onEvent?.({ type: "stderr", text: message });
      finish(null);
    });

    child.on("close", (exitCode: number | null) => {
      finish(exitCode);
    });

    child.stdin?.end();
  });
}
