/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHostMessage, type BatchProgress } from '../bridge'
import { useStylesStore } from '../store/stylesStore'
import {
  BATCH_RESULT_MS,
  batchFooterText,
  batchFooterTitle,
  batchHeaderText,
  batchPercent,
  PREVIEW_DONE_MS,
} from './previewProgress'

const batch = (fields: Partial<BatchProgress> = {}): BatchProgress => ({
  category: 'BODY',
  source: 'styles/body.csv',
  status: 'running',
  total: 12,
  processed: 0,
  newCount: 0,
  alreadyHad: 0,
  skipped: 0,
  failed: 0,
  ...fields,
})

describe('bridge: preview progress messages', () => {
  it('SG_THUMB_PROGRESS needs a known status, a styleId and source_file', () => {
    const ok = { type: 'SG_THUMB_PROGRESS', status: 'generating', styleId: 'BODY_A', source_file: 'a.csv' }
    expect(parseHostMessage({ ...ok, progress: 40 })).toEqual(ok)
    for (const status of ['generating', 'done', 'error']) {
      expect(parseHostMessage({ ...ok, status })).toEqual({ ...ok, status })
    }
    expect(parseHostMessage({ ...ok, source_file: '' })).toEqual({ ...ok, source_file: '' })
    expect(parseHostMessage({ ...ok, status: 'queued' })).toBeNull()
    expect(parseHostMessage({ ...ok, styleId: '' })).toBeNull()
    const noSource: Record<string, unknown> = { ...ok }
    delete noSource.source_file
    expect(parseHostMessage(noSource)).toBeNull()
  })

  it('SG_BATCH_PROGRESS validates status and every counter', () => {
    const ok = { type: 'SG_BATCH_PROGRESS', ...batch({ processed: 4, newCount: 3, failed: 1 }) }
    expect(parseHostMessage({ ...ok, extra: 1 })).toEqual(ok)
    for (const status of ['running', 'finished', 'cancelled']) {
      expect(parseHostMessage({ ...ok, status })).toEqual({ ...ok, status })
    }
    expect(parseHostMessage({ ...ok, status: 'error' })).toBeNull()
    expect(parseHostMessage({ ...ok, category: '' })).toBeNull()
    expect(parseHostMessage({ ...ok, source: null })).toBeNull()
    for (const key of ['total', 'processed', 'newCount', 'alreadyHad', 'skipped', 'failed']) {
      expect(parseHostMessage({ ...ok, [key]: '3' })).toBeNull()
      expect(parseHostMessage({ ...ok, [key]: -1 })).toBeNull()
      expect(parseHostMessage({ ...ok, [key]: 1.5 })).toBeNull()
      const missing: Record<string, unknown> = { ...ok }
      delete missing[key]
      expect(parseHostMessage(missing)).toBeNull()
    }
  })
})

describe('texts', () => {
  it('running header and footer, percent', () => {
    const b = batch({ processed: 4 })
    expect(batchHeaderText(b)).toBe('Generating previews 4 / 12')
    expect(batchFooterText(b)).toBe('Generating 4 / 12')
    expect(batchFooterTitle(b)).toBe('Generating previews · BODY 4 / 12')
    expect(batchPercent(b)).toBe(33)
    expect(batchPercent(batch({ total: 0 }))).toBe(0)
  })

  it.each([
    [{ newCount: 5 }, 'Previews ready: 5 new'],
    [{ newCount: 5, alreadyHad: 3 }, 'Previews ready: 5 new · 3 already had'],
    [{ newCount: 2, skipped: 1, failed: 1 }, 'Previews ready: 2 new · 1 skipped · 1 failed'],
    [{ alreadyHad: 4, failed: 2 }, 'Previews ready: 4 already had · 2 failed'],
    [{ newCount: 1, alreadyHad: 2, skipped: 3, failed: 4 }, 'Previews ready: 1 new · 2 already had · 3 skipped · 4 failed'],
  ])('finished lists only non-zero parts: %j', (counts, text) => {
    expect(batchHeaderText(batch({ status: 'finished', ...counts }))).toBe(text)
  })

  it('finished footer and cancelled texts', () => {
    expect(batchFooterText(batch({ status: 'finished', newCount: 7, failed: 1 }))).toBe('Ready: 7 new')
    const cancelled = batch({ status: 'cancelled', processed: 4 })
    expect(batchHeaderText(cancelled)).toBe('Cancelled after 4 / 12')
    expect(batchFooterText(cancelled)).toBe('Cancelled at 4 / 12')
  })
})

describe('store: preview jobs and batch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStylesStore.setState({ previewJobs: new Map(), previewBatch: null })
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  const job = (key: string) => useStylesStore.getState().previewJobs.get(key)
  const apply = (key: string, status: 'generating' | 'done' | 'error') =>
    useStylesStore.getState().applyPreviewProgress(key, status)

  it('generating → done; done clears after PREVIEW_DONE_MS', () => {
    apply('a.csv\0BODY_A', 'generating')
    expect(job('a.csv\0BODY_A')).toBe('generating')
    apply('a.csv\0BODY_A', 'done')
    expect(job('a.csv\0BODY_A')).toBe('done')
    vi.advanceTimersByTime(PREVIEW_DONE_MS - 1)
    expect(job('a.csv\0BODY_A')).toBe('done')
    vi.advanceTimersByTime(1)
    expect(job('a.csv\0BODY_A')).toBeUndefined()
  })

  it('error removes the job at once; other keys stay', () => {
    apply('k1', 'generating')
    apply('k2', 'generating')
    apply('k1', 'error')
    expect(job('k1')).toBeUndefined()
    expect(job('k2')).toBe('generating')
  })

  it('a new generation on the same tile is not cleared by the old done timer', () => {
    apply('k1', 'done')
    vi.advanceTimersByTime(PREVIEW_DONE_MS - 100)
    apply('k1', 'generating')
    vi.advanceTimersByTime(PREVIEW_DONE_MS)
    expect(job('k1')).toBe('generating')
  })

  const report = (b: BatchProgress) => useStylesStore.getState().applyBatchProgress(b)
  const shown = () => useStylesStore.getState().previewBatch

  it('a running batch keeps its seq; a final one clears after BATCH_RESULT_MS', () => {
    report(batch())
    const seq = shown()!.seq
    report(batch({ processed: 4, newCount: 4 }))
    expect(shown()).toMatchObject({ processed: 4, seq })
    report(batch({ status: 'finished', processed: 12, newCount: 12 }))
    expect(shown()).toMatchObject({ status: 'finished', seq })
    vi.advanceTimersByTime(BATCH_RESULT_MS - 1)
    expect(shown()).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(shown()).toBeNull()
  })

  it('a newer batch survives the previous batch result timer', () => {
    report(batch({ status: 'cancelled', processed: 2 }))
    const oldSeq = shown()!.seq
    vi.advanceTimersByTime(1000)
    report(batch({ category: 'HAIR', total: 3 }))
    expect(shown()!.seq).not.toBe(oldSeq)
    vi.advanceTimersByTime(BATCH_RESULT_MS)
    expect(shown()).toMatchObject({ category: 'HAIR', status: 'running' })
  })
})
