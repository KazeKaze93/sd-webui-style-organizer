import { memo, useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { sendToHost, WILDCARD_KIND_DECK, type Style } from '../bridge'
import {
  SLICE_ADD_SHUFFLE,
  SLICE_ADD_SHUFFLE_ARIA,
  SLICE_BAR_TITLE_SHUFFLE,
} from '../lib/wildcardLabels'
import { buildSliceSpec } from '../lib/wildcardSlice'
import {
  LORA_SOURCE,
  LORA_VIEW,
  matchesSearch,
  selectFilteredStyles,
  styleRowKey,
  useStylesStore,
} from '../store/stylesStore'
import { StyleCard } from './StyleCard'
import { PresetList } from './PresetList'
import { ViewportFixedMenu } from './ViewportFixedMenu'
import { WildcardMenuItems } from './WildcardMenuItems'
import { autoFillGridClass, VirtualStyleGrid } from './grid'

const FAVORITES_VIEW = '★ Favorites'
const RECENT_VIEW = '🕑 Recent'
/** Stable stubs so Favorites/Recent store churn does not invalidate All/category memos. */
const EMPTY_FAVORITES = new Set<string>()
const EMPTY_RECENT: string[] = []

/**
 * Profile (P toggle N=5000): StyleGrid 18 hits; `selectFilteredStyles` 2.9% —
 * toggle → addToRecent rebuilds recentNames and was subscribed always, so the
 * catalog filter memo re-ran even though selection does not change the list.
 * Subscribe to favorites/recent only in those views; memoize group arrays.
 */
export const StyleGrid = memo(function StyleGrid({ windowed = false }: { windowed?: boolean }) {
  const [loraCatMenu, setLoraCatMenu] = useState<{ x: number; y: number; cat: string } | null>(null)
  const {
    styles, search, activeCategory, activeSource,
    favorites, recentNames,
    compactMode, collapsedCategories, toggleCollapse,
    selectAllInCategory,
    sliceMode, sliceSelection,
    exitSliceMode, toggleSliceSelection,
    selectAllSlice, clearSliceSelection,
    setSearch, setCategory, setActiveSource,
  } = useStylesStore(
    useShallow(s => {
      const cat = s.activeCategory
      return {
        styles: s.styles,
        search: s.search,
        activeCategory: cat,
        activeSource: s.activeSource,
        // P: selectFilteredStyles on toggle — avoid recent/favorites deps off those views
        favorites: cat === FAVORITES_VIEW ? s.favorites : EMPTY_FAVORITES,
        recentNames: cat === RECENT_VIEW ? s.recentNames : EMPTY_RECENT,
        compactMode: s.compactMode,
        collapsedCategories: s.collapsedCategories,
        toggleCollapse: s.toggleCollapse,
        selectAllInCategory: s.selectAllInCategory,
        sliceMode: s.sliceMode,
        sliceSelection: s.sliceSelection,
        exitSliceMode: s.exitSliceMode,
        toggleSliceSelection: s.toggleSliceSelection,
        selectAllSlice: s.selectAllSlice,
        clearSliceSelection: s.clearSliceSelection,
        setSearch: s.setSearch,
        setCategory: s.setCategory,
        setActiveSource: s.setActiveSource,
      }
    })
  )

  const renderEmptyState = (opts?: { sliceCategory?: string | null }) => {
    const sliceCat = opts?.sliceCategory ?? null
    const hasSearch = search.trim().length > 0
    const hasSource = Boolean(activeSource)
    const hasCategory = Boolean(activeCategory) || Boolean(sliceCat)
    const reasonParts: string[] = []
    if (hasSearch) reasonParts.push(`search "${search.trim()}"`)
    if (hasSource) reasonParts.push(`source "${activeSource}"`)
    if (sliceCat) reasonParts.push(`slice category "${sliceCat}"`)
    else if (activeCategory) reasonParts.push(`category "${activeCategory}"`)
    const reason = reasonParts.length > 0
      ? `No styles match ${reasonParts.join(', ')}.`
      : 'No styles found.'
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-32 px-4 text-center">
        <p className="text-sg-muted text-sm">{reason}</p>
        {(hasSearch || hasSource || hasCategory) && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {hasSearch && (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded text-sg-muted hover:text-sg-text
                           hover:bg-sg-surface/60 transition-colors"
                onClick={() => setSearch('')}
              >
                Clear search
              </button>
            )}
            {hasSource && (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded text-sg-muted hover:text-sg-text
                           hover:bg-sg-surface/60 transition-colors"
                onClick={() => setActiveSource(null)}
              >
                All sources
              </button>
            )}
            {hasCategory && (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded text-sg-muted hover:text-sg-text
                           hover:bg-sg-surface/60 transition-colors"
                onClick={() => {
                  if (sliceCat) exitSliceMode()
                  setCategory(null)
                }}
              >
                All categories
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  const filtered = useMemo(
    () => selectFilteredStyles(styles, search, activeCategory, activeSource, favorites, recentNames),
    [styles, search, activeCategory, activeSource, favorites, recentNames]
  )

  const sliceCategory = sliceMode?.category ?? null

  /** Search/source-filtered styles without the sidebar category filter — slice mode may target another category. */
  const sliceModeFiltered = useMemo(
    () => selectFilteredStyles(styles, search, null, activeSource, favorites, recentNames),
    [styles, search, activeSource, favorites, recentNames]
  )

  /** Currently visible (search/filter-applied) cards for the slice category.
   * Aggregate "LoRA" bypasses CSV source-scoping (all LoRA files).
   * LoRA *subfolder* categories also keep LoRA-sourced rows even when a CSV
   * activeSource is set — otherwise slice mode opened from an in-grid LoRA
   * header would show "No styles". CSV rows still respect activeSource. */
  const visibleSliceStyles = useMemo(() => {
    if (!sliceCategory) return [] as Style[]
    if (sliceCategory === 'LoRA') {
      return styles.filter(s => s.source_file === LORA_SOURCE && matchesSearch(s, search))
    }
    const want = sliceCategory.toLowerCase()
    const fromCsv = sliceModeFiltered.filter(
      (s) => (s.category || 'OTHER').toLowerCase() === want,
    )
    const fromLora = styles.filter(
      (s) =>
        s.source_file === LORA_SOURCE &&
        (s.category || 'OTHER').toLowerCase() === want &&
        matchesSearch(s, search),
    )
    return fromCsv.length === 0 ? fromLora : fromCsv.concat(fromLora)
  }, [styles, search, sliceModeFiltered, sliceCategory])

  /** Unfiltered category total for the compactor (source-scoped, not search-scoped).
   * LoRA-sourced rows matching the category skip activeSource (same reason as above). */
  const allNamesInCategory = useMemo(() => {
    if (!sliceCategory) return [] as string[]
    return styles
      .filter((s) => {
          if (sliceCategory === 'LoRA') return s.source_file === LORA_SOURCE
          if ((s.category || 'OTHER') !== sliceCategory) return false
          if (s.source_file === LORA_SOURCE) return true
          if (activeSource && s.source_file !== activeSource) return false
          return true
      })
      .map((s) => s.name)
  }, [styles, sliceCategory, activeSource])

  const gridClass = autoFillGridClass(compactMode, windowed)

  const isFlatCategory = Boolean(
    activeCategory &&
      activeCategory !== FAVORITES_VIEW &&
      activeCategory !== RECENT_VIEW &&
      activeCategory !== LORA_VIEW,
  )

  // P: CardsRow/VirtualStyleGrid stack hits — new group arrays every parent render
  // forced virtualizer row rebuilds even when `filtered` was referentially stable.
  const flatGroups = useMemo(
    (): Array<[string, Style[]]> =>
      isFlatCategory && activeCategory ? [[activeCategory, filtered]] : [],
    [isFlatCategory, activeCategory, filtered],
  )

  const sortedGroups = useMemo((): Array<[string, Style[]]> => {
    if (isFlatCategory) return []
    const groups = filtered.reduce((acc, style) => {
      const cat = style.category || 'OTHER'
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(style)
      return acc
    }, {} as Record<string, Style[]>)
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [isFlatCategory, filtered])

  // Stable callback — fresh inline broke VirtualStyleGrid memo on every parent render.
  const onHeaderContextMenu = useCallback((cat: string, x: number, y: number) => {
    setLoraCatMenu({ x, y, cat })
  }, [])

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
            checked ? 'bg-sg-wildcard/15 ring-1 ring-sg-wildcard/50' : 'bg-transparent'
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
              className="pointer-events-none h-4 w-4 accent-sg-wildcard"
            />
          </span>
        </button>
      </div>
    )
  }

  const renderSliceModeBar = () => {
    if (!sliceMode) return null
    const cat = sliceMode.category
    const isDeck = sliceMode.kind === WILDCARD_KIND_DECK
    return (
      <div
        role="toolbar"
        aria-label={`Wildcard slice selection for ${cat}`}
        className="flex flex-wrap items-center gap-2 px-1 py-2 mb-2 rounded-md
                   border border-sg-wildcard/40 bg-sg-wildcard/10"
      >
        <span className="text-sm text-sg-text font-medium">
          {isDeck ? SLICE_BAR_TITLE_SHUFFLE : 'Slice: '}
          <span className="text-sg-wildcard-text">{cat}</span>
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
          aria-label={
            isDeck
              ? SLICE_ADD_SHUFFLE_ARIA
              : 'Add selection as wildcard slice'
          }
          className="text-xs px-2.5 py-1 rounded bg-sg-wildcard/30 border border-sg-wildcard/50
                     text-sg-text hover:bg-sg-wildcard/45 transition-colors font-medium"
          onClick={() => {
            const spec = buildSliceSpec(cat, sliceSelection, allNamesInCategory)
            sendToHost(
              isDeck
                ? {
                    type: 'SG_WILDCARD_SLICE',
                    category: cat,
                    spec,
                    kind: WILDCARD_KIND_DECK,
                  }
                : { type: 'SG_WILDCARD_SLICE', category: cat, spec },
            )
            exitSliceMode()
          }}
        >
          {isDeck ? SLICE_ADD_SHUFFLE : 'Add as wildcard'}
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
  // Slice mode is NOT virtualized (contract).
  if (sliceMode) {
    return (
      <div className="space-y-2">
        {renderSliceModeBar()}
        {visibleSliceStyles.length === 0 ? (
          renderEmptyState({ sliceCategory: sliceCategory })
        ) : (
          <div className={gridClass}>
            {visibleSliceStyles.map(renderSliceCard)}
          </div>
        )}
      </div>
    )
  }

  if (activeCategory === 'presets') {
    return <PresetList />
  }

  if (filtered.length === 0) {
    return renderEmptyState()
  }

  // Specific category — flat virtualized grid, no headers
  if (isFlatCategory) {
    return (
      <VirtualStyleGrid
        groups={flatGroups}
        collapsedCategories={collapsedCategories}
        compactMode={compactMode}
        windowed={windowed}
        includeHeaders={false}
        onToggleCollapse={toggleCollapse}
        onSelectAll={selectAllInCategory}
      />
    )
  }

  return (
    <VirtualStyleGrid
      groups={sortedGroups}
      collapsedCategories={collapsedCategories}
      compactMode={compactMode}
      windowed={windowed}
      includeHeaders
      enableLoraContextMenu={activeCategory === LORA_VIEW}
      onToggleCollapse={toggleCollapse}
      onSelectAll={selectAllInCategory}
      onHeaderContextMenu={onHeaderContextMenu}
    >
      {loraCatMenu && (
        <ViewportFixedMenu
          x={loraCatMenu.x}
          y={loraCatMenu.y}
          onDismiss={() => setLoraCatMenu(null)}
        >
          <WildcardMenuItems
            category={loraCatMenu.cat}
            onClose={() => setLoraCatMenu(null)}
          />
        </ViewportFixedMenu>
      )}
    </VirtualStyleGrid>
  )
})
