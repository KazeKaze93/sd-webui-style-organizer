import { useRef, useState } from 'react'
import { useStylesStore } from '../store/stylesStore'
import { ComboChips } from './ComboChips'
import { motion, AnimatePresence } from 'framer-motion'

export function StyleInfoPanel() {
  const { selectedStyles, styles } = useStylesStore()
  const [pinnedStyle, setPinnedStyle] = useState<typeof styles[0] | null>(null)
  const isChipClick = useRef(false)

  const lastSelected = selectedStyles[selectedStyles.length - 1]

  // Clear pin only when selection changes from a non-chip action
  // We detect this by checking if pinnedStyle is no longer selected
  const resolvedStyle = (() => {
    if (pinnedStyle) {
      const stillSelected = selectedStyles.some(s => s.name === pinnedStyle.name)
      if (stillSelected || isChipClick.current) return pinnedStyle
      // Pin target was deselected — clear pin
      setPinnedStyle(null)
    }
    return lastSelected ? (styles.find(s => s.name === lastSelected.name) || lastSelected) : null
  })()

  if (!resolvedStyle) return null

  const displayName = resolvedStyle.name.includes('_')
    ? resolvedStyle.name.split('_').slice(1).join(' ')
    : resolvedStyle.name

  const handlePin = () => {
    isChipClick.current = true
    const full = styles.find(s => s.name === resolvedStyle.name) || resolvedStyle
    setPinnedStyle(full)
    setTimeout(() => { isChipClick.current = false }, 0)
  }

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
            {resolvedStyle.description && !resolvedStyle.description.includes('Combos:') && (
              <div className="text-xs text-sg-muted mt-0.5 line-clamp-2">
                {resolvedStyle.description.replace(/Combos?:[^.]+\.?/i, '').trim()}
              </div>
            )}
            <ComboChips style={resolvedStyle} onBeforeToggle={handlePin} />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
