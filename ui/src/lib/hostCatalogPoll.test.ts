/** @vitest-environment jsdom */
/**
 * Host CSV-change polling (javascript/style_grid/handlers/catalog-poll.js and
 * its use in handlers/panel.js startPolling): one GET /style_grid/styles per
 * detected change, shared by refreshPanel and the SG_STYLES_UPDATE of both tabs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSharedStylesFetch,
  onCatalogChanged,
} from '../../../javascript/style_grid/handlers/catalog-poll.js'

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const CATALOG = { categories: { LIGHTING: [{ name: 'LIGHTING_Soft', category: 'LIGHTING', source_file: 'webui/a.csv' }] } }
const TABS = ['txt2img', 'img2img']

describe('createSharedStylesFetch', () => {
  it('callers while a request runs share it; after it settles the next call requests again', async () => {
    const pending = [deferred<unknown>(), deferred<unknown>()]
    let n = 0
    const get = vi.fn(() => pending[n++].promise)
    const fetchStyles = createSharedStylesFetch(get)
    const a = fetchStyles()
    const b = fetchStyles()
    expect(a).toBe(b)
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/style_grid/styles')
    pending[0].resolve(CATALOG)
    await flush()
    fetchStyles()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('a failed request is not reused', async () => {
    const get = vi
      .fn<(url: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(CATALOG)
    const fetchStyles = createSharedStylesFetch(get)
    await expect(fetchStyles()).rejects.toThrow('offline')
    await expect(fetchStyles()).resolves.toBe(CATALOG)
    expect(get).toHaveBeenCalledTimes(2)
  })
})

describe('onCatalogChanged', () => {
  const setup = (initSent: Record<string, boolean>) => {
    const get = vi.fn<(url: string) => Promise<unknown>>().mockResolvedValue(CATALOG)
    const refresh = vi.fn()
    const update = vi.fn()
    const onUpdateError = vi.fn()
    const deps = {
      fetchStyles: createSharedStylesFetch(get),
      isInitSent: (t: string) => !!initSent[t],
      refresh,
      update,
      onUpdateError,
    }
    return { get, refresh, update, onUpdateError, deps }
  }

  it('one change with both tabs registered: one request, both refreshed and updated from it', async () => {
    const { get, refresh, update, deps } = setup({ txt2img: true, img2img: true })
    const request = onCatalogChanged(TABS, deps)
    await flush()
    expect(get).toHaveBeenCalledTimes(1)
    expect(refresh.mock.calls).toEqual([
      ['txt2img', { stylesRequest: request }],
      ['img2img', { stylesRequest: request }],
    ])
    expect(update.mock.calls).toEqual([
      ['txt2img', CATALOG],
      ['img2img', CATALOG],
    ])
  })

  it('a tab without the host handshake is only updated, still from the one request', async () => {
    const { get, refresh, update, deps } = setup({ txt2img: true, img2img: false })
    onCatalogChanged(TABS, deps)
    await flush()
    expect(get).toHaveBeenCalledTimes(1)
    expect(refresh.mock.calls.map(([t]) => t)).toEqual(['txt2img'])
    expect(update.mock.calls.map(([t]) => t)).toEqual(['txt2img', 'img2img'])
  })

  it('two overlapping changes: one request', async () => {
    const { get, update, deps } = setup({ txt2img: true, img2img: true })
    const first = onCatalogChanged(TABS, deps)
    const second = onCatalogChanged(TABS, deps)
    expect(second).toBe(first)
    await flush()
    expect(get).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(4)
  })

  it('a failed request: the error path runs once per tab, and the next change requests again', async () => {
    const { get, refresh, update, onUpdateError, deps } = setup({ txt2img: true, img2img: true })
    get.mockRejectedValueOnce(new Error('offline'))
    const failed = onCatalogChanged(TABS, deps)
    const refreshErrors = vi.fn()
    for (const [, opts] of refresh.mock.calls) (opts as { stylesRequest: Promise<unknown> }).stylesRequest.catch(refreshErrors)
    await failed.catch(() => undefined)
    await flush()
    expect(get).toHaveBeenCalledTimes(1)
    expect(refreshErrors).toHaveBeenCalledTimes(2)
    expect(onUpdateError).toHaveBeenCalledTimes(2)
    expect(update).not.toHaveBeenCalled()
    onCatalogChanged(TABS, deps)
    await flush()
    expect(get).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledTimes(2)
  })
})

describe('startPolling (handlers/panel.js)', () => {
  type Frame = { contentWindow: { postMessage: ReturnType<typeof vi.fn> } }
  let fetchMock: ReturnType<typeof vi.fn>
  let stylesOk = true

  const stylesRequests = () => fetchMock.mock.calls.filter(([url]) => url === '/style_grid/styles').length

  async function startWithTabs(initSent: boolean[]) {
    vi.resetModules()
    const { state } = await import('../../../javascript/style_grid/state.js')
    const { startPolling } = await import('../../../javascript/style_grid/handlers/panel.js')
    const frames: Frame[] = []
    TABS.forEach((t, i) => {
      const frame = { contentWindow: { postMessage: vi.fn() } }
      frames.push(frame)
      const tabState = (state as Record<string, Record<string, unknown>>)[t]
      tabState.sgFrame = frame
      tabState.sgV2HostInitSent = initSent[i]
    })
    startPolling()
    return frames
  }

  async function tick() {
    await vi.advanceTimersByTimeAsync(5000)
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    stylesOk = true
    vi.stubGlobal('gradioApp', () => document)
    fetchMock = vi.fn(async (url: string) => {
      if (url === '/style_grid/styles' && !stylesOk) throw new Error('offline')
      const body =
        url === '/style_grid/check_update'
          ? { changed: true }
          : url === '/style_grid/styles'
            ? CATALOG
            : { has_thumbnail: [] }
      return { ok: true, status: 200, json: async () => body } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('one detected change with both tabs registered: exactly one /style_grid/styles request', async () => {
    const frames = await startWithTabs([true, true])
    await tick()
    expect(fetchMock.mock.calls.filter(([url]) => url === '/style_grid/check_update')).toHaveLength(1)
    expect(stylesRequests()).toBe(1)
    for (const frame of frames) {
      const updates = frame.contentWindow.postMessage.mock.calls.filter(
        ([msg]) => (msg as { type: string }).type === 'SG_STYLES_UPDATE',
      )
      expect(updates).toHaveLength(1)
      expect((updates[0][0] as { styles: unknown[] }).styles).toHaveLength(1)
    }
  })

  it('tabs without the handshake: still one request per change', async () => {
    await startWithTabs([false, false])
    await tick()
    expect(stylesRequests()).toBe(1)
  })

  it('a failed request shows the existing "Refresh failed" toast once per tab; the next change fetches again', async () => {
    const frames = await startWithTabs([true, true])
    stylesOk = false
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      await tick()
      expect(stylesRequests()).toBe(1)
      for (const frame of frames) {
        const toasts = frame.contentWindow.postMessage.mock.calls.filter(
          ([msg]) => (msg as { type: string; message?: string }).message === 'Refresh failed',
        )
        expect(toasts).toHaveLength(1)
      }
      stylesOk = true
      await tick()
      expect(stylesRequests()).toBe(2)
    } finally {
      await Promise.resolve()
      process.off('unhandledRejection', unhandled)
    }
  })
})
