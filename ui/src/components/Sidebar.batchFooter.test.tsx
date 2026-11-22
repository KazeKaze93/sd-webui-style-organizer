/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, type BatchProgress, type Style } from '../bridge'
import { __resetFocusSourceForTests, installFocusSourceTracking } from '../lib/focusSource'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { useStylesStore } from '../store/stylesStore'
import { Sidebar } from './Sidebar'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const row = (name: string, category: string): Style => ({
  name,
  source_file: 'webui/a.csv',
  prompt: name,
  negative_prompt: '',
  description: '',
  category,
})
const report = (fields: Partial<BatchProgress> = {}): BatchProgress => ({
  category: 'BODY',
  source: 'webui/a.csv',
  status: 'running',
  total: 12,
  processed: 4,
  newCount: 4,
  alreadyHad: 0,
  skipped: 0,
  failed: 0,
  ...fields,
})

describe('sidebar footer: batch status', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let uninstallFocus: (() => void) | null = null

  const footer = () => host!.querySelector<HTMLElement>('[data-sg-sidebar-hint]')!
  const cancel = () => footer().querySelector<HTMLButtonElement>('[data-sg-sidebar-batch-cancel]')
  const nav = (cat: string) =>
    host!.querySelector<HTMLElement>(`[data-sg-category-row="${cat}"]`)!.querySelector<HTMLButtonElement>('button')!
  const enter = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('pointerenter', { bubbles: false }))
    })
  }
  const apply = async (b: BatchProgress) => {
    await act(async () => useStylesStore.getState().applyBatchProgress(b))
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.mocked(sendToHost).mockClear()
    __resetLayerStackForTests()
    __resetFocusSourceForTests()
    uninstallFocus = installFocusSourceTracking()
    useStylesStore.setState({
      styles: [row('BODY_A', 'BODY'), row('POSE_A', 'POSE')],
      activeCategory: null,
      activeSource: null,
      categoryOrder: [],
      favorites: new Set(),
      presets: {},
      fetchPresets: async () => {},
      previewBatch: null,
    } as unknown as Partial<ReturnType<typeof useStylesStore.getState>>)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<Sidebar />)
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
    uninstallFocus?.()
    __resetFocusSourceForTests()
    __resetLayerStackForTests()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('a running batch outranks the hint; the line is no longer aria-hidden', async () => {
    await enter(nav('POSE'))
    expect(footer().textContent).toBe('POSE: right-click for options')
    expect(footer().getAttribute('aria-hidden')).toBe('true')
    await apply(report())
    expect(footer().hasAttribute('aria-hidden')).toBe(false)
    const span = footer().querySelector('span')!
    expect(span.textContent).toBe('Generating 4 / 12')
    expect(span.getAttribute('title')).toBe('Generating previews · BODY 4 / 12')
    expect(footer().querySelector('svg.lucide-loader-circle')).not.toBeNull()
    expect(footer().textContent).not.toContain('right-click')
    expect(footer().classList.contains('h-6')).toBe(true)
    // No Skip in the footer.
    expect([...footer().querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Cancel'])
  })

  it('Cancel is in the Tab order and sends SG_BATCH_CANCEL', async () => {
    await apply(report())
    const c = cancel()!
    expect(c.tabIndex).toBe(0)
    expect(c.getAttribute('aria-label')).toBe('Cancel preview generation')
    c.focus()
    expect(document.activeElement).toBe(c)
    await act(async () => c.click())
    expect(vi.mocked(sendToHost).mock.calls).toEqual([[{ type: 'SG_BATCH_CANCEL' }]])
  })

  it('final texts for 3 s, then the hint line is back (aria-hidden, empty)', async () => {
    await apply(report({ status: 'finished', processed: 12, newCount: 7, failed: 5 }))
    expect(footer().textContent).toBe('Ready: 7 new')
    expect(cancel()).toBeNull()
    expect(footer().hasAttribute('aria-hidden')).toBe(false)
    await act(async () => vi.advanceTimersByTime(3000))
    expect(footer().getAttribute('aria-hidden')).toBe('true')
    expect(footer().textContent).toBe('')

    await apply(report({ status: 'cancelled', processed: 4 }))
    expect(footer().textContent).toBe('Cancelled at 4 / 12')
  })
})
