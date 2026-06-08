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
  WEB_FETCH_TOOL,
  WEB_FETCH_TOOL_NAME,
  READ_TOOL,
  READ_TOOL_NAME,
  BASH_TOOL,
  BASH_TOOL_NAME,
  EDIT_TOOL,
  EDIT_TOOL_NAME,
  WRITE_TOOL,
  WRITE_TOOL_NAME,
  isValidToolName,
  applyBuiltInToolSettings,
  LOAD_SKILL_TOOL_NAME,
} from "@/lib/ai-chat/builtin-tools";
import { FEATURE_PERMISSION_KEY, getModeInstructionsBlock, getModePermissionMaps, resolvePermission, type ModeCapabilityContext } from "@/lib/ai-chat/modes";
import type {
  AgentsSettings,
  ChatSession,
  ChatWorkspaceRoot,
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  LoadedModeInfo,
  Permission,
  PermissionMap,
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

export function getGlobalToolPermission(
  toolName: string,
  toolsSettings: ToolsSettings,
): Permission {
  const explicit = toolsSettings.toolPermissions?.[toolName];
  if (explicit) return explicit;

  if (toolName === ASK_USER_TOOL_NAME) return toolsSettings.askUserEnabled ? "allow" : "deny";
  if (isTaskToolName(toolName)) return toolsSettings.taskToolsEnabled ? "allow" : "deny";
  if (toolName === LOAD_SKILL_TOOL_NAME) return toolsSettings.loadSkillEnabled ? "ask" : "deny";
  if (toolName === WEB_FETCH_TOOL_NAME) return toolsSettings.webFetchEnabled ? "ask" : "deny";
  if (toolName === READ_TOOL_NAME) return toolsSettings.readEnabled ? (toolsSettings.readAutoApproveEnabled ? "allow" : "ask") : "deny";
  if (toolName === BASH_TOOL_NAME) return toolsSettings.bashEnabled ? (toolsSettings.bashAutoApproveEnabled ? "allow" : "ask") : "deny";
  if (toolName === EDIT_TOOL_NAME) return toolsSettings.editEnabled ? (toolsSettings.editAutoApproveEnabled ? "allow" : "ask") : "deny";
  if (toolName === WRITE_TOOL_NAME) return toolsSettings.writeEnabled ? (toolsSettings.writeAutoApproveEnabled ? "allow" : "ask") : "deny";
  return "ask";
}

export function resolveMasterPermission(
  masterPermission: "custom" | Permission | undefined,
  itemPermission: Permission,
): Permission {
  return masterPermission && masterPermission !== "custom" ? masterPermission : itemPermission;
}

export function getEffectiveGlobalToolPermission(
  toolName: string,
  toolsSettings: ToolsSettings,
): Permission {
  return resolveMasterPermission(
    toolsSettings.toolsPermission ?? "custom",
    getGlobalToolPermission(toolName, toolsSettings),
  );
}

export function getEffectiveGlobalSkillPermission(
  skillName: string,
  skillsSettings: SkillsSettings,
): Permission {
  return resolveMasterPermission(
    skillsSettings.skillsPermission ?? "custom",
    skillsSettings.skillPermissions?.[skillName] ?? (skillsSettings.enabled === false ? "deny" : "ask"),
  );
}

export function getEffectiveGlobalAgentPermission(
  agentName: string,
  agentsSettings: AgentsSettings,
): Permission {
  return resolveMasterPermission(
    agentsSettings.agentsPermission ?? "custom",
    agentsSettings.agentPermissions?.[agentName] ?? (agentsSettings.enabled === false ? "deny" : "ask"),
  );
}

function resolveModeItemPermission({
  name,
  globalPermission,
  modePermissions,
}: {
  name: string;
  globalPermission: Permission;
  modePermissions?: Record<string, "custom" | "global" | Permission>;
}): Permission {
  const masterPermission = modePermissions?.[FEATURE_PERMISSION_KEY];
  if (masterPermission && masterPermission !== "custom") {
    return masterPermission === "global" ? globalPermission : masterPermission;
  }

  const itemPermission = modePermissions?.[name];
  return itemPermission && itemPermission !== "global" && itemPermission !== "custom"
    ? itemPermission
    : globalPermission;
}

export function getGlobalEnabledTools({
  toolsSettings,
  loadedTools,
}: {
  toolsSettings: ToolsSettings;
  loadedTools: LoadedToolInfo[];
}) {
  const builtInTools = [
    ASK_USER_TOOL,
    ...TASK_TOOLS,
    WEB_FETCH_TOOL,
    READ_TOOL,
    BASH_TOOL,
    EDIT_TOOL,
    WRITE_TOOL,
  ];
  const enabledBuiltIns = builtInTools
    .map((tool) => applyBuiltInToolSettings(tool, toolsSettings))
    .map((tool) => withPermissionApproval(tool, getEffectiveGlobalToolPermission(tool.name, toolsSettings)))
    .filter((tool): tool is LoadedToolInfo => Boolean(tool));

  const enabledCommandTools = loadedTools
        .filter(
          (tool) =>
            tool.name !== ASK_USER_TOOL_NAME &&
            tool.name !== CALL_AGENT_TOOL_NAME &&
            !isTaskToolName(tool.name) &&
            tool.name !== WEB_FETCH_TOOL_NAME &&
            tool.name !== READ_TOOL_NAME &&
            tool.name !== BASH_TOOL_NAME &&
            tool.name !== EDIT_TOOL_NAME &&
            tool.name !== WRITE_TOOL_NAME &&
            tool.name !== LOAD_SKILL_TOOL_NAME,
        )
        .map((tool) =>
          withPermissionApproval(
            tool,
            getEffectiveGlobalToolPermission(tool.name, toolsSettings),
          ),
        )
        .filter((tool): tool is LoadedToolInfo => Boolean(tool));

  return [...enabledBuiltIns, ...enabledCommandTools];
}

export function withPermissionApproval(
  tool: LoadedToolInfo,
  permission: Permission,
): LoadedToolInfo | undefined {
  if (permission === "deny") return undefined;
  return { ...tool, requiresApproval: permission === "ask" };
}

export function combinePermissions(featurePermission: Permission, itemPermission: Permission): Permission {
  if (featurePermission === "deny" || itemPermission === "deny") return "deny";
  if (featurePermission === "ask" || itemPermission === "ask") return "ask";
  return "allow";
}


function normalizeWorkspaceRootPathForCompare(value: string) {
  return value.trim().replace(/[\\/]+$/, "").toLowerCase();
}

export function getSkillWorkspaceRoots(): ChatWorkspaceRoot[] {
  return [];
}

export function getEffectiveWorkspaceRoots({
  workspaceRoots = [],
  availableSkillsByName,
}: {
  workspaceRoots?: ChatWorkspaceRoot[];
  activeSkillNames: string[];
  availableSkillsByName: Map<string, LoadedSkillInfo>;
}): ChatWorkspaceRoot[] {
  const seenPaths = new Set<string>();
  const selectedRoots: ChatWorkspaceRoot[] = [];

  for (const root of workspaceRoots) {
    if (root.automatic || root.kind === "chat" || root.kind === "skill" || root.id === "chat" || root.id.startsWith("skill:")) {
      continue;
    }

    const normalizedPath = normalizeWorkspaceRootPathForCompare(root.path);
    if (!normalizedPath || seenPaths.has(normalizedPath)) continue;
    seenPaths.add(normalizedPath);
    selectedRoots.push({ ...root, kind: "manual", automatic: false });
    break;
  }

  return selectedRoots;
}


function toNameSet(names: string[]) {
  return new Set(names.map((name) => name.trim()).filter(Boolean));
}

export function getEffectiveToolPermission({
  toolName,
  toolsSettings,
  mode,
  modeCapabilityContext,
}: {
  toolName: string;
  toolsSettings: ToolsSettings;
  mode?: LoadedModeInfo;
  modeCapabilityContext?: ModeCapabilityContext;
}): Permission {
  const modePermissions = modeCapabilityContext
    ? getModePermissionMaps(mode, modeCapabilityContext).toolPermissions
    : undefined;
  return resolveModeItemPermission({
    name: toolName,
    globalPermission: getEffectiveGlobalToolPermission(toolName, toolsSettings),
    modePermissions,
  });
}

export function getEffectiveSkillPermission({
  skillName,
  skillsSettings,
  mode,
  modeCapabilityContext,
}: {
  skillName: string;
  skillsSettings: SkillsSettings;
  mode?: LoadedModeInfo;
  modeCapabilityContext?: ModeCapabilityContext;
}): Permission {
  const modePermissions = modeCapabilityContext
    ? getModePermissionMaps(mode, modeCapabilityContext).skillPermissions
    : undefined;
  return resolveModeItemPermission({
    name: skillName,
    globalPermission: getEffectiveGlobalSkillPermission(skillName, skillsSettings),
    modePermissions,
  });
}

export function getEffectiveAgentPermission({
  agentName,
  agentsSettings,
  mode,
  modeCapabilityContext,
}: {
  agentName: string;
  agentsSettings: AgentsSettings;
  mode?: LoadedModeInfo;
  modeCapabilityContext?: ModeCapabilityContext;
}): Permission {
  const modePermissions = modeCapabilityContext
    ? getModePermissionMaps(mode, modeCapabilityContext).agentPermissions
    : undefined;
  return resolveModeItemPermission({
    name: agentName,
    globalPermission: getEffectiveGlobalAgentPermission(agentName, agentsSettings),
    modePermissions,
  });
}

function isNameAllowedByModeDefault(
  name: string,
  allowedNames: Set<string> | undefined,
) {
  return !allowedNames || allowedNames.has(name);
}

export function getEnabledToolsForChat({
  chat: _chat,
  oneShotToolNames = [],
  skillRecommendedToolNames = [],
  globalEnabledTools,
  availableToolsByName,
  effectiveWorkspaceRoots: _effectiveWorkspaceRoots = [],
  mode,
  modeCapabilityContext,
  toolsSettings,
}: {
  chat: ChatSession;
  oneShotToolNames?: string[];
  skillRecommendedToolNames?: string[];
  globalEnabledTools: LoadedToolInfo[];
  availableToolsByName: Map<string, LoadedToolInfo>;
  effectiveWorkspaceRoots?: ChatWorkspaceRoot[];
  mode?: LoadedModeInfo;
  modeCapabilityContext?: ModeCapabilityContext;
  toolsSettings?: ToolsSettings;
}) {
  const byName = new Map<string, LoadedToolInfo>();
  const addTool = (tool: LoadedToolInfo | undefined, permission?: Permission) => {
    if (!tool || byName.has(tool.name)) return;
    const finalTool = permission ? withPermissionApproval(tool, permission) : tool;
    if (finalTool) byName.set(finalTool.name, finalTool);
  };

  const baseTools = toolsSettings
    ? [...availableToolsByName.values()]
    : globalEnabledTools;

  for (const tool of baseTools) {
    const permission = toolsSettings
      ? getEffectiveToolPermission({
          toolName: tool.name,
          toolsSettings,
          mode,
          modeCapabilityContext,
        })
      : (tool.requiresApproval ? "ask" : "allow");
    addTool(tool, permission);
  }

  for (const toolName of [...oneShotToolNames, ...skillRecommendedToolNames]) {
    const tool = availableToolsByName.get(toolName);
    const permission = toolsSettings
      ? getEffectiveToolPermission({ toolName, toolsSettings, mode, modeCapabilityContext })
      : (tool?.requiresApproval ? "ask" : "allow");
    addTool(tool, permission);
  }

  return [...byName.values()];
}


export function validateToolMentionsForRequest({
  content: _content,
  availableToolsByName: _availableToolsByName,
}: {
  content: string;
  availableToolsByName: Map<string, LoadedToolInfo>;
}): { ok: true; toolNames: string[] } | { ok: false; message: string } {
  return { ok: true, toolNames: [] };
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
  return loadedSkills.filter((skill) =>
    getEffectiveSkillPermission({ skillName: skill.name, skillsSettings }) !== "deny",
  );
}

export function getEnabledSkillsForChat({
  chat: _chat,
  globalEnabledSkills,
  availableSkillsByName,
  mode,
  modeCapabilityContext,
  skillsSettings,
}: {
  chat: ChatSession;
  globalEnabledSkills: LoadedSkillInfo[];
  availableSkillsByName: Map<string, LoadedSkillInfo>;
  mode?: LoadedModeInfo;
  modeCapabilityContext?: ModeCapabilityContext;
  skillsSettings?: SkillsSettings;
}) {
  const baseSkills = skillsSettings
    ? [...availableSkillsByName.values()]
    : globalEnabledSkills;

  return baseSkills.filter((skill) => {
    if (!skill.name || !skill.description || !skill.manifestPath) return false;
    if (!skillsSettings) return true;
    return getEffectiveSkillPermission({
      skillName: skill.name,
      skillsSettings,
      mode,
      modeCapabilityContext,
    }) !== "deny";
  });
}


export function getToolsWithLoadSkillTool({
  tools,
}: {
  tools: LoadedToolInfo[];
  modelSelectableSkills: LoadedSkillInfo[];
  activeSkillNames: string[];
  loadSkillEnabled: boolean;
}) {
  return tools;
}

export function validateSkillMentionsForRequest({
  content: _content,
  availableSkillsByName,
}: {
  content: string;
  availableSkillsByName: Map<string, LoadedSkillInfo>;
}): { ok: true; skillNames: string[] } | { ok: false; message: string } {
  return { ok: true, skillNames: [] };
}

export function getGlobalEnabledAgents({
  agentsSettings,
  loadedAgents,
}: {
  agentsSettings: AgentsSettings;
  loadedAgents: LoadedAgentInfo[];
}) {
  return loadedAgents.filter((agent) =>
    agent.enabled &&
    getEffectiveAgentPermission({ agentName: agent.name, agentsSettings }) !== "deny",
  );
}

export function getEnabledAgentsForChat({
  chat: _chat,
  globalEnabledAgents,
  availableAgentsByName,
  mode,
  modeCapabilityContext,
  agentsSettings,
}: {
  chat: ChatSession;
  globalEnabledAgents: LoadedAgentInfo[];
  availableAgentsByName: Map<string, LoadedAgentInfo>;
  mode?: LoadedModeInfo;
  modeCapabilityContext?: ModeCapabilityContext;
  agentsSettings?: AgentsSettings;
}) {
  const baseAgents = agentsSettings
    ? [...availableAgentsByName.values()]
    : globalEnabledAgents;

  return baseAgents.filter((agent) => {
    if (!agent.enabled) return false;
    if (!agentsSettings) return true;
    return getEffectiveAgentPermission({
      agentName: agent.name,
      agentsSettings,
      mode,
      modeCapabilityContext,
    }) !== "deny";
  });
}


export function validateAgentMentionsForRequest({
  content: _content,
  availableAgentsByName,
}: {
  content: string;
  availableAgentsByName: Map<string, LoadedAgentInfo>;
}): { ok: true; agentNames: string[] } | { ok: false; message: string } {
  return { ok: true, agentNames: [] };
}

function escapeXmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildSystemPromptWithActiveSkills({
  systemPrompt,
  activeSkillNames: _activeSkillNames,
  availableSkillsByName,
  mode,
}: {
  systemPrompt: string;
  activeSkillNames: string[];
  availableSkillsByName: Map<string, LoadedSkillInfo>;
  mode?: LoadedModeInfo;
}) {
  const modeBlock = getModeInstructionsBlock(mode);
  const modelVisibleSkills = [...availableSkillsByName.values()]
    .filter((skill) =>
      Boolean(
        skill.name.trim() &&
          skill.description.trim() &&
          skill.manifestPath?.trim(),
      ),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  const skillsBlock = modelVisibleSkills.length
    ? [
        "<available_skills>",
        ...modelVisibleSkills.map((skill) =>
          [
            "  <skill>",
            `    <name>${escapeXmlText(skill.name)}</name>`,
            `    <description>${escapeXmlText(skill.description)}</description>`,
            `    <location>${escapeXmlText(skill.manifestPath ?? "")}</location>`,
            "  </skill>",
          ].join("\n"),
        ),
        "</available_skills>",
        "When a skill is relevant, load it with the skill tool using its exact name. The skill tool returns the SKILL.md content and explains how to resolve relative references. You may load the same skill again if the previous load may no longer be in context.",
      ].join("\n")
    : "";

  return [systemPrompt.trim(), modeBlock, skillsBlock].filter(Boolean).join("\n\n");
}
