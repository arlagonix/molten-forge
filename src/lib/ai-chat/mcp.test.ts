import { describe, expect, it } from "vitest";

import {
  buildLoadedMcpTools,
  createMcpExposedToolName,
  createUniqueMcpServerName,
  isValidMcpServerName,
  validateMcpServerName,
} from "@/lib/ai-chat/mcp";
import type { McpSettings } from "@/lib/ai-chat/types";

const settings: McpSettings = {
  enabled: true,
  servers: [
    {
      id: "server-1",
      name: "serena",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: [],
      timeoutMs: 60_000,
      requireApproval: true,
      tools: {
        edit_memory: {
          originalName: "edit_memory",
          exposedName: "mcp_serena_edit_memory",
          enabled: true,
          description: "Edit memory",
          inputSchema: { type: "object", properties: {} },
        },
        read_memory: {
          originalName: "read_memory",
          exposedName: "mcp_serena_read_memory",
          enabled: false,
          description: "Read memory",
          inputSchema: { type: "object", properties: {} },
        },
      },
    },
  ],
};

describe("MCP settings helpers", () => {
  it("validates strict MCP server names", () => {
    expect(isValidMcpServerName("serena")).toBe(true);
    expect(isValidMcpServerName("Serena_2-test")).toBe(true);
    expect(isValidMcpServerName("serena tools")).toBe(false);
    expect(isValidMcpServerName("serena.tools")).toBe(false);
    expect(isValidMcpServerName("a".repeat(49))).toBe(false);
  });

  it("rejects duplicate MCP server names case-insensitively", () => {
    expect(validateMcpServerName("SERENA", settings.servers, "other-server"))
      .toMatch(/unique/i);
    expect(validateMcpServerName("SERENA", settings.servers, "server-1"))
      .toBeUndefined();
  });

  it("creates unique default names for new MCP servers", () => {
    expect(createUniqueMcpServerName("serena", settings.servers)).toBe("serena-2");
    expect(createUniqueMcpServerName("github", settings.servers)).toBe("github");
  });

  it("regenerates exposed MCP tool names from the server name", () => {
    expect(createMcpExposedToolName("serena", "edit_memory")).toBe(
      "mcp_serena_edit_memory",
    );
    expect(createMcpExposedToolName("Serena", "edit_memory")).toBe(
      "mcp_Serena_edit_memory",
    );
  });

  it("loads only globally enabled, server enabled, and tool enabled MCP tools", () => {
    expect(buildLoadedMcpTools(settings).map((tool) => tool.name)).toEqual([
      "mcp_serena_edit_memory",
    ]);

    expect(buildLoadedMcpTools({ ...settings, enabled: false })).toEqual([]);
    expect(
      buildLoadedMcpTools({
        ...settings,
        servers: [{ ...settings.servers[0], enabled: false }],
      }),
    ).toEqual([]);
  });
});
