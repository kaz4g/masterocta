export function frame(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Frame value must be a canonical decimal u64 string.");
  }
  const parsed = BigInt(value);
  if (parsed > 18446744073709551615n) {
    throw new Error("Frame number is too large.");
  }
  return parsed;
}

export function durationSeconds(frameCount: string, sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
  return Number(frame(frameCount)) / sampleRate;
}

export function positionInRange(value: string, startFrame: string, endFrameExclusive: string): number {
  const start = frame(startFrame);
  const end = frame(endFrameExclusive);
  const size = end - start;
  if (size <= 0n) return 0;
  return Number(frame(value) - start) / Number(size);
}
