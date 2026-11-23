/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { isFocusVisible } from './isFocusVisible'

describe('isFocusVisible', () => {
  it('follows :focus-visible', () => {
    const el = document.createElement('button')
    vi.spyOn(el, 'matches').mockImplementation((sel: string) => sel === ':focus-visible')
    expect(isFocusVisible(el)).toBe(true)
    expect(el.matches).toHaveBeenCalledWith(':focus-visible')
  })

  it('false when the element does not match', () => {
    const el = document.createElement('button')
    vi.spyOn(el, 'matches').mockReturnValue(false)
    expect(isFocusVisible(el)).toBe(false)
  })

  it('false where the selector is unsupported', () => {
    const el = document.createElement('button')
    vi.spyOn(el, 'matches').mockImplementation(() => {
      throw new SyntaxError('unsupported selector')
    })
    expect(isFocusVisible(el)).toBe(false)
  })
})
