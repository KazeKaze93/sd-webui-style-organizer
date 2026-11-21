/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { sendToHost } from './bridge'
import { cardRowHeightPx, gridMinVisibleHeightPx } from './components/grid/constants'
import { __resetGridFocusForTests } from './lib/gridFocus'
import { __resetLayerStackForTests } from './lib/layerStack'

vi.mock('./bridge', async () => {
  const actual = await vi.importActual<typeof import('./bridge')>('./bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const sendToHostMock = vi.mocked(sendToHost)
const LEGACY_KEY = 'sg_windowed_size'
/** `pt-3` above the grid, as in App.tsx. */
const GRID_PAD_TOP = 12

describe('App fullscreen: the host is the single source of truth', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  const frameElementGet = vi.fn(() => null)

  const fullscreenButton = () =>
    host!.querySelector<HTMLButtonElement>(
      'button[aria-label="Fullscreen"], button[aria-label="Exit fullscreen"]',
    )!
  const label = () => fullscreenButton().getAttribute('aria-label')
  const bodyMinHeight = () => host!.querySelector<HTMLElement>('[data-sg-body]')!.style.minHeight
  const fullscreenRequests = () =>
    sendToHostMock.mock.calls.map(([msg]) => msg).filter((msg) => msg.type === 'SG_SET_FULLSCREEN')

  /** A message as the host would post it: same origin, from the parent window. */
  const fromHost = async (data: unknown) => {
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data, origin: window.location.origin, source: window.parent }),
      )
    })
  }

  const click = async (el: HTMLElement) => {
    await act(async () => {
      el.click()
    })
  }

  beforeEach(async () => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    sendToHostMock.mockClear()
    frameElementGet.mockClear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response),
    )
    // Any read of window.frameElement (the old way into the host DOM) is recorded.
    Object.defineProperty(window, 'frameElement', { configurable: true, get: frameElementGet })
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ top: '80px', right: '16px', width: '1000px', height: '650px' }),
    )

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<App />)
    })
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    host?.remove()
    host = null
    delete (window as unknown as Record<string, unknown>).frameElement
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('starts windowed and deletes the stale sg_windowed_size value', () => {
    expect(label()).toBe('Fullscreen')
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(bodyMinHeight()).toBe(`${GRID_PAD_TOP + gridMinVisibleHeightPx(false, true)}px`)
  })

  it('clicking Fullscreen sends SG_SET_FULLSCREEN and changes nothing until the host answers', async () => {
    await click(fullscreenButton())

    expect(fullscreenRequests()).toEqual([{ type: 'SG_SET_FULLSCREEN', fullscreen: true }])
    expect(label()).toBe('Fullscreen')
    expect(bodyMinHeight()).toBe(`${GRID_PAD_TOP + gridMinVisibleHeightPx(false, true)}px`)

    await fromHost({ type: 'SG_FULLSCREEN_STATE', fullscreen: true })
    expect(label()).toBe('Exit fullscreen')
    // Fullscreen switches the grid out of windowed sizing (taller card rows).
    expect(cardRowHeightPx(false, false)).toBeGreaterThan(cardRowHeightPx(false, true))
    expect(bodyMinHeight()).toBe(`${GRID_PAD_TOP + gridMinVisibleHeightPx(false, false)}px`)
  })

  it('exit asks the host too and waits for its answer', async () => {
    await fromHost({ type: 'SG_FULLSCREEN_STATE', fullscreen: true })
    expect(label()).toBe('Exit fullscreen')

    await click(fullscreenButton())
    expect(fullscreenRequests()).toEqual([{ type: 'SG_SET_FULLSCREEN', fullscreen: false }])
    expect(label()).toBe('Exit fullscreen')

    await fromHost({ type: 'SG_FULLSCREEN_STATE', fullscreen: false })
    expect(label()).toBe('Fullscreen')
  })

  it('state follows the host reply even when it differs from the request', async () => {
    await click(fullscreenButton())
    await fromHost({ type: 'SG_FULLSCREEN_STATE', fullscreen: false })
    expect(label()).toBe('Fullscreen')

    // The host may also announce a state nobody asked for (e.g. on SG_READY).
    await fromHost({ type: 'SG_FULLSCREEN_STATE', fullscreen: true })
    expect(label()).toBe('Exit fullscreen')
  })

  it('ignores malformed and untrusted fullscreen replies', async () => {
    await fromHost({ type: 'SG_FULLSCREEN_STATE', fullscreen: 'true' })
    expect(label()).toBe('Fullscreen')

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'SG_FULLSCREEN_STATE', fullscreen: true },
          origin: 'https://evil.example',
          source: window.parent,
        }),
      )
    })
    expect(label()).toBe('Fullscreen')
  })

  it('never reads window.frameElement', async () => {
    await click(fullscreenButton())
    await fromHost({ type: 'SG_FULLSCREEN_STATE', fullscreen: true })
    await click(fullscreenButton())
    await fromHost({ type: 'SG_FULLSCREEN_STATE', fullscreen: false })
    expect(frameElementGet).not.toHaveBeenCalled()
  })
})
