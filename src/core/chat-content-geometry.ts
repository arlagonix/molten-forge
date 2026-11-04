export type ChatContentGeometry = {
  width: number;
  centerOffset: number;
};

export function chatContentGeometry(
  paneLeft: number,
  paneWidth: number,
  contentLeft: number,
  contentWidth: number,
): ChatContentGeometry {
  const safePaneWidth = Number.isFinite(paneWidth) ? Math.max(0, paneWidth) : 0;
  const safeContentWidth = Number.isFinite(contentWidth) ? Math.max(0, contentWidth) : 0;
  const safePaneLeft = Number.isFinite(paneLeft) ? paneLeft : 0;
  const safeContentLeft = Number.isFinite(contentLeft) ? contentLeft : safePaneLeft;
  const paneCenter = safePaneLeft + safePaneWidth / 2;
  const contentCenter = safeContentLeft + safeContentWidth / 2;
  return {
    width: safeContentWidth,
    centerOffset: contentCenter - paneCenter,
  };
}

/** Center the chat-width resize indicator on its pointer within the *rendered*
 * guide, avoiding offsets tied to the (movable) chat header. */
export function chatResizeMarkerY(clientY: number, guideTop: number, guideHeight: number): number {
  const height = Number.isFinite(guideHeight) ? Math.max(0, guideHeight) : 0;
  const top = Number.isFinite(guideTop) ? guideTop : 0;
  const inset = Math.min(18, height / 2);
  const pointerY = Number.isFinite(clientY) ? clientY - top : height / 2;
  return Math.max(inset, Math.min(height - inset, pointerY));
}
