import { useId } from 'react'

type Props = {
  className?: string
}

const DEFAULT_CLASS = 'h-4 w-4 inline-block align-text-bottom shrink-0'

const VIEW_BOX = '0 0 24 24'
const VIEW_SIZE = 24
const ICON_STROKE_WIDTH = 1.8
const CUT_STROKE_WIDTH = 3.6
const FAN_PIVOT = '12 20'
const FAN_ANGLE = 20
const CARD = { x: 7, y: 5, width: 10, height: 14, rx: 2 } as const

export function DeckIcon({ className = DEFAULT_CLASS }: Props) {
  const uid = useId().replace(/:/g, '')
  const backMaskId = `sg-deck-back-${uid}`
  const midMaskId = `sg-deck-mid-${uid}`

  return (
    <svg
      className={className}
      viewBox={VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE_WIDTH}
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask
          id={backMaskId}
          maskUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={VIEW_SIZE}
          height={VIEW_SIZE}
        >
          <rect width={VIEW_SIZE} height={VIEW_SIZE} fill="white" stroke="none" />
          <rect {...CARD} fill="black" stroke="black" strokeWidth={CUT_STROKE_WIDTH} />
          <rect
            {...CARD}
            transform={`rotate(${FAN_ANGLE} ${FAN_PIVOT})`}
            fill="black"
            stroke="black"
            strokeWidth={CUT_STROKE_WIDTH}
          />
        </mask>
        <mask
          id={midMaskId}
          maskUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={VIEW_SIZE}
          height={VIEW_SIZE}
        >
          <rect width={VIEW_SIZE} height={VIEW_SIZE} fill="white" stroke="none" />
          <rect
            {...CARD}
            transform={`rotate(${FAN_ANGLE} ${FAN_PIVOT})`}
            fill="black"
            stroke="black"
            strokeWidth={CUT_STROKE_WIDTH}
          />
        </mask>
      </defs>
      <g mask={`url(#${backMaskId})`}>
        <rect {...CARD} transform={`rotate(${-FAN_ANGLE} ${FAN_PIVOT})`} />
      </g>
      <g mask={`url(#${midMaskId})`}>
        <rect {...CARD} />
      </g>
      <rect {...CARD} transform={`rotate(${FAN_ANGLE} ${FAN_PIVOT})`} />
    </svg>
  )
}
