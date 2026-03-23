import { motion } from 'framer-motion'
import type { Style } from '../bridge'
import { useStylesStore } from '../store/stylesStore'

interface Props { style: Style }

export function StyleCard({ style }: Props) {
  const { selectedStyles, toggleStyle, isFavorite, toggleFavorite } = useStylesStore()
  const isSelected = selectedStyles.some(s => s.name === style.name)
  const fav = isFavorite(style.name)
  
  const displayName = style.name.includes('_')
    ? style.name.split('_').slice(1).join(' ')
    : style.name

  return (
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
        transition-all duration-150 select-none
        ${isSelected
          ? 'border-sg-accent bg-sg-accent/10 shadow-[0_0_0_1px] shadow-sg-accent'
          : 'border-sg-border bg-sg-surface hover:border-sg-accent/50 hover:bg-sg-surface/80'}
      `}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggleFavorite(style.name)
        }}
        className={`absolute top-1.5 right-1.5 text-xs transition-colors z-10
    ${fav ? 'text-yellow-400' : 'text-sg-border hover:text-sg-muted'}`}
      >
        ★
      </button>
      <div className="text-sm font-medium text-sg-text truncate">
        {displayName}
      </div>
      <div className="text-xs text-sg-muted mt-0.5 truncate">
        {style.category}
      </div>
      {isSelected && (
        <div className="absolute bottom-2 right-2 w-2 h-2 
                        rounded-full bg-sg-accent" />
      )}
    </motion.div>
  )
}
