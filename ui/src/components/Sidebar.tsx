import { useState } from 'react'
import { motion } from 'framer-motion'
import { sendToHost } from '../bridge'
import { getCategoryColor, useStylesStore } from '../store/stylesStore'

export function Sidebar() {
  const { activeCategory, setCategory, categories, favorites, recentNames } = useStylesStore()
  const [catMenu, setCatMenu] = useState<{
    x: number
    y: number
    cat: string
  } | null>(null)
  const cats = categories()
  const specialCategories = [
    { id: '★ Favorites', label: '★ Favorites', count: favorites.size },
    { id: '🕑 Recent', label: '🕑 Recent', count: recentNames.length },
  ]

  const count = (cat: string | null) => {
    const { styles, activeSource } = useStylesStore.getState()
    const src = activeSource
      ? styles.filter(s => s.source_file === activeSource)
      : styles
    return cat
      ? src.filter(s => s.category === cat).length
      : src.length
  }

  return (
    <div className="w-44 shrink-0 flex flex-col gap-1 overflow-y-auto pr-2">
      <button
        type="button"
        onClick={() => setCategory(null)}
        className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors relative overflow-hidden
          ${!activeCategory
            ? 'text-white'
            : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
      >
        {!activeCategory && (
          <motion.div
            layoutId="active-category"
            className="absolute inset-0 bg-sg-accent rounded-md -z-10"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
          />
        )}
        <span className="relative z-10 flex items-center gap-2 min-w-0">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: getCategoryColor('All') }}
            aria-hidden
          />
          <span className="truncate">All</span>
        </span>
        <span className="relative z-10 text-xs opacity-60 shrink-0">
          {count(null)}
        </span>
      </button>
      {specialCategories.map(({ id, label, count }) => count > 0 && (
        <button
          key={id}
          type="button"
          onClick={() => setCategory(activeCategory === id ? null : id)}
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors
      ${activeCategory === id
        ? 'bg-sg-accent text-white'
        : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
        >
          {label}
          <span className="ml-auto float-right text-xs opacity-60">{count}</span>
        </button>
      ))}
      <div className="border-t border-sg-border my-1" />
      {cats.map(cat => {
        const isActive = activeCategory === cat
        return (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setCatMenu({ x: e.clientX, y: e.clientY, cat })
            }}
            className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors relative overflow-hidden
              group cursor-context-menu
              ${isActive
                ? 'text-white'
                : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
          >
            {isActive && (
              <motion.div
                layoutId="active-category"
                className="absolute inset-0 bg-sg-accent rounded-md -z-10"
                transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2 min-w-0">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: getCategoryColor(cat) }}
                aria-hidden
              />
              <span className="truncate">{cat}</span>
            </span>
            <span className="ml-auto flex items-center gap-2 relative z-10 shrink-0">
              <span className="text-xs opacity-60">{count(cat)}</span>
            </span>
          </button>
        )
      })}
      {catMenu && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setCatMenu(null)} />
          <div
            className="fixed z-[9999] bg-[#0f172a] border border-sg-border rounded-lg shadow-xl py-1 min-w-52"
            style={{ left: catMenu.x, top: catMenu.y }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-white hover:bg-sg-accent/20 transition-colors"
              onClick={() => {
                sendToHost({
                  type: 'SG_WILDCARD_CATEGORY',
                  category: catMenu.cat
                })
                setCatMenu(null)
              }}
            >
              🎲 Add category as wildcard
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-white hover:bg-sg-accent/20 transition-colors"
              onClick={() => {
                sendToHost({
                  type: 'SG_GENERATE_CATEGORY_PREVIEWS',
                  category: catMenu.cat,
                  missingCount: 0
                })
                setCatMenu(null)
              }}
            >
              🎨 Generate previews...
            </button>
          </div>
        </>
      )}
    </div>
  )
}
