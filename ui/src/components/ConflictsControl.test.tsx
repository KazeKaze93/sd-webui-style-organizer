/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, type Style } from '../bridge'
import { __resetLayerStackForTests, closeTopLayer, hasOpenLayer, useLayer } from '../lib/layerStack'
import { styleRowKey, useStylesStore } from '../store/stylesStore'
import { BottomPanel } from './BottomPanel'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const style = (name: string, prompt: string, negative_prompt = ''): Style => ({
  name,
  source_file: 'webui/a.csv',
  prompt,
  negative_prompt,
  description: '',
  category: 'BODY',
})

// A's negative prompt removes B's tag (one way); C and D remove each other's (both ways).
const A = style('BODY_Alpha', 'alpha', 'beta tag')
const B = style('BODY_Beta', 'beta tag')
const C = style('BODY_Gamma', 'gamma', 'delta')
const D = style('BODY_Delta', 'delta', 'gamma')
const ALL = [A, B, C, D]

const outerClose = vi.fn()
/** An outer layer (like an open dialog) under the popover. */
function OuterLayer() {
  useLayer(true, outerClose)
  return null
}

describe('conflicts popover', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const trigger = () => document.querySelector<HTMLButtonElement>('[data-sg-conflicts-trigger]')
  const popover = () => document.querySelector<HTMLElement>('[data-sg-conflicts-popover]')
  const cards = () => [...(popover()?.querySelectorAll<HTMLElement>('[data-sg-conflict-pair]') ?? [])]
  const buttonIn = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!
  const tray = () => document.querySelector<HTMLElement>('[data-sg-tray]')!
  const chip = (s: Style) =>
    document.querySelector<HTMLElement>(`[role="list"][aria-label="selected styles"] [data-sg-chip][aria-label="${s.name.split('_')[1]}"]`)!

  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
  const click = async (el: HTMLElement) => {
    await act(async () => el.click())
    await settle()
  }
  const open = async () => {
    trigger()!.focus()
    await click(trigger()!)
    expect(popover()).not.toBeNull()
  }

  beforeEach(async () => {
    __resetLayerStackForTests()
    outerClose.mockClear()
    vi.mocked(sendToHost).mockClear()
    localStorage.clear()
    useStylesStore.setState({
      styles: ALL,
      duplicatesByName: new Map(ALL.map((s) => [s.name, [s]])),
      selectedStyles: [],
      selectedKeySet: new Set(),
      selectedCountByCategory: new Map(),
      conflicts: [],
      dismissedConflictPairs: new Set(),
      activeWildcards: [],
      activeSource: null,
      styleContributors: {},
    })
    for (const s of ALL) useStylesStore.getState().toggleStyle(s)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <>
          <OuterLayer />
          <BottomPanel />
        </>,
      )
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
    __resetLayerStackForTests()
    vi.useRealTimers()
  })

  it('trigger: "2 conflicts", amber token, 12 px icon, dialog popup, no pulse', () => {
    const t = trigger()!
    expect(t.textContent).toBe('2 conflicts')
    expect(t.getAttribute('aria-label')).toBe('2 style conflicts')
    expect(t.getAttribute('aria-haspopup')).toBe('dialog')
    expect(t.getAttribute('aria-expanded')).toBe('false')
    expect(t.className).toContain('text-sg-warning-text')
    expect(t.className).toContain('border-sg-warning-text/50')
    expect(t.className).toContain('bg-sg-warning-text/[0.14]')
    expect(t.className).not.toContain('animate-pulse')
    expect(t.querySelector('svg')!.getAttribute('width')).toBe('12')
  })

  it('popover: header and one card per pair; the two-way pair is one ↔ card', async () => {
    await open()
    expect(trigger()!.getAttribute('aria-expanded')).toBe('true')
    expect(popover()!.textContent).toContain('2 conflicts in your selection')
    expect(popover()!.textContent).toContain("a style's negative prompt removes another's tags")
    expect(popover()!.className).toContain('min-w-[18rem]')
    expect(popover()!.className).toContain('max-w-[min(28rem,calc(100vw-2.5rem))]')
    expect(popover()!.className).toContain('max-h-[60vh]')
    const [one, both] = cards()
    expect(cards()).toHaveLength(2)
    expect(one.getAttribute('data-sg-conflict-pair')).toBe('one')
    expect(one.textContent).toContain("Alpha's negative prompt cancels tags from Beta.")
    expect(one.querySelector('svg.lucide-arrow-right')).not.toBeNull()
    expect(both.getAttribute('data-sg-conflict-pair')).toBe('both')
    expect(both.textContent).toContain("Each style's negative prompt cancels tags from the other.")
    expect(both.querySelector('svg.lucide-arrow-left-right')).not.toBeNull()
    expect(buttonIn(one, 'Remove Alpha').getAttribute('title')).toBe('Remove Alpha')
    expect(buttonIn(one, 'Remove Alpha').className).toContain('truncate')
  })

  it('Remove A / Remove B: same toggle as the chip ✕; stays open while pairs remain; last one moves focus to the tray', async () => {
    const original = useStylesStore.getState().toggleStyle
    const toggle = vi.fn((s: Style) => original(s))
    await act(async () => useStylesStore.setState({ toggleStyle: toggle }))
    await open()
    await click(buttonIn(cards()[0], 'Remove Beta'))
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(toggle).toHaveBeenCalledWith(B)
    expect(useStylesStore.getState().selectedStyles.map((s) => s.name)).toEqual(['BODY_Alpha', 'BODY_Gamma', 'BODY_Delta'])
    expect(vi.mocked(sendToHost)).toHaveBeenCalledWith(expect.objectContaining({ type: 'SG_UNAPPLY', styleId: 'BODY_Beta' }))
    expect(popover()).not.toBeNull()
    expect(trigger()!.textContent).toBe('1 conflict')
    expect(cards()).toHaveLength(1)

    await click(buttonIn(cards()[0], 'Remove Gamma'))
    await settle()
    expect(toggle).toHaveBeenLastCalledWith(C)
    useStylesStore.setState({ toggleStyle: original })
    expect(popover()).toBeNull()
    expect(trigger()).toBeNull()
    expect(document.activeElement).toBe(tray())
    expect(tray().getAttribute('aria-label')).toBe('Selection')
    expect(tray().tabIndex).toBe(-1)
  })

  it('Keep both hides the pair, decrements the count, drops the chip borders; the last one moves focus to the tray', async () => {
    await open()
    for (const s of ALL) expect(chip(s).className).toContain('border-sg-warning-text/60')
    await click(buttonIn(cards()[0], 'Keep both'))
    expect(trigger()!.textContent).toBe('1 conflict')
    expect(popover()).not.toBeNull()
    expect(chip(A).className).not.toContain('border-sg-warning-text/60')
    expect(chip(B).className).not.toContain('border-sg-warning-text/60')
    expect(chip(C).className).toContain('border-sg-warning-text/60')

    await click(buttonIn(cards()[0], 'Keep both'))
    await settle()
    expect(popover()).toBeNull()
    expect(trigger()).toBeNull()
    expect(document.activeElement).toBe(tray())
    expect(useStylesStore.getState().selectedStyles).toHaveLength(4)
    for (const s of ALL) expect(chip(s).className).not.toContain('border-sg-warning-text/60')
  })

  it('Enter and Space on the focused tray change nothing', async () => {
    await open()
    await click(buttonIn(cards()[0], 'Keep both'))
    await click(buttonIn(cards()[0], 'Keep both'))
    await settle()
    expect(document.activeElement).toBe(tray())
    vi.mocked(sendToHost).mockClear()
    for (const key of ['Enter', ' ']) {
      await act(async () => {
        tray().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
        tray().dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
      })
    }
    expect(useStylesStore.getState().selectedStyles).toHaveLength(4)
    expect(vi.mocked(sendToHost).mock.calls.some(([m]) => m.type === 'SG_CLEAR_ALL')).toBe(false)
  })

  it('Escape with pairs remaining closes only the popover and returns focus to the trigger', async () => {
    await open()
    act(() => {
      expect(closeTopLayer()).toBe(true)
    })
    await settle()
    expect(popover()).toBeNull()
    expect(outerClose).not.toHaveBeenCalled()
    expect(hasOpenLayer()).toBe(true)
    expect(document.activeElement).toBe(trigger())
  })

  it('no visible pairs: no trigger; a chip is amber only while its pair is visible', async () => {
    const keyA = styleRowKey(A)
    await act(async () => {
      useStylesStore.getState().dismissConflictPair(keyA, styleRowKey(B))
      useStylesStore.getState().dismissConflictPair(styleRowKey(C), styleRowKey(D))
    })
    expect(trigger()).toBeNull()
    await act(async () => {
      useStylesStore.getState().toggleStyle(B) // B leaves: the A–B dismissal is dropped
      useStylesStore.getState().toggleStyle(B) // B is back: the pair shows again
    })
    expect(trigger()!.textContent).toBe('1 conflict')
    expect(chip(A).className).toContain('border-sg-warning-text/60')
    expect(chip(C).className).not.toContain('border-sg-warning-text/60')
  })
})
