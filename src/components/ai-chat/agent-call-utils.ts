import type { ReactNode } from "react";

import type {
  AgentCallStatus,
  ChatToolCall,
  ChatToolResult,
  ToolExecutionStatus,
} from "@/lib/ai-chat/types";

export type RenderAgentToolExecutionBlock = (args: {
  id: string;
  toolCall: ChatToolCall;
  toolResult?: ChatToolResult;
  status?: ToolExecutionStatus;
}) => ReactNode;

export function formatAgentStatus(status: AgentCallStatus) {
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "complete") return "Complete";
  if (status === "pending") return "Waiting";
  return "Running";
}
