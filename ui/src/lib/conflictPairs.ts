/**
 * Conflicts grouped by unordered pair of selected styles. Detection itself
 * (stylesStore.detectConflicts) is directional: "A's negative prompt removes
 * tags from B". A pair shows once, one way or both ways.
 */

export type DirectedConflict = {
  styleA: string
  styleB: string
  styleAKey: string
  styleBKey: string
}

export type ConflictPair = {
  /** conflictPairKey(aKey, bKey) */
  key: string
  /** A is the style whose negative prompt cancels B's tags (first direction seen). */
  aKey: string
  bKey: string
  aName: string
  bName: string
  /** B's negative prompt also cancels A's tags. */
  both: boolean
}

/** Order-free key of two style row keys. */
export function conflictPairKey(aKey: string, bKey: string): string {
  return aKey < bKey ? `${aKey}\0${bKey}` : `${bKey}\0${aKey}`
}

/** Group directed conflicts into pairs, in order of first appearance; dismissed pairs are left out. */
export function groupConflictPairs(
  conflicts: readonly DirectedConflict[],
  dismissed: ReadonlySet<string> = new Set(),
): ConflictPair[] {
  const byKey = new Map<string, ConflictPair>()
  for (const c of conflicts) {
    const key = conflictPairKey(c.styleAKey, c.styleBKey)
    if (dismissed.has(key)) continue
    const pair = byKey.get(key)
    if (!pair) {
      byKey.set(key, {
        key,
        aKey: c.styleAKey,
        bKey: c.styleBKey,
        aName: c.styleA,
        bName: c.styleB,
        both: false,
      })
    } else if (pair.aKey !== c.styleAKey) {
      pair.both = true
    }
  }
  return [...byKey.values()]
}

/** Style row keys that take part in any of the given pairs. */
export function conflictStyleKeys(pairs: readonly ConflictPair[]): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const p of pairs) {
    keys.add(p.aKey)
    keys.add(p.bKey)
  }
  return keys
}
