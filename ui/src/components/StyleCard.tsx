import { motion } from 'framer-motion'
import type { Style } from '../bridge'
import { useStylesStore } from '../store/stylesStore'

interface Props { style: Style }

export function StyleCard({ style }: Props) {
  const { selectedStyles, toggleStyle } = useStylesStore()
  const isSelected = selectedStyles.some(s => s.name === style.name)
  
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
      <div className="text-sm font-medium text-sg-text truncate">
        {displayName}
      </div>
      <div className="text-xs text-sg-muted mt-0.5 truncate">
        {style.category}
      </div>
      {isSelected && (
        <div className="absolute top-2 right-2 w-2 h-2 
                        rounded-full bg-sg-accent" />
      )}
    </motion.div>
  )
}
