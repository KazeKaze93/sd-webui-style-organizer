import { memo } from 'react'
import { setFocusedCell } from '../../lib/gridFocus'
import { useCategoryColor, useCategorySelectedCount } from '../../store/stylesStore'
import { categoryPanelId } from './buildGridRows'

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
  const allSelected = count > 0 && selectedCount === count
  const panelId = categoryPanelId(category)

  return (
    <div
      role="presentation"
      data-sg-category-header={category}
      data-sg-sticky-header={isStickyActive ? 'true' : undefined}
      className={`flex items-center gap-2 py-1
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
      <div role="gridcell" className="min-w-0 flex-1">
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
    </div>
  )
})
