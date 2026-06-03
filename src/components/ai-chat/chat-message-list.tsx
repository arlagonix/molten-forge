import { Spinner as RadixSpinner } from "@radix-ui/themes";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranch,
  Info,
  Pencil,
  RefreshCcw,
  Trash2,
  Wrench,
} from "lucide-react";
import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from "react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { AgentCallBlock } from "@/components/ai-chat/agent-call-block";
import { AttachmentChips } from "@/components/ai-chat/attachment-chips";
import { type ToolMentionOption } from "@/components/ai-chat/chat-composer";
import { MarkdownMessage } from "@/components/ai-chat/markdown-message";
import { SmoothAssistantMessageContent } from "@/components/ai-chat/smooth-assistant-message";
import { ThinkingBlock } from "@/components/ai-chat/thinking-block";
import {
  AskUserBlock,
  TaskListBlock,
  ToolApprovalBlock,
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
  ChatAttachment,
  ChatMessage,
  ChatToolCall,
  ChatToolResult,
  ToolApprovalResponse,
  ToolExecutionStatus,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const USER_MENTION_PATTERN =
  /(^|\s)@(tool|skill|agent):([A-Za-z0-9_-]+)(?=$|\s)/g;

function MarkdownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15V9l3 4 3-4v6" />
      <path d="M16 9v6" />
      <path d="m14 13 2 2 2-2" />
    </svg>
  );
}

type VisibleAssistantProcessStep = ChatAssistantProcessStep & {
  sourceStepIds: string[];
};

type VisibleAssistantProcessStepBaseGroup =
  | { kind: "single"; step: VisibleAssistantProcessStep }
  | {
      kind: "tool_batch";
      toolBatchId: string;
      steps: VisibleAssistantProcessStep[];
    };

type VisibleAssistantProcessStepGroup =
  | VisibleAssistantProcessStepBaseGroup
  | {
      kind: "thinking_tool_group";
      thinkingStep: VisibleAssistantProcessStep;
      toolGroups: VisibleAssistantProcessStepBaseGroup[];
    };

function getVisibleStepToolBatchId(step: VisibleAssistantProcessStep) {
  return "toolBatchId" in step ? step.toolBatchId : undefined;
}

function isToolRelatedVisibleStep(step: VisibleAssistantProcessStep) {
  return (
    step.type === "tool_building" ||
    step.type === "tool_execution" ||
    step.type === "agent_call" ||
    step.type === "user_input" ||
    step.type === "approval" ||
    step.type === "file_approval" ||
    step.type === "tasks"
  );
}

function groupToolRelatedVisibleSteps(
  steps: VisibleAssistantProcessStep[],
): VisibleAssistantProcessStepBaseGroup[] {
  const groups: VisibleAssistantProcessStepBaseGroup[] = [];
  let index = 0;

  while (index < steps.length) {
    const step = steps[index];
    const toolBatchId = getVisibleStepToolBatchId(step);

    if (!toolBatchId) {
      groups.push({ kind: "single", step });
      index += 1;
      continue;
    }

    const batchSteps: VisibleAssistantProcessStep[] = [];
    while (
      index < steps.length &&
      getVisibleStepToolBatchId(steps[index]) === toolBatchId
    ) {
      batchSteps.push(steps[index]);
      index += 1;
    }

    if (batchSteps.length > 1) {
      groups.push({ kind: "tool_batch", toolBatchId, steps: batchSteps });
    } else {
      groups.push({ kind: "single", step: batchSteps[0] });
    }
  }

  return groups;
}

function isAssistantTextVisibleStep(step: VisibleAssistantProcessStep) {
  return step.type === "assistant_message" && step.content.trim().length > 0;
}

function isThinkingToolGroupBoundary(step: VisibleAssistantProcessStep) {
  return step.type === "thinking" || isAssistantTextVisibleStep(step);
}

function groupVisibleAssistantProcessSteps(
  steps: VisibleAssistantProcessStep[],
): VisibleAssistantProcessStepGroup[] {
  const groups: VisibleAssistantProcessStepGroup[] = [];
  let index = 0;

  while (index < steps.length) {
    const step = steps[index];

    if (step.type === "thinking") {
      const toolSteps: VisibleAssistantProcessStep[] = [];
      let lookaheadIndex = index + 1;

      while (lookaheadIndex < steps.length) {
        const lookaheadStep = steps[lookaheadIndex];

        if (isThinkingToolGroupBoundary(lookaheadStep)) break;

        if (isToolRelatedVisibleStep(lookaheadStep)) {
          toolSteps.push(lookaheadStep);
        }

        lookaheadIndex += 1;
      }

      if (toolSteps.length > 0) {
        groups.push({
          kind: "thinking_tool_group",
          thinkingStep: step,
          toolGroups: groupToolRelatedVisibleSteps(toolSteps),
        });
        index = lookaheadIndex;
        continue;
      }
    }

    if (isToolRelatedVisibleStep(step)) {
      const toolBatchId = getVisibleStepToolBatchId(step);

      if (toolBatchId) {
        const batchSteps: VisibleAssistantProcessStep[] = [];
        while (
          index < steps.length &&
          getVisibleStepToolBatchId(steps[index]) === toolBatchId
        ) {
          batchSteps.push(steps[index]);
          index += 1;
        }

        if (batchSteps.length > 1) {
          groups.push({ kind: "tool_batch", toolBatchId, steps: batchSteps });
        } else {
          groups.push({ kind: "single", step: batchSteps[0] });
        }
        continue;
      }
    }

    groups.push({ kind: "single", step });
    index += 1;
  }

  return groups;
}

export type MessageContextMenuState = {
  messageId: string;
  x: number;
  y: number;
  linkHref: string | null;
  selectedText: string;
  renderedText: string;
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
  // The scroll container that owns the message viewport. Shared with
  // useChatAutoscroll so virtualization, sticky-scroll, and position
  // restoration all operate on the same element.
  scrollElementRef: RefObject<HTMLDivElement | null>;
  // Populated by the list with a function that maps a message id to the
  // scrollTop at which that message's top aligns with the viewport top, using
  // the virtualizer's measurements. Lets the autoscroll hook restore a saved
  // position even when the anchored message is not currently mounted.
  offsetResolverRef?: RefObject<((messageId: string) => number | null) | null>;
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
  agentDisplayKey: string;
  toolMentionOptions: ToolMentionOption[];
  skillMentionOptions: ToolMentionOption[];
  agentMentionOptions: ToolMentionOption[];
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
  onBranchFromMessage: (messageId: string) => void | Promise<void>;
  onRegenerateAssistantMessage: (messageId: string) => void | Promise<void>;
  onContinueAssistantMessage: (messageId: string) => void | Promise<void>;
  onStartEditingUserMessage: (messageId: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onCancelEditingUserMessage: () => void;
  onSaveEditedUserMessage: (
    messageId: string,
    nextContent: string,
    attachments?: ChatAttachment[],
  ) => void | Promise<void>;
  onSubmitEditedUserMessage: (
    messageId: string,
    nextContent: string,
    attachments?: ChatAttachment[],
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
  ) => void | Promise<void>;
  onSubmitFileToolApprovalResponse: (
    toolCall: ChatToolCall,
    response: ToolApprovalResponse,
  ) => void | Promise<void>;
  onCancelAskUserRequest: (toolCallId: string) => void;
  onAskUserLayoutChange: () => void;
  onAssistantVisualProgress: (chatId: string) => void;
  onAssistantVisualStreamingChange: (
    streamingMessageId: string,
    isStreaming: boolean,
  ) => void;
};

function keepOnlyLatestTaskListStep<T extends ChatAssistantProcessStep>(
  processSteps: T[],
): T[] {
  return processSteps;
}

function getVisibleAssistantProcessSteps(
  processSteps: ChatAssistantProcessStep[],
): VisibleAssistantProcessStep[] {
  const visibleSteps: VisibleAssistantProcessStep[] = [];

  for (const step of keepOnlyLatestTaskListStep(processSteps)) {
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
    const mentionType =
      match[2] === "skill" ? "skill" : match[2] === "agent" ? "agent" : "tool";
    const mentionName = match[3] ?? "";
    const token = `@${mentionType}:${mentionName}`;
    const tokenStartIndex = match.index + prefix.length;

    if (tokenStartIndex > lastIndex) {
      parts.push(content.slice(lastIndex, tokenStartIndex));
    }

    parts.push(
      <span
        key={`${tokenStartIndex}-${token}`}
        className="inline-flex items-center  border border-primary-foreground/25 bg-primary-foreground/15 px-1.5 py-0.5 font-mono text-[0.875em] font-medium leading-5 text-primary-foreground"
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

const SourceMarkdownContent = memo(function SourceMarkdownContent({
  content,
}: {
  content: string;
}) {
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 sm:text-base">
      {content}
    </pre>
  );
});

function getRenderedMessageText(trigger: HTMLElement) {
  const messageElement = trigger.closest<HTMLElement>("[data-message-id]");
  const contentElement = messageElement?.querySelector<HTMLElement>(
    "[data-message-content]",
  );

  if (!contentElement) return "";

  const clone = contentElement.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      [
        "[data-codeblock-ui='true']",
        "[data-slot='dialog-title']",
        "[data-slot='dialog-description']",
        ".sr-only",
        ".chat-code-header",
        ".chat-code-toolbar-actions",
        ".chat-code-action",
      ].join(","),
    )
    .forEach((node) => node.remove());

  return clone.innerText.trim();
}

function getMessageCopyContent(
  isSourceView: boolean,
  trigger: HTMLElement,
  sourceContent: string,
) {
  if (isSourceView) return sourceContent;

  return getRenderedMessageText(trigger) || sourceContent;
}

function getSourceViewToggleLabel(isSourceView: boolean) {
  return isSourceView ? "Show rendered Markdown" : "Show Markdown source";
}

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
      step.type === "agent_call" ||
      step.type === "user_input" ||
      step.type === "approval" ||
      step.type === "file_approval" ||
      step.type === "tasks"
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
    previousRelevant.selectedText === nextRelevant.selectedText &&
    previousRelevant.renderedText === nextRelevant.renderedText
  );
}

type ChatMessageItemProps = Omit<
  ChatMessageListProps,
  "messages" | "scrollElementRef" | "offsetResolverRef"
> & {
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
    agentMentionOptions,
    registerMessageElement,
    renderToolExecutionBlock,
    canSubmitAskUserResponse,
    onCaptureMessageContext,
    onCloseMessageContextMenu,
    onCopyLinkHref,
    onCopyMessageContent,
    onBranchFromMessage,
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
    onSubmitFileToolApprovalResponse,
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
    const [isSourceView, setIsSourceView] = useState(false);
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
    const messageSourceContent =
      content ||
      assistantMessageProcessSteps.map((step) => step.content).join("\n\n");
    const hasMessageSourceContent = messageSourceContent.trim().length > 0;
    const hasInlineAssistantMessageSteps =
      assistantMessageProcessSteps.length > 0;
    const status = activeVariant?.status;
    const metrics = activeVariant?.metrics;
    const generatedModelName = metrics?.model?.trim() ?? "";
    const isMessageStreaming = status === "streaming";
    const variantCount =
      message.role === "assistant" ? message.variants.length : 0;
    const activeVariantNumber =
      message.role === "assistant" ? message.activeVariantIndex + 1 : 0;

    const processStepGroups =
      groupVisibleAssistantProcessSteps(visibleProcessSteps);

    const renderProcessStep = (step: VisibleAssistantProcessStep) => {
      const isLatestProcessStep = step.sourceStepIds.includes(
        latestProcessStepId ?? "",
      );
      const stepFlushVersion = step.sourceStepIds.reduce(
        (total, sourceStepId) =>
          total + (visualFlushRequests[`${message.id}:${sourceStepId}`] ?? 0),
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
            onVisualProgress={() => onAssistantVisualProgress(activeChatId)}
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
              className="flex w-full min-w-0 max-w-full justify-start"
              onContextMenu={(event) =>
                onCaptureMessageContext(event, message.id)
              }
            >
              <div
                className={cn(
                  "w-full min-w-0 max-w-full overflow-visible  px-0 py-1 text-base leading-6 text-card-foreground shadow-xs [overflow-wrap:anywhere]",
                )}
                data-message-content
                data-message-view-mode={isSourceView ? "source" : "rendered"}
              >
                {isSourceView ? (
                  <SourceMarkdownContent content={step.content} />
                ) : (
                  <SmoothAssistantMessageContent
                    content={step.content}
                    messageId={`${message.id}:${step.id}`}
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
                )}
              </div>
            </article>
          </div>
        );
      }

      if (step.type === "tool_building") {
        const toolNames = [
          ...new Set(
            step.toolCalls
              .map((toolCall) => toolCall.function.name.trim())
              .filter(Boolean),
          ),
        ];
        const toolName = toolNames.join(", ");

        return (
          <article
            key={step.id}
            className="flex w-full min-w-0 max-w-full justify-start"
          >
            <div className="w-full min-w-0 max-w-full overflow-hidden  border border-dashed bg-muted/30 px-4 py-3 text-base leading-6 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
              <div className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                <div className="flex min-w-0 items-center gap-2">
                  <Wrench className="size-3.5 shrink-0" />
                  <span className="shrink-0 truncate">Tool building</span>
                  <span className="shrink-0 text-muted-foreground/60">•</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-amber-600 dark:text-amber-400">
                    <Spinner className="size-3.5" />
                    In progress
                  </span>
                  {toolName ? (
                    <>
                      <span className="shrink-0 text-muted-foreground/60">
                        •
                      </span>
                      <span className="min-w-0 truncate normal-case tracking-normal text-muted-foreground/85">
                        {toolName}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </article>
        );
      }

      if (step.type === "agent_call") {
        void isLatestProcessStep;
        void stepFlushVersion;

        return (
          <AgentCallBlock
            key={step.id}
            id={step.id}
            agentCall={step.agentCall}
            status={step.status}
            renderToolExecutionBlock={renderToolExecutionBlock}
            canSubmitAskUserResponse={canSubmitAskUserResponse}
            onSubmitAskUserResponse={onSubmitAskUserResponse}
            onCancelAskUserRequest={onCancelAskUserRequest}
            onAskUserLayoutChange={onAskUserLayoutChange}
          />
        );
      }

      if (step.type === "user_input") {
        const manualCollapsed = collapsedToolStepIds[step.id];
        const isCollapsed = manualCollapsed ?? step.status !== "waiting";

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
              onSubmitAskUserResponse(step.toolCall, step.request, response)
            }
            onCancel={() => onCancelAskUserRequest(step.toolCall.id)}
            onLayoutChange={onAskUserLayoutChange}
          />
        );
      }

      if (step.type === "approval" || step.type === "file_approval") {
        const manualCollapsed = collapsedToolStepIds[step.id];
        const isCollapsed = manualCollapsed ?? step.status !== "waiting";

        return (
          <ToolApprovalBlock
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
              onSubmitFileToolApprovalResponse(step.toolCall, response)
            }
            onLayoutChange={onAskUserLayoutChange}
          />
        );
      }

      if (step.type === "tasks") {
        const manualCollapsed = collapsedToolStepIds[step.id];
        const isCollapsed = manualCollapsed ?? false;

        return (
          <TaskListBlock
            key={step.id}
            id={step.id}
            toolCall={step.toolCall}
            toolResult={step.toolResult}
            status={step.status}
            isCollapsed={isCollapsed}
            onToggleCollapsed={() =>
              onToggleToolExecutionCollapsed(step.id, !isCollapsed)
            }
            onLayoutChange={onAskUserLayoutChange}
          />
        );
      }

      if (step.type === "tool_execution") {
        return renderToolExecutionBlock({
          id: step.id,
          toolCall: step.toolCall,
          toolResult: step.toolResult,
          status: step.status,
        });
      }

      return null;
    };

    const renderProcessStepGroup = (
      group: VisibleAssistantProcessStepGroup,
      options?: { insideThinkingToolGroup?: boolean },
    ): ReactNode => {
      if (group.kind === "tool_batch") {
        const insideThinkingToolGroup = Boolean(
          options?.insideThinkingToolGroup,
        );

        return (
          <div
            key={group.toolBatchId}
            className={cn(
              "grid gap-2 bg-transparent",
              insideThinkingToolGroup
                ? ""
                : "border border-dashed px-2 py-2 shadow-xs",
            )}
          >
            <div
              className={cn(
                "text-xs font-medium uppercase tracking-wide text-muted-foreground/80",
                !insideThinkingToolGroup && "px-1",
              )}
            >
              Parallel tool calls
            </div>
            <div className="grid gap-2">
              {group.steps.map(renderProcessStep)}
            </div>
          </div>
        );
      }

      if (group.kind === "thinking_tool_group") {
        const key = `${group.thinkingStep.id}:tool-group`;
        return (
          <div
            key={key}
            className="grid gap-2 border border-dashed bg-muted/10 px-2 py-2 shadow-xs"
          >
            {renderProcessStep(group.thinkingStep)}
            {group.toolGroups.map((toolGroup) =>
              renderProcessStepGroup(toolGroup, {
                insideThinkingToolGroup: true,
              }),
            )}
          </div>
        );
      }

      return renderProcessStep(group.step);
    };

    return (
      <div
        ref={registerMessageElement(message.id)}
        data-message-id={message.id}
        className="group/message grid min-w-0 max-w-full gap-2"
      >
        {message.role === "assistant" && hasVisibleProcessSteps && (
          <div className="grid gap-2">
            {processStepGroups.map((group) => renderProcessStepGroup(group))}
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
            initialAttachments={message.attachments ?? []}
            disabled={isSending}
            toolMentionOptions={toolMentionOptions}
            skillMentionOptions={skillMentionOptions}
            agentMentionOptions={agentMentionOptions}
            onCancel={onCancelEditingUserMessage}
            onSave={(nextContent, attachments) =>
              onSaveEditedUserMessage(message.id, nextContent, attachments)
            }
            onSubmit={(nextContent, attachments) =>
              onSubmitEditedUserMessage(message.id, nextContent, attachments)
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
                  data-message-content
                  className={cn(
                    "min-w-0 text-base leading-6 [overflow-wrap:anywhere] w-full ",
                    message.role === "user"
                      ? "max-h-[32rem] overflow-y-auto overflow-x-hidden chat-message-scrollbar bg-primary px-4 py-3 text-primary-foreground shadow-xs"
                      : "min-w-0 max-w-full overflow-visible px-0 py-1 text-card-foreground shadow-xs",
                    status === "error" && "border-destructive/50",
                  )}
                  data-message-view-mode={isSourceView ? "source" : "rendered"}
                >
                  {message.role === "user" && message.attachments?.length ? (
                    <AttachmentChips
                      attachments={message.attachments}
                      readOnly
                      className={cn(content && "mb-3")}
                    />
                  ) : null}
                  {isSourceView ? (
                    <SourceMarkdownContent content={content} />
                  ) : message.role === "assistant" ? (
                    <SmoothAssistantMessageContent
                      content={content}
                      messageId={`${message.id}:content`}
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
            </>
          )
        )}

        {messageContextMenu?.messageId === message.id &&
          createPortal(
            <div
              data-message-context-menu
              className="fixed z-50 min-w-55  border bg-popover p-1 text-base text-popover-foreground shadow-md"
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
                    className="flex w-full items-center gap-2  px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
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
                className="flex w-full items-center gap-2  px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                disabled={
                  !messageContextMenu.selectedText.trim() &&
                  !hasMessageSourceContent
                }
                onClick={(event) => {
                  void onCopyMessageContent(
                    message.id,
                    messageContextMenu.selectedText ||
                      (isSourceView
                        ? messageSourceContent
                        : messageContextMenu.renderedText ||
                          messageSourceContent),
                  );
                  onCloseMessageContextMenu();
                }}
              >
                <Copy className="size-4" />
                {messageContextMenu.selectedText.trim()
                  ? "Copy selection"
                  : isSourceView
                    ? "Copy source"
                    : message.role === "assistant"
                      ? "Copy answer"
                      : "Copy message"}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2  px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                disabled={!hasMessageSourceContent}
                onClick={() => {
                  setIsSourceView((current) => !current);
                  onCloseMessageContextMenu();
                }}
              >
                <MarkdownIcon className="size-4" />
                {getSourceViewToggleLabel(isSourceView)}
              </button>
              <div className="-mx-1 my-1 h-px bg-border" />
              <button
                type="button"
                className="flex w-full items-center gap-2  px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                disabled={isSending || isMessageStreaming}
                onClick={() => {
                  void onBranchFromMessage(message.id);
                  onCloseMessageContextMenu();
                }}
              >
                <GitBranch className="size-4" />
                Branch from here
              </button>
              {message.role === "assistant" && (
                <>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2  px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                    disabled={isSending}
                    onClick={() => {
                      void onRegenerateAssistantMessage(message.id);
                      onCloseMessageContextMenu();
                    }}
                  >
                    <RefreshCcw className="size-4" />
                    {status === "error" ? "Retry answer" : "Regenerate answer"}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2  px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
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
                  className="flex w-full items-center gap-2  px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
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
                className="flex w-full items-center gap-2  px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-destructive/20"
                disabled={isSending}
                onClick={() => {
                  onDeleteMessage(message.id);
                  onCloseMessageContextMenu();
                }}
              >
                <Trash2 className="size-4" />
                Delete message
              </button>
            </div>,
            document.body,
          )}

        {message.role === "user" && editingMessageId !== message.id && (
          <div className="flex justify-end gap-1.5 text-sm leading-5 text-muted-foreground opacity-0 transition-opacity focus-within:opacity-100 group-hover/message:opacity-100">
            <TooltipIconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label="Branch from here"
              onClick={() => onBranchFromMessage(message.id)}
              disabled={isSending}
            >
              <GitBranch className="size-3" />
            </TooltipIconButton>

            <TooltipIconButton
              type="button"
              variant="ghost"
              size="icon-sm"
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
              label={getSourceViewToggleLabel(isSourceView)}
              onClick={() => setIsSourceView((current) => !current)}
              disabled={!message.content.trim()}
            >
              <MarkdownIcon className="size-3" />
            </TooltipIconButton>

            <TooltipIconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label={
                copiedMessageId === message.id
                  ? "Copied"
                  : isSourceView
                    ? "Copy source"
                    : "Copy message"
              }
              onClick={(event) =>
                onCopyMessageContent(
                  message.id,
                  getMessageCopyContent(
                    isSourceView,
                    event.currentTarget,
                    message.content,
                  ),
                )
              }
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
                    className="block truncate text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100"
                    title={`Generated with ${generatedModelName}`}
                  >
                    {generatedModelName}
                  </span>
                ) : (
                  <span aria-hidden="true" />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/message:opacity-100">
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
                          className="h-6 w-6  text-muted-foreground"
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
                    className="w-[min(26rem,calc(100vw-2rem))]  p-3"
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
                  label="Branch from here"
                  onClick={() => onBranchFromMessage(message.id)}
                  disabled={isSending || isMessageStreaming}
                >
                  <GitBranch className="size-3" />
                </TooltipIconButton>

                <TooltipIconButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
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
                  label={getSourceViewToggleLabel(isSourceView)}
                  onClick={() => setIsSourceView((current) => !current)}
                  disabled={!hasMessageSourceContent}
                >
                  <MarkdownIcon className="size-3" />
                </TooltipIconButton>

                <TooltipIconButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  label={
                    copiedMessageId === message.id
                      ? "Copied"
                      : isSourceView
                        ? "Copy source"
                        : "Copy answer"
                  }
                  onClick={(event) =>
                    onCopyMessageContent(
                      message.id,
                      getMessageCopyContent(
                        isSourceView,
                        event.currentTarget,
                        messageSourceContent,
                      ),
                    )
                  }
                  disabled={!hasMessageSourceContent}
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
    if (previous.agentDisplayKey !== next.agentDisplayKey) return false;

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

// Matches the previous flex `gap-5` between messages, now applied by the
// virtualizer since the items are absolutely positioned.
const MESSAGE_GAP_PX = 20;
const VIRTUAL_MESSAGE_OVERSCAN = 6;

function estimateMessageHeight(message: ChatMessage) {
  const text =
    message.role === "user"
      ? message.content
      : (getActiveVariant(message)?.content ?? "");
  const lines = Math.max(1, Math.ceil(text.length / 80));
  // A rough starting estimate only — the virtualizer measures the real height
  // once each item mounts and corrects the layout.
  return Math.min(4000, 120 + lines * 22);
}

export const ChatMessageList = memo(function ChatMessageList({
  messages,
  scrollElementRef,
  offsetResolverRef,
  ...itemProps
}: ChatMessageListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // The scroll container is an ancestor; React attaches its ref only after this
  // component's layout effects run, so on the first mount the virtualizer
  // initializes against a null element and renders nothing. Once the element is
  // available we force a single re-render — the virtualizer rebinds to the
  // scroll element on every render — so the initial chat is no longer blank.
  const [, setScrollElementReady] = useState(false);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: (index) => estimateMessageHeight(messages[index]),
    overscan: VIRTUAL_MESSAGE_OVERSCAN,
    gap: MESSAGE_GAP_PX,
    scrollMargin,
    getItemKey: (index) => messages[index].id,
  });

  useEffect(() => {
    if (scrollElementRef.current) {
      setScrollElementReady(true);
    }
  }, [scrollElementRef]);

  // The list does not begin at the very top of the scroll element (the content
  // wrapper carries vertical padding), so the virtualizer needs that offset to
  // translate scroll positions into item coordinates. It only changes when the
  // layout resizes, so recompute on mount and on resize rather than per render.
  useLayoutEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) return;

    const measureScrollMargin = () => {
      const list = listRef.current;
      if (!list || !scrollElement) return;

      const nextMargin =
        list.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop;

      setScrollMargin((previous) =>
        Math.abs(previous - nextMargin) < 1 ? previous : nextMargin,
      );
    };

    measureScrollMargin();

    const resizeObserver = new ResizeObserver(measureScrollMargin);
    resizeObserver.observe(scrollElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [scrollElementRef]);

  // Publish a measurement-based offset resolver so position restoration works
  // even when the anchored message is currently virtualized out of the DOM.
  const resolveMessageOffset = useCallback(
    (messageId: string) => {
      const index = messages.findIndex((message) => message.id === messageId);
      if (index < 0) return null;

      const offset = virtualizer.getOffsetForIndex(index, "start");
      return offset ? offset[0] : null;
    },
    [messages, virtualizer],
  );

  useLayoutEffect(() => {
    if (!offsetResolverRef) return;

    offsetResolverRef.current = resolveMessageOffset;
    return () => {
      offsetResolverRef.current = null;
    };
  }, [offsetResolverRef, resolveMessageOffset]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={listRef}
      className="relative w-full min-w-0"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualItems.map((virtualItem) => (
        <div
          key={virtualItem.key}
          data-index={virtualItem.index}
          ref={virtualizer.measureElement}
          // Position with `top` rather than `transform`: a transform would
          // establish a containing block, which breaks `position: sticky`
          // descendants (code-block headers) and re-anchors `position: fixed`
          // popups (message context menu) to the item instead of the viewport.
          className="absolute left-0 w-full min-w-0"
          style={{ top: virtualItem.start - scrollMargin }}
        >
          <ChatMessageItem
            message={messages[virtualItem.index]}
            {...itemProps}
          />
        </div>
      ))}
    </div>
  );
});
