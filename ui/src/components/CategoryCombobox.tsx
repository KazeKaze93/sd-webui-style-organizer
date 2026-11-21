import { useId, useMemo, useState, type KeyboardEvent, type RefObject } from 'react'
import type { CategoryOption } from '../lib/categoryMove'
import { parseCategoryInput } from '../lib/categoryMove'
import { useLayer } from '../lib/layerStack'
import { cn } from '../lib/utils'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

type ListItem =
  | { kind: 'category'; category: string; count: number; current: boolean }
  | { kind: 'create'; category: string }

export type CategoryComboboxProps = {
  id: string
  inputRef?: RefObject<HTMLInputElement | null>
  /** Raw text in the field; the parent derives the category from it. */
  value: string
  onChange: (value: string) => void
  options: CategoryOption[]
  /** Every category name of the library, uppercased (for the "create" offer). */
  knownCategories: ReadonlySet<string>
  /** Current category of the style, never offered as "create". */
  current?: string | null
  /** Id of the helper line under the field. */
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
  placeholder?: string
  /** Enter with no option highlighted (e.g. submit the dialog). */
  onEnter?: () => void
}

/**
 * Category field: a text input with a listbox of existing categories (ARIA
 * combobox pattern). Typing filters; a valid name that matches no category is
 * offered as "Create category". Options marked current cannot be picked.
 * The open list is its own layer, so Escape closes it before the dialog.
 */
export function CategoryCombobox({
  id,
  inputRef,
  value,
  onChange,
  options,
  knownCategories,
  current = null,
  describedBy,
  invalid = false,
  disabled = false,
  placeholder = 'Search or create a category',
  onEnter,
}: CategoryComboboxProps) {
  const [listOpen, setListOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()

  const { value: target, error } = parseCategoryInput(value)
  const currentUpper = current ? current.toUpperCase() : null

  const items: ListItem[] = useMemo(() => {
    const filtered: ListItem[] = options
      .filter((o) => !target || o.category.toUpperCase().includes(target))
      .map((o) => ({ kind: 'category', ...o }))
    if (target && !error && !knownCategories.has(target) && target !== currentUpper) {
      filtered.push({ kind: 'create', category: target })
    }
    return filtered
  }, [options, target, error, knownCategories, currentUpper])

  const selectable = (item: ListItem | undefined) =>
    !!item && !(item.kind === 'category' && item.current)

  useLayer(listOpen, () => {
    setListOpen(false)
    setActive(-1)
  })

  const choose = (item: ListItem) => {
    if (!selectable(item)) return
    onChange(item.category)
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
      onEnter?.()
    }
  }

  const activeId = listOpen && active >= 0 ? `${listId}-opt-${active}` : undefined

  return (
    <>
      <input
        id={id}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setListOpen(true)}
        onBlur={() => {
          setListOpen(false)
          setActive(-1)
        }}
        onChange={(e) => {
          onChange(e.target.value)
          setListOpen(true)
          setActive(-1)
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full h-9 px-3 rounded border bg-sg-surface text-sg-text text-sm uppercase',
          'placeholder:normal-case placeholder:text-sg-muted focus:outline-none disabled:opacity-45',
          invalid ? 'border-sg-danger-text' : 'border-sg-border focus:border-sg-accent',
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
            const itemDisabled = !selectable(item)
            return (
              <li
                key={`${item.kind}:${item.category}`}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={itemDisabled || undefined}
                // Keep focus in the input; the click picks the option.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
                className={cn(
                  'flex items-center justify-between gap-3 px-3 py-1.5 text-sm',
                  itemDisabled ? 'cursor-not-allowed text-sg-muted' : 'cursor-pointer text-sg-text',
                  i === active && !itemDisabled
                    ? 'bg-sg-accent/20'
                    : !itemDisabled && 'hover:bg-sg-accent/10',
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
    </>
  )
}
