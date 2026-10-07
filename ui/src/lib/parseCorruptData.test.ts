import { describe, expect, it } from 'vitest'
import { parseCorruptData } from './parseCorruptData'

function fakeRes(status: number): Response {
  return { status, ok: status >= 200 && status < 300 } as Response
}

describe('parseCorruptData', () => {
  it('parses Comfy-style 409 body', () => {
    const info = parseCorruptData(fakeRes(409), {
      error: 'corrupt_data',
      path: '/data/presets.json',
      bak_path: '/data/presets.json.bak',
      message: 'unreadable',
    })
    expect(info).toEqual({
      path: '/data/presets.json',
      bakPath: '/data/presets.json.bak',
      message: 'unreadable',
    })
  })

  it('parses FastAPI detail wrapper', () => {
    const info = parseCorruptData(fakeRes(409), {
      detail: {
        error: 'corrupt_data',
        path: 'X:/presets.json',
        bak_path: 'X:/presets.json.bak',
        message: 'bad',
      },
    })
    expect(info?.path).toBe('X:/presets.json')
    expect(info?.bakPath).toBe('X:/presets.json.bak')
  })

  it('parses HTTP 200 logical corrupt_data body', () => {
    const info = parseCorruptData(fakeRes(200), {
      error: 'corrupt_data',
      path: 'presets.json',
      bak_path: 'presets.json.bak',
      message: 'refuse',
    })
    expect(info?.path).toBe('presets.json')
  })

  it('returns null for normal preset payloads', () => {
    expect(parseCorruptData(fakeRes(200), { ok: true, presets: {} })).toBeNull()
    expect(parseCorruptData(fakeRes(200), { MyPreset: { styles: [] } })).toBeNull()
  })
})
