import {
  BookOpen,
  ChevronDown,
  Copy,
  Download,
  FolderOpen,
  Maximize2,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
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
import { createId, labelForError } from "@/lib/ai-chat/chat-utils";
import {
  deleteSkill as deleteStoredSkill,
  exportSkill,
  exportSkills,
  importSkills,
  loadSkills,
  openSkillsFolder,
  saveSkill,
} from "@/lib/ai-chat/storage";
import type {
  LoadedSkillInfo,
  LoadedToolInfo,
  SkillImportResult,
  SkillsSettings,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

type SkillDraft = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  instructions: string;
  recommendedToolNames: string[];
};

type SkillsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillsSettings: SkillsSettings;
  onSkillsSettingsChange: Dispatch<SetStateAction<SkillsSettings>>;
  loadedSkills: LoadedSkillInfo[];
  onLoadedSkillsChange: Dispatch<SetStateAction<LoadedSkillInfo[]>>;
  availableTools: LoadedToolInfo[];
  showSuccess: (message: string, description?: string) => void;
  showError: (message: string, description?: string) => void;
};

function createBlankSkillDraft(): SkillDraft {
  return {
    id: createId(),
    name: "",
    enabled: true,
    description: "",
    instructions: "",
    recommendedToolNames: [],
  };
}

function skillToDraft(skill: LoadedSkillInfo): SkillDraft {
  return {
    id: skill.id,
    name: skill.name,
    enabled: skill.enabled,
    description: skill.description,
    instructions: skill.instructions,
    recommendedToolNames: skill.recommendedToolNames ?? [],
  };
}

function draftToSkill(draft: SkillDraft): LoadedSkillInfo {
  return {
    id: draft.id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    description: draft.description.trim(),
    instructions: draft.instructions.trim(),
    recommendedToolNames: [
      ...new Set(
        draft.recommendedToolNames.map((name) => name.trim()).filter(Boolean),
      ),
    ],
  };
}

function validateSkillDraft(skill: LoadedSkillInfo) {
  if (!skill.name) throw new Error("Skill name is required.");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(skill.name)) {
    throw new Error(
      "Skill name must use only letters, numbers, underscores, or hyphens.",
    );
  }
  if (skill.name === "load_skill") {
    throw new Error(
      "load_skill is a built-in tool name and cannot be used by a skill.",
    );
  }
  if (!skill.description) throw new Error("Skill description is required.");
  if (!skill.instructions) throw new Error("Skill instructions are required.");
}

function areSkillDraftsEqual(left: SkillDraft, right: SkillDraft) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.enabled === right.enabled &&
    left.description === right.description &&
    left.instructions === right.instructions &&
    JSON.stringify([...left.recommendedToolNames].sort()) ===
      JSON.stringify([...right.recommendedToolNames].sort())
  );
}

function formatSkillImportSummary(result: SkillImportResult) {
  return [
    `${result.imported} imported`,
    `${result.updated} updated`,
    `${result.renamed.length} renamed`,
    `${result.skipped.length} skipped`,
    `${result.invalid.length} invalid`,
  ].join(" · ");
}

function createUniqueSkillCloneName(
  baseName: string,
  skills: LoadedSkillInfo[],
) {
  const existingNames = new Set(skills.map((skill) => skill.name));
  const normalizedBase = baseName.trim() || "skill";

  for (let index = 1; index < 1000; index += 1) {
    const suffix = `_${index}`;
    const candidate = `${normalizedBase.slice(0, 64 - suffix.length)}${suffix}`;
    if (!existingNames.has(candidate)) return candidate;
  }

  return `${normalizedBase.slice(0, 55)}_${createId().slice(0, 8)}`;
}

export const SkillsDialog = memo(function SkillsDialog({
  open,
  onOpenChange,
  skillsSettings,
  onSkillsSettingsChange,
  loadedSkills,
  onLoadedSkillsChange,
  availableTools,
  showSuccess,
  showError,
}: SkillsDialogProps) {
  const [skillLoadErrors, setSkillLoadErrors] = useState<
    Array<{ source: string; message: string }>
  >([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [isSavingSkill, setIsSavingSkill] = useState(false);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(
    null,
  );
  const [skillDraft, setSkillDraft] = useState<SkillDraft | null>(null);
  const [recommendedToolSearch, setRecommendedToolSearch] = useState("");
  const [instructionsEditorOpen, setInstructionsEditorOpen] = useState(false);

  const selectedSkill = useMemo(
    () =>
      loadedSkills.find((skill) => skill.name === selectedSkillName) ?? null,
    [loadedSkills, selectedSkillName],
  );
  const enabledSkillsCount = loadedSkills.filter(
    (skill) => skill.enabled,
  ).length;

  useEffect(() => {
    const isEditingUnsavedSkill =
      skillDraft &&
      !selectedSkillName &&
      !loadedSkills.some((skill) => skill.id === skillDraft.id);

    if (isEditingUnsavedSkill) return;

    if (
      !selectedSkillName ||
      !loadedSkills.some((skill) => skill.name === selectedSkillName)
    ) {
      setSelectedSkillName(loadedSkills[0]?.name ?? null);
    }
  }, [loadedSkills, selectedSkillName, skillDraft]);

  useEffect(() => {
    const selected = loadedSkills.find(
      (skill) => skill.name === selectedSkillName,
    );
    if (selected) {
      setSkillDraft(skillToDraft(selected));
    } else if (selectedSkillName) {
      setSkillDraft(null);
    }
  }, [loadedSkills, selectedSkillName]);

  function updateSkillDraft(patch: Partial<SkillDraft>) {
    setSkillDraft((current) => (current ? { ...current, ...patch } : current));
  }

  const hasSkillDraftChanges = useMemo(() => {
    if (!skillDraft) return false;
    const originalDraft = selectedSkill
      ? skillToDraft(selectedSkill)
      : { ...createBlankSkillDraft(), id: skillDraft.id };
    return !areSkillDraftsEqual(skillDraft, originalDraft);
  }, [selectedSkill, skillDraft]);

  async function refreshSkills(showToast = false) {
    setIsLoadingSkills(true);

    try {
      const skills = await loadSkills();
      onLoadedSkillsChange(skills);
      setSkillLoadErrors([]);
      if (showToast) {
        showSuccess(
          `Loaded ${skills.length} skill${skills.length === 1 ? "" : "s"}.`,
        );
      }
    } catch (error) {
      console.error("Failed to load skills:", error);
      setSkillLoadErrors([
        { source: "Skills storage", message: labelForError(error) },
      ]);
      showError("Failed to load skills", labelForError(error));
    } finally {
      setIsLoadingSkills(false);
    }
  }

  async function saveCurrentSkillDraft() {
    if (!skillDraft) return;
    setIsSavingSkill(true);

    try {
      const skill = draftToSkill(skillDraft);
      validateSkillDraft(skill);
      const savedSkill = await saveSkill(skill);
      onLoadedSkillsChange((current) => {
        const next = current.filter((item) => item.id !== savedSkill.id);
        next.push(savedSkill);
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      setSelectedSkillName(savedSkill.name);
      setSkillDraft(skillToDraft(savedSkill));
      showSuccess("Skill saved");
    } catch (error) {
      showError("Failed to save skill", labelForError(error));
    } finally {
      setIsSavingSkill(false);
    }
  }

  async function deleteCurrentSkill() {
    if (!skillDraft) return;

    try {
      await deleteStoredSkill(skillDraft.id);
      onLoadedSkillsChange((current) =>
        current.filter((skill) => skill.id !== skillDraft.id),
      );
      setSkillDraft(null);
      setSelectedSkillName(null);
      showSuccess("Skill deleted");
    } catch (error) {
      showError("Failed to delete skill", labelForError(error));
    }
  }

  async function importSkillFiles() {
    setIsLoadingSkills(true);

    try {
      const result = await importSkills();
      if (result.cancelled) return;

      const skills = await loadSkills();
      onLoadedSkillsChange(skills);
      setSkillLoadErrors([...result.invalid, ...result.skipped]);

      const summary = formatSkillImportSummary(result);
      if (result.imported + result.updated > 0)
        showSuccess("Skills import completed", summary);
      else showError("No skills imported", summary);
    } catch (error) {
      showError("Failed to import skills", labelForError(error));
    } finally {
      setIsLoadingSkills(false);
    }
  }

  async function exportAllSkills() {
    if (loadedSkills.length === 0) {
      showError("No skills to export");
      return;
    }

    try {
      const result = await exportSkills(loadedSkills);
      if (result.cancelled) return;
      showSuccess(
        `Exported ${result.exported} skill${result.exported === 1 ? "" : "s"}.`,
        result.path,
      );
    } catch (error) {
      showError("Failed to export skills", labelForError(error));
    }
  }

  async function exportCurrentSkill() {
    if (!skillDraft) return;

    try {
      const skill = draftToSkill(skillDraft);
      validateSkillDraft(skill);
      const result = await exportSkill(skill);
      if (result.cancelled) return;
      showSuccess("Skill exported", result.path);
    } catch (error) {
      showError("Failed to export skill", labelForError(error));
    }
  }

  async function cloneCurrentSkill() {
    if (!skillDraft) return;

    try {
      const clonedDraft = {
        ...skillDraft,
        id: createId(),
        name: createUniqueSkillCloneName(skillDraft.name, loadedSkills),
      };
      const clonedSkill = draftToSkill(clonedDraft);
      validateSkillDraft(clonedSkill);
      const savedSkill = await saveSkill(clonedSkill);
      onLoadedSkillsChange((current) => {
        const next = current.filter((item) => item.id !== savedSkill.id);
        next.push(savedSkill);
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      setSelectedSkillName(savedSkill.name);
      setSkillDraft(skillToDraft(savedSkill));
      showSuccess("Skill cloned", savedSkill.name);
    } catch (error) {
      showError("Failed to clone skill", labelForError(error));
    }
  }

  async function openSkillStorageFolder() {
    try {
      await openSkillsFolder();
    } catch (error) {
      showError("Failed to open skills folder", labelForError(error));
    }
  }

  function toggleRecommendedTool(toolName: string) {
    if (!skillDraft) return;
    const selectedNames = new Set<string>(skillDraft.recommendedToolNames);
    if (selectedNames.has(toolName)) selectedNames.delete(toolName);
    else selectedNames.add(toolName);
    updateSkillDraft({ recommendedToolNames: [...selectedNames] });
  }

  const recommendedToolSearchText = recommendedToolSearch.trim().toLowerCase();
  const visibleRecommendedTools = recommendedToolSearchText
    ? availableTools.filter((tool) =>
        `${tool.name} ${tool.description}`
          .toLowerCase()
          .includes(recommendedToolSearchText),
      )
    : availableTools;
  const recommendedToolsByName = new Map(
    availableTools.map((tool) => [tool.name, tool] as const),
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle>Skills</DialogTitle>
            <DialogDescription>
              Define reusable instruction packages, enable or disable them
              globally, and attach recommended tools.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b bg-card/70 p-3 md:border-b-0 md:border-r">
              <div className="mb-3 flex items-center justify-between gap-2">
                <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Skills
                </Label>
                <span className="text-sm text-muted-foreground">
                  {enabledSkillsCount}/{loadedSkills.length} enabled
                </span>
              </div>

              <div
                role="button"
                tabIndex={0}
                className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() =>
                  onSkillsSettingsChange((current) => ({
                    ...current,
                    enabled: !current.enabled,
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSkillsSettingsChange((current) => ({
                      ...current,
                      enabled: !current.enabled,
                    }));
                  }
                }}
              >
                <span className="min-w-0">
                  <span className="block font-medium">
                    Enable skills globally
                  </span>
                  <span className="block select-none text-sm leading-5 text-muted-foreground">
                    Disabled globally hides skills from model auto-loading by
                    default.
                  </span>
                </span>
                <Switch
                  checked={skillsSettings.enabled}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={(checked) =>
                    onSkillsSettingsChange((current) => ({
                      ...current,
                      enabled: checked,
                    }))
                  }
                  className="shrink-0 cursor-pointer"
                />
              </div>

              <div className="mb-3 flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="flex-1 rounded-lg"
                  onClick={() => {
                    const draft = createBlankSkillDraft();
                    setSelectedSkillName(null);
                    setSkillDraft(draft);
                  }}
                >
                  <Plus className="size-4" />
                  Add skill
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="rounded-lg"
                      title="Skill actions"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem
                      disabled={isLoadingSkills}
                      onSelect={() => void importSkillFiles()}
                    >
                      <Download className="size-4" />
                      Import skills...
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void exportAllSkills()}>
                      <Upload className="size-4" />
                      Export all skills...
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => void openSkillStorageFolder()}
                    >
                      <FolderOpen className="size-4" />
                      Open skills folder
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={isLoadingSkills}
                      onSelect={() => void refreshSkills(true)}
                    >
                      <RefreshCcw
                        className={cn(
                          "size-4",
                          isLoadingSkills && "animate-spin",
                        )}
                      />
                      Reload from app storage
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="grid gap-1.5">
                {loadedSkills.map((skill) => (
                  <div
                    key={skill.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "group flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selectedSkill?.id === skill.id
                        ? "border-primary/30 bg-accent text-accent-foreground"
                        : "border-transparent hover:border-border hover:bg-muted/60",
                    )}
                    onClick={() => setSelectedSkillName(skill.name)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedSkillName(skill.name);
                      }
                    }}
                  >
                    <BookOpen className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base leading-6">
                        {skill.name}
                      </div>
                    </div>
                    <Switch
                      checked={skill.enabled}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={async (checked) => {
                        const updated = { ...skill, enabled: checked };
                        try {
                          const saved = await saveSkill(updated);
                          onLoadedSkillsChange((current) =>
                            current.map((item) =>
                              item.id === saved.id ? saved : item,
                            ),
                          );
                          if (skillDraft?.id === saved.id)
                            setSkillDraft(skillToDraft(saved));
                        } catch (error) {
                          showError(
                            "Failed to update skill",
                            labelForError(error),
                          );
                        }
                      }}
                      className="mt-0.5 shrink-0 cursor-pointer"
                      title={
                        skill.enabled
                          ? "Disable skill globally"
                          : "Enable skill globally"
                      }
                    />
                  </div>
                ))}

                {loadedSkills.length === 0 && (
                  <div className="rounded-lg border border-dashed px-3 py-4 text-center text-base text-muted-foreground">
                    No skills configured.
                  </div>
                )}
              </div>

              {skillLoadErrors.length > 0 && (
                <div className="mt-4 grid gap-2">
                  <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    Skill file issues
                  </Label>
                  {skillLoadErrors.map((error) => (
                    <div
                      key={`${error.source}:${error.message}`}
                      className="rounded-lg border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-sm leading-5"
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
              {skillDraft ? (
                <>
                  <div className="z-20 flex min-h-[4.25rem] shrink-0 items-center border-b bg-background px-5 py-3">
                    <div className="flex w-full items-center justify-between gap-4">
                      <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                        {selectedSkill ? "Edit skill" : "New skill"}
                      </Label>
                      {selectedSkill && skillDraft && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="rounded-lg"
                              title="Skill options"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onSelect={() => void cloneCurrentSkill()}
                            >
                              <Copy className="size-4" />
                              Clone
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void exportCurrentSkill()}
                            >
                              <Upload className="size-4" />
                              Export
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => void deleteCurrentSkill()}
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
                        <Label htmlFor="skill-name">Name</Label>
                        <Input
                          id="skill-name"
                          value={skillDraft.name}
                          onChange={(event) =>
                            updateSkillDraft({ name: event.target.value })
                          }
                          placeholder="release-notes"
                          className="rounded-lg"
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="skill-description">Description</Label>
                        <Textarea
                          id="skill-description"
                          value={skillDraft.description}
                          onChange={(event) =>
                            updateSkillDraft({
                              description: event.target.value,
                            })
                          }
                          placeholder="Use when generating concise user-facing release notes from version diffs."
                          className="min-h-24 rounded-lg leading-6"
                        />
                      </div>

                      <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="skill-instructions">
                            Instructions
                          </Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 rounded-lg px-2 text-sm"
                            onClick={() => setInstructionsEditorOpen(true)}
                          >
                            <Maximize2 className="size-4" />
                            Open editor
                          </Button>
                        </div>
                        <Textarea
                          id="skill-instructions"
                          value={skillDraft.instructions}
                          onChange={(event) =>
                            updateSkillDraft({
                              instructions: event.target.value,
                            })
                          }
                          placeholder="Write the reusable instructions for this skill..."
                          className="min-h-72 rounded-lg text-sm leading-6"
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label>Recommended tools</Label>
                        <Popover
                          onOpenChange={(nextOpen) => {
                            if (!nextOpen) setRecommendedToolSearch("");
                          }}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              role="combobox"
                              className="w-full justify-between rounded-lg px-3 text-left font-normal"
                              disabled={availableTools.length === 0}
                            >
                              <span
                                className={cn(
                                  "min-w-0 truncate",
                                  skillDraft.recommendedToolNames.length ===
                                    0 && "text-muted-foreground",
                                )}
                              >
                                {skillDraft.recommendedToolNames.length > 0
                                  ? `${skillDraft.recommendedToolNames.length} recommended tool${skillDraft.recommendedToolNames.length === 1 ? "" : "s"}`
                                  : availableTools.length > 0
                                    ? "Select recommended tools"
                                    : "No tools are available"}
                              </span>
                              <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="w-[min(var(--radix-popover-trigger-width),32rem)] rounded-lg p-0"
                          >
                            <div className="grid max-h-[24rem] min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
                              <div className="border-b p-2">
                                <Input
                                  value={recommendedToolSearch}
                                  onChange={(event) =>
                                    setRecommendedToolSearch(event.target.value)
                                  }
                                  placeholder="Search tools..."
                                  className="h-9 rounded-lg"
                                />
                              </div>
                              <div
                                className="max-h-80 overflow-y-auto overscroll-contain p-1 chat-message-scrollbar"
                                onWheelCapture={(event) =>
                                  event.stopPropagation()
                                }
                              >
                                {visibleRecommendedTools.length > 0 ? (
                                  visibleRecommendedTools.map((tool) => {
                                    const checked =
                                      skillDraft.recommendedToolNames.includes(
                                        tool.name,
                                      );

                                    return (
                                      <div
                                        key={tool.name}
                                        role="button"
                                        tabIndex={0}
                                        className="flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        onClick={() =>
                                          toggleRecommendedTool(tool.name)
                                        }
                                        onKeyDown={(event) => {
                                          if (
                                            event.key === "Enter" ||
                                            event.key === " "
                                          ) {
                                            event.preventDefault();
                                            toggleRecommendedTool(tool.name);
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

                        {skillDraft.recommendedToolNames.length > 0 && (
                          <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border bg-muted/10 p-2">
                            {skillDraft.recommendedToolNames.map((toolName) => {
                              const tool = recommendedToolsByName.get(toolName);

                              return (
                                <div
                                  key={toolName}
                                  className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/70"
                                  title={tool?.description}
                                >
                                  <Checkbox
                                    checked
                                    onCheckedChange={() =>
                                      toggleRecommendedTool(toolName)
                                    }
                                    className="mt-1 shrink-0"
                                  />
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
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <DialogFooter className="shrink-0 border-t bg-background px-5 py-4">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-lg"
                      onClick={() => {
                        if (selectedSkill)
                          setSkillDraft(skillToDraft(selectedSkill));
                        else setSkillDraft(createBlankSkillDraft());
                      }}
                      disabled={!hasSkillDraftChanges || isSavingSkill}
                    >
                      Reset
                    </Button>
                    <Button
                      type="button"
                      className="rounded-lg"
                      onClick={() => void saveCurrentSkillDraft()}
                      disabled={!hasSkillDraftChanges || isSavingSkill}
                    >
                      {isSavingSkill ? "Saving..." : "Save"}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-muted-foreground">
                  <div className="grid max-w-sm gap-2">
                    <Sparkles className="mx-auto size-8 opacity-50" />
                    <div className="text-lg font-medium text-foreground">
                      No skill selected
                    </div>
                    <p className="text-base leading-6">
                      Create a skill or select one from the list to edit its
                      instructions.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {skillDraft ? (
        <Dialog
          open={instructionsEditorOpen}
          onOpenChange={setInstructionsEditorOpen}
        >
          <DialogContent className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-4 p-5 sm:max-w-6xl">
            <DialogHeader className="pr-8">
              <DialogTitle>Edit instructions</DialogTitle>
              <DialogDescription>
                Edit the selected skill instructions in a larger focused editor.
              </DialogDescription>
            </DialogHeader>

            <Textarea
              value={skillDraft.instructions}
              onChange={(event) =>
                updateSkillDraft({ instructions: event.target.value })
              }
              placeholder="Write the reusable instructions for this skill..."
              className="min-h-0 flex-1 resize-none rounded-lg text-sm leading-6"
            />

            <DialogFooter>
              <Button
                type="button"
                className="rounded-lg"
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
