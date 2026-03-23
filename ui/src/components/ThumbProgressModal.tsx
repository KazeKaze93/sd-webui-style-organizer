import { useEffect, useState } from 'react'
import { onHostMessage } from '../bridge'
import { motion, AnimatePresence } from 'framer-motion'

export function ThumbProgressModal() {
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState('')
  const [styleId, setStyleId] = useState('')

  useEffect(() => {
    const unsub = onHostMessage((msg) => {
      if (msg.type === 'SG_THUMB_PROGRESS') {
        setStyleId(msg.styleId)
        if (msg.status === 'done') {
          setStatus('done')
          setVisible(true)
          setTimeout(() => setVisible(false), 2000)
          return
        }
        if (msg.status === 'error') {
          setStatus('error')
          setVisible(true)
          setTimeout(() => setVisible(false), 2000)
          return
        }
        setStatus(msg.status)
        setVisible(true)
      }
    })
    return unsub
  }, [])

  const displayName = styleId.includes('_')
    ? styleId.split('_').slice(1).join(' ')
    : styleId

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50
                     bg-sg-surface border border-sg-border rounded-lg
                     shadow-xl px-4 py-3 min-w-64"
        >
          {status === 'done' && (
            <div className="text-sm text-green-400 font-medium">
              ✓ Preview generated successfully
            </div>
          )}
          {status === 'error' && (
            <div className="text-sm text-red-400 font-medium">
              ✗ Generation failed
            </div>
          )}
          {status !== 'done' && status !== 'error' && (
            <div className="text-sm text-sg-text font-medium">
              ⟳ Generating preview...
            </div>
          )}
          <div className="text-xs text-sg-muted truncate">{displayName}</div>
          {status !== 'done' && status !== 'error' && (
            <div className="mt-2 h-1 bg-sg-border rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-sg-accent rounded-full"
                animate={{ width: ['0%', '90%'] }}
                transition={{ duration: 8, ease: 'linear' }}
              />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
