import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { McpDialog } from "@/components/mcp-dialog";
import type { McpSettings } from "@/lib/ai-chat/types";

function createSettings(): McpSettings {
  return {
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
            enabled: false,
            description: "Edit memory",
            inputSchema: { type: "object", properties: {} },
          },
        },
      },
      {
        id: "server-2",
        name: "github",
        enabled: true,
        transport: "http",
        url: "http://localhost:3000/mcp",
        timeoutMs: 60_000,
        requireApproval: true,
        tools: {},
      },
    ],
  };
}

function renderMcpDialog(initialSettings = createSettings()) {
  const showSuccess = vi.fn();
  const showError = vi.fn();

  function Harness() {
    const [open, setOpen] = useState(true);
    const [settings, setSettings] = useState(initialSettings);

    return (
      <McpDialog
        open={open}
        onOpenChange={setOpen}
        mcpSettings={settings}
        onMcpSettingsChange={setSettings}
        showSuccess={showSuccess}
        showError={showError}
      />
    );
  }

  return {
    user: userEvent.setup(),
    showSuccess,
    showError,
    ...render(<Harness />),
  };
}

describe("McpDialog", () => {
  it("keeps global MCP independent from the server form Save button", async () => {
    const { user } = renderMcpDialog();
    const saveButton = screen.getByRole("button", { name: "Save" });

    expect(saveButton).toBeDisabled();

    await user.click(screen.getByText("Enable MCP globally"));

    expect(saveButton).toBeDisabled();
  });

  it("does not show unsaved server name edits in the sidebar", async () => {
    const { user } = renderMcpDialog();
    const sidebarServer = screen.getByText("serena");
    const nameInput = screen.getByLabelText("Name");

    await user.clear(nameInput);
    await user.type(nameInput, "serena-renamed");

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(sidebarServer).toHaveTextContent("serena");
    expect(screen.queryByText("serena-renamed")).not.toBeInTheDocument();
  });

  it("shows an unsaved changes dialog before switching servers", async () => {
    const { user } = renderMcpDialog();

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "serena-renamed");
    await user.click(screen.getByText("github"));

    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
  });

  it("shows global-off server switches as disabled and unchecked", async () => {
    const { user } = renderMcpDialog();

    await user.click(screen.getByText("Enable MCP globally"));

    const firstServerSwitch = screen.getByRole("switch", {
      name: "serena MCP server",
    });

    expect(firstServerSwitch).toBeDisabled();
    expect(firstServerSwitch).toHaveAttribute("data-state", "unchecked");
  });

  it("toggles the selected MCP server switch when clicking its row", async () => {
    const { user } = renderMcpDialog();
    const serverSwitch = screen.getByRole("switch", {
      name: "serena MCP server",
    });
    const serverRow = serverSwitch.closest('[role="button"]');

    expect(serverRow).toBeInstanceOf(HTMLElement);
    expect(serverSwitch).toHaveAttribute("data-state", "checked");

    await user.click(serverRow as HTMLElement);

    expect(serverSwitch).toHaveAttribute("data-state", "unchecked");
  });

  it("renders MCP tool visibility switches without the old permission label", () => {
    renderMcpDialog();

    expect(screen.queryByText("Permission in Tools")).not.toBeInTheDocument();
    expect(screen.getByText("edit_memory")).toBeInTheDocument();
    expect(screen.getByText("mcp_serena_edit_memory")).toBeInTheDocument();
  });


  it("shows the MCP tool settings note only after tools are discovered", async () => {
    const { user } = renderMcpDialog();

    expect(
      screen.getByText(
        /Tool switches here control whether MCP tools are visible in Tools settings and model context/i,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByText("github"));

    expect(
      screen.queryByText(
        /Tool switches here control whether MCP tools are visible in Tools settings and model context/i,
      ),
    ).not.toBeInTheDocument();
  });

  it("uses Create and Cancel actions for a new unchanged server", async () => {
    const { user } = renderMcpDialog();

    await user.click(screen.getByRole("button", { name: "Add server" }));

    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("does not show discard changes for an untouched new server", async () => {
    const { user } = renderMcpDialog();

    await user.click(screen.getByRole("button", { name: "Add server" }));
    await user.click(screen.getByText("github"));

    expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
  });
});
