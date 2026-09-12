import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { sendToHost, type Style } from '../bridge'
import { buildSliceSpec } from '../lib/wildcardSlice'
import {
  getCategoryColor,
  LORA_VIEW,
  selectFilteredStyles,
  styleRowKey,
  useStylesStore,
} from '../store/stylesStore'
import { StyleCard } from './StyleCard'

export function StyleGrid({ windowed = false }: { windowed?: boolean }) {
  const {
    styles, search, activeCategory, activeSource,
    favorites, recentNames, presets,
    compactMode, collapsedCategories, toggleCollapse,
    selectedStyles, selectAllInCategory,
    sliceMode, sliceSelection,
    exitSliceMode, toggleSliceSelection,
    selectAllSlice, clearSliceSelection,
  } = useStylesStore(
    useShallow(s => ({
      styles: s.styles,
      search: s.search,
      activeCategory: s.activeCategory,
      activeSource: s.activeSource,
      favorites: s.favorites,
      recentNames: s.recentNames,
      presets: s.presets,
      compactMode: s.compactMode,
      collapsedCategories: s.collapsedCategories,
      toggleCollapse: s.toggleCollapse,
      selectedStyles: s.selectedStyles,
      selectAllInCategory: s.selectAllInCategory,
      sliceMode: s.sliceMode,
      sliceSelection: s.sliceSelection,
      exitSliceMode: s.exitSliceMode,
      toggleSliceSelection: s.toggleSliceSelection,
      selectAllSlice: s.selectAllSlice,
      clearSliceSelection: s.clearSliceSelection,
    }))
  )

  const filtered = useMemo(
    () => selectFilteredStyles(styles, search, activeCategory, activeSource, favorites, recentNames, presets),
    [styles, search, activeCategory, activeSource, favorites, recentNames, presets]
  )

  const sliceCategory = sliceMode?.category ?? null

  /** Currently visible (search/filter-applied) cards for the slice category. */
  const visibleSliceStyles = useMemo(() => {
    if (!sliceCategory) return [] as Style[]
    return filtered.filter((s) => (s.category || 'OTHER') === sliceCategory)
  }, [filtered, sliceCategory])

  /** Unfiltered category total for the compactor (source-scoped, not search-scoped). */
  const allNamesInCategory = useMemo(() => {
    if (!sliceCategory) return [] as string[]
    return styles
      .filter((s) => {
        if ((s.category || 'OTHER') !== sliceCategory) return false
        if (activeSource && s.source_file !== activeSource) return false
        return true
      })
      .map((s) => s.name)
  }, [styles, sliceCategory, activeSource])

  const gridClass = `grid content-start ${
    compactMode
      ? (windowed
          ? 'grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1'
          : 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1')
      : (windowed
          ? 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1'
          : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2')
  }`

  const renderSliceCard = (style: Style) => {
    const checked = sliceSelection.includes(style.name)
    const label = style.display_name || (style.name.includes('_')
      ? style.name.split('_').slice(1).join(' ')
      : style.name)
    return (
      <div key={styleRowKey(style)} className="relative">
        <StyleCard style={style} windowed={windowed} />
        <button
          type="button"
          className={`absolute inset-0 z-20 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent ${
            checked ? 'bg-purple-500/15 ring-1 ring-purple-400/50' : 'bg-transparent'
          }`}
          aria-pressed={checked}
          aria-label={`${checked ? 'Deselect' : 'Select'} ${label} for wildcard slice`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            toggleSliceSelection(style.name)
          }}
        >
          <span className="absolute top-1.5 right-1.5 flex items-center justify-center">
            <input
              type="checkbox"
              checked={checked}
              readOnly
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none h-4 w-4 accent-purple-500"
            />
          </span>
        </button>
      </div>
    )
  }

  const renderSliceModeBar = () => {
    if (!sliceMode) return null
    const cat = sliceMode.category
    return (
      <div
        role="toolbar"
        aria-label={`Wildcard slice selection for ${cat}`}
        className="flex flex-wrap items-center gap-2 px-1 py-2 mb-2 rounded-md
                   border border-purple-400/40 bg-purple-500/10"
      >
        <span className="text-sm text-sg-text font-medium">
          Slice: <span className="text-purple-300">{cat}</span>
        </span>
        <span className="text-xs text-sg-muted" aria-live="polite">
          {sliceSelection.length} selected
        </span>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Select all visible styles for wildcard slice"
          className="text-xs px-2 py-1 rounded text-sg-muted hover:text-sg-text
                     hover:bg-sg-surface/60 transition-colors"
          onClick={() => selectAllSlice(visibleSliceStyles.map((s) => s.name))}
        >
          Select all
        </button>
        <button
          type="button"
          aria-label="Clear wildcard slice selection"
          className="text-xs px-2 py-1 rounded text-sg-muted hover:text-sg-text
                     hover:bg-sg-surface/60 transition-colors"
          onClick={() => clearSliceSelection()}
        >
          Clear all
        </button>
        <button
          type="button"
          aria-label="Add selection as wildcard slice"
          className="text-xs px-2.5 py-1 rounded bg-purple-500/30 border border-purple-400/50
                     text-sg-text hover:bg-purple-500/45 transition-colors font-medium"
          onClick={() => {
            const spec = buildSliceSpec(cat, sliceSelection, allNamesInCategory)
            sendToHost({ type: 'SG_WILDCARD_SLICE', category: cat, spec })
            exitSliceMode()
          }}
        >
          Add as wildcard
        </button>
        <button
          type="button"
          aria-label="Cancel wildcard slice selection"
          className="text-xs px-2 py-1 rounded text-sg-muted hover:text-sg-text
                     hover:bg-sg-surface/60 transition-colors"
          onClick={() => exitSliceMode()}
        >
          Cancel
        </button>
      </div>
    )
  }

  // Slice-selection mode: hide other categories; search still drives `filtered` → visibleSliceStyles.
  if (sliceMode) {
    return (
      <div className="space-y-2">
        {renderSliceModeBar()}
        {visibleSliceStyles.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sg-muted text-sm">
            No styles found
          </div>
        ) : (
          <div className={gridClass} style={{ contentVisibility: 'auto' }}>
            {visibleSliceStyles.map(renderSliceCard)}
          </div>
        )}
      </div>
    )
  }

  if (activeCategory === 'presets') {
    const presetNames = Object.keys(presets).sort((a, b) => a.localeCompare(b))
    if (presetNames.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
          <p className="text-sg-muted text-sm">No presets saved yet</p>
          <p className="max-w-sm text-sg-muted/70 text-xs leading-relaxed">
            Open the toolbar <span className="text-sg-text/90">Presets</span> control, then use{' '}
            <span className="text-sg-text/90">Save current</span> in the Style Presets dialog.
          </p>
        </div>
      )
    }
    return (
      <div
        className={`grid content-start ${
          compactMode
            ? windowed
              ? 'grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1'
              : 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1'
            : windowed
              ? 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1'
              : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2'
        }`}
      >
        {presetNames.map((name) => {
          const style: Style = {
            name,
            prompt: '',
            negative_prompt: '',
            description: '',
            category: 'OTHER',
            source_file: '',
            has_thumbnail: false,
          }
          return (
            <StyleCard
              key={`preset:${name}`}
              style={style}
              windowed={windowed}
              presetName={name}
            />
          )
        })}
      </div>
    )
  }

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
      activeCategory !== '🕑 Recent' &&
      activeCategory !== LORA_VIEW) {
    return (
      <div className={gridClass} style={{ contentVisibility: 'auto' }}>
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
              onClick={() => toggleCollapse(cat)}
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
    </div>
  )
}
