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
import { cn } from './lib/utils'

const ToolBtn = ({
  icon,
  label,
  title,
  onClick,
  disabled,
}: {
  icon: string
  label: string
  title?: string
  onClick?: () => void
  disabled?: boolean
}) => {
  const button = (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'w-8 h-8 flex items-center justify-center rounded transition-colors text-sm border',
        disabled
          ? 'opacity-45 cursor-not-allowed text-sg-muted border-transparent [filter:grayscale(0.35)]'
          : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface border-transparent hover:border-sg-border',
      )}
    >
      {icon}
    </button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span className="inline-flex rounded">{button}</span>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs max-w-[240px] whitespace-pre-line">{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

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
        setStyles(
          arr,
          msg.type === 'SG_INIT'
            ? msg.tab
            : useStylesStore.getState().tab,
        )
      }
      if (msg.type === 'SG_HOST_TAB') {
        useStylesStore.setState({ tab: msg.tab })
      }
      if (msg.type === 'SG_CLOSE') {
        sendToHost({ type: 'SG_CLOSE_REQUEST' })
      }
      if (msg.type === 'SG_CLEAR_SELECTION') {
        useStylesStore.setState({ selectedStyles: [], conflicts: [] })
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
    const iframe = window.frameElement as HTMLElement
    if (!iframe) return
    const wrapper = iframe.parentElement as HTMLElement
    if (!wrapper) return

    if (isFullscreen) {
      // Windowed mode (master-like): centered and readable
      wrapper.style.top = '80px'
      wrapper.style.right = '16px'
      wrapper.style.left = 'auto'
      wrapper.style.transform = 'none'
      wrapper.style.width = '1000px'
      wrapper.style.height = '650px'
      wrapper.style.minWidth = '600px'
      wrapper.style.minHeight = '400px'
      wrapper.style.maxWidth = '95vw'
      wrapper.style.maxHeight = '90vh'
      wrapper.style.borderRadius = '12px'
      wrapper.style.boxShadow = '0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)'
      wrapper.style.resize = 'both'
      setIsFullscreen(false)
      return
    }

    // Fullscreen mode
    wrapper.style.top = '0'
    wrapper.style.right = 'auto'
    wrapper.style.left = '0'
    wrapper.style.transform = 'none'
    wrapper.style.width = '100vw'
    wrapper.style.height = '100vh'
    wrapper.style.minWidth = ''
    wrapper.style.minHeight = ''
    wrapper.style.maxWidth = ''
    wrapper.style.maxHeight = ''
    wrapper.style.borderRadius = '0'
    wrapper.style.boxShadow = 'none'
    wrapper.style.resize = 'none'
    setIsFullscreen(true)
  }

  return (
    <div className="flex flex-col bg-sg-bg text-sg-text"
      style={{ height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5
                    border-b border-sg-border">
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
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => toggleSilent()}
              title={silentMode ? 'Silent mode ON' : 'Silent mode OFF'}
              className={`w-8 h-8 flex items-center justify-center rounded
              transition-colors text-sm border border-transparent shrink-0
            ${silentMode 
              ? 'bg-sg-accent/20 text-sg-accent' 
              : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface hover:border-sg-border'}`}
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
              label={'CSV table editor is temporarily unavailable.\nРедактор таблицы CSV временно недоступен.'}
              disabled
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
              onClick={toggleFullscreen}
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
              className="ml-3 text-sg-muted hover:text-sg-text transition-colors text-lg"
            >
              ✕
            </button>
          </div>
        </TooltipProvider>
      </div>

      {/* Body */}
      <div className="flex min-h-0" style={{ flex: '1 1 0', overflow: 'hidden' }}>
        {/* Sidebar */}
        <div className="shrink-0 border-r border-sg-border p-2 min-h-0"
          style={{ width: isFullscreen ? '210px' : '210px', overflowY: 'auto', overflowX: 'auto' }}>
          <Sidebar />
        </div>

        {/* Grid */}
        <div className="p-3 min-h-0"
          style={{ flex: '1 1 0', overflowY: 'auto', overflowX: 'auto', minWidth: 0 }}>
          <StyleGrid windowed={!isFullscreen} />
        </div>
      </div>

      {/* Bottom panels — fixed height */}
      <div className="shrink-0">
        <StyleInfoPanel />
        <SelectedBar />
      </div>
      <ThumbProgressModal />
      <Toast />
    </div>
  )
}
