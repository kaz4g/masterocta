# M6-08 configurable Copy / Rename shortcuts

Work ID: `MO-M6-08-OPERATION-SHORTCUTS-1`

Copy and Rename shortcuts are stored in versioned localStorage
(`masterocta.workspace.operation-shortcuts.v1`), the same pattern as pane
split persistence. Defaults are Alt+Shift+C and Alt+Shift+R. A chord only
opens the existing Operations Drawer. It does not call plan, prepare, apply,
or recover, and the UI does not write the filesystem.

The shortcut is ignored while typing, while a dialog is open, and while
prepare or another operation is in progress. ArrowUp, ArrowDown, Space,
Escape, Enter, and Ctrl/Cmd+F cannot be assigned. Copy and Rename cannot
share one chord. Invalid stored JSON falls back to the defaults.

Closing the drawer cancels chord recording and removes the capture listener.
The editor and the library listener share one in-memory session. If
`localStorage.setItem` throws, that session still uses the new chord; a
restart loads the last value that was actually stored.

Tests:

- `src/features/workspace/operationShortcutStorage.test.tsx`
- `src/features/roots/RootRegistryPanel.workspace.test.tsx` (drawer, text input, no plan/apply)
- `src/features/library/CatalogFileList.test.tsx` (existing Up/Down regression)
- `e2e/library-keyboard.spec.ts` (existing Up/Down, Space, Ctrl+F, plus the copy shortcut)

This does not record M6-06 Native acceptance.
