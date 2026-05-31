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
const CHAT_SCROLL_SNAPSHOTS_STORAGE_KEY = "chat-forge-chat-scroll-snapshots";
const CHAT_SCROLL_SNAPSHOT_PERSIST_DEBOUNCE_MS = 250;
const MAX_STORED_CHAT_SCROLL_SNAPSHOTS = 250;

type ChatScrollSnapshot = {
  scrollTop: number;
  isNearBottom: boolean;
  updatedAt: number;
};

function isValidChatScrollSnapshot(
  value: unknown,
): value is ChatScrollSnapshot {
  if (!value || typeof value !== "object") return false;

  const snapshot = value as Partial<ChatScrollSnapshot>;
  return (
    typeof snapshot.scrollTop === "number" &&
    typeof snapshot.isNearBottom === "boolean" &&
    typeof snapshot.updatedAt === "number"
  );
}

function readChatScrollSnapshots() {
  try {
    const stored = window.localStorage.getItem(
      CHAT_SCROLL_SNAPSHOTS_STORAGE_KEY,
    );
    if (!stored) return {};

    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, ChatScrollSnapshot] =>
          isValidChatScrollSnapshot(entry[1]),
      ),
    );
  } catch (error) {
    console.warn("Failed to load chat scroll positions:", error);
    return {};
  }
}

function pruneChatScrollSnapshots(
  snapshots: Record<string, ChatScrollSnapshot>,
) {
  const entries = Object.entries(snapshots).sort(
    (left, right) => right[1].updatedAt - left[1].updatedAt,
  );

  return Object.fromEntries(entries.slice(0, MAX_STORED_CHAT_SCROLL_SNAPSHOTS));
}

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
  const isNearChatBottomRef = useRef(true);
  const [showScrollToBottomButton, setShowScrollToBottomButton] =
    useState(false);
  const [isChatScrollable, setIsChatScrollable] = useState(false);
  const [, setAutoScrollEnabled] = useState(false);

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
  const autoScrollEnabledRef = useRef(false);
  const activeChatIdRef = useRef(activeChatId);
  const generatingChatIdsRef = useRef(generatingChatIds);
  const chatScrollSnapshotsRef = useRef<Record<string, ChatScrollSnapshot>>(
    readChatScrollSnapshots(),
  );
  const persistChatScrollSnapshotsTimeoutRef = useRef<number | null>(null);
  const restoreScrollFrameRef = useRef<number | null>(null);

  activeChatIdRef.current = activeChatId;
  generatingChatIdsRef.current = generatingChatIds;

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

  function updateIsNearChatBottom(isNearBottom: boolean) {
    isNearChatBottomRef.current = isNearBottom;
    setIsNearChatBottom(isNearBottom);
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
      if (!isActiveChatGenerating()) return;

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

  function isActiveChatGenerating(chatId = activeChatIdRef.current) {
    return Boolean(chatId && generatingChatIdsRef.current.includes(chatId));
  }

  function shouldStickToChatBottom() {
    return (
      isActiveChatGenerating() &&
      autoScrollEnabledRef.current &&
      !isStickyScrollSuppressed()
    );
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
    saveCurrentChatScrollSnapshot();
  }

  function syncChatScrollState() {
    syncChatScrollableState();

    const distanceFromBottom = getChatDistanceFromBottom();
    const isNearBottom =
      !canChatScroll() || distanceFromBottom <= CHAT_BOTTOM_THRESHOLD_PX;

    updateIsNearChatBottom(isNearBottom);
    setShowScrollToBottomButton(
      canChatScroll() &&
        distanceFromBottom > SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX,
    );

    return { distanceFromBottom, isNearBottom };
  }

  function persistChatScrollSnapshots() {
    try {
      chatScrollSnapshotsRef.current = pruneChatScrollSnapshots(
        chatScrollSnapshotsRef.current,
      );
      window.localStorage.setItem(
        CHAT_SCROLL_SNAPSHOTS_STORAGE_KEY,
        JSON.stringify(chatScrollSnapshotsRef.current),
      );
    } catch (error) {
      console.warn("Failed to save chat scroll positions:", error);
    }
  }

  function schedulePersistChatScrollSnapshots() {
    if (persistChatScrollSnapshotsTimeoutRef.current !== null) {
      window.clearTimeout(persistChatScrollSnapshotsTimeoutRef.current);
    }

    persistChatScrollSnapshotsTimeoutRef.current = window.setTimeout(() => {
      persistChatScrollSnapshotsTimeoutRef.current = null;
      persistChatScrollSnapshots();
    }, CHAT_SCROLL_SNAPSHOT_PERSIST_DEBOUNCE_MS);
  }

  function saveChatScrollSnapshot(chatId: string) {
    const scrollElement = chatScrollRef.current;
    if (!scrollElement) return;

    chatScrollSnapshotsRef.current = {
      ...chatScrollSnapshotsRef.current,
      [chatId]: {
        scrollTop: scrollElement.scrollTop,
        isNearBottom: isNearChatBottomRef.current,
        updatedAt: Date.now(),
      },
    };
    schedulePersistChatScrollSnapshots();
  }

  function saveCurrentChatScrollSnapshot() {
    const chatId = activeChatIdRef.current;
    if (!chatId) return;

    saveChatScrollSnapshot(chatId);
  }

  function forgetChatScrollSnapshot(chatId: string) {
    if (!(chatId in chatScrollSnapshotsRef.current)) return;

    const remainingSnapshots = { ...chatScrollSnapshotsRef.current };
    delete remainingSnapshots[chatId];
    chatScrollSnapshotsRef.current = remainingSnapshots;
    schedulePersistChatScrollSnapshots();
  }

  const getChatScrollSnapshot = useCallback((chatId: string) => {
    return chatScrollSnapshotsRef.current[chatId];
  }, []);

  function cancelRestoreScrollPosition() {
    if (restoreScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreScrollFrameRef.current);
      restoreScrollFrameRef.current = null;
    }
  }

  function cancelStickyScrollToBottom() {
    pendingChatBottomScrollRef.current = false;
    stickyScrollForceRef.current = false;
    stickyScrollSettleFramesRef.current = 0;

    if (stickyScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(stickyScrollFrameRef.current);
      stickyScrollFrameRef.current = null;
    }
  }

  function restoreScrollTopForChat({
    chatId,
    scrollTop,
    settleFrames = 2,
  }: {
    chatId: string;
    scrollTop: number;
    settleFrames?: number;
  }) {
    cancelRestoreScrollPosition();

    let remainingFrames = Math.max(1, settleFrames);

    const applyScrollTop = () => {
      restoreScrollFrameRef.current = null;
      if (activeChatIdRef.current !== chatId) return;

      const scrollElement = chatScrollRef.current;
      if (!scrollElement) return;

      const nextScrollTop = Math.min(
        Math.max(0, scrollTop),
        Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight),
      );

      markProgrammaticChatScroll(200);
      scrollElement.scrollTop = nextScrollTop;
      lastChatScrollTopRef.current = nextScrollTop;
      syncChatScrollState();

      remainingFrames -= 1;
      if (remainingFrames > 0) {
        restoreScrollFrameRef.current =
          window.requestAnimationFrame(applyScrollTop);
      }
    };

    applyScrollTop();
  }

  function restoreActiveChatScrollSnapshot() {
    const chatId = activeChatIdRef.current;
    const scrollElement = chatScrollRef.current;
    if (!chatId || !scrollElement) return;

    cancelStickyScrollToBottom();
    cancelRestoreScrollPosition();
    clearStickyScrollSuppression();

    const snapshot = chatScrollSnapshotsRef.current[chatId];
    const activeChatIsGenerating = isActiveChatGenerating(chatId);

    if (!snapshot) {
      setChatAutoScrollEnabled(false);
      restoreScrollTopForChat({ chatId, scrollTop: 0, settleFrames: 1 });
      return;
    }

    if (snapshot.isNearBottom && activeChatIsGenerating) {
      setChatAutoScrollEnabled(true);
      scheduleStickyScrollToBottom({ force: true, settleFrames: 6 });
      return;
    }

    setChatAutoScrollEnabled(false);
    restoreScrollTopForChat({
      chatId,
      scrollTop: snapshot.scrollTop,
      settleFrames: 6,
    });
  }

  function scheduleStickyScrollToBottom({
    force = false,
    settleFrames,
  }: { force?: boolean; settleFrames?: number } = {}) {
    if (!force && !shouldStickToChatBottom()) return;

    stickyScrollForceRef.current = stickyScrollForceRef.current || force;
    stickyScrollSettleFramesRef.current = Math.max(
      stickyScrollSettleFramesRef.current,
      Math.max(1, settleFrames ?? getStickyScrollSettleFrames()),
    );

    if (stickyScrollFrameRef.current !== null) return;

    const runStickyScrollFrame = () => {
      stickyScrollFrameRef.current = null;

      const shouldForce = stickyScrollForceRef.current;

      if (!shouldForce && !shouldStickToChatBottom()) {
        stickyScrollSettleFramesRef.current = 0;
        return;
      }

      scrollToBottomInstant();
      syncChatScrollableState();
      updateIsNearChatBottom(true);
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
    cancelStickyScrollToBottom();
    cancelRestoreScrollPosition();
    setChatAutoScrollEnabled(false);
    updateIsNearChatBottom(true);
    setShowScrollToBottomButton(false);
  }

  function armStickyScrollToBottom() {
    clearStickyScrollSuppression();
    cancelRestoreScrollPosition();
    setChatAutoScrollEnabled(true);
    updateIsNearChatBottom(true);
    setShowScrollToBottomButton(false);
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

      if (shouldStickToChatBottom()) {
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

      if (activeChatId && shouldStickToChatBottom()) {
        scheduleStickyScrollToBottom({
          settleFrames: STICKY_SCROLL_SETTLE_FRAMES,
        });
      }
    },
    [activeChatId, generatingChatIds, setVisualStreamingMessageIds],
  );

  const handleAskUserLayoutChange = useCallback(() => {
    if (shouldStickToChatBottom()) {
      scheduleStickyScrollToBottom({ settleFrames: 2 });
      return;
    }

    syncChatScrollState();
  }, [activeChatId, generatingChatIds]);

  useLayoutEffect(() => {
    restoreActiveChatScrollSnapshot();
  }, [activeChatId]);

  useEffect(() => {
    if (!isActiveChatGenerating()) {
      setChatAutoScrollEnabled(false);
    }
  }, [activeChatId, generatingChatIds]);

  useLayoutEffect(() => {
    syncChatScrollableState();

    if (pendingChatBottomScrollRef.current) {
      pendingChatBottomScrollRef.current = false;
      scheduleStickyScrollToBottom({ force: true });
      return;
    }

    if (shouldStickToChatBottom()) {
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
      if (shouldStickToChatBottom()) {
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
    if (!shouldStickToChatBottom()) return;

    scheduleStickyScrollToBottom();
  }, [activeChatId, generatingChatIds, messages]);

  useEffect(() => {
    if (!activeChatId) return;

    if (shouldStickToChatBottom()) {
      scheduleStickyScrollToBottom({
        settleFrames: STICKY_SCROLL_SETTLE_FRAMES,
      });
      return;
    }

    if (!isActiveChatGenerating()) {
      setChatAutoScrollEnabled(false);
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
    function handleBeforeUnload() {
      saveCurrentChatScrollSnapshot();
      persistChatScrollSnapshots();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      handleBeforeUnload();
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
      if (restoreScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(restoreScrollFrameRef.current);
      }
      if (autoScrollResetTimeoutRef.current !== null) {
        window.clearTimeout(autoScrollResetTimeoutRef.current);
      }
      if (persistChatScrollSnapshotsTimeoutRef.current !== null) {
        window.clearTimeout(persistChatScrollSnapshotsTimeoutRef.current);
      }
      if (manualScrollSuppressionTimeoutRef.current !== null) {
        window.clearTimeout(manualScrollSuppressionTimeoutRef.current);
      }
    };
  }, []);

  function scrollChatToBottom() {
    clearStickyScrollSuppression();
    cancelRestoreScrollPosition();
    setChatAutoScrollEnabled(isActiveChatGenerating());
    markProgrammaticChatScroll(500);
    scheduleStickyScrollToBottom({
      force: true,
      settleFrames: FORCED_SCROLL_SETTLE_FRAMES,
    });
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
      saveCurrentChatScrollSnapshot();

      if (!isAutoScrollingRef.current) {
        if (
          currentScrollTop < previousScrollTop &&
          hasRecentManualScrollInput()
        ) {
          suppressStickyScroll();
          return;
        }

        if (
          isNearBottom &&
          isActiveChatGenerating() &&
          !isStickyScrollSuppressed()
        ) {
          setChatAutoScrollEnabled(true);
        } else if (!isNearBottom && hasRecentManualScrollInput()) {
          setChatAutoScrollEnabled(false);
        } else if (!isNearBottom && shouldStickToChatBottom()) {
          scheduleStickyScrollToBottom();
        } else if (!isActiveChatGenerating()) {
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
    saveCurrentChatScrollSnapshot,
    forgetChatScrollSnapshot,
    getChatScrollSnapshot,
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
