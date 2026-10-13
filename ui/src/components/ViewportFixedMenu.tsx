import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { fitFixedMenuPosition, MENU_MARGIN } from '../lib/fitFixedMenuPosition'

type Props = {
  x: number
  y: number
  onDismiss: () => void
  children: ReactNode
  className?: string
  style?: CSSProperties
  backdropClassName?: string
}

const DEFAULT_MENU_CLASS =
  'fixed z-[9999] bg-sg-popover border border-sg-border rounded-lg shadow-xl py-1 min-w-52 w-max max-w-sm'

const DEFAULT_BACKDROP_CLASS = 'fixed inset-0 z-[9998]'

const MAX_HEIGHT = `calc(100vh - ${2 * MENU_MARGIN}px)`

/**
 * Fixed context menu portaled to document.body (escapes sidebar overflow),
 * then flipped/clamped to stay inside the iframe viewport using measured size.
 */
export function ViewportFixedMenu({
  x,
  y,
  onDismiss,
  children,
  className = DEFAULT_MENU_CLASS,
  style,
  backdropClassName = DEFAULT_BACKDROP_CLASS,
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
        MENU_MARGIN,
      ),
    )
  }, [x, y])

  return createPortal(
    <>
      <div
        className={backdropClassName}
        onClick={onDismiss}
        onContextMenu={(e) => {
          e.preventDefault()
          onDismiss()
        }}
      />
      <div
        ref={ref}
        className={className}
        style={{
          ...style,
          left: pos.x,
          top: pos.y,
          maxHeight: MAX_HEIGHT,
          overflowY: 'auto',
        }}
        onContextMenu={(e) => e.preventDefault()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}
