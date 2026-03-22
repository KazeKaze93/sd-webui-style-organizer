import { useStylesStore } from '../store/stylesStore'

export function Sidebar() {
  const { activeCategory, setCategory, categories, styles } = useStylesStore()
  const cats = categories()

  const count = (cat: string | null) =>
    cat ? styles.filter(s => s.category === cat).length : styles.length

  return (
    <div className="w-44 shrink-0 flex flex-col gap-1 overflow-y-auto pr-2">
      <button
        onClick={() => setCategory(null)}
        className={`text-left px-3 py-2 rounded-md text-sm transition-colors
          ${!activeCategory 
            ? 'bg-sg-accent text-white' 
            : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
      >
        All
        <span className="ml-auto float-right text-xs opacity-60">
          {count(null)}
        </span>
      </button>
      {cats.map(cat => (
        <button
          key={cat}
          onClick={() => setCategory(cat)}
          className={`text-left px-3 py-2 rounded-md text-sm transition-colors
            ${activeCategory === cat
              ? 'bg-sg-accent text-white'
              : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
        >
          {cat}
          <span className="ml-auto float-right text-xs opacity-60">
            {count(cat)}
          </span>
        </button>
      ))}
    </div>
  )
}
