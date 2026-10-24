import { describe, expect, it } from 'vitest'
import { getCachedRangeIndexes, type StickyRangeCache } from './rangeCache'

describe('getCachedRangeIndexes', () => {
  it('reuses cache when scroll range, sticky, focus, and count match', () => {
    const cached: StickyRangeCache = {
      startIndex: 10,
      endIndex: 20,
      sticky: 0,
      focusedRow: null,
      count: 100,
      result: [0, 10, 11, 12, 20],
    }
    expect(
      getCachedRangeIndexes(
        cached,
        { startIndex: 10, endIndex: 20, count: 100 },
        0,
        null,
      ),
    ).toBe(cached.result)
  })

  it('does not return stale indexes after row count shrinks (same scroll range)', () => {
    // Grow → populate cache with large-count indexes …
    const grown: StickyRangeCache = {
      startIndex: 10,
      endIndex: 20,
      sticky: 0,
      focusedRow: 15,
      count: 100,
      result: [0, 10, 11, 12, 15, 20, 50, 80],
    }
    expect(
      getCachedRangeIndexes(
        grown,
        { startIndex: 10, endIndex: 20, count: 100 },
        0,
        15,
      ),
    ).toEqual(grown.result)

    // … then shrink rows; same scroll keys must miss so callers rebuild in-bounds.
    const shrunkCount = 5
    const hit = getCachedRangeIndexes(
      grown,
      { startIndex: 10, endIndex: 20, count: shrunkCount },
      0,
      15,
    )
    expect(hit).toBeNull()
    // Guard: if a caller wrongly reused grown.result, indexes would be >= new count.
    expect(grown.result.some((i) => i >= shrunkCount)).toBe(true)
  })
})
