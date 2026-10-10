import { describe, expect, it } from 'vitest'
import type { Style } from '../../bridge'
import {
  activeStickyHeaderIndex,
  buildGridRows,
  findHeaderRowIndex,
  headerRowIndexes,
} from './buildGridRows'
import { columnsForWidth, MIN_CARD_WIDTH_NORMAL_PX, GRID_GAP_NORMAL_PX } from './constants'

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

describe('columnsForWidth', () => {
  it('matches auto-fill formula for normal metrics', () => {
    // (800 + 8) / (150 + 8) = 5.11 → 5
    expect(columnsForWidth(800, MIN_CARD_WIDTH_NORMAL_PX, GRID_GAP_NORMAL_PX)).toBe(5)
  })

  it('returns at least 1 for tiny or invalid widths', () => {
    expect(columnsForWidth(0, MIN_CARD_WIDTH_NORMAL_PX, GRID_GAP_NORMAL_PX)).toBe(1)
    expect(columnsForWidth(-10, MIN_CARD_WIDTH_NORMAL_PX, GRID_GAP_NORMAL_PX)).toBe(1)
    expect(columnsForWidth(40, MIN_CARD_WIDTH_NORMAL_PX, GRID_GAP_NORMAL_PX)).toBe(1)
  })
})

describe('buildGridRows', () => {
  const body = [style('BODY_A', 'BODY'), style('BODY_B', 'BODY'), style('BODY_C', 'BODY')]
  const hair = [style('HAIR_A', 'HAIR'), style('HAIR_B', 'HAIR')]
  const groups: Array<[string, Style[]]> = [
    ['BODY', body],
    ['HAIR', hair],
  ]

  it('chunks card rows by columns and keeps headers', () => {
    const rows = buildGridRows(groups, new Set(), 2)
    expect(rows.map((r) => r.kind)).toEqual([
      'header',
      'cards',
      'cards',
      'header',
      'cards',
    ])
    expect(rows[0]).toMatchObject({ kind: 'header', category: 'BODY', count: 3, collapsed: false })
    expect(rows[1]).toMatchObject({ kind: 'cards', category: 'BODY' })
    if (rows[1].kind === 'cards') expect(rows[1].styles).toHaveLength(2)
    if (rows[2].kind === 'cards') expect(rows[2].styles).toHaveLength(1)
    expect(rows[3]).toMatchObject({ kind: 'header', category: 'HAIR', count: 2, collapsed: false })
  })

  it('collapsed category emits header only', () => {
    const rows = buildGridRows(groups, new Set(['BODY']), 2)
    expect(rows.map((r) => (r.kind === 'header' ? r.category : r.kind))).toEqual([
      'BODY',
      'HAIR',
      'cards',
    ])
    expect(rows[0]).toMatchObject({ kind: 'header', category: 'BODY', collapsed: true, count: 3 })
  })

  it('omits empty categories', () => {
    const withEmpty: Array<[string, Style[]]> = [
      ['BODY', body],
      ['EMPTY', []],
      ['HAIR', hair],
    ]
    const rows = buildGridRows(withEmpty, new Set(), 3)
    expect(rows.filter((r) => r.kind === 'header').map((r) => r.category)).toEqual([
      'BODY',
      'HAIR',
    ])
  })

  it('single category filter without headers is cards-only', () => {
    const single: Array<[string, Style[]]> = [['BODY', body]]
    const rows = buildGridRows(single, new Set(), 2, { includeHeaders: false })
    expect(rows.every((r) => r.kind === 'cards')).toBe(true)
    expect(rows).toHaveLength(2)
    if (rows[0].kind === 'cards') {
      expect(rows[0].styles.map((s) => s.name)).toEqual(['BODY_A', 'BODY_B'])
    }
  })
})

describe('header index helpers', () => {
  it('finds header indexes and active sticky header', () => {
    const rows = buildGridRows(
      [
        ['BODY', [style('BODY_A', 'BODY'), style('BODY_B', 'BODY')]],
        ['HAIR', [style('HAIR_A', 'HAIR')]],
      ],
      new Set(),
      2,
    )
    const headers = headerRowIndexes(rows)
    expect(headers).toEqual([0, 2])
    expect(findHeaderRowIndex(rows, 'HAIR')).toBe(2)
    expect(findHeaderRowIndex(rows, 'MISSING')).toBe(-1)
    expect(activeStickyHeaderIndex(headers, 0)).toBe(0)
    expect(activeStickyHeaderIndex(headers, 1)).toBe(0)
    expect(activeStickyHeaderIndex(headers, 2)).toBe(2)
    expect(activeStickyHeaderIndex(headers, 3)).toBe(2)
  })
})
