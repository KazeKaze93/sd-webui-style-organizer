import { useRef, type KeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useGatedTooltip } from '../lib/useGatedTooltip'
import { cn } from '../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

const SEGMENT_CLASS = 'h-6 flex items-center justify-center rounded-sm transition-colors'

/**
 * One segment. With an icon it renders the icon alone with a tooltip (needs a
 * TooltipProvider above); without one it renders the label as text.
 */
export type SegmentOption<T extends string> = {
  value: T
  label: string
  icon?: LucideIcon
  /** Extra attributes for the segment button (e.g. test or styling hooks). */
  data?: Record<`data-${string}`, string>
}

type SegmentProps<T extends string> = {
  option: SegmentOption<T>
  checked: boolean
  onSelect: (value: T) => void
  buttonRef: (el: HTMLButtonElement | null) => void
}

function segmentClass(checked: boolean, iconOnly: boolean) {
  return cn(
    SEGMENT_CLASS,
    iconOnly ? 'w-7' : 'px-2 text-xs font-medium',
    FOCUS_RING,
    checked ? 'bg-sg-accent text-white' : 'text-sg-muted hover:text-sg-text',
  )
}

function IconSegment<T extends string>({ option, checked, onSelect, buttonRef }: SegmentProps<T>) {
  const tip = useGatedTooltip()
  const Icon = option.icon!
  return (
    <Tooltip open={tip.open} onOpenChange={tip.onOpenChange}>
      <TooltipTrigger asChild {...tip.triggerProps}>
        <button
          ref={buttonRef}
          type="button"
          role="radio"
          aria-checked={checked}
          aria-label={option.label}
          // Roving tabindex: only the checked segment is in the tab order.
          tabIndex={checked ? 0 : -1}
          {...option.data}
          onClick={() => onSelect(option.value)}
          className={segmentClass(checked, true)}
        >
          <Icon size={14} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">{option.label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function TextSegment<T extends string>({ option, checked, onSelect, buttonRef }: SegmentProps<T>) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      {...option.data}
      onClick={() => onSelect(option.value)}
      className={segmentClass(checked, false)}
    >
      {option.label}
    </button>
  )
}

/**
 * Segmented radio group: arrows, Home / End move and select; Space / Enter
 * select the focused segment. Shared by the header view toggle and the slice bar.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  data,
}: {
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  data?: Record<`data-${string}`, string>
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  const selectAt = (index: number) => {
    const n = options.length
    const i = ((index % n) + n) % n
    onChange(options[i].value)
    buttons.current[i]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = options.findIndex((o) => o.value === value)
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
        selectAt(options.length - 1)
        break
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="shrink-0 inline-flex items-center gap-0.5 p-[3px] rounded border border-sg-border"
      {...data}
    >
      {options.map((o, i) => {
        const Segment = o.icon ? IconSegment : TextSegment
        return (
          <Segment
            key={o.value}
            option={o}
            checked={value === o.value}
            onSelect={onChange}
            buttonRef={(el) => {
              buttons.current[i] = el
            }}
          />
        )
      })}
    </div>
  )
}
