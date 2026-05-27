import { Check, ChevronDown, ChevronRight, Wrench, X } from "lucide-react";

import { MarkdownMessage } from "@/components/ai-chat/markdown-message";
import { Spinner } from "@/components/ui/spinner";
import {
  ASK_USER_TOOL,
  CALL_AGENT_TOOL_NAME,
  CHECKLIST_WRITE_TOOL,
  FILE_CREATE_TOOL,
  FILE_CREATE_TOOL_NAME,
  FILE_DELETE_TOOL,
  FILE_DELETE_TOOL_NAME,
  FILE_FIND_TOOL,
  FILE_FIND_TOOL_NAME,
  FILE_READ_TOOL,
  FILE_READ_TOOL_NAME,
  FILE_REPLACE_TEXT_TOOL,
  FILE_REPLACE_TEXT_TOOL_NAME,
  FILE_SEARCH_TEXT_TOOL,
  FILE_SEARCH_TEXT_TOOL_NAME,
  LOAD_SKILL_TOOL_NAME,
  WEB_FETCH_TOOL,
  WEB_FETCH_TOOL_NAME,
} from "@/lib/ai-chat/builtin-tools";
import { buildToolExecutionPreviewForCall } from "@/lib/ai-chat/tool-preview";
import type {
  ChatToolCall,
  ChatToolResult,
  LoadedToolInfo,
  ToolExecutionPreview,
  ToolExecutionStatus,
} from "@/lib/ai-chat/types";

const TOOL_INFO_CODE_BLOCK_CLASS_NAME =
  "chat-markdown-compact chat-tool-info-codeblock";

const BUILTIN_TOOL_DESCRIPTIONS: Record<string, string> = {
  [ASK_USER_TOOL.name]: ASK_USER_TOOL.description,
  [CHECKLIST_WRITE_TOOL.name]: CHECKLIST_WRITE_TOOL.description,
  [WEB_FETCH_TOOL.name]: WEB_FETCH_TOOL.description,
  [FILE_READ_TOOL.name]: FILE_READ_TOOL.description,
  [FILE_FIND_TOOL.name]: FILE_FIND_TOOL.description,
  [FILE_SEARCH_TEXT_TOOL.name]: FILE_SEARCH_TEXT_TOOL.description,
  [FILE_REPLACE_TEXT_TOOL.name]: FILE_REPLACE_TEXT_TOOL.description,
  [FILE_CREATE_TOOL.name]: FILE_CREATE_TOOL.description,
  [FILE_DELETE_TOOL.name]: FILE_DELETE_TOOL.description,
  [LOAD_SKILL_TOOL_NAME]:
    "Load the full instructions for one relevant skill and activate it for this chat.",
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
      content={`~~~${language}
${value}
~~~`}
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

function getLoadSkillName(toolCall: ChatToolCall, toolResult?: ChatToolResult) {
  if (toolCall.function.name !== LOAD_SKILL_TOOL_NAME) return "";
  if (toolResult?.loadedSkillName) return toolResult.loadedSkillName;

  try {
    const parsedResult = toolResult?.content
      ? (JSON.parse(toolResult.content) as { skillName?: unknown })
      : undefined;
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
      skillName?: unknown;
    };
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
    };
  }

  let parsedStatus: unknown;
  let parsedSkillName: unknown;
  let parsedInstructions: unknown;
  let parsedRecommendedToolNames: unknown;

  try {
    const parsed = JSON.parse(toolResult.content || "{}") as Record<
      string,
      unknown
    >;
    parsedStatus = parsed.status;
    parsedSkillName = parsed.skillName;
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
        skillName:
          typeof parsedSkillName === "string"
            ? parsedSkillName
            : toolResult.loadedSkillName,
      }).filter(([, value]) => value !== undefined),
    ),
    null,
    2,
  );

  return { instructions, recommendedToolNames, compactOutput };
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
  if (result?.isError) return "failed";
  if (result) return "complete";
  return status ?? "running";
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

  if (toolCall.function.name === FILE_READ_TOOL_NAME) {
    return getStringArgument(args, "path");
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
    toolCall.function.name === FILE_DELETE_TOOL_NAME
  ) {
    return getStringArgument(args, "path");
  }

  if (toolCall.function.name === WEB_FETCH_TOOL_NAME) {
    return getStringArgument(args, "url");
  }

  return "";
}

export function ToolExecutionBlock({
  id,
  toolCall,
  toolResult,
  status,
  loadedTools,
  isCollapsed,
  onToggleCollapsed,
}: {
  id: string;
  toolCall: ChatToolCall;
  toolResult?: ChatToolResult;
  status?: ToolExecutionStatus;
  loadedTools: LoadedToolInfo[];
  isCollapsed: boolean;
  onToggleCollapsed: (stepId: string, nextCollapsed: boolean) => void;
}) {
  const effectiveStatus = getEffectiveToolStatus(status, toolResult);
  const executionPreview = buildToolExecutionPreviewForCall(
    toolCall,
    loadedTools,
    toolResult,
  );
  const loadedSkillName = getLoadSkillName(toolCall, toolResult);
  const loadSkillDetails = getLoadSkillDetails(toolResult);
  const isLoadSkillTool = toolCall.function.name === LOAD_SKILL_TOOL_NAME;
  const toolDescription = getToolDescription(
    toolCall.function.name,
    loadedTools,
  );
  const showToolInput =
    hasMeaningfulToolInput(toolCall.function.arguments || "") &&
    (!executionPreview || executionPreview.usesStdin);
  const toolHeaderDetail = isLoadSkillTool
    ? loadedSkillName
    : getToolHeaderDetail(toolCall);

  return (
    <article key={id} className="flex min-w-0 max-w-full justify-start">
      <div className="w-full min-w-0 max-w-full overflow-hidden  border bg-muted/25 px-4 py-3 text-sm leading-5 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
        <button
          type="button"
          className="w-full  text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onToggleCollapsed(id, !isCollapsed)}
          aria-expanded={!isCollapsed}
        >
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <Wrench className="size-3.5 shrink-0" />
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
            {isCollapsed ? (
              <ChevronRight className="size-3.5 shrink-0" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0" />
            )}
          </div>
        </button>

        {!isCollapsed && (
          <div className="mt-3 grid gap-3">
            {toolDescription ? (
              <div className="text-sm leading-5 text-muted-foreground/85">
                {toolDescription}
              </div>
            ) : null}
            {renderToolExecutionPreview(executionPreview)}
            {showToolInput && (
              <div className="grid gap-1.5">
                <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                  Input
                </div>
                {renderJsonCodeBlock(toolCall.function.arguments || "{}")}
              </div>
            )}
            {toolResult?.content.trim() && (
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
        )}
      </div>
    </article>
  );
}
