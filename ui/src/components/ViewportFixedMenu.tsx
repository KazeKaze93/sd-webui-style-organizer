import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { fitFixedMenuPosition } from '../lib/fitFixedMenuPosition'

type Props = {
  x: number
  y: number
  onDismiss: () => void
  children: ReactNode
  className?: string
}

const DEFAULT_MENU_CLASS =
  'fixed z-[9999] bg-sg-popover border border-sg-border rounded-lg shadow-xl py-1 min-w-52 w-max max-w-sm'

/**
 * Fixed context menu portaled to document.body (escapes sidebar overflow),
 * then flipped/clamped to stay inside the iframe viewport.
 */
export function ViewportFixedMenu({
  x,
  y,
  onDismiss,
  children,
  className = DEFAULT_MENU_CLASS,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos(
      fitFixedMenuPosition(
        x,
        y,
        rect.width,
        rect.height,
        window.innerWidth,
        window.innerHeight,
      ),
    )
  }, [x, y])

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onDismiss} />
      <div ref={ref} className={className} style={{ left: pos.x, top: pos.y }}>
        {children}
      </div>
    </>,
    document.body,
  )
}
