import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAIN_SPLIT_PERCENT,
  DEFAULT_PANE_SPLIT_PERCENTS,
  DEFAULT_SOURCES_SPLIT_PERCENT,
  MAIN_SPLIT_MAX_PERCENT,
  MAIN_SPLIT_MIN_PERCENT,
  PANE_SPLIT_SCHEMA,
  PANE_SPLIT_STORAGE_KEY,
  SOURCES_SPLIT_MAX_PERCENT,
  SOURCES_SPLIT_MIN_PERCENT,
  parsePaneSplitPercents,
  readPaneSplitPercents,
  writePaneSplitPercents,
} from "./paneSplitStorage";

function storedPayload(sources: number, main: number) {
  return JSON.stringify({
    schema: PANE_SPLIT_SCHEMA,
    sources,
    main,
  });
}

describe("parsePaneSplitPercents", () => {
  it("falls back to 16 / 62 when the value is missing", () => {
    expect(parsePaneSplitPercents(null)).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
    expect(parsePaneSplitPercents(undefined)).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
    expect(parsePaneSplitPercents("")).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
  });

  it("falls back to defaults for corrupt JSON and non-objects", () => {
    expect(parsePaneSplitPercents("{not-json")).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
    expect(parsePaneSplitPercents("null")).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
    expect(parsePaneSplitPercents("[]")).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
    expect(parsePaneSplitPercents("16")).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
    expect(parsePaneSplitPercents("{}")).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
  });

  it("falls back when the schema version does not match", () => {
    expect(parsePaneSplitPercents(JSON.stringify({
      schema: "masterocta.workspace.pane-split:v0",
      sources: 24,
      main: 60,
    }))).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
  });

  it("falls back when sources or main is not a finite number", () => {
    expect(parsePaneSplitPercents(JSON.stringify({
      schema: PANE_SPLIT_SCHEMA,
      sources: "24",
      main: 60,
    }))).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
    expect(parsePaneSplitPercents(JSON.stringify({
      schema: PANE_SPLIT_SCHEMA,
      sources: 24,
      main: null,
    }))).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
    expect(parsePaneSplitPercents(JSON.stringify({
      schema: PANE_SPLIT_SCHEMA,
      sources: Number.NaN,
      main: 60,
    }))).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
    expect(parsePaneSplitPercents(JSON.stringify({
      schema: PANE_SPLIT_SCHEMA,
      sources: Number.POSITIVE_INFINITY,
      main: 60,
    }))).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
  });

  it("falls back when any stored field looks like a filesystem path", () => {
    expect(parsePaneSplitPercents(JSON.stringify({
      schema: PANE_SPLIT_SCHEMA,
      sources: 24,
      main: 60,
      rootPath: "/tmp/fixture-root",
    }))).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
    expect(parsePaneSplitPercents(JSON.stringify({
      schema: PANE_SPLIT_SCHEMA,
      sources: "C\\\\Users\\\\card",
      main: 60,
    }))).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
  });

  it("restores in-range percentages", () => {
    expect(parsePaneSplitPercents(storedPayload(24, 60))).toEqual({
      sources: 24,
      main: 60,
    });
  });

  it("clamps out-of-range percentages to AppShell workspace bounds", () => {
    expect(parsePaneSplitPercents(storedPayload(5, 10))).toEqual({
      sources: SOURCES_SPLIT_MIN_PERCENT,
      main: MAIN_SPLIT_MIN_PERCENT,
    });
    expect(parsePaneSplitPercents(storedPayload(90, 90))).toEqual({
      sources: SOURCES_SPLIT_MAX_PERCENT,
      main: MAIN_SPLIT_MAX_PERCENT,
    });
  });
});

describe("readPaneSplitPercents / writePaneSplitPercents", () => {
  beforeEach(() => {
    window.localStorage.removeItem(PANE_SPLIT_STORAGE_KEY);
  });

  afterEach(() => {
    window.localStorage.removeItem(PANE_SPLIT_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it("uses a versioned key distinct from theme and locale storage", () => {
    expect(PANE_SPLIT_STORAGE_KEY).toBe("masterocta.workspace.pane-split.v1");
    expect(PANE_SPLIT_STORAGE_KEY).not.toContain("ui-theme");
    expect(PANE_SPLIT_STORAGE_KEY).not.toContain("ui-locale");
    window.localStorage.setItem("masterocta.ui-theme", "classic");
    window.localStorage.setItem("masterocta.ui-locale", "ja");
    writePaneSplitPercents({ sources: 22, main: 64 });
    expect(window.localStorage.getItem("masterocta.ui-theme")).toBe("classic");
    expect(window.localStorage.getItem("masterocta.ui-locale")).toBe("ja");
  });

  it("returns defaults when the key is missing", () => {
    expect(readPaneSplitPercents()).toEqual({
      sources: DEFAULT_SOURCES_SPLIT_PERCENT,
      main: DEFAULT_MAIN_SPLIT_PERCENT,
    });
  });

  it("round-trips clamped percentages without storing a path", () => {
    const written = writePaneSplitPercents({ sources: 30, main: 58 });
    expect(written).toEqual({ sources: 30, main: 58 });
    expect(readPaneSplitPercents()).toEqual({ sources: 30, main: 58 });

    const raw = window.localStorage.getItem(PANE_SPLIT_STORAGE_KEY);
    expect(raw).toBe(storedPayload(30, 58));
    const parsed = JSON.parse(raw ?? "null") as Record<string, unknown>;
    expect(parsed).toEqual({
      schema: PANE_SPLIT_SCHEMA,
      sources: 30,
      main: 58,
    });
    expect(JSON.stringify(parsed)).not.toMatch(/[/\\]/);
  });

  it("clamps on write and does not persist non-finite values", () => {
    expect(writePaneSplitPercents({ sources: 3, main: 99 })).toEqual({
      sources: SOURCES_SPLIT_MIN_PERCENT,
      main: MAIN_SPLIT_MAX_PERCENT,
    });
    expect(readPaneSplitPercents()).toEqual({
      sources: SOURCES_SPLIT_MIN_PERCENT,
      main: MAIN_SPLIT_MAX_PERCENT,
    });

    expect(writePaneSplitPercents({
      sources: Number.NaN,
      main: Number.POSITIVE_INFINITY,
    })).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
  });

  it("returns defaults when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPaneSplitPercents()).toEqual(DEFAULT_PANE_SPLIT_PERCENTS);
  });

  it("swallows localStorage.setItem failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writePaneSplitPercents({ sources: 20, main: 64 })).not.toThrow();
  });
});
