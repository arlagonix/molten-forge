import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
  WheelEvent as ReactWheelEvent,
} from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const CHAT_BOTTOM_THRESHOLD_PX = 32;
const SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX = 1000;
const STICKY_SCROLL_SUPPRESSION_MS = 1000;
const STICKY_SCROLL_SETTLE_FRAMES = 5;
const FORCED_SCROLL_SETTLE_FRAMES = 8;

export function useChatAutoscroll({
  activeChatId,
  generatingChatIds,
  messages,
  closeMessageContextMenu,
  setVisualStreamingMessageIds,
}: {
  activeChatId?: string;
  generatingChatIds: string[];
  messages: unknown[];
  closeMessageContextMenu: () => void;
  setVisualStreamingMessageIds: Dispatch<SetStateAction<string[]>>;
}) {
  const [isNearChatBottom, setIsNearChatBottom] = useState(true);
  const [showScrollToBottomButton, setShowScrollToBottomButton] =
    useState(false);
  const [isChatScrollable, setIsChatScrollable] = useState(false);
  const [, setAutoScrollEnabled] = useState(true);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatContentRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const pendingChatBottomScrollRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const stickyScrollFrameRef = useRef<number | null>(null);
  const stickyScrollSettleFramesRef = useRef(0);
  const stickyScrollForceRef = useRef(false);
  const autoScrollResetTimeoutRef = useRef<number | null>(null);
  const manualScrollSuppressionTimeoutRef = useRef<number | null>(null);
  const isAutoScrollingRef = useRef(false);
  const manualScrollSuppressedUntilRef = useRef(0);
  const lastChatScrollTopRef = useRef(0);
  const manualScrollInputUntilRef = useRef(0);
  const isChatScrollableRef = useRef(false);
  const autoScrollEnabledRef = useRef(true);

  function getChatDistanceFromBottom() {
    const scrollElement = chatScrollRef.current;
    if (!scrollElement) return 0;

    return Math.max(
      0,
      scrollElement.scrollHeight -
        scrollElement.scrollTop -
        scrollElement.clientHeight,
    );
  }

  function canChatScroll() {
    const scrollElement = chatScrollRef.current;
    if (!scrollElement) return false;

    return scrollElement.scrollHeight > scrollElement.clientHeight + 1;
  }

  function syncChatScrollableState() {
    const nextIsScrollable = canChatScroll();
    isChatScrollableRef.current = nextIsScrollable;
    setIsChatScrollable((currentIsScrollable) =>
      currentIsScrollable === nextIsScrollable
        ? currentIsScrollable
        : nextIsScrollable,
    );
    return nextIsScrollable;
  }

  function setChatAutoScrollEnabled(enabled: boolean) {
    autoScrollEnabledRef.current = enabled;
    setAutoScrollEnabled((currentEnabled) =>
      currentEnabled === enabled ? currentEnabled : enabled,
    );
  }

  function isStickyScrollSuppressed() {
    return Date.now() < manualScrollSuppressedUntilRef.current;
  }

  function isChatNearBottom(threshold = CHAT_BOTTOM_THRESHOLD_PX) {
    if (!canChatScroll()) return true;
    return getChatDistanceFromBottom() <= threshold;
  }

  function clearStickyScrollSuppression() {
    manualScrollSuppressedUntilRef.current = 0;

    if (manualScrollSuppressionTimeoutRef.current !== null) {
      window.clearTimeout(manualScrollSuppressionTimeoutRef.current);
      manualScrollSuppressionTimeoutRef.current = null;
    }
  }

  function suppressStickyScroll() {
    manualScrollSuppressedUntilRef.current =
      Date.now() + STICKY_SCROLL_SUPPRESSION_MS;
    setChatAutoScrollEnabled(false);

    if (manualScrollSuppressionTimeoutRef.current !== null) {
      window.clearTimeout(manualScrollSuppressionTimeoutRef.current);
    }

    manualScrollSuppressionTimeoutRef.current = window.setTimeout(() => {
      manualScrollSuppressionTimeoutRef.current = null;

      if (!isChatNearBottom(CHAT_BOTTOM_THRESHOLD_PX)) return;

      setChatAutoScrollEnabled(true);
      scheduleStickyScrollToBottom();
    }, STICKY_SCROLL_SUPPRESSION_MS);
  }

  function markManualScrollInput(durationMs = 200) {
    manualScrollInputUntilRef.current = Date.now() + durationMs;
  }

  function hasRecentManualScrollInput() {
    return Date.now() < manualScrollInputUntilRef.current;
  }

  function isActiveChatGenerating() {
    return Boolean(activeChatId && generatingChatIds.includes(activeChatId));
  }

  function getStickyScrollSettleFrames() {
    return isActiveChatGenerating() ? STICKY_SCROLL_SETTLE_FRAMES : 1;
  }

  function requestChatBottomScrollAfterRender() {
    pendingChatBottomScrollRef.current = true;
  }

  function markProgrammaticChatScroll(durationMs = 80) {
    isAutoScrollingRef.current = true;

    if (autoScrollResetTimeoutRef.current !== null) {
      window.clearTimeout(autoScrollResetTimeoutRef.current);
    }

    autoScrollResetTimeoutRef.current = window.setTimeout(() => {
      autoScrollResetTimeoutRef.current = null;
      isAutoScrollingRef.current = false;
    }, durationMs);
  }

  function scrollToBottomInstant() {
    const scrollElement = chatScrollRef.current;
    if (!scrollElement) return;

    const nextScrollTop = Math.max(
      0,
      scrollElement.scrollHeight - scrollElement.clientHeight,
    );

    markProgrammaticChatScroll();
    scrollElement.scrollTop = nextScrollTop;
    chatBottomRef.current?.scrollIntoView({ block: "end" });

    const finalScrollTop = Math.max(
      0,
      scrollElement.scrollHeight - scrollElement.clientHeight,
    );
    scrollElement.scrollTop = finalScrollTop;
    lastChatScrollTopRef.current = finalScrollTop;
  }

  function syncChatScrollState() {
    syncChatScrollableState();

    const distanceFromBottom = getChatDistanceFromBottom();
    const isNearBottom =
      !canChatScroll() || distanceFromBottom <= CHAT_BOTTOM_THRESHOLD_PX;

    setIsNearChatBottom(isNearBottom);
    setShowScrollToBottomButton(
      canChatScroll() &&
        distanceFromBottom > SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX,
    );

    return { distanceFromBottom, isNearBottom };
  }

  function scheduleStickyScrollToBottom({
    force = false,
    settleFrames,
  }: { force?: boolean; settleFrames?: number } = {}) {
    if (!force) {
      if (!autoScrollEnabledRef.current) return;
      if (isStickyScrollSuppressed()) return;
    }

    stickyScrollForceRef.current = stickyScrollForceRef.current || force;
    stickyScrollSettleFramesRef.current = Math.max(
      stickyScrollSettleFramesRef.current,
      Math.max(1, settleFrames ?? getStickyScrollSettleFrames()),
    );

    if (stickyScrollFrameRef.current !== null) return;

    const runStickyScrollFrame = () => {
      stickyScrollFrameRef.current = null;

      const shouldForce = stickyScrollForceRef.current;

      if (!shouldForce) {
        if (!autoScrollEnabledRef.current) {
          stickyScrollSettleFramesRef.current = 0;
          return;
        }

        if (isStickyScrollSuppressed()) {
          stickyScrollSettleFramesRef.current = 0;
          return;
        }
      }

      scrollToBottomInstant();
      syncChatScrollableState();
      setIsNearChatBottom(true);
      setShowScrollToBottomButton(false);

      stickyScrollSettleFramesRef.current = Math.max(
        0,
        stickyScrollSettleFramesRef.current - 1,
      );

      if (stickyScrollSettleFramesRef.current > 0) {
        stickyScrollFrameRef.current =
          window.requestAnimationFrame(runStickyScrollFrame);
        return;
      }

      stickyScrollForceRef.current = false;
    };

    stickyScrollFrameRef.current =
      window.requestAnimationFrame(runStickyScrollFrame);
  }

  function resetChatScrollState() {
    clearStickyScrollSuppression();
    setChatAutoScrollEnabled(true);
    setIsNearChatBottom(true);
    setShowScrollToBottomButton(false);
  }

  function armStickyScrollToBottom() {
    resetChatScrollState();
    markProgrammaticChatScroll(500);
    requestChatBottomScrollAfterRender();
    scheduleStickyScrollToBottom({
      force: true,
      settleFrames: FORCED_SCROLL_SETTLE_FRAMES,
    });
  }

  const handleAssistantVisualProgress = useCallback(
    (chatId: string) => {
      if (chatId !== activeChatId) return;

      if (autoScrollEnabledRef.current && !isStickyScrollSuppressed()) {
        scheduleStickyScrollToBottom();
        return;
      }

      syncChatScrollState();
    },
    [activeChatId, generatingChatIds],
  );

  const handleAssistantVisualStreamingChange = useCallback(
    (messageId: string, isVisuallyStreaming: boolean) => {
      setVisualStreamingMessageIds((currentMessageIds) => {
        const hasMessageId = currentMessageIds.includes(messageId);

        if (isVisuallyStreaming) {
          return hasMessageId
            ? currentMessageIds
            : [...currentMessageIds, messageId];
        }

        return hasMessageId
          ? currentMessageIds.filter(
              (currentMessageId) => currentMessageId !== messageId,
            )
          : currentMessageIds;
      });

      if (
        activeChatId &&
        autoScrollEnabledRef.current &&
        !isStickyScrollSuppressed()
      ) {
        scheduleStickyScrollToBottom({
          settleFrames: isActiveChatGenerating()
            ? STICKY_SCROLL_SETTLE_FRAMES
            : 1,
        });
      }
    },
    [activeChatId, generatingChatIds, setVisualStreamingMessageIds],
  );

  const handleAskUserLayoutChange = useCallback(() => {
    if (
      isActiveChatGenerating() &&
      autoScrollEnabledRef.current &&
      !isStickyScrollSuppressed()
    ) {
      scheduleStickyScrollToBottom({ settleFrames: 2 });
      return;
    }

    syncChatScrollState();
  }, [activeChatId, generatingChatIds]);

  useLayoutEffect(() => {
    syncChatScrollableState();

    if (pendingChatBottomScrollRef.current) {
      pendingChatBottomScrollRef.current = false;
      scheduleStickyScrollToBottom({ force: true });
      return;
    }

    if (autoScrollEnabledRef.current && !isStickyScrollSuppressed()) {
      scheduleStickyScrollToBottom();
      return;
    }

    syncChatScrollState();
  }, [messages]);

  useLayoutEffect(() => {
    const scrollElement = chatScrollRef.current;
    const contentElement = chatContentRef.current;
    if (!scrollElement) return;

    function handleResize() {
      if (
        isActiveChatGenerating() &&
        autoScrollEnabledRef.current &&
        !isStickyScrollSuppressed()
      ) {
        scheduleStickyScrollToBottom({
          settleFrames: STICKY_SCROLL_SETTLE_FRAMES,
        });
        return;
      }

      syncChatScrollState();
    }

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(scrollElement);
    if (contentElement) {
      resizeObserver.observe(contentElement);
    }

    handleResize();

    return () => {
      resizeObserver.disconnect();
    };
  }, [activeChatId, messages.length]);

  useEffect(() => {
    if (!activeChatId) return;
    if (!generatingChatIds.includes(activeChatId)) return;
    if (!autoScrollEnabledRef.current) return;
    if (isStickyScrollSuppressed()) return;

    scheduleStickyScrollToBottom();
  }, [activeChatId, generatingChatIds, messages]);

  useEffect(() => {
    if (!activeChatId) return;

    if (autoScrollEnabledRef.current && !isStickyScrollSuppressed()) {
      scheduleStickyScrollToBottom({
        settleFrames: isActiveChatGenerating()
          ? STICKY_SCROLL_SETTLE_FRAMES
          : 2,
      });
      return;
    }

    syncChatScrollState();
  }, [activeChatId, generatingChatIds]);

  useEffect(() => {
    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (isTypingTarget) return;

      if (
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home"
      ) {
        markManualScrollInput(1000);
        suppressStickyScroll();
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown, {
      capture: true,
    });

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, {
        capture: true,
      });
    };
  }, []);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      if (stickyScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(stickyScrollFrameRef.current);
      }
      if (autoScrollResetTimeoutRef.current !== null) {
        window.clearTimeout(autoScrollResetTimeoutRef.current);
      }
      if (manualScrollSuppressionTimeoutRef.current !== null) {
        window.clearTimeout(manualScrollSuppressionTimeoutRef.current);
      }
    };
  }, []);

  function scrollChatToBottom() {
    armStickyScrollToBottom();
  }

  function handleChatScroll() {
    closeMessageContextMenu();

    if (scrollFrameRef.current !== null) return;

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const scrollElement = chatScrollRef.current;
      if (!scrollElement) return;

      const previousScrollTop = lastChatScrollTopRef.current;
      const currentScrollTop = scrollElement.scrollTop;
      lastChatScrollTopRef.current = currentScrollTop;

      const { isNearBottom } = syncChatScrollState();

      if (!isAutoScrollingRef.current) {
        if (
          currentScrollTop < previousScrollTop &&
          hasRecentManualScrollInput()
        ) {
          suppressStickyScroll();
          return;
        }

        if (isNearBottom && !isStickyScrollSuppressed()) {
          setChatAutoScrollEnabled(true);
        } else if (!isNearBottom && hasRecentManualScrollInput()) {
          setChatAutoScrollEnabled(false);
        } else if (
          !isNearBottom &&
          isActiveChatGenerating() &&
          autoScrollEnabledRef.current &&
          !isStickyScrollSuppressed()
        ) {
          scheduleStickyScrollToBottom();
        } else if (!isNearBottom && !isActiveChatGenerating()) {
          setChatAutoScrollEnabled(false);
        }
      }
    });
  }

  function handleChatWheel(event: ReactWheelEvent<HTMLDivElement>) {
    closeMessageContextMenu();
    markManualScrollInput();

    if (event.deltaY < 0) {
      suppressStickyScroll();
    }
  }

  function handleChatPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    const scrollElement = chatScrollRef.current;

    if (scrollElement) {
      const rect = scrollElement.getBoundingClientRect();
      const scrollbarGutterWidth =
        scrollElement.offsetWidth - scrollElement.clientWidth;

      if (
        scrollbarGutterWidth > 0 &&
        event.clientX >= rect.right - scrollbarGutterWidth - 2
      ) {
        markManualScrollInput(1000);
      }
    }

    if (!target?.closest("[data-message-context-menu]")) {
      closeMessageContextMenu();
    }
  }

  return {
    chatScrollRef,
    chatContentRef,
    chatBottomRef,
    autoScrollEnabledRef,
    isNearChatBottom,
    showScrollToBottomButton,
    isChatScrollable,
    clearStickyScrollSuppression,
    setChatAutoScrollEnabled,
    resetChatScrollState,
    armStickyScrollToBottom,
    scheduleStickyScrollToBottom,
    isStickyScrollSuppressed,
    syncChatScrollState,
    scrollChatToBottom,
    handleChatScroll,
    handleChatWheel,
    handleChatPointerDown,
    handleAssistantVisualProgress,
    handleAssistantVisualStreamingChange,
    handleAskUserLayoutChange,
  };
}
