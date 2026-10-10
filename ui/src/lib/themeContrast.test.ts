import { describe, expect, it } from 'vitest'
import {
  DARK_THEME_RGB,
  LIGHT_THEME_RGB,
  type ThemeRgb,
} from './themeMode'

const MIN_CONTRAST = 4.5
const WHITE: ThemeRgb = [255, 255, 255]

const TEXT_KEYS = [
  'text',
  'muted',
  'accent-text',
  'success-text',
  'danger-text',
  'warning-text',
  'wildcard-text',
] as const

const SURFACE_KEYS = ['bg', 'surface', 'popover'] as const

const FILL_KEYS = ['accent', 'success', 'danger', 'info'] as const

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance([r, g, b]: ThemeRgb): number {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  )
}

function contrastRatio(fg: ThemeRgb, bg: ThemeRgb): number {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function assertPaletteContrast(
  label: string,
  palette: typeof DARK_THEME_RGB | typeof LIGHT_THEME_RGB,
): void {
  for (const textKey of TEXT_KEYS) {
    for (const surfaceKey of SURFACE_KEYS) {
      const ratio = contrastRatio(palette[textKey], palette[surfaceKey])
      expect(
        ratio,
        `${label}: ${textKey} on ${surfaceKey} = ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST)
    }
  }
  for (const fillKey of FILL_KEYS) {
    const ratio = contrastRatio(WHITE, palette[fillKey])
    expect(
      ratio,
      `${label}: white on ${fillKey} = ${ratio.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(MIN_CONTRAST)
  }
}

describe('theme contrast', () => {
  it('dark palette meets WCAG AA 4.5:1 for text and white-on-fill pairs', () => {
    assertPaletteContrast('dark', DARK_THEME_RGB)
  })

  it('light palette meets WCAG AA 4.5:1 for text and white-on-fill pairs', () => {
    assertPaletteContrast('light', LIGHT_THEME_RGB)
  })
})
