import { memo, useCallback, useEffect, useRef, useState } from "react";

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
  skipSyntaxHighlight = false,
}: {
  content: string;
  className?: string;
  skipSyntaxHighlight?: boolean;
}) {
  return (
    <MarkdownMessage
      content={content}
      className={className}
      skipSyntaxHighlight={skipSyntaxHighlight}
    />
  );
});

function takeSafeVisibleSlice(remaining: string, maxChars: number) {
  if (remaining.length <= maxChars) return remaining;

  const slice = remaining.slice(0, maxChars);
  const boundaries = [
    slice.lastIndexOf("\n"),
    slice.lastIndexOf(" "),
    slice.lastIndexOf("."),
    slice.lastIndexOf(","),
    slice.lastIndexOf(";"),
    slice.lastIndexOf(":"),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
  ];
  const boundary = Math.max(...boundaries);

  if (boundary >= Math.min(12, Math.max(0, maxChars - 1))) {
    return remaining.slice(0, boundary + 1);
  }

  return slice;
}

function takeVisibleWords(
  remaining: string,
  maxWords: number,
  fallbackChars: number,
) {
  let end = 0;
  let words = 0;
  const wordPattern = /\s*\S+\s*/g;
  while (wordPattern.exec(remaining) && words < maxWords) {
    end = wordPattern.lastIndex;
    words += 1;
  }

  return end > 0
    ? remaining.slice(0, end)
    : takeSafeVisibleSlice(remaining, fallbackChars);
}

function getSmoothRevealSlice(remaining: string, isApiStreaming: boolean) {
  if (!remaining) return "";

  if (!isApiStreaming) {
    return takeSafeVisibleSlice(
      remaining,
      Math.max(160, Math.ceil(remaining.length / 10)),
    );
  }

  if (remaining.length < 80) {
    return remaining.slice(0, remaining.length < 24 ? 1 : 2);
  }

  if (remaining.length < 500) {
    return takeVisibleWords(remaining, 2, 32);
  }

  if (remaining.length < 1500) {
    return takeVisibleWords(remaining, 6, 96);
  }

  return takeSafeVisibleSlice(remaining, 220);
}

function useSmoothStreamingText({
  content,
  isApiStreaming,
  flushVersion,
  forceInstant = false,
  onVisualProgress,
  onVisualStreamingChange,
}: {
  content: string;
  isApiStreaming: boolean;
  flushVersion: number;
  forceInstant?: boolean;
  onVisualProgress?: () => void;
  onVisualStreamingChange?: (isVisuallyStreaming: boolean) => void;
}) {
  const [visibleContent, setVisibleContent] = useState(content);
  const visibleContentRef = useRef(content);
  const visualStreamingRef = useRef(false);
  const lastFlushVersionRef = useRef(flushVersion);
  const onVisualProgressRef = useRef(onVisualProgress);
  const onVisualStreamingChangeRef = useRef(onVisualStreamingChange);

  onVisualProgressRef.current = onVisualProgress;
  onVisualStreamingChangeRef.current = onVisualStreamingChange;

  const notifyVisualProgress = useCallback(() => {
    onVisualProgressRef.current?.();
  }, []);

  const setVisualStreaming = useCallback((isVisuallyStreaming: boolean) => {
    if (visualStreamingRef.current === isVisuallyStreaming) return;
    visualStreamingRef.current = isVisuallyStreaming;
    onVisualStreamingChangeRef.current?.(isVisuallyStreaming);
  }, []);

  useEffect(() => {
    if (forceInstant) {
      lastFlushVersionRef.current = flushVersion;
      visibleContentRef.current = content;
      setVisibleContent(content);
      setVisualStreaming(false);
      notifyVisualProgress();
      return;
    }

    if (flushVersion !== lastFlushVersionRef.current) {
      lastFlushVersionRef.current = flushVersion;
      visibleContentRef.current = content;
      setVisibleContent(content);
      setVisualStreaming(false);
      notifyVisualProgress();
      return;
    }

    if (!content.startsWith(visibleContentRef.current)) {
      visibleContentRef.current = content;
      setVisibleContent(content);
      setVisualStreaming(false);
      notifyVisualProgress();
      return;
    }

    setVisualStreaming(visibleContentRef.current.length < content.length);
  }, [
    content,
    flushVersion,
    forceInstant,
    notifyVisualProgress,
    setVisualStreaming,
  ]);

  useEffect(() => {
    if (forceInstant) return;

    let timeoutId: number | undefined;
    let cancelled = false;

    function tick() {
      if (cancelled) return;

      const current = visibleContentRef.current;
      if (current.length >= content.length) {
        setVisualStreaming(false);
        return;
      }

      const remaining = content.slice(current.length);
      const nextSlice = getSmoothRevealSlice(remaining, isApiStreaming);
      if (!nextSlice) {
        setVisualStreaming(false);
        return;
      }

      const nextVisibleContent = current + nextSlice;
      visibleContentRef.current = nextVisibleContent;
      setVisibleContent(nextVisibleContent);
      setVisualStreaming(nextVisibleContent.length < content.length);
      notifyVisualProgress();

      if (nextVisibleContent.length < content.length) {
        timeoutId = window.setTimeout(tick, isApiStreaming ? 22 : 16);
      }
    }

    if (visibleContentRef.current.length < content.length) {
      setVisualStreaming(true);
      timeoutId = window.setTimeout(tick, isApiStreaming ? 24 : 12);
    } else {
      setVisualStreaming(false);
    }

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [
    content,
    forceInstant,
    isApiStreaming,
    notifyVisualProgress,
    setVisualStreaming,
  ]);

  return visibleContent;
}

type SmoothAssistantMessageContentProps = {
  content: string;
  className?: string;
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
    isApiStreaming,
    flushVersion,
    forceInstant = false,
    onVisualProgress,
    onVisualStreamingChange,
    skipSyntaxHighlight = false,
  }: SmoothAssistantMessageContentProps) {
    const visibleContent = useSmoothStreamingText({
      content,
      isApiStreaming,
      flushVersion,
      forceInstant,
      onVisualProgress,
      onVisualStreamingChange,
    });

    const shouldSkipSyntaxHighlight =
      skipSyntaxHighlight && hasUnclosedFencedCodeBlock(visibleContent);

    return (
      <AssistantMessageContent
        content={visibleContent}
        className={className}
        skipSyntaxHighlight={shouldSkipSyntaxHighlight}
      />
    );
  },
  (previous, next) =>
    previous.content === next.content &&
    previous.className === next.className &&
    previous.isApiStreaming === next.isApiStreaming &&
    previous.flushVersion === next.flushVersion &&
    previous.forceInstant === next.forceInstant &&
    previous.skipSyntaxHighlight === next.skipSyntaxHighlight,
);
