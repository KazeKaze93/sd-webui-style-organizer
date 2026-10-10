import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import {
  matchesSearch,
  matchesSearchKey,
  styleRowKey,
  useCategorySelectedCount,
  useIsSelected,
  useStyleDuplicates,
  useStylesStore,
  useThumbVersion,
} from './stylesStore'

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

function resetDerivedStore() {
  localStorage.clear()
  useStylesStore.setState({
    styles: [],
    tab: 'txt2img',
    search: '',
    activeCategory: null,
    activeSource: null,
    sources: [],
    selectedStyles: [],
    selectedKeySet: new Set(),
    selectedCountByCategory: new Map(),
    searchTextByKey: new Map(),
    duplicatesByName: new Map(),
    thumbVersions: {},
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

describe('derived: selectedKeySet', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('tracks add, remove, and clearAll', () => {
    const a = row('BODY_Ears', FILE_A)
    const b = row('HAIR_Long', FILE_B, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, b], 'txt2img')

    useStylesStore.getState().toggleStyle(a)
    expect(useStylesStore.getState().selectedKeySet.has(styleRowKey(a))).toBe(true)
    expect(useStylesStore.getState().selectedKeySet.has(styleRowKey(b))).toBe(false)

    useStylesStore.getState().toggleStyle(b)
    expect(useStylesStore.getState().selectedKeySet.size).toBe(2)

    useStylesStore.getState().toggleStyle(a)
    expect(useStylesStore.getState().selectedKeySet.has(styleRowKey(a))).toBe(false)
    expect(useStylesStore.getState().selectedKeySet.has(styleRowKey(b))).toBe(true)

    useStylesStore.getState().clearAll()
    expect(useStylesStore.getState().selectedKeySet.size).toBe(0)
    expect(useStylesStore.getState().selectedStyles).toEqual([])
  })

  it('useIsSelected follows selectedKeySet', () => {
    const a = row('BODY_Ears', FILE_A)
    useStylesStore.getState().setStyles([a], 'txt2img')
    const key = styleRowKey(a)

    let latest = false
    const unsub = useStylesStore.subscribe((s) => {
      latest = s.selectedKeySet.has(key)
    })
    expect(typeof useIsSelected).toBe('function')

    useStylesStore.getState().toggleStyle(a)
    expect(latest).toBe(true)
    useStylesStore.getState().toggleStyle(a)
    expect(latest).toBe(false)
    unsub()
  })

  it('clearSelectionChrome clears selectedStyles and selectedKeySet', () => {
    const a = row('BODY_Ears', FILE_A)
    const b = row('HAIR_Long', FILE_B, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, b], 'txt2img')
    useStylesStore.getState().toggleStyle(a)
    useStylesStore.getState().toggleStyle(b)
    useStylesStore.setState({
      activeWildcards: [{ category: 'BODY', spec: '' }],
      activePresetName: 'Duo',
      styleContributors: { [styleRowKey(a)]: new Set(['Duo']) },
      conflicts: [{
        styleA: a.name,
        styleB: b.name,
        styleAKey: styleRowKey(a),
        styleBKey: styleRowKey(b),
        reason: 'test',
      }],
    })

    useStylesStore.getState().clearSelectionChrome()

    const st = useStylesStore.getState()
    expect(st.selectedStyles).toEqual([])
    expect(st.selectedKeySet.size).toBe(0)
    expect(st.conflicts).toEqual([])
    expect(st.activeWildcards).toEqual([])
    expect(st.activePresetName).toBeNull()
    expect(st.styleContributors).toEqual({})
  })

  it('setState({ selectedStyles: [] }) leaves selectedKeySet empty', () => {
    const a = row('BODY_Ears', FILE_A)
    useStylesStore.getState().setStyles([a], 'txt2img')
    useStylesStore.getState().toggleStyle(a)
    expect(useStylesStore.getState().selectedKeySet.has(styleRowKey(a))).toBe(true)

    // Mimic App SG_CLEAR_SELECTION raw bypass (pre-migration).
    useStylesStore.setState({
      selectedStyles: [],
      conflicts: [],
      activeWildcards: [],
      activePresetName: null,
      styleContributors: {},
    })

    expect(useStylesStore.getState().selectedStyles).toEqual([])
    expect(useStylesStore.getState().selectedKeySet.size).toBe(0)
  })
})

describe('derived: duplicatesByName', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('keeps the same array ref across unrelated updates', () => {
    const a = row('BODY_Ears', FILE_A)
    const b = row('BODY_Ears', FILE_B)
    const c = row('HAIR_Long', FILE_A, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, b, c], 'txt2img')

    const mapBefore = useStylesStore.getState().duplicatesByName
    const arrBefore = mapBefore.get('BODY_Ears')
    expect(arrBefore).toBeDefined()
    expect(arrBefore).toHaveLength(2)

    useStylesStore.getState().setSearch('ears')
    useStylesStore.getState().toggleStyle(c)
    useStylesStore.getState().setThemeMode('light')

    const mapAfter = useStylesStore.getState().duplicatesByName
    expect(mapAfter).toBe(mapBefore)
    expect(mapAfter.get('BODY_Ears')).toBe(arrBefore)
  })

  it('omits unique names so useStyleDuplicates falls back to EMPTY_STYLES', () => {
    const a = row('BODY_Ears', FILE_A)
    useStylesStore.getState().setStyles([a], 'txt2img')
    expect(typeof useStyleDuplicates).toBe('function')
    // Singles are not stored; the hook returns the module-level EMPTY_STYLES.
    expect(useStylesStore.getState().duplicatesByName.has('BODY_Ears')).toBe(false)
    expect(useStylesStore.getState().duplicatesByName.get('NO_SUCH')).toBeUndefined()
  })

  it('rebuilds when styles change and exposes duplicate groups', () => {
    const a = row('BODY_Ears', FILE_A)
    const b = row('BODY_Ears', FILE_B)
    useStylesStore.getState().setStyles([a], 'txt2img')
    expect(useStylesStore.getState().duplicatesByName.size).toBe(0)

    useStylesStore.getState().setStyles([a, b], 'txt2img')
    const dups = useStylesStore.getState().duplicatesByName.get('BODY_Ears')
    expect(dups).toHaveLength(2)
    expect(dups?.map((s) => s.source_file).sort()).toEqual([FILE_A, FILE_B].sort())
  })
})

describe('derived: thumbVersions', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('bumpThumbVersion writes localStorage and updates subscribers', () => {
    const key = `${FILE_A}\0BODY_Ears`
    let seen = useStylesStore.getState().thumbVersions[key] ?? '1'
    const unsub = useStylesStore.subscribe((s) => {
      seen = s.thumbVersions[key] ?? '1'
    })

    expect(typeof useThumbVersion).toBe('function')
    expect(seen).toBe('1')

    useStylesStore.getState().bumpThumbVersion(key, '7')
    expect(localStorage.getItem(`sg_thumb_v_${key}`)).toBe('7')
    expect(useStylesStore.getState().thumbVersions[key]).toBe('7')
    expect(seen).toBe('7')
    unsub()
  })
})

describe('derived: thumbVersions hydration', () => {
  it('reads sg_thumb_v_* once at store init', async () => {
    vi.resetModules()
    localStorage.clear()
    const rowKey = `${FILE_A}\0BODY_Ears`
    localStorage.setItem(`sg_thumb_v_${rowKey}`, '42')
    localStorage.setItem('sg_v2_favorites', '[]')

    const mod = await import('./stylesStore')
    expect(mod.useStylesStore.getState().thumbVersions[rowKey]).toBe('42')
    expect(mod.useStylesStore.getState().thumbVersions).toEqual({ [rowKey]: '42' })

    // Post-init LS writes must not re-hydrate into the store.
    localStorage.setItem(`sg_thumb_v_${rowKey}`, '100')
    localStorage.setItem(`sg_thumb_v_${FILE_B}\0Other`, '9')
    expect(mod.useStylesStore.getState().thumbVersions[rowKey]).toBe('42')
    expect(mod.useStylesStore.getState().thumbVersions[`${FILE_B}\0Other`]).toBeUndefined()
  })
})

describe('derived: searchTextByKey / matchesSearchKey', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('matchesSearchKey matches matchesSearch for AND tokens and description', () => {
    const fixtures: Style[] = [
      row('BODY_Pointy_Ears', FILE_A, { description: 'fox ears fluffy Combos: OTHER.' }),
      row('BODY_Tail', FILE_A, { description: 'fluffy fox' }),
      row('HAIR_Long', FILE_B, { category: 'HAIR', description: '' }),
      row('STYLE_Oil', FILE_A, { category: 'STYLE', description: 'painterly brush strokes' }),
    ]
    useStylesStore.getState().setStyles(fixtures, 'txt2img')

    const queries = [
      '',
      '   ',
      'pointy',
      'pointy ears',
      'fox fluffy',
      'ears fox',
      'painterly',
      'brush strokes',
      'nope',
      'pointy nope',
      'HAIR',
      'long',
    ]

    for (const style of fixtures) {
      const key = styleRowKey(style)
      expect(useStylesStore.getState().searchTextByKey.has(key)).toBe(true)
      for (const q of queries) {
        expect(matchesSearchKey(key, q)).toBe(matchesSearch(style, q))
      }
    }
  })

  it('rebuilds searchTextByKey only when styles change', () => {
    const a = row('BODY_Ears', FILE_A, { description: 'soft fur' })
    useStylesStore.getState().setStyles([a], 'txt2img')
    const mapBefore = useStylesStore.getState().searchTextByKey

    useStylesStore.getState().setSearch('ears')
    useStylesStore.getState().toggleStyle(a)
    expect(useStylesStore.getState().searchTextByKey).toBe(mapBefore)

    const b = row('HAIR_Long', FILE_B, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, b], 'txt2img')
    const mapAfter = useStylesStore.getState().searchTextByKey
    expect(mapAfter).not.toBe(mapBefore)
    expect(mapAfter.size).toBe(2)
  })
})

describe('derived: addToRecent coalesce', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('keeps recentNames ref when head key is already the style', () => {
    const a = row('BODY_Ears', FILE_A)
    const b = row('HAIR_Long', FILE_B, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, b], 'txt2img')

    useStylesStore.getState().toggleStyle(a)
    const afterFirst = useStylesStore.getState().recentNames
    expect(afterFirst[0]).toBe(styleRowKey(a))

    useStylesStore.getState().toggleStyle(a) // deselect — must not touch recent
    expect(useStylesStore.getState().recentNames).toBe(afterFirst)

    useStylesStore.getState().toggleStyle(a) // re-select — already head → no-op
    expect(useStylesStore.getState().recentNames).toBe(afterFirst)

    useStylesStore.getState().toggleStyle(b)
    const afterB = useStylesStore.getState().recentNames
    expect(afterB).not.toBe(afterFirst)
    expect(afterB[0]).toBe(styleRowKey(b))
    expect(afterB[1]).toBe(styleRowKey(a))
  })
})

describe('derived: selectedCountByCategory', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('tracks add, remove, clearAll, and selectAllInCategory', () => {
    const a = row('BODY_Ears', FILE_A)
    const b = row('BODY_Tail', FILE_A)
    const c = row('HAIR_Long', FILE_B, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, b, c], 'txt2img')
    expect(typeof useCategorySelectedCount).toBe('function')

    useStylesStore.getState().toggleStyle(a)
    expect(useStylesStore.getState().selectedCountByCategory.get('BODY')).toBe(1)
    expect(useStylesStore.getState().selectedCountByCategory.get('HAIR')).toBeUndefined()

    useStylesStore.getState().toggleStyle(c)
    expect(useStylesStore.getState().selectedCountByCategory.get('BODY')).toBe(1)
    expect(useStylesStore.getState().selectedCountByCategory.get('HAIR')).toBe(1)

    useStylesStore.getState().toggleStyle(a)
    expect(useStylesStore.getState().selectedCountByCategory.get('BODY')).toBeUndefined()
    expect(useStylesStore.getState().selectedCountByCategory.get('HAIR')).toBe(1)

    useStylesStore.getState().selectAllInCategory('BODY')
    expect(useStylesStore.getState().selectedCountByCategory.get('BODY')).toBe(2)
    expect(useStylesStore.getState().selectedCountByCategory.get('HAIR')).toBe(1)

    useStylesStore.getState().selectAllInCategory('BODY')
    expect(useStylesStore.getState().selectedCountByCategory.get('BODY')).toBeUndefined()
    expect(useStylesStore.getState().selectedCountByCategory.get('HAIR')).toBe(1)

    useStylesStore.getState().clearAll()
    expect(useStylesStore.getState().selectedCountByCategory.size).toBe(0)
  })

  it('setState({ selectedStyles }) rebuilds selectedCountByCategory', () => {
    const a = row('BODY_Ears', FILE_A)
    const c = row('HAIR_Long', FILE_B, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, c], 'txt2img')
    useStylesStore.getState().toggleStyle(a)
    expect(useStylesStore.getState().selectedCountByCategory.get('BODY')).toBe(1)

    useStylesStore.setState({ selectedStyles: [a, c] })
    expect(useStylesStore.getState().selectedCountByCategory.get('BODY')).toBe(1)
    expect(useStylesStore.getState().selectedCountByCategory.get('HAIR')).toBe(1)

    useStylesStore.setState({ selectedStyles: [] })
    expect(useStylesStore.getState().selectedCountByCategory.size).toBe(0)
  })
})
