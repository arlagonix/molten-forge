export type ProviderGenerationSettings = {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoningMode?: "auto" | "off" | "enabled";
  reasoningEffort?: "low" | "medium" | "high";
  requestTimeoutMs?: number;
};

export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models?: string[];
  enabledModelIds?: string[];
  headers?: Record<string, string>;
  /** Deprecated: kept only so old IndexedDB records can be migrated. */
  customHeaders?: string;
  defaultSettings?: ProviderGenerationSettings;
  modelSettings?: Record<string, ProviderGenerationSettings>;
};

export type ProvidersState = {
  providers: ProviderConfig[];
  activeProviderId: string;
};

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessageStatus = "streaming" | "done" | "error";

export type ChatTokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ChatMessageMetrics = {
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  tokenUsage?: ChatTokenUsage;
  outputTokens?: number;
  tokensPerSecond?: number;
  isApproximate?: boolean;
  providerName?: string;
  model?: string;
  finishReason?: string;
};

export type ChatToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ToolExecutionPreview = {
  command: string;
  args: string[];
  cwd?: string;
  inputMode: ToolInputMode;
  stdin?: string;
  displayCommand: string;
  usesStdin: boolean;
  usesPlaceholders: boolean;
};

export type ChatToolResult = {
  toolCallId: string;
  toolName: string;
  content: string;
  isError?: boolean;
  execution?: ToolExecutionPreview;
};

export type ToolExecutionStatus = "pending" | "running" | "complete" | "failed";

export type AskUserOption = {
  id: string;
  label: string;
  description?: string;
};

export type AskUserQuestionType = "single_choice" | "multi_select" | "text";

export type AskUserQuestion = {
  id: string;
  type?: AskUserQuestionType;
  question: string;
  description?: string;
  options: AskUserOption[];
  input?: {
    multiline?: boolean;
  };
};

export type AskUserRequest = {
  title?: string;
  description?: string;
  questions: AskUserQuestion[];
};

export type AskUserResponse = {
  /** Selected option id per single-choice question, or text answer for text questions. */
  answers: Record<string, string>;
  /** Selected option ids per multi-select question. */
  multiAnswers?: Record<string, string[]>;
  answerLabels?: Record<string, string | string[]>;
  customAnswers?: Record<string, string>;
  answeredAt: string;
};

export type UserInputStatus = "waiting" | "complete" | "cancelled" | "failed";

export type ChecklistItem = {
  content: string;
  done: boolean;
};

export type ChecklistWriteRequest = {
  items: ChecklistItem[];
};

export type ChatAssistantProcessStep =
  | {
      id: string;
      type: "thinking";
      content: string;
    }
  | {
      id: string;
      type: "assistant_message";
      content: string;
    }
  | {
      id: string;
      type: "tool_execution";
      status?: ToolExecutionStatus;
      toolCall: ChatToolCall;
      toolResult?: ChatToolResult;
    }
  | {
      id: string;
      type: "user_input";
      status?: UserInputStatus;
      toolCall: ChatToolCall;
      request: AskUserRequest;
      response?: AskUserResponse;
      toolResult?: ChatToolResult;
    }
  | {
      id: string;
      type: "checklist";
      status?: ToolExecutionStatus;
      toolCall: ChatToolCall;
      request: ChecklistWriteRequest;
      toolResult?: ChatToolResult;
    };

export type ChatAssistantVariant = {
  id: string;
  content: string;
  reasoning?: string;
  status?: ChatMessageStatus;
  createdAt: string;
  metrics?: ChatMessageMetrics;
  toolCalls?: ChatToolCall[];
  toolResults?: ChatToolResult[];
  processSteps?: ChatAssistantProcessStep[];
};

export type ChatUserMessage = {
  id: string;
  role: "user";
  content: string;
  createdAt: string;
};

export type ChatAssistantMessage = {
  id: string;
  role: "assistant";
  variants: ChatAssistantVariant[];
  activeVariantIndex: number;
  createdAt: string;
};

export type ChatMessage = ChatUserMessage | ChatAssistantMessage;

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  providerId?: string;
  model?: string;
};

export type ApiToolCall = ChatToolCall;

export type ApiChatMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string;
      tool_calls?: ApiToolCall[];
    }
  | {
      role: "tool";
      tool_call_id: string;
      content: string;
    };

export type ToolInputMode = "none" | "json-stdin";

export type ToolCommandResult = {
  toolName?: string;
  content: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  execution?: ToolExecutionPreview;
};

export type ToolDefinition = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  parameters: Record<string, unknown>;
  command: string;
  args: string[];
  cwd?: string;
  input: ToolInputMode;
  timeoutMs: number;
  maxConcurrentRuns?: number;
  delayBetweenRunsMs?: number;
};

export type LoadedToolInfo = ToolDefinition;

export type ToolLoadError = {
  source: string;
  message: string;
};

export type ToolsSettings = {
  enabled: boolean;
  askUserEnabled: boolean;
  checklistWriteEnabled: boolean;
};

export type ToolsState = {
  settings: ToolsSettings;
  tools: LoadedToolInfo[];
  errors: ToolLoadError[];
};
