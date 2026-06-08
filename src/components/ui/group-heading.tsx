import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function GroupHeading({
  children,
  className,
  action,
}: {
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn("mt-3 flex items-center gap-2 px-1", className)}>
      <Label className="flex items-center gap-2 select-none text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {children}
      </Label>
      <div className="min-w-0 flex-1 border-t border-border" />
      {action}
    </div>
  );
}
