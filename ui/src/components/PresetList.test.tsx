/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { styleRowKey, useStylesStore, type PresetRecord } from '../store/stylesStore'
import { PresetList } from './PresetList'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const TALL: Style = {
  name: 'BODY_Tall',
  source_file: 'webui/a.csv',
  prompt: 'tall',
  negative_prompt: '',
  description: '',
  category: 'BODY',
}
const preset = (note = ''): PresetRecord => ({
  styles: [{ name: 'BODY_Tall', source_file: 'webui/a.csv' }],
  created: '2026-01-01',
  note,
})

describe('PresetList', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const grid = () => host!.querySelector<HTMLElement>('[data-sg-preset-grid]')
  const cards = () => [...host!.querySelectorAll<HTMLElement>('[data-sg-preset-card]')]
  const tile = () => host!.querySelector<HTMLButtonElement>('[data-sg-save-tile]')
  const dialogTitle = () => {
    const d = document.querySelector<HTMLElement>('[role="dialog"]')
    return d ? document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent : null
  }

  const render = async (
    presets: Record<string, PresetRecord>,
    opts: { search?: string; selected?: Style[]; wildcards?: boolean } = {},
  ) => {
    const selected = opts.selected ?? []
    useStylesStore.setState({
      styles: [TALL],
      presets,
      search: opts.search ?? '',
      selectedStyles: selected,
      selectedKeySet: new Set(selected.map(styleRowKey)),
      activeWildcards: opts.wildcards ? [{ category: 'pose', spec: '' }] : [],
    })
    await act(async () => {
      root!.render(<PresetList />)
    })
  }

  beforeEach(() => {
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
    __resetLayerStackForTests()
  })

  it('cards in a responsive grid, sorted by name, the Save tile last', async () => {
    await render({ Zeta: preset(), Alpha: preset(), mid: preset() }, { selected: [TALL] })
    expect(grid()!.className).toContain('grid-cols-[repeat(auto-fill,minmax(220px,1fr))]')
    expect(grid()!.className).toContain('gap-3')
    expect(cards().map((c) => c.getAttribute('data-sg-preset-card'))).toEqual(['Alpha', 'mid', 'Zeta'])
    expect(grid()!.lastElementChild).toBe(tile())
  })

  it('search filters by name and note', async () => {
    await render({ Alpha: preset('portrait setup'), Beta: preset() }, { search: 'portrait' })
    expect(cards().map((c) => c.getAttribute('data-sg-preset-card'))).toEqual(['Alpha'])
  })

  it('Save tile opens the Save set dialog', async () => {
    await render({ Alpha: preset() }, { selected: [TALL] })
    expect(tile()!.disabled).toBe(false)
    expect(tile()!.textContent).toBe('Save current selection')
    expect(tile()!.className).toContain('border-dashed')
    expect(tile()!.className).toContain('min-h-[150px]')
    await act(async () => tile()!.click())
    expect(dialogTitle()).toBeTruthy()
  })

  it('Save tile is disabled with nothing selected, and enabled with wildcards alone', async () => {
    await render({ Alpha: preset() })
    expect(tile()!.disabled).toBe(true)
    expect(tile()!.getAttribute('aria-disabled')).toBe('true')
    expect(tile()!.textContent).toBe('Select styles first')

    await render({ Alpha: preset() }, { wildcards: true })
    expect(tile()!.disabled).toBe(false)
    expect(tile()!.textContent).toBe('Save current selection')
  })

  it('no presets: only the Save tile and one muted line', async () => {
    await render({}, { selected: [TALL] })
    expect(cards()).toHaveLength(0)
    expect(grid()!.children).toHaveLength(1)
    expect(tile()).not.toBeNull()
    expect(host!.textContent).toContain('Apply merges a set into your current selection.')
  })

  it('no search matches: the old text and no Save tile', async () => {
    await render({ Alpha: preset() }, { search: 'nothing-like-this', selected: [TALL] })
    expect(host!.textContent).toBe('No sets match search')
    expect(tile()).toBeNull()
  })
})
