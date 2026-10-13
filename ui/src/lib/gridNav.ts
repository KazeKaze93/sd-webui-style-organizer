import type { GridRow } from '../components/grid/buildGridRows'

export type GridCell = { row: number; col: number }

export type GridNavKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'

/** Focusable cells in a virtualizer row: cards = styles; header = collapse + select-all. */
export function cellCount(row: GridRow): number {
  return row.kind === 'header' ? 2 : row.styles.length
}

function clampColForRow(row: GridRow, col: number): number {
  const count = cellCount(row)
  if (count <= 0) return 0
  if (row.kind === 'header') {
    // Header: col 0 = collapse; any col >= 1 → select all (index 1).
    return col >= 1 ? 1 : 0
  }
  return Math.max(0, Math.min(col, count - 1))
}

function cellsEqual(a: GridCell, b: GridCell): boolean {
  return a.row === b.row && a.col === b.col
}

function firstCell(rows: readonly GridRow[]): GridCell | null {
  for (let row = 0; row < rows.length; row++) {
    if (cellCount(rows[row]) > 0) return { row, col: 0 }
  }
  return null
}

function lastCell(rows: readonly GridRow[]): GridCell | null {
  for (let row = rows.length - 1; row >= 0; row--) {
    const count = cellCount(rows[row])
    if (count > 0) return { row, col: count - 1 }
  }
  return null
}

/**
 * Pure grid keyboard navigation.
 * Left/Right stay in-row and stop at ends (null).
 * Up/Down keep column, clamped / mapped for header cells.
 * Home/End = row ends; Ctrl+Home/End = grid ends; Page* moves by `pageRows`.
 */
export function nextCell(
  rows: readonly GridRow[],
  columns: number,
  from: GridCell,
  key: GridNavKey,
  pageRows: number,
  ctrl: boolean,
): GridCell | null {
  void columns
  if (rows.length === 0) return null
  if (from.row < 0 || from.row >= rows.length) return null

  const currentRow = rows[from.row]
  const count = cellCount(currentRow)
  if (count <= 0) return null

  const fromCol = clampColForRow(currentRow, from.col)
  const origin: GridCell = { row: from.row, col: fromCol }

  let next: GridCell | null = null

  switch (key) {
    case 'ArrowLeft': {
      if (fromCol <= 0) return null
      next = { row: from.row, col: fromCol - 1 }
      break
    }
    case 'ArrowRight': {
      if (fromCol >= count - 1) return null
      next = { row: from.row, col: fromCol + 1 }
      break
    }
    case 'ArrowUp': {
      if (from.row <= 0) return null
      const targetRow = from.row - 1
      next = {
        row: targetRow,
        col: clampColForRow(rows[targetRow], fromCol),
      }
      break
    }
    case 'ArrowDown': {
      if (from.row >= rows.length - 1) return null
      const targetRow = from.row + 1
      next = {
        row: targetRow,
        col: clampColForRow(rows[targetRow], fromCol),
      }
      break
    }
    case 'Home': {
      if (ctrl) {
        next = firstCell(rows)
      } else {
        next = { row: from.row, col: 0 }
      }
      break
    }
    case 'End': {
      if (ctrl) {
        next = lastCell(rows)
      } else {
        next = { row: from.row, col: count - 1 }
      }
      break
    }
    case 'PageUp': {
      const step = Math.max(1, Math.floor(pageRows) || 1)
      const targetRow = Math.max(0, from.row - step)
      next = {
        row: targetRow,
        col: clampColForRow(rows[targetRow], fromCol),
      }
      break
    }
    case 'PageDown': {
      const step = Math.max(1, Math.floor(pageRows) || 1)
      const targetRow = Math.min(rows.length - 1, from.row + step)
      next = {
        row: targetRow,
        col: clampColForRow(rows[targetRow], fromCol),
      }
      break
    }
    default:
      return null
  }

  if (!next) return null
  if (cellsEqual(next, origin)) return null
  return next
}
