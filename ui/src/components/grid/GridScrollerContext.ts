import { createContext, useContext } from 'react'

/**
 * The element that actually scrolls the style grid.
 *
 * `undefined` = no provider (a programming error, see `useGridScroller`).
 * `null`      = provider mounted, element not attached yet (first render).
 *
 * The grid used to take `root.parentElement` as its scroller. Commit 7841195
 * put a non-scrolling wrapper between the two and nothing failed: the
 * virtualizer just measured the wrong element and rendered every row. The
 * scroller is therefore passed explicitly and never looked up in the DOM.
 */
export const GridScrollerContext = createContext<HTMLElement | null | undefined>(undefined)

export const MISSING_GRID_SCROLLER_MESSAGE =
  'VirtualStyleGrid must be rendered inside <GridScroller> (GridScrollerContext): it has no scroll element to virtualize against.'

export type GridScrollerState = {
  scroller: HTMLElement | null
  /** True when no provider is mounted. Production only: dev and tests throw instead. */
  missing: boolean
}

/**
 * Read the grid scroller. Without a provider:
 * - dev / tests: throw, so the mistake cannot ship unnoticed;
 * - production: `missing` is true and the caller reports it and renders
 *   nothing, rather than virtualize against a wrong element or take the
 *   whole panel down.
 */
export function useGridScroller(): GridScrollerState {
  const value = useContext(GridScrollerContext)
  if (value === undefined) {
    if (import.meta.env.DEV) {
      throw new Error(MISSING_GRID_SCROLLER_MESSAGE)
    }
    return { scroller: null, missing: true }
  }
  return { scroller: value, missing: false }
}
