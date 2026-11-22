/** @vitest-environment jsdom */
import { act, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, type BatchProgress } from '../../bridge'
import { BatchAnnouncer } from '../BatchAnnouncer'
import { useStylesStore } from '../../store/stylesStore'
import { CategoryHeaderRow } from './CategoryHeaderRow'
import { HEADER_CONTENT_HEIGHT_PX } from './constants'

vi.mock('../../bridge', async () => {
  const actual = await vi.importActual<typeof import('../../bridge')>('../../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const report = (fields: Partial<BatchProgress> = {}): BatchProgress => ({
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

describe('category header batch status', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let renders: Record<string, number>

  const header = (cat: string) => host!.querySelector<HTMLElement>(`[data-sg-category-header="${cat}"]`)!
  const statusEl = (cat: string) => header(cat).querySelector<HTMLElement>('[data-sg-batch-status]')
  const text = (cat: string) => statusEl(cat)?.querySelector('[data-sg-batch-text]')?.textContent ?? null
  const bar = (cat: string) => header(cat).querySelector<HTMLElement>('[data-sg-batch-bar]')
  const announcer = () => host!.querySelector<HTMLElement>('[data-sg-batch-announcer]')!
  const apply = async (b: BatchProgress) => {
    await act(async () => useStylesStore.getState().applyBatchProgress(b))
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.mocked(sendToHost).mockClear()
    renders = { BODY: 0, HAIR: 0 }
    useStylesStore.setState({ previewBatch: null, previewJobs: new Map(), selectedCountByCategory: new Map() })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const row = (category: string, rowIndex: number) => (
      <Profiler id={category} onRender={() => { renders[category] += 1 }}>
        <CategoryHeaderRow
          category={category}
          count={3}
          collapsed={false}
          isStickyActive={false}
          enableLoraContextMenu={false}
          rowIndex={rowIndex}
          focusedCol={null}
          onToggleCollapse={() => {}}
          onSelectAll={() => {}}
        />
      </Profiler>
    )
    await act(async () => {
      root!.render(
        <>
          {row('BODY', 0)}
          {row('HAIR', 1)}
          <BatchAnnouncer />
        </>,
      )
    })
    renders = { BODY: 0, HAIR: 0 }
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('running: spinner, "Generating previews p / t", Skip and Cancel before Select All', async () => {
    await apply(report({ processed: 4, newCount: 4 }))
    const s = statusEl('BODY')!
    expect(text('BODY')).toBe('Generating previews 4 / 12')
    expect(s.className).toContain('text-xs')
    expect(s.className).toContain('text-sg-wildcard-text')
    expect(s.querySelector('svg.lucide-loader-circle')).not.toBeNull()
    // Order in the header: name cell, status, Select All cell.
    const kids = [...header('BODY').children]
    expect(kids.indexOf(s)).toBe(1)
    expect(kids[2].querySelector('button')!.textContent).toBe('Select All')
    const skip = s.querySelector<HTMLButtonElement>('[data-sg-batch-skip]')!
    const cancel = s.querySelector<HTMLButtonElement>('[data-sg-batch-cancel]')!
    expect([skip.textContent, cancel.textContent]).toEqual(['Skip', 'Cancel'])
    expect([skip.tabIndex, cancel.tabIndex]).toEqual([-1, -1])
    expect(cancel.className).toContain('border border-sg-border')
    expect(statusEl('HAIR')).toBeNull()
  })

  it('narrow panel: the name keeps its width, the words hide, the full text stays in title', async () => {
    const nameCell = () => header('BODY').querySelector('[data-cell-col="0"]')!.parentElement!
    expect(nameCell().className).toBe('min-w-0 flex-1')
    await apply(report({ processed: 4 }))
    expect(nameCell().className).toBe('min-w-fit flex-1')
    const t = statusEl('BODY')!.querySelector<HTMLElement>('[data-sg-batch-text]')!
    expect(t.querySelector('span')!.className).toBe('max-[799px]:hidden')
    expect(t.querySelector('span')!.textContent).toBe('Generating previews ')
    expect(t.title).toBe('Generating previews 4 / 12')
    expect(statusEl('BODY')!.className).toContain('min-w-0')
    expect(statusEl('HAIR')).toBeNull()
    expect(header('HAIR').querySelector('[data-cell-col="0"]')!.parentElement!.className).toBe('min-w-0 flex-1')
  })

  it('Skip sends SG_BATCH_SKIP, Cancel sends SG_BATCH_CANCEL', async () => {
    await apply(report())
    await act(async () => statusEl('BODY')!.querySelector<HTMLButtonElement>('[data-sg-batch-skip]')!.click())
    await act(async () => statusEl('BODY')!.querySelector<HTMLButtonElement>('[data-sg-batch-cancel]')!.click())
    expect(vi.mocked(sendToHost).mock.calls).toEqual([[{ type: 'SG_BATCH_SKIP' }], [{ type: 'SG_BATCH_CANCEL' }]])
  })

  it('2 px bar at the bottom edge, width = processed / total; header height unchanged', async () => {
    await apply(report({ processed: 3 }))
    const b = bar('BODY')!
    expect(b.className).toContain('absolute inset-x-0 bottom-0 h-0.5')
    expect(b.getAttribute('aria-hidden')).toBe('true')
    expect((b.firstElementChild as HTMLElement).style.width).toBe('25%')
    expect(header('BODY').classList.contains('relative')).toBe(true)
    expect(header('BODY').style.height).toBe(`${HEADER_CONTENT_HEIGHT_PX}px`)
    await apply(report({ processed: 9 }))
    expect((bar('BODY')!.firstElementChild as HTMLElement).style.width).toBe('75%')
  })

  it('only the matching category header re-renders on progress', async () => {
    await apply(report({ processed: 1 }))
    await apply(report({ processed: 2 }))
    await apply(report({ processed: 3 }))
    expect(renders.BODY).toBe(3)
    expect(renders.HAIR).toBe(0)
  })

  it('finished: result for 3 s with only non-zero parts, no buttons, no bar, then nothing', async () => {
    await apply(report({ processed: 6 }))
    await apply(report({ status: 'finished', processed: 12, newCount: 9, alreadyHad: 0, skipped: 1, failed: 2 }))
    expect(text('BODY')).toBe('Previews ready: 9 new · 1 skipped · 2 failed')
    expect(statusEl('BODY')!.querySelector('button')).toBeNull()
    expect(statusEl('BODY')!.querySelector('svg')).toBeNull()
    expect(bar('BODY')).toBeNull()
    await act(async () => vi.advanceTimersByTime(3000))
    expect(statusEl('BODY')).toBeNull()
  })

  it('cancelled: "Cancelled after p / t"', async () => {
    await apply(report({ processed: 4 }))
    await apply(report({ status: 'cancelled', processed: 4, newCount: 4 }))
    expect(text('BODY')).toBe('Cancelled after 4 / 12')
    expect(statusEl('BODY')!.querySelector('button')).toBeNull()
  })

  it('the live region announces start and end only, not every tick', async () => {
    expect(announcer().getAttribute('aria-live')).toBe('polite')
    expect(announcer().className).toContain('sr-only')
    await apply(report())
    expect(announcer().textContent).toBe('Generating previews for BODY: 12 styles')
    await apply(report({ processed: 5, newCount: 5 }))
    expect(announcer().textContent).toBe('Generating previews for BODY: 12 styles')
    await apply(report({ status: 'finished', processed: 12, newCount: 10, alreadyHad: 2, skipped: 2 }))
    expect(announcer().textContent).toBe('BODY: Previews ready: 10 new · 2 already had · 2 skipped')
    await act(async () => vi.advanceTimersByTime(3000))
    await apply(report({ category: 'HAIR', total: 2 }))
    await apply(report({ category: 'HAIR', total: 2, status: 'cancelled', processed: 1, newCount: 1 }))
    expect(announcer().textContent).toBe('HAIR: Cancelled after 1 / 2')
    expect(header('BODY').hasAttribute('aria-live')).toBe(false)
  })
})
