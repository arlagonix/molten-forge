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
