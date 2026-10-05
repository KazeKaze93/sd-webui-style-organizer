import { describe, expect, it } from 'vitest'
import { WILDCARD_KIND_DECK, WILDCARD_KIND_DICE } from '../bridge'
import { wildcardKey } from './wildcardKey'

describe('wildcardKey', () => {
  it('distinguishes dice vs deck for the same category/spec', () => {
    expect(wildcardKey('POSE', '', WILDCARD_KIND_DICE)).not.toBe(
      wildcardKey('POSE', '', WILDCARD_KIND_DECK),
    )
  })

  it('ignores category and spec casing', () => {
    expect(wildcardKey('Body', 'Male_*')).toBe(wildcardKey('body', 'male_*'))
  })

  it('treats missing kind as dice', () => {
    expect(wildcardKey('cat', 'spec')).toBe(
      wildcardKey('cat', 'spec', WILDCARD_KIND_DICE),
    )
  })

  it('treats undefined spec as empty spec', () => {
    expect(wildcardKey('cat', undefined)).toBe(wildcardKey('cat', ''))
  })
})
