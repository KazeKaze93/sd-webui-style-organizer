/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetLayerStackForTests,
  closeTopLayer,
  hasOpenLayer,
  registerLayer,
  useLayer,
} from './layerStack'

describe('layerStack', () => {
  beforeEach(() => {
    __resetLayerStackForTests()
  })

  afterEach(() => {
    __resetLayerStackForTests()
  })

  it('closes layers LIFO', () => {
    const a = vi.fn()
    const b = vi.fn()
    const c = vi.fn()
    registerLayer('a', a)
    registerLayer('b', b)
    registerLayer('c', c)

    expect(hasOpenLayer()).toBe(true)
    expect(closeTopLayer()).toBe(true)
    expect(c).toHaveBeenCalledOnce()
    expect(b).not.toHaveBeenCalled()
    expect(a).not.toHaveBeenCalled()

    expect(closeTopLayer()).toBe(true)
    expect(b).toHaveBeenCalledOnce()
    expect(a).not.toHaveBeenCalled()

    expect(closeTopLayer()).toBe(true)
    expect(a).toHaveBeenCalledOnce()
    expect(hasOpenLayer()).toBe(false)
    expect(closeTopLayer()).toBe(false)
  })

  it('unregister removes a middle layer without closing others', () => {
    const a = vi.fn()
    const b = vi.fn()
    const c = vi.fn()
    registerLayer('a', a)
    const unregisterB = registerLayer('b', b)
    registerLayer('c', c)

    unregisterB()
    expect(closeTopLayer()).toBe(true)
    expect(c).toHaveBeenCalledOnce()
    expect(b).not.toHaveBeenCalled()
    expect(closeTopLayer()).toBe(true)
    expect(a).toHaveBeenCalledOnce()
    expect(hasOpenLayer()).toBe(false)
  })

  it('unregister after closeTopLayer is a no-op', () => {
    const close = vi.fn()
    const unregister = registerLayer('x', close)
    expect(closeTopLayer()).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    expect(() => unregister()).not.toThrow()
    expect(hasOpenLayer()).toBe(false)
  })
})

describe('useLayer', () => {
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
    __resetLayerStackForTests()
  })

  it('registers while open and unregisters on unmount', () => {
    const close = vi.fn()

    function Probe({ open }: { open: boolean }) {
      useLayer(open, close)
      return null
    }

    act(() => {
      root!.render(<Probe open={true} />)
    })
    expect(hasOpenLayer()).toBe(true)

    act(() => {
      root!.unmount()
    })
    root = null
    expect(hasOpenLayer()).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it('unregisters when open becomes false without calling close', () => {
    const close = vi.fn()

    function Probe({ open }: { open: boolean }) {
      useLayer(open, close)
      return null
    }

    act(() => {
      root!.render(<Probe open={true} />)
    })
    expect(hasOpenLayer()).toBe(true)

    act(() => {
      root!.render(<Probe open={false} />)
    })
    expect(hasOpenLayer()).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it('closeTopLayer invokes the live close callback from the hook', () => {
    const onClose = vi.fn()

    function Probe() {
      const [open, setOpen] = useState(true)
      useLayer(open, () => {
        onClose()
        setOpen(false)
      })
      return null
    }

    act(() => {
      root!.render(<Probe />)
    })
    expect(hasOpenLayer()).toBe(true)

    act(() => {
      expect(closeTopLayer()).toBe(true)
    })
    expect(onClose).toHaveBeenCalledOnce()
    expect(hasOpenLayer()).toBe(false)
  })
})
