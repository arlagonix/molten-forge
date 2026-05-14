import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ROOT = path.join(__dirname, "..");
process.env.APP_ROOT = APP_ROOT;

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(APP_ROOT, "dist");

function getPackagedAppRoot() {
  // In production, this points to the real packaged app root, including app.asar.
  // Example: C:\...\resources\app.asar
  return app.isPackaged ? app.getAppPath() : APP_ROOT;
}

function getRendererDist() {
  return app.isPackaged
    ? path.join(getPackagedAppRoot(), "dist")
    : RENDERER_DIST;
}

function getPublicAssetsPath() {
  return VITE_DEV_SERVER_URL
    ? path.join(APP_ROOT, "public")
    : getRendererDist();
}

process.env.VITE_PUBLIC = getPublicAssetsPath();

type AiProviderRequest = {
  baseUrl?: unknown;
  apiKey?: unknown;
  customHeaders?: unknown;
  headers?: unknown;
  payload?: unknown;
};

type ChatTokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type StreamResult = {
  usage?: ChatTokenUsage;
  finishReason?: string;
  content?: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
};

type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: unknown) => unknown | Promise<unknown>;
  filePath: string;
};

type PublicToolDefinition = Omit<ToolDefinition, "execute">;

type ToolsSettings = {
  enabled: boolean;
  directory: string;
};

type ToolLoadError = {
  filePath: string;
  message: string;
};

const blockedUpstreamHeaders = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "origin",
  "referer",
  "cookie",
]);

const activeStreamControllers = new Map<string, AbortController>();
const loadedTools = new Map<string, ToolDefinition>();
const DEFAULT_TOOLS_SETTINGS: ToolsSettings = { enabled: true, directory: "" };
const TOOL_EXECUTION_TIMEOUT_MS = 30_000;
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const APP_TITLE = `Chat Forge v${app.getVersion()}`;
let win: BrowserWindow | null = null;

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

function assertProviderRequest(request: AiProviderRequest) {
  if (!request || typeof request !== "object") {
    throw new Error("Provider request is required.");
  }

  if (typeof request.baseUrl !== "string" || !request.baseUrl.trim()) {
    throw new Error("Provider base URL is required.");
  }

  return {
    baseUrl: request.baseUrl,
    apiKey: typeof request.apiKey === "string" ? request.apiKey : "",
    customHeaders:
      typeof request.customHeaders === "string" ? request.customHeaders : "",
    headers:
      request.headers &&
      typeof request.headers === "object" &&
      !Array.isArray(request.headers)
        ? (request.headers as Record<string, unknown>)
        : {},
    payload: request.payload,
  };
}

function buildUpstreamHeaders({
  apiKey,
  customHeaders,
  headers: providerHeaders,
  accept,
  contentType,
}: {
  apiKey?: string;
  customHeaders?: string;
  headers?: Record<string, unknown>;
  accept?: string;
  contentType?: string;
}) {
  const headers = new Headers();

  if (contentType) headers.set("Content-Type", contentType);
  if (accept) headers.set("Accept", accept);

  for (const rawLine of customHeaders?.split(/\r?\n/) ?? []) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) continue;

    const name = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    const lowerName = name.toLowerCase();

    if (!name || !value || blockedUpstreamHeaders.has(lowerName)) continue;

    try {
      headers.set(name, value);
    } catch {
      // Ignore invalid custom headers.
    }
  }

  for (const [name, rawValue] of Object.entries(providerHeaders ?? {})) {
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    const lowerName = name.toLowerCase();

    if (!name || !value || blockedUpstreamHeaders.has(lowerName)) continue;

    try {
      headers.set(name, value);
    } catch {
      // Ignore invalid provider headers.
    }
  }

  const trimmedApiKey = apiKey?.trim();
  if (trimmedApiKey) {
    headers.set("Authorization", `Bearer ${trimmedApiKey}`);
  }

  return headers;
}

async function readUpstreamJson(response: Response) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `Provider returned ${response.status}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Provider returned a non-JSON response.");
  }
}

function getDeltaText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (
          item &&
          typeof item === "object" &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          return item.text;
        }
        if (
          item &&
          typeof item === "object" &&
          "content" in item &&
          typeof item.content === "string"
        ) {
          return item.content;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function readContentDelta(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const choices = "choices" in data ? data.choices : undefined;
  if (!Array.isArray(choices)) return "";
  const delta = choices[0]?.delta;
  if (!delta || typeof delta !== "object") return "";
  return getDeltaText("content" in delta ? delta.content : undefined);
}

function readReasoningDelta(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const choices = "choices" in data ? data.choices : undefined;
  if (!Array.isArray(choices)) return "";
  const delta = choices[0]?.delta;
  if (!delta || typeof delta !== "object") return "";
  return (
    getDeltaText(
      "reasoning_content" in delta ? delta.reasoning_content : undefined,
    ) ||
    getDeltaText("reasoning" in delta ? delta.reasoning : undefined) ||
    getDeltaText("thinking" in delta ? delta.thinking : undefined) ||
    getDeltaText(
      "reasoning_details" in delta ? delta.reasoning_details : undefined,
    )
  );
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readUsage(data: unknown): ChatTokenUsage | undefined {
  if (!data || typeof data !== "object" || !("usage" in data)) return undefined;

  const usage = data.usage;
  if (!usage || typeof usage !== "object") return undefined;

  const promptTokens = readNumber(
    "prompt_tokens" in usage ? usage.prompt_tokens : undefined,
  );
  const completionTokens = readNumber(
    "completion_tokens" in usage ? usage.completion_tokens : undefined,
  );
  const totalTokens = readNumber(
    "total_tokens" in usage ? usage.total_tokens : undefined,
  );

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return { promptTokens, completionTokens, totalTokens };
}

function readFinishReason(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const choices = "choices" in data ? data.choices : undefined;
  if (!Array.isArray(choices)) return undefined;
  const finishReason = choices[0]?.finish_reason;
  return typeof finishReason === "string" ? finishReason : undefined;
}


function normalizeToolsSettings(value: unknown): ToolsSettings {
  if (!isPlainObject(value)) return DEFAULT_TOOLS_SETTINGS;

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    directory: typeof value.directory === "string" ? value.directory : "",
  };
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && value.type === "object";
}

function validateToolDefinition(candidate: unknown, filePath: string): ToolDefinition {
  const source = isPlainObject(candidate) ? candidate : undefined;

  if (!source) throw new Error("Tool file must export an object.");

  const name = typeof source.name === "string" ? source.name.trim() : "";
  const description = typeof source.description === "string" ? source.description.trim() : "";
  const parameters = source.parameters;
  const execute = source.execute;

  if (!name) throw new Error("Tool name is required.");
  if (!TOOL_NAME_PATTERN.test(name)) {
    throw new Error("Tool name must use only letters, numbers, underscores, or hyphens.");
  }
  if (!description) throw new Error("Tool description is required.");
  if (!isJsonSchemaObject(parameters)) {
    throw new Error('Tool parameters must be a JSON schema object with type: "object".');
  }
  if (typeof execute !== "function") throw new Error("Tool execute function is required.");

  return {
    name,
    description,
    parameters,
    execute: execute as ToolDefinition["execute"],
    filePath,
  };
}

function toPublicTool(tool: ToolDefinition): PublicToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    filePath: tool.filePath,
  };
}

async function importToolFile(filePath: string) {
  const stats = await fs.stat(filePath);
  const moduleUrl = `${pathToFileURL(filePath).href}?mtime=${stats.mtimeMs}`;
  const imported = await import(moduleUrl);
  return imported.default ?? imported;
}

async function loadToolsFromDirectory(directory: string): Promise<{ tools: PublicToolDefinition[]; errors: ToolLoadError[] }> {
  loadedTools.clear();

  const trimmedDirectory = directory.trim();
  if (!trimmedDirectory) return { tools: [], errors: [] };

  const errors: ToolLoadError[] = [];
  const tools: PublicToolDefinition[] = [];

  let entries;
  try {
    entries = await fs.readdir(trimmedDirectory, { withFileTypes: true });
  } catch (error) {
    return {
      tools: [],
      errors: [{ filePath: trimmedDirectory, message: `Unable to read tools folder: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }

  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:cjs|js)$/i.test(entry.name)) continue;

    const filePath = path.join(trimmedDirectory, entry.name);

    try {
      const candidate = await importToolFile(filePath);
      const tool = validateToolDefinition(candidate, filePath);

      if (loadedTools.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}`);
      }

      loadedTools.set(tool.name, tool);
      tools.push(toPublicTool(tool));
    } catch (error) {
      errors.push({
        filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  tools.sort((left, right) => left.name.localeCompare(right.name));
  errors.sort((left, right) => left.filePath.localeCompare(right.filePath));
  return { tools, errors };
}

function stringifyToolResult(result: unknown) {
  if (typeof result === "string") return result;

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function executeLoadedTool(name: unknown, args: unknown) {
  const toolName = typeof name === "string" ? name.trim() : "";
  if (!toolName) throw new Error("Tool name is required.");

  const tool = loadedTools.get(toolName);
  if (!tool) throw new Error(`Tool is not loaded: ${toolName}`);

  const result = await withTimeout(
    Promise.resolve(tool.execute(args)),
    TOOL_EXECUTION_TIMEOUT_MS,
    `Tool timed out after ${TOOL_EXECUTION_TIMEOUT_MS / 1000} seconds.`,
  );

  return {
    toolName,
    content: stringifyToolResult(result),
  };
}

function normalizeToolCallFromChoice(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): ToolCall | undefined => {
      if (!isPlainObject(item)) return undefined;
      const fn = isPlainObject(item.function) ? item.function : undefined;
      const id = typeof item.id === "string" ? item.id : "";
      const name = typeof fn?.name === "string" ? fn.name : "";
      const args = typeof fn?.arguments === "string" ? fn.arguments : "";
      if (!id || !name) return undefined;
      return {
        id,
        type: "function",
        function: {
          name,
          arguments: args,
        },
      };
    })
    .filter((item): item is ToolCall => Boolean(item));
}

function readFinalToolCalls(data: unknown): ToolCall[] {
  if (!data || typeof data !== "object") return [];
  const choices = "choices" in data ? data.choices : undefined;
  if (!Array.isArray(choices)) return [];
  const message = choices[0]?.message;
  if (!message || typeof message !== "object") return [];
  return normalizeToolCallFromChoice("tool_calls" in message ? message.tool_calls : undefined);
}

function mergeToolCallDelta(current: Map<number, ToolCall>, data: unknown) {
  if (!data || typeof data !== "object") return;
  const choices = "choices" in data ? data.choices : undefined;
  if (!Array.isArray(choices)) return;
  const delta = choices[0]?.delta;
  if (!delta || typeof delta !== "object") return;
  const toolCalls = "tool_calls" in delta ? delta.tool_calls : undefined;
  if (!Array.isArray(toolCalls)) return;

  for (const rawCall of toolCalls) {
    if (!isPlainObject(rawCall)) continue;
    const index = typeof rawCall.index === "number" ? rawCall.index : current.size;
    const existing = current.get(index) ?? {
      id: "",
      type: "function" as const,
      function: { name: "", arguments: "" },
    };
    const fn = isPlainObject(rawCall.function) ? rawCall.function : undefined;

    current.set(index, {
      id: typeof rawCall.id === "string" && rawCall.id ? rawCall.id : existing.id,
      type: "function",
      function: {
        name: typeof fn?.name === "string" && fn.name ? fn.name : existing.function.name,
        arguments: `${existing.function.arguments}${typeof fn?.arguments === "string" ? fn.arguments : ""}`,
      },
    });
  }
}

function isSafeExternalUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

function isAppUrl(url: string) {
  if (!VITE_DEV_SERVER_URL) return false;

  try {
    const targetUrl = new URL(url);
    const appUrl = new URL(VITE_DEV_SERVER_URL);
    return targetUrl.origin === appUrl.origin;
  } catch {
    return false;
  }
}

function openExternalUrl(url: string) {
  if (isSafeExternalUrl(url) && !isAppUrl(url)) {
    void shell.openExternal(url);
  }
}

function resolvePreloadPath() {
  const candidates = [
    path.join(__dirname, "preload.cjs"),
    path.join(__dirname, "preload.js"),
    path.join(__dirname, "preload.mjs"),
  ];

  const preloadPath = candidates.find((candidate) => existsSync(candidate));

  if (!preloadPath) {
    throw new Error(
      `Unable to find Electron preload script. Checked: ${candidates.join(", ")}`,
    );
  }

  return preloadPath;
}

function getWindowIconPath() {
  return path.join(
    getPublicAssetsPath(),
    process.platform === "win32" ? "icon.ico" : "icon.png",
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    title: APP_TITLE,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isSafeExternalUrl(url) && !isAppUrl(url)) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error("Failed to load renderer", {
        errorCode,
        errorDescription,
        validatedURL,
      });
    },
  );

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(getRendererDist(), "index.html"));
  }
}

type JsonRecord = Record<string, unknown>;

type StorageSnapshot = {
  providersState?: unknown;
  systemPrompt?: unknown;
  activeChatId?: unknown;
  providerModelsCache?: Record<string, unknown>;
  chats?: unknown[];
};

const STORAGE_SCHEMA_VERSION = 1;
const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

function getStorageRoot() {
  return path.join(app.getPath("userData"), "chat-forge-data");
}

function getStoragePaths() {
  const root = getStorageRoot();
  return {
    root,
    meta: path.join(root, "meta.json"),
    settings: path.join(root, "settings.json"),
    providers: path.join(root, "providers.json"),
    chatsDir: path.join(root, "chats"),
    chatsIndex: path.join(root, "chats", "index.json"),
    backupsDir: path.join(root, "backups"),
    attachmentsDir: path.join(root, "attachments"),
  };
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function safeOptionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function safeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sanitizeFileNamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "item";
}

function getValidDateTime(value?: string) {
  if (!value) return undefined;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

function getLatestDateValue(values: Array<string | undefined>) {
  let latestValue: string | undefined;
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    const time = getValidDateTime(value);
    if (time === undefined || time < latestTime) continue;

    latestValue = value;
    latestTime = time;
  }

  return latestValue;
}

function getMessageActivityDate(message: unknown) {
  if (!isPlainObject(message)) return undefined;

  const createdAt = safeOptionalString(message.createdAt);
  if (message.role === "user") return createdAt;

  if (message.role !== "assistant") return undefined;

  const variantDates = Array.isArray(message.variants)
    ? message.variants.map((variant) =>
        isPlainObject(variant)
          ? safeOptionalString(variant.createdAt)
          : undefined,
      )
    : [];

  return getLatestDateValue([createdAt, ...variantDates]) ?? createdAt;
}

function getChatActivityDate(chat: unknown) {
  if (!isPlainObject(chat)) return undefined;

  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const value = getMessageActivityDate(messages[index]);
    if (getValidDateTime(value) !== undefined) return value;
  }

  const lastMessageAt = safeOptionalString(chat.lastMessageAt);
  if (getValidDateTime(lastMessageAt) !== undefined) return lastMessageAt;

  const createdAt = safeOptionalString(chat.createdAt);
  if (getValidDateTime(createdAt) !== undefined) return createdAt;

  return safeOptionalString(chat.updatedAt);
}

function compareChatsByActivityDate(left: unknown, right: unknown) {
  const rightActivityTime = getValidDateTime(getChatActivityDate(right)) ?? 0;
  const leftActivityTime = getValidDateTime(getChatActivityDate(left)) ?? 0;

  return rightActivityTime - leftActivityTime;
}

function chatFilePath(chatId: string) {
  return path.join(
    getStoragePaths().chatsDir,
    `${sanitizeFileNamePart(chatId)}.json`,
  );
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as T;
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === "ENOENT") return fallback;
    console.error(`Failed to read JSON file ${filePath}:`, error);
    return fallback;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const json = `${JSON.stringify(value, null, 2)}\n`;

  await fs.writeFile(tempPath, json, "utf8");
  await fs.rename(tempPath, filePath);
}

let storageWriteQueue = Promise.resolve();

function queueStorageWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageWriteQueue.then(operation, operation);
  storageWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function ensureStorageDirectories() {
  const paths = getStoragePaths();
  await fs.mkdir(paths.chatsDir, { recursive: true });
  await fs.mkdir(paths.backupsDir, { recursive: true });
  await fs.mkdir(paths.attachmentsDir, { recursive: true });
}

async function isJsonStorageInitialized() {
  return existsSync(getStoragePaths().meta);
}

async function initializeJsonStorageIfNeeded() {
  if (await isJsonStorageInitialized()) return;

  await ensureStorageDirectories();
  await writeJsonAtomic(getStoragePaths().settings, {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    activeChatId: undefined,
    providerModelsCache: {},
    toolsSettings: DEFAULT_TOOLS_SETTINGS,
  });
  await writeJsonAtomic(getStoragePaths().providers, null);
  await writeJsonAtomic(getStoragePaths().chatsIndex, { chats: [] });
  await writeJsonAtomic(getStoragePaths().meta, {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    migratedFromIndexedDb: false,
  });
}

function normalizeChatSummary(chat: unknown) {
  if (!isPlainObject(chat) || typeof chat.id !== "string") return undefined;

  const createdAt = safeString(chat.createdAt, new Date().toISOString());

  return {
    id: chat.id,
    title: safeString(chat.title, "New chat"),
    createdAt,
    updatedAt: safeString(chat.updatedAt, new Date().toISOString()),
    lastMessageAt: getChatActivityDate(chat) ?? createdAt,
    providerId:
      typeof chat.providerId === "string" ? chat.providerId : undefined,
    model: typeof chat.model === "string" ? chat.model : undefined,
  };
}

async function readSettingsFile() {
  return readJsonFile<JsonRecord>(getStoragePaths().settings, {});
}

async function writeSettingsPatch(patch: JsonRecord) {
  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    const settings = await readSettingsFile();
    await writeJsonAtomic(getStoragePaths().settings, {
      ...settings,
      ...patch,
    });
  });
}

async function rebuildChatIndex() {
  const paths = getStoragePaths();
  await fs.mkdir(paths.chatsDir, { recursive: true });
  const entries = await fs.readdir(paths.chatsDir, { withFileTypes: true });
  const chats = [];

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".json") ||
      entry.name === "index.json"
    )
      continue;
    const chat = await readJsonFile<unknown>(
      path.join(paths.chatsDir, entry.name),
      undefined,
    );
    const summary = normalizeChatSummary(chat);
    if (summary) chats.push(summary);
  }

  chats.sort(compareChatsByActivityDate);
  await writeJsonAtomic(paths.chatsIndex, { chats });
  return chats;
}

async function readChatIndex() {
  const value = await readJsonFile<{ chats?: unknown[] }>(
    getStoragePaths().chatsIndex,
    { chats: [] },
  );
  const summaries = (value.chats ?? [])
    .map(normalizeChatSummary)
    .filter(
      (item): item is NonNullable<ReturnType<typeof normalizeChatSummary>> =>
        Boolean(item),
    );
  if (summaries.length || existsSync(getStoragePaths().chatsIndex))
    return summaries;
  return rebuildChatIndex();
}

async function writeChatIndexFromChats(chats: unknown[]) {
  const summaries = chats
    .map(normalizeChatSummary)
    .filter(
      (item): item is NonNullable<ReturnType<typeof normalizeChatSummary>> =>
        Boolean(item),
    );
  summaries.sort(compareChatsByActivityDate);
  await writeJsonAtomic(getStoragePaths().chatsIndex, { chats: summaries });
}

async function loadJsonChats() {
  await initializeJsonStorageIfNeeded();
  const summaries = await readChatIndex();
  const chats: JsonRecord[] = [];

  for (const summary of summaries) {
    const chat = await readJsonFile<unknown>(
      chatFilePath(summary.id),
      undefined,
    );
    if (isPlainObject(chat) && typeof chat.id === "string") chats.push(chat);
  }

  chats.sort(compareChatsByActivityDate);
  return chats;
}

async function saveJsonChat(chat: unknown) {
  if (!isPlainObject(chat) || typeof chat.id !== "string") {
    throw new Error("A valid chat with an id is required.");
  }

  const chatId = chat.id;

  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    await writeJsonAtomic(chatFilePath(chatId), chat);

    const existing = await readChatIndex();
    const next = existing.filter((item) => item.id !== chatId);
    const summary = normalizeChatSummary(chat);

    if (summary) next.unshift(summary);

    await writeChatIndexFromChats(next);
  });
}

async function deleteJsonChat(chatId: unknown) {
  const id = safeString(chatId).trim();
  if (!id) return;

  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    try {
      await fs.unlink(chatFilePath(id));
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code !== "ENOENT") throw error;
    }

    const existing = await readChatIndex();
    await writeChatIndexFromChats(existing.filter((item) => item.id !== id));
  });
}

async function deleteAllJsonChats() {
  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    const paths = getStoragePaths();
    const entries = await fs.readdir(paths.chatsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        entry.name !== "index.json"
      ) {
        await fs.unlink(path.join(paths.chatsDir, entry.name));
      }
    }

    await writeJsonAtomic(paths.chatsIndex, { chats: [] });
  });
}

async function migrateFromIndexedDbSnapshot(snapshot: StorageSnapshot) {
  if (await isJsonStorageInitialized()) return { migrated: false };

  await queueStorageWrite(async () => {
    await ensureStorageDirectories();

    const settings = {
      systemPrompt:
        typeof snapshot.systemPrompt === "string"
          ? snapshot.systemPrompt
          : DEFAULT_SYSTEM_PROMPT,
      activeChatId:
        typeof snapshot.activeChatId === "string"
          ? snapshot.activeChatId
          : undefined,
      providerModelsCache: isPlainObject(snapshot.providerModelsCache)
        ? snapshot.providerModelsCache
        : {},
      toolsSettings: DEFAULT_TOOLS_SETTINGS,
    };

    await writeJsonAtomic(getStoragePaths().settings, settings);
    await writeJsonAtomic(
      getStoragePaths().providers,
      snapshot.providersState ?? null,
    );

    const chats = Array.isArray(snapshot.chats)
      ? snapshot.chats.filter(
          (chat) => isPlainObject(chat) && typeof chat.id === "string",
        )
      : [];
    for (const chat of chats) {
      await writeJsonAtomic(
        chatFilePath(String((chat as JsonRecord).id)),
        chat,
      );
    }
    await writeChatIndexFromChats(chats);

    await writeJsonAtomic(getStoragePaths().meta, {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      migratedFromIndexedDb: true,
    });
  });

  return { migrated: true };
}

ipcMain.handle("storage:is-initialized", async () =>
  isJsonStorageInitialized(),
);

ipcMain.handle(
  "storage:migrate-from-indexeddb",
  async (_event, snapshot: StorageSnapshot) => {
    return migrateFromIndexedDbSnapshot(
      isPlainObject(snapshot) ? snapshot : {},
    );
  },
);

ipcMain.handle("storage:providers-state:load", async () => {
  await initializeJsonStorageIfNeeded();
  return readJsonFile<unknown>(getStoragePaths().providers, undefined);
});

ipcMain.handle(
  "storage:providers-state:save",
  async (_event, value: unknown) => {
    await queueStorageWrite(async () => {
      await initializeJsonStorageIfNeeded();
      await writeJsonAtomic(getStoragePaths().providers, value);
    });
  },
);

ipcMain.handle("storage:system-prompt:load", async () => {
  await initializeJsonStorageIfNeeded();
  const settings = await readSettingsFile();
  return typeof settings.systemPrompt === "string"
    ? settings.systemPrompt
    : DEFAULT_SYSTEM_PROMPT;
});

ipcMain.handle("storage:system-prompt:save", async (_event, value: unknown) => {
  await writeSettingsPatch({
    systemPrompt: safeString(value, DEFAULT_SYSTEM_PROMPT),
  });
});

ipcMain.handle("storage:active-chat-id:load", async () => {
  await initializeJsonStorageIfNeeded();
  const settings = await readSettingsFile();
  return typeof settings.activeChatId === "string"
    ? settings.activeChatId
    : undefined;
});

ipcMain.handle(
  "storage:active-chat-id:save",
  async (_event, chatId: unknown) => {
    await writeSettingsPatch({ activeChatId: safeString(chatId) || undefined });
  },
);

ipcMain.handle("storage:tools-settings:load", async () => {
  await initializeJsonStorageIfNeeded();
  const settings = await readSettingsFile();
  return normalizeToolsSettings(settings.toolsSettings);
});

ipcMain.handle("storage:tools-settings:save", async (_event, value: unknown) => {
  await writeSettingsPatch({ toolsSettings: normalizeToolsSettings(value) });
});

ipcMain.handle("tools:select-directory", async () => {
  const options = {
    title: "Select tools folder",
    properties: ["openDirectory" as const],
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled) return undefined;
  return result.filePaths[0];
});

ipcMain.handle("tools:load", async (_event, directory: unknown) => {
  return loadToolsFromDirectory(safeString(directory));
});

ipcMain.handle("tools:execute", async (_event, request: unknown) => {
  const value = isPlainObject(request) ? request : {};
  return executeLoadedTool(value.name, value.args);
});

ipcMain.handle(
  "storage:provider-models-cache:load",
  async (_event, cacheKey: unknown) => {
    await initializeJsonStorageIfNeeded();
    const key = safeString(cacheKey).trim();
    if (!key) return [];

    const settings = await readSettingsFile();
    const cache = isPlainObject(settings.providerModelsCache)
      ? settings.providerModelsCache
      : {};
    return safeStringArray(cache[key]);
  },
);

ipcMain.handle(
  "storage:provider-models-cache:save",
  async (_event, cacheKey: unknown, models: unknown) => {
    const key = safeString(cacheKey).trim();
    if (!key) return;

    await queueStorageWrite(async () => {
      await initializeJsonStorageIfNeeded();
      const settings = await readSettingsFile();
      const cache = isPlainObject(settings.providerModelsCache)
        ? settings.providerModelsCache
        : {};
      await writeJsonAtomic(getStoragePaths().settings, {
        ...settings,
        providerModelsCache: {
          ...cache,
          [key]: [
            ...new Set(
              safeStringArray(models)
                .map((model) => model.trim())
                .filter(Boolean),
            ),
          ].sort((a, b) => a.localeCompare(b)),
        },
      });
    });
  },
);

ipcMain.handle("storage:chats:load", async () => loadJsonChats());

ipcMain.handle("storage:chat:save", async (_event, chat: unknown) =>
  saveJsonChat(chat),
);

ipcMain.handle("storage:chat:delete", async (_event, chatId: unknown) =>
  deleteJsonChat(chatId),
);

ipcMain.handle("storage:chats:delete-all", async () => deleteAllJsonChats());
ipcMain.handle("ai:load-models", async (_event, request: AiProviderRequest) => {
  const { baseUrl, apiKey, customHeaders, headers } =
    assertProviderRequest(request);
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
    method: "GET",
    headers: buildUpstreamHeaders({
      apiKey,
      customHeaders,
      headers,
      accept: "application/json",
    }),
    cache: "no-store",
  });

  return readUpstreamJson(response);
});

ipcMain.handle("ai:send-chat", async (_event, request: AiProviderRequest) => {
  const { baseUrl, apiKey, customHeaders, headers, payload } =
    assertProviderRequest(request);
  const response = await fetch(
    `${normalizeBaseUrl(baseUrl)}/chat/completions`,
    {
      method: "POST",
      headers: buildUpstreamHeaders({
        apiKey,
        customHeaders,
        headers,
        contentType: "application/json",
        accept: "application/json",
      }),
      body: JSON.stringify(payload),
      cache: "no-store",
    },
  );

  return readUpstreamJson(response);
});

ipcMain.handle("ai:cancel-stream", (_event, streamId: string) => {
  activeStreamControllers.get(streamId)?.abort();
  activeStreamControllers.delete(streamId);
});

ipcMain.handle(
  "ai:stream-chat",
  async (
    event,
    streamId: string,
    request: AiProviderRequest,
  ): Promise<StreamResult> => {
    const { baseUrl, apiKey, customHeaders, headers, payload } =
      assertProviderRequest(request);
    const controller = new AbortController();
    activeStreamControllers.set(streamId, controller);

    let usage: ChatTokenUsage | undefined;
    let finishReason: string | undefined;
    const streamedToolCalls = new Map<number, ToolCall>();

    try {
      const response = await fetch(
        `${normalizeBaseUrl(baseUrl)}/chat/completions`,
        {
          method: "POST",
          headers: buildUpstreamHeaders({
            apiKey,
            customHeaders,
            headers,
            contentType: "application/json",
            accept: "text/event-stream",
          }),
          body: JSON.stringify(payload),
          cache: "no-store",
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Provider returned ${response.status}`);
      }

      if (!response.body) {
        throw new Error("Provider response did not include a readable stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalContent = "";
      let finalReasoning = "";

      function sendRawData(data: unknown) {
        const eventUsage = readUsage(data);
        if (eventUsage) usage = eventUsage;

        const eventFinishReason = readFinishReason(data);
        if (eventFinishReason) finishReason = eventFinishReason;

        mergeToolCallDelta(streamedToolCalls, data);

        const reasoningDelta = readReasoningDelta(data);
        if (reasoningDelta) {
          finalReasoning += reasoningDelta;

          event.sender.send(`ai:stream-delta:${streamId}`, {
            type: "reasoning",
            delta: reasoningDelta,
          });
        }

        const contentDelta = readContentDelta(data);
        if (contentDelta) {
          finalContent += contentDelta;

          event.sender.send(`ai:stream-delta:${streamId}`, {
            type: "content",
            delta: contentDelta,
          });
        }
      }

      function processDataLine(dataLine: string) {
        const trimmed = dataLine.trim();
        if (!trimmed || trimmed === "[DONE]") return;

        try {
          sendRawData(JSON.parse(trimmed));
        } catch {
          // Ignore malformed provider stream lines.
        }
      }

      function processLine(rawLine: string) {
        const line = rawLine.trimEnd();
        const trimmedLine = line.trimStart();

        if (!trimmedLine || trimmedLine.startsWith(":")) return;

        if (trimmedLine.startsWith("data:")) {
          processDataLine(trimmedLine.slice(5).trimStart());
          return;
        }

        if (trimmedLine.startsWith("{")) {
          processDataLine(trimmedLine);
        }
      }

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          processLine(line);
        }

        if (done) break;
      }

      if (buffer.trim()) {
        processLine(buffer);
      }

      return {
        usage,
        finishReason,
        content: finalContent,
        reasoning: finalReasoning,
        toolCalls: [...streamedToolCalls.values()].filter((toolCall) => toolCall.id && toolCall.function.name),
      };
    } finally {
      activeStreamControllers.delete(streamId);
    }
  },
);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(createWindow);
