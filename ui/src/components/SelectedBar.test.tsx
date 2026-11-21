/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, type Style, type WildcardRef } from '../bridge'
import { __resetLayerStackForTests, closeTopLayer, hasOpenLayer } from '../lib/layerStack'
import { styleRowKey, useStylesStore } from '../store/stylesStore'
import { BottomPanel } from './BottomPanel'
import { GRID_MIN_VISIBLE_CARD_ROWS, cardRowHeightPx, gridMinVisibleHeightPx, headerRowHeightPx } from './grid/constants'
import { SelectedBar } from './SelectedBar'
import { CHIP_DRAG_ACTIVATION_DISTANCE_PX } from './SortableChips'
import { TRAY_CHIPS_MIN_HEIGHT_PX, TRAY_MAX_HEIGHT_RATIO } from './trayLayout'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const sendToHostMock = vi.mocked(sendToHost)

/** Chips are laid out three per row, so the lists wrap like the real tray. */
const CHIPS_PER_ROW = 3
const CHIP_W = 90
const CHIP_H = 24
const COL_STEP = 100
const ROW_STEP = 30

function style(name: string): Style {
  return {
    name,
    source_file: 'webui/a.csv',
    prompt: `p:${name}`,
    negative_prompt: '',
    description: '',
    category: 'BODY',
    has_thumbnail: false,
  }
}

function setSelection(styles: Style[], wildcards: WildcardRef[] = []) {
  useStylesStore.setState({
    styles,
    selectedStyles: styles,
    selectedKeySet: new Set(styles.map(styleRowKey)),
    activeWildcards: wildcards,
    conflicts: [],
    activeSource: null,
  })
}

function reorderCalls(type: 'SG_REORDER_STYLES' | 'SG_REORDER_WILDCARDS') {
  return sendToHostMock.mock.calls.map(([msg]) => msg).filter((msg) => msg.type === type)
}

describe('selection tray', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const list = (label: string) => host!.querySelector<HTMLElement>(`[role="list"][aria-label="${label}"]`)!
  const chipsIn = (label: string) => [...list(label).querySelectorAll<HTMLElement>('[data-sg-chip]')]
  const labelsIn = (label: string) => chipsIn(label).map((c) => c.getAttribute('aria-label'))
  const center = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }

  const settle = async (ms = 30) => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms))
    })
  }

  const pointer = async (type: string, target: EventTarget, x: number, y: number) => {
    await act(async () => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pointerId: 1,
          isPrimary: true,
        }),
      )
    })
    await settle()
  }

  const key = async (target: EventTarget, code: string) => {
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true }),
      )
    })
    await settle()
  }

  /** Press on `from`, travel past the activation distance, release over `to`. */
  const dragChip = async (from: HTMLElement, to: HTMLElement) => {
    const a = center(from)
    const b = center(to)
    await pointer('pointerdown', from, a.x, a.y)
    await pointer('pointermove', document, a.x + CHIP_DRAG_ACTIVATION_DISTANCE_PX + 2, a.y)
    await pointer('pointermove', document, b.x, b.y)
    await pointer('pointermove', document, b.x + 1, b.y)
    await pointer('pointerup', document, b.x + 1, b.y)
  }

  async function render(node: React.ReactNode) {
    await act(async () => {
      root!.render(node)
    })
    await settle()
  }

  beforeEach(() => {
    __resetLayerStackForTests()
    sendToHostMock.mockClear()

    // jsdom 26 has neither PointerEvent nor scrollIntoView.
    if (typeof globalThis.PointerEvent === 'undefined') {
      class PointerEventPolyfill extends MouseEvent {
        pointerId: number
        isPrimary: boolean
        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init)
          this.pointerId = init.pointerId ?? 0
          this.isPrimary = init.isPrimary ?? false
        }
      }
      vi.stubGlobal('PointerEvent', PointerEventPolyfill)
    }
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value() {},
    })

    // No layout in jsdom: place each chip by its index inside its own list.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      let left = 0
      let top = 0
      let width = 0
      let height = 0
      if (this.hasAttribute('data-sg-chip')) {
        const siblings = [...this.parentElement!.querySelectorAll('[data-sg-chip]')]
        const index = siblings.indexOf(this)
        const listOffset = this.parentElement!.getAttribute('aria-label') === 'active wildcards' ? 300 : 0
        left = (index % CHIPS_PER_ROW) * COL_STEP
        top = listOffset + Math.floor(index / CHIPS_PER_ROW) * ROW_STEP
        width = CHIP_W
        height = CHIP_H
      }
      return {
        x: left,
        y: top,
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        toJSON() {
          return {}
        },
      }
    })

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    host?.remove()
    host = null
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
    __resetLayerStackForTests()
  })

  const five = () => ['BODY_A', 'BODY_B', 'BODY_C', 'BODY_D', 'BODY_E'].map(style)
  const wildcards = (): WildcardRef[] => [
    { category: 'lighting', spec: '' },
    { category: 'pose', spec: '' },
    { category: 'mood', spec: '' },
  ]

  it('pointer drag reorders style chips and emits SG_REORDER_STYLES in the new order', async () => {
    const styles = five()
    setSelection(styles)
    await render(<SelectedBar />)
    expect(labelsIn('selected styles')).toEqual(['A', 'B', 'C', 'D', 'E'])

    const chips = chipsIn('selected styles')
    await dragChip(chips[0], chips[2])

    expect(labelsIn('selected styles')).toEqual(['B', 'C', 'A', 'D', 'E'])
    const calls = reorderCalls('SG_REORDER_STYLES')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      type: 'SG_REORDER_STYLES',
      styleIds: [styles[1], styles[2], styles[0], styles[3], styles[4]].map(styleRowKey),
    })
  })

  it('pointer drag works across wrapped rows', async () => {
    const styles = five()
    setSelection(styles)
    await render(<SelectedBar />)

    // Chip 0 is on the first row, chip 4 on the second.
    const chips = chipsIn('selected styles')
    expect(chips[4].getBoundingClientRect().top).toBeGreaterThan(chips[0].getBoundingClientRect().top)
    await dragChip(chips[0], chips[4])

    expect(labelsIn('selected styles')).toEqual(['B', 'C', 'D', 'E', 'A'])
    expect(reorderCalls('SG_REORDER_STYLES')).toHaveLength(1)
  })

  it('keyboard reorders style chips: Space, ArrowRight, Space', async () => {
    const styles = five()
    setSelection(styles)
    await render(<SelectedBar />)

    const first = chipsIn('selected styles')[0]
    act(() => first.focus())
    await key(first, 'Space')
    expect(host!.querySelector('[data-dragging="true"]')).not.toBeNull()
    await key(document, 'ArrowRight')
    await key(document, 'Space')

    expect(labelsIn('selected styles')).toEqual(['B', 'A', 'C', 'D', 'E'])
    const calls = reorderCalls('SG_REORDER_STYLES')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      type: 'SG_REORDER_STYLES',
      styleIds: [styles[1], styles[0], styles[2], styles[3], styles[4]].map(styleRowKey),
    })
  })

  it('keyboard ArrowDown moves a chip to the next wrapped row', async () => {
    setSelection(five())
    await render(<SelectedBar />)

    const first = chipsIn('selected styles')[0]
    act(() => first.focus())
    await key(first, 'Space')
    await key(document, 'ArrowDown')
    await key(document, 'Space')

    // Row 2 starts at index 3: A lands in D's place.
    expect(labelsIn('selected styles')).toEqual(['B', 'C', 'D', 'A', 'E'])
  })

  it('wildcard chips reorder by pointer and by keyboard and emit SG_REORDER_WILDCARDS', async () => {
    const refs = wildcards()
    setSelection([], refs)
    await render(<SelectedBar />)
    expect(labelsIn('active wildcards')).toEqual(['lighting', 'pose', 'mood'])

    let chips = chipsIn('active wildcards')
    await dragChip(chips[0], chips[2])
    expect(labelsIn('active wildcards')).toEqual(['pose', 'mood', 'lighting'])
    expect(reorderCalls('SG_REORDER_WILDCARDS')).toEqual([
      { type: 'SG_REORDER_WILDCARDS', categories: [refs[1], refs[2], refs[0]] },
    ])

    chips = chipsIn('active wildcards')
    act(() => chips[0].focus())
    await key(chips[0], 'Space')
    await key(document, 'ArrowRight')
    await key(document, 'Space')
    expect(labelsIn('active wildcards')).toEqual(['mood', 'pose', 'lighting'])
    expect(reorderCalls('SG_REORDER_WILDCARDS')).toHaveLength(2)
    expect(reorderCalls('SG_REORDER_WILDCARDS')[1]).toEqual({
      type: 'SG_REORDER_WILDCARDS',
      categories: [refs[2], refs[1], refs[0]],
    })
    // Styles and wildcards are separate lists: no cross-talk.
    expect(reorderCalls('SG_REORDER_STYLES')).toHaveLength(0)
  })

  it('remove button: a press that travels past the drag distance never starts a drag; click removes the chip', async () => {
    setSelection(five())
    await render(<SelectedBar />)

    const remove = chipsIn('selected styles')[0].querySelector<HTMLElement>('button[aria-label="Remove BODY_A"]')!
    await pointer('pointerdown', remove, 80, 12)
    await pointer('pointermove', document, 80 + CHIP_DRAG_ACTIVATION_DISTANCE_PX * 5, 12)
    await pointer('pointermove', document, 250, 12)
    expect(host!.querySelector('[data-dragging="true"]')).toBeNull()
    await pointer('pointerup', document, 250, 12)
    expect(reorderCalls('SG_REORDER_STYLES')).toHaveLength(0)
    expect(labelsIn('selected styles')).toEqual(['A', 'B', 'C', 'D', 'E'])

    await act(async () => {
      remove.click()
    })
    await settle()
    expect(labelsIn('selected styles')).toEqual(['B', 'C', 'D', 'E'])
    expect(reorderCalls('SG_REORDER_STYLES')).toHaveLength(0)
  })

  it('a click on a chip (no travel) does not start a drag or reorder', async () => {
    setSelection(five())
    await render(<SelectedBar />)
    const chip = chipsIn('selected styles')[1]
    const c = center(chip)
    await pointer('pointerdown', chip, c.x, c.y)
    await pointer('pointermove', document, c.x + CHIP_DRAG_ACTIVATION_DISTANCE_PX - 2, c.y)
    await pointer('pointerup', document, c.x + CHIP_DRAG_ACTIVATION_DISTANCE_PX - 2, c.y)
    expect(labelsIn('selected styles')).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(reorderCalls('SG_REORDER_STYLES')).toHaveLength(0)
  })

  it('Escape while a chip is held cancels the reorder through the layer stack, not the panel', async () => {
    setSelection(five())
    await render(<SelectedBar />)
    const first = chipsIn('selected styles')[0]
    act(() => first.focus())
    expect(hasOpenLayer()).toBe(false)
    await key(first, 'Space')
    await key(document, 'ArrowRight')
    // App's Escape handler closes the top layer first; the held chip is that layer.
    expect(hasOpenLayer()).toBe(true)
    await act(async () => {
      closeTopLayer()
    })
    await settle()

    expect(host!.querySelector('[data-dragging="true"]')).toBeNull()
    expect(hasOpenLayer()).toBe(false)
    expect(labelsIn('selected styles')).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(reorderCalls('SG_REORDER_STYLES')).toHaveLength(0)
  })

  it('Delete on a focused chip still removes it', async () => {
    setSelection(five())
    await render(<SelectedBar />)
    const chip = chipsIn('selected styles')[2]
    act(() => chip.focus())
    await act(async () => {
      chip.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true, cancelable: true }),
      )
    })
    await settle()
    expect(labelsIn('selected styles')).toEqual(['A', 'B', 'D', 'E'])
  })

  it('with 133 chips the tray is height-capped, chips scroll inside it, header and Save set stay outside the scroll', async () => {
    const many = Array.from({ length: 133 }, (_, i) => style(`BODY_S${i}`))
    setSelection(many)
    await render(<BottomPanel />)

    const tray = host!.querySelector<HTMLElement>('[data-sg-tray]')!
    const scroll = host!.querySelector<HTMLElement>('[data-sg-tray-scroll]')!
    const header = host!.querySelector<HTMLElement>('[data-sg-tray-header]')!

    expect(TRAY_MAX_HEIGHT_RATIO).toBe(0.35)
    expect(tray.style.maxHeight).toBe('35vh')
    expect(tray.className).toContain('overflow-hidden')
    expect(tray.className).toContain('flex-col')

    expect(scroll.className).toContain('overflow-y-auto')
    expect(scroll.style.minHeight).toBe(`${TRAY_CHIPS_MIN_HEIGHT_PX}px`)
    expect(scroll.querySelectorAll('[data-sg-chip]')).toHaveLength(133)

    expect(header.className).toContain('shrink-0')
    expect(scroll.contains(header)).toBe(false)
    expect(header.textContent).toContain('133 selected')
    expect(header.textContent).toContain('Save set (133)')
  })

  it('grid minimum is a header plus two card rows and fits beside a capped tray in the smallest panel', () => {
    expect(GRID_MIN_VISIBLE_CARD_ROWS).toBe(2)
    for (const windowed of [false, true]) {
      expect(gridMinVisibleHeightPx(windowed)).toBe(
        headerRowHeightPx() + 2 * cardRowHeightPx(windowed),
      )
    }
    // Smallest windowed panel is 400px tall (host min-height). The header is one
    // row: py-2.5 (20) + h-9 controls (36) + border-b (1).
    const PANEL_MIN_H = 400
    const HEADER_ONE_ROW = 57
    const GRID_PAD_TOP = 12
    const trayMax = PANEL_MIN_H * TRAY_MAX_HEIGHT_RATIO
    expect(HEADER_ONE_ROW + trayMax + GRID_PAD_TOP + gridMinVisibleHeightPx(true)).toBeLessThanOrEqual(
      PANEL_MIN_H,
    )
  })

  const trayHeader = () => host!.querySelector<HTMLElement>('[data-sg-tray-header]')
  const trayButton = (text: string) =>
    [...(trayHeader()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === text) ?? null

  it('Clear sits before Save set and posts SG_CLEAR_ALL to the host', async () => {
    setSelection([style('BODY_A')])
    await render(<SelectedBar />)
    const clear = trayButton('Clear')!
    expect(clear).not.toBeNull()
    expect(clear.getAttribute('aria-label')).toBe('Clear all selected styles and wildcards')
    const buttons = [...trayHeader()!.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons.indexOf('Clear')).toBe(buttons.indexOf('Save set (1)') - 1)

    await act(async () => clear.click())
    expect(sendToHostMock.mock.calls.map(([m]) => m)).toEqual([{ type: 'SG_CLEAR_ALL' }])
  })

  it('with wildcards only, the tray header shows Clear but no Save set and no count', async () => {
    setSelection([], [{ category: 'lighting', spec: '' }])
    await render(<SelectedBar />)
    expect(trayHeader()).not.toBeNull()
    expect(trayButton('Clear')).not.toBeNull()
    expect([...trayHeader()!.querySelectorAll('button')].some((b) => /Save set/.test(b.textContent ?? ''))).toBe(false)
    expect(trayHeader()!.textContent).not.toContain('selected')
  })
})
