"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentsDialog } from "@/components/agents-dialog";
import { ChatCapabilitiesDialog } from "@/components/ai-chat/chat-capabilities-dialog";
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
import { WorkspaceRootsControl } from "@/components/ai-chat/workspace-roots-control";
import { ChatSidebar } from "@/components/chat-sidebar";
import { SystemPromptDialog } from "@/components/dialogs/system-prompt-dialog";
import { ProviderSettingsDialog } from "@/components/provider-settings-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { SkillsDialog } from "@/components/skills-dialog";
import { ToolsDialog } from "@/components/tools-dialog";
import { Button } from "@/components/ui/button";
import { useChatActions } from "@/hooks/use-chat-actions";
import { useChatAutoscroll } from "@/hooks/use-chat-autoscroll";
import { useChatGeneration } from "@/hooks/use-chat-generation";
import { useMessageContextMenu } from "@/hooks/use-message-context-menu";
import { useStableCallback } from "@/hooks/use-stable-callback";
import {
  createBuiltInAgents,
  isBuiltInAgentName,
} from "@/lib/ai-chat/builtin-agents";
import {
  ASK_USER_TOOL,
  ASK_USER_TOOL_NAME,
  DEFAULT_AGENTS_SETTINGS,
  DEFAULT_SKILLS_SETTINGS,
  DEFAULT_TOOLS_SETTINGS,
  FILE_CREATE_TOOL,
  FILE_CREATE_TOOL_NAME,
  FILE_DELETE_TOOL,
  FILE_DELETE_TOOL_NAME,
  FILE_FIND_TOOL,
  FILE_FIND_TOOL_NAME,
  FILE_READ_TOOL,
  FILE_READ_TOOL_NAME,
  FILE_REPLACE_TEXT_TOOL,
  FILE_REPLACE_TEXT_TOOL_NAME,
  FILE_SEARCH_TEXT_TOOL,
  FILE_SEARCH_TEXT_TOOL_NAME,
  TASK_TOOLS,
  WEB_FETCH_TOOL,
  WEB_FETCH_TOOL_NAME,
  buildFileToolAutoApprovalFromToolsSettings,
  compareToolsByDisplayOrder,
  isBuiltInToolName,
  isTaskToolName,
  isValidToolName,
} from "@/lib/ai-chat/builtin-tools";
import {
  createId,
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
  loadAgents,
  loadAgentsSettings,
  loadAppSettings,
  loadChats,
  loadProvidersState,
  loadSkills,
  loadSkillsSettings,
  loadSystemPrompt,
  loadTools,
  loadToolsSettings,
  saveActiveChatId,
  saveAgentsSettings,
  saveAppSettings,
  saveChat,
  saveProvidersState,
  saveSkillsSettings,
  saveSystemPrompt,
  saveToolsSettings,
} from "@/lib/ai-chat/storage";
import { generateTitleFromChatContext } from "@/lib/ai-chat/title-generation";
import type {
  AgentsSettings,
  AppSettings,
  ChatMessage,
  ChatSession,
  ChatToolCall,
  ChatToolResult,
  ChatWorkspaceRoot,
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  ProviderConfig,
  ProvidersState,
  SkillsSettings,
  ToolCommandResult,
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
  const [agentsSettings, setAgentsSettings] = useState<AgentsSettings>(
    DEFAULT_AGENTS_SETTINGS,
  );
  const [appSettings, setAppSettings] = useState<AppSettings>({
    chatTitleGenerationMode: "local",
    fontFamily: "sans",
  });
  const [loadedTools, setLoadedTools] = useState<LoadedToolInfo[]>([]);
  const [loadedSkills, setLoadedSkills] = useState<LoadedSkillInfo[]>([]);
  const [loadedAgents, setLoadedAgents] = useState<LoadedAgentInfo[]>([]);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  const [chatSwitchLoadingChatId, setChatSwitchLoadingChatId] = useState<
    string | null
  >(null);
  const [initialComposerDrafts] = useState<Record<string, string>>(() =>
    loadComposerDrafts(),
  );
  const composerDraftsRef = useRef<Record<string, string>>(
    initialComposerDrafts,
  );
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [generatingChatIds, setGeneratingChatIds] = useState<string[]>([]);
  const [completedGenerationChatIds, setCompletedGenerationChatIds] = useState<
    string[]
  >([]);
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
  const [isChatCapabilitiesDialogOpen, setIsChatCapabilitiesDialogOpen] =
    useState(false);
  const [isChatToolPickerOpen, setIsChatToolPickerOpen] = useState(false);
  const [chatToolSearchValue, setChatToolSearchValue] = useState("");
  const [isWorkspacePickerOpen, setIsWorkspacePickerOpen] = useState(false);
  const [isChatSkillPickerOpen, setIsChatSkillPickerOpen] = useState(false);
  const [chatSkillSearchValue, setChatSkillSearchValue] = useState("");
  const [isChatAgentPickerOpen, setIsChatAgentPickerOpen] = useState(false);
  const [chatAgentSearchValue, setChatAgentSearchValue] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
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
  const pendingChatSwitchTargetRef = useRef<string | null>(null);
  const pendingChatSwitchFrameRef = useRef<number | null>(null);
  const finishChatSwitchLoadingFrameRef = useRef<number | null>(null);

  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    document.title = APP_TITLE;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.chatFont = appSettings.fontFamily;
  }, [appSettings.fontFamily]);

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
      ...TASK_TOOLS,
      WEB_FETCH_TOOL,
      FILE_READ_TOOL,
      FILE_FIND_TOOL,
      FILE_SEARCH_TEXT_TOOL,
      FILE_REPLACE_TEXT_TOOL,
      FILE_CREATE_TOOL,
      FILE_DELETE_TOOL,
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
    if (toolsSettings.taskToolsEnabled) {
      for (const tool of TASK_TOOLS) names.add(tool.name);
    }
    if (toolsSettings.webFetchEnabled) names.add(WEB_FETCH_TOOL_NAME);
    if (toolsSettings.fileReadEnabled) names.add(FILE_READ_TOOL_NAME);
    if (toolsSettings.fileFindEnabled) names.add(FILE_FIND_TOOL_NAME);
    if (toolsSettings.fileSearchTextEnabled)
      names.add(FILE_SEARCH_TEXT_TOOL_NAME);
    if (toolsSettings.fileReplaceTextEnabled)
      names.add(FILE_REPLACE_TEXT_TOOL_NAME);
    if (toolsSettings.fileCreateEnabled) names.add(FILE_CREATE_TOOL_NAME);
    if (toolsSettings.fileDeleteEnabled) names.add(FILE_DELETE_TOOL_NAME);

    for (const tool of loadedTools) {
      if (
        tool.enabled &&
        tool.name !== ASK_USER_TOOL_NAME &&
        !isTaskToolName(tool.name) &&
        tool.name !== WEB_FETCH_TOOL_NAME &&
        tool.name !== FILE_READ_TOOL_NAME &&
        tool.name !== FILE_FIND_TOOL_NAME &&
        tool.name !== FILE_SEARCH_TEXT_TOOL_NAME &&
        tool.name !== FILE_REPLACE_TEXT_TOOL_NAME &&
        tool.name !== FILE_CREATE_TOOL_NAME &&
        tool.name !== FILE_DELETE_TOOL_NAME &&
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
  const availableAgents = useMemo(() => {
    const byName = new Map<string, LoadedAgentInfo>();

    for (const agent of createBuiltInAgents()) {
      byName.set(agent.name, agent);
    }

    for (const agent of loadedAgents) {
      if (
        !isValidToolName(agent.name) ||
        isBuiltInAgentName(agent.name) ||
        byName.has(agent.name)
      ) {
        continue;
      }
      byName.set(agent.name, agent);
    }

    return [...byName.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [loadedAgents]);

  const availableAgentsByName = useMemo(() => {
    return new Map(
      availableAgents.map((agent) => [agent.name, agent] as const),
    );
  }, [availableAgents]);

  const agentMentionOptions = useMemo(
    () =>
      availableAgents.map((agent) => ({
        name: agent.name,
        description: agent.description,
      })),
    [availableAgents],
  );

  const globallyEnabledAgentNames = useMemo(() => {
    if (!agentsSettings.enabled) return new Set<string>();

    return new Set(
      availableAgents
        .filter((agent) => agent.enabled)
        .map((agent) => agent.name),
    );
  }, [agentsSettings.enabled, availableAgents]);

  const activeChatEnabledAgentNames = useMemo(() => {
    if (!activeChat) return [];

    const chatEnabled = new Set(activeChat.enabledAgentNames ?? []);
    const chatDisabled = new Set(activeChat.disabledAgentNames ?? []);

    return availableAgents
      .map((agent) => agent.name)
      .filter(
        (agentName) =>
          !chatDisabled.has(agentName) &&
          (globallyEnabledAgentNames.has(agentName) ||
            chatEnabled.has(agentName)),
      );
  }, [
    activeChat?.disabledAgentNames,
    activeChat?.enabledAgentNames,
    activeChat?.id,
    availableAgents,
    globallyEnabledAgentNames,
  ]);

  const visibleChatAgents = useMemo(() => {
    const search = chatAgentSearchValue.trim().toLowerCase();

    if (!search) return availableAgents;

    return availableAgents.filter((agent) =>
      `${agent.name} ${agent.description}`.toLowerCase().includes(search),
    );
  }, [availableAgents, chatAgentSearchValue]);

  const agentDisplayKey = useMemo(
    () =>
      availableAgents
        .map((agent) => `${agent.name}:${agent.enabled ? 1 : 0}`)
        .join("|"),
    [availableAgents],
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
    saveCurrentChatScrollSnapshot,
    forgetChatScrollSnapshot,
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
          loadedAgentsSettings,
          loadedAppSettings,
          loadedToolManifests,
          loadedSkillManifests,
          loadedAgentManifests,
        ] = await Promise.all([
          loadProvidersState(),
          loadSystemPrompt(),
          loadChats(),
          loadActiveChatId(),
          loadToolsSettings(),
          loadSkillsSettings(),
          loadAgentsSettings(),
          loadAppSettings(),
          loadTools(),
          loadSkills(),
          loadAgents(),
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
          const chat = {
            ...createEmptyChat(),
            fileToolAutoApproval:
              buildFileToolAutoApprovalFromToolsSettings(loadedToolsSettings),
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
        setSkillsSettings(loadedSkillsSettings);
        setAgentsSettings(loadedAgentsSettings);
        setAppSettings(loadedAppSettings);
        setLoadedTools(loadedToolManifests);
        setLoadedSkills(loadedSkillManifests);
        setLoadedAgents(loadedAgentManifests);
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
          fileToolAutoApproval:
            buildFileToolAutoApprovalFromToolsSettings(toolsSettings),
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
        if (activeChatId) void clearChat(activeChatId);
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
    saveAgentsSettings(agentsSettings).catch((error) =>
      console.error("Failed to save agents settings:", error),
    );
  }, [agentsSettings]);

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

  const activeChatIdRef = useRef(activeChatId);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
    if (!activeChatId) return;
    setCompletedGenerationChatIds((currentChatIds) =>
      currentChatIds.filter((chatId) => chatId !== activeChatId),
    );
  }, [activeChatId]);

  useEffect(() => {
    setCompletedGenerationChatIds((currentChatIds) =>
      currentChatIds.filter(
        (chatId) =>
          !generatingChatIds.includes(chatId) &&
          chats.some((chat) => chat.id === chatId),
      ),
    );
  }, [chats, generatingChatIds]);

  function getToolsBridge() {
    if (!window.chatForgeTools) {
      throw new Error("Electron tools bridge is not available.");
    }

    return window.chatForgeTools;
  }

  function getWorkspaceBridge() {
    if (!window.chatForgeWorkspace) {
      throw new Error("Electron workspace bridge is not available.");
    }

    return window.chatForgeWorkspace;
  }

  async function addActiveChatWorkspaceRoot() {
    if (!activeChat) return;

    try {
      const result = await getWorkspaceBridge().selectFolder();
      if (result.cancelled) return;

      const now = new Date().toISOString();
      const root: ChatWorkspaceRoot = {
        id: createId(),
        name: result.name || result.path,
        path: result.path,
        createdAt: now,
      };

      updateChat(activeChat.id, (chat) => {
        const existingRoots = chat.workspaceRoots ?? [];
        if (existingRoots.some((item) => item.path === root.path)) {
          return chat;
        }

        return {
          ...chat,
          workspaceRoots: [...existingRoots, root],
          updatedAt: now,
        };
      });

      showSuccess("Workspace folder added.");
    } catch (error) {
      console.error("Failed to add workspace folder:", error);
      showError("Failed to add workspace folder.", labelForError(error));
    }
  }

  function removeActiveChatWorkspaceRoot(rootId: string) {
    if (!activeChat) return;

    updateChat(activeChat.id, (chat) => ({
      ...chat,
      workspaceRoots: (chat.workspaceRoots ?? []).filter(
        (root) => root.id !== rootId,
      ),
      updatedAt: new Date().toISOString(),
    }));
    showSuccess("Workspace folder removed from chat.");
  }

  async function openWorkspaceRoot(root: ChatWorkspaceRoot) {
    try {
      await getWorkspaceBridge().openFolder(root.path);
    } catch (error) {
      console.error("Failed to open workspace folder:", error);
      showError("Failed to open workspace folder.", labelForError(error));
    }
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
    isCollapsed,
    onToggleCollapsed,
  }: {
    id: string;
    toolCall: ChatToolCall;
    toolResult?: ChatToolResult;
    status?: ToolExecutionStatus;
    isCollapsed?: boolean;
    onToggleCollapsed?: (stepId: string, nextCollapsed: boolean) => void;
  }) {
    return (
      <ToolExecutionBlock
        key={id}
        id={id}
        toolCall={toolCall}
        toolResult={toolResult}
        status={status}
        loadedTools={loadedTools}
        isCollapsed={isCollapsed ?? isToolExecutionCollapsed(id)}
        onToggleCollapsed={onToggleCollapsed ?? toggleToolExecutionCollapsed}
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
    submitFileToolApprovalResponse,
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
    agentsSettings,
    chatTitleGenerationMode: appSettings.chatTitleGenerationMode,
    loadedTools,
    availableToolsByName,
    loadedSkills,
    availableSkillsByName,
    loadedAgents: availableAgents,
    availableAgentsByName,
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
    executeExternalTool: (toolName, args, context) => {
      const bridge = getToolsBridge();
      const executionId = createId();

      return new Promise<ToolCommandResult>((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
          context?.signal?.removeEventListener("abort", abortHandler);
        };

        const settleResolve = (value: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value as Awaited<ReturnType<typeof bridge.execute>>);
        };

        const settleReject = (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };

        const abortHandler = () => {
          void bridge.cancel(executionId).catch(() => undefined);
          settleReject(
            new DOMException("Tool execution was cancelled.", "AbortError"),
          );
        };

        if (context?.signal?.aborted) {
          abortHandler();
          return;
        }

        context?.signal?.addEventListener("abort", abortHandler, {
          once: true,
        });
        bridge
          .execute({
            executionId,
            name: toolName,
            args,
            workspaceRoots: context?.workspaceRoots,
          })
          .then(settleResolve, settleReject);
      });
    },
    onChatGenerationFinished: (chatId, options) => {
      if (options.wasCancelled || activeChatIdRef.current === chatId) return;
      setCompletedGenerationChatIds((currentChatIds) => [
        ...new Set([...currentChatIds, chatId]),
      ]);
    },
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
      setProviderSettingsOpen(false);
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
    createChatWithSameSettings,
    switchChat,
    clearChat,
    removeChat,
    branchChatFromMessage,
    toggleActiveChatTool,
    toggleActiveChatFileToolAutoApproval,
    setActiveChatThinkingMode,
    toggleActiveChatSkill,
    toggleActiveChatAgent,
    renameChat,
    toggleChatPinned,
  } = useChatActions({
    activeChat,
    activeChatId,
    availableTools,
    availableSkills,
    availableAgents,
    chats,
    globallyEnabledToolNames,
    globallyEnabledSkillNames,
    globallyEnabledAgentNames,
    fileToolAutoApprovalDefaults:
      buildFileToolAutoApprovalFromToolsSettings(toolsSettings),
    isSending,
    messageElementRefs,
    setActiveChatId,
    setChats,
    setCopiedMessageId,
    setEditingMessageId,
    resetChatScrollState,
    saveCurrentChatScrollSnapshot,
    forgetChatScrollSnapshot,
    focusDraftTextarea,
    isChatGenerating,
    stopChatGeneration,
    showError,
    showInfo,
    showSuccess,
    updateActiveChatMessages,
    updateChat,
  });

  function cancelPendingChatSwitchFrames() {
    if (pendingChatSwitchFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingChatSwitchFrameRef.current);
      pendingChatSwitchFrameRef.current = null;
    }

    if (finishChatSwitchLoadingFrameRef.current !== null) {
      window.cancelAnimationFrame(finishChatSwitchLoadingFrameRef.current);
      finishChatSwitchLoadingFrameRef.current = null;
    }
  }

  function switchChatWithLoading(chatId: string) {
    if (chatId === activeChatId) {
      void switchChat(chatId);
      return;
    }

    cancelPendingChatSwitchFrames();
    pendingChatSwitchTargetRef.current = chatId;
    setChatSwitchLoadingChatId(chatId);

    pendingChatSwitchFrameRef.current = window.requestAnimationFrame(() => {
      pendingChatSwitchFrameRef.current = window.requestAnimationFrame(() => {
        pendingChatSwitchFrameRef.current = null;

        if (pendingChatSwitchTargetRef.current !== chatId) return;

        void switchChat(chatId);
      });
    });
  }

  useEffect(() => {
    if (!chatSwitchLoadingChatId) return;
    if (activeChatId !== chatSwitchLoadingChatId) return;

    finishChatSwitchLoadingFrameRef.current = window.requestAnimationFrame(
      () => {
        finishChatSwitchLoadingFrameRef.current = null;

        if (pendingChatSwitchTargetRef.current !== chatSwitchLoadingChatId) {
          return;
        }

        pendingChatSwitchTargetRef.current = null;
        setChatSwitchLoadingChatId(null);
      },
    );

    return () => {
      if (finishChatSwitchLoadingFrameRef.current !== null) {
        window.cancelAnimationFrame(finishChatSwitchLoadingFrameRef.current);
        finishChatSwitchLoadingFrameRef.current = null;
      }
    };
  }, [activeChatId, chatSwitchLoadingChatId]);

  useEffect(() => {
    return () => {
      cancelPendingChatSwitchFrames();
    };
  }, []);

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
  const stableSubmitFileToolApprovalResponse = useStableCallback(
    submitFileToolApprovalResponse,
  );
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

  const showChatSwitchLoading = Boolean(chatSwitchLoadingChatId);

  if (!mounted) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4 text-center">
          <div
            className="chat-forge-loading-text text-muted-foreground"
            aria-label="Loading app data"
          />
        </div>
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
        generatingChatIds={generatingChatIds}
        completedGenerationChatIds={completedGenerationChatIds}
        titleGenerationChatIds={titleGenerationChatIds}
        onCollapsedChange={setIsSidebarCollapsed}
        onSwitchChat={(chatId) => {
          setCompletedGenerationChatIds((currentChatIds) =>
            currentChatIds.filter((currentChatId) => currentChatId !== chatId),
          );
          switchChatWithLoading(chatId);
        }}
        onRenameChat={stableRenameChat}
        onToggleChatPinned={stableToggleChatPinned}
        onGenerateChatTitle={stableGenerateChatTitle}
        onRemoveChat={(chatId) => {
          setCompletedGenerationChatIds((currentChatIds) =>
            currentChatIds.filter((currentChatId) => currentChatId !== chatId),
          );
          void removeChat(chatId);
        }}
        onCreateNewChat={createNewChat}
        onCreateChatWithSameSettings={createChatWithSameSettings}
        onOpenSettings={() => setSettingsOpen(true)}
        onClearChat={(chatId) => {
          setCompletedGenerationChatIds((currentChatIds) =>
            currentChatIds.filter((currentChatId) => currentChatId !== chatId),
          );
          void clearChat(chatId);
        }}
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
          {showChatSwitchLoading && (
            <div
              className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-background/45 text-foreground backdrop-blur-lg"
              aria-label="Loading chat"
              aria-live="polite"
            >
              <div className="select-none px-8 py-4 text-[30px] font-bold leading-tight text-muted-foreground">
                Loading...
              </div>
            </div>
          )}

          <div
            ref={chatScrollRef}
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
                <EmptyChatState
                  onOpenProviders={() => setProviderSettingsOpen(true)}
                />
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
                  agentDisplayKey={agentDisplayKey}
                  toolMentionOptions={toolMentionOptions}
                  skillMentionOptions={skillMentionOptions}
                  agentMentionOptions={agentMentionOptions}
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
                  onSubmitFileToolApprovalResponse={
                    stableSubmitFileToolApprovalResponse
                  }
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
              workspaceControl={
                <WorkspaceRootsControl
                  activeChatExists={Boolean(activeChat)}
                  disabled={isSending}
                  roots={activeChat?.workspaceRoots ?? []}
                  open={isWorkspacePickerOpen}
                  onOpenChange={setIsWorkspacePickerOpen}
                  onAddRoot={addActiveChatWorkspaceRoot}
                  onRemoveRoot={removeActiveChatWorkspaceRoot}
                  onOpenRoot={openWorkspaceRoot}
                />
              }
              onOpenCapabilities={() => setIsChatCapabilitiesDialogOpen(true)}
            />
          }
          toolMentionOptions={toolMentionOptions}
          skillMentionOptions={skillMentionOptions}
          agentMentionOptions={agentMentionOptions}
        />
      </section>

      <ChatCapabilitiesDialog
        open={isChatCapabilitiesDialogOpen}
        onOpenChange={setIsChatCapabilitiesDialogOpen}
        tools={availableTools}
        selectedToolNames={activeChatEnabledToolNames}
        onToggleTool={toggleActiveChatTool}
        fileToolAutoApproval={activeChat?.fileToolAutoApproval ?? {}}
        onToggleFileToolAutoApproval={toggleActiveChatFileToolAutoApproval}
        skills={availableSkills}
        selectedSkillNames={activeChatEnabledSkillNames}
        activeSkillNames={activeChat?.activeSkillNames ?? []}
        onToggleSkill={toggleActiveChatSkill}
        agents={availableAgents}
        selectedAgentNames={activeChatEnabledAgentNames}
        onToggleAgent={toggleActiveChatAgent}
        thinkingMode={activeChat?.thinkingMode ?? "model_default"}
        onThinkingModeChange={setActiveChatThinkingMode}
        disabled={isSending}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        chatTitleGenerationMode={appSettings.chatTitleGenerationMode}
        appFontFamily={appSettings.fontFamily}
        resolvedTheme={resolvedTheme}
        onToggleAiTitleGeneration={(checked) =>
          setAppSettings((currentSettings) => ({
            ...currentSettings,
            chatTitleGenerationMode: checked ? "ai" : "local",
          }))
        }
        onSetTheme={setTheme}
        onSetAppFontFamily={(fontFamily) =>
          setAppSettings((currentSettings) => ({
            ...currentSettings,
            fontFamily,
          }))
        }
        onOpenProviders={() => setProviderSettingsOpen(true)}
        onOpenTools={() => setToolsOpen(true)}
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenAgents={() => setAgentsOpen(true)}
        onOpenSystemPrompt={() => setSystemPromptOpen(true)}
      />

      <ProviderSettingsDialog
        open={providerSettingsOpen}
        onOpenChange={setProviderSettingsOpen}
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

      <AgentsDialog
        open={agentsOpen}
        onOpenChange={setAgentsOpen}
        agentsSettings={agentsSettings}
        onAgentsSettingsChange={setAgentsSettings}
        loadedAgents={loadedAgents}
        onLoadedAgentsChange={setLoadedAgents}
        availableTools={availableTools}
        availableSkills={availableSkills}
        providers={providers}
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
