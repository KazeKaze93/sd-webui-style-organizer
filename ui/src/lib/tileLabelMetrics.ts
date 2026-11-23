/**
 * Layout reads for the expanded grid tile (kept here so tests can mock them:
 * jsdom has no layout). Called when an expansion is shown, never per render.
 */

export type TileLabelMetrics = {
  /** The name does not fit on the tile's single line. */
  truncated: boolean
  /** Full width of the name text, in unscaled CSS px. */
  textWidth: number
  /** Width the name may use on the tile (label width minus its right padding). */
  contentWidth: number
  /** Tile width outside the name: border, paddings and the right indicator space. */
  chrome: number
}

/** Measures the name label of a grid tile (`[data-sg-grid-label]` inside `tile`). */
export function measureTileLabel(tile: HTMLElement): TileLabelMetrics | null {
  const label = tile.querySelector<HTMLElement>('[data-sg-grid-label]')
  if (!label) return null
  const range = document.createRange()
  // No layout engine (jsdom): nothing to measure.
  if (typeof range.getBoundingClientRect !== 'function') return null
  range.selectNodeContents(label)
  const rawTextWidth = range.getBoundingClientRect().width
  range.detach()
  // Undo the hover scale: the rect is transformed, offsetWidth is not.
  const tileRectWidth = tile.getBoundingClientRect().width
  const scale = tile.offsetWidth > 0 && tileRectWidth > 0 ? tileRectWidth / tile.offsetWidth : 1
  const textWidth = rawTextWidth / scale
  const paddingRight = Number.parseFloat(getComputedStyle(label).paddingRight) || 0
  const contentWidth = label.clientWidth - paddingRight
  return {
    truncated: textWidth > contentWidth + 0.5,
    textWidth,
    contentWidth,
    chrome: tile.offsetWidth - contentWidth,
  }
}

/** Border-box height of the expanded overlay (wrapped name only). */
export function measureOverlayHeight(el: HTMLElement): number {
  return el.offsetHeight
}
