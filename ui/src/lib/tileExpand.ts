import { useSyncExternalStore } from 'react'

/** Marker set on the source tile while its name is expanded (turns its hover scale off). */
export const TILE_EXPANDED_ATTR = 'data-sg-expanded'

/** A truncated grid tile whose full name the overlay shows (measured when shown). */
export type TileExpandEntry = {
  row: number
  col: number
  styleKey: string
  /** Full name width, unscaled CSS px. */
  textWidth: number
  /** Tile width outside the name (border, paddings, right indicator space). */
  chrome: number
  /** Draw the tile's focus ring on the overlay. */
  ring: boolean
  tile: HTMLElement
}

export type ExpandedTile = TileExpandEntry & { source: 'hover' | 'focus' }

type Listener = () => void

/** Card under the pointer (truncated or not): while set, hover decides what is expanded. */
let hoverTile: HTMLElement | null = null
let hoverEntry: TileExpandEntry | null = null
let focusEntry: TileExpandEntry | null = null
let shownEntry: TileExpandEntry | null = null
let shown: ExpandedTile | null = null
const listeners = new Set<Listener>()

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** One expanded tile at a time: hover wins over keyboard focus. */
function update(): void {
  const entry = hoverTile ? hoverEntry : focusEntry
  const source = hoverTile ? 'hover' : 'focus'
  if (entry === shownEntry && (entry === null || shown?.source === source)) return
  if (shown && shown.tile !== entry?.tile) shown.tile.removeAttribute(TILE_EXPANDED_ATTR)
  if (entry) entry.tile.setAttribute(TILE_EXPANDED_ATTR, 'true')
  shownEntry = entry
  shown = entry ? { ...entry, source } : null
  for (const listener of listeners) listener()
}

export function getHoverTile(): HTMLElement | null {
  return hoverTile
}

/** Pointer is over `tile`; `entry` is null when its name fits (nothing to expand). */
export function setTileHover(tile: HTMLElement, entry: TileExpandEntry | null): void {
  hoverTile = tile
  hoverEntry = entry
  update()
}

export function clearTileHover(): void {
  hoverTile = null
  hoverEntry = null
  update()
}

/** Keyboard focus on a tile (null: focus that does not expand). */
export function setTileFocus(entry: TileExpandEntry | null): void {
  focusEntry = entry
  update()
}

/** Focus left `tile`: drop its keyboard expansion. */
export function clearTileFocus(tile: Element): void {
  if (focusEntry?.tile !== tile) return
  focusEntry = null
  update()
}

export function clearTileExpand(): void {
  hoverTile = null
  hoverEntry = null
  focusEntry = null
  update()
}

export function getExpandedTile(): ExpandedTile | null {
  return shown
}

export function useExpandedTile(): ExpandedTile | null {
  return useSyncExternalStore(subscribe, getExpandedTile, getExpandedTile)
}

/** Test helper. */
export function __resetTileExpandForTests(): void {
  clearTileExpand()
}
