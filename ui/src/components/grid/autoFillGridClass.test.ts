import { describe, expect, it } from 'vitest'
import constantsSource from './constants.ts?raw'
import { autoFillGridClass, minCardWidthPx } from './constants'

const WINDOWED: readonly boolean[] = [false, true]

describe('autoFillGridClass', () => {
  it.each(WINDOWED)('minmax matches minCardWidthPx(windowed=%s)', (windowed) => {
    const result = autoFillGridClass(windowed)
    const minW = minCardWidthPx(windowed)
    expect(result).toContain(`minmax(${minW}px,1fr)`)
  })

  it.each(WINDOWED)('every utility is a literal substring of constants.ts (windowed=%s)', (windowed) => {
    const result = autoFillGridClass(windowed)
    for (const utility of result.split(' ')) {
      expect(constantsSource).toContain(utility)
    }
  })

  it('no result contains template residue', () => {
    for (const windowed of WINDOWED) {
      expect(autoFillGridClass(windowed)).not.toContain('${')
    }
  })
})
