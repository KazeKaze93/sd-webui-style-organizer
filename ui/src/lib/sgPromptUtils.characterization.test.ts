/**
 * Characterization of Forge-injected prompt helpers (sg_prompt_utils.js).
 * After the host split these must keep matching the single prompt-utils module.
 */
import { describe, expect, it } from 'vitest'
import '../../../javascript/sg_prompt_utils.js'

type PromptUtils = {
  splitTopLevelCommas: (s: string) => string[]
  stripParenLayers: (s: string) => string
  parseStylePromptTags: (prompt: string) => { tag: string; weight: number }[]
  scalePromptWeights: (text: string, scale: number) => string
}

const g = globalThis as typeof globalThis & PromptUtils

describe('characterization: sg_prompt_utils', () => {
  it('splitTopLevelCommas keeps brace and paren groups intact', () => {
    expect(g.splitTopLevelCommas('a, (b, c:1.2), {sg:CAT:A,B}, d')).toEqual([
      'a',
      '(b, c:1.2)',
      '{sg:CAT:A,B}',
      'd',
    ])
  })

  it('stripParenLayers unwraps balanced outer parens', () => {
    expect(g.stripParenLayers('((fox ears))')).toBe('fox ears')
    expect(g.stripParenLayers('(a),(b)')).toBe('(a),(b)')
  })

  it('parseStylePromptTags returns tag/weight pairs', () => {
    expect(g.parseStylePromptTags('fox ears, (fluffy:1.3)')).toEqual([
      { tag: 'fox ears', weight: 1 },
      { tag: 'fluffy', weight: 1.3 },
    ])
  })

  it('scalePromptWeights interpolates and drops at scale 0', () => {
    expect(g.scalePromptWeights('(tag:1.4)', 1)).toBe('(tag:1.4)')
    expect(g.scalePromptWeights('(tag:1.4)', 0.5)).toBe('(tag:1.2)')
    expect(g.scalePromptWeights('(tag:1.4)', 0)).toBe('')
    expect(g.scalePromptWeights('plain, {prompt}', 0.5)).toBe('(plain:0.5), {prompt}')
  })
})
