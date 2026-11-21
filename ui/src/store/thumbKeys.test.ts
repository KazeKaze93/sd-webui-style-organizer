/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { LORA_SOURCE, styleRowKey, useHasThumbnail, useStylesStore } from './stylesStore'

function respondWith(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

/** Render the hook once and return its value. */
function Probe({ style }: { style: Pick<Style, 'name' | 'source_file'> }) {
  return createElement('span', { 'data-value': String(useHasThumbnail(style)) })
}

function hasThumbnail(style: Pick<Style, 'name' | 'source_file'>): boolean | 'unknown' {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(createElement(Probe, { style })))
  const raw = host.querySelector('span')!.getAttribute('data-value')
  act(() => root.unmount())
  return raw === 'unknown' ? 'unknown' : raw === 'true'
}

describe('thumbnail presence', () => {
  beforeEach(() => {
    useStylesStore.setState({ thumbKeys: new Set(), thumbKeysLoaded: false })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchThumbKeys maps the server list to styleRowKey, source_file as the server returns it', async () => {
    respondWith({
      has_thumbnail: [
        { name: 'BODY_Tall', source_file: 'webui/styles_nsfw_core.csv' },
        { name: 'POSE Sit', source_file: 'shared/my dir/pack.csv' },
        { name: 'X', source_file: 'styles/x.csv' },
      ],
    })
    await useStylesStore.getState().fetchThumbKeys()
    const { thumbKeys, thumbKeysLoaded } = useStylesStore.getState()
    expect(thumbKeysLoaded).toBe(true)
    expect([...thumbKeys]).toEqual([
      'webui/styles_nsfw_core.csv\0BODY_Tall',
      'shared/my dir/pack.csv\0POSE Sit',
      'styles/x.csv\0X',
    ])
    expect(thumbKeys.has(styleRowKey({ name: 'BODY_Tall', source_file: 'webui/styles_nsfw_core.csv' }))).toBe(true)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/style_grid/thumbnails/list')
  })

  it('skips malformed entries', async () => {
    respondWith({ has_thumbnail: [null, 'BODY_Tall', { source_file: 'a.csv' }, { name: 'Ok', source_file: 'a.csv' }] })
    await useStylesStore.getState().fetchThumbKeys()
    expect([...useStylesStore.getState().thumbKeys]).toEqual(['a.csv\0Ok'])
  })

  it.each([
    ['HTTP 500', () => respondWith({ detail: 'boom' }, 500)],
    ['an error body', () => respondWith({ error: 'nope' })],
    ['no list in the body', () => respondWith({ ok: true })],
    ['a network failure', () => vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))],
  ])('failure (%s) keeps the previous set and the loaded flag, without throwing', async (_label, arrange) => {
    useStylesStore.setState({ thumbKeys: new Set(['a.csv\0Kept']), thumbKeysLoaded: false })
    arrange()
    await expect(useStylesStore.getState().fetchThumbKeys()).resolves.toBeUndefined()
    expect([...useStylesStore.getState().thumbKeys]).toEqual(['a.csv\0Kept'])
    expect(useStylesStore.getState().thumbKeysLoaded).toBe(false)
  })

  it('markThumb adds and removes a key', () => {
    const key = styleRowKey({ name: 'BODY_Tall', source_file: 'a.csv' })
    useStylesStore.getState().markThumb(key, true)
    expect(useStylesStore.getState().thumbKeys.has(key)).toBe(true)
    const same = useStylesStore.getState().thumbKeys
    useStylesStore.getState().markThumb(key, true) // no change, same set
    expect(useStylesStore.getState().thumbKeys).toBe(same)
    useStylesStore.getState().markThumb(key, false)
    expect(useStylesStore.getState().thumbKeys.has(key)).toBe(false)
  })

  it('a rename carries the thumbnail key to the new name', () => {
    const from: Style = { name: 'BODY_Tall', source_file: 'a.csv', prompt: '', negative_prompt: '', description: '', category: 'BODY' }
    useStylesStore.setState({ thumbKeys: new Set([styleRowKey(from)]), selectedStyles: [], favorites: new Set(), recentNames: [], styleContributors: {}, thumbVersions: {} })
    useStylesStore.getState().renameStyleIdentity(from, { name: 'POSE_Tall', category: 'POSE' })
    expect([...useStylesStore.getState().thumbKeys]).toEqual(['a.csv\0POSE_Tall'])
  })

  it('useHasThumbnail: true / false from thumbKeys; unknown for LoRA rows (source or LORA_ name)', () => {
    useStylesStore.setState({ thumbKeys: new Set(['a.csv\0BODY_Tall']) })
    expect(hasThumbnail({ name: 'BODY_Tall', source_file: 'a.csv' })).toBe(true)
    expect(hasThumbnail({ name: 'BODY_Tall', source_file: 'b.csv' })).toBe(false)
    expect(hasThumbnail({ name: 'detail', source_file: LORA_SOURCE })).toBe('unknown')
    expect(hasThumbnail({ name: 'LORA_detail', source_file: 'a.csv' })).toBe('unknown')
  })
})
