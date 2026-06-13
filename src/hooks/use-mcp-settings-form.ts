import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createEmptyMcpServer,
  createUniqueMcpServerName,
  regenerateMcpServerToolExposedNames,
  validateMcpServerName,
} from "@/lib/ai-chat/mcp";
import type { McpServerConfig, McpSettings } from "@/lib/ai-chat/types";

type McpTestResult = {
  serverId: string;
  ok: boolean;
  title: string;
  message: string;
};

type UseMcpSettingsFormOptions = {
  open: boolean;
  mcpSettings: McpSettings;
  onOpenChange: (open: boolean) => void;
  onMcpSettingsChange: (settings: McpSettings) => void;
  showSuccess: (message: string, description?: string) => void;
  showError: (message: string, description?: string) => void;
};

function cloneServer(server: McpServerConfig): McpServerConfig {
  return JSON.parse(JSON.stringify(server)) as McpServerConfig;
}

function cloneSettings(settings: McpSettings): McpSettings {
  return JSON.parse(JSON.stringify(settings)) as McpSettings;
}

function stripTransientMcpServerState(
  server: McpServerConfig,
): McpServerConfig {
  const { lastError: _lastError, ...rest } = server;
  return rest;
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

function serverFormSnapshot(server: McpServerConfig | null) {
  if (!server) return null;

  return {
    ...server,
    id: "",
    enabled: true,
    tools: server.tools ?? {},
    lastError: undefined,
    lastConnectedAt: undefined,
  };
}

function hasServerFormChanges(
  server: McpServerConfig | null,
  base: McpServerConfig | null,
) {
  if (!server || !base) return false;
  return !areEqual(serverFormSnapshot(server), serverFormSnapshot(base));
}

function withServer(
  settings: McpSettings,
  serverId: string,
  updater: (server: McpServerConfig) => McpServerConfig,
): McpSettings {
  return {
    ...settings,
    servers: settings.servers.map((server) =>
      server.id === serverId ? updater(server) : server,
    ),
  };
}

function replaceOrAppendServer(
  settings: McpSettings,
  server: McpServerConfig,
  isNewServer: boolean,
): McpSettings {
  if (isNewServer) {
    return {
      ...settings,
      servers: [...settings.servers, server],
    };
  }

  return withServer(settings, server.id, (current) => ({
    ...server,
    enabled: current.enabled,
  }));
}

export function useMcpSettingsForm({
  open,
  mcpSettings,
  onOpenChange,
  onMcpSettingsChange,
  showSuccess,
  showError,
}: UseMcpSettingsFormOptions) {
  const [selectedServerId, setSelectedServerId] = useState<
    string | undefined
  >();
  const [activeServerDraft, setActiveServerDraft] =
    useState<McpServerConfig | null>(null);
  const [activeServerBase, setActiveServerBase] =
    useState<McpServerConfig | null>(null);
  const [isNewServer, setIsNewServer] = useState(false);
  const [busyServerId, setBusyServerId] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);
  const [pendingNavigationAction, setPendingNavigationAction] = useState<
    (() => void) | null
  >(null);

  const selectSavedServer = useCallback(
    (serverId: string | undefined, settings: McpSettings = mcpSettings) => {
      const server = settings.servers.find((item) => item.id === serverId);
      setSelectedServerId(server?.id);
      setActiveServerDraft(server ? cloneServer(server) : null);
      setActiveServerBase(server ? cloneServer(server) : null);
      setIsNewServer(false);
      setTestResult(null);
    },
    [mcpSettings],
  );

  useEffect(() => {
    if (!open) return;
    selectSavedServer(mcpSettings.servers[0]?.id, mcpSettings);
    setBusyServerId(undefined);
    setIsSaving(false);
    setPendingNavigationAction(null);
  }, [open]);

  useEffect(() => {
    if (!open || isNewServer) return;
    if (
      activeServerDraft &&
      hasServerFormChanges(activeServerDraft, activeServerBase)
    ) {
      return;
    }

    const currentServer = mcpSettings.servers.find(
      (server) => server.id === selectedServerId,
    );

    if (currentServer) {
      setActiveServerDraft(cloneServer(currentServer));
      setActiveServerBase(cloneServer(currentServer));
      return;
    }

    selectSavedServer(mcpSettings.servers[0]?.id, mcpSettings);
  }, [mcpSettings, open, isNewServer, selectedServerId]);

  const activeServer = activeServerDraft;
  const formChanged = hasServerFormChanges(activeServerDraft, activeServerBase);
  const hasChanges = formChanged;
  const unsavedChangesDialogOpen = Boolean(pendingNavigationAction);

  const requestNavigation = useCallback(
    (action: () => void) => {
      if (hasChanges) {
        setPendingNavigationAction(() => action);
        return;
      }

      action();
    },
    [hasChanges],
  );

  const confirmDiscardUnsavedChanges = useCallback(() => {
    const action = pendingNavigationAction;
    setPendingNavigationAction(null);
    action?.();
  }, [pendingNavigationAction]);

  const cancelDiscardUnsavedChanges = useCallback(() => {
    setPendingNavigationAction(null);
  }, []);

  const requestClose = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }

      requestNavigation(() => onOpenChange(false));
    },
    [onOpenChange, requestNavigation],
  );

  const updateGlobalEnabled = useCallback(
    (enabled: boolean) => {
      onMcpSettingsChange(
        cloneSettings({
          ...mcpSettings,
          enabled,
        }),
      );
    },
    [mcpSettings, onMcpSettingsChange],
  );

  const updateServerEnabled = useCallback(
    (serverId: string, enabled: boolean) => {
      const nextSettings = withServer(mcpSettings, serverId, (server) => ({
        ...server,
        enabled,
      }));

      onMcpSettingsChange(cloneSettings(nextSettings));

      if (!isNewServer && activeServerDraft?.id === serverId) {
        setActiveServerDraft((current) =>
          current ? { ...current, enabled } : current,
        );
        setActiveServerBase((current) =>
          current ? { ...current, enabled } : current,
        );
      }
    },
    [activeServerDraft?.id, isNewServer, mcpSettings, onMcpSettingsChange],
  );

  const requestSelectServer = useCallback(
    (serverId: string) => {
      if (!isNewServer && selectedServerId === serverId) return;
      requestNavigation(() => selectSavedServer(serverId, mcpSettings));
    },
    [
      isNewServer,
      mcpSettings,
      requestNavigation,
      selectSavedServer,
      selectedServerId,
    ],
  );

  const requestAddServer = useCallback(() => {
    requestNavigation(() => {
      const server = {
        ...createEmptyMcpServer(),
        name: createUniqueMcpServerName("new-mcp-server", mcpSettings.servers),
      };
      setSelectedServerId(undefined);
      setActiveServerDraft(server);
      setActiveServerBase(cloneServer(server));
      setIsNewServer(true);
      setTestResult(null);
    });
  }, [mcpSettings.servers, requestNavigation]);

  const updateActiveServer = useCallback((patch: Partial<McpServerConfig>) => {
    setActiveServerDraft((current) =>
      current ? { ...current, ...patch } : current,
    );
  }, []);

  const updateActiveServerToolEnabled = useCallback(
    (toolName: string, enabled: boolean) => {
      setActiveServerDraft((current) => {
        if (!current) return current;
        const tool = current.tools?.[toolName];
        if (!tool) return current;

        return {
          ...current,
          tools: {
            ...(current.tools ?? {}),
            [toolName]: {
              ...tool,
              enabled,
            },
          },
        };
      });
    },
    [],
  );

  const discardNewServer = useCallback(() => {
    requestNavigation(() =>
      selectSavedServer(mcpSettings.servers[0]?.id, mcpSettings),
    );
  }, [mcpSettings, requestNavigation, selectSavedServer]);

  const deleteActiveServer = useCallback(() => {
    if (!activeServerDraft || isNewServer) return;

    const nextServers = mcpSettings.servers.filter(
      (server) => server.id !== activeServerDraft.id,
    );
    const nextSettings = cloneSettings({
      ...mcpSettings,
      servers: nextServers,
    });

    onMcpSettingsChange(nextSettings);
    selectSavedServer(nextServers[0]?.id, nextSettings);
    showSuccess("MCP server deleted");
  }, [
    activeServerDraft,
    isNewServer,
    mcpSettings,
    onMcpSettingsChange,
    selectSavedServer,
    showSuccess,
  ]);

  const saveCurrentDraft = useCallback(async () => {
    if (!activeServerDraft) return;

    const nameError = validateMcpServerName(
      activeServerDraft.name,
      mcpSettings.servers,
      isNewServer ? undefined : activeServerDraft.id,
    );

    if (nameError) {
      showError("Invalid MCP server name", nameError);
      return;
    }

    setIsSaving(true);
    try {
      const trimmedServer = {
        ...activeServerDraft,
        name: activeServerDraft.name.trim(),
      };
      const serverWithToolNames = regenerateMcpServerToolExposedNames(
        stripTransientMcpServerState(trimmedServer),
      );
      const nextSettings = cloneSettings(
        replaceOrAppendServer(mcpSettings, serverWithToolNames, isNewServer),
      );

      onMcpSettingsChange(nextSettings);
      selectSavedServer(serverWithToolNames.id, nextSettings);
      showSuccess("MCP settings saved");
    } finally {
      setIsSaving(false);
    }
  }, [
    activeServerDraft,
    isNewServer,
    mcpSettings,
    onMcpSettingsChange,
    selectSavedServer,
    showError,
    showSuccess,
  ]);

  const resetCurrentDraft = useCallback(() => {
    if (isNewServer) {
      selectSavedServer(mcpSettings.servers[0]?.id, mcpSettings);
      return;
    }

    selectSavedServer(selectedServerId, mcpSettings);
  }, [isNewServer, mcpSettings, selectSavedServer, selectedServerId]);

  const testServer = useCallback(
    async (server: McpServerConfig) => {
      const bridge = window.moltenForgeMcp;
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
    },
    [showError, showSuccess],
  );

  const refreshServer = useCallback(
    async (server: McpServerConfig) => {
      const bridge = window.moltenForgeMcp;
      if (!bridge) {
        showError("MCP bridge is unavailable.");
        return;
      }

      const settingsForRefresh = replaceOrAppendServer(
        mcpSettings,
        server,
        isNewServer,
      );

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

        if (updatedServer) {
          const nextServer = hasServerFormChanges(
            updatedServer,
            activeServerBase,
          )
            ? regenerateMcpServerToolExposedNames(updatedServer)
            : updatedServer;
          setActiveServerDraft(nextServer);
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
    },
    [activeServerBase, isNewServer, mcpSettings, showError, showSuccess],
  );

  const sortedServers = useMemo(
    () => mcpSettings.servers,
    [mcpSettings.servers],
  );

  return {
    activeServer,
    busyServerId,
    cancelDiscardUnsavedChanges,
    confirmDiscardUnsavedChanges,
    deleteActiveServer,
    discardNewServer,
    hasChanges,
    isNewServer,
    isSaving,
    mcpEnabled: mcpSettings.enabled,
    refreshServer,
    requestAddServer,
    requestClose,
    requestSelectServer,
    resetCurrentDraft,
    savedServers: sortedServers,
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
  };
}
