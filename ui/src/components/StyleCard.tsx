import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  CopyPlus,
  FolderInput,
  ImageMinus,
  ImageOff,
  ImagePlus,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { Style } from '../bridge'
import { setFocusedCell } from '../lib/gridFocus'
import { dismissAllHoverIntents } from '../lib/hoverIntent'
import {
  LORA_SOURCE,
  styleRowKey,
  useCategoryColor,
  useIsSelected,
  useStyleDuplicates,
  useHasThumbnail,
  useStylesStore,
  useThumbVersion,
  type ViewMode,
} from '../store/stylesStore'
import { sendToHost } from '../bridge'
import { styleGridDelete } from '../lib/styleGridFetch'
import { duplicateStyleRequest, sourceFileLeaf } from '../lib/styleActions'
import { thumbnailUrl } from '../lib/thumbnailUrl'
import { cn } from '../lib/utils'
import {
  CARD_ROW_HEIGHT_NORMAL_PX,
  CARD_ROW_HEIGHT_WINDOWED_PX,
  GALLERY_LABEL_HEIGHT_PX,
  ROW_GAP_NORMAL_PX,
} from './grid/constants'
import { DeleteStyleDialog } from './DeleteStyleDialog'
import { MoveToCategoryDialog } from './MoveToCategoryDialog'
import { StyleEditorDialog } from './StyleEditorDialog'
import { ThumbnailPreview } from './ThumbnailPreview'
import { MenuItem, ViewportFixedMenu } from './ViewportFixedMenu'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

/** Gap between the ⋯ button (or a keyboard-opened card) and the menu under it. */
const MENU_OFFSET_PX = 4

/** Star and ⋯ on the tile: 24×24 pointer affordances, out of the tab order. */
const TILE_ACTION_CLASS =
  'relative h-6 w-6 flex items-center justify-center rounded transition-colors hover:bg-sg-accent/20'

/**
 * Shown on tile hover and on visible (keyboard) focus inside the tile; never
 * display:none (focus may return into the tile). Not :focus-within: the menu
 * returns focus to the card after a mouse action too, and the actions would
 * then stay up without hover.
 */
const TILE_HOVER_SHOW =
  'opacity-0 pointer-events-none group-hover/tile:opacity-100 group-hover/tile:pointer-events-auto ' +
  'group-has-[:focus-visible]/tile:opacity-100 group-has-[:focus-visible]/tile:pointer-events-auto'

/** The favorite indicator gives its place to the Star button while the actions show. */
const TILE_HOVER_HIDE = 'group-hover/tile:opacity-0 group-has-[:focus-visible]/tile:opacity-0'

/** Card chrome height = virtualizer row size minus inter-row gap. */
const CARD_HEIGHT_NORMAL = CARD_ROW_HEIGHT_NORMAL_PX - ROW_GAP_NORMAL_PX
const CARD_HEIGHT_WINDOWED = CARD_ROW_HEIGHT_WINDOWED_PX - ROW_GAP_NORMAL_PX

interface Props {
  style: Style
  windowed?: boolean
  /** Text tile (grid, default) or square preview tile (gallery). */
  viewMode?: ViewMode
  /** Gallery card height = thumbnail box + label (set by the virtualized grid). */
  galleryCardHeightPx?: number
  cellRow?: number
  cellCol?: number
  tabIndex?: number
  /** Star and ⋯ buttons on hover; off for slice-mode tiles. */
  hoverActions?: boolean
}

const READ_ONLY_PREVIEW_TOAST =
  'This style is from the protected samples pack (read-only). Duplicate it into a data source to manage your own preview.'
/** The server refuses writes to samples/ (403); say so instead of sending the request. */
const READ_ONLY_DELETE_TOAST =
  'This style is from the protected samples pack (read-only) and cannot be deleted.'
const READ_ONLY_DUPLICATE_TOAST =
  'This style is from the protected samples pack (read-only); a copy cannot be saved into it.'
const READ_ONLY_MOVE_TOAST =
  'This style is from the protected samples pack (read-only) and cannot be moved.'
const READ_ONLY_EDIT_TOAST =
  'This style is from the protected samples pack (read-only) and cannot be edited. Duplicate it into a data source to change it.'

/** Skip re-render when row identity + chrome mode + roving tab stop unchanged. */
function styleCardPropsEqual(prev: Props, next: Props): boolean {
  return (
    prev.windowed === next.windowed &&
    prev.viewMode === next.viewMode &&
    prev.galleryCardHeightPx === next.galleryCardHeightPx &&
    prev.style === next.style &&
    prev.cellRow === next.cellRow &&
    prev.cellCol === next.cellCol &&
    prev.tabIndex === next.tabIndex &&
    prev.hoverActions === next.hoverActions
  )
}

export const StyleCard = memo(function StyleCard({
  style,
  windowed = false,
  viewMode = 'grid',
  galleryCardHeightPx,
  cellRow,
  cellCol,
  tabIndex = -1,
  hoverActions = true,
}: Props) {
  const key = useMemo(() => styleRowKey(style), [style])
  const isSelected = useIsSelected(key)
  const duplicates = useStyleDuplicates(style.name)
  const fav = useStylesStore(s => s.favorites.has(key))
  const activeSource = useStylesStore(s => s.activeSource)
  const showToast = useStylesStore(s => s.showToast)
  const { toggleStyle, toggleFavorite } = useStylesStore(
    useShallow(s => ({ toggleStyle: s.toggleStyle, toggleFavorite: s.toggleFavorite }))
  )
  const cardRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ x: number, y: number } | null>(null)
  const [pickerPos, setPickerPos] = useState<{ x: number, y: number } | null>(null)
  const [restoreFocusEl, setRestoreFocusEl] = useState<HTMLElement | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const isLora = style.source_file === LORA_SOURCE
  const hasMultipleSources = duplicates.length > 1
  const sourceLabels = useMemo(
    () =>
      duplicates.map((dup) =>
        ((dup.source_file || 'Unknown').split(/[\\/]/).pop() || 'Unknown')
          .replace(/\.csv$/i, '')
      ),
    [duplicates],
  )
  const pickerWidthCh = useMemo(() => {
    const maxSourceLabelLen = sourceLabels.reduce((max, label) => Math.max(max, label.length), 0)
    return Math.min(48, Math.max(18, maxSourceLabelLen + 4))
  }, [sourceLabels])

  const displayName = style.display_name || (style.name.includes('_')
    ? style.name.split('_').slice(1).join(' ')
    : style.name)

  const accessibleName = fav ? `${displayName} favorite` : displayName
  const menuHeadingId = useId()
  const menuSourceLabel = `${isLora ? 'LoRA' : sourceFileLeaf(style.source_file)}${style.read_only ? ' · read-only' : ''}`

  const borderColor = useCategoryColor(style.category || 'OTHER')
  const gallery = viewMode === 'gallery'
  const thumbVersion = useThumbVersion(key)
  const thumbSrc = thumbnailUrl(style, activeSource, thumbVersion)
  /** URL whose image failed to load; a new thumb version gives a new URL, so it retries. */
  const [failedThumbSrc, setFailedThumbSrc] = useState<string | null>(null)
  // LoRA previews may or may not exist next to the model: try, and fall back on error.
  const hasThumb = useHasThumbnail(style)
  const showThumb = gallery && hasThumb !== false && failedThumbSrc !== thumbSrc
  const previewReadOnlyClass = style.read_only
    ? 'opacity-45 cursor-not-allowed text-sg-muted hover:bg-transparent'
    : 'text-sg-text hover:bg-sg-accent/20'

  useEffect(() => {
    if (!menuPos) return
    const blockNativeContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const blockRightMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    window.addEventListener('contextmenu', blockNativeContextMenu, true)
    document.addEventListener('contextmenu', blockNativeContextMenu, true)
    window.addEventListener('mousedown', blockRightMouseDown, true)
    document.addEventListener('mousedown', blockRightMouseDown, true)

    return () => {
      window.removeEventListener('contextmenu', blockNativeContextMenu, true)
      document.removeEventListener('contextmenu', blockNativeContextMenu, true)
      window.removeEventListener('mousedown', blockRightMouseDown, true)
      document.removeEventListener('mousedown', blockRightMouseDown, true)
    }
  }, [menuPos])

  const openMenuAt = (x: number, y: number) => {
    setRestoreFocusEl(cardRef.current)
    // The menu backdrop appears under a still pointer, so no mouseleave reaches
    // the card: close the preview (and any pending show) explicitly.
    dismissAllHoverIntents()
    setMenuPos({ x, y })
  }

  return (
    <>
      <div
        role={cellRow != null ? 'gridcell' : undefined}
        className={hoverActions ? 'group/tile relative' : undefined}
      >
        <ThumbnailPreview style={style}>
          <button
            ref={cardRef}
            type="button"
            data-sg-card="true"
            data-cell-row={cellRow}
            data-cell-col={cellCol}
            tabIndex={tabIndex}
            aria-pressed={isSelected}
            aria-label={accessibleName}
            onFocus={() => {
              if (cellRow != null && cellCol != null) {
                setFocusedCell({ row: cellRow, col: cellCol })
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              // ContextMenu key / Shift+F10 is not a right button press: anchor to the card.
              const keyboard = e.nativeEvent.button !== 2 || (e.clientX === 0 && e.clientY === 0)
              if (keyboard) {
                const rect = e.currentTarget.getBoundingClientRect()
                openMenuAt(rect.left, rect.bottom + MENU_OFFSET_PX)
                return
              }
              openMenuAt(e.clientX, e.clientY)
            }}
            onClick={(e) => {
              if (hasMultipleSources && !activeSource && !isSelected) {
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                setRestoreFocusEl(cardRef.current)
                setPickerPos({ x: rect.right + 8, y: rect.top })
                return
              }
              toggleStyle(style)
            }}
            style={{
              height: gallery
                ? galleryCardHeightPx
                : windowed ? CARD_HEIGHT_WINDOWED : CARD_HEIGHT_NORMAL,
            }}
            className={`
              relative overflow-hidden cursor-pointer rounded-lg border
              ${gallery ? 'p-0 flex flex-col' : windowed ? 'p-2' : 'p-3'}
              select-none transition-colors w-full text-left
              transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]
              motion-reduce:transition-none motion-reduce:transform-none
              ${FOCUS_RING}
              ${isSelected
                ? 'border-sg-accent bg-sg-accent/10'
                : 'border-sg-border bg-sg-surface hover:border-sg-accent/50'}
            `}
          >
            {/* Category accent — separate strip avoids asymmetric border-radius bleed onto the name */}
            {!isSelected && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[3px]"
                style={{ backgroundColor: borderColor }}
              />
            )}
            {gallery ? (
              <>
                <div className="relative min-h-0 flex-1 overflow-hidden" data-sg-gallery-thumb="true">
                  {showThumb ? (
                    <img
                      src={thumbSrc}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="block h-full w-full object-cover"
                      onError={() => setFailedThumbSrc(thumbSrc)}
                    />
                  ) : (
                    <div
                      className="flex h-full w-full flex-col items-center justify-center gap-1
                                 border-b border-dashed border-sg-border text-sg-muted"
                      data-sg-gallery-placeholder="true"
                    >
                      <ImageOff size={20} aria-hidden="true" />
                      <span className="text-xs text-sg-muted">No preview</span>
                    </div>
                  )}
                  {fav && (
                    <Star
                      size={12}
                      fill="currentColor"
                      className={cn(
                        'absolute top-1.5 right-1.5 text-sg-warning-text',
                        hoverActions && (menuPos ? 'opacity-0' : TILE_HOVER_HIDE),
                      )}
                      aria-hidden="true"
                    />
                  )}
                  {isSelected && (
                    <div
                      aria-hidden="true"
                      className="absolute bottom-2 right-2 h-1.5 w-1.5 rounded-full bg-sg-accent"
                    />
                  )}
                </div>
                <div
                  className="shrink-0 px-2 py-1.5 text-xs font-medium text-sg-text text-left line-clamp-2 break-words"
                  style={{ height: GALLERY_LABEL_HEIGHT_PX }}
                  data-sg-gallery-label="true"
                >
                  {displayName}
                </div>
              </>
            ) : (
              <div
                className={`${windowed ? 'text-xs' : 'text-sm'} min-w-0 truncate pr-4 font-medium text-sg-text`}
              >
                {displayName}
              </div>
            )}

            {!gallery && fav && (
              <Star
                size={12}
                fill="currentColor"
                className={cn(
                  'absolute top-1.5 right-1.5 text-sg-warning-text',
                  hoverActions && (menuPos ? 'opacity-0' : TILE_HOVER_HIDE),
                )}
                aria-hidden="true"
              />
            )}

            {/* Selected indicator */}
            {!gallery && isSelected && (
              <div
                aria-hidden="true"
                className="absolute bottom-2 right-2 h-1.5 w-1.5 rounded-full bg-sg-accent"
              />
            )}
          </button>
          {hoverActions && (
            <div
              data-sg-tile-actions="true"
              className={cn(
                'absolute z-20 flex items-center gap-0.5 rounded-md transition-opacity',
                gallery ? 'top-1 right-1 p-0.5 bg-sg-bg/85' : 'right-1.5 top-1/2 -translate-y-1/2',
                !gallery && (isSelected ? 'bg-sg-bg' : 'bg-sg-surface'),
                menuPos ? 'opacity-100' : TILE_HOVER_SHOW,
              )}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                openMenuAt(e.clientX, e.clientY)
              }}
            >
              {/* Same tint as a selected tile (accent/10 over the page background). */}
              {!gallery && isSelected && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-md bg-sg-accent/10" />
              )}
              <button
                type="button"
                tabIndex={-1}
                aria-label={fav ? `Remove ${displayName} from favorites` : `Add ${displayName} to favorites`}
                data-sg-tile-favorite="true"
                // Keep focus where it is (the card or elsewhere): a focused action
                // would leave arrow navigation starting from the wrong element.
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  dismissAllHoverIntents()
                  toggleFavorite(style)
                }}
                className={cn(
                  TILE_ACTION_CLASS,
                  FOCUS_RING,
                  fav ? 'text-sg-warning-text' : 'text-sg-muted hover:text-sg-text',
                )}
              >
                <Star size={14} fill={fav ? 'currentColor' : 'none'} aria-hidden="true" />
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`More actions for ${displayName}`}
                aria-haspopup="menu"
                aria-expanded={menuPos !== null}
                data-sg-tile-more="true"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  openMenuAt(rect.left, rect.bottom + MENU_OFFSET_PX)
                }}
                className={cn(TILE_ACTION_CLASS, FOCUS_RING, 'text-sg-muted hover:text-sg-text')}
              >
                <MoreHorizontal size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        </ThumbnailPreview>
      </div>

      {menuPos && (
        <ViewportFixedMenu
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuPos(null)}
          restoreFocusTo={restoreFocusEl}
          ariaLabelledBy={menuHeadingId}
          className="fixed z-[9999] bg-sg-surface border border-sg-border rounded-lg shadow-xl py-1 min-w-48 max-w-sm"
        >
          <div className="px-3 pt-1 pb-1.5 mb-1 border-b border-sg-border" data-sg-menu-header="true">
            <div id={menuHeadingId} className="font-semibold text-sm text-sg-text truncate">
              {displayName}
            </div>
            <div className="font-mono text-xs text-sg-muted truncate">{menuSourceLabel}</div>
          </div>
          <MenuItem
            className="flex items-center gap-2"
            onSelect={() => { toggleStyle(style); setMenuPos(null) }}
          >
            {/* Check mark is state, not action: shown only while selected. */}
            <Check
              size={14}
              aria-hidden="true"
              className={isSelected ? undefined : 'invisible'}
            />
            {isSelected ? 'Deselect' : 'Select'}
          </MenuItem>
          <MenuItem
            onSelect={() => { toggleFavorite(style); setMenuPos(null) }}
            className="flex items-center gap-2"
          >
            <Star size={14} aria-hidden="true" />
            {fav ? 'Remove from favorites' : 'Add to favorites'}
          </MenuItem>
          <div className="h-px my-1 bg-sg-border" role="separator" />
          <MenuItem
            className="flex items-center gap-2"
            onSelect={async () => {
              setMenuPos(null)
              try {
                await navigator.clipboard.writeText(style.prompt)
                showToast('Prompt copied', 'success')
              } catch {
                showToast('Copy failed', 'error')
              }
            }}
          >
            <Copy size={14} aria-hidden="true" />
            Copy prompt
          </MenuItem>
          {!isLora && (
            <>
              <MenuItem
                className={`flex items-center gap-2 ${style.read_only ? previewReadOnlyClass : ''}`}
                onSelect={() => {
                  setMenuPos(null)
                  if (style.read_only) {
                    showToast(READ_ONLY_EDIT_TOAST, 'info')
                    return
                  }
                  setEditOpen(true)
                }}
              >
                <Pencil size={14} aria-hidden="true" />
                Edit…
              </MenuItem>
              <MenuItem
                className={`flex items-center gap-2 ${style.read_only ? previewReadOnlyClass : ''}`}
                onSelect={async () => {
                  setMenuPos(null)
                  if (style.read_only) {
                    showToast(READ_ONLY_DUPLICATE_TOAST, 'info')
                    return
                  }
                  const result = await duplicateStyleRequest(
                    style,
                    useStylesStore.getState().styles,
                  )
                  if (!result.ok) {
                    showToast(`Duplicate failed: ${result.error}`, 'error')
                    return
                  }
                  // The host reloads the catalog and pushes it back to the iframe.
                  sendToHost({ type: 'SG_REFRESH' })
                  showToast(`Duplicated as "${result.name}"`, 'success')
                }}
              >
                <CopyPlus size={14} aria-hidden="true" />
                Duplicate
              </MenuItem>
              <MenuItem
                className={`flex items-center gap-2 ${style.read_only ? previewReadOnlyClass : ''}`}
                onSelect={() => {
                  setMenuPos(null)
                  if (style.read_only) {
                    showToast(READ_ONLY_MOVE_TOAST, 'info')
                    return
                  }
                  setMoveOpen(true)
                }}
              >
                <FolderInput size={14} aria-hidden="true" />
                Move to category…
              </MenuItem>
            </>
          )}
          {!isLora && (
            <>
              <div className="h-px my-1 bg-sg-border" role="separator" />
              <MenuItem
                className={`flex items-center gap-2 ${previewReadOnlyClass}`}
                onSelect={() => {
                  if (style.read_only) {
                    setMenuPos(null)
                    showToast(READ_ONLY_PREVIEW_TOAST, 'info')
                    return
                  }
                  sendToHost({ type: 'SG_GENERATE_PREVIEW', styleId: style.name, source: style.source_file })
                  setMenuPos(null)
                }}
              >
                <Sparkles size={14} aria-hidden="true" />
                Generate preview
              </MenuItem>
              <MenuItem
                className={`flex items-center gap-2 ${previewReadOnlyClass}`}
                onSelect={() => {
                  if (style.read_only) {
                    setMenuPos(null)
                    showToast(READ_ONLY_PREVIEW_TOAST, 'info')
                    return
                  }
                  sendToHost({ type: 'SG_UPLOAD_PREVIEW', styleId: style.name, source: style.source_file })
                  setMenuPos(null)
                }}
              >
                <ImagePlus size={14} aria-hidden="true" />
                Upload preview…
              </MenuItem>
              {hasThumb === true && (
                <MenuItem
                  className={`flex items-center gap-2 ${previewReadOnlyClass}`}
                  onSelect={async () => {
                    if (style.read_only) {
                      setMenuPos(null)
                      showToast(READ_ONLY_PREVIEW_TOAST, 'info')
                      return
                    }
                    setMenuPos(null)
                    try {
                      const name = style.name
                      const source_file = style.source_file
                      const params = new URLSearchParams({ name })
                      if (source_file) params.set('source', source_file)
                      const res = await styleGridDelete(`/style_grid/thumbnail?${params}`)
                      const data = await res.json().catch(() => ({}))
                      if (!res.ok || data.ok === false || data.error) {
                        showToast(
                          typeof data.error === 'string' && data.error
                            ? data.error
                            : 'Remove preview failed',
                          'error',
                        )
                        return
                      }
                      const version = String(Date.now())
                      // Local bump only — do not window.postMessage (would fail
                      // host-origin/source guards; App listens for host SG_THUMB_DONE).
                      useStylesStore.getState().bumpThumbVersion(key, version)
                      useStylesStore.getState().markThumb(key, false)
                      showToast('Preview removed', 'success')
                    } catch {
                      showToast('Remove preview failed', 'error')
                    }
                  }}
                >
                  <ImageMinus size={14} aria-hidden="true" />
                  Remove preview
                </MenuItem>
              )}
            </>
          )}
          {!isLora && (
            <>
              <div className="h-px my-1 bg-sg-border" role="separator" />
              <MenuItem
                className={`flex items-center gap-2 ${
                  style.read_only
                    ? previewReadOnlyClass
                    : 'text-sg-danger-text hover:bg-sg-danger/20'
                }`}
                onSelect={() => {
                  setMenuPos(null)
                  if (style.read_only) {
                    showToast(READ_ONLY_DELETE_TOAST, 'info')
                    return
                  }
                  setDeleteOpen(true)
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete…
              </MenuItem>
            </>
          )}
        </ViewportFixedMenu>
      )}

      {editOpen && (
        <StyleEditorDialog
          mode="edit"
          open
          style={style}
          onClose={() => setEditOpen(false)}
        />
      )}

      {moveOpen && (
        <MoveToCategoryDialog
          open
          style={style}
          displayName={displayName}
          onClose={() => setMoveOpen(false)}
        />
      )}

      {deleteOpen && (
        <DeleteStyleDialog
          open
          style={style}
          displayName={displayName}
          onClose={() => setDeleteOpen(false)}
        />
      )}

      {pickerPos && (
        <ViewportFixedMenu
          x={pickerPos.x}
          y={pickerPos.y}
          onClose={() => setPickerPos(null)}
          restoreFocusTo={restoreFocusEl}
          className="fixed z-[10005] bg-sg-surface border border-sg-border rounded-lg shadow-xl py-1"
          backdropClassName="fixed inset-0 z-[10004]"
          style={{
            width: `${pickerWidthCh}ch`,
            minWidth: '18ch',
            maxWidth: '48ch',
          }}
        >
          {duplicates.map((dup, idx) => {
            const sourceLabel = sourceLabels[idx] || 'Unknown'
            return (
              <MenuItem
                key={`${dup.source_file || 'unknown'}-${idx}`}
                onSelect={() => {
                  toggleStyle(dup)
                  setPickerPos(null)
                }}
              >
                <div className="font-medium truncate">{sourceLabel}</div>
              </MenuItem>
            )
          })}
        </ViewportFixedMenu>
      )}
    </>
  )
}, styleCardPropsEqual)
