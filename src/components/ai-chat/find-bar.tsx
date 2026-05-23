import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import type { RefObject } from "react";
import { memo } from "react";

import { TooltipIconButton } from "@/components/ai-chat/tooltip-icon-button";
import { Input } from "@/components/ui/input";

type FindBarProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  activeMatchOrdinal: number;
  matches: number;
  onQueryChange: (query: string) => void;
  onFindNext: (forward: boolean) => void;
  onClose: () => void;
};

export const FindBar = memo(function FindBar({
  inputRef,
  query,
  activeMatchOrdinal,
  matches,
  onQueryChange,
  onFindNext,
  onClose,
}: FindBarProps) {
  return (
    <div className="absolute right-3 top-3 z-40 flex max-w-[calc(100%-1.5rem)] items-center gap-1  border bg-card/95 p-1.5 text-card-foreground shadow-md backdrop-blur">
      <Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onFindNext(!event.shiftKey);
          }

          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        className="h-8 w-56  border-0 bg-transparent px-2 shadow-none focus-visible:ring-1"
        placeholder="Find in page"
        aria-label="Find in page"
      />
      <span className="min-w-14 text-center text-sm tabular-nums text-muted-foreground">
        {query.trim() ? `${activeMatchOrdinal || 0}/${matches}` : "0/0"}
      </span>
      <TooltipIconButton
        type="button"
        variant="ghost"
        size="icon-sm"
        label="Previous match"
        onClick={() => onFindNext(false)}
        disabled={!query.trim()}
      >
        <ChevronLeft className="size-3" />
      </TooltipIconButton>
      <TooltipIconButton
        type="button"
        variant="ghost"
        size="icon-sm"
        label="Next match"
        onClick={() => onFindNext(true)}
        disabled={!query.trim()}
      >
        <ChevronRight className="size-3" />
      </TooltipIconButton>
      <TooltipIconButton
        type="button"
        variant="ghost"
        size="icon-sm"
        label="Close find"
        onClick={onClose}
      >
        <X className="size-3" />
      </TooltipIconButton>
    </div>
  );
});
