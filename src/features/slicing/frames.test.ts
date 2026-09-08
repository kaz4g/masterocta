import { describe, expect, it } from "vitest";
import { frame, frameAt, inRange, position, previewChannels } from "./frames";

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
