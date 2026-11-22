import { useId } from 'react'
import { sourceLabel } from '../lib/sourceLabel'
import { useStylesStore } from '../store/stylesStore'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

const READ_ONLY_NOTE = 'Bundled samples only (read-only) — import a CSV to add your own.'

export function SourceFilter() {
  const { sources, activeSource, setActiveSource, styles } = useStylesStore()
  const readOnlyNoteId = useId()
  if (sources.length === 0) return null
  const onlySourceIsReadOnly = sources.length === 1 &&
    styles.some(s => s.source_file === sources[0] && s.read_only)
  const labelOf = sourceLabel
  const currentLabel = activeSource ? labelOf(activeSource) : 'All Sources'
  const selectWidthCh = Math.min(Math.max(currentLabel.length + 4, 14), 40)
  // The dropdown is the header's designated shrink target (12ch–24ch); the full
  // label (and the read-only note) live in its title.
  const title = onlySourceIsReadOnly ? `${currentLabel}\n${READ_ONLY_NOTE}` : currentLabel

  return (
    <div className="flex items-center min-w-0 shrink">
      <select
        value={activeSource ?? ''}
        onChange={e => setActiveSource(e.target.value || null)}
        aria-label="Style source"
        aria-describedby={onlySourceIsReadOnly ? readOnlyNoteId : undefined}
        className={`h-9 px-2 rounded border border-sg-border bg-sg-surface
                   text-sg-text text-xs focus:border-sg-accent
                   min-w-[12ch] max-w-[24ch] truncate
                   focus:outline-none cursor-pointer ${FOCUS_RING}`}
        style={{ width: `${selectWidthCh}ch` }}
        title={title}
      >
        <option value="">All Sources</option>
        {sources.map(src => (
          <option key={src} value={src} title={src}>
            {labelOf(src)}
          </option>
        ))}
      </select>
      {onlySourceIsReadOnly && (
        // Screen readers get the note as the select's description; sighted users get the title.
        <span id={readOnlyNoteId} className="sr-only">
          {READ_ONLY_NOTE}
        </span>
      )}
    </div>
  )
}
