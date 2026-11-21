/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { sendToHost } from './bridge'
import { __resetGridFocusForTests } from './lib/gridFocus'
import { __resetLayerStackForTests, closeTopLayer } from './lib/layerStack'

vi.mock('./bridge', async () => {
  const actual = await vi.importActual<typeof import('./bridge')>('./bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const sendToHostMock = vi.mocked(sendToHost)

/** Host-modal requests the iframe used to send before it owned the dialogs. */
const RETIRED = [
  'SG_NEW_STYLE',
  'SG_EDIT_STYLE',
  'SG_MOVE_TO_CATEGORY',
  'SG_DELETE_STYLE',
  'SG_DUPLICATE_STYLE',
  'SG_IMPORT_EXPORT',
  'SG_BACKUP',
]

describe('toolbar dialogs open in the iframe', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const toolbarButton = (label: string) =>
    host!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
  const dialogTitle = () => document.querySelector('[role="dialog"]')?.querySelector('[id]')?.textContent ?? null
  const sentTypes = () => sendToHostMock.mock.calls.map(([m]) => m.type as string)

  beforeEach(async () => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    sendToHostMock.mockClear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ backups: [], thumbnails_bytes: 0 }), { status: 200 })),
    )
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<App />)
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetLayerStackForTests()
  })

  it.each([
    ['Import/Export', 'Import / Export'],
    ['Backup / Restore', 'Backup & restore'],
  ])('%s opens "%s" and sends no retired host-modal message', async (label, title) => {
    await act(async () => toolbarButton(label).click())
    expect(dialogTitle()).toBe(title)
    await act(async () => closeTopLayer())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(sentTypes().filter((t) => RETIRED.includes(t))).toEqual([])
  })
})
