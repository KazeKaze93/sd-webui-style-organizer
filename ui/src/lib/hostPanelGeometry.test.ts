/**
 * Host panel geometry (javascript/style_grid/handlers/panel-geometry.js): pure
 * resize math, viewport clamping and storage. Also the host-side guard for the
 * SG_SET_FULLSCREEN request, which the iframe does not send yet.
 */
import { describe, expect, it } from 'vitest'
import {
  CORNER_HIT_PX,
  EDGE_HIT_PX,
  PANEL_DEFAULT_HEIGHT,
  PANEL_DEFAULT_RIGHT_GAP,
  PANEL_DEFAULT_TOP,
  PANEL_DEFAULT_WIDTH,
  PANEL_GEOMETRY_STORAGE_KEY,
  PANEL_HANDLES,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_SIZE,
  PANEL_MIN_WIDTH,
  VIEWPORT_MARGIN,
  applyHandleDelta,
  clampToViewport,
  clearStoredGeometry,
  defaultGeometry,
  hasStoredGeometry,
  limitResizeToViewport,
  parseStoredGeometry,
  readStoredGeometry,
  writeStoredGeometry,
} from '../../../javascript/style_grid/handlers/panel-geometry.js'
import { parseFrameMessage } from '../../../javascript/style_grid/post-message.js'

type Geometry = { left: number; top: number; width: number; height: number }

const VW = 1920
const VH = 1080
const START: Geometry = { left: 500, top: 200, width: 1000, height: 650 }
const right = (g: Geometry) => g.left + g.width
const bottom = (g: Geometry) => g.top + g.height

function memoryStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial }
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    removeItem: (key: string) => {
      delete data[key]
    },
  }
}

describe('panel geometry constants', () => {
  it('match the approved values', () => {
    expect(PANEL_MIN_SIZE).toEqual({ width: 600, height: 400 })
    expect([PANEL_MIN_WIDTH, PANEL_MIN_HEIGHT]).toEqual([600, 400])
    expect([PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_HEIGHT]).toEqual([1000, 650])
    expect([PANEL_DEFAULT_TOP, PANEL_DEFAULT_RIGHT_GAP]).toEqual([80, 16])
    expect(VIEWPORT_MARGIN).toBe(8)
    expect([EDGE_HIT_PX, CORNER_HIT_PX]).toEqual([6, 12])
    expect(PANEL_GEOMETRY_STORAGE_KEY).toBe('sg_panel_geometry_v1')
    expect([...PANEL_HANDLES].sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'])
  })
})

describe('applyHandleDelta: every handle direction', () => {
  const DX = 40
  const DY = 30

  it('e: right edge follows the pointer, everything else stays', () => {
    expect(applyHandleDelta(START, 'e', DX, DY, PANEL_MIN_SIZE)).toEqual({ ...START, width: 1040 })
    expect(applyHandleDelta(START, 'e', -DX, DY, PANEL_MIN_SIZE)).toEqual({ ...START, width: 960 })
  })

  it('w: left edge follows the pointer, right edge stays', () => {
    const grown = applyHandleDelta(START, 'w', -DX, DY, PANEL_MIN_SIZE)
    expect(grown).toEqual({ ...START, left: 460, width: 1040 })
    expect(right(grown)).toBe(right(START))
    const shrunk = applyHandleDelta(START, 'w', DX, DY, PANEL_MIN_SIZE)
    expect(shrunk).toEqual({ ...START, left: 540, width: 960 })
    expect(right(shrunk)).toBe(right(START))
  })

  it('s: bottom edge follows the pointer', () => {
    expect(applyHandleDelta(START, 's', DX, DY, PANEL_MIN_SIZE)).toEqual({ ...START, height: 680 })
    expect(applyHandleDelta(START, 's', DX, -DY, PANEL_MIN_SIZE)).toEqual({ ...START, height: 620 })
  })

  it('n: top edge follows the pointer, bottom edge stays', () => {
    const grown = applyHandleDelta(START, 'n', DX, -DY, PANEL_MIN_SIZE)
    expect(grown).toEqual({ ...START, top: 170, height: 680 })
    expect(bottom(grown)).toBe(bottom(START))
    const shrunk = applyHandleDelta(START, 'n', DX, DY, PANEL_MIN_SIZE)
    expect(shrunk).toEqual({ ...START, top: 230, height: 620 })
    expect(bottom(shrunk)).toBe(bottom(START))
  })

  it('corners combine their two edges', () => {
    expect(applyHandleDelta(START, 'se', DX, DY, PANEL_MIN_SIZE)).toEqual({
      ...START,
      width: 1040,
      height: 680,
    })
    expect(applyHandleDelta(START, 'nw', -DX, -DY, PANEL_MIN_SIZE)).toEqual({
      left: 460,
      top: 170,
      width: 1040,
      height: 680,
    })
    expect(applyHandleDelta(START, 'ne', DX, -DY, PANEL_MIN_SIZE)).toEqual({
      left: 500,
      top: 170,
      width: 1040,
      height: 680,
    })
    expect(applyHandleDelta(START, 'sw', -DX, DY, PANEL_MIN_SIZE)).toEqual({
      left: 460,
      top: 200,
      width: 1040,
      height: 680,
    })
  })

  it('does not mutate the start geometry and uses the default minimum when none is given', () => {
    const start = { ...START }
    applyHandleDelta(start, 'nw', 10, 10, PANEL_MIN_SIZE)
    expect(start).toEqual(START)
    expect(applyHandleDelta(START, 'e', -5000, 0).width).toBe(PANEL_MIN_WIDTH)
  })
})

describe('applyHandleDelta: minimum size from each side', () => {
  const FAR = 5000

  it('e stops at the minimum width; left edge stays', () => {
    const g = applyHandleDelta(START, 'e', -FAR, 0, PANEL_MIN_SIZE)
    expect(g).toEqual({ ...START, width: PANEL_MIN_WIDTH })
  })

  it('w stops at the minimum width; right edge stays', () => {
    const g = applyHandleDelta(START, 'w', FAR, 0, PANEL_MIN_SIZE)
    expect(g.width).toBe(PANEL_MIN_WIDTH)
    expect(right(g)).toBe(right(START))
    expect(g.left).toBe(right(START) - PANEL_MIN_WIDTH)
  })

  it('s stops at the minimum height; top edge stays', () => {
    const g = applyHandleDelta(START, 's', 0, -FAR, PANEL_MIN_SIZE)
    expect(g).toEqual({ ...START, height: PANEL_MIN_HEIGHT })
  })

  it('n stops at the minimum height; bottom edge stays', () => {
    const g = applyHandleDelta(START, 'n', 0, FAR, PANEL_MIN_SIZE)
    expect(g.height).toBe(PANEL_MIN_HEIGHT)
    expect(bottom(g)).toBe(bottom(START))
    expect(g.top).toBe(bottom(START) - PANEL_MIN_HEIGHT)
  })

  it('a corner clamps both axes independently', () => {
    const g = applyHandleDelta(START, 'nw', FAR, FAR, PANEL_MIN_SIZE)
    expect(g).toEqual({
      left: right(START) - PANEL_MIN_WIDTH,
      top: bottom(START) - PANEL_MIN_HEIGHT,
      width: PANEL_MIN_WIDTH,
      height: PANEL_MIN_HEIGHT,
    })
  })

  it('honours a custom minimum', () => {
    expect(applyHandleDelta(START, 'e', -FAR, 0, { width: 700, height: 500 }).width).toBe(700)
    expect(applyHandleDelta(START, 's', 0, -FAR, { width: 700, height: 500 }).height).toBe(500)
  })
})

describe('limitResizeToViewport: the dragged edge stops at the margin', () => {
  it('e and s stop at the right and bottom margins', () => {
    const wide = applyHandleDelta(START, 'se', 5000, 5000, PANEL_MIN_SIZE)
    const g = limitResizeToViewport(wide, 'se', VW, VH, VIEWPORT_MARGIN)
    expect(g.left).toBe(START.left)
    expect(g.top).toBe(START.top)
    expect(right(g)).toBe(VW - VIEWPORT_MARGIN)
    expect(bottom(g)).toBe(VH - VIEWPORT_MARGIN)
  })

  it('w and n stop at the left and top margins; the opposite edges stay', () => {
    const wide = applyHandleDelta(START, 'nw', -5000, -5000, PANEL_MIN_SIZE)
    const g = limitResizeToViewport(wide, 'nw', VW, VH, VIEWPORT_MARGIN)
    expect(g.left).toBe(VIEWPORT_MARGIN)
    expect(g.top).toBe(VIEWPORT_MARGIN)
    expect(right(g)).toBe(right(START))
    expect(bottom(g)).toBe(bottom(START))
  })

  it('leaves a geometry inside the viewport untouched', () => {
    for (const handle of PANEL_HANDLES) {
      expect(limitResizeToViewport(START, handle, VW, VH, VIEWPORT_MARGIN)).toEqual(START)
    }
  })
})

describe('clampToViewport', () => {
  it('keeps a geometry that already fits', () => {
    expect(clampToViewport(START, VW, VH, VIEWPORT_MARGIN)).toEqual(START)
  })

  it('moves a panel that hangs off each side back inside the margins', () => {
    expect(clampToViewport({ ...START, left: -300 }, VW, VH, VIEWPORT_MARGIN).left).toBe(VIEWPORT_MARGIN)
    expect(clampToViewport({ ...START, top: -300 }, VW, VH, VIEWPORT_MARGIN).top).toBe(VIEWPORT_MARGIN)
    const offRight = clampToViewport({ ...START, left: 1800 }, VW, VH, VIEWPORT_MARGIN)
    expect(right(offRight)).toBe(VW - VIEWPORT_MARGIN)
    expect(offRight.width).toBe(START.width)
    const offBottom = clampToViewport({ ...START, top: 900 }, VW, VH, VIEWPORT_MARGIN)
    expect(bottom(offBottom)).toBe(VH - VIEWPORT_MARGIN)
    expect(offBottom.height).toBe(START.height)
  })

  it('shrinks a panel larger than the viewport to the space between the margins', () => {
    const g = clampToViewport({ left: 0, top: 0, width: 3000, height: 2000 }, 1280, 720, VIEWPORT_MARGIN)
    expect(g).toEqual({ left: 8, top: 8, width: 1264, height: 704 })
  })

  it('never goes below the minimum size, even in a viewport smaller than the panel', () => {
    const g = clampToViewport(START, 500, 300, VIEWPORT_MARGIN)
    expect(g).toEqual({
      left: VIEWPORT_MARGIN,
      top: VIEWPORT_MARGIN,
      width: PANEL_MIN_WIDTH,
      height: PANEL_MIN_HEIGHT,
    })
    expect(clampToViewport({ ...START, width: 10, height: 10 }, VW, VH, VIEWPORT_MARGIN)).toMatchObject({
      width: PANEL_MIN_WIDTH,
      height: PANEL_MIN_HEIGHT,
    })
  })

  it('uses the default margin when none is given', () => {
    expect(clampToViewport({ ...START, left: -50 }, VW, VH).left).toBe(VIEWPORT_MARGIN)
  })
})

describe('defaultGeometry (also the double-click reset target)', () => {
  it('is 1000x650, 80px from the top and 16px from the right edge', () => {
    const g = defaultGeometry(VW, VH)
    expect(g).toEqual({ left: VW - 16 - 1000, top: 80, width: 1000, height: 650 })
    expect(VW - right(g)).toBe(PANEL_DEFAULT_RIGHT_GAP)
  })

  it('fits a small viewport', () => {
    expect(defaultGeometry(900, 600)).toEqual({ left: 8, top: 8, width: 884, height: 584 })
  })

  it('reset: clearing a custom geometry reads back as the default for any viewport', () => {
    const storage = memoryStorage()
    expect(hasStoredGeometry(storage)).toBe(false)
    writeStoredGeometry(storage, { left: 30, top: 40, width: 700, height: 500 })
    expect(hasStoredGeometry(storage)).toBe(true)
    expect(readStoredGeometry(storage, VW, VH)).toEqual({ left: 30, top: 40, width: 700, height: 500 })

    expect(clearStoredGeometry(storage)).toBe(true)
    expect(hasStoredGeometry(storage)).toBe(false)
    expect(Object.keys(storage.data)).toEqual([])
    // Reset on a small screen must not freeze the clamped size: a larger
    // viewport later gets the full default again.
    expect(readStoredGeometry(storage, 900, 600)).toEqual(defaultGeometry(900, 600))
    expect(readStoredGeometry(storage, VW, VH)).toEqual({
      left: VW - 16 - 1000,
      top: 80,
      width: 1000,
      height: 650,
    })
  })

  it('clearStoredGeometry reports refusal and does not hide other errors', () => {
    expect(clearStoredGeometry(null)).toBe(false)
    expect(
      clearStoredGeometry({
        removeItem() {
          throw new DOMException('denied', 'SecurityError')
        },
      }),
    ).toBe(false)
    expect(() =>
      clearStoredGeometry({
        removeItem() {
          throw new TypeError('programming error')
        },
      }),
    ).toThrow(TypeError)
    expect(hasStoredGeometry(memoryStorage({ sg_panel_geometry_v1: '{broken' }))).toBe(false)
  })
})

describe('stored geometry', () => {
  it('round-trips through the shared key, rounded to whole px', () => {
    const storage = memoryStorage()
    expect(writeStoredGeometry(storage, { left: 100.4, top: 50.6, width: 800.2, height: 600.9 })).toBe(true)
    expect(Object.keys(storage.data)).toEqual([PANEL_GEOMETRY_STORAGE_KEY])
    expect(readStoredGeometry(storage, VW, VH)).toEqual({ left: 100, top: 51, width: 800, height: 601 })
  })

  it('a stored geometry is clamped to the current viewport on read', () => {
    const storage = memoryStorage()
    writeStoredGeometry(storage, { left: 1500, top: 700, width: 1000, height: 650 })
    expect(readStoredGeometry(storage, 1280, 720)).toEqual({ left: 272, top: 62, width: 1000, height: 650 })
  })

  it('missing value gives the default', () => {
    expect(readStoredGeometry(memoryStorage(), VW, VH)).toEqual(defaultGeometry(VW, VH))
    expect(readStoredGeometry(null, VW, VH)).toEqual(defaultGeometry(VW, VH))
  })

  it.each([
    ['not JSON', '{left:'],
    ['empty string', ''],
    ['JSON null', 'null'],
    ['an array', '[1,2,3,4]'],
    ['a number', '42'],
    ['missing field', '{"left":1,"top":2,"width":800}'],
    ['string field', '{"left":"1","top":2,"width":800,"height":600}'],
    ['non-finite field', '{"left":1,"top":2,"width":1e999,"height":600}'],
    ['zero size', '{"left":1,"top":2,"width":0,"height":600}'],
    ['legacy sg_windowed_size shape', '{"top":"80px","right":"16px","width":"1000px","height":"650px"}'],
  ])('corrupt value (%s) gives the default', (_label, raw) => {
    expect(parseStoredGeometry(raw)).toBeNull()
    const storage = memoryStorage({ [PANEL_GEOMETRY_STORAGE_KEY]: raw })
    expect(readStoredGeometry(storage, VW, VH)).toEqual(defaultGeometry(VW, VH))
  })

  it('blocked storage (DOMException) gives the default on read and false on write', () => {
    const blocked = {
      getItem() {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem() {
        throw new DOMException('full', 'QuotaExceededError')
      },
    }
    expect(readStoredGeometry(blocked, VW, VH)).toEqual(defaultGeometry(VW, VH))
    expect(writeStoredGeometry(blocked, START)).toBe(false)
    expect(writeStoredGeometry(null, START)).toBe(false)
  })

  it('does not hide errors that are not storage or parse failures', () => {
    const broken = {
      getItem(): string | null {
        throw new TypeError('programming error')
      },
      setItem() {
        throw new TypeError('programming error')
      },
    }
    expect(() => readStoredGeometry(broken, VW, VH)).toThrow(TypeError)
    expect(() => writeStoredGeometry(broken, START)).toThrow(TypeError)
  })
})

describe('host guard for SG_SET_FULLSCREEN', () => {
  it('accepts a boolean flag and drops extra fields', () => {
    expect(parseFrameMessage({ type: 'SG_SET_FULLSCREEN', fullscreen: true })).toEqual({
      type: 'SG_SET_FULLSCREEN',
      fullscreen: true,
    })
    expect(parseFrameMessage({ type: 'SG_SET_FULLSCREEN', fullscreen: false, extra: 1 })).toEqual({
      type: 'SG_SET_FULLSCREEN',
      fullscreen: false,
    })
  })

  it('rejects a missing or non-boolean flag', () => {
    expect(parseFrameMessage({ type: 'SG_SET_FULLSCREEN' })).toBeNull()
    expect(parseFrameMessage({ type: 'SG_SET_FULLSCREEN', fullscreen: 'true' })).toBeNull()
    expect(parseFrameMessage({ type: 'SG_SET_FULLSCREEN', fullscreen: 1 })).toBeNull()
  })
})
