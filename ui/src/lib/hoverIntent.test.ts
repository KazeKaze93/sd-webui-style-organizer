/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHoverIntent, dismissAllHoverIntents, type HoverIntent } from './hoverIntent'

const SHOW_MS = 300
const HIDE_MS = 100

function setup(canShow: () => boolean = () => true) {
  const onShow = vi.fn()
  const onHide = vi.fn()
  const intent = createHoverIntent({
    showDelayMs: SHOW_MS,
    hideDelayMs: HIDE_MS,
    canShow,
    onShow,
    onHide,
  })
  return { intent, onShow, onHide }
}

describe('hoverIntent', () => {
  const created: HoverIntent[] = []
  const make = (canShow?: () => boolean) => {
    const s = setup(canShow)
    created.push(s.intent)
    return s
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    for (const intent of created.splice(0)) intent.dispose()
    vi.useRealTimers()
  })

  it('shows once after the delay on a single enter', () => {
    const { intent, onShow } = make()
    intent.enter()
    vi.advanceTimersByTime(SHOW_MS - 1)
    expect(onShow).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  it('two starts followed by one cancel produce no show', () => {
    const { intent, onShow } = make()
    intent.enter()
    intent.enter()
    intent.leave()
    vi.advanceTimersByTime(SHOW_MS * 4)
    expect(onShow).not.toHaveBeenCalled()
  })

  it('two starts without a cancel show exactly once', () => {
    const { intent, onShow } = make()
    intent.enter()
    intent.enter()
    vi.advanceTimersByTime(SHOW_MS * 4)
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  it('a fire while not hovered produces no show', () => {
    let hovered = true
    const { intent, onShow } = make(() => hovered)
    intent.enter()
    hovered = false
    vi.advanceTimersByTime(SHOW_MS * 4)
    expect(onShow).not.toHaveBeenCalled()
  })

  it('leave hides after the hide delay; hold cancels the pending hide', () => {
    const { intent, onShow, onHide } = make()
    intent.enter()
    vi.advanceTimersByTime(SHOW_MS)
    expect(onShow).toHaveBeenCalledTimes(1)

    intent.leave()
    intent.hold()
    vi.advanceTimersByTime(HIDE_MS * 4)
    expect(onHide).not.toHaveBeenCalled()

    intent.leave()
    vi.advanceTimersByTime(HIDE_MS)
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('dismiss cancels a pending show and hides immediately', () => {
    const { intent, onShow, onHide } = make()
    intent.enter()
    intent.dismiss()
    expect(onHide).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(SHOW_MS * 4)
    expect(onShow).not.toHaveBeenCalled()
  })

  it('window blur dismisses pending and visible popups, and leaves idle ones alone', () => {
    const pending = make()
    const visible = make()
    const idle = make()

    visible.intent.enter()
    vi.advanceTimersByTime(SHOW_MS)
    expect(visible.onShow).toHaveBeenCalledTimes(1)
    pending.intent.enter()

    window.dispatchEvent(new Event('blur'))

    expect(visible.onHide).toHaveBeenCalledTimes(1)
    expect(pending.onHide).toHaveBeenCalledTimes(1)
    expect(idle.onHide).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SHOW_MS * 4)
    expect(pending.onShow).not.toHaveBeenCalled()
  })

  it('pointer leaving the document dismisses a pending show', () => {
    const { intent, onShow, onHide } = make()
    intent.enter()
    document.documentElement.dispatchEvent(new Event('mouseleave'))
    expect(onHide).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(SHOW_MS * 4)
    expect(onShow).not.toHaveBeenCalled()
  })

  it('dismissAllHoverIntents is a no-op when nothing is live', () => {
    const { onHide } = make()
    dismissAllHoverIntents()
    expect(onHide).not.toHaveBeenCalled()
  })
})
