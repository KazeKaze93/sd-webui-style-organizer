/**
 * Contract: host SG_THEME must match ui/src/bridge.ts HostMessage literal
 * `{ type: 'SG_THEME'; mode: ThemeMode }` (not `{ theme }`).
 * Shared runtime guard between host JS and bridge.ts is a follow-up.
 */
import { describe, expect, it } from 'vitest'
import {
  buildThemeMessage,
  pickModeFromBackgrounds,
} from '../../../javascript/style_grid/theme.js'

/** Copied from ui/src/bridge.ts HostMessage SG_THEME arm. */
const BRIDGE_SG_THEME_SHAPE: { type: 'SG_THEME'; mode: 'light' | 'dark' } = {
  type: 'SG_THEME',
  mode: 'light',
}

describe('host SG_THEME contract', () => {
  it('buildThemeMessage uses mode (bridge shape), not theme', () => {
    const msg = buildThemeMessage('light')
    expect(msg).toEqual(BRIDGE_SG_THEME_SHAPE)
    expect(msg).toEqual({ type: 'SG_THEME', mode: 'light' })
    expect(Object.keys(msg).sort()).toEqual(['mode', 'type'])
    expect('theme' in msg).toBe(false)
  })

  it('skips fully transparent candidates and uses opaque white as light', () => {
    expect(
      pickModeFromBackgrounds(['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)'], true),
    ).toBe('light')
  })

  it('falls back to prefersDark when only transparent colors remain', () => {
    expect(
      pickModeFromBackgrounds(['transparent', 'rgba(0, 0, 0, 0)'], true),
    ).toBe('dark')
    expect(
      pickModeFromBackgrounds(['transparent', 'rgba(0, 0, 0, 0)'], false),
    ).toBe('light')
  })

  it('classifies opaque dark backgrounds as dark', () => {
    expect(pickModeFromBackgrounds(['rgb(11, 15, 25)'], false)).toBe('dark')
  })
})
