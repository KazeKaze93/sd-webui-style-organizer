import { useMemo, useState } from 'react'
import { Plus, SearchX } from 'lucide-react'
import { quoteQuery } from '../lib/quoteQuery'
import { cn } from '../lib/utils'
import { useStylesStore } from '../store/stylesStore'
import { EmptyState } from './EmptyState'
import { PresetCard } from './PresetCard'
import { SaveSetDialog } from './SaveSetDialog'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

/** Last grid cell: saves the current selection as a new set (same dialog as the tray's Save set). */
function SaveSelectionTile({ onOpen }: { onOpen: () => void }) {
  const hasSelection = useStylesStore(
    (s) => s.selectedStyles.length > 0 || s.activeWildcards.length > 0,
  )
  return (
    <button
      type="button"
      disabled={!hasSelection}
      aria-disabled={!hasSelection}
      onClick={onOpen}
      data-sg-save-tile
      className={cn(
        'min-h-[150px] rounded-xl border border-dashed border-sg-border',
        'flex flex-col items-center justify-center gap-1.5 text-sm transition-colors',
        hasSelection
          ? 'text-sg-muted hover:text-sg-text hover:border-sg-accent/60 hover:bg-sg-accent/5'
          : 'text-sg-muted/60 cursor-not-allowed',
        FOCUS_RING,
      )}
    >
      <Plus size={18} aria-hidden />
      {hasSelection ? 'Save current selection' : 'Select styles first'}
    </button>
  )
}

export function PresetList() {
  const presets = useStylesStore((s) => s.presets)
  const search = useStylesStore((s) => s.search)
  const setSearch = useStylesStore((s) => s.setSearch)
  const [saveOpen, setSaveOpen] = useState(false)

  const names = useMemo(() => {
    const q = search.trim().toLowerCase()
    return Object.keys(presets)
      .filter((name) => {
        if (!q) return true
        const note = presets[name]?.note || ''
        return name.toLowerCase().includes(q) || note.toLowerCase().includes(q)
      })
      .sort((a, b) => a.localeCompare(b))
  }, [presets, search])

  const hasPresets = Object.keys(presets).length > 0

  if (hasPresets && names.length === 0) {
    return (
      <EmptyState
        kind="no-preset-matches"
        tone="muted"
        icon={SearchX}
        title={`No sets match ${quoteQuery(search)}`}
        actions={[{ label: 'Clear search', variant: 'secondary', onClick: () => setSearch('') }]}
      />
    )
  }

  return (
    <div className="p-1">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 p-1" data-sg-preset-grid>
        {names.map((name) => (
          <PresetCard key={name} name={name} preset={presets[name]} />
        ))}
        <SaveSelectionTile onOpen={() => setSaveOpen(true)} />
      </div>
      {!hasPresets && (
        <p className="px-2 pt-2 text-xs text-sg-muted">
          Apply merges a set into your current selection.
        </p>
      )}
      <SaveSetDialog open={saveOpen} onClose={() => setSaveOpen(false)} />
    </div>
  )
}
