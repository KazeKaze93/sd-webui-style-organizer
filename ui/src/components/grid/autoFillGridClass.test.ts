import { describe, expect, it } from 'vitest'
import constantsSource from './constants.ts?raw'
import { autoFillGridClass, minCardWidthPx } from './constants'

const COMBOS: ReadonlyArray<readonly [boolean, boolean]> = [
  [false, false],
  [false, true],
  [true, false],
  [true, true],
]

describe('autoFillGridClass', () => {
  it.each(COMBOS)(
    'minmax matches minCardWidthPx(compact=%s, windowed=%s)',
    (compactMode, windowed) => {
      const result = autoFillGridClass(compactMode, windowed)
      const minW = minCardWidthPx(compactMode, windowed)
      expect(result).toContain(`minmax(${minW}px,1fr)`)
    },
  )

  it.each(COMBOS)(
    'every utility is a literal substring of constants.ts (compact=%s, windowed=%s)',
    (compactMode, windowed) => {
      const result = autoFillGridClass(compactMode, windowed)
      for (const utility of result.split(' ')) {
        expect(constantsSource).toContain(utility)
      }
    },
  )

  it('no combo result contains template residue', () => {
    for (const [compactMode, windowed] of COMBOS) {
      expect(autoFillGridClass(compactMode, windowed)).not.toContain('${')
    }
  })
})
