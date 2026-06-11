export type ProviderGenerationSettings = {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoningMode?: "auto" | "off" | "enabled";
  reasoningEffort?: "low" | "medium" | "high";
  requestTimeoutMs?: number;
};

export type ChatThinkingMode =
  | "model_default"
  | "off"
  | "low"
  | "medium"
  | "high";

export type ProviderModelContext = {
  manualContextLength?: number;
  detectedContextLength?: number;
  speculatedContextLength?: number;
};

export type ProviderModelConfig = ProviderGenerationSettings & {
  enabled?: boolean;
  showInMenu?: boolean;
  supportsVision?: boolean;
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
  modeName?: string;
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

export type FileToolChangePreviewRow = {
  type: "add" | "delete" | "context";
  text: string;
  oldLine?: number;
  newLine?: number;
};

export type FileToolChangePreview = {
  kind: "create" | "replace" | "delete";
  rootId?: string;
  rootName?: string;
  path: string;
  title?: string;
  truncated?: boolean;
  rows: FileToolChangePreviewRow[];
};

export type TerminalExecutionResult = {
  command: string;
  shell: string;
  requestedShell?: string;
  cwd: string;
  rootId?: string;
  rootName?: string;
  rootPath?: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  outputTruncated?: boolean;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  warnings?: string[];
};

export type TerminalStreamEvent =
  | {
      type: "started";
      executionId?: string;
      command: string;
      shell: string;
      cwd: string;
      timeoutMs: number;
      warnings?: string[];
    }
  | { type: "stdout"; executionId?: string; text: string }
  | { type: "stderr"; executionId?: string; text: string }
  | {
      type: "finished";
      executionId?: string;
      exitCode: number | null;
      timedOut: boolean;
      cancelled: boolean;
      durationMs: number;
      outputTruncated?: boolean;
    };

export type ChatGeneratedFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  rootId: string;
  workspacePath: string;
  storagePath?: string;
  createdAt: string;
  description?: string;
};

export type ChatToolResultImage = {
  type: "image";
  dataUrl: string;
  mimeType: string;
  path?: string;
};

export type ChatToolResult = {
  toolCallId: string;
  toolName: string;
  content: string;
  isError?: boolean;
  images?: ChatToolResultImage[];
  execution?: ToolExecutionPreview;
  changePreview?: FileToolChangePreview;
  loadedSkillName?: string;
  loadedSkillInstructions?: string;
  loadedSkillRecommendedToolNames?: string[];
  generatedFiles?: ChatGeneratedFile[];
  terminal?: TerminalExecutionResult;
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
  /**
   * Ordered timeline of this agent run (thinking, tool executions, nested
   * agent calls, assistant text, interactive steps), mirroring the main
   * chat's `ChatAssistantVariant.processSteps`. Newer agent calls populate
   * this so the transcript can faithfully reconstruct interleaving; older
   * persisted calls may omit it, in which case the transcript falls back to
   * the flat `reasoning`/`toolCalls`/`output` fields.
   */
  processSteps?: ChatAssistantProcessStep[];
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

export type AgentTask = {
  subject: string;
  done: boolean;
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
      toolBatchId?: string;
      status?: ToolExecutionStatus;
      toolCall: ChatToolCall;
      toolResult?: ChatToolResult;
    }
  | {
      id: string;
      type: "agent_call";
      toolBatchId?: string;
      status?: AgentCallStatus;
      toolCall: ChatToolCall;
      agentCall: ChatAgentCall;
    }
  | {
      id: string;
      type: "user_input";
      toolBatchId?: string;
      status?: UserInputStatus;
      toolCall: ChatToolCall;
      request: AskUserRequest;
      response?: AskUserResponse;
      toolResult?: ChatToolResult;
    }
  | {
      id: string;
      type: "approval" | "file_approval";
      toolBatchId?: string;
      status?: UserInputStatus;
      toolCall: ChatToolCall;
      request: ToolApprovalRequest;
      response?: ToolApprovalResponse;
      toolResult?: ChatToolResult;
    }
  | {
      id: string;
      type: "tasks";
      toolBatchId?: string;
      status?: ToolExecutionStatus;
      toolCall: ChatToolCall;
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

export type AttachmentKind = "image" | "text" | "pdf" | "office" | "archive";

export type AttachmentStorageMode = "original" | "temporary" | "managed";

export type ChatAttachment = {
  id: string;
  name: string;
  kind: AttachmentKind;
  mimeType: string;
  sizeBytes: number;
  /** Absolute path used by tools/model context. Original files are not copied; pathless files are staged in temp storage. */
  storagePath?: string;
  storageMode?: AttachmentStorageMode;
  temporary?: boolean;
  available?: boolean;
  workspaceRootId?: string;
  workspacePath?: string;
  thumbnailDataUrl?: string;
  extractedText?: string;
  children?: ChatAttachment[];
  truncated?: boolean;
  error?: string;
  tokenEstimate?: number;
};

export type ChatUserMessage = {
  id: string;
  role: "user";
  content: string;
  createdAt: string;
  attachments?: ChatAttachment[];
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

export type ModeBuiltInId = "default" | "minimal";

export type Permission = "allow" | "ask" | "deny";
export type FeaturePermission = "custom" | Permission;
export type ModePermission = "global" | Permission;
export type ModeFeaturePermission = "custom" | ModePermission;
export type PermissionMap = Record<string, Permission>;
export type ModePermissionMap = Record<string, ModeFeaturePermission>;

export type ModeDefinition = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  instructions?: string;
  builtIn?: ModeBuiltInId;
  /** Built-in modes can keep dynamic default capabilities until explicitly edited. */
  usesDefaultCapabilities?: boolean;
  /** Legacy allow-lists, normalized into permission maps. */
  allowedToolNames: string[];
  allowedSkillNames: string[];
  allowedAgentNames: string[];
  toolPermissions?: ModePermissionMap;
  skillPermissions?: ModePermissionMap;
  agentPermissions?: ModePermissionMap;
  /** Permission model version. Missing means legacy master rows should be migrated conservatively. */
  permissionModelVersion?: 2;
};

export type LoadedModeInfo = ModeDefinition;

export type ModesState = {
  modes: LoadedModeInfo[];
};

export type AppFontFamily = "sans" | "mono";

export type ChatFolder = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  workspaceRoots?: ChatWorkspaceRoot[];
};

export type AppSettings = {
  chatTitleGenerationMode: ChatTitleGenerationMode;
  fontFamily: AppFontFamily;
  chatFolders: ChatFolder[];
  thinkingAutoCollapse?: boolean;
  renderMarkdownWhileStreaming?: boolean;
};

export type ChatWorkspaceRoot = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  automatic?: boolean;
  kind?: "chat" | "manual" | "skill";
};

export type ChatFileToolAutoApproval = {
  read?: boolean;
  bash?: boolean;
  edit?: boolean;
  write?: boolean;
  /** Legacy fields kept for older saved chats. */
  create?: boolean;
  replaceText?: boolean;
  delete?: boolean;
};

export type ChatSession = {
  id: string;
  title: string;
  titleMode?: ChatTitleMode;
  isPinned?: boolean;
  folderId?: string;
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
  thinkingMode?: ChatThinkingMode;
  modeId?: string;
};

export type ApiToolCall = ChatToolCall;

export type ApiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ApiChatMessage =
  | {
      role: "system";
      content: string;
    }
  | {
      role: "user";
      content: string | ApiContentPart[];
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
  changePreview?: FileToolChangePreview;
  generatedFiles?: ChatGeneratedFile[];
  terminal?: TerminalExecutionResult;
};

export type McpTransportType = "stdio" | "http";

export type McpToolConfig = {
  originalName: string;
  exposedName: string;
  enabled: boolean;
  description?: string;
  inputSchema?: Record<string, unknown>;
  requireApproval?: boolean;
  lastSeenAt?: string;
};

export type McpServerConfig = {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransportType;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  insecureSkipTlsVerify?: boolean;
  timeoutMs: number;
  requireApproval: boolean;
  tools?: Record<string, McpToolConfig>;
  lastError?: string;
  lastConnectedAt?: string;
};

export type McpSettings = {
  enabled: boolean;
  servers: McpServerConfig[];
};

export type McpToolMetadata = {
  serverId: string;
  serverName: string;
  originalToolName: string;
  exposedName: string;
  transport: McpTransportType;
};

export type ToolDefinition = {
  id: string;
  name: string;
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
  source?: "custom" | "mcp";
  displayName?: string;
  mcp?: McpToolMetadata;
};

export type LoadedToolInfo = ToolDefinition;

export type SkillDefinition = {
  name: string;
  /** Legacy field kept for older saved data. Readonly filesystem skills are not toggled in the UI. */
  enabled: boolean;
  description: string;
  /** SKILL.md body without YAML frontmatter. */
  instructions: string;
  /** Legacy field. Ignored by the Pi-style skill runtime for now. */
  recommendedToolNames: string[];
  /** Absolute path to the skill folder. */
  directoryPath?: string;
  /** Absolute path to the SKILL.md file. */
  manifestPath?: string;
  /** Full raw SKILL.md content including frontmatter, used for readonly UI display. */
  manifestContent?: string;
  /** Pi/Claude-style flag: hide from automatic model discovery, but keep /skill:name available. */
  disableModelInvocation?: boolean;
  /** Human-readable discovery source, e.g. global or workspace path. */
  source?: string;
  /** Discovery group used by the readonly Skills UI and conflict resolution. */
  sourceKind?: "global" | "workspace";
  /** Directory that was scanned to discover this skill. */
  sourcePath?: string;
  /** True when another skill with the same name has higher resolution priority. */
  shadowed?: boolean;
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

export type BuiltInToolDescriptionMode = "default" | "custom";

export type BuiltInToolSettings = {
  descriptionMode?: BuiltInToolDescriptionMode;
  customDescription?: string;
  timeoutMs?: number;
};

export type ToolsSettings = {
  enabled: boolean;
  askUserEnabled: boolean;
  taskToolsEnabled: boolean;
  loadSkillEnabled: boolean;
  webFetchEnabled: boolean;
  readEnabled: boolean;
  bashEnabled: boolean;
  editEnabled: boolean;
  writeEnabled: boolean;
  /** Legacy auto-approval fields kept for loading old settings. */
  readAutoApproveEnabled: boolean;
  bashAutoApproveEnabled: boolean;
  editAutoApproveEnabled: boolean;
  writeAutoApproveEnabled: boolean;
  /** Model-facing description and execution settings for built-in tools. */
  builtInToolSettings?: Record<string, BuiltInToolSettings>;
  /** Feature-level master permission for the whole tools category. */
  toolsPermission?: FeaturePermission;
  toolPermissions?: PermissionMap;
  /** Permission model version. Missing means legacy master values should be migrated to custom. */
  permissionModelVersion?: 2;
};

export type SkillsSettings = {
  /** Legacy global switch. Permission maps are the active model. */
  enabled?: boolean;
  /** Feature-level master permission for the whole skills category. */
  skillsPermission?: FeaturePermission;
  skillPermissions?: PermissionMap;
  /** Permission model version. Missing means legacy master values should be migrated to custom. */
  permissionModelVersion?: 2;
};

export type AgentsSettings = {
  /** Legacy global switch. Permission maps are the active model. */
  enabled: boolean;
  /** Feature-level master permission for the whole agents category. */
  agentsPermission?: FeaturePermission;
  agentPermissions?: PermissionMap;
  builtInAgentMaxNestingDepths?: Record<string, number>;
  /** Permission model version. Missing means legacy master values should be migrated to custom. */
  permissionModelVersion?: 2;
};

export type ToolsState = {
  settings: ToolsSettings;
  tools: LoadedToolInfo[];
  errors: ToolLoadError[];
};
