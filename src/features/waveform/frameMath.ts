import type { AudioFrameRange, AudioWaveformWindow, WaveformPeak } from '../../api/audio';

const U64_MAX = (1n << 64n) - 1n;
export function frame(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,19})$/.test(value)) throw new Error('Use a whole source frame number.');
  const result = BigInt(value);
  if (result > U64_MAX) throw new Error('Frame is outside the supported range.');
  return result;
}
export function rangeLength(range: AudioFrameRange): bigint {
  return frame(range.endFrame) - frame(range.startFrame);
}
export function validateRange(range: AudioFrameRange, total: string): AudioFrameRange {
  const start = frame(range.startFrame), end = frame(range.endFrame);
  if (start >= end || end > frame(total)) throw new Error('Choose a nonempty range inside the audio.');
  return range;
}
export function makeRange(start: bigint, end: bigint): AudioFrameRange {
  return { startFrame: start.toString(), endFrame: end.toString() };
}
export function boundedRange(start: bigint, length: bigint, total: bigint): AudioFrameRange {
  const size = length < 1n ? 1n : length > total ? total : length;
  const left = start < 0n ? 0n : start > total - size ? total - size : start;
  return makeRange(left, left + size);
}
export function zoomRange(view: AudioFrameRange, total: string, direction: 'in' | 'out', selection: AudioFrameRange | null): AudioFrameRange {
  const start = frame(view.startFrame), end = frame(view.endFrame);
  const selectedCenter = selection ? (frame(selection.startFrame) + frame(selection.endFrame)) / 2n : null;
  const center = selectedCenter !== null && selectedCenter >= start && selectedCenter < end ? selectedCenter : (start + end) / 2n;
  const size = direction === 'in' ? (end - start) / 2n : (end - start) * 2n;
  return boundedRange(center - size / 2n, size, frame(total));
}
export function panRange(view: AudioFrameRange, total: string, direction: -1 | 1): AudioFrameRange {
  const size = rangeLength(view), step = size / 4n || 1n;
  return boundedRange(frame(view.startFrame) + BigInt(direction) * step, size, frame(total));
}
export function frameAtFraction(view: AudioFrameRange, fraction: number): bigint {
  const normalized = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return frame(view.startFrame) + rangeLength(view) * BigInt(Math.round(normalized * 1_000_000)) / 1_000_000n;
}
export function fractionAtFrame(value: bigint, view: AudioFrameRange): number {
  return Number((value - frame(view.startFrame)) * 1_000_000n / rangeLength(view)) / 1_000_000;
}
export function formatFrameTime(value: string, rate: number): string {
  const millis = frame(value) * 1000n / BigInt(rate);
  return `${millis / 60000n}:${((millis / 1000n) % 60n).toString().padStart(2, '0')}.${(millis % 1000n).toString().padStart(3, '0')}`;
}
export function validateWaveform(waveform: AudioWaveformWindow, targetPoints: number): AudioWaveformWindow {
  if (waveform.analyzerVersion !== 'waveform:v2' || !Number.isInteger(waveform.sampleRate) || waveform.sampleRate <= 0
    || ![1, 2].includes(waveform.channels)) throw new Error('Invalid waveform response.');
  validateRange(waveform.range, waveform.frameCount);
  const step = frame(waveform.framesPerPeak);
  if (step < 1n) throw new Error('Invalid waveform resolution.');
  const count = Number((rangeLength(waveform.range) + step - 1n) / step);
  if (count > targetPoints || waveform.channelPeaks.length !== waveform.channels
    || waveform.channelPeaks.some(peaks => peaks.length !== count || peaks.some(peak =>
      !Number.isFinite(peak.min) || !Number.isFinite(peak.max) || peak.min < -1 || peak.max > 1 || peak.min > peak.max))) {
    throw new Error('Invalid waveform peak data.');
  }
  return waveform;
}
export function peakPath(peaks: WaveformPeak[], range: AudioFrameRange, framesPerPeak: string, width = 1000, height = 100): string {
  const length = rangeLength(range), step = frame(framesPerPeak);
  return peaks.map((peak, index) => {
    const start = BigInt(index) * step;
    const end = start + step < length ? start + step : length;
    const x = Number((start + end) * 500_000n / length) / 1_000_000 * width;
    const top = (1 - Math.max(-1, Math.min(1, peak.max))) * height / 2;
    const bottom = (1 - Math.max(-1, Math.min(1, peak.min))) * height / 2;
    // A single-frame or constant bucket has no vertical extent. Draw its exact
    // value across that bucket so sample-level zoom and DC/silence stay visible.
    if (peak.min === peak.max) {
      const left = Number(start * 1_000_000n / length) / 1_000_000 * width;
      const right = Number(end * 1_000_000n / length) / 1_000_000 * width;
      return `M${left.toFixed(2)} ${top.toFixed(2)}H${right.toFixed(2)}`;
    }
    return `M${x.toFixed(2)} ${top.toFixed(2)}V${bottom.toFixed(2)}`;
  }).join('');
}
