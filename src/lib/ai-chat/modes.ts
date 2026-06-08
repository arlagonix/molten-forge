import { isBuiltInToolName, isValidToolName } from "@/lib/ai-chat/builtin-tools";
import type {
  LoadedAgentInfo,
  LoadedModeInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  ModeBuiltInId,
  ModesState,
  Permission,
  FeaturePermission,
  ModePermission,
  ModeFeaturePermission,
  PermissionMap,
  ModePermissionMap,
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

export const PERMISSION_VALUES: Permission[] = ["allow", "ask", "deny"];
export const FEATURE_PERMISSION_VALUES: FeaturePermission[] = ["custom", "allow", "ask", "deny"];
export const MODE_PERMISSION_VALUES: ModePermission[] = ["global", "allow", "ask", "deny"];
export const MODE_FEATURE_PERMISSION_VALUES: ModeFeaturePermission[] = ["custom", "global", "allow", "ask", "deny"];
export const DEFAULT_PERMISSION: Permission = "ask";
export const FEATURE_PERMISSION_KEY = "__feature__";

export function isPermission(value: unknown): value is Permission {
  return value === "allow" || value === "ask" || value === "deny";
}

export function normalizePermission(value: unknown, fallback: Permission = DEFAULT_PERMISSION): Permission {
  return isPermission(value) ? value : fallback;
}

export function isFeaturePermission(value: unknown): value is FeaturePermission {
  return value === "custom" || isPermission(value);
}

export function normalizeFeaturePermission(
  value: unknown,
  fallback: FeaturePermission = "custom",
): FeaturePermission {
  return isFeaturePermission(value) ? value : fallback;
}

export function normalizePermissionMap(value: unknown): PermissionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const permissions: PermissionMap = {};
  for (const [name, permission] of Object.entries(value)) {
    const normalizedName = name.trim();
    if (!normalizedName || !isValidToolName(normalizedName)) continue;
    if (!isPermission(permission)) continue;
    permissions[normalizedName] = permission;
  }
  return permissions;
}

export function isModePermission(value: unknown): value is ModePermission {
  return value === "global" || isPermission(value);
}

export function isModeFeaturePermission(value: unknown): value is ModeFeaturePermission {
  return value === "custom" || isModePermission(value);
}

export function normalizeModePermissionMap(value: unknown): ModePermissionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const permissions: ModePermissionMap = {};
  for (const [name, permission] of Object.entries(value)) {
    const normalizedName = name.trim();
    if (!normalizedName || !isValidToolName(normalizedName)) continue;
    if (!isModeFeaturePermission(permission)) continue;
    if (normalizedName === FEATURE_PERMISSION_KEY) {
      permissions[normalizedName] = permission;
      continue;
    }
    if (permission === "global" || permission === "custom") continue;
    permissions[normalizedName] = permission;
  }
  return permissions;
}

export function resolvePermission({
  name,
  globalPermissions,
  modePermissions,
  defaultPermission = DEFAULT_PERMISSION,
}: {
  name: string;
  globalPermissions?: PermissionMap;
  modePermissions?: ModePermissionMap;
  defaultPermission?: Permission;
}): Permission {
  const globalPermission = globalPermissions?.[name] ?? defaultPermission;
  const modePermission = modePermissions?.[name];
  return modePermission && modePermission !== "global" && modePermission !== "custom"
    ? modePermission
    : globalPermission;
}

export function permissionFromLegacyEnabled(enabled: boolean | undefined, fallback: Permission = DEFAULT_PERMISSION): Permission {
  if (enabled === true) return fallback;
  if (enabled === false) return "deny";
  return fallback;
}

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

function namesToPermissionMap(names: string[], permission: Permission = "allow") {
  const result: ModePermissionMap = {};
  for (const name of normalizeNameList(names)) {
    if (isValidToolName(name)) result[name] = permission;
  }
  return result;
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
      description: "Minimal mode with tools, skills, and agents denied by default.",
      instructions: "",
      allowedToolNames: [],
      allowedSkillNames: [],
      allowedAgentNames: [],
      toolPermissions: {},
      skillPermissions: {},
      agentPermissions: {},
      permissionModelVersion: 2,
    };
  }

  return {
    id: DEFAULT_MODE_ID,
    builtIn: "default",
    usesDefaultCapabilities: true,
    name: "Default",
    enabled: true,
    description: "Default app behavior that follows global permissions unless customized.",
    instructions: "",
    allowedToolNames: [],
    allowedSkillNames: [],
    allowedAgentNames: [],
    toolPermissions: {},
    skillPermissions: {},
    agentPermissions: {},
    permissionModelVersion: 2,
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
    toolPermissions: {},
    skillPermissions: {},
    agentPermissions: {},
    permissionModelVersion: 2,
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
    skillNames: availableSkills.map((skill) => skill.name).filter((skillName) => isValidToolName(skillName)),
    agentNames: availableAgents.map((agent) => agent.name).filter((agentName) => isValidToolName(agentName)),
  };
}

export function getMinimalModeCapabilities(): ModeCapabilityNames {
  return { toolNames: [], skillNames: [], agentNames: [] };
}

export function getBuiltInModeDefaultCapabilities(
  builtIn: ModeBuiltInId,
  context: ModeCapabilityContext,
): ModeCapabilityNames {
  return builtIn === "minimal" ? getMinimalModeCapabilities() : getDefaultModeCapabilities(context);
}

export function getModePermissionMaps(
  mode: LoadedModeInfo | undefined,
  context: ModeCapabilityContext,
): { toolPermissions: ModePermissionMap; skillPermissions: ModePermissionMap; agentPermissions: ModePermissionMap } {
  if (!mode) return { toolPermissions: {}, skillPermissions: {}, agentPermissions: {}, };

  if (mode.builtIn && mode.usesDefaultCapabilities !== false) {
    if (mode.builtIn === "default") return { toolPermissions: {}, skillPermissions: {}, agentPermissions: {}, };
    return {
      toolPermissions: namesToPermissionMap(context.availableTools.map((tool) => tool.name), "deny"),
      skillPermissions: namesToPermissionMap(context.availableSkills.map((skill) => skill.name), "deny"),
      agentPermissions: namesToPermissionMap(context.availableAgents.map((agent) => agent.name), "deny"),
    };
  }

  return {
    toolPermissions: normalizeModePermissionMap(mode.toolPermissions),
    skillPermissions: normalizeModePermissionMap(mode.skillPermissions),
    agentPermissions: normalizeModePermissionMap(mode.agentPermissions),
  };
}

export function getModeCapabilityNames(
  mode: LoadedModeInfo | undefined,
  context: ModeCapabilityContext,
): ModeCapabilityNames {
  const permissions = getModePermissionMaps(mode, context);
  return {
    toolNames: Object.entries(permissions.toolPermissions)
      .filter(
        ([name, p]) =>
          name !== FEATURE_PERMISSION_KEY &&
          p !== "deny" &&
          p !== "global" &&
          p !== "custom",
      )
      .map(([name]) => name),
    skillNames: Object.entries(permissions.skillPermissions)
      .filter(
        ([name, p]) =>
          name !== FEATURE_PERMISSION_KEY &&
          p !== "deny" &&
          p !== "global" &&
          p !== "custom",
      )
      .map(([name]) => name),
    agentNames: Object.entries(permissions.agentPermissions)
      .filter(
        ([name, p]) =>
          name !== FEATURE_PERMISSION_KEY &&
          p !== "deny" &&
          p !== "global" &&
          p !== "custom",
      )
      .map(([name]) => name),
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
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const source = candidate as Record<string, unknown>;
  const builtIn = normalizeBuiltIn(source.builtIn);
  const fallback = builtIn ? getBuiltInModeDefaults(builtIn) : undefined;
  const id = builtIn ?? normalizeModeId(source.id);
  if (!id) return undefined;

  const legacyToolNames = normalizeNameList(source.allowedToolNames);
  const legacySkillNames = normalizeNameList(source.allowedSkillNames);
  const legacyAgentNames = normalizeNameList(source.allowedAgentNames);

  const permissionModelVersion = source.permissionModelVersion === 2 ? 2 : undefined;
  const normalizeStoredModePermissions = (rawPermissions: unknown, legacyNames: string[]) => {
    const normalized = normalizeModePermissionMap(rawPermissions);
    if (permissionModelVersion !== 2) delete normalized[FEATURE_PERMISSION_KEY];
    return {
      ...namesToPermissionMap(legacyNames, "allow"),
      ...normalized,
    };
  };

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
    description: typeof source.description === "string" ? source.description : fallback?.description ?? "",
    instructions: typeof source.instructions === "string" ? source.instructions : "",
    allowedToolNames: legacyToolNames,
    allowedSkillNames: legacySkillNames,
    allowedAgentNames: legacyAgentNames,
    toolPermissions: normalizeStoredModePermissions(source.toolPermissions, legacyToolNames),
    skillPermissions: normalizeStoredModePermissions(source.skillPermissions, legacySkillNames),
    agentPermissions: normalizeStoredModePermissions(source.agentPermissions, legacyAgentNames),
    permissionModelVersion: 2,
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
    if (!mode || modesById.has(mode.id)) continue;
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

export function resolveModeForChat(modeId: string | undefined, modesState: ModesState): LoadedModeInfo {
  const normalized = normalizeModesState(modesState);
  const enabledModes = normalized.modes.filter((mode) => mode.enabled);
  const mode = enabledModes.find((candidate) => candidate.id === modeId);
  return mode ?? enabledModes[0] ?? getBuiltInModeDefaults("default");
}

export function getModeInstructionsBlock(mode: LoadedModeInfo | undefined) {
  if (!mode) return "";
  const instructions = mode.instructions?.trim() ?? "";
  return [
    `<mode_instructions name="${mode.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}">`,
    mode.description.trim() ? `Mode description: ${mode.description.trim()}` : "",
    instructions,
    `</mode_instructions>`,
  ].filter(Boolean).join("\n");
}

export function updateBuiltInModeWithReset(mode: LoadedModeInfo, context: ModeCapabilityContext): LoadedModeInfo {
  if (!mode.builtIn) return mode;
  const defaults = getBuiltInModeDefaults(mode.builtIn);
  const capabilities = getBuiltInModeDefaultCapabilities(mode.builtIn, context);
  return {
    ...defaults,
    enabled: mode.enabled,
    allowedToolNames: capabilities.toolNames,
    allowedSkillNames: capabilities.skillNames,
    allowedAgentNames: capabilities.agentNames,
    toolPermissions: namesToPermissionMap(capabilities.toolNames, "allow"),
    skillPermissions: namesToPermissionMap(capabilities.skillNames, "allow"),
    agentPermissions: namesToPermissionMap(capabilities.agentNames, "allow"),
    permissionModelVersion: 2,
  };
}

export function serializeModesState(state: ModesState): ModesState {
  return normalizeModesState(state);
}
