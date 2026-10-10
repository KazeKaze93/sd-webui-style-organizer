import type { Style } from '../../bridge'

export type GridRow =
  | { kind: 'header'; category: string; count: number; collapsed: boolean }
  | { kind: 'cards'; category: string; styles: readonly Style[] }

export type CategoryGroup = readonly [category: string, styles: readonly Style[]]

export type BuildGridRowsOptions = {
  /** When false, emit only card rows (single-category flat grid). Default true. */
  includeHeaders?: boolean
}

/**
 * Flatten category groups into virtualizer rows.
 * Collapsed categories contribute a header row only.
 * Empty categories are omitted.
 */
export function buildGridRows(
  groups: readonly CategoryGroup[],
  collapsed: ReadonlySet<string>,
  columns: number,
  options?: BuildGridRowsOptions,
): GridRow[] {
  const cols = Math.max(1, Math.floor(columns) || 1)
  const includeHeaders = options?.includeHeaders !== false
  const rows: GridRow[] = []

  for (const [category, styles] of groups) {
    if (styles.length === 0) continue
    const isCollapsed = collapsed.has(category)

    if (includeHeaders) {
      rows.push({
        kind: 'header',
        category,
        count: styles.length,
        collapsed: isCollapsed,
      })
      if (isCollapsed) continue
    } else if (isCollapsed) {
      continue
    }

    for (let i = 0; i < styles.length; i += cols) {
      rows.push({
        kind: 'cards',
        category,
        styles: styles.slice(i, i + cols),
      })
    }
  }

  return rows
}

/** Index of the header row for `category`, or -1. */
export function findHeaderRowIndex(rows: readonly GridRow[], category: string): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.kind === 'header' && row.category === category) return i
  }
  return -1
}

/** Ascending header indexes for sticky `rangeExtractor`. */
export function headerRowIndexes(rows: readonly GridRow[]): number[] {
  const indexes: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind === 'header') indexes.push(i)
  }
  return indexes
}

/** Active sticky header = last header index at or before `startIndex`. */
export function activeStickyHeaderIndex(
  headerIndexes: readonly number[],
  startIndex: number,
): number {
  if (headerIndexes.length === 0) return 0
  let active = headerIndexes[0]
  for (const index of headerIndexes) {
    if (index <= startIndex) active = index
    else break
  }
  return active
}
