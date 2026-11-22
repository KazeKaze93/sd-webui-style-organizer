/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { styleRowKey, useStylesStore, type PresetRecord } from '../store/stylesStore'
import { PresetRow } from './PresetRow'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const style = (source_file: string): Style => ({
  name: 'BODY_Tall',
  source_file,
  prompt: 'tall',
  negative_prompt: '',
  description: '',
  category: 'BODY',
})
const IN_PACK = style('webui/a.csv')
const OTHER_PACK = style('webui/b.csv')
const PRESET: PresetRecord = {
  styles: [{ name: 'BODY_Tall', source_file: 'webui/a.csv' }],
  created: '2026-01-01',
}

describe('preset applied state', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const applyButton = () =>
    [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => /^(Apply|Unapply)$/.test(b.textContent ?? ''))!

  const renderWithSelection = async (selected: Style[]) => {
    useStylesStore.setState({
      styles: [IN_PACK, OTHER_PACK],
      selectedStyles: selected,
      selectedKeySet: new Set(selected.map(styleRowKey)),
      activeWildcards: [],
    })
    await act(async () => {
      root!.render(<PresetRow name="Tall set" preset={PRESET} />)
    })
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
  })

  it('the same style name selected from a different pack does not mark the preset applied', async () => {
    await renderWithSelection([OTHER_PACK])
    expect(applyButton().textContent).toBe('Apply')
  })

  it('the same style (pack and name) marks it applied', async () => {
    await renderWithSelection([IN_PACK])
    expect(applyButton().textContent).toBe('Unapply')
  })
})
