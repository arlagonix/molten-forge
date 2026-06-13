import {
  BookOpen,
  Copy,
  File,
  Folder,
  FolderOpen,
  Maximize2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { labelForError } from "@/lib/ai-chat/chat-utils";
import {
  deleteSkill,
  loadSkills,
  openSkillsFolder,
  saveSkill,
} from "@/lib/ai-chat/storage";
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

type SkillDraftMode = "existing" | "new";
type CreationLocation = "global" | "workspace";

const SKILL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

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
    (settings.enabled === false ? "deny" : "allow")
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

function removeSkillPermission(
  onChange: Dispatch<SetStateAction<SkillsSettings>>,
  skillName: string,
) {
  onChange((current) => {
    const nextPermissions = { ...(current.skillPermissions ?? {}) };
    delete nextPermissions[skillName];
    return {
      ...current,
      permissionModelVersion: 2,
      skillPermissions: nextPermissions,
    };
  });
}

function moveSkillPermission(
  onChange: Dispatch<SetStateAction<SkillsSettings>>,
  previousName: string,
  nextName: string,
) {
  if (previousName === nextName) return;
  onChange((current) => {
    const nextPermissions = { ...(current.skillPermissions ?? {}) };
    const currentPermission = nextPermissions[previousName] ?? "allow";
    delete nextPermissions[previousName];
    nextPermissions[nextName] = currentPermission;
    return {
      ...current,
      enabled: true,
      permissionModelVersion: 2,
      skillPermissions: nextPermissions,
    };
  });
}

function parseSkillFrontmatterFieldValue(rawValue: string) {
  return rawValue
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1")
    .trim();
}

function parseSkillMetadataFromContent(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  const metadata = { name: "", description: "" };
  if (!match) return metadata;

  for (const line of match[1].split("\n")) {
    const keyValue = /^(name|description)\s*:\s*(.*)$/i.exec(line);
    if (!keyValue) continue;
    const key = keyValue[1].toLowerCase();
    const value = parseSkillFrontmatterFieldValue(keyValue[2]);
    if (key === "name") metadata.name = value;
    if (key === "description") metadata.description = value;
  }
  return metadata;
}

function parseSkillNameFromContent(content: string) {
  return parseSkillMetadataFromContent(content).name || undefined;
}

function createSkillTemplate(name: string) {
  return [
    "---",
    `name: ${name}`,
    "description: ",
    "---",
    "",
    "Describe when and how this skill should be used.",
  ].join("\n");
}

function validateSkillName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "Skill name is required.";
  if (!SKILL_NAME_PATTERN.test(trimmed)) {
    return "Use 1–64 letters, numbers, underscores, or hyphens.";
  }
  if (trimmed.toLowerCase() === "skill") {
    return "skill is a built-in tool name and cannot be used.";
  }
  return null;
}

function getWorkspaceSkillsRoot(workspaceRoot?: ChatWorkspaceRoot) {
  if (!workspaceRoot?.path.trim()) return undefined;
  return `${workspaceRoot.path.replace(/[\\/]+$/, "")}/.agents/skills`;
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

const SkillMetadataFields = memo(function SkillMetadataFields({
  name,
  description,
  nameValidationError,
}: {
  name: string;
  description: string;
  nameValidationError: string | null;
}) {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="skill-derived-name">Name</Label>
        <Input
          id="skill-derived-name"
          value={name}
          disabled
          aria-invalid={Boolean(nameValidationError)}
          placeholder="Defined by name in SKILL.md frontmatter"
        />
        {nameValidationError ? (
          <p className="text-sm text-destructive">{nameValidationError}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="skill-derived-description">Description</Label>
        <Textarea
          id="skill-derived-description"
          value={description}
          disabled
          placeholder="Defined by description in SKILL.md frontmatter"
          className="min-h-20 resize-none"
        />
      </div>
    </>
  );
});

const SkillLocationField = memo(function SkillLocationField({
  location,
  showOpenFolderButton,
  openFolderDisabled,
  onOpenFolder,
}: {
  location: string;
  showOpenFolderButton: boolean;
  openFolderDisabled: boolean;
  onOpenFolder: () => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="skill-location">Location</Label>
      <div className="flex min-w-0 gap-2">
        <Input
          id="skill-location"
          value={location}
          disabled
          className="min-w-0 flex-1"
        />
        {showOpenFolderButton ? (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-9 w-9 shrink-0"
            disabled={openFolderDisabled}
            onClick={onOpenFolder}
            title="Open skill folder"
          >
            <FolderOpen className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
});

const SkillFileStructurePreview = memo(function SkillFileStructurePreview({
  skill,
}: {
  skill: LoadedSkillInfo;
}) {
  return (
    <div className="grid gap-2">
      <Label>File structure</Label>
      <div className="border bg-muted/20 px-3 py-2 text-sm">
        {skill.fileTree?.length ? (
          <div className="grid gap-1">
            {skill.fileTree.map((item) => (
              <div
                key={`${item.type}:${item.name}`}
                className="flex min-w-0 items-center gap-2"
              >
                {item.type === "directory" ? (
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <File className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate font-mono text-xs">
                  {item.name}
                  {item.type === "directory" ? "/" : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground">No files found.</div>
        )}
      </div>
    </div>
  );
});

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
  const [draftMode, setDraftMode] = useState<SkillDraftMode>("existing");
  const [draftContent, setDraftContent] = useState("");
  const [savedDraftContent, setSavedDraftContent] = useState("");
  const [creationLocation, setCreationLocation] =
    useState<CreationLocation>("global");
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [isReloading, setIsReloading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [unsavedChangesDialogOpen, setUnsavedChangesDialogOpen] =
    useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [manifestEditorOpen, setManifestEditorOpen] = useState(false);
  const wasOpenRef = useRef(false);

  const workspaceRootsKey = useMemo(
    () =>
      JSON.stringify(
        workspaceRoots.map((root) => ({
          id: root.id,
          path: root.path,
          name: root.name,
          createdAt: root.createdAt,
          kind: root.kind,
          automatic: root.automatic,
        })),
      ),
    [workspaceRoots],
  );
  const stableWorkspaceRoots = useMemo(
    () => JSON.parse(workspaceRootsKey) as ChatWorkspaceRoot[],
    [workspaceRootsKey],
  );

  const workspaceRoot = stableWorkspaceRoots[0];
  const workspaceSkillsRoot = getWorkspaceSkillsRoot(workspaceRoot);
  const canUseWorkspaceSkills = Boolean(
    workspaceRoot?.path?.trim() && workspaceSkillsRoot,
  );

  const selectedSkill = useMemo(
    () =>
      loadedSkills.find(
        (skill) => getSkillSelectionKey(skill) === selectedSkillKey,
      ) ?? null,
    [loadedSkills, selectedSkillKey],
  );

  const filteredSkills = useMemo(() => {
    const query = skillSearchQuery.trim().toLowerCase();
    if (!query) return loadedSkills;
    return loadedSkills.filter((skill) => {
      return (
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query)
      );
    });
  }, [loadedSkills, skillSearchQuery]);

  const groupedSkills = useMemo(() => {
    const global = filteredSkills.filter(
      (skill) => skill.sourceKind !== "workspace",
    );
    const workspace = filteredSkills.filter(
      (skill) => skill.sourceKind === "workspace",
    );
    return [
      { title: "Global", skills: global },
      { title: "Workspace", skills: workspace },
    ].filter((group) => group.skills.length > 0);
  }, [filteredSkills]);

  const skillsMasterPermission = getSkillsMasterPermission(skillsSettings);
  const childPermissionsLocked = skillsMasterPermission !== "custom";
  const hasChanges = draftMode === "new" || draftContent !== savedDraftContent;

  const effectiveDraftMetadata = useMemo(
    () => parseSkillMetadataFromContent(draftContent),
    [draftContent],
  );
  const effectiveDraftName = effectiveDraftMetadata.name.trim();
  const effectiveDraftDescription = effectiveDraftMetadata.description;

  const effectiveDraftLocation = useMemo(() => {
    if (draftMode === "new") {
      if (creationLocation === "workspace") {
        return workspaceSkillsRoot ?? "No workspace selected";
      }
      return "Global skills folder";
    }
    return selectedSkill ? formatSkillLocation(selectedSkill) : "";
  }, [creationLocation, draftMode, selectedSkill, workspaceSkillsRoot]);

  const duplicateSkill = useMemo(() => {
    const normalized = effectiveDraftName.toLowerCase();
    if (!normalized) return undefined;
    return loadedSkills.find((skill) => {
      if (skill.name.toLowerCase() !== normalized) return false;
      if (draftMode === "new") return true;
      return getSkillSelectionKey(skill) !== selectedSkillKey;
    });
  }, [draftMode, effectiveDraftName, loadedSkills, selectedSkillKey]);

  const nameValidationError = useMemo(() => {
    const nameError = validateSkillName(effectiveDraftName);
    if (nameError) return nameError;
    if (duplicateSkill) {
      return `A skill named "${effectiveDraftName}" already exists.`;
    }
    return null;
  }, [duplicateSkill, effectiveDraftName]);

  const formValidationError = useMemo(() => {
    if (!draftContent.trim()) return "SKILL.md content is required.";
    if (
      draftMode === "new" &&
      creationLocation === "workspace" &&
      !canUseWorkspaceSkills
    ) {
      return "Workspace skill creation requires an active workspace.";
    }
    return null;
  }, [creationLocation, draftContent, draftMode, canUseWorkspaceSkills]);

  const validationError = nameValidationError ?? formValidationError;

  const resetDraftFromSkill = useCallback((skill: LoadedSkillInfo | null) => {
    const content = skill?.manifestContent ?? skill?.instructions ?? "";
    setDraftMode("existing");
    setDraftContent(content);
    setSavedDraftContent(content);
  }, []);

  useEffect(() => {
    if (draftMode !== "existing") return;
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
  }, [draftMode, loadedSkills, selectedSkillKey]);

  useEffect(() => {
    if (draftMode !== "existing") return;
    resetDraftFromSkill(selectedSkill);
  }, [draftMode, resetDraftFromSkill, selectedSkill]);

  const reloadSkillList = useCallback(async () => {
    setIsReloading(true);
    try {
      const skills = await loadSkills(stableWorkspaceRoots);
      onLoadedSkillsChange(skills);
    } catch (error) {
      showError("Failed to reload skills", labelForError(error));
    } finally {
      setIsReloading(false);
    }
  }, [onLoadedSkillsChange, showError, stableWorkspaceRoots]);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      void reloadSkillList();
    }
    wasOpenRef.current = open;
  }, [open, reloadSkillList]);

  function requestWithUnsavedCheck(action: () => void) {
    if (hasChanges) {
      setPendingAction(() => action);
      setUnsavedChangesDialogOpen(true);
      return;
    }
    action();
  }

  function discardCurrentDraftChanges() {
    if (draftMode === "new") {
      const nextSkill = selectedSkill ?? loadedSkills[0] ?? null;
      setDraftMode("existing");
      setSelectedSkillKey(nextSkill ? getSkillSelectionKey(nextSkill) : null);
      resetDraftFromSkill(nextSkill);
      return;
    }

    resetDraftFromSkill(selectedSkill);
  }

  function requestClose(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    requestWithUnsavedCheck(() => onOpenChange(false));
  }

  function confirmDiscardUnsavedChanges() {
    const action = pendingAction;
    setPendingAction(null);
    setUnsavedChangesDialogOpen(false);
    discardCurrentDraftChanges();
    if (action) action();
  }

  function requestSelectSkill(skill: LoadedSkillInfo) {
    requestWithUnsavedCheck(() => {
      setDraftMode("existing");
      setSelectedSkillKey(getSkillSelectionKey(skill));
    });
  }

  function requestCreateSkill() {
    requestWithUnsavedCheck(() => {
      const initialName = "new-skill";
      setDraftMode("new");
      setSelectedSkillKey(null);
      setCreationLocation("global");
      const content = createSkillTemplate(initialName);
      setDraftContent(content);
      setSavedDraftContent("");
    });
  }

  function requestReloadSkillList() {
    requestWithUnsavedCheck(() => void reloadSkillList());
  }

  const openGlobalSkillsFolder = useCallback(async () => {
    try {
      await openSkillsFolder();
    } catch (error) {
      showError("Failed to open skills folder", labelForError(error));
    }
  }, [showError]);

  const openSelectedSkillFolder = useCallback(() => {
    if (!selectedSkill?.directoryPath) return;
    const bridge = window.chatForgeWorkspace;
    if (!bridge) {
      showError("Workspace bridge is unavailable.");
      return;
    }

    void bridge.openFolder(selectedSkill.directoryPath).catch((error) => {
      showError("Failed to open skill folder", labelForError(error));
    });
  }, [selectedSkill?.directoryPath, showError]);

  function resetCurrentDraft() {
    discardCurrentDraftChanges();
  }

  async function saveCurrentDraft() {
    if (validationError || isSaving) return;
    setIsSaving(true);
    try {
      const sourceKind =
        draftMode === "new"
          ? creationLocation
          : (selectedSkill?.sourceKind ?? "global");
      const sourcePath =
        draftMode === "new"
          ? creationLocation === "workspace"
            ? workspaceSkillsRoot
            : undefined
          : selectedSkill?.sourcePath;
      const previousName = selectedSkill?.name;
      const saved = await saveSkill(
        {
          ...(selectedSkill ?? {
            enabled: true,
            description: "",
            instructions: "",
            recommendedToolNames: [],
          }),
          name: effectiveDraftName,
          manifestContent: draftContent,
          directoryPath:
            draftMode === "new" ? undefined : selectedSkill?.directoryPath,
          manifestPath:
            draftMode === "new" ? undefined : selectedSkill?.manifestPath,
          sourceKind,
          sourcePath,
          workspaceRoots: stableWorkspaceRoots,
        },
        previousName,
      );

      if (draftMode === "new") {
        setSkillPermission(onSkillsSettingsChange, saved.name, "allow");
      } else if (previousName && previousName !== saved.name) {
        moveSkillPermission(onSkillsSettingsChange, previousName, saved.name);
      }

      const skills = await loadSkills(stableWorkspaceRoots);
      const savedFromList =
        skills.find(
          (skill) =>
            skill.name === saved.name &&
            (skill.manifestPath === saved.manifestPath ||
              skill.directoryPath === saved.directoryPath),
        ) ?? saved;
      onLoadedSkillsChange(
        skills.some(
          (skill) =>
            getSkillSelectionKey(skill) === getSkillSelectionKey(savedFromList),
        )
          ? skills
          : [...skills, savedFromList],
      );
      setDraftMode("existing");
      setSelectedSkillKey(getSkillSelectionKey(savedFromList));
      setDraftContent(savedFromList.manifestContent ?? draftContent);
      setSavedDraftContent(savedFromList.manifestContent ?? draftContent);
      showSuccess(
        draftMode === "new" ? "Skill created" : "Skill saved",
        saved.name,
      );
    } catch (error) {
      showError(
        draftMode === "new" ? "Failed to create skill" : "Failed to save skill",
        labelForError(error),
      );
    } finally {
      setIsSaving(false);
    }
  }

  function requestDeleteCurrentSkill() {
    if (!selectedSkill) return;
    requestWithUnsavedCheck(() => setDeleteDialogOpen(true));
  }

  async function confirmDeleteSkill() {
    if (!selectedSkill) return;
    setIsSaving(true);
    try {
      const deletedName = selectedSkill.name;
      await deleteSkill(selectedSkill);
      removeSkillPermission(onSkillsSettingsChange, deletedName);
      const skills = await loadSkills(stableWorkspaceRoots);
      onLoadedSkillsChange(skills);
      setDeleteDialogOpen(false);
      const nextSkill =
        skills.find(
          (skill) =>
            getSkillSelectionKey(skill) !== getSkillSelectionKey(selectedSkill),
        ) ??
        skills[0] ??
        null;
      setSelectedSkillKey(nextSkill ? getSkillSelectionKey(nextSkill) : null);
      setDraftMode("existing");
      resetDraftFromSkill(nextSkill);
      showSuccess("Skill deleted", deletedName);
    } catch (error) {
      showError("Failed to delete skill", labelForError(error));
    } finally {
      setIsSaving(false);
    }
  }

  function requestCloneCurrentSkill() {
    if (!selectedSkill) return;
    requestWithUnsavedCheck(() => {
      const clonedContent =
        selectedSkill.manifestContent ||
        createSkillTemplate(`${selectedSkill.name}-copy`);
      setDraftMode("new");
      setSelectedSkillKey(null);
      setCreationLocation(
        selectedSkill.sourceKind === "workspace" && canUseWorkspaceSkills
          ? "workspace"
          : "global",
      );
      setDraftContent(clonedContent);
      setSavedDraftContent("");
    });
  }

  async function moveCurrentSkill() {
    if (!selectedSkill || !canUseWorkspaceSkills || isSaving) return;
    const targetSourceKind: CreationLocation =
      selectedSkill.sourceKind === "workspace" ? "global" : "workspace";
    const targetSourcePath =
      targetSourceKind === "workspace" ? workspaceSkillsRoot : undefined;

    setIsSaving(true);
    try {
      const saved = await saveSkill(
        {
          ...selectedSkill,
          sourceKind: targetSourceKind,
          sourcePath: targetSourcePath,
          workspaceRoots: stableWorkspaceRoots,
        },
        selectedSkill.name,
      );
      const skills = await loadSkills(stableWorkspaceRoots);
      const savedFromList =
        skills.find(
          (skill) =>
            skill.name === saved.name &&
            (skill.manifestPath === saved.manifestPath ||
              skill.directoryPath === saved.directoryPath),
        ) ?? saved;
      onLoadedSkillsChange(
        skills.some(
          (skill) =>
            getSkillSelectionKey(skill) === getSkillSelectionKey(savedFromList),
        )
          ? skills
          : [...skills, savedFromList],
      );
      setDraftMode("existing");
      setSelectedSkillKey(getSkillSelectionKey(savedFromList));
      setDraftContent(
        savedFromList.manifestContent ?? selectedSkill.manifestContent ?? "",
      );
      setSavedDraftContent(
        savedFromList.manifestContent ?? selectedSkill.manifestContent ?? "",
      );
      showSuccess(
        targetSourceKind === "workspace"
          ? "Skill moved to workspace"
          : "Skill made global",
        saved.name,
      );
    } catch (error) {
      showError(
        targetSourceKind === "workspace"
          ? "Failed to move skill to workspace"
          : "Failed to make skill global",
        labelForError(error),
      );
    } finally {
      setIsSaving(false);
    }
  }

  function requestMoveCurrentSkill() {
    if (!selectedSkill) return;
    requestWithUnsavedCheck(() => void moveCurrentSkill());
  }

  const activeTitle =
    draftMode === "new"
      ? "New skill"
      : selectedSkill
        ? "Edit skill"
        : "No skill selected";

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent
          className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 outline-none focus:outline-none focus-visible:ring-0 sm:max-w-6xl"
          onInteractOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest?.("[data-sonner-toaster]")) {
              event.preventDefault();
            }
          }}
        >
          <DialogHeader className="shrink-0 border-b p-4 pr-12">
            <DialogTitle>Skills</DialogTitle>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[400px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-b bg-card/70 md:border-b-0 md:border-r">
              <div className="min-h-0 flex-1 overflow-y-auto p-2 pr-0 [scrollbar-gutter:stable]">
                <div className="mb-2 flex items-start justify-between gap-3 border bg-background px-2 py-2 text-base">
                  <span className="min-w-0">
                    <span className="block font-medium">Skills</span>
                    <span className="block select-none text-sm leading-5 text-muted-foreground">
                      Master permission for skill loading. Modes can override
                      it.
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

                <div className="relative mb-2">
                  <Input
                    value={skillSearchQuery}
                    onChange={(event) =>
                      setSkillSearchQuery(event.target.value)
                    }
                    placeholder="Search skills"
                    aria-label="Search skills by name or description"
                    className="pr-8"
                  />
                  {skillSearchQuery ? (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setSkillSearchQuery("")}
                      title="Clear search"
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </div>

                <div className="grid gap-1.5">
                  {filteredSkills.length > 0 ? (
                    groupedSkills.map((group) => (
                      <div key={group.title}>
                        <GroupHeading className="mb-1 mt-0 px-2 pb-1 pt-2">
                          {group.title}
                        </GroupHeading>
                        {group.skills.map((skill) => {
                          const selected =
                            draftMode === "existing" &&
                            getSkillSelectionKey(skill) === selectedSkillKey;
                          return (
                            <div
                              key={`${skill.name}:${skill.manifestPath ?? ""}`}
                              role="button"
                              tabIndex={0}
                              className={cn(
                                "group flex min-w-0 cursor-pointer select-none items-start gap-2 border px-2 py-2 outline-none transition-colors",
                                selected
                                  ? "border-primary/30 bg-accent text-accent-foreground"
                                  : "border-transparent hover:border-border hover:bg-muted/60",
                                (skill.shadowed || skill.conflict) &&
                                  "opacity-70",
                              )}
                              onClick={() => requestSelectSkill(skill)}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  requestSelectSkill(skill);
                                }
                              }}
                              title={formatSkillLocation(skill)}
                            >
                              <BookOpen className="mt-[5px] size-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-base leading-6">
                                  {skill.name}
                                </div>
                                <div className="line-clamp-2 text-sm leading-5 text-muted-foreground">
                                  {skill.conflict ||
                                    skill.description ||
                                    "No description."}
                                </div>
                                {skill.shadowed ? (
                                  <div className="mt-1 text-xs leading-4 text-muted-foreground">
                                    Overridden by workspace skill with the same
                                    name
                                  </div>
                                ) : null}
                              </div>
                              <PermissionSelect
                                value={getDisplayedSkillPermission(
                                  skillsSettings,
                                  skill.name,
                                )}
                                disabled={Boolean(
                                  skill.shadowed ||
                                  skill.conflict ||
                                  childPermissionsLocked,
                                )}
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
                    <div className="border border-dashed px-3 py-4 text-center text-base text-muted-foreground">
                      {loadedSkills.length > 0
                        ? "No skills match the search."
                        : "No skills discovered."}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 gap-2 border-t bg-card/90 p-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-[36px] flex-1"
                  onClick={requestCreateSkill}
                >
                  <Plus className="size-4" />
                  Create skill
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-[36px] w-[36px] shrink-0"
                      title="Skill options"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem
                      disabled={isReloading}
                      onSelect={requestReloadSkillList}
                    >
                      <RefreshCw
                        className={cn("size-4", isReloading && "animate-spin")}
                      />
                      Reload skills
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => void openGlobalSkillsFolder()}
                    >
                      <FolderOpen className="size-4" />
                      Open global skills folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </aside>

            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {draftMode === "new" || selectedSkill ? (
                <>
                  <div className="z-20 flex shrink-0 items-center border-b bg-background px-4 py-2">
                    <div className="flex w-full items-center justify-between gap-4">
                      <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                        {activeTitle}
                      </Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title="Skill options"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem
                            disabled={draftMode === "new" || !selectedSkill}
                            onSelect={requestCloneCurrentSkill}
                          >
                            <Copy className="size-4" />
                            Clone
                          </DropdownMenuItem>
                          {canUseWorkspaceSkills ? (
                            <DropdownMenuItem
                              disabled={
                                draftMode === "new" ||
                                !selectedSkill ||
                                isSaving
                              }
                              onSelect={requestMoveCurrentSkill}
                            >
                              <FolderOpen className="size-4" />
                              {selectedSkill?.sourceKind === "workspace"
                                ? "Make global"
                                : "Move to workspace"}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={draftMode === "new" || !selectedSkill}
                            className="text-destructive focus:text-destructive"
                            onSelect={requestDeleteCurrentSkill}
                          >
                            <Trash2 className="size-4 text-destructive" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-gutter:stable] chat-message-scrollbar">
                    <div className="grid gap-5 pb-1">
                      <div className="grid gap-4">
                        <SkillMetadataFields
                          name={effectiveDraftName}
                          description={effectiveDraftDescription}
                          nameValidationError={nameValidationError}
                        />

                        {draftMode === "new" ? (
                          <div className="grid gap-2">
                            <Label>Create in</Label>
                            <Select
                              value={creationLocation}
                              onValueChange={(value) =>
                                setCreationLocation(value as CreationLocation)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="global">Global</SelectItem>
                                <SelectItem
                                  value="workspace"
                                  disabled={!canUseWorkspaceSkills}
                                >
                                  Workspace
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}

                        {draftMode === "new" &&
                        creationLocation === "workspace" ? (
                          <div className="grid gap-2">
                            <Label>Workspace</Label>
                            <Input
                              value={
                                workspaceRoot?.name ||
                                workspaceRoot?.path ||
                                "No workspace selected"
                              }
                              disabled
                            />
                          </div>
                        ) : null}

                        <SkillLocationField
                          location={effectiveDraftLocation}
                          showOpenFolderButton={draftMode === "existing"}
                          openFolderDisabled={!selectedSkill?.directoryPath}
                          onOpenFolder={openSelectedSkillFolder}
                        />
                      </div>

                      {formValidationError ? (
                        <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                          {formValidationError}
                        </div>
                      ) : null}

                      <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="skill-manifest">SKILL.md</Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-sm"
                            onClick={() => setManifestEditorOpen(true)}
                          >
                            <Maximize2 className="size-4" />
                            Open editor
                          </Button>
                        </div>
                        <Textarea
                          id="skill-manifest"
                          className="min-h-[600px] resize-none font-mono text-sm leading-6"
                          value={draftContent}
                          spellCheck={false}
                          onChange={(event) =>
                            setDraftContent(event.target.value)
                          }
                        />
                      </div>

                      {draftMode === "existing" && selectedSkill ? (
                        <SkillFileStructurePreview skill={selectedSkill} />
                      ) : null}
                    </div>
                  </div>

                  <DialogFooter className="shrink-0 items-center border-t bg-background px-4 py-2 sm:justify-between">
                    <div
                      className="text-sm text-muted-foreground"
                      aria-live="polite"
                    >
                      {hasChanges ? "Unsaved changes" : null}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={resetCurrentDraft}
                        disabled={
                          isSaving || (draftMode === "existing" && !hasChanges)
                        }
                      >
                        {draftMode === "new" ? "Cancel" : "Reset"}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void saveCurrentDraft()}
                        disabled={
                          Boolean(validationError) || !hasChanges || isSaving
                        }
                      >
                        {isSaving
                          ? draftMode === "new"
                            ? "Creating..."
                            : "Saving..."
                          : draftMode === "new"
                            ? "Create"
                            : "Save"}
                      </Button>
                    </div>
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
                      SKILL.md.
                    </p>
                  </div>
                </div>
              )}
            </main>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={manifestEditorOpen} onOpenChange={setManifestEditorOpen}>
        <DialogContent className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-4 p-5 outline-none focus:outline-none focus-visible:ring-0 sm:max-w-6xl">
          <DialogHeader className="pr-8">
            <DialogTitle>Edit SKILL.md</DialogTitle>
            <DialogDescription>
              Edit the selected skill manifest in a larger focused editor.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
            placeholder="Skill instructions and frontmatter."
            spellCheck={false}
            className="min-h-0 flex-1 resize-none font-mono text-sm leading-6"
          />

          <DialogFooter>
            <Button type="button" onClick={() => setManifestEditorOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnsavedChangesDialog
        open={unsavedChangesDialogOpen}
        onCancel={() => {
          setPendingAction(null);
          setUnsavedChangesDialogOpen(false);
        }}
        onDiscard={confirmDiscardUnsavedChanges}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete skill?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the entire skill folder for {selectedSkill?.name}.
              This data is deleted from disk and cannot be restored from Chat
              Forge.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isSaving}
              onClick={(event) => {
                event.preventDefault();
                void confirmDeleteSkill();
              }}
            >
              {isSaving ? "Deleting..." : "Delete skill"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
