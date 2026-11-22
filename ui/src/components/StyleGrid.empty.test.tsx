/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { AppActionsContext, type AppActions } from '../lib/appActions'
import { __resetGridFocusForTests } from '../lib/gridFocus'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { LORA_SOURCE, LORA_VIEW, styleRowKey, useStylesStore } from '../store/stylesStore'
import { GridScroller } from './grid/GridScroller'
import { StyleGrid } from './StyleGrid'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const FAVORITES = '★ Favorites'
const RECENT = '🕑 Recent'
const CORE = 'webui/styles_nsfw_core.csv'
const OTHER = 'webui/styles_other.csv'

const style = (name: string, source_file: string, category: string): Style => ({
  name,
  source_file,
  prompt: name,
  negative_prompt: '',
  description: '',
  category,
})
const ARM = style('ACCESSORY_Arm_Warmers', OTHER, 'ACCESSORY')
const TALL = style('BODY_Tall', CORE, 'BODY')
const SIT = style('POSE_Sit', CORE, 'POSE')
const LORA = style('detail_tweaker', LORA_SOURCE, 'LoRA')
const CSV = [ARM, TALL, SIT]

type StoreState = ReturnType<typeof useStylesStore.getState>

describe('grid empty states', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  type Opener = ReturnType<typeof vi.fn<() => void>>
  let actions: AppActions & { openImportExport: Opener; openNewStyle: Opener }

  const empty = () => host!.querySelector<HTMLElement>('[data-sg-empty]')
  const title = () => empty()?.querySelector('h2')?.textContent ?? null
  const hint = () => empty()?.querySelector('p')?.textContent ?? null
  const buttons = () => [...(empty()?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
  const actionList = () => buttons().map((b) => [b.textContent, b.getAttribute('data-sg-empty-action')])
  const press = async (label: string) => {
    await act(async () => buttons().find((b) => b.textContent === label)!.click())
  }

  const render = async (state: Partial<StoreState>, canCreateStyle = false) => {
    const styles = state.styles ?? CSV
    useStylesStore.setState({
      styles,
      stylesLoaded: true,
      duplicatesByName: new Map(styles.map((s) => [s.name, [s]])),
      search: '',
      activeCategory: null,
      activeSource: null,
      favorites: new Set(),
      recentNames: [],
      sliceMode: null,
      sliceSelection: [],
      collapsedCategories: new Set(),
      viewMode: 'grid',
      selectedStyles: [],
      selectedKeySet: new Set(),
      thumbKeys: new Set(),
      ...state,
    })
    actions = { openImportExport: vi.fn<() => void>(), openNewStyle: vi.fn<() => void>(), canCreateStyle }
    await act(async () => {
      root!.render(
        <AppActionsContext.Provider value={actions}>
          <GridScroller>
            <StyleGrid />
          </GridScroller>
        </AppActionsContext.Provider>,
      )
    })
  }

  beforeEach(() => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
    useStylesStore.setState({ activeCategory: null, sliceMode: null, search: '', activeSource: null })
  })

  it('before the first styles payload: no empty state at all', async () => {
    await render({ styles: [], stylesLoaded: false })
    expect(empty()).toBeNull()
    expect(host!.textContent).not.toContain('No styles yet')
  })

  it('the first setStyles turns the empty states on, and later payloads keep them on', async () => {
    await render({ styles: [], stylesLoaded: false })
    expect(empty()).toBeNull()
    await act(async () => useStylesStore.getState().setStyles([], 'txt2img'))
    expect(useStylesStore.getState().stylesLoaded).toBe(true)
    expect(title()).toBe('No styles yet')
    await act(async () => useStylesStore.getState().setStyles([LORA], 'txt2img'))
    expect(useStylesStore.getState().stylesLoaded).toBe(true)
    expect(title()).toBe('No styles yet')
  })

  it('case 4: no CSV styles (LoRA rows do not count) → "No styles yet" with Import CSV…', async () => {
    await render({ styles: [LORA] })
    expect(empty()!.getAttribute('role')).toBe('status')
    expect(empty()!.getAttribute('data-sg-empty')).toBe('no-styles')
    expect(title()).toBe('No styles yet')
    expect(hint()).toBe('Import a CSV pack or create your first style.')
    expect(empty()!.querySelector('[data-sg-empty-icon="accent"] svg.lucide-layout-grid')).not.toBeNull()
    // New style is hidden while the header + button would be disabled.
    expect(actionList()).toEqual([['Import CSV…', 'primary']])
    await press('Import CSV…')
    expect(actions.openImportExport).toHaveBeenCalledOnce()
  })

  it('case 4: New style shows when the header rule allows it, and opens the editor', async () => {
    await render({ styles: [] }, true)
    expect(actionList()).toEqual([['Import CSV…', 'primary'], ['New style', 'secondary']])
    await press('New style')
    expect(actions.openNewStyle).toHaveBeenCalledOnce()
  })

  it('case 1: Favorites with no favorites (stale keys count as none)', async () => {
    await render({ activeCategory: FAVORITES, favorites: new Set(['webui/gone.csv\0BODY_Gone']) })
    expect(empty()!.getAttribute('data-sg-empty')).toBe('no-favorites')
    expect(title()).toBe('No favorites yet')
    expect(hint()).toBe('Use ★ on a tile or “Add to favorites” in its menu. Favorites from every source show up here.')
    expect(empty()!.querySelector('[data-sg-empty-icon="accent"] svg.lucide-star')).not.toBeNull()
    expect(buttons()).toHaveLength(0)
  })

  it('case 2: Recent with nothing used', async () => {
    await render({ activeCategory: RECENT })
    expect(title()).toBe('Nothing used yet')
    expect(hint()).toBe('Styles you apply show up here.')
    expect(empty()!.querySelector('svg.lucide-clock')).not.toBeNull()
  })

  it('case 3: LoRA view with no LoRAs', async () => {
    await render({ activeCategory: LORA_VIEW })
    expect(title()).toBe('No LoRAs found')
    expect(hint()).toBe('Put LoRA files in your WebUI LoRA folder, then reopen the panel.')
    expect(empty()!.querySelector('svg.lucide-dna')).not.toBeNull()
  })

  it('case 5 for a non-empty Favorites view filtered to nothing', async () => {
    await render({ activeCategory: FAVORITES, favorites: new Set([styleRowKey(TALL)]), search: 'gloev' })
    expect(empty()!.getAttribute('data-sg-empty')).toBe('no-results')
    expect(title()).toBe('Nothing matches “gloev” for Favorites')
    expect(empty()!.querySelector('[data-sg-empty-icon="muted"] svg.lucide-search-x')).not.toBeNull()
    expect(actionList()).toEqual([['Clear search', 'secondary'], ['Show all categories', 'secondary']])
  })

  it('case 5: search only', async () => {
    await render({ search: 'gloev' })
    expect(title()).toBe('Nothing matches “gloev”')
    expect(hint()).toBeNull()
    expect(actionList()).toEqual([['Clear search', 'secondary']])
    await press('Clear search')
    expect(useStylesStore.getState().search).toBe('')
  })

  it('case 5: search and source; the source shows as its short label, never a path', async () => {
    await render({ search: 'gloev', activeSource: CORE })
    expect(title()).toBe('Nothing matches “gloev” in styles_nsfw_core')
    expect(empty()!.textContent).not.toContain('/')
    expect(empty()!.textContent).not.toContain('.csv')
    expect(actionList()).toEqual([['Search all sources', 'primary'], ['Clear search', 'secondary']])
    await press('Search all sources')
    expect(useStylesStore.getState().activeSource).toBeNull()
  })

  it('case 5: source and category', async () => {
    await render({ activeSource: CORE, activeCategory: 'ACCESSORY' })
    expect(title()).toBe('No styles in styles_nsfw_core for ACCESSORY')
    expect(actionList()).toEqual([['Search all sources', 'primary'], ['Show all categories', 'secondary']])
    await press('Show all categories')
    expect(useStylesStore.getState().activeCategory).toBeNull()
  })

  it('case 5: search, source and category together', async () => {
    await render({ search: 'gloev', activeSource: CORE, activeCategory: 'BODY' })
    expect(title()).toBe('Nothing matches “gloev” in styles_nsfw_core for BODY')
    expect(actionList()).toEqual([
      ['Search all sources', 'primary'],
      ['Clear search', 'secondary'],
      ['Show all categories', 'secondary'],
    ])
  })

  it('case 5: slice category; Show all categories leaves slice mode', async () => {
    await render({ sliceMode: { category: 'POSE', kind: 'sg' }, search: 'zzz' })
    expect(title()).toBe('Nothing matches “zzz” for POSE')
    await press('Show all categories')
    expect(useStylesStore.getState().sliceMode).toBeNull()
    expect(useStylesStore.getState().activeCategory).toBeNull()
  })

  it('case 5: a long query is cut at 40 characters with "…"', async () => {
    const q = 'abcdefghij'.repeat(5)
    await render({ search: q })
    expect(title()).toBe(`Nothing matches “${q.slice(0, 40)}…”`)
  })

  it('without App (no actions context) case 4 offers no buttons', async () => {
    useStylesStore.setState({ styles: [], stylesLoaded: true, activeCategory: null, search: '', activeSource: null })
    await act(async () => {
      root!.render(
        <GridScroller>
          <StyleGrid />
        </GridScroller>,
      )
    })
    expect(title()).toBe('No styles yet')
    expect(buttons()).toHaveLength(0)
  })
})
