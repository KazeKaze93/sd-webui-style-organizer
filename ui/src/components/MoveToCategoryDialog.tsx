import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { sendToHost, type Style } from '../bridge'
import {
  categoryOptions,
  libraryCategories,
  moveOutcomeText,
  parseCategoryInput,
  planMove,
} from '../lib/categoryMove'
import { postStyleRequest, sourceFileLeaf } from '../lib/styleActions'
import { cn } from '../lib/utils'
import { useStylesStore } from '../store/stylesStore'
import { CategoryCombobox } from './CategoryCombobox'
import { ModalShell } from './ModalShell'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

type Props = {
  open: boolean
  style: Style
  displayName: string
  onClose: () => void
}

/**
 * Move a style to another category. Canonical names (`CAT_rest`) get the new
 * prefix and category column; non-standard names keep their name and only the
 * column changes (POST /style/rename with `category`).
 */
export function MoveToCategoryDialog({ open, style, displayName, onClose }: Props) {
  const styles = useStylesStore((s) => s.styles)
  const showToast = useStylesStore((s) => s.showToast)
  const renameStyleIdentity = useStylesStore((s) => s.renameStyleIdentity)

  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const helperId = useId()

  const current = style.category || 'OTHER'
  const options = useMemo(() => categoryOptions(style, styles), [style, styles])
  const known = useMemo(() => libraryCategories(styles), [styles])
  const { value: target, error: inputError } = parseCategoryInput(query)

  // Reset on close (the combobox resets itself when it unmounts).
  useEffect(() => {
    if (open) return
    setQuery('')
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

  const submit = async () => {
    if (!canMove || !plan) return
    setBusy(true)
    try {
      const error = await postStyleRequest('/style_grid/style/rename', plan.payload, 'Move failed')
      if (error) {
        showToast(error, 'error')
        return
      }
      renameStyleIdentity(style, { name: plan.newName, category: target, categoryColumn: target })
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
      <CategoryCombobox
        id={inputId}
        inputRef={inputRef}
        value={query}
        onChange={setQuery}
        options={options}
        knownCategories={known}
        current={current}
        describedBy={helperId}
        invalid={!!helper?.error}
        disabled={busy}
        onEnter={() => void submit()}
      />

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
