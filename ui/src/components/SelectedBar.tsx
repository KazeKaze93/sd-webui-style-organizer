import { useState } from 'react'
import { Reorder } from 'framer-motion'
import { styleRowKey, useStylesStore } from '../store/stylesStore'
import { sendToHost, WILDCARD_KIND_DECK } from '../bridge'
import { SHUFFLE_CHIP_TITLE } from '../lib/wildcardLabels'
import { describeSpec } from '../lib/wildcardSlice'
import { wildcardKey } from '../lib/wildcardKey'
import { DeckIcon } from './DeckIcon'
import { SaveSetDialog } from './SaveSetDialog'

export function SelectedBar() {
  const {
    selectedStyles, toggleStyle, setSelectedStyles,
    activeWildcards, setActiveWildcards, removeWildcard,
    styles, activeSource,
  } = useStylesStore()
  const [saveOpen, setSaveOpen] = useState(false)

  if (selectedStyles.length === 0 && activeWildcards.length === 0) return null

  const displayName = (name: string) =>
    name.includes('_') ? name.split('_').slice(1).join(' ') : name

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

  return (
    <>
      <div className="flex items-start gap-2 px-4 py-2">
        <div className="min-w-0 flex-1">
          {selectedStyles.length > 0 && (
            <Reorder.Group
              axis="x"
              values={selectedStyles}
              onReorder={(newOrder) => {
                setSelectedStyles(newOrder)
                sendToHost({
                  type: 'SG_REORDER_STYLES',
                  styleIds: newOrder.map((s) => styleRowKey(s)),
                })
              }}
              className="flex flex-wrap gap-2"
              as="div"
            >
              {selectedStyles.map(s => (
                <Reorder.Item
                  key={styleRowKey(s)}
                  value={s}
                  as="span"
                  className="flex items-center gap-1 px-2 py-1 rounded-full
                             bg-sg-accent/20 border border-sg-accent/40
                             text-xs text-sg-text cursor-grab active:cursor-grabbing
                             hover:bg-sg-accent/30 transition-colors select-none"
                  whileDrag={{ scale: 1.05, zIndex: 50 }}
                >
                  <span aria-hidden="true" className="text-sg-muted mr-0.5 text-[10px]">⠿</span>
                  {displayName(s.name)}
                  <button
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => toggleStyle(s)}
                    aria-label={`Remove ${s.name}`}
                    className="text-sg-muted hover:text-sg-text ml-1
                               transition-colors leading-none"
                  >✕</button>
                </Reorder.Item>
              ))}
            </Reorder.Group>
          )}
        </div>
        {selectedStyles.length > 0 && (
          <button
            type="button"
            onClick={() => setSaveOpen(true)}
            className="shrink-0 px-2.5 py-1 text-xs rounded border border-sg-accent/50
                       bg-sg-accent/15 text-sg-text hover:bg-sg-accent/25 transition-colors"
            title="Save current selection as a set"
          >
            Save set ({selectedStyles.length})
          </button>
        )}
      </div>

      {activeWildcards.length > 0 && (
        <Reorder.Group
          axis="x"
          values={activeWildcards}
          onReorder={(newOrder) => {
            setActiveWildcards(newOrder)
            sendToHost({ type: 'SG_REORDER_WILDCARDS', categories: newOrder })
          }}
          className="flex flex-wrap gap-2 px-4 py-2"
          as="div"
        >
          {activeWildcards.map((ref) => {
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
              ? (sliceTitle
                ? `${SHUFFLE_CHIP_TITLE}. ${sliceTitle}`
                : SHUFFLE_CHIP_TITLE)
              : sliceTitle
            return (
              <Reorder.Item
                key={wildcardKey(category, spec, ref.kind)}
                value={ref}
                as="span"
                title={title}
                className={`flex items-center gap-1 px-2 py-1 rounded-full
                           ${isEmptyFallback
                             ? 'bg-sg-warning-text/20 border border-sg-warning-text/50 text-sg-warning-text'
                             : 'bg-sg-wildcard/20 border border-sg-wildcard/40 text-sg-text'}
                           text-xs cursor-grab active:cursor-grabbing
                           hover:bg-sg-wildcard/30 transition-colors select-none`}
                whileDrag={{ scale: 1.05, zIndex: 50 }}
              >
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
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => removeWildcard(ref)}
                  aria-label={`Remove ${category}`}
                  className="text-sg-muted hover:text-sg-text ml-1 transition-colors leading-none"
                >✕</button>
              </Reorder.Item>
            )
          })}
        </Reorder.Group>
      )}

      <SaveSetDialog open={saveOpen} onClose={() => setSaveOpen(false)} />
    </>
  )
}
