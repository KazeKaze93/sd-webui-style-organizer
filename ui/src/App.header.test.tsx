/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { HEADER_NARROW_MAX_PX } from './App'
import { sendToHost } from './bridge'
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

  const pressEscape = async () => {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
  }

  beforeEach(async () => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
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
})
