import { Bot, Maximize2 } from "lucide-react";
import { memo, useEffect, useState } from "react";

import type { RenderAgentToolExecutionBlock } from "@/components/ai-chat/agent-call-utils";
import { AgentStatusInline } from "@/components/ai-chat/agent-status-inline";
import { AgentTranscriptDialog } from "@/components/ai-chat/agent-transcript-dialog";
import { Button } from "@/components/ui/button";
import { ASK_USER_TOOL_NAME } from "@/lib/ai-chat/builtin-tools";
import type {
  AgentCallStatus,
  AskUserRequest,
  AskUserResponse,
  ChatAgentCall,
  ChatToolCall,
} from "@/lib/ai-chat/types";

function getEffectiveStatus(
  agentCall: ChatAgentCall,
  status?: AgentCallStatus,
) {
  return agentCall.status ?? status ?? "running";
}

function hasPendingAskUser(
  agentCall: ChatAgentCall,
  canSubmitAskUserResponse: (toolCallId: string) => boolean,
): boolean {
  const hasLocalPending = (agentCall.toolCalls ?? []).some(
    (toolCall) =>
      toolCall.function.name === ASK_USER_TOOL_NAME &&
      canSubmitAskUserResponse(toolCall.id),
  );

  if (hasLocalPending) return true;

  return (agentCall.childAgentCalls ?? []).some((child) =>
    hasPendingAskUser(child, canSubmitAskUserResponse),
  );
}

export const AgentCallBlock = memo(function AgentCallBlock({
  agentCall,
  status,
  renderToolExecutionBlock,
  canSubmitAskUserResponse,
  onSubmitAskUserResponse,
  onCancelAskUserRequest,
  onAskUserLayoutChange,
}: {
  id: string;
  agentCall: ChatAgentCall;
  status?: AgentCallStatus;
  renderToolExecutionBlock?: RenderAgentToolExecutionBlock;
  canSubmitAskUserResponse: (toolCallId: string) => boolean;
  onSubmitAskUserResponse: (
    toolCall: ChatToolCall,
    request: AskUserRequest,
    response: AskUserResponse,
  ) => void | Promise<void>;
  onCancelAskUserRequest: (toolCallId: string) => void;
  onAskUserLayoutChange?: () => void;
}) {
  const [expandedOpen, setExpandedOpen] = useState(false);
  const effectiveStatus = getEffectiveStatus(agentCall, status);
  const shouldOpenForAskUser = hasPendingAskUser(
    agentCall,
    canSubmitAskUserResponse,
  );

  useEffect(() => {
    if (shouldOpenForAskUser) setExpandedOpen(true);
  }, [shouldOpenForAskUser]);

  return (
    <article className="flex min-w-0 max-w-full justify-start">
      <div
        role="button"
        tabIndex={0}
        className="w-full min-w-0 max-w-full cursor-pointer overflow-hidden border bg-muted/25 px-4 py-3 text-sm leading-none  text-muted-foreground shadow-xs [overflow-wrap:anywhere] hover:bg-muted/35 focus:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => setExpandedOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setExpandedOpen(true);
          }
        }}
        title="Open agent run"
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 overflow-hidden text-sm font-medium uppercase tracking-wide text-muted-foreground">
              <Bot className="size-3.5 shrink-0" />
              <span className="truncate">{agentCall.agentName}</span>
              <span className="text-muted-foreground/60">·</span>
              <AgentStatusInline status={effectiveStatus} />
              {agentCall.model?.trim() ? (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="truncate normal-case tracking-normal text-muted-foreground/85">
                    {agentCall.model.trim()}
                  </span>
                </>
              ) : null}
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-4 w-4 shrink-0"
            onClick={(event) => {
              event.stopPropagation();
              setExpandedOpen(true);
            }}
            title="Open agent run"
            aria-label="Open agent run"
          >
            <Maximize2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <AgentTranscriptDialog
        open={expandedOpen}
        onOpenChange={setExpandedOpen}
        agentCall={agentCall}
        renderToolExecutionBlock={renderToolExecutionBlock}
        canSubmitAskUserResponse={canSubmitAskUserResponse}
        onSubmitAskUserResponse={onSubmitAskUserResponse}
        onCancelAskUserRequest={onCancelAskUserRequest}
        onAskUserLayoutChange={onAskUserLayoutChange}
      />
    </article>
  );
});
