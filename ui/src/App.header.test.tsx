/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { HEADER_NARROW_MAX_PX } from './App'
import { sendToHost } from './bridge'
import { __resetFocusSourceForTests } from './lib/focusSource'
import { __resetGridFocusForTests } from './lib/gridFocus'
import { __resetLayerStackForTests } from './lib/layerStack'

vi.mock('./bridge', async () => {
  const actual = await vi.importActual<typeof import('./bridge')>('./bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const sendToHostMock = vi.mocked(sendToHost)

describe('one-row header', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const header = () => host!.querySelector<HTMLElement>('[data-sg-header]')!
  const headerLabels = () =>
    [...header().querySelectorAll<HTMLButtonElement>('button')].map((b) => b.getAttribute('aria-label'))
  const headerButton = (label: string) =>
    [...header().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label)!
  const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
  const menuItems = () => [...(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
  const dialogTitle = () => document.querySelector('[role="dialog"]')?.querySelector('[id]')?.textContent ?? null

  /** A message as the host would post it: same origin, from the parent window. */
  const fromHost = async (data: unknown) => {
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data, origin: window.location.origin, source: window.parent }),
      )
    })
  }

  /** Keydown on the focused element, so it reaches document (focusSource) and window (App). */
  const pressKey = async (key: string) => {
    await act(async () => {
      ;(document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    })
  }
  const pressEscape = () => pressKey('Escape')

  /** Text of every open tooltip (Radix renders the label twice: visible and for assistive tech). */
  const tooltipTexts = () =>
    [...document.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]')].map((el) =>
      el.querySelector('p')?.textContent ?? '',
    )
  const moreTooltipShown = () => tooltipTexts().includes('More')

  /** What a mouse does on its way onto / off a button: React's enter/leave come from over/out. */
  const hover = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
      // Radix opens a hovered tooltip from a timer, even with a 0ms delay.
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
  const unhover = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }))
      el.dispatchEvent(new MouseEvent('pointerleave', { bubbles: false }))
    })
  }

  beforeEach(async () => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    __resetFocusSourceForTests()
    sendToHostMock.mockClear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ backups: [], thumbnails_bytes: 0 }), { status: 200 })),
    )
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<App />)
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetLayerStackForTests()
    __resetFocusSourceForTests()
  })

  it('is a single non-wrapping row', () => {
    expect(header().className).toContain('flex-nowrap')
    expect(header().className).not.toContain('flex-wrap ')
  })

  it.each([
    'Compact mode',
    'Collapse all',
    'Expand all',
    'Clear all selected styles',
    'Backup / Restore',
    'Import/Export',
  ])('has no "%s" button', (label) => {
    expect(headerLabels()).not.toContain(label)
  })

  it('buttons run New style, More, Fullscreen, Close, in that order', () => {
    const labels = headerLabels()
    const at = (label: string) => labels.indexOf(label)
    expect(at('More')).toBeGreaterThan(-1)
    expect(at('More')).toBe(at('Fullscreen') - 1)
    expect(at('Fullscreen')).toBe(at('Close Style Grid') - 1)
    // New style is disabled without a source; its label then explains why.
    expect(at('Select a specific CSV source before creating a style')).toBe(at('More') - 1)
  })

  it('More opens a menu with exactly Import / Export… and Backup & restore…', async () => {
    const more = headerButton('More')
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    expect(more.getAttribute('aria-expanded')).toBe('false')

    await act(async () => more.click())
    expect(menu()).not.toBeNull()
    expect(menuItems().map((el) => el.textContent?.trim())).toEqual(['Import / Export…', 'Backup & restore…'])
    expect(headerButton('More').getAttribute('aria-expanded')).toBe('true')
  })

  it.each([
    [0, 'Import / Export'],
    [1, 'Backup & restore'],
  ])('menu item %i opens the "%s" dialog and closes the menu', async (index, title) => {
    await act(async () => headerButton('More').click())
    await act(async () => menuItems()[index].click())
    expect(menu()).toBeNull()
    expect(dialogTitle()).toBe(title)
  })

  it('Escape closes the menu and returns focus to More', async () => {
    const more = headerButton('More')
    await act(async () => more.click())
    expect(menu()).not.toBeNull()
    expect(menu()!.contains(document.activeElement)).toBe(true)

    await pressEscape()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(headerButton('More'))
    expect(headerButton('More').getAttribute('aria-expanded')).toBe('false')
    // Escape went to the menu, not to the panel.
    expect(sendToHostMock.mock.calls.map(([m]) => m.type)).not.toContain('SG_CLOSE_REQUEST')
  })

  it('the title block names the tab, so it stays available when the badge is hidden', async () => {
    await fromHost({ type: 'SG_INIT', tab: 'img2img', styles: [] })
    const title = header().querySelector<HTMLElement>('[data-sg-header-title]')!
    expect(title.getAttribute('role')).toBe('group')
    expect(title.getAttribute('aria-label')).toContain('img2img')
    expect(title.getAttribute('aria-label')).toBe('Style Grid — img2img')
    expect(title.getAttribute('title')).toBe('Style Grid — img2img')
  })

  it('below HEADER_NARROW_MAX_PX the title text is sr-only and the tab badge is hidden', () => {
    expect(HEADER_NARROW_MAX_PX).toBe(719)
    const variant = `max-[${HEADER_NARROW_MAX_PX}px]:`
    const titleText = header().querySelector('[data-sg-header-title] span')!
    expect(titleText.textContent).toBe('Style Grid')
    expect(titleText.className.split(/\s+/)).toContain(`${variant}sr-only`)
    const badge = header().querySelector('[data-sg-tab-badge]')!
    expect(badge.className.split(/\s+/)).toContain(`${variant}hidden`)
  })
  describe('toolbar tooltips open on hover or Tab focus only', () => {
    it('Escape out of the More menu puts focus back on ⋯ without its tooltip', async () => {
      await act(async () => headerButton('More').click())
      expect(menu()).not.toBeNull()
      await pressEscape()
      expect(menu()).toBeNull()
      expect(document.activeElement).toBe(headerButton('More'))
      expect(moreTooltipShown()).toBe(false)
    })

    it('closing the Import / Export dialog puts focus back on ⋯ without its tooltip', async () => {
      await act(async () => headerButton('More').click())
      await act(async () => menuItems()[0].click())
      expect(dialogTitle()).toBe('Import / Export')
      const close = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (b) => b.textContent === 'Close',
      )!
      await act(async () => close.click())
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(headerButton('More'))
      expect(moreTooltipShown()).toBe(false)
    })

    it('hover shows the tooltip and leaving hides it', async () => {
      const more = headerButton('More')
      await hover(more)
      expect(moreTooltipShown()).toBe(true)
      await unhover(more)
      expect(moreTooltipShown()).toBe(false)
    })

    it('Tab focus shows the tooltip; focus restored after Escape does not', async () => {
      const more = headerButton('More')
      await pressKey('Tab')
      await act(async () => more.focus())
      expect(moreTooltipShown()).toBe(true)

      await act(async () => more.blur())
      expect(moreTooltipShown()).toBe(false)
      await pressKey('Escape')
      await act(async () => more.focus())
      expect(document.activeElement).toBe(more)
      expect(moreTooltipShown()).toBe(false)
    })

    it('while the More menu is open its tooltip never renders', async () => {
      const more = headerButton('More')
      await act(async () => more.click())
      expect(menu()).not.toBeNull()
      await hover(more)
      expect(moreTooltipShown()).toBe(false)
    })
  })
})
