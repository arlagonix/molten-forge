import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync, promises as fs } from "node:fs";
import { isIP } from "node:net";
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
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type StreamResult = {
  usage?: ChatTokenUsage;
  finishReason?: string;
  content?: string;
  reasoning?: string;
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
};

type PublicToolDefinition = ToolDefinition;

type SkillDefinition = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  instructions: string;
  recommendedToolNames: string[];
};

type PublicSkillDefinition = SkillDefinition;

type ToolsSettings = {
  enabled: boolean;
  askUserEnabled: boolean;
  checklistWriteEnabled: boolean;
  loadSkillEnabled: boolean;
  webFetchEnabled: boolean;
};

type SkillsSettings = {
  enabled: boolean;
};

type AppSettings = {
  chatTitleGenerationMode: "local" | "ai";
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
  checklistWriteEnabled: true,
  loadSkillEnabled: true,
  webFetchEnabled: false,
};
const DEFAULT_SKILLS_SETTINGS: SkillsSettings = {
  enabled: true,
};
const DEFAULT_APP_SETTINGS: AppSettings = {
  chatTitleGenerationMode: "local",
};
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const WEB_FETCH_TOOL_NAME = "web_fetch";
const WEB_FETCH_TIMEOUT_MS = 15_000;
const WEB_FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const WEB_FETCH_MAX_RETURN_CHARS = 20_000;
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
    askUserEnabled:
      typeof value.askUserEnabled === "boolean" ? value.askUserEnabled : true,
    checklistWriteEnabled:
      typeof value.checklistWriteEnabled === "boolean"
        ? value.checklistWriteEnabled
        : true,
    loadSkillEnabled:
      typeof value.loadSkillEnabled === "boolean"
        ? value.loadSkillEnabled
        : true,
    webFetchEnabled:
      typeof value.webFetchEnabled === "boolean"
        ? value.webFetchEnabled
        : false,
  };
}

function normalizeSkillsSettings(value: unknown): SkillsSettings {
  if (!isPlainObject(value)) return DEFAULT_SKILLS_SETTINGS;

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
  };
}

function normalizeAppSettings(value: unknown): AppSettings {
  if (!isPlainObject(value)) return DEFAULT_APP_SETTINGS;

  return {
    chatTitleGenerationMode:
      value.chatTitleGenerationMode === "ai" ? "ai" : "local",
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
  const id =
    safeString(source.id).trim() ||
    `skill-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const name = safeString(source.name).trim();
  const description = safeString(source.description).trim();
  const instructions = safeString(source.instructions).trim();

  return {
    id,
    name,
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    description,
    instructions,
    recommendedToolNames: safeStringArray(source.recommendedToolNames)
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function validateSkillDefinition(skill: SkillDefinition) {
  if (!skill.name) throw new Error("Skill name is required.");
  if (!TOOL_NAME_PATTERN.test(skill.name)) {
    throw new Error(
      "Skill name must use only letters, numbers, underscores, or hyphens.",
    );
  }
  if (skill.name === "load_skill") {
    throw new Error(
      "load_skill is a built-in tool name and cannot be used by a skill.",
    );
  }
  if (!skill.description) throw new Error("Skill description is required.");
  if (!skill.instructions) throw new Error("Skill instructions are required.");
}

function toPublicSkill(skill: SkillDefinition): PublicSkillDefinition {
  return skill;
}

function stringifyToolResult(result: unknown) {
  if (typeof result === "string") return result;

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
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
): Promise<CommandExecutionResult> {
  validateToolDefinition(tool);
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
    });

    const finish = (result: CommandExecutionResult) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, execution });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish({
        exitCode: null,
        stdout,
        stderr:
          stderr ||
          `Timed out after ${Math.round(tool.timeoutMs / 1000)} seconds.`,
        timedOut: true,
      });
    }, tool.timeoutMs);

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
      throw new Error("web_fetch blocks local, private, and reserved IP addresses.");
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`web_fetch could not resolve host ${hostname}: ${getErrorMessage(error)}`);
  }

  if (!addresses.length) throw new Error(`web_fetch could not resolve host ${hostname}.`);

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

async function readResponseTextWithLimit(response: Response) {
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

  while (true) {
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

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function fetchWebUrl(startUrl: URL) {
  let currentUrl = new URL(startUrl.toString());
  currentUrl.hash = "";

  for (let redirectCount = 0; redirectCount <= WEB_FETCH_MAX_REDIRECTS; redirectCount += 1) {
    await assertFetchablePublicUrl(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);

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
        throw new Error(
          `web_fetch timed out after ${Math.round(WEB_FETCH_TIMEOUT_MS / 1000)} seconds.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`web_fetch redirect from ${currentUrl} had no Location header.`);
      currentUrl = new URL(location, currentUrl);
      currentUrl.hash = "";
      continue;
    }

    if (!response.ok) {
      throw new Error(`web_fetch received HTTP ${response.status} from ${currentUrl}.`);
    }

    const contentType = normalizeContentType(response.headers.get("content-type"));
    if (!isAllowedWebFetchContentType(contentType)) {
      throw new Error(
        `web_fetch cannot read content type ${contentType || "unknown"}.`,
      );
    }

    const text = await readResponseTextWithLimit(response);
    return {
      finalUrl: currentUrl.toString(),
      contentType,
      text,
    };
  }

  throw new Error(`web_fetch followed too many redirects. Maximum is ${WEB_FETCH_MAX_REDIRECTS}.`);
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
    .replace(/&([a-z]+);/gi, (match, name: string) => namedEntities[name.toLowerCase()] ?? match);
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

function findNextSectionEnd(html: string, startIndex: number, headingLevel: number) {
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

async function executeWebFetchTool(args: unknown): Promise<ToolCommandResult> {
  const { url: rawUrl } = parseWebFetchArgs(args);
  const requestedUrl = parseWebFetchUrl(rawUrl);
  const requestedFragment = requestedUrl.hash
    ? decodeUrlComponentSafely(requestedUrl.hash.slice(1))
    : "";

  const fetched = await fetchWebUrl(requestedUrl);
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

async function executeToolManifest(name: unknown, args: unknown) {
  const toolName = typeof name === "string" ? name.trim() : "";
  if (!toolName) throw new Error("Tool name is required.");

  if (toolName === WEB_FETCH_TOOL_NAME) {
    return executeWebFetchTool(args);
  }

  const tools = await loadJsonTools();
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`Tool is not configured: ${toolName}`);

  const result = await runCommandTool(tool, args);
  const content = buildModelToolResultContent(result, tool.timeoutMs);

  return {
    toolName,
    content,
    isError: result.timedOut || result.exitCode !== 0,
    ...result,
  };
}

function copyObjectFields(
  source: Record<string, unknown>,
  ignoredKeys: string[] = [],
): Record<string, unknown> {
  const ignored = new Set(ignoredKeys);
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !ignored.has(key)),
  );
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
        ...copyObjectFields(item, ["function", "index"]),
        id,
        type: "function",
        function: {
          ...copyObjectFields(fn ?? {}, ["name", "arguments"]),
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
  return normalizeToolCallFromChoice(
    "tool_calls" in message ? message.tool_calls : undefined,
  );
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
    const index =
      typeof rawCall.index === "number" ? rawCall.index : current.size;
    const existing = current.get(index) ?? {
      id: "",
      type: "function" as const,
      function: { name: "", arguments: "" },
    };
    const fn = isPlainObject(rawCall.function) ? rawCall.function : undefined;

    current.set(index, {
      ...existing,
      ...copyObjectFields(rawCall, ["function", "index"]),
      id:
        typeof rawCall.id === "string" && rawCall.id ? rawCall.id : existing.id,
      type: "function",
      function: {
        ...existing.function,
        ...copyObjectFields(fn ?? {}, ["name", "arguments"]),
        name:
          typeof fn?.name === "string" && fn.name
            ? fn.name
            : existing.function.name,
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

type JsonRecord = Record<string, unknown>;

type StorageSnapshot = {
  providersState?: unknown;
  systemPrompt?: unknown;
  activeChatId?: unknown;
  providerModelsCache?: Record<string, unknown>;
  appSettings?: unknown;
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
  await fs.mkdir(paths.toolsDir, { recursive: true });
  await fs.mkdir(paths.skillsDir, { recursive: true });
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
    skillsSettings: DEFAULT_SKILLS_SETTINGS,
    appSettings: DEFAULT_APP_SETTINGS,
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
      skillsSettings: DEFAULT_SKILLS_SETTINGS,
      appSettings: normalizeAppSettings(snapshot.appSettings),
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
    tool.name === "load_skill" ||
    tool.name === WEB_FETCH_TOOL_NAME
  ) {
    throw new Error(
      `${tool.name} is a built-in tool name and cannot be imported as a custom command tool.`,
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

type SkillFileRecord = {
  skill: SkillDefinition;
  filePath: string;
  fileName: string;
};

function legacySkillFilePath(skillId: string) {
  return path.join(
    getStoragePaths().skillsDir,
    `${sanitizeFileNamePart(skillId)}.json`,
  );
}

function readableSkillFilePath(skill: Pick<SkillDefinition, "id" | "name">) {
  const fileNameBase = skill.name || skill.id || "skill";
  return path.join(
    getStoragePaths().skillsDir,
    `${sanitizeFileNamePart(fileNameBase)}.json`,
  );
}

async function readSkillFileRecords() {
  await fs.mkdir(getStoragePaths().skillsDir, { recursive: true });
  const entries = await fs.readdir(getStoragePaths().skillsDir, {
    withFileTypes: true,
  });
  const records: SkillFileRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const filePath = path.join(getStoragePaths().skillsDir, entry.name);
    const raw = await readJsonFile<unknown>(filePath, undefined);
    const skill = normalizeSkillDefinition(raw);

    try {
      validateSkillDefinition(skill);
      records.push({ skill, filePath, fileName: entry.name });
    } catch (error) {
      console.error(`Invalid skill manifest ${entry.name}:`, error);
    }
  }

  return records;
}

async function migrateReadableSkillFileNames(records: SkillFileRecord[]) {
  const usedFileNames = new Set(records.map((record) => record.fileName));

  for (const record of records) {
    const preferredBase = sanitizeFileNamePart(
      record.skill.name || record.skill.id || "skill",
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
      getStoragePaths().skillsDir,
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
        `Failed to rename skill manifest ${record.fileName}:`,
        error,
      );
    }
  }
}

async function deleteSkillFilesById(skillId: string, exceptFilePath?: string) {
  const normalizedExcept = exceptFilePath
    ? path.resolve(exceptFilePath)
    : undefined;
  const records = await readSkillFileRecords();
  const candidates = new Set<string>();

  for (const record of records) {
    if (record.skill.id === skillId) candidates.add(record.filePath);
  }

  candidates.add(legacySkillFilePath(skillId));

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

async function loadJsonSkills() {
  await initializeJsonStorageIfNeeded();
  const records = await readSkillFileRecords();
  await migrateReadableSkillFileNames(records);

  const skills = records.map((record) => record.skill);
  skills.sort((left, right) => left.name.localeCompare(right.name));
  return skills.map(toPublicSkill);
}

async function saveJsonSkill(value: unknown) {
  const skill = normalizeSkillDefinition(value);
  validateSkillDefinition(skill);

  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    const existingSkills = await loadJsonSkills();
    const duplicate = existingSkills.find(
      (candidate) => candidate.id !== skill.id && candidate.name === skill.name,
    );
    if (duplicate)
      throw new Error(`Another skill already uses the name: ${skill.name}`);

    const targetPath = readableSkillFilePath(skill);
    await writeJsonAtomic(targetPath, skill);
    await deleteSkillFilesById(skill.id, targetPath);
  });

  return skill;
}

async function deleteJsonSkill(skillId: unknown) {
  const id = safeString(skillId).trim();
  if (!id) return;

  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    await deleteSkillFilesById(id);
  });
}

function createEmptySkillImportResult(cancelled: boolean): SkillImportResult {
  return {
    cancelled,
    imported: 0,
    updated: 0,
    skipped: [],
    invalid: [],
    renamed: [],
  };
}

function createUniqueImportedSkillName(
  baseName: string,
  existingByName: Map<string, PublicSkillDefinition>,
) {
  let index = 1;
  let candidate = `${baseName}_${index}`;

  while (existingByName.has(candidate)) {
    index += 1;
    candidate = `${baseName}_${index}`;
  }

  return candidate;
}

function areSkillDefinitionsEquivalent(
  left: PublicSkillDefinition,
  right: SkillDefinition,
) {
  return (
    JSON.stringify({ ...left, id: undefined }) ===
    JSON.stringify({ ...right, id: undefined })
  );
}

async function importJsonSkillsFromFiles(): Promise<SkillImportResult> {
  await initializeJsonStorageIfNeeded();
  await fs.mkdir(getStoragePaths().skillsDir, { recursive: true });

  const openOptions = {
    title: "Import skills",
    properties: ["openFile", "multiSelections"] as Array<
      "openFile" | "multiSelections"
    >,
    filters: [{ name: "JSON files", extensions: ["json"] }],
  };
  const result = win
    ? await dialog.showOpenDialog(win, openOptions)
    : await dialog.showOpenDialog(openOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return createEmptySkillImportResult(true);
  }

  const importResult = createEmptySkillImportResult(false);
  const parsedSkills: Array<{ source: string; skill: SkillDefinition }> = [];

  for (const filePath of result.filePaths) {
    const source = path.basename(filePath);
    try {
      const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
      const skill = normalizeSkillDefinition(raw);
      validateSkillDefinition(skill);
      parsedSkills.push({ source, skill });
    } catch (error) {
      importResult.invalid.push({ source, message: getErrorMessage(error) });
    }
  }

  if (parsedSkills.length === 0) return importResult;

  await queueStorageWrite(async () => {
    await initializeJsonStorageIfNeeded();
    await fs.mkdir(getStoragePaths().skillsDir, { recursive: true });

    const existingSkills = await loadJsonSkills();
    const existingById = new Map(
      existingSkills.map((skill) => [skill.id, skill]),
    );
    const existingByName = new Map(
      existingSkills.map((skill) => [skill.name, skill]),
    );

    for (const { source, skill } of parsedSkills) {
      const sameIdSkill = existingById.get(skill.id);
      const sameNameSkill = existingByName.get(skill.name);
      let skillToSave = skill;

      if (sameNameSkill && sameNameSkill.id !== skill.id) {
        if (areSkillDefinitionsEquivalent(sameNameSkill, skill)) {
          importResult.skipped.push({
            source,
            skillName: skill.name,
            message: `A matching skill already exists: ${skill.name}`,
          });
          continue;
        }

        const renamedSkill = {
          ...skill,
          name: createUniqueImportedSkillName(skill.name, existingByName),
        };
        skillToSave = renamedSkill;
        importResult.renamed.push({
          source,
          skillName: renamedSkill.name,
          message: `Renamed ${skill.name} to ${renamedSkill.name} because the original name already exists with different settings.`,
        });
      }

      const targetPath = readableSkillFilePath(skillToSave);
      await writeJsonAtomic(targetPath, skillToSave);
      await deleteSkillFilesById(skillToSave.id, targetPath);

      if (sameIdSkill) {
        importResult.updated += 1;
        existingByName.delete(sameIdSkill.name);
      } else {
        importResult.imported += 1;
      }

      existingById.set(skillToSave.id, skillToSave);
      existingByName.set(skillToSave.name, skillToSave);
    }
  });

  return importResult;
}

function skillExportFileName(skill: SkillDefinition, usedNames: Set<string>) {
  const base = sanitizeFileNamePart(skill.name || skill.id || "skill");
  let candidate = `${base}.json`;
  let index = 1;

  while (usedNames.has(candidate)) {
    candidate = `${base} (${index}).json`;
    index += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function normalizeExportSkills(value: unknown): SkillDefinition[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => {
    const skill = normalizeSkillDefinition(item);
    validateSkillDefinition(skill);
    return skill;
  });
}

async function exportJsonSkillToFile(
  value: unknown,
): Promise<SkillExportResult> {
  const skills = normalizeExportSkills(value);
  const skill = skills[0];
  if (!skill) throw new Error("No skill to export.");

  const saveOptions = {
    title: "Export skill",
    defaultPath: `${sanitizeFileNamePart(skill.name || skill.id || "skill")}.json`,
    filters: [{ name: "JSON files", extensions: ["json"] }],
  };
  const result = win
    ? await dialog.showSaveDialog(win, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (result.canceled || !result.filePath) {
    return { cancelled: true, exported: 0 };
  }

  const filePath = ensureJsonExtension(result.filePath);
  await writeJsonAtomic(filePath, skill);

  return { cancelled: false, exported: 1, path: filePath };
}

async function exportJsonSkillsToFolder(
  value: unknown,
): Promise<SkillExportResult> {
  const skills = normalizeExportSkills(value);
  if (skills.length === 0) throw new Error("No skills to export.");

  const openOptions = {
    title: "Export skills to folder",
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
  for (const skill of skills) {
    const fileName = skillExportFileName(skill, usedNames);
    await writeJsonAtomic(path.join(folderPath, fileName), skill);
  }

  return { cancelled: false, exported: skills.length, path: folderPath };
}

async function openJsonSkillsFolder() {
  await initializeJsonStorageIfNeeded();
  await fs.mkdir(getStoragePaths().skillsDir, { recursive: true });

  const error = await shell.openPath(getStoragePaths().skillsDir);
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

ipcMain.handle("storage:app-settings:load", async () => {
  await initializeJsonStorageIfNeeded();
  const settings = await readSettingsFile();
  return normalizeAppSettings(settings.appSettings);
});

ipcMain.handle("storage:app-settings:save", async (_event, value: unknown) => {
  await writeSettingsPatch({ appSettings: normalizeAppSettings(value) });
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

ipcMain.handle("storage:skills:load", async () => loadJsonSkills());

ipcMain.handle("storage:skill:save", async (_event, value: unknown) =>
  saveJsonSkill(value),
);

ipcMain.handle("storage:skill:delete", async (_event, skillId: unknown) =>
  deleteJsonSkill(skillId),
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

ipcMain.handle("tools:execute", async (_event, request: unknown) => {
  const value = isPlainObject(request) ? request : {};
  return executeToolManifest(value.name, value.args);
});

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
        toolCalls: [...streamedToolCalls.values()].filter(
          (toolCall) => toolCall.id && toolCall.function.name,
        ),
      };
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          usage,
          finishReason: finishReason ?? "cancelled",
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
