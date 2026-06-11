import { AlertTriangle, CheckCircle2, FileText, Info, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ProjectInstructionsState } from "@/lib/ai-chat/project-instructions";
import { PROJECT_INSTRUCTIONS_SOFT_LIMIT_BYTES } from "@/lib/ai-chat/project-instructions";
import { cn } from "@/lib/utils";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatStatusLabel(state: ProjectInstructionsState) {
  if (state.status === "loaded") {
    return state.event === "updated" ? "Updated" : "Loaded";
  }
  if (state.status === "approval_required") return "Approval required";
  if (state.status === "skipped") return "Skipped";
  if (state.status === "failed") return "Failed";
  if (state.event === "discarded") return "Discarded";
  return "None";
}

function getBlockDetails(state: ProjectInstructionsState) {
  if (state.status === "loaded") {
    return [
      ...(state.replacedPath ? [`Discarded previous: ${state.replacedPath}`] : []),
      state.path,
      `${formatBytes(state.sizeBytes)} · last modified ${new Date(state.mtimeMs).toLocaleString()}`,
    ];
  }

  if (state.status === "approval_required") {
    return [
      state.path,
      `${formatBytes(state.sizeBytes)} is above the ${formatBytes(PROJECT_INSTRUCTIONS_SOFT_LIMIT_BYTES)} recommended limit. Loading it may increase cost, latency, and reduce useful context.`,
    ];
  }

  if (state.status === "skipped") {
    return [
      state.path,
      state.reason === "user_rejected"
        ? "AGENTS.md was not loaded for this chat."
        : "AGENTS.md was skipped because it exceeds the recommended size limit.",
    ];
  }

  if (state.status === "failed") {
    return [state.path, state.error];
  }

  if (state.event === "discarded") {
    return [state.discardedPath, "Previous workspace instructions were removed from future model context."];
  }

  return [];
}

export function ProjectInstructionsBlock({
  state,
  onApproveOversized,
  onRejectOversized,
}: {
  state: ProjectInstructionsState;
  onApproveOversized?: () => void | Promise<void>;
  onRejectOversized?: () => void | Promise<void>;
}) {
  if (!state.event) return null;

  const status = formatStatusLabel(state);
  const details = getBlockDetails(state);
  const isWarning = state.status === "approval_required" || state.status === "skipped";
  const isError = state.status === "failed";
  const Icon = state.status === "loaded"
    ? CheckCircle2
    : isError
      ? XCircle
      : isWarning
        ? AlertTriangle
        : state.event === "discarded"
          ? Info
          : FileText;

  return (
    <article className="flex w-full min-w-0 max-w-full justify-start">
      <div
        className={cn(
          "w-full min-w-0 max-w-full overflow-hidden border border-dashed bg-muted/30 px-4 py-3 text-base leading-6 text-muted-foreground [overflow-wrap:anywhere]",
          isWarning && "border-amber-500/35 bg-amber-500/5",
          isError && "border-destructive/35 bg-destructive/5",
        )}
      >
        <div className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="size-3.5 shrink-0" />
            <span className="shrink-0 truncate">Project instructions</span>
            <span className="shrink-0 text-muted-foreground/60">•</span>
            <span className="shrink-0">{status}</span>
          </div>
        </div>

        {details.length ? (
          <div className="mt-2 grid gap-1 text-sm normal-case leading-5 tracking-normal text-muted-foreground/85">
            {details.map((detail, index) => (
              <div
                key={`${index}:${detail}`}
                className={cn(index === 0 && "break-all font-mono text-xs")}
              >
                {detail}
              </div>
            ))}
          </div>
        ) : null}

        {state.status === "approval_required" ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => void onApproveOversized?.()}>
              Load anyway
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => void onRejectOversized?.()}>
              Skip
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
