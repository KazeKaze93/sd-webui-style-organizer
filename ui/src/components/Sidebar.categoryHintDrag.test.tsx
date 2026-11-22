/** @vitest-environment jsdom */
import { act, useEffect, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { __resetFocusSourceForTests } from '../lib/focusSource'
import { HOVER_POPUP_SHOW_DELAY_MS } from '../lib/hoverIntent'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { useStylesStore } from '../store/stylesStore'
import { Sidebar } from './Sidebar'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

/**
 * jsdom cannot run a real framer drag, and a real pointerdown already closes a
 * Radix tooltip by itself. Stand-in Reorder.Item: fires the row's
 * onDragStart / onDragEnd on test events, so only the row's own "dragging"
 * state can keep the hint closed.
 */
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  type ItemProps = {
    children?: ReactNode
    className?: string
    onDragStart?: () => void
    onDragEnd?: () => void
    [key: string]: unknown
  }
  function Item({ children, className, onDragStart, onDragEnd, ...rest }: ItemProps) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
      const el = ref.current!
      const start = () => onDragStart?.()
      const end = () => onDragEnd?.()
      el.addEventListener('sg-test-dragstart', start)
      el.addEventListener('sg-test-dragend', end)
      return () => {
        el.removeEventListener('sg-test-dragstart', start)
        el.removeEventListener('sg-test-dragend', end)
      }
    }, [onDragStart, onDragEnd])
    const dataProps = Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('data-')))
    return (
      <div ref={ref} className={className} {...dataProps}>
        {children}
      </div>
    )
  }
  function Group({ children, className }: { children?: ReactNode; className?: string }) {
    return <div className={className}>{children}</div>
  }
  return { ...actual, Reorder: { Group, Item }, useDragControls: () => ({ start: () => {} }) }
})

const row = (name: string, category: string): Style => ({
  name,
  source_file: 'webui/a.csv',
  prompt: name,
  negative_prompt: '',
  description: '',
  category,
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('sidebar category hint while dragging', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const rowEl = (cat: string) => host!.querySelector<HTMLElement>(`[data-sg-category-row="${cat}"]`)!
  const nav = (cat: string) => rowEl(cat).querySelector<HTMLButtonElement>('button')!
  const hint = () => document.querySelector<HTMLElement>('[data-sg-category-hint]')
  const hover = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('pointerenter', { bubbles: false }))
      el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
      await wait(HOVER_POPUP_SHOW_DELAY_MS + 60)
    })
  }
  const unhover = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }))
      el.dispatchEvent(new MouseEvent('pointerleave', { bubbles: false }))
      await wait(20)
    })
  }
  const fire = async (type: string) => {
    await act(async () => {
      rowEl('BODY').dispatchEvent(new Event(type))
    })
  }

  beforeEach(async () => {
    __resetLayerStackForTests()
    __resetFocusSourceForTests()
    useStylesStore.setState({
      styles: [row('BODY_A', 'BODY'), row('POSE_A', 'POSE')],
      activeCategory: null,
      activeSource: null,
      categoryOrder: [],
      favorites: new Set(),
      recentNames: [],
      presets: {},
      fetchPresets: async () => {},
      setCategoryOrder: () => {},
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
    __resetLayerStackForTests()
  })

  it('no hint while the row is dragged; it comes back after the drop', async () => {
    await fire('sg-test-dragstart')
    await hover(nav('BODY'))
    expect(hint()).toBeNull()
    await unhover(nav('BODY'))

    await fire('sg-test-dragend')
    await hover(nav('BODY'))
    expect(hint()).not.toBeNull()
  })
})
