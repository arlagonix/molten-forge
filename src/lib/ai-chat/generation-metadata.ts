import {
  buildTokenMetrics,
  createId,
  getActiveVariant,
} from "@/lib/ai-chat/chat-utils";
import type { StreamProviderChatResult } from "@/lib/ai-chat/direct-provider-client";
import type {
  ChatAssistantProcessStep,
  ChatAssistantVariant,
  ChatMessage,
  ChatReasoningMetadata,
  ChatToolCall,
  ProviderConfig,
} from "@/lib/ai-chat/types";
import type { StreamBufferEvent } from "@/lib/ai-chat/stream-buffer";

export type ActiveProcessStepRef = {
  type:
    | "thinking"
    | "assistant_message"
    | "tool_building"
    | "tool_execution"
    | "user_input";
  id?: string;
};

export type ActiveGeneration = {
  controller: AbortController;
  assistantMessageId: string;
  variantId: string;
};

export function keepOnlyLatestTaskListStep<T extends ChatAssistantProcessStep>(
  processSteps: T[],
): T[] {
  return processSteps;
}

export function cancelUnfinishedTaskListSteps(
  processSteps: ChatAssistantProcessStep[],
): ChatAssistantProcessStep[] {
  return processSteps.map((step) => {
    if (step.type === "tool_execution") {
      if (step.status === "complete" || step.status === "failed") return step;
      return { ...step, status: "failed" };
    }

    if (step.type === "user_input" || step.type === "approval" || step.type === "file_approval") {
      if (step.status === "complete" || step.status === "failed" || step.status === "cancelled") {
        return step;
      }
      return { ...step, status: "cancelled" };
    }

    if (step.type === "agent_call") {
      if (step.status === "complete" || step.status === "failed" || step.status === "cancelled") {
        return step;
      }
      return {
        ...step,
        status: "cancelled",
        agentCall: {
          ...step.agentCall,
          status: "cancelled",
          completedAt: step.agentCall.completedAt ?? new Date().toISOString(),
          error: step.agentCall.error ?? "Agent call cancelled.",
        },
      };
    }

    if (step.type === "tasks") {
      if (step.status === "complete" || step.status === "failed") return step;
      return { ...step, status: "failed" };
    }

    return step;
  });
}

function completeThinkingProcessSteps(
  processSteps: ChatAssistantProcessStep[],
  completedAt = new Date().toISOString(),
): ChatAssistantProcessStep[] {
  const nextSteps: ChatAssistantProcessStep[] = [];

  for (const step of processSteps) {
    if (step.type === "tool_building") continue;

    if (step.type !== "thinking" || step.status === "complete") {
      nextSteps.push(step);
      continue;
    }

    nextSteps.push({
      ...step,
      status: "complete",
      startedAt: step.startedAt ?? completedAt,
      completedAt: step.completedAt ?? completedAt,
    });
  }

  return nextSteps;
}

export function appendStreamEventsToAssistantVariant(
  variant: ChatAssistantVariant,
  events: StreamBufferEvent[],
): ChatAssistantVariant {
  let contentDelta = "";
  let reasoningDelta = "";
  const contentDeltasByStepId = new Map<string, string>();
  const reasoningDeltasByStepId = new Map<string, string>();

  for (const event of events) {
    if (event.type === "content") {
      contentDelta += event.delta;
      contentDeltasByStepId.set(
        event.assistantMessageStepId,
        `${contentDeltasByStepId.get(event.assistantMessageStepId) ?? ""}${event.delta}`,
      );
    } else {
      reasoningDelta += event.delta;
      reasoningDeltasByStepId.set(
        event.reasoningStepId,
        `${reasoningDeltasByStepId.get(event.reasoningStepId) ?? ""}${event.delta}`,
      );
    }
  }

  const now = new Date().toISOString();
  const processSteps = (variant.processSteps ?? []).map((step) => {
    if (step.type === "assistant_message") {
      const delta = contentDeltasByStepId.get(step.id);
      return delta ? { ...step, content: step.content + delta } : step;
    }

    if (step.type === "thinking") {
      const delta = reasoningDeltasByStepId.get(step.id);
      if (!delta) return step;

      const hasVisibleDelta = delta.trim().length > 0;

      if (step.status === "complete") {
        return {
          ...step,
          content: step.content + delta,
        };
      }

      return {
        ...step,
        content: step.content + delta,
        status: hasVisibleDelta ? "in_progress" : (step.status ?? "waiting"),
        startedAt: hasVisibleDelta ? (step.startedAt ?? now) : step.startedAt,
      };
    }

    return step;
  });

  return {
    ...variant,
    content: contentDelta ? variant.content + contentDelta : variant.content,
    reasoning: reasoningDelta
      ? `${variant.reasoning ?? ""}${reasoningDelta}`
      : variant.reasoning,
    processSteps,
  };
}

export function createStreamingAssistantMessage({
  assistantMessageId,
  variantId,
  responseStartedAt,
}: {
  assistantMessageId: string;
  variantId: string;
  responseStartedAt: string;
}): ChatMessage {
  return {
    id: assistantMessageId,
    role: "assistant",
    variants: [
      {
        id: variantId,
        content: "",
        reasoning: "",
        status: "streaming",
        createdAt: responseStartedAt,
        metrics: {
          startedAt: responseStartedAt,
        },
        processSteps: [],
      },
    ],
    activeVariantIndex: 0,
    createdAt: responseStartedAt,
  };
}

export function createStreamingAssistantVariant({
  variantId,
  responseStartedAt,
}: {
  variantId: string;
  responseStartedAt: string;
}): ChatAssistantVariant {
  return {
    id: variantId,
    content: "",
    reasoning: "",
    status: "streaming",
    createdAt: responseStartedAt,
    metrics: {
      startedAt: responseStartedAt,
    },
    processSteps: [],
  };
}

export function getVisualFlushKeysForGeneration({
  chatMessages,
  assistantMessageId,
}: {
  chatMessages: ChatMessage[];
  assistantMessageId: string;
}) {
  const assistantMessage = chatMessages.find(
    (message): message is Extract<ChatMessage, { role: "assistant" }> =>
      message.id === assistantMessageId && message.role === "assistant",
  );
  const activeVariant = assistantMessage ? getActiveVariant(assistantMessage) : undefined;

  return [
    assistantMessageId,
    ...(activeVariant?.processSteps ?? []).map(
      (step) => `${assistantMessageId}:${step.id}`,
    ),
  ];
}

export function markAssistantVariantDone({
  variant,
  responseStartedAtMs,
  provider,
  streamResult,
}: {
  variant: ChatAssistantVariant;
  responseStartedAtMs: number;
  provider: ProviderConfig;
  streamResult: Partial<StreamProviderChatResult>;
}): ChatAssistantVariant {
  const durationMs = Math.max(1, performance.now() - responseStartedAtMs);
  const completedAt = new Date().toISOString();

  return {
    ...variant,
    status: "done",
    processSteps: completeThinkingProcessSteps(
      variant.processSteps ?? [],
      completedAt,
    ),
    metrics: {
      startedAt:
        variant.metrics?.startedAt ??
        new Date(Date.now() - durationMs).toISOString(),
      ...variant.metrics,
      completedAt,
      ...buildTokenMetrics({
        content: variant.content,
        durationMs,
        usage: streamResult.usage,
        provider,
        finishReason: streamResult.finishReason,
      }),
    },
  };
}

export function markAssistantVariantErrored({
  variant,
  errorLabel,
  wasAborted,
  responseStartedAtMs,
  provider,
}: {
  variant: ChatAssistantVariant;
  errorLabel: string;
  wasAborted: boolean;
  responseStartedAtMs: number;
  provider: ProviderConfig;
}): ChatAssistantVariant {
  const durationMs = Math.max(1, performance.now() - responseStartedAtMs);
  const currentContent = variant.content.trim();
  const appendedContent = wasAborted
    ? variant.content
      ? ""
      : "Generation stopped."
    : currentContent
      ? `\n\nError: ${errorLabel}`
      : `Error: ${errorLabel}`;
  const content = `${variant.content}${appendedContent}`;
  const completedAt = new Date().toISOString();
  const baseProcessSteps = completeThinkingProcessSteps(
    keepOnlyLatestTaskListStep(
      cancelUnfinishedTaskListSteps(variant.processSteps ?? []),
    ),
    completedAt,
  );
  const processSteps = appendedContent.trim()
    ? [
        ...baseProcessSteps,
        {
          id: createId(),
          type: "assistant_message" as const,
          content: appendedContent,
        },
      ]
    : baseProcessSteps;

  return {
    ...variant,
    status: wasAborted ? "done" : "error",
    content,
    processSteps,
    metrics: {
      startedAt:
        variant.metrics?.startedAt ??
        new Date(Date.now() - durationMs).toISOString(),
      ...variant.metrics,
      completedAt,
      ...buildTokenMetrics({
        content,
        durationMs,
        provider,
      }),
    },
  };
}

export function createContinuationAssistantMessage({
  assistantMessageId,
  variantId,
  accumulatedContent,
  accumulatedReasoning,
  accumulatedReasoningMetadata,
  toolCalls,
  toolResults,
}: {
  assistantMessageId: string;
  variantId: string;
  accumulatedContent: string;
  accumulatedReasoning: string;
  accumulatedReasoningMetadata?: ChatReasoningMetadata;
  toolCalls: ChatToolCall[];
  toolResults: ChatAssistantVariant["toolResults"];
}): Extract<ChatMessage, { role: "assistant" }> {
  return {
    id: assistantMessageId,
    role: "assistant",
    activeVariantIndex: 0,
    createdAt: new Date().toISOString(),
    variants: [
      {
        id: variantId,
        content: accumulatedContent,
        reasoning: accumulatedReasoning,
        reasoningMetadata: accumulatedReasoningMetadata,
        status: "streaming",
        createdAt: new Date().toISOString(),
        toolCalls,
        toolResults,
      },
    ],
  };
}
