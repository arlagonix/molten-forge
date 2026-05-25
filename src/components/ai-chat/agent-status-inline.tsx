import { Check, X } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import type { AgentCallStatus } from "@/lib/ai-chat/types";

export function AgentStatusInline({ status }: { status: AgentCallStatus }) {
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
        <X className="size-3.5" />
        Failed
      </span>
    );
  }

  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <X className="size-3.5" />
        Cancelled
      </span>
    );
  }

  if (status === "complete") {
    return (
      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
        <Check className="size-3.5" />
        Complete
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
      <Spinner className="size-3.5" />
      {status === "pending" ? "Waiting" : "Running"}
    </span>
  );
}
