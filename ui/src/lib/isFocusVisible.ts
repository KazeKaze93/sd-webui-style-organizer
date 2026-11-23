/**
 * Whether `el` shows visible (keyboard) focus right now. Unlike isTabFocus(),
 * this follows the browser's own heuristic, so arrow-key navigation counts and
 * focus after a mouse click does not. False where `:focus-visible` is unsupported.
 */
export function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return false
  }
}
