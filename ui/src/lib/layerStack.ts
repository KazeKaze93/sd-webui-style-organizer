import { useEffect, useId, useRef } from 'react'

/** Return false to refuse (e.g. a busy dialog): the layer stays on the stack. */
type LayerClose = () => void | boolean

type LayerEntry = {
  id: string
  close: LayerClose
}

const stack: LayerEntry[] = []

/** Push a dismissible overlay layer. Returns unregister (safe if already closed). */
export function registerLayer(id: string, close: LayerClose): () => void {
  const entry: LayerEntry = { id, close }
  stack.push(entry)
  return () => {
    const index = stack.indexOf(entry)
    if (index >= 0) stack.splice(index, 1)
  }
}

/**
 * Ask the topmost registered layer to close (LIFO). True if a layer handled
 * the request, including one that refused: the key press is still its own.
 */
export function closeTopLayer(): boolean {
  const top = stack.pop()
  if (!top) return false
  if (top.close() === false) stack.push(top)
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
export function useLayer(open: boolean, close: LayerClose): void {
  const id = useId()
  const closeRef = useRef(close)

  useEffect(() => {
    closeRef.current = close
  })

  useEffect(() => {
    if (!open) return
    return registerLayer(id, () => closeRef.current())
  }, [open, id])
}
