import { describe, expect, it } from 'vitest'
import { fitFixedMenuPosition, MENU_MARGIN, MENU_VIEWPORT_PAD } from './fitFixedMenuPosition'

describe('fitFixedMenuPosition', () => {
  const pad = MENU_MARGIN
  const vw = 800
  const vh = 600
  const menuW = 220
  const menuH = 280

  it('exports MENU_MARGIN matching MENU_VIEWPORT_PAD', () => {
    expect(MENU_MARGIN).toBe(8)
    expect(MENU_VIEWPORT_PAD).toBe(MENU_MARGIN)
  })

  it('keeps the menu at the anchor when it fits below and to the right', () => {
    expect(fitFixedMenuPosition(40, 40, menuW, menuH, vw, vh)).toEqual({ x: 40, y: 40 })
  })

  it('flips upward when the anchor is near the bottom of the viewport', () => {
    const y = 520
    const fitted = fitFixedMenuPosition(100, y, menuW, menuH, vw, vh)
    expect(fitted.y).toBe(y - menuH)
    expect(fitted.y).toBeGreaterThanOrEqual(pad)
    expect(fitted.y + menuH).toBeLessThanOrEqual(vh - pad)
  })

  it('shifts left when the menu would overflow the right edge', () => {
    const fitted = fitFixedMenuPosition(700, 40, menuW, menuH, vw, vh)
    expect(fitted.x).toBe(vw - menuW - pad)
    expect(fitted.x).toBeGreaterThanOrEqual(pad)
    expect(fitted.x + menuW).toBeLessThanOrEqual(vw - pad)
  })

  it('clamps a bottom-right corner open into the padded viewport', () => {
    const fitted = fitFixedMenuPosition(vw - 10, vh - 10, menuW, menuH, vw, vh)
    expect(fitted.x).toBe(vw - menuW - pad)
    expect(fitted.y).toBe(vh - 10 - menuH)
    expect(fitted.x).toBeGreaterThanOrEqual(pad)
    expect(fitted.y).toBeGreaterThanOrEqual(pad)
    expect(fitted.x + menuW).toBeLessThanOrEqual(vw - pad)
    expect(fitted.y + menuH).toBeLessThanOrEqual(vh - pad)
  })

  it('pins to top pad when taller than the padded viewport', () => {
    const tall = vh
    const fitted = fitFixedMenuPosition(100, vh - 10, menuW, tall, vw, vh)
    expect(fitted.y).toBe(pad)
    // Position alone cannot clear the bottom; callers must apply max-height.
    expect(fitted.y + tall).toBeGreaterThan(vh - pad)
  })

  it('clamps left/top to the pad when the anchor is off-screen', () => {
    expect(fitFixedMenuPosition(-20, -30, menuW, menuH, vw, vh)).toEqual({
      x: pad,
      y: pad,
    })
  })
})
