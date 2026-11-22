import { useStylesStore } from '../store/stylesStore'
import { StyleInfoPanel } from './StyleInfoPanel'
import { SelectedBar } from './SelectedBar'
import { TRAY_MAX_HEIGHT_CSS } from './trayLayout'

/** Ring only for keyboard focus; programmatic focus after a mouse action shows nothing. */
const TRAY_FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sg-accent'

/**
 * Profile (P toggle N=5000): motion ~28% active; `measureScroll` (framer-motion)
 * #2 self (~10.6–13%). Height AnimatePresence/`motion.div` measured layout on open.
 * CSS grid-rows 0fr→1fr opens/closes without framer measureScroll.
 *
 * Height is capped (TRAY_MAX_HEIGHT_RATIO of the panel): the selection header
 * stays pinned and the chips scroll inside, so a large selection can no longer
 * push the grid out of the panel. The style info gives way first when short.
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
      {/* Focusable region: where focus lands when the last conflict is resolved
          (the conflicts trigger is gone by then). Not in the tab order. */}
      <div
        data-sg-tray="true"
        role="region"
        aria-label="Selection"
        tabIndex={-1}
        className={`min-h-0 overflow-hidden flex flex-col ${TRAY_FOCUS_RING}`}
        style={{ maxHeight: TRAY_MAX_HEIGHT_CSS }}
      >
        {open ? (
          <>
            <div className="min-h-0 overflow-hidden" style={{ flex: '0 1 auto' }}>
              <StyleInfoPanel />
            </div>
            <SelectedBar />
          </>
        ) : null}
      </div>
    </div>
  )
}
