import { memo, useEffect, useRef } from "react";
import type { FrameRange, WaveformResponseV2 } from "../../api";

/** Read-only overlay contract; marker persistence/editing belongs to later analysis/editor work. */
export interface WaveformMarker {
  id: string; frame: number; label: string; kind: "transient" | "slice" | "loop";
}
export interface WaveformAnalysis {
  assetId: string;
  analyzerVersion: string;
  markers: readonly WaveformMarker[];
}
interface Props {
  waveform: WaveformResponseV2;
  width: number; dpr: number; height?: number; overview?: boolean;
}
export const WaveformCanvas = memo(function WaveformCanvas({ waveform, width, dpr, height = 240, overview = false }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const top = overview ? 0 : 24;
    const laneHeight = (height - top) / waveform.channelCount;
    const length = waveform.range.endFrameExclusive - waveform.range.startFrame;
    if (!overview) {
      context.fillStyle = "#a7adb8"; context.font = "11px system-ui";
      for (let tick = 0; tick < 5; tick++) {
        const x = width * tick / 4;
        const time = (waveform.range.startFrame + length * tick / 4) / waveform.sampleRate;
        context.textAlign = tick === 4 ? "right" : "left";
        context.fillText(`${time.toFixed(3)}s`, x, 15);
        context.strokeStyle = "#29313b"; context.beginPath(); context.moveTo(x, top); context.lineTo(x, height); context.stroke();
      }
    }
    waveform.channels.forEach((channel, index) => {
      const center = top + laneHeight * (index + 0.5);
      const scale = laneHeight * 0.44;
      context.strokeStyle = "#46505c"; context.beginPath(); context.moveTo(0, center); context.lineTo(width, center); context.stroke();
      // Peak and RMS layers share frame boundaries; amplitude is never normalized per viewport.
      channel.peaks.forEach((peak, bucket) => {
        const left = (waveform.bucketBoundaries[bucket] - waveform.range.startFrame) / length * width;
        const right = (waveform.bucketBoundaries[bucket + 1] - waveform.range.startFrame) / length * width;
        const min = Math.max(-1, Math.min(1, peak.min)); const max = Math.max(-1, Math.min(1, peak.max));
        context.fillStyle = "#a97032";
        context.fillRect(left, center - max * scale, Math.max(1 / dpr, right - left), Math.max(1 / dpr, (max - min) * scale));
        const rms = Math.max(0, Math.min(1, peak.rms));
        context.fillStyle = "#ffbd69";
        // Clip the RMS density to the observed envelope (also correct for DC offsets).
        const low = Math.max(min, -rms); const high = Math.min(max, rms);
        if (high > low) context.fillRect(left, center - high * scale, Math.max(1 / dpr, right - left), (high - low) * scale);
      });
      if (!overview) { context.fillStyle = "#fff"; context.textAlign = "left"; context.fillText(waveform.channelCount === 1 ? "Mono" : index === 0 ? "L" : "R", 6, top + laneHeight * index + 16); }
    });
  }, [waveform, width, height, dpr, overview]);
  return <canvas ref={canvas} width={Math.max(1, Math.round(width * dpr))} height={Math.round(height * dpr)} style={{ width: "100%", height }} role="img" aria-label={overview ? "Waveform overview" : waveform.channelCount === 1 ? "Mono audio waveform" : "Stereo audio waveform, independent L and R lanes"} />;
});
export function RangeOverlay({ range, viewport, className }: { range: FrameRange; viewport: FrameRange; className: string }) {
  const length = viewport.endFrameExclusive - viewport.startFrame;
  const start = Math.max(range.startFrame, viewport.startFrame);
  const end = Math.min(range.endFrameExclusive, viewport.endFrameExclusive);
  if (end <= start) return null;
  return <div aria-hidden="true" className={className} style={{ left: `${(start - viewport.startFrame) / length * 100}%`, width: `${(end - start) / length * 100}%` }} />;
}
