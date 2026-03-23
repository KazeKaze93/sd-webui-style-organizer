import { create } from 'zustand'
import { sendToHost, type Style, type Tab } from '../bridge'

interface Conflict {
  styleA: string
  styleB: string
  reason: string
}

export function getCategoryColor(category: string): string {
  // Fixed palette of visually distinct colors — no duplicates
  const PALETTE = [
    '#f472b6', // pink
    '#fb923c', // orange
    '#facc15', // yellow
    '#4ade80', // green
    '#34d399', // emerald
    '#22d3ee', // cyan
    '#60a5fa', // blue
    '#818cf8', // indigo
    '#a78bfa', // violet
    '#e879f9', // fuchsia
    '#f87171', // red
    '#a3e635', // lime
    '#2dd4bf', // teal
    '#38bdf8', // sky
    '#c084fc', // purple
    '#fb7185', // rose
    '#fdba74', // amber
    '#86efac', // light green
    '#93c5fd', // light blue
    '#fda4af', // light pink
    '#6ee7b7', // light teal
    '#fcd34d', // light yellow
    '#d8b4fe', // light purple
    '#67e8f9', // light cyan
    '#bbf7d0', // mint
    '#fecaca', // salmon
    '#bfdbfe', // powder blue
    '#ddd6fe', // lavender
    '#fed7aa', // peach
    '#bbf7d0', // seafoam
  ]

  // Deterministic index based on category name hash
  let hash = 0
  for (let i = 0; i < category.length; i++) {
    hash = category.charCodeAt(i) + ((hash << 5) - hash)
    hash = hash & hash // Convert to 32bit int
  }

  // Spread across palette using prime multiplication to avoid clustering
  const index = Math.abs(hash * 2654435761) % PALETTE.length
  return PALETTE[index]
}

interface StylesStore {
  toasts: { id: number; message: string; variant: 'success' | 'error' | 'info' }[]
  // Data
  styles: Style[]
  tab: Tab
  
  // Filters
  search: string
  activeCategory: string | null
  sources: string[]
  activeSource: string | null
  
  // Selection
  selectedStyles: Style[]
  collapsedCategories: Set<string>
  silentMode: boolean
  compactMode: boolean
  favorites: Set<string>
  recentNames: string[]
  conflicts: Conflict[]
  usageCounts: Record<string, number>
  categoryOrder: string[]
  
  // Actions
  setStyles: (styles: Style[], tab: Tab) => void
  setSearch: (q: string) => void
  setCategory: (cat: string | null) => void
  setActiveSource: (src: string | null) => void
  toggleSilent: () => void
  toggleCompact: () => void
  toggleCollapse: (cat: string) => void
  collapseAll: () => void
  expandAll: () => void
  selectAllInCategory: (cat: string) => void
  toggleStyle: (style: Style) => void
  setSelectedStyles: (styles: Style[]) => void
  clearAll: () => void
  showToast: (message: string, variant?: 'success' | 'error' | 'info') => void
  detectConflicts: () => void
  loadUsage: () => Promise<void>
  incrementUsage: (name: string) => void
  setCategoryOrder: (order: string[]) => void
  toggleFavorite: (name: string) => void
  isFavorite: (name: string) => boolean
  addToRecent: (name: string) => void
  
  // Derived
  categories: () => string[]
  filteredStyles: () => Style[]
}

export const useStylesStore = create<StylesStore>((set, get) => ({
  toasts: [],
  styles: [],
  tab: 'txt2img',
  search: '',
  activeCategory: null,
  activeSource: null,
  sources: [],
  selectedStyles: [],
  conflicts: [],
  usageCounts: {},
  categoryOrder: JSON.parse(
    localStorage.getItem('sg_v2_category_order') || '[]'
  ) as string[],
  collapsedCategories: new Set(),
  silentMode: false,
  compactMode: false,
  favorites: new Set(
    JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')
  ),
  recentNames: JSON.parse(
    localStorage.getItem('sg_v2_recent') || '[]'
  ),

  setStyles: (styles, tab) => {
    const sources = [...new Set(
      styles.map(s => s.source_file).filter(Boolean)
    )].sort()
    
    // Restore last selected source if it still exists
    const lastSource = localStorage.getItem('sg_v2_last_source')
    const activeSource = lastSource && sources.includes(lastSource)
      ? lastSource
      : null
    
    set({ styles, tab, sources, activeSource })
  },
  setSearch: (search) => set({ search }),
  setCategory: (activeCategory) => set({ activeCategory }),
  setActiveSource: (activeSource) => {
    if (activeSource) {
      localStorage.setItem('sg_v2_last_source', activeSource)
    } else {
      localStorage.removeItem('sg_v2_last_source')
    }
    set({ activeSource })
  },
  toggleSilent: () => set((s) => ({ silentMode: !s.silentMode })),
  toggleCompact: () => set((s) => ({ compactMode: !s.compactMode })),
  toggleCollapse: (cat) => set((s) => {
    const next = new Set(s.collapsedCategories)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    return { collapsedCategories: next }
  }),
  collapseAll: () => {
    const { styles, activeSource } = get()
    const src = activeSource
      ? styles.filter(s => s.source_file === activeSource)
      : styles
    const cats = [...new Set(src.map(s => s.category).filter(Boolean))]
    set({ collapsedCategories: new Set(cats) })
  },
  expandAll: () => set({ collapsedCategories: new Set() }),
  selectAllInCategory: (cat) => {
    const { styles, activeSource, selectedStyles, silentMode } = get()
    const src = activeSource
      ? styles.filter(s => s.source_file === activeSource)
      : styles
    const catStyles = src.filter(s => s.category === cat)
    const allSelected = catStyles.every(s =>
      selectedStyles.some(sel => sel.name === s.name)
    )

    if (allSelected) {
      const removeNames = new Set(catStyles.map(s => s.name))
      set({
        selectedStyles: selectedStyles.filter(s => !removeNames.has(s.name)),
      })
      catStyles.forEach((style) => {
        sendToHost({ type: 'SG_UNAPPLY', styleId: style.name })
      })
      return
    }

    const selectedNames = new Set(selectedStyles.map(s => s.name))
    const toAdd = catStyles.filter(s => !selectedNames.has(s.name))
    if (toAdd.length === 0) return

    set({ selectedStyles: [...selectedStyles, ...toAdd] })
    toAdd.forEach((style) => {
      get().addToRecent(style.name)
      sendToHost({
        type: 'SG_APPLY',
        styleId: style.name,
        prompt: style.prompt,
        neg: style.negative_prompt,
        silent: silentMode,
      })
    })
  },
  toggleFavorite: (name) => {
    const favs = new Set(get().favorites)
    if (favs.has(name)) favs.delete(name)
    else favs.add(name)
    localStorage.setItem('sg_v2_favorites', JSON.stringify([...favs]))
    set({ favorites: favs })
  },
  isFavorite: (name) => get().favorites.has(name),
  addToRecent: (name) => {
    const recent = [name, ...get().recentNames.filter(n => n !== name)]
      .slice(0, 10)
    localStorage.setItem('sg_v2_recent', JSON.stringify(recent))
    set({ recentNames: recent })
  },

  toggleStyle: (style) => {
    const { selectedStyles } = get()
    const isSelected = selectedStyles.some(s => s.name === style.name)
    
    if (isSelected) {
      set({ selectedStyles: selectedStyles.filter(s => s.name !== style.name) })
      sendToHost({ type: 'SG_UNAPPLY', styleId: style.name })
      get().detectConflicts()
    } else {
      set({ selectedStyles: [...selectedStyles, style] })
      get().addToRecent(style.name)
      get().incrementUsage(style.name)
      sendToHost({ 
        type: 'SG_APPLY', 
        styleId: style.name,
        prompt: style.prompt,
        neg: style.negative_prompt,
        silent: get().silentMode,
      })
      get().detectConflicts()
    }
  },
  setSelectedStyles: (styles: Style[]) => set({ selectedStyles: styles }),
  clearAll: () => {
    const { selectedStyles } = get()
    selectedStyles.forEach(s =>
      sendToHost({ type: 'SG_UNAPPLY', styleId: s.name })
    )
    set({ selectedStyles: [] })
  },
  showToast: (message, variant = 'info') => {
    const id = Date.now()
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }))
    setTimeout(() => set((s) => ({
      toasts: s.toasts.filter(t => t.id !== id)
    })), 3000)
  },
  detectConflicts: () => {
    const { selectedStyles } = get()
    const conflicts: Conflict[] = []

    for (let i = 0; i < selectedStyles.length; i++) {
      for (let j = i + 1; j < selectedStyles.length; j++) {
        const a = selectedStyles[i]
        const b = selectedStyles[j]

        // Check if style A's negative prompt contains tags from B's prompt
        const aTags = a.prompt.toLowerCase().split(',').map(t => t.trim())
        const bTags = b.prompt.toLowerCase().split(',').map(t => t.trim())
        const aNeg = (a.negative_prompt || '').toLowerCase().split(',').map(t => t.trim())
        const bNeg = (b.negative_prompt || '').toLowerCase().split(',').map(t => t.trim())

        const aKillsB = bTags.some(tag => tag && aNeg.some(n => n && n.includes(tag)))
        const bKillsA = aTags.some(tag => tag && bNeg.some(n => n && n.includes(tag)))

        if (aKillsB) conflicts.push({
          styleA: a.name, styleB: b.name,
          reason: `${a.name} negates tags from ${b.name}`
        })
        if (bKillsA) conflicts.push({
          styleA: b.name, styleB: a.name,
          reason: `${b.name} negates tags from ${a.name}`
        })
      }
    }
    set({ conflicts })
  },
  loadUsage: async () => {
    try {
      const r = await fetch('/style_grid/usage')
      const data = await r.json()
      set({ usageCounts: data || {} })
    } catch {
      // ignore usage load errors
    }
  },
  incrementUsage: (name: string) => {
    const counts = { ...get().usageCounts }
    counts[name] = (counts[name] || 0) + 1
    set({ usageCounts: counts })
    // Persist to backend
    fetch('/style_grid/usage/increment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    }).catch(() => {})
  },
  setCategoryOrder: (order: string[]) => {
    localStorage.setItem('sg_v2_category_order', JSON.stringify(order))
    localStorage.setItem('sg_v2_category_order_source', 'all')
    set({ categoryOrder: order })
    // Sync to backend same as old panel
    fetch('/style_grid/category_order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order })
    }).catch(() => {})
  },

  categories: () => {
    const { styles, activeSource, categoryOrder } = get()
    const filtered = activeSource
      ? styles.filter(s => s.source_file === activeSource)
      : styles
    const all = [...new Set(
      filtered.map(s => s.category).filter(Boolean)
    )]

    // When specific source selected — always alphabetical
    // Saved category order only applies to All Sources view
    if (activeSource) {
      return all.sort()
    }

    // Only use saved order if it was saved for All Sources context
    // (contains most of the current categories)
    const allSorted = all.sort()
    if (categoryOrder.length === 0) return allSorted

    const savedForSource = localStorage.getItem('sg_v2_category_order_source')
    if (savedForSource !== 'all' && !activeSource) {
      return allSorted
    }

    const relevantOrder = categoryOrder.filter(c => all.includes(c))
    const coverage = relevantOrder.length / all.length

    // If saved order covers less than 80% of current categories — ignore it
    if (coverage < 0.8) return allSorted

    const rest = all.filter(c => !relevantOrder.includes(c)).sort()
    return [...relevantOrder, ...rest]
  },

  filteredStyles: () => {
    const { styles, search, activeCategory, activeSource } = get()

    if (activeCategory === '★ Favorites') {
      const favs = get().favorites
      return styles.filter(s => favs.has(s.name))
    }

    if (activeCategory === '🕑 Recent') {
      const recent = get().recentNames
      return recent
        .map(name => styles.find(s => s.name === name))
        .filter(Boolean) as Style[]
    }

    let filtered = styles.filter(s => {
      const matchSource = !activeSource || s.source_file === activeSource
      const matchCat = !activeCategory || s.category === activeCategory
      const matchSearch = !search || 
        s.name.toLowerCase().includes(search.toLowerCase())
      return matchSource && matchCat && matchSearch
    })

    // All Sources: keep one card per style name.
    if (!activeSource) {
      const seen = new Set<string>()
      filtered = filtered.filter(s => {
        if (seen.has(s.name)) return false
        seen.add(s.name)
        return true
      })
    }

    return filtered
  }
}))
