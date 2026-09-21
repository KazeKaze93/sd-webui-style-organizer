import { describe, expect, it } from 'vitest'
import type { Style } from '../bridge'
import {
  findStyleBySourceAndName,
  parseComboPart,
  parseComboParts,
  parseComboTokens,
  resolveCombosInSourceFile,
  resolveSelectedStyleRow,
  splitOutsideParens,
} from './styleIdentity'

function row(
  name: string,
  source_file: string,
  extra: Partial<Style> = {},
): Style {
  return {
    name,
    source_file,
    prompt: extra.prompt ?? `prompt:${source_file}:${name}`,
    negative_prompt: extra.negative_prompt ?? `neg:${source_file}:${name}`,
    description: extra.description ?? '',
    category: extra.category ?? 'BODY',
    has_thumbnail: false,
  }
}

const FILE_A = 'styles_nsfw_core.csv'
const FILE_B = 'styles_wardrobe_full.csv'

describe('findStyleBySourceAndName / resolveSelectedStyleRow', () => {
  const styles = [
    row('BODY_Ears', FILE_A, { description: 'core desc. Combos: LIGHTING_Rim.', prompt: 'core-prompt' }),
    row('BODY_Ears', FILE_B, { description: 'wardrobe only', prompt: 'ward-prompt', negative_prompt: 'ward-neg' }),
  ]

  it('returns the row from the selected source file when names collide', () => {
    const hit = findStyleBySourceAndName(styles, 'BODY_Ears', FILE_B)
    expect(hit?.prompt).toBe('ward-prompt')
    expect(hit?.description).toBe('wardrobe only')
  })

  it('does not fall back to another file for the same name', () => {
    expect(findStyleBySourceAndName(styles, 'BODY_Ears', 'missing.csv')).toBeUndefined()
  })

  it('resolveSelectedStyleRow keeps selected-file description and prompts', () => {
    const selected = styles[1]
    const resolved = resolveSelectedStyleRow(styles, selected)
    expect(resolved?.source_file).toBe(FILE_B)
    expect(resolved?.description).toBe('wardrobe only')
    expect(resolved?.prompt).toBe('ward-prompt')
    expect(resolved?.negative_prompt).toBe('ward-neg')
  })
})

describe('combo part parsing', () => {
  it('strips parenthetical comment from NAME (comment)', () => {
    expect(parseComboPart('BODY_Petite_Small (size contrast)')).toEqual({
      name: 'BODY_Petite_Small',
      comment: 'size contrast',
      raw: 'BODY_Petite_Small (size contrast)',
    })
  })

  it('splits A (x) + B (y) into two parts', () => {
    const parts = parseComboParts(
      'x. Combos: EXPRESSION_Contemptuous (dom) + STATE_Crying_Tears (sub).',
    )
    expect(parts).toEqual([
      {
        name: 'EXPRESSION_Contemptuous',
        comment: 'dom',
        raw: 'EXPRESSION_Contemptuous (dom)',
      },
      {
        name: 'STATE_Crying_Tears',
        comment: 'sub',
        raw: 'STATE_Crying_Tears (sub)',
      },
    ])
  })

  it('keeps bare names without parentheses', () => {
    expect(parseComboPart('LIGHTING_Neon_Colorful')).toEqual({
      name: 'LIGHTING_Neon_Colorful',
      comment: '',
      raw: 'LIGHTING_Neon_Colorful',
    })
  })

  it('does not split on semicolon inside parentheses', () => {
    expect(splitOutsideParens('A (x; y); B', ';')).toEqual(['A (x; y)', 'B'])
    expect(parseComboTokens('t. Combos: BODY_Petite_Small (a; b); LIGHTING_Rim.')).toEqual([
      'BODY_Petite_Small (a; b)',
      'LIGHTING_Rim',
    ])
  })
})

describe('resolveCombosInSourceFile', () => {
  it('resolves Combos names only inside the same source file', () => {
    const styles = [
      row('BODY_Ears', FILE_A, {
        description: 'x. Combos: LIGHTING_Rim; MISSING_Style.',
        category: 'BODY',
      }),
      row('LIGHTING_Rim', FILE_A, { category: 'LIGHTING' }),
      row('LIGHTING_Rim', FILE_B, { category: 'LIGHTING' }),
      row('MISSING_Elsewhere', FILE_B, { category: 'BODY' }),
    ]
    const resolved = resolveCombosInSourceFile(styles[0].description, styles, FILE_A)
    expect(resolved.map((r) => r.token)).toEqual(['LIGHTING_Rim'])
    expect(resolved[0].type).toBe('style')
    if (resolved[0].type === 'style') {
      expect(resolved[0].style.source_file).toBe(FILE_A)
    }
  })

  it('resolves NAME (comment) to a style chip with comment tooltip data', () => {
    const styles = [
      row('SCENE_X', FILE_A, {
        description: 'x. Combos: BODY_Petite_Small (size contrast); LIGHTING_Neon_Colorful (UV glow).',
      }),
      row('BODY_Petite_Small', FILE_A, { category: 'BODY' }),
      row('LIGHTING_Neon_Colorful', FILE_A, { category: 'LIGHTING' }),
    ]
    const resolved = resolveCombosInSourceFile(styles[0].description, styles, FILE_A)
    expect(resolved).toEqual([
      {
        type: 'style',
        token: 'BODY_Petite_Small',
        style: styles[1],
        comment: 'size contrast',
      },
      {
        type: 'style',
        token: 'LIGHTING_Neon_Colorful',
        style: styles[2],
        comment: 'UV glow',
      },
    ])
  })

  it('resolves A (x) + B (y) as two style chips', () => {
    const styles = [
      row('SCENE_X', FILE_A, {
        description: 'x. Combos: EXPRESSION_Contemptuous (dom) + STATE_Crying_Tears (sub).',
      }),
      row('EXPRESSION_Contemptuous', FILE_A, { category: 'EXPRESSION' }),
      row('STATE_Crying_Tears', FILE_A, { category: 'STATE' }),
    ]
    const resolved = resolveCombosInSourceFile(styles[0].description, styles, FILE_A)
    expect(resolved.map((r) => ({ type: r.type, token: r.token, comment: 'comment' in r ? r.comment : '' }))).toEqual([
      { type: 'style', token: 'EXPRESSION_Contemptuous', comment: 'dom' },
      { type: 'style', token: 'STATE_Crying_Tears', comment: 'sub' },
    ])
  })

  it('omits Combos names absent from this file (no chip, no error)', () => {
    const styles = [
      row('BODY_Ears', FILE_B, { description: 'plain. Combos: ONLY_IN_CORE (hint).' }),
      row('ONLY_IN_CORE', FILE_A),
    ]
    expect(resolveCombosInSourceFile(styles[0].description, styles, FILE_B)).toEqual([])
  })

  it('keeps category chips when that category exists in the same file', () => {
    const styles = [
      row('BODY_Ears', FILE_B, { description: 'x. Combos: LIGHTING_*.' }),
      row('LIGHTING_Soft', FILE_B, { category: 'LIGHTING' }),
    ]
    const resolved = resolveCombosInSourceFile(styles[0].description, styles, FILE_B)
    expect(resolved).toEqual([
      { type: 'category', token: 'LIGHTING_*', category: 'LIGHTING', comment: '' },
    ])
  })

  it('emits raw chip only when the piece has no style name', () => {
    const styles = [
      row('BODY_Ears', FILE_A, { description: 'x. Combos: (orphan note); BODY_Ears.' }),
    ]
    const resolved = resolveCombosInSourceFile(styles[0].description, styles, FILE_A)
    expect(resolved).toEqual([
      { type: 'raw', token: '(orphan note)' },
      { type: 'style', token: 'BODY_Ears', style: styles[0], comment: '' },
    ])
  })
})

describe('identical content across files', () => {
  it('still keys by (source_file, name) when prompt/neg/description match', () => {
    const styles = [
      row('BASE_Solo', FILE_A, { prompt: 'same', negative_prompt: 'same', description: 'same' }),
      row('BASE_Solo', FILE_B, { prompt: 'same', negative_prompt: 'same', description: 'same' }),
    ]
    const a = findStyleBySourceAndName(styles, 'BASE_Solo', FILE_A)
    const b = findStyleBySourceAndName(styles, 'BASE_Solo', FILE_B)
    expect(a).toBe(styles[0])
    expect(b).toBe(styles[1])
    expect(a).not.toBe(b)
  })
})

describe('parseComboTokens', () => {
  it('splits Combos segment', () => {
    expect(parseComboTokens('Text. Combos: A; B_C.')).toEqual(['A', 'B_C'])
  })
})
