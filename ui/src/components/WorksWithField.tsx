import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import type { Style } from '../bridge'
import { useLayer } from '../lib/layerStack'
import { addTailElement, removeTailElement } from '../lib/styleForm'
import { comboPartLabel } from '../lib/styleIdentity'
import { tailChips, worksWithCandidates, type TailChipMember } from '../lib/worksWith'
import { cn } from '../lib/utils'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

type Props = {
  labelId: string
  tail: string
  onChange: (tail: string) => void
  /** Styles of the source file the edited style lives in (or will be saved to). */
  inFile: readonly Style[]
  selfName: string | null
  disabled?: boolean
}

/**
 * "Works with" chips over the description's Combos tail. Removing or adding
 * an element rewrites only that element and one separator; the rest of the
 * tail stays byte for byte.
 */
export function WorksWithField({ labelId, tail, onChange, inFile, selfName, disabled = false }: Props) {
  const [query, setQuery] = useState('')
  const [resultsOpen, setResultsOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const chipRefs = useRef<Array<HTMLSpanElement | null>>([])
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  const chips = useMemo(() => tailChips(tail, inFile), [tail, inFile])
  const results = useMemo(
    () => worksWithCandidates(inFile, selfName, tail, query),
    [inFile, selfName, tail, query],
  )
  const showResults = resultsOpen && results.length > 0

  useLayer(showResults, () => {
    setResultsOpen(false)
  })

  // The field sits at the bottom of a scrolling dialog body: bring the results
  // into view when they appear or change, or they open below the fold.
  useEffect(() => {
    if (showResults) listRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [showResults, results])

  const focusChip = (i: number) => {
    if (i < 0) return
    if (i >= chips.length) {
      inputRef.current?.focus()
      return
    }
    chipRefs.current[i]?.focus()
  }

  const remove = (i: number) => {
    onChange(removeTailElement(tail, i))
    // Focus the previous chip after the list re-renders, or the input.
    requestAnimationFrame(() => {
      if (i > 0) chipRefs.current[i - 1]?.focus()
      else inputRef.current?.focus()
    })
  }

  const add = (style: Style) => {
    onChange(addTailElement(tail, style.name))
    setQuery('')
    setResultsOpen(false)
    setActive(0)
    inputRef.current?.focus()
  }

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return
      e.preventDefault()
      setResultsOpen(true)
      const dir = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (a + dir + results.length) % results.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (showResults && results[active]) add(results[active])
      return
    }
    const atStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0
    if ((e.key === 'Backspace' && query === '') || (e.key === 'ArrowLeft' && atStart)) {
      if (!chips.length) return
      e.preventDefault()
      focusChip(chips.length - 1)
    }
  }

  const onChipKeyDown = (i: number) => (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled) remove(i)
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusChip(Math.max(0, i - 1))
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusChip(i + 1)
    }
  }

  const memberView = (m: TailChipMember, key: number) => {
    const r = m.resolved
    return (
      <span key={key} className="inline-flex items-baseline gap-1 min-w-0">
        {key > 0 && <span className="text-sg-muted" aria-hidden="true">+</span>}
        <span className={cn('truncate', r.type === 'missing' || r.type === 'raw' ? 'text-sg-muted' : 'text-sg-text')}>
          {m.label}
        </span>
        {r.type === 'style' && (
          <span className="text-[10px] uppercase tracking-wide text-sg-muted">{r.style.category}</span>
        )}
        {r.type === 'category' && <span className="text-[10px] text-sg-muted">category</span>}
        {r.type === 'missing' && <span className="text-[10px] italic text-sg-muted">not in this pack</span>}
        {'comment' in r && r.comment && <span className="text-sg-muted">({r.comment})</span>}
      </span>
    )
  }

  const activeId = showResults ? `${listId}-opt-${active}` : undefined

  return (
    <div>
      <div
        role="list"
        aria-labelledby={labelId}
        className="flex flex-wrap items-center gap-1.5 rounded border border-sg-border bg-sg-surface px-2 py-1.5"
      >
        {chips.map((chip, i) => (
          <span
            key={`${i}:${chip.label}`}
            ref={(el) => {
              chipRefs.current[i] = el
            }}
            role="listitem"
            tabIndex={-1}
            aria-label={chip.label}
            data-sg-works-chip="true"
            onKeyDown={onChipKeyDown(i)}
            className={cn(
              'flex max-w-full items-center gap-1 rounded-full border border-sg-accent/40 bg-sg-accent/10',
              'px-2 py-0.5 text-xs',
              FOCUS_RING,
              'focus:outline-none focus:ring-2 focus:ring-sg-accent',
            )}
          >
            <span className="flex min-w-0 flex-wrap items-baseline gap-1">
              {chip.members.map(memberView)}
            </span>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              aria-label={`Remove ${chip.label}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => remove(i)}
              className="ml-0.5 shrink-0 rounded-sm text-sg-muted hover:text-sg-text disabled:opacity-45"
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search styles to add"
          aria-expanded={showResults}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={query}
          placeholder="Search styles to add"
          onChange={(e) => {
            setQuery(e.target.value)
            setResultsOpen(true)
            setActive(0)
          }}
          onFocus={() => setResultsOpen(true)}
          onBlur={() => setResultsOpen(false)}
          onKeyDown={onInputKeyDown}
          className="min-w-[8rem] flex-1 bg-transparent py-0.5 text-xs text-sg-text placeholder:text-sg-muted focus:outline-none"
        />
      </div>

      {showResults && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Styles to add"
          className="mt-1 max-h-40 overflow-y-auto rounded border border-sg-border bg-sg-popover py-1"
        >
          {results.map((s, i) => (
            <li
              key={s.name}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm text-sg-text',
                i === active ? 'bg-sg-accent/20' : 'hover:bg-sg-accent/10',
              )}
            >
              <span className="truncate">
                {comboPartLabel({ type: 'style', token: s.name, style: s, comment: '' })}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-sg-muted">{s.category}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
