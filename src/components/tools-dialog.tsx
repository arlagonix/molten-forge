import {
  BookOpen,
  Bot,
  Check,
  Copy,
  Download,
  FolderOpen,
  Globe,
  ListTodo,
  Lock,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Terminal,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { memo, useEffect, useMemo, useState } from "react";

import { MarkdownMessage } from "@/components/ai-chat/markdown-message";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GroupHeading } from "@/components/ui/group-heading";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { createId, labelForError } from "@/lib/ai-chat/chat-utils";
import {
  deleteTool as deleteStoredTool,
  exportTool,
  exportTools,
  importTools,
  loadTools,
  openToolsFolder,
  saveTool,
} from "@/lib/ai-chat/storage";
import { runQueuedTool } from "@/lib/ai-chat/tool-execution-queue";
import type {
  FeaturePermission,
  LoadedToolInfo,
  Permission,
  ToolCommandResult,
  ToolExecutionPreview,
  ToolImportResult,
  ToolsSettings,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const TOOL_TEST_STATES_STORAGE_KEY = "chat-forge-tool-test-states";
const TOOL_TEST_STATE_SAVE_DELAY_MS = 350;
const BUILTIN_ASK_USER_TOOL_NAME = "ask_user";
const BUILTIN_ASK_USER_TOOL_ID = "builtin-ask-user";
const BUILTIN_TASK_TOOL_NAMES = ["update_tasks"] as const;
const BUILTIN_TASK_TOOL_META = [
  {
    id: "builtin-update-tasks",
    name: "update_tasks",
    description:
      "Updates the visible task checklist for the current chat by setting the full current list.",
  },
] as const;
const BUILTIN_LOAD_SKILL_TOOL_NAME = "skill";
const BUILTIN_LOAD_SKILL_TOOL_ID = "builtin-load-skill";
const BUILTIN_CALL_AGENT_TOOL_NAME = "call_agent";
const BUILTIN_CALL_AGENT_TOOL_ID = "builtin-call-agent";
const BUILTIN_WEB_FETCH_TOOL_NAME = "web_fetch";
const BUILTIN_WEB_FETCH_TOOL_ID = "builtin-web-fetch";
const BUILTIN_READ_TOOL_NAME = "read";
const BUILTIN_BASH_TOOL_NAME = "bash";
const BUILTIN_EDIT_TOOL_NAME = "edit";
const BUILTIN_WRITE_TOOL_NAME = "write";
const BUILTIN_FILE_TOOL_NAMES = [
  BUILTIN_READ_TOOL_NAME,
  BUILTIN_BASH_TOOL_NAME,
  BUILTIN_EDIT_TOOL_NAME,
  BUILTIN_WRITE_TOOL_NAME,
];
const BUILTIN_FILE_TOOL_META = [
  {
    id: "builtin-read",
    name: BUILTIN_READ_TOOL_NAME,
    setting: "readEnabled" as const,
    autoApproveSetting: "readAutoApproveEnabled" as const,
    icon: FolderOpen,
    description:
      "Read the contents of a file. Supports text files and images. For text files, output is truncated to 2000 lines or 128KB; use offset/limit for large files.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description:
            "Path to the file to read (relative to the selected workspace or absolute).",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-indexed).",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read.",
        },
      },
      required: ["path"],
    },
  },
  {
    id: "builtin-bash",
    name: BUILTIN_BASH_TOOL_NAME,
    setting: "bashEnabled" as const,
    autoApproveSetting: "bashAutoApproveEnabled" as const,
    icon: Terminal,
    description:
      "Execute a bash command in the selected workspace. Uses Pi-style shell resolution, preferring Git Bash on Windows and bash/sh on Unix.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: { type: "string", description: "Bash command to execute." },
        timeout: {
          type: "number",
          description: "Timeout in seconds (optional).",
        },
      },
      required: ["command"],
    },
  },
  {
    id: "builtin-edit",
    name: BUILTIN_EDIT_TOOL_NAME,
    setting: "editEnabled" as const,
    autoApproveSetting: "editAutoApproveEnabled" as const,
    icon: FolderOpen,
    description:
      "Edit a single file using exact text replacement. Supports multiple disjoint edits in one call.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description:
            "Path to the file to edit (relative to the selected workspace or absolute).",
        },
        edits: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["oldText", "newText"],
          },
        },
      },
      required: ["path", "edits"],
    },
  },
  {
    id: "builtin-write",
    name: BUILTIN_WRITE_TOOL_NAME,
    setting: "writeEnabled" as const,
    autoApproveSetting: "writeAutoApproveEnabled" as const,
    icon: FolderOpen,
    description:
      "Create or overwrite files. Automatically creates parent directories.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description:
            "Path to the file to write (relative to the selected workspace or absolute).",
        },
        content: {
          type: "string",
          description: "Content to write to the file.",
        },
      },
      required: ["path", "content"],
    },
  },
];
const BUILTIN_ASK_USER_TOOL_DESCRIPTION =
  "Pauses the assistant so it can ask focused clarification questions, including single-choice, multi-select, and text answers, then resumes the same response.";
const BUILTIN_ASK_USER_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: ["single_choice", "multi_select", "text"],
            description:
              "single_choice chooses one option, multi_select chooses several options, text asks for a custom-only answer.",
          },
          question: { type: "string" },
          description: { type: "string" },
          options: {
            type: "array",
            description:
              "Required for single_choice and multi_select. Use concise labels and strongly prefer one-sentence descriptions. Do not include Other/custom; Chat Forge adds a custom typed answer option automatically for choice questions.",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: {
                  type: "string",
                  description: "Short option label, usually 1-5 words.",
                },
                description: {
                  type: "string",
                  description:
                    "Strongly recommended one-sentence explanation shown below the label.",
                },
              },
              required: ["id", "label"],
            },
          },
        },
        required: ["id", "type", "question"],
      },
    },
  },
  required: ["questions"],
};
const BUILTIN_TASK_TOOLS_DESCRIPTION =
  "The assistant uses one task list tool (`update_tasks`) to show and update a checklist in the current chat. It always sends the full current list; sending an empty list clears it.";
const BUILTIN_LOAD_SKILL_TOOL_DESCRIPTION =
  "Load a discovered skill by name. Returns the skill's SKILL.md content and reference path so the model can follow skill-specific instructions.";
const BUILTIN_CALL_AGENT_TOOL_DESCRIPTION =
  "Delegates a focused subtask to one enabled agent. The actual runtime schema is rebuilt per chat so agentName is limited to currently available agents.";
const BUILTIN_WEB_FETCH_TOOL_DESCRIPTION =
  "Fetches readable text from a specific HTTP/HTTPS URL. It can read official docs or user-provided links, but it does not search the web.";
const BUILTIN_LOAD_SKILL_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "Exact skill name to load from the available skills list.",
    },
  },
  required: ["name"],
};

const TOOL_INFO_CODE_BLOCK_CLASS_NAME =
  "chat-markdown-compact chat-tool-info-codeblock";

function getToolsMasterPermission(settings: ToolsSettings): FeaturePermission {
  return settings.toolsPermission ?? "custom";
}

function getToolPermission(
  settings: ToolsSettings,
  toolName: string,
): Permission {
  return settings.toolPermissions?.[toolName] ?? "ask";
}

function getDisplayedToolPermission(
  settings: ToolsSettings,
  toolName: string,
): Permission {
  const masterPermission = getToolsMasterPermission(settings);
  return masterPermission === "custom"
    ? getToolPermission(settings, toolName)
    : masterPermission;
}

function PermissionSelect({
  value,
  onChange,
  disabled,
}: {
  value: Permission;
  onChange: (value: Permission) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as Permission)}
      disabled={disabled}
    >
      <SelectTrigger
        className="h-8 w-[6.25rem] shrink-0"
        onClick={(event) => event.stopPropagation()}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="allow">Allow</SelectItem>
        <SelectItem value="ask">Ask</SelectItem>
        <SelectItem value="deny">Deny</SelectItem>
      </SelectContent>
    </Select>
  );
}

function MasterPermissionSelect({
  value,
  onChange,
}: {
  value: FeaturePermission;
  onChange: (value: FeaturePermission) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as FeaturePermission)}
    >
      <SelectTrigger
        className="h-8 w-27 shrink-0"
        onClick={(event) => event.stopPropagation()}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="custom">Custom</SelectItem>
        <SelectItem value="allow">Allow</SelectItem>
        <SelectItem value="ask">Ask</SelectItem>
        <SelectItem value="deny">Deny</SelectItem>
      </SelectContent>
    </Select>
  );
}

const BUILTIN_CALL_AGENT_TOOL_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    agentName: {
      type: "string",
      description: "Name of the configured agent to call.",
    },
    task: {
      type: "string",
      description:
        "Focused task for the agent. Include all important constraints and what output you need back.",
    },
  },
  required: ["agentName", "task"],
};

const BUILTIN_WEB_FETCH_TOOL_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    url: {
      type: "string",
      description:
        "Exact HTTP or HTTPS URL to fetch. URL fragments like #section are supported for documentation anchors.",
    },
  },
  required: ["url"],
};

const BUILTIN_TASK_TOOL_PARAMETERS = {
  update_tasks: {
    type: "object",
    additionalProperties: false,
    properties: {
      tasks: {
        type: "array",
        description:
          "The full desired current checklist. Include both incomplete and completed tasks that should remain visible. Send [] to clear the list.",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            subject: {
              type: "string",
              description: "Short user-visible task subject.",
              maxLength: 180,
            },
            done: {
              type: "boolean",
              description: "Whether the task is complete.",
            },
          },
          required: ["subject", "done"],
        },
      },
    },
    required: ["tasks"],
  },
};

type ToolDraft = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  parametersText: string;
  command: string;
  argsText: string;
  cwd: string;
  input: "none" | "json-stdin";
  timeoutMs: string;
  maxConcurrentRuns: string;
  delayBetweenRunsMs: string;
};

type ToolTestState = {
  argsText: string;
  result: ToolCommandResult | null;
  status?: "pending" | "running";
  runId?: string;
};

type BuiltInToolDraft = {
  descriptionMode: "default" | "custom";
  customDescription: string;
  timeoutMs: string;
};

const BUILTIN_TOOL_TIMEOUT_FALLBACKS_MS: Record<string, number> = {
  [BUILTIN_WEB_FETCH_TOOL_NAME]: 15_000,
  [BUILTIN_READ_TOOL_NAME]: 30_000,
  [BUILTIN_BASH_TOOL_NAME]: 30_000,
  [BUILTIN_EDIT_TOOL_NAME]: 30_000,
  [BUILTIN_WRITE_TOOL_NAME]: 30_000,
};

function supportsBuiltInTimeout(toolName: string) {
  return Object.prototype.hasOwnProperty.call(
    BUILTIN_TOOL_TIMEOUT_FALLBACKS_MS,
    toolName,
  );
}

function normalizeBuiltInTimeoutText(value: string, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return String(fallback);
  return String(Math.min(Math.round(numeric), 10 * 60_000));
}

function getStaticBuiltInDescription(toolName: string) {
  if (toolName === BUILTIN_ASK_USER_TOOL_NAME)
    return BUILTIN_ASK_USER_TOOL_DESCRIPTION;
  if (toolName === BUILTIN_LOAD_SKILL_TOOL_NAME)
    return BUILTIN_LOAD_SKILL_TOOL_DESCRIPTION;
  if (toolName === BUILTIN_CALL_AGENT_TOOL_NAME)
    return BUILTIN_CALL_AGENT_TOOL_DESCRIPTION;
  if (toolName === BUILTIN_WEB_FETCH_TOOL_NAME)
    return BUILTIN_WEB_FETCH_TOOL_DESCRIPTION;
  const taskTool = BUILTIN_TASK_TOOL_META.find(
    (tool) => tool.name === toolName,
  );
  if (taskTool) return taskTool.description;
  const fileTool = BUILTIN_FILE_TOOL_META.find(
    (tool) => tool.name === toolName,
  );
  if (fileTool) return fileTool.description;
  return "Built-in tool.";
}

function getSavedBuiltInToolDraft(
  settings: ToolsSettings,
  toolName: string,
): BuiltInToolDraft {
  const saved = settings.builtInToolSettings?.[toolName];
  const fallbackTimeout = BUILTIN_TOOL_TIMEOUT_FALLBACKS_MS[toolName] ?? 0;
  return {
    descriptionMode: saved?.descriptionMode === "custom" ? "custom" : "default",
    customDescription: saved?.customDescription ?? "",
    timeoutMs: String(saved?.timeoutMs ?? fallbackTimeout),
  };
}

function areBuiltInToolDraftsEqual(
  left: BuiltInToolDraft,
  right: BuiltInToolDraft,
) {
  return (
    left.descriptionMode === right.descriptionMode &&
    left.customDescription === right.customDescription &&
    left.timeoutMs === right.timeoutMs
  );
}

type ToolsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toolsSettings: ToolsSettings;
  onToolsSettingsChange: Dispatch<SetStateAction<ToolsSettings>>;
  availableTools: LoadedToolInfo[];
  loadedTools: LoadedToolInfo[];
  onLoadedToolsChange: Dispatch<SetStateAction<LoadedToolInfo[]>>;
  callAgentEnabled: boolean;
  showSuccess: (message: string, description?: string) => void;
  showError: (message: string, description?: string) => void;
};

function getToolsBridge() {
  if (!window.chatForgeTools) {
    throw new Error("Electron tools bridge is not available.");
  }

  return window.chatForgeTools;
}

function createBlankToolDraft(): ToolDraft {
  return {
    id: createId(),
    name: "",
    enabled: true,
    description: "",
    parametersText: JSON.stringify(
      { type: "object", properties: {}, required: [] },
      null,
      2,
    ),
    command: "",
    argsText: "",
    cwd: "",
    input: "json-stdin",
    timeoutMs: "30000",
    maxConcurrentRuns: "",
    delayBetweenRunsMs: "0",
  };
}

function areToolDraftsEqual(left: ToolDraft, right: ToolDraft) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.enabled === right.enabled &&
    left.description === right.description &&
    left.parametersText === right.parametersText &&
    left.command === right.command &&
    left.argsText === right.argsText &&
    left.cwd === right.cwd &&
    left.input === right.input &&
    left.timeoutMs === right.timeoutMs &&
    left.maxConcurrentRuns === right.maxConcurrentRuns &&
    left.delayBetweenRunsMs === right.delayBetweenRunsMs
  );
}

function toolToDraft(tool: LoadedToolInfo): ToolDraft {
  return {
    id: tool.id,
    name: tool.name,
    enabled: tool.enabled,
    description: tool.description,
    parametersText: JSON.stringify(tool.parameters, null, 2),
    command: tool.command,
    argsText: tool.args.join("\n"),
    cwd: tool.cwd ?? "",
    input: tool.input,
    timeoutMs: String(tool.timeoutMs),
    maxConcurrentRuns:
      tool.maxConcurrentRuns === undefined
        ? ""
        : String(tool.maxConcurrentRuns),
    delayBetweenRunsMs: String(tool.delayBetweenRunsMs ?? 0),
  };
}

function isToolExecutionPreview(value: unknown): value is ToolExecutionPreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ToolExecutionPreview>;

  return (
    typeof candidate.command === "string" &&
    Array.isArray(candidate.args) &&
    candidate.args.every((arg) => typeof arg === "string") &&
    (candidate.cwd === undefined || typeof candidate.cwd === "string") &&
    (candidate.inputMode === "none" || candidate.inputMode === "json-stdin") &&
    (candidate.stdin === undefined || typeof candidate.stdin === "string") &&
    typeof candidate.displayCommand === "string" &&
    typeof candidate.usesStdin === "boolean" &&
    typeof candidate.usesPlaceholders === "boolean"
  );
}

function isToolCommandResult(value: unknown): value is ToolCommandResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ToolCommandResult>;

  return (
    (candidate.toolName === undefined ||
      typeof candidate.toolName === "string") &&
    typeof candidate.content === "string" &&
    (typeof candidate.exitCode === "number" || candidate.exitCode === null) &&
    typeof candidate.stdout === "string" &&
    typeof candidate.stderr === "string" &&
    typeof candidate.timedOut === "boolean" &&
    (candidate.execution === undefined ||
      isToolExecutionPreview(candidate.execution))
  );
}

function loadToolTestStates(): Record<string, ToolTestState> {
  if (typeof window === "undefined") return {};

  try {
    const stored = window.localStorage.getItem(TOOL_TEST_STATES_STORAGE_KEY);
    if (!stored) return {};

    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([toolId, value]) => {
          if (typeof toolId !== "string") return null;
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return null;
          }

          const candidate = value as Partial<ToolTestState>;
          const argsText =
            typeof candidate.argsText === "string" ? candidate.argsText : "{}";
          const result = isToolCommandResult(candidate.result)
            ? candidate.result
            : null;

          return [
            toolId,
            { argsText, result } satisfies ToolTestState,
          ] as const;
        })
        .filter(
          (entry): entry is readonly [string, ToolTestState] => entry !== null,
        ),
    );
  } catch {
    return {};
  }
}

function saveToolTestStates(states: Record<string, ToolTestState>) {
  if (typeof window === "undefined") return;

  const persisted = Object.fromEntries(
    Object.entries(states)
      .map(([toolId, state]) => {
        const argsText = state.argsText || "{}";
        const result = state.result ?? null;

        if (argsText.trim() === "{}" && !result) return null;

        return [toolId, { argsText, result }] as const;
      })
      .filter(
        (
          entry,
        ): entry is readonly [
          string,
          { argsText: string; result: ToolCommandResult | null },
        ] => entry !== null,
      ),
  );

  if (Object.keys(persisted).length === 0) {
    window.localStorage.removeItem(TOOL_TEST_STATES_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    TOOL_TEST_STATES_STORAGE_KEY,
    JSON.stringify(persisted),
  );
}

function formatJsonLikeCodeBlock(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "{}";

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

function renderJsonCodeBlock(
  value: string,
  className = TOOL_INFO_CODE_BLOCK_CLASS_NAME,
) {
  const normalized = formatJsonLikeCodeBlock(value);
  return (
    <MarkdownMessage
      className={className}
      content={`~~~json\n${normalized}\n~~~`}
    />
  );
}

function renderCodeBlock(
  value: string,
  language = "text",
  className = TOOL_INFO_CODE_BLOCK_CLASS_NAME,
) {
  return (
    <MarkdownMessage
      className={className}
      content={`~~~${language}\n${value}\n~~~`}
    />
  );
}

function renderCommandCodeBlock(value: string) {
  return renderCodeBlock(value, "bash");
}

function renderToolExecutionPreview(execution?: ToolExecutionPreview) {
  if (!execution) return null;

  return (
    <>
      <div className="grid gap-1.5">
        <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
          Command
        </div>
        {renderCommandCodeBlock(execution.displayCommand)}
      </div>
      {execution.cwd?.trim() && (
        <div className="grid gap-1.5">
          <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
            Working directory
          </div>
          {renderCodeBlock(execution.cwd, "text")}
        </div>
      )}
    </>
  );
}

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

function parseToolArgumentsText(value: string) {
  return value.trim() ? JSON.parse(value) : {};
}

function parseArgsLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0);
}

function buildToolExecutionPreview(
  tool: Pick<LoadedToolInfo, "command" | "args" | "cwd" | "input">,
  modelArgs: unknown,
): ToolExecutionPreview {
  const commandArgs = materializeCommandArgs(tool.args, modelArgs);
  const stdin =
    tool.input === "json-stdin" ? JSON.stringify(modelArgs ?? {}) : undefined;

  return {
    command: tool.command,
    args: commandArgs,
    cwd: tool.cwd,
    inputMode: tool.input,
    stdin,
    displayCommand: formatCommandPreview(tool.command, commandArgs),
    usesStdin: tool.input === "json-stdin",
    usesPlaceholders: extractTemplatePlaceholders(tool.args).length > 0,
  };
}

function buildToolExecutionPreviewForDraft(draft: ToolDraft, argsText: string) {
  try {
    return buildToolExecutionPreview(
      {
        command: draft.command,
        args: parseArgsLines(draft.argsText),
        cwd: draft.cwd.trim() || undefined,
        input: draft.input,
      },
      parseToolArgumentsText(argsText),
    );
  } catch {
    return undefined;
  }
}

function draftToTool(draft: ToolDraft): LoadedToolInfo {
  let parameters: Record<string, unknown>;

  try {
    const parsed = JSON.parse(draft.parametersText || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Parameters schema must be a JSON object.");
    }
    parameters = parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid parameters JSON: ${labelForError(error)}`);
  }

  const args = parseArgsLines(draft.argsText);
  const timeoutMs = Number(draft.timeoutMs);
  const maxConcurrentRuns = Number(draft.maxConcurrentRuns);
  const delayBetweenRunsMs = Number(draft.delayBetweenRunsMs);

  return {
    id: draft.id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    description: draft.description.trim(),
    parameters,
    command: draft.command.trim(),
    args,
    cwd: draft.cwd.trim() || undefined,
    input: draft.input,
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.round(timeoutMs)
        : 30000,
    maxConcurrentRuns:
      draft.maxConcurrentRuns.trim() &&
      Number.isFinite(maxConcurrentRuns) &&
      maxConcurrentRuns > 0
        ? Math.floor(maxConcurrentRuns)
        : undefined,
    delayBetweenRunsMs:
      Number.isFinite(delayBetweenRunsMs) && delayBetweenRunsMs > 0
        ? Math.round(delayBetweenRunsMs)
        : 0,
  };
}

function validateToolDraft(tool: LoadedToolInfo) {
  if (!tool.name) throw new Error("Tool name is required.");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) {
    throw new Error(
      "Tool name must use only letters, numbers, underscores, or hyphens.",
    );
  }
  if (
    tool.name === BUILTIN_ASK_USER_TOOL_NAME ||
    BUILTIN_TASK_TOOL_NAMES.includes(
      tool.name as (typeof BUILTIN_TASK_TOOL_NAMES)[number],
    ) ||
    tool.name === BUILTIN_LOAD_SKILL_TOOL_NAME ||
    tool.name === BUILTIN_CALL_AGENT_TOOL_NAME ||
    tool.name === BUILTIN_WEB_FETCH_TOOL_NAME ||
    BUILTIN_FILE_TOOL_NAMES.includes(tool.name)
  ) {
    throw new Error(
      `${tool.name} is a built-in tool name and cannot be used by a custom tool.`,
    );
  }
  if (!tool.description) throw new Error("Tool description is required.");
  if (tool.parameters.type !== "object") {
    throw new Error('Parameters schema must include "type": "object".');
  }
  if (!tool.command) throw new Error("Command is required.");

  const properties =
    tool.parameters.properties &&
    typeof tool.parameters.properties === "object" &&
    !Array.isArray(tool.parameters.properties)
      ? Object.keys(tool.parameters.properties as Record<string, unknown>)
      : [];
  const required = Array.isArray(tool.parameters.required)
    ? tool.parameters.required.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const propertySet = new Set(properties);
  const requiredSet = new Set(required);

  for (const placeholder of extractTemplatePlaceholders(tool.args)) {
    if (!propertySet.has(placeholder)) {
      throw new Error(
        `Unknown placeholder: ${placeholder}. Add it to schema properties or update args.`,
      );
    }
    if (!requiredSet.has(placeholder)) {
      throw new Error(
        `Placeholder ${placeholder} is used in args, so it must be listed in schema.required for now.`,
      );
    }
  }
}

function formatToolImportSummary(result: ToolImportResult) {
  return [
    `${result.imported} imported`,
    `${result.updated} updated`,
    `${result.renamed.length} renamed`,
    `${result.skipped.length} skipped`,
    `${result.invalid.length} invalid`,
  ].join(" · ");
}

function createUniqueToolCloneName(baseName: string, tools: LoadedToolInfo[]) {
  const existingNames = new Set(tools.map((tool) => tool.name));
  const normalizedBase = baseName.trim() || "tool";

  for (let index = 1; index < 1000; index += 1) {
    const suffix = `_${index}`;
    const candidate = `${normalizedBase.slice(0, 64 - suffix.length)}${suffix}`;
    if (!existingNames.has(candidate)) return candidate;
  }

  return `${normalizedBase.slice(0, 55)}_${createId().slice(0, 8)}`;
}

export const ToolsDialog = memo(function ToolsDialog({
  open,
  onOpenChange,
  toolsSettings,
  onToolsSettingsChange,
  availableTools,
  loadedTools,
  onLoadedToolsChange,
  callAgentEnabled,
  showSuccess,
  showError,
}: ToolsDialogProps) {
  const [toolLoadErrors, setToolLoadErrors] = useState<
    Array<{ source: string; message: string }>
  >([]);
  const [isLoadingTools, setIsLoadingTools] = useState(false);
  const [toolDraft, setToolDraft] = useState<ToolDraft | null>(null);
  const [isSavingTool, setIsSavingTool] = useState(false);
  const [toolTestStatesByToolId, setToolTestStatesByToolId] = useState<
    Record<string, ToolTestState>
  >(() => loadToolTestStates());
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const [builtInToolDrafts, setBuiltInToolDrafts] = useState<
    Record<string, BuiltInToolDraft>
  >({});

  const isAskUserToolSelected = selectedToolName === BUILTIN_ASK_USER_TOOL_NAME;
  const selectedTaskToolInfo = BUILTIN_TASK_TOOL_META.find(
    (tool) => tool.name === selectedToolName,
  );
  const isTaskToolsSelected = Boolean(selectedTaskToolInfo);
  const isLoadSkillToolSelected =
    selectedToolName === BUILTIN_LOAD_SKILL_TOOL_NAME;
  const isCallAgentToolSelected =
    selectedToolName === BUILTIN_CALL_AGENT_TOOL_NAME;
  const isWebFetchToolSelected =
    selectedToolName === BUILTIN_WEB_FETCH_TOOL_NAME;
  const selectedFileToolInfo = BUILTIN_FILE_TOOL_META.find(
    (tool) => tool.name === selectedToolName,
  );
  const builtInToolNames = useMemo(
    () =>
      [
        BUILTIN_ASK_USER_TOOL_NAME,
        ...BUILTIN_TASK_TOOL_NAMES,
        BUILTIN_LOAD_SKILL_TOOL_NAME,
        BUILTIN_CALL_AGENT_TOOL_NAME,
        BUILTIN_WEB_FETCH_TOOL_NAME,
        ...BUILTIN_FILE_TOOL_NAMES,
      ] as string[],
    [],
  );
  const selectedBuiltInToolName =
    selectedToolName && builtInToolNames.includes(selectedToolName)
      ? selectedToolName
      : null;
  const availableToolsByName = useMemo(
    () => new Map(availableTools.map((tool) => [tool.name, tool] as const)),
    [availableTools],
  );
  const selectedTool = useMemo(
    () => loadedTools.find((tool) => tool.name === selectedToolName) ?? null,
    [loadedTools, selectedToolName],
  );
  const totalToolsCount = loadedTools.length + 9;
  const enabledToolsCount = useMemo(() => {
    const builtInNames = [
      BUILTIN_ASK_USER_TOOL_NAME,
      ...BUILTIN_TASK_TOOL_NAMES,
      BUILTIN_LOAD_SKILL_TOOL_NAME,
      BUILTIN_CALL_AGENT_TOOL_NAME,
      BUILTIN_WEB_FETCH_TOOL_NAME,
      ...BUILTIN_FILE_TOOL_NAMES,
    ];
    return (
      loadedTools.filter(
        (tool) =>
          getDisplayedToolPermission(toolsSettings, tool.name) !== "deny",
      ).length +
      builtInNames.filter(
        (toolName) =>
          getDisplayedToolPermission(toolsSettings, toolName) !== "deny",
      ).length
    );
  }, [loadedTools, toolsSettings]);
  const currentToolTestState = toolDraft
    ? toolTestStatesByToolId[toolDraft.id]
    : undefined;
  const currentToolTestArgsText = currentToolTestState?.argsText ?? "{}";
  const currentToolTestResult = currentToolTestState?.result ?? null;
  const isTestingCurrentTool =
    currentToolTestState?.status === "pending" ||
    currentToolTestState?.status === "running";
  const currentToolTestExecutionPreview =
    currentToolTestResult?.execution ??
    (isTestingCurrentTool && toolDraft
      ? buildToolExecutionPreviewForDraft(toolDraft, currentToolTestArgsText)
      : undefined);
  const toolsMasterPermission = getToolsMasterPermission(toolsSettings);
  const childPermissionsLocked = toolsMasterPermission !== "custom";
  useEffect(() => {
    if (!selectedBuiltInToolName) return;
    setBuiltInToolDrafts((current) => ({
      ...current,
      [selectedBuiltInToolName]: getSavedBuiltInToolDraft(
        toolsSettings,
        selectedBuiltInToolName,
      ),
    }));
  }, [selectedBuiltInToolName, toolsSettings]);

  useEffect(() => {
    const isEditingUnsavedTool =
      toolDraft &&
      !selectedToolName &&
      !loadedTools.some((tool) => tool.id === toolDraft.id);

    if (isEditingUnsavedTool) return;

    if (
      selectedToolName === BUILTIN_ASK_USER_TOOL_NAME ||
      isTaskToolsSelected ||
      selectedToolName === BUILTIN_CALL_AGENT_TOOL_NAME ||
      selectedToolName === BUILTIN_LOAD_SKILL_TOOL_NAME ||
      selectedToolName === BUILTIN_LOAD_SKILL_TOOL_NAME ||
      selectedToolName === BUILTIN_WEB_FETCH_TOOL_NAME ||
      Boolean(
        selectedToolName && BUILTIN_FILE_TOOL_NAMES.includes(selectedToolName),
      )
    ) {
      return;
    }

    if (
      !selectedToolName ||
      !loadedTools.some((tool) => tool.name === selectedToolName)
    ) {
      setSelectedToolName(BUILTIN_ASK_USER_TOOL_NAME);
    }
  }, [isTaskToolsSelected, loadedTools, selectedToolName, toolDraft]);

  useEffect(() => {
    if (
      selectedToolName === BUILTIN_ASK_USER_TOOL_NAME ||
      isTaskToolsSelected ||
      selectedToolName === BUILTIN_CALL_AGENT_TOOL_NAME ||
      selectedToolName === BUILTIN_LOAD_SKILL_TOOL_NAME ||
      selectedToolName === BUILTIN_LOAD_SKILL_TOOL_NAME ||
      selectedToolName === BUILTIN_WEB_FETCH_TOOL_NAME ||
      Boolean(
        selectedToolName && BUILTIN_FILE_TOOL_NAMES.includes(selectedToolName),
      )
    ) {
      setToolDraft(null);
      return;
    }

    const selected = loadedTools.find((tool) => tool.name === selectedToolName);
    if (selected) {
      setToolDraft(toolToDraft(selected));
    }
  }, [isTaskToolsSelected, loadedTools, selectedToolName]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      saveToolTestStates(toolTestStatesByToolId);
    }, TOOL_TEST_STATE_SAVE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [toolTestStatesByToolId]);

  function updateToolDraft(patch: Partial<ToolDraft>) {
    setToolDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function updateBuiltInToolDraft(
    toolName: string,
    patch: Partial<BuiltInToolDraft>,
  ) {
    setBuiltInToolDrafts((current) => ({
      ...current,
      [toolName]: {
        ...getSavedBuiltInToolDraft(toolsSettings, toolName),
        ...(current[toolName] ?? {}),
        ...patch,
      },
    }));
  }

  function getDefaultBuiltInDescription(toolName: string, fallback: string) {
    const saved = toolsSettings.builtInToolSettings?.[toolName];
    const currentTool = availableToolsByName.get(toolName);
    if (saved?.descriptionMode === "custom") return fallback;
    return currentTool?.description ?? fallback;
  }

  function getDraftModelDescription(toolName: string, fallback: string) {
    const draft =
      builtInToolDrafts[toolName] ??
      getSavedBuiltInToolDraft(toolsSettings, toolName);
    const customDescription = draft.customDescription.trim();
    return draft.descriptionMode === "custom" && customDescription
      ? customDescription
      : getDefaultBuiltInDescription(toolName, fallback);
  }

  function saveBuiltInToolDraft(toolName: string) {
    const fallbackTimeout = BUILTIN_TOOL_TIMEOUT_FALLBACKS_MS[toolName] ?? 0;
    const draft =
      builtInToolDrafts[toolName] ??
      getSavedBuiltInToolDraft(toolsSettings, toolName);
    const normalizedTimeout = supportsBuiltInTimeout(toolName)
      ? Number(normalizeBuiltInTimeoutText(draft.timeoutMs, fallbackTimeout))
      : undefined;

    onToolsSettingsChange((current) => ({
      ...current,
      builtInToolSettings: {
        ...(current.builtInToolSettings ?? {}),
        [toolName]: {
          descriptionMode: draft.descriptionMode,
          customDescription: draft.customDescription,
          ...(normalizedTimeout !== undefined
            ? { timeoutMs: normalizedTimeout }
            : {}),
        },
      },
    }));

    setBuiltInToolDrafts((current) => ({
      ...current,
      [toolName]: {
        ...draft,
        ...(normalizedTimeout !== undefined
          ? { timeoutMs: String(normalizedTimeout) }
          : {}),
      },
    }));
    showSuccess("Built-in tool settings saved", toolName);
  }

  function resetBuiltInToolDraft(toolName: string) {
    onToolsSettingsChange((current) => {
      const { [toolName]: _removed, ...rest } =
        current.builtInToolSettings ?? {};
      void _removed;
      return {
        ...current,
        builtInToolSettings: rest,
      };
    });

    setBuiltInToolDrafts((current) => ({
      ...current,
      [toolName]: getSavedBuiltInToolDraft(
        { ...toolsSettings, builtInToolSettings: {} },
        toolName,
      ),
    }));
    showSuccess("Built-in tool settings reset", toolName);
  }

  function renderBuiltInToolEditableSettings({
    name,
    defaultDescription,
  }: {
    name: string;
    defaultDescription: string;
  }) {
    const draft =
      builtInToolDrafts[name] ?? getSavedBuiltInToolDraft(toolsSettings, name);
    const savedDraft = getSavedBuiltInToolDraft(toolsSettings, name);
    const hasChanges = !areBuiltInToolDraftsEqual(draft, savedDraft);
    const modelDescription = getDraftModelDescription(name, defaultDescription);

    return (
      <div className="grid gap-4 border bg-muted/10 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Label>Model-facing description</Label>
            <p className="text-sm leading-5 text-muted-foreground">
              This is the exact description the model receives for this built-in
              tool.
            </p>
          </div>
          <div className="whitespace-pre-wrap border bg-background p-3 text-sm leading-5 text-muted-foreground">
            {modelDescription}
          </div>
        </div>

        <div className="grid gap-2 content-start">
          <Label htmlFor={`builtin-${name}-description-mode`}>
            Description
          </Label>
          <Select
            value={draft.descriptionMode}
            onValueChange={(value) =>
              updateBuiltInToolDraft(name, {
                descriptionMode: value === "custom" ? "custom" : "default",
              })
            }
          >
            <SelectTrigger id={`builtin-${name}-description-mode`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={`builtin-${name}-custom-description`}>
            Custom description
          </Label>
          <Textarea
            id={`builtin-${name}-custom-description`}
            value={draft.customDescription}
            onChange={(event) =>
              updateBuiltInToolDraft(name, {
                customDescription: event.target.value,
              })
            }
            disabled={draft.descriptionMode !== "custom"}
            placeholder="Override the description sent to the model."
            className="min-h-32 resize-y"
          />
        </div>

        {supportsBuiltInTimeout(name) ? (
          <div className="grid gap-2 w-full">
            <Label htmlFor={`builtin-${name}-timeout`}>Timeout ms</Label>
            <Input
              id={`builtin-${name}-timeout`}
              value={draft.timeoutMs}
              onChange={(event) =>
                updateBuiltInToolDraft(name, { timeoutMs: event.target.value })
              }
              inputMode="numeric"
            />
          </div>
        ) : null}
        <div className="flex items-center gap-2 justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => resetBuiltInToolDraft(name)}
          >
            Reset
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!hasChanges}
            onClick={() => saveBuiltInToolDraft(name)}
          >
            Save
          </Button>
        </div>
      </div>
    );
  }

  const hasToolDraftChanges = useMemo(() => {
    if (
      !toolDraft ||
      isAskUserToolSelected ||
      isTaskToolsSelected ||
      isLoadSkillToolSelected ||
      isCallAgentToolSelected ||
      isWebFetchToolSelected
    ) {
      return false;
    }

    const originalDraft = selectedTool
      ? toolToDraft(selectedTool)
      : { ...createBlankToolDraft(), id: toolDraft.id };

    return !areToolDraftsEqual(toolDraft, originalDraft);
  }, [
    isAskUserToolSelected,
    isTaskToolsSelected,
    isLoadSkillToolSelected,
    isCallAgentToolSelected,
    isWebFetchToolSelected,
    selectedTool,
    toolDraft,
  ]);

  async function saveCurrentToolDraft() {
    if (!toolDraft) return;
    setIsSavingTool(true);

    try {
      const tool = draftToTool(toolDraft);
      validateToolDraft(tool);
      const savedTool = await saveTool(tool);
      onLoadedToolsChange((current) => {
        const next = current.filter((item) => item.id !== savedTool.id);
        next.push(savedTool);
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      setSelectedToolName(savedTool.name);
      setToolDraft(toolToDraft(savedTool));
      showSuccess("Tool saved");
    } catch (error) {
      showError("Failed to save tool", labelForError(error));
    } finally {
      setIsSavingTool(false);
    }
  }

  async function deleteCurrentTool() {
    if (!toolDraft) return;

    try {
      await deleteStoredTool(toolDraft.id);
      onLoadedToolsChange((current) =>
        current.filter((tool) => tool.id !== toolDraft.id),
      );
      setToolDraft(null);
      setSelectedToolName(null);
      setToolTestStatesByToolId((current) => {
        const { [toolDraft.id]: _deleted, ...rest } = current;
        void _deleted;
        return rest;
      });
      showSuccess("Tool deleted");
    } catch (error) {
      showError("Failed to delete tool", labelForError(error));
    }
  }

  async function importToolFiles() {
    setIsLoadingTools(true);

    try {
      const result = await importTools();
      if (result.cancelled) return;

      const tools = await loadTools();
      onLoadedToolsChange(tools);
      setToolLoadErrors([...result.invalid, ...result.skipped]);

      const summary = formatToolImportSummary(result);
      if (result.imported + result.updated > 0) {
        showSuccess("Tools import completed", summary);
      } else {
        showError("No tools imported", summary);
      }
    } catch (error) {
      showError("Failed to import tools", labelForError(error));
    } finally {
      setIsLoadingTools(false);
    }
  }

  async function exportAllTools() {
    if (loadedTools.length === 0) {
      showError("No custom tools to export");
      return;
    }

    try {
      const result = await exportTools(loadedTools);
      if (result.cancelled) return;
      showSuccess(
        `Exported ${result.exported} tool${result.exported === 1 ? "" : "s"}.`,
        result.path,
      );
    } catch (error) {
      showError("Failed to export tools", labelForError(error));
    }
  }

  async function cloneCurrentTool() {
    if (!toolDraft) return;

    try {
      const clonedDraft = {
        ...toolDraft,
        id: createId(),
        name: createUniqueToolCloneName(toolDraft.name, loadedTools),
      };
      const clonedTool = draftToTool(clonedDraft);
      validateToolDraft(clonedTool);
      const savedTool = await saveTool(clonedTool);

      onLoadedToolsChange((current) => {
        const next = current.filter((item) => item.id !== savedTool.id);
        next.push(savedTool);
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      setSelectedToolName(savedTool.name);
      setToolDraft(toolToDraft(savedTool));
      showSuccess("Tool cloned", savedTool.name);
    } catch (error) {
      showError("Failed to clone tool", labelForError(error));
    }
  }

  async function exportCurrentTool() {
    if (!toolDraft) return;

    try {
      const tool = draftToTool(toolDraft);
      validateToolDraft(tool);
      const result = await exportTool(tool);
      if (result.cancelled) return;
      showSuccess("Tool exported", result.path);
    } catch (error) {
      showError("Failed to export tool", labelForError(error));
    }
  }

  async function openToolStorageFolder() {
    try {
      await openToolsFolder();
    } catch (error) {
      showError("Failed to open tools folder", labelForError(error));
    }
  }

  function updateCurrentToolTestArgsText(argsText: string) {
    if (!toolDraft) return;

    setToolTestStatesByToolId((current) => ({
      ...current,
      [toolDraft.id]: {
        argsText,
        result: current[toolDraft.id]?.result ?? null,
        status: current[toolDraft.id]?.status,
        runId: current[toolDraft.id]?.runId,
      },
    }));
  }

  function clearCurrentToolTest() {
    if (!toolDraft) return;

    setToolTestStatesByToolId((current) => {
      const { [toolDraft.id]: _cleared, ...rest } = current;
      void _cleared;
      return rest;
    });
  }

  function setToolPermission(toolName: string, permission: Permission) {
    onToolsSettingsChange((current) => ({
      ...current,
      enabled: true,
      permissionModelVersion: 2,
      toolPermissions: {
        ...(current.toolPermissions ?? {}),
        [toolName]: permission,
      },
      askUserEnabled:
        toolName === BUILTIN_ASK_USER_TOOL_NAME
          ? permission !== "deny"
          : current.askUserEnabled,
      taskToolsEnabled: (BUILTIN_TASK_TOOL_NAMES as readonly string[]).includes(
        toolName,
      )
        ? permission !== "deny"
        : current.taskToolsEnabled,
      loadSkillEnabled:
        toolName === BUILTIN_LOAD_SKILL_TOOL_NAME
          ? permission !== "deny"
          : current.loadSkillEnabled,
      webFetchEnabled:
        toolName === BUILTIN_WEB_FETCH_TOOL_NAME
          ? permission !== "deny"
          : current.webFetchEnabled,
      readEnabled:
        toolName === BUILTIN_READ_TOOL_NAME
          ? permission !== "deny"
          : current.readEnabled,
      bashEnabled:
        toolName === BUILTIN_BASH_TOOL_NAME
          ? permission !== "deny"
          : current.bashEnabled,
      editEnabled:
        toolName === BUILTIN_EDIT_TOOL_NAME
          ? permission !== "deny"
          : current.editEnabled,
      writeEnabled:
        toolName === BUILTIN_WRITE_TOOL_NAME
          ? permission !== "deny"
          : current.writeEnabled,
    }));
  }

  function renderBuiltInToolRow({
    id,
    name,
    description,
    icon: Icon,
    selected,
    locked = true,
  }: {
    id: string;
    name: string;
    description: string;
    icon: typeof Wrench;
    selected: boolean;
    locked?: boolean;
  }) {
    const permission = getDisplayedToolPermission(toolsSettings, name);

    return (
      <div
        key={id}
        role="button"
        tabIndex={0}
        className={cn(
          "group flex min-w-0 cursor-pointer items-start gap-2 border px-2 py-2 outline-none",
          selected
            ? "border-primary/30 bg-accent text-accent-foreground"
            : "border-transparent hover:border-border hover:bg-muted/60",
        )}
        onClick={() => setSelectedToolName(name)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedToolName(name);
          }
        }}
      >
        <Icon className="mt-1 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 truncate text-base leading-6">
            <span className="truncate">{name}</span>
            {locked ? (
              <Lock className="size-3 shrink-0 text-muted-foreground" />
            ) : null}
          </div>
          <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        <PermissionSelect
          value={permission}
          disabled={childPermissionsLocked}
          onChange={(next) => setToolPermission(name, next)}
        />
      </div>
    );
  }

  async function runCurrentToolTest() {
    if (!toolDraft) return;

    const tool = draftToTool(toolDraft);
    const argsText = currentToolTestArgsText;
    const runId = createId();

    setToolTestStatesByToolId((current) => ({
      ...current,
      [tool.id]: {
        argsText,
        result: null,
        status: "running",
        runId,
      },
    }));

    function finish(result: ToolCommandResult) {
      setToolTestStatesByToolId((current) => {
        const previous = current[tool.id] ?? { argsText, result: null };
        if (previous.runId && previous.runId !== runId) return current;

        return {
          ...current,
          [tool.id]: {
            argsText: previous.argsText ?? argsText,
            result,
          },
        };
      });
    }

    try {
      validateToolDraft(tool);
      const args = parseToolArgumentsText(argsText);
      const result = await runQueuedTool(
        tool.name,
        tool,
        () => getToolsBridge().test({ tool, args }),
        (status) => {
          setToolTestStatesByToolId((current) => {
            const previous = current[tool.id] ?? { argsText, result: null };
            if (previous.runId && previous.runId !== runId) return current;

            return {
              ...current,
              [tool.id]: {
                ...previous,
                argsText: previous.argsText ?? argsText,
                result: null,
                status,
                runId,
              },
            };
          });
        },
      );
      finish(result);
    } catch (error) {
      finish({
        content: `Error: ${labelForError(error)}`,
        exitCode: null,
        stdout: "",
        stderr: labelForError(error),
        timedOut: false,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>Tools</DialogTitle>
          <DialogDescription>
            Define custom tools, choose which ones are available to the model,
            and test them before use.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[400px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b bg-card/70 p-3 md:border-b-0 md:border-r">
            <div className="mb-3 flex items-start justify-between gap-3 border bg-background px-3 py-2 text-base">
              <span className="min-w-0">
                <span className="block font-medium">Tools</span>
                <span className="block select-none text-sm leading-5 text-muted-foreground">
                  Master permission for the whole tools feature. Modes can
                  override it.
                </span>
              </span>
              <MasterPermissionSelect
                value={toolsMasterPermission}
                onChange={(permission) =>
                  onToolsSettingsChange((current) => ({
                    ...current,
                    enabled: permission !== "deny",
                    toolsPermission: permission,
                    permissionModelVersion: 2,
                  }))
                }
              />
            </div>

            <div className="mb-3 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="flex-1 "
                onClick={() => {
                  const draft = createBlankToolDraft();
                  setSelectedToolName(null);
                  setToolDraft(draft);
                }}
              >
                <Plus className="size-4" />
                Add tool
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className=""
                    title="Tool actions"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem
                    disabled={isLoadingTools}
                    onSelect={() => void importToolFiles()}
                  >
                    <Upload className="size-4" />
                    Import tools...
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void exportAllTools()}>
                    <Download className="size-4" />
                    Export all tools...
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void openToolStorageFolder()}
                  >
                    <FolderOpen className="size-4" />
                    Open tools folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="grid gap-1.5">
              <GroupHeading className="mt-0">Built-in</GroupHeading>

              {renderBuiltInToolRow({
                id: BUILTIN_ASK_USER_TOOL_ID,
                name: BUILTIN_ASK_USER_TOOL_NAME,
                description: getDraftModelDescription(
                  BUILTIN_ASK_USER_TOOL_NAME,
                  BUILTIN_ASK_USER_TOOL_DESCRIPTION,
                ),
                icon: MessageSquareText,
                selected: isAskUserToolSelected,
              })}

              {BUILTIN_TASK_TOOL_META.map((taskTool) =>
                renderBuiltInToolRow({
                  id: taskTool.id,
                  name: taskTool.name,
                  description: getDraftModelDescription(
                    taskTool.name,
                    taskTool.description,
                  ),
                  icon: ListTodo,
                  selected: selectedToolName === taskTool.name,
                }),
              )}

              {renderBuiltInToolRow({
                id: BUILTIN_LOAD_SKILL_TOOL_ID,
                name: BUILTIN_LOAD_SKILL_TOOL_NAME,
                description: getDraftModelDescription(
                  BUILTIN_LOAD_SKILL_TOOL_NAME,
                  BUILTIN_LOAD_SKILL_TOOL_DESCRIPTION,
                ),
                icon: BookOpen,
                selected: selectedToolName === BUILTIN_LOAD_SKILL_TOOL_NAME,
              })}

              {renderBuiltInToolRow({
                id: BUILTIN_CALL_AGENT_TOOL_ID,
                name: BUILTIN_CALL_AGENT_TOOL_NAME,
                description: getDraftModelDescription(
                  BUILTIN_CALL_AGENT_TOOL_NAME,
                  BUILTIN_CALL_AGENT_TOOL_DESCRIPTION,
                ),
                icon: Bot,
                selected: isCallAgentToolSelected,
              })}

              {renderBuiltInToolRow({
                id: BUILTIN_WEB_FETCH_TOOL_ID,
                name: BUILTIN_WEB_FETCH_TOOL_NAME,
                description: getDraftModelDescription(
                  BUILTIN_WEB_FETCH_TOOL_NAME,
                  BUILTIN_WEB_FETCH_TOOL_DESCRIPTION,
                ),
                icon: Globe,
                selected: isWebFetchToolSelected,
              })}

              {BUILTIN_FILE_TOOL_META.map((fileTool) =>
                renderBuiltInToolRow({
                  id: fileTool.id,
                  name: fileTool.name,
                  description: getDraftModelDescription(
                    fileTool.name,
                    fileTool.description,
                  ),
                  icon: fileTool.icon,
                  selected: selectedToolName === fileTool.name,
                }),
              )}

              <GroupHeading>Custom tools</GroupHeading>

              {loadedTools.map((tool) => (
                <div
                  key={tool.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "group flex min-w-0 cursor-pointer items-start gap-2  border px-2 py-2 outline-none",
                    selectedTool?.id === tool.id
                      ? "border-primary/30 bg-accent text-accent-foreground"
                      : "border-transparent hover:border-border hover:bg-muted/60",
                  )}
                  onClick={() => setSelectedToolName(tool.name)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedToolName(tool.name);
                    }
                  }}
                >
                  <Wrench className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base leading-6">
                      {tool.name}
                    </div>
                    <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">
                      {tool.description || "Custom command tool."}
                    </p>
                  </div>
                  <PermissionSelect
                    value={getDisplayedToolPermission(toolsSettings, tool.name)}
                    disabled={childPermissionsLocked}
                    onChange={(next) => setToolPermission(tool.name, next)}
                  />
                </div>
              ))}

              {loadedTools.length === 0 && (
                <div className=" border border-dashed px-3 py-4 text-center text-base text-muted-foreground">
                  No custom tools configured.
                </div>
              )}
            </div>

            {toolLoadErrors.length > 0 && (
              <div className="mt-4 grid gap-2">
                <GroupHeading className="mt-0">Tool file issues</GroupHeading>
                {toolLoadErrors.map((error) => (
                  <div
                    key={`${error.source}:${error.message}`}
                    className=" border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-sm leading-5"
                  >
                    <div
                      className="truncate font-medium text-destructive"
                      title={error.source}
                    >
                      {error.source}
                    </div>
                    <div className="text-muted-foreground">{error.message}</div>
                  </div>
                ))}
              </div>
            )}
          </aside>

          <div className="min-h-0 flex flex-col overflow-hidden">
            {isAskUserToolSelected ? (
              <>
                <div className="z-20 flex min-h-[4.25rem] shrink-0 items-center border-b bg-background px-5 py-3">
                  <div className="flex w-full items-center justify-between gap-4">
                    <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                      Built-in tool
                    </Label>
                    <span className="inline-flex shrink-0 items-center gap-1  border bg-muted/40 px-2 py-1 text-sm text-muted-foreground">
                      <Lock className="size-3.5" />
                      Locked
                    </span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                  <div className="grid gap-5 pb-1">
                    <div className="grid gap-1">
                      <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                        <MessageSquareText className="size-5 text-muted-foreground" />
                        {BUILTIN_ASK_USER_TOOL_NAME}
                      </h3>
                      <p className="max-w-2xl text-base leading-6 text-muted-foreground">
                        {getDraftModelDescription(
                          BUILTIN_ASK_USER_TOOL_NAME,
                          BUILTIN_ASK_USER_TOOL_DESCRIPTION,
                        )}
                      </p>
                    </div>

                    {selectedBuiltInToolName
                      ? renderBuiltInToolEditableSettings({
                          name: selectedBuiltInToolName,
                          defaultDescription: getStaticBuiltInDescription(
                            selectedBuiltInToolName,
                          ),
                        })
                      : null}

                    <div className="grid gap-2">
                      <Label>Behavior</Label>
                      <div className="grid gap-2 text-base leading-6 text-muted-foreground">
                        <p>
                          The assistant can call this tool when it needs a
                          decision before continuing. The response pauses, shows
                          one compact form, and resumes after you submit the
                          answers.
                        </p>
                        <p>
                          It supports up to 5 questions per form. Questions can
                          be single-choice, multi-select, or text-only. Choice
                          questions support up to 8 model-provided options, and
                          each option should include a short label plus a gray
                          helper description when useful. Chat Forge always adds
                          a custom “Type your answer” option to choice
                          questions.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label>Parameters JSON schema</Label>
                      {renderJsonCodeBlock(
                        JSON.stringify(
                          BUILTIN_ASK_USER_TOOL_PARAMETERS,
                          null,
                          2,
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : isTaskToolsSelected ? (
              <>
                <div className="z-20 flex min-h-[4.25rem] shrink-0 items-center border-b bg-background px-5 py-3">
                  <div className="flex w-full items-center justify-between gap-4">
                    <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                      Built-in tool
                    </Label>
                    <span className="inline-flex shrink-0 items-center gap-1  border bg-muted/40 px-2 py-1 text-sm text-muted-foreground">
                      <Lock className="size-3.5" />
                      Locked
                    </span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                  <div className="grid gap-5 pb-1">
                    <div className="grid gap-1">
                      <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                        <ListTodo className="size-5 text-muted-foreground" />
                        {selectedTaskToolInfo?.name}
                      </h3>
                      <p className="max-w-2xl text-base leading-6 text-muted-foreground">
                        {selectedTaskToolInfo
                          ? getDraftModelDescription(
                              selectedTaskToolInfo.name,
                              selectedTaskToolInfo.description,
                            )
                          : BUILTIN_TASK_TOOLS_DESCRIPTION}
                      </p>
                    </div>

                    {selectedBuiltInToolName
                      ? renderBuiltInToolEditableSettings({
                          name: selectedBuiltInToolName,
                          defaultDescription: getStaticBuiltInDescription(
                            selectedBuiltInToolName,
                          ),
                        })
                      : null}

                    <div className="grid gap-2">
                      <Label>Behavior</Label>
                      <div className="grid gap-2 text-base leading-6 text-muted-foreground">
                        <p>
                          The assistant can use the task list tool during
                          complex work to show and update the checklist in the
                          current chat. It always sends the full current list in
                          one call.
                        </p>
                        <p>
                          Each task has a short subject and a done boolean.
                          Sending an empty tasks array clears the visible
                          checklist. Every successful task tool call renders the
                          current task list in chat.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label>Parameters JSON schema</Label>
                      {renderJsonCodeBlock(
                        JSON.stringify(
                          selectedTaskToolInfo
                            ? BUILTIN_TASK_TOOL_PARAMETERS[
                                selectedTaskToolInfo.name
                              ]
                            : {},
                          null,
                          2,
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : isLoadSkillToolSelected ? (
              <>
                <div className="z-20 flex min-h-[4.25rem] shrink-0 items-center border-b bg-background px-5 py-3">
                  <div className="flex w-full items-center justify-between gap-4">
                    <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                      Built-in tool
                    </Label>
                    <span className="inline-flex shrink-0 items-center gap-1 border bg-muted/40 px-2 py-1 text-sm text-muted-foreground">
                      <Lock className="size-3.5" />
                      Locked
                    </span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                  <div className="grid gap-5 pb-1">
                    <div className="grid gap-1">
                      <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                        <BookOpen className="size-5 text-muted-foreground" />
                        {BUILTIN_LOAD_SKILL_TOOL_NAME}
                      </h3>
                      <p className="max-w-2xl text-base leading-6 text-muted-foreground">
                        {getDraftModelDescription(
                          BUILTIN_LOAD_SKILL_TOOL_NAME,
                          BUILTIN_LOAD_SKILL_TOOL_DESCRIPTION,
                        )}
                      </p>
                    </div>

                    {selectedBuiltInToolName
                      ? renderBuiltInToolEditableSettings({
                          name: selectedBuiltInToolName,
                          defaultDescription: getStaticBuiltInDescription(
                            selectedBuiltInToolName,
                          ),
                        })
                      : null}

                    <div className="grid gap-2">
                      <Label>Behavior</Label>
                      <div className="grid gap-2 text-base leading-6 text-muted-foreground">
                        <p>
                          The assistant can call this tool to load full SKILL.md
                          instructions for a discovered skill by exact name.
                        </p>
                        <p>
                          The result includes the skill file location and the
                          directory used to resolve relative references such as
                          examples or scripts.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label>Parameters JSON schema</Label>
                      {renderJsonCodeBlock(
                        JSON.stringify(
                          BUILTIN_LOAD_SKILL_TOOL_PARAMETERS,
                          null,
                          2,
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : isCallAgentToolSelected ? (
              <>
                <div className="z-20 flex min-h-[4.25rem] shrink-0 items-center border-b bg-background px-5 py-3">
                  <div className="flex w-full items-center justify-between gap-4">
                    <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                      Built-in tool
                    </Label>
                    <span className="inline-flex shrink-0 items-center gap-1  border bg-muted/40 px-2 py-1 text-sm text-muted-foreground">
                      <Lock className="size-3.5" />
                      Locked
                    </span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                  <div className="grid gap-5 pb-1">
                    <div className="grid gap-1">
                      <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                        <Bot className="size-5 text-muted-foreground" />
                        {BUILTIN_CALL_AGENT_TOOL_NAME}
                      </h3>
                      <p className="max-w-2xl text-base leading-6 text-muted-foreground">
                        {getDraftModelDescription(
                          BUILTIN_CALL_AGENT_TOOL_NAME,
                          BUILTIN_CALL_AGENT_TOOL_DESCRIPTION,
                        )}
                      </p>
                    </div>

                    {selectedBuiltInToolName
                      ? renderBuiltInToolEditableSettings({
                          name: selectedBuiltInToolName,
                          defaultDescription: getStaticBuiltInDescription(
                            selectedBuiltInToolName,
                          ),
                        })
                      : null}

                    <div className="grid gap-2">
                      <Label>Behavior</Label>
                      <div className="grid gap-2 text-base leading-6 text-muted-foreground">
                        <p>
                          The assistant can call this tool to delegate a focused
                          subtask to an enabled agent, then use that agent's
                          result in the same response.
                        </p>
                        <p>
                          Availability is controlled by Agents settings, enabled
                          agents for the current chat, and this chat's tool
                          picker. Custom tool settings do not affect it.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label>Parameters JSON schema</Label>
                      {renderJsonCodeBlock(
                        JSON.stringify(
                          BUILTIN_CALL_AGENT_TOOL_PARAMETERS,
                          null,
                          2,
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : isWebFetchToolSelected ? (
              <>
                <div className="z-20 flex min-h-[4.25rem] shrink-0 items-center border-b bg-background px-5 py-3">
                  <div className="flex w-full items-center justify-between gap-4">
                    <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                      Built-in tool
                    </Label>
                    <span className="inline-flex shrink-0 items-center gap-1  border bg-muted/40 px-2 py-1 text-sm text-muted-foreground">
                      <Lock className="size-3.5" />
                      Locked
                    </span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                  <div className="grid gap-5 pb-1">
                    <div className="grid gap-1">
                      <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                        <Globe className="size-5 text-muted-foreground" />
                        {BUILTIN_WEB_FETCH_TOOL_NAME}
                      </h3>
                      <p className="max-w-2xl text-base leading-6 text-muted-foreground">
                        {getDraftModelDescription(
                          BUILTIN_WEB_FETCH_TOOL_NAME,
                          BUILTIN_WEB_FETCH_TOOL_DESCRIPTION,
                        )}
                      </p>
                    </div>

                    {selectedBuiltInToolName
                      ? renderBuiltInToolEditableSettings({
                          name: selectedBuiltInToolName,
                          defaultDescription: getStaticBuiltInDescription(
                            selectedBuiltInToolName,
                          ),
                        })
                      : null}

                    <div className="grid gap-2">
                      <Label>Behavior</Label>
                      <div className="grid gap-2 text-base leading-6 text-muted-foreground">
                        <p>
                          The assistant can call this tool only when it already
                          has an exact URL, such as a documentation link from a
                          skill or a link pasted by the user. It does not search
                          for unknown pages.
                        </p>
                        <p>
                          Chat Forge fetches the page safely, blocks local or
                          private network addresses, extracts readable text,
                          supports URL fragments like #commands, and truncates
                          long results automatically.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label>Parameters JSON schema</Label>
                      {renderJsonCodeBlock(
                        JSON.stringify(
                          BUILTIN_WEB_FETCH_TOOL_PARAMETERS,
                          null,
                          2,
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : selectedFileToolInfo ? (
              <>
                <div className="z-20 flex min-h-[4.25rem] shrink-0 items-center border-b bg-background px-5 py-3">
                  <div className="flex w-full items-center justify-between gap-4">
                    <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                      Built-in tool
                    </Label>
                    <span className="inline-flex shrink-0 items-center gap-1  border bg-muted/40 px-2 py-1 text-sm text-muted-foreground">
                      <Lock className="size-3.5" />
                      Locked
                    </span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                  <div className="grid gap-5 pb-1">
                    <div className="grid gap-1">
                      <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                        {(() => {
                          const Icon = selectedFileToolInfo.icon;
                          return (
                            <Icon className="size-5 text-muted-foreground" />
                          );
                        })()}
                        {selectedFileToolInfo.name}
                      </h3>
                      <p className="max-w-2xl text-base leading-6 text-muted-foreground">
                        {getDraftModelDescription(
                          selectedFileToolInfo.name,
                          selectedFileToolInfo.description,
                        )}
                      </p>
                    </div>

                    {selectedBuiltInToolName
                      ? renderBuiltInToolEditableSettings({
                          name: selectedBuiltInToolName,
                          defaultDescription: getStaticBuiltInDescription(
                            selectedBuiltInToolName,
                          ),
                        })
                      : null}

                    <div className="grid gap-2">
                      <Label>Behavior</Label>
                      <div className="grid gap-2 text-base leading-6 text-muted-foreground">
                        <p>
                          Relative paths resolve from the selected workspace, or
                          from the user home folder when no workspace is
                          selected.
                        </p>
                        <p>
                          Use the global and mode permission selectors to choose
                          Allow, Ask, or Deny.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label>Parameters JSON schema</Label>
                      {renderJsonCodeBlock(
                        JSON.stringify(
                          selectedFileToolInfo.parameters,
                          null,
                          2,
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : toolDraft ? (
              <>
                <div className="z-20 flex min-h-[4.25rem] shrink-0 items-center border-b bg-background px-5 py-3">
                  <div className="flex w-full items-center justify-between gap-4">
                    <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                      {selectedTool ? "Edit tool" : "Create tool"}
                    </Label>
                    {selectedTool && toolDraft && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className=""
                            title="Tool options"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            onSelect={() => void cloneCurrentTool()}
                          >
                            <Copy className="size-4" />
                            Clone
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => void exportCurrentTool()}
                          >
                            <Download className="size-4" />
                            Export
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => void deleteCurrentTool()}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                  <div className="grid gap-5 pb-1">
                    <div className="grid gap-1">
                      <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                        <Wrench className="size-5 text-muted-foreground" />
                        {toolDraft.name || "Custom tool"}
                      </h3>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="tool-name">Name</Label>
                      <Input
                        id="tool-name"
                        value={toolDraft.name}
                        onChange={(event) =>
                          updateToolDraft({ name: event.target.value })
                        }
                        placeholder="calculate_square_root"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="tool-description">Description</Label>
                      <Textarea
                        id="tool-description"
                        value={toolDraft.description}
                        onChange={(event) =>
                          updateToolDraft({ description: event.target.value })
                        }
                        placeholder="Describe when the model should use this tool."
                        className="min-h-40 resize-y"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="tool-command">Command</Label>
                      <Input
                        id="tool-command"
                        value={toolDraft.command}
                        onChange={(event) =>
                          updateToolDraft({ command: event.target.value })
                        }
                        placeholder="node / python / rg / git"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="tool-schema">
                        Parameters JSON schema
                      </Label>
                      <Textarea
                        id="tool-schema"
                        value={toolDraft.parametersText}
                        onChange={(event) =>
                          updateToolDraft({
                            parametersText: event.target.value,
                          })
                        }
                        className="min-h-64 resize-y font-mono text-sm"
                        spellCheck={false}
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="tool-args">Arguments, one per line</Label>
                      <Textarea
                        id="tool-args"
                        value={toolDraft.argsText}
                        onChange={(event) =>
                          updateToolDraft({ argsText: event.target.value })
                        }
                        placeholder={
                          "C:/Prime/Tools/math-tool/dist/index.js\n--query\n{{query}}"
                        }
                        className="min-h-32 resize-y font-mono text-sm"
                        spellCheck={false}
                      />
                      <p className="text-sm leading-5 text-muted-foreground">
                        Use <code>{"{{fieldName}}"}</code> placeholders for
                        existing CLIs. Every placeholder must exist in
                        schema.properties and schema.required.
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="tool-input-mode">Input mode</Label>
                        <Select
                          value={toolDraft.input}
                          onValueChange={(value) =>
                            updateToolDraft({
                              input: value === "none" ? "none" : "json-stdin",
                            })
                          }
                        >
                          <SelectTrigger id="tool-input-mode" className="">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="json-stdin">
                              JSON stdin
                            </SelectItem>
                            <SelectItem value="none">None</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-sm leading-5 text-muted-foreground">
                          JSON stdin is best for scripts you write. None is best
                          for existing CLI flags/placeholders.
                        </p>
                      </div>
                      <div className="grid gap-2 content-start">
                        <Label htmlFor="tool-timeout">Timeout ms</Label>
                        <Input
                          id="tool-timeout"
                          value={toolDraft.timeoutMs}
                          onChange={(event) =>
                            updateToolDraft({ timeoutMs: event.target.value })
                          }
                          inputMode="numeric"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3  border bg-muted/20 p-3">
                      <div>
                        <Label>Execution limits</Label>
                        <p className="text-sm leading-5 text-muted-foreground">
                          Leave concurrency empty for the current parallel
                          behavior. Use 1 plus a delay for rate-limited tools.
                        </p>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="grid gap-2">
                          <Label htmlFor="tool-max-concurrent-runs">
                            Max concurrent runs
                          </Label>
                          <Input
                            id="tool-max-concurrent-runs"
                            value={toolDraft.maxConcurrentRuns}
                            onChange={(event) =>
                              updateToolDraft({
                                maxConcurrentRuns: event.target.value,
                              })
                            }
                            inputMode="numeric"
                            placeholder="Empty = unlimited"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="tool-delay-between-runs">
                            Delay between runs, ms
                          </Label>
                          <Input
                            id="tool-delay-between-runs"
                            value={toolDraft.delayBetweenRunsMs}
                            onChange={(event) =>
                              updateToolDraft({
                                delayBetweenRunsMs: event.target.value,
                              })
                            }
                            inputMode="numeric"
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="tool-cwd">Working directory</Label>
                      <Input
                        id="tool-cwd"
                        value={toolDraft.cwd}
                        onChange={(event) =>
                          updateToolDraft({ cwd: event.target.value })
                        }
                        placeholder="Optional. Example: C:/Prime/Tools/math-tool"
                      />
                    </div>

                    <Separator />

                    <div className="grid gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <Label>Test tool</Label>
                          <p className="text-sm leading-5 text-muted-foreground">
                            Run this manifest locally with sample model
                            arguments.
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            className=""
                            onClick={clearCurrentToolTest}
                            disabled={
                              !currentToolTestState || isTestingCurrentTool
                            }
                          >
                            Clear test
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className=""
                            onClick={runCurrentToolTest}
                            disabled={isTestingCurrentTool}
                          >
                            {currentToolTestState?.status === "pending"
                              ? "Waiting..."
                              : isTestingCurrentTool
                                ? "Running..."
                                : "Run test"}
                          </Button>
                        </div>
                      </div>
                      <Textarea
                        value={currentToolTestArgsText}
                        onChange={(event) =>
                          updateCurrentToolTestArgsText(event.target.value)
                        }
                        disabled={isTestingCurrentTool}
                        className="min-h-24 resize-y font-mono text-sm"
                        spellCheck={false}
                        placeholder='{ "value": 144 }'
                      />
                      {(currentToolTestResult ||
                        currentToolTestExecutionPreview) && (
                        <div className="grid gap-3  border bg-card p-3">
                          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                            {currentToolTestResult ? (
                              <span>
                                Exit: {currentToolTestResult.exitCode ?? "null"}{" "}
                                ·{" "}
                                {currentToolTestResult.timedOut
                                  ? "Timed out"
                                  : "Completed"}
                              </span>
                            ) : (
                              <span>
                                {currentToolTestState?.status === "pending"
                                  ? "Waiting for execution slot"
                                  : "Running command"}
                              </span>
                            )}
                            {currentToolTestResult ? (
                              currentToolTestResult.exitCode !== 0 ||
                              currentToolTestResult.timedOut ? (
                                <span className="inline-flex items-center gap-1 text-destructive">
                                  <X className="size-3.5" />
                                  Failed
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                                  <Check className="size-3.5" />
                                  Complete
                                </span>
                              )
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                <Spinner className="size-3.5" />
                                {currentToolTestState?.status === "pending"
                                  ? "Waiting"
                                  : "Running"}
                              </span>
                            )}
                          </div>
                          {renderToolExecutionPreview(
                            currentToolTestExecutionPreview,
                          )}
                          {currentToolTestResult && (
                            <div className="grid gap-1.5">
                              <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                                Output
                              </div>
                              {renderJsonCodeBlock(
                                currentToolTestResult.content,
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
                <div className="flex h-full items-center justify-center  border border-dashed p-8 text-center text-base text-muted-foreground">
                  Select a tool or add a new one.
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 items-center justify-between border-t px-5 py-3">
          <div />
          <div className="flex gap-2">
            {!isAskUserToolSelected &&
            !isTaskToolsSelected &&
            !isLoadSkillToolSelected &&
            !isCallAgentToolSelected &&
            !isWebFetchToolSelected &&
            toolDraft ? (
              <Button
                type="button"
                variant="secondary"
                className=""
                onClick={() => {
                  if (selectedTool) setToolDraft(toolToDraft(selectedTool));
                  else setToolDraft(createBlankToolDraft());
                }}
                disabled={!hasToolDraftChanges || isSavingTool}
              >
                Reset
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                className=""
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            )}
            {!isAskUserToolSelected &&
              !isTaskToolsSelected &&
              !isLoadSkillToolSelected &&
              !isCallAgentToolSelected &&
              !isWebFetchToolSelected && (
                <Button
                  type="button"
                  className=""
                  onClick={saveCurrentToolDraft}
                  disabled={!toolDraft || isSavingTool || !hasToolDraftChanges}
                >
                  {isSavingTool ? "Saving..." : "Save"}
                </Button>
              )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
