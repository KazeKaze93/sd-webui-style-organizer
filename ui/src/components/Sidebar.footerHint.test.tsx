/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { __resetFocusSourceForTests, installFocusSourceTracking } from '../lib/focusSource'
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

describe('sidebar footer hint line', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let uninstallFocus: (() => void) | null = null

  const footer = () => host!.querySelector<HTMLElement>('[data-sg-sidebar-hint]')!
  const rowEl = (cat: string) => host!.querySelector<HTMLElement>(`[data-sg-category-row="${cat}"]`)!
  const nav = (cat: string) => rowEl(cat).querySelector<HTMLButtonElement>('button')!
  const fixed = (label: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.startsWith(label))!
  const enter = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('pointerenter', { bubbles: false }))
    })
  }
  const leave = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }))
      el.dispatchEvent(new MouseEvent('pointerleave', { bubbles: false }))
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

  it('the footer sits outside the scrolling list and keeps its height when empty', () => {
    const f = footer()
    expect(f.textContent).toBe('')
    expect(f.querySelector('svg')).toBeNull()
    for (const cls of ['shrink-0', 'h-6', 'border-t', 'border-sg-border', 'whitespace-nowrap']) {
      expect(f.classList.contains(cls)).toBe(true)
    }
    expect(f.getAttribute('aria-hidden')).toBe('true')
    const scroller = f.previousElementSibling as HTMLElement
    expect(scroller.className).toContain('overflow-y-auto')
    expect(scroller.contains(rowEl('BODY'))).toBe(true)
    expect(scroller.contains(f)).toBe(false)
  })

  it('hovering a category shows "<NAME>: right-click for options"; leaving clears it', async () => {
    await enter(nav('BODY'))
    expect(footer().textContent).toBe('BODY: right-click for options')
    expect(footer().querySelector('svg.lucide-mouse')!.getAttribute('width')).toBe('12')
    expect(footer().querySelector('span')!.className).toContain('truncate')
    await enter(nav('POSE'))
    expect(footer().textContent).toBe('POSE: right-click for options')
    await leave(nav('POSE'))
    expect(footer().textContent).toBe('')
  })

  it('keyboard (Tab) focus shows it; programmatic focus does not; blur clears it', async () => {
    await act(async () => nav('POSE').focus())
    expect(footer().textContent).toBe('')
    await act(async () => nav('POSE').blur())

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      nav('POSE').focus()
    })
    expect(footer().textContent).toBe('POSE: right-click for options')
    await act(async () => nav('POSE').blur())
    expect(footer().textContent).toBe('')
  })

  it('stays empty while a context menu is open', async () => {
    await act(async () => {
      nav('BODY').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 5, clientY: 5 }))
    })
    await enter(nav('BODY'))
    expect(footer().textContent).toBe('')
    act(() => {
      closeTopLayer()
    })
    expect(footer().textContent).toBe('BODY: right-click for options')
  })

  it.each(['All', 'Favorites', 'Presets'])('the fixed entry %s never sets it', async (label) => {
    await enter(fixed(label))
    expect(footer().textContent).toBe('')
    expect(fixed(label).hasAttribute('aria-describedby')).toBe(false)
  })

  it('LoRA sets "LoRA: right-click for options"', async () => {
    await enter(fixed('LoRA'))
    expect(footer().textContent).toBe('LoRA: right-click for options')
  })

  it('rows with a menu are described by one hidden static element', () => {
    const ids = [nav('BODY'), nav('POSE'), fixed('LoRA')].map((b) => b.getAttribute('aria-describedby'))
    expect(new Set(ids).size).toBe(1)
    const desc = document.getElementById(ids[0]!)!
    expect(desc.textContent).toBe('Right-click or press Shift+F10 for options')
    expect(desc.className).toContain('sr-only')
    expect(host!.querySelectorAll(`[id="${ids[0]}"]`)).toHaveLength(1)
  })
})
