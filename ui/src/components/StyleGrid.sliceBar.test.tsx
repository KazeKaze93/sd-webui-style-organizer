/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, WILDCARD_KIND_DECK, WILDCARD_KIND_DICE, type Style } from '../bridge'
import { __resetGridFocusForTests } from '../lib/gridFocus'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { useStylesStore } from '../store/stylesStore'
import { GridScroller } from './grid/GridScroller'
import { TooltipProvider } from './ui/tooltip'
import { StyleGrid } from './StyleGrid'
import { ViewModeToggle } from './ViewModeToggle'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const row = (name: string): Style => ({
  name,
  source_file: 'webui/a.csv',
  prompt: name,
  negative_prompt: '',
  description: '',
  category: 'BODY',
})

describe('slice bar (decision 8)', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const bar = () => host!.querySelector<HTMLElement>('[role="toolbar"]')!
  const group = () => bar().querySelector<HTMLElement>('[role="radiogroup"]')!
  const radios = () => [...group().querySelectorAll<HTMLButtonElement>('[role="radio"]')]
  const radio = (label: string) => radios().find((r) => r.textContent === label)!
  const button = (text: string) =>
    [...bar().querySelectorAll<HTMLButtonElement>(':scope > button')].find((b) => b.textContent === text)!
  const addButton = () => bar().querySelector<HTMLButtonElement>('[data-sg-slice-add]')!
  const title = () => bar().querySelector<HTMLElement>('[data-sg-slice-title]')!.textContent
  const count = () => bar().querySelector<HTMLElement>('[data-sg-slice-count]')!
  /** The toolbar's direct children, in DOM order. */
  const order = () =>
    [...bar().children].map((el) => {
      if (el.hasAttribute('data-sg-slice-title')) return 'title'
      if (el.getAttribute('role') === 'radiogroup') return 'mode'
      if (el.hasAttribute('data-sg-slice-count')) return 'count'
      if (el.tagName === 'DIV' && el.classList.contains('flex-1')) return 'spacer'
      return el.textContent
    })
  const key = async (target: HTMLElement, k: string) => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    })
  }

  beforeEach(async () => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    vi.mocked(sendToHost).mockClear()
    const styles = [row('BODY_A'), row('BODY_B'), row('BODY_C')]
    useStylesStore.setState({
      styles,
      duplicatesByName: new Map(styles.map((s) => [s.name, [s]])),
      search: '',
      activeCategory: null,
      activeSource: null,
      selectedStyles: [],
      selectedKeySet: new Set(),
      favorites: new Set(),
      thumbKeys: new Set(),
      viewMode: 'grid',
      sliceMode: null,
      sliceSelection: [],
    })
    useStylesStore.getState().startSliceMode('BODY')
    useStylesStore.getState().toggleSliceSelection('BODY_A')
    useStylesStore.getState().toggleSliceSelection('BODY_C')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <GridScroller>
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
    useStylesStore.setState({ sliceMode: null, sliceSelection: [] })
    __resetLayerStackForTests()
  })

  it('controls in order: title, mode, count, spacer, Select all, Clear, Cancel, Add wildcard', () => {
    expect(order()).toEqual(['title', 'mode', 'count', 'spacer', 'Select all', 'Clear', 'Cancel', 'Add wildcard'])
  })

  it('starts on Random; one title and one Add label for both modes', async () => {
    expect(group().getAttribute('aria-label')).toBe('Wildcard mode')
    expect(radios().map((r) => [r.textContent, r.getAttribute('aria-checked'), r.tabIndex])).toEqual([
      ['Random', 'true', 0],
      ['Shuffle', 'false', -1],
    ])
    expect(title()).toBe('Wildcard from BODY')
    expect(bar().querySelector('[data-sg-slice-title] span')!.className).toBe('text-sg-wildcard-text')
    expect(addButton().textContent).toBe('Add wildcard')
    expect(addButton().getAttribute('aria-label')).toBe('Add selection as random wildcard')

    await act(async () => radio('Shuffle').click())
    expect(useStylesStore.getState().sliceMode).toEqual({ category: 'BODY', kind: WILDCARD_KIND_DECK })
    expect(useStylesStore.getState().sliceSelection).toEqual(['BODY_A', 'BODY_C'])
    expect(title()).toBe('Wildcard from BODY')
    expect(addButton().textContent).toBe('Add wildcard')
    expect(addButton().getAttribute('aria-label')).toBe('Add selection as shuffle wildcard slice')

    await act(async () => radio('Random').click())
    expect(useStylesStore.getState().sliceMode).toEqual({ category: 'BODY', kind: WILDCARD_KIND_DICE })
    expect(title()).toBe('Wildcard from BODY')
    expect(addButton().getAttribute('aria-label')).toBe('Add selection as random wildcard')
  })

  it('count reads "<n> picked" in the wildcard text color, politely live', async () => {
    expect(count().textContent).toBe('2 picked')
    expect(count().className).toBe('text-xs text-sg-wildcard-text')
    expect(count().getAttribute('aria-live')).toBe('polite')
    await act(async () => useStylesStore.getState().toggleSliceSelection('BODY_B'))
    expect(count().textContent).toBe('3 picked')
  })

  it('labels: Select all and Clear keep their aria-labels and text-button styles', () => {
    expect(button('Select all').getAttribute('aria-label')).toBe('Select all visible styles for wildcard slice')
    expect(button('Clear').getAttribute('aria-label')).toBe('Clear wildcard slice selection')
    for (const b of [button('Select all'), button('Clear')]) {
      expect(b.className).toContain('text-sg-muted')
      expect(b.className).not.toContain('border')
    }
  })

  it('Cancel is an outlined secondary button and exits slice mode without sending', async () => {
    const cancel = button('Cancel')
    expect(cancel.getAttribute('aria-label')).toBe('Cancel wildcard slice selection')
    for (const cls of ['border', 'border-sg-border', 'rounded', 'px-2.5', 'h-7', 'text-xs']) {
      expect(cancel.classList.contains(cls)).toBe(true)
    }
    await act(async () => cancel.click())
    expect(useStylesStore.getState().sliceMode).toBeNull()
    expect(sendToHost).not.toHaveBeenCalled()
  })

  it('Add wildcard is the solid primary button', () => {
    for (const cls of ['bg-sg-wildcard', 'text-white', 'hover:bg-sg-wildcard/85', 'rounded', 'px-3', 'h-7', 'text-xs', 'font-medium']) {
      expect(addButton().classList.contains(cls)).toBe(true)
    }
    expect(addButton().disabled).toBe(false)
    expect(addButton().getAttribute('aria-disabled')).toBe('false')
  })

  it('Add (Random) sends the same SG_WILDCARD_SLICE payload as before and exits', async () => {
    await act(async () => addButton().click())
    expect(vi.mocked(sendToHost).mock.calls).toEqual([[{ type: 'SG_WILDCARD_SLICE', category: 'BODY', spec: '-B' }]])
    expect(useStylesStore.getState().sliceMode).toBeNull()
  })

  it('Add (Shuffle) sends the same payload with kind deck', async () => {
    await act(async () => radio('Shuffle').click())
    await act(async () => addButton().click())
    expect(vi.mocked(sendToHost).mock.calls).toEqual([
      [{ type: 'SG_WILDCARD_SLICE', category: 'BODY', spec: '-B', kind: WILDCARD_KIND_DECK }],
    ])
  })

  it('zero picked: Add is disabled (would mean the whole category) and sends nothing', async () => {
    await act(async () => button('Clear').click())
    expect(count().textContent).toBe('0 picked')
    const add = addButton()
    expect(add.disabled).toBe(true)
    expect(add.getAttribute('aria-disabled')).toBe('true')
    expect(add.className).toContain('text-sg-muted')
    expect(add.className).toContain('cursor-not-allowed')
    expect(add.className).not.toContain('text-white')
    await act(async () => add.click())
    expect(sendToHost).not.toHaveBeenCalled()
    expect(useStylesStore.getState().sliceMode).not.toBeNull()

    await act(async () => useStylesStore.getState().toggleSliceSelection('BODY_B'))
    expect(addButton().disabled).toBe(false)
  })

  it('the slice mode toggle uses the wildcard tone; the header toggle keeps the accent', async () => {
    expect(radio('Random').className).toContain('bg-sg-wildcard text-white')
    expect(radio('Random').className).not.toContain('bg-sg-accent')
    expect(radio('Shuffle').className).not.toContain('bg-sg-wildcard')

    const headerHost = document.createElement('div')
    document.body.appendChild(headerHost)
    const headerRoot = createRoot(headerHost)
    await act(async () => {
      headerRoot.render(
        <TooltipProvider>
          <ViewModeToggle />
        </TooltipProvider>,
      )
    })
    const grid = headerHost.querySelector<HTMLElement>('[data-sg-view-mode="grid"]')!
    const gallery = headerHost.querySelector<HTMLElement>('[data-sg-view-mode="gallery"]')!
    expect(grid.getAttribute('aria-checked')).toBe('true')
    expect(grid.className).toContain('bg-sg-accent text-white')
    expect(grid.className).not.toContain('sg-wildcard')
    expect(gallery.className).toContain('text-sg-muted hover:text-sg-text')
    act(() => headerRoot.unmount())
    headerHost.remove()
  })

  it('arrow keys, Home and End move focus and select (radio semantics)', async () => {
    radio('Random').focus()
    await key(radio('Random'), 'ArrowRight')
    expect(useStylesStore.getState().sliceMode?.kind).toBe(WILDCARD_KIND_DECK)
    expect(document.activeElement).toBe(radio('Shuffle'))
    expect(radio('Shuffle').tabIndex).toBe(0)
    await key(radio('Shuffle'), 'ArrowRight') // wraps
    expect(useStylesStore.getState().sliceMode?.kind).toBe(WILDCARD_KIND_DICE)
    expect(document.activeElement).toBe(radio('Random'))
    await key(radio('Random'), 'ArrowLeft') // wraps back
    expect(useStylesStore.getState().sliceMode?.kind).toBe(WILDCARD_KIND_DECK)
    await key(radio('Shuffle'), 'Home')
    expect(useStylesStore.getState().sliceMode?.kind).toBe(WILDCARD_KIND_DICE)
    await key(radio('Random'), 'End')
    expect(useStylesStore.getState().sliceMode?.kind).toBe(WILDCARD_KIND_DECK)
    expect(useStylesStore.getState().sliceSelection).toEqual(['BODY_A', 'BODY_C'])
  })
})
