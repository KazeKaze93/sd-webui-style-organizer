/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VIEW_MODE_STORAGE_KEY, loadViewMode, useStylesStore } from './stylesStore'

describe('view mode', () => {
  beforeEach(() => {
    localStorage.clear()
    useStylesStore.setState({ viewMode: 'grid' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('defaults to grid when nothing is stored', () => {
    expect(loadViewMode()).toBe('grid')
  })

  it('a fresh store reads the stored value', async () => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, 'gallery')
    vi.resetModules()
    const fresh = await import('./stylesStore')
    expect(fresh.useStylesStore.getState().viewMode).toBe('gallery')
  })

  it('setViewMode updates the store and persists under sg_view_mode', () => {
    useStylesStore.getState().setViewMode('gallery')
    expect(useStylesStore.getState().viewMode).toBe('gallery')
    expect(localStorage.getItem('sg_view_mode')).toBe('gallery')
    useStylesStore.getState().setViewMode('grid')
    expect(localStorage.getItem('sg_view_mode')).toBe('grid')
  })

  it.each(['', 'Gallery', 'list', '{"mode":"gallery"}'])('an unknown stored value %j reads as grid', (raw) => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, raw)
    expect(loadViewMode()).toBe('grid')
  })

  it('a throwing localStorage reads as grid and setViewMode still switches', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(loadViewMode()).toBe('grid')
    expect(() => useStylesStore.getState().setViewMode('gallery')).not.toThrow()
    expect(useStylesStore.getState().viewMode).toBe('gallery')
  })
})
