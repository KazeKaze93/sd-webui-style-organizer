import { useEffect } from 'react'
import { onHostMessage, sendToHost } from './bridge'
import { useStylesStore } from './store/stylesStore'
import { SearchBar } from './components/SearchBar'
import { Sidebar } from './components/Sidebar'
import { StyleGrid } from './components/StyleGrid'
import { SelectedBar } from './components/SelectedBar'

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
    <div className="flex flex-col h-screen bg-sg-bg text-sg-text overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 
                      border-b border-sg-border shrink-0">
        <span className="text-sg-accent font-semibold">🎨 Style Grid</span>
        <div className="flex-1">
          <SearchBar />
        </div>
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
        <span className="text-xs text-sg-muted">
          {selectedStyles.length > 0 && `${selectedStyles.length} selected`}
        </span>
        <button
          onClick={() => sendToHost({ type: 'SG_CLOSE_REQUEST' })}
          className="text-sg-muted hover:text-sg-text transition-colors text-lg"
        >✕</button>
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
    </div>
  )
}
