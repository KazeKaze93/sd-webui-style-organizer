/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVirtualizer } from '@tanstack/react-virtual'
import { VIRTUALIZER_TEST_INITIAL_RECT } from './constants'

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const height = Number.parseFloat(this.style.height) || VIRTUALIZER_TEST_INITIAL_RECT.height
    const width = Number.parseFloat(this.style.width) || VIRTUALIZER_TEST_INITIAL_RECT.width
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON() {
        return {}
      },
    }
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return Number.parseFloat(this.style.height) || VIRTUALIZER_TEST_INITIAL_RECT.height
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return Number.parseFloat(this.style.width) || VIRTUALIZER_TEST_INITIAL_RECT.width
    },
  })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  host?.remove()
  host = null
  vi.restoreAllMocks()
})

function Probe({ onCount }: { onCount: (n: number) => void }) {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- probe for initialRect
  const virtualizer = useVirtualizer({
    count: 20,
    getScrollElement: () => scrollEl,
    estimateSize: () => 40,
    initialRect: VIRTUALIZER_TEST_INITIAL_RECT,
  })
  const itemCount = virtualizer.getVirtualItems().length
  if (itemCount > 0) onCount(itemCount)
  return (
    <div
      ref={setScrollEl}
      style={{
        height: `${VIRTUALIZER_TEST_INITIAL_RECT.height}px`,
        width: `${VIRTUALIZER_TEST_INITIAL_RECT.width}px`,
        overflow: 'auto',
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            style={{
              position: 'absolute',
              top: 0,
              transform: `translateY(${row.start}px)`,
              height: row.size,
              width: '100%',
            }}
          />
        ))}
      </div>
    </div>
  )
}

describe('virtualizer initialRect', () => {
  it('uses VIRTUALIZER_TEST_INITIAL_RECT so jsdom yields visible rows', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)

    let seen = 0
    await act(async () => {
      root!.render(
        <Probe
          onCount={(n) => {
            seen = n
          }}
        />,
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(VIRTUALIZER_TEST_INITIAL_RECT).toEqual({ width: 800, height: 600 })
    expect(seen).toBeGreaterThan(1)
  })
})
