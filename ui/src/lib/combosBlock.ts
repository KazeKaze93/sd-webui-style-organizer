/**
 * The "Works with" block of a description, per docs/CSV_FORMAT.md
 * ("Recommended Combos"): `Combos:` and its list up to the first period,
 * anywhere in the description. Free text may precede and follow it, e.g.
 * `Short desc. Combos: A; B. Conflicts: C.`
 *
 * The one parser of the iframe: the tray (styleIdentity.parseComboTokens) and
 * the style editor both read the block through `splitCombos`.
 */

/** Same capture as the tray always used: `Combos:\s*([^.]+)`, first match, any case. */
const COMBOS_RE = /Combos?:\s*[^.]+/i

export type CombosParts = {
  /** Text before the block, without the whitespace that separates them. */
  before: string
  /** Whitespace between `before` and the block, exactly as stored. */
  gapBefore: string
  /** `Combos: …` up to and including the first period after it (or to the end); "" when none. */
  block: string
  /** Whitespace between the block and `after`, exactly as stored. */
  gapAfter: string
  /** Everything after the block, without the separating whitespace. */
  after: string
}

/** Split a description around its Combos block. `joinCombos` restores it byte for byte. */
export function splitCombos(raw: string): CombosParts {
  const m = COMBOS_RE.exec(raw)
  if (!m) return { before: raw, gapBefore: '', block: '', gapAfter: '', after: '' }
  let end = m.index + m[0].length
  if (raw[end] === '.') end += 1
  const head = raw.slice(0, m.index)
  const before = head.replace(/\s+$/, '')
  const rest = raw.slice(end)
  const after = rest.replace(/^\s+/, '')
  return {
    before,
    gapBefore: head.slice(before.length),
    block: raw.slice(m.index, end),
    gapAfter: rest.slice(0, rest.length - after.length),
    after,
  }
}

export function joinCombos(p: CombosParts): string {
  return p.before + p.gapBefore + p.block + p.gapAfter + p.after
}

/** The list inside a block: `Combos: A; B.` -> `A; B` (what the tray splits). */
export function blockList(block: string): string {
  const m = /^Combos?:\s*([^.]*)/i.exec(block)
  return m ? m[1] : ''
}

/** One ";" element of a block: offsets into the block string, content trimmed. */
export type BlockElement = { start: number; end: number; text: string }

const BLOCK_HEAD_RE = /^Combos?:\s*/i

/**
 * Elements of a block (`Combos: A; B + C (note).`), split at ";" outside
 * parentheses, in stored order. Offsets cover only the trimmed content, so
 * spacing around separators stays outside every element.
 */
export function parseBlock(block: string): BlockElement[] {
  const head = BLOCK_HEAD_RE.exec(block)
  if (!head) return []
  const bodyStart = head[0].length
  const rest = block.slice(bodyStart)
  const suffix = /\.?\s*$/.exec(rest)![0]
  const bodyEnd = block.length - suffix.length
  const out: BlockElement[] = []
  let depth = 0
  let segStart = bodyStart
  const flush = (segEnd: number) => {
    let a = segStart
    let b = segEnd
    while (a < b && /\s/.test(block[a])) a++
    while (b > a && /\s/.test(block[b - 1])) b--
    if (b > a) out.push({ start: a, end: b, text: block.slice(a, b) })
  }
  for (let i = bodyStart; i < bodyEnd; i++) {
    const ch = block[i]
    if (ch === '(') depth++
    else if (ch === ')' && depth > 0) depth--
    else if (ch === ';' && depth === 0) {
      flush(i)
      segStart = i + 1
    }
  }
  flush(bodyEnd)
  return out
}

/**
 * Remove element `index` and exactly one adjacent separator (the one after
 * it, or before it for the last element). Every other byte stays. Removing
 * the only element removes the whole block.
 */
export function removeBlockElement(block: string, index: number): string {
  const els = parseBlock(block)
  if (index < 0 || index >= els.length) return block
  if (els.length === 1) return ''
  const [from, to] = index < els.length - 1
    ? [els[index].start, els[index + 1].start]
    : [els[index - 1].end, els[index].end]
  return block.slice(0, from) + block.slice(to)
}

/**
 * Add `name` as a new last element: `; NAME` after the last element (so
 * before the block's period), or a new block `Combos: NAME.` (the host's
 * format) when there is none.
 */
export function addBlockElement(block: string, name: string): string {
  const els = parseBlock(block)
  if (els.length === 0) return `Combos: ${name}.`
  const end = els[els.length - 1].end
  return `${block.slice(0, end)}; ${name}${block.slice(end)}`
}

/** Characters that would break the block grammar inside a style name. */
export const BLOCK_UNSAFE_NAME_RE = /[.;+()]/

/**
 * Description to save from edited parts. Untouched parts return `original`
 * byte for byte; an edited part keeps the stored whitespace around it.
 * A block created where there was none is attached the way the host's
 * joinDescriptionAndCombos did: `<before trimmed>` + (". " or " " after a
 * period) + `Combos: <items>.`, followed by any `after` text.
 */
export function buildDescription(
  original: string,
  edited: { before: string; block: string; after: string },
): string {
  const p = splitCombos(original)
  const { before, block, after } = edited
  if (before === p.before && block === p.block && after === p.after) return original

  if (!block) {
    // No block (any more): before and after, joined by the stored spacing.
    if (!before) return after
    if (!after) return before
    return before + (p.gapBefore || p.gapAfter || ' ') + after
  }

  let head: string
  if (p.block) {
    head = before ? before + (p.gapBefore || ' ') : ''
  } else {
    const text = before.trim()
    head = text ? text + (text.endsWith('.') ? ' ' : '. ') : ''
  }
  const rest = after ? (p.gapAfter || ' ') + after : ''
  return head + block + rest
}
