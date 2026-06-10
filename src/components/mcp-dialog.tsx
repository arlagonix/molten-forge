"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { memo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { useMcpSettingsForm } from "@/hooks/use-mcp-settings-form";
import { createMcpExposedToolName } from "@/lib/ai-chat/mcp";
import type { McpSettings, McpToolConfig } from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const TLS_WARNING =
  "Use only for local, self-signed, or corporate-proxy MCP servers you trust.";

function InfoTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${label} info`}
          className="inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={6}
        className="max-w-xs text-sm leading-5"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

function FieldLabel({
  htmlFor,
  label,
  description,
}: {
  htmlFor?: string;
  label: string;
  description: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      <InfoTooltip label={label}>{description}</InfoTooltip>
    </div>
  );
}

/** A bordered container that acts as a single large switch target. */
function ToggleBlock({
  title,
  description,
  info,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: ReactNode;
  info?: ReactNode;
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
        <div className="flex items-center gap-1.5">
          <Label className="cursor-pointer">{title}</Label>
          {info ? <InfoTooltip label={title}>{info}</InfoTooltip> : null}
        </div>
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
      const separator = line.includes("=")
        ? line.indexOf("=")
        : line.indexOf(":");
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

export const McpDialog = memo(function McpDialog({
  open,
  onOpenChange,
  mcpSettings,
  onMcpSettingsChange,
  showSuccess,
  showError,
}: McpDialogProps) {
  const {
    activeServer,
    busyServerId,
    cancelDiscardUnsavedChanges,
    confirmDiscardUnsavedChanges,
    deleteActiveServer,
    discardNewServer,
    hasChanges,
    isNewServer,
    isSaving,
    mcpEnabled,
    refreshServer,
    requestAddServer,
    requestClose,
    requestSelectServer,
    resetCurrentDraft,
    savedServers,
    selectedServerId,
    setTestResult,
    testResult,
    testServer,
    unsavedChangesDialogOpen,
    updateActiveServer,
    updateActiveServerToolEnabled,
    updateGlobalEnabled,
    updateServerEnabled,
    saveCurrentDraft,
  } = useMcpSettingsForm({
    open,
    mcpSettings,
    onOpenChange,
    onMcpSettingsChange,
    showSuccess,
    showError,
  });

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
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
          <DialogHeader className="shrink-0 border-b p-4 pr-12">
            <DialogTitle>MCP</DialogTitle>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-b bg-card/70 md:border-b-0 md:border-r">
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                <div
                  role="button"
                  tabIndex={0}
                  className="mb-2 flex cursor-pointer items-center justify-between gap-3 border bg-background px-2 py-2 text-base outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => updateGlobalEnabled(!mcpEnabled)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      updateGlobalEnabled(!mcpEnabled);
                    }
                  }}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-medium">
                      Enable MCP globally
                      <InfoTooltip label="Enable MCP globally">
                        Master switch for MCP. When disabled, all server switches appear off, but their saved values are preserved.
                      </InfoTooltip>
                    </span>
                    <span className="block select-none text-sm leading-5 text-muted-foreground">
                      Disabled globally hides all MCP tools from model context.
                    </span>
                  </span>
                  <Switch
                    checked={mcpEnabled}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={updateGlobalEnabled}
                    className="shrink-0 cursor-pointer"
                  />
                </div>

                <div className="grid gap-1.5">
                  {savedServers.map((server) => {
                    const toolCount = Object.keys(server.tools ?? {}).length;
                    const serverSwitchChecked = mcpEnabled
                      ? server.enabled
                      : false;

                    return (
                      <div
                        key={server.id}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          "group flex min-w-0 cursor-pointer select-none items-start gap-2 border px-2 py-2 outline-none transition-colors",
                          !isNewServer && selectedServerId === server.id
                            ? "border-primary/30 bg-accent text-accent-foreground"
                            : "border-transparent hover:border-border hover:bg-muted/60",
                        )}
                        onClick={() => {
                          if (!isNewServer && selectedServerId === server.id) {
                            if (mcpEnabled) {
                              updateServerEnabled(server.id, !server.enabled);
                            }
                            return;
                          }

                          requestSelectServer(server.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            requestSelectServer(server.id);
                          }
                        }}
                      >
                        <Server className="mt-[5px] size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base leading-6">
                            {server.name}
                          </div>
                          <div className="truncate text-sm text-muted-foreground">
                            {server.transport} · {toolCount} tool
                            {toolCount === 1 ? "" : "s"}
                          </div>
                        </div>
                        <Switch
                          aria-label={`${server.name} MCP server`}
                          checked={serverSwitchChecked}
                          disabled={!mcpEnabled}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={(checked) =>
                            updateServerEnabled(server.id, checked)
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

                  {savedServers.length === 0 && (
                    <div className="border border-dashed px-3 py-4 text-center text-base text-muted-foreground">
                      No MCP servers configured.
                    </div>
                  )}
                </div>
              </div>

              <div className="shrink-0 border-t bg-card/90 p-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-[36px] w-full"
                  onClick={requestAddServer}
                >
                  <Plus className="size-4" />
                  Add server
                </Button>
              </div>
            </aside>

            <div className="min-h-0 flex flex-col overflow-hidden">
              {activeServer ? (
                <>
                  <div className="z-20 flex  shrink-0 items-center border-b bg-background px-4 py-2">
                    <div className="flex w-full items-center justify-between gap-4">
                      <div>
                        <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                          {isNewServer ? "New MCP server" : "Edit MCP server"}
                        </Label>
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
                              <Trash2 className="size-4 text-destructive" />
                              Discard
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={deleteActiveServer}
                            >
                              <Trash2 className="size-4 text-destructive" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
                    <div className="grid gap-5 pb-1">
                      {testResult &&
                        testResult.serverId === activeServer.id && (
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
                        <FieldLabel
                          htmlFor="mcp-server-name"
                          label="Name"
                          description="Display name used for this server and its generated MCP tool names. Must be unique, 1–48 characters, using letters, numbers, underscores, or hyphens."
                        />
                        <Input
                          id="mcp-server-name"
                          value={activeServer.name}
                          onChange={(event) =>
                            updateActiveServer({ name: event.target.value })
                          }
                          placeholder="github"
                        />
                        <div className="text-sm text-muted-foreground">
                          Use 1–48 letters, numbers, underscores, or hyphens.
                          Names are unique case-insensitively.
                        </div>
                      </div>

                      <div className="grid gap-2">
                        <FieldLabel
                          label="Transport"
                          description="Connection type. Stdio starts a local process; HTTP connects to a Streamable HTTP MCP endpoint."
                        />
                        <Select
                          value={activeServer.transport}
                          onValueChange={(transport) =>
                            updateActiveServer({
                              transport:
                                transport === "http" ? "http" : "stdio",
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="stdio">stdio</SelectItem>
                            <SelectItem value="http">
                              HTTP / Streamable HTTP
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {activeServer.transport === "stdio" ? (
                        <>
                          <div className="grid gap-2">
                            <FieldLabel
                              label="Command"
                              description="Executable used to start a stdio MCP server, such as npx, node, python, uvx, or a full path."
                            />
                            <Input
                              placeholder="npx"
                              value={activeServer.command ?? ""}
                              onChange={(event) =>
                                updateActiveServer({
                                  command: event.target.value,
                                })
                              }
                            />
                          </div>

                          <div className="grid gap-2">
                            <FieldLabel
                              label="Args, one per line"
                              description="Arguments passed to the command. Put each argument on a separate line."
                            />
                            <Textarea
                              className="min-h-24 font-mono text-xs"
                              placeholder={
                                "-y\n@modelcontextprotocol/server-filesystem\nC:/Users/..."
                              }
                              value={argsToText(activeServer.args)}
                              onChange={(event) =>
                                updateActiveServer({
                                  args: textToArgs(event.target.value),
                                })
                              }
                            />
                          </div>

                          <div className="grid gap-2">
                            <FieldLabel
                              label="Working directory"
                              description="Folder where the command runs. Use it when the server expects local config files or project-relative paths."
                            />
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
                            <FieldLabel
                              label="Environment variables"
                              description="KEY=value entries passed to the server process. Use for API keys, tokens, secrets, flags, or environment-based config."
                            />
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
                            <FieldLabel
                              label="URL"
                              description="Streamable HTTP MCP endpoint for this server, for example a local or remote /mcp URL."
                            />
                            <Input
                              placeholder="http://localhost:3000/mcp"
                              value={activeServer.url ?? ""}
                              onChange={(event) =>
                                updateActiveServer({ url: event.target.value })
                              }
                            />
                          </div>

                          <div className="grid gap-2">
                            <FieldLabel
                              label="Headers"
                              description="HTTP headers sent to the server. Put one key=value entry per line, for example Authorization=Bearer ..."
                            />
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
                        <FieldLabel
                          label="Timeout, ms"
                          description="Maximum time to wait for startup, tool discovery, and tool calls before failing."
                        />
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
                          info="Disables TLS certificate validation. Useful for trusted local or corporate-proxy servers only."
                          checked={activeServer.insecureSkipTlsVerify ?? false}
                          onCheckedChange={(checked) =>
                            updateActiveServer({
                              insecureSkipTlsVerify: checked,
                            })
                          }
                        />
                      )}

                      <div className="grid gap-3 pt-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-base font-medium leading-6">
                                Discovered tools
                              </h4>
                              <InfoTooltip label="Discovered tools">
                                Tools discovered from this server. Enable a
                                tool here to show it in Tools settings and model
                                context; permissions are configured in Tools
                                settings.
                              </InfoTooltip>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Disabled tools stay hidden from Tools settings and
                              model context.
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
                                busyServerId === activeServer.id &&
                                  "animate-spin",
                              )}
                            />
                            Load tools
                          </Button>
                        </div>

                        {sortTools(activeServer.tools).length > 0 ? (
                          <div className="border bg-muted/20 px-3 py-2 text-sm leading-5 text-muted-foreground">
                            Tool switches here control whether MCP tools are
                            visible in Tools settings and model context. Ask,
                            Allow, and Deny are still configured in Tools
                            settings after a tool is enabled.
                          </div>
                        ) : null}

                        <div className="grid gap-2">
                          {sortTools(activeServer.tools).length === 0 ? (
                            <div className="border border-dashed px-3 py-4 text-center text-base text-muted-foreground">
                              No tools discovered yet. Use Load tools after
                              configuring the server.
                            </div>
                          ) : (
                            sortTools(activeServer.tools).map((tool) => (
                              <div
                                key={tool.originalName}
                                role="button"
                                aria-pressed={tool.enabled}
                                tabIndex={0}
                                className="cursor-pointer select-none border bg-background px-3 py-2 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => {
                                  updateActiveServerToolEnabled(
                                    tool.originalName,
                                    !tool.enabled,
                                  );
                                }}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    updateActiveServerToolEnabled(
                                      tool.originalName,
                                      !tool.enabled,
                                    );
                                  }
                                }}
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0">
                                    <div className="truncate text-base font-medium leading-6">
                                      {tool.originalName}
                                    </div>
                                    <div className="mt-0.5 break-all font-mono text-xs font-medium text-muted-foreground">
                                      {createMcpExposedToolName(
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
                                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                                    <Switch
                                      id={`mcp-tool-${activeServer.id}-${tool.originalName}`}
                                      checked={tool.enabled}
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                      onCheckedChange={(checked) =>
                                        updateActiveServerToolEnabled(
                                          tool.originalName,
                                          checked,
                                        )
                                      }
                                      className="shrink-0 cursor-pointer"
                                    />
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <DialogFooter className="shrink-0 items-center border-t bg-background px-4 py-2 sm:justify-between">
                    <div
                      className="text-sm text-muted-foreground"
                      aria-live="polite"
                    >
                      {hasChanges ? "Unsaved changes" : null}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={resetCurrentDraft}
                        disabled={isSaving || (!isNewServer && !hasChanges)}
                      >
                        {isNewServer ? "Cancel" : "Reset"}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void saveCurrentDraft()}
                        disabled={!hasChanges || isSaving}
                      >
                        {isSaving
                          ? isNewServer
                            ? "Creating..."
                            : "Saving..."
                          : isNewServer
                            ? "Create"
                            : "Save"}
                      </Button>
                    </div>
                  </DialogFooter>
                </>
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-muted-foreground">
                  <div className="grid max-w-sm gap-2">
                    <Server className="mx-auto size-8 opacity-50" />
                    <div className="text-lg font-medium text-foreground">
                      No MCP server selected
                    </div>
                    <p className="text-base leading-6">
                      Create a server or select one from the list to edit its
                      connection settings.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <UnsavedChangesDialog
        open={unsavedChangesDialogOpen}
        onCancel={cancelDiscardUnsavedChanges}
        onDiscard={confirmDiscardUnsavedChanges}
      />
    </>
  );
});
