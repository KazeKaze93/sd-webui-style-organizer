import { motion } from 'framer-motion'
import { useEffect } from 'react'
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
  const {
    setStyles,
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
        const raw = (msg as any).styles
        const arr = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.styles)
            ? raw.styles
            : raw?.categories
              ? Object.values(raw.categories).flat()
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
  }, [])

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
                        overflow-y-auto p-3">
          <Sidebar />
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-3">
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
