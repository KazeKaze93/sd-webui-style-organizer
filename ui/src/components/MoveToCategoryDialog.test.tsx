/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, type Style } from '../bridge'
import {
  categoryOptions,
  isCanonicalName,
  moveOutcomeText,
  parseCategoryInput,
  planMove,
} from '../lib/categoryMove'
import { __resetGridFocusForTests } from '../lib/gridFocus'
import { __resetLayerStackForTests, closeTopLayer, hasOpenLayer } from '../lib/layerStack'
import { LORA_SOURCE, styleRowKey, useStylesStore } from '../store/stylesStore'
import { MoveToCategoryDialog } from './MoveToCategoryDialog'
import { StyleCard } from './StyleCard'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const sendToHostMock = vi.mocked(sendToHost)
const A = 'webui/styles_core.csv'
const B = 'webui/other.csv'
const TOKEN = 'test-write-token'

type Row = Style & { category_explicit?: string }

function row(name: string, category: string, extra: Partial<Row> = {}): Row {
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

// --- naming rules: the edge-case table from the plan ---

describe('naming rules', () => {
  it.each([
    // name, derived category, canonical, outcome when moved to POSE
    ['BODY_Tall_Amazon', 'BODY', true, 'Will be saved as POSE_Tall_Amazon'],
    ['BODY_FUTA_Tall_Amazon', 'BODY', true, 'Will be saved as POSE_FUTA_Tall_Amazon'],
    ['body_Thicc', 'BODY', false, 'Name stays body_Thicc, category column becomes POSE'],
    ['BASE_Woman', 'CHARACTER', false, 'Name stays BASE_Woman, category column becomes POSE'],
    ['anime-style', 'anime', false, 'Name stays anime-style, category column becomes POSE'],
    ['Cinematic', 'Styles_core', false, 'Name stays Cinematic, category column becomes POSE'],
    ['_draft', 'Styles_core', false, 'Name stays _draft, category column becomes POSE'],
  ])('%s (category %s): canonical=%s', (name, category, canonical, outcome) => {
    const style = row(name, category)
    expect(isCanonicalName(style)).toBe(canonical)
    const plan = planMove(style, 'POSE')
    expect(plan.renames).toBe(canonical)
    expect(moveOutcomeText(style, plan, 'POSE')).toBe(outcome)
    expect(plan.payload).toEqual({
      old_name: name,
      new_name: canonical ? outcome.replace('Will be saved as ', '') : name,
      source: A,
      category: 'POSE',
    })
  })

  it('a prefix that equals the column but is not uppercase stays non-standard', () => {
    expect(isCanonicalName(row('body_x', 'body'))).toBe(false)
  })

  it.each([
    ['pose', 'POSE', null],
    ['  Pose2 ', 'POSE2', null],
    ['', '', null],
    ['NEW_CAT', 'NEW_CAT', 'Use letters A–Z and digits 0–9 only.'],
    ['new-cat', 'NEW-CAT', 'Use letters A–Z and digits 0–9 only.'],
    ['two words', 'TWO WORDS', 'Use letters A–Z and digits 0–9 only.'],
    ['ÜBER', 'ÜBER', 'Use letters A–Z and digits 0–9 only.'],
  ])('category input %j -> %j (error %j)', (raw, value, error) => {
    expect(parseCategoryInput(raw)).toEqual({ value, error })
  })

  it('options: every valid category of the library, counted in this file, current marked', () => {
    const style = row('BODY_Tall', 'BODY')
    const styles = [
      style,
      row('BODY_Short', 'BODY'),
      row('POSE_Sit', 'POSE'),
      row('LIGHT_Soft', 'LIGHT', { source_file: B }),
      row('weird-one', 'weird', { source_file: B }),
      row('lora', 'LORAS', { source_file: LORA_SOURCE }),
    ]
    expect(categoryOptions(style, styles)).toEqual([
      { category: 'BODY', count: 2, current: true },
      { category: 'LIGHT', count: 0, current: false },
      { category: 'POSE', count: 1, current: false },
    ])
  })
})

// --- the dialog ---

describe('MoveToCategoryDialog', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let calls: { url: string; body: unknown; token: string | null }[] = []
  let respond: () => { status: number; body: unknown }

  const input = () => document.body.querySelector<HTMLInputElement>('input[role="combobox"]')!
  const listbox = () => document.body.querySelector<HTMLElement>('[role="listbox"]')
  const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
  const optionTexts = () => options().map((o) => o.textContent)
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
  const helper = () => document.getElementById(input().getAttribute('aria-describedby')!)!
  const button = (text: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!
  const hostMessages = () => sendToHostMock.mock.calls.map(([m]) => m)
  const toasts = () => useStylesStore.getState().toasts.map((t) => `${t.variant}:${t.message}`)

  const type = async (value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input(), value)
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const key = async (k: string) => {
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    })
  }
  const settle = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }

  const subject = row('BODY_Tall_Amazon', 'BODY')
  const library: Row[] = [
    subject,
    row('BODY_Short', 'BODY'),
    row('POSE_Sit', 'POSE'),
    row('POSE_Stand', 'POSE'),
    row('LIGHT_Soft', 'LIGHT', { source_file: B }),
  ]

  async function renderDialog(style: Row = subject, styles: Row[] = library) {
    useStylesStore.setState({
      styles,
      selectedStyles: [],
      favorites: new Set(),
      styleContributors: {},
      thumbVersions: {},
      toasts: [],
    })
    await act(async () => {
      root!.render(
        <MoveToCategoryDialog open style={style} displayName="Tall Amazon" onClose={onClose} />,
      )
    })
  }
  const onClose = vi.fn(() => {
    act(() => root?.render(<></>))
  })

  beforeEach(() => {
    __resetLayerStackForTests()
    sendToHostMock.mockClear()
    onClose.mockClear()
    calls = []
    respond = () => ({ status: 200, body: { ok: true } })
    window.__STYLE_GRID_WRITE_TOKEN__ = TOKEN
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        calls.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          token: headers['X-StyleGrid-Token'] ?? null,
        })
        const { status, body } = respond()
        return { ok: status < 300, status, json: async () => body } as Response
      }),
    )
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
    delete window.__STYLE_GRID_WRITE_TOKEN__
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetLayerStackForTests()
  })

  it('shows the style and its file under the title; the field is a labelled combobox with focus', async () => {
    await renderDialog()
    const d = dialog()!
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Move to category')
    expect(d.querySelector('[data-sg-move-subject]')!.textContent).toBe('Tall Amazon · styles_core.csv')
    expect(document.activeElement).toBe(input())
    expect(document.querySelector(`label[for="${input().id}"]`)!.textContent).toBe('Category')
    expect(input().getAttribute('aria-expanded')).toBe('true')
    expect(input().getAttribute('aria-controls')).toBe(listbox()!.id)
    expect(button('Move').disabled).toBe(true)
    expect(helper().textContent).toBe('Choose a category or type a new one.')
  })

  it('lists categories with counts in this file; current is marked and cannot be picked', async () => {
    await renderDialog()
    expect(optionTexts()).toEqual(['BODYcurrent · 2', 'LIGHT0', 'POSE2'])
    const current = options()[0]
    expect(current.getAttribute('aria-disabled')).toBe('true')
    await act(async () => current.click())
    expect(input().value).toBe('')
    expect(button('Move').disabled).toBe(true)
  })

  it('typing filters; the create option appears only for a new valid category', async () => {
    await renderDialog()
    // "PO" matches no category exactly, so creating it is offered too.
    await type('po')
    expect(optionTexts()).toEqual(['POSE2', 'Create category “PO”'])
    expect(helper().textContent).toBe('Will be saved as PO_Tall_Amazon')

    await type('pose')
    expect(optionTexts()).toEqual(['POSE2'])

    await type('hair')
    expect(optionTexts()).toEqual(['Create category “HAIR”'])
    expect(helper().textContent).toBe('Will be saved as HAIR_Tall_Amazon')
    expect(button('Move').disabled).toBe(false)

    await type('light')
    expect(optionTexts()).toEqual(['LIGHT0'])

    await type('body')
    expect(optionTexts()).toEqual(['BODYcurrent · 2'])
    expect(helper().textContent).toBe('Already in BODY.')
    expect(button('Move').disabled).toBe(true)
  })

  it('an invalid new name shows an inline error and disables Move', async () => {
    await renderDialog()
    await type('new_cat')
    expect(helper().textContent).toBe('Use letters A–Z and digits 0–9 only.')
    expect(helper().getAttribute('role')).toBe('alert')
    expect(input().getAttribute('aria-invalid')).toBe('true')
    expect(optionTexts()).toEqual([])
    expect(button('Move').disabled).toBe(true)
  })

  it('a canonical rename that collides in the same file is blocked before the request', async () => {
    const styles = [...library, row('POSE_Tall_Amazon', 'POSE')]
    await renderDialog(subject, styles)
    await type('pose')
    expect(helper().textContent).toBe('POSE_Tall_Amazon already exists in styles_core.csv.')
    expect(button('Move').disabled).toBe(true)
  })

  it('keyboard: arrows move over enabled options, Enter picks, Enter again moves', async () => {
    await renderDialog()
    await key('ArrowDown')
    // BODY (current) is skipped.
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1].id)
    await key('ArrowDown')
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[2].id)
    await key('ArrowDown')
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1].id)
    await key('ArrowUp')
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[2].id)
    await key('Enter')
    expect(input().value).toBe('POSE')
    expect(listbox()).toBeNull()

    await key('Enter')
    await settle()
    expect(calls).toHaveLength(1)
  })

  it('Escape closes the list first, then the dialog', async () => {
    await renderDialog()
    expect(listbox()).not.toBeNull()
    await act(async () => {
      closeTopLayer()
    })
    expect(listbox()).toBeNull()
    expect(dialog()).not.toBeNull()
    expect(hasOpenLayer()).toBe(true)

    await act(async () => {
      closeTopLayer()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('canonical move: exact payload, then SG_STYLE_RENAMED and a toast', async () => {
    await renderDialog()
    await type('pose')
    await act(async () => button('Move').click())
    await settle()

    expect(calls).toEqual([
      {
        url: '/style_grid/style/rename',
        body: { old_name: 'BODY_Tall_Amazon', new_name: 'POSE_Tall_Amazon', source: A, category: 'POSE' },
        token: TOKEN,
      },
    ])
    expect(hostMessages()).toEqual([
      { type: 'SG_STYLE_RENAMED', old_name: 'BODY_Tall_Amazon', new_name: 'POSE_Tall_Amazon', source_file: A },
    ])
    expect(toasts()).toEqual(['success:Moved to POSE'])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('non-standard move: name unchanged in the payload, then SG_REFRESH', async () => {
    const odd = row('BASE_Woman', 'CHARACTER', { category_explicit: 'CHARACTER' })
    await renderDialog(odd, [...library, odd])
    await type('pose')
    expect(helper().textContent).toBe('Name stays BASE_Woman, category column becomes POSE')
    await act(async () => button('Move').click())
    await settle()

    expect(calls[0].body).toEqual({ old_name: 'BASE_Woman', new_name: 'BASE_Woman', source: A, category: 'POSE' })
    expect(hostMessages()).toEqual([{ type: 'SG_REFRESH' }])
    expect(toasts()).toEqual(['success:Moved to POSE'])
  })

  it('server error: toast, dialog stays open, nothing sent to the host, store untouched', async () => {
    respond = () => ({ status: 400, body: { ok: false, error: 'Name collision' } })
    await renderDialog()
    useStylesStore.setState({ selectedStyles: [subject] })
    await type('pose')
    await act(async () => button('Move').click())
    await settle()

    expect(toasts()).toEqual(['error:Name collision'])
    expect(dialog()).not.toBeNull()
    expect(button('Move').disabled).toBe(false)
    expect(hostMessages()).toEqual([])
    expect(useStylesStore.getState().selectedStyles[0].name).toBe('BODY_Tall_Amazon')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('after a rename the iframe keeps the style selected, in favorites and preset contributors', async () => {
    await renderDialog()
    const oldKey = styleRowKey(subject)
    const newKey = `${A}\0POSE_Tall_Amazon`
    const other = row('POSE_Sit', 'POSE')
    useStylesStore.setState({
      selectedStyles: [other, subject],
      favorites: new Set([oldKey]),
      styleContributors: { [oldKey]: new Set(['My set']) },
      thumbVersions: { [oldKey]: '42' },
    })
    await type('pose')
    await act(async () => button('Move').click())
    await settle()

    const s = useStylesStore.getState()
    expect(s.selectedStyles.map((x) => [x.name, x.category])).toEqual([
      ['POSE_Sit', 'POSE'],
      ['POSE_Tall_Amazon', 'POSE'],
    ])
    expect(s.selectedKeySet.has(newKey)).toBe(true)
    expect(s.selectedKeySet.has(oldKey)).toBe(false)
    expect([...s.favorites]).toEqual([newKey])
    expect(Object.keys(s.styleContributors)).toEqual([newKey])
    expect(s.thumbVersions[newKey]).toBe('42')
    // The server migrated favorites itself: nothing is posted from here.
    expect(calls.map((c) => c.url)).toEqual(['/style_grid/style/rename'])
  })
})

// --- the context menu ---

describe('card menu: Move to category', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(() => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    sendToHostMock.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    host?.remove()
    __resetLayerStackForTests()
  })

  const openMenuAndChoose = async (style: Row) => {
    useStylesStore.setState({ styles: [style], toasts: [] })
    await act(async () => root!.render(<StyleCard style={style} />))
    await act(async () => {
      host!
        .querySelector('[data-sg-card]')!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (i) => i.textContent?.trim() === 'Move to category…',
    )!
    await act(async () => item.click())
    return item
  }

  it('opens the iframe dialog and no longer sends SG_MOVE_TO_CATEGORY', async () => {
    await openMenuAndChoose(row('BODY_Tall', 'BODY'))
    expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain('Move to category')
    expect(sendToHostMock.mock.calls.map(([m]) => m.type)).not.toContain('SG_MOVE_TO_CATEGORY')
  })

  it('read-only style: dimmed, explains itself, no dialog', async () => {
    const item = await openMenuAndChoose(row('BODY_Sample', 'BODY', { read_only: true }))
    expect(item.className).toContain('cursor-not-allowed')
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(useStylesStore.getState().toasts.map((t) => t.message)).toEqual([
      'This style is from the protected samples pack (read-only) and cannot be moved.',
    ])
  })
})
