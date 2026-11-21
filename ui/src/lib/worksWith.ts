import type { Style } from '../bridge'
import { parseTail, TAIL_UNSAFE_NAME_RE } from './styleForm'
import {
  comboPartLabel,
  parseComboPart,
  resolveComboPart,
  splitOutsideParens,
  type MissingCombo,
  type ResolvedCombo,
} from './styleIdentity'

const RESULT_LIMIT = 8

export type TailChipMember = { resolved: ResolvedCombo | MissingCombo; label: string }
export type TailChip = { members: TailChipMember[]; label: string }

/** One chip per ";" element; a "+" group is one chip. Resolution: same file only. */
export function tailChips(tail: string, inFile: readonly Style[]): TailChip[] {
  return parseTail(tail).map((el) => {
    const members = splitOutsideParens(el.text, '+').map((piece) => {
      const resolved = resolveComboPart(parseComboPart(piece), inFile)
      return { resolved, label: comboPartLabel(resolved) }
    })
    return { members, label: members.map((m) => m.label).join(' + ') }
  })
}

/** Names already referenced by the tail (any member of any element). */
export function tailNames(tail: string): Set<string> {
  const out = new Set<string>()
  for (const el of parseTail(tail)) {
    for (const piece of splitOutsideParens(el.text, '+')) {
      const name = parseComboPart(piece).name
      if (name) out.add(name)
    }
  }
  return out
}

/**
 * Styles that can be added: same source file, not the edited style, not
 * already listed, and no character that would break the tail grammar
 * ("." ends the list, ";" "+" "(" ")" are separators).
 */
export function worksWithCandidates(
  inFile: readonly Style[],
  selfName: string | null,
  tail: string,
  query: string,
): Style[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const listed = tailNames(tail)
  return inFile
    .filter((s) => s.name !== selfName && !listed.has(s.name) && !TAIL_UNSAFE_NAME_RE.test(s.name))
    .filter((s) => {
      const display = comboPartLabel({ type: 'style', token: s.name, style: s, comment: '' })
      return s.name.toLowerCase().includes(q) || display.toLowerCase().includes(q)
    })
    .slice(0, RESULT_LIMIT)
}
