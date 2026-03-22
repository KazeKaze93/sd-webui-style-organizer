import { create } from 'zustand'
import { sendToHost, type Style, type Tab } from '../bridge'

interface StylesStore {
  // Data
  styles: Style[]
  tab: Tab
  
  // Filters
  search: string
  activeCategory: string | null
  
  // Selection
  selectedStyles: Style[]
  silentMode: boolean
  
  // Actions
  setStyles: (styles: Style[], tab: Tab) => void
  setSearch: (q: string) => void
  setCategory: (cat: string | null) => void
  toggleSilent: () => void
  toggleStyle: (style: Style) => void
  
  // Derived
  categories: () => string[]
  filteredStyles: () => Style[]
}

export const useStylesStore = create<StylesStore>((set, get) => ({
  styles: [],
  tab: 'txt2img',
  search: '',
  activeCategory: null,
  selectedStyles: [],
  silentMode: false,

  setStyles: (styles, tab) => set({ styles, tab }),
  setSearch: (search) => set({ search }),
  setCategory: (activeCategory) => set({ activeCategory }),
  toggleSilent: () => set((s) => ({ silentMode: !s.silentMode })),

  toggleStyle: (style) => {
    const { selectedStyles, silentMode } = get()
    const isSelected = selectedStyles.some(s => s.name === style.name)
    
    if (isSelected) {
      set({ selectedStyles: selectedStyles.filter(s => s.name !== style.name) })
      sendToHost({ type: 'SG_UNAPPLY', styleId: style.name })
    } else {
      set({ selectedStyles: [...selectedStyles, style] })
      sendToHost({ 
        type: 'SG_APPLY', 
        styleId: style.name,
        prompt: style.prompt,
        neg: style.negative_prompt,
        silent: silentMode,
      })
    }
  },

  categories: () => {
    const { styles } = get()
    return [...new Set(styles.map(s => s.category).filter(Boolean))].sort()
  },

  filteredStyles: () => {
    const { styles, search, activeCategory } = get()
    return styles.filter(s => {
      const matchCat = !activeCategory || s.category === activeCategory
      const matchSearch = !search || 
        s.name.toLowerCase().includes(search.toLowerCase())
      return matchCat && matchSearch
    })
  }
}))
