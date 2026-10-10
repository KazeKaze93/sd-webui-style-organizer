import { memo, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  Check,
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
import { getCategoryColor, LORA_SOURCE, styleRowKey, useStylesStore } from '../store/stylesStore'
import { sendToHost } from '../bridge'
import { styleGridWriteHeaders } from '../lib/styleGridFetch'
import { ThumbnailPreview } from './ThumbnailPreview'

interface Props {
  style: Style
  windowed?: boolean
}

const Portal = ({ children }: { children: React.ReactNode }) =>
  createPortal(children, document.body)

const READ_ONLY_PREVIEW_TOAST =
  'This style is from the protected samples pack (read-only). Duplicate it into a data source to manage your own preview.'

export const StyleCard = memo(function StyleCard({ style, windowed = false }: Props) {
  const isSelected = useStylesStore(
    s => s.selectedStyles.some(sel => styleRowKey(sel) === styleRowKey(style))
  )
  const fav = useStylesStore(s => s.favorites.has(styleRowKey(style)))
  const usageCount = useStylesStore(s => s.usageCounts[style.name] || 0)
  const activeSource = useStylesStore(s => s.activeSource)
  const styles = useStylesStore(s => s.styles)
  const showToast = useStylesStore(s => s.showToast)
  const { toggleStyle, toggleFavorite } = useStylesStore(
    useShallow(s => ({ toggleStyle: s.toggleStyle, toggleFavorite: s.toggleFavorite }))
  )
  const [menuPos, setMenuPos] = useState<{ x: number, y: number } | null>(null)
  const [pickerPos, setPickerPos] = useState<{ x: number, y: number } | null>(null)
  const isLora = style.source_file === LORA_SOURCE
  const duplicates = useMemo(
    () => styles.filter(s => s.name === style.name),
    [styles, style.name],
  )
  const hasMultipleSources = duplicates.length > 1
  const sourceLabels = duplicates.map((dup) =>
    ((dup.source_file || 'Unknown').split(/[\\/]/).pop() || 'Unknown')
      .replace(/\.csv$/i, '')
  )
  const maxSourceLabelLen = sourceLabels.reduce((max, label) => Math.max(max, label.length), 0)
  const pickerWidthCh = Math.min(48, Math.max(18, maxSourceLabelLen + 4))

  const displayName = style.display_name || (style.name.includes('_')
    ? style.name.split('_').slice(1).join(' ')
    : style.name)

  const borderColor = getCategoryColor(style.category || 'OTHER')
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

  return (
    <>
      <ThumbnailPreview style={style}>
        <motion.div
          data-sg-card="true"
          title={`${style.name}\nRight-click for options`}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.1 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setMenuPos({ x: e.clientX, y: e.clientY })
          }}
          onClick={(e) => {
            if (hasMultipleSources && !activeSource && !isSelected) {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
              const left = Math.min(rect.right + 8, window.innerWidth - 280)
              const top = Math.max(8, rect.top)
              setPickerPos({ x: left, y: top })
              return
            }
            toggleStyle(style)
          }}
          className={`
            relative cursor-pointer rounded-lg border ${windowed ? 'p-2' : 'p-3'}
            transition-colors duration-150 select-none
            ${isSelected
              ? 'border-sg-accent bg-sg-accent/10'
              : 'border-sg-border bg-sg-surface hover:border-sg-accent/50'}
          `}
          style={{
            borderLeftColor: isSelected ? undefined : borderColor,
            borderLeftWidth: '3px'
          }}
        >
          <div className={`${windowed ? 'text-xs' : 'text-sm'} font-medium text-sg-text truncate`}>
            {displayName}
          </div>

          {fav && (
            <>
              <Star
                size={12}
                fill="currentColor"
                className="absolute top-1.5 right-1.5 text-amber-300"
                aria-hidden="true"
              />
              <span className="sr-only">Favorite</span>
            </>
          )}

          {/* Selected indicator */}
          {isSelected && (
            <span
              aria-hidden="true"
              className="absolute bottom-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-sg-accent text-white"
            >
              <Check size={12} strokeWidth={3} />
            </span>
          )}
          {usageCount > 0 && (
            <span className="absolute bottom-1.5 left-2 text-[10px] 
                     text-sg-muted font-mono">
              {usageCount > 99 ? '99+' : usageCount}
            </span>
          )}
        </motion.div>
      </ThumbnailPreview>

      {menuPos && (
        <Portal>
          <div
            className="fixed z-[9999] bg-sg-surface border border-sg-border rounded-lg shadow-xl py-1 min-w-48"
            style={{ left: menuPos.x, top: menuPos.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { toggleStyle(style); setMenuPos(null) }}
            >
              {isSelected ? '✕ Deselect' : '✓ Select'}
            </button>
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { toggleFavorite(style); setMenuPos(null) }}
            >
              <Star size={14} aria-hidden="true" />
              {fav ? 'Remove from Favorites' : 'Add to Favorites'}
            </button>
            <div className="h-px my-1 bg-sg-border" />
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={async () => {
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
            </button>
            {!isLora && (
              <>
                <button
                  className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
                  onClick={() => {
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
                </button>
                <button
                  className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
                  onClick={() => {
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
                </button>
                <button
                  className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
                  onClick={() => {
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
                </button>
              </>
            )}
            {!isLora && (
              <>
                <div className="h-px my-1 bg-sg-border" />
                <button
                  className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm transition-colors ${previewReadOnlyClass}`}
                  onClick={() => {
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
                </button>
                <button
                  className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm transition-colors ${previewReadOnlyClass}`}
                  onClick={() => {
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
                </button>
                {style.has_thumbnail && (
                  <button
                    className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm transition-colors ${previewReadOnlyClass}`}
                    onClick={async () => {
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
                        const res = await fetch(`/style_grid/thumbnail?${params}`, {
                          method: 'DELETE',
                          headers: styleGridWriteHeaders(),
                        })
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
                        const version = Date.now()
                        window.postMessage(
                          {
                            type: 'SG_THUMB_DONE',
                            styleId: name,
                            version,
                            source_file: source_file || '',
                          },
                          '*',
                        )
                        useStylesStore.setState((s) => ({
                          styles: s.styles.map((row) =>
                            styleRowKey(row) === styleRowKey(style)
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
                  </button>
                )}
              </>
            )}
            {!isLora && (
              <>
                <div className="h-px my-1 bg-sg-border" />
                <button
                  className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
                  onClick={() => {
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
                </button>
              </>
            )}
          </div>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setMenuPos(null)}
            onContextMenu={(e) => e.preventDefault()}
          />
        </Portal>
      )}

      {pickerPos && (
        <Portal>
          <div
            className="fixed z-[10005] bg-sg-surface border border-sg-border rounded-lg shadow-xl py-1"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              left: pickerPos.x,
              top: pickerPos.y,
              width: `${pickerWidthCh}ch`,
              minWidth: '18ch',
              maxWidth: '48ch',
            }}
          >
            {duplicates.map((dup, idx) => {
              const sourceLabel = sourceLabels[idx] || 'Unknown'
              return (
                <button
                  key={`${dup.source_file || 'unknown'}-${idx}`}
                  className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleStyle(dup)
                    setPickerPos(null)
                  }}
                >
                  <div className="font-medium truncate">{sourceLabel}</div>
                </button>
              )
            })}
          </div>
          <div
            className="fixed inset-0 z-[10004]"
            onMouseDown={() => setPickerPos(null)}
          />
        </Portal>
      )}
    </>
  )
})
