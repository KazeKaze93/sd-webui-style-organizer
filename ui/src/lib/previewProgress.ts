/**
 * Preview generation progress (host messages SG_THUMB_PROGRESS and
 * SG_BATCH_PROGRESS): timings and the texts shown in the category header,
 * the sidebar footer and the live region.
 */
import type { BatchProgress } from '../bridge'

/** How long a grid tile keeps its ✓ after a single preview is done. */
export const PREVIEW_DONE_MS = 1500
/** How long a finished or cancelled batch keeps its result line. */
export const BATCH_RESULT_MS = 3000

export type PreviewJobState = 'generating' | 'done'

/** A batch report plus a sequence number: a new batch gets a new one. */
export type PreviewBatch = BatchProgress & { seq: number }

export function isBatchFinal(b: Pick<BatchProgress, 'status'>): boolean {
  return b.status === 'finished' || b.status === 'cancelled'
}

/** 0–100 for the header bar. */
export function batchPercent(b: Pick<BatchProgress, 'processed' | 'total'>): number {
  if (b.total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((b.processed / b.total) * 100)))
}

/** Category header line (running, or the 3 s result). Only non-zero parts are listed. */
export function batchHeaderText(b: BatchProgress): string {
  if (b.status === 'running') return `Generating previews ${b.processed} / ${b.total}`
  if (b.status === 'cancelled') return `Cancelled after ${b.processed} / ${b.total}`
  const parts = [
    [b.newCount, 'new'],
    [b.alreadyHad, 'already had'],
    [b.skipped, 'skipped'],
    [b.failed, 'failed'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${n} ${label}`)
  return parts.length ? `Previews ready: ${parts.join(' · ')}` : 'Previews ready'
}

/** Sidebar footer line: short, the footer is 210 px wide. */
export function batchFooterText(b: BatchProgress): string {
  if (b.status === 'running') return `Generating ${b.processed} / ${b.total}`
  if (b.status === 'cancelled') return `Cancelled at ${b.processed} / ${b.total}`
  return `Ready: ${b.newCount} new`
}

/** Full footer text for its title attribute. */
export function batchFooterTitle(b: BatchProgress): string {
  if (b.status === 'running') return `Generating previews · ${b.category} ${b.processed} / ${b.total}`
  return `${b.category}: ${batchHeaderText(b)}`
}

/** Live-region text for the start of a batch. */
export function batchStartAnnouncement(b: BatchProgress): string {
  return `Generating previews for ${b.category}: ${b.total} ${b.total === 1 ? 'style' : 'styles'}`
}
