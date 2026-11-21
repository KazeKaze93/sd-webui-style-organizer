import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { sendToHost } from '../bridge'
import {
  createBackup,
  fetchBackups,
  formatBytes,
  restoreBackup,
  restoreConfirmationText,
  snapshotLabel,
  type Snapshot,
} from '../lib/backups'
import { cn } from '../lib/utils'
import { useStylesStore } from '../store/stylesStore'
import { ModalShell } from './ModalShell'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

type Props = {
  open: boolean
  onClose: () => void
}

type ListState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; backups: Snapshot[]; thumbnailsBytes: number; keepSnapshots: number }

const button = (kind: 'primary' | 'secondary' | 'danger') =>
  cn(
    'px-3 py-1.5 text-sm rounded transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
    kind === 'primary' && 'bg-sg-accent text-white hover:bg-sg-accent/90',
    kind === 'secondary' && 'text-sg-text border border-sg-border hover:bg-sg-accent/20',
    kind === 'danger' && 'bg-sg-danger text-white hover:bg-sg-danger/90',
    FOCUS_RING,
  )

/**
 * Create a snapshot of the library or restore one. Requests are the host's
 * (render.js showBackupRestore); the host is only asked to refresh after a
 * restore.
 */
export function BackupRestoreDialog({ open, onClose }: Props) {
  const showToast = useStylesStore((s) => s.showToast)
  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [includeThumbs, setIncludeThumbs] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createMessage, setCreateMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<Snapshot | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const ids = { thumbs: useId(), heading: useId(), confirmBody: useId() }

  const reload = useCallback(async () => {
    const result = await fetchBackups()
    if (!result.ok) {
      setList({ status: 'error', error: result.error })
      return
    }
    setList({ status: 'ready', ...result.value })
  }, [])

  useEffect(() => {
    if (!open) return
    let live = true
    void fetchBackups().then((result) => {
      if (!live) return
      setList(result.ok ? { status: 'ready', ...result.value } : { status: 'error', error: result.error })
    })
    return () => {
      live = false
    }
  }, [open])

  const backups = useMemo(() => (list.status === 'ready' ? list.backups : []), [list])

  const runCreate = async () => {
    if (creating) return
    setCreating(true)
    setCreateMessage(null)
    try {
      const result = await createBackup(includeThumbs)
      if (!result.ok) {
        setCreateMessage({ text: result.error, error: true })
        return
      }
      if (!result.value.created) {
        setCreateMessage({ text: 'Nothing to backup (no files found)', error: false })
      } else {
        showToast('Backup created', 'success')
      }
      await reload()
    } finally {
      setCreating(false)
    }
  }

  const openRestore = (snapshot: Snapshot) => {
    setRestoreError(null)
    setRestoreTarget(snapshot)
  }

  const closeRestore = () => {
    if (restoring) return
    setRestoreTarget(null)
    setRestoreError(null)
  }

  const runRestore = async () => {
    const target = restoreTarget
    if (!target || restoring) return
    setRestoring(true)
    setRestoreError(null)
    try {
      const result = await restoreBackup(target.name)
      if (!result.ok) {
        setRestoreError(result.error)
        return
      }
      showToast(`Restored the snapshot from ${snapshotLabel(target.name).date}`, 'success')
      sendToHost({ type: 'SG_REFRESH' })
      setRestoreTarget(null)
      await reload()
    } finally {
      setRestoring(false)
    }
  }

  const thumbsLabel = (() => {
    if (list.status !== 'ready') return 'Include thumbnails'
    // The host showed "(empty)" when there is nothing to include.
    return list.thumbnailsBytes > 0
      ? `Include thumbnails (~${formatBytes(list.thumbnailsBytes)})`
      : 'Include thumbnails (empty)'
  })()

  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        title="Backup & restore"
        busy={creating || restoring}
        widthClassName="w-[28.75rem]"
        footer={
          <button type="button" disabled={creating || restoring} onClick={onClose} className={button('secondary')}>
            Close
          </button>
        }
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <label htmlFor={ids.thumbs} className="flex min-w-0 items-center gap-2 text-sm text-sg-text">
            <input
              id={ids.thumbs}
              type="checkbox"
              checked={includeThumbs}
              disabled={creating}
              onChange={(e) => setIncludeThumbs(e.target.checked)}
              className={cn('h-4 w-4 accent-sg-accent', FOCUS_RING)}
            />
            <span className="truncate">{thumbsLabel}</span>
          </label>
          <button
            type="button"
            disabled={creating || restoring}
            onClick={() => void runCreate()}
            className={cn(button('primary'), 'shrink-0')}
          >
            {creating ? 'Creating…' : 'Create backup'}
          </button>
        </div>
        {createMessage && (
          <p
            role={createMessage.error ? 'alert' : 'status'}
            className={cn('mb-2 text-xs break-words', createMessage.error ? 'text-sg-danger-text' : 'text-sg-muted')}
          >
            {createMessage.text}
          </p>
        )}

        <h4 id={ids.heading} className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-sg-muted">
          Snapshots{list.status === 'ready' ? ` (${backups.length})` : ''}
        </h4>
        {list.status === 'loading' && <p className="text-sm text-sg-muted">Loading snapshots…</p>}
        {list.status === 'error' && (
          <p role="alert" className="text-sm text-sg-danger-text break-words">{list.error}</p>
        )}
        {list.status === 'ready' && backups.length === 0 && (
          <p className="text-sm text-sg-muted">No snapshots yet.</p>
        )}
        {list.status === 'ready' && backups.length > 0 && (
          <ul aria-labelledby={ids.heading} className="divide-y divide-sg-border rounded border border-sg-border">
            {backups.map((b) => {
              const label = snapshotLabel(b.name)
              return (
                <li key={b.name} data-sg-snapshot={b.name} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-sg-text" data-sg-snapshot-date="true">
                      {label.date}
                      {label.suffix && <span className="ml-1.5 text-xs text-sg-muted">{label.suffix}</span>}
                    </div>
                    <div className="text-xs text-sg-muted" data-sg-snapshot-meta="true">
                      {formatBytes(b.size)} · {b.has_thumbnails ? 'with thumbnails' : 'without thumbnails'}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={creating || restoring}
                    onClick={() => openRestore(b)}
                    className={cn(button('secondary'), 'shrink-0')}
                  >
                    Restore…
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </ModalShell>

      <ModalShell
        open={open && restoreTarget !== null}
        onClose={closeRestore}
        title="Restore snapshot?"
        busy={restoring}
        initialFocus={cancelRef}
        widthClassName="w-[26rem]"
        footer={
          <>
            <button ref={cancelRef} type="button" disabled={restoring} onClick={closeRestore} className={button('secondary')}>
              Cancel
            </button>
            <button
              type="button"
              disabled={restoring}
              onClick={() => void runRestore()}
              className={button('danger')}
            >
              {restoring ? 'Restoring…' : 'Restore'}
            </button>
          </>
        }
      >
        {restoreTarget && (
          <div id={ids.confirmBody} data-sg-restore-text="true" className="space-y-2 text-sm text-sg-muted leading-relaxed">
            {restoreConfirmationText(restoreTarget, list.status === 'ready' ? list.keepSnapshots : undefined).map((line, i) => (
              <p key={i} className={cn(i === 0 && 'text-sg-text')}>
                {line}
              </p>
            ))}
          </div>
        )}
        {restoreError && (
          <p role="alert" className="mt-2 text-xs break-words text-sg-danger-text">{restoreError}</p>
        )}
      </ModalShell>
    </>
  )
}
