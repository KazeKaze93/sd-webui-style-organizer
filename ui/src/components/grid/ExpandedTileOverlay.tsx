import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { Style } from '../../bridge'
import { measureOverlayHeight } from '../../lib/tileLabelMetrics'
import { useExpandedTile, type ExpandedTile } from '../../lib/tileExpand'
import {
  styleRowKey,
  useCategoryColor,
  useIsSelected,
  usePreviewJob,
  useStylesStore,
} from '../../store/stylesStore'
import type { GridRow } from './buildGridRows'
import { CARD_HEIGHT_NORMAL_PX, CARD_HEIGHT_WINDOWED_PX } from './constants'
import { GridTileFace } from './GridTileFace'

/** The tile's FOCUS_RING, drawn without :focus-visible (the overlay never takes focus). */
const OVERLAY_FOCUS_RING = 'outline-none ring-2 ring-sg-accent ring-offset-1 ring-offset-sg-bg'

export type ExpandedTileOverlayProps = {
  rows: readonly GridRow[]
  columns: number
  /** Grid content width (also the overlay's max width). */
  widthPx: number
  gapPx: number
  windowed: boolean
  /** Virtualizer total size: a wrapped overlay never extends the scroll height. */
  totalSize: number
  /** Top of a row inside the sized container (virtualizer measurements), or undefined. */
  getRowTop: (index: number) => number | undefined
}

function tileDisplayName(style: Style): string {
  return style.display_name || (style.name.includes('_')
    ? style.name.split('_').slice(1).join(' ')
    : style.name)
}

type BodyProps = {
  style: Style
  expanded: ExpandedTile
  windowed: boolean
  left: number
  rowTop: number
  width: number
  tileHeight: number
  wrap: boolean
  totalSize: number
}

/** Subscribes to the same store state as the tile, so selection, favorite and preview update live. */
function ExpandedTileBody({ style, expanded, windowed, left, rowTop, width, tileHeight, wrap, totalSize }: BodyProps) {
  const key = expanded.styleKey
  const isSelected = useIsSelected(key)
  const fav = useStylesStore((s) => s.favorites.has(key))
  const previewJob = usePreviewJob(key)
  const categoryColor = useCategoryColor(style.category || 'OTHER')
  const ref = useRef<HTMLDivElement>(null)
  /** Height of a wrapped overlay; measured once per shown expansion. */
  const [wrapHeight, setWrapHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!wrap || !ref.current) return
    setWrapHeight(measureOverlayHeight(ref.current))
  }, [wrap])

  // Grows down from the tile; up (anchored to the tile's bottom) when it would pass the content end.
  const top =
    wrap && wrapHeight != null && rowTop + wrapHeight > totalSize
      ? Math.max(0, rowTop + tileHeight - wrapHeight)
      : rowTop

  const frame = isSelected
    ? 'border-sg-accent bg-sg-bg'
    : expanded.source === 'hover'
      ? 'border-sg-accent/50 bg-sg-surface'
      : 'border-sg-border bg-sg-surface'

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-sg-tile-expanded="true"
      className={[
        'pointer-events-none absolute z-[5] overflow-hidden rounded-lg border text-left select-none shadow-lg',
        windowed ? 'p-2' : 'p-3',
        frame,
        expanded.ring ? OVERLAY_FOCUS_RING : '',
      ].join(' ')}
      style={{
        left,
        top,
        width,
        height: wrap ? undefined : tileHeight,
        minHeight: tileHeight,
      }}
    >
      {/* Same tint as a selected tile, over an opaque base so nothing shows through. */}
      {isSelected && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-sg-accent/10" />
      )}
      <GridTileFace
        displayName={tileDisplayName(style)}
        windowed={windowed}
        isSelected={isSelected}
        fav={fav}
        previewJob={previewJob}
        categoryColor={categoryColor}
        labelMode={wrap ? 'wrap' : 'nowrap'}
      />
    </div>
  )
}

/**
 * The full name of a truncated grid tile, drawn over its neighbors (hover or
 * keyboard focus). Lives in the virtual list's sized container: scrolls with
 * the content, above the rows (z 5), below the sticky header (z 10).
 * Position comes from grid geometry, never from the tile's client rect.
 */
export const ExpandedTileOverlay = memo(function ExpandedTileOverlay({
  rows,
  columns,
  widthPx,
  gapPx,
  windowed,
  totalSize,
  getRowTop,
}: ExpandedTileOverlayProps) {
  const expanded = useExpandedTile()
  if (!expanded) return null
  // The cell must still hold the same style (virtualizer recycling, new rows).
  const row = rows[expanded.row]
  if (!row || row.kind !== 'cards') return null
  const style = row.styles[expanded.col]
  if (!style || styleRowKey(style) !== expanded.styleKey) return null
  const rowTop = getRowTop(expanded.row)
  if (rowTop == null) return null

  const cols = Math.max(1, columns)
  const cardWidth = (widthPx - gapPx * (cols - 1)) / cols
  const tileLeft = expanded.col * (cardWidth + gapPx)
  const tileHeight = windowed ? CARD_HEIGHT_WINDOWED_PX : CARD_HEIGHT_NORMAL_PX
  const natural = expanded.chrome + Math.ceil(expanded.textWidth)
  const wrap = natural > widthPx
  const width = Math.min(natural, widthPx)
  // Grows right from the tile's left edge; past the grid's right edge it grows left from the tile's right edge.
  const left = tileLeft + width > widthPx ? Math.max(0, tileLeft + cardWidth - width) : tileLeft

  return (
    <ExpandedTileBody
      key={`${expanded.styleKey}|${expanded.source}`}
      style={style}
      expanded={expanded}
      windowed={windowed}
      left={left}
      rowTop={rowTop}
      width={width}
      tileHeight={tileHeight}
      wrap={wrap}
      totalSize={totalSize}
    />
  )
})
