/** Short name of a style source, as the source filter shows it: file name without folders or ".csv". */
export function sourceLabel(src: string): string {
  const normalized = src.replace(/\\/g, '/')
  const base = normalized.split('/').pop() || src
  return base.replace(/\.csv$/i, '')
}
