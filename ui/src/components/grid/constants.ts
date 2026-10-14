/** Min card widths matching today's CSS `minmax(W, 1fr)` grid tracks. */
export const MIN_CARD_WIDTH_NORMAL_PX = 150
export const MIN_CARD_WIDTH_WINDOWED_PX = 110
export const MIN_CARD_WIDTH_COMPACT_PX = 110
export const MIN_CARD_WIDTH_COMPACT_WINDOWED_PX = 80

/** Tailwind `gap-2` / `gap-1` in px (default root font size). Same on both axes. */
export const GRID_GAP_NORMAL_PX = 8
export const GRID_GAP_COMPACT_PX = 4

/** Row gap equals column gap (phase A CSS `gap-*`). */
export const ROW_GAP_NORMAL_PX = GRID_GAP_NORMAL_PX
export const ROW_GAP_COMPACT_PX = GRID_GAP_COMPACT_PX

/** Named rect so jsdom virtualizer tests have a stable layout box. */
export const VIRTUALIZER_TEST_INITIAL_RECT = { width: 800, height: 600 } as const

/**
 * StyleCard chrome height (border-box), excluding inter-row gap.
 * Measured in bench (N=500): windowed `p-2`+`text-xs` = 34; panel fullscreen
 * `p-3`+`text-sm` = 46. Compact only changes gap, not card chrome.
 */
export const CARD_HEIGHT_NORMAL_PX = 46
export const CARD_HEIGHT_WINDOWED_PX = 34

/**
 * Virtualizer card-row size = card height + ROW_GAP.
 * Padding-bottom on the row element carries the gap so v-spacing matches h-gap.
 */
export const CARD_ROW_HEIGHT_NORMAL_PX = CARD_HEIGHT_NORMAL_PX + ROW_GAP_NORMAL_PX
export const CARD_ROW_HEIGHT_COMPACT_PX = CARD_HEIGHT_NORMAL_PX + ROW_GAP_COMPACT_PX
export const CARD_ROW_HEIGHT_WINDOWED_PX = CARD_HEIGHT_WINDOWED_PX + ROW_GAP_NORMAL_PX
/** windowed + compact: smaller card + compact gap. */
export const CARD_ROW_HEIGHT_WINDOWED_COMPACT_PX =
  CARD_HEIGHT_WINDOWED_PX + ROW_GAP_COMPACT_PX

/**
 * Category header content (py-1 + label/button line) + ROW_GAP via padding-bottom.
 * Compact shortens only the gap, not the label chrome.
 */
export const HEADER_CONTENT_HEIGHT_PX = 32
export const HEADER_ROW_HEIGHT_NORMAL_PX = HEADER_CONTENT_HEIGHT_PX + ROW_GAP_NORMAL_PX
export const HEADER_ROW_HEIGHT_COMPACT_PX = HEADER_CONTENT_HEIGHT_PX + ROW_GAP_COMPACT_PX

/** @deprecated Prefer HEADER_ROW_HEIGHT_NORMAL_PX / cardRowHeightPx(). */
export const GRID_HEADER_ROW_ESTIMATE_PX = HEADER_ROW_HEIGHT_NORMAL_PX
/** @deprecated Prefer CARD_ROW_HEIGHT_* / cardRowHeightPx(). */
export const GRID_CARD_ROW_ESTIMATE_NORMAL_PX = CARD_ROW_HEIGHT_NORMAL_PX
/** @deprecated Prefer CARD_ROW_HEIGHT_WINDOWED_PX. */
export const GRID_CARD_ROW_ESTIMATE_WINDOWED_PX = CARD_ROW_HEIGHT_WINDOWED_PX
/** @deprecated Prefer CARD_ROW_HEIGHT_COMPACT_PX. */
export const GRID_CARD_ROW_ESTIMATE_COMPACT_PX = CARD_ROW_HEIGHT_COMPACT_PX

/** Keep ≤5 — profile: each overscan row remounts StyleCards on scroll. */
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

export function rowGapPx(compactMode: boolean): number {
  return gridGapPx(compactMode)
}

/** Exact virtualizer size for a card row (content + ROW_GAP). */
export function cardRowHeightPx(compactMode: boolean, windowed: boolean): number {
  if (windowed && compactMode) return CARD_ROW_HEIGHT_WINDOWED_COMPACT_PX
  if (windowed) return CARD_ROW_HEIGHT_WINDOWED_PX
  if (compactMode) return CARD_ROW_HEIGHT_COMPACT_PX
  return CARD_ROW_HEIGHT_NORMAL_PX
}

/** Exact virtualizer size for a header row (content + ROW_GAP). */
export function headerRowHeightPx(compactMode: boolean): number {
  return compactMode ? HEADER_ROW_HEIGHT_COMPACT_PX : HEADER_ROW_HEIGHT_NORMAL_PX
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

/**
 * Tailwind emits only utilities it can read literally in the source text. These strings must never be
 * assembled from template parts: `minmax(${minW}px,1fr)` was scanned as a mangled rule, the real utility
 * was never generated and slice mode collapsed into a single-column list.
 * The pixel values mirror minCardWidthPx; autoFillGridClass.test.ts enforces that.
 */
function autoFillColumnsClass(compactMode: boolean, windowed: boolean): string {
  if (compactMode && windowed) return 'grid-cols-[repeat(auto-fill,minmax(80px,1fr))]'
  if (compactMode) return 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))]'
  if (windowed) return 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))]'
  return 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]'
}

/** `auto-fill` CSS grid for the non-virtualized path (slice-selection mode). */
export function autoFillGridClass(compactMode: boolean, windowed: boolean): string {
  return ['grid', 'content-start', autoFillColumnsClass(compactMode, windowed), gridGapClass(compactMode)].join(' ')
}
