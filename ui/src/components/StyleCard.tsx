import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  CopyPlus,
  FolderInput,
  ImageMinus,
  ImagePlus,
  Pencil,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { Style } from '../bridge'
import { setFocusedCell } from '../lib/gridFocus'
import {
  LORA_SOURCE,
  styleRowKey,
  useCategoryColor,
  useIsSelected,
  useStyleDuplicates,
  useStylesStore,
} from '../store/stylesStore'
import { sendToHost } from '../bridge'
import { styleGridDelete } from '../lib/styleGridFetch'
import {
  CARD_ROW_HEIGHT_NORMAL_PX,
  CARD_ROW_HEIGHT_WINDOWED_PX,
  ROW_GAP_NORMAL_PX,
} from './grid/constants'
import { ThumbnailPreview } from './ThumbnailPreview'
import { MenuItem, ViewportFixedMenu } from './ViewportFixedMenu'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

/** Card chrome height = virtualizer row size minus inter-row gap. */
const CARD_HEIGHT_NORMAL = CARD_ROW_HEIGHT_NORMAL_PX - ROW_GAP_NORMAL_PX
const CARD_HEIGHT_WINDOWED = CARD_ROW_HEIGHT_WINDOWED_PX - ROW_GAP_NORMAL_PX

interface Props {
  style: Style
  windowed?: boolean
  cellRow?: number
  cellCol?: number
  tabIndex?: number
}

const READ_ONLY_PREVIEW_TOAST =
  'This style is from the protected samples pack (read-only). Duplicate it into a data source to manage your own preview.'

/** Skip re-render when row identity + chrome mode + roving tab stop unchanged. */
function styleCardPropsEqual(prev: Props, next: Props): boolean {
  return (
    prev.windowed === next.windowed &&
    prev.style === next.style &&
    prev.cellRow === next.cellRow &&
    prev.cellCol === next.cellCol &&
    prev.tabIndex === next.tabIndex
  )
}

export const StyleCard = memo(function StyleCard({
  style,
  windowed = false,
  cellRow,
  cellCol,
  tabIndex = -1,
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

  const borderColor = useCategoryColor(style.category || 'OTHER')
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
    setMenuPos({ x, y })
  }

  return (
    <>
      <div role={cellRow != null ? 'gridcell' : undefined}>
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
            title={`${style.name}\nRight-click for options`}
            onFocus={() => {
              if (cellRow != null && cellCol != null) {
                setFocusedCell({ row: cellRow, col: cellCol })
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
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
            style={{ height: windowed ? CARD_HEIGHT_WINDOWED : CARD_HEIGHT_NORMAL }}
            className={`
              relative overflow-hidden cursor-pointer rounded-lg border ${windowed ? 'p-2' : 'p-3'}
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
                className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
                style={{ backgroundColor: borderColor }}
              />
            )}
            <div
              className={`${windowed ? 'text-xs' : 'text-sm'} min-w-0 truncate pr-4 font-medium text-sg-text`}
            >
              {displayName}
            </div>

            {fav && (
              <Star
                size={12}
                fill="currentColor"
                className="absolute top-1.5 right-1.5 text-sg-warning-text"
                aria-hidden="true"
              />
            )}

            {/* Selected indicator */}
            {isSelected && (
              <div
                aria-hidden="true"
                className="absolute bottom-2 right-2 h-1.5 w-1.5 rounded-full bg-sg-accent"
              />
            )}
          </button>
        </ThumbnailPreview>
      </div>

      {menuPos && (
        <ViewportFixedMenu
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuPos(null)}
          restoreFocusTo={restoreFocusEl}
          className="fixed z-[9999] bg-sg-surface border border-sg-border rounded-lg shadow-xl py-1 min-w-48"
        >
          <MenuItem
            onSelect={() => { toggleStyle(style); setMenuPos(null) }}
          >
            {isSelected ? '✕ Deselect' : '✓ Select'}
          </MenuItem>
          <MenuItem
            onSelect={() => { toggleFavorite(style); setMenuPos(null) }}
            className="flex items-center gap-2"
          >
            <Star size={14} aria-hidden="true" />
            {fav ? 'Remove from Favorites' : 'Add to Favorites'}
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
                className="flex items-center gap-2"
                onSelect={() => {
                  sendToHost({
                    type: 'SG_EDIT_STYLE',
                    styleId: style.name,
                    source_file: style.source_file,
                  })
                  setMenuPos(null)
                }}
              >
                <Pencil size={14} aria-hidden="true" />
                Edit
              </MenuItem>
              <MenuItem
                className="flex items-center gap-2"
                onSelect={() => {
                  sendToHost({
                    type: 'SG_DUPLICATE_STYLE',
                    styleId: style.name,
                    source_file: style.source_file,
                  })
                  setMenuPos(null)
                }}
              >
                <CopyPlus size={14} aria-hidden="true" />
                Duplicate
              </MenuItem>
              <MenuItem
                className="flex items-center gap-2"
                onSelect={() => {
                  sendToHost({
                    type: 'SG_MOVE_TO_CATEGORY',
                    styleId: style.name,
                    source_file: style.source_file,
                  })
                  setMenuPos(null)
                }}
              >
                <FolderInput size={14} aria-hidden="true" />
                Move to category...
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
                Generate preview (SD)
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
                Upload preview image
              </MenuItem>
              {style.has_thumbnail && (
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
                      useStylesStore.setState((s) => ({
                        styles: s.styles.map((row) =>
                          styleRowKey(row) === key
                            ? { ...row, has_thumbnail: false }
                            : row
                        ),
                      }))
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
                className="flex items-center gap-2 text-sg-danger-text hover:bg-sg-danger/20"
                onSelect={() => {
                  sendToHost({
                    type: 'SG_DELETE_STYLE',
                    styleId: style.name,
                    source_file: style.source_file,
                  })
                  setMenuPos(null)
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete
              </MenuItem>
            </>
          )}
        </ViewportFixedMenu>
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
