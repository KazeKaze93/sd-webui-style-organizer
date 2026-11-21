import { useRef, useState } from 'react'
import { sendToHost, type Style } from '../bridge'
import { deleteStyleRequest, sourceFileLeaf } from '../lib/styleActions'
import { cn } from '../lib/utils'
import { useStylesStore } from '../store/stylesStore'
import { ModalShell } from './ModalShell'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

type Props = {
  open: boolean
  style: Style
  displayName: string
  onClose: () => void
}

/**
 * Confirmation before deleting a style from its CSV. The iframe makes the
 * requests itself; the host is only asked to refresh afterwards, because the
 * style may be applied to the prompt fields. The refresh is quiet: the host
 * strips the deleted style's text without its "no longer in the library"
 * toast, since the user removed it on purpose.
 */
export function DeleteStyleDialog({ open, style, displayName, onClose }: Props) {
  const showToast = useStylesStore((s) => s.showToast)
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await deleteStyleRequest(style)
      if (!result.ok) {
        showToast(result.error, 'error')
        return
      }
      sendToHost({ type: 'SG_REFRESH', quiet_vanished: true })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Delete style?"
      busy={busy}
      initialFocus={cancelRef}
      widthClassName="w-[24rem]"
      footer={
        <>
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onClose}
            className={cn(
              'px-3 py-1.5 text-sm text-sg-text border border-sg-border rounded',
              'hover:bg-sg-accent/20 transition-colors',
              'disabled:opacity-45 disabled:cursor-not-allowed',
              FOCUS_RING,
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
            className={cn(
              'px-3 py-1.5 text-sm rounded bg-sg-danger text-white',
              'hover:bg-sg-danger/90 transition-colors',
              'disabled:opacity-45 disabled:cursor-not-allowed',
              FOCUS_RING,
            )}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p className="text-sm text-sg-muted leading-relaxed break-words">
        Delete &ldquo;{displayName}&rdquo; from {sourceFileLeaf(style.source_file)}? This cannot be undone.
      </p>
    </ModalShell>
  )
}
