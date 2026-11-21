/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../../bridge'
import { __resetGridFocusForTests } from '../../lib/gridFocus'
import { useStylesStore } from '../../store/stylesStore'
import { cardRowHeightPx, headerRowHeightPx } from './constants'
import { GridScroller } from './GridScroller'
import { MISSING_GRID_SCROLLER_MESSAGE } from './GridScrollerContext'
import { VirtualStyleGrid } from './VirtualStyleGrid'

vi.mock('../../bridge', async () => {
  const actual = await vi.importActual<typeof import('../../bridge')>('../../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

/**
 * Default panel 1000x650, windowed: the grid scroller is 593px tall and the
 * grid is 765px wide, which is 6 columns. 1670 styles in 28 categories is the
 * size of the largest real source. All numbers below were measured in the
 * browser on the built bundle.
 */
const VIEWPORT_H = 593
const GRID_W = 765
const COLUMNS = 6
/** `pt-3` wrapper between the scroller and the grid (commit 7841195). */
const WRAPPER_PAD = 12
const CATEGORIES = 28
const STYLES_TOTAL = 1670
/** visible rows at the smallest row height + 2 x overscan + sticky row + focused row */
const MAX_ROWS_IN_DOM = 26

const HEADER_H = headerRowHeightPx()
const CARD_ROW_H = cardRowHeightPx(true)

function catName(index: number): string {
  return `CAT${String(index + 1).padStart(2, '0')}`
}

function catSize(index: number): number {
  return index < 18 ? 60 : 59
}

function buildGroups(): Array<[string, Style[]]> {
  const groups: Array<[string, Style[]]> = []
  for (let c = 0; c < CATEGORIES; c++) {
    const category = catName(c)
    const styles: Style[] = []
    for (let i = 0; i < catSize(c); i++) {
      styles.push({
        name: `${category}_${category}x${i}`,
        source_file: 'webui/test.csv',
        prompt: `p${i}`,
        negative_prompt: '',
        description: '',
        category,
        has_thumbnail: false,
      })
    }
    groups.push([category, styles])
  }
  return groups
}

/** Scroller scrollTop at which the header of category `index` is at the viewport top. */
function categoryStart(index: number): number {
  let offset = WRAPPER_PAD
  for (let c = 0; c < index; c++) {
    offset += HEADER_H + Math.ceil(catSize(c) / COLUMNS) * CARD_ROW_H
  }
  return offset
}

function totalRows(): number {
  let rows = 0
  for (let c = 0; c < CATEGORIES; c++) rows += 1 + Math.ceil(catSize(c) / COLUMNS)
  return rows
}

function contentHeight(): number {
  return categoryStart(CATEGORIES)
}

describe('VirtualStyleGrid virtualizes against the provided grid scroller', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  const groups = buildGroups()

  const scroller = () => host!.querySelector<HTMLElement>('[data-testid="scroller"]')!
  const grid = () => host!.querySelector<HTMLElement>('[role="grid"]')!
  const rowsInDom = () => [...grid().querySelectorAll<HTMLElement>('[role="row"]')]
  const stickyRow = () => rowsInDom().find((r) => r.style.position === 'sticky')
  const stickyCategory = () =>
    stickyRow()
      ?.querySelector<HTMLElement>('[data-sg-category-header]')
      ?.getAttribute('data-sg-category-header') ?? null

  /** Row top in viewport coordinates, from the same numbers the browser would lay out. */
  const rowViewportTop = (row: HTMLElement): number => {
    const match = /translateY\((-?[\d.]+)px\)/.exec(row.style.transform)
    if (!match) throw new Error('row has no translateY')
    return WRAPPER_PAD + Number(match[1]) - scroller().scrollTop
  }

  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }

  const scrollTo = async (top: number) => {
    const max = contentHeight() - VIEWPORT_H
    await act(async () => {
      scroller().scrollTop = Math.max(0, Math.min(top, max))
      scroller().dispatchEvent(new Event('scroll'))
    })
    await settle()
  }

  const pressKey = async (key: string, times = 1) => {
    for (let i = 0; i < times; i++) {
      await act(async () => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        )
      })
      await settle()
    }
  }

  async function renderGrid() {
    await act(async () => {
      root!.render(
        <GridScroller data-testid="scroller" style={{ overflowY: 'auto' }}>
          {/* Non-scrolling wrapper: before the fix this was taken as the scroller. */}
          <div data-testid="wrapper">
            <VirtualStyleGrid
              groups={groups}
              collapsedCategories={new Set()}
              windowed
              onToggleCollapse={() => {}}
              onSelectAll={() => {}}
            />
          </div>
        </GridScroller>,
      )
    })
    await settle()
  }

  beforeEach(() => {
    __resetGridFocusForTests()
    useStylesStore.setState({ styles: groups.flatMap(([, styles]) => styles) })

    const isScroller = (el: Element) => el.getAttribute('data-testid') === 'scroller'
    const liveScrollTop = () =>
      document.querySelector<HTMLElement>('[data-testid="scroller"]')?.scrollTop ?? 0

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return isScroller(this) ? VIEWPORT_H : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return isScroller(this) ? GRID_W : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return isScroller(this) ? VIEWPORT_H : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return GRID_W
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return isScroller(this) ? contentHeight() : 0
      },
    })
    // jsdom has no layout and no scrollTo: emulate an instant programmatic scroll.
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value(this: HTMLElement, options?: ScrollToOptions) {
        const max = isScroller(this) ? contentHeight() - VIEWPORT_H : 0
        this.scrollTop = Math.max(0, Math.min(options?.top ?? 0, max))
        this.dispatchEvent(new Event('scroll'))
      },
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      // The grid sits WRAPPER_PAD below the scroller's content top and moves up as it scrolls.
      const top = this.getAttribute('role') === 'grid' ? WRAPPER_PAD - liveScrollTop() : 0
      const height = isScroller(this) ? VIEWPORT_H : 0
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: GRID_W,
        bottom: top + height,
        width: GRID_W,
        height,
        toJSON() {
          return {}
        },
      }
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
    __resetGridFocusForTests()
    vi.restoreAllMocks()
    for (const prop of [
      'offsetHeight',
      'offsetWidth',
      'clientHeight',
      'clientWidth',
      'scrollHeight',
      'scrollTo',
    ]) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
    }
  })

  it('fixture matches the documented size: 1670 styles, 28 categories, 308 rows at 6 columns', () => {
    expect(groups.reduce((n, [, styles]) => n + styles.length, 0)).toBe(STYLES_TOTAL)
    expect(totalRows()).toBe(308)
  })

  it('keeps rows in the DOM bounded at scrollTop 0 and after scrolling', async () => {
    await renderGrid()
    expect(grid().getAttribute('aria-rowcount')).toBe(String(totalRows()))
    expect(rowsInDom().length).toBeGreaterThan(1)
    expect(rowsInDom().length).toBeLessThanOrEqual(MAX_ROWS_IN_DOM)

    for (const top of [categoryStart(1) + 250, categoryStart(13), contentHeight()]) {
      await scrollTo(top)
      expect(rowsInDom().length).toBeGreaterThan(1)
      expect(rowsInDom().length).toBeLessThanOrEqual(MAX_ROWS_IN_DOM)
    }
  })

  it('sticky header is the category at the viewport top after scrolling', async () => {
    await renderGrid()
    expect(stickyCategory()).toBe(catName(0))

    const midOf = (index: number) =>
      categoryStart(index) + HEADER_H + (Math.ceil(catSize(index) / COLUMNS) * CARD_ROW_H) / 2

    await scrollTo(midOf(1))
    expect(stickyCategory()).toBe(catName(1))

    await scrollTo(midOf(2))
    expect(stickyCategory()).toBe(catName(2))

    // End of list: the last category (460px) is shorter than the viewport, so the
    // row at the viewport top still belongs to the one before it.
    await scrollTo(contentHeight())
    const maxScrollTop = contentHeight() - VIEWPORT_H
    expect(scroller().scrollTop).toBe(maxScrollTop)
    expect(maxScrollTop).toBeGreaterThan(categoryStart(CATEGORIES - 2))
    expect(maxScrollTop).toBeLessThan(categoryStart(CATEGORIES - 1))
    expect(stickyCategory()).toBe(catName(CATEGORIES - 2))

    // Exact category boundary: that category's own header becomes the sticky row.
    await scrollTo(categoryStart(1))
    expect(stickyCategory()).toBe(catName(1))
  })

  it('regression 7841195: a non-scrolling wrapper is not the scroller; rows sit at start - scrollMargin', async () => {
    await renderGrid()
    expect(grid().parentElement!.getAttribute('data-testid')).toBe('wrapper')

    // Row 1 starts at scrollMargin + header height inside the scroller, and is
    // placed inside the grid without the margin.
    const firstCards = grid().querySelector<HTMLElement>('[role="row"][data-index="1"]')!
    expect(firstCards.style.transform).toBe(`translateY(${HEADER_H}px)`)

    // The rendered window follows the scroller's scrollTop, not the wrapper.
    await scrollTo(categoryStart(13))
    const indexes = rowsInDom().map((r) => Number(r.dataset.index))
    const headerIndex = 13 * 11 // 13 full categories of 1 header + 10 card rows
    expect(indexes).toContain(headerIndex)
    expect(indexes).not.toContain(1)
    const nextCards = grid().querySelector<HTMLElement>(
      `[role="row"][data-index="${headerIndex + 1}"]`,
    )!
    expect(rowViewportTop(nextCards)).toBe(HEADER_H)
  })

  it('keyboard: moving focus below the viewport scrolls, and the focused row is never under the sticky header', async () => {
    await renderGrid()
    const firstCard = grid().querySelector<HTMLElement>('[data-sg-card]')!
    act(() => {
      firstCard.focus()
    })
    expect(scroller().scrollTop).toBe(0)

    const focusedRowEl = () => document.activeElement!.closest<HTMLElement>('[role="row"]')!
    const focusedRowIndex = () => Number(document.activeElement!.getAttribute('data-cell-row'))

    await pressKey('ArrowDown', 20)
    expect(grid().contains(document.activeElement)).toBe(true)
    expect(focusedRowIndex()).toBe(21)
    expect(scroller().scrollTop).toBeGreaterThan(0)
    expect(rowViewportTop(focusedRowEl())).toBeGreaterThanOrEqual(HEADER_H)
    expect(rowViewportTop(focusedRowEl()) + CARD_ROW_H).toBeLessThanOrEqual(VIEWPORT_H)

    const scrolledDown = scroller().scrollTop
    await pressKey('ArrowUp', 15)
    expect(grid().contains(document.activeElement)).toBe(true)
    expect(scroller().scrollTop).toBeLessThan(scrolledDown)
    expect(rowViewportTop(focusedRowEl())).toBeGreaterThanOrEqual(HEADER_H)
  })

  it('PageDown moves by one viewport of card rows, not by the whole list', async () => {
    await renderGrid()
    const firstCard = grid().querySelector<HTMLElement>('[data-sg-card]')!
    act(() => {
      firstCard.focus()
    })
    const before = Number(document.activeElement!.getAttribute('data-cell-row'))
    await pressKey('PageDown')
    const after = Number(document.activeElement!.getAttribute('data-cell-row'))
    const pageRows = Math.floor((VIEWPORT_H - HEADER_H) / CARD_ROW_H)
    expect(after - before).toBeGreaterThan(0)
    expect(after - before).toBeLessThanOrEqual(pageRows + 2) // header rows on the way
  })
})

describe('VirtualStyleGrid without a grid scroller provider', () => {
  it('throws in dev and tests instead of virtualizing against a wrong element', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => {
        act(() => {
          root.render(
            <VirtualStyleGrid
              groups={buildGroups().slice(0, 1)}
              collapsedCategories={new Set()}
              windowed
              onToggleCollapse={() => {}}
              onSelectAll={() => {}}
            />,
          )
        })
      }).toThrow(MISSING_GRID_SCROLLER_MESSAGE)
    } finally {
      act(() => {
        root.unmount()
      })
      host.remove()
      consoleError.mockRestore()
    }
  })
})
