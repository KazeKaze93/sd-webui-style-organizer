/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Boom({ message }: { message: string }): never {
  throw new Error(message)
}

/**
 * Reload remounts ErrorBoundary children via resetKey, but the parent must
 * stop rendering the throwing child. Drive that from outside the boundary.
 */
function Harness() {
  const [fail, setFail] = useState(true)
  return (
    <div>
      <button type="button" data-testid="heal" onClick={() => setFail(false)}>
        heal
      </button>
      <ErrorBoundary>
        {fail ? <Boom message="boom-for-boundary" /> : <div data-testid="recovered">ok</div>}
      </ErrorBoundary>
    </div>
  )
}

describe('ErrorBoundary', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
    consoleErrorSpy?.mockRestore()
    consoleErrorSpy = null
  })

  it('shows alert with thrown message, then remounts children after Reload', () => {
    act(() => {
      root!.render(<Harness />)
    })

    const alert = host!.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    const details = alert!.querySelector('details')
    expect(details?.textContent).toContain('boom-for-boundary')

    act(() => {
      host!.querySelector<HTMLButtonElement>('[data-testid="heal"]')!.click()
    })
    act(() => {
      const reload = Array.from(host!.querySelectorAll('button')).find(
        (b) => b.textContent === 'Reload',
      )
      reload!.click()
    })

    expect(host!.querySelector('[role="alert"]')).toBeNull()
    expect(host!.querySelector('[data-testid="recovered"]')?.textContent).toBe('ok')
  })
})
