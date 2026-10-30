import { memo, type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ContextUsageDetails = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheHitPercent: number;
  usedTokens: number | null;
  contextLimit: number;
  contextPercent: number | null;
  estimated: boolean;
  systemPromptTokens: number;
  toolDefinitionTokens: number;
  messageTokens: number;
  breakdownEstimated: boolean;
};

type ContextUsagePopoverProps = {
  variant: "header" | "ring";
  details: ContextUsageDetails;
  onOpen?: () => void | Promise<void>;
};

function finiteTokenCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function compactNumber(value: number, decimals: number): string {
  return Number(value.toFixed(decimals)).toString();
}

function formatTokens(value: number | null | undefined): string {
  const safe = finiteTokenCount(value);
  if (safe === null) return "—";
  if (safe >= 1_000_000) return `${compactNumber(safe / 1_000_000, safe >= 10_000_000 ? 1 : 2)}M`;
  if (safe >= 100_000) return `${compactNumber(safe / 1_000, 1)}K`;
  if (safe >= 10_000) return `${compactNumber(safe / 1_000, 2)}K`;
  if (safe >= 1_000) return `${compactNumber(safe / 1_000, 1)}K`;
  return `${Math.round(safe)}`;
}

function formatHeaderTokens(value: number | null | undefined): string {
  const safe = finiteTokenCount(value);
  if (safe === null) return "?";
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(safe >= 10_000_000 ? 0 : 1)}M`;
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(safe >= 100_000 ? 0 : 1)}k`;
  return `${Math.round(safe)}`;
}

function roundedPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(Math.max(0, value))}%` : "?";
}

function remainingTokens(details: ContextUsageDetails): number | null {
  if (details.usedTokens === null || details.contextLimit <= 0) return null;
  return Math.max(0, details.contextLimit - details.usedTokens);
}

export function ContextUsagePanel({ details }: { details: ContextUsageDetails }) {
  const remaining = remainingTokens(details);
  const percent = roundedPercent(details.contextPercent);
  const used = details.usedTokens === null ? "—" : formatTokens(details.usedTokens);
  const limit = formatTokens(details.contextLimit);

  return (
    <div className="context-popover-panel">
      <div className="context-popover-title-row">
        <div className="context-popover-title">
          <strong>Context</strong>
          <span aria-hidden="true">·</span>
          <b>{used} / {limit}</b>
        </div>
        {details.estimated && <span className="context-estimated-label">Estimated</span>}
      </div>

      <div className="context-progress" aria-hidden="true">
        {details.contextLimit > 0 && details.systemPromptTokens > 0 && (
          <span className="context-segment system" style={{ width: `${Math.min(100, (details.systemPromptTokens / details.contextLimit) * 100)}%` }} />
        )}
        {details.contextLimit > 0 && details.toolDefinitionTokens > 0 && (
          <span className="context-segment tools" style={{ width: `${Math.min(100, (details.toolDefinitionTokens / details.contextLimit) * 100)}%` }} />
        )}
        {details.contextLimit > 0 && details.messageTokens > 0 && (
          <span className="context-segment messages" style={{ width: `${Math.min(100, (details.messageTokens / details.contextLimit) * 100)}%` }} />
        )}
      </div>

      <div className="context-popover-usage-line">
        <span>{percent} used</span>
        <span>{remaining === null ? "—" : formatTokens(remaining)} remaining</span>
      </div>

      <div className="context-popover-divider" />

      <section className="context-detail-section" aria-label="Token usage">
        <h3>Usage</h3>
        <div className="context-detail-rows">
          <div><span>Input</span><b className="context-usage-value-input">{formatTokens(details.inputTokens)}</b></div>
          <div><span>Cached</span><b className="context-usage-value-cache">{formatTokens(details.cachedTokens)}</b></div>
          <div><span>Cache hit</span><b className="context-usage-value-hit">{roundedPercent(details.cacheHitPercent)}</b></div>
          <div><span>Output</span><b className="context-usage-value-output">{formatTokens(details.outputTokens)}</b></div>
        </div>
      </section>

      <section className="context-detail-section" aria-label="Current context">
        <h3>Current context</h3>
        <div className="context-detail-rows">
          <div><span>Used</span><b>{used}</b></div>
          <div><span>Limit</span><b>{limit}</b></div>
          <div><span>Remaining</span><b>{remaining === null ? "—" : formatTokens(remaining)}</b></div>
          <div><span>Used %</span><b>{percent}</b></div>
        </div>
      </section>

      <section className="context-detail-section" aria-label="Context breakdown">
        <div className="context-detail-heading">
          <h3>Context breakdown</h3>
          {details.breakdownEstimated && <span>Estimated</span>}
        </div>
        <div className="context-breakdown">
          <div><span className="context-swatch system" /><span>System / instructions</span><b>{formatTokens(details.systemPromptTokens)}</b></div>
          <div><span className="context-swatch tools" /><span>Tool definitions</span><b>{formatTokens(details.toolDefinitionTokens)}</b></div>
          <div><span className="context-swatch messages" /><span>Messages</span><b>{formatTokens(details.messageTokens)}</b></div>
        </div>
      </section>
    </div>
  );
}

export const ContextUsagePopover = memo(function ContextUsagePopover({ variant, details, onOpen }: ContextUsagePopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const percent = roundedPercent(details.contextPercent);

  const updatePopoverPosition = useCallback(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return;
    const rect = root.getBoundingClientRect();
    const edge = 12;
    const gap = 9;
    const right = Math.max(edge, window.innerWidth - rect.right);

    if (variant === "header") {
      setPopoverStyle({ top: Math.max(edge, rect.bottom + gap), right });
      return;
    }

    setPopoverStyle({ bottom: Math.max(edge, window.innerHeight - rect.top + gap), right });
  }, [variant]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (rootRef.current?.contains(target) || popoverRef.current?.contains(target))) return;
      setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.visualViewport?.addEventListener("resize", updatePopoverPosition);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.visualViewport?.removeEventListener("resize", updatePopoverPosition);
    };
  }, [open, updatePopoverPosition]);

  const toggle = () => {
    const next = !open;
    if (next) updatePopoverPosition();
    setOpen(next);
    if (next) {
      void Promise.resolve(onOpen?.()).catch((error) => console.warn("Could not refresh context usage", error));
    }
  };

  const title = `${details.usedTokens === null ? "Unknown" : formatTokens(details.usedTokens)} / ${formatTokens(details.contextLimit)} context tokens${details.estimated ? " (estimated after compaction)" : ""}`;
  const ariaLabel = details.contextPercent === null
    ? "Context usage unknown; open context usage details"
    : `${percent} context used${details.estimated ? ", estimated" : ""}; open context usage details`;

  return (
    <div ref={rootRef} className={`context-usage-control ${variant === "ring" ? "context-control" : "header-context-control"}`}>
      {variant === "header" ? (
        <button
          className={`chat-meta token-stats context-telemetry-trigger ${open ? "active" : ""}`}
          type="button"
          onClick={toggle}
          title="Open context usage details"
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <span className="token-stat token-stat-input">↓{formatHeaderTokens(details.inputTokens)}</span>
          <span className="token-stat token-stat-output">↑{formatHeaderTokens(details.outputTokens)}</span>
          <span className="token-stat token-stat-cache" title="Cached input tokens">C{formatHeaderTokens(details.cachedTokens)}</span>
          <span className="token-stat token-stat-hit" title="Cache hit = cached / (input + cached)">H{roundedPercent(details.cacheHitPercent)}</span>
          <span className="token-stat token-stat-context">{details.usedTokens === null ? "?" : formatHeaderTokens(details.usedTokens)}/{formatHeaderTokens(details.contextLimit)}</span>
          <span className="token-stat token-stat-context-percent">{percent}</span>
        </button>
      ) : (
        <button
          className={`context-button ${open ? "active" : ""}`}
          type="button"
          style={{ "--context-percent": `${Math.max(0, Math.min(100, details.contextPercent ?? 0))}%` } as CSSProperties}
          onClick={toggle}
          title={title}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <span className="context-ring-core" aria-hidden="true" />
        </button>
      )}

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          className={`context-popover context-popover-portal context-popover-${variant}`}
          style={popoverStyle}
          role="dialog"
          aria-label="Context usage details"
        >
          <ContextUsagePanel details={details} />
        </div>,
        document.body,
      )}
    </div>
  );
});
