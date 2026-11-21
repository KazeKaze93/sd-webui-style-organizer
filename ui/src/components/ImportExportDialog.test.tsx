/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost } from '../bridge'
import {
  exportFileName,
  importSummaryMessage,
  isJsonFile,
} from '../lib/importExport'
import { __resetLayerStackForTests, closeTopLayer, hasOpenLayer } from '../lib/layerStack'
import { useStylesStore } from '../store/stylesStore'
import { ImportExportDialog } from './ImportExportDialog'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const sendToHostMock = vi.mocked(sendToHost)
const TOKEN = 'test-write-token'

describe('import/export helpers', () => {
  it('export file name is the host one: style_grid_export_<UTC date>.json', () => {
    expect(exportFileName(new Date('2026-11-21T23:30:00Z'))).toBe('style_grid_export_2026-11-21.json')
  })

  it.each([
    ['export.json', '', true],
    ['EXPORT.JSON', '', true],
    ['data', 'application/json', true],
    ['notes.txt', 'text/plain', false],
    ['styles.csv', 'text/csv', false],
    ['export.json.zip', 'application/zip', false],
  ])('isJsonFile(%j, %j) = %s', (name, type, expected) => {
    expect(isJsonFile({ name, type })).toBe(expected)
  })

  it('toast text: imported count, up to 10 collisions, invalid entries; info when something was skipped', () => {
    expect(importSummaryMessage({ imported: 1, collisions: [], invalid: 0 })).toEqual({
      message: 'Imported 1 style.',
      variant: 'success',
    })
    const names = Array.from({ length: 12 }, (_, i) => `S${i + 1}`)
    expect(importSummaryMessage({ imported: 3, collisions: names, invalid: 2 })).toEqual({
      message:
        'Imported 3 styles. Skipped 12 already in the library: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10 (+2 more). ' +
        'Skipped 2 invalid entries (missing name).',
      variant: 'info',
    })
  })
})

describe('ImportExportDialog', () => {
  let host: HTMLDivElement | null = null
  let root: Root | null = null
  type Call = { url: string; method: string; body: unknown; token: string | null; contentType: string | null }
  let calls: Call[] = []
  let respond: (url: string) => { status: number; body: unknown }

  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
  const buttonByText = (text: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text))!
  const importButton = () => buttonByText('Import')
  const fileInput = () => dialog()!.querySelector<HTMLInputElement>('input[type="file"]')!
  const dropzone = () => dialog()!.querySelector<HTMLElement>('[data-sg-dropzone]')!
  const fileLine = () => dialog()!.querySelector<HTMLElement>('[data-sg-import-file]')!.textContent
  const alertText = () => dialog()!.querySelector('[role="alert"]')?.textContent ?? null
  const summary = () => dialog()!.querySelector<HTMLElement>('[data-sg-import-summary]')
  const hostMessages = () => sendToHostMock.mock.calls.map(([m]) => m)
  const toasts = () => useStylesStore.getState().toasts.map((t) => `${t.variant}:${t.message}`)

  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })
    }
  }

  const jsonFile = (text: string, name = 'export.json', type = 'application/json') =>
    new File([text], name, { type })

  const pick = async (file: File) => {
    await act(async () => {
      Object.defineProperty(fileInput(), 'files', { value: [file], configurable: true })
      fileInput().dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  const drag = async (type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', files: File[] = []) => {
    await act(async () => {
      const ev = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'dataTransfer', { value: { files, dropEffect: 'none' } })
      dropzone().dispatchEvent(ev)
    })
  }

  const clickImport = async () => {
    await act(async () => {
      importButton().click()
    })
    await settle()
  }

  const onClose = vi.fn(() => {
    act(() => root?.render(<></>))
  })

  async function renderDialog() {
    useStylesStore.setState({ toasts: [] })
    await act(async () => {
      root!.render(<ImportExportDialog open onClose={onClose} />)
    })
  }

  beforeEach(() => {
    __resetLayerStackForTests()
    sendToHostMock.mockClear()
    onClose.mockClear()
    calls = []
    respond = () => ({ status: 200, body: { ok: true, imported: 2, collisions: [], invalid: 0 } })
    window.__STYLE_GRID_WRITE_TOKEN__ = TOKEN
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        calls.push({
          url: String(url),
          method: init?.method ?? 'GET',
          body: init?.body !== undefined ? JSON.parse(String(init.body)) : undefined,
          token: headers['X-StyleGrid-Token'] ?? null,
          contentType: headers['Content-Type'] ?? null,
        })
        const { status, body } = respond(String(url))
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
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

  it('shows both sections; Import is disabled without a file; focus starts on Export', async () => {
    await renderDialog()
    expect(dialog()!.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog()!.textContent).toContain('Import / Export')
    expect(dialog()!.textContent).toContain('Everything as one JSON file.')
    expect(fileLine()).toBe('No file selected.')
    expect(importButton().disabled).toBe(true)
    expect(document.activeElement).toBe(buttonByText('Export all (JSON)'))
    // The hidden input is driven by a visible label.
    const label = dialog()!.querySelector<HTMLLabelElement>(`label[for="${fileInput().id}"]`)
    expect(label?.textContent).toBe('Choose file')
    expect(fileInput().accept).toBe('.json,application/json')
  })

  it('a picked JSON file is shown and enables Import', async () => {
    await renderDialog()
    await pick(jsonFile('{}', 'my_export.json'))
    expect(fileLine()).toBe('my_export.json')
    expect(importButton().disabled).toBe(false)
  })

  it('a dropped file is taken the same way; drag-over is visible', async () => {
    await renderDialog()
    await drag('dragenter')
    expect(dropzone().getAttribute('data-drag-over')).toBe('true')
    await drag('drop', [jsonFile('{}', 'dropped.json', '')])
    expect(dropzone().hasAttribute('data-drag-over')).toBe(false)
    expect(fileLine()).toBe('dropped.json')
    expect(importButton().disabled).toBe(false)
  })

  it('a non-JSON file is rejected inline and keeps Import disabled', async () => {
    await renderDialog()
    await drag('drop', [new File(['a,b'], 'styles.csv', { type: 'text/csv' })])
    expect(alertText()).toBe('Choose a .json file.')
    expect(fileLine()).toBe('No file selected.')
    expect(importButton().disabled).toBe(true)
    expect(calls).toEqual([])
  })

  it('sends the host request: the parsed JSON to /style_grid/import with the write token', async () => {
    await renderDialog()
    const payload = { styles: [{ name: 'X_One', prompt: 'p' }], presets: { a: ['X_One'] } }
    await pick(jsonFile(JSON.stringify(payload)))
    await clickImport()
    expect(calls).toEqual([
      {
        url: '/style_grid/import',
        method: 'POST',
        body: payload,
        token: TOKEN,
        contentType: 'application/json',
      },
    ])
  })

  it('renders the summary with collisions and invalid entries, toasts, then refreshes', async () => {
    respond = () => ({
      status: 200,
      body: { ok: true, imported: 3, collisions: ['BODY_Tall', 'POSE_Sit'], invalid: 1 },
    })
    await renderDialog()
    await pick(jsonFile('{"styles":[]}'))
    await clickImport()
    const box = summary()!
    expect(box.getAttribute('role')).toBe('status')
    expect(box.textContent).toContain('Imported 3 styles.')
    expect(box.textContent).toContain('Skipped 2 already in the library:')
    expect([...box.querySelectorAll('[data-sg-import-collisions] li')].map((li) => li.textContent))
      .toEqual(['BODY_Tall', 'POSE_Sit'])
    expect(box.textContent).toContain('Skipped 1 invalid entry (missing name).')
    expect(toasts()).toEqual([
      'info:Imported 3 styles. Skipped 2 already in the library: BODY_Tall, POSE_Sit. Skipped 1 invalid entry (missing name).',
    ])
    expect(hostMessages()).toEqual([{ type: 'SG_REFRESH' }])
    // Import keeps the host's vanished-style toast.
    expect(hostMessages()[0]).not.toHaveProperty('quiet_vanished')
    // Done: the dialog stays with the summary, and the same file is not imported twice.
    expect(onClose).not.toHaveBeenCalled()
    expect(importButton().disabled).toBe(true)
  })

  it('lists at most 10 collisions, then "+N more"', async () => {
    const names = Array.from({ length: 13 }, (_, i) => `N${i}`)
    respond = () => ({ status: 200, body: { ok: true, imported: 0, collisions: names, invalid: 0 } })
    await renderDialog()
    await pick(jsonFile('{}'))
    await clickImport()
    expect(summary()!.querySelectorAll('[data-sg-import-collisions] li')).toHaveLength(10)
    expect(summary()!.textContent).toContain('+3 more')
  })

  it('a response without style counters reports a plain completion', async () => {
    respond = () => ({ status: 200, body: { ok: true } })
    await renderDialog()
    await pick(jsonFile('{"presets":{}}'))
    await clickImport()
    expect(summary()!.textContent).toBe('Import complete.')
    expect(toasts()).toEqual(['success:Import complete'])
    expect(hostMessages()).toEqual([{ type: 'SG_REFRESH' }])
  })

  it('invalid JSON: inline error, no request, file kept, no refresh', async () => {
    await renderDialog()
    await pick(jsonFile('{not json', 'broken.json'))
    await clickImport()
    expect(alertText()).toBe('Invalid JSON file')
    expect(calls).toEqual([])
    expect(fileLine()).toBe('broken.json')
    expect(importButton().disabled).toBe(false)
    expect(hostMessages()).toEqual([])
    expect(dialog()).not.toBeNull()
  })

  it.each([
    [{ status: 200, body: { error: 'import_failed' } }, 'import_failed'],
    [{ status: 200, body: { error: 'Name clash', collisions: ['A', 'B'] } }, 'Name clash\n\nColliding names: A, B'],
    [{ status: 422, body: { detail: 'Invalid JSON' } }, 'Invalid JSON'],
    [{ status: 403, body: { detail: [{ msg: 'bad token' }] } }, 'bad token'],
    [{ status: 500, body: 'oops' }, 'HTTP 500'],
  ])('server error %j -> inline %j, state kept', async (response, message) => {
    respond = () => response
    await renderDialog()
    await pick(jsonFile('{}', 'kept.json'))
    await clickImport()
    expect(alertText()).toBe(message)
    expect(fileLine()).toBe('kept.json')
    expect(importButton().disabled).toBe(false)
    expect(summary()).toBeNull()
    expect(hostMessages()).toEqual([])
    expect(toasts()).toEqual([])
  })

  it('a network failure is an inline error too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network')
    }))
    await renderDialog()
    await pick(jsonFile('{}'))
    await clickImport()
    expect(alertText()).toBe('Import failed')
    expect(hostMessages()).toEqual([])
  })

  it('Export fetches /style_grid/export and downloads it under the host file name', async () => {
    const data = { styles: [], presets: {}, exported_at: '2026-11-21T10:00:00' }
    respond = () => ({ status: 200, body: data })
    const created: Blob[] = []
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b)
      return 'blob:test'
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    let downloaded: string | null = null
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this.download
    })
    await renderDialog()
    await act(async () => {
      buttonByText('Export all (JSON)').click()
    })
    await settle()
    expect(calls).toEqual([
      { url: '/style_grid/export', method: 'GET', body: undefined, token: null, contentType: null },
    ])
    expect(downloaded).toBe(exportFileName())
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(created[0])
    })
    expect(text).toBe(JSON.stringify(data, null, 2))
    expect(created[0].type).toBe('application/json')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
    expect(hostMessages()).toEqual([])
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  })

  it('an export failure is a toast; nothing is downloaded', async () => {
    respond = () => ({ status: 409, body: { detail: 'corrupt presets.json' } })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await renderDialog()
    await act(async () => {
      buttonByText('Export all (JSON)').click()
    })
    await settle()
    expect(click).not.toHaveBeenCalled()
    expect(toasts()).toEqual(['error:Export failed: corrupt presets.json'])
  })

  it('Escape closes through the layer stack; busy blocks it until the import ends', async () => {
    let release: () => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      release = () => resolve(new Response(JSON.stringify({ ok: true, imported: 0, collisions: [], invalid: 0 })))
    })))
    await renderDialog()
    await pick(jsonFile('{}'))
    await act(async () => {
      importButton().click()
    })
    await settle()
    expect(importButton().textContent).toBe('Importing…')
    await act(async () => {
      closeTopLayer()
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
    await act(async () => {
      release()
    })
    await settle()
    await act(async () => {
      closeTopLayer()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(hasOpenLayer()).toBe(false)
  })

  it('focus returns to the opener on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    await renderDialog()
    expect(dialog()!.contains(document.activeElement)).toBe(true)
    await act(async () => {
      buttonByText('Close').click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
