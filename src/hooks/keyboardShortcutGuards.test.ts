import { afterEach, describe, expect, it } from 'vitest'
import {
  isActivationKeyboardTarget,
  isEditableKeyboardTarget,
  isOpenDialogPresent,
  shouldIgnoreLibraryShortcut,
} from './keyboardShortcutGuards'

function keyEvent(target: EventTarget | null): KeyboardEvent {
  return { target } as KeyboardEvent
}

describe('keyboardShortcutGuards', () => {
  afterEach(() => {
    document.querySelectorAll('[role="dialog"]').forEach((node) => node.remove())
  })

  it('treats text inputs as editable and buttons as activation targets', () => {
    const text = document.createElement('input')
    text.type = 'text'
    const search = document.createElement('input')
    search.type = 'search'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    const button = document.createElement('button')
    const audio = document.createElement('audio')

    expect(isEditableKeyboardTarget(text)).toBe(true)
    expect(isEditableKeyboardTarget(search)).toBe(true)
    expect(isEditableKeyboardTarget(checkbox)).toBe(false)
    expect(isEditableKeyboardTarget(button)).toBe(false)
    expect(isActivationKeyboardTarget(button)).toBe(true)
    expect(isActivationKeyboardTarget(audio)).toBe(true)
    expect(isActivationKeyboardTarget(text)).toBe(false)
  })

  it('ignores closed dialogs and detects an open Operations Drawer', () => {
    const closed = document.createElement('div')
    closed.setAttribute('role', 'dialog')
    closed.setAttribute('aria-hidden', 'true')
    closed.hidden = true
    document.body.append(closed)
    expect(isOpenDialogPresent()).toBe(false)

    const open = document.createElement('div')
    open.setAttribute('role', 'dialog')
    open.setAttribute('aria-modal', 'true')
    document.body.append(open)
    expect(isOpenDialogPresent()).toBe(true)

    closed.remove()
    open.remove()
  })

  it('blocks library shortcuts while typing unless allowWhenEditing is set', () => {
    const input = document.createElement('input')
    input.type = 'text'
    expect(shouldIgnoreLibraryShortcut(keyEvent(input))).toBe(true)
    expect(shouldIgnoreLibraryShortcut(keyEvent(input), { allowWhenEditing: true })).toBe(false)

    const button = document.createElement('button')
    expect(shouldIgnoreLibraryShortcut(keyEvent(button))).toBe(false)
  })
})
