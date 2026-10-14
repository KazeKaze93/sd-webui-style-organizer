import type { ThemeMode } from './lib/themeMode'

// ── Shared types ──────────────────────────────────────────────
export type Tab = 'txt2img' | 'img2img'

export type WildcardKind = 'sg' | 'sgd'
export const WILDCARD_KIND_DICE: WildcardKind = 'sg'
export const WILDCARD_KIND_DECK: WildcardKind = 'sgd'

/** Category + optional slice spec for `{sg|sgd:category}` / `{sg|sgd:category:spec}` tokens. */
export interface WildcardRef {
  category: string
  spec: string
  /** Absent or `'sg'` = dice; `'sgd'` = deck (without replacement). */
  kind?: WildcardKind
}

/** Messages sent from Forge host script to the React iframe. */
export type HostMessage =
  | { type: 'SG_CLEAR_SELECTION' }
  | { type: 'SG_INIT';           tab: Tab; styles: Style[] }
  | { type: 'SG_HOST_TAB';       tab: Tab }
  | { type: 'SG_STYLES_UPDATE';  styles: Style[] }
  | { type: 'SG_WILDCARDS_ACTIVE'; categories: WildcardRef[] }
  | { type: 'SG_TOAST'; message: string; variant: 'success' | 'error' | 'info' }
  | { type: 'SG_STYLE_APPLIED'; style: Style }
  | { type: 'SG_THUMB_DONE';     styleId: string; version: number; source_file: string }
  | { type: 'SG_THUMB_PROGRESS'; status: string; styleId: string; progress?: number }
  | { type: 'SG_PROMPT_CHANGED'; prompt: string; neg: string }
  | { type: 'SG_CLOSE' }
  | { type: 'SG_THEME'; mode: ThemeMode }

/** Messages sent from the React iframe back to Forge host script. */
export type FrameMessage =
  | { type: 'SG_READY' }
  | { type: 'SG_APPLY';         styleId: string; prompt: string; neg: string; source_file: string }
  | { type: 'SG_UNAPPLY';       styleId: string; source_file?: string }
  | { type: 'SG_EDIT_STYLE';      styleId: string; source_file?: string }
  | { type: 'SG_DUPLICATE_STYLE'; styleId: string; source_file?: string }
  | { type: 'SG_MOVE_TO_CATEGORY'; styleId: string; source_file?: string }
  | { type: 'SG_GENERATE_PREVIEW'; styleId: string; source: string }
  | { type: 'SG_UPLOAD_PREVIEW';   styleId: string; source: string }
  | { type: 'SG_WILDCARD_CATEGORY'; category: string; kind?: WildcardKind }
  | { type: 'SG_WILDCARD_SLICE'; category: string; spec: string; kind?: WildcardKind }
  | { type: 'SG_REMOVE_WILDCARD'; category: string; spec: string; kind?: WildcardKind }
  | { type: 'SG_GENERATE_CATEGORY_PREVIEWS'; category: string; missingCount: number; source?: string }
  | { type: 'SG_REORDER_STYLES'; styleIds: string[] }
  | { type: 'SG_REORDER_WILDCARDS'; categories: WildcardRef[] }
  | { type: 'SG_DELETE_STYLE';  styleId: string; source_file?: string }
  | { type: 'SG_CLOSE_REQUEST' }
  | { type: 'SG_BACKUP' }
  | { type: 'SG_IMPORT_EXPORT' }
  | { type: 'SG_NEW_STYLE'; sourceFile?: string }
  | { type: 'SG_CLEAR_ALL' }
  | { type: 'SG_SOURCE_CHANGE'; source: string | null }
  | { type: 'SG_REFRESH' }

export interface Style {
  name:              string
  prompt:            string
  negative_prompt:   string
  description:       string
  category:          string
  source_file:       string
  has_thumbnail:     boolean
  read_only?:        boolean
  /** Backend-supplied override for the card label (e.g. the real CivitAI
   * title for a LoRA, fetched via /style_grid/lora/fetch_titles). Falls
   * back to the name-derived display when absent. */
  display_name?:     string
}

function bridgeOrigin(): string {
  return window.location.origin
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isTab(value: unknown): value is Tab {
  return value === 'txt2img' || value === 'img2img'
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

function isToastVariant(value: unknown): value is 'success' | 'error' | 'info' {
  return value === 'success' || value === 'error' || value === 'info'
}

/**
 * Runtime guard for host → iframe HostMessage shapes (SG_*).
 * Unknown types and malformed payloads return null.
 */
export function parseHostMessage(data: unknown): HostMessage | null {
  if (!isRecord(data)) return null
  const type = data.type
  if (typeof type !== 'string' || !type.startsWith('SG_')) return null

  switch (type) {
    case 'SG_CLEAR_SELECTION':
    case 'SG_CLOSE':
      return { type }

    case 'SG_THEME':
      if (!isThemeMode(data.mode)) return null
      return { type, mode: data.mode }

    case 'SG_INIT':
      if (!isTab(data.tab)) return null
      if (!Array.isArray(data.styles)) return null
      return { type, tab: data.tab, styles: data.styles as Style[] }

    case 'SG_HOST_TAB':
      if (!isTab(data.tab)) return null
      return { type, tab: data.tab }

    case 'SG_STYLES_UPDATE':
      if (!Array.isArray(data.styles)) return null
      return { type, styles: data.styles as Style[] }

    case 'SG_WILDCARDS_ACTIVE':
      if (!Array.isArray(data.categories)) return null
      return { type, categories: data.categories as WildcardRef[] }

    case 'SG_TOAST':
      if (typeof data.message !== 'string') return null
      if (!isToastVariant(data.variant)) return null
      return { type, message: data.message, variant: data.variant }

    case 'SG_STYLE_APPLIED':
      if (!isRecord(data.style)) return null
      return { type, style: data.style as unknown as Style }

    case 'SG_THUMB_DONE':
      if (typeof data.styleId !== 'string' || !data.styleId) return null
      if (typeof data.version !== 'number') return null
      if (typeof data.source_file !== 'string') return null
      return {
        type,
        styleId: data.styleId,
        version: data.version,
        source_file: data.source_file,
      }

    case 'SG_THUMB_PROGRESS':
      if (typeof data.status !== 'string') return null
      if (typeof data.styleId !== 'string') return null
      if (data.progress !== undefined && typeof data.progress !== 'number') return null
      return {
        type,
        status: data.status,
        styleId: data.styleId,
        progress: data.progress,
      }

    case 'SG_PROMPT_CHANGED':
      if (typeof data.prompt !== 'string') return null
      if (typeof data.neg !== 'string') return null
      return { type, prompt: data.prompt, neg: data.neg }

    default:
      return null
  }
}

/** True when the event is same-origin and from the parent (host) window. */
export function isTrustedHostEvent(event: MessageEvent): boolean {
  if (event.origin !== bridgeOrigin()) return false
  if (event.source !== window.parent) return false
  return true
}

/** Posts one typed bridge message to the Forge host window. */
export function sendToHost(msg: FrameMessage): void {
  window.parent.postMessage(msg, bridgeOrigin())
}

/**
 * Subscribes to host postMessage events and returns an unsubscribe cleanup.
 * Foreign origin, wrong source, unknown types, and malformed payloads are ignored.
 */
export function onHostMessage(
  handler: (msg: HostMessage) => void
): () => void {
  const listener = (e: MessageEvent) => {
    if (!isTrustedHostEvent(e)) return
    const msg = parseHostMessage(e.data)
    if (!msg) return
    handler(msg)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
