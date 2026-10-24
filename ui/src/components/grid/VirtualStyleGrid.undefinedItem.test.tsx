/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../../bridge'
import { __resetGridFocusForTests } from '../../lib/gridFocus'
import { VIRTUALIZER_TEST_INITIAL_RECT } from './constants'

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: () => [],
  useVirtualizer: () => ({
    getVirtualItems: () => [undefined],
    getTotalSize: () => 0,
    measure: () => {},
    scrollToIndex: () => {},
  }),
}))

import { VirtualStyleGrid } from './VirtualStyleGrid'

function style(name: string, category: string): Style {
  return {
    name,
    source_file: 'D:/packs/core/styles.csv',
    prompt: `p:${name}`,
    negative_prompt: '',
    description: '',
    category,
    has_thumbnail: false,
  }
}

describe('VirtualStyleGrid undefined virtual item', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(() => {
    __resetGridFocusForTests()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const height =
        Number.parseFloat(this.style.height) || VIRTUALIZER_TEST_INITIAL_RECT.height
      const width =
        Number.parseFloat(this.style.width) || VIRTUALIZER_TEST_INITIAL_RECT.width
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON() {
          return {}
        },
      }
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    host?.remove()
    host = null
    __resetGridFocusForTests()
    vi.restoreAllMocks()
  })

  it('does not throw when getVirtualItems returns an undefined slot', () => {
    const groups: Array<[string, Style[]]> = [
      ['BODY', [style('BODY_A', 'BODY'), style('BODY_B', 'BODY')]],
    ]

    expect(() => {
      act(() => {
        root!.render(
          <div
            style={{
              height: `${VIRTUALIZER_TEST_INITIAL_RECT.height}px`,
              width: `${VIRTUALIZER_TEST_INITIAL_RECT.width}px`,
              overflow: 'auto',
            }}
          >
            <VirtualStyleGrid
              groups={groups}
              collapsedCategories={new Set()}
              compactMode={false}
              windowed={false}
              onToggleCollapse={() => {}}
              onSelectAll={() => {}}
            />
          </div>,
        )
      })
    }).not.toThrow()

    expect(host!.querySelector('[role="grid"]')).not.toBeNull()
  })
})
