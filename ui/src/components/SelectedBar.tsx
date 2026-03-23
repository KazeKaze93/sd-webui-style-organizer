import { useState } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { useStylesStore } from '../store/stylesStore'
import { sendToHost } from '../bridge'

export function SelectedBar() {
  const { selectedStyles, toggleStyle, setSelectedStyles } = useStylesStore()
  
  if (selectedStyles.length === 0) return null

  const displayName = (name: string) =>
    name.includes('_') ? name.split('_').slice(1).join(' ') : name

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="border-t border-sg-border bg-sg-surface/50 overflow-hidden"
      >
        <Reorder.Group
          axis="x"
          values={selectedStyles}
          onReorder={(newOrder) => {
            setSelectedStyles(newOrder)
            // Rebuild prompt in new order
            sendToHost({ 
              type: 'SG_REORDER_STYLES', 
              styleIds: newOrder.map(s => s.name) 
            })
          }}
          className="flex flex-wrap gap-2 px-4 py-2"
          as="div"
        >
          {selectedStyles.map(s => (
            <Reorder.Item
              key={s.name}
              value={s}
              as="span"
              className="flex items-center gap-1 px-2 py-1 rounded-full
                         bg-sg-accent/20 border border-sg-accent/40
                         text-xs text-sg-text cursor-grab active:cursor-grabbing
                         hover:bg-sg-accent/30 transition-colors select-none"
              whileDrag={{ scale: 1.05, zIndex: 50 }}
            >
              <span className="text-sg-muted/50 mr-0.5 text-[10px]">⠿</span>
              {displayName(s.name)}
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={() => toggleStyle(s)}
                className="text-sg-muted hover:text-sg-text ml-1 
                           transition-colors leading-none"
              >✕</button>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      </motion.div>
    </AnimatePresence>
  )
}
