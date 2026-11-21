/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, WILDCARD_KIND_DECK, WILDCARD_KIND_DICE, type Style } from '../bridge'
import { __resetGridFocusForTests } from '../lib/gridFocus'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { useStylesStore } from '../store/stylesStore'
import { GridScroller } from './grid/GridScroller'
import { StyleGrid } from './StyleGrid'

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

describe('slice bar Random / Shuffle toggle', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const bar = () => host!.querySelector<HTMLElement>('[role="toolbar"]')!
  const group = () => bar().querySelector<HTMLElement>('[role="radiogroup"]')!
  const radios = () => [...group().querySelectorAll<HTMLButtonElement>('[role="radio"]')]
  const radio = (label: string) => radios().find((r) => r.textContent === label)!
  const addButton = () =>
    [...bar().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.startsWith('Add as'))!
  const title = () => bar().querySelector<HTMLElement>('span.font-medium')!.textContent
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

  it('starts on Random (Pick styles default) at the start of the bar', () => {
    expect(group().getAttribute('aria-label')).toBe('Wildcard mode')
    expect(bar().firstElementChild).toBe(group())
    expect(radios().map((r) => [r.textContent, r.getAttribute('aria-checked'), r.tabIndex])).toEqual([
      ['Random', 'true', 0],
      ['Shuffle', 'false', -1],
    ])
    expect(title()).toBe('Slice: BODY')
    expect(addButton().textContent).toBe('Add as wildcard')
  })

  it('click switches the kind both ways, keeps the picks, and updates title and Add', async () => {
    await act(async () => radio('Shuffle').click())
    expect(useStylesStore.getState().sliceMode).toEqual({ category: 'BODY', kind: WILDCARD_KIND_DECK })
    expect(useStylesStore.getState().sliceSelection).toEqual(['BODY_A', 'BODY_C'])
    expect(title()).toBe('Shuffle slice: BODY')
    expect(addButton().textContent).toBe('Add as shuffle wildcard')
    expect(addButton().getAttribute('aria-label')).toBe('Add selection as shuffle wildcard slice')
    expect(radio('Shuffle').getAttribute('aria-checked')).toBe('true')

    await act(async () => radio('Random').click())
    expect(useStylesStore.getState().sliceMode).toEqual({ category: 'BODY', kind: WILDCARD_KIND_DICE })
    expect(useStylesStore.getState().sliceSelection).toEqual(['BODY_A', 'BODY_C'])
    expect(title()).toBe('Slice: BODY')
    expect(addButton().textContent).toBe('Add as wildcard')
  })

  it('Add sends the kind chosen in the toggle', async () => {
    await act(async () => radio('Shuffle').click())
    await act(async () => addButton().click())
    expect(sendToHost).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SG_WILDCARD_SLICE', category: 'BODY', kind: WILDCARD_KIND_DECK }),
    )
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
