/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { __resetFocusSourceForTests } from './lib/focusSource'
import { __resetGridFocusForTests } from './lib/gridFocus'
import { __resetLayerStackForTests } from './lib/layerStack'
import { useStylesStore } from './store/stylesStore'

vi.mock('./bridge', async () => {
  const actual = await vi.importActual<typeof import('./bridge')>('./bridge')
  return { ...actual, sendToHost: vi.fn() }
})

describe('empty states fill the visible grid area', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const fromHost = async (data: unknown) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window.parent }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  const gridHost = () => host!.querySelector<HTMLElement>('[data-sg-grid-host]')!

  beforeEach(async () => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    __resetFocusSourceForTests()
    useStylesStore.setState({ viewMode: 'grid', activeCategory: null, search: '', activeSource: null, presets: {} })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
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
    __resetLayerStackForTests()
    __resetFocusSourceForTests()
    useStylesStore.setState({ activeCategory: null, search: '' })
  })

  it('the grid host is a full-height flex column inside the scroller; the empty state is its growing child', async () => {
    await fromHost({ type: 'SG_INIT', tab: 'txt2img', styles: [] })
    const h = gridHost()
    for (const cls of ['min-h-full', 'flex', 'flex-col', 'pt-3']) expect(h.classList.contains(cls)).toBe(true)
    const empty = h.querySelector<HTMLElement>('[data-sg-empty="no-styles"]')!
    expect(empty.parentElement).toBe(h)
    for (const cls of ['flex-1', 'min-h-[220px]', 'justify-center', 'items-center']) {
      expect(empty.classList.contains(cls)).toBe(true)
    }
  })

  it('the presets no-match state is a growing child of the same host', async () => {
    useStylesStore.setState({ presets: { Alpha: { styles: [], created: '2026-01-01' } }, activeCategory: 'presets', search: 'zzz' })
    await fromHost({ type: 'SG_STYLES_UPDATE', styles: [] })
    useStylesStore.setState({ presets: { Alpha: { styles: [], created: '2026-01-01' } }, activeCategory: 'presets', search: 'zzz' })
    await act(async () => {})
    const empty = gridHost().querySelector<HTMLElement>('[data-sg-empty="no-preset-matches"]')!
    expect(empty.parentElement).toBe(gridHost())
    expect(empty.classList.contains('flex-1')).toBe(true)
  })
})
