import { Check, ExternalLink, FolderOpen, Plus, Trash2 } from "lucide-react";
import { memo } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ChatWorkspaceRoot } from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

type WorkspaceRootsControlProps = {
  activeChatExists: boolean;
  disabled?: boolean;
  roots: ChatWorkspaceRoot[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddRoot: () => void;
  onRemoveRoot: (rootId: string) => void;
  onOpenRoot: (root: ChatWorkspaceRoot) => void;
};

function isAutomaticSkillRoot(root: ChatWorkspaceRoot) {
  return root.id.startsWith("skill:");
}

export const WorkspaceRootsControl = memo(function WorkspaceRootsControl({
  activeChatExists,
  disabled,
  roots,
  open,
  onOpenChange,
  onAddRoot,
  onRemoveRoot,
  onOpenRoot,
}: WorkspaceRootsControlProps) {
  const label = roots.length === 0 ? "No workspace" : roots.length === 1 ? roots[0].name : `${roots.length} workspaces`;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={!activeChatExists || disabled}
          aria-expanded={open}
          className="h-9 max-w-[13rem] justify-between gap-2 px-3 text-left font-normal"
          title={
            disabled
              ? "Wait until this chat finishes generating"
              : roots.length > 0
                ? "Manage workspace folders for this chat"
                : "Add a workspace folder for this chat"
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <FolderOpen className="size-4 shrink-0 opacity-70" />
            <span
              className={cn(
                "min-w-0 truncate",
                roots.length === 0 && "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup heading="Workspace folders">
              <CommandItem
                value="add-workspace"
                onSelect={onAddRoot}
                className="cursor-pointer gap-2"
              >
                <Plus className="size-4 shrink-0" />
                <span>Add folder...</span>
              </CommandItem>
              {roots.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No workspace folder selected.
                </div>
              ) : (
                roots.map((root) => {
                  const isSkillRoot = isAutomaticSkillRoot(root);

                  return (
                    <CommandItem
                      key={root.id}
                      value={`${root.name} ${root.path}`}
                      onSelect={() => onOpenRoot(root)}
                      className="min-w-0 cursor-pointer items-start gap-2"
                      title={root.path}
                    >
                      <Check className="mt-0.5 size-4 shrink-0 opacity-70" />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate font-medium">{root.name}</div>
                          {isSkillRoot ? (
                            <span className="shrink-0 rounded border px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                              Auto
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">{root.path}</div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title="Open folder"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onOpenRoot(root);
                        }}
                      >
                        <ExternalLink className="size-3.5" />
                      </Button>
                      {!isSkillRoot ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          title="Remove from chat"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onRemoveRoot(root.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      ) : null}
                    </CommandItem>
                  );
                })
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
