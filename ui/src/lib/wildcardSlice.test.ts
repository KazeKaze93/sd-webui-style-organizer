import { describe, expect, it } from 'vitest'
import { buildSliceSpec, describeSpec, resolveSliceNames } from './wildcardSlice'

const CATEGORY = 'body'

const BODY = [
  'BODY_Male_Average',
  'BODY_Male_BBC',
  'BODY_Male_Muscular',
  'BODY_Tanned',
  'BODY_Shortstack',
  'BODY_Petite_Small',
  'BODY_Tall_Amazon',
  'BODY_Ass_Huge',
  'BODY_Hourglass_Perfect',
  'BODY_Pregnant_Gravid',
  'BODY_Muscular_Fit',
  'BODY_BBW_Plus_Size',
]

const MALE = ['BODY_Male_Average', 'BODY_Male_BBC', 'BODY_Male_Muscular']
const TWO_INCLUDE = ['BODY_Tanned', 'BODY_Shortstack']
const TWO_MALE = ['BODY_Male_Average', 'BODY_Male_BBC']
const MALE_PLUS_TANNED = [...MALE, 'BODY_Tanned']
const TEN_EXCLUDE = BODY.filter((n) => !TWO_INCLUDE.includes(n))

const SELECTIONS = [
  { name: 'whole category', selected: BODY },
  { name: 'two names (include)', selected: TWO_INCLUDE },
  { name: 'ten of twelve (exclude)', selected: TEN_EXCLUDE },
  { name: 'Male_ glob', selected: MALE },
  { name: 'Male_ glob plus Tanned', selected: MALE_PLUS_TANNED },
  { name: 'two of three Male_ (no glob)', selected: TWO_MALE },
]

describe('buildSliceSpec', () => {
  it('returns empty spec when every name is selected', () => {
    expect(buildSliceSpec(CATEGORY, BODY, BODY)).toBe('')
  })

  it('returns the include form for two selected names', () => {
    expect(buildSliceSpec(CATEGORY, TWO_INCLUDE, BODY)).toBe('Tanned,Shortstack')
  })

  it('returns the exclude form when that is shorter than a 10-name include', () => {
    expect(buildSliceSpec(CATEGORY, TEN_EXCLUDE, BODY)).toBe('-Tanned,-Shortstack')
  })

  it('collapses a fully selected Male_ root to a glob', () => {
    expect(buildSliceSpec(CATEGORY, MALE, BODY)).toBe('Male_*')
  })

  it('keeps the glob and adds an unrelated name', () => {
    expect(buildSliceSpec(CATEGORY, MALE_PLUS_TANNED, BODY)).toBe('Male_*,Tanned')
  })

  it('does not glob when only two of three Male_ names are selected', () => {
    const spec = buildSliceSpec(CATEGORY, TWO_MALE, BODY)
    expect(spec).toBe('Male_Average,Male_BBC')
    expect(spec).not.toContain('*')
  })

  it('never puts the category prefix in a spec', () => {
    for (const { selected } of SELECTIONS) {
      expect(buildSliceSpec(CATEGORY, selected, BODY)).not.toContain('BODY_')
    }
  })
})

describe('resolveSliceNames', () => {
  it('returns every name for an empty spec', () => {
    expect(resolveSliceNames(CATEGORY, '', BODY)).toEqual(BODY)
  })

  it('resolves an include list to the named styles', () => {
    expect(resolveSliceNames(CATEGORY, 'Tanned,Shortstack', BODY)).toEqual(TWO_INCLUDE)
  })

  it('resolves exclude entries against the full category', () => {
    expect(resolveSliceNames(CATEGORY, '-Tanned,-Shortstack', BODY)).toEqual(TEN_EXCLUDE)
  })

  it('resolves a glob include under a root', () => {
    expect(resolveSliceNames(CATEGORY, 'Male_*', BODY)).toEqual(MALE)
  })

  it('resolves a glob exclude against the full category', () => {
    expect(resolveSliceNames(CATEGORY, '-Male_*', BODY)).toEqual(
      BODY.filter((n) => !MALE.includes(n)),
    )
  })

  it('resolves include and exclude combined', () => {
    expect(resolveSliceNames(CATEGORY, 'Male_*,-Male_BBC', BODY)).toEqual([
      'BODY_Male_Average',
      'BODY_Male_Muscular',
    ])
  })

  it('falls back to every name when the spec matches nothing', () => {
    expect(resolveSliceNames(CATEGORY, 'Ghost,Missing', BODY)).toEqual(BODY)
  })

  it('matches names case-insensitively', () => {
    expect(resolveSliceNames('BODY', 'tanned', BODY)).toEqual(['BODY_Tanned'])
    expect(resolveSliceNames('BoDy', 'MALE_*', BODY)).toEqual(MALE)
  })
})

describe('describeSpec', () => {
  it('gives a null count for an empty spec', () => {
    expect(describeSpec(CATEGORY, '', BODY)).toEqual({ count: null, names: [] })
  })

  it('gives count 2 for an include of two names', () => {
    const described = describeSpec(CATEGORY, 'Tanned,Shortstack', BODY)
    expect(described.count).toBe(2)
    expect(described.names).toEqual(TWO_INCLUDE)
  })

  it('counts an exclude by resolved pool size, not spec-entry count', () => {
    const described = describeSpec(CATEGORY, '-Tanned,-Shortstack', BODY)
    expect(described.count).toBe(10)
    expect(described.count).not.toBe(2)
    expect(described.names).toEqual(TEN_EXCLUDE)
  })

  it('counts a glob by resolved pool size, not spec-entry count', () => {
    const described = describeSpec(CATEGORY, 'Male_*', BODY)
    expect(described.count).toBe(3)
    expect(described.count).not.toBe(1)
    expect(described.names).toEqual(MALE)
  })

  it('exposes resolved style names rather than raw spec entries', () => {
    const described = describeSpec(CATEGORY, 'Tanned,Shortstack', BODY)
    expect(described.names).toEqual(['BODY_Tanned', 'BODY_Shortstack'])
    expect(described.names).not.toEqual(['Tanned', 'Shortstack'])
  })
})

describe('buildSliceSpec / resolveSliceNames round-trip', () => {
  for (const { name, selected } of SELECTIONS) {
    it(`restores ${name}`, () => {
      const spec = buildSliceSpec(CATEGORY, selected, BODY)
      expect(resolveSliceNames(CATEGORY, spec, BODY)).toEqual(selected)
    })
  }
})
