import { BookOpen, FolderOpen, RefreshCw, Sparkles } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { memo, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GroupHeading } from "@/components/ui/group-heading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { labelForError } from "@/lib/ai-chat/chat-utils";
import { loadSkills, openSkillsFolder } from "@/lib/ai-chat/storage";
import type {
  ChatWorkspaceRoot,
  FeaturePermission,
  LoadedSkillInfo,
  LoadedToolInfo,
  Permission,
  SkillsSettings,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

type SkillsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillsSettings: SkillsSettings;
  onSkillsSettingsChange: Dispatch<SetStateAction<SkillsSettings>>;
  loadedSkills: LoadedSkillInfo[];
  onLoadedSkillsChange: Dispatch<SetStateAction<LoadedSkillInfo[]>>;
  availableTools: LoadedToolInfo[];
  workspaceRoots?: ChatWorkspaceRoot[];
  showSuccess: (message: string, description?: string) => void;
  showError: (message: string, description?: string) => void;
};

function formatSkillLocation(skill: LoadedSkillInfo) {
  return skill.manifestPath || skill.directoryPath || "Unknown location";
}

function getSkillSelectionKey(skill: LoadedSkillInfo) {
  return `${skill.name}:${skill.manifestPath ?? skill.directoryPath ?? ""}`;
}

function getSkillsMasterPermission(
  settings: SkillsSettings,
): FeaturePermission {
  return settings.skillsPermission ?? "custom";
}

function getSkillPermission(
  settings: SkillsSettings,
  skillName: string,
): Permission {
  return (
    settings.skillPermissions?.[skillName] ??
    (settings.enabled === false ? "deny" : "ask")
  );
}

function getDisplayedSkillPermission(
  settings: SkillsSettings,
  skillName: string,
): Permission {
  const masterPermission = getSkillsMasterPermission(settings);
  return masterPermission === "custom"
    ? getSkillPermission(settings, skillName)
    : masterPermission;
}

function setSkillPermission(
  onChange: Dispatch<SetStateAction<SkillsSettings>>,
  skillName: string,
  permission: Permission,
) {
  onChange((current) => ({
    ...current,
    enabled: true,
    permissionModelVersion: 2,
    skillPermissions: {
      ...(current.skillPermissions ?? {}),
      [skillName]: permission,
    },
  }));
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

export const SkillsDialog = memo(function SkillsDialog({
  open,
  onOpenChange,
  skillsSettings,
  onSkillsSettingsChange,
  loadedSkills,
  onLoadedSkillsChange,
  workspaceRoots = [],
  showSuccess,
  showError,
}: SkillsDialogProps) {
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);

  const selectedSkill = useMemo(
    () =>
      loadedSkills.find(
        (skill) => getSkillSelectionKey(skill) === selectedSkillKey,
      ) ?? null,
    [loadedSkills, selectedSkillKey],
  );

  const groupedSkills = useMemo(() => {
    const global = loadedSkills.filter(
      (skill) => skill.sourceKind !== "workspace",
    );
    const workspace = loadedSkills.filter(
      (skill) => skill.sourceKind === "workspace",
    );
    return [
      { title: "Global", skills: global },
      { title: "Workspace", skills: workspace },
    ].filter((group) => group.skills.length > 0);
  }, [loadedSkills]);
  const skillsMasterPermission = getSkillsMasterPermission(skillsSettings);
  const childPermissionsLocked = skillsMasterPermission !== "custom";

  useEffect(() => {
    if (
      !selectedSkillKey ||
      !loadedSkills.some(
        (skill) => getSkillSelectionKey(skill) === selectedSkillKey,
      )
    ) {
      setSelectedSkillKey(
        loadedSkills[0] ? getSkillSelectionKey(loadedSkills[0]) : null,
      );
    }
  }, [loadedSkills, selectedSkillKey]);

  async function reloadSkillList() {
    setIsReloading(true);
    try {
      const skills = await loadSkills(workspaceRoots);
      onLoadedSkillsChange(skills);
      showSuccess(
        "Skills reloaded",
        `${skills.length} skill${skills.length === 1 ? "" : "s"} discovered.`,
      );
    } catch (error) {
      showError("Failed to reload skills", labelForError(error));
    } finally {
      setIsReloading(false);
    }
  }

  async function openGlobalSkillsFolder() {
    try {
      await openSkillsFolder();
    } catch (error) {
      showError("Failed to open skills folder", labelForError(error));
    }
  }

  async function openSelectedSkillFolder() {
    if (!selectedSkill?.directoryPath) return;
    const bridge = window.chatForgeWorkspace;
    if (!bridge) {
      showError("Workspace bridge is unavailable.");
      return;
    }

    try {
      await bridge.openFolder(selectedSkill.directoryPath);
    } catch (error) {
      showError("Failed to open skill folder", labelForError(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>Skills</DialogTitle>
          <DialogDescription>
            Readonly skills discovered from your global ~/.agents/skills folder
            and the current workspace .agents/skills folder.
          </DialogDescription>
        </DialogHeader>

        <div className="grid h-full min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[400px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b bg-card/70 p-3 md:border-b-0 md:border-r">
            <div className="grid gap-3">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 flex-1"
                  onClick={() => void reloadSkillList()}
                  disabled={isReloading}
                >
                  <RefreshCw className="mr-2 size-4" />
                  {isReloading ? "Reloading..." : "Reload"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => void openGlobalSkillsFolder()}
                  title="Open global skills folder"
                >
                  <FolderOpen className="size-4" />
                </Button>
              </div>
              <div className="flex items-start justify-between gap-3 border bg-background px-3 py-2 text-base">
                <span className="min-w-0">
                  <span className="block font-medium">Skills</span>
                  <span className="block text-sm leading-5 text-muted-foreground">
                    Master permission for the whole skills feature. Modes can
                    override it.
                  </span>
                </span>
                <MasterPermissionSelect
                  value={skillsMasterPermission}
                  onChange={(permission) =>
                    onSkillsSettingsChange((current) => ({
                      ...current,
                      enabled: permission !== "deny",
                      skillsPermission: permission,
                      permissionModelVersion: 2,
                    }))
                  }
                />
              </div>
            </div>

            <div className="mt-3 grid gap-3">
              {loadedSkills.length > 0 ? (
                groupedSkills.map((group) => (
                  <div key={group.title} className="mb-3">
                    <GroupHeading className="mb-1 mt-0 px-2 pb-1 pt-2">
                      {group.title}
                    </GroupHeading>
                    {group.skills.map((skill) => {
                      const selected =
                        getSkillSelectionKey(skill) === selectedSkillKey;
                      return (
                        <div
                          key={`${skill.name}:${skill.manifestPath ?? ""}`}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            "mb-1 flex w-full cursor-pointer items-start gap-2 border px-2 py-2 text-left text-sm outline-none",
                            selected
                              ? "border-primary/30 bg-accent text-accent-foreground"
                              : "border-transparent hover:border-border hover:bg-muted/60",
                            skill.shadowed && "opacity-60",
                          )}
                          onClick={() =>
                            setSelectedSkillKey(getSkillSelectionKey(skill))
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedSkillKey(getSkillSelectionKey(skill));
                            }
                          }}
                          title={formatSkillLocation(skill)}
                        >
                          <BookOpen className="mt-1 size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-base leading-6">
                              {skill.name}
                            </div>
                            <div className="line-clamp-2 text-sm leading-5 text-muted-foreground">
                              {skill.description || "No description."}
                            </div>
                            {skill.shadowed ? (
                              <div className="mt-1 text-xs leading-4 text-muted-foreground">
                                Overridden by workspace skill with the same name
                              </div>
                            ) : null}
                          </div>
                          <PermissionSelect
                            value={getDisplayedSkillPermission(
                              skillsSettings,
                              skill.name,
                            )}
                            disabled={skill.shadowed || childPermissionsLocked}
                            onChange={(permission) =>
                              setSkillPermission(
                                onSkillsSettingsChange,
                                skill.name,
                                permission,
                              )
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                ))
              ) : (
                <div className="grid gap-2 px-3 py-8 text-center text-sm text-muted-foreground">
                  <Sparkles className="mx-auto size-7 opacity-50" />
                  <p>No skills discovered.</p>
                </div>
              )}
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {selectedSkill ? (
              <>
                <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold">
                      {selectedSkill.name}
                    </h3>
                    <p className="mt-1 break-all text-sm text-muted-foreground">
                      {formatSkillLocation(selectedSkill)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void openSelectedSkillFolder()}
                    disabled={!selectedSkill.directoryPath}
                  >
                    <FolderOpen className="mr-2 size-4" />
                    Open folder
                  </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-5 chat-message-scrollbar">
                  <pre className="chat-markdown-compact chat-tool-info-codeblock min-h-full overflow-auto whitespace-pre-wrap break-words text-sm leading-6">
                    <code>
                      {selectedSkill.manifestContent ??
                        selectedSkill.instructions}
                    </code>
                  </pre>
                </div>
              </>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-muted-foreground">
                <div className="grid max-w-sm gap-2">
                  <Sparkles className="mx-auto size-8 opacity-50" />
                  <div className="text-lg font-medium text-foreground">
                    No skill selected
                  </div>
                  <p className="text-base leading-6">
                    Add a folder containing SKILL.md under ~/.agents/skills or
                    the current workspace .agents/skills folder.
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
});
