import { beforeEach, describe, expect, it } from 'vitest'
import { WILDCARD_KIND_DECK, WILDCARD_KIND_DICE } from '../bridge'
import { useStylesStore } from './stylesStore'

describe('setSliceKind', () => {
  beforeEach(() => {
    useStylesStore.setState({ sliceMode: null, sliceSelection: [] })
  })

  it('changes the kind and keeps the category and the picks', () => {
    useStylesStore.getState().startSliceMode('BODY')
    useStylesStore.getState().toggleSliceSelection('BODY_A')
    useStylesStore.getState().setSliceKind(WILDCARD_KIND_DECK)
    expect(useStylesStore.getState().sliceMode).toEqual({ category: 'BODY', kind: WILDCARD_KIND_DECK })
    expect(useStylesStore.getState().sliceSelection).toEqual(['BODY_A'])
    useStylesStore.getState().setSliceKind(WILDCARD_KIND_DICE)
    expect(useStylesStore.getState().sliceMode).toEqual({ category: 'BODY', kind: WILDCARD_KIND_DICE })
    expect(useStylesStore.getState().sliceSelection).toEqual(['BODY_A'])
  })

  it('same kind keeps the same sliceMode object', () => {
    useStylesStore.getState().startSliceMode('BODY', WILDCARD_KIND_DECK)
    const before = useStylesStore.getState().sliceMode
    useStylesStore.getState().setSliceKind(WILDCARD_KIND_DECK)
    expect(useStylesStore.getState().sliceMode).toBe(before)
  })

  it('does nothing outside slice mode', () => {
    useStylesStore.getState().setSliceKind(WILDCARD_KIND_DECK)
    expect(useStylesStore.getState().sliceMode).toBeNull()
  })
})
