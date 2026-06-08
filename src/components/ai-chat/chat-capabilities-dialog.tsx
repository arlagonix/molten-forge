import { Bot, BookOpen, Wrench } from "lucide-react";
import { memo, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ChatThinkingMode,
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  Permission,
  ModeFeaturePermission,
} from "@/lib/ai-chat/types";
import { FEATURE_PERMISSION_KEY } from "@/lib/ai-chat/modes";
import { cn } from "@/lib/utils";

type ChatCapabilitiesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tools: LoadedToolInfo[];
  toolPermissions: Map<string, Permission>;
  globalToolPermissions: Map<string, Permission>;
  modeToolPermissions?: Map<string, ModeFeaturePermission>;
  skills: LoadedSkillInfo[];
  skillPermissions: Map<string, Permission>;
  globalSkillPermissions: Map<string, Permission>;
  modeSkillPermissions?: Map<string, ModeFeaturePermission>;
  agents: LoadedAgentInfo[];
  agentPermissions: Map<string, Permission>;
  globalAgentPermissions: Map<string, Permission>;
  modeAgentPermissions?: Map<string, ModeFeaturePermission>;
  modeName: string;
  thinkingMode: ChatThinkingMode;
  onThinkingModeChange: (thinkingMode: ChatThinkingMode) => void;
  disabled?: boolean;
};

function formatPermission(permission: Permission) {
  if (permission === "allow") return "Allow";
  if (permission === "ask") return "Ask";
  return "Deny";
}

function PermissionSelect({ value }: { value: Permission }) {
  return (
    <Select value={value} disabled>
      <SelectTrigger className="h-8 w-[6.25rem] shrink-0" onClick={(event) => event.stopPropagation()}>
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

function permissionSourceText({
  modeName,
  permission,
  globalPermission,
  modePermission,
  modeFeaturePermission,
}: {
  modeName: string;
  permission: Permission;
  globalPermission: Permission;
  modePermission?: ModeFeaturePermission;
  modeFeaturePermission?: ModeFeaturePermission;
}) {
  if (modeFeaturePermission === "global") {
    return `Mode "${modeName}" master uses global: ${formatPermission(globalPermission)}`;
  }
  if (
    modeFeaturePermission === "allow" ||
    modeFeaturePermission === "ask" ||
    modeFeaturePermission === "deny"
  ) {
    return `Mode "${modeName}" master forces: ${formatPermission(modeFeaturePermission)}`;
  }
  if (!modePermission || modePermission === "global" || modePermission === "custom") {
    if (permission === globalPermission)
      return `Uses global setting: ${formatPermission(globalPermission)}`;
    return `Mode "${modeName}" overrides global: ${formatPermission(globalPermission)} → ${formatPermission(permission)}`;
  }
  if (modePermission === globalPermission)
    return `Mode "${modeName}" matches global: ${formatPermission(globalPermission)}`;
  return `Mode "${modeName}" overrides global: ${formatPermission(globalPermission)} → ${formatPermission(permission)}`;
}

function CapabilitySection({
  title,
  icon,
  items,
  permissions,
  globalPermissions,
  modePermissions,
  modeName,
}: {
  title: string;
  icon: ReactNode;
  items: Array<{ name: string; description?: string }>;
  permissions: Map<string, Permission>;
  globalPermissions: Map<string, Permission>;
  modePermissions?: Map<string, ModeFeaturePermission>;
  modeName: string;
}) {
  const enabledCount = items.filter((item) => permissions.get(item.name) !== "deny").length;
  return (
    <section className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</Label>
        <span className="text-sm text-muted-foreground">{enabledCount}/{items.length}</span>
      </div>
      <div className="grid gap-1.5">
        {items.map((item) => {
          const permission = permissions.get(item.name) ?? "ask";
          const globalPermission = globalPermissions.get(item.name) ?? permission;
          const modePermission = modePermissions?.get(item.name);
          const modeFeaturePermission = modePermissions?.get(FEATURE_PERMISSION_KEY);
          const denied = permission === "deny";
          return (
            <div
              key={item.name}
              className={cn(
                "flex min-w-0 items-start gap-3 border bg-card px-3 py-2",
                denied && "bg-muted/30 text-muted-foreground opacity-70",
              )}
            >
              <span className="mt-1 shrink-0 text-muted-foreground">{icon}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-medium leading-6">{item.name}</div>
                {item.description ? (
                  <div className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                    {item.description}
                  </div>
                ) : null}
                <div className="mt-1 text-xs leading-4 text-muted-foreground">
                  {permissionSourceText({
                    modeName,
                    permission,
                    globalPermission,
                    modePermission,
                    modeFeaturePermission,
                  })}
                </div>
              </div>
              <PermissionSelect value={permission} />
            </div>
          );
        })}
        {items.length === 0 ? <div className="border border-dashed px-3 py-4 text-sm text-muted-foreground">No {title.toLowerCase()} configured.</div> : null}
      </div>
    </section>
  );
}

export const ChatCapabilitiesDialog = memo(function ChatCapabilitiesDialog({
  open,
  onOpenChange,
  tools,
  toolPermissions,
  globalToolPermissions,
  modeToolPermissions,
  skills,
  skillPermissions,
  globalSkillPermissions,
  modeSkillPermissions,
  agents,
  agentPermissions,
  globalAgentPermissions,
  modeAgentPermissions,
  modeName,
  thinkingMode,
  onThinkingModeChange,
  disabled = false,
}: ChatCapabilitiesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden p-0 outline-none focus:outline-none focus-visible:outline-none sm:max-w-[760px]">
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <DialogTitle>Chat capabilities</DialogTitle>
          <DialogDescription>
            Readonly effective permissions from global settings and the selected mode.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-4">
            <section className="min-w-0 space-y-2">
              <Label htmlFor="chat-thinking-mode" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Thinking mode
              </Label>
              <div className="grid gap-1.5">
                <Select value={thinkingMode} onValueChange={(value) => onThinkingModeChange(value as ChatThinkingMode)} disabled={disabled}>
                  <SelectTrigger id="chat-thinking-mode" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="model_default">Model default</SelectItem>
                    <SelectItem value="off">No thinking</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm leading-5 text-muted-foreground">Availability is controlled by global settings and mode permissions. Chat-level tool and agent overrides were removed.</p>
              </div>
            </section>

            <CapabilitySection
              title="Tools"
              icon={<Wrench className="size-4" />}
              items={tools}
              permissions={toolPermissions}
              globalPermissions={globalToolPermissions}
              modePermissions={modeToolPermissions}
              modeName={modeName}
            />
            <CapabilitySection
              title="Skills"
              icon={<BookOpen className="size-4" />}
              items={skills}
              permissions={skillPermissions}
              globalPermissions={globalSkillPermissions}
              modePermissions={modeSkillPermissions}
              modeName={modeName}
            />
            <CapabilitySection
              title="Agents"
              icon={<Bot className="size-4" />}
              items={agents}
              permissions={agentPermissions}
              globalPermissions={globalAgentPermissions}
              modePermissions={modeAgentPermissions}
              modeName={modeName}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});
