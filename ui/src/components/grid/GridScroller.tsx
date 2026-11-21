import { useState, type HTMLAttributes } from 'react'
import { GridScrollerContext } from './GridScrollerContext'

/**
 * The scrolling box of the style grid. It provides itself as the grid
 * scroller, so the element that scrolls and the element the virtualizer
 * measures cannot drift apart. The caller owns the overflow styles.
 */
export function GridScroller({ children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  return (
    <div {...rest} ref={setEl}>
      <GridScrollerContext.Provider value={el}>{children}</GridScrollerContext.Provider>
    </div>
  )
}
