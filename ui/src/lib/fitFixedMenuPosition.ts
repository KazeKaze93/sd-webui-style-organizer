/** Padding from viewport edges when clamping a fixed context menu. */
export const MENU_VIEWPORT_PAD = 8

/**
 * Place a fixed menu at (x, y) without leaving the viewport.
 * Flips upward when there is not enough room below the anchor,
 * then clamps to edges (same idea as ThumbnailPreview flip).
 */
export function fitFixedMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  pad: number = MENU_VIEWPORT_PAD,
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
