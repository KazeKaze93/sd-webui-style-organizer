/**
 * Host side of SG_REFRESH: the quiet_vanished guard in post-message.js and its
 * forwarding to refreshPanel's quietVanishedToast (handlers/refresh.js).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { applyRefresh } from '../../../javascript/style_grid/handlers/refresh.js'
import { parseFrameMessage } from '../../../javascript/style_grid/post-message.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const IFRAME_MESSAGES_SRC = fs.readFileSync(
  path.resolve(HERE, '../../../javascript/style_grid/handlers/iframe-messages.js'),
  'utf8',
)

describe('parseFrameMessage: SG_REFRESH', () => {
  it('quiet_vanished is false when absent', () => {
    expect(parseFrameMessage({ type: 'SG_REFRESH' })).toEqual({ type: 'SG_REFRESH', quiet_vanished: false })
  })

  it.each([true, false])('accepts quiet_vanished: %s and drops extra fields', (quiet) => {
    expect(parseFrameMessage({ type: 'SG_REFRESH', quiet_vanished: quiet, extra: 1 })).toEqual({
      type: 'SG_REFRESH',
      quiet_vanished: quiet,
    })
  })

  it.each([['true'], [1], [0], [null], [{}]])('rejects a non-boolean quiet_vanished: %j', (value) => {
    expect(parseFrameMessage({ type: 'SG_REFRESH', quiet_vanished: value })).toBeNull()
  })
})

describe('applyRefresh', () => {
  it.each([
    [{ type: 'SG_REFRESH' }, false],
    [{ type: 'SG_REFRESH', quiet_vanished: false }, false],
    [{ type: 'SG_REFRESH', quiet_vanished: true }, true],
  ])('%j -> refreshPanel quietVanishedToast %s', (data, quiet) => {
    const refresh = vi.fn()
    const msg = parseFrameMessage(data) as { quiet_vanished: boolean }
    applyRefresh('txt2img', msg, { refresh })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith('txt2img', { quietVanishedToast: quiet })
  })
})

describe('iframe-messages.js wiring', () => {
  it('SG_REFRESH goes through applyRefresh, and refreshHostAndFrame hands opts to refreshPanel', () => {
    expect(IFRAME_MESSAGES_SRC).toMatch(
      /msg\.type === "SG_REFRESH"\) \{\s*applyRefresh\(tab, msg, \{ refresh: refreshHostAndFrame \}\);/,
    )
    expect(IFRAME_MESSAGES_SRC).toMatch(
      /function refreshHostAndFrame\(refreshTab, opts\) \{\s*refreshPanel\(refreshTab, opts\);/,
    )
  })
})
