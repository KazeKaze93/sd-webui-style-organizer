/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { measureOverlayHeight, measureTileLabel } from './tileLabelMetrics'

/** jsdom has no layout: give the tile, its label and the text range fixed boxes. */
function setup(opts: { textWidth: number; tileWidth: number; tileRectWidth?: number; labelWidth: number }) {
  const tile = document.createElement('button')
  const label = document.createElement('div')
  label.setAttribute('data-sg-grid-label', 'true')
  label.style.paddingRight = '16px'
  label.textContent = 'Some style name'
  tile.appendChild(label)
  document.body.appendChild(tile)
  Object.defineProperty(tile, 'offsetWidth', { configurable: true, value: opts.tileWidth })
  Object.defineProperty(label, 'clientWidth', { configurable: true, value: opts.labelWidth })
  tile.getBoundingClientRect = () => ({ width: opts.tileRectWidth ?? opts.tileWidth }) as DOMRect
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: opts.textWidth }) as DOMRect,
  })
  return tile
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('measureTileLabel', () => {
  it('a name wider than the label content box is truncated; chrome = tile width - content width', () => {
    // Tile 150: label clientWidth 132 (tile minus border 2 and p-2 16) minus pr-4 16 = 116.
    const tile = setup({ textWidth: 180.3, tileWidth: 150, labelWidth: 132 })
    expect(measureTileLabel(tile)).toEqual({
      truncated: true,
      textWidth: 180.3,
      contentWidth: 116,
      chrome: 34,
    })
  })

  it('a name that fits (within half a pixel) is not truncated', () => {
    expect(measureTileLabel(setup({ textWidth: 116.4, tileWidth: 150, labelWidth: 132 }))!.truncated).toBe(false)
    expect(measureTileLabel(setup({ textWidth: 90, tileWidth: 150, labelWidth: 132 }))!.truncated).toBe(false)
  })

  it('undoes the hover scale of the tile', () => {
    // Scaled 1.02: the range and the tile rect are both 2% wider than the layout box.
    const tile = setup({ textWidth: 204, tileWidth: 150, tileRectWidth: 153, labelWidth: 132 })
    const m = measureTileLabel(tile)!
    expect(m.textWidth).toBeCloseTo(200, 6)
    expect(m.chrome).toBe(34)
  })

  it('returns null without a grid label', () => {
    const tile = document.createElement('button')
    document.body.appendChild(tile)
    expect(measureTileLabel(tile)).toBeNull()
  })
})

describe('measureOverlayHeight', () => {
  it('reads the border-box height', () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 82 })
    expect(measureOverlayHeight(el)).toBe(82)
  })
})
