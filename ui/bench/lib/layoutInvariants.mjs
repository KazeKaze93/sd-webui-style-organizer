/**
 * Grid layout invariants (bench-only).
 *
 * Mirrors ui/src/components/grid/constants.ts — keep in sync when metrics change.
 *
 * For every density × (top | after 3 screens):
 *   (1) card height <= CARD_ROW_HEIGHT - ROW_GAP + 0.5
 *   (2) vertical gap between adjacent card-rows == ROW_GAP ±0.5
 *       and == horizontal gap ±0.5
 *   (3) no card rect overlaps another
 *
 * Failures collect up to MAX_OFFENDERS details.
 */

export const TOLERANCE_PX = 0.5
export const MAX_OFFENDERS = 10
export const SCROLL_SCREENS = 3

/**
 * Densities exercised by layout bench.
 * - normal: default panel (windowed=true, compact off) → windowed card + normal gap
 * - compact: compact toggle (windowed=true) → windowed card + compact gap
 * - fullscreen: Fullscreen → normal card chrome + normal gap
 */
export const DENSITY_METRICS = Object.freeze({
  normal: Object.freeze({
    cardRowHeight: 42, // CARD_ROW_HEIGHT_WINDOWED_PX = 34 + 8
    rowGap: 8, // ROW_GAP_NORMAL_PX
  }),
  compact: Object.freeze({
    cardRowHeight: 38, // CARD_ROW_HEIGHT_WINDOWED_COMPACT_PX = 34 + 4
    rowGap: 4, // ROW_GAP_COMPACT_PX
  }),
  fullscreen: Object.freeze({
    cardRowHeight: 54, // CARD_ROW_HEIGHT_NORMAL_PX = 46 + 8
    rowGap: 8,
  }),
})

export const DENSITIES = Object.freeze(Object.keys(DENSITY_METRICS))

/**
 * Pure check over measured card/row geometry. Runnable in Node or via page.evaluate.
 *
 * @param {{
 *   cards: Array<{ name: string, top: number, right: number, bottom: number, left: number, width: number, height: number }>
 *   rowPairs: Array<{ prevIndex: number, nextIndex: number, vGap: number, prevName: string, nextName: string }>
 *   hGaps: number[]
 *   cardRowHeight: number
 *   rowGap: number
 * }} sample
 */
export function evaluateLayoutSample(sample) {
  const { cards, rowPairs, hGaps, cardRowHeight, rowGap } = sample
  const maxCardH = cardRowHeight - rowGap + TOLERANCE_PX
  /** @type {Array<{ kind: string, detail: string }>} */
  const offenders = []

  const push = (kind, detail) => {
    if (offenders.length < MAX_OFFENDERS) offenders.push({ kind, detail })
  }

  // (1) card height vs virtualizer budget
  for (const c of cards) {
    if (c.height > maxCardH) {
      push(
        'height',
        `${c.name || '(unnamed)'} height=${round1(c.height)} > max=${round1(maxCardH)} ` +
          `(rowH=${cardRowHeight} gap=${rowGap})`,
      )
    }
  }

  // (2) vertical gaps == ROW_GAP; also match horizontal gap
  const hGap = hGaps.length
    ? hGaps.reduce((a, b) => a + b, 0) / hGaps.length
    : null

  for (const pair of rowPairs) {
    if (Math.abs(pair.vGap - rowGap) > TOLERANCE_PX) {
      push(
        'vgap',
        `rows ${pair.prevIndex}→${pair.nextIndex} vGap=${round1(pair.vGap)} ` +
          `expected ${rowGap}±${TOLERANCE_PX} (${pair.prevName} / ${pair.nextName})`,
      )
    }
    if (hGap != null && Math.abs(pair.vGap - hGap) > TOLERANCE_PX) {
      push(
        'gap-parity',
        `rows ${pair.prevIndex}→${pair.nextIndex} vGap=${round1(pair.vGap)} ` +
          `!= hGap=${round1(hGap)}±${TOLERANCE_PX}`,
      )
    }
  }

  if (hGap != null && Math.abs(hGap - rowGap) > TOLERANCE_PX) {
    push('hgap', `hGap=${round1(hGap)} expected ${rowGap}±${TOLERANCE_PX}`)
  }

  // (3) no overlaps
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const a = cards[i]
      const b = cards[j]
      if (rectsOverlap(a, b)) {
        push(
          'overlap',
          `${a.name || i} ↔ ${b.name || j} ` +
            `(${round1(a.left)},${round1(a.top)},${round1(a.width)}x${round1(a.height)}) ` +
            `(${round1(b.left)},${round1(b.top)},${round1(b.width)}x${round1(b.height)})`,
        )
      }
    }
  }

  return {
    ok: offenders.length === 0,
    cardCount: cards.length,
    rowPairCount: rowPairs.length,
    hGap: hGap == null ? null : round1(hGap),
    expectedRowGap: rowGap,
    maxCardHeight: round1(maxCardH),
    offenders,
  }
}

/**
 * Browser-side sampler: read visible `[data-sg-card]` geometry + consecutive card-row gaps.
 * Designed to run inside Playwright `frame.evaluate`.
 *
 * @param {{ cardRowHeight: number, rowGap: number }} metrics
 */
export function sampleLayoutInPage(metrics) {
  const cardEls = [...document.querySelectorAll('[data-sg-card="true"]')]
  const cards = cardEls.map((el) => {
    const r = el.getBoundingClientRect()
    const title = (el.getAttribute('title') || '').split('\n')[0] || ''
    return {
      name: title,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      left: r.left,
      width: r.width,
      height: r.height,
    }
  })

  const cardRows = [...document.querySelectorAll('[data-index]')].filter((row) =>
    row.querySelector('[data-sg-card="true"]'),
  )

  /** @type {Array<{ prevIndex: number, nextIndex: number, vGap: number, prevName: string, nextName: string }>} */
  const rowPairs = []
  for (let i = 1; i < cardRows.length; i += 1) {
    const prev = cardRows[i - 1]
    const next = cardRows[i]
    const prevIdx = Number(prev.getAttribute('data-index'))
    const nextIdx = Number(next.getAttribute('data-index'))
    if (!Number.isFinite(prevIdx) || nextIdx !== prevIdx + 1) continue
    const prevCard = prev.querySelector('[data-sg-card="true"]')
    const nextCard = next.querySelector('[data-sg-card="true"]')
    if (!prevCard || !nextCard) continue
    const a = prevCard.getBoundingClientRect()
    const b = nextCard.getBoundingClientRect()
    rowPairs.push({
      prevIndex: prevIdx,
      nextIndex: nextIdx,
      vGap: b.top - a.bottom,
      prevName: (prevCard.getAttribute('title') || '').split('\n')[0] || '',
      nextName: (nextCard.getAttribute('title') || '').split('\n')[0] || '',
    })
  }

  /** @type {number[]} */
  const hGaps = []
  for (const row of cardRows) {
    const rowCards = [...row.querySelectorAll('[data-sg-card="true"]')]
    for (let i = 1; i < rowCards.length; i += 1) {
      const a = rowCards[i - 1].getBoundingClientRect()
      const b = rowCards[i].getBoundingClientRect()
      if (Math.abs(a.top - b.top) > 2) continue
      hGaps.push(b.left - a.right)
    }
  }

  return {
    cards,
    rowPairs,
    hGaps,
    cardRowHeight: metrics.cardRowHeight,
    rowGap: metrics.rowGap,
  }
}

/**
 * Run sampler + evaluate inside a Playwright frame.
 * @param {import('playwright').Frame} frame
 * @param {{ cardRowHeight: number, rowGap: number }} metrics
 */
export async function checkLayoutInFrame(frame, metrics) {
  const sample = await frame.evaluate(sampleLayoutInPage, metrics)
  return evaluateLayoutSample(sample)
}

/**
 * Inflate every visible card height (temporary fixture for FAIL-path self-test).
 * Returns prior inline heights so the caller can restore.
 * @param {import('playwright').Frame} frame
 * @param {number} heightPx
 */
export async function inflateCardHeights(frame, heightPx) {
  return frame.evaluate((h) => {
    const cards = [...document.querySelectorAll('[data-sg-card="true"]')]
    return cards.map((el) => {
      const prev = el.style.height
      el.style.height = `${h}px`
      el.style.maxHeight = `${h}px`
      el.style.overflow = 'visible'
      return prev
    })
  }, heightPx)
}

/**
 * @param {import('playwright').Frame} frame
 * @param {string[]} previousHeights
 */
export async function restoreCardHeights(frame, previousHeights) {
  await frame.evaluate((prev) => {
    const cards = [...document.querySelectorAll('[data-sg-card="true"]')]
    for (let i = 0; i < cards.length; i += 1) {
      cards[i].style.height = prev[i] ?? ''
      cards[i].style.maxHeight = ''
    }
  }, previousHeights)
}

function rectsOverlap(a, b) {
  // Strict overlap (shared edge = abutting = OK).
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function round1(n) {
  return Math.round(n * 10) / 10
}

/**
 * Pretty-print one check result.
 * @param {string} label
 * @param {ReturnType<typeof evaluateLayoutSample>} result
 */
export function formatLayoutResult(label, result) {
  const head = result.ok
    ? `PASS ${label} cards=${result.cardCount} hGap=${result.hGap} rowGap=${result.expectedRowGap}`
    : `FAIL ${label} cards=${result.cardCount} offenders=${result.offenders.length}`
  const lines = [head]
  for (const o of result.offenders) {
    lines.push(`  - [${o.kind}] ${o.detail}`)
  }
  return lines.join('\n')
}
