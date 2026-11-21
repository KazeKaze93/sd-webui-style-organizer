import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { sendToHost, type Style } from '../bridge'
import {
  categoryOptions,
  libraryCategories,
  moveOutcomeText,
  parseCategoryInput,
  planMove,
} from '../lib/categoryMove'
import { useLayer } from '../lib/layerStack'
import { styleGridPost } from '../lib/styleGridFetch'
import { sourceFileLeaf } from '../lib/styleActions'
import { cn } from '../lib/utils'
import { useStylesStore } from '../store/stylesStore'
import { ModalShell } from './ModalShell'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

type Props = {
  open: boolean
  style: Style
  displayName: string
  onClose: () => void
}

type ListItem =
  | { kind: 'category'; category: string; count: number; current: boolean }
  | { kind: 'create'; category: string }

async function postRename(payload: object): Promise<string | null> {
  try {
    const res = await styleGridPost('/style_grid/style/rename', payload)
    const data: unknown = await res.json().catch(() => ({}))
    const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    if (res.ok && body.ok !== false && !body.error) return null
    if (typeof body.error === 'string' && body.error) return body.error
    return 'Move failed'
  } catch {
    return 'Move failed'
  }
}

/**
 * Move a style to another category. Canonical names (`CAT_rest`) get the new
 * prefix and category column; non-standard names keep their name and only the
 * column changes. The request is the one the host Move made.
 */
export function MoveToCategoryDialog({ open, style, displayName, onClose }: Props) {
  const styles = useStylesStore((s) => s.styles)
  const showToast = useStylesStore((s) => s.showToast)
  const renameStyleIdentity = useStylesStore((s) => s.renameStyleIdentity)

  const [query, setQuery] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const listId = useId()
  const helperId = useId()

  const current = style.category || 'OTHER'
  const options = useMemo(() => categoryOptions(style, styles), [style, styles])
  const known = useMemo(() => libraryCategories(styles), [styles])
  const { value: target, error: inputError } = parseCategoryInput(query)

  const items: ListItem[] = useMemo(() => {
    const filtered: ListItem[] = options
      .filter((o) => !target || o.category.toUpperCase().includes(target))
      .map((o) => ({ kind: 'category', ...o }))
    if (target && !inputError && !known.has(target) && target !== current.toUpperCase()) {
      filtered.push({ kind: 'create', category: target })
    }
    return filtered
  }, [options, target, inputError, known, current])

  const selectable = (item: ListItem | undefined) =>
    !!item && !(item.kind === 'category' && item.current)

  // The list is its own layer: Escape closes it before the dialog.
  useLayer(open && listOpen, () => {
    setListOpen(false)
    setActive(-1)
  })

  // Reset on close, not on open: on open ModalShell focuses the input first
  // (child effects run before this one), which opens the list.
  useEffect(() => {
    if (open) return
    setQuery('')
    setListOpen(false)
    setActive(-1)
    setBusy(false)
  }, [open])

  const plan = target && !inputError ? planMove(style, target) : null
  const sameAsCurrent = !!target && target === current.toUpperCase()
  const collision =
    plan && plan.renames
      ? styles.some(
        (s) =>
          s.source_file === style.source_file &&
          s.name === plan.newName &&
          s.name !== style.name,
      )
      : false

  let helper: { text: string; error: boolean } | null = null
  if (inputError) helper = { text: inputError, error: true }
  else if (!target) helper = { text: 'Choose a category or type a new one.', error: false }
  else if (sameAsCurrent) helper = { text: `Already in ${current}.`, error: false }
  else if (collision && plan) {
    helper = {
      text: `${plan.newName} already exists in ${sourceFileLeaf(style.source_file)}.`,
      error: true,
    }
  } else if (plan) helper = { text: moveOutcomeText(style, plan, target), error: false }

  const canMove = !!plan && !sameAsCurrent && !collision && !busy

  const choose = (item: ListItem) => {
    if (!selectable(item)) return
    setQuery(item.category)
    setListOpen(false)
    setActive(-1)
  }

  const step = (dir: 1 | -1) => {
    if (items.length === 0) return
    let i = active
    for (let n = 0; n < items.length; n++) {
      i = (i + dir + items.length) % items.length
      if (selectable(items[i])) {
        setActive(i)
        return
      }
    }
  }

  const submit = async () => {
    if (!canMove || !plan) return
    setBusy(true)
    try {
      const error = await postRename(plan.payload)
      if (error) {
        showToast(error, 'error')
        return
      }
      renameStyleIdentity(style, { name: plan.newName, category: target })
      if (plan.renames) {
        sendToHost({
          type: 'SG_STYLE_RENAMED',
          old_name: style.name,
          new_name: plan.newName,
          source_file: style.source_file,
        })
      } else {
        sendToHost({ type: 'SG_REFRESH' })
      }
      showToast(`Moved to ${target}`, 'success')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!listOpen) {
        setListOpen(true)
        setActive(-1)
      }
      step(e.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (listOpen && active >= 0 && items[active]) {
        choose(items[active])
        return
      }
      void submit()
    }
  }

  const activeId = listOpen && active >= 0 ? `${listId}-opt-${active}` : undefined

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Move to category"
      busy={busy}
      initialFocus={inputRef}
      widthClassName="w-[26.25rem]"
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={cn(
              'px-3 py-1.5 text-sm text-sg-text border border-sg-border rounded',
              'hover:bg-sg-accent/20 transition-colors',
              'disabled:opacity-45 disabled:cursor-not-allowed',
              FOCUS_RING,
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canMove}
            onClick={() => void submit()}
            className={cn(
              'px-3 py-1.5 text-sm rounded bg-sg-accent text-white',
              'hover:bg-sg-accent/90 transition-colors',
              'disabled:opacity-45 disabled:cursor-not-allowed',
              FOCUS_RING,
            )}
          >
            {busy ? 'Moving…' : 'Move'}
          </button>
        </>
      }
    >
      <p className="text-xs text-sg-muted mb-3 break-words" data-sg-move-subject="true">
        {displayName} · {sourceFileLeaf(style.source_file)}
      </p>

      <label htmlFor={inputId} className="block text-xs text-sg-muted mb-1">
        Category
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-describedby={helperId}
        aria-invalid={helper?.error || undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        disabled={busy}
        placeholder="Search or create a category"
        onFocus={() => setListOpen(true)}
        onBlur={() => {
          setListOpen(false)
          setActive(-1)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setListOpen(true)
          setActive(-1)
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full h-9 px-3 rounded border bg-sg-surface text-sg-text text-sm uppercase',
          'placeholder:normal-case placeholder:text-sg-muted focus:outline-none disabled:opacity-45',
          helper?.error ? 'border-sg-danger-text' : 'border-sg-border focus:border-sg-accent',
          FOCUS_RING,
        )}
      />

      {listOpen && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Categories"
          className="mt-1 max-h-48 overflow-y-auto rounded border border-sg-border bg-sg-popover py-1"
        >
          {items.length === 0 && (
            <li className="px-3 py-1.5 text-xs text-sg-muted" role="presentation">
              No matching category
            </li>
          )}
          {items.map((item, i) => {
            const disabled = !selectable(item)
            return (
              <li
                key={`${item.kind}:${item.category}`}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={disabled || undefined}
                // Keep focus in the input; the click picks the option.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
                className={cn(
                  'flex items-center justify-between gap-3 px-3 py-1.5 text-sm',
                  disabled ? 'cursor-not-allowed text-sg-muted' : 'cursor-pointer text-sg-text',
                  i === active && !disabled ? 'bg-sg-accent/20' : !disabled && 'hover:bg-sg-accent/10',
                )}
              >
                {item.kind === 'create' ? (
                  <span className="truncate">Create category &ldquo;{item.category}&rdquo;</span>
                ) : (
                  <>
                    <span className="truncate">{item.category}</span>
                    <span className="shrink-0 text-xs text-sg-muted tabular-nums">
                      {item.current ? 'current · ' : ''}
                      {item.count}
                    </span>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p
        id={helperId}
        role={helper?.error ? 'alert' : undefined}
        className={cn(
          'mt-2 text-xs break-words',
          helper?.error ? 'text-sg-danger-text' : 'text-sg-muted',
        )}
      >
        {helper?.text}
      </p>
    </ModalShell>
  )
}
