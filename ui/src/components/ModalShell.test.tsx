/** @vitest-environment jsdom */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { createHoverIntent } from '../lib/hoverIntent'
import { __resetLayerStackForTests, closeTopLayer, hasOpenLayer } from '../lib/layerStack'
import { useStylesStore, type PresetRecord } from '../store/stylesStore'
import { INITIAL_FOCUS_ATTR, ModalShell } from './ModalShell'
import { PresetRow } from './PresetRow'
import { SaveSetDialog } from './SaveSetDialog'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const HERE = path.dirname(fileURLToPath(import.meta.url))

let root: Root | null = null
let host: HTMLDivElement | null = null

const dialogs = () => [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')]
const dialog = () => dialogs()[dialogs().length - 1]
const overlayOf = (d: HTMLElement) =>
  d.closest('[data-sg-modal]')!.querySelector<HTMLElement>('[data-sg-modal-overlay]')!
const buttonIn = (d: HTMLElement, text: string) =>
  [...d.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!

async function render(node: React.ReactNode) {
  await act(async () => {
    root!.render(node)
  })
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click()
  })
}

async function pressTab(shiftKey = false) {
  await act(async () => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }),
    )
  })
}

/** What App's Escape handler does first. */
async function escape() {
  await act(async () => {
    closeTopLayer()
  })
}

beforeEach(() => {
  __resetLayerStackForTests()
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
  __resetLayerStackForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function Harness({
  onClose,
  busy = false,
  nested = false,
  onNestedClose,
}: {
  onClose: () => void
  busy?: boolean
  nested?: boolean
  onNestedClose?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [nestedOpen, setNestedOpen] = useState(false)
  const fieldRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        data-testid="opener"
        onClick={() => setOpen(true)}
      >
        Open
      </button>
      <ModalShell
        open={open}
        onClose={() => {
          onClose()
          setOpen(false)
        }}
        title="Outer title"
        busy={busy}
        initialFocus={fieldRef}
        footer={
          <>
            <button type="button">Cancel</button>
            <button type="button" onClick={() => setNestedOpen(true)}>
              Confirm…
            </button>
          </>
        }
      >
        <input ref={fieldRef} aria-label="Field" />
      </ModalShell>
      {nested && (
        <ModalShell
          open={nestedOpen}
          onClose={() => {
            onNestedClose?.()
            setNestedOpen(false)
          }}
          title="Are you sure?"
        >
          <p>Nested body</p>
        </ModalShell>
      )}
    </>
  )
}

const opener = () => host!.querySelector<HTMLButtonElement>('[data-testid="opener"]')!

async function openHarness(props: Parameters<typeof Harness>[0]) {
  await render(<Harness {...props} />)
  act(() => opener().focus())
  await click(opener())
}

describe('ModalShell', () => {
  it('renders title, labelled dialog and an icon-only close button; nothing when closed', async () => {
    await render(<Harness onClose={() => {}} />)
    expect(dialogs()).toHaveLength(0)

    await click(opener())
    const d = dialog()
    expect(d.getAttribute('aria-modal')).toBe('true')
    const title = document.getElementById(d.getAttribute('aria-labelledby')!)!
    expect(title.textContent).toBe('Outer title')
    const close = d.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
    expect(close.textContent).toBe('')
    // Panel-only overlay: fixed to the iframe viewport.
    expect(d.closest('[data-sg-modal]')!.className).toContain('fixed inset-0')
  })

  it('focus: initial focus, Tab is trapped in both directions, focus returns to the opener', async () => {
    const onClose = vi.fn()
    await openHarness({ onClose })
    const d = dialog()
    const field = d.querySelector<HTMLInputElement>('input')!
    const close = d.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
    const last = buttonIn(d, 'Confirm…')
    expect(document.activeElement).toBe(field)

    act(() => last.focus())
    await pressTab()
    expect(document.activeElement).toBe(close)

    await pressTab(true)
    expect(document.activeElement).toBe(last)

    await click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialogs()).toHaveLength(0)
    expect(document.activeElement).toBe(opener())
  })

  it('Escape goes through the layer stack', async () => {
    const onClose = vi.fn()
    expect(hasOpenLayer()).toBe(false)
    await openHarness({ onClose })
    expect(hasOpenLayer()).toBe(true)

    await escape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialogs()).toHaveLength(0)
    expect(hasOpenLayer()).toBe(false)
  })

  it('overlay click closes; a click inside the dialog does not', async () => {
    const onClose = vi.fn()
    await openHarness({ onClose })
    await click(dialog().querySelector<HTMLElement>('input')!)
    await click(dialog())
    expect(onClose).not.toHaveBeenCalled()

    await click(overlayOf(dialog()))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialogs()).toHaveLength(0)
  })

  it('nested confirm closes first; the outer dialog stays until the next Escape', async () => {
    const onClose = vi.fn()
    const onNestedClose = vi.fn()
    await openHarness({ onClose, nested: true, onNestedClose })
    // A real click focuses the button; el.click() alone does not.
    act(() => buttonIn(dialog(), 'Confirm…').focus())
    await click(buttonIn(dialog(), 'Confirm…'))
    expect(dialogs()).toHaveLength(2)
    expect(dialog().textContent).toContain('Are you sure?')

    await escape()
    expect(onNestedClose).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(dialogs()).toHaveLength(1)
    // Focus went back to the button that opened the confirm.
    expect(document.activeElement).toBe(buttonIn(dialog(), 'Confirm…'))

    await escape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialogs()).toHaveLength(0)
  })

  it('busy blocks Escape, overlay click and the close button, and keeps its place on the layer stack', async () => {
    const onClose = vi.fn()
    await openHarness({ onClose, busy: true })
    const d = dialog()
    expect(d.getAttribute('aria-busy')).toBe('true')
    expect(d.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.disabled).toBe(true)

    await escape()
    await click(overlayOf(d))
    await click(d.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!)
    expect(onClose).not.toHaveBeenCalled()
    expect(dialogs()).toHaveLength(1)
    // Still the top layer: the next Escape must not fall through to the panel.
    expect(hasOpenLayer()).toBe(true)

    await render(<Harness onClose={onClose} busy={false} />)
    await escape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialogs()).toHaveLength(0)
  })

  it('initial focus is visibly marked even when opened with a click; the mark follows normal rules after', async () => {
    // jsdom, like Chrome after a mouse click, does not match :focus-visible here.
    await render(<Harness onClose={() => {}} />)
    await click(opener())
    const d = dialog()
    const field = d.querySelector<HTMLInputElement>('input')!
    const close = d.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
    expect(document.activeElement).toBe(field)
    expect(field.getAttribute(INITIAL_FOCUS_ATTR)).toBe('true')
    expect(d.querySelectorAll(`[${INITIAL_FOCUS_ATTR}]`)).toHaveLength(1)

    // Focus moves on: the mark is gone and is not handed to the next element.
    const cancel = buttonIn(d, 'Cancel')
    act(() => cancel.focus())
    expect(field.hasAttribute(INITIAL_FOCUS_ATTR)).toBe(false)
    expect(cancel.hasAttribute(INITIAL_FOCUS_ATTR)).toBe(false)
    expect(document.querySelectorAll(`[${INITIAL_FOCUS_ATTR}]`)).toHaveLength(0)

    // Coming back to the first element does not restore the mark either.
    act(() => field.focus())
    expect(field.hasAttribute(INITIAL_FOCUS_ATTR)).toBe(false)

    await click(close)
    expect(document.querySelectorAll(`[${INITIAL_FOCUS_ATTR}]`)).toHaveLength(0)
  })

  it('the initial-focus ring is defined in index.css with the accent ring geometry', () => {
    const css = fs.readFileSync(path.resolve(HERE, '../index.css'), 'utf8')
    expect(css).toMatch(
      /\[data-sg-initial-focus="true"\]:focus \{[^}]*box-shadow:\s*0 0 0 1px rgb\(var\(--sg-bg\)\),\s*0 0 0 3px rgb\(var\(--sg-accent\)\);/,
    )
  })

  it('opening a dialog dismisses a visible hover preview', async () => {
    vi.useFakeTimers()
    const onHide = vi.fn()
    const onShow = vi.fn()
    const intent = createHoverIntent({
      showDelayMs: 10,
      hideDelayMs: 10,
      canShow: () => true,
      onShow,
      onHide,
    })
    intent.enter()
    vi.advanceTimersByTime(10)
    expect(onShow).toHaveBeenCalledTimes(1)
    vi.useRealTimers()

    await openHarness({ onClose: () => {} })
    expect(onHide).toHaveBeenCalledTimes(1)
    intent.dispose()
  })
})

function style(name: string): Style {
  return {
    name,
    source_file: 'webui/a.csv',
    prompt: `p:${name}`,
    negative_prompt: '',
    description: '',
    category: 'BODY',
  }
}

describe('dialogs on ModalShell keep their behaviour', () => {
  const savePreset = vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true }))
  const renamePreset = vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true }))
  const deletePreset = vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true }))
  const PRESET: PresetRecord = {
    styles: [{ name: 'BODY_A', source_file: 'webui/a.csv' }],
    created: '2026-10-04T17:21:28',
  }

  beforeEach(() => {
    savePreset.mockClear()
    renamePreset.mockClear()
    deletePreset.mockClear()
    const styles = [style('BODY_A'), style('BODY_B')]
    useStylesStore.setState({
      styles,
      selectedStyles: styles,
      activeWildcards: [],
      presets: {},
      toasts: [],
      savePreset,
      renamePreset,
      deletePreset,
    })
  })

  it('SaveSetDialog: title, focus on the name, Enter saves, Cancel closes', async () => {
    const onClose = vi.fn()
    await render(<SaveSetDialog open onClose={onClose} />)
    const d = dialog()
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Save set')
    const name = d.querySelector<HTMLInputElement>('input[type="text"]')!
    expect(document.activeElement).toBe(name)
    expect(name.value).toBe('A + B')
    expect(buttonIn(d, 'Save').disabled).toBe(false)

    await act(async () => {
      name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(savePreset).toHaveBeenCalledTimes(1)
    expect(savePreset.mock.calls[0][0]).toBe('A + B')
    expect(onClose).toHaveBeenCalledTimes(1)

    await click(buttonIn(dialog(), 'Cancel'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('SaveSetDialog: renders nothing when closed', async () => {
    await render(<SaveSetDialog open={false} onClose={() => {}} />)
    expect(dialogs()).toHaveLength(0)
  })

  it('PresetRow rename: labelled input holds the name, Enter renames, Escape closes', async () => {
    await render(<PresetRow name="My set" preset={PRESET} />)
    await click(buttonIn(host!, 'Rename'))
    const d = dialog()
    const titleId = d.getAttribute('aria-labelledby')!
    expect(document.getElementById(titleId)!.textContent).toBe('Rename set')
    const input = d.querySelector<HTMLInputElement>('input')!
    expect(input.getAttribute('aria-labelledby')).toBe(titleId)
    expect(input.value).toBe('My set')
    expect(document.activeElement).toBe(input)

    await escape()
    expect(dialogs()).toHaveLength(0)
    expect(renamePreset).not.toHaveBeenCalled()

    await click(buttonIn(host!, 'Rename'))
    const again = dialog().querySelector<HTMLInputElement>('input')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(again, 'Renamed')
      again.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(renamePreset).toHaveBeenCalledWith('My set', 'Renamed', { overwrite: false })
    expect(dialogs()).toHaveLength(0)
  })

  it('PresetRow delete: focus starts on Cancel, text is unchanged, Delete deletes', async () => {
    await render(<PresetRow name="My set" preset={PRESET} />)
    await click(buttonIn(host!, 'Delete'))
    const d = dialog()
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Delete set?')
    expect(d.textContent).toContain('Delete “My set” permanently? This cannot be undone.')
    expect(document.activeElement).toBe(buttonIn(d, 'Cancel'))

    await click(buttonIn(d, 'Delete'))
    expect(deletePreset).toHaveBeenCalledWith('My set')
    expect(dialogs()).toHaveLength(0)
  })
})
