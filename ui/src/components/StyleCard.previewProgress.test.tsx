/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, type Style } from '../bridge'
import { __resetGridFocusForTests } from '../lib/gridFocus'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { styleRowKey, useStylesStore, type ViewMode } from '../store/stylesStore'
import { GALLERY_LABEL_HEIGHT_PX } from './grid/constants'
import { StyleCard } from './StyleCard'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const S: Style = {
  name: 'BODY_Tall_Amazon',
  source_file: 'webui/a.csv',
  prompt: 'tall',
  negative_prompt: '',
  description: '',
  category: 'BODY',
}
const KEY = styleRowKey(S)

describe('single preview progress on a tile', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const card = () => host!.querySelector<HTMLButtonElement>('[data-sg-card]')!
  const status = () => card().querySelector<HTMLElement>('[data-sg-preview-status]')
  const star = () => card().querySelector('svg.lucide-star')
  const overlay = () => card().querySelector<HTMLElement>('[data-sg-preview-generating]')
  const generateItem = () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.trim() === 'Generate preview')!

  const job = async (status: 'generating' | 'done' | 'error') => {
    await act(async () => useStylesStore.getState().applyPreviewProgress(KEY, status))
  }
  const render = async (viewMode: ViewMode) => {
    await act(async () => {
      root!.render(
        <StyleCard
          style={S}
          viewMode={viewMode}
          galleryCardHeightPx={146 + GALLERY_LABEL_HEIGHT_PX}
          cellRow={0}
          cellCol={0}
          tabIndex={0}
        />,
      )
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    vi.mocked(sendToHost).mockClear()
    useStylesStore.setState({
      styles: [S],
      duplicatesByName: new Map([[S.name, [S]]]),
      selectedStyles: [],
      selectedKeySet: new Set(),
      favorites: new Set([KEY]),
      activeSource: null,
      thumbVersions: {},
      thumbKeys: new Set(),
      thumbKeysLoaded: true,
      previewJobs: new Map(),
      previewBatch: null,
    })
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
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('grid: 12 px spinner while generating, aria-busy, the ★ indicator hidden', async () => {
    await render('grid')
    expect(star()).not.toBeNull()
    expect(card().hasAttribute('aria-busy')).toBe(false)
    await job('generating')
    expect(status()!.getAttribute('data-sg-preview-status')).toBe('generating')
    expect(status()!.getAttribute('aria-hidden')).toBe('true')
    expect(status()!.className).toContain('right-1.5 top-1/2 -translate-y-1/2')
    expect(status()!.className).toContain('text-sg-wildcard-text')
    const spinner = status()!.querySelector('svg.lucide-loader-circle')!
    expect(spinner.getAttribute('width')).toBe('12')
    expect(spinner.getAttribute('class')).toContain('animate-spin motion-reduce:animate-none')
    expect(card().getAttribute('aria-busy')).toBe('true')
    expect(star()).toBeNull()
  })

  it('grid: ✓ for 1.5 s after done, then nothing and the ★ is back', async () => {
    await render('grid')
    await job('generating')
    await job('done')
    expect(status()!.querySelector('svg.lucide-check')).not.toBeNull()
    expect(card().hasAttribute('aria-busy')).toBe(false)
    expect(star()).toBeNull()
    await act(async () => vi.advanceTimersByTime(1500))
    expect(status()).toBeNull()
    expect(star()).not.toBeNull()
  })

  it('grid: error clears the indicator at once', async () => {
    await render('grid')
    await job('generating')
    await job('error')
    expect(status()).toBeNull()
    expect(card().hasAttribute('aria-busy')).toBe(false)
  })

  it('gallery: dimmed overlay with a centered spinner and "Generating"', async () => {
    await render('gallery')
    expect(overlay()).toBeNull()
    await job('generating')
    const o = overlay()!
    expect(o.parentElement!.hasAttribute('data-sg-gallery-thumb')).toBe(true)
    expect(o.className).toContain('absolute inset-0')
    expect(o.className).toContain('bg-sg-bg/60')
    expect(o.className).toContain('items-center justify-center')
    expect(o.textContent).toBe('Generating')
    expect(o.querySelector('svg.lucide-loader-circle')).not.toBeNull()
    expect(status()).toBeNull()
    await job('done')
    expect(overlay()).toBeNull()
  })

  it('"Generate preview" is disabled while this tile generates', async () => {
    await render('grid')
    await job('generating')
    await act(async () => {
      card().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))
    })
    expect(generateItem().disabled).toBe(true)
    await act(async () => generateItem().click())
    expect(sendToHost).not.toHaveBeenCalled()
  })

  it('"Generate preview" is enabled otherwise and sends SG_GENERATE_PREVIEW', async () => {
    await render('grid')
    await act(async () => {
      card().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))
    })
    expect(generateItem().disabled).toBe(false)
    await act(async () => generateItem().click())
    expect(sendToHost).toHaveBeenCalledWith({ type: 'SG_GENERATE_PREVIEW', styleId: S.name, source: S.source_file })
  })
})
