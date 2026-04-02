/** Messages sent from Forge host script to the React iframe. */
export type HostMessage =
  | { type: 'SG_CLEAR_SELECTION' }
  | { type: 'SG_INIT';           tab: Tab; styles: Style[] }
  | { type: 'SG_HOST_TAB';       tab: Tab }
  | { type: 'SG_STYLES_UPDATE';  styles: Style[] }
  | { type: 'SG_TOAST'; message: string; variant: 'success' | 'error' | 'info' }
  | { type: 'SG_STYLE_APPLIED'; style: Style }
  | { type: 'SG_THUMB_DONE';     styleId: string; version: number }
  | { type: 'SG_THUMB_PROGRESS'; status: string; styleId: string; progress?: number }
  | { type: 'SG_PROMPT_CHANGED'; prompt: string; neg: string }
  | { type: 'SG_CLOSE' }

/** Messages sent from the React iframe back to Forge host script. */
export type FrameMessage =
  | { type: 'SG_READY' }
  | { type: 'SG_APPLY';         styleId: string; prompt: string; neg: string; silent?: boolean }
  | { type: 'SG_UNAPPLY';       styleId: string }
  | { type: 'SG_EDIT_STYLE';      styleId: string }
  | { type: 'SG_DUPLICATE_STYLE'; styleId: string }
  | { type: 'SG_MOVE_TO_CATEGORY'; styleId: string }
  | { type: 'SG_GENERATE_PREVIEW'; styleId: string }
  | { type: 'SG_UPLOAD_PREVIEW';   styleId: string }
  | { type: 'SG_WILDCARD_CATEGORY'; category: string }
  | { type: 'SG_GENERATE_CATEGORY_PREVIEWS'; category: string; missingCount: number; source?: string }
  | { type: 'SG_REORDER_STYLES'; styleIds: string[] }
  | { type: 'SG_DELETE_STYLE';  styleId: string }
  | { type: 'SG_CLOSE_REQUEST' }
  | { type: 'SG_RANDOM' }
  | { type: 'SG_PRESETS' }
  | { type: 'SG_BACKUP' }
  | { type: 'SG_IMPORT_EXPORT' }
  | { type: 'SG_NEW_STYLE'; sourceFile?: string }
  | { type: 'SG_CSV_EDITOR' }
  | { type: 'SG_CLEAR_ALL' }
  | { type: 'SG_SOURCE_CHANGE'; source: string | null }
  | { type: 'SG_TOGGLE_SILENT'; tab: Tab; value: boolean }

// ── Shared types ──────────────────────────────────────────────
export type Tab = 'txt2img' | 'img2img'

export interface Style {
  name:              string
  prompt:            string
  negative_prompt:   string
  description:       string
  category:          string
  source_file:       string
  has_thumbnail:     boolean
}

/** Posts one typed bridge message to the Forge host window. */
export function sendToHost(msg: FrameMessage): void {
  window.parent.postMessage(msg, '*')
}

/**
 * Subscribes to host postMessage events and returns an unsubscribe cleanup.
 */
export function onHostMessage(
  handler: (msg: HostMessage) => void
): () => void {
  const listener = (e: MessageEvent) => {
    if (e.data && typeof e.data.type === 'string') handler(e.data)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
