import type { Style } from '../bridge'
import { LORA_SOURCE } from '../store/stylesStore'
import { INVALID_CATEGORY_MESSAGE, isCanonicalName, parseCategoryInput } from './categoryMove'
import { sourceFileLeaf } from './styleActions'

/**
 * The host's split rule (javascript/style_grid/render.js splitDescriptionAndCombos):
 * the description ends with "Combos: …" up to the end, at most one period.
 */
const HOST_COMBOS_RE = /^([\s\S]*?)\s*Combos?:\s*([^.]+)\.?\s*$/i

export type DescriptionParts = {
  /** Free text before the tail, exactly as stored. */
  text: string
  /** Whitespace between the text and the tail, exactly as stored. */
  gap: string
  /** From "Combos:" to the end, exactly as stored; "" when there is none. */
  tail: string
}

/** Split a description by the host rule, keeping every byte. */
export function splitDescription(raw: string): DescriptionParts {
  const m = HOST_COMBOS_RE.exec(raw)
  if (!m) return { text: raw, gap: '', tail: '' }
  const text = m[1]
  const rest = raw.slice(text.length)
  const gap = /^\s*/.exec(rest)![0]
  return { text, gap, tail: rest.slice(gap.length) }
}

/**
 * Description to save after the free text was edited to `editedText`. The
 * tail is re-attached byte for byte; an untouched text returns `original`.
 */
export function joinDescription(original: string, editedText: string): string {
  const parts = splitDescription(original)
  if (editedText === parts.text) return original
  if (!parts.tail) return editedText
  if (!editedText) return parts.tail
  return editedText + (parts.gap || ' ') + parts.tail
}

export type EditorMode = 'edit' | 'create'

/** What the Category and Name fields start with. */
export function initialNameFields(style: Pick<Style, 'name' | 'category'> | null): {
  canonical: boolean
  category: string
  name: string
} {
  if (!style) return { canonical: true, category: '', name: '' }
  const canonical = isCanonicalName(style)
  return {
    canonical,
    category: style.category || 'OTHER',
    // Canonical names edit only the part after the prefix; others the full name.
    name: canonical ? style.name.slice(style.name.indexOf('_') + 1) : style.name,
  }
}

export type NameOutcome = {
  /** Resulting CSV name, or null while the fields are not valid. */
  name: string | null
  /** True when the CSV name differs from the stored one (edit only). */
  renames: boolean
  /** Category written to the column, or null when the column is untouched. */
  categoryColumn: string | null
  /** Derived category after the save. */
  category: string
  /** Helper line under the fields. */
  helper: string
  error: boolean
}

/**
 * Resulting name for the editor's fields (approved rules):
 * - canonical: Name edits the part after the prefix; a category change
 *   rewrites the prefix and the column;
 * - non-standard: Name is the full raw name; a category change writes only
 *   the column; the name changes only when Name was edited;
 * - create: `<CATEGORY>_<Name>`, or Name alone without a category.
 */
export function resolveName(args: {
  mode: EditorMode
  style: Pick<Style, 'name' | 'category' | 'source_file'> | null
  categoryInput: string
  nameInput: string
  sourceFile: string
  styles: readonly Pick<Style, 'name' | 'source_file'>[]
}): NameOutcome {
  const { mode, style, categoryInput, nameInput, sourceFile, styles } = args
  const initial = initialNameFields(mode === 'edit' ? style : null)
  const parsed = parseCategoryInput(categoryInput)
  const nameField = nameInput.trim()
  const fail = (helper: string, error = true): NameOutcome => ({
    name: null, renames: false, categoryColumn: null, category: '', helper, error,
  })

  // An unchanged category is never validated (stored categories may predate the rule).
  const initialCategory = initial.category.toUpperCase()
  const categoryChanged = mode === 'edit'
    ? parsed.value !== initialCategory
    : parsed.value !== ''
  if (categoryChanged && mode === 'edit' && !parsed.value) return fail('Choose a category.')
  if (categoryChanged && parsed.error) return fail(INVALID_CATEGORY_MESSAGE)
  if (!nameField) return fail('Enter a name.', false)

  let name: string
  if (mode === 'create') {
    name = parsed.value ? `${parsed.value}_${nameField}` : nameField
  } else if (initial.canonical) {
    const nameChanged = nameField !== initial.name
    name = categoryChanged || nameChanged ? `${parsed.value}_${nameField}` : style!.name
  } else {
    name = nameField !== initial.name ? nameField : style!.name
  }

  const original = mode === 'edit' ? style!.name : null
  const renames = original !== null && name !== original
  if (name !== original && styles.some((s) => s.source_file === sourceFile && s.name === name)) {
    return fail(`${name} already exists in ${sourceFileLeaf(sourceFile)}.`)
  }

  const categoryColumn = mode === 'edit' && categoryChanged ? parsed.value : null
  const category = mode === 'edit'
    ? (categoryChanged ? parsed.value : style!.category)
    : (parsed.value || style?.category || '')

  let helper: string
  if (mode === 'create' || renames) helper = `Will be saved as ${name}`
  else if (categoryColumn) helper = `Name stays ${name}, category column becomes ${categoryColumn}`
  else helper = `Name stays ${name}`
  return { name, renames, categoryColumn, category, helper, error: false }
}

export type EditorFields = {
  prompt: string
  negative_prompt: string
  /** Full description to store (tail already re-attached). */
  description: string
}

export type SaveRequest = { url: string; body: Record<string, unknown> }

/**
 * The request the host editor made for the same change
 * (render.js openStyleEditor): /style/save when the name is unchanged or for a
 * new style, /style/rename with the fields when the name changed. The
 * category column is sent only when it changes.
 */
export function buildSaveRequest(args: {
  mode: EditorMode
  originalName: string | null
  outcome: NameOutcome
  fields: EditorFields
  sourceFile: string
}): SaveRequest {
  const { mode, originalName, outcome, fields, sourceFile } = args
  const category = outcome.categoryColumn !== null ? { category: outcome.categoryColumn } : {}
  if (mode === 'edit' && outcome.renames) {
    return {
      url: '/style_grid/style/rename',
      body: {
        old_name: originalName,
        new_name: outcome.name,
        source: sourceFile,
        prompt: fields.prompt,
        negative_prompt: fields.negative_prompt,
        description: fields.description,
        ...category,
      },
    }
  }
  return {
    url: '/style_grid/style/save',
    body: {
      name: outcome.name,
      prompt: fields.prompt,
      negative_prompt: fields.negative_prompt,
      description: fields.description,
      source: sourceFile,
      ...category,
    },
  }
}

/** Sources a new style can be saved to: not LoRA, not read-only, sorted. */
export function writableSources(
  styles: readonly Pick<Style, 'source_file' | 'read_only'>[],
): string[] {
  const readOnly = new Set<string>()
  const all = new Set<string>()
  for (const s of styles) {
    if (!s.source_file || s.source_file === LORA_SOURCE) continue
    all.add(s.source_file)
    if (s.read_only) readOnly.add(s.source_file)
  }
  return [...all].filter((src) => !readOnly.has(src)).sort()
}
