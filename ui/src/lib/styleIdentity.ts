import type { Style } from '../bridge'

/** Same composite as stylesStore.styleRowKey — kept here so tests stay free of the store. */
export function styleIdentityKey(name: string, sourceFile: string): string {
  return `${sourceFile}\0${name}`
}

/** Library row for (source_file, name). No cross-file name-only fallback. */
export function findStyleBySourceAndName(
  styles: readonly Style[],
  name: string,
  sourceFile: string,
): Style | undefined {
  const want = styleIdentityKey(name, sourceFile)
  return styles.find((s) => styleIdentityKey(s.name, s.source_file) === want)
}

/** Prefer the library row matching the selected identity; else the selected object itself. */
export function resolveSelectedStyleRow(
  styles: readonly Style[],
  selected: Style | null | undefined,
): Style | null {
  if (!selected) return null
  return findStyleBySourceAndName(styles, selected.name, selected.source_file) || selected
}

/** Parses "Combos: TOKEN1; TOKEN2; ..." from a description. */
export function parseComboTokens(description: string): string[] {
  const match = description.match(/Combos?:\s*([^.]+)/i)
  if (!match) return []
  return match[1].split(';').map((t) => t.trim()).filter(Boolean)
}

export type ResolvedCombo =
  | { type: 'style'; token: string; style: Style }
  | { type: 'category'; token: string; category: string }

/**
 * Resolve Combos tokens only among styles from the same source_file.
 * Names / categories absent from that file are omitted (no chip, no error).
 */
export function resolveCombosInSourceFile(
  description: string,
  styles: readonly Style[],
  sourceFile: string,
): ResolvedCombo[] {
  const inFile = styles.filter((s) => s.source_file === sourceFile)
  const out: ResolvedCombo[] = []
  for (const token of parseComboTokens(description)) {
    const exact = inFile.find((s) => s.name === token)
    if (exact) {
      out.push({ type: 'style', token, style: exact })
      continue
    }
    const cat = token.split('_')[0]
    if (cat && inFile.some((s) => s.category === cat)) {
      out.push({ type: 'category', token, category: cat })
    }
  }
  return out
}
