/** @vitest-environment jsdom */
import { act, useRef, useState, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useFocusTrap } from './useFocusTrap'

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
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
  document.body.innerHTML = ''
})

function TrapProbe({
  active,
  restoreFocus = true,
  useInitial = false,
}: {
  active: boolean
  restoreFocus?: boolean
  useInitial?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const initialRef = useRef<HTMLButtonElement>(null)
  useFocusTrap(containerRef, active, {
    initialFocus: useInitial ? initialRef : undefined,
    restoreFocus,
  })
  return (
    <div ref={containerRef} data-testid="trap">
      <button type="button" data-testid="first">
        First
      </button>
      <button type="button" ref={initialRef} data-testid="middle">
        Middle
      </button>
      <button type="button" data-testid="last">
        Last
      </button>
    </div>
  )
}

describe('useFocusTrap', () => {
  it('focuses the first focusable on activate', () => {
    const opener = document.createElement('button')
    opener.textContent = 'opener'
    document.body.appendChild(opener)
    opener.focus()

    act(() => {
      root!.render(<TrapProbe active={true} />)
    })

    expect(document.activeElement?.getAttribute('data-testid')).toBe('first')
  })

  it('focuses initialFocus when provided', () => {
    act(() => {
      root!.render(<TrapProbe active={true} useInitial={true} />)
    })
    expect(document.activeElement?.getAttribute('data-testid')).toBe('middle')
  })

  it('cycles Tab and Shift+Tab inside the trap', () => {
    act(() => {
      root!.render(<TrapProbe active={true} />)
    })

    const first = host!.querySelector('[data-testid="first"]') as HTMLButtonElement
    const last = host!.querySelector('[data-testid="last"]') as HTMLButtonElement
    first.focus()

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      )
    })
    // native tab may not move in jsdom; force last then wrap
    last.focus()
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      )
    })
    expect(document.activeElement).toBe(first)

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(document.activeElement).toBe(last)
  })

  it('restores focus to the opener on deactivate', () => {
    const opener = document.createElement('button')
    opener.textContent = 'opener'
    document.body.appendChild(opener)
    opener.focus()

    function Toggle() {
      const [open, setOpen] = useState(true)
      const containerRef = useRef<HTMLDivElement>(null)
      useFocusTrap(containerRef as RefObject<HTMLElement | null>, open, {
        restoreFocus: true,
      })
      return (
        <div>
          <button type="button" data-testid="toggle" onClick={() => setOpen(false)}>
            close
          </button>
          {open ? (
            <div ref={containerRef}>
              <button type="button" data-testid="inside">
                inside
              </button>
            </div>
          ) : null}
        </div>
      )
    }

    act(() => {
      root!.render(<Toggle />)
    })
    expect(document.activeElement?.getAttribute('data-testid')).toBe('inside')

    act(() => {
      ;(host!.querySelector('[data-testid="toggle"]') as HTMLButtonElement).click()
    })
    expect(document.activeElement).toBe(opener)
  })
})
