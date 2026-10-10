import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Style } from '../bridge'
import { styleRowKey, useStylesStore, useThumbVersion } from '../store/stylesStore'

interface Props {
  style: Style
  children: React.ReactNode
}

export function ThumbnailPreview({ style, children }: Props) {
  /**
   * Delays preview open (300ms) to reduce flicker during fast cursor travel,
   * and falls back to text-only popup if thumbnail image fails to load.
   */
  const [visible, setVisible] = useState(false)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [above, setAbove] = useState(true)
  const [popupPos, setPopupPos] = useState({ left: 0, top: 0 })
  const key = useMemo(() => styleRowKey(style), [style])
  const thumbVersion = useThumbVersion(key)
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeSource = useStylesStore((s) => s.activeSource)
  const sourceForThumb = style.source_file || activeSource || ''
  const thumbUrl = `/style_grid/thumbnail?name=${encodeURIComponent(style.name)}${
    sourceForThumb ? `&source=${encodeURIComponent(sourceForThumb)}` : ''
  }&v=${thumbVersion}`
  const imgOk = loadedUrl === thumbUrl

  const handleEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    enterTimer.current = setTimeout(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setAbove(rect.top > 200)
        const popupWidth = 240
        const left = Math.max(
          8,
          Math.min(rect.left + rect.width / 2, window.innerWidth - popupWidth - 8)
        )
        const top = rect.top > 200 ? rect.top - 8 : rect.bottom + 8
        setPopupPos({ left, top })
      }
      setVisible(true)
    }, 300)
  }

  const handleLeave = () => {
    if (enterTimer.current) clearTimeout(enterTimer.current)
    leaveTimer.current = setTimeout(() => {
      setVisible(false)
      setLoadedUrl(null)
    }, 100)
  }

  const displayName = style.display_name || (style.name.includes('_')
    ? style.name.split('_').slice(1).join(' ')
    : style.name)

  useEffect(() => {
    return () => {
      if (enterTimer.current) clearTimeout(enterTimer.current)
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
    }
  }, [])

  return (
    <div
      className="relative"
      ref={containerRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}

      {visible && createPortal(
        <div
          className="fixed z-[10050]"
          onMouseEnter={() => {
            if (enterTimer.current) clearTimeout(enterTimer.current)
            if (leaveTimer.current) clearTimeout(leaveTimer.current)
          }}
          onMouseLeave={handleLeave}
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
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
