import { useStylesStore } from '../store/stylesStore'

export function SourceFilter() {
  const { sources, activeSource, setActiveSource } = useStylesStore()
  if (sources.length === 0) return null

  return (
    <select
      value={activeSource ?? ''}
      onChange={e => setActiveSource(e.target.value || null)}
      className="h-8 px-2 rounded border border-sg-border bg-sg-surface 
                 text-sg-text text-xs focus:border-sg-accent
                 focus:outline-none cursor-pointer"
    >
      <option value="">All Sources</option>
      {sources.map(src => (
        <option key={src} value={src}>
          {src.replace(/\.csv$/i, '')}
        </option>
      ))}
    </select>
  )
}
