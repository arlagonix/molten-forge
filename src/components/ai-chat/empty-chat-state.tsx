import { Settings } from "lucide-react";
import { memo } from "react";

import { Button } from "@/components/ui/button";

export const EmptyChatState = memo(function EmptyChatState({
  onOpenProviders,
}: {
  onOpenProviders: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center px-3">
      <div className="max-w-md  border bg-card p-6 text-center shadow-xs">
        <h2 className="text-base font-semibold">Start a conversation</h2>
        <p className="mt-2 text-base leading-6 text-muted-foreground">
          Configure a provider, choose a model, and send your first message.
          Chats are stored locally as JSON files.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button className="" variant="secondary" onClick={onOpenProviders}>
            <Settings className="size-4" />
            Open providers
          </Button>
        </div>
      </div>
    </div>
  );
});
