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
   * Higher values win when more than one search shortcut can focus.
   * A disabled input yields to the next shortcut. A blocked shortcut still
   * consumes Ctrl/Cmd+F so a lower-priority field does not take focus.
   */
  priority?: number
}

type SearchShortcutOwner = {
  id: number
  priority: number
  isBlocked: () => boolean
  canFocus: () => boolean
}

let nextSearchShortcutOwnerId = 1
const searchShortcutOwners = new Map<number, SearchShortcutOwner>()

function orderedSearchShortcutOwners(): SearchShortcutOwner[] {
  return [...searchShortcutOwners.values()].sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority
    return right.id - left.id
  })
}

/** The owner that handles this Ctrl/Cmd+F, or null when nothing is mounted. */
function resolveFindShortcutOwner(): { id: number; consumeOnly: boolean } | null {
  const owners = orderedSearchShortcutOwners()
  for (const owner of owners) {
    if (owner.isBlocked()) return { id: owner.id, consumeOnly: true }
    if (owner.canFocus()) return { id: owner.id, consumeOnly: false }
  }
  const consumer = owners[0]
  if (consumer === undefined) return null
  return { id: consumer.id, consumeOnly: true }
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
    searchShortcutOwners.set(ownerId, {
      id: ownerId,
      priority,
      isBlocked: () => isBlockedRef.current?.() ?? false,
      canFocus: () => {
        const input = inputRef.current
        return input !== null && !input.disabled && !(isBlockedRef.current?.() ?? false)
      },
    })

    const onKey = (e: KeyboardEvent) => {
      if (isFindShortcut(e)) {
        const decision = resolveFindShortcutOwner()
        if (decision?.id !== ownerId) return
        e.preventDefault()
        if (decision.consumeOnly) return
        const input = inputRef.current
        if (input === null || input.disabled) return
        input.focus()
        input.select()
        return
      }

      const input = inputRef.current
      if (!input) return
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
