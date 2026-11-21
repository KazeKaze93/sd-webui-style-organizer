import { createPortal } from 'react-dom'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { Style } from '../bridge'
import { styleRowKey, useStylesStore, useThumbVersion } from '../store/stylesStore'
import { createHoverIntent, type HoverIntent } from '../lib/hoverIntent'

/** Delay before the preview opens: avoids flicker during fast cursor travel. */
const PREVIEW_SHOW_DELAY_MS = 300
/** Grace period to move the pointer from the card onto the preview. */
const PREVIEW_HIDE_DELAY_MS = 100

interface Props {
  style: Style
  children: React.ReactNode
}

export const ThumbnailPreview = memo(function ThumbnailPreview({ style, children }: Props) {
  /** Falls back to a text-only popup if the thumbnail image fails to load. */
  const [visible, setVisible] = useState(false)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [above, setAbove] = useState(true)
  const [popupPos, setPopupPos] = useState({ left: 0, top: 0 })
  const key = useMemo(() => styleRowKey(style), [style])
  const thumbVersion = useThumbVersion(key)
  const intentRef = useRef<HoverIntent | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeSource = useStylesStore((s) => s.activeSource)
  const sourceForThumb = style.source_file || activeSource || ''
  const thumbUrl = `/style_grid/thumbnail?name=${encodeURIComponent(style.name)}${
    sourceForThumb ? `&source=${encodeURIComponent(sourceForThumb)}` : ''
  }&v=${thumbVersion}`
  const imgOk = loadedUrl === thumbUrl

  const displayName = style.display_name || (style.name.includes('_')
    ? style.name.split('_').slice(1).join(' ')
    : style.name)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const intent = createHoverIntent({
      showDelayMs: PREVIEW_SHOW_DELAY_MS,
      hideDelayMs: PREVIEW_HIDE_DELAY_MS,
      // Still on the card. No focus gate: the panel is non-modal, so focus may sit
      // in the host prompt textarea. A host modal is covered by the window blur
      // dismiss in hoverIntent, and :hover is false under its overlay.
      canShow: () => el.matches(':hover'),
      onShow: () => {
        const rect = el.getBoundingClientRect()
        setAbove(rect.top > 200)
        const popupWidth = 240
        const left = Math.max(
          8,
          Math.min(rect.left + rect.width / 2, window.innerWidth - popupWidth - 8)
        )
        const top = rect.top > 200 ? rect.top - 8 : rect.bottom + 8
        setPopupPos({ left, top })
        setVisible(true)
      },
      onHide: () => {
        setVisible(false)
        setLoadedUrl(null)
      },
    })
    intentRef.current = intent
    // Native listeners, not React's onMouseEnter/onMouseLeave: after a layer
    // portaled to <body> (context menu, its backdrop) is removed under the
    // cursor, the browser reports the next move as body -> card, and React
    // synthesizes onMouseEnter twice for it (once from mouseout on the portal
    // container, once from mouseover with an unmanaged relatedTarget).
    const onEnter = () => intent.enter()
    const onLeave = () => intent.leave()
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
      intent.dispose()
      intentRef.current = null
    }
  }, [])

  return (
    <div
      className="relative"
      ref={containerRef}
    >
      {children}

      {visible && createPortal(
        <div
          className="fixed z-[10050]"
          onMouseEnter={() => intentRef.current?.hold()}
          onMouseLeave={() => intentRef.current?.leave()}
          style={{
            minWidth: '200px',
            maxWidth: '280px',
            left: `${popupPos.left}px`,
            top: `${popupPos.top}px`,
            transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)'
          }}
        >
          <div className="bg-sg-popover border border-sg-border rounded-lg shadow-xl overflow-hidden">
            <img
              src={thumbUrl}
              alt=""
              className={`w-full object-cover transition-opacity ${imgOk ? 'opacity-100' : 'hidden'}`}
              style={{ maxHeight: '160px' }}
              onLoad={() => setLoadedUrl(thumbUrl)}
              onError={() => setLoadedUrl(null)}
            />
            <div className="px-2.5 py-2">
              <div className="text-sm font-semibold text-white truncate">
                {displayName}
              </div>
              {style.prompt && (
                <div className="text-xs text-slate-400 mt-1 line-clamp-3 leading-relaxed">
                  {style.prompt.slice(0, 120)}
                  {style.prompt.length > 120 ? '...' : ''}
                </div>
              )}
              {style.negative_prompt && (
                <div className="text-xs text-red-400/70 mt-1 truncate">
                  − {style.negative_prompt.slice(0, 60)}
                </div>
              )}
            </div>
            <div className="px-2.5 py-1.5 border-t border-sg-border text-[11px] text-sg-muted">
              Right-click for options
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
})
