import { useStylesStore } from '../store/stylesStore'
import { StyleInfoPanel } from './StyleInfoPanel'
import { SelectedBar } from './SelectedBar'

/**
 * Profile (P toggle N=5000): motion ~28% active; `measureScroll` (framer-motion)
 * #2 self (~10.6–13%). Height AnimatePresence/`motion.div` measured layout on open.
 * CSS grid-rows 0fr→1fr opens/closes without framer measureScroll.
 */
export function BottomPanel() {
  const open = useStylesStore(
    (s) => s.selectedStyles.length > 0 || s.activeWildcards.length > 0,
  )

  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        open
          ? 'grid-rows-[1fr] opacity-100 border-t border-sg-border bg-sg-surface/40'
          : 'grid-rows-[0fr] opacity-0 pointer-events-none'
      }`}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">
        {open ? (
          <>
            <StyleInfoPanel />
            <SelectedBar />
          </>
        ) : null}
      </div>
    </div>
  )
}
