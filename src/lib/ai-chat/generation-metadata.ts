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
  ChatToolCall,
  ProviderConfig,
} from "@/lib/ai-chat/types";
import type { StreamBufferEvent } from "@/lib/ai-chat/stream-buffer";

export type ActiveProcessStepRef = {
  type: "thinking" | "assistant_message" | "tool_execution" | "user_input";
  id?: string;
};

export type ActiveGeneration = {
  controller: AbortController;
  assistantMessageId: string;
  variantId: string;
};

export function keepOnlyLatestChecklistListStep<T extends ChatAssistantProcessStep>(
  processSteps: T[],
): T[] {
  return processSteps;
}

export function cancelUnfinishedChecklistListSteps(
  processSteps: ChatAssistantProcessStep[],
): ChatAssistantProcessStep[] {
  return processSteps;
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

  const processSteps = (variant.processSteps ?? []).map((step) => {
    if (step.type === "assistant_message") {
      const delta = contentDeltasByStepId.get(step.id);
      return delta ? { ...step, content: step.content + delta } : step;
    }

    if (step.type === "thinking") {
      const delta = reasoningDeltasByStepId.get(step.id);
      return delta ? { ...step, content: step.content + delta } : step;
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

  return {
    ...variant,
    status: "done",
    metrics: {
      startedAt:
        variant.metrics?.startedAt ??
        new Date(Date.now() - durationMs).toISOString(),
      ...variant.metrics,
      completedAt: new Date().toISOString(),
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
  const baseProcessSteps = keepOnlyLatestChecklistListStep(
    cancelUnfinishedChecklistListSteps(variant.processSteps ?? []),
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
      completedAt: new Date().toISOString(),
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
  toolCalls,
  toolResults,
}: {
  assistantMessageId: string;
  variantId: string;
  accumulatedContent: string;
  accumulatedReasoning: string;
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
        status: "streaming",
        createdAt: new Date().toISOString(),
        toolCalls,
        toolResults,
      },
    ],
  };
}
