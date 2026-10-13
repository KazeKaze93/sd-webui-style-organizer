import { useEffect, useId, useRef } from 'react'

type LayerEntry = {
  id: string
  close: () => void
}

const stack: LayerEntry[] = []

/** Push a dismissible overlay layer. Returns unregister (safe if already closed). */
export function registerLayer(id: string, close: () => void): () => void {
  const entry: LayerEntry = { id, close }
  stack.push(entry)
  return () => {
    const index = stack.indexOf(entry)
    if (index >= 0) stack.splice(index, 1)
  }
}

/** Close the topmost registered layer (LIFO). True if a layer was closed. */
export function closeTopLayer(): boolean {
  const top = stack.pop()
  if (!top) return false
  top.close()
  return true
}

export function hasOpenLayer(): boolean {
  return stack.length > 0
}

/** Test helper — clears the stack between cases. */
export function __resetLayerStackForTests(): void {
  stack.length = 0
}

/**
 * While `open` is true, registers this surface on the layer stack.
 * Cleanup on close / unmount unregisters without calling `close`.
 */
export function useLayer(open: boolean, close: () => void): void {
  const id = useId()
  const closeRef = useRef(close)

  useEffect(() => {
    closeRef.current = close
  })

  useEffect(() => {
    if (!open) return
    return registerLayer(id, () => {
      closeRef.current()
    })
  }, [open, id])
}
