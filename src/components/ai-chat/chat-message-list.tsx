import { Spinner as RadixSpinner } from "@radix-ui/themes";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Info,
  Pencil,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { type ToolMentionOption } from "@/components/ai-chat/chat-composer";
import { MarkdownMessage } from "@/components/ai-chat/markdown-message";
import { SmoothAssistantMessageContent } from "@/components/ai-chat/smooth-assistant-message";
import {
  AskUserBlock,
  ChecklistBlock,
} from "@/components/ai-chat/tool-interaction-blocks";
import { TooltipIconButton } from "@/components/ai-chat/tooltip-icon-button";
import { UserMessageEditor } from "@/components/ai-chat/user-message-editor";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getActiveVariant } from "@/lib/ai-chat/chat-utils";
import type {
  AskUserRequest,
  AskUserResponse,
  ChatAssistantProcessStep,
  ChatAssistantVariant,
  ChatMessage,
  ChatToolCall,
  ChatToolResult,
  ThinkingStatus,
  ToolExecutionStatus,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const USER_MENTION_PATTERN = /(^|\s)@(tool|skill):([A-Za-z0-9_-]+)(?=$|\s)/g;

type VisibleAssistantProcessStep = ChatAssistantProcessStep & {
  sourceStepIds: string[];
};

export type MessageContextMenuState = {
  messageId: string;
  x: number;
  y: number;
  linkHref: string | null;
  selectedText: string;
};

type RenderToolExecutionBlockArgs = {
  id: string;
  toolCall: ChatToolCall;
  toolResult?: ChatToolResult;
  status?: ToolExecutionStatus;
};

type ChatMessageListProps = {
  messages: ChatMessage[];
  activeChatId: string;
  isSending: boolean;
  editingMessageId: string | null;
  copiedMessageId: string | null;
  messageContextMenu: MessageContextMenuState | null;
  visualFlushRequests: Record<string, number>;
  visualStreamingMessageIds: string[];
  collapsedToolStepIds: Record<string, boolean>;
  collapsedThinkingStepIds: Record<string, boolean>;
  toolDisplayKey: string;
  skillDisplayKey: string;
  toolMentionOptions: ToolMentionOption[];
  skillMentionOptions: ToolMentionOption[];
  registerMessageElement: (
    messageId: string,
  ) => (element: HTMLDivElement | null) => void;
  renderToolExecutionBlock: (args: RenderToolExecutionBlockArgs) => ReactNode;
  canSubmitAskUserResponse: (toolCallId: string) => boolean;
  onCaptureMessageContext: (
    event: ReactMouseEvent<HTMLElement>,
    messageId: string,
  ) => void;
  onCloseMessageContextMenu: () => void;
  onCopyLinkHref: (href: string | null) => void | Promise<void>;
  onCopyMessageContent: (
    messageId: string,
    content: string,
  ) => void | Promise<void>;
  onRegenerateAssistantMessage: (messageId: string) => void | Promise<void>;
  onContinueAssistantMessage: (messageId: string) => void | Promise<void>;
  onStartEditingUserMessage: (messageId: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onCancelEditingUserMessage: () => void;
  onSaveEditedUserMessage: (
    messageId: string,
    nextContent: string,
  ) => void | Promise<void>;
  onSubmitEditedUserMessage: (
    messageId: string,
    nextContent: string,
  ) => void | Promise<void>;
  onSelectAssistantVariant: (messageId: string, variantIndex: number) => void;
  onToggleToolExecutionCollapsed: (
    stepId: string,
    nextCollapsed: boolean,
  ) => void;
  onToggleThinkingCollapsed: (stepId: string, nextCollapsed: boolean) => void;
  onSubmitAskUserResponse: (
    toolCall: ChatToolCall,
    request: AskUserRequest,
    response: AskUserResponse,
  ) => void;
  onCancelAskUserRequest: (toolCallId: string) => void;
  onAskUserLayoutChange: () => void;
  onAssistantVisualProgress: (chatId: string) => void;
  onAssistantVisualStreamingChange: (
    streamingMessageId: string,
    isStreaming: boolean,
  ) => void;
};

function keepOnlyLatestChecklistListStep<T extends ChatAssistantProcessStep>(
  processSteps: T[],
): T[] {
  return processSteps;
}

function getVisibleAssistantProcessSteps(
  processSteps: ChatAssistantProcessStep[],
): VisibleAssistantProcessStep[] {
  const visibleSteps: VisibleAssistantProcessStep[] = [];

  for (const step of keepOnlyLatestChecklistListStep(processSteps)) {
    if (step.type === "thinking" && !step.content.trim()) {
      continue;
    }

    const previousStep = visibleSteps[visibleSteps.length - 1];

    if (
      step.type === "assistant_message" &&
      previousStep?.type === "assistant_message"
    ) {
      previousStep.content = `${previousStep.content}${step.content}`;
      previousStep.sourceStepIds = [...previousStep.sourceStepIds, step.id];
      continue;
    }

    visibleSteps.push({ ...step, sourceStepIds: [step.id] });
  }

  return visibleSteps;
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

function formatThoughtDuration({
  startedAt,
  completedAt,
  currentTimeMs,
  minOneSecond = false,
}: {
  startedAt?: string;
  completedAt?: string;
  currentTimeMs?: number;
  minOneSecond?: boolean;
}) {
  if (!startedAt) return "";

  const startedAtMs = Date.parse(startedAt);
  const completedAtMs = completedAt
    ? Date.parse(completedAt)
    : (currentTimeMs ?? Date.now());

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) {
    return "";
  }

  const rawElapsedSeconds = (completedAtMs - startedAtMs) / 1000;
  const elapsedSeconds = completedAt
    ? Math.round(rawElapsedSeconds)
    : Math.floor(rawElapsedSeconds);
  const totalSeconds = Math.max(minOneSecond ? 1 : 0, elapsedSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} sec`);

  return parts.join(" ");
}

function getEffectiveThinkingStatus(
  status: ThinkingStatus | undefined,
  isStreaming: boolean,
) {
  if (status === "complete") return "complete";
  if (isStreaming || status === "in_progress") return "in_progress";
  return status ?? "complete";
}

function renderThinkingStatus(status: ThinkingStatus) {
  if (status === "complete") {
    return (
      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
        <Check className="size-3.5" />
        Complete
      </span>
    );
  }

  if (status === "waiting") {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <Spinner className="size-3.5" />
        Waiting
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
      <Spinner className="size-3.5" />
      In progress
    </span>
  );
}

type ThinkingBlockProps = {
  id: string;
  content: string;
  status?: ThinkingStatus;
  startedAt?: string;
  completedAt?: string;
  isStreaming: boolean;
  isCollapsed: boolean;
  flushVersion: number;
  forceInstant?: boolean;
  onToggleCollapsed: () => void;
  onVisualProgress: () => void;
  onVisualStreamingChange: (isStreaming: boolean) => void;
};

function ThinkingBlock({
  id,
  content,
  status,
  startedAt,
  completedAt,
  isStreaming,
  isCollapsed,
  flushVersion,
  forceInstant = false,
  onToggleCollapsed,
  onVisualProgress,
  onVisualStreamingChange,
}: ThinkingBlockProps) {
  const effectiveStatus = getEffectiveThinkingStatus(status, isStreaming);
  const [durationTickMs, setDurationTickMs] = useState(() => Date.now());
  const onVisualStreamingChangeRef = useRef(onVisualStreamingChange);

  onVisualStreamingChangeRef.current = onVisualStreamingChange;

  useEffect(() => {
    if (!isCollapsed) return;

    onVisualStreamingChangeRef.current(false);
  }, [isCollapsed]);

  useEffect(() => {
    if (effectiveStatus !== "in_progress" || !startedAt) return;

    setDurationTickMs(Date.now());
    const intervalId = window.setInterval(() => {
      setDurationTickMs(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [effectiveStatus, startedAt]);

  const thoughtDuration = useMemo(() => {
    if (effectiveStatus === "complete") {
      return formatThoughtDuration({
        startedAt,
        completedAt,
        minOneSecond: true,
      });
    }

    if (effectiveStatus === "in_progress") {
      return formatThoughtDuration({
        startedAt,
        currentTimeMs: durationTickMs,
      });
    }

    return "";
  }, [completedAt, durationTickMs, effectiveStatus, startedAt]);

  return (
    <article className="flex min-w-0 max-w-full justify-start">
      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-base leading-6 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
        <button
          type="button"
          className="w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onToggleCollapsed}
          aria-expanded={!isCollapsed}
          aria-controls={`${id}-thinking-content`}
        >
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <Brain className="size-3.5 shrink-0" />
              <span className="truncate">Thinking</span>
              <span className="text-muted-foreground/60">•</span>
              {renderThinkingStatus(effectiveStatus)}
              {thoughtDuration ? (
                <>
                  <span className="text-muted-foreground/60">•</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground/85">
                    {thoughtDuration}
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
          <div
            id={`${id}-thinking-content`}
            className="mt-2 min-w-0 overflow-visible text-sm leading-5"
          >
            <SmoothAssistantMessageContent
              content={content}
              className="chat-markdown-compact shrink-0"
              isApiStreaming={isStreaming}
              skipSyntaxHighlight={isStreaming}
              flushVersion={flushVersion}
              forceInstant={forceInstant}
              onVisualProgress={onVisualProgress}
              onVisualStreamingChange={onVisualStreamingChange}
            />
          </div>
        )}
      </div>
    </article>
  );
}

function formatGenerationInfoJson(metrics: ChatAssistantVariant["metrics"]) {
  if (!metrics) return "{}";

  const usage = metrics.tokenUsage
    ? Object.fromEntries(
        Object.entries({
          prompt_tokens: metrics.tokenUsage.promptTokens,
          completion_tokens: metrics.tokenUsage.completionTokens,
          total_tokens: metrics.tokenUsage.totalTokens,
        }).filter(([, value]) => value !== undefined),
      )
    : undefined;

  const info = Object.fromEntries(
    Object.entries({
      model: metrics.model,
      provider: metrics.providerName,
      finish_reason: metrics.finishReason,
      usage: usage && Object.keys(usage).length > 0 ? usage : undefined,
      duration_ms: metrics.durationMs,
      output_tokens: metrics.outputTokens,
      tokens_per_second: metrics.tokensPerSecond,
      is_approximate: metrics.isApproximate,
      started_at: metrics.startedAt,
      completed_at: metrics.completedAt,
    }).filter(([, value]) => value !== undefined && value !== ""),
  );

  return JSON.stringify(info, null, 2);
}

const UserMessageContent = memo(function UserMessageContent({
  content,
}: {
  content: string;
}) {
  const parts: ReactNode[] = [];
  const pattern = new RegExp(USER_MENTION_PATTERN);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const prefix = match[1] ?? "";
    const mentionType = match[2] === "skill" ? "skill" : "tool";
    const mentionName = match[3] ?? "";
    const token = `@${mentionType}:${mentionName}`;
    const tokenStartIndex = match.index + prefix.length;

    if (tokenStartIndex > lastIndex) {
      parts.push(content.slice(lastIndex, tokenStartIndex));
    }

    parts.push(
      <span
        key={`${tokenStartIndex}-${token}`}
        className="inline-flex items-center rounded-md border border-primary-foreground/25 bg-primary-foreground/15 px-1.5 py-0.5 font-mono text-[0.875em] font-medium leading-5 text-primary-foreground"
        title={`One-shot ${mentionType} for this request: ${mentionName}`}
      >
        {token}
      </span>,
    );

    lastIndex = tokenStartIndex + token.length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return <div className="whitespace-pre-wrap">{parts}</div>;
});

function getRelevantVisualFlushKeys(message: ChatMessage) {
  if (message.role !== "assistant") return [message.id];

  const activeVariant = getActiveVariant(message);
  const processSteps = activeVariant?.processSteps ?? [];
  const visibleProcessSteps = getVisibleAssistantProcessSteps(processSteps);
  const keys = new Set<string>([message.id]);

  for (const step of visibleProcessSteps) {
    for (const sourceStepId of step.sourceStepIds) {
      keys.add(`${message.id}:${sourceStepId}`);
    }
  }

  return [...keys];
}

function getRelevantCollapsedKeys(message: ChatMessage) {
  if (message.role !== "assistant") return [];

  const activeVariant = getActiveVariant(message);
  const processSteps = activeVariant?.processSteps ?? [];
  const visibleProcessSteps = getVisibleAssistantProcessSteps(processSteps);
  const keys = new Set<string>();

  for (const step of visibleProcessSteps) {
    if (
      step.type === "tool_execution" ||
      step.type === "user_input" ||
      step.type === "checklist"
    ) {
      keys.add(step.id);
    }
  }

  for (const toolCall of activeVariant?.toolCalls ?? []) {
    keys.add(toolCall.id);
  }

  return [...keys];
}

function getRelevantThinkingCollapsedKeys(message: ChatMessage) {
  if (message.role !== "assistant") return [];

  const activeVariant = getActiveVariant(message);
  const processSteps = activeVariant?.processSteps ?? [];
  const visibleProcessSteps = getVisibleAssistantProcessSteps(processSteps);
  const keys = new Set<string>();

  for (const step of visibleProcessSteps) {
    if (step.type === "thinking") keys.add(step.id);
  }

  if (keys.size === 0 && activeVariant?.reasoning?.trim()) {
    keys.add(`${message.id}:reasoning`);
  }

  return [...keys];
}

function hasVisualStreamingForMessage(
  visualStreamingMessageIds: string[],
  messageId: string,
) {
  return visualStreamingMessageIds.some(
    (streamingMessageId) =>
      streamingMessageId === messageId ||
      streamingMessageId.startsWith(`${messageId}:`),
  );
}

function areRecordValuesEqual(
  keys: string[],
  previous: Record<string, number | boolean | undefined>,
  next: Record<string, number | boolean | undefined>,
) {
  return keys.every((key) => previous[key] === next[key]);
}

function areContextMenusEqualForMessage(
  previous: MessageContextMenuState | null,
  next: MessageContextMenuState | null,
  messageId: string,
) {
  const previousRelevant = previous?.messageId === messageId ? previous : null;
  const nextRelevant = next?.messageId === messageId ? next : null;

  if (!previousRelevant && !nextRelevant) return true;
  if (!previousRelevant || !nextRelevant) return false;

  return (
    previousRelevant.x === nextRelevant.x &&
    previousRelevant.y === nextRelevant.y &&
    previousRelevant.linkHref === nextRelevant.linkHref &&
    previousRelevant.selectedText === nextRelevant.selectedText
  );
}

type ChatMessageItemProps = Omit<ChatMessageListProps, "messages"> & {
  message: ChatMessage;
};

const ChatMessageItem = memo(
  function ChatMessageItem({
    message,
    activeChatId,
    isSending,
    editingMessageId,
    copiedMessageId,
    messageContextMenu,
    visualFlushRequests,
    visualStreamingMessageIds,
    collapsedToolStepIds,
    collapsedThinkingStepIds,
    toolMentionOptions,
    skillMentionOptions,
    registerMessageElement,
    renderToolExecutionBlock,
    canSubmitAskUserResponse,
    onCaptureMessageContext,
    onCloseMessageContextMenu,
    onCopyLinkHref,
    onCopyMessageContent,
    onRegenerateAssistantMessage,
    onContinueAssistantMessage,
    onStartEditingUserMessage,
    onDeleteMessage,
    onCancelEditingUserMessage,
    onSaveEditedUserMessage,
    onSubmitEditedUserMessage,
    onSelectAssistantVariant,
    onToggleToolExecutionCollapsed,
    onToggleThinkingCollapsed,
    onSubmitAskUserResponse,
    onCancelAskUserRequest,
    onAskUserLayoutChange,
    onAssistantVisualProgress,
    onAssistantVisualStreamingChange,
  }: ChatMessageItemProps) {
    const activeVariant =
      message.role === "assistant" ? getActiveVariant(message) : undefined;
    const content =
      message.role === "assistant"
        ? (activeVariant?.content ?? "")
        : message.content;
    const reasoning = activeVariant?.reasoning ?? "";
    const toolCalls = activeVariant?.toolCalls ?? [];
    const toolResults = activeVariant?.toolResults ?? [];
    const processSteps = activeVariant?.processSteps ?? [];
    const visibleProcessSteps = getVisibleAssistantProcessSteps(processSteps);
    const hasVisibleProcessSteps = visibleProcessSteps.length > 0;
    const latestProcessStepId = processSteps[processSteps.length - 1]?.id;
    const assistantMessageProcessSteps = visibleProcessSteps.filter(
      (step) => step.type === "assistant_message",
    );
    const hasInlineAssistantMessageSteps =
      assistantMessageProcessSteps.length > 0;
    const status = activeVariant?.status;
    const metrics = activeVariant?.metrics;
    const generatedModelName = metrics?.model?.trim() ?? "";
    const isVisuallyStreaming = hasVisualStreamingForMessage(
      visualStreamingMessageIds,
      message.id,
    );
    const isMessageStreaming = status === "streaming" || isVisuallyStreaming;
    const variantCount =
      message.role === "assistant" ? message.variants.length : 0;
    const activeVariantNumber =
      message.role === "assistant" ? message.activeVariantIndex + 1 : 0;

    return (
      <div
        ref={registerMessageElement(message.id)}
        data-message-id={message.id}
        className="grid min-w-0 max-w-full gap-2"
      >
        {message.role === "assistant" && hasVisibleProcessSteps && (
          <div className="grid gap-2">
            {visibleProcessSteps.map((step) => {
              const isLatestProcessStep = step.sourceStepIds.includes(
                latestProcessStepId ?? "",
              );
              const stepFlushVersion = step.sourceStepIds.reduce(
                (total, sourceStepId) =>
                  total +
                  (visualFlushRequests[`${message.id}:${sourceStepId}`] ?? 0),
                0,
              );

              if (step.type === "thinking") {
                if (!step.content.trim()) return null;

                const isThinkingStreaming =
                  status === "streaming" && isLatestProcessStep;

                const manualCollapsed = collapsedThinkingStepIds[step.id];
                const isCollapsed = manualCollapsed ?? !isThinkingStreaming;

                return (
                  <ThinkingBlock
                    key={step.id}
                    id={step.id}
                    content={step.content}
                    status={step.status}
                    startedAt={step.startedAt}
                    completedAt={step.completedAt}
                    isStreaming={isThinkingStreaming}
                    isCollapsed={isCollapsed}
                    flushVersion={stepFlushVersion}
                    forceInstant={!isThinkingStreaming}
                    onToggleCollapsed={() => {
                      const nextCollapsed = !isCollapsed;
                      if (nextCollapsed) {
                        onAssistantVisualStreamingChange(
                          `${message.id}:${step.id}`,
                          false,
                        );
                      }
                      onToggleThinkingCollapsed(step.id, nextCollapsed);
                    }}
                    onVisualProgress={() =>
                      onAssistantVisualProgress(activeChatId)
                    }
                    onVisualStreamingChange={(isStreaming) =>
                      onAssistantVisualStreamingChange(
                        `${message.id}:${step.id}`,
                        isStreaming,
                      )
                    }
                  />
                );
              }

              if (step.type === "assistant_message") {
                if (!step.content.trim()) return null;

                const isAssistantBlockStreaming =
                  status === "streaming" && isLatestProcessStep;
                return (
                  <div key={step.id} className="grid gap-1">
                    <article
                      className="flex min-w-0 max-w-full justify-start"
                      onContextMenu={(event) =>
                        onCaptureMessageContext(event, message.id)
                      }
                    >
                      <div className="min-w-0 max-w-full overflow-visible rounded-lg px-0 py-1 text-base leading-6 text-card-foreground shadow-xs [overflow-wrap:anywhere]">
                        <SmoothAssistantMessageContent
                          content={step.content}
                          isApiStreaming={isAssistantBlockStreaming}
                          skipSyntaxHighlight={isAssistantBlockStreaming}
                          flushVersion={stepFlushVersion}
                          onVisualProgress={() =>
                            onAssistantVisualProgress(activeChatId)
                          }
                          onVisualStreamingChange={(isStreaming) =>
                            onAssistantVisualStreamingChange(
                              `${message.id}:${step.id}`,
                              isStreaming,
                            )
                          }
                        />
                      </div>
                    </article>
                  </div>
                );
              }

              if (step.type === "user_input") {
                const manualCollapsed = collapsedToolStepIds[step.id];
                const isCollapsed =
                  manualCollapsed ?? step.status !== "waiting";

                return (
                  <AskUserBlock
                    key={step.id}
                    id={step.id}
                    request={step.request}
                    response={step.response}
                    status={step.status}
                    canSubmit={canSubmitAskUserResponse(step.toolCall.id)}
                    isCollapsed={isCollapsed}
                    onToggleCollapsed={() =>
                      onToggleToolExecutionCollapsed(step.id, !isCollapsed)
                    }
                    onSubmit={(response) =>
                      onSubmitAskUserResponse(
                        step.toolCall,
                        step.request,
                        response,
                      )
                    }
                    onCancel={() => onCancelAskUserRequest(step.toolCall.id)}
                    onLayoutChange={onAskUserLayoutChange}
                  />
                );
              }

              if (step.type === "checklist") {
                const manualCollapsed = collapsedToolStepIds[step.id];
                const isCollapsed = manualCollapsed ?? false;

                return (
                  <ChecklistBlock
                    key={step.id}
                    id={step.id}
                    request={step.request}
                    status={step.status}
                    isCollapsed={isCollapsed}
                    onToggleCollapsed={() =>
                      onToggleToolExecutionCollapsed(step.id, !isCollapsed)
                    }
                    onLayoutChange={onAskUserLayoutChange}
                  />
                );
              }

              return renderToolExecutionBlock({
                id: step.id,
                toolCall: step.toolCall,
                toolResult: step.toolResult,
                status: step.status,
              });
            })}
          </div>
        )}

        {message.role === "assistant" &&
          !hasVisibleProcessSteps &&
          reasoning.trim() &&
          (() => {
            const reasoningStepId = `${message.id}:reasoning`;
            const isReasoningStreaming = status === "streaming" && !content;
            const manualCollapsed = collapsedThinkingStepIds[reasoningStepId];
            const isCollapsed = manualCollapsed ?? !isReasoningStreaming;

            return (
              <ThinkingBlock
                id={reasoningStepId}
                content={reasoning}
                isStreaming={isReasoningStreaming}
                isCollapsed={isCollapsed}
                flushVersion={visualFlushRequests[message.id] ?? 0}
                forceInstant={Boolean(content)}
                onToggleCollapsed={() => {
                  const nextCollapsed = !isCollapsed;
                  if (nextCollapsed) {
                    onAssistantVisualStreamingChange(
                      `${message.id}:reasoning`,
                      false,
                    );
                  }
                  onToggleThinkingCollapsed(reasoningStepId, nextCollapsed);
                }}
                onVisualProgress={() => onAssistantVisualProgress(activeChatId)}
                onVisualStreamingChange={(isStreaming) =>
                  onAssistantVisualStreamingChange(
                    `${message.id}:reasoning`,
                    isStreaming,
                  )
                }
              />
            );
          })()}

        {message.role === "assistant" &&
          !hasVisibleProcessSteps &&
          toolCalls.length > 0 && (
            <div className="grid gap-2">
              {toolCalls.map((toolCall) => {
                const result = toolResults.find(
                  (item) => item.toolCallId === toolCall.id,
                );

                return renderToolExecutionBlock({
                  id: toolCall.id,
                  toolCall,
                  toolResult: result,
                  status: result
                    ? result.isError
                      ? "failed"
                      : "complete"
                    : "running",
                });
              })}
            </div>
          )}

        {message.role === "user" && editingMessageId === message.id ? (
          <UserMessageEditor
            initialContent={message.content}
            disabled={isSending}
            toolMentionOptions={toolMentionOptions}
            skillMentionOptions={skillMentionOptions}
            onCancel={onCancelEditingUserMessage}
            onSave={(nextContent) =>
              onSaveEditedUserMessage(message.id, nextContent)
            }
            onSubmit={(nextContent) =>
              onSubmitEditedUserMessage(message.id, nextContent)
            }
          />
        ) : (
          (message.role === "user" ||
            (!hasInlineAssistantMessageSteps &&
              (content || status !== "streaming"))) && (
            <>
              <article
                className={cn(
                  "flex min-w-0 max-w-full",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
                onContextMenu={(event) =>
                  onCaptureMessageContext(event, message.id)
                }
              >
                <div
                  className={cn(
                    "min-w-0 text-base leading-6 [overflow-wrap:anywhere] w-full rounded-lg",
                    message.role === "user"
                      ? "max-h-[32rem] overflow-y-auto overflow-x-hidden chat-message-scrollbar bg-primary px-4 py-3 text-primary-foreground shadow-xs"
                      : "min-w-0 max-w-full overflow-visible px-0 py-1 text-card-foreground shadow-xs",
                    status === "error" && "border-destructive/50",
                  )}
                >
                  {message.role === "assistant" ? (
                    <SmoothAssistantMessageContent
                      content={content}
                      isApiStreaming={status === "streaming"}
                      skipSyntaxHighlight={status === "streaming"}
                      flushVersion={visualFlushRequests[message.id] ?? 0}
                      onVisualProgress={() =>
                        onAssistantVisualProgress(activeChatId)
                      }
                      onVisualStreamingChange={(isStreaming) =>
                        onAssistantVisualStreamingChange(
                          `${message.id}:content`,
                          isStreaming,
                        )
                      }
                    />
                  ) : (
                    <UserMessageContent content={message.content} />
                  )}
                </div>
              </article>

              {messageContextMenu?.messageId === message.id && (
                <div
                  data-message-context-menu
                  className="fixed z-50 min-w-55 rounded-lg border bg-popover p-1 text-base text-popover-foreground shadow-md"
                  style={{
                    left: messageContextMenu.x,
                    top: messageContextMenu.y,
                  }}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  {messageContextMenu.linkHref && (
                    <>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                        onClick={() => {
                          void onCopyLinkHref(messageContextMenu.linkHref);
                          onCloseMessageContextMenu();
                        }}
                      >
                        <Copy className="size-4" />
                        Copy link
                      </button>
                      <div className="-mx-1 my-1 h-px bg-border" />
                    </>
                  )}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                    disabled={
                      !messageContextMenu.selectedText.trim() && !content.trim()
                    }
                    onClick={() => {
                      void onCopyMessageContent(
                        message.id,
                        messageContextMenu.selectedText || content,
                      );
                      onCloseMessageContextMenu();
                    }}
                  >
                    <Copy className="size-4" />
                    {messageContextMenu.selectedText.trim()
                      ? "Copy selection"
                      : message.role === "assistant"
                        ? "Copy answer"
                        : "Copy message"}
                  </button>
                  {message.role === "assistant" && (
                    <>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                        disabled={isSending}
                        onClick={() => {
                          void onRegenerateAssistantMessage(message.id);
                          onCloseMessageContextMenu();
                        }}
                      >
                        <RefreshCcw className="size-4" />
                        {status === "error"
                          ? "Retry answer"
                          : "Regenerate answer"}
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                        disabled={isSending || isMessageStreaming}
                        onClick={() => {
                          void onContinueAssistantMessage(message.id);
                          onCloseMessageContextMenu();
                        }}
                      >
                        <ChevronRight className="size-4" />
                        Continue generating
                      </button>
                    </>
                  )}
                  {message.role === "user" && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                      disabled={isSending}
                      onClick={() => {
                        onStartEditingUserMessage(message.id);
                        onCloseMessageContextMenu();
                      }}
                    >
                      <Pencil className="size-4" />
                      Edit message
                    </button>
                  )}
                  <div className="-mx-1 my-1 h-px bg-border" />
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-destructive/20"
                    disabled={isSending}
                    onClick={() => {
                      onDeleteMessage(message.id);
                      onCloseMessageContextMenu();
                    }}
                  >
                    <Trash2 className="size-4" />
                    Delete message
                  </button>
                </div>
              )}
            </>
          )
        )}

        {message.role === "user" && editingMessageId !== message.id && (
          <div className="flex justify-end gap-1.5 text-sm leading-5 text-muted-foreground">
            <TooltipIconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              label="Delete message"
              onClick={() => onDeleteMessage(message.id)}
              disabled={isSending}
            >
              <Trash2 className="size-3" />
            </TooltipIconButton>

            <TooltipIconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label={copiedMessageId === message.id ? "Copied" : "Copy message"}
              onClick={() => onCopyMessageContent(message.id, message.content)}
              disabled={!message.content.trim()}
            >
              {copiedMessageId === message.id ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
            </TooltipIconButton>

            <TooltipIconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label="Edit message"
              onClick={() => onStartEditingUserMessage(message.id)}
              disabled={isSending}
            >
              <Pencil className="size-3" />
            </TooltipIconButton>
          </div>
        )}

        {message.role === "assistant" && (
          <div className="grid gap-2 text-sm leading-5 text-muted-foreground">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="min-h-6 min-w-0 flex-1 text-left">
                {isMessageStreaming ? (
                  <span className="inline-flex items-center gap-1.5">
                    <RadixSpinner
                      aria-hidden="true"
                      className="generating-radix-spinner"
                      size="1"
                    />
                    <span className="generating-gradient-text font-medium">
                      Generating
                    </span>
                  </span>
                ) : generatedModelName ? (
                  <span
                    className="block truncate text-muted-foreground"
                    title={`Generated with ${generatedModelName}`}
                  >
                    {generatedModelName}
                  </span>
                ) : (
                  <span aria-hidden="true" />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {variantCount > 1 && (
                  <div className="flex items-center gap-1">
                    <TooltipIconButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      label="Previous answer"
                      onClick={() =>
                        onSelectAssistantVariant(
                          message.id,
                          message.activeVariantIndex - 1,
                        )
                      }
                      disabled={message.activeVariantIndex <= 0 || isSending}
                    >
                      <ChevronLeft className="size-3.5" />
                    </TooltipIconButton>
                    <span className="min-w-9 text-center tabular-nums">
                      {activeVariantNumber}/{variantCount}
                    </span>
                    <TooltipIconButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      label="Next answer"
                      onClick={() =>
                        onSelectAssistantVariant(
                          message.id,
                          message.activeVariantIndex + 1,
                        )
                      }
                      disabled={
                        message.activeVariantIndex >= variantCount - 1 ||
                        isSending
                      }
                    >
                      <ChevronRight className="size-3.5" />
                    </TooltipIconButton>
                  </div>
                )}

                <Popover>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="h-6 w-6 rounded-lg text-muted-foreground"
                          disabled={metrics?.durationMs === undefined}
                          title="Generation info"
                          aria-label="Generation info"
                        >
                          <Info className="size-3" />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Generation info</TooltipContent>
                  </Tooltip>
                  <PopoverContent
                    align="end"
                    className="w-[min(26rem,calc(100vw-2rem))] rounded-lg p-3"
                  >
                    <div className="mb-2 text-sm font-medium text-popover-foreground">
                      Generation info
                    </div>
                    {renderJsonCodeBlock(
                      formatGenerationInfoJson(metrics),
                      "chat-markdown-compact max-h-120 overflow-auto text-sm",
                    )}
                  </PopoverContent>
                </Popover>

                <TooltipIconButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  label="Delete message"
                  onClick={() => onDeleteMessage(message.id)}
                  disabled={isSending}
                >
                  <Trash2 className="size-3" />
                </TooltipIconButton>

                <TooltipIconButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  label={
                    status === "error" ? "Retry answer" : "Regenerate answer"
                  }
                  onClick={() => onRegenerateAssistantMessage(message.id)}
                  disabled={isSending}
                >
                  <RefreshCcw className="size-3" />
                </TooltipIconButton>

                <TooltipIconButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  label="Continue generating"
                  onClick={() => onContinueAssistantMessage(message.id)}
                  disabled={isSending || isMessageStreaming}
                >
                  <ChevronRight className="size-3.5" />
                </TooltipIconButton>

                <TooltipIconButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  label={
                    copiedMessageId === message.id ? "Copied" : "Copy answer"
                  }
                  onClick={() => onCopyMessageContent(message.id, content)}
                  disabled={!content.trim()}
                >
                  {copiedMessageId === message.id ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                </TooltipIconButton>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
  (previous, next) => {
    if (previous.message !== next.message) return false;
    if (previous.activeChatId !== next.activeChatId) return false;
    if (previous.isSending !== next.isSending) return false;
    if (previous.toolDisplayKey !== next.toolDisplayKey) return false;
    if (previous.skillDisplayKey !== next.skillDisplayKey) return false;

    const messageId = previous.message.id;
    if (
      (previous.editingMessageId === messageId) !==
      (next.editingMessageId === messageId)
    ) {
      return false;
    }
    if (
      (previous.copiedMessageId === messageId) !==
      (next.copiedMessageId === messageId)
    ) {
      return false;
    }
    if (
      !areContextMenusEqualForMessage(
        previous.messageContextMenu,
        next.messageContextMenu,
        messageId,
      )
    ) {
      return false;
    }
    if (
      hasVisualStreamingForMessage(
        previous.visualStreamingMessageIds,
        messageId,
      ) !==
      hasVisualStreamingForMessage(next.visualStreamingMessageIds, messageId)
    ) {
      return false;
    }

    const visualFlushKeys = getRelevantVisualFlushKeys(previous.message);
    if (
      !areRecordValuesEqual(
        visualFlushKeys,
        previous.visualFlushRequests,
        next.visualFlushRequests,
      )
    ) {
      return false;
    }

    const collapsedKeys = getRelevantCollapsedKeys(previous.message);
    if (
      !areRecordValuesEqual(
        collapsedKeys,
        previous.collapsedToolStepIds,
        next.collapsedToolStepIds,
      )
    ) {
      return false;
    }

    const thinkingCollapsedKeys = getRelevantThinkingCollapsedKeys(
      previous.message,
    );
    if (
      !areRecordValuesEqual(
        thinkingCollapsedKeys,
        previous.collapsedThinkingStepIds,
        next.collapsedThinkingStepIds,
      )
    ) {
      return false;
    }

    return true;
  },
);

export const ChatMessageList = memo(function ChatMessageList({
  messages,
  ...itemProps
}: ChatMessageListProps) {
  return (
    <>
      {messages.map((message) => (
        <ChatMessageItem key={message.id} message={message} {...itemProps} />
      ))}
    </>
  );
});
