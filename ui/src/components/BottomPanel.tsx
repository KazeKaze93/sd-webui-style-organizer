import { motion, AnimatePresence } from 'framer-motion'
import { useStylesStore } from '../store/stylesStore'
import { StyleInfoPanel } from './StyleInfoPanel'
import { SelectedBar } from './SelectedBar'

export function BottomPanel() {
  const { selectedStyles, activeWildcards } = useStylesStore()
  if (selectedStyles.length === 0 && activeWildcards.length === 0) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="border-t border-sg-border bg-sg-surface/40 overflow-hidden"
      >
        <StyleInfoPanel />
        <SelectedBar />
      </motion.div>
    </AnimatePresence>
  )
}
