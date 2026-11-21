import { useCallback, useMemo, useRef, useState } from 'react'
import { isTabFocus } from './focusSource'

/**
 * A Radix tooltip that opens on hover, or on focus only when the focus was a
 * Tab move (lib/focusSource). Focus that a closing menu or dialog puts back on
 * the trigger must not open it: nothing hovers the trigger then, so no
 * pointerleave would ever close it.
 *
 * Spread `triggerProps` on the Radix `TooltipTrigger` (asChild); pass `open`
 * and `onOpenChange` to `Tooltip`. `blocked` keeps it closed (e.g. while the
 * trigger's own menu is open).
 */
export function useGatedTooltip(blocked = false) {
  const [tipOpen, setTipOpen] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const hoveredRef = useRef(false)
  const focusedViaTabRef = useRef(false)

  const onOpenChange = useCallback((next: boolean) => {
    if (!next) {
      setTipOpen(false)
      return
    }
    if (blocked) return
    const tabFocused = document.activeElement === triggerRef.current && isTabFocus()
    if (hoveredRef.current || tabFocused) setTipOpen(true)
  }, [blocked])

  const triggerProps = useMemo(
    () => ({
      ref: (el: HTMLElement | null) => {
        triggerRef.current = el
      },
      onPointerEnter: () => {
        hoveredRef.current = true
      },
      onPointerLeave: () => {
        hoveredRef.current = false
        const tabFocused = document.activeElement === triggerRef.current && focusedViaTabRef.current
        if (!tabFocused) setTipOpen(false)
      },
      onFocus: () => {
        focusedViaTabRef.current = isTabFocus()
      },
      onBlur: () => {
        focusedViaTabRef.current = false
      },
    }),
    [],
  )

  return { open: blocked ? false : tipOpen, onOpenChange, triggerProps }
}
