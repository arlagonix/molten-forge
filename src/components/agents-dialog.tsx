import {
  Bot,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Copy,
  Download,
  FolderOpen,
  Maximize2,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { memo, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  BUILTIN_AGENT_NAMES,
  createBuiltInAgents,
  isBuiltInAgentName,
} from "@/lib/ai-chat/builtin-agents";
import {
  createId,
  getEnabledProviderModels,
  labelForError,
  providerDisplayName,
} from "@/lib/ai-chat/chat-utils";
import {
  deleteAgent as deleteStoredAgent,
  exportAgent,
  exportAgents,
  importAgents,
  loadAgents,
  openAgentsFolder,
  saveAgent,
} from "@/lib/ai-chat/storage";
import type {
  AgentContextMode,
  AgentImportResult,
  AgentsSettings,
  FeaturePermission,
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  Permission,
  ProviderConfig,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

type AgentDraft = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  instructions: string;
  contextMode: AgentContextMode;
  providerId: string;
  model: string;
  maxNestingDepth: string;
  loadedSkillNames: string[];
  allowedToolNames: string[];
  allowedAgentNames: string[];
};

type AgentsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentsSettings: AgentsSettings;
  onAgentsSettingsChange: Dispatch<SetStateAction<AgentsSettings>>;
  loadedAgents: LoadedAgentInfo[];
  onLoadedAgentsChange: Dispatch<SetStateAction<LoadedAgentInfo[]>>;
  availableTools: LoadedToolInfo[];
  availableSkills: LoadedSkillInfo[];
  providers: ProviderConfig[];
  showSuccess: (message: string, description?: string) => void;
  showError: (message: string, description?: string) => void;
};

const DEFAULT_AGENT_MAX_NESTING_DEPTH = 2;

function getAgentsMasterPermission(
  settings: AgentsSettings,
): FeaturePermission {
  return settings.agentsPermission ?? "custom";
}

function getAgentPermission(
  settings: AgentsSettings,
  agentName: string,
): Permission {
  if (settings.agentPermissions?.[agentName])
    return settings.agentPermissions[agentName];
  return settings.enabled === false ? "deny" : "ask";
}

function getDisplayedAgentPermission(
  settings: AgentsSettings,
  agentName: string,
): Permission {
  const masterPermission = getAgentsMasterPermission(settings);
  return masterPermission === "custom"
    ? getAgentPermission(settings, agentName)
    : masterPermission;
}

function PermissionSelect({
  value,
  onChange,
  disabled,
}: {
  value: Permission;
  onChange: (value: Permission) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as Permission)}
      disabled={disabled}
    >
      <SelectTrigger
        className="h-8 w-[6.25rem] shrink-0"
        onClick={(event) => event.stopPropagation()}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="allow">Allow</SelectItem>
        <SelectItem value="ask">Ask</SelectItem>
        <SelectItem value="deny">Deny</SelectItem>
      </SelectContent>
    </Select>
  );
}

function MasterPermissionSelect({
  value,
  onChange,
}: {
  value: FeaturePermission;
  onChange: (value: FeaturePermission) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as FeaturePermission)}
    >
      <SelectTrigger
        className="h-8 w-27 shrink-0"
        onClick={(event) => event.stopPropagation()}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="custom">Custom</SelectItem>
        <SelectItem value="allow">Allow</SelectItem>
        <SelectItem value="ask">Ask</SelectItem>
        <SelectItem value="deny">Deny</SelectItem>
      </SelectContent>
    </Select>
  );
}

function createBlankAgentDraft(): AgentDraft {
  return {
    id: createId(),
    name: "",
    enabled: true,
    description: "",
    instructions: "",
    contextMode: "task_only",
    providerId: "",
    model: "",
    maxNestingDepth: String(DEFAULT_AGENT_MAX_NESTING_DEPTH),
    loadedSkillNames: [],
    allowedToolNames: [],
    allowedAgentNames: [],
  };
}

function agentToDraft(agent: LoadedAgentInfo): AgentDraft {
  return {
    id: agent.id,
    name: agent.name,
    enabled: agent.enabled,
    description: agent.description,
    instructions: agent.instructions,
    contextMode: agent.contextMode ?? "task_only",
    providerId: agent.providerId ?? "",
    model: agent.model ?? "",
    maxNestingDepth: String(
      agent.maxNestingDepth ?? DEFAULT_AGENT_MAX_NESTING_DEPTH,
    ),
    loadedSkillNames: agent.loadedSkillNames ?? [],
    allowedToolNames: agent.allowedToolNames ?? [],
    allowedAgentNames: agent.allowedAgentNames ?? [],
  };
}

function normalizeNameList(names: string[]) {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

function draftToAgent(draft: AgentDraft): LoadedAgentInfo {
  const rawMaxNestingDepth = Number(draft.maxNestingDepth);

  return {
    id: draft.id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    description: draft.description.trim(),
    instructions: draft.instructions.trim(),
    contextMode: draft.contextMode,
    providerId: draft.providerId.trim() || undefined,
    model: draft.model.trim() || undefined,
    maxNestingDepth: Number.isFinite(rawMaxNestingDepth)
      ? Math.min(Math.max(Math.round(rawMaxNestingDepth), 1), 8)
      : DEFAULT_AGENT_MAX_NESTING_DEPTH,
    loadedSkillNames: normalizeNameList(draft.loadedSkillNames),
    allowedToolNames: normalizeNameList(draft.allowedToolNames),
    allowedAgentNames: normalizeNameList(draft.allowedAgentNames),
  };
}

function validateAgentDraft(agent: LoadedAgentInfo) {
  if (!agent.name) throw new Error("Agent name is required.");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(agent.name)) {
    throw new Error(
      "Agent name must use only letters, numbers, underscores, or hyphens.",
    );
  }
  if (agent.name === "call_agent") {
    throw new Error(
      "call_agent is a built-in tool name and cannot be used by an agent.",
    );
  }
  if (isBuiltInAgentName(agent.name)) {
    throw new Error(
      `${agent.name} is a built-in agent name and cannot be used by a custom agent. Reserved names: ${BUILTIN_AGENT_NAMES.join(", ")}.`,
    );
  }
  if (!agent.description) throw new Error("Agent description is required.");
  if (!agent.instructions) throw new Error("Agent instructions are required.");
}

function areAgentDraftsEqual(left: AgentDraft, right: AgentDraft) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.enabled === right.enabled &&
    left.description === right.description &&
    left.instructions === right.instructions &&
    left.contextMode === right.contextMode &&
    left.providerId === right.providerId &&
    left.model === right.model &&
    left.maxNestingDepth === right.maxNestingDepth &&
    JSON.stringify([...left.loadedSkillNames].sort()) ===
      JSON.stringify([...right.loadedSkillNames].sort()) &&
    JSON.stringify([...left.allowedToolNames].sort()) ===
      JSON.stringify([...right.allowedToolNames].sort()) &&
    JSON.stringify([...left.allowedAgentNames].sort()) ===
      JSON.stringify([...right.allowedAgentNames].sort())
  );
}

function formatAgentImportSummary(result: AgentImportResult) {
  return [
    `${result.imported} imported`,
    `${result.updated} updated`,
    `${result.renamed.length} renamed`,
    `${result.skipped.length} skipped`,
    `${result.invalid.length} invalid`,
  ].join(" · ");
}

function createUniqueAgentCloneName(
  baseName: string,
  agents: LoadedAgentInfo[],
) {
  const existingNames = new Set(agents.map((agent) => agent.name));
  const normalizedBase = baseName.trim() || "agent";

  for (let index = 1; index < 1000; index += 1) {
    const suffix = `_${index}`;
    const candidate = `${normalizedBase.slice(0, 64 - suffix.length)}${suffix}`;
    if (!existingNames.has(candidate)) return candidate;
  }

  return `${normalizedBase.slice(0, 55)}_${createId().slice(0, 8)}`;
}

export const AgentsDialog = memo(function AgentsDialog({
  open,
  onOpenChange,
  agentsSettings,
  onAgentsSettingsChange,
  loadedAgents,
  onLoadedAgentsChange,
  availableTools,
  availableSkills,
  providers,
  showSuccess,
  showError,
}: AgentsDialogProps) {
  const [agentLoadErrors, setAgentLoadErrors] = useState<
    Array<{ source: string; message: string }>
  >([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(
    null,
  );
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [loadedSkillSearch, setLoadedSkillSearch] = useState("");
  const [toolSearch, setToolSearch] = useState("");
  const [agentSearch, setAgentSearch] = useState("");
  const [instructionsEditorOpen, setInstructionsEditorOpen] = useState(false);

  const builtInAgents = useMemo(
    () => createBuiltInAgents(agentsSettings.builtInAgentMaxNestingDepths),
    [agentsSettings.builtInAgentMaxNestingDepths],
  );
  const displayedAgents = useMemo(
    () => [
      ...builtInAgents,
      ...loadedAgents.filter((agent) => !isBuiltInAgentName(agent.name)),
    ],
    [builtInAgents, loadedAgents],
  );
  const groupedDisplayedAgents = useMemo(
    () =>
      [
        {
          title: "Built-in",
          agents: displayedAgents.filter((agent) =>
            isBuiltInAgentName(agent.name),
          ),
        },
        {
          title: "Custom",
          agents: displayedAgents.filter(
            (agent) => !isBuiltInAgentName(agent.name),
          ),
        },
      ].filter((group) => group.agents.length > 0),
    [displayedAgents],
  );
  const selectedAgent = useMemo(
    () =>
      displayedAgents.find((agent) => agent.name === selectedAgentName) ?? null,
    [displayedAgents, selectedAgentName],
  );
  const selectedAgentIsBuiltIn = selectedAgent
    ? isBuiltInAgentName(selectedAgent.name)
    : false;
  const agentsMasterPermission = getAgentsMasterPermission(agentsSettings);
  const childPermissionsLocked = agentsMasterPermission !== "custom";
  const enabledAgentsCount = displayedAgents.filter(
    (agent) =>
      getDisplayedAgentPermission(agentsSettings, agent.name) !== "deny",
  ).length;

  const visibleProviderGroups = useMemo(() => {
    const search = modelSearch.trim().toLowerCase();

    return providers
      .map((provider) => {
        const models = getEnabledProviderModels(provider).filter((model) =>
          search
            ? `${providerDisplayName(provider)} ${model}`
                .toLowerCase()
                .includes(search)
            : true,
        );

        return { provider, models };
      })
      .filter((group) => group.models.length > 0);
  }, [providers, modelSearch]);

  useEffect(() => {
    const isEditingUnsavedAgent =
      agentDraft &&
      !selectedAgentName &&
      !loadedAgents.some((agent) => agent.id === agentDraft.id);

    if (isEditingUnsavedAgent) return;

    if (
      !selectedAgentName ||
      !displayedAgents.some((agent) => agent.name === selectedAgentName)
    ) {
      setSelectedAgentName(displayedAgents[0]?.name ?? null);
    }
  }, [displayedAgents, loadedAgents, selectedAgentName, agentDraft]);

  useEffect(() => {
    const selected = displayedAgents.find(
      (agent) => agent.name === selectedAgentName,
    );
    if (selected) setAgentDraft(agentToDraft(selected));
    else if (selectedAgentName) setAgentDraft(null);
  }, [displayedAgents, selectedAgentName]);

  function updateAgentDraft(patch: Partial<AgentDraft>) {
    setAgentDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function updateMaxNestingDepth(value: string) {
    updateAgentDraft({ maxNestingDepth: value });

    if (!selectedAgentIsBuiltIn || !selectedAgent) return;

    const rawDepth = Number(value);
    if (!Number.isFinite(rawDepth)) return;

    const maxNestingDepth = Math.min(Math.max(Math.round(rawDepth), 1), 8);
    onAgentsSettingsChange((current) => ({
      ...current,
      builtInAgentMaxNestingDepths: {
        ...(current.builtInAgentMaxNestingDepths ?? {}),
        [selectedAgent.name]: maxNestingDepth,
      },
    }));
  }

  const hasAgentDraftChanges = useMemo(() => {
    if (!agentDraft || selectedAgentIsBuiltIn) return false;
    const originalDraft = selectedAgent
      ? agentToDraft(selectedAgent)
      : { ...createBlankAgentDraft(), id: agentDraft.id };
    return !areAgentDraftsEqual(agentDraft, originalDraft);
  }, [selectedAgent, selectedAgentIsBuiltIn, agentDraft]);

  async function saveCurrentAgentDraft() {
    if (!agentDraft) return;
    setIsSavingAgent(true);

    try {
      const agent = draftToAgent(agentDraft);
      validateAgentDraft(agent);
      const savedAgent = await saveAgent(agent);
      onLoadedAgentsChange((current) => {
        const next = current.filter((item) => item.id !== savedAgent.id);
        next.push(savedAgent);
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      setSelectedAgentName(savedAgent.name);
      setAgentDraft(agentToDraft(savedAgent));
      showSuccess("Agent saved");
    } catch (error) {
      showError("Failed to save agent", labelForError(error));
    } finally {
      setIsSavingAgent(false);
    }
  }

  async function deleteCurrentAgent() {
    if (!agentDraft) return;

    try {
      await deleteStoredAgent(agentDraft.id);
      onLoadedAgentsChange((current) =>
        current.filter((agent) => agent.id !== agentDraft.id),
      );
      setAgentDraft(null);
      setSelectedAgentName(null);
      showSuccess("Agent deleted");
    } catch (error) {
      showError("Failed to delete agent", labelForError(error));
    }
  }

  async function importAgentFiles() {
    setIsLoadingAgents(true);

    try {
      const result = await importAgents();
      if (result.cancelled) return;

      const agents = await loadAgents();
      onLoadedAgentsChange(agents);
      setAgentLoadErrors([...result.invalid, ...result.skipped]);

      const summary = formatAgentImportSummary(result);
      if (result.imported + result.updated > 0)
        showSuccess("Agents import completed", summary);
      else showError("No agents imported", summary);
    } catch (error) {
      showError("Failed to import agents", labelForError(error));
    } finally {
      setIsLoadingAgents(false);
    }
  }

  async function exportAllAgents() {
    if (loadedAgents.length === 0) {
      showError("No agents to export");
      return;
    }

    try {
      const result = await exportAgents(loadedAgents);
      if (result.cancelled) return;
      showSuccess(
        `Exported ${result.exported} agent${result.exported === 1 ? "" : "s"}.`,
        result.path,
      );
    } catch (error) {
      showError("Failed to export agents", labelForError(error));
    }
  }

  async function exportCurrentAgent() {
    if (!agentDraft) return;

    try {
      const agent = draftToAgent(agentDraft);
      validateAgentDraft(agent);
      const result = await exportAgent(agent);
      if (result.cancelled) return;
      showSuccess("Agent exported", result.path);
    } catch (error) {
      showError("Failed to export agent", labelForError(error));
    }
  }

  async function openAgentStorageFolder() {
    try {
      await openAgentsFolder();
    } catch (error) {
      showError("Failed to open agents folder", labelForError(error));
    }
  }

  function cloneCurrentAgent() {
    if (!agentDraft) return;

    const draft = {
      ...agentDraft,
      id: createId(),
      name: createUniqueAgentCloneName(agentDraft.name, loadedAgents),
    };
    setSelectedAgentName(null);
    setAgentDraft(draft);
  }

  function toggleLoadedSkill(skillName: string) {
    if (!agentDraft) return;
    const selectedNames = new Set<string>(agentDraft.loadedSkillNames);
    if (selectedNames.has(skillName)) selectedNames.delete(skillName);
    else selectedNames.add(skillName);
    updateAgentDraft({ loadedSkillNames: [...selectedNames] });
  }

  function toggleAllowedTool(toolName: string) {
    if (!agentDraft) return;
    const selectedNames = new Set<string>(agentDraft.allowedToolNames);
    if (selectedNames.has(toolName)) selectedNames.delete(toolName);
    else selectedNames.add(toolName);
    updateAgentDraft({ allowedToolNames: [...selectedNames] });
  }

  function toggleAllowedAgent(agentName: string) {
    if (!agentDraft) return;
    const selectedNames = new Set<string>(agentDraft.allowedAgentNames);
    if (selectedNames.has(agentName)) selectedNames.delete(agentName);
    else selectedNames.add(agentName);
    updateAgentDraft({ allowedAgentNames: [...selectedNames] });
  }

  const loadedSkillSearchText = loadedSkillSearch.trim().toLowerCase();
  const visibleLoadedSkills = loadedSkillSearchText
    ? availableSkills.filter((skill) =>
        `${skill.name} ${skill.description}`
          .toLowerCase()
          .includes(loadedSkillSearchText),
      )
    : availableSkills;
  const loadedSkillsByName = useMemo(
    () => new Map(availableSkills.map((skill) => [skill.name, skill] as const)),
    [availableSkills],
  );

  const toolSearchText = toolSearch.trim().toLowerCase();
  const visibleTools = toolSearchText
    ? availableTools.filter((tool) =>
        `${tool.name} ${tool.description}`
          .toLowerCase()
          .includes(toolSearchText),
      )
    : availableTools;
  const toolsByName = useMemo(
    () => new Map(availableTools.map((tool) => [tool.name, tool] as const)),
    [availableTools],
  );

  const agentSearchText = agentSearch.trim().toLowerCase();
  const visibleAgents = displayedAgents.filter((agent) => {
    if (agent.id === agentDraft?.id) return false;
    if (!agentSearchText) return true;
    return `${agent.name} ${agent.description}`
      .toLowerCase()
      .includes(agentSearchText);
  });
  const agentsByName = useMemo(
    () => new Map(displayedAgents.map((agent) => [agent.name, agent] as const)),
    [displayedAgents],
  );

  function setAgentPermission(agentName: string, permission: Permission) {
    onAgentsSettingsChange((current) => ({
      ...current,
      enabled: true,
      permissionModelVersion: 2,
      agentPermissions: {
        ...(current.agentPermissions ?? {}),
        [agentName]: permission,
      },
    }));
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle>Agents</DialogTitle>
            <DialogDescription>
              Define callable agents with their own instructions, context mode,
              optional model override, and explicit tool/agent permissions.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[400px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b bg-card/70 p-3 md:border-b-0 md:border-r">
              <div className="mb-3 flex items-center justify-between gap-2">
                <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Agents
                </Label>
                <span className="text-sm text-muted-foreground">
                  {enabledAgentsCount}/{displayedAgents.length} enabled
                </span>
              </div>

              <div className="mb-3 flex items-start justify-between gap-3 border bg-background px-3 py-2 text-base">
                <span className="min-w-0">
                  <span className="block font-medium">Agents</span>
                  <span className="block text-sm leading-5 text-muted-foreground">
                    Master permission for the whole agents feature. Modes can
                    override it.
                  </span>
                </span>
                <MasterPermissionSelect
                  value={agentsMasterPermission}
                  onChange={(permission) =>
                    onAgentsSettingsChange((current) => ({
                      ...current,
                      enabled: permission !== "deny",
                      agentsPermission: permission,
                      permissionModelVersion: 2,
                    }))
                  }
                />
              </div>

              <div className="mb-3 flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    const draft = createBlankAgentDraft();
                    setSelectedAgentName(null);
                    setAgentDraft(draft);
                  }}
                >
                  <Plus className="size-4" />
                  Add agent
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      title="Agent actions"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem
                      disabled={isLoadingAgents}
                      onSelect={() => void importAgentFiles()}
                    >
                      <Download className="size-4" />
                      Import agents...
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void exportAllAgents()}>
                      <Upload className="size-4" />
                      Export all agents...
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => void openAgentStorageFolder()}
                    >
                      <FolderOpen className="size-4" />
                      Open agents folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="grid gap-3">
                {groupedDisplayedAgents.map((group) => (
                  <div key={group.title} className="grid gap-1.5">
                    <Label className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {group.title}
                    </Label>
                    {group.agents.map((agent) => (
                      <div
                        key={agent.id}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          "group flex min-w-0 cursor-pointer items-start gap-2 border px-2 py-2 outline-none",
                          selectedAgent?.id === agent.id
                            ? "border-primary/30 bg-accent text-accent-foreground"
                            : "border-transparent hover:border-border hover:bg-muted/60",
                        )}
                        onClick={() => setSelectedAgentName(agent.name)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedAgentName(agent.name);
                          }
                        }}
                      >
                        <Bot className="mt-1 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base leading-6">
                            {agent.name}
                          </div>
                          <div className="line-clamp-2 text-sm leading-5 text-muted-foreground">
                            {agent.description}
                          </div>
                        </div>
                        <PermissionSelect
                          value={getDisplayedAgentPermission(
                            agentsSettings,
                            agent.name,
                          )}
                          disabled={childPermissionsLocked}
                          onChange={(next) =>
                            setAgentPermission(agent.name, next)
                          }
                        />
                      </div>
                    ))}
                  </div>
                ))}

                {displayedAgents.length === 0 && (
                  <div className="border border-dashed px-3 py-4 text-center text-base text-muted-foreground">
                    No agents configured.
                  </div>
                )}
              </div>

              {agentLoadErrors.length > 0 && (
                <div className="mt-4 grid gap-2">
                  <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    Agent file issues
                  </Label>
                  {agentLoadErrors.map((error) => (
                    <div
                      key={`${error.source}:${error.message}`}
                      className="border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-sm leading-5"
                    >
                      <div
                        className="truncate font-medium text-destructive"
                        title={error.source}
                      >
                        {error.source}
                      </div>
                      <div className="text-muted-foreground">
                        {error.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </aside>

            <div className="min-h-0 flex flex-col overflow-hidden">
              {agentDraft ? (
                <>
                  <div className="z-20 flex min-h-[4.25rem] shrink-0 items-center border-b bg-background px-5 py-3">
                    <div className="flex w-full items-center justify-between gap-4">
                      <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                        {selectedAgentIsBuiltIn
                          ? "Built-in agent"
                          : selectedAgent
                            ? "Edit agent"
                            : "New agent"}
                      </Label>
                      {selectedAgent &&
                        agentDraft &&
                        !selectedAgentIsBuiltIn && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                title="Agent options"
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem
                                onSelect={() => cloneCurrentAgent()}
                              >
                                <Copy className="size-4" />
                                Clone
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => void exportCurrentAgent()}
                              >
                                <Upload className="size-4" />
                                Export
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => void deleteCurrentAgent()}
                              >
                                <Trash2 className="size-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                    <div className="grid gap-5 pb-1">
                      <div className="grid gap-2">
                        <Label htmlFor="agent-name">Name</Label>
                        <Input
                          id="agent-name"
                          value={agentDraft.name}
                          onChange={(event) =>
                            updateAgentDraft({ name: event.target.value })
                          }
                          placeholder="reviewer"
                          disabled={selectedAgentIsBuiltIn}
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="agent-description">Description</Label>
                        <Textarea
                          id="agent-description"
                          value={agentDraft.description}
                          onChange={(event) =>
                            updateAgentDraft({
                              description: event.target.value,
                            })
                          }
                          placeholder="What this agent is good at and when the main model should call it."
                          disabled={selectedAgentIsBuiltIn}
                          className="min-h-24 leading-6"
                        />
                      </div>

                      <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="agent-instructions">
                            Instructions
                          </Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-sm"
                            onClick={() => setInstructionsEditorOpen(true)}
                            disabled={selectedAgentIsBuiltIn}
                          >
                            <Maximize2 className="size-4" />
                            Open editor
                          </Button>
                        </div>
                        <Textarea
                          id="agent-instructions"
                          value={agentDraft.instructions}
                          onChange={(event) =>
                            updateAgentDraft({
                              instructions: event.target.value,
                            })
                          }
                          placeholder="Agent system prompt / instructions."
                          disabled={selectedAgentIsBuiltIn}
                          className="min-h-72 text-sm leading-6"
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="agent-context-mode">Context mode</Label>
                        <Select
                          value={agentDraft.contextMode}
                          disabled={selectedAgentIsBuiltIn}
                          onValueChange={(value) =>
                            updateAgentDraft({
                              contextMode:
                                value === "full_chat"
                                  ? "full_chat"
                                  : "task_only",
                            })
                          }
                        >
                          <SelectTrigger id="agent-context-mode">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="task_only">Task only</SelectItem>
                            <SelectItem value="full_chat">Full chat</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="agent-model-picker">Model</Label>
                        <Popover
                          open={modelPickerOpen}
                          onOpenChange={(nextOpen) => {
                            setModelPickerOpen(nextOpen);
                            if (!nextOpen) setModelSearch("");
                          }}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              id="agent-model-picker"
                              type="button"
                              variant="outline"
                              role="combobox"
                              aria-expanded={modelPickerOpen}
                              className="w-full justify-between px-3 text-left font-normal"
                              disabled={selectedAgentIsBuiltIn}
                              title={
                                agentDraft.providerId && agentDraft.model
                                  ? `${agentDraft.model}`
                                  : "Use current chat model"
                              }
                            >
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate",
                                  !agentDraft.providerId &&
                                    !agentDraft.model &&
                                    "text-muted-foreground",
                                )}
                              >
                                {agentDraft.providerId && agentDraft.model
                                  ? agentDraft.model
                                  : "Use current chat model"}
                              </span>
                              <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-trigger-width)] p-0"
                          >
                            <Command
                              shouldFilter={false}
                              className="h-auto max-h-[min(24rem,var(--radix-popover-content-available-height))] overflow-hidden"
                            >
                              <CommandInput
                                value={modelSearch}
                                onValueChange={setModelSearch}
                                placeholder="Search models..."
                              />
                              <CommandList
                                className="max-h-80 overflow-y-auto overscroll-contain chat-message-scrollbar"
                                onWheelCapture={(event) =>
                                  event.stopPropagation()
                                }
                              >
                                <CommandGroup heading="Default">
                                  <CommandItem
                                    value="Use current chat model"
                                    onSelect={() => {
                                      updateAgentDraft({
                                        providerId: "",
                                        model: "",
                                      });
                                      setModelPickerOpen(false);
                                      setModelSearch("");
                                    }}
                                    className="min-w-0 cursor-pointer"
                                  >
                                    <span className="min-w-0 flex-1 truncate">
                                      Use current chat model
                                    </span>
                                    <Check
                                      className={cn(
                                        "size-4",
                                        !agentDraft.providerId &&
                                          !agentDraft.model
                                          ? "opacity-100"
                                          : "opacity-0",
                                      )}
                                    />
                                  </CommandItem>
                                </CommandGroup>
                                {visibleProviderGroups.length > 0 ? (
                                  visibleProviderGroups.map(
                                    ({ provider, models }) => (
                                      <CommandGroup
                                        key={provider.id}
                                        heading={providerDisplayName(provider)}
                                      >
                                        {models.map((model) => (
                                          <CommandItem
                                            key={`${provider.id}:${model}`}
                                            value={`${providerDisplayName(provider)} ${model}`}
                                            onSelect={() => {
                                              updateAgentDraft({
                                                providerId: provider.id,
                                                model,
                                              });
                                              setModelPickerOpen(false);
                                              setModelSearch("");
                                            }}
                                            className="min-w-0 cursor-pointer"
                                            title={`${providerDisplayName(provider)} · ${model}`}
                                          >
                                            <span className="min-w-0 flex-1 truncate">
                                              {model}
                                            </span>
                                            <Check
                                              className={cn(
                                                "size-4",
                                                agentDraft.providerId ===
                                                  provider.id &&
                                                  agentDraft.model === model
                                                  ? "opacity-100"
                                                  : "opacity-0",
                                              )}
                                            />
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    ),
                                  )
                                ) : (
                                  <CommandEmpty>
                                    No visible models. Enable models in
                                    Providers.
                                  </CommandEmpty>
                                )}
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="agent-max-nesting-depth">
                          Max nesting depth
                        </Label>
                        <Input
                          id="agent-max-nesting-depth"
                          type="number"
                          min={1}
                          max={8}
                          value={agentDraft.maxNestingDepth}
                          onChange={(event) =>
                            updateMaxNestingDepth(event.target.value)
                          }
                        />
                      </div>

                      {selectedAgentIsBuiltIn ? (
                        <div className="border bg-muted/25 px-3 py-2 text-sm leading-5 text-muted-foreground">
                          Built-in agents mirror the current chat's effective
                          tools, skills, and allowed agents at runtime, so only
                          their max nesting depth is editable here.
                        </div>
                      ) : (
                        <>
                          <div className="grid gap-2">
                            <Label>Loaded skills</Label>
                            <Popover
                              onOpenChange={(nextOpen) => {
                                if (!nextOpen) setLoadedSkillSearch("");
                              }}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  role="combobox"
                                  className="w-full justify-between px-3 text-left font-normal"
                                  disabled={availableSkills.length === 0}
                                >
                                  <span
                                    className={cn(
                                      "min-w-0 truncate",
                                      agentDraft.loadedSkillNames.length ===
                                        0 && "text-muted-foreground",
                                    )}
                                  >
                                    {agentDraft.loadedSkillNames.length > 0
                                      ? `${agentDraft.loadedSkillNames.length} loaded skill${agentDraft.loadedSkillNames.length === 1 ? "" : "s"}`
                                      : availableSkills.length > 0
                                        ? "Select loaded skills"
                                        : "No skills are available"}
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
                                      value={loadedSkillSearch}
                                      onChange={(event) =>
                                        setLoadedSkillSearch(event.target.value)
                                      }
                                      placeholder="Search skills..."
                                      className="h-9"
                                    />
                                  </div>
                                  <div
                                    className="max-h-80 overflow-y-auto overscroll-contain p-1 chat-message-scrollbar"
                                    onWheelCapture={(event) =>
                                      event.stopPropagation()
                                    }
                                  >
                                    {visibleLoadedSkills.length > 0 ? (
                                      visibleLoadedSkills.map((skill) => {
                                        const checked =
                                          agentDraft.loadedSkillNames.includes(
                                            skill.name,
                                          );
                                        return (
                                          <div
                                            key={skill.name}
                                            role="button"
                                            tabIndex={0}
                                            className="flex w-full min-w-0 cursor-pointer items-start gap-2 px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground focus-visible:outline-none"
                                            onClick={() =>
                                              toggleLoadedSkill(skill.name)
                                            }
                                            onKeyDown={(event) => {
                                              if (
                                                event.key === "Enter" ||
                                                event.key === " "
                                              ) {
                                                event.preventDefault();
                                                toggleLoadedSkill(skill.name);
                                              }
                                            }}
                                            title={skill.description}
                                          >
                                            <Checkbox
                                              checked={checked}
                                              tabIndex={-1}
                                              className="mt-1 shrink-0 pointer-events-none"
                                            />
                                            <span className="min-w-0 flex-1">
                                              <span className="block truncate font-medium">
                                                {skill.name}
                                              </span>
                                              {skill.description && (
                                                <span className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                                                  {skill.description}
                                                </span>
                                              )}
                                            </span>
                                          </div>
                                        );
                                      })
                                    ) : (
                                      <div className="px-3 py-6 text-center text-base text-muted-foreground">
                                        No skills found.
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>

                            {agentDraft.loadedSkillNames.length > 0 && (
                              <div className="grid max-h-56 gap-1 overflow-y-auto border bg-muted/10 p-2">
                                {agentDraft.loadedSkillNames.map(
                                  (skillName) => {
                                    const skill =
                                      loadedSkillsByName.get(skillName);
                                    return (
                                      <div
                                        key={skillName}
                                        className="flex min-w-0 items-start gap-2 px-2 py-1.5 hover:bg-muted/70"
                                        title={skill?.description}
                                      >
                                        <Checkbox
                                          checked
                                          onCheckedChange={() =>
                                            toggleLoadedSkill(skillName)
                                          }
                                          className="mt-1 shrink-0"
                                        />
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate font-medium">
                                            {skillName}
                                          </span>
                                          {skill?.description && (
                                            <span className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                                              {skill.description}
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    );
                                  },
                                )}
                              </div>
                            )}
                          </div>

                          <div className="grid gap-2">
                            <Label>Allowed tools</Label>
                            <Popover
                              onOpenChange={(nextOpen) => {
                                if (!nextOpen) setToolSearch("");
                              }}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  role="combobox"
                                  className="w-full justify-between px-3 text-left font-normal"
                                  disabled={availableTools.length === 0}
                                >
                                  <span
                                    className={cn(
                                      "min-w-0 truncate",
                                      agentDraft.allowedToolNames.length ===
                                        0 && "text-muted-foreground",
                                    )}
                                  >
                                    {agentDraft.allowedToolNames.length > 0
                                      ? `${agentDraft.allowedToolNames.length} allowed tool${agentDraft.allowedToolNames.length === 1 ? "" : "s"}`
                                      : availableTools.length > 0
                                        ? "Select allowed tools"
                                        : "No tools are available"}
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
                                      value={toolSearch}
                                      onChange={(event) =>
                                        setToolSearch(event.target.value)
                                      }
                                      placeholder="Search tools..."
                                      className="h-9"
                                    />
                                  </div>
                                  <div
                                    className="max-h-80 overflow-y-auto overscroll-contain p-1 chat-message-scrollbar"
                                    onWheelCapture={(event) =>
                                      event.stopPropagation()
                                    }
                                  >
                                    {visibleTools.length > 0 ? (
                                      visibleTools.map((tool) => {
                                        const checked =
                                          agentDraft.allowedToolNames.includes(
                                            tool.name,
                                          );
                                        return (
                                          <div
                                            key={tool.name}
                                            role="button"
                                            tabIndex={0}
                                            className="flex w-full min-w-0 cursor-pointer items-start gap-2 px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground focus-visible:outline-none"
                                            onClick={() =>
                                              toggleAllowedTool(tool.name)
                                            }
                                            onKeyDown={(event) => {
                                              if (
                                                event.key === "Enter" ||
                                                event.key === " "
                                              ) {
                                                event.preventDefault();
                                                toggleAllowedTool(tool.name);
                                              }
                                            }}
                                            title={tool.description}
                                          >
                                            <Checkbox
                                              checked={checked}
                                              tabIndex={-1}
                                              className="mt-1 shrink-0 pointer-events-none"
                                            />
                                            <span className="min-w-0 flex-1">
                                              <span className="block truncate font-medium">
                                                {tool.name}
                                              </span>
                                              {tool.description && (
                                                <span className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                                                  {tool.description}
                                                </span>
                                              )}
                                            </span>
                                          </div>
                                        );
                                      })
                                    ) : (
                                      <div className="px-3 py-6 text-center text-base text-muted-foreground">
                                        No tools found.
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>

                            {agentDraft.allowedToolNames.length > 0 && (
                              <div className="grid max-h-56 gap-1 overflow-y-auto border bg-muted/10 p-2">
                                {agentDraft.allowedToolNames.map((toolName) => {
                                  const tool = toolsByName.get(toolName);
                                  return (
                                    <div
                                      key={toolName}
                                      className="flex min-w-0 items-start gap-2 px-2 py-1.5 hover:bg-muted/70"
                                      title={tool?.description}
                                    >
                                      <Wrench className="mt-1 size-4 shrink-0 text-muted-foreground" />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium">
                                          {toolName}
                                        </span>
                                        {tool?.description && (
                                          <span className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                                            {tool.description}
                                          </span>
                                        )}
                                      </span>
                                      <Checkbox
                                        checked
                                        onCheckedChange={() =>
                                          toggleAllowedTool(toolName)
                                        }
                                        className="mt-1 shrink-0"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          <div className="grid gap-2">
                            <Label>Allowed agents</Label>
                            <Popover
                              onOpenChange={(nextOpen) => {
                                if (!nextOpen) setAgentSearch("");
                              }}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  role="combobox"
                                  className="w-full justify-between px-3 text-left font-normal"
                                  disabled={displayedAgents.length <= 1}
                                >
                                  <span
                                    className={cn(
                                      "min-w-0 truncate",
                                      agentDraft.allowedAgentNames.length ===
                                        0 && "text-muted-foreground",
                                    )}
                                  >
                                    {agentDraft.allowedAgentNames.length > 0
                                      ? `${agentDraft.allowedAgentNames.length} allowed agent${agentDraft.allowedAgentNames.length === 1 ? "" : "s"}`
                                      : displayedAgents.length > 1
                                        ? "Select allowed agents"
                                        : "No other agents are available"}
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
                                      value={agentSearch}
                                      onChange={(event) =>
                                        setAgentSearch(event.target.value)
                                      }
                                      placeholder="Search agents..."
                                      className="h-9"
                                    />
                                  </div>
                                  <div
                                    className="max-h-80 overflow-y-auto overscroll-contain p-1 chat-message-scrollbar"
                                    onWheelCapture={(event) =>
                                      event.stopPropagation()
                                    }
                                  >
                                    {visibleAgents.length > 0 ? (
                                      visibleAgents.map((agent) => {
                                        const checked =
                                          agentDraft.allowedAgentNames.includes(
                                            agent.name,
                                          );
                                        return (
                                          <div
                                            key={agent.name}
                                            role="button"
                                            tabIndex={0}
                                            className="flex w-full min-w-0 cursor-pointer items-start gap-2 px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground focus-visible:outline-none"
                                            onClick={() =>
                                              toggleAllowedAgent(agent.name)
                                            }
                                            onKeyDown={(event) => {
                                              if (
                                                event.key === "Enter" ||
                                                event.key === " "
                                              ) {
                                                event.preventDefault();
                                                toggleAllowedAgent(agent.name);
                                              }
                                            }}
                                            title={agent.description}
                                          >
                                            <Checkbox
                                              checked={checked}
                                              tabIndex={-1}
                                              className="mt-1 shrink-0 pointer-events-none"
                                            />
                                            <span className="min-w-0 flex-1">
                                              <span className="block truncate font-medium">
                                                {agent.name}
                                              </span>
                                              {agent.description && (
                                                <span className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                                                  {agent.description}
                                                </span>
                                              )}
                                            </span>
                                          </div>
                                        );
                                      })
                                    ) : (
                                      <div className="px-3 py-6 text-center text-base text-muted-foreground">
                                        No agents found.
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>

                            {agentDraft.allowedAgentNames.length > 0 && (
                              <div className="grid max-h-56 gap-1 overflow-y-auto border bg-muted/10 p-2">
                                {agentDraft.allowedAgentNames.map(
                                  (agentName) => {
                                    const agent = agentsByName.get(agentName);
                                    return (
                                      <div
                                        key={agentName}
                                        className="flex min-w-0 items-start gap-2 px-2 py-1.5 hover:bg-muted/70"
                                        title={agent?.description}
                                      >
                                        <Bot className="mt-1 size-4 shrink-0 text-muted-foreground" />
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate font-medium">
                                            {agentName}
                                          </span>
                                          {agent?.description && (
                                            <span className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                                              {agent.description}
                                            </span>
                                          )}
                                        </span>
                                        <Checkbox
                                          checked
                                          onCheckedChange={() =>
                                            toggleAllowedAgent(agentName)
                                          }
                                          className="mt-1 shrink-0"
                                        />
                                      </div>
                                    );
                                  },
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <DialogFooter className="shrink-0 border-t bg-background px-5 py-4">
                    {selectedAgentIsBuiltIn ? (
                      <div className="w-full text-sm leading-5 text-muted-foreground">
                        Built-in agents are read-only. They are always available
                        when agents are enabled and mirror the current chat's
                        effective tools and skills.
                      </div>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            if (selectedAgent)
                              setAgentDraft(agentToDraft(selectedAgent));
                            else setAgentDraft(createBlankAgentDraft());
                          }}
                          disabled={!hasAgentDraftChanges || isSavingAgent}
                        >
                          Reset
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void saveCurrentAgentDraft()}
                          disabled={!hasAgentDraftChanges || isSavingAgent}
                        >
                          {isSavingAgent ? "Saving..." : "Save"}
                        </Button>
                      </>
                    )}
                  </DialogFooter>
                </>
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-muted-foreground">
                  <div className="grid max-w-sm gap-2">
                    <Sparkles className="mx-auto size-8 opacity-50" />
                    <div className="text-lg font-medium text-foreground">
                      No agent selected
                    </div>
                    <p className="text-base leading-6">
                      Create an agent or select one from the list to edit its
                      instructions.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {agentDraft ? (
        <Dialog
          open={instructionsEditorOpen}
          onOpenChange={setInstructionsEditorOpen}
        >
          <DialogContent className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-4 p-5 sm:max-w-6xl">
            <DialogHeader className="pr-8">
              <DialogTitle>Edit instructions</DialogTitle>
              <DialogDescription>
                Edit the selected agent instructions in a larger focused editor.
              </DialogDescription>
            </DialogHeader>

            <Textarea
              value={agentDraft.instructions}
              onChange={(event) =>
                updateAgentDraft({ instructions: event.target.value })
              }
              placeholder="Agent system prompt / instructions."
              disabled={selectedAgentIsBuiltIn}
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
