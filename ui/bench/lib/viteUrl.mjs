/**
 * Vite prints its "Local:" line with ANSI color codes when stdout looks like a
 * color terminal (e.g. `➜  \x1b[1mLocal\x1b[22m:   http://127.0.0.1:\x1b[1m5176\x1b[22m/`),
 * which breaks a plain `Local:\s+http://…` match. Strip the codes first instead
 * of depending on NO_COLOR being set.
 */
export const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g

/**
 * The dev/preview server URL from Vite's output, without a trailing slash, or
 * null while the "Local:" line has not been printed yet.
 *
 * @param {string} text accumulated stdout + stderr
 * @returns {string | null}
 */
export function parseViteLocalUrl(text) {
  const m = text.replace(ANSI_ESCAPE_RE, '').match(/Local:\s+(http:\/\/[^\s]+)/i)
  return m ? m[1].replace(/\/$/, '') : null
}
