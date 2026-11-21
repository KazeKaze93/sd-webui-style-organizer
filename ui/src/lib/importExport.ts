import { readApiResponse, styleGridPost } from './styleGridFetch'

/** How many colliding names the summary lists before "+N more". */
export const IMPORT_SUMMARY_MAX_NAMES = 10

/**
 * Download name for an export: `style_grid_export_<YYYY-MM-DD>.json`, the
 * date in UTC from toISOString().
 */
export function exportFileName(now: Date = new Date()): string {
  return `style_grid_export_${now.toISOString().slice(0, 10)}.json`
}

/** A file the picker or a drop may hand over: JSON by extension or MIME type. */
export function isJsonFile(file: Pick<File, 'name' | 'type'>): boolean {
  return /\.json$/i.test(file.name) || file.type === 'application/json'
}

export type ExportResult = { ok: true; data: unknown } | { ok: false; error: string }

/** GET /style_grid/export: styles, presets, favorites, recent. */
export async function fetchExport(): Promise<ExportResult> {
  let res: Response
  try {
    res = await fetch('/style_grid/export')
  } catch {
    return { ok: false, error: 'Export failed' }
  }
  const result = await readApiResponse(res)
  if (!result.ok) return { ok: false, error: `Export failed: ${result.error}` }
  return { ok: true, data: result.body }
}

/** Save `data` as a pretty-printed JSON file through a Blob URL in this document. */
export function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has been handed to the browser.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export type ImportSummary = {
  imported: number
  collisions: string[]
  invalid: number
}

export type ImportResult =
  | { ok: true; summary: ImportSummary | null }
  | { ok: false; error: string }

/** Style counters of an import response; null when it carries none (no `styles` were sent). */
export function importSummaryOf(body: unknown): ImportSummary | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.imported !== 'number') return null
  return {
    imported: b.imported,
    collisions: Array.isArray(b.collisions) ? b.collisions.map(String) : [],
    invalid: typeof b.invalid === 'number' ? b.invalid : 0,
  }
}

/** One line per part of the summary: imported, skipped collisions, invalid entries. */
export function importSummaryLines(summary: ImportSummary): {
  imported: string
  collisions: string | null
  invalid: string | null
} {
  const { imported, collisions, invalid } = summary
  return {
    imported: imported === 1 ? 'Imported 1 style.' : `Imported ${imported} styles.`,
    collisions: collisions.length
      ? `Skipped ${collisions.length} already in the library:`
      : null,
    invalid: invalid > 0
      ? `Skipped ${invalid} invalid ${invalid === 1 ? 'entry' : 'entries'} (missing name).`
      : null,
  }
}

/** The summary as one toast line; `info` when something was skipped. */
export function importSummaryMessage(summary: ImportSummary): {
  message: string
  variant: 'success' | 'info'
} {
  const lines = importSummaryLines(summary)
  const parts = [lines.imported]
  if (lines.collisions) {
    const shown = summary.collisions.slice(0, IMPORT_SUMMARY_MAX_NAMES).join(', ')
    const extra = summary.collisions.length - IMPORT_SUMMARY_MAX_NAMES
    parts.push(`${lines.collisions} ${shown}${extra > 0 ? ` (+${extra} more)` : ''}.`)
  }
  if (lines.invalid) parts.push(lines.invalid)
  return {
    message: parts.join(' '),
    variant: summary.collisions.length || summary.invalid > 0 ? 'info' : 'success',
  }
}

/**
 * Import a file's text: parse it here ("Invalid JSON
 * file" when it does not parse), then POST the parsed value to
 * /style_grid/import with the write headers.
 */
export async function importJsonText(text: string): Promise<ImportResult> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Invalid JSON file' }
  }
  let res: Response
  try {
    // A falsy JSON value (null, 0, "", false) is sent as `{}`; the server ignores non-objects.
    res = await styleGridPost('/style_grid/import', data || {})
  } catch {
    return { ok: false, error: 'Import failed' }
  }
  const result = await readApiResponse(res)
  if (!result.ok) {
    // An error body that lists collisions gets the colliding names appended.
    const collisions = Array.isArray(result.body.collisions) ? result.body.collisions.map(String) : []
    const error = collisions.length && typeof result.body.error === 'string'
      ? `${result.error}\n\nColliding names: ${collisions.join(', ')}`
      : result.error
    return { ok: false, error }
  }
  return { ok: true, summary: importSummaryOf(result.body) }
}
