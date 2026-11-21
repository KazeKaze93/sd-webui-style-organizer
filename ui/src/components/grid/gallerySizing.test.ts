import { describe, expect, it } from 'vitest'
import {
  GALLERY_LABEL_HEIGHT_PX,
  autoFillGridClass,
  cardRowHeightPx,
  galleryCardHeightPx,
  galleryCardWidthPx,
  galleryRowHeightPx,
  gridGapPx,
  gridMinVisibleHeightPx,
  headerRowHeightPx,
  minCardWidthForViewPx,
  minCardWidthPx,
  rowGapPx,
} from './constants'

describe('gallery sizing', () => {
  it.each([
    // containerWidth, columns, gap, expected card width = floor((W - gap×(cols-1)) / cols)
    [760, 5, 8, 145], // 728 / 5 = 145.6
    [600, 4, 8, 144], // 576 / 4
    [1000, 6, 8, 160], // 960 / 6
    [1001, 6, 8, 160], // 961 / 6 = 160.17
    [131, 1, 8, 131],
  ])('galleryCardWidthPx(%i, %i, %i) = %i', (w, cols, gap, expected) => {
    expect(galleryCardWidthPx(w, cols, gap)).toBe(expected)
  })

  it('never returns less than 1, even for a container narrower than its gaps', () => {
    expect(galleryCardWidthPx(0, 1, 8)).toBe(1)
    expect(galleryCardWidthPx(10, 5, 8)).toBe(1)
    expect(galleryCardWidthPx(-50, 3, 8)).toBe(1)
    // A column count below 1 is treated as one column.
    expect(galleryCardWidthPx(200, 0, 8)).toBe(200)
  })

  it('card height = width + the two-line label; row height adds the row gap', () => {
    expect(GALLERY_LABEL_HEIGHT_PX).toBe(44)
    for (const w of [1, 95, 139, 159, 300]) {
      expect(galleryCardHeightPx(w)).toBe(w + 44)
      expect(galleryRowHeightPx(w)).toBe(w + 44 + rowGapPx())
    }
    expect(galleryRowHeightPx(139)).toBe(191)
  })

  it('minCardWidthForViewPx: gallery 150 / 130, grid exactly minCardWidthPx', () => {
    expect(minCardWidthForViewPx(false, 'gallery')).toBe(150)
    expect(minCardWidthForViewPx(true, 'gallery')).toBe(130)
    for (const windowed of [false, true]) {
      expect(minCardWidthForViewPx(windowed, 'grid')).toBe(minCardWidthPx(windowed))
    }
  })

  it('existing grid helpers return what they always did', () => {
    expect([minCardWidthPx(true), minCardWidthPx(false)]).toEqual([110, 150])
    expect(gridGapPx()).toBe(8)
    expect(rowGapPx()).toBe(8)
    expect([cardRowHeightPx(true), cardRowHeightPx(false)]).toEqual([42, 54])
    expect(headerRowHeightPx()).toBe(40)
    expect([gridMinVisibleHeightPx(true), gridMinVisibleHeightPx(false)]).toEqual([124, 148])
    expect(autoFillGridClass(true)).toBe('grid content-start grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2')
    expect(autoFillGridClass(false)).toBe('grid content-start grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2')
  })
})
