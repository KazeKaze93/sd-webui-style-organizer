import { useRef, type KeyboardEvent } from 'react'
import { LayoutGrid, LayoutList, type LucideIcon } from 'lucide-react'
import { useGatedTooltip } from '../lib/useGatedTooltip'
import { cn } from '../lib/utils'
import { useStylesStore, type ViewMode } from '../store/stylesStore'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

const OPTIONS: ReadonlyArray<{ mode: ViewMode; label: string; icon: LucideIcon }> = [
  { mode: 'grid', label: 'Grid', icon: LayoutList },
  { mode: 'gallery', label: 'Gallery', icon: LayoutGrid },
]

function Segment({
  mode,
  label,
  icon: Icon,
  checked,
  onSelect,
  buttonRef,
}: {
  mode: ViewMode
  label: string
  icon: LucideIcon
  checked: boolean
  onSelect: (mode: ViewMode) => void
  buttonRef: (el: HTMLButtonElement | null) => void
}) {
  const tip = useGatedTooltip()
  return (
    <Tooltip open={tip.open} onOpenChange={tip.onOpenChange}>
      <TooltipTrigger asChild {...tip.triggerProps}>
        <button
          ref={buttonRef}
          type="button"
          role="radio"
          aria-checked={checked}
          aria-label={label}
          // Roving tabindex: only the checked segment is in the tab order.
          tabIndex={checked ? 0 : -1}
          data-sg-view-mode={mode}
          onClick={() => onSelect(mode)}
          className={cn(
            'w-7 h-6 flex items-center justify-center rounded-sm transition-colors',
            FOCUS_RING,
            checked ? 'bg-sg-accent text-white' : 'text-sg-muted hover:text-sg-text',
          )}
        >
          <Icon size={14} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Grid / Gallery switch: a radio group (arrows, Home / End move and select;
 * Space / Enter select the focused segment). Needs a TooltipProvider above it.
 */
export function ViewModeToggle() {
  const viewMode = useStylesStore((s) => s.viewMode)
  const setViewMode = useStylesStore((s) => s.setViewMode)
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  const selectAt = (index: number) => {
    const n = OPTIONS.length
    const i = ((index % n) + n) % n
    setViewMode(OPTIONS[i].mode)
    buttons.current[i]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = OPTIONS.findIndex((o) => o.mode === viewMode)
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        selectAt(current + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        selectAt(current - 1)
        break
      case 'Home':
        e.preventDefault()
        selectAt(0)
        break
      case 'End':
        e.preventDefault()
        selectAt(OPTIONS.length - 1)
        break
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="View"
      onKeyDown={onKeyDown}
      className="shrink-0 inline-flex items-center gap-0.5 p-[3px] rounded border border-sg-border"
      data-sg-view-toggle="true"
    >
      {OPTIONS.map((o, i) => (
        <Segment
          key={o.mode}
          mode={o.mode}
          label={o.label}
          icon={o.icon}
          checked={viewMode === o.mode}
          onSelect={setViewMode}
          buttonRef={(el) => {
            buttons.current[i] = el
          }}
        />
      ))}
    </div>
  )
}
