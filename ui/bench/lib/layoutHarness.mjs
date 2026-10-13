/**
 * Shared Playwright helpers for layout invariant runs (bench-only).
 */
import {
  DENSITIES,
  DENSITY_METRICS,
  SCROLL_SCREENS,
  checkLayoutInFrame,
  formatLayoutResult,
  inflateCardHeights,
  restoreCardHeights,
} from './layoutInvariants.mjs'

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Toggle compact / fullscreen to match density label.
 * @param {import('playwright').Frame} frame
 * @param {'normal' | 'compact' | 'fullscreen'} mode
 */
export async function setDensity(frame, mode) {
  await frame.evaluate((m) => {
    const byLabel = (re) =>
      [...document.querySelectorAll('button')].find((b) =>
        re.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''),
      )

    const compactBtn = byLabel(/compact mode/i)
    const fsBtn = byLabel(/^(exit )?fullscreen$/i)

    const compactOn =
      compactBtn &&
      (compactBtn.getAttribute('aria-pressed') === 'true' ||
        /\bbg-sg-accent\b/.test(compactBtn.className) ||
        compactBtn.dataset.state === 'on')

    const wantCompact = m === 'compact'
    if (compactBtn && Boolean(compactOn) !== wantCompact) compactBtn.click()

    const isFs = Boolean(fsBtn && /exit fullscreen/i.test(fsBtn.getAttribute('aria-label') || ''))
    const wantFs = m === 'fullscreen'
    if (fsBtn && isFs !== wantFs) fsBtn.click()
  }, mode)
  await sleep(250)
  await frame.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )
}

/**
 * @param {import('playwright').Frame} frame
 * @param {number} [screens]
 */
export async function scrollScreens(frame, screens = SCROLL_SCREENS) {
  await frame.evaluate((n) => {
    const card = document.querySelector('[data-sg-card="true"]')
    let scroller = null
    let el = card
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el)
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 8
      ) {
        scroller = el
        break
      }
      el = el.parentElement
    }
    if (!scroller) return
    scroller.scrollTop = scroller.clientHeight * n
  }, screens)
  await sleep(150)
  await frame.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )
}

/**
 * Prefer a single source so duplicate-name rows do not open the source picker.
 * @param {import('playwright').Frame} frame
 */
export async function selectFirstSource(frame) {
  await frame.evaluate(() => {
    const select = document.querySelector('select')
    if (!(select instanceof HTMLSelectElement) || select.options.length < 2) return
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    proto?.call(select, select.options[1].value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await sleep(100)
}

/**
 * Apply pre-selected styles via store (exposed only if panel has setSelectedStyles).
 * Falls back to clicking the first N cards.
 * @param {import('playwright').Frame} frame
 * @param {Array<{ name: string, source_file: string }>} selected
 */
export async function applySelected(frame, selected) {
  if (!selected?.length) return
  const applied = await frame.evaluate((rows) => {
    // Store is not on window; click cards that match selected names.
    const want = new Set(rows.map((r) => r.name))
    const cards = [...document.querySelectorAll('[data-sg-card="true"]')]
    let clicks = 0
    for (const card of cards) {
      const title = (card.getAttribute('title') || '').split('\n')[0]
      if (!want.has(title)) continue
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      clicks += 1
      if (clicks >= rows.length) break
    }
    return clicks
  }, selected)
  await sleep(100)
  return applied
}

/**
 * Run invariants for every density at top + after SCROLL_SCREENS.
 * @param {import('playwright').Frame} frame
 * @param {{ n: number, densities?: string[] }} opts
 */
export async function runLayoutInvariantsForFrame(frame, opts) {
  const densities = opts.densities ?? [...DENSITIES]
  /** @type {Array<{ n: number, density: string, position: string, ok: boolean, result: object }>} */
  const results = []
  let allOk = true

  for (const density of densities) {
    const metrics = DENSITY_METRICS[density]
    if (!metrics) throw new Error(`Unknown density: ${density}`)

    await setDensity(frame, density)
    // Reset scroll to top for this density.
    await frame.evaluate(() => {
      const card = document.querySelector('[data-sg-card="true"]')
      let el = card
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el)
        if (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 8
        ) {
          el.scrollTop = 0
          return
        }
        el = el.parentElement
      }
    })
    await sleep(100)

    for (const position of ['top', `scroll${SCROLL_SCREENS}`]) {
      if (position !== 'top') {
        await scrollScreens(frame, SCROLL_SCREENS)
      }
      const result = await checkLayoutInFrame(frame, metrics)
      const label = `N=${opts.n} ${density} ${position}`
      console.log(formatLayoutResult(label, result))
      if (!result.ok) allOk = false
      results.push({ n: opts.n, density, position, ok: result.ok, result })
    }
  }

  // Leave UI in normal density for subsequent benches.
  await setDensity(frame, 'normal')

  return { ok: allOk, results }
}

/**
 * Prove the checker can FAIL: inflate card heights, expect height offenders, restore.
 * @param {import('playwright').Frame} frame
 * @param {{ n: number }} opts
 */
export async function proveFailPath(frame, opts) {
  await setDensity(frame, 'normal')
  const metrics = DENSITY_METRICS.normal
  const prev = await inflateCardHeights(frame, metrics.cardRowHeight + 24)
  await sleep(50)
  const result = await checkLayoutInFrame(frame, metrics)
  await restoreCardHeights(frame, prev)
  const label = `N=${opts.n} normal top (inflate-self-test)`
  console.log(formatLayoutResult(label, result))
  const heightOffenders = result.offenders.filter((o) => o.kind === 'height')
  const proved = !result.ok && heightOffenders.length > 0
  if (!proved) {
    console.error(
      '[layout] FAIL-path self-test did not observe height offenders — checker may be broken',
    )
  } else {
    console.log(
      `[layout] FAIL-path self-test OK (${heightOffenders.length} height offenders with inflated cards)`,
    )
  }
  return { ok: proved, result }
}
