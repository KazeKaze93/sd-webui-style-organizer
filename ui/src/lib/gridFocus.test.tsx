/** @vitest-environment jsdom */
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetGridFocusForTests,
  getFocusedCell,
  gridFocusStore,
  setFocusedCell,
  useFocusedCell,
} from './gridFocus'

describe('gridFocus store', () => {
  beforeEach(() => {
    __resetGridFocusForTests()
  })

  afterEach(() => {
    __resetGridFocusForTests()
  })

  it('exposes focusedCell / setFocusedCell on the module store', () => {
    expect(gridFocusStore.focusedCell).toBeNull()
    setFocusedCell({ row: 2, col: 1 })
    expect(getFocusedCell()).toEqual({ row: 2, col: 1 })
    expect(gridFocusStore.focusedCell).toEqual({ row: 2, col: 1 })
    gridFocusStore.setFocusedCell(null)
    expect(getFocusedCell()).toBeNull()
  })
})

describe('useFocusedCell', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let seen: Array<ReturnType<typeof getFocusedCell>> = []

  beforeEach(() => {
    __resetGridFocusForTests()
    seen = []
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    host?.remove()
    host = null
    __resetGridFocusForTests()
  })

  it('subscribes with a narrow selector and updates on setFocusedCell', () => {
    function Probe() {
      const cell = useFocusedCell()
      const [, setTick] = useState(0)
      useEffect(() => {
        seen.push(cell)
      }, [cell])
      return (
        <button type="button" onClick={() => setTick((n) => n + 1)}>
          {cell ? `${cell.row},${cell.col}` : 'none'}
        </button>
      )
    }

    act(() => {
      root!.render(<Probe />)
    })
    expect(seen.at(-1)).toBeNull()

    act(() => {
      setFocusedCell({ row: 0, col: 1 })
    })
    expect(seen.at(-1)).toEqual({ row: 0, col: 1 })
    expect(host!.textContent).toBe('0,1')
  })
})
