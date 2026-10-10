import { startTransition, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Reorder } from 'framer-motion'
import { BookMarked, Clock, Dna, Image, Star } from 'lucide-react'
import { sendToHost } from '../bridge'
import { getCategoryColor, LORA_SOURCE, LORA_VIEW, useStylesStore } from '../store/stylesStore'
import { useShallow } from 'zustand/react/shallow'
import { MenuDivider } from './MenuDivider'
import { ViewportFixedMenu } from './ViewportFixedMenu'
import { WildcardMenuItems } from './WildcardMenuItems'

const FAVORITES_ID = '★ Favorites'
const RECENT_ID = '🕑 Recent'

export function Sidebar() {
  const {
    activeCategory, setCategory, categories, favorites, recentNames,
    setCategoryOrder, presets, styles,
  } = useStylesStore(
    useShallow(s => ({
      activeCategory: s.activeCategory,
      setCategory: s.setCategory,
      categories: s.categories,
      favorites: s.favorites,
      recentNames: s.recentNames,
      setCategoryOrder: s.setCategoryOrder,
      presets: s.presets,
      styles: s.styles,
      // categories() deps — refresh list/order without App re-renders
      activeSource: s.activeSource,
      categoryOrder: s.categoryOrder,
    }))
  )
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

  const loraCount = styles.reduce((n, s) => s.source_file === LORA_SOURCE ? n + 1 : n, 0)
  const specialCategories = [
    { id: FAVORITES_ID, label: 'Favorites', Icon: Star, count: favorites.size },
    { id: RECENT_ID, label: 'Recent', Icon: Clock, count: recentNames.length },
    { id: LORA_VIEW, label: 'LoRA', Icon: Dna, count: loraCount },
  ]

  useEffect(() => {
    void useStylesStore.getState().fetchPresets()
  }, [])

  const count = (cat: string | null) => {
    const { styles, activeSource } = useStylesStore.getState()
    const src = (activeSource
      ? styles.filter(s => s.source_file === activeSource)
      : styles
    ).filter(s => s.source_file !== LORA_SOURCE)
    return cat
      ? src.filter(s => s.category === cat).length
      : src.length
  }

  return (
    <div className="w-44 shrink-0 flex flex-col gap-1 pr-2">
      <button
        type="button"
        onClick={() => startTransition(() => setCategory(null))}
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
          <span className="truncate" style={{ color: getCategoryColor('All') }}>All</span>
        </span>
        <span className="relative z-10 text-xs opacity-60 shrink-0">
          {count(null)}
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
        className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors relative overflow-hidden
          ${activeCategory === 'presets'
            ? 'text-white'
            : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
      >
        {activeCategory === 'presets' && (
          <motion.div
            layoutId="active-category"
            className="absolute inset-0 bg-sg-accent rounded-md -z-10"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
          />
        )}
        <span className="relative z-10 flex min-w-0 items-center gap-2">
          <BookMarked className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">Presets</span>
        </span>
        <span className="relative z-10 shrink-0 text-xs opacity-60 tabular-nums">
          {Object.keys(presets).length}
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
                    transition-colors cursor-context-menu relative overflow-hidden
                  ${isActive
                    ? 'bg-sg-accent text-white'
                    : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-category"
                    className="absolute inset-0 bg-sg-accent rounded-md -z-10"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
                  />
                )}
                <span className="flex items-center gap-2 relative z-10">
                  <span className="flex-1 truncate" style={{ color: getCategoryColor(cat) }}>
                    {cat}
                  </span>
                  <span className="text-xs opacity-60 shrink-0">{count(cat)}</span>
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
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-white hover:bg-sg-accent/20 transition-colors"
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
}
