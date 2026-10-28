import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual'
import type { Style } from '../../bridge'
import {
  getFocusedCell,
  setFocusedCell,
  useFocusedCell,
} from '../../lib/gridFocus'
import {
  cellCount,
  nextCell,
  type GridCell,
  type GridNavKey,
} from '../../lib/gridNav'
import {
  activeStickyHeaderIndex,
  buildGridRows,
  categoryPanelId,
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
import {
  getCachedRangeIndexes,
  type StickyRangeCache,
} from './rangeCache'

const NAV_KEYS = new Set<string>([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

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

function firstFocusableCell(rows: readonly GridRow[]): GridCell | null {
  for (let row = 0; row < rows.length; row++) {
    if (cellCount(rows[row]) > 0) return { row, col: 0 }
  }
  return null
}

function clampFocusedCell(
  rows: readonly GridRow[],
  cell: GridCell,
): GridCell | null {
  if (rows.length === 0) return null
  if (cell.row < 0 || cell.row >= rows.length) return firstFocusableCell(rows)
  const count = cellCount(rows[cell.row])
  if (count <= 0) return firstFocusableCell(rows)
  return { row: cell.row, col: Math.max(0, Math.min(cell.col, count - 1)) }
}

/** Sticky overlay chrome — shared object; only paddingBottom varies with compactMode. */
const STICKY_ROW_STYLE_BASE = {
  position: 'sticky',
  top: 0,
  zIndex: 10,
  left: 0,
  width: '100%',
  boxSizing: 'border-box',
} as const

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
  const rangeCacheRef = useRef<StickyRangeCache | null>(null)

  const focusedCell = useFocusedCell()
  const focusedRow = focusedCell?.row ?? null

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

  const pageRows = useMemo(() => {
    const viewportH = scrollEl?.clientHeight ?? VIRTUALIZER_TEST_INITIAL_RECT.height
    const rowH = cardRowHeightPx(compactMode, windowed)
    return Math.max(1, Math.floor(viewportH / rowH))
  }, [scrollEl, compactMode, windowed])

  // Default / clamp roving cell when the row model changes (tab stop only — no focus steal).
  useEffect(() => {
    if (rows.length === 0) {
      setFocusedCell(null)
      return
    }
    const current = getFocusedCell()
    if (!current) {
      setFocusedCell(firstFocusableCell(rows))
      return
    }
    const clamped = clampFocusedCell(rows, current)
    if (!clamped) {
      setFocusedCell(null)
      return
    }
    if (clamped.row !== current.row || clamped.col !== current.col) {
      setFocusedCell(clamped)
    }
  }, [rows])

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
      const focused =
        focusedRow != null &&
        focusedRow >= 0 &&
        focusedRow < rowsRef.current.length
          ? focusedRow
          : null
      if (stickyIndexes.length === 0) {
        const base = defaultRangeExtractor(range)
        if (focused == null) return base
        const hit = getCachedRangeIndexes(rangeCacheRef.current, range, -1, focused)
        if (hit) return hit
        const next = new Set(base)
        next.add(focused)
        const result = [...next].sort((a, b) => a - b)
        rangeCacheRef.current = {
          startIndex: range.startIndex,
          endIndex: range.endIndex,
          sticky: -1,
          focusedRow: focused,
          count: range.count,
          result,
        }
        return result
      }
      const sticky = activeStickyHeaderIndex(stickyIndexes, range.startIndex)
      activeStickyIndexRef.current = sticky
      const hit = getCachedRangeIndexes(rangeCacheRef.current, range, sticky, focused)
      if (hit) return hit
      const next = new Set([sticky, ...defaultRangeExtractor(range)])
      if (focused != null) next.add(focused)
      const result = [...next].sort((a, b) => a - b)
      rangeCacheRef.current = {
        startIndex: range.startIndex,
        endIndex: range.endIndex,
        sticky,
        focusedRow: focused,
        count: range.count,
        result,
      }
      return result
    },
    [stickyIndexes, focusedRow],
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
  }, [columns, compactMode, windowed, focusedRow, rows.length, virtualizer])

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

  // Keep DOM focus on the roving cell after virtualization remounts / scrollToIndex.
  useLayoutEffect(() => {
    if (!focusedCell) return
    const root = rootRef.current
    if (!root) return
    if (!root.contains(document.activeElement)) return
    const el = root.querySelector<HTMLElement>(
      `[data-cell-row="${focusedCell.row}"][data-cell-col="${focusedCell.col}"]`,
    )
    if (el && document.activeElement !== el) {
      el.focus({ preventScroll: true })
    }
  }, [focusedCell, virtualItems])

  const openCardMenuAtCell = useCallback((cell: GridCell) => {
    const root = rootRef.current
    if (!root) return
    const row = rowsRef.current[cell.row]
    if (!row || row.kind !== 'cards') return
    const el = root.querySelector<HTMLElement>(
      `[data-cell-row="${cell.row}"][data-cell-col="${cell.col}"]`,
    )
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left,
        clientY: rect.bottom,
        view: window,
      }),
    )
  }, [])

  const onGridKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (NAV_KEYS.has(e.key)) {
        const from = getFocusedCell() ?? firstFocusableCell(rowsRef.current)
        if (!from) return
        const next = nextCell(
          rowsRef.current,
          columns,
          from,
          e.key as GridNavKey,
          pageRows,
          e.ctrlKey || e.metaKey,
        )
        if (!next) {
          e.preventDefault()
          return
        }
        e.preventDefault()
        setFocusedCell(next)
        virtualizer.scrollToIndex(next.row, { align: 'auto' })
        return
      }

      if (e.key === 'Enter' || e.key === ' ') {
        const cell = getFocusedCell()
        if (!cell) return
        const root = rootRef.current
        const el = root?.querySelector<HTMLElement>(
          `[data-cell-row="${cell.row}"][data-cell-col="${cell.col}"]`,
        )
        // Focused <button> already activates on Enter/Space — do not double-fire.
        if (el && document.activeElement === el) return
        e.preventDefault()
        el?.click()
        return
      }

      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        const cell = getFocusedCell()
        if (!cell) return
        const row = rowsRef.current[cell.row]
        if (!row || row.kind !== 'cards') return
        e.preventDefault()
        openCardMenuAtCell(cell)
      }
    },
    [columns, pageRows, virtualizer, openCardMenuAtCell],
  )

  // Stable sticky padding across scroll frames (compactMode rarely flips).
  const stickyRowStyle = useMemo(
    () => ({
      ...STICKY_ROW_STYLE_BASE,
      paddingBottom: `${rowGap}px`,
    }),
    [rowGap],
  )

  /** Index of the first cards row per category (for aria-controls targets). */
  const firstCardsRowByCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row.kind === 'cards' && !map.has(row.category)) {
        map.set(row.category, i)
      }
    }
    return map
  }, [rows])

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      role="grid"
      aria-label="Styles"
      aria-rowcount={rows.length}
      data-sg-item-count={itemCount}
      onKeyDown={onGridKeyDown}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          if (!virtualRow) return null
          const row = rows[virtualRow.index]
          if (!row) return null
          const isActiveSticky =
            row.kind === 'header' &&
            stickyIndexes.length > 0 &&
            virtualRow.index === activeStickyIndexRef.current
          const rowFocusedCol =
            focusedCell && focusedCell.row === virtualRow.index
              ? focusedCell.col
              : null

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              role="row"
              aria-rowindex={virtualRow.index + 1}
              className={isActiveSticky ? 'bg-sg-bg' : undefined}
              style={
                isActiveSticky
                  ? stickyRowStyle
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
                  rowIndex={virtualRow.index}
                  focusedCol={rowFocusedCol}
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
                  rowIndex={virtualRow.index}
                  focusedCol={rowFocusedCol}
                  categoryPanelId={
                    firstCardsRowByCategory.get(row.category) === virtualRow.index
                      ? categoryPanelId(row.category)
                      : undefined
                  }
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
