import { styleGridPost } from './styleGridFetch'

/** How many colliding names the summary lists before "+N more" (host: IMPORT_SUMMARY_MAX_NAMES). */
export const IMPORT_SUMMARY_MAX_NAMES = 10

/**
 * Download name for an export, as the host built it (render.js showExportImport):
 * `style_grid_export_<YYYY-MM-DD>.json`, the date in UTC from toISOString().
 */
export function exportFileName(now: Date = new Date()): string {
  return `style_grid_export_${now.toISOString().slice(0, 10)}.json`
}

/** A file the picker or a drop may hand over: JSON by extension or MIME type. */
export function isJsonFile(file: Pick<File, 'name' | 'type'>): boolean {
  return /\.json$/i.test(file.name) || file.type === 'application/json'
}

/** Error text of a failed response, the way the host's parseApiResponse reads it. */
function responseError(status: number, ok: boolean, body: Record<string, unknown>): string | null {
  if (typeof body.error === 'string' && body.error) {
    // The host appends the colliding names to an error body that carries them.
    const collisions = Array.isArray(body.collisions) ? body.collisions.map(String) : []
    return collisions.length
      ? `${body.error}\n\nColliding names: ${collisions.join(', ')}`
      : body.error
  }
  if (ok) return null
  if (typeof body.detail === 'string' && body.detail) return body.detail
  if (Array.isArray(body.detail)) {
    const msg = body.detail
      .map((d) => (d && typeof d === 'object' && typeof (d as { msg?: unknown }).msg === 'string'
        ? (d as { msg: string }).msg
        : ''))
      .filter(Boolean)
      .join('; ')
    if (msg) return msg
  }
  return `HTTP ${status}`
}

async function readBody(res: Response): Promise<{ body: Record<string, unknown>; parsed: boolean }> {
  const text = await res.text().catch(() => '')
  if (!text) return { body: {}, parsed: true }
  try {
    const data: unknown = JSON.parse(text)
    return { body: data && typeof data === 'object' ? (data as Record<string, unknown>) : {}, parsed: true }
  } catch {
    return { body: {}, parsed: false }
  }
}

export type ExportResult = { ok: true; data: unknown } | { ok: false; error: string }

/** GET /style_grid/export, the host's request. */
export async function fetchExport(): Promise<ExportResult> {
  let res: Response
  try {
    res = await fetch('/style_grid/export')
  } catch {
    return { ok: false, error: 'Export failed' }
  }
  const { body, parsed } = await readBody(res)
  if (!parsed) return { ok: false, error: res.ok ? 'Export failed: Invalid JSON in response' : `Export failed: HTTP ${res.status}` }
  if (!res.ok) return { ok: false, error: `Export failed: ${responseError(res.status, false, body)}` }
  return { ok: true, data: body }
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

/** Style counters of an import response; null when it carries none (host formatImportSummary). */
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

/** One line per part of the summary, in the host's words. */
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

/** The host's single-line toast text for a summary (formatImportSummary). */
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
 * Import a file's text the way the host did: parse it here ("Invalid JSON
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
    // The host sent `JSON.stringify(data || {})`.
    res = await styleGridPost('/style_grid/import', data || {})
  } catch {
    return { ok: false, error: 'Import failed' }
  }
  const { body, parsed } = await readBody(res)
  if (!parsed) return { ok: false, error: res.ok ? 'Invalid JSON in response' : `HTTP ${res.status}` }
  const error = responseError(res.status, res.ok, body)
  if (error) return { ok: false, error }
  return { ok: true, summary: importSummaryOf(body) }
}
