/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { __resetGridFocusForTests, getFocusedCell, setFocusedCell } from '../lib/gridFocus'
import { __resetLayerStackForTests, closeTopLayer } from '../lib/layerStack'
import { LORA_SOURCE, styleRowKey, useStylesStore } from '../store/stylesStore'
import { CARD_HEIGHT_NORMAL_PX, CARD_HEIGHT_WINDOWED_PX, GALLERY_LABEL_HEIGHT_PX } from './grid/constants'
import { GridScroller } from './grid/GridScroller'
import { StyleCard } from './StyleCard'
import { StyleGrid } from './StyleGrid'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const GALLERY_H = 146 + GALLERY_LABEL_HEIGHT_PX

function style(overrides: Partial<Style> = {}): Style {
  return {
    name: 'BODY_Tall_Amazon',
    source_file: 'webui/styles_nsfw_core.csv',
    prompt: 'tall',
    negative_prompt: '',
    description: '',
    category: 'BODY',
    ...overrides,
  }
}

function setStore(styles: Style[], extra: Partial<ReturnType<typeof useStylesStore.getState>> = {}) {
  const byName = new Map<string, Style[]>()
  for (const s of styles) byName.set(s.name, [...(byName.get(s.name) ?? []), s])
  useStylesStore.setState({
    styles,
    duplicatesByName: byName,
    selectedStyles: [],
    selectedKeySet: new Set(),
    favorites: new Set(),
    activeSource: null,
    activeCategory: null,
    search: '',
    thumbVersions: {},
    thumbKeys: new Set(),
    thumbKeysLoaded: true,
    viewMode: 'grid',
    sliceMode: null,
    collapsedCategories: new Set(),
    ...extra,
  })
}

let root: Root | null = null
let host: HTMLDivElement | null = null

const card = (i = 0) => host!.querySelectorAll<HTMLButtonElement>('[data-sg-card]')[i]
const actions = (i = 0) => card(i).parentElement!.querySelector<HTMLElement>('[data-sg-tile-actions]')!
const star = (i = 0) => actions(i).querySelector<HTMLButtonElement>('[data-sg-tile-favorite]')!
const more = (i = 0) => actions(i).querySelector<HTMLButtonElement>('[data-sg-tile-more]')!
const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
const menuTexts = () => [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].map((el) => el.textContent?.trim())
const menuItem = (text: string) =>
  [...(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find((el) => el.textContent?.trim() === text)

/**
 * A real mouse press: mousedown moves focus to the target unless it is
 * prevented (jsdom does not do this by itself), then mouseup and click.
 */
async function mousePress(el: HTMLElement) {
  await act(async () => {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    el.dispatchEvent(down)
    if (!down.defaultPrevented) el.focus()
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  })
}

/**
 * Hover the way a mouse does, then wait past the old preview delay (300 ms).
 * jsdom never matches :hover, and the removed preview checked it before
 * showing; report the hovered tile as :hover so such a popup could appear.
 */
async function hoverAndWait(el: HTMLElement) {
  const matches = Element.prototype.matches
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    if (selector === ':hover') return this === el || this.contains(el)
    return matches.call(this, selector)
  })
  await act(async () => {
    el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    el.parentElement?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
}

/** The removed hover preview: a fixed portal with the name, prompt and a right-click line. */
const previewPopup = () =>
  [...document.body.querySelectorAll<HTMLElement>('body > div')].find(
    (el) => el.textContent?.includes('Right-click for options') || el.className.includes('z-[10050]'),
  ) ?? null

const contextMenu = async (el: HTMLElement, init: MouseEventInit) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...init }))
  })
}

const stubRect = (el: HTMLElement, left: number, top: number, width: number, height: number) => {
  el.getBoundingClientRect = () =>
    ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
}

function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
}

function unmount() {
  act(() => {
    root?.unmount()
  })
  root = null
  host?.remove()
  host = null
  __resetLayerStackForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
}

describe('gallery tile: star and ⋯', () => {
  beforeEach(() => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    mount()
  })
  afterEach(unmount)

  async function render(s: Style, opts: { gallery?: boolean; hoverActions?: boolean } = {}) {
    await act(async () => {
      root!.render(
        <StyleCard
          style={s}
          viewMode={opts.gallery ? 'gallery' : 'grid'}
          galleryCardHeightPx={opts.gallery ? GALLERY_H : undefined}
          hoverActions={opts.hoverActions}
          cellRow={0}
          cellCol={0}
          tabIndex={0}
        />,
      )
    })
  }

  it('the actions are siblings of the card button, out of the tab order, labelled', async () => {
    const s = style()
    setStore([s])
    await render(s, { gallery: true })
    expect(card().contains(actions())).toBe(false)
    expect(card().parentElement!.contains(actions())).toBe(true)
    expect(star().tabIndex).toBe(-1)
    expect(more().tabIndex).toBe(-1)
    expect(star().getAttribute('aria-label')).toBe('Add Tall Amazon to favorites')
    expect(more().getAttribute('aria-label')).toBe('More actions for Tall Amazon')
    expect(more().getAttribute('aria-haspopup')).toBe('menu')
    expect(more().getAttribute('aria-expanded')).toBe('false')
    expect(star().querySelector('svg')!.getAttribute('width')).toBe('14')
    expect(star().className).toContain('h-6')
    expect(star().className).toContain('w-6')
  })

  it('hidden by opacity (never display:none), shown on tile hover and visible focus', async () => {
    const s = style()
    setStore([s])
    await render(s, { gallery: true })
    const cell = host!.querySelector<HTMLElement>('[role="gridcell"]')!
    expect(cell.className).toContain('group/tile')
    const cls = actions().className
    expect(cls).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(cls).toContain('opacity-0')
    expect(cls).toContain('pointer-events-none')
    expect(cls).toContain('group-hover/tile:opacity-100')
    expect(cls).toContain('group-has-[:focus-visible]/tile:opacity-100')
    expect(cls).toContain('group-has-[:focus-visible]/tile:pointer-events-auto')
    // Mouse focus (the menu returns focus to the card) must not keep them up.
    expect(cls).not.toContain('group-focus-within')
    // Gallery tile: top-right over the thumbnail.
    expect(cls).toContain('top-1')
    expect(cls).toContain('right-1')
  })

  it('★ toggles the favorite and flips its label; no selection, no picker, no focused-cell change', async () => {
    const a = style()
    const b = style({ source_file: 'webui/styles_solo.csv' }) // same name, two packs: a card click would open the picker
    setStore([a, b])
    await render(a, { gallery: true })
    setFocusedCell({ row: 3, col: 2 })
    await mousePress(star())
    expect(useStylesStore.getState().favorites.has(styleRowKey(a))).toBe(true)
    expect(star().getAttribute('aria-label')).toBe('Remove Tall Amazon from favorites')
    expect(star().querySelector('svg')!.getAttribute('fill')).toBe('currentColor')
    expect(useStylesStore.getState().selectedStyles).toEqual([])
    expect(menu()).toBeNull() // no source picker
    expect(getFocusedCell()).toEqual({ row: 3, col: 2 })

    await mousePress(star())
    expect(useStylesStore.getState().favorites.has(styleRowKey(a))).toBe(false)
    expect(star().getAttribute('aria-label')).toBe('Add Tall Amazon to favorites')
    expect(useStylesStore.getState().selectedStyles).toEqual([])
  })

  it('⋯ opens the menu under itself, stays visible while open; Escape returns focus to the card', async () => {
    const s = style()
    setStore([s])
    await render(s, { gallery: true })
    card().focus()
    stubRect(more(), 300, 100, 24, 24)
    await mousePress(more())
    expect(menu()).not.toBeNull()
    expect(menu()!.style.left).toBe('300px')
    expect(menu()!.style.top).toBe('128px')
    expect(more().getAttribute('aria-expanded')).toBe('true')
    expect(actions().className).toContain('opacity-100')
    expect(actions().className).not.toContain('opacity-0')
    expect(useStylesStore.getState().selectedStyles).toEqual([])
    act(() => {
      expect(closeTopLayer()).toBe(true)
    })
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(card())
  })

  it('keyboard contextmenu (button 0, non-zero coordinates) anchors under the card; button 2 opens at the cursor', async () => {
    const s = style()
    setStore([s])
    await render(s)
    stubRect(card(), 40, 200, 180, 40)
    await contextMenu(card(), { button: 0, clientX: 77, clientY: 88 })
    expect(menu()!.style.left).toBe('40px')
    expect(menu()!.style.top).toBe('244px')
    act(() => {
      closeTopLayer()
    })
    await contextMenu(card(), { button: 2, clientX: 77, clientY: 88 })
    expect(menu()!.style.left).toBe('77px')
    expect(menu()!.style.top).toBe('88px')
  })

  it('menu header: name and pack file, labelled heading; new labels; Delete… is the danger item', async () => {
    const s = style()
    setStore([s], { thumbKeys: new Set([styleRowKey(s)]) })
    await render(s)
    await contextMenu(card(), { button: 2, clientX: 5, clientY: 5 })
    const header = menu()!.querySelector<HTMLElement>('[data-sg-menu-header]')!
    expect(menu()!.firstElementChild).toBe(header)
    expect(header.getAttribute('role')).toBeNull()
    expect(header.hasAttribute('aria-hidden')).toBe(false)
    expect(header.className).toContain('border-b')
    expect(header.className).toContain('border-sg-border')
    expect(header.className).toContain('mb-1')
    const [name, source] = header.children as unknown as HTMLElement[]
    expect(name.textContent).toBe('Tall Amazon')
    expect(name.className).toContain('font-semibold')
    expect(name.className).toContain('text-sm')
    expect(source.textContent).toBe('styles_nsfw_core.csv')
    expect(source.className).toContain('font-mono')
    expect(source.className).toContain('text-xs')
    expect(source.className).toContain('text-sg-muted')
    expect(menu()!.getAttribute('aria-labelledby')).toBe(name.id)
    expect(name.id).not.toBe('')
    expect(menuTexts()).toEqual([
      'Select',
      'Add to favorites',
      'Copy prompt',
      'Edit…',
      'Duplicate',
      'Move to category…',
      'Generate preview',
      'Upload preview…',
      'Remove preview',
      'Delete…',
    ])
    expect(menuItem('Delete…')!.className).toContain('text-sg-danger-text')
  })

  it('header for a read-only row and for a LoRA row', async () => {
    const ro = style({ source_file: 'samples/sample_styles.csv', read_only: true })
    setStore([ro])
    await render(ro)
    await contextMenu(card(), { button: 2, clientX: 5, clientY: 5 })
    expect(menu()!.querySelector('[data-sg-menu-header]')!.children[1].textContent).toBe('sample_styles.csv · read-only')
    act(() => {
      closeTopLayer()
    })

    const lora = style({ name: 'detail_tweaker', source_file: LORA_SOURCE, category: 'LoRA' })
    setStore([lora])
    await render(lora)
    await contextMenu(card(), { button: 2, clientX: 5, clientY: 5 })
    const header = menu()!.querySelector('[data-sg-menu-header]')!
    expect(header.children[0].textContent).toBe('tweaker') // display name: text after the first _
    expect(header.children[1].textContent).toBe('LoRA')
  })

  it('hovering a gallery tile shows no preview popup; ★ / ⋯ still sit beside the card in a relative wrapper', async () => {
    const s = style({ description: 'tall woman' })
    setStore([s], { thumbKeys: new Set([styleRowKey(s)]) })
    await render(s, { gallery: true })
    await hoverAndWait(card())
    expect(previewPopup()).toBeNull()
    expect(document.body.textContent).not.toContain('Right-click for options')
    const wrap = card().parentElement!
    expect(wrap.className).toBe('relative')
    expect(wrap.contains(actions())).toBe(true)
    expect(card().contains(actions())).toBe(false)
  })

  it('gallery tile: actions top-right over the thumbnail, tile height unchanged', async () => {
    const s = style()
    setStore([s], { favorites: new Set([styleRowKey(s)]) })
    await render(s, { gallery: true })
    expect(card().style.height).toBe(`${GALLERY_H}px`)
    expect(actions().className).toContain('top-1')
    expect(actions().className).toContain('right-1')
    expect(card().contains(actions())).toBe(false)
    // The favorite indicator stays and gives its place to the Star button on hover.
    const indicator = card().querySelector('[data-sg-gallery-thumb] svg.text-sg-warning-text')!
    expect(indicator.getAttribute('class')).toContain('group-hover/tile:opacity-0')
    expect(indicator.getAttribute('class')).toContain('group-has-[:focus-visible]/tile:opacity-0')
    expect(indicator.getAttribute('class')).not.toContain('group-focus-within')
    expect(star().querySelector('svg')!.getAttribute('fill')).toBe('currentColor')
  })

  it('slice-mode tiles (hoverActions=false) keep today\'s markup', async () => {
    const s = style()
    setStore([s])
    await render(s, { hoverActions: false })
    expect(host!.querySelector('[data-sg-tile-actions]')).toBeNull()
    expect(host!.querySelector('[role="gridcell"]')!.className).toBe('')
  })
})

describe('grid tile: no hover icons', () => {
  beforeEach(() => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    mount()
  })
  afterEach(unmount)

  const noActions = () => {
    expect(host!.querySelector('[data-sg-tile-actions]')).toBeNull()
    expect(host!.querySelector('button[aria-label$="to favorites"], button[aria-label$="from favorites"]')).toBeNull()
    expect(host!.querySelector('button[aria-label^="More actions for"]')).toBeNull()
  }

  it('hovering a grid tile shows no preview popup', async () => {
    const s = style({ description: 'tall woman' })
    setStore([s], { thumbKeys: new Set([styleRowKey(s)]) })
    await act(async () => {
      root!.render(<StyleCard style={s} viewMode="grid" cellRow={0} cellCol={0} tabIndex={0} />)
    })
    await hoverAndWait(card())
    expect(previewPopup()).toBeNull()
    expect(document.body.textContent).not.toContain('Right-click for options')
  })

  it('renders no ★ / ⋯ by default, on hover and on focus; right-click still opens the menu; favorites keep the ★ indicator', async () => {
    const s = style()
    setStore([s], { favorites: new Set([styleRowKey(s)]) })
    await act(async () => {
      root!.render(<StyleCard style={s} viewMode="grid" cellRow={0} cellCol={0} tabIndex={0} />)
    })
    noActions()
    expect(host!.querySelector('[role="gridcell"]')!.className).toBe('')
    await act(async () => {
      card().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      card().dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    })
    noActions()
    await act(async () => card().focus())
    expect(document.activeElement).toBe(card())
    noActions()

    const indicator = card().querySelector('svg.text-sg-warning-text')!
    expect(indicator).not.toBeNull()
    expect(indicator.getAttribute('class')).not.toContain('opacity-0')

    await contextMenu(card(), { button: 2, clientX: 30, clientY: 40 })
    expect(menu()).not.toBeNull()
    expect(menu()!.style.left).toBe('30px')
    expect(menuTexts()).toContain('Remove from favorites')
  })

  it('a long name wraps to two lines at most, with no title attribute; the accessible name keeps it all', async () => {
    const name = 'A very long style name that needs two lines Supercalifragilisticexpialidociousending'
    const s = style({ name: `BODY_${name}` })
    setStore([s], { selectedStyles: [s], selectedKeySet: new Set([styleRowKey(s)]) })
    for (const windowed of [true, false]) {
      await act(async () => {
        root!.render(<StyleCard style={s} viewMode="grid" windowed={windowed} cellRow={0} cellCol={0} tabIndex={0} />)
      })
      const label = card().querySelector<HTMLElement>('[data-sg-grid-label]')!
      expect(label.textContent).toBe(name)
      expect(label.className).toContain('line-clamp-2')
      expect(label.className).toContain('break-words')
      // Room on the right for the selected dot, the star and the preview status.
      expect(label.className).toContain('pr-4')
      expect(label.className).not.toContain('truncate')
      expect(label.className).toContain(windowed ? 'leading-[14px]' : 'leading-4')
      // Single-line names sit in the middle of the tile.
      expect(card().className).toContain('items-center')
      expect(card().style.height).toBe(`${(windowed ? CARD_HEIGHT_WINDOWED_PX : CARD_HEIGHT_NORMAL_PX)}px`)
      expect(card().getAttribute('aria-label')).toBe(name)
      expect(host!.querySelector('[title]')).toBeNull()
      expect(card().querySelector('.rounded-full.bg-sg-accent')!.className).toContain('right-2')
    }
  })
})

describe('gallery tile actions inside the virtualized grid', () => {
  const LAYOUT = [['offsetHeight', 600], ['offsetWidth', 800], ['clientHeight', 600], ['clientWidth', 800]] as const

  beforeEach(async () => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    for (const [prop, value] of LAYOUT) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
    }
    const styles = ['BODY_A', 'BODY_B', 'BODY_C'].map((name) => style({ name }))
    setStore(styles, { activeCategory: 'BODY', viewMode: 'gallery' })
    mount()
    await act(async () => {
      root!.render(
        <GridScroller style={{ height: 600, overflow: 'auto' }}>
          <StyleGrid />
        </GridScroller>,
      )
    })
  })

  afterEach(() => {
    unmount()
    useStylesStore.setState({ activeCategory: null })
    for (const [prop] of LAYOUT) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
    }
  })

  const arrowRight = async () => {
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('★ keeps focus on the card, and ArrowRight then moves to the next card', async () => {
    await act(async () => card(0).focus())
    expect(document.activeElement).toBe(card(0))
    await mousePress(star(0))
    expect(useStylesStore.getState().favorites.size).toBe(1)
    expect(document.activeElement).toBe(card(0))
    await arrowRight()
    expect(document.activeElement).toBe(card(1))
    expect(getFocusedCell()).toEqual({ row: 0, col: 1 })
  })

  it('⋯ then Escape returns focus to the card, and ArrowRight moves to the next card', async () => {
    await act(async () => card(0).focus())
    await mousePress(more(0))
    expect(menu()).not.toBeNull()
    act(() => {
      closeTopLayer()
    })
    expect(document.activeElement).toBe(card(0))
    await arrowRight()
    expect(document.activeElement).toBe(card(1))
  })
})
