/** Map pointer X into [0, 1] along drawn SVG content with preserveAspectRatio="xMidYMid meet". */
export function pointerRatioInMeetSvg(
  clientX: number,
  svg: SVGSVGElement,
  viewBoxWidth: number,
  viewBoxHeight: number,
): number | null {
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height || viewBoxWidth <= 0 || viewBoxHeight <= 0) return null;
  const scale = Math.min(rect.width / viewBoxWidth, rect.height / viewBoxHeight);
  const drawnWidth = scale * viewBoxWidth;
  if (drawnWidth <= 0) return null;
  const offsetX = (rect.width - drawnWidth) / 2;
  const x = clientX - rect.left - offsetX;
  return Math.min(1, Math.max(0, x / drawnWidth));
}

export function meetDrawnContentWidthPx(
  svg: SVGSVGElement,
  viewBoxWidth: number,
  viewBoxHeight: number,
): number | null {
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height || viewBoxWidth <= 0 || viewBoxHeight <= 0) return null;
  const scale = Math.min(rect.width / viewBoxWidth, rect.height / viewBoxHeight);
  const drawnWidth = scale * viewBoxWidth;
  return drawnWidth > 0 ? drawnWidth : null;
}

/** Content-local X in CSS pixels for drag mapping (letterbox-aware). */
export function pointerContentLocalX(
  clientX: number,
  svg: SVGSVGElement,
  viewBoxWidth: number,
  viewBoxHeight: number,
): { localX: number; contentWidthPx: number } | null {
  const ratio = pointerRatioInMeetSvg(clientX, svg, viewBoxWidth, viewBoxHeight);
  const contentWidthPx = meetDrawnContentWidthPx(svg, viewBoxWidth, viewBoxHeight);
  if (ratio === null || contentWidthPx === null) return null;
  return { localX: ratio * contentWidthPx, contentWidthPx };
}
