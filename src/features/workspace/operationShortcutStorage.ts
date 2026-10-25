/**
 * Versioned localStorage for Library Copy / Rename shortcuts (M6-08).
 * Chords open the existing Operations Drawer. They never prepare or apply.
 * Never stores absolute paths, root ids, or theme/locale keys.
 */
import { shouldIgnoreLibraryShortcut } from "../../hooks/keyboardShortcutGuards";

export const OPERATION_SHORTCUT_STORAGE_KEY = "masterocta.workspace.operation-shortcuts.v1";
export const OPERATION_SHORTCUT_SCHEMA = "masterocta.workspace.operation-shortcuts:v1";

export type OperationShortcutAction = "copy" | "rename";

export interface OperationChord {
  /** KeyboardEvent.code, limited to KeyA–KeyZ and Digit0–Digit9. */
  code: string;
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
}

export interface OperationShortcutSettings {
  copy: OperationChord | null;
  rename: OperationChord | null;
}

export type ShortcutAssignError = "invalid" | "needsModifier" | "reserved" | "conflict";

const LIBRARY_RESERVED_CODES = new Set(["Space", "ArrowUp", "ArrowDown", "Escape", "Enter"]);
const MODIFIER_ONLY_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
]);

export const DEFAULT_COPY_CHORD: OperationChord = {
  code: "KeyC",
  alt: true,
  shift: true,
  ctrl: false,
  meta: false,
};

export const DEFAULT_RENAME_CHORD: OperationChord = {
  code: "KeyR",
  alt: true,
  shift: true,
  ctrl: false,
  meta: false,
};

export const DEFAULT_OPERATION_SHORTCUTS: OperationShortcutSettings = {
  copy: { ...DEFAULT_COPY_CHORD },
  rename: { ...DEFAULT_RENAME_CHORD },
};

export interface ShortcutKeyEvent {
  target?: EventTarget | null;
  code: string;
  key?: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
}

function defaults(): OperationShortcutSettings {
  return {
    copy: { ...DEFAULT_COPY_CHORD },
    rename: { ...DEFAULT_RENAME_CHORD },
  };
}

function looksLikePath(value: unknown): boolean {
  return typeof value === "string" && (value.includes("/") || value.includes("\\"));
}

function isCodeAllowed(code: string): boolean {
  return /^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code);
}

export function chordsEqual(left: OperationChord | null, right: OperationChord | null): boolean {
  if (left === null || right === null) return left === right;
  return left.code === right.code
    && left.alt === right.alt
    && left.shift === right.shift
    && left.ctrl === right.ctrl
    && left.meta === right.meta;
}

export function formatOperationChord(chord: OperationChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push("Ctrl");
  if (chord.alt) parts.push("Alt");
  if (chord.shift) parts.push("Shift");
  if (chord.meta) parts.push("Cmd");
  const label = chord.code.startsWith("Key")
    ? chord.code.slice(3)
    : chord.code.startsWith("Digit")
      ? chord.code.slice(5)
      : chord.code;
  parts.push(label);
  return parts.join("+");
}

function rejectionForChord(
  chord: OperationChord,
  other: OperationChord | null,
): ShortcutAssignError | null {
  if (LIBRARY_RESERVED_CODES.has(chord.code)) return "reserved";
  if (chord.code === "KeyF" && (chord.ctrl || chord.meta)) return "reserved";
  if (!isCodeAllowed(chord.code)) return "invalid";
  if (!chord.alt && !chord.ctrl && !chord.meta) return "needsModifier";
  if (other !== null && chordsEqual(chord, other)) return "conflict";
  return null;
}

function isChordRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseChord(value: unknown, other: OperationChord | null): OperationChord | null | undefined {
  if (value === null) return null;
  if (!isChordRecord(value)) return undefined;
  if (Object.values(value).some(looksLikePath)) return undefined;
  const code = value.code;
  if (typeof code !== "string" || typeof value.alt !== "boolean"
    || typeof value.shift !== "boolean" || typeof value.ctrl !== "boolean"
    || typeof value.meta !== "boolean") {
    return undefined;
  }
  const chord: OperationChord = {
    code,
    alt: value.alt,
    shift: value.shift,
    ctrl: value.ctrl,
    meta: value.meta,
  };
  if (rejectionForChord(chord, other) !== null) return undefined;
  return chord;
}

export function parseOperationShortcuts(raw: string | null | undefined): OperationShortcutSettings {
  if (raw == null || raw === "") return defaults();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isChordRecord(parsed)) return defaults();
    if (Object.values(parsed).some(looksLikePath)) return defaults();
    if (parsed.schema !== OPERATION_SHORTCUT_SCHEMA) return defaults();
    const copy = parseChord(parsed.copy, null);
    if (copy === undefined) return defaults();
    const rename = parseChord(parsed.rename, copy);
    if (rename === undefined) return defaults();
    if (copy !== null && rename !== null && chordsEqual(copy, rename)) return defaults();
    return { copy, rename };
  } catch {
    return defaults();
  }
}

export function readOperationShortcuts(): OperationShortcutSettings {
  try {
    return parseOperationShortcuts(window.localStorage.getItem(OPERATION_SHORTCUT_STORAGE_KEY));
  } catch {
    return defaults();
  }
}

export function writeOperationShortcuts(value: OperationShortcutSettings): OperationShortcutSettings {
  const next = parseOperationShortcuts(JSON.stringify({
    schema: OPERATION_SHORTCUT_SCHEMA,
    copy: value.copy,
    rename: value.rename,
  }));
  try {
    window.localStorage.setItem(
      OPERATION_SHORTCUT_STORAGE_KEY,
      JSON.stringify({
        schema: OPERATION_SHORTCUT_SCHEMA,
        copy: next.copy,
        rename: next.rename,
      }),
    );
  } catch {
    // Persistence is best-effort; the in-session chord still applies.
  }
  return next;
}

export function tryAssignOperationShortcut(
  settings: OperationShortcutSettings,
  action: OperationShortcutAction,
  event: ShortcutKeyEvent,
): { ok: true; settings: OperationShortcutSettings } | { ok: false; error: ShortcutAssignError } {
  if (MODIFIER_ONLY_CODES.has(event.code)) {
    return { ok: false, error: "invalid" };
  }
  if (LIBRARY_RESERVED_CODES.has(event.code) || (event.code === "KeyF" && (event.ctrlKey || event.metaKey))) {
    return { ok: false, error: "reserved" };
  }
  if (!isCodeAllowed(event.code)) return { ok: false, error: "invalid" };
  const chord: OperationChord = {
    code: event.code,
    alt: event.altKey,
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
  };
  const other = action === "copy" ? settings.rename : settings.copy;
  const rejection = rejectionForChord(chord, other);
  if (rejection !== null) return { ok: false, error: rejection };
  const next: OperationShortcutSettings = action === "copy"
    ? { ...settings, copy: chord }
    : { ...settings, rename: chord };
  return { ok: true, settings: writeOperationShortcuts(next) };
}

export function clearOperationShortcut(
  settings: OperationShortcutSettings,
  action: OperationShortcutAction,
): OperationShortcutSettings {
  const next: OperationShortcutSettings = action === "copy"
    ? { ...settings, copy: null }
    : { ...settings, rename: null };
  return writeOperationShortcuts(next);
}

/**
 * Library window listener. Returns an action only when the chord is safe to
 * open the existing drawer. It does not plan, prepare, or apply.
 */
export function resolveLibraryOperationShortcut(
  event: ShortcutKeyEvent & { target: EventTarget | null },
  settings: OperationShortcutSettings,
  guards: { blocked: boolean; drawerOpen: boolean },
): OperationShortcutAction | null {
  if (event.repeat) return null;
  if (guards.blocked || guards.drawerOpen) return null;
  if (shouldIgnoreLibraryShortcut(event)) return null;
  const chord: OperationChord = {
    code: event.code,
    alt: event.altKey,
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
  };
  if (!isCodeAllowed(chord.code)) return null;
  if (settings.rename !== null && chordsEqual(chord, settings.rename)) return "rename";
  if (settings.copy !== null && chordsEqual(chord, settings.copy)) return "copy";
  return null;
}
