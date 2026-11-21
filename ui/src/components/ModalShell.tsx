import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { dismissAllHoverIntents } from '../lib/hoverIntent'
import { useLayer } from '../lib/layerStack'
import { useFocusTrap } from '../lib/useFocusTrap'
import { cn } from '../lib/utils'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

export type ModalShellProps = {
  open: boolean
  /** Called on Escape, overlay click and the close button — never while `busy`. */
  onClose: () => void
  title: ReactNode
  /** Give the title an id you own (e.g. to label an input with it). */
  titleId?: string
  /** A request is in flight: every way of closing is blocked until it ends. */
  busy?: boolean
  /** Element to focus on open; defaults to the first focusable in the dialog. */
  initialFocus?: RefObject<HTMLElement | null>
  /** Width utility for the dialog box. */
  widthClassName?: string
  /** Right-aligned action row (secondary first, primary last). */
  footer?: ReactNode
  children: ReactNode
}

/**
 * The one dialog shell of the iframe: title, close button, body, footer.
 *
 * - Covers the panel only: `fixed inset-0` inside the iframe is the panel.
 * - Escape belongs to the layer stack (App handles the key in the capture
 *   phase), so dialogs, menus, popovers and a held chip close in LIFO order.
 *   A dialog opened from inside another one is simply the newer layer.
 * - Focus is trapped inside and returned to the opener on close.
 * - Opening a dialog dismisses any hover preview: the overlay appears under a
 *   still pointer, so no mouseleave would reach the card.
 */
export function ModalShell({
  open,
  onClose,
  title,
  titleId,
  busy = false,
  initialFocus,
  widthClassName = 'w-[22rem]',
  footer,
  children,
}: ModalShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const ownTitleId = useId()
  const labelId = titleId ?? ownTitleId

  // Returning false keeps the layer on the stack: a busy dialog is still the
  // top layer, so the next Escape must reach it again, not the panel below.
  useLayer(open, () => {
    if (busy) return false
    onClose()
  })
  useFocusTrap(dialogRef, open, { initialFocus })

  useEffect(() => {
    if (open) dismissAllHoverIntents()
  }, [open])

  if (!open) return null

  const requestClose = () => {
    if (!busy) onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999]" data-sg-modal="true">
      <div
        className="absolute inset-0 bg-black/50"
        data-sg-modal-overlay="true"
        onClick={requestClose}
      />
      <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          aria-busy={busy || undefined}
          className={cn(
            'pointer-events-auto flex max-h-full max-w-full flex-col',
            'bg-sg-surface border border-sg-border rounded-lg shadow-xl',
            widthClassName,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 flex items-center justify-between gap-3 px-4 pt-3 pb-2">
            <div id={labelId} className="min-w-0 truncate text-[15px] font-semibold text-sg-text">
              {title}
            </div>
            <button
              type="button"
              aria-label="Close"
              disabled={busy}
              onClick={requestClose}
              className={cn(
                '-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded',
                'text-sg-muted hover:text-sg-text hover:bg-sg-accent/20 transition-colors',
                'disabled:opacity-45 disabled:cursor-not-allowed',
                FOCUS_RING,
              )}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto px-4 pb-1">{children}</div>
          {footer ? (
            <div className="shrink-0 flex justify-end gap-2 px-4 pt-2 pb-4">{footer}</div>
          ) : (
            <div className="shrink-0 pb-3" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
