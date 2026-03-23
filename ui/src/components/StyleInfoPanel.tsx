import { useStylesStore } from '../store/stylesStore'
import { ComboChips } from './ComboChips'
import { motion, AnimatePresence } from 'framer-motion'

export function StyleInfoPanel() {
  const { selectedStyles, styles } = useStylesStore()

  // Show info for the LAST selected style
  const lastSelected = selectedStyles[selectedStyles.length - 1]
  if (!lastSelected) return null

  // Get full style data
  const style = styles.find(s => s.name === lastSelected.name) || lastSelected

  const displayName = style.name.includes('_')
    ? style.name.split('_').slice(1).join(' ')
    : style.name

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="border-t border-sg-border bg-sg-surface/30 
                   px-4 py-2 overflow-hidden"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white">
              {displayName}
            </div>
            {style.description && !style.description.includes('Combos:') && (
              <div className="text-xs text-sg-muted mt-0.5 line-clamp-2">
                {style.description.replace(/Combos?:[^.]+\.?/i, '').trim()}
              </div>
            )}
            <ComboChips style={style} />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
