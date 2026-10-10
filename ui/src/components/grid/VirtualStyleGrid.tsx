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
  columnsForWidth,
  GRID_CARD_ROW_ESTIMATE_COMPACT_PX,
  GRID_CARD_ROW_ESTIMATE_NORMAL_PX,
  GRID_HEADER_ROW_ESTIMATE_PX,
  GRID_VIRTUAL_OVERSCAN,
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

function estimateRowSize(row: GridRow | undefined, compactMode: boolean): number {
  if (!row) return GRID_CARD_ROW_ESTIMATE_NORMAL_PX
  if (row.kind === 'header') return GRID_HEADER_ROW_ESTIMATE_PX
  return compactMode
    ? GRID_CARD_ROW_ESTIMATE_COMPACT_PX
    : GRID_CARD_ROW_ESTIMATE_NORMAL_PX
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

  const minW = minCardWidthPx(compactMode, windowed)
  const gapPx = gridGapPx(compactMode)
  const columns = useMemo(
    () => columnsForWidth(widthPx, minW, gapPx),
    [widthPx, minW, gapPx],
  )

  const rows = useMemo(
    () => buildGridRows(groups, collapsedCategories, columns, { includeHeaders }),
    [groups, collapsedCategories, columns, includeHeaders],
  )

  const stickyIndexes = useMemo(() => headerRowIndexes(rows), [rows])

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
      activeStickyIndexRef.current = activeStickyHeaderIndex(
        stickyIndexes,
        range.startIndex,
      )
      const next = new Set([
        activeStickyIndexRef.current,
        ...defaultRangeExtractor(range),
      ])
      return [...next].sort((a, b) => a - b)
    },
    [stickyIndexes],
  )

  // TanStack Virtual returns unstable function identities; React Compiler skips this file.
  // eslint-disable-next-line react-hooks/incompatible-library -- required virtualizer API
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElRef.current ?? scrollEl,
    estimateSize: (index) => estimateRowSize(rows[index], compactMode),
    overscan: GRID_VIRTUAL_OVERSCAN,
    rangeExtractor,
    initialRect: VIRTUALIZER_TEST_INITIAL_RECT,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [columns, compactMode, windowed, rows, virtualizer])

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
    <div ref={rootRef} className="relative w-full">
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
            virtualRow.index === activeStickyIndexRef.current

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={
                isActiveSticky
                  ? {
                      position: 'sticky',
                      top: 0,
                      zIndex: 10,
                      left: 0,
                      width: '100%',
                    }
                  : {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
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
