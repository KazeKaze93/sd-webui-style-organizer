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

describe('Sidebar category rows: ⋯ and the category menu', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let setCategory: ReturnType<typeof vi.fn>
  let setCategoryOrder: ReturnType<typeof vi.fn>
  let dragStart: ReturnType<typeof vi.spyOn>

  const rowEl = (cat: string) => host!.querySelector<HTMLElement>(`[data-sg-category-row="${cat}"]`)!
  const nav = (cat: string) => rowEl(cat).querySelector<HTMLButtonElement>('button:not([data-sg-category-options])')!
  const dots = (cat: string) => rowEl(cat).querySelector<HTMLButtonElement>('[data-sg-category-options]')!
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
      recentNames: [],
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

  it('⋯ sits next to the nav button (not nested) and shows on hover / focus-within in the count slot', () => {
    expect(nav('BODY').contains(dots('BODY'))).toBe(false)
    expect(dots('BODY').getAttribute('aria-label')).toBe('BODY options')
    expect(dots('BODY').getAttribute('aria-haspopup')).toBe('menu')
    expect(dots('BODY').getAttribute('aria-expanded')).toBe('false')
    expect(rowEl('BODY').className).toContain('group')
    // Hidden by opacity, never display:none, so the menu can return focus to it.
    expect(dots('BODY').className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(dots('BODY').className).toContain('opacity-0')
    expect(dots('BODY').className).toContain('group-hover:opacity-100')
    expect(dots('BODY').className).toContain('group-focus-within:opacity-100')
    expect(count('BODY').textContent).toBe('2')
    expect(count('BODY').className).toContain('group-hover:invisible')
    expect(count('BODY').className).toContain('group-focus-within:invisible')
  })

  it('fixed entries (All, Favorites, Recent, LoRA, Presets) have no ⋯', () => {
    expect(host!.querySelectorAll('[data-sg-category-options]').length).toBe(2) // BODY, POSE
    expect([...host!.querySelectorAll('[data-sg-category-row]')].map((r) => r.getAttribute('data-sg-category-row'))).toEqual(['BODY', 'POSE'])
  })

  it('clicking ⋯ opens the menu under the button with exactly the planned items', async () => {
    stubRect(dots('BODY'), 150, 80)
    await fire(dots('BODY'), new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(menu()).not.toBeNull()
    expect(menu()!.style.left).toBe('150px')
    expect(menu()!.style.top).toBe('84px')
    expect(menuShape()).toEqual([
      'heading:Wildcard from BODY',
      'item:Random / whole category, may repeat',
      'item:Shuffle / whole category, no repeats in a batch',
      'item:Pick styles… / choose Random or Shuffle in the bar',
      'divider',
      'item:Generate previews…',
    ])
    expect(dots('BODY').getAttribute('aria-expanded')).toBe('true')
    // While open, ⋯ stays visible and the count stays hidden.
    expect(dots('BODY').className).not.toContain('opacity-0')
    expect(count('BODY').className).toContain('invisible')
  })

  it('clicking ⋯ neither selects the category nor reorders', async () => {
    await fire(dots('BODY'), pointer('pointerdown'))
    await fire(dots('BODY'), pointer('pointerup'))
    await fire(dots('BODY'), new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(menu()).not.toBeNull()
    expect(setCategory).not.toHaveBeenCalled()
    expect(setCategoryOrder).not.toHaveBeenCalled()
  })

  it('pressing ⋯ never starts a drag; pressing the nav button does', async () => {
    await fire(dots('BODY'), pointer('pointerdown'))
    expect(dragStart).not.toHaveBeenCalled()
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
    expect(menuShape()[0]).toBe('heading:Wildcard from POSE')
    expect(menuShape()).toHaveLength(6)
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

  it('Escape closes the menu and returns focus to the opener', async () => {
    dots('BODY').focus()
    await fire(dots('BODY'), new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(menu()).not.toBeNull()
    act(() => {
      expect(closeTopLayer()).toBe(true)
    })
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(dots('BODY'))

    nav('POSE').focus()
    await fire(nav('POSE'), contextMenu({ button: 0 }))
    act(() => {
      closeTopLayer()
    })
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
