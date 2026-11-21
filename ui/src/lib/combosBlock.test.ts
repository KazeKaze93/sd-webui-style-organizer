import { describe, expect, it } from 'vitest'
import {
  addBlockElement,
  blockList,
  buildDescription,
  joinCombos,
  parseBlock,
  removeBlockElement,
  splitCombos,
} from './combosBlock'
import { parseComboTokens } from './styleIdentity'

// --- split / join (docs/CSV_FORMAT.md "Recommended Combos") ---

describe('splitCombos: the block is "Combos:" up to the first period, anywhere', () => {
  it.each([
    // label, raw, before, block, after
    ['no block', 'Just text.', 'Just text.', '', ''],
    ['block only', 'Combos: BODY_A; POSE_B.', '', 'Combos: BODY_A; POSE_B.', ''],
    ['block at the end', 'X. Combos: A; B.', 'X.', 'Combos: A; B.', ''],
    ['followed by Conflicts', 'X. Combos: A; B. Conflicts: C.', 'X.', 'Combos: A; B.', 'Conflicts: C.'],
    ['followed by free text', 'X. Combos: A. Good for Y.', 'X.', 'Combos: A.', 'Good for Y.'],
    ['groups and comments', 'Combos: A + B (note).', '', 'Combos: A + B (note).', ''],
    ['no period after the list', 'X. Combos: A; B', 'X.', 'Combos: A; B', ''],
    ['singular Combo:, any case', 'Y combo: Z', 'Y', 'combo: Z', ''],
    ['double spaces kept', 'Tall.  Combos: A;  B.  Conflicts: C.', 'Tall.', 'Combos: A;  B.', 'Conflicts: C.'],
    ['a period inside parentheses ends the block', 'X. Combos: A (e.g. b); C.', 'X.', 'Combos: A (e.', 'g. b); C.'],
    ['"Combos:" with nothing after it is not a block', 'X. Combos:.', 'X. Combos:.', '', ''],
  ])('%s', (_label, raw, before, block, after) => {
    const parts = splitCombos(raw)
    expect(parts).toMatchObject({ before, block, after })
    expect(joinCombos(parts)).toBe(raw)
    expect(buildDescription(raw, parts)).toBe(raw)
  })

  it('the whitespace around the block is kept apart from the parts', () => {
    expect(splitCombos('Tall.  Combos: A.   Conflicts: C.')).toEqual({
      before: 'Tall.',
      gapBefore: '  ',
      block: 'Combos: A.',
      gapAfter: '   ',
      after: 'Conflicts: C.',
    })
  })

  it('the tray reads exactly the block the editor edits', () => {
    for (const raw of [
      'X. Combos: A; B. Conflicts: C.',
      'X. Combos: A. Good for Y.',
      'Combos: A + B (note).',
      'X. Combos: A; B',
      'Short desc. Combos: TOKEN1; TOKEN2; CATEGORY_*.',
    ]) {
      const { block } = splitCombos(raw)
      expect(parseComboTokens(raw)).toEqual(parseBlock(block).map((e) => e.text))
    }
    // "or" is not a separator: the tray splits at ";" only.
    expect(parseComboTokens('Combos: A or B; C.')).toEqual(['A or B', 'C'])
    expect(parseBlock('Combos: A or B; C.').map((e) => e.text)).toEqual(['A or B', 'C'])
    expect(blockList('Combos: A or B; C.')).toBe('A or B; C')
  })
})

// --- block elements ---

describe('block: parse, remove, add', () => {
  const BLOCK = 'Combos: POSE_Stand;  BODY_Muscular + LIGHT_Rim (works best); LIGHT_*;UNKNOWN_X.'

  it('splits at ";" outside parentheses; spacing stays outside the elements', () => {
    expect(parseBlock(BLOCK).map((e) => e.text)).toEqual([
      'POSE_Stand',
      'BODY_Muscular + LIGHT_Rim (works best)',
      'LIGHT_*',
      'UNKNOWN_X',
    ])
    expect(parseBlock('Combos: A (x; y); B').map((e) => e.text)).toEqual(['A (x; y)', 'B'])
    expect(parseBlock('')).toEqual([])
  })

  it.each([
    [0, 'Combos: BODY_Muscular + LIGHT_Rim (works best); LIGHT_*;UNKNOWN_X.'],
    [1, 'Combos: POSE_Stand;  LIGHT_*;UNKNOWN_X.'],
    [2, 'Combos: POSE_Stand;  BODY_Muscular + LIGHT_Rim (works best); UNKNOWN_X.'],
    [3, 'Combos: POSE_Stand;  BODY_Muscular + LIGHT_Rim (works best); LIGHT_*.'],
  ])('removing element %i keeps every other byte', (index, expected) => {
    expect(removeBlockElement(BLOCK, index)).toBe(expected)
  })

  it('removing the only element removes the block; out-of-range does nothing', () => {
    expect(removeBlockElement('Combos: A.', 0)).toBe('')
    expect(removeBlockElement(BLOCK, 9)).toBe(BLOCK)
  })

  it('adding appends "; NAME" after the last element, before the period', () => {
    expect(addBlockElement('Combos: A + B (c).', 'POSE_Sit')).toBe('Combos: A + B (c); POSE_Sit.')
    expect(addBlockElement('Combo: A  .', 'X')).toBe('Combo: A; X  .')
    expect(addBlockElement('Combos: A', 'X')).toBe('Combos: A; X')
    expect(addBlockElement('', 'POSE_Sit')).toBe('Combos: POSE_Sit.')
  })
})

// --- re-joining edited parts ---

describe('buildDescription', () => {
  const parts = (before: string, block: string, after = '') => ({ before, block, after })

  it('a block created from nothing uses the host format', () => {
    expect(buildDescription('Tall build', parts('Tall build', 'Combos: POSE_Sit.'))).toBe('Tall build. Combos: POSE_Sit.')
    expect(buildDescription('Tall build.', parts('Tall build.', 'Combos: POSE_Sit.'))).toBe('Tall build. Combos: POSE_Sit.')
    expect(buildDescription('', parts('', 'Combos: POSE_Sit.'))).toBe('Combos: POSE_Sit.')
    // The result splits back into the same parts.
    expect(splitCombos('Tall build. Combos: POSE_Sit.')).toMatchObject(parts('Tall build.', 'Combos: POSE_Sit.'))
  })

  it('an edited part keeps the stored spacing around the others', () => {
    const original = 'Tall.  Combos: A; B.   Conflicts: C.'
    expect(buildDescription(original, parts('Tall.', 'Combos: A.', 'Conflicts: C.'))).toBe('Tall.  Combos: A.   Conflicts: C.')
    expect(buildDescription(original, parts('Short.', 'Combos: A; B.', 'Conflicts: C.'))).toBe('Short.  Combos: A; B.   Conflicts: C.')
    expect(buildDescription(original, parts('Tall.', 'Combos: A; B.', 'Conflicts: D.'))).toBe('Tall.  Combos: A; B.   Conflicts: D.')
    expect(buildDescription(original, parts('', 'Combos: A; B.', 'Conflicts: C.'))).toBe('Combos: A; B.   Conflicts: C.')
    expect(buildDescription(original, parts('Tall.', 'Combos: A; B.', ''))).toBe('Tall.  Combos: A; B.')
  })

  it('removing the block joins the text before and after', () => {
    const original = 'X. Combos: A. Conflicts: C.'
    expect(buildDescription(original, parts('X.', '', 'Conflicts: C.'))).toBe('X. Conflicts: C.')
    expect(buildDescription(original, parts('', '', 'Conflicts: C.'))).toBe('Conflicts: C.')
    expect(buildDescription('Tall.  Combos: A; B.', parts('Tall.', ''))).toBe('Tall.')
  })

  it('a description without a block is plain text', () => {
    expect(buildDescription('Plain.', parts('Changed', ''))).toBe('Changed')
  })
})
