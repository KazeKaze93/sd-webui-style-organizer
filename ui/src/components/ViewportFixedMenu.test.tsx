/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetLayerStackForTests,
  closeTopLayer,
  hasOpenLayer,
} from '../lib/layerStack'
import { MenuItem, ViewportFixedMenu } from './ViewportFixedMenu'

let root: Root | null = null
let host: HTMLDivElement | null = null

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
  document.body.innerHTML = ''
  __resetLayerStackForTests()
})

function MenuProbe({
  open = true,
  onClose,
  restoreFocusTo,
}: {
  open?: boolean
  onClose: () => void
  restoreFocusTo?: HTMLElement | null
}) {
  return (
    <ViewportFixedMenu open={open} x={10} y={10} onClose={onClose} restoreFocusTo={restoreFocusTo}>
      <MenuItem onSelect={vi.fn()}>Alpha</MenuItem>
      <MenuItem disabled onSelect={vi.fn()}>
        Disabled
      </MenuItem>
      <MenuItem onSelect={vi.fn()}>Bravo</MenuItem>
    </ViewportFixedMenu>
  )
}

describe('ViewportFixedMenu', () => {
  it('exposes role=menu and focuses the first enabled menuitem on open', () => {
    const onClose = vi.fn()
    act(() => {
      root!.render(<MenuProbe onClose={onClose} />)
    })

    const menu = document.querySelector('[role="menu"]')
    expect(menu).toBeTruthy()
    const items = document.querySelectorAll('[role="menuitem"]')
    expect(items.length).toBe(3)
    expect(document.activeElement?.textContent).toBe('Alpha')
    expect(hasOpenLayer()).toBe(true)
  })

  it('ArrowDown / ArrowUp wrap across enabled items and skip disabled', () => {
    const onClose = vi.fn()
    act(() => {
      root!.render(<MenuProbe onClose={onClose} />)
    })

    const menu = document.querySelector('[role="menu"]') as HTMLElement
    act(() => {
      menu.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )
    })
    expect(document.activeElement?.textContent).toBe('Bravo')

    act(() => {
      menu.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )
    })
    expect(document.activeElement?.textContent).toBe('Alpha')

    act(() => {
      menu.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
      )
    })
    expect(document.activeElement?.textContent).toBe('Bravo')
  })

  it('Home / End jump to first and last enabled items', () => {
    const onClose = vi.fn()
    act(() => {
      root!.render(<MenuProbe onClose={onClose} />)
    })
    const menu = document.querySelector('[role="menu"]') as HTMLElement

    act(() => {
      menu.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
      )
    })
    expect(document.activeElement?.textContent).toBe('Bravo')

    act(() => {
      menu.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
      )
    })
    expect(document.activeElement?.textContent).toBe('Alpha')
  })

  it('Tab closes the menu via onClose', () => {
    const onClose = vi.fn()

    function Toggle() {
      const [open, setOpen] = useState(true)
      return (
        <MenuProbe
          open={open}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        />
      )
    }

    act(() => {
      root!.render(<Toggle />)
    })
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    act(() => {
      menu.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      )
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape via layer stack closes and restores focus to restoreFocusTo', () => {
    const opener = document.createElement('button')
    opener.textContent = 'opener'
    document.body.appendChild(opener)
    opener.focus()

    const onClose = vi.fn()

    function Toggle() {
      const [open, setOpen] = useState(true)
      return (
        <MenuProbe
          open={open}
          restoreFocusTo={opener}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        />
      )
    }

    act(() => {
      root!.render(<Toggle />)
    })
    expect(document.activeElement?.textContent).toBe('Alpha')

    act(() => {
      expect(closeTopLayer()).toBe(true)
    })
    expect(onClose).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(opener)
  })

  it('Enter activates the focused MenuItem onSelect', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    act(() => {
      root!.render(
        <ViewportFixedMenu open x={0} y={0} onClose={onClose}>
          <MenuItem onSelect={onSelect}>Only</MenuItem>
        </ViewportFixedMenu>,
      )
    })

    const item = document.querySelector('[role="menuitem"]') as HTMLButtonElement
    expect(document.activeElement).toBe(item)

    act(() => {
      item.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
      item.click()
    })
    expect(onSelect).toHaveBeenCalled()
  })
})
