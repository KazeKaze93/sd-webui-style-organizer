import { describe, expect, it } from 'vitest'
import {
  DARK_CATEGORY_PALETTE,
  getCategoryColor,
  LIGHT_CATEGORY_PALETTE,
  useStylesStore,
} from './stylesStore'

const MIN_CONTRAST = 4.5
const LIGHT_BACKGROUNDS = ['#ffffff', '#f8fafc']
const DARK_BACKGROUNDS = ['#1a1a2e', '#16213e', '#0f172a']

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('category palettes', () => {
  it('have equal length and no duplicates', () => {
    expect(LIGHT_CATEGORY_PALETTE.length).toBe(DARK_CATEGORY_PALETTE.length)
    expect(new Set(LIGHT_CATEGORY_PALETTE).size).toBe(LIGHT_CATEGORY_PALETTE.length)
    expect(new Set(DARK_CATEGORY_PALETTE).size).toBe(DARK_CATEGORY_PALETTE.length)
  })

  it.each(LIGHT_BACKGROUNDS)('LIGHT palette reaches 4.5:1 on %s', (bg) => {
    const failing = LIGHT_CATEGORY_PALETTE.filter((c) => contrast(c, bg) < MIN_CONTRAST)
    expect(failing).toEqual([])
  })

  it.each(DARK_BACKGROUNDS)('DARK palette reaches 4.5:1 on %s', (bg) => {
    const failing = DARK_CATEGORY_PALETTE.filter((c) => contrast(c, bg) < MIN_CONTRAST)
    expect(failing).toEqual([])
  })
})

describe('getCategoryColor', () => {
  it('uses the same palette slot in both modes', () => {
    for (const cat of ['All', 'OTHER', 'BODY', 'CLOTHES', 'LIGHTING']) {
      const dark = DARK_CATEGORY_PALETTE.indexOf(getCategoryColor(cat, 'dark'))
      const light = LIGHT_CATEGORY_PALETTE.indexOf(getCategoryColor(cat, 'light'))
      expect(dark).toBeGreaterThanOrEqual(0)
      expect(light).toBe(dark)
    }
  })

  it('defaults to dark mode', () => {
    expect(getCategoryColor('BODY')).toBe(getCategoryColor('BODY', 'dark'))
  })
})

describe('themeMode', () => {
  it('defaults to dark and is set by setThemeMode', () => {
    expect(useStylesStore.getState().themeMode).toBe('dark')
    useStylesStore.getState().setThemeMode('light')
    expect(useStylesStore.getState().themeMode).toBe('light')
    useStylesStore.getState().setThemeMode('dark')
  })
})
