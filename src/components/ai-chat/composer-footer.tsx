import { Check, ChevronsUpDown, Settings2 } from "lucide-react";
import { memo, type ReactNode } from "react";

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
import { providerDisplayName, providerLabel } from "@/lib/ai-chat/chat-utils";
import type { ProviderConfig } from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

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
  workspaceControl?: ReactNode;
  onOpenCapabilities: () => void;
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
  workspaceControl,
  onOpenCapabilities,
}: ComposerFooterProps) {
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
            className="model-picker-trigger h-9 w-full max-w-[14rem] justify-between overflow-hidden px-3 text-left font-normal"
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
          className="w-[min(var(--radix-popover-trigger-width),24rem)] p-0"
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

      {workspaceControl}

      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={!activeChatExists || isSending}
        onClick={onOpenCapabilities}
        title={
          isSending
            ? "Wait until this chat finishes generating"
            : "Configure tools, skills, and agents for this chat"
        }
        aria-label="Configure tools, skills, and agents for this chat"
        className="h-9 w-9 shrink-0"
      >
        <Settings2 className="size-4 opacity-70" />
      </Button>
    </div>
  );
});
