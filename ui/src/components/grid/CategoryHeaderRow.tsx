import { memo } from 'react'
import { Loader2 } from 'lucide-react'
import { sendToHost } from '../../bridge'
import { setFocusedCell } from '../../lib/gridFocus'
import { batchHeaderText, batchPercent, type PreviewBatch } from '../../lib/previewProgress'
import { useCategoryBatch, useCategoryColor, useCategorySelectedCount } from '../../store/stylesStore'
import { categoryPanelId } from './buildGridRows'
import { HEADER_CONTENT_HEIGHT_PX } from './constants'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

function CategoryName({ category }: { category: string }) {
  const color = useCategoryColor(category)
  return (
    <span
      className="text-xs font-bold tracking-wider uppercase"
      style={{ color }}
    >
      {category}
    </span>
  )
}

/**
 * Category batch preview status, right-aligned before Select All. Skip and
 * Cancel stay out of the grid's roving focus (the header has two cells); the
 * sidebar footer's Cancel is the keyboard path.
 */
function BatchStatus({ batch }: { batch: PreviewBatch }) {
  const running = batch.status === 'running'
  return (
    <div
      data-sg-batch-status={batch.status}
      className="min-w-0 flex items-center gap-1.5 text-xs text-sg-wildcard-text"
    >
      {running && <Loader2 size={12} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      <span className="min-w-0 truncate" data-sg-batch-text="true" title={batchHeaderText(batch)}>
        {running ? (
          <>
            {/* A narrow panel keeps spinner + counter only; the sidebar footer has the words. */}
            <span className="max-[799px]:hidden">Generating previews </span>
            {batch.processed} / {batch.total}
          </>
        ) : (
          batchHeaderText(batch)
        )}
      </span>
      {running && (
        <>
          <button
            type="button"
            tabIndex={-1}
            data-sg-batch-skip="true"
            aria-label="Skip the style being generated"
            onClick={() => sendToHost({ type: 'SG_BATCH_SKIP' })}
            className="shrink-0 px-1.5 py-0.5 rounded text-sg-muted hover:text-sg-text hover:bg-sg-surface/60 transition-colors"
          >
            Skip
          </button>
          <button
            type="button"
            tabIndex={-1}
            data-sg-batch-cancel="true"
            aria-label="Cancel preview generation"
            onClick={() => sendToHost({ type: 'SG_BATCH_CANCEL' })}
            className="shrink-0 px-1.5 h-5 rounded border border-sg-border text-sg-text hover:bg-sg-surface/60 transition-colors"
          >
            Cancel
          </button>
        </>
      )}
    </div>
  )
}

export type CategoryHeaderRowProps = {
  category: string
  count: number
  collapsed: boolean
  isStickyActive: boolean
  enableLoraContextMenu: boolean
  rowIndex: number
  focusedCol: number | null
  onToggleCollapse: (category: string) => void
  onSelectAll: (category: string) => void
  onContextMenu?: (category: string, clientX: number, clientY: number) => void
}

/** Profile (P toggle): CategoryHeaderRow on stacks; already uses useCategorySelectedCount. */
export const CategoryHeaderRow = memo(function CategoryHeaderRow({
  category,
  count,
  collapsed,
  isStickyActive,
  enableLoraContextMenu,
  rowIndex,
  focusedCol,
  onToggleCollapse,
  onSelectAll,
  onContextMenu,
}: CategoryHeaderRowProps) {
  const selectedCount = useCategorySelectedCount(category)
  const batch = useCategoryBatch(category)
  const allSelected = count > 0 && selectedCount === count
  const panelId = categoryPanelId(category)

  return (
    <div
      role="presentation"
      data-sg-category-header={category}
      data-sg-sticky-header={isStickyActive ? 'true' : undefined}
      // Fixed height: the virtualizer positions the next row from this constant.
      // Natural height (py-1 + 24px glyph line) was 36px and covered the first cards row.
      style={{ height: HEADER_CONTENT_HEIGHT_PX }}
      className={`relative flex items-center gap-2
                 rounded-md transition-colors -mx-1 px-1
                 hover:bg-sg-surface/30
                 ${isStickyActive ? 'bg-sg-bg z-10' : 'bg-sg-bg/95'}`}
      onContextMenu={
        enableLoraContextMenu
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              onContextMenu?.(category, e.clientX, e.clientY)
            }
          : undefined
      }
    >
      {/* With a batch status beside it the name keeps its width; the status shrinks instead. */}
      <div role="gridcell" className={`${batch ? 'min-w-fit' : 'min-w-0'} flex-1`}>
        <button
          type="button"
          data-cell-row={rowIndex}
          data-cell-col={0}
          tabIndex={focusedCol === 0 ? 0 : -1}
          aria-expanded={!collapsed}
          aria-controls={panelId}
          className={`flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 text-left
                      text-sg-text hover:bg-sg-surface/40 transition-colors ${FOCUS_RING}`}
          onFocus={() => setFocusedCell({ row: rowIndex, col: 0 })}
          onClick={() => onToggleCollapse(category)}
        >
          <span className="text-sg-muted" aria-hidden="true">
            {collapsed ? '▶' : '▼'}
          </span>
          <CategoryName category={category} />
          <span className="text-xs text-sg-muted">
            ({count})
          </span>
        </button>
      </div>
      {batch && <BatchStatus batch={batch} />}
      <div role="gridcell" className="shrink-0">
        <button
          type="button"
          data-cell-row={rowIndex}
          data-cell-col={1}
          tabIndex={focusedCol === 1 ? 0 : -1}
          aria-label={`Select all in ${category}`}
          onFocus={() => setFocusedCell({ row: rowIndex, col: 1 })}
          onClick={() => onSelectAll(category)}
          className={`text-xs text-sg-muted hover:text-sg-accent
                     transition-colors px-2 py-0.5 rounded
                     hover:bg-sg-accent/10 ${FOCUS_RING}`}
        >
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
      </div>
      {batch?.status === 'running' && (
        // Inside the fixed-height header (HEADER_CONTENT_HEIGHT_PX): adds no height.
        <div
          aria-hidden="true"
          data-sg-batch-bar="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-sg-wildcard/20"
        >
          {/* Inline width: a dynamic Tailwind class would fail the pre-push residue check. */}
          <div className="h-full bg-sg-wildcard transition-[width]" style={{ width: `${batchPercent(batch)}%` }} />
        </div>
      )}
    </div>
  )
})
