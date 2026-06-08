// Legacy terminal_exec identifiers kept for historical saved messages.
export const TERMINAL_EXEC_TOOL_NAME = "terminal_exec";

export const TERMINAL_EXEC_SHELLS = ["auto", "powershell", "cmd", "bash", "sh"] as const;

export type TerminalExecShell = (typeof TERMINAL_EXEC_SHELLS)[number];

export function isTerminalExecShell(value: unknown): value is TerminalExecShell {
  return TERMINAL_EXEC_SHELLS.includes(value as TerminalExecShell);
}
