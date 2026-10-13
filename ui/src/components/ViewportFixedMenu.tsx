import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { fitFixedMenuPosition, MENU_MARGIN } from '../lib/fitFixedMenuPosition'
import { useLayer } from '../lib/layerStack'
import { cn } from '../lib/utils'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

const DEFAULT_MENU_CLASS =
  'fixed z-[9999] bg-sg-popover border border-sg-border rounded-lg shadow-xl py-1 min-w-52 w-max max-w-sm'

const DEFAULT_BACKDROP_CLASS = 'fixed inset-0 z-[9998]'

const DEFAULT_MENU_ITEM_CLASS =
  'w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors disabled:opacity-45 disabled:pointer-events-none'

const MAX_HEIGHT = `calc(100vh - ${2 * MENU_MARGIN}px)`

type Props = {
  /** When omitted, the menu is treated as open (conditional-mount callers). */
  open?: boolean
  x: number
  y: number
  onClose?: () => void
  /** @deprecated Prefer `onClose`. Kept so parallel callers keep compiling. */
  onDismiss?: () => void
  restoreFocusTo?: HTMLElement | null
  children: ReactNode
  className?: string
  style?: CSSProperties
  backdropClassName?: string
}

function enabledMenuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).filter((el) => {
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('aria-disabled') === 'true') return false
    return true
  })
}

function allMenuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

function syncRovingTabIndex(menu: HTMLElement, focused: HTMLElement | null): void {
  const enabled = new Set(enabledMenuItems(menu))
  for (const item of allMenuItems(menu)) {
    item.tabIndex = focused && item === focused && enabled.has(item) ? 0 : -1
  }
}

function focusMenuItem(menu: HTMLElement, item: HTMLElement): void {
  syncRovingTabIndex(menu, item)
  item.focus()
}

/**
 * Fixed context menu portaled to document.body (escapes sidebar overflow),
 * then flipped/clamped to stay inside the iframe viewport using measured size.
 *
 * Keyboard: role=menu, MenuItem roving focus, Escape via layer stack, Tab closes.
 */
export function ViewportFixedMenu({
  open = true,
  x,
  y,
  onClose,
  onDismiss,
  restoreFocusTo,
  children,
  className = DEFAULT_MENU_CLASS,
  style,
  backdropClassName = DEFAULT_BACKDROP_CLASS,
}: Props) {
  const close = onClose ?? onDismiss
  const ref = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [pos, setPos] = useState({ x, y })

  const dismiss = useCallback(() => {
    close?.()
  }, [close])

  useLayer(open && !!close, dismiss)

  useLayoutEffect(() => {
    if (!open) return
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
  }, [open, x, y])

  useEffect(() => {
    if (!open) return

    const active = document.activeElement
    previousFocusRef.current =
      active instanceof HTMLElement ? active : null

    const menu = ref.current
    if (menu) {
      const items = enabledMenuItems(menu)
      if (items.length > 0) {
        focusMenuItem(menu, items[0])
      } else {
        syncRovingTabIndex(menu, null)
        if (menu.tabIndex < 0) menu.tabIndex = -1
        menu.focus()
      }
    }

    return () => {
      const target = restoreFocusTo ?? previousFocusRef.current
      if (target && typeof target.focus === 'function') {
        target.focus()
      }
    }
  }, [open, restoreFocusTo])

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const menu = ref.current
    if (!menu) return
    const items = enabledMenuItems(menu)

    if (e.key === 'Tab') {
      e.preventDefault()
      dismiss()
      return
    }

    if (items.length === 0) return

    const currentIndex = items.indexOf(document.activeElement as HTMLElement)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next =
        currentIndex < 0 ? items[0] : items[(currentIndex + 1) % items.length]
      focusMenuItem(menu, next)
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next =
        currentIndex < 0
          ? items[items.length - 1]
          : items[(currentIndex - 1 + items.length) % items.length]
      focusMenuItem(menu, next)
      return
    }

    if (e.key === 'Home') {
      e.preventDefault()
      focusMenuItem(menu, items[0])
      return
    }

    if (e.key === 'End') {
      e.preventDefault()
      focusMenuItem(menu, items[items.length - 1])
      return
    }

    // Enter / Space: native button activation when a menuitem is focused.
  }

  if (!open) return null

  return createPortal(
    <>
      <div
        className={backdropClassName}
        onClick={dismiss}
        onContextMenu={(e) => {
          e.preventDefault()
          dismiss()
        }}
      />
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
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
        onKeyDown={onMenuKeyDown}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}

type MenuItemProps = {
  onSelect?: () => void
  disabled?: boolean
  children?: ReactNode
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled' | 'role' | 'type'>

/** Menu row for ViewportFixedMenu — role=menuitem with shared focus ring. */
export function MenuItem({
  onSelect,
  disabled = false,
  children,
  className,
  ...rest
}: MenuItemProps) {
  return (
    <button
      {...rest}
      type="button"
      role="menuitem"
      disabled={disabled}
      tabIndex={-1}
      className={cn(DEFAULT_MENU_ITEM_CLASS, FOCUS_RING, className)}
      onClick={() => {
        if (disabled) return
        onSelect?.()
      }}
      onFocus={(e) => {
        const menu = e.currentTarget.closest('[role="menu"]')
        if (menu instanceof HTMLElement) {
          syncRovingTabIndex(menu, e.currentTarget)
        }
        rest.onFocus?.(e)
      }}
    >
      {children}
    </button>
  )
}
