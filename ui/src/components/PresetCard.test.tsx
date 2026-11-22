/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WILDCARD_KIND_DECK, type Style } from '../bridge'
import { __resetLayerStackForTests, closeTopLayer } from '../lib/layerStack'
import { styleRowKey, useStylesStore, type PresetRecord } from '../store/stylesStore'
import { PRESET_CHIP_LIMIT, PresetCard } from './PresetCard'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const style = (name: string, source_file = 'webui/a.csv'): Style => ({
  name,
  source_file,
  prompt: name,
  negative_prompt: '',
  description: '',
  category: 'BODY',
})
const TALL = style('BODY_Tall')
const TALL_OTHER_PACK = style('BODY_Tall', 'webui/b.csv')
const MANY = Array.from({ length: 9 }, (_, i) => style(`BODY_S${i + 1}`))

const preset = (over: Partial<PresetRecord> = {}): PresetRecord => ({
  styles: [{ name: 'BODY_Tall', source_file: 'webui/a.csv' }],
  created: '2026-01-01',
  ...over,
})

describe('PresetCard', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let loadPreset: ReturnType<typeof vi.fn<(name: string) => void>>
  let unapplyPreset: ReturnType<typeof vi.fn<(name: string) => void>>

  const card = () => host!.querySelector<HTMLElement>('[data-sg-preset-card]')!
  const applyButton = () => card().querySelector<HTMLButtonElement>('[data-sg-preset-apply]')!
  const chips = (kind?: string) =>
    [...card().querySelectorAll<HTMLElement>(kind ? `[data-sg-preset-chip="${kind}"]` : '[data-sg-preset-chip]')]
  const more = () => card().querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
  const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
  const menuItem = (text: string) =>
    [...(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find((el) => el.textContent?.trim() === text)
  const dialogTitle = () => {
    const d = document.querySelector<HTMLElement>('[role="dialog"]')
    return d ? document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent : null
  }
  const stubRect = (el: HTMLElement, left: number, bottom: number) => {
    el.getBoundingClientRect = () =>
      ({ left, top: bottom - 28, right: left + 28, bottom, width: 28, height: 28, x: left, y: bottom - 28, toJSON: () => ({}) }) as DOMRect
  }
  const contextMenu = async (el: HTMLElement, init: MouseEventInit) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...init }))
    })
  }

  const render = async (p: PresetRecord, selected: Style[] = [], name = 'Tall set') => {
    useStylesStore.setState({
      styles: [TALL, TALL_OTHER_PACK, ...MANY],
      selectedStyles: selected,
      selectedKeySet: new Set(selected.map(styleRowKey)),
      activeWildcards: [],
      loadPreset,
      unapplyPreset,
    } as unknown as Partial<ReturnType<typeof useStylesStore.getState>>)
    await act(async () => {
      root!.render(<PresetCard name={name} preset={p} />)
    })
  }

  beforeEach(() => {
    __resetLayerStackForTests()
    loadPreset = vi.fn<(name: string) => void>()
    unapplyPreset = vi.fn<(name: string) => void>()
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
  })

  describe('applied state', () => {
    it('the same style name selected from a different pack does not mark the preset applied', async () => {
      await render(preset(), [TALL_OTHER_PACK])
      expect(applyButton().textContent).toBe('Apply')
    })

    it('the same style (pack and name) marks it applied', async () => {
      await render(preset(), [TALL])
      expect(applyButton().textContent).toBe('Applied · Remove')
    })

    it('Apply calls loadPreset; Applied · Remove calls unapplyPreset; the applied card is accented', async () => {
      await render(preset())
      expect(applyButton().className).toContain('bg-sg-accent')
      expect(applyButton().className).toContain('text-white')
      expect(applyButton().className).toContain('mt-auto')
      expect(applyButton().title).toBe('Apply this set to the current selection')
      expect(card().className).toContain('border-sg-border')
      await act(async () => applyButton().click())
      expect(loadPreset).toHaveBeenCalledWith('Tall set')

      await render(preset(), [TALL])
      expect(applyButton().className).toContain('border-sg-accent')
      expect(applyButton().className).toContain('bg-transparent')
      expect(applyButton().title).toBe('Remove this set from the current selection')
      expect(card().className).toContain('border-sg-accent')
      expect(card().className).toContain('bg-sg-accent/10')
      await act(async () => applyButton().click())
      expect(unapplyPreset).toHaveBeenCalledWith('Tall set')
    })
  })

  describe('header and chips', () => {
    it('name with title, meta singular / plural, note clamped', async () => {
      await render(preset({ note: 'A note that may be long' }))
      const name = card().querySelector<HTMLElement>('.font-semibold')!
      expect(name.textContent).toBe('Tall set')
      expect(name.title).toBe('Tall set')
      expect(name.className).toContain('truncate')
      expect(card().querySelector('[data-sg-preset-meta]')!.textContent).toBe('1 style')
      const note = card().querySelector<HTMLElement>('[data-sg-preset-note]')!
      expect(note.textContent).toBe('A note that may be long')
      expect(note.className).toContain('line-clamp-2')

      await render(preset({
        styles: [{ name: 'BODY_S1', source_file: 'webui/a.csv' }, { name: 'BODY_S2', source_file: 'webui/a.csv' }],
        wildcards: [{ category: 'pose', spec: '' }],
        note: '  ',
      }))
      expect(card().querySelector('[data-sg-preset-meta]')!.textContent).toBe('2 styles · 1 wildcard')
      expect(card().querySelector('[data-sg-preset-note]')).toBeNull()

      await render(preset({ wildcards: [{ category: 'pose', spec: '' }, { category: 'hair', spec: '' }] }))
      expect(card().querySelector('[data-sg-preset-meta]')!.textContent).toBe('1 style · 2 wildcards')
    })

    it('style chips: display name and "<name> · <pack>" title', async () => {
      await render(preset())
      const [chip] = chips('style')
      expect(chip.textContent).toBe('Tall')
      expect(chip.title).toBe('BODY_Tall · a')
      expect(chip.className).toContain('h-[22px]')
      expect(chip.className).toContain('text-[11px]')
    })

    it('wildcard chips: purple tokens, dice or deck icon', async () => {
      await render(preset({
        wildcards: [{ category: 'pose', spec: '' }, { category: 'hair', spec: 'Long_*', kind: WILDCARD_KIND_DECK }],
      }))
      const [dice, deck] = chips('wildcard')
      expect(dice.className).toContain('bg-sg-wildcard/20')
      expect(dice.className).toContain('border-sg-wildcard/40')
      expect(dice.textContent).toBe('🎲pose')
      expect(dice.querySelector('svg')).toBeNull()
      expect(deck.querySelector('svg')).not.toBeNull()
      expect(deck.textContent).toContain('hair:Long_*')
      expect(deck.title).toBe('hair:Long_* (shuffle)')
    })

    it(`at most ${PRESET_CHIP_LIMIT} chips, then "+K more" expands and "Show less" collapses; missing is extra`, async () => {
      await render(preset({
        styles: [
          ...MANY.map((s) => ({ name: s.name, source_file: s.source_file })),
          { name: 'BODY_Gone', source_file: 'webui/old.csv' },
          { name: 'BODY_Lost', source_file: '' },
        ],
        wildcards: [{ category: 'pose', spec: '' }],
      }))
      expect(chips('style').length + chips('wildcard').length).toBe(PRESET_CHIP_LIMIT)
      const toggle = chips('more')[0] as HTMLButtonElement
      expect(toggle.textContent).toBe('+4 more') // 9 styles + 1 wildcard − 6
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      const missing = chips('missing')
      expect(missing).toHaveLength(1)
      expect(missing[0].textContent).toBe('+2 missing')
      expect(missing[0].className).toContain('border-dashed')
      expect(missing[0].className).toContain('border-sg-warning-text/60')
      expect(missing[0].className).toContain('text-sg-warning-text')
      expect(missing[0].title.split('\n')).toEqual(['Missing: Gone (old)', 'Missing: Lost'])

      await act(async () => toggle.click())
      expect(chips('style').length + chips('wildcard').length).toBe(10)
      expect(chips('more')[0].textContent).toBe('Show less')
      expect(chips('missing')).toHaveLength(1)
      await act(async () => (chips('more')[0] as HTMLButtonElement).click())
      expect(chips('style').length + chips('wildcard').length).toBe(PRESET_CHIP_LIMIT)
    })

    it('no "+K more" at or under the limit', async () => {
      await render(preset({ styles: MANY.slice(0, 6).map((s) => ({ name: s.name, source_file: s.source_file })) }))
      expect(chips('style')).toHaveLength(6)
      expect(chips('more')).toHaveLength(0)
      expect(chips('missing')).toHaveLength(0)
    })
  })

  describe('⋯ menu', () => {
    it('⋯ opens Rename… and Delete… under itself; each opens its dialog; Delete… is the danger item', async () => {
      await render(preset())
      expect(more().getAttribute('aria-label')).toBe('Tall set options')
      expect(more().getAttribute('aria-expanded')).toBe('false')
      expect(more().className).toContain('h-7')
      expect(more().className).toContain('w-7')
      stubRect(more(), 300, 120)
      await act(async () => more().click())
      expect(menu()!.style.left).toBe('300px')
      expect(menu()!.style.top).toBe('124px')
      expect(more().getAttribute('aria-expanded')).toBe('true')
      expect([...menu()!.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim())).toEqual([
        'Rename…',
        'Delete…',
      ])
      expect(menuItem('Delete…')!.className).toContain('text-sg-danger-text')
      expect(menuItem('Delete…')!.className).toContain('hover:bg-sg-danger/20')
      await act(async () => menuItem('Rename…')!.click())
      expect(menu()).toBeNull()
      expect(dialogTitle()).toBe('Rename set')
      act(() => {
        closeTopLayer()
      })

      await act(async () => more().click())
      await act(async () => menuItem('Delete…')!.click())
      expect(dialogTitle()).toBe('Delete set?')
    })

    it('right-click on the card opens the menu at the cursor', async () => {
      await render(preset())
      stubRect(more(), 300, 120)
      await contextMenu(card(), { button: 2, clientX: 55, clientY: 66 })
      expect(menu()!.style.left).toBe('55px')
      expect(menu()!.style.top).toBe('66px')
    })

    it('keyboard contextmenu (button 0) anchors under ⋯; Escape returns focus to where it came from', async () => {
      await render(preset())
      stubRect(more(), 300, 120)
      applyButton().focus()
      await contextMenu(applyButton(), { button: 0, clientX: 10, clientY: 10 })
      expect(menu()!.style.left).toBe('300px')
      expect(menu()!.style.top).toBe('124px')
      act(() => {
        expect(closeTopLayer()).toBe(true)
      })
      expect(menu()).toBeNull()
      expect(document.activeElement).toBe(applyButton())

      more().focus()
      await act(async () => more().click())
      act(() => {
        closeTopLayer()
      })
      expect(document.activeElement).toBe(more())
    })
  })
})
