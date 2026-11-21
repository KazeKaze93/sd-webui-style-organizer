/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, type Style } from '../bridge'
import { __resetLayerStackForTests, closeTopLayer, hasOpenLayer } from '../lib/layerStack'
import { splitCombos } from '../lib/combosBlock'
import { comboPartLabel, resolveCombosInSourceFile } from '../lib/styleIdentity'
import { blockChips, worksWithCandidates } from '../lib/worksWith'
import { useStylesStore } from '../store/stylesStore'
import { StyleEditorDialog } from './StyleEditorDialog'
import { WorksWithField } from './WorksWithField'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const A = 'webui/styles_core.csv'
const B = 'webui/other.csv'

function row(name: string, category: string, extra: Partial<Style> = {}): Style {
  return {
    name,
    source_file: A,
    prompt: `p:${name}`,
    negative_prompt: '',
    description: '',
    category,
    ...extra,
  }
}

const LIB: Style[] = [
  row('BODY_Tall', 'BODY'),
  row('BODY_Muscular', 'BODY'),
  row('POSE_Stand', 'POSE'),
  row('POSE_Sit', 'POSE'),
  row('LIGHT_Rim', 'LIGHT'),
  row('LIGHT_Soft.v2', 'LIGHT'),
  row('LIGHT_A+B', 'LIGHT'),
  row('POSE_Kneel', 'POSE', { source_file: B }),
]
const IN_A = LIB.filter((s) => s.source_file === A)

// --- chips and search ---

describe('chips and search', () => {
  it('one chip per element; "+" groups and comments; same-file resolution; unknowns kept', () => {
    const chips = blockChips(
      'Combos: POSE_Stand; BODY_Muscular + LIGHT_Rim (works best); LIGHT_*; POSE_Kneel; HAIR_Long; (just a note).',
      IN_A,
    )
    expect(chips.map((c) => c.label)).toEqual([
      'Stand',
      'Muscular + Rim',
      'LIGHT_*',
      'POSE_Kneel',
      'HAIR_Long',
      '(just a note)',
    ])
    expect(chips.map((c) => c.members.map((m) => m.resolved.type))).toEqual([
      ['style'],
      ['style', 'style'],
      ['category'],
      // POSE_Kneel lives in another file; here it reads as a POSE category entry,
      // exactly as the tray's resolver reads it.
      ['category'],
      ['missing'], // no HAIR style or category in this file
      ['raw'],
    ])
    const grouped = chips[1].members[1].resolved
    expect(grouped.type === 'style' && grouped.comment).toBe('works best')
  })

  it.each([
    'X. Combos: POSE_Stand; BODY_Muscular + LIGHT_Rim (works best); LIGHT_*.',
    'X. Combos: POSE_Stand; LIGHT_Rim. Conflicts: BODY_Tall.',
    'X. Combos: POSE_Sit. Good for profile images.',
    'Combos: BODY_Muscular + LIGHT_Rim (note).',
    'X. Combos: POSE_Stand; LIGHT_*',
  ])('the tray and the editor read the same entries: %s', (description) => {
    const tray = resolveCombosInSourceFile(description, LIB, A).map(comboPartLabel)
    const editor = blockChips(splitCombos(description).block, IN_A).flatMap((c) => c.members.map((m) => m.label))
    expect(tray.length).toBeGreaterThan(0)
    expect(editor).toEqual(tray)
  })

  it('search: same file only; not itself, not already listed, no names with "." ";" "+" "(" ")"', () => {
    const block = 'Combos: POSE_Stand.'
    const names = (q: string, self: string | null = 'BODY_Tall') =>
      worksWithCandidates(IN_A, self, block, q).map((s) => s.name)
    expect(names('pose')).toEqual(['POSE_Sit'])
    expect(names('light')).toEqual(['LIGHT_Rim'])
    expect(names('tall')).toEqual([])
    expect(names('tall', null)).toEqual(['BODY_Tall'])
    expect(names('kneel')).toEqual([])
    expect(names('')).toEqual([])
    expect(names('musc')).toEqual(['BODY_Muscular'])
  })
})

// --- the field ---

describe('WorksWithField', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let latest = ''

  function Harness({ initial }: { initial: string }) {
    const [block, setBlock] = useState(initial)
    const onChange = (next: string) => {
      latest = next
      setBlock(next)
    }
    return (
      <>
        <div id="ww-label">Works with (optional)</div>
        <WorksWithField labelId="ww-label" block={block} onChange={onChange} inFile={IN_A} selfName="BODY_Tall" />
      </>
    )
  }

  const chips = () => [...host!.querySelectorAll<HTMLElement>('[data-sg-works-chip]')]
  const input = () => host!.querySelector<HTMLInputElement>('input[aria-label="Search styles to add"]')!
  const options = () => [...host!.querySelectorAll<HTMLElement>('[role="option"]')]
  const key = async (el: HTMLElement, k: string) => {
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    })
  }
  const type = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const frame = async () => {
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
  }

  beforeEach(() => {
    __resetLayerStackForTests()
    latest = ''
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    __resetLayerStackForTests()
  })

  it('remove buttons are labelled and remove exactly that element', async () => {
    await act(async () => root!.render(<Harness initial="Combos: POSE_Stand;  BODY_Muscular + LIGHT_Rim (x); LIGHT_*." />))
    expect(chips().map((c) => c.getAttribute('aria-label'))).toEqual(['Stand', 'Muscular + Rim', 'LIGHT_*'])
    // jsdom's selector engine mis-reads "+" inside an attribute value; match by hand.
    const removeGroup = [...host!.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === 'Remove Muscular + Rim',
    )!
    await act(async () => removeGroup.click())
    expect(latest).toBe('Combos: POSE_Stand;  LIGHT_*.')
  })

  it('typing shows same-file results; Enter adds "; NAME"; the list is its own layer', async () => {
    await act(async () => root!.render(<Harness initial="Combos: POSE_Stand." />))
    act(() => input().focus())
    await type('pose')
    expect(options().map((o) => o.textContent)).toEqual(['SitPOSE'])
    expect(hasOpenLayer()).toBe(true)
    await key(input(), 'Enter')
    expect(latest).toBe('Combos: POSE_Stand; POSE_Sit.')
    expect(input().value).toBe('')

    await type('light')
    expect(options()).toHaveLength(1)
    await act(async () => closeTopLayer())
    expect(options()).toHaveLength(0)
    expect(latest).toBe('Combos: POSE_Stand; POSE_Sit.')
  })

  it('first add creates the block in the host format', async () => {
    await act(async () => root!.render(<Harness initial="" />))
    act(() => input().focus())
    await type('rim')
    await key(input(), 'Enter')
    expect(latest).toBe('Combos: LIGHT_Rim.')
  })

  it('keyboard: Backspace in the empty input focuses the last chip; arrows move; Delete removes', async () => {
    await act(async () => root!.render(<Harness initial="Combos: POSE_Stand; LIGHT_Rim; POSE_Sit." />))
    act(() => input().focus())
    await key(input(), 'Backspace')
    expect(document.activeElement).toBe(chips()[2])
    await key(chips()[2], 'ArrowLeft')
    expect(document.activeElement).toBe(chips()[1])
    await key(chips()[1], 'ArrowRight')
    expect(document.activeElement).toBe(chips()[2])
    await key(chips()[2], 'ArrowRight')
    expect(document.activeElement).toBe(input())

    act(() => chips()[1].focus())
    await key(chips()[1], 'Delete')
    await frame()
    expect(latest).toBe('Combos: POSE_Stand; POSE_Sit.')
    expect(document.activeElement).toBe(chips()[0])

    await key(chips()[0], 'Backspace')
    await frame()
    expect(latest).toBe('Combos: POSE_Sit.')
    expect(document.activeElement).toBe(input())
  })
})

// --- inside the editor ---

describe('Works with in the style editor', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let saved: unknown[] = []

  const subject = row('BODY_Tall', 'BODY', {
    description: 'Tall build.  Combos: POSE_Stand + LIGHT_Rim (works best);  UNKNOWN_X.',
  })

  beforeEach(() => {
    __resetLayerStackForTests()
    vi.mocked(sendToHost).mockClear()
    saved = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        saved.push(JSON.parse(String(init?.body)))
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
      }),
    )
    useStylesStore.setState({ styles: [...LIB.filter((s) => s.name !== 'BODY_Tall'), subject], toasts: [] })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    vi.unstubAllGlobals()
    __resetLayerStackForTests()
  })

  const render = async (style: Style = subject) => {
    useStylesStore.setState({ styles: [...LIB.filter((s) => s.name !== style.name), style] })
    await act(async () => root!.render(<StyleEditorDialog mode="edit" open style={style} onClose={() => {}} />))
  }
  const field = (labelText: string) => {
    const l = [...dialog().querySelectorAll('label')].find((x) => x.textContent === labelText)
    return l ? (document.getElementById(l.htmlFor) as HTMLInputElement) : null
  }
  const setValue = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    await act(async () => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const save = async () => {
    await act(async () => button('Save').click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    return (saved[0] as { description: string }).description
  }
  const chipLabels = () =>
    [...dialog().querySelectorAll<HTMLElement>('[data-sg-works-chip]')].map((c) => c.getAttribute('aria-label'))
  const searchInput = () => dialog().querySelector<HTMLInputElement>('input[aria-label="Search styles to add"]')!

  const withConflicts = row('BODY_Tall', 'BODY', {
    description: 'Tall build. Combos: POSE_Stand; LIGHT_Rim. Conflicts: BODY_Muscular.',
  })

  it('"Combos: …. Conflicts: …": chips from the block, the rest in "After Works with"', async () => {
    await render(withConflicts)
    expect(field('Description')!.value).toBe('Tall build.')
    expect(chipLabels()).toEqual(['Stand', 'Rim'])
    expect(field('After Works with')!.value).toBe('Conflicts: BODY_Muscular.')
  })

  it('"After Works with" is hidden when nothing follows the block', async () => {
    await render()
    expect(field('After Works with')).toBeNull()
  })

  it('adding a chip goes inside the block, before its period; Conflicts stays', async () => {
    await render(withConflicts)
    act(() => searchInput().focus())
    await setValue(searchInput(), 'sit')
    await act(async () => {
      searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(await save()).toBe('Tall build. Combos: POSE_Stand; LIGHT_Rim; POSE_Sit. Conflicts: BODY_Muscular.')
  })

  it('removing every chip keeps the text before and after', async () => {
    await render(withConflicts)
    for (const label of ['Stand', 'Rim']) {
      const btn = dialog().querySelector<HTMLButtonElement>(`button[aria-label="Remove ${label}"]`)!
      await act(async () => btn.click())
    }
    expect(await save()).toBe('Tall build. Conflicts: BODY_Muscular.')
  })

  it('editing only "After Works with" keeps the other bytes; editing only the text keeps the block and after', async () => {
    await render(withConflicts)
    await setValue(field('After Works with')!, 'Conflicts: BODY_Muscular; POSE_Sit.')
    expect(await save()).toBe('Tall build. Combos: POSE_Stand; LIGHT_Rim. Conflicts: BODY_Muscular; POSE_Sit.')

    saved = []
    act(() => root!.render(<></>))
    await render(withConflicts)
    await setValue(field('Description')!, 'Very tall.')
    expect(await save()).toBe('Very tall. Combos: POSE_Stand; LIGHT_Rim. Conflicts: BODY_Muscular.')
  })

  it('"Combos: A. Good for Y." and a block without a period read and save the same way', async () => {
    const good = row('BODY_Tall', 'BODY', { description: 'X. Combos: POSE_Sit. Good for profile images.' })
    await render(good)
    expect(chipLabels()).toEqual(['Sit'])
    expect(field('After Works with')!.value).toBe('Good for profile images.')
    await setValue(prompt(), 'changed')
    expect(await save()).toBe(good.description)

    saved = []
    act(() => root!.render(<></>))
    const open = row('BODY_Tall', 'BODY', { description: 'X. Combos: POSE_Sit; LIGHT_Rim' })
    await render(open)
    expect(chipLabels()).toEqual(['Sit', 'Rim'])
    expect(field('After Works with')).toBeNull()
    const btn = dialog().querySelector<HTMLButtonElement>('button[aria-label="Remove Rim"]')!
    await act(async () => btn.click())
    expect(await save()).toBe('X. Combos: POSE_Sit')
  })
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')!
  const button = (text: string) => [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!
  const prompt = () => {
    const l = [...dialog().querySelectorAll('label')].find((x) => x.textContent!.startsWith('Prompt'))!
    return document.getElementById(l.htmlFor) as HTMLTextAreaElement
  }

  it('an untouched block saves the description byte for byte, the unknown entry included', async () => {
    await render()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt(), 'changed')
      prompt().dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('Save').click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect((saved[0] as { description: string }).description).toBe(subject.description)
  })

  it('removing a chip makes the form dirty and saves the shorter block', async () => {
    await render()
    expect(button('Save').disabled).toBe(true)
    const remove = dialog().querySelector<HTMLButtonElement>('button[aria-label="Remove UNKNOWN_X"]')!
    await act(async () => remove.click())
    expect(button('Save').disabled).toBe(false)

    // Dirty: closing asks first.
    await act(async () => closeTopLayer())
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(2)
    await act(async () => closeTopLayer())

    await act(async () => button('Save').click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect((saved[0] as { description: string }).description).toBe(
      'Tall build.  Combos: POSE_Stand + LIGHT_Rim (works best).',
    )
  })
})
