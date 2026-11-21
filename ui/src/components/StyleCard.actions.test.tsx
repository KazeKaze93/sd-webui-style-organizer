/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, type Style } from '../bridge'
import { __resetGridFocusForTests } from '../lib/gridFocus'
import { dismissAllHoverIntents } from '../lib/hoverIntent'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { nextCopyName, sourceFileLeaf } from '../lib/styleActions'
import { LORA_SOURCE, useStylesStore } from '../store/stylesStore'
import { StyleCard } from './StyleCard'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const sendToHostMock = vi.mocked(sendToHost)
const SOURCE = 'webui/styles_nsfw_core.csv'
const TOKEN = 'test-write-token'

type Row = Style & { category_explicit?: string }

function row(name: string, extra: Partial<Row> = {}): Row {
  return {
    name,
    source_file: SOURCE,
    prompt: `p:${name}`,
    negative_prompt: `n:${name}`,
    description: '',
    category: 'BODY',
    has_thumbnail: false,
    ...extra,
  }
}

type Call = { url: string; method: string; body: unknown; token: string | null }

describe('style card: delete and duplicate from the iframe', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let calls: Call[] = []
  /** Next responses by URL prefix; default is `{ ok: true }` with HTTP 200. */
  let respond: (url: string) => { status: number; body: unknown }

  const card = () => host!.querySelector<HTMLElement>('[data-sg-card]')!
  const menuItems = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  const menuItem = (text: string) => menuItems().find((i) => i.textContent?.trim() === text)
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
  const dialogButton = (text: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === text,
    )!
  const toasts = () => useStylesStore.getState().toasts.map((t) => `${t.variant}:${t.message}`)
  const hostMessages = () => sendToHostMock.mock.calls.map(([msg]) => msg.type)

  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const openMenu = async () => {
    await act(async () => {
      card().dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
      )
    })
  }

  const choose = async (text: string) => {
    await act(async () => {
      menuItem(text)!.click()
    })
    await settle()
  }

  const renderCard = async (style: Row, library: Row[] = [style]) => {
    useStylesStore.setState({ styles: library, selectedStyles: [], toasts: [], activeSource: null })
    await act(async () => {
      root!.render(<StyleCard style={style} />)
    })
  }

  beforeEach(() => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    sendToHostMock.mockClear()
    calls = []
    respond = () => ({ status: 200, body: { ok: true } })
    window.__STYLE_GRID_WRITE_TOKEN__ = TOKEN
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const headers = (init?.headers ?? {}) as Record<string, string>
        calls.push({
          url,
          method: init?.method ?? 'GET',
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
          token: headers['X-StyleGrid-Token'] ?? null,
        })
        const { status, body } = respond(url)
        return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
      }),
    )
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      dismissAllHoverIntents()
      root?.unmount()
    })
    root = null
    host?.remove()
    host = null
    delete window.__STYLE_GRID_WRITE_TOKEN__
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetLayerStackForTests()
  })

  describe('delete', () => {
    it('menu Delete opens a confirmation naming the style and its real file; focus starts on Cancel', async () => {
      await renderCard(row('BODY_Tall_Amazon'))
      await openMenu()
      await choose('Delete')

      const d = dialog()!
      expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Delete style?')
      expect(d.querySelector('p')!.textContent).toBe(
        'Delete \u201cTall Amazon\u201d from styles_nsfw_core.csv? This cannot be undone.',
      )
      expect(document.activeElement).toBe(dialogButton('Cancel'))
      expect(dialogButton('Delete').className).toContain('bg-sg-danger')
      expect(menuItems()).toHaveLength(0)
      expect(calls).toHaveLength(0)
      expect(hostMessages()).not.toContain('SG_DELETE_STYLE')
    })

    it('confirm: POST /style/delete, then DELETE /thumbnail, then SG_REFRESH; same payloads and token as the host', async () => {
      await renderCard(row('BODY_Tall_Amazon'))
      await openMenu()
      await choose('Delete')
      await act(async () => {
        dialogButton('Delete').click()
      })
      await settle()

      expect(calls).toEqual([
        {
          url: '/style_grid/style/delete',
          method: 'POST',
          body: { name: 'BODY_Tall_Amazon', source: SOURCE },
          token: TOKEN,
        },
        {
          url: `/style_grid/thumbnail?name=BODY_Tall_Amazon&source=${encodeURIComponent(SOURCE)}`,
          method: 'DELETE',
          body: undefined,
          token: TOKEN,
        },
      ])
      expect(hostMessages()).toEqual(['SG_REFRESH'])
      expect(dialog()).toBeNull()
      expect(toasts()).toEqual([])
    })

    it('Cancel sends nothing', async () => {
      await renderCard(row('BODY_Tall_Amazon'))
      await openMenu()
      await choose('Delete')
      await act(async () => {
        dialogButton('Cancel').click()
      })
      expect(dialog()).toBeNull()
      expect(calls).toHaveLength(0)
      expect(hostMessages()).toEqual([])
    })

    it('server error: error toast, dialog stays open, no thumbnail request, no SG_REFRESH', async () => {
      respond = () => ({ status: 404, body: { ok: false, error: 'Style not found' } })
      await renderCard(row('BODY_Tall_Amazon'))
      await openMenu()
      await choose('Delete')
      await act(async () => {
        dialogButton('Delete').click()
      })
      await settle()

      expect(calls.map((c) => c.url)).toEqual(['/style_grid/style/delete'])
      expect(toasts()).toEqual(['error:Style not found'])
      expect(dialog()).not.toBeNull()
      expect(dialogButton('Delete').disabled).toBe(false)
      expect(hostMessages()).toEqual([])
    })

    it('network failure is an error too', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new TypeError('offline')
      }))
      await renderCard(row('BODY_Tall_Amazon'))
      await openMenu()
      await choose('Delete')
      await act(async () => {
        dialogButton('Delete').click()
      })
      await settle()
      expect(toasts()).toEqual(['error:Delete failed'])
      expect(dialog()).not.toBeNull()
      expect(hostMessages()).toEqual([])
    })

    it('a failed thumbnail request does not undo a successful delete', async () => {
      respond = (url) =>
        url.startsWith('/style_grid/thumbnail')
          ? { status: 500, body: { error: 'boom' } }
          : { status: 200, body: { ok: true } }
      await renderCard(row('BODY_Tall_Amazon'))
      await openMenu()
      await choose('Delete')
      await act(async () => {
        dialogButton('Delete').click()
      })
      await settle()
      expect(hostMessages()).toEqual(['SG_REFRESH'])
      expect(dialog()).toBeNull()
      expect(toasts()).toEqual([])
    })
  })

  describe('duplicate', () => {
    it('copies every field as stored, including the Combos tail and the category column', async () => {
      const description = 'Tall, strong build.  Combos: BODY_Muscular; POSE_Standing + BODY_Athletic_Toned (works best).'
      const source = row('BODY_Tall_Amazon', {
        prompt: 'tall female, amazon, {prompt}',
        negative_prompt: 'short,  petite',
        description,
        category: 'CHARACTER',
        category_explicit: 'CHARACTER',
      })
      await renderCard(source)
      await openMenu()
      await choose('Duplicate')

      expect(calls).toEqual([
        {
          url: '/style_grid/style/save',
          method: 'POST',
          body: {
            name: 'BODY_Tall_Amazon_copy',
            prompt: 'tall female, amazon, {prompt}',
            negative_prompt: 'short,  petite',
            description,
            category: 'CHARACTER',
            source: SOURCE,
          },
          token: TOKEN,
        },
      ])
      expect(hostMessages()).toEqual(['SG_REFRESH'])
      expect(toasts()).toEqual(['success:Duplicated as "BODY_Tall_Amazon_copy"'])
      expect(dialog()).toBeNull()
      expect(hostMessages()).not.toContain('SG_DUPLICATE_STYLE')
    })

    it('an empty category column stays empty (the derived category is not written into it)', async () => {
      await renderCard(row('BODY_Tall', { category: 'BODY' }))
      await openMenu()
      await choose('Duplicate')
      expect((calls[0].body as Record<string, unknown>).category).toBe('')
    })

    it('picks the first free name in the same file; other files do not count', async () => {
      const target = row('BODY_Tall')
      const library = [
        target,
        row('BODY_Tall_copy'),
        row('BODY_Tall_copy_2'),
        row('BODY_Tall_copy_3', { source_file: 'webui/other.csv' }),
      ]
      await renderCard(target, library)
      await openMenu()
      await choose('Duplicate')
      expect((calls[0].body as Record<string, unknown>).name).toBe('BODY_Tall_copy_3')
      expect(toasts()).toEqual(['success:Duplicated as "BODY_Tall_copy_3"'])
    })

    it('server error: error toast, no SG_REFRESH', async () => {
      respond = () => ({ status: 400, body: { ok: false, error: 'Invalid or ambiguous source' } })
      await renderCard(row('BODY_Tall'))
      await openMenu()
      await choose('Duplicate')
      expect(toasts()).toEqual(['error:Duplicate failed: Invalid or ambiguous source'])
      expect(hostMessages()).toEqual([])
    })
  })

  describe('read-only and LoRA rules', () => {
    it('read-only style: Delete and Duplicate are dimmed, explain themselves and send nothing', async () => {
      await renderCard(row('BODY_Sample', { read_only: true }))
      await openMenu()
      expect(menuItem('Delete')!.className).toContain('cursor-not-allowed')
      expect(menuItem('Duplicate')!.className).toContain('cursor-not-allowed')
      await choose('Delete')
      expect(dialog()).toBeNull()

      await openMenu()
      await choose('Duplicate')
      expect(calls).toHaveLength(0)
      expect(hostMessages()).toEqual([])
      expect(toasts()).toEqual([
        'info:This style is from the protected samples pack (read-only) and cannot be deleted.',
        'info:This style is from the protected samples pack (read-only); a copy cannot be saved into it.',
      ])
    })

    it('LoRA entry: the menu has no Delete and no Duplicate', async () => {
      await renderCard(row('lora_thing', { source_file: LORA_SOURCE }))
      await openMenu()
      expect(menuItems().length).toBeGreaterThan(0)
      expect(menuItem('Delete')).toBeUndefined()
      expect(menuItem('Duplicate')).toBeUndefined()
    })
  })
})

describe('styleActions helpers', () => {
  it('nextCopyName: _copy, then _copy_2, _copy_3…, per source file', () => {
    const a = 'webui/a.csv'
    const b = 'webui/b.csv'
    expect(nextCopyName('X', a, [])).toBe('X_copy')
    expect(nextCopyName('X', a, [{ name: 'X_copy', source_file: b }])).toBe('X_copy')
    expect(nextCopyName('X', a, [{ name: 'X_copy', source_file: a }])).toBe('X_copy_2')
    expect(
      nextCopyName('X', a, [
        { name: 'X_copy', source_file: a },
        { name: 'X_copy_2', source_file: a },
        { name: 'X_copy_4', source_file: a },
      ]),
    ).toBe('X_copy_3')
    // Copy of a copy keeps the same rule.
    expect(nextCopyName('X_copy', a, [{ name: 'X_copy', source_file: a }])).toBe('X_copy_copy')
  })

  it('sourceFileLeaf gives the real file name for ids and paths', () => {
    expect(sourceFileLeaf('webui/styles_nsfw_core.csv')).toBe('styles_nsfw_core.csv')
    expect(sourceFileLeaf('D:\\SD\\styles\\my.csv')).toBe('my.csv')
    expect(sourceFileLeaf('plain.csv')).toBe('plain.csv')
    expect(sourceFileLeaf('')).toBe('')
  })
})
