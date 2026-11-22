/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { useStylesStore } from '../store/stylesStore'
import { SearchBar } from './SearchBar'

describe('SearchBar follows the store search', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  const input = () => host!.querySelector<HTMLInputElement>('input')!

  beforeEach(async () => {
    __resetLayerStackForTests()
    useStylesStore.setState({ styles: [], search: '', activeSource: null, selectedStyles: [] })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<SearchBar />)
    })
  })
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
    __resetLayerStackForTests()
  })

  it('typing writes the store; clearing the store from elsewhere clears the field', async () => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input(), 'gloev')
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(useStylesStore.getState().search).toBe('gloev')
    expect(input().value).toBe('gloev')

    await act(async () => useStylesStore.getState().setSearch(''))
    expect(input().value).toBe('')
  })
})
