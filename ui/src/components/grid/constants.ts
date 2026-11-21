/** Min card widths matching today's CSS `minmax(W, 1fr)` grid tracks. */
export const MIN_CARD_WIDTH_NORMAL_PX = 150
export const MIN_CARD_WIDTH_WINDOWED_PX = 110

/** Tailwind `gap-2` in px (default root font size). Same on both axes. */
export const GRID_GAP_NORMAL_PX = 8

/** Row gap equals column gap (phase A CSS `gap-*`). */
export const ROW_GAP_NORMAL_PX = GRID_GAP_NORMAL_PX

/** Named rect so jsdom virtualizer tests have a stable layout box. */
export const VIRTUALIZER_TEST_INITIAL_RECT = { width: 800, height: 600 } as const

/**
 * StyleCard chrome height (border-box), excluding inter-row gap.
 * Measured in bench (N=500): windowed `p-2`+`text-xs` = 34; panel fullscreen
 * `p-3`+`text-sm` = 46.
 */
export const CARD_HEIGHT_NORMAL_PX = 46
export const CARD_HEIGHT_WINDOWED_PX = 34

/**
 * Virtualizer card-row size = card height + ROW_GAP.
 * Padding-bottom on the row element carries the gap so v-spacing matches h-gap.
 */
export const CARD_ROW_HEIGHT_NORMAL_PX = CARD_HEIGHT_NORMAL_PX + ROW_GAP_NORMAL_PX
export const CARD_ROW_HEIGHT_WINDOWED_PX = CARD_HEIGHT_WINDOWED_PX + ROW_GAP_NORMAL_PX

/** Category header content (py-1 + label/button line) + ROW_GAP via padding-bottom. */
export const HEADER_CONTENT_HEIGHT_PX = 32
export const HEADER_ROW_HEIGHT_NORMAL_PX = HEADER_CONTENT_HEIGHT_PX + ROW_GAP_NORMAL_PX

/** @deprecated Prefer HEADER_ROW_HEIGHT_NORMAL_PX / cardRowHeightPx(). */
export const GRID_HEADER_ROW_ESTIMATE_PX = HEADER_ROW_HEIGHT_NORMAL_PX
/** @deprecated Prefer CARD_ROW_HEIGHT_* / cardRowHeightPx(). */
export const GRID_CARD_ROW_ESTIMATE_NORMAL_PX = CARD_ROW_HEIGHT_NORMAL_PX
/** @deprecated Prefer CARD_ROW_HEIGHT_WINDOWED_PX. */
export const GRID_CARD_ROW_ESTIMATE_WINDOWED_PX = CARD_ROW_HEIGHT_WINDOWED_PX

/** Card rows the grid area always keeps visible, whatever the selection tray holds. */
export const GRID_MIN_VISIBLE_CARD_ROWS = 2

/** Keep ≤5 — profile: each overscan row remounts StyleCards on scroll. */
export const GRID_VIRTUAL_OVERSCAN = 4

export function minCardWidthPx(windowed: boolean): number {
  return windowed ? MIN_CARD_WIDTH_WINDOWED_PX : MIN_CARD_WIDTH_NORMAL_PX
}

export function gridGapPx(): number {
  return GRID_GAP_NORMAL_PX
}

export function rowGapPx(): number {
  return gridGapPx()
}

/** Exact virtualizer size for a card row (content + ROW_GAP). */
export function cardRowHeightPx(windowed: boolean): number {
  return windowed ? CARD_ROW_HEIGHT_WINDOWED_PX : CARD_ROW_HEIGHT_NORMAL_PX
}

/** Exact virtualizer size for a header row (content + ROW_GAP). */
export function headerRowHeightPx(): number {
  return HEADER_ROW_HEIGHT_NORMAL_PX
}

/** Height of one category header plus GRID_MIN_VISIBLE_CARD_ROWS card rows. */
export function gridMinVisibleHeightPx(windowed: boolean): number {
  return headerRowHeightPx() + GRID_MIN_VISIBLE_CARD_ROWS * cardRowHeightPx(windowed)
}

/** CSS gap utility matching {@link gridGapPx}. */
export function gridGapClass(): string {
  return 'gap-2'
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
function autoFillColumnsClass(windowed: boolean): string {
  if (windowed) return 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))]'
  return 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]'
}

/** `auto-fill` CSS grid for the non-virtualized path (slice-selection mode). */
export function autoFillGridClass(windowed: boolean): string {
  return ['grid', 'content-start', autoFillColumnsClass(windowed), gridGapClass()].join(' ')
}
