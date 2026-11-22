/**
 * Host preview progress: the category batch loop (handlers/batch-runner.js),
 * single-generation progress and the SG_READY re-post (handlers/preview-progress.js),
 * and SG_BATCH_CANCEL / SG_BATCH_SKIP parsing (post-message.js).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BATCH_NEXT_DELAY_MS,
  BATCH_POLL_MS,
  createBatchRunner,
} from '../../../javascript/style_grid/handlers/batch-runner.js'
import {
  createSinglePreviewReporter,
  previewJobKey,
  repostPreviewState,
  SINGLE_DONE_DELAY_MS,
} from '../../../javascript/style_grid/handlers/preview-progress.js'
import { parseFrameMessage } from '../../../javascript/style_grid/post-message.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const read = (rel: string) => fs.readFileSync(path.resolve(ROOT, rel), 'utf8')

type Msg = Record<string, unknown>
type StyleRow = { name: string; source_file: string }

const SRC = 'styles/body.csv'
const row = (name: string): StyleRow => ({ name, source_file: SRC })
const progress = (fields: Partial<Record<string, unknown>>) => ({
  type: 'SG_BATCH_PROGRESS',
  category: 'BODY',
  source: SRC,
  ...fields,
})

describe('batch runner', () => {
  let posts: Array<[string, Msg]>
  let toasts: Array<[string, string, string]>
  let itemsDone: string[]
  let finished: string[]
  let statuses: Record<string, string[]>
  let have: Set<string>
  let jobSeq: number
  let apiPost: ReturnType<typeof vi.fn<(url: string, body: Msg) => Promise<Msg>>>
  let apiGet: ReturnType<typeof vi.fn<(url: string) => Promise<Msg>>>
  let runner: ReturnType<typeof createBatchRunner>

  const batchPosts = () => posts.filter(([, m]) => m.type === 'SG_BATCH_PROGRESS').map(([, m]) => m)
  const lastBatch = () => batchPosts()[batchPosts().length - 1]
  const cancelPosts = () => apiPost.mock.calls.filter(([url]) => url === '/style_grid/thumbnail/cancel')
  const generated = () =>
    apiPost.mock.calls.filter(([url]) => url === '/style_grid/thumbnail/generate').map(([, b]) => b.name)

  beforeEach(() => {
    vi.useFakeTimers()
    posts = []
    toasts = []
    itemsDone = []
    finished = []
    statuses = {}
    have = new Set()
    jobSeq = 0
    apiPost = vi.fn<(url: string, body: Msg) => Promise<Msg>>(async (url) => {
      if (url === '/style_grid/thumbnail/generate') {
        jobSeq += 1
        return { job_id: `j${jobSeq}` }
      }
      return {}
    })
    apiGet = vi.fn<(url: string) => Promise<Msg>>(async (url) => {
      const job = decodeURIComponent(url.split('job_id=')[1])
      const queue = statuses[job]
      const status = queue && queue.length > 1 ? queue.shift()! : queue?.[0] ?? 'done'
      return { status }
    })
    runner = createBatchRunner({
      apiPost,
      apiGet,
      post: (tab: string, msg: Msg) => posts.push([tab, msg]),
      toast: (tab: string, message: string, variant: string) => toasts.push([tab, message, variant]),
      hasThumbnail: (_tab: string, name: string) => have.has(name),
      onItemDone: (_tab: string, name: string) => itemsDone.push(name),
      onFinish: (tab: string) => finished.push(tab),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('posts running at start, after every style, then finished (exact payloads)', async () => {
    have.add('BODY_A')
    expect(runner.start('txt2img', 'BODY', SRC, [row('BODY_A'), row('BODY_B'), row('BODY_C')])).toBe(true)
    await vi.runAllTimersAsync()
    const base = { total: 2, alreadyHad: 1, skipped: 0, failed: 0 }
    expect(batchPosts()).toEqual([
      progress({ status: 'running', ...base, processed: 0, newCount: 0 }),
      progress({ status: 'running', ...base, processed: 1, newCount: 1 }),
      progress({ status: 'running', ...base, processed: 2, newCount: 2 }),
      progress({ status: 'finished', ...base, processed: 2, newCount: 2 }),
    ])
    expect(posts.every(([tab]) => tab === 'txt2img')).toBe(true)
    expect(generated()).toEqual(['BODY_B', 'BODY_C'])
    expect(itemsDone).toEqual(['BODY_B', 'BODY_C'])
    expect(finished).toEqual(['txt2img'])
    expect(toasts).toEqual([])
    expect(runner.isRunning()).toBe(false)
  })

  it('errors and server-side cancels count as failed', async () => {
    statuses.j1 = ['error']
    statuses.j2 = ['cancelled']
    runner.start('txt2img', 'BODY', SRC, [row('BODY_A'), row('BODY_B'), row('BODY_C')])
    await vi.runAllTimersAsync()
    expect(lastBatch()).toEqual(
      progress({ status: 'finished', total: 3, processed: 3, newCount: 1, alreadyHad: 0, skipped: 0, failed: 2 }),
    )
  })

  it('cancel while polling: POST /thumbnail/cancel for that job, then cancelled', async () => {
    statuses.j1 = ['running']
    runner.start('txt2img', 'BODY', SRC, [row('BODY_A'), row('BODY_B')])
    await vi.advanceTimersByTimeAsync(0)
    expect(runner.cancel('txt2img')).toBe(true)
    expect(cancelPosts()).toEqual([['/style_grid/thumbnail/cancel', { job_id: 'j1' }]])
    await vi.runAllTimersAsync()
    expect(lastBatch()).toEqual(
      progress({ status: 'cancelled', total: 2, processed: 0, newCount: 0, alreadyHad: 0, skipped: 0, failed: 0 }),
    )
    expect(generated()).toEqual(['BODY_A'])
    expect(finished).toEqual(['txt2img'])
    expect(runner.isRunning()).toBe(false)
  })

  it('cancel in the pause between two styles ends as cancelled, not finished', async () => {
    runner.start('txt2img', 'BODY', SRC, [row('BODY_A'), row('BODY_B')])
    await vi.advanceTimersByTimeAsync(0)
    // BODY_A is done; the loop waits BATCH_NEXT_DELAY_MS before BODY_B.
    expect(lastBatch()).toMatchObject({ status: 'running', processed: 1, newCount: 1 })
    expect(runner.cancel('txt2img')).toBe(true)
    await vi.advanceTimersByTimeAsync(BATCH_NEXT_DELAY_MS)
    await vi.runAllTimersAsync()
    expect(lastBatch()).toEqual(
      progress({ status: 'cancelled', total: 2, processed: 1, newCount: 1, alreadyHad: 0, skipped: 0, failed: 0 }),
    )
    expect(batchPosts().some((m) => m.status === 'finished')).toBe(false)
    expect(generated()).toEqual(['BODY_A'])
    // No job was running in the pause, so there is nothing to cancel on the server.
    expect(cancelPosts()).toEqual([])
  })

  it('skip drops the running style (server cancel), counts it, and the loop goes on', async () => {
    statuses.j1 = ['running']
    runner.start('txt2img', 'BODY', SRC, [row('BODY_A'), row('BODY_B')])
    await vi.advanceTimersByTimeAsync(0)
    expect(runner.skip('txt2img')).toBe(true)
    expect(cancelPosts()).toEqual([['/style_grid/thumbnail/cancel', { job_id: 'j1' }]])
    await vi.advanceTimersByTimeAsync(BATCH_POLL_MS)
    await vi.runAllTimersAsync()
    expect(generated()).toEqual(['BODY_A', 'BODY_B'])
    expect(batchPosts().slice(1)).toEqual([
      progress({ status: 'running', total: 2, processed: 1, newCount: 0, alreadyHad: 0, skipped: 1, failed: 0 }),
      progress({ status: 'running', total: 2, processed: 2, newCount: 1, alreadyHad: 0, skipped: 1, failed: 0 }),
      progress({ status: 'finished', total: 2, processed: 2, newCount: 1, alreadyHad: 0, skipped: 1, failed: 0 }),
    ])
  })

  it('a server "cancelled" caused by Skip counts as skipped', async () => {
    statuses.j1 = ['running', 'cancelled']
    runner.start('txt2img', 'BODY', SRC, [row('BODY_A')])
    await vi.advanceTimersByTimeAsync(0)
    runner.skip('txt2img')
    await vi.runAllTimersAsync()
    expect(lastBatch()).toMatchObject({ status: 'finished', processed: 1, skipped: 1, failed: 0 })
  })

  it('only the tab that owns the batch can cancel or skip it', async () => {
    statuses.j1 = ['running']
    runner.start('txt2img', 'BODY', SRC, [row('BODY_A')])
    await vi.advanceTimersByTimeAsync(0)
    expect(runner.cancel('img2img')).toBe(false)
    expect(runner.skip('img2img')).toBe(false)
    expect(cancelPosts()).toEqual([])
    expect(runner.isRunning()).toBe(true)
    statuses.j1 = ['done']
    await vi.runAllTimersAsync()
    expect(lastBatch()).toMatchObject({ status: 'finished', newCount: 1 })
  })

  it('a second start while one runs: toast, no messages, the first batch is untouched', async () => {
    statuses.j1 = ['running']
    runner.start('txt2img', 'BODY', SRC, [row('BODY_A')])
    await vi.advanceTimersByTimeAsync(0)
    const before = posts.length
    expect(runner.start('img2img', 'HAIR', SRC, [row('HAIR_A')])).toBe(false)
    expect(toasts).toEqual([['img2img', 'Batch generation already running', 'error']])
    expect(posts.length).toBe(before)
  })

  it('every style already has a preview: info toast, no batch', () => {
    have.add('BODY_A')
    expect(runner.start('txt2img', 'BODY', SRC, [row('BODY_A')])).toBe(false)
    expect(toasts).toEqual([['txt2img', 'All styles already have previews', 'info']])
    expect(posts).toEqual([])
    expect(runner.isRunning()).toBe(false)
  })
})

describe('single preview progress', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('generating once, exactly one done with source_file, then SG_THUMB_DONE', async () => {
    const posted: Msg[] = []
    const jobs: Record<string, unknown> = {}
    const report = createSinglePreviewReporter('BODY_A', SRC, jobs, {
      post: (m: Msg) => posted.push(m),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      now: () => 1234,
    })
    // generateThumbnail reports "generating" on start and on every poll, then "done".
    report('generating')
    report('generating')
    expect(jobs).toEqual({ [previewJobKey('BODY_A', SRC)]: { styleId: 'BODY_A', source_file: SRC } })
    report('generating')
    report('done')
    expect(jobs).toEqual({})
    await vi.advanceTimersByTimeAsync(SINGLE_DONE_DELAY_MS)
    expect(posted).toEqual([
      { type: 'SG_THUMB_PROGRESS', status: 'generating', styleId: 'BODY_A', source_file: SRC },
      { type: 'SG_THUMB_PROGRESS', status: 'done', styleId: 'BODY_A', source_file: SRC },
      { type: 'SG_THUMB_DONE', styleId: 'BODY_A', version: 1234, source_file: SRC },
    ])
  })

  it('error clears the job; nothing follows it', async () => {
    const posted: Msg[] = []
    const jobs: Record<string, unknown> = {}
    const report = createSinglePreviewReporter('BODY_A', '', jobs, {
      post: (m: Msg) => posted.push(m),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      now: () => 1,
    })
    report('generating')
    report('error')
    report('done')
    await vi.runAllTimersAsync()
    expect(jobs).toEqual({})
    expect(posted).toEqual([
      { type: 'SG_THUMB_PROGRESS', status: 'generating', styleId: 'BODY_A', source_file: '' },
      { type: 'SG_THUMB_PROGRESS', status: 'error', styleId: 'BODY_A', source_file: '' },
    ])
  })
})

describe('SG_READY re-post', () => {
  it('re-posts the running batch and every single job still generating', () => {
    const batch = progress({ status: 'running', total: 4, processed: 1, newCount: 1, alreadyHad: 0, skipped: 0, failed: 0 })
    const posted: Msg[] = []
    repostPreviewState(
      {
        sgBatchLast: batch,
        sgPreviewJobs: {
          [previewJobKey('BODY_A', SRC)]: { styleId: 'BODY_A', source_file: SRC },
          [previewJobKey('HAIR_B', 'webui/h.csv')]: { styleId: 'HAIR_B', source_file: 'webui/h.csv' },
        },
      },
      (m: Msg) => posted.push(m),
    )
    expect(posted).toEqual([
      batch,
      { type: 'SG_THUMB_PROGRESS', status: 'generating', styleId: 'BODY_A', source_file: SRC },
      { type: 'SG_THUMB_PROGRESS', status: 'generating', styleId: 'HAIR_B', source_file: 'webui/h.csv' },
    ])
  })

  it.each(['finished', 'cancelled'])('a %s batch is not re-posted', (status) => {
    const posted: Msg[] = []
    repostPreviewState({ sgBatchLast: progress({ status }), sgPreviewJobs: {} }, (m: Msg) => posted.push(m))
    expect(posted).toEqual([])
  })
})

describe('SG_BATCH_CANCEL / SG_BATCH_SKIP parsing', () => {
  it.each(['SG_BATCH_CANCEL', 'SG_BATCH_SKIP'])('%s is type-only', (type) => {
    expect(parseFrameMessage({ type })).toEqual({ type })
    expect(parseFrameMessage({ type, tab: 'img2img', extra: 1 })).toEqual({ type })
  })
})

describe('host wiring (source checks)', () => {
  const messages = read('javascript/style_grid/handlers/iframe-messages.js')
  const batchWiring = read('javascript/style_grid/handlers/thumbnails-batch.js')

  it('the host batch window and its styles are gone', () => {
    for (const rel of [
      'javascript/style_grid/handlers/thumbnails-batch.js',
      'javascript/style_grid/handlers/batch-runner.js',
      'javascript/style_grid/render.js',
    ]) {
      expect(read(rel)).not.toContain('sg-batch-overlay')
    }
    expect(read('style.css')).not.toContain('.sg-batch-')
    expect(batchWiring).not.toMatch(/\bdocument\.|\bel\(/)
  })

  it('cancel / skip / single progress / SG_READY re-post are wired in iframe-messages.js', () => {
    expect(messages).toMatch(/msg\.type === "SG_BATCH_CANCEL"\) \{\s*cancelBatchThumbnails\(tab\);/)
    expect(messages).toMatch(/msg\.type === "SG_BATCH_SKIP"\) \{\s*skipBatchThumbnails\(tab\);/)
    expect(messages).toMatch(/generateThumbnail\(tab, msg\.styleId, function \(\) \{\}, reportSingle, genSource\);/)
    expect(messages).toMatch(/repostPreviewState\(state\[tab\], function \(m\) \{ postToFrame\(frame, m\); \}\);/)
    expect(messages).toMatch(/startBatchThumbnails\(tab, catName, stylesInCat, batchSource\);/)
    expect(messages).not.toContain('progress: progressValue')
  })
})
