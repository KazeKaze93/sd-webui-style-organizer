export type ThemeMode = 'light' | 'dark'

export const DEFAULT_THEME_MODE: ThemeMode = 'dark'

const THEME_QUERY_PARAM = 'theme'

/** RGB channel triples matching `:root` / `:root[data-sg-theme="light"]` in index.css. */
export type ThemeRgb = readonly [number, number, number]

export const DARK_THEME_RGB = {
  bg: [26, 26, 46],
  surface: [22, 33, 62],
  popover: [15, 23, 42],
  border: [45, 45, 78],
  text: [226, 232, 240],
  muted: [130, 145, 168],
  accent: [88, 92, 232],
  'accent-text': [165, 180, 252],
  success: [21, 128, 61],
  'success-text': [74, 222, 128],
  danger: [185, 28, 28],
  'danger-text': [248, 113, 113],
  'warning-text': [252, 211, 77],
  info: [79, 70, 229],
  wildcard: [168, 85, 247],
  'wildcard-text': [216, 180, 254],
} as const satisfies Record<string, ThemeRgb>

export const LIGHT_THEME_RGB = {
  bg: [248, 250, 252],
  surface: [255, 255, 255],
  popover: [255, 255, 255],
  border: [203, 213, 225],
  text: [15, 23, 42],
  muted: [71, 85, 105],
  accent: [79, 70, 229],
  'accent-text': [67, 56, 202],
  success: [21, 128, 61],
  'success-text': [21, 128, 61],
  danger: [185, 28, 28],
  'danger-text': [185, 28, 28],
  'warning-text': [180, 83, 9],
  info: [79, 70, 229],
  wildcard: [147, 51, 234],
  'wildcard-text': [126, 34, 206],
} as const satisfies Record<string, ThemeRgb>

/** Anything other than an explicit `'light'` / `'dark'` falls back to dark. */
export function parseThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' ? value : DEFAULT_THEME_MODE
}

export function themeModeFromSearch(search: string): ThemeMode {
  return parseThemeMode(new URLSearchParams(search).get(THEME_QUERY_PARAM))
}

export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.dataset.sgTheme = mode
}

export function appliedThemeMode(): ThemeMode {
  return parseThemeMode(document.documentElement.dataset.sgTheme)
}
