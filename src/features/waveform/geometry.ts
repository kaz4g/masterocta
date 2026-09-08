import type { FrameRange } from "../../api";
export function fitRange(start: number, length: number, total: number): FrameRange {
  const size = Math.max(1, Math.min(total, Math.round(length)));
  const first = Math.max(0, Math.min(total - size, Math.round(start)));
  return { startFrame: first, endFrameExclusive: first + size };
}
export function zoomRange(range: FrameRange, fraction: number, factor: number, total: number) {
  const length = range.endFrameExclusive - range.startFrame;
  const anchor = range.startFrame + length * fraction;
  const nextLength = Math.max(1, Math.min(total, Math.round(length * factor)));
  return fitRange(anchor - nextLength * fraction, nextLength, total);
}
export function frameAt(range: FrameRange, fraction: number) {
  return Math.round(range.startFrame + Math.max(0, Math.min(1, fraction)) * (range.endFrameExclusive - range.startFrame));
}
export function requestedPoints(width: number, dpr: number, frameCount: number) {
  return Math.max(1, Math.min(4096, frameCount, Math.round(width * dpr)));
}
