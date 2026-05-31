import { memo, useEffect, useRef } from "react";

import { MarkdownMessage } from "./markdown-message";

const FENCED_CODE_BLOCK_PATTERN = /(^|\n) {0,3}(```+|~~~+)/g;

function hasUnclosedFencedCodeBlock(content: string) {
  FENCED_CODE_BLOCK_PATTERN.lastIndex = 0;

  let hasUnclosedFence = false;
  while (FENCED_CODE_BLOCK_PATTERN.exec(content)) {
    hasUnclosedFence = !hasUnclosedFence;
  }

  return hasUnclosedFence;
}

const AssistantMessageContent = memo(function AssistantMessageContent({
  content,
  className,
  messageId,
  chatId,
  skipSyntaxHighlight = false,
}: {
  content: string;
  className?: string;
  messageId?: string;
  chatId?: string;
  skipSyntaxHighlight?: boolean;
}) {
  return (
    <MarkdownMessage
      content={content}
      className={className}
      messageId={messageId}
      chatId={chatId}
      skipSyntaxHighlight={skipSyntaxHighlight}
    />
  );
});

type SmoothAssistantMessageContentProps = {
  content: string;
  className?: string;
  messageId?: string;
  chatId?: string;
  isApiStreaming: boolean;
  flushVersion: number;
  forceInstant?: boolean;
  onVisualProgress?: () => void;
  onVisualStreamingChange?: (isVisuallyStreaming: boolean) => void;
  skipSyntaxHighlight?: boolean;
};

export const SmoothAssistantMessageContent = memo(
  function SmoothAssistantMessageContent({
    content,
    className,
    messageId,
    chatId,
    flushVersion,
    onVisualProgress,
    onVisualStreamingChange,
    skipSyntaxHighlight = false,
  }: SmoothAssistantMessageContentProps) {
    const onVisualProgressRef = useRef(onVisualProgress);
    const onVisualStreamingChangeRef = useRef(onVisualStreamingChange);

    onVisualProgressRef.current = onVisualProgress;
    onVisualStreamingChangeRef.current = onVisualStreamingChange;

    useEffect(() => {
      onVisualProgressRef.current?.();
      onVisualStreamingChangeRef.current?.(false);
    }, [content, flushVersion]);

    const shouldSkipSyntaxHighlight =
      skipSyntaxHighlight && hasUnclosedFencedCodeBlock(content);

    return (
      <AssistantMessageContent
        content={content}
        className={className}
        messageId={messageId}
        chatId={chatId}
        skipSyntaxHighlight={shouldSkipSyntaxHighlight}
      />
    );
  },
  (previous, next) =>
    previous.content === next.content &&
    previous.className === next.className &&
    previous.messageId === next.messageId &&
    previous.chatId === next.chatId &&
    previous.isApiStreaming === next.isApiStreaming &&
    previous.flushVersion === next.flushVersion &&
    previous.forceInstant === next.forceInstant &&
    previous.skipSyntaxHighlight === next.skipSyntaxHighlight,
);
