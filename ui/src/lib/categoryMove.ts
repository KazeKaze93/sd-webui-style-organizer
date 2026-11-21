import type { Style } from '../bridge'
import { LORA_SOURCE } from '../store/stylesStore'

/**
 * A category that can become a name prefix: uppercase letters and digits only.
 * An underscore or a hyphen would break prefix parsing on the server
 * (stylegrid/csv_io.py enrich_style splits at the first "_", then at "-").
 */
export const CATEGORY_NAME_RE = /^[A-Z0-9]+$/

export const INVALID_CATEGORY_MESSAGE = 'Use letters A–Z and digits 0–9 only.'

type MovableStyle = Pick<Style, 'name' | 'category' | 'source_file'>

/**
 * Canonical name: `<CURRENT_CATEGORY>_<rest>`, where the prefix is a valid
 * category and equals the style's derived category. Everything else is
 * non-standard: lowercase prefix, hyphen, no separator, leading "_", or a
 * category column that differs from the prefix.
 */
export function isCanonicalName(style: Pick<Style, 'name' | 'category'>): boolean {
  const sep = style.name.indexOf('_')
  if (sep <= 0) return false
  const prefix = style.name.slice(0, sep)
  return CATEGORY_NAME_RE.test(prefix) && prefix === style.category
}

/** Typed text as a category: trimmed, uppercased; `error` when it cannot be one. */
export function parseCategoryInput(raw: string): { value: string; error: string | null } {
  const value = raw.trim().toUpperCase()
  if (!value) return { value, error: null }
  return { value, error: CATEGORY_NAME_RE.test(value) ? null : INVALID_CATEGORY_MESSAGE }
}

export type MovePlan = {
  /** True when the CSV name changes (canonical names). */
  renames: boolean
  newName: string
  /** Body for POST /style_grid/style/rename (same fields as the host move). */
  payload: { old_name: string; new_name: string; source: string; category: string }
}

/**
 * What moving `style` to `category` writes. Canonical names get the new prefix
 * and the category column (what the host Move did); non-standard names keep
 * their name and only the category column changes.
 */
export function planMove(style: MovableStyle, category: string): MovePlan {
  const renames = isCanonicalName(style)
  const newName = renames
    ? `${category}_${style.name.slice(style.name.indexOf('_') + 1)}`
    : style.name
  return {
    renames,
    newName,
    payload: {
      old_name: style.name,
      new_name: newName,
      source: style.source_file,
      category,
    },
  }
}

/** Line under the field describing the exact outcome. */
export function moveOutcomeText(style: MovableStyle, plan: MovePlan, category: string): string {
  return plan.renames
    ? `Will be saved as ${plan.newName}`
    : `Name stays ${style.name}, category column becomes ${category}`
}

export type CategoryOption = {
  category: string
  /** Styles of that category in the moved style's source file. */
  count: number
  current: boolean
}

/**
 * Every category of the library that could be a target (valid name, LoRA
 * excluded), with its count in `style`'s source file, alphabetical. The
 * current category is always listed, marked, even if its name is not valid.
 */
export function categoryOptions(
  style: MovableStyle,
  styles: readonly Pick<Style, 'name' | 'category' | 'source_file'>[],
): CategoryOption[] {
  const counts = new Map<string, number>()
  for (const s of styles) {
    if (s.source_file === LORA_SOURCE) continue
    const cat = s.category || 'OTHER'
    if (!counts.has(cat)) counts.set(cat, 0)
    if (s.source_file === style.source_file) counts.set(cat, counts.get(cat)! + 1)
  }
  const current = style.category || 'OTHER'
  if (!counts.has(current)) counts.set(current, 0)
  return [...counts.entries()]
    .filter(([cat]) => cat === current || CATEGORY_NAME_RE.test(cat))
    .map(([category, count]) => ({ category, count, current: category === current }))
    .sort((a, b) => a.category.localeCompare(b.category))
}

/** All category names of the library (any spelling), for the "create" check. */
export function libraryCategories(
  styles: readonly Pick<Style, 'category' | 'source_file'>[],
): Set<string> {
  const out = new Set<string>()
  for (const s of styles) {
    if (s.source_file === LORA_SOURCE) continue
    out.add((s.category || 'OTHER').toUpperCase())
  }
  return out
}
