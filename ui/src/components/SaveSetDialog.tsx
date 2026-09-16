import { useEffect, useRef, useState } from 'react'
import {
  suggestPresetName,
  useStylesStore,
} from '../store/stylesStore'

export interface SaveSetDialogProps {
  open: boolean
  onClose: () => void
}

export function SaveSetDialog({ open, onClose }: SaveSetDialogProps) {
  const selectedStyles = useStylesStore((s) => s.selectedStyles)
  const activeWildcards = useStylesStore((s) => s.activeWildcards)
  const savePreset = useStylesStore((s) => s.savePreset)
  const showToast = useStylesStore((s) => s.showToast)

  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [includeWildcards, setIncludeWildcards] = useState(true)
  const [existsWarning, setExistsWarning] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const hasWildcards = activeWildcards.length > 0

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false)
      setExistsWarning(false)
      return
    }
    setName(suggestPresetName(selectedStyles))
    setNote('')
    setIncludeWildcards(hasWildcards)
    setExistsWarning(false)
    setIsSubmitting(false)
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, selectedStyles, hasWildcards])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!isSubmitting) onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose, isSubmitting])

  if (!open) return null

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && selectedStyles.length > 0 && !isSubmitting

  const doSave = async (overwrite: boolean) => {
    if (!canSave && !overwrite) return
    if (!trimmed || selectedStyles.length === 0) return
    setIsSubmitting(true)
    try {
      const styles = selectedStyles.map((s) => ({
        name: s.name,
        source_file: s.source_file || '',
        weight: 1.0,
      }))
      const result = await savePreset(trimmed, styles, {
        overwrite,
        wildcards: includeWildcards && hasWildcards ? activeWildcards : [],
        note: note.trim(),
      })
      if (!result.ok) {
        if (result.error === 'exists') {
          setExistsWarning(true)
          return
        }
        showToast(
          typeof result.error === 'string' && result.error
            ? result.error
            : 'Save set failed',
          'error',
        )
        return
      }
      showToast(`Saved set "${trimmed}"`, 'success')
      onClose()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => { if (!isSubmitting) onClose() }}
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="pointer-events-auto bg-sg-surface border border-sg-border rounded-lg shadow-xl p-4 w-[22rem]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-sm font-medium text-sg-text mb-3">Save set</div>

          <label className="block text-xs text-sg-muted mb-1">Name</label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            disabled={isSubmitting}
            onChange={(e) => {
              setName(e.target.value)
              setExistsWarning(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) {
                e.preventDefault()
                void doSave(existsWarning)
              }
            }}
            className="w-full h-9 px-3 rounded border border-sg-border
                       bg-sg-surface text-sg-text text-sm
                       placeholder:text-sg-muted focus:border-sg-accent
                       focus:outline-none transition-colors disabled:opacity-45"
            placeholder="Set name"
          />

          <label className="block text-xs text-sg-muted mb-1 mt-3">Note (optional)</label>
          <textarea
            value={note}
            disabled={isSubmitting}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded border border-sg-border
                       bg-sg-surface text-sg-text text-sm resize-none
                       placeholder:text-sg-muted focus:border-sg-accent
                       focus:outline-none transition-colors disabled:opacity-45"
            placeholder="Short note"
          />

          {hasWildcards && (
            <label className="flex items-center gap-2 mt-3 text-sm text-sg-text cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeWildcards}
                disabled={isSubmitting}
                onChange={(e) => setIncludeWildcards(e.target.checked)}
                className="rounded border-sg-border"
              />
              Include active wildcards ({activeWildcards.length})
            </label>
          )}

          {existsWarning && (
            <div className="mt-3 text-xs text-amber-300/90 leading-relaxed">
              A set named &ldquo;{trimmed}&rdquo; already exists. Overwrite it?
            </div>
          )}

          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-sg-text border border-sg-border rounded hover:bg-sg-accent/20 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            {existsWarning ? (
              <button
                type="button"
                disabled={isSubmitting || !trimmed}
                onClick={() => void doSave(true)}
                className="px-3 py-1.5 text-sm rounded bg-amber-500/90 text-white hover:bg-amber-500 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
              >
                Overwrite
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSave}
                onClick={() => void doSave(false)}
                className="px-3 py-1.5 text-sm rounded bg-sg-accent text-white hover:bg-sg-accent/90 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
              >
                Save
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
