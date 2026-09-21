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

/** Split `text` on `sep` only when not inside `(...)`. */
export function splitOutsideParens(text: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let buf = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') {
      depth += 1
      buf += ch
      continue
    }
    if (ch === ')' && depth > 0) {
      depth -= 1
      buf += ch
      continue
    }
    if (depth === 0 && sep.length > 0 && text.startsWith(sep, i)) {
      const piece = buf.trim()
      if (piece) out.push(piece)
      buf = ''
      i += sep.length - 1
      continue
    }
    buf += ch
  }
  const tail = buf.trim()
  if (tail) out.push(tail)
  return out
}

export type ComboPart = {
  /** Style / category token before the first `(`. Empty when the piece has no name. */
  name: string
  /** Text inside the first `(...)`, if any. */
  comment: string
  /** Original piece text. */
  raw: string
}

/** Name = text before first `(; comment = inside matching `)`. */
export function parseComboPart(raw: string): ComboPart {
  const trimmed = raw.trim()
  const open = trimmed.indexOf('(')
  if (open === -1) {
    return { name: trimmed, comment: '', raw: trimmed }
  }
  const name = trimmed.slice(0, open).trim()
  let depth = 0
  let close = -1
  for (let i = open; i < trimmed.length; i++) {
    if (trimmed[i] === '(') depth += 1
    else if (trimmed[i] === ')') {
      depth -= 1
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  const comment =
    close === -1
      ? trimmed.slice(open + 1).trim()
      : trimmed.slice(open + 1, close).trim()
  return { name, comment, raw: trimmed }
}

/**
 * Parses "Combos: ..." into items (`;`), then `+` pieces, then name/comment parts.
 * `;` / `+` inside parentheses do not split.
 */
export function parseComboTokens(description: string): string[] {
  const match = description.match(/Combos?:\s*([^.]+)/i)
  if (!match) return []
  return splitOutsideParens(match[1], ';')
}

export function parseComboParts(description: string): ComboPart[] {
  const parts: ComboPart[] = []
  for (const item of parseComboTokens(description)) {
    for (const piece of splitOutsideParens(item, '+')) {
      parts.push(parseComboPart(piece))
    }
  }
  return parts
}

export type ResolvedCombo =
  | { type: 'style'; token: string; style: Style; comment: string }
  | { type: 'category'; token: string; category: string; comment: string }
  | { type: 'raw'; token: string }

/**
 * Resolve Combos tokens only among styles from the same source_file.
 * Named parts absent from that file are omitted. Parenthetical comments
 * are kept for tooltips. Raw chips only when a piece has no style name.
 */
export function resolveCombosInSourceFile(
  description: string,
  styles: readonly Style[],
  sourceFile: string,
): ResolvedCombo[] {
  const inFile = styles.filter((s) => s.source_file === sourceFile)
  const out: ResolvedCombo[] = []
  for (const part of parseComboParts(description)) {
    if (!part.name) {
      out.push({ type: 'raw', token: part.raw })
      continue
    }
    const exact = inFile.find((s) => s.name === part.name)
    if (exact) {
      out.push({
        type: 'style',
        token: part.name,
        style: exact,
        comment: part.comment,
      })
      continue
    }
    const cat = part.name.split('_')[0]
    if (cat && inFile.some((s) => s.category === cat)) {
      out.push({
        type: 'category',
        token: part.name,
        category: cat,
        comment: part.comment,
      })
      continue
    }
    // Named but not in this file — no chip.
  }
  return out
}
