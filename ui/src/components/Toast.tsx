import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, CheckCircle2, Info, type LucideIcon } from 'lucide-react'
import { onHostMessage } from '../bridge'
import { useStylesStore } from '../store/stylesStore'

type ToastVariant = 'success' | 'error' | 'info'

const TOAST_VARIANT: Record<ToastVariant, { className: string; Icon: LucideIcon }> = {
  success: { className: 'bg-sg-success text-white', Icon: CheckCircle2 },
  error: { className: 'bg-sg-danger text-white', Icon: AlertCircle },
  info: { className: 'bg-sg-info text-white', Icon: Info },
}

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
    <div
      aria-live="polite"
      className="absolute inset-x-0 bottom-3 z-[99999] flex flex-col items-center gap-2
                    px-4 pointer-events-none"
    >
      <AnimatePresence>
        {toasts.map(toast => {
          const { className, Icon } = TOAST_VARIANT[toast.variant]
          return (
            <motion.div
              key={toast.id}
              role={toast.variant === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.2 }}
              className={`flex max-w-full items-center gap-2 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium
              pointer-events-auto ${className}`}
            >
              <Icon size={16} aria-hidden="true" />
              {toast.message}
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
