import { parseToolArgumentsText } from "@/lib/ai-chat/builtin-tools";
import type {
  ChatToolCall,
  ChatToolResult,
  LoadedToolInfo,
  ToolExecutionPreview,
} from "@/lib/ai-chat/types";

function extractTemplatePlaceholders(args: string[]) {
  const placeholders = new Set<string>();
  const pattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
  for (const arg of args) {
    for (const match of arg.matchAll(pattern)) placeholders.add(match[1]);
  }
  return [...placeholders];
}

function getToolArgValue(args: unknown, key: string) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    !(key in args)
  ) {
    throw new Error(`Missing required tool argument: ${key}`);
  }

  return (args as Record<string, unknown>)[key];
}

function stringifyCommandArgValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function materializeCommandArgs(templateArgs: string[], modelArgs: unknown) {
  const templatePattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

  return templateArgs.map((templateArg) =>
    templateArg.replace(templatePattern, (_full, key: string) =>
      stringifyCommandArgValue(getToolArgValue(modelArgs, key)),
    ),
  );
}

function quoteCommandPreviewPart(value: string) {
  if (!value) return '""';
  if (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function formatCommandPreview(command: string, args: string[]) {
  return [command, ...args].map(quoteCommandPreviewPart).join(" ");
}

export function buildToolExecutionPreview(
  tool: Pick<LoadedToolInfo, "command" | "args" | "cwd" | "input">,
  modelArgs: unknown,
): ToolExecutionPreview {
  const commandArgs = materializeCommandArgs(tool.args, modelArgs);
  const hasCommand = tool.command.trim().length > 0 || tool.args.length > 0;
  const stdin =
    tool.input === "json-stdin" || !hasCommand
      ? JSON.stringify(modelArgs ?? {})
      : undefined;

  return {
    command: tool.command,
    args: commandArgs,
    cwd: tool.cwd,
    inputMode: tool.input,
    stdin,
    displayCommand: hasCommand
      ? formatCommandPreview(tool.command, commandArgs)
      : "",
    usesStdin: tool.input === "json-stdin" || !hasCommand,
    usesPlaceholders: extractTemplatePlaceholders(tool.args).length > 0,
  };
}

export function buildToolExecutionPreviewForCall(
  toolCall: ChatToolCall,
  loadedTools: LoadedToolInfo[],
  result?: ChatToolResult,
) {
  if (result?.execution) return result.execution;

  const tool = loadedTools.find(
    (candidate) => candidate.name === toolCall.function.name,
  );
  if (!tool) return undefined;

  try {
    return buildToolExecutionPreview(
      tool,
      parseToolArgumentsText(toolCall.function.arguments || "{}"),
    );
  } catch {
    return undefined;
  }
}
