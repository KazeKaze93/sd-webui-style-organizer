import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeftRight, ArrowRight } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { Style } from '../bridge'
import { styleRowKey, useStylesStore } from '../store/stylesStore'
import { groupConflictPairs } from '../lib/conflictPairs'
import { getFocusedCell } from '../lib/gridFocus'
import { useLayer } from '../lib/layerStack'
import { trayDisplayName } from '../lib/trayDisplayName'
import { cn } from '../lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

const EMPTY_SELECTED: Style[] = []

/** Profile (P toggle N=5000): own subscription — selection chrome only. */
export function SelectedCountLabel() {
  const count = useStylesStore((s) => s.selectedStyles.length)
  if (count <= 0) return null
  return (
    <span className="text-xs text-sg-muted">
      {count} selected
    </span>
  )
}

/**
 * Conflicts chip in the selection tray header. One card per pair of selected
 * styles whose negative prompt removes the other's tags, with Remove / Keep both.
 * Profile (P toggle): own subscription so conflict updates do not cascade.
 */
export function ConflictsControl() {
  const [open, setOpen] = useState(false)
  /** Set when the last visible pair is resolved: focus goes to the tray, not the (gone) trigger. */
  const focusTrayOnCloseRef = useRef(false)
  const { conflicts, dismissed, toggleStyle, dismissConflictPair } = useStylesStore(
    useShallow((s) => ({
      conflicts: s.conflicts,
      dismissed: s.dismissedConflictPairs,
      toggleStyle: s.toggleStyle,
      dismissConflictPair: s.dismissConflictPair,
    })),
  )
  const selectedStyles = useStylesStore((s) =>
    s.conflicts.length > 0 ? s.selectedStyles : EMPTY_SELECTED,
  )
  const pairs = useMemo(() => groupConflictPairs(conflicts, dismissed), [conflicts, dismissed])

  useLayer(open, () => setOpen(false))

  /** After Remove / Keep both: stay open while pairs remain; otherwise close to the tray. */
  const afterAction = () => {
    const { conflicts: c, dismissedConflictPairs: d } = useStylesStore.getState()
    if (groupConflictPairs(c, d).length > 0) return
    focusTrayOnCloseRef.current = true
    setOpen(false)
    // The trigger unmounts with the last pair; move focus once the popover is gone.
    setTimeout(() => {
      focusTrayOnCloseRef.current = false
      focusSelectionTray()
    }, 0)
  }

  if (pairs.length === 0) return null

  const count = pairs.length
  const noun = count === 1 ? 'conflict' : 'conflicts'
  const styleByKey = (key: string) => selectedStyles.find((s) => styleRowKey(s) === key)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${count} style conflicts`}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-sg-conflicts-trigger="true"
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs',
            'border border-sg-warning-text/50 text-sg-warning-text bg-sg-warning-text/[0.14]',
            'hover:bg-sg-warning-text/20 transition-colors',
            FOCUS_RING,
          )}
        >
          <AlertTriangle size={12} aria-hidden />
          {count} {noun}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => {
          if (focusTrayOnCloseRef.current) e.preventDefault()
        }}
        aria-label={`${count} ${noun} in your selection`}
        data-sg-conflicts-popover="true"
        className="w-auto min-w-[18rem] max-w-[min(28rem,calc(100vw-2.5rem))] max-h-[60vh] overflow-y-auto p-3 gap-2 bg-sg-popover border border-sg-border rounded-lg shadow-xl"
      >
        <div>
          <div className="text-sm font-semibold text-sg-text">
            {count} {noun} in your selection
          </div>
          <div className="text-xs text-sg-muted">
            a style&apos;s negative prompt removes another&apos;s tags
          </div>
        </div>
        {pairs.map((p) => {
          const a = trayDisplayName(p.aName)
          const b = trayDisplayName(p.bName)
          const styleA = styleByKey(p.aKey)
          const styleB = styleByKey(p.bKey)
          const Arrow = p.both ? ArrowLeftRight : ArrowRight
          return (
            <div
              key={p.key}
              className="rounded-md border border-sg-border bg-sg-surface/60 p-2"
              data-sg-conflict-pair={p.both ? 'both' : 'one'}
            >
              <div className="flex min-w-0 items-center gap-1.5 text-sm text-sg-text">
                <span className="truncate" title={a}>{a}</span>
                {/* Direction is spelled out in the reason line below. */}
                <Arrow size={14} aria-hidden className="shrink-0 text-sg-warning-text" />
                <span className="truncate" title={b}>{b}</span>
              </div>
              <div className="mt-0.5 text-xs text-sg-muted">
                {p.both
                  ? "Each style's negative prompt cancels tags from the other."
                  : `${a}'s negative prompt cancels tags from ${b}.`}
              </div>
              <div className="mt-2 flex min-w-0 items-center gap-1.5">
                {[{ name: a, style: styleA }, { name: b, style: styleB }].map(({ name, style }) => (
                  <button
                    key={name + (style ? styleRowKey(style) : '')}
                    type="button"
                    disabled={!style}
                    title={`Remove ${name}`}
                    onClick={() => {
                      if (!style) return
                      toggleStyle(style)
                      afterAction()
                    }}
                    className={cn(
                      'min-w-0 max-w-[45%] truncate rounded border border-sg-border px-2 py-0.5 text-xs text-sg-text',
                      'hover:bg-sg-accent/15 transition-colors disabled:opacity-45',
                      FOCUS_RING,
                    )}
                  >
                    Remove {name}
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => {
                    dismissConflictPair(p.aKey, p.bKey)
                    afterAction()
                  }}
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-xs text-sg-muted hover:text-sg-text transition-colors',
                    FOCUS_RING,
                  )}
                >
                  Keep both
                </button>
              </div>
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Focus target once the conflicts trigger is gone: the selection tray region,
 * else the grid's focused cell (or its first cell). Never document.body by choice.
 */
function focusSelectionTray() {
  const tray = document.querySelector<HTMLElement>('[data-sg-tray="true"][tabindex]')
  if (tray && tray.isConnected) {
    tray.focus()
    return
  }
  const cell = getFocusedCell()
  const cellEl =
    (cell && document.querySelector<HTMLElement>(`[data-cell-row="${cell.row}"][data-cell-col="${cell.col}"]`)) ||
    document.querySelector<HTMLElement>('[data-cell-row][data-cell-col]')
  cellEl?.focus()
}
