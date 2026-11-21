/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, type Style } from '../bridge'
import { __resetGridFocusForTests } from '../lib/gridFocus'
import { dismissAllHoverIntents } from '../lib/hoverIntent'
import { __resetLayerStackForTests, closeTopLayer } from '../lib/layerStack'
import {
  buildSaveRequest,
  joinDescription,
  resolveName,
  splitDescription,
  writableSources,
} from '../lib/styleForm'
import { LORA_SOURCE, styleRowKey, useStylesStore } from '../store/stylesStore'
import { StyleCard } from './StyleCard'
import { StyleEditorDialog } from './StyleEditorDialog'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const sendToHostMock = vi.mocked(sendToHost)
const A = 'webui/styles_core.csv'
const B = 'webui/other.csv'
const SAMPLES = 'samples/demo.csv'
const TOKEN = 'test-write-token'

type Row = Style & { category_explicit?: string }

function row(name: string, category: string, extra: Partial<Row> = {}): Row {
  return {
    name,
    source_file: A,
    prompt: `p:${name}`,
    negative_prompt: `n:${name}`,
    description: '',
    category,
    has_thumbnail: false,
    ...extra,
  }
}

/** The plan's edge cases: [name, derived category]. */
const EDGE_CASES: Array<[string, string]> = [
  ['BODY_Tall_Amazon', 'BODY'],
  ['BODY_FUTA_Tall_Amazon', 'BODY'],
  ['body_Thicc', 'BODY'],
  ['BASE_Woman', 'CHARACTER'],
  ['anime-style', 'anime'],
  ['Cinematic', 'Styles_core'],
  ['_draft', 'Styles_core'],
]

// --- description tail ---

describe('description: the Combos tail is kept byte for byte', () => {
  it.each([
    ['plain text, no tail', 'Just text.', 'Just text.', ''],
    ['tail only', 'Combos: BODY_A; POSE_B.', '', 'Combos: BODY_A; POSE_B.'],
    ['double spaces kept', 'Tall build.  Combos: BODY_A;  POSE_B', 'Tall build.', 'Combos: BODY_A;  POSE_B'],
    ['+ groups and comments', 'X. Combos: A + B (works best); C (rare).', 'X.', 'Combos: A + B (works best); C (rare).'],
    ['singular Combo:', 'Y Combo: Z', 'Y', 'Combo: Z'],
    ['trailing whitespace', 'T. Combos: A.  ', 'T.', 'Combos: A.  '],
  ])('%s', (_label, raw, text, tail) => {
    const parts = splitDescription(raw)
    expect(parts.text).toBe(text)
    expect(parts.tail).toBe(tail)
    expect(parts.text + parts.gap + parts.tail).toBe(raw)
    expect(joinDescription(raw, parts.text)).toBe(raw)
  })

  it('editing the text re-attaches the tail unchanged with the original gap', () => {
    const raw = 'Tall build.  Combos: BODY_A + POSE_B (works best);  LIGHT_C.'
    expect(joinDescription(raw, 'New text.')).toBe('New text.  Combos: BODY_A + POSE_B (works best);  LIGHT_C.')
    expect(joinDescription(raw, '')).toBe('Combos: BODY_A + POSE_B (works best);  LIGHT_C.')
    expect(joinDescription('Combos: A.', 'Lead')).toBe('Lead Combos: A.')
  })

  it('a description that does not end with a Combos tail is plain text', () => {
    const raw = 'Combos: A. Then more text.'
    expect(splitDescription(raw)).toEqual({ text: raw, gap: '', tail: '' })
    expect(joinDescription(raw, 'Changed')).toBe('Changed')
  })
})

// --- naming rules ---

describe('naming rules', () => {
  const resolve = (style: Row, categoryInput: string, nameInput: string, styles: Row[] = [style]) =>
    resolveName({ mode: 'edit', style, categoryInput, nameInput, sourceFile: A, styles })

  it.each(EDGE_CASES)('%s: untouched fields keep the name byte for byte', (name, category) => {
    const style = row(name, category)
    const canonical = name === 'BODY_Tall_Amazon' || name === 'BODY_FUTA_Tall_Amazon'
    const nameField = canonical ? name.slice(name.indexOf('_') + 1) : name
    const outcome = resolve(style, category, nameField)
    expect(outcome).toMatchObject({ name, renames: false, categoryColumn: null, error: false })
    expect(outcome.helper).toBe(`Name stays ${name}`)
    const request = buildSaveRequest({
      mode: 'edit',
      originalName: name,
      outcome,
      fields: { prompt: 'P', negative_prompt: 'N', description: 'D' },
      sourceFile: A,
    })
    expect(request).toEqual({
      url: '/style_grid/style/save',
      body: { name, prompt: 'P', negative_prompt: 'N', description: 'D', source: A },
    })
  })

  it.each([
    ['BODY_Tall_Amazon', 'BODY', 'POSE_Tall_Amazon', 'Will be saved as POSE_Tall_Amazon'],
    ['BODY_FUTA_Tall_Amazon', 'BODY', 'POSE_FUTA_Tall_Amazon', 'Will be saved as POSE_FUTA_Tall_Amazon'],
    ['body_Thicc', 'BODY', 'body_Thicc', 'Name stays body_Thicc, category column becomes POSE'],
    ['BASE_Woman', 'CHARACTER', 'BASE_Woman', 'Name stays BASE_Woman, category column becomes POSE'],
    ['anime-style', 'anime', 'anime-style', 'Name stays anime-style, category column becomes POSE'],
    ['Cinematic', 'Styles_core', 'Cinematic', 'Name stays Cinematic, category column becomes POSE'],
    ['_draft', 'Styles_core', '_draft', 'Name stays _draft, category column becomes POSE'],
  ])('%s: category -> POSE gives %s', (name, category, expected, helper) => {
    const style = row(name, category)
    const canonical = expected !== name
    const nameField = canonical ? name.slice(name.indexOf('_') + 1) : name
    const outcome = resolve(style, 'pose', nameField)
    expect(outcome).toMatchObject({ name: expected, renames: canonical, categoryColumn: 'POSE', helper })
  })

  it.each([
    ['BODY_Tall_Amazon', 'BODY', 'Tall', 'BODY_Tall'],
    ['BODY_FUTA_Tall_Amazon', 'BODY', 'FUTA_Tall', 'BODY_FUTA_Tall'],
    ['body_Thicc', 'BODY', 'body_Thick', 'body_Thick'],
    ['BASE_Woman', 'CHARACTER', 'BASE_Lady', 'BASE_Lady'],
    ['anime-style', 'anime', 'anime-styles', 'anime-styles'],
    ['Cinematic', 'Styles_core', 'Cinematic2', 'Cinematic2'],
    ['_draft', 'Styles_core', '_draft2', '_draft2'],
  ])('%s: Name edit %j gives %s, column untouched', (name, category, nameField, expected) => {
    const outcome = resolve(row(name, category), category, nameField)
    expect(outcome).toMatchObject({ name: expected, renames: true, categoryColumn: null })
    expect(outcome.helper).toBe(`Will be saved as ${expected}`)
  })

  it('validation: empty name, invalid or cleared category, collision in the same file only', () => {
    const style = row('BODY_Tall', 'BODY')
    expect(resolve(style, 'BODY', '  ')).toMatchObject({ name: null, helper: 'Enter a name.', error: false })
    expect(resolve(style, 'new_cat', 'Tall')).toMatchObject({ name: null, helper: 'Use letters A–Z and digits 0–9 only.', error: true })
    expect(resolve(style, '', 'Tall')).toMatchObject({ name: null, helper: 'Choose a category.', error: true })
    const others = [style, row('POSE_Tall', 'POSE'), row('LIGHT_Tall', 'LIGHT', { source_file: B })]
    expect(resolve(style, 'POSE', 'Tall', others)).toMatchObject({
      name: null, helper: 'POSE_Tall already exists in styles_core.csv.', error: true,
    })
    expect(resolve(style, 'LIGHT', 'Tall', others)).toMatchObject({ name: 'LIGHT_Tall', error: false })
  })

  it('create: <CATEGORY>_<Name>, or Name alone without a category', () => {
    const create = (categoryInput: string, nameInput: string) =>
      resolveName({ mode: 'create', style: null, categoryInput, nameInput, sourceFile: A, styles: [] })
    expect(create('pose', 'Sit')).toMatchObject({ name: 'POSE_Sit', helper: 'Will be saved as POSE_Sit' })
    expect(create('', 'Free')).toMatchObject({ name: 'Free', helper: 'Will be saved as Free' })
    expect(create('bad-cat', 'Sit')).toMatchObject({ name: null, error: true })
  })

  it('writable sources exclude LoRA and read-only packs', () => {
    expect(
      writableSources([
        row('A', 'X', { source_file: B }),
        row('B', 'X'),
        row('C', 'X', { source_file: SAMPLES, read_only: true }),
        row('D', 'X', { source_file: LORA_SOURCE }),
      ]),
    ).toEqual([B, A])
  })
})

// --- the dialog ---

describe('StyleEditorDialog', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let calls: { url: string; body: unknown; token: string | null }[] = []
  let respond: () => { status: number; body: unknown }
  const onClose = vi.fn(() => {
    act(() => root?.render(<></>))
  })

  const dialogs = () => [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')]
  const dialog = () => dialogs()[0]
  const titleOf = (d: HTMLElement) => document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent
  const field = (label: string) => {
    const l = [...dialog().querySelectorAll('label')].find((x) => x.textContent!.startsWith(label))!
    return document.getElementById(l.htmlFor) as HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement
  }
  const button = (text: string, d: HTMLElement = dialogs()[dialogs().length - 1]) =>
    [...d.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!
  const helper = () => document.getElementById(field('Name').getAttribute('aria-describedby')!)!
  const hostMessages = () => sendToHostMock.mock.calls.map(([m]) => m)
  const toasts = () => useStylesStore.getState().toasts.map((t) => `${t.variant}:${t.message}`)

  const setValue = async (el: HTMLElement, value: string) => {
    await act(async () => {
      const proto = Object.getPrototypeOf(el)
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    })
  }
  const click = async (el: HTMLElement) => {
    await act(async () => el.click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }

  const subject = row('BODY_Tall_Amazon', 'BODY', {
    prompt: 'tall, {prompt}',
    negative_prompt: 'short',
    description: 'Tall build.  Combos: BODY_Muscular + POSE_Stand (works best);  LIGHT_Rim.',
  })
  const library: Row[] = [
    subject,
    row('POSE_Stand', 'POSE'),
    row('LIGHT_Rim', 'LIGHT', { source_file: B }),
    row('DEMO_X', 'DEMO', { source_file: SAMPLES, read_only: true }),
  ]

  async function renderEdit(style: Row = subject) {
    useStylesStore.setState({ styles: [...library.filter((s) => s !== subject), style], toasts: [], selectedStyles: [] })
    await act(async () => {
      root!.render(<StyleEditorDialog mode="edit" open style={style} onClose={onClose} />)
    })
  }
  async function renderCreate(defaultSource: string | null) {
    useStylesStore.setState({ styles: library, toasts: [] })
    await act(async () => {
      root!.render(<StyleEditorDialog mode="create" open defaultSource={defaultSource} onClose={onClose} />)
    })
  }

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
    host?.remove()
    delete window.__STYLE_GRID_WRITE_TOKEN__
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetLayerStackForTests()
  })

  it('edit: title, source file, fields prefilled; the tail as chips; Save disabled until a change', async () => {
    await renderEdit()
    expect(titleOf(dialog())).toBe('Edit style')
    expect(dialog().querySelector('[data-sg-editor-source]')!.textContent).toBe('styles_core.csv')
    expect(field('Category').value).toBe('BODY')
    expect(field('Name').value).toBe('Tall_Amazon')
    expect(document.activeElement).toBe(field('Name'))
    expect(field('Prompt').value).toBe('tall, {prompt}')
    expect(field('Prompt').className).toContain('font-mono')
    expect(field('Negative prompt').className).toContain('font-mono')
    expect(field('Description').value).toBe('Tall build.')
    expect([...dialog().querySelectorAll('[data-sg-works-chip]')].map((c) => c.getAttribute('aria-label'))).toEqual([
      // BODY_Muscular: category entry (BODY exists in this file); POSE_Stand: a style here;
      // LIGHT_Rim exists only in another file, so here it is "not in this pack".
      'BODY_Muscular + Stand',
      'LIGHT_Rim',
    ])
    expect(dialog().textContent).toContain('not in this pack')
    expect(helper().textContent).toBe('Name stays BODY_Tall_Amazon')
    expect(button('Save').disabled).toBe(true)
  })

  it('edit, name unchanged: /style/save with all fields, tail byte-identical, then SG_REFRESH', async () => {
    await renderEdit()
    await setValue(field('Description'), 'Very tall build.')
    await setValue(field('Prompt'), 'very tall, {prompt}')
    await click(button('Save'))

    expect(calls).toEqual([
      {
        url: '/style_grid/style/save',
        body: {
          name: 'BODY_Tall_Amazon',
          prompt: 'very tall, {prompt}',
          negative_prompt: 'short',
          description: 'Very tall build.  Combos: BODY_Muscular + POSE_Stand (works best);  LIGHT_Rim.',
          source: A,
        },
        token: TOKEN,
      },
    ])
    expect(hostMessages()).toEqual([{ type: 'SG_REFRESH' }])
    expect(toasts()).toEqual(['success:Saved BODY_Tall_Amazon'])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('edit, name changed: /style/rename with the fields, then SG_STYLE_RENAMED; the selection follows', async () => {
    await renderEdit()
    useStylesStore.setState({ selectedStyles: [subject], favorites: new Set([styleRowKey(subject)]) })
    await setValue(field('Category'), 'pose')
    await setValue(field('Name'), 'Tall')
    expect(helper().textContent).toBe('Will be saved as POSE_Tall')
    await click(button('Save'))

    expect(calls.map((c) => [c.url, c.body])).toEqual([
      [
        '/style_grid/style/rename',
        {
          old_name: 'BODY_Tall_Amazon',
          new_name: 'POSE_Tall',
          source: A,
          prompt: 'tall, {prompt}',
          negative_prompt: 'short',
          description: subject.description,
          category: 'POSE',
        },
      ],
    ])
    expect(hostMessages()).toEqual([
      { type: 'SG_STYLE_RENAMED', old_name: 'BODY_Tall_Amazon', new_name: 'POSE_Tall', source_file: A },
    ])
    const s = useStylesStore.getState()
    expect(s.selectedStyles.map((x) => [x.name, x.category])).toEqual([['POSE_Tall', 'POSE']])
    expect([...s.favorites]).toEqual([`${A}\0POSE_Tall`])
  })

  it('non-standard name, category changed: /style/save with the category column, name unchanged', async () => {
    const odd = row('BASE_Woman', 'CHARACTER', { category_explicit: 'CHARACTER' })
    await renderEdit(odd)
    expect(field('Name').value).toBe('BASE_Woman')
    await setValue(field('Category'), 'pose')
    expect(helper().textContent).toBe('Name stays BASE_Woman, category column becomes POSE')
    await click(button('Save'))
    expect(calls[0].url).toBe('/style_grid/style/save')
    expect(calls[0].body).toMatchObject({ name: 'BASE_Woman', category: 'POSE' })
    expect(hostMessages()).toEqual([{ type: 'SG_REFRESH' }])
  })

  it('error: toast, dialog open, every field keeps what the user typed', async () => {
    respond = () => ({ status: 400, body: { ok: false, error: 'Name collision' } })
    await renderEdit()
    await setValue(field('Name'), 'Short')
    await setValue(field('Prompt'), 'edited prompt')
    await click(button('Save'))
    expect(toasts()).toEqual(['error:Name collision'])
    expect(dialogs()).toHaveLength(1)
    expect(field('Name').value).toBe('Short')
    expect(field('Prompt').value).toBe('edited prompt')
    expect(button('Save').disabled).toBe(false)
    expect(hostMessages()).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('collision in the same file is blocked before the request', async () => {
    await renderEdit()
    await setValue(field('Category'), 'POSE')
    await setValue(field('Name'), 'Stand')
    expect(helper().textContent).toBe('POSE_Stand already exists in styles_core.csv.')
    expect(button('Save').disabled).toBe(true)
  })

  it('dirty close asks first: focus on Keep editing; Keep editing returns, Discard closes', async () => {
    await renderEdit()
    await setValue(field('Prompt'), 'changed')

    await act(async () => closeTopLayer())
    expect(dialogs()).toHaveLength(2)
    const confirm = dialogs()[1]
    expect(titleOf(confirm)).toBe('Discard changes?')
    expect(document.activeElement).toBe(button('Keep editing', confirm))

    await click(button('Keep editing', confirm))
    expect(dialogs()).toHaveLength(1)
    expect(field('Prompt').value).toBe('changed')

    await click(button('Cancel', dialog()))
    await click(button('Discard', dialogs()[1]))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(0)
  })

  it('a clean form closes directly', async () => {
    await renderEdit()
    await act(async () => closeTopLayer())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('create: "Save to" defaults to the active source and lists only writable ones', async () => {
    await renderCreate(B)
    expect(titleOf(dialog())).toBe('New style')
    const select = field('Save to')
    expect(select.value).toBe(B)
    expect([...select.options].map((o) => o.textContent)).toEqual(['other.csv', 'styles_core.csv'])
  })

  it('create: a read-only or missing default falls back to the first writable source', async () => {
    await renderCreate(SAMPLES)
    expect(field('Save to').value).toBe(B)
  })

  it('create: /style/save into the chosen source, then SG_REFRESH and a toast', async () => {
    await renderCreate(B)
    await setValue(field('Save to'), A)
    await setValue(field('Category'), 'pose')
    await setValue(field('Name'), 'Sit')
    await setValue(field('Prompt'), 'sitting, {prompt}')
    await setValue(field('Description'), 'Seated.')
    await click(button('Save'))

    expect(calls.map((c) => [c.url, c.body, c.token])).toEqual([
      [
        '/style_grid/style/save',
        { name: 'POSE_Sit', prompt: 'sitting, {prompt}', negative_prompt: '', description: 'Seated.', source: A },
        TOKEN,
      ],
    ])
    expect(hostMessages()).toEqual([{ type: 'SG_REFRESH' }])
    expect(toasts()).toEqual(['success:Created POSE_Sit'])
  })
})

// --- triggers ---

describe('Edit trigger in the card menu', () => {
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
      dismissAllHoverIntents()
      root?.unmount()
    })
    host?.remove()
    __resetLayerStackForTests()
  })

  const choose = async (style: Row) => {
    useStylesStore.setState({ styles: [style], toasts: [] })
    await act(async () => root!.render(<StyleCard style={style} />))
    await act(async () => {
      host!.querySelector('[data-sg-card]')!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )
    })
    const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (i) => i.textContent?.trim() === 'Edit',
    )!
    await act(async () => item.click())
    return item
  }

  it('opens the iframe editor and no longer sends SG_EDIT_STYLE', async () => {
    await choose(row('BODY_Tall', 'BODY'))
    const d = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Edit style')
    expect(sendToHostMock.mock.calls.map(([m]) => m.type)).not.toContain('SG_EDIT_STYLE')
  })

  it('read-only style: dimmed, explains itself, no dialog', async () => {
    const item = await choose(row('DEMO_X', 'DEMO', { source_file: SAMPLES, read_only: true }))
    expect(item.className).toContain('cursor-not-allowed')
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(useStylesStore.getState().toasts.map((t) => t.message)).toEqual([
      'This style is from the protected samples pack (read-only) and cannot be edited. Duplicate it into a data source to change it.',
    ])
  })
})
