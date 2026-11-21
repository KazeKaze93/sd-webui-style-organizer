import { useId, useMemo, useRef, useState } from 'react'
import { sendToHost, type Style } from '../bridge'
import { categoryOptions, libraryCategories } from '../lib/categoryMove'
import { postStyleRequest, sourceFileLeaf } from '../lib/styleActions'
import {
  buildDescription,
  buildSaveRequest,
  initialNameFields,
  resolveName,
  splitDescription,
  writableSources,
  type EditorMode,
} from '../lib/styleForm'
import { cn } from '../lib/utils'
import { useStylesStore } from '../store/stylesStore'
import { CategoryCombobox } from './CategoryCombobox'
import { ModalShell } from './ModalShell'
import { WorksWithField } from './WorksWithField'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

const FIELD =
  'w-full rounded border border-sg-border bg-sg-surface px-3 text-sm text-sg-text placeholder:text-sg-muted focus:border-sg-accent focus:outline-none disabled:opacity-45'

const LABEL = 'block text-xs text-sg-muted mb-1'

type Props =
  | { mode: 'edit'; open: boolean; style: Style; onClose: () => void; defaultSource?: never }
  | { mode: 'create'; open: boolean; defaultSource: string | null; onClose: () => void; style?: never }

/**
 * Create or edit a style. Edit saves into the style's own file; create into a
 * writable source of the user's choice. Requests mirror the host editor:
 * /style/save when the name stays, /style/rename (with the fields) when it
 * changes. The "Combos:" tail of the description is kept byte for byte.
 */
export function StyleEditorDialog(props: Props) {
  const { mode, open, onClose } = props
  const style = props.mode === 'edit' ? props.style : null

  const styles = useStylesStore((s) => s.styles)
  const showToast = useStylesStore((s) => s.showToast)
  const renameStyleIdentity = useStylesStore((s) => s.renameStyleIdentity)

  const sources = useMemo(() => writableSources(styles), [styles])
  const initialSource = useMemo(() => {
    if (style) return style.source_file
    const wanted = props.mode === 'create' ? props.defaultSource : null
    return wanted && sources.includes(wanted) ? wanted : (sources[0] ?? '')
    // Initial value only: later catalog updates must not move the user's pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const initial = useMemo(() => {
    const names = initialNameFields(style)
    const description = splitDescription(style?.description ?? '')
    return {
      ...names,
      prompt: style?.prompt ?? '',
      negative: style?.negative_prompt ?? '',
      descriptionText: description.text,
      tail: description.tail,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [source, setSource] = useState(initialSource)
  const [categoryInput, setCategoryInput] = useState(initial.category)
  const [nameInput, setNameInput] = useState(initial.name)
  const [prompt, setPrompt] = useState(initial.prompt)
  const [negative, setNegative] = useState(initial.negative)
  const [descriptionText, setDescriptionText] = useState(initial.descriptionText)
  const [tail, setTail] = useState(initial.tail)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const nameRef = useRef<HTMLInputElement>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const ids = {
    source: useId(),
    category: useId(),
    name: useId(),
    helper: useId(),
    prompt: useId(),
    promptHint: useId(),
    negative: useId(),
    description: useId(),
    worksWith: useId(),
  }

  const optionsStyle = useMemo(
    () => ({ category: style?.category ?? '', source_file: source }),
    [style, source],
  )
  const options = useMemo(
    () => categoryOptions(optionsStyle, styles, style ? style.category || 'OTHER' : null),
    [optionsStyle, styles, style],
  )
  const known = useMemo(() => libraryCategories(styles), [styles])
  const inFile = useMemo(() => styles.filter((s) => s.source_file === source), [styles, source])

  const outcome = resolveName({
    mode,
    style,
    categoryInput,
    nameInput,
    sourceFile: source,
    styles,
  })

  const dirty =
    source !== initialSource ||
    categoryInput.trim().toUpperCase() !== initial.category.toUpperCase() ||
    nameInput.trim() !== initial.name ||
    prompt !== initial.prompt ||
    negative !== initial.negative ||
    descriptionText !== initial.descriptionText ||
    tail !== initial.tail

  // Edit with no change: Save stays disabled (nothing to send).
  const canSave = dirty && outcome.name !== null && !!source && !busy

  const requestClose = () => {
    if (busy) return
    if (dirty) setConfirmOpen(true)
    else onClose()
  }

  const save = async () => {
    if (!canSave || outcome.name === null) return
    const description = buildDescription(style?.description ?? '', descriptionText, tail)
    const request = buildSaveRequest({
      mode,
      originalName: style?.name ?? null,
      outcome,
      fields: { prompt, negative_prompt: negative, description },
      sourceFile: source,
    })
    setBusy(true)
    try {
      const error = await postStyleRequest(request.url, request.body, 'Save failed')
      if (error) {
        showToast(error, 'error')
        return
      }
      if (style) {
        renameStyleIdentity(style, {
          name: outcome.name,
          category: outcome.category,
          ...(outcome.categoryColumn !== null ? { categoryColumn: outcome.categoryColumn } : {}),
          prompt,
          negative_prompt: negative,
          description,
        })
      }
      if (style && outcome.renames) {
        sendToHost({
          type: 'SG_STYLE_RENAMED',
          old_name: style.name,
          new_name: outcome.name,
          source_file: style.source_file,
        })
      } else {
        sendToHost({ type: 'SG_REFRESH' })
      }
      showToast(style ? `Saved ${outcome.name}` : `Created ${outcome.name}`, 'success')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const button = (primary: boolean) =>
    cn(
      'px-3 py-1.5 text-sm rounded transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
      primary
        ? 'bg-sg-accent text-white hover:bg-sg-accent/90'
        : 'text-sg-text border border-sg-border hover:bg-sg-accent/20',
      FOCUS_RING,
    )

  return (
    <>
      <ModalShell
        open={open}
        onClose={requestClose}
        title={mode === 'edit' ? 'Edit style' : 'New style'}
        busy={busy}
        initialFocus={nameRef}
        widthClassName="w-[28.75rem]"
        footer={
          <>
            <button type="button" disabled={busy} onClick={requestClose} className={button(false)}>
              Cancel
            </button>
            <button type="button" disabled={!canSave} onClick={() => void save()} className={button(true)}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        {style ? (
          <p className="text-xs text-sg-muted mb-3 break-words" data-sg-editor-source="true">
            {sourceFileLeaf(style.source_file)}
          </p>
        ) : (
          <div className="mb-3">
            <label htmlFor={ids.source} className={LABEL}>Save to</label>
            <select
              id={ids.source}
              value={source}
              disabled={busy}
              onChange={(e) => setSource(e.target.value)}
              className={cn(FIELD, 'h-9', FOCUS_RING)}
            >
              {sources.length === 0 && <option value="">No writable source</option>}
              {sources.map((src) => (
                <option key={src} value={src}>{sourceFileLeaf(src)}</option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label htmlFor={ids.category} className={LABEL}>
              Category{mode === 'create' ? ' (optional)' : ''}
            </label>
            <CategoryCombobox
              id={ids.category}
              value={categoryInput}
              onChange={setCategoryInput}
              options={options}
              knownCategories={known}
              current={style ? style.category || 'OTHER' : null}
              describedBy={ids.helper}
              invalid={outcome.error}
              disabled={busy}
              placeholder={mode === 'create' ? 'None' : 'Category'}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor={ids.name} className={LABEL}>Name</label>
            <input
              id={ids.name}
              ref={nameRef}
              type="text"
              value={nameInput}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={ids.helper}
              aria-invalid={outcome.error || undefined}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void save()
                }
              }}
              className={cn(FIELD, 'h-9', FOCUS_RING)}
            />
          </div>
        </div>
        <p
          id={ids.helper}
          role={outcome.error ? 'alert' : undefined}
          className={cn(
            'mt-1.5 mb-3 text-xs break-words',
            outcome.error ? 'text-sg-danger-text' : 'text-sg-muted',
          )}
        >
          {outcome.helper}
        </p>

        <label htmlFor={ids.prompt} className={LABEL}>
          Prompt{' '}
          <span id={ids.promptHint} className="text-sg-muted/80">
            · {'{prompt}'} marks where the user prompt goes
          </span>
        </label>
        <textarea
          id={ids.prompt}
          value={prompt}
          disabled={busy}
          rows={4}
          spellCheck={false}
          aria-describedby={ids.promptHint}
          onChange={(e) => setPrompt(e.target.value)}
          className={cn(FIELD, 'py-2 font-mono text-xs leading-relaxed resize-y mb-3', FOCUS_RING)}
        />

        <label htmlFor={ids.negative} className={LABEL}>Negative prompt</label>
        <textarea
          id={ids.negative}
          value={negative}
          disabled={busy}
          rows={3}
          spellCheck={false}
          onChange={(e) => setNegative(e.target.value)}
          className={cn(FIELD, 'py-2 font-mono text-xs leading-relaxed resize-y mb-3', FOCUS_RING)}
        />

        <label htmlFor={ids.description} className={LABEL}>Description</label>
        <input
          id={ids.description}
          type="text"
          value={descriptionText}
          disabled={busy}
          onChange={(e) => setDescriptionText(e.target.value)}
          className={cn(FIELD, 'h-9 mb-3', FOCUS_RING)}
        />

        <div id={ids.worksWith} className={LABEL}>Works with (optional)</div>
        <WorksWithField
          labelId={ids.worksWith}
          tail={tail}
          onChange={setTail}
          inFile={inFile}
          selfName={style?.name ?? null}
          disabled={busy}
        />
      </ModalShell>

      <ModalShell
        open={open && confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Discard changes?"
        initialFocus={keepEditingRef}
        widthClassName="w-80"
        footer={
          <>
            <button
              ref={keepEditingRef}
              type="button"
              onClick={() => setConfirmOpen(false)}
              className={button(false)}
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(false)
                onClose()
              }}
              className={cn(
                'px-3 py-1.5 text-sm rounded bg-sg-danger text-white hover:bg-sg-danger/90 transition-colors',
                FOCUS_RING,
              )}
            >
              Discard
            </button>
          </>
        }
      >
        <p className="text-sm text-sg-muted leading-relaxed">
          Your changes to this style have not been saved.
        </p>
      </ModalShell>
    </>
  )
}

export type { EditorMode }
