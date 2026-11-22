/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { __resetFocusSourceForTests, installFocusSourceTracking } from '../lib/focusSource'
import { HOVER_POPUP_SHOW_DELAY_MS } from '../lib/hoverIntent'
import { __resetLayerStackForTests, closeTopLayer } from '../lib/layerStack'
import { LORA_SOURCE, useStylesStore } from '../store/stylesStore'
import { Sidebar } from './Sidebar'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const row = (name: string, category: string, source_file = 'webui/a.csv'): Style => ({
  name,
  source_file,
  prompt: name,
  negative_prompt: '',
  description: '',
  category,
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('sidebar category hint tooltip', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let uninstallFocus: (() => void) | null = null

  const rowEl = (cat: string) => host!.querySelector<HTMLElement>(`[data-sg-category-row="${cat}"]`)!
  const nav = (cat: string) => rowEl(cat).querySelector<HTMLButtonElement>('button')!
  const fixed = (label: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.startsWith(label))!
  /** Visible hint content (Radix also renders a hidden copy for assistive tech). */
  const hint = () => document.querySelector<HTMLElement>('[data-sg-category-hint]')
  const hintLines = () => [...(hint()?.querySelectorAll(':scope > p') ?? [])].map((p) => p.textContent)

  const hover = async (el: HTMLElement, ms = HOVER_POPUP_SHOW_DELAY_MS + 60) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('pointerenter', { bubbles: false }))
      el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
      await wait(ms)
    })
  }
  const unhover = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }))
      el.dispatchEvent(new MouseEvent('pointerleave', { bubbles: false }))
      await wait(20)
    })
  }

  beforeEach(async () => {
    __resetLayerStackForTests()
    __resetFocusSourceForTests()
    uninstallFocus = installFocusSourceTracking()
    useStylesStore.setState({
      styles: [row('BODY_A', 'BODY'), row('BODY_B', 'BODY'), row('POSE_A', 'POSE'), row('detail', 'LoRA', LORA_SOURCE)],
      activeCategory: null,
      activeSource: null,
      categoryOrder: [],
      favorites: new Set(),
      recentNames: [],
      presets: {},
      fetchPresets: async () => {},
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
  })

  it('hover shows it only after the tile-preview delay, with the count and the right-click line', async () => {
    await hover(nav('BODY'), Math.floor(HOVER_POPUP_SHOW_DELAY_MS / 3))
    expect(hint()).toBeNull()
    await act(async () => {
      await wait(HOVER_POPUP_SHOW_DELAY_MS)
    })
    expect(hint()).not.toBeNull()
    expect(hintLines()).toEqual(['BODY · 2 styles', 'Right-click for wildcard options'])
    expect(hint()!.getAttribute('data-align')).toBe('start')
    expect(hint()!.querySelector('svg.lucide-mouse')!.getAttribute('width')).toBe('12')
    expect(hint()!.className).toContain('bg-sg-popover')
    expect(hint()!.className).toContain('border-sg-border')
    await unhover(nav('BODY'))
    expect(hint()).toBeNull()
  })

  it('singular count', async () => {
    await hover(nav('POSE'))
    expect(hintLines()[0]).toBe('POSE · 1 style')
  })

  it('opens on Tab focus, not on programmatic focus', async () => {
    await act(async () => {
      nav('POSE').focus()
      await wait(HOVER_POPUP_SHOW_DELAY_MS + 60)
    })
    expect(hint()).toBeNull()
    await act(async () => nav('POSE').blur())

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      nav('POSE').focus()
      await wait(HOVER_POPUP_SHOW_DELAY_MS + 60)
    })
    expect(hintLines()[0]).toBe('POSE · 1 style')
  })

  it('stays closed while the row menu is open', async () => {
    await act(async () => {
      nav('BODY').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 5, clientY: 5 }))
    })
    expect(rowEl('BODY').getAttribute('data-sg-menu-open')).toBe('true')
    await hover(nav('BODY'))
    expect(hint()).toBeNull()
    act(() => {
      closeTopLayer()
    })
    await unhover(nav('BODY'))
    await hover(nav('BODY'))
    expect(hint()).not.toBeNull()
  })

  it.each(['All', 'Favorites', 'Recent', 'Presets'])('no hint on the fixed entry %s', async (label) => {
    await hover(fixed(label))
    expect(hint()).toBeNull()
  })

  it('LoRA has the hint, with LoRA wording', async () => {
    await hover(fixed('LoRA'))
    expect(hintLines()).toEqual(['LoRA · 1 LoRA', 'Right-click for wildcard options'])
  })
})
