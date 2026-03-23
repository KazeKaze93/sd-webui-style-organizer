import { useStylesStore } from '../store/stylesStore'

export function SourceFilter() {
  const { sources, activeSource, setActiveSource } = useStylesStore()
  if (sources.length === 0) return null
  const labelOf = (src: string) => {
    const normalized = src.replace(/\\/g, '/')
    const base = normalized.split('/').pop() || src
    return base.replace(/\.csv$/i, '')
  }
  const currentLabel = activeSource ? labelOf(activeSource) : 'All Sources'
  const selectWidthCh = Math.min(Math.max(currentLabel.length + 4, 14), 40)

  return (
    <select
      value={activeSource ?? ''}
      onChange={e => setActiveSource(e.target.value || null)}
      className="h-9 px-2 rounded border border-sg-border bg-sg-surface 
                 text-sg-text text-xs focus:border-sg-accent
                 focus:outline-none cursor-pointer"
      style={{ width: `${selectWidthCh}ch` }}
      title={currentLabel}
    >
      <option value="">All Sources</option>
      {sources.map(src => (
        <option key={src} value={src} title={src}>
          {labelOf(src)}
        </option>
      ))}
    </select>
  )
}
