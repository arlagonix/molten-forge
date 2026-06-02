import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  RefObject,
  SetStateAction,
} from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const CHAT_BOTTOM_THRESHOLD_PX = 32;
// Eased streaming sticky-scroll (gentle glide toward the live bottom).
// Each frame closes EASE_FACTOR of the remaining gap (exponential ease-out),
// but the per-frame movement is clamped between MIN_STEP and MAX_STEP below.
const STICKY_SCROLL_EASE_FACTOR = 0.1;
// Minimum px moved per frame so the tail converges instead of crawling.
const STICKY_SCROLL_MIN_STEP_PX = 2;
// Maximum px moved per frame. THIS IS THE GLIDE-SPEED / DURATION KNOB:
// the view never travels faster than this many px per ~16ms frame, so a large
// gap glides at a steady pace instead of lunging. LOWER = slower & longer
// glide; HIGHER = faster & snappier. (14 px/frame ~= 840 px/sec at 60fps.)
const STICKY_SCROLL_MAX_STEP_PX = 3;
// Within this distance, snap to the exact bottom and stop the loop.
const STICKY_SCROLL_SNAP_DISTANCE_PX = 2;
// Gaps larger than this snap instantly (massive paste / huge media / first
// catch-up) to avoid a long visible crawl. Normal streaming deltas and typical
// code-block / image insertions stay well under this and will glide.
const STICKY_SCROLL_MAX_EASE_DISTANCE_PX = 4000;
// Keep the "programmatic scroll" flag alive across eased frames so the
// onScroll handler does not mistake the glide for a manual scroll.
const STICKY_SCROLL_PROGRAMMATIC_MS = 120;
const SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX = 1000;
const STICKY_SCROLL_SUPPRESSION_MS = 1000;
const STICKY_SCROLL_SETTLE_FRAMES = 5;
const FORCED_SCROLL_SETTLE_FRAMES = 8;
const CHAT_SCROLL_SNAPSHOTS_STORAGE_KEY = "chat-forge-chat-scroll-snapshots";
const CHAT_SCROLL_SNAPSHOT_PERSIST_DEBOUNCE_MS = 250;
const MAX_STORED_CHAT_SCROLL_SNAPSHOTS = 250;

type ChatScrollSnapshot = {
  scrollTop: number;
  // Anchor the saved position to a specific message rather than relying on the
  // absolute scrollTop alone. The raw offset is fragile: when earlier messages
  // render to a different height after a chat switch (async Markdown, syntax
  // highlighting, images, virtualized blocks), the absolute offset points at
  // the wrong place. The anchor lets restoration recompute the target from the
  // live position of the message, which is robust to those height changes.
  // scrollTop is retained as a fallback for snapshots without a resolvable
  // anchor (e.g. legacy data, or messages no longer present).
  anchorMessageId?: string;
  anchorOffset?: number;
  isNearBottom: boolean;
  updatedAt: number;
};

function isValidChatScrollSnapshot(
  value: unknown,
): value is ChatScrollSnapshot {
  if (!value || typeof value !== "object") return false;

  const snapshot = value as Partial<ChatScrollSnapshot>;
  const hasValidAnchor =
    (snapshot.anchorMessageId === undefined ||
      typeof snapshot.anchorMessageId === "string") &&
    (snapshot.anchorOffset === undefined ||
      typeof snapshot.anchorOffset === "number");

  return (
    typeof snapshot.scrollTop === "number" &&
    typeof snapshot.isNearBottom === "boolean" &&
    typeof snapshot.updatedAt === "number" &&
    hasValidAnchor
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

/**
 * Owns chat scroll behaviour. Three intertwined concerns share state via refs:
 *  1. Observation — track whether the viewport is near the bottom and whether
 *     the chat is scrollable (drives the scroll-to-bottom button).
 *  2. Persistence — snapshot each chat's position (anchored to a message) to
 *     localStorage and restore it on switch.
 *  3. Sticky-to-bottom — while the active chat is generating, keep the viewport
 *     pinned to the latest content unless the user manually scrolls away.
 * The effects below are grouped by concern; they communicate through the refs
 * declared at the top rather than through React state to avoid re-render churn
 * on every scroll frame.
 */
export function useChatAutoscroll({
  activeChatId,
  generatingChatIds,
  messages,
  closeMessageContextMenu,
  setVisualStreamingMessageIds,
  messageOffsetResolverRef,
}: {
  activeChatId?: string;
  generatingChatIds: string[];
  messages: unknown[];
  closeMessageContextMenu: () => void;
  setVisualStreamingMessageIds: Dispatch<SetStateAction<string[]>>;
  // Optional resolver published by the virtualized message list: maps a
  // message id to the scrollTop that aligns it with the viewport top, even for
  // messages not currently in the DOM. Falls back to a live DOM query.
  messageOffsetResolverRef?: RefObject<
    ((messageId: string) => number | null) | null
  >;
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

  // Returns the offset of an element's top relative to the scroll content
  // (i.e. the scrollTop at which the element's top aligns with the viewport
  // top), computed from live layout so it stays correct as content reflows.
  function getMessageTopWithinScroll(messageElement: HTMLElement) {
    const scrollElement = chatScrollRef.current;
    if (!scrollElement) return 0;

    const scrollRect = scrollElement.getBoundingClientRect();
    const messageRect = messageElement.getBoundingClientRect();
    return messageRect.top - scrollRect.top + scrollElement.scrollTop;
  }

  // Identify the topmost message currently at (or above) the viewport top, plus
  // how far the viewport has scrolled into it. This is what gets persisted so
  // restoration can re-derive the scroll position from the message's live
  // location rather than a stale absolute offset.
  function getCurrentChatScrollAnchor() {
    const scrollElement = chatScrollRef.current;
    if (!scrollElement) return null;

    const messageElements =
      scrollElement.querySelectorAll<HTMLElement>("[data-message-id]");
    if (messageElements.length === 0) return null;

    const scrollTop = scrollElement.scrollTop;
    let anchorElement: HTMLElement | null = null;

    for (const element of messageElements) {
      if (getMessageTopWithinScroll(element) <= scrollTop + 1) {
        anchorElement = element;
      } else {
        break;
      }
    }

    anchorElement = anchorElement ?? messageElements[0];
    const messageId = anchorElement.getAttribute("data-message-id");
    if (!messageId) return null;

    return {
      messageId,
      offset: scrollTop - getMessageTopWithinScroll(anchorElement),
    };
  }

  // Resolve a saved anchor back into an absolute scrollTop using the message's
  // current position, or null when the anchored message is not in the DOM.
  function getScrollTopForAnchor(anchorMessageId?: string, anchorOffset = 0) {
    if (!anchorMessageId) return null;

    // Prefer the virtualizer's measurement resolver: it can locate the anchored
    // message even when it has been windowed out of the DOM (essential for long
    // chats). Fall back to a live DOM query when no resolver is present or the
    // message has not been measured yet.
    const resolvedTop = messageOffsetResolverRef?.current?.(anchorMessageId);
    if (resolvedTop != null) {
      return Math.max(0, resolvedTop + anchorOffset);
    }

    const scrollElement = chatScrollRef.current;
    if (!scrollElement) return null;

    const messageElement = scrollElement.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(anchorMessageId)}"]`,
    );
    if (!messageElement) return null;

    return Math.max(
      0,
      getMessageTopWithinScroll(messageElement) + anchorOffset,
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

  // Move one eased step toward the live bottom. Returns true once it has
  // converged (at the bottom) so the caller can stop the rAF loop. Only used
  // for the non-forced streaming catch-up; forced snaps (scroll-to-bottom
  // button, chat-switch restore, send/arm) still use scrollToBottomInstant().
  function stepStickyScrollTowardBottom() {
    const scrollElement = chatScrollRef.current;
    if (!scrollElement) return true;

    const commit = (nextScrollTop: number) => {
      markProgrammaticChatScroll(STICKY_SCROLL_PROGRAMMATIC_MS);
      scrollElement.scrollTop = nextScrollTop;
      lastChatScrollTopRef.current = nextScrollTop;
      saveCurrentChatScrollSnapshot();
    };

    const target = Math.max(
      0,
      scrollElement.scrollHeight - scrollElement.clientHeight,
    );

    // Honour reduced-motion: snap instead of gliding.
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      commit(target);
      return true;
    }

    const current = scrollElement.scrollTop;
    const distance = target - current;

    // Already at/above the bottom (or content shrank), or a huge jump: snap.
    if (
      distance <= STICKY_SCROLL_SNAP_DISTANCE_PX ||
      distance > STICKY_SCROLL_MAX_EASE_DISTANCE_PX
    ) {
      commit(target);
      return true;
    }

    // Exponential ease-out, clamped to a steady per-frame speed so large gaps
    // glide instead of lunging, and a minimum step so the tail converges.
    const step = Math.min(
      STICKY_SCROLL_MAX_STEP_PX,
      Math.max(distance * STICKY_SCROLL_EASE_FACTOR, STICKY_SCROLL_MIN_STEP_PX),
    );
    const next = Math.min(target, current + step);
    commit(next);

    return next >= target - STICKY_SCROLL_SNAP_DISTANCE_PX;
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

    const anchor = getCurrentChatScrollAnchor();

    // Mutate the ref in place: this runs on every scroll frame, and the
    // snapshot map is only read lazily (getChatScrollSnapshot) or cloned when
    // persisted, so there is no need to allocate a fresh copy of up to
    // MAX_STORED_CHAT_SCROLL_SNAPSHOTS entries here.
    chatScrollSnapshotsRef.current[chatId] = {
      scrollTop: scrollElement.scrollTop,
      anchorMessageId: anchor?.messageId,
      anchorOffset: anchor?.offset,
      isNearBottom: isNearChatBottomRef.current,
      updatedAt: Date.now(),
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

    delete chatScrollSnapshotsRef.current[chatId];
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
    anchorMessageId,
    anchorOffset,
    settleFrames = 2,
  }: {
    chatId: string;
    scrollTop: number;
    anchorMessageId?: string;
    anchorOffset?: number;
    settleFrames?: number;
  }) {
    cancelRestoreScrollPosition();

    let remainingFrames = Math.max(1, settleFrames);

    const applyScrollTop = () => {
      restoreScrollFrameRef.current = null;
      if (activeChatIdRef.current !== chatId) return;

      const scrollElement = chatScrollRef.current;
      if (!scrollElement) return;

      // Recompute the anchored target every frame so it tracks the message's
      // live position as content settles; fall back to the saved offset when
      // the anchored message cannot be resolved.
      const desiredScrollTop =
        getScrollTopForAnchor(anchorMessageId, anchorOffset) ?? scrollTop;

      const nextScrollTop = Math.min(
        Math.max(0, desiredScrollTop),
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
      anchorMessageId: snapshot.anchorMessageId,
      anchorOffset: snapshot.anchorOffset,
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

      // Forced snap (scroll-to-bottom button, chat-switch restore, send/arm):
      // keep the original instant, settle-frame behaviour.
      if (shouldForce) {
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
        return;
      }

      // Streaming catch-up: glide one eased step toward the live bottom.
      const reachedBottom = stepStickyScrollTowardBottom();
      syncChatScrollableState();
      updateIsNearChatBottom(true);
      setShowScrollToBottomButton(false);

      // Keep gliding while not yet at the bottom and the chat still wants to
      // stick. The loop re-reads the live target each frame, so it naturally
      // follows content that is still growing. Repeated schedules while we run
      // are no-ops (guarded above), so the loop stays continuous.
      if (!reachedBottom && shouldStickToChatBottom()) {
        stickyScrollFrameRef.current =
          window.requestAnimationFrame(runStickyScrollFrame);
        return;
      }

      // Converged, or the user scrolled away / generation ended. Stop; the next
      // content/resize event re-arms via scheduleStickyScrollToBottom().
      stickyScrollSettleFramesRef.current = 0;
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

  // --- Concern: restore persisted position when switching chats ---
  useLayoutEffect(() => {
    restoreActiveChatScrollSnapshot();
  }, [activeChatId]);

  // --- Concern: react to message/content changes (sticky-to-bottom) ---
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

  // --- Concern: keep sticky/near-bottom state correct as layout resizes ---
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

  // --- Concern: reconcile sticky/auto-scroll on chat or generation changes ---
  // Sticking to the bottom requires the active chat to be generating, so the
  // default settle-frame count already resolves to STICKY_SCROLL_SETTLE_FRAMES
  // here; the message dependency keeps us pinned as new content streams in.
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
  }, [activeChatId, generatingChatIds, messages]);

  // --- Concern: manual scroll intent (keyboard) suppresses sticky scroll ---
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

  // --- Concern: flush the current position to storage on teardown/unload ---
  useEffect(() => {
    function flushScrollSnapshots() {
      saveCurrentChatScrollSnapshot();
      persistChatScrollSnapshots();
    }

    // `visibilitychange` -> hidden is the reliable signal (beforeunload is not
    // guaranteed to fire under bfcache/process suspension); keep beforeunload
    // too as a belt-and-braces flush for environments that honour it.
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flushScrollSnapshots();
    }

    window.addEventListener("beforeunload", flushScrollSnapshots);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", flushScrollSnapshots);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushScrollSnapshots();
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
