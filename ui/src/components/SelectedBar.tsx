import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { styleRowKey, useStylesStore } from '../store/stylesStore'
import { sendToHost, WILDCARD_KIND_DECK, type Style, type WildcardRef } from '../bridge'
import { SHUFFLE_CHIP_TITLE } from '../lib/wildcardLabels'
import { describeSpec } from '../lib/wildcardSlice'
import { wildcardKey } from '../lib/wildcardKey'
import { DeckIcon } from './DeckIcon'
import { SaveSetDialog } from './SaveSetDialog'
import { ConflictsControl, SelectedCountLabel } from './SelectionStatus'
import { SortableChips } from './SortableChips'
import { TRAY_CHIPS_MIN_HEIGHT_PX } from './trayLayout'

const CHIP_FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

const CHIP_BASE =
  'flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors select-none'

const STYLE_CHIP_CLASS = `${CHIP_BASE} bg-sg-accent/20 border border-sg-accent/40 text-sg-text hover:bg-sg-accent/30 ${CHIP_FOCUS_RING}`

const wildcardRefKey = (ref: WildcardRef) => wildcardKey(ref.category, ref.spec, ref.kind)

const displayName = (name: string) =>
  name.includes('_') ? name.split('_').slice(1).join(' ') : name

type WildcardChipInfo = {
  label: string
  title: string | undefined
  isDeck: boolean
  isEmptyFallback: boolean
}

/**
 * Profile (P toggle N=5000): SelectedBar on toggle stacks; bare useStylesStore()
 * re-rendered on unrelated store writes. Narrow subscription.
 *
 * Layout: the header (count, conflicts, Save set) is pinned; both chip groups
 * scroll together inside the tray, whose height is capped in BottomPanel.
 */
export function SelectedBar() {
  const {
    selectedStyles, toggleStyle, setSelectedStyles,
    activeWildcards, setActiveWildcards, removeWildcard,
    styles, activeSource,
  } = useStylesStore(
    useShallow(s => ({
      selectedStyles: s.selectedStyles,
      toggleStyle: s.toggleStyle,
      setSelectedStyles: s.setSelectedStyles,
      activeWildcards: s.activeWildcards,
      setActiveWildcards: s.setActiveWildcards,
      removeWildcard: s.removeWildcard,
      styles: s.styles,
      activeSource: s.activeSource,
    })),
  )
  const [saveOpen, setSaveOpen] = useState(false)

  if (selectedStyles.length === 0 && activeWildcards.length === 0) return null

  /** Same scoping as StyleGrid's allNamesInCategory (category + activeSource).
   * Category match is case-insensitive: chip categories come from lowercased tokens. */
  const allNamesInCategory = (category: string) => {
    const want = category.toLowerCase()
    return styles
      .filter((s) => {
        if ((s.category || 'OTHER').toLowerCase() !== want) return false
        if (activeSource && s.source_file !== activeSource) return false
        return true
      })
      .map((s) => s.name)
  }

  const wildcardInfo = (ref: WildcardRef): WildcardChipInfo => {
    const { category, spec } = ref
    const isDeck = ref.kind === WILDCARD_KIND_DECK
    const { count, names } = describeSpec(category, spec, allNamesInCategory(category))
    const isEmptyFallback = spec !== '' && count === 0

    const label = spec === ''
      ? category
      : isEmptyFallback
        ? `${category} (falls back to all)`
        : `${category} (${count})`

    const sliceTitle = spec === ''
      ? undefined
      : isEmptyFallback
        ? `No styles in this pack match the slice — resolves to a random style from all of ${category} instead.`
        : names.join(', ')
    const title = isDeck
      ? (sliceTitle ? `${SHUFFLE_CHIP_TITLE}. ${sliceTitle}` : SHUFFLE_CHIP_TITLE)
      : sliceTitle
    return { label, title, isDeck, isEmptyFallback }
  }

  return (
    <>
      {/* Shown with wildcards alone too, so Clear stays reachable. The count and
          the conflicts render nothing without selected styles. */}
      <div className="shrink-0 flex items-center gap-2 px-4 pt-2" data-sg-tray-header="true">
        <SelectedCountLabel />
        <ConflictsControl />
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => sendToHost({ type: 'SG_CLEAR_ALL' })}
          aria-label="Clear all selected styles and wildcards"
          className={`shrink-0 px-1.5 py-1 text-xs rounded text-sg-muted hover:text-sg-text
                     transition-colors ${CHIP_FOCUS_RING}`}
        >
          Clear
        </button>
        {selectedStyles.length > 0 && (
          <button
            type="button"
            onClick={() => setSaveOpen(true)}
            className={`shrink-0 px-2.5 py-1 text-xs rounded border border-sg-accent/50
                       bg-sg-accent/15 text-sg-text hover:bg-sg-accent/25 transition-colors
                       ${CHIP_FOCUS_RING}`}
            title="Save current selection as a set"
          >
            Save set ({selectedStyles.length})
          </button>
        )}
      </div>

      {/* Scroll area: dnd-kit auto-scrolls this element while a chip is dragged. */}
      <div
        data-sg-tray-scroll="true"
        className="flex flex-col gap-2 px-4 py-2 overflow-y-auto"
        // Shrink weight: the chips give up height first (down to one row); only
        // then does the style info above start to clip.
        style={{ flex: '1 1000 auto', minHeight: TRAY_CHIPS_MIN_HEIGHT_PX }}
      >
        {selectedStyles.length > 0 && (
          <SortableChips<Style>
            items={selectedStyles}
            getId={styleRowKey}
            getLabel={(s) => displayName(s.name)}
            listLabel="selected styles"
            className="flex flex-wrap gap-2"
            chipClassName={() => STYLE_CHIP_CLASS}
            onRemove={(s) => toggleStyle(s)}
            onReorder={(next) => {
              setSelectedStyles(next)
              sendToHost({
                type: 'SG_REORDER_STYLES',
                styleIds: next.map((s) => styleRowKey(s)),
              })
            }}
            renderChip={(s) => (
              <>
                <span aria-hidden="true" className="text-sg-muted mr-0.5 text-[10px]">⠿</span>
                {displayName(s.name)}
                <button
                  type="button"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => toggleStyle(s)}
                  aria-label={`Remove ${s.name}`}
                  className={`text-sg-muted hover:text-sg-text ml-1
                             transition-colors leading-none rounded-sm
                             ${CHIP_FOCUS_RING}`}
                >✕</button>
              </>
            )}
          />
        )}

        {activeWildcards.length > 0 && (
          <SortableChips<WildcardRef>
            items={activeWildcards}
            getId={wildcardRefKey}
            getLabel={(ref) => wildcardInfo(ref).label}
            listLabel="active wildcards"
            className="flex flex-wrap gap-2"
            chipTitle={(ref) => wildcardInfo(ref).title}
            chipClassName={(ref) =>
              `${CHIP_BASE} ${wildcardInfo(ref).isEmptyFallback
                ? 'bg-sg-warning-text/20 border border-sg-warning-text/50 text-sg-warning-text'
                : 'bg-sg-wildcard/20 border border-sg-wildcard/40 text-sg-text'}
               hover:bg-sg-wildcard/30 ${CHIP_FOCUS_RING}`}
            onRemove={(ref) => removeWildcard(ref)}
            onReorder={(next) => {
              setActiveWildcards(next)
              sendToHost({ type: 'SG_REORDER_WILDCARDS', categories: next })
            }}
            renderChip={(ref) => {
              const { label, isDeck } = wildcardInfo(ref)
              return (
                <>
                  <span aria-hidden="true" className="text-sg-muted mr-0.5 text-[10px]">⠿</span>
                  <span className="mr-0.5">
                    {isDeck
                      ? <DeckIcon className="h-3 w-3 inline-block align-text-bottom shrink-0" />
                      : '🎲'}
                  </span>
                  {isDeck && (
                    <span className="sr-only">{SHUFFLE_CHIP_TITLE}</span>
                  )}
                  {label}
                  <button
                    type="button"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => removeWildcard(ref)}
                    aria-label={`Remove ${ref.category}`}
                    className={`text-sg-muted hover:text-sg-text ml-1 transition-colors leading-none rounded-sm
                               ${CHIP_FOCUS_RING}`}
                  >✕</button>
                </>
              )
            }}
          />
        )}
      </div>

      <SaveSetDialog open={saveOpen} onClose={() => setSaveOpen(false)} />
    </>
  )
}
