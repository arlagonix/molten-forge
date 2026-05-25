import {
  BookOpen,
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
import { Switch } from "@/components/ui/switch";
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
  LoadedToolInfo,
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
const BUILTIN_CHECKLIST_WRITE_TOOL_NAME = "checklist_write";
const BUILTIN_CHECKLIST_WRITE_TOOL_ID = "builtin-checklist-write";
const BUILTIN_LOAD_SKILL_TOOL_NAME = "load_skill";
const BUILTIN_LOAD_SKILL_TOOL_ID = "builtin-load-skill";
const BUILTIN_WEB_FETCH_TOOL_NAME = "web_fetch";
const BUILTIN_WEB_FETCH_TOOL_ID = "builtin-web-fetch";
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
const BUILTIN_CHECKLIST_WRITE_TOOL_DESCRIPTION =
  "Creates visible checklist snapshots for tracking progress during complex multi-step work.";
const BUILTIN_LOAD_SKILL_TOOL_DESCRIPTION =
  "Loads full instructions for one relevant skill and activates it for the current chat when skills are available.";
const BUILTIN_WEB_FETCH_TOOL_DESCRIPTION =
  "Fetches readable text from a specific HTTP/HTTPS URL. It can read official docs or user-provided links, but it does not search the web.";
const BUILTIN_LOAD_SKILL_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    skillName: {
      type: "string",
      description: "Exact skill name to load from the available skills list.",
    },
  },
  required: ["skillName"],
};

const TOOL_INFO_CODE_BLOCK_CLASS_NAME =
  "chat-markdown-compact chat-tool-info-codeblock";

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

const BUILTIN_CHECKLIST_WRITE_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description:
        "Checklist items. Include the full current checklist snapshot. Each item must explicitly set done to true or false.",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Short user-visible checklist item.",
          },
          done: {
            type: "boolean",
            description: "Whether this item is completed.",
          },
        },
        required: ["content", "done"],
      },
    },
  },
  required: ["items"],
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

type ToolsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toolsSettings: ToolsSettings;
  onToolsSettingsChange: Dispatch<SetStateAction<ToolsSettings>>;
  loadedTools: LoadedToolInfo[];
  onLoadedToolsChange: Dispatch<SetStateAction<LoadedToolInfo[]>>;
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
    tool.name === BUILTIN_CHECKLIST_WRITE_TOOL_NAME ||
    tool.name === BUILTIN_LOAD_SKILL_TOOL_NAME ||
    tool.name === BUILTIN_WEB_FETCH_TOOL_NAME
  ) {
    throw new Error(
      `${tool.name} is a built-in tool name and cannot be used by a custom command tool.`,
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
  loadedTools,
  onLoadedToolsChange,
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

  const isAskUserToolSelected = selectedToolName === BUILTIN_ASK_USER_TOOL_NAME;
  const isChecklistWriteToolSelected =
    selectedToolName === BUILTIN_CHECKLIST_WRITE_TOOL_NAME;
  const isLoadSkillToolSelected =
    selectedToolName === BUILTIN_LOAD_SKILL_TOOL_NAME;
  const isWebFetchToolSelected =
    selectedToolName === BUILTIN_WEB_FETCH_TOOL_NAME;
  const selectedTool = useMemo(
    () => loadedTools.find((tool) => tool.name === selectedToolName) ?? null,
    [loadedTools, selectedToolName],
  );
  const totalToolsCount = loadedTools.length + 4;
  const enabledToolsCount = useMemo(
    () =>
      loadedTools.filter((tool) => tool.enabled).length +
      (toolsSettings.askUserEnabled ? 1 : 0) +
      (toolsSettings.checklistWriteEnabled ? 1 : 0) +
      (toolsSettings.loadSkillEnabled ? 1 : 0) +
      (toolsSettings.webFetchEnabled ? 1 : 0),
    [
      loadedTools,
      toolsSettings.askUserEnabled,
      toolsSettings.checklistWriteEnabled,
      toolsSettings.loadSkillEnabled,
      toolsSettings.webFetchEnabled,
    ],
  );
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

  useEffect(() => {
    const isEditingUnsavedTool =
      toolDraft &&
      !selectedToolName &&
      !loadedTools.some((tool) => tool.id === toolDraft.id);

    if (isEditingUnsavedTool) return;

    if (
      selectedToolName === BUILTIN_ASK_USER_TOOL_NAME ||
      selectedToolName === BUILTIN_CHECKLIST_WRITE_TOOL_NAME ||
      selectedToolName === BUILTIN_LOAD_SKILL_TOOL_NAME ||
      selectedToolName === BUILTIN_WEB_FETCH_TOOL_NAME
    ) {
      return;
    }

    if (
      !selectedToolName ||
      !loadedTools.some((tool) => tool.name === selectedToolName)
    ) {
      setSelectedToolName(BUILTIN_ASK_USER_TOOL_NAME);
    }
  }, [loadedTools, selectedToolName, toolDraft]);

  useEffect(() => {
    if (
      selectedToolName === BUILTIN_ASK_USER_TOOL_NAME ||
      selectedToolName === BUILTIN_CHECKLIST_WRITE_TOOL_NAME ||
      selectedToolName === BUILTIN_LOAD_SKILL_TOOL_NAME ||
      selectedToolName === BUILTIN_WEB_FETCH_TOOL_NAME
    ) {
      setToolDraft(null);
      return;
    }

    const selected = loadedTools.find((tool) => tool.name === selectedToolName);
    if (selected) {
      setToolDraft(toolToDraft(selected));
    }
  }, [loadedTools, selectedToolName]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      saveToolTestStates(toolTestStatesByToolId);
    }, TOOL_TEST_STATE_SAVE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [toolTestStatesByToolId]);

  function updateToolDraft(patch: Partial<ToolDraft>) {
    setToolDraft((current) => (current ? { ...current, ...patch } : current));
  }

  const hasToolDraftChanges = useMemo(() => {
    if (
      !toolDraft ||
      isAskUserToolSelected ||
      isChecklistWriteToolSelected ||
      isLoadSkillToolSelected ||
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
    isChecklistWriteToolSelected,
    isLoadSkillToolSelected,
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
            Define local command tools, choose which ones are available to the
            model, and test them before use.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b bg-card/70 p-3 md:border-b-0 md:border-r">
            <div className="mb-3 flex items-center justify-between gap-2">
              <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Tools
              </Label>
              <span className="text-sm text-muted-foreground">
                {enabledToolsCount}/{totalToolsCount} enabled
              </span>
            </div>

            <div
              role="button"
              tabIndex={0}
              className="mb-3 flex cursor-pointer items-center justify-between gap-3  border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() =>
                onToolsSettingsChange((current) => ({
                  ...current,
                  enabled: !current.enabled,
                }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToolsSettingsChange((current) => ({
                    ...current,
                    enabled: !current.enabled,
                  }));
                }
              }}
            >
              <span className="min-w-0">
                <span className="block font-medium">Enable tools globally</span>
                <span className="block select-none text-sm leading-5 text-muted-foreground">
                  Disabled globally means no tool schemas are sent to the model.
                </span>
              </span>
              <Switch
                checked={toolsSettings.enabled}
                onClick={(event) => event.stopPropagation()}
                onCheckedChange={(checked) =>
                  onToolsSettingsChange((current) => ({
                    ...current,
                    enabled: checked,
                  }))
                }
                className="shrink-0 cursor-pointer"
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
              <div
                key={BUILTIN_ASK_USER_TOOL_ID}
                role="button"
                tabIndex={0}
                className={cn(
                  "group flex min-w-0 cursor-pointer items-start gap-2  border px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isAskUserToolSelected
                    ? "border-primary/30 bg-accent text-accent-foreground"
                    : "border-transparent hover:border-border hover:bg-muted/60",
                )}
                onClick={() => setSelectedToolName(BUILTIN_ASK_USER_TOOL_NAME)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedToolName(BUILTIN_ASK_USER_TOOL_NAME);
                  }
                }}
              >
                <MessageSquareText className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5 truncate text-base leading-6">
                    <span className="truncate">
                      {BUILTIN_ASK_USER_TOOL_NAME}
                    </span>
                    <Lock className="size-3 shrink-0 text-muted-foreground" />
                  </div>
                </div>
                <Switch
                  checked={toolsSettings.askUserEnabled}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={(checked) =>
                    onToolsSettingsChange((current) => ({
                      ...current,
                      askUserEnabled: checked,
                    }))
                  }
                  className="mt-0.5 shrink-0 cursor-pointer"
                  title={
                    toolsSettings.askUserEnabled
                      ? "Disable ask_user"
                      : "Enable ask_user"
                  }
                />
              </div>

              <div
                key={BUILTIN_CHECKLIST_WRITE_TOOL_ID}
                role="button"
                tabIndex={0}
                className={cn(
                  "group flex min-w-0 cursor-pointer items-start gap-2  border px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isChecklistWriteToolSelected
                    ? "border-primary/30 bg-accent text-accent-foreground"
                    : "border-transparent hover:border-border hover:bg-muted/60",
                )}
                onClick={() =>
                  setSelectedToolName(BUILTIN_CHECKLIST_WRITE_TOOL_NAME)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedToolName(BUILTIN_CHECKLIST_WRITE_TOOL_NAME);
                  }
                }}
              >
                <ListTodo className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5 truncate text-base leading-6">
                    <span className="truncate">
                      {BUILTIN_CHECKLIST_WRITE_TOOL_NAME}
                    </span>
                    <Lock className="size-3 shrink-0 text-muted-foreground" />
                  </div>
                </div>
                <Switch
                  checked={toolsSettings.checklistWriteEnabled}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={(checked) =>
                    onToolsSettingsChange((current) => ({
                      ...current,
                      checklistWriteEnabled: checked,
                    }))
                  }
                  className="mt-0.5 shrink-0 cursor-pointer"
                  title={
                    toolsSettings.checklistWriteEnabled
                      ? "Disable checklist_write"
                      : "Enable checklist_write"
                  }
                />
              </div>

              <div
                key={BUILTIN_LOAD_SKILL_TOOL_ID}
                role="button"
                tabIndex={0}
                className={cn(
                  "group flex min-w-0 cursor-pointer items-start gap-2  border px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isLoadSkillToolSelected
                    ? "border-primary/30 bg-accent text-accent-foreground"
                    : "border-transparent hover:border-border hover:bg-muted/60",
                )}
                onClick={() =>
                  setSelectedToolName(BUILTIN_LOAD_SKILL_TOOL_NAME)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedToolName(BUILTIN_LOAD_SKILL_TOOL_NAME);
                  }
                }}
              >
                <BookOpen className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5 truncate text-base leading-6">
                    <span className="truncate">
                      {BUILTIN_LOAD_SKILL_TOOL_NAME}
                    </span>
                    <Lock className="size-3 shrink-0 text-muted-foreground" />
                  </div>
                </div>
                <Switch
                  checked={toolsSettings.loadSkillEnabled}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={(checked) =>
                    onToolsSettingsChange((current) => ({
                      ...current,
                      loadSkillEnabled: checked,
                    }))
                  }
                  className="mt-0.5 shrink-0 cursor-pointer"
                  title={
                    toolsSettings.loadSkillEnabled
                      ? "Disable load_skill"
                      : "Enable load_skill"
                  }
                />
              </div>

              <div
                key={BUILTIN_WEB_FETCH_TOOL_ID}
                role="button"
                tabIndex={0}
                className={cn(
                  "group flex min-w-0 cursor-pointer items-start gap-2  border px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isWebFetchToolSelected
                    ? "border-primary/30 bg-accent text-accent-foreground"
                    : "border-transparent hover:border-border hover:bg-muted/60",
                )}
                onClick={() =>
                  setSelectedToolName(BUILTIN_WEB_FETCH_TOOL_NAME)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedToolName(BUILTIN_WEB_FETCH_TOOL_NAME);
                  }
                }}
              >
                <Globe className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5 truncate text-base leading-6">
                    <span className="truncate">
                      {BUILTIN_WEB_FETCH_TOOL_NAME}
                    </span>
                    <Lock className="size-3 shrink-0 text-muted-foreground" />
                  </div>
                </div>
                <Switch
                  checked={toolsSettings.webFetchEnabled}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={(checked) =>
                    onToolsSettingsChange((current) => ({
                      ...current,
                      webFetchEnabled: checked,
                    }))
                  }
                  className="mt-0.5 shrink-0 cursor-pointer"
                  title={
                    toolsSettings.webFetchEnabled
                      ? "Disable web_fetch"
                      : "Enable web_fetch"
                  }
                />
              </div>

              {loadedTools.map((tool) => (
                <div
                  key={tool.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "group flex min-w-0 cursor-pointer items-start gap-2  border px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                  </div>
                  <Switch
                    checked={tool.enabled}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={async (checked) => {
                      const updated = {
                        ...tool,
                        enabled: checked,
                      };
                      try {
                        const saved = await saveTool(updated);
                        onLoadedToolsChange((current) =>
                          current.map((item) =>
                            item.id === saved.id ? saved : item,
                          ),
                        );
                        if (toolDraft?.id === saved.id) {
                          setToolDraft(toolToDraft(saved));
                        }
                      } catch (error) {
                        showError(
                          "Failed to update tool",
                          labelForError(error),
                        );
                      }
                    }}
                    className="mt-0.5 shrink-0 cursor-pointer"
                    title={tool.enabled ? "Disable tool" : "Enable tool"}
                  />
                </div>
              ))}

              {loadedTools.length === 0 && (
                <div className=" border border-dashed px-3 py-4 text-center text-base text-muted-foreground">
                  No custom command tools configured.
                </div>
              )}
            </div>

            {toolLoadErrors.length > 0 && (
              <div className="mt-4 grid gap-2">
                <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Tool file issues
                </Label>
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
                        {BUILTIN_ASK_USER_TOOL_DESCRIPTION}
                      </p>
                    </div>

                    <div className="grid gap-2  border bg-muted/20 p-3">
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
            ) : isChecklistWriteToolSelected ? (
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
                        {BUILTIN_CHECKLIST_WRITE_TOOL_NAME}
                      </h3>
                      <p className="max-w-2xl text-base leading-6 text-muted-foreground">
                        {BUILTIN_CHECKLIST_WRITE_TOOL_DESCRIPTION}
                      </p>
                    </div>

                    <div className="grid gap-2  border bg-muted/20 p-3">
                      <Label>Behavior</Label>
                      <div className="grid gap-2 text-base leading-6 text-muted-foreground">
                        <p>
                          The assistant can call this tool during complex work
                          to show a concise progress checklist in the chat. It
                          completes immediately and does not pause generation.
                        </p>
                        <p>
                          Each call creates a checklist snapshot. It supports up
                          to 10 short items. Each item has only content and
                          done.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label>Parameters JSON schema</Label>
                      {renderJsonCodeBlock(
                        JSON.stringify(
                          BUILTIN_CHECKLIST_WRITE_TOOL_PARAMETERS,
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
                        <BookOpen className="size-5 text-muted-foreground" />
                        {BUILTIN_LOAD_SKILL_TOOL_NAME}
                      </h3>
                      <p className="max-w-2xl text-base leading-6 text-muted-foreground">
                        {BUILTIN_LOAD_SKILL_TOOL_DESCRIPTION}
                      </p>
                    </div>

                    <div className="grid gap-2  border bg-muted/20 p-3">
                      <Label>Behavior</Label>
                      <div className="grid gap-2 text-base leading-6 text-muted-foreground">
                        <p>
                          The assistant can call this tool to load a skill from
                          the current model-selectable skill list. The loaded
                          skill becomes active in the chat and its instructions
                          are included in future requests.
                        </p>
                        <p>
                          Availability is controlled by this built-in tool
                          switch, Skills settings, and the chat skill picker.
                          Custom command tool settings do not affect it.
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
                        {BUILTIN_WEB_FETCH_TOOL_DESCRIPTION}
                      </p>
                    </div>

                    <div className="grid gap-2  border bg-muted/20 p-3">
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
            !isChecklistWriteToolSelected &&
            !isLoadSkillToolSelected &&
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
              !isChecklistWriteToolSelected &&
              !isLoadSkillToolSelected && (
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
