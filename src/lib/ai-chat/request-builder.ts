import {
  getProviderFallbackModel,
  normalizeProviderForState,
} from "@/lib/ai-chat/chat-utils";
import {
  ASK_USER_TOOL,
  ASK_USER_TOOL_NAME,
  CHECKLIST_WRITE_TOOL,
  CHECKLIST_WRITE_TOOL_NAME,
  isValidToolName,
  parseToolMentionNames,
} from "@/lib/ai-chat/builtin-tools";
import type {
  ChatSession,
  LoadedToolInfo,
  ProviderConfig,
  ToolsSettings,
} from "@/lib/ai-chat/types";

export function resolveProviderForChat({
  chat,
  providers,
  activeProvider,
}: {
  chat: ChatSession;
  providers: ProviderConfig[];
  activeProvider: ProviderConfig;
}) {
  const provider =
    providers.find((item) => item.id === chat.providerId) ?? activeProvider;
  const model = chat.model?.trim() || getProviderFallbackModel(provider);

  return normalizeProviderForState({ ...provider, model });
}

export function validateProviderForGeneration(providerForRun: ProviderConfig) {
  if (!providerForRun.baseUrl.trim()) {
    return {
      ok: false as const,
      message: "Provider base URL is required.",
      shouldOpenSettings: true,
    };
  }

  if (!providerForRun.model.trim()) {
    return {
      ok: false as const,
      message: "Model name is required",
      description: "Select a visible model in the sidebar model selector.",
    };
  }

  return { ok: true as const };
}

export function getGlobalEnabledTools({
  toolsSettings,
  loadedTools,
}: {
  toolsSettings: ToolsSettings;
  loadedTools: LoadedToolInfo[];
}) {
  const enabledCommandTools = toolsSettings.enabled
    ? loadedTools.filter(
        (tool) =>
          tool.enabled &&
          tool.name !== ASK_USER_TOOL_NAME &&
          tool.name !== CHECKLIST_WRITE_TOOL_NAME,
      )
    : [];

  if (!toolsSettings.enabled) return enabledCommandTools;

  return [
    ...(toolsSettings.askUserEnabled ? [ASK_USER_TOOL] : []),
    ...(toolsSettings.checklistWriteEnabled ? [CHECKLIST_WRITE_TOOL] : []),
    ...enabledCommandTools,
  ];
}

export function getEnabledToolsForChat({
  chat,
  oneShotToolNames = [],
  globalEnabledTools,
  availableToolsByName,
}: {
  chat: ChatSession;
  oneShotToolNames?: string[];
  globalEnabledTools: LoadedToolInfo[];
  availableToolsByName: Map<string, LoadedToolInfo>;
}) {
  const byName = new Map<string, LoadedToolInfo>();
  const chatDisabledToolNames = new Set(chat.disabledToolNames ?? []);

  for (const tool of globalEnabledTools) {
    if (chatDisabledToolNames.has(tool.name)) continue;
    if (!byName.has(tool.name)) byName.set(tool.name, tool);
  }

  for (const toolName of chat.enabledToolNames ?? []) {
    if (chatDisabledToolNames.has(toolName)) continue;

    const tool = availableToolsByName.get(toolName);
    if (tool && !byName.has(tool.name)) byName.set(tool.name, tool);
  }

  for (const toolName of oneShotToolNames) {
    const tool = availableToolsByName.get(toolName);
    if (tool && !byName.has(tool.name)) byName.set(tool.name, tool);
  }

  return [...byName.values()];
}

export function validateToolMentionsForRequest({
  content,
  availableToolsByName,
}: {
  content: string;
  availableToolsByName: Map<string, LoadedToolInfo>;
}) {
  const toolNames = parseToolMentionNames(content);
  const unknownToolNames = toolNames.filter(
    (toolName) => !availableToolsByName.has(toolName),
  );

  if (unknownToolNames.length > 0) {
    return {
      ok: false as const,
      unknownToolNames,
      message:
        unknownToolNames.length === 1
          ? `Tool not found: ${unknownToolNames[0]}`
          : `Tools not found: ${unknownToolNames.join(", ")}`,
    };
  }

  return { ok: true as const, toolNames };
}

export function filterEnabledToolNames(tools: LoadedToolInfo[]) {
  return tools
    .map((tool) => tool.name)
    .filter((toolName) => isValidToolName(toolName));
}
