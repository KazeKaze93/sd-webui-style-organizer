import { motion, AnimatePresence } from 'framer-motion'
import { useStylesStore } from '../store/stylesStore'

export function SelectedBar() {
  const { selectedStyles, toggleStyle } = useStylesStore()

  return (
    <AnimatePresence>
      {selectedStyles.length > 0 && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-wrap gap-2 px-4 py-2 
                     border-t border-sg-border bg-sg-surface/50 overflow-hidden"
        >
          <AnimatePresence>
            {selectedStyles.map(s => (
              <motion.span
                key={s.name}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.1 }}
                className="flex items-center gap-1 px-2 py-1 rounded-full 
                           bg-sg-accent/20 border border-sg-accent/40 
                           text-xs text-sg-text cursor-pointer
                           hover:bg-sg-accent/30 transition-colors"
                onClick={() => toggleStyle(s)}
              >
                {s.name.includes('_') ? s.name.split('_').slice(1).join(' ') : s.name}
                <span className="text-sg-muted ml-1">✕</span>
              </motion.span>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
