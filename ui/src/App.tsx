import { useEffect, useState } from 'react'
import { onHostMessage, sendToHost, type Style } from './bridge'

export default function App() {
  const [styles, setStyles] = useState<Style[]>([])
  const [status, setStatus] = useState('Waiting for host...')

  useEffect(() => {
    const unsub = onHostMessage((msg) => {
      if (msg.type === 'SG_INIT' || msg.type === 'SG_STYLES_UPDATE') {
        const arr = Array.isArray(msg.styles)
          ? msg.styles
          : (msg.styles as any)?.styles ?? []
        setStyles(arr)
        setStatus(`✓ Connected — ${arr.length} styles loaded`)
      }
    })
    sendToHost({ type: 'SG_READY' })
    return unsub
  }, [])

  return (
    <div className="min-h-screen bg-sg-bg text-sg-text p-6 font-mono">
      <h1 className="text-2xl text-sg-accent mb-4">Style Grid v2</h1>
      <p className="text-sg-muted mb-6">{status}</p>
      <div className="grid grid-cols-3 gap-2">
        {styles.slice(0, 9).map(s => (
          <div key={s.name}
            className="bg-sg-surface border border-sg-border rounded-lg p-3
                       hover:border-sg-accent cursor-pointer transition-colors">
            <div className="text-sm font-medium">{s.name}</div>
            <div className="text-xs text-sg-muted mt-1">{s.category}</div>
          </div>
        ))}
      </div>
      {styles.length === 0 && (
        <div className="text-sg-muted text-sm">
          No styles received yet. Check host bridge.
        </div>
      )}
    </div>
  )
}
