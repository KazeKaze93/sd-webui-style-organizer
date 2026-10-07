import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import {
  migrateLegacyNameKeys,
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

const FILE_A = 'D:/packs/core/styles.csv'
const FILE_B = 'D:/packs/wardrobe/styles.csv'

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

describe('style identity (name, source_file)', () => {
  beforeEach(() => {
    resetStore()
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

  it('migrates unique bare-name favorites in memory; drops ambiguous bare names', () => {
    const unique = row('CAMERA_Closeup', FILE_A)
    const a = row('BODY_Ears', FILE_A)
    const b = row('BODY_Ears', FILE_B)
    const migrated = migrateLegacyNameKeys(
      ['CAMERA_Closeup', 'BODY_Ears', styleRowKey(a)],
      [unique, a, b],
    )
    expect(migrated).toEqual([styleRowKey(unique), styleRowKey(a)])
    expect(migrated).not.toContain('BODY_Ears')
    expect(migrated).not.toContain(styleRowKey(b))
  })
})
