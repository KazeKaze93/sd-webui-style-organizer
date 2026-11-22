import {
  Fragment,
  memo,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { BookMarked, Clock, Dna, Mouse, Star } from 'lucide-react'
import { LORA_SOURCE, LORA_VIEW, useCategoryColor, useStylesStore } from '../store/stylesStore'
import { useShallow } from 'zustand/react/shallow'
import { CategoryMenuItems } from './CategoryMenuItems'
import { ViewportFixedMenu } from './ViewportFixedMenu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { HOVER_POPUP_SHOW_DELAY_MS } from '../lib/hoverIntent'
import { useGatedTooltip } from '../lib/useGatedTooltip'
import { cn } from '../lib/utils'

const FAVORITES_ID = '★ Favorites'
const RECENT_ID = '🕑 Recent'

const NAV_FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

/** Gap between a button and the menu anchored under it (as the header More menu). */
const MENU_OFFSET_PX = 4

type MenuAnchor = { x: number; y: number; restoreFocusTo: HTMLElement }

/** Menu position under an element: for keyboard-opened context menus. */
function anchorUnder(el: HTMLElement): MenuAnchor {
  const rect = el.getBoundingClientRect()
  return { x: rect.left, y: rect.bottom + MENU_OFFSET_PX, restoreFocusTo: el }
}

/**
 * contextmenu from the ContextMenu key / Shift+F10 is not a right button press
 * (button !== 2) and often carries 0, 0: anchor it to the element. A real
 * right-click opens at the cursor.
 */
function contextMenuAnchor(e: ReactMouseEvent<HTMLElement>): MenuAnchor {
  const keyboard = e.nativeEvent.button !== 2 || (e.clientX === 0 && e.clientY === 0)
  if (keyboard) return anchorUnder(e.currentTarget)
  return { x: e.clientX, y: e.clientY, restoreFocusTo: e.currentTarget }
}

/** Category color as a non-text marker on the active (accent-filled) row. */
function ActiveColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/70"
      style={{ backgroundColor: color }}
    />
  )
}

/**
 * Active row: on-accent text, category color only as a dot (colored text on
 * the accent fill fails WCAG AA). Inactive row: colored name as before.
 */
function CategoryName({ category, active }: { category: string; active: boolean }) {
  const color = useCategoryColor(category)
  return (
    <>
      {active && <ActiveColorDot color={color} />}
      <span className="flex-1 truncate" style={active ? undefined : { color }}>
        {category}
      </span>
    </>
  )
}

/** Row count: dimmed on inactive rows only; 60% white on the accent fill fails AA. */
const countClass = (active: boolean) =>
  cn('text-xs shrink-0', active ? '' : 'opacity-60')

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Hover / Tab-focus hint on a sidebar row with a context menu: its count and
 * that a right-click opens the menu. Never on programmatic focus (useGatedTooltip).
 */
function RowHint({ title, blocked, children }: { title: string; blocked: boolean; children: ReactElement }) {
  const tip = useGatedTooltip(blocked)
  return (
    <Tooltip open={tip.open} onOpenChange={tip.onOpenChange}>
      <TooltipTrigger asChild {...tip.triggerProps}>
        {children}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        sideOffset={8}
        className="flex-col items-start gap-0.5"
        data-sg-category-hint="true"
      >
        <p className="text-xs font-medium text-sg-text">{title}</p>
        <p className="inline-flex items-center gap-1 text-[11px] text-sg-muted">
          <Mouse size={12} aria-hidden />
          Right-click for wildcard options
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * One draggable category row: the nav button selects the category and starts
 * the drag. Its menu opens with a right-click (at the cursor) or the
 * ContextMenu key / Shift+F10 (under the row); there is no button for it.
 */
function CategoryRow({
  cat,
  count,
  isActive,
  menuOpen,
  onSelect,
  onOpenMenu,
  onDragStart,
  onDragEnd,
}: {
  cat: string
  count: number
  isActive: boolean
  menuOpen: boolean
  onSelect: () => void
  onOpenMenu: (anchor: MenuAnchor) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const controls = useDragControls()
  /** A drag ends with a click on the nav button: that click must not toggle the category. */
  const draggedRef = useRef(false)
  /** No hint while the row is being dragged. */
  const [dragging, setDragging] = useState(false)
  return (
    <Reorder.Item
      value={cat}
      as="div"
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, opacity: 0.9 }}
      className={cn(
        'relative flex items-center rounded-md text-sm transition-colors cursor-grab active:cursor-grabbing',
        isActive
          ? 'bg-sg-accent text-white'
          : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface',
      )}
      data-sg-category-row={cat}
      data-sg-menu-open={menuOpen ? 'true' : undefined}
      onDragStart={() => {
        draggedRef.current = true
        setDragging(true)
        onDragStart()
      }}
      onDragEnd={() => {
        setDragging(false)
        onDragEnd()
      }}
    >
      <RowHint title={`${cat} · ${plural(count, 'style', 'styles')}`} blocked={menuOpen || dragging}>
      <button
        type="button"
        onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
          draggedRef.current = false
          controls.start(e)
        }}
        onClick={() => {
          if (draggedRef.current) {
            draggedRef.current = false
            return
          }
          onSelect()
        }}
        aria-current={isActive ? 'true' : undefined}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenMenu(contextMenuAnchor(e))
        }}
        className={cn(
          'flex-1 min-w-0 text-left px-3 py-2 rounded-md cursor-context-menu',
          NAV_FOCUS_RING,
        )}
      >
        <span className="flex items-center gap-2">
          <CategoryName category={cat} active={isActive} />
          <span className={countClass(isActive)} data-sg-category-count>
            {count}
          </span>
        </span>
      </button>
      </RowHint>
    </Reorder.Item>
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
  const [catMenu, setCatMenu] = useState<(MenuAnchor & { cat: string }) | null>(null)

  const openCatMenu = (anchor: MenuAnchor, cat: string) => {
    setCatMenu({ ...anchor, cat })
  }
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
    <TooltipProvider delayDuration={HOVER_POPUP_SHOW_DELAY_MS}>
    <div className="w-44 shrink-0 flex flex-col gap-1 pr-2">
      <button
        type="button"
        onClick={() => startTransition(() => setCategory(null))}
        aria-current={!activeCategory ? 'true' : undefined}
        className={cn(
          'w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors',
          NAV_FOCUS_RING,
          !activeCategory
            ? 'bg-sg-accent text-white'
            : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface',
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          {!activeCategory && <ActiveColorDot color={allColor} />}
          <span className="truncate" style={activeCategory ? { color: allColor } : undefined}>All</span>
        </span>
        <span className={countClass(!activeCategory)}>
          {countFor(null)}
        </span>
      </button>
      {specialCategories.map(({ id, label, Icon, count }) => {
      const alwaysShow = id === FAVORITES_ID || id === RECENT_ID
      if (!alwaysShow && count === 0) return null
      const isActive = activeCategory === id
      const navButton = (
        <button
          type="button"
          onClick={() => startTransition(() => setCategory(activeCategory === id ? null : id))}
          aria-current={isActive ? 'true' : undefined}
          onContextMenu={id === LORA_VIEW ? (e) => {
            e.preventDefault()
            e.stopPropagation()
            openCatMenu(contextMenuAnchor(e), 'LoRA')
          } : undefined}
          className={cn(
            'w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors',
            NAV_FOCUS_RING,
            isActive
              ? 'bg-sg-accent text-white'
              : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface',
            count === 0 ? 'opacity-40' : '',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </span>
          <span className={countClass(isActive)}>{count}</span>
        </button>
      )
      // LoRA is the one fixed entry with a right-click menu, so it gets the hint too.
      return id === LORA_VIEW ? (
        <RowHint key={id} title={`LoRA · ${plural(count, 'LoRA', 'LoRAs')}`} blocked={catMenu?.cat === 'LoRA'}>
          {navButton}
        </RowHint>
      ) : (
        <Fragment key={id}>{navButton}</Fragment>
      )
    })}
      <button
        type="button"
        onClick={() => startTransition(() => setCategory(activeCategory === 'presets' ? null : 'presets'))}
        aria-current={activeCategory === 'presets' ? 'true' : undefined}
        className={cn(
          'w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors',
          NAV_FOCUS_RING,
          activeCategory === 'presets'
            ? 'bg-sg-accent text-white'
            : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <BookMarked className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">Presets</span>
        </span>
        <span className={cn(countClass(activeCategory === 'presets'), 'tabular-nums')}>
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
        {dragOrder.map(cat => (
          <CategoryRow
            key={cat}
            cat={cat}
            count={countFor(cat)}
            isActive={activeCategory === cat}
            menuOpen={catMenu?.cat === cat}
            onSelect={() => startTransition(() => setCategory(activeCategory === cat ? null : cat))}
            onOpenMenu={(anchor) => openCatMenu(anchor, cat)}
            onDragStart={() => { dragActiveRef.current = true }}
            onDragEnd={() => {
              dragActiveRef.current = false
              setCategoryOrder(dragOrderRef.current)
            }}
          />
        ))}
      </Reorder.Group>
      {catMenu && (
        <ViewportFixedMenu
          x={catMenu.x}
          y={catMenu.y}
          onClose={() => setCatMenu(null)}
          restoreFocusTo={catMenu.restoreFocusTo}
        >
          <CategoryMenuItems
            category={catMenu.cat}
            onClose={() => setCatMenu(null)}
          />
        </ViewportFixedMenu>
      )}
    </div>
    </TooltipProvider>
  )
})
