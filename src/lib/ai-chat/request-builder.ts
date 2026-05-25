import {
  getProviderFallbackModel,
  isModelEnabled,
  isProviderEnabled,
  normalizeProviderForState,
} from "@/lib/ai-chat/chat-utils";
import {
  ASK_USER_TOOL,
  ASK_USER_TOOL_NAME,
  CHECKLIST_WRITE_TOOL,
  CHECKLIST_WRITE_TOOL_NAME,
  LOAD_SKILL_TOOL_NAME,
  WEB_FETCH_TOOL,
  WEB_FETCH_TOOL_NAME,
  createLoadSkillTool,
  isValidToolName,
  parseAgentMentionNames,
  parseSkillMentionNames,
  parseToolMentionNames,
} from "@/lib/ai-chat/builtin-tools";
import type {
  AgentsSettings,
  ChatSession,
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
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
          tool.name !== CHECKLIST_WRITE_TOOL_NAME &&
          tool.name !== LOAD_SKILL_TOOL_NAME &&
          tool.name !== WEB_FETCH_TOOL_NAME,
      )
    : [];

  if (!toolsSettings.enabled) return enabledCommandTools;

  return [
    ...(toolsSettings.askUserEnabled ? [ASK_USER_TOOL] : []),
    ...(toolsSettings.checklistWriteEnabled ? [CHECKLIST_WRITE_TOOL] : []),
    ...(toolsSettings.webFetchEnabled ? [WEB_FETCH_TOOL] : []),
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
}: {
  chat: ChatSession;
  globalEnabledSkills: LoadedSkillInfo[];
  availableSkillsByName: Map<string, LoadedSkillInfo>;
}) {
  const byName = new Map<string, LoadedSkillInfo>();
  const chatDisabledSkillNames = new Set(chat.disabledSkillNames ?? []);

  for (const skill of globalEnabledSkills) {
    if (chatDisabledSkillNames.has(skill.name)) continue;
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
}: {
  chat: ChatSession;
  globalEnabledAgents: LoadedAgentInfo[];
  availableAgentsByName: Map<string, LoadedAgentInfo>;
}) {
  const globallyEnabledAgentNames = new Set(
    globalEnabledAgents.map((agent) => agent.name),
  );
  const chatEnabledAgentNames = new Set(chat.enabledAgentNames ?? []);
  const chatDisabledAgentNames = new Set(chat.disabledAgentNames ?? []);

  return [...availableAgentsByName.values()].filter((agent) => {
    if (!agent.enabled) return false;
    if (chatDisabledAgentNames.has(agent.name)) return false;
    return (
      globallyEnabledAgentNames.has(agent.name) ||
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
}: {
  systemPrompt: string;
  activeSkillNames: string[];
  availableSkillsByName: Map<string, LoadedSkillInfo>;
}) {
  const activeSkills = activeSkillNames
    .map((skillName) => availableSkillsByName.get(skillName))
    .filter((skill): skill is LoadedSkillInfo => Boolean(skill));

  if (activeSkills.length === 0) return systemPrompt;

  const skillBlocks = activeSkills.map((skill) => {
    const recommendedTools = skill.recommendedToolNames.length
      ? `\n\nRecommended tools for this skill:\n${skill.recommendedToolNames
          .map((toolName) => `- ${toolName}`)
          .join("\n")}`
      : "";

    return `<skill name="${skill.name}">\n${skill.instructions.trim()}${recommendedTools}\n</skill>`;
  });

  return [
    systemPrompt.trim(),
    "Active skills are persistent instructions loaded for this chat. Follow them when relevant.",
    ...skillBlocks,
  ]
    .filter(Boolean)
    .join("\n\n");
}
