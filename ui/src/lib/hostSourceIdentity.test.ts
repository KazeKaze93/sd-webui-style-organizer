/**
 * Host source-id helpers (javascript/style_grid/state.js) — importable under vitest.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import * as hostStateModule from '../../../javascript/style_grid/state.js'
import {
  findStyleByName,
  remapStyleNameReferences,
  resolveStoredSourceSelection,
  state,
  styleIdentityKey,
} from '../../../javascript/style_grid/state.js'

// Host state.js is untyped; index tabs explicitly for the test harness.
const hostState = state as Record<string, { categories: Record<string, object[]> }>

describe('resolveStoredSourceSelection', () => {
  const catalog = ['styles/a.csv', 'webui/b.csv', 'styles/pack.csv']

  it('restores from a stored public id', () => {
    const r = resolveStoredSourceSelection('styles/a.csv', catalog)
    expect(r.selectedSourceFile).toBe('styles/a.csv')
    expect(r.selectedSource).toBe('a.csv')
    expect(r.storeValue).toBe('styles/a.csv')
  })

  it('maps a legacy unique leaf to its id', () => {
    const r = resolveStoredSourceSelection('pack.csv', catalog)
    expect(r.selectedSourceFile).toBe('styles/pack.csv')
    expect(r.selectedSource).toBe('pack.csv')
    expect(r.storeValue).toBe('styles/pack.csv')
  })

  it('maps a legacy abs path by unique leaf', () => {
    const r = resolveStoredSourceSelection('D:/old/ext/styles/pack.csv', catalog)
    expect(r.selectedSourceFile).toBe('styles/pack.csv')
    expect(r.storeValue).toBe('styles/pack.csv')
  })

  it('falls back to All when a legacy leaf is ambiguous', () => {
    const amb = ['styles/a.csv', 'webui/a.csv']
    const r = resolveStoredSourceSelection('a.csv', amb)
    expect(r.selectedSource).toBe('All')
    expect(r.selectedSourceFile).toBeNull()
    expect(r.storeValue).toBe('All')
  })

  it('falls back to All when the leaf matches nothing', () => {
    const r = resolveStoredSourceSelection('missing.csv', catalog)
    expect(r.selectedSource).toBe('All')
    expect(r.selectedSourceFile).toBeNull()
    expect(r.storeValue).toBe('All')
  })
})

describe('findStyleByName', () => {
  beforeEach(() => {
    hostState.txt2img.categories = {
      BASE: [
        {
          name: 'Shared',
          source_file: 'styles/a.csv',
          source: 'a.csv',
          prompt: 'p1',
        },
        {
          name: 'Unique',
          source_file: 'styles/a.csv',
          source: 'a.csv',
          prompt: 'u',
        },
        {
          name: 'Shared',
          source_file: 'webui/a.csv',
          source: 'a.csv',
          prompt: 'p2',
        },
      ],
    }
  })

  it('returns the row when the name is unique', () => {
    const s = findStyleByName('txt2img', 'Unique') as { source_file?: string } | null
    expect(s?.source_file).toBe('styles/a.csv')
  })

  it('returns null when the same name exists in several packs', () => {
    expect(findStyleByName('txt2img', 'Shared')).toBeNull()
  })
})

describe('favorites and recent are server data, not host localStorage', () => {
  it('state.js has no localStorage favorites/recent helpers any more', () => {
    for (const name of ['getFavorites', 'setFavorites', 'migrateFavoritesInMemory', 'getRecentHistory']) {
      expect(hostStateModule).not.toHaveProperty(name)
    }
  })

  it('a rename leaves old sg_favorites / sg_recent_* values alone', () => {
    const fav = JSON.stringify({ txt2img: ['OldName', styleIdentityKey('OldName', 'styles/a.csv')] })
    const recent = JSON.stringify(['OldName'])
    localStorage.setItem('sg_favorites', fav)
    localStorage.setItem('sg_recent_txt2img', recent)
    remapStyleNameReferences('txt2img', 'OldName', 'NewName', 'styles/a.csv')
    expect(localStorage.getItem('sg_favorites')).toBe(fav)
    expect(localStorage.getItem('sg_recent_txt2img')).toBe(recent)
    localStorage.removeItem('sg_favorites')
    localStorage.removeItem('sg_recent_txt2img')
  })
})
