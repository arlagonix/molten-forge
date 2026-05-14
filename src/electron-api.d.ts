import type { ChatTokenUsage, LoadedToolInfo, ToolLoadError, ToolsSettings } from "@/lib/ai-chat/types";

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
  };
};

type AiStreamDeltaEvent =
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "raw"; data: unknown };

type AiStreamResult = {
  usage?: ChatTokenUsage;
  finishReason?: string;
  content?: string;
  reasoning?: string;
  toolCalls?: AiToolCall[];
};

type AiStreamHandle = {
  id: string;
  cancel: () => void;
  result: (onDelta: (event: AiStreamDeltaEvent) => void) => Promise<AiStreamResult>;
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
  chats: unknown[];
};

declare global {
  interface Window {
    chatForgeStorage?: {
      isInitialized: () => Promise<boolean>;
      migrateFromIndexedDb: (snapshot: ChatForgeIndexedDbSnapshot) => Promise<unknown>;
      loadProvidersState: () => Promise<any>;
      saveProvidersState: (value: unknown) => Promise<void>;
      loadSystemPrompt: () => Promise<string | undefined>;
      saveSystemPrompt: (value: string) => Promise<void>;
      loadActiveChatId: () => Promise<string | undefined>;
      saveActiveChatId: (chatId: string) => Promise<void>;
      loadCachedProviderModels: (cacheKey: string) => Promise<string[]>;
      saveCachedProviderModels: (cacheKey: string, models: string[]) => Promise<void>;
      loadChats: () => Promise<any[]>;
      saveChat: (chat: unknown) => Promise<void>;
      deleteChat: (chatId: string) => Promise<void>;
      deleteAllChats: () => Promise<void>;
      loadToolsSettings: () => Promise<ToolsSettings | undefined>;
      saveToolsSettings: (value: ToolsSettings) => Promise<void>;
    };
  }
}


declare global {
  interface Window {
    chatForgeTools?: {
      selectDirectory: () => Promise<string | undefined>;
      load: (directory: string) => Promise<{ tools: LoadedToolInfo[]; errors: ToolLoadError[] }>;
      execute: (request: { name: string; args: unknown }) => Promise<{ toolName: string; content: string }>;
    };
  }
}
