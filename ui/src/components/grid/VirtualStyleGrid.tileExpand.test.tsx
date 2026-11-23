/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../../bridge'
import { isFocusVisible } from '../../lib/isFocusVisible'
import { __resetGridFocusForTests } from '../../lib/gridFocus'
import { __resetLayerStackForTests } from '../../lib/layerStack'
import { measureOverlayHeight, measureTileLabel } from '../../lib/tileLabelMetrics'
import { __resetTileExpandForTests } from '../../lib/tileExpand'
import { styleRowKey, useStylesStore } from '../../store/stylesStore'
import { StyleGrid } from '../StyleGrid'
import {
  CARD_HEIGHT_NORMAL_PX,
  CARD_HEIGHT_WINDOWED_PX,
  cardRowHeightPx,
  VIRTUALIZER_TEST_INITIAL_RECT,
} from './constants'
import { GridScroller } from './GridScroller'
import { VirtualStyleGrid } from './VirtualStyleGrid'

vi.mock('../../bridge', async () => {
  const actual = await vi.importActual<typeof import('../../bridge')>('../../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

vi.mock('../../lib/tileLabelMetrics', () => ({
  measureTileLabel: vi.fn(),
  measureOverlayHeight: vi.fn(() => 0),
}))

vi.mock('../../lib/isFocusVisible', () => ({
  isFocusVisible: vi.fn(() => true),
}))

/** jsdom has no layout: the grid keeps the virtualizer test width. */
const GRID_W = VIRTUALIZER_TEST_INITIAL_RECT.width
const GAP = 8
/** Full-size grid (not windowed): min card 150 px → 5 columns at 800 px. */
const COLS = 5
const CARD_W = (GRID_W - GAP * (COLS - 1)) / COLS
const CHROME = 42
const ROW_H = cardRowHeightPx(false)

/** Name text widths the mocked measurement reports; anything not listed fits. */
const TEXT_WIDTH: Record<string, number> = {
  'Long Zero': 200.4,
  'Long Four': 200.4,
  'Huge Name': 2000,
  'Huge Last': 2000,
}

function style(name: string, category = 'BODY'): Style {
  return {
    name: `${category}_${name}`,
    display_name: name,
    source_file: 'webui/a.csv',
    prompt: `p:${name}`,
    negative_prompt: '',
    description: '',
    category,
  }
}

// 12 styles, 5 columns: rows 0..2 (no headers in a flat category).
const STYLES = [
  style('Long Zero'),
  style('Short'),
  style('Huge Name'),
  style('Two'),
  style('Long Four'),
  style('Five'),
  style('Six'),
  style('Seven'),
  style('Eight'),
  style('Nine'),
  style('Huge Last'),
  style('Eleven'),
]

describe('VirtualStyleGrid expands truncated tile names', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const overlays = () => [...host!.querySelectorAll<HTMLElement>('[data-sg-tile-expanded]')]
  const overlay = () => {
    const all = overlays()
    expect(all).toHaveLength(1)
    return all[0]
  }
  const grid = () => host!.querySelector<HTMLElement>('[role="grid"]')!
  const scroller = () => host!.querySelector<HTMLElement>('[data-testid="scroller"]')!
  const tile = (label: string) =>
    [...host!.querySelectorAll<HTMLElement>('[data-sg-card]')].find((el) =>
      el.getAttribute('aria-label')?.startsWith(label),
    )!

  const hover = async (el: HTMLElement, pointerType?: string) => {
    await act(async () => {
      const ev = new MouseEvent('pointerover', { bubbles: true })
      if (pointerType) Object.defineProperty(ev, 'pointerType', { value: pointerType })
      el.dispatchEvent(ev)
    })
  }
  const leave = async (el: HTMLElement, to: Element | null) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: to }))
    })
  }
  const focus = async (el: HTMLElement) => {
    await act(async () => {
      el.focus()
    })
  }

  async function renderGrid(
    opts: { styles?: Style[]; windowed?: boolean; viewMode?: 'grid' | 'gallery'; category?: string } = {},
  ) {
    const styles = opts.styles ?? STYLES
    await act(async () => {
      root!.render(
        <GridScroller data-testid="scroller" style={{ height: '600px', overflowY: 'auto' }}>
          <VirtualStyleGrid
            groups={[[opts.category ?? 'BODY', styles]]}
            collapsedCategories={new Set()}
            windowed={opts.windowed ?? false}
            viewMode={opts.viewMode ?? 'grid'}
            includeHeaders={false}
            onToggleCollapse={() => {}}
            onSelectAll={() => {}}
          />
        </GridScroller>,
      )
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  beforeEach(() => {
    // The scroller is a 800×600 viewport; nothing else has a layout box.
    const isScroller = (el: Element) => el.getAttribute('data-testid') === 'scroller'
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return isScroller(this) ? VIRTUALIZER_TEST_INITIAL_RECT.height : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return isScroller(this) ? VIRTUALIZER_TEST_INITIAL_RECT.width : 0
      },
    })
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    __resetTileExpandForTests()
    vi.mocked(isFocusVisible).mockReset().mockReturnValue(true)
    vi.mocked(measureOverlayHeight).mockReset().mockReturnValue(0)
    vi.mocked(measureTileLabel)
      .mockReset()
      .mockImplementation((el: HTMLElement) => {
        const name = el.querySelector('[data-sg-grid-label]')?.textContent ?? ''
        const textWidth = TEXT_WIDTH[name] ?? 40
        const contentWidth = CARD_W - CHROME
        return { truncated: textWidth > contentWidth + 0.5, textWidth, contentWidth, chrome: CHROME }
      })
    useStylesStore.setState({
      styles: STYLES,
      duplicatesByName: new Map(STYLES.map((s) => [s.name, [s]])),
      selectedStyles: [],
      selectedKeySet: new Set(),
      favorites: new Set(),
      previewJobs: new Map(),
      activeSource: null,
      search: '',
      activeCategory: null,
      viewMode: 'grid',
      sliceMode: null,
      sliceSelection: [],
      thumbKeys: new Set(),
      thumbKeysLoaded: true,
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    host?.remove()
    host = null
    __resetTileExpandForTests()
    vi.restoreAllMocks()
  })

  it('a name that fits does not expand; a truncated one does, measured once on show', async () => {
    await renderGrid()
    await hover(tile('Short'))
    expect(overlays()).toHaveLength(0)
    await hover(tile('Long Zero'))
    expect(overlay().textContent).toBe('Long Zero')
    expect(measureTileLabel).toHaveBeenCalledTimes(2)
  })

  it('width = chrome + text width; grows right from the tile, height = tile height', async () => {
    await renderGrid()
    await hover(tile('Long Zero'))
    const o = overlay()
    expect(o.style.width).toBe(`${CHROME + 201}px`)
    expect(o.style.left).toBe('0px')
    expect(o.style.top).toBe('0px')
    expect(o.style.height).toBe(`${CARD_HEIGHT_NORMAL_PX}px`)
    expect(o.className).toContain('z-[5]')
    expect(o.className).toContain('pointer-events-none')
    expect(o.parentElement!.style.position).toBe('relative')
    expect(o.querySelector('[data-sg-grid-label]')!.className).toContain('whitespace-nowrap')
  })

  it('windowed tiles use the windowed tile height', async () => {
    await renderGrid({ windowed: true })
    await hover(tile('Long Zero'))
    expect(overlay().style.height).toBe(`${CARD_HEIGHT_WINDOWED_PX}px`)
    expect(overlay().className).toContain('p-2')
  })

  it('past the right edge it grows left from the tile right edge', async () => {
    await renderGrid()
    await hover(tile('Long Four'))
    const tileLeft = 4 * (CARD_W + GAP)
    expect(overlay().style.left).toBe(`${tileLeft + CARD_W - (CHROME + 201)}px`)
  })

  it('wider than the grid: full width, the name wraps and the overlay grows down', async () => {
    vi.mocked(measureOverlayHeight).mockReturnValue(120)
    await renderGrid()
    await hover(tile('Huge Name'))
    const o = overlay()
    expect(o.style.width).toBe(`${GRID_W}px`)
    expect(o.style.left).toBe('0px')
    expect(o.style.top).toBe('0px')
    expect(o.style.height).toBe('')
    expect(o.querySelector('[data-sg-grid-label]')!.className).toContain('whitespace-normal')
    expect(o.querySelector('[data-sg-grid-label]')!.className).toContain('break-words')
  })

  it('wrapped on the last row: grows up from the tile bottom, scroll height unchanged', async () => {
    vi.mocked(measureOverlayHeight).mockReturnValue(120)
    await renderGrid()
    const sized = grid().firstElementChild as HTMLElement
    const heightBefore = sized.style.height
    await hover(tile('Huge Last'))
    const rowTop = 2 * ROW_H
    expect(overlay().style.top).toBe(`${rowTop + CARD_HEIGHT_NORMAL_PX - 120}px`)
    expect(sized.style.height).toBe(heightBefore)
    expect(measureOverlayHeight).toHaveBeenCalledTimes(1)
  })

  it('one expanded tile at a time; the hover scale is off only on the expanded tile', async () => {
    await renderGrid()
    await hover(tile('Long Zero'))
    expect(tile('Long Zero').getAttribute('data-sg-expanded')).toBe('true')
    await leave(tile('Long Zero'), tile('Long Four'))
    await hover(tile('Long Four'))
    expect(overlay().textContent).toBe('Long Four')
    expect(tile('Long Zero').hasAttribute('data-sg-expanded')).toBe(false)
    expect(tile('Long Four').getAttribute('data-sg-expanded')).toBe('true')
    expect(tile('Long Four').className).toContain('data-[sg-expanded=true]:!scale-100')
  })

  it('pointer leaving to the gap hides; touch pointers never expand', async () => {
    await renderGrid()
    await hover(tile('Long Zero'))
    await leave(tile('Long Zero'), grid())
    expect(overlays()).toHaveLength(0)
    await hover(tile('Long Zero'), 'touch')
    expect(overlays()).toHaveLength(0)
    await hover(tile('Long Zero'), 'pen')
    expect(overlays()).toHaveLength(1)
  })

  it('keyboard focus expands with the focus ring; hover wins; leaving restores the focused one', async () => {
    await renderGrid()
    await focus(tile('Long Zero'))
    expect(overlay().textContent).toBe('Long Zero')
    expect(overlay().className).toContain('ring-2')
    expect(document.activeElement).toBe(tile('Long Zero'))
    await hover(tile('Long Four'))
    expect(overlay().textContent).toBe('Long Four')
    expect(overlay().className).not.toContain('ring-2')
    // Hovering a name that fits still suppresses the focused expansion.
    await leave(tile('Long Four'), tile('Short'))
    await hover(tile('Short'))
    expect(overlays()).toHaveLength(0)
    await leave(tile('Short'), grid())
    expect(overlay().textContent).toBe('Long Zero')
    expect(tile('Long Zero').getAttribute('data-sg-expanded')).toBe('true')
    await act(async () => {
      tile('Long Zero').blur()
    })
    expect(overlays()).toHaveLength(0)
  })

  it('focus that is not focus-visible (after a mouse click) does not expand', async () => {
    vi.mocked(isFocusVisible).mockReturnValue(false)
    await renderGrid()
    await focus(tile('Long Zero'))
    expect(overlays()).toHaveLength(0)
  })

  it('scroll and wheel hide a hover expansion; a keyboard one stays', async () => {
    await renderGrid()
    await hover(tile('Long Zero'))
    await act(async () => {
      scroller().dispatchEvent(new Event('scroll'))
    })
    expect(overlays()).toHaveLength(0)
    await leave(tile('Long Zero'), grid())
    await hover(tile('Long Four'))
    await act(async () => {
      scroller().dispatchEvent(new Event('wheel'))
    })
    expect(overlays()).toHaveLength(0)
    await focus(tile('Long Zero'))
    await act(async () => {
      scroller().dispatchEvent(new Event('scroll'))
    })
    expect(overlay().textContent).toBe('Long Zero')
  })

  it('a category change hides the expansion', async () => {
    await renderGrid()
    await focus(tile('Long Zero'))
    expect(overlays()).toHaveLength(1)
    await renderGrid({ styles: STYLES.map((s) => style(s.display_name!, 'FACE')), category: 'FACE' })
    expect(overlays()).toHaveLength(0)
  })

  it('a context menu hides it (capture phase, the card stops the event)', async () => {
    await renderGrid()
    await hover(tile('Long Zero'))
    await act(async () => {
      tile('Long Zero').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 5, clientY: 5 }),
      )
    })
    expect(overlays()).toHaveLength(0)
  })

  it('window blur hides it', async () => {
    await renderGrid()
    await focus(tile('Long Zero'))
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(overlays()).toHaveLength(0)
  })

  it('the overlay is hidden from assistive tech and is not a card', async () => {
    await renderGrid()
    await hover(tile('Long Zero'))
    const o = overlay()
    expect(o.getAttribute('aria-hidden')).toBe('true')
    expect(o.getAttribute('data-sg-tile-expanded')).toBe('true')
    expect(o.hasAttribute('title')).toBe(false)
    expect(o.hasAttribute('tabindex')).toBe(false)
    expect(o.querySelector('[data-sg-card], [data-cell-row], [data-cell-col], [title], [tabindex]')).toBeNull()
    expect(o.hasAttribute('data-sg-card')).toBe(false)
    expect(o.hasAttribute('data-cell-row')).toBe(false)
    expect(o.hasAttribute('data-cell-col')).toBe(false)
  })

  it('selection, favorite and preview status update live while expanded', async () => {
    await renderGrid()
    await hover(tile('Long Zero'))
    expect(overlay().querySelector('.rounded-full.bg-sg-accent')).toBeNull()
    const key = styleRowKey(STYLES[0])
    await act(async () => {
      useStylesStore.setState({ selectedKeySet: new Set([key]), selectedStyles: [STYLES[0]] })
    })
    expect(overlay().querySelector('.rounded-full.bg-sg-accent')).not.toBeNull()
    expect(overlay().className).toContain('bg-sg-bg')
    expect(overlay().querySelector('.bg-sg-accent\\/10')).not.toBeNull()
    await act(async () => {
      useStylesStore.setState({ favorites: new Set([key]) })
    })
    expect(overlay().querySelector('.text-sg-warning-text')).not.toBeNull()
    await act(async () => {
      useStylesStore.setState({ previewJobs: new Map([[key, 'generating' as const]]) })
    })
    expect(overlay().querySelector('[data-sg-preview-status="generating"]')).not.toBeNull()
  })

  it('gallery tiles never expand', async () => {
    await renderGrid({ viewMode: 'gallery' })
    const card = host!.querySelector<HTMLElement>('[data-sg-card]')!
    await hover(card)
    await focus(card)
    expect(overlays()).toHaveLength(0)
    expect(measureTileLabel).not.toHaveBeenCalled()
  })

  it('slice mode (not virtualized, tiles under a toggle button) does not expand', async () => {
    useStylesStore.getState().startSliceMode('BODY')
    await act(async () => {
      root!.render(
        <GridScroller>
          <StyleGrid />
        </GridScroller>,
      )
    })
    const card = host!.querySelector<HTMLElement>('[data-sg-card]')!
    expect(card).not.toBeNull()
    await hover(card)
    await focus(card)
    expect(overlays()).toHaveLength(0)
    expect(measureTileLabel).not.toHaveBeenCalled()
  })
})
