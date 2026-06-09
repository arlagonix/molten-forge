import { PassThrough } from "node:stream";
import tls from "node:tls";
import { app } from "electron";
import { stringifyToolResult } from "./tool-utils";

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

export type McpLoadedTool = {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  command: string;
  args: string[];
  input: "none";
  timeoutMs: number;
  requiresApproval?: boolean;
  source: "mcp";
  displayName: string;
  mcp: {
    serverId: string;
    serverName: string;
    originalToolName: string;
    exposedName: string;
    transport: McpTransportType;
  };
};

export type McpSdkClient = {
  connect: (transport: unknown, options?: unknown) => Promise<void>;
  close: () => Promise<void>;
  listTools: (request?: unknown, options?: unknown) => Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }>;
  callTool: (request: unknown, resultSchema?: unknown, options?: unknown) => Promise<unknown>;
};

type McpTransport = {
  close?: () => Promise<void>;
  stderr?: import("node:stream").Stream | null;
};

type McpSdkModule = {
  Client: new (...args: unknown[]) => McpSdkClient;
  StdioClientTransport: new (...args: unknown[]) => McpTransport;
  StreamableHTTPClientTransport: new (...args: unknown[]) => McpTransport;
  SSEClientTransport: new (...args: unknown[]) => McpTransport;
  getDefaultEnvironment: () => Record<string, string>;
};

type McpToolCommandResult = {
  toolName?: string;
  content: string;
  isError?: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const DEFAULT_MCP_TIMEOUT_MS = 60_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;

  const entries = Object.entries(value)
    .map(([key, rawValue]) => [key.trim(), typeof rawValue === "string" ? rawValue : ""] as const)
    .filter(([key, rawValue]) => key && rawValue.length > 0);

  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function sanitizeMcpToolNamePart(value: string, fallback: string) {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 48);

  return normalized || fallback;
}

export function createMcpExposedToolName(serverName: string, toolName: string) {
  const serverPart = sanitizeMcpToolNamePart(serverName, "server");
  const toolPart = sanitizeMcpToolNamePart(toolName, "tool");
  return `mcp_${serverPart}_${toolPart}`.slice(0, 64);
}

function uniqueMcpExposedToolName(
  preferredName: string,
  serverName: string,
  toolName: string,
  usedNames: Set<string>,
) {
  const baseName = TOOL_NAME_PATTERN.test(preferredName)
    ? preferredName
    : createMcpExposedToolName(serverName, toolName);
  const clippedBase = baseName.slice(0, 64);

  if (TOOL_NAME_PATTERN.test(clippedBase) && !usedNames.has(clippedBase)) {
    usedNames.add(clippedBase);
    return clippedBase;
  }

  for (let index = 2; index < 1000; index += 1) {
    const suffix = `_${index}`;
    const candidate = `${clippedBase.slice(0, 64 - suffix.length)}${suffix}`;
    if (TOOL_NAME_PATTERN.test(candidate) && !usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }

  throw new Error(`Could not create a unique MCP tool name for ${serverName}/${toolName}.`);
}

function schemaAsObject(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) {
    return {
      ...value,
      type: "object",
      properties: isPlainObject(value.properties) ? value.properties : {},
    };
  }

  return { type: "object", properties: {}, additionalProperties: false };
}

export function normalizeMcpSettings(value: unknown): McpSettings {
  const source = isPlainObject(value) ? value : {};
  const rawServers = Array.isArray(source.servers) ? source.servers : [];

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    servers: rawServers
      .filter(isPlainObject)
      .map((server) => {
        const id = safeString(server.id).trim() || `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const name = safeString(server.name).trim() || id;
        const rawTools = isPlainObject(server.tools) ? server.tools : {};
        const tools = Object.fromEntries(
          Object.entries(rawTools)
            .filter(([, tool]) => isPlainObject(tool))
            .map(([fallbackName, rawTool]) => {
              const tool = rawTool as Record<string, unknown>;
              const originalName = safeString(tool.originalName).trim() || fallbackName;
              const inputSchema = schemaAsObject(tool.inputSchema);
              const description = safeString(tool.description).trim();

              return [
                originalName,
                {
                  originalName,
                  exposedName: safeString(tool.exposedName).trim(),
                  enabled: typeof tool.enabled === "boolean" ? tool.enabled : false,
                  ...(description ? { description } : {}),
                  inputSchema,
                  ...(typeof tool.requireApproval === "boolean" ? { requireApproval: tool.requireApproval } : {}),
                  ...(typeof tool.lastSeenAt === "string" ? { lastSeenAt: tool.lastSeenAt } : {}),
                } satisfies McpToolConfig,
              ];
            }),
        );

        return {
          id,
          name,
          enabled: typeof server.enabled === "boolean" ? server.enabled : true,
          transport: server.transport === "http" ? "http" : "stdio",
          command: safeString(server.command).trim() || undefined,
          args: safeStringArray(server.args),
          cwd: safeString(server.cwd).trim() || undefined,
          env: normalizeStringRecord(server.env),
          url: safeString(server.url).trim() || undefined,
          headers: normalizeStringRecord(server.headers),
          insecureSkipTlsVerify:
            typeof server.insecureSkipTlsVerify === "boolean"
              ? server.insecureSkipTlsVerify
              : false,
          timeoutMs:
            typeof server.timeoutMs === "number" &&
            Number.isFinite(server.timeoutMs) &&
            server.timeoutMs > 0
              ? Math.min(Math.round(server.timeoutMs), 10 * 60_000)
              : DEFAULT_MCP_TIMEOUT_MS,
          requireApproval:
            typeof server.requireApproval === "boolean" ? server.requireApproval : true,
          tools,
          lastError: safeString(server.lastError).trim() || undefined,
          lastConnectedAt: safeString(server.lastConnectedAt).trim() || undefined,
        } satisfies McpServerConfig;
      }),
  };
}

export function buildLoadedMcpTools(settings: McpSettings): McpLoadedTool[] {
  const normalized = normalizeMcpSettings(settings);
  if (!normalized.enabled) return [];

  const tools: McpLoadedTool[] = [];
  const usedNames = new Set<string>();

  for (const server of normalized.servers) {
    if (!server.enabled) continue;

    for (const tool of Object.values(server.tools ?? {})) {
      if (!tool.enabled) continue;
      const exposedName = uniqueMcpExposedToolName(
        tool.exposedName,
        server.name,
        tool.originalName,
        usedNames,
      );
      const description = tool.description?.trim() || `MCP tool ${tool.originalName} from ${server.name}.`;

      tools.push({
        id: `mcp:${server.id}:${tool.originalName}`,
        name: exposedName,
        displayName: `${tool.originalName} · ${server.name}`,
        description: `[MCP: ${server.name}] ${description}`,
        parameters: schemaAsObject(tool.inputSchema),
        command: "",
        args: [],
        input: "none",
        timeoutMs: server.timeoutMs,
        requiresApproval:
          typeof tool.requireApproval === "boolean"
            ? tool.requireApproval
            : server.requireApproval,
        source: "mcp",
        mcp: {
          serverId: server.id,
          serverName: server.name,
          originalToolName: tool.originalName,
          exposedName,
          transport: server.transport,
        },
      });
    }
  }

  return tools;
}

type McpFetch = typeof fetch;

type UndiciDispatcher = {
  close?: () => Promise<void>;
  destroy?: () => void;
};

type UndiciConnectOptions = {
  rejectUnauthorized?: boolean;
  ca?: Array<string | Buffer>;
};

type UndiciModule = {
  fetch: McpFetch;
  Agent: new (options: { connect: UndiciConnectOptions }) => UndiciDispatcher;
  getGlobalDispatcher?: () => unknown;
  setGlobalDispatcher?: (dispatcher: unknown) => void;
};

/**
 * The OS trust store (incl. any corporate TLS-inspection proxy root CA),
 * merged with the bundled Mozilla roots and NODE_EXTRA_CA_CERTS.
 *
 * We must pass these to undici explicitly. undici snapshots its CA list when
 * its connector is first built (at process init), so a later
 * tls.setDefaultCACertificates() call does NOT reach the connector that the
 * MCP SDK's fetch uses. Handing the bundle to the Agent's connector is what
 * actually makes verification succeed behind a corporate proxy.
 */
let cachedCaBundle: Array<string | Buffer> | null | undefined;
function getSystemCaBundle(): Array<string | Buffer> | undefined {
  if (cachedCaBundle !== undefined) return cachedCaBundle ?? undefined;
  try {
    const tlsApi = tls as unknown as {
      getCACertificates?: (
        type: "default" | "system" | "bundled" | "extra",
      ) => string[];
    };
    if (typeof tlsApi.getCACertificates !== "function") {
      cachedCaBundle = null;
      return undefined;
    }
    const merged = Array.from(
      new Set([
        ...tlsApi.getCACertificates("default"),
        ...tlsApi.getCACertificates("system"),
      ]),
    );
    cachedCaBundle = merged.length ? merged : null;
  } catch {
    cachedCaBundle = null;
  }
  return cachedCaBundle ?? undefined;
}

/**
 * Build a fetch the MCP SDK transports will use. For HTTP servers we always
 * route through a undici Agent so we control the TLS trust decision:
 *  - insecureSkipTlsVerify -> verification disabled (explicit opt-in).
 *  - otherwise             -> verification ON, trusting system + bundled CAs.
 */
async function createHttpFetchForServer(server: McpServerConfig): Promise<{
  fetch?: McpFetch;
  insecure: boolean;
  trustsSystemCa: boolean;
  close: () => Promise<void>;
}> {
  if (server.transport !== "http") {
    return {
      insecure: false,
      trustsSystemCa: false,
      close: async () => undefined,
    };
  }

  let connect: UndiciConnectOptions;
  let insecure = false;
  let trustsSystemCa = false;

  if (server.insecureSkipTlsVerify) {
    connect = { rejectUnauthorized: false };
    insecure = true;
  } else {
    const ca = getSystemCaBundle();
    if (!ca) {
      // No extra CAs available; let the SDK use its default fetch unchanged.
      return {
        insecure: false,
        trustsSystemCa: false,
        close: async () => undefined,
      };
    }
    connect = { ca };
    trustsSystemCa = true;
  }

  const { fetch: undiciFetch, Agent } = await dynamicImport<UndiciModule>(
    "undici",
  );
  const dispatcher = new Agent({ connect });

  return {
    insecure,
    trustsSystemCa,
    fetch: ((input: Parameters<McpFetch>[0], init?: Parameters<McpFetch>[1]) =>
      undiciFetch(input, {
        ...(init ?? {}),
        dispatcher,
      } as Parameters<McpFetch>[1] & { dispatcher: unknown })) as McpFetch,
    close: async () => {
      await dispatcher.close?.().catch(() => undefined);
      dispatcher.destroy?.();
    },
  };
}

async function runWithOptionalInsecureTls<T>(
  server: McpServerConfig,
  task: () => Promise<T>,
): Promise<T> {
  if (server.transport !== "http" || !server.insecureSkipTlsVerify) {
    return task();
  }

  const undici = await dynamicImport<UndiciModule>("undici");
  const dispatcher = new undici.Agent({
    connect: { rejectUnauthorized: false },
  });
  const previousDispatcher = undici.getGlobalDispatcher?.();
  const previousRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  try {
    undici.setGlobalDispatcher?.(dispatcher);
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    return await task();
  } finally {
    if (typeof previousRejectUnauthorized === "undefined") {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousRejectUnauthorized;
    }

    if (previousDispatcher && undici.setGlobalDispatcher) {
      undici.setGlobalDispatcher(previousDispatcher);
    }

    await dispatcher.close?.().catch(() => undefined);
    dispatcher.destroy?.();
  }
}

function getRequestOptions(server: McpServerConfig, signal?: AbortSignal) {
  return {
    timeout: server.timeoutMs,
    maxTotalTimeout: server.timeoutMs,
    signal,
  };
}

function getHttpRequestInit(server: McpServerConfig): RequestInit | undefined {
  const headers = normalizeStringRecord(server.headers);
  return headers ? { headers } : undefined;
}


const dynamicImport = new Function(
  "specifier",
  "return import(specifier)",
) as <T = unknown>(specifier: string) => Promise<T>;

let sdkModulePromise: Promise<McpSdkModule> | undefined;

async function loadMcpSdk(): Promise<McpSdkModule> {
  sdkModulePromise ??= (async () => {
    try {
      const [clientModule, stdioModule, httpModule, sseModule] = await Promise.all([
        dynamicImport<{ Client: McpSdkModule["Client"] }>(
          "@modelcontextprotocol/sdk/client/index.js",
        ),
        dynamicImport<{
          StdioClientTransport: McpSdkModule["StdioClientTransport"];
          getDefaultEnvironment: McpSdkModule["getDefaultEnvironment"];
        }>("@modelcontextprotocol/sdk/client/stdio.js"),
        dynamicImport<{
          StreamableHTTPClientTransport: McpSdkModule["StreamableHTTPClientTransport"];
        }>("@modelcontextprotocol/sdk/client/streamableHttp.js"),
        dynamicImport<{ SSEClientTransport: McpSdkModule["SSEClientTransport"] }>(
          "@modelcontextprotocol/sdk/client/sse.js",
        ),
      ]);

      return {
        Client: clientModule.Client,
        StdioClientTransport: stdioModule.StdioClientTransport,
        getDefaultEnvironment: stdioModule.getDefaultEnvironment,
        StreamableHTTPClientTransport: httpModule.StreamableHTTPClientTransport,
        SSEClientTransport: sseModule.SSEClientTransport,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `MCP SDK could not be loaded. Run npm install and restart Chat Forge. Details: ${message}`,
      );
    }
  })();

  return sdkModulePromise;
}

async function connectMcpClient(
  server: McpServerConfig,
  signal?: AbortSignal,
): Promise<{ client: McpSdkClient; close: () => Promise<void> }> {
  const {
    Client,
    StdioClientTransport,
    StreamableHTTPClientTransport,
    SSEClientTransport,
    getDefaultEnvironment,
  } = await loadMcpSdk();

  const client = new Client(
    { name: "chat-forge", version: app.getVersion() },
    { capabilities: {} },
  );

  if (server.transport === "stdio") {
    const command = server.command?.trim();
    if (!command) throw new Error("MCP stdio server command is required.");

    let stderrText = "";

    const transport = new StdioClientTransport({
      command,
      args: server.args ?? [],
      cwd: server.cwd?.trim() || undefined,
      env: { ...getDefaultEnvironment(), ...(server.env ?? {}) },
      stderr: "pipe",
    });

    // Capture stderr for error diagnostics. The transport's stderr getter
    // returns a PassThrough stream immediately (before start()), so early
    // error output from the child process is not lost.
    const stderrStream = transport.stderr;
    if (stderrStream) {
      stderrStream.on("data", (chunk: Buffer) => {
        stderrText += chunk.toString();
        if (stderrText.length > 20_000) stderrText = stderrText.slice(-20_000);
      });
    }

    try {
      await client.connect(transport, getRequestOptions(server, signal));
      return {
        client,
        close: async () => {
          await client.close().catch(() => undefined);
          await transport.close?.().catch(() => undefined);
        },
      };
    } catch (error) {
      await transport.close?.().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      const stderrSuffix = stderrText.trim() ? `\n\nStderr:\n${stderrText.trim()}` : "";
      throw new Error(`${message}${stderrSuffix}`);
    }
  }

  const url = server.url?.trim();
  if (!url) throw new Error("MCP HTTP server URL is required.");

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("MCP HTTP server URL is invalid.");
  }

  const requestInit = getHttpRequestInit(server);
  const httpFetch = await createHttpFetchForServer(server);

  const streamableTransport = new StreamableHTTPClientTransport(parsedUrl, {
    ...(requestInit ? { requestInit } : {}),
    ...(httpFetch.fetch ? { fetch: httpFetch.fetch } : {}),
  });

  try {
    await client.connect(streamableTransport, getRequestOptions(server, signal));
    return {
      client,
      close: async () => {
        await client.close().catch(() => undefined);
        await streamableTransport.close?.().catch(() => undefined);
        await httpFetch.close();
      },
    };
  } catch (streamableError) {
    await streamableTransport.close?.().catch(() => undefined);
    const sseClient = new Client(
      { name: "chat-forge", version: app.getVersion() },
      { capabilities: {} },
    );
    const sseFetch = httpFetch.fetch ?? fetch;
    const sseTransport = new SSEClientTransport(parsedUrl, {
      ...(requestInit ? { requestInit } : {}),
      ...(httpFetch.fetch ? { fetch: httpFetch.fetch } : {}),
      eventSourceInit: { fetch: sseFetch as never },
    });

    try {
      await sseClient.connect(sseTransport, getRequestOptions(server, signal));
      return {
        client: sseClient,
        close: async () => {
          await sseClient.close().catch(() => undefined);
          await sseTransport.close?.().catch(() => undefined);
          await httpFetch.close();
        },
      };
    } catch (sseError) {
      await sseTransport.close?.().catch(() => undefined);
      await httpFetch.close();
      const streamableMessage = streamableError instanceof Error ? streamableError.message : String(streamableError);
      const sseMessage = sseError instanceof Error ? sseError.message : String(sseError);
      const tlsHint =
        server.insecureSkipTlsVerify ||
        !`${streamableMessage} ${sseMessage}`.toLowerCase().includes("certificate")
          ? ""
          : "\n\nTLS hint: this looks like a certificate trust issue. For self-signed or corporate-proxy certificates, enable 'Skip TLS certificate verification' for this MCP server, or start Node/Electron with a trusted system CA configuration.";
      throw new Error(
        `Streamable HTTP failed: ${streamableMessage}\nLegacy SSE fallback failed: ${sseMessage}${tlsHint}`,
      );
    }
  }
}

export async function listMcpTools(
  server: McpServerConfig,
  signal?: AbortSignal,
) {
  return runWithOptionalInsecureTls(server, async () => {
    const connection = await connectMcpClient(server, signal);
    try {
      const result = await connection.client.listTools(
        {},
        getRequestOptions(server, signal),
      );
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: schemaAsObject(tool.inputSchema),
      }));
    } finally {
      await connection.close();
    }
  });
}

export async function testMcpServer(server: McpServerConfig) {
  const tools = await listMcpTools(server);
  return {
    ok: true,
    message: `Connected. Found ${tools.length} tool${tools.length === 1 ? "" : "s"}.`,
    toolCount: tools.length,
  };
}

export async function refreshMcpTools(
  settings: McpSettings,
  serverId?: string,
): Promise<{ settings: McpSettings; tools: McpLoadedTool[] }> {
  const normalized = normalizeMcpSettings(settings);
  const usedNames = new Set<string>();
  const now = new Date().toISOString();

  for (const server of normalized.servers) {
    for (const tool of Object.values(server.tools ?? {})) {
      if (tool.exposedName && TOOL_NAME_PATTERN.test(tool.exposedName)) {
        usedNames.add(tool.exposedName);
      }
    }
  }

  const nextServers = [] as McpServerConfig[];

  for (const server of normalized.servers) {
    if (serverId && server.id !== serverId) {
      nextServers.push(server);
      continue;
    }

    if (!server.enabled) {
      nextServers.push(server);
      continue;
    }

    try {
      const discoveredTools = await listMcpTools(server);
      const nextTools: Record<string, McpToolConfig> = { ...(server.tools ?? {}) };

      for (const discoveredTool of discoveredTools) {
        const existing = nextTools[discoveredTool.name];
        if (existing?.exposedName) usedNames.delete(existing.exposedName);
        const exposedName = uniqueMcpExposedToolName(
          existing?.exposedName ?? "",
          server.name,
          discoveredTool.name,
          usedNames,
        );

        nextTools[discoveredTool.name] = {
          originalName: discoveredTool.name,
          exposedName,
          enabled: existing?.enabled ?? false,
          description: discoveredTool.description,
          inputSchema: discoveredTool.inputSchema,
          requireApproval: existing?.requireApproval,
          lastSeenAt: now,
        };
      }

      nextServers.push({
        ...server,
        tools: nextTools,
        lastConnectedAt: now,
        lastError: undefined,
      });
    } catch (error) {
      nextServers.push({
        ...server,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const nextSettings = { ...normalized, servers: nextServers };
  return { settings: nextSettings, tools: buildLoadedMcpTools(nextSettings) };
}

function normalizeMcpContent(result: unknown) {
  if (!isPlainObject(result)) return stringifyToolResult(result);

  const parts: string[] = [];
  const content = Array.isArray(result.content) ? result.content : [];

  for (const item of content) {
    if (!isPlainObject(item)) continue;

    if (item.type === "text") {
      parts.push(safeString(item.text));
      continue;
    }

    if (item.type === "resource" && isPlainObject(item.resource)) {
      const uri = safeString(item.resource.uri).trim();
      if (typeof item.resource.text === "string") {
        parts.push(uri ? `Resource ${uri}:\n${item.resource.text}` : item.resource.text);
      } else {
        parts.push(`[Unsupported MCP resource content${uri ? `: ${uri}` : ""}]`);
      }
      continue;
    }

    if (item.type === "resource_link") {
      const uri = safeString(item.uri).trim();
      const name = safeString(item.name).trim();
      parts.push(`[MCP resource link${name ? ` ${name}` : ""}${uri ? `: ${uri}` : ""}]`);
      continue;
    }

    if (item.type === "image") {
      parts.push(`[MCP result included an image (${safeString(item.mimeType, "unknown type")}) that Chat Forge does not yet pass back to the model.]`);
      continue;
    }

    if (item.type === "audio") {
      parts.push(`[MCP result included audio (${safeString(item.mimeType, "unknown type")}) that Chat Forge does not yet pass back to the model.]`);
      continue;
    }

    parts.push(stringifyToolResult(item));
  }

  if (isPlainObject(result.structuredContent)) {
    parts.push(`Structured content:\n${stringifyToolResult(result.structuredContent)}`);
  }

  if ("toolResult" in result) {
    parts.push(stringifyToolResult(result.toolResult));
  }

  return parts.filter(Boolean).join("\n\n") || stringifyToolResult(result);
}

export async function executeMcpTool({
  settings,
  toolName,
  args,
  signal,
}: {
  settings: McpSettings;
  toolName: string;
  args: unknown;
  signal?: AbortSignal;
}): Promise<McpToolCommandResult> {
  const normalized = normalizeMcpSettings(settings);
  const loadedTool = buildLoadedMcpTools(normalized).find((tool) => tool.name === toolName);
  if (!loadedTool?.mcp) throw new Error(`MCP tool not found: ${toolName}`);

  const server = normalized.servers.find((item) => item.id === loadedTool.mcp.serverId);
  if (!server) throw new Error(`MCP server not found: ${loadedTool.mcp.serverName}`);

  return runWithOptionalInsecureTls(server, async () => {
    const connection = await connectMcpClient(server, signal);
    try {
      const result = await connection.client.callTool(
        {
          name: loadedTool.mcp.originalToolName,
          arguments: isPlainObject(args) ? args : {},
        },
        undefined,
        getRequestOptions(server, signal),
      );
      const content = normalizeMcpContent(result);
      const isError = isPlainObject(result) && result.isError === true;

      return {
        toolName,
        content,
        isError,
        exitCode: isError ? 1 : 0,
        stdout: content,
        stderr: isError ? content : "",
        timedOut: false,
      };
    } finally {
      await connection.close();
    }
  });
}
