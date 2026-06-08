import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import Seven from "node-7z";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, promises as fs, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import pdfParse from "pdf-parse";
import {
  ATTACHMENT_LIMITS,
  estimateAttachmentTokens,
} from "../src/lib/ai-chat/attachment-limits";
import { BASH_TOOL_NAME, isFileToolName } from "../src/lib/ai-chat/file-tool-names";
import type { AttachmentKind, ChatAttachment, ChatFolder, ChatWorkspaceRoot } from "../src/lib/ai-chat/types";
import {
  runChatCompletion,
  streamChatCompletion,
  type AdapterStreamEvent,
} from "./ai-sdk-client";
import {
  buildLoadedMcpTools,
  executeMcpTool,
  normalizeMcpSettings,
  refreshMcpTools,
  testMcpServer,
  type McpSettings,
} from "./mcp-client";
import {
  getErrorMessage,
  isPlainObject,
  normalizeWorkspaceRoots,
  safeString,
  stringifyToolResult,
  type JsonRecord,
  type ToolExecutionContext,
} from "./tool-utils";
import { executePiTool } from "./pi-tools";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Load the OS trust store (Windows/macOS/Linux) into Node's default TLS
 * context so undici / global fetch / the MCP SDK transports / the AI SDK all
 * trust the same CAs the system browser does. This is what makes the app work
 * behind a corporate TLS-inspection proxy whose root CA is installed in the OS
 * store — without disabling certificate verification. Must run before any
 * HTTPS connection is made. Requires Node 22.15+/24 (Electron 41 ships Node 24).
 */
function trustSystemCertificates() {
  try {
    if (
      typeof tls.getCACertificates !== "function" ||
      typeof tls.setDefaultCACertificates !== "function"
    ) {
      console.warn("[tls] system CA APIs unavailable; skipping system CA trust");
      return;
    }
    const system = tls.getCACertificates("system");
    if (!system.length) return;
    // Keep the bundled Mozilla CAs and anything from NODE_EXTRA_CA_CERTS too.
    const existing = tls.getCACertificates("default");
    tls.setDefaultCACertificates(Array.from(new Set([...existing, ...system])));
  } catch (error) {
    console.warn("[tls] failed to load system CA certificates:", error);
  }
}

trustSystemCertificates();

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

type ChatReasoningMetadata = {
  reasoningContent?: string;
  reasoningDetails?: unknown[];
};

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type StreamResult = {
  usage?: ChatTokenUsage;
  finishReason?: string;
  content?: string;
  reasoning?: string;
  reasoningMetadata?: ChatReasoningMetadata;
  toolCalls?: ToolCall[];
};

type ToolInputMode = "none" | "json-stdin";

type ToolDefinition = {
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

type ToolExecutionPreview = {
  command: string;
  args: string[];
  cwd?: string;
  inputMode: ToolInputMode;
  stdin?: string;
  displayCommand: string;
  usesStdin: boolean;
  usesPlaceholders: boolean;
};

type ToolCommandResult = {
  toolName?: string;
  content?: string;
  isError?: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  execution?: ToolExecutionPreview;
  changePreview?: unknown;
  generatedFiles?: unknown;
  terminal?: unknown;
};

type ActiveToolExecution = {
  cancel: () => void;
};

const activeToolExecutions = new Map<string, ActiveToolExecution>();

function createAbortError(message = "Tool execution was cancelled.") {
  return new DOMException(message, "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createAbortError();
}

type PublicToolDefinition = ToolDefinition;

type SkillDefinition = {
  name: string;
  enabled: boolean;
  description: string;
  instructions: string;
  recommendedToolNames: string[];
  directoryPath?: string;
  manifestPath?: string;
  manifestContent?: string;
  disableModelInvocation?: boolean;
  source?: string;
  sourceKind?: "global" | "workspace";
  sourcePath?: string;
  shadowed?: boolean;
};

type PublicSkillDefinition = SkillDefinition;

type AgentContextMode = "task_only" | "full_chat";

type AgentDefinition = {
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

type PublicAgentDefinition = AgentDefinition;

type Permission = "allow" | "ask" | "deny";
type FeaturePermission = "custom" | Permission;
type BuiltInToolSettings = {
  descriptionMode?: "default" | "custom";
  customDescription?: string;
  timeoutMs?: number;
};

type ToolsSettings = {
  enabled: boolean;
  askUserEnabled: boolean;
  taskToolsEnabled: boolean;
  loadSkillEnabled: boolean;
  webFetchEnabled: boolean;
  readEnabled: boolean;
  bashEnabled: boolean;
  editEnabled: boolean;
  writeEnabled: boolean;
  readAutoApproveEnabled: boolean;
  bashAutoApproveEnabled: boolean;
  editAutoApproveEnabled: boolean;
  writeAutoApproveEnabled: boolean;
  toolsPermission?: FeaturePermission;
  toolPermissions?: Record<string, Permission>;
  builtInToolSettings?: Record<string, BuiltInToolSettings>;
  permissionModelVersion?: 2;
};

type SkillsSettings = {
  enabled?: boolean;
};

type AgentsSettings = {
  enabled: boolean;
};

type AppSettings = {
  chatTitleGenerationMode: "local" | "ai";
  fontFamily: "sans" | "mono";
  chatFolders: ChatFolder[];
};

type ToolLoadError = {
  source: string;
  message: string;
};

type ToolImportIssue = {
  source: string;
  toolName?: string;
  message: string;
};

type ToolImportResult = {
  cancelled: boolean;
  imported: number;
  updated: number;
  skipped: ToolImportIssue[];
  invalid: ToolImportIssue[];
  renamed: ToolImportIssue[];
};

type ToolExportResult = {
  cancelled: boolean;
  exported: number;
  path?: string;
};

type SkillImportIssue = {
  source: string;
  skillName?: string;
  message: string;
};

type SkillImportResult = {
  cancelled: boolean;
  imported: number;
  updated: number;
  skipped: SkillImportIssue[];
  invalid: SkillImportIssue[];
  renamed: SkillImportIssue[];
};

type SkillExportResult = {
  cancelled: boolean;
  exported: number;
  path?: string;
};

type AgentImportIssue = {
  source: string;
  agentName?: string;
  message: string;
};

type AgentImportResult = {
  cancelled: boolean;
  imported: number;
  updated: number;
  skipped: AgentImportIssue[];
  invalid: AgentImportIssue[];
  renamed: AgentImportIssue[];
};

type AgentExportResult = {
  cancelled: boolean;
  exported: number;
  path?: string;
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
const DEFAULT_TOOLS_SETTINGS: ToolsSettings = {
  enabled: true,
  askUserEnabled: true,
  taskToolsEnabled: true,
  loadSkillEnabled: false,
  webFetchEnabled: false,
  readEnabled: true,
  bashEnabled: true,
  editEnabled: true,
  writeEnabled: true,
  readAutoApproveEnabled: false,
  bashAutoApproveEnabled: false,
  editAutoApproveEnabled: false,
  writeAutoApproveEnabled: false,
  toolsPermission: "custom",
  permissionModelVersion: 2,
  toolPermissions: {
    ask_user: "allow",
    update_tasks: "allow",
    skill: "ask",
    web_fetch: "deny",
    read: "ask",
    bash: "ask",
    edit: "ask",
    write: "ask",
    call_agent: "ask",
  },
  builtInToolSettings: {},
};
const DEFAULT_SKILLS_SETTINGS: SkillsSettings = {
  enabled: true,
};
const DEFAULT_AGENTS_SETTINGS: AgentsSettings = {
  enabled: true,
};
const DEFAULT_APP_SETTINGS: AppSettings = {
  chatTitleGenerationMode: "local",
  fontFamily: "sans",
  chatFolders: [],
};
const DEFAULT_MCP_SETTINGS: McpSettings = {
  enabled: true,
  servers: [],
};
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const WEB_FETCH_TOOL_NAME = "web_fetch";
const BUILTIN_AGENT_NAMES = ["general", "general_full"] as const;
function isBuiltInAgentName(name: string) {
  return (BUILTIN_AGENT_NAMES as readonly string[]).includes(name);
}
const WEB_FETCH_TIMEOUT_MS = 15_000;
const WEB_FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const WEB_FETCH_MAX_RETURN_CHARS = 100_000;
const WEB_FETCH_MAX_REDIRECTS = 5;
const WEB_FETCH_ALLOWED_CONTENT_TYPES = new Set([
  "",
  "text/html",
  "text/plain",
  "application/json",
  "application/xml",
  "text/xml",
]);
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

function buildUpstreamHeaderRecord(options: {
  apiKey?: string;
  customHeaders?: string;
  headers?: Record<string, unknown>;
}): Record<string, string> {
  const headers = buildUpstreamHeaders(options);
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
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

function readBooleanSetting(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePermission(value: unknown, fallback: Permission = "ask"): Permission {
  return value === "allow" || value === "ask" || value === "deny" ? value : fallback;
}

function normalizeFeaturePermission(value: unknown, fallback: FeaturePermission = "custom"): FeaturePermission {
  return value === "custom" || value === "allow" || value === "ask" || value === "deny" ? value : fallback;
}

function normalizePermissionMap(value: unknown): Record<string, Permission> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, Permission> = {};
  for (const [name, permission] of Object.entries(value as Record<string, unknown>)) {
    const trimmedName = name.trim();
    if (!trimmedName) continue;
    result[trimmedName] = normalizePermission(permission);
  }
  return result;
}

function legacyToolPermission(enabled: unknown, autoApproved: unknown, fallbackEnabled = true): Permission {
  const isEnabled = typeof enabled === "boolean" ? enabled : fallbackEnabled;
  if (!isEnabled) return "deny";
  return autoApproved === true ? "allow" : "ask";
}

const MAX_BUILT_IN_TOOL_TIMEOUT_MS = 10 * 60_000;

function normalizeBuiltInToolSettings(value: unknown): ToolsSettings["builtInToolSettings"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: NonNullable<ToolsSettings["builtInToolSettings"]> = {};
  for (const [name, rawSettings] of Object.entries(value as Record<string, unknown>)) {
    if (!name.trim() || !rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings)) continue;
    const source = rawSettings as Record<string, unknown>;
    const customDescription = safeString(source.customDescription);
    const timeoutMs = typeof source.timeoutMs === "number" && Number.isFinite(source.timeoutMs) && source.timeoutMs > 0
      ? Math.min(Math.round(source.timeoutMs), MAX_BUILT_IN_TOOL_TIMEOUT_MS)
      : undefined;
    result[name] = {
      descriptionMode: source.descriptionMode === "custom" ? "custom" : "default",
      customDescription,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    };
  }
  return result;
}

function normalizeToolsSettings(value: unknown): ToolsSettings {
  if (!isPlainObject(value)) return DEFAULT_TOOLS_SETTINGS;

  const legacyChecklistWriteEnabled = value.checklistWriteEnabled;
  const permissionModelVersion = value.permissionModelVersion === 2 ? 2 : undefined;
  const toolsPermission = permissionModelVersion === 2
    ? normalizeFeaturePermission(value.toolsPermission, "custom")
    : "custom";

  const readEnabled = value.readEnabled ?? value.fileReadEnabled;
  const bashEnabled = value.bashEnabled ?? value.terminalExecEnabled;
  const editEnabled = value.editEnabled ?? value.fileReplaceTextEnabled;
  const writeEnabled = value.writeEnabled ?? value.fileCreateEnabled;
  const permissionOverrides = normalizePermissionMap(value.toolPermissions);
  const toolPermissions: Record<string, Permission> = {
    ask_user: legacyToolPermission(value.askUserEnabled, true, true),
    update_tasks: legacyToolPermission(
      typeof value.taskToolsEnabled === "boolean"
        ? value.taskToolsEnabled
        : typeof legacyChecklistWriteEnabled === "boolean"
          ? legacyChecklistWriteEnabled
          : true,
      true,
      true,
    ),
    skill: legacyToolPermission(value.loadSkillEnabled, false, true),
    web_fetch: legacyToolPermission(value.webFetchEnabled, false, false),
    read: legacyToolPermission(readEnabled, value.readAutoApproveEnabled, true),
    bash: legacyToolPermission(bashEnabled, value.bashAutoApproveEnabled, true),
    edit: legacyToolPermission(value.editEnabled ?? value.fileReplaceTextEnabled, value.editAutoApproveEnabled ?? value.fileReplaceTextAutoApproveEnabled, true),
    write: legacyToolPermission(value.writeEnabled ?? value.fileCreateEnabled, value.writeAutoApproveEnabled ?? value.fileCreateAutoApproveEnabled, true),
    call_agent: "ask",
    ...permissionOverrides,
  };

  const toolsEnabled = permissionModelVersion === 2
    ? toolsPermission !== "deny"
    : readBooleanSetting(value.enabled, true);

  return {
    enabled: toolsEnabled,
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
    toolsPermission,
    toolPermissions,
    builtInToolSettings: normalizeBuiltInToolSettings(value.builtInToolSettings),
    permissionModelVersion: 2,
  };
}

function normalizeSkillsSettings(value: unknown): SkillsSettings {
  if (!isPlainObject(value)) return DEFAULT_SKILLS_SETTINGS;

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
  };
}

function normalizeAgentsSettings(value: unknown): AgentsSettings {
  if (!isPlainObject(value)) return DEFAULT_AGENTS_SETTINGS;

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
  };
}

function normalizeChatFolderWorkspaceRoots(
  value: unknown,
): ChatWorkspaceRoot[] | undefined {
  const roots = normalizeWorkspaceRoots(value).map((root) => ({
    ...root,
    createdAt: root.createdAt ?? new Date().toISOString(),
  } satisfies ChatWorkspaceRoot));
  return roots.length ? roots : undefined;
}

function normalizeChatFolders(value: unknown): ChatFolder[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const now = new Date().toISOString();

  return value
    .filter((folder): folder is JsonRecord => isPlainObject(folder))
    .map((folder) => {
      const rawId = safeString(folder.id).trim();
      const id = rawId || `folder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      if (seenIds.has(id)) return undefined;
      seenIds.add(id);

      const createdAt = safeString(folder.createdAt).trim() || now;
      const workspaceRoots = normalizeChatFolderWorkspaceRoots(folder.workspaceRoots);

      return {
        id,
        name: safeString(folder.name).trim() || "New folder",
        createdAt,
        updatedAt: safeString(folder.updatedAt).trim() || createdAt,
        ...(workspaceRoots ? { workspaceRoots } : {}),
      } satisfies ChatFolder;
    })
    .filter((folder): folder is ChatFolder => folder !== undefined);
}

function normalizeAppSettings(value: unknown): AppSettings {
  if (!isPlainObject(value)) return DEFAULT_APP_SETTINGS;

  return {
    chatTitleGenerationMode:
      value.chatTitleGenerationMode === "ai" ? "ai" : "local",
    fontFamily: value.fontFamily === "mono" ? "mono" : "sans",
    chatFolders: normalizeChatFolders(value.chatFolders),
  };
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && value.type === "object";
}

function normalizeToolInputMode(value: unknown): ToolInputMode {
  return value === "none" ? "none" : "json-stdin";
}

function normalizeTimeoutMs(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.round(value), 10 * 60_000)
    : DEFAULT_TOOL_TIMEOUT_MS;
}

function normalizeOptionalTimeoutMs(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.round(value), 10 * 60_000)
    : fallback;
}

function normalizeOptionalPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function normalizeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

function normalizeToolDefinition(candidate: unknown): ToolDefinition {
  const source = isPlainObject(candidate) ? candidate : {};
  const id =
    safeString(source.id).trim() ||
    `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const name = safeString(source.name).trim();
  const description = safeString(source.description).trim();
  const parameters = source.parameters;
  const command = safeString(source.command).trim();
  const args = safeStringArray(source.args);
  const cwd = safeString(source.cwd).trim();

  return {
    id,
    name,
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    description,
    parameters: isPlainObject(parameters)
      ? parameters
      : { type: "object", properties: {}, required: [] },
    command,
    args,
    cwd: cwd || undefined,
    input: normalizeToolInputMode(source.input),
    timeoutMs: normalizeTimeoutMs(source.timeoutMs),
    maxConcurrentRuns: normalizeOptionalPositiveInteger(
      source.maxConcurrentRuns,
    ),
    delayBetweenRunsMs: normalizeNonNegativeInteger(source.delayBetweenRunsMs),
    requiresApproval: source.requiresApproval === true,
  };
}

function getSchemaProperties(parameters: Record<string, unknown>) {
  const properties = isPlainObject(parameters.properties)
    ? parameters.properties
    : {};
  return new Set(Object.keys(properties));
}

function getRequiredSchemaFields(parameters: Record<string, unknown>) {
  return new Set(safeStringArray(parameters.required));
}

function extractTemplatePlaceholders(args: string[]) {
  const placeholders = new Set<string>();
  const templatePattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

  for (const arg of args) {
    for (const match of arg.matchAll(templatePattern)) {
      placeholders.add(match[1]);
    }
  }

  return [...placeholders];
}

function validateToolDefinition(tool: ToolDefinition) {
  if (!tool.name) throw new Error("Tool name is required.");
  if (!TOOL_NAME_PATTERN.test(tool.name)) {
    throw new Error(
      "Tool name must use only letters, numbers, underscores, or hyphens.",
    );
  }
  if (!tool.description) throw new Error("Tool description is required.");
  if (!isJsonSchemaObject(tool.parameters)) {
    throw new Error(
      'Tool parameters must be a JSON schema object with type: "object".',
    );
  }
  if (!tool.command.trim()) throw new Error("Command is required.");

  const propertyNames = getSchemaProperties(tool.parameters);
  const requiredFields = getRequiredSchemaFields(tool.parameters);

  for (const placeholder of extractTemplatePlaceholders(tool.args)) {
    if (!propertyNames.has(placeholder)) {
      throw new Error(
        `Unknown argument placeholder: ${placeholder}. Add it to schema properties or update args.`,
      );
    }
    if (!requiredFields.has(placeholder)) {
      throw new Error(
        `Placeholder ${placeholder} is used in args, so it must be listed in schema.required for now.`,
      );
    }
  }
}

function toPublicTool(tool: ToolDefinition): PublicToolDefinition {
  return tool;
}

function normalizeSkillDefinition(candidate: unknown): SkillDefinition {
  const source = isPlainObject(candidate) ? candidate : {};
  const legacyId = safeString(source.id).trim();
  const name = safeString(source.name).trim() || legacyId;
  const description = safeString(source.description).trim();
  const instructions = safeString(source.instructions).trim();

  return {
    name,
    enabled: true,
    description,
    instructions,
    recommendedToolNames: safeStringArray(source.recommendedToolNames)
      .map((item) => item.trim())
      .filter(Boolean),
    directoryPath: safeString(source.directoryPath).trim() || undefined,
    manifestPath: safeString(source.manifestPath).trim() || undefined,
    manifestContent: safeString(source.manifestContent),
    disableModelInvocation: source.disableModelInvocation === true,
    source: safeString(source.source).trim() || undefined,
    sourceKind: (() => {
      const value = safeString(source.sourceKind).trim();
      return value === "global" || value === "workspace" ? value : undefined;
    })(),
    sourcePath: safeString(source.sourcePath).trim() || undefined,
    shadowed: source.shadowed === true,
  };
}

function validateSkillDefinition(skill: SkillDefinition) {
  if (!skill.name) throw new Error("Skill name is required.");
  if (!TOOL_NAME_PATTERN.test(skill.name)) {
    throw new Error(
      "Skill name must use only letters, numbers, underscores, or hyphens.",
    );
  }
  if (skill.name === "skill") {
    throw new Error(
      "skill is a built-in tool name and cannot be used by a skill.",
    );
  }
}

function toPublicSkill(skill: SkillDefinition): PublicSkillDefinition {
  return skill;
}

function normalizeAgentContextMode(value: unknown): AgentContextMode {
  return value === "full_chat" ? "full_chat" : "task_only";
}

function normalizeAgentDefinition(candidate: unknown): AgentDefinition {
  const source = isPlainObject(candidate) ? candidate : {};
  const id =
    safeString(source.id).trim() ||
    `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const providerId = safeString(source.providerId).trim();
  const model = safeString(source.model).trim();
  const rawMaxNestingDepth = Number(source.maxNestingDepth);

  return {
    id,
    name: safeString(source.name).trim(),
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    description: safeString(source.description).trim(),
    instructions: safeString(source.instructions).trim(),
    contextMode: normalizeAgentContextMode(source.contextMode),
    providerId: providerId || undefined,
    model: model || undefined,
    maxNestingDepth: Number.isFinite(rawMaxNestingDepth)
      ? Math.min(Math.max(Math.round(rawMaxNestingDepth), 1), 8)
      : 2,
    loadedSkillNames: safeStringArray(source.loadedSkillNames)
      .map((item) => item.trim())
      .filter(Boolean),
    allowedToolNames: safeStringArray(source.allowedToolNames)
      .map((item) => item.trim())
      .filter(Boolean),
    allowedAgentNames: safeStringArray(source.allowedAgentNames)
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function validateAgentDefinition(agent: AgentDefinition) {
  if (!agent.name) throw new Error("Agent name is required.");
  if (!TOOL_NAME_PATTERN.test(agent.name)) {
    throw new Error(
      "Agent name must use only letters, numbers, underscores, or hyphens.",
    );
  }
  if (agent.name === "call_agent") {
    throw new Error(
      "call_agent is a built-in tool name and cannot be used by an agent.",
    );
  }
  if (isBuiltInAgentName(agent.name)) {
    throw new Error(
      `${agent.name} is a built-in agent name and cannot be used by a custom agent. Reserved names: ${BUILTIN_AGENT_NAMES.join(", ")}.`,
    );
  }
  if (!agent.description) throw new Error("Agent description is required.");
  if (!agent.instructions) throw new Error("Agent instructions are required.");
}

function toPublicAgent(agent: AgentDefinition): PublicAgentDefinition {
  return agent;
}

function buildModelToolResultContent(
  result: ToolCommandResult,
  timeoutMs: number,
) {
  if (result.timedOut) {
    return stringifyToolResult({
      error: true,
      type: "timeout",
      message: `Tool command timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
      timeoutMs,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }

  if (result.exitCode !== 0) {
    return stringifyToolResult({
      error: true,
      type: "command_failed",
      message: `Tool command failed with exit code ${result.exitCode ?? "null"}.`,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    return stringifyToolResult({ ok: true, output: "" });
  }

  try {
    return stringifyToolResult(JSON.parse(stdout));
  } catch {
    return stdout;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout();
      reject(
        new Error(
          `Tool timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function getToolArgValue(args: unknown, key: string) {
  if (!isPlainObject(args) || !(key in args)) {
    throw new Error(`Missing required tool argument: ${key}`);
  }
  return args[key];
}

function stringifyCommandArgValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
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
  tool: ToolDefinition,
  modelArgs: unknown,
  commandArgs: string[],
): ToolExecutionPreview {
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

type CommandExecutionResult = ToolCommandResult;

async function runCommandTool(
  tool: ToolDefinition,
  modelArgs: unknown,
  signal?: AbortSignal,
): Promise<CommandExecutionResult> {
  validateToolDefinition(tool);
  throwIfAborted(signal);
  const commandArgs = materializeCommandArgs(tool.args, modelArgs);
  const execution = buildToolExecutionPreview(tool, modelArgs, commandArgs);

  return new Promise<CommandExecutionResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(tool.command, commandArgs, {
      cwd: tool.cwd || undefined,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    const killProcessTree = () => {
      if (child.pid && process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        }).on("error", () => undefined);
        return;
      }

      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGTERM");
          return;
        } catch {
          // Fall back to killing only the child process.
        }
      }

      child.kill();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortHandler);
    };

    const finish = (result: CommandExecutionResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ...result, execution });
    };

    const abortHandler = () => {
      killProcessTree();
      finish({
        exitCode: null,
        stdout,
        stderr: stderr || "Cancelled by user.",
        timedOut: false,
      });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessTree();
      finish({
        exitCode: null,
        stdout,
        stderr:
          stderr ||
          `Timed out after ${Math.round(tool.timeoutMs / 1000)} seconds.`,
        timedOut: true,
      });
    }, tool.timeoutMs);

    if (signal?.aborted) {
      abortHandler();
      return;
    }
    signal?.addEventListener("abort", abortHandler, { once: true });

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      finish({
        exitCode: null,
        stdout,
        stderr: stderr || error.message,
        timedOut,
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      finish({ exitCode, stdout, stderr, timedOut });
    });

    if (tool.input === "json-stdin") {
      child.stdin?.write(JSON.stringify(modelArgs ?? {}));
    }
    child.stdin?.end();
  });
}

function parseWebFetchArgs(args: unknown) {
  if (!isPlainObject(args)) {
    throw new Error("web_fetch arguments must be a JSON object.");
  }

  const url = safeString(args.url).trim();
  if (!url) throw new Error("web_fetch requires url.");

  return { url };
}

function parseWebFetchUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("web_fetch requires a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("web_fetch supports only HTTP and HTTPS URLs.");
  }

  return parsed;
}

function getNormalizedHostname(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isBlockedIpv4Address(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b, c, d] = parts;
  if (parts.some((part) => part < 0 || part > 255)) return true;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 ||
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

function isBlockedIpv6Address(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;

  const mappedIpv4Match = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4Match) return isBlockedIpv4Address(mappedIpv4Match[1]);

  const firstSegment = Number.parseInt(normalized.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstSegment)) return true;

  // fc00::/7 unique local, fe80::/10 link-local, 2001:db8::/32 docs.
  return (
    (firstSegment & 0xfe00) === 0xfc00 ||
    (firstSegment & 0xffc0) === 0xfe80 ||
    normalized.startsWith("2001:db8:")
  );
}

function isBlockedIpAddress(address: string) {
  const ipVersion = isIP(address);
  if (ipVersion === 4) return isBlockedIpv4Address(address);
  if (ipVersion === 6) return isBlockedIpv6Address(address);
  return true;
}

async function assertFetchablePublicUrl(url: URL) {
  const hostname = getNormalizedHostname(url);
  if (!hostname) throw new Error("web_fetch URL is missing a hostname.");

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("web_fetch blocks localhost URLs.");
  }

  if (isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw new Error(
        "web_fetch blocks local, private, and reserved IP addresses.",
      );
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(
      `web_fetch could not resolve host ${hostname}: ${getErrorMessage(error)}`,
    );
  }

  if (!addresses.length)
    throw new Error(`web_fetch could not resolve host ${hostname}.`);

  for (const address of addresses) {
    if (isBlockedIpAddress(address.address)) {
      throw new Error(
        "web_fetch blocks hosts that resolve to local, private, or reserved IP addresses.",
      );
    }
  }
}

function normalizeContentType(contentTypeHeader: string | null) {
  return (contentTypeHeader ?? "").split(";")[0].trim().toLowerCase();
}

function isAllowedWebFetchContentType(contentType: string) {
  return WEB_FETCH_ALLOWED_CONTENT_TYPES.has(contentType);
}

async function readResponseTextWithLimit(
  response: Response,
  signal?: AbortSignal,
) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > WEB_FETCH_MAX_RESPONSE_BYTES
  ) {
    throw new Error(
      `web_fetch response is too large (${contentLength} bytes). Maximum is ${WEB_FETCH_MAX_RESPONSE_BYTES} bytes.`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throwIfAborted(signal);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > WEB_FETCH_MAX_RESPONSE_BYTES) {
      throw new Error(
        `web_fetch response is too large. Maximum is ${WEB_FETCH_MAX_RESPONSE_BYTES} bytes.`,
      );
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const abortHandler = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > WEB_FETCH_MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancellation errors.
        }
        throw new Error(
          `web_fetch response is too large. Maximum is ${WEB_FETCH_MAX_RESPONSE_BYTES} bytes.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", abortHandler);
  }

  throwIfAborted(signal);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function fetchWebUrl(startUrl: URL, signal?: AbortSignal, timeoutMs = WEB_FETCH_TIMEOUT_MS) {
  let currentUrl = new URL(startUrl.toString());
  currentUrl.hash = "";

  for (
    let redirectCount = 0;
    redirectCount <= WEB_FETCH_MAX_REDIRECTS;
    redirectCount += 1
  ) {
    throwIfAborted(signal);
    await assertFetchablePublicUrl(currentUrl);
    throwIfAborted(signal);

    const controller = new AbortController();
    let timedOut = false;
    const abortHandler = () => controller.abort();
    signal?.addEventListener("abort", abortHandler, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept:
            "text/html,application/xhtml+xml,text/plain,application/json,application/xml,text/xml;q=0.9,*/*;q=0.8",
          "User-Agent": `${APP_TITLE} web_fetch`,
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (!timedOut && signal?.aborted) throw createAbortError();
        throw new Error(
          `web_fetch timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortHandler);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location)
        throw new Error(
          `web_fetch redirect from ${currentUrl} had no Location header.`,
        );
      currentUrl = new URL(location, currentUrl);
      currentUrl.hash = "";
      continue;
    }

    if (!response.ok) {
      throw new Error(
        `web_fetch received HTTP ${response.status} from ${currentUrl}.`,
      );
    }

    const contentType = normalizeContentType(
      response.headers.get("content-type"),
    );
    if (!isAllowedWebFetchContentType(contentType)) {
      throw new Error(
        `web_fetch cannot read content type ${contentType || "unknown"}.`,
      );
    }

    const text = await readResponseTextWithLimit(response, signal);
    return {
      finalUrl: currentUrl.toString(),
      contentType,
      text,
    };
  }

  throw new Error(
    `web_fetch followed too many redirects. Maximum is ${WEB_FETCH_MAX_REDIRECTS}.`,
  );
}

function decodeHtmlCodePoint(value: string, radix: number) {
  const code = Number.parseInt(value, radix);
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";

  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return value
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) =>
      decodeHtmlCodePoint(hex, 16),
    )
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      decodeHtmlCodePoint(decimal, 10),
    )
    .replace(
      /&([a-z]+);/gi,
      (match, name: string) => namedEntities[name.toLowerCase()] ?? match,
    );
}

function normalizeExtractedText(value: string) {
  return decodeHtmlEntities(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtmlToText(html: string) {
  return normalizeExtractedText(
    html
      .replace(/<!doctype[\s\S]*?>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "\n")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "\n")
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, "\n")
      .replace(/<head\b[\s\S]*?<\/head>/gi, "\n")
      .replace(/<(nav|footer|header|form|button|aside)\b[\s\S]*?<\/\1>/gi, "\n")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|section|article|main|li|tr|table|h[1-6])>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<h([1-6])\b[^>]*>/gi, "\n\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function extractTitleFromHtml(html: string) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch ? normalizeExtractedText(titleMatch[1]) : "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findPreviousHeadingStart(html: string, index: number) {
  const headingPattern = /<h([1-6])\b[^>]*>/gi;
  let previous: { index: number; level: number } | undefined;
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(html)) && match.index < index) {
    previous = { index: match.index, level: Number(match[1]) };
  }

  return previous;
}

function findNextSectionEnd(
  html: string,
  startIndex: number,
  headingLevel: number,
) {
  const headingPattern = /<h([1-6])\b[^>]*>/gi;
  headingPattern.lastIndex = startIndex + 1;

  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(html))) {
    const level = Number(match[1]);
    if (level <= headingLevel) return match.index;
  }

  return html.length;
}

function extractHtmlFragmentSection(html: string, fragment: string) {
  const escapedFragment = escapeRegExp(fragment);
  const elementPattern = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9:-]*)\\b(?=[^>]*(?:id|name)\\s*=\\s*["']?${escapedFragment}["'\\s>])[^>]*>`,
    "i",
  );
  const match = elementPattern.exec(html);
  if (!match) return undefined;

  const matchedTagName = match[1].toLowerCase();
  const headingMatch = /^h([1-6])$/.exec(matchedTagName);
  const previousHeading = headingMatch
    ? { index: match.index, level: Number(headingMatch[1]) }
    : findPreviousHeadingStart(html, match.index);

  const sectionStart = previousHeading?.index ?? match.index;
  const headingLevel = previousHeading?.level ?? 6;
  const sectionEnd = findNextSectionEnd(html, sectionStart, headingLevel);

  return html.slice(sectionStart, sectionEnd);
}

function extractReadableContent({
  rawText,
  contentType,
  fragment,
}: {
  rawText: string;
  contentType: string;
  fragment: string;
}) {
  if (contentType.includes("json")) {
    try {
      return {
        text: JSON.stringify(JSON.parse(rawText), null, 2),
        fragmentFound: false,
      };
    } catch {
      return { text: normalizeExtractedText(rawText), fragmentFound: false };
    }
  }

  if (contentType.includes("xml")) {
    return { text: stripHtmlToText(rawText), fragmentFound: false };
  }

  if (contentType && !contentType.includes("html")) {
    return { text: normalizeExtractedText(rawText), fragmentFound: false };
  }

  if (fragment) {
    const sectionHtml = extractHtmlFragmentSection(rawText, fragment);
    if (sectionHtml) {
      return { text: stripHtmlToText(sectionHtml), fragmentFound: true };
    }
  }

  return { text: stripHtmlToText(rawText), fragmentFound: false };
}

function truncateWebFetchContent(value: string) {
  if (value.length <= WEB_FETCH_MAX_RETURN_CHARS) {
    return { content: value, truncated: false };
  }

  return {
    content: value.slice(0, WEB_FETCH_MAX_RETURN_CHARS).trimEnd(),
    truncated: true,
  };
}

function decodeUrlComponentSafely(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function executeWebFetchTool(
  args: unknown,
  signal?: AbortSignal,
  timeoutMs = WEB_FETCH_TIMEOUT_MS,
): Promise<ToolCommandResult> {
  throwIfAborted(signal);
  const { url: rawUrl } = parseWebFetchArgs(args);
  const requestedUrl = parseWebFetchUrl(rawUrl);
  const requestedFragment = requestedUrl.hash
    ? decodeUrlComponentSafely(requestedUrl.hash.slice(1))
    : "";

  const fetched = await fetchWebUrl(requestedUrl, signal, timeoutMs);
  throwIfAborted(signal);
  const title = fetched.contentType.includes("html")
    ? extractTitleFromHtml(fetched.text)
    : "";
  const extracted = extractReadableContent({
    rawText: fetched.text,
    contentType: fetched.contentType,
    fragment: requestedFragment,
  });
  const truncated = truncateWebFetchContent(extracted.text);

  const metadataLines = [
    `Fetched: ${rawUrl}`,
    fetched.finalUrl !== requestedUrl.toString().replace(/#.*$/, "")
      ? `Final URL: ${fetched.finalUrl}`
      : "",
    title ? `Title: ${title}` : "",
    requestedFragment
      ? extracted.fragmentFound
        ? `Section: #${requestedFragment}`
        : `Fragment "#${requestedFragment}" was not found. Returning readable page content instead.`
      : "",
    fetched.contentType ? `Content-Type: ${fetched.contentType}` : "",
  ].filter(Boolean);

  const content = [
    metadataLines.join("\n"),
    "",
    truncated.content || "No readable text was extracted from this URL.",
    truncated.truncated
      ? `\n[Content truncated to ${WEB_FETCH_MAX_RETURN_CHARS} characters.]`
      : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n");

  return {
    toolName: WEB_FETCH_TOOL_NAME,
    content,
    exitCode: 0,
    stdout: content,
    stderr: "",
    timedOut: false,
  };
}

async function selectWorkspaceFolder() {
  const options = {
    title: "Select workspace folder",
    properties: ["openDirectory" as const, "createDirectory" as const],
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true as const };
  }

  const folderPath = result.filePaths[0];
  return {
    cancelled: false as const,
    path: folderPath,
    name: path.basename(folderPath) || folderPath,
  };
}

async function openWorkspaceFolder(folderPath: unknown) {
  const target = safeString(folderPath).trim();
  if (!target) throw new Error("Folder path is required.");
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
}

async function executeToolManifest(
  name: unknown,
  args: unknown,
  context: ToolExecutionContext = {},
) {
  const toolName = typeof name === "string" ? name.trim() : "";
  if (!toolName) throw new Error("Tool name is required.");

  throwIfAborted(context.signal);

  if (toolName === WEB_FETCH_TOOL_NAME) {
    return executeWebFetchTool(args, context.signal, normalizeOptionalTimeoutMs(context.timeoutMs, WEB_FETCH_TIMEOUT_MS));
  }

  if (isFileToolName(toolName)) {
    return executePiTool(toolName, args, context);
  }

  const tools = await loadJsonTools();
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`Tool is not configured: ${toolName}`);

  const result = await runCommandTool(tool, args, context.signal);
  const content = buildModelToolResultContent(result, tool.timeoutMs);

  return {
    toolName,
    content,
    isError: result.timedOut || result.exitCode !== 0,
    ...result,
  };
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

  win.webContents.on("found-in-page", (_event, result) => {
    win?.webContents.send("find-in-page:result", result);
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

type StorageSnapshot = {
  providersState?: unknown;
  systemPrompt?: unknown;
  activeChatId?: unknown;
  providerModelsCache?: Record<string, unknown>;
  appSettings?: unknown;
  mcpSettings?: unknown;
  modesState?: unknown;
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
    toolsDir: path.join(root, "tools"),
    skillsDir: path.join(root, "skills"),
    agentsDir: path.join(root, "agents"),
    backupsDir: path.join(root, "backups"),
    attachmentsDir: path.join(root, "attachments"),
    chatWorkspacesDir: path.join(root, "chat-workspaces"),
  };
}

const CHAT_WORKSPACE_ROOT_ID = "chat";

function getChatWorkspacePath(chatId: string) {
  return path.join(getStoragePaths().chatWorkspacesDir, sanitizeFileNamePart(chatId));
}

async function ensureChatWorkspaceRoot(chatIdValue: unknown): Promise<ChatWorkspaceRoot> {
  const chatId = safeString(chatIdValue).trim();
  if (!chatId) throw new Error("Chat id is required.");
  const workspacePath = getChatWorkspacePath(chatId);
  await fs.mkdir(workspacePath, { recursive: true });
  return {
    id: CHAT_WORKSPACE_ROOT_ID,
    name: "Chat workspace",
    path: workspacePath,
    createdAt: new Date().toISOString(),
    automatic: true,
    kind: "chat",
  };
}

async function deleteChatWorkspace(chatIdValue: unknown) {
  const chatId = safeString(chatIdValue).trim();
  if (!chatId) return;
  await fs.rm(getChatWorkspacePath(chatId), { recursive: true, force: true });
}

function normalizeManagedFilePath(storagePath: string) {
  const roots = [
    path.resolve(getStoragePaths().attachmentsDir),
    path.resolve(getStoragePaths().chatWorkspacesDir),
  ];
  const resolvedStoragePath = path.resolve(storagePath);

  for (const root of roots) {
    const relative = path.relative(root, resolvedStoragePath);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return resolvedStoragePath;
    }
  }

  return undefined;
}

async function safeUniquePath(directory: string, fileName: string) {
  const parsed = path.parse(sanitizeFileNamePart(fileName));
  const base = parsed.name || "file";
  const ext = parsed.ext;

  for (let index = 0; index < 1000; index += 1) {
    const candidateName = index === 0 ? `${base}${ext}` : `${base}-${index + 1}${ext}`;
    const candidatePath = path.join(directory, candidateName);
    try {
      await fs.lstat(candidatePath);
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code === "ENOENT") return candidatePath;
      throw error;
    }
  }

  return path.join(directory, `${base}-${randomUUID()}${ext}`);
}

function stripInlineAttachmentContentForWorkspace(attachment: ChatAttachment): ChatAttachment {
  return {
    ...attachment,
    extractedText: undefined,
    truncated: undefined,
    tokenEstimate: attachment.kind === "image" ? attachment.tokenEstimate : 0,
    children: attachment.children?.map(stripInlineAttachmentContentForWorkspace),
  };
}

async function copyAttachmentIntoChatWorkspace({
  chatId,
  messageId,
  attachment,
}: {
  chatId: string;
  messageId: string;
  attachment: ChatAttachment;
}): Promise<ChatAttachment> {
  const workspaceRoot = await ensureChatWorkspaceRoot(chatId);
  const sourcePath = attachment.storagePath
    ? normalizeManagedFilePath(attachment.storagePath)
    : undefined;
  const baseAttachment = stripInlineAttachmentContentForWorkspace(attachment);
  const nextChildren = attachment.children?.length
    ? await Promise.all(
        attachment.children.map((child) =>
          copyAttachmentIntoChatWorkspace({ chatId, messageId, attachment: child }),
        ),
      )
    : baseAttachment.children;

  if (!sourcePath) {
    return {
      ...baseAttachment,
      ...(nextChildren ? { children: nextChildren } : {}),
    };
  }

  const sourceRelativeToWorkspace = path.relative(workspaceRoot.path, sourcePath);
  const sourceAlreadyInChatWorkspace =
    sourceRelativeToWorkspace &&
    !sourceRelativeToWorkspace.startsWith("..") &&
    !path.isAbsolute(sourceRelativeToWorkspace);

  if (sourceAlreadyInChatWorkspace) {
    return {
      ...baseAttachment,
      storagePath: sourcePath,
      workspaceRootId: workspaceRoot.id,
      workspacePath: sourceRelativeToWorkspace.split(path.sep).join("/"),
      ...(nextChildren ? { children: nextChildren } : {}),
    };
  }

  const originalDirectory = path.join(workspaceRoot.path, "incoming", sanitizeFileNamePart(messageId), "original");
  await fs.mkdir(originalDirectory, { recursive: true });
  const destinationPath = await safeUniquePath(originalDirectory, attachment.name);

  await fs.copyFile(sourcePath, destinationPath);
  const oldAttachmentPath = normalizeAttachmentStoragePath(sourcePath);
  if (oldAttachmentPath) {
    await deleteTemporaryAttachmentStoragePaths([oldAttachmentPath]);
  }

  return {
    ...baseAttachment,
    storagePath: destinationPath,
    workspaceRootId: workspaceRoot.id,
    workspacePath: path.relative(workspaceRoot.path, destinationPath).split(path.sep).join("/"),
    ...(nextChildren ? { children: nextChildren } : {}),
  };
}

function normalizeMaterializeAttachmentsRequest(request: unknown) {
  const value = isPlainObject(request) ? request : {};
  const chatId = safeString(value.chatId).trim();
  const messageId = safeString(value.messageId).trim();
  const attachments = Array.isArray(value.attachments)
    ? (value.attachments.filter((item) => isPlainObject(item)) as unknown[] as ChatAttachment[])
    : [];
  if (!chatId) throw new Error("chatId is required.");
  if (!messageId) throw new Error("messageId is required.");
  return { chatId, messageId, attachments };
}

async function exportManagedFile(request: unknown) {
  const value = isPlainObject(request) ? request : {};
  const storagePath = safeString(value.storagePath).trim();
  const name = sanitizeFileNamePart(safeString(value.name).trim() || path.basename(storagePath));
  const sourcePath = storagePath ? normalizeManagedFilePath(storagePath) : undefined;
  if (!sourcePath) throw new Error("File is outside managed app storage.");

  const browserWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options = {
    title: "Download file",
    defaultPath: name,
  };
  const result = browserWindow
    ? await dialog.showSaveDialog(browserWindow, options)
    : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) return { cancelled: true as const };
  await fs.copyFile(sourcePath, result.filePath);
  return { cancelled: false as const, path: result.filePath };
}

function parseNullSeparatedClipboardPaths(value: string) {
  return value
    .split("\0")
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectClipboardFilePathCandidates() {
  const candidates: string[] = [];

  for (const format of clipboard.availableFormats()) {
    if (format === "FileNameW") {
      const value = clipboard.readBuffer(format).toString("utf16le");
      candidates.push(...parseNullSeparatedClipboardPaths(value));
    } else if (format === "FileName") {
      const value = clipboard.readBuffer(format).toString("utf8");
      candidates.push(...parseNullSeparatedClipboardPaths(value));
    }
  }

  const text = clipboard.readText().trim();
  if (text) {
    candidates.push(
      ...text
        .split(/\r?\n/)
        .map((item) => item.trim().replace(/^file:\/\//i, ""))
        .filter(Boolean),
    );
  }

  return candidates;
}

function filterExistingFilePathsSync(paths: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const candidate of paths) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved.toLowerCase())) continue;

    try {
      const stats = statSync(resolved);
      if (!stats.isFile()) continue;
      seen.add(resolved.toLowerCase());
      result.push(resolved);
    } catch {
      // Ignore stale clipboard paths.
    }
  }

  return result;
}

async function filterExistingFilePaths(paths: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const candidate of paths) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved.toLowerCase())) continue;

    try {
      const stats = await fs.stat(resolved);
      if (!stats.isFile()) continue;
      seen.add(resolved.toLowerCase());
      result.push(resolved);
    } catch {
      // Ignore stale clipboard paths.
    }
  }

  return result;
}

function readClipboardFilePathsSync() {
  return filterExistingFilePathsSync(collectClipboardFilePathCandidates());
}

async function readClipboardFilePaths() {
  return filterExistingFilePaths(collectClipboardFilePathCandidates());
}

async function cleanupChatMessageWorkspace(request: unknown) {
  const value = isPlainObject(request) ? request : {};
  const chatId = safeString(value.chatId).trim();
  const messageId = safeString(value.messageId).trim();
  const generatedFileStoragePaths = Array.isArray(value.generatedFileStoragePaths)
    ? value.generatedFileStoragePaths.filter((item): item is string => typeof item === "string")
    : [];

  if (!chatId || !messageId) return { deleted: 0 };

  const chatWorkspacePath = getChatWorkspacePath(chatId);
  const workspaceRoot = path.resolve(chatWorkspacePath);
  let deleted = 0;

  const incomingMessagePath = path.resolve(
    chatWorkspacePath,
    "incoming",
    sanitizeFileNamePart(messageId),
  );
  const incomingRelative = path.relative(workspaceRoot, incomingMessagePath);
  if (!incomingRelative.startsWith("..") && !path.isAbsolute(incomingRelative)) {
    await fs.rm(incomingMessagePath, { recursive: true, force: true });
    deleted += 1;
  }

  const generatedRoot = path.resolve(chatWorkspacePath, "generated");
  const artifactDirectories = new Set<string>();
  for (const storagePath of generatedFileStoragePaths) {
    const managedPath = normalizeManagedFilePath(storagePath);
    if (!managedPath) continue;
    const relativeToGeneratedRoot = path.relative(generatedRoot, managedPath);
    if (
      relativeToGeneratedRoot.startsWith("..") ||
      path.isAbsolute(relativeToGeneratedRoot) ||
      !relativeToGeneratedRoot
    ) {
      continue;
    }

    const [artifactDirectoryName] = relativeToGeneratedRoot.split(path.sep);
    if (!artifactDirectoryName) continue;
    artifactDirectories.add(path.join(generatedRoot, artifactDirectoryName));
  }

  for (const artifactDirectory of artifactDirectories) {
    await fs.rm(artifactDirectory, { recursive: true, force: true });
    deleted += 1;
  }

  return { deleted };
}

type AttachmentInput =
  | { name: string; path: string; mimeType?: string }
  | {
      name: string;
      bytes: Uint8Array | number[] | ArrayBuffer;
      mimeType?: string;
    };

type AttachmentProcessRequest =
  | AttachmentInput[]
  | { inputs: AttachmentInput[] };

type AttachmentProcessState = {
  warnings: string[];
  totalExtractedChars: number;
  totalEntries: number;
  totalExtractedBytes: number;
};

function getPathTo7za() {
  const sevenBin = require("7zip-bin") as { path7za: string };
  return sevenBin.path7za.replace("app.asar", "app.asar.unpacked");
}

function normalizeAttachmentInputs(request: unknown): AttachmentInput[] {
  const value =
    isPlainObject(request) && Array.isArray(request.inputs)
      ? request.inputs
      : request;
  if (!Array.isArray(value)) return [];
  return value.filter((input): input is AttachmentInput => {
    if (!isPlainObject(input)) return false;
    if (typeof input.name !== "string") return false;
    if (typeof input.path === "string") return true;
    return input.bytes !== undefined;
  });
}

function bufferFromUnknownBytes(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Buffer.from(value);
  if (isPlainObject(value) && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  return Buffer.alloc(0);
}

function hasArchiveExtension(fileName: string) {
  const lowerName = fileName.toLowerCase();
  return ATTACHMENT_LIMITS.archiveExtensions.some((extension) =>
    lowerName.endsWith(extension),
  );
}

function getFileExtension(fileName: string) {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".tar.gz")) return ".tar.gz";
  return path.extname(lowerName);
}

function inferMimeType(
  fileName: string,
  fallback = "application/octet-stream",
) {
  const extension = getFileExtension(fileName);
  const mapping: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".tar.gz": "application/gzip",
    ".tgz": "application/gzip",
    ".gz": "application/gzip",
    ".rar": "application/vnd.rar",
    ".7z": "application/x-7z-compressed",
    ".js": "text/javascript",
    ".jsx": "text/javascript",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".json": "application/json",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".html": "text/html",
    ".css": "text/css",
    ".py": "text/x-python",
    ".java": "text/x-java-source",
    ".kt": "text/x-kotlin",
    ".scala": "text/x-scala",
    ".rs": "text/rust",
    ".go": "text/x-go",
    ".c": "text/x-c",
    ".cpp": "text/x-c++",
    ".h": "text/x-c",
    ".hpp": "text/x-c++",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
  };
  return mapping[extension] ?? fallback;
}

function classifyAttachment(
  name: string,
  mimeType?: string,
): AttachmentKind | "binary" {
  const extension = getFileExtension(name);
  const normalizedMimeType = mimeType?.toLowerCase() ?? "";

  if (
    ATTACHMENT_LIMITS.imageExtensions.includes(
      extension as (typeof ATTACHMENT_LIMITS.imageExtensions)[number],
    ) ||
    normalizedMimeType.startsWith("image/")
  ) {
    return "image";
  }
  if (extension === ".pdf" || normalizedMimeType === "application/pdf") {
    return "pdf";
  }
  if (hasArchiveExtension(name)) return "archive";
  return "text";
}

function isLikelyBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return true;
  if (sample.length === 0) return false;

  let nonPrintable = 0;
  for (const byte of sample) {
    const isPrintable =
      byte === 9 ||
      byte === 10 ||
      byte === 13 ||
      (byte >= 32 && byte <= 126) ||
      byte >= 128;
    if (!isPrintable) nonPrintable += 1;
  }

  return nonPrintable / sample.length > 0.3;
}

async function storeAttachmentBuffer(buffer: Buffer, originalName: string) {
  const id = randomUUID();
  const safeName = sanitizeFileNamePart(path.basename(originalName));
  const directory = path.join(getStoragePaths().attachmentsDir, id);
  const storagePath = path.join(directory, safeName);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(storagePath, buffer);
  return { id, storagePath };
}

async function readAttachmentInput(input: AttachmentInput) {
  if ("path" in input && typeof input.path === "string") {
    const buffer = await fs.readFile(input.path);
    return {
      name: input.name || path.basename(input.path),
      sourcePath: input.path,
      buffer,
      mimeType: input.mimeType,
    };
  }

  if ("bytes" in input) {
    return {
      name: input.name,
      sourcePath: undefined,
      buffer: bufferFromUnknownBytes(input.bytes),
      mimeType: input.mimeType,
    };
  }

  return {
    name: input.name,
    sourcePath: undefined,
    buffer: Buffer.alloc(0),
    mimeType: input.mimeType,
  };
}

function makeAttachmentError({
  name,
  kind = "text",
  mimeType,
  sizeBytes,
  error,
}: {
  name: string;
  kind?: AttachmentKind;
  mimeType?: string;
  sizeBytes: number;
  error: string;
}): ChatAttachment {
  const attachment: ChatAttachment = {
    id: randomUUID(),
    name,
    kind,
    mimeType: mimeType ?? inferMimeType(name),
    sizeBytes,
    error,
    tokenEstimate: 0,
  };
  return attachment;
}

function pushWarning(state: AttachmentProcessState, warning: string) {
  if (!state.warnings.includes(warning)) state.warnings.push(warning);
}

function applyTextCaps(text: string, state: AttachmentProcessState) {
  let nextText = text;
  let truncated = false;

  if (nextText.length > ATTACHMENT_LIMITS.maxTextBytesPerFile) {
    nextText = nextText.slice(0, ATTACHMENT_LIMITS.maxTextBytesPerFile);
    truncated = true;
  }

  const remainingChars = Math.max(
    0,
    ATTACHMENT_LIMITS.maxTotalExtractedChars - state.totalExtractedChars,
  );
  if (nextText.length > remainingChars) {
    nextText = nextText.slice(0, remainingChars);
    truncated = true;
  }

  state.totalExtractedChars += nextText.length;
  return { text: nextText, truncated };
}

async function processImageAttachment({
  name,
  buffer,
  mimeType,
}: {
  name: string;
  buffer: Buffer;
  mimeType?: string;
}): Promise<ChatAttachment> {
  if (buffer.byteLength > ATTACHMENT_LIMITS.maxImageBytes) {
    return makeAttachmentError({
      name,
      kind: "image",
      mimeType: mimeType ?? inferMimeType(name),
      sizeBytes: buffer.byteLength,
      error: `Image exceeds ${Math.round(ATTACHMENT_LIMITS.maxImageBytes / 1024 / 1024)} MB limit`,
    });
  }

  const stored = await storeAttachmentBuffer(buffer, name);
  const resolvedMimeType = mimeType ?? inferMimeType(name, "image/*");
  const thumbnailDataUrl =
    buffer.byteLength <= 512 * 1024
      ? `data:${resolvedMimeType};base64,${buffer.toString("base64")}`
      : undefined;

  const attachment: ChatAttachment = {
    id: stored.id,
    name,
    kind: "image",
    mimeType: resolvedMimeType,
    sizeBytes: buffer.byteLength,
    storagePath: stored.storagePath,
    thumbnailDataUrl,
  };
  attachment.tokenEstimate = estimateAttachmentTokens(attachment);
  return attachment;
}

async function processTextAttachment({
  name,
  buffer,
  mimeType,
  state,
}: {
  name: string;
  buffer: Buffer;
  mimeType?: string;
  state: AttachmentProcessState;
}): Promise<ChatAttachment> {
  if (buffer.byteLength > ATTACHMENT_LIMITS.maxFileBytes) {
    return makeAttachmentError({
      name,
      kind: "text",
      mimeType: mimeType ?? inferMimeType(name),
      sizeBytes: buffer.byteLength,
      error: `File exceeds ${Math.round(ATTACHMENT_LIMITS.maxFileBytes / 1024 / 1024)} MB limit`,
    });
  }

  if (isLikelyBinary(buffer)) {
    return makeAttachmentError({
      name,
      kind: "text",
      mimeType: mimeType ?? inferMimeType(name),
      sizeBytes: buffer.byteLength,
      error: "Binary file skipped",
    });
  }

  const stored = await storeAttachmentBuffer(buffer, name);
  const capped = applyTextCaps(buffer.toString("utf8"), state);
  const attachment: ChatAttachment = {
    id: stored.id,
    name,
    kind: "text",
    mimeType: mimeType ?? inferMimeType(name, "text/plain"),
    sizeBytes: buffer.byteLength,
    storagePath: stored.storagePath,
    extractedText: capped.text,
    truncated: capped.truncated,
  };
  attachment.tokenEstimate = estimateAttachmentTokens(attachment);
  return attachment;
}

async function processPdfAttachment({
  name,
  buffer,
  state,
}: {
  name: string;
  buffer: Buffer;
  state: AttachmentProcessState;
}): Promise<ChatAttachment> {
  if (buffer.byteLength > ATTACHMENT_LIMITS.maxFileBytes) {
    return makeAttachmentError({
      name,
      kind: "pdf",
      mimeType: "application/pdf",
      sizeBytes: buffer.byteLength,
      error: `PDF exceeds ${Math.round(ATTACHMENT_LIMITS.maxFileBytes / 1024 / 1024)} MB limit`,
    });
  }

  const stored = await storeAttachmentBuffer(buffer, name);
  const data = await pdfParse(buffer);
  const extracted = data.text ?? "";
  const capped = applyTextCaps(extracted, state);
  const attachment: ChatAttachment = {
    id: stored.id,
    name,
    kind: "pdf",
    mimeType: "application/pdf",
    sizeBytes: buffer.byteLength,
    storagePath: stored.storagePath,
    extractedText: capped.text,
    truncated: capped.truncated,
    ...(extracted.trim()
      ? {}
      : { error: "No extractable text (PDF may be scanned)" }),
  };
  attachment.tokenEstimate = estimateAttachmentTokens(attachment);
  return attachment;
}

async function walkFiles(directory: string) {
  const files: string[] = [];
  const stack = [directory];

  while (stack.length) {
    const currentDirectory = stack.pop();
    if (!currentDirectory) continue;
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      const relative = path.relative(directory, entryPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

async function extractArchiveToDirectory(archivePath: string, tmpDir: string) {
  await new Promise<void>((resolve, reject) => {
    const stream = Seven.extractFull(archivePath, tmpDir, {
      $bin: getPathTo7za(),
      recursive: true,
    });
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
}

async function processAttachmentBuffer({
  name,
  buffer,
  sourcePath,
  mimeType,
  state,
  depth,
}: {
  name: string;
  buffer: Buffer;
  sourcePath?: string;
  mimeType?: string;
  state: AttachmentProcessState;
  depth: number;
}): Promise<ChatAttachment> {
  const kind = classifyAttachment(name, mimeType);

  try {
    if (kind === "image") {
      return processImageAttachment({ name, buffer, mimeType });
    }

    if (kind === "pdf") {
      return processPdfAttachment({ name, buffer, state });
    }

    if (kind === "archive") {
      return processArchiveAttachment({
        name,
        buffer,
        sourcePath,
        state,
        depth,
      });
    }

    return processTextAttachment({ name, buffer, mimeType, state });
  } catch (error) {
    return makeAttachmentError({
      name,
      kind: kind === "binary" ? "text" : kind,
      mimeType: mimeType ?? inferMimeType(name),
      sizeBytes: buffer.byteLength,
      error: error instanceof Error ? error.message : "Failed to process attachment",
    });
  }
}

async function processArchiveAttachment({
  name,
  buffer,
}: {
  name: string;
  buffer: Buffer;
  sourcePath?: string;
  state: AttachmentProcessState;
  depth: number;
}): Promise<ChatAttachment> {
  if (buffer.byteLength > ATTACHMENT_LIMITS.maxArchiveBytes) {
    return makeAttachmentError({
      name,
      kind: "archive",
      mimeType: inferMimeType(name),
      sizeBytes: buffer.byteLength,
      error: `Archive exceeds ${Math.round(ATTACHMENT_LIMITS.maxArchiveBytes / 1024 / 1024)} MB limit`,
    });
  }

  const stored = await storeAttachmentBuffer(buffer, name);
  return {
    id: stored.id,
    name,
    kind: "archive",
    mimeType: inferMimeType(name),
    sizeBytes: buffer.byteLength,
    storagePath: stored.storagePath,
    children: [],
    tokenEstimate: 0,
  };
}

async function processAttachmentInput(
  input: AttachmentInput,
  state: AttachmentProcessState,
) {
  const { name, sourcePath, buffer, mimeType } =
    await readAttachmentInput(input);
  return processAttachmentBuffer({
    name,
    buffer,
    sourcePath,
    mimeType,
    state,
    depth: 0,
  });
}

function collectAttachmentStoragePaths(
  value: unknown,
  paths = new Set<string>(),
) {
  if (Array.isArray(value)) {
    for (const item of value) collectAttachmentStoragePaths(item, paths);
    return paths;
  }

  if (!isPlainObject(value)) return paths;

  if (typeof value.storagePath === "string" && value.storagePath.trim()) {
    paths.add(value.storagePath);
  }

  if (Array.isArray(value.attachments)) {
    collectAttachmentStoragePaths(value.attachments, paths);
  }

  if (Array.isArray(value.children)) {
    collectAttachmentStoragePaths(value.children, paths);
  }

  if (Array.isArray(value.messages)) {
    collectAttachmentStoragePaths(value.messages, paths);
  }

  return paths;
}

function normalizeAttachmentStoragePath(storagePath: string) {
  const storageRoot = path.resolve(getStoragePaths().attachmentsDir);
  const resolvedStoragePath = path.resolve(storagePath);
  const relative = path.relative(storageRoot, resolvedStoragePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return resolvedStoragePath;
}

function collectNormalizedAttachmentStoragePaths(value: unknown) {
  const paths = new Set<string>();
  for (const storagePath of collectAttachmentStoragePaths(value)) {
    const normalized = normalizeAttachmentStoragePath(storagePath);
    if (normalized) paths.add(normalized);
  }
  return paths;
}

async function collectReferencedAttachmentStoragePaths() {
  const paths = getStoragePaths();
  const referenced = new Set<string>();

  await fs.mkdir(paths.chatsDir, { recursive: true });
  const entries = await fs.readdir(paths.chatsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".json") ||
      entry.name === "index.json"
    ) {
      continue;
    }

    const chat = await readJsonFile<unknown>(
      path.join(paths.chatsDir, entry.name),
      undefined,
    );
    for (const storagePath of collectNormalizedAttachmentStoragePaths(chat)) {
      referenced.add(storagePath);
    }
  }

  return referenced;
}

async function deleteAttachmentStoragePath(storagePath: string) {
  const normalized = normalizeAttachmentStoragePath(storagePath);
  if (!normalized) return false;

  const storageRoot = path.resolve(getStoragePaths().attachmentsDir);
  const parentDirectory = path.dirname(normalized);
  const relativeParent = path.relative(storageRoot, parentDirectory);
  if (relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) {
    return false;
  }

  try {
    await fs.rm(parentDirectory, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error("Failed to delete attachment storage path:", error);
    return false;
  }
}

async function cleanupUnreferencedAttachmentStoragePaths(
  candidates: Iterable<string>,
) {
  const normalizedCandidates = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeAttachmentStoragePath(candidate);
    if (normalized) normalizedCandidates.add(normalized);
  }

  if (!normalizedCandidates.size) return { deleted: 0 };

  const referenced = await collectReferencedAttachmentStoragePaths();
  let deleted = 0;

  for (const storagePath of normalizedCandidates) {
    if (referenced.has(storagePath)) continue;
    if (await deleteAttachmentStoragePath(storagePath)) deleted += 1;
  }

  return { deleted };
}

async function deleteTemporaryAttachmentStoragePaths(
  candidates: Iterable<string>,
) {
  const normalizedCandidates = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeAttachmentStoragePath(candidate);
    if (normalized) normalizedCandidates.add(normalized);
  }

  if (!normalizedCandidates.size) return { deleted: 0 };

  let deleted = 0;
  for (const storagePath of normalizedCandidates) {
    if (await deleteAttachmentStoragePath(storagePath)) deleted += 1;
  }

  return { deleted };
}

async function cleanupOrphanedAttachmentDirectories() {
  const attachmentsDir = getStoragePaths().attachmentsDir;
  await fs.mkdir(attachmentsDir, { recursive: true });

  const referenced = await collectReferencedAttachmentStoragePaths();
  const entries = await fs.readdir(attachmentsDir, { withFileTypes: true });
  let deleted = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const directory = path.join(attachmentsDir, entry.name);
    const stack = [directory];
    let hasReferencedFile = false;

    while (stack.length && !hasReferencedFile) {
      const currentDirectory = stack.pop();
      if (!currentDirectory) continue;

      let childEntries: import("node:fs").Dirent[] = [];
      try {
        childEntries = await fs.readdir(currentDirectory, {
          withFileTypes: true,
        });
      } catch {
        continue;
      }

      for (const childEntry of childEntries) {
        const childPath = path.join(currentDirectory, childEntry.name);
        if (childEntry.isDirectory()) {
          stack.push(childPath);
        } else if (
          childEntry.isFile() &&
          referenced.has(path.resolve(childPath))
        ) {
          hasReferencedFile = true;
          break;
        }
      }
    }

    if (!hasReferencedFile) {
      await fs.rm(directory, { recursive: true, force: true });
      deleted += 1;
    }
  }

  return { deleted };
}

function collectAttachmentDeleteCandidates(request: unknown) {
  if (isPlainObject(request)) {
    const values = [
      request.attachments,
      request.storagePaths,
      request.storagePath,
    ].filter((value) => value !== undefined);
    if (values.length) return collectAttachmentStoragePaths(values);
  }

  return collectAttachmentStoragePaths(request);
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
  const normalized = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 120)
    .trim();

  return normalized || "item";
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

/**
 * Like readJsonFile, but if the primary file is missing or corrupt it tries to
 * recover from the `.bak` snapshot written by writeJsonAtomic({ backup: true }).
 * Used for the critical singleton files (providers, settings) so a single bad
 * write or partial file can never silently turn into "empty defaults".
 */
async function readJsonFileWithRecovery<T>(
  filePath: string,
  fallback: T,
): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (primaryError) {
    const code =
      typeof primaryError === "object" && primaryError && "code" in primaryError
        ? (primaryError as { code?: string }).code
        : undefined;
    if (code !== "ENOENT") {
      console.error(
        `Corrupt JSON at ${filePath}; attempting backup recovery:`,
        primaryError,
      );
    }
    try {
      const recovered = JSON.parse(
        await fs.readFile(`${filePath}.bak`, "utf8"),
      ) as T;
      if (code !== "ENOENT") {
        console.warn(`Recovered ${filePath} from ${filePath}.bak`);
      }
      return recovered;
    } catch {
      return fallback;
    }
  }
}

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  options: { backup?: boolean } = {},
) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Snapshot the current good file before overwriting it, so a bad write can
  // be recovered (see readJsonFileWithRecovery).
  if (options.backup) {
    try {
      await fs.copyFile(filePath, `${filePath}.bak`);
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code !== "ENOENT") {
        console.warn(`Could not back up ${filePath}:`, error);
      }
    }
  }

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const json = `${JSON.stringify(value, null, 2)}\n`;

  // Write + fsync the temp file so its bytes are durable before the rename,
  // then atomically replace the target.
  const handle = await fs.open(tempPath, "w");
  try {
    await handle.writeFile(json, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
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
  await fs.mkdir(paths.toolsDir, { recursive: true });
  await fs.mkdir(paths.skillsDir, { recursive: true });
  await fs.mkdir(paths.agentsDir, { recursive: true });
  await fs.mkdir(paths.attachmentsDir, { recursive: true });
  await fs.mkdir(paths.chatWorkspacesDir, { recursive: true });
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
    skillsSettings: DEFAULT_SKILLS_SETTINGS,
    agentsSettings: DEFAULT_AGENTS_SETTINGS,
    appSettings: DEFAULT_APP_SETTINGS,
    mcpSettings: DEFAULT_MCP_SETTINGS,
    modesState: undefined,
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
    titleMode:
      chat.titleMode === "auto" || chat.titleMode === "manual"
        ? chat.titleMode
        : undefined,
    isPinned: chat.isPinned === true,
    folderId: typeof chat.folderId === "string" ? chat.folderId : undefined,
  };
}

async function readSettingsFile() {
  return readJsonFileWithRecovery<JsonRecord>(getStoragePaths().settings, {});
}

async function writeSettingsPatch(patch: JsonRecord) {
  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    const settings = await readSettingsFile();
    await writeJsonAtomic(
      getStoragePaths().settings,
      {
        ...settings,
        ...patch,
      },
      { backup: true },
    );
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
  try {
    await cleanupOrphanedAttachmentDirectories();
  } catch (error) {
    console.error("Failed to clean up orphaned attachment directories:", error);
  }
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
    const previousChat = await readJsonFile<unknown>(
      chatFilePath(chatId),
      undefined,
    );
    const previousAttachmentPaths =
      collectNormalizedAttachmentStoragePaths(previousChat);
    const nextAttachmentPaths = collectNormalizedAttachmentStoragePaths(chat);
    const cleanupCandidates = new Set<string>();

    for (const storagePath of previousAttachmentPaths) {
      if (!nextAttachmentPaths.has(storagePath))
        cleanupCandidates.add(storagePath);
    }

    await writeJsonAtomic(chatFilePath(chatId), chat);

    const existing = await readChatIndex();
    const next = existing.filter((item) => item.id !== chatId);
    const summary = normalizeChatSummary(chat);

    if (summary) next.unshift(summary);

    await writeChatIndexFromChats(next);
    await cleanupUnreferencedAttachmentStoragePaths(cleanupCandidates);
  });
}

async function deleteJsonChat(chatId: unknown) {
  const id = safeString(chatId).trim();
  if (!id) return;

  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    const chat = await readJsonFile<unknown>(chatFilePath(id), undefined);
    const cleanupCandidates = collectNormalizedAttachmentStoragePaths(chat);

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
    await cleanupUnreferencedAttachmentStoragePaths(cleanupCandidates);
    await deleteChatWorkspace(id);
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
    await fs.rm(paths.attachmentsDir, { recursive: true, force: true });
    await fs.mkdir(paths.attachmentsDir, { recursive: true });
    await fs.rm(paths.chatWorkspacesDir, { recursive: true, force: true });
    await fs.mkdir(paths.chatWorkspacesDir, { recursive: true });
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
      skillsSettings: DEFAULT_SKILLS_SETTINGS,
      agentsSettings: DEFAULT_AGENTS_SETTINGS,
      appSettings: normalizeAppSettings(snapshot.appSettings),
      mcpSettings: normalizeMcpSettings(snapshot.mcpSettings),
      modesState: snapshot.modesState,
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

type ToolFileRecord = {
  tool: ToolDefinition;
  filePath: string;
  fileName: string;
};

function legacyToolFilePath(toolId: string) {
  return path.join(
    getStoragePaths().toolsDir,
    `${sanitizeFileNamePart(toolId)}.json`,
  );
}

function readableToolFilePath(tool: Pick<ToolDefinition, "id" | "name">) {
  const fileNameBase = tool.name || tool.id || "tool";
  return path.join(
    getStoragePaths().toolsDir,
    `${sanitizeFileNamePart(fileNameBase)}.json`,
  );
}

async function readToolFileRecords() {
  await fs.mkdir(getStoragePaths().toolsDir, { recursive: true });
  const entries = await fs.readdir(getStoragePaths().toolsDir, {
    withFileTypes: true,
  });
  const records: ToolFileRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const filePath = path.join(getStoragePaths().toolsDir, entry.name);
    const raw = await readJsonFile<unknown>(filePath, undefined);
    const tool = normalizeToolDefinition(raw);

    try {
      validateToolDefinition(tool);
      records.push({ tool, filePath, fileName: entry.name });
    } catch (error) {
      console.error(`Invalid tool manifest ${entry.name}:`, error);
    }
  }

  return records;
}

async function migrateReadableToolFileNames(records: ToolFileRecord[]) {
  const usedFileNames = new Set(records.map((record) => record.fileName));

  for (const record of records) {
    const preferredBase = sanitizeFileNamePart(
      record.tool.name || record.tool.id || "tool",
    );
    const preferredFileName = `${preferredBase}.json`;

    if (record.fileName === preferredFileName) continue;

    let candidateFileName = preferredFileName;
    let index = 1;

    while (usedFileNames.has(candidateFileName)) {
      candidateFileName = `${preferredBase} (${index}).json`;
      index += 1;
    }

    const nextFilePath = path.join(
      getStoragePaths().toolsDir,
      candidateFileName,
    );

    try {
      await fs.rename(record.filePath, nextFilePath);
      usedFileNames.delete(record.fileName);
      usedFileNames.add(candidateFileName);
      record.filePath = nextFilePath;
      record.fileName = candidateFileName;
    } catch (error) {
      console.error(
        `Failed to rename tool manifest ${record.fileName}:`,
        error,
      );
    }
  }
}

async function deleteToolFilesById(toolId: string, exceptFilePath?: string) {
  const normalizedExcept = exceptFilePath
    ? path.resolve(exceptFilePath)
    : undefined;
  const records = await readToolFileRecords();
  const candidates = new Set<string>();

  for (const record of records) {
    if (record.tool.id === toolId) candidates.add(record.filePath);
  }

  candidates.add(legacyToolFilePath(toolId));

  for (const filePath of candidates) {
    if (normalizedExcept && path.resolve(filePath) === normalizedExcept)
      continue;

    try {
      await fs.unlink(filePath);
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code !== "ENOENT") throw error;
    }
  }
}

async function loadJsonTools() {
  await initializeJsonStorageIfNeeded();
  const records = await readToolFileRecords();
  await migrateReadableToolFileNames(records);

  const tools = records.map((record) => record.tool);
  tools.sort((left, right) => left.name.localeCompare(right.name));
  return tools.map(toPublicTool);
}

async function saveJsonTool(value: unknown) {
  const tool = normalizeToolDefinition(value);
  validateImportedToolDefinition(tool);

  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    const existingTools = await loadJsonTools();
    const duplicate = existingTools.find(
      (candidate) => candidate.id !== tool.id && candidate.name === tool.name,
    );
    if (duplicate)
      throw new Error(`Another tool already uses the name: ${tool.name}`);

    const targetPath = readableToolFilePath(tool);
    await writeJsonAtomic(targetPath, tool);
    await deleteToolFilesById(tool.id, targetPath);
  });

  return tool;
}

async function deleteJsonTool(toolId: unknown) {
  const id = safeString(toolId).trim();
  if (!id) return;

  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    await deleteToolFilesById(id);
  });
}

function createEmptyToolImportResult(cancelled: boolean): ToolImportResult {
  return {
    cancelled,
    imported: 0,
    updated: 0,
    skipped: [],
    invalid: [],
    renamed: [],
  };
}

function validateImportedToolDefinition(tool: ToolDefinition) {
  validateToolDefinition(tool);
  if (
    tool.name === "ask_user" ||
    tool.name === "checklist_write" ||
    tool.name === "skill" ||
    tool.name === WEB_FETCH_TOOL_NAME ||
    isFileToolName(tool.name)
  ) {
    throw new Error(
      `${tool.name} is a built-in tool name and cannot be imported as a custom tool.`,
    );
  }
}

function createUniqueImportedToolName(
  baseName: string,
  existingByName: Map<string, PublicToolDefinition>,
) {
  let index = 1;
  let candidate = `${baseName}_${index}`;

  while (existingByName.has(candidate)) {
    index += 1;
    candidate = `${baseName}_${index}`;
  }

  return candidate;
}

function areToolDefinitionsEquivalent(
  left: PublicToolDefinition,
  right: ToolDefinition,
) {
  return (
    JSON.stringify({ ...left, id: undefined }) ===
    JSON.stringify({ ...right, id: undefined })
  );
}

async function importJsonToolsFromFiles(): Promise<ToolImportResult> {
  await initializeJsonStorageIfNeeded();
  await fs.mkdir(getStoragePaths().toolsDir, { recursive: true });

  const openOptions = {
    title: "Import tools",
    properties: ["openFile", "multiSelections"] as Array<
      "openFile" | "multiSelections"
    >,
    filters: [{ name: "JSON files", extensions: ["json"] }],
  };
  const result = win
    ? await dialog.showOpenDialog(win, openOptions)
    : await dialog.showOpenDialog(openOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return createEmptyToolImportResult(true);
  }

  const importResult = createEmptyToolImportResult(false);
  const parsedTools: Array<{ source: string; tool: ToolDefinition }> = [];

  for (const filePath of result.filePaths) {
    const source = path.basename(filePath);
    try {
      const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
      const tool = normalizeToolDefinition(raw);
      validateImportedToolDefinition(tool);
      parsedTools.push({ source, tool });
    } catch (error) {
      importResult.invalid.push({ source, message: getErrorMessage(error) });
    }
  }

  if (parsedTools.length === 0) return importResult;

  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    await fs.mkdir(getStoragePaths().toolsDir, { recursive: true });

    const existingTools = await loadJsonTools();
    const existingById = new Map(existingTools.map((tool) => [tool.id, tool]));
    const existingByName = new Map(
      existingTools.map((tool) => [tool.name, tool]),
    );

    for (const { source, tool } of parsedTools) {
      const sameIdTool = existingById.get(tool.id);
      const sameNameTool = existingByName.get(tool.name);
      let toolToSave = tool;

      if (sameNameTool && sameNameTool.id !== tool.id) {
        if (areToolDefinitionsEquivalent(sameNameTool, tool)) {
          importResult.skipped.push({
            source,
            toolName: tool.name,
            message: `A matching tool already exists: ${tool.name}`,
          });
          continue;
        }

        const renamedTool = {
          ...tool,
          name: createUniqueImportedToolName(tool.name, existingByName),
        };
        toolToSave = renamedTool;
        importResult.renamed.push({
          source,
          toolName: renamedTool.name,
          message: `Renamed ${tool.name} to ${renamedTool.name} because the original name already exists with different settings.`,
        });
      }

      const targetPath = readableToolFilePath(toolToSave);
      await writeJsonAtomic(targetPath, toolToSave);
      await deleteToolFilesById(toolToSave.id, targetPath);

      if (sameIdTool) {
        importResult.updated += 1;
        existingByName.delete(sameIdTool.name);
      } else {
        importResult.imported += 1;
      }

      existingById.set(toolToSave.id, toolToSave);
      existingByName.set(toolToSave.name, toolToSave);
    }
  });

  return importResult;
}

function ensureJsonExtension(filePath: string) {
  return path.extname(filePath).toLowerCase() === ".json"
    ? filePath
    : `${filePath}.json`;
}

function toolExportFileName(tool: ToolDefinition, usedNames: Set<string>) {
  const base = sanitizeFileNamePart(tool.name || tool.id || "tool");
  let candidate = `${base}.json`;
  let index = 1;

  while (usedNames.has(candidate)) {
    candidate = `${base} (${index}).json`;
    index += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function normalizeExportTools(value: unknown): ToolDefinition[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => {
    const tool = normalizeToolDefinition(item);
    validateImportedToolDefinition(tool);
    return tool;
  });
}

async function exportJsonToolToFile(value: unknown): Promise<ToolExportResult> {
  const tools = normalizeExportTools(value);
  const tool = tools[0];
  if (!tool) throw new Error("No tool to export.");

  const saveOptions = {
    title: "Export tool",
    defaultPath: `${sanitizeFileNamePart(tool.name || tool.id || "tool")}.json`,
    filters: [{ name: "JSON files", extensions: ["json"] }],
  };
  const result = win
    ? await dialog.showSaveDialog(win, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (result.canceled || !result.filePath) {
    return { cancelled: true, exported: 0 };
  }

  const filePath = ensureJsonExtension(result.filePath);
  await writeJsonAtomic(filePath, tool);

  return { cancelled: false, exported: 1, path: filePath };
}

async function exportJsonToolsToFolder(
  value: unknown,
): Promise<ToolExportResult> {
  const tools = normalizeExportTools(value);
  if (tools.length === 0) throw new Error("No tools to export.");

  const openOptions = {
    title: "Export tools to folder",
    properties: ["openDirectory", "createDirectory"] as Array<
      "openDirectory" | "createDirectory"
    >,
  };
  const result = win
    ? await dialog.showOpenDialog(win, openOptions)
    : await dialog.showOpenDialog(openOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true, exported: 0 };
  }

  const folderPath = result.filePaths[0];
  await fs.mkdir(folderPath, { recursive: true });

  const usedNames = new Set<string>();
  for (const tool of tools) {
    const fileName = toolExportFileName(tool, usedNames);
    await writeJsonAtomic(path.join(folderPath, fileName), tool);
  }

  return { cancelled: false, exported: tools.length, path: folderPath };
}

async function openJsonToolsFolder() {
  await initializeJsonStorageIfNeeded();
  await fs.mkdir(getStoragePaths().toolsDir, { recursive: true });

  const error = await shell.openPath(getStoragePaths().toolsDir);
  if (error) throw new Error(error);
}

// ---------------------------------------------------------------------------
// Readonly skill discovery.
//
// Skills are filesystem folders with SKILL.md. Chat Forge does not edit or
// enable/disable them. It discovers the global ~/.agents/skills folder plus the
// selected workspace .agents/skills fallback, shows SKILL.md readonly,
// advertises metadata to the model, and loads skill content through the
// built-in skill tool.
// ---------------------------------------------------------------------------

const SKILL_MANIFEST_FILENAME = "SKILL.md";

type SkillFolderRecord = {
  skill: SkillDefinition;
  folderPath: string;
  manifestPath: string;
};

type SkillFrontmatter = {
  name?: string;
  description?: string;
  disableModelInvocation?: boolean;
};

function unquoteYamlString(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function parseSkillManifest(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const normalized = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { frontmatter: {}, body: normalized.trim() };

  const frontmatter: SkillFrontmatter = {};
  for (const rawLine of match[1].split("\n")) {
    const keyValue = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(rawLine);
    if (!keyValue) continue;

    const key = keyValue[1].trim();
    const value = unquoteYamlString(keyValue[2].trim());
    if (key === "name") frontmatter.name = value;
    else if (key === "description") frontmatter.description = value;
    else if (key === "disable-model-invocation") {
      frontmatter.disableModelInvocation = value.toLowerCase() === "true";
    }
  }

  return { frontmatter, body: normalized.slice(match[0].length).trim() };
}

function normalizeSkillName(value: string) {
  return value.trim();
}

function buildSkillFromManifest(
  folderPath: string,
  content: string,
  sourceKind: "global" | "workspace",
  sourcePath: string,
): SkillDefinition {
  const { frontmatter, body } = parseSkillManifest(content);
  const manifestPath = path.join(folderPath, SKILL_MANIFEST_FILENAME);
  const name = normalizeSkillName(frontmatter.name || path.basename(folderPath));

  return normalizeSkillDefinition({
    name,
    enabled: true,
    description: frontmatter.description ?? "",
    instructions: body,
    recommendedToolNames: [],
    directoryPath: folderPath,
    manifestPath,
    manifestContent: content,
    disableModelInvocation: frontmatter.disableModelInvocation === true,
    sourceKind,
    sourcePath,
    source: sourceKind === "global" ? "Global" : "Workspace",
  });
}

function getGlobalSkillSearchDirs() {
  return [path.join(app.getPath("home"), ".agents", "skills")];
}

function getWorkspaceSkillSearchDirs(workspaceRootsValue: unknown) {
  const dirs: string[] = [];
  const roots = normalizeWorkspaceRoots(workspaceRootsValue);

  for (const root of roots.slice(0, 1)) {
    const rootPath = root.path.trim();
    if (!rootPath) continue;

    dirs.push(path.join(rootPath, ".agents", "skills"));
  }

  return dirs;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = path.resolve(value);
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

async function tryReadSkillFolder(
  folderPath: string,
  sourceKind: "global" | "workspace",
  sourcePath: string,
): Promise<SkillFolderRecord | undefined> {
  const manifestPath = path.join(folderPath, SKILL_MANIFEST_FILENAME);
  let content: string;
  try {
    content = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }

  const skill = buildSkillFromManifest(folderPath, content, sourceKind, sourcePath);
  if (!skill.name) return undefined;
  return { skill, folderPath, manifestPath };
}

async function discoverSkillsInDir(searchDir: string, sourceKind: "global" | "workspace"): Promise<SkillFolderRecord[]> {
  const records: SkillFolderRecord[] = [];
  try {
    const rootRecord = await tryReadSkillFolder(searchDir, sourceKind, searchDir);
    if (rootRecord) records.push(rootRecord);

    const entries = await fs.readdir(searchDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const record = await tryReadSkillFolder(path.join(searchDir, entry.name), sourceKind, searchDir);
      if (record) records.push(record);
    }
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    console.error(`Failed to discover skills in ${searchDir}:`, error);
  }
  return records;
}

async function loadJsonSkills(request?: unknown) {
  const workspaceRoots = isPlainObject(request) ? request.workspaceRoots : undefined;
  const globalDirs = uniqueStrings(getGlobalSkillSearchDirs());
  const workspaceDirs = uniqueStrings(getWorkspaceSkillSearchDirs(workspaceRoots));

  const globalRecords: SkillFolderRecord[] = [];
  const workspaceRecords: SkillFolderRecord[] = [];
  for (const searchDir of globalDirs) {
    globalRecords.push(...(await discoverSkillsInDir(searchDir, "global")));
  }
  for (const searchDir of workspaceDirs) {
    workspaceRecords.push(...(await discoverSkillsInDir(searchDir, "workspace")));
  }

  const workspaceSkillNames = new Set(workspaceRecords.map((record) => record.skill.name));
  const allSkills = [
    ...globalRecords.map((record) => ({
      ...record.skill,
      shadowed: workspaceSkillNames.has(record.skill.name),
    })),
    ...workspaceRecords.map((record) => ({ ...record.skill, shadowed: false })),
  ];

  return allSkills
    .sort((left, right) => {
      const sourceOrder = (left.sourceKind === "global" ? 0 : 1) - (right.sourceKind === "global" ? 0 : 1);
      if (sourceOrder !== 0) return sourceOrder;
      return left.name.localeCompare(right.name);
    })
    .map(toPublicSkill);
}

async function saveJsonSkill(..._args: unknown[]) {
  throw new Error("Skills are readonly. Edit SKILL.md in the skills folder.");
}

async function deleteJsonSkill(..._args: unknown[]) {
  throw new Error("Skills are readonly. Delete the skill folder from the filesystem.");
}

function createEmptySkillImportResult(cancelled: boolean): SkillImportResult {
  return { cancelled, imported: 0, updated: 0, skipped: [], invalid: [], renamed: [] };
}

async function importJsonSkillsFromFiles(): Promise<SkillImportResult> {
  return createEmptySkillImportResult(true);
}

async function exportJsonSkillToFile(..._args: unknown[]): Promise<SkillExportResult> {
  throw new Error("Skills are readonly. Copy the skill folder from the filesystem.");
}

async function exportJsonSkillsToFolder(..._args: unknown[]): Promise<SkillExportResult> {
  throw new Error("Skills are readonly. Copy the skill folders from the filesystem.");
}

async function openJsonSkillsFolder() {
  const skillsDir = getGlobalSkillSearchDirs()[0];
  await fs.mkdir(skillsDir, { recursive: true });
  const error = await shell.openPath(skillsDir);
  if (error) throw new Error(error);
}

type AgentFileRecord = {
  agent: AgentDefinition;
  filePath: string;
  fileName: string;
};

function legacyAgentFilePath(agentId: string) {
  return path.join(
    getStoragePaths().agentsDir,
    `${sanitizeFileNamePart(agentId)}.json`,
  );
}

function readableAgentFilePath(agent: Pick<AgentDefinition, "id" | "name">) {
  const fileNameBase = agent.name || agent.id || "agent";
  return path.join(
    getStoragePaths().agentsDir,
    `${sanitizeFileNamePart(fileNameBase)}.json`,
  );
}

async function readAgentFileRecords() {
  await fs.mkdir(getStoragePaths().agentsDir, { recursive: true });
  const entries = await fs.readdir(getStoragePaths().agentsDir, {
    withFileTypes: true,
  });
  const records: AgentFileRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const filePath = path.join(getStoragePaths().agentsDir, entry.name);
    const raw = await readJsonFile<unknown>(filePath, undefined);
    const agent = normalizeAgentDefinition(raw);

    try {
      validateAgentDefinition(agent);
      records.push({ agent, filePath, fileName: entry.name });
    } catch (error) {
      console.error(`Invalid agent manifest ${entry.name}:`, error);
    }
  }

  return records;
}

async function migrateReadableAgentFileNames(records: AgentFileRecord[]) {
  const usedFileNames = new Set(records.map((record) => record.fileName));

  for (const record of records) {
    const preferredBase = sanitizeFileNamePart(
      record.agent.name || record.agent.id || "agent",
    );
    const preferredFileName = `${preferredBase}.json`;

    if (record.fileName === preferredFileName) continue;

    let candidateFileName = preferredFileName;
    let index = 1;

    while (usedFileNames.has(candidateFileName)) {
      candidateFileName = `${preferredBase} (${index}).json`;
      index += 1;
    }

    const nextFilePath = path.join(
      getStoragePaths().agentsDir,
      candidateFileName,
    );

    try {
      await fs.rename(record.filePath, nextFilePath);
      usedFileNames.delete(record.fileName);
      usedFileNames.add(candidateFileName);
      record.filePath = nextFilePath;
      record.fileName = candidateFileName;
    } catch (error) {
      console.error(
        `Failed to rename agent manifest ${record.fileName}:`,
        error,
      );
    }
  }
}

async function deleteAgentFilesById(agentId: string, exceptFilePath?: string) {
  const normalizedExcept = exceptFilePath
    ? path.resolve(exceptFilePath)
    : undefined;
  const records = await readAgentFileRecords();
  const candidates = new Set<string>();

  for (const record of records) {
    if (record.agent.id === agentId) candidates.add(record.filePath);
  }

  candidates.add(legacyAgentFilePath(agentId));

  for (const filePath of candidates) {
    if (normalizedExcept && path.resolve(filePath) === normalizedExcept)
      continue;

    try {
      await fs.unlink(filePath);
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code !== "ENOENT") throw error;
    }
  }
}

async function loadJsonAgents() {
  await initializeJsonStorageIfNeeded();
  const records = await readAgentFileRecords();
  await migrateReadableAgentFileNames(records);

  const agents = records.map((record) => record.agent);
  agents.sort((left, right) => left.name.localeCompare(right.name));
  return agents.map(toPublicAgent);
}

async function saveJsonAgent(value: unknown) {
  const agent = normalizeAgentDefinition(value);
  validateAgentDefinition(agent);

  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    const existingAgents = await loadJsonAgents();
    const duplicate = existingAgents.find(
      (candidate) => candidate.id !== agent.id && candidate.name === agent.name,
    );
    if (duplicate)
      throw new Error(`Another agent already uses the name: ${agent.name}`);

    const targetPath = readableAgentFilePath(agent);
    await writeJsonAtomic(targetPath, agent);
    await deleteAgentFilesById(agent.id, targetPath);
  });

  return agent;
}

async function deleteJsonAgent(agentId: unknown) {
  const id = safeString(agentId).trim();
  if (!id) return;

  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    await deleteAgentFilesById(id);
  });
}

function createEmptyAgentImportResult(cancelled: boolean): AgentImportResult {
  return {
    cancelled,
    imported: 0,
    updated: 0,
    skipped: [],
    invalid: [],
    renamed: [],
  };
}

function createUniqueImportedAgentName(
  baseName: string,
  existingByName: Map<string, PublicAgentDefinition>,
) {
  let index = 1;
  let candidate = `${baseName}_${index}`;

  while (existingByName.has(candidate)) {
    index += 1;
    candidate = `${baseName}_${index}`;
  }

  return candidate;
}

function areAgentDefinitionsEquivalent(
  left: PublicAgentDefinition,
  right: AgentDefinition,
) {
  return (
    JSON.stringify({ ...left, id: undefined }) ===
    JSON.stringify({ ...right, id: undefined })
  );
}

async function importJsonAgentsFromFiles(): Promise<AgentImportResult> {
  await initializeJsonStorageIfNeeded();
  await fs.mkdir(getStoragePaths().agentsDir, { recursive: true });

  const openOptions = {
    title: "Import agents",
    properties: ["openFile", "multiSelections"] as Array<
      "openFile" | "multiSelections"
    >,
    filters: [{ name: "JSON files", extensions: ["json"] }],
  };
  const result = win
    ? await dialog.showOpenDialog(win, openOptions)
    : await dialog.showOpenDialog(openOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return createEmptyAgentImportResult(true);
  }

  const importResult = createEmptyAgentImportResult(false);
  const parsedAgents: Array<{ source: string; agent: AgentDefinition }> = [];

  for (const filePath of result.filePaths) {
    const source = path.basename(filePath);
    try {
      const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
      const agent = normalizeAgentDefinition(raw);
      validateAgentDefinition(agent);
      parsedAgents.push({ source, agent });
    } catch (error) {
      importResult.invalid.push({ source, message: getErrorMessage(error) });
    }
  }

  if (parsedAgents.length === 0) return importResult;

  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    await fs.mkdir(getStoragePaths().agentsDir, { recursive: true });

    const existingAgents = await loadJsonAgents();
    const existingById = new Map(
      existingAgents.map((agent) => [agent.id, agent]),
    );
    const existingByName = new Map(
      existingAgents.map((agent) => [agent.name, agent]),
    );

    for (const { source, agent } of parsedAgents) {
      const sameIdAgent = existingById.get(agent.id);
      const sameNameAgent = existingByName.get(agent.name);
      let agentToSave = agent;

      if (sameNameAgent && sameNameAgent.id !== agent.id) {
        if (areAgentDefinitionsEquivalent(sameNameAgent, agent)) {
          importResult.skipped.push({
            source,
            agentName: agent.name,
            message: `A matching agent already exists: ${agent.name}`,
          });
          continue;
        }

        const renamedAgent = {
          ...agent,
          name: createUniqueImportedAgentName(agent.name, existingByName),
        };
        agentToSave = renamedAgent;
        importResult.renamed.push({
          source,
          agentName: renamedAgent.name,
          message: `Renamed ${agent.name} to ${renamedAgent.name} because the original name already exists with different settings.`,
        });
      }

      const targetPath = readableAgentFilePath(agentToSave);
      await writeJsonAtomic(targetPath, agentToSave);
      await deleteAgentFilesById(agentToSave.id, targetPath);

      if (sameIdAgent) {
        importResult.updated += 1;
        existingByName.delete(sameIdAgent.name);
      } else {
        importResult.imported += 1;
      }

      existingById.set(agentToSave.id, agentToSave);
      existingByName.set(agentToSave.name, agentToSave);
    }
  });

  return importResult;
}

function agentExportFileName(agent: AgentDefinition, usedNames: Set<string>) {
  const base = sanitizeFileNamePart(agent.name || agent.id || "agent");
  let candidate = `${base}.json`;
  let index = 1;

  while (usedNames.has(candidate)) {
    candidate = `${base} (${index}).json`;
    index += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function normalizeExportAgents(value: unknown): AgentDefinition[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => {
    const agent = normalizeAgentDefinition(item);
    validateAgentDefinition(agent);
    return agent;
  });
}

async function exportJsonAgentToFile(
  value: unknown,
): Promise<AgentExportResult> {
  const agents = normalizeExportAgents(value);
  const agent = agents[0];
  if (!agent) throw new Error("No agent to export.");

  const saveOptions = {
    title: "Export agent",
    defaultPath: `${sanitizeFileNamePart(agent.name || agent.id || "agent")}.json`,
    filters: [{ name: "JSON files", extensions: ["json"] }],
  };
  const result = win
    ? await dialog.showSaveDialog(win, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (result.canceled || !result.filePath) {
    return { cancelled: true, exported: 0 };
  }

  const filePath = ensureJsonExtension(result.filePath);
  await writeJsonAtomic(filePath, agent);

  return { cancelled: false, exported: 1, path: filePath };
}

async function exportJsonAgentsToFolder(
  value: unknown,
): Promise<AgentExportResult> {
  const agents = normalizeExportAgents(value);
  if (agents.length === 0) throw new Error("No agents to export.");

  const openOptions = {
    title: "Export agents to folder",
    properties: ["openDirectory", "createDirectory"] as Array<
      "openDirectory" | "createDirectory"
    >,
  };
  const result = win
    ? await dialog.showOpenDialog(win, openOptions)
    : await dialog.showOpenDialog(openOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true, exported: 0 };
  }

  const folderPath = result.filePaths[0];
  await fs.mkdir(folderPath, { recursive: true });

  const usedNames = new Set<string>();
  for (const agent of agents) {
    const fileName = agentExportFileName(agent, usedNames);
    await writeJsonAtomic(path.join(folderPath, fileName), agent);
  }

  return { cancelled: false, exported: agents.length, path: folderPath };
}

async function openJsonAgentsFolder() {
  await initializeJsonStorageIfNeeded();
  await fs.mkdir(getStoragePaths().agentsDir, { recursive: true });

  const error = await shell.openPath(getStoragePaths().agentsDir);
  if (error) throw new Error(error);
}

function normalizeFindInPageRequest(request: unknown) {
  const value = isPlainObject(request) ? request : {};
  const text = safeString(value.text).trim();

  return {
    text,
    options: {
      forward: value.forward !== false,
      findNext: value.findNext === true,
      matchCase: value.matchCase === true,
    },
  };
}

function normalizeStopFindInPageAction(
  action: unknown,
): "clearSelection" | "keepSelection" | "activateSelection" {
  if (
    action === "clearSelection" ||
    action === "keepSelection" ||
    action === "activateSelection"
  ) {
    return action;
  }

  return "clearSelection";
}

ipcMain.handle("find-in-page:start", (event, request: unknown) => {
  const { text, options } = normalizeFindInPageRequest(request);

  if (!text) {
    event.sender.stopFindInPage("clearSelection");
    return { requestId: 0 };
  }

  return {
    requestId: event.sender.findInPage(text, options),
  };
});

ipcMain.handle("find-in-page:stop", (event, action: unknown) => {
  event.sender.stopFindInPage(normalizeStopFindInPageAction(action));
});

ipcMain.handle("attachments:clipboard-file-paths", async () =>
  readClipboardFilePaths(),
);

ipcMain.on("attachments:clipboard-file-paths-sync", (event) => {
  event.returnValue = readClipboardFilePathsSync();
});

ipcMain.handle("attachments:cleanup-message-workspace", async (_event, request: unknown) =>
  cleanupChatMessageWorkspace(request),
);

ipcMain.handle("attachments:pick", async () => {
  const browserWindow =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options: OpenDialogOptions = {
    properties: ["openFile", "multiSelections"],
  };
  const result = browserWindow
    ? await dialog.showOpenDialog(browserWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled) return [];

  return result.filePaths.map((filePath) => ({
    name: path.basename(filePath),
    path: filePath,
  }));
});

ipcMain.handle("attachments:process", async (_event, request: unknown) => {
  await ensureStorageDirectories();
  const inputs = normalizeAttachmentInputs(request);
  const state: AttachmentProcessState = {
    warnings: [],
    totalExtractedChars: 0,
    totalEntries: 0,
    totalExtractedBytes: 0,
  };

  if (inputs.length > ATTACHMENT_LIMITS.maxFilesPerMessage) {
    pushWarning(
      state,
      `Only the first ${ATTACHMENT_LIMITS.maxFilesPerMessage} files were processed.`,
    );
  }

  const attachments: ChatAttachment[] = [];
  for (const input of inputs.slice(0, ATTACHMENT_LIMITS.maxFilesPerMessage)) {
    try {
      attachments.push(await processAttachmentInput(input, state));
    } catch (error) {
      attachments.push(
        makeAttachmentError({
          name: input.name,
          sizeBytes: 0,
          error: getErrorMessage(error),
        }),
      );
    }
  }

  return {
    attachments,
    totalExtractedChars: state.totalExtractedChars,
    warnings: state.warnings,
  };
});

ipcMain.handle(
  "attachments:read-data-url",
  async (_event, request: unknown) => {
    if (!isPlainObject(request) || typeof request.storagePath !== "string") {
      throw new Error("Attachment storage path is required.");
    }

    const resolvedStoragePath = normalizeManagedFilePath(request.storagePath);
    if (!resolvedStoragePath) {
      throw new Error("Attachment path is outside managed app storage.");
    }

    const buffer = await fs.readFile(resolvedStoragePath);
    const mimeType =
      typeof request.mimeType === "string"
        ? request.mimeType
        : inferMimeType(resolvedStoragePath);
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  },
);


ipcMain.handle(
  "attachments:delete-unused",
  async (_event, request: unknown) => {
    await ensureStorageDirectories();
    const candidates = collectAttachmentDeleteCandidates(request);
    return cleanupUnreferencedAttachmentStoragePaths(candidates);
  },
);

ipcMain.handle(
  "attachments:delete-temporary",
  async (_event, request: unknown) => {
    await ensureStorageDirectories();
    const candidates = collectAttachmentDeleteCandidates(request);
    return deleteTemporaryAttachmentStoragePaths(candidates);
  },
);

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
  return readJsonFileWithRecovery<unknown>(getStoragePaths().providers, undefined);
});

ipcMain.handle(
  "storage:providers-state:save",
  async (_event, value: unknown) => {
    // Guard against wiping providers with an empty payload. The renderer only
    // ever sends a populated ProvidersState; null/undefined here means
    // something went wrong upstream, so refuse rather than clobber the file.
    if (value === null || value === undefined) {
      console.warn(
        "[storage] Ignoring providers-state save with empty value to avoid data loss.",
      );
      return;
    }
    await queueStorageWrite(async () => {
      await initializeJsonStorageIfNeeded();
      await writeJsonAtomic(getStoragePaths().providers, value, {
        backup: true,
      });
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

ipcMain.handle(
  "storage:tools-settings:save",
  async (_event, value: unknown) => {
    await writeSettingsPatch({ toolsSettings: normalizeToolsSettings(value) });
  },
);

ipcMain.handle("storage:skills-settings:load", async () => {
  await initializeJsonStorageIfNeeded();
  const settings = await readSettingsFile();
  return normalizeSkillsSettings(settings.skillsSettings);
});

ipcMain.handle(
  "storage:skills-settings:save",
  async (_event, value: unknown) => {
    await writeSettingsPatch({
      skillsSettings: normalizeSkillsSettings(value),
    });
  },
);

ipcMain.handle("storage:agents-settings:load", async () => {
  await initializeJsonStorageIfNeeded();
  const settings = await readSettingsFile();
  return normalizeAgentsSettings(settings.agentsSettings);
});

ipcMain.handle(
  "storage:agents-settings:save",
  async (_event, value: unknown) => {
    await writeSettingsPatch({
      agentsSettings: normalizeAgentsSettings(value),
    });
  },
);

ipcMain.handle("storage:app-settings:load", async () => {
  await initializeJsonStorageIfNeeded();
  const settings = await readSettingsFile();
  return normalizeAppSettings(settings.appSettings);
});

ipcMain.handle("storage:app-settings:save", async (_event, value: unknown) => {
  await writeSettingsPatch({ appSettings: normalizeAppSettings(value) });
});

ipcMain.handle("storage:mcp-settings:load", async () => {
  await initializeJsonStorageIfNeeded();
  const settings = await readSettingsFile();
  return normalizeMcpSettings(settings.mcpSettings);
});

ipcMain.handle("storage:mcp-settings:save", async (_event, value: unknown) => {
  await writeSettingsPatch({ mcpSettings: normalizeMcpSettings(value) });
});

ipcMain.handle("storage:modes-state:load", async () => {
  await initializeJsonStorageIfNeeded();
  const settings = await readSettingsFile();
  return settings.modesState;
});

ipcMain.handle("storage:modes-state:save", async (_event, value: unknown) => {
  await writeSettingsPatch({ modesState: value });
});

ipcMain.handle("storage:tools:load", async () => loadJsonTools());

ipcMain.handle("storage:tool:save", async (_event, value: unknown) =>
  saveJsonTool(value),
);

ipcMain.handle("storage:tool:delete", async (_event, toolId: unknown) =>
  deleteJsonTool(toolId),
);

ipcMain.handle("storage:tools:import", async () => importJsonToolsFromFiles());

ipcMain.handle("storage:tool:export", async (_event, tool: unknown) =>
  exportJsonToolToFile(tool),
);

ipcMain.handle("storage:tools:export", async (_event, tools: unknown) =>
  exportJsonToolsToFolder(tools),
);

ipcMain.handle("storage:tools:open-folder", async () => openJsonToolsFolder());

ipcMain.handle("storage:skills:load", async (_event, request: unknown) => loadJsonSkills(request));

ipcMain.handle(
  "storage:skill:save",
  async (_event, value: unknown, previousName: unknown) =>
    saveJsonSkill(value, previousName),
);

ipcMain.handle("storage:skill:delete", async (_event, skillName: unknown) =>
  deleteJsonSkill(skillName),
);

ipcMain.handle("storage:skills:import", async () =>
  importJsonSkillsFromFiles(),
);

ipcMain.handle("storage:skill:export", async (_event, skill: unknown) =>
  exportJsonSkillToFile(skill),
);

ipcMain.handle("storage:skills:export", async (_event, skills: unknown) =>
  exportJsonSkillsToFolder(skills),
);

ipcMain.handle("storage:skills:open-folder", async () =>
  openJsonSkillsFolder(),
);

ipcMain.handle("storage:agents:load", async () => loadJsonAgents());

ipcMain.handle("storage:agent:save", async (_event, value: unknown) =>
  saveJsonAgent(value),
);

ipcMain.handle("storage:agent:delete", async (_event, agentId: unknown) =>
  deleteJsonAgent(agentId),
);

ipcMain.handle("storage:agents:import", async () =>
  importJsonAgentsFromFiles(),
);

ipcMain.handle("storage:agent:export", async (_event, agent: unknown) =>
  exportJsonAgentToFile(agent),
);

ipcMain.handle("storage:agents:export", async (_event, agents: unknown) =>
  exportJsonAgentsToFolder(agents),
);

ipcMain.handle("storage:agents:open-folder", async () =>
  openJsonAgentsFolder(),
);

ipcMain.handle("tools:execute-stream", async (event, request: unknown) => {
  const value = isPlainObject(request) ? request : {};
  const executionId = safeString(value.executionId).trim() || randomUUID();
  const controller = new AbortController();

  activeToolExecutions.set(executionId, {
    cancel: () => controller.abort(),
  });

  try {
    const toolName = safeString(value.name).trim();
    if (toolName !== BASH_TOOL_NAME) {
      throw new Error(`Streaming execution is not supported for tool: ${toolName}`);
    }

    return await executePiTool(
      toolName,
      value.args,
      {
        workspaceRoots: normalizeWorkspaceRoots(value.workspaceRoots),
        signal: controller.signal,
        timeoutMs: normalizeOptionalTimeoutMs(value.timeoutMs),
      },
      (streamEvent) => {
        event.sender.send("tools:stream-event", {
          executionId,
          ...streamEvent,
        });
      },
    );
  } finally {
    activeToolExecutions.delete(executionId);
  }
});

ipcMain.handle("tools:execute", async (_event, request: unknown) => {
  const value = isPlainObject(request) ? request : {};
  const executionId = safeString(value.executionId).trim();
  const controller = new AbortController();

  if (executionId) {
    activeToolExecutions.set(executionId, {
      cancel: () => controller.abort(),
    });
  }

  try {
    return await executeToolManifest(value.name, value.args, {
      workspaceRoots: normalizeWorkspaceRoots(value.workspaceRoots),
      signal: controller.signal,
      timeoutMs: normalizeOptionalTimeoutMs(value.timeoutMs),
    });
  } finally {
    if (executionId) activeToolExecutions.delete(executionId);
  }
});

ipcMain.handle("tools:cancel", async (_event, executionId: unknown) => {
  const key = safeString(executionId).trim();
  if (!key) return { cancelled: false };
  const execution = activeToolExecutions.get(key);
  if (!execution) return { cancelled: false };

  execution.cancel();
  activeToolExecutions.delete(key);
  return { cancelled: true };
});

ipcMain.handle("mcp:refresh-tools", async (_event, request: unknown) => {
  const value = isPlainObject(request) ? request : {};
  const settings = normalizeMcpSettings(value.settings);
  const serverId = safeString(value.serverId).trim() || undefined;
  return refreshMcpTools(settings, serverId);
});

ipcMain.handle("mcp:test-server", async (_event, request: unknown) => {
  const value = isPlainObject(request) ? request : {};
  const settings = normalizeMcpSettings({ enabled: true, servers: [value.server] });
  const server = settings.servers[0];
  if (!server) throw new Error("MCP server is required.");
  return testMcpServer(server);
});

ipcMain.handle("mcp:execute-tool", async (_event, request: unknown) => {
  const value = isPlainObject(request) ? request : {};
  const executionId = safeString(value.executionId).trim();
  const controller = new AbortController();

  if (executionId) {
    activeToolExecutions.set(executionId, {
      cancel: () => controller.abort(),
    });
  }

  try {
    await initializeJsonStorageIfNeeded();
    const settingsFile = await readSettingsFile();
    const settings = normalizeMcpSettings(settingsFile.mcpSettings);
    const tool = isPlainObject(value.tool) ? value.tool : {};
    const toolName = safeString(tool.name).trim() || safeString(value.name).trim();
    if (!toolName) throw new Error("MCP tool name is required.");

    return await executeMcpTool({
      settings,
      toolName,
      args: value.args,
      signal: controller.signal,
    });
  } finally {
    if (executionId) activeToolExecutions.delete(executionId);
  }
});

ipcMain.handle("mcp:cancel", async (_event, executionId: unknown) => {
  const key = safeString(executionId).trim();
  if (!key) return { cancelled: false };
  const execution = activeToolExecutions.get(key);
  if (!execution) return { cancelled: false };

  execution.cancel();
  activeToolExecutions.delete(key);
  return { cancelled: true };
});

ipcMain.handle("workspace:select-folder", async () => selectWorkspaceFolder());

ipcMain.handle("workspace:open-folder", async (_event, folderPath: unknown) =>
  openWorkspaceFolder(folderPath),
);

ipcMain.handle("tools:test", async (_event, request: unknown) => {
  const value = isPlainObject(request) ? request : {};
  const tool = normalizeToolDefinition(value.tool);
  const result = await runCommandTool(tool, value.args);
  return {
    toolName: tool.name,
    content: buildModelToolResultContent(result, tool.timeoutMs),
    isError: result.timedOut || result.exitCode !== 0,
    ...result,
  };
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

  if (!isPlainObject(payload)) {
    throw new Error("Provider request payload is required.");
  }

  return runChatCompletion({
    baseURL: normalizeBaseUrl(baseUrl),
    headers: buildUpstreamHeaderRecord({ apiKey, customHeaders, headers }),
    payload,
  });
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

    if (!isPlainObject(payload)) {
      throw new Error("Provider request payload is required.");
    }

    const controller = new AbortController();
    activeStreamControllers.set(streamId, controller);

    const forwardEvent = (streamEvent: AdapterStreamEvent) => {
      event.sender.send(`ai:stream-delta:${streamId}`, streamEvent);
    };

    try {
      return await streamChatCompletion({
        baseURL: normalizeBaseUrl(baseUrl),
        headers: buildUpstreamHeaderRecord({ apiKey, customHeaders, headers }),
        payload,
        signal: controller.signal,
        onEvent: forwardEvent,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          finishReason: "cancelled",
          content: "",
          reasoning: "",
          toolCalls: [],
        };
      }

      throw error;
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

