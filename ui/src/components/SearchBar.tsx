import { useState, useRef } from 'react'
import { useStylesStore } from '../store/stylesStore'
import {
  Command, CommandEmpty, CommandGroup,
  CommandItem, CommandList
} from './ui/command'
import { Popover, PopoverContent, PopoverAnchor } from './ui/popover'

export function SearchBar() {
  const { styles, search, setSearch, toggleStyle, selectedStyles } = useStylesStore()
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState(search)
  const inputRef = useRef<HTMLInputElement>(null)

  // Autocomplete suggestions - top 8 matches by name
  const suggestions = inputValue.length > 0
    ? styles
        .filter(s => s.name.toLowerCase().includes(inputValue.toLowerCase()))
        .slice(0, 8)
    : []

  const handleInput = (val: string) => {
    setInputValue(val)
    setSearch(val)
    setOpen(val.length > 0 && suggestions.length > 0)
  }

  const handleSelect = (style: typeof styles[0]) => {
    setInputValue('')
    setSearch('')
    setOpen(false)
    // Apply immediately if not already selected
    const isSelected = selectedStyles.some(s => s.name === style.name)
    if (!isSelected) toggleStyle(style)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative flex-1">
          <input
            ref={inputRef}
            value={inputValue}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setOpen(false); setInputValue(''); setSearch('') }
              if (e.key === 'ArrowDown' && open) e.preventDefault()
            }}
            placeholder="Search styles..."
            className="w-full h-8 px-3 pr-8 rounded border border-sg-border 
                       bg-sg-surface text-sg-text text-sm
                       placeholder:text-sg-muted focus:border-sg-accent 
                       focus:outline-none transition-colors"
          />
          {inputValue && (
            <button
              onClick={() => { setInputValue(''); setSearch(''); setOpen(false) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 
                         text-sg-muted hover:text-sg-text text-xs"
            >✕</button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="p-0 w-72"
        style={{
          background: '#0f172a',
          border: '1px solid #2d2d4e',
        }}
        align="start"
        onOpenAutoFocus={e => e.preventDefault()}
      >
        <Command shouldFilter={false} className="bg-transparent">
          <CommandList className="bg-transparent">
            <CommandEmpty className="text-sg-muted text-sm py-3 px-4">
              No styles found
            </CommandEmpty>
            <CommandGroup>
              {suggestions.map(style => (
                <CommandItem
                  key={style.name}
                  value={style.name}
                  onSelect={() => handleSelect(style)}
                  className="cursor-pointer flex items-center justify-between
                             !text-white hover:!bg-sg-accent/20
                             aria-selected:!bg-sg-accent/20
                             px-3 py-2"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm truncate !text-white font-medium">
                      {style.name.includes('_')
                        ? style.name.split('_').slice(1).join(' ')
                        : style.name}
                    </span>
                    <span className="text-xs !text-slate-400">{style.category}</span>
                  </div>
                  {selectedStyles.some(s => s.name === style.name) && (
                    <span className="text-sg-accent text-xs ml-2 shrink-0">✓</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
