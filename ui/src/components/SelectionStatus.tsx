import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { Style } from '../bridge'
import { styleRowKey, useStylesStore } from '../store/stylesStore'
import { useLayer } from '../lib/layerStack'
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
 * Profile (P toggle): own subscription so conflict updates do not cascade.
 * Lives in the selection tray header; the popover opens upward from there.
 */
export function ConflictsControl() {
  const [conflictsOpen, setConflictsOpen] = useState(false)
  const { conflicts, styles, toggleStyle } = useStylesStore(
    useShallow((s) => ({
      conflicts: s.conflicts,
      styles: s.styles,
      toggleStyle: s.toggleStyle,
    })),
  )
  const selectedStyles = useStylesStore((s) =>
    s.conflicts.length > 0 ? s.selectedStyles : EMPTY_SELECTED,
  )

  useLayer(conflictsOpen, () => setConflictsOpen(false))

  if (conflicts.length === 0) return null

  return (
    <Popover open={conflictsOpen} onOpenChange={setConflictsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${conflicts.length} style conflicts`}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded',
            'bg-red-500/20 border border-red-500/40',
            'text-red-400 text-xs',
            'motion-safe:animate-pulse',
            FOCUS_RING,
          )}
        >
          <AlertTriangle size={14} aria-hidden />
          {conflicts.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="w-auto min-w-64 max-w-[min(20rem,calc(100vw-2.5rem))] p-3 bg-sg-popover border border-sg-border rounded-lg shadow-xl"
      >
        <div className="text-xs font-semibold text-white mb-2">
          Style Conflicts
        </div>
        {conflicts.map((c, i) => {
          const conflictingStyle = selectedStyles.find(s => styleRowKey(s) === c.styleBKey)
            ?? styles.find(s => styleRowKey(s) === c.styleBKey)
          return (
            <div key={i} className="flex items-start justify-between gap-2 py-0.5">
              <span className="text-xs text-red-400 min-w-0 flex-1 break-words">
                {c.reason}
              </span>
              {conflictingStyle && (
                <button
                  type="button"
                  onClick={() => {
                    toggleStyle(conflictingStyle)
                    setConflictsOpen(false)
                  }}
                  className="text-xs px-1.5 py-0.5 rounded border
                    border-red-500/40 text-red-400 hover:bg-red-500/20
                    transition-colors shrink-0"
                  title={`Remove "${c.styleB}"`}
                >
                  ✕
                </button>
              )}
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
