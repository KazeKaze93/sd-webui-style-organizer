import { Input } from './ui/input'
import { useStylesStore } from '../store/stylesStore'

export function SearchBar() {
  const { search, setSearch } = useStylesStore()
  return (
    <div className="relative">
      <Input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search styles..."
        className="bg-sg-surface border-sg-border text-sg-text 
                   placeholder:text-sg-muted focus:border-sg-accent"
      />
      {search && (
        <button
          onClick={() => setSearch('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 
                     text-sg-muted hover:text-sg-text text-xs"
        >✕</button>
      )}
    </div>
  )
}
