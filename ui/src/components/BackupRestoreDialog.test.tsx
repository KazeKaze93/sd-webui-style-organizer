/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost } from '../bridge'
import {
  formatBytes,
  restoreConfirmationText,
  snapshotLabel,
  snapshotsPrunedBySafety,
  type Snapshot,
} from '../lib/backups'
import { __resetLayerStackForTests, closeTopLayer, hasOpenLayer } from '../lib/layerStack'
import { useStylesStore } from '../store/stylesStore'
import { BackupRestoreDialog } from './BackupRestoreDialog'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const sendToHostMock = vi.mocked(sendToHost)
const TOKEN = 'test-write-token'

function snap(name: string, extra: Partial<Snapshot> = {}): Snapshot {
  return { name, has_dir: true, has_zip: true, size: 2048, members: [], has_thumbnails: false, ...extra }
}

const VERIFIED_TEXT = (date: string, thumbs: boolean) => [
  `Restore the snapshot from ${date}?`,
  'Replaced from the snapshot: presets, favorites, recent, category order, and style CSVs in the ' +
    `extension's styles folder${thumbs ? ', and thumbnails' : ''}.`,
  "Not touched: style CSVs outside the extension's styles folder, such as the packs in the WebUI root " +
    'folder and the bundled samples. Files that are not in the snapshot are kept.',
  'A safety snapshot of the current state is created first, without thumbnails. Only the newest ' +
    '10 snapshots are kept, so the oldest one may be removed.',
]

describe('backup helpers', () => {
  it.each([
    ['20261011_012128', '11 Oct 2026, 01:21', ''],
    ['20260101_000000', '1 Jan 2026, 00:00', ''],
    ['20261122_235959_safety', '22 Nov 2026, 23:59', 'safety'],
    ['20261122_101010_safety2', '22 Nov 2026, 10:10', 'safety2'],
  ])('snapshot %s reads as %s (suffix %j), no timezone conversion', (name, date, suffix) => {
    expect(snapshotLabel(name)).toEqual({ date, parsed: true, suffix })
  })

  it.each(['backup', '2026101_012128', '20261311_012128', '20261011_256000', '20261011_012128_bad-suffix'])(
    'an unknown name format %s shows the raw name',
    (name) => {
      expect(snapshotLabel(name)).toEqual({ date: name, parsed: false, suffix: '' })
    },
  )

  it('sizes follow the host formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('the confirmation text, with and without the thumbnails clause', () => {
    expect(restoreConfirmationText(snap('20261011_012128'), false)).toEqual(VERIFIED_TEXT('11 Oct 2026, 01:21', false))
    expect(restoreConfirmationText(snap('20261011_012128', { has_thumbnails: true }), false)).toEqual(
      VERIFIED_TEXT('11 Oct 2026, 01:21', true),
    )
  })

  it('prune: 9 full snapshots leave room; 10 lose the oldest to the safety snapshot', () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => snap(`2026010${Math.floor(i / 10)}_0000${String(i % 10).padStart(2, '0')}`))
    expect([...snapshotsPrunedBySafety(names(9))]).toEqual([])
    expect([...snapshotsPrunedBySafety(names(10))]).toEqual(['20260100_000000'])
    // A zip-only snapshot is one entry: 10 snapshots with one zip-only fit (19 + 2 = 21 -> 1 entry goes).
    const mixed = names(10).map((s, i) => (i === 5 ? { ...s, has_dir: false } : s))
    expect([...snapshotsPrunedBySafety(mixed)]).toEqual([])
  })
})

describe('BackupRestoreDialog', () => {
  let host: HTMLDivElement | null = null
  let root: Root | null = null
  type Call = { url: string; method: string; body: unknown; token: string | null }
  let calls: Call[] = []
  let listing: { backups: Snapshot[]; thumbnails_bytes: number }
  let respond: (url: string, body: unknown) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>

  const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
  const main = () => dialogs()[0]
  const confirm = () => dialogs()[1] ?? null
  const btn = (scope: HTMLElement, text: string) =>
    [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!
  const rows = () => [...main().querySelectorAll<HTMLElement>('[data-sg-snapshot]')]
  const checkbox = () => main().querySelector<HTMLInputElement>('input[type="checkbox"]')!
  const toasts = () => useStylesStore.getState().toasts.map((t) => `${t.variant}:${t.message}`)
  const hostMessages = () => sendToHostMock.mock.calls.map(([m]) => m)
  const posts = () => calls.filter((c) => c.method === 'POST')

  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })
    }
  }

  const onClose = vi.fn(() => {
    act(() => root?.render(<></>))
  })

  async function renderDialog() {
    useStylesStore.setState({ toasts: [] })
    await act(async () => {
      root!.render(<BackupRestoreDialog open onClose={onClose} />)
    })
    await settle()
  }

  const click = async (b: HTMLButtonElement) => {
    await act(async () => b.click())
    await settle()
  }

  beforeEach(() => {
    __resetLayerStackForTests()
    sendToHostMock.mockClear()
    onClose.mockClear()
    calls = []
    listing = {
      backups: [
        snap('20261011_010945', { size: 1536 }),
        snap('20261122_101500_safety', { size: 4096 }),
        snap('20261011_012128', { size: 3 * 1024 * 1024, has_thumbnails: true }),
      ],
      thumbnails_bytes: 5 * 1024 * 1024,
    }
    respond = () => ({ status: 200, body: { ok: true } })
    window.__STYLE_GRID_WRITE_TOKEN__ = TOKEN
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        const body = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined
        calls.push({ url: String(url), method: init?.method ?? 'GET', body, token: headers['X-StyleGrid-Token'] ?? null })
        const r = String(url) === '/style_grid/backups' && !init?.method
          ? { status: 200, body: listing }
          : await respond(String(url), body)
        return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status })
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

  it('lists snapshots newest first with date, size and thumbnails; the checkbox shows the size', async () => {
    await renderDialog()
    expect(calls[0]).toEqual({ url: '/style_grid/backups', method: 'GET', body: undefined, token: null })
    expect(main().textContent).toContain('Backup & restore')
    expect(main().textContent).toContain('Snapshots (3)')
    expect(rows().map((r) => r.getAttribute('data-sg-snapshot'))).toEqual([
      '20261122_101500_safety',
      '20261011_012128',
      '20261011_010945',
    ])
    expect(rows().map((r) => r.querySelector('[data-sg-snapshot-date]')!.textContent)).toEqual([
      '22 Nov 2026, 10:15safety',
      '11 Oct 2026, 01:21',
      '11 Oct 2026, 01:09',
    ])
    expect(rows().map((r) => r.querySelector('[data-sg-snapshot-meta]')!.textContent)).toEqual([
      '4.0 KB · without thumbnails',
      '3.0 MB · with thumbnails',
      '1.5 KB · without thumbnails',
    ])
    expect(main().textContent).toContain('Include thumbnails (~5.0 MB)')
  })

  it('an unknown name shows raw; an empty list says so; no thumbnails reads "(empty)"', async () => {
    listing = { backups: [snap('odd-name')], thumbnails_bytes: 0 }
    await renderDialog()
    expect(rows()[0].querySelector('[data-sg-snapshot-date]')!.textContent).toBe('odd-name')
    expect(main().textContent).toContain('Include thumbnails (empty)')
    act(() => root!.render(<></>))
    listing = { backups: [], thumbnails_bytes: 0 }
    await renderDialog()
    expect(main().textContent).toContain('Snapshots (0)')
    expect(main().textContent).toContain('No snapshots yet.')
  })

  it.each([false, true])('Create backup (thumbnails %s) sends the host payload, toasts and reloads', async (thumbs) => {
    respond = () => ({ status: 200, body: { ok: true, snapshot: '20261122_120000', members: [], thumbnails_bytes: 0 } })
    await renderDialog()
    if (thumbs) await act(async () => checkbox().click())
    listing = { ...listing, backups: [snap('20261122_120000'), ...listing.backups] }
    await click(btn(main(), 'Create backup'))
    expect(posts()).toEqual([
      { url: '/style_grid/backup', method: 'POST', body: { include_thumbnails: thumbs }, token: TOKEN },
    ])
    expect(toasts()).toEqual(['success:Backup created'])
    expect(rows()[0].getAttribute('data-sg-snapshot')).toBe('20261122_120000')
    expect(calls.filter((c) => c.url === '/style_grid/backups')).toHaveLength(2)
  })

  it('Create backup is busy while running and blocks closing', async () => {
    let release: () => void = () => {}
    respond = () => new Promise((resolve) => {
      release = () => resolve({ status: 200, body: { ok: true, snapshot: 'x' } })
    })
    await renderDialog()
    await act(async () => btn(main(), 'Create backup').click())
    expect(btn(main(), 'Creating…').disabled).toBe(true)
    await act(async () => closeTopLayer())
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => release())
    await settle()
    expect(btn(main(), 'Create backup').disabled).toBe(false)
  })

  it.each([
    [{ status: 200, body: { error: 'disk full' } }, 'Backup failed: disk full', 'alert'],
    [{ status: 200, body: { ok: false, snapshot: null, members: [] } }, 'Nothing to backup (no files found)', 'status'],
  ])('create outcome %j is shown inline; no toast', async (response, text, role) => {
    respond = () => response
    await renderDialog()
    await click(btn(main(), 'Create backup'))
    const msg = main().querySelector(`[role="${role}"]`)
    expect(msg?.textContent).toBe(text)
    expect(toasts()).toEqual([])
    expect(rows()).toHaveLength(3)
  })

  it('Restore… opens the confirmation with focus on Cancel; Cancel and Escape send nothing', async () => {
    await renderDialog()
    await click(btn(rows()[1], 'Restore…'))
    expect(confirm()).not.toBeNull()
    expect(document.activeElement).toBe(btn(confirm()!, 'Cancel'))
    const text = [...confirm()!.querySelectorAll('[data-sg-restore-text] p')].map((p) => p.textContent)
    expect(text).toEqual(VERIFIED_TEXT('11 Oct 2026, 01:21', true))
    await click(btn(confirm()!, 'Cancel'))
    expect(confirm()).toBeNull()

    await click(btn(rows()[2], 'Restore…'))
    expect([...confirm()!.querySelectorAll('[data-sg-restore-text] p')].map((p) => p.textContent)).toEqual(
      VERIFIED_TEXT('11 Oct 2026, 01:09', false),
    )
    // Escape closes the confirmation first, then the dialog.
    await act(async () => closeTopLayer())
    expect(confirm()).toBeNull()
    expect(main()).not.toBeUndefined()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => closeTopLayer())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(hasOpenLayer()).toBe(false)
    expect(posts()).toEqual([])
    expect(hostMessages()).toEqual([])
  })

  it('Restore sends the host request, then toast, SG_REFRESH and a reloaded list; the dialog stays', async () => {
    respond = () => ({ status: 200, body: { ok: true, snapshot: '20261011_012128', safety_snapshot: '20261122_130000_safety' } })
    await renderDialog()
    await click(btn(rows()[1], 'Restore…'))
    listing = { ...listing, backups: [snap('20261122_130000_safety'), ...listing.backups] }
    await click(btn(confirm()!, 'Restore'))
    expect(posts()).toEqual([
      { url: '/style_grid/restore', method: 'POST', body: { snapshot: '20261011_012128' }, token: TOKEN },
    ])
    expect(toasts()).toEqual(['success:Restored the snapshot from 11 Oct 2026, 01:21'])
    expect(hostMessages()).toEqual([{ type: 'SG_REFRESH' }])
    expect(confirm()).toBeNull()
    expect(main()).toBeDefined()
    expect(rows()[0].getAttribute('data-sg-snapshot')).toBe('20261122_130000_safety')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Restore is busy while running: Escape does not close the confirmation', async () => {
    let release: () => void = () => {}
    respond = () => new Promise((resolve) => {
      release = () => resolve({ status: 200, body: { ok: true } })
    })
    await renderDialog()
    await click(btn(rows()[0], 'Restore…'))
    await act(async () => btn(confirm()!, 'Restore').click())
    expect(btn(confirm()!, 'Restoring…').disabled).toBe(true)
    expect(btn(confirm()!, 'Cancel').disabled).toBe(true)
    await act(async () => closeTopLayer())
    expect(confirm()).not.toBeNull()
    await act(async () => release())
    await settle()
    expect(confirm()).toBeNull()
  })

  it.each([
    [{ status: 404, body: { ok: false, error: 'snapshot not found: x' } }, 'Restore failed: snapshot not found: x'],
    [{ status: 200, body: { ok: false, error: 'boom' } }, 'Restore failed: boom'],
    [{ status: 500, body: 'oops' }, 'Restore failed: HTTP 500'],
  ])('restore error %j stays in the confirmation; nothing else changes', async (response, message) => {
    respond = () => response
    await renderDialog()
    await click(btn(rows()[0], 'Restore…'))
    await click(btn(confirm()!, 'Restore'))
    expect(confirm()!.querySelector('[role="alert"]')!.textContent).toBe(message)
    expect(btn(confirm()!, 'Restore').disabled).toBe(false)
    expect(toasts()).toEqual([])
    expect(hostMessages()).toEqual([])
    expect(calls.filter((c) => c.url === '/style_grid/backups')).toHaveLength(1)
  })

  it('a full list: restoring the snapshot the safety snapshot would delete is not offered', async () => {
    listing = {
      backups: Array.from({ length: 10 }, (_, i) => snap(`2026110${Math.floor(i / 10) + 1}_0000${String(i).padStart(2, '0')}`)),
      thumbnails_bytes: 0,
    }
    await renderDialog()
    const oldest = rows()[rows().length - 1]
    await click(btn(oldest, 'Restore…'))
    const text = [...confirm()!.querySelectorAll('[data-sg-restore-text] p')].map((p) => p.textContent)
    expect(text[4]).toBe(
      'The list is full: the safety snapshot would delete this snapshot before it is read, so it cannot be restored from here.',
    )
    expect(btn(confirm()!, 'Restore').disabled).toBe(true)
    await click(btn(confirm()!, 'Cancel'))
    await click(btn(rows()[0], 'Restore…'))
    expect(btn(confirm()!, 'Restore').disabled).toBe(false)
    expect(confirm()!.querySelectorAll('[data-sg-restore-text] p')).toHaveLength(4)
  })

  it('a list error is inline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'nope' }), { status: 500 })))
    await renderDialog()
    expect(main().querySelector('[role="alert"]')!.textContent).toBe('Could not list backups: nope')
  })
})
