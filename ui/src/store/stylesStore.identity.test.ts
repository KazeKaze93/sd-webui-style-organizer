import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import {
  __resetAmbiguousToastForTests,
  resolveSourceInList,
  styleRowKey,
  useStylesStore,
} from './stylesStore'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return {
    ...actual,
    sendToHost: vi.fn(),
  }
})

function row(
  name: string,
  source_file: string,
  extra: Partial<Style> = {},
): Style {
  return {
    name,
    source_file,
    prompt: extra.prompt ?? `prompt:${source_file}:${name}`,
    negative_prompt: extra.negative_prompt ?? `neg:${source_file}:${name}`,
    description: extra.description ?? '',
    category: extra.category ?? 'BODY',
    has_thumbnail: false,
  }
}

/** Id-form source_file as emitted by the server since aea4bfd. */
const FILE_A = 'styles/a.csv'
const FILE_B = 'webui/b.csv'

function resetStore() {
  localStorage.clear()
  useStylesStore.setState({
    styles: [],
    tab: 'txt2img',
    search: '',
    activeCategory: null,
    activeSource: null,
    sources: [],
    selectedStyles: [],
    conflicts: [],
    favorites: new Set(),
    recentNames: [],
    favoritesRecentHydrated: true,
    presets: {},
    presetsCorrupt: null,
    activePresetName: null,
    styleContributors: {},
    activeWildcards: [],
    thumbVersions: {},
  })
}

function mockJsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const status = init.status ?? (init.ok === false ? 500 : 200)
  const ok = init.ok ?? (status >= 200 && status < 300)
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

describe('style identity (name, source_file)', () => {
  beforeEach(() => {
    __resetAmbiguousToastForTests()
    resetStore()
    vi.unstubAllGlobals()
  })

  it('favorites two same-named styles from different files independently', () => {
    const a = row('BODY_Ears', FILE_A)
    const b = row('BODY_Ears', FILE_B)
    useStylesStore.getState().setStyles([a, b], 'txt2img')
    useStylesStore.getState().toggleFavorite(a)
    useStylesStore.getState().toggleFavorite(b)

    const { favorites, isFavorite } = useStylesStore.getState()
    expect(favorites.size).toBe(2)
    expect(favorites.has(styleRowKey(a))).toBe(true)
    expect(favorites.has(styleRowKey(b))).toBe(true)
    expect(isFavorite(a)).toBe(true)
    expect(isFavorite(b)).toBe(true)
  })

  it('selects two same-named styles from different files independently', () => {
    const a = row('BODY_Ears', FILE_A, { prompt: 'core-only' })
    const b = row('BODY_Ears', FILE_B, { prompt: 'ward-only' })
    useStylesStore.getState().setStyles([a, b], 'txt2img')
    useStylesStore.getState().toggleStyle(a)
    useStylesStore.getState().toggleStyle(b)

    const selected = useStylesStore.getState().selectedStyles
    expect(selected).toHaveLength(2)
    expect(selected.map((s) => styleRowKey(s)).sort()).toEqual(
      [styleRowKey(a), styleRowKey(b)].sort(),
    )
  })

  it('loadPreset keeps both same-named members from different files', () => {
    const a = row('BODY_Ears', FILE_A, { prompt: 'core-only' })
    const b = row('BODY_Ears', FILE_B, { prompt: 'ward-only' })
    useStylesStore.getState().setStyles([a, b], 'txt2img')
    useStylesStore.setState({
      presets: {
        Duo: {
          styles: [
            { name: 'BODY_Ears', source_file: FILE_A },
            { name: 'BODY_Ears', source_file: FILE_B },
          ],
          wildcards: [],
          note: '',
          created: '2026-01-01T00:00:00',
        },
      },
    })

    useStylesStore.getState().loadPreset('Duo')

    const selected = useStylesStore.getState().selectedStyles
    expect(selected).toHaveLength(2)
    expect(selected.map((s) => s.prompt).sort()).toEqual(['core-only', 'ward-only'])
  })

  it('setStyles leaves favorites/recent untouched and posts nothing', () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ ok: true, items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const a = row('X', FILE_A)
    const b = row('X', FILE_B)
    const unlinked = 'BareLegacy'
    useStylesStore.setState({
      favorites: new Set([styleRowKey(a), unlinked]),
      recentNames: [unlinked, styleRowKey(b)],
      favoritesRecentHydrated: true,
    })

    useStylesStore.getState().setStyles([a, b], 'txt2img')

    expect([...useStylesStore.getState().favorites].sort()).toEqual(
      [styleRowKey(a), unlinked].sort(),
    )
    expect(useStylesStore.getState().recentNames).toEqual([unlinked, styleRowKey(b)])
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('/favorites/save')),
    ).toBe(false)
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('/recent/save')),
    ).toBe(false)
  })

  it('unlinked favorite entry survives a toggle of another style', () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ ok: true, items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const a = row('X', FILE_A)
    const unlinked = 'BareLegacy'
    useStylesStore.setState({
      favorites: new Set([unlinked]),
      favoritesRecentHydrated: true,
    })
    useStylesStore.getState().setStyles([a], 'txt2img')
    useStylesStore.getState().toggleFavorite(a)

    expect(useStylesStore.getState().favorites.has(unlinked)).toBe(true)
    expect(useStylesStore.getState().favorites.has(styleRowKey(a))).toBe(true)
    const [, init] = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/favorites/save'),
    )!
    const body = JSON.parse(String((init as RequestInit).body)) as { items: string[] }
    expect(body.items.sort()).toEqual([unlinked, styleRowKey(a)].sort())
  })

  it('toasts ambiguous favorites once per signature; max 5 names; empty skips', async () => {
    const toastSpy = vi.spyOn(useStylesStore.getState(), 'showToast')
    const names = Array.from({ length: 12 }, (_, i) => `N${String(i).padStart(2, '0')}`)

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/style_grid/favorites') {
        return mockJsonResponse({
          items: names,
          persisted: true,
          ambiguous: names,
        })
      }
      if (url === '/style_grid/recent') {
        return mockJsonResponse({ items: [], persisted: true, ambiguous: [] })
      }
      return mockJsonResponse({ ok: false }, { ok: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    await useStylesStore.getState().hydrateFavoritesRecent()
    await Promise.resolve()
    await Promise.resolve()

    const toasts = toastSpy.mock.calls.filter(([msg]) =>
      String(msg).includes('differ between packs'),
    )
    expect(toasts).toHaveLength(1)
    const msg = String(toasts[0][0])
    expect(msg).toContain('12 favorites match styles that differ between packs')
    expect(msg).toContain('(+7 more)')
    expect(names.filter((n) => msg.includes(n))).toHaveLength(5)

    await useStylesStore.getState().hydrateFavoritesRecent()
    await Promise.resolve()
    await Promise.resolve()
    expect(
      toastSpy.mock.calls.filter(([m]) => String(m).includes('differ between packs')),
    ).toHaveLength(1)

    toastSpy.mockClear()
    __resetAmbiguousToastForTests()
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/style_grid/favorites') {
        return mockJsonResponse({ items: ['X'], persisted: true, ambiguous: [] })
      }
      if (url === '/style_grid/recent') {
        return mockJsonResponse({ items: [], persisted: true, ambiguous: [] })
      }
      return mockJsonResponse({ ok: false }, { ok: false })
    })
    await useStylesStore.getState().hydrateFavoritesRecent()
    await Promise.resolve()
    expect(toastSpy).not.toHaveBeenCalled()
    toastSpy.mockRestore()
  })

  it('re-GETs favorites for ambiguous after a successful migrate', async () => {
    const toastSpy = vi.spyOn(useStylesStore.getState(), 'showToast')
    localStorage.setItem('sg_v2_favorites', JSON.stringify(['Dup']))
    let migrated = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/style_grid/favorites' && (!init || !init.method || init.method === 'GET')) {
        if (!migrated) {
          return mockJsonResponse({ items: [], persisted: false, ambiguous: [] })
        }
        return mockJsonResponse({
          items: ['Dup'],
          persisted: true,
          ambiguous: ['Dup'],
        })
      }
      if (url === '/style_grid/favorites/migrate') {
        migrated = true
        return mockJsonResponse({ ok: true, migrated: true, items: ['Dup'] })
      }
      if (url === '/style_grid/recent') {
        return mockJsonResponse({ items: [], persisted: true, ambiguous: [] })
      }
      return mockJsonResponse({ ok: false }, { ok: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    await useStylesStore.getState().hydrateFavoritesRecent()
    await Promise.resolve()
    await Promise.resolve()

    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]) === '/style_grid/favorites'),
    ).toHaveLength(2)
    const toasts = toastSpy.mock.calls.filter(([msg]) =>
      String(msg).includes('differ between packs'),
    )
    expect(toasts).toHaveLength(1)
    expect(String(toasts[0][0])).toContain('Dup')
    toastSpy.mockRestore()
  })

  it('resolveSourceInList: id exact, legacy unique leaf, ambiguous null, id miss stays null', () => {
    const sources = ['styles/pack.csv', 'webui/other.csv', 'samples/pack.csv']
    expect(resolveSourceInList(sources, 'styles/pack.csv')).toBe('styles/pack.csv')
    expect(resolveSourceInList(sources, 'C:\\old\\other.csv')).toBe('webui/other.csv')
    expect(resolveSourceInList(sources, 'D:/x/pack.csv')).toBeNull()
    expect(resolveSourceInList(sources, 'styles/missing.csv')).toBeNull()
  })

  it('restores sg_v2_last_source_tab by unique leaf and writes the id', () => {
    const pack = row('X', 'styles/pack.csv')
    const other = row('Y', 'webui/other.csv')
    localStorage.setItem('sg_v2_last_source_txt2img', 'C:\\x\\styles\\pack.csv')
    useStylesStore.getState().setStyles([other, pack], 'txt2img')
    expect(useStylesStore.getState().activeSource).toBe('styles/pack.csv')
    expect(localStorage.getItem('sg_v2_last_source_txt2img')).toBe('styles/pack.csv')
    expect(localStorage.getItem('sg_v2_last_source')).toBeNull()

    resetStore()
    localStorage.setItem('sg_v2_last_source_txt2img', 'C:\\x\\styles\\pack.csv')
    const stylesPack = row('X', 'styles/pack.csv')
    const samplesPack = row('X', 'samples/pack.csv')
    useStylesStore.getState().setStyles([stylesPack, samplesPack], 'txt2img')
    expect(useStylesStore.getState().activeSource).toBeNull()
    expect(localStorage.getItem('sg_v2_last_source_txt2img')).toBe('C:\\x\\styles\\pack.csv')
  })

  it('copies abs thumb version key to unique source-id key without deleting old', () => {
    const a = row('X', 'styles/a.csv')
    const b = row('X', 'webui/b.csv')
    const absKey = 'D:\\old\\style_grid\\a.csv\0X'
    const newKey = styleRowKey(a)
    localStorage.setItem(`sg_thumb_v_${absKey}`, 'v42')
    useStylesStore.setState({ thumbVersions: { [absKey]: 'v42' } })
    useStylesStore.getState().setStyles([a, b], 'txt2img')

    expect(localStorage.getItem(`sg_thumb_v_${absKey}`)).toBe('v42')
    expect(localStorage.getItem(`sg_thumb_v_${newKey}`)).toBe('v42')
    expect(useStylesStore.getState().thumbVersions[newKey]).toBe('v42')
    expect(useStylesStore.getState().thumbVersions[absKey]).toBe('v42')
  })

  it('does not overwrite an existing id thumb version on later setStyles', () => {
    const a = row('X', 'styles/a.csv')
    const b = row('X', 'webui/b.csv')
    const absKey = 'D:\\old\\style_grid\\a.csv\0X'
    const newKey = styleRowKey(a)
    localStorage.setItem(`sg_thumb_v_${absKey}`, 'v1')
    useStylesStore.setState({ thumbVersions: { [absKey]: 'v1' } })
    useStylesStore.getState().setStyles([a, b], 'txt2img')
    expect(localStorage.getItem(`sg_thumb_v_${newKey}`)).toBe('v1')

    useStylesStore.getState().bumpThumbVersion(newKey, 'v2')
    useStylesStore.getState().setStyles([a, b], 'txt2img')

    expect(localStorage.getItem(`sg_thumb_v_${newKey}`)).toBe('v2')
    expect(useStylesStore.getState().thumbVersions[newKey]).toBe('v2')
    expect(localStorage.getItem(`sg_thumb_v_${absKey}`)).toBe('v1')
    expect(useStylesStore.getState().thumbVersions[absKey]).toBe('v1')
  })
})
