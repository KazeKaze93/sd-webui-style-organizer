import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

export type EmptyStateAction = {
  label: string
  onClick: () => void
  variant: 'primary' | 'secondary'
}

type Props = {
  icon: LucideIcon
  title: string
  hint?: string
  actions?: EmptyStateAction[]
  /** accent: nothing here yet; muted: filters hide everything. */
  tone?: 'accent' | 'muted'
  /** Stable id for tests and styling hooks, e.g. "no-favorites". */
  kind?: string
}

/**
 * Empty grid / list area: icon, title, optional hint and actions. role="status"
 * so screen readers hear it when results disappear; focus is never moved here.
 */
export function EmptyState({ icon: Icon, title, hint, actions = [], tone = 'muted', kind }: Props) {
  return (
    <div
      role="status"
      data-sg-empty={kind ?? 'true'}
      className="flex-1 min-h-[220px] flex flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <div
        className="h-[52px] w-[52px] rounded-[14px] bg-sg-surface border border-sg-border flex items-center justify-center"
        data-sg-empty-icon={tone}
      >
        <Icon
          size={24}
          strokeWidth={1.8}
          aria-hidden
          className={tone === 'accent' ? 'text-sg-accent-text' : 'text-sg-muted'}
        />
      </div>
      <h2 className="text-base font-semibold text-sg-text break-words max-w-full">{title}</h2>
      {hint && (
        <p className="text-[13px] leading-relaxed text-sg-muted max-w-[300px]">{hint}</p>
      )}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              data-sg-empty-action={a.variant}
              className={cn(
                'h-8 px-3 rounded-lg text-[13px] border transition-colors',
                a.variant === 'primary'
                  ? 'border-sg-accent bg-sg-accent/[0.18] text-sg-text hover:bg-sg-accent/25'
                  : 'border-sg-border bg-transparent text-sg-text hover:bg-sg-surface',
                FOCUS_RING,
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
