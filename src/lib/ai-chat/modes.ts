import { isBuiltInToolName, isValidToolName } from "@/lib/ai-chat/builtin-tools";
import type {
  LoadedAgentInfo,
  LoadedModeInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  ModeBuiltInId,
  ModeDefinition,
  ModesState,
} from "@/lib/ai-chat/types";

export const DEFAULT_MODE_ID = "default";
export const MINIMAL_MODE_ID = "minimal";

export const BUILT_IN_MODE_IDS = [DEFAULT_MODE_ID, MINIMAL_MODE_ID] as const;

export type ModeCapabilityContext = {
  availableTools: LoadedToolInfo[];
  availableSkills: LoadedSkillInfo[];
  availableAgents: LoadedAgentInfo[];
};

export type ModeCapabilityNames = {
  toolNames: string[];
  skillNames: string[];
  agentNames: string[];
};

function normalizeNameList(names: unknown): string[] {
  if (!Array.isArray(names)) return [];

  return [
    ...new Set(
      names
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeModeId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeModeName(value: unknown, fallback: string) {
  const name = typeof value === "string" ? value.trim() : "";
  return name || fallback;
}

export function getBuiltInModeDefaults(builtIn: ModeBuiltInId): LoadedModeInfo {
  if (builtIn === "minimal") {
    return {
      id: MINIMAL_MODE_ID,
      builtIn: "minimal",
      usesDefaultCapabilities: true,
      name: "Minimal",
      enabled: true,
      description: "Minimal mode with tools, skills, and agents turned off by default.",
      instructions: "",
      allowedToolNames: [],
      allowedSkillNames: [],
      allowedAgentNames: [],
    };
  }

  return {
    id: DEFAULT_MODE_ID,
    builtIn: "default",
    usesDefaultCapabilities: true,
    name: "Default",
    enabled: true,
    description: "Default app behavior with built-in tools, skills, and agents enabled.",
    instructions: "",
    allowedToolNames: [],
    allowedSkillNames: [],
    allowedAgentNames: [],
  };
}

export function createCustomMode(existingModes: LoadedModeInfo[] = []): LoadedModeInfo {
  const existingNames = new Set(existingModes.map((mode) => mode.name.trim().toLowerCase()));
  let name = "New mode";

  for (let index = 2; existingNames.has(name.toLowerCase()); index += 1) {
    name = `New mode ${index}`;
  }

  return {
    id: `mode-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    enabled: true,
    description: "",
    instructions: "",
    allowedToolNames: [],
    allowedSkillNames: [],
    allowedAgentNames: [],
  };
}

export function getDefaultModeCapabilities({
  availableTools,
  availableSkills,
  availableAgents,
}: ModeCapabilityContext): ModeCapabilityNames {
  return {
    toolNames: availableTools
      .map((tool) => tool.name)
      .filter((toolName) => isValidToolName(toolName) && isBuiltInToolName(toolName)),
    skillNames: availableSkills
      .map((skill) => skill.name)
      .filter((skillName) => isValidToolName(skillName)),
    agentNames: availableAgents
      .map((agent) => agent.name)
      .filter((agentName) => isValidToolName(agentName)),
  };
}

export function getMinimalModeCapabilities(): ModeCapabilityNames {
  return { toolNames: [], skillNames: [], agentNames: [] };
}

export function getBuiltInModeDefaultCapabilities(
  builtIn: ModeBuiltInId,
  context: ModeCapabilityContext,
): ModeCapabilityNames {
  return builtIn === "minimal"
    ? getMinimalModeCapabilities()
    : getDefaultModeCapabilities(context);
}

export function getModeCapabilityNames(
  mode: LoadedModeInfo | undefined,
  context: ModeCapabilityContext,
): ModeCapabilityNames {
  if (!mode) return getDefaultModeCapabilities(context);

  if (mode.builtIn && mode.usesDefaultCapabilities !== false) {
    return getBuiltInModeDefaultCapabilities(mode.builtIn, context);
  }

  return {
    toolNames: normalizeNameList(mode.allowedToolNames),
    skillNames: normalizeNameList(mode.allowedSkillNames),
    agentNames: normalizeNameList(mode.allowedAgentNames),
  };
}

export function modeToEditableCapabilities(
  mode: LoadedModeInfo,
  context: ModeCapabilityContext,
): ModeCapabilityNames {
  return getModeCapabilityNames(mode, context);
}

function normalizeBuiltIn(value: unknown): ModeBuiltInId | undefined {
  return value === "default" || value === "minimal" ? value : undefined;
}

function normalizeModeDefinition(candidate: unknown): LoadedModeInfo | undefined {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }

  const source = candidate as Record<string, unknown>;
  const builtIn = normalizeBuiltIn(source.builtIn);
  const fallback = builtIn ? getBuiltInModeDefaults(builtIn) : undefined;
  const id = builtIn ?? normalizeModeId(source.id);
  if (!id) return undefined;

  return {
    id,
    ...(builtIn ? { builtIn } : {}),
    usesDefaultCapabilities:
      typeof source.usesDefaultCapabilities === "boolean"
        ? source.usesDefaultCapabilities
        : builtIn
          ? true
          : false,
    name: normalizeModeName(source.name, fallback?.name ?? "Mode"),
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    description:
      typeof source.description === "string"
        ? source.description
        : fallback?.description ?? "",
    instructions:
      typeof source.instructions === "string" ? source.instructions : "",
    allowedToolNames: normalizeNameList(source.allowedToolNames),
    allowedSkillNames: normalizeNameList(source.allowedSkillNames),
    allowedAgentNames: normalizeNameList(source.allowedAgentNames),
  };
}

function ensureBuiltInModes(modes: LoadedModeInfo[]) {
  const byId = new Map(modes.map((mode) => [mode.id, mode] as const));
  const mergedModes = [...modes];

  for (const builtIn of BUILT_IN_MODE_IDS) {
    if (byId.has(builtIn)) continue;
    mergedModes.unshift(getBuiltInModeDefaults(builtIn));
  }

  return mergedModes.sort((left, right) => {
    const leftIndex = BUILT_IN_MODE_IDS.indexOf(left.id as (typeof BUILT_IN_MODE_IDS)[number]);
    const rightIndex = BUILT_IN_MODE_IDS.indexOf(right.id as (typeof BUILT_IN_MODE_IDS)[number]);
    if (leftIndex >= 0 || rightIndex >= 0) {
      return (leftIndex >= 0 ? leftIndex : 99) - (rightIndex >= 0 ? rightIndex : 99);
    }
    return left.name.localeCompare(right.name);
  });
}

export function normalizeModesState(value: Partial<ModesState> | undefined): ModesState {
  const rawModes = Array.isArray(value?.modes) ? value.modes : [];
  const modesById = new Map<string, LoadedModeInfo>();

  for (const rawMode of rawModes) {
    const mode = normalizeModeDefinition(rawMode);
    if (!mode) continue;
    if (modesById.has(mode.id)) continue;
    modesById.set(mode.id, mode);
  }

  const modes = ensureBuiltInModes([...modesById.values()]);
  if (!modes.some((mode) => mode.enabled)) {
    const defaultMode = modes.find((mode) => mode.id === DEFAULT_MODE_ID) ?? modes[0];
    defaultMode.enabled = true;
  }

  return { modes };
}

export function getEnabledModes(modesState: ModesState) {
  return normalizeModesState(modesState).modes.filter((mode) => mode.enabled);
}

export function resolveModeForChat(
  modeId: string | undefined,
  modesState: ModesState,
): LoadedModeInfo {
  const normalized = normalizeModesState(modesState);
  const enabledModes = normalized.modes.filter((mode) => mode.enabled);
  const mode = enabledModes.find((candidate) => candidate.id === modeId);
  return mode ?? enabledModes[0] ?? getBuiltInModeDefaults("default");
}

export function getModeInstructionsBlock(mode: LoadedModeInfo | undefined) {
  if (!mode) return "";

  const instructions = mode.instructions?.trim() ?? "";

  return [
    `Active mode: ${mode.name}`,
    mode.description.trim() ? `Mode description: ${mode.description.trim()}` : "",
    instructions ? `Mode instructions:\n${instructions}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function updateBuiltInModeWithReset(
  mode: LoadedModeInfo,
  context: ModeCapabilityContext,
): LoadedModeInfo {
  if (!mode.builtIn) return mode;
  const defaults = getBuiltInModeDefaults(mode.builtIn);
  const capabilities = getBuiltInModeDefaultCapabilities(mode.builtIn, context);

  return {
    ...defaults,
    enabled: mode.enabled,
    allowedToolNames: capabilities.toolNames,
    allowedSkillNames: capabilities.skillNames,
    allowedAgentNames: capabilities.agentNames,
  };
}

export function serializeModesState(state: ModesState): ModesState {
  return normalizeModesState(state);
}
