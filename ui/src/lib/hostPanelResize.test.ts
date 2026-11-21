/** @vitest-environment jsdom */
/**
 * Host panel frame (javascript/style_grid/handlers/panel-resize.js): fullscreen
 * is driven only by SG_SET_FULLSCREEN, answered with SG_FULLSCREEN_STATE.
 * Uses the real style.css so "handles hidden" is the stylesheet's doing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHostMessage } from '../bridge'
import {
  PANEL_GEOMETRY_STORAGE_KEY,
  PANEL_HANDLES,
} from '../../../javascript/style_grid/handlers/panel-geometry.js'
import {
  announceFullscreenState,
  answerFullscreenRequest,
  buildFullscreenStateMessage,
  installPanelResize,
} from '../../../javascript/style_grid/handlers/panel-resize.js'
import { parseFrameMessage } from '../../../javascript/style_grid/post-message.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOST_CSS = fs.readFileSync(path.resolve(HERE, '../../../style.css'), 'utf8')
const PANEL_RESIZE_SRC = fs.readFileSync(
  path.resolve(HERE, '../../../javascript/style_grid/handlers/panel-resize.js'),
  'utf8',
)

const VW = 1600
const VH = 1000
const STORED = { left: 120, top: 90, width: 900, height: 600 }

describe('host panel fullscreen', () => {
  let wrapper: HTMLDivElement
  let frame: HTMLIFrameElement
  let styleEl: HTMLStyleElement

  const handles = () => [...wrapper.querySelectorAll<HTMLElement>('.sg-resize-handle')]
  const geometry = () => ({
    left: wrapper.style.left,
    top: wrapper.style.top,
    width: wrapper.style.width,
    height: wrapper.style.height,
  })
  const storedCss = {
    left: `${STORED.left}px`,
    top: `${STORED.top}px`,
    width: `${STORED.width}px`,
    height: `${STORED.height}px`,
  }

  beforeEach(() => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: VW })
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: VH })
    localStorage.clear()
    localStorage.setItem(PANEL_GEOMETRY_STORAGE_KEY, JSON.stringify(STORED))

    styleEl = document.createElement('style')
    styleEl.textContent = HOST_CSS
    document.head.appendChild(styleEl)

    wrapper = document.createElement('div')
    wrapper.style.cssText = 'position:fixed;display:block'
    frame = document.createElement('iframe')
    wrapper.appendChild(frame)
    document.body.appendChild(wrapper)
  })

  afterEach(() => {
    wrapper.remove()
    styleEl.remove()
    localStorage.clear()
    delete (document.documentElement as unknown as Record<string, unknown>).clientWidth
    delete (document.documentElement as unknown as Record<string, unknown>).clientHeight
    vi.restoreAllMocks()
  })

  it('starts windowed at the stored geometry with eight visible handles', () => {
    const controller = installPanelResize(wrapper, frame)
    expect(controller.isFullscreen()).toBe(false)
    expect(geometry()).toEqual(storedCss)
    expect(wrapper.hasAttribute('data-sg-fullscreen')).toBe(false)
    expect(handles().map((h) => h.getAttribute('data-sg-handle')).sort()).toEqual([...PANEL_HANDLES].sort())
    for (const h of handles()) expect(getComputedStyle(h).display).not.toBe('none')
  })

  it('SG_SET_FULLSCREEN true: attribute set, handles hidden, reply sent', () => {
    const controller = installPanelResize(wrapper, frame)
    const post = vi.fn()
    const request = parseFrameMessage({ type: 'SG_SET_FULLSCREEN', fullscreen: true })!

    expect(answerFullscreenRequest(controller, frame, request.fullscreen as boolean, post)).toBe(true)

    expect(controller.isFullscreen()).toBe(true)
    expect(wrapper.getAttribute('data-sg-fullscreen')).toBe('true')
    expect(geometry()).toEqual({ left: '0px', top: '0px', width: '100vw', height: '100vh' })
    expect(Number.parseFloat(wrapper.style.borderRadius)).toBe(0)
    for (const h of handles()) expect(getComputedStyle(h).display).toBe('none')

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(frame, { type: 'SG_FULLSCREEN_STATE', fullscreen: true })
    // The reply is exactly what the iframe's guard accepts.
    expect(parseHostMessage(post.mock.calls[0][1])).toEqual({
      type: 'SG_FULLSCREEN_STATE',
      fullscreen: true,
    })
  })

  it('SG_SET_FULLSCREEN false: stored geometry restored, handles back, reply sent', () => {
    const controller = installPanelResize(wrapper, frame)
    const post = vi.fn()
    answerFullscreenRequest(controller, frame, true, post)
    answerFullscreenRequest(controller, frame, false, post)

    expect(controller.isFullscreen()).toBe(false)
    expect(wrapper.hasAttribute('data-sg-fullscreen')).toBe(false)
    expect(geometry()).toEqual(storedCss)
    expect(wrapper.style.borderRadius).toBe('12px')
    for (const h of handles()) expect(getComputedStyle(h).display).not.toBe('none')
    expect(post).toHaveBeenLastCalledWith(frame, { type: 'SG_FULLSCREEN_STATE', fullscreen: false })
  })

  it('a request for the current state changes nothing but is still answered', () => {
    const controller = installPanelResize(wrapper, frame)
    const post = vi.fn()
    answerFullscreenRequest(controller, frame, false, post)
    expect(geometry()).toEqual(storedCss)
    expect(post).toHaveBeenCalledWith(frame, { type: 'SG_FULLSCREEN_STATE', fullscreen: false })
  })

  it('fullscreen ignores window resize and survives hide / show; windowed re-reads the shared geometry on show', () => {
    const controller = installPanelResize(wrapper, frame)
    controller.setFullscreen(true)

    window.dispatchEvent(new Event('resize'))
    wrapper.style.display = 'none'
    wrapper.style.display = 'block'
    controller.syncOnShow()
    expect(controller.isFullscreen()).toBe(true)
    expect(wrapper.style.width).toBe('100vw')

    controller.setFullscreen(false)
    // The other tab's panel stored a new geometry while this one was hidden.
    const other = { left: 300, top: 200, width: 700, height: 500 }
    localStorage.setItem(PANEL_GEOMETRY_STORAGE_KEY, JSON.stringify(other))
    controller.syncOnShow()
    expect(geometry()).toEqual({ left: '300px', top: '200px', width: '700px', height: '500px' })
  })

  it('announceFullscreenState reports the state without changing it (iframe SG_READY)', () => {
    const controller = installPanelResize(wrapper, frame)
    const post = vi.fn()
    announceFullscreenState(controller, frame, post)
    expect(post).toHaveBeenLastCalledWith(frame, { type: 'SG_FULLSCREEN_STATE', fullscreen: false })
    controller.setFullscreen(true)
    announceFullscreenState(controller, frame, post)
    expect(post).toHaveBeenLastCalledWith(frame, { type: 'SG_FULLSCREEN_STATE', fullscreen: true })
    expect(controller.isFullscreen()).toBe(true)
  })

  it('without a controller nothing is posted', () => {
    const post = vi.fn()
    expect(answerFullscreenRequest(null, frame, true, post)).toBe(false)
    expect(announceFullscreenState(undefined, frame, post)).toBe(false)
    expect(post).not.toHaveBeenCalled()
    expect(buildFullscreenStateMessage(true)).toEqual({ type: 'SG_FULLSCREEN_STATE', fullscreen: true })
  })

  it('styles written into the wrapper from outside no longer switch fullscreen', async () => {
    const controller = installPanelResize(wrapper, frame)
    // What the iframe used to do: write fullscreen sizes straight into the host wrapper.
    wrapper.style.width = '100vw'
    wrapper.style.height = '100vh'
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.isFullscreen()).toBe(false)
    expect(wrapper.hasAttribute('data-sg-fullscreen')).toBe(false)
    expect(PANEL_RESIZE_SRC).not.toContain('MutationObserver')
  })
})
