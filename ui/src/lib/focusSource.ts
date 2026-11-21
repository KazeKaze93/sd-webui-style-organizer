/**
 * Where the last focus came from: Tab / Shift+Tab, or anything else.
 *
 * Toolbar tooltips open on hover, or on focus only when that focus was a Tab
 * move. Focus that code restores (a menu or dialog closing) must not open
 * one: nothing hovers the button any more, so no pointerleave would close it.
 *
 * Tab from the host page into the iframe is not seen (that keydown fires in
 * the host document), so the first toolbar button reached that way shows no
 * focus tooltip. Accepted.
 */

let lastKeyWasTab = false
let installedCleanup: (() => void) | null = null

function onKeyDown(e: KeyboardEvent) {
  // Any other key, Escape included, clears it.
  lastKeyWasTab = e.key === 'Tab'
}

function onPointerDown() {
  lastKeyWasTab = false
}

/**
 * Track the focus source on `document` (capture phase). Idempotent: a second
 * call is a no-op returning the same cleanup. The cleanup removes the listeners.
 */
export function installFocusSourceTracking(): () => void {
  if (installedCleanup) return installedCleanup
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  const cleanup = () => {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
    if (installedCleanup === cleanup) installedCleanup = null
  }
  installedCleanup = cleanup
  return cleanup
}

/** True when the last key pressed was Tab and no pointer went down since. */
export function isTabFocus(): boolean {
  return lastKeyWasTab
}

/** Test-only: forget the last key and drop the listeners. */
export function __resetFocusSourceForTests(): void {
  installedCleanup?.()
  lastKeyWasTab = false
}
