import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

const CHAT_BOTTOM_THRESHOLD_PX = 32;
const SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX = 1000;

export function useChatScroll({
  activeChatId,
  messages,
  closeMessageContextMenu,
  setVisualStreamingMessageIds,
}: {
  activeChatId?: string;
  messages: unknown[];
  closeMessageContextMenu: () => void;
  setVisualStreamingMessageIds: Dispatch<SetStateAction<string[]>>;
}) {
  const [isNearChatBottom, setIsNearChatBottom] = useState(true);
  const [showScrollToBottomButton, setShowScrollToBottomButton] =
    useState(false);
  const [isChatScrollable, setIsChatScrollable] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatContentRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

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

  const syncChatScrollState = useCallback(() => {
    const nextIsScrollable = canChatScroll();
    const distanceFromBottom = getChatDistanceFromBottom();
    const nextIsNearBottom =
      !nextIsScrollable || distanceFromBottom <= CHAT_BOTTOM_THRESHOLD_PX;
    const nextShowScrollToBottomButton =
      nextIsScrollable &&
      distanceFromBottom > SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX;

    setIsChatScrollable((currentValue) =>
      currentValue === nextIsScrollable ? currentValue : nextIsScrollable,
    );
    setIsNearChatBottom((currentValue) =>
      currentValue === nextIsNearBottom ? currentValue : nextIsNearBottom,
    );
    setShowScrollToBottomButton((currentValue) =>
      currentValue === nextShowScrollToBottomButton
        ? currentValue
        : nextShowScrollToBottomButton,
    );
  }, []);

  const resetChatScrollState = useCallback(() => {
    setIsNearChatBottom(true);
    setShowScrollToBottomButton(false);
    setIsChatScrollable(false);
  }, []);

  const scrollChatToBottom = useCallback(() => {
    const scrollElement = chatScrollRef.current;
    if (!scrollElement) return;

    scrollElement.scrollTop = Math.max(
      0,
      scrollElement.scrollHeight - scrollElement.clientHeight,
    );
    chatBottomRef.current?.scrollIntoView({ block: "end" });
    syncChatScrollState();
  }, [syncChatScrollState]);

  const handleChatScroll = useCallback(() => {
    closeMessageContextMenu();
    syncChatScrollState();
  }, [closeMessageContextMenu, syncChatScrollState]);

  const handleChatWheel = useCallback(() => {
    closeMessageContextMenu();
  }, [closeMessageContextMenu]);

  const handleChatPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target instanceof Element ? event.target : null;

      if (!target?.closest("[data-message-context-menu]")) {
        closeMessageContextMenu();
      }
    },
    [closeMessageContextMenu],
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
    },
    [setVisualStreamingMessageIds],
  );

  const handleAskUserLayoutChange = useCallback(() => {
    syncChatScrollState();
  }, [syncChatScrollState]);

  useLayoutEffect(() => {
    syncChatScrollState();
  }, [activeChatId, messages, syncChatScrollState]);

  useLayoutEffect(() => {
    const scrollElement = chatScrollRef.current;
    const contentElement = chatContentRef.current;
    if (!scrollElement) return;

    const resizeObserver = new ResizeObserver(syncChatScrollState);
    resizeObserver.observe(scrollElement);
    if (contentElement) resizeObserver.observe(contentElement);

    syncChatScrollState();

    return () => {
      resizeObserver.disconnect();
    };
  }, [activeChatId, messages.length, syncChatScrollState]);

  return {
    chatScrollRef,
    chatContentRef,
    chatBottomRef,
    isNearChatBottom,
    showScrollToBottomButton,
    isChatScrollable,
    resetChatScrollState,
    scrollChatToBottom,
    handleChatScroll,
    handleChatWheel,
    handleChatPointerDown,
    handleAssistantVisualStreamingChange,
    handleAskUserLayoutChange,
  };
}
