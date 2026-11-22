import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { WILDCARD_KIND_DECK, type WildcardRef } from '../bridge'
import { PRESET_SHUFFLE_SUFFIX } from '../lib/wildcardLabels'
import { wildcardKey } from '../lib/wildcardKey'
import { cn } from '../lib/utils'
import { DeckIcon } from './DeckIcon'
import { ModalShell } from './ModalShell'
import { MenuItem, ViewportFixedMenu } from './ViewportFixedMenu'
import {
  packBasename,
  resolvePresetMembers,
  styleDisplayName,
  styleRowKey,
  useStylesStore,
  type PresetRecord,
  type ResolvedPresetMember,
} from '../store/stylesStore'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

/** Style and wildcard chips shown before "+K more". The missing chip does not count. */
export const PRESET_CHIP_LIMIT = 6

/** Gap between the ⋯ button and the menu under it. */
const MENU_OFFSET_PX = 4

const CHIP_BASE = 'inline-flex items-center gap-1 h-[22px] px-1.5 text-[11px] rounded border max-w-full'
const STYLE_CHIP_CLASS = `${CHIP_BASE} border-sg-border bg-sg-bg/40 text-sg-text`
/** Same tokens as the tray's wildcard chips. */
const WILDCARD_CHIP_CLASS = `${CHIP_BASE} border-sg-wildcard/40 bg-sg-wildcard/20 text-sg-text`
const MISSING_CHIP_CLASS = `${CHIP_BASE} border-dashed border-sg-warning-text/60 text-sg-warning-text`

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

type Props = {
  name: string
  preset: PresetRecord
}

type FoundMember = Extract<ResolvedPresetMember, { status: 'found' }>
type MissingMember = Extract<ResolvedPresetMember, { status: 'missing' }>

type Chip =
  | { kind: 'style'; key: string; member: FoundMember }
  | { kind: 'wildcard'; key: string; wc: WildcardRef }

type MenuState = { x: number; y: number; restoreFocusTo: HTMLElement | null }

export function PresetCard({ name, preset }: Props) {
  const styles = useStylesStore((s) => s.styles)
  const selectedKeySet = useStylesStore((s) => s.selectedKeySet)
  const activeWildcards = useStylesStore((s) => s.activeWildcards)
  const loadPreset = useStylesStore((s) => s.loadPreset)
  const unapplyPreset = useStylesStore((s) => s.unapplyPreset)
  const deletePreset = useStylesStore((s) => s.deletePreset)
  const renamePreset = useStylesStore((s) => s.renamePreset)
  const showToast = useStylesStore((s) => s.showToast)

  const [showAllChips, setShowAllChips] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(name)
  const [renameExists, setRenameExists] = useState(false)
  const [busy, setBusy] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const renameTitleId = useId()

  const members = resolvePresetMembers(preset.styles ?? [], styles)
  const foundMembers = members.filter((m): m is FoundMember => m.status === 'found')
  const missingMembers = members.filter((m): m is MissingMember => m.status === 'missing')
  const wildcards = preset.wildcards ?? []
  const presetWcKeys = new Set(
    wildcards.map((wc) =>
      wildcardKey(String(wc.category || ''), String(wc.spec || ''), wc.kind),
    ),
  )
  const activeWcKeys = new Set(
    activeWildcards.map((w) => wildcardKey(w.category, w.spec, w.kind)),
  )
  // A style is (pack, name): the same name from another pack is a different style.
  const isActive = foundMembers.length > 0 &&
    foundMembers.every((m) => selectedKeySet.has(styleRowKey(m.style))) &&
    [...presetWcKeys].every((k) => activeWcKeys.has(k))

  useEffect(() => {
    if (!renameOpen) return
    setRenameValue(name)
    setRenameExists(false)
  }, [renameOpen, name])

  const meta = [plural(members.length, 'style', 'styles')]
  if (wildcards.length > 0) meta.push(plural(wildcards.length, 'wildcard', 'wildcards'))
  const note = preset.note?.trim() ?? ''

  const chips: Chip[] = [
    ...foundMembers.map((m, i): Chip => ({ kind: 'style', key: `s:${styleRowKey(m.style)}:${i}`, member: m })),
    ...wildcards.map((wc, i): Chip => ({ kind: 'wildcard', key: `w:${wildcardKey(wc.category, wc.spec, wc.kind)}:${i}`, wc })),
  ]
  const hiddenCount = Math.max(0, chips.length - PRESET_CHIP_LIMIT)
  const visibleChips = showAllChips ? chips : chips.slice(0, PRESET_CHIP_LIMIT)
  const missingTitle = missingMembers
    .map((m) => `Missing: ${styleDisplayName(m.name)}${m.pack ? ` (${m.pack})` : ''}`)
    .join('\n')

  const openMenuUnderMore = (restoreFocusTo: HTMLElement | null) => {
    const el = moreRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setMenu({ x: rect.left, y: rect.bottom + MENU_OFFSET_PX, restoreFocusTo: restoreFocusTo ?? el })
  }

  const onCardContextMenu = (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    // ContextMenu key / Shift+F10 is not a right button press: anchor under ⋯ and
    // return focus to the control that had it.
    const keyboard = e.nativeEvent.button !== 2 || (e.clientX === 0 && e.clientY === 0)
    if (keyboard) {
      openMenuUnderMore(e.target instanceof HTMLElement ? e.target : null)
      return
    }
    setMenu({ x: e.clientX, y: e.clientY, restoreFocusTo: moreRef.current })
  }

  const doRename = async (overwrite: boolean) => {
    const next = renameValue.trim()
    if (!next || busy) return
    if (next === name) {
      setRenameOpen(false)
      return
    }
    setBusy(true)
    try {
      const result = await renamePreset(name, next, { overwrite })
      if (!result.ok) {
        if (result.error === 'exists') {
          setRenameExists(true)
          return
        }
        showToast(
          typeof result.error === 'string' && result.error
            ? result.error
            : 'Rename failed',
          'error',
        )
        return
      }
      showToast(`Renamed to "${next}"`, 'success')
      setRenameOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await deletePreset(name)
      if (!result.ok) {
        showToast(
          typeof result.error === 'string' && result.error
            ? result.error
            : 'Delete failed',
          'error',
        )
        return
      }
      showToast(`Deleted "${name}"`, 'success')
      setDeleteOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <article
      data-sg-preset-card={name}
      onContextMenu={onCardContextMenu}
      className={cn(
        'rounded-xl border p-3.5 flex flex-col gap-2.5 min-w-0 transition-colors',
        isActive ? 'border-sg-accent bg-sg-accent/10' : 'border-sg-border bg-sg-surface',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-sg-text truncate" title={name}>
            {name}
          </div>
          <div className="text-xs text-sg-muted" data-sg-preset-meta>
            {meta.join(' · ')}
          </div>
        </div>
        <button
          ref={moreRef}
          type="button"
          aria-label={`${name} options`}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={(e) => openMenuUnderMore(e.currentTarget)}
          className={cn(
            'h-7 w-7 shrink-0 -mr-1 -mt-1 flex items-center justify-center rounded',
            'text-sg-muted hover:text-sg-text hover:bg-sg-accent/15 transition-colors',
            FOCUS_RING,
          )}
        >
          <MoreHorizontal size={16} aria-hidden />
        </button>
      </div>

      {note && (
        <p className="text-xs text-sg-muted line-clamp-2 break-words" data-sg-preset-note title={note}>
          {note}
        </p>
      )}

      {(chips.length > 0 || missingMembers.length > 0) && (
        <div className="flex flex-wrap gap-1" data-sg-preset-chips>
          {visibleChips.map((chip) => {
            if (chip.kind === 'style') {
              const pack = packBasename(chip.member.style.source_file)
              const label = styleDisplayName(chip.member.style.name)
              return (
                <span
                  key={chip.key}
                  className={STYLE_CHIP_CLASS}
                  title={pack ? `${chip.member.style.name} · ${pack}` : chip.member.style.name}
                  data-sg-preset-chip="style"
                >
                  <span className="truncate">{label}</span>
                </span>
              )
            }
            const isDeck = chip.wc.kind === WILDCARD_KIND_DECK
            const text = `${chip.wc.category}${chip.wc.spec ? `:${chip.wc.spec}` : ''}`
            return (
              <span
                key={chip.key}
                className={WILDCARD_CHIP_CLASS}
                title={isDeck ? `${text} ${PRESET_SHUFFLE_SUFFIX}` : text}
                data-sg-preset-chip="wildcard"
              >
                {isDeck
                  ? <DeckIcon className="h-3 w-3 inline-block shrink-0" />
                  : <span aria-hidden>🎲</span>}
                {isDeck && <span className="sr-only">{PRESET_SHUFFLE_SUFFIX}</span>}
                <span className="truncate">{text}</span>
              </span>
            )
          })}
          {hiddenCount > 0 && (
            <button
              type="button"
              aria-expanded={showAllChips}
              onClick={() => setShowAllChips((v) => !v)}
              className={cn(CHIP_BASE, 'border-sg-border text-sg-muted hover:text-sg-text', FOCUS_RING)}
              data-sg-preset-chip="more"
            >
              {showAllChips ? 'Show less' : `+${hiddenCount} more`}
            </button>
          )}
          {missingMembers.length > 0 && (
            <span className={MISSING_CHIP_CLASS} title={missingTitle} data-sg-preset-chip="missing">
              +{missingMembers.length} missing
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => (isActive ? unapplyPreset(name) : loadPreset(name))}
        title={isActive ? 'Remove this set from the current selection' : 'Apply this set to the current selection'}
        className={cn(
          'mt-auto w-full h-8 rounded text-xs font-medium transition-colors',
          isActive
            ? 'border border-sg-accent bg-transparent text-sg-text hover:bg-sg-accent/15'
            : 'bg-sg-accent text-white hover:bg-sg-accent/90',
          FOCUS_RING,
        )}
        data-sg-preset-apply
      >
        {isActive ? 'Applied · Remove' : 'Apply'}
      </button>
    </article>

      {/* Portaled layers live outside the article: React events from a portal
          bubble through the component tree, and a right-click in the menu
          backdrop or a dialog must not reach the card's onContextMenu. */}
      {menu && (
        <ViewportFixedMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          restoreFocusTo={menu.restoreFocusTo}
        >
          <MenuItem
            className="flex items-center gap-2"
            onSelect={() => {
              setMenu(null)
              setRenameOpen(true)
            }}
          >
            <Pencil size={14} aria-hidden />
            Rename…
          </MenuItem>
          <MenuItem
            className="flex items-center gap-2 text-sg-danger-text hover:bg-sg-danger/20"
            onSelect={() => {
              setMenu(null)
              setDeleteOpen(true)
            }}
          >
            <Trash2 size={14} aria-hidden />
            Delete…
          </MenuItem>
        </ViewportFixedMenu>
      )}

      <ModalShell
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename set"
        titleId={renameTitleId}
        busy={busy}
        initialFocus={renameRef}
        widthClassName="w-80"
        footer={
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRenameOpen(false)}
              className={cn(
                'px-3 py-1.5 text-sm border border-sg-border rounded hover:bg-sg-accent/20',
                FOCUS_RING,
              )}
            >
              Cancel
            </button>
            {renameExists ? (
              <button
                type="button"
                disabled={busy || !renameValue.trim()}
                onClick={() => void doRename(true)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded bg-amber-500/90 text-white',
                  FOCUS_RING,
                )}
              >
                Overwrite
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !renameValue.trim()}
                onClick={() => void doRename(false)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded bg-sg-accent text-white',
                  FOCUS_RING,
                )}
              >
                Rename
              </button>
            )}
          </>
        }
      >
        <input
          ref={renameRef}
          type="text"
          aria-labelledby={renameTitleId}
          value={renameValue}
          disabled={busy}
          onChange={(e) => {
            setRenameValue(e.target.value)
            setRenameExists(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void doRename(renameExists)
            }
          }}
          className={cn(
            'w-full h-9 px-3 rounded border border-sg-border bg-sg-surface text-sg-text text-sm',
            'focus:border-sg-accent focus:outline-none disabled:opacity-45',
            FOCUS_RING,
          )}
        />
        {renameExists && (
          <div className="mt-2 text-xs text-amber-300/90">
            A set named &ldquo;{renameValue.trim()}&rdquo; already exists.
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete set?"
        busy={busy}
        initialFocus={deleteCancelRef}
        widthClassName="w-80"
        footer={
          <>
            <button
              ref={deleteCancelRef}
              type="button"
              disabled={busy}
              onClick={() => setDeleteOpen(false)}
              className={cn(
                'px-3 py-1.5 text-sm border border-sg-border rounded hover:bg-sg-accent/20',
                FOCUS_RING,
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void doDelete()}
              className={cn(
                'px-3 py-1.5 text-sm rounded bg-red-500/90 text-white hover:bg-red-500',
                FOCUS_RING,
              )}
            >
              Delete
            </button>
          </>
        }
      >
        <p className="text-xs text-sg-muted leading-relaxed">
          Delete &ldquo;{name}&rdquo; permanently? This cannot be undone.
        </p>
      </ModalShell>
    </>
  )
}
