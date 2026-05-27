import { BookOpen, Bot, ChevronsUpDown, Lock, Wrench } from "lucide-react";
import { memo, type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { isBuiltInToolName } from "@/lib/ai-chat/builtin-tools";
import type {
  ChatFileToolAutoApproval,
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
  fileToolAutoApproval: ChatFileToolAutoApproval;
  onToggleFileToolAutoApproval: (key: keyof ChatFileToolAutoApproval) => void;
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
        "group flex min-w-0 cursor-pointer items-start gap-2 border border-transparent px-2 py-2 outline-none hover:border-border hover:bg-muted/60 focus:outline-none focus-visible:outline-none",
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

type AutoApprovalRowProps = {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

function AutoApprovalRow({
  label,
  description,
  checked,
  onToggle,
  disabled,
}: AutoApprovalRowProps) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "flex min-w-0 cursor-pointer items-center gap-3 border border-transparent px-2 py-2 outline-none hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium leading-6">{label}</div>
        <div className="mt-0.5 text-sm leading-5 text-muted-foreground">
          {description}
        </div>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={onToggle}
        className="shrink-0 cursor-pointer"
      />
    </div>
  );
}

type CapabilityPickerProps = {
  title: string;
  placeholder: string;
  emptyLabel: string;
  totalCount: number;
  selectedCount: number;
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
};

function CapabilityPicker({
  title,
  placeholder,
  emptyLabel,
  totalCount,
  selectedCount,
  searchValue,
  onSearchValueChange,
  disabled,
  children,
}: CapabilityPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </Label>
        <span className="text-sm text-muted-foreground">
          {selectedCount}/{totalCount}
        </span>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            aria-expanded={open}
            className="h-9 w-full justify-between px-3 text-left font-normal outline-none focus:outline-none focus-visible:outline-none"
          >
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {selectedCount === 0
                ? `No ${title.toLowerCase()} enabled`
                : `${selectedCount} of ${totalCount} ${title.toLowerCase()} enabled`}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
          onWheel={(event) => event.stopPropagation()}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="border-b p-2">
            <Input
              value={searchValue}
              onChange={(event) => onSearchValueChange(event.target.value)}
              placeholder={placeholder}
              disabled={disabled}
              autoFocus
              className="h-8 outline-none focus-visible:ring-0"
            />
          </div>
          <div className="max-h-80 overflow-y-auto overscroll-contain p-1">
            {children}
          </div>
          {totalCount === 0 && (
            <div className="border-t px-3 py-4 text-center text-sm text-muted-foreground">
              {emptyLabel}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </section>
  );
}

export const ChatCapabilitiesDialog = memo(function ChatCapabilitiesDialog({
  open,
  onOpenChange,
  tools,
  selectedToolNames,
  onToggleTool,
  fileToolAutoApproval,
  onToggleFileToolAutoApproval,
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

  const selectedTools = useMemo(
    () => new Set(selectedToolNames),
    [selectedToolNames],
  );
  const selectedSkills = useMemo(
    () => new Set(selectedSkillNames),
    [selectedSkillNames],
  );
  const activeSkills = useMemo(
    () => new Set(activeSkillNames),
    [activeSkillNames],
  );
  const selectedAgents = useMemo(
    () => new Set(selectedAgentNames),
    [selectedAgentNames],
  );

  const visibleTools = useMemo(
    () =>
      tools.filter((tool) =>
        matchesSearch(toolSearch, tool.name, tool.description),
      ),
    [tools, toolSearch],
  );
  const visibleSkills = useMemo(
    () =>
      skills.filter((skill) =>
        matchesSearch(skillSearch, skill.name, skill.description),
      ),
    [skills, skillSearch],
  );
  const visibleAgents = useMemo(
    () =>
      agents.filter((agent) =>
        matchesSearch(agentSearch, agent.name, agent.description),
      ),
    [agents, agentSearch],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] sm:max-w-[720px] flex-col overflow-visible p-0 outline-none focus:outline-none focus-visible:outline-none">
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <DialogTitle>Chat capabilities</DialogTitle>
          <DialogDescription>
            Choose which tools, skills, agents, and file approvals are available
            in this chat.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-4">
            <CapabilityPicker
              title="Tools"
              placeholder="Search tools..."
              emptyLabel="No tools configured."
              totalCount={tools.length}
              selectedCount={selectedToolNames.length}
              searchValue={toolSearch}
              onSearchValueChange={setToolSearch}
              disabled={disabled}
            >
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
                {visibleTools.length === 0 && tools.length > 0 && (
                  <div className="border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                    No tools found.
                  </div>
                )}
              </div>
            </CapabilityPicker>

            <CapabilityPicker
              title="Skills"
              placeholder="Search skills..."
              emptyLabel="No skills configured."
              totalCount={skills.length}
              selectedCount={selectedSkillNames.length}
              searchValue={skillSearch}
              onSearchValueChange={setSkillSearch}
              disabled={disabled}
            >
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
                {visibleSkills.length === 0 && skills.length > 0 && (
                  <div className="border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                    No skills found.
                  </div>
                )}
              </div>
            </CapabilityPicker>

            <CapabilityPicker
              title="Agents"
              placeholder="Search agents..."
              emptyLabel="No agents configured."
              totalCount={agents.length}
              selectedCount={selectedAgentNames.length}
              searchValue={agentSearch}
              onSearchValueChange={setAgentSearch}
              disabled={disabled}
            >
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
                {visibleAgents.length === 0 && agents.length > 0 && (
                  <div className="border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                    No agents found.
                  </div>
                )}
              </div>
            </CapabilityPicker>

            <section className="min-w-0 space-y-2">
              <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                File auto-approval
              </Label>
              <div className="grid gap-1.5">
                <AutoApprovalRow
                  label="Auto-approve file create"
                  description="Run file_create without showing an approval prompt."
                  checked={fileToolAutoApproval.create === true}
                  disabled={disabled}
                  onToggle={() => onToggleFileToolAutoApproval("create")}
                />
                <AutoApprovalRow
                  label="Auto-approve file replace text"
                  description="Run file_replace_text without showing an approval prompt."
                  checked={fileToolAutoApproval.replaceText === true}
                  disabled={disabled}
                  onToggle={() => onToggleFileToolAutoApproval("replaceText")}
                />
                <AutoApprovalRow
                  label="Auto-approve file delete"
                  description="Run file_delete without showing an approval prompt."
                  checked={fileToolAutoApproval.delete === true}
                  disabled={disabled}
                  onToggle={() => onToggleFileToolAutoApproval("delete")}
                />
              </div>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});
