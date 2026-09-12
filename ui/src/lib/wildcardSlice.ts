/**
 * Spec compactor for `{sg:category:spec}` wildcard slices.
 *
 * WHY: writing every selected style name into the prompt textarea is unreadable
 * once a slice grows (ten full names in a token is prompt bloat). This module
 * picks the shortest correct include-or-exclude representation (with safe
 * `Root_*` globs when an entire root group is selected).
 *
 * The Python resolver understands plain names, `-excludes`, and `*` globs
 * regardless of which form the compactor chooses — length is a UX concern only.
 */

/** Strip a leading `CATEGORY_` prefix (case-insensitive). */
function toSuffix(name: string, category: string): string {
  const prefix = `${category}_`
  if (name.toLowerCase().startsWith(prefix.toLowerCase())) {
    return name.slice(prefix.length)
  }
  return name
}

/** First underscore-separated segment; whole suffix when there is no `_`. */
function rootOf(suffix: string): string {
  const idx = suffix.indexOf('_')
  return idx === -1 ? suffix : suffix.slice(0, idx)
}

/**
 * Collapse `targetSuffixes` into glob + individual entries.
 * A root becomes `Root_*` only when every category name under that root is in
 * the target set and the root covers 2+ names.
 */
function compactEntries(
  targetSuffixes: string[],
  allSuffixes: string[],
  asExclude: boolean,
): string {
  const targetSet = new Set(targetSuffixes.map((s) => s.toLowerCase()))

  // Preserve first-seen casing for roots and suffixes from the category list.
  const allByRoot = new Map<string, { displayRoot: string; suffixes: string[] }>()
  for (const suffix of allSuffixes) {
    const displayRoot = rootOf(suffix)
    const key = displayRoot.toLowerCase()
    let group = allByRoot.get(key)
    if (!group) {
      group = { displayRoot, suffixes: [] }
      allByRoot.set(key, group)
    }
    group.suffixes.push(suffix)
  }

  const entries: string[] = []
  const covered = new Set<string>()

  for (const group of allByRoot.values()) {
    const inTarget = group.suffixes.filter((s) => targetSet.has(s.toLowerCase()))
    if (inTarget.length >= 2 && inTarget.length === group.suffixes.length) {
      entries.push(
        asExclude ? `-${group.displayRoot}_*` : `${group.displayRoot}_*`,
      )
      for (const s of group.suffixes) covered.add(s.toLowerCase())
    }
  }

  for (const suffix of targetSuffixes) {
    if (covered.has(suffix.toLowerCase())) continue
    entries.push(asExclude ? `-${suffix}` : suffix)
  }

  return entries.join(',')
}

/**
 * Build the shortest correct slice spec for the given selection.
 * Returns `""` when the selection is the entire category (plain `{sg:cat}`).
 */
export function buildSliceSpec(
  category: string,
  selectedNames: string[],
  allNamesInCategory: string[],
): string {
  const selectedSet = new Set(selectedNames.map((n) => n.toLowerCase()))
  const all = allNamesInCategory

  if (all.length > 0 && all.every((n) => selectedSet.has(n.toLowerCase()))) {
    return ''
  }

  const allSuffixes = all.map((n) => toSuffix(n, category))
  const selectedSuffixes = all
    .filter((n) => selectedSet.has(n.toLowerCase()))
    .map((n) => toSuffix(n, category))
  const unselectedSuffixes = all
    .filter((n) => !selectedSet.has(n.toLowerCase()))
    .map((n) => toSuffix(n, category))

  const includeForm = compactEntries(selectedSuffixes, allSuffixes, false)
  const excludeForm = compactEntries(unselectedSuffixes, allSuffixes, true)

  // Ties prefer include (rule 4 before rule 5).
  return includeForm.length <= excludeForm.length ? includeForm : excludeForm
}

/** Chip-tooltip helper: parse a spec into trimmed entries and a display count. */
export function describeSpec(spec: string): { count: number | null; entries: string[] } {
  if (!spec) return { count: null, entries: [] }
  const entries = spec.split(',').map((e) => e.trim())
  return { count: entries.length, entries }
}
