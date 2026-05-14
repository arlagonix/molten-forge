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

export type ChatToolResult = {
  toolCallId: string;
  toolName: string;
  content: string;
  isError?: boolean;
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

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LoadedToolInfo = ToolDefinition & {
  filePath: string;
};

export type ToolLoadError = {
  filePath: string;
  message: string;
};

export type ToolsSettings = {
  enabled: boolean;
  directory: string;
  disabledToolNames: string[];
};

export type ToolsState = {
  settings: ToolsSettings;
  tools: LoadedToolInfo[];
  errors: ToolLoadError[];
};
