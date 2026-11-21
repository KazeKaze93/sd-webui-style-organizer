import type { Style } from '../bridge'
import { BLOCK_UNSAFE_NAME_RE, parseBlock } from './combosBlock'
import {
  comboPartLabel,
  parseComboPart,
  resolveComboPart,
  splitOutsideParens,
  type MissingCombo,
  type ResolvedCombo,
} from './styleIdentity'

const RESULT_LIMIT = 8

export type BlockChipMember = { resolved: ResolvedCombo | MissingCombo; label: string }
export type BlockChip = { members: BlockChipMember[]; label: string }

/** One chip per ";" element of the Combos block; a "+" group is one chip. Resolution: same file only. */
export function blockChips(block: string, inFile: readonly Style[]): BlockChip[] {
  return parseBlock(block).map((el) => {
    const members = splitOutsideParens(el.text, '+').map((piece) => {
      const resolved = resolveComboPart(parseComboPart(piece), inFile)
      return { resolved, label: comboPartLabel(resolved) }
    })
    return { members, label: members.map((m) => m.label).join(' + ') }
  })
}

/** Names already referenced by the block (any member of any element). */
export function blockNames(block: string): Set<string> {
  const out = new Set<string>()
  for (const el of parseBlock(block)) {
    for (const piece of splitOutsideParens(el.text, '+')) {
      const name = parseComboPart(piece).name
      if (name) out.add(name)
    }
  }
  return out
}

/**
 * Styles that can be added: same source file, not the edited style, not
 * already listed, and no character that would break the block grammar
 * ("." ends the list, ";" "+" "(" ")" are separators).
 */
export function worksWithCandidates(
  inFile: readonly Style[],
  selfName: string | null,
  block: string,
  query: string,
): Style[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const listed = blockNames(block)
  return inFile
    .filter((s) => s.name !== selfName && !listed.has(s.name) && !BLOCK_UNSAFE_NAME_RE.test(s.name))
    .filter((s) => {
      const display = comboPartLabel({ type: 'style', token: s.name, style: s, comment: '' })
      return s.name.toLowerCase().includes(q) || display.toLowerCase().includes(q)
    })
    .slice(0, RESULT_LIMIT)
}
