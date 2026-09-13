import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveSliceNames } from './wildcardSlice'

type SliceGrammarFixture = {
  note: string
  category: string
  names: string[]
  cases: Array<{ spec: string; expected: string[] }>
}

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures/slice_grammar.json'),
    'utf8',
  ),
) as SliceGrammarFixture

describe('slice grammar parity (resolveSliceNames)', () => {
  it('loads a non-empty fixture', () => {
    expect(fixture.cases.length).toBeGreaterThan(0)
    expect(fixture.names.length).toBeGreaterThan(0)
  })

  it.each(
    fixture.cases.map((c) => ({
      ...c,
      id: c.spec || 'empty spec',
    })),
  )('resolveSliceNames($id)', ({ spec, expected }) => {
    expect(resolveSliceNames(fixture.category, spec, fixture.names)).toEqual(expected)
  })
})
