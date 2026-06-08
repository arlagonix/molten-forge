import { memo, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

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

const StreamingPlainTextContent = memo(function StreamingPlainTextContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn("chat-markdown w-full min-w-0 max-w-full", className)}>
      <pre className="m-0 whitespace-pre-wrap break-words font-sans text-inherit [line-height:inherit] [overflow-wrap:anywhere]">{content}</pre>
    </div>
  );
});

const AssistantMessageContent = memo(function AssistantMessageContent({
  content,
  className,
  messageId,
  isStreaming = false,
  skipSyntaxHighlight = false,
}: {
  content: string;
  className?: string;
  messageId?: string;
  isStreaming?: boolean;
  skipSyntaxHighlight?: boolean;
}) {
  if (isStreaming) {
    return <StreamingPlainTextContent content={content} className={className} />;
  }

  return (
    <MarkdownMessage
      content={content}
      className={className}
      messageId={messageId}
      skipSyntaxHighlight={skipSyntaxHighlight}
    />
  );
});

type SmoothAssistantMessageContentProps = {
  content: string;
  className?: string;
  messageId?: string;
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
    flushVersion,
    onVisualProgress,
    onVisualStreamingChange,
    isApiStreaming,
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
      skipSyntaxHighlight || hasUnclosedFencedCodeBlock(content);

    return (
      <AssistantMessageContent
        content={content}
        className={className}
        messageId={messageId}
        isStreaming={isApiStreaming}
        skipSyntaxHighlight={shouldSkipSyntaxHighlight}
      />
    );
  },
  (previous, next) =>
    previous.content === next.content &&
    previous.className === next.className &&
    previous.messageId === next.messageId &&
    previous.isApiStreaming === next.isApiStreaming &&
    previous.flushVersion === next.flushVersion &&
    previous.forceInstant === next.forceInstant &&
    previous.skipSyntaxHighlight === next.skipSyntaxHighlight,
);
