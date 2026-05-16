import { Check, Lock, MessageSquareText, Plus, RefreshCcw, Trash2, Wrench, X } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

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
import { runQueuedTool } from "@/lib/ai-chat/tool-execution-queue";
import {
  deleteTool as deleteStoredTool,
  loadTools,
  saveTool,
} from "@/lib/ai-chat/storage";
import type {
  LoadedToolInfo,
  ToolCommandResult,
  ToolExecutionPreview,
  ToolsSettings,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const TOOL_TEST_STATES_STORAGE_KEY = "chat-forge-tool-test-states";
const TOOL_TEST_STATE_SAVE_DELAY_MS = 350;
const BUILTIN_ASK_USER_TOOL_NAME = "ask_user";
const BUILTIN_ASK_USER_TOOL_ID = "builtin-ask-user";
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
          input: {
            type: "object",
            properties: {
              multiline: { type: "boolean" },
            },
          },
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
                  description: "Strongly recommended one-sentence explanation shown below the label.",
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
      tool.maxConcurrentRuns === undefined ? "" : String(tool.maxConcurrentRuns),
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
            typeof candidate.argsText === "string"
              ? candidate.argsText
              : "{}";
          const result = isToolCommandResult(candidate.result)
            ? candidate.result
            : null;

          return [toolId, { argsText, result } satisfies ToolTestState] as const;
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
        (entry): entry is readonly [
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
  className = "chat-markdown-compact",
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
  className = "chat-markdown-compact",
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
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
          Command
        </div>
        {renderCommandCodeBlock(execution.displayCommand)}
      </div>
      {execution.cwd?.trim() && (
        <div className="grid gap-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
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
  if (!args || typeof args !== "object" || Array.isArray(args) || !(key in args)) {
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

function buildToolExecutionPreviewForDraft(
  draft: ToolDraft,
  argsText: string,
) {
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
  if (tool.name === BUILTIN_ASK_USER_TOOL_NAME) {
    throw new Error("ask_user is a built-in tool name and cannot be used by a custom command tool.");
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
  const selectedTool = useMemo(
    () => loadedTools.find((tool) => tool.name === selectedToolName) ?? null,
    [loadedTools, selectedToolName],
  );
  const totalToolsCount = loadedTools.length + 1;
  const enabledToolsCount = useMemo(
    () =>
      loadedTools.filter((tool) => tool.enabled).length +
      (toolsSettings.askUserEnabled ? 1 : 0),
    [loadedTools, toolsSettings.askUserEnabled],
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

    if (selectedToolName === BUILTIN_ASK_USER_TOOL_NAME) return;

    if (
      !selectedToolName ||
      !loadedTools.some((tool) => tool.name === selectedToolName)
    ) {
      setSelectedToolName(BUILTIN_ASK_USER_TOOL_NAME);
    }
  }, [loadedTools, selectedToolName, toolDraft]);

  useEffect(() => {
    if (selectedToolName === BUILTIN_ASK_USER_TOOL_NAME) {
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

  async function refreshTools(showToast = false) {
    setIsLoadingTools(true);

    try {
      const tools = await loadTools();
      onLoadedToolsChange(tools);
      setToolLoadErrors([]);
      if (showToast) {
        showSuccess(
          `Loaded ${tools.length} tool${tools.length === 1 ? "" : "s"}.`,
        );
      }
    } catch (error) {
      console.error("Failed to load tools:", error);
      setToolLoadErrors([
        { source: "Tools storage", message: labelForError(error) },
      ]);
      showError("Failed to load tools", labelForError(error));
    } finally {
      setIsLoadingTools(false);
    }
  }

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
      <DialogContent className="flex h-[min(820px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
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
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Tools
              </Label>
              <span className="text-xs text-muted-foreground">
                {enabledToolsCount}/{totalToolsCount} enabled
              </span>
            </div>

            <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">Enable tools globally</span>
                <span className="block text-xs leading-5 text-muted-foreground">
                  Disabled globally means no tool schemas are sent to the model.
                </span>
              </span>
              <input
                type="checkbox"
                checked={toolsSettings.enabled}
                onChange={(event) =>
                  onToolsSettingsChange((current) => ({
                    ...current,
                    enabled: event.target.checked,
                  }))
                }
                className="size-4 shrink-0 accent-primary"
              />
            </label>

            <div className="mb-3 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="flex-1 rounded-lg"
                onClick={() => {
                  const draft = createBlankToolDraft();
                  setSelectedToolName(null);
                  setToolDraft(draft);
                }}
              >
                <Plus className="size-4" />
                Add tool
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-lg"
                onClick={() => refreshTools(true)}
                disabled={isLoadingTools}
                title="Reload tools from app storage"
              >
                <RefreshCcw
                  className={cn("size-4", isLoadingTools && "animate-spin")}
                />
              </Button>
            </div>

            <div className="grid gap-1.5">
              <div
                key={BUILTIN_ASK_USER_TOOL_ID}
                role="button"
                tabIndex={0}
                className={cn(
                  "group flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5 truncate text-sm leading-5">
                    <span className="truncate">{BUILTIN_ASK_USER_TOOL_NAME}</span>
                    <Lock className="size-3 shrink-0 text-muted-foreground" />
                  </div>
                  <div className="truncate text-[11px] leading-4 text-muted-foreground">
                    {toolsSettings.askUserEnabled
                      ? toolsSettings.enabled
                        ? "Enabled · Built-in interactive"
                        : "Enabled · Global tools off"
                      : "Disabled · Built-in interactive"}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={toolsSettings.askUserEnabled}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    onToolsSettingsChange((current) => ({
                      ...current,
                      askUserEnabled: event.target.checked,
                    }))
                  }
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  title={
                    toolsSettings.askUserEnabled
                      ? "Disable ask_user"
                      : "Enable ask_user"
                  }
                />
              </div>

              {loadedTools.map((tool) => (
                <div
                  key={tool.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "group flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                  <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm leading-5">{tool.name}</div>
                    <div className="truncate text-[11px] leading-4 text-muted-foreground">
                      {tool.enabled ? "Enabled" : "Disabled"} · {tool.command}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={tool.enabled}
                    onClick={(event) => event.stopPropagation()}
                    onChange={async (event) => {
                      const updated = {
                        ...tool,
                        enabled: event.target.checked,
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
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    title={tool.enabled ? "Disable tool" : "Enable tool"}
                  />
                </div>
              ))}

              {loadedTools.length === 0 && (
                <div className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  No custom command tools configured.
                </div>
              )}
            </div>

            {toolLoadErrors.length > 0 && (
              <div className="mt-4 grid gap-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Load errors
                </Label>
                {toolLoadErrors.map((error) => (
                  <div
                    key={`${error.source}:${error.message}`}
                    className="rounded-lg border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs leading-5"
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

          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
            {isAskUserToolSelected ? (
              <div className="grid gap-5 pb-1">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Built-in tool
                    </Label>
                    <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-foreground">
                      <MessageSquareText className="size-5 text-muted-foreground" />
                      {BUILTIN_ASK_USER_TOOL_NAME}
                    </h3>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                      {BUILTIN_ASK_USER_TOOL_DESCRIPTION}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                    <Lock className="size-3.5" />
                    Locked
                  </span>
                </div>

                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium">Enable ask_user</span>
                    <span className="block text-xs leading-5 text-muted-foreground">
                      When enabled globally, this sends the built-in interactive
                      question tool schema to the model.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={toolsSettings.askUserEnabled}
                    onChange={(event) =>
                      onToolsSettingsChange((current) => ({
                        ...current,
                        askUserEnabled: event.target.checked,
                      }))
                    }
                    className="size-4 shrink-0 accent-primary"
                  />
                </label>

                {!toolsSettings.enabled && toolsSettings.askUserEnabled && (
                  <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    Global tools are disabled, so ask_user is currently not sent
                    to the model even though this built-in tool is enabled.
                  </div>
                )}

                <div className="grid gap-2 rounded-lg border bg-muted/20 p-3">
                  <Label>Behavior</Label>
                  <div className="grid gap-2 text-sm leading-6 text-muted-foreground">
                    <p>
                      The assistant can call this tool when it needs a decision
                      before continuing. The response pauses, shows one compact
                      form, and resumes after you submit the answers.
                    </p>
                    <p>
                      It supports up to 5 questions per form. Questions can be
                      single-choice, multi-select, or text-only. Choice questions
                      support up to 8 model-provided options, and each option
                      should include a short label plus a gray helper description when useful.
                      Chat Forge always adds a custom “Type your answer” option to choice questions.
                    </p>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Parameters JSON schema</Label>
                  <div className="rounded-lg border bg-card p-3">
                    {renderJsonCodeBlock(
                      JSON.stringify(BUILTIN_ASK_USER_TOOL_PARAMETERS, null, 2),
                    )}
                  </div>
                </div>
              </div>
            ) : toolDraft ? (
              <div className="grid gap-5 pb-1">
                <div>
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {selectedTool ? "Edit tool" : "Create tool"}
                  </Label>
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
                    className="min-h-20 resize-y"
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
                  <Label htmlFor="tool-schema">Parameters JSON schema</Label>
                  <Textarea
                    id="tool-schema"
                    value={toolDraft.parametersText}
                    onChange={(event) =>
                      updateToolDraft({ parametersText: event.target.value })
                    }
                    className="min-h-64 resize-y font-mono text-xs"
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
                    className="min-h-32 resize-y font-mono text-xs"
                    spellCheck={false}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Use <code>{"{{fieldName}}"}</code> placeholders for existing
                    CLIs. Every placeholder must exist in schema.properties and
                    schema.required.
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
                      <SelectTrigger id="tool-input-mode" className="rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="json-stdin">JSON stdin</SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs leading-5 text-muted-foreground">
                      JSON stdin is best for scripts you write. None is best for
                      existing CLI flags/placeholders.
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

                <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
                  <div>
                    <Label>Execution limits</Label>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Leave concurrency empty for the current parallel behavior.
                      Use 1 plus a delay for rate-limited tools.
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
                      <p className="text-xs leading-5 text-muted-foreground">
                        Run this manifest locally with sample model arguments.
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-lg"
                        onClick={clearCurrentToolTest}
                        disabled={!currentToolTestState || isTestingCurrentTool}
                      >
                        Clear test
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-lg"
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
                    className="min-h-24 resize-y font-mono text-xs"
                    spellCheck={false}
                    placeholder='{ "value": 144 }'
                  />
                  {(currentToolTestResult || currentToolTestExecutionPreview) && (
                    <div className="grid gap-3 rounded-lg border bg-card p-3">
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        {currentToolTestResult ? (
                          <span>
                            Exit: {currentToolTestResult.exitCode ?? "null"} ·{" "}
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
                      {renderToolExecutionPreview(currentToolTestExecutionPreview)}
                      {currentToolTestResult && (
                        <div className="grid gap-1.5">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                            Output
                          </div>
                          {renderJsonCodeBlock(currentToolTestResult.content)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Select a tool or add a new one.
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 items-center justify-between border-t px-5 py-3">
          <div className="flex gap-2">
            {toolDraft && (
              <Button
                type="button"
                variant="destructive"
                className="rounded-lg"
                onClick={deleteCurrentTool}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            {!isAskUserToolSelected && (
              <Button
                type="button"
                className="rounded-lg"
                onClick={saveCurrentToolDraft}
                disabled={!toolDraft || isSavingTool}
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
