import { describe, expect, it } from 'vitest'
import { conflictPairKey, conflictStyleKeys, groupConflictPairs, type DirectedConflict } from './conflictPairs'

const c = (a: string, b: string): DirectedConflict => ({
  styleA: a,
  styleB: b,
  styleAKey: `f.csv\0${a}`,
  styleBKey: `f.csv\0${b}`,
})

describe('conflict pairs', () => {
  it('pair key does not depend on order', () => {
    expect(conflictPairKey('x', 'y')).toBe(conflictPairKey('y', 'x'))
    expect(conflictPairKey('x', 'y')).toBe('x\0y')
  })

  it('one direction: one pair, A is the style whose negative prompt cancels B', () => {
    expect(groupConflictPairs([c('A', 'B')])).toEqual([
      { key: conflictPairKey('f.csv\0A', 'f.csv\0B'), aKey: 'f.csv\0A', bKey: 'f.csv\0B', aName: 'A', bName: 'B', both: false },
    ])
  })

  it('both directions: one pair marked both', () => {
    const pairs = groupConflictPairs([c('C', 'D'), c('D', 'C')])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ aName: 'C', bName: 'D', both: true })
  })

  it('three styles with two pairs, in order of first appearance', () => {
    const pairs = groupConflictPairs([c('A', 'B'), c('A', 'C'), c('C', 'A')])
    expect(pairs.map((p) => [p.aName, p.bName, p.both])).toEqual([
      ['A', 'B', false],
      ['A', 'C', true],
    ])
    expect([...conflictStyleKeys(pairs)].sort()).toEqual(['f.csv\0A', 'f.csv\0B', 'f.csv\0C'])
  })

  it('dismissed pairs are left out', () => {
    const dismissed = new Set([conflictPairKey('f.csv\0A', 'f.csv\0B')])
    expect(groupConflictPairs([c('A', 'B'), c('B', 'A'), c('A', 'C')], dismissed).map((p) => p.bName)).toEqual(['C'])
  })
})
