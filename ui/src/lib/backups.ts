import { readApiResponse, styleGridPost } from './styleGridFetch'

/** One entry of GET /style_grid/backups (stylegrid/data_files.py list_backups). */
export type Snapshot = {
  name: string
  has_dir: boolean
  has_zip: boolean
  size: number
  members: string[]
  /** True when a member path starts with "thumbnails/" (list_backups). */
  has_thumbnails: boolean
}

export type BackupList = { backups: Snapshot[]; thumbnailsBytes: number; keepSnapshots: number }

/**
 * Snapshots the server keeps, when GET /style_grid/backups does not say
 * (`keep_snapshots`): stylegrid/data_files.py BACKUP_KEEP_SNAPSHOTS.
 */
export const DEFAULT_KEEP_SNAPSHOTS = 20

/** Byte size with one decimal: "512 B", "1.5 KB", "5.0 MB" (binary units). */
export function formatBytes(n: number): string {
  const num = Number(n) || 0
  if (num < 1024) return `${num} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`
  return `${(num / (1024 * 1024)).toFixed(1)} MB`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SNAPSHOT_NAME_RE = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_([A-Za-z0-9]+))?$/

export type SnapshotLabel = {
  /** "11 Oct 2026, 01:21", or the raw name when it does not parse. */
  date: string
  parsed: boolean
  /** Name suffix after the time ("safety", "safety2", …), "" when none. */
  suffix: string
}

/**
 * Read the date from the snapshot name's digits (server local time,
 * `%Y%m%d_%H%M%S`), as written: no timezone conversion.
 */
export function snapshotLabel(name: string): SnapshotLabel {
  const m = SNAPSHOT_NAME_RE.exec(name)
  if (!m) return { date: name, parsed: false, suffix: '' }
  const [, y, mo, d, h, mi, s, suffix = ''] = m
  const month = Number(mo)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31 || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) {
    return { date: name, parsed: false, suffix: '' }
  }
  return { date: `${day} ${MONTHS[month - 1]} ${y}, ${h}:${mi}`, parsed: true, suffix }
}

/**
 * The restore confirmation, checked against restore_from_backup and
 * _resolve_restore_dest (stylegrid/data_files.py) and _prune_old_backups,
 * which never deletes the snapshot being restored.
 */
export function restoreConfirmationText(
  snapshot: Pick<Snapshot, 'name' | 'has_thumbnails'>,
  keepSnapshots: number = DEFAULT_KEEP_SNAPSHOTS,
): string[] {
  const { date } = snapshotLabel(snapshot.name)
  return [
    `Restore the snapshot from ${date}?`,
    'Replaced from the snapshot: presets, favorites, recent, category order, and style CSVs in the ' +
      `extension's styles folder${snapshot.has_thumbnails ? ', and thumbnails' : ''}.`,
    "Not touched: style CSVs outside the extension's styles folder, such as the packs in the WebUI root " +
      'folder and the bundled samples. Files that are not in the snapshot are kept.',
    'A safety snapshot of the current state is created first, without thumbnails. Only the newest ' +
      `${keepSnapshots} snapshots are kept, so the oldest one may be removed.`,
  ]
}

function asSnapshot(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.name !== 'string' || !r.name) return null
  return {
    name: r.name,
    has_dir: r.has_dir === true,
    has_zip: r.has_zip === true,
    size: typeof r.size === 'number' ? r.size : 0,
    members: Array.isArray(r.members) ? r.members.map(String) : [],
    has_thumbnails: r.has_thumbnails === true,
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** GET /style_grid/backups, newest first (sorted here too, by name). */
export async function fetchBackups(): Promise<Result<BackupList>> {
  let res: Response
  try {
    res = await fetch('/style_grid/backups')
  } catch {
    return { ok: false, error: 'Could not list backups' }
  }
  const result = await readApiResponse(res)
  if (!result.ok) return { ok: false, error: `Could not list backups: ${result.error}` }
  const raw = Array.isArray(result.body.backups) ? result.body.backups : []
  const backups = raw.map(asSnapshot).filter((s): s is Snapshot => s !== null)
  backups.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
  const bytes = result.body.thumbnails_bytes
  const keep = result.body.keep_snapshots
  return {
    ok: true,
    value: {
      backups,
      thumbnailsBytes: typeof bytes === 'number' ? bytes : 0,
      keepSnapshots: typeof keep === 'number' && keep > 0 ? keep : DEFAULT_KEEP_SNAPSHOTS,
    },
  }
}

export type CreateOutcome = { created: true; snapshot: string | null } | { created: false }

/** POST /style_grid/backup `{include_thumbnails}`. */
export async function createBackup(includeThumbnails: boolean): Promise<Result<CreateOutcome>> {
  let res: Response
  try {
    res = await styleGridPost('/style_grid/backup', { include_thumbnails: includeThumbnails })
  } catch {
    return { ok: false, error: 'Backup failed' }
  }
  const result = await readApiResponse(res)
  if (!result.ok) return { ok: false, error: `Backup failed: ${result.error}` }
  // `ok: false` without an error: no file to back up (backup_csv_files).
  if (result.body.ok === false) return { ok: true, value: { created: false } }
  const snapshot = typeof result.body.snapshot === 'string' ? result.body.snapshot : null
  return { ok: true, value: { created: true, snapshot } }
}

/** POST /style_grid/restore `{snapshot}` (the route also accepts `name`). */
export async function restoreBackup(name: string): Promise<Result<{ safety: string | null }>> {
  let res: Response
  try {
    res = await styleGridPost('/style_grid/restore', { snapshot: name })
  } catch {
    return { ok: false, error: 'Restore failed' }
  }
  const result = await readApiResponse(res)
  if (!result.ok) return { ok: false, error: `Restore failed: ${result.error}` }
  const safety = result.body.safety_snapshot
  return { ok: true, value: { safety: typeof safety === 'string' ? safety : null } }
}
