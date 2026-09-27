import { describe, expect, it } from "vitest";
import { frame, frameAt, inRange, pointerRatioInMeetSvg, position, previewChannels } from "./frames";

describe("source PCM coordinates", () => {
  it("keeps adjacent absolute frames exact above the JS safe integer limit", () => {
    const range = { startFrame: "9007199254740992", endExclusive: "9007199254741092" };
    expect(frameAt(0.01, range)).toBe("9007199254740993");
    expect(frameAt(1, range)).toBe("9007199254741091");
    expect(position("9007199254740993", range)).toBe(0.01);
    expect(inRange(range.endExclusive, range)).toBe(false);
    expect(frame("18446744073709551615")).toBe(18446744073709551615n);
    for (const invalid of ["01", "-1", "1.5", "1e2", "", "18446744073709551616"]) expect(() => frame(invalid)).toThrow();
  });
  it("decodes interleaved LE PCM and rejects truncated or non-finite preview data", () => {
    const ticket = { previewToken: "opaque", sampleRate: 48000, channels: 2, frameCount: "2", byteLength: 16 };
    const bytes = new ArrayBuffer(16), data = new DataView(bytes);
    [0.5, -0.5, 1, -1].forEach((v, i) => data.setFloat32(i * 4, v, true));
    const channels = previewChannels(ticket, bytes);
    expect([...channels[0]]).toEqual([0.5, 1]);
    expect([...channels[1]]).toEqual([-0.5, -1]);
    expect(() => previewChannels(ticket, bytes.slice(1))).toThrow();
    data.setFloat32(0, NaN, true);
    expect(() => previewChannels(ticket, bytes)).toThrow();
    expect(() => previewChannels({ ...ticket, frameCount: "0" }, bytes)).toThrow();
  });
});

const VIEW_W = 640;
const VIEW_H = 160;

function svgBox(width: number, height: number, left = 0, top = 0): SVGSVGElement {
  return {
    getBoundingClientRect: () => ({
      width,
      height,
      left,
      top,
      x: left,
      y: top,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    }),
  } as SVGSVGElement;
}

function ratio(clientX: number, width: number, height: number): number | null {
  return pointerRatioInMeetSvg(clientX, svgBox(width, height), VIEW_W, VIEW_H);
}

describe("pointerRatioInMeetSvg", () => {
  it("maps the full width when the container matches the 4:1 viewBox", () => {
    expect(ratio(0, 640, 160)).toBe(0);
    expect(ratio(320, 640, 160)).toBeCloseTo(0.5);
    expect(ratio(640, 640, 160)).toBe(1);
  });

  it("ignores horizontal letterboxing when the container is wider than 4:1", () => {
    expect(ratio(0, 800, 160)).toBe(0);
    expect(ratio(80, 800, 160)).toBe(0);
    expect(ratio(80 + 320, 800, 160)).toBeCloseTo(0.5);
    expect(ratio(80 + 640, 800, 160)).toBe(1);
    expect(ratio(800, 800, 160)).toBe(1);
  });

  it("uses the full width when the container is taller than 4:1", () => {
    expect(ratio(0, 640, 320)).toBe(0);
    expect(ratio(640, 640, 320)).toBe(1);
  });

  it("maps the visible waveform edges onto the view frame range", () => {
    const view = { startFrame: "1000", endExclusive: "5000" };
    const left = frameAt(ratio(80, 800, 160) ?? -1, view);
    const right = frameAt(ratio(80 + 640, 800, 160) ?? -1, view);
    expect(left).toBe("1000");
    expect(Number(right)).toBeGreaterThan(4900);
  });
});
