import { useEffect, useRef, useState } from 'react'
import {
  Save, Import, Eraser, Rows3, ChevronsUpDown, ChevronsDownUp, Plus, Globe,
  Palette, Maximize2, Minimize2, X,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { onHostMessage, sendToHost } from './bridge'
import { LORA_VIEW, styleRowKey, useStylesStore } from './store/stylesStore'
import { SearchBar } from './components/SearchBar'
import { SourceFilter } from './components/SourceFilter'
import { Sidebar } from './components/Sidebar'
import { StyleGrid } from './components/StyleGrid'
import { BottomPanel } from './components/BottomPanel'
import { ThumbProgressModal } from './components/ThumbProgressModal'
import { Toast } from './components/Toast'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './components/ui/tooltip'
import { closeTopLayer, hasOpenLayer } from './lib/layerStack'
import { cn } from './lib/utils'
import { styleGridPost } from './lib/styleGridFetch'
import { applyThemeMode, appliedThemeMode } from './lib/themeMode'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

function clearSearchField(searchRoot: HTMLElement | null): boolean {
  const { search, setSearch } = useStylesStore.getState()
  const input = searchRoot?.querySelector('input')
  const hasText =
    (typeof search === 'string' && search.length > 0) ||
    (!!input && input.value.length > 0)
  if (!hasText) return false
  setSearch('')
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return true
}

const WINDOWED_SIZE_KEY = 'sg_windowed_size'

/** Search is the primary tool: it grows (flex-1) but never collapses below this. */
const SEARCH_MIN_WIDTH_PX = 200

const ToolBtn = ({
  icon: Icon,
  label,
  title,
  onClick,
  disabled,
  colorClassName,
  active,
}: {
  icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
  label: string
  title?: string
  onClick?: () => void
  disabled?: boolean
  colorClassName?: string
  active?: boolean
}) => {
  const button = (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={active !== undefined ? active : undefined}
      className={cn(
        'w-8 h-8 flex items-center justify-center rounded transition-colors border',
        FOCUS_RING,
        disabled
          ? 'opacity-45 cursor-not-allowed text-sg-muted border-transparent [filter:grayscale(0.35)]'
          : active
            ? 'bg-sg-accent/15 border-sg-accent/40 text-sg-text'
            : cn(
                colorClassName ?? 'text-sg-muted',
                'hover:text-sg-text hover:bg-sg-surface border-transparent hover:border-sg-border',
              ),
      )}
    >
      <Icon size={16} aria-hidden />
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
  const searchRootRef = useRef<HTMLDivElement>(null)
  const [loraFetchStatus, setLoraFetchStatus] = useState<{
    status: string; done: number; total: number; errors: number
  } | null>(null)
  // P: App 17 hits — bare useStylesStore() re-rendered whole tree on toggle.
  const {
    setStyles,
    tab,
    styles,
    activeSource,
    toggleCompact,
    compactMode,
    collapsedCategories,
    collapseAll,
    expandAll,
    activeCategory,
    showToast,
    presetsCorrupt,
    setThemeMode,
  } = useStylesStore(
    useShallow((s) => ({
      setStyles: s.setStyles,
      tab: s.tab,
      styles: s.styles,
      activeSource: s.activeSource,
      toggleCompact: s.toggleCompact,
      compactMode: s.compactMode,
      collapsedCategories: s.collapsedCategories,
      collapseAll: s.collapseAll,
      expandAll: s.expandAll,
      activeCategory: s.activeCategory,
      showToast: s.showToast,
      presetsCorrupt: s.presetsCorrupt,
      setThemeMode: s.setThemeMode,
    })),
  )

  const activeSourceIsReadOnly = !!activeSource &&
    styles.some(s => s.source_file === activeSource && s.read_only)

  const fetchLoraTitles = async () => {
    try {
      const res = await styleGridPost('/style_grid/lora/fetch_titles', {})
      const data = await res.json()
      if (data.error) {
        showToast(`⚠️ ${data.error}`, 'error')
        return
      }
      showToast('🌐 Fetching titles from CivitAI…', 'info')
      setLoraFetchStatus({ status: 'running', done: 0, total: data.total_candidates || 0, errors: 0 })
    } catch {
      showToast('⚠️ Could not start title fetch', 'error')
    }
  }

  useEffect(() => {
    if (loraFetchStatus?.status !== 'running') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/style_grid/lora/fetch_titles/status')
        const data = await res.json()
        setLoraFetchStatus(data)
        if (data.status !== 'running') {
          showToast(
            data.errors > 0
              ? `🌐 Titles: ${data.done - data.errors}/${data.total} ok, ${data.errors} failed. Reopen the panel to see updates.`
              : `🌐 Titles fetched: ${data.done}/${data.total}. Reopen the panel to see updates.`,
            data.errors > 0 ? 'info' : 'success'
          )
        }
      } catch {
        // transient poll failure — next tick will retry
      }
    }, 1500)
    return () => clearInterval(interval)
  }, [loraFetchStatus?.status, showToast])

  useEffect(() => {
    setThemeMode(appliedThemeMode())
  }, [setThemeMode])

  useEffect(() => {
    void useStylesStore.getState().hydrateFavoritesRecent()
    const unsub = onHostMessage((msg) => {
      if (msg.type === 'SG_THEME') {
        applyThemeMode(msg.mode)
        setThemeMode(msg.mode)
      }
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
        void useStylesStore.getState().fetchPresets()
      }
      if (msg.type === 'SG_HOST_TAB') {
        // Intentionally ignored for tab identity: host broadcasts which Forge
        // main tab is visible to BOTH iframes. This iframe's tab is fixed at
        // SG_INIT (txt2img | img2img) and must not be overwritten.
      }
      if (msg.type === 'SG_CLOSE') {
        sendToHost({ type: 'SG_CLOSE_REQUEST' })
      }
      if (msg.type === 'SG_CLEAR_SELECTION') {
        useStylesStore.getState().clearSelectionChrome()
      }
      if (msg.type === 'SG_STYLE_APPLIED') {
        const { selectedStyles, addToRecent, detectConflicts } = useStylesStore.getState()
        const exists = selectedStyles.some(s => styleRowKey(s) === styleRowKey(msg.style))
        if (!exists) {
          useStylesStore.getState().setSelectedStyles([...selectedStyles, msg.style])
          addToRecent(msg.style)
          detectConflicts()
        }
      }
      if (msg.type === 'SG_WILDCARDS_ACTIVE') {
        useStylesStore.getState().setActiveWildcards(msg.categories)
      }
      if (msg.type === 'SG_THUMB_DONE') {
        useStylesStore.getState().bumpThumbVersion(
          styleRowKey({ name: msg.styleId, source_file: msg.source_file }),
          String(msg.version),
        )
      }
    })
    sendToHost({ type: 'SG_READY' })
    return unsub
  }, [setStyles, setThemeMode])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (hasOpenLayer() && closeTopLayer()) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (clearSearchField(searchRootRef.current)) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        sendToHost({ type: 'SG_CLOSE_REQUEST' })
        return
      }

      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        searchRootRef.current?.querySelector('input')?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const focusFirstCell = () => {
      if (cancelled) return
      const cell = document.querySelector<HTMLElement>('[data-sg-card]')
      if (cell) {
        cell.focus()
        return
      }
      attempts += 1
      if (attempts < 30) {
        window.setTimeout(focusFirstCell, 50)
      }
    }
    const raf = requestAnimationFrame(focusFirstCell)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [])

  const toggleFullscreen = () => {
    const iframe = window.frameElement as HTMLElement
    if (!iframe) return
    const wrapper = iframe.parentElement as HTMLElement
    if (!wrapper) return

    if (isFullscreen) {
      let saved: { top?: string; right?: string; width?: string; height?: string } = {}
      try {
        const raw = localStorage.getItem(WINDOWED_SIZE_KEY)
        if (raw) saved = JSON.parse(raw)
      } catch { /* ignore malformed/unavailable storage */ }

      wrapper.style.top = saved.top || '80px'
      wrapper.style.right = saved.right || '16px'
      wrapper.style.left = 'auto'
      wrapper.style.transform = 'none'
      wrapper.style.width = saved.width || '1000px'
      wrapper.style.height = saved.height || '650px'
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

    try {
      localStorage.setItem(WINDOWED_SIZE_KEY, JSON.stringify({
        top: wrapper.style.top,
        right: wrapper.style.right,
        width: wrapper.style.width,
        height: wrapper.style.height,
      }))
    } catch { /* ignore storage unavailable */ }

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
      {/* flex-wrap: below the search minimum the toolbar wraps to a second row instead of clipping. */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5
                    border-b border-sg-border">
        <span className="text-sg-accent font-semibold inline-flex items-center gap-1.5">
          <Palette size={16} aria-hidden />
          Style Grid
        </span>
        <span className="text-xs text-sg-muted border border-sg-border/50 
                   px-1.5 py-0.5 rounded font-mono">
          {tab}
        </span>
        <SourceFilter />
        <div
          className="flex-1"
          style={{ minWidth: SEARCH_MIN_WIDTH_PX }}
          ref={searchRootRef}
        >
          <SearchBar />
        </div>
        <TooltipProvider>
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            <ToolBtn
              icon={Save}
              label="Backup / Restore"
              onClick={() => sendToHost({ type: 'SG_BACKUP' })}
            />
            <ToolBtn
              icon={Import}
              label="Import/Export"
              onClick={() => sendToHost({ type: 'SG_IMPORT_EXPORT' })}
            />
            <div className="w-px h-5 bg-sg-border mx-0.5 self-center" />
            <ToolBtn
              icon={Eraser}
              label="Clear all selected styles"
              colorClassName="text-sg-danger-text"
              onClick={() => {
                sendToHost({ type: 'SG_CLEAR_ALL' })
              }}
            />
            <div className="w-px h-5 bg-sg-border mx-0.5 self-center" />
            <ToolBtn
              icon={Rows3}
              label="Compact mode"
              active={compactMode}
              onClick={() => toggleCompact()}
            />
            <ToolBtn
              icon={collapsedCategories.size > 0 ? ChevronsUpDown : ChevronsDownUp}
              label={collapsedCategories.size > 0 ? 'Expand all' : 'Collapse all'}
              onClick={() =>
                collapsedCategories.size > 0 ? expandAll() : collapseAll()
              }
            />
            <div className="w-px h-5 bg-sg-border mx-0.5 self-center" />
            <ToolBtn
              icon={Plus}
              label={
                !activeSource
                  ? 'Select a specific CSV source before creating a style'
                  : activeSourceIsReadOnly
                    ? 'This source is read-only (bundled samples). Pick or import another CSV to add styles.'
                    : 'New style'
              }
              colorClassName="text-sg-accent-text"
              disabled={!activeSource || activeSourceIsReadOnly}
              onClick={() => {
                sendToHost({ type: 'SG_NEW_STYLE', sourceFile: activeSource! })
              }}
            />
            {activeCategory === LORA_VIEW && (
              <ToolBtn
                icon={Globe}
                label={
                  loraFetchStatus?.status === 'running'
                    ? `Fetching titles from CivitAI… ${loraFetchStatus.done}/${loraFetchStatus.total}`
                    : 'Fetch LoRA titles from CivitAI\n(reads modelId already in each LoRA\'s local .json; nothing sent to CivitAI beyond the request itself)'
                }
                disabled={loraFetchStatus?.status === 'running'}
                onClick={fetchLoraTitles}
              />
            )}
            <ToolBtn
              icon={isFullscreen ? Minimize2 : Maximize2}
              label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={toggleFullscreen}
            />
            <span className="ml-3 inline-flex">
              <ToolBtn
                icon={X}
                label="Close Style Grid"
                onClick={() => sendToHost({ type: 'SG_CLOSE_REQUEST' })}
              />
            </span>
          </div>
        </TooltipProvider>
      </div>

      {presetsCorrupt && (
        <div
          role="alert"
          className="shrink-0 px-4 py-3 border-b border-red-500/50 bg-red-950/90 text-red-100 text-sm"
        >
          <div className="font-semibold">presets.json is corrupt — preset saves are disabled</div>
          <div className="mt-1 font-mono text-xs break-all opacity-90">
            file: {presetsCorrupt.path}
          </div>
          <div className="font-mono text-xs break-all opacity-90">
            backup: {presetsCorrupt.bakPath}
          </div>
          <div className="mt-1 text-xs opacity-80">
            Restore the <code className="font-mono">.bak</code> over{' '}
            <code className="font-mono">presets.json</code>, then reopen Style Grid.
            Do not create new presets until this is fixed — that would overwrite history.
          </div>
        </div>
      )}

      {/* Body */}
      <div className="relative flex min-h-0" style={{ flex: '1 1 0', overflow: 'hidden' }}>
        {/* Sidebar */}
        <div className="shrink-0 border-r border-sg-border p-2 min-h-0"
          style={{ width: isFullscreen ? '210px' : '210px', overflowY: 'auto', overflowX: 'auto' }}>
          <Sidebar />
        </div>

        {/* Grid */}
        <div className="px-3 pb-3 min-h-0"
          style={{ flex: '1 1 0', overflowY: 'auto', overflowX: 'auto', minWidth: 0 }}>
          <div className="pt-3">
            <StyleGrid windowed={!isFullscreen} />
          </div>
        </div>

        {/* Bottom-center of the body: clipped to it, so never over the header toolbar or the tray. */}
        <Toast />
      </div>

      {/* Bottom panels — fixed height */}
      <div className="shrink-0">
        <BottomPanel />
      </div>
      <ThumbProgressModal />
    </div>
  )
}
