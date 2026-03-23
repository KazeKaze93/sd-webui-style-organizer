import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { onHostMessage } from '../bridge'
import { useStylesStore } from '../store/stylesStore'

export function Toast() {
  const toasts = useStylesStore(s => s.toasts)
  const showToast = useStylesStore(s => s.showToast)

  useEffect(() => {
    const unsub = onHostMessage((msg) => {
      if (msg.type === 'SG_TOAST') {
        showToast(msg.message, msg.variant)
      }
    })
    return unsub
  }, [showToast])

  return (
    <div className="fixed top-4 right-4 z-[99999] flex flex-col gap-2 
                    pointer-events-none">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            transition={{ duration: 0.2 }}
            className={`px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium
              pointer-events-auto
              ${toast.variant === 'success' ? 'bg-green-500/90 text-white' : ''}
              ${toast.variant === 'error' ? 'bg-red-500/90 text-white' : ''}
              ${toast.variant === 'info' ? 'bg-sg-accent/90 text-white' : ''}`}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
