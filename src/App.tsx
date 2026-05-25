"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ChatComposer,
  type ChatComposerHandle,
  type ToolMentionOption,
} from "@/components/ai-chat/chat-composer";
import { ChatMessageList } from "@/components/ai-chat/chat-message-list";
import { ComposerFooter } from "@/components/ai-chat/composer-footer";
import { EmptyChatState } from "@/components/ai-chat/empty-chat-state";
import { FindBar } from "@/components/ai-chat/find-bar";
import { ToolExecutionBlock } from "@/components/ai-chat/tool-execution-block";
import { ChatSidebar } from "@/components/chat-sidebar";
import { SystemPromptDialog } from "@/components/dialogs/system-prompt-dialog";
import { ProviderSettingsDialog } from "@/components/provider-settings-dialog";
import { SkillsDialog } from "@/components/skills-dialog";
import { ToolsDialog } from "@/components/tools-dialog";
import { Button } from "@/components/ui/button";
import { useChatActions } from "@/hooks/use-chat-actions";
import { useChatAutoscroll } from "@/hooks/use-chat-autoscroll";
import { useChatGeneration } from "@/hooks/use-chat-generation";
import { useMessageContextMenu } from "@/hooks/use-message-context-menu";
import { useStableCallback } from "@/hooks/use-stable-callback";
import {
  ASK_USER_TOOL,
  ASK_USER_TOOL_NAME,
  CHECKLIST_WRITE_TOOL,
  CHECKLIST_WRITE_TOOL_NAME,
  DEFAULT_SKILLS_SETTINGS,
  DEFAULT_TOOLS_SETTINGS,
  WEB_FETCH_TOOL,
  WEB_FETCH_TOOL_NAME,
  compareToolsByDisplayOrder,
  isBuiltInToolName,
  isValidToolName,
} from "@/lib/ai-chat/builtin-tools";
import {
  createNewProvider,
  createProviderId,
  getEffectiveModelContext,
  getEnabledProviderModels,
  getProviderFallbackModel,
  groupChatsByPinnedAndActivityDate,
  labelForError,
  normalizeProviderForState,
  providerDisplayName,
  sortChatsByUpdatedAt,
} from "@/lib/ai-chat/chat-utils";
import { defaultProvider } from "@/lib/ai-chat/provider-presets";
import {
  resolveProviderForChat,
  validateProviderForGeneration,
} from "@/lib/ai-chat/request-builder";
import {
  createEmptyChat,
  loadActiveChatId,
  loadAppSettings,
  loadChats,
  loadProvidersState,
  loadSkills,
  loadSkillsSettings,
  loadSystemPrompt,
  loadTools,
  loadToolsSettings,
  saveActiveChatId,
  saveAppSettings,
  saveChat,
  saveProvidersState,
  saveSkillsSettings,
  saveSystemPrompt,
  saveToolsSettings,
} from "@/lib/ai-chat/storage";
import { generateTitleFromChatContext } from "@/lib/ai-chat/title-generation";
import type {
  AppSettings,
  ChatMessage,
  ChatSession,
  ChatToolCall,
  ChatToolResult,
  LoadedSkillInfo,
  LoadedToolInfo,
  ProviderConfig,
  ProvidersState,
  SkillsSettings,
  ToolExecutionStatus,
  ToolsSettings,
} from "@/lib/ai-chat/types";
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
  const [skillsSettings, setSkillsSettings] = useState<SkillsSettings>(
    DEFAULT_SKILLS_SETTINGS,
  );
  const [appSettings, setAppSettings] = useState<AppSettings>({
    chatTitleGenerationMode: "local",
  });
  const [loadedTools, setLoadedTools] = useState<LoadedToolInfo[]>([]);
  const [loadedSkills, setLoadedSkills] = useState<LoadedSkillInfo[]>([]);
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
  const [titleGenerationChatIds, setTitleGenerationChatIds] = useState<
    string[]
  >([]);
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
  const [isChatSkillPickerOpen, setIsChatSkillPickerOpen] = useState(false);
  const [chatSkillSearchValue, setChatSkillSearchValue] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
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
  const [collapsedThinkingStepIds, setCollapsedThinkingStepIds] = useState<
    Record<string, boolean>
  >({});
  const { messageContextMenu, captureMessageContext, closeMessageContextMenu } =
    useMessageContextMenu();
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

  useEffect(() => {
    if (!findBarOpen) return;

    function handleFindNavigationShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeFindBar();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        findNextMatch(!event.shiftKey);
        return;
      }

      if (event.key === "F3") {
        event.preventDefault();
        event.stopPropagation();
        findNextMatch(!event.shiftKey);
      }
    }

    document.addEventListener("keydown", handleFindNavigationShortcut);

    return () => {
      document.removeEventListener("keydown", handleFindNavigationShortcut);
    };
  }, [closeFindBar, findBarOpen, findNextMatch]);

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
  const groupedChatList = useMemo(
    () => groupChatsByPinnedAndActivityDate(sortedChats),
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
  const activeChatProvider = activeProvider;
  const activeChatModel = getProviderFallbackModel(activeChatProvider);
  const isSending = activeChat
    ? generatingChatIds.includes(activeChat.id)
    : false;
  const latestContextUsage = useMemo(() => {
    const context = getEffectiveModelContext(
      activeChatProvider,
      activeChatModel,
    );
    const assistantMessages = [...messages]
      .reverse()
      .filter((message) => message.role === "assistant");

    for (const message of assistantMessages) {
      if (message.role !== "assistant") continue;
      const variant = message.variants[message.activeVariantIndex];
      const usage = variant?.metrics?.tokenUsage;
      const usedTokens = usage?.promptTokens ?? usage?.totalTokens;
      if (usedTokens !== undefined && Number.isFinite(usedTokens)) {
        return {
          usedTokens,
          limitTokens: context.length,
          limitSource: context.source,
        };
      }
    }

    return {
      usedTokens: undefined,
      limitTokens: context.length,
      limitSource: context.source,
    };
  }, [activeChatModel, activeChatProvider, messages]);
  const visibleProviderGroups = useMemo(() => {
    const search = sidebarModelSearchValue.trim().toLowerCase();

    return providers
      .map((provider) => {
        const models = getEnabledProviderModels(provider).filter((model) =>
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

    for (const tool of [
      ASK_USER_TOOL,
      CHECKLIST_WRITE_TOOL,
      WEB_FETCH_TOOL,
      ...loadedTools,
    ]) {
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
    if (toolsSettings.webFetchEnabled) names.add(WEB_FETCH_TOOL_NAME);

    for (const tool of loadedTools) {
      if (
        tool.enabled &&
        tool.name !== ASK_USER_TOOL_NAME &&
        tool.name !== CHECKLIST_WRITE_TOOL_NAME &&
        tool.name !== WEB_FETCH_TOOL_NAME &&
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

  const availableSkills = useMemo(() => {
    const byName = new Map<string, LoadedSkillInfo>();

    for (const skill of loadedSkills) {
      if (!isValidToolName(skill.name) || byName.has(skill.name)) continue;
      byName.set(skill.name, skill);
    }

    return [...byName.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [loadedSkills]);

  const availableSkillsByName = useMemo(() => {
    return new Map(
      availableSkills.map((skill) => [skill.name, skill] as const),
    );
  }, [availableSkills]);

  const globallyEnabledSkillNames = useMemo(() => {
    if (!skillsSettings.enabled) return new Set<string>();

    return new Set(
      availableSkills
        .filter((skill) => skill.enabled)
        .map((skill) => skill.name),
    );
  }, [availableSkills, skillsSettings.enabled]);

  const activeChatEnabledSkillNames = useMemo(() => {
    if (!activeChat) return [];

    const chatEnabled = new Set(activeChat.enabledSkillNames ?? []);
    const chatDisabled = new Set(activeChat.disabledSkillNames ?? []);

    return availableSkills
      .map((skill) => skill.name)
      .filter(
        (skillName) =>
          !chatDisabled.has(skillName) &&
          (globallyEnabledSkillNames.has(skillName) ||
            chatEnabled.has(skillName)),
      );
  }, [
    activeChat?.disabledSkillNames,
    activeChat?.enabledSkillNames,
    activeChat?.id,
    availableSkills,
    globallyEnabledSkillNames,
  ]);

  const visibleChatSkills = useMemo(() => {
    const search = chatSkillSearchValue.trim().toLowerCase();

    if (!search) return availableSkills;

    return availableSkills.filter((skill) =>
      `${skill.name} ${skill.description}`.toLowerCase().includes(search),
    );
  }, [availableSkills, chatSkillSearchValue]);

  const skillMentionOptions = useMemo(
    () =>
      availableSkills.map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
    [availableSkills],
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
          loadedSkillsSettings,
          loadedAppSettings,
          loadedToolManifests,
          loadedSkillManifests,
        ] = await Promise.all([
          loadProvidersState(),
          loadSystemPrompt(),
          loadChats(),
          loadActiveChatId(),
          loadToolsSettings(),
          loadSkillsSettings(),
          loadAppSettings(),
          loadTools(),
          loadSkills(),
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
        let nextChats = loadedChats;
        let nextActiveChatId = loadedActiveChatId;

        if (nextChats.length === 0) {
          const chat = createEmptyChat();
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
        setSkillsSettings(loadedSkillsSettings);
        setAppSettings(loadedAppSettings);
        setLoadedTools(loadedToolManifests);
        setLoadedSkills(loadedSkillManifests);
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
        const fallbackChat = createEmptyChat();
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
    if (!didHydrateRef.current) return;
    saveSkillsSettings(skillsSettings).catch((error) =>
      console.error("Failed to save skills settings:", error),
    );
  }, [skillsSettings]);

  useEffect(() => {
    if (!didHydrateRef.current) return;
    saveAppSettings(appSettings).catch((error) =>
      console.error("Failed to save app settings:", error),
    );
  }, [appSettings]);

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

  function toggleThinkingCollapsed(stepId: string, nextCollapsed: boolean) {
    setCollapsedThinkingStepIds((current) => ({
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
        key={id}
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
    continueAssistantMessage,
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
    skillsSettings,
    chatTitleGenerationMode: appSettings.chatTitleGenerationMode,
    loadedTools,
    availableToolsByName,
    loadedSkills,
    availableSkillsByName,
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
          ? normalizeProviderForState({
              ...provider,
              ...patch,
              id: provider.id,
            })
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

  }

  function selectActiveChatProviderModel(providerId: string, model: string) {
    const normalizedModel = model.trim();
    if (!normalizedModel) return;

    setProvidersState((currentState) => ({
      ...currentState,
      activeProviderId: providerId,
      providers: currentState.providers.map((provider) =>
        provider.id === providerId
          ? normalizeProviderForState({ ...provider, model: normalizedModel })
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
    branchChatFromMessage,
    toggleActiveChatTool,
    toggleActiveChatSkill,
    renameChat,
    toggleChatPinned,
  } = useChatActions({
    activeChat,
    activeChatId,
    availableTools,
    availableSkills,
    chats,
    globallyEnabledToolNames,
    globallyEnabledSkillNames,
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

  async function generateChatTitle(chatId: string) {
    const chat = chats.find((item) => item.id === chatId);
    if (!chat) return;

    if (isChatGenerating(chatId) || titleGenerationChatIds.includes(chatId)) {
      showInfo("Wait until generation finishes before generating a title.");
      return;
    }

    if (chat.messages.length === 0) {
      showInfo("Send a message before generating a title.");
      return;
    }

    const providerForRun = resolveProviderForChat({
      chat,
      providers,
      activeProvider,
    });
    const validation = validateProviderForGeneration(providerForRun);

    if (!validation.ok) {
      showError(validation.message, validation.description);
      if (validation.shouldOpenSettings) setSettingsOpen(true);
      return;
    }

    setTitleGenerationChatIds((currentChatIds) => [
      ...new Set([...currentChatIds, chatId]),
    ]);

    try {
      const title = await generateTitleFromChatContext({
        provider: providerForRun,
        messages: chat.messages,
      });

      if (!title) {
        showError("Failed to generate title.");
        return;
      }

      updateChat(chatId, (currentChat) => ({
        ...currentChat,
        title,
        titleMode: "manual",
        updatedAt: new Date().toISOString(),
      }));
      showSuccess("Title generated.");
    } catch (error) {
      console.error("Failed to generate chat title:", error);
      showError("Failed to generate title", labelForError(error));
    } finally {
      setTitleGenerationChatIds((currentChatIds) =>
        currentChatIds.filter((currentChatId) => currentChatId !== chatId),
      );
    }
  }

  const handleProvidersStateChange = useStableCallback(updateProvidersState);
  const handleProviderSettingChange = useStableCallback(updateProviderSetting);
  const handleAddProvider = useStableCallback(addProvider);
  const handleDuplicateProvider = useStableCallback(duplicateProvider);
  const handleDeleteProvider = useStableCallback(deleteProvider);
  const handleSaveSettingsChanges = useStableCallback(saveSettingsChanges);
  const stableRenameChat = useStableCallback(renameChat);
  const stableToggleChatPinned = useStableCallback(toggleChatPinned);
  const stableGenerateChatTitle = useStableCallback(generateChatTitle);
  const stableShowSuccess = useStableCallback(showSuccess);
  const stableShowError = useStableCallback(showError);
  const toolDisplayKey = useMemo(
    () =>
      loadedTools
        .map((tool) => `${tool.name}:${tool.description ?? ""}`)
        .join("\n"),
    [loadedTools],
  );
  const skillDisplayKey = useMemo(
    () =>
      availableSkills
        .map((skill) => `${skill.name}:${skill.description ?? ""}`)
        .join("\n"),
    [availableSkills],
  );
  const stableRegisterMessageElement = useStableCallback(
    registerMessageElement,
  );
  const stableRenderToolExecutionBlock = useStableCallback(
    renderToolExecutionBlock,
  );
  const stableCanSubmitAskUserResponse = useStableCallback(
    canSubmitAskUserResponse,
  );
  const stableCaptureMessageContext = useStableCallback(captureMessageContext);
  const stableCloseMessageContextMenu = useStableCallback(
    closeMessageContextMenu,
  );
  const stableCopyLinkHref = useStableCallback(copyLinkHref);
  const stableCopyMessageContent = useStableCallback(copyMessageContent);
  const stableBranchChatFromMessage = useStableCallback(branchChatFromMessage);
  const stableRegenerateAssistantMessage = useStableCallback(
    regenerateAssistantMessage,
  );
  const stableContinueAssistantMessage = useStableCallback(
    continueAssistantMessage,
  );
  const stableStartEditingUserMessage = useStableCallback(
    startEditingUserMessage,
  );
  const stableDeleteMessage = useStableCallback(deleteMessage);
  const stableCancelEditingUserMessage = useStableCallback(
    cancelEditingUserMessage,
  );
  const stableSaveEditedUserMessage = useStableCallback(saveEditedUserMessage);
  const stableSubmitEditedUserMessage = useStableCallback(
    submitEditedUserMessage,
  );
  const stableSelectAssistantVariant = useStableCallback(
    selectAssistantVariant,
  );
  const stableToggleToolExecutionCollapsed = useStableCallback(
    toggleToolExecutionCollapsed,
  );
  const stableToggleThinkingCollapsed = useStableCallback(
    toggleThinkingCollapsed,
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
        pinnedChats={groupedChatList.pinnedChats}
        groupedChats={groupedChatList.groups}
        activeChatId={activeChat?.id}
        isCollapsed={isSidebarCollapsed}
        chatTitleGenerationMode={appSettings.chatTitleGenerationMode}
        generatingChatIds={generatingChatIds}
        titleGenerationChatIds={titleGenerationChatIds}
        resolvedTheme={resolvedTheme}
        onCollapsedChange={setIsSidebarCollapsed}
        onSwitchChat={switchChat}
        onRenameChat={stableRenameChat}
        onToggleChatPinned={stableToggleChatPinned}
        onGenerateChatTitle={stableGenerateChatTitle}
        onRemoveChat={removeChat}
        onCreateNewChat={createNewChat}
        onOpenProviders={() => setSettingsOpen(true)}
        onOpenTools={() => setToolsOpen(true)}
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenSystemPrompt={() => setSystemPromptOpen(true)}
        onToggleAiTitleGeneration={(checked) =>
          setAppSettings((currentSettings) => ({
            ...currentSettings,
            chatTitleGenerationMode: checked ? "ai" : "local",
          }))
        }
        onSetTheme={setTheme}
        onClearCurrentChat={clearCurrentChat}
      />

      <section className="relative grid min-h-0 flex-1 grid-rows-[1fr_auto] bg-background px-4">
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
                "mx-auto flex w-full min-w-0 max-w-4xl   flex-col [overflow-anchor:none]",
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
                  collapsedThinkingStepIds={collapsedThinkingStepIds}
                  toolDisplayKey={toolDisplayKey}
                  skillDisplayKey={skillDisplayKey}
                  toolMentionOptions={toolMentionOptions}
                  skillMentionOptions={skillMentionOptions}
                  registerMessageElement={stableRegisterMessageElement}
                  renderToolExecutionBlock={stableRenderToolExecutionBlock}
                  canSubmitAskUserResponse={stableCanSubmitAskUserResponse}
                  onCaptureMessageContext={stableCaptureMessageContext}
                  onCloseMessageContextMenu={stableCloseMessageContextMenu}
                  onCopyLinkHref={stableCopyLinkHref}
                  onCopyMessageContent={stableCopyMessageContent}
                  onBranchFromMessage={stableBranchChatFromMessage}
                  onRegenerateAssistantMessage={
                    stableRegenerateAssistantMessage
                  }
                  onContinueAssistantMessage={stableContinueAssistantMessage}
                  onStartEditingUserMessage={stableStartEditingUserMessage}
                  onDeleteMessage={stableDeleteMessage}
                  onCancelEditingUserMessage={stableCancelEditingUserMessage}
                  onSaveEditedUserMessage={stableSaveEditedUserMessage}
                  onSubmitEditedUserMessage={stableSubmitEditedUserMessage}
                  onSelectAssistantVariant={stableSelectAssistantVariant}
                  onToggleToolExecutionCollapsed={
                    stableToggleToolExecutionCollapsed
                  }
                  onToggleThinkingCollapsed={stableToggleThinkingCollapsed}
                  onSubmitAskUserResponse={stableSubmitAskUserResponse}
                  onCancelAskUserRequest={stableCancelAskUserRequest}
                  onAskUserLayoutChange={stableHandleAskUserLayoutChange}
                  onAssistantVisualProgress={
                    stableHandleAssistantVisualProgress
                  }
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
                <div className="mx-auto flex w-full max-w-4xl justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="pointer-events-auto  shadow-md opacity-80 hover:opacity-100"
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
          contextUsage={latestContextUsage}
          footerStart={
            <ComposerFooter
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
              visibleChatSkills={visibleChatSkills}
              selectedSkillNames={activeChatEnabledSkillNames}
              activeSkillNames={activeChat?.activeSkillNames ?? []}
              isSkillPickerOpen={isChatSkillPickerOpen}
              onSkillPickerOpenChange={setIsChatSkillPickerOpen}
              skillSearchValue={chatSkillSearchValue}
              onSkillSearchValueChange={setChatSkillSearchValue}
              onToggleSkill={toggleActiveChatSkill}
            />
          }
          toolMentionOptions={toolMentionOptions}
          skillMentionOptions={skillMentionOptions}
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

      <SkillsDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
        skillsSettings={skillsSettings}
        onSkillsSettingsChange={setSkillsSettings}
        loadedSkills={loadedSkills}
        onLoadedSkillsChange={setLoadedSkills}
        availableTools={availableTools}
        showSuccess={stableShowSuccess}
        showError={stableShowError}
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
