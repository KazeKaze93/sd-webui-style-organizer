import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { sendToHost } from '../bridge'
import {
  getCategoryColor,
  styleRowKey,
  useStylesStore,
} from '../store/stylesStore'
import { StyleCard } from './StyleCard'

export function StyleGrid({ windowed = false }: { windowed?: boolean }) {
  const {
    filteredStyles, activeCategory, compactMode,
    collapsedCategories, toggleCollapse,
    selectedStyles, selectAllInCategory
  } = useStylesStore()
  const [catMenu, setCatMenu] = useState<{
    x: number
    y: number
    cat: string
    missingCount: number
  } | null>(null)

  const filtered = filteredStyles()

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 
                      text-sg-muted text-sm">
        No styles found
      </div>
    )
  }

  // If specific category selected - flat grid, no headers
  if (activeCategory &&
      activeCategory !== '★ Favorites' &&
      activeCategory !== '🕑 Recent') {
    return (
      <div className={`grid content-start ${
        compactMode
          ? (windowed
              ? 'grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1'
              : 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1')
          : (windowed
              ? 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1'
              : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2')
      }`} style={{ contentVisibility: 'auto' }}>
        {filtered.map(style => (
          <StyleCard key={styleRowKey(style)} style={style} windowed={windowed} />
        ))}
      </div>
    )
  }

  // Group by category for All view
  const groups = filtered.reduce((acc, style) => {
    const cat = style.category || 'OTHER'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(style)
    return acc
  }, {} as Record<string, typeof filtered>)

  const sortedGroups = Object.entries(groups).sort(([a], [b]) =>
    a.localeCompare(b)
  )

  return (
    <div className="space-y-4">
      {sortedGroups.map(([cat, catStyles]) => {
        const isCollapsed = collapsedCategories.has(cat)
        const color = getCategoryColor(cat)
        const allSelected = catStyles.every(s =>
          selectedStyles.some(sel => sel.name === s.name)
        )

        return (
          <div key={cat}>
            {/* Category header */}
            <div
              className="flex items-center gap-2 mb-2 sticky top-0 
                            bg-sg-bg/95 backdrop-blur-sm py-1 z-10 cursor-pointer hover:bg-sg-surface/30 rounded-md transition-colors -mx-1 px-1"
              title="Right-click for options"
              onClick={() => toggleCollapse(cat)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const missing = catStyles.filter(s =>
                  !localStorage.getItem(`sg_thumb_v_${s.name}`)
                ).length
                setCatMenu({ x: e.clientX, y: e.clientY, cat, missingCount: missing })
              }}
            >
              <span className="text-sg-muted">
                {isCollapsed ? '▶' : '▼'}
              </span>
              <span
                className="text-xs font-bold tracking-wider uppercase"
                style={{ color }}
              >
                {cat}
              </span>
              <span className="text-xs text-sg-muted/60">
                ({catStyles.length})
              </span>
              <div className="flex-1" />
              <button
                onClick={() => selectAllInCategory(cat)}
                className="text-xs text-sg-muted hover:text-sg-accent 
                           transition-colors px-2 py-0.5 rounded
                           hover:bg-sg-accent/10"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {/* Cards */}
            <AnimatePresence>
              {!isCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className={`grid ${
                    compactMode
                      ? (windowed
                          ? 'grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1'
                          : 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1')
                      : (windowed
                          ? 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1'
                          : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2')
                  }`} style={{ contentVisibility: 'auto' }}>
                    {catStyles.map(style => (
                      <StyleCard key={styleRowKey(style)} style={style} windowed={windowed} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
      {catMenu && (
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setCatMenu(null)}
          />
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
            {catMenu.missingCount > 0 && (
              <button
                className="w-full text-left px-3 py-1.5 text-sm text-white hover:bg-sg-accent/20 transition-colors"
                onClick={() => {
                  const rawSrc =
                    useStylesStore.getState().activeSource ??
                    (typeof localStorage !== 'undefined' ? localStorage.getItem('sg_v2_last_source') : null)
                  sendToHost({
                    type: 'SG_GENERATE_CATEGORY_PREVIEWS',
                    category: catMenu.cat,
                    missingCount: catMenu.missingCount,
                    ...(rawSrc ? { source: rawSrc } : {}),
                  } as any)
                  setCatMenu(null)
                }}
              >
                🎨 Generate previews ({catMenu.missingCount} missing)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
