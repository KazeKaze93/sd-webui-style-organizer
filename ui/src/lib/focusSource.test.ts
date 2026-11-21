/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetFocusSourceForTests, installFocusSourceTracking, isTabFocus } from './focusSource'

const key = (k: string) =>
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const pointerDown = () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))

describe('focusSource', () => {
  beforeEach(() => __resetFocusSourceForTests())
  afterEach(() => __resetFocusSourceForTests())

  it('Tab sets the flag; Escape and any other key clear it', () => {
    installFocusSourceTracking()
    expect(isTabFocus()).toBe(false)
    key('Tab')
    expect(isTabFocus()).toBe(true)
    key('Escape')
    expect(isTabFocus()).toBe(false)
    key('Tab')
    key('a')
    expect(isTabFocus()).toBe(false)
  })

  it('a pointerdown clears the flag', () => {
    installFocusSourceTracking()
    key('Tab')
    pointerDown()
    expect(isTabFocus()).toBe(false)
  })

  it('install is idempotent and returns the same cleanup', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const first = installFocusSourceTracking()
    const second = installFocusSourceTracking()
    expect(second).toBe(first)
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1)
    expect(add.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1)
    add.mockRestore()
  })

  it('cleanup removes the listeners', () => {
    const cleanup = installFocusSourceTracking()
    cleanup()
    key('Tab')
    expect(isTabFocus()).toBe(false)
    // After cleanup a new install works again.
    installFocusSourceTracking()
    key('Tab')
    expect(isTabFocus()).toBe(true)
  })
})
