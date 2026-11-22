/**
 * Host styles-init gate (javascript/style_grid/handlers/styles-init.js):
 * one SG_INIT (one /style_grid/styles fetch) per iframe document load.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createStylesInitGate,
  FALLBACK_DELAY_MS,
} from '../../../javascript/style_grid/handlers/styles-init.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const readHost = (rel: string) =>
  fs.readFileSync(path.resolve(HERE, '../../../javascript/style_grid', rel), 'utf8')

describe('styles-init gate', () => {
  let release: Array<() => void>
  let send: ReturnType<typeof vi.fn<() => Promise<void>>>
  let gate: ReturnType<typeof createStylesInitGate>

  /** Let the resolved send() promise run its then-callbacks. */
  const flush = () => Promise.resolve().then(() => undefined)

  beforeEach(() => {
    vi.useFakeTimers()
    release = []
    send = vi.fn<() => Promise<void>>(() => new Promise<void>((resolve) => release.push(resolve)))
    gate = createStylesInitGate({ send })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('SG_READY then load: one fetch, the fallback never fires', async () => {
    gate.onReady()
    expect(send).toHaveBeenCalledTimes(1)
    gate.onLoad()
    vi.advanceTimersByTime(FALLBACK_DELAY_MS * 4)
    release[0]()
    await flush()
    vi.advanceTimersByTime(FALLBACK_DELAY_MS * 4)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('load then SG_READY inside the timeout: one fetch, the fallback is cancelled', () => {
    gate.onLoad()
    vi.advanceTimersByTime(FALLBACK_DELAY_MS - 100)
    expect(send).not.toHaveBeenCalled()
    gate.onReady()
    expect(send).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(FALLBACK_DELAY_MS * 4)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('load without SG_READY: one fallback fetch after the timeout', () => {
    gate.onLoad()
    vi.advanceTimersByTime(FALLBACK_DELAY_MS - 1)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(send).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(FALLBACK_DELAY_MS * 4)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a late SG_READY after the fallback started does not fetch again', async () => {
    gate.onLoad()
    vi.advanceTimersByTime(FALLBACK_DELAY_MS)
    gate.onReady()
    expect(send).toHaveBeenCalledTimes(1)
    release[0]()
    await flush()
    vi.advanceTimersByTime(FALLBACK_DELAY_MS * 4)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('no second fetch while one is in flight', () => {
    gate.onReady()
    expect(gate.isInFlight()).toBe(true)
    gate.onReady()
    gate.onLoad()
    vi.advanceTimersByTime(FALLBACK_DELAY_MS * 4)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('isInFlight clears when the fetch settles, also on failure', async () => {
    send.mockImplementationOnce(() => Promise.reject(new Error('net')))
    gate.onReady()
    await flush()
    await flush()
    expect(gate.isInFlight()).toBe(false)
  })

  it('a reloaded iframe (second load + SG_READY) gets exactly one more fetch', async () => {
    gate.onReady()
    gate.onLoad()
    release[0]()
    await flush()
    expect(send).toHaveBeenCalledTimes(1)

    gate.onLoad()
    gate.onReady()
    vi.advanceTimersByTime(FALLBACK_DELAY_MS * 4)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('two frames keep separate gates', () => {
    const sendB = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const gateB = createStylesInitGate({ send: sendB })
    gate.onReady()
    gateB.onLoad()
    vi.advanceTimersByTime(FALLBACK_DELAY_MS)
    expect(send).toHaveBeenCalledTimes(1)
    expect(sendB).toHaveBeenCalledTimes(1)
  })
})

describe('host wiring', () => {
  const iframeSrc = readHost('handlers/iframe.js')
  const messagesSrc = readHost('handlers/iframe-messages.js')

  it('sendStylesInit is the only SG_INIT sender in the iframe lifecycle files', () => {
    expect(iframeSrc).not.toContain('/style_grid/styles')
    expect(iframeSrc).not.toContain('"SG_INIT"')
    expect(messagesSrc.match(/type: "SG_INIT"/g)).toHaveLength(1)
    expect(messagesSrc).toMatch(/function sendStylesInit\(tab, frame\) \{\s*return fetch\("\/style_grid\/styles"\)/)
  })

  it('load and SG_READY both go through the per-tab gate', () => {
    expect(iframeSrc).toMatch(/state\[tab\]\.sgStylesInitGate = createStylesInitGate\(\{\s*send: function \(\) \{ return sendStylesInit\(tab, frame\); \},/)
    expect(iframeSrc).toMatch(/frame\.addEventListener\("load", function \(\) \{\s*state\[tab\]\.sgStylesInitGate\.onLoad\(\);/)
    expect(messagesSrc).toMatch(/if \(state\[tab\]\.sgStylesInitGate\) state\[tab\]\.sgStylesInitGate\.onReady\(\);/)
    expect(messagesSrc).not.toMatch(/if \(state\[tab\]\.sgV2HostInitSent\) return;/)
  })
})
