import { describe, expect, it } from "vitest";
import {
  meetDrawnContentWidthPx,
  pointerContentLocalX,
  pointerRatioInMeetSvg,
} from "./svgMeetPointer";

const VIEW_W = 640;
const VIEW_H = 140;

function svgBox(width: number, height: number): SVGSVGElement {
  return {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  } as SVGSVGElement;
}

describe("svgMeetPointer", () => {
  it("maps wide letterboxed containers to full ratio span", () => {
    const svg = svgBox(800, 140);
    expect(pointerRatioInMeetSvg(80, svg, VIEW_W, VIEW_H)).toBe(0);
    expect(pointerRatioInMeetSvg(80 + 320, svg, VIEW_W, VIEW_H)).toBeCloseTo(0.5);
    expect(pointerRatioInMeetSvg(80 + 640, svg, VIEW_W, VIEW_H)).toBe(1);
  });

  it("derives content-local drag coordinates", () => {
    const svg = svgBox(800, 140);
    const mapped = pointerContentLocalX(80 + 640, svg, VIEW_W, VIEW_H);
    expect(mapped).not.toBeNull();
    expect(mapped?.contentWidthPx).toBeCloseTo(640);
    expect(mapped?.localX).toBeCloseTo(640);
    expect(meetDrawnContentWidthPx(svg, VIEW_W, VIEW_H)).toBeCloseTo(640);
  });
});
