/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Style } from './bridge'
import { __resetFocusSourceForTests } from './lib/focusSource'
import { __resetGridFocusForTests } from './lib/gridFocus'
import { __resetLayerStackForTests } from './lib/layerStack'
import { useStylesStore } from './store/stylesStore'

vi.mock('./bridge', async () => {
  const actual = await vi.importActual<typeof import('./bridge')>('./bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const STYLE: Style = {
  name: 'BODY_Tall',
  source_file: 'webui/a.csv',
  prompt: 'tall',
  negative_prompt: '',
  description: '',
  category: 'BODY',
}

describe('App keeps thumbnail presence in step with the host', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let listCalls = 0
  let listBody: unknown = { has_thumbnail: [] }

  const fromHost = async (data: unknown) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window.parent }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  const card = () => host!.querySelector<HTMLElement>('[data-sg-card]')
  const tileImg = () => card()?.querySelector('[data-sg-gallery-thumb] img') ?? null
  const tilePlaceholder = () => card()?.querySelector('[data-sg-gallery-placeholder]') ?? null

  beforeEach(async () => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    __resetFocusSourceForTests()
    listCalls = 0
    listBody = { has_thumbnail: [] }
    useStylesStore.setState({ viewMode: 'gallery', thumbKeys: new Set(), thumbKeysLoaded: false, activeCategory: null })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url) === '/style_grid/thumbnails/list') {
          listCalls += 1
          return new Response(JSON.stringify(listBody), { status: 200 })
        }
        return new Response('{}', { status: 200 })
      }),
    )
    // jsdom has no layout: give every element a box so the virtualized grid renders rows.
    for (const [prop, value] of [['offsetHeight', 600], ['offsetWidth', 800], ['clientHeight', 600], ['clientWidth', 800]] as const) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
    }
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
    useStylesStore.setState({ viewMode: 'grid' })
    for (const prop of ['offsetHeight', 'offsetWidth', 'clientHeight', 'clientWidth']) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
    }
  })

  it('SG_INIT and SG_STYLES_UPDATE each reload the thumbnails list', async () => {
    expect(listCalls).toBe(0)
    listBody = { has_thumbnail: [{ name: 'BODY_Tall', source_file: 'webui/a.csv' }] }
    await fromHost({ type: 'SG_INIT', tab: 'txt2img', styles: [STYLE] })
    expect(listCalls).toBe(1)
    expect(useStylesStore.getState().thumbKeys.has('webui/a.csv\0BODY_Tall')).toBe(true)
    expect(tileImg()).not.toBeNull()

    listBody = { has_thumbnail: [] }
    await fromHost({ type: 'SG_STYLES_UPDATE', styles: [STYLE] })
    expect(listCalls).toBe(2)
    expect(useStylesStore.getState().thumbKeys.size).toBe(0)
    expect(tileImg()).toBeNull()
    expect(tilePlaceholder()).not.toBeNull()
  })

  it('a host toast (batch generation finished) reloads the list too', async () => {
    await fromHost({ type: 'SG_INIT', tab: 'txt2img', styles: [STYLE] })
    const before = listCalls
    await fromHost({ type: 'SG_TOAST', message: 'Done: 1/1 generated', variant: 'success' })
    expect(listCalls).toBe(before + 1)
  })

  it('SG_THUMB_DONE adds the key: the tile switches from the placeholder to <img>', async () => {
    await fromHost({ type: 'SG_INIT', tab: 'txt2img', styles: [STYLE] })
    expect(tilePlaceholder()).not.toBeNull()
    expect(tileImg()).toBeNull()
    const callsBefore = listCalls

    await fromHost({ type: 'SG_THUMB_DONE', styleId: 'BODY_Tall', version: 1700000000000, source_file: 'webui/a.csv' })
    expect(useStylesStore.getState().thumbKeys.has('webui/a.csv\0BODY_Tall')).toBe(true)
    expect(listCalls).toBe(callsBefore) // exact local update, no refetch
    expect(tilePlaceholder()).toBeNull()
    expect(tileImg()!.getAttribute('src')).toBe('/style_grid/thumbnail?name=BODY_Tall&source=webui%2Fa.csv&v=1700000000000')
  })
})
