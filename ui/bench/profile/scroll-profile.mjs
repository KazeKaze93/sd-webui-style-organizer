/**
 * GRID-W: CDP CPU profile of bench scroll at N=5000, 4× CPU.
 * Default: vite preview (production). Pass --dev for sourcemaps/jsxDEV.
 *
 * Usage (from ui/):
 *   node bench/profile/scroll-profile.mjs
 *   node bench/profile/scroll-profile.mjs --port 5174
 *   node bench/profile/scroll-profile.mjs --dev
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import {
  createSourceMapper,
  detectRerenderComponents,
  formatTopTable,
  topSelfFunctions,
  writeJson,
} from './analyze.mjs'
import {
  OUT_DIR,
  PROFILE_ROOT,
  enableProfiling,
  openBench,
  selectFirstSource,
  sleep,
  startVite,
  waitForGridStable,
  waitForUrl,
} from './lib.mjs'

const CPU_THROTTLE = 4
const N = 5000
const SCROLL_MS = 3000

function parseArgs(argv) {
  const out = { port: 5174, headed: false, n: N, dev: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--port') out.port = Number(argv[++i]) || 5174
    else if (a === '--headed') out.headed = true
    else if (a === '--n') out.n = Number(argv[++i]) || N
    else if (a === '--dev') out.dev = true
  }
  return out
}

async function startCpuProfile(client) {
  await client.send('Profiler.start')
}

async function stopCpuProfile(client) {
  const { profile } = await client.send('Profiler.stop')
  return profile
}

/** Install mount/render counters in the panel frame (monkey-patch after load). */
async function installRenderCounters(frame) {
  await frame.evaluate(() => {
    window.__SG_SCROLL_STATS__ = {
      cardMounts: 0,
      cardUnmounts: 0,
      rowRenders: 0,
      cardsRowRenders: 0,
      headerRenders: 0,
    }
    // Count card mounts via MutationObserver on data-sg-card
    const stats = window.__SG_SCROLL_STATS__
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (!(n instanceof HTMLElement)) continue
          if (n.matches?.('[data-sg-card="true"]')) stats.cardMounts += 1
          stats.cardMounts += n.querySelectorAll?.('[data-sg-card="true"]').length || 0
        }
        for (const n of m.removedNodes) {
          if (!(n instanceof HTMLElement)) continue
          if (n.matches?.('[data-sg-card="true"]')) stats.cardUnmounts += 1
          stats.cardUnmounts += n.querySelectorAll?.('[data-sg-card="true"]').length || 0
        }
        // rows: nodes with data-index
        for (const n of m.addedNodes) {
          if (!(n instanceof HTMLElement)) continue
          if (n.hasAttribute?.('data-index')) stats.rowRenders += 1
          stats.rowRenders += n.querySelectorAll?.('[data-index]').length || 0
        }
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })
    window.__SG_SCROLL_MO__ = mo
  })
}

async function dumpVirtualizerConfig(frame) {
  return frame.evaluate(() => {
    const grid = document.querySelector('[data-sg-item-count]')
    const card = document.querySelector('[data-sg-card="true"]')
    let scroller = null
    let el = card
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el)
      const oy = style.overflowY
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) {
        scroller = el
        break
      }
      el = el.parentElement
    }
    const rows = [...document.querySelectorAll('[data-index]')]
    const sizes = rows.slice(0, 12).map((r) => {
      const idx = Number(r.getAttribute('data-index'))
      const rect = r.getBoundingClientRect()
      const kind = r.querySelector('[data-sg-category-header]')
        ? 'header'
        : r.querySelector('[data-sg-card="true"]')
          ? 'cards'
          : 'unknown'
      return {
        index: idx,
        kind,
        heightAttr: r.style.height,
        measuredH: Math.round(rect.height * 10) / 10,
        top: Math.round(rect.top * 10) / 10,
      }
    })
    // Probe consecutive card-row gaps
    const cardRows = rows
      .filter((r) => r.querySelector('[data-sg-card="true"]'))
      .slice(0, 8)
    const gaps = []
    for (let i = 1; i < cardRows.length; i += 1) {
      const a = cardRows[i - 1].getBoundingClientRect()
      const b = cardRows[i].getBoundingClientRect()
      gaps.push(Math.round((b.top - a.bottom) * 10) / 10)
    }
    // Horizontal gap between first two cards in first row
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
    return {
      itemCount: grid?.getAttribute('data-sg-item-count') ?? null,
      mountedCards: document.querySelectorAll('[data-sg-card="true"]').length,
      mountedRows: rows.length,
      scroller: scroller
        ? {
            tag: scroller.tagName,
            className: scroller.className,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
            scrollTop: scroller.scrollTop,
            overflowY: getComputedStyle(scroller).overflowY,
          }
        : null,
      sampleRows: sizes,
      verticalGapsBetweenCardRows: gaps,
      horizontalGapFirstRow: hGap,
      totalInnerHeight: grid?.firstElementChild?.getBoundingClientRect?.().height ?? null,
    }
  })
}

/**
 * Continuously scroll for SCROLL_MS (same scroller discovery as bench/run.mjs).
 */
async function scrollForDuration(frame, durationMs) {
  return frame.evaluate(async (ms) => {
    const card = document.querySelector('[data-sg-card="true"]')
    let scroller = null
    let el = card
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el)
      const oy = style.overflowY
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) {
        scroller = el
        break
      }
      el = el.parentElement
    }
    if (!scroller) {
      scroller = document.scrollingElement || document.documentElement
    }
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const t0 = performance.now()
    let steps = 0
    let direction = 1
    let pos = 0
    const stepPx = Math.max(48, Math.floor(scroller.clientHeight * 0.35))
    while (performance.now() - t0 < ms) {
      pos += direction * stepPx
      if (pos >= maxScroll) {
        pos = maxScroll
        direction = -1
      } else if (pos <= 0) {
        pos = 0
        direction = 1
      }
      scroller.scrollTop = pos
      steps += 1
      await new Promise((r) => requestAnimationFrame(r))
    }
    return {
      steps,
      maxScroll,
      finalScrollTop: scroller.scrollTop,
      scrollerClass: scroller.className,
      wallMs: performance.now() - t0,
    }
  }, durationMs)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  fs.mkdirSync(OUT_DIR, { recursive: true })

  console.log(`[scroll-profile] N=${args.n} port=${args.port} cpu=${CPU_THROTTLE}x duration=${SCROLL_MS}ms`)

  // Production preview by default (matches gate); pass --dev for jsxDEV/sourcemap profiles.
  const vite = await startVite(args.port, { mode: args.dev ? 'dev' : 'preview' })
  const browser = await chromium.launch({
    headless: !args.headed,
    args: ['--disable-dev-shm-usage', '--disable-gpu'],
  })

  try {
    const baseUrl = await vite.ready
    await waitForUrl(`${baseUrl}/bench/host.html`)
    console.log(`[scroll-profile] vite ready at ${baseUrl}`)

    const bench = await openBench(browser, baseUrl, args.n)
    try {
      await waitForGridStable(bench.frame, args.n)
      // Keep full catalog for N=5000 scroll (do not filter by source).
      void selectFirstSource
      await sleep(300)

      const configBefore = await dumpVirtualizerConfig(bench.frame)
      console.log('[scroll-profile] virtualizer dump (before):')
      console.log(JSON.stringify(configBefore, null, 2))

      await installRenderCounters(bench.frame)

      await bench.client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
      const { scripts } = await enableProfiling(bench.client)

      // Reset counters right before profile
      await bench.frame.evaluate(() => {
        const s = window.__SG_SCROLL_STATS__
        if (s) {
          s.cardMounts = 0
          s.cardUnmounts = 0
          s.rowRenders = 0
        }
      })

      await startCpuProfile(bench.client)
      const t0 = Date.now()
      const scrollMeta = await scrollForDuration(bench.frame, SCROLL_MS)
      const profile = await stopCpuProfile(bench.client)
      const wallMs = Date.now() - t0

      const renderStats = await bench.frame.evaluate(() => window.__SG_SCROLL_STATS__ || null)
      const configAfter = await dumpVirtualizerConfig(bench.frame)

      const outFile = path.join(OUT_DIR, `N${args.n}-scroll.cpuprofile`)
      writeJson(outFile, profile)
      console.log(`[scroll-profile] wrote ${outFile} wall=${wallMs}ms`)

      const mapper = createSourceMapper(baseUrl, scripts)
      await mapper.warm()
      const top = await topSelfFunctions(profile, mapper, 15)
      const rerenders = await detectRerenderComponents(profile, mapper)

      const summary = {
        createdAt: new Date().toISOString(),
        scenario: 'scroll',
        n: args.n,
        cpuThrottle: CPU_THROTTLE,
        scrollDurationMs: SCROLL_MS,
        wallMs,
        scrollMeta,
        renderStats,
        virtualizerBefore: configBefore,
        virtualizerAfter: configAfter,
        durationMs: top.durationMs,
        totalSelf: top.totalSelf,
        activeSelf: top.activeSelf,
        idleShare: top.idleShare,
        top15: top.top,
        rerenders,
      }

      const summaryPath = path.join(OUT_DIR, `N${args.n}-scroll.summary.json`)
      writeJson(summaryPath, summary)

      const reportPath = path.join(PROFILE_ROOT, 'scroll-report.md')
      const lines = [
        '# GRID-W — Scroll CPU profile',
        '',
        `Generated: ${summary.createdAt}`,
        '',
        `N=${args.n}, CPU ${CPU_THROTTLE}×, vite **${vite.mode}**, scroll ${SCROLL_MS}ms`,
        '',
        '## Virtualizer config dump',
        '',
        '```json',
        JSON.stringify(
          {
            scrollElement: configBefore.scroller,
            sampleRows: configBefore.sampleRows,
            verticalGaps: configBefore.verticalGapsBetweenCardRows,
            horizontalGap: configBefore.horizontalGapFirstRow,
            mountedCards: configBefore.mountedCards,
            mountedRows: configBefore.mountedRows,
            totalInnerHeight: configBefore.totalInnerHeight,
            note: 'estimateSize/overscan/measureElement/rangeExtractor read from source (see VirtualStyleGrid.tsx)',
          },
          null,
          2,
        ),
        '```',
        '',
        '## Render / mount counts during scroll',
        '',
        '```json',
        JSON.stringify({ scrollMeta, renderStats }, null, 2),
        '```',
        '',
        `Wall: **${wallMs} ms** · Profile duration: **${top.durationMs?.toFixed?.(1) ?? top.durationMs} ms** · Idle share: ${((top.idleShare || 0) * 100).toFixed(1)}%`,
        '',
        '## Top 15 self-time',
        '',
        formatTopTable(top.top || []),
        '',
        '## Components on stacks',
        '',
      ]
      if (rerenders?.components?.length) {
        for (const c of rerenders.components) {
          lines.push(`- \`${c.name}\` — ${c.hits} stack hit(s)`)
        }
      } else {
        lines.push('_none_')
      }
      lines.push('')
      fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8')
      console.log(`[scroll-profile] wrote ${reportPath}`)
      console.log('')
      console.log(formatTopTable(top.top || []))
      console.log('renderStats', renderStats)
      console.log('gaps v/h', configBefore.verticalGapsBetweenCardRows, configBefore.horizontalGapFirstRow)
    } finally {
      await bench.close()
    }
  } finally {
    await browser.close()
    await vite.stop()
  }
}

main().catch((err) => {
  console.error('[scroll-profile] FAILED', err)
  process.exitCode = 1
})
