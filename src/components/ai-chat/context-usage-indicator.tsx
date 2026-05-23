import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { memo } from "react";

export type ContextUsageInfo = {
  usedTokens?: number;
  limitTokens?: number;
  limitSource?: "manual" | "detected" | "speculated" | "unknown";
};

function formatNumber(value: number | undefined) {
  return value === undefined || !Number.isFinite(value)
    ? "unknown"
    : new Intl.NumberFormat().format(value);
}

function formatCompactTokens(value: number | undefined) {
  const safeValue =
    value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;

  if (safeValue >= 1_000_000) {
    return `${Math.round(safeValue / 1_000_000)}M`;
  }

  return `${Math.round(safeValue / 1_000)}k`;
}

function formatLimitSource(source: ContextUsageInfo["limitSource"]) {
  if (source === "manual") return "Manual override";
  if (source === "detected") return "Runtime/provider detected";
  if (source === "speculated") return "Speculated metadata";
  return "Unknown";
}

function getUsageColor(percentage: number | undefined) {
  if (percentage === undefined || !Number.isFinite(percentage)) {
    return "text-muted-foreground";
  }
  if (percentage < 75) return "text-muted-foreground";
  if (percentage < 90) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

export const ContextUsageIndicator = memo(function ContextUsageIndicator({
  usage,
}: {
  usage: ContextUsageInfo;
}) {
  const usedTokens = usage.usedTokens;
  const limitTokens = usage.limitTokens;
  const displayUsedTokens =
    usedTokens !== undefined && Number.isFinite(usedTokens) ? usedTokens : 0;
  const hasUsage = usedTokens !== undefined && Number.isFinite(usedTokens);
  const hasLimit =
    limitTokens !== undefined &&
    Number.isFinite(limitTokens) &&
    limitTokens > 0;
  const percentage = hasLimit
    ? (displayUsedTokens / limitTokens) * 100
    : undefined;
  const colorClass = getUsageColor(percentage);
  const label = hasLimit
    ? `${formatCompactTokens(displayUsedTokens)} / ${formatCompactTokens(limitTokens)}`
    : formatCompactTokens(displayUsedTokens);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "context-usage-token-label h-9 shrink-0  px-2 text-sm font-medium leading-none tabular-nums",
            colorClass,
          )}
          title="Context usage"
          aria-label="Context usage"
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72  p-3">
        <div className="grid gap-2 text-sm leading-5">
          <div className="font-medium">Context usage</div>
          <div className="grid gap-1 text-muted-foreground">
            <div className="flex justify-between gap-3">
              <span>Used</span>
              <span className="text-foreground">
                {formatNumber(hasUsage ? usedTokens : undefined)} tokens
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Limit</span>
              <span className="text-foreground">
                {formatNumber(limitTokens)} tokens
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Usage</span>
              <span className="text-foreground">
                {percentage === undefined
                  ? "unknown"
                  : `${percentage.toFixed(1)}%`}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Used source</span>
              <span className="text-right text-foreground">
                {hasUsage ? "Provider-reported usage" : "Unknown"}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Limit source</span>
              <span className="text-right text-foreground">
                {formatLimitSource(usage.limitSource)}
              </span>
            </div>
          </div>
          {!hasUsage && (
            <p className="text-sm leading-5 text-muted-foreground">
              Provider did not return token usage yet.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});
