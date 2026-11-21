/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { __resetGridFocusForTests } from '../lib/gridFocus'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { LORA_SOURCE, LORA_VIEW, useStylesStore } from '../store/stylesStore'
import { GridScroller } from './grid/GridScroller'
import { StyleGrid } from './StyleGrid'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const lora = (name: string, category: string): Style => ({
  name,
  source_file: LORA_SOURCE,
  prompt: `<lora:${name}:1>`,
  negative_prompt: '',
  description: '',
  category,
})

const LAYOUT_PROPS = ['offsetHeight', 'offsetWidth', 'clientHeight', 'clientWidth'] as const

describe('LoRA grid header menu', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(async () => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    // jsdom has no layout: give every element a box so the virtualized grid renders rows.
    for (const [prop, value] of [['offsetHeight', 600], ['offsetWidth', 800], ['clientHeight', 600], ['clientWidth', 800]] as const) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
    }
    const styles = [lora('hero', 'characters'), lora('ink', 'styles')]
    useStylesStore.setState({
      styles,
      duplicatesByName: new Map(styles.map((s) => [s.name, [s]])),
      search: '',
      activeCategory: LORA_VIEW,
      activeSource: null,
      collapsedCategories: new Set(),
      selectedStyles: [],
      selectedKeySet: new Set(),
      favorites: new Set(),
      thumbKeys: new Set(),
      viewMode: 'grid',
      sliceMode: null,
      sliceSelection: [],
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <GridScroller style={{ height: 600, overflow: 'auto' }}>
          <StyleGrid />
        </GridScroller>,
      )
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
    useStylesStore.setState({ activeCategory: null })
    for (const prop of LAYOUT_PROPS) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
    }
    __resetLayerStackForTests()
  })

  it('right-click on a LoRA folder header shows the category menu without Generate previews', async () => {
    const header = host!.querySelector<HTMLElement>('[data-sg-category-header="characters"]')
    expect(header).not.toBeNull()
    await act(async () => {
      header!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 50 }))
    })
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    expect(menu).not.toBeNull()
    expect(menu.querySelector('[aria-hidden]')!.textContent).toBe('Wildcard from characters')
    expect(
      [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.querySelector('span.text-sm')?.textContent ?? b.textContent),
    ).toEqual(['Random', 'Shuffle', 'Pick styles…'])
    expect(menu.textContent).not.toContain('Generate previews')
  })
})
