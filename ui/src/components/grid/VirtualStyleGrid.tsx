import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual'
import type { Style } from '../../bridge'
import {
  activeStickyHeaderIndex,
  buildGridRows,
  findHeaderRowIndex,
  headerRowIndexes,
  type CategoryGroup,
  type GridRow,
} from './buildGridRows'
import { CardsRow } from './CardsRow'
import { CategoryHeaderRow } from './CategoryHeaderRow'
import {
  cardRowHeightPx,
  columnsForWidth,
  GRID_VIRTUAL_OVERSCAN,
  headerRowHeightPx,
  rowGapPx,
  VIRTUALIZER_TEST_INITIAL_RECT,
  gridGapPx,
  minCardWidthPx,
} from './constants'

export type VirtualStyleGridProps = {
  groups: readonly CategoryGroup[]
  collapsedCategories: ReadonlySet<string>
  compactMode: boolean
  windowed: boolean
  includeHeaders?: boolean
  enableLoraContextMenu?: boolean
  onToggleCollapse: (category: string) => void
  onSelectAll: (category: string) => void
  onHeaderContextMenu?: (category: string, clientX: number, clientY: number) => void
  renderCard?: (style: Style) => ReactNode
  /** Optional footer (e.g. LoRA wildcard menu portal host). */
  children?: ReactNode
}

function estimateRowSize(
  row: GridRow | undefined,
  compactMode: boolean,
  windowed: boolean,
): number {
  if (!row || row.kind === 'cards') {
    return cardRowHeightPx(compactMode, windowed)
  }
  return headerRowHeightPx(compactMode)
}

/** Profile (P toggle N=5000): VirtualStyleGrid 21 stack hits — memo + stable groups from StyleGrid. */
export const VirtualStyleGrid = memo(function VirtualStyleGrid({
  groups,
  collapsedCategories,
  compactMode,
  windowed,
  includeHeaders = true,
  enableLoraContextMenu = false,
  onToggleCollapse,
  onSelectAll,
  onHeaderContextMenu,
  renderCard,
  children,
}: VirtualStyleGridProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollElRef = useRef<HTMLElement | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const [widthPx, setWidthPx] = useState<number>(VIRTUALIZER_TEST_INITIAL_RECT.width)
  const activeStickyIndexRef = useRef(0)
  const rowsRef = useRef<GridRow[]>([])
  // Profile (scroll N=5000): rangeExtractor new arrays every scroll sample —
  // reuse prior result when start/end/sticky index unchanged.
  const rangeCacheRef = useRef<{
    startIndex: number
    endIndex: number
    sticky: number
    result: number[]
  } | null>(null)

  const minW = minCardWidthPx(compactMode, windowed)
  const gapPx = gridGapPx(compactMode)
  const rowGap = rowGapPx(compactMode)
  const columns = useMemo(
    () => columnsForWidth(widthPx, minW, gapPx),
    [widthPx, minW, gapPx],
  )

  const rows = useMemo(
    () => buildGridRows(groups, collapsedCategories, columns, { includeHeaders }),
    [groups, collapsedCategories, columns, includeHeaders],
  )
  rowsRef.current = rows

  const stickyIndexes = useMemo(() => headerRowIndexes(rows), [rows])

  // Catalog size for bench readiness (virtualized DOM card count ≠ N).
  const itemCount = useMemo(
    () => groups.reduce((n, [, styles]) => n + styles.length, 0),
    [groups],
  )

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const parent = root.parentElement
    scrollElRef.current = parent
    setScrollEl(parent)

    const applyWidth = (w: number) => {
      if (w > 0) setWidthPx(w)
    }
    applyWidth(root.clientWidth)

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      applyWidth(entry.contentRect.width)
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  const rangeExtractor = useCallback(
    (range: Range) => {
      if (stickyIndexes.length === 0) {
        return defaultRangeExtractor(range)
      }
      const sticky = activeStickyHeaderIndex(stickyIndexes, range.startIndex)
      activeStickyIndexRef.current = sticky
      const cached = rangeCacheRef.current
      if (
        cached &&
        cached.startIndex === range.startIndex &&
        cached.endIndex === range.endIndex &&
        cached.sticky === sticky
      ) {
        return cached.result
      }
      const next = new Set([sticky, ...defaultRangeExtractor(range)])
      const result = [...next].sort((a, b) => a - b)
      rangeCacheRef.current = {
        startIndex: range.startIndex,
        endIndex: range.endIndex,
        sticky,
        result,
      }
      return result
    },
    [stickyIndexes],
  )

  // Stable identity — profile: recreated estimateSize closed over `rows` forced remounts.
  const estimateSize = useCallback(
    (index: number) => estimateRowSize(rowsRef.current[index], compactMode, windowed),
    [compactMode, windowed],
  )

  // TanStack Virtual returns unstable function identities; React Compiler skips this file.
  // eslint-disable-next-line react-hooks/incompatible-library -- required virtualizer API
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElRef.current ?? scrollEl,
    estimateSize,
    overscan: GRID_VIRTUAL_OVERSCAN,
    rangeExtractor,
    initialRect: VIRTUALIZER_TEST_INITIAL_RECT,
    // Fixed row heights (card + ROW_GAP). No measureElement — measuring remounts
    // on scroll caused multi-second TBT and glued later rows (measured without gap).
  })

  useEffect(() => {
    rangeCacheRef.current = null
    virtualizer.measure()
  }, [columns, compactMode, windowed, virtualizer])

  const scrollToHeader = useCallback(
    (category: string) => {
      const headerIndex = findHeaderRowIndex(rows, category)
      if (headerIndex >= 0) {
        virtualizer.scrollToIndex(headerIndex, { align: 'start' })
      }
    },
    [rows, virtualizer],
  )

  const handleToggleCollapse = useCallback(
    (category: string) => {
      onToggleCollapse(category)
      requestAnimationFrame(() => scrollToHeader(category))
    },
    [onToggleCollapse, scrollToHeader],
  )

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      role="grid"
      aria-rowcount={rows.length}
      data-sg-item-count={itemCount}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index]
          if (!row) return null
          const isActiveSticky =
            row.kind === 'header' &&
            stickyIndexes.length > 0 &&
            virtualRow.index === activeStickyIndexRef.current

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              role="row"
              aria-rowindex={virtualRow.index + 1}
              style={
                isActiveSticky
                  ? {
                      position: 'sticky',
                      top: 0,
                      zIndex: 10,
                      left: 0,
                      width: '100%',
                      // Sticky overlay still needs trailing gap so next row isn't glued.
                      paddingBottom: `${rowGap}px`,
                      boxSizing: 'border-box',
                    }
                  : {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      // ROW_GAP as padding-bottom — matches column gap on both axes.
                      paddingBottom: `${rowGap}px`,
                      boxSizing: 'border-box',
                      transform: `translateY(${virtualRow.start}px)`,
                    }
              }
            >
              {row.kind === 'header' ? (
                <CategoryHeaderRow
                  category={row.category}
                  count={row.count}
                  collapsed={row.collapsed}
                  isStickyActive={isActiveSticky}
                  enableLoraContextMenu={enableLoraContextMenu}
                  onToggleCollapse={handleToggleCollapse}
                  onSelectAll={onSelectAll}
                  onContextMenu={onHeaderContextMenu}
                />
              ) : (
                <CardsRow
                  styles={row.styles}
                  columns={columns}
                  compactMode={compactMode}
                  windowed={windowed}
                  renderCard={renderCard}
                />
              )}
            </div>
          )
        })}
      </div>
      {children}
    </div>
  )
})
