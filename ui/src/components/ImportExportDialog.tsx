import { useId, useRef, useState, type DragEvent } from 'react'
import { Download, FileJson } from 'lucide-react'
import { sendToHost } from '../bridge'
import {
  IMPORT_SUMMARY_MAX_NAMES,
  downloadJson,
  exportFileName,
  fetchExport,
  importJsonText,
  importSummaryLines,
  importSummaryMessage,
  isJsonFile,
  type ImportSummary,
} from '../lib/importExport'
import { cn } from '../lib/utils'
import { useStylesStore } from '../store/stylesStore'
import { ModalShell } from './ModalShell'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

const NOT_JSON_MESSAGE = 'Choose a .json file.'

type Props = {
  open: boolean
  onClose: () => void
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}

type Outcome = { summary: ImportSummary | null }

/**
 * Export the whole library as one JSON file, or import one. The requests are
 * the host's (render.js showExportImport); the host is only asked to refresh
 * after a successful import.
 */
export function ImportExportDialog({ open, onClose }: Props) {
  const showToast = useStylesStore((s) => s.showToast)

  const [file, setFile] = useState<File | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const exportRef = useRef<HTMLButtonElement>(null)
  const ids = { input: useId(), exportHeading: useId(), importHeading: useId(), status: useId() }

  const choose = (picked: File | null | undefined) => {
    if (!picked) return
    setImportError(null)
    setOutcome(null)
    if (!isJsonFile(picked)) {
      setFile(null)
      setPickError(NOT_JSON_MESSAGE)
      return
    }
    setPickError(null)
    setFile(picked)
  }

  const runExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const result = await fetchExport()
      if (!result.ok) {
        showToast(result.error, 'error')
        return
      }
      downloadJson(result.data, exportFileName())
    } finally {
      setExporting(false)
    }
  }

  const runImport = async () => {
    if (!file || busy) return
    setBusy(true)
    setImportError(null)
    setOutcome(null)
    try {
      let text: string
      try {
        text = await readFileText(file)
      } catch {
        setImportError('Could not read the file')
        return
      }
      const result = await importJsonText(text)
      if (!result.ok) {
        setImportError(result.error)
        return
      }
      setOutcome({ summary: result.summary })
      // The import is done: a second click must not import the same file again.
      setFile(null)
      if (result.summary) {
        const toast = importSummaryMessage(result.summary)
        showToast(toast.message, toast.variant)
      } else {
        showToast('Import complete', 'success')
      }
      sendToHost({ type: 'SG_REFRESH' })
    } finally {
      setBusy(false)
    }
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (busy) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    // Leaving into a child is not leaving the zone.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
    setDragOver(false)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (busy) return
    choose(e.dataTransfer.files?.[0])
  }

  const button = (primary: boolean) =>
    cn(
      'px-3 py-1.5 text-sm rounded transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
      primary
        ? 'bg-sg-accent text-white hover:bg-sg-accent/90'
        : 'text-sg-text border border-sg-border hover:bg-sg-accent/20',
      FOCUS_RING,
    )

  const summaryView = (summary: ImportSummary) => {
    const lines = importSummaryLines(summary)
    const shown = summary.collisions.slice(0, IMPORT_SUMMARY_MAX_NAMES)
    const extra = summary.collisions.length - shown.length
    return (
      <>
        <p className="text-sg-text">{lines.imported}</p>
        {lines.collisions && (
          <>
            <p className="mt-1">{lines.collisions}</p>
            <ul className="mt-1 ml-4 list-disc" data-sg-import-collisions="true">
              {shown.map((name) => (
                <li key={name} className="break-words">{name}</li>
              ))}
            </ul>
            {extra > 0 && <p className="mt-1">+{extra} more</p>}
          </>
        )}
        {lines.invalid && <p className="mt-1">{lines.invalid}</p>}
      </>
    )
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Import / Export"
      busy={busy}
      initialFocus={exportRef}
      widthClassName="w-[27.5rem]"
      footer={
        <>
          <button type="button" disabled={busy} onClick={onClose} className={button(false)}>
            Close
          </button>
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => void runImport()}
            className={button(true)}
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </>
      }
    >
      <section aria-labelledby={ids.exportHeading} className="mb-4">
        <h4 id={ids.exportHeading} className="text-xs font-semibold uppercase tracking-wide text-sg-muted mb-1">
          Export
        </h4>
        <p className="text-sm text-sg-muted mb-2">Everything as one JSON file.</p>
        <button
          ref={exportRef}
          type="button"
          disabled={exporting}
          onClick={() => void runExport()}
          className={cn(button(false), 'inline-flex items-center gap-1.5')}
        >
          <Download size={14} aria-hidden />
          {exporting ? 'Exporting…' : 'Export all (JSON)'}
        </button>
      </section>

      <section aria-labelledby={ids.importHeading}>
        <h4 id={ids.importHeading} className="text-xs font-semibold uppercase tracking-wide text-sg-muted mb-1">
          Import
        </h4>
        <div
          data-sg-dropzone="true"
          data-drag-over={dragOver || undefined}
          onDragEnter={onDragOver}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center gap-2 rounded-md border-2 border-dashed px-4 py-5 text-center transition-colors',
            dragOver ? 'border-sg-accent bg-sg-accent/10' : 'border-sg-border',
          )}
        >
          <FileJson size={20} className="text-sg-muted" aria-hidden />
          <p className="text-xs text-sg-muted">Drop a .json export here, or</p>
          <input
            ref={inputRef}
            id={ids.input}
            type="file"
            accept=".json,application/json"
            disabled={busy}
            aria-describedby={ids.status}
            className="peer sr-only"
            onChange={(e) => {
              choose(e.target.files?.[0])
              // Picking the same file again must fire change again.
              e.target.value = ''
            }}
          />
          <label
            htmlFor={ids.input}
            className={cn(
              button(false),
              'cursor-pointer',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-sg-accent peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-sg-bg',
              'peer-disabled:opacity-45 peer-disabled:cursor-not-allowed',
            )}
          >
            Choose file
          </label>
          <p id={ids.status} className="text-xs break-all text-sg-text" data-sg-import-file="true">
            {file ? file.name : <span className="text-sg-muted">No file selected.</span>}
          </p>
        </div>

        {(pickError || importError) && (
          <p role="alert" className="mt-2 text-xs whitespace-pre-line break-words text-sg-danger-text">
            {pickError ?? importError}
          </p>
        )}

        {outcome && (
          <div
            role="status"
            data-sg-import-summary="true"
            className="mt-3 rounded border border-sg-border px-3 py-2 text-xs text-sg-muted"
          >
            {outcome.summary ? summaryView(outcome.summary) : <p className="text-sg-text">Import complete.</p>}
          </div>
        )}
      </section>
    </ModalShell>
  )
}
