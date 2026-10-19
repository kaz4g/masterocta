import { useEffect, useRef } from 'react'

/** Library workspace search outranks page-level search on the same route. */
export const WORKSPACE_SEARCH_SHORTCUT_PRIORITY = 1

export interface SearchShortcutOptions {
  /**
   * When this returns true, Ctrl/Cmd+F is still consumed so the webview find
   * bar stays closed, but the input is not focused. Escape is ignored.
   * Held in a ref so callers need not memoise.
   */
  isBlocked?: () => boolean
  /**
   * Higher values win when more than one search shortcut is mounted.
   * The winner consumes Ctrl/Cmd+F; lower-priority listeners do not focus.
   */
  priority?: number
}

let nextSearchShortcutOwnerId = 1
const searchShortcutOwners = new Map<number, number>()

function winningSearchShortcutOwner(): number | null {
  let winner: number | null = null
  let priority = Number.NEGATIVE_INFINITY
  for (const [id, ownerPriority] of searchShortcutOwners) {
    if (
      ownerPriority > priority
      || (ownerPriority === priority && (winner === null || id > winner))
    ) {
      priority = ownerPriority
      winner = id
    }
  }
  return winner
}

function isFindShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && (event.key === 'f' || event.key === 'F')
}

/**
 * Ctrl/Cmd+F focuses a search input; Escape clears it, then blurs.
 *
 * The preventDefault on Ctrl+F is load-bearing rather than cosmetic: WebKitGTK and
 * WebView2 both bind Ctrl+F to a native find bar that would otherwise open over the app.
 *
 * Escape only acts while `inputRef` holds focus, so the page-level Escape handlers
 * (deselect on the Home page, leave-project on ProjectDetail) keep working. Those
 * handlers already bail when an INPUT is focused, so nothing double-fires.
 *
 * Library workspace (M6-08) uses this same binding — not v0.1 Cmd+K — so Home /
 * Audio Pool / Sample Slots stay consistent and the webview find bar stays suppressed.
 */
export function useSearchShortcut(
  inputRef: React.RefObject<HTMLInputElement | null>,
  onClear: () => void,
  options?: SearchShortcutOptions,
): void {
  // Held in a ref so callers do not have to memoise onClear to avoid resubscribing.
  const onClearRef = useRef(onClear)
  onClearRef.current = onClear
  const isBlockedRef = useRef(options?.isBlocked)
  isBlockedRef.current = options?.isBlocked
  const priority = options?.priority ?? 0

  useEffect(() => {
    const ownerId = nextSearchShortcutOwnerId
    nextSearchShortcutOwnerId += 1
    searchShortcutOwners.set(ownerId, priority)

    const onKey = (e: KeyboardEvent) => {
      const input = inputRef.current
      if (!input) return

      if (isFindShortcut(e)) {
        if (winningSearchShortcutOwner() !== ownerId) return
        e.preventDefault()
        if (isBlockedRef.current?.()) return
        if (input.disabled) return
        input.focus()
        input.select()
        return
      }

      if (isBlockedRef.current?.()) return

      if (e.key === 'Escape' && document.activeElement === input) {
        if (input.value) onClearRef.current()
        else input.blur()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      searchShortcutOwners.delete(ownerId)
      document.removeEventListener('keydown', onKey)
    }
  }, [inputRef, priority])
}
