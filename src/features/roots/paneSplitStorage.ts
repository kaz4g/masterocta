/**
 * Versioned localStorage for Library workspace pane split percentages.
 * Never stores absolute paths, root ids, or theme/locale keys.
 */

export const PANE_SPLIT_STORAGE_KEY = "masterocta.workspace.pane-split.v1";
export const PANE_SPLIT_SCHEMA = "masterocta.workspace.pane-split:v1";

/** AppShell default Sources width % (Inspector present). */
export const DEFAULT_SOURCES_SPLIT_PERCENT = 16;
/** AppShell default main/inspector split % (main column). */
export const DEFAULT_MAIN_SPLIT_PERCENT = 62;

/** AppShell Sources min % when Inspector is present. */
export const SOURCES_SPLIT_MIN_PERCENT = 12;
/** AppShell Sources max % when Inspector is present. */
export const SOURCES_SPLIT_MAX_PERCENT = 42;
/** AppShell main/inspector min % for the main column. */
export const MAIN_SPLIT_MIN_PERCENT = 55;
/** AppShell main/inspector max % for the main column. */
export const MAIN_SPLIT_MAX_PERCENT = 75;

export interface PaneSplitPercents {
  sources: number;
  main: number;
}

export const DEFAULT_PANE_SPLIT_PERCENTS: PaneSplitPercents = {
  sources: DEFAULT_SOURCES_SPLIT_PERCENT,
  main: DEFAULT_MAIN_SPLIT_PERCENT,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function looksLikePath(value: unknown): boolean {
  return typeof value === "string" && (value.includes("/") || value.includes("\\"));
}

function defaults(): PaneSplitPercents {
  return { ...DEFAULT_PANE_SPLIT_PERCENTS };
}

/**
 * Parse a stored payload. Missing, corrupt, wrong-schema, non-numeric, or
 * path-tainted values fall back to 16 / 62. In-range numbers are kept;
 * out-of-range numbers are clamped to the AppShell workspace bounds.
 */
export function parsePaneSplitPercents(raw: string | null | undefined): PaneSplitPercents {
  if (raw == null || raw === "") {
    return defaults();
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return defaults();
    }

    const record = parsed as Record<string, unknown>;
    if (record.schema !== PANE_SPLIT_SCHEMA) {
      return defaults();
    }
    if (Object.values(record).some(looksLikePath)) {
      return defaults();
    }
    if (!isFiniteNumber(record.sources) || !isFiniteNumber(record.main)) {
      return defaults();
    }

    return {
      sources: clamp(record.sources, SOURCES_SPLIT_MIN_PERCENT, SOURCES_SPLIT_MAX_PERCENT),
      main: clamp(record.main, MAIN_SPLIT_MIN_PERCENT, MAIN_SPLIT_MAX_PERCENT),
    };
  } catch {
    return defaults();
  }
}

export function readPaneSplitPercents(): PaneSplitPercents {
  try {
    return parsePaneSplitPercents(window.localStorage.getItem(PANE_SPLIT_STORAGE_KEY));
  } catch {
    return defaults();
  }
}

export function writePaneSplitPercents(value: PaneSplitPercents): PaneSplitPercents {
  const next: PaneSplitPercents = {
    sources: isFiniteNumber(value.sources)
      ? clamp(value.sources, SOURCES_SPLIT_MIN_PERCENT, SOURCES_SPLIT_MAX_PERCENT)
      : DEFAULT_SOURCES_SPLIT_PERCENT,
    main: isFiniteNumber(value.main)
      ? clamp(value.main, MAIN_SPLIT_MIN_PERCENT, MAIN_SPLIT_MAX_PERCENT)
      : DEFAULT_MAIN_SPLIT_PERCENT,
  };

  try {
    window.localStorage.setItem(
      PANE_SPLIT_STORAGE_KEY,
      JSON.stringify({
        schema: PANE_SPLIT_SCHEMA,
        sources: next.sources,
        main: next.main,
      }),
    );
  } catch {
    // Persistence is best-effort; the in-session split still applies.
  }

  return next;
}
