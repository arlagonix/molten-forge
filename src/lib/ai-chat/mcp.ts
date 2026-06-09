import type {
  LoadedToolInfo,
  McpServerConfig,
  McpSettings,
  McpToolConfig,
} from "@/lib/ai-chat/types";

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export const DEFAULT_MCP_TOOL_TIMEOUT_MS = 60_000;

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  enabled: true,
  servers: [],
};

export function createMcpServerId() {
  return `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    name: "New MCP server",
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
      const exposedName = tool.exposedName || createMcpExposedToolName(server.name, tool.originalName);
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
