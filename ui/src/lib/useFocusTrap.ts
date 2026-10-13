import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export type FocusTrapOptions = {
  initialFocus?: RefObject<HTMLElement | null>
  /** When true (default), restore focus to the element that had it before activate. */
  restoreFocus?: boolean
}

function listFocusable(container: HTMLElement): HTMLElement[] {
  const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  return Array.from(nodes).filter((el) => {
    if (el.closest('[aria-hidden="true"]')) return false
    if (el.getAttribute('tabindex') === '-1') return false
    return true
  })
}

/**
 * Trap Tab / Shift+Tab inside `ref` while `active`.
 * Focuses `initialFocus` (or the first focusable) on open;
 * restores the prior focused element on close when `restoreFocus` is not false.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  options: FocusTrapOptions = {},
): void {
  const { initialFocus, restoreFocus = true } = options
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const initialFocusRef = useRef(initialFocus)

  useEffect(() => {
    initialFocusRef.current = initialFocus
  })

  useEffect(() => {
    if (!active) return

    const root = ref.current
    if (!root) return

    const activeEl = document.activeElement
    previousFocusRef.current =
      activeEl instanceof HTMLElement ? activeEl : null

    const focusInitial = (): void => {
      const preferred = initialFocusRef.current?.current
      if (preferred && root.contains(preferred)) {
        preferred.focus()
        return
      }
      const focusables = listFocusable(root)
      if (focusables.length > 0) {
        focusables[0].focus()
        return
      }
      if (typeof root.tabIndex !== 'number' || root.tabIndex < 0) {
        root.tabIndex = -1
      }
      root.focus()
    }

    focusInitial()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const focusables = listFocusable(root)
      if (focusables.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const current = document.activeElement

      if (event.shiftKey) {
        if (current === first || !root.contains(current)) {
          event.preventDefault()
          last.focus()
        }
        return
      }

      if (current === last || !root.contains(current)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (restoreFocus) {
        const previous = previousFocusRef.current
        if (previous && typeof previous.focus === 'function') {
          previous.focus()
        }
      }
    }
  }, [active, ref, restoreFocus])
}
