import {
  getProviderFallbackModel,
  isModelEnabled,
  isProviderEnabled,
  normalizeProviderForState,
} from "@/lib/ai-chat/chat-utils";
import {
  ASK_USER_TOOL,
  ASK_USER_TOOL_NAME,
  CALL_AGENT_TOOL_NAME,
  TASK_TOOLS,
  isTaskToolName,
  LOAD_SKILL_TOOL_NAME,
  WEB_FETCH_TOOL,
  WEB_FETCH_TOOL_NAME,
  TERMINAL_EXEC_TOOL,
  FILE_READ_TOOL,
  FILE_READ_TOOL_NAME,
  FILE_FIND_TOOL,
  FILE_FIND_TOOL_NAME,
  FILE_SEARCH_TEXT_TOOL,
  FILE_SEARCH_TEXT_TOOL_NAME,
  FILE_REPLACE_TEXT_TOOL,
  FILE_REPLACE_TEXT_TOOL_NAME,
  FILE_CREATE_TOOL,
  FILE_CREATE_TOOL_NAME,
  FILE_DELETE_TOOL,
  FILE_DELETE_TOOL_NAME,
  ARCHIVE_EXTRACT_TOOL,
  ARCHIVE_EXTRACT_TOOL_NAME,
  ARCHIVE_CREATE_TOOL,
  ARCHIVE_CREATE_TOOL_NAME,
  DOCUMENT_CONVERT_TOOL,
  DOCUMENT_CONVERT_TOOL_NAME,
  CHAT_FILE_CREATE_TOOL,
  CHAT_FILE_CREATE_TOOL_NAME,
  createLoadSkillTool,
  isValidToolName,
  parseAgentMentionNames,
  parseSkillMentionNames,
  parseToolMentionNames,
} from "@/lib/ai-chat/builtin-tools";
import { TERMINAL_EXEC_TOOL_NAME } from "@/lib/ai-chat/terminal-tool";
import { getModeCapabilityNames, getModeInstructionsBlock } from "@/lib/ai-chat/modes";
import type {
  AgentsSettings,
  ChatSession,
  ChatWorkspaceRoot,
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  LoadedModeInfo,
  ProviderConfig,
  SkillsSettings,
  ToolsSettings,
} from "@/lib/ai-chat/types";

export function resolveProviderForChat({
  activeProvider,
}: {
  chat: ChatSession;
  providers: ProviderConfig[];
  activeProvider: ProviderConfig;
}) {
  const model = activeProvider.model?.trim() || getProviderFallbackModel(activeProvider);

  return normalizeProviderForState({ ...activeProvider, model });
}

export function validateProviderForGeneration(providerForRun: ProviderConfig) {
  if (!isProviderEnabled(providerForRun)) {
    return {
      ok: false as const,
      message: "Provider is disabled.",
      description:
        "Enable the provider in provider settings or select another model.",
      shouldOpenSettings: true,
    };
  }

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

  if (!isModelEnabled(providerForRun, providerForRun.model)) {
    return {
      ok: false as const,
      message: "Model is disabled.",
      description:
        "Enable the model in provider settings or select another model.",
      shouldOpenSettings: true,
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
          tool.name !== CALL_AGENT_TOOL_NAME &&
          !isTaskToolName(tool.name) &&
          tool.name !== LOAD_SKILL_TOOL_NAME &&
          tool.name !== WEB_FETCH_TOOL_NAME &&
          tool.name !== TERMINAL_EXEC_TOOL_NAME &&
          tool.name !== FILE_READ_TOOL_NAME &&
          tool.name !== FILE_FIND_TOOL_NAME &&
          tool.name !== FILE_SEARCH_TEXT_TOOL_NAME &&
          tool.name !== FILE_REPLACE_TEXT_TOOL_NAME &&
          tool.name !== FILE_CREATE_TOOL_NAME &&
          tool.name !== FILE_DELETE_TOOL_NAME &&
          tool.name !== ARCHIVE_EXTRACT_TOOL_NAME &&
          tool.name !== ARCHIVE_CREATE_TOOL_NAME &&
          tool.name !== DOCUMENT_CONVERT_TOOL_NAME &&
          tool.name !== CHAT_FILE_CREATE_TOOL_NAME,
      )
    : [];

  if (!toolsSettings.enabled) return enabledCommandTools;

  return [
    ...(toolsSettings.askUserEnabled ? [ASK_USER_TOOL] : []),
    ...(toolsSettings.taskToolsEnabled ? TASK_TOOLS : []),
    ...(toolsSettings.webFetchEnabled ? [WEB_FETCH_TOOL] : []),
    ...(toolsSettings.terminalExecEnabled ? [TERMINAL_EXEC_TOOL] : []),
    ...(toolsSettings.fileReadEnabled ? [FILE_READ_TOOL] : []),
    ...(toolsSettings.fileFindEnabled ? [FILE_FIND_TOOL] : []),
    ...(toolsSettings.fileSearchTextEnabled ? [FILE_SEARCH_TEXT_TOOL] : []),
    ...(toolsSettings.fileReplaceTextEnabled ? [FILE_REPLACE_TEXT_TOOL] : []),
    ...(toolsSettings.fileCreateEnabled ? [FILE_CREATE_TOOL] : []),
    ...(toolsSettings.fileDeleteEnabled ? [FILE_DELETE_TOOL] : []),
    ...(toolsSettings.archiveExtractEnabled ? [ARCHIVE_EXTRACT_TOOL] : []),
    ...(toolsSettings.archiveCreateEnabled ? [ARCHIVE_CREATE_TOOL] : []),
    ...(toolsSettings.documentConvertEnabled ? [DOCUMENT_CONVERT_TOOL] : []),
    ...(toolsSettings.chatFileCreateEnabled ? [CHAT_FILE_CREATE_TOOL] : []),
    ...enabledCommandTools,
  ];
}


function normalizeWorkspaceRootPathForCompare(value: string) {
  return value.trim().replace(/[\\/]+$/, "").toLowerCase();
}

export function getSkillWorkspaceRoots({
  activeSkillNames,
  availableSkillsByName,
}: {
  activeSkillNames: string[];
  availableSkillsByName: Map<string, LoadedSkillInfo>;
}): ChatWorkspaceRoot[] {
  return activeSkillNames
    .map((skillName) => availableSkillsByName.get(skillName))
    .filter(
      (skill): skill is LoadedSkillInfo & { directoryPath: string } =>
        Boolean(skill?.directoryPath?.trim()),
    )
    .map((skill) => ({
      id: `skill:${skill.name}`,
      name: `Skill: ${skill.name}`,
      path: skill.directoryPath.trim(),
      createdAt: new Date(0).toISOString(),
    }));
}

export function getEffectiveWorkspaceRoots({
  workspaceRoots = [],
  activeSkillNames,
  availableSkillsByName,
}: {
  workspaceRoots?: ChatWorkspaceRoot[];
  activeSkillNames: string[];
  availableSkillsByName: Map<string, LoadedSkillInfo>;
}): ChatWorkspaceRoot[] {
  const byPath = new Map<string, ChatWorkspaceRoot>();

  for (const root of [
    ...workspaceRoots,
    ...getSkillWorkspaceRoots({ activeSkillNames, availableSkillsByName }),
  ]) {
    const normalizedPath = normalizeWorkspaceRootPathForCompare(root.path);
    if (!normalizedPath || byPath.has(normalizedPath)) continue;
    byPath.set(normalizedPath, root);
  }

  return [...byPath.values()];
}


function toNameSet(names: string[]) {
  return new Set(names.map((name) => name.trim()).filter(Boolean));
}

function isNameAllowedByModeDefault(
  name: string,
  allowedNames: Set<string> | undefined,
) {
  return !allowedNames || allowedNames.has(name);
}

export function getEnabledToolsForChat({
  chat,
  oneShotToolNames = [],
  skillRecommendedToolNames = [],
  globalEnabledTools,
  availableToolsByName,
  effectiveWorkspaceRoots = chat.workspaceRoots ?? [],
  mode,
  modeCapabilityContext,
}: {
  chat: ChatSession;
  oneShotToolNames?: string[];
  skillRecommendedToolNames?: string[];
  globalEnabledTools: LoadedToolInfo[];
  availableToolsByName: Map<string, LoadedToolInfo>;
  effectiveWorkspaceRoots?: ChatWorkspaceRoot[];
  mode?: LoadedModeInfo;
  modeCapabilityContext?: {
    availableTools: LoadedToolInfo[];
    availableSkills: LoadedSkillInfo[];
    availableAgents: LoadedAgentInfo[];
  };
}) {
  const byName = new Map<string, LoadedToolInfo>();
  const chatDisabledToolNames = new Set(chat.disabledToolNames ?? []);
  const modeAllowedToolNames = modeCapabilityContext
    ? toNameSet(getModeCapabilityNames(mode, modeCapabilityContext).toolNames)
    : undefined;

  for (const tool of globalEnabledTools) {
    if (chatDisabledToolNames.has(tool.name)) continue;
    if (!isNameAllowedByModeDefault(tool.name, modeAllowedToolNames)) continue;
    if (!byName.has(tool.name)) byName.set(tool.name, tool);
  }

  for (const toolName of chat.enabledToolNames ?? []) {
    if (chatDisabledToolNames.has(toolName)) continue;

    const tool = availableToolsByName.get(toolName);
    if (tool && !byName.has(tool.name)) byName.set(tool.name, tool);
  }

  for (const toolName of oneShotToolNames) {
    if (chatDisabledToolNames.has(toolName)) continue;

    const tool = availableToolsByName.get(toolName);
    if (tool && !byName.has(tool.name)) byName.set(tool.name, tool);
  }

  for (const toolName of skillRecommendedToolNames) {
    if (chatDisabledToolNames.has(toolName)) continue;

    const tool = availableToolsByName.get(toolName);
    if (tool && !byName.has(tool.name)) byName.set(tool.name, tool);
  }

  if (!effectiveWorkspaceRoots.length) {
    byName.delete(TERMINAL_EXEC_TOOL_NAME);
    byName.delete(FILE_READ_TOOL_NAME);
    byName.delete(FILE_FIND_TOOL_NAME);
    byName.delete(FILE_SEARCH_TEXT_TOOL_NAME);
    byName.delete(FILE_REPLACE_TEXT_TOOL_NAME);
    byName.delete(FILE_CREATE_TOOL_NAME);
    byName.delete(FILE_DELETE_TOOL_NAME);
    byName.delete(ARCHIVE_EXTRACT_TOOL_NAME);
    byName.delete(ARCHIVE_CREATE_TOOL_NAME);
    byName.delete(DOCUMENT_CONVERT_TOOL_NAME);
    byName.delete(CHAT_FILE_CREATE_TOOL_NAME);
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

export function getGlobalEnabledSkills({
  skillsSettings,
  loadedSkills,
}: {
  skillsSettings: SkillsSettings;
  loadedSkills: LoadedSkillInfo[];
}) {
  if (!skillsSettings.enabled) return [];

  return loadedSkills.filter((skill) => skill.enabled);
}

export function getEnabledSkillsForChat({
  chat,
  globalEnabledSkills,
  availableSkillsByName,
  mode,
  modeCapabilityContext,
}: {
  chat: ChatSession;
  globalEnabledSkills: LoadedSkillInfo[];
  availableSkillsByName: Map<string, LoadedSkillInfo>;
  mode?: LoadedModeInfo;
  modeCapabilityContext?: {
    availableTools: LoadedToolInfo[];
    availableSkills: LoadedSkillInfo[];
    availableAgents: LoadedAgentInfo[];
  };
}) {
  const byName = new Map<string, LoadedSkillInfo>();
  const chatDisabledSkillNames = new Set(chat.disabledSkillNames ?? []);
  const modeAllowedSkillNames = modeCapabilityContext
    ? toNameSet(getModeCapabilityNames(mode, modeCapabilityContext).skillNames)
    : undefined;

  for (const skill of globalEnabledSkills) {
    if (chatDisabledSkillNames.has(skill.name)) continue;
    if (!isNameAllowedByModeDefault(skill.name, modeAllowedSkillNames)) continue;
    if (!byName.has(skill.name)) byName.set(skill.name, skill);
  }

  for (const skillName of chat.enabledSkillNames ?? []) {
    if (chatDisabledSkillNames.has(skillName)) continue;

    const skill = availableSkillsByName.get(skillName);
    if (skill && !byName.has(skill.name)) byName.set(skill.name, skill);
  }

  return [...byName.values()];
}

export function getToolsWithLoadSkillTool({
  tools,
  modelSelectableSkills,
  activeSkillNames,
  loadSkillEnabled,
}: {
  tools: LoadedToolInfo[];
  modelSelectableSkills: LoadedSkillInfo[];
  activeSkillNames: string[];
  loadSkillEnabled: boolean;
}) {
  if (!loadSkillEnabled) return tools;

  const activeSkillNameSet = new Set(activeSkillNames);
  const unloadedSkills = modelSelectableSkills.filter(
    (skill) => !activeSkillNameSet.has(skill.name),
  );
  const loadSkillTool = createLoadSkillTool(unloadedSkills);

  return loadSkillTool ? [...tools, loadSkillTool] : tools;
}

export function validateSkillMentionsForRequest({
  content,
  availableSkillsByName,
}: {
  content: string;
  availableSkillsByName: Map<string, LoadedSkillInfo>;
}) {
  const skillNames = parseSkillMentionNames(content);
  const unknownSkillNames = skillNames.filter(
    (skillName) => !availableSkillsByName.has(skillName),
  );

  if (unknownSkillNames.length > 0) {
    return {
      ok: false as const,
      unknownSkillNames,
      message:
        unknownSkillNames.length === 1
          ? `Skill not found: ${unknownSkillNames[0]}`
          : `Skills not found: ${unknownSkillNames.join(", ")}`,
    };
  }

  return { ok: true as const, skillNames };
}

export function getGlobalEnabledAgents({
  agentsSettings,
  loadedAgents,
}: {
  agentsSettings: AgentsSettings;
  loadedAgents: LoadedAgentInfo[];
}) {
  if (!agentsSettings.enabled) return [];

  return loadedAgents.filter((agent) => agent.enabled);
}

export function getEnabledAgentsForChat({
  chat,
  globalEnabledAgents,
  availableAgentsByName,
  mode,
  modeCapabilityContext,
}: {
  chat: ChatSession;
  globalEnabledAgents: LoadedAgentInfo[];
  availableAgentsByName: Map<string, LoadedAgentInfo>;
  mode?: LoadedModeInfo;
  modeCapabilityContext?: {
    availableTools: LoadedToolInfo[];
    availableSkills: LoadedSkillInfo[];
    availableAgents: LoadedAgentInfo[];
  };
}) {
  const globallyEnabledAgentNames = new Set(
    globalEnabledAgents.map((agent) => agent.name),
  );
  const chatEnabledAgentNames = new Set(chat.enabledAgentNames ?? []);
  const chatDisabledAgentNames = new Set(chat.disabledAgentNames ?? []);
  const modeAllowedAgentNames = modeCapabilityContext
    ? toNameSet(getModeCapabilityNames(mode, modeCapabilityContext).agentNames)
    : undefined;

  return [...availableAgentsByName.values()].filter((agent) => {
    if (!agent.enabled) return false;
    if (chatDisabledAgentNames.has(agent.name)) return false;
    return (
      (globallyEnabledAgentNames.has(agent.name) &&
        isNameAllowedByModeDefault(agent.name, modeAllowedAgentNames)) ||
      chatEnabledAgentNames.has(agent.name)
    );
  });
}

export function validateAgentMentionsForRequest({
  content,
  availableAgentsByName,
}: {
  content: string;
  availableAgentsByName: Map<string, LoadedAgentInfo>;
}) {
  const agentNames = parseAgentMentionNames(content);
  const unknownAgentNames = agentNames.filter(
    (agentName) => !availableAgentsByName.has(agentName),
  );

  if (unknownAgentNames.length > 0) {
    return {
      ok: false as const,
      unknownAgentNames,
      message:
        unknownAgentNames.length === 1
          ? `Agent not found: ${unknownAgentNames[0]}`
          : `Agents not found: ${unknownAgentNames.join(", ")}`,
    };
  }

  const disabledAgentNames = agentNames.filter(
    (agentName) => !availableAgentsByName.get(agentName)?.enabled,
  );

  if (disabledAgentNames.length > 0) {
    return {
      ok: false as const,
      disabledAgentNames,
      message:
        disabledAgentNames.length === 1
          ? `Agent is disabled: ${disabledAgentNames[0]}`
          : `Agents are disabled: ${disabledAgentNames.join(", ")}`,
    };
  }

  return { ok: true as const, agentNames };
}

export function buildSystemPromptWithActiveSkills({
  systemPrompt,
  activeSkillNames,
  availableSkillsByName,
  mode,
}: {
  systemPrompt: string;
  activeSkillNames: string[];
  availableSkillsByName: Map<string, LoadedSkillInfo>;
  mode?: LoadedModeInfo;
}) {
  const activeSkills = activeSkillNames
    .map((skillName) => availableSkillsByName.get(skillName))
    .filter((skill): skill is LoadedSkillInfo => Boolean(skill));

  const modeBlock = getModeInstructionsBlock(mode);

  if (activeSkills.length === 0) {
    return [systemPrompt.trim(), modeBlock].filter(Boolean).join("\n\n");
  }

  const skillBlocks = activeSkills.map((skill) => {
    const recommendedTools = skill.recommendedToolNames.length
      ? `\n\nRecommended tools for this skill:\n${skill.recommendedToolNames
          .map((toolName) => `- ${toolName}`)
          .join("\n")}`
      : "";

    const skillFiles = skill.directoryPath
      ? `\n\nThis skill's bundled files are in: ${skill.directoryPath}\nThis folder is automatically available to file tools as workspace rootId "skill:${skill.name}" while the skill is active. When the instructions above reference a file (for example one under references/), use file_find or file_read with paths relative to that folder.`
      : "";

    return `<skill name="${skill.name}">\n${skill.instructions.trim()}${recommendedTools}${skillFiles}\n</skill>`;
  });

  return [
    systemPrompt.trim(),
    modeBlock,
    "Active skills are persistent instructions loaded for this chat. Follow them when relevant.",
    ...skillBlocks,
  ]
    .filter(Boolean)
    .join("\n\n");
}
