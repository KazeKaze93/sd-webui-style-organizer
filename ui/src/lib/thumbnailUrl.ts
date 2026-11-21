import type { Style } from '../bridge'

/**
 * Thumbnail URL for a style: name, the source the image belongs to (the
 * style's own file, else the active source), and the cache-busting version.
 */
export function thumbnailUrl(
  style: Pick<Style, 'name' | 'source_file'>,
  activeSource: string | null,
  version: string,
): string {
  const source = style.source_file || activeSource || ''
  return `/style_grid/thumbnail?name=${encodeURIComponent(style.name)}${
    source ? `&source=${encodeURIComponent(source)}` : ''
  }&v=${version}`
}
