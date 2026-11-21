declare global {
  interface Window {
    __STYLE_GRID_WRITE_TOKEN__?: string
  }
}

function readWriteToken(): string {
  try {
    if (typeof window === 'undefined') return ''
    if (typeof window.__STYLE_GRID_WRITE_TOKEN__ === 'string' && window.__STYLE_GRID_WRITE_TOKEN__) {
      return window.__STYLE_GRID_WRITE_TOKEN__
    }
    if (window.parent && window.parent !== window) {
      const parentToken = window.parent.__STYLE_GRID_WRITE_TOKEN__
      if (typeof parentToken === 'string') return parentToken
    }
  } catch {
    // cross-origin parent
  }
  return ''
}

/** Headers for Style Grid mutating requests (JSON + optional session write token). */
export function styleGridWriteHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = readWriteToken()
  if (token) headers['X-StyleGrid-Token'] = token
  return headers
}

export function styleGridPost(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: styleGridWriteHeaders(),
    body: JSON.stringify(body ?? {}),
  })
}

export type ApiResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string; body: Record<string, unknown> }

/**
 * Read a Style Grid response (same rules as the host's parseApiResponse in
 * javascript/style_grid/api.js): a non-JSON body is "HTTP <status>" (or
 * "Invalid JSON in response" on 2xx); a failed status reports `error`, a
 * string `detail`, or the `detail[].msg` list. A 2xx body with an `error` is
 * a failure too: several routes report errors with HTTP 200.
 */
export async function readApiResponse(res: Response): Promise<ApiResult> {
  const text = await res.text().catch(() => '')
  let body: Record<string, unknown> = {}
  if (text) {
    try {
      const data: unknown = JSON.parse(text)
      if (data && typeof data === 'object') body = data as Record<string, unknown>
    } catch {
      return { ok: false, error: res.ok ? 'Invalid JSON in response' : `HTTP ${res.status}`, body }
    }
  }
  if (typeof body.error === 'string' && body.error) return { ok: false, error: body.error, body }
  if (res.ok) return { ok: true, body }
  if (typeof body.detail === 'string' && body.detail) return { ok: false, error: body.detail, body }
  if (Array.isArray(body.detail)) {
    const msg = body.detail
      .map((d) => (d && typeof d === 'object' && typeof (d as { msg?: unknown }).msg === 'string'
        ? (d as { msg: string }).msg
        : ''))
      .filter(Boolean)
      .join('; ')
    if (msg) return { ok: false, error: msg, body }
  }
  return { ok: false, error: `HTTP ${res.status}`, body }
}

export function styleGridDelete(url: string): Promise<Response> {
  return fetch(url, {
    method: 'DELETE',
    headers: styleGridWriteHeaders(),
  })
}
