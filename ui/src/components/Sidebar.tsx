import { memo, startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { Reorder } from 'framer-motion'
import { BookMarked, Clock, Dna, Image, Star } from 'lucide-react'
import { sendToHost } from '../bridge'
import { LORA_SOURCE, LORA_VIEW, useCategoryColor, useStylesStore } from '../store/stylesStore'
import { useShallow } from 'zustand/react/shallow'
import { MenuDivider } from './MenuDivider'
import { ViewportFixedMenu } from './ViewportFixedMenu'
import { WildcardMenuItems } from './WildcardMenuItems'

const FAVORITES_ID = '★ Favorites'
const RECENT_ID = '🕑 Recent'

function CategoryName({ category }: { category: string }) {
  const color = useCategoryColor(category)
  return (
    <span className="flex-1 truncate" style={{ color }}>
      {category}
    </span>
  )
}

/**
 * Profile (P toggle N=5000): Sidebar 44 stack hits; `count` 2.0% self;
 * motion/measureScroll ~28% bucket — layoutId springs + full-list recount on
 * parent/selection churn. Cache source-scoped counts; drop layoutId motion.
 */
export const Sidebar = memo(function Sidebar() {
  const {
    activeCategory, setCategory, categories, favoritesSize, recentCount,
    setCategoryOrder, presetsCount, styles, activeSource,
  } = useStylesStore(
    useShallow(s => ({
      activeCategory: s.activeCategory,
      setCategory: s.setCategory,
      categories: s.categories,
      favoritesSize: s.favorites.size,
      recentCount: s.recentNames.length,
      setCategoryOrder: s.setCategoryOrder,
      presetsCount: Object.keys(s.presets).length,
      styles: s.styles,
      activeSource: s.activeSource,
      categoryOrder: s.categoryOrder,
    }))
  )
  const allColor = useCategoryColor('All')
  const [catMenu, setCatMenu] = useState<{
    x: number
    y: number
    cat: string
  } | null>(null)
  const cats = categories()
  const catsSig = cats.join('\0')
  const [dragOrder, setDragOrder] = useState<string[]>(cats)
  const dragOrderRef = useRef(dragOrder)
  dragOrderRef.current = dragOrder
  const dragActiveRef = useRef(false)

  useEffect(() => {
    if (!dragActiveRef.current) {
      setDragOrder(cats)
    }
    // catsSig tracks cats identity; cats read from latest categories()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [catsSig])

  // P: Sidebar.tsx `count` — was O(cats · N) filter per render on toggle.
  const categoryCounts = useMemo(() => {
    const counts = new Map<string | null, number>()
    let total = 0
    let lora = 0
    for (const s of styles) {
      if (s.source_file === LORA_SOURCE) {
        lora += 1
        continue
      }
      if (activeSource && s.source_file !== activeSource) continue
      total += 1
      const cat = s.category || 'OTHER'
      counts.set(cat, (counts.get(cat) ?? 0) + 1)
    }
    counts.set(null, total)
    counts.set(LORA_VIEW, lora)
    return counts
  }, [styles, activeSource])

  const specialCategories = [
    { id: FAVORITES_ID, label: 'Favorites', Icon: Star, count: favoritesSize },
    { id: RECENT_ID, label: 'Recent', Icon: Clock, count: recentCount },
    { id: LORA_VIEW, label: 'LoRA', Icon: Dna, count: categoryCounts.get(LORA_VIEW) ?? 0 },
  ]

  useEffect(() => {
    void useStylesStore.getState().fetchPresets()
  }, [])

  const countFor = (cat: string | null) => categoryCounts.get(cat) ?? 0

  return (
    <div className="w-44 shrink-0 flex flex-col gap-1 pr-2">
      <button
        type="button"
        onClick={() => startTransition(() => setCategory(null))}
        className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors
          ${!activeCategory
            ? 'bg-sg-accent text-white'
            : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate" style={{ color: allColor }}>All</span>
        </span>
        <span className="text-xs opacity-60 shrink-0">
          {countFor(null)}
        </span>
      </button>
      {specialCategories.map(({ id, label, Icon, count }) => {
      const alwaysShow = id === FAVORITES_ID || id === RECENT_ID
      if (!alwaysShow && count === 0) return null
      return (
        <button
          key={id}
          type="button"
          onClick={() => startTransition(() => setCategory(activeCategory === id ? null : id))}
          onContextMenu={id === LORA_VIEW ? (e) => {
            e.preventDefault()
            e.stopPropagation()
            setCatMenu({ x: e.clientX, y: e.clientY, cat: 'LoRA' })
          } : undefined}
          className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors
      ${activeCategory === id
        ? 'bg-sg-accent text-white'
        : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}
      ${count === 0 ? 'opacity-40' : ''}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </span>
          <span className="text-xs opacity-60 shrink-0">{count}</span>
        </button>
      )
    })}
      <button
        type="button"
        onClick={() => startTransition(() => setCategory(activeCategory === 'presets' ? null : 'presets'))}
        className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors
          ${activeCategory === 'presets'
            ? 'bg-sg-accent text-white'
            : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <BookMarked className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">Presets</span>
        </span>
        <span className="shrink-0 text-xs opacity-60 tabular-nums">
          {presetsCount}
        </span>
      </button>
      <div className="border-t border-sg-border my-1" />
      <Reorder.Group
        axis="y"
        values={dragOrder}
        onReorder={(newOrder) => {
          dragOrderRef.current = newOrder
          setDragOrder(newOrder)
        }}
        as="div"
        className="flex flex-col gap-1"
      >
        {dragOrder.map(cat => {
          const isActive = activeCategory === cat
          return (
            <Reorder.Item
              key={cat}
              value={cat}
              as="div"
              whileDrag={{ scale: 1.02, opacity: 0.9 }}
              className="cursor-grab active:cursor-grabbing"
              onDragStart={() => { dragActiveRef.current = true }}
              onDragEnd={() => {
                dragActiveRef.current = false
                setCategoryOrder(dragOrderRef.current)
              }}
            >
              <button
                type="button"
                onClick={() => startTransition(() => setCategory(activeCategory === cat ? null : cat))}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setCatMenu({ x: e.clientX, y: e.clientY, cat })
                }}
                className={`w-full text-left px-3 py-2 rounded-md text-sm 
                    transition-colors cursor-context-menu
                  ${isActive
                    ? 'bg-sg-accent text-white'
                    : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
              >
                <span className="flex items-center gap-2">
                  <CategoryName category={cat} />
                  <span className="text-xs opacity-60 shrink-0">{countFor(cat)}</span>
                </span>
              </button>
            </Reorder.Item>
          )
        })}
      </Reorder.Group>
      {catMenu && (
        <ViewportFixedMenu
          x={catMenu.x}
          y={catMenu.y}
          onDismiss={() => setCatMenu(null)}
        >
          <WildcardMenuItems
            category={catMenu.cat}
            onClose={() => setCatMenu(null)}
          />
          {catMenu.cat !== 'LoRA' && (
            <>
              <MenuDivider />
              <button
                type="button"
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
                onClick={() => {
                  const rawSrc =
                    useStylesStore.getState().activeSource ??
                    (typeof localStorage !== 'undefined' ? localStorage.getItem('sg_v2_last_source') : null)
                  sendToHost({
                    type: 'SG_GENERATE_CATEGORY_PREVIEWS',
                    category: catMenu.cat,
                    missingCount: 0,
                    ...(rawSrc ? { source: rawSrc } : {}),
                  })
                  setCatMenu(null)
                }}
              >
                <Image className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Generate previews...
              </button>
            </>
          )}
        </ViewportFixedMenu>
      )}
    </div>
  )
})
