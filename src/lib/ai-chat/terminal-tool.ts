// Shared identifiers and small helpers for the built-in terminal command tool.
// Kept dependency-free so it can be imported by both the renderer and Electron
// main process code.

export const TERMINAL_EXEC_TOOL_NAME = "terminal_exec";

export const TERMINAL_EXEC_SHELLS = [
  "auto",
  "powershell",
  "cmd",
  "bash",
  "sh",
] as const;

export type TerminalExecShell = (typeof TERMINAL_EXEC_SHELLS)[number];

export function isTerminalExecShell(value: unknown): value is TerminalExecShell {
  return (
    typeof value === "string" &&
    (TERMINAL_EXEC_SHELLS as readonly string[]).includes(value)
  );
}
