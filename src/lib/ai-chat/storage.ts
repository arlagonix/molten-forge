import { normalizeProviderForState, sortChatsByUpdatedAt } from "./chat-utils";
import {
  normalizeFeaturePermission,
  normalizeModesState,
  normalizePermissionMap,
  serializeModesState,
} from "./modes";
import { defaultProvider } from "./provider-presets";
import type {
  AgentExportResult,
  AgentImportResult,
  AgentsSettings,
  AppSettings,
  ChatFolder,
  ChatSession,
  ChatWorkspaceRoot,
  FeaturePermission,
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  McpSettings,
  ModesState,
  PermissionMap,
  ProviderConfig,
  ProvidersState,
  SkillExportResult,
  SkillImportResult,
  SkillsSettings,
  ToolExportResult,
  ToolImportResult,
  ToolsSettings,
} from "./types";

const DB_NAME = "chat-forge";
const DB_VERSION = 1;
const KV_STORE = "settings";
const CHATS_STORE = "chats";

const PROVIDER_KEY = "provider";
const PROVIDERS_STATE_KEY = "providers-state";
const SYSTEM_PROMPT_KEY = "system-prompt";
const ACTIVE_CHAT_ID_KEY = "active-chat-id";
const MODEL_CACHE_KEY_PREFIX = "provider-models:";
const TOOLS_SETTINGS_KEY = "tools-settings";
const SKILLS_SETTINGS_KEY = "skills-settings";
const AGENTS_SETTINGS_KEY = "agents-settings";
const APP_SETTINGS_KEY = "app-settings";
const MCP_SETTINGS_KEY = "mcp-settings";
const MODES_STATE_KEY = "modes-state";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  chatTitleGenerationMode: "local",
  fontFamily: "sans",
  chatFolders: [],
  thinkingAutoCollapse: false,
  renderMarkdownWhileStreaming: true,
};

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  enabled: true,
  servers: [],
};

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

type KeyValueRecord<T = unknown> = {
  key: string;
  value: T;
};

type IndexedDbSnapshot = {
  providersState?: ProvidersState;
  systemPrompt?: string;
  activeChatId?: string;
  appSettings?: AppSettings;
  providerModelsCache: Record<string, string[]>;
  chats: ChatSession[];
};

type ChatForgeStorageApi = {
  isInitialized: () => Promise<boolean>;
  migrateFromIndexedDb: (snapshot: IndexedDbSnapshot) => Promise<unknown>;
  loadProvidersState: () => Promise<ProvidersState | undefined>;
  saveProvidersState: (value: ProvidersState) => Promise<void>;
  loadSystemPrompt: () => Promise<string | undefined>;
  saveSystemPrompt: (value: string) => Promise<void>;
  loadActiveChatId: () => Promise<string | undefined>;
  saveActiveChatId: (chatId: string) => Promise<void>;
  loadToolsSettings: () => Promise<ToolsSettings | undefined>;
  saveToolsSettings: (value: ToolsSettings) => Promise<void>;
  loadSkillsSettings: () => Promise<SkillsSettings | undefined>;
  saveSkillsSettings: (value: SkillsSettings) => Promise<void>;
  loadAgentsSettings: () => Promise<AgentsSettings | undefined>;
  saveAgentsSettings: (value: AgentsSettings) => Promise<void>;
  loadAppSettings: () => Promise<AppSettings | undefined>;
  saveAppSettings: (value: AppSettings) => Promise<void>;
  loadMcpSettings: () => Promise<McpSettings | undefined>;
  saveMcpSettings: (value: McpSettings) => Promise<void>;
  loadModesState: () => Promise<ModesState | undefined>;
  saveModesState: (value: ModesState) => Promise<void>;
  loadTools: () => Promise<LoadedToolInfo[]>;
  saveTool: (tool: LoadedToolInfo) => Promise<LoadedToolInfo>;
  deleteTool: (toolId: string) => Promise<void>;
  importTools: () => Promise<ToolImportResult>;
  exportTool: (tool: LoadedToolInfo) => Promise<ToolExportResult>;
  exportTools: (tools: LoadedToolInfo[]) => Promise<ToolExportResult>;
  openToolsFolder: () => Promise<void>;
  loadSkills: (request?: {
    workspaceRoots?: ChatWorkspaceRoot[];
  }) => Promise<LoadedSkillInfo[]>;
  saveSkill: (
    skill: LoadedSkillInfo,
    previousName?: string,
  ) => Promise<LoadedSkillInfo>;
  deleteSkill: (skillName: string) => Promise<void>;
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
  loadCachedProviderModels: (cacheKey: string) => Promise<string[]>;
  saveCachedProviderModels: (
    cacheKey: string,
    models: string[],
  ) => Promise<void>;
  loadChats: () => Promise<ChatSession[]>;
  saveChat: (chat: ChatSession) => Promise<void>;
  deleteChat: (chatId: string) => Promise<void>;
  deleteAllChats: () => Promise<void>;
};

let jsonStorageReadyPromise: Promise<void> | undefined;

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultChatTitle() {
  return "New chat";
}

export function createEmptyChat(): ChatSession {
  const now = new Date().toISOString();

  return {
    id: createId(),
    title: defaultChatTitle(),
    titleMode: "auto",
    isPinned: false,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function parseCustomHeaders(customHeaders?: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const rawLine of customHeaders?.split(/\r?\n/) ?? []) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) continue;

    const name = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (name && value) headers[name] = value;
  }

  return headers;
}

export function normalizeProvider(
  provider: Partial<ProviderConfig>,
): ProviderConfig {
  const legacyHeaders = parseCustomHeaders(provider.customHeaders);

  return normalizeProviderForState({
    ...defaultProvider,
    ...provider,
    id: provider.id?.trim() || `provider-${createId()}`,
    headers: provider.headers ?? legacyHeaders,
  });
}

function normalizeProvidersState(value?: ProvidersState): ProvidersState {
  if (value?.providers?.length) {
    const providers = value.providers.map(normalizeProvider);
    const activeProviderId = providers.some(
      (provider) => provider.id === value.activeProviderId,
    )
      ? value.activeProviderId
      : providers[0].id;

    return { providers, activeProviderId };
  }

  const provider = normalizeProvider(defaultProvider);
  return {
    providers: [provider],
    activeProviderId: provider.id,
  };
}

function legacyToolPermission(
  enabled: unknown,
  autoApproved: unknown,
  fallbackEnabled = true,
) {
  const isEnabled = typeof enabled === "boolean" ? enabled : fallbackEnabled;
  if (!isEnabled) return "deny" as const;
  return autoApproved === true ? ("allow" as const) : ("ask" as const);
}

const MAX_BUILT_IN_TOOL_TIMEOUT_MS = 10 * 60_000;

function normalizeBuiltInToolSettings(
  value: unknown,
): ToolsSettings["builtInToolSettings"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: NonNullable<ToolsSettings["builtInToolSettings"]> = {};
  for (const [name, rawSettings] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (
      !name.trim() ||
      !rawSettings ||
      typeof rawSettings !== "object" ||
      Array.isArray(rawSettings)
    )
      continue;
    const source = rawSettings as Record<string, unknown>;
    const customDescription =
      typeof source.customDescription === "string"
        ? source.customDescription
        : "";
    const timeout =
      typeof source.timeoutMs === "number" &&
      Number.isFinite(source.timeoutMs) &&
      source.timeoutMs > 0
        ? Math.min(Math.round(source.timeoutMs), MAX_BUILT_IN_TOOL_TIMEOUT_MS)
        : undefined;

    result[name] = {
      descriptionMode:
        source.descriptionMode === "custom" ? "custom" : "default",
      customDescription,
      ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
    };
  }

  return result;
}

function normalizeToolsSettings(
  value: Partial<ToolsSettings> | undefined,
): ToolsSettings {
  const legacyChecklistWriteEnabled = (
    value as Partial<ToolsSettings> & { checklistWriteEnabled?: unknown }
  )?.checklistWriteEnabled;
  const legacy = value as Partial<ToolsSettings> & Record<string, unknown>;
  const permissionOverrides = normalizePermissionMap(
    (value as Record<string, unknown> | undefined)?.toolPermissions,
  );
  const readEnabled = value?.readEnabled ?? legacy.fileReadEnabled;
  const bashEnabled = value?.bashEnabled ?? legacy.terminalExecEnabled;
  const editEnabled = value?.editEnabled ?? legacy.fileReplaceTextEnabled;
  const writeEnabled = value?.writeEnabled ?? legacy.fileCreateEnabled;
  const permissionModelVersion =
    (value as Record<string, unknown> | undefined)?.permissionModelVersion === 2
      ? 2
      : undefined;
  const toolsPermission: FeaturePermission =
    permissionModelVersion === 2
      ? normalizeFeaturePermission(
          (value as Record<string, unknown> | undefined)?.toolsPermission,
          "custom",
        )
      : "custom";
  const toolPermissions: PermissionMap = {
    ask_user: legacyToolPermission(value?.askUserEnabled, true, true),
    update_tasks: legacyToolPermission(
      typeof value?.taskToolsEnabled === "boolean"
        ? value.taskToolsEnabled
        : typeof legacyChecklistWriteEnabled === "boolean"
          ? legacyChecklistWriteEnabled
          : true,
      true,
      true,
    ),
    skill: legacyToolPermission(value?.loadSkillEnabled, false, true),
    web_fetch: legacyToolPermission(value?.webFetchEnabled, false, false),
    read: legacyToolPermission(
      readEnabled,
      value?.readAutoApproveEnabled,
      true,
    ),
    bash: legacyToolPermission(
      bashEnabled,
      value?.bashAutoApproveEnabled,
      true,
    ),
    edit: legacyToolPermission(
      editEnabled,
      value?.editAutoApproveEnabled ?? legacy.fileReplaceTextAutoApproveEnabled,
      true,
    ),
    write: legacyToolPermission(
      writeEnabled,
      value?.writeAutoApproveEnabled ?? legacy.fileCreateAutoApproveEnabled,
      true,
    ),
    call_agent: "ask",
    ...permissionOverrides,
  };

  const toolsEnabled =
    permissionModelVersion === 2
      ? toolsPermission !== "deny"
      : typeof value?.enabled === "boolean"
        ? value.enabled
        : true;

  return {
    enabled: toolsEnabled,
    toolsPermission,
    permissionModelVersion: 2,
    builtInToolSettings: normalizeBuiltInToolSettings(
      (value as Record<string, unknown> | undefined)?.builtInToolSettings,
    ),
    askUserEnabled: toolPermissions.ask_user !== "deny",
    taskToolsEnabled: toolPermissions.update_tasks !== "deny",
    loadSkillEnabled: toolPermissions.skill !== "deny",
    webFetchEnabled: toolPermissions.web_fetch !== "deny",
    readEnabled: toolPermissions.read !== "deny",
    bashEnabled: toolPermissions.bash !== "deny",
    editEnabled: toolPermissions.edit !== "deny",
    writeEnabled: toolPermissions.write !== "deny",
    readAutoApproveEnabled: toolPermissions.read === "allow",
    bashAutoApproveEnabled: toolPermissions.bash === "allow",
    editAutoApproveEnabled: toolPermissions.edit === "allow",
    writeAutoApproveEnabled: toolPermissions.write === "allow",
    toolPermissions,
  };
}

function normalizeSkillsSettings(
  value: Partial<SkillsSettings> | undefined,
): SkillsSettings {
  const permissionModelVersion =
    (value as Record<string, unknown> | undefined)?.permissionModelVersion === 2
      ? 2
      : undefined;
  const skillsPermission: FeaturePermission =
    permissionModelVersion === 2
      ? normalizeFeaturePermission(
          (value as Record<string, unknown> | undefined)?.skillsPermission,
          "custom",
        )
      : "custom";
  const skillsEnabled =
    permissionModelVersion === 2
      ? skillsPermission !== "deny"
      : typeof value?.enabled === "boolean"
        ? value.enabled
        : true;

  return {
    enabled: skillsEnabled,
    skillsPermission,
    skillPermissions: normalizePermissionMap(
      (value as Record<string, unknown> | undefined)?.skillPermissions,
    ),
    permissionModelVersion: 2,
  };
}

function normalizeAgentsSettings(
  value: Partial<AgentsSettings> | undefined,
): AgentsSettings {
  const builtInAgentMaxNestingDepths: Record<string, number> = {};
  const source = value?.builtInAgentMaxNestingDepths;

  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [name, rawDepth] of Object.entries(source)) {
      const depth = Number(rawDepth);
      if (!name.trim() || !Number.isFinite(depth)) continue;
      builtInAgentMaxNestingDepths[name] = Math.min(
        Math.max(Math.round(depth), 1),
        8,
      );
    }
  }

  const permissionModelVersion =
    (value as Record<string, unknown> | undefined)?.permissionModelVersion === 2
      ? 2
      : undefined;
  const agentsPermission: FeaturePermission =
    permissionModelVersion === 2
      ? normalizeFeaturePermission(
          (value as Record<string, unknown> | undefined)?.agentsPermission,
          "custom",
        )
      : "custom";

  const agentsEnabled =
    permissionModelVersion === 2
      ? agentsPermission !== "deny"
      : typeof value?.enabled === "boolean"
        ? value.enabled
        : true;

  return {
    enabled: agentsEnabled,
    agentsPermission,
    agentPermissions: normalizePermissionMap(
      (value as Record<string, unknown> | undefined)?.agentPermissions,
    ),
    builtInAgentMaxNestingDepths,
    permissionModelVersion: 2,
  };
}

function normalizeChatFolderWorkspaceRoots(
  value: unknown,
): ChatFolder["workspaceRoots"] {
  if (!Array.isArray(value)) return undefined;

  const roots = value
    .filter((root): root is Record<string, unknown> =>
      Boolean(root && typeof root === "object" && !Array.isArray(root)),
    )
    .map((root) => {
      const id =
        typeof root.id === "string" && root.id.trim()
          ? root.id.trim()
          : `workspace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const path = typeof root.path === "string" ? root.path.trim() : "";
      if (!path) return undefined;

      const kind: ChatWorkspaceRoot["kind"] =
        root.kind === "chat" || root.kind === "manual" || root.kind === "skill"
          ? root.kind
          : undefined;

      return {
        id,
        name:
          typeof root.name === "string" && root.name.trim()
            ? root.name.trim()
            : path,
        path,
        createdAt:
          typeof root.createdAt === "string" && root.createdAt.trim()
            ? root.createdAt
            : new Date().toISOString(),
        automatic:
          typeof root.automatic === "boolean" ? root.automatic : undefined,
        kind,
      } satisfies ChatWorkspaceRoot;
    })
    .filter((root): root is NonNullable<typeof root> => Boolean(root));

  return roots.length ? roots.slice(0, 1) : undefined;
}

function normalizeChatFolders(value: unknown): ChatFolder[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const now = new Date().toISOString();

  return value
    .filter((folder): folder is Record<string, unknown> =>
      Boolean(folder && typeof folder === "object" && !Array.isArray(folder)),
    )
    .map((folder) => {
      const rawId = typeof folder.id === "string" ? folder.id.trim() : "";
      const id =
        rawId || `folder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      if (seenIds.has(id)) return undefined;
      seenIds.add(id);

      const createdAt =
        typeof folder.createdAt === "string" && folder.createdAt.trim()
          ? folder.createdAt
          : now;

      const workspaceRoots = normalizeChatFolderWorkspaceRoots(
        folder.workspaceRoots,
      );

      return {
        id,
        name:
          typeof folder.name === "string" && folder.name.trim()
            ? folder.name.trim()
            : "New folder",
        createdAt,
        updatedAt:
          typeof folder.updatedAt === "string" && folder.updatedAt.trim()
            ? folder.updatedAt
            : createdAt,
        ...(workspaceRoots ? { workspaceRoots } : {}),
      } satisfies ChatFolder;
    })
    .filter((folder): folder is ChatFolder => folder !== undefined);
}

export function normalizeAppSettings(
  value: Partial<AppSettings> | undefined,
): AppSettings {
  return {
    chatTitleGenerationMode:
      value?.chatTitleGenerationMode === "ai" ? "ai" : "local",
    fontFamily: value?.fontFamily === "mono" ? "mono" : "sans",
    chatFolders: normalizeChatFolders(value?.chatFolders),
    thinkingAutoCollapse: value?.thinkingAutoCollapse ?? true,
    renderMarkdownWhileStreaming:
      value?.renderMarkdownWhileStreaming ?? true,
  };
}

function normalizeStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;

  const entries = Object.entries(value)
    .map(
      ([key, rawValue]) =>
        [key.trim(), typeof rawValue === "string" ? rawValue : ""] as const,
    )
    .filter(([key, rawValue]) => key && rawValue.length > 0);

  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeMcpSettings(
  value: Partial<McpSettings> | undefined,
): McpSettings {
  const servers = Array.isArray(value?.servers) ? value.servers : [];

  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
    servers: servers
      .filter(
        (server) =>
          server && typeof server === "object" && !Array.isArray(server),
      )
      .map((server) => {
        const source = server as Record<string, unknown>;
        const id =
          typeof source.id === "string" && source.id.trim()
            ? source.id.trim()
            : `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const name =
          typeof source.name === "string" && source.name.trim()
            ? source.name.trim()
            : id;
        const transport = source.transport === "http" ? "http" : "stdio";
        const rawTools =
          source.tools &&
          typeof source.tools === "object" &&
          !Array.isArray(source.tools)
            ? (source.tools as Record<string, unknown>)
            : {};
        const tools = Object.fromEntries(
          Object.entries(rawTools)
            .filter(
              ([, value]) =>
                value && typeof value === "object" && !Array.isArray(value),
            )
            .map(([toolName, value]) => {
              const rawTool = value as Record<string, unknown>;
              const originalName =
                typeof rawTool.originalName === "string" &&
                rawTool.originalName.trim()
                  ? rawTool.originalName.trim()
                  : toolName;
              const exposedName =
                typeof rawTool.exposedName === "string"
                  ? rawTool.exposedName.trim()
                  : "";
              const description =
                typeof rawTool.description === "string"
                  ? rawTool.description
                  : undefined;
              const inputSchema =
                rawTool.inputSchema &&
                typeof rawTool.inputSchema === "object" &&
                !Array.isArray(rawTool.inputSchema)
                  ? (rawTool.inputSchema as Record<string, unknown>)
                  : undefined;

              return [
                originalName,
                {
                  originalName,
                  exposedName,
                  enabled:
                    typeof rawTool.enabled === "boolean"
                      ? rawTool.enabled
                      : false,
                  ...(description ? { description } : {}),
                  ...(inputSchema ? { inputSchema } : {}),
                  ...(typeof rawTool.requireApproval === "boolean"
                    ? { requireApproval: rawTool.requireApproval }
                    : {}),
                  ...(typeof rawTool.lastSeenAt === "string"
                    ? { lastSeenAt: rawTool.lastSeenAt }
                    : {}),
                },
              ];
            }),
        );

        return {
          id,
          name,
          enabled: typeof source.enabled === "boolean" ? source.enabled : true,
          transport,
          command:
            typeof source.command === "string" ? source.command : undefined,
          args: Array.isArray(source.args)
            ? source.args.filter(
                (arg): arg is string => typeof arg === "string",
              )
            : [],
          cwd: typeof source.cwd === "string" ? source.cwd : undefined,
          env: normalizeStringRecord(source.env),
          url: typeof source.url === "string" ? source.url : undefined,
          headers: normalizeStringRecord(source.headers),
          timeoutMs:
            typeof source.timeoutMs === "number" &&
            Number.isFinite(source.timeoutMs) &&
            source.timeoutMs > 0
              ? Math.min(Math.round(source.timeoutMs), 10 * 60_000)
              : 60_000,
          requireApproval:
            typeof source.requireApproval === "boolean"
              ? source.requireApproval
              : true,
          tools,
          lastError:
            typeof source.lastError === "string" ? source.lastError : undefined,
          lastConnectedAt:
            typeof source.lastConnectedAt === "string"
              ? source.lastConnectedAt
              : undefined,
        };
      }),
  };
}

function getJsonStorageApi() {
  return typeof window !== "undefined"
    ? (window as Window & { chatForgeStorage?: ChatForgeStorageApi })
        .chatForgeStorage
    : undefined;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(KV_STORE)) {
        db.createObjectStore(KV_STORE, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(CHATS_STORE)) {
        const chatsStore = db.createObjectStore(CHATS_STORE, { keyPath: "id" });
        chatsStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

async function legacyGetSetting<T>(key: string, fallback: T): Promise<T> {
  if (typeof window === "undefined") return fallback;

  const db = await openDatabase();

  try {
    const transaction = db.transaction(KV_STORE, "readonly");
    const store = transaction.objectStore(KV_STORE);
    const record = await requestToPromise<KeyValueRecord<T> | undefined>(
      store.get(key),
    );
    return record?.value ?? fallback;
  } finally {
    db.close();
  }
}

async function legacySetSetting<T>(key: string, value: T): Promise<void> {
  if (typeof window === "undefined") return;

  const db = await openDatabase();

  try {
    const transaction = db.transaction(KV_STORE, "readwrite");
    transaction
      .objectStore(KV_STORE)
      .put({ key, value } satisfies KeyValueRecord<T>);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

async function legacyLoadProvider(): Promise<ProviderConfig> {
  const provider = await legacyGetSetting<ProviderConfig | undefined>(
    PROVIDER_KEY,
    undefined,
  );
  return provider
    ? normalizeProvider(provider)
    : normalizeProvider(defaultProvider);
}

async function legacyLoadProvidersState(): Promise<ProvidersState> {
  const providersState = await legacyGetSetting<ProvidersState | undefined>(
    PROVIDERS_STATE_KEY,
    undefined,
  );

  if (providersState?.providers?.length) {
    return normalizeProvidersState(providersState);
  }

  const provider = await legacyLoadProvider();
  return {
    providers: [provider],
    activeProviderId: provider.id,
  };
}

async function legacyLoadChats(): Promise<ChatSession[]> {
  if (typeof window === "undefined") return [];

  const db = await openDatabase();

  try {
    const transaction = db.transaction(CHATS_STORE, "readonly");
    const store = transaction.objectStore(CHATS_STORE);
    const chats = await requestToPromise<ChatSession[]>(store.getAll());

    return sortChatsByUpdatedAt(chats);
  } finally {
    db.close();
  }
}

async function legacySaveChat(chat: ChatSession): Promise<void> {
  if (typeof window === "undefined") return;

  const db = await openDatabase();

  try {
    const transaction = db.transaction(CHATS_STORE, "readwrite");
    transaction.objectStore(CHATS_STORE).put(chat);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

async function legacyDeleteChat(chatId: string): Promise<void> {
  if (typeof window === "undefined") return;

  const db = await openDatabase();

  try {
    const transaction = db.transaction(CHATS_STORE, "readwrite");
    transaction.objectStore(CHATS_STORE).delete(chatId);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

async function legacyDeleteAllChats(): Promise<void> {
  if (typeof window === "undefined") return;

  const db = await openDatabase();

  try {
    const transaction = db.transaction(CHATS_STORE, "readwrite");
    transaction.objectStore(CHATS_STORE).clear();
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

function getHeadersCacheKey(headers?: Record<string, string>) {
  return Object.entries(headers ?? {})
    .map(([name, value]) => [name.trim().toLowerCase(), value.trim()] as const)
    .filter(([name, value]) => name && value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
}

function getProviderModelsCacheKey(
  provider: Pick<ProviderConfig, "baseUrl" | "headers" | "customHeaders">,
) {
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, "");
  const headers =
    provider.headers ?? parseCustomHeaders(provider.customHeaders);

  return `${MODEL_CACHE_KEY_PREFIX}${baseUrl}|${getHeadersCacheKey(headers)}`;
}

async function collectLegacyModelCache(providersState: ProvidersState) {
  const cache: Record<string, string[]> = {};

  for (const provider of providersState.providers) {
    const key = getProviderModelsCacheKey(provider);
    if (!key.trim()) continue;
    const models = await legacyGetSetting<string[]>(key, []);
    if (Array.isArray(models) && models.length) cache[key] = models;
  }

  return cache;
}

async function readIndexedDbSnapshot(): Promise<IndexedDbSnapshot> {
  const providersState = await legacyLoadProvidersState();

  return {
    providersState,
    systemPrompt: await legacyGetSetting(
      SYSTEM_PROMPT_KEY,
      DEFAULT_SYSTEM_PROMPT,
    ),
    activeChatId: await legacyGetSetting<string | undefined>(
      ACTIVE_CHAT_ID_KEY,
      undefined,
    ),
    appSettings: await legacyGetSetting<AppSettings | undefined>(
      APP_SETTINGS_KEY,
      undefined,
    ),
    providerModelsCache: await collectLegacyModelCache(providersState),
    chats: await legacyLoadChats(),
  };
}

async function ensureJsonStorageReady() {
  const api = getJsonStorageApi();
  if (!api) return undefined;

  jsonStorageReadyPromise ??= (async () => {
    const initialized = await api.isInitialized();
    if (!initialized) {
      await api.migrateFromIndexedDb(await readIndexedDbSnapshot());
    }
  })();

  await jsonStorageReadyPromise;
  return api;
}

export async function loadProvider(): Promise<ProviderConfig> {
  const providersState = await loadProvidersState();
  return (
    providersState.providers.find(
      (provider) => provider.id === providersState.activeProviderId,
    ) ?? providersState.providers[0]
  );
}

export async function saveProvider(provider: ProviderConfig): Promise<void> {
  const current = await loadProvidersState();
  const normalizedProvider = normalizeProvider(provider);
  const providers = current.providers.some(
    (item) => item.id === normalizedProvider.id,
  )
    ? current.providers.map((item) =>
        item.id === normalizedProvider.id ? normalizedProvider : item,
      )
    : [...current.providers, normalizedProvider];

  await saveProvidersState({
    providers,
    activeProviderId: normalizedProvider.id,
  });
}

export async function loadProvidersState(): Promise<ProvidersState> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return normalizeProvidersState(await api.loadProvidersState());
  }

  return legacyLoadProvidersState();
}

export async function saveProvidersState(value: ProvidersState): Promise<void> {
  const normalized = normalizeProvidersState(value);
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.saveProvidersState(normalized);
    return;
  }

  await legacySetSetting(PROVIDERS_STATE_KEY, normalized);
}

export async function loadSystemPrompt(): Promise<string> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return (await api.loadSystemPrompt()) ?? DEFAULT_SYSTEM_PROMPT;
  }

  return legacyGetSetting(SYSTEM_PROMPT_KEY, DEFAULT_SYSTEM_PROMPT);
}

export async function saveSystemPrompt(value: string): Promise<void> {
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.saveSystemPrompt(value);
    return;
  }

  await legacySetSetting(SYSTEM_PROMPT_KEY, value);
}

export async function loadActiveChatId(): Promise<string | undefined> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.loadActiveChatId();
  }

  return legacyGetSetting<string | undefined>(ACTIVE_CHAT_ID_KEY, undefined);
}

export async function saveActiveChatId(chatId: string): Promise<void> {
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.saveActiveChatId(chatId);
    return;
  }

  await legacySetSetting(ACTIVE_CHAT_ID_KEY, chatId);
}

export async function loadToolsSettings(): Promise<ToolsSettings> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return normalizeToolsSettings(await api.loadToolsSettings());
  }

  return normalizeToolsSettings(
    await legacyGetSetting<ToolsSettings | undefined>(
      TOOLS_SETTINGS_KEY,
      undefined,
    ),
  );
}

export async function saveToolsSettings(value: ToolsSettings): Promise<void> {
  const normalized = normalizeToolsSettings(value);
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.saveToolsSettings(normalized);
    return;
  }

  await legacySetSetting(TOOLS_SETTINGS_KEY, normalized);
}

export async function loadSkillsSettings(): Promise<SkillsSettings> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return normalizeSkillsSettings(await api.loadSkillsSettings());
  }

  return normalizeSkillsSettings(
    await legacyGetSetting<SkillsSettings | undefined>(
      SKILLS_SETTINGS_KEY,
      undefined,
    ),
  );
}

export async function saveSkillsSettings(value: SkillsSettings): Promise<void> {
  const normalized = normalizeSkillsSettings(value);
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.saveSkillsSettings(normalized);
    return;
  }

  await legacySetSetting(SKILLS_SETTINGS_KEY, normalized);
}

export async function loadAgentsSettings(): Promise<AgentsSettings> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return normalizeAgentsSettings(await api.loadAgentsSettings());
  }

  return normalizeAgentsSettings(
    await legacyGetSetting<AgentsSettings | undefined>(
      AGENTS_SETTINGS_KEY,
      undefined,
    ),
  );
}

export async function saveAgentsSettings(value: AgentsSettings): Promise<void> {
  const normalized = normalizeAgentsSettings(value);
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.saveAgentsSettings(normalized);
    return;
  }

  await legacySetSetting(AGENTS_SETTINGS_KEY, normalized);
}

export async function loadAppSettings(): Promise<AppSettings> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return normalizeAppSettings(await api.loadAppSettings());
  }

  return normalizeAppSettings(
    await legacyGetSetting<AppSettings | undefined>(
      APP_SETTINGS_KEY,
      undefined,
    ),
  );
}

export async function saveAppSettings(value: AppSettings): Promise<void> {
  const normalized = normalizeAppSettings(value);
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.saveAppSettings(normalized);
    return;
  }

  await legacySetSetting(APP_SETTINGS_KEY, normalized);
}

export async function loadMcpSettings(): Promise<McpSettings> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return normalizeMcpSettings(await api.loadMcpSettings());
  }

  return normalizeMcpSettings(
    await legacyGetSetting<McpSettings | undefined>(
      MCP_SETTINGS_KEY,
      undefined,
    ),
  );
}

export async function saveMcpSettings(value: McpSettings): Promise<void> {
  const normalized = normalizeMcpSettings(value);
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.saveMcpSettings(normalized);
    return;
  }

  await legacySetSetting(MCP_SETTINGS_KEY, normalized);
}

export async function loadModesState(): Promise<ModesState> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return normalizeModesState(await api.loadModesState());
  }

  return normalizeModesState(
    await legacyGetSetting<ModesState | undefined>(MODES_STATE_KEY, undefined),
  );
}

export async function saveModesState(value: ModesState): Promise<void> {
  const normalized = serializeModesState(value);
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.saveModesState(normalized);
    return;
  }

  await legacySetSetting(MODES_STATE_KEY, normalized);
}

export async function loadTools(): Promise<LoadedToolInfo[]> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.loadTools();
  }

  return [];
}

export async function saveTool(tool: LoadedToolInfo): Promise<LoadedToolInfo> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.saveTool(tool);
  }

  throw new Error("Tool storage requires the Electron app.");
}

export async function deleteTool(toolId: string): Promise<void> {
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.deleteTool(toolId);
    return;
  }

  throw new Error("Tool storage requires the Electron app.");
}

export async function importTools(): Promise<ToolImportResult> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.importTools();
  }

  throw new Error("Tool import requires the Electron app.");
}

export async function exportTool(
  tool: LoadedToolInfo,
): Promise<ToolExportResult> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.exportTool(tool);
  }

  throw new Error("Tool export requires the Electron app.");
}

export async function exportTools(
  tools: LoadedToolInfo[],
): Promise<ToolExportResult> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.exportTools(tools);
  }

  throw new Error("Tool export requires the Electron app.");
}

export async function openToolsFolder(): Promise<void> {
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.openToolsFolder();
    return;
  }

  throw new Error("Opening the tools folder requires the Electron app.");
}

export async function loadSkills(
  workspaceRoots: ChatWorkspaceRoot[] = [],
): Promise<LoadedSkillInfo[]> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.loadSkills({ workspaceRoots });
  }

  return [];
}

export async function saveSkill(
  skill: LoadedSkillInfo,
  previousName?: string,
): Promise<LoadedSkillInfo> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.saveSkill(skill, previousName);
  }

  throw new Error("Skill storage requires the Electron app.");
}

export async function deleteSkill(skillName: string): Promise<void> {
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.deleteSkill(skillName);
    return;
  }

  throw new Error("Skill storage requires the Electron app.");
}

export async function importSkills(): Promise<SkillImportResult> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.importSkills();
  }

  throw new Error("Skill import requires the Electron app.");
}

export async function exportSkill(
  skill: LoadedSkillInfo,
): Promise<SkillExportResult> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.exportSkill(skill);
  }

  throw new Error("Skill export requires the Electron app.");
}

export async function exportSkills(
  skills: LoadedSkillInfo[],
): Promise<SkillExportResult> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.exportSkills(skills);
  }

  throw new Error("Skill export requires the Electron app.");
}

export async function openSkillsFolder(): Promise<void> {
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.openSkillsFolder();
    return;
  }

  throw new Error("Opening the skills folder requires the Electron app.");
}

export async function loadAgents(): Promise<LoadedAgentInfo[]> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.loadAgents();
  }

  return [];
}

export async function saveAgent(
  agent: LoadedAgentInfo,
): Promise<LoadedAgentInfo> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.saveAgent(agent);
  }

  throw new Error("Agent storage requires the Electron app.");
}

export async function deleteAgent(agentId: string): Promise<void> {
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.deleteAgent(agentId);
    return;
  }

  throw new Error("Agent storage requires the Electron app.");
}

export async function importAgents(): Promise<AgentImportResult> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.importAgents();
  }

  throw new Error("Agent import requires the Electron app.");
}

export async function exportAgent(
  agent: LoadedAgentInfo,
): Promise<AgentExportResult> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.exportAgent(agent);
  }

  throw new Error("Agent export requires the Electron app.");
}

export async function exportAgents(
  agents: LoadedAgentInfo[],
): Promise<AgentExportResult> {
  const api = await ensureJsonStorageReady();

  if (api) {
    return api.exportAgents(agents);
  }

  throw new Error("Agent export requires the Electron app.");
}

export async function openAgentsFolder(): Promise<void> {
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.openAgentsFolder();
    return;
  }

  throw new Error("Opening the agents folder requires the Electron app.");
}

export async function loadCachedProviderModels(
  provider: Pick<ProviderConfig, "baseUrl" | "headers" | "customHeaders">,
): Promise<string[]> {
  if (!provider.baseUrl.trim()) return [];

  const cacheKey = getProviderModelsCacheKey(provider);
  const api = await ensureJsonStorageReady();
  const models = api
    ? await api.loadCachedProviderModels(cacheKey)
    : await legacyGetSetting<string[]>(cacheKey, []);

  return Array.isArray(models)
    ? [
        ...new Set(
          models
            .filter((model) => typeof model === "string" && model.trim())
            .map((model) => model.trim()),
        ),
      ]
    : [];
}

export async function saveCachedProviderModels(
  provider: Pick<ProviderConfig, "baseUrl" | "headers" | "customHeaders">,
  models: string[],
): Promise<void> {
  if (!provider.baseUrl.trim()) return;

  const cacheKey = getProviderModelsCacheKey(provider);
  const normalizedModels = [
    ...new Set(
      models
        .filter((model) => typeof model === "string" && model.trim())
        .map((model) => model.trim()),
    ),
  ].sort((left, right) => left.localeCompare(right));

  const api = await ensureJsonStorageReady();

  if (api) {
    await api.saveCachedProviderModels(cacheKey, normalizedModels);
    return;
  }

  await legacySetSetting(cacheKey, normalizedModels);
}

export async function loadChats(): Promise<ChatSession[]> {
  const api = await ensureJsonStorageReady();

  if (api) {
    const chats = await api.loadChats();
    return sortChatsByUpdatedAt(chats);
  }

  return legacyLoadChats();
}

export async function saveChat(chat: ChatSession): Promise<void> {
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.saveChat(chat);
    return;
  }

  await legacySaveChat(chat);
}

export async function deleteChat(chatId: string): Promise<void> {
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.deleteChat(chatId);
    return;
  }

  await legacyDeleteChat(chatId);
}

export async function deleteAllChats(): Promise<void> {
  const api = await ensureJsonStorageReady();

  if (api) {
    await api.deleteAllChats();
    return;
  }

  await legacyDeleteAllChats();
}
