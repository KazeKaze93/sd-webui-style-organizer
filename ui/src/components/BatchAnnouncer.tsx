import { useEffect, useRef, useState } from 'react'
import { batchHeaderText, batchStartAnnouncement, isBatchFinal } from '../lib/previewProgress'
import { usePreviewBatch } from '../store/stylesStore'

/**
 * The one live region for category batch previews: start, finish and cancel.
 * Counter ticks are not announced; the header and footer lines are not live.
 */
export function BatchAnnouncer() {
  const batch = usePreviewBatch()
  const [text, setText] = useState('')
  const last = useRef<{ seq: number; final: boolean } | null>(null)

  useEffect(() => {
    if (!batch) return
    const final = isBatchFinal(batch)
    const prev = last.current
    last.current = { seq: batch.seq, final }
    if (!prev || prev.seq !== batch.seq) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- announce a store transition
      setText(final ? `${batch.category}: ${batchHeaderText(batch)}` : batchStartAnnouncement(batch))
      return
    }
    if (final && !prev.final) setText(`${batch.category}: ${batchHeaderText(batch)}`)
  }, [batch])

  return (
    <div role="status" aria-live="polite" className="sr-only" data-sg-batch-announcer="true">
      {text}
    </div>
  )
}
