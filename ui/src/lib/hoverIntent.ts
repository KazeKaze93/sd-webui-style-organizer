/**
 * Delayed show / hide for a hover popup, safe against duplicate enter events.
 *
 * Every transition clears whatever timer is pending first, so two `enter()`
 * calls followed by one `leave()` can never leave an orphan show timer behind.
 * The show timer re-checks `canShow()` when it fires: a popup must not appear
 * for a target the pointer has already left.
 */
/**
 * Hover delay of the tile preview popup, shared by other hover hints (the
 * sidebar category tooltip) so they open at the same pace.
 */
export const HOVER_POPUP_SHOW_DELAY_MS = 300

export type HoverIntentOptions = {
  showDelayMs: number
  hideDelayMs: number
  /** Asked when the show timer fires; false drops the show. */
  canShow: () => boolean
  onShow: () => void
  onHide: () => void
}

export type HoverIntent = {
  /** Pointer entered the target: (re)start the show timer. */
  enter: () => void
  /** Pointer left the target or the popup: cancel the show, hide after the delay. */
  leave: () => void
  /** Pointer is on the popup itself: keep it as is, cancel pending timers. */
  hold: () => void
  /** Hide now and cancel everything (window blur, pointer left the document). */
  dismiss: () => void
  /** Cancel timers without calling back (unmount). */
  dispose: () => void
}

/** Intents with a pending timer or a visible popup — the only ones a global dismiss must touch. */
const liveIntents = new Set<HoverIntent>()

/** Hide every pending or visible hover popup at once. */
export function dismissAllHoverIntents(): void {
  for (const intent of [...liveIntents]) intent.dismiss()
}

let globalDismissInstalled = false

/**
 * One pair of listeners for all popups: the iframe window losing focus (a host
 * modal opened over it) and the pointer leaving the iframe document. In both
 * cases no mouseleave is guaranteed to reach the card, so hide explicitly.
 */
function installGlobalDismiss(): void {
  if (globalDismissInstalled) return
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  globalDismissInstalled = true
  window.addEventListener('blur', dismissAllHoverIntents)
  document.documentElement.addEventListener('mouseleave', dismissAllHoverIntents)
}

export function createHoverIntent(options: HoverIntentOptions): HoverIntent {
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimers = () => {
    if (showTimer !== null) {
      clearTimeout(showTimer)
      showTimer = null
    }
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  const intent: HoverIntent = {
    enter() {
      clearTimers()
      liveIntents.add(intent)
      showTimer = setTimeout(() => {
        showTimer = null
        if (!options.canShow()) {
          liveIntents.delete(intent)
          return
        }
        options.onShow()
      }, options.showDelayMs)
    },
    leave() {
      clearTimers()
      hideTimer = setTimeout(() => {
        hideTimer = null
        liveIntents.delete(intent)
        options.onHide()
      }, options.hideDelayMs)
    },
    hold() {
      clearTimers()
    },
    dismiss() {
      clearTimers()
      liveIntents.delete(intent)
      options.onHide()
    },
    dispose() {
      clearTimers()
      liveIntents.delete(intent)
    },
  }

  installGlobalDismiss()
  return intent
}
