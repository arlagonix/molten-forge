import { Bot, CircleAlert, Maximize2 } from "lucide-react";
import { memo, useState } from "react";

import { AgentStatusInline } from "@/components/ai-chat/agent-status-inline";
import { AgentTranscriptDialog } from "@/components/ai-chat/agent-transcript-dialog";
import { Button } from "@/components/ui/button";
import type { RenderAgentToolExecutionBlock } from "@/components/ai-chat/agent-call-utils";
import type { AgentCallStatus, ChatAgentCall } from "@/lib/ai-chat/types";

function getEffectiveStatus(
  agentCall: ChatAgentCall,
  status?: AgentCallStatus,
) {
  return agentCall.status ?? status ?? "running";
}

export const AgentCallBlock = memo(function AgentCallBlock({
  agentCall,
  status,
  renderToolExecutionBlock,
}: {
  id: string;
  agentCall: ChatAgentCall;
  status?: AgentCallStatus;
  renderToolExecutionBlock?: RenderAgentToolExecutionBlock;
}) {
  const [expandedOpen, setExpandedOpen] = useState(false);
  const effectiveStatus = getEffectiveStatus(agentCall, status);
  const description = agentCall.description?.trim() || "No description.";

  return (
    <article className="flex min-w-0 max-w-full justify-start">
      <div className="w-full min-w-0 max-w-full overflow-hidden border bg-muted/25 px-4 py-3 text-sm leading-5 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
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

            <div className="mt-2 text-sm normal-case leading-5 tracking-normal text-muted-foreground/85">
              {description}
            </div>
            {agentCall.error ? (
              <div className="mt-2 flex items-start gap-2 border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-destructive">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{agentCall.error}</span>
              </div>
            ) : null}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => setExpandedOpen(true)}
            title="Expand agent run"
          >
            <Maximize2 className="size-3.5" />
            Expand
          </Button>
        </div>

        <AgentTranscriptDialog
          open={expandedOpen}
          onOpenChange={setExpandedOpen}
          agentCall={agentCall}
          renderToolExecutionBlock={renderToolExecutionBlock}
        />
      </div>
    </article>
  );
});
