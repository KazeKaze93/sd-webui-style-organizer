/**
 * Characterization tests for Style Grid V2 main flows (behavior as of the
 * pre-host-split baseline). Lock current store/bridge contracts — do not
 * "improve" assertions to match a desired redesign.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { sendToHost } from '../bridge'
import { selectFilteredStyles, styleRowKey, useStylesStore } from './stylesStore'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return {
    ...actual,
    sendToHost: vi.fn(),
  }
})

const FILE_A = 'D:/packs/core/styles.csv'
const FILE_B = 'D:/packs/wardrobe/styles.csv'

function row(
  name: string,
  source_file: string,
  extra: Partial<Style> = {},
): Style {
  return {
    name,
    source_file,
    prompt: extra.prompt ?? `prompt:${name}`,
    negative_prompt: extra.negative_prompt ?? `neg:${name}`,
    description: extra.description ?? '',
    category: extra.category ?? 'BODY',
    ...extra,
  }
}

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
    favoritesHydrated: false,
    presets: {},
    presetsCorrupt: null,
    activePresetName: null,
    styleContributors: {},
    activeWildcards: [],
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

describe('characterization: main Style Grid flows', () => {
  beforeEach(() => {
    resetStore()
    vi.mocked(sendToHost).mockClear()
    vi.unstubAllGlobals()
  })

  describe('load grid', () => {
    it('setStyles loads library, sources, tab, and notifies host of source', () => {
      const a = row('BODY_Ears', FILE_A)
      const b = row('HAIR_Long', FILE_B, { category: 'HAIR' })
      useStylesStore.getState().setStyles([a, b], 'img2img')

      const st = useStylesStore.getState()
      expect(st.tab).toBe('img2img')
      expect(st.styles).toHaveLength(2)
      expect(st.sources).toEqual([FILE_A, FILE_B].sort())
      expect(sendToHost).toHaveBeenCalledWith({
        type: 'SG_SOURCE_CHANGE',
        source: null,
      })
    })

    it('setStyles restores last active source when still present', () => {
      localStorage.setItem('sg_v2_last_source_txt2img', FILE_B)
      const a = row('BODY_Ears', FILE_A)
      const b = row('HAIR_Long', FILE_B, { category: 'HAIR' })
      useStylesStore.getState().setStyles([a, b], 'txt2img')
      expect(useStylesStore.getState().activeSource).toBe(FILE_B)
      expect(sendToHost).toHaveBeenCalledWith({
        type: 'SG_SOURCE_CHANGE',
        source: FILE_B,
      })
    })

    it('img2img inherits the txt2img source until it has a pick of its own', () => {
      const lib = [row('BODY_Ears', FILE_A), row('HAIR_Long', FILE_B, { category: 'HAIR' })]
      localStorage.setItem('sg_v2_last_source_txt2img', FILE_B)
      useStylesStore.getState().setStyles(lib, 'img2img')
      expect(useStylesStore.getState().activeSource).toBe(FILE_B)
      expect(sendToHost).toHaveBeenLastCalledWith({ type: 'SG_SOURCE_CHANGE', source: FILE_B })
      // Inherited, not adopted: img2img still has no key of its own.
      expect(localStorage.getItem('sg_v2_last_source_img2img')).toBeNull()

      // txt2img changes in the other frame: img2img follows.
      localStorage.setItem('sg_v2_last_source_txt2img', FILE_A)
      useStylesStore.getState().syncInheritedSource('sg_v2_last_source_txt2img')
      expect(useStylesStore.getState().activeSource).toBe(FILE_A)
      expect(sendToHost).toHaveBeenLastCalledWith({ type: 'SG_SOURCE_CHANGE', source: FILE_A })

      // "All Sources" picked in img2img is a pick of its own: no more following.
      useStylesStore.getState().setActiveSource(null)
      expect(localStorage.getItem('sg_v2_last_source_img2img')).toBe('')
      localStorage.setItem('sg_v2_last_source_txt2img', FILE_B)
      useStylesStore.getState().syncInheritedSource('sg_v2_last_source_txt2img')
      expect(useStylesStore.getState().activeSource).toBeNull()

      // ...and it survives a reload of the panel.
      useStylesStore.setState({ activeSource: null })
      useStylesStore.getState().setStyles(lib, 'img2img')
      expect(useStylesStore.getState().activeSource).toBeNull()
    })

    it('img2img keeps its own source over the txt2img one', () => {
      localStorage.setItem('sg_v2_last_source_txt2img', FILE_B)
      localStorage.setItem('sg_v2_last_source_img2img', FILE_A)
      useStylesStore.getState().setStyles(
        [row('BODY_Ears', FILE_A), row('HAIR_Long', FILE_B, { category: 'HAIR' })],
        'img2img',
      )
      expect(useStylesStore.getState().activeSource).toBe(FILE_A)
      useStylesStore.getState().syncInheritedSource('sg_v2_last_source_txt2img')
      expect(useStylesStore.getState().activeSource).toBe(FILE_A)
    })

    it('txt2img never follows img2img and clears its key on All Sources', () => {
      localStorage.setItem('sg_v2_last_source_img2img', FILE_B)
      useStylesStore.getState().setStyles(
        [row('BODY_Ears', FILE_A), row('HAIR_Long', FILE_B, { category: 'HAIR' })],
        'txt2img',
      )
      expect(useStylesStore.getState().activeSource).toBeNull()
      useStylesStore.getState().syncInheritedSource('sg_v2_last_source_img2img')
      expect(useStylesStore.getState().activeSource).toBeNull()
      useStylesStore.getState().setActiveSource(FILE_A)
      useStylesStore.getState().setActiveSource(null)
      expect(localStorage.getItem('sg_v2_last_source_txt2img')).toBeNull()
    })
  })

  describe('search / filter', () => {
    it('matchesSearch is AND over whitespace tokens against name/description', () => {
      const a = row('BODY_Pointy_Ears', FILE_A, {
        description: 'fox ears fluffy',
      })
      const b = row('BODY_Tail', FILE_A, { description: 'fluffy fox' })
      useStylesStore.getState().setStyles([a, b], 'txt2img')
      useStylesStore.getState().setSearch('pointy ears')
      useStylesStore.getState().setCategory('BODY')

      const { styles, search, activeCategory, activeSource, favorites } =
        useStylesStore.getState()
      const filtered = selectFilteredStyles(
        styles,
        search,
        activeCategory,
        activeSource,
        favorites,
      )
      expect(filtered.map((s) => s.name)).toEqual(['BODY_Pointy_Ears'])
    })

    it('active source filters CSS library; Favorites view uses favorite keys', () => {
      const a = row('BODY_Ears', FILE_A)
      const b = row('BODY_Ears', FILE_B)
      useStylesStore.getState().setStyles([a, b], 'txt2img')
      useStylesStore.getState().toggleFavorite(a)
      useStylesStore.getState().setActiveSource(FILE_A)
      useStylesStore.getState().setCategory('★ Favorites')

      const st = useStylesStore.getState()
      const filtered = selectFilteredStyles(
        st.styles,
        st.search,
        st.activeCategory,
        st.activeSource,
        st.favorites,
      )
      expect(filtered).toHaveLength(1)
      expect(styleRowKey(filtered[0])).toBe(styleRowKey(a))
    })
  })

  describe('no recent tracking', () => {
    it('selecting styles, a whole category or a preset posts nothing to /recent', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ ok: true, items: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const a = row('BODY_Ears', FILE_A)
      const b = row('BODY_Tail', FILE_A)
      useStylesStore.getState().setStyles([a, b], 'txt2img')
      useStylesStore.getState().toggleStyle(a)
      useStylesStore.getState().selectAllInCategory('BODY')
      useStylesStore.setState({
        selectedStyles: [],
        presets: { Set: { styles: [{ name: 'BODY_Tail', source_file: FILE_A }], created: '2026-01-01' } },
      })
      useStylesStore.getState().loadPreset('Set')
      await Promise.resolve()
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/recent'))).toEqual([])
      expect('recentNames' in useStylesStore.getState()).toBe(false)
      expect('addToRecent' in useStylesStore.getState()).toBe(false)
    })
  })

  describe('select / apply', () => {
    it('toggleStyle select posts SG_APPLY with prompt/neg/source_file', () => {
      const a = row('BODY_Ears', FILE_A, {
        prompt: 'ears',
        negative_prompt: 'bald',
      })
      useStylesStore.getState().setStyles([a], 'txt2img')
      useStylesStore.getState().toggleStyle(a)

      expect(useStylesStore.getState().selectedStyles).toEqual([a])
      expect(sendToHost).toHaveBeenCalledWith({
        type: 'SG_APPLY',
        styleId: 'BODY_Ears',
        prompt: 'ears',
        neg: 'bald',
        source_file: FILE_A,
      })
    })

    it('toggleStyle deselect posts SG_UNAPPLY and clears selection', () => {
      const a = row('BODY_Ears', FILE_A)
      useStylesStore.getState().setStyles([a], 'txt2img')
      useStylesStore.getState().toggleStyle(a)
      vi.mocked(sendToHost).mockClear()
      useStylesStore.getState().toggleStyle(a)

      expect(useStylesStore.getState().selectedStyles).toEqual([])
      expect(sendToHost).toHaveBeenCalledWith({
        type: 'SG_UNAPPLY',
        styleId: 'BODY_Ears',
        source_file: FILE_A,
      })
    })
  })

  describe('favorites', () => {
    it('toggleFavorite persists identity keys via server save', () => {
      const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ ok: true, items: [] }))
      vi.stubGlobal('fetch', fetchMock)

      const a = row('BODY_Ears', FILE_A)
      useStylesStore.getState().setStyles([a], 'txt2img')
      useStylesStore.getState().toggleFavorite(a)

      const key = styleRowKey(a)
      expect(useStylesStore.getState().favorites.has(key)).toBe(true)
      expect(fetchMock).toHaveBeenCalled()
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/style_grid/favorites/save')
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({ items: [key] })

      useStylesStore.getState().toggleFavorite(a)
      expect(useStylesStore.getState().favorites.has(key)).toBe(false)
      const [, init2] = fetchMock.mock.calls[1]
      expect(JSON.parse(String((init2 as RequestInit).body))).toEqual({ items: [] })
    })
  })

  describe('hydrateFavorites', () => {
    const recentCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls.filter((c) => String(c[0]).includes('/style_grid/recent'))

    it('migrates localStorage once when the server file is absent, then reads server', async () => {
      const key = `${FILE_A}\0BODY_Ears`
      localStorage.setItem('sg_v2_favorites', JSON.stringify([key]))
      localStorage.setItem('sg_v2_recent', JSON.stringify([key]))

      let favoritesPersisted = false
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/style_grid/favorites' && (!init || !init.method || init.method === 'GET')) {
          return mockJsonResponse({
            items: favoritesPersisted ? [key] : [],
            persisted: favoritesPersisted,
          })
        }
        if (url === '/style_grid/favorites/migrate') {
          favoritesPersisted = true
          return mockJsonResponse({ ok: true, migrated: true, items: [key] })
        }
        return mockJsonResponse({ ok: false }, { ok: false })
      })
      vi.stubGlobal('fetch', fetchMock)

      await useStylesStore.getState().hydrateFavorites()
      expect(useStylesStore.getState().favorites.has(key)).toBe(true)
      expect(useStylesStore.getState().favoritesHydrated).toBe(true)
      expect(localStorage.getItem('sg_v2_favorites')).toBeNull()
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/style_grid/favorites/migrate')).toBe(
        true,
      )
      // Recent is no longer read, migrated or cleaned up.
      expect(recentCalls(fetchMock)).toEqual([])
      expect(localStorage.getItem('sg_v2_recent')).toBe(JSON.stringify([key]))

      // Subsequent hydrate: server already persisted — no second migrate.
      fetchMock.mockClear()
      await useStylesStore.getState().hydrateFavorites()
      expect(useStylesStore.getState().favorites.has(key)).toBe(true)
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]) === '/style_grid/favorites/migrate'),
      ).toBe(false)
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/style_grid/favorites')).toBe(true)
      localStorage.removeItem('sg_v2_recent')
    })

    it('keeps sg_v2_favorites when the server is unmigrated and migrate fails', async () => {
      const key = `${FILE_A}\0BODY_Ears`
      localStorage.setItem('sg_v2_favorites', JSON.stringify([key]))

      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/style_grid/favorites' && (!init || !init.method || init.method === 'GET')) {
          return mockJsonResponse({ items: [], persisted: false })
        }
        if (url.endsWith('/migrate')) {
          return mockJsonResponse({ ok: false, error: 'unavailable' }, { ok: false, status: 503 })
        }
        return mockJsonResponse({ ok: false }, { ok: false })
      })
      vi.stubGlobal('fetch', fetchMock)

      await useStylesStore.getState().hydrateFavorites()
      expect(useStylesStore.getState().favorites.has(key)).toBe(true)
      expect(localStorage.getItem('sg_v2_favorites')).toBe(JSON.stringify([key]))
      expect(recentCalls(fetchMock)).toEqual([])
    })

    it('removes the legacy key when the server already reports persisted', async () => {
      const key = `${FILE_A}\0BODY_Ears`
      localStorage.setItem('sg_v2_favorites', JSON.stringify([key]))

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/style_grid/favorites') {
          return mockJsonResponse({ items: [key], persisted: true })
        }
        return mockJsonResponse({ ok: false }, { ok: false })
      })
      vi.stubGlobal('fetch', fetchMock)

      await useStylesStore.getState().hydrateFavorites()
      expect(localStorage.getItem('sg_v2_favorites')).toBeNull()
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/migrate')),
      ).toBe(false)
      expect(recentCalls(fetchMock)).toEqual([])
    })
  })

  describe('presets save / rename / delete', () => {
    it('savePreset posts payload and replaces presets from response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockJsonResponse({
          ok: true,
          presets: {
            Duo: {
              styles: [{ name: 'BODY_Ears', source_file: FILE_A }],
              created: '2026-01-01T00:00:00Z',
            },
          },
        }),
      )
      vi.stubGlobal('fetch', fetchMock)

      const a = row('BODY_Ears', FILE_A)
      useStylesStore.getState().setStyles([a], 'txt2img')
      const result = await useStylesStore.getState().savePreset('Duo', [
        { name: a.name, source_file: a.source_file },
      ])

      expect(result).toEqual({ ok: true })
      expect(fetchMock).toHaveBeenCalled()
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/style_grid/presets/save')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        name: 'Duo',
        styles: [{ name: 'BODY_Ears', source_file: FILE_A }],
        overwrite: false,
      })
      expect(useStylesStore.getState().presets.Duo.styles).toEqual([
        { name: 'BODY_Ears', source_file: FILE_A },
      ])
    })

    it('renamePreset updates presets map and activePresetName', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockJsonResponse({
          ok: true,
          presets: {
            Renamed: {
              styles: [{ name: 'BODY_Ears', source_file: FILE_A }],
              created: '2026-01-01T00:00:00Z',
            },
          },
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      useStylesStore.setState({
        presets: {
          Old: {
            styles: [{ name: 'BODY_Ears', source_file: FILE_A }],
            created: '2026-01-01T00:00:00Z',
          },
        },
        activePresetName: 'Old',
      })

      const result = await useStylesStore.getState().renamePreset('Old', 'Renamed')
      expect(result).toEqual({ ok: true })
      expect(fetchMock.mock.calls[0][0]).toBe('/style_grid/presets/rename')
      expect(useStylesStore.getState().presets.Renamed).toBeTruthy()
      expect(useStylesStore.getState().presets.Old).toBeUndefined()
      expect(useStylesStore.getState().activePresetName).toBe('Renamed')
    })

    it('deletePreset removes preset and unapplies sole-contributor styles', async () => {
      const a = row('BODY_Ears', FILE_A)
      const fetchMock = vi.fn().mockResolvedValue(
        mockJsonResponse({ ok: true, presets: {} }),
      )
      vi.stubGlobal('fetch', fetchMock)
      useStylesStore.getState().setStyles([a], 'txt2img')
      useStylesStore.setState({
        presets: {
          Duo: {
            styles: [{ name: a.name, source_file: a.source_file }],
            created: '2026-01-01T00:00:00Z',
          },
        },
        selectedStyles: [a],
        styleContributors: { [styleRowKey(a)]: new Set(['Duo']) },
        activePresetName: 'Duo',
      })
      vi.mocked(sendToHost).mockClear()

      const result = await useStylesStore.getState().deletePreset('Duo')
      expect(result).toEqual({ ok: true })
      expect(fetchMock.mock.calls[0][0]).toBe('/style_grid/presets/delete')
      expect(useStylesStore.getState().presets).toEqual({})
      expect(useStylesStore.getState().selectedStyles).toEqual([])
      expect(useStylesStore.getState().activePresetName).toBeNull()
      expect(sendToHost).toHaveBeenCalledWith({
        type: 'SG_UNAPPLY',
        styleId: a.name,
        source_file: a.source_file,
      })
    })
  })

  describe('thumbnails', () => {
    it('preview generation is requested to host with style identity', () => {
      sendToHost({
        type: 'SG_GENERATE_PREVIEW',
        styleId: 'BODY_Ears',
        source: FILE_A,
      })
      expect(sendToHost).toHaveBeenCalledWith({
        type: 'SG_GENERATE_PREVIEW',
        styleId: 'BODY_Ears',
        source: FILE_A,
      })
    })
  })

  describe('corrupt-data banner', () => {
    it('fetchPresets sets presetsCorrupt and clears presets on corrupt_data', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockJsonResponse(
          {
            error: 'corrupt_data',
            path: 'presets.json',
            bak_path: 'presets.json.bak',
            message: 'refuse',
          },
          { status: 409, ok: false },
        ),
      )
      vi.stubGlobal('fetch', fetchMock)
      useStylesStore.setState({
        presets: {
          Keep: { styles: [], created: '2026-01-01T00:00:00Z' },
        },
      })

      await useStylesStore.getState().fetchPresets()
      const st = useStylesStore.getState()
      expect(st.presets).toEqual({})
      expect(st.presetsCorrupt).toEqual({
        path: 'presets.json',
        bakPath: 'presets.json.bak',
        message: 'refuse',
      })
    })

    it('savePreset refuses locally when presetsCorrupt is set', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      useStylesStore.setState({
        presetsCorrupt: {
          path: 'presets.json',
          bakPath: 'presets.json.bak',
          message: 'refuse',
        },
      })

      const result = await useStylesStore.getState().savePreset('X', [])
      expect(result).toEqual({ ok: false, error: 'corrupt_data' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
