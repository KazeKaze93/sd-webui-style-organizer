import { useMemo } from 'react'
import { useStylesStore } from '../store/stylesStore'
import { PresetRow } from './PresetRow'

export function PresetList() {
  const presets = useStylesStore((s) => s.presets)
  const search = useStylesStore((s) => s.search)

  const names = useMemo(() => {
    const q = search.trim().toLowerCase()
    return Object.keys(presets)
      .filter((name) => {
        if (!q) return true
        const note = presets[name]?.note || ''
        return name.toLowerCase().includes(q) || note.toLowerCase().includes(q)
      })
      .sort((a, b) => a.localeCompare(b))
  }, [presets, search])

  if (Object.keys(presets).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
        <p className="text-sg-muted text-sm">No saved sets yet</p>
        <p className="max-w-sm text-sg-muted/70 text-xs leading-relaxed">
          Select styles, then use <span className="text-sg-text/90">Save set</span> in the
          selection bar. Apply merges a set into your current selection.
        </p>
      </div>
    )
  }

  if (names.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sg-muted text-sm">
        No sets match search
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 px-1 py-1">
      {names.map((name) => (
        <PresetRow key={name} name={name} preset={presets[name]} />
      ))}
    </div>
  )
}
