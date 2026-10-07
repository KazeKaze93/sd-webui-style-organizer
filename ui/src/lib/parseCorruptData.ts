/** Parse backend corrupt_data / HTTP 409 payloads for presets.json failures. */

export type CorruptDataInfo = {
  path: string
  bakPath: string
  message: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function fromPayload(payload: Record<string, unknown>): CorruptDataInfo | null {
  if (payload.error !== 'corrupt_data') return null
  const path = typeof payload.path === 'string' && payload.path ? payload.path : 'presets.json'
  const bakPath =
    typeof payload.bak_path === 'string' && payload.bak_path
      ? payload.bak_path
      : `${path}.bak`
  const message =
    typeof payload.message === 'string' && payload.message
      ? payload.message
      : 'presets.json is corrupt'
  return { path, bakPath, message }
}

/**
 * Detect corrupt_data from a fetch Response + parsed JSON body.
 * Handles:
 * - HTTP 409 with `{ error, path, bak_path, message }` (Comfy)
 * - HTTP 409 with `{ detail: { error, ... } }` (FastAPI HTTPException)
 * - HTTP 200 with `{ error: "corrupt_data", ... }` (logical failure body)
 */
export function parseCorruptData(res: Response, body: unknown): CorruptDataInfo | null {
  const root = asRecord(body)
  if (!root) return null

  const direct = fromPayload(root)
  if (direct) return direct

  const detail = asRecord(root.detail)
  if (detail) {
    const nested = fromPayload(detail)
    if (nested) return nested
  }

  if (res.status === 409) {
    return {
      path: 'presets.json',
      bakPath: 'presets.json.bak',
      message: 'presets.json is corrupt (HTTP 409)',
    }
  }
  return null
}
