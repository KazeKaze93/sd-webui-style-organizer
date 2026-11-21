/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { __resetGridFocusForTests } from '../lib/gridFocus'
import { dismissAllHoverIntents } from '../lib/hoverIntent'
import { StyleCard } from './StyleCard'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const SHOW_DELAY_MS = 300
const PREVIEW_HINT = 'Right-click for options'

const STYLE: Style = {
  name: 'BODY_Ears',
  source_file: 'webui/a.csv',
  prompt: 'animal ears',
  negative_prompt: '',
  description: '',
  category: 'BODY',
  has_thumbnail: false,
}

function previewOpen(): boolean {
  return document.body.textContent?.includes(PREVIEW_HINT) ?? false
}

describe('style card preview', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  /** jsdom has no pointer: `:hover` is what the test says it is. */
  let hovered = false

  const card = () => host!.querySelector<HTMLElement>('[data-sg-card]')!
  /** ThumbnailPreview container: the element that owns the native listeners. */
  const hoverTarget = () => card().parentElement!

  const enterCard = () => {
    hovered = true
    act(() => {
      hoverTarget().dispatchEvent(new MouseEvent('mouseenter'))
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    __resetGridFocusForTests()
    hovered = false
    const nativeMatches = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      if (selector === ':hover') return hovered
      return nativeMatches.call(this, selector)
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(<StyleCard style={STYLE} />)
    })
  })

  afterEach(() => {
    act(() => {
      dismissAllHoverIntents()
      root?.unmount()
    })
    root = null
    host?.remove()
    host = null
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('opens on hover while the iframe document is not focused', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    enterCard()
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS)
    })
    expect(previewOpen()).toBe(true)
  })

  it('does not open when the card is no longer hovered at fire time', () => {
    enterCard()
    hovered = false
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS * 4)
    })
    expect(previewOpen()).toBe(false)
  })

  it('window blur with a pending show timer produces no preview', () => {
    enterCard()
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS - 1)
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(SHOW_DELAY_MS * 4)
    })
    expect(previewOpen()).toBe(false)
  })

  it('opening the context menu closes a visible preview', () => {
    enterCard()
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS)
    })
    expect(previewOpen()).toBe(true)

    act(() => {
      card().dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
      )
    })
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()
    expect(previewOpen()).toBe(false)
  })

  it('opening the context menu cancels a pending preview', () => {
    enterCard()
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS - 1)
      card().dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
      )
    })
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS * 4)
    })
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()
    expect(previewOpen()).toBe(false)
  })
})
