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
  Info,
  ListTodo,
  Lock,
  MessageSquareText,
  Moon,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCcw,
  Save as SaveIcon,
  Search,
  Send,
  Settings,
  Square,
  Sun,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import type {
  ComponentProps,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
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
import { ToolsDialog } from "@/components/tools-dialog";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildTokenMetrics,
  createId,
  createNewProvider,
  createProviderId,
  formatOptionalNumber,
  getActiveVariant,
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
  saveToolsSettings,
} from "@/lib/ai-chat/storage";
import { runQueuedTool } from "@/lib/ai-chat/tool-execution-queue";
import type {
  AskUserOption,
  AskUserQuestion,
  AskUserQuestionType,
  AskUserRequest,
  AskUserResponse,
  ChatAssistantProcessStep,
  ChatAssistantVariant,
  ChatMessage,
  ChatSession,
  ChatToolCall,
  ChatToolResult,
  ChecklistItem,
  ChecklistWriteRequest,
  LoadedToolInfo,
  ProviderConfig,
  ProviderGenerationSettings,
  ProvidersState,
  ToolExecutionPreview,
  ToolExecutionStatus,
  ToolsSettings,
  UserInputStatus,
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
const FORCED_SCROLL_SETTLE_FRAMES = 8;
const SIDEBAR_COLLAPSED_STORAGE_KEY = "chat-forge-sidebar-collapsed";
const COMPOSER_DRAFTS_STORAGE_KEY = "chat-forge-composer-drafts";
const DEFAULT_TOOLS_SETTINGS: ToolsSettings = {
  enabled: true,
  askUserEnabled: true,
  checklistWriteEnabled: true,
};
const ASK_USER_TOOL_NAME = "ask_user";
const CHECKLIST_WRITE_TOOL_NAME = "checklist_write";
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOOL_MENTION_PATTERN = /(^|\s)@tool:([A-Za-z0-9_-]+)(?=$|\s)/g;
const ASK_USER_CUSTOM_ANSWER_ID = "__custom__";
const MAX_ASK_USER_QUESTIONS = 5;
const MAX_ASK_USER_OPTIONS = 8;
const MAX_ASK_USER_TITLE_LENGTH = 120;
const MAX_ASK_USER_DESCRIPTION_LENGTH = 500;
const MAX_ASK_USER_QUESTION_LENGTH = 500;
const MAX_ASK_USER_OPTION_LABEL_LENGTH = 160;
const MAX_ASK_USER_OPTION_DESCRIPTION_LENGTH = 300;
const MAX_ASK_USER_CUSTOM_ANSWER_LENGTH = 2000;
const MAX_CHECKLIST_ITEMS = 10;
const MAX_CHECKLIST_CONTENT_LENGTH = 180;
const ASK_USER_TOOL: LoadedToolInfo = {
  id: "builtin-ask-user",
  name: ASK_USER_TOOL_NAME,
  enabled: true,
  description:
    "Pause and ask the user focused clarification questions, then continue the same response. Supports single_choice, multi_select, and text questions. Use text when the user must provide a custom value such as a number, name, or range. For choice questions, use concise option labels and strongly prefer one-sentence option descriptions. Use only when the answer materially changes the next step.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        description: "Short heading for the question form.",
      },
      description: {
        type: "string",
        description: "Optional short explanation of why this input is needed.",
      },
      questions: {
        type: "array",
        description:
          "One to five questions. Each question must set type to single_choice, multi_select, or text.",
        minItems: 1,
        maxItems: MAX_ASK_USER_QUESTIONS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: {
              type: "string",
              description: "Stable snake_case answer key.",
            },
            type: {
              type: "string",
              enum: ["single_choice", "multi_select", "text"],
              description:
                "Use single_choice for one option, multi_select for several options, and text for custom-only user input.",
            },
            question: { type: "string" },
            description: { type: "string" },
            input: {
              type: "object",
              additionalProperties: false,
              description:
                "Only for text questions. Set multiline to true for longer free-form answers.",
              properties: {
                multiline: { type: "boolean" },
              },
            },
            options: {
              type: "array",
              description:
                "Required for single_choice and multi_select. Use concise labels and strongly prefer one-sentence gray-helper descriptions. Do not include Other/custom; Chat Forge adds a custom typed answer option automatically for choice questions.",
              minItems: 2,
              maxItems: MAX_ASK_USER_OPTIONS,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  label: {
                    type: "string",
                    description: "Short option label, usually 1-5 words.",
                  },
                  description: {
                    type: "string",
                    description:
                      "Strongly recommended one-sentence explanation shown below the label.",
                  },
                },
                required: ["id", "label"],
              },
            },
          },
          required: ["id", "type", "question"],
        },
      },
    },
    required: ["questions"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};
const CHECKLIST_WRITE_TOOL: LoadedToolInfo = {
  id: "builtin-checklist-write",
  name: CHECKLIST_WRITE_TOOL_NAME,
  enabled: true,
  description:
    "Create or update a visible checklist snapshot to track progress during complex multi-step work. Use this for substantial coding, debugging, research, or planning tasks. Keep items short. Each item must explicitly set done to true or false.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        description:
          "Checklist items. Include the full current checklist snapshot. Each item must explicitly set done to true or false.",
        minItems: 1,
        maxItems: MAX_CHECKLIST_ITEMS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            content: {
              type: "string",
              description: "Short user-visible checklist item.",
            },
            done: {
              type: "boolean",
              description:
                "Whether this item is completed. Always provide true or false.",
            },
          },
          required: ["content", "done"],
        },
      },
    },
    required: ["items"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};
const MAX_TOOL_ROUNDS = 20;
const TOOL_DESCRIPTION_PREVIEW_MAX_LENGTH = 95;

function isValidToolName(toolName: string) {
  return TOOL_NAME_PATTERN.test(toolName);
}

function isBuiltInToolName(toolName: string) {
  return toolName === ASK_USER_TOOL_NAME || toolName === CHECKLIST_WRITE_TOOL_NAME;
}

function compareToolsByDisplayOrder(
  left: Pick<LoadedToolInfo, "name">,
  right: Pick<LoadedToolInfo, "name">,
) {
  const leftIsBuiltIn = isBuiltInToolName(left.name);
  const rightIsBuiltIn = isBuiltInToolName(right.name);

  if (leftIsBuiltIn !== rightIsBuiltIn) return leftIsBuiltIn ? -1 : 1;

  return left.name.localeCompare(right.name);
}

function parseToolMentionNames(content: string) {
  const names: string[] = [];
  const seen = new Set<string>();
  const pattern = new RegExp(TOOL_MENTION_PATTERN);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const name = match[2]?.trim();
    if (!name || seen.has(name)) continue;

    seen.add(name);
    names.push(name);
  }

  return names;
}

function UserMessageContent({ content }: { content: string }) {
  const parts: ReactNode[] = [];
  const pattern = new RegExp(TOOL_MENTION_PATTERN);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const prefix = match[1] ?? "";
    const toolName = match[2] ?? "";
    const token = `@tool:${toolName}`;
    const tokenStartIndex = match.index + prefix.length;

    if (tokenStartIndex > lastIndex) {
      parts.push(content.slice(lastIndex, tokenStartIndex));
    }

    parts.push(
      <span
        key={`${tokenStartIndex}-${token}`}
        className="inline-flex items-center rounded-md border border-primary-foreground/25 bg-primary-foreground/15 px-1.5 py-0.5 font-mono text-[0.875em] font-medium leading-5 text-primary-foreground"
        title={`One-shot tool for this request: ${toolName}`}
      >
        {token}
      </span>,
    );

    lastIndex = tokenStartIndex + token.length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return <div className="whitespace-pre-wrap">{parts}</div>;
}

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

function TooltipIconButton({
  label,
  children,
  className,
  tooltipSide = "top",
  ...props
}: ComponentProps<typeof Button> & {
  label: string;
  children: ReactNode;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          title={label}
          className={cn("h-6 w-6 rounded-lg text-muted-foreground", className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  );
}

const UserMessageEditor = memo(function UserMessageEditor({
  initialContent,
  disabled,
  onCancel,
  onSave,
  onSubmit,
}: {
  initialContent: string;
  disabled: boolean;
  onCancel: () => void;
  onSave: (content: string) => void | Promise<void>;
  onSubmit: (content: string) => void | Promise<void>;
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

  function handleSubmit() {
    if (disabled || !trimmedContent) return;

    void onSubmit(content);
  }

  return (
    <div className="grid min-w-0 max-w-full gap-2">
      <article className="flex justify-end">
        <div className="min-w-0 w-full overflow-hidden bg-primary rounded-lg px-4 py-3 text-base leading-6 text-primary-foreground shadow-xs [overflow-wrap:anywhere]">
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }

              if ((event.ctrlKey || event.metaKey) && event.key === "s") {
                event.preventDefault();
                handleSave();
              }

              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                handleSubmit();
              }
            }}
            autoFocus
            disabled={disabled}
            className="min-h-[12rem] max-h-[32rem] w-full resize-y rounded-none border-0 !bg-transparent p-0 text-primary-foreground shadow-none outline-none placeholder:text-primary-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-80"
          />
        </div>
      </article>

      <div className="flex justify-end gap-1.5 text-sm leading-5 text-muted-foreground">
        <TooltipIconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label="Save edit"
          onClick={handleSave}
          disabled={disabled || !trimmedContent}
        >
          <SaveIcon className="size-3" />
        </TooltipIconButton>
        <TooltipIconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label="Submit edit and regenerate"
          onClick={handleSubmit}
          disabled={disabled || !trimmedContent}
        >
          <Send className="size-3" />
        </TooltipIconButton>
        <TooltipIconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label="Cancel edit"
          onClick={onCancel}
          disabled={disabled}
        >
          <X className="size-3" />
        </TooltipIconButton>
      </div>
    </div>
  );
});

function getAskUserQuestionType(
  question: AskUserQuestion,
): AskUserQuestionType {
  if (
    question.type === "multi_select" ||
    question.type === "text" ||
    question.type === "single_choice"
  ) {
    return question.type;
  }

  return "single_choice";
}

function createDefaultAskUserAnswers(request: AskUserRequest) {
  return Object.fromEntries(
    request.questions.map((question) => {
      const questionType = getAskUserQuestionType(question);
      if (questionType === "text" || questionType === "multi_select") {
        return [question.id, ""];
      }

      return [question.id, question.options[0]?.id ?? ""];
    }),
  );
}

function createDefaultAskUserMultiAnswers(request: AskUserRequest) {
  return Object.fromEntries(
    request.questions.map((question) => [question.id, [] as string[]]),
  );
}

function createEmptyAskUserCustomAnswers(request: AskUserRequest) {
  return Object.fromEntries(
    request.questions.map((question) => [question.id, ""]),
  );
}

function formatUserInputStatus(status: UserInputStatus | undefined) {
  if (status === "complete") return "Complete";
  if (status === "cancelled") return "Cancelled";
  if (status === "failed") return "Failed";
  return "Waiting";
}

const AskUserBlock = memo(function AskUserBlock({
  id,
  request,
  response,
  status,
  canSubmit,
  isCollapsed,
  onToggleCollapsed,
  onSubmit,
  onCancel,
  onLayoutChange,
}: {
  id: string;
  request: AskUserRequest;
  response?: AskUserResponse;
  status?: UserInputStatus;
  canSubmit: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onSubmit: (response: AskUserResponse) => void;
  onCancel: () => void;
  onLayoutChange?: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    createDefaultAskUserAnswers(request),
  );
  const [multiAnswers, setMultiAnswers] = useState<Record<string, string[]>>(
    () => createDefaultAskUserMultiAnswers(request),
  );
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>(
    () => createEmptyAskUserCustomAnswers(request),
  );
  const effectiveStatus = status ?? "waiting";
  const isWaiting = effectiveStatus === "waiting";
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const activeQuestionCount = request.questions.length;
  const activeQuestion =
    request.questions[activeQuestionIndex] ?? request.questions[0];

  useEffect(() => {
    setAnswers(response?.answers ?? createDefaultAskUserAnswers(request));
    setMultiAnswers(
      response?.multiAnswers ?? createDefaultAskUserMultiAnswers(request),
    );
    setCustomAnswers(
      response?.customAnswers ?? createEmptyAskUserCustomAnswers(request),
    );
    setActiveQuestionIndex(0);
  }, [request, response]);

  useLayoutEffect(() => {
    onLayoutChange?.();
  }, [
    activeQuestionIndex,
    isCollapsed,
    effectiveStatus,
    response,
    onLayoutChange,
  ]);

  function getSelectedOptionLabel(questionId: string, optionId?: string) {
    const question = request.questions.find((item) => item.id === questionId);
    if (optionId === ASK_USER_CUSTOM_ANSWER_ID) {
      return (
        customAnswers[questionId]?.trim() ||
        response?.customAnswers?.[questionId]?.trim() ||
        "Type your answer"
      );
    }

    return (
      question?.options.find((option) => option.id === optionId)?.label ??
      optionId ??
      ""
    );
  }

  function getMultiAnswerLabels(
    question: AskUserQuestion,
    optionIds: string[],
  ) {
    return optionIds
      .map((optionId) => getSelectedOptionLabel(question.id, optionId))
      .filter(Boolean);
  }

  function getAnswerSummary(question: AskUserQuestion) {
    const questionType = getAskUserQuestionType(question);
    const responseLabel = response?.answerLabels?.[question.id];

    if (Array.isArray(responseLabel)) {
      return responseLabel.join(", ");
    }

    if (typeof responseLabel === "string" && responseLabel.trim()) {
      return responseLabel.trim();
    }

    if (questionType === "multi_select") {
      const selectedIds = response?.multiAnswers?.[question.id] ?? [];
      return getMultiAnswerLabels(question, selectedIds).join(", ");
    }

    if (questionType === "text") {
      return response?.answers[question.id] ?? answers[question.id] ?? "";
    }

    const selectedOptionId =
      response?.answers[question.id] ?? answers[question.id];
    if (selectedOptionId === ASK_USER_CUSTOM_ANSWER_ID) {
      return (
        response?.customAnswers?.[question.id] ??
        customAnswers[question.id] ??
        "Type your answer"
      );
    }

    return getSelectedOptionLabel(question.id, selectedOptionId);
  }

  function isQuestionAnswered(question: AskUserQuestion | undefined) {
    if (!question) return false;

    const questionType = getAskUserQuestionType(question);
    if (questionType === "text") {
      return Boolean(answers[question.id]?.trim());
    }

    if (questionType === "multi_select") {
      const selectedIds = multiAnswers[question.id] ?? [];
      return selectedIds.some((optionId) => {
        if (optionId !== ASK_USER_CUSTOM_ANSWER_ID) return true;
        return Boolean(customAnswers[question.id]?.trim());
      });
    }

    const selectedAnswer = answers[question.id];
    if (selectedAnswer === ASK_USER_CUSTOM_ANSWER_ID) {
      return Boolean(customAnswers[question.id]?.trim());
    }

    return question.options.some((option) => option.id === selectedAnswer);
  }

  const allQuestionsAnswered = request.questions.every((question) =>
    isQuestionAnswered(question),
  );
  const canSendAnswers = isWaiting && canSubmit && allQuestionsAnswered;

  function goToPreviousQuestion() {
    setActiveQuestionIndex((current) => Math.max(0, current - 1));
  }

  function goToNextQuestion() {
    if (!isQuestionAnswered(activeQuestion)) return;
    setActiveQuestionIndex((current) =>
      Math.min(activeQuestionCount - 1, current + 1),
    );
  }

  function advanceOrSubmitActiveQuestion() {
    if (!isQuestionAnswered(activeQuestion)) return;

    if (activeQuestionIndex < activeQuestionCount - 1) {
      goToNextQuestion();
      return;
    }

    handleSubmit();
  }

  function handleSingleLineAnswerKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    advanceOrSubmitActiveQuestion();
  }

  function handleMultilineAnswerKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;

    event.preventDefault();
    advanceOrSubmitActiveQuestion();
  }

  function renderCompletedAnswerList() {
    if (!response) return null;

    return (
      <ul className="mt-2 grid list-disc gap-2 pl-4 text-sm normal-case leading-5 tracking-normal">
        {request.questions.map((question) => (
          <li key={question.id} className="pl-1">
            <div className="grid gap-0">
              <span className="text-muted-foreground">{question.question}</span>
              <span className="font-medium text-foreground/85">
                {getAnswerSummary(question)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  function renderTextAnswer(question: AskUserQuestion, readOnly = false) {
    const value = readOnly
      ? (response?.answers[question.id] ?? "")
      : (answers[question.id] ?? "");
    const updateAnswer = (nextValue: string) => {
      setAnswers((current) => ({
        ...current,
        [question.id]: nextValue.slice(0, MAX_ASK_USER_CUSTOM_ANSWER_LENGTH),
      }));
    };

    if (question.input?.multiline) {
      return (
        <Textarea
          value={value}
          disabled={readOnly || !canSubmit}
          readOnly={readOnly}
          maxLength={MAX_ASK_USER_CUSTOM_ANSWER_LENGTH}
          onChange={(event) => updateAnswer(event.target.value)}
          onKeyDown={handleMultilineAnswerKeyDown}
          className="min-h-24 rounded-lg text-sm"
        />
      );
    }

    return (
      <Input
        value={value}
        disabled={readOnly || !canSubmit}
        readOnly={readOnly}
        maxLength={MAX_ASK_USER_CUSTOM_ANSWER_LENGTH}
        onChange={(event) => updateAnswer(event.target.value)}
        onKeyDown={handleSingleLineAnswerKeyDown}
        className="h-8 rounded-lg text-sm"
      />
    );
  }

  function focusAdjacentChoiceOption(
    event: ReactKeyboardEvent<HTMLElement>,
    direction: -1 | 1,
  ) {
    const container = event.currentTarget.parentElement;
    if (!container) return;

    const optionElements = Array.from(
      container.querySelectorAll<HTMLElement>("[data-ask-user-option]"),
    ).filter((element) => element.tabIndex >= 0);
    const currentIndex = optionElements.indexOf(event.currentTarget);
    if (currentIndex < 0 || optionElements.length === 0) return;

    event.preventDefault();

    const nextIndex =
      (currentIndex + direction + optionElements.length) %
      optionElements.length;
    optionElements[nextIndex]?.focus();
  }

  function handleChoiceOptionKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    onSelect?: () => void,
  ) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      focusAdjacentChoiceOption(event, 1);
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      focusAdjacentChoiceOption(event, -1);
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    onSelect?.();
  }

  function renderChoiceOption({
    question,
    option,
    checked,
    inputType,
    inputId,
    inputName,
    readOnly = false,
    onChange,
  }: {
    question: AskUserQuestion;
    option: AskUserOption;
    checked: boolean;
    inputType: "radio" | "checkbox";
    inputId?: string;
    inputName?: string;
    readOnly?: boolean;
    onChange?: () => void;
  }) {
    const isInteractive = !readOnly && canSubmit;

    return (
      <div
        key={option.id}
        role={inputType}
        aria-checked={checked}
        tabIndex={isInteractive ? 0 : -1}
        data-ask-user-option
        className={cn(
          "flex items-start gap-2 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          checked
            ? "border-primary/50 bg-primary/10 text-foreground"
            : "border-border/70 bg-background/60",
          isInteractive && "cursor-pointer hover:bg-muted/60",
          !isInteractive && "cursor-default opacity-90",
        )}
        onClick={() => {
          if (!isInteractive) return;
          onChange?.();
        }}
        onKeyDown={(event) => handleChoiceOptionKeyDown(event, onChange)}
      >
        <input
          id={inputId}
          type={inputType}
          name={inputName}
          value={option.id}
          checked={checked}
          readOnly={readOnly}
          disabled={readOnly || !canSubmit}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          onChange={onChange}
          className="mt-1 size-3.5 shrink-0 accent-primary"
        />
        <span className="grid gap-0.5">
          <span className="text-sm font-medium leading-5 text-foreground">
            {option.label}
          </span>
          {option.description?.trim() && (
            <span className="text-sm leading-5 text-muted-foreground">
              {option.description.trim()}
            </span>
          )}
        </span>
      </div>
    );
  }

  function renderCustomChoiceOption({
    question,
    checked,
    inputType,
    inputName,
    readOnly = false,
    onSelect,
  }: {
    question: AskUserQuestion;
    checked: boolean;
    inputType: "radio" | "checkbox";
    inputName?: string;
    readOnly?: boolean;
    onSelect?: () => void;
  }) {
    const customInputId = `${id}-${question.id}-custom-text`;
    const customAnswer = readOnly
      ? (response?.customAnswers?.[question.id] ?? "")
      : (customAnswers[question.id] ?? "");
    const isInteractive = !readOnly && canSubmit;
    const customDescription =
      readOnly && checked && customAnswer.trim()
        ? customAnswer.trim()
        : "Enter a custom answer instead of choosing one of the suggested options.";

    return (
      <div
        role={inputType}
        aria-checked={checked}
        tabIndex={isInteractive ? 0 : -1}
        data-ask-user-option
        className={cn(
          "grid gap-2 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          checked
            ? "border-primary/50 bg-primary/10 text-foreground"
            : "border-border/70 bg-background/60",
          isInteractive && "cursor-pointer hover:bg-muted/60",
          !isInteractive && "cursor-default opacity-90",
        )}
        onClick={() => {
          if (!isInteractive) return;
          onSelect?.();
        }}
        onKeyDown={(event) => handleChoiceOptionKeyDown(event, onSelect)}
      >
        <span className="flex items-start gap-2">
          <input
            type={inputType}
            name={inputName}
            value={ASK_USER_CUSTOM_ANSWER_ID}
            checked={checked}
            readOnly={readOnly}
            disabled={readOnly || !canSubmit}
            onClick={(event) => event.stopPropagation()}
            onChange={onSelect}
            className="mt-1 size-3.5 shrink-0 accent-primary"
          />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium leading-5 text-foreground">
              Type your answer
            </span>
            <span className="text-sm leading-5 text-muted-foreground">
              {customDescription}
            </span>
          </span>
        </span>
        {!readOnly && (
          <Input
            id={customInputId}
            value={customAnswer}
            onClick={(event) => event.stopPropagation()}
            onFocus={() => {
              if (!isInteractive) return;
              if (inputType === "radio") {
                setAnswers((current) => ({
                  ...current,
                  [question.id]: ASK_USER_CUSTOM_ANSWER_ID,
                }));
                return;
              }

              setMultiAnswers((current) => {
                const selectedIds = current[question.id] ?? [];
                return selectedIds.includes(ASK_USER_CUSTOM_ANSWER_ID)
                  ? current
                  : {
                      ...current,
                      [question.id]: [
                        ...selectedIds,
                        ASK_USER_CUSTOM_ANSWER_ID,
                      ],
                    };
              });
            }}
            onChange={(event) => {
              const nextValue = event.target.value.slice(
                0,
                MAX_ASK_USER_CUSTOM_ANSWER_LENGTH,
              );
              setCustomAnswers((current) => ({
                ...current,
                [question.id]: nextValue,
              }));

              if (inputType === "radio") {
                setAnswers((current) => ({
                  ...current,
                  [question.id]: ASK_USER_CUSTOM_ANSWER_ID,
                }));
                return;
              }

              setMultiAnswers((current) => {
                const selectedIds = current[question.id] ?? [];
                if (nextValue.trim()) {
                  return selectedIds.includes(ASK_USER_CUSTOM_ANSWER_ID)
                    ? current
                    : {
                        ...current,
                        [question.id]: [
                          ...selectedIds,
                          ASK_USER_CUSTOM_ANSWER_ID,
                        ],
                      };
                }

                return {
                  ...current,
                  [question.id]: selectedIds.filter(
                    (optionId) => optionId !== ASK_USER_CUSTOM_ANSWER_ID,
                  ),
                };
              });
            }}
            disabled={!canSubmit}
            maxLength={MAX_ASK_USER_CUSTOM_ANSWER_LENGTH}
            onKeyDown={(event) => {
              event.stopPropagation();
              handleSingleLineAnswerKeyDown(event);
            }}
            className="h-8 rounded-lg text-sm"
          />
        )}
      </div>
    );
  }

  function renderQuestionInput(question: AskUserQuestion) {
    const questionType = getAskUserQuestionType(question);

    if (questionType === "text") {
      return renderTextAnswer(question);
    }

    if (questionType === "multi_select") {
      const selectedIds = multiAnswers[question.id] ?? [];
      return (
        <div className="grid gap-1.5">
          {question.options.map((option) => {
            const inputId = `${id}-${question.id}-${option.id}`;
            const checked = selectedIds.includes(option.id);

            return renderChoiceOption({
              question,
              option,
              checked,
              inputType: "checkbox",
              inputId,
              onChange: () => {
                setMultiAnswers((current) => {
                  const currentIds = current[question.id] ?? [];
                  return {
                    ...current,
                    [question.id]: currentIds.includes(option.id)
                      ? currentIds.filter((item) => item !== option.id)
                      : [...currentIds, option.id],
                  };
                });
              },
            });
          })}
          {renderCustomChoiceOption({
            question,
            checked: selectedIds.includes(ASK_USER_CUSTOM_ANSWER_ID),
            inputType: "checkbox",
            onSelect: () => {
              setMultiAnswers((current) => {
                const currentIds = current[question.id] ?? [];
                return {
                  ...current,
                  [question.id]: currentIds.includes(ASK_USER_CUSTOM_ANSWER_ID)
                    ? currentIds.filter(
                        (item) => item !== ASK_USER_CUSTOM_ANSWER_ID,
                      )
                    : [...currentIds, ASK_USER_CUSTOM_ANSWER_ID],
                };
              });
            },
          })}
        </div>
      );
    }

    const selectedOptionId = answers[question.id] ?? "";
    return (
      <div className="grid gap-1.5">
        {question.options.map((option) => {
          const inputId = `${id}-${question.id}-${option.id}`;
          const checked = selectedOptionId === option.id;

          return renderChoiceOption({
            question,
            option,
            checked,
            inputType: "radio",
            inputId,
            inputName: `${id}-${question.id}`,
            onChange: () =>
              setAnswers((current) => ({
                ...current,
                [question.id]: option.id,
              })),
          });
        })}
        {renderCustomChoiceOption({
          question,
          checked: selectedOptionId === ASK_USER_CUSTOM_ANSWER_ID,
          inputType: "radio",
          inputName: `${id}-${question.id}`,
          onSelect: () =>
            setAnswers((current) => ({
              ...current,
              [question.id]: ASK_USER_CUSTOM_ANSWER_ID,
            })),
        })}
      </div>
    );
  }

  function renderReadOnlyQuestion(question: AskUserQuestion) {
    if (!response) return null;

    const questionType = getAskUserQuestionType(question);

    return (
      <div key={question.id} className="grid gap-3">
        <div className="grid gap-1">
          <div className="text-base font-medium leading-6 text-foreground">
            {question.question}
          </div>
          {question.description?.trim() && (
            <div className="text-sm leading-5 text-muted-foreground">
              {question.description.trim()}
            </div>
          )}
        </div>

        {questionType === "text" ? (
          renderTextAnswer(question, true)
        ) : questionType === "multi_select" ? (
          <div className="grid gap-1.5">
            {question.options.map((option) => {
              const selectedIds = response.multiAnswers?.[question.id] ?? [];
              return renderChoiceOption({
                question,
                option,
                checked: selectedIds.includes(option.id),
                inputType: "checkbox",
                readOnly: true,
              });
            })}
            {renderCustomChoiceOption({
              question,
              checked: Boolean(
                response.multiAnswers?.[question.id]?.includes(
                  ASK_USER_CUSTOM_ANSWER_ID,
                ),
              ),
              inputType: "checkbox",
              readOnly: true,
            })}
          </div>
        ) : (
          <div className="grid gap-1.5">
            {question.options.map((option) =>
              renderChoiceOption({
                question,
                option,
                checked: response.answers[question.id] === option.id,
                inputType: "radio",
                readOnly: true,
              }),
            )}
            {renderCustomChoiceOption({
              question,
              checked:
                response.answers[question.id] === ASK_USER_CUSTOM_ANSWER_ID,
              inputType: "radio",
              readOnly: true,
            })}
          </div>
        )}
      </div>
    );
  }

  function handleSubmit() {
    if (!canSendAnswers) return;

    const normalizedAnswers = Object.fromEntries(
      request.questions.map((question) => {
        const questionType = getAskUserQuestionType(question);
        if (questionType === "multi_select") return [question.id, ""];
        return [question.id, answers[question.id] ?? ""];
      }),
    );
    const normalizedMultiAnswers = Object.fromEntries(
      request.questions
        .filter(
          (question) => getAskUserQuestionType(question) === "multi_select",
        )
        .map((question) => [
          question.id,
          (multiAnswers[question.id] ?? []).filter((optionId) => {
            if (optionId !== ASK_USER_CUSTOM_ANSWER_ID) return true;
            return Boolean(customAnswers[question.id]?.trim());
          }),
        ]),
    );
    const normalizedCustomAnswers = Object.fromEntries(
      request.questions
        .filter((question) => {
          const questionType = getAskUserQuestionType(question);
          if (questionType === "single_choice") {
            return answers[question.id] === ASK_USER_CUSTOM_ANSWER_ID;
          }
          if (questionType === "multi_select") {
            return (multiAnswers[question.id] ?? []).includes(
              ASK_USER_CUSTOM_ANSWER_ID,
            );
          }
          return false;
        })
        .map((question) => [question.id, customAnswers[question.id].trim()]),
    );
    const answerLabels = Object.fromEntries(
      request.questions.map((question) => {
        const questionType = getAskUserQuestionType(question);
        if (questionType === "text") {
          const value = answers[question.id]?.trim() ?? "";
          return [question.id, value];
        }
        if (questionType === "multi_select") {
          const selectedIds = normalizedMultiAnswers[question.id] ?? [];
          return [question.id, getMultiAnswerLabels(question, selectedIds)];
        }

        const selectedAnswer = answers[question.id];
        return [
          question.id,
          selectedAnswer === ASK_USER_CUSTOM_ANSWER_ID
            ? customAnswers[question.id].trim()
            : getSelectedOptionLabel(question.id, selectedAnswer),
        ];
      }),
    );

    onSubmit({
      answers: normalizedAnswers,
      multiAnswers:
        Object.keys(normalizedMultiAnswers).length > 0
          ? normalizedMultiAnswers
          : undefined,
      answerLabels,
      customAnswers:
        Object.keys(normalizedCustomAnswers).length > 0
          ? normalizedCustomAnswers
          : undefined,
      answeredAt: new Date().toISOString(),
    });
  }

  return (
    <article key={id} className="flex min-w-0 max-w-full justify-start">
      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border bg-muted/25 px-4 py-3 text-sm leading-5 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
        <button
          type="button"
          className="w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onToggleCollapsed}
          aria-expanded={!isCollapsed}
        >
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <MessageSquareText className="size-3.5 shrink-0" />
              <span className="truncate">Ask user</span>
              <span className="text-muted-foreground/60">•</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  effectiveStatus === "complete" &&
                    "text-green-600 dark:text-green-400",
                  effectiveStatus === "waiting" &&
                    "text-amber-600 dark:text-amber-400",
                  (effectiveStatus === "cancelled" ||
                    effectiveStatus === "failed") &&
                    "text-red-600 dark:text-red-400",
                )}
              >
                {effectiveStatus === "complete" ? (
                  <Check className="size-3.5" />
                ) : effectiveStatus === "waiting" ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <X className="size-3.5" />
                )}
                {formatUserInputStatus(effectiveStatus)}
              </span>
              <span className="hidden text-muted-foreground/60 sm:inline">
                • {request.questions.length} question
                {request.questions.length === 1 ? "" : "s"}
              </span>
            </div>
            {isCollapsed ? (
              <ChevronRight className="size-3.5 shrink-0" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0" />
            )}
          </div>
          {(request.title?.trim() || request.description?.trim()) && (
            <div className="mt-2 grid gap-1 text-sm normal-case leading-5 tracking-normal text-muted-foreground/85">
              {request.title?.trim() && (
                <div className="font-medium text-foreground/80">
                  {request.title.trim()}
                </div>
              )}
              {request.description?.trim() && (
                <div>{request.description.trim()}</div>
              )}
            </div>
          )}

          {isCollapsed &&
            response &&
            effectiveStatus !== "waiting" &&
            renderCompletedAnswerList()}
        </button>

        {!isCollapsed && (
          <div className="mt-3 grid gap-3">
            {isWaiting &&
              activeQuestion &&
              (() => {
                const question = activeQuestion;
                const currentQuestionAnswered = isQuestionAnswered(question);
                const isFirstQuestion = activeQuestionIndex === 0;
                const isLastQuestion =
                  activeQuestionIndex === activeQuestionCount - 1;

                return (
                  <div className="grid gap-3">
                    {activeQuestionCount > 1 && (
                      <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                        Question {activeQuestionIndex + 1} of{" "}
                        {activeQuestionCount}
                      </div>
                    )}

                    <div className="grid gap-1">
                      <div className="text-base font-medium leading-6 text-foreground">
                        {question.question}
                      </div>
                      {question.description?.trim() && (
                        <div className="text-sm leading-5 text-muted-foreground">
                          {question.description.trim()}
                        </div>
                      )}
                    </div>

                    {renderQuestionInput(question)}

                    {canSubmit && (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-lg"
                          onClick={onCancel}
                        >
                          Cancel
                        </Button>
                        <div className="flex flex-wrap justify-end gap-2">
                          {activeQuestionCount > 1 && !isFirstQuestion && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-lg"
                              onClick={goToPreviousQuestion}
                            >
                              Back
                            </Button>
                          )}
                          {activeQuestionCount > 1 && !isLastQuestion ? (
                            <Button
                              type="button"
                              size="sm"
                              className="rounded-lg"
                              onClick={goToNextQuestion}
                              disabled={!currentQuestionAnswered}
                            >
                              Next
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              className="rounded-lg"
                              onClick={handleSubmit}
                              disabled={!canSendAnswers}
                            >
                              Submit answers
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

            {isWaiting && !canSubmit && (
              <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-sm leading-5 text-muted-foreground">
                This input request is no longer connected to an active
                generation. Regenerate the response to ask again.
              </div>
            )}

            {response && effectiveStatus !== "waiting" && (
              <div className="grid gap-3">
                <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                  Selected answers
                </div>
                <div className="grid gap-6 text-sm leading-5">
                  {request.questions.map((question) =>
                    renderReadOnlyQuestion(question),
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
});

function getChecklistItemIcon(done: boolean) {
  if (done) {
    return <Check className="size-3.5 text-green-600 dark:text-green-400" />;
  }

  return <Square className="size-3.5 text-muted-foreground/70" />;
}

const ChecklistBlock = memo(function ChecklistBlock({
  id,
  request,
  isCollapsed,
  onToggleCollapsed,
  onLayoutChange,
}: {
  id: string;
  request: ChecklistWriteRequest;
  status?: ToolExecutionStatus;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onLayoutChange?: () => void;
}) {
  const totalCount = request.items.length;
  const doneCount = request.items.filter((item) => item.done).length;

  useLayoutEffect(() => {
    onLayoutChange?.();
  }, [doneCount, isCollapsed, onLayoutChange, request.items, totalCount]);

  return (
    <article key={id} className="flex min-w-0 max-w-full justify-start">
      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border bg-muted/25 px-4 py-3 text-sm leading-5 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
        <button
          type="button"
          className="w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onToggleCollapsed}
          aria-expanded={!isCollapsed}
        >
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <ListTodo className="size-3.5 shrink-0" />
              <span className="truncate">Checklist</span>
              <span className="text-muted-foreground/60">•</span>
              <span className="text-muted-foreground/80">
                {doneCount}/{totalCount} done
              </span>
            </div>
            {isCollapsed ? (
              <ChevronRight className="size-3.5 shrink-0" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0" />
            )}
          </div>
        </button>

        {!isCollapsed && (
          <ul className="mt-3 grid gap-0 text-sm normal-case leading-5 tracking-normal">
            {request.items.map((item, index) => (
              <li
                key={`${index}-${item.content}`}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg px-2 py-1.5"
              >
                <span className="mt-0.5">
                  {getChecklistItemIcon(item.done)}
                </span>
                <div
                  className={cn(
                    "min-w-0 font-medium text-foreground/85",
                    item.done &&
                      "text-muted-foreground line-through decoration-muted-foreground/50",
                  )}
                >
                  {item.content}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
});

type ToolMentionOption = {
  name: string;
  description?: string;
  isBuiltin?: boolean;
};

type ActiveToolMention = {
  startIndex: number;
  endIndex: number;
  query: string;
};

function findActiveToolMention(
  content: string,
  cursorIndex: number,
): ActiveToolMention | null {
  const prefix = content.slice(0, cursorIndex);
  const match = /(^|\s)@tool:([A-Za-z0-9_-]*)$/.exec(prefix);

  if (!match) return null;

  const fullMatch = match[0] ?? "";
  const leadingWhitespace = match[1] ?? "";
  const query = match[2] ?? "";
  const startIndex = cursorIndex - fullMatch.length + leadingWhitespace.length;

  return {
    startIndex,
    endIndex: cursorIndex,
    query,
  };
}

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
      draftKey: string;
      draft: string;
      onDraftChange: (draft: string) => void;
      onSend: (content: string) => Promise<boolean> | boolean;
      onStop: () => void;
      footerStart?: ReactNode;
      toolMentionOptions?: ToolMentionOption[];
    }
  >(function ChatComposer(
    {
      disabled,
      isSending,
      draftKey,
      draft,
      onDraftChange,
      onSend,
      onStop,
      footerStart,
      toolMentionOptions = [],
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const toolMentionMenuRef = useRef<HTMLDivElement | null>(null);
    const [localDraft, setLocalDraft] = useState(draft);
    const [activeToolMention, setActiveToolMention] =
      useState<ActiveToolMention | null>(null);
    const [selectedToolSuggestionIndex, setSelectedToolSuggestionIndex] =
      useState(0);
    const trimmedDraft = localDraft.trim();
    const canSend = !disabled && !isSending && trimmedDraft.length > 0;

    const toolMentionSuggestions = useMemo(() => {
      if (!activeToolMention || disabled || isSending) return [];

      const query = activeToolMention.query.trim().toLowerCase();
      const filteredOptions = query
        ? toolMentionOptions.filter((tool) =>
            `${tool.name} ${tool.description ?? ""}`
              .toLowerCase()
              .includes(query),
          )
        : toolMentionOptions;

      return filteredOptions.slice(0, 8);
    }, [activeToolMention, disabled, isSending, toolMentionOptions]);

    const isToolMentionMenuOpen =
      Boolean(activeToolMention) && toolMentionSuggestions.length > 0;

    const updateActiveToolMention = useCallback(
      (value: string, cursorIndex: number | null) => {
        setActiveToolMention(
          findActiveToolMention(value, cursorIndex ?? value.length),
        );
      },
      [],
    );

    const applyToolMentionSuggestion = useCallback(
      (toolName: string) => {
        if (!activeToolMention) return;

        const suffix = localDraft.slice(activeToolMention.endIndex);
        const shouldAddTrailingSpace =
          suffix.length === 0 || !/^\s/.test(suffix);
        const replacement = `@tool:${toolName}${
          shouldAddTrailingSpace ? " " : ""
        }`;
        const nextDraft = `${localDraft.slice(
          0,
          activeToolMention.startIndex,
        )}${replacement}${suffix}`;
        const nextCursorIndex =
          activeToolMention.startIndex + replacement.length;

        setLocalDraft(nextDraft);
        onDraftChange(nextDraft);
        setActiveToolMention(null);
        setSelectedToolSuggestionIndex(0);

        window.requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (!textarea) return;

          textarea.focus({ preventScroll: true });
          textarea.setSelectionRange(nextCursorIndex, nextCursorIndex);
        });
      },
      [activeToolMention, localDraft, onDraftChange],
    );

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
        clear: () => {
          setLocalDraft("");
          onDraftChange("");
          setActiveToolMention(null);
          setSelectedToolSuggestionIndex(0);
        },
        focus: focusTextarea,
      }),
      [focusTextarea, onDraftChange],
    );

    useEffect(() => {
      setLocalDraft(draft);
      setActiveToolMention(null);
      setSelectedToolSuggestionIndex(0);
    }, [draftKey, draft]);

    useEffect(() => {
      setSelectedToolSuggestionIndex(0);
    }, [activeToolMention?.query, toolMentionSuggestions.length]);

    useLayoutEffect(() => {
      if (!isToolMentionMenuOpen) return;

      const selectedElement = toolMentionMenuRef.current?.querySelector(
        `[data-tool-suggestion-index="${selectedToolSuggestionIndex}"]`,
      );
      selectedElement?.scrollIntoView({ block: "nearest" });
    }, [
      activeToolMention?.query,
      isToolMentionMenuOpen,
      selectedToolSuggestionIndex,
      toolMentionSuggestions.length,
    ]);

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
    }, [localDraft]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!canSend) return;

      const wasSent = await onSend(localDraft);
      if (wasSent) {
        setLocalDraft("");
        onDraftChange("");
        setActiveToolMention(null);
        setSelectedToolSuggestionIndex(0);
      }
    }

    return (
      <form
        onSubmit={handleSubmit}
        className="bg-background px-3 py-3 md:px-4 md:py-4"
        data-draft-input
      >
        <div className="mx-auto w-full max-w-3xl border rounded-lg bg-card p-3 pt-0 shadow-sm">
          <div className="mx-auto grid w-full gap-2">
            <div className="relative">
              {isToolMentionMenuOpen && (
                <div
                  ref={toolMentionMenuRef}
                  className="absolute bottom-full left-1/2 z-20 mb-2 max-h-64 w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
                >
                  {toolMentionSuggestions.map((tool, index) => {
                    const isSelected = index === selectedToolSuggestionIndex;

                    return (
                      <button
                        key={tool.name}
                        type="button"
                        data-tool-suggestion-index={index}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applyToolMentionSuggestion(tool.name);
                        }}
                        className={cn(
                          "flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                          isSelected && "bg-accent text-accent-foreground",
                        )}
                        title={tool.description}
                      >
                        <Wrench className="mt-0.5 size-3.5 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5 font-medium">
                            <span className="min-w-0 truncate">{tool.name}</span>
                            {tool.isBuiltin && (
                              <Lock className="size-3 shrink-0 text-muted-foreground" />
                            )}
                          </span>
                          {tool.description && (
                            <span className="mt-0.5 line-clamp-1 text-muted-foreground">
                              {tool.description}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <Textarea
                ref={textareaRef}
                value={localDraft}
                rows={3}
                onChange={(event) => {
                  const nextDraft = event.target.value;
                  setLocalDraft(nextDraft);
                  onDraftChange(nextDraft);
                  updateActiveToolMention(
                    nextDraft,
                    event.target.selectionStart,
                  );
                }}
                onClick={(event) => {
                  updateActiveToolMention(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  );
                }}
                onSelect={(event) => {
                  updateActiveToolMention(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  );
                }}
                onKeyUp={(event) => {
                  if (
                    ![
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                      "Home",
                      "End",
                      "PageUp",
                      "PageDown",
                    ].includes(event.key)
                  ) {
                    return;
                  }

                  updateActiveToolMention(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  );
                }}
                onKeyDown={(event) => {
                  if (isToolMentionMenuOpen) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setSelectedToolSuggestionIndex((index) =>
                        Math.min(index + 1, toolMentionSuggestions.length - 1),
                      );
                      return;
                    }

                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setSelectedToolSuggestionIndex((index) =>
                        Math.max(index - 1, 0),
                      );
                      return;
                    }

                    if (event.key === "Enter" || event.key === "Tab") {
                      const selectedTool =
                        toolMentionSuggestions[selectedToolSuggestionIndex];

                      if (selectedTool) {
                        event.preventDefault();
                        applyToolMentionSuggestion(selectedTool.name);
                        return;
                      }
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      setActiveToolMention(null);
                      setSelectedToolSuggestionIndex(0);
                      return;
                    }
                  }

                  if (event.key !== "Enter") return;

                  if (event.shiftKey) return;

                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
                placeholder="Type a message..."
                className="min-h-[5.5rem] resize-none border-0 !bg-transparent px-1 leading-6 shadow-none focus-visible:ring-0"
              />
            </div>
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

type StreamBufferEvent =
  | {
      type: "content";
      delta: string;
      assistantMessageStepId: string;
    }
  | {
      type: "reasoning";
      delta: string;
      reasoningStepId: string;
    };

type StreamBuffer = {
  chatId: string;
  assistantMessageId: string;
  variantId: string;
  events: StreamBufferEvent[];
};

type ActiveProcessStepRef = {
  type: "thinking" | "assistant_message" | "tool_execution" | "user_input";
  id?: string;
};

type VisibleAssistantProcessStep = ChatAssistantProcessStep & {
  sourceStepIds: string[];
};

function keepOnlyLatestChecklistListStep<T extends ChatAssistantProcessStep>(
  processSteps: T[],
): T[] {
  return processSteps;
}

function cancelUnfinishedChecklistListSteps(
  processSteps: ChatAssistantProcessStep[],
): ChatAssistantProcessStep[] {
  return processSteps;
}

function getVisibleAssistantProcessSteps(
  processSteps: ChatAssistantProcessStep[],
): VisibleAssistantProcessStep[] {
  const visibleSteps: VisibleAssistantProcessStep[] = [];

  for (const step of keepOnlyLatestChecklistListStep(processSteps)) {
    if (step.type === "thinking" && !step.content.trim()) {
      continue;
    }

    const previousStep = visibleSteps[visibleSteps.length - 1];

    if (
      step.type === "assistant_message" &&
      previousStep?.type === "assistant_message"
    ) {
      previousStep.content = `${previousStep.content}${step.content}`;
      previousStep.sourceStepIds = [...previousStep.sourceStepIds, step.id];
      continue;
    }

    visibleSteps.push({ ...step, sourceStepIds: [step.id] });
  }

  return visibleSteps;
}

type ActiveGeneration = {
  controller: AbortController;
  assistantMessageId: string;
  variantId: string;
};

type PendingAskUserRequest = {
  chatId: string;
  assistantMessageId: string;
  variantId: string;
  stepId: string;
  resolve: (result: ChatToolResult) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
};

type MessageContextMenuState = {
  messageId: string;
  x: number;
  y: number;
  linkHref: string | null;
  selectedText: string;
};

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
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResult, setFindResult] =
    useState<FindInPageResultState>(EMPTY_FIND_RESULT);
  const [isSidebarModelComboboxOpen, setIsSidebarModelComboboxOpen] =
    useState(false);
  const [sidebarModelSearchValue, setSidebarModelSearchValue] = useState("");
  const [isChatToolPickerOpen, setIsChatToolPickerOpen] = useState(false);
  const [chatToolSearchValue, setChatToolSearchValue] = useState("");
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isNearChatBottom, setIsNearChatBottom] = useState(true);
  const [showScrollToBottomButton, setShowScrollToBottomButton] =
    useState(false);
  const [isChatScrollable, setIsChatScrollable] = useState(false);
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
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatContentRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const messageElementRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingChatBottomScrollRef = useRef(false);
  const chatComposerRef = useRef<ChatComposerHandle | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const generationRefs = useRef<Record<string, ActiveGeneration>>({});
  const pendingAskUserRequestsRef = useRef<
    Record<string, PendingAskUserRequest>
  >({});
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
  const streamActiveProcessStepRefs = useRef<
    Record<string, ActiveProcessStepRef>
  >({});
  const streamFlushTimeoutRefs = useRef<Record<string, number>>({});
  const didHydrateRef = useRef(false);
  const composerDraftSaveTimeoutRef = useRef<number | null>(null);

  // Auto-scroll state: enabled by default, disabled when user scrolls up
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const autoScrollEnabledRef = useRef(true);

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
    if (toolsSettings.checklistWriteEnabled) names.add(CHECKLIST_WRITE_TOOL_NAME);

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

      saveComposerDrafts(composerDraftsRef.current);
    };
  }, []);

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
    markProgrammaticChatScroll(500);
    setChatAutoScrollEnabled(true);
    setIsNearChatBottom(true);
    setShowScrollToBottomButton(false);
    requestChatBottomScrollAfterRender();
    scheduleStickyScrollToBottom({
      force: true,
      settleFrames: FORCED_SCROLL_SETTLE_FRAMES,
    });
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

    markProgrammaticChatScroll();
    scrollElement.scrollTop = nextScrollTop;
    chatBottomRef.current?.scrollIntoView({ block: "end" });

    const finalScrollTop = Math.max(
      0,
      scrollElement.scrollHeight - scrollElement.clientHeight,
    );
    scrollElement.scrollTop = finalScrollTop;
    lastChatScrollTopRef.current = finalScrollTop;
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

  const handleAskUserLayoutChange = useCallback(() => {
    if (autoScrollEnabledRef.current && !isStickyScrollSuppressed()) {
      scheduleStickyScrollToBottom({ settleFrames: 2 });
      return;
    }

    syncChatScrollState();
  }, []);

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
    if (!activeChatId) return;

    if (autoScrollEnabledRef.current && !isStickyScrollSuppressed()) {
      scheduleStickyScrollToBottom({
        settleFrames: isActiveChatGenerating()
          ? STICKY_SCROLL_SETTLE_FRAMES
          : 2,
      });
      return;
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

  function getGlobalEnabledTools() {
    const enabledCommandTools = toolsSettings.enabled
      ? loadedTools.filter(
          (tool) =>
            tool.enabled &&
            tool.name !== ASK_USER_TOOL_NAME &&
            tool.name !== CHECKLIST_WRITE_TOOL_NAME,
        )
      : [];

    if (!toolsSettings.enabled) return enabledCommandTools;

    return [
      ...(toolsSettings.askUserEnabled ? [ASK_USER_TOOL] : []),
      ...(toolsSettings.checklistWriteEnabled ? [CHECKLIST_WRITE_TOOL] : []),
      ...enabledCommandTools,
    ];
  }

  function getEnabledToolsForChat(
    chat: ChatSession,
    oneShotToolNames: string[] = [],
  ) {
    const byName = new Map<string, LoadedToolInfo>();
    const chatDisabledToolNames = new Set(chat.disabledToolNames ?? []);

    for (const tool of getGlobalEnabledTools()) {
      if (chatDisabledToolNames.has(tool.name)) continue;
      if (!byName.has(tool.name)) byName.set(tool.name, tool);
    }

    for (const toolName of chat.enabledToolNames ?? []) {
      if (chatDisabledToolNames.has(toolName)) continue;

      const tool = availableToolsByName.get(toolName);
      if (tool && !byName.has(tool.name)) byName.set(tool.name, tool);
    }

    for (const toolName of oneShotToolNames) {
      const tool = availableToolsByName.get(toolName);
      if (tool && !byName.has(tool.name)) byName.set(tool.name, tool);
    }

    return [...byName.values()];
  }

  function validateToolMentionsForRequest(content: string) {
    const toolNames = parseToolMentionNames(content);
    const unknownToolNames = toolNames.filter(
      (toolName) => !availableToolsByName.has(toolName),
    );

    if (unknownToolNames.length > 0) {
      showError(
        unknownToolNames.length === 1
          ? `Tool not found: ${unknownToolNames[0]}`
          : `Tools not found: ${unknownToolNames.join(", ")}`,
      );
      return undefined;
    }

    return toolNames;
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

  function formatGenerationInfoJson(metrics: ChatAssistantVariant["metrics"]) {
    if (!metrics) return "{}";

    const usage = metrics.tokenUsage
      ? Object.fromEntries(
          Object.entries({
            prompt_tokens: metrics.tokenUsage.promptTokens,
            completion_tokens: metrics.tokenUsage.completionTokens,
            total_tokens: metrics.tokenUsage.totalTokens,
          }).filter(([, value]) => value !== undefined),
        )
      : undefined;

    const info = Object.fromEntries(
      Object.entries({
        model: metrics.model,
        provider: metrics.providerName,
        finish_reason: metrics.finishReason,
        usage: usage && Object.keys(usage).length > 0 ? usage : undefined,
        duration_ms: metrics.durationMs,
        output_tokens: metrics.outputTokens,
        tokens_per_second: metrics.tokensPerSecond,
        is_approximate: metrics.isApproximate,
        started_at: metrics.startedAt,
        completed_at: metrics.completedAt,
      }).filter(([, value]) => value !== undefined && value !== ""),
    );

    return JSON.stringify(info, null, 2);
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
          <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
            Command
          </div>
          {renderCommandCodeBlock(execution.displayCommand)}
        </div>
        {execution.cwd?.trim() && (
          <div className="grid gap-1.5">
            <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
              Working directory
            </div>
            {renderCodeBlock(execution.cwd, "text")}
          </div>
        )}
      </>
    );
  }

  function formatToolDescriptionPreview(description?: string) {
    const normalizedDescription =
      description?.replace(/\s+/g, " ").trim() || "";
    if (!normalizedDescription) return "";

    if (normalizedDescription.length <= TOOL_DESCRIPTION_PREVIEW_MAX_LENGTH) {
      return normalizedDescription;
    }

    return `${normalizedDescription
      .slice(0, TOOL_DESCRIPTION_PREVIEW_MAX_LENGTH)
      .trimEnd()}…`;
  }

  function getEffectiveToolStatus(
    status: ToolExecutionStatus | undefined,
    result?: ChatToolResult,
  ): ToolExecutionStatus {
    if (result?.isError) return "failed";
    if (result) return "complete";
    return status ?? "running";
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

  function renderToolStatus(status: ToolExecutionStatus) {
    if (status === "failed") {
      return (
        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
          <X className="size-3.5" />
          Failed
        </span>
      );
    }

    if (status === "complete") {
      return (
        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
          <Check className="size-3.5" />
          Complete
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <Spinner className="size-3.5" />
        {status === "pending" ? "Waiting" : "Running"}
      </span>
    );
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
    const effectiveStatus = getEffectiveToolStatus(status, toolResult);
    const isCollapsed = isToolExecutionCollapsed(id);
    const executionPreview = buildToolExecutionPreviewForCall(
      toolCall,
      toolResult,
    );
    const toolInfo = loadedTools.find(
      (candidate) => candidate.name === toolCall.function.name,
    );
    const toolDescription = formatToolDescriptionPreview(toolInfo?.description);
    const showToolInput =
      hasMeaningfulToolInput(toolCall.function.arguments || "") &&
      (!executionPreview || executionPreview.usesStdin);

    return (
      <article key={id} className="flex min-w-0 max-w-full justify-start">
        <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border bg-muted/25 px-4 py-3 text-sm leading-5 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
          <button
            type="button"
            className="w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => toggleToolExecutionCollapsed(id, !isCollapsed)}
            aria-expanded={!isCollapsed}
          >
            <div className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              <div className="flex min-w-0 items-center gap-2">
                <Wrench className="size-3.5 shrink-0" />
                <span className="truncate">{toolCall.function.name}</span>
                <span className="text-muted-foreground/60">•</span>
                {renderToolStatus(effectiveStatus)}
              </div>
              {isCollapsed ? (
                <ChevronRight className="size-3.5 shrink-0" />
              ) : (
                <ChevronDown className="size-3.5 shrink-0" />
              )}
            </div>
            {toolDescription && (
              <div className="mt-2 text-sm normal-case leading-5 tracking-normal text-muted-foreground/85">
                {toolDescription}
              </div>
            )}
          </button>

          {!isCollapsed && (
            <div className="mt-3 grid gap-3">
              {renderToolExecutionPreview(executionPreview)}
              {showToolInput && (
                <div className="grid gap-1.5">
                  <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                    Input
                  </div>
                  {renderJsonCodeBlock(toolCall.function.arguments || "{}")}
                </div>
              )}
              {toolResult?.content.trim() && (
                <div className="grid gap-1.5">
                  <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                    Output
                  </div>
                  {renderJsonCodeBlock(toolResult.content)}
                </div>
              )}
            </div>
          )}
        </div>
      </article>
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
    if (
      !args ||
      typeof args !== "object" ||
      Array.isArray(args) ||
      !(key in args)
    ) {
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

  function readTrimmedString(source: Record<string, unknown>, key: string) {
    const value = source[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  function readLimitedString(
    source: Record<string, unknown>,
    key: string,
    maxLength: number,
    label: string,
  ) {
    const value = readTrimmedString(source, key);
    if (value && value.length > maxLength) {
      throw new Error(`${label} must be ${maxLength} characters or less.`);
    }
    return value;
  }

  function readAskUserQuestionType(
    source: Record<string, unknown>,
  ): AskUserQuestionType {
    const value = readTrimmedString(source, "type");
    if (
      value === "single_choice" ||
      value === "multi_select" ||
      value === "text"
    ) {
      return value;
    }

    return "single_choice";
  }

  function readAskUserInputConfig(source: Record<string, unknown>) {
    const rawInput = source.input;
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      return undefined;
    }

    const inputSource = rawInput as Record<string, unknown>;
    return {
      multiline: inputSource.multiline === true,
    };
  }

  function parseAskUserRequest(args: unknown): AskUserRequest {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("ask_user arguments must be a JSON object.");
    }

    const source = args as Record<string, unknown>;
    const rawQuestions = Array.isArray(source.questions)
      ? source.questions
      : typeof source.question === "string" && Array.isArray(source.options)
        ? [
            {
              id: readTrimmedString(source, "id") ?? "answer",
              question: source.question,
              description: source.description,
              options: source.options,
            },
          ]
        : undefined;

    if (!rawQuestions?.length) {
      throw new Error("ask_user requires at least one question.");
    }

    if (rawQuestions.length > MAX_ASK_USER_QUESTIONS) {
      throw new Error(
        `ask_user supports at most ${MAX_ASK_USER_QUESTIONS} questions.`,
      );
    }

    const questionIds = new Set<string>();
    const questions = rawQuestions.map((rawQuestion, questionIndex) => {
      if (
        !rawQuestion ||
        typeof rawQuestion !== "object" ||
        Array.isArray(rawQuestion)
      ) {
        throw new Error("Each ask_user question must be an object.");
      }

      const questionSource = rawQuestion as Record<string, unknown>;
      const id =
        readTrimmedString(questionSource, "id") ??
        `question_${questionIndex + 1}`;
      const question = readLimitedString(
        questionSource,
        "question",
        MAX_ASK_USER_QUESTION_LENGTH,
        `ask_user question ${id}`,
      );

      if (!question) {
        throw new Error(`ask_user question ${id} is missing text.`);
      }

      if (questionIds.has(id)) {
        throw new Error(`Duplicate ask_user question id: ${id}.`);
      }
      questionIds.add(id);

      const type = readAskUserQuestionType(questionSource);
      const rawOptions = questionSource.options;
      const options = (() => {
        if (type === "text") return [];

        if (!Array.isArray(rawOptions) || rawOptions.length < 2) {
          throw new Error(
            `ask_user ${type} question ${id} requires at least two options.`,
          );
        }

        if (rawOptions.length > MAX_ASK_USER_OPTIONS) {
          throw new Error(
            `ask_user question ${id} supports at most ${MAX_ASK_USER_OPTIONS} options.`,
          );
        }

        const optionIds = new Set<string>();
        return rawOptions.map((rawOption, optionIndex) => {
          if (
            !rawOption ||
            typeof rawOption !== "object" ||
            Array.isArray(rawOption)
          ) {
            throw new Error(
              `ask_user option ${optionIndex + 1} must be an object.`,
            );
          }

          const optionSource = rawOption as Record<string, unknown>;
          const optionId =
            readTrimmedString(optionSource, "id") ??
            `option_${optionIndex + 1}`;
          const label = readLimitedString(
            optionSource,
            "label",
            MAX_ASK_USER_OPTION_LABEL_LENGTH,
            `ask_user option ${optionId} label`,
          );

          if (!label) {
            throw new Error(`ask_user option ${optionId} is missing a label.`);
          }

          if (optionId === ASK_USER_CUSTOM_ANSWER_ID) {
            throw new Error(
              `ask_user option id ${ASK_USER_CUSTOM_ANSWER_ID} is reserved for custom answers.`,
            );
          }

          if (optionIds.has(optionId)) {
            throw new Error(
              `Duplicate ask_user option id ${optionId} in question ${id}.`,
            );
          }
          optionIds.add(optionId);

          return {
            id: optionId,
            label,
            description: readLimitedString(
              optionSource,
              "description",
              MAX_ASK_USER_OPTION_DESCRIPTION_LENGTH,
              `ask_user option ${optionId} description`,
            ),
          };
        });
      })();

      return {
        id,
        type,
        question,
        description: readLimitedString(
          questionSource,
          "description",
          MAX_ASK_USER_DESCRIPTION_LENGTH,
          `ask_user question ${id} description`,
        ),
        options,
        input: readAskUserInputConfig(questionSource),
      };
    });

    return {
      title: readLimitedString(
        source,
        "title",
        MAX_ASK_USER_TITLE_LENGTH,
        "ask_user title",
      ),
      description: readLimitedString(
        source,
        "description",
        MAX_ASK_USER_DESCRIPTION_LENGTH,
        "ask_user description",
      ),
      questions,
    };
  }

  function parseAskUserRequestFromToolCall(toolCall: ChatToolCall) {
    return parseAskUserRequest(
      parseToolArgumentsText(toolCall.function.arguments || "{}"),
    );
  }

  function parseChecklistWriteRequest(args: unknown): ChecklistWriteRequest {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("checklist_write arguments must be a JSON object.");
    }

    const source = args as Record<string, unknown>;
    if (!Array.isArray(source.items) || source.items.length === 0) {
      throw new Error("checklist_write requires at least one checklist item.");
    }

    if (source.items.length > MAX_CHECKLIST_ITEMS) {
      throw new Error(
        `checklist_write supports at most ${MAX_CHECKLIST_ITEMS} items.`,
      );
    }

    const items: ChecklistItem[] = source.items.map((rawItem, index) => {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        throw new Error(`checklist_write item ${index + 1} must be an object.`);
      }

      const itemSource = rawItem as Record<string, unknown>;
      const content = readLimitedString(
        itemSource,
        "content",
        MAX_CHECKLIST_CONTENT_LENGTH,
        `checklist_write item ${index + 1} content`,
      );

      if (!content) {
        throw new Error(
          `checklist_write item ${index + 1} is missing content.`,
        );
      }

      if (typeof itemSource.done !== "boolean") {
        throw new Error(
          `checklist_write item ${index + 1} must explicitly set done to true or false.`,
        );
      }

      return { content, done: itemSource.done };
    });

    return { items };
  }

  function parseChecklistWriteRequestFromToolCall(toolCall: ChatToolCall) {
    return parseChecklistWriteRequest(
      parseToolArgumentsText(toolCall.function.arguments || "{}"),
    );
  }

  function createChecklistWriteToolResult(
    toolCall: ChatToolCall,
    request: ChecklistWriteRequest,
  ): ChatToolResult {
    const done = request.items.filter((item) => item.done).length;

    return {
      toolCallId: toolCall.id,
      toolName: CHECKLIST_WRITE_TOOL_NAME,
      content: JSON.stringify(
        {
          ok: true,
          total: request.items.length,
          done,
        },
        null,
        2,
      ),
    };
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

  function createAskUserToolResult(
    toolCall: ChatToolCall,
    request: AskUserRequest,
    response: AskUserResponse,
  ): ChatToolResult {
    const answers = Object.fromEntries(
      request.questions.map((question) => {
        const questionType = getAskUserQuestionType(question);

        if (questionType === "text") {
          const answer = response.answers[question.id] ?? "";
          return [
            question.id,
            {
              question: question.question,
              answer_type: "text",
              answer,
            },
          ];
        }

        if (questionType === "multi_select") {
          const selectedOptionIds = response.multiAnswers?.[question.id] ?? [];
          const selectedOptionLabels = selectedOptionIds.map((optionId) => {
            if (optionId === ASK_USER_CUSTOM_ANSWER_ID) {
              return response.customAnswers?.[question.id]?.trim() ?? "";
            }

            return (
              question.options.find((option) => option.id === optionId)
                ?.label ?? optionId
            );
          });
          const customAnswer = selectedOptionIds.includes(
            ASK_USER_CUSTOM_ANSWER_ID,
          )
            ? response.customAnswers?.[question.id]?.trim()
            : undefined;

          return [
            question.id,
            {
              question: question.question,
              answer_type: "multi_select",
              selected_option_ids: selectedOptionIds,
              selected_option_labels: selectedOptionLabels,
              ...(customAnswer ? { custom_answer: customAnswer } : {}),
            },
          ];
        }

        const selectedOptionId = response.answers[question.id] ?? "";
        const selectedOption = question.options.find(
          (option) => option.id === selectedOptionId,
        );
        const customAnswer =
          selectedOptionId === ASK_USER_CUSTOM_ANSWER_ID
            ? response.customAnswers?.[question.id]?.trim()
            : undefined;

        return [
          question.id,
          {
            question: question.question,
            answer_type: customAnswer ? "custom" : "option",
            selected_option_id: selectedOptionId,
            selected_option_label:
              response.answerLabels?.[question.id] ??
              customAnswer ??
              selectedOption?.label ??
              selectedOptionId,
            ...(customAnswer ? { custom_answer: customAnswer } : {}),
          },
        ];
      }),
    );

    return {
      toolCallId: toolCall.id,
      toolName: ASK_USER_TOOL_NAME,
      content: JSON.stringify(
        {
          answered_at: response.answeredAt,
          answers,
        },
        null,
        2,
      ),
    };
  }

  async function executeAskUserToolCall(
    toolCall: ChatToolCall,
    options: {
      chatId: string;
      assistantMessageId: string;
      variantId: string;
      stepId: string;
      signal?: AbortSignal;
    },
  ): Promise<ChatToolResult> {
    parseAskUserRequestFromToolCall(toolCall);

    return new Promise<ChatToolResult>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        delete pendingAskUserRequestsRef.current[toolCall.id];
        options.signal?.removeEventListener("abort", abortHandler);
      };

      const settleResolve = (result: ChatToolResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const settleReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const abortHandler = () => {
        updateAssistantUserInputStepStatus(
          options.chatId,
          options.assistantMessageId,
          options.variantId,
          options.stepId,
          "cancelled",
        );
        settleReject(
          new DOMException("Generation was cancelled.", "AbortError"),
        );
      };

      pendingAskUserRequestsRef.current[toolCall.id] = {
        chatId: options.chatId,
        assistantMessageId: options.assistantMessageId,
        variantId: options.variantId,
        stepId: options.stepId,
        resolve: settleResolve,
        reject: settleReject,
        cleanup,
      };

      updateAssistantUserInputStepStatus(
        options.chatId,
        options.assistantMessageId,
        options.variantId,
        options.stepId,
        "waiting",
      );

      if (options.signal?.aborted) {
        abortHandler();
        return;
      }

      options.signal?.addEventListener("abort", abortHandler, { once: true });
    });
  }

  async function executeChecklistWriteToolCall(
    toolCall: ChatToolCall,
  ): Promise<ChatToolResult> {
    const request = parseChecklistWriteRequestFromToolCall(toolCall);
    return createChecklistWriteToolResult(toolCall, request);
  }

  async function executeToolCall(
    toolCall: ChatToolCall,
    options: {
      chatId: string;
      assistantMessageId: string;
      variantId: string;
      stepId: string;
      signal?: AbortSignal;
    },
  ): Promise<ChatToolResult> {
    const toolName = toolCall.function.name;
    const tool = loadedTools.find((candidate) => candidate.name === toolName);

    try {
      if (toolName === ASK_USER_TOOL_NAME) {
        return await executeAskUserToolCall(toolCall, options);
      }

      if (toolName === CHECKLIST_WRITE_TOOL_NAME) {
        return await executeChecklistWriteToolCall(toolCall);
      }

      const argsText = toolCall.function.arguments.trim() || "{}";
      const args = JSON.parse(argsText);
      const result = await runQueuedTool(
        toolName,
        tool,
        () => getToolsBridge().execute({ name: toolName, args }),
        (status) =>
          updateAssistantToolStepStatus(
            options.chatId,
            options.assistantMessageId,
            options.variantId,
            options.stepId,
            status,
          ),
      );

      return {
        toolCallId: toolCall.id,
        toolName: result.toolName || toolName,
        content: result.content,
        isError: result.timedOut || result.exitCode !== 0,
        execution: result.execution,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

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

  function appendToAssistantVariant(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    events: StreamBufferEvent[],
  ) {
    if (!events.length) return;

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

              let contentDelta = "";
              let reasoningDelta = "";
              const contentDeltasByStepId = new Map<string, string>();
              const reasoningDeltasByStepId = new Map<string, string>();

              for (const event of events) {
                if (event.type === "content") {
                  contentDelta += event.delta;
                  contentDeltasByStepId.set(
                    event.assistantMessageStepId,
                    `${contentDeltasByStepId.get(event.assistantMessageStepId) ?? ""}${event.delta}`,
                  );
                } else {
                  reasoningDelta += event.delta;
                  reasoningDeltasByStepId.set(
                    event.reasoningStepId,
                    `${reasoningDeltasByStepId.get(event.reasoningStepId) ?? ""}${event.delta}`,
                  );
                }
              }

              const processSteps = (variant.processSteps ?? []).map((step) => {
                if (step.type === "assistant_message") {
                  const delta = contentDeltasByStepId.get(step.id);
                  return delta
                    ? { ...step, content: step.content + delta }
                    : step;
                }

                if (step.type === "thinking") {
                  const delta = reasoningDeltasByStepId.get(step.id);
                  return delta
                    ? { ...step, content: step.content + delta }
                    : step;
                }

                return step;
              });

              return {
                ...variant,
                content: contentDelta
                  ? variant.content + contentDelta
                  : variant.content,
                reasoning: reasoningDelta
                  ? `${variant.reasoning ?? ""}${reasoningDelta}`
                  : variant.reasoning,
                processSteps,
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
    if (!buffered || buffered.events.length === 0) return;

    const events = buffered.events;
    streamBuffersRef.current[bufferKey] = {
      ...buffered,
      events: [],
    };

    appendToAssistantVariant(
      buffered.chatId,
      buffered.assistantMessageId,
      buffered.variantId,
      events,
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
    event: StreamBufferEvent,
  ) {
    const bufferKey = getStreamBufferKey(chatId, assistantMessageId, variantId);
    const buffered = streamBuffersRef.current[bufferKey] ?? {
      chatId,
      assistantMessageId,
      variantId,
      events: [],
    };

    streamBuffersRef.current[bufferKey] = {
      ...buffered,
      events: [...buffered.events, event],
    };

    scheduleBufferedAssistantFlush(bufferKey);
  }

  function setActiveStreamProcessStep(
    bufferKey: string,
    step: ActiveProcessStepRef,
  ) {
    streamActiveProcessStepRefs.current[bufferKey] = step;
  }

  function getActiveStreamProcessStep(bufferKey: string) {
    return streamActiveProcessStepRefs.current[bufferKey];
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

  function updateAssistantToolStepStatus(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    status: ToolExecutionStatus,
  ) {
    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: (variant.processSteps ?? []).map((step) =>
          step.id === stepId && step.type === "tool_execution"
            ? { ...step, status }
            : step,
        ),
      }),
      { touch: false },
    );
  }

  function updateAssistantUserInputStepStatus(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    status: UserInputStatus,
  ) {
    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: (variant.processSteps ?? []).map((step) =>
          step.id === stepId && step.type === "user_input"
            ? { ...step, status }
            : step,
        ),
      }),
      { touch: false },
    );
  }

  function completeAssistantUserInputStep(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    response: AskUserResponse,
    toolResult: ChatToolResult,
  ) {
    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: (variant.processSteps ?? []).map((step) =>
          step.id === stepId && step.type === "user_input"
            ? {
                ...step,
                status: "complete",
                response,
                toolResult,
              }
            : step,
        ),
      }),
      { touch: false },
    );
  }

  function submitAskUserResponse(
    toolCall: ChatToolCall,
    request: AskUserRequest,
    response: AskUserResponse,
  ) {
    const pendingRequest = pendingAskUserRequestsRef.current[toolCall.id];
    if (!pendingRequest) {
      showError("This input request is no longer active.");
      return;
    }

    const toolResult = createAskUserToolResult(toolCall, request, response);
    completeAssistantUserInputStep(
      pendingRequest.chatId,
      pendingRequest.assistantMessageId,
      pendingRequest.variantId,
      pendingRequest.stepId,
      response,
      toolResult,
    );
    pendingRequest.resolve(toolResult);

    if (pendingRequest.chatId === activeChatId) {
      scheduleStickyScrollToBottom({
        force: true,
        settleFrames: STICKY_SCROLL_SETTLE_FRAMES,
      });
    }
  }

  function cancelAskUserRequest(toolCallId: string) {
    const pendingRequest = pendingAskUserRequestsRef.current[toolCallId];
    if (!pendingRequest) {
      showError("This input request is no longer active.");
      return;
    }

    updateAssistantUserInputStepStatus(
      pendingRequest.chatId,
      pendingRequest.assistantMessageId,
      pendingRequest.variantId,
      pendingRequest.stepId,
      "cancelled",
    );

    generationRefs.current[pendingRequest.chatId]?.controller.abort();
    pendingRequest.reject(
      new DOMException("Generation was cancelled.", "AbortError"),
    );
  }

  function ensureAssistantMessageProcessStep(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    bufferKey: string,
  ) {
    const activeStep = getActiveStreamProcessStep(bufferKey);
    if (activeStep?.type === "assistant_message" && activeStep.id) {
      return activeStep.id;
    }

    const assistantMessageStepId = createId();
    appendAssistantProcessSteps(chatId, assistantMessageId, variantId, [
      { id: assistantMessageStepId, type: "assistant_message", content: "" },
    ]);
    setActiveStreamProcessStep(bufferKey, {
      type: "assistant_message",
      id: assistantMessageStepId,
    });

    return assistantMessageStepId;
  }

  function ensureThinkingProcessStep(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    bufferKey: string,
  ) {
    const activeStep = getActiveStreamProcessStep(bufferKey);
    if (activeStep?.type === "thinking" && activeStep.id) {
      return activeStep.id;
    }

    const thinkingStepId = createId();
    appendAssistantProcessSteps(chatId, assistantMessageId, variantId, [
      { id: thinkingStepId, type: "thinking", content: "" },
    ]);
    setActiveStreamProcessStep(bufferKey, {
      type: "thinking",
      id: thinkingStepId,
    });

    return thinkingStepId;
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
    const chat = chats.find((item) => item.id === chatId);
    const assistantMessage = chat?.messages.find(
      (message): message is Extract<ChatMessage, { role: "assistant" }> =>
        message.id === generation.assistantMessageId &&
        message.role === "assistant",
    );
    const activeVariant = assistantMessage
      ? getActiveVariant(assistantMessage)
      : undefined;
    const visualFlushKeys = [
      generation.assistantMessageId,
      ...(activeVariant?.processSteps ?? []).map(
        (step) => `${generation.assistantMessageId}:${step.id}`,
      ),
    ];

    setVisualFlushRequests((current) => {
      const next = { ...current };
      for (const key of visualFlushKeys) {
        next[key] = (next[key] ?? 0) + 1;
      }
      return next;
    });
    updateAssistantVariant(
      chatId,
      generation.assistantMessageId,
      generation.variantId,
      (variant) => ({
        ...variant,
        processSteps: keepOnlyLatestChecklistListStep(
          cancelUnfinishedChecklistListSteps(variant.processSteps ?? []),
        ),
      }),
      { touch: false },
    );
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
    toolsForRun,
  }: {
    chatId: string;
    contextMessages: ChatMessage[];
    userMessage: string;
    assistantMessageId: string;
    variantId: string;
    responseStartedAtMs: number;
    providerForRun: ProviderConfig;
    toolsForRun: LoadedToolInfo[];
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
      const toolSteps: ChatAssistantProcessStep[] = toolCalls.map(
        (toolCall) => {
          if (toolCall.function.name === ASK_USER_TOOL_NAME) {
            try {
              return {
                id: createId(),
                type: "user_input" as const,
                status: "waiting" as const,
                toolCall,
                request: parseAskUserRequestFromToolCall(toolCall),
              };
            } catch {
              // Keep invalid ask_user calls visible as failed tool executions once
              // executeToolCall returns the validation error.
            }
          }

          if (toolCall.function.name === CHECKLIST_WRITE_TOOL_NAME) {
            try {
              return {
                id: createId(),
                type: "checklist" as const,
                status: "pending" as const,
                toolCall,
                request: parseChecklistWriteRequestFromToolCall(toolCall),
              };
            } catch {
              // Keep invalid checklist_write calls visible as failed tool executions once
              // executeToolCall returns the validation error.
            }
          }

          return {
            id: createId(),
            type: "tool_execution" as const,
            status: "pending" as const,
            toolCall,
          };
        },
      );

      updateAssistantVariant(
        chatId,
        assistantMessageId,
        variantId,
        (variant) => ({
          ...variant,
          toolCalls: [...(variant.toolCalls ?? []), ...toolCalls],
          processSteps: [...(variant.processSteps ?? []), ...toolSteps],
        }),
        { touch: false },
      );

      return new Map(
        toolCalls.map(
          (toolCall, index) =>
            [toolCall.id, toolSteps[index]?.id ?? toolCall.id] as const,
        ),
      );
    };

    const applyToolResultToVisibleStep = (toolResult: ChatToolResult) => {
      updateAssistantVariant(
        chatId,
        assistantMessageId,
        variantId,
        (variant) => ({
          ...variant,
          processSteps: keepOnlyLatestChecklistListStep(
            (variant.processSteps ?? []).map((step) => {
              if (
                step.type !== "tool_execution" &&
                step.type !== "user_input" &&
                step.type !== "checklist"
              ) {
                return step;
              }

              if (step.toolCall.id !== toolResult.toolCallId) return step;

              return {
                ...step,
                status: toolResult.isError ? "failed" : "complete",
                toolResult,
              };
            }),
          ),
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
          const existingResultIds = new Set(
            existingResults.map((result) => result.toolCallId),
          );
          const newResults = toolResults.filter(
            (toolResult) => !existingResultIds.has(toolResult.toolCallId),
          );

          return {
            ...variant,
            toolResults: [...existingResults, ...newResults],
          };
        },
        { touch: false },
      );
    };

    const bufferKey = getStreamBufferKey(chatId, assistantMessageId, variantId);

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
        setActiveStreamProcessStep(bufferKey, {
          type: "thinking",
          id: thinkingStepId,
        });

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
          tools: toolsForRun,
          onContentDelta: (delta) => {
            accumulatedContent += delta;
            const assistantMessageStepId = ensureAssistantMessageProcessStep(
              chatId,
              assistantMessageId,
              variantId,
              bufferKey,
            );
            appendBufferedAssistantVariant(
              chatId,
              assistantMessageId,
              variantId,
              {
                type: "content",
                delta,
                assistantMessageStepId,
              },
            );

            if (chatId === activeChatId) {
              scheduleStickyScrollToBottom();
            }
          },
          onReasoningDelta: (delta) => {
            accumulatedReasoning += delta;

            const activeStep = getActiveStreamProcessStep(bufferKey);
            const isWhitespaceOnlyReasoning = delta.trim().length === 0;

            // Some OpenAI-compatible providers emit whitespace-only reasoning
            // deltas in the middle of normal content streaming. Those invisible
            // reasoning chunks should not split one visible assistant answer into
            // multiple message blocks.
            if (isWhitespaceOnlyReasoning && activeStep?.type !== "thinking") {
              return;
            }

            const reasoningStepId = ensureThinkingProcessStep(
              chatId,
              assistantMessageId,
              variantId,
              bufferKey,
            );
            appendBufferedAssistantVariant(
              chatId,
              assistantMessageId,
              variantId,
              {
                type: "reasoning",
                delta,
                reasoningStepId,
              },
            );

            if (chatId === activeChatId) {
              scheduleStickyScrollToBottom();
            }
          },
        });

        lastStreamResult = streamResult;

        flushBufferedAssistantVariant(bufferKey);

        const toolCalls = streamResult.toolCalls ?? [];
        if (!toolCalls.length) break;

        if (toolRound >= MAX_TOOL_ROUNDS) {
          throw new Error(
            `Stopped after ${MAX_TOOL_ROUNDS} tool rounds to avoid an infinite loop.`,
          );
        }

        const toolStepIdsByToolCallId = appendToolCallsToVariant(toolCalls);
        setActiveStreamProcessStep(bufferKey, { type: "tool_execution" });

        if (chatId === activeChatId) {
          scheduleStickyScrollToBottom({
            force: true,
            settleFrames: STICKY_SCROLL_SETTLE_FRAMES,
          });
        }

        const toolResults = await Promise.all(
          toolCalls.map(async (toolCall) => {
            const toolResult = await executeToolCall(toolCall, {
              chatId,
              assistantMessageId,
              variantId,
              stepId: toolStepIdsByToolCallId.get(toolCall.id) ?? toolCall.id,
              signal: controller.signal,
            });

            applyToolResultToVisibleStep(toolResult);

            if (chatId === activeChatId) {
              scheduleStickyScrollToBottom({
                force: true,
                settleFrames: STICKY_SCROLL_SETTLE_FRAMES,
              });
            }

            return toolResult;
          }),
        );
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

      flushBufferedAssistantVariant(bufferKey);

      markVariantDone(lastStreamResult ?? {});
    } catch (error) {
      const wasAborted =
        error instanceof DOMException && error.name === "AbortError";

      flushBufferedAssistantVariant(bufferKey);

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
          const appendedContent = wasAborted
            ? variant.content
              ? ""
              : "Generation stopped."
            : currentContent
              ? `\n\nError: ${labelForError(error)}`
              : `Error: ${labelForError(error)}`;
          const content = `${variant.content}${appendedContent}`;
          const baseProcessSteps = keepOnlyLatestChecklistListStep(
            cancelUnfinishedChecklistListSteps(variant.processSteps ?? []),
          );
          const processSteps = appendedContent.trim()
            ? [
                ...baseProcessSteps,
                {
                  id: createId(),
                  type: "assistant_message" as const,
                  content: appendedContent,
                },
              ]
            : baseProcessSteps;

          return {
            ...variant,
            status: wasAborted ? "done" : "error",
            content,
            processSteps,
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
      delete streamActiveProcessStepRefs.current[bufferKey];
      delete streamBuffersRef.current[bufferKey];
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

    const oneShotToolNames = validateToolMentionsForRequest(userMessage);
    if (!oneShotToolNames) return false;

    const toolsForRun = getEnabledToolsForChat(activeChat, oneShotToolNames);

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
      toolsForRun,
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
    const oneShotToolNames = validateToolMentionsForRequest(userMessage);
    if (!oneShotToolNames) return;

    const toolsForRun = getEnabledToolsForChat(activeChat, oneShotToolNames);
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

    await runAssistantVariant({
      chatId: activeChat.id,
      contextMessages,
      userMessage,
      assistantMessageId,
      variantId,
      responseStartedAtMs,
      providerForRun,
      toolsForRun,
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

    updateChat(activeChat.id, (chat) => ({
      ...chat,
      title: userIndex === 0 ? titleFromMessage(userMessage) : chat.title,
      messages: chat.messages.map((message) =>
        message.id === messageId && message.role === "user"
          ? { ...message, content: userMessage }
          : message,
      ),
    }));

    setEditingMessageId(null);
    showSuccess("Message saved.");
  }

  async function submitEditedUserMessage(
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

    const oneShotToolNames = validateToolMentionsForRequest(userMessage);
    if (!oneShotToolNames) return;

    const toolsForRun = getEnabledToolsForChat(activeChat, oneShotToolNames);

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
      toolsForRun,
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

  function toggleActiveChatTool(toolName: string) {
    if (!activeChat) return;

    const isGloballyEnabled = globallyEnabledToolNames.has(toolName);

    updateChat(activeChat.id, (chat) => {
      const chatEnabled = new Set(chat.enabledToolNames ?? []);
      const chatDisabled = new Set(chat.disabledToolNames ?? []);
      const isCurrentlyEnabled =
        !chatDisabled.has(toolName) &&
        (isGloballyEnabled || chatEnabled.has(toolName));

      if (isCurrentlyEnabled) {
        chatEnabled.delete(toolName);

        if (isGloballyEnabled) chatDisabled.add(toolName);
        else chatDisabled.delete(toolName);
      } else {
        chatDisabled.delete(toolName);

        if (isGloballyEnabled) chatEnabled.delete(toolName);
        else chatEnabled.add(toolName);
      }

      const enabledToolNames = availableTools
        .map((tool) => tool.name)
        .filter((name) => chatEnabled.has(name));
      const disabledToolNames = availableTools
        .map((tool) => tool.name)
        .filter((name) => chatDisabled.has(name));

      return {
        ...chat,
        enabledToolNames,
        disabledToolNames,
      };
    });
  }

  function renderComposerToolPicker() {
    const selectedNames = new Set(activeChatEnabledToolNames);

    return (
      <Popover
        open={isChatToolPickerOpen}
        onOpenChange={(open) => {
          setIsChatToolPickerOpen(open);
          if (!open) setChatToolSearchValue("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={!activeChat || isSending}
            aria-expanded={isChatToolPickerOpen}
            className="h-9 shrink-0 justify-between gap-2 rounded-lg px-3 text-left font-normal"
            title={
              isSending
                ? "Wait until this chat finishes generating"
                : "Select tools for this chat"
            }
          >
            <span className="flex min-w-0 items-center gap-2">
              <Wrench className="size-4 shrink-0 opacity-70" />
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(24rem,calc(100vw-2rem))] rounded-lg p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={chatToolSearchValue}
              onValueChange={setChatToolSearchValue}
              placeholder="Search tools..."
            />
            <CommandList>
              {visibleChatTools.length > 0 ? (
                <CommandGroup heading="Available tools">
                  {visibleChatTools.map((tool) => {
                    const isSelected = selectedNames.has(tool.name);

                    return (
                      <CommandItem
                        key={tool.name}
                        value={`${tool.name} ${tool.description}`}
                        onSelect={() => toggleActiveChatTool(tool.name)}
                        className="min-w-0 cursor-pointer items-start gap-2"
                        title={tool.description}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          tabIndex={-1}
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 truncate font-medium">
                              {tool.name}
                            </span>
                            {isBuiltInToolName(tool.name) && (
                              <Lock className="size-3 shrink-0 text-muted-foreground" />
                            )}
                          </div>
                          {tool.description && (
                            <div className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                              {tool.description}
                            </div>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : (
                <CommandEmpty>No tools found.</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  function renderComposerFooterStart() {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {renderComposerModelSelector()}
        {renderComposerToolPicker()}
      </div>
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
              <h1 className="flex min-w-0 items-baseline gap-1 truncate text-base font-semibold leading-6">
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
                <div className="px-2 pt-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
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
                        <div className="truncate text-base leading-6 ">
                          {chat.title}
                        </div>
                        {/* <div className="truncate text-sm leading-5 text-muted-foreground">
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
        {findBarOpen && (
          <div className="absolute right-3 top-3 z-40 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-lg border bg-card/95 p-1.5 text-card-foreground shadow-md backdrop-blur">
            <Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
            <Input
              ref={findInputRef}
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  findNextMatch(!event.shiftKey);
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  closeFindBar();
                }
              }}
              className="h-8 w-56 rounded-lg border-0 bg-transparent px-2 shadow-none focus-visible:ring-1"
              placeholder="Find in page"
              aria-label="Find in page"
            />
            <span className="min-w-14 text-center text-sm tabular-nums text-muted-foreground">
              {findQuery.trim()
                ? `${findResult.activeMatchOrdinal || 0}/${findResult.matches}`
                : "0/0"}
            </span>
            <TooltipIconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label="Previous match"
              onClick={() => findNextMatch(false)}
              disabled={!findQuery.trim()}
            >
              <ChevronLeft className="size-3" />
            </TooltipIconButton>
            <TooltipIconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label="Next match"
              onClick={() => findNextMatch(true)}
              disabled={!findQuery.trim()}
            >
              <ChevronRight className="size-3" />
            </TooltipIconButton>
            <TooltipIconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label="Close find"
              onClick={closeFindBar}
            >
              <X className="size-3" />
            </TooltipIconButton>
          </div>
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
                <div className="flex h-full items-center justify-center px-3">
                  <div className="max-w-md rounded-lg border bg-card p-6 text-center shadow-xs">
                    <h2 className="text-base font-semibold">
                      Start a conversation
                    </h2>
                    <p className="mt-2 text-base leading-6 text-muted-foreground">
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
                  const visibleProcessSteps =
                    getVisibleAssistantProcessSteps(processSteps);
                  const hasVisibleProcessSteps = visibleProcessSteps.length > 0;
                  const latestProcessStepId =
                    processSteps[processSteps.length - 1]?.id;
                  const assistantMessageProcessSteps =
                    visibleProcessSteps.filter(
                      (step) => step.type === "assistant_message",
                    );
                  const hasInlineAssistantMessageSteps =
                    assistantMessageProcessSteps.length > 0;
                  const status = activeVariant?.status;
                  const metrics = activeVariant?.metrics;
                  const generatedModelName = metrics?.model?.trim() ?? "";
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
                        hasVisibleProcessSteps && (
                          <div className="grid gap-2">
                            {visibleProcessSteps.map((step) => {
                              const isLatestProcessStep =
                                step.sourceStepIds.includes(
                                  latestProcessStepId ?? "",
                                );
                              const stepFlushVersion =
                                step.sourceStepIds.reduce(
                                  (total, sourceStepId) =>
                                    total +
                                    (visualFlushRequests[
                                      `${message.id}:${sourceStepId}`
                                    ] ?? 0),
                                  0,
                                );

                              if (step.type === "thinking") {
                                if (!step.content.trim()) return null;

                                const isThinkingStreaming =
                                  status === "streaming" && isLatestProcessStep;

                                return (
                                  <article
                                    key={step.id}
                                    className="flex min-w-0 max-w-full justify-start"
                                  >
                                    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-base leading-6 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
                                      <div className="mb-2 flex items-center gap-2 text-sm font-medium uppercase tracking-wide">
                                        <Brain className="size-3.5" />
                                        Thinking
                                        {isThinkingStreaming ? "..." : ""}
                                      </div>
                                      <div className="min-w-0 overflow-visible text-sm leading-5">
                                        <SmoothAssistantMessageContent
                                          content={step.content}
                                          className="chat-markdown-compact shrink-0"
                                          isApiStreaming={isThinkingStreaming}
                                          flushVersion={stepFlushVersion}
                                          forceInstant={!isThinkingStreaming}
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

                              if (step.type === "assistant_message") {
                                if (!step.content.trim()) return null;

                                const isAssistantBlockStreaming =
                                  status === "streaming" && isLatestProcessStep;
                                return (
                                  <div key={step.id} className="grid gap-1">
                                    <article
                                      className="flex min-w-0 max-w-full justify-start"
                                      onContextMenu={(event) =>
                                        captureMessageContext(event, message.id)
                                      }
                                    >
                                      <div className="min-w-0 max-w-full overflow-visible rounded-lg px-0 py-1 text-base leading-6 text-card-foreground shadow-xs [overflow-wrap:anywhere]">
                                        <SmoothAssistantMessageContent
                                          content={step.content}
                                          isApiStreaming={
                                            isAssistantBlockStreaming
                                          }
                                          flushVersion={stepFlushVersion}
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
                                    </article>
                                  </div>
                                );
                              }

                              if (step.type === "user_input") {
                                const manualCollapsed =
                                  collapsedToolStepIds[step.id];
                                const isCollapsed =
                                  manualCollapsed ?? step.status !== "waiting";

                                return (
                                  <AskUserBlock
                                    key={step.id}
                                    id={step.id}
                                    request={step.request}
                                    response={step.response}
                                    status={step.status}
                                    canSubmit={Boolean(
                                      pendingAskUserRequestsRef.current[
                                        step.toolCall.id
                                      ],
                                    )}
                                    isCollapsed={isCollapsed}
                                    onToggleCollapsed={() =>
                                      toggleToolExecutionCollapsed(
                                        step.id,
                                        !isCollapsed,
                                      )
                                    }
                                    onSubmit={(response) =>
                                      submitAskUserResponse(
                                        step.toolCall,
                                        step.request,
                                        response,
                                      )
                                    }
                                    onCancel={() =>
                                      cancelAskUserRequest(step.toolCall.id)
                                    }
                                    onLayoutChange={handleAskUserLayoutChange}
                                  />
                                );
                              }

                              if (step.type === "checklist") {
                                const manualCollapsed =
                                  collapsedToolStepIds[step.id];
                                const isCollapsed = manualCollapsed ?? false;

                                return (
                                  <ChecklistBlock
                                    key={step.id}
                                    id={step.id}
                                    request={step.request}
                                    status={step.status}
                                    isCollapsed={isCollapsed}
                                    onToggleCollapsed={() =>
                                      toggleToolExecutionCollapsed(
                                        step.id,
                                        !isCollapsed,
                                      )
                                    }
                                    onLayoutChange={handleAskUserLayoutChange}
                                  />
                                );
                              }

                              return renderToolExecutionBlock({
                                id: step.id,
                                toolCall: step.toolCall,
                                toolResult: step.toolResult,
                                status: step.status,
                              });
                            })}
                          </div>
                        )}

                      {message.role === "assistant" &&
                        !hasVisibleProcessSteps &&
                        reasoning.trim() &&
                        (() => {
                          return (
                            <article className="flex min-w-0 max-w-full justify-start">
                              <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-base leading-6 text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
                                <div className="mb-2 flex items-center gap-2 text-sm font-medium uppercase tracking-wide">
                                  <Brain className="size-3.5" />
                                  Thinking{isMessageStreaming ? "..." : ""}
                                </div>
                                <div className="min-w-0 overflow-visible text-sm leading-5">
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
                        !hasVisibleProcessSteps &&
                        toolCalls.length > 0 && (
                          <div className="grid gap-2">
                            {toolCalls.map((toolCall) => {
                              const result = toolResults.find(
                                (item) => item.toolCallId === toolCall.id,
                              );

                              return renderToolExecutionBlock({
                                id: toolCall.id,
                                toolCall,
                                toolResult: result,
                                status: result
                                  ? result.isError
                                    ? "failed"
                                    : "complete"
                                  : "running",
                              });
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
                          onSubmit={(nextContent) =>
                            submitEditedUserMessage(message.id, nextContent)
                          }
                        />
                      ) : (
                        (message.role === "user" ||
                          (!hasInlineAssistantMessageSteps &&
                            (content || status !== "streaming"))) && (
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
                                  "min-w-0 text-base leading-6 [overflow-wrap:anywhere] w-full rounded-lg",
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
                                  <UserMessageContent content={message.content} />
                                )}
                              </div>
                            </article>

                            {messageContextMenu?.messageId === message.id && (
                              <div
                                data-message-context-menu
                                className="fixed z-50 min-w-55 rounded-lg border bg-popover p-1 text-base text-popover-foreground shadow-md"
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
                          <div className="flex justify-end gap-1.5 text-sm leading-5 text-muted-foreground">
                            <TooltipIconButton
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive"
                              label="Delete message"
                              onClick={() => deleteMessage(message.id)}
                              disabled={isSending}
                            >
                              <Trash2 className="size-3" />
                            </TooltipIconButton>

                            <TooltipIconButton
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              label={
                                copiedMessageId === message.id
                                  ? "Copied"
                                  : "Copy message"
                              }
                              onClick={() =>
                                copyMessageContent(message.id, message.content)
                              }
                              disabled={!message.content.trim()}
                            >
                              {copiedMessageId === message.id ? (
                                <Check className="size-3" />
                              ) : (
                                <Copy className="size-3" />
                              )}
                            </TooltipIconButton>

                            <TooltipIconButton
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              label="Edit message"
                              onClick={() =>
                                startEditingUserMessage(message.id)
                              }
                              disabled={isSending}
                            >
                              <Pencil className="size-3" />
                            </TooltipIconButton>
                          </div>
                        )}

                      {message.role === "assistant" && (
                        <div className="grid gap-2 text-sm leading-5 text-muted-foreground">
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                            <div className="min-h-6 min-w-0 flex-1 text-left">
                              {isMessageStreaming ? (
                                <span className="generating-gradient-text font-medium">
                                  Generating
                                </span>
                              ) : generatedModelName ? (
                                <span
                                  className="block truncate text-muted-foreground"
                                  title={`Generated with ${generatedModelName}`}
                                >
                                  {generatedModelName}
                                </span>
                              ) : (
                                <span aria-hidden="true" />
                              )}
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              {variantCount > 1 && (
                                <div className="flex items-center gap-1">
                                  <TooltipIconButton
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    label="Previous answer"
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
                                  >
                                    <ChevronLeft className="size-3.5" />
                                  </TooltipIconButton>
                                  <span className="min-w-9 text-center tabular-nums">
                                    {activeVariantNumber}/{variantCount}
                                  </span>
                                  <TooltipIconButton
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    label="Next answer"
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
                                  >
                                    <ChevronRight className="size-3.5" />
                                  </TooltipIconButton>
                                </div>
                              )}

                              <Popover>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <PopoverTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        className="h-6 w-6 rounded-lg text-muted-foreground"
                                        disabled={
                                          metrics?.durationMs === undefined
                                        }
                                        title="Generation info"
                                        aria-label="Generation info"
                                      >
                                        <Info className="size-3" />
                                      </Button>
                                    </PopoverTrigger>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Generation info
                                  </TooltipContent>
                                </Tooltip>
                                <PopoverContent
                                  align="end"
                                  className="w-[min(26rem,calc(100vw-2rem))] rounded-lg p-3"
                                >
                                  <div className="mb-2 text-sm font-medium text-popover-foreground">
                                    Generation info
                                  </div>
                                  {renderJsonCodeBlock(
                                    formatGenerationInfoJson(metrics),
                                    "chat-markdown-compact max-h-120 overflow-auto text-sm",
                                  )}
                                </PopoverContent>
                              </Popover>

                              <TooltipIconButton
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive hover:text-destructive"
                                label="Delete message"
                                onClick={() => deleteMessage(message.id)}
                                disabled={isSending}
                              >
                                <Trash2 className="size-3" />
                              </TooltipIconButton>

                              <TooltipIconButton
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                label={
                                  status === "error"
                                    ? "Retry answer"
                                    : "Regenerate answer"
                                }
                                onClick={() =>
                                  regenerateAssistantMessage(message.id)
                                }
                                disabled={isSending}
                              >
                                <RefreshCcw className="size-3" />
                              </TooltipIconButton>

                              <TooltipIconButton
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                label={
                                  copiedMessageId === message.id
                                    ? "Copied"
                                    : "Copy answer"
                                }
                                onClick={() =>
                                  copyMessageContent(message.id, content)
                                }
                                disabled={!content.trim()}
                              >
                                {copiedMessageId === message.id ? (
                                  <Check className="size-3" />
                                ) : (
                                  <Copy className="size-3" />
                                )}
                              </TooltipIconButton>
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
          draftKey={activeChatId ?? ""}
          draft={activeComposerDraft}
          onDraftChange={updateActiveComposerDraft}
          onSend={sendMessage}
          onStop={stopGeneration}
          footerStart={renderComposerFooterStart()}
          toolMentionOptions={toolMentionOptions}
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
                <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Providers
                </Label>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-sm"
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
                      <div className="truncate text-base leading-6">
                        {providerDisplayName(item)}
                      </div>
                      <div className="truncate text-sm leading-5 text-muted-foreground">
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
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
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
                              className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-base hover:bg-accent hover:text-accent-foreground"
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
                      <p className="px-2 py-4 text-base text-muted-foreground">
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
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
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

      <ToolsDialog
        open={toolsOpen}
        onOpenChange={setToolsOpen}
        toolsSettings={toolsSettings}
        onToolsSettingsChange={setToolsSettings}
        loadedTools={loadedTools}
        onLoadedToolsChange={setLoadedTools}
        showSuccess={showSuccess}
        showError={showError}
      />

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
