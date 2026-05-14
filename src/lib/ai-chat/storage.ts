import { defaultGenerationSettings, defaultProvider } from "./provider-presets";
import { sortChatsByUpdatedAt } from "./chat-utils";
import type { ChatSession, ProviderConfig, ProvidersState, ToolsSettings } from "./types";

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

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

type KeyValueRecord<T = unknown> = {
  key: string;
  value: T;
};

type IndexedDbSnapshot = {
  providersState?: ProvidersState;
  systemPrompt?: string;
  activeChatId?: string;
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
  loadCachedProviderModels: (cacheKey: string) => Promise<string[]>;
  saveCachedProviderModels: (cacheKey: string, models: string[]) => Promise<void>;
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

export function normalizeProvider(provider: Partial<ProviderConfig>): ProviderConfig {
  const legacyHeaders = parseCustomHeaders(provider.customHeaders);
  const headers = provider.headers ?? legacyHeaders;
  const models = [...new Set((provider.models ?? []).filter(Boolean).map((model) => model.trim()))].sort((a, b) => a.localeCompare(b));
  const enabledModelIds = [...new Set((provider.enabledModelIds ?? (provider.model ? [provider.model] : [])).filter(Boolean).map((model) => model.trim()))];
  const model = provider.model?.trim() || enabledModelIds[0] || "";

  return {
    ...defaultProvider,
    ...provider,
    id: provider.id?.trim() || `provider-${createId()}`,
    name: provider.name ?? "",
    baseUrl: provider.baseUrl ?? "",
    apiKey: provider.apiKey ?? "",
    model,
    models: [...new Set([...models, ...enabledModelIds, model].filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    enabledModelIds,
    headers,
    customHeaders: undefined,
    defaultSettings: {
      ...defaultGenerationSettings,
      ...(provider.defaultSettings ?? {}),
    },
    modelSettings: provider.modelSettings ?? {},
  };
}

function normalizeProvidersState(value?: ProvidersState): ProvidersState {
  if (value?.providers?.length) {
    const providers = value.providers.map(normalizeProvider);
    const activeProviderId = providers.some((provider) => provider.id === value.activeProviderId)
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

function normalizeToolsSettings(value: Partial<ToolsSettings> | undefined): ToolsSettings {
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
    directory: typeof value?.directory === "string" ? value.directory : "",
    disabledToolNames: Array.isArray(value?.disabledToolNames)
      ? [...new Set(value.disabledToolNames.filter((name): name is string => typeof name === "string" && name.trim().length > 0).map((name) => name.trim()))]
      : [],
  };
}

function getJsonStorageApi() {
  return typeof window !== "undefined"
    ? (window as Window & { chatForgeStorage?: ChatForgeStorageApi }).chatForgeStorage
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
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

async function legacyGetSetting<T>(key: string, fallback: T): Promise<T> {
  if (typeof window === "undefined") return fallback;

  const db = await openDatabase();

  try {
    const transaction = db.transaction(KV_STORE, "readonly");
    const store = transaction.objectStore(KV_STORE);
    const record = await requestToPromise<KeyValueRecord<T> | undefined>(store.get(key));
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
    transaction.objectStore(KV_STORE).put({ key, value } satisfies KeyValueRecord<T>);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

async function legacyLoadProvider(): Promise<ProviderConfig> {
  const provider = await legacyGetSetting<ProviderConfig | undefined>(PROVIDER_KEY, undefined);
  return provider ? normalizeProvider(provider) : normalizeProvider(defaultProvider);
}

async function legacyLoadProvidersState(): Promise<ProvidersState> {
  const providersState = await legacyGetSetting<ProvidersState | undefined>(PROVIDERS_STATE_KEY, undefined);

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

function getProviderModelsCacheKey(provider: Pick<ProviderConfig, "baseUrl" | "headers" | "customHeaders">) {
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, "");
  const headers = provider.headers ?? parseCustomHeaders(provider.customHeaders);

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
    systemPrompt: await legacyGetSetting(SYSTEM_PROMPT_KEY, DEFAULT_SYSTEM_PROMPT),
    activeChatId: await legacyGetSetting<string | undefined>(ACTIVE_CHAT_ID_KEY, undefined),
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
  return providersState.providers.find((provider) => provider.id === providersState.activeProviderId) ?? providersState.providers[0];
}

export async function saveProvider(provider: ProviderConfig): Promise<void> {
  const current = await loadProvidersState();
  const normalizedProvider = normalizeProvider(provider);
  const providers = current.providers.some((item) => item.id === normalizedProvider.id)
    ? current.providers.map((item) => (item.id === normalizedProvider.id ? normalizedProvider : item))
    : [...current.providers, normalizedProvider];

  await saveProvidersState({ providers, activeProviderId: normalizedProvider.id });
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

  return normalizeToolsSettings(await legacyGetSetting<ToolsSettings | undefined>(TOOLS_SETTINGS_KEY, undefined));
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
