import { memo, useMemo, type ReactNode } from 'react'
import type { Style } from '../../bridge'
import { styleRowKey } from '../../store/stylesStore'
import { StyleCard } from '../StyleCard'
import { gridGapPx } from './constants'

export type CardsRowProps = {
  styles: readonly Style[]
  columns: number
  compactMode: boolean
  windowed: boolean
  rowIndex: number
  focusedCol: number | null
  /** First cards row of a category — target for header aria-controls. */
  categoryPanelId?: string
  renderCard?: (style: Style) => ReactNode
}

function stylesPropsEqual(a: readonly Style[], b: readonly Style[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function cardsRowPropsEqual(prev: CardsRowProps, next: CardsRowProps): boolean {
  return (
    prev.columns === next.columns &&
    prev.compactMode === next.compactMode &&
    prev.windowed === next.windowed &&
    prev.rowIndex === next.rowIndex &&
    prev.focusedCol === next.focusedCol &&
    prev.categoryPanelId === next.categoryPanelId &&
    prev.renderCard === next.renderCard &&
    stylesPropsEqual(prev.styles, next.styles)
  )
}

/** Profile (P toggle N=5000): CardsRow 40 stack hits — memo skips identical viewport rows. */
export const CardsRow = memo(function CardsRow({
  styles,
  columns,
  compactMode,
  windowed,
  rowIndex,
  focusedCol,
  categoryPanelId,
  renderCard,
}: CardsRowProps) {
  // Column gap only — vertical ROW_GAP lives on the virtual row padding-bottom.
  const colGap = gridGapPx(compactMode)
  // Stable style object across parent scroll re-renders with unchanged columns.
  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      columnGap: `${colGap}px`,
    }),
    [columns, colGap],
  )
  return (
    <div
      id={categoryPanelId}
      role="presentation"
      className="grid content-start"
      style={gridStyle}
    >
      {styles.map((style, col) =>
        renderCard ? (
          <div key={styleRowKey(style)} role="gridcell">
            {renderCard(style)}
          </div>
        ) : (
          <StyleCard
            key={styleRowKey(style)}
            style={style}
            windowed={windowed}
            cellRow={rowIndex}
            cellCol={col}
            tabIndex={focusedCol === col ? 0 : -1}
          />
        ),
      )}
    </div>
  )
}, cardsRowPropsEqual)
