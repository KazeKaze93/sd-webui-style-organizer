import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { conflictPairKey, groupConflictPairs } from '../lib/conflictPairs'
import { styleRowKey, useStylesStore } from './stylesStore'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const style = (name: string, prompt: string, negative_prompt = ''): Style => ({
  name,
  source_file: 'webui/a.csv',
  prompt,
  negative_prompt,
  description: '',
  category: 'BODY',
})

// A's negative prompt removes B's tag; C and D remove each other's.
const A = style('BODY_Alpha', 'alpha', 'beta tag')
const B = style('BODY_Beta', 'beta tag')
const C = style('BODY_Gamma', 'gamma', 'delta')
const D = style('BODY_Delta', 'delta', 'gamma')
const ALL = [A, B, C, D]

const visiblePairs = () => {
  const s = useStylesStore.getState()
  return groupConflictPairs(s.conflicts, s.dismissedConflictPairs)
}
const select = (...styles: Style[]) => {
  for (const s of styles) useStylesStore.getState().toggleStyle(s)
}

describe('Keep both (dismissed conflict pairs)', () => {
  beforeEach(() => {
    localStorage.clear()
    useStylesStore.setState({
      styles: ALL,
      duplicatesByName: new Map(ALL.map((s) => [s.name, [s]])),
      selectedStyles: [],
      selectedKeySet: new Set(),
      selectedCountByCategory: new Map(),
      conflicts: [],
      dismissedConflictPairs: new Set(),
      activeWildcards: [],
      activeSource: null,
      styleContributors: {},
    })
  })

  it('detection is unchanged: one-way and two-way conflicts as directed entries', () => {
    select(A, B, C, D)
    expect(useStylesStore.getState().conflicts.map((c) => `${c.styleA}>${c.styleB}`)).toEqual([
      'BODY_Alpha>BODY_Beta',
      'BODY_Gamma>BODY_Delta',
      'BODY_Delta>BODY_Gamma',
    ])
    expect(visiblePairs().map((p) => p.both)).toEqual([false, true])
  })

  it('dismissing hides the pair; the conflicts themselves stay detected', () => {
    select(A, B, C, D)
    useStylesStore.getState().dismissConflictPair(styleRowKey(B), styleRowKey(A))
    expect(useStylesStore.getState().dismissedConflictPairs).toEqual(
      new Set([conflictPairKey(styleRowKey(A), styleRowKey(B))]),
    )
    expect(visiblePairs().map((p) => p.aName)).toEqual(['BODY_Gamma'])
    expect(useStylesStore.getState().conflicts).toHaveLength(3)
  })

  it('removing one of its styles and re-adding it shows the pair again', () => {
    select(A, B)
    useStylesStore.getState().dismissConflictPair(styleRowKey(A), styleRowKey(B))
    expect(visiblePairs()).toHaveLength(0)
    select(B) // deselect
    expect(useStylesStore.getState().dismissedConflictPairs.size).toBe(0)
    select(B) // select again
    expect(visiblePairs().map((p) => [p.aName, p.bName])).toEqual([['BODY_Alpha', 'BODY_Beta']])
  })

  it('a dismissed pair survives unrelated selection changes and chip reordering', () => {
    select(A, B)
    useStylesStore.getState().dismissConflictPair(styleRowKey(A), styleRowKey(B))
    select(C)
    useStylesStore.getState().setSelectedStyles([C, B, A])
    expect(useStylesStore.getState().dismissedConflictPairs.size).toBe(1)
    expect(visiblePairs()).toHaveLength(0)
  })

  it.each(['clearAll', 'clearSelectionChrome'] as const)('%s empties the dismissed pairs', (action) => {
    select(A, B)
    useStylesStore.getState().dismissConflictPair(styleRowKey(A), styleRowKey(B))
    ;(useStylesStore.getState()[action] as () => void)()
    expect(useStylesStore.getState().dismissedConflictPairs.size).toBe(0)
  })
})
