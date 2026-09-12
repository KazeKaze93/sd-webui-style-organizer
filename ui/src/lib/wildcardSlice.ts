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

function fullName(category: string, suffix: string): string {
  return `${category.toUpperCase()}_${suffix}`
}

function nameMatches(candidateName: string, pattern: string, isGlob: boolean): boolean {
  const name = (candidateName || '').toLowerCase()
  const pat = pattern.toLowerCase()
  if (isGlob) return name.startsWith(pat)
  return name === pat
}

/**
 * TS mirror of ``stylegrid.wildcards.select_slice`` (+ empty-pool fallback from
 * ``resolve_sg_wildcards``). Returns full style names in category order.
 */
export function resolveSliceNames(
  category: string,
  spec: string,
  allNamesInCategory: string[],
): string[] {
  if (!spec) return [...allNamesInCategory]

  const includes: Array<{ pattern: string; isGlob: boolean }> = []
  const excludes: Array<{ pattern: string; isGlob: boolean }> = []
  for (const raw of spec.split(',')) {
    const entry = raw.trim()
    if (!entry) continue
    const isExclude = entry.startsWith('-')
    const body = isExclude ? entry.slice(1).trim() : entry
    if (!body) continue
    const isGlob = body.endsWith('*')
    const suffix = isGlob ? body.slice(0, -1) : body
    const pattern = fullName(category, suffix)
    ;(isExclude ? excludes : includes).push({ pattern, isGlob })
  }

  let selected: string[]
  if (includes.length > 0) {
    selected = []
    const seen = new Set<string>()
    for (const cname of allNamesInCategory) {
      for (const { pattern, isGlob } of includes) {
        if (nameMatches(cname, pattern, isGlob)) {
          if (!seen.has(cname)) {
            seen.add(cname)
            selected.push(cname)
          }
          break
        }
      }
    }
  } else {
    selected = [...allNamesInCategory]
  }

  let result: string[]
  if (excludes.length === 0) {
    result = selected
  } else {
    result = []
    for (const cname of selected) {
      if (excludes.some(({ pattern, isGlob }) => nameMatches(cname, pattern, isGlob))) {
        continue
      }
      result.push(cname)
    }
  }

  // Mirrors resolve_sg_wildcards empty-slice fallback.
  return result.length > 0 ? result : [...allNamesInCategory]
}

/** Chip helper: real randomization pool size/names (not raw spec entry count). */
export function describeSpec(
  category: string,
  spec: string,
  allNamesInCategory: string[],
): { count: number | null; names: string[] } {
  if (!spec) return { count: null, names: [] }
  const names = resolveSliceNames(category, spec, allNamesInCategory)
  return { count: names.length, names }
}
