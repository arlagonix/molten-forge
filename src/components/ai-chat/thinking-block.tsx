import { Brain, Check, ChevronDown, ChevronRight } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { SmoothAssistantMessageContent } from "@/components/ai-chat/smooth-assistant-message";
import { Spinner } from "@/components/ui/spinner";
import type { ThinkingStatus } from "@/lib/ai-chat/types";

function formatThoughtDuration({
  startedAt,
  completedAt,
  currentTimeMs,
  minOneSecond = false,
}: {
  startedAt?: string;
  completedAt?: string;
  currentTimeMs?: number;
  minOneSecond?: boolean;
}) {
  if (!startedAt) return "";

  const startedAtMs = Date.parse(startedAt);
  const completedAtMs = completedAt
    ? Date.parse(completedAt)
    : (currentTimeMs ?? Date.now());

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) {
    return "";
  }

  const rawElapsedSeconds = (completedAtMs - startedAtMs) / 1000;
  const elapsedSeconds = completedAt
    ? Math.round(rawElapsedSeconds)
    : Math.floor(rawElapsedSeconds);
  const totalSeconds = Math.max(minOneSecond ? 1 : 0, elapsedSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} sec`);

  return parts.join(" ");
}

function getEffectiveThinkingStatus(
  status: ThinkingStatus | undefined,
  isStreaming: boolean,
) {
  if (status === "complete") return "complete";
  if (isStreaming || status === "in_progress") return "in_progress";
  return status ?? "complete";
}

function renderThinkingStatus(status: ThinkingStatus) {
  if (status === "complete") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-green-600 dark:text-green-400">
        <Check className="size-3.5 shrink-0" />
        <span className="shrink-0">Complete</span>
      </span>
    );
  }

  if (status === "waiting") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-amber-600 dark:text-amber-400">
        <Spinner className="size-3.5 shrink-0" />
        <span className="shrink-0">Waiting</span>
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-amber-600 dark:text-amber-400">
      <Spinner className="size-3.5 shrink-0" />
      <span className="shrink-0">In progress</span>
    </span>
  );
}

function ThinkingBlockComponent({
  id,
  content,
  status,
  startedAt,
  completedAt,
  isStreaming,
  isCollapsed,
  flushVersion,
  forceInstant = false,
  renderMarkdownWhileStreaming = true,
  onToggleCollapsed,
  onVisualProgress,
  onVisualStreamingChange,
}: {
  id: string;
  content: string;
  status?: ThinkingStatus;
  startedAt?: string;
  completedAt?: string;
  isStreaming: boolean;
  isCollapsed: boolean;
  flushVersion: number;
  forceInstant?: boolean;
  renderMarkdownWhileStreaming?: boolean;
  onToggleCollapsed: () => void;
  onVisualProgress?: () => void;
  onVisualStreamingChange?: (isStreaming: boolean) => void;
}) {
  const effectiveStatus = getEffectiveThinkingStatus(status, isStreaming);
  const [durationTickMs, setDurationTickMs] = useState(() => Date.now());
  const onVisualStreamingChangeRef = useRef(onVisualStreamingChange);

  onVisualStreamingChangeRef.current = onVisualStreamingChange;

  useEffect(() => {
    if (!isCollapsed) return;

    onVisualStreamingChangeRef.current?.(false);
  }, [isCollapsed]);

  useEffect(() => {
    if (effectiveStatus !== "in_progress" || !startedAt) return;

    setDurationTickMs(Date.now());
    const intervalId = window.setInterval(() => {
      setDurationTickMs(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [effectiveStatus, startedAt]);

  const thoughtDuration = useMemo(() => {
    if (effectiveStatus === "complete") {
      return formatThoughtDuration({
        startedAt,
        completedAt,
        minOneSecond: true,
      });
    }

    if (effectiveStatus === "in_progress") {
      return formatThoughtDuration({
        startedAt,
        currentTimeMs: durationTickMs,
      });
    }

    return "";
  }, [completedAt, durationTickMs, effectiveStatus, startedAt]);

  // Extract the last non-empty trimmed line from the thinking content,
  // stripping leading markdown markers and non-letter characters.
  const lastContentLine = useMemo(() => {
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      const cleaned = trimmed.replace(/^[^a-zA-Z]+/, "");
      if (cleaned) return cleaned;
    }
    return "";
  }, [content]);

  // Throttle updates to ~1 second so the user has time to read.
  const [displayedLastLine, setDisplayedLastLine] = useState(lastContentLine);
  const lastContentLineRef = useRef(lastContentLine);
  lastContentLineRef.current = lastContentLine;

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setDisplayedLastLine(lastContentLineRef.current);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <article className="flex w-full min-w-0 max-w-full justify-start">
      <div className="w-full min-w-0 max-w-full overflow-hidden border border-dashed bg-muted/30 px-4 py-3 text-base leading-none text-muted-foreground shadow-xs [overflow-wrap:anywhere]">
        <button
          type="button"
          className="w-full min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleCollapsed}
          aria-expanded={!isCollapsed}
          aria-controls={`${id}-thinking-content`}
        >
          <div className="flex min-w-0 items-center gap-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <Brain className="size-3.5 shrink-0" />
              <span className="shrink-0 whitespace-nowrap">Thinking</span>
              <span className="shrink-0 text-muted-foreground/60">•</span>
              {renderThinkingStatus(effectiveStatus)}
              {thoughtDuration ? (
                <>
                  <span className="shrink-0 text-muted-foreground/60">•</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground/85">
                    {thoughtDuration}
                  </span>
                </>
              ) : null}
              {effectiveStatus !== "complete" && displayedLastLine ? (
                <>
                  <span className="shrink-0 text-muted-foreground/60">•</span>
                  <span
                    className="min-w-0 flex-1 truncate normal-case tracking-normal text-muted-foreground/85"
                    title={displayedLastLine}
                  >
                    {displayedLastLine}
                  </span>
                </>
              ) : null}
            </div>
            {isCollapsed ? (
              <ChevronRight className="size-3.5 shrink-0" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0" />
            )}
          </div>
        </button>

        {!isCollapsed && (
          <div
            id={`${id}-thinking-content`}
            className="mt-2 min-w-0 overflow-visible text-sm leading-5"
          >
            <SmoothAssistantMessageContent
              content={content}
              className="chat-markdown-compact shrink-0"
              isApiStreaming={isStreaming}
              skipSyntaxHighlight={isStreaming}
              renderMarkdownWhileStreaming={renderMarkdownWhileStreaming}
              flushVersion={flushVersion}
              forceInstant={forceInstant}
              onVisualProgress={onVisualProgress}
              onVisualStreamingChange={onVisualStreamingChange}
            />
          </div>
        )}
      </div>
    </article>
  );
}

export const ThinkingBlock = memo(
  ThinkingBlockComponent,
  (previous, next) =>
    previous.id === next.id &&
    previous.content === next.content &&
    previous.status === next.status &&
    previous.startedAt === next.startedAt &&
    previous.completedAt === next.completedAt &&
    previous.isStreaming === next.isStreaming &&
    previous.isCollapsed === next.isCollapsed &&
    previous.flushVersion === next.flushVersion &&
    previous.forceInstant === next.forceInstant &&
    previous.renderMarkdownWhileStreaming === next.renderMarkdownWhileStreaming,
);
