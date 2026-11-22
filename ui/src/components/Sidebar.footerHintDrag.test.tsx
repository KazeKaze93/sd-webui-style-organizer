/** @vitest-environment jsdom */
import { act, useEffect, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { useStylesStore } from '../store/stylesStore'
import { Sidebar } from './Sidebar'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

/**
 * jsdom cannot run a real framer drag. Stand-in Reorder.Item: fires the row's
 * onDragStart / onDragEnd on test events, so the sidebar's own dragging state
 * is what keeps the footer empty.
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

describe('sidebar footer hint while dragging', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const footer = () => host!.querySelector<HTMLElement>('[data-sg-sidebar-hint]')!
  const rowEl = (cat: string) => host!.querySelector<HTMLElement>(`[data-sg-category-row="${cat}"]`)!
  const nav = (cat: string) => rowEl(cat).querySelector<HTMLButtonElement>('button')!
  const enter = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('pointerenter', { bubbles: false }))
    })
  }
  const fire = async (type: string) => {
    await act(async () => {
      rowEl('BODY').dispatchEvent(new Event(type))
    })
  }

  beforeEach(async () => {
    __resetLayerStackForTests()
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

  it('stays empty while a row is dragged and comes back after the drop', async () => {
    await enter(nav('BODY'))
    expect(footer().textContent).toBe('BODY: right-click for options')
    await fire('sg-test-dragstart')
    expect(footer().textContent).toBe('')
    await enter(nav('POSE'))
    expect(footer().textContent).toBe('')
    await fire('sg-test-dragend')
    expect(footer().textContent).toBe('POSE: right-click for options')
  })
})
