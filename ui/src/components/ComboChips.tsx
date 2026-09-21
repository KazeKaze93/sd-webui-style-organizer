import { startTransition } from 'react'
import { useStylesStore, styleRowKey } from '../store/stylesStore'
import { resolveCombosInSourceFile } from '../lib/styleIdentity'
import type { Style } from '../bridge'

interface Props {
  style: Pick<Style, 'name' | 'description' | 'source_file'>
  onBeforeToggle?: () => void
}

export function ComboChips({ style, onBeforeToggle }: Props) {
  const { styles, setCategory, toggleStyle, selectedStyles } = useStylesStore()

  if (!style.description) return null

  const resolvedCombos = resolveCombosInSourceFile(
    style.description,
    styles,
    style.source_file,
  )

  if (resolvedCombos.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      <span className="text-xs text-sg-muted self-center">Works with:</span>
      {resolvedCombos.map((resolved) => {
        if (resolved.type === 'style') {
          const isSelected = selectedStyles.some(
            (s) => styleRowKey(s) === styleRowKey(resolved.style),
          )
          const token = resolved.token
          return (
            <button
              key={token}
              onClick={() => {
                onBeforeToggle?.()
                toggleStyle(resolved.style)
              }}
              className={`px-2 py-0.5 rounded text-xs border transition-colors
                ${isSelected
                  ? 'bg-blue-500/30 border-blue-500/60 text-blue-300'
                  : 'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20'}`}
              title={`Click to ${isSelected ? 'deselect' : 'select'} ${token}`}
            >
              {isSelected ? '✓ ' : ''}{token.includes('_')
                ? token.split('_').slice(1).join(' ')
                : token}
            </button>
          )
        }

        return (
          <button
            key={resolved.token}
            onClick={() => startTransition(() => setCategory(resolved.category))}
            className="px-2 py-0.5 rounded text-xs border transition-colors
              bg-orange-500/10 border-orange-500/30 text-orange-400
              hover:bg-orange-500/20"
            title={`Filter by category ${resolved.category}`}
          >
            {resolved.token}
          </button>
        )
      })}
    </div>
  )
}
