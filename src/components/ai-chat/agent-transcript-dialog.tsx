import { Bot, Maximize2 } from "lucide-react";
import {
  Fragment,
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { RenderAgentToolExecutionBlock } from "@/components/ai-chat/agent-call-utils";
import { AgentStatusInline } from "@/components/ai-chat/agent-status-inline";
import { MarkdownMessage } from "@/components/ai-chat/markdown-message";
import { ThinkingBlock } from "@/components/ai-chat/thinking-block";
import { AskUserBlock } from "@/components/ai-chat/tool-interaction-blocks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ASK_USER_TOOL_NAME,
  parseAskUserRequestFromToolCall,
} from "@/lib/ai-chat/builtin-tools";
import {
  getToolBatchGroupLabel,
  getVisibleAssistantProcessSteps,
  groupVisibleAssistantProcessSteps,
  type VisibleAssistantProcessStep,
  type VisibleAssistantProcessStepGroup,
} from "@/lib/ai-chat/process-step-groups";
import type {
  AgentCallStatus,
  AskUserResponse,
  ChatAgentCall,
  ChatToolCall,
  ChatToolResult,
  ToolExecutionStatus,
  UserInputStatus,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

function HighlightedMentionContent({
  content,
}: {
  content: string;
  isUser: boolean;
}) {
  return <div className="whitespace-pre-wrap">{content}</div>;
}

function getToolStatus(toolResult?: ChatToolResult): ToolExecutionStatus {
  if (!toolResult) return "running";
  return toolResult.isError ? "failed" : "complete";
}

function getAskUserStatus({
  agentStatus,
  canSubmit,
  toolResult,
}: {
  agentStatus: AgentCallStatus;
  canSubmit: boolean;
  toolResult?: ChatToolResult;
}): UserInputStatus {
  if (toolResult) return toolResult.isError ? "failed" : "complete";
  if (canSubmit) return "waiting";
  if (agentStatus === "cancelled") return "cancelled";
  if (agentStatus === "failed") return "failed";
  return "waiting";
}

function parseAskUserResponseFromToolResult(
  toolResult: ChatToolResult | undefined,
): AskUserResponse | undefined {
  if (!toolResult || toolResult.isError) return undefined;

  try {
    const parsed = JSON.parse(toolResult.content) as {
      answered_at?: unknown;
      answers?: Record<
        string,
        {
          answer_type?: unknown;
          answer?: unknown;
          selected_option_id?: unknown;
          selected_option_ids?: unknown;
          selected_option_label?: unknown;
          selected_option_labels?: unknown;
          custom_answer?: unknown;
        }
      >;
    };

    if (!parsed.answers || typeof parsed.answers !== "object") {
      return undefined;
    }

    const answers: Record<string, string> = {};
    const multiAnswers: Record<string, string[]> = {};
    const answerLabels: Record<string, string | string[]> = {};
    const customAnswers: Record<string, string> = {};

    for (const [questionId, value] of Object.entries(parsed.answers)) {
      if (!value || typeof value !== "object") continue;

      if (Array.isArray(value.selected_option_ids)) {
        const selectedIds = value.selected_option_ids.filter(
          (item): item is string => typeof item === "string",
        );
        multiAnswers[questionId] = selectedIds;

        if (Array.isArray(value.selected_option_labels)) {
          answerLabels[questionId] = value.selected_option_labels.filter(
            (item): item is string => typeof item === "string",
          );
        }
      } else if (typeof value.answer === "string") {
        answers[questionId] = value.answer;
        answerLabels[questionId] = value.answer;
      } else if (typeof value.selected_option_id === "string") {
        answers[questionId] = value.selected_option_id;

        if (typeof value.selected_option_label === "string") {
          answerLabels[questionId] = value.selected_option_label;
        }
      }

      if (typeof value.custom_answer === "string") {
        customAnswers[questionId] = value.custom_answer;
      }
    }

    return {
      answers,
      ...(Object.keys(multiAnswers).length ? { multiAnswers } : {}),
      ...(Object.keys(answerLabels).length ? { answerLabels } : {}),
      ...(Object.keys(customAnswers).length ? { customAnswers } : {}),
      answeredAt:
        typeof parsed.answered_at === "string"
          ? parsed.answered_at
          : new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

function getAgentTranscriptToolBlockId(
  agentCall: ChatAgentCall,
  toolCall: ChatToolCall,
  index: number,
) {
  const toolCallId = toolCall.id?.trim() || `index-${index}`;
  return `agent:${agentCall.id}:tool:${toolCallId}`;
}

function hasPendingAskUser(
  agentCall: ChatAgentCall,
  canSubmit: (id: string) => boolean,
): boolean {
  const hasLocalPending = (agentCall.toolCalls ?? []).some(
    (toolCall) =>
      toolCall.function.name === ASK_USER_TOOL_NAME && canSubmit(toolCall.id),
  );

  if (hasLocalPending) return true;

  return (agentCall.childAgentCalls ?? []).some((child) =>
    hasPendingAskUser(child, canSubmit),
  );
}

function MiniChatMessage({
  role,
  content,
}: {
  role: "user" | "assistant";
  content: string;
}) {
  if (!content.trim()) return null;

  const isUser = role === "user";

  return (
    <article
      className={cn(
        "flex min-w-0 max-w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "min-w-0 max-w-full text-base leading-6 [overflow-wrap:anywhere]",
          isUser
            ? "max-w-[85%] bg-primary px-4 py-3 text-primary-foreground shadow-xs"
            : "w-full px-0 py-1 text-card-foreground shadow-xs",
        )}
      >
        {isUser ? (
          <HighlightedMentionContent content={content} isUser={isUser} />
        ) : (
          <MarkdownMessage content={content} />
        )}
      </div>
    </article>
  );
}

function FallbackToolCallBlock({
  toolCall,
}: {
  toolCall: ChatToolCall;
  toolResult?: ChatToolResult;
}) {
  return (
    <article className="flex min-w-0 max-w-full justify-start">
      <div className="w-full min-w-0 max-w-full overflow-hidden border bg-muted/25 px-4 py-3 text-base leading-6 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          <span className="truncate">{toolCall.function.name}</span>
        </div>
      </div>
    </article>
  );
}

function AgentModalHeader({ agentCall }: { agentCall: ChatAgentCall }) {
  return (
    <DialogHeader className="border-b px-5 py-4">
      <DialogTitle className="flex min-w-0 items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        <Bot className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{agentCall.agentName}</span>
        <span className="text-muted-foreground/60">·</span>
        <AgentStatusInline status={agentCall.status} />
        {agentCall.model?.trim() ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span className="min-w-0 truncate normal-case tracking-normal text-muted-foreground/85">
              {agentCall.model.trim()}
            </span>
          </>
        ) : null}
      </DialogTitle>
      {agentCall.description?.trim() ? (
        <div className="line-clamp-2 text-sm text-muted-foreground">
          {agentCall.description}
        </div>
      ) : null}
    </DialogHeader>
  );
}

type AgentInteractionProps = {
  canSubmitAskUserResponse: (toolCallId: string) => boolean;
  onSubmitAskUserResponse: (
    toolCall: ChatToolCall,
    request: ReturnType<typeof parseAskUserRequestFromToolCall>,
    response: AskUserResponse,
  ) => void | Promise<void>;
  onCancelAskUserRequest: (toolCallId: string) => void;
  onAskUserLayoutChange?: () => void;
};

type AgentTranscriptBodyProps = {
  agentCall: ChatAgentCall;
  renderToolExecutionBlock?: RenderAgentToolExecutionBlock;
  nested?: boolean;
  onOpenChildAgent: (agentCallId: string) => void;
} & AgentInteractionProps;

function AgentTranscriptBody(props: AgentTranscriptBodyProps) {
  const hasOrderedSteps = (props.agentCall.processSteps?.length ?? 0) > 0;

  return (
    <div className={cn("grid gap-4", props.nested && "gap-3")}>
      <MiniChatMessage role="user" content={props.agentCall.task} />
      {hasOrderedSteps ? (
        <AgentTranscriptStepsBody {...props} />
      ) : (
        <AgentTranscriptFlatBody {...props} />
      )}
    </div>
  );
}

function AgentTranscriptFlatBody({
  agentCall,
  renderToolExecutionBlock,
  canSubmitAskUserResponse,
  onSubmitAskUserResponse,
  onCancelAskUserRequest,
  onAskUserLayoutChange,
  onOpenChildAgent,
}: AgentTranscriptBodyProps) {
  const visibleToolCalls = agentCall.toolCalls ?? [];
  const visibleToolResults = agentCall.toolResults ?? [];
  const childAgentCalls = agentCall.childAgentCalls ?? [];
  const [collapsedInteractionIds, setCollapsedInteractionIds] = useState<
    Record<string, boolean>
  >({});
  const hasRuntimeAfterThinking =
    agentCall.output.trim().length > 0 ||
    visibleToolCalls.length > 0 ||
    childAgentCalls.length > 0 ||
    (agentCall.status !== "running" && agentCall.status !== "pending");
  const isThinkingActive =
    (agentCall.status === "running" || agentCall.status === "pending") &&
    !hasRuntimeAfterThinking;
  const [thinkingCollapsed, setThinkingCollapsed] = useState(
    () => !isThinkingActive,
  );
  const [thinkingCompletedAt, setThinkingCompletedAt] = useState<
    string | undefined
  >(() => (isThinkingActive ? undefined : agentCall.completedAt));
  const wasThinkingActiveRef = useRef(isThinkingActive);

  useEffect(() => {
    const wasThinkingActive = wasThinkingActiveRef.current;

    if (wasThinkingActive && !isThinkingActive) {
      setThinkingCollapsed(true);
      setThinkingCompletedAt(new Date().toISOString());
    } else if (!wasThinkingActive && isThinkingActive) {
      setThinkingCollapsed(false);
      setThinkingCompletedAt(undefined);
    }

    wasThinkingActiveRef.current = isThinkingActive;
  }, [isThinkingActive]);

  const thinkingStatus = isThinkingActive ? "in_progress" : "complete";
  const effectiveThinkingCompletedAt = isThinkingActive
    ? undefined
    : (thinkingCompletedAt ?? agentCall.completedAt);

  return (
    <>
      {agentCall.reasoning?.trim() ? (
        <ThinkingBlock
          id={`${agentCall.id}:thinking`}
          content={agentCall.reasoning}
          status={thinkingStatus}
          startedAt={agentCall.startedAt}
          completedAt={effectiveThinkingCompletedAt}
          isStreaming={isThinkingActive}
          isCollapsed={thinkingCollapsed}
          flushVersion={0}
          forceInstant
          onToggleCollapsed={() => setThinkingCollapsed((value) => !value)}
        />
      ) : null}

      {visibleToolCalls.map((toolCall, index) => {
        const toolResult = visibleToolResults.find(
          (result) => result.toolCallId === toolCall.id,
        );
        const blockId = getAgentTranscriptToolBlockId(
          agentCall,
          toolCall,
          index,
        );

        if (toolCall.function.name === ASK_USER_TOOL_NAME) {
          try {
            const request = parseAskUserRequestFromToolCall(toolCall);
            const canSubmit = canSubmitAskUserResponse(toolCall.id);
            const status = getAskUserStatus({
              agentStatus: agentCall.status,
              canSubmit,
              toolResult,
            });
            const manualCollapsed = collapsedInteractionIds[blockId];
            const isCollapsed = manualCollapsed ?? status !== "waiting";

            return (
              <AskUserBlock
                key={blockId}
                id={blockId}
                request={request}
                response={parseAskUserResponseFromToolResult(toolResult)}
                status={status}
                canSubmit={canSubmit}
                isCollapsed={isCollapsed}
                onToggleCollapsed={() =>
                  setCollapsedInteractionIds((current) => ({
                    ...current,
                    [blockId]: !isCollapsed,
                  }))
                }
                onSubmit={(response) =>
                  onSubmitAskUserResponse(toolCall, request, response)
                }
                onCancel={() => onCancelAskUserRequest(toolCall.id)}
                onLayoutChange={onAskUserLayoutChange}
              />
            );
          } catch {
            // Fall through to the normal tool block so validation errors remain visible.
          }
        }

        const manualCollapsed = collapsedInteractionIds[blockId];
        const isCollapsed = manualCollapsed ?? true;

        return renderToolExecutionBlock ? (
          renderToolExecutionBlock({
            id: blockId,
            toolCall,
            toolResult,
            status: getToolStatus(toolResult),
            isCollapsed,
            onToggleCollapsed: (stepId, nextCollapsed) =>
              setCollapsedInteractionIds((current) => ({
                ...current,
                [stepId]: nextCollapsed,
              })),
          })
        ) : (
          <FallbackToolCallBlock
            key={blockId}
            toolCall={toolCall}
            toolResult={toolResult}
          />
        );
      })}

      {childAgentCalls.map((child) => (
        <ChildAgentBlock
          key={child.id}
          child={child}
          canSubmitAskUserResponse={canSubmitAskUserResponse}
          onOpenChildAgent={onOpenChildAgent}
        />
      ))}

      <MiniChatMessage role="assistant" content={agentCall.output} />

      {!agentCall.output.trim() &&
      !agentCall.reasoning?.trim() &&
      visibleToolCalls.length === 0 &&
      childAgentCalls.length === 0 ? (
        <div className="border bg-muted/35 px-3 py-2 text-base text-muted-foreground">
          {agentCall.status === "running" || agentCall.status === "pending"
            ? "Waiting for agent output..."
            : "No runtime output recorded."}
        </div>
      ) : null}
    </>
  );
}

function AgentTranscriptStepsBody({
  agentCall,
  renderToolExecutionBlock,
  canSubmitAskUserResponse,
  onSubmitAskUserResponse,
  onCancelAskUserRequest,
  onAskUserLayoutChange,
  onOpenChildAgent,
}: AgentTranscriptBodyProps) {
  const [collapsedInteractionIds, setCollapsedInteractionIds] = useState<
    Record<string, boolean>
  >({});
  const [thinkingCollapsedIds, setThinkingCollapsedIds] = useState<
    Record<string, boolean>
  >({});

  const processSteps = agentCall.processSteps ?? [];
  const visibleSteps = getVisibleAssistantProcessSteps(processSteps);
  const groups = groupVisibleAssistantProcessSteps(visibleSteps);
  const lastStepId =
    visibleSteps[visibleSteps.length - 1]?.sourceStepIds.at(-1);
  const agentRunning =
    agentCall.status === "running" || agentCall.status === "pending";

  const childById = new Map(
    (agentCall.childAgentCalls ?? []).map((child) => [child.id, child]),
  );

  const renderStep = (step: VisibleAssistantProcessStep): ReactNode => {
    if (step.type === "thinking") {
      if (!step.content.trim()) return null;
      const isLast = step.sourceStepIds.includes(lastStepId ?? "");
      const isStreaming = agentRunning && isLast;
      const manualCollapsed = thinkingCollapsedIds[step.id];
      const isCollapsed = manualCollapsed ?? !isStreaming;
      return (
        <ThinkingBlock
          key={step.id}
          id={step.id}
          content={step.content}
          status={step.status}
          startedAt={step.startedAt}
          completedAt={step.completedAt}
          isStreaming={isStreaming}
          isCollapsed={isCollapsed}
          flushVersion={0}
          forceInstant
          onToggleCollapsed={() =>
            setThinkingCollapsedIds((current) => ({
              ...current,
              [step.id]: !isCollapsed,
            }))
          }
        />
      );
    }

    if (step.type === "assistant_message") {
      if (!step.content.trim()) return null;
      return (
        <MiniChatMessage
          key={step.id}
          role="assistant"
          content={step.content}
        />
      );
    }

    if (step.type === "agent_call") {
      const liveChild = childById.get(step.agentCall.id) ?? step.agentCall;
      return (
        <ChildAgentBlock
          key={step.id}
          child={liveChild}
          canSubmitAskUserResponse={canSubmitAskUserResponse}
          onOpenChildAgent={onOpenChildAgent}
        />
      );
    }

    if (step.type === "user_input") {
      const manualCollapsed = collapsedInteractionIds[step.id];
      const isCollapsed = manualCollapsed ?? step.status !== "waiting";
      return (
        <AskUserBlock
          key={step.id}
          id={step.id}
          request={step.request}
          response={step.response}
          status={step.status ?? "waiting"}
          canSubmit={canSubmitAskUserResponse(step.toolCall.id)}
          isCollapsed={isCollapsed}
          onToggleCollapsed={() =>
            setCollapsedInteractionIds((current) => ({
              ...current,
              [step.id]: !isCollapsed,
            }))
          }
          onSubmit={(response) =>
            onSubmitAskUserResponse(step.toolCall, step.request, response)
          }
          onCancel={() => onCancelAskUserRequest(step.toolCall.id)}
          onLayoutChange={onAskUserLayoutChange}
        />
      );
    }

    if (step.type === "tool_execution") {
      const isAskUser = step.toolCall.function.name === ASK_USER_TOOL_NAME;
      if (isAskUser) {
        try {
          const request = parseAskUserRequestFromToolCall(step.toolCall);
          const canSubmit = canSubmitAskUserResponse(step.toolCall.id);
          const status = getAskUserStatus({
            agentStatus: agentCall.status,
            canSubmit,
            toolResult: step.toolResult,
          });
          const manualCollapsed = collapsedInteractionIds[step.id];
          const isCollapsed = manualCollapsed ?? status !== "waiting";
          return (
            <AskUserBlock
              key={step.id}
              id={step.id}
              request={request}
              response={parseAskUserResponseFromToolResult(step.toolResult)}
              status={status}
              canSubmit={canSubmit}
              isCollapsed={isCollapsed}
              onToggleCollapsed={() =>
                setCollapsedInteractionIds((current) => ({
                  ...current,
                  [step.id]: !isCollapsed,
                }))
              }
              onSubmit={(response) =>
                onSubmitAskUserResponse(step.toolCall, request, response)
              }
              onCancel={() => onCancelAskUserRequest(step.toolCall.id)}
              onLayoutChange={onAskUserLayoutChange}
            />
          );
        } catch {
          // Fall through to a normal tool block.
        }
      }

      const manualCollapsed = collapsedInteractionIds[step.id];
      const isCollapsed = manualCollapsed ?? true;
      return renderToolExecutionBlock ? (
        renderToolExecutionBlock({
          id: step.id,
          toolCall: step.toolCall,
          toolResult: step.toolResult,
          status:
            step.status ??
            (step.toolResult
              ? step.toolResult.isError
                ? "failed"
                : "complete"
              : "running"),
          isCollapsed,
          onToggleCollapsed: (stepId, nextCollapsed) =>
            setCollapsedInteractionIds((current) => ({
              ...current,
              [stepId]: nextCollapsed,
            })),
        })
      ) : (
        <FallbackToolCallBlock
          key={step.id}
          toolCall={step.toolCall}
          toolResult={step.toolResult}
        />
      );
    }

    if (step.type === "approval" || step.type === "file_approval") {
      const manualCollapsed = collapsedInteractionIds[step.id];
      const isCollapsed = manualCollapsed ?? step.status !== "waiting";
      // Approval prompts are actioned at the main-chat level; here we show a
      // read-only collapsed tool block reflecting the call for context.
      return renderToolExecutionBlock ? (
        renderToolExecutionBlock({
          id: step.id,
          toolCall: step.toolCall,
          toolResult: step.toolResult,
          status: step.toolResult
            ? step.toolResult.isError
              ? "failed"
              : "complete"
            : "running",
          isCollapsed,
          onToggleCollapsed: (stepId, nextCollapsed) =>
            setCollapsedInteractionIds((current) => ({
              ...current,
              [stepId]: nextCollapsed,
            })),
        })
      ) : (
        <FallbackToolCallBlock key={step.id} toolCall={step.toolCall} />
      );
    }

    if (step.type === "tasks") {
      return renderToolExecutionBlock ? (
        renderToolExecutionBlock({
          id: step.id,
          toolCall: step.toolCall,
          toolResult: step.toolResult,
          status: step.status === "failed" ? "failed" : "complete",
          isCollapsed: collapsedInteractionIds[step.id] ?? false,
          onToggleCollapsed: (stepId, nextCollapsed) =>
            setCollapsedInteractionIds((current) => ({
              ...current,
              [stepId]: nextCollapsed,
            })),
        })
      ) : (
        <FallbackToolCallBlock key={step.id} toolCall={step.toolCall} />
      );
    }

    return null;
  };

  const renderBaseGroup = (
    group: VisibleAssistantProcessStepGroup,
    options?: { insideThinkingToolGroup?: boolean },
  ): ReactNode => {
    if (group.kind === "tool_batch") {
      const insideThinkingToolGroup = Boolean(options?.insideThinkingToolGroup);
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
            {getToolBatchGroupLabel(group)}
          </div>
          <div className="grid gap-2">{group.steps.map(renderStep)}</div>
        </div>
      );
    }

    if (group.kind === "thinking_tool_group") {
      return (
        <div
          key={`${group.thinkingStep.id}:tool-group`}
          className="grid gap-2 border border-dashed bg-muted/10 px-2 py-2 shadow-xs"
        >
          {renderStep(group.thinkingStep)}
          {group.toolGroups.map((toolGroup) =>
            renderBaseGroup(toolGroup, { insideThinkingToolGroup: true }),
          )}
        </div>
      );
    }

    return renderStep(group.step);
  };

  const hasAnyContent = visibleSteps.length > 0;

  return (
    <>
      {groups.map((group) => renderBaseGroup(group))}

      {!hasAnyContent ? (
        <div className="border bg-muted/35 px-3 py-2 text-base text-muted-foreground">
          {agentRunning
            ? "Waiting for agent output..."
            : "No runtime output recorded."}
        </div>
      ) : null}
    </>
  );
}

function ChildAgentBlock({
  child,
  canSubmitAskUserResponse,
  onOpenChildAgent,
}: {
  child: ChatAgentCall;
  onOpenChildAgent: (agentCallId: string) => void;
  canSubmitAskUserResponse: (toolCallId: string) => boolean;
}) {
  const shouldOpenForAskUser = hasPendingAskUser(
    child,
    canSubmitAskUserResponse,
  );

  useEffect(() => {
    if (shouldOpenForAskUser) onOpenChildAgent(child.id);
  }, [child.id, onOpenChildAgent, shouldOpenForAskUser]);

  return (
    <article className="flex min-w-0 max-w-full justify-start">
      <div
        role="button"
        tabIndex={0}
        className="w-full min-w-0 max-w-full cursor-pointer overflow-hidden border bg-muted/25 px-4 py-3 text-base leading-6 text-muted-foreground shadow-xs [overflow-wrap:anywhere] hover:bg-muted/35 focus:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => onOpenChildAgent(child.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenChildAgent(child.id);
          }
        }}
        title="Open agent run"
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              <Bot className="size-3.5 shrink-0" />
              <span className="truncate">{child.agentName}</span>
              <span className="text-muted-foreground/60">·</span>
              <AgentStatusInline status={child.status} />
              {child.model?.trim() ? (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="truncate normal-case tracking-normal text-muted-foreground/85">
                    {child.model.trim()}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7 shrink-0"
            onClick={(event) => {
              event.stopPropagation();
              onOpenChildAgent(child.id);
            }}
            title="Open agent run"
            aria-label="Open agent run"
          >
            <Maximize2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

export const AgentTranscriptDialog = memo(function AgentTranscriptDialog({
  open,
  onOpenChange,
  agentCall,
  renderToolExecutionBlock,
  canSubmitAskUserResponse,
  onSubmitAskUserResponse,
  onCancelAskUserRequest,
  onAskUserLayoutChange,
  modalDepth = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentCall: ChatAgentCall;
  renderToolExecutionBlock?: RenderAgentToolExecutionBlock;
  modalDepth?: number;
} & AgentInteractionProps) {
  const [expandedChildAgentId, setExpandedChildAgentId] = useState<string>();
  const expandedChildAgent = useMemo(
    () =>
      (agentCall.childAgentCalls ?? []).find(
        (child) => child.id === expandedChildAgentId,
      ),
    [agentCall.childAgentCalls, expandedChildAgentId],
  );
  const modalZIndex = 50 + modalDepth * 20;

  useEffect(() => {
    if (!open) setExpandedChildAgentId(undefined);
  }, [open]);

  return (
    <Fragment>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="agent-transcript-dialog flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col overflow-hidden p-0 text-base leading-6"
          overlayStyle={{ zIndex: modalZIndex }}
          style={{ zIndex: modalZIndex + 1 }}
        >
          <AgentModalHeader agentCall={agentCall} />

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-base leading-6 chat-message-scrollbar">
            <AgentTranscriptBody
              agentCall={agentCall}
              renderToolExecutionBlock={renderToolExecutionBlock}
              canSubmitAskUserResponse={canSubmitAskUserResponse}
              onSubmitAskUserResponse={onSubmitAskUserResponse}
              onCancelAskUserRequest={onCancelAskUserRequest}
              onAskUserLayoutChange={onAskUserLayoutChange}
              onOpenChildAgent={setExpandedChildAgentId}
            />
          </div>
        </DialogContent>
      </Dialog>

      {open && expandedChildAgent ? (
        <AgentTranscriptDialog
          open={Boolean(expandedChildAgent)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setExpandedChildAgentId(undefined);
          }}
          agentCall={expandedChildAgent}
          renderToolExecutionBlock={renderToolExecutionBlock}
          canSubmitAskUserResponse={canSubmitAskUserResponse}
          onSubmitAskUserResponse={onSubmitAskUserResponse}
          onCancelAskUserRequest={onCancelAskUserRequest}
          onAskUserLayoutChange={onAskUserLayoutChange}
          modalDepth={modalDepth + 1}
        />
      ) : null}
    </Fragment>
  );
});
