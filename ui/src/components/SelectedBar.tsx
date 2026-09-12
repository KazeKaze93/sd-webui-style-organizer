import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { useStylesStore } from '../store/stylesStore'
import { sendToHost } from '../bridge'
import { describeSpec } from '../lib/wildcardSlice'

export function SelectedBar() {
  const { selectedStyles, toggleStyle, setSelectedStyles, activeWildcards, setActiveWildcards, removeWildcard } = useStylesStore()

  if (selectedStyles.length === 0 && activeWildcards.length === 0) return null

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
        {selectedStyles.length > 0 && (
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
            className="flex flex-wrap gap-2 px-4 pt-2"
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
        )}

        {activeWildcards.length > 0 && (
          <Reorder.Group
            axis="x"
            values={activeWildcards}
            onReorder={(newOrder) => {
              setActiveWildcards(newOrder)
              sendToHost({ type: 'SG_REORDER_WILDCARDS', categories: newOrder })
            }}
            className="flex flex-wrap gap-2 px-4 py-2"
            as="div"
          >
            {activeWildcards.map((ref) => {
              const { category, spec } = ref
              const { count, entries } = describeSpec(spec)
              const label = spec === '' ? category : `${category} (${count})`
              const title = spec === '' ? undefined : entries.join(', ')
              return (
                <Reorder.Item
                  key={`${category}:${spec}`}
                  value={ref}
                  as="span"
                  title={title}
                  className="flex items-center gap-1 px-2 py-1 rounded-full
                             bg-purple-500/20 border border-purple-400/40
                             text-xs text-sg-text cursor-grab active:cursor-grabbing
                             hover:bg-purple-500/30 transition-colors select-none"
                  whileDrag={{ scale: 1.05, zIndex: 50 }}
                >
                  <span className="text-sg-muted/50 mr-0.5 text-[10px]">⠿</span>
                  <span className="mr-0.5">🎲</span>
                  {label}
                  <button
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => removeWildcard(ref)}
                    className="text-sg-muted hover:text-sg-text ml-1 transition-colors leading-none"
                  >✕</button>
                </Reorder.Item>
              )
            })}
          </Reorder.Group>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
