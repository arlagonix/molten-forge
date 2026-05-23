import { BookOpen, Check, ChevronsUpDown, Lock, Wrench } from "lucide-react";
import { memo } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { providerDisplayName, providerLabel } from "@/lib/ai-chat/chat-utils";
import type {
  LoadedSkillInfo,
  LoadedToolInfo,
  ProviderConfig,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const ASK_USER_TOOL_NAME = "ask_user";
const CHECKLIST_WRITE_TOOL_NAME = "checklist_write";
const WEB_FETCH_TOOL_NAME = "web_fetch";

function isBuiltInToolName(toolName: string) {
  return (
    toolName === ASK_USER_TOOL_NAME ||
    toolName === CHECKLIST_WRITE_TOOL_NAME ||
    toolName === WEB_FETCH_TOOL_NAME
  );
}

type VisibleProviderGroup = {
  provider: ProviderConfig;
  models: string[];
};

type ComposerFooterProps = {
  activeChatExists: boolean;
  isSending: boolean;
  activeChatProvider: ProviderConfig;
  activeChatModel: string;
  visibleProviderGroups: VisibleProviderGroup[];
  isModelPickerOpen: boolean;
  onModelPickerOpenChange: (open: boolean) => void;
  modelSearchValue: string;
  onModelSearchValueChange: (value: string) => void;
  onSelectProviderModel: (providerId: string, model: string) => void;
  visibleChatTools: LoadedToolInfo[];
  selectedToolNames: string[];
  isToolPickerOpen: boolean;
  onToolPickerOpenChange: (open: boolean) => void;
  toolSearchValue: string;
  onToolSearchValueChange: (value: string) => void;
  onToggleTool: (toolName: string) => void;
  visibleChatSkills: LoadedSkillInfo[];
  selectedSkillNames: string[];
  activeSkillNames: string[];
  isSkillPickerOpen: boolean;
  onSkillPickerOpenChange: (open: boolean) => void;
  skillSearchValue: string;
  onSkillSearchValueChange: (value: string) => void;
  onToggleSkill: (skillName: string) => void;
};

export const ComposerFooter = memo(function ComposerFooter({
  activeChatExists,
  isSending,
  activeChatProvider,
  activeChatModel,
  visibleProviderGroups,
  isModelPickerOpen,
  onModelPickerOpenChange,
  modelSearchValue,
  onModelSearchValueChange,
  onSelectProviderModel,
  visibleChatTools,
  selectedToolNames,
  isToolPickerOpen,
  onToolPickerOpenChange,
  toolSearchValue,
  onToolSearchValueChange,
  onToggleTool,
  visibleChatSkills,
  selectedSkillNames,
  activeSkillNames,
  isSkillPickerOpen,
  onSkillPickerOpenChange,
  skillSearchValue,
  onSkillSearchValueChange,
  onToggleSkill,
}: ComposerFooterProps) {
  const selectedNames = new Set(selectedToolNames);
  const selectedSkillNameSet = new Set(selectedSkillNames);
  const activeSkillNameSet = new Set(activeSkillNames);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Popover open={isModelPickerOpen} onOpenChange={onModelPickerOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={!activeChatExists || isSending}
            aria-expanded={isModelPickerOpen}
            className="model-picker-trigger h-9 w-full max-w-[14rem] justify-between overflow-hidden  px-3 text-left font-normal"
            title={
              isSending
                ? "Wait until this chat finishes generating"
                : activeChatModel
                  ? providerLabel(activeChatProvider)
                  : "Select a model"
            }
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                !activeChatModel && "text-muted-foreground",
              )}
            >
              {activeChatModel || "Select model"}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(var(--radix-popover-trigger-width),24rem)]  p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={modelSearchValue}
              onValueChange={onModelSearchValueChange}
              placeholder="Search models..."
            />
            <CommandList>
              {visibleProviderGroups.length > 0 ? (
                visibleProviderGroups.map(({ provider, models }) => (
                  <CommandGroup
                    key={provider.id}
                    heading={providerDisplayName(provider)}
                  >
                    {models.map((model) => (
                      <CommandItem
                        key={`${provider.id}:${model}`}
                        value={`${providerDisplayName(provider)} ${model}`}
                        onSelect={() =>
                          onSelectProviderModel(provider.id, model)
                        }
                        className="min-w-0 cursor-pointer"
                        title={`${providerDisplayName(provider)} · ${model}`}
                      >
                        <span className="min-w-0 flex-1 truncate">{model}</span>
                        <Check
                          className={cn(
                            "size-4",
                            activeChatProvider.id === provider.id &&
                              activeChatModel === model
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))
              ) : (
                <CommandEmpty>
                  No visible models. Enable models in Providers.
                </CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Popover
        open={isToolPickerOpen}
        onOpenChange={(open) => {
          onToolPickerOpenChange(open);
          if (!open) onToolSearchValueChange("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={!activeChatExists || isSending}
            aria-expanded={isToolPickerOpen}
            className="h-9 shrink-0 justify-between gap-2  px-3 text-left font-normal"
            title={
              isSending
                ? "Wait until this chat finishes generating"
                : "Select tools for this chat"
            }
          >
            <span className="flex min-w-0 items-center gap-2">
              <Wrench className="size-4 shrink-0 opacity-70" />
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(24rem,calc(100vw-2rem))]  p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={toolSearchValue}
              onValueChange={onToolSearchValueChange}
              placeholder="Search tools..."
            />
            <CommandList>
              {visibleChatTools.length > 0 ? (
                <CommandGroup heading="Available tools">
                  {visibleChatTools.map((tool) => {
                    const isSelected = selectedNames.has(tool.name);

                    return (
                      <CommandItem
                        key={tool.name}
                        value={`${tool.name} ${tool.description}`}
                        onSelect={() => onToggleTool(tool.name)}
                        className="min-w-0 cursor-pointer items-start gap-2"
                        title={tool.description}
                      >
                        <Switch
                          checked={isSelected}
                          tabIndex={-1}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={() => onToggleTool(tool.name)}
                          className="mt-0.5 shrink-0 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 truncate font-medium">
                              {tool.name}
                            </span>
                            {isBuiltInToolName(tool.name) && (
                              <Lock className="size-3 shrink-0 text-muted-foreground" />
                            )}
                          </div>
                          {tool.description && (
                            <div className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                              {tool.description}
                            </div>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : (
                <CommandEmpty>No tools found.</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Popover
        open={isSkillPickerOpen}
        onOpenChange={(open) => {
          onSkillPickerOpenChange(open);
          if (!open) onSkillSearchValueChange("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={!activeChatExists || isSending}
            aria-expanded={isSkillPickerOpen}
            className="h-9 shrink-0 justify-between gap-2  px-3 text-left font-normal"
            title={
              isSending
                ? "Wait until this chat finishes generating"
                : "Select skills available to the model in this chat"
            }
          >
            <span className="flex min-w-0 items-center gap-2">
              <BookOpen className="size-4 shrink-0 opacity-70" />
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(24rem,calc(100vw-2rem))]  p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={skillSearchValue}
              onValueChange={onSkillSearchValueChange}
              placeholder="Search skills..."
            />
            <CommandList>
              {visibleChatSkills.length > 0 ? (
                <CommandGroup heading="Available skills">
                  {visibleChatSkills.map((skill) => {
                    const isSelected = selectedSkillNameSet.has(skill.name);
                    const isActive = activeSkillNameSet.has(skill.name);

                    return (
                      <CommandItem
                        key={skill.name}
                        value={`${skill.name} ${skill.description}`}
                        onSelect={() => onToggleSkill(skill.name)}
                        className="min-w-0 cursor-pointer items-start gap-2"
                        title={skill.description}
                      >
                        <Switch
                          checked={isSelected}
                          tabIndex={-1}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={() => onToggleSkill(skill.name)}
                          className="mt-0.5 shrink-0 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 truncate font-medium">
                              {skill.name}
                            </span>
                            {isActive && (
                              <span className="shrink-0  border bg-muted/60 px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                                active
                              </span>
                            )}
                          </div>
                          {skill.description && (
                            <div className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                              {skill.description}
                            </div>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : (
                <CommandEmpty>No skills found.</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
});
