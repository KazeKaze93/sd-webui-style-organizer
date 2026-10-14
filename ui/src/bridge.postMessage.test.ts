/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isTrustedHostEvent,
  onHostMessage,
  parseHostMessage,
  sendToHost,
} from './bridge'
import {
  bridgeOrigin,
  isTrustedIframeEvent,
  parseFrameMessage,
  postToFrame,
} from '../../javascript/style_grid/post-message.js'

describe('parseHostMessage', () => {
  it('accepts valid SG_THEME', () => {
    expect(parseHostMessage({ type: 'SG_THEME', mode: 'dark' })).toEqual({
      type: 'SG_THEME',
      mode: 'dark',
    })
  })

  it('ignores unknown types', () => {
    expect(parseHostMessage({ type: 'SG_NOT_A_REAL_TYPE' })).toBeNull()
    expect(parseHostMessage({ type: 'OTHER' })).toBeNull()
  })

  it('ignores malformed payloads', () => {
    expect(parseHostMessage(null)).toBeNull()
    expect(parseHostMessage({ type: 'SG_THEME', mode: 'neon' })).toBeNull()
    expect(parseHostMessage({ type: 'SG_TOAST', message: 1, variant: 'info' })).toBeNull()
    expect(
      parseHostMessage({ type: 'SG_THUMB_DONE', styleId: 'x', version: '1', source_file: '' }),
    ).toBeNull()
    expect(parseHostMessage({ type: 'SG_INIT', tab: 'other', styles: [] })).toBeNull()
  })
})

describe('parseFrameMessage (host)', () => {
  it('accepts valid SG_READY / SG_APPLY', () => {
    expect(parseFrameMessage({ type: 'SG_READY' })).toEqual({ type: 'SG_READY' })
    expect(
      parseFrameMessage({
        type: 'SG_APPLY',
        styleId: 'A',
        prompt: 'p',
        neg: 'n',
        source_file: 'f.csv',
      }),
    ).toMatchObject({ type: 'SG_APPLY', styleId: 'A' })
  })

  it('ignores unknown and malformed', () => {
    expect(parseFrameMessage({ type: 'SG_NOPE' })).toBeNull()
    expect(parseFrameMessage({ type: 'SG_APPLY', styleId: 'A' })).toBeNull()
    expect(parseFrameMessage({ type: 'SG_SOURCE_CHANGE', source: 1 })).toBeNull()
  })
})

describe('host↔iframe trust guards', () => {
  /** jsdom sets window.parent === window; stub a distinct host parent for source checks. */
  const hostParent = { postMessage: vi.fn() } as unknown as Window

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: window,
    })
  })

  function stubHostParent(): void {
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: hostParent,
    })
  }

  it('isTrustedHostEvent rejects foreign origin and wrong source', () => {
    stubHostParent()
    expect(
      isTrustedHostEvent({
        origin: 'https://evil.example',
        source: hostParent,
        data: { type: 'SG_CLOSE' },
      } as unknown as MessageEvent),
    ).toBe(false)
    expect(
      isTrustedHostEvent({
        origin: bridgeOrigin(),
        source: window,
        data: { type: 'SG_CLOSE' },
      } as unknown as MessageEvent),
    ).toBe(false)
    expect(
      isTrustedHostEvent({
        origin: bridgeOrigin(),
        source: hostParent,
        data: { type: 'SG_CLOSE' },
      } as unknown as MessageEvent),
    ).toBe(true)
  })

  it('isTrustedIframeEvent rejects foreign origin and wrong source', () => {
    const frame = {
      contentWindow: {} as Window,
    } as HTMLIFrameElement
    const other = {} as Window
    expect(
      isTrustedIframeEvent(
        {
          origin: 'https://evil.example',
          source: frame.contentWindow,
        } as unknown as MessageEvent,
        frame,
      ),
    ).toBe(false)
    expect(
      isTrustedIframeEvent(
        {
          origin: bridgeOrigin(),
          source: other,
        } as unknown as MessageEvent,
        frame,
      ),
    ).toBe(false)
    expect(
      isTrustedIframeEvent(
        {
          origin: bridgeOrigin(),
          source: frame.contentWindow,
        } as unknown as MessageEvent,
        frame,
      ),
    ).toBe(true)
  })

  it('onHostMessage ignores foreign-origin, wrong-source, malformed; handles valid', () => {
    stubHostParent()
    let listener: ((e: MessageEvent) => void) | undefined
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, fn) => {
      if (type === 'message') {
        listener = fn as (e: MessageEvent) => void
      }
    })
    const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(() => {})

    const handled: string[] = []
    const unsub = onHostMessage((msg) => {
      handled.push(msg.type)
    })
    expect(listener).toBeTypeOf('function')

    const fire = (partial: Pick<MessageEvent, 'origin' | 'source' | 'data'>) => {
      listener!(partial as unknown as MessageEvent)
    }

    fire({
      origin: 'https://evil.example',
      source: hostParent,
      data: { type: 'SG_CLOSE' },
    })
    fire({
      origin: window.location.origin,
      source: window,
      data: { type: 'SG_CLOSE' },
    })
    fire({
      origin: window.location.origin,
      source: hostParent,
      data: { type: 'SG_THEME', mode: 'neon' },
    })
    fire({
      origin: window.location.origin,
      source: hostParent,
      data: { type: 'SG_CLOSE' },
    })

    expect(handled).toEqual(['SG_CLOSE'])
    unsub()
    expect(removeSpy).toHaveBeenCalled()
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('sendToHost and postToFrame use window.location.origin', () => {
    stubHostParent()
    sendToHost({ type: 'SG_READY' })
    expect(hostParent.postMessage).toHaveBeenCalledWith(
      { type: 'SG_READY' },
      window.location.origin,
    )

    const target = { postMessage: vi.fn() }
    const frame = { contentWindow: target } as unknown as HTMLIFrameElement
    postToFrame(frame, { type: 'SG_CLEAR_SELECTION' })
    expect(target.postMessage).toHaveBeenCalledWith(
      { type: 'SG_CLEAR_SELECTION' },
      window.location.origin,
    )
  })
})
