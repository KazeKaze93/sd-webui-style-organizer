/** Longest search text quoted in an empty-state title. */
export const EMPTY_QUERY_MAX_CHARS = 40

/** The search query in curly quotes, cut at EMPTY_QUERY_MAX_CHARS with "…". */
export function quoteQuery(query: string): string {
  const q = query.trim()
  return `“${q.length > EMPTY_QUERY_MAX_CHARS ? `${q.slice(0, EMPTY_QUERY_MAX_CHARS)}…` : q}”`
}
