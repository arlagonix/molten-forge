"use client";

import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Wand2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createEmptyMcpServer,
  createMcpExposedToolName,
} from "@/lib/ai-chat/mcp";
import type {
  McpServerConfig,
  McpSettings,
  McpToolConfig,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const TLS_WARNING =
  "Use only for local, self-signed, or corporate-proxy MCP servers you trust.";

/** A bordered container that acts as a single large switch target. */
function ToggleBlock({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onCheckedChange(!checked)}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          onCheckedChange(!checked);
        }
      }}
      className="flex cursor-pointer select-none items-center justify-between gap-4 rounded-md border p-3 transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="min-w-0">
        <Label className="cursor-pointer">{title}</Label>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      {/* Presentational only — the whole block is the click target. */}
      <Switch
        checked={checked}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none shrink-0"
      />
    </div>
  );
}

type McpDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mcpSettings: McpSettings;
  onMcpSettingsChange: (settings: McpSettings) => void;
  showSuccess: (message: string, description?: string) => void;
  showError: (message: string, description?: string) => void;
};

function cloneSettings(settings: McpSettings): McpSettings {
  return JSON.parse(JSON.stringify(settings)) as McpSettings;
}

function stripTransientMcpState(settings: McpSettings): McpSettings {
  return {
    ...settings,
    servers: settings.servers.map((server) => {
      const { lastError: _lastError, ...rest } = server;
      return rest;
    }),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item !== "undefined")
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function areEqual(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right);
}

function recordToText(value?: Record<string, string>) {
  return Object.entries(value ?? {})
    .map(([key, rawValue]) => `${key}=${rawValue}`)
    .join("\n");
}

function textToRecord(value: string): Record<string, string> | undefined {
  const entries = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.includes("=") ? line.indexOf("=") : line.indexOf(":");
      if (separator <= 0) return undefined;
      const key = line.slice(0, separator).trim();
      const rawValue = line.slice(separator + 1).trim();
      if (!key || !rawValue) return undefined;
      return [key, rawValue] as const;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));

  return entries.length ? Object.fromEntries(entries) : undefined;
}

function argsToText(args?: string[]) {
  return (args ?? []).join("\n");
}

function textToArgs(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sortTools(tools?: Record<string, McpToolConfig>) {
  return Object.values(tools ?? {}).sort((left, right) =>
    left.originalName.localeCompare(right.originalName),
  );
}

function serverIsMeaningfullyEdited(
  server: McpServerConfig | null,
  base: McpServerConfig | null,
) {
  if (!server || !base) return false;
  return !areEqual(
    {
      ...server,
      id: "",
      tools: server.tools ?? {},
      lastError: undefined,
      lastConnectedAt: undefined,
    },
    {
      ...base,
      id: "",
      tools: base.tools ?? {},
      lastError: undefined,
      lastConnectedAt: undefined,
    },
  );
}

export const McpDialog = memo(function McpDialog({
  open,
  onOpenChange,
  mcpSettings,
  onMcpSettingsChange,
  showSuccess,
  showError,
}: McpDialogProps) {
  const [draftSettings, setDraftSettings] = useState<McpSettings>(() =>
    cloneSettings(mcpSettings),
  );
  const [selectedServerId, setSelectedServerId] = useState<string | undefined>(
    mcpSettings.servers[0]?.id,
  );
  const [newServerDraft, setNewServerDraft] = useState<McpServerConfig | null>(
    null,
  );
  const [newServerBase, setNewServerBase] = useState<McpServerConfig | null>(
    null,
  );
  const [busyServerId, setBusyServerId] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    serverId: string;
    ok: boolean;
    title: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const nextDraft = cloneSettings(mcpSettings);
    setDraftSettings(nextDraft);
    setSelectedServerId(nextDraft.servers[0]?.id);
    setNewServerDraft(null);
    setNewServerBase(null);
    setBusyServerId(undefined);
    setTestResult(null);
  }, [open]);

  useEffect(() => {
    if (newServerDraft) return;
    if (
      selectedServerId &&
      draftSettings.servers.some((server) => server.id === selectedServerId)
    ) {
      return;
    }
    setSelectedServerId(draftSettings.servers[0]?.id);
  }, [draftSettings.servers, newServerDraft, selectedServerId]);

  const selectedServer = useMemo(
    () => draftSettings.servers.find((server) => server.id === selectedServerId),
    [draftSettings.servers, selectedServerId],
  );
  const activeServer = newServerDraft ?? selectedServer ?? null;
  const isNewServer = Boolean(newServerDraft);
  const enabledServersCount = draftSettings.servers.filter(
    (server) => server.enabled,
  ).length;
  const settingsChanged = !areEqual(draftSettings, mcpSettings);
  const newServerChanged = serverIsMeaningfullyEdited(
    newServerDraft,
    newServerBase,
  );
  const hasChanges = settingsChanged || Boolean(newServerDraft);

  function updateDraftSettings(updater: (settings: McpSettings) => McpSettings) {
    setDraftSettings((current) => updater(current));
  }

  function updateServer(
    serverId: string,
    updater: (server: McpServerConfig) => McpServerConfig,
  ) {
    updateDraftSettings((settings) => ({
      ...settings,
      servers: settings.servers.map((server) =>
        server.id === serverId ? updater(server) : server,
      ),
    }));
  }

  function updateActiveServer(patch: Partial<McpServerConfig>) {
    if (!activeServer) return;

    if (newServerDraft) {
      setNewServerDraft({ ...newServerDraft, ...patch });
      return;
    }

    updateServer(activeServer.id, (server) => ({ ...server, ...patch }));
  }

  function addServer() {
    const server = createEmptyMcpServer();
    setNewServerDraft(server);
    setNewServerBase(server);
    setSelectedServerId(undefined);
  }

  function discardNewServer() {
    setNewServerDraft(null);
    setNewServerBase(null);
    setSelectedServerId(draftSettings.servers[0]?.id);
  }

  function deleteServer(serverId: string) {
    const nextServers = draftSettings.servers.filter(
      (server) => server.id !== serverId,
    );
    setDraftSettings({ ...draftSettings, servers: nextServers });
    setSelectedServerId(nextServers[0]?.id);
  }

  async function saveCurrentDraft() {
    setIsSaving(true);
    try {
      const savedServerId = newServerDraft?.id;
      const nextSettings = stripTransientMcpState(
        newServerDraft
          ? {
              ...draftSettings,
              servers: [...draftSettings.servers, newServerDraft],
            }
          : draftSettings,
      );

      onMcpSettingsChange(cloneSettings(nextSettings));
      setDraftSettings(cloneSettings(nextSettings));
      if (savedServerId) setSelectedServerId(savedServerId);
      setNewServerDraft(null);
      setNewServerBase(null);
      showSuccess("MCP settings saved");
    } finally {
      setIsSaving(false);
    }
  }

  function resetCurrentDraft() {
    const nextDraft = cloneSettings(mcpSettings);
    setDraftSettings(nextDraft);
    setSelectedServerId(nextDraft.servers[0]?.id);
    setNewServerDraft(null);
    setNewServerBase(null);
  }

  async function testServer(server: McpServerConfig) {
    const bridge = window.chatForgeMcp;
    if (!bridge) {
      showError("MCP bridge is unavailable.");
      return;
    }

    setBusyServerId(server.id);
    setTestResult(null);
    try {
      const result = await bridge.testServer({ server });
      if (result.ok) {
        showSuccess("MCP server connected", result.message);
        setTestResult({
          serverId: server.id,
          ok: true,
          title: "MCP server connected",
          message: result.message,
        });
      } else {
        showError("MCP server failed", result.message);
        setTestResult({
          serverId: server.id,
          ok: false,
          title: "MCP server failed",
          message: result.message,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showError("MCP server failed", message);
      setTestResult({
        serverId: server.id,
        ok: false,
        title: "MCP server failed",
        message,
      });
    } finally {
      setBusyServerId(undefined);
    }
  }

  async function refreshServer(server: McpServerConfig) {
    const bridge = window.chatForgeMcp;
    if (!bridge) {
      showError("MCP bridge is unavailable.");
      return;
    }

    const settingsForRefresh = newServerDraft
      ? { ...draftSettings, servers: [...draftSettings.servers, newServerDraft] }
      : draftSettings;

    setBusyServerId(server.id);
    try {
      const result = await bridge.refreshTools({
        settings: settingsForRefresh,
        serverId: server.id,
      });
      const updatedServer = result.settings.servers.find(
        (item) => item.id === server.id,
      );
      const toolCount = Object.keys(updatedServer?.tools ?? {}).length;

      if (newServerDraft) {
        setNewServerDraft(updatedServer ?? server);
      } else {
        setDraftSettings(result.settings);
      }

      if (updatedServer?.lastError) {
        showError("MCP refresh failed", updatedServer.lastError);
      } else {
        showSuccess(
          "MCP tools refreshed",
          `${toolCount} tool${toolCount === 1 ? "" : "s"} found. Save to keep these changes.`,
        );
      }
    } catch (error) {
      showError(
        "MCP refresh failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusyServerId(undefined);
    }
  }

  function updateTool(
    serverId: string,
    toolName: string,
    updater: (tool: McpToolConfig) => McpToolConfig,
  ) {
    if (newServerDraft && newServerDraft.id === serverId) {
      setNewServerDraft({
        ...newServerDraft,
        tools: Object.fromEntries(
          Object.entries(newServerDraft.tools ?? {}).map(([name, tool]) => [
            name,
            name === toolName ? updater(tool) : tool,
          ]),
        ),
      });
      return;
    }

    updateServer(serverId, (server) => ({
      ...server,
      tools: Object.fromEntries(
        Object.entries(server.tools ?? {}).map(([name, tool]) => [
          name,
          name === toolName ? updater(tool) : tool,
        ]),
      ),
    }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
        onInteractOutside={(event) => {
          // Toasts render outside the dialog (at the app root). Selecting or
          // clicking toast text must not be treated as an outside click that
          // closes the modal.
          const target = event.target as HTMLElement | null;
          if (target?.closest?.("[data-sonner-toaster]")) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>MCP</DialogTitle>
          <DialogDescription>
            Connect external MCP servers and expose selected tools to chats and agents.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b bg-card/70 p-3 md:border-b-0 md:border-r">
            <div className="mb-3 flex items-center justify-between gap-2">
              <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                MCP servers
              </Label>
              <span className="text-sm text-muted-foreground">
                {enabledServersCount}/{draftSettings.servers.length} enabled
              </span>
            </div>

            <div
              role="button"
              tabIndex={0}
              className="mb-3 flex cursor-pointer items-center justify-between gap-3 border bg-background px-3 py-2 text-base outline-none"
              onClick={() =>
                setDraftSettings((current) => ({
                  ...current,
                  enabled: !current.enabled,
                }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setDraftSettings((current) => ({
                    ...current,
                    enabled: !current.enabled,
                  }));
                }
              }}
            >
              <span className="min-w-0">
                <span className="block font-medium">Enable MCP globally</span>
                <span className="block select-none text-sm leading-5 text-muted-foreground">
                  Disabled globally hides all MCP tools from model context.
                </span>
              </span>
              <Switch
                checked={draftSettings.enabled}
                onClick={(event) => event.stopPropagation()}
                onCheckedChange={(checked) =>
                  setDraftSettings((current) => ({ ...current, enabled: checked }))
                }
                className="shrink-0 cursor-pointer"
              />
            </div>

            <div className="mb-3 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={addServer}
              >
                <Plus className="size-4" />
                Add server
              </Button>
            </div>

            <div className="grid gap-1.5">
              {draftSettings.servers.map((server) => {
                const toolCount = Object.keys(server.tools ?? {}).length;
                return (
                  <div
                    key={server.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "group flex min-w-0 cursor-pointer items-start gap-2 border px-2 py-2 outline-none",
                      !newServerDraft && selectedServerId === server.id
                        ? "border-primary/30 bg-accent text-accent-foreground"
                        : "border-transparent hover:border-border hover:bg-muted/60",
                    )}
                    onClick={() => {
                      setNewServerDraft(null);
                      setNewServerBase(null);
                      setSelectedServerId(server.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setNewServerDraft(null);
                        setNewServerBase(null);
                        setSelectedServerId(server.id);
                      }
                    }}
                  >
                    <Server className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base leading-6">{server.name}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {server.transport} · {toolCount} tool{toolCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <Switch
                      checked={server.enabled}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={(checked) =>
                        updateServer(server.id, (current) => ({
                          ...current,
                          enabled: checked,
                        }))
                      }
                      className="mt-0.5 shrink-0 cursor-pointer"
                      title={
                        server.enabled
                          ? "Disable MCP server"
                          : "Enable MCP server"
                      }
                    />
                  </div>
                );
              })}


              {draftSettings.servers.length === 0 && (
                <div className="border border-dashed px-3 py-4 text-center text-base text-muted-foreground">
                  No MCP servers configured.
                </div>
              )}
            </div>
          </aside>

          <div className="min-h-0 flex flex-col overflow-hidden">
            {activeServer ? (
              <>
                <div className="z-20 flex min-h-[4.25rem] shrink-0 items-center border-b bg-background px-5 py-3">
                  <div className="flex w-full items-center justify-between gap-4">
                    <div>
                      <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                        {isNewServer ? "New MCP server" : "Edit MCP server"}
                      </Label>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Configure the server, test the connection, then refresh tools.
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          title="MCP server options"
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem
                          disabled={busyServerId === activeServer.id}
                          onSelect={() => void testServer(activeServer)}
                        >
                          <Wand2 className="size-4" />
                          Test connection
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={busyServerId === activeServer.id}
                          onSelect={() => void refreshServer(activeServer)}
                        >
                          <RefreshCw className="size-4" />
                          Refresh tools
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {isNewServer ? (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={discardNewServer}
                          >
                            <Trash2 className="size-4" />
                            Discard
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => deleteServer(activeServer.id)}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                  <div className="grid gap-5 pb-1">
                    {testResult && testResult.serverId === activeServer.id && (
                      <div
                        role={testResult.ok ? "status" : "alert"}
                        className={cn(
                          "relative grid gap-1 rounded-md border px-3 py-2.5 pr-9 text-sm",
                          testResult.ok
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border-destructive/40 bg-destructive/10 text-destructive",
                        )}
                      >
                        <div className="flex items-center gap-2 font-medium">
                          {testResult.ok ? (
                            <CheckCircle2 className="size-4 shrink-0" />
                          ) : (
                            <AlertTriangle className="size-4 shrink-0" />
                          )}
                          {testResult.title}
                        </div>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/80 select-text">
                          {testResult.message}
                        </pre>
                        <button
                          type="button"
                          onClick={() => setTestResult(null)}
                          className="absolute right-2 top-2 rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100"
                          title="Dismiss"
                          aria-label="Dismiss test result"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    )}
                    <div className="grid gap-2">
                      <Label htmlFor="mcp-server-name">Name</Label>
                      <Input
                        id="mcp-server-name"
                        value={activeServer.name}
                        onChange={(event) =>
                          updateActiveServer({ name: event.target.value })
                        }
                        placeholder="github"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label>Transport</Label>
                      <Select
                        value={activeServer.transport}
                        onValueChange={(transport) =>
                          updateActiveServer({
                            transport: transport === "http" ? "http" : "stdio",
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stdio">stdio</SelectItem>
                          <SelectItem value="http">HTTP / Streamable HTTP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {activeServer.transport === "stdio" ? (
                      <>
                        <div className="grid gap-2">
                          <Label>Command</Label>
                          <Input
                            placeholder="npx"
                            value={activeServer.command ?? ""}
                            onChange={(event) =>
                              updateActiveServer({ command: event.target.value })
                            }
                          />
                        </div>

                        <div className="grid gap-2">
                          <Label>Args, one per line</Label>
                          <Textarea
                            className="min-h-24 font-mono text-xs"
                            placeholder={
                              "-y\n@modelcontextprotocol/server-filesystem\nC:/Users/..."
                            }
                            value={argsToText(activeServer.args)}
                            onChange={(event) =>
                              updateActiveServer({ args: textToArgs(event.target.value) })
                            }
                          />
                        </div>

                        <div className="grid gap-2">
                          <Label>Working directory</Label>
                          <Input
                            value={activeServer.cwd ?? ""}
                            onChange={(event) =>
                              updateActiveServer({
                                cwd: event.target.value || undefined,
                              })
                            }
                          />
                        </div>

                        <div className="grid gap-2">
                          <Label>Environment variables</Label>
                          <Textarea
                            className="min-h-20 font-mono text-xs"
                            placeholder="API_KEY=..."
                            value={recordToText(activeServer.env)}
                            onChange={(event) =>
                              updateActiveServer({
                                env: textToRecord(event.target.value),
                              })
                            }
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="grid gap-2">
                          <Label>URL</Label>
                          <Input
                            placeholder="http://localhost:3000/mcp"
                            value={activeServer.url ?? ""}
                            onChange={(event) =>
                              updateActiveServer({ url: event.target.value })
                            }
                          />
                        </div>

                        <div className="grid gap-2">
                          <Label>Headers</Label>
                          <Textarea
                            className="min-h-20 font-mono text-xs"
                            placeholder="Authorization=Bearer ..."
                            value={recordToText(activeServer.headers)}
                            onChange={(event) =>
                              updateActiveServer({
                                headers: textToRecord(event.target.value),
                              })
                            }
                          />
                        </div>
                      </>
                    )}

                    <div className="grid gap-2">
                      <Label>Timeout, ms</Label>
                      <Input
                        type="number"
                        min={1000}
                        value={activeServer.timeoutMs}
                        onChange={(event) =>
                          updateActiveServer({
                            timeoutMs: Number(event.target.value) || 60_000,
                          })
                        }
                      />
                    </div>

                    {activeServer.transport === "http" && (
                      <ToggleBlock
                        title="Skip TLS certificate verification"
                        description={TLS_WARNING}
                        checked={activeServer.insecureSkipTlsVerify ?? false}
                        onCheckedChange={(checked) =>
                          updateActiveServer({ insecureSkipTlsVerify: checked })
                        }
                      />
                    )}

                    <ToggleBlock
                      title="Require approval by default"
                      description="New MCP tool calls ask before execution."
                      checked={activeServer.requireApproval}
                      onCheckedChange={(requireApproval) =>
                        updateActiveServer({ requireApproval })
                      }
                    />

                    <div className="grid gap-3 pt-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold">Discovered tools</h4>
                          <p className="text-sm text-muted-foreground">
                            Tools are disabled when first discovered. Enable only the tools you want in context.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0 gap-2"
                          disabled={busyServerId === activeServer.id}
                          onClick={() => void refreshServer(activeServer)}
                          title="Load tools from this server"
                        >
                          <RefreshCw
                            className={cn(
                              "size-4",
                              busyServerId === activeServer.id && "animate-spin",
                            )}
                          />
                          Load tools
                        </Button>
                      </div>

                      <div className="grid gap-2">
                        {sortTools(activeServer.tools).length === 0 ? (
                          <div className="border border-dashed px-3 py-4 text-center text-base text-muted-foreground">
                            No tools discovered yet. Use Refresh tools after configuring the server.
                          </div>
                        ) : (
                          sortTools(activeServer.tools).map((tool) => (
                            <div
                              key={tool.originalName}
                              className="border bg-background px-3 py-2"
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="truncate text-base leading-6">
                                    {tool.originalName}
                                  </div>
                                  <div className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                                    {tool.exposedName ||
                                      createMcpExposedToolName(
                                        activeServer.name,
                                        tool.originalName,
                                      )}
                                  </div>
                                  {tool.description && (
                                    <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                                      {tool.description}
                                    </div>
                                  )}
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-2">
                                  <div className="flex w-32 items-center justify-between gap-2 text-sm text-muted-foreground">
                                    Approval
                                    <Switch
                                      checked={
                                        tool.requireApproval ??
                                        activeServer.requireApproval
                                      }
                                      onCheckedChange={(requireApproval) =>
                                        updateTool(
                                          activeServer.id,
                                          tool.originalName,
                                          (currentTool) => ({
                                            ...currentTool,
                                            requireApproval,
                                          }),
                                        )
                                      }
                                      className="cursor-pointer"
                                    />
                                  </div>
                                  <div className="flex w-32 items-center justify-between gap-2 text-sm text-muted-foreground">
                                    Enabled
                                    <Switch
                                      checked={tool.enabled}
                                      onCheckedChange={(enabled) =>
                                        updateTool(
                                          activeServer.id,
                                          tool.originalName,
                                          (currentTool) => ({
                                            ...currentTool,
                                            enabled,
                                          }),
                                        )
                                      }
                                      className="cursor-pointer"
                                      aria-label={`Enable ${tool.originalName}`}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

              </>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-muted-foreground">
                <div className="grid max-w-sm gap-2">
                  <Server className="mx-auto size-8 opacity-50" />
                  <div className="text-lg font-medium text-foreground">
                    No MCP server selected
                  </div>
                  <p className="text-base leading-6">
                    Create a server or select one from the list to edit its connection settings.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 items-center border-t bg-background px-5 py-4 sm:justify-between">
          <div className="text-sm text-muted-foreground" aria-live="polite">
            {hasChanges ? "Unsaved changes" : null}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={resetCurrentDraft}
              disabled={!hasChanges || isSaving}
            >
              Reset
            </Button>
            <Button
              type="button"
              onClick={() => void saveCurrentDraft()}
              disabled={!hasChanges || isSaving}
            >
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
