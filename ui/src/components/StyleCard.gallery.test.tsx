/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { __resetGridFocusForTests } from '../lib/gridFocus'
import { dismissAllHoverIntents } from '../lib/hoverIntent'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { LORA_SOURCE, styleRowKey, useStylesStore } from '../store/stylesStore'
import { GALLERY_LABEL_HEIGHT_PX } from './grid/constants'
import { StyleCard } from './StyleCard'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const CARD_H = 146 + GALLERY_LABEL_HEIGHT_PX

function style(overrides: Partial<Style> = {}): Style {
  return {
    name: 'BODY_Tall_Amazon',
    source_file: 'webui/a.csv',
    prompt: 'tall',
    negative_prompt: '',
    description: '',
    category: 'BODY',
    ...overrides,
  }
}

const LORA = style({ name: 'detail_tweaker', source_file: LORA_SOURCE, category: 'LoRA' })

describe('StyleCard in gallery', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const card = () => host!.querySelector<HTMLButtonElement>('[data-sg-card]')!
  const thumb = () => card().querySelector<HTMLElement>('[data-sg-gallery-thumb]')!
  const img = () => thumb().querySelector<HTMLImageElement>('img')
  const placeholder = () => thumb().querySelector<HTMLElement>('[data-sg-gallery-placeholder]')
  const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
  const menuTexts = () => [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].map((el) => el.textContent?.trim())

  function setStore(
    styles: Style[],
    thumbs: Style[] = [],
    extra: Partial<ReturnType<typeof useStylesStore.getState>> = {},
  ) {
    const byName = new Map<string, Style[]>()
    for (const s of styles) byName.set(s.name, [...(byName.get(s.name) ?? []), s])
    useStylesStore.setState({
      styles,
      duplicatesByName: byName,
      selectedStyles: [],
      selectedKeySet: new Set(),
      favorites: new Set(),
      activeSource: null,
      thumbVersions: {},
      thumbKeys: new Set(thumbs.map(styleRowKey)),
      thumbKeysLoaded: true,
      ...extra,
    })
  }

  async function render(s: Style) {
    await act(async () => {
      root!.render(<StyleCard style={s} viewMode="gallery" galleryCardHeightPx={CARD_H} cellRow={0} cellCol={0} tabIndex={0} />)
    })
  }

  const openMenu = async () => {
    await act(async () => {
      card().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))
    })
  }

  beforeEach(() => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      dismissAllHoverIntents()
      root?.unmount()
    })
    root = null
    host?.remove()
    host = null
    __resetLayerStackForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps the card button contract and takes the gallery card height', async () => {
    const s = style()
    setStore([s], [s])
    await render(s)
    const b = card()
    expect(b.getAttribute('data-cell-row')).toBe('0')
    expect(b.getAttribute('data-cell-col')).toBe('0')
    expect(b.tabIndex).toBe(0)
    expect(b.getAttribute('aria-pressed')).toBe('false')
    expect(b.getAttribute('aria-label')).toBe('Tall Amazon')
    expect(b.style.height).toBe(`${CARD_H}px`)
    expect(card().querySelector('[data-sg-gallery-label]')!.textContent).toBe('Tall Amazon')
  })

  it('renders <img> when the style key is in thumbKeys', async () => {
    const s = style()
    setStore([s], [s])
    await render(s)
    expect(img()).not.toBeNull()
    expect(img()!.getAttribute('src')).toBe('/style_grid/thumbnail?name=BODY_Tall_Amazon&source=webui%2Fa.csv&v=1')
    expect(img()!.getAttribute('alt')).toBe('')
    expect(img()!.getAttribute('loading')).toBe('lazy')
    expect(img()!.getAttribute('decoding')).toBe('async')
    expect(placeholder()).toBeNull()
  })

  it('shows the placeholder and requests no image when the key is not in thumbKeys', async () => {
    const s = style()
    const other = style({ source_file: 'webui/b.csv' })
    setStore([s, other], [other]) // same name, other source: not this style's thumbnail
    await render(s)
    expect(img()).toBeNull()
    expect(placeholder()!.textContent).toBe('No preview')
  })

  it('a failed image shows the placeholder; a new thumb version retries the image', async () => {
    const s = style()
    setStore([s], [s])
    await render(s)
    await act(async () => {
      img()!.dispatchEvent(new Event('error'))
    })
    expect(img()).toBeNull()
    expect(placeholder()).not.toBeNull()

    await act(async () => {
      useStylesStore.getState().bumpThumbVersion(styleRowKey(s), '42')
    })
    expect(placeholder()).toBeNull()
    expect(img()!.getAttribute('src')).toBe('/style_grid/thumbnail?name=BODY_Tall_Amazon&source=webui%2Fa.csv&v=42')
  })

  it('LoRA rows try the model preview optimistically and fall back on error', async () => {
    setStore([LORA]) // LoRA previews are never in thumbKeys
    await render(LORA)
    expect(img()).not.toBeNull()
    expect(img()!.getAttribute('src')).toBe(
      `/style_grid/thumbnail?name=detail_tweaker&source=${encodeURIComponent(LORA_SOURCE)}&v=1`,
    )
    await act(async () => {
      img()!.dispatchEvent(new Event('error'))
    })
    expect(img()).toBeNull()
    expect(placeholder()).not.toBeNull()
  })

  it('"Remove preview" is offered only when the key is in thumbKeys, never for LoRA', async () => {
    const s = style()
    setStore([s], [s])
    await render(s)
    await openMenu()
    expect(menuTexts()).toContain('Remove preview')

    act(() => root!.render(<></>))
    __resetLayerStackForTests()
    setStore([s], [])
    await render(s)
    await openMenu()
    expect(menuTexts()).not.toContain('Remove preview')

    act(() => root!.render(<></>))
    __resetLayerStackForTests()
    setStore([LORA])
    await render(LORA)
    await openMenu()
    expect(menuTexts()).not.toContain('Remove preview')
  })

  it('after a successful remove the tile switches to the placeholder without refetching the list', async () => {
    const s = style()
    setStore([s], [s])
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${String(url)}`)
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )
    await render(s)
    expect(img()).not.toBeNull()
    await openMenu()
    const remove = [...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === 'Remove preview',
    )!
    await act(async () => {
      remove.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(calls).toEqual(['DELETE /style_grid/thumbnail?name=BODY_Tall_Amazon&source=webui%2Fa.csv'])
    expect(useStylesStore.getState().thumbKeys.has(styleRowKey(s))).toBe(false)
    expect(img()).toBeNull()
    expect(placeholder()).not.toBeNull()
  })

  it('selected: accent border, the small accent dot over the thumbnail, no check badge', async () => {
    const s = style()
    setStore([s], [s], { selectedStyles: [s], selectedKeySet: new Set([styleRowKey(s)]) })
    await render(s)
    expect(card().getAttribute('aria-pressed')).toBe('true')
    expect(card().className).toContain('border-sg-accent')
    expect(card().className).toContain('bg-sg-accent/10')
    const dot = thumb().querySelector<HTMLElement>('.rounded-full.bg-sg-accent')!
    expect(dot.className).toContain('h-1.5')
    expect(dot.className).toContain('bottom-2')
    expect(dot.className).toContain('right-2')
    expect(card().querySelector('svg.lucide-circle-check, svg.lucide-check-circle, svg.lucide-check')).toBeNull()
    // The category strip hides while selected, as in the grid.
    expect(card().querySelector('.w-\\[3px\\]')).toBeNull()
  })

  it('favorite: the grid star, top-right over the thumbnail; category strip when not selected', async () => {
    const s = style()
    setStore([s], [s], { favorites: new Set([styleRowKey(s)]) })
    await render(s)
    const star = thumb().querySelector('svg.text-sg-warning-text')!
    expect(star.getAttribute('class')).toContain('top-1.5')
    expect(star.getAttribute('class')).toContain('right-1.5')
    expect(card().getAttribute('aria-label')).toBe('Tall Amazon favorite')
    expect(card().querySelector('.w-\\[3px\\]')).not.toBeNull()
  })

  it('right-click opens the style menu', async () => {
    const s = style()
    setStore([s])
    await render(s)
    await openMenu()
    expect(menu()).not.toBeNull()
    expect(menu()!.textContent).toContain('Copy prompt')
  })

  it('click without an active source on a multi-source style opens the source picker', async () => {
    const a = style()
    const b = style({ source_file: 'webui/b.csv' })
    setStore([a, b])
    await render(a)
    await act(async () => card().click())
    expect(menu()).not.toBeNull()
    expect(menuTexts()).toEqual(['a', 'b'])
    expect(useStylesStore.getState().selectedStyles).toEqual([])
  })
})
