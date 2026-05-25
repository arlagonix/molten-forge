import { Bot, CircleAlert, Maximize2 } from "lucide-react";
import { memo, useEffect, useState } from "react";

import type { RenderAgentToolExecutionBlock } from "@/components/ai-chat/agent-call-utils";
import { AgentStatusInline } from "@/components/ai-chat/agent-status-inline";
import { MarkdownMessage } from "@/components/ai-chat/markdown-message";
import { ThinkingBlock } from "@/components/ai-chat/thinking-block";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  ChatAgentCall,
  ChatToolCall,
  ChatToolResult,
  ToolExecutionStatus,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

function getToolStatus(toolResult?: ChatToolResult): ToolExecutionStatus {
  if (!toolResult) return "running";
  return toolResult.isError ? "failed" : "complete";
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
        <MarkdownMessage content={content} className="chat-markdown-compact" />
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
      <div className="w-full min-w-0 max-w-full overflow-hidden border bg-muted/25 px-4 py-3 text-sm leading-5 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
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

function ChildAgentBlock({
  child,
  renderToolExecutionBlock,
}: {
  child: ChatAgentCall;
  renderToolExecutionBlock?: RenderAgentToolExecutionBlock;
}) {
  const [open, setOpen] = useState(false);
  const description = child.description?.trim() || "No description.";

  return (
    <>
      <article className="flex min-w-0 max-w-full justify-start">
        <div className="w-full min-w-0 max-w-full overflow-hidden border bg-muted/25 px-4 py-3 text-sm leading-5 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
          <div className="flex min-w-0 items-start justify-between gap-3">
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
              <div className="mt-2 text-sm normal-case leading-5 tracking-normal text-muted-foreground/85">
                {description}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => setOpen(true)}
            >
              <Maximize2 className="size-3.5" />
              Expand
            </Button>
          </div>
        </div>
      </article>
      <AgentTranscriptDialog
        open={open}
        onOpenChange={setOpen}
        agentCall={child}
        renderToolExecutionBlock={renderToolExecutionBlock}
      />
    </>
  );
}

export const AgentTranscriptDialog = memo(function AgentTranscriptDialog({
  open,
  onOpenChange,
  agentCall,
  renderToolExecutionBlock,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentCall: ChatAgentCall;
  renderToolExecutionBlock?: RenderAgentToolExecutionBlock;
}) {
  const [thinkingCollapsed, setThinkingCollapsed] = useState(
    () => agentCall.status !== "running" && agentCall.status !== "pending",
  );
  const visibleToolCalls = agentCall.toolCalls ?? [];
  const visibleToolResults = agentCall.toolResults ?? [];

  useEffect(() => {
    if (agentCall.status === "running" || agentCall.status === "pending") {
      return;
    }

    setThinkingCollapsed(true);
  }, [agentCall.status]);

  const thinkingStatus =
    agentCall.status === "running" || agentCall.status === "pending"
      ? "in_progress"
      : "complete";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] max-w-4xl flex-col overflow-hidden p-0 text-base leading-6">
        <AgentModalHeader agentCall={agentCall} />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 chat-message-scrollbar">
          <div className="grid gap-4">
            {agentCall.error ? (
              <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span>{agentCall.error}</span>
              </div>
            ) : null}

            <MiniChatMessage role="user" content={agentCall.task} />

            {agentCall.reasoning?.trim() ? (
              <ThinkingBlock
                id={`${agentCall.id}:thinking`}
                content={agentCall.reasoning}
                status={thinkingStatus}
                startedAt={agentCall.startedAt}
                completedAt={agentCall.completedAt}
                isStreaming={agentCall.status === "running"}
                isCollapsed={thinkingCollapsed}
                flushVersion={0}
                forceInstant
                onToggleCollapsed={() =>
                  setThinkingCollapsed((value) => !value)
                }
              />
            ) : null}

            {visibleToolCalls.map((toolCall) => {
              const toolResult = visibleToolResults.find(
                (result) => result.toolCallId === toolCall.id,
              );

              return renderToolExecutionBlock ? (
                renderToolExecutionBlock({
                  id: `${agentCall.id}:${toolCall.id}`,
                  toolCall,
                  toolResult,
                  status: getToolStatus(toolResult),
                })
              ) : (
                <FallbackToolCallBlock
                  key={toolCall.id}
                  toolCall={toolCall}
                  toolResult={toolResult}
                />
              );
            })}

            {(agentCall.childAgentCalls ?? []).map((child) => (
              <ChildAgentBlock
                key={child.id}
                child={child}
                renderToolExecutionBlock={renderToolExecutionBlock}
              />
            ))}

            <MiniChatMessage role="assistant" content={agentCall.output} />

            {!agentCall.output.trim() &&
            !agentCall.reasoning?.trim() &&
            visibleToolCalls.length === 0 &&
            (agentCall.childAgentCalls ?? []).length === 0 ? (
              <div className="border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                {agentCall.status === "running" ||
                agentCall.status === "pending"
                  ? "Waiting for agent output..."
                  : "No runtime output recorded."}
              </div>
            ) : null}
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
});
