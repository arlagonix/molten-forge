import type {
  LoadedToolInfo,
  McpServerConfig,
  McpSettings,
  McpToolConfig,
} from "@/lib/ai-chat/types";

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,48}$/;

export const DEFAULT_MCP_TOOL_TIMEOUT_MS = 60_000;

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  enabled: true,
  servers: [],
};

export function createMcpServerId() {
  return `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeMcpServerNameForComparison(name: string) {
  return name.trim().toLowerCase();
}

export function isValidMcpServerName(name: string) {
  return MCP_SERVER_NAME_PATTERN.test(name.trim());
}

export function validateMcpServerName(
  name: string,
  servers: McpServerConfig[],
  currentServerId?: string,
): string | undefined {
  const trimmedName = name.trim();

  if (!trimmedName) return "MCP server name is required.";
  if (trimmedName.length > 48) {
    return "MCP server name must be 48 characters or fewer.";
  }
  if (!MCP_SERVER_NAME_PATTERN.test(trimmedName)) {
    return "MCP server name can contain only letters, numbers, underscores, and hyphens.";
  }

  const normalizedName = normalizeMcpServerNameForComparison(trimmedName);
  const duplicate = servers.some(
    (server) =>
      server.id !== currentServerId &&
      normalizeMcpServerNameForComparison(server.name) === normalizedName,
  );

  if (duplicate) {
    return "MCP server names must be unique. Names are compared case-insensitively.";
  }

  return undefined;
}

export function createUniqueMcpServerName(
  baseName: string,
  servers: McpServerConfig[],
) {
  const normalizedNames = new Set(
    servers.map((server) => normalizeMcpServerNameForComparison(server.name)),
  );
  const safeBase = isValidMcpServerName(baseName)
    ? baseName
    : sanitizeMcpToolNamePart(baseName, "new-mcp-server").slice(0, 48);
  const normalizedBase = normalizeMcpServerNameForComparison(safeBase);

  if (!normalizedNames.has(normalizedBase)) return safeBase;

  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${safeBase.slice(0, 48 - suffix.length)}${suffix}`;
    if (!normalizedNames.has(normalizeMcpServerNameForComparison(candidate))) {
      return candidate;
    }
  }

  return `mcp-${Date.now()}`.slice(0, 48);
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
  const name = `mcp_${serverPart}_${toolPart}`.slice(0, 64);
  return TOOL_NAME_PATTERN.test(name) ? name : "";
}

export function isValidMcpExposedToolName(name: string) {
  return TOOL_NAME_PATTERN.test(name);
}

export function regenerateMcpServerToolExposedNames(
  server: McpServerConfig,
): McpServerConfig {
  const nextTools = Object.fromEntries(
    Object.entries(server.tools ?? {}).map(([key, tool]) => [
      key,
      {
        ...tool,
        exposedName: createMcpExposedToolName(server.name, tool.originalName),
      },
    ]),
  );

  return {
    ...server,
    tools: nextTools,
  };
}

function schemaAsObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const schema = value as Record<string, unknown>;
    return {
      ...schema,
      type: "object",
      properties:
        schema.properties &&
        typeof schema.properties === "object" &&
        !Array.isArray(schema.properties)
          ? schema.properties
          : {},
    };
  }

  return { type: "object", properties: {}, additionalProperties: false };
}

export function createEmptyMcpServer(): McpServerConfig {
  return {
    id: createMcpServerId(),
    name: "new-mcp-server",
    enabled: true,
    transport: "stdio",
    command: "",
    args: [],
    insecureSkipTlsVerify: false,
    timeoutMs: DEFAULT_MCP_TOOL_TIMEOUT_MS,
    requireApproval: true,
    tools: {},
  };
}

export function getMcpLegacyToolPermission(
  server: McpServerConfig,
  tool: McpToolConfig,
) {
  if (!tool.enabled) return "deny" as const;
  return (typeof tool.requireApproval === "boolean"
    ? tool.requireApproval
    : server.requireApproval)
    ? "ask" as const
    : "allow" as const;
}

export function buildLoadedMcpTools(settings: McpSettings): LoadedToolInfo[] {
  if (!settings.enabled) return [];

  const tools: LoadedToolInfo[] = [];
  const usedNames = new Set<string>();

  for (const server of settings.servers) {
    if (!server.enabled) continue;

    for (const tool of Object.values(server.tools ?? {})) {
      if (!tool.enabled) continue;

      const exposedName = createMcpExposedToolName(server.name, tool.originalName);
      if (!isValidMcpExposedToolName(exposedName) || usedNames.has(exposedName)) continue;

      usedNames.add(exposedName);
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
        timeoutMs: server.timeoutMs || DEFAULT_MCP_TOOL_TIMEOUT_MS,
        requiresApproval: true,
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
