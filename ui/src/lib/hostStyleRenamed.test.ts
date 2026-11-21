/**
 * Host side of SG_STYLE_RENAMED: the guard in post-message.js and the
 * remap-before-refresh order in handlers/style-renamed.js. The iframe's editor
 * and Move dialog send it after a rename.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { applyStyleRenamed } from '../../../javascript/style_grid/handlers/style-renamed.js'
import { parseFrameMessage } from '../../../javascript/style_grid/post-message.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const IFRAME_MESSAGES_SRC = fs.readFileSync(
  path.resolve(HERE, '../../../javascript/style_grid/handlers/iframe-messages.js'),
  'utf8',
)

const VALID = {
  type: 'SG_STYLE_RENAMED',
  old_name: 'BODY_Tall',
  new_name: 'POSE_Tall',
  source_file: 'webui/styles_nsfw_core.csv',
}

describe('parseFrameMessage: SG_STYLE_RENAMED', () => {
  it('accepts the valid shape and drops extra fields', () => {
    expect(parseFrameMessage(VALID)).toEqual(VALID)
    expect(parseFrameMessage({ ...VALID, extra: 1, prompt: 'x' })).toEqual(VALID)
  })

  it('accepts an empty source_file string (legacy styles without a pack)', () => {
    expect(parseFrameMessage({ ...VALID, source_file: '' })).toEqual({ ...VALID, source_file: '' })
  })

  it.each([
    ['old_name missing', { type: VALID.type, new_name: VALID.new_name, source_file: VALID.source_file }],
    ['new_name missing', { type: VALID.type, old_name: VALID.old_name, source_file: VALID.source_file }],
    ['source_file missing', { type: VALID.type, old_name: VALID.old_name, new_name: VALID.new_name }],
    ['old_name empty', { ...VALID, old_name: '' }],
    ['new_name empty', { ...VALID, new_name: '' }],
    ['old_name not a string', { ...VALID, old_name: 1 }],
    ['new_name not a string', { ...VALID, new_name: null }],
    ['source_file not a string', { ...VALID, source_file: 7 }],
    ['source_file null', { ...VALID, source_file: null }],
  ])('rejects: %s', (_label, data) => {
    expect(parseFrameMessage(data)).toBeNull()
  })
})

describe('applyStyleRenamed', () => {
  it('remaps references before refreshing, with the message fields in order', () => {
    const calls: string[] = []
    const remap = vi.fn(() => {
      calls.push('remap')
    })
    const refresh = vi.fn(() => {
      calls.push('refresh')
    })

    // The handler receives the message exactly as the guard returns it.
    const parsed = parseFrameMessage(VALID) as typeof VALID
    applyStyleRenamed('txt2img', parsed, { remap, refresh })

    expect(calls).toEqual(['remap', 'refresh'])
    expect(remap).toHaveBeenCalledTimes(1)
    expect(remap).toHaveBeenCalledWith('txt2img', 'BODY_Tall', 'POSE_Tall', 'webui/styles_nsfw_core.csv')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith('txt2img')
    expect(remap.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0])
  })

  it('does not refresh when remapping throws', () => {
    const refresh = vi.fn()
    expect(() =>
      applyStyleRenamed('img2img', VALID, {
        remap: () => {
          throw new Error('boom')
        },
        refresh,
      }),
    ).toThrow('boom')
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('iframe-messages.js wiring', () => {
  it('routes SG_STYLE_RENAMED through applyStyleRenamed with the real remap and the SG_REFRESH path', () => {
    expect(IFRAME_MESSAGES_SRC).toMatch(
      /msg\.type === "SG_STYLE_RENAMED"\) \{\s*applyStyleRenamed\(tab, msg, \{\s*remap: remapStyleNameReferences,\s*refresh: refreshHostAndFrame,/,
    )
    // SG_REFRESH reaches the same refreshHostAndFrame through applyRefresh (hostRefresh.test.ts).
    expect(IFRAME_MESSAGES_SRC).toMatch(/msg\.type === "SG_REFRESH"\) \{\s*applyRefresh\(tab, msg, \{ refresh: refreshHostAndFrame \}\);/)
  })
})
