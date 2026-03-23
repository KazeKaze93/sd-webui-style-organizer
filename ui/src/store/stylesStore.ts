import { create } from 'zustand'
import { sendToHost, type Style, type Tab } from '../bridge'

interface StylesStore {
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
  silentMode: boolean
  favorites: Set<string>
  recentNames: string[]
  
  // Actions
  setStyles: (styles: Style[], tab: Tab) => void
  setSearch: (q: string) => void
  setCategory: (cat: string | null) => void
  setActiveSource: (src: string | null) => void
  toggleSilent: () => void
  toggleStyle: (style: Style) => void
  toggleFavorite: (name: string) => void
  isFavorite: (name: string) => boolean
  addToRecent: (name: string) => void
  
  // Derived
  categories: () => string[]
  filteredStyles: () => Style[]
}

export const useStylesStore = create<StylesStore>((set, get) => ({
  styles: [],
  tab: 'txt2img',
  search: '',
  activeCategory: null,
  activeSource: null,
  sources: [],
  selectedStyles: [],
  silentMode: false,
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
    set({ styles, tab, sources })
  },
  setSearch: (search) => set({ search }),
  setCategory: (activeCategory) => set({ activeCategory }),
  setActiveSource: (activeSource) => set({ activeSource }),
  toggleSilent: () => set((s) => ({ silentMode: !s.silentMode })),
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
    } else {
      set({ selectedStyles: [...selectedStyles, style] })
      get().addToRecent(style.name)
      sendToHost({ 
        type: 'SG_APPLY', 
        styleId: style.name,
        prompt: style.prompt,
        neg: style.negative_prompt,
        silent: get().silentMode,
      })
    }
  },

  categories: () => {
    const { styles } = get()
    return [...new Set(styles.map(s => s.category).filter(Boolean))].sort()
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

    return styles.filter(s => {
      const matchSource = !activeSource || s.source_file === activeSource
      const matchCat = !activeCategory || s.category === activeCategory
      const matchSearch = !search || 
        s.name.toLowerCase().includes(search.toLowerCase())
      return matchSource && matchCat && matchSearch
    })
  }
}))
