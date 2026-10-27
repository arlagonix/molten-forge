export interface HoverMarqueeMetrics {
  distancePx: number;
  durationSeconds: number;
}

/**
 * Returns the travel distance and a readable animation duration for a clipped
 * single-line label. A zero distance means the label fits and must stay still.
 */
export function hoverMarqueeMetrics(contentWidth: number, viewportWidth: number): HoverMarqueeMetrics {
  const safeContentWidth = Number.isFinite(contentWidth) ? Math.max(0, contentWidth) : 0;
  const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const distancePx = Math.max(0, Math.ceil(safeContentWidth - safeViewportWidth));

  if (distancePx === 0) {
    return { distancePx: 0, durationSeconds: 0 };
  }

  // The keyframes spend time paused at both ends, so scale the full cycle with
  // overflow while keeping short and very long paths comfortable to read.
  const durationSeconds = Math.min(14, Math.max(6, 6 + distancePx / 32));
  return { distancePx, durationSeconds };
}
