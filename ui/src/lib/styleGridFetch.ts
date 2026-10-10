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

export function styleGridDelete(url: string): Promise<Response> {
  return fetch(url, {
    method: 'DELETE',
    headers: styleGridWriteHeaders(),
  })
}
