"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Eye,
  EyeOff,
  MessageSquareText,
  Moon,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  Square,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type {
  FormEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { SmoothAssistantMessageContent } from "@/components/ai-chat/smooth-assistant-message";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  buildTokenMetrics,
  createId,
  createNewProvider,
  createProviderId,
  formatChatActivityDate,
  formatOptionalNumber,
  formatTokenMetrics,
  getActiveVariant,
  getChatActivityDate,
  getProviderFallbackModel,
  groupChatsByActivityDate,
  labelForError,
  normalizeProviderForState,
  normalizeProviderModels,
  parseOptionalNumber,
  providerDisplayName,
  providerLabel,
  sanitizeGenerationSettings,
  sortChatsByUpdatedAt,
  titleFromMessage,
} from "@/lib/ai-chat/chat-utils";
import {
  getActiveModelSettings,
  loadProviderModels,
  streamProviderChat,
} from "@/lib/ai-chat/direct-provider-client";
import {
  defaultGenerationSettings,
  defaultProvider,
  providerPresets,
} from "@/lib/ai-chat/provider-presets";
import {
  createEmptyChat,
  deleteChat,
  loadActiveChatId,
  loadChats,
  loadProvidersState,
  loadSystemPrompt,
  saveActiveChatId,
  saveCachedProviderModels,
  saveChat,
  saveProvidersState,
  saveSystemPrompt,
} from "@/lib/ai-chat/storage";
import type {
  ChatAssistantVariant,
  ChatMessage,
  ChatSession,
  ProviderConfig,
  ProviderGenerationSettings,
  ProvidersState,
} from "@/lib/ai-chat/types";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const APP_NAME = "Chat Forge";
const APP_VERSION_LABEL = `v${__APP_VERSION__}`;
const APP_TITLE = `${APP_NAME} ${APP_VERSION_LABEL}`;

const CHAT_BOTTOM_THRESHOLD_PX = 32;
const SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX = 1000;
const STICKY_SCROLL_SUPPRESSION_MS = 1000;
const STICKY_SCROLL_SETTLE_FRAMES = 5;
const SIDEBAR_COLLAPSED_STORAGE_KEY = "chat-forge-sidebar-collapsed";

const UserMessageEditor = memo(function UserMessageEditor({
  initialContent,
  disabled,
  onCancel,
  onSave,
}: {
  initialContent: string;
  disabled: boolean;
  onCancel: () => void;
  onSave: (content: string) => void | Promise<void>;
}) {
  const [content, setContent] = useState(initialContent);
  const trimmedContent = content.trim();

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  function handleSave() {
    if (disabled || !trimmedContent) return;

    void onSave(content);
  }

  return (
    <div className="grid min-w-0 max-w-full gap-2">
      <article className="flex justify-end">
        <div className="min-w-0 w-full overflow-hidden bg-primary rounded-lg px-4 py-3 text-sm leading-6 text-primary-foreground shadow-xs [overflow-wrap:anywhere]">
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }

              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                handleSave();
              }
            }}
            autoFocus
            disabled={disabled}
            className="min-h-[12rem] max-h-[32rem] w-full resize-y rounded-none border-0 !bg-transparent p-0 text-primary-foreground shadow-none outline-none placeholder:text-primary-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-80"
          />
        </div>
      </article>

      <div className="flex justify-end gap-1.5 text-[11px] leading-4 text-muted-foreground">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 rounded-lg px-2 text-xs text-muted-foreground"
          onClick={handleSave}
          disabled={disabled || !trimmedContent}
          title="Save edit and regenerate"
        >
          <Check className="size-3" />
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 rounded-lg px-2 text-xs text-muted-foreground"
          onClick={onCancel}
          disabled={disabled}
          title="Cancel edit"
        >
          <X className="size-3" />
          Cancel
        </Button>
      </div>
    </div>
  );
});

type ChatComposerHandle = {
  clear: () => void;
  focus: () => void;
};

const ChatComposer = memo(
  forwardRef<
    ChatComposerHandle,
    {
      disabled: boolean;
      isSending: boolean;
      onSend: (content: string) => Promise<boolean> | boolean;
      onStop: () => void;
      footerStart?: ReactNode;
    }
  >(function ChatComposer(
    { disabled, isSending, onSend, onStop, footerStart },
    ref,
  ) {
    const [draft, setDraft] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const trimmedDraft = draft.trim();
    const canSend = !disabled && !isSending && trimmedDraft.length > 0;

    const focusTextarea = useCallback(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (!textarea) return;

          textarea.focus({ preventScroll: true });

          const cursorPosition = textarea.value.length;
          textarea.setSelectionRange(cursorPosition, cursorPosition);
        });
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        clear: () => setDraft(""),
        focus: focusTextarea,
      }),
      [focusTextarea],
    );

    useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.style.height = "auto";

      const computedStyle = window.getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 24;
      const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
      const maxHeight = lineHeight * 11 + paddingTop + paddingBottom;

      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
      textarea.style.overflowY =
        textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [draft]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!canSend) return;

      const wasSent = await onSend(draft);
      if (wasSent) setDraft("");
    }

    return (
      <form
        onSubmit={handleSubmit}
        className="bg-background px-3 py-3 md:px-4 md:py-4"
        data-draft-input
      >
        <div className="mx-auto w-full max-w-3xl border rounded-lg bg-card p-3 pt-0 shadow-sm">
          <div className="mx-auto grid w-full gap-2">
            <Textarea
              ref={textareaRef}
              value={draft}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;

                if (event.shiftKey) return;

                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              placeholder="Type a message..."
              className="min-h-[5.5rem] resize-none border-0 !bg-transparent px-1 leading-6 shadow-none focus-visible:ring-0"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">{footerStart}</div>
              {isSending ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onStop}
                  className="shrink-0 rounded-lg"
                  title="Stop generation"
                >
                  <Square className="size-4" />
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={!canSend}
                  className="shrink-0 rounded-lg"
                  title="Send message"
                >
                  <Send className="size-4" />
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
    );
  }),
);

type StreamBuffer = {
  chatId: string;
  assistantMessageId: string;
  variantId: string;
  content: string;
  reasoning: string;
};

type ActiveGeneration = {
  controller: AbortController;
  assistantMessageId: string;
  variantId: string;
};

type MessageContextMenuState = {
  messageId: string;
  x: number;
  y: number;
  linkHref: string | null;
  selectedText: string;
};

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [providersState, setProvidersState] = useState<ProvidersState>(() => ({
    providers: [normalizeProviderForState(defaultProvider)],
    activeProviderId: defaultProvider.id,
  }));
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful assistant.",
  );
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [generatingChatIds, setGeneratingChatIds] = useState<string[]>([]);
  const [streamingAssistantByChatId, setStreamingAssistantByChatId] = useState<
    Record<string, string>
  >({});
  const [visualStreamingMessageIds, setVisualStreamingMessageIds] = useState<
    string[]
  >([]);
  const [visualFlushRequests, setVisualFlushRequests] = useState<
    Record<string, number>
  >({});
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelLoadStatus, setModelLoadStatus] = useState<
    "idle" | "success" | "empty" | "error"
  >("idle");
  const [isModelComboboxOpen, setIsModelComboboxOpen] = useState(false);
  const [modelSearchValue, setModelSearchValue] = useState("");
  const [messageContextMenu, setMessageContextMenu] =
    useState<MessageContextMenuState | null>(null);
  const [isSidebarModelComboboxOpen, setIsSidebarModelComboboxOpen] =
    useState(false);
  const [sidebarModelSearchValue, setSidebarModelSearchValue] = useState("");
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [expandedMetricsIds, setExpandedMetricsIds] = useState<
    Record<string, boolean>
  >({});
  const [isNearChatBottom, setIsNearChatBottom] = useState(true);
  const [showScrollToBottomButton, setShowScrollToBottomButton] =
    useState(false);
  const [isChatScrollable, setIsChatScrollable] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;

    return (
      window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true"
    );
  });
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatContentRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const messageElementRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingChatBottomScrollRef = useRef(false);
  const chatComposerRef = useRef<ChatComposerHandle | null>(null);
  const generationRefs = useRef<Record<string, ActiveGeneration>>({});
  const modelLoadStatusTimerRef = useRef<number | null>(null);
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
  const isResizingChatRef = useRef(false);
  const isChatScrollableRef = useRef(false);
  const streamBuffersRef = useRef<Record<string, StreamBuffer>>({});
  const streamFlushTimeoutRefs = useRef<Record<string, number>>({});
  const didHydrateRef = useRef(false);

  // Auto-scroll state: enabled by default, disabled when user scrolls up
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const autoScrollEnabledRef = useRef(true);

  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    document.title = APP_TITLE;
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      String(isSidebarCollapsed),
    );
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (!messageContextMenu) return;

    function handleDocumentPointerDown(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;

      if (target?.closest("[data-message-context-menu]")) {
        return;
      }

      closeMessageContextMenu();
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMessageContextMenu();
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener(
        "pointerdown",
        handleDocumentPointerDown,
        true,
      );
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [messageContextMenu]);

  function focusDraftTextarea() {
    chatComposerRef.current?.focus();
  }

  const sortedChats = useMemo(() => sortChatsByUpdatedAt(chats), [chats]);
  const groupedChats = useMemo(
    () => groupChatsByActivityDate(sortedChats),
    [sortedChats],
  );

  const activeChat = useMemo(() => {
    return (
      sortedChats.find((chat) => chat.id === activeChatId) ?? sortedChats[0]
    );
  }, [activeChatId, sortedChats]);

  const providers = providersState.providers.length
    ? providersState.providers
    : [normalizeProviderForState(defaultProvider)];
  const activeProvider =
    providers.find(
      (provider) => provider.id === providersState.activeProviderId,
    ) ?? providers[0];
  const messages = activeChat?.messages ?? [];
  const hasMessages = messages.length > 0;
  const activeChatProvider =
    providers.find((provider) => provider.id === activeChat?.providerId) ??
    activeProvider;
  const activeChatModel =
    activeChat?.model?.trim() || getProviderFallbackModel(activeChatProvider);
  const isSending = activeChat
    ? generatingChatIds.includes(activeChat.id)
    : false;
  const activeModelSettings = getActiveModelSettings({
    ...activeProvider,
    model: "",
  });
  const modelSuggestions = useMemo(() => {
    return normalizeProviderModels([
      ...(activeProvider.models ?? []),
      ...(activeProvider.enabledModelIds ?? []),
      activeProvider.model,
    ]);
  }, [activeProvider]);

  const filteredModelSuggestions = useMemo(() => {
    const search = modelSearchValue.trim().toLowerCase();
    if (!search) return modelSuggestions;

    return modelSuggestions.filter((model) =>
      model.toLowerCase().includes(search),
    );
  }, [modelSearchValue, modelSuggestions]);

  const visibleProviderGroups = useMemo(() => {
    const search = sidebarModelSearchValue.trim().toLowerCase();

    return providers
      .map((provider) => {
        const models = normalizeProviderModels(
          provider.enabledModelIds ?? [],
        ).filter((model) =>
          search
            ? `${providerDisplayName(provider)} ${model}`
                .toLowerCase()
                .includes(search)
            : true,
        );

        return { provider, models };
      })
      .filter((group) => group.models.length > 0);
  }, [providers, sidebarModelSearchValue]);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const [
          loadedProvidersState,
          loadedSystemPrompt,
          loadedChats,
          loadedActiveChatId,
        ] = await Promise.all([
          loadProvidersState(),
          loadSystemPrompt(),
          loadChats(),
          loadActiveChatId(),
        ]);

        if (cancelled) return;

        const normalizedProviders = loadedProvidersState.providers.length
          ? loadedProvidersState.providers.map(normalizeProviderForState)
          : [normalizeProviderForState(defaultProvider)];
        const fallbackProviderId = normalizedProviders.some(
          (provider) => provider.id === loadedProvidersState.activeProviderId,
        )
          ? loadedProvidersState.activeProviderId
          : normalizedProviders[0].id;
        const fallbackProvider =
          normalizedProviders.find(
            (provider) => provider.id === fallbackProviderId,
          ) ?? normalizedProviders[0];

        let nextChats = loadedChats.map((chat) => ({
          ...chat,
          providerId: chat.providerId ?? fallbackProviderId,
          model:
            chat.model?.trim() || getProviderFallbackModel(fallbackProvider),
        }));
        let nextActiveChatId = loadedActiveChatId;

        if (nextChats.length === 0) {
          const chat = {
            ...createEmptyChat(),
            providerId: fallbackProviderId,
            model: getProviderFallbackModel(fallbackProvider),
          };
          nextChats = [chat];
          nextActiveChatId = chat.id;
          await saveChat(chat);
          await saveActiveChatId(chat.id);
        } else if (
          !nextActiveChatId ||
          !nextChats.some((chat) => chat.id === nextActiveChatId)
        ) {
          nextActiveChatId = nextChats[0].id;
          await saveActiveChatId(nextActiveChatId);
        }

        if (cancelled) return;

        setProvidersState({
          providers: normalizedProviders,
          activeProviderId: fallbackProviderId,
        });
        setSystemPrompt(loadedSystemPrompt);
        setChats(nextChats);
        setActiveChatId(nextActiveChatId);
        didHydrateRef.current = true;
        setMounted(true);
      } catch (error) {
        console.error("Failed to load app data from IndexedDB:", error);
        const fallbackProvider = normalizeProviderForState(defaultProvider);
        const fallbackChat = {
          ...createEmptyChat(),
          providerId: fallbackProvider.id,
          model: getProviderFallbackModel(fallbackProvider),
        };
        setProvidersState({
          providers: [fallbackProvider],
          activeProviderId: fallbackProvider.id,
        });
        setChats([fallbackChat]);
        setActiveChatId(fallbackChat.id);
        didHydrateRef.current = true;
        setMounted(true);
        showError("Storage failed", labelForError(error));
      }
    }

    hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (modelLoadStatusTimerRef.current !== null) {
        window.clearTimeout(modelLoadStatusTimerRef.current);
      }
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
      Object.values(streamFlushTimeoutRefs.current).forEach((timeoutId) =>
        window.clearTimeout(timeoutId),
      );
      Object.values(generationRefs.current).forEach((generation) =>
        generation.controller.abort(),
      );
    };
  }, []);

  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.repeat) return;
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey)
        return;

      if (event.code === "KeyN") {
        event.preventDefault();
        event.stopPropagation();
        void createNewChat();
        return;
      }

      if (event.code === "Delete") {
        event.preventDefault();
        event.stopPropagation();
        void clearCurrentChat();
      }
    }

    document.addEventListener("keydown", handleGlobalShortcut, {
      capture: true,
    });

    return () => {
      document.removeEventListener("keydown", handleGlobalShortcut, {
        capture: true,
      });
    };
  }, [activeChat, isSending]);

  useEffect(() => {
    if (!didHydrateRef.current) return;
    saveProvidersState(providersState).catch((error) =>
      console.error("Failed to save providers:", error),
    );
  }, [providersState]);

  useEffect(() => {
    if (!didHydrateRef.current) return;
    saveSystemPrompt(systemPrompt).catch((error) =>
      console.error("Failed to save system prompt:", error),
    );
  }, [systemPrompt]);

  useEffect(() => {
    if (!didHydrateRef.current || !activeChatId) return;
    saveActiveChatId(activeChatId).catch((error) =>
      console.error("Failed to save active chat id:", error),
    );
  }, [activeChatId]);

  useEffect(() => {
    if (!didHydrateRef.current || chats.length === 0) return;

    const timeoutId = window.setTimeout(() => {
      Promise.all(chats.map((chat) => saveChat(chat))).catch((error) =>
        console.error("Failed to save chats:", error),
      );
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [chats]);

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
    return Boolean(activeChatId && isChatGenerating(activeChatId));
  }

  function getStickyScrollSettleFrames() {
    return isActiveChatGenerating() ? STICKY_SCROLL_SETTLE_FRAMES : 1;
  }

  function armStickyScrollToBottom() {
    clearStickyScrollSuppression();
    markProgrammaticChatScroll(350);
    setChatAutoScrollEnabled(true);
    setIsNearChatBottom(true);
    setShowScrollToBottomButton(false);
    requestChatBottomScrollAfterRender();
    scheduleStickyScrollToBottom({ force: true });
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

    if (Math.abs(scrollElement.scrollTop - nextScrollTop) <= 1) return;

    markProgrammaticChatScroll();
    scrollElement.scrollTop = nextScrollTop;
    lastChatScrollTopRef.current = nextScrollTop;
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
    [activeChatId, generatingChatIds],
  );

  function registerMessageElement(messageId: string) {
    return (element: HTMLDivElement | null) => {
      if (element) {
        messageElementRefs.current.set(messageId, element);
      } else {
        messageElementRefs.current.delete(messageId);
      }
    };
  }

  function requestChatBottomScrollAfterRender() {
    pendingChatBottomScrollRef.current = true;
  }

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
      if (autoScrollEnabledRef.current && !isStickyScrollSuppressed()) {
        scheduleStickyScrollToBottom({
          settleFrames: isActiveChatGenerating()
            ? STICKY_SCROLL_SETTLE_FRAMES
            : 1,
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

  function showSuccess(message: string, description?: string) {
    toast(message, description ? { description } : undefined);
  }

  function showError(message: string, description?: string) {
    toast(message, description ? { description } : undefined);
  }

  function showInfo(message: string, description?: string) {
    toast(message, description ? { description } : undefined);
  }

  function updateChat(
    chatId: string,
    updater: (chat: ChatSession) => ChatSession,
  ) {
    setChats((currentChats) =>
      currentChats.map((chat) => (chat.id === chatId ? updater(chat) : chat)),
    );
  }

  function updateChatMessages(
    chatId: string,
    updater: (messages: ChatMessage[]) => ChatMessage[],
    options: { touch?: boolean } = {},
  ) {
    const shouldTouch = options.touch ?? true;

    updateChat(chatId, (chat) => ({
      ...chat,
      messages: updater(chat.messages),
      ...(shouldTouch ? { updatedAt: new Date().toISOString() } : {}),
    }));
  }

  function updateActiveChatMessages(
    updater: (messages: ChatMessage[]) => ChatMessage[],
    options: { touch?: boolean } = {},
  ) {
    if (!activeChatId) return;
    updateChatMessages(activeChatId, updater, options);
  }

  function toggleMetrics(messageId: string) {
    setExpandedMetricsIds((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  }

  function appendToAssistantVariant(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    patch: Partial<Pick<ChatAssistantVariant, "content" | "reasoning">>,
  ) {
    updateChatMessages(
      chatId,
      (currentMessages) =>
        currentMessages.map((message) => {
          if (
            message.id !== assistantMessageId ||
            message.role !== "assistant"
          ) {
            return message;
          }

          return {
            ...message,
            variants: message.variants.map((variant) => {
              if (variant.id !== variantId) return variant;

              return {
                ...variant,
                content: patch.content
                  ? variant.content + patch.content
                  : variant.content,
                reasoning: patch.reasoning
                  ? `${variant.reasoning ?? ""}${patch.reasoning}`
                  : variant.reasoning,
              };
            }),
          };
        }),
      { touch: false },
    );
  }

  function getStreamBufferKey(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
  ) {
    return `${chatId}:${assistantMessageId}:${variantId}`;
  }

  function flushBufferedAssistantVariant(bufferKey: string) {
    const buffered = streamBuffersRef.current[bufferKey];
    if (!buffered || (!buffered.content && !buffered.reasoning)) return;

    streamBuffersRef.current[bufferKey] = {
      ...buffered,
      content: "",
      reasoning: "",
    };

    appendToAssistantVariant(
      buffered.chatId,
      buffered.assistantMessageId,
      buffered.variantId,
      {
        content: buffered.content || undefined,
        reasoning: buffered.reasoning || undefined,
      },
    );
  }

  function flushAllBufferedAssistantVariants() {
    Object.keys(streamBuffersRef.current).forEach((bufferKey) => {
      flushBufferedAssistantVariant(bufferKey);
    });
  }

  function scheduleBufferedAssistantFlush(bufferKey: string) {
    if (streamFlushTimeoutRefs.current[bufferKey] !== undefined) return;

    streamFlushTimeoutRefs.current[bufferKey] = window.setTimeout(
      () => {
        delete streamFlushTimeoutRefs.current[bufferKey];
        flushBufferedAssistantVariant(bufferKey);
      },
      autoScrollEnabledRef.current ? 50 : 110,
    );
  }

  function appendBufferedAssistantVariant(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    patch: Partial<Pick<ChatAssistantVariant, "content" | "reasoning">>,
  ) {
    const bufferKey = getStreamBufferKey(chatId, assistantMessageId, variantId);
    const buffered = streamBuffersRef.current[bufferKey] ?? {
      chatId,
      assistantMessageId,
      variantId,
      content: "",
      reasoning: "",
    };

    streamBuffersRef.current[bufferKey] = {
      ...buffered,
      content: patch.content
        ? buffered.content + patch.content
        : buffered.content,
      reasoning: patch.reasoning
        ? buffered.reasoning + patch.reasoning
        : buffered.reasoning,
    };

    scheduleBufferedAssistantFlush(bufferKey);
  }

  function updateAssistantVariant(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    updater: (variant: ChatAssistantVariant) => ChatAssistantVariant,
    options: { touch?: boolean } = {},
  ) {
    updateChatMessages(
      chatId,
      (currentMessages) =>
        currentMessages.map((message) => {
          if (
            message.id !== assistantMessageId ||
            message.role !== "assistant"
          ) {
            return message;
          }

          return {
            ...message,
            variants: message.variants.map((variant) =>
              variant.id === variantId ? updater(variant) : variant,
            ),
          };
        }),
      options,
    );
  }

  function selectAssistantVariant(messageId: string, variantIndex: number) {
    updateActiveChatMessages((currentMessages) =>
      currentMessages.map((message) => {
        if (message.id !== messageId || message.role !== "assistant") {
          return message;
        }

        const safeIndex = Math.min(
          Math.max(variantIndex, 0),
          message.variants.length - 1,
        );

        return {
          ...message,
          activeVariantIndex: safeIndex,
        };
      }),
    );
  }

  function updateProvidersState(
    updater: (state: ProvidersState) => ProvidersState,
  ) {
    setProvidersState((currentState) => {
      const nextState = updater(currentState);
      const providers = nextState.providers.length
        ? nextState.providers.map(normalizeProviderForState)
        : [normalizeProviderForState(defaultProvider)];
      const activeProviderId = providers.some(
        (provider) => provider.id === nextState.activeProviderId,
      )
        ? nextState.activeProviderId
        : providers[0].id;

      return { providers, activeProviderId };
    });
  }

  function updateProviderSetting(patch: Partial<ProviderConfig>) {
    setProvidersState((currentState) => ({
      ...currentState,
      providers: currentState.providers.map((provider) =>
        provider.id === currentState.activeProviderId
          ? {
              ...provider,
              ...patch,
              id: provider.id,
            }
          : provider,
      ),
    }));
  }

  function applyPreset(id: string) {
    const preset = providerPresets.find((item) => item.id === id);
    if (!preset) return;

    updateProviderSetting({
      ...preset,
      id: activeProvider.id,
      defaultSettings: {
        ...defaultGenerationSettings,
        ...(preset.defaultSettings ?? {}),
      },
      modelSettings: preset.modelSettings ?? {},
    });
    setModelLoadStatus("idle");
    showSuccess("Provider preset loaded", preset.name);
  }

  function addProvider() {
    const provider = createNewProvider();
    updateProvidersState((currentState) => ({
      providers: [...currentState.providers, provider],
      activeProviderId: provider.id,
    }));
  }

  function duplicateProvider(providerId: string) {
    const source = providers.find((provider) => provider.id === providerId);
    if (!source) return;

    const provider = normalizeProviderForState({
      ...source,
      id: createProviderId(),
      name: `${source.name} copy`,
    });

    updateProvidersState((currentState) => ({
      providers: [...currentState.providers, provider],
      activeProviderId: provider.id,
    }));
  }

  function deleteProvider(providerId: string) {
    if (providers.length <= 1) {
      showInfo("At least one provider is required.");
      return;
    }

    const remainingProviders = providers.filter(
      (provider) => provider.id !== providerId,
    );
    const fallbackProvider =
      remainingProviders.find((provider) => provider.id !== providerId) ??
      remainingProviders[0];

    updateProvidersState((currentState) => ({
      providers: currentState.providers.filter(
        (provider) => provider.id !== providerId,
      ),
      activeProviderId:
        currentState.activeProviderId === providerId
          ? fallbackProvider.id
          : currentState.activeProviderId,
    }));

    setChats((currentChats) =>
      currentChats.map((chat) =>
        chat.providerId === providerId
          ? {
              ...chat,
              providerId: fallbackProvider.id,
              model: getProviderFallbackModel(fallbackProvider),
              updatedAt: new Date().toISOString(),
            }
          : chat,
      ),
    );
  }

  function selectActiveChatProviderModel(providerId: string, model: string) {
    const normalizedModel = model.trim();
    if (!normalizedModel) return;

    if (activeChat) {
      updateChat(activeChat.id, (chat) => ({
        ...chat,
        providerId,
        model: normalizedModel,
        updatedAt: new Date().toISOString(),
      }));
    }

    setProvidersState((currentState) => ({
      ...currentState,
      activeProviderId: providerId,
      providers: currentState.providers.map((provider) =>
        provider.id === providerId
          ? { ...provider, model: normalizedModel }
          : provider,
      ),
    }));
    setIsSidebarModelComboboxOpen(false);
    setSidebarModelSearchValue("");
  }

  function toggleVisibleModel(model: string, checked: boolean) {
    const normalizedModel = model.trim();
    if (!normalizedModel) return;

    updateProvidersState((currentState) => ({
      ...currentState,
      providers: currentState.providers.map((provider) => {
        if (provider.id !== currentState.activeProviderId) return provider;

        const enabledModelIds = checked
          ? normalizeProviderModels([
              ...(provider.enabledModelIds ?? []),
              normalizedModel,
            ])
          : normalizeProviderModels(
              (provider.enabledModelIds ?? []).filter(
                (item) => item !== normalizedModel,
              ),
            );
        const model = enabledModelIds.includes(provider.model)
          ? provider.model
          : "";

        return normalizeProviderForState({
          ...provider,
          models: normalizeProviderModels([
            ...(provider.models ?? []),
            normalizedModel,
          ]),
          enabledModelIds,
          model,
        });
      }),
    }));
  }

  function updateActiveModelSettings(patch: ProviderGenerationSettings) {
    updateProviderSetting({
      defaultSettings: sanitizeGenerationSettings({
        ...defaultGenerationSettings,
        ...(activeProvider.defaultSettings ?? {}),
        ...patch,
      }),
    });
  }

  function resetActiveModelSettings() {
    updateProviderSetting({ defaultSettings: defaultGenerationSettings });
  }

  function setTemporaryModelLoadStatus(status: "success" | "empty" | "error") {
    setModelLoadStatus(status);

    if (modelLoadStatusTimerRef.current !== null) {
      window.clearTimeout(modelLoadStatusTimerRef.current);
    }

    modelLoadStatusTimerRef.current = window.setTimeout(() => {
      setModelLoadStatus("idle");
      modelLoadStatusTimerRef.current = null;
    }, 1800);
  }

  async function saveSettingsChanges() {
    try {
      await Promise.all([
        saveProvidersState(providersState),
        saveSystemPrompt(systemPrompt),
      ]);
      showSuccess("Settings saved.");
      setSettingsOpen(false);
    } catch (error) {
      console.error("Failed to save settings:", error);
      showError("Failed to save settings", labelForError(error));
    }
  }

  function getLoadModelsButtonLabel(provider = activeProvider) {
    if (isLoadingModels) return "Loading models...";
    if (modelLoadStatus === "success") {
      const count = provider.models?.length ?? 0;
      return `Loaded ${count} model${count === 1 ? "" : "s"}`;
    }
    if (modelLoadStatus === "empty") return "No models returned";
    if (modelLoadStatus === "error") return "Model lookup failed";

    return "Load models";
  }

  async function loadModelsFromProvider(providerForLoad = activeProvider) {
    setIsLoadingModels(true);
    setModelLoadStatus("idle");

    if (modelLoadStatusTimerRef.current !== null) {
      window.clearTimeout(modelLoadStatusTimerRef.current);
      modelLoadStatusTimerRef.current = null;
    }

    try {
      const loadedModels = await loadProviderModels(providerForLoad);
      await saveCachedProviderModels(providerForLoad, loadedModels);

      updateProvidersState((currentState) => ({
        ...currentState,
        providers: currentState.providers.map((provider) => {
          if (provider.id !== providerForLoad.id) return provider;

          const enabledModelIds = normalizeProviderModels(
            (provider.enabledModelIds ?? []).filter((model) =>
              loadedModels.includes(model),
            ),
          );
          const model = enabledModelIds.includes(provider.model)
            ? provider.model
            : "";

          return normalizeProviderForState({
            ...provider,
            models: loadedModels,
            enabledModelIds,
            model,
          });
        }),
      }));

      setTemporaryModelLoadStatus(loadedModels.length ? "success" : "empty");
    } catch (error) {
      setTemporaryModelLoadStatus("error");
      console.error("Model lookup failed:", error);
    } finally {
      setIsLoadingModels(false);
    }
  }

  function validateProviderForGeneration(providerForRun: ProviderConfig) {
    if (!providerForRun.baseUrl.trim()) {
      showError("Provider base URL is required.");
      setSettingsOpen(true);
      return false;
    }

    if (!providerForRun.model.trim()) {
      showError(
        "Model name is required",
        "Select a visible model in the sidebar model selector.",
      );
      return false;
    }

    return true;
  }

  function resolveProviderForChat(chat: ChatSession) {
    const provider =
      providers.find((item) => item.id === chat.providerId) ?? activeProvider;
    const model = chat.model?.trim() || getProviderFallbackModel(provider);

    return normalizeProviderForState({ ...provider, model });
  }

  function setChatGenerating(chatId: string, isGenerating: boolean) {
    setGeneratingChatIds((currentChatIds) => {
      const nextChatIds = isGenerating
        ? [...new Set([...currentChatIds, chatId])]
        : currentChatIds.filter((currentChatId) => currentChatId !== chatId);
      return nextChatIds;
    });
  }

  function isChatGenerating(chatId: string) {
    return (
      Boolean(generationRefs.current[chatId]) ||
      generatingChatIds.includes(chatId)
    );
  }

  function stopChatGeneration(chatId: string) {
    const generation = generationRefs.current[chatId];
    if (!generation) return;

    flushBufferedAssistantVariant(
      getStreamBufferKey(
        chatId,
        generation.assistantMessageId,
        generation.variantId,
      ),
    );
    setVisualFlushRequests((current) => ({
      ...current,
      [generation.assistantMessageId]:
        (current[generation.assistantMessageId] ?? 0) + 1,
    }));
    generation.controller.abort();
  }

  async function runAssistantVariant({
    chatId,
    contextMessages,
    userMessage,
    assistantMessageId,
    variantId,
    responseStartedAtMs,
    providerForRun,
  }: {
    chatId: string;
    contextMessages: ChatMessage[];
    userMessage: string;
    assistantMessageId: string;
    variantId: string;
    responseStartedAtMs: number;
    providerForRun: ProviderConfig;
  }) {
    const controller = new AbortController();
    generationRefs.current[chatId] = {
      controller,
      assistantMessageId,
      variantId,
    };
    setChatGenerating(chatId, true);
    setStreamingAssistantByChatId((current) => ({
      ...current,
      [chatId]: assistantMessageId,
    }));

    if (chatId === activeChatId) {
      armStickyScrollToBottom();
    }

    toast.dismiss();

    try {
      const streamResult = await streamProviderChat({
        provider: providerForRun,
        systemPrompt,
        messages: contextMessages,
        userMessage,
        signal: controller.signal,
        onContentDelta: (delta) => {
          appendBufferedAssistantVariant(
            chatId,
            assistantMessageId,
            variantId,
            {
              content: delta,
            },
          );

          if (chatId === activeChatId) {
            scheduleStickyScrollToBottom();
          }
        },
        onReasoningDelta: (delta) => {
          appendBufferedAssistantVariant(
            chatId,
            assistantMessageId,
            variantId,
            {
              reasoning: delta,
            },
          );

          if (chatId === activeChatId) {
            scheduleStickyScrollToBottom();
          }
        },
      });

      flushBufferedAssistantVariant(
        getStreamBufferKey(chatId, assistantMessageId, variantId),
      );

      const durationMs = Math.max(1, performance.now() - responseStartedAtMs);

      updateAssistantVariant(
        chatId,
        assistantMessageId,
        variantId,
        (variant) => ({
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
              provider: providerForRun,
              finishReason: streamResult.finishReason,
            }),
          },
        }),
      );
    } catch (error) {
      const wasAborted =
        error instanceof DOMException && error.name === "AbortError";

      flushBufferedAssistantVariant(
        getStreamBufferKey(chatId, assistantMessageId, variantId),
      );

      const durationMs = Math.max(1, performance.now() - responseStartedAtMs);

      if (wasAborted) {
        setVisualFlushRequests((current) => ({
          ...current,
          [assistantMessageId]: (current[assistantMessageId] ?? 0) + 1,
        }));
      }
      updateAssistantVariant(
        chatId,
        assistantMessageId,
        variantId,
        (variant) => {
          const currentContent = variant.content.trim();
          const content = wasAborted
            ? variant.content || "Generation stopped."
            : currentContent
              ? `${variant.content}\n\nError: ${labelForError(error)}`
              : `Error: ${labelForError(error)}`;

          return {
            ...variant,
            status: wasAborted ? "done" : "error",
            content,
            metrics: {
              startedAt:
                variant.metrics?.startedAt ??
                new Date(Date.now() - durationMs).toISOString(),
              ...variant.metrics,
              completedAt: new Date().toISOString(),
              ...buildTokenMetrics({
                content,
                durationMs,
                provider: providerForRun,
              }),
            },
          };
        },
      );
    } finally {
      const currentGeneration = generationRefs.current[chatId];
      if (currentGeneration?.controller === controller) {
        delete generationRefs.current[chatId];
        setChatGenerating(chatId, false);
        setStreamingAssistantByChatId((current) => {
          const { [chatId]: _removed, ...remaining } = current;
          return remaining;
        });
      }

      if (chatId === activeChatId) {
        if (autoScrollEnabledRef.current && !isStickyScrollSuppressed()) {
          scheduleStickyScrollToBottom({ force: true });
        } else {
          syncChatScrollState();
        }
      }
    }
  }

  async function sendMessage(content: string) {
    const userMessage = content.trim();

    if (!activeChat) return false;
    if (isChatGenerating(activeChat.id)) return false;

    const providerForRun = resolveProviderForChat(activeChat);
    if (!validateProviderForGeneration(providerForRun)) return false;

    if (!userMessage) {
      showError("Message is required.");
      return false;
    }

    const userChatMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: userMessage,
      createdAt: new Date().toISOString(),
    };

    const assistantMessageId = createId();
    const variantId = createId();
    const responseStartedAtMs = performance.now();
    const responseStartedAt = new Date().toISOString();
    const assistantMessage: ChatMessage = {
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
        },
      ],
      activeVariantIndex: 0,
      createdAt: responseStartedAt,
    };

    const contextMessages = activeChat.messages;
    const nextMessages = [
      ...activeChat.messages,
      userChatMessage,
      assistantMessage,
    ];

    // Enable sticky bottom behavior for this new generation.
    armStickyScrollToBottom();
    updateChat(activeChat.id, (chat) => ({
      ...chat,
      title:
        chat.messages.length === 0 && chat.title === "New chat"
          ? titleFromMessage(userMessage)
          : chat.title,
      messages: nextMessages,
      providerId: providerForRun.id,
      model: providerForRun.model,
      updatedAt: responseStartedAt,
    }));

    void runAssistantVariant({
      chatId: activeChat.id,
      contextMessages,
      userMessage,
      assistantMessageId,
      variantId,
      responseStartedAtMs,
      providerForRun,
    });

    return true;
  }

  async function regenerateAssistantMessage(assistantMessageId: string) {
    if (!activeChat) return;
    if (isChatGenerating(activeChat.id)) return;

    const providerForRun = resolveProviderForChat(activeChat);
    if (!validateProviderForGeneration(providerForRun)) return;

    const assistantIndex = activeChat.messages.findIndex(
      (message) =>
        message.id === assistantMessageId && message.role === "assistant",
    );
    if (assistantIndex < 0) return;

    let userIndex = -1;
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (activeChat.messages[index]?.role === "user") {
        userIndex = index;
        break;
      }
    }

    const userMessageSource = activeChat.messages[userIndex];
    if (!userMessageSource || userMessageSource.role !== "user") {
      showError("Could not find the user message to regenerate from.");
      return;
    }

    const userMessage = userMessageSource.content;
    const contextMessages = activeChat.messages.slice(0, userIndex);
    const variantId = createId();
    const responseStartedAtMs = performance.now();
    const responseStartedAt = new Date().toISOString();

    armStickyScrollToBottom();

    updateActiveChatMessages(
      (currentMessages) =>
        currentMessages.slice(0, assistantIndex + 1).map((message) => {
          if (
            message.id !== assistantMessageId ||
            message.role !== "assistant"
          ) {
            return message;
          }

          return {
            ...message,
            variants: [
              ...message.variants,
              {
                id: variantId,
                content: "",
                reasoning: "",
                status: "streaming",
                createdAt: responseStartedAt,
                metrics: {
                  startedAt: responseStartedAt,
                },
              },
            ],
            activeVariantIndex: message.variants.length,
          };
        }),
      { touch: false },
    );

    armStickyScrollToBottom();
    setExpandedMetricsIds({});

    await runAssistantVariant({
      chatId: activeChat.id,
      contextMessages,
      userMessage,
      assistantMessageId,
      variantId,
      responseStartedAtMs,
      providerForRun,
    });
  }

  function startEditingUserMessage(messageId: string) {
    if (isSending) {
      showInfo("Wait until generation finishes before editing messages.");
      return;
    }

    setEditingMessageId(messageId);
  }

  function cancelEditingUserMessage() {
    setEditingMessageId(null);
  }

  function getSelectedTextWithin(element: HTMLElement) {
    const selection = window.getSelection();

    if (!selection || selection.isCollapsed) {
      return "";
    }

    const selectedText = selection.toString();

    if (!selectedText.trim()) {
      return "";
    }

    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);

      try {
        if (range.intersectsNode(element)) {
          return selectedText;
        }
      } catch {
        // Ignore detached selection ranges.
      }
    }

    return "";
  }

  function closeMessageContextMenu() {
    setMessageContextMenu(null);
  }

  function captureMessageContext(
    event: ReactMouseEvent<HTMLElement>,
    messageId: string,
  ) {
    event.preventDefault();

    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest("a[href]");
    const menuWidth = 220;
    const menuHeight = 180;
    const margin = 8;
    const x = Math.max(
      margin,
      Math.min(event.clientX, window.innerWidth - menuWidth - margin),
    );
    const y = Math.max(
      margin,
      Math.min(event.clientY, window.innerHeight - menuHeight - margin),
    );

    setMessageContextMenu({
      messageId,
      x,
      y,
      linkHref: link instanceof HTMLAnchorElement ? link.href : null,
      selectedText: getSelectedTextWithin(event.currentTarget),
    });
  }

  async function copyLinkHref(href: string | null) {
    if (!href) return;

    try {
      await navigator.clipboard.writeText(href);
      showSuccess("Link copied.");
    } catch (error) {
      console.error("Failed to copy link:", error);
      toast.error("Failed to copy link.");
    }
  }

  function deleteMessage(messageId: string) {
    if (!activeChat) return;

    if (isChatGenerating(activeChat.id)) {
      showInfo("Wait until generation finishes before deleting messages.");
      return;
    }

    updateActiveChatMessages((currentMessages) =>
      currentMessages.filter((message) => message.id !== messageId),
    );

    setEditingMessageId((currentMessageId) =>
      currentMessageId === messageId ? null : currentMessageId,
    );
    setCopiedMessageId((currentMessageId) =>
      currentMessageId === messageId ? null : currentMessageId,
    );
    setExpandedMetricsIds((current) => {
      const next = { ...current };
      delete next[messageId];
      return next;
    });
    messageElementRefs.current.delete(messageId);
    showSuccess("Message deleted.");
  }

  async function copyMessageContent(messageId: string, content: string) {
    if (!content.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((currentMessageId) =>
          currentMessageId === messageId ? null : currentMessageId,
        );
      }, 1200);
    } catch (error) {
      console.error("Failed to copy message:", error);
      toast.error("Failed to copy message.");
    }
  }

  async function saveEditedUserMessage(
    messageId: string,
    editedContent: string,
  ) {
    if (!activeChat) return;
    if (isChatGenerating(activeChat.id)) return;

    const providerForRun = resolveProviderForChat(activeChat);
    if (!validateProviderForGeneration(providerForRun)) return;

    const userMessage = editedContent.trim();
    if (!userMessage) {
      showError("Message is required.");
      return;
    }

    const userIndex = activeChat.messages.findIndex(
      (message) => message.id === messageId && message.role === "user",
    );
    const currentMessage = activeChat.messages[userIndex];

    if (userIndex < 0 || !currentMessage || currentMessage.role !== "user") {
      showError("Could not find the message to edit.");
      return;
    }

    const assistantMessageId = createId();
    const variantId = createId();
    const responseStartedAtMs = performance.now();
    const responseStartedAt = new Date().toISOString();
    const editedUserMessage: ChatMessage = {
      ...currentMessage,
      content: userMessage,
    };
    const assistantMessage: ChatMessage = {
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
        },
      ],
      activeVariantIndex: 0,
      createdAt: responseStartedAt,
    };
    const contextMessages = activeChat.messages.slice(0, userIndex);
    const nextMessages = [
      ...contextMessages,
      editedUserMessage,
      assistantMessage,
    ];

    armStickyScrollToBottom();
    setExpandedMetricsIds({});
    setEditingMessageId(null);

    updateChat(activeChat.id, (chat) => ({
      ...chat,
      title: userIndex === 0 ? titleFromMessage(userMessage) : chat.title,
      messages: nextMessages,
      providerId: providerForRun.id,
      model: providerForRun.model,
      updatedAt: responseStartedAt,
    }));

    await runAssistantVariant({
      chatId: activeChat.id,
      contextMessages,
      userMessage,
      assistantMessageId,
      variantId,
      responseStartedAtMs,
      providerForRun,
    });
  }

  function stopGeneration() {
    if (!activeChat) return;
    stopChatGeneration(activeChat.id);
  }

  async function createNewChat() {
    const chat = {
      ...createEmptyChat(),
      providerId: activeProvider.id,
      model: getProviderFallbackModel(activeProvider),
    };
    setChats((currentChats) => [chat, ...currentChats]);
    setActiveChatId(chat.id);
    chatComposerRef.current?.clear();
    setEditingMessageId(null);
    setExpandedMetricsIds({});
    clearStickyScrollSuppression();
    setChatAutoScrollEnabled(true);
    setIsNearChatBottom(true);
    setShowScrollToBottomButton(false);
    focusDraftTextarea();

    try {
      await saveChat(chat);
      await saveActiveChatId(chat.id);
    } catch (error) {
      console.error("Failed to save new chat:", error);
    }
  }

  async function switchChat(chatId: string) {
    setActiveChatId(chatId);
    chatComposerRef.current?.clear();
    setEditingMessageId(null);
    setExpandedMetricsIds({});
    clearStickyScrollSuppression();
    setChatAutoScrollEnabled(true);
    setIsNearChatBottom(true);
    setShowScrollToBottomButton(false);
  }

  async function clearCurrentChat() {
    if (!activeChat) return;

    if (isChatGenerating(activeChat.id)) stopChatGeneration(activeChat.id);

    const now = new Date().toISOString();
    updateChat(activeChat.id, (chat) => ({
      ...chat,
      title: "New chat",
      messages: [],
      updatedAt: now,
    }));
    setExpandedMetricsIds({});
    showSuccess("Chat cleared.");
  }

  async function removeChat(chatId: string) {
    if (isChatGenerating(chatId)) stopChatGeneration(chatId);

    const remainingChats = sortChatsByUpdatedAt(
      chats.filter((chat) => chat.id !== chatId),
    );
    const nextChats =
      remainingChats.length > 0
        ? remainingChats
        : [
            {
              ...createEmptyChat(),
              providerId: activeProvider.id,
              model: getProviderFallbackModel(activeProvider),
            },
          ];
    const nextActiveId =
      activeChatId === chatId
        ? nextChats[0].id
        : (activeChatId ?? nextChats[0].id);

    setChats(nextChats);
    setActiveChatId(nextActiveId);
    setExpandedMetricsIds({});

    try {
      await deleteChat(chatId);
      if (remainingChats.length === 0) {
        await saveChat(nextChats[0]);
      }
      await saveActiveChatId(nextActiveId);
    } catch (error) {
      console.error("Failed to delete chat:", error);
    }
  }

  function renderAppOptionsMenu(triggerClassName?: string) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={triggerClassName}
            title="Menu"
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="rounded-lg"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            window.requestAnimationFrame(() => {
              (document.activeElement as HTMLElement | null)?.blur();
            });
          }}
        >
          <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
            <Settings className="size-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSystemPromptOpen(true)}>
            <MessageSquareText className="size-4" />
            System prompt
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            {resolvedTheme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
            {resolvedTheme === "dark" ? "Light theme" : "Dark theme"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={clearCurrentChat}>
            <Trash2 className="size-4" />
            <span className="flex-1">Clear current chat</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function renderComposerModelSelector() {
    return (
      <Popover
        open={isSidebarModelComboboxOpen}
        onOpenChange={setIsSidebarModelComboboxOpen}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={!activeChat || isSending}
            aria-expanded={isSidebarModelComboboxOpen}
            className="model-picker-trigger h-9 w-full max-w-[14rem] justify-between overflow-hidden rounded-lg px-3 text-left font-normal"
            title={
              isSending
                ? "Wait until this chat finishes generating"
                : activeChatModel
                  ? providerLabel(activeChatProvider)
                  : "Select a model"
            }
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                !activeChatModel && "text-muted-foreground",
              )}
            >
              {activeChatModel || "Select model"}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(var(--radix-popover-trigger-width),24rem)] rounded-lg p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={sidebarModelSearchValue}
              onValueChange={setSidebarModelSearchValue}
              placeholder="Search models..."
            />
            <CommandList>
              {visibleProviderGroups.length > 0 ? (
                visibleProviderGroups.map(({ provider, models }) => (
                  <CommandGroup
                    key={provider.id}
                    heading={providerDisplayName(provider)}
                  >
                    {models.map((model) => (
                      <CommandItem
                        key={`${provider.id}:${model}`}
                        value={`${providerDisplayName(provider)} ${model}`}
                        onSelect={() =>
                          selectActiveChatProviderModel(provider.id, model)
                        }
                        className="min-w-0 cursor-pointer"
                        title={`${providerDisplayName(provider)} · ${model}`}
                      >
                        <span className="min-w-0 flex-1 truncate">{model}</span>
                        <Check
                          className={cn(
                            "size-4",
                            activeChatProvider.id === provider.id &&
                              activeChatModel === model
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))
              ) : (
                <CommandEmpty>
                  No visible models. Enable models in Settings.
                </CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  if (!mounted) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
        Loading...
      </main>
    );
  }

  return (
    <main className="relative flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <aside
        data-sidebar
        className={cn(
          "w-80 shrink-0 flex-col border-r bg-card/80",
          isSidebarCollapsed ? "flex md:hidden" : "flex",
        )}
      >
        <div className="border-b py-3 pl-3 pr-2">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="hidden shrink-0 rounded-lg md:inline-flex"
              onClick={() => setIsSidebarCollapsed(true)}
              title="Hide sidebar"
            >
              <PanelLeftClose className="size-4" />
            </Button>

            <div className="min-w-0 flex-1">
              <h1 className="flex min-w-0 items-baseline gap-1 truncate text-sm font-semibold leading-5">
                <span className="truncate">{APP_NAME}</span>
                <span className="shrink-0 text-muted-foreground">
                  {APP_VERSION_LABEL}
                </span>
              </h1>
            </div>

            {renderAppOptionsMenu("shrink-0 rounded-lg")}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2 chat-scrollbar">
          <div className="grid gap-3">
            {groupedChats.map((group) => (
              <section key={group.label} className="grid gap-1.5">
                <div className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </div>
                <div className="grid gap-1.5">
                  {group.chats.map((chat) => (
                    <div
                      key={chat.id}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group flex min-w-0 cursor-pointer items-center gap-1 border rounded-lg px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        chat.id === activeChat?.id
                          ? "border-primary/30 bg-accent text-accent-foreground"
                          : "border-transparent hover:border-border hover:bg-muted/60",
                      )}
                      onClick={() => switchChat(chat.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          switchChat(chat.id);
                        }
                      }}
                      title={chat.title}
                    >
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-sm leading-5 ">
                          {chat.title}
                        </div>
                        <div className="truncate text-[11px] leading-4 text-muted-foreground">
                          {chat.messages.length} message
                          {chat.messages.length === 1 ? "" : "s"}
                          {" · "}
                          {formatChatActivityDate(getChatActivityDate(chat))}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="h-7 w-7 shrink-0 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeChat(chat.id);
                        }}
                        title="Delete chat"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <div className="grid gap-2 border-t p-3">
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-center rounded-lg"
            onClick={createNewChat}
            title="New chat (Ctrl+N)"
          >
            <Plus className="size-4" />
            New chat
          </Button>
        </div>
      </aside>

      {isSidebarCollapsed ? (
        <div className="absolute left-2 top-2 z-30 hidden items-center gap-1 rounded-lg border bg-card/95 p-1 shadow-sm md:flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-lg"
            onClick={() => setIsSidebarCollapsed(false)}
            title="Show sidebar"
          >
            <PanelLeftOpen className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-lg"
            onClick={createNewChat}
            title="New chat (Ctrl+N)"
          >
            <Plus className="size-4" />
          </Button>
          {renderAppOptionsMenu("rounded-lg")}
        </div>
      ) : null}

      <section className="relative grid min-h-0 flex-1 grid-rows-[1fr_auto] bg-background">
        <div
          className="relative min-h-0 overflow-hidden"
          onWheel={handleChatWheel}
          onPointerDown={handleChatPointerDown}
        >
          <div
            ref={chatScrollRef}
            data-chat-scroll
            onScroll={handleChatScroll}
            className={cn(
              "chat-scrollbar h-full w-full [overflow-anchor:none]",
              hasMessages ? "overflow-y-auto py-3 md:py-6" : "overflow-hidden",
            )}
          >
            <div
              ref={chatContentRef}
              className={cn(
                "mx-auto flex w-full min-w-0 max-w-3xl flex-col [overflow-anchor:none]",
                hasMessages ? "gap-4" : "h-full",
              )}
            >
              {!hasMessages ? (
                <div className="flex h-full items-center justify-center px-3">
                  <div className="max-w-md rounded-lg border bg-card p-6 text-center shadow-xs">
                    <h2 className="text-sm font-semibold">
                      Start a conversation
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Configure a provider, choose a model, and send your first
                      message. Chats are stored locally as JSON files.
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                      <Button
                        className="rounded-lg"
                        variant="secondary"
                        onClick={() => setSettingsOpen(true)}
                      >
                        <Settings className="size-4" />
                        Open settings
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                messages.map((message) => {
                  const activeVariant =
                    message.role === "assistant"
                      ? getActiveVariant(message)
                      : undefined;
                  const content =
                    message.role === "assistant"
                      ? (activeVariant?.content ?? "")
                      : message.content;
                  const reasoning = activeVariant?.reasoning ?? "";
                  const status = activeVariant?.status;
                  const metrics = activeVariant?.metrics;
                  const isVisuallyStreaming = visualStreamingMessageIds.some(
                    (streamingMessageId) =>
                      streamingMessageId === message.id ||
                      streamingMessageId.startsWith(`${message.id}:`),
                  );
                  const isMessageStreaming =
                    status === "streaming" || isVisuallyStreaming;
                  const variantCount =
                    message.role === "assistant" ? message.variants.length : 0;
                  const activeVariantNumber =
                    message.role === "assistant"
                      ? message.activeVariantIndex + 1
                      : 0;

                  return (
                    <div
                      key={message.id}
                      ref={registerMessageElement(message.id)}
                      data-message-id={message.id}
                      className="grid min-w-0 max-w-full gap-2"
                    >
                      {message.role === "assistant" &&
                        reasoning.trim() &&
                        (() => {
                          return (
                            <article className="flex min-w-0 max-w-full justify-start">
                              <div className="w-full min-w-0 max-w-full overflow-hidden border border-dashed rounded-lg bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground shadow-xs [overflow-wrap:anywhere] ">
                                <div className="mb-2 text-xs font-medium uppercase tracking-wide">
                                  Thinking{isMessageStreaming ? "..." : ""}
                                </div>
                                <div className="min-w-0 overflow-visible text-xs leading-5">
                                  <SmoothAssistantMessageContent
                                    content={reasoning}
                                    className="chat-markdown-compact shrink-0"
                                    isApiStreaming={
                                      status === "streaming" && !content
                                    }
                                    flushVersion={
                                      visualFlushRequests[message.id] ?? 0
                                    }
                                    forceInstant={Boolean(content)}
                                    onVisualProgress={() =>
                                      handleAssistantVisualProgress(
                                        activeChat?.id ?? "",
                                      )
                                    }
                                    onVisualStreamingChange={(isStreaming) =>
                                      handleAssistantVisualStreamingChange(
                                        `${message.id}:reasoning`,
                                        isStreaming,
                                      )
                                    }
                                  />
                                </div>
                              </div>
                            </article>
                          );
                        })()}

                      {message.role === "user" &&
                      editingMessageId === message.id ? (
                        <UserMessageEditor
                          initialContent={message.content}
                          disabled={isSending}
                          onCancel={cancelEditingUserMessage}
                          onSave={(nextContent) =>
                            saveEditedUserMessage(message.id, nextContent)
                          }
                        />
                      ) : (
                        (content ||
                          message.role !== "assistant" ||
                          status !== "streaming") && (
                          <>
                            <article
                              className={cn(
                                "flex min-w-0 max-w-full",
                                message.role === "user"
                                  ? "justify-end"
                                  : "justify-start",
                              )}
                              onContextMenu={(event) =>
                                captureMessageContext(event, message.id)
                              }
                            >
                              <div
                                className={cn(
                                  "min-w-0 text-sm leading-6 [overflow-wrap:anywhere] w-full rounded-lg",
                                  message.role === "user"
                                    ? "max-h-[32rem] overflow-y-auto overflow-x-hidden chat-message-scrollbar bg-primary px-4 py-3 text-primary-foreground shadow-xs"
                                    : "min-w-0 max-w-full overflow-visible px-0 py-3 text-card-foreground shadow-xs",
                                  status === "error" && "border-destructive/50",
                                )}
                              >
                                {message.role === "assistant" ? (
                                  <>
                                    <SmoothAssistantMessageContent
                                      content={content}
                                      isApiStreaming={status === "streaming"}
                                      flushVersion={
                                        visualFlushRequests[message.id] ?? 0
                                      }
                                      onVisualProgress={() =>
                                        handleAssistantVisualProgress(
                                          activeChat?.id ?? "",
                                        )
                                      }
                                      onVisualStreamingChange={(isStreaming) =>
                                        handleAssistantVisualStreamingChange(
                                          `${message.id}:content`,
                                          isStreaming,
                                        )
                                      }
                                    />
                                  </>
                                ) : (
                                  <div className="whitespace-pre-wrap">
                                    {message.content}
                                  </div>
                                )}
                              </div>
                            </article>

                            {messageContextMenu?.messageId === message.id && (
                              <div
                                data-message-context-menu
                                className="fixed z-50 min-w-55 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md"
                                style={{
                                  left: messageContextMenu.x,
                                  top: messageContextMenu.y,
                                }}
                                onContextMenu={(event) =>
                                  event.preventDefault()
                                }
                              >
                                {messageContextMenu.linkHref && (
                                  <>
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                                      onClick={() => {
                                        void copyLinkHref(
                                          messageContextMenu.linkHref,
                                        );
                                        closeMessageContextMenu();
                                      }}
                                    >
                                      <Copy className="size-4" />
                                      Copy link
                                    </button>
                                    <div className="-mx-1 my-1 h-px bg-border" />
                                  </>
                                )}
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                                  disabled={
                                    !messageContextMenu.selectedText.trim() &&
                                    !content.trim()
                                  }
                                  onClick={() => {
                                    void copyMessageContent(
                                      message.id,
                                      messageContextMenu.selectedText ||
                                        content,
                                    );
                                    closeMessageContextMenu();
                                  }}
                                >
                                  <Copy className="size-4" />
                                  {messageContextMenu.selectedText.trim()
                                    ? "Copy selection"
                                    : message.role === "assistant"
                                      ? "Copy answer"
                                      : "Copy message"}
                                </button>
                                {message.role === "assistant" && (
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                                    disabled={isSending}
                                    onClick={() => {
                                      void regenerateAssistantMessage(
                                        message.id,
                                      );
                                      closeMessageContextMenu();
                                    }}
                                  >
                                    <RefreshCcw className="size-4" />
                                    {status === "error"
                                      ? "Retry answer"
                                      : "Regenerate answer"}
                                  </button>
                                )}
                                {message.role === "user" && (
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                                    disabled={isSending}
                                    onClick={() => {
                                      startEditingUserMessage(message.id);
                                      closeMessageContextMenu();
                                    }}
                                  >
                                    <Pencil className="size-4" />
                                    Edit message
                                  </button>
                                )}
                                <div className="-mx-1 my-1 h-px bg-border" />
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-destructive/20"
                                  disabled={isSending}
                                  onClick={() => {
                                    deleteMessage(message.id);
                                    closeMessageContextMenu();
                                  }}
                                >
                                  <Trash2 className="size-4" />
                                  Delete message
                                </button>
                              </div>
                            )}
                          </>
                        )
                      )}

                      {message.role === "user" &&
                        editingMessageId !== message.id && (
                          <div className="flex justify-end gap-1.5 text-[11px] leading-4 text-muted-foreground">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 rounded-lg px-2 text-xs text-muted-foreground"
                              onClick={() =>
                                copyMessageContent(message.id, message.content)
                              }
                              disabled={!message.content.trim()}
                              title="Copy message"
                            >
                              {copiedMessageId === message.id ? (
                                <>
                                  <Check className="size-3" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="size-3" />
                                  Copy
                                </>
                              )}
                            </Button>

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 rounded-lg px-2 text-xs text-muted-foreground"
                              onClick={() =>
                                startEditingUserMessage(message.id)
                              }
                              disabled={isSending}
                              title="Edit message"
                            >
                              <Pencil className="size-3" />
                              Edit
                            </Button>
                          </div>
                        )}

                      {message.role === "assistant" && (
                        <div className="grid gap-2 text-[11px] leading-4 text-muted-foreground">
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                            <button
                              type="button"
                              className={cn(
                                "min-h-6 text-left hover:text-foreground disabled:pointer-events-none",
                                isMessageStreaming &&
                                  "generating-gradient-text font-medium",
                              )}
                              disabled={
                                metrics?.durationMs === undefined ||
                                isMessageStreaming
                              }
                              onClick={() => toggleMetrics(message.id)}
                              title="Show generation details"
                            >
                              {isMessageStreaming
                                ? "Generating"
                                : metrics?.durationMs !== undefined
                                  ? formatTokenMetrics(metrics)
                                  : ""}
                            </button>

                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              {variantCount > 1 && (
                                <div className="flex items-center gap-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="h-6 w-6 rounded-lg text-muted-foreground"
                                    onClick={() =>
                                      selectAssistantVariant(
                                        message.id,
                                        message.activeVariantIndex - 1,
                                      )
                                    }
                                    disabled={
                                      message.activeVariantIndex <= 0 ||
                                      isSending
                                    }
                                    title="Previous answer"
                                  >
                                    <ChevronLeft className="size-3.5" />
                                  </Button>
                                  <span className="min-w-9 text-center tabular-nums">
                                    {activeVariantNumber}/{variantCount}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="h-6 w-6 rounded-lg text-muted-foreground"
                                    onClick={() =>
                                      selectAssistantVariant(
                                        message.id,
                                        message.activeVariantIndex + 1,
                                      )
                                    }
                                    disabled={
                                      message.activeVariantIndex >=
                                        variantCount - 1 || isSending
                                    }
                                    title="Next answer"
                                  >
                                    <ChevronRight className="size-3.5" />
                                  </Button>
                                </div>
                              )}

                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 rounded-lg px-2 text-xs text-muted-foreground"
                                onClick={() =>
                                  copyMessageContent(message.id, content)
                                }
                                disabled={!content.trim()}
                                title="Copy answer"
                              >
                                {copiedMessageId === message.id ? (
                                  <>
                                    <Check className="size-3" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="size-3" />
                                    Copy
                                  </>
                                )}
                              </Button>

                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 rounded-lg px-2 text-xs text-muted-foreground"
                                onClick={() =>
                                  regenerateAssistantMessage(message.id)
                                }
                                disabled={isSending}
                                title={
                                  status === "error"
                                    ? "Retry answer"
                                    : "Regenerate answer"
                                }
                              >
                                <RefreshCcw className="size-3" />
                                {status === "error" ? "Retry" : "Regenerate"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div
                ref={chatBottomRef}
                aria-hidden="true"
                className="h-px w-full shrink-0"
              />
            </div>
          </div>

          {hasMessages &&
            isChatScrollable &&
            !isNearChatBottom &&
            showScrollToBottomButton && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 right-[-74px] z-10 px-3 md:px-4">
                <div className="mx-auto flex w-full max-w-3xl justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="pointer-events-auto rounded-lg shadow-md opacity-80 hover:opacity-100"
                    onClick={() => scrollChatToBottom()}
                    title="Scroll to bottom"
                    aria-label="Scroll to bottom"
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                </div>
              </div>
            )}
        </div>

        <ChatComposer
          ref={chatComposerRef}
          disabled={!activeChat}
          isSending={isSending}
          onSend={sendMessage}
          onStop={stopGeneration}
          footerStart={renderComposerModelSelector()}
        />
      </section>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="flex h-[min(820px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="h-[96px] shrink-0 overflow-hidden border-b px-5 py-4 pr-12">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Manage providers, choose visible models, and configure generation
              defaults.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b bg-card/70 p-3 md:border-b-0 md:border-r">
              <div className="mb-3 flex items-center justify-between gap-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Providers
                </Label>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-xs"
                  onClick={addProvider}
                >
                  <Plus className="size-3.5" />
                  Add
                </Button>
              </div>

              <div className="grid gap-1.5">
                {providers.map((item) => (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "group flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      item.id === activeProvider.id
                        ? "border-primary/30 bg-accent text-accent-foreground"
                        : "border-transparent hover:border-border hover:bg-muted/60",
                    )}
                    onClick={() =>
                      setProvidersState((currentState) => ({
                        ...currentState,
                        activeProviderId: item.id,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setProvidersState((currentState) => ({
                          ...currentState,
                          activeProviderId: item.id,
                        }));
                      }
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm leading-5">
                        {providerDisplayName(item)}
                      </div>
                      <div className="truncate text-[11px] leading-4 text-muted-foreground">
                        {(item.enabledModelIds ?? []).length} visible ·{" "}
                        {item.baseUrl || "No base URL"}
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="h-7 w-7 shrink-0 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={(event) => event.stopPropagation()}
                          title="Provider actions"
                        >
                          <MoreVertical className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="rounded-lg">
                        <DropdownMenuItem
                          onClick={(event) => {
                            event.stopPropagation();
                            duplicateProvider(item.id);
                          }}
                        >
                          <Copy className="size-4" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={providers.length <= 1}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteProvider(item.id);
                          }}
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            </aside>

            <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="grid gap-5 pb-1">
                <div className="grid gap-2">
                  <Label>Preset</Label>
                  <Select value="" onValueChange={applyPreset}>
                    <SelectTrigger>
                      <SelectValue placeholder="Load a preset into selected provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {providerPresets.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="provider-name">Provider name</Label>
                    <Input
                      id="provider-name"
                      value={activeProvider.name}
                      onChange={(event) =>
                        updateProviderSetting({ name: event.target.value })
                      }
                      placeholder="Provide the provider name"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="provider-url">Base URL</Label>
                    <Input
                      id="provider-url"
                      value={activeProvider.baseUrl}
                      onChange={(event) =>
                        updateProviderSetting({ baseUrl: event.target.value })
                      }
                      placeholder="http://localhost:1234/v1"
                    />
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="provider-api-key">API key</Label>
                    <div className="relative">
                      <Input
                        id="provider-api-key"
                        value={activeProvider.apiKey}
                        onChange={(event) =>
                          updateProviderSetting({ apiKey: event.target.value })
                        }
                        placeholder="Provide your API key"
                        type={isApiKeyVisible ? "text" : "password"}
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-lg text-muted-foreground"
                        onClick={() =>
                          setIsApiKeyVisible((current) => !current)
                        }
                        title={
                          isApiKeyVisible ? "Hide API key" : "Show API key"
                        }
                      >
                        {isApiKeyVisible ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 rounded-lg border bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <Label>Visible models</Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Only checked models appear in the sidebar model
                        selector.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="rounded-lg"
                        onClick={() => loadModelsFromProvider(activeProvider)}
                        disabled={
                          isLoadingModels || !activeProvider.baseUrl.trim()
                        }
                      >
                        <RefreshCcw
                          className={cn(
                            "size-4",
                            isLoadingModels && "animate-spin",
                          )}
                        />
                        {getLoadModelsButtonLabel(activeProvider)}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="rounded-lg"
                        onClick={() =>
                          updateProviderSetting({
                            enabledModelIds: normalizeProviderModels(
                              activeProvider.models ?? [],
                            ),
                          })
                        }
                        disabled={(activeProvider.models ?? []).length === 0}
                      >
                        Select all
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="rounded-lg"
                        onClick={() =>
                          updateProviderSetting({
                            enabledModelIds: [],
                            model: "",
                          })
                        }
                        disabled={
                          (activeProvider.enabledModelIds ?? []).length === 0
                        }
                      >
                        Clear
                      </Button>
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto rounded-lg border bg-background p-2">
                    {(activeProvider.models ?? []).length > 0 ? (
                      <div className="grid gap-1">
                        {(activeProvider.models ?? []).map((model) => {
                          const checked = (
                            activeProvider.enabledModelIds ?? []
                          ).includes(model);

                          return (
                            <label
                              key={model}
                              className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) =>
                                  toggleVisibleModel(
                                    model,
                                    event.target.checked,
                                  )
                                }
                                className="size-4 shrink-0 accent-primary"
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {model}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="px-2 py-4 text-sm text-muted-foreground">
                        Load models to choose which ones should be visible.
                      </p>
                    )}
                  </div>
                </div>

                <Separator />

                <div className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label>Generation settings</Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Saved per selected provider and used for that provider's
                        visible models.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-lg"
                      onClick={resetActiveModelSettings}
                    >
                      Reset
                    </Button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="grid gap-2">
                      <Label htmlFor="generation-temperature">
                        Temperature
                      </Label>
                      <Input
                        id="generation-temperature"
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        value={formatOptionalNumber(
                          activeModelSettings.temperature,
                        )}
                        onChange={(event) =>
                          updateActiveModelSettings({
                            temperature: parseOptionalNumber(
                              event.target.value,
                            ),
                          })
                        }
                        placeholder="Provider default"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="generation-top-p">Top P</Label>
                      <Input
                        id="generation-top-p"
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={formatOptionalNumber(activeModelSettings.topP)}
                        onChange={(event) =>
                          updateActiveModelSettings({
                            topP: parseOptionalNumber(event.target.value),
                          })
                        }
                        placeholder="Provider default"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="generation-max-tokens">Max tokens</Label>
                      <Input
                        id="generation-max-tokens"
                        type="number"
                        min="1"
                        step="1"
                        value={formatOptionalNumber(
                          activeModelSettings.maxTokens,
                        )}
                        onChange={(event) =>
                          updateActiveModelSettings({
                            maxTokens: parseOptionalNumber(event.target.value),
                          })
                        }
                        placeholder="Provider default"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="grid gap-2">
                      <Label>Thinking controls</Label>
                      <Select
                        value={activeModelSettings.reasoningMode ?? "auto"}
                        onValueChange={(reasoningMode) =>
                          updateActiveModelSettings({
                            reasoningMode:
                              reasoningMode as ProviderGenerationSettings["reasoningMode"],
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto-detect</SelectItem>
                          <SelectItem value="enabled">Force enabled</SelectItem>
                          <SelectItem value="off">Off</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label>Reasoning effort</Label>
                      <Select
                        value={activeModelSettings.reasoningEffort ?? "medium"}
                        onValueChange={(reasoningEffort) =>
                          updateActiveModelSettings({
                            reasoningEffort:
                              reasoningEffort as ProviderGenerationSettings["reasoningEffort"],
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="generation-timeout">
                        Request timeout, ms
                      </Label>
                      <Input
                        id="generation-timeout"
                        type="number"
                        min="1000"
                        step="1000"
                        value={formatOptionalNumber(
                          activeModelSettings.requestTimeoutMs,
                        )}
                        onChange={(event) =>
                          updateActiveModelSettings({
                            requestTimeoutMs: parseOptionalNumber(
                              event.target.value,
                            ),
                          })
                        }
                        placeholder="30000"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="h-[72px] shrink-0 items-center border-t px-5 py-3">
            <Button
              type="button"
              variant="secondary"
              className="rounded-lg"
              onClick={() =>
                updateProviderSetting({
                  ...defaultProvider,
                  id: activeProvider.id,
                  defaultSettings: defaultGenerationSettings,
                  modelSettings: {},
                })
              }
            >
              Reset selected provider
            </Button>
            <Button
              type="button"
              className="rounded-lg"
              onClick={saveSettingsChanges}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={systemPromptOpen} onOpenChange={setSystemPromptOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-2xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle>System prompt</DialogTitle>
            <DialogDescription>
              Define the instruction sent before every chat message. Leave it
              empty to send no system prompt.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <Textarea
              id="system-prompt"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              className="min-h-[320px] resize-y leading-6"
              placeholder="You are a helpful assistant."
            />
          </div>

          <DialogFooter className="shrink-0 border-t px-5 py-3">
            <Button
              type="button"
              variant="secondary"
              className="rounded-lg"
              onClick={() => setSystemPrompt("You are a helpful assistant.")}
            >
              Reset
            </Button>
            <Button
              type="button"
              className="rounded-lg"
              onClick={async () => {
                try {
                  await saveSystemPrompt(systemPrompt);
                  showSuccess("System prompt saved.");
                  setSystemPromptOpen(false);
                } catch (error) {
                  console.error("Failed to save system prompt:", error);
                  showError(
                    "Failed to save system prompt",
                    labelForError(error),
                  );
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
