/** Padding from viewport edges when clamping a fixed context menu. */
export const MENU_MARGIN = 8

/** @deprecated Prefer MENU_MARGIN — same value. */
export const MENU_VIEWPORT_PAD = MENU_MARGIN

/**
 * Place a fixed menu at (x, y) without leaving the viewport.
 * Flips upward when there is not enough room below the anchor,
 * then clamps to edges (same idea as ThumbnailPreview flip).
 *
 * Callers that may exceed the viewport must cap height (e.g.
 * max-height: calc(100vh - 2*MENU_MARGIN) + overflow-y:auto) before
 * or while measuring; this helper only returns left/top.
 */
export function fitFixedMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  pad: number = MENU_MARGIN,
): { x: number; y: number } {
  let left = x
  let top = y

  if (top + height > viewportHeight - pad) {
    top = Math.max(pad, top - height)
  }
  if (top + height > viewportHeight - pad) {
    top = Math.max(pad, viewportHeight - height - pad)
  }
  if (top < pad) {
    top = pad
  }

  if (left + width > viewportWidth - pad) {
    left = Math.max(pad, viewportWidth - width - pad)
  }
  if (left < pad) {
    left = pad
  }

  return { x: left, y: top }
}
