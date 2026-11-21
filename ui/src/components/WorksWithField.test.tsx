/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, type Style } from '../bridge'
import { __resetLayerStackForTests, closeTopLayer, hasOpenLayer } from '../lib/layerStack'
import {
  addTailElement,
  buildDescription,
  parseTail,
  removeTailElement,
  splitDescription,
} from '../lib/styleForm'
import { comboPartLabel, resolveCombosInSourceFile } from '../lib/styleIdentity'
import { tailChips, worksWithCandidates } from '../lib/worksWith'
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
    has_thumbnail: false,
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

// --- tail model ---

describe('tail: parse, remove, add', () => {
  const TAIL = 'Combos: POSE_Stand;  BODY_Muscular + LIGHT_Rim (works best); LIGHT_*;UNKNOWN_X.'

  it('splits at ";" outside parentheses; spacing stays outside the elements', () => {
    expect(parseTail(TAIL).map((e) => e.text)).toEqual([
      'POSE_Stand',
      'BODY_Muscular + LIGHT_Rim (works best)',
      'LIGHT_*',
      'UNKNOWN_X',
    ])
    expect(parseTail('Combos: A (x; y); B').map((e) => e.text)).toEqual(['A (x; y)', 'B'])
    expect(parseTail('')).toEqual([])
  })

  it.each([
    [0, 'Combos: BODY_Muscular + LIGHT_Rim (works best); LIGHT_*;UNKNOWN_X.'],
    [1, 'Combos: POSE_Stand;  LIGHT_*;UNKNOWN_X.'],
    [2, 'Combos: POSE_Stand;  BODY_Muscular + LIGHT_Rim (works best); UNKNOWN_X.'],
    [3, 'Combos: POSE_Stand;  BODY_Muscular + LIGHT_Rim (works best); LIGHT_*.'],
  ])('removing element %i keeps every other byte', (index, expected) => {
    expect(removeTailElement(TAIL, index)).toBe(expected)
  })

  it('removing the only element removes the tail; out-of-range does nothing', () => {
    expect(removeTailElement('Combos: A.', 0)).toBe('')
    expect(removeTailElement(TAIL, 9)).toBe(TAIL)
  })

  it('adding appends "; NAME" after the last element, keeping the period and trailing spaces', () => {
    expect(addTailElement('Combos: A + B (c).', 'POSE_Sit')).toBe('Combos: A + B (c); POSE_Sit.')
    expect(addTailElement('Combo: A  .  ', 'X')).toBe('Combo: A; X  .  ')
    expect(addTailElement('Combos: A', 'X')).toBe('Combos: A; X')
  })

  it('a new tail uses the host format: text + ". " (or " " after a period) + "Combos: NAME."', () => {
    expect(addTailElement('', 'POSE_Sit')).toBe('Combos: POSE_Sit.')
    expect(buildDescription('Tall build', 'Tall build', 'Combos: POSE_Sit.')).toBe('Tall build. Combos: POSE_Sit.')
    expect(buildDescription('Tall build.', 'Tall build.', 'Combos: POSE_Sit.')).toBe('Tall build. Combos: POSE_Sit.')
    expect(buildDescription('Tall build.  ', 'Tall build.  ', 'Combos: POSE_Sit.')).toBe('Tall build. Combos: POSE_Sit.')
    expect(buildDescription('', '', 'Combos: POSE_Sit.')).toBe('Combos: POSE_Sit.')
    // The result splits back into the same text and tail.
    expect(splitDescription('Tall build. Combos: POSE_Sit.')).toMatchObject({ text: 'Tall build.', tail: 'Combos: POSE_Sit.' })
  })

  it('an edited tail is re-attached with the original gap; removing all of it leaves the text', () => {
    const original = 'Tall.  Combos: A; B.'
    expect(buildDescription(original, 'Tall.', 'Combos: A.')).toBe('Tall.  Combos: A.')
    expect(buildDescription(original, 'Tall.', '')).toBe('Tall.')
    expect(buildDescription(original, 'Tall.', 'Combos: A; B.')).toBe(original)
  })
})

// --- chips and search ---

describe('chips and search', () => {
  it('one chip per element; "+" groups and comments; same-file resolution; unknowns kept', () => {
    const chips = tailChips(
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

  it('the tray and the editor give the same labels for the same entries', () => {
    const description = 'X. Combos: POSE_Stand; BODY_Muscular + LIGHT_Rim (works best); LIGHT_*.'
    const tray = resolveCombosInSourceFile(description, LIB, A).map(comboPartLabel)
    const editor = tailChips(splitDescription(description).tail, IN_A).flatMap((c) => c.members.map((m) => m.label))
    expect(editor).toEqual(tray)
  })

  it('search: same file only; not itself, not already listed, no names with "." ";" "+" "(" ")"', () => {
    const tail = 'Combos: POSE_Stand.'
    const names = (q: string, self: string | null = 'BODY_Tall') =>
      worksWithCandidates(IN_A, self, tail, q).map((s) => s.name)
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
    const [tail, setTail] = useState(initial)
    const onChange = (next: string) => {
      latest = next
      setTail(next)
    }
    return (
      <>
        <div id="ww-label">Works with (optional)</div>
        <WorksWithField labelId="ww-label" tail={tail} onChange={onChange} inFile={IN_A} selfName="BODY_Tall" />
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

  it('first add creates the tail in the host format', async () => {
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

  const render = async () => {
    await act(async () => root!.render(<StyleEditorDialog mode="edit" open style={subject} onClose={() => {}} />))
  }
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')!
  const button = (text: string) => [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!
  const prompt = () => {
    const l = [...dialog().querySelectorAll('label')].find((x) => x.textContent!.startsWith('Prompt'))!
    return document.getElementById(l.htmlFor) as HTMLTextAreaElement
  }

  it('an untouched tail saves the description byte for byte, the unknown entry included', async () => {
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

  it('removing a chip makes the form dirty and saves the shorter tail', async () => {
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
