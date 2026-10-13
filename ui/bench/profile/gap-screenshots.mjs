/**
 * GRID-W: gap screenshots at N=500 and N=5000 × 3 densities × top/scrolled.
 *
 * Densities:
 *   normal  — panel default (windowed=true in App, compact off)
 *   compact — compact toggle on
 *   fullscreen — isFullscreen (windowed=false, larger cards)
 *
 * Usage (from ui/):
 *   node bench/profile/gap-screenshots.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import {
  OUT_DIR,
  PROFILE_ROOT,
  openBench,
  sleep,
  startVite,
  waitForGridStable,
  waitForUrl,
} from './lib.mjs'

const SHOT_DIR = path.join(OUT_DIR, 'gap-shots')

function parseArgs(argv) {
  const out = { port: 5175, headed: false, sizes: [500, 5000] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--port') out.port = Number(argv[++i]) || 5175
    else if (a === '--headed') out.headed = true
    else if (a === '--sizes') {
      out.sizes = String(argv[++i])
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => n > 0)
    }
  }
  return out
}

async function measureGaps(frame) {
  return frame.evaluate(() => {
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

    const cardRows = [...document.querySelectorAll('[data-index]')].filter((r) =>
      r.querySelector('[data-sg-card="true"]'),
    )
    // Only consecutive virtual indexes (skip header-separated category jumps).
    const vGaps = []
    for (let i = 1; i < Math.min(cardRows.length, 12); i += 1) {
      const prev = cardRows[i - 1]
      const next = cardRows[i]
      const prevIdx = Number(prev.getAttribute('data-index'))
      const nextIdx = Number(next.getAttribute('data-index'))
      if (!Number.isFinite(prevIdx) || nextIdx !== prevIdx + 1) continue
      const prevCards = prev.querySelectorAll('[data-sg-card="true"]')
      const nextCards = next.querySelectorAll('[data-sg-card="true"]')
      if (!prevCards.length || !nextCards.length) continue
      const a = prevCards[0].getBoundingClientRect()
      const b = nextCards[0].getBoundingClientRect()
      vGaps.push(Math.round((b.top - a.bottom) * 10) / 10)
    }

    let hGap = null
    const firstRow = cardRows[0]
    if (firstRow) {
      const cards = [...firstRow.querySelectorAll('[data-sg-card="true"]')]
      if (cards.length >= 2) {
        const a = cards[0].getBoundingClientRect()
        const b = cards[1].getBoundingClientRect()
        hGap = Math.round((b.left - a.right) * 10) / 10
      }
    }

    const rowHeights = cardRows.slice(0, 6).map((r) => ({
      index: Number(r.getAttribute('data-index')),
      rowH: Math.round(r.getBoundingClientRect().height * 10) / 10,
      padB: r.style.paddingBottom,
      heightAttr: r.style.height,
      cardH: Math.round(
        (r.querySelector('[data-sg-card="true"]')?.getBoundingClientRect().height || 0) * 10,
      ) / 10,
    }))

    return {
      hGap,
      vGaps,
      vGapMedian: vGaps.length
        ? [...vGaps].sort((a, b) => a - b)[Math.floor(vGaps.length / 2)]
        : null,
      match: hGap != null && vGaps.every((g) => Math.abs(g - hGap) <= 1),
      rowHeights,
      scrollTop: scroller?.scrollTop ?? null,
      headers: document.querySelectorAll('[data-sg-category-header]').length,
      selectAllButtons: [...document.querySelectorAll('button')].filter((b) =>
        /select all|deselect all/i.test(b.textContent || ''),
      ).length,
    }
  })
}

async function setDensity(frame, _page, mode) {
  // ToolBtn uses aria-label from `label` prop (icon-only toolbar).
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

    // Fullscreen enlarges cards (windowed=false). Detect via Maximize/Minimize icons'
    // aria-label: "Fullscreen" vs "Exit fullscreen".
    const isFs = Boolean(fsBtn && /exit fullscreen/i.test(fsBtn.getAttribute('aria-label') || ''))
    const wantFs = m === 'fullscreen'
    if (fsBtn && isFs !== wantFs) fsBtn.click()
  }, mode)
  await sleep(250)
}

async function scrollScreens(frame, screens = 3) {
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
}

async function clickFirstSidebarCategory(frame) {
  // Sidebar category buttons — skip All / Favorites / Recent / LoRA / presets
  const clicked = await frame.evaluate(() => {
    const skip = /^(all|★|🕑|lora|presets|favorites|recent)/i
    const buttons = [...document.querySelectorAll('button, [role="button"]')]
    for (const b of buttons) {
      const t = (b.textContent || '').trim()
      if (!t || t.length > 40) continue
      if (skip.test(t)) continue
      // category rows often show a count
      if (/\(\d+\)/.test(t) || /^[A-Z0-9_ -]+$/i.test(t)) {
        b.click()
        return t.slice(0, 60)
      }
    }
    return null
  })
  await sleep(250)
  return clicked
}

async function shot(page, frame, name) {
  const file = path.join(SHOT_DIR, `${name}.png`)
  // Clip to panel iframe area
  const panel = page.locator('#panel')
  await panel.screenshot({ path: file })
  const gaps = await measureGaps(frame)
  return { file, gaps }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  fs.mkdirSync(SHOT_DIR, { recursive: true })

  const vite = await startVite(args.port, { mode: 'preview' })
  const browser = await chromium.launch({
    headless: !args.headed,
    args: ['--disable-dev-shm-usage', '--disable-gpu'],
  })

  /** @type {any[]} */
  const verdicts = []

  try {
    const baseUrl = await vite.ready
    await waitForUrl(`${baseUrl}/bench/host.html`)
    console.log(`[gap-shots] vite ${baseUrl}`)

    for (const n of args.sizes) {
      for (const density of ['normal', 'compact', 'fullscreen']) {
        const bench = await openBench(browser, baseUrl, n)
        try {
          await waitForGridStable(bench.frame, n)
          await sleep(200)
          await setDensity(bench.frame, bench.page, density)

          const top = await shot(bench.page, bench.frame, `N${n}-${density}-top`)
          await scrollScreens(bench.frame, 3)
          const scrolled = await shot(bench.page, bench.frame, `N${n}-${density}-scroll3`)

          verdicts.push({
            n,
            density,
            position: 'top',
            match: top.gaps.match,
            hGap: top.gaps.hGap,
            vGapMedian: top.gaps.vGapMedian,
            vGaps: top.gaps.vGaps,
            rowHeights: top.gaps.rowHeights,
            file: top.file,
          })
          verdicts.push({
            n,
            density,
            position: 'scroll3',
            match: scrolled.gaps.match,
            hGap: scrolled.gaps.hGap,
            vGapMedian: scrolled.gaps.vGapMedian,
            vGaps: scrolled.gaps.vGaps,
            rowHeights: scrolled.gaps.rowHeights,
            file: scrolled.file,
          })

          console.log(
            `[gap-shots] N=${n} ${density} top match=${top.gaps.match} h=${top.gaps.hGap} v=${top.gaps.vGapMedian}`,
            top.gaps.vGaps,
          )
          console.log(
            `[gap-shots] N=${n} ${density} scroll3 match=${scrolled.gaps.match} h=${scrolled.gaps.hGap} v=${scrolled.gaps.vGapMedian}`,
            scrolled.gaps.vGaps,
          )
        } finally {
          await bench.close()
        }
      }

      // Single-category sidebar check at this N (normal density)
      const bench = await openBench(browser, baseUrl, n)
      try {
        await waitForGridStable(bench.frame, n)
        const cat = await clickFirstSidebarCategory(bench.frame)
        await sleep(200)
        const gaps = await measureGaps(bench.frame)
        const singleShot = await shot(bench.page, bench.frame, `N${n}-single-category`)
        verdicts.push({
          n,
          density: 'single-category',
          position: 'top',
          category: cat,
          headers: gaps.headers,
          selectAllButtons: gaps.selectAllButtons,
          match: gaps.match,
          hGap: gaps.hGap,
          vGapMedian: gaps.vGapMedian,
          file: singleShot.file,
          note: 'phase A: flat category has no headers / no Select All on grid',
        })
        console.log(
          `[gap-shots] N=${n} single-category cat=${cat} headers=${gaps.headers} selectAll=${gaps.selectAllButtons} match=${gaps.match}`,
        )
      } finally {
        await bench.close()
      }
    }

    const summaryPath = path.join(OUT_DIR, 'gap-shots.summary.json')
    fs.writeFileSync(summaryPath, JSON.stringify({ createdAt: new Date().toISOString(), verdicts }, null, 2))
    const md = [
      '# GRID-W gap screenshot verdicts',
      '',
      `| N | density | pos | hGap | vGap | match | file |`,
      `|---|---------|-----|------|------|-------|------|`,
      ...verdicts.map(
        (v) =>
          `| ${v.n} | ${v.density} | ${v.position} | ${v.hGap} | ${v.vGapMedian ?? v.vGaps} | ${v.match} | ${path.basename(v.file)} |`,
      ),
      '',
    ].join('\n')
    fs.writeFileSync(path.join(PROFILE_ROOT, 'gap-shots.md'), md)
    console.log(`[gap-shots] wrote ${summaryPath}`)
  } finally {
    await browser.close()
    await vite.stop()
  }
}

main().catch((err) => {
  console.error('[gap-shots] FAILED', err)
  process.exitCode = 1
})
