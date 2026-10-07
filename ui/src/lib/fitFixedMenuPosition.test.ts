import { describe, expect, it } from 'vitest'
import { fitFixedMenuPosition, MENU_VIEWPORT_PAD } from './fitFixedMenuPosition'

describe('fitFixedMenuPosition', () => {
  const pad = MENU_VIEWPORT_PAD
  const vw = 800
  const vh = 600
  const menuW = 220
  const menuH = 280

  it('keeps the menu at the anchor when it fits below and to the right', () => {
    expect(fitFixedMenuPosition(40, 40, menuW, menuH, vw, vh)).toEqual({ x: 40, y: 40 })
  })

  it('flips upward when the anchor is near the bottom of the viewport', () => {
    const y = 520
    const fitted = fitFixedMenuPosition(100, y, menuW, menuH, vw, vh)
    expect(fitted.y).toBe(y - menuH)
    expect(fitted.y + menuH).toBeLessThanOrEqual(vh - pad)
  })

  it('clamps to the top pad when a tall menu cannot flip fully above', () => {
    const tall = 620
    const fitted = fitFixedMenuPosition(100, 100, menuW, tall, vw, vh)
    expect(fitted.y).toBe(pad)
  })

  it('shifts left when the menu would overflow the right edge', () => {
    const fitted = fitFixedMenuPosition(700, 40, menuW, menuH, vw, vh)
    expect(fitted.x).toBe(vw - menuW - pad)
    expect(fitted.x + menuW).toBeLessThanOrEqual(vw - pad)
  })

  it('clamps left/top to the pad when the anchor is off-screen', () => {
    expect(fitFixedMenuPosition(-20, -30, menuW, menuH, vw, vh)).toEqual({
      x: pad,
      y: pad,
    })
  })
})
