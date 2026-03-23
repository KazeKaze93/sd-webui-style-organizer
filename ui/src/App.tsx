import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { onHostMessage, sendToHost } from './bridge'
import { useStylesStore } from './store/stylesStore'
import { SearchBar } from './components/SearchBar'
import { SourceFilter } from './components/SourceFilter'
import { Sidebar } from './components/Sidebar'
import { StyleGrid } from './components/StyleGrid'
import { StyleInfoPanel } from './components/StyleInfoPanel'
import { SelectedBar } from './components/SelectedBar'
import { ThumbProgressModal } from './components/ThumbProgressModal'
import { Toast } from './components/Toast'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './components/ui/tooltip'

const ToolBtn = ({
  icon,
  label,
  title,
  onClick,
}: {
  icon: string
  label: string
  title?: string
  onClick?: () => void
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="w-8 h-8 flex items-center justify-center rounded
                   text-sg-muted hover:text-sg-text hover:bg-sg-surface
                   transition-colors text-sm border border-transparent
                   hover:border-sg-border"
      >
        {icon}
      </button>
    </TooltipTrigger>
    <TooltipContent side="bottom">
      <p className="text-xs">{label}</p>
    </TooltipContent>
  </Tooltip>
)

export default function App() {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const {
    setStyles,
    tab,
    selectedStyles,
    conflicts,
    silentMode,
    toggleSilent,
    toggleCompact,
    collapsedCategories,
    collapseAll,
    expandAll,
  } = useStylesStore()

  useEffect(() => {
    useStylesStore.getState().loadUsage()
    const unsub = onHostMessage((msg) => {
      if (msg.type === 'SG_INIT' || msg.type === 'SG_STYLES_UPDATE') {
        const raw: unknown = (msg as { styles?: unknown }).styles
        const arr = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { styles?: unknown[] } | null)?.styles)
            ? (raw as { styles: unknown[] }).styles
            : (raw as { categories?: Record<string, unknown[]> } | null)?.categories
              ? Object.values((raw as { categories: Record<string, unknown[]> }).categories).flat()
              : []
        setStyles(arr, msg.type === 'SG_INIT' ? msg.tab : 'txt2img')
      }
      if (msg.type === 'SG_CLOSE') {
        sendToHost({ type: 'SG_CLOSE_REQUEST' })
      }
      if (msg.type === 'SG_STYLE_APPLIED') {
        const { selectedStyles, addToRecent } = useStylesStore.getState()
        const exists = selectedStyles.some(s => s.name === msg.style.name)
        if (!exists) {
          useStylesStore.getState().setSelectedStyles([...selectedStyles, msg.style])
          addToRecent(msg.style.name)
        }
      }
    })
    sendToHost({ type: 'SG_READY' })
    return unsub
  }, [setStyles])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        sendToHost({ type: 'SG_CLOSE_REQUEST' })
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const toggleFullscreen = () => {
    // window.frameElement = the <iframe> tag
    // wrapper = window.frameElement.parentElement (the resizable div)
    const iframe = window.frameElement as HTMLElement
    if (!iframe) return
    const wrapper = iframe.parentElement as HTMLElement
    if (!wrapper) return

    if (!isFullscreen) {
      // Save current size
      wrapper.dataset.prevWidth = wrapper.style.width
      wrapper.dataset.prevHeight = wrapper.style.height
      wrapper.dataset.prevTop = wrapper.style.top
      wrapper.dataset.prevLeft = wrapper.style.left
      wrapper.dataset.prevMaxH = wrapper.style.maxHeight
      wrapper.dataset.prevMaxW = wrapper.style.maxWidth
      // Go fullscreen
      wrapper.style.width = 'calc(100vw - 16px)'
      wrapper.style.height = 'calc(100vh - 100px)'
      wrapper.style.top = '90px'
      wrapper.style.left = '8px'
      wrapper.style.maxWidth = 'calc(100vw - 16px)'
      wrapper.style.maxHeight = 'calc(100vh - 100px)'
      wrapper.style.resize = 'none'
      setIsFullscreen(true)
    } else {
      // Restore
      wrapper.style.width = wrapper.dataset.prevWidth || '960px'
      wrapper.style.height = wrapper.dataset.prevHeight || '600px'
      wrapper.style.top = wrapper.dataset.prevTop || '130px'
      wrapper.style.left = wrapper.dataset.prevLeft || '0px'
      wrapper.style.maxHeight = wrapper.dataset.prevMaxH || 'calc(100vh - 140px)'
      wrapper.style.maxWidth = wrapper.dataset.prevMaxW || 'calc(100vw - 16px)'
      wrapper.style.resize = 'both'
      setIsFullscreen(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="flex flex-col h-screen bg-sg-bg text-sg-text overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 
                      border-b border-sg-border shrink-0">
        <span className="text-sg-accent font-semibold">🎨 Style Grid</span>
        <span className="text-xs text-sg-muted/60 border border-sg-border/50 
                   px-1.5 py-0.5 rounded font-mono">
          {tab}
        </span>
        <SourceFilter />
        <div className="flex-1">
          <SearchBar />
        </div>
        <TooltipProvider>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => toggleSilent()}
              title={silentMode ? 'Silent mode ON' : 'Silent mode OFF'}
              className={`px-3 py-1.5 rounded text-xs border transition-colors shrink-0
            ${silentMode 
              ? 'bg-sg-accent/20 border-sg-accent text-sg-accent' 
              : 'border-sg-border text-sg-muted hover:text-sg-text'}`}
            >
              👁
            </button>
            <ToolBtn
              icon="🎲"
              label="Random style"
              onClick={() => sendToHost({ type: 'SG_RANDOM' })}
            />
            <ToolBtn
              icon="📦"
              label="Presets"
              onClick={() => sendToHost({ type: 'SG_PRESETS' })}
            />
            <ToolBtn
              icon="💾"
              label="Backup CSV"
              onClick={() => sendToHost({ type: 'SG_BACKUP' })}
            />
            <ToolBtn
              icon="📥"
              label="Import/Export"
              onClick={() => sendToHost({ type: 'SG_IMPORT_EXPORT' })}
            />
            <ToolBtn
              icon="📋"
              label="CSV Table Editor"
              onClick={() => sendToHost({ type: 'SG_CSV_EDITOR' })}
            />
            <ToolBtn
              icon="🧹"
              label="Clear all selected styles"
              title="Clear all selected styles"
              onClick={() => {
                useStylesStore.getState().clearAll()
                sendToHost({ type: 'SG_CLEAR_ALL' })
              }}
            />
            <ToolBtn
              icon="▪"
              label="Compact mode"
              onClick={() => toggleCompact()}
            />
            <ToolBtn
              icon="↕"
              label="Collapse all"
              onClick={() =>
                collapsedCategories.size > 0 ? expandAll() : collapseAll()
              }
            />
            <ToolBtn
              icon="➕"
              label="New style"
              onClick={() => {
                const { activeSource, showToast } = useStylesStore.getState()
                if (!activeSource) {
                  showToast('⚠️ Select a specific CSV source before creating a style', 'info')
                } else {
                  sendToHost({ type: 'SG_NEW_STYLE', sourceFile: activeSource })
                }
              }}
            />
            <span className="text-xs text-sg-muted">
              {selectedStyles.length > 0 && `${selectedStyles.length} selected`}
            </span>
            {conflicts.length > 0 && (
              <div className="relative group">
                <span className="flex items-center gap-1 px-2 py-1 rounded 
                       bg-red-500/20 border border-red-500/40 
                       text-red-400 text-xs cursor-help
                       animate-pulse">
                  ⚠️ {conflicts.length}
                </span>
                <div className="absolute top-full right-0 mt-1 z-50
                      bg-[#0f172a] border border-sg-border rounded-lg
                      shadow-xl p-3 min-w-64 hidden group-hover:block">
                  <div className="text-xs font-semibold text-white mb-2">
                    Style Conflicts
                  </div>
                  {conflicts.map((c, i) => (
                    <div key={i} className="text-xs text-red-400 py-0.5">
                      {c.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={() => { /* TODO: windowed mode */ }}
              className="text-sg-muted hover:text-sg-text transition-colors text-sm w-6 h-6
               flex items-center justify-center"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                  xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="1" width="12" height="12" rx="1"
                    stroke="currentColor" strokeWidth="1.2" fill="none" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                  xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="3" width="9" height="9" rx="1"
                    stroke="currentColor" strokeWidth="1.2" fill="none" />
                  <path d="M4 3V2a1 1 0 011-1h7a1 1 0 011 1v7a1 1 0 01-1 1h-1"
                    stroke="currentColor" strokeWidth="1.2" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => sendToHost({ type: 'SG_CLOSE_REQUEST' })}
              className="text-sg-muted hover:text-sg-text transition-colors text-lg"
            >
              ✕
            </button>
          </div>
        </TooltipProvider>
      </div>

      {/* Body */}
      <div className="flex flex-1 gap-0 overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 shrink-0 border-r border-sg-border 
                        overflow-y-auto p-3 sidebar-scroll">
          <Sidebar />
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-3 sidebar-scroll">
          <StyleGrid />
        </div>
      </div>

      <StyleInfoPanel />

      {/* Selected bar */}
      <SelectedBar />
      <ThumbProgressModal />
      <Toast />
    </motion.div>
  )
}
