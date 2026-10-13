import { describe, expect, it } from 'vitest'
import type { Style } from '../bridge'
import type { GridRow } from '../components/grid/buildGridRows'
import { buildGridRows } from '../components/grid/buildGridRows'
import { cellCount, nextCell, type GridCell } from './gridNav'

function style(name: string, category: string): Style {
  return {
    name,
    source_file: 'D:/packs/core/styles.csv',
    prompt: `p:${name}`,
    negative_prompt: '',
    description: '',
    category,
    has_thumbnail: false,
  }
}

function nav(
  rows: readonly GridRow[],
  from: GridCell,
  key: Parameters<typeof nextCell>[3],
  opts: { columns?: number; pageRows?: number; ctrl?: boolean } = {},
): GridCell | null {
  return nextCell(
    rows,
    opts.columns ?? 3,
    from,
    key,
    opts.pageRows ?? 3,
    opts.ctrl ?? false,
  )
}

describe('cellCount', () => {
  it('returns 2 for header rows and styles.length for card rows', () => {
    const header: GridRow = {
      kind: 'header',
      category: 'BODY',
      count: 5,
      collapsed: false,
    }
    const cards: GridRow = {
      kind: 'cards',
      category: 'BODY',
      styles: [style('A', 'BODY'), style('B', 'BODY')],
    }
    expect(cellCount(header)).toBe(2)
    expect(cellCount(cards)).toBe(2)
  })
})

describe('nextCell', () => {
  const body = [
    style('B1', 'BODY'),
    style('B2', 'BODY'),
    style('B3', 'BODY'),
    style('B4', 'BODY'),
    style('B5', 'BODY'),
  ]
  const hair = [style('H1', 'HAIR'), style('H2', 'HAIR')]

  /** columns=3 → BODY header, cards[3], cards[2], HAIR header, cards[2] */
  const multi = buildGridRows(
    [
      ['BODY', body],
      ['HAIR', hair],
    ],
    new Set(),
    3,
  )

  it('returns null for an empty list', () => {
    expect(nav([], { row: 0, col: 0 }, 'ArrowRight')).toBeNull()
    expect(nav([], { row: 0, col: 0 }, 'Home', { ctrl: true })).toBeNull()
  })

  it('ArrowLeft / ArrowRight move in-row and stop at ends', () => {
    // multi[1] = BODY cards with 3 styles
    expect(nav(multi, { row: 1, col: 1 }, 'ArrowLeft')).toEqual({ row: 1, col: 0 })
    expect(nav(multi, { row: 1, col: 0 }, 'ArrowLeft')).toBeNull()
    expect(nav(multi, { row: 1, col: 1 }, 'ArrowRight')).toEqual({ row: 1, col: 2 })
    expect(nav(multi, { row: 1, col: 2 }, 'ArrowRight')).toBeNull()

    // header: only collapse (0) and select-all (1)
    expect(nav(multi, { row: 0, col: 0 }, 'ArrowRight')).toEqual({ row: 0, col: 1 })
    expect(nav(multi, { row: 0, col: 1 }, 'ArrowRight')).toBeNull()
    expect(nav(multi, { row: 0, col: 0 }, 'ArrowLeft')).toBeNull()
  })

  it('ArrowUp / ArrowDown keep column and map header cells', () => {
    // from card col 2 up into header → select-all (col 1)
    expect(nav(multi, { row: 1, col: 2 }, 'ArrowUp')).toEqual({ row: 0, col: 1 })
    // from card col 0 up → collapse
    expect(nav(multi, { row: 1, col: 0 }, 'ArrowUp')).toEqual({ row: 0, col: 0 })
    // from header select-all down → col 1 of cards
    expect(nav(multi, { row: 0, col: 1 }, 'ArrowDown')).toEqual({ row: 1, col: 1 })
    // from ragged last BODY row (2 styles) col 1 down to HAIR header → select-all
    expect(nav(multi, { row: 2, col: 1 }, 'ArrowDown')).toEqual({ row: 3, col: 1 })
    // stop at first / last row
    expect(nav(multi, { row: 0, col: 0 }, 'ArrowUp')).toBeNull()
    expect(nav(multi, { row: multi.length - 1, col: 0 }, 'ArrowDown')).toBeNull()
  })

  it('clamps column when moving onto a ragged last card row', () => {
    // multi[2] has 2 styles (B4, B5); from HAIR cards going up through header to that row
    expect(nav(multi, { row: 1, col: 2 }, 'ArrowDown')).toEqual({ row: 2, col: 1 })
    expect(cellCount(multi[2])).toBe(2)
  })

  it('crosses collapsed categories as header-only rows', () => {
    const collapsed = buildGridRows(
      [
        ['BODY', body],
        ['HAIR', hair],
      ],
      new Set(['BODY']),
      3,
    )
    // BODY collapsed header, HAIR header, HAIR cards
    expect(collapsed.map((r) => r.kind)).toEqual(['header', 'header', 'cards'])
    expect(nav(collapsed, { row: 0, col: 0 }, 'ArrowDown')).toEqual({ row: 1, col: 0 })
    expect(nav(collapsed, { row: 1, col: 1 }, 'ArrowDown')).toEqual({ row: 2, col: 1 })
    expect(nav(collapsed, { row: 2, col: 0 }, 'ArrowUp')).toEqual({ row: 1, col: 0 })
  })

  it('handles a single expanded category', () => {
    const single = buildGridRows([['BODY', body]], new Set(), 3)
    expect(single.map((r) => r.kind)).toEqual(['header', 'cards', 'cards'])
    expect(nav(single, { row: 0, col: 0 }, 'ArrowDown')).toEqual({ row: 1, col: 0 })
    expect(nav(single, { row: 1, col: 2 }, 'Home')).toEqual({ row: 1, col: 0 })
    expect(nav(single, { row: 1, col: 0 }, 'End')).toEqual({ row: 1, col: 2 })
  })

  it('Home / End move to row start / end; Ctrl jumps to grid ends', () => {
    expect(nav(multi, { row: 1, col: 2 }, 'Home')).toEqual({ row: 1, col: 0 })
    expect(nav(multi, { row: 1, col: 0 }, 'End')).toEqual({ row: 1, col: 2 })
    expect(nav(multi, { row: 1, col: 0 }, 'Home')).toBeNull()
    expect(nav(multi, { row: 1, col: 2 }, 'End')).toBeNull()

    expect(nav(multi, { row: 2, col: 1 }, 'Home', { ctrl: true })).toEqual({
      row: 0,
      col: 0,
    })
    expect(nav(multi, { row: 0, col: 0 }, 'End', { ctrl: true })).toEqual({
      row: multi.length - 1,
      col: cellCount(multi[multi.length - 1]) - 1,
    })
    expect(nav(multi, { row: 0, col: 0 }, 'Home', { ctrl: true })).toBeNull()
  })

  it('PageUp / PageDown move by pageRows and clamp', () => {
    expect(nav(multi, { row: 4, col: 0 }, 'PageUp', { pageRows: 2 })).toEqual({
      row: 2,
      col: 0,
    })
    expect(nav(multi, { row: 0, col: 1 }, 'PageDown', { pageRows: 2 })).toEqual({
      row: 2,
      col: 1,
    })
    // clamp to edges
    expect(nav(multi, { row: 1, col: 0 }, 'PageUp', { pageRows: 10 })).toEqual({
      row: 0,
      col: 0,
    })
    expect(nav(multi, { row: 3, col: 0 }, 'PageDown', { pageRows: 10 })).toEqual({
      row: multi.length - 1,
      col: 0,
    })
    expect(nav(multi, { row: 0, col: 0 }, 'PageUp', { pageRows: 3 })).toBeNull()
    expect(
      nav(multi, { row: multi.length - 1, col: 1 }, 'PageDown', { pageRows: 3 }),
    ).toBeNull()
  })

  it('covers every nav key at least once from a mid card cell', () => {
    const from: GridCell = { row: 1, col: 1 }
    const keys = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ] as const
    for (const key of keys) {
      const result = nav(multi, from, key, { pageRows: 1 })
      // each key either moves or (for this cell) may only no-op on PageUp→header col map
      expect(result === null || typeof result.row === 'number').toBe(true)
    }
    expect(nav(multi, from, 'ArrowLeft')).toEqual({ row: 1, col: 0 })
    expect(nav(multi, from, 'ArrowRight')).toEqual({ row: 1, col: 2 })
    expect(nav(multi, from, 'ArrowUp')).toEqual({ row: 0, col: 1 })
    expect(nav(multi, from, 'ArrowDown')).toEqual({ row: 2, col: 1 })
    expect(nav(multi, from, 'Home')).toEqual({ row: 1, col: 0 })
    expect(nav(multi, from, 'End')).toEqual({ row: 1, col: 2 })
    expect(nav(multi, from, 'PageUp', { pageRows: 1 })).toEqual({ row: 0, col: 1 })
    expect(nav(multi, from, 'PageDown', { pageRows: 1 })).toEqual({ row: 2, col: 1 })
  })
})
