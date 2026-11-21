import type { Style } from '../bridge'
import { styleGridDelete, styleGridPost } from './styleGridFetch'

/** Suffix of a duplicated style's name (`NAME_copy`, then `NAME_copy_2`…). */
export const COPY_SUFFIX = '_copy'

export type StyleActionResult =
  | { ok: true }
  | { ok: false; error: string }

export type DuplicateResult =
  | { ok: true; name: string }
  | { ok: false; error: string }

/** The CSV `category` cell as stored; the server sends it as `category_explicit`. */
type StyleRow = Style & { category_explicit?: string }

/** File name of a source id or path: `webui/styles_core.csv` -> `styles_core.csv`. */
export function sourceFileLeaf(sourceFile: string | undefined | null): string {
  const normalized = String(sourceFile ?? '').replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}

/**
 * First free copy name in the same source file: `<name>_copy`, then
 * `<name>_copy_2`, `<name>_copy_3`… A style is identified by (source file,
 * name), so only names in that file can collide.
 */
export function nextCopyName(
  name: string,
  sourceFile: string,
  styles: readonly Pick<Style, 'name' | 'source_file'>[],
): string {
  const taken = new Set(
    styles.filter((s) => s.source_file === sourceFile).map((s) => s.name),
  )
  const base = `${name}${COPY_SUFFIX}`
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * POST a style write and read the server's verdict: null on success, else the
 * server's error text (or `fallback` for network failures and empty errors).
 */
export async function postStyleRequest(
  url: string,
  body: unknown,
  fallback: string,
): Promise<string | null> {
  let res: Response
  try {
    res = await styleGridPost(url, body)
  } catch {
    return fallback
  }
  return failureOf(res, fallback)
}

async function failureOf(res: Response, fallback: string): Promise<string | null> {
  const data: unknown = await res.json().catch(() => ({}))
  const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  if (res.ok && body.ok !== false && !body.error) return null
  if (typeof body.error === 'string' && body.error) return body.error
  if (typeof body.detail === 'string' && body.detail) return body.detail
  return fallback
}

/**
 * Delete a style row (POST /style/delete), then its thumbnail
 * (DELETE /thumbnail). The thumbnail request is best-effort: the style is
 * already gone.
 */
export async function deleteStyleRequest(
  style: Pick<Style, 'name' | 'source_file'>,
): Promise<StyleActionResult> {
  let res: Response
  try {
    res = await styleGridPost('/style_grid/style/delete', {
      name: style.name,
      source: style.source_file,
    })
  } catch {
    return { ok: false, error: 'Delete failed' }
  }
  const error = await failureOf(res, 'Delete failed')
  if (error) return { ok: false, error }

  const query =
    `name=${encodeURIComponent(style.name)}&source=${encodeURIComponent(style.source_file || '')}`
  await styleGridDelete(`/style_grid/thumbnail?${query}`).catch(() => undefined)
  return { ok: true }
}

/**
 * Save a copy of `style` in the same source file under the first free copy
 * name. Every field is sent as stored: prompt, negative prompt, description
 * (with its `Combos:` block) and the category column.
 */
export async function duplicateStyleRequest(
  style: Style,
  styles: readonly Pick<Style, 'name' | 'source_file'>[],
): Promise<DuplicateResult> {
  const name = nextCopyName(style.name, style.source_file, styles)
  let res: Response
  try {
    res = await styleGridPost('/style_grid/style/save', {
      name,
      prompt: style.prompt ?? '',
      negative_prompt: style.negative_prompt ?? '',
      description: style.description ?? '',
      category: (style as StyleRow).category_explicit ?? '',
      source: style.source_file,
    })
  } catch {
    return { ok: false, error: 'Duplicate failed' }
  }
  const error = await failureOf(res, 'Duplicate failed')
  if (error) return { ok: false, error }
  return { ok: true, name }
}
