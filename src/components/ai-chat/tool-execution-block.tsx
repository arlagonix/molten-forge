import {
  Check,
  Download,
  FileArchive,
  FileText,
  Maximize2,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { MarkdownMessage } from "@/components/ai-chat/markdown-message";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  ASK_USER_TOOL,
  BASH_TOOL,
  BASH_TOOL_NAME,
  CALL_AGENT_TOOL_NAME,
  EDIT_TOOL,
  EDIT_TOOL_NAME,
  LOAD_SKILL_TOOL_NAME,
  READ_TOOL,
  READ_TOOL_NAME,
  TASK_TOOLS,
  WEB_FETCH_TOOL,
  WEB_FETCH_TOOL_NAME,
  WRITE_TOOL,
  WRITE_TOOL_NAME,
  isTaskToolName,
} from "@/lib/ai-chat/builtin-tools";
import {
  ARCHIVE_CREATE_TOOL_NAME,
  ARCHIVE_EXTRACT_TOOL_NAME,
  CHAT_FILE_CREATE_TOOL_NAME,
  DOCUMENT_CONVERT_TOOL_NAME,
  FILE_CREATE_TOOL_NAME,
  FILE_DELETE_TOOL_NAME,
  FILE_FIND_TOOL_NAME,
  FILE_READ_TOOL_NAME,
  FILE_REPLACE_TEXT_TOOL_NAME,
  FILE_SEARCH_TEXT_TOOL_NAME,
} from "@/lib/ai-chat/file-tool-names";
import { TERMINAL_EXEC_TOOL_NAME } from "@/lib/ai-chat/terminal-tool";
import { buildToolExecutionPreviewForCall } from "@/lib/ai-chat/tool-preview";
import type {
  ChatToolCall,
  ChatToolResult,
  FileToolChangePreview,
  LoadedToolInfo,
  ToolExecutionPreview,
  ToolExecutionStatus,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const TOOL_INFO_CODE_BLOCK_CLASS_NAME =
  "chat-markdown-compact chat-tool-info-codeblock";

const BUILTIN_TOOL_DESCRIPTIONS: Record<string, string> = {
  [ASK_USER_TOOL.name]: ASK_USER_TOOL.description,
  ...Object.fromEntries(
    TASK_TOOLS.map((tool) => [tool.name, tool.description]),
  ),
  [WEB_FETCH_TOOL.name]: WEB_FETCH_TOOL.description,
  [READ_TOOL.name]: READ_TOOL.description,
  [BASH_TOOL.name]: BASH_TOOL.description,
  [EDIT_TOOL.name]: EDIT_TOOL.description,
  [WRITE_TOOL.name]: WRITE_TOOL.description,
  [LOAD_SKILL_TOOL_NAME]:
    "Load the full instructions for one relevant skill by name.",
  [CALL_AGENT_TOOL_NAME]:
    "Delegate a focused subtask to one configured agent and return the result to the current chat.",
};

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

function getChangePreviewTitle(preview: FileToolChangePreview) {
  if (preview.title?.trim()) return preview.title.trim();
  if (preview.kind === "create") return "Created file";
  if (preview.kind === "delete") return "Deleted file";
  return "Edited file";
}

function renderFileChangePreview(preview?: FileToolChangePreview) {
  if (!preview || preview.rows.length === 0) return null;

  return (
    <div className="grid gap-1.5">
      <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
        Changes
      </div>
      <div className="overflow-hidden border bg-muted/20 font-mono text-xs leading-5">
        <div className="border-b bg-muted/40 px-3 py-2 font-sans text-xs text-muted-foreground">
          {getChangePreviewTitle(preview)} · {preview.path}
          {preview.truncated ? " · Preview truncated" : ""}
        </div>
        <div className="max-h-[min(24rem,50dvh)] overflow-auto">
          {preview.rows.map((row, index) => (
            <div
              key={`${row.type}-${index}`}
              className={cn(
                "grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 px-3 py-0.5",
                row.type === "add" &&
                  "bg-green-500/10 text-green-800 dark:text-green-300",
                row.type === "delete" &&
                  "bg-red-500/10 text-red-800 dark:text-red-300",
                row.type === "context" && "text-muted-foreground",
              )}
            >
              <span className="select-none text-right opacity-70">
                {row.type === "add" ? "+" : row.type === "delete" ? "-" : " "}
              </span>
              <span className="whitespace-pre-wrap break-words">
                {row.text || " "}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function renderToolExecutionPreview(execution?: ToolExecutionPreview) {
  if (!execution) return null;

  return (
    <>
      {execution.displayCommand && (
        <div className="grid gap-1.5">
          <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
            Command
          </div>
          {renderCommandCodeBlock(execution.displayCommand)}
        </div>
      )}
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

function stripAnsi(value: string) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function renderTerminalTextBlock(value: string) {
  const text = stripAnsi(value);
  if (!text.trim()) return null;

  return (
    <pre className="max-h-[min(50rem,50dvh)] overflow-auto border bg-background/80 px-3 py-2 font-mono text-xs leading-5 text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
      {text}
    </pre>
  );
}

function renderTerminalOutput(toolResult?: ChatToolResult) {
  const terminal = toolResult?.terminal;
  if (!terminal) return null;

  return (
    <div className="grid gap-2">
      {terminal.warnings?.length ? (
        <div className="grid gap-1 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {terminal.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}
      {terminal.stdout.trim() ? (
        <div className="grid gap-1.5">
          <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
            Stdout
          </div>
          {renderTerminalTextBlock(terminal.stdout)}
        </div>
      ) : null}
      {terminal.stderr.trim() ? (
        <div className="grid gap-1.5">
          <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
            Stderr
          </div>
          {renderTerminalTextBlock(terminal.stderr)}
        </div>
      ) : null}
      <div className="grid gap-1.5 text-xs text-muted-foreground">
        <div>
          Exit code: {terminal.exitCode === null ? "—" : terminal.exitCode} ·
          Duration:{" "}
          {terminal.durationMs
            ? `${(terminal.durationMs / 1000).toFixed(1)}s`
            : "—"}
          {terminal.timedOut ? " · Timed out" : ""}
          {terminal.cancelled ? " · Cancelled" : ""}
          {terminal.outputTruncated ? " · Output truncated" : ""}
        </div>
        {terminal.cwd ? (
          <div className="truncate">CWD: {terminal.cwd}</div>
        ) : null}
      </div>
    </div>
  );
}

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

type GeneratedFileArtifact = NonNullable<
  ChatToolResult["generatedFiles"]
>[number];

function getGeneratedFileIcon(fileName: string) {
  const lowerName = fileName.toLowerCase();
  return lowerName.endsWith(".zip") ||
    lowerName.endsWith(".7z") ||
    lowerName.endsWith(".rar") ||
    lowerName.endsWith(".tar") ||
    lowerName.endsWith(".gz")
    ? FileArchive
    : FileText;
}

function GeneratedFileChip({
  file,
  onDownload,
}: {
  file: GeneratedFileArtifact;
  onDownload: (file: GeneratedFileArtifact) => void;
}) {
  const Icon = getGeneratedFileIcon(file.name);

  return (
    <div
      className="flex min-h-12 min-w-0 max-w-[15rem] items-center gap-2 border bg-muted/25 px-2 py-1.5 text-xs"
      title={file.name}
    >
      <span className="flex size-8 shrink-0 items-center justify-center">
        <Icon className="size-5 text-muted-foreground" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5 text-left">
        <span className="truncate font-medium">{file.name}</span>
        <span className="truncate text-muted-foreground">
          {formatFileSize(file.sizeBytes)}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="ml-auto h-7 w-7 shrink-0 bg-muted/40 hover:bg-muted"
        onClick={(event) => {
          event.stopPropagation();
          onDownload(file);
        }}
        title={`Download ${file.name}`}
      >
        <Download className="size-3.5" />
      </Button>
    </div>
  );
}

function getLoadSkillName(toolCall: ChatToolCall, toolResult?: ChatToolResult) {
  if (toolCall.function.name !== LOAD_SKILL_TOOL_NAME) return "";
  if (toolResult?.loadedSkillName) return toolResult.loadedSkillName;

  try {
    const parsedResult = toolResult?.content
      ? (JSON.parse(toolResult.content) as {
          name?: unknown;
          skillName?: unknown;
        })
      : undefined;
    if (typeof parsedResult?.name === "string" && parsedResult.name.trim()) {
      return parsedResult.name.trim();
    }
    if (
      typeof parsedResult?.skillName === "string" &&
      parsedResult.skillName.trim()
    ) {
      return parsedResult.skillName.trim();
    }
  } catch {
    // Fall back to the call arguments below.
  }

  try {
    const parsedArgs = JSON.parse(toolCall.function.arguments || "{}") as {
      name?: unknown;
      skillName?: unknown;
    };
    if (typeof parsedArgs.name === "string") return parsedArgs.name.trim();
    return typeof parsedArgs.skillName === "string"
      ? parsedArgs.skillName.trim()
      : "";
  } catch {
    return "";
  }
}

function getLoadSkillDetails(toolResult?: ChatToolResult) {
  if (!toolResult || toolResult.toolName !== LOAD_SKILL_TOOL_NAME) {
    return {
      instructions: "",
      recommendedToolNames: [] as string[],
      compactOutput: toolResult?.content ?? "",
      location: "",
      directoryPath: "",
    };
  }

  let parsedStatus: unknown;
  let parsedSkillName: unknown;
  let parsedName: unknown;
  let parsedLocation: unknown;
  let parsedDirectoryPath: unknown;
  let parsedInstructions: unknown;
  let parsedRecommendedToolNames: unknown;

  try {
    const parsed = JSON.parse(toolResult.content || "{}") as Record<
      string,
      unknown
    >;
    parsedStatus = parsed.status;
    parsedSkillName = parsed.skillName;
    parsedName = parsed.name;
    parsedLocation = parsed.location;
    parsedDirectoryPath = parsed.directoryPath;
    parsedInstructions = parsed.instructions;
    parsedRecommendedToolNames = parsed.recommendedToolNames;
  } catch {
    // Fall back to the typed fields below.
  }

  const instructions =
    toolResult.loadedSkillInstructions ??
    (typeof parsedInstructions === "string" ? parsedInstructions : "");
  const recommendedToolNames =
    toolResult.loadedSkillRecommendedToolNames ??
    (Array.isArray(parsedRecommendedToolNames)
      ? parsedRecommendedToolNames.filter(
          (toolName): toolName is string => typeof toolName === "string",
        )
      : []);
  const compactOutput = JSON.stringify(
    Object.fromEntries(
      Object.entries({
        ok: !toolResult.isError,
        status: typeof parsedStatus === "string" ? parsedStatus : undefined,
        name:
          typeof parsedName === "string"
            ? parsedName
            : typeof parsedSkillName === "string"
              ? parsedSkillName
              : toolResult.loadedSkillName,
        location:
          typeof parsedLocation === "string" ? parsedLocation : undefined,
        directoryPath:
          typeof parsedDirectoryPath === "string"
            ? parsedDirectoryPath
            : undefined,
      }).filter(([, value]) => value !== undefined),
    ),
    null,
    2,
  );

  const location = typeof parsedLocation === "string" ? parsedLocation : "";
  const directoryPath =
    typeof parsedDirectoryPath === "string" ? parsedDirectoryPath : "";

  return {
    instructions,
    recommendedToolNames,
    compactOutput,
    location,
    directoryPath,
  };
}

function normalizeToolDescription(description?: string) {
  return description?.replace(/\s+/g, " ").trim() || "";
}

function getToolDescription(toolName: string, loadedTools: LoadedToolInfo[]) {
  const customDescription = loadedTools.find(
    (candidate) => candidate.name === toolName,
  )?.description;

  return normalizeToolDescription(
    customDescription || BUILTIN_TOOL_DESCRIPTIONS[toolName],
  );
}

function getEffectiveToolStatus(
  status: ToolExecutionStatus | undefined,
  result?: ChatToolResult,
): ToolExecutionStatus {
  if (status === "running" || status === "pending") return status;
  if (result?.isError || status === "failed") return "failed";
  if (result || status === "complete") return "complete";
  return "running";
}

function renderToolStatus(status: ToolExecutionStatus) {
  if (status === "failed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-red-600 dark:text-red-400">
        <X className="size-3.5" />
        Failed
      </span>
    );
  }

  if (status === "complete") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-green-600 dark:text-green-400">
        <Check className="size-3.5" />
        Complete
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-amber-600 dark:text-amber-400">
      <Spinner className="size-3.5" />
      {status === "pending" ? "Waiting" : "Running"}
    </span>
  );
}

function hasMeaningfulToolInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed == null) return false;
    if (typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed).length > 0;
    }
    if (Array.isArray(parsed)) return parsed.length > 0;
    return true;
  } catch {
    return Boolean(trimmed);
  }
}

function parseToolCallArguments(toolCall: ChatToolCall) {
  try {
    const parsed = JSON.parse(toolCall.function.arguments || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function getStringArgument(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function getToolHeaderDetail(toolCall: ChatToolCall) {
  const args = parseToolCallArguments(toolCall);

  if (
    toolCall.function.name === READ_TOOL_NAME ||
    toolCall.function.name === EDIT_TOOL_NAME ||
    toolCall.function.name === WRITE_TOOL_NAME ||
    toolCall.function.name === FILE_READ_TOOL_NAME
  ) {
    return getStringArgument(args, "path");
  }

  if (toolCall.function.name === BASH_TOOL_NAME) {
    const command = getStringArgument(args, "command");
    return command.length > 120 ? `${command.slice(0, 117)}...` : command;
  }

  if (toolCall.function.name === FILE_FIND_TOOL_NAME) {
    const query = getStringArgument(args, "query");
    return query ? `query: ${query}` : "all workspace files";
  }

  if (toolCall.function.name === FILE_SEARCH_TEXT_TOOL_NAME) {
    const query = getStringArgument(args, "query");
    return query ? `query: ${query}` : "";
  }

  if (
    toolCall.function.name === FILE_CREATE_TOOL_NAME ||
    toolCall.function.name === FILE_REPLACE_TEXT_TOOL_NAME ||
    toolCall.function.name === FILE_DELETE_TOOL_NAME ||
    toolCall.function.name === ARCHIVE_EXTRACT_TOOL_NAME ||
    toolCall.function.name === DOCUMENT_CONVERT_TOOL_NAME
  ) {
    return getStringArgument(args, "path");
  }

  if (toolCall.function.name === ARCHIVE_CREATE_TOOL_NAME) {
    const paths = args.paths;
    return Array.isArray(paths) ? `${paths.length} paths` : "";
  }

  if (toolCall.function.name === CHAT_FILE_CREATE_TOOL_NAME) {
    return getStringArgument(args, "filename");
  }

  if (toolCall.function.name === WEB_FETCH_TOOL_NAME) {
    return getStringArgument(args, "url");
  }

  if (toolCall.function.name === TERMINAL_EXEC_TOOL_NAME) {
    const command = getStringArgument(args, "command");
    return command.length > 80 ? `${command.slice(0, 77)}...` : command;
  }

  return "";
}

export function ToolExecutionBlock({
  id,
  toolCall,
  toolResult,
  status,
  loadedTools,
}: {
  id: string;
  toolCall: ChatToolCall;
  toolResult?: ChatToolResult;
  status?: ToolExecutionStatus;
  loadedTools: LoadedToolInfo[];
  isCollapsed: boolean;
  onToggleCollapsed: (stepId: string, nextCollapsed: boolean) => void;
}) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const effectiveStatus = getEffectiveToolStatus(status, toolResult);
  const executionPreview = buildToolExecutionPreviewForCall(
    toolCall,
    loadedTools,
    toolResult,
  );
  const loadedSkillName = getLoadSkillName(toolCall, toolResult);
  const loadSkillDetails = getLoadSkillDetails(toolResult);
  const isLoadSkillTool = toolCall.function.name === LOAD_SKILL_TOOL_NAME;
  const isTaskTool = isTaskToolName(toolCall.function.name);
  const isTerminalTool =
    toolCall.function.name === TERMINAL_EXEC_TOOL_NAME ||
    toolCall.function.name === BASH_TOOL_NAME;
  const ToolIcon = isTerminalTool ? Terminal : Wrench;
  const toolDescription = getToolDescription(
    toolCall.function.name,
    loadedTools,
  );
  const showToolInput =
    hasMeaningfulToolInput(toolCall.function.arguments || "") &&
    (isTaskTool || !executionPreview || executionPreview.usesStdin);
  const toolHeaderDetail = isLoadSkillTool
    ? [loadedSkillName, loadSkillDetails.location].filter(Boolean).join(" · ")
    : getToolHeaderDetail(toolCall);
  const generatedFiles = toolResult?.generatedFiles ?? [];

  async function handleDownloadGeneratedFile(
    file: NonNullable<ChatToolResult["generatedFiles"]>[number],
  ) {
    const storagePath = file.storagePath ?? file.workspacePath;
    if (!storagePath) {
      toast.error("Generated file is not available for download.");
      return;
    }

    try {
      const result = await window.moltenForgeAI?.exportAttachment?.({
        storagePath,
        name: file.name,
      });

      if (!result || result.cancelled) return;
      toast.success("File downloaded", { description: result.path });
    } catch (error) {
      toast.error("Failed to download file", {
        description:
          error instanceof Error ? error.message : "Unknown download error.",
      });
    }
  }

  return (
    <>
      <article key={id} className="flex min-w-0 max-w-full justify-start">
        <div
          role="button"
          tabIndex={0}
          className="w-full min-w-0 max-w-full cursor-pointer overflow-hidden border bg-muted/25 px-4 py-3 text-sm leading-none text-muted-foreground [overflow-wrap:anywhere] hover:bg-muted/35 focus:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => setIsDetailsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setIsDetailsOpen(true);
            }
          }}
          title="Open tool call details"
        >
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <ToolIcon className="size-3.5 shrink-0" />
              <span className="shrink-0 truncate">
                {toolCall.function.name}
              </span>
              <span className="shrink-0 text-muted-foreground/60">•</span>
              {renderToolStatus(effectiveStatus)}
              {toolHeaderDetail ? (
                <>
                  <span className="shrink-0 text-muted-foreground/60">•</span>
                  <span className="min-w-0 truncate normal-case tracking-normal text-muted-foreground/85">
                    {toolHeaderDetail}
                  </span>
                </>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-4 w-4 shrink-0"
              onClick={(event) => {
                event.stopPropagation();
                setIsDetailsOpen(true);
              }}
              title="Open tool call details"
              aria-label="Open tool call details"
            >
              <Maximize2 className="size-3.5" />
            </Button>
          </div>
          {generatedFiles.length > 0 ? (
            <div
              className="mt-3 flex flex-wrap gap-2 border-t pt-3 normal-case tracking-normal"
              onClick={(event) => event.stopPropagation()}
            >
              {generatedFiles.map((file) => (
                <GeneratedFileChip
                  key={file.id}
                  file={file}
                  onDownload={(downloadFile) => {
                    void handleDownloadGeneratedFile(downloadFile);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </article>

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent
          className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none max-w-[min(96vw,56rem)] flex-col overflow-hidden p-0 text-base leading-6"
          overlayStyle={{ zIndex: 200 }}
          style={{ zIndex: 201 }}
        >
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle className="flex min-w-0 items-center gap-2 pr-8 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              <ToolIcon className="size-4 shrink-0" />
              <span className="min-w-0 truncate shrink-0">
                {toolCall.function.name}
              </span>
              <span className="text-muted-foreground/60">·</span>
              {renderToolStatus(effectiveStatus)}
              {toolHeaderDetail ? (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="min-w-0 truncate normal-case tracking-normal text-muted-foreground/85">
                    {toolHeaderDetail}
                  </span>
                </>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-3 text-sm leading-5 text-muted-foreground">
              {toolDescription ? (
                <div className="grid gap-1.5">
                  <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                    Description
                  </div>
                  <div>{toolDescription}</div>
                </div>
              ) : null}
              {!isTaskTool && renderToolExecutionPreview(executionPreview)}
              {showToolInput && (
                <div className="grid gap-1.5">
                  <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                    Input
                  </div>
                  {renderJsonCodeBlock(toolCall.function.arguments || "{}")}
                </div>
              )}
              {generatedFiles.length > 0 ? (
                <div className="grid gap-1.5">
                  <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                    Generated files
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {generatedFiles.map((file) => (
                      <GeneratedFileChip
                        key={file.id}
                        file={file}
                        onDownload={(downloadFile) => {
                          void handleDownloadGeneratedFile(downloadFile);
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {isTerminalTool && toolResult?.terminal ? (
                <div className="grid gap-1.5">
                  <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                    Output
                  </div>
                  {renderTerminalOutput(toolResult)}
                </div>
              ) : null}
              {toolResult?.content.trim() &&
                (!isTerminalTool || !toolResult.terminal) && (
                  <div className="grid gap-1.5">
                    <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                      Output
                    </div>
                    {renderJsonCodeBlock(
                      isLoadSkillTool
                        ? loadSkillDetails.compactOutput
                        : toolResult.content,
                    )}
                  </div>
                )}
              {renderFileChangePreview(toolResult?.changePreview)}
              {isLoadSkillTool && loadSkillDetails.instructions.trim() && (
                <div className="grid gap-1.5">
                  <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                    Instructions
                  </div>
                  {renderCodeBlock(loadSkillDetails.instructions, "markdown")}
                </div>
              )}
              {isLoadSkillTool &&
                loadSkillDetails.recommendedToolNames.length > 0 && (
                  <div className="grid gap-1.5">
                    <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                      Recommended tools
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {loadSkillDetails.recommendedToolNames.map((toolName) => (
                        <code
                          key={toolName}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
                        >
                          {toolName}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
