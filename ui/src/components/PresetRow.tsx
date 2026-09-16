import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  resolvePresetMembers,
  styleDisplayName,
  useStylesStore,
  type PresetRecord,
} from '../store/stylesStore'

type Props = {
  name: string
  preset: PresetRecord
}

export function PresetRow({ name, preset }: Props) {
  const styles = useStylesStore((s) => s.styles)
  const activePresetName = useStylesStore((s) => s.activePresetName)
  const loadPreset = useStylesStore((s) => s.loadPreset)
  const deletePreset = useStylesStore((s) => s.deletePreset)
  const renamePreset = useStylesStore((s) => s.renamePreset)
  const showToast = useStylesStore((s) => s.showToast)

  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(name)
  const [renameExists, setRenameExists] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  const members = resolvePresetMembers(preset.styles ?? [], styles)
  const found = members.filter((m) => m.status === 'found').length
  const total = members.length
  const missing = total - found
  const wcCount = (preset.wildcards ?? []).length
  const isActive = activePresetName === name

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  useEffect(() => {
    if (!renameOpen) return
    setRenameValue(name)
    setRenameExists(false)
    const id = requestAnimationFrame(() => renameRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [renameOpen, name])

  const metaParts = [
    total === 0
      ? '0 styles'
      : missing > 0
        ? `${found}/${total} styles`
        : `${total} styles`,
  ]
  if (wcCount > 0) metaParts.push(`${wcCount} wildcards`)
  if (preset.note?.trim()) metaParts.push(preset.note.trim())

  const doRename = async (overwrite: boolean) => {
    const next = renameValue.trim()
    if (!next || busy) return
    if (next === name) {
      setRenameOpen(false)
      return
    }
    setBusy(true)
    try {
      const result = await renamePreset(name, next, { overwrite })
      if (!result.ok) {
        if (result.error === 'exists') {
          setRenameExists(true)
          return
        }
        showToast(
          typeof result.error === 'string' && result.error
            ? result.error
            : 'Rename failed',
          'error',
        )
        return
      }
      showToast(`Renamed to "${next}"`, 'success')
      setRenameOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await deletePreset(name)
      if (!result.ok) {
        showToast(
          typeof result.error === 'string' && result.error
            ? result.error
            : 'Delete failed',
          'error',
        )
        return
      }
      showToast(`Deleted "${name}"`, 'success')
      setDeleteOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isActive
          ? 'border-sg-accent/60 bg-sg-accent/5'
          : 'border-sg-border bg-sg-surface/60 hover:border-sg-accent/40'
      }`}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 w-5 h-5 shrink-0 flex items-center justify-center text-sg-muted hover:text-sg-text transition-colors"
          aria-expanded={expanded}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <span className={`text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-sg-text truncate" title={name}>
            {name}
          </div>
          <div className="text-[11px] text-sg-muted mt-0.5 truncate" title={metaParts.join(' · ')}>
            {metaParts.join(' · ')}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => loadPreset(name, 'replace')}
            className="px-2 py-1 text-xs rounded border border-sg-border text-sg-text hover:bg-sg-accent/20 transition-colors"
            title="Clear selection and apply this set"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => loadPreset(name, 'add')}
            className="px-2 py-1 text-xs rounded border border-sg-border text-sg-text hover:bg-sg-accent/20 transition-colors"
            title="Merge this set into the current selection"
          >
            Add
          </button>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="w-7 h-7 flex items-center justify-center rounded border border-sg-border text-sg-muted hover:text-sg-text hover:bg-sg-accent/20 transition-colors"
              title="More"
              aria-label="More actions"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 min-w-[8rem] rounded-lg border border-sg-border bg-sg-surface shadow-xl py-1">
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20"
                  onClick={() => {
                    setMenuOpen(false)
                    setRenameOpen(true)
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20"
                  onClick={() => {
                    setMenuOpen(false)
                    setDeleteOpen(true)
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <ul className="border-t border-sg-border px-3 py-2 space-y-1">
              {members.length === 0 && (
                <li className="text-xs text-sg-muted">No styles in this set</li>
              )}
              {members.map((m, i) => {
                if (m.status === 'found') {
                  return (
                    <li key={`f:${m.style.source_file}:${m.style.name}:${i}`} className="text-xs text-sg-text truncate">
                      {styleDisplayName(m.style.name)}
                      {m.style.source_file ? (
                        <span className="text-sg-muted"> · {m.style.source_file.replace(/\\/g, '/').split('/').pop()?.replace(/\.csv$/i, '')}</span>
                      ) : null}
                    </li>
                  )
                }
                return (
                  <li
                    key={`m:${m.name}:${i}`}
                    className="text-xs text-amber-300/90 truncate"
                    title={m.pack ? `Missing from ${m.pack}` : 'Missing from library'}
                  >
                    Missing: {styleDisplayName(m.name)}
                    {m.pack ? ` (${m.pack})` : ''}
                  </li>
                )
              })}
              {(preset.wildcards ?? []).map((wc, i) => (
                <li key={`w:${wc.category}:${wc.spec}:${i}`} className="text-xs text-purple-300/80 truncate">
                  🎲 {wc.category}{wc.spec ? `:${wc.spec}` : ''}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {renameOpen && (
        <div className="fixed inset-0 z-[9999]">
          <div className="absolute inset-0 bg-black/50" onClick={() => { if (!busy) setRenameOpen(false) }} />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="pointer-events-auto bg-sg-surface border border-sg-border rounded-lg shadow-xl p-4 w-80"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-medium text-sg-text mb-2">Rename set</div>
              <input
                ref={renameRef}
                type="text"
                value={renameValue}
                disabled={busy}
                onChange={(e) => {
                  setRenameValue(e.target.value)
                  setRenameExists(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void doRename(renameExists)
                  }
                }}
                className="w-full h-9 px-3 rounded border border-sg-border bg-sg-surface text-sg-text text-sm focus:border-sg-accent focus:outline-none disabled:opacity-45"
              />
              {renameExists && (
                <div className="mt-2 text-xs text-amber-300/90">
                  A set named &ldquo;{renameValue.trim()}&rdquo; already exists.
                </div>
              )}
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRenameOpen(false)}
                  className="px-3 py-1.5 text-sm border border-sg-border rounded hover:bg-sg-accent/20"
                >
                  Cancel
                </button>
                {renameExists ? (
                  <button
                    type="button"
                    disabled={busy || !renameValue.trim()}
                    onClick={() => void doRename(true)}
                    className="px-3 py-1.5 text-sm rounded bg-amber-500/90 text-white"
                  >
                    Overwrite
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !renameValue.trim()}
                    onClick={() => void doRename(false)}
                    className="px-3 py-1.5 text-sm rounded bg-sg-accent text-white"
                  >
                    Rename
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div className="fixed inset-0 z-[9999]">
          <div className="absolute inset-0 bg-black/50" onClick={() => { if (!busy) setDeleteOpen(false) }} />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="pointer-events-auto bg-sg-surface border border-sg-border rounded-lg shadow-xl p-4 w-80"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-medium text-sg-text mb-2">Delete set?</div>
              <p className="text-xs text-sg-muted leading-relaxed">
                Delete &ldquo;{name}&rdquo; permanently? This cannot be undone.
              </p>
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDeleteOpen(false)}
                  className="px-3 py-1.5 text-sm border border-sg-border rounded hover:bg-sg-accent/20"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void doDelete()}
                  className="px-3 py-1.5 text-sm rounded bg-red-500/90 text-white hover:bg-red-500"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
