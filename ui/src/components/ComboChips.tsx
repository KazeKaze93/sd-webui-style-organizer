import { useStylesStore } from '../store/stylesStore'
import { sendToHost } from '../bridge'

interface Props {
  style: { name: string; description: string }
}

function parseComboTokens(description: string): string[] {
  // Parse "Some text. Combos: TOKEN1; TOKEN2; TOKEN3."
  const match = description.match(/Combos?:\s*([^.]+)/i)
  if (!match) return []
  return match[1].split(';').map(t => t.trim()).filter(Boolean)
}

function parseConflictTokens(description: string): string[] {
  const match = description.match(/Conflicts?:\s*([^.]+)/i)
  if (!match) return []
  return match[1].split(';').map(t => t.trim()).filter(Boolean)
}

export function ComboChips({ style }: Props) {
  const { styles, setSearch, setCategory, toggleStyle, selectedStyles } = useStylesStore()

  if (!style.description) return null

  const comboTokens = parseComboTokens(style.description)
  const conflictTokens = parseConflictTokens(style.description)

  if (comboTokens.length === 0 && conflictTokens.length === 0) return null

  const resolveToken = (token: string) => {
    // Try exact style name match
    const exact = styles.find(s => s.name === token)
    if (exact) return { type: 'style', style: exact }

    // Try category wildcard (e.g. FURRY_* or CATEGORY_Name)
    const parts = token.split('_')
    if (parts.length >= 1) {
      const cat = parts[0]
      const catExists = styles.some(s => s.category === cat)
      if (catExists) return { type: 'category', category: cat, token }
    }

    return { type: 'unknown', token }
  }

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {comboTokens.length > 0 && (
        <>
          <span className="text-xs text-sg-muted self-center">Works with:</span>
          {comboTokens.map(token => {
            const resolved = resolveToken(token)
            const isSelected = resolved.type === 'style' &&
              selectedStyles.some(s => s.name === resolved.style?.name)

            if (resolved.type === 'style') {
              return (
                <button
                  key={token}
                  onClick={() => resolved.style && toggleStyle(resolved.style)}
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

            if (resolved.type === 'category') {
              return (
                <button
                  key={token}
                  onClick={() => setCategory(resolved.category!)}
                  className="px-2 py-0.5 rounded text-xs border transition-colors
                    bg-orange-500/10 border-orange-500/30 text-orange-400
                    hover:bg-orange-500/20"
                  title={`Filter by category ${resolved.category}`}
                >
                  {resolved.token}
                </button>
              )
            }

            return (
              <span key={token}
                className="px-2 py-0.5 rounded text-xs border
                  bg-sg-border/30 border-sg-border text-sg-muted">
                {token}
              </span>
            )
          })}
        </>
      )}

      {conflictTokens.length > 0 && (
        <>
          <span className="text-xs text-red-400/70 self-center ml-1">
            Avoid:
          </span>
          {conflictTokens.map(token => (
            <span key={token}
              className="px-2 py-0.5 rounded text-xs border
                bg-red-500/10 border-red-500/30 text-red-400">
              ✗ {token}
            </span>
          ))}
        </>
      )}
    </div>
  )
}
