import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { tJa } from "../../i18n/testStrings";
import { LibraryOperationShortcutEditor } from "./LibraryOperationShortcutEditor";
import {
  DEFAULT_OPERATION_SHORTCUTS,
  OPERATION_SHORTCUT_SCHEMA,
  OPERATION_SHORTCUT_STORAGE_KEY,
  clearOperationShortcut,
  formatOperationChord,
  parseOperationShortcuts,
  readOperationShortcuts,
  resetOperationShortcutSession,
  resolveLibraryOperationShortcut,
  tryAssignOperationShortcut,
  type OperationChord,
} from "./operationShortcutStorage";

const copyEvent = {
  code: "KeyC",
  key: "C",
  altKey: true,
  shiftKey: true,
  ctrlKey: false,
  metaKey: false,
};

function keyEvent(
  target: EventTarget | null,
  chord: OperationChord,
  extra?: { repeat?: boolean },
) {
  return {
    target,
    code: chord.code,
    altKey: chord.alt,
    shiftKey: chord.shift,
    ctrlKey: chord.ctrl,
    metaKey: chord.meta,
    repeat: extra?.repeat ?? false,
  };
}

describe("operation shortcut storage", () => {
  beforeEach(() => {
    resetOperationShortcutSession();
    window.localStorage.clear();
  });

  it("defaults to Alt+Shift+C and Alt+Shift+R", () => {
    expect(formatOperationChord(DEFAULT_OPERATION_SHORTCUTS.copy!)).toBe("Alt+Shift+C");
    expect(formatOperationChord(DEFAULT_OPERATION_SHORTCUTS.rename!)).toBe("Alt+Shift+R");
    expect(readOperationShortcuts()).toEqual(DEFAULT_OPERATION_SHORTCUTS);
  });

  it("restores a saved chord after a fresh read", () => {
    window.localStorage.setItem(OPERATION_SHORTCUT_STORAGE_KEY, JSON.stringify({
      schema: OPERATION_SHORTCUT_SCHEMA,
      copy: { code: "Digit1", alt: true, shift: false, ctrl: false, meta: false },
      rename: DEFAULT_OPERATION_SHORTCUTS.rename,
    }));
    expect(readOperationShortcuts().copy).toEqual({
      code: "Digit1",
      alt: true,
      shift: false,
      ctrl: false,
      meta: false,
    });
  });

  it("falls back to defaults for corrupt, wrong-schema, path, reserved, and colliding values", () => {
    expect(parseOperationShortcuts("{not-json").copy?.code).toBe("KeyC");
    expect(parseOperationShortcuts(JSON.stringify({ schema: "other", copy: null, rename: null })).copy?.code).toBe("KeyC");
    expect(parseOperationShortcuts(JSON.stringify({
      schema: OPERATION_SHORTCUT_SCHEMA,
      copy: { code: "/tmp/secret", alt: true, shift: false, ctrl: false, meta: false },
      rename: null,
    })).copy?.code).toBe("KeyC");
    expect(parseOperationShortcuts(JSON.stringify({
      schema: OPERATION_SHORTCUT_SCHEMA,
      copy: { code: "KeyF", alt: false, shift: false, ctrl: true, meta: false },
      rename: null,
    })).copy?.code).toBe("KeyC");
    expect(parseOperationShortcuts(JSON.stringify({
      schema: OPERATION_SHORTCUT_SCHEMA,
      copy: { code: "ArrowDown", alt: true, shift: false, ctrl: false, meta: false },
      rename: null,
    })).copy?.code).toBe("KeyC");
    const same = { code: "KeyC", alt: true, shift: true, ctrl: false, meta: false };
    expect(parseOperationShortcuts(JSON.stringify({
      schema: OPERATION_SHORTCUT_SCHEMA,
      copy: same,
      rename: same,
    })).rename?.code).toBe("KeyR");
  });

  it("does not treat library keys or text input or an open drawer as an operation", () => {
    const button = document.createElement("button");
    const input = document.createElement("input");
    const settings = DEFAULT_OPERATION_SHORTCUTS;
    expect(resolveLibraryOperationShortcut(keyEvent(button, settings.copy!), settings, {
      blocked: false,
      drawerOpen: false,
    })).toBe("copy");
    expect(resolveLibraryOperationShortcut(keyEvent(input, settings.copy!), settings, {
      blocked: false,
      drawerOpen: false,
    })).toBeNull();
    expect(resolveLibraryOperationShortcut(keyEvent(button, settings.rename!), settings, {
      blocked: true,
      drawerOpen: false,
    })).toBeNull();
    expect(resolveLibraryOperationShortcut(keyEvent(button, settings.copy!), settings, {
      blocked: false,
      drawerOpen: true,
    })).toBeNull();
    expect(resolveLibraryOperationShortcut(keyEvent(button, {
      code: "ArrowDown",
      alt: false,
      shift: false,
      ctrl: false,
      meta: false,
    }), settings, { blocked: false, drawerOpen: false })).toBeNull();
    expect(resolveLibraryOperationShortcut(keyEvent(button, {
      code: "Space",
      alt: false,
      shift: false,
      ctrl: false,
      meta: false,
    }), settings, { blocked: false, drawerOpen: false })).toBeNull();
    expect(resolveLibraryOperationShortcut(keyEvent(button, {
      code: "KeyF",
      alt: false,
      shift: false,
      ctrl: true,
      meta: false,
    }), settings, { blocked: false, drawerOpen: false })).toBeNull();
    expect(resolveLibraryOperationShortcut({
      ...keyEvent(button, settings.copy!),
      repeat: true,
    }, settings, { blocked: false, drawerOpen: false })).toBeNull();
  });

  it("keeps the session chord when localStorage.setItem throws", () => {
    const stored = JSON.stringify({
      schema: OPERATION_SHORTCUT_SCHEMA,
      copy: DEFAULT_OPERATION_SHORTCUTS.copy,
      rename: DEFAULT_OPERATION_SHORTCUTS.rename,
    });
    window.localStorage.setItem(OPERATION_SHORTCUT_STORAGE_KEY, stored);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota");
    });
    try {
      const assigned = tryAssignOperationShortcut(readOperationShortcuts(), "copy", {
        code: "Digit1",
        key: "1",
        altKey: true,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      expect(assigned.ok).toBe(true);
      const active = readOperationShortcuts();
      expect(active.copy).toEqual({
        code: "Digit1",
        alt: true,
        shift: false,
        ctrl: false,
        meta: false,
      });
      const button = document.createElement("button");
      expect(resolveLibraryOperationShortcut(
        keyEvent(button, active.copy!),
        active,
        { blocked: false, drawerOpen: false },
      )).toBe("copy");
      expect(resolveLibraryOperationShortcut(
        keyEvent(button, DEFAULT_OPERATION_SHORTCUTS.copy!),
        active,
        { blocked: false, drawerOpen: false },
      )).toBeNull();
      expect(window.localStorage.getItem(OPERATION_SHORTCUT_STORAGE_KEY)).toBe(stored);

      const cleared = clearOperationShortcut(active, "copy");
      expect(cleared.copy).toBeNull();
      expect(readOperationShortcuts().copy).toBeNull();
      expect(resolveLibraryOperationShortcut(
        keyEvent(button, DEFAULT_OPERATION_SHORTCUTS.copy!),
        readOperationShortcuts(),
        { blocked: false, drawerOpen: false },
      )).toBeNull();
      expect(window.localStorage.getItem(OPERATION_SHORTCUT_STORAGE_KEY)).toBe(stored);
    } finally {
      setItem.mockRestore();
    }
  });
});

describe("LibraryOperationShortcutEditor", () => {
  beforeEach(() => {
    resetOperationShortcutSession();
    window.localStorage.clear();
  });

  function editor(open: boolean) {
    return (
      <LocaleProvider initialLocaleId="ja">
        <LibraryOperationShortcutEditor open={open} />
      </LocaleProvider>
    );
  }

  function renderEditor(open = true) {
    return render(editor(open));
  }

  it("changes a shortcut and keeps it after remount", () => {
    const view = renderEditor();
    expect(screen.getByTestId("operation-shortcut-copy")).toHaveTextContent("Alt+Shift+C");
    fireEvent.click(screen.getByRole("button", { name: tJa("operations.shortcutRecordCopy") }));
    fireEvent.keyDown(window, {
      code: "Digit1",
      key: "1",
      altKey: true,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    expect(screen.getByTestId("operation-shortcut-copy")).toHaveTextContent("Alt+1");
    view.unmount();
    renderEditor();
    expect(screen.getByTestId("operation-shortcut-copy")).toHaveTextContent("Alt+1");
    expect(screen.getByTestId("operation-shortcut-rename")).toHaveTextContent("Alt+Shift+R");
  });

  it("rejects reserved, unmodified, and colliding chords without saving them", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: tJa("operations.shortcutRecordCopy") }));
    fireEvent.keyDown(window, { ...copyEvent, code: "KeyF", key: "f", altKey: false, ctrlKey: true, shiftKey: false });
    expect(screen.getByRole("alert")).toHaveTextContent(tJa("operations.shortcutReserved"));
    expect(screen.getByTestId("operation-shortcut-copy")).toHaveTextContent("Alt+Shift+C");

    fireEvent.keyDown(window, { code: "KeyC", key: "c", altKey: false, shiftKey: false, ctrlKey: false, metaKey: false });
    expect(screen.getByRole("alert")).toHaveTextContent(tJa("operations.shortcutNeedsModifier"));

    fireEvent.keyDown(window, { code: "KeyR", key: "R", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false });
    expect(screen.getByRole("alert")).toHaveTextContent(tJa("operations.shortcutConflict"));
    expect(readOperationShortcuts().copy?.code).toBe("KeyC");
    expect(readOperationShortcuts().rename?.code).toBe("KeyR");
  });

  it("stops recording when the drawer closes", () => {
    const view = renderEditor(true);
    fireEvent.click(screen.getByRole("button", { name: tJa("operations.shortcutRecordCopy") }));
    expect(screen.getByRole("button", { name: tJa("operations.shortcutRecording"), pressed: true })).toBeTruthy();
    view.rerender(editor(false));
    const event = new KeyboardEvent("keydown", {
      code: "Digit1",
      key: "1",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByTestId("operation-shortcut-copy")).toHaveTextContent("Alt+Shift+C");
    expect(readOperationShortcuts().copy?.code).toBe("KeyC");
    view.rerender(editor(true));
    expect(screen.getByRole("button", { name: tJa("operations.shortcutRecordCopy"), pressed: false })).toBeTruthy();
  });
});
