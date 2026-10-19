import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { WORKSPACE_SEARCH_SHORTCUT_PRIORITY, useSearchShortcut } from './useSearchShortcut'

function Harness({ onClear }: { onClear: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useSearchShortcut(ref, onClear)
  return (
    <div>
      <input ref={ref} aria-label="Search" defaultValue="" />
      <button>elsewhere</button>
    </div>
  )
}

describe('useSearchShortcut', () => {
  let onClear: Mock<() => void>

  beforeEach(() => {
    onClear = vi.fn<() => void>()
  })

  it('focuses and selects the input on Ctrl+F', () => {
    render(<Harness onClear={onClear} />)
    const input = screen.getByLabelText('Search') as HTMLInputElement
    input.value = 'existing'

    fireEvent.keyDown(document, { key: 'f', ctrlKey: true })

    expect(document.activeElement).toBe(input)
    // Selected, so the next keystroke replaces rather than appends.
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('existing'.length)
  })

  it('focuses the input on Cmd+F', () => {
    render(<Harness onClear={onClear} />)
    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    expect(document.activeElement).toBe(screen.getByLabelText('Search'))
  })

  it('prevents the default so the webview find bar does not also open', () => {
    render(<Harness onClear={onClear} />)
    const notPrevented = fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    // fireEvent returns false when preventDefault was called.
    expect(notPrevented).toBe(false)
  })

  it('ignores a bare f with no modifier', () => {
    render(<Harness onClear={onClear} />)
    fireEvent.keyDown(document, { key: 'f' })
    expect(document.activeElement).not.toBe(screen.getByLabelText('Search'))
  })

  it('clears and keeps focus on Escape when the input has text', () => {
    render(<Harness onClear={onClear} />)
    const input = screen.getByLabelText('Search') as HTMLInputElement
    input.value = 'kick'
    input.focus()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClear).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(input)
  })

  it('blurs on Escape when the input is already empty', () => {
    render(<Harness onClear={onClear} />)
    const input = screen.getByLabelText('Search') as HTMLInputElement
    input.focus()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClear).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(input)
  })

  // This is what keeps Escape-to-leave-project and Escape-to-deselect working.
  it('ignores Escape when the input is not focused', () => {
    render(<Harness onClear={onClear} />)
    const input = screen.getByLabelText('Search') as HTMLInputElement
    input.value = 'kick'
    screen.getByRole('button').focus()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClear).not.toHaveBeenCalled()
  })

  it('does not focus when isBlocked returns true', () => {
    function BlockedHarness() {
      const ref = useRef<HTMLInputElement>(null)
      useSearchShortcut(ref, onClear, { isBlocked: () => true })
      return <input ref={ref} aria-label="Search" />
    }
    render(<BlockedHarness />)
    const notPrevented = fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    expect(notPrevented).toBe(false)
    expect(document.activeElement).not.toBe(screen.getByLabelText('Search'))
  })

  it('does not focus a disabled search input', () => {
    function DisabledHarness() {
      const ref = useRef<HTMLInputElement>(null)
      useSearchShortcut(ref, onClear)
      return <input ref={ref} aria-label="Search" disabled />
    }
    render(<DisabledHarness />)
    const notPrevented = fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    expect(notPrevented).toBe(false)
    expect(document.activeElement).not.toBe(screen.getByLabelText('Search'))
  })

  it('keeps focus on the higher-priority search when a page search is also mounted', () => {
    function CollidingHarness() {
      const pageRef = useRef<HTMLInputElement>(null)
      const workspaceRef = useRef<HTMLInputElement>(null)
      useSearchShortcut(pageRef, onClear)
      useSearchShortcut(workspaceRef, onClear, { priority: WORKSPACE_SEARCH_SHORTCUT_PRIORITY })
      return (
        <div>
          <input ref={pageRef} aria-label="Project search" />
          <input ref={workspaceRef} aria-label="Library search" />
        </div>
      )
    }
    render(<CollidingHarness />)
    const library = screen.getByLabelText('Library search')
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    expect(document.activeElement).toBe(library)
    expect(document.activeElement).not.toBe(screen.getByLabelText('Project search'))
  })

  it('yields Ctrl+F to the page search when the higher-priority input is disabled', () => {
    function DisabledWorkspaceHarness() {
      const pageRef = useRef<HTMLInputElement>(null)
      const workspaceRef = useRef<HTMLInputElement>(null)
      useSearchShortcut(pageRef, onClear)
      useSearchShortcut(workspaceRef, onClear, { priority: WORKSPACE_SEARCH_SHORTCUT_PRIORITY })
      return (
        <div>
          <input ref={pageRef} aria-label="Project search" />
          <input ref={workspaceRef} aria-label="Library search" disabled />
        </div>
      )
    }
    render(<DisabledWorkspaceHarness />)
    const notPrevented = fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    expect(notPrevented).toBe(false)
    expect(document.activeElement).toBe(screen.getByLabelText('Project search'))
  })

  it('does not let the page search take Ctrl+F while the workspace shortcut is blocked', () => {
    function BlockedWorkspaceHarness() {
      const pageRef = useRef<HTMLInputElement>(null)
      const workspaceRef = useRef<HTMLInputElement>(null)
      useSearchShortcut(pageRef, onClear)
      useSearchShortcut(workspaceRef, onClear, {
        priority: WORKSPACE_SEARCH_SHORTCUT_PRIORITY,
        isBlocked: () => true,
      })
      return (
        <div>
          <input ref={pageRef} aria-label="Project search" />
          <input ref={workspaceRef} aria-label="Library search" />
        </div>
      )
    }
    render(<BlockedWorkspaceHarness />)
    const notPrevented = fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    expect(notPrevented).toBe(false)
    expect(document.activeElement).not.toBe(screen.getByLabelText('Library search'))
    expect(document.activeElement).not.toBe(screen.getByLabelText('Project search'))
  })

  it('removes its listener on unmount', () => {
    const { unmount } = render(<Harness onClear={onClear} />)
    unmount()
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    // No input mounted; nothing to assert beyond "this did not throw".
    expect(onClear).not.toHaveBeenCalled()
  })
})
