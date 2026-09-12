import { describe, expect, it } from "vitest";
import { durationSeconds, frame } from "./frameMath";

describe("frameMath", () => {
  it("parses canonical decimal frame strings", () => {
    expect(frame("0")).toBe(0n);
    expect(frame("9007199254740993")).toBe(9007199254740993n);
    expect(frame("18446744073709551615")).toBe(18446744073709551615n);
  });

  it("rejects non-canonical frame strings", () => {
    expect(() => frame("01")).toThrow();
    expect(() => frame("-1")).toThrow();
  });

  it("derives duration from string frame counts without precision loss", () => {
    expect(durationSeconds("44100", 44100)).toBe(1);
    expect(durationSeconds("9007199254740992", 44100)).toBeCloseTo(
      9007199254740992 / 44100,
      5,
    );
  });
});
