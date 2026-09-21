import { useRef, useState } from 'react'
import { styleRowKey, useStylesStore } from '../store/stylesStore'
import { resolveSelectedStyleRow } from '../lib/styleIdentity'
import { ComboChips } from './ComboChips'

export function StyleInfoPanel() {
  const { selectedStyles, styles } = useStylesStore()
  const [pinnedStyle, setPinnedStyle] = useState<typeof styles[0] | null>(null)
  const isChipClick = useRef(false)

  const lastSelected = selectedStyles[selectedStyles.length - 1]

  // Clear pin only when selection changes from a non-chip action.
  // isChipClick is a same-tick guard set in onBeforeToggle before toggleStyle;
  // it must be consulted while resolving this render or a combo click would
  // briefly drop the pin. Not a subscription — disable react-hooks/refs for that read.
  const resolvedStyle = (() => {
    if (pinnedStyle) {
      const stillSelected = selectedStyles.some(
        (s) => styleRowKey(s) === styleRowKey(pinnedStyle),
      )
      // eslint-disable-next-line react-hooks/refs -- same-tick chip-click guard; see comment above
      if (stillSelected || isChipClick.current) return pinnedStyle
      // Pin target was deselected — clear pin
      setPinnedStyle(null)
    }
    return resolveSelectedStyleRow(styles, lastSelected)
  })()

  if (!resolvedStyle) return null

  const displayName = resolvedStyle.name.includes('_')
    ? resolvedStyle.name.split('_').slice(1).join(' ')
    : resolvedStyle.name

  const handlePin = () => {
    isChipClick.current = true
    const full = resolveSelectedStyleRow(styles, resolvedStyle) || resolvedStyle
    setPinnedStyle(full)
    setTimeout(() => { isChipClick.current = false }, 0)
  }

  return (
    <div className="px-4 py-2">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">
            {displayName}
          </div>
          {resolvedStyle.description && !resolvedStyle.description.includes('Combos:') && (
            <div className="text-xs text-sg-muted mt-0.5 line-clamp-2">
              {resolvedStyle.description.replace(/Combos?:[^.]+\.?/i, '').trim()}
            </div>
          )}
          <ComboChips style={resolvedStyle} onBeforeToggle={handlePin} />
        </div>
      </div>
    </div>
  )
}
