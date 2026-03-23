import { memo, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import type { Style } from '../bridge'
import { getCategoryColor, useStylesStore } from '../store/stylesStore'
import { sendToHost } from '../bridge'
import { ThumbnailPreview } from './ThumbnailPreview'

interface Props {
  style: Style
  windowed?: boolean
}

const Portal = ({ children }: { children: React.ReactNode }) =>
  createPortal(children, document.body)

export const StyleCard = memo(function StyleCard({ style, windowed = false }: Props) {
  const { selectedStyles, toggleStyle, isFavorite, toggleFavorite, usageCounts } = useStylesStore()
  const [menuPos, setMenuPos] = useState<{ x: number, y: number } | null>(null)
  const isSelected = selectedStyles.some(s => s.name === style.name)
  const fav = isFavorite(style.name)
  const usageCount = usageCounts[style.name] || 0

  const displayName = style.name.includes('_')
    ? style.name.split('_').slice(1).join(' ')
    : style.name

  const hasPromptPlaceholder = style.prompt?.includes('{prompt}')
  const borderColor = getCategoryColor(style.category || 'OTHER')

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
          onClick={() => toggleStyle(style)}
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
          {/* Favorite star */}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); toggleFavorite(style.name) }}
            className={`absolute top-1.5 right-6 text-xs transition-colors z-10
              ${fav ? 'text-yellow-400' : 'text-sg-border hover:text-sg-muted'}`}
          >★</button>

          {/* {prompt} indicator */}
          {hasPromptPlaceholder && (
            <span className="absolute top-1.5 right-2 text-xs text-sg-muted"
                  title="Contains {prompt} placeholder">⟳</span>
          )}

          <div className={`${windowed ? 'text-xs' : 'text-sm'} font-medium text-sg-text truncate ${windowed ? 'pr-6' : 'pr-8'}`}>
            {displayName}
          </div>

          {/* Selected indicator */}
          {isSelected && (
            <div className="absolute bottom-2 right-2 w-2 h-2
                            rounded-full bg-sg-accent" />
          )}
          {usageCount > 0 && (
            <span className="absolute bottom-1.5 left-2 text-[10px] 
                     text-sg-muted/60 font-mono">
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
            onMouseLeave={() => setMenuPos(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { toggleStyle(style); setMenuPos(null) }}
            >
              {isSelected ? '✕ Deselect' : '✓ Select'}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { toggleFavorite(style.name); setMenuPos(null) }}
            >
              {fav ? '★ Remove from Favorites' : '☆ Add to Favorites'}
            </button>
            <div className="h-px my-1 bg-sg-border" />
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { navigator.clipboard.writeText(style.prompt); setMenuPos(null) }}
            >
              📋 Copy prompt
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { sendToHost({ type: 'SG_EDIT_STYLE', styleId: style.name }); setMenuPos(null) }}
            >
              ✏️ Edit
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { sendToHost({ type: 'SG_DUPLICATE_STYLE', styleId: style.name }); setMenuPos(null) }}
            >
              📄 Duplicate
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { sendToHost({ type: 'SG_MOVE_TO_CATEGORY', styleId: style.name }); setMenuPos(null) }}
            >
              📂 Move to category...
            </button>
            <div className="h-px my-1 bg-sg-border" />
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { sendToHost({ type: 'SG_GENERATE_PREVIEW', styleId: style.name }); setMenuPos(null) }}
            >
              🎨 Generate preview (SD)
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { sendToHost({ type: 'SG_UPLOAD_PREVIEW', styleId: style.name }); setMenuPos(null) }}
            >
              🖼️ Upload preview image
            </button>
            <div className="h-px my-1 bg-sg-border" />
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
              onClick={() => { sendToHost({ type: 'SG_DELETE_STYLE', styleId: style.name }); setMenuPos(null) }}
            >
              🗑️ Delete
            </button>
          </div>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setMenuPos(null)}
            onContextMenu={(e) => e.preventDefault()}
          />
        </Portal>
      )}
    </>
  )
})
