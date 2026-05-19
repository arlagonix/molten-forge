"use client";

import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ChatMessageList } from "@/components/ai-chat/chat-message-list";
import {
  ChatComposer,
  type ChatComposerHandle,
  type ToolMentionOption,
} from "@/components/ai-chat/chat-composer";
import { ToolExecutionBlock } from "@/components/ai-chat/tool-execution-block";
import { ComposerFooter } from "@/components/ai-chat/composer-footer";
import { EmptyChatState } from "@/components/ai-chat/empty-chat-state";
import { FindBar } from "@/components/ai-chat/find-bar";
import { ChatSidebar } from "@/components/chat-sidebar";
import { SystemPromptDialog } from "@/components/dialogs/system-prompt-dialog";
import { ProviderSettingsDialog } from "@/components/provider-settings-dialog";
import { ToolsDialog } from "@/components/tools-dialog";
import { Button } from "@/components/ui/button";
import {
  createNewProvider,
  createProviderId,
  getProviderFallbackModel,
  groupChatsByActivityDate,
  labelForError,
  normalizeProviderForState,
  normalizeProviderModels,
  providerDisplayName,
  sortChatsByUpdatedAt,
} from "@/lib/ai-chat/chat-utils";
import { defaultProvider } from "@/lib/ai-chat/provider-presets";
import {
  createEmptyChat,
  loadActiveChatId,
  loadChats,
  loadProvidersState,
  loadSystemPrompt,
  loadTools,
  loadToolsSettings,
  saveActiveChatId,
  saveChat,
  saveProvidersState,
  saveSystemPrompt,
  saveToolsSettings,
} from "@/lib/ai-chat/storage";
import {
  ASK_USER_TOOL,
  ASK_USER_TOOL_NAME,
  CHECKLIST_WRITE_TOOL,
  CHECKLIST_WRITE_TOOL_NAME,
  DEFAULT_TOOLS_SETTINGS,
  compareToolsByDisplayOrder,
  isBuiltInToolName,
  isValidToolName,
} from "@/lib/ai-chat/builtin-tools";
import type {
  ChatMessage,
  ChatSession,
  ChatToolCall,
  ChatToolResult,
  LoadedToolInfo,
  ProviderConfig,
  ProvidersState,
  ToolExecutionStatus,
  ToolsSettings,
} from "@/lib/ai-chat/types";
import { useChatActions } from "@/hooks/use-chat-actions";
import { useChatGeneration } from "@/hooks/use-chat-generation";
import { useChatAutoscroll } from "@/hooks/use-chat-autoscroll";
import { useMessageContextMenu } from "@/hooks/use-message-context-menu";
import { useStableCallback } from "@/hooks/use-stable-callback";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const APP_NAME = "Chat Forge";
const APP_VERSION_LABEL = `v${__APP_VERSION__}`;
const APP_TITLE = `${APP_NAME} ${APP_VERSION_LABEL}`;

const SIDEBAR_COLLAPSED_STORAGE_KEY = "chat-forge-sidebar-collapsed";
const COMPOSER_DRAFTS_STORAGE_KEY = "chat-forge-composer-drafts";

function loadComposerDrafts(): Record<string, string> {
  if (typeof window === "undefined") return {};

  try {
    const stored = window.localStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY);
    if (!stored) return {};

    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function saveComposerDrafts(drafts: Record<string, string>) {
  if (typeof window === "undefined") return;

  const nonEmptyDrafts = Object.fromEntries(
    Object.entries(drafts).filter(([, value]) => value.length > 0),
  );

  if (Object.keys(nonEmptyDrafts).length === 0) {
    window.localStorage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    COMPOSER_DRAFTS_STORAGE_KEY,
    JSON.stringify(nonEmptyDrafts),
  );
}

type FindInPageResultState = {
  activeMatchOrdinal: number;
  matches: number;
};

const EMPTY_FIND_RESULT: FindInPageResultState = {
  activeMatchOrdinal: 0,
  matches: 0,
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
  const [toolsSettings, setToolsSettings] = useState<ToolsSettings>(
    DEFAULT_TOOLS_SETTINGS,
  );
  const [loadedTools, setLoadedTools] = useState<LoadedToolInfo[]>([]);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  const [initialComposerDrafts] = useState<Record<string, string>>(() =>
    loadComposerDrafts(),
  );
  const composerDraftsRef = useRef<Record<string, string>>(
    initialComposerDrafts,
  );
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [generatingChatIds, setGeneratingChatIds] = useState<string[]>([]);
  const [visualStreamingMessageIds, setVisualStreamingMessageIds] = useState<
    string[]
  >([]);
  const [visualFlushRequests, setVisualFlushRequests] = useState<
    Record<string, number>
  >({});
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResult, setFindResult] =
    useState<FindInPageResultState>(EMPTY_FIND_RESULT);
  const [isSidebarModelComboboxOpen, setIsSidebarModelComboboxOpen] =
    useState(false);
  const [sidebarModelSearchValue, setSidebarModelSearchValue] = useState("");
  const [isChatToolPickerOpen, setIsChatToolPickerOpen] = useState(false);
  const [chatToolSearchValue, setChatToolSearchValue] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;

    return (
      window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true"
    );
  });
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [collapsedToolStepIds, setCollapsedToolStepIds] = useState<
    Record<string, boolean>
  >({});
  const {
    messageContextMenu,
    captureMessageContext,
    closeMessageContextMenu,
  } = useMessageContextMenu();
  const messageElementRefs = useRef(new Map<string, HTMLDivElement>());
  const messageElementRefCallbacks = useRef(
    new Map<string, (element: HTMLDivElement | null) => void>(),
  );
  const chatComposerRef = useRef<ChatComposerHandle | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const didHydrateRef = useRef(false);
  const composerDraftSaveTimeoutRef = useRef<number | null>(null);
  const chatSaveTimeoutRef = useRef<number | null>(null);
  const savedChatSnapshotsRef = useRef<Record<string, string>>({});

  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    document.title = APP_TITLE;
  }, []);

  useEffect(() => {
    return window.chatForgeFind?.onFoundInPage((result) => {
      setFindResult({
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
      });
    });
  }, []);

  useEffect(() => {
    function handleFindShortcut(event: KeyboardEvent) {
      const isFindShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "f";

      if (!isFindShortcut) return;

      event.preventDefault();

      const selectedText = window.getSelection()?.toString().trim();
      if (selectedText) {
        setFindQuery(selectedText);
      }

      setFindBarOpen(true);
      window.requestAnimationFrame(() => {
        findInputRef.current?.focus();
        findInputRef.current?.select();
      });
    }

    document.addEventListener("keydown", handleFindShortcut);

    return () => {
      document.removeEventListener("keydown", handleFindShortcut);
    };
  }, []);

  useEffect(() => {
    if (!findBarOpen) {
      void window.chatForgeFind?.stopFindInPage("clearSelection");
      setFindResult(EMPTY_FIND_RESULT);
      return;
    }

    window.requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, [findBarOpen]);

  useEffect(() => {
    if (!findBarOpen) return;

    const timeout = window.setTimeout(() => {
      runFindInPage(findQuery, { forward: true, findNext: false });
    }, 80);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [findBarOpen, findQuery]);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      String(isSidebarCollapsed),
    );
  }, [isSidebarCollapsed]);


  function runFindInPage(
    query: string,
    options: { forward?: boolean; findNext?: boolean } = {},
  ) {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      void window.chatForgeFind?.stopFindInPage("clearSelection");
      setFindResult(EMPTY_FIND_RESULT);
      return;
    }

    if (!window.chatForgeFind) {
      setFindResult(EMPTY_FIND_RESULT);
      return;
    }

    void window.chatForgeFind.findInPage({
      text: trimmedQuery,
      forward: options.forward ?? true,
      findNext: options.findNext ?? false,
    });
  }

  function findNextMatch(forward: boolean) {
    if (!findQuery.trim()) {
      findInputRef.current?.focus();
      return;
    }

    runFindInPage(findQuery, { forward, findNext: true });
  }

  function closeFindBar() {
    setFindBarOpen(false);
  }

  function focusDraftTextarea() {
    chatComposerRef.current?.focus();
  }

  function registerMessageElement(messageId: string) {
    const existingCallback = messageElementRefCallbacks.current.get(messageId);

    if (existingCallback) {
      return existingCallback;
    }

    const callback = (element: HTMLDivElement | null) => {
      if (element) {
        messageElementRefs.current.set(messageId, element);
      } else {
        messageElementRefs.current.delete(messageId);
        messageElementRefCallbacks.current.delete(messageId);
      }
    };

    messageElementRefCallbacks.current.set(messageId, callback);
    return callback;
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
  const activeComposerDraft = activeChatId
    ? (composerDraftsRef.current[activeChatId] ?? "")
    : "";

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

  const availableTools = useMemo(() => {
    const byName = new Map<string, LoadedToolInfo>();

    for (const tool of [ASK_USER_TOOL, CHECKLIST_WRITE_TOOL, ...loadedTools]) {
      if (!isValidToolName(tool.name) || byName.has(tool.name)) continue;
      byName.set(tool.name, tool);
    }

    return [...byName.values()].sort(compareToolsByDisplayOrder);
  }, [loadedTools]);

  const availableToolsByName = useMemo(() => {
    return new Map(availableTools.map((tool) => [tool.name, tool] as const));
  }, [availableTools]);

  const globallyEnabledToolNames = useMemo(() => {
    const names = new Set<string>();

    if (!toolsSettings.enabled) return names;

    if (toolsSettings.askUserEnabled) names.add(ASK_USER_TOOL_NAME);
    if (toolsSettings.checklistWriteEnabled)
      names.add(CHECKLIST_WRITE_TOOL_NAME);

    for (const tool of loadedTools) {
      if (
        tool.enabled &&
        tool.name !== ASK_USER_TOOL_NAME &&
        tool.name !== CHECKLIST_WRITE_TOOL_NAME &&
        isValidToolName(tool.name)
      ) {
        names.add(tool.name);
      }
    }

    return names;
  }, [loadedTools, toolsSettings]);

  const activeChatEnabledToolNames = useMemo(() => {
    if (!activeChat) return [];

    const chatEnabled = new Set(activeChat.enabledToolNames ?? []);
    const chatDisabled = new Set(activeChat.disabledToolNames ?? []);

    return availableTools
      .map((tool) => tool.name)
      .filter(
        (toolName) =>
          !chatDisabled.has(toolName) &&
          (globallyEnabledToolNames.has(toolName) || chatEnabled.has(toolName)),
      );
  }, [
    activeChat?.disabledToolNames,
    activeChat?.enabledToolNames,
    activeChat?.id,
    availableTools,
    globallyEnabledToolNames,
  ]);

  const visibleChatTools = useMemo(() => {
    const search = chatToolSearchValue.trim().toLowerCase();

    if (!search) return availableTools;

    return availableTools.filter((tool) =>
      `${tool.name} ${tool.description}`.toLowerCase().includes(search),
    );
  }, [availableTools, chatToolSearchValue]);

  const toolMentionOptions = useMemo<ToolMentionOption[]>(
    () =>
      availableTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        isBuiltin: isBuiltInToolName(tool.name),
      })),
    [availableTools],
  );

  const {
    chatScrollRef,
    chatContentRef,
    chatBottomRef,
    autoScrollEnabledRef,
    isNearChatBottom,
    showScrollToBottomButton,
    isChatScrollable,
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
  } = useChatAutoscroll({
    activeChatId,
    generatingChatIds,
    messages,
    closeMessageContextMenu,
    setVisualStreamingMessageIds,
  });

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const [
          loadedProvidersState,
          loadedSystemPrompt,
          loadedChats,
          loadedActiveChatId,
          loadedToolsSettings,
          loadedToolManifests,
        ] = await Promise.all([
          loadProvidersState(),
          loadSystemPrompt(),
          loadChats(),
          loadActiveChatId(),
          loadToolsSettings(),
          loadTools(),
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
        setToolsSettings(loadedToolsSettings);
        setLoadedTools(loadedToolManifests);
        savedChatSnapshotsRef.current = Object.fromEntries(
          nextChats.map((chat) => [chat.id, JSON.stringify(chat)]),
        );
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
        savedChatSnapshotsRef.current = {
          [fallbackChat.id]: JSON.stringify(fallbackChat),
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
    if (!didHydrateRef.current) return;
    saveToolsSettings(toolsSettings).catch((error) =>
      console.error("Failed to save tools settings:", error),
    );
  }, [toolsSettings]);

  useEffect(() => {
    if (!didHydrateRef.current || !activeChatId) return;
    saveActiveChatId(activeChatId).catch((error) =>
      console.error("Failed to save active chat id:", error),
    );
  }, [activeChatId]);

  useEffect(() => {
    return () => {
      if (composerDraftSaveTimeoutRef.current !== null) {
        window.clearTimeout(composerDraftSaveTimeoutRef.current);
      }

      if (chatSaveTimeoutRef.current !== null) {
        window.clearTimeout(chatSaveTimeoutRef.current);
      }

      saveComposerDrafts(composerDraftsRef.current);
    };
  }, []);

  useEffect(() => {
    if (!didHydrateRef.current || chats.length === 0) return;

    if (chatSaveTimeoutRef.current !== null) {
      window.clearTimeout(chatSaveTimeoutRef.current);
    }

    const saveDelayMs = generatingChatIds.length > 0 ? 1000 : 250;

    chatSaveTimeoutRef.current = window.setTimeout(() => {
      chatSaveTimeoutRef.current = null;

      const nextSnapshots: Record<string, string> = {};
      const changedChats: ChatSession[] = [];

      for (const chat of chats) {
        const snapshot = JSON.stringify(chat);
        nextSnapshots[chat.id] = snapshot;

        if (savedChatSnapshotsRef.current[chat.id] !== snapshot) {
          changedChats.push(chat);
        }
      }

      savedChatSnapshotsRef.current = nextSnapshots;

      if (changedChats.length === 0) return;

      Promise.all(changedChats.map((chat) => saveChat(chat))).catch((error) =>
        console.error("Failed to save chats:", error),
      );
    }, saveDelayMs);

    return () => {
      if (chatSaveTimeoutRef.current !== null) {
        window.clearTimeout(chatSaveTimeoutRef.current);
        chatSaveTimeoutRef.current = null;
      }
    };
  }, [chats, generatingChatIds.length]);

  function showSuccess(message: string, description?: string) {
    toast(message, description ? { description } : undefined);
  }

  function showError(message: string, description?: string) {
    toast(message, description ? { description } : undefined);
  }

  function showInfo(message: string, description?: string) {
    toast(message, description ? { description } : undefined);
  }

  function getToolsBridge() {
    if (!window.chatForgeTools) {
      throw new Error("Electron tools bridge is not available.");
    }

    return window.chatForgeTools;
  }



  function isToolExecutionCollapsed(stepId: string) {
    const manualState = collapsedToolStepIds[stepId];
    if (manualState !== undefined) return manualState;

    return true;
  }

  function toggleToolExecutionCollapsed(
    stepId: string,
    nextCollapsed: boolean,
  ) {
    setCollapsedToolStepIds((current) => ({
      ...current,
      [stepId]: nextCollapsed,
    }));
  }

  function renderToolExecutionBlock({
    id,
    toolCall,
    toolResult,
    status,
  }: {
    id: string;
    toolCall: ChatToolCall;
    toolResult?: ChatToolResult;
    status?: ToolExecutionStatus;
  }) {
    return (
      <ToolExecutionBlock
        id={id}
        toolCall={toolCall}
        toolResult={toolResult}
        status={status}
        loadedTools={loadedTools}
        isCollapsed={isToolExecutionCollapsed(id)}
        onToggleCollapsed={toggleToolExecutionCollapsed}
      />
    );
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

  const updateActiveComposerDraft = useCallback(
    (draft: string) => {
      if (!activeChatId) return;

      const nextDrafts = { ...composerDraftsRef.current };

      if (draft.length === 0) delete nextDrafts[activeChatId];
      else nextDrafts[activeChatId] = draft;

      composerDraftsRef.current = nextDrafts;

      if (composerDraftSaveTimeoutRef.current !== null) {
        window.clearTimeout(composerDraftSaveTimeoutRef.current);
      }

      composerDraftSaveTimeoutRef.current = window.setTimeout(() => {
        composerDraftSaveTimeoutRef.current = null;
        saveComposerDrafts(composerDraftsRef.current);
      }, 250);
    },
    [activeChatId],
  );



  const {
    sendMessage,
    regenerateAssistantMessage,
    submitEditedUserMessage,
    selectAssistantVariant,
    stopChatGeneration,
    isChatGenerating,
    submitAskUserResponse,
    cancelAskUserRequest,
    canSubmitAskUserResponse,
  } = useChatGeneration({
    activeChat,
    activeChatId,
    activeProvider,
    providers,
    chats,
    systemPrompt,
    toolsSettings,
    loadedTools,
    availableToolsByName,
    autoScrollEnabledRef,
    generatingChatIds,
    setGeneratingChatIds,
    setEditingMessageId,
    setSettingsOpen,
    setVisualFlushRequests,
    updateActiveChatMessages,
    updateChat,
    updateChatMessages,
    armStickyScrollToBottom,
    scheduleStickyScrollToBottom,
    isStickyScrollSuppressed,
    syncChatScrollState,
    executeExternalTool: (toolName, args) =>
      getToolsBridge().execute({ name: toolName, args }),
    showError,
  });
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

  async function saveSettingsChanges() {
    try {
      await Promise.all([
        saveProvidersState(providersState),
        saveSystemPrompt(systemPrompt),
      ]);
      showSuccess("Providers saved.");
      setSettingsOpen(false);
    } catch (error) {
      console.error("Failed to save providers:", error);
      showError("Failed to save providers", labelForError(error));
    }
  }

  const {
    startEditingUserMessage,
    cancelEditingUserMessage,
    copyLinkHref,
    deleteMessage,
    copyMessageContent,
    saveEditedUserMessage,
    stopGeneration,
    createNewChat,
    switchChat,
    clearCurrentChat,
    removeChat,
    toggleActiveChatTool,
  } = useChatActions({
    activeChat,
    activeChatId,
    activeProvider,
    availableTools,
    chats,
    globallyEnabledToolNames,
    isSending,
    messageElementRefs,
    setActiveChatId,
    setChats,
    setCopiedMessageId,
    setEditingMessageId,
    resetChatScrollState,
    focusDraftTextarea,
    isChatGenerating,
    stopChatGeneration,
    showError,
    showInfo,
    showSuccess,
    updateActiveChatMessages,
    updateChat,
  });

  const handleProvidersStateChange = useStableCallback(updateProvidersState);
  const handleProviderSettingChange = useStableCallback(updateProviderSetting);
  const handleAddProvider = useStableCallback(addProvider);
  const handleDuplicateProvider = useStableCallback(duplicateProvider);
  const handleDeleteProvider = useStableCallback(deleteProvider);
  const handleSaveSettingsChanges = useStableCallback(saveSettingsChanges);
  const stableShowSuccess = useStableCallback(showSuccess);
  const stableShowError = useStableCallback(showError);
  const toolDisplayKey = useMemo(
    () =>
      loadedTools
        .map((tool) => `${tool.name}:${tool.description ?? ""}`)
        .join("\n"),
    [loadedTools],
  );
  const stableRegisterMessageElement = useStableCallback(registerMessageElement);
  const stableRenderToolExecutionBlock = useStableCallback(renderToolExecutionBlock);
  const stableCanSubmitAskUserResponse = useStableCallback(canSubmitAskUserResponse);
  const stableCaptureMessageContext = useStableCallback(captureMessageContext);
  const stableCloseMessageContextMenu = useStableCallback(closeMessageContextMenu);
  const stableCopyLinkHref = useStableCallback(copyLinkHref);
  const stableCopyMessageContent = useStableCallback(copyMessageContent);
  const stableRegenerateAssistantMessage = useStableCallback(
    regenerateAssistantMessage,
  );
  const stableStartEditingUserMessage = useStableCallback(startEditingUserMessage);
  const stableDeleteMessage = useStableCallback(deleteMessage);
  const stableCancelEditingUserMessage = useStableCallback(
    cancelEditingUserMessage,
  );
  const stableSaveEditedUserMessage = useStableCallback(saveEditedUserMessage);
  const stableSubmitEditedUserMessage = useStableCallback(submitEditedUserMessage);
  const stableSelectAssistantVariant = useStableCallback(selectAssistantVariant);
  const stableToggleToolExecutionCollapsed = useStableCallback(
    toggleToolExecutionCollapsed,
  );
  const stableSubmitAskUserResponse = useStableCallback(submitAskUserResponse);
  const stableCancelAskUserRequest = useStableCallback(cancelAskUserRequest);
  const stableHandleAskUserLayoutChange = useStableCallback(
    handleAskUserLayoutChange,
  );
  const stableHandleAssistantVisualProgress = useStableCallback(
    handleAssistantVisualProgress,
  );
  const stableHandleAssistantVisualStreamingChange = useStableCallback(
    handleAssistantVisualStreamingChange,
  );

  if (!mounted) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
        Loading...
      </main>
    );
  }

  return (
    <main className="relative flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <ChatSidebar
        appName={APP_NAME}
        appVersionLabel={APP_VERSION_LABEL}
        groupedChats={groupedChats}
        activeChatId={activeChat?.id}
        isCollapsed={isSidebarCollapsed}
        resolvedTheme={resolvedTheme}
        onCollapsedChange={setIsSidebarCollapsed}
        onSwitchChat={switchChat}
        onRemoveChat={removeChat}
        onCreateNewChat={createNewChat}
        onOpenProviders={() => setSettingsOpen(true)}
        onOpenTools={() => setToolsOpen(true)}
        onOpenSystemPrompt={() => setSystemPromptOpen(true)}
        onSetTheme={setTheme}
        onClearCurrentChat={clearCurrentChat}
      />

      <section className="relative grid min-h-0 flex-1 grid-rows-[1fr_auto] bg-background">
        {findBarOpen && (
          <FindBar
            inputRef={findInputRef}
            query={findQuery}
            activeMatchOrdinal={findResult.activeMatchOrdinal}
            matches={findResult.matches}
            onQueryChange={setFindQuery}
            onFindNext={findNextMatch}
            onClose={closeFindBar}
          />
        )}

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
                hasMessages ? "gap-5" : "h-full",
              )}
            >
              {!hasMessages ? (
                <EmptyChatState onOpenProviders={() => setSettingsOpen(true)} />
              ) : (
                <ChatMessageList
                  messages={messages}
                  activeChatId={activeChat?.id ?? ""}
                  isSending={isSending}
                  editingMessageId={editingMessageId}
                  copiedMessageId={copiedMessageId}
                  messageContextMenu={messageContextMenu}
                  visualFlushRequests={visualFlushRequests}
                  visualStreamingMessageIds={visualStreamingMessageIds}
                  collapsedToolStepIds={collapsedToolStepIds}
                  toolDisplayKey={toolDisplayKey}
                  registerMessageElement={stableRegisterMessageElement}
                  renderToolExecutionBlock={stableRenderToolExecutionBlock}
                  canSubmitAskUserResponse={stableCanSubmitAskUserResponse}
                  onCaptureMessageContext={stableCaptureMessageContext}
                  onCloseMessageContextMenu={stableCloseMessageContextMenu}
                  onCopyLinkHref={stableCopyLinkHref}
                  onCopyMessageContent={stableCopyMessageContent}
                  onRegenerateAssistantMessage={stableRegenerateAssistantMessage}
                  onStartEditingUserMessage={stableStartEditingUserMessage}
                  onDeleteMessage={stableDeleteMessage}
                  onCancelEditingUserMessage={stableCancelEditingUserMessage}
                  onSaveEditedUserMessage={stableSaveEditedUserMessage}
                  onSubmitEditedUserMessage={stableSubmitEditedUserMessage}
                  onSelectAssistantVariant={stableSelectAssistantVariant}
                  onToggleToolExecutionCollapsed={stableToggleToolExecutionCollapsed}
                  onSubmitAskUserResponse={stableSubmitAskUserResponse}
                  onCancelAskUserRequest={stableCancelAskUserRequest}
                  onAskUserLayoutChange={stableHandleAskUserLayoutChange}
                  onAssistantVisualProgress={stableHandleAssistantVisualProgress}
                  onAssistantVisualStreamingChange={
                    stableHandleAssistantVisualStreamingChange
                  }
                />
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
          draftKey={activeChatId ?? ""}
          draft={activeComposerDraft}
          onDraftChange={updateActiveComposerDraft}
          onSend={sendMessage}
          onStop={stopGeneration}
          footerStart={<ComposerFooter
            activeChatExists={Boolean(activeChat)}
            isSending={isSending}
            activeChatProvider={activeChatProvider}
            activeChatModel={activeChatModel}
            visibleProviderGroups={visibleProviderGroups}
            isModelPickerOpen={isSidebarModelComboboxOpen}
            onModelPickerOpenChange={setIsSidebarModelComboboxOpen}
            modelSearchValue={sidebarModelSearchValue}
            onModelSearchValueChange={setSidebarModelSearchValue}
            onSelectProviderModel={selectActiveChatProviderModel}
            visibleChatTools={visibleChatTools}
            selectedToolNames={activeChatEnabledToolNames}
            isToolPickerOpen={isChatToolPickerOpen}
            onToolPickerOpenChange={setIsChatToolPickerOpen}
            toolSearchValue={chatToolSearchValue}
            onToolSearchValueChange={setChatToolSearchValue}
            onToggleTool={toggleActiveChatTool}
          />}
          toolMentionOptions={toolMentionOptions}
        />
      </section>

      <ProviderSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        providers={providers}
        activeProvider={activeProvider}
        onProvidersStateChange={handleProvidersStateChange}
        onProviderSettingChange={handleProviderSettingChange}
        onAddProvider={handleAddProvider}
        onDuplicateProvider={handleDuplicateProvider}
        onDeleteProvider={handleDeleteProvider}
        onSave={handleSaveSettingsChanges}
        showSuccess={stableShowSuccess}
      />

      <ToolsDialog
        open={toolsOpen}
        onOpenChange={setToolsOpen}
        toolsSettings={toolsSettings}
        onToolsSettingsChange={setToolsSettings}
        loadedTools={loadedTools}
        onLoadedToolsChange={setLoadedTools}
        showSuccess={stableShowSuccess}
        showError={stableShowError}
      />

      <SystemPromptDialog
        open={systemPromptOpen}
        value={systemPrompt}
        onOpenChange={setSystemPromptOpen}
        onValueChange={setSystemPrompt}
        showSuccess={stableShowSuccess}
        showError={stableShowError}
      />
    </main>
  );
}
