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
    has_thumbnail: extra.has_thumbnail ?? false,
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
    usageCounts: {},
    favorites: new Set(),
    recentNames: [],
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

      const { styles, search, activeCategory, activeSource, favorites, recentNames } =
        useStylesStore.getState()
      const filtered = selectFilteredStyles(
        styles,
        search,
        activeCategory,
        activeSource,
        favorites,
        recentNames,
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
        st.recentNames,
      )
      expect(filtered).toHaveLength(1)
      expect(styleRowKey(filtered[0])).toBe(styleRowKey(a))
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
    it('toggleFavorite persists identity keys to localStorage', () => {
      const a = row('BODY_Ears', FILE_A)
      useStylesStore.getState().setStyles([a], 'txt2img')
      useStylesStore.getState().toggleFavorite(a)

      const key = styleRowKey(a)
      expect(useStylesStore.getState().favorites.has(key)).toBe(true)
      expect(JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')).toEqual([
        key,
      ])

      useStylesStore.getState().toggleFavorite(a)
      expect(useStylesStore.getState().favorites.has(key)).toBe(false)
      expect(JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')).toEqual([])
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

  describe('import', () => {
    it('iframe requests host import/export UI via SG_IMPORT_EXPORT', () => {
      sendToHost({ type: 'SG_IMPORT_EXPORT' })
      expect(sendToHost).toHaveBeenCalledWith({ type: 'SG_IMPORT_EXPORT' })
    })
  })

  describe('thumbnails', () => {
    it('load preserves has_thumbnail flags on styles', () => {
      const withThumb = row('BODY_Ears', FILE_A, { has_thumbnail: true })
      const without = row('HAIR_Long', FILE_A, {
        category: 'HAIR',
        has_thumbnail: false,
      })
      useStylesStore.getState().setStyles([withThumb, without], 'txt2img')
      const styles = useStylesStore.getState().styles
      expect(styles.find((s) => s.name === 'BODY_Ears')?.has_thumbnail).toBe(true)
      expect(styles.find((s) => s.name === 'HAIR_Long')?.has_thumbnail).toBe(false)
    })

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
