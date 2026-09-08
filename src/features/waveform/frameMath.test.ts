import { describe, expect, it } from 'vitest';
import { waveformFixture } from '../../test/audioApiStubs';
import { frame, frameAtFraction, makeRange, panRange, peakPath, validateRange, validateWaveform, zoomRange } from './frameMath';
describe('source frame coordinates', () => {
  it('keeps frames above Number.MAX_SAFE_INTEGER exact while zooming and panning', () => {
    const start = 9007199254740993n, total = start + 1024n;
    const view = makeRange(start, start + 256n);
    expect(frameAtFraction(view, .5)).toBe(start + 128n);
    expect(panRange(view, total.toString(), 1)).toEqual(makeRange(start + 64n, start + 320n));
    expect(zoomRange(view, total.toString(), 'in', null)).toEqual(makeRange(start + 64n, start + 192n));
  });
  it('clamps viewport boundaries and validates an exclusive end', () => {
    expect(panRange(makeRange(0n, 32n), '100', -1)).toEqual(makeRange(0n, 32n));
    expect(zoomRange(makeRange(0n, 1n), '100', 'in', null)).toEqual(makeRange(0n, 1n));
    expect(validateRange(makeRange(99n, 100n), '100')).toEqual(makeRange(99n, 100n));
    for (const text of ['01', '-1', '1e2', '', '18446744073709551616']) expect(() => frame(text)).toThrow();
    expect(() => validateRange(makeRange(100n, 100n), '100')).toThrow();
  });
  it('positions a partial final bucket by its actual source frame extent', () => {
    expect(peakPath([{ min: -1, max: 1 }, { min: 0, max: 0 }], makeRange(0n, 3n), '2', 300, 100)).toBe('M100.00 0.00V100.00M200.00 50.00H300.00');
  });
  it('keeps individual samples and constant signals visible at their exact amplitude', () => {
    expect(peakPath([{ min: .5, max: .5 }, { min: -.5, max: -.5 }], makeRange(100n, 102n), '1', 200, 100))
      .toBe('M0.00 25.00H100.00M100.00 75.00H200.00');
    expect(peakPath([{ min: 0, max: 0 }], makeRange(0n, 64n), '64', 200, 100))
      .toBe('M0.00 50.00H200.00');
  });
  it('rejects corrupt channel arrays and nonfinite or inverted peaks', () => {
    const value = waveformFixture();
    expect(validateWaveform(value, 800)).toBe(value);
    expect(() => validateWaveform({ ...value, channelPeaks: [[]] }, 800)).toThrow();
    for (const peak of [{ min: NaN, max: 1 }, { min: 1, max: -1 }, { min: -2, max: 0 }]) {
      expect(() => validateWaveform({ ...value, channelPeaks: value.channelPeaks.map(peaks => peaks.map(() => peak)) }, 800)).toThrow();
    }
  });
});
