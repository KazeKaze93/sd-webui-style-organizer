import { describe, expect, it } from 'vitest'
import { thumbnailUrl } from './thumbnailUrl'

/** The string ThumbnailPreview built inline before thumbnailUrl() existed. */
function legacyUrl(name: string, sourceFile: string, activeSource: string | null, version: string) {
  const sourceForThumb = sourceFile || activeSource || ''
  return `/style_grid/thumbnail?name=${encodeURIComponent(name)}${
    sourceForThumb ? `&source=${encodeURIComponent(sourceForThumb)}` : ''
  }&v=${version}`
}

describe('thumbnailUrl', () => {
  it('style with its own source', () => {
    expect(thumbnailUrl({ name: 'BODY_Tall Amazon', source_file: 'webui/styles a.csv' }, null, '7')).toBe(
      '/style_grid/thumbnail?name=BODY_Tall%20Amazon&source=webui%2Fstyles%20a.csv&v=7',
    )
  })

  it('style without a source falls back to the active source, then to none', () => {
    expect(thumbnailUrl({ name: 'X', source_file: '' }, 'styles/b.csv', '1')).toBe(
      '/style_grid/thumbnail?name=X&source=styles%2Fb.csv&v=1',
    )
    expect(thumbnailUrl({ name: 'X', source_file: '' }, null, '1')).toBe('/style_grid/thumbnail?name=X&v=1')
  })

  it.each([
    ['BODY_A', 'webui/a.csv', null, '1'],
    ['LORA_x', '__style_grid_lora__', 'webui/a.csv', '1700000000000'],
    ['名前&?#', '', 'styles/ü.csv', '3'],
    ['plain', '', null, '1'],
  ] as const)('matches the old inline URL for %s', (name, source, active, version) => {
    expect(thumbnailUrl({ name, source_file: source }, active, version)).toBe(legacyUrl(name, source, active, version))
  })
})
