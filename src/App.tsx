"use client";

import {
  Brain,
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
  Wrench,
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

import { MarkdownMessage } from "@/components/ai-chat/markdown-message";
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
import { Spinner } from "@/components/ui/spinner";
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
  loadTools,
  loadToolsSettings,
  saveActiveChatId,
  saveCachedProviderModels,
  saveChat,
  saveProvidersState,
  saveSystemPrompt,
  saveTool,
  saveToolsSettings,
  deleteTool as deleteStoredTool,
} from "@/lib/ai-chat/storage";
import type {
  ChatAssistantProcessStep,
  ChatAssistantVariant,
  ChatMessage,
  ChatToolCall,
  ChatToolResult,
  LoadedToolInfo,
  ToolCommandResult,
  ToolExecutionPreview,
  ChatSession,
  ProviderConfig,
  ProviderGenerationSettings,
  ProvidersState,
  ToolsSettings,
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
const COMPOSER_DRAFTS_STORAGE_KEY = "chat-forge-composer-drafts";
const TOOL_TEST_STATES_STORAGE_KEY = "chat-forge-tool-test-states";
const DEFAULT_TOOLS_SETTINGS: ToolsSettings = {
  enabled: true,
};
const MAX_TOOL_ROUNDS = 3;

type ToolDraft = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  parametersText: string;
  command: string;
  argsText: string;
  cwd: string;
  input: "none" | "json-stdin";
  timeoutMs: string;
};

type ToolTestState = {
  argsText: string;
  result: ToolCommandResult | null;
  status?: "running";
  runId?: string;
};

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


function isToolExecutionPreview(value: unknown): value is ToolExecutionPreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ToolExecutionPreview>;

  return (
    typeof candidate.command === "string" &&
    Array.isArray(candidate.args) &&
    candidate.args.every((arg) => typeof arg === "string") &&
    (candidate.cwd === undefined || typeof candidate.cwd === "string") &&
    (candidate.inputMode === "none" || candidate.inputMode === "json-stdin") &&
    (candidate.stdin === undefined || typeof candidate.stdin === "string") &&
    typeof candidate.displayCommand === "string" &&
    typeof candidate.usesStdin === "boolean" &&
    typeof candidate.usesPlaceholders === "boolean"
  );
}

function isToolCommandResult(value: unknown): value is ToolCommandResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ToolCommandResult>;

  return (
    (candidate.toolName === undefined ||
      typeof candidate.toolName === "string") &&
    typeof candidate.content === "string" &&
    (typeof candidate.exitCode === "number" || candidate.exitCode === null) &&
    typeof candidate.stdout === "string" &&
    typeof candidate.stderr === "string" &&
    typeof candidate.timedOut === "boolean" &&
    (candidate.execution === undefined ||
      isToolExecutionPreview(candidate.execution))
  );
}

function loadToolTestStates(): Record<string, ToolTestState> {
  if (typeof window === "undefined") return {};

  try {
    const stored = window.localStorage.getItem(TOOL_TEST_STATES_STORAGE_KEY);
    if (!stored) return {};

    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([toolId, value]) => {
          if (typeof toolId !== "string") return null;
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return null;
          }

          const candidate = value as Partial<ToolTestState>;
          const argsText =
            typeof candidate.argsText === "string"
              ? candidate.argsText
              : "{}";
          const result = isToolCommandResult(candidate.result)
            ? candidate.result
            : null;

          return [toolId, { argsText, result } satisfies ToolTestState] as const;
        })
        .filter(
          (entry): entry is readonly [string, ToolTestState] => entry !== null,
        ),
    );
  } catch {
    return {};
  }
}

function saveToolTestStates(states: Record<string, ToolTestState>) {
  if (typeof window === "undefined") return;

  const persisted = Object.fromEntries(
    Object.entries(states)
      .map(([toolId, state]) => {
        const argsText = state.argsText || "{}";
        const result = state.result ?? null;

        if (argsText.trim() === "{}" && !result) return null;

        return [toolId, { argsText, result }] as const;
      })
      .filter(
        (entry): entry is readonly [
          string,
          { argsText: string; result: ToolCommandResult | null },
        ] => entry !== null,
      ),
  );

  if (Object.keys(persisted).length === 0) {
    window.localStorage.removeItem(TOOL_TEST_STATES_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    TOOL_TEST_STATES_STORAGE_KEY,
    JSON.stringify(persisted),
  );
}

function createBlankToolDraft(): ToolDraft {
  return {
    id: createId(),
    name: "",
    enabled: true,
    description: "",
    parametersText: JSON.stringify(
      { type: "object", properties: {}, required: [] },
      null,
      2,
    ),
    command: "",
    argsText: "",
    cwd: "",
    input: "json-stdin",
    timeoutMs: "30000",
  };
}

function toolToDraft(tool: LoadedToolInfo): ToolDraft {
  return {
    id: tool.id,
    name: tool.name,
    enabled: tool.enabled,
    description: tool.description,
    parametersText: JSON.stringify(tool.parameters, null, 2),
    command: tool.command,
    argsText: tool.args.join("\n"),
    cwd: tool.cwd ?? "",
    input: tool.input,
    timeoutMs: String(tool.timeoutMs),
  };
}

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
      draft: string;
      onDraftChange: (draft: string) => void;
      onSend: (content: string) => Promise<boolean> | boolean;
      onStop: () => void;
      footerStart?: ReactNode;
    }
  >(function ChatComposer(
    { disabled, isSending, draft, onDraftChange, onSend, onStop, footerStart },
    ref,
  ) {
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
        clear: () => onDraftChange(""),
        focus: focusTextarea,
      }),
      [focusTextarea, onDraftChange],
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
      if (wasSent) onDraftChange("");
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
              onChange={(event) => onDraftChange(event.target.value)}
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
  reasoningStepId?: string;
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
  const [toolsSettings, setToolsSettings] = useState<ToolsSettings>(
    DEFAULT_TOOLS_SETTINGS,
  );
  const [loadedTools, setLoadedTools] = useState<LoadedToolInfo[]>([]);
  const [toolLoadErrors, setToolLoadErrors] = useState<
    Array<{ source: string; message: string }>
  >([]);
  const [isLoadingTools, setIsLoadingTools] = useState(false);
  const [toolDraft, setToolDraft] = useState<ToolDraft | null>(null);
  const [isSavingTool, setIsSavingTool] = useState(false);
  const [toolTestStatesByToolId, setToolTestStatesByToolId] = useState<
    Record<string, ToolTestState>
  >(() => loadToolTestStates());
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  const [composerDraftsByChatId, setComposerDraftsByChatId] = useState<
    Record<string, string>
  >(() => loadComposerDrafts());
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
  const [toolsOpen, setToolsOpen] = useState(false);
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
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
  const activeComposerDraft = activeChatId
    ? (composerDraftsByChatId[activeChatId] ?? "")
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
  const activeModelSettings = getActiveModelSettings({
    ...activeProvider,
    model: "",
  });
  const selectedTool =
    loadedTools.find((tool) => tool.name === selectedToolName) ?? null;
  const currentToolTestState = toolDraft
    ? toolTestStatesByToolId[toolDraft.id]
    : undefined;
  const currentToolTestArgsText = currentToolTestState?.argsText ?? "{}";
  const currentToolTestResult = currentToolTestState?.result ?? null;
  const isTestingCurrentTool = currentToolTestState?.status === "running";
  const currentToolTestExecutionPreview =
    currentToolTestResult?.execution ??
    (isTestingCurrentTool && toolDraft
      ? buildToolExecutionPreviewForDraft(toolDraft, currentToolTestArgsText)
      : undefined);
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
    if (!didHydrateRef.current) return;
    saveToolsSettings(toolsSettings).catch((error) =>
      console.error("Failed to save tools settings:", error),
    );
  }, [toolsSettings]);

  useEffect(() => {
    if (loadedTools.length === 0) {
      if (selectedToolName !== null) setSelectedToolName(null);
      return;
    }

    const isEditingUnsavedTool =
      toolDraft &&
      !selectedToolName &&
      !loadedTools.some((tool) => tool.id === toolDraft.id);

    if (isEditingUnsavedTool) return;

    if (
      !selectedToolName ||
      !loadedTools.some((tool) => tool.name === selectedToolName)
    ) {
      setSelectedToolName(loadedTools[0].name);
    }
  }, [loadedTools, selectedToolName, toolDraft]);

  useEffect(() => {
    const selected = loadedTools.find((tool) => tool.name === selectedToolName);
    if (selected) {
      setToolDraft(toolToDraft(selected));
    }
  }, [loadedTools, selectedToolName]);

  useEffect(() => {
    if (!didHydrateRef.current || !activeChatId) return;
    saveActiveChatId(activeChatId).catch((error) =>
      console.error("Failed to save active chat id:", error),
    );
  }, [activeChatId]);

  useEffect(() => {
    saveComposerDrafts(composerDraftsByChatId);
  }, [composerDraftsByChatId]);

  useEffect(() => {
    saveToolTestStates(toolTestStatesByToolId);
  }, [toolTestStatesByToolId]);

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

  function getToolsBridge() {
    if (!window.chatForgeTools) {
      throw new Error("Electron tools bridge is not available.");
    }

    return window.chatForgeTools;
  }

  async function refreshTools(showToast = false) {
    setIsLoadingTools(true);

    try {
      const tools = await loadTools();
      setLoadedTools(tools);
      setToolLoadErrors([]);
      if (showToast) {
        showSuccess(
          `Loaded ${tools.length} tool${tools.length === 1 ? "" : "s"}.`,
        );
      }
    } catch (error) {
      console.error("Failed to load tools:", error);
      setToolLoadErrors([
        { source: "Tools storage", message: labelForError(error) },
      ]);
      showError("Failed to load tools", labelForError(error));
    } finally {
      setIsLoadingTools(false);
    }
  }

  function getEnabledTools() {
    if (!toolsSettings.enabled) return [];
    return loadedTools.filter((tool) => tool.enabled);
  }

  function formatJsonLikeCodeBlock(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "{}";

    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }

  function renderJsonCodeBlock(
    value: string,
    className = "chat-markdown-compact",
  ) {
    const normalized = formatJsonLikeCodeBlock(value);
    return (
      <MarkdownMessage
        className={className}
        content={`~~~json\n${normalized}\n~~~`}
      />
    );
  }

  function renderCodeBlock(
    value: string,
    language = "text",
    className = "chat-markdown-compact",
  ) {
    return (
      <MarkdownMessage
        className={className}
        content={`~~~${language}
${value}
~~~`}
      />
    );
  }

  function renderCommandCodeBlock(value: string) {
    return renderCodeBlock(value, "bash");
  }

  function renderToolExecutionPreview(execution?: ToolExecutionPreview) {
    if (!execution) return null;

    return (
      <>
        <div className="grid gap-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
            Command
          </div>
          {renderCommandCodeBlock(execution.displayCommand)}
        </div>
        {execution.cwd?.trim() && (
          <div className="grid gap-1.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
              Working directory
            </div>
            {renderCodeBlock(execution.cwd, "text")}
          </div>
        )}
      </>
    );
  }

  function hasMeaningfulToolInput(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return false;

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed == null) return false;
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        return Object.keys(parsed).length > 0;
      }
      if (Array.isArray(parsed)) return parsed.length > 0;
      return true;
    } catch {
      return Boolean(trimmed);
    }
  }

  function extractTemplatePlaceholders(args: string[]) {
    const placeholders = new Set<string>();
    const pattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
    for (const arg of args) {
      for (const match of arg.matchAll(pattern)) placeholders.add(match[1]);
    }
    return [...placeholders];
  }

  function getToolArgValue(args: unknown, key: string) {
    if (!args || typeof args !== "object" || Array.isArray(args) || !(key in args)) {
      throw new Error(`Missing required tool argument: ${key}`);
    }

    return (args as Record<string, unknown>)[key];
  }

  function stringifyCommandArgValue(value: unknown) {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (value === null || value === undefined) return "";
    return JSON.stringify(value);
  }

  function materializeCommandArgs(templateArgs: string[], modelArgs: unknown) {
    const templatePattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

    return templateArgs.map((templateArg) =>
      templateArg.replace(templatePattern, (_full, key: string) =>
        stringifyCommandArgValue(getToolArgValue(modelArgs, key)),
      ),
    );
  }

  function quoteCommandPreviewPart(value: string) {
    if (!value) return '""';
    if (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(value)) return value;
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  function formatCommandPreview(command: string, args: string[]) {
    return [command, ...args].map(quoteCommandPreviewPart).join(" ");
  }

  function buildToolExecutionPreview(
    tool: Pick<LoadedToolInfo, "command" | "args" | "cwd" | "input">,
    modelArgs: unknown,
  ): ToolExecutionPreview {
    const commandArgs = materializeCommandArgs(tool.args, modelArgs);
    const stdin =
      tool.input === "json-stdin" ? JSON.stringify(modelArgs ?? {}) : undefined;

    return {
      command: tool.command,
      args: commandArgs,
      cwd: tool.cwd,
      inputMode: tool.input,
      stdin,
      displayCommand: formatCommandPreview(tool.command, commandArgs),
      usesStdin: tool.input === "json-stdin",
      usesPlaceholders: extractTemplatePlaceholders(tool.args).length > 0,
    };
  }

  function parseToolArgumentsText(value: string) {
    return value.trim() ? JSON.parse(value) : {};
  }

  function parseArgsLines(value: string) {
    return value
      .split(/\r?\n/)
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0);
  }

  function buildToolExecutionPreviewForDraft(
    draft: ToolDraft,
    argsText: string,
  ) {
    try {
      return buildToolExecutionPreview(
        {
          command: draft.command,
          args: parseArgsLines(draft.argsText),
          cwd: draft.cwd.trim() || undefined,
          input: draft.input,
        },
        parseToolArgumentsText(argsText),
      );
    } catch {
      return undefined;
    }
  }

  function buildToolExecutionPreviewForCall(
    toolCall: ChatToolCall,
    result?: ChatToolResult,
  ) {
    if (result?.execution) return result.execution;

    const tool = loadedTools.find(
      (candidate) => candidate.name === toolCall.function.name,
    );
    if (!tool) return undefined;

    try {
      return buildToolExecutionPreview(
        tool,
        parseToolArgumentsText(toolCall.function.arguments || "{}"),
      );
    } catch {
      return undefined;
    }
  }

  function draftToTool(draft: ToolDraft): LoadedToolInfo {
    let parameters: Record<string, unknown>;

    try {
      const parsed = JSON.parse(draft.parametersText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Parameters schema must be a JSON object.");
      }
      parameters = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Invalid parameters JSON: ${labelForError(error)}`);
    }

    const args = draft.argsText
      .split(/\r?\n/)
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0);
    const timeoutMs = Number(draft.timeoutMs);

    return {
      id: draft.id,
      name: draft.name.trim(),
      enabled: draft.enabled,
      description: draft.description.trim(),
      parameters,
      command: draft.command.trim(),
      args,
      cwd: draft.cwd.trim() || undefined,
      input: draft.input,
      timeoutMs:
        Number.isFinite(timeoutMs) && timeoutMs > 0
          ? Math.round(timeoutMs)
          : 30000,
    };
  }

  function validateToolDraft(tool: LoadedToolInfo) {
    if (!tool.name) throw new Error("Tool name is required.");
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) {
      throw new Error(
        "Tool name must use only letters, numbers, underscores, or hyphens.",
      );
    }
    if (!tool.description) throw new Error("Tool description is required.");
    if (tool.parameters.type !== "object") {
      throw new Error('Parameters schema must include "type": "object".');
    }
    if (!tool.command) throw new Error("Command is required.");

    const properties =
      tool.parameters.properties &&
      typeof tool.parameters.properties === "object" &&
      !Array.isArray(tool.parameters.properties)
        ? Object.keys(tool.parameters.properties as Record<string, unknown>)
        : [];
    const required = Array.isArray(tool.parameters.required)
      ? tool.parameters.required.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const propertySet = new Set(properties);
    const requiredSet = new Set(required);

    for (const placeholder of extractTemplatePlaceholders(tool.args)) {
      if (!propertySet.has(placeholder)) {
        throw new Error(
          `Unknown placeholder: ${placeholder}. Add it to schema properties or update args.`,
        );
      }
      if (!requiredSet.has(placeholder)) {
        throw new Error(
          `Placeholder ${placeholder} is used in args, so it must be listed in schema.required for now.`,
        );
      }
    }
  }

  async function saveCurrentToolDraft() {
    if (!toolDraft) return;
    setIsSavingTool(true);

    try {
      const tool = draftToTool(toolDraft);
      validateToolDraft(tool);
      const savedTool = await saveTool(tool);
      setLoadedTools((current) => {
        const next = current.filter((item) => item.id !== savedTool.id);
        next.push(savedTool);
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      setSelectedToolName(savedTool.name);
      setToolDraft(toolToDraft(savedTool));
      showSuccess("Tool saved");
    } catch (error) {
      showError("Failed to save tool", labelForError(error));
    } finally {
      setIsSavingTool(false);
    }
  }

  async function deleteCurrentTool() {
    if (!toolDraft) return;

    try {
      await deleteStoredTool(toolDraft.id);
      setLoadedTools((current) =>
        current.filter((tool) => tool.id !== toolDraft.id),
      );
      setToolDraft(null);
      setSelectedToolName(null);
      setToolTestStatesByToolId((current) => {
        const { [toolDraft.id]: _deleted, ...rest } = current;
        void _deleted;
        return rest;
      });
      showSuccess("Tool deleted");
    } catch (error) {
      showError("Failed to delete tool", labelForError(error));
    }
  }

  function updateCurrentToolTestArgsText(argsText: string) {
    if (!toolDraft) return;

    setToolTestStatesByToolId((current) => ({
      ...current,
      [toolDraft.id]: {
        argsText,
        result: current[toolDraft.id]?.result ?? null,
        status: current[toolDraft.id]?.status,
        runId: current[toolDraft.id]?.runId,
      },
    }));
  }

  function clearCurrentToolTest() {
    if (!toolDraft) return;

    setToolTestStatesByToolId((current) => {
      const { [toolDraft.id]: _cleared, ...rest } = current;
      void _cleared;
      return rest;
    });
  }

  async function runCurrentToolTest() {
    if (!toolDraft) return;

    const tool = draftToTool(toolDraft);
    const argsText = currentToolTestArgsText;
    const runId = createId();

    setToolTestStatesByToolId((current) => ({
      ...current,
      [tool.id]: {
        argsText,
        result: null,
        status: "running",
        runId,
      },
    }));

    function finish(result: ToolCommandResult) {
      setToolTestStatesByToolId((current) => {
        const previous = current[tool.id] ?? { argsText, result: null };
        if (previous.runId && previous.runId !== runId) return current;

        return {
          ...current,
          [tool.id]: {
            argsText: previous.argsText ?? argsText,
            result,
          },
        };
      });
    }

    try {
      validateToolDraft(tool);
      const args = argsText.trim() ? JSON.parse(argsText) : {};
      const result = await getToolsBridge().test({ tool, args });
      finish(result);
    } catch (error) {
      finish({
        content: `Error: ${labelForError(error)}`,
        exitCode: null,
        stdout: "",
        stderr: labelForError(error),
        timedOut: false,
      });
    }
  }

  async function executeToolCall(
    toolCall: ChatToolCall,
  ): Promise<ChatToolResult> {
    const toolName = toolCall.function.name;

    try {
      const argsText = toolCall.function.arguments.trim() || "{}";
      const args = JSON.parse(argsText);
      const result = await getToolsBridge().execute({ name: toolName, args });

      return {
        toolCallId: toolCall.id,
        toolName: result.toolName || toolName,
        content: result.content,
        isError: result.timedOut || result.exitCode !== 0,
        execution: result.execution,
      };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        toolName,
        content: `Error: ${labelForError(error)}`,
        isError: true,
      };
    }
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

  function updateActiveComposerDraft(draft: string) {
    if (!activeChatId) return;

    setComposerDraftsByChatId((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };

      if (draft.length === 0) delete nextDrafts[activeChatId];
      else nextDrafts[activeChatId] = draft;

      return nextDrafts;
    });
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
    options: { reasoningStepId?: string } = {},
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

              const nextReasoning = patch.reasoning
                ? `${variant.reasoning ?? ""}${patch.reasoning}`
                : variant.reasoning;
              const nextProcessSteps =
                patch.reasoning && options.reasoningStepId
                  ? (variant.processSteps ?? []).map((step) =>
                      step.id === options.reasoningStepId &&
                      step.type === "thinking"
                        ? { ...step, content: step.content + patch.reasoning }
                        : step,
                    )
                  : variant.processSteps;

              return {
                ...variant,
                content: patch.content
                  ? variant.content + patch.content
                  : variant.content,
                reasoning: nextReasoning,
                processSteps: nextProcessSteps,
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
      { reasoningStepId: buffered.reasoningStepId },
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
    options: { reasoningStepId?: string } = {},
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
      reasoningStepId: options.reasoningStepId ?? buffered.reasoningStepId,
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

  function appendAssistantProcessSteps(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    steps: ChatAssistantProcessStep[],
  ) {
    if (!steps.length) return;

    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: [...(variant.processSteps ?? []), ...steps],
      }),
      { touch: false },
    );
  }

  function selectAssistantVariant(messageId: string, variantIndex: number) {
    updateActiveChatMessages(
      (currentMessages) =>
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
      { touch: false },
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
      showSuccess("Providers saved.");
      setSettingsOpen(false);
    } catch (error) {
      console.error("Failed to save providers:", error);
      showError("Failed to save providers", labelForError(error));
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

    let toolCallsForContext: ChatToolCall[] = [];
    let toolResultsForContext: ChatToolResult[] = [];
    let accumulatedContent = "";
    let accumulatedReasoning = "";

    const markVariantDone = (
      streamResult: Awaited<ReturnType<typeof streamProviderChat>>,
    ) => {
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
    };

    const appendToolCallsToVariant = (toolCalls: ChatToolCall[]) => {
      toolCallsForContext = [...toolCallsForContext, ...toolCalls];

      updateAssistantVariant(
        chatId,
        assistantMessageId,
        variantId,
        (variant) => ({
          ...variant,
          toolCalls: [...(variant.toolCalls ?? []), ...toolCalls],
          processSteps: [
            ...(variant.processSteps ?? []),
            ...toolCalls.map((toolCall) => ({
              id: createId(),
              type: "tool_execution" as const,
              toolCall,
            })),
          ],
        }),
        { touch: false },
      );
    };

    const applyToolResultsToVariant = (toolResults: ChatToolResult[]) => {
      toolResultsForContext = [...toolResultsForContext, ...toolResults];

      updateAssistantVariant(
        chatId,
        assistantMessageId,
        variantId,
        (variant) => {
          const existingResults = variant.toolResults ?? [];

          return {
            ...variant,
            toolResults: [...existingResults, ...toolResults],
            processSteps: (variant.processSteps ?? []).map((step) => {
              if (step.type !== "tool_execution" || step.toolResult) {
                return step;
              }

              const toolResult = toolResults.find(
                (item) => item.toolCallId === step.toolCall.id,
              );

              return toolResult ? { ...step, toolResult } : step;
            }),
          };
        },
        { touch: false },
      );
    };

    const buildContinuationMessages = (): ChatMessage[] => [
      ...contextMessages,
      {
        id: createId(),
        role: "user",
        content: userMessage,
        createdAt: new Date().toISOString(),
      },
      {
        id: assistantMessageId,
        role: "assistant",
        activeVariantIndex: 0,
        createdAt: new Date().toISOString(),
        variants: [
          {
            id: variantId,
            content: accumulatedContent,
            reasoning: accumulatedReasoning,
            status: "streaming",
            createdAt: new Date().toISOString(),
            toolCalls: toolCallsForContext,
            toolResults: toolResultsForContext,
          },
        ],
      },
    ];

    try {
      let currentMessages = contextMessages;
      let currentUserMessage: string | undefined = userMessage;
      let lastStreamResult:
        | Awaited<ReturnType<typeof streamProviderChat>>
        | undefined;

      for (let toolRound = 0; toolRound <= MAX_TOOL_ROUNDS; toolRound += 1) {
        const thinkingStepId = createId();
        appendAssistantProcessSteps(chatId, assistantMessageId, variantId, [
          { id: thinkingStepId, type: "thinking", content: "" },
        ]);

        if (chatId === activeChatId) {
          scheduleStickyScrollToBottom({
            settleFrames: STICKY_SCROLL_SETTLE_FRAMES,
          });
        }

        const streamResult = await streamProviderChat({
          provider: providerForRun,
          systemPrompt,
          messages: currentMessages,
          userMessage: currentUserMessage,
          signal: controller.signal,
          tools: getEnabledTools(),
          onContentDelta: (delta) => {
            accumulatedContent += delta;
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
            accumulatedReasoning += delta;
            appendBufferedAssistantVariant(
              chatId,
              assistantMessageId,
              variantId,
              {
                reasoning: delta,
              },
              { reasoningStepId: thinkingStepId },
            );

            if (chatId === activeChatId) {
              scheduleStickyScrollToBottom();
            }
          },
        });

        lastStreamResult = streamResult;

        flushBufferedAssistantVariant(
          getStreamBufferKey(chatId, assistantMessageId, variantId),
        );

        const toolCalls = streamResult.toolCalls ?? [];
        if (!toolCalls.length) break;

        if (toolRound >= MAX_TOOL_ROUNDS) {
          throw new Error(
            `Stopped after ${MAX_TOOL_ROUNDS} tool rounds to avoid an infinite loop.`,
          );
        }

        appendToolCallsToVariant(toolCalls);

        if (chatId === activeChatId) {
          scheduleStickyScrollToBottom({
            force: true,
            settleFrames: STICKY_SCROLL_SETTLE_FRAMES,
          });
        }

        const toolResults = await Promise.all(toolCalls.map(executeToolCall));
        applyToolResultsToVariant(toolResults);

        if (chatId === activeChatId) {
          scheduleStickyScrollToBottom({
            force: true,
            settleFrames: STICKY_SCROLL_SETTLE_FRAMES,
          });
        }

        currentMessages = buildContinuationMessages();
        currentUserMessage = undefined;
      }

      flushBufferedAssistantVariant(
        getStreamBufferKey(chatId, assistantMessageId, variantId),
      );

      markVariantDone(lastStreamResult ?? {});
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
          scheduleStickyScrollToBottom({
            force: true,
            settleFrames: STICKY_SCROLL_SETTLE_FRAMES,
          });
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
          processSteps: [],
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
                processSteps: [],
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
          processSteps: [],
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
            Providers
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setToolsOpen(true)}>
            <Wrench className="size-4" />
            Tools
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
                  No visible models. Enable models in Providers.
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
                <div className="grid gap-[1px]">
                  {group.chats.map((chat) => (
                    <div
                      key={chat.id}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group flex min-w-0 cursor-pointer items-center gap-1 border rounded-lg px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                        {/* <div className="truncate text-[11px] leading-4 text-muted-foreground">
                          {chat.messages.length} message
                          {chat.messages.length === 1 ? "" : "s"}
                          {" · "}
                          {formatChatActivityDate(getChatActivityDate(chat))}
                        </div> */}
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
                hasMessages ? "gap-5" : "h-full",
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
                        Open providers
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
                  const toolCalls = activeVariant?.toolCalls ?? [];
                  const toolResults = activeVariant?.toolResults ?? [];
                  const processSteps = activeVariant?.processSteps ?? [];
                  const hasProcessSteps = processSteps.length > 0;
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
                      {message.role === "assistant" && hasProcessSteps && (
                        <div className="grid gap-2">
                          {processSteps.map((step) => {
                            if (step.type === "thinking") {
                              if (!step.content.trim()) return null;

                              const isLatestProcessStep =
                                processSteps[processSteps.length - 1]?.id ===
                                step.id;
                              const isThinkingStreaming =
                                status === "streaming" &&
                                isLatestProcessStep &&
                                !content;

                              return (
                                <article
                                  key={step.id}
                                  className="flex min-w-0 max-w-full justify-start"
                                >
                                  <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
                                    <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
                                      <Brain className="size-3.5" />
                                      Thinking{isThinkingStreaming ? "..." : ""}
                                    </div>
                                    <div className="min-w-0 overflow-visible text-xs leading-5">
                                      <SmoothAssistantMessageContent
                                        content={step.content}
                                        className="chat-markdown-compact shrink-0"
                                        isApiStreaming={isThinkingStreaming}
                                        flushVersion={
                                          visualFlushRequests[
                                            `${message.id}:${step.id}`
                                          ] ?? 0
                                        }
                                        forceInstant={Boolean(content)}
                                        onVisualProgress={() =>
                                          handleAssistantVisualProgress(
                                            activeChat?.id ?? "",
                                          )
                                        }
                                        onVisualStreamingChange={(
                                          isStreaming,
                                        ) =>
                                          handleAssistantVisualStreamingChange(
                                            `${message.id}:${step.id}`,
                                            isStreaming,
                                          )
                                        }
                                      />
                                    </div>
                                  </div>
                                </article>
                              );
                            }

                            const result = step.toolResult;
                            const executionPreview =
                              buildToolExecutionPreviewForCall(
                                step.toolCall,
                                result,
                              );
                            const showToolInput =
                              hasMeaningfulToolInput(
                                step.toolCall.function.arguments || "",
                              ) &&
                              (!executionPreview || executionPreview.usesStdin);

                            return (
                              <article
                                key={step.id}
                                className="flex min-w-0 max-w-full justify-start"
                              >
                                <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border bg-muted/25 px-4 py-3 text-xs leading-5 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
                                  <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    <Wrench className="size-3.5" />
                                    <span>{step.toolCall.function.name}</span>
                                    <span className="text-muted-foreground/60">
                                      •
                                    </span>
                                    {result ? (
                                      <span
                                        className={cn(
                                          "inline-flex items-center gap-1",
                                          result.isError
                                            ? "text-red-600 dark:text-red-400"
                                            : "text-green-600 dark:text-green-400",
                                        )}
                                      >
                                        {result.isError ? (
                                          <X className="size-3.5" />
                                        ) : (
                                          <Check className="size-3.5" />
                                        )}
                                        {result.isError ? "Failed" : "Complete"}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                        <Spinner className="size-3.5" />
                                        Running
                                      </span>
                                    )}
                                  </div>
                                  <div className="grid gap-3">
                                    {renderToolExecutionPreview(executionPreview)}
                                    {showToolInput && (
                                      <div className="grid gap-1.5">
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                          Input
                                        </div>
                                        {renderJsonCodeBlock(
                                          step.toolCall.function.arguments ||
                                            "{}",
                                        )}
                                      </div>
                                    )}
                                    {result?.content.trim() && (
                                      <div className="grid gap-1.5">
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                          Output
                                        </div>
                                        {renderJsonCodeBlock(result.content)}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}

                      {message.role === "assistant" &&
                        !hasProcessSteps &&
                        reasoning.trim() &&
                        (() => {
                          return (
                            <article className="flex min-w-0 max-w-full justify-start">
                              <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
                                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
                                  <Brain className="size-3.5" />
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

                      {message.role === "assistant" &&
                        !hasProcessSteps &&
                        toolCalls.length > 0 && (
                          <div className="grid gap-2">
                            {toolCalls.map((toolCall) => {
                              const result = toolResults.find(
                                (item) => item.toolCallId === toolCall.id,
                              );
                              const executionPreview =
                                buildToolExecutionPreviewForCall(
                                  toolCall,
                                  result,
                                );
                              const showToolInput =
                                hasMeaningfulToolInput(
                                  toolCall.function.arguments || "",
                                ) &&
                                (!executionPreview ||
                                  executionPreview.usesStdin);

                              return (
                                <article
                                  key={toolCall.id}
                                  className="flex min-w-0 max-w-full justify-start"
                                >
                                  <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border bg-muted/25 px-4 py-3 text-xs leading-5 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
                                    <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      <Wrench className="size-3.5" />
                                      <span>{toolCall.function.name}</span>
                                      <span className="text-muted-foreground/60">
                                        •
                                      </span>
                                      {result ? (
                                        <span
                                          className={cn(
                                            "inline-flex items-center gap-1",
                                            result.isError
                                              ? "text-red-600 dark:text-red-400"
                                              : "text-green-600 dark:text-green-400",
                                          )}
                                        >
                                          {result.isError ? (
                                            <X className="size-3.5" />
                                          ) : (
                                            <Check className="size-3.5" />
                                          )}
                                          {result.isError
                                            ? "Failed"
                                            : "Complete"}
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground/80">
                                          Running
                                        </span>
                                      )}
                                    </div>
                                    <div className="grid gap-3">
                                      {renderToolExecutionPreview(executionPreview)}
                                      {showToolInput && (
                                        <div className="grid gap-1.5">
                                          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                            Input
                                          </div>
                                          {renderJsonCodeBlock(
                                            toolCall.function.arguments || "{}",
                                          )}
                                        </div>
                                      )}
                                      {result && (
                                        <div className="grid gap-1.5">
                                          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                            Output
                                          </div>
                                          {renderJsonCodeBlock(result.content)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        )}

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
                                    : "min-w-0 max-w-full overflow-visible px-0 py-1 text-card-foreground shadow-xs",
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
          draft={activeComposerDraft}
          onDraftChange={updateActiveComposerDraft}
          onSend={sendMessage}
          onStop={stopGeneration}
          footerStart={renderComposerModelSelector()}
        />
      </section>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="flex h-[min(820px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle>Providers</DialogTitle>
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

      <Dialog open={toolsOpen} onOpenChange={setToolsOpen}>
        <DialogContent className="flex h-[min(820px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle>Tools</DialogTitle>
            <DialogDescription>
              Define local command tools, choose which ones are available to the
              model, and test them before use.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b bg-card/70 p-3 md:border-b-0 md:border-r">
              <div className="mb-3 flex items-center justify-between gap-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Tools
                </Label>
                <span className="text-xs text-muted-foreground">
                  {getEnabledTools().length}/{loadedTools.length} enabled
                </span>
              </div>

              <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">
                    Enable tools globally
                  </span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    Disabled globally means no tool schemas are sent to the
                    model.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={toolsSettings.enabled}
                  onChange={(event) =>
                    setToolsSettings((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                  className="size-4 shrink-0 accent-primary"
                />
              </label>

              <div className="mb-3 flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="flex-1 rounded-lg"
                  onClick={() => {
                    const draft = createBlankToolDraft();
                    setSelectedToolName(null);
                    setToolDraft(draft);
                  }}
                >
                  <Plus className="size-4" />
                  Add tool
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="rounded-lg"
                  onClick={() => refreshTools(true)}
                  disabled={isLoadingTools}
                  title="Reload tools from app storage"
                >
                  <RefreshCcw
                    className={cn("size-4", isLoadingTools && "animate-spin")}
                  />
                </Button>
              </div>

              <div className="grid gap-1.5">
                {loadedTools.length > 0 ? (
                  loadedTools.map((tool) => (
                    <div
                      key={tool.id}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selectedTool?.id === tool.id
                          ? "border-primary/30 bg-accent text-accent-foreground"
                          : "border-transparent hover:border-border hover:bg-muted/60",
                      )}
                      onClick={() => setSelectedToolName(tool.name)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedToolName(tool.name);
                        }
                      }}
                    >
                      <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm leading-5">
                          {tool.name}
                        </div>
                        <div className="truncate text-[11px] leading-4 text-muted-foreground">
                          {tool.enabled ? "Enabled" : "Disabled"} ·{" "}
                          {tool.command}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={tool.enabled}
                        onClick={(event) => event.stopPropagation()}
                        onChange={async (event) => {
                          const updated = {
                            ...tool,
                            enabled: event.target.checked,
                          };
                          try {
                            const saved = await saveTool(updated);
                            setLoadedTools((current) =>
                              current.map((item) =>
                                item.id === saved.id ? saved : item,
                              ),
                            );
                            if (toolDraft?.id === saved.id)
                              setToolDraft(toolToDraft(saved));
                          } catch (error) {
                            showError(
                              "Failed to update tool",
                              labelForError(error),
                            );
                          }
                        }}
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                        title={tool.enabled ? "Disable tool" : "Enable tool"}
                      />
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                    No tools configured.
                  </div>
                )}
              </div>

              {toolLoadErrors.length > 0 && (
                <div className="mt-4 grid gap-2">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Load errors
                  </Label>
                  {toolLoadErrors.map((error) => (
                    <div
                      key={`${error.source}:${error.message}`}
                      className="rounded-lg border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs leading-5"
                    >
                      <div
                        className="truncate font-medium text-destructive"
                        title={error.source}
                      >
                        {error.source}
                      </div>
                      <div className="text-muted-foreground">
                        {error.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </aside>

            <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
              {toolDraft ? (
                <div className="grid gap-5 pb-1">
                  <div>
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {selectedTool ? "Edit tool" : "Create tool"}
                    </Label>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="tool-name">Name</Label>
                    <Input
                      id="tool-name"
                      value={toolDraft.name}
                      onChange={(event) =>
                        setToolDraft((current) =>
                          current
                            ? { ...current, name: event.target.value }
                            : current,
                        )
                      }
                      placeholder="calculate_square_root"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="tool-description">Description</Label>
                    <Textarea
                      id="tool-description"
                      value={toolDraft.description}
                      onChange={(event) =>
                        setToolDraft((current) =>
                          current
                            ? { ...current, description: event.target.value }
                            : current,
                        )
                      }
                      placeholder="Describe when the model should use this tool."
                      className="min-h-20 resize-y"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="tool-command">Command</Label>
                    <Input
                      id="tool-command"
                      value={toolDraft.command}
                      onChange={(event) =>
                        setToolDraft((current) =>
                          current
                            ? { ...current, command: event.target.value }
                            : current,
                        )
                      }
                      placeholder="node / python / rg / git"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="tool-schema">Parameters JSON schema</Label>
                    <Textarea
                      id="tool-schema"
                      value={toolDraft.parametersText}
                      onChange={(event) =>
                        setToolDraft((current) =>
                          current
                            ? { ...current, parametersText: event.target.value }
                            : current,
                        )
                      }
                      className="min-h-64 resize-y font-mono text-xs"
                      spellCheck={false}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="tool-args">Arguments, one per line</Label>
                    <Textarea
                      id="tool-args"
                      value={toolDraft.argsText}
                      onChange={(event) =>
                        setToolDraft((current) =>
                          current
                            ? { ...current, argsText: event.target.value }
                            : current,
                        )
                      }
                      placeholder={
                        "C:/Prime/Tools/math-tool/dist/index.js\n--query\n{{query}}"
                      }
                      className="min-h-32 resize-y font-mono text-xs"
                      spellCheck={false}
                    />
                    <p className="text-xs leading-5 text-muted-foreground">
                      Use <code>{"{{fieldName}}"}</code> placeholders for
                      existing CLIs. Every placeholder must exist in
                      schema.properties and schema.required.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="tool-input-mode">Input mode</Label>
                      <Select
                        value={toolDraft.input}
                        onValueChange={(value) =>
                          setToolDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  input:
                                    value === "none" ? "none" : "json-stdin",
                                }
                              : current,
                          )
                        }
                      >
                        <SelectTrigger
                          id="tool-input-mode"
                          className="rounded-lg"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="json-stdin">JSON stdin</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs leading-5 text-muted-foreground">
                        JSON stdin is best for scripts you write. None is best
                        for existing CLI flags/placeholders.
                      </p>
                    </div>
                    <div className="grid gap-2 content-start">
                      <Label htmlFor="tool-timeout">Timeout ms</Label>
                      <Input
                        id="tool-timeout"
                        value={toolDraft.timeoutMs}
                        onChange={(event) =>
                          setToolDraft((current) =>
                            current
                              ? { ...current, timeoutMs: event.target.value }
                              : current,
                          )
                        }
                        inputMode="numeric"
                      />
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="tool-cwd">Working directory</Label>
                    <Input
                      id="tool-cwd"
                      value={toolDraft.cwd}
                      onChange={(event) =>
                        setToolDraft((current) =>
                          current
                            ? { ...current, cwd: event.target.value }
                            : current,
                        )
                      }
                      placeholder="Optional. Example: C:/Prime/Tools/math-tool"
                    />
                  </div>

                  <Separator />

                  <div className="grid gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label>Test tool</Label>
                        <p className="text-xs leading-5 text-muted-foreground">
                          Run this manifest locally with sample model arguments.
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          className="rounded-lg"
                          onClick={clearCurrentToolTest}
                          disabled={!currentToolTestState || isTestingCurrentTool}
                        >
                          Clear test
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          className="rounded-lg"
                          onClick={runCurrentToolTest}
                          disabled={isTestingCurrentTool}
                        >
                          {isTestingCurrentTool ? "Running..." : "Run test"}
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      value={currentToolTestArgsText}
                      onChange={(event) =>
                        updateCurrentToolTestArgsText(event.target.value)
                      }
                      disabled={isTestingCurrentTool}
                      className="min-h-24 resize-y font-mono text-xs"
                      spellCheck={false}
                      placeholder='{ "value": 144 }'
                    />
                    {(currentToolTestResult || currentToolTestExecutionPreview) && (
                      <div className="grid gap-3 rounded-lg border bg-card p-3">
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          {currentToolTestResult ? (
                            <span>
                              Exit: {currentToolTestResult.exitCode ?? "null"} ·{" "}
                              {currentToolTestResult.timedOut
                                ? "Timed out"
                                : "Completed"}
                            </span>
                          ) : (
                            <span>Running command</span>
                          )}
                          {currentToolTestResult ? (
                            currentToolTestResult.exitCode !== 0 ||
                            currentToolTestResult.timedOut ? (
                              <span className="inline-flex items-center gap-1 text-destructive">
                                <X className="size-3.5" />
                                Failed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                                <Check className="size-3.5" />
                                Complete
                              </span>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                              <Spinner className="size-3.5" />
                              Running
                            </span>
                          )}
                        </div>
                        {renderToolExecutionPreview(currentToolTestExecutionPreview)}
                        {currentToolTestResult && (
                          <div className="grid gap-1.5">
                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                              Output
                            </div>
                            {renderJsonCodeBlock(currentToolTestResult.content)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Select a tool or add a new one.
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="shrink-0 items-center justify-between border-t px-5 py-3">
            <div className="flex gap-2">
              {toolDraft && (
                <Button
                  type="button"
                  variant="destructive"
                  className="rounded-lg"
                  onClick={deleteCurrentTool}
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="rounded-lg"
                onClick={() => setToolsOpen(false)}
              >
                Close
              </Button>
              <Button
                type="button"
                className="rounded-lg"
                onClick={saveCurrentToolDraft}
                disabled={!toolDraft || isSavingTool}
              >
                {isSavingTool ? "Saving..." : "Save"}
              </Button>
            </div>
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
