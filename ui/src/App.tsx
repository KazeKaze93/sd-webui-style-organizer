import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Import, History, MoreHorizontal, Plus, Globe,
  Palette, Maximize2, Minimize2, X, Eraser,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { onHostMessage, sendToHost } from './bridge'
import { LORA_VIEW, styleRowKey, useStylesStore } from './store/stylesStore'
import { SearchBar } from './components/SearchBar'
import { SourceFilter } from './components/SourceFilter'
import { Sidebar } from './components/Sidebar'
import { StyleGrid } from './components/StyleGrid'
import { GridScroller } from './components/grid/GridScroller'
import { StyleEditorDialog } from './components/StyleEditorDialog'
import { ImportExportDialog } from './components/ImportExportDialog'
import { ViewModeToggle } from './components/ViewModeToggle'
import { BackupRestoreDialog } from './components/BackupRestoreDialog'
import { gridMinVisibleHeightPx } from './components/grid/constants'
import { BottomPanel } from './components/BottomPanel'
import { BatchAnnouncer } from './components/BatchAnnouncer'
import { Toast } from './components/Toast'
import { MenuItem, ViewportFixedMenu } from './components/ViewportFixedMenu'
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
import { installFocusSourceTracking } from './lib/focusSource'
import { useGatedTooltip } from './lib/useGatedTooltip'
import { AppActionsContext, type AppActions } from './lib/appActions'

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

/**
 * Legacy key: the iframe used to save the windowed size here before it wrote
 * fullscreen styles into the host wrapper. The host owns geometry now
 * (sg_panel_geometry_v1); a stale value is deleted on startup.
 */
const LEGACY_WINDOWED_SIZE_KEY = 'sg_windowed_size'

/** Search is the primary tool: it grows (flex-1) but never collapses below this. */
const SEARCH_MIN_WIDTH_PX = 110

/**
 * Header breakpoint (iframe width == panel width: the iframe fills the host
 * panel). At or below it the "Style Grid" text becomes sr-only and the tab
 * badge is hidden (and the gap before Close shrinks), so the header stays one
 * row down to the host's PANEL_MIN_WIDTH (600px). Raised from 719 (Grid /
 * Gallery toggle) and from 759 (header Clear): the widest case (LoRA view +
 * globe + a 24ch source label) no longer fits in wide mode below 800px.
 * Tailwind only emits literal utilities, so the classes spell it out as
 * `max-[799px]:`; keep them in step with this value.
 */
export const HEADER_NARROW_MAX_PX = 799

/** Gap between the More button and the top of its menu. */
const MORE_MENU_OFFSET_PX = 4

/** Top padding of the grid scroller content (the `pt-3` wrapper around the grid). */
const GRID_PAD_TOP_PX = 12

const ToolBtn = ({
  icon: Icon,
  label,
  title,
  onClick,
  disabled,
  colorClassName,
  active,
  ariaHasPopup,
  expanded,
}: {
  icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
  label: string
  title?: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  colorClassName?: string
  active?: boolean
  /** Opens a popup menu: sets aria-haspopup. */
  ariaHasPopup?: 'menu'
  /** Whether that popup is open: sets aria-expanded. */
  expanded?: boolean
}) => {
  // Hover / Tab-focus only; closed while the button's own menu is open.
  const tip = useGatedTooltip(expanded === true)

  const button = (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={active !== undefined ? active : undefined}
      aria-haspopup={ariaHasPopup}
      aria-expanded={expanded}
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
    // While the button's own menu is open the tooltip stays closed.
    <Tooltip open={tip.open} onOpenChange={tip.onOpenChange}>
      <TooltipTrigger asChild {...tip.triggerProps}>
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
  const [newStyleOpen, setNewStyleOpen] = useState(false)
  const [importExportOpen, setImportExportOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [moreMenu, setMoreMenu] = useState<{
    x: number
    y: number
    restoreFocusTo: HTMLElement
  } | null>(null)
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
      activeCategory: s.activeCategory,
      showToast: s.showToast,
      presetsCorrupt: s.presetsCorrupt,
      setThemeMode: s.setThemeMode,
    })),
  )

  const headerTitle = `Style Grid — ${tab}`

  const activeSourceIsReadOnly = !!activeSource &&
    styles.some(s => s.source_file === activeSource && s.read_only)
  /** Openers for the grid's empty states; canCreateStyle is the header + button's rule. */
  const appActions = useMemo<AppActions>(() => ({
    openImportExport: () => setImportExportOpen(true),
    openNewStyle: () => setNewStyleOpen(true),
    canCreateStyle: !!activeSource && !activeSourceIsReadOnly,
  }), [activeSource, activeSourceIsReadOnly])

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

  // Toolbar tooltips need to know whether focus came from Tab (see ToolBtn).
  useEffect(() => installFocusSourceTracking(), [])

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_WINDOWED_SIZE_KEY)
    } catch (err) {
      // Storage can be blocked; nothing else is expected to fail here.
      if (!(err instanceof DOMException)) throw err
    }
  }, [])

  useEffect(() => {
    void useStylesStore.getState().hydrateFavorites()
    const unsub = onHostMessage((msg) => {
      if (msg.type === 'SG_THEME') {
        applyThemeMode(msg.mode)
        setThemeMode(msg.mode)
      }
      if (msg.type === 'SG_FULLSCREEN_STATE') {
        setIsFullscreen(msg.fullscreen)
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
        // Every catalog push (init, refresh after a save / import / restore /
        // rename, a CSV change on disk) also reloads which styles have thumbnails.
        void useStylesStore.getState().fetchThumbKeys()
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
        const { selectedStyles, detectConflicts } = useStylesStore.getState()
        const exists = selectedStyles.some(s => styleRowKey(s) === styleRowKey(msg.style))
        if (!exists) {
          useStylesStore.getState().setSelectedStyles([...selectedStyles, msg.style])
          detectConflicts()
        }
      }
      if (msg.type === 'SG_WILDCARDS_ACTIVE') {
        useStylesStore.getState().setActiveWildcards(msg.categories)
      }
      if (msg.type === 'SG_THUMB_PROGRESS') {
        const jobKey = styleRowKey({ name: msg.styleId, source_file: msg.source_file })
        useStylesStore.getState().applyPreviewProgress(jobKey, msg.status)
      }
      if (msg.type === 'SG_BATCH_PROGRESS') {
        useStylesStore.getState().applyBatchProgress({
          category: msg.category,
          source: msg.source,
          status: msg.status,
          total: msg.total,
          processed: msg.processed,
          newCount: msg.newCount,
          alreadyHad: msg.alreadyHad,
          skipped: msg.skipped,
          failed: msg.failed,
        })
      }
      if (msg.type === 'SG_THUMB_DONE') {
        // A generated or uploaded preview for this style now exists.
        const thumbKey = styleRowKey({ name: msg.styleId, source_file: msg.source_file })
        useStylesStore.getState().bumpThumbVersion(thumbKey, String(msg.version))
        useStylesStore.getState().markThumb(thumbKey, true)
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

  // The host owns the panel frame. Ask; isFullscreen changes only when the
  // host answers with SG_FULLSCREEN_STATE (see the host message effect).
  const toggleFullscreen = () => {
    sendToHost({ type: 'SG_SET_FULLSCREEN', fullscreen: !isFullscreen })
  }

  return (
    <AppActionsContext.Provider value={appActions}>
    <div className="flex flex-col bg-sg-bg text-sg-text"
      style={{ height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      {/* One row, never wraps: at or below HEADER_NARROW_MAX_PX the title text and the tab badge give way. */}
      <div
        className="shrink-0 flex flex-nowrap items-center gap-3 px-4 py-2.5 min-w-0
                   border-b border-sg-border"
        data-sg-header="true"
      >
        <div
          role="group"
          aria-label={headerTitle}
          title={headerTitle}
          className="shrink-0 text-sg-accent font-semibold inline-flex items-center gap-1.5"
          data-sg-header-title="true"
        >
          <Palette size={16} aria-hidden />
          <span className="max-[799px]:sr-only">Style Grid</span>
        </div>
        <span
          className="shrink-0 text-xs text-sg-muted border border-sg-border/50
                     px-1.5 py-0.5 rounded font-mono max-[799px]:hidden"
          data-sg-tab-badge="true"
        >
          {tab}
        </span>
        <SourceFilter />
        <div
          className="flex-1 min-w-0"
          style={{ minWidth: SEARCH_MIN_WIDTH_PX }}
          ref={searchRootRef}
        >
          <SearchBar />
        </div>
        <TooltipProvider>
          <ViewModeToggle />
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {/* Host clearAll(): empties the positive and negative prompt fields and
                the selection. Always enabled: the prompts can hold text with
                nothing selected here. */}
            <ToolBtn
              icon={Eraser}
              label="Clear prompts and selection"
              colorClassName="text-sg-danger-text"
              onClick={() => sendToHost({ type: 'SG_CLEAR_ALL' })}
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
              onClick={() => setNewStyleOpen(true)}
            />
            <ToolBtn
              icon={MoreHorizontal}
              label="More"
              ariaHasPopup="menu"
              expanded={moreMenu !== null}
              onClick={(e) => {
                const opener = e.currentTarget
                const rect = opener.getBoundingClientRect()
                setMoreMenu({
                  x: rect.left,
                  y: rect.bottom + MORE_MENU_OFFSET_PX,
                  restoreFocusTo: opener,
                })
              }}
            />
            <ToolBtn
              icon={isFullscreen ? Minimize2 : Maximize2}
              label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={toggleFullscreen}
            />
            <span className="ml-3 max-[799px]:ml-2 inline-flex" data-sg-close-wrap="true">
              <ToolBtn
                icon={X}
                label="Close Style Grid"
                onClick={() => sendToHost({ type: 'SG_CLOSE_REQUEST' })}
              />
            </span>
          </div>
        </TooltipProvider>
        {moreMenu && (
          <ViewportFixedMenu
            x={moreMenu.x}
            y={moreMenu.y}
            onClose={() => setMoreMenu(null)}
            restoreFocusTo={moreMenu.restoreFocusTo}
          >
            <MenuItem
              className="flex items-center gap-2"
              onSelect={() => {
                setMoreMenu(null)
                setImportExportOpen(true)
              }}
            >
              <Import className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Import / Export…
            </MenuItem>
            <MenuItem
              className="flex items-center gap-2"
              onSelect={() => {
                setMoreMenu(null)
                setBackupOpen(true)
              }}
            >
              <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Backup &amp; restore…
            </MenuItem>
          </ViewportFixedMenu>
        )}
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
      {/* minHeight: the grid keeps a header and two card rows; the tray shrinks first. */}
      <div
        className="relative flex"
        data-sg-body="true"
        style={{
          flex: '1 1 0',
          overflow: 'hidden',
          minHeight: GRID_PAD_TOP_PX + gridMinVisibleHeightPx(!isFullscreen),
        }}
      >
        {/* Sidebar */}
        {/* The sidebar scrolls its own list and keeps a footer line under it. */}
        <div className="shrink-0 border-r border-sg-border min-h-0 flex flex-col"
          style={{ width: '210px' }}>
          <Sidebar />
        </div>

        {/* Grid — GridScroller is the scroll element the virtualized grid measures. */}
        <GridScroller className="px-3 pb-3 min-h-0"
          style={{ flex: '1 1 0', overflowY: 'auto', overflowX: 'auto', minWidth: 0 }}>
          {/* Flex column at least as tall as the visible scroller, so an empty
              state (flex-1) centers in view; the grid itself keeps its own height. */}
          <div className="pt-3 min-h-full flex flex-col" data-sg-grid-host="true">
            <StyleGrid windowed={!isFullscreen} />
          </div>
        </GridScroller>

        {/* Bottom-center of the body: clipped to it, so never over the header toolbar or the tray. */}
        <Toast />
      </div>

      {/* Bottom panels — capped in BottomPanel; may shrink so the grid keeps its minimum. */}
      <div className="min-h-0 flex flex-col" style={{ flex: '0 1 auto' }}>
        <BottomPanel />
      </div>
      <BatchAnnouncer />
      {newStyleOpen && (
        <StyleEditorDialog
          mode="create"
          open
          defaultSource={activeSource}
          onClose={() => setNewStyleOpen(false)}
        />
      )}
      {importExportOpen && (
        <ImportExportDialog open onClose={() => setImportExportOpen(false)} />
      )}
      {backupOpen && <BackupRestoreDialog open onClose={() => setBackupOpen(false)} />}
    </div>
    </AppActionsContext.Provider>
  )
}
