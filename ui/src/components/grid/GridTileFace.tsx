import { Check, Loader2, Star } from 'lucide-react'
import type { PreviewJobState } from '../../lib/previewProgress'

/** How the name behaves: one truncated line (tile), one full line or wrapped lines (expanded overlay). */
export type GridTileLabelMode = 'truncate' | 'nowrap' | 'wrap'

export type GridTileFaceProps = {
  displayName: string
  windowed: boolean
  isSelected: boolean
  fav: boolean
  previewJob: PreviewJobState | null
  /** Category accent strip color. */
  categoryColor: string
  labelMode?: GridTileLabelMode
}

/** Literal class strings (Tailwind scans the source). */
function labelClass(windowed: boolean, mode: GridTileLabelMode): string {
  if (mode === 'wrap') {
    return windowed
      ? 'text-xs min-w-0 whitespace-normal break-words pr-4 font-medium text-sg-text'
      : 'text-sm min-w-0 whitespace-normal break-words pr-4 font-medium text-sg-text'
  }
  if (mode === 'nowrap') {
    return windowed
      ? 'text-xs min-w-0 whitespace-nowrap pr-4 font-medium text-sg-text'
      : 'text-sm min-w-0 whitespace-nowrap pr-4 font-medium text-sg-text'
  }
  return windowed
    ? 'text-xs min-w-0 truncate pr-4 font-medium text-sg-text'
    : 'text-sm min-w-0 truncate pr-4 font-medium text-sg-text'
}

/**
 * Visual content of a grid-mode tile: category strip, name, preview status,
 * favorite star and selected dot. No interaction; rendered inside the tile
 * button and inside the expanded-name overlay.
 */
export function GridTileFace({
  displayName,
  windowed,
  isSelected,
  fav,
  previewJob,
  categoryColor,
  labelMode = 'truncate',
}: GridTileFaceProps) {
  const generating = previewJob === 'generating'
  return (
    <>
      {/* Category accent — separate strip avoids asymmetric border-radius bleed onto the name */}
      {!isSelected && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[3px]"
          style={{ backgroundColor: categoryColor }}
        />
      )}
      {/* pr-4 keeps the name clear of the dot, star and status on the right. */}
      <div className={labelClass(windowed, labelMode)} data-sg-grid-label="true">
        {displayName}
      </div>

      {previewJob && (
        <span
          aria-hidden="true"
          data-sg-preview-status={previewJob}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 flex text-sg-wildcard-text"
        >
          {generating ? (
            <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Check size={12} />
          )}
        </span>
      )}

      {/* The status above takes the favorite indicator's place while it shows. */}
      {fav && !previewJob && (
        <Star
          size={12}
          fill="currentColor"
          className="absolute top-1.5 right-1.5 text-sg-warning-text"
          aria-hidden="true"
        />
      )}

      {/* Selected indicator */}
      {isSelected && (
        <div
          aria-hidden="true"
          className="absolute bottom-2 right-2 h-1.5 w-1.5 rounded-full bg-sg-accent"
        />
      )}
    </>
  )
}
