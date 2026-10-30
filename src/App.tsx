import {
  ChangeEvent,
  CSSProperties,
  type Dispatch,
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  RefObject,
  ReactNode,
  type SetStateAction,
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUp, BookOpen, Brain, Check, ChevronDown, ChevronRight, FilePenLine, FilePlus2, Image as ImageIcon, Loader2, Maximize2, Menu, Paperclip, Plus, Settings, Square, Terminal, Wrench, X } from "lucide-react";
import { MarkdownRenderer } from "./components/markdown-renderer";
import { AttachmentChip } from "./components/attachment-chip";
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_WEBVIEW_ATTACHMENT_BYTES, composeAttachmentPrompt, parseAttachmentPrompt, supportsImageInput, uint8ToBase64, type ManagedAttachment } from "./core/attachments";
import { ModelSwitcher } from "./components/model-switcher";
import { MessageQueue } from "./components/message-queue";
import { QueueModeSelect } from "./components/queue-mode-select";
import { composerFadeInset, composerOverlayClearance, createPiUserMessageDelivery, normalizePiQueue, sendBehavior, textareaHeightLimit, type PiQueue, type QueueDelivery } from "./core/message-queue";
import { ContextUsagePopover, type ContextUsageDetails } from "./components/context-usage-popover";
import { ProjectSessionSidebar } from "./components/project-session-sidebar";
import { type ProjectSummary, projectKeyForSidebar } from "./core/project-sidebar";
import { readLastProjectSessions, rememberLastProjectSession, writeLastProjectSessions } from "./core/project-history";
import { executeProjectSwitch } from "./core/project-switch-lifecycle";
import { requestFullHistory } from "./core/pi-history-rpc";
import { createPiDeltaCoalescer } from "./core/pi-delta-coalescer";
import { ToolDiffViewer, ToolWriteContentViewer } from "./components/tool-diff-viewer";
import { ToolOutputContent } from "./components/tool-text-viewer";
import { LoadingScreen } from "./components/loading-screen";
import { PiStartupWelcome } from "./components/pi-startup-welcome";
import { SettingsView, type SettingsSection } from "./components/settings-view";
import { groupCompactActivityGroups, readTimelineMode, summarizeCompactActivity, type TimelineMode } from "./core/timeline-detail";
import { shouldNotifyForSettledRun } from "./core/response-notifications";
import { WindowControls } from "./components/window-controls";
import { HoverMarqueeText } from "./components/hover-marquee-text";
import {
  FORCED_SCROLL_SETTLE_FRAMES,
  MANUAL_SCROLL_INPUT_MS,
  PROGRAMMATIC_SCROLL_GUARD_MS,
  STICKY_SCROLL_SETTLE_FRAMES,
  TOUCH_SCROLL_INPUT_MS,
  chatDistanceFromBottom,
  historyLandingPosition,
  keyboardActivatesReaderLayoutInteraction,
  keyboardMarksManualScroll,
  keyboardStopsAutoFollow,
  nextStickyScrollTop,
  pointerMarksManualScroll,
  readerScrollTopForAnchor,
  shouldResumeAutoFollowFromManualScroll,
  shouldShowScrollToBottomButton,
  stickyScrollReachedTarget,
  stickyScrollTarget,
} from "./core/chat-autoscroll";
import {
  THINKING_PREVIEW_INTERVAL_MS,
  displayedThinkingPreview,
  firstThinkingPreviewLine,
  lastThinkingPreviewLine,
  nextSampledThinkingLine,
  rollingThinkingPreview,
} from "./core/thinking-preview";
import {
  firstActivityPreviewLine,
  rollingActivityPreview,
} from "./core/activity-preview";
import backgroundMountainsDark from "./assets/background-mountains-dark.jpg";
import backgroundMountainsLight from "./assets/background-mountains-light.jpg";
import {
  backgroundImageAcceptValue,
  isSupportedBackgroundImage,
  readAppearanceSettings,
  resolveThemePreference,
  selectActiveBackgroundUrl,
  writeBackgroundImagesEnabled,
  writeThemePreference,
  type BackgroundTheme,
  type ThemePreference,
} from "./core/appearance";
import { clearStoredBackground, loadStoredBackground, saveStoredBackground, type StoredBackgroundImage } from "./core/background-store";
import {
  createSetModelRecord,
  findModelMatch,
  type ModelOption,
} from "./core/model-switcher";
import {
  INTERRUPT_ABORT_TIMEOUT_MS,
  INTERRUPT_CLEAR_QUEUE_TIMEOUT_MS,
  INTERRUPT_COMPACTION_RESTART_TIMEOUT_MS,
  INTERRUPT_IDLE_POLL_INTERVAL_MS,
  INTERRUPT_IDLE_SETTLE_TIMEOUT_MS,
  INTERRUPT_SYNC_TIMEOUT_MS,
  latestForkCandidate,
  mergeRecoveredPrompt,
  mergeRestoredQueuedText,
  queuedTextFromClearQueue,
  runtimeStateAfterInterrupt,
  unmatchedToolCallIds,
} from "./core/interruption-lifecycle";
import { extensionUiBlocksAgent, normalizeExtensionWidget, piRuntimeSnapshot } from "./core/pi-rpc-lifecycle";
import { contextEstimateAfterCompaction, resolveContextUsage } from "./core/context-usage";
import { chatContentGeometry } from "./core/chat-content-geometry";
import {
  readAppFontFamily,
  writeAppFontFamily,
  type AppFontFamily,
} from "./core/ui-preferences";
import { diffSummary, previewEditDiff, toolDiffFromResult, writeContentFromArgs } from "./core/tool-diff";
import { historyRecordsFromSessionEntries } from "./core/session-history";
import { extractToolResultText } from "./core/tool-text";
import {
  compactionResultSummary,
  fileMutationToolSummary,
  mergeStreamingToolOutput,
  readToolSummary,
  readToolSummaryParts,
  terminalInputPreview,
} from "./core/tool-presentation";
import {
  assistantErrorMessage,
  historyAssistantErrorMessage,
  isAssistantAbortTerminal,
  isProviderAbortMessage,
  shouldSurfacePendingAssistantError,
} from "./core/pi-assistant-errors";
import { formatSessionDate } from "./core/session-display";
import {
  readRecentProjects,
  rememberRecentProject,
  writeRecentProjects,
} from "./core/recent-projects";
import {
  BUILT_INS,
  COMMAND_SOURCE_ORDER,
  TUI_ONLY,
  buildTranscriptTurns,
  commandSourceLabel,
  commandSourceRank,
  estimateTranscriptTurnHeight,
  findBlockIndexForOffset,
  groupTranscriptItems,
  segmentRuntimeGroupItems,
  resolveActivityExpanded,
  shouldFinalizeThinkingForAssistantEvent,
  shouldShowToolOutput,
  shouldShowToolPreview,
  interruptRunningRuntimeItems,
  normalizeThinkingContent,
  recoverFencedMarkdownTables,
  transcriptItemsShallowEqual,
  type CommandInfo,
  type TranscriptGroup,
  type TranscriptItem,
  type TranscriptTurn,
} from "./core/chat-logic";

type Json = Record<string, any>;

type PendingRpcResponse = {
  resolve: (record: Json) => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

type PiModel = ModelOption;

type SessionInfo = {
  path: string;
  id: string;
  name?: string | null;
  firstMessage?: string | null;
  timestamp?: string | null;
  activityTimestamp?: string | null;
  modifiedAt: number;
};

type SessionStats = {
  sessionFile?: string;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  toolResults?: number;
  totalMessages?: number;
  tokens?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
};

type ContextBreakdown = {
  systemPromptTokens: number;
  toolDefinitionTokens: number;
  approximate: boolean;
};

type GenerationStatus = string;

type ExtensionDialog = {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
};

type ExtensionWidget = {
  key: string;
  placement: "aboveEditor" | "belowEditor";
  lines: string[];
};

type ExtensionNotice = {
  id: string;
  message: string;
  kind: "info" | "warning" | "error";
};

function rpcResponseText(data: unknown) {
  if (data == null) return "Completed successfully.";
  if (typeof data === "string") return data || "Completed successfully.";
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  return `\`\`\`json\n${pretty(data)}\n\`\`\``;
}

const CHAT_WIDTH_STORAGE_KEY = "molten-forge-pi-chat-width";
const SIDEBAR_WIDTH_STORAGE_KEY = "molten-forge-pi-sidebar-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "molten-forge-pi-sidebar-collapsed";
const LAST_WORKING_DIRECTORY_STORAGE_KEY = "molten-forge-pi-last-working-directory";
const AUTO_EXPAND_THINKING_STORAGE_KEY = "molten-forge-pi-auto-expand-thinking";
const AUTO_EXPAND_TOOLS_STORAGE_KEY = "molten-forge-pi-auto-expand-tools";
const TIMELINE_MODE_STORAGE_KEY = "molten-forge-pi-timeline-mode";
const BACKGROUND_COMPLETION_NOTIFICATION_KEY = "molten-forge-pi-notify-when-response-completes";
/* MF appearance surfaces: phase 2 */
const WALLPAPER_OVERLAY_STORAGE_KEY = "molten-forge-pi-wallpaper-overlay-percent";
function getInitialWallpaperOverlayPercent() {
  try {
    const value = Number(window.localStorage.getItem(WALLPAPER_OVERLAY_STORAGE_KEY));
    return Number.isFinite(value) && value >= 0 && value <= 25 ? Math.round(value) : 0;
  } catch {
    return 0;
  }
}
const PREFERRED_MODEL_STORAGE_KEY = "molten-forge-pi-preferred-model";
const HISTORY_SYNC_TIMEOUT_MS = 60_000;
const READER_LAYOUT_INTERACTION_SELECTOR = '[data-reader-layout-interaction="true"]';
const DEFAULT_CHAT_WIDTH = 900;
const MIN_CHAT_WIDTH = 560;
const CHAT_SIDE_GUTTER = 48;
const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 190;
const MAX_SIDEBAR_WIDTH = 520;
const DEFAULT_BACKGROUND_IMAGE_URLS: Record<BackgroundTheme, string> = {
  light: backgroundMountainsLight,
  dark: backgroundMountainsDark,
};

type CustomBackgroundView = { name: string; url: string };
type CustomBackgroundViews = Partial<Record<BackgroundTheme, CustomBackgroundView>>;

function getInitialAppearanceSettings() {
  try {
    return readAppearanceSettings(window.localStorage);
  } catch {
    return { theme: "system" as ThemePreference, backgroundImagesEnabled: true };
  }
}

function getSystemPrefersDark() {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getInitialAppFontFamily(): AppFontFamily {
  try {
    return readAppFontFamily(window.localStorage);
  } catch {
    return "sans";
  }
}

function getStoredWidth(key: string, fallback: number, min: number, max = Number.POSITIVE_INFINITY) {
  try {
    const stored = Number.parseInt(window.localStorage.getItem(key) ?? "", 10);
    if (Number.isFinite(stored) && stored >= min && stored <= max) return stored;
  } catch {
    // localStorage can be unavailable in unusual webview configurations.
  }
  return fallback;
}

function getInitialChatWidth() {
  return getStoredWidth(CHAT_WIDTH_STORAGE_KEY, DEFAULT_CHAT_WIDTH, MIN_CHAT_WIDTH);
}

function getInitialSidebarWidth() {
  return getStoredWidth(SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}

function getStoredWorkingDirectory() {
  try {
    return window.localStorage.getItem(LAST_WORKING_DIRECTORY_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function getInitialRecentProjects() {
  try {
    const projects = readRecentProjects(window.localStorage);
    const lastWorkingDirectory = getStoredWorkingDirectory();
    return lastWorkingDirectory
      ? rememberRecentProject(projects, lastWorkingDirectory)
      : projects;
  } catch {
    return [];
  }
}

function persistWorkingDirectory(workingDirectory: string) {
  const value = workingDirectory.trim();
  if (!value) return;
  try {
    window.localStorage.setItem(LAST_WORKING_DIRECTORY_STORAGE_KEY, value);
  } catch {
    // Persistence is optional; the current session still works without localStorage.
  }
}

function getStoredBoolean(key: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    // localStorage is optional.
  }
  return fallback;
}

function getStoredPreferredModel(): { provider: string; id: string } | null {
  try {
    const raw = window.localStorage.getItem(PREFERRED_MODEL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.provider === "string" && typeof parsed?.id === "string") return parsed;
  } catch {
    // Ignore malformed persisted UI state.
  }
  return null;
}

function persistPreferredModel(model: PiModel) {
  if (!model.provider || !model.id) return;
  try {
    window.localStorage.setItem(PREFERRED_MODEL_STORAGE_KEY, JSON.stringify({ provider: model.provider, id: model.id }));
  } catch {
    // Pi settings persistence still works if localStorage is unavailable.
  }
}

type ActivityDisplaySettings = {
  timelineMode: TimelineMode;
  autoExpandThinking: boolean;
  autoExpandTools: boolean;
};

const ActivityDisplaySettingsContext = createContext<ActivityDisplaySettings>({
  timelineMode: "compact",
  autoExpandThinking: true,
  autoExpandTools: true,
});

const WorkingDirectoryContext = createContext("");


function uid(prefix = "item") {
  return `${prefix}-${crypto.randomUUID()}`;
}

function extractText(message: any): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("");
}

function extractVisibleContent(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n");
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatToolArgs(toolName: string, args: unknown): string {
  if (toolName === "bash" && args && typeof args === "object" && "command" in args) {
    const command = String((args as Record<string, unknown>).command ?? "");
    return command ? `$ ${command}` : pretty(args);
  }
  return pretty(args);
}

function formatToolExecution(toolName: string, args: unknown, output: string): string {
  const invocation = formatToolArgs(toolName, args);
  if (!output) return invocation;
  return `${invocation}\n\n${output}`;
}

function truncate(value: string, max = 58) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function formatRetryDelay(delayMs: number) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return "";
  if (delayMs < 1000) return `${Math.round(delayMs)} ms`;
  const seconds = delayMs / 1000;
  return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
}

function formatHeaderTokens(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "0";
  const safe = Math.max(0, value);
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(safe >= 10_000_000 ? 0 : 1)}M`;
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(safe >= 100_000 ? 0 : 1)}k`;
  return `${Math.round(safe)}`;
}

function sessionTitle(session: SessionInfo) {
  return session.name?.trim() || truncate(session.firstMessage ?? "") || "New session";
}

function historyToTranscript(messages: any[]): TranscriptItem[] {
  const result: TranscriptItem[] = [];
  const toolsByCallId = new Map<string, number>();

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || typeof message !== "object") continue;

    if (message.role === "user") {
      const text = extractVisibleContent(message.content);
      if (text) {
        const parsed = parseAttachmentPrompt(text);
        result.push({ id: uid("history-user"), kind: "user", ...parsed });
      }
      continue;
    }

    if (message.role === "assistant") {
      const abortTerminal = isAssistantAbortTerminal(message);
      const assistantFailure = assistantErrorMessage(message);
      const historyFailure = assistantFailure
        ? historyAssistantErrorMessage(messages, messageIndex)
        : null;
      // Pi keeps failed retry attempts in raw session history. Do not restore
      // those superseded attempts as terminal errors; live retry UI already
      // represents them, and only the final unsuperseded failure belongs in
      // the restored conversation.
      if (assistantFailure && !historyFailure) continue;

      const content = Array.isArray(message.content) ? message.content : [];
      const toolCalls = content.filter((part: any) => part?.type === "toolCall");
      const batchId = toolCalls.length ? `history-batch-${messageIndex}` : undefined;
      const thinking = content
        .filter((part: any) => part?.type === "thinking" && typeof part.thinking === "string")
        .map((part: any) => part.thinking)
        .join("\n\n");
      if (thinking) {
        result.push({
          id: uid("history-thinking"),
          kind: "thinking",
          title: "Thinking",
          text: thinking,
          state: "done",
        });
      }

      for (const part of toolCalls) {
        const callId = String(part.id ?? uid("tool"));
        const item: TranscriptItem = {
          id: `history-tool-${callId}`,
          kind: "tool",
          title: String(part.name ?? "tool"),
          text: "",
          toolInput: formatToolArgs(String(part.name ?? "tool"), part.arguments ?? {}),
          toolOutput: "",
          toolArgs: part.arguments ?? {},
          toolDiff: /^edit$/i.test(String(part.name ?? "tool")) ? previewEditDiff(part.arguments ?? {}) : undefined,
          toolCallId: callId,
          toolBatchId: batchId,
          state: abortTerminal ? "interrupted" : "done",
        };
        toolsByCallId.set(callId, result.length);
        result.push(item);
      }

      const text = extractText(message);
      if (text) result.push({ id: uid("history-assistant"), kind: "assistant", text });
      if (historyFailure) {
        result.push({
          id: uid("history-error"),
          kind: "error",
          title: "Error",
          text: historyFailure,
        });
      }
      continue;
    }

    if (message.role === "toolResult") {
      const callId = String(message.toolCallId ?? message.id ?? "");
      const output = extractToolResultText(message);
      const existingIndex = callId ? toolsByCallId.get(callId) : undefined;
      if (existingIndex !== undefined) {
        const existing = result[existingIndex];
        const resultDiff = toolDiffFromResult(existing.title ?? "tool", existing.toolArgs, message.details, Boolean(message.isError));
        result[existingIndex] = {
          ...existing,
          toolOutput: output,
          toolResultDetails: message.details,
          toolDiff: message.isError ? resultDiff : (resultDiff ?? existing.toolDiff),
          toolExecutionStarted: true,
          state: existing.state === "interrupted"
            ? "interrupted"
            : message.isError
              ? "error"
              : "done",
        };
      } else {
        result.push({
          id: uid("history-tool-result"),
          kind: "tool",
          title: String(message.toolName ?? "tool"),
          text: "",
          toolInput: "",
          toolOutput: output,
          toolArgs: undefined,
          toolResultDetails: message.details,
          toolDiff: toolDiffFromResult(String(message.toolName ?? "tool"), undefined, message.details, Boolean(message.isError)),
          toolCallId: callId || undefined,
          toolExecutionStarted: true,
          state: message.isError ? "error" : "done",
        });
      }
      continue;
    }

    if (message.role === "bashExecution") {
      result.push({
        id: uid("history-shell"),
        kind: "tool",
        title: "shell",
        text: "",
        toolInput: `$ ${message.command ?? ""}`,
        toolOutput: String(message.output ?? ""),
        state: message.cancelled
          ? "interrupted"
          : (typeof message.exitCode === "number" && message.exitCode !== 0)
            ? "error"
            : "done",
      });
      continue;
    }

    if (message.role === "__moltenForgeCompactionEntry") {
      const details = message.details && typeof message.details === "object" ? message.details : {};
      const after = message.estimatedTokensAfter ?? details.estimatedTokensAfter;
      result.push({
        id: typeof message.id === "string" ? `history-compaction-${message.id}` : uid("history-compaction"),
        kind: "tool",
        title: "compact",
        text: "",
        toolInput: "Context compaction",
        toolOutput: compactionResultSummary(message.tokensBefore, after),
        state: "done",
        runtimeRole: "session-maintenance",
      });
      continue;
    }

    // A compactionSummary message is replacement context for the model, not a
    // historical chat row. Full-history restoration uses top-level compaction
    // entries from get_entries and renders those as normal compact tool blocks.
    if (message.role === "compactionSummary") continue;

    if (message.role === "branchSummary") {
      result.push({
        id: uid("history-summary"),
        kind: "system",
        title: "Branch summary",
        text: String(message.summary ?? ""),
      });
      continue;
    }

    if (message.role === "custom" && message.display) {
      const text = extractVisibleContent(message.content);
      if (text) result.push({ id: uid("history-custom"), kind: "system", title: message.customType ?? "Extension", text });
    }
  }

  return result;
}

function FolderIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6.75A1.75 1.75 0 0 1 4.75 5h4.1l2 2h8.4A1.75 1.75 0 0 1 21 8.75v8.5A1.75 1.75 0 0 1 19.25 19H4.75A1.75 1.75 0 0 1 3 17.25z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.34 5.66" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.34 5.66" /><path d="M20 4v7h-7" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 4.5A3.5 3.5 0 0 0 6 8v.3A3.5 3.5 0 0 0 4.5 15H5a3.5 3.5 0 0 0 4.5 3.35V4.5Z" />
      <path d="M14.5 4.5A3.5 3.5 0 0 1 18 8v.3A3.5 3.5 0 0 1 19.5 15H19a3.5 3.5 0 0 1-4.5 3.35V4.5Z" />
      <path d="M9.5 9H7.75M14.5 9h1.75M9.5 14H7.75M14.5 14h1.75" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 7 4 4-4 4" /><path d="M11 17h8" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.2 2.2-3-3Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={expanded ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

function HoverSwapActivityIcon({
  icon: Icon,
  hoverIcon: HoverIcon,
  spinning = false,
}: {
  icon: typeof Brain;
  hoverIcon: typeof Brain;
  spinning?: boolean;
}) {
  return (
    <span className="activity-icon activity-hover-icon" aria-hidden="true">
      <Icon className={spinning ? "activity-base-icon activity-spinner-icon" : "activity-base-icon"} size={14} />
      <HoverIcon className="activity-expand-icon" size={14} />
    </span>
  );
}


type ComposerProps = {
  commands: CommandInfo[];
  connected: boolean;
  isStreaming: boolean;
  isBashRunning: boolean;
  inputBlocked: boolean;
  beforeSendActions?: ReactNode;
  draftSetterRef: { current: Dispatch<SetStateAction<string>> };
  onSubmitRaw: (value: string, attachments: ManagedAttachment[], deliveryMode: QueueDelivery) => void | boolean | Promise<void | boolean>;
  onAbort: () => void | Promise<void>;
  onAbortBash: () => void | Promise<void>;
};

const Composer = memo(function Composer({
  commands,
  connected,
  isStreaming,
  isBashRunning,
  inputBlocked,
  beforeSendActions,
  draftSetterRef,
  onSubmitRaw,
  onAbort,
  onAbortBash,
}: ComposerProps) {
  const [deliveryMode, setDeliveryMode] = useState<QueueDelivery>(() => {
    try { return window.localStorage.getItem("mf-pi-queue-delivery") === "followUp" ? "followUp" : "steer"; }
    catch { return "steer"; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("mf-pi-queue-delivery", deliveryMode); } catch {}
  }, [deliveryMode]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ManagedAttachment[]>([]);
  const [attachmentPending, setAttachmentPending] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const attachmentCountRef = useRef(0);
  const stagingRef = useRef(false);
  const lastNativeDropRef = useRef<{ paths: string; time: number } | null>(null);
  const attachmentMenuRef = useRef<HTMLDivElement | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const commandMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    draftSetterRef.current = setInput;
    return () => { draftSetterRef.current = () => {}; };
  }, [draftSetterRef]);

  const suggestions = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ")) return [];
    const prefix = input.slice(1).toLowerCase();
    return commands.filter((command) => command.name.toLowerCase().startsWith(prefix));
  }, [commands, input]);

  const groupedSuggestions = useMemo(() => {
    return COMMAND_SOURCE_ORDER
      .map((source) => ({
        source,
        commands: suggestions
          .map((command, index) => ({ command, index }))
          .filter((entry) => entry.command.source === source),
      }))
      .filter((group) => group.commands.length > 0);
  }, [suggestions]);

  useEffect(() => {
    setSuggestionIndex(0);
  }, [input, suggestions.length]);

  useEffect(() => {
    if (!suggestions.length) return;
    requestAnimationFrame(() => {
      const menu = commandMenuRef.current;
      const selected = menu?.querySelector<HTMLElement>(`[data-command-index="${suggestionIndex}"]`);
      if (!menu || !selected) return;
      const menuRect = menu.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      const stickyHeadingClearance = 34;
      if (selectedRect.top < menuRect.top + stickyHeadingClearance) {
        menu.scrollTop -= (menuRect.top + stickyHeadingClearance) - selectedRect.top;
      } else if (selectedRect.bottom > menuRect.bottom) {
        menu.scrollTop += selectedRect.bottom - menuRect.bottom;
      }
    });
  }, [suggestionIndex, suggestions.length]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const computedStyle = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 24;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const paneHeight = textarea.closest<HTMLElement>(".chat-pane")?.clientHeight ?? window.innerHeight;
    const maxHeight = textareaHeightLimit(paneHeight, lineHeight, paddingTop, paddingBottom);

    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;

  }, [input]);

  // A draft that was short on a large window must resize when the window shrinks.
  useEffect(() => {
    const textarea = textareaRef.current;
    const pane = textarea?.closest<HTMLElement>(".chat-pane");
    if (!textarea || !pane) return;
    const sync = () => {
      textarea.style.height = "auto";
      const style = window.getComputedStyle(textarea);
      const max = textareaHeightLimit(pane.clientHeight, Number.parseFloat(style.lineHeight) || 24,
        Number.parseFloat(style.paddingTop) || 0, Number.parseFloat(style.paddingBottom) || 0);
      textarea.style.height = `${Math.min(textarea.scrollHeight, max)}px`;

    };
    const observer = new ResizeObserver(sync);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  // All asynchronous file staging lives in Composer, away from App/TranscriptView.
  const addNativePaths = useCallback(async (paths: string[]) => {
    if (!paths.length || stagingRef.current) return;
    stagingRef.current = true;
    setAttachmentPending(true);
    setAttachmentError(null);
    try {
      for (const sourcePath of paths) {
        if (attachmentCountRef.current >= MAX_ATTACHMENTS_PER_MESSAGE) {
          throw new Error(`Maximum ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`);
        }
        attachmentCountRef.current++;
        try {
          const staged = await invoke<ManagedAttachment>("stage_attachment_path", { sourcePath });
          setAttachments((current) => [...current, staged]);
        } catch (error) {
          attachmentCountRef.current--;
          throw error;
        }
      }
    } catch (error) { setAttachmentError(String(error)); }
    finally { stagingRef.current = false; setAttachmentPending(false); }
  }, []);

  const addBrowserFiles = useCallback(async (files: File[]) => {
    if (!files.length || stagingRef.current) return;
    stagingRef.current = true;
    setAttachmentPending(true);
    setAttachmentError(null);
    try {
      for (const file of files) {
        if (attachmentCountRef.current >= MAX_ATTACHMENTS_PER_MESSAGE) {
          throw new Error(`Maximum ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`);
        }
        if (file.size > MAX_WEBVIEW_ATTACHMENT_BYTES) throw new Error(`${file.name}: 16 MB clipboard/drop size limit`);
        attachmentCountRef.current++;
        try {
          const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
          const staged = await invoke<ManagedAttachment>("stage_attachment_bytes", {
            fileName: file.name || `pasted-image-${Date.now()}.png`, mimeType: file.type, bytes,
          });
          setAttachments((current) => [...current, staged]);
        } catch (error) {
          attachmentCountRef.current--;
          throw error;
        }
      }
    } catch (error) { setAttachmentError(String(error)); }
    finally { stagingRef.current = false; setAttachmentPending(false); }
  }, []);

  const pickAttachments = useCallback(async (imagesOnly: boolean) => {
    setAttachmentMenuOpen(false);
    if (stagingRef.current) return;
    stagingRef.current = true;
    setAttachmentPending(true);
    setAttachmentError(null);
    try {
      const picked = await invoke<ManagedAttachment[]>("pick_attachments", { imagesOnly });
      const free = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - attachmentCountRef.current);
      const kept = picked.slice(0, free);
      attachmentCountRef.current += kept.length;
      setAttachments((current) => [...current, ...kept]);
      for (const unused of picked.slice(free)) {
        void invoke("discard_attachment", { attachmentPath: unused.path });
      }
      if (picked.length > free) setAttachmentError(`Maximum ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`);
    } catch (error) { setAttachmentError(String(error)); }
    finally { stagingRef.current = false; setAttachmentPending(false); }
  }, []);

  const removeAttachment = useCallback((attachment: ManagedAttachment) => {
    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
    attachmentCountRef.current = Math.max(0, attachmentCountRef.current - 1);
    void invoke("discard_attachment", { attachmentPath: attachment.path }).catch((error) => setAttachmentError(String(error)));
  }, []);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    // Native OS drag/drop does not always generate DOM drop events in a Tauri webview.
    void getCurrentWebview().onDragDropEvent((event) => {
      if (disposed || event.payload.type !== "drop") return;
      // Some Tauri/WebView2 builds emit the same OS drop twice with different
      // event IDs. Dedupe identical paths briefly, without suppressing later drops.
      const paths = JSON.stringify(event.payload.paths);
      const time = Date.now();
      if (lastNativeDropRef.current?.paths === paths && time - lastNativeDropRef.current.time < 1500) return;
      lastNativeDropRef.current = { paths, time };
      void addNativePaths(event.payload.paths);
    }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; })
      .catch((error) => console.warn("Native attachment drag/drop unavailable", error));
    return () => { disposed = true; stop?.(); };
  }, [addNativePaths]);

  useEffect(() => {
    if (!attachmentMenuOpen) return;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setAttachmentMenuOpen(false);
    };
    document.addEventListener("keydown", onEscape);
    const dismiss = (event: PointerEvent) => {
      if (!attachmentMenuRef.current?.contains(event.target as Node)) setAttachmentMenuOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", onEscape); };
  }, [attachmentMenuOpen]);

  const send = useCallback((rawValue: string) => {
    if (!connected || isBashRunning || inputBlocked || attachmentPending || (!rawValue.trim() && !attachments.length)) return;
    const submitted = [...attachments];
    setInput("");
    setAttachments([]);
    attachmentCountRef.current = 0;
    setSuggestionIndex(0);
    setAttachmentError(null);
    void Promise.resolve(onSubmitRaw(rawValue, submitted, deliveryMode)).then((accepted) => {
      if (accepted === false) {
        // A rejected Pi prompt must not silently lose the staged image/files.
        setInput((current) => current ? `${rawValue}\n${current}` : rawValue);
        setAttachments((current) => [...submitted, ...current]);
        attachmentCountRef.current += submitted.length;
        setAttachmentError("Message was not accepted by Pi. Attachments restored.");
      }
    }).catch((error) => {
      setInput((current) => current ? `${rawValue}\n${current}` : rawValue);
      setAttachments((current) => [...submitted, ...current]);
      attachmentCountRef.current += submitted.length;
      setAttachmentError(String(error));
    });
  }, [attachments, attachmentPending, connected, inputBlocked, isBashRunning, onSubmitRaw, deliveryMode]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    send(input);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && (isBashRunning || inputBlocked)) {
      event.preventDefault();
      return;
    }

    if (isStreaming && input.trim() === "/abort" && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      setInput("");
      setSuggestionIndex(0);
      void onAbort();
      return;
    }

    if (suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSuggestionIndex((current) => (current + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const selected = suggestions[Math.min(suggestionIndex, suggestions.length - 1)];
        if (selected) send(`/${selected.name}`);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <>
      {suggestions.length > 0 && (
        <div className="command-menu" ref={commandMenuRef}>
          {groupedSuggestions.map((group) => (
            <section className="command-menu-group" key={group.source}>
              <div className="command-menu-heading">{commandSourceLabel(group.source)}</div>
              {group.commands.map(({ command, index }) => (
                <button
                  key={`${command.source}:${command.name}`}
                  data-command-index={index}
                  className={index === suggestionIndex ? "selected" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => send(`/${command.name}`)}
                >
                  <code>/{command.name}</code>
                  <span>{command.description ?? command.source}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
      <form
        className={`composer ${input.trimStart().startsWith("!") ? "composer-bash-mode" : ""}`.trim()}
        onSubmit={submit}
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length) {
            event.preventDefault();
            void addBrowserFiles(Array.from(event.dataTransfer.files));
          }
        }}
      >
        {(attachments.length > 0 || attachmentPending) && (
          <div className="composer-attachments" aria-label="Attachments">
            {attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} onRemove={() => removeAttachment(attachment)} />)}
            {attachmentPending && <div className="attachment-loading"><Loader2 size={16} className="spin" /> Adding…</div>}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) {
              event.preventDefault();
              void addBrowserFiles(files);
            }
          }}
          placeholder="Message Pi or type /command…"
          rows={1}
          autoFocus
        />
        <div className="composer-actions">
          <div className="composer-left-actions">
            <div className="attachment-menu-root" ref={attachmentMenuRef}>
              <button type="button" className="attachment-add-button" aria-label="Add attachment" title="Add attachment" aria-expanded={attachmentMenuOpen} disabled={attachmentPending} onClick={() => setAttachmentMenuOpen((open) => !open)}><Plus size={19} /></button>
              {attachmentMenuOpen && (
                <div className="attachment-menu">
                  <button type="button" onClick={() => void pickAttachments(true)}><ImageIcon size={17} /> Add image</button>
                  <button type="button" onClick={() => void pickAttachments(false)}><Paperclip size={17} /> Upload file</button>
                </div>
              )}
            </div>
            {attachmentError && <span className="attachment-error" title={attachmentError}>{attachmentError}</span>}
          </div>
          <div className="composer-right-actions">
            <QueueModeSelect value={deliveryMode} onChange={setDeliveryMode} />
            {beforeSendActions}
            {isStreaming && !isBashRunning && (
              <button className="primary send-button" type="submit"
                disabled={(!input.trim() && !attachments.length) || inputBlocked || attachmentPending}
                title={deliveryMode === "steer" ? "Queue steering message" : "Queue follow-up message"}
                aria-label={deliveryMode === "steer" ? "Queue steering message" : "Queue follow-up message"}>
                <ArrowUp size={20} strokeWidth={2.2} />
              </button>
            )}
            {isStreaming || isBashRunning ? (
              <button
                className="primary send-button stop-generation-button"
                type="button"
                onClick={() => void (isBashRunning ? onAbortBash() : onAbort())}
                title={isBashRunning ? "Stop shell command" : "Stop generation"}
                aria-label={isBashRunning ? "Stop shell command" : "Stop generation"}
              >
                <Square size={15} strokeWidth={2.2} fill="currentColor" />
              </button>
            ) : (
              <button className="primary send-button" type="submit" disabled={(!input.trim() && !attachments.length) || !connected || inputBlocked || attachmentPending} title="Send message" aria-label="Send message">
                <ArrowUp size={20} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
      </form>
    </>
  );
});

function MoltenForgeGenerationSpinner() {
  return (
    <span className="generating-radix-spinner" role="status" aria-label="Loading">
      {Array.from({ length: 8 }, (_, index) => (
        <span
          key={index}
          className="generating-radix-spinner-leaf"
          style={{ "--spinner-index": index, opacity: 0.28 + index * 0.09 } as CSSProperties}
        />
      ))}
    </span>
  );
}


export default function App() {
  const [cwd, setCwd] = useState(getStoredWorkingDirectory);
  const [recentProjects, setRecentProjects] = useState(getInitialRecentProjects);
  const [discoveredProjects, setDiscoveredProjects] = useState<ProjectSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState(false);
  const projectSwitchInFlightRef = useRef(false);
  const lastProjectSessionsRef = useRef<Record<string, string>>((() => {
    try { return readLastProjectSessions(window.localStorage); } catch { return {}; }
  })());
  const [piVersion, setPiVersion] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [switchingFolder, setSwitchingFolder] = useState(false);
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [frozenTranscriptItems, setFrozenTranscriptItems] = useState<TranscriptItem[] | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);
  const [visualFlushSettling, setVisualFlushSettling] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [models, setModels] = useState<PiModel[]>([]);
  const [currentModel, setCurrentModel] = useState<PiModel | null>(null);
  const [currentThinking, setCurrentThinking] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionPath, setActiveSessionPath] = useState<string | null>(null);
  const [activeSessionName, setActiveSessionName] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isBashRunning, setIsBashRunning] = useState(false);
  const [inputBlocked, setInputBlocked] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  const [extensionDialog, setExtensionDialog] = useState<ExtensionDialog | null>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [extensionWidgets, setExtensionWidgets] = useState<Record<string, ExtensionWidget>>({});
  const [extensionNotice, setExtensionNotice] = useState<ExtensionNotice | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [missingProjectPath, setMissingProjectPath] = useState<string | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  const [postCompactionContextEstimate, setPostCompactionContextEstimate] = useState<number | null>(null);
  const [contextBreakdown, setContextBreakdown] = useState<ContextBreakdown | null>(null);
  const [chatWidth, setChatWidth] = useState(getInitialChatWidth);
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) !== "true";
    } catch {
      return true;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [appFontFamily, setAppFontFamily] = useState<AppFontFamily>(getInitialAppFontFamily);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => getInitialAppearanceSettings().theme);
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark);
  const [backgroundImagesEnabled, setBackgroundImagesEnabled] = useState(() => getInitialAppearanceSettings().backgroundImagesEnabled);
  const [wallpaperOverlayPercent, setWallpaperOverlayPercent] = useState(getInitialWallpaperOverlayPercent);
  const [customBackgrounds, setCustomBackgrounds] = useState<CustomBackgroundViews>({});
  const [backgroundPickerTheme, setBackgroundPickerTheme] = useState<BackgroundTheme | null>(null);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [backgroundsHydrated, setBackgroundsHydrated] = useState(false);
  const [appInitializing, setAppInitializing] = useState(true);
  const [loadingVisualReadyUrl, setLoadingVisualReadyUrl] = useState<string | null | undefined>(undefined);
  const [autoExpandThinking, setAutoExpandThinking] = useState(() => getStoredBoolean(AUTO_EXPAND_THINKING_STORAGE_KEY, true));
  const [autoExpandTools, setAutoExpandTools] = useState(() => getStoredBoolean(AUTO_EXPAND_TOOLS_STORAGE_KEY, true));
  const [timelineMode, setTimelineMode] = useState<TimelineMode>(() => {
    try { return readTimelineMode(window.localStorage, TIMELINE_MODE_STORAGE_KEY); } catch { return "compact"; }
  });
  const [notifyWhenBackground, setNotifyWhenBackground] = useState(() => getStoredBoolean(BACKGROUND_COMPLETION_NOTIFICATION_KEY, false));
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const backgroundRunStartedRef = useRef(false);
  const [chatResizeMarker, setChatResizeMarker] = useState({ y: 120, visible: false });
  const [sidebarResizeMarker, setSidebarResizeMarker] = useState({ y: 120, visible: false });
  const rememberProject = useCallback((workingDirectory: string) => {
    setRecentProjects((current) => {
      const next = rememberRecentProject(current, workingDirectory);
      try { writeRecentProjects(window.localStorage, next); } catch {}
      return next;
    });
  }, []);

  const saveProjectSelection = useCallback((directory: string, session: string | null) => {
    if (!directory || !session) return;
    const next = rememberLastProjectSession(lastProjectSessionsRef.current, directory, session);
    lastProjectSessionsRef.current = next;
    try { writeLastProjectSessions(window.localStorage, next); } catch {}
  }, []);

  useEffect(() => {
    if (connected && !switchingFolder && activeSessionPath) saveProjectSelection(cwd, activeSessionPath);
  }, [connected, switchingFolder, cwd, activeSessionPath, saveProjectSelection]);

  const discoverProjects = useCallback(async () => {
    try {
      const summaries = await invoke<ProjectSummary[]>("list_projects");
      setDiscoveredProjects(summaries);
    } catch (error) {
      console.warn("Could not discover Pi project history", error);
    }
  }, []);
  useEffect(() => { void discoverProjects(); }, [discoverProjects]);

  const assistantId = useRef<string | null>(null);
  const thinkingId = useRef<string | null>(null);
  const toolCallByContentIndex = useRef(new Map<number, string>());
  const toolArgsById = useRef(new Map<string, { toolName: string; args: unknown }>());
  const activeToolBatchId = useRef<string | null>(null);
  const lastCwd = useRef("");
  const copyRequestIds = useRef(new Set<string>());
  const silentRequestIds = useRef(new Set<string>());
  const historyRequestIds = useRef(new Set<string>());
  const pendingRpcResponses = useRef(new Map<string, PendingRpcResponse>());
  const liveStatsRequestIds = useRef(new Set<string>());
  const liveStatsRefreshTimerRef = useRef<number | null>(null);
  const liveStatsRefreshInFlightRef = useRef(false);
  const liveStatsRefreshQueuedRef = useRef(false);
  const liveStatsRefreshLastAtRef = useRef(0);
  const interruptInFlightRef = useRef<Promise<boolean> | null>(null);
  const interruptCompactionAbortReassertedRef = useRef(false);
  const handleRecordRef = useRef<(record: Json) => void>(() => {});
  const recentPiStderrRef = useRef<string[]>([]);
  const activePiPidRef = useRef<number | null>(null);
  const pendingSessionSwitch = useRef(new Map<string, string>());
  const pendingThinkingSet = useRef(new Map<string, string>());
  const managedSessionMutationIds = useRef(new Set<string>());
  const [piQueue, setPiQueue] = useState<PiQueue>({ steering: [], followUp: [] });
  const directBashCommands = useRef(new Map<string, string>());
  const directBashRunningRef = useRef(false);
  const inputBlockCountRef = useRef(0);
  const activeRetryId = useRef<string | null>(null);
  const retryNoticeIdsRef = useRef(new Set<string>());
  const pendingAssistantErrorRef = useRef<string | null>(null);
  const providerAbortPendingRef = useRef(false);
  const activeSummarizationRetryId = useRef<string | null>(null);
  const activeCompactionId = useRef<string | null>(null);
  const pendingManualCompactionInstructions = useRef<string | null>(null);
  const compactionBeforeTokensRef = useRef<number | null>(null);
  const authoritativeContextTokensRef = useRef<number | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const transcriptContentRef = useRef<HTMLDivElement | null>(null);
  const composerDraftSetterRef = useRef<Dispatch<SetStateAction<string>>>(() => {});
  const userMessageDeliveryRef = useRef(createPiUserMessageDelivery());
  const composerWrapRef = useRef<HTMLElement | null>(null);
  const chatPaneRef = useRef<HTMLElement | null>(null);
  const sessionSidebarRef = useRef<HTMLElement | null>(null);
  const activeChatResizeSideRef = useRef<"left" | "right" | null>(null);
  const sidebarResizingRef = useRef(false);
  const shouldAutoScroll = useRef(true);
  const isStreamingRef = useRef(isStreaming);
  const itemsRef = useRef(items);
  const committedVisibleTranscriptItemsRef = useRef(items);
  const frozenTranscriptItemsRef = useRef<TranscriptItem[] | null>(null);
  const lastTranscriptScrollTopRef = useRef(0);
  const manualScrollInputUntilRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);
  const stickyScrollFrameRef = useRef<number | null>(null);
  const stickyScrollForceRef = useRef(false);
  const stickyScrollSettleFramesRef = useRef(0);
  const transcriptScrollFrameRef = useRef<number | null>(null);
  const readerScrollRestoreFrameRef = useRef<number | null>(null);
  const readerScrollReleaseTimerRef = useRef<number | null>(null);
  const readerScrollLockRef = useRef<{
    messageId: string;
    elementPath: number[];
    viewportOffset: number;
  } | null>(null);
  const preferredModelRef = useRef(getStoredPreferredModel());
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundPickerThemeRef = useRef<BackgroundTheme | null>(null);
  const backgroundObjectUrlsRef = useRef<Partial<Record<BackgroundTheme, string>>>({});

  const resolvedTheme = resolveThemePreference(themePreference, systemPrefersDark);
  isStreamingRef.current = isStreaming;
  itemsRef.current = items;
  frozenTranscriptItemsRef.current = frozenTranscriptItems;

  const setAutoScrollMode = useCallback((enabled: boolean) => {
    shouldAutoScroll.current = enabled;
    setAutoScrollEnabled((current) => current === enabled ? current : enabled);
  }, []);

  const visibleTranscriptItems = frozenTranscriptItems ?? items;

  useLayoutEffect(() => {
    // Freeze from the last committed visual tree, not from authoritative state
    // that may already contain a Pi delta React has not painted yet.
    committedVisibleTranscriptItemsRef.current = visibleTranscriptItems;
  }, [visibleTranscriptItems]);

  const setStreamingState = useCallback((value: boolean) => {
    isStreamingRef.current = value;
    setIsStreaming(value);
  }, []);

  const setBashRunningState = useCallback((value: boolean) => {
    directBashRunningRef.current = value;
    setIsBashRunning(value);
  }, []);

  const beginInputBlock = useCallback(() => {
    inputBlockCountRef.current += 1;
    setInputBlocked(true);
  }, []);

  const endInputBlock = useCallback(() => {
    inputBlockCountRef.current = Math.max(0, inputBlockCountRef.current - 1);
    if (inputBlockCountRef.current === 0) setInputBlocked(false);
  }, []);

  const resetTransientRuntime = useCallback(() => {
    assistantId.current = null;
    thinkingId.current = null;
    toolCallByContentIndex.current.clear();
    toolArgsById.current.clear();
    activeToolBatchId.current = null;
    activeRetryId.current = null;
    retryNoticeIdsRef.current.clear();
    pendingAssistantErrorRef.current = null;
    providerAbortPendingRef.current = false;
    activeSummarizationRetryId.current = null;
    activeCompactionId.current = null;
    pendingManualCompactionInstructions.current = null;
    userMessageDeliveryRef.current.reset();
  }, []);

  // Keep the stdio/event subscription stable while dispatching each Pi record
  // through the latest render's state and callbacks.
  handleRecordRef.current = handleRecord;

  useEffect(() => {
    const input = backgroundInputRef.current;
    if (!input) return;

    const handleCancel = () => {
      backgroundPickerThemeRef.current = null;
      setBackgroundPickerTheme(null);
    };

    input.addEventListener("cancel", handleCancel);
    return () => input.removeEventListener("cancel", handleCancel);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemPrefersDark(media.matches);
    onChange();
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
    try { writeThemePreference(window.localStorage, themePreference); } catch {}
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    try { writeBackgroundImagesEnabled(window.localStorage, backgroundImagesEnabled); } catch {}
  }, [backgroundImagesEnabled]);
  useEffect(() => {
    try { window.localStorage.setItem(WALLPAPER_OVERLAY_STORAGE_KEY, String(wallpaperOverlayPercent)); } catch {}
  }, [wallpaperOverlayPercent]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all((["light", "dark"] as const).map(async (theme) => [theme, await loadStoredBackground(theme)] as const))
      .then((records) => {
        if (cancelled) return;
        const next: CustomBackgroundViews = {};
        const nextUrls: Partial<Record<BackgroundTheme, string>> = {};
        for (const [theme, record] of records) {
          if (!record) continue;
          const url = URL.createObjectURL(record.blob);
          next[theme] = { name: record.name, url };
          nextUrls[theme] = url;
        }
        for (const theme of ["light", "dark"] as const) { const url = backgroundObjectUrlsRef.current[theme]; if (url) URL.revokeObjectURL(url); }
        backgroundObjectUrlsRef.current = nextUrls;
        setCustomBackgrounds(next);
        setBackgroundsHydrated(true);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("Could not load custom backgrounds", error);
          setBackgroundsHydrated(true);
        }
      });
    return () => {
      cancelled = true;
      for (const theme of ["light", "dark"] as const) { const url = backgroundObjectUrlsRef.current[theme]; if (url) URL.revokeObjectURL(url); }
      backgroundObjectUrlsRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!extensionNotice) return;
    const timeout = window.setTimeout(() => setExtensionNotice((current) => current?.id === extensionNotice.id ? null : current), 4500);
    return () => window.clearTimeout(timeout);
  }, [extensionNotice]);

  const applyStoredBackground = useCallback((theme: BackgroundTheme, record: StoredBackgroundImage | null) => {
    const previous = backgroundObjectUrlsRef.current[theme];
    if (previous) URL.revokeObjectURL(previous);

    if (!record) {
      delete backgroundObjectUrlsRef.current[theme];
      setCustomBackgrounds((current) => {
        const next = { ...current };
        delete next[theme];
        return next;
      });
      return;
    }

    const url = URL.createObjectURL(record.blob);
    backgroundObjectUrlsRef.current[theme] = url;
    setCustomBackgrounds((current) => ({ ...current, [theme]: { name: record.name, url } }));
  }, []);

  const chooseBackgroundImage = useCallback((theme: BackgroundTheme) => {
    setBackgroundError(null);
    backgroundPickerThemeRef.current = theme;
    setBackgroundPickerTheme(theme);
    backgroundInputRef.current?.click();
  }, []);

  const handleBackgroundFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const theme = backgroundPickerThemeRef.current;
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!theme) return;
    if (!file) {
      backgroundPickerThemeRef.current = null;
      setBackgroundPickerTheme(null);
      return;
    }
    if (!isSupportedBackgroundImage(file)) {
      setBackgroundError("Choose a JPEG, PNG, WebP, or AVIF image.");
      backgroundPickerThemeRef.current = null;
      setBackgroundPickerTheme(null);
      return;
    }
    try {
      const record = await saveStoredBackground(theme, file);
      applyStoredBackground(theme, record);
      setBackgroundError(null);
    } catch (error) {
      setBackgroundError(`Could not save background image: ${String(error)}`);
    } finally {
      backgroundPickerThemeRef.current = null;
      setBackgroundPickerTheme(null);
    }
  }, [applyStoredBackground]);

  const clearBackgroundImage = useCallback(async (theme: BackgroundTheme) => {
    setBackgroundError(null);
    try {
      await clearStoredBackground(theme);
      applyStoredBackground(theme, null);
    } catch (error) {
      setBackgroundError(`Could not clear background image: ${String(error)}`);
    }
  }, [applyStoredBackground]);

  const cancelAutoFollowMotion = useCallback(() => {
    stickyScrollForceRef.current = false;
    stickyScrollSettleFramesRef.current = 0;
    if (stickyScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(stickyScrollFrameRef.current);
      stickyScrollFrameRef.current = null;
    }
  }, []);

  const markManualScrollInput = useCallback((durationMs = MANUAL_SCROLL_INPUT_MS) => {
    manualScrollInputUntilRef.current = Date.now() + durationMs;
  }, []);

  const markProgrammaticScroll = useCallback((durationMs = PROGRAMMATIC_SCROLL_GUARD_MS) => {
    programmaticScrollUntilRef.current = Date.now() + durationMs;
  }, []);

  const getElementPathWithinMessage = useCallback((root: HTMLElement, element: HTMLElement) => {
    const path: number[] = [];
    let current: HTMLElement | null = element;

    while (current && current !== root) {
      const parent: HTMLElement | null = current.parentElement;
      if (!parent) return null;
      const index = Array.prototype.indexOf.call(parent.children, current);
      if (index < 0) return null;
      path.unshift(index);
      current = parent;
    }

    return current === root ? path : null;
  }, []);

  const getElementByPath = useCallback((root: HTMLElement, path: number[]) => {
    let current: Element = root;
    for (const index of path) {
      const child = current.children.item(index);
      if (!(child instanceof HTMLElement)) return null;
      current = child;
    }
    return current instanceof HTMLElement ? current : null;
  }, []);

  const captureReaderScrollAnchor = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return null;

    const scrollRect = transcript.getBoundingClientRect();
    const anchorY = scrollRect.top + 8;
    const messageElements = transcript.querySelectorAll<HTMLElement>("[data-message-id]");
    let anchorMessage: HTMLElement | null = null;
    let nearestMessage: HTMLElement | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const messageElement of messageElements) {
      const rect = messageElement.getBoundingClientRect();
      if (rect.height <= 0 || rect.bottom <= scrollRect.top || rect.top >= scrollRect.bottom) continue;
      if (rect.top <= anchorY && rect.bottom >= anchorY) {
        anchorMessage = messageElement;
        break;
      }
      const distance = Math.abs(rect.top - anchorY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestMessage = messageElement;
      }
    }

    anchorMessage = anchorMessage ?? nearestMessage;
    const messageId = anchorMessage?.getAttribute("data-message-id");
    if (!anchorMessage || !messageId) return null;

    const candidates = [
      anchorMessage,
      ...anchorMessage.querySelectorAll<HTMLElement>(
        [
          ".virtual-markdown-block",
          ".chat-code-block",
          ".chat-code-viewer",
          "blockquote",
          "details",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "li",
          "ol",
          "p",
          "pre",
          "table",
          "ul",
        ].join(","),
      ),
    ];

    let anchorElement: HTMLElement = anchorMessage;
    let containingCandidate: HTMLElement | null = null;
    let nearestCandidate: HTMLElement | null = null;
    let nearestCandidateDistance = Number.POSITIVE_INFINITY;
    let containingDepth = -1;

    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      if (rect.height <= 0 || rect.bottom <= scrollRect.top || rect.top >= scrollRect.bottom) continue;
      if (rect.top <= anchorY && rect.bottom >= anchorY) {
        let depth = 0;
        let current: HTMLElement | null = candidate;
        while (current && current !== anchorMessage) {
          depth += 1;
          current = current.parentElement;
        }
        if (current !== anchorMessage) continue;
        if (depth > containingDepth) {
          containingDepth = depth;
          containingCandidate = candidate;
        }
        continue;
      }
      const distance = Math.abs(rect.top - anchorY);
      if (distance < nearestCandidateDistance) {
        nearestCandidateDistance = distance;
        nearestCandidate = candidate;
      }
    }

    anchorElement = containingCandidate ?? nearestCandidate ?? anchorMessage;
    const elementPath = getElementPathWithinMessage(anchorMessage, anchorElement);
    if (!elementPath) return null;

    return {
      messageId,
      elementPath,
      viewportOffset: anchorElement.getBoundingClientRect().top - scrollRect.top,
    };
  }, [getElementPathWithinMessage]);

  const clearReaderScrollLock = useCallback(() => {
    readerScrollLockRef.current = null;
    setVisualFlushSettling(false);
    if (readerScrollRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(readerScrollRestoreFrameRef.current);
      readerScrollRestoreFrameRef.current = null;
    }
    if (readerScrollReleaseTimerRef.current !== null) {
      window.clearTimeout(readerScrollReleaseTimerRef.current);
      readerScrollReleaseTimerRef.current = null;
    }
  }, []);

  const restoreReaderScrollLockPosition = useCallback(() => {
    const transcript = transcriptRef.current;
    const lock = readerScrollLockRef.current;
    if (!transcript || !lock) return false;

    const escapedMessageId = typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(lock.messageId)
      : lock.messageId.replace(/["\\]/g, "\\$&");
    const messageElement = transcript.querySelector<HTMLElement>(
      `[data-message-id="${escapedMessageId}"]`,
    );
    const anchorElement = messageElement
      ? (getElementByPath(messageElement, lock.elementPath) ?? messageElement)
      : null;
    if (!anchorElement) return false;

    const scrollRect = transcript.getBoundingClientRect();
    const nextScrollTop = readerScrollTopForAnchor({
      scrollTop: transcript.scrollTop,
      maxScrollTop: transcript.scrollHeight - transcript.clientHeight,
      currentViewportOffset: anchorElement.getBoundingClientRect().top - scrollRect.top,
      desiredViewportOffset: lock.viewportOffset,
    });
    if (Math.abs(nextScrollTop - transcript.scrollTop) <= 0.01) return true;

    markProgrammaticScroll(80);
    transcript.scrollTop = nextScrollTop;
    lastTranscriptScrollTopRef.current = transcript.scrollTop;
    return true;
  }, [getElementByPath, markProgrammaticScroll]);

  const scheduleReaderScrollLockRestore = useCallback(() => {
    if (!readerScrollLockRef.current || readerScrollRestoreFrameRef.current !== null) return;
    readerScrollRestoreFrameRef.current = window.requestAnimationFrame(() => {
      readerScrollRestoreFrameRef.current = null;
      restoreReaderScrollLockPosition();
    });
  }, [restoreReaderScrollLockPosition]);

  const holdReaderAnchorThroughLayoutChange = useCallback((settleMs = 180) => {
    readerScrollLockRef.current = captureReaderScrollAnchor();
    if (!readerScrollLockRef.current) return;
    setVisualFlushSettling(true);

    if (readerScrollReleaseTimerRef.current !== null) {
      window.clearTimeout(readerScrollReleaseTimerRef.current);
    }
    readerScrollReleaseTimerRef.current = window.setTimeout(() => {
      restoreReaderScrollLockPosition();
      clearReaderScrollLock();
    }, settleMs);
  }, [captureReaderScrollAnchor, clearReaderScrollLock, restoreReaderScrollLockPosition]);

  const holdReaderAnchorThroughFinalFlush = useCallback(() => {
    holdReaderAnchorThroughLayoutChange(320);
  }, [holdReaderAnchorThroughLayoutChange]);

  const freezeTranscriptVisuals = useCallback(() => {
    if (!isStreamingRef.current || frozenTranscriptItemsRef.current) return;
    const snapshot = committedVisibleTranscriptItemsRef.current;
    frozenTranscriptItemsRef.current = snapshot;
    setFrozenTranscriptItems(snapshot);
  }, []);

  const disableAutoFollow = useCallback((freezeVisuals = true) => {
    clearReaderScrollLock();
    if (!shouldAutoScroll.current && (!freezeVisuals || frozenTranscriptItemsRef.current)) return;
    setAutoScrollMode(false);
    cancelAutoFollowMotion();
    if (freezeVisuals) freezeTranscriptVisuals();
  }, [cancelAutoFollowMotion, clearReaderScrollLock, freezeTranscriptVisuals, setAutoScrollMode]);

  const scheduleScrollToBottom = useCallback((force = false, settleFrames?: number) => {
    if (readerScrollLockRef.current) return;
    if (!force && !shouldAutoScroll.current) return;

    stickyScrollForceRef.current = stickyScrollForceRef.current || force;
    stickyScrollSettleFramesRef.current = Math.max(
      stickyScrollSettleFramesRef.current,
      Math.max(1, settleFrames ?? (force ? FORCED_SCROLL_SETTLE_FRAMES : STICKY_SCROLL_SETTLE_FRAMES)),
    );

    if (stickyScrollFrameRef.current !== null) return;

    const runFrame = () => {
      stickyScrollFrameRef.current = null;
      const transcript = transcriptRef.current;
      const shouldForce = stickyScrollForceRef.current;
      if (!transcript || readerScrollLockRef.current || (!shouldForce && !shouldAutoScroll.current)) {
        stickyScrollForceRef.current = false;
        stickyScrollSettleFramesRef.current = 0;
        return;
      }

      const target = stickyScrollTarget({
        scrollHeight: transcript.scrollHeight,
        scrollTop: transcript.scrollTop,
        clientHeight: transcript.clientHeight,
      });

      if (shouldForce) {
        if (target > transcript.scrollTop) {
          markProgrammaticScroll(500);
          transcript.scrollTop = target;
          lastTranscriptScrollTopRef.current = transcript.scrollTop;
        }
        stickyScrollSettleFramesRef.current = Math.max(0, stickyScrollSettleFramesRef.current - 1);
        if (stickyScrollSettleFramesRef.current > 0) {
          stickyScrollFrameRef.current = window.requestAnimationFrame(runFrame);
        } else {
          stickyScrollForceRef.current = false;
        }
        return;
      }

      const reachedBefore = stickyScrollReachedTarget(transcript.scrollTop, target);
      const next = nextStickyScrollTop(transcript.scrollTop, target);

      if (next > transcript.scrollTop) {
        markProgrammaticScroll();
        transcript.scrollTop = next;
        lastTranscriptScrollTopRef.current = transcript.scrollTop;
      }

      if (reachedBefore || stickyScrollReachedTarget(transcript.scrollTop, target)) {
        if (target > transcript.scrollTop) {
          markProgrammaticScroll();
          transcript.scrollTop = target;
          lastTranscriptScrollTopRef.current = transcript.scrollTop;
        }
        stickyScrollSettleFramesRef.current = Math.max(0, stickyScrollSettleFramesRef.current - 1);
      } else {
        stickyScrollSettleFramesRef.current = Math.max(
          stickyScrollSettleFramesRef.current,
          STICKY_SCROLL_SETTLE_FRAMES,
        );
      }

      if (stickyScrollSettleFramesRef.current > 0 && shouldAutoScroll.current && !readerScrollLockRef.current) {
        stickyScrollFrameRef.current = window.requestAnimationFrame(runFrame);
      }
    };

    stickyScrollFrameRef.current = window.requestAnimationFrame(runFrame);
  }, [markProgrammaticScroll]);

  const resumeAutoFollow = useCallback(() => {
    clearReaderScrollLock();
    frozenTranscriptItemsRef.current = null;
    setFrozenTranscriptItems(null);
    setAutoScrollMode(true);
    setShowScrollToBottomButton(false);
    window.requestAnimationFrame(() => scheduleScrollToBottom(false));
  }, [clearReaderScrollLock, scheduleScrollToBottom, setAutoScrollMode]);

  const flushFrozenTranscriptAtSettle = useCallback(() => {
    if (!frozenTranscriptItemsRef.current) return;

    if (!shouldAutoScroll.current) {
      holdReaderAnchorThroughFinalFlush();
    }
    frozenTranscriptItemsRef.current = null;
    setFrozenTranscriptItems(null);
  }, [holdReaderAnchorThroughFinalFlush]);

  const armExplicitBottomFollow = useCallback(() => {
    frozenTranscriptItemsRef.current = null;
    setFrozenTranscriptItems(null);
    clearReaderScrollLock();
    setAutoScrollMode(true);
    setShowScrollToBottomButton(false);
    scheduleScrollToBottom(true);
  }, [clearReaderScrollLock, scheduleScrollToBottom, setAutoScrollMode]);

  const syncScrollToBottomAffordance = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      setShowScrollToBottomButton(false);
      return;
    }

    const distanceFromBottom = chatDistanceFromBottom({
      scrollHeight: transcript.scrollHeight,
      scrollTop: transcript.scrollTop,
      clientHeight: transcript.clientHeight,
    });
    const nextVisible = shouldShowScrollToBottomButton(distanceFromBottom);
    setShowScrollToBottomButton((current) => (
      current === nextVisible ? current : nextVisible
    ));
  }, []);

  const jumpToChatBottom = useCallback(() => {
    frozenTranscriptItemsRef.current = null;
    setFrozenTranscriptItems(null);
    clearReaderScrollLock();
    cancelAutoFollowMotion();
    setAutoScrollMode(true);
    setShowScrollToBottomButton(false);

    const transcript = transcriptRef.current;
    if (transcript) {
      const target = stickyScrollTarget({
        scrollHeight: transcript.scrollHeight,
        scrollTop: transcript.scrollTop,
        clientHeight: transcript.clientHeight,
      });
      markProgrammaticScroll(500);
      transcript.scrollTop = target;
      lastTranscriptScrollTopRef.current = transcript.scrollTop;
    }

    // Re-run after frozen streaming content and late virtualizer/Markdown
    // measurements are released so the explicit jump always lands at the real
    // current bottom.
    scheduleScrollToBottom(true, FORCED_SCROLL_SETTLE_FRAMES);
  }, [
    cancelAutoFollowMotion,
    clearReaderScrollLock,
    markProgrammaticScroll,
    scheduleScrollToBottom,
    setAutoScrollMode,
  ]);

  const preserveChatViewportThroughSettingsChange = useCallback((mutate: () => void) => {
    if (shouldAutoScroll.current) {
      mutate();
      window.requestAnimationFrame(() => {
        scheduleScrollToBottom(true, FORCED_SCROLL_SETTLE_FRAMES);
      });
      return;
    }

    holdReaderAnchorThroughLayoutChange(420);
    mutate();
  }, [holdReaderAnchorThroughLayoutChange, scheduleScrollToBottom]);

  const updateItems = useCallback((updater: (current: TranscriptItem[]) => TranscriptItem[]) => {
    setItems((current) => {
      const next = updater(current);
      itemsRef.current = next;
      return next;
    });
  }, []);

  const append = useCallback((item: Omit<TranscriptItem, "id"> & { id?: string }) => {
    const id = item.id ?? uid(item.kind);
    updateItems((current) => [...current, { ...item, id }]);
    return id;
  }, [updateItems]);

  const patchItem = useCallback((id: string, patch: Partial<TranscriptItem> | ((item: TranscriptItem) => Partial<TranscriptItem>)) => {
    updateItems((current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index === -1) return current;
      const existing = current[index];
      const next = current.slice();
      next[index] = { ...existing, ...(typeof patch === "function" ? patch(existing) : patch) };
      return next;
    });
  }, [updateItems]);

  const dismissRetryNotices = useCallback(() => {
    const ids = retryNoticeIdsRef.current;
    if (ids.size === 0) return;
    const removed = new Set(ids);
    ids.clear();
    updateItems((current) => current.filter((item) => !removed.has(item.id)));
    activeRetryId.current = null;
  }, [updateItems]);

  const markRunningRuntimeInterrupted = useCallback(() => {
    updateItems((current) => interruptRunningRuntimeItems(current));
    thinkingId.current = null;
  }, [updateItems]);

  const surfacePendingAssistantError = useCallback((options: {
    retryActivityActive: boolean;
    interruptInFlight: boolean;
  }) => {
    const errorMessage = pendingAssistantErrorRef.current;
    if (!errorMessage || !shouldSurfacePendingAssistantError(options)) return false;

    pendingAssistantErrorRef.current = null;
    append({ kind: "error", title: "Error", text: errorMessage });
    scheduleScrollToBottom();
    return true;
  }, [append, scheduleScrollToBottom]);

  const sendRecord = useCallback(async (record: Json, options?: { silent?: boolean; history?: boolean }) => {
    const withId = record.id ? record : { ...record, id: `mf-${crypto.randomUUID()}` };
    const id = withId.id as string;
    if (options?.silent) silentRequestIds.current.add(id);
    if (options?.history) historyRequestIds.current.add(id);
    try {
      await invoke("send_rpc", { record: JSON.stringify(withId) });
      return id;
    } catch (error) {
      silentRequestIds.current.delete(id);
      historyRequestIds.current.delete(id);
      throw error;
    }
  }, []);

  const rejectPendingRpcResponses = useCallback((reason: string) => {
    const error = new Error(reason);
    for (const [id, pending] of pendingRpcResponses.current) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(error);
      silentRequestIds.current.delete(id);
      historyRequestIds.current.delete(id);
    }
    pendingRpcResponses.current.clear();
  }, []);

  const sendRecordAndWait = useCallback((
    record: Json,
    options?: { silent?: boolean; history?: boolean },
    timeoutMs = INTERRUPT_SYNC_TIMEOUT_MS,
  ): Promise<Json> => {
    const withId = record.id ? record : { ...record, id: `mf-${crypto.randomUUID()}` };
    const id = withId.id as string;
    if (pendingRpcResponses.current.has(id)) {
      return Promise.reject(new Error(`Duplicate in-flight Pi RPC id: ${id}`));
    }

    return new Promise<Json>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pendingRpcResponses.current.delete(id);
        silentRequestIds.current.delete(id);
        historyRequestIds.current.delete(id);
        reject(new Error(`Timed out waiting for Pi response to ${String(withId.type ?? "RPC command")}.`));
      }, timeoutMs);
      pendingRpcResponses.current.set(id, { resolve, reject, timeoutId });
      if (options?.silent) silentRequestIds.current.add(id);
      if (options?.history) historyRequestIds.current.add(id);

      void invoke("send_rpc", { record: JSON.stringify(withId) }).catch((error) => {
        const pending = pendingRpcResponses.current.get(id);
        if (!pending) return;
        pendingRpcResponses.current.delete(id);
        window.clearTimeout(pending.timeoutId);
        silentRequestIds.current.delete(id);
        historyRequestIds.current.delete(id);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }, []);

  const requestHistorySnapshot = useCallback(async (timeoutMs = HISTORY_SYNC_TIMEOUT_MS): Promise<Json> => {
    return requestFullHistory(sendRecordAndWait, timeoutMs, (reason) =>
      console.warn("Pi get_entries is unavailable; falling back to compacted get_messages history.", reason),
    );
  }, [sendRecordAndWait]);

  const applyPiStateSnapshot = useCallback((data: unknown) => {
    const state = data && typeof data === "object" ? data as Json : {};
    const model = state.model as PiModel | undefined;
    setCurrentModel(model ?? null);
    setCurrentThinking(typeof state.thinkingLevel === "string" ? state.thinkingLevel : null);
    setActiveSessionPath(typeof state.sessionFile === "string" ? state.sessionFile : null);
    setActiveSessionName(typeof state.sessionName === "string" ? state.sessionName : null);
    const runtime = piRuntimeSnapshot(state);
    setStreamingState(runtime.busy);
    setGenerationStatus((current) => {
      if (!runtime.busy) return null;
      if (runtime.isCompacting) return "Compacting context";
      if (!runtime.isStreaming && runtime.pendingMessageCount > 0) return current ?? "Queued";
      return current ?? "Composing";
    });
  }, [setStreamingState]);

  const refreshSessions = useCallback(async (workingDirectory = cwd): Promise<SessionInfo[]> => {
    if (!workingDirectory.trim()) return [];
    try {
      const result = await invoke<SessionInfo[]>("list_sessions", { cwd: workingDirectory });
      if (projectKeyForSidebar(lastCwd.current || cwd) === projectKeyForSidebar(workingDirectory)) {
        setSessions(result);
        setSessionsError(false);
      }
      return result;
    } catch (error) {
      console.warn("Failed to list Pi sessions", error);
      if (projectKeyForSidebar(lastCwd.current || cwd) === projectKeyForSidebar(workingDirectory)) {
        setSessionsError(true);
      }
      return [];
    } finally {
      if (!projectSwitchInFlightRef.current && projectKeyForSidebar(lastCwd.current || cwd) === projectKeyForSidebar(workingDirectory)) {
        setSessionsLoading(false);
      }
    }
  }, [cwd]);

  const refreshCommands = useCallback(async (): Promise<CommandInfo[]> => {
    if (!connected) return [];
    const response = await sendRecordAndWait({ type: "get_commands" }, { silent: true });
    if (!response.success) throw new Error(String(response.error ?? "Pi rejected get_commands."));
    return (response.data?.commands ?? []).map((command: any) => ({
      name: command.name,
      description: command.description,
      source: command.source,
      sourceInfo: command.sourceInfo,
    }));
  }, [connected, sendRecordAndWait]);

  const refreshAvailableModels = useCallback(async () => {
    if (!connected) return;
    const response = await sendRecordAndWait({ type: "get_available_models" }, { silent: true });
    if (!response.success) throw new Error(String(response.error ?? "Pi rejected get_available_models."));
  }, [connected, sendRecordAndWait]);

  const selectModelFromPicker = useCallback(async (model: PiModel) => {
    const response = await sendRecordAndWait(createSetModelRecord(model), { silent: true });
    if (!response.success) throw new Error(String(response.error ?? "Pi rejected set_model."));
  }, [sendRecordAndWait]);

  const requestHistorySnapshotRaw = useCallback(async (timeoutMs = HISTORY_SYNC_TIMEOUT_MS): Promise<{
    response: Json;
    records: unknown[];
  }> => {
    const entriesResponse = await sendRecordAndWait(
      { type: "get_entries" },
      { silent: true },
      timeoutMs,
    );
    if (entriesResponse.success) {
      return {
        response: entriesResponse,
        records: historyRecordsFromSessionEntries(
          entriesResponse.data?.entries ?? [],
          entriesResponse.data?.leafId ?? null,
        ),
      };
    }

    const messagesResponse = await sendRecordAndWait(
      { type: "get_messages" },
      { silent: true },
      timeoutMs,
    );
    return {
      response: messagesResponse,
      records: messagesResponse.data?.messages ?? [],
    };
  }, [sendRecordAndWait]);

  const requestState = useCallback(async (silent = true) => {
    if (!connected) return;
    const response = await sendRecordAndWait({ type: "get_state" }, { silent });
    if (!response.success) throw new Error(String(response.error ?? "Pi rejected get_state."));
  }, [connected, sendRecordAndWait]);

  const refreshContextUsage = useCallback(async (silent = true) => {
    if (!connected) return;
    const response = await sendRecordAndWait({ type: "get_session_stats" }, { silent });
    if (!response.success) throw new Error(String(response.error ?? "Pi rejected get_session_stats."));
  }, [connected, sendRecordAndWait]);

  const scheduleLiveContextRefresh = useCallback((immediate = false) => {
    if (!connected) return;
    liveStatsRefreshQueuedRef.current = true;

    const schedule = () => {
      if (liveStatsRefreshInFlightRef.current || liveStatsRefreshTimerRef.current !== null) return;
      const elapsed = Date.now() - liveStatsRefreshLastAtRef.current;
      const delay = immediate ? 0 : Math.max(0, 350 - elapsed);
      liveStatsRefreshTimerRef.current = window.setTimeout(() => {
        liveStatsRefreshTimerRef.current = null;
        if (liveStatsRefreshInFlightRef.current || !liveStatsRefreshQueuedRef.current) return;
        liveStatsRefreshQueuedRef.current = false;
        liveStatsRefreshInFlightRef.current = true;
        const id = `mf-live-stats-${crypto.randomUUID()}`;
        liveStatsRequestIds.current.add(id);
        void sendRecordAndWait({ id, type: "get_session_stats" }, { silent: true })
          .then((response) => {
            if (!response.success) console.warn("Pi rejected live get_session_stats", response.error);
          })
          .catch((error) => console.warn("Could not refresh live Pi context usage", error))
          .finally(() => {
            liveStatsRequestIds.current.delete(id);
            liveStatsRefreshInFlightRef.current = false;
            liveStatsRefreshLastAtRef.current = Date.now();
            if (liveStatsRefreshQueuedRef.current) schedule();
          });
      }, delay);
    };

    schedule();
  }, [connected, sendRecordAndWait]);

  const cancelScheduledLiveContextRefresh = useCallback(() => {
    if (liveStatsRefreshTimerRef.current !== null) {
      window.clearTimeout(liveStatsRefreshTimerRef.current);
      liveStatsRefreshTimerRef.current = null;
    }
    liveStatsRefreshQueuedRef.current = false;
  }, []);

  const loadCurrentHistory = useCallback(async () => {
    if (!connected) return;
    const response = await requestHistorySnapshot();
    if (!response.success) throw new Error(String(response.error ?? "Pi rejected the history request."));
  }, [connected, requestHistorySnapshot]);

  const resyncActiveSession = useCallback(async (clearTranscript = false) => {
    if (clearTranscript) {
      cancelScheduledLiveContextRefresh();
      setHistoryLoading(true);
      // Session restoration changes the transcript, not the project list.
      // Keep its rows mounted so switching chats never flashes Loading sessions.
      setSessionsError(false);
      itemsRef.current = [];
      setItems([]);
      setPostCompactionContextEstimate(null);
      resetTransientRuntime();
      frozenTranscriptItemsRef.current = null;
      setFrozenTranscriptItems(null);
      setAutoScrollMode(true);
      cancelAutoFollowMotion();
      clearReaderScrollLock();
    }
    try {
      const [stateResponse, historyResponse, statsResponse] = await Promise.all([
        sendRecordAndWait({ type: "get_state" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS),
        requestHistorySnapshot(HISTORY_SYNC_TIMEOUT_MS),
        sendRecordAndWait({ type: "get_session_stats" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS),
      ]);
      for (const response of [stateResponse, historyResponse, statsResponse]) {
        if (!response.success) throw new Error(String(response.error ?? `${response.command ?? "Pi sync"} failed.`));
      }
      await refreshSessions(lastCwd.current || cwd);
      return { stateResponse, historyResponse, statsResponse };
    } finally {
      if (clearTranscript) setHistoryLoading(false);
    }
  }, [cancelAutoFollowMotion, cancelScheduledLiveContextRefresh, clearReaderScrollLock, cwd, refreshSessions, requestHistorySnapshot, resetTransientRuntime, sendRecordAndWait, setAutoScrollMode]);

  const restorePreferredModel = useCallback(async () => {
    const preferred = preferredModelRef.current;
    if (!preferred) return;
    const response = await sendRecordAndWait(
      { type: "set_model", provider: preferred.provider, modelId: preferred.id },
      { silent: true },
      INTERRUPT_SYNC_TIMEOUT_MS,
    );
    if (!response.success) console.warn("Could not restore preferred model after session mutation", response.error);
  }, [sendRecordAndWait]);

  const switchSessionAndResync = useCallback(async (sessionPath: string): Promise<boolean> => {
    const path = sessionPath.trim();
    if (!path) return false;
    beginInputBlock();
    const id = `mf-switch-${crypto.randomUUID()}`;
    pendingSessionSwitch.current.set(id, path);
    managedSessionMutationIds.current.add(id);
    try {
      const response = await sendRecordAndWait({ id, type: "switch_session", sessionPath: path }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
      if (!response.success) throw new Error(String(response.error ?? "Pi rejected switch_session."));
      if (response.data?.cancelled) return false;
      await resyncActiveSession(true);
      await restorePreferredModel();
      return true;
    } finally {
      pendingSessionSwitch.current.delete(id);
      managedSessionMutationIds.current.delete(id);
      endInputBlock();
    }
  }, [beginInputBlock, endInputBlock, restorePreferredModel, resyncActiveSession, sendRecordAndWait]);

  const reconcileProviderAbortAfterSettlement = useCallback(async () => {
    beginInputBlock();
    setStreamingState(true);
    setGenerationStatus("Synchronizing interrupted turn");
    try {
      const [messagesResponse, historySnapshot, statsResponse] = await Promise.all([
        // get_messages remains the interruption-safety source because dangling
        // tool calls must match Pi's current model-visible context.
        sendRecordAndWait({ type: "get_messages" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS),
        // Fetch the authoritative full display branch without applying the usual
        // history landing behavior. A provider-abort reconciliation must not drag
        // a reader who intentionally scrolled up back to the bottom.
        requestHistorySnapshotRaw(HISTORY_SYNC_TIMEOUT_MS),
        sendRecordAndWait({ type: "get_session_stats" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS),
      ]);
      for (const response of [messagesResponse, historySnapshot.response, statsResponse]) {
        if (!response.success) {
          throw new Error(String(response.error ?? `${response.command ?? "Pi sync"} failed after provider abort.`));
        }
      }

      // Parse the full branch as part of reconciliation so provider-aborted
      // history is validated with the same interrupted-state rules used on
      // session restore, without replacing the live reader viewport.
      void historyToTranscript(historySnapshot.records);

      const unmatchedCalls = unmatchedToolCallIds(messagesResponse.data?.messages);
      if (unmatchedCalls.length > 0) {
        let recovered = false;
        try {
          const candidatesResponse = await sendRecordAndWait(
            { type: "get_fork_messages" },
            { silent: true },
            INTERRUPT_SYNC_TIMEOUT_MS,
          );
          const candidate = candidatesResponse.success
            ? latestForkCandidate(candidatesResponse.data)
            : null;
          if (candidate) {
            const forkId = `mf-recover-${crypto.randomUUID()}`;
            managedSessionMutationIds.current.add(forkId);
            try {
              const forkResponse = await sendRecordAndWait(
                { id: forkId, type: "fork", entryId: candidate.entryId },
                { silent: true },
                INTERRUPT_SYNC_TIMEOUT_MS,
              );
              if (forkResponse.success && !forkResponse.data?.cancelled) {
                const recoveredPrompt = typeof forkResponse.data?.text === "string"
                  ? forkResponse.data.text
                  : candidate.text;
                composerDraftSetterRef.current((current) =>
                  mergeRecoveredPrompt(current, recoveredPrompt),
                );
                await resyncActiveSession(true);
                await restorePreferredModel();
                append({
                  kind: "system",
                  title: "Interrupted turn recovered",
                  text: `Pi persisted ${unmatchedCalls.length} dangling tool call${unmatchedCalls.length === 1 ? "" : "s"} after the provider abort. Molten Forge moved the active session to a clean fork before the interrupted turn and restored that prompt to the composer. The original interrupted branch remains in Pi history for inspection.`,
                });
                recovered = true;
              }
            } finally {
              managedSessionMutationIds.current.delete(forkId);
            }
          }
        } catch (error) {
          console.warn("Could not create a clean fork after provider-abort dangling tool calls", error);
        }

        if (!recovered) {
          append({
            kind: "error",
            title: "Interrupted tool state",
            text: `Pi persisted ${unmatchedCalls.length} tool call${unmatchedCalls.length === 1 ? "" : "s"} without a matching tool result after the provider abort. Automatic clean-fork recovery was unavailable, so this session tail may be rejected by another provider or harness.`,
          });
        }
      }

      const stateResponse = await sendRecordAndWait(
        { type: "get_state" },
        { silent: true },
        INTERRUPT_SYNC_TIMEOUT_MS,
      );
      if (!stateResponse.success) {
        throw new Error(String(stateResponse.error ?? "Pi state sync failed after provider abort."));
      }
      const runtime = runtimeStateAfterInterrupt(stateResponse.data);
      if (runtime.busy) {
        throw new Error("Pi remained busy after provider abort settlement.");
      }
      await refreshSessions(lastCwd.current || cwd);
    } catch (error) {
      console.warn("Could not fully reconcile provider-aborted turn", error);
      append({
        kind: "error",
        title: "Interrupted turn sync",
        text: `Could not fully resynchronize the provider-aborted turn: ${String(error)}`,
      });
    } finally {
      resetTransientRuntime();
      setGenerationStatus(null);
      setStreamingState(false);
      endInputBlock();
    }
  }, [
    append,
    beginInputBlock,
    cwd,
    endInputBlock,
    refreshSessions,
    requestHistorySnapshotRaw,
    resetTransientRuntime,
    resyncActiveSession,
    restorePreferredModel,
    sendRecordAndWait,
    setStreamingState,
  ]);

  const interruptGeneration = useCallback((): Promise<boolean> => {
    if (interruptInFlightRef.current) return interruptInFlightRef.current;
    if (!connected || !isStreamingRef.current) return Promise.resolve(true);

    interruptCompactionAbortReassertedRef.current = false;
    const operation = (async (): Promise<boolean> => {
      setGenerationStatus("Stopping");
      try {
        const clearQueueResponse = await sendRecordAndWait({ type: "clear_queue" }, { silent: true }, INTERRUPT_CLEAR_QUEUE_TIMEOUT_MS);
        if (clearQueueResponse.success) {
          const restored = queuedTextFromClearQueue(clearQueueResponse.data);
          if (restored.length > 0) composerDraftSetterRef.current((current) => mergeRestoredQueuedText(current, restored));
        } else {
          console.warn("Pi rejected clear_queue before abort", clearQueueResponse.error);
        }
      } catch (error) {
        console.warn("Could not clear Pi queued messages before abort", error);
      }

      const abortResponse = await sendRecordAndWait({ type: "abort" }, { silent: true }, INTERRUPT_ABORT_TIMEOUT_MS);
      if (!abortResponse.success) throw new Error(String(abortResponse.error ?? "Pi rejected the abort request."));
      markRunningRuntimeInterrupted();

      const interruptStartedAt = Date.now();
      let ordinaryIdleDeadline = interruptStartedAt + INTERRUPT_IDLE_SETTLE_TIMEOUT_MS;
      let stateResponse = await sendRecordAndWait({ type: "get_state" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
      if (!stateResponse.success) throw new Error(String(stateResponse.error ?? "Pi state sync failed after abort."));
      let runtime = runtimeStateAfterInterrupt(stateResponse.data);
      let wasCompacting = runtime.isCompacting;

      while (runtime.busy) {
        if (runtime.isCompacting) {
          // Pi's current RPC abort can acknowledge success while an automatic
          // compaction summary is still running. Treat Stop as a persistent user
          // intention instead of surfacing a false terminal error after 60s.
          setStreamingState(true);
          setGenerationStatus("Stopping compaction…");

          if (Date.now() - interruptStartedAt >= INTERRUPT_COMPACTION_RESTART_TIMEOUT_MS) {
            const sessionToRestore = typeof stateResponse.data?.sessionFile === "string"
              ? stateResponse.data.sessionFile
              : activeSessionPath;
            const preserveAutoFollow = shouldAutoScroll.current;

            setGenerationStatus("Restarting Pi to stop compaction…");
            cancelScheduledLiveContextRefresh();
            resetTransientRuntime();
            await invoke("stop_pi").catch(() => {});
            rejectPendingRpcResponses("Pi restarted to stop stalled compaction.");
            await new Promise<void>((resolve) => window.setTimeout(resolve, 150));

            const connectedAgain = await connect(lastCwd.current || cwd);
            if (!connectedAgain) throw new Error("Could not restart Pi after stalled compaction.");
            if (sessionToRestore) {
              const restored = await switchSessionAndResync(sessionToRestore);
              if (!restored) throw new Error("Could not restore the active session after stopping stalled compaction.");
            }
            setAutoScrollMode(preserveAutoFollow);

            stateResponse = await sendRecordAndWait({ type: "get_state" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
            if (!stateResponse.success) throw new Error(String(stateResponse.error ?? "Pi state sync failed after compaction restart."));
            runtime = runtimeStateAfterInterrupt(stateResponse.data);
            if (runtime.busy) throw new Error("Pi remained busy after the compaction restart fallback.");
            break;
          }
        } else {
          setGenerationStatus("Stopping");

          // A compaction can swallow the first abort and then resume the agent.
          // Reassert the same Stop request as soon as Pi leaves compaction.
          if (wasCompacting) {
            if (!interruptCompactionAbortReassertedRef.current) {
              interruptCompactionAbortReassertedRef.current = true;
              const followUpAbort = await sendRecordAndWait({ type: "abort" }, { silent: true }, INTERRUPT_ABORT_TIMEOUT_MS);
              if (!followUpAbort.success) throw new Error(String(followUpAbort.error ?? "Pi rejected the post-compaction abort request."));
            }
            ordinaryIdleDeadline = Date.now() + INTERRUPT_IDLE_SETTLE_TIMEOUT_MS;
          } else if (Date.now() >= ordinaryIdleDeadline) {
            setStreamingState(true);
            setGenerationStatus(runtime.status);
            throw new Error("Pi remained busy after abort; refusing to treat the session as safely settled.");
          }
        }

        wasCompacting = runtime.isCompacting;
        await new Promise<void>((resolve) => window.setTimeout(resolve, INTERRUPT_IDLE_POLL_INTERVAL_MS));
        stateResponse = await sendRecordAndWait({ type: "get_state" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
        if (!stateResponse.success) throw new Error(String(stateResponse.error ?? "Pi state sync failed while waiting for idle."));
        runtime = runtimeStateAfterInterrupt(stateResponse.data);
      }

      const [statsResponse, messagesResponse, historyResponse] = await Promise.all([
        sendRecordAndWait({ type: "get_session_stats" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS),
        // get_messages is still the right source for interruption safety because
        // unmatched tool calls are checked against Pi's current model-visible context.
        sendRecordAndWait({ type: "get_messages" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS),
        requestHistorySnapshot(HISTORY_SYNC_TIMEOUT_MS),
      ]);
      for (const response of [statsResponse, messagesResponse, historyResponse]) {
        if (!response.success) throw new Error(String(response.error ?? `${response.command ?? "Pi sync"} failed after abort.`));
      }

      const unmatchedCalls = unmatchedToolCallIds(messagesResponse.data?.messages);
      if (unmatchedCalls.length > 0) {
        let recovered = false;
        try {
          const candidatesResponse = await sendRecordAndWait({ type: "get_fork_messages" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
          const candidate = candidatesResponse.success ? latestForkCandidate(candidatesResponse.data) : null;
          if (candidate) {
            const forkId = `mf-recover-${crypto.randomUUID()}`;
            managedSessionMutationIds.current.add(forkId);
            try {
              const forkResponse = await sendRecordAndWait({ id: forkId, type: "fork", entryId: candidate.entryId }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
              if (forkResponse.success && !forkResponse.data?.cancelled) {
                const recoveredPrompt = typeof forkResponse.data?.text === "string" ? forkResponse.data.text : candidate.text;
                composerDraftSetterRef.current((current) => mergeRecoveredPrompt(current, recoveredPrompt));
                await resyncActiveSession(true);
                await restorePreferredModel();
                append({
                  kind: "system",
                  title: "Interrupted turn recovered",
                  text: `Pi persisted ${unmatchedCalls.length} dangling tool call${unmatchedCalls.length === 1 ? "" : "s"}. Molten Forge moved the active session to a clean fork before the interrupted turn and restored that prompt to the composer. The original interrupted branch remains in Pi history for inspection.`,
                });
                recovered = true;
              }
            } finally {
              managedSessionMutationIds.current.delete(forkId);
            }
          }
        } catch (error) {
          console.warn("Could not create a clean fork after interrupted dangling tool calls", error);
        }
        if (!recovered) {
          append({
            kind: "error",
            title: "Interrupted tool state",
            text: `Pi persisted ${unmatchedCalls.length} tool call${unmatchedCalls.length === 1 ? "" : "s"} without a matching tool result after the abort. Automatic clean-fork recovery was unavailable, so this session tail may be rejected by another provider or harness.`,
          });
        }
      }

      flushFrozenTranscriptAtSettle();
      setStreamingState(false);
      setGenerationStatus(null);
      setExtensionDialog(null);
      setDialogValue("");
      resetTransientRuntime();
      await refreshSessions(lastCwd.current || cwd);
      return true;
    })().catch((error) => {
      append({ kind: "error", text: `Could not stop generation cleanly: ${String(error)}` });
      void sendRecord({ type: "get_state" }, { silent: true }).catch(() => {});
      return false;
    });

    interruptInFlightRef.current = operation;
    operation.finally(() => {
      if (interruptInFlightRef.current === operation) interruptInFlightRef.current = null;
      interruptCompactionAbortReassertedRef.current = false;
    });
    return operation;
  }, [activeSessionPath, append, cancelScheduledLiveContextRefresh, connected, cwd, flushFrozenTranscriptAtSettle, refreshSessions, rejectPendingRpcResponses, requestHistorySnapshot, markRunningRuntimeInterrupted, resetTransientRuntime, resyncActiveSession, restorePreferredModel, sendRecord, sendRecordAndWait, setAutoScrollMode, setStreamingState, switchSessionAndResync]);

  useEffect(() => {
    let active = true;
    let bridgeInitialized = false;
    let piChecked = false;
    const cleanups: Array<() => void> = [];
    const piDeltas = createPiDeltaCoalescer((record) => handleRecordRef.current(record));
    const finishInitialLoad = () => {
      if (active && bridgeInitialized && piChecked) setAppInitializing(false);
    };

    void (async () => {
      try {
        const unlisten = await Promise.all([
          listen<string>("pi-record", (event) => {
            if (!active) return;
            try {
              piDeltas.push(JSON.parse(event.payload));
            } catch (error) {
              append({ kind: "error", text: `Invalid Pi record: ${String(error)}\n${event.payload}` });
            }
          }),
          listen<string>("pi-stderr", (event) => {
            if (!active || !event.payload.trim()) return;
            const line = event.payload.trim();
            recentPiStderrRef.current = [...recentPiStderrRef.current.slice(-11), line];
            console.warn("[Pi stderr]", line);
          }),
          listen<Json>("pi-process", (event) => {
            if (!active) return;
            // Drain any last text before acting on process stop/restart.
            piDeltas.flush();
            const state = event.payload?.state;
            const eventPid = typeof event.payload?.pid === "number" ? event.payload.pid : null;
            if (state === "started") {
              if (eventPid !== null) activePiPidRef.current = eventPid;
              // Process existence is not RPC readiness. connect()/runtime recovery
              // marks the UI connected only after a correlated readiness sync.
            }
            if (state === "stopped" || state === "exited") {
              // A stopped Pi can finish draining stdout after a replacement Pi has
              // already started. Never let that stale reader tear down the new RPC
              // handshake or reject its pending requests.
              if (
                eventPid !== null
                && activePiPidRef.current !== null
                && eventPid !== activePiPidRef.current
              ) {
                return;
              }
              activePiPidRef.current = null;
              rejectPendingRpcResponses(`Pi process ${state}.`);
              silentRequestIds.current.clear();
              historyRequestIds.current.clear();
              pendingSessionSwitch.current.clear();
              pendingThinkingSet.current.clear();
              managedSessionMutationIds.current.clear();
              copyRequestIds.current.clear();
              setPiQueue({ steering: [], followUp: [] });
              if (liveStatsRefreshTimerRef.current !== null) {
                window.clearTimeout(liveStatsRefreshTimerRef.current);
                liveStatsRefreshTimerRef.current = null;
              }
              liveStatsRefreshQueuedRef.current = false;
              directBashCommands.current.clear();
              inputBlockCountRef.current = 0;
              resetTransientRuntime();
              setConnected(false);
              setHistoryLoading(false);
              frozenTranscriptItemsRef.current = null;
              setFrozenTranscriptItems(null);
              setStreamingState(false);
              setBashRunningState(false);
              setInputBlocked(false);
              setGenerationStatus(null);
              setExtensionDialog(null);
              setDialogValue("");
              setStatus({});
              setExtensionWidgets({});
              setExtensionNotice(null);
            }
          }),
        ]);
        if (!active) {
          unlisten.forEach((fn) => fn());
          return;
        }
        cleanups.push(...unlisten);

        const runtime = await invoke<{ cwd: string; approved: boolean } | null>("get_pi_runtime_status").catch(() => null);
        if (!active) return;
        if (runtime?.cwd) {
          lastCwd.current = runtime.cwd;
          setCwd(runtime.cwd);
          persistWorkingDirectory(runtime.cwd);
          rememberProject(runtime.cwd);
          frozenTranscriptItemsRef.current = null;
          setFrozenTranscriptItems(null);
          setAutoScrollMode(true);
          clearReaderScrollLock();
          const ready = await sendRecordAndWait({ type: "get_state" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
          if (!ready.success) throw new Error(String(ready.error ?? "Pi readiness handshake failed."));
          setHistoryLoading(true);
          const responses = await Promise.all([
            sendRecordAndWait({ type: "get_commands" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS),
            sendRecordAndWait({ type: "get_available_models" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS),
            sendRecordAndWait({ type: "get_session_stats" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS),
            requestHistorySnapshot(HISTORY_SYNC_TIMEOUT_MS),
          ]);
          for (const response of responses) {
            if (!response.success) throw new Error(String(response.error ?? `${response.command ?? "Pi initialization"} failed.`));
          }
          setHistoryLoading(false);
          setConnected(true);
          await refreshSessions(runtime.cwd);
        } else {
          const storedCwd = getStoredWorkingDirectory();
          if (storedCwd) {
            setCwd(storedCwd);
          } else {
            const defaultCwd = await invoke<string>("get_default_cwd").catch(() => "");
            if (active && defaultCwd) setCwd(defaultCwd);
          }
        }
      } catch (error) {
        setHistoryLoading(false);
        console.error("Failed to initialize Pi bridge", error);
      } finally {
        bridgeInitialized = true;
        finishInitialLoad();
      }
    })();

    invoke<string>("check_pi")
      .then((value) => active && setPiVersion(value))
      .catch((error) => active && setPiVersion(`Not found: ${String(error)}`))
      .finally(() => {
        piChecked = true;
        finishInitialLoad();
      });

    return () => {
      active = false;
      piDeltas.dispose();
      rejectPendingRpcResponses("Pi event bridge was disposed.");
      cleanups.forEach((fn) => fn());
    };
    // Event listeners intentionally live for the whole app lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (readerScrollLockRef.current) {
      scheduleReaderScrollLockRestore();
      return;
    }
    if (isStreamingRef.current && shouldAutoScroll.current) {
      scheduleScrollToBottom();
    }
  }, [visibleTranscriptItems, extensionDialog, scheduleReaderScrollLockRestore, scheduleScrollToBottom]);

  useEffect(() => {
    const content = transcriptContentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      syncScrollToBottomAffordance();
      if (readerScrollLockRef.current) {
        scheduleReaderScrollLockRestore();
        return;
      }
      // CodeMirror and wrapped Markdown can finish measuring after the React
      // commit. Re-arm the same old-Molten-Forge lerp when that real geometry
      // changes instead of introducing a second scroll-correction strategy.
      if (isStreamingRef.current && shouldAutoScroll.current) {
        scheduleScrollToBottom();
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [
    connected,
    scheduleReaderScrollLockRestore,
    scheduleScrollToBottom,
    syncScrollToBottomAffordance,
  ]);

  useEffect(() => {
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target : null;

      if (
        keyboardActivatesReaderLayoutInteraction(event.key)
        && target?.closest(READER_LAYOUT_INTERACTION_SELECTOR)
      ) {
        markManualScrollInput(TOUCH_SCROLL_INPUT_MS);
        disableAutoFollow(true);
        holdReaderAnchorThroughLayoutChange();
        return;
      }

      if (!keyboardMarksManualScroll(event.key)) return;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      clearReaderScrollLock();
      markManualScrollInput(TOUCH_SCROLL_INPUT_MS);
      if (keyboardStopsAutoFollow(event.key)) disableAutoFollow(true);
    };
    document.addEventListener("keydown", handleDocumentKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleDocumentKeyDown, { capture: true });
  }, [clearReaderScrollLock, disableAutoFollow, holdReaderAnchorThroughLayoutChange, markManualScrollInput]);

  useEffect(() => {
    if (isStreaming && autoScrollEnabled) scheduleScrollToBottom();
  }, [autoScrollEnabled, isStreaming, scheduleScrollToBottom]);

  useEffect(() => () => {
    cancelAutoFollowMotion();
    clearReaderScrollLock();
    if (liveStatsRefreshTimerRef.current !== null) {
      window.clearTimeout(liveStatsRefreshTimerRef.current);
      liveStatsRefreshTimerRef.current = null;
    }
    if (transcriptScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(transcriptScrollFrameRef.current);
      transcriptScrollFrameRef.current = null;
    }
  }, [cancelAutoFollowMotion, clearReaderScrollLock]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(Math.round(chatWidth)));
    } catch {
      // Ignore persistence failures; resizing still works for the current run.
    }
  }, [chatWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(sidebarWidth)));
    } catch {
      // Ignore persistence failures; resizing still works for the current run.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    try { window.localStorage.setItem(AUTO_EXPAND_THINKING_STORAGE_KEY, String(autoExpandThinking)); } catch {}
  }, [autoExpandThinking]);

  useEffect(() => {
    try { window.localStorage.setItem(AUTO_EXPAND_TOOLS_STORAGE_KEY, String(autoExpandTools)); } catch {}
  }, [autoExpandTools]);

  useEffect(() => {
    try { window.localStorage.setItem(TIMELINE_MODE_STORAGE_KEY, timelineMode); } catch {}
  }, [timelineMode]);

  useEffect(() => {
    try { window.localStorage.setItem(BACKGROUND_COMPLETION_NOTIFICATION_KEY, String(notifyWhenBackground)); } catch {}
  }, [notifyWhenBackground]);

  const changeBackgroundNotificationSetting = useCallback(async (enabled: boolean) => {
    setNotificationError(null);
    if (!enabled) { setNotifyWhenBackground(false); return; }
    try {
      // Ask only as a direct consequence of the user's Settings interaction,
      // never unexpectedly at agent_settled.
      const granted = await isPermissionGranted() || (await requestPermission()) === "granted";
      if (granted) setNotifyWhenBackground(true);
      else setNotificationError("System notification permission was not granted.");
    } catch (error) {
      setNotificationError(`Could not enable system notifications: ${String(error)}`);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.appFont = appFontFamily;
    writeAppFontFamily(window.localStorage, appFontFamily);
  }, [appFontFamily]);

  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(!sidebarVisible)); } catch {}
  }, [sidebarVisible]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  useLayoutEffect(() => {
    const pane = chatPaneRef.current;
    const composerWrap = composerWrapRef.current;
    if (!pane || !composerWrap || (!connected && !switchingFolder)) return;

    let frame = 0;
    let lastClearance = Number.parseFloat(
      pane.style.getPropertyValue("--composer-overlay-clearance"),
    );
    if (!Number.isFinite(lastClearance)) lastClearance = 190;
    let lastFadeInset = Number.parseFloat(pane.style.getPropertyValue("--composer-fade-inset"));
    if (!Number.isFinite(lastFadeInset)) lastFadeInset = 0;

    const sync = () => {
      const transcriptBottom = transcriptRef.current?.getBoundingClientRect().bottom ?? pane.getBoundingClientRect().bottom;
      const composerTop = composerWrap.getBoundingClientRect().top;
      const fadeInset = composerFadeInset(transcriptBottom, composerTop);
      // The 190px minimum clearance can stay unchanged while a short composer
      // grows. Track its actual top independently so the fade follows it.
      if (Math.abs(fadeInset - lastFadeInset) >= 1) {
        lastFadeInset = fadeInset;
        pane.style.setProperty("--composer-fade-inset", `${fadeInset}px`);
      }
      const clearance = composerOverlayClearance(transcriptBottom, composerTop);
      if (Math.abs(clearance - lastClearance) < 1) return;

      // The composer overlays the transcript. Growing it must extend the legal
      // transcript bottom instead of covering the last message. Preserve the
      // current scroll owner through that geometry change.
      if (!shouldAutoScroll.current && !readerScrollLockRef.current) {
        holdReaderAnchorThroughLayoutChange(240);
      }

      lastClearance = clearance;
      pane.style.setProperty("--composer-overlay-clearance", `${clearance}px`);

      if (shouldAutoScroll.current) {
        scheduleScrollToBottom(true, FORCED_SCROLL_SETTLE_FRAMES);
      } else {
        scheduleReaderScrollLockRestore();
      }
      window.requestAnimationFrame(syncScrollToBottomAffordance);
    };
    const scheduleSync = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(sync);
    };

    // A restored tall draft needs its real clearance before the first visible
    // frame. Later growth/shrink is owned by the ResizeObserver below.
    const transcriptBottom = transcriptRef.current?.getBoundingClientRect().bottom ?? pane.getBoundingClientRect().bottom;
    const composerTop = composerWrap.getBoundingClientRect().top;
    const initialClearance = composerOverlayClearance(transcriptBottom, composerTop);
    lastClearance = initialClearance;
    pane.style.setProperty("--composer-overlay-clearance", `${initialClearance}px`);
    lastFadeInset = composerFadeInset(transcriptBottom, composerTop);
    pane.style.setProperty("--composer-fade-inset", `${lastFadeInset}px`);

    const observer = new ResizeObserver(scheduleSync);
    observer.observe(composerWrap);
    observer.observe(pane);
    const onWindowGeometryChange = () => {
      scheduleSync();
      // A window can gain/lose transcript viewport height while the overlay's
      // own height remains unchanged. Re-land auto-follow readers at bottom.
      if (shouldAutoScroll.current) scheduleScrollToBottom(true, FORCED_SCROLL_SETTLE_FRAMES);
    };
    window.addEventListener("resize", onWindowGeometryChange);
    window.addEventListener("focus", onWindowGeometryChange);
    return () => {
      window.removeEventListener("resize", onWindowGeometryChange);
      window.removeEventListener("focus", onWindowGeometryChange);
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [
    connected,
    holdReaderAnchorThroughLayoutChange,
    scheduleReaderScrollLockRestore,
    scheduleScrollToBottom,
    switchingFolder,
    syncScrollToBottomAffordance,
  ]);

  useLayoutEffect(() => {
    const pane = chatPaneRef.current;
    const transcript = transcriptRef.current;
    const content = transcriptContentRef.current;
    if (!pane || !transcript || !content || (!connected && !switchingFolder)) return;

    let frame = 0;
    const sync = () => {
      const paneRect = pane.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const geometry = chatContentGeometry(
        paneRect.left,
        paneRect.width,
        contentRect.left,
        contentRect.width,
      );
      pane.style.setProperty("--chat-content-physical-width", `${geometry.width}px`);
      pane.style.setProperty("--chat-content-center-offset", `${geometry.centerOffset}px`);
    };
    const scheduleSync = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(sync);
    };

    sync();
    const observer = new ResizeObserver(scheduleSync);
    observer.observe(pane);
    observer.observe(transcript);
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [activeSessionPath, chatWidth, connected, settingsOpen, sidebarVisible, switchingFolder]);

  function updateChatResizeHandle(_side: "left" | "right", clientY: number) {
    const pane = chatPaneRef.current;
    if (!pane) return;
    const rect = pane.getBoundingClientRect();
    const guideTop = 52;
    const guideHeight = Math.max(1, rect.height - guideTop);
    const y = Math.max(18, Math.min(guideHeight - 18, clientY - rect.top - guideTop));
    setChatResizeMarker({ y, visible: true });
  }

  function resizeChatToPointer(side: "left" | "right", clientX: number, clientY: number) {
    const pane = chatPaneRef.current;
    if (!pane) return;
    const rect = pane.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const halfWidth = side === "right" ? clientX - centerX : centerX - clientX;
    const maxWidth = Math.max(320, rect.width - CHAT_SIDE_GUTTER);
    const minWidth = Math.min(MIN_CHAT_WIDTH, maxWidth);
    const nextWidth = Math.round(Math.max(minWidth, Math.min(maxWidth, halfWidth * 2)));
    setChatWidth(nextWidth);
    updateChatResizeHandle(side, clientY);
  }

  function beginChatWidthResize(side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    activeChatResizeSideRef.current = side;
    document.body.classList.add("chat-width-resizing");
    resizeChatToPointer(side, event.clientX, event.clientY);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      resizeChatToPointer(side, moveEvent.clientX, moveEvent.clientY);
    };
    const handlePointerUp = () => {
      activeChatResizeSideRef.current = null;
      document.body.classList.remove("chat-width-resizing");
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  }

  function handleChatResizeHover(side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) {
    updateChatResizeHandle(side, event.clientY);
  }

  function handleChatResizeLeave(side: "left" | "right") {
    if (activeChatResizeSideRef.current === side) return;
    setChatResizeMarker((current) => ({ ...current, visible: false }));
  }

  function updateSidebarResizeMarker(clientY: number) {
    const sidebar = sessionSidebarRef.current;
    if (!sidebar) return;
    const rect = sidebar.getBoundingClientRect();
    const y = Math.max(18, Math.min(rect.height - 18, clientY - rect.top));
    setSidebarResizeMarker({ y, visible: true });
  }

  function beginSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    sidebarResizingRef.current = true;
    document.body.classList.add("sidebar-width-resizing");
    updateSidebarResizeMarker(event.clientY);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const sidebar = sessionSidebarRef.current;
      if (!sidebar) return;
      const workspaceWidth = sidebar.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
      const maxWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, workspaceWidth - 440));
      const nextWidth = Math.round(Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxWidth, moveEvent.clientX)));
      setSidebarWidth(nextWidth);
      updateSidebarResizeMarker(moveEvent.clientY);
    };
    const handlePointerUp = () => {
      sidebarResizingRef.current = false;
      document.body.classList.remove("sidebar-width-resizing");
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  }

  const handleTranscriptScroll = useCallback(() => {
    if (transcriptScrollFrameRef.current !== null) return;
    transcriptScrollFrameRef.current = window.requestAnimationFrame(() => {
      transcriptScrollFrameRef.current = null;
      const transcript = transcriptRef.current;
      if (!transcript) return;

      const previousScrollTop = lastTranscriptScrollTopRef.current;
      const currentScrollTop = transcript.scrollTop;
      lastTranscriptScrollTopRef.current = currentScrollTop;
      syncScrollToBottomAffordance();
      if (shouldAutoScroll.current) return;

      const now = Date.now();
      if (now < programmaticScrollUntilRef.current) return;
      if (now >= manualScrollInputUntilRef.current) return;

      const distanceFromBottom = chatDistanceFromBottom({
        scrollHeight: transcript.scrollHeight,
        scrollTop: currentScrollTop,
        clientHeight: transcript.clientHeight,
      });
      if (shouldResumeAutoFollowFromManualScroll({
        previousScrollTop,
        currentScrollTop,
        distanceFromBottom,
      })) {
        resumeAutoFollow();
      }
    });
  }, [resumeAutoFollow, syncScrollToBottomAffordance]);

  const handleTranscriptWheel = useCallback((event: ReactWheelEvent<HTMLElement>) => {
    clearReaderScrollLock();
    markManualScrollInput();
    if (event.deltaY < 0) disableAutoFollow(true);
  }, [clearReaderScrollLock, disableAutoFollow, markManualScrollInput]);

  const handleChatResizeWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const transcript = transcriptRef.current;
    if (!transcript || event.deltaY === 0) return;

    // The resize affordance sits above the transcript so pointer input can drag
    // it. Forward wheel movement to the real transcript instead of creating a
    // narrow dead strip where the chat cannot scroll.
    event.preventDefault();
    clearReaderScrollLock();
    markManualScrollInput();
    if (event.deltaY < 0) disableAutoFollow(true);

    const multiplier = event.deltaMode === 1
      ? 32
      : event.deltaMode === 2
        ? transcript.clientHeight
        : 1;
    transcript.scrollTop += event.deltaY * multiplier;
  }, [clearReaderScrollLock, disableAutoFollow, markManualScrollInput]);

  const handleTranscriptPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const transcript = transcriptRef.current;
    if (!transcript) return;

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(READER_LAYOUT_INTERACTION_SELECTOR)) {
      markManualScrollInput(TOUCH_SCROLL_INPUT_MS);
      disableAutoFollow(true);
      holdReaderAnchorThroughLayoutChange();
      return;
    }

    const rect = transcript.getBoundingClientRect();
    if (pointerMarksManualScroll(
      event.pointerType,
      event.clientX,
      rect.right,
      transcript.offsetWidth,
      transcript.clientWidth,
    )) {
      clearReaderScrollLock();
      markManualScrollInput(TOUCH_SCROLL_INPUT_MS);
      disableAutoFollow(true);
    }
  }, [clearReaderScrollLock, disableAutoFollow, holdReaderAnchorThroughLayoutChange, markManualScrollInput]);

  const applyLoadedHistory = useCallback((records: unknown[]) => {
    const loaded = historyToTranscript(Array.isArray(records) ? records : []);
    const landing = historyLandingPosition(loaded.length);
    frozenTranscriptItemsRef.current = null;
    setFrozenTranscriptItems(null);
    cancelAutoFollowMotion();
    clearReaderScrollLock();
    setAutoScrollMode(landing === "bottom");
    itemsRef.current = loaded;
    setItems(loaded);
    setShowScrollToBottomButton(false);
    setHistoryLoading(false);
    if (landing === "bottom") {
      window.requestAnimationFrame(() => scheduleScrollToBottom(true));
      return;
    }

    const transcript = transcriptRef.current;
    if (transcript) {
      markProgrammaticScroll();
      transcript.scrollTop = 0;
      lastTranscriptScrollTopRef.current = 0;
    }
  }, [cancelAutoFollowMotion, clearReaderScrollLock, markProgrammaticScroll, scheduleScrollToBottom, setAutoScrollMode]);

  function handleRecord(record: Json) {
    switch (record.type) {
      case "response": {
        const responseId = typeof record.id === "string" ? record.id : "";
        const pendingResponse = responseId ? pendingRpcResponses.current.get(responseId) : undefined;
        if (responseId && pendingResponse) {
          pendingRpcResponses.current.delete(responseId);
          window.clearTimeout(pendingResponse.timeoutId);
          pendingResponse.resolve(record);
        }
        const wasSilent = responseId ? silentRequestIds.current.delete(responseId) : false;

        if (!record.success) {
          if (responseId) {
            historyRequestIds.current.delete(responseId);
            pendingSessionSwitch.current.delete(responseId);
            pendingThinkingSet.current.delete(responseId);
            managedSessionMutationIds.current.delete(responseId);
            copyRequestIds.current.delete(responseId);
          }
          if (record.command === "compact" && activeCompactionId.current) {
            patchItem(activeCompactionId.current, {
              toolOutput: String(record.error ?? "Compaction failed."),
              state: "error",
            });
            activeCompactionId.current = null;
            pendingManualCompactionInstructions.current = null;
            setGenerationStatus("Synchronizing");
            void sendRecord({ type: "get_state" }, { silent: true }).catch(() => {});
          } else if (!wasSilent) {
            append({ kind: "error", text: `${record.command ?? "RPC command"} failed: ${record.error ?? pretty(record)}` });
          }
          if (!wasSilent) scheduleScrollToBottom();
          return;
        }

        if (record.command === "get_commands") {
          const discovered = (record.data?.commands ?? []).map((command: any) => ({
            name: command.name,
            description: command.description,
            source: command.source,
            sourceInfo: command.sourceInfo,
          }));
          setCommands(discovered);
          return;
        }

        if (record.command === "get_state") {
          applyPiStateSnapshot(record.data);
          if (!wasSilent) append({ kind: "system", title: "Pi state", text: `\`\`\`json\n${pretty(record.data)}\n\`\`\`` });
          void refreshSessions(lastCwd.current || cwd);
          return;
        }

        if (record.command === "get_entries") {
          if (responseId && historyRequestIds.current.delete(responseId)) {
            const records = historyRecordsFromSessionEntries(
              record.data?.entries ?? [],
              record.data?.leafId ?? null,
            );
            applyLoadedHistory(records);
            return;
          }
          if (!wasSilent) append({ kind: "system", title: "Session entries", text: `\`\`\`json\n${pretty(record.data)}\n\`\`\`` });
          return;
        }

        if (record.command === "get_messages") {
          if (responseId && historyRequestIds.current.delete(responseId)) {
            applyLoadedHistory(record.data?.messages ?? []);
            return;
          }
          if (!wasSilent) append({ kind: "system", title: "Messages", text: `\`\`\`json\n${pretty(record.data)}\n\`\`\`` });
          return;
        }

        if (record.command === "get_available_models") {
          const available = (record.data?.models ?? []) as PiModel[];
          setModels(available);
          if (!wasSilent) {
            append({
              kind: "system",
              title: "Available models",
              text: available.length
                ? available.map((model) => `- \`${model.provider}/${model.id}\`${model.name && model.name !== model.id ? ` — ${model.name}` : ""}`).join("\n")
                : "No configured models returned by Pi.",
            });
            scheduleScrollToBottom();
          }
          return;
        }

        if (record.command === "set_model") {
          const model = record.data as PiModel;
          if (model?.provider && model?.id) {
            setCurrentModel(model);
            preferredModelRef.current = { provider: model.provider, id: model.id };
            persistPreferredModel(model);
            void invoke("save_default_model", { provider: model.provider, modelId: model.id }).catch((error) => {
              console.warn("Failed to persist Pi default model", error);
            });
          }
          if (!wasSilent) {
            append({
              kind: "tool",
              title: "model",
              text: "",
              toolInput: model?.provider && model?.id ? `${model.provider}/${model.id}` : "Model change",
              toolOutput: model?.provider && model?.id ? "Switched model and saved it as the Pi default." : "Model changed.",
              toolExecutionStarted: true,
              state: "done",
            });
            scheduleScrollToBottom();
          }
          void sendRecord({ type: "get_session_stats" }, { silent: true }).catch(() => {});
          return;
        }

        if (record.command === "get_available_thinking_levels") {
          if (!wasSilent) append({ kind: "system", title: "Thinking levels", text: (record.data?.levels ?? []).map((level: string) => `\`${level}\``).join(" · ") || "`off`" });
          return;
        }

        if (record.command === "set_thinking_level") {
          const requested = responseId ? pendingThinkingSet.current.get(responseId) : undefined;
          if (responseId) pendingThinkingSet.current.delete(responseId);
          if (requested) setCurrentThinking(requested);
          append({ kind: "system", title: "Thinking", text: requested ? `Set to \`${requested}\`.` : "Thinking level changed." });
          return;
        }

        if (record.command === "bash" && record.id) {
          const requestId = String(record.id);
          const id = `bash-${requestId}`;
          const outputValue = record.data?.output ?? record.data?.stderr ?? record.data?.error ?? "";
          const output = typeof outputValue === "string" ? outputValue : extractToolResultText(outputValue);
          const command = directBashCommands.current.get(requestId) ?? "";
          directBashCommands.current.delete(requestId);
          setBashRunningState(false);
          updateItems((current) => {
            const existing = current.find((item) => item.id === id);
            if (existing) return current.map((item) => item.id === id ? {
              ...item, text: "", toolInput: item.toolInput || command,
              toolOutput: output || item.toolOutput || item.text,
              state: record.data?.cancelled
                ? "interrupted"
                : record.data?.exitCode === 0
                  ? "done"
                  : "error",
            } : item);
            return [...current, {
              id,
              kind: "tool",
              title: "shell",
              text: "",
              toolInput: command,
              toolOutput: output,
              toolExecutionStarted: true,
              state: record.data?.cancelled
                ? "interrupted"
                : record.data?.exitCode === 0
                  ? "done"
                  : "error",
            }];
          });
          return;
        }

        if (record.command === "new_session") {
          const managed = responseId ? managedSessionMutationIds.current.delete(responseId) : false;
          if (record.data?.cancelled) {
            if (!wasSilent) append({ kind: "system", text: "New session was cancelled by a Pi extension." });
            return;
          }
          if (managed) return;
          void resyncActiveSession(true).catch((error) => append({ kind: "error", text: `Could not synchronize new Pi session: ${String(error)}` }));
          return;
        }

        if (record.command === "set_session_name") {
          append({ kind: "system", text: "Session name updated." });
          void sendRecord({ type: "get_state" }, { silent: true });
          void refreshSessions(lastCwd.current || cwd);
          return;
        }

        if (record.command === "switch_session") {
          const requestedPath = responseId ? pendingSessionSwitch.current.get(responseId) : undefined;
          if (responseId) pendingSessionSwitch.current.delete(responseId);
          const managed = responseId ? managedSessionMutationIds.current.delete(responseId) : false;
          if (record.data?.cancelled) {
            if (!wasSilent) append({ kind: "system", text: "Session switch was cancelled by a Pi extension." });
            return;
          }
          if (requestedPath) setActiveSessionPath(requestedPath);
          if (managed) return;
          void (async () => {
            try { await resyncActiveSession(true); await restorePreferredModel(); }
            catch (error) { append({ kind: "error", text: `Could not synchronize switched Pi session: ${String(error)}` }); }
          })();
          return;
        }

        if (record.command === "get_session_stats") {
          const stats = (record.data ?? {}) as SessionStats;
          const lightweightLiveRefresh = responseId ? liveStatsRequestIds.current.delete(responseId) : false;
          setSessionStats(stats);
          if (typeof stats.contextUsage?.tokens === "number" && Number.isFinite(stats.contextUsage.tokens)) {
            authoritativeContextTokensRef.current = stats.contextUsage.tokens;
            setPostCompactionContextEstimate(null);
          }

          if (!lightweightLiveRefresh) {
            const sessionFile = stats.sessionFile || activeSessionPath;
            if (sessionFile) {
              void invoke<ContextBreakdown>("analyze_session_context", { sessionPath: sessionFile })
                .then(setContextBreakdown)
                .catch(() => setContextBreakdown(null));
            } else {
              setContextBreakdown(null);
            }
          }

          if (!wasSilent) {
            append({ kind: "system", title: "Session", text: `\`\`\`json\n${pretty(record.data)}\n\`\`\`` });
            scheduleScrollToBottom();
          }
          return;
        }

        if (record.command === "compact") {
          // Normally compaction_start/end own the visual lifecycle. This is a
          // fallback for Pi builds that return a result without emitting events.
          if (activeCompactionId.current && record.data) {
            const eventBefore = typeof record.data?.tokensBefore === "number" && Number.isFinite(record.data.tokensBefore)
              ? record.data.tokensBefore
              : compactionBeforeTokensRef.current;
            const eventAfter = typeof record.data?.estimatedTokensAfter === "number" && Number.isFinite(record.data.estimatedTokensAfter)
              ? record.data.estimatedTokensAfter
              : undefined;
            const estimate = contextEstimateAfterCompaction(record.data);
            if (estimate !== null) setPostCompactionContextEstimate(estimate);
            patchItem(activeCompactionId.current, {
              toolOutput: compactionResultSummary(eventBefore, eventAfter),
              state: "done",
            });
          }
          return;
        }

        if (record.command === "fork" || record.command === "clone") {
          const managed = responseId ? managedSessionMutationIds.current.delete(responseId) : false;
          if (record.data?.cancelled || managed) return;
          if (record.command === "fork" && typeof record.data?.text === "string") {
            composerDraftSetterRef.current((current) => mergeRecoveredPrompt(current, record.data.text));
          }
          void resyncActiveSession(true).catch((error) => append({ kind: "error", text: `Could not synchronize ${record.command} session: ${String(error)}` }));
          return;
        }

        if (["get_tree", "get_fork_messages", "export_html"].includes(record.command)) {
          if (!wasSilent) {
            append({ kind: "system", title: record.command, text: rpcResponseText(record.data) });
            scheduleScrollToBottom();
          }
          return;
        }

        if (record.command === "get_last_assistant_text" && record.id && copyRequestIds.current.has(record.id)) {
          copyRequestIds.current.delete(record.id);
          const text = record.data?.text;
          if (typeof text === "string" && text) {
            navigator.clipboard.writeText(text)
              .then(() => append({ kind: "system", text: "Copied the last assistant message." }))
              .catch((error) => append({ kind: "error", text: `Clipboard failed: ${String(error)}` }));
          } else {
            append({ kind: "system", text: "There is no assistant text to copy yet." });
          }
          return;
        }

        // Keep the wrapper future-proof: any successful RPC command that is not
        // handled above still gets a visible result instead of disappearing.
        // Prompt/extension-ui acknowledgements are intentionally silent because
        // their meaningful output arrives through streamed events.
        if (!wasSilent && !["prompt", "extension_ui_response"].includes(record.command)) {
          append({
            kind: "system",
            title: record.command ? `/${record.command}` : "Pi RPC",
            text: rpcResponseText(record.data),
          });
          scheduleScrollToBottom();
        }
        return;
      }

      case "compaction_start": {
        cancelScheduledLiveContextRefresh();
        compactionBeforeTokensRef.current = typeof record.tokensBefore === "number" && Number.isFinite(record.tokensBefore)
          ? record.tokensBefore
          : authoritativeContextTokensRef.current;
        if (interruptInFlightRef.current) interruptCompactionAbortReassertedRef.current = false;
        const reason = String(record.reason ?? "manual") as "manual" | "threshold" | "overflow";
        const instructions = pendingManualCompactionInstructions.current;
        const toolInput = reason === "manual"
          ? instructions
            ? `Manual context compaction\nInstructions: ${instructions}`
            : "Manual context compaction"
          : reason === "overflow"
            ? "Automatic context compaction · overflow recovery"
            : "Automatic context compaction · context threshold reached";

        setStreamingState(true);
        setGenerationStatus(interruptInFlightRef.current ? "Stopping compaction…" : reason === "manual" ? "Compacting context" : "Auto-compacting context");
        if (activeCompactionId.current) {
          patchItem(activeCompactionId.current, {
            title: "compact",
            text: "",
            runtimeRole: "session-maintenance",
            toolInput,
            toolOutput: "Generating conversation summary…",
            state: "running",
          });
        } else {
          activeCompactionId.current = append({
            kind: "tool",
            title: "compact",
            text: "",
            runtimeRole: "session-maintenance",
            toolInput,
            toolOutput: "Generating conversation summary…",
            state: "running",
          });
        }
        scheduleScrollToBottom();
        return;
      }

      case "compaction_end": {
        const result = record.result ?? null;
        const aborted = Boolean(record.aborted);
        const failed = !aborted && !result;
        const id = activeCompactionId.current;
        const eventBefore = typeof result?.tokensBefore === "number" && Number.isFinite(result.tokensBefore)
          ? result.tokensBefore
          : compactionBeforeTokensRef.current;
        const eventAfter = typeof result?.estimatedTokensAfter === "number" && Number.isFinite(result.estimatedTokensAfter)
          ? result.estimatedTokensAfter
          : undefined;
        const estimate = contextEstimateAfterCompaction(result);
        if (!aborted && !failed && estimate !== null) setPostCompactionContextEstimate(estimate);
        const detail = aborted
          ? "Compaction was aborted."
          : failed
            ? String(record.errorMessage ?? "Compaction failed.")
            : compactionResultSummary(eventBefore, eventAfter);

        if (id) {
          patchItem(id, {
            title: "compact",
            runtimeRole: "session-maintenance",
            toolOutput: detail,
            state: aborted ? "interrupted" : failed ? "error" : "done",
          });
        } else {
          append({
            kind: "tool",
            title: "compact",
            text: "",
            runtimeRole: "session-maintenance",
            toolInput: record.reason === "manual"
              ? "Manual context compaction"
              : record.reason === "overflow"
                ? "Automatic context compaction · overflow recovery"
                : "Automatic context compaction · context threshold reached",
            toolOutput: detail,
            state: aborted ? "interrupted" : failed ? "error" : "done",
          });
        }
        activeCompactionId.current = null;
        pendingManualCompactionInstructions.current = null;
        compactionBeforeTokensRef.current = null;
        if (interruptInFlightRef.current && !interruptCompactionAbortReassertedRef.current) {
          interruptCompactionAbortReassertedRef.current = true;
          setGenerationStatus("Stopping");
          void sendRecordAndWait({ type: "abort" }, { silent: true }, INTERRUPT_ABORT_TIMEOUT_MS)
            .catch((error) => console.warn("Could not reassert Stop after compaction ended", error));
        } else if (record.willRetry) {
          setGenerationStatus("Retrying after compaction");
        }
        // compaction_end is not a universal idle barrier. A threshold/overflow
        // compaction can belong to a larger agent run; get_state/agent_settled
        // decide whether the wrapper is actually idle.
        void sendRecord({ type: "get_state" }, { silent: true }).catch(() => {});
        void sendRecord({ type: "get_session_stats" }, { silent: true }).catch(() => {});
        scheduleScrollToBottom();
        return;
      }

      // Compatibility with older Pi builds that used auto_compaction_* names.
      case "auto_compaction_start": {
        cancelScheduledLiveContextRefresh();
        compactionBeforeTokensRef.current = typeof record.tokensBefore === "number" && Number.isFinite(record.tokensBefore)
          ? record.tokensBefore
          : authoritativeContextTokensRef.current;
        if (interruptInFlightRef.current) interruptCompactionAbortReassertedRef.current = false;
        setStreamingState(true);
        setGenerationStatus(interruptInFlightRef.current ? "Stopping compaction…" : "Auto-compacting context");
        if (!activeCompactionId.current) {
          activeCompactionId.current = append({
            kind: "tool",
            title: "compact",
            text: "",
            runtimeRole: "session-maintenance",
            toolInput: "Automatic context compaction",
            toolOutput: "Generating conversation summary…",
            state: "running",
          });
        }
        scheduleScrollToBottom();
        return;
      }

      case "auto_compaction_end": {
        const id = activeCompactionId.current;
        if (id) patchItem(id, {
          title: "compact",
          runtimeRole: "session-maintenance",
          toolOutput: compactionResultSummary(compactionBeforeTokensRef.current, undefined),
          state: "done",
        });
        activeCompactionId.current = null;
        pendingManualCompactionInstructions.current = null;
        compactionBeforeTokensRef.current = null;
        if (interruptInFlightRef.current && !interruptCompactionAbortReassertedRef.current) {
          interruptCompactionAbortReassertedRef.current = true;
          setGenerationStatus("Stopping");
          void sendRecordAndWait({ type: "abort" }, { silent: true }, INTERRUPT_ABORT_TIMEOUT_MS)
            .catch((error) => console.warn("Could not reassert Stop after legacy compaction ended", error));
        }
        void sendRecord({ type: "get_state" }, { silent: true }).catch(() => {});
        void sendRecord({ type: "get_session_stats" }, { silent: true }).catch(() => {});
        scheduleScrollToBottom();
        return;
      }

      case "turn_end":
        // One Pi turn is an assistant response plus all tool results it requested.
        // Refresh here so the context meter advances between autonomous tool turns
        // without polling on every streaming token delta.
        scheduleLiveContextRefresh();
        return;

      case "agent_start":
        backgroundRunStartedRef.current = true;
        setStreamingState(true);
        scheduleLiveContextRefresh(true);
        setGenerationStatus("Composing");
        scheduleScrollToBottom();
        return;

      case "agent_end": {
        const willRetry = Boolean(record.willRetry);
        if (willRetry) {
          // message_end arrives before Pi decides whether this failed provider
          // attempt will enter the ordinary auto-retry path. Once agent_end says
          // yes, the Retry block owns presentation of that attempt.
          pendingAssistantErrorRef.current = null;
          providerAbortPendingRef.current = false;
          setStreamingState(true);
          setGenerationStatus("Retrying");
        }
        // willRetry=false is still not a universal terminal boundary: Pi may
        // recover a context overflow through compaction or continue from a
        // before-settle extension boundary. Keep the error buffered until
        // agent_settled unless a later successful assistant message replaces it.
        return;
      }

      case "auto_retry_start": {
        // The preceding assistant error was a retry attempt, not the terminal
        // result of the user's turn. Keep it represented by the retry block.
        pendingAssistantErrorRef.current = null;
        const attempt = Number(record.attempt ?? 1);
        const maxAttempts = Number(record.maxAttempts ?? attempt);
        const delayMs = Number(record.delayMs ?? 0);
        const delay = formatRetryDelay(delayMs);
        const errorMessage = String(record.errorMessage ?? "Transient provider error.");
        const statusText = `Retrying ${attempt}/${maxAttempts}${delay ? ` in ${delay}` : ""}`;

        setStreamingState(true);
        setGenerationStatus(statusText);

        if (activeRetryId.current) {
          patchItem(activeRetryId.current, {
            title: `Retry ${attempt}/${maxAttempts}${delay ? ` · ${delay}` : ""}`,
            text: errorMessage,
            state: "running",
          });
        } else {
          activeRetryId.current = append({
            kind: "retry",
            title: `Retry ${attempt}/${maxAttempts}${delay ? ` · ${delay}` : ""}`,
            text: errorMessage,
            state: "running",
          });
          retryNoticeIdsRef.current.add(activeRetryId.current);
        }
        scheduleScrollToBottom();
        return;
      }

      case "auto_retry_end": {
        const attempt = Number(record.attempt ?? 0);
        const success = Boolean(record.success);
        const id = activeRetryId.current;

        if (success) {
          // Retry notices describe a transient connectivity problem. Once Pi
          // recovers, remove the notice rather than retaining a "recovered"
          // event in the conversation (also handles stale async retry ends).
          dismissRetryNotices();
        } else if (id) {
          patchItem(id, (item) => ({
            title: `Retry failed${attempt ? ` after ${attempt} attempt${attempt === 1 ? "" : "s"}` : ""}`,
            text: String(record.finalError ?? item.text ?? "Retry failed."),
            state: "error",
          }));
        } else {
          const failedId = append({
            kind: "retry", title: "Retry failed",
            text: String(record.finalError ?? "Retry failed."), state: "error",
          });
          retryNoticeIdsRef.current.add(failedId);
        }

        activeRetryId.current = null;
        pendingAssistantErrorRef.current = null;
        setGenerationStatus(success ? "Composing" : "Retry failed");
        scheduleScrollToBottom();
        return;
      }

      case "summarization_retry_scheduled": {
        const attempt = Number(record.attempt ?? 1);
        const maxAttempts = Number(record.maxAttempts ?? attempt);
        const delayMs = Number(record.delayMs ?? 0);
        const delay = formatRetryDelay(delayMs);
        const id = append({
          kind: "retry",
          title: `Summary retry ${attempt}/${maxAttempts}${delay ? ` · ${delay}` : ""}`,
          text: String(record.errorMessage ?? "Summarization request failed temporarily."),
          state: "running",
        });
        activeSummarizationRetryId.current = id;
        retryNoticeIdsRef.current.add(id);
        setStreamingState(true);
        setGenerationStatus(`Retrying summary ${attempt}/${maxAttempts}${delay ? ` in ${delay}` : ""}`);
        scheduleScrollToBottom();
        return;
      }

      case "summarization_retry_attempt_start":
        setStreamingState(true);
        setGenerationStatus(record.source === "branchSummary" ? "Retrying branch summary" : "Retrying compaction summary");
        return;

      case "summarization_retry_finished":
        if (activeSummarizationRetryId.current) {
          const finishedRetryId = activeSummarizationRetryId.current;
          if (record.success === false) {
            patchItem(finishedRetryId, { title: "Summary retry failed", text: String(record.errorMessage ?? "Summary retry failed."), state: "error" });
          } else {
            updateItems((current) => current.filter((item) => item.id !== finishedRetryId));
            retryNoticeIdsRef.current.delete(finishedRetryId);
          }
          activeSummarizationRetryId.current = null;
        }
        setGenerationStatus("Composing");
        return;

      case "agent_settled": {
        cancelScheduledLiveContextRefresh();
        const providerAbortNeedsReconcile = providerAbortPendingRef.current;

        if (providerAbortNeedsReconcile) {
          markRunningRuntimeInterrupted();
          setGenerationStatus("Synchronizing interrupted turn");
        } else {
          setGenerationStatus(null);
          if (thinkingId.current) patchItem(thinkingId.current, { state: "done" });
        }

        // Compatibility fallback: modern Pi emits auto_retry_end for exhausted
        // retries. If an older/runtime edge case settles with the retry block
        // still active, finalize that block instead of dropping the provider
        // error. Otherwise surface a pending non-retryable terminal error now.
        if (pendingAssistantErrorRef.current && activeRetryId.current) {
          patchItem(activeRetryId.current, {
            title: "Retry failed",
            text: pendingAssistantErrorRef.current,
            state: "error",
          });
          pendingAssistantErrorRef.current = null;
          activeRetryId.current = null;
        } else {
          surfacePendingAssistantError({
            retryActivityActive: false,
            interruptInFlight: Boolean(interruptInFlightRef.current),
          });
        }
        // On settlement, do not leave an in-progress retry spinner behind.
        // Terminal failures remain visible; successful recoveries have already
        // dismissed their tracked notice IDs on message_start/auto_retry_end.
        if (activeRetryId.current) {
          const staleRetryId = activeRetryId.current;
          updateItems((current) => current.filter((item) => item.id !== staleRetryId || item.state === "error"));
          retryNoticeIdsRef.current.delete(staleRetryId);
          activeRetryId.current = null;
        }
        retryNoticeIdsRef.current.clear();
        const followWasActive = shouldAutoScroll.current;
        flushFrozenTranscriptAtSettle();
        // queue_update owns the queue across turn settlement (follow-ups can remain pending).

        if (providerAbortNeedsReconcile) {
          backgroundRunStartedRef.current = false;
          // Keep the run/input blocked until Pi state, full display history and
          // model-visible history have all been reconciled. A provider abort is
          // terminal for the current turn even if normal tool/thinking end events
          // never arrived.
          void reconcileProviderAbortAfterSettlement().finally(() => {
            if (followWasActive) {
              window.requestAnimationFrame(() => scheduleScrollToBottom(false));
            }
          });
          return;
        }

        const hadActiveResponse = backgroundRunStartedRef.current;
        backgroundRunStartedRef.current = false;
        // Desktop notifications are an opt-in and only fire once for a genuine
        // completion while the native Molten Forge window is not focused.
        if (notifyWhenBackground && hadActiveResponse && !interruptInFlightRef.current) {
          void (async () => {
            try {
              const focused = await getCurrentWindow().isFocused();
              if (!shouldNotifyForSettledRun({
                enabled: notifyWhenBackground,
                started: hadActiveResponse,
                interrupted: Boolean(interruptInFlightRef.current),
                providerAborted: providerAbortNeedsReconcile,
                focused,
              })) return;
              if (await isPermissionGranted()) {
                sendNotification({ title: "Molten Forge", body: "Pi has finished responding." });
              }
            } catch (error) { console.warn("Completion notification unavailable", error); }
          })();
        }

        // agent_settled is Pi's real end-of-task boundary. Keep streaming true
        // until all final authoritative item patches above have landed, then
        // let the old Molten Forge lerp settle once more if follow stayed active.
        setStreamingState(false);
        if (followWasActive) {
          window.requestAnimationFrame(() => scheduleScrollToBottom(false));
        }
        resetTransientRuntime();
        void refreshSessions(lastCwd.current || cwd);
        void sendRecord({ type: "get_state" }, { silent: true }).catch(() => {});
        void sendRecord({ type: "get_session_stats" }, { silent: true }).catch(() => {});
        return;
      }

      case "message_start": {
        if (record.message?.role === "user") {
          // Pi emits this for both the initial prompt and messages delivered
          // from its steer/follow-up queues. The initial prompt was already
          // rendered optimistically; queued prompts were not. The event is
          // authoritative for when a queued message becomes a chat turn.
          if (userMessageDeliveryRef.current.shouldAppendDeliveredMessage()) {
            const visible = extractVisibleContent(record.message.content);
            const delivered = parseAttachmentPrompt(visible);
            if (delivered.text || delivered.attachments.length) {
              append({ kind: "user", ...delivered });
              scheduleScrollToBottom();
            }
          }
          return;
        }
        if (record.message?.role === "assistant") {
          // A successful reconnect can produce a fresh assistant message before
          // older Pi builds send auto_retry_end. Remove that transient notice;
          // a subsequent failed attempt will create another notice if needed.
          dismissRetryNotices();
          // A later assistant message means Pi recovered/continued the same run
          // after an earlier provider abort (for example through compaction or
          // retry). Do not treat that earlier attempt as the final settlement.
          providerAbortPendingRef.current = false;
          assistantId.current = null;
          thinkingId.current = null;
          toolCallByContentIndex.current.clear();
          activeToolBatchId.current = uid("tool-batch");
          setGenerationStatus("Composing");
        }
        return;
      }

      case "message_update": {
        const update = record.assistantMessageEvent;
        if (update?.type === "text_start") {
          if (thinkingId.current && shouldFinalizeThinkingForAssistantEvent(update.type)) {
            patchItem(thinkingId.current, { state: "done" });
          }
          setGenerationStatus("Writing");
        } else if (update?.type === "text_delta" && typeof update.delta === "string") {
          if (thinkingId.current && shouldFinalizeThinkingForAssistantEvent(update.type)) {
            patchItem(thinkingId.current, { state: "done" });
          }
          setGenerationStatus("Writing");
          if (!assistantId.current) assistantId.current = append({ kind: "assistant", text: "" });
          patchItem(assistantId.current, (item) => ({ text: item.text + update.delta }));
        } else if (update?.type === "text_end") {
          if (thinkingId.current && shouldFinalizeThinkingForAssistantEvent(update.type)) {
            patchItem(thinkingId.current, { state: "done" });
          }
          if (typeof update.content === "string") {
            if (assistantId.current) patchItem(assistantId.current, { text: update.content });
            else if (update.content) assistantId.current = append({ kind: "assistant", text: update.content });
          }
        } else if (update?.type === "thinking_delta" && typeof update.delta === "string") {
          setGenerationStatus("Thinking");
          if (!thinkingId.current) thinkingId.current = append({ kind: "thinking", title: "Thinking", text: "", state: "running" });
          patchItem(thinkingId.current, (item) => ({ text: item.text + update.delta, state: "running" }));
        } else if (update?.type === "thinking_end" && thinkingId.current) {
          setGenerationStatus("Composing");
          patchItem(thinkingId.current, {
            text: typeof update.content === "string" ? update.content : undefined,
            state: "done",
          });
        } else if (update?.type === "toolcall_start") {
          if (thinkingId.current && shouldFinalizeThinkingForAssistantEvent(update.type)) patchItem(thinkingId.current, { state: "done" });
          setGenerationStatus("Preparing tool");
          const toolCallId = String(update.id ?? `stream-${update.contentIndex}`);
          const toolName = String(update.toolName ?? "tool");
          const id = `tool-${toolCallId}`;
          toolCallByContentIndex.current.set(Number(update.contentIndex), toolCallId);
          toolArgsById.current.set(toolCallId, { toolName, args: {} });
          updateItems((current) => {
            const existing = current.find((item) => item.id === id);
            if (existing) return current.map((item) => item.id === id ? { ...item, title: toolName, state: "running" } : item);
            return [...current, { id, kind: "tool", title: toolName, text: "", toolInput: "", toolOutput: "", toolCallId, toolBatchId: activeToolBatchId.current ?? undefined, toolExecutionStarted: false, state: "running" }];
          });
        } else if (update?.type === "toolcall_delta" && typeof update.delta === "string") {
          if (thinkingId.current && shouldFinalizeThinkingForAssistantEvent(update.type)) patchItem(thinkingId.current, { state: "done" });
          setGenerationStatus("Preparing tool");
          const toolCallId = toolCallByContentIndex.current.get(Number(update.contentIndex));
          if (toolCallId) patchItem(`tool-${toolCallId}`, (item) => ({ toolInput: (item.toolInput ?? item.text) + update.delta, text: "", state: "running" }));
        } else if (update?.type === "toolcall_end") {
          if (thinkingId.current && shouldFinalizeThinkingForAssistantEvent(update.type)) patchItem(thinkingId.current, { state: "done" });
          setGenerationStatus("Preparing tool");
          const toolCall = update.toolCall ?? {};
          const toolCallId = String(toolCall.id ?? toolCallByContentIndex.current.get(Number(update.contentIndex)) ?? `stream-${update.contentIndex}`);
          const toolName = String(toolCall.name ?? "tool");
          const args = toolCall.arguments ?? {};
          toolCallByContentIndex.current.set(Number(update.contentIndex), toolCallId);
          toolArgsById.current.set(toolCallId, { toolName, args });
          const id = `tool-${toolCallId}`;
          updateItems((current) => {
            const toolInput = formatToolArgs(toolName, args);
            const existing = current.find((item) => item.id === id);
            const toolDiff = /^edit$/i.test(toolName) ? previewEditDiff(args) : undefined;
            if (existing) return current.map((item) => item.id === id ? { ...item, title: toolName, text: "", toolInput, toolArgs: args, toolDiff: toolDiff ?? item.toolDiff, toolCallId, toolBatchId: item.toolBatchId ?? activeToolBatchId.current ?? undefined, toolExecutionStarted: item.toolExecutionStarted ?? false, state: "running" } : item);
            return [...current, { id, kind: "tool", title: toolName, text: "", toolInput, toolOutput: "", toolArgs: args, toolDiff, toolCallId, toolBatchId: activeToolBatchId.current ?? undefined, toolExecutionStarted: false, state: "running" }];
          });
        }
        return;
      }

      case "message_end": {
        if (record.message?.role === "assistant") {
          const providerAbort = isProviderAbortMessage(record.message);
          const abortTerminal = isAssistantAbortTerminal(record.message);
          setGenerationStatus(abortTerminal ? "Interrupted" : "Composing");
          const text = extractText(record.message);
          if (assistantId.current && text) patchItem(assistantId.current, { text });
          else if (text) assistantId.current = append({ kind: "assistant", text });

          if (abortTerminal) {
            // A provider-side abort can terminate the assistant message without
            // emitting thinking_end/tool_execution_end. Stop all live chrome now
            // while preserving whatever partial input/output has already arrived.
            markRunningRuntimeInterrupted();
            providerAbortPendingRef.current = providerAbort;
          } else if (thinkingId.current) {
            patchItem(thinkingId.current, { state: "done" });
          }

          // Pi's prompt RPC acknowledgement only means the prompt was accepted.
          // Provider failures arrive later as finalized assistant messages. Hold
          // the error until agent_end tells us whether Pi will retry it.
          pendingAssistantErrorRef.current = assistantErrorMessage(record.message);
        }
        return;
      }

      case "tool_execution_start": {
        if (thinkingId.current) patchItem(thinkingId.current, { state: "done" });
        setGenerationStatus("Waiting for tool");
        const toolCallId = String(record.toolCallId);
        const toolName = String(record.toolName ?? "tool");
        const args = record.args ?? toolArgsById.current.get(toolCallId)?.args ?? {};
        const id = `tool-${toolCallId}`;
        toolArgsById.current.set(toolCallId, { toolName, args });
        updateItems((current) => {
          const toolInput = formatToolArgs(toolName, args);
          const existing = current.find((item) => item.id === id);
          const toolDiff = /^edit$/i.test(toolName) ? previewEditDiff(args) : undefined;
          if (existing) return current.map((item) => item.id === id ? { ...item, title: toolName, text: "", toolInput, toolArgs: args, toolDiff: toolDiff ?? item.toolDiff, toolCallId, toolBatchId: item.toolBatchId ?? activeToolBatchId.current ?? undefined, toolExecutionStarted: true, state: "running" } : item);
          return [...current, { id, kind: "tool", title: toolName, text: "", toolInput, toolOutput: "", toolArgs: args, toolDiff, toolCallId, toolBatchId: activeToolBatchId.current ?? undefined, toolExecutionStarted: true, state: "running" }];
        });
        return;
      }

      case "tool_execution_update": {
        const toolCallId = String(record.toolCallId);
        const id = `tool-${toolCallId}`;
        const meta = toolArgsById.current.get(toolCallId);
        const toolName = String(record.toolName ?? meta?.toolName ?? "tool");
        const args = record.args ?? meta?.args ?? {};
        const output = extractToolResultText(record.partialResult);
        patchItem(id, (item) => ({
          text: "",
          toolInput: formatToolArgs(toolName, args),
          toolArgs: args,
          toolDiff: (/^edit$/i.test(toolName) ? previewEditDiff(args) : undefined) ?? item.toolDiff,
          toolOutput: mergeStreamingToolOutput(item.toolOutput ?? "", output),
          toolResultDetails: record.partialResult?.details ?? item.toolResultDetails,
          toolExecutionStarted: true,
          state: "running",
        }));
        return;
      }

      case "tool_execution_end": {
        const toolCallId = String(record.toolCallId);
        const id = `tool-${toolCallId}`;
        const meta = toolArgsById.current.get(toolCallId);
        const toolName = String(record.toolName ?? meta?.toolName ?? "tool");
        const args = meta?.args ?? {};
        const output = extractToolResultText(record.result);
        const resultDiff = toolDiffFromResult(toolName, args, record.result?.details, Boolean(record.isError));
        patchItem(id, (item) => ({
          title: toolName,
          text: "",
          toolInput: formatToolArgs(toolName, args),
          toolArgs: args,
          toolDiff: record.isError ? resultDiff : (resultDiff ?? item.toolDiff),
          toolOutput: output || item.toolOutput || "",
          toolResultDetails: record.result?.details ?? item.toolResultDetails,
          toolExecutionStarted: true,
          state: item.state === "interrupted"
            ? "interrupted"
            : record.isError
              ? "error"
              : "done",
        }));
        setGenerationStatus("Composing");
        return;
      }

      case "bash_execution_update": {
        const requestId = String(record.id ?? "direct");
        const id = `bash-${requestId}`;
        const command = directBashCommands.current.get(requestId) ?? "";
        updateItems((current) => {
          const existing = current.find((item) => item.id === id);
          if (existing) return current.map((item) => item.id === id ? { ...item, text: "", toolInput: item.toolInput || command, toolOutput: (item.toolOutput ?? item.text) + (record.delta ?? ""), toolExecutionStarted: true } : item);
          return [...current, { id, kind: "tool", title: "shell", text: "", toolInput: command, toolOutput: record.delta ?? "", toolExecutionStarted: true, state: "running" }];
        });
        return;
      }

      case "queue_update":
        setPiQueue(normalizePiQueue(record));
        return;

      case "entry_appended":
        // Custom/session metadata changed outside the normal assistant stream.
        // Keep the sidebar current without replacing a transcript the user may be reading.
        void refreshSessions(lastCwd.current || cwd);
        return;

      case "session_info_changed":
        setActiveSessionName(typeof record.name === "string" ? record.name : null);
        void refreshSessions(lastCwd.current || cwd);
        return;

      case "thinking_level_changed":
        if (typeof record.level === "string") setCurrentThinking(record.level);
        return;

      case "ui_prompt_start":
        setGenerationStatus("Waiting for input");
        return;

      case "ui_prompt_end":
        setExtensionDialog(null);
        setDialogValue("");
        setGenerationStatus((current) => current === "Waiting for input" ? (isStreamingRef.current ? "Composing" : null) : current);
        return;

      case "extension_ui_request":
        if (extensionUiBlocksAgent(record.method)) setGenerationStatus("Waiting for input");
        handleExtensionUi(record);
        return;

      case "extension_error":
        append({ kind: "error", title: "Extension error", text: record.error ?? pretty(record) });
        return;

      default:
        console.debug("[Pi RPC] Unhandled record", record);
        return;
    }
  }

  function handleExtensionUi(record: Json) {
    if (["select", "confirm", "input", "editor"].includes(record.method)) {
      setDialogValue(record.prefill ?? "");
      setExtensionDialog(record as ExtensionDialog);
      return;
    }

    if (record.method === "notify") {
      const message = typeof record.message === "string" ? record.message : "";
      const kind = record.notifyType === "error" || record.notifyType === "warning" ? record.notifyType : "info";
      if (message) setExtensionNotice({ id: String(record.id ?? crypto.randomUUID()), message, kind });
    } else if (record.method === "setStatus") {
      setStatus((current) => {
        const next = { ...current };
        if (record.statusText) next[record.statusKey] = record.statusText;
        else delete next[record.statusKey];
        return next;
      });
    } else if (record.method === "setTitle" && record.title) {
      document.title = record.title;
    } else if (record.method === "set_editor_text") {
      composerDraftSetterRef.current(record.text ?? "");
    } else if (record.method === "setWidget") {
      const update = normalizeExtensionWidget(record);
      if (!update) return;
      setExtensionWidgets((current) => {
        const next = { ...current };
        if (update.lines === null) delete next[update.key];
        else next[update.key] = { key: update.key, placement: update.placement, lines: update.lines };
        return next;
      });
    }
  }

  function isEarlyPiProcessExit(error: unknown): boolean {
    const message = String(error);
    return (
      message.includes("Pi process exited")
      || message.includes("Pi process stopped")
      || message.includes("Pi is not running")
      || message.includes("Pi readiness handshake failed")
    );
  }

  async function startPiAndSync(workingDirectory: string, useDiffExtension: boolean): Promise<void> {
    const startResult = await invoke<Json>("start_pi", {
      cwd: workingDirectory,
      approve_project: true,
      use_diff_extension: useDiffExtension,
    });
    if (typeof startResult?.pid === "number") activePiPidRef.current = startResult.pid;

    const ready = await sendRecordAndWait({ type: "get_state" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
    if (!ready.success) throw new Error(String(ready.error ?? "Pi readiness handshake failed."));
    const responses = await Promise.all([
      sendRecordAndWait({ type: "get_commands" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS),
      sendRecordAndWait({ type: "get_available_models" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS),
      sendRecordAndWait({ type: "get_session_stats" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS),
      requestHistorySnapshot(HISTORY_SYNC_TIMEOUT_MS),
    ]);
    for (const response of responses) {
      if (!response.success) throw new Error(String(response.error ?? `${response.command ?? "Pi initialization"} failed.`));
    }
  }

  async function connect(workingDirectory = cwd, initialSessions?: SessionInfo[]): Promise<boolean> {
    setConnecting(true);
    setStartupError(null);
    recentPiStderrRef.current = [];
    let diffExtensionDisabled = false;
    try {
      lastCwd.current = workingDirectory;
      setCwd(workingDirectory);
      setHistoryLoading(true);
      setSessionsLoading(true);
      setSessionsError(false);
      itemsRef.current = [];
      setItems([]);
      frozenTranscriptItemsRef.current = null;
      setFrozenTranscriptItems(null);
      setAutoScrollMode(true);
      clearReaderScrollLock();

      try {
        await startPiAndSync(workingDirectory, true);
      } catch (firstError) {
        if (!isEarlyPiProcessExit(firstError)) throw firstError;

        // Structured file diffs are optional UI metadata. They must never make
        // the entire Pi RPC runtime unavailable. Retry once without the bundled
        // extension if Pi exits during startup/handshake.
        const extensionStderr = [...recentPiStderrRef.current];
        console.warn(
          "Pi exited while loading the Molten Forge diff extension; retrying without it.",
          firstError,
          extensionStderr.join("\n"),
        );
        rejectPendingRpcResponses("Retrying Pi without the optional diff extension.");
        await invoke("stop_pi").catch(() => {});
        recentPiStderrRef.current = [];
        await startPiAndSync(workingDirectory, false);
        diffExtensionDisabled = true;
      }

      persistWorkingDirectory(workingDirectory);
      rememberProject(workingDirectory);
      setConnected(true);
      if (diffExtensionDisabled) {
        append({
          kind: "error",
          title: "File diff preview disabled",
          text: "Pi started successfully, but the optional Molten Forge edit/write diff extension could not be loaded. Chat and tools remain available; Write diff previews and some Edit metadata will fall back to the raw/native Pi view for this session.",
        });
      }
      if (initialSessions) {
        setSessions(initialSessions);
        setSessionsError(false);
        // A project switch is not complete until its chosen chat is restored.
        // Keep one uninterrupted loading phase across connect + resync.
        if (!projectSwitchInFlightRef.current) setSessionsLoading(false);
      } else {
        await refreshSessions(workingDirectory);
      }
      return true;
    } catch (error) {
      const stderrTail = recentPiStderrRef.current.join("\n");
      const detail = stderrTail ? `${String(error)}\n\nPi stderr:\n${stderrTail}` : String(error);
      const message = `Could not start Pi: ${detail}`;
      setStartupError(message);
      rejectPendingRpcResponses(message);
      await invoke("stop_pi").catch(() => {});
      setConnected(false);
      setStreamingState(false);
      if (!projectSwitchInFlightRef.current) setSessionsLoading(false);
      return false;
    } finally {
      setHistoryLoading(false);
      setConnecting(false);
    }
  }

  async function abortDirectBash() {
    if (!directBashRunningRef.current) return;
    const response = await sendRecordAndWait({ type: "abort_bash" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
    if (!response.success) throw new Error(String(response.error ?? "Pi rejected abort_bash."));
  }

  async function disconnect() {
    if (isStreamingRef.current && !(await interruptGeneration())) return;
    cancelScheduledLiveContextRefresh();
    if (directBashRunningRef.current) await abortDirectBash().catch((error) => console.warn("Could not abort direct Pi bash before shutdown", error));
    try {
      await invoke("stop_pi");
    } finally {
      rejectPendingRpcResponses("Pi was disconnected.");
      inputBlockCountRef.current = 0;
      directBashCommands.current.clear();
      setInputBlocked(false);
      setBashRunningState(false);
      setConnected(false);
      setHistoryLoading(false);
      frozenTranscriptItemsRef.current = null;
      setFrozenTranscriptItems(null);
      setStreamingState(false);
      setGenerationStatus(null);
      setCurrentModel(null);
      setActiveSessionPath(null);
      setActiveSessionName(null);
      setSessionStats(null);
      setPostCompactionContextEstimate(null);
      setContextBreakdown(null);
      setStatus({});
      setExtensionWidgets({});
      setExtensionNotice(null);
    }
  }

  async function restartPi() {
    if (isStreamingRef.current && !(await interruptGeneration())) return;
    cancelScheduledLiveContextRefresh();
    if (directBashRunningRef.current) await abortDirectBash().catch(() => {});
    let sessionToRestore = activeSessionPath;
    try {
      const stateResponse = await sendRecordAndWait({ type: "get_state" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
      if (stateResponse.success && typeof stateResponse.data?.sessionFile === "string") sessionToRestore = stateResponse.data.sessionFile;
    } catch (error) {
      console.warn("Could not capture active Pi session before reload", error);
    }

    beginInputBlock();
    try {
      await invoke("stop_pi").catch(() => {});
      rejectPendingRpcResponses("Pi restarted.");
      setConnected(false);
      frozenTranscriptItemsRef.current = null;
      setFrozenTranscriptItems(null);
      setStreamingState(false);
      setBashRunningState(false);
      setGenerationStatus(null);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const connectedAgain = await connect(lastCwd.current || cwd);
      if (connectedAgain && sessionToRestore) await switchSessionAndResync(sessionToRestore);
    } finally {
      endInputBlock();
    }
  }

  async function switchToProject(selected: string, targetSession?: SessionInfo, fresh = false) {
    if (!selected.trim() || projectSwitchInFlightRef.current ||
      (!fresh && connected && projectKeyForSidebar(selected) === projectKeyForSidebar(cwd))) return;
    projectSwitchInFlightRef.current = true;
    await executeProjectSwitch(
      {
        project: selected,
        connected,
        busy: connected && (isStreamingRef.current || directBashRunningRef.current),
        fresh,
        targetSession,
        lastSelected: lastProjectSessionsRef.current,
      },
      {
        preflight: {
          directoryExists: (path) => invoke<boolean>("project_directory_exists", { path }),
          confirmStop: () => window.confirm("Pi is still working. Stop the current operation and switch projects?"),
          listSessions: (project) => invoke<SessionInfo[]>("list_sessions", { cwd: project }),
          beginSwitch: () => {
            setMissingProjectPath(null);
            setStartupError(null);
            // Selecting a chat never changes session ordering by activity.
            saveProjectSelection(lastCwd.current || cwd, activeSessionPath);
            setSwitchingFolder(true);
            setSessionsLoading(true);
            setSessionsError(false);
          },
        },
        onMissing: (path) => {
          setMissingProjectPath(path);
          setExtensionNotice({
            id: crypto.randomUUID(),
            kind: "error",
            message: `Project folder no longer exists: ${path}. Your current session remains open. Use Open Folder beside PROJECTS to choose the new location.`,
          });
        },
        onCancelled: () => setMissingProjectPath(null),
        beginInputBlock,
        endInputBlock,
        isStreaming: () => isStreamingRef.current,
        interruptGeneration,
        cancelScheduledLiveContextRefresh,
        isDirectBashRunning: () => directBashRunningRef.current,
        abortDirectBash,
        stopPi: async () => { await invoke("stop_pi"); },
        resetAfterStop: () => {
          rejectPendingRpcResponses("Pi working directory changed.");
          frozenTranscriptItemsRef.current = null;
          setFrozenTranscriptItems(null);
          setStreamingState(false);
          setBashRunningState(false);
          setGenerationStatus(null);
          setCurrentModel(null);
          setActiveSessionPath(null);
          setActiveSessionName(null);
          setSessionStats(null);
          setPostCompactionContextEstimate(null);
          setContextBreakdown(null);
          itemsRef.current = [];
          setItems([]);
          setSessions([]);
        },
        setDirectory: setCwd,
        connect,
        syncFreshSession: async () => {
          await resyncActiveSession(true);
          await restorePreferredModel();
        },
        rememberFreshSession: () => saveProjectSelection(selected, null),
        restoreSession: (path) => switchSessionAndResync(path),
        onRestoreCancelled: () => setStartupError("Pi cancelled restoring the selected conversation."),
        onFailure: (error) => {
          const message = `Could not switch project: ${String(error)}`;
          setStartupError(message);
          if (connected) setExtensionNotice({ id: crypto.randomUUID(), kind: "error", message });
        },
        onFinish: () => {
          setSessionsLoading(false);
          setSwitchingFolder(false);
          projectSwitchInFlightRef.current = false;
        },
      },
    );
  }

  // Restore the previous working directory on startup without ever showing a
  // separate launcher. The one-shot guard also prevents retry loops if a saved
  // project directory was renamed or the Pi runtime is unavailable.
  const startupRestoreStartedRef = useRef(false);
  useEffect(() => {
    if (appInitializing || startupRestoreStartedRef.current) return;
    startupRestoreStartedRef.current = true;
    const previousDirectory = getStoredWorkingDirectory();
    if (previousDirectory && !connected) void switchToProject(previousDirectory);
  }, [appInitializing]);

  async function newSessionInProject(project: string) {
    if (projectSwitchInFlightRef.current) return;
    if (connected && projectKeyForSidebar(project) === projectKeyForSidebar(cwd)) {
      try {
        await startNewSession();
      } catch (error) {
        setExtensionNotice({ id: crypto.randomUUID(), kind: "error", message: `Could not create session: ${String(error)}` });
      }
      return;
    }
    await switchToProject(project, undefined, true);
  }

  async function chooseFolder() {
    try {
      const selected = await invoke<string | null>("pick_folder", { initial: cwd || null });
      if (selected) await switchToProject(selected);
    } catch (error) {
      const message = `Could not open folder picker: ${String(error)}`;
      setStartupError(message);
      setExtensionNotice({ id: crypto.randomUUID(), kind: "error", message });
    }
  }

  async function openSession(session: SessionInfo) {
    if (isStreamingRef.current || directBashRunningRef.current || inputBlocked || session.path === activeSessionPath) return;
    frozenTranscriptItemsRef.current = null;
    setFrozenTranscriptItems(null);
    setAutoScrollMode(true);
    clearReaderScrollLock();
    try {
      const switched = await switchSessionAndResync(session.path);
      if (switched) saveProjectSelection(cwd, session.path);
      else append({ kind: "system", text: "Session switch was cancelled by a Pi extension." });
    } catch (error) {
      append({ kind: "error", text: `Could not switch Pi session: ${String(error)}` });
    }
  }

  async function startNewSession() {
    if (isStreamingRef.current || directBashRunningRef.current || inputBlocked) return;
    frozenTranscriptItemsRef.current = null;
    setFrozenTranscriptItems(null);
    setAutoScrollMode(true);
    clearReaderScrollLock();
    beginInputBlock();
    const id = `mf-new-${crypto.randomUUID()}`;
    managedSessionMutationIds.current.add(id);
    try {
      const response = await sendRecordAndWait({ id, type: "new_session" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
      if (!response.success) throw new Error(String(response.error ?? "Pi rejected new_session."));
      if (response.data?.cancelled) return;
      await resyncActiveSession(true);
      await restorePreferredModel();
    } finally {
      managedSessionMutationIds.current.delete(id);
      endInputBlock();
    }
  }

  async function forkSession(entryId: string) {
    beginInputBlock();
    const id = `mf-fork-${crypto.randomUUID()}`;
    managedSessionMutationIds.current.add(id);
    try {
      const response = await sendRecordAndWait({ id, type: "fork", entryId }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
      if (!response.success) throw new Error(String(response.error ?? "Pi rejected fork."));
      if (response.data?.cancelled) return;
      if (typeof response.data?.text === "string") composerDraftSetterRef.current((current) => mergeRecoveredPrompt(current, response.data.text));
      await resyncActiveSession(true);
      await restorePreferredModel();
    } finally {
      managedSessionMutationIds.current.delete(id);
      endInputBlock();
    }
  }

  async function cloneSession() {
    beginInputBlock();
    const id = `mf-clone-${crypto.randomUUID()}`;
    managedSessionMutationIds.current.add(id);
    try {
      const response = await sendRecordAndWait({ id, type: "clone" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
      if (!response.success) throw new Error(String(response.error ?? "Pi rejected clone."));
      if (response.data?.cancelled) return;
      await resyncActiveSession(true);
      await restorePreferredModel();
    } finally {
      managedSessionMutationIds.current.delete(id);
      endInputBlock();
    }
  }

  async function runDirectBash(command: string, excludeFromContext: boolean) {
    const shellCommand = command.trim();
    if (!shellCommand) return;
    if (directBashRunningRef.current || isStreamingRef.current) return;
    armExplicitBottomFollow();
    beginInputBlock();
    setBashRunningState(true);
    const id = `mf-bash-${crypto.randomUUID()}`;
    directBashCommands.current.set(id, shellCommand);
    try {
      const response = await sendRecordAndWait(
        { id, type: "bash", command: shellCommand, ...(excludeFromContext ? { excludeFromContext: true } : {}) },
        { silent: true },
        24 * 60 * 60 * 1000,
      );
      if (!response.success) throw new Error(String(response.error ?? "Pi rejected bash."));
    } finally {
      directBashCommands.current.delete(id);
      setBashRunningState(false);
      endInputBlock();
    }
  }

  // Centralize attachment metadata and Pi image payload preparation for both
  // initial prompts and queued steering/follow-up prompts.
  async function preparePromptPayload(raw: string, attachments: ManagedAttachment[]) {
    const message = composeAttachmentPrompt(raw, attachments);
    const matchingModel = models.find((model) => model.provider === currentModel?.provider && model.id === currentModel?.id);
    const images = (supportsImageInput(currentModel) || supportsImageInput(matchingModel)) ? await Promise.all(
      attachments.filter((attachment) => attachment.kind === "image").map(async (attachment) => ({
        type: "image" as const,
        data: uint8ToBase64(Uint8Array.from(await invoke<number[]>("read_attachment_bytes", { attachmentPath: attachment.path }))),
        mimeType: attachment.mimeType,
      })),
    ) : [];
    return { message, ...(images.length ? { images } : {}) };
  }

  async function submitPrompt(raw: string, mayCompleteWithoutAgentRun = false, attachments: ManagedAttachment[] = []) {
    if (isStreamingRef.current || directBashRunningRef.current || inputBlockCountRef.current > 0) return;
    armExplicitBottomFollow();
    userMessageDeliveryRef.current.noteLocallyRenderedPrompt();
    append({ kind: "user", text: raw, attachments });
    setStreamingState(true);
    setGenerationStatus("Submitting");
    try {
      const payload = await preparePromptPayload(raw, attachments);
      const response = await sendRecordAndWait({ type: "prompt", ...payload }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
      if (!response.success) throw new Error(String(response.error ?? "Pi rejected prompt before acceptance."));
      if (mayCompleteWithoutAgentRun) {
        const stateResponse = await sendRecordAndWait({ type: "get_state" }, { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
        if (!stateResponse.success) throw new Error(String(stateResponse.error ?? "Could not synchronize Pi after extension command."));
      }
    } catch (error) {
      userMessageDeliveryRef.current.reset();
      flushFrozenTranscriptAtSettle();
      setStreamingState(false);
      setGenerationStatus(null);
      try { await resyncActiveSession(false); } catch {}
      throw error;
    }
  }

  async function submitRaw(rawValue: string, attachments: ManagedAttachment[] = [], deliveryMode: QueueDelivery = "steer") {
    const raw = rawValue.trim();
    if ((!raw && !attachments.length) || !connected) return;
    if (raw === "/abort") { await interruptGeneration(); return; }
    if (directBashRunningRef.current || inputBlockCountRef.current > 0) return false;
    if (isStreamingRef.current) {
      try {
        // Pi is the source of truth for queuing and for user-message rendering.
        // Do not append this to the transcript before Pi actually delivers it.
        const payload = await preparePromptPayload(raw, attachments);
        const response = await sendRecordAndWait({ type: "prompt", ...payload,
          streamingBehavior: sendBehavior(true, deliveryMode) },
          { silent: true }, INTERRUPT_SYNC_TIMEOUT_MS);
        if (!response.success) throw new Error(String(response.error ?? "Pi rejected queued message."));
        return true;
      } catch (error) {
        // Return false so Composer restores both the text and staged attachments.
        console.warn("Could not queue Pi message", error);
        return false;
      }
    }
    try {
      if (attachments.length) { await submitPrompt(raw, false, attachments); return true; }
      if (raw.startsWith("!!")) { await runDirectBash(raw.slice(2), true); return; }
      if (raw.startsWith("!")) { await runDirectBash(raw.slice(1), false); return; }
      if (raw.startsWith("/")) { await runSlashCommand(raw); return; }
      await submitPrompt(raw);
    } catch (error) {
      append({ kind: "error", text: String(error) });
      return false;
    }
  }

  async function runSlashCommand(raw: string) {
    armExplicitBottomFollow();
    const body = raw.slice(1);
    const space = body.indexOf(" ");
    const name = (space === -1 ? body : body.slice(0, space)).trim();
    const args = (space === -1 ? "" : body.slice(space + 1)).trim();
    const discovered = commands.find((command) => command.name === name);
    if (discovered) { await submitPrompt(raw, discovered.source === "extension"); return; }

    switch (name) {
      case "new": await startNewSession(); return;
      case "name": await sendRecordAndWait(args ? { type: "set_session_name", name: args } : { type: "get_state" }); return;
      case "session": await sendRecordAndWait({ type: "get_session_stats" }); return;
      case "compact": {
        const id = uid("compact");
        pendingManualCompactionInstructions.current = args || null;
        activeCompactionId.current = id;
        append({ id, kind: "tool", title: "compact", text: "", runtimeRole: "session-maintenance", toolInput: args ? `Manual context compaction\nInstructions: ${args}` : "Manual context compaction", toolOutput: "Generating conversation summary…", state: "running" });
        setStreamingState(true);
        setGenerationStatus("Compacting context");
        await sendRecordAndWait(args ? { type: "compact", customInstructions: args } : { type: "compact" }, { silent: true }, 24 * 60 * 60 * 1000);
        return;
      }
      case "model": {
        if (!args) { await sendRecordAndWait({ type: "get_available_models" }); return; }
        const match = findModelMatch(models, args);
        if (match) { await sendRecordAndWait(createSetModelRecord(match)); return; }
        const slash = args.indexOf("/");
        if (slash <= 0 || slash === args.length - 1) { append({ kind: "error", text: "Use `/model provider/model-id`, or run `/model` to see the exact configured IDs." }); return; }
        await sendRecordAndWait(createSetModelRecord({ provider: args.slice(0, slash), id: args.slice(slash + 1) }));
        return;
      }
      case "thinking": {
        if (!args) { await sendRecordAndWait({ type: "get_available_thinking_levels" }); return; }
        const id = `mf-thinking-${crypto.randomUUID()}`;
        pendingThinkingSet.current.set(id, args);
        try { await sendRecordAndWait({ id, type: "set_thinking_level", level: args }); }
        finally { pendingThinkingSet.current.delete(id); }
        return;
      }
      case "resume":
        if (!args) append({ kind: "system", text: "Choose a saved session from the sidebar, or use `/resume <session-jsonl-path>`." });
        else await switchSessionAndResync(args);
        return;
      case "tree": await sendRecordAndWait({ type: "get_tree" }); return;
      case "fork": if (args) await forkSession(args); else await sendRecordAndWait({ type: "get_fork_messages" }); return;
      case "clone": await cloneSession(); return;
      case "copy": {
        const id = `mf-copy-${crypto.randomUUID()}`;
        copyRequestIds.current.add(id);
        await sendRecord({ id, type: "get_last_assistant_text" });
        return;
      }
      case "export": await sendRecordAndWait(args ? { type: "export_html", outputPath: args } : { type: "export_html" }); return;
      case "commands": {
        const discoveredCommands = await refreshCommands();
        const byName = new Map<string, CommandInfo>();
        BUILT_INS.forEach((command) => byName.set(command.name, command));
        discoveredCommands.forEach((command) => byName.set(command.name, command));
        const merged = [...byName.values()].sort((a, b) => commandSourceRank(a.source) - commandSourceRank(b.source) || a.name.localeCompare(b.name));
        append({ kind: "system", title: "Commands", text: commandListText(merged) });
        return;
      }
      case "state": await requestState(false); return;
      case "messages": await sendRecordAndWait({ type: "get_messages" }); return;
      case "abort": await interruptGeneration(); return;
      case "reload": append({ kind: "system", text: "Restarting Pi to reload extensions, skills, templates, settings and context files." }); await restartPi(); return;
      case "quit": await disconnect(); return;
      default:
        if (TUI_ONLY.has(name)) { append({ kind: "system", title: `/${name}`, text: `\`/${name}\` is implemented by Pi's terminal UI and has no direct RPC command yet.` }); return; }
        await submitPrompt(raw);
    }
  }

  async function retrieveQueuedMessages() {
    if (!connected || directBashRunningRef.current || inputBlockCountRef.current > 0) return;
    try {
      const response = await sendRecordAndWait({ type: "clear_queue" }, { silent: true });
      if (!response.success) throw new Error(String(response.error ?? "Pi could not clear queue."));
      const text = queuedTextFromClearQueue(response.data);
      setPiQueue({ steering: [], followUp: [] });
      if (text.length) composerDraftSetterRef.current((current) => mergeRestoredQueuedText(current, text));
    } catch (error) { append({ kind: "error", text: `Could not retrieve queued messages: ${String(error)}` }); }
  }

  async function answerExtensionDialog(payload: Json) {
    if (!extensionDialog) return;
    const dialog = extensionDialog;
    beginInputBlock();
    try {
      // extension_ui_response is the reply half of Pi's extension UI sub-protocol,
      // not a normal RPC command that emits another correlated response.
      await sendRecord({ type: "extension_ui_response", id: dialog.id, ...payload });
      setExtensionDialog(null);
      setDialogValue("");
      setGenerationStatus(isStreamingRef.current ? "Composing" : null);
    } catch (error) {
      append({ kind: "error", text: `Could not answer Pi extension prompt: ${String(error)}` });
    } finally {
      endInputBlock();
    }
  }

  const allCommands = useMemo(() => {
    const byName = new Map<string, CommandInfo>();
    BUILT_INS.forEach((command) => byName.set(command.name, command));
    commands.forEach((command) => byName.set(command.name, command));
    return [...byName.values()].sort((a, b) => {
      const sourceDiff = commandSourceRank(a.source) - commandSourceRank(b.source);
      return sourceDiff || a.name.localeCompare(b.name);
    });
  }, [commands]);

  const aboveEditorWidgets = useMemo(
    () => Object.values(extensionWidgets).filter((widget) => widget.placement === "aboveEditor"),
    [extensionWidgets],
  );
  const belowEditorWidgets = useMemo(
    () => Object.values(extensionWidgets).filter((widget) => widget.placement === "belowEditor"),
    [extensionWidgets],
  );

  const activeSession = useMemo(
    () => sessions.find((session) => session.path === activeSessionPath) ?? null,
    [sessions, activeSessionPath],
  );

  const chatTitle = activeSessionName || (activeSession ? sessionTitle(activeSession) : "New session");

  const contextUsage = sessionStats?.contextUsage;
  const resolvedContextUsage = resolveContextUsage(contextUsage, currentModel?.contextWindow, postCompactionContextEstimate);
  const contextUsed = resolvedContextUsage.tokens;
  const contextLimit = resolvedContextUsage.contextWindow;
  const contextPercent = resolvedContextUsage.percent;
  const contextUsedForMath = contextUsed ?? 0;
  const inputTokens = sessionStats?.tokens?.input ?? 0;
  const cacheReadTokens = sessionStats?.tokens?.cacheRead ?? 0;
  const cacheEligibleInputTokens = inputTokens + cacheReadTokens;
  const cacheHitPercent = cacheEligibleInputTokens > 0
    ? (cacheReadTokens / cacheEligibleInputTokens) * 100
    : 0;
  const systemPromptTokens = Math.min(contextUsedForMath, contextBreakdown?.systemPromptTokens ?? 0);
  const toolDefinitionTokens = Math.min(
    Math.max(0, contextUsedForMath - systemPromptTokens),
    contextBreakdown?.toolDefinitionTokens ?? 0,
  );
  const messageTokens = Math.max(0, contextUsedForMath - systemPromptTokens - toolDefinitionTokens);
  const contextDetails = useMemo<ContextUsageDetails>(() => ({
    inputTokens,
    outputTokens: sessionStats?.tokens?.output ?? 0,
    cachedTokens: cacheReadTokens,
    cacheHitPercent,
    usedTokens: contextUsed,
    contextLimit,
    contextPercent,
    estimated: resolvedContextUsage.estimated,
    systemPromptTokens,
    toolDefinitionTokens,
    messageTokens,
    breakdownEstimated: contextBreakdown?.approximate ?? false,
  }), [
    cacheHitPercent,
    cacheReadTokens,
    contextBreakdown?.approximate,
    contextLimit,
    contextPercent,
    contextUsed,
    inputTokens,
    messageTokens,
    resolvedContextUsage.estimated,
    sessionStats?.tokens?.output,
    systemPromptTokens,
    toolDefinitionTokens,
  ]);

  const activityDisplaySettings = useMemo(() => ({
    timelineMode,
    autoExpandThinking: timelineMode === "full" && autoExpandThinking,
    autoExpandTools: timelineMode === "full" && autoExpandTools,
  }), [autoExpandThinking, autoExpandTools, timelineMode]);
  const activeBackgroundUrl = selectActiveBackgroundUrl(
    backgroundImagesEnabled,
    resolvedTheme,
    Object.fromEntries(Object.entries(customBackgrounds).map(([theme, value]) => [theme, value?.url])) as Partial<Record<BackgroundTheme, string>>,
    DEFAULT_BACKGROUND_IMAGE_URLS,
  );
  const appStyle = {
    "--session-sidebar-width": `${sidebarWidth}px`,
    "--app-background-image": activeBackgroundUrl ? `url(${JSON.stringify(activeBackgroundUrl)})` : "none",
    "--mf-wallpaper-overlay-opacity": String(wallpaperOverlayPercent / 100),
  } as CSSProperties;

  const loadingBackgroundUrl = activeBackgroundUrl ?? null;
  const loadingVisualReady = loadingVisualReadyUrl === loadingBackgroundUrl;

  if (appInitializing || !backgroundsHydrated || !loadingVisualReady) {
    return (
      <LoadingScreen
        backgroundUrl={loadingBackgroundUrl}
        theme={resolvedTheme}
        onVisualReady={setLoadingVisualReadyUrl}
      />
    );
  }

  return (
    <main className={`app-shell is-connected ${backgroundImagesEnabled ? "background-enabled" : "background-disabled"} ${wallpaperOverlayPercent > 0 ? "wallpaper-overlay-enabled" : ""}`} style={appStyle}>
      <WindowControls />
      <>
          <div
            className={`workspace ${switchingFolder ? "is-switching-folder" : ""} ${sidebarVisible ? "sidebar-visible" : "sidebar-hidden"} ${settingsOpen ? "settings-covered" : ""}`}
            aria-hidden={settingsOpen}
          >
          {sidebarVisible && <aside className="session-sidebar" ref={sessionSidebarRef}>
            <div className="sidebar-titlebar" data-tauri-drag-region>
              <div className="sidebar-brand">
                <button className="icon-button sidebar-toggle" type="button" onClick={() => setSidebarVisible(false)} title="Hide sidebar" aria-label="Hide sidebar">
                  <Menu size={16} />
                </button>
                <strong className="molten-forge-title">Molten Forge</strong>
              </div>
              <div className="sidebar-title-actions">
                <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
                  <Settings size={16} />
                </button>
                <button className="icon-button" type="button" onClick={() => void startNewSession()} disabled={!connected || isStreaming || isBashRunning || inputBlocked} title="New session" aria-label="New session">
                  <PlusIcon />
                </button>
              </div>
            </div>

            <div className="sidebar-section-heading project-section-heading">
              <span>Projects</span>
              <div className="project-header-actions">
                <button className="icon-button tiny" type="button" onClick={() => void chooseFolder()} title="Open folder…" aria-label="Open folder">
                  <FolderIcon size={15} />
                </button>
                <button className="icon-button tiny" type="button" onClick={() => { if (connected) { setSessionsLoading(true); void refreshSessions().then(() => discoverProjects()); } else { void discoverProjects(); } }} title="Refresh projects and sessions" aria-label="Refresh projects and sessions">
                  <RefreshIcon />
                </button>
              </div>
            </div>

            <ProjectSessionSidebar
              cwd={connected || switchingFolder ? cwd : ""}
              recentProjects={recentProjects}
              projects={discoveredProjects}
              sessions={sessions}
              sessionsLoading={sessionsLoading}
              sessionsError={sessionsError}
              missingProjectPath={missingProjectPath}
              activeSessionPath={activeSessionPath}
              disabled={switchingFolder}
              newSessionBusy={isStreaming || isBashRunning || inputBlocked}
              onOpenSession={(session) => void openSession(session)}
              onActivateProject={(project) => void switchToProject(project)}
              onNewSessionInProject={(project) => void newSessionInProject(project)}
              onOpenInExplorer={(project) => { void invoke("open_project_in_explorer", { path: project }).catch((error) => setExtensionNotice({ id: crypto.randomUUID(), kind: "error", message: `Could not open Explorer: ${String(error)}` })); }}
            />

            <div className="sidebar-footer">
              <span className={`dot ${connected ? "online" : ""}`} />
              <span>{connected ? (piVersion ?? "Pi") : connecting || switchingFolder ? "Connecting…" : "No project open"}</span>
              {connected && <button type="button" onClick={() => void disconnect()}>Disconnect</button>}
            </div>
            <div
              className={`sidebar-width-resizer ${sidebarResizeMarker.visible || sidebarResizingRef.current ? "visible" : ""}`}
              style={{ "--resize-y": `${sidebarResizeMarker.y}px` } as CSSProperties}
              onPointerEnter={(event) => updateSidebarResizeMarker(event.clientY)}
              onPointerMove={(event) => updateSidebarResizeMarker(event.clientY)}
              onPointerLeave={() => {
                if (!sidebarResizingRef.current) setSidebarResizeMarker((current) => ({ ...current, visible: false }));
              }}
              onPointerDown={beginSidebarResize}
              aria-hidden="true"
            />
          </aside>}

          <section
            className="chat-pane"
            ref={chatPaneRef}
            style={{
              "--chat-width": `${chatWidth}px`,
            } as CSSProperties}
          >
            <header className="chat-header" data-tauri-drag-region>
              <div className="chat-heading">
                {!sidebarVisible && (
                  <button className="icon-button chat-sidebar-toggle" type="button" onClick={() => setSidebarVisible(true)} title="Show sidebar" aria-label="Show sidebar">
                    <Menu size={16} />
                  </button>
                )}
                <strong>{connected ? chatTitle : "Molten Forge"}</strong>
              </div>
              {connected && <ContextUsagePopover
                variant="header"
                details={contextDetails}
                onOpen={refreshContextUsage}
              />}
            </header>

            <div className="chat-width-guides" aria-hidden="true">
              {(["left", "right"] as const).map((side) => (
                <div
                  key={side}
                  className={`chat-width-resizer ${side} ${activeChatResizeSideRef.current === side ? "dragging" : ""} ${chatResizeMarker.visible ? "visible" : ""}`}
                  style={{ "--resize-y": `${chatResizeMarker.y}px` } as CSSProperties}
                  onPointerEnter={(event) => handleChatResizeHover(side, event)}
                  onPointerMove={(event) => handleChatResizeHover(side, event)}
                  onPointerLeave={() => handleChatResizeLeave(side)}
                  onPointerDown={(event) => beginChatWidthResize(side, event)}
                  onWheel={handleChatResizeWheel}
                />
              ))}
            </div>

            {connected ? <WorkingDirectoryContext.Provider value={cwd}>
              <ActivityDisplaySettingsContext.Provider value={activityDisplaySettings}>
                <TranscriptView
                  key={activeSessionPath ?? "__new-session__"}
                  items={visibleTranscriptItems}
                  timelineMode={timelineMode}
                  historyLoading={historyLoading}
                  piVersion={piVersion}
                  commands={commands}
                  isStreaming={isStreaming}
                  generationStatus={generationStatus}
                  disableVirtualizerScrollCorrection={isStreaming || visualFlushSettling}
                  transcriptRef={transcriptRef}
                  transcriptContentRef={transcriptContentRef}
                  onScroll={handleTranscriptScroll}
                  onWheel={handleTranscriptWheel}
                  onPointerDown={handleTranscriptPointerDown}
                />
              </ActivityDisplaySettingsContext.Provider>
            </WorkingDirectoryContext.Provider> : (
              <section className="no-project-state">
                <div className="no-project-card">
                  <FolderIcon size={30} />
                  <h2>No project open</h2>
                  <p>Choose an existing project on the left, or open another folder to begin.</p>
                  <button type="button" className="primary" onClick={() => void chooseFolder()} disabled={connecting || switchingFolder}>
                    <FolderIcon size={17} /> Open Folder
                  </button>
                  {startupError && <p className="no-project-error" role="alert">{startupError}</p>}
                </div>
              </section>
            )}

            {connected && showScrollToBottomButton && !historyLoading && items.length > 0 && (
              <div className="scroll-to-bottom-anchor">
                <button
                  className="scroll-to-bottom-button"
                  type="button"
                  onClick={jumpToChatBottom}
                  title="Scroll to bottom"
                  aria-label="Scroll to bottom"
                >
                  <ChevronDown size={17} aria-hidden="true" />
                </button>
              </div>
            )}

            {connected && <footer className="composer-wrap" ref={composerWrapRef}>
              {Object.keys(status).length > 0 && (
                <div className="extension-status">
                  {Object.entries(status).map(([key, value]) => <span key={key}>{key}: {value}</span>)}
                </div>
              )}

              {aboveEditorWidgets.length > 0 && (
                <div className="extension-widgets above-editor" aria-live="polite">
                  {aboveEditorWidgets.map((widget) => (
                    <div className="extension-widget" key={widget.key} data-widget-key={widget.key}>
                      {widget.lines.map((line, index) => <div key={`${widget.key}:${index}`}>{line || " "}</div>)}
                    </div>
                  ))}
                </div>
              )}

              <MessageQueue queue={piQueue} onRetrieve={() => void retrieveQueuedMessages()} />
              <Composer
                commands={allCommands}
                connected={connected}
                isStreaming={isStreaming}
                isBashRunning={isBashRunning}
                inputBlocked={inputBlocked}
                draftSetterRef={composerDraftSetterRef}
                onSubmitRaw={submitRaw}
                onAbort={async () => { await interruptGeneration(); }}
                onAbortBash={abortDirectBash}
                beforeSendActions={
                  <>
                    <ModelSwitcher
                      models={models}
                      currentModel={currentModel}
                      connected={connected}
                      onRefreshModels={refreshAvailableModels}
                      onSelectModel={selectModelFromPicker}
                    />
                    {contextLimit > 0 && (
                      <ContextUsagePopover
                        variant="ring"
                        details={contextDetails}
                        onOpen={refreshContextUsage}
                      />
                    )}
                  </>
                }
              />

              {belowEditorWidgets.length > 0 && (
                <div className="extension-widgets below-editor" aria-live="polite">
                  {belowEditorWidgets.map((widget) => (
                    <div className="extension-widget" key={widget.key} data-widget-key={widget.key}>
                      {widget.lines.map((line, index) => <div key={`${widget.key}:${index}`}>{line || " "}</div>)}
                    </div>
                  ))}
                </div>
              )}
            </footer>}
          </section>
          </div>

          {settingsOpen && (
          <SettingsView
            activeSection={settingsSection}
            cwd={connected ? cwd : ""}
            commands={commands}
            transcriptItems={items}
            onReloadSkills={async () => { if (connected) await restartPi(); }}
            reloadDisabled={isStreaming || isBashRunning || inputBlocked}
            sidebarWidth={sidebarWidth}
            contentWidth={chatWidth}
            resolvedTheme={resolvedTheme}
            themePreference={themePreference}
            appFontFamily={appFontFamily}
            autoExpandThinking={autoExpandThinking}
            timelineMode={timelineMode}
            autoExpandTools={autoExpandTools}
            notifyWhenBackground={notifyWhenBackground}
            notificationError={notificationError}
            onNotifyWhenBackgroundChange={(value) => void changeBackgroundNotificationSetting(value)}
            backgroundImagesEnabled={backgroundImagesEnabled}
            wallpaperOverlayPercent={wallpaperOverlayPercent}
            onWallpaperOverlayPercentChange={setWallpaperOverlayPercent}
            customBackgrounds={customBackgrounds}
            backgroundPickerTheme={backgroundPickerTheme}
            backgroundError={backgroundError}
            onSectionChange={setSettingsSection}
            onBackToChat={() => setSettingsOpen(false)}
            onThemePreferenceChange={setThemePreference}
            onAppFontFamilyChange={(font) => preserveChatViewportThroughSettingsChange(() => setAppFontFamily(font))}
            onAutoExpandThinkingChange={(value) => preserveChatViewportThroughSettingsChange(() => setAutoExpandThinking(value))}
            onAutoExpandToolsChange={(value) => preserveChatViewportThroughSettingsChange(() => setAutoExpandTools(value))}
            onTimelineModeChange={(value) => preserveChatViewportThroughSettingsChange(() => setTimelineMode(value))}
            onBackgroundImagesEnabledChange={setBackgroundImagesEnabled}
            onChooseBackgroundImage={chooseBackgroundImage}
            onClearBackgroundImage={(theme) => void clearBackgroundImage(theme)}
          />
          )}
      </>

      {extensionNotice && (
        <div className={`extension-notice ${extensionNotice.kind}`} role={extensionNotice.kind === "error" ? "alert" : "status"}>
          {extensionNotice.message}
        </div>
      )}

      <input
        ref={backgroundInputRef}
        className="background-file-input"
        type="file"
        accept={backgroundImageAcceptValue()}
        onChange={(event) => void handleBackgroundFileChange(event)}
        tabIndex={-1}
        aria-hidden="true"
      />

      {extensionDialog && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>{extensionDialog.title ?? "Pi extension"}</h2>
            {extensionDialog.message && <p>{extensionDialog.message}</p>}

            {extensionDialog.method === "select" && (
              <div className="option-list">
                {(extensionDialog.options ?? []).map((option) => (
                  <button key={option} onClick={() => void answerExtensionDialog({ value: option })}>{option}</button>
                ))}
              </div>
            )}

            {extensionDialog.method === "confirm" && (
              <div className="modal-actions">
                <button onClick={() => void answerExtensionDialog({ confirmed: false })}>No</button>
                <button className="primary" onClick={() => void answerExtensionDialog({ confirmed: true })}>Yes</button>
              </div>
            )}

            {(extensionDialog.method === "input" || extensionDialog.method === "editor") && (
              <>
                {extensionDialog.method === "editor" ? (
                  <textarea className="dialog-editor" rows={10} value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} />
                ) : (
                  <input autoFocus value={dialogValue} placeholder={extensionDialog.placeholder} onChange={(event) => setDialogValue(event.target.value)} />
                )}
                <div className="modal-actions">
                  <button onClick={() => void answerExtensionDialog({ cancelled: true })}>Cancel</button>
                  <button className="primary" onClick={() => void answerExtensionDialog({ value: dialogValue })}>Submit</button>
                </div>
              </>
            )}

            {extensionDialog.method === "select" && (
              <button className="cancel-link" onClick={() => void answerExtensionDialog({ cancelled: true })}>Cancel</button>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

const HUGE_MARKDOWN_THRESHOLD = 80_000;
const VIRTUAL_MARKDOWN_BLOCK_MAX_CHARS = 6_000;
const VIRTUAL_MARKDOWN_BUILD_BUDGET_MS = 6;
const VIRTUAL_MARKDOWN_OVERSCAN_PX = 900;
const VIRTUAL_MARKDOWN_FENCE_PATTERN = /^ {0,3}(```+|~~~+)\s*([^`~\s]*)?/;

type VirtualMarkdownBlock = {
  id: string;
  index: number;
  start: number;
  end: number;
  kind: "markdown" | "code";
  estimatedHeight: number;
};

const virtualMarkdownBlockCache = new Map<string, { contentKey: string; blocks: VirtualMarkdownBlock[] }>();

function hashShortString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getCheapContentKey(content: string) {
  return `${content.length}:${hashShortString(content.slice(0, 512))}:${hashShortString(content.slice(-512))}`;
}

function estimateVirtualMarkdownBlockHeight(contentLength: number, kind: "markdown" | "code") {
  const lineHeight = kind === "code" ? 20 : 24;
  const charsPerLine = kind === "code" ? 96 : 88;
  return Math.max(32, Math.ceil(contentLength / charsPerLine) * lineHeight + 18);
}

function findScrollParent(element: HTMLElement | null): HTMLElement | Window {
  let current = element?.parentElement ?? null;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }
  return window;
}

function getScrollTop(scrollParent: HTMLElement | Window) {
  return scrollParent instanceof Window ? window.scrollY : scrollParent.scrollTop;
}

function getScrollClientHeight(scrollParent: HTMLElement | Window) {
  return scrollParent instanceof Window ? window.innerHeight : scrollParent.clientHeight;
}

function getElementOffsetInsideScrollParent(element: HTMLElement, scrollParent: HTMLElement | Window) {
  const elementRect = element.getBoundingClientRect();
  if (scrollParent instanceof Window) return elementRect.top + window.scrollY;
  const parentRect = scrollParent.getBoundingClientRect();
  return elementRect.top - parentRect.top + scrollParent.scrollTop;
}

function createVirtualMarkdownBlocksBuilder(
  content: string,
  onBatch: (blocks: VirtualMarkdownBlock[]) => void,
  onComplete: (blocks: VirtualMarkdownBlock[]) => void,
) {
  const blocks: VirtualMarkdownBlock[] = [];
  let offset = 0;
  let blockStart = 0;
  let inFence = false;
  let fenceChar = "`";
  let fenceLength = 3;

  const createBlock = (start: number, end: number, kind: "markdown" | "code") => {
    if (end <= start) return;
    blocks.push({
      id: `${start}:${end}:${kind}`,
      index: blocks.length,
      start,
      end,
      kind,
      estimatedHeight: estimateVirtualMarkdownBlockHeight(end - start, kind),
    });
  };

  const closesFence = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith(fenceChar.repeat(fenceLength))) return false;
    return trimmed.slice(fenceLength).trim().length === 0;
  };

  return function runBatch() {
    const startedAt = performance.now();
    while (offset < content.length) {
      const nextNewline = content.indexOf("\n", offset);
      const lineEnd = nextNewline === -1 ? content.length : nextNewline + 1;
      const line = content.slice(offset, lineEnd);
      const trimmed = line.trim();
      const fenceMatch = line.match(VIRTUAL_MARKDOWN_FENCE_PATTERN);

      if (!inFence && fenceMatch) {
        if (offset > blockStart) {
          createBlock(blockStart, offset, "markdown");
          blockStart = offset;
        }
        inFence = true;
        fenceChar = fenceMatch[1][0];
        fenceLength = fenceMatch[1].length;
      }

      offset = lineEnd;

      if (inFence) {
        if (closesFence(line) && offset > blockStart + line.length) {
          createBlock(blockStart, offset, "code");
          blockStart = offset;
          inFence = false;
        }
      } else if ((trimmed.length === 0 && offset > blockStart) || offset - blockStart >= VIRTUAL_MARKDOWN_BLOCK_MAX_CHARS) {
        createBlock(blockStart, offset, "markdown");
        blockStart = offset;
      }

      if (performance.now() - startedAt >= VIRTUAL_MARKDOWN_BUILD_BUDGET_MS) {
        onBatch([...blocks]);
        return false;
      }
    }

    if (blockStart < content.length) createBlock(blockStart, content.length, inFence ? "code" : "markdown");
    onBatch([...blocks]);
    onComplete(blocks);
    return true;
  };
}

const VirtualMarkdownMeasuredBlock = memo(function VirtualMarkdownMeasuredBlock({
  block,
  content,
  top,
  onMeasuredHeight,
}: {
  block: VirtualMarkdownBlock;
  content: string;
  top: number;
  onMeasuredHeight: (blockId: string, height: number) => void;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const measure = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (Number.isFinite(height) && height > 0) onMeasuredHeight(block.id, height);
    };

    // CodeMirror mounts/updates in layout effects and may perform an additional
    // internal measurement after attachment. Observe the real rendered block
    // rather than relying on the callback-ref measurement that ran before the
    // editor existed. This keeps both Markdown virtualization layers on the
    // same geometry as the DOM.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [block.id, onMeasuredHeight]);

  return (
    <div
      ref={elementRef}
      className="virtual-markdown-block"
      style={{ top }}
    >
      <MarkdownRenderer content={content} />
    </div>
  );
});

function VirtualizedMarkdown({ content, messageId }: { content: string; messageId: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentKey = useMemo(() => getCheapContentKey(content), [content]);
  const cached = virtualMarkdownBlockCache.get(messageId);
  const cachedBlocks = cached?.contentKey === contentKey ? cached.blocks : null;
  const [blocks, setBlocks] = useState<VirtualMarkdownBlock[]>(() => cachedBlocks ?? []);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const [viewport, setViewport] = useState({ top: 0, bottom: 0 });

  useEffect(() => {
    setMeasuredHeights({});
    const existing = virtualMarkdownBlockCache.get(messageId);
    if (existing?.contentKey === contentKey) {
      setBlocks(existing.blocks);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    setBlocks([]);
    const runBatch = createVirtualMarkdownBlocksBuilder(
      content,
      (next) => { if (!cancelled) setBlocks(next); },
      (finalBlocks) => {
        if (!cancelled) virtualMarkdownBlockCache.set(messageId, { contentKey, blocks: finalBlocks });
      },
    );
    const schedule = () => {
      timer = window.setTimeout(() => {
        timer = null;
        if (!cancelled && !runBatch()) schedule();
      }, 0);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [content, contentKey, messageId]);

  const offsets = useMemo(() => {
    const next = [0];
    for (const block of blocks) next.push(next[next.length - 1] + (measuredHeights[block.id] ?? block.estimatedHeight));
    return next;
  }, [blocks, measuredHeights]);
  const totalHeight = offsets[offsets.length - 1] ?? 0;

  const updateViewport = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const scrollParent = findScrollParent(root);
    const localTop = getScrollTop(scrollParent) - getElementOffsetInsideScrollParent(root, scrollParent);
    const clientHeight = getScrollClientHeight(scrollParent);
    setViewport({
      top: Math.max(0, localTop - VIRTUAL_MARKDOWN_OVERSCAN_PX),
      bottom: Math.min(Math.max(totalHeight, clientHeight), localTop + clientHeight + VIRTUAL_MARKDOWN_OVERSCAN_PX),
    });
  }, [totalHeight]);

  useLayoutEffect(() => updateViewport(), [updateViewport]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scrollParent = findScrollParent(root);
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; updateViewport(); });
    };
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(root);
    if (scrollParent instanceof Window) {
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule);
    } else {
      resizeObserver.observe(scrollParent);
      scrollParent.addEventListener("scroll", schedule, { passive: true });
    }
    return () => {
      resizeObserver.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      if (scrollParent instanceof Window) {
        window.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
      } else {
        scrollParent.removeEventListener("scroll", schedule);
      }
    };
  }, [updateViewport]);

  const updateMeasuredBlockHeight = useCallback((blockId: string, height: number) => {
    setMeasuredHeights((current) =>
      Math.abs((current[blockId] ?? 0) - height) < 2
        ? current
        : { ...current, [blockId]: height },
    );
  }, []);

  if (blocks.length === 0) return <div className="markdown-virtualizing">Rendering…</div>;
  const startIndex = Math.max(0, findBlockIndexForOffset(offsets, viewport.top));
  const endIndex = Math.min(blocks.length - 1, findBlockIndexForOffset(offsets, viewport.bottom));
  const visibleBlocks = endIndex < startIndex ? [] : blocks.slice(startIndex, endIndex + 1);

  return (
    <div ref={rootRef} className="virtual-markdown" style={{ height: Math.max(1, totalHeight) }}>
      {visibleBlocks.map((block) => (
        <VirtualMarkdownMeasuredBlock
          key={block.id}
          block={block}
          content={content.slice(block.start, block.end)}
          top={offsets[block.index]}
          onMeasuredHeight={updateMeasuredBlockHeight}
        />
      ))}
    </div>
  );
}

function Markdown({ children, messageId }: { children: string; messageId?: string }) {
  const renderedMarkdown = useMemo(() => recoverFencedMarkdownTables(children), [children]);
  return (
    <div className="markdown-body">
      {messageId && renderedMarkdown.length >= HUGE_MARKDOWN_THRESHOLD
        ? <VirtualizedMarkdown content={renderedMarkdown} messageId={messageId} />
        : <MarkdownRenderer content={renderedMarkdown} />}
    </div>
  );
}


function formatToolDisplayName(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : "Tool";
}

function isFileMutationTool(title?: string) {
  return /^(edit|write)$/i.test(title ?? "");
}

function toolMutationPath(item: TranscriptItem) {
  if (!isFileMutationTool(item.title) || !item.toolArgs || typeof item.toolArgs !== "object" || !("path" in item.toolArgs)) return "";
  return String((item.toolArgs as Record<string, unknown>).path ?? "").trim();
}

function completedToolPreview(item: TranscriptItem, cwd: string) {
  const toolName = (item.title ?? "").trim().toLowerCase();
  const input = item.toolInput ?? item.text;
  const output = item.toolOutput ?? "";

  if (/^(read|read_file)$/.test(toolName)) {
    return readToolSummary({ args: item.toolArgs, output, state: item.state, cwd, details: item.toolResultDetails });
  }
  if (/^(edit|write)$/.test(toolName)) {
    return fileMutationToolSummary(item.toolArgs, cwd) || toolMutationPath(item);
  }
  if (/^(bash|shell|terminal|powershell|pwsh)$/.test(toolName)) {
    return terminalInputPreview(input, 200);
  }
  if (toolName === "compact" && output.trim()) {
    return firstActivityPreviewLine(output);
  }
  return firstActivityPreviewLine(input, {
    stripShellPrompt: true,
    skipStructuralOnly: true,
  });
}

function liveToolPreview(item: TranscriptItem) {
  const output = item.toolOutput ?? "";
  const useOutput = Boolean(item.toolExecutionStarted && output.trim());
  const source = useOutput ? output : (item.toolInput ?? item.text);
  return rollingActivityPreview(source, {
    stripShellPrompt: !useOutput,
    skipStructuralOnly: !useOutput,
  });
}

function LiveActivityPreview({ className, value }: { className: string; value: string }) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const text = textRef.current;
    if (!root || !text) return;

    const measure = () => {
      const next = text.scrollWidth > root.clientWidth + 1;
      setClipped((current) => current === next ? current : next);
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [value]);

  return (
    <span
      ref={rootRef}
      className={`${className} activity-preview-live ${clipped ? "is-clipped" : ""}`.trim()}
      title={value}
    >
      <span ref={textRef} className="activity-preview-live-text">{value}</span>
    </span>
  );
}

const thinkingExpandedOverrideById = new Map<string, boolean>();
const toolExpandedOverrideById = new Map<string, boolean>();

function ThinkingTranscript({ item }: { item: TranscriptItem }) {
  const running = item.state === "running";
  const { autoExpandThinking } = useContext(ActivityDisplaySettingsContext);
  const [manualExpandedOverride, setManualExpandedOverride] = useState<boolean | undefined>(() =>
    thinkingExpandedOverrideById.get(item.id),
  );
  const expanded = resolveActivityExpanded(manualExpandedOverride, running, autoExpandThinking);
  const collapsed = !expanded;

  const displayText = normalizeThinkingContent(item.text);
  const thinkingContentRef = useRef<HTMLDivElement | null>(null);
  const firstPreviewLine = useMemo(() => firstThinkingPreviewLine(displayText), [displayText]);
  const latestPreviewLine = useMemo(() => rollingThinkingPreview(displayText), [displayText]);
  const latestPreviewLineRef = useRef(latestPreviewLine);
  latestPreviewLineRef.current = latestPreviewLine;
  const [sampledPreviewLine, setSampledPreviewLine] = useState(latestPreviewLine);

  useEffect(() => {
    if (running) return;
    setSampledPreviewLine(firstPreviewLine);
  }, [firstPreviewLine, running]);

  useEffect(() => {
    if (!running || !collapsed) return;
    setSampledPreviewLine(latestPreviewLineRef.current);
    const interval = window.setInterval(() => {
      setSampledPreviewLine((current) => nextSampledThinkingLine(current, latestPreviewLineRef.current));
    }, THINKING_PREVIEW_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [collapsed, running]);

  useLayoutEffect(() => {
    if (!running || !expanded) return;
    const content = thinkingContentRef.current;
    if (!content || content.scrollHeight <= content.clientHeight) return;

    // This is deliberately local to the nested Thinking scroller. It does not
    // touch the transcript scroll container or its reader/auto-follow state.
    content.scrollTop = content.scrollHeight;
  }, [displayText, expanded, running]);

  const preview = displayedThinkingPreview({
    running,
    firstLine: firstPreviewLine,
    sampledLastLine: sampledPreviewLine,
  });
  return (
    <article className={`thinking ${item.state ?? "done"}`} data-message-id={item.id}>
      <button
        className="activity-header thinking-header"
        type="button"
        data-reader-layout-interaction="true"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const next = !expanded;
          thinkingExpandedOverrideById.set(item.id, next);
          setManualExpandedOverride(next);
        }}
        aria-expanded={expanded}
      >
        <HoverSwapActivityIcon
          icon={Brain}
          hoverIcon={collapsed ? ChevronRight : ChevronDown}
        />
        <span className="activity-title">{item.title ?? "Thinking"}</span>
        {running && (
          <>
            <span className="activity-separator">·</span>
            <Loader2 className="activity-spinner-icon" aria-label="Thinking" />
          </>
        )}
        {collapsed && preview && (
          <>
            <span className="activity-separator">·</span>
            {running
              ? <LiveActivityPreview className="thinking-preview" value={preview} />
              : <span className="thinking-preview" title={preview}>{preview}</span>}
          </>
        )}
      </button>
      {expanded && <div className="thinking-content" ref={thinkingContentRef}><Markdown messageId={item.id}>{displayText || "…"}</Markdown></div>}
    </article>
  );
}

function RetryTranscript({ item }: { item: TranscriptItem }) {
  const running = item.state === "running";
  const failed = item.state === "error";
  return (
    <article className={`retry-activity ${item.state ?? "done"}`} data-message-id={item.id}>
      <div className="retry-header">
        <span className="activity-icon"><RetryIcon /></span>
        <span className="activity-title">{item.title ?? "Retrying"}</span>
        {running ? (
          <Loader2 className="activity-spinner-icon" aria-label="Retrying" />
        ) : (
          <span className={`tool-state ${failed ? "error" : "done"}`}>
            {failed ? <X size={14} /> : <Check size={14} />}
          </span>
        )}
      </div>
      {item.text && <div className="retry-error-text">{item.text}</div>}
    </article>
  );
}

function ToolTranscript({ item, compact = false }: { item: TranscriptItem; compact?: boolean }) {
  const terminalLike = /^(bash|shell|terminal|powershell|pwsh)/i.test(item.title ?? "");
  const running = item.state === "running";
  const fileMutation = isFileMutationTool(item.title);
  const compactIcon = !compact ? null
    : terminalLike ? Terminal
    : /^(read|read_file)$/i.test(item.title ?? "") ? BookOpen
    : /^(write|create)$/i.test(item.title ?? "") ? FilePlus2
    : /^(edit|patch|apply_patch)$/i.test(item.title ?? "") ? FilePenLine
    : Wrench;
  const { autoExpandTools } = useContext(ActivityDisplaySettingsContext);
  const cwd = useContext(WorkingDirectoryContext);
  const [manualExpandedOverride, setManualExpandedOverride] = useState<boolean | undefined>(() =>
    toolExpandedOverrideById.get(item.id),
  );
  const expanded = resolveActivityExpanded(manualExpandedOverride, running, autoExpandTools);
  const [showRawInput, setShowRawInput] = useState(false);

  useEffect(() => {
    if (item.toolDiff) setShowRawInput(false);
  }, [item.toolDiff]);

  const input = item.toolInput ?? item.text;
  const output = item.toolOutput ?? "";
  const completedPreview = useMemo(() => completedToolPreview(item, cwd), [cwd, item]);
  const readSummary = useMemo(() =>
    /^(read|read_file)$/i.test(item.title ?? "")
      ? readToolSummaryParts({ args: item.toolArgs, output, state: item.state, cwd, details: item.toolResultDetails })
      : null,
    [cwd, item.state, item.title, item.toolArgs, item.toolResultDetails, output],
  );
  const latestLivePreview = useMemo(() => liveToolPreview(item), [item]);
  const latestLivePreviewRef = useRef(latestLivePreview);
  latestLivePreviewRef.current = latestLivePreview;
  const [sampledLivePreview, setSampledLivePreview] = useState(latestLivePreview);
  const inputScrollRef = useRef<HTMLPreElement | null>(null);
  const outputScrollRootRef = useRef<HTMLDivElement | null>(null);
  const mutationPath = fileMutationToolSummary(item.toolArgs, cwd) || toolMutationPath(item);
  const writtenContent = item.state === "done" && !item.toolDiff
    ? writeContentFromArgs(item.title ?? "", item.toolArgs)
    : undefined;
  const showDiffInput = fileMutation && item.state === "done" && !showRawInput && Boolean(item.toolDiff);
  const showWrittenContentInput = fileMutation && !showRawInput && Boolean(writtenContent);

  useEffect(() => {
    if (!running) {
      setSampledLivePreview(completedPreview);
      return;
    }
    if (expanded) return;

    setSampledLivePreview(latestLivePreviewRef.current);
    const interval = window.setInterval(() => {
      setSampledLivePreview((current) =>
        nextSampledThinkingLine(current, latestLivePreviewRef.current),
      );
    }, THINKING_PREVIEW_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [completedPreview, expanded, running]);

  useLayoutEffect(() => {
    if (!running || !expanded) return;

    const useOutput = Boolean(item.toolExecutionStarted && output.trim());
    if (useOutput) {
      const root = outputScrollRootRef.current;
      const target = root?.querySelector<HTMLElement>(".tool-text-viewer, pre");
      if (target && target.scrollHeight > target.clientHeight) {
        target.scrollTop = target.scrollHeight;
      }
      return;
    }

    const inputTarget = inputScrollRef.current;
    if (inputTarget && inputTarget.scrollHeight > inputTarget.clientHeight) {
      inputTarget.scrollTop = inputTarget.scrollHeight;
    }
  }, [expanded, input, item.toolExecutionStarted, output, running]);

  const preview = running ? sampledLivePreview : completedPreview;

  return (
    <article className={`tool ${item.state ?? "done"}`} data-message-id={item.id}>
      <button
        className="activity-header tool-header"
        type="button"
        data-reader-layout-interaction="true"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const next = !expanded;
          toolExpandedOverrideById.set(item.id, next);
          setManualExpandedOverride(next);
        }}
        aria-expanded={expanded}
      >
        <HoverSwapActivityIcon
          icon={compactIcon ?? (terminalLike ? Terminal : Wrench)}
          hoverIcon={Maximize2}
        />
        <span className="activity-title">{formatToolDisplayName(item.title ?? "tool")}</span>
        <span className="activity-separator">·</span>
        {running ? (
          <Loader2 className="activity-spinner-icon" aria-label="Running" />
        ) : (
          <span
            className={`tool-state ${item.state ?? "done"}`}
            title={item.state === "interrupted" ? "Interrupted" : undefined}
            aria-label={item.state === "interrupted" ? "Interrupted" : undefined}
          >
            {item.state === "error" || item.state === "interrupted"
              ? <X size={14} />
              : <Check size={14} />}
          </span>
        )}
        {!running && !expanded && readSummary ? (
          <>
            <span className="activity-separator">·</span>
            <span className="tool-preview-path" title={readSummary.path}>{readSummary.path}</span>
            {readSummary.range && (
              <>
                <span className="activity-separator">·</span>
                <span className="tool-preview-range">{readSummary.range}</span>
              </>
            )}
          </>
        ) : shouldShowToolPreview(expanded, preview) ? (
          <>
            <span className="activity-separator">·</span>
            {running
              ? <LiveActivityPreview className="tool-preview" value={preview} />
              : <span className="tool-preview" title={preview}>{preview}</span>}
          </>
        ) : null}
      </button>
      {expanded && (
        <div className="tool-details">
          <div className="tool-detail-section">
            <div className="tool-detail-heading">
              <div className="tool-detail-title">
                <div className="tool-detail-label">Input</div>
                {mutationPath && <span className="tool-diff-file-path" title={mutationPath}>{mutationPath}</span>}
              </div>
              {fileMutation && (item.toolDiff || writtenContent) && (
                <div className="tool-detail-actions">
                  {item.toolDiff && (
                    <span className="tool-diff-summary" aria-label={`Diff ${diffSummary(item.toolDiff)}`}>
                      <span className="tool-diff-added">+{item.toolDiff.added}</span>
                      <span className="tool-diff-removed">−{item.toolDiff.removed}</span>
                    </span>
                  )}
                  <button
                    className="tool-detail-mode-toggle"
                    type="button"
                    data-reader-layout-interaction="true"
                    onClick={() => setShowRawInput((value) => !value)}
                  >
                    {showRawInput ? (item.toolDiff ? "Diff" : "Content") : "Raw"}
                  </button>
                </div>
              )}
            </div>
            {showDiffInput ? (
              <ToolDiffViewer diff={item.toolDiff!} />
            ) : showWrittenContentInput ? (
              <ToolWriteContentViewer path={writtenContent!.path || mutationPath} content={writtenContent!.content} />
            ) : (
              <pre ref={inputScrollRef}>{input || "—"}</pre>
            )}
          </div>
          {shouldShowToolOutput(item) && (
            <div className="tool-detail-section" ref={outputScrollRootRef}>
              <div className="tool-detail-label">Output</div>
              {output ? (
                <ToolOutputContent
                  text={output}
                  toolName={item.title ?? "tool"}
                  args={item.toolArgs}
                />
              ) : (
                <pre>{running ? "Waiting for output…" : "—"}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** One disclosure per continuous activity run, with independently bordered
 * smart-grouped thinking/tool phases and explicit Pi parallel batches. */
const compactGroupExpandedById = new Map<string, boolean>();

function CompactRuntimeTranscriptGroup({ items, blocks }: { items: TranscriptItem[]; blocks: TranscriptItem[][] }) {
  const summary = useMemo(() => summarizeCompactActivity(items), [items]);
  const groupId = items[0]?.id ?? "";
  const [expanded, setExpanded] = useState(() => compactGroupExpandedById.get(groupId) ?? false);
  const hasTools = items.some((item) => item.kind === "tool");

  return (
    <div className="compact-runtime-episode">
      <div className={`compact-tool-group${expanded ? " expanded" : ""}${summary.errors ? " has-errors" : ""}`}>
        <button
          className="compact-tool-summary"
          type="button"
          data-message-id={expanded ? undefined : groupId}
          data-reader-layout-interaction="true"
          aria-expanded={expanded}
          aria-label={`${summary.label}${summary.errors ? `, ${summary.errors} failed` : ""}${summary.interrupted ? `, ${summary.interrupted} interrupted` : ""}`}
          onClick={() => {
            const next = !expanded;
            compactGroupExpandedById.set(groupId, next);
            setExpanded(next);
          }}
        >
          <HoverSwapActivityIcon
            icon={summary.running ? Loader2 : hasTools ? Wrench : Brain}
            hoverIcon={expanded ? ChevronDown : ChevronRight}
            spinning={summary.running}
          />
          <span className="compact-tool-label">{summary.label}</span>
          {summary.errors > 0 && <span className="compact-tool-failures">{summary.errors} failed</span>}
          {summary.interrupted > 0 && <span className="compact-tool-interrupted">{summary.interrupted} interrupted</span>}
        </button>
        {expanded && (
          <div className="compact-tool-details">
            {blocks.map((block) => (
              <div className="compact-activity-block" key={block[0].id}>
                {block.map((item) => (
                  <div className="compact-activity-row" key={item.id} data-parallel-batch={item.toolBatchId}>
                    {item.kind === "thinking"
                      ? <MemoThinkingTranscript item={item} />
                      : <MemoToolTranscript item={item} compact />}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const MemoCompactRuntimeTranscriptGroup = memo(CompactRuntimeTranscriptGroup);

function RuntimeTranscriptGroup({ items }: { items: TranscriptItem[] }) {
  // Keep explicit batch metadata and authoritative segmentation even though the
  // visual treatment is a flat row list with shared, edge-to-edge separators.
  const segments = useMemo(() => segmentRuntimeGroupItems(items), [items]);
  return (
    <div className="runtime-group activity-row-list">
      {segments.flatMap<{ item: TranscriptItem; parallelBatch?: string }>((segment) => segment.kind === "parallel-tools"
        ? segment.items.map((item) => ({ item, parallelBatch: segment.key }))
        : [{ item: segment.item, parallelBatch: undefined }],
      ).map(({ item, parallelBatch }) => (
        <div className="runtime-activity-row" key={item.id} data-parallel-batch={parallelBatch}>
          {item.kind === "thinking"
            ? <MemoThinkingTranscript item={item} />
            : <MemoToolTranscript item={item} compact />}
        </div>
      ))}
    </div>
  );
}

function Transcript({ item }: { item: TranscriptItem }) {
  if (item.kind === "user") {
    return (
      <article className="message user" data-message-id={item.id}>
        <div className="user-bubble">
          {item.attachments?.length ? <div className="message-attachments">{item.attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} />)}</div> : null}
          {item.text ? <div>{item.text}</div> : null}
        </div>
      </article>
    );
  }
  if (item.kind === "assistant") {
    return (
      <article className="message assistant" data-message-id={item.id}>
        <Markdown messageId={item.id}>{item.text || "…"}</Markdown>
      </article>
    );
  }
  if (item.kind === "thinking") return <MemoThinkingTranscript item={item} />;
  if (item.kind === "tool") return <MemoToolTranscript item={item} />;
  if (item.kind === "retry") return <MemoRetryTranscript item={item} />;
  return (
    <article className={`notice ${item.kind}`} data-message-id={item.id}>
      {item.title && <strong>{item.title}</strong>}
      <Markdown messageId={item.id}>{item.text || "…"}</Markdown>
    </article>
  );
}

const MemoThinkingTranscript = memo(ThinkingTranscript);
const MemoRetryTranscript = memo(RetryTranscript);
const MemoToolTranscript = memo(ToolTranscript);
const MemoTranscript = memo(Transcript);
const MemoRuntimeTranscriptGroup = memo(RuntimeTranscriptGroup);

function TranscriptTurnView({ turn }: { turn: TranscriptTurn }) {
  const { timelineMode } = useContext(ActivityDisplaySettingsContext);
  const agentGroups = useMemo(() => groupTranscriptItems(turn.agentItems), [turn.agentItems]);
  const compactGroups = useMemo(() => timelineMode === "compact" ? groupCompactActivityGroups(agentGroups) : null, [agentGroups, timelineMode]);
  return (
    <div className="transcript-turn">
      {turn.userItems.length > 0 && (
        <div className="transcript-turn-users">
          {turn.userItems.map((item) => <MemoTranscript key={item.id} item={item} />)}
        </div>
      )}
      {turn.agentItems.length > 0 && (
        <div className="transcript-turn-agent">
          {timelineMode === "compact"
            ? compactGroups?.map((group) => group.kind === "activity"
              ? <MemoCompactRuntimeTranscriptGroup key={group.key} items={group.items} blocks={group.blocks} />
              : <MemoTranscript key={group.item.id} item={group.item} />)
            : agentGroups.map((group) => group.kind === "runtime"
              ? <MemoRuntimeTranscriptGroup key={group.key} items={group.items} />
              : <MemoTranscript key={group.item.id} item={group.item} />)}
        </div>
      )}
    </div>
  );
}

const MemoTranscriptTurn = memo(
  TranscriptTurnView,
  (previous, next) => previous.turn.key === next.turn.key
    && transcriptItemsShallowEqual(previous.turn.userItems, next.turn.userItems)
    && transcriptItemsShallowEqual(previous.turn.agentItems, next.turn.agentItems),
);

const TRANSCRIPT_TURN_GAP_PX = 32;
const TRANSCRIPT_VIRTUAL_OVERSCAN = 8;

type TranscriptViewProps = {
  items: TranscriptItem[];
  timelineMode: TimelineMode;
  historyLoading: boolean;
  piVersion: string | null;
  commands: CommandInfo[];
  isStreaming: boolean;
  generationStatus: GenerationStatus | null;
  disableVirtualizerScrollCorrection: boolean;
  transcriptRef: RefObject<HTMLElement | null>;
  transcriptContentRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onWheel: (event: ReactWheelEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
};

const TranscriptView = memo(function TranscriptView({
  items,
  timelineMode,
  historyLoading,
  piVersion,
  commands,
  isStreaming,
  generationStatus,
  disableVirtualizerScrollCorrection,
  transcriptRef,
  transcriptContentRef,
  onScroll,
  onWheel,
  onPointerDown,
}: TranscriptViewProps) {
  const turns = useMemo(() => buildTranscriptTurns(items), [items]);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const measuredHeightsRef = useRef(new Map<string, number>());
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [, setScrollElementReady] = useState(false);

  const estimateSize = useCallback((index: number) => {
    const turn = turnsRef.current[index];
    if (!turn) return 64;
    return measuredHeightsRef.current.get(turn.key) ?? estimateTranscriptTurnHeight(turn);
  }, []);

  const getItemKey = useCallback((index: number) => turnsRef.current[index]?.key ?? index, []);

  const measureTranscriptRow = useCallback((element: HTMLDivElement) => {
    const rawHeight = element.getBoundingClientRect().height;
    const key = element.dataset.turnKey;
    if (!key || !Number.isFinite(rawHeight) || rawHeight <= 0) return rawHeight;

    measuredHeightsRef.current.set(key, rawHeight);
    return rawHeight;
  }, []);

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: turns.length,
    getScrollElement: () => transcriptRef.current as HTMLDivElement | null,
    estimateSize,
    measureElement: measureTranscriptRow,
    overscan: TRANSCRIPT_VIRTUAL_OVERSCAN,
    gap: TRANSCRIPT_TURN_GAP_PX,
    scrollMargin,
    getItemKey,
    useFlushSync: false,
    // Keep virtual rows transform-free. The old Electron Molten Forge used
    // TanStack Virtual's position mode specifically because transformed
    // ancestors break sticky code headers (and viewport-fixed descendants).
    directDomUpdates: true,
    directDomUpdatesMode: "position",
  });

  useLayoutEffect(() => {
    measuredHeightsRef.current.clear();
    virtualizer.measure();
  }, [timelineMode, virtualizer]);

  // Molten Forge owns transcript scroll position while Pi is streaming: the
  // original Electron moving-bottom rAF lerp owns live follow, while
  // reader-owned sessions render a frozen turn and perform no generation-driven
  // scroll writes. The only reader-anchor correction is the bounded final
  // visual flush. TanStack Virtual must not become a second scroll writer during
  // either interval.
  // Outside those intervals its normal row-size correction is restored.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = disableVirtualizerScrollCorrection
    ? () => false
    : undefined;

  const setListElement = useCallback((element: HTMLDivElement | null) => {
    listRef.current = element;
    virtualizer.containerRef(element);
  }, [virtualizer]);

  useEffect(() => {
    if (transcriptRef.current) setScrollElementReady(true);
  }, [transcriptRef]);

  useEffect(() => {
    const activeKeys = new Set(turns.map((turn) => turn.key));
    for (const key of measuredHeightsRef.current.keys()) {
      if (!activeKeys.has(key)) measuredHeightsRef.current.delete(key);
    }
  }, [turns]);

  useLayoutEffect(() => {
    const scrollElement = transcriptRef.current;
    const list = listRef.current;
    if (!scrollElement || !list) return;

    let previousWidth = list.getBoundingClientRect().width;
    const measure = () => {
      const nextMargin = list.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop;
      setScrollMargin((previous) => Math.abs(previous - nextMargin) < 1 ? previous : nextMargin);

      const width = list.getBoundingClientRect().width;
      if (Math.abs(width - previousWidth) >= 1) {
        previousWidth = width;
        measuredHeightsRef.current.clear();
        virtualizer.measure();
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    observer.observe(list);
    return () => observer.disconnect();
  }, [transcriptRef, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const isEmpty = items.length === 0 && !historyLoading;
  const isHistoryLoading = items.length === 0 && historyLoading;

  // Empty/new sessions reuse the same outer transcript scroll element as the
  // previously opened chat. Reset after the empty-state commit, not only when
  // history data arrives: removing a tall virtualized list can otherwise leave
  // the preserved scrollTop applied to the newly mounted welcome state. The
  // layout effect runs before paint; the two settling frames cover late virtual
  // row cleanup without reintroducing bottom-follow behavior.
  useLayoutEffect(() => {
    if (!isEmpty) return;
    const transcript = transcriptRef.current;
    if (!transcript) return;

    let frame = 0;
    let remainingFrames = 2;
    const landAtTop = () => {
      const current = transcriptRef.current;
      if (!current) return;
      if (current.scrollTop !== 0) current.scrollTop = 0;
      remainingFrames -= 1;
      if (remainingFrames > 0) frame = window.requestAnimationFrame(landAtTop);
    };

    transcript.scrollTop = 0;
    frame = window.requestAnimationFrame(landAtTop);
    return () => window.cancelAnimationFrame(frame);
  }, [isEmpty, transcriptRef]);

  return (
    <section className={`transcript${isEmpty ? " transcript-empty" : ""}${isHistoryLoading ? " transcript-history-loading" : ""}`} ref={transcriptRef} onScroll={onScroll} onWheel={onWheel} onPointerDown={onPointerDown}>
      <div className="transcript-content" ref={transcriptContentRef}>
        {isEmpty ? (
          <div className="empty-state">
            <PiStartupWelcome piVersion={piVersion} commands={commands} />
          </div>
        ) : isHistoryLoading ? (
          <div className="transcript-history-placeholder" aria-label="Loading conversation" />
        ) : (
          <div
            ref={setListElement}
            className="virtual-transcript-list"
          >
            {virtualItems.map((virtualItem) => {
              const turn = turns[virtualItem.index];
              if (!turn) return null;
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  data-turn-key={turn.key}
                  ref={(element) => {
                    if (!element) return;
                    virtualizer.measureElement(element);
                  }}
                  // Position is written directly by TanStack Virtual in
                  // directDomUpdatesMode="position". Do not add transform/top
                  // here: sticky code headers depend on a transform-free chain.
                  className="virtual-transcript-row"
                >
                  <MemoTranscriptTurn turn={turn} />
                </div>
              );
            })}
          </div>
        )}
        {isStreaming && (
          <div className="generation-status" aria-live="polite">
            <MoltenForgeGenerationSpinner />
            <span className="generating-gradient-text">{generationStatus ?? "Working"}</span>
          </div>
        )}
      </div>
    </section>
  );
});

function commandListText(commands: CommandInfo[]) {
  return commands.map((command) => `- \`/${command.name}\`${command.description ? ` — ${command.description}` : ""} *(${command.source})*`).join("\n");
}

