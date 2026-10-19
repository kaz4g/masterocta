/** Shared ignore rules for Library workspace keyboard shortcuts (M6-08). */

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  return type !== 'button' && type !== 'checkbox' && type !== 'radio' && type !== 'submit' && type !== 'reset'
}

/** Native activation targets that already consume Space (avoid double-firing). */
export function isActivationKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || tag === 'SUMMARY' || tag === 'AUDIO'
}

/**
 * Open overlay dialogs, including Operations Drawer (`role="dialog"`).
 * Closed drawers stay in the tree with `hidden` / `aria-hidden="true"` and must not block.
 */
export function isOpenDialogPresent(root: ParentNode = document): boolean {
  const dialogs = root.querySelectorAll('[role="dialog"]')
  for (const dialog of dialogs) {
    if (dialog instanceof HTMLElement && dialog.hidden) continue
    if (dialog.getAttribute('hidden') !== null) continue
    if (dialog.getAttribute('aria-hidden') === 'true') continue
    return true
  }
  return false
}

export function shouldIgnoreLibraryShortcut(
  event: { target: EventTarget | null },
  options?: { allowWhenEditing?: boolean },
): boolean {
  if (isOpenDialogPresent()) return true
  if (!options?.allowWhenEditing && isEditableKeyboardTarget(event.target)) return true
  return false
}
