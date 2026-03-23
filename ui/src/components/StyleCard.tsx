import { motion } from 'framer-motion'
import type { Style } from '../bridge'
import { useStylesStore } from '../store/stylesStore'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger
} from './ui/context-menu'
import { sendToHost } from '../bridge'

interface Props { style: Style }

export function StyleCard({ style }: Props) {
  const { selectedStyles, toggleStyle, isFavorite, toggleFavorite } = useStylesStore()
  const isSelected = selectedStyles.some(s => s.name === style.name)
  const fav = isFavorite(style.name)

  const displayName = style.name.includes('_')
    ? style.name.split('_').slice(1).join(' ')
    : style.name

  const hasPromptPlaceholder = style.prompt?.includes('{prompt}')

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <motion.div
          layout
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.1 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => toggleStyle(style)}
          className={`
            relative cursor-pointer rounded-lg border p-3
            transition-colors duration-150 select-none
            ${isSelected
              ? 'border-sg-accent bg-sg-accent/10'
              : 'border-sg-border bg-sg-surface hover:border-sg-accent/50'}
          `}
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

          <div className="text-sm font-medium text-sg-text truncate pr-8">
            {displayName}
          </div>
          <div className="text-xs text-sg-muted mt-0.5 truncate">
            {style.category}
          </div>

          {/* Selected indicator */}
          {isSelected && (
            <div className="absolute bottom-2 right-2 w-2 h-2 
                            rounded-full bg-sg-accent" />
          )}
        </motion.div>
      </ContextMenuTrigger>

      <ContextMenuContent className="bg-sg-surface border-sg-border w-48">
        <ContextMenuItem
          className="text-sg-text hover:bg-sg-accent/20 cursor-pointer text-sm"
          onClick={() => toggleStyle(style)}
        >
          {isSelected ? '✕ Deselect' : '✓ Select'}
        </ContextMenuItem>
        <ContextMenuItem
          className="text-sg-text hover:bg-sg-accent/20 cursor-pointer text-sm"
          onClick={() => toggleFavorite(style.name)}
        >
          {fav ? '★ Remove from Favorites' : '☆ Add to Favorites'}
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-sg-border" />
        <ContextMenuItem
          className="text-sg-text hover:bg-sg-accent/20 cursor-pointer text-sm"
          onClick={() => navigator.clipboard.writeText(style.prompt)}
        >
          📋 Copy prompt
        </ContextMenuItem>
        <ContextMenuItem
          className="text-sg-text hover:bg-sg-accent/20 cursor-pointer text-sm"
          onClick={() => sendToHost({ type: 'SG_EDIT_STYLE', 
                                      styleId: style.name })}
        >
          ✏️ Edit
        </ContextMenuItem>
        <ContextMenuItem
          className="text-sg-text hover:bg-sg-accent/20 cursor-pointer text-sm"
          onClick={() => sendToHost({ type: 'SG_DUPLICATE_STYLE', 
                                      styleId: style.name })}
        >
          📄 Duplicate
        </ContextMenuItem>
        <ContextMenuItem
          className="text-sg-text hover:bg-sg-accent/20 cursor-pointer text-sm"
          onClick={() => sendToHost({ type: 'SG_MOVE_TO_CATEGORY', styleId: style.name })}
        >
          📂 Move to category...
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-sg-border" />
        <ContextMenuItem
          className="text-sg-text hover:bg-sg-accent/20 cursor-pointer text-sm"
          onClick={() => sendToHost({ type: 'SG_GENERATE_PREVIEW', styleId: style.name })}
        >
          🎨 Generate preview (SD)
        </ContextMenuItem>
        <ContextMenuItem
          className="text-sg-text hover:bg-sg-accent/20 cursor-pointer text-sm"
          onClick={() => sendToHost({ type: 'SG_UPLOAD_PREVIEW', styleId: style.name })}
        >
          🖼️ Upload preview image
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-sg-border" />
        <ContextMenuItem
          className="text-red-400 hover:bg-red-500/20 cursor-pointer text-sm"
          onClick={() => sendToHost({ type: 'SG_DELETE_STYLE', 
                                      styleId: style.name })}
        >
          🗑️ Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
