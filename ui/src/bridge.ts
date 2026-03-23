// ── Message types: Host (Forge) → Frame (React app) ──────────
export type HostMessage =
  | { type: 'SG_INIT';           tab: Tab; styles: Style[] }
  | { type: 'SG_STYLES_UPDATE';  styles: Style[] }
  | { type: 'SG_PROMPT_CHANGED'; prompt: string; neg: string }
  | { type: 'SG_CLOSE' }

// ── Message types: Frame (React app) → Host (Forge) ──────────
export type FrameMessage =
  | { type: 'SG_READY' }
  | { type: 'SG_APPLY';         styleId: string; prompt: string; neg: string; silent?: boolean }
  | { type: 'SG_UNAPPLY';       styleId: string }
  | { type: 'SG_SAVE_STYLE';    style: Style }
  | { type: 'SG_EDIT_STYLE';      styleId: string }
  | { type: 'SG_DUPLICATE_STYLE'; styleId: string }
  | { type: 'SG_MOVE_TO_CATEGORY'; styleId: string }
  | { type: 'SG_GENERATE_PREVIEW'; styleId: string }
  | { type: 'SG_UPLOAD_PREVIEW';   styleId: string }
  | { type: 'SG_DELETE_STYLE';  styleId: string }
  | { type: 'SG_REQUEST_STYLES' }
  | { type: 'SG_CLOSE_REQUEST' }
  | { type: 'SG_RANDOM' }
  | { type: 'SG_PRESETS' }
  | { type: 'SG_BACKUP' }
  | { type: 'SG_IMPORT_EXPORT' }
  | { type: 'SG_REFRESH' }
  | { type: 'SG_NEW_STYLE' }

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

// ── Send to host ──────────────────────────────────────────────
export function sendToHost(msg: FrameMessage): void {
  window.parent.postMessage(msg, '*')
}

// ── Listen from host ──────────────────────────────────────────
export function onHostMessage(
  handler: (msg: HostMessage) => void
): () => void {
  const listener = (e: MessageEvent) => {
    if (e.data && typeof e.data.type === 'string') handler(e.data)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
