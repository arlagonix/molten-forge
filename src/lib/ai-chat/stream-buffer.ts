import type { MutableRefObject } from "react";

export type StreamBufferEvent =
  | {
      type: "content";
      delta: string;
      assistantMessageStepId: string;
    }
  | {
      type: "reasoning";
      delta: string;
      reasoningStepId: string;
    };

export type StreamBuffer = {
  chatId: string;
  assistantMessageId: string;
  variantId: string;
  events: StreamBufferEvent[];
};

function canMergeStreamBufferEvents(
  previous: StreamBufferEvent | undefined,
  next: StreamBufferEvent,
) {
  if (!previous || previous.type !== next.type) return false;

  if (previous.type === "content" && next.type === "content") {
    return previous.assistantMessageStepId === next.assistantMessageStepId;
  }

  if (previous.type === "reasoning" && next.type === "reasoning") {
    return previous.reasoningStepId === next.reasoningStepId;
  }

  return false;
}

function mergeStreamBufferEvent(
  previous: StreamBufferEvent,
  next: StreamBufferEvent,
): StreamBufferEvent {
  if (previous.type === "content" && next.type === "content") {
    return {
      ...previous,
      delta: previous.delta + next.delta,
    };
  }

  if (previous.type === "reasoning" && next.type === "reasoning") {
    return {
      ...previous,
      delta: previous.delta + next.delta,
    };
  }

  return next;
}

function appendStreamBufferEvent(
  events: StreamBufferEvent[],
  event: StreamBufferEvent,
) {
  const previous = events[events.length - 1];

  if (!canMergeStreamBufferEvents(previous, event)) {
    return [...events, event];
  }

  return [
    ...events.slice(0, -1),
    mergeStreamBufferEvent(previous, event),
  ];
}

export function getStreamBufferKey(
  chatId: string,
  assistantMessageId: string,
  variantId: string,
) {
  return `${chatId}:${assistantMessageId}:${variantId}`;
}

export function flushBufferedAssistantVariant({
  bufferKey,
  streamBuffersRef,
  appendToAssistantVariant,
}: {
  bufferKey: string;
  streamBuffersRef: MutableRefObject<Record<string, StreamBuffer>>;
  appendToAssistantVariant: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    events: StreamBufferEvent[],
  ) => void;
}) {
  const buffered = streamBuffersRef.current[bufferKey];
  if (!buffered || buffered.events.length === 0) return;

  const events = buffered.events;
  streamBuffersRef.current[bufferKey] = {
    ...buffered,
    events: [],
  };

  appendToAssistantVariant(
    buffered.chatId,
    buffered.assistantMessageId,
    buffered.variantId,
    events,
  );
}

export function flushAllBufferedAssistantVariants({
  streamBuffersRef,
  appendToAssistantVariant,
}: {
  streamBuffersRef: MutableRefObject<Record<string, StreamBuffer>>;
  appendToAssistantVariant: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    events: StreamBufferEvent[],
  ) => void;
}) {
  Object.keys(streamBuffersRef.current).forEach((bufferKey) => {
    flushBufferedAssistantVariant({
      bufferKey,
      streamBuffersRef,
      appendToAssistantVariant,
    });
  });
}

export function scheduleBufferedAssistantFlush({
  bufferKey,
  streamBuffersRef,
  streamFlushTimeoutRefs,
  appendToAssistantVariant,
  getDelayMs,
}: {
  bufferKey: string;
  streamBuffersRef: MutableRefObject<Record<string, StreamBuffer>>;
  streamFlushTimeoutRefs: MutableRefObject<Record<string, number>>;
  appendToAssistantVariant: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    events: StreamBufferEvent[],
  ) => void;
  getDelayMs: () => number;
}) {
  if (streamFlushTimeoutRefs.current[bufferKey] !== undefined) return;

  streamFlushTimeoutRefs.current[bufferKey] = window.setTimeout(() => {
    delete streamFlushTimeoutRefs.current[bufferKey];
    flushBufferedAssistantVariant({
      bufferKey,
      streamBuffersRef,
      appendToAssistantVariant,
    });
  }, getDelayMs());
}

export function appendBufferedAssistantVariant({
  chatId,
  assistantMessageId,
  variantId,
  event,
  streamBuffersRef,
  streamFlushTimeoutRefs,
  appendToAssistantVariant,
  getDelayMs,
}: {
  chatId: string;
  assistantMessageId: string;
  variantId: string;
  event: StreamBufferEvent;
  streamBuffersRef: MutableRefObject<Record<string, StreamBuffer>>;
  streamFlushTimeoutRefs: MutableRefObject<Record<string, number>>;
  appendToAssistantVariant: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    events: StreamBufferEvent[],
  ) => void;
  getDelayMs: () => number;
}) {
  const bufferKey = getStreamBufferKey(chatId, assistantMessageId, variantId);
  const buffered = streamBuffersRef.current[bufferKey] ?? {
    chatId,
    assistantMessageId,
    variantId,
    events: [],
  };

  streamBuffersRef.current[bufferKey] = {
    ...buffered,
    events: appendStreamBufferEvent(buffered.events, event),
  };

  scheduleBufferedAssistantFlush({
    bufferKey,
    streamBuffersRef,
    streamFlushTimeoutRefs,
    appendToAssistantVariant,
    getDelayMs,
  });
}

export function clearStreamFlushTimeouts(
  streamFlushTimeoutRefs: MutableRefObject<Record<string, number>>,
) {
  Object.values(streamFlushTimeoutRefs.current).forEach((timeoutId) =>
    window.clearTimeout(timeoutId),
  );
}
