"use client";

import { Spinner as RadixSpinner } from "@radix-ui/themes";
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
import { McpDialog } from "@/components/mcp-dialog";
import { ModesDialog } from "@/components/modes-dialog";
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
import { estimateAttachmentsTokens } from "@/lib/ai-chat/attachment-limits";
import {
  createBuiltInAgents,
  isBuiltInAgentName,
} from "@/lib/ai-chat/builtin-agents";
import {
  applyBuiltInToolSettings,
  ASK_USER_TOOL,
  BASH_TOOL,
  BASH_TOOL_NAME,
  buildFileToolAutoApprovalFromToolsSettings,
  CALL_AGENT_TOOL,
  compareToolsByDisplayOrder,
  DEFAULT_AGENTS_SETTINGS,
  DEFAULT_SKILLS_SETTINGS,
  DEFAULT_TOOLS_SETTINGS,
  EDIT_TOOL,
  isBuiltInToolName,
  isValidToolName,
  READ_TOOL,
  TASK_TOOLS,
  WEB_FETCH_TOOL,
  WRITE_TOOL,
} from "@/lib/ai-chat/builtin-tools";
import {
  createId,
  createNewProvider,
  createProviderId,
  getEffectiveModelContext,
  getEnabledProviderModels,
  getProviderFallbackModel,
  labelForError,
  modelSupportsVision,
  normalizeProviderForState,
  providerDisplayName,
  sortChatsByUpdatedAt,
} from "@/lib/ai-chat/chat-utils";
import {
  buildLoadedMcpTools,
  createMcpExposedToolName,
  DEFAULT_MCP_SETTINGS,
  getMcpLegacyToolPermission,
  isValidMcpExposedToolName,
} from "@/lib/ai-chat/mcp";
import {
  DEFAULT_MODE_ID,
  getModePermissionMaps,
  normalizeModesState,
  resolveModeForChat,
} from "@/lib/ai-chat/modes";
import {
  applyNewChatDraftSettings,
  buildNewChatDraftSettings,
  getFolderDefaultWorkspaceRoots,
  type NewChatDraftSettings,
} from "@/lib/ai-chat/chat-session-actions";
import { defaultProvider } from "@/lib/ai-chat/provider-presets";
import {
  getEffectiveAgentPermission,
  getEffectiveGlobalAgentPermission,
  getEffectiveGlobalSkillPermission,
  getEffectiveGlobalToolPermission,
  getEffectiveSkillPermission,
  getEffectiveToolPermission,
  getEffectiveWorkspaceRoots,
  resolveProviderForChat,
  validateProviderForGeneration,
} from "@/lib/ai-chat/request-builder";
import {
  createEmptyChat,
  deleteChat,
  loadActiveChatId,
  loadAgents,
  loadAgentsSettings,
  loadAppSettings,
  loadChats,
  loadMcpSettings,
  loadModesState,
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
  saveMcpSettings,
  saveModesState,
  saveProvidersState,
  saveSkillsSettings,
  saveSystemPrompt,
  saveToolsSettings,
} from "@/lib/ai-chat/storage";
import { generateTitleFromChatContext } from "@/lib/ai-chat/title-generation";
import type {
  AgentsSettings,
  AppSettings,
  ChatAttachment,
  ChatFolder,
  ChatMessage,
  ChatSession,
  ChatThinkingMode,
  ChatToolCall,
  ChatToolResult,
  ChatWorkspaceRoot,
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  McpSettings,
  ModesState,
  ProviderConfig,
  ProvidersState,
  SkillsSettings,
  TerminalStreamEvent,
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
// Draft-state key for the unsaved "New chat" composer. A real chat is only
// created (and persisted) once the user sends the first message.
const NEW_CHAT_DRAFT_KEY = "__new_chat_draft__";

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

function getMcpPermissionToolName(
  server: McpSettings["servers"][number],
  tool: NonNullable<McpSettings["servers"][number]["tools"]>[string],
) {
  return createMcpExposedToolName(server.name, tool.originalName);
}

function getStoredMcpPermissionToolName(
  server: McpSettings["servers"][number],
  tool: NonNullable<McpSettings["servers"][number]["tools"]>[string],
) {
  return tool.exposedName || getMcpPermissionToolName(server, tool);
}

function migrateMcpToolPermissions(
  toolsSettings: ToolsSettings,
  nextMcpSettings: McpSettings,
  previousMcpSettings?: McpSettings,
): ToolsSettings {
  const nextToolPermissions = { ...(toolsSettings.toolPermissions ?? {}) };
  const nextMcpToolNames = new Set<string>();
  let changed = false;

  for (const server of nextMcpSettings.servers) {
    for (const tool of Object.values(server.tools ?? {})) {
      const exposedName = getMcpPermissionToolName(server, tool);
      if (isValidMcpExposedToolName(exposedName)) {
        nextMcpToolNames.add(exposedName);
      }
    }
  }

  const previousServersById = new Map(
    (previousMcpSettings?.servers ?? []).map((server) => [server.id, server]),
  );

  for (const server of nextMcpSettings.servers) {
    const previousServer = previousServersById.get(server.id);

    for (const tool of Object.values(server.tools ?? {})) {
      const exposedName = getMcpPermissionToolName(server, tool);
      if (!isValidMcpExposedToolName(exposedName)) continue;

      const previousTool = previousServer?.tools?.[tool.originalName];
      const previousExposedName = previousServer && previousTool
        ? getStoredMcpPermissionToolName(previousServer, previousTool)
        : tool.exposedName && tool.exposedName !== exposedName
          ? tool.exposedName
          : undefined;

      if (
        previousExposedName &&
        previousExposedName !== exposedName &&
        isValidMcpExposedToolName(previousExposedName) &&
        nextToolPermissions[previousExposedName] &&
        !nextToolPermissions[exposedName]
      ) {
        nextToolPermissions[exposedName] = nextToolPermissions[previousExposedName];
        changed = true;
      }

      if (!nextToolPermissions[exposedName]) {
        nextToolPermissions[exposedName] = getMcpLegacyToolPermission(
          server,
          tool,
        );
        changed = true;
      }

      if (
        previousExposedName &&
        previousExposedName !== exposedName &&
        isValidMcpExposedToolName(previousExposedName) &&
        !nextMcpToolNames.has(previousExposedName) &&
        nextToolPermissions[previousExposedName]
      ) {
        delete nextToolPermissions[previousExposedName];
        changed = true;
      }
    }
  }

  if (!changed) return toolsSettings;

  return {
    ...toolsSettings,
    enabled: toolsSettings.toolsPermission !== "deny",
    permissionModelVersion: 2,
    toolPermissions: nextToolPermissions,
  };
}


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
    chatFolders: [],
    thinkingAutoCollapse: false,
  });
  const [mcpSettings, setMcpSettings] =
    useState<McpSettings>(DEFAULT_MCP_SETTINGS);
  const [modesState, setModesState] = useState<ModesState>(() =>
    normalizeModesState(undefined),
  );
  const [loadedTools, setLoadedTools] = useState<LoadedToolInfo[]>([]);
  const [loadedSkills, setLoadedSkills] = useState<LoadedSkillInfo[]>([]);
  const [loadedAgents, setLoadedAgents] = useState<LoadedAgentInfo[]>([]);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  // When true, we're composing an unsaved "New chat". No chat exists yet; the
  // real chat is created on first send. The composer draft lives under
  // NEW_CHAT_DRAFT_KEY so it survives switching to another chat and back.
  const [isNewChatDraft, setIsNewChatDraft] = useState(false);
  const pendingDraftSendRef = useRef<{
    chatId: string;
    content: string;
    attachments: ChatAttachment[];
  } | null>(null);
  const [chatSwitchLoadingChatId, setChatSwitchLoadingChatId] = useState<
    string | null
  >(null);
  const [initialComposerDrafts] = useState<Record<string, string>>(() =>
    loadComposerDrafts(),
  );
  const composerDraftsRef = useRef<Record<string, string>>(
    initialComposerDrafts,
  );
  const [composerAttachmentsByKey, setComposerAttachmentsByKey] = useState<
    Record<string, ChatAttachment[]>
  >({});
  const [newChatDraftWorkspaceRoots, setNewChatDraftWorkspaceRoots] = useState<
    ChatWorkspaceRoot[]
  >([]);
  const [newChatDraftFolderId, setNewChatDraftFolderId] = useState<
    string | undefined
  >();
  const [newChatDraftModeId, setNewChatDraftModeId] = useState(DEFAULT_MODE_ID);
  const [newChatDraftSettings, setNewChatDraftSettings] = useState<
    NewChatDraftSettings | undefined
  >();
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
  const [isModePickerOpen, setIsModePickerOpen] = useState(false);
  const [modeSearchValue, setModeSearchValue] = useState("");
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
  const [mcpOpen, setMcpOpen] = useState(false);
  const [modesOpen, setModesOpen] = useState(false);
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
  // Published by the virtualized ChatMessageList; lets useChatAutoscroll resolve
  // a saved scroll anchor to a scrollTop even when the message is windowed out.
  const messageOffsetResolverRef = useRef<
    ((messageId: string) => number | null) | null
  >(null);
  const chatComposerRef = useRef<ChatComposerHandle | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const didHydrateRef = useRef(false);
  const composerDraftSaveTimeoutRef = useRef<number | null>(null);
  const chatSaveTimeoutRef = useRef<number | null>(null);
  const savedChatSnapshotsRef = useRef<Record<string, string>>({});
  const pendingChatSwitchTargetRef = useRef<string | null>(null);
  const pendingChatSwitchFrameRef = useRef<number | null>(null);
  const finishChatSwitchLoadingFrameRef = useRef<number | null>(null);

  const { theme, resolvedTheme, setTheme } = useTheme();

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
        event.code === "KeyF";

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

  const activeChat = useMemo(() => {
    if (isNewChatDraft) return undefined;
    return (
      sortedChats.find((chat) => chat.id === activeChatId) ?? sortedChats[0]
    );
  }, [isNewChatDraft, activeChatId, sortedChats]);
  const composerDraftKey = isNewChatDraft
    ? NEW_CHAT_DRAFT_KEY
    : (activeChatId ?? "");
  const activeComposerDraft = composerDraftKey
    ? (composerDraftsRef.current[composerDraftKey] ?? "")
    : "";
  const activeComposerAttachments = composerDraftKey
    ? (composerAttachmentsByKey[composerDraftKey] ?? [])
    : [];
  const enabledModes = useMemo(
    () => normalizeModesState(modesState).modes.filter((mode) => mode.enabled),
    [modesState],
  );
  const activeMode = useMemo(
    () =>
      resolveModeForChat(
        isNewChatDraft ? newChatDraftModeId : activeChat?.modeId,
        modesState,
      ),
    [activeChat?.modeId, isNewChatDraft, modesState, newChatDraftModeId],
  );
  const visibleModes = useMemo(() => {
    const search = modeSearchValue.trim().toLowerCase();

    return enabledModes.filter((mode) =>
      search
        ? `${mode.name} ${mode.description}`.toLowerCase().includes(search)
        : true,
    );
  }, [enabledModes, modeSearchValue]);

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
    const attachmentTokens = estimateAttachmentsTokens(
      activeComposerAttachments,
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
          usedTokens: usedTokens + attachmentTokens,
          limitTokens: context.length,
          limitSource: context.source,
        };
      }
    }

    return {
      usedTokens: attachmentTokens || undefined,
      limitTokens: context.length,
      limitSource: context.source,
    };
  }, [
    activeChatModel,
    activeChatProvider,
    activeComposerAttachments,
    messages,
  ]);
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

  const loadedMcpTools = useMemo(
    () => buildLoadedMcpTools(mcpSettings),
    [mcpSettings],
  );

  const handleMcpSettingsChange = useCallback(
    (nextSettings: McpSettings) => {
      setToolsSettings((current) =>
        migrateMcpToolPermissions(current, nextSettings, mcpSettings),
      );
      setMcpSettings(nextSettings);
    },
    [mcpSettings],
  );

  const executableTools = useMemo(
    () => [...loadedTools, ...loadedMcpTools],
    [loadedTools, loadedMcpTools],
  );

  const availableTools = useMemo(() => {
    const byName = new Map<string, LoadedToolInfo>();

    for (const tool of [
      ASK_USER_TOOL,
      CALL_AGENT_TOOL,
      ...TASK_TOOLS,
      WEB_FETCH_TOOL,
      READ_TOOL,
      BASH_TOOL,
      EDIT_TOOL,
      WRITE_TOOL,
      ...loadedTools,
      ...loadedMcpTools,
    ]) {
      if (!isValidToolName(tool.name) || byName.has(tool.name)) continue;
      byName.set(tool.name, applyBuiltInToolSettings(tool, toolsSettings));
    }

    return [...byName.values()].sort(compareToolsByDisplayOrder);
  }, [loadedMcpTools, loadedTools, toolsSettings]);

  const availableToolsByName = useMemo(() => {
    return new Map(availableTools.map((tool) => [tool.name, tool] as const));
  }, [availableTools]);

  const effectiveToolPermissions = useMemo(() => {
    const context = {
      availableTools,
      availableSkills: [],
      availableAgents: [],
    };
    return new Map(
      availableTools.map(
        (tool) =>
          [
            tool.name,
            getEffectiveToolPermission({
              toolName: tool.name,
              toolsSettings,
              mode: activeMode,
              modeCapabilityContext: context,
            }),
          ] as const,
      ),
    );
  }, [activeMode, availableTools, toolsSettings]);

  const globalToolPermissions = useMemo(() => {
    return new Map(
      availableTools.map(
        (tool) =>
          [
            tool.name,
            getEffectiveGlobalToolPermission(tool.name, toolsSettings),
          ] as const,
      ),
    );
  }, [availableTools, toolsSettings]);

  const globallyEnabledToolNames = useMemo(() => {
    return new Set(
      availableTools
        .filter((tool) => effectiveToolPermissions.get(tool.name) !== "deny")
        .map((tool) => tool.name),
    );
  }, [availableTools, effectiveToolPermissions]);

  const modeDefaultEnabledToolNames = globallyEnabledToolNames;
  const activeChatEnabledToolNames = useMemo(
    () => [...modeDefaultEnabledToolNames],
    [modeDefaultEnabledToolNames],
  );

  const visibleChatTools = useMemo(() => {
    const search = chatToolSearchValue.trim().toLowerCase();
    if (!search) return availableTools;
    return availableTools.filter((tool) =>
      `${tool.name} ${tool.description}`.toLowerCase().includes(search),
    );
  }, [availableTools, chatToolSearchValue]);

  const toolMentionOptions = useMemo<ToolMentionOption[]>(() => {
    return availableTools
      .filter((tool) => effectiveToolPermissions.get(tool.name) !== "deny")
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        isBuiltin: isBuiltInToolName(tool.name),
      }));
  }, [availableTools, effectiveToolPermissions]);

  const availableSkills = useMemo(() => {
    const byName = new Map<string, LoadedSkillInfo>();

    for (const skill of loadedSkills) {
      if (!isValidToolName(skill.name)) continue;
      const existing = byName.get(skill.name);
      if (!existing) {
        byName.set(skill.name, skill);
        continue;
      }

      if (
        existing.sourceKind !== "workspace" &&
        skill.sourceKind === "workspace"
      ) {
        byName.set(skill.name, skill);
      }
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

  const activeChatVisibleWorkspaceRoots = useMemo(() => {
    if (isNewChatDraft) return newChatDraftWorkspaceRoots;
    if (!activeChat) return [];

    return getEffectiveWorkspaceRoots({
      workspaceRoots: activeChat.workspaceRoots ?? [],
      activeSkillNames: [],
      availableSkillsByName,
    });
  }, [
    activeChat,
    isNewChatDraft,
    newChatDraftWorkspaceRoots,
    availableSkillsByName,
  ]);

  const effectiveSkillPermissions = useMemo(() => {
    const context = {
      availableTools,
      availableSkills,
      availableAgents: [],
    };
    return new Map(
      availableSkills.map(
        (skill) =>
          [
            skill.name,
            getEffectiveSkillPermission({
              skillName: skill.name,
              skillsSettings,
              mode: activeMode,
              modeCapabilityContext: context,
            }),
          ] as const,
      ),
    );
  }, [activeMode, availableSkills, availableTools, skillsSettings]);

  const globalSkillPermissions = useMemo(() => {
    return new Map(
      availableSkills.map(
        (skill) =>
          [
            skill.name,
            getEffectiveGlobalSkillPermission(skill.name, skillsSettings),
          ] as const,
      ),
    );
  }, [availableSkills, skillsSettings]);

  const globallyEnabledSkillNames = useMemo(() => {
    return new Set(
      availableSkills
        .filter((skill) => effectiveSkillPermissions.get(skill.name) !== "deny")
        .map((skill) => skill.name),
    );
  }, [availableSkills, effectiveSkillPermissions]);

  const modeDefaultEnabledSkillNames = globallyEnabledSkillNames;
  const activeChatEnabledSkillNames = useMemo(
    () => [...modeDefaultEnabledSkillNames],
    [modeDefaultEnabledSkillNames],
  );

  const visibleChatSkills = useMemo(() => {
    const search = chatSkillSearchValue.trim().toLowerCase();
    if (!search) return availableSkills;
    return availableSkills.filter((skill) =>
      `${skill.name} ${skill.description}`.toLowerCase().includes(search),
    );
  }, [availableSkills, chatSkillSearchValue]);

  const skillMentionOptions = useMemo(() => {
    return availableSkills
      .filter((skill) => effectiveSkillPermissions.get(skill.name) !== "deny")
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
      }));
  }, [availableSkills, effectiveSkillPermissions]);

  const availableAgents = useMemo(() => {
    const byName = new Map<string, LoadedAgentInfo>();

    for (const agent of createBuiltInAgents(
      agentsSettings.builtInAgentMaxNestingDepths,
    )) {
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
  }, [agentsSettings.builtInAgentMaxNestingDepths, loadedAgents]);

  const availableAgentsByName = useMemo(() => {
    return new Map(
      availableAgents.map((agent) => [agent.name, agent] as const),
    );
  }, [availableAgents]);

  const effectiveAgentPermissions = useMemo(() => {
    const context = {
      availableTools,
      availableSkills,
      availableAgents,
    };
    return new Map(
      availableAgents.map(
        (agent) =>
          [
            agent.name,
            getEffectiveAgentPermission({
              agentName: agent.name,
              agentsSettings,
              mode: activeMode,
              modeCapabilityContext: context,
            }),
          ] as const,
      ),
    );
  }, [
    activeMode,
    agentsSettings,
    availableAgents,
    availableSkills,
    availableTools,
  ]);

  const globalAgentPermissions = useMemo(() => {
    return new Map(
      availableAgents.map(
        (agent) =>
          [
            agent.name,
            getEffectiveGlobalAgentPermission(agent.name, agentsSettings),
          ] as const,
      ),
    );
  }, [agentsSettings, availableAgents]);

  const activeModePermissionMaps = useMemo(() => {
    return getModePermissionMaps(activeMode, {
      availableTools,
      availableSkills,
      availableAgents,
    });
  }, [activeMode, availableAgents, availableSkills, availableTools]);

  const activeModeToolPermissions = useMemo(
    () => new Map(Object.entries(activeModePermissionMaps.toolPermissions)),
    [activeModePermissionMaps],
  );
  const activeModeSkillPermissions = useMemo(
    () => new Map(Object.entries(activeModePermissionMaps.skillPermissions)),
    [activeModePermissionMaps],
  );
  const activeModeAgentPermissions = useMemo(
    () => new Map(Object.entries(activeModePermissionMaps.agentPermissions)),
    [activeModePermissionMaps],
  );

  const globallyEnabledAgentNames = useMemo(() => {
    return new Set(
      availableAgents
        .filter((agent) => effectiveAgentPermissions.get(agent.name) !== "deny")
        .map((agent) => agent.name),
    );
  }, [availableAgents, effectiveAgentPermissions]);

  const modeDefaultEnabledAgentNames = globallyEnabledAgentNames;
  const activeChatEnabledAgentNames = useMemo(
    () => [...modeDefaultEnabledAgentNames],
    [modeDefaultEnabledAgentNames],
  );

  const agentMentionOptions = useMemo(() => {
    return availableAgents
      .filter((agent) => effectiveAgentPermissions.get(agent.name) !== "deny")
      .map((agent) => ({
        name: agent.name,
        description: agent.description,
      }));
  }, [availableAgents, effectiveAgentPermissions]);

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
    messageOffsetResolverRef,
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
          loadedMcpSettings,
          loadedModesState,
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
          loadMcpSettings(),
          loadModesState(),
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
        const nextChats = loadedChats;
        let nextActiveChatId = loadedActiveChatId;
        // Don't auto-create a chat when there are none — start in the unsaved
        // "New chat" draft state and only persist once the user sends.
        const startInNewChatDraft = nextChats.length === 0;

        if (startInNewChatDraft) {
          nextActiveChatId = undefined;
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
        setToolsSettings(
          migrateMcpToolPermissions(loadedToolsSettings, loadedMcpSettings),
        );
        setSkillsSettings(loadedSkillsSettings);
        setAgentsSettings(loadedAgentsSettings);
        setAppSettings(loadedAppSettings);
        setMcpSettings(loadedMcpSettings);
        setModesState(loadedModesState);
        setLoadedTools(loadedToolManifests);
        setLoadedSkills(loadedSkillManifests);
        setLoadedAgents(loadedAgentManifests);
        savedChatSnapshotsRef.current = Object.fromEntries(
          nextChats.map((chat) => [chat.id, JSON.stringify(chat)]),
        );
        setChats(nextChats);
        setActiveChatId(nextActiveChatId);
        setIsNewChatDraft(startInNewChatDraft);
        didHydrateRef.current = true;
        setMounted(true);
      } catch (error) {
        console.error("Failed to load app data:", error);
        const fallbackProvider = normalizeProviderForState(defaultProvider);
        savedChatSnapshotsRef.current = {};
        setProvidersState({
          providers: [fallbackProvider],
          activeProviderId: fallbackProvider.id,
        });
        setChats([]);
        setActiveChatId(undefined);
        setIsNewChatDraft(true);
        // IMPORTANT: do NOT set didHydrateRef.current = true here. Hydration
        // failed, so the in-memory state is a placeholder default — enabling
        // the auto-save effects would persist that default OVER the real
        // on-disk data (this is what was wiping providers). Leaving it false
        // keeps the app usable while protecting existing data; a restart will
        // retry the load.
        setMounted(true);
        showError(
          "Storage failed",
          `${labelForError(error)} Your saved data was left untouched — restart the app to retry. Avoid reconfiguring providers until it loads correctly.`,
        );
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
        createNewChatWithEmptyDraftState();
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
    if (!didHydrateRef.current) return;
    saveMcpSettings(mcpSettings).catch((error) =>
      console.error("Failed to save MCP settings:", error),
    );
  }, [mcpSettings]);

  useEffect(() => {
    if (!didHydrateRef.current) return;
    setToolsSettings((current) =>
      migrateMcpToolPermissions(current, mcpSettings),
    );
  }, [mcpSettings]);

  useEffect(() => {
    if (!didHydrateRef.current) return;
    saveModesState(modesState).catch((error) =>
      console.error("Failed to save modes:", error),
    );
  }, [modesState]);

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
    if (!activeChat && !isNewChatDraft) return;

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

      if (isNewChatDraft) {
        setNewChatDraftWorkspaceRoots((currentRoots) => {
          if (currentRoots.some((item) => item.path === root.path)) {
            return currentRoots;
          }

          return [root];
        });
        showSuccess("Workspace folder added.");
        return;
      }

      if (!activeChat) return;

      updateChat(activeChat.id, (chat) => {
        const existingRoots = chat.workspaceRoots ?? [];
        if (existingRoots.some((item) => item.path === root.path)) {
          return chat;
        }

        return {
          ...chat,
          workspaceRoots: [root],
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
    if (isNewChatDraft) {
      setNewChatDraftWorkspaceRoots((currentRoots) =>
        currentRoots.filter((root) => root.id !== rootId),
      );
      showSuccess("Workspace folder removed from chat.");
      return;
    }

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
        loadedTools={executableTools}
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
      const key = isNewChatDraft ? NEW_CHAT_DRAFT_KEY : activeChatId;
      if (!key) return;

      const nextDrafts = { ...composerDraftsRef.current };

      if (draft.length === 0) delete nextDrafts[key];
      else nextDrafts[key] = draft;

      composerDraftsRef.current = nextDrafts;

      if (composerDraftSaveTimeoutRef.current !== null) {
        window.clearTimeout(composerDraftSaveTimeoutRef.current);
      }

      composerDraftSaveTimeoutRef.current = window.setTimeout(() => {
        composerDraftSaveTimeoutRef.current = null;
        saveComposerDrafts(composerDraftsRef.current);
      }, 250);
    },
    [isNewChatDraft, activeChatId],
  );

  const updateActiveComposerAttachments = useCallback(
    (attachments: ChatAttachment[]) => {
      const key = isNewChatDraft ? NEW_CHAT_DRAFT_KEY : activeChatId;
      if (!key) return;

      setComposerAttachmentsByKey((current) => {
        const next = { ...current };
        if (attachments.length === 0) delete next[key];
        else next[key] = attachments;
        return next;
      });
    },
    [isNewChatDraft, activeChatId],
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
    modesState,
    chatTitleGenerationMode: appSettings.chatTitleGenerationMode,
    loadedTools: executableTools,
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
      const tool =
        availableToolsByName.get(toolName) ??
        executableTools.find((candidate) => candidate.name === toolName);
      const executionId = createId();
      const isMcpTool = tool?.source === "mcp";
      const bridge = isMcpTool ? window.chatForgeMcp : getToolsBridge();
      const skillWorkspaceRoots: ChatWorkspaceRoot[] = loadedSkills
        .filter((skill) => skill.directoryPath)
        .map((skill, index) => ({
          id: `skill:${skill.name}:${index}`,
          name: skill.name,
          path: skill.directoryPath!,
          createdAt: new Date(0).toISOString(),
          automatic: true,
          kind: "skill" as const,
        }));
      const workspaceRootsWithSkills = [
        ...(context?.workspaceRoots ?? []),
        ...skillWorkspaceRoots,
      ];

      if (!bridge) {
        return Promise.reject(
          new Error(
            isMcpTool
              ? "MCP bridge is unavailable."
              : "Tools bridge is unavailable.",
          ),
        );
      }

      return new Promise<ToolCommandResult>((resolve, reject) => {
        let settled = false;

        let cleanup = () => {
          context?.signal?.removeEventListener("abort", abortHandler);
        };

        const settleResolve = (value: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value as ToolCommandResult);
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

        if (isMcpTool) {
          window.chatForgeMcp
            ?.executeTool({ executionId, tool, args })
            .then(settleResolve, settleReject);
          return;
        }

        if (toolName === BASH_TOOL_NAME) {
          const toolsBridge = getToolsBridge();
          const unsubscribe = toolsBridge.onStreamEvent?.(
            (event: TerminalStreamEvent) => {
              if (event.executionId !== executionId) return;
              context?.onTerminalStreamEvent?.(event);
            },
          );
          const originalCleanup = cleanup;
          const cleanupWithStream = () => {
            unsubscribe?.();
            originalCleanup();
          };
          cleanup = cleanupWithStream;

          toolsBridge
            .executeStream({
              executionId,
              name: toolName,
              args,
              workspaceRoots: workspaceRootsWithSkills,
              allowedExactFilePaths: context?.allowedExactFilePaths,
              allowedReadRoots: context?.allowedReadRoots,
              timeoutMs: tool?.timeoutMs,
            })
            .then(settleResolve, settleReject);
          return;
        }

        getToolsBridge()
          .execute({
            executionId,
            name: toolName,
            args,
            workspaceRoots: workspaceRootsWithSkills,
            allowedExactFilePaths: context?.allowedExactFilePaths,
            allowedReadRoots: context?.allowedReadRoots,
            timeoutMs: tool?.timeoutMs,
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

  // Once the chat created on first send is committed to state (so `activeChat`
  // reflects it), dispatch the queued message.
  useEffect(() => {
    const pending = pendingDraftSendRef.current;
    if (!pending) return;
    if (activeChat?.id !== pending.chatId) return;

    pendingDraftSendRef.current = null;
    void sendMessage(pending.content, pending.attachments);
  }, [activeChat, sendMessage]);

  const handleComposerSend = useCallback(
    async (content: string, attachments: ChatAttachment[]) => {
      if (!isNewChatDraft) {
        return sendMessage(content, attachments);
      }

      const trimmed = content.trim();
      if (!trimmed && attachments.length === 0) {
        showError("Message is required.");
        return false;
      }

      // Create and persist the real chat now, then queue the send for after
      // the new chat becomes the active chat (see the effect above).
      const emptyChat = createEmptyChat();
      const workspaceRoots = newChatDraftWorkspaceRoots
        .slice(0, 1)
        .map((root) => ({ ...root }));

      const draftFolderId = appSettings.chatFolders.some(
        (folder) => folder.id === newChatDraftFolderId,
      )
        ? newChatDraftFolderId
        : undefined;

      const chat: ChatSession = applyNewChatDraftSettings({
        baseChat: emptyChat,
        draftSettings: newChatDraftSettings,
        modeId: activeMode.id,
        folderId: draftFolderId,
        workspaceRoots,
        fileToolAutoApprovalDefaults:
          buildFileToolAutoApprovalFromToolsSettings(toolsSettings),
      });

      saveCurrentChatScrollSnapshot();
      setChats((currentChats) => [chat, ...currentChats]);
      setActiveChatId(chat.id);
      setIsNewChatDraft(false);
      setEditingMessageId(null);
      resetChatScrollState();

      // Clear the draft stored under the new-chat key now that it's consumed.
      const nextDrafts = { ...composerDraftsRef.current };
      delete nextDrafts[NEW_CHAT_DRAFT_KEY];
      composerDraftsRef.current = nextDrafts;
      saveComposerDrafts(nextDrafts);
      setComposerAttachmentsByKey((current) => {
        const next = { ...current };
        delete next[NEW_CHAT_DRAFT_KEY];
        return next;
      });
      setNewChatDraftWorkspaceRoots([]);
      setNewChatDraftFolderId(undefined);
      setNewChatDraftSettings(undefined);

      pendingDraftSendRef.current = {
        chatId: chat.id,
        content: trimmed,
        attachments,
      };

      try {
        await saveChat(chat);
        await saveActiveChatId(chat.id);
      } catch (error) {
        console.error("Failed to save new chat:", error);
      }

      return true;
    },
    [
      activeMode.id,
      isNewChatDraft,
      sendMessage,
      toolsSettings,
      newChatDraftWorkspaceRoots,
      newChatDraftFolderId,
      newChatDraftSettings,
      appSettings.chatFolders,
      saveCurrentChatScrollSnapshot,
      resetChatScrollState,
      showError,
    ],
  );

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

  function selectActiveChatMode(modeId: string) {
    if (!enabledModes.some((mode) => mode.id === modeId)) return;

    if (isNewChatDraft || !activeChat) {
      setNewChatDraftModeId(modeId);
    } else {
      updateChat(activeChat.id, (chat) => ({
        ...chat,
        modeId,
      }));
    }

    setIsModePickerOpen(false);
    setModeSearchValue("");
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
    cloneChat,
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
    globallyEnabledToolNames: modeDefaultEnabledToolNames,
    globallyEnabledSkillNames: modeDefaultEnabledSkillNames,
    globallyEnabledAgentNames: modeDefaultEnabledAgentNames,
    fileToolAutoApprovalDefaults:
      buildFileToolAutoApprovalFromToolsSettings(toolsSettings),
    isSending,
    messageElementRefs,
    setActiveChatId,
    setChats,
    setIsNewChatDraft,
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

  function createNewChatWithEmptyDraftState() {
    setNewChatDraftWorkspaceRoots([]);
    setNewChatDraftFolderId(undefined);
    setNewChatDraftModeId(DEFAULT_MODE_ID);
    setNewChatDraftSettings(undefined);
    createNewChat();
  }

  function createNewChatWithSameSettings(chatId: string) {
    const sourceChat = chats.find((chat) => chat.id === chatId);
    if (!sourceChat) return;

    const settings = buildNewChatDraftSettings(sourceChat);
    const folderId = settings.folderId;
    const draftFolderId = appSettings.chatFolders.some(
      (folder) => folder.id === folderId,
    )
      ? folderId
      : undefined;

    setNewChatDraftSettings({ ...settings, folderId: draftFolderId });
    setNewChatDraftWorkspaceRoots(settings.workspaceRoots ?? []);
    setNewChatDraftFolderId(draftFolderId);
    setNewChatDraftModeId(settings.modeId ?? DEFAULT_MODE_ID);
    createNewChat();
  }

  function setActiveOrDraftChatThinkingMode(
    thinkingMode: ChatThinkingMode,
  ) {
    if (isNewChatDraft) {
      setNewChatDraftSettings((currentSettings) => ({
        ...(currentSettings ?? {}),
        thinkingMode,
      }));
      return;
    }

    setActiveChatThinkingMode(thinkingMode);
  }

  async function removeChatAndResetDraftState(chatId: string) {
    const willOpenNewChatDraft = chats.every((chat) => chat.id === chatId);
    if (willOpenNewChatDraft) {
      setNewChatDraftWorkspaceRoots([]);
      setNewChatDraftFolderId(undefined);
      setNewChatDraftSettings(undefined);
      setNewChatDraftModeId(DEFAULT_MODE_ID);
    }

    await removeChat(chatId);
  }

  function updateChatFolders(updater: (folders: ChatFolder[]) => ChatFolder[]) {
    setAppSettings((currentSettings) => ({
      ...currentSettings,
      chatFolders: updater(currentSettings.chatFolders),
    }));
  }

  function createFolder(name: string) {
    const requestedName = name.trim();
    if (!requestedName) return;

    const now = new Date().toISOString();

    updateChatFolders((folders) => {
      const existingNames = new Set(folders.map((folder) => folder.name));
      let uniqueName = requestedName;
      let index = 2;

      while (existingNames.has(uniqueName)) {
        uniqueName = `${requestedName} ${index}`;
        index += 1;
      }

      const folder: ChatFolder = {
        id: `folder-${createId()}`,
        name: uniqueName,
        createdAt: now,
        updatedAt: now,
      };

      return [folder, ...folders];
    });
    showSuccess("Folder created.");
  }

  function renameFolder(folderId: string, name: string) {
    const nextName = name.trim();
    if (!nextName) return;

    const now = new Date().toISOString();
    updateChatFolders((folders) =>
      folders.map((folder) =>
        folder.id === folderId
          ? { ...folder, name: nextName, updatedAt: now }
          : folder,
      ),
    );
  }

  async function addFolderWorkspace(folderId: string) {
    try {
      const result = await getWorkspaceBridge().selectFolder();
      if (result.cancelled) return;

      const now = new Date().toISOString();
      const root: ChatWorkspaceRoot = {
        id: createId(),
        name: result.name || result.path,
        path: result.path,
        createdAt: now,
        kind: "manual",
      };

      updateChatFolders((folders) =>
        folders.map((folder) => {
          if (folder.id !== folderId) return folder;
          const existingRoots = folder.workspaceRoots ?? [];
          if (existingRoots.some((item) => item.path === root.path))
            return folder;

          return {
            ...folder,
            workspaceRoots: [root],
            updatedAt: now,
          };
        }),
      );
      showSuccess("Default workspace added to folder.");
    } catch (error) {
      console.error("Failed to add folder workspace:", error);
      showError("Failed to add folder workspace.", labelForError(error));
    }
  }

  function clearFolderWorkspaces(folderId: string) {
    const now = new Date().toISOString();
    updateChatFolders((folders) =>
      folders.map((folder) =>
        folder.id === folderId
          ? { ...folder, workspaceRoots: undefined, updatedAt: now }
          : folder,
      ),
    );
    showSuccess("Default workspace removed.");
  }

  function createNewChatInFolder(folderId: string) {
    const folder = appSettings.chatFolders.find((item) => item.id === folderId);
    if (!folder) return;

    setNewChatDraftWorkspaceRoots(getFolderDefaultWorkspaceRoots(folder));
    setNewChatDraftFolderId(folder.id);
    setNewChatDraftModeId(DEFAULT_MODE_ID);
    setNewChatDraftSettings(undefined);
    createNewChat();
  }

  function moveChatToFolder(chatId: string, folderId: string) {
    const folderExists = appSettings.chatFolders.some(
      (folder) => folder.id === folderId,
    );
    if (!folderExists) return;

    updateChat(chatId, (chat) => ({
      ...chat,
      folderId,
      isPinned: false,
    }));
  }

  function removeChatFromFolder(chatId: string) {
    updateChat(chatId, (chat) => ({
      ...chat,
      folderId: undefined,
    }));
  }

  async function deleteFolder(folderId: string, mode: "move" | "delete") {
    const folder = appSettings.chatFolders.find((item) => item.id === folderId);
    if (!folder) return;

    updateChatFolders((folders) =>
      folders.filter((item) => item.id !== folderId),
    );

    if (newChatDraftFolderId === folderId) {
      setNewChatDraftFolderId(undefined);
      setNewChatDraftWorkspaceRoots([]);
    }

    if (mode === "move") {
      setChats((currentChats) =>
        currentChats.map((chat) =>
          chat.folderId === folderId ? { ...chat, folderId: undefined } : chat,
        ),
      );
      showSuccess("Folder deleted. Chats moved to Chats.");
      return;
    }

    const deletingChatIds = chats
      .filter((chat) => chat.folderId === folderId)
      .map((chat) => chat.id);
    const deletingChatIdSet = new Set(deletingChatIds);

    for (const chatId of deletingChatIds) {
      if (isChatGenerating(chatId)) stopChatGeneration(chatId);
      forgetChatScrollSnapshot(chatId);
    }

    setCompletedGenerationChatIds((currentChatIds) =>
      currentChatIds.filter((chatId) => !deletingChatIdSet.has(chatId)),
    );

    const remainingChats = sortChatsByUpdatedAt(
      chats.filter((chat) => !deletingChatIdSet.has(chat.id)),
    );
    const activeChatWasDeleted = activeChatId
      ? deletingChatIdSet.has(activeChatId)
      : false;

    setChats(remainingChats);

    if (activeChatWasDeleted) {
      resetChatScrollState();
      if (remainingChats.length > 0) {
        setActiveChatId(remainingChats[0].id);
        setIsNewChatDraft(false);
        try {
          await saveActiveChatId(remainingChats[0].id);
        } catch (error) {
          console.error("Failed to save active chat id:", error);
        }
      } else {
        setActiveChatId(undefined);
        setIsNewChatDraft(true);
      }
    }

    try {
      await Promise.all(deletingChatIds.map((chatId) => deleteChat(chatId)));
      showSuccess(
        deletingChatIds.length > 0
          ? "Folder and chats deleted."
          : "Folder deleted.",
      );
    } catch (error) {
      console.error("Failed to delete folder chats:", error);
      showError("Failed to delete some folder chats.", labelForError(error));
    }
  }

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
  const stableCloneChat = useStableCallback(cloneChat);
  const stableShowSuccess = useStableCallback(showSuccess);
  const stableShowError = useStableCallback(showError);

  const activeWorkspaceRootsKey = useMemo(
    () => activeChatVisibleWorkspaceRoots.map((root) => root.path).join("\n"),
    [activeChatVisibleWorkspaceRoots],
  );

  useEffect(() => {
    if (!mounted) return;

    let cancelled = false;
    void (async () => {
      try {
        const skills = await loadSkills(activeChatVisibleWorkspaceRoots);
        if (!cancelled) setLoadedSkills(skills);
      } catch (error) {
        if (!cancelled)
          stableShowError("Failed to reload skills", labelForError(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceRootsKey, mounted, stableShowError]);
  const toolDisplayKey = useMemo(
    () =>
      executableTools
        .map((tool) => `${tool.name}:${tool.description ?? ""}`)
        .join("\n"),
    [executableTools],
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
        chats={sortedChats}
        folders={appSettings.chatFolders}
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
        onCloneChat={stableCloneChat}
        onRemoveChat={(chatId) => {
          setCompletedGenerationChatIds((currentChatIds) =>
            currentChatIds.filter((currentChatId) => currentChatId !== chatId),
          );
          void removeChatAndResetDraftState(chatId);
        }}
        onCreateNewChat={createNewChatWithEmptyDraftState}
        onCreateChatInFolder={createNewChatInFolder}
        onCreateChatWithSameSettings={createNewChatWithSameSettings}
        onOpenSettings={() => setSettingsOpen(true)}
        onCreateFolder={createFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        onSetFolderWorkspace={addFolderWorkspace}
        onClearFolderWorkspace={clearFolderWorkspaces}
        onMoveChatToFolder={moveChatToFolder}
        onRemoveChatFromFolder={removeChatFromFolder}
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
          className="relative flex min-h-0 flex-col overflow-hidden"
          onWheel={handleChatWheel}
          onPointerDown={handleChatPointerDown}
        >
          {showChatSwitchLoading && (
            <div
              className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center text-foreground backdrop-blur-lg"
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
              "chat-scrollbar min-h-0 flex-1 w-full [overflow-anchor:none]",
              hasMessages
                ? "overflow-y-auto pt-3 pb-3 md:pt-6 md:pb-6"
                : "overflow-hidden",
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
                  scrollElementRef={chatScrollRef}
                  offsetResolverRef={messageOffsetResolverRef}
                  isSending={isSending}
                  editingMessageId={editingMessageId}
                  copiedMessageId={copiedMessageId}
                  messageContextMenu={messageContextMenu}
                  visualFlushRequests={visualFlushRequests}
                  visualStreamingMessageIds={visualStreamingMessageIds}
                  collapsedToolStepIds={collapsedToolStepIds}
                  collapsedThinkingStepIds={collapsedThinkingStepIds}
                  thinkingAutoCollapse={
                    appSettings.thinkingAutoCollapse ?? true
                  }
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
                className={cn(
                  "w-full shrink-0",
                  hasMessages ? "h-[10vh] min-h-10" : "h-px",
                )}
              />
            </div>
          </div>

          {hasMessages &&
            isChatScrollable &&
            !isNearChatBottom &&
            showScrollToBottomButton && (
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 right-[-74px] z-10 px-3 md:px-4",
                  isSending ? "bottom-8 md:bottom-9" : "bottom-0",
                )}
              >
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

          {hasMessages && isSending && (
            <div
              className="pointer-events-none shrink-0 px-3 pb-1 md:px-4"
              aria-live="polite"
            >
              <div className="mx-auto flex w-full max-w-4xl">
                <div className="inline-flex select-none items-center gap-1.5 text-sm text-muted-foreground">
                  <RadixSpinner
                    aria-hidden="true"
                    className="generating-radix-spinner"
                    size="1"
                  />
                  <span className="generating-gradient-text font-medium">
                    Working
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <ChatComposer
          ref={chatComposerRef}
          disabled={!activeChat && !isNewChatDraft}
          isSending={isSending}
          draftKey={composerDraftKey}
          draft={activeComposerDraft}
          onDraftChange={updateActiveComposerDraft}
          attachments={activeComposerAttachments}
          onAttachmentsChange={updateActiveComposerAttachments}
          onSend={handleComposerSend}
          onStop={stopGeneration}
          contextUsage={latestContextUsage}
          supportsVision={modelSupportsVision(
            activeChatProvider,
            activeChatModel,
          )}
          footerStart={
            <ComposerFooter
              activeChatExists={Boolean(activeChat) || isNewChatDraft}
              isSending={isSending}
              activeChatProvider={activeChatProvider}
              activeChatModel={activeChatModel}
              visibleProviderGroups={visibleProviderGroups}
              isModelPickerOpen={isSidebarModelComboboxOpen}
              onModelPickerOpenChange={setIsSidebarModelComboboxOpen}
              modelSearchValue={sidebarModelSearchValue}
              onModelSearchValueChange={setSidebarModelSearchValue}
              onSelectProviderModel={selectActiveChatProviderModel}
              activeMode={activeMode}
              visibleModes={visibleModes}
              isModePickerOpen={isModePickerOpen}
              onModePickerOpenChange={setIsModePickerOpen}
              modeSearchValue={modeSearchValue}
              onModeSearchValueChange={setModeSearchValue}
              onSelectMode={selectActiveChatMode}
              workspaceControl={
                <WorkspaceRootsControl
                  activeChatExists={Boolean(activeChat) || isNewChatDraft}
                  disabled={isSending}
                  roots={activeChatVisibleWorkspaceRoots}
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
        toolPermissions={effectiveToolPermissions}
        globalToolPermissions={globalToolPermissions}
        modeToolPermissions={activeModeToolPermissions}
        skills={availableSkills}
        skillPermissions={effectiveSkillPermissions}
        globalSkillPermissions={globalSkillPermissions}
        modeSkillPermissions={activeModeSkillPermissions}
        agents={availableAgents}
        agentPermissions={effectiveAgentPermissions}
        globalAgentPermissions={globalAgentPermissions}
        modeAgentPermissions={activeModeAgentPermissions}
        modeName={activeMode.name || "Default"}
        thinkingMode={
          isNewChatDraft
            ? (newChatDraftSettings?.thinkingMode ?? "model_default")
            : (activeChat?.thinkingMode ?? "model_default")
        }
        onThinkingModeChange={setActiveOrDraftChatThinkingMode}
        disabled={isSending}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        chatTitleGenerationMode={appSettings.chatTitleGenerationMode}
        appFontFamily={appSettings.fontFamily}
        thinkingAutoCollapse={appSettings.thinkingAutoCollapse ?? true}
        theme={theme}
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
        onThinkingAutoCollapseChange={(checked) =>
          setAppSettings((currentSettings) => ({
            ...currentSettings,
            thinkingAutoCollapse: checked,
          }))
        }
        onOpenProviders={() => setProviderSettingsOpen(true)}
        onOpenTools={() => setToolsOpen(true)}
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenAgents={() => setAgentsOpen(true)}
        onOpenModes={() => setModesOpen(true)}
        onOpenMcp={() => setMcpOpen(true)}
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
        workspaceRoots={activeChatVisibleWorkspaceRoots}
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

      <ModesDialog
        open={modesOpen}
        onOpenChange={setModesOpen}
        modesState={modesState}
        onModesStateChange={setModesState}
        availableTools={availableTools}
        availableSkills={availableSkills}
        availableAgents={availableAgents}
        toolsSettings={toolsSettings}
        skillsSettings={skillsSettings}
        agentsSettings={agentsSettings}
        showSuccess={stableShowSuccess}
        showError={stableShowError}
      />

      <McpDialog
        open={mcpOpen}
        onOpenChange={setMcpOpen}
        mcpSettings={mcpSettings}
        onMcpSettingsChange={handleMcpSettingsChange}
        showSuccess={stableShowSuccess}
        showError={stableShowError}
      />

      <ToolsDialog
        open={toolsOpen}
        onOpenChange={setToolsOpen}
        toolsSettings={toolsSettings}
        onToolsSettingsChange={setToolsSettings}
        availableTools={availableTools}
        loadedTools={loadedTools}
        onLoadedToolsChange={setLoadedTools}
        callAgentEnabled={availableAgents.some(
          (agent) => effectiveAgentPermissions.get(agent.name) !== "deny",
        )}
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
