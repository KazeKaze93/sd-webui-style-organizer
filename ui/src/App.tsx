import { motion } from 'framer-motion'
import { useEffect } from 'react'
import { onHostMessage, sendToHost } from './bridge'
import { useStylesStore } from './store/stylesStore'
import { SearchBar } from './components/SearchBar'
import { SourceFilter } from './components/SourceFilter'
import { Sidebar } from './components/Sidebar'
import { StyleGrid } from './components/StyleGrid'
import { SelectedBar } from './components/SelectedBar'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './components/ui/tooltip'

const ToolBtn = ({
  icon,
  label,
  onClick,
}: {
  icon: string
  label: string
  onClick?: () => void
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        onClick={onClick}
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
  const { setStyles, selectedStyles, silentMode, toggleSilent } = useStylesStore()

  useEffect(() => {
    const unsub = onHostMessage((msg) => {
      if (msg.type === 'SG_INIT' || msg.type === 'SG_STYLES_UPDATE') {
        const arr = Array.isArray(msg.styles)
          ? msg.styles
          : (msg.styles as any)?.styles ?? []
        setStyles(arr, msg.type === 'SG_INIT' ? msg.tab : 'txt2img')
      }
      if (msg.type === 'SG_CLOSE') {
        sendToHost({ type: 'SG_CLOSE_REQUEST' })
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
              className={`px-3 py-1.5 rounded text-xs border transition-colors shrink-0
            ${silentMode 
              ? 'bg-sg-accent/20 border-sg-accent text-sg-accent' 
              : 'border-sg-border text-sg-muted hover:text-sg-text'}`}
            >
              👁 Silent
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
              icon="🔄"
              label="Refresh styles"
              onClick={() => sendToHost({ type: 'SG_REFRESH' })}
            />
            <ToolBtn
              icon="➕"
              label="New style"
              onClick={() => sendToHost({ type: 'SG_NEW_STYLE' })}
            />
            <span className="text-xs text-sg-muted">
              {selectedStyles.length > 0 && `${selectedStyles.length} selected`}
            </span>
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

      {/* Selected bar */}
      <SelectedBar />
    </motion.div>
  )
}
