import {
  BookOpen,
  Bot,
  ChevronDown,
  Copy,
  Layers3,
  Maximize2,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { memo, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  getBuiltInModeDefaults,
  modeToEditableCapabilities,
  normalizeModesState,
  updateBuiltInModeWithReset,
} from "@/lib/ai-chat/modes";
import type {
  LoadedAgentInfo,
  LoadedModeInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  ModeBuiltInId,
  ModesState,
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
  showSuccess: (message: string, description?: string) => void;
  showError: (message: string, description?: string) => void;
};

type CapabilityItem = {
  name: string;
  description?: string;
};

type ModeDraft = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  instructions: string;
  builtIn?: ModeBuiltInId;
  usesDefaultCapabilities?: boolean;
  allowedToolNames: string[];
  allowedSkillNames: string[];
  allowedAgentNames: string[];
};

type CapabilityPickerProps = {
  title: string;
  selectedLabel: string;
  icon: ReactNode;
  placeholder: string;
  emptyLabel: string;
  items: CapabilityItem[];
  selectedNames: string[];
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  onToggle: (name: string) => void;
};

function normalizeNameList(names: string[]) {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

function sortedNamesEqual(left: string[], right: string[]) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function createUniqueModeName(baseName: string, modes: LoadedModeInfo[]) {
  const existingNames = new Set(
    modes.map((mode) => mode.name.trim().toLowerCase()),
  );
  const normalizedBaseName = baseName.trim() || "mode";

  if (!existingNames.has(normalizedBaseName.toLowerCase())) {
    return normalizedBaseName;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${normalizedBaseName} ${index}`;
    if (!existingNames.has(candidate.toLowerCase())) return candidate;
  }

  return `${normalizedBaseName} ${Date.now()}`;
}

function matchesSearch(search: string, ...values: Array<string | undefined>) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
}


function createBlankModeDraft(): ModeDraft {
  return {
    id: `mode-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: "",
    enabled: true,
    description: "",
    instructions: "",
    usesDefaultCapabilities: false,
    allowedToolNames: [],
    allowedSkillNames: [],
    allowedAgentNames: [],
  };
}

function modeToDraft(
  mode: LoadedModeInfo,
  context: {
    availableTools: LoadedToolInfo[];
    availableSkills: LoadedSkillInfo[];
    availableAgents: LoadedAgentInfo[];
  },
): ModeDraft {
  const capabilities = modeToEditableCapabilities(mode, context);

  return {
    id: mode.id,
    name: mode.name,
    enabled: mode.enabled,
    description: mode.description,
    instructions: mode.instructions ?? "",
    builtIn: mode.builtIn,
    usesDefaultCapabilities: mode.usesDefaultCapabilities,
    allowedToolNames: capabilities.toolNames,
    allowedSkillNames: capabilities.skillNames,
    allowedAgentNames: capabilities.agentNames,
  };
}

function draftToMode(
  draft: ModeDraft,
  enabled: boolean = draft.enabled,
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
    allowedToolNames: normalizeNameList(draft.allowedToolNames),
    allowedSkillNames: normalizeNameList(draft.allowedSkillNames),
    allowedAgentNames: normalizeNameList(draft.allowedAgentNames),
  };
}

function areModeDraftsEqual(left: ModeDraft, right: ModeDraft) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.enabled === right.enabled &&
    left.description === right.description &&
    left.instructions === right.instructions &&
    left.builtIn === right.builtIn &&
    (left.usesDefaultCapabilities !== false) ===
      (right.usesDefaultCapabilities !== false) &&
    sortedNamesEqual(left.allowedToolNames, right.allowedToolNames) &&
    sortedNamesEqual(left.allowedSkillNames, right.allowedSkillNames) &&
    sortedNamesEqual(left.allowedAgentNames, right.allowedAgentNames)
  );
}

function validateModeDraft(draft: ModeDraft, modes: LoadedModeInfo[]) {
  const name = draft.name.trim();

  if (!name) throw new Error("Mode name is required.");

  const duplicate = modes.find(
    (mode) =>
      mode.id !== draft.id && mode.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) throw new Error(`A mode named "${name}" already exists.`);
}

function CapabilityPicker({
  title,
  selectedLabel,
  icon,
  placeholder,
  emptyLabel,
  items,
  selectedNames,
  searchValue,
  onSearchValueChange,
  onToggle,
}: CapabilityPickerProps) {
  const [open, setOpen] = useState(false);
  const selectedNameSet = useMemo(() => new Set(selectedNames), [selectedNames]);
  const visibleItems = useMemo(
    () =>
      items.filter((item) => matchesSearch(searchValue, item.name, item.description)),
    [items, searchValue],
  );
  const itemsByName = useMemo(
    () => new Map(items.map((item) => [item.name, item] as const)),
    [items],
  );

  return (
    <div className="grid gap-2">
      <Label>{title}</Label>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) onSearchValueChange("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-full justify-between px-3 text-left font-normal"
            disabled={items.length === 0}
          >
            <span
              className={cn(
                "min-w-0 truncate",
                selectedNames.length === 0 && "text-muted-foreground",
              )}
            >
              {selectedNames.length > 0
                ? `${selectedNames.length} ${selectedLabel}${selectedNames.length === 1 ? "" : "s"}`
                : items.length > 0
                  ? placeholder
                  : emptyLabel}
            </span>
            <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-trigger-width)] p-0"
        >
          <div className="grid max-h-[min(24rem,var(--radix-popover-content-available-height))] min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
            <div className="border-b p-2">
              <Input
                value={searchValue}
                onChange={(event) => onSearchValueChange(event.target.value)}
                placeholder={placeholder}
                className="h-9"
                autoFocus
              />
            </div>
            <div
              className="max-h-80 overflow-y-auto overscroll-contain p-1 chat-message-scrollbar"
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {visibleItems.length > 0 ? (
                visibleItems.map((item) => {
                  const checked = selectedNameSet.has(item.name);

                  return (
                    <div
                      key={item.name}
                      role="button"
                      tabIndex={0}
                      className="flex w-full min-w-0 cursor-pointer items-start gap-2 px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground focus-visible:outline-none"
                      onClick={() => onToggle(item.name)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onToggle(item.name);
                        }
                      }}
                      title={item.description}
                    >
                      <Checkbox
                        checked={checked}
                        tabIndex={-1}
                        className="pointer-events-none mt-1 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.name}</span>
                        {item.description ? (
                          <span className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="px-3 py-6 text-center text-base text-muted-foreground">
                  No matches found.
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {selectedNames.length > 0 ? (
        <div className="grid max-h-56 gap-1 overflow-y-auto border bg-muted/10 p-2">
          {selectedNames.map((name) => {
            const item = itemsByName.get(name);

            return (
              <div
                key={name}
                className="flex min-w-0 items-start gap-2 px-2 py-1.5 hover:bg-muted/70"
                title={item?.description}
              >
                <span className="mt-1 shrink-0 text-muted-foreground">{icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{name}</span>
                  {item?.description ? (
                    <span className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                <Checkbox
                  checked
                  onCheckedChange={() => onToggle(name)}
                  className="mt-1 shrink-0"
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function normalizeModesForState(state: ModesState) {
  return normalizeModesState(state).modes;
}

export const ModesDialog = memo(function ModesDialog({
  open,
  onOpenChange,
  modesState,
  onModesStateChange,
  availableTools,
  availableSkills,
  availableAgents,
  showSuccess,
  showError,
}: ModesDialogProps) {
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [modeDraft, setModeDraft] = useState<ModeDraft | null>(null);
  const [isCreatingMode, setIsCreatingMode] = useState(false);
  const [instructionsEditorOpen, setInstructionsEditorOpen] = useState(false);
  const [toolSearch, setToolSearch] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const [agentSearch, setAgentSearch] = useState("");

  const modes = useMemo(() => normalizeModesForState(modesState), [modesState]);
  const selectedMode = useMemo(
    () => modes.find((mode) => mode.id === selectedModeId) ?? null,
    [modes, selectedModeId],
  );
  const enabledModesCount = modes.filter((mode) => mode.enabled).length;

  const modeCapabilityContext = useMemo(
    () => ({ availableTools, availableSkills, availableAgents }),
    [availableAgents, availableSkills, availableTools],
  );

  const selectedCapabilities = useMemo(
    () =>
      modeDraft
        ? modeToEditableCapabilities(draftToMode(modeDraft), modeCapabilityContext)
        : { toolNames: [], skillNames: [], agentNames: [] },
    [modeCapabilityContext, modeDraft],
  );

  const savedDraft = useMemo(
    () =>
      selectedMode && !isCreatingMode
        ? modeToDraft(selectedMode, modeCapabilityContext)
        : null,
    [isCreatingMode, modeCapabilityContext, selectedMode],
  );

  const hasModeDraftChanges = useMemo(() => {
    if (!modeDraft) return false;
    if (isCreatingMode || !savedDraft) {
      return (
        Boolean(modeDraft.name.trim()) ||
        Boolean(modeDraft.description.trim()) ||
        Boolean(modeDraft.instructions.trim()) ||
        modeDraft.allowedToolNames.length > 0 ||
        modeDraft.allowedSkillNames.length > 0 ||
        modeDraft.allowedAgentNames.length > 0
      );
    }
    return !areModeDraftsEqual(modeDraft, savedDraft);
  }, [isCreatingMode, modeDraft, savedDraft]);

  const toolItems = useMemo(
    () => availableTools.map((tool) => ({ name: tool.name, description: tool.description })),
    [availableTools],
  );
  const skillItems = useMemo(
    () => availableSkills.map((skill) => ({ name: skill.name, description: skill.description })),
    [availableSkills],
  );
  const agentItems = useMemo(
    () => availableAgents.map((agent) => ({ name: agent.name, description: agent.description })),
    [availableAgents],
  );

  useEffect(() => {
    if (!open || isCreatingMode) return;

    if (selectedModeId && !modes.some((mode) => mode.id === selectedModeId)) {
      const fallbackMode = modes[0] ?? null;
      setSelectedModeId(fallbackMode?.id ?? null);
      setModeDraft(fallbackMode ? modeToDraft(fallbackMode, modeCapabilityContext) : null);
      return;
    }

    if (!selectedModeId) {
      const fallbackMode = modes[0] ?? null;
      setSelectedModeId(fallbackMode?.id ?? null);
      setModeDraft(fallbackMode ? modeToDraft(fallbackMode, modeCapabilityContext) : null);
      return;
    }

    if (!modeDraft && selectedMode) {
      setModeDraft(modeToDraft(selectedMode, modeCapabilityContext));
    }
  }, [
    open,
    isCreatingMode,
    modeCapabilityContext,
    modeDraft,
    modes,
    selectedMode,
    selectedModeId,
  ]);

  function updateModes(updater: (modes: LoadedModeInfo[]) => LoadedModeInfo[]) {
    onModesStateChange((current) =>
      normalizeModesState({ modes: updater(normalizeModesForState(current)) }),
    );
  }

  function updateModeDraft(patch: Partial<ModeDraft>) {
    setModeDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function addMode() {
    setSelectedModeId(null);
    setIsCreatingMode(true);
    setModeDraft(createBlankModeDraft());
  }

  function cloneCurrentMode() {
    if (!modeDraft) return;

    const mode: LoadedModeInfo = {
      ...draftToMode(modeDraft, true),
      id: `mode-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      builtIn: undefined,
      usesDefaultCapabilities: false,
      name: createUniqueModeName(`${modeDraft.name} copy`, modes),
      enabled: true,
      allowedToolNames: selectedCapabilities.toolNames,
      allowedSkillNames: selectedCapabilities.skillNames,
      allowedAgentNames: selectedCapabilities.agentNames,
    };

    setSelectedModeId(null);
    setIsCreatingMode(true);
    setModeDraft(modeToDraft(mode, modeCapabilityContext));
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
        currentMode.id === mode.id ? { ...currentMode, enabled: checked } : currentMode,
      ),
    );
  }

  function toggleCapability(kind: "tool" | "skill" | "agent", name: string) {
    if (!modeDraft) return;

    const key =
      kind === "tool"
        ? "allowedToolNames"
        : kind === "skill"
          ? "allowedSkillNames"
          : "allowedAgentNames";
    const source =
      kind === "tool"
        ? selectedCapabilities.toolNames
        : kind === "skill"
          ? selectedCapabilities.skillNames
          : selectedCapabilities.agentNames;
    const names = new Set(source);
    if (names.has(name)) names.delete(name);
    else names.add(name);

    updateModeDraft({
      usesDefaultCapabilities: false,
      [key]: [...names],
    } as Partial<ModeDraft>);
  }

  function resetModeDraft() {
    if (!modeDraft) return;

    if (modeDraft.builtIn) {
      const resetMode = updateBuiltInModeWithReset(
        getBuiltInModeDefaults(modeDraft.builtIn),
        modeCapabilityContext,
      );
      setModeDraft(
        modeToDraft(
          { ...resetMode, enabled: selectedMode?.enabled ?? modeDraft.enabled },
          modeCapabilityContext,
        ),
      );
      return;
    }

    if (isCreatingMode) {
      setModeDraft(createBlankModeDraft());
      return;
    }

    if (savedDraft) setModeDraft(savedDraft);
  }

  function saveCurrentModeDraft() {
    if (!modeDraft) return;

    try {
      validateModeDraft(modeDraft, modes);
      const mode = draftToMode(modeDraft, selectedMode?.enabled ?? modeDraft.enabled);

      if (isCreatingMode || !selectedMode) {
        updateModes((currentModes) => [...currentModes, mode]);
        setSelectedModeId(mode.id);
        setIsCreatingMode(false);
        setModeDraft(modeToDraft(mode, modeCapabilityContext));
        showSuccess("Mode created.");
        return;
      }

      updateModes((currentModes) =>
        currentModes.map((currentMode) =>
          currentMode.id === selectedMode.id ? mode : currentMode,
        ),
      );
      setModeDraft(modeToDraft(mode, modeCapabilityContext));
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
    setModeDraft(modeToDraft(mode, modeCapabilityContext));
    setInstructionsEditorOpen(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle>Modes</DialogTitle>
            <DialogDescription>
              Define chat modes with their own instructions and default tools,
              skills, and agents.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b bg-card/70 p-3 md:border-b-0 md:border-r">
              <div className="mb-3 flex items-center justify-between gap-2">
                <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Modes
                </Label>
                <span className="text-sm text-muted-foreground">
                  {enabledModesCount}/{modes.length} enabled
                </span>
              </div>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mb-3 w-full"
                onClick={addMode}
              >
                <Plus className="size-4" />
                Add mode
              </Button>

              <div className="grid gap-1.5">
                {modes.map((mode) => {
                  const selected = selectedMode?.id === mode.id && !isCreatingMode;

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
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectMode(mode);
                        }
                      }}
                    >
                      <Layers3 className="mt-1 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5 text-base leading-6">
                          <span className="truncate">{mode.name}</span>
                          {mode.builtIn ? (
                            <span className="shrink-0 border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                              Built-in
                            </span>
                          ) : null}
                        </div>
                        <div className="line-clamp-2 text-sm leading-5 text-muted-foreground">
                          {mode.description || "No description."}
                        </div>
                      </div>
                      <Switch
                        checked={mode.enabled}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={(checked) => toggleModeEnabled(mode, checked)}
                        className="mt-0.5 shrink-0 cursor-pointer"
                      />
                    </div>
                  );
                })}
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
                          onChange={(event) => updateModeDraft({ name: event.target.value })}
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
                          <Label htmlFor="mode-instructions">Instructions</Label>
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
                            updateModeDraft({ instructions: event.target.value })
                          }
                          placeholder="Optional mode-specific instructions added to the system prompt."
                          className="min-h-72 text-sm leading-6"
                        />
                      </div>

                      {modeDraft.builtIn && modeDraft.usesDefaultCapabilities !== false ? (
                        <div className="border bg-muted/25 px-3 py-2 text-sm leading-5 text-muted-foreground">
                          This built-in mode is using its dynamic default capabilities. Changing a capability below turns it into a custom override. Reset restores the built-in behavior.
                        </div>
                      ) : null}

                      <CapabilityPicker
                        title="Allowed tools"
                        selectedLabel="allowed tool"
                        icon={<Wrench className="size-4" />}
                        placeholder="Select allowed tools"
                        emptyLabel="No tools are available"
                        items={toolItems}
                        selectedNames={selectedCapabilities.toolNames}
                        searchValue={toolSearch}
                        onSearchValueChange={setToolSearch}
                        onToggle={(name) => toggleCapability("tool", name)}
                      />

                      <CapabilityPicker
                        title="Allowed skills"
                        selectedLabel="allowed skill"
                        icon={<BookOpen className="size-4" />}
                        placeholder="Select allowed skills"
                        emptyLabel="No skills are available"
                        items={skillItems}
                        selectedNames={selectedCapabilities.skillNames}
                        searchValue={skillSearch}
                        onSearchValueChange={setSkillSearch}
                        onToggle={(name) => toggleCapability("skill", name)}
                      />

                      <CapabilityPicker
                        title="Allowed agents"
                        selectedLabel="allowed agent"
                        icon={<Bot className="size-4" />}
                        placeholder="Select allowed agents"
                        emptyLabel="No agents are available"
                        items={agentItems}
                        selectedNames={selectedCapabilities.agentNames}
                        searchValue={agentSearch}
                        onSearchValueChange={setAgentSearch}
                        onToggle={(name) => toggleCapability("agent", name)}
                      />
                    </div>
                  </div>

                  <DialogFooter className="shrink-0 border-t bg-background px-5 py-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetModeDraft}
                      disabled={!modeDraft.builtIn && !hasModeDraftChanges}
                    >
                      Reset
                    </Button>
                    <Button
                      type="button"
                      onClick={saveCurrentModeDraft}
                      disabled={!hasModeDraftChanges}
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
                      instructions and default capabilities.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {modeDraft ? (
        <Dialog open={instructionsEditorOpen} onOpenChange={setInstructionsEditorOpen}>
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
              <Button type="button" onClick={() => setInstructionsEditorOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
});
