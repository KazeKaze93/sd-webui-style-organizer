import { useStylesStore } from '../store/stylesStore'

export function SelectedBar() {
  const { selectedStyles, toggleStyle } = useStylesStore()
  if (selectedStyles.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 px-4 py-2 
                    border-t border-sg-border bg-sg-surface/50">
      {selectedStyles.map(s => (
        <span
          key={s.name}
          className="flex items-center gap-1 px-2 py-1 rounded-full 
                     bg-sg-accent/20 border border-sg-accent/40 
                     text-xs text-sg-text cursor-pointer
                     hover:bg-sg-accent/30 transition-colors"
          onClick={() => toggleStyle(s)}
        >
          {s.name.includes('_') ? s.name.split('_').slice(1).join(' ') : s.name}
          <span className="text-sg-muted ml-1">✕</span>
        </span>
      ))}
    </div>
  )
}
