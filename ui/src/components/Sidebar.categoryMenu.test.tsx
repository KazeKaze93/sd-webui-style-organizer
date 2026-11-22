/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DragControls } from 'framer-motion'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
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

describe('Sidebar category rows and the category menu', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let setCategory: ReturnType<typeof vi.fn>
  let setCategoryOrder: ReturnType<typeof vi.fn>
  let dragStart: ReturnType<typeof vi.spyOn>

  const rowEl = (cat: string) => host!.querySelector<HTMLElement>(`[data-sg-category-row="${cat}"]`)!
  const nav = (cat: string) => rowEl(cat).querySelector<HTMLButtonElement>('button:not([data-sg-category-options])')!
  const count = (cat: string) => rowEl(cat).querySelector<HTMLElement>('[data-sg-category-count]')!
  const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
  /** The menu's direct children as kinds, in order. */
  const menuShape = () =>
    [...menu()!.children].map((el) => {
      if (el.getAttribute('role') === 'menuitem') {
        const lines = [...el.querySelectorAll('span.text-sm, span.text-xs')].map((s) => s.textContent)
        return lines.length ? `item:${lines.join(' / ')}` : `item:${el.textContent?.trim()}`
      }
      if (el.className.includes('border-t')) return 'divider'
      return `heading:${el.textContent}`
    })
  const fire = async (el: HTMLElement, event: Event) => {
    await act(async () => {
      el.dispatchEvent(event)
    })
  }
  const contextMenu = (init: MouseEventInit) =>
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...init })
  const pointer = (type: string, init: MouseEventInit = {}) =>
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20, ...init })
  const stubRect = (el: HTMLElement, left: number, bottom: number) => {
    el.getBoundingClientRect = () =>
      ({ left, top: bottom - 30, right: left + 140, bottom, width: 140, height: 30, x: left, y: bottom - 30, toJSON: () => ({}) }) as DOMRect
  }

  beforeEach(async () => {
    __resetLayerStackForTests()
    setCategory = vi.fn()
    setCategoryOrder = vi.fn()
    dragStart = vi.spyOn(DragControls.prototype, 'start').mockImplementation(() => {})
    localStorage.clear()
    useStylesStore.setState({
      styles: [row('BODY_A', 'BODY'), row('BODY_B', 'BODY'), row('POSE_A', 'POSE'), row('detail', 'LoRA', LORA_SOURCE)],
      activeCategory: null,
      activeSource: null,
      categoryOrder: [],
      favorites: new Set(),
      presets: {},
      fetchPresets: async () => {},
      setCategory,
      setCategoryOrder,
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
    dragStart.mockRestore()
    __resetLayerStackForTests()
  })

  it('fixed entries are All, Favorites, LoRA and Presets (no Recent)', () => {
    const list = rowEl('BODY').closest('[data-sg-category-row]')!.parentElement!.parentElement!
    const fixedLabels = [...list.children]
      .filter((el) => el.tagName === 'BUTTON')
      .map((b) => (b.textContent ?? '').replace(/\d+$/, ''))
    expect(fixedLabels).toEqual(['All', 'Favorites', 'LoRA', 'Presets'])
    expect(host!.textContent).not.toContain('Recent')
  })

  it('rows render no ⋯ button; the count is always visible', () => {
    expect(host!.querySelectorAll('[data-sg-category-options]')).toHaveLength(0)
    expect(host!.querySelector('button[aria-label$=" options"]')).toBeNull()
    for (const cat of ['BODY', 'POSE']) {
      expect(rowEl(cat).querySelectorAll('button')).toHaveLength(1)
      expect(count(cat).className).not.toMatch(/invisible|group-hover|focus-visible/)
    }
    expect(count('BODY').textContent).toBe('2')
    expect([...host!.querySelectorAll('[data-sg-category-row]')].map((r) => r.getAttribute('data-sg-category-row'))).toEqual(['BODY', 'POSE'])
  })

  it('pressing the nav button starts the drag', async () => {
    await fire(nav('BODY'), pointer('pointerdown'))
    expect(dragStart).toHaveBeenCalledOnce()
  })

  it('a plain click on the nav button selects once and does not reorder', async () => {
    await fire(nav('POSE'), pointer('pointerdown'))
    await fire(nav('POSE'), pointer('pointerup'))
    await fire(nav('POSE'), new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(setCategory).toHaveBeenCalledOnce()
    expect(setCategory).toHaveBeenCalledWith('POSE')
    expect(setCategoryOrder).not.toHaveBeenCalled()
    expect(menu()).toBeNull()
  })

  it('right-click (button 2) on the row opens the same menu at the cursor', async () => {
    stubRect(nav('POSE'), 10, 200)
    await fire(nav('POSE'), contextMenu({ button: 2, clientX: 60, clientY: 70 }))
    expect(menu()!.style.left).toBe('60px')
    expect(menu()!.style.top).toBe('70px')
    expect(menuShape()).toEqual([
      'heading:Wildcard from POSE',
      'item:Random / whole category, may repeat',
      'item:Shuffle / whole category, no repeats in a batch',
      'item:Pick styles… / choose Random or Shuffle in the bar',
      'divider',
      'item:Generate previews…',
    ])
    expect(rowEl('POSE').getAttribute('data-sg-menu-open')).toBe('true')
    expect(setCategory).not.toHaveBeenCalled()
  })

  it('keyboard contextmenu (button 0) anchors under the nav button, even with non-zero coordinates', async () => {
    stubRect(nav('POSE'), 10, 200)
    await fire(nav('POSE'), contextMenu({ button: 0, clientX: 33, clientY: 44 }))
    expect(menu()!.style.left).toBe('10px')
    expect(menu()!.style.top).toBe('204px')
  })

  it('keyboard contextmenu at 0, 0 anchors under the nav button', async () => {
    stubRect(nav('POSE'), 12, 120)
    await fire(nav('POSE'), contextMenu({ button: 0, clientX: 0, clientY: 0 }))
    expect(menu()!.style.left).toBe('12px')
    expect(menu()!.style.top).toBe('124px')
  })

  it('Escape closes the menu and returns focus to the nav button', async () => {
    nav('POSE').focus()
    await fire(nav('POSE'), contextMenu({ button: 0 }))
    expect(menu()).not.toBeNull()
    act(() => {
      expect(closeTopLayer()).toBe(true)
    })
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(nav('POSE'))
  })

  it('LoRA keeps its right-click menu, without Generate previews', async () => {
    const lora = [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.startsWith('LoRA'))!
    await fire(lora, contextMenu({ button: 2, clientX: 5, clientY: 5 }))
    expect(menuShape()).toEqual([
      'heading:Wildcard from LoRA',
      'item:Random / whole category, may repeat',
      'item:Shuffle / whole category, no repeats in a batch',
      'item:Pick styles… / choose Random or Shuffle in the bar',
    ])
  })
})
