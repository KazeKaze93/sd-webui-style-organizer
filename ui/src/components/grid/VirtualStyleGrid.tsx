import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual'
import type { Style } from '../../bridge'
import { styleRowKey, type ViewMode } from '../../store/stylesStore'
import {
  getFocusedCell,
  setFocusedCell,
  useFocusedCell,
} from '../../lib/gridFocus'
import { isFocusVisible } from '../../lib/isFocusVisible'
import { measureTileLabel } from '../../lib/tileLabelMetrics'
import {
  clearTileExpand,
  clearTileFocus,
  clearTileHover,
  getHoverTile,
  setTileFocus,
  setTileHover,
  type TileExpandEntry,
} from '../../lib/tileExpand'
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
import { ExpandedTileOverlay } from './ExpandedTileOverlay'
import {
  cardRowHeightPx,
  columnsForWidth,
  galleryCardHeightPx,
  galleryCardWidthPx,
  galleryRowHeightPx,
  GRID_VIRTUAL_OVERSCAN,
  headerRowHeightPx,
  rowGapPx,
  VIRTUALIZER_TEST_INITIAL_RECT,
  gridGapPx,
  minCardWidthForViewPx,
} from './constants'
import { MISSING_GRID_SCROLLER_MESSAGE, useGridScroller } from './GridScrollerContext'
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
  windowed: boolean
  /** Text tiles (grid) or square preview tiles (gallery). Default grid. */
  viewMode?: ViewMode
  includeHeaders?: boolean
  enableLoraContextMenu?: boolean
  onToggleCollapse: (category: string) => void
  onSelectAll: (category: string) => void
  onHeaderContextMenu?: (category: string, clientX: number, clientY: number) => void
  renderCard?: (style: Style) => ReactNode
  /** Optional footer (e.g. LoRA wildcard menu portal host). */
  children?: ReactNode
}

/** Fixed virtualizer size of a row: card rows take the current card row height. */
function estimateRowSize(row: GridRow | undefined, cardRowHeight: number): number {
  if (!row || row.kind === 'cards') return cardRowHeight
  return headerRowHeightPx()
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

function cardFromTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-sg-card]') : null
}

/** Sticky overlay chrome — shared object; height and paddingBottom are added per render. */
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
  windowed,
  viewMode = 'grid',
  includeHeaders = true,
  enableLoraContextMenu = false,
  onToggleCollapse,
  onSelectAll,
  onHeaderContextMenu,
  renderCard,
  children,
}: VirtualStyleGridProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  // The real scrolling element, provided by <GridScroller>. Never derived from the DOM.
  const { scroller, missing: scrollerMissing } = useGridScroller()
  const [widthPx, setWidthPx] = useState<number>(VIRTUALIZER_TEST_INITIAL_RECT.width)
  /** Distance from the scroller's content top to this grid's top (wrappers, padding). */
  const [scrollMargin, setScrollMargin] = useState(0)

  useEffect(() => {
    if (scrollerMissing) console.error(MISSING_GRID_SCROLLER_MESSAGE)
  }, [scrollerMissing])
  const activeStickyIndexRef = useRef(0)
  const rowsRef = useRef<GridRow[]>([])
  // Profile (scroll N=5000): rangeExtractor new arrays every scroll sample —
  // reuse prior result when start/end/sticky index unchanged.
  const rangeCacheRef = useRef<StickyRangeCache | null>(null)
  // Set by a navigation key: DOM focus must follow the roving cell even if the
  // previously focused row was unmounted first (virtualized out before the
  // scroll caught up), which drops document.activeElement to <body>.
  const pendingKeyboardFocusRef = useRef(false)

  const focusedCell = useFocusedCell()
  const focusedRow = focusedCell?.row ?? null

  const minW = minCardWidthForViewPx(windowed, viewMode)
  const gapPx = gridGapPx()
  const rowGap = rowGapPx()
  const columns = useMemo(
    () => columnsForWidth(widthPx, minW, gapPx),
    [widthPx, minW, gapPx],
  )
  // Gallery: square thumbnail + label, so the row height follows the column width.
  const galleryCardWidth = galleryCardWidthPx(widthPx, columns, gapPx)
  const galleryCardHeight = galleryCardHeightPx(galleryCardWidth)
  const cardRowHeight =
    viewMode === 'gallery' ? galleryRowHeightPx(galleryCardWidth) : cardRowHeightPx(windowed)
  /** Read by the stable estimateSize; updated on every render like rowsRef. */
  const cardRowHeightRef = useRef(cardRowHeight)
  cardRowHeightRef.current = cardRowHeight

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

  // The sticky header covers the top of the viewport; keep scroll targets below it.
  const scrollPaddingStart = stickyIndexes.length > 0 ? headerRowHeightPx() : 0

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

    const applyWidth = (w: number) => {
      if (w > 0) setWidthPx(w)
    }
    // Offset of the grid inside the scroller's scrollable content. Position
    // independent: the rect difference shrinks by scrollTop as we scroll.
    const applyScrollMargin = () => {
      if (!scroller) return
      const margin =
        root.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop
      setScrollMargin((prev) => (Math.abs(prev - margin) < 0.5 ? prev : margin))
    }
    applyWidth(root.clientWidth)
    applyScrollMargin()

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      applyWidth(entry.contentRect.width)
      applyScrollMargin()
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [scroller])

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
    (index: number) => estimateRowSize(rowsRef.current[index], cardRowHeightRef.current),
    [],
  )

  // TanStack Virtual returns unstable function identities; React Compiler skips this file.
  // eslint-disable-next-line react-hooks/incompatible-library -- required virtualizer API
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize,
    overscan: GRID_VIRTUAL_OVERSCAN,
    rangeExtractor,
    initialRect: VIRTUALIZER_TEST_INITIAL_RECT,
    // @tanstack/virtual-core 3.14.14, src/index.ts: every item starts at
    // `paddingStart + scrollMargin` (measurement loop, ~l.1430/1499/1526), so
    // item.start is a scroller scrollTop; getTotalSize() subtracts scrollMargin
    // again (~l.2127). Rows are therefore placed at `start - scrollMargin`.
    scrollMargin,
    // 'auto'/'start' alignment stops this far below the top (~l.1933/1954).
    scrollPaddingStart,
    // Fixed row heights (card + ROW_GAP). No measureElement — measuring remounts
    // on scroll caused multi-second TBT and glued later rows (measured without gap).
  })

  useEffect(() => {
    rangeCacheRef.current = null
    virtualizer.measure()
  }, [columns, windowed, focusedRow, rows.length, scrollMargin, virtualizer])

  // Switching Grid / Gallery or a new gallery row height changes every card
  // row size: drop the cached sizes before paint (fixed heights, no measureElement).
  useLayoutEffect(() => {
    rangeCacheRef.current = null
    virtualizer.measure()
  }, [viewMode, cardRowHeight, virtualizer])

  const scrollToHeader = useCallback(
    (category: string) => {
      const headerIndex = findHeaderRowIndex(rows, category)
      if (headerIndex < 0) return
      // A header goes to the very top (it becomes the sticky row itself), so
      // undo scrollPaddingStart, which exists for rows that sit below a header.
      const target = virtualizer.getOffsetForIndex(headerIndex, 'start')
      if (target) virtualizer.scrollToOffset(target[0] + scrollPaddingStart)
    },
    [rows, virtualizer, scrollPaddingStart],
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
    if (!root.contains(document.activeElement) && !pendingKeyboardFocusRef.current) return
    const el = root.querySelector<HTMLElement>(
      `[data-cell-row="${focusedCell.row}"][data-cell-col="${focusedCell.col}"]`,
    )
    if (!el) return
    pendingKeyboardFocusRef.current = false
    if (document.activeElement !== el) {
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
        // Page = card rows that fit in the scroller viewport below the sticky header.
        const viewportH = scroller?.clientHeight ?? VIRTUALIZER_TEST_INITIAL_RECT.height
        const pageRows = Math.max(
          1,
          Math.floor((viewportH - scrollPaddingStart) / cardRowHeightRef.current),
        )
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
        pendingKeyboardFocusRef.current = true
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
    [columns, scroller, scrollPaddingStart, virtualizer, openCardMenuAtCell],
  )

  // Stable sticky style across scroll frames.
  // Explicit height = the virtual header row size: the sticky row is in normal
  // flow, so anything taller would overlap the first cards row below it.
  const stickyRowStyle = useMemo(
    () => ({
      ...STICKY_ROW_STYLE_BASE,
      height: `${headerRowHeightPx()}px`,
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

  // Expanded names of truncated tiles: grid mode with our own StyleCards only
  // (gallery labels wrap already; slice mode is not virtualized).
  const expandEnabled = viewMode !== 'gallery' && !renderCard

  // Rows are rebuilt on any store change (a favorite toggle too). Only a change in
  // which styles sit in which rows counts as a new layout.
  const rowsLayoutKey = useMemo(
    () =>
      rows
        .map((row) =>
          row.kind === 'cards'
            ? row.styles.map(styleRowKey).join('\u0001')
            : `\u0002${row.category}\u0002${row.collapsed ? 1 : 0}`,
        )
        .join('\u0003'),
    [rows],
  )

  // A new layout (category, search, resize, fullscreen, density, view) drops the expansion.
  useEffect(() => {
    clearTileExpand()
  }, [rowsLayoutKey, columns, widthPx, windowed, viewMode])

  useEffect(() => {
    const onWindowBlur = () => clearTileExpand()
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('blur', onWindowBlur)
      clearTileExpand()
    }
  }, [])

  // Scrolling drops a hover expansion; a keyboard one scrolls with its tile.
  useEffect(() => {
    if (!scroller) return
    const onScroll = () => clearTileHover()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('wheel', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('wheel', onScroll)
    }
  }, [scroller])

  /** Measures a card now (on show); null when its name fits or the cell is not a card. */
  const tileExpandEntry = useCallback((tile: HTMLElement, ring: boolean): TileExpandEntry | null => {
    const rowAttr = tile.getAttribute('data-cell-row')
    const colAttr = tile.getAttribute('data-cell-col')
    if (rowAttr == null || colAttr == null) return null
    const row = Number(rowAttr)
    const col = Number(colAttr)
    const gridRow = rowsRef.current[row]
    if (!gridRow || gridRow.kind !== 'cards') return null
    const style = gridRow.styles[col]
    if (!style) return null
    const metrics = measureTileLabel(tile)
    if (!metrics || !metrics.truncated) return null
    return {
      row,
      col,
      styleKey: styleRowKey(style),
      textWidth: metrics.textWidth,
      chrome: metrics.chrome,
      ring,
      tile,
    }
  }, [])

  const onGridPointerOver = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!expandEnabled || e.pointerType === 'touch') return
      const card = cardFromTarget(e.target)
      if (!card || card === getHoverTile() || !e.currentTarget.contains(card)) return
      const ring = document.activeElement === card && isFocusVisible(card)
      setTileHover(card, tileExpandEntry(card, ring))
    },
    [expandEnabled, tileExpandEntry],
  )

  const onGridPointerOut = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const hovered = getHoverTile()
    if (!hovered || cardFromTarget(e.relatedTarget) === hovered) return
    clearTileHover()
  }, [])

  const onGridFocusCapture = useCallback(
    (e: ReactFocusEvent<HTMLDivElement>) => {
      if (!expandEnabled) return
      const card = cardFromTarget(e.target)
      if (!card || card !== e.target) return
      // Keyboard focus only (Tab or arrows), not focus after a mouse click.
      setTileFocus(isFocusVisible(card) ? tileExpandEntry(card, true) : null)
    },
    [expandEnabled, tileExpandEntry],
  )

  const onGridBlurCapture = useCallback((e: ReactFocusEvent<HTMLDivElement>) => {
    clearTileFocus(e.target)
  }, [])

  const getRowTop = useCallback(
    (index: number): number | undefined => {
      const item: { start: number } | undefined = virtualizer.measurementsCache[index]
      return item ? item.start - scrollMargin : undefined
    },
    [virtualizer, scrollMargin],
  )

  // No scroller provider (production only; dev and tests threw in useGridScroller):
  // render nothing rather than virtualize against a wrong element.
  if (scrollerMissing) return null

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      role="grid"
      aria-label="Styles"
      aria-rowcount={rows.length}
      data-sg-item-count={itemCount}
      onKeyDown={onGridKeyDown}
      onPointerOver={onGridPointerOver}
      onPointerOut={onGridPointerOut}
      onFocusCapture={onGridFocusCapture}
      onBlurCapture={onGridBlurCapture}
      // StyleCard stops the contextmenu event: hide in the capture phase.
      onContextMenuCapture={clearTileExpand}
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
                      transform: `translateY(${virtualRow.start - scrollMargin}px)`,
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
                  windowed={windowed}
                  viewMode={viewMode}
                  galleryCardHeightPx={viewMode === 'gallery' ? galleryCardHeight : undefined}
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
        {expandEnabled && (
          <ExpandedTileOverlay
            rows={rows}
            columns={columns}
            widthPx={widthPx}
            gapPx={gapPx}
            windowed={windowed}
            totalSize={virtualizer.getTotalSize()}
            getRowTop={getRowTop}
          />
        )}
      </div>
      {children}
    </div>
  )
})
