import { BookOpen, Bot, Lock, Wrench } from "lucide-react";
import { memo, type ReactNode, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { isBuiltInToolName } from "@/lib/ai-chat/builtin-tools";
import type {
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

type ChatCapabilitiesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tools: LoadedToolInfo[];
  selectedToolNames: string[];
  onToggleTool: (toolName: string) => void;
  skills: LoadedSkillInfo[];
  selectedSkillNames: string[];
  activeSkillNames: string[];
  onToggleSkill: (skillName: string) => void;
  agents: LoadedAgentInfo[];
  selectedAgentNames: string[];
  onToggleAgent: (agentName: string) => void;
  disabled?: boolean;
};

function matchesSearch(search: string, ...values: Array<string | undefined>) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
}

type CapabilityRowProps = {
  icon: ReactNode;
  name: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  badge?: ReactNode;
};

function CapabilityRow({
  icon,
  name,
  description,
  checked,
  onToggle,
  disabled,
  badge,
}: CapabilityRowProps) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "group flex min-w-0 cursor-pointer items-start gap-2 border px-2 py-2 outline-none",
        checked
          ? "border-primary/30 bg-accent text-accent-foreground"
          : "border-transparent hover:border-border hover:bg-muted/60",
        disabled && "cursor-not-allowed opacity-60",
      )}
      onClick={() => {
        if (!disabled) onToggle();
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
      title={description}
    >
      <span className="mt-1 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-base leading-6">
          <span className="min-w-0 truncate font-medium">{name}</span>
          {badge}
        </div>
        {description && (
          <div className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={onToggle}
        className="mt-0.5 shrink-0 cursor-pointer"
      />
    </div>
  );
}

export const ChatCapabilitiesDialog = memo(function ChatCapabilitiesDialog({
  open,
  onOpenChange,
  tools,
  selectedToolNames,
  onToggleTool,
  skills,
  selectedSkillNames,
  activeSkillNames,
  onToggleSkill,
  agents,
  selectedAgentNames,
  onToggleAgent,
  disabled = false,
}: ChatCapabilitiesDialogProps) {
  const [toolSearch, setToolSearch] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const [agentSearch, setAgentSearch] = useState("");

  const selectedTools = useMemo(() => new Set(selectedToolNames), [selectedToolNames]);
  const selectedSkills = useMemo(() => new Set(selectedSkillNames), [selectedSkillNames]);
  const activeSkills = useMemo(() => new Set(activeSkillNames), [activeSkillNames]);
  const selectedAgents = useMemo(() => new Set(selectedAgentNames), [selectedAgentNames]);

  const visibleTools = useMemo(
    () => tools.filter((tool) => matchesSearch(toolSearch, tool.name, tool.description)),
    [tools, toolSearch],
  );
  const visibleSkills = useMemo(
    () => skills.filter((skill) => matchesSearch(skillSearch, skill.name, skill.description)),
    [skills, skillSearch],
  );
  const visibleAgents = useMemo(
    () => agents.filter((agent) => matchesSearch(agentSearch, agent.name, agent.description)),
    [agents, agentSearch],
  );

  const enabledSummary = [
    `${selectedToolNames.length} tools`,
    `${selectedSkillNames.length} skills`,
    `${selectedAgentNames.length} agents`,
  ].join(" · ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <DialogTitle>Chat capabilities</DialogTitle>
          <DialogDescription>
            Choose which tools, skills, and agents are available in this chat. {enabledSummary} enabled.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-6 lg:grid-cols-3">
            <section className="min-w-0 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Tools
                </Label>
                <span className="text-sm text-muted-foreground">
                  {selectedToolNames.length}/{tools.length}
                </span>
              </div>
              <Input
                value={toolSearch}
                onChange={(event) => setToolSearch(event.target.value)}
                placeholder="Search tools..."
                disabled={disabled}
              />
              <div className="grid gap-1.5">
                {visibleTools.map((tool) => (
                  <CapabilityRow
                    key={tool.name}
                    icon={<Wrench className="size-4" />}
                    name={tool.name}
                    description={tool.description}
                    checked={selectedTools.has(tool.name)}
                    disabled={disabled}
                    onToggle={() => onToggleTool(tool.name)}
                    badge={
                      isBuiltInToolName(tool.name) ? (
                        <Lock className="size-3 shrink-0 text-muted-foreground" />
                      ) : undefined
                    }
                  />
                ))}
                {visibleTools.length === 0 && (
                  <div className="border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                    No tools found.
                  </div>
                )}
              </div>
            </section>

            <Separator className="lg:hidden" />

            <section className="min-w-0 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Skills
                </Label>
                <span className="text-sm text-muted-foreground">
                  {selectedSkillNames.length}/{skills.length}
                </span>
              </div>
              <Input
                value={skillSearch}
                onChange={(event) => setSkillSearch(event.target.value)}
                placeholder="Search skills..."
                disabled={disabled}
              />
              <div className="grid gap-1.5">
                {visibleSkills.map((skill) => (
                  <CapabilityRow
                    key={skill.name}
                    icon={<BookOpen className="size-4" />}
                    name={skill.name}
                    description={skill.description}
                    checked={selectedSkills.has(skill.name)}
                    disabled={disabled}
                    onToggle={() => onToggleSkill(skill.name)}
                    badge={
                      activeSkills.has(skill.name) ? (
                        <span className="shrink-0 border bg-muted/60 px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                          active
                        </span>
                      ) : undefined
                    }
                  />
                ))}
                {visibleSkills.length === 0 && (
                  <div className="border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                    No skills found.
                  </div>
                )}
              </div>
            </section>

            <Separator className="lg:hidden" />

            <section className="min-w-0 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Agents
                </Label>
                <span className="text-sm text-muted-foreground">
                  {selectedAgentNames.length}/{agents.length}
                </span>
              </div>
              <Input
                value={agentSearch}
                onChange={(event) => setAgentSearch(event.target.value)}
                placeholder="Search agents..."
                disabled={disabled}
              />
              <div className="grid gap-1.5">
                {visibleAgents.map((agent) => (
                  <CapabilityRow
                    key={agent.name}
                    icon={<Bot className="size-4" />}
                    name={agent.name}
                    description={agent.description}
                    checked={selectedAgents.has(agent.name)}
                    disabled={disabled}
                    onToggle={() => onToggleAgent(agent.name)}
                  />
                ))}
                {visibleAgents.length === 0 && (
                  <div className="border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                    No agents found.
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});
