import { memo } from "react";
import { Check, ChevronsUpDown, Lock, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { providerDisplayName, providerLabel } from "@/lib/ai-chat/chat-utils";
import type { LoadedToolInfo, ProviderConfig } from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const ASK_USER_TOOL_NAME = "ask_user";
const CHECKLIST_WRITE_TOOL_NAME = "checklist_write";

function isBuiltInToolName(toolName: string) {
  return (
    toolName === ASK_USER_TOOL_NAME || toolName === CHECKLIST_WRITE_TOOL_NAME
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
}: ComposerFooterProps) {
  const selectedNames = new Set(selectedToolNames);

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
            className="model-picker-trigger h-9 w-full max-w-[14rem] justify-between overflow-hidden rounded-lg px-3 text-left font-normal"
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
          className="w-[min(var(--radix-popover-trigger-width),24rem)] rounded-lg p-0"
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
            className="h-9 shrink-0 justify-between gap-2 rounded-lg px-3 text-left font-normal"
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
          className="w-[min(24rem,calc(100vw-2rem))] rounded-lg p-0"
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
    </div>
  );
});
