import type {
  AgentsSettings,
  AgentExportResult,
  AgentImportResult,
  AppSettings,
  ChatReasoningMetadata,
  ChatTokenUsage,
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  ChatWorkspaceRoot,
  ToolCommandResult,
  SkillExportResult,
  SkillImportResult,
  ToolExportResult,
  ToolImportResult,
  SkillsSettings,
  ToolsSettings,
} from "@/lib/ai-chat/types";

type AiProviderRequest = {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  customHeaders?: string;
  payload?: unknown;
};

type AiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type AiStreamDeltaEvent =
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "reasoning_metadata"; delta: ChatReasoningMetadata }
  | { type: "tool_call_delta"; toolCalls: AiToolCall[] }
  | { type: "raw"; data: unknown };

type AiStreamResult = {
  usage?: ChatTokenUsage;
  finishReason?: string;
  content?: string;
  reasoning?: string;
  reasoningMetadata?: ChatReasoningMetadata;
  toolCalls?: AiToolCall[];
};

type AiStreamHandle = {
  id: string;
  cancel: () => void;
  result: (
    onDelta: (event: AiStreamDeltaEvent) => void,
  ) => Promise<AiStreamResult>;
};

declare global {
  interface Window {
    codeForgeAI?: {
      loadModels: (request: AiProviderRequest) => Promise<unknown>;
      sendChat: (request: AiProviderRequest) => Promise<any>;
      streamChat: (request: AiProviderRequest) => AiStreamHandle;
    };
  }
}

export {};

type ChatForgeIndexedDbSnapshot = {
  providersState?: unknown;
  systemPrompt?: string;
  activeChatId?: string;
  providerModelsCache: Record<string, string[]>;
  appSettings?: AppSettings;
  chats: unknown[];
};

declare global {
  interface Window {
    chatForgeStorage?: {
      isInitialized: () => Promise<boolean>;
      migrateFromIndexedDb: (
        snapshot: ChatForgeIndexedDbSnapshot,
      ) => Promise<unknown>;
      loadProvidersState: () => Promise<any>;
      saveProvidersState: (value: unknown) => Promise<void>;
      loadSystemPrompt: () => Promise<string | undefined>;
      saveSystemPrompt: (value: string) => Promise<void>;
      loadActiveChatId: () => Promise<string | undefined>;
      saveActiveChatId: (chatId: string) => Promise<void>;
      loadCachedProviderModels: (cacheKey: string) => Promise<string[]>;
      saveCachedProviderModels: (
        cacheKey: string,
        models: string[],
      ) => Promise<void>;
      loadChats: () => Promise<any[]>;
      saveChat: (chat: unknown) => Promise<void>;
      deleteChat: (chatId: string) => Promise<void>;
      deleteAllChats: () => Promise<void>;
      loadToolsSettings: () => Promise<ToolsSettings | undefined>;
      saveToolsSettings: (value: ToolsSettings) => Promise<void>;
      loadSkillsSettings: () => Promise<SkillsSettings | undefined>;
      saveSkillsSettings: (value: SkillsSettings) => Promise<void>;
      loadAgentsSettings: () => Promise<AgentsSettings | undefined>;
      saveAgentsSettings: (value: AgentsSettings) => Promise<void>;
      loadAppSettings: () => Promise<AppSettings | undefined>;
      saveAppSettings: (value: AppSettings) => Promise<void>;
      loadTools: () => Promise<LoadedToolInfo[]>;
      saveTool: (tool: LoadedToolInfo) => Promise<LoadedToolInfo>;
      deleteTool: (toolId: string) => Promise<void>;
      importTools: () => Promise<ToolImportResult>;
      exportTool: (tool: LoadedToolInfo) => Promise<ToolExportResult>;
      exportTools: (tools: LoadedToolInfo[]) => Promise<ToolExportResult>;
      openToolsFolder: () => Promise<void>;
      loadSkills: () => Promise<LoadedSkillInfo[]>;
      saveSkill: (skill: LoadedSkillInfo) => Promise<LoadedSkillInfo>;
      deleteSkill: (skillId: string) => Promise<void>;
      importSkills: () => Promise<SkillImportResult>;
      exportSkill: (skill: LoadedSkillInfo) => Promise<SkillExportResult>;
      exportSkills: (skills: LoadedSkillInfo[]) => Promise<SkillExportResult>;
      openSkillsFolder: () => Promise<void>;
      loadAgents: () => Promise<LoadedAgentInfo[]>;
      saveAgent: (agent: LoadedAgentInfo) => Promise<LoadedAgentInfo>;
      deleteAgent: (agentId: string) => Promise<void>;
      importAgents: () => Promise<AgentImportResult>;
      exportAgent: (agent: LoadedAgentInfo) => Promise<AgentExportResult>;
      exportAgents: (agents: LoadedAgentInfo[]) => Promise<AgentExportResult>;
      openAgentsFolder: () => Promise<void>;
    };
  }
}

declare global {
  interface Window {
    chatForgeWorkspace?: {
      selectFolder: () => Promise<
        | { cancelled: true }
        | { cancelled: false; path: string; name: string }
      >;
      openFolder: (folderPath: string) => Promise<void>;
    };
  }
}

declare global {
  interface Window {
    chatForgeTools?: {
      execute: (request: {
        name: string;
        args: unknown;
        workspaceRoots?: ChatWorkspaceRoot[];
      }) => Promise<ToolCommandResult>;
      test: (request: {
        tool: LoadedToolInfo;
        args: unknown;
      }) => Promise<ToolCommandResult>;
    };
  }
}

type FindInPageRequest = {
  text: string;
  forward?: boolean;
  findNext?: boolean;
};

type FindInPageResult = {
  requestId: number;
  activeMatchOrdinal: number;
  matches: number;
  selectionArea?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  finalUpdate: boolean;
};

declare global {
  interface Window {
    chatForgeFind?: {
      findInPage: (
        request: FindInPageRequest,
      ) => Promise<{ requestId: number }>;
      stopFindInPage: (
        action?: "clearSelection" | "keepSelection" | "activateSelection",
      ) => Promise<void>;
      onFoundInPage: (
        callback: (result: FindInPageResult) => void,
      ) => () => void;
    };
  }
}
