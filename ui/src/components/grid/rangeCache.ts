import type { Range } from '@tanstack/react-virtual'

/** Cached sticky/focus range indexes — `count` must match or the entry is stale. */
export type StickyRangeCache = {
  startIndex: number
  endIndex: number
  sticky: number
  focusedRow: number | null
  count: number
  result: number[]
}

/** Return cached indexes only when scroll range, sticky, focus, and row count all match. */
export function getCachedRangeIndexes(
  cached: StickyRangeCache | null,
  range: Pick<Range, 'startIndex' | 'endIndex' | 'count'>,
  sticky: number,
  focusedRow: number | null,
): number[] | null {
  if (
    cached &&
    cached.count === range.count &&
    cached.startIndex === range.startIndex &&
    cached.endIndex === range.endIndex &&
    cached.sticky === sticky &&
    cached.focusedRow === focusedRow
  ) {
    return cached.result
  }
  return null
}
