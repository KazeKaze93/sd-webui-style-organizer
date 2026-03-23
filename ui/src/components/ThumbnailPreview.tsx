import { useEffect, useRef, useState } from 'react'
import { onHostMessage, type Style } from '../bridge'

interface Props {
  style: Style
  children: React.ReactNode
}

export function ThumbnailPreview({ style, children }: Props) {
  const [visible, setVisible] = useState(false)
  const [imgOk, setImgOk] = useState(false)
  const [above, setAbove] = useState(true)
  const [localVersion, setLocalVersion] = useState(
    localStorage.getItem(`sg_thumb_v_${style.name}`) || '1'
  )
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const thumbUrl = `/style_grid/thumbnail?name=${
    encodeURIComponent(style.name)
  }&v=${localVersion}`

  const handleEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    enterTimer.current = setTimeout(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setAbove(rect.top > 200)
      }
      setVisible(true)
    }, 300)
  }

  const handleLeave = () => {
    if (enterTimer.current) clearTimeout(enterTimer.current)
    leaveTimer.current = setTimeout(() => {
      setVisible(false)
      setImgOk(false)
    }, 100)
  }

  const displayName = style.name.includes('_')
    ? style.name.split('_').slice(1).join(' ')
    : style.name

  useEffect(() => {
    const unsub = onHostMessage((msg) => {
      if (msg.type === 'SG_THUMB_DONE' && msg.styleId === style.name) {
        const v = String(msg.version)
        localStorage.setItem(
          `sg_thumb_v_${style.name}`,
          v
        )
        setLocalVersion(v)
        setImgOk(false)
      }
    })
    return unsub
  }, [style.name])

  return (
    <div
      className="relative"
      ref={containerRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}

      {visible && (
        <div
          className={`absolute z-50 ${above
            ? 'bottom-full mb-2'
            : 'top-full mt-2'} left-1/2 -translate-x-1/2`}
          onMouseEnter={() => {
            if (enterTimer.current) clearTimeout(enterTimer.current)
            if (leaveTimer.current) clearTimeout(leaveTimer.current)
          }}
          onMouseLeave={handleLeave}
          style={{ minWidth: '200px', maxWidth: '280px' }}
        >
          <div className="bg-[#0f172a] border border-sg-border rounded-lg 
                          shadow-xl overflow-hidden">
            <img
              src={thumbUrl}
              alt=""
              className={`w-full object-cover transition-opacity
                ${imgOk ? 'opacity-100' : 'hidden'}`}
              style={{ maxHeight: '160px' }}
              onLoad={() => setImgOk(true)}
              onError={() => setImgOk(false)}
            />
            <div className="px-2.5 py-2">
              <div className="text-sm font-semibold text-white truncate">
                {displayName}
              </div>
              {style.prompt && (
                <div className="text-xs text-slate-400 mt-1 line-clamp-3 
                                leading-relaxed">
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
        </div>
      )}
    </div>
  )
}
