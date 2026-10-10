/** Min card widths matching today's CSS `minmax(W, 1fr)` grid tracks. */
export const MIN_CARD_WIDTH_NORMAL_PX = 150
export const MIN_CARD_WIDTH_WINDOWED_PX = 110
export const MIN_CARD_WIDTH_COMPACT_PX = 110
export const MIN_CARD_WIDTH_COMPACT_WINDOWED_PX = 80

/** Tailwind `gap-2` / `gap-1` in px (default root font size). */
export const GRID_GAP_NORMAL_PX = 8
export const GRID_GAP_COMPACT_PX = 4

/** Named rect so jsdom virtualizer tests have a stable layout box. */
export const VIRTUALIZER_TEST_INITIAL_RECT = { width: 800, height: 600 } as const

export const GRID_HEADER_ROW_ESTIMATE_PX = 36
export const GRID_CARD_ROW_ESTIMATE_COMPACT_PX = 44
export const GRID_CARD_ROW_ESTIMATE_NORMAL_PX = 56
export const GRID_VIRTUAL_OVERSCAN = 4

export function minCardWidthPx(compactMode: boolean, windowed: boolean): number {
  if (compactMode && windowed) return MIN_CARD_WIDTH_COMPACT_WINDOWED_PX
  if (compactMode) return MIN_CARD_WIDTH_COMPACT_PX
  if (windowed) return MIN_CARD_WIDTH_WINDOWED_PX
  return MIN_CARD_WIDTH_NORMAL_PX
}

export function gridGapPx(compactMode: boolean): number {
  return compactMode ? GRID_GAP_COMPACT_PX : GRID_GAP_NORMAL_PX
}

/** CSS gap utility matching {@link gridGapPx}. */
export function gridGapClass(compactMode: boolean): string {
  return compactMode ? 'gap-1' : 'gap-2'
}

/**
 * Column count matching CSS `repeat(auto-fill, minmax(minW, 1fr))` with the same gap.
 * `widthPx` is the content box width of the grid container.
 */
export function columnsForWidth(
  widthPx: number,
  minCardWidth: number,
  gapPx: number,
): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 1
  return Math.max(1, Math.floor((widthPx + gapPx) / (minCardWidth + gapPx)))
}

/** Legacy `auto-fill` class for non-virtualized paths (slice mode). */
export function autoFillGridClass(compactMode: boolean, windowed: boolean): string {
  const minW = minCardWidthPx(compactMode, windowed)
  const gap = gridGapClass(compactMode)
  return `grid content-start grid-cols-[repeat(auto-fill,minmax(${minW}px,1fr))] ${gap}`
}
