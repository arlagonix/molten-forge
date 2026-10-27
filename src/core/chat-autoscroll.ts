export const AUTO_FOLLOW_RESUME_THRESHOLD_PX = 2;
export const SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX = 120;
export const MANUAL_SCROLL_INPUT_MS = 250;
export const TOUCH_SCROLL_INPUT_MS = 1000;
export const PROGRAMMATIC_SCROLL_GUARD_MS = 200;

// Exact smooth-follow constants carried over from the mature Electron Molten
// Forge implementation. The target is re-read every animation frame, so the
// viewport continuously eases toward a moving bottom instead of running a
// sequence of fixed-duration sampled animations.
export const STICKY_SCROLL_LERP = 0.12;
export const STICKY_SCROLL_SETTLE_EPSILON_PX = 0.5;
export const STICKY_SCROLL_SETTLE_FRAMES = 4;
export const FORCED_SCROLL_SETTLE_FRAMES = 8;

export type ScrollGeometry = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
};

export type ReaderAnchorCorrectionInput = {
  scrollTop: number;
  maxScrollTop: number;
  currentViewportOffset: number;
  desiredViewportOffset: number;
};

export function chatDistanceFromBottom(geometry: ScrollGeometry) {
  return Math.max(
    0,
    geometry.scrollHeight - geometry.scrollTop - geometry.clientHeight,
  );
}

export function historyLandingPosition(itemCount: number): "top" | "bottom" {
  return itemCount > 0 ? "bottom" : "top";
}

export function stickyScrollTarget(geometry: ScrollGeometry) {
  return Math.max(0, geometry.scrollHeight - geometry.clientHeight);
}

export function nextStickyScrollTop(
  currentScrollTop: number,
  targetScrollTop: number,
  lerp = STICKY_SCROLL_LERP,
) {
  // Auto-follow owns downward catch-up only. If real layout contraction makes
  // the legal bottom smaller, the browser may clamp naturally; adding our own
  // explicit upward write is what previously created visible up/down fighting.
  if (targetScrollTop <= currentScrollTop) return currentScrollTop;

  const distance = targetScrollTop - currentScrollTop;
  if (distance <= STICKY_SCROLL_SETTLE_EPSILON_PX) return targetScrollTop;
  return currentScrollTop + distance * lerp;
}

export function stickyScrollReachedTarget(
  currentScrollTop: number,
  targetScrollTop: number,
) {
  return targetScrollTop - currentScrollTop <= STICKY_SCROLL_SETTLE_EPSILON_PX;
}

export function shouldResumeAutoFollow(distanceFromBottom: number) {
  return distanceFromBottom <= AUTO_FOLLOW_RESUME_THRESHOLD_PX;
}

export function shouldShowScrollToBottomButton(distanceFromBottom: number) {
  return distanceFromBottom >= SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX;
}

export function shouldResumeAutoFollowFromManualScroll({
  previousScrollTop,
  currentScrollTop,
  distanceFromBottom,
}: {
  previousScrollTop: number;
  currentScrollTop: number;
  distanceFromBottom: number;
}) {
  // Explicit upward reader intent owns the viewport even when the resulting
  // position remains inside the tiny numerical bottom tolerance. Only a later
  // downward manual movement that actually reaches the bottom can re-arm.
  return currentScrollTop > previousScrollTop
    && shouldResumeAutoFollow(distanceFromBottom);
}

export function readerScrollTopForAnchor(input: ReaderAnchorCorrectionInput) {
  const delta = input.currentViewportOffset - input.desiredViewportOffset;
  if (Math.abs(delta) <= STICKY_SCROLL_SETTLE_EPSILON_PX) {
    return input.scrollTop;
  }

  return Math.min(
    Math.max(0, input.scrollTop + delta),
    Math.max(0, input.maxScrollTop),
  );
}

export function keyboardStopsAutoFollow(key: string) {
  return key === "ArrowUp" || key === "PageUp" || key === "Home";
}

export function keyboardMarksManualScroll(key: string) {
  return keyboardStopsAutoFollow(key)
    || key === "ArrowDown"
    || key === "PageDown"
    || key === "End"
    || key === " ";
}

export function keyboardActivatesReaderLayoutInteraction(key: string) {
  return key === "Enter" || key === " ";
}

export function pointerMarksManualScroll(
  pointerType: string,
  clientX: number,
  rectRight: number,
  offsetWidth: number,
  clientWidth: number,
) {
  if (pointerType === "touch" || pointerType === "pen") return true;

  const scrollbarGutterWidth = offsetWidth - clientWidth;
  return (
    scrollbarGutterWidth > 0 &&
    clientX >= rectRight - scrollbarGutterWidth - 2
  );
}

export function nestedScrollerCanConsumeWheel(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  deltaY: number,
) {
  if (scrollHeight <= clientHeight + 1 || deltaY === 0) return false;
  if (deltaY < 0) return scrollTop > 0;
  return scrollTop + clientHeight < scrollHeight - 1;
}
