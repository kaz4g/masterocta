import { useEffect, useState } from "react";
import { useTranslate } from "../../i18n";
import {
  clearOperationShortcut,
  formatOperationChord,
  readOperationShortcuts,
  tryAssignOperationShortcut,
  type OperationShortcutAction,
  type OperationShortcutSettings,
  type ShortcutAssignError,
} from "./operationShortcutStorage";

function errorKey(error: ShortcutAssignError): "operations.shortcutInvalid"
  | "operations.shortcutNeedsModifier"
  | "operations.shortcutReserved"
  | "operations.shortcutConflict" {
  switch (error) {
    case "needsModifier":
      return "operations.shortcutNeedsModifier";
    case "reserved":
      return "operations.shortcutReserved";
    case "conflict":
      return "operations.shortcutConflict";
    case "invalid":
      return "operations.shortcutInvalid";
  }
}

export function LibraryOperationShortcutEditor({ open }: { open: boolean }) {
  const t = useTranslate();
  const [settings, setSettings] = useState<OperationShortcutSettings>(() => readOperationShortcuts());
  const [recording, setRecording] = useState<OperationShortcutAction | null>(null);
  const [error, setError] = useState<ShortcutAssignError | null>(null);

  useEffect(() => {
    if (open) return;
    setRecording(null);
  }, [open]);

  useEffect(() => {
    if (!open || recording === null) return undefined;
    const action = recording;
    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape" || event.code === "Escape") {
        setRecording(null);
        return;
      }
      const result = tryAssignOperationShortcut(settings, action, event);
      if (!result.ok) {
        if (result.error === "invalid" && (event.key === "Alt" || event.key === "Shift" || event.key === "Control" || event.key === "Meta")) {
          return;
        }
        setError(result.error);
        return;
      }
      setSettings(result.settings);
      setError(null);
      setRecording(null);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, recording, settings]);

  function chordLabel(action: OperationShortcutAction): string {
    const chord = settings[action];
    return chord === null ? t("operations.shortcutUnbound") : formatOperationChord(chord);
  }

  function row(action: OperationShortcutAction, label: string, recordLabel: string, clearLabel: string) {
    return (
      <div className="mo-operation-shortcuts__row">
        <span className="mo-operation-shortcuts__label">{label}</span>
        <code className="mo-operation-shortcuts__chord" data-testid={`operation-shortcut-${action}`}>
          {chordLabel(action)}
        </code>
        <button
          type="button"
          aria-pressed={recording === action}
          onClick={() => {
            setError(null);
            setRecording(action);
          }}
        >
          {recording === action ? t("operations.shortcutRecording") : recordLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            setSettings(clearOperationShortcut(settings, action));
            setRecording(null);
            setError(null);
          }}
        >
          {clearLabel}
        </button>
      </div>
    );
  }

  return (
    <section className="mo-operation-shortcuts" aria-labelledby="operation-shortcut-heading">
      <h3 id="operation-shortcut-heading">{t("operations.shortcutHeading")}</h3>
      <p>{t("operations.shortcutHelp")}</p>
      {row(
        "copy",
        t("operations.shortcutCopy"),
        t("operations.shortcutRecordCopy"),
        t("operations.shortcutClearCopy"),
      )}
      {row(
        "rename",
        t("operations.shortcutRename"),
        t("operations.shortcutRecordRename"),
        t("operations.shortcutClearRename"),
      )}
      {error !== null && (
        <p role="alert">{t(errorKey(error))}</p>
      )}
    </section>
  );
}
