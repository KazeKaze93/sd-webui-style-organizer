import { memo } from 'react'
import { useCategoryColor, useCategorySelectedCount } from '../../store/stylesStore'

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
  onToggleCollapse,
  onSelectAll,
  onContextMenu,
}: CategoryHeaderRowProps) {
  const selectedCount = useCategorySelectedCount(category)
  const allSelected = count > 0 && selectedCount === count

  return (
    <div
      data-sg-category-header={category}
      data-sg-sticky-header={isStickyActive ? 'true' : undefined}
      className={`flex items-center gap-2 py-1 cursor-pointer
                 rounded-md transition-colors -mx-1 px-1
                 hover:bg-sg-surface/30
                 ${isStickyActive ? 'bg-sg-bg z-10' : 'bg-sg-bg/95'}`}
      onClick={() => onToggleCollapse(category)}
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
      <span className="text-sg-muted">
        {collapsed ? '▶' : '▼'}
      </span>
      <CategoryName category={category} />
      <span className="text-xs text-sg-muted">
        ({count})
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onSelectAll(category)
        }}
        className="text-xs text-sg-muted hover:text-sg-accent
                   transition-colors px-2 py-0.5 rounded
                   hover:bg-sg-accent/10"
      >
        {allSelected ? 'Deselect All' : 'Select All'}
      </button>
    </div>
  )
})
