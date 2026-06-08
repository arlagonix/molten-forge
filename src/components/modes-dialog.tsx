import {
  Copy,
  Layers3,
  Maximize2,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { memo, useEffect, useMemo, useState } from "react";

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
import { GroupHeading } from "@/components/ui/group-heading";
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
  DEFAULT_PERMISSION,
  FEATURE_PERMISSION_KEY,
  getBuiltInModeDefaults,
  normalizeModePermissionMap,
  normalizeModesState,
} from "@/lib/ai-chat/modes";
import type {
  AgentsSettings,
  LoadedAgentInfo,
  LoadedModeInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  ModeBuiltInId,
  ModeFeaturePermission,
  ModePermission,
  ModePermissionMap,
  ModesState,
  Permission,
  SkillsSettings,
  ToolsSettings,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

type ModesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modesState: ModesState;
  onModesStateChange: Dispatch<SetStateAction<ModesState>>;
  availableTools: LoadedToolInfo[];
  availableSkills: LoadedSkillInfo[];
  availableAgents: LoadedAgentInfo[];
  toolsSettings: ToolsSettings;
  skillsSettings: SkillsSettings;
  agentsSettings: AgentsSettings;
  showSuccess: (message: string, description?: string) => void;
  showError: (message: string, description?: string) => void;
};

type ModeDraft = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  instructions: string;
  builtIn?: ModeBuiltInId;
  usesDefaultCapabilities?: boolean;
  toolPermissions: ModePermissionMap;
  skillPermissions: ModePermissionMap;
  agentPermissions: ModePermissionMap;
};

function normalizeModesForState(state: ModesState) {
  return normalizeModesState(state).modes;
}

function createUniqueModeName(baseName: string, modes: LoadedModeInfo[]) {
  const existingNames = new Set(
    modes.map((mode) => mode.name.trim().toLowerCase()),
  );
  const base = baseName.trim() || "mode";
  if (!existingNames.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!existingNames.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

function createBlankModeDraft(): ModeDraft {
  return {
    id: `mode-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: "",
    enabled: true,
    description: "",
    instructions: "",
    usesDefaultCapabilities: false,
    toolPermissions: {},
    skillPermissions: {},
    agentPermissions: {},
  };
}

function modeToDraft(mode: LoadedModeInfo): ModeDraft {
  return {
    id: mode.id,
    name: mode.name,
    enabled: mode.enabled,
    description: mode.description,
    instructions: mode.instructions ?? "",
    builtIn: mode.builtIn,
    usesDefaultCapabilities: mode.usesDefaultCapabilities,
    toolPermissions: normalizeModePermissionMap(mode.toolPermissions),
    skillPermissions: normalizeModePermissionMap(mode.skillPermissions),
    agentPermissions: normalizeModePermissionMap(mode.agentPermissions),
  };
}

function draftToMode(
  draft: ModeDraft,
  enabled = draft.enabled,
): LoadedModeInfo {
  return {
    id: draft.id,
    name: draft.name.trim(),
    enabled,
    description: draft.description.trim(),
    instructions: draft.instructions.trim(),
    ...(draft.builtIn ? { builtIn: draft.builtIn } : {}),
    usesDefaultCapabilities: draft.builtIn
      ? draft.usesDefaultCapabilities !== false
      : false,
    allowedToolNames: Object.entries(draft.toolPermissions)
      .filter(
        ([name, p]) =>
          name !== FEATURE_PERMISSION_KEY &&
          p !== "deny" &&
          p !== "global" &&
          p !== "custom",
      )
      .map(([name]) => name),
    allowedSkillNames: Object.entries(draft.skillPermissions)
      .filter(
        ([name, p]) =>
          name !== FEATURE_PERMISSION_KEY &&
          p !== "deny" &&
          p !== "global" &&
          p !== "custom",
      )
      .map(([name]) => name),
    allowedAgentNames: Object.entries(draft.agentPermissions)
      .filter(
        ([name, p]) =>
          name !== FEATURE_PERMISSION_KEY &&
          p !== "deny" &&
          p !== "global" &&
          p !== "custom",
      )
      .map(([name]) => name),
    toolPermissions: draft.toolPermissions,
    skillPermissions: draft.skillPermissions,
    agentPermissions: draft.agentPermissions,
    permissionModelVersion: 2,
  };
}

function validateModeDraft(draft: ModeDraft, modes: LoadedModeInfo[]) {
  const name = draft.name.trim();
  if (!name) throw new Error("Mode name is required.");
  const duplicate = modes.find(
    (mode) =>
      mode.id !== draft.id &&
      mode.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) throw new Error(`A mode named "${name}" already exists.`);
}

function hasDraftChanges(
  current: ModeDraft | null,
  saved: ModeDraft | null,
  isCreating: boolean,
) {
  if (!current) return false;
  if (isCreating || !saved) {
    return (
      Boolean(
        current.name.trim() ||
        current.description.trim() ||
        current.instructions.trim(),
      ) ||
      Object.keys(current.toolPermissions).length > 0 ||
      Object.keys(current.skillPermissions).length > 0 ||
      Object.keys(current.agentPermissions).length > 0
    );
  }
  return JSON.stringify(current) !== JSON.stringify(saved);
}

function getToolGlobalPermission(
  settings: ToolsSettings,
  name: string,
): Permission {
  const masterPermission = settings.toolsPermission ?? "custom";
  if (masterPermission !== "custom") return masterPermission;
  return settings.toolPermissions?.[name] ?? DEFAULT_PERMISSION;
}

function getSkillGlobalPermission(
  settings: SkillsSettings,
  name: string,
): Permission {
  const masterPermission = settings.skillsPermission ?? "custom";
  if (masterPermission !== "custom") return masterPermission;
  return (
    settings.skillPermissions?.[name] ??
    (settings.enabled === false ? "deny" : DEFAULT_PERMISSION)
  );
}

function getAgentGlobalPermission(
  settings: AgentsSettings,
  name: string,
): Permission {
  const masterPermission = settings.agentsPermission ?? "custom";
  if (masterPermission !== "custom") return masterPermission;
  return (
    settings.agentPermissions?.[name] ??
    (settings.enabled === false ? "deny" : DEFAULT_PERMISSION)
  );
}

function PermissionSelect({
  value,
  onChange,
  disabled,
}: {
  value: ModePermission;
  onChange: (value: ModePermission) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as ModePermission)}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-27 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="global">Global</SelectItem>
        <SelectItem value="allow">Allow</SelectItem>
        <SelectItem value="ask">Ask</SelectItem>
        <SelectItem value="deny">Deny</SelectItem>
      </SelectContent>
    </Select>
  );
}

function FeaturePermissionSelect({
  value,
  onChange,
}: {
  value: ModeFeaturePermission;
  onChange: (value: ModeFeaturePermission) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as ModeFeaturePermission)}
    >
      <SelectTrigger className="h-8 w-27 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="custom">Custom</SelectItem>
        <SelectItem value="global">Global</SelectItem>
        <SelectItem value="allow">Allow</SelectItem>
        <SelectItem value="ask">Ask</SelectItem>
        <SelectItem value="deny">Deny</SelectItem>
      </SelectContent>
    </Select>
  );
}

function formatPermission(permission: Permission) {
  if (permission === "allow") return "Allow";
  if (permission === "ask") return "Ask";
  return "Deny";
}

function formatModeFeaturePermission(permission: ModeFeaturePermission) {
  if (permission === "custom") return "Custom";
  if (permission === "global") return "Global";
  return formatPermission(permission);
}

function getModeSourceText({
  modeName,
  modePermission,
  globalPermission,
  masterPermission,
}: {
  modeName: string;
  modePermission: ModePermission | undefined;
  globalPermission: Permission;
  masterPermission: ModeFeaturePermission;
}) {
  if (masterPermission === "global") {
    return `Mode "${modeName}" master uses global: ${formatPermission(globalPermission)}`;
  }
  if (masterPermission !== "custom") {
    return `Mode "${modeName}" master forces: ${formatPermission(masterPermission)}`;
  }
  if (!modePermission || modePermission === "global") {
    return `Uses global setting: ${formatPermission(globalPermission)}`;
  }
  if (modePermission === globalPermission) {
    return `Mode "${modeName}" matches global: ${formatPermission(globalPermission)}`;
  }
  return `Mode "${modeName}" overrides global: ${formatPermission(globalPermission)} → ${formatPermission(modePermission)}`;
}

function getDisplayedModePermission(
  permissions: ModePermissionMap,
  itemName: string,
): ModePermission {
  const masterPermission = permissions[FEATURE_PERMISSION_KEY] ?? "custom";
  if (masterPermission === "global") return "global";
  if (masterPermission !== "custom") return masterPermission;
  const itemPermission = permissions[itemName];
  return itemPermission === "allow" ||
    itemPermission === "ask" ||
    itemPermission === "deny" ||
    itemPermission === "global"
    ? itemPermission
    : "global";
}

function PermissionRows({
  title,
  items,
  permissions,
  globalPermissionFor,
  modeName,
  onChange,
  onReset,
  featureRow,
}: {
  title: string;
  items: Array<{ name: string; description?: string }>;
  permissions: ModePermissionMap;
  globalPermissionFor: (name: string) => Permission;
  modeName: string;
  onChange: (name: string, permission: ModeFeaturePermission) => void;
  onReset: () => void;
  featureRow: {
    key: string;
    label: string;
    description: string;
  };
}) {
  const masterPermission = permissions[FEATURE_PERMISSION_KEY] ?? "custom";
  const childPermissionsLocked = masterPermission !== "custom";

  const renderRow = (item: { name: string; description?: string }) => {
    const globalPermission = globalPermissionFor(item.name);
    const modePermission = permissions[item.name];
    const value = getDisplayedModePermission(permissions, item.name);
    return (
      <div
        key={item.name}
        className="flex min-w-0 items-start gap-3 border bg-card px-3 py-2"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium leading-6">
            {item.name}
          </div>
          <div className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
            {item.description || "No description."}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {getModeSourceText({
              modeName,
              modePermission:
                modePermission === "global" ||
                modePermission === "allow" ||
                modePermission === "ask" ||
                modePermission === "deny"
                  ? modePermission
                  : undefined,
              globalPermission,
              masterPermission,
            })}
          </div>
        </div>
        <PermissionSelect
          value={value}
          disabled={childPermissionsLocked}
          onChange={(permission) => onChange(item.name, permission)}
        />
      </div>
    );
  };

  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-sm"
          onClick={onReset}
        >
          Reset
        </Button>
      </div>
      <div className="grid gap-1.5">
        <div className="flex min-w-0 items-start gap-3 border bg-card px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-medium leading-6">
              {featureRow.label}
            </div>
            <div className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
              {featureRow.description}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {masterPermission === "custom"
                ? "Child permissions are custom."
                : `Child permissions are forced to ${formatModeFeaturePermission(masterPermission)}.`}
            </div>
          </div>
          <FeaturePermissionSelect
            value={masterPermission}
            onChange={(permission) => onChange(featureRow.key, permission)}
          />
        </div>
        {items.length > 0 ? (
          items.map((item) => renderRow(item))
        ) : (
          <div className="border border-dashed px-3 py-4 text-sm text-muted-foreground">
            No {title.toLowerCase()} available.
          </div>
        )}
      </div>
    </section>
  );
}

export const ModesDialog = memo(function ModesDialog({
  open,
  onOpenChange,
  modesState,
  onModesStateChange,
  availableTools,
  availableSkills,
  availableAgents,
  toolsSettings,
  skillsSettings,
  agentsSettings,
  showSuccess,
  showError,
}: ModesDialogProps) {
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [modeDraft, setModeDraft] = useState<ModeDraft | null>(null);
  const [isCreatingMode, setIsCreatingMode] = useState(false);
  const [instructionsEditorOpen, setInstructionsEditorOpen] = useState(false);

  const modes = useMemo(() => normalizeModesForState(modesState), [modesState]);
  const selectedMode = useMemo(
    () => modes.find((mode) => mode.id === selectedModeId) ?? null,
    [modes, selectedModeId],
  );
  const savedDraft = useMemo(
    () => (selectedMode && !isCreatingMode ? modeToDraft(selectedMode) : null),
    [isCreatingMode, selectedMode],
  );
  const enabledModesCount = modes.filter((mode) => mode.enabled).length;
  const hasChanges = hasDraftChanges(modeDraft, savedDraft, isCreatingMode);

  const toolItems = useMemo(
    () =>
      availableTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    [availableTools],
  );
  const skillItems = useMemo(
    () =>
      availableSkills.map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
    [availableSkills],
  );
  const agentItems = useMemo(
    () =>
      availableAgents.map((agent) => ({
        name: agent.name,
        description: agent.description,
      })),
    [availableAgents],
  );

  useEffect(() => {
    if (!open || isCreatingMode) return;
    const mode = selectedModeId
      ? modes.find((candidate) => candidate.id === selectedModeId)
      : modes[0];
    if (!mode) {
      setSelectedModeId(null);
      setModeDraft(null);
      return;
    }
    if (!selectedModeId || !selectedMode || !modeDraft) {
      setSelectedModeId(mode.id);
      setModeDraft(modeToDraft(mode));
    }
  }, [isCreatingMode, modeDraft, modes, open, selectedMode, selectedModeId]);

  function updateModes(updater: (modes: LoadedModeInfo[]) => LoadedModeInfo[]) {
    onModesStateChange((current) =>
      normalizeModesState({ modes: updater(normalizeModesForState(current)) }),
    );
  }

  function updateModeDraft(patch: Partial<ModeDraft>) {
    setModeDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function updatePermission(
    kind: "tool" | "skill" | "agent",
    name: string,
    permission: ModeFeaturePermission,
  ) {
    if (!modeDraft) return;
    const key =
      kind === "tool"
        ? "toolPermissions"
        : kind === "skill"
          ? "skillPermissions"
          : "agentPermissions";
    const nextPermissions = { ...(modeDraft[key] ?? {}) };
    if (name === FEATURE_PERMISSION_KEY) {
      nextPermissions[name] = permission;
    } else if (permission === "global") {
      delete nextPermissions[name];
    } else if (permission !== "custom") {
      nextPermissions[name] = permission;
    }
    updateModeDraft({
      usesDefaultCapabilities: false,
      [key]: nextPermissions,
    } as Partial<ModeDraft>);
  }

  function resetPermissionSection(kind: "tool" | "skill" | "agent") {
    const key =
      kind === "tool"
        ? "toolPermissions"
        : kind === "skill"
          ? "skillPermissions"
          : "agentPermissions";
    updateModeDraft({
      usesDefaultCapabilities: false,
      [key]: {},
    } as Partial<ModeDraft>);
  }

  function addMode() {
    setSelectedModeId(null);
    setIsCreatingMode(true);
    setModeDraft(createBlankModeDraft());
  }

  function cloneCurrentMode() {
    if (!modeDraft) return;
    const clone = {
      ...modeDraft,
      id: `mode-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      builtIn: undefined,
      usesDefaultCapabilities: false,
      name: createUniqueModeName(`${modeDraft.name} copy`, modes),
      enabled: true,
    };
    setSelectedModeId(null);
    setIsCreatingMode(true);
    setModeDraft(clone);
  }

  function deleteCurrentMode() {
    if (!selectedMode || selectedMode.builtIn) return;
    updateModes((currentModes) =>
      currentModes.filter((mode) => mode.id !== selectedMode.id),
    );
    setSelectedModeId(null);
    setModeDraft(null);
    setIsCreatingMode(false);
    showSuccess("Mode deleted.");
  }

  function toggleModeEnabled(mode: LoadedModeInfo, checked: boolean) {
    if (!checked && enabledModesCount <= 1 && mode.enabled) {
      showError("At least one mode must stay enabled.");
      return;
    }
    updateModes((currentModes) =>
      currentModes.map((currentMode) =>
        currentMode.id === mode.id
          ? { ...currentMode, enabled: checked }
          : currentMode,
      ),
    );
  }

  function resetModeDraft() {
    if (!modeDraft) return;
    if (modeDraft.builtIn) {
      setModeDraft(
        modeToDraft({
          ...getBuiltInModeDefaults(modeDraft.builtIn),
          enabled: selectedMode?.enabled ?? modeDraft.enabled,
        }),
      );
      return;
    }
    if (isCreatingMode) setModeDraft(createBlankModeDraft());
    else if (savedDraft) setModeDraft(savedDraft);
  }

  function saveCurrentModeDraft() {
    if (!modeDraft) return;
    try {
      validateModeDraft(modeDraft, modes);
      const mode = draftToMode(
        modeDraft,
        selectedMode?.enabled ?? modeDraft.enabled,
      );
      if (isCreatingMode || !selectedMode) {
        updateModes((currentModes) => [...currentModes, mode]);
        setSelectedModeId(mode.id);
        setIsCreatingMode(false);
        setModeDraft(modeToDraft(mode));
        showSuccess("Mode created.");
        return;
      }
      updateModes((currentModes) =>
        currentModes.map((currentMode) =>
          currentMode.id === selectedMode.id ? mode : currentMode,
        ),
      );
      setModeDraft(modeToDraft(mode));
      showSuccess("Mode saved.");
    } catch (error) {
      showError(
        "Failed to save mode",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function selectMode(mode: LoadedModeInfo) {
    setSelectedModeId(mode.id);
    setIsCreatingMode(false);
    setModeDraft(modeToDraft(mode));
    setInstructionsEditorOpen(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle>Modes</DialogTitle>
            <DialogDescription>
              Define mode instructions and permission overrides for tools,
              skills, and agents.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[400px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b bg-card/70 p-3 md:border-b-0 md:border-r">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mb-3 w-full"
                onClick={addMode}
              >
                <Plus className="size-4" /> Add mode
              </Button>
              <div className="grid gap-3">
                {[
                  {
                    title: "Built-in",
                    modes: modes.filter((mode) => mode.builtIn),
                  },
                  {
                    title: "Custom",
                    modes: modes.filter((mode) => !mode.builtIn),
                  },
                ]
                  .filter((group) => group.modes.length > 0)
                  .map((group) => (
                    <div key={group.title} className="grid gap-1.5">
                      <GroupHeading className="mt-0">
                        {group.title}
                      </GroupHeading>
                      {group.modes.map((mode) => {
                        const selected =
                          selectedMode?.id === mode.id && !isCreatingMode;
                        return (
                          <div
                            key={mode.id}
                            role="button"
                            tabIndex={0}
                            className={cn(
                              "group flex min-w-0 cursor-pointer items-start gap-2 border px-2 py-2 outline-none",
                              selected
                                ? "border-primary/30 bg-accent text-accent-foreground"
                                : "border-transparent hover:border-border hover:bg-muted/60",
                            )}
                            onClick={() => selectMode(mode)}
                          >
                            <Layers3 className="mt-1 size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-base leading-6">
                                {mode.name}
                              </div>
                              <div className="line-clamp-2 text-sm leading-5 text-muted-foreground">
                                {mode.description || "No description."}
                              </div>
                            </div>
                            <Switch
                              checked={mode.enabled}
                              onClick={(event) => event.stopPropagation()}
                              onCheckedChange={(checked) =>
                                toggleModeEnabled(mode, checked)
                              }
                              className="mt-0.5 shrink-0 cursor-pointer"
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
              </div>
            </aside>

            <div className="min-h-0 flex flex-col overflow-hidden">
              {modeDraft ? (
                <>
                  <div className="z-20 flex min-h-[4.25rem] shrink-0 items-center border-b bg-background px-5 py-3">
                    <div className="flex w-full items-center justify-between gap-4">
                      <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                        {modeDraft.builtIn
                          ? "Built-in mode"
                          : isCreatingMode
                            ? "New mode"
                            : "Edit mode"}
                      </Label>
                      {!isCreatingMode ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              title="Mode options"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onSelect={cloneCurrentMode}>
                              <Copy className="size-4" />
                              Clone
                            </DropdownMenuItem>
                            {!modeDraft.builtIn ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={deleteCurrentMode}
                                >
                                  <Trash2 className="size-4" />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                    <div className="grid gap-5 pb-1">
                      <div className="grid gap-2">
                        <Label htmlFor="mode-name">Name</Label>
                        <Input
                          id="mode-name"
                          value={modeDraft.name}
                          onChange={(event) =>
                            updateModeDraft({ name: event.target.value })
                          }
                          placeholder="Mode name"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="mode-description">Description</Label>
                        <Textarea
                          id="mode-description"
                          value={modeDraft.description}
                          onChange={(event) =>
                            updateModeDraft({ description: event.target.value })
                          }
                          placeholder="When this mode should be used."
                          className="min-h-24 leading-6"
                        />
                      </div>
                      <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="mode-instructions">
                            Instructions
                          </Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-sm"
                            onClick={() => setInstructionsEditorOpen(true)}
                          >
                            <Maximize2 className="size-4" />
                            Open editor
                          </Button>
                        </div>
                        <Textarea
                          id="mode-instructions"
                          value={modeDraft.instructions}
                          onChange={(event) =>
                            updateModeDraft({
                              instructions: event.target.value,
                            })
                          }
                          placeholder="Optional mode-specific instructions added to the system prompt."
                          className="min-h-72 text-sm leading-6"
                        />
                      </div>

                      <PermissionRows
                        title="Tools"
                        items={toolItems}
                        permissions={modeDraft.toolPermissions}
                        globalPermissionFor={(name) =>
                          getToolGlobalPermission(toolsSettings, name)
                        }
                        modeName={modeDraft.name || "Mode"}
                        onChange={(name, permission) =>
                          updatePermission("tool", name, permission)
                        }
                        onReset={() => resetPermissionSection("tool")}
                        featureRow={{
                          key: FEATURE_PERMISSION_KEY,
                          label: "Tools",
                          description:
                            "Master permission for the whole tools feature.",
                        }}
                      />
                      <PermissionRows
                        title="Skills"
                        items={skillItems}
                        permissions={modeDraft.skillPermissions}
                        globalPermissionFor={(name) =>
                          getSkillGlobalPermission(skillsSettings, name)
                        }
                        modeName={modeDraft.name || "Mode"}
                        onChange={(name, permission) =>
                          updatePermission("skill", name, permission)
                        }
                        onReset={() => resetPermissionSection("skill")}
                        featureRow={{
                          key: FEATURE_PERMISSION_KEY,
                          label: "Skills",
                          description:
                            "Master permission for the whole skills feature.",
                        }}
                      />
                      <PermissionRows
                        title="Agents"
                        items={agentItems}
                        permissions={modeDraft.agentPermissions}
                        globalPermissionFor={(name) =>
                          getAgentGlobalPermission(agentsSettings, name)
                        }
                        modeName={modeDraft.name || "Mode"}
                        onChange={(name, permission) =>
                          updatePermission("agent", name, permission)
                        }
                        onReset={() => resetPermissionSection("agent")}
                        featureRow={{
                          key: FEATURE_PERMISSION_KEY,
                          label: "Agents",
                          description:
                            "Master permission for the whole agents feature.",
                        }}
                      />
                    </div>
                  </div>

                  <DialogFooter className="shrink-0 border-t bg-background px-5 py-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetModeDraft}
                      disabled={!modeDraft.builtIn && !hasChanges}
                    >
                      Reset
                    </Button>
                    <Button
                      type="button"
                      onClick={saveCurrentModeDraft}
                      disabled={!hasChanges}
                    >
                      Save
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-muted-foreground">
                  <div className="grid max-w-sm gap-2">
                    <Sparkles className="mx-auto size-8 opacity-50" />
                    <div className="text-lg font-medium text-foreground">
                      No mode selected
                    </div>
                    <p className="text-base leading-6">
                      Create a mode or select one from the list to edit its
                      instructions and permissions.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {modeDraft ? (
        <Dialog
          open={instructionsEditorOpen}
          onOpenChange={setInstructionsEditorOpen}
        >
          <DialogContent className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-4 p-5 sm:max-w-6xl">
            <DialogHeader className="pr-8">
              <DialogTitle>Edit instructions</DialogTitle>
              <DialogDescription>
                Edit the selected mode instructions in a larger focused editor.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={modeDraft.instructions}
              onChange={(event) =>
                updateModeDraft({ instructions: event.target.value })
              }
              placeholder="Optional mode-specific instructions added to the system prompt."
              className="min-h-0 flex-1 resize-none text-sm leading-6"
            />
            <DialogFooter>
              <Button
                type="button"
                onClick={() => setInstructionsEditorOpen(false)}
              >
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
});
