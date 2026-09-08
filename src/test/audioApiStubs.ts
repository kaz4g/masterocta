import { vi } from 'vitest';
import type { AudioApi, AudioWaveformQuery, AudioWaveformWindow } from '../api';

export function waveformFixture(query: AudioWaveformQuery = { range: null, targetPoints: 800 }, total = '44100', rate = 44100, channels = 2): AudioWaveformWindow {
  const range = query.range ?? { startFrame: '0', endFrame: total };
  const length = BigInt(range.endFrame) - BigInt(range.startFrame);
  const points = BigInt(Math.min(32, query.targetPoints));
  const step = (length + points - 1n) / points;
  const count = Number((length + step - 1n) / step);
  return {
    analyzerVersion: 'waveform:v2', sampleRate: rate, channels, frameCount: total,
    range, framesPerPeak: step.toString(),
    channelPeaks: Array.from({ length: channels }, (_, channel) => Array.from({ length: count }, () => channel === 0 ? { min: 0.2, max: 0.7 } : { min: -0.8, max: -0.3 })),
  };
}
export function waveformApiStubs(): Pick<AudioApi, 'queryWaveform' | 'createRangePreviewToken'> {
  return {
    queryWaveform: vi.fn((_root, _asset, query) => Promise.resolve(waveformFixture(query))),
    createRangePreviewToken: vi.fn().mockResolvedValue({ previewToken: 'preview:v1:opaque', expiresInSeconds: 120, mimeType: 'audio/wav', byteLength: 4, durationMillis: 1000, truncated: false }),
  };
}
