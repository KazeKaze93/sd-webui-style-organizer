/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../../bridge'
import { __resetGridFocusForTests } from '../../lib/gridFocus'
import {
  HEADER_CONTENT_HEIGHT_PX,
  headerRowHeightPx,
  VIRTUALIZER_TEST_INITIAL_RECT,
} from './constants'

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: () => [0, 1],
  useVirtualizer: () => ({
    getVirtualItems: () => [
      // Header row size must equal headerRowHeightPx(); asserted below.
      { key: 0, index: 0, start: 0, size: 40, end: 40 },
      { key: 1, index: 1, start: 40, size: 54, end: 94 },
    ],
    getTotalSize: () => 94,
    measure: () => {},
    scrollToIndex: () => {},
  }),
}))

vi.mock('./CategoryHeaderRow', () => ({
  CategoryHeaderRow: () => <div data-testid="cat-header" />,
}))

vi.mock('./CardsRow', () => ({
  CardsRow: () => <div data-testid="cards-row" />,
}))

import { GridScroller } from './GridScroller'
import { VirtualStyleGrid } from './VirtualStyleGrid'

function style(name: string, category: string): Style {
  return {
    name,
    source_file: 'D:/packs/core/styles.csv',
    prompt: `p:${name}`,
    negative_prompt: '',
    description: '',
    category,
  }
}

describe('VirtualStyleGrid sticky row chrome', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(() => {
    __resetGridFocusForTests()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const height =
        Number.parseFloat(this.style.height) || VIRTUALIZER_TEST_INITIAL_RECT.height
      const width =
        Number.parseFloat(this.style.width) || VIRTUALIZER_TEST_INITIAL_RECT.width
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
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
  })

  it('gives the active sticky row wrapper bg-sg-bg and sticky top 0; non-sticky rows omit bg-sg-bg', () => {
    const groups: Array<[string, Style[]]> = [
      ['BODY', [style('BODY_A', 'BODY'), style('BODY_B', 'BODY')]],
    ]

    act(() => {
      root!.render(
        <GridScroller
          style={{
            height: `${VIRTUALIZER_TEST_INITIAL_RECT.height}px`,
            width: `${VIRTUALIZER_TEST_INITIAL_RECT.width}px`,
            overflow: 'auto',
          }}
        >
          <VirtualStyleGrid
            groups={groups}
            collapsedCategories={new Set()}
            windowed={false}
            onToggleCollapse={() => {}}
            onSelectAll={() => {}}
          />
        </GridScroller>,
      )
    })

    const stickyRow = host!.querySelector<HTMLElement>('[role="row"][data-index="0"]')
    const nonStickyRow = host!.querySelector<HTMLElement>('[role="row"][data-index="1"]')

    expect(stickyRow).not.toBeNull()
    expect(nonStickyRow).not.toBeNull()
    expect(stickyRow!.classList.contains('bg-sg-bg')).toBe(true)
    expect(stickyRow!.style.position).toBe('sticky')
    expect(stickyRow!.style.top).toBe('0px')
    expect(nonStickyRow!.classList.contains('bg-sg-bg')).toBe(false)
  })

  function renderGrid(viewMode: 'grid' | 'gallery' = 'grid') {
    const groups: Array<[string, Style[]]> = [
      ['BODY', [style('BODY_A', 'BODY'), style('BODY_B', 'BODY')]],
    ]
    act(() => {
      root!.render(
        <GridScroller
          style={{
            height: `${VIRTUALIZER_TEST_INITIAL_RECT.height}px`,
            width: `${VIRTUALIZER_TEST_INITIAL_RECT.width}px`,
            overflow: 'auto',
          }}
        >
          <VirtualStyleGrid
            groups={groups}
            collapsedCategories={new Set()}
            windowed={false}
            viewMode={viewMode}
            onToggleCollapse={() => {}}
            onSelectAll={() => {}}
          />
        </GridScroller>,
      )
    })
  }

  it.each(['grid', 'gallery'] as const)('%s: sticky header row is exactly one virtual header row tall, so the first cards row starts below it', (viewMode) => {
    expect(headerRowHeightPx()).toBe(40)
    renderGrid(viewMode)

    const stickyRow = host!.querySelector<HTMLElement>('[role="row"][data-index="0"]')
    const firstCardsRow = host!.querySelector<HTMLElement>('[role="row"][data-index="1"]')

    // The sticky row sits in normal flow at the top; its bottom edge is its height.
    expect(stickyRow!.style.height).toBe(`${headerRowHeightPx()}px`)
    expect(stickyRow!.style.boxSizing).toBe('border-box')
    // The first cards row is translated to the header row's virtual end.
    expect(firstCardsRow!.style.transform).toBe(`translateY(${headerRowHeightPx()}px)`)
  })

  it('category header content has a fixed height that fits inside the header row', async () => {
    const { CategoryHeaderRow: RealHeader } =
      await vi.importActual<typeof import('./CategoryHeaderRow')>('./CategoryHeaderRow')
    act(() => {
      root!.render(
        <RealHeader
          category="BODY"
          count={2}
          collapsed={false}
          isStickyActive
          enableLoraContextMenu={false}
          rowIndex={0}
          focusedCol={null}
          onToggleCollapse={() => {}}
          onSelectAll={() => {}}
        />,
      )
    })
    const header = host!.querySelector<HTMLElement>('[data-sg-category-header="BODY"]')
    expect(header).not.toBeNull()
    expect(header!.style.height).toBe(`${HEADER_CONTENT_HEIGHT_PX}px`)
    // No vertical padding class left to push the content past the fixed height.
    expect(header!.className).not.toMatch(/(^|\s)py-\d/)
    expect(HEADER_CONTENT_HEIGHT_PX).toBeLessThan(headerRowHeightPx())
  })
})
