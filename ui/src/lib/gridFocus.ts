import { useSyncExternalStore } from 'react'
import type { GridCell } from './gridNav'

type Listener = () => void

let focusedCell: GridCell | null = null
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getFocusedCell(): GridCell | null {
  return focusedCell
}

export function setFocusedCell(cell: GridCell | null): void {
  if (
    focusedCell === cell ||
    (focusedCell !== null &&
      cell !== null &&
      focusedCell.row === cell.row &&
      focusedCell.col === cell.col)
  ) {
    return
  }
  focusedCell = cell
  emit()
}

/** Module-level focus store for K-GRID (read/write without React). */
export const gridFocusStore = {
  get focusedCell(): GridCell | null {
    return focusedCell
  },
  setFocusedCell,
}

/** Narrow selector — re-renders only when `focusedCell` identity/value changes. */
export function useFocusedCell(): GridCell | null {
  return useSyncExternalStore(subscribe, getFocusedCell, getFocusedCell)
}

/** Test helper — clear focus between cases. */
export function __resetGridFocusForTests(): void {
  focusedCell = null
  emit()
}
