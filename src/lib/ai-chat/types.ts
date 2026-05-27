export type ProviderGenerationSettings = {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoningMode?: "auto" | "off" | "enabled";
  reasoningEffort?: "low" | "medium" | "high";
  requestTimeoutMs?: number;
};

export type ProviderModelContext = {
  manualContextLength?: number;
  detectedContextLength?: number;
  speculatedContextLength?: number;
};

export type ProviderModelConfig = ProviderGenerationSettings & {
  enabled?: boolean;
  showInMenu?: boolean;
  context?: ProviderModelContext;
};

export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models?: string[];
  customModels?: string[];
  enabled?: boolean;
  modelConfigs?: Record<string, ProviderModelConfig>;
  /** Deprecated: migrated into modelConfigs. */
  enabledModelIds?: string[];
  headers?: Record<string, string>;
  /** Deprecated: kept only so old IndexedDB records can be migrated. */
  customHeaders?: string;
  /** Deprecated: migrated into modelConfigs. */
  defaultSettings?: ProviderGenerationSettings;
  /** Deprecated: migrated into modelConfigs. */
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

export type ChatReasoningMetadata = {
  /** Raw text reasoning metadata that providers may require to be passed back. */
  reasoningContent?: string;
  /** Raw structured reasoning metadata. Preserve order and shape exactly. */
  reasoningDetails?: unknown[];
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
    [key: string]: unknown;
  };
  /** Provider-specific metadata required by some OpenAI-compatible APIs. */
  [key: string]: unknown;
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
  loadedSkillName?: string;
  loadedSkillInstructions?: string;
  loadedSkillRecommendedToolNames?: string[];
};

export type ToolExecutionStatus = "pending" | "running" | "complete" | "failed";

export type AgentContextMode = "task_only" | "full_chat";

export type AgentCallStatus =
  | "pending"
  | "running"
  | "complete"
  | "failed"
  | "cancelled";

export type AgentTranscriptMessage = {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  createdAt: string;
};

export type ChatAgentCall = {
  id: string;
  agentId?: string;
  agentName: string;
  description?: string;
  task: string;
  status: AgentCallStatus;
  contextMode: AgentContextMode;
  depth: number;
  startedAt: string;
  completedAt?: string;
  providerName?: string;
  model?: string;
  output: string;
  reasoning?: string;
  error?: string;
  messages: AgentTranscriptMessage[];
  toolCalls?: ChatToolCall[];
  toolResults?: ChatToolResult[];
  childAgentCalls: ChatAgentCall[];
};

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

export type ToolApprovalAction =
  | "replacement"
  | "creation"
  | "deletion"
  | "operation";

export type ToolApprovalRequest = {
  title: string;
  description?: string;
  toolName: string;
  action: ToolApprovalAction;
  path?: string;
  details?: {
    label: string;
    value: string;
  }[];
};

export type ToolApprovalResponse = {
  approved: boolean;
  answeredAt: string;
};

export type FileToolApprovalAction = ToolApprovalAction;
export type FileToolApprovalRequest = ToolApprovalRequest;
export type FileToolApprovalResponse = ToolApprovalResponse;

export type UserInputStatus = "waiting" | "complete" | "cancelled" | "failed";

export type ThinkingStatus = "waiting" | "in_progress" | "complete";

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
      status?: ThinkingStatus;
      startedAt?: string;
      completedAt?: string;
    }
  | {
      id: string;
      type: "tool_building";
      status?: "running";
      toolCalls: ChatToolCall[];
      updatedAt?: string;
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
      type: "agent_call";
      status?: AgentCallStatus;
      toolCall: ChatToolCall;
      agentCall: ChatAgentCall;
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
      type: "approval" | "file_approval";
      status?: UserInputStatus;
      toolCall: ChatToolCall;
      request: ToolApprovalRequest;
      response?: ToolApprovalResponse;
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
  reasoningMetadata?: ChatReasoningMetadata;
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

export type ChatTitleMode = "auto" | "manual";

export type ChatTitleGenerationMode = "local" | "ai";

export type AppFontFamily = "sans" | "mono";

export type AppSettings = {
  chatTitleGenerationMode: ChatTitleGenerationMode;
  fontFamily: AppFontFamily;
};

export type ChatWorkspaceRoot = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
};

export type ChatFileToolAutoApproval = {
  create?: boolean;
  replaceText?: boolean;
  delete?: boolean;
};

export type ChatSession = {
  id: string;
  title: string;
  titleMode?: ChatTitleMode;
  isPinned?: boolean;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  providerId?: string;
  model?: string;
  enabledToolNames?: string[];
  disabledToolNames?: string[];
  enabledSkillNames?: string[];
  disabledSkillNames?: string[];
  enabledAgentNames?: string[];
  disabledAgentNames?: string[];
  activeSkillNames?: string[];
  workspaceRoots?: ChatWorkspaceRoot[];
  fileToolAutoApproval?: ChatFileToolAutoApproval;
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
      reasoning_content?: string;
      reasoning_details?: unknown[];
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
  requiresApproval?: boolean;
};

export type LoadedToolInfo = ToolDefinition;

export type SkillDefinition = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  instructions: string;
  recommendedToolNames: string[];
};

export type LoadedSkillInfo = SkillDefinition;

export type AgentDefinition = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  instructions: string;
  contextMode: AgentContextMode;
  providerId?: string;
  model?: string;
  maxNestingDepth: number;
  loadedSkillNames: string[];
  allowedToolNames: string[];
  allowedAgentNames: string[];
};

export type LoadedAgentInfo = AgentDefinition;

export type ToolLoadError = {
  source: string;
  message: string;
};

export type ToolImportIssue = {
  source: string;
  toolName?: string;
  message: string;
};

export type ToolImportResult = {
  cancelled: boolean;
  imported: number;
  updated: number;
  skipped: ToolImportIssue[];
  invalid: ToolImportIssue[];
  renamed: ToolImportIssue[];
};

export type ToolExportResult = {
  cancelled: boolean;
  exported: number;
  path?: string;
};

export type SkillImportIssue = {
  source: string;
  skillName?: string;
  message: string;
};

export type AgentImportIssue = {
  source: string;
  agentName?: string;
  message: string;
};

export type SkillImportResult = {
  cancelled: boolean;
  imported: number;
  updated: number;
  skipped: SkillImportIssue[];
  invalid: SkillImportIssue[];
  renamed: SkillImportIssue[];
};

export type SkillExportResult = {
  cancelled: boolean;
  exported: number;
  path?: string;
};

export type AgentImportResult = {
  cancelled: boolean;
  imported: number;
  updated: number;
  skipped: AgentImportIssue[];
  invalid: AgentImportIssue[];
  renamed: AgentImportIssue[];
};

export type AgentExportResult = {
  cancelled: boolean;
  exported: number;
  path?: string;
};

export type ToolsSettings = {
  enabled: boolean;
  askUserEnabled: boolean;
  checklistWriteEnabled: boolean;
  loadSkillEnabled: boolean;
  webFetchEnabled: boolean;
  fileReadEnabled: boolean;
  fileFindEnabled: boolean;
  fileSearchTextEnabled: boolean;
  fileReplaceTextEnabled: boolean;
  fileCreateEnabled: boolean;
  fileDeleteEnabled: boolean;
  fileReplaceTextAutoApproveEnabled: boolean;
  fileCreateAutoApproveEnabled: boolean;
  fileDeleteAutoApproveEnabled: boolean;
};

export type SkillsSettings = {
  enabled: boolean;
};

export type AgentsSettings = {
  enabled: boolean;
};

export type ToolsState = {
  settings: ToolsSettings;
  tools: LoadedToolInfo[];
  errors: ToolLoadError[];
};
