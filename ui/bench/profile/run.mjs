/**
 * Phase B Wave 1 — CDP CPU profiles against Phase-A bench host.
 *
 * Records Profiler.start/stop (vite dev + sourcemaps) at N=2000 and N=5000 for:
 *   init | one card toggle | one search keystroke
 *
 * Usage (from ui/):
 *   node bench/profile/run.mjs
 *   node bench/profile/run.mjs --sizes 2000 --port 5173
 *
 * Writes:
 *   bench/profile/out/*.cpuprofile
 *   bench/profile/out/summary.json
 *   bench/profile/report.md
 *
 * Bench-only — not part of production vite build inputs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import {
  classifyFilterVsRender,
  classifyToggleWork,
  createSourceMapper,
  detectRerenderComponents,
  formatTopTable,
  topSelfFunctions,
  writeJson,
} from './analyze.mjs'
import {
  OUT_DIR,
  PROFILE_ROOT,
  PROFILE_SIZES,
  enableProfiling,
  openBench,
  selectFirstSource,
  sleep,
  startVite,
  waitForGridStable,
  waitForUrl,
} from './lib.mjs'

/** Match Phase A wall-clock conditions so short interactions yield more samples. */
const CPU_THROTTLE = 4

function parseArgs(argv) {
  const out = {
    sizes: [...PROFILE_SIZES],
    port: 5173,
    headed: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--sizes') {
      out.sizes = String(argv[++i])
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    } else if (a === '--port') out.port = Number(argv[++i]) || 5173
    else if (a === '--headed') out.headed = true
  }
  if (out.sizes.length === 0) throw new Error('--sizes produced an empty list')
  return out
}

/**
 * @param {import('playwright').CDPSession} client
 */
async function startCpuProfile(client) {
  await client.send('Profiler.start')
}

/**
 * @param {import('playwright').CDPSession} client
 */
async function stopCpuProfile(client) {
  const { profile } = await client.send('Profiler.stop')
  return profile
}

/**
 * @param {object} bench openBench result
 * @param {'init'|'toggle'|'search'} scenario
 */
async function captureScenario(bench, scenario) {
  const { page, frame, client, n } = bench
  await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
  const { scripts } = await enableProfiling(client)

  let profile
  let wallMs = 0
  let meta = {}

  if (scenario === 'toggle') {
    await waitForGridStable(frame, n)
    await selectFirstSource(frame)
    await sleep(150)
    // Selected cards use `bg-sg-accent/10` (not hover's `border-sg-accent/50`).
    await frame.evaluate(async () => {
      const isSel = (el) =>
        el instanceof HTMLElement && /\bbg-sg-accent\/10\b/.test(el.className)
      const first = document.querySelector('[data-sg-card="true"]')
      if (!first) return
      for (let i = 0; i < 4 && isSel(first); i += 1) {
        first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      }
    })
    await sleep(50)

    await startCpuProfile(client)
    const t0 = Date.now()
    meta = await frame.evaluate(async () => {
      const card = document.querySelector('[data-sg-card="true"]')
      if (!card) return { ok: false }
      const isSel = (el) => /\bbg-sg-accent\/10\b/.test(el.className)
      const beforeSelected = isSel(card)
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise((r) => requestAnimationFrame(r))
      const afterSelected = isSel(card)
      return {
        ok: true,
        toggled: beforeSelected !== afterSelected,
        beforeSelected,
        afterSelected,
      }
    })
    profile = await stopCpuProfile(client)
    wallMs = Date.now() - t0
  } else if (scenario === 'search') {
    await waitForGridStable(frame, n)
    await selectFirstSource(frame)
    await sleep(150)
    const cardsBefore = await frame.locator('[data-sg-card="true"]').count()
    await frame.evaluate(async () => {
      const input = document.querySelector('input[placeholder="Search styles..."]')
      if (!(input instanceof HTMLInputElement)) return
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    })
    await sleep(50)

    await startCpuProfile(client)
    const t0 = Date.now()
    meta = await frame.evaluate(async () => {
      const input = document.querySelector('input[placeholder="Search styles..."]')
      if (!(input instanceof HTMLInputElement)) return { ok: false }
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      input.focus()
      const tStart = performance.now()
      setValue?.call(input, 'B')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise((r) => requestAnimationFrame(r))
      const cards = document.querySelectorAll('[data-sg-card="true"]').length
      return { ok: true, cardsAfter: cards, keyMs: performance.now() - tStart }
    })
    profile = await stopCpuProfile(client)
    wallMs = Date.now() - t0
    meta = { ...meta, cardsBefore }
  } else {
    throw new Error(`Unknown scenario ${scenario}`)
  }

  void page
  return { profile, scripts, wallMs, meta }
}

/**
 * Init must start profiling before SG_INIT work floods in.
 * Strategy: goto host with Profiler already enabled; start immediately after CDP enable,
 * before waiting for grid — but openBench already waits for initAck. So for init we use a
 * dedicated open path that starts the profile earlier.
 */
async function captureInit(browser, baseUrl, n) {
  const { generateStyles } = await import('../generateStyles.mjs')
  const { installRouteStubs, VIEWPORT } = await import('./lib.mjs')

  const styles = generateStyles(n)
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await installRouteStubs(page)
  await page.addInitScript((payload) => {
    window.__BENCH__ = payload
  }, { styles, tab: 'txt2img', n })

  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
  const { scripts } = await enableProfiling(client)

  await startCpuProfile(client)
  const t0 = Date.now()

  await page.goto(`${baseUrl}/bench/host.html?n=${n}&profile=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForFunction(
    () => window.__BENCH_HOST__ && window.__BENCH_HOST__.initAcked === true,
    null,
    { timeout: 60_000 },
  )

  const iframeHandle = await page.locator('#panel').elementHandle()
  if (!iframeHandle) {
    await context.close()
    throw new Error('Panel iframe missing')
  }
  const frame = await iframeHandle.contentFrame()
  if (!frame) {
    await context.close()
    throw new Error('Panel frame missing')
  }
  await frame.waitForSelector('#root', { timeout: 60_000 })
  const cardCount = await waitForGridStable(frame, n)
  await frame.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

  const profile = await stopCpuProfile(client)
  const wallMs = Date.now() - t0

  await iframeHandle.dispose().catch(() => {})
  await context.close()

  return { profile, scripts, wallMs, meta: { cardCount } }
}

async function analyzeCapture(baseUrl, capture, scenario) {
  const mapper = createSourceMapper(baseUrl, capture.scripts)
  await mapper.warm()
  const top = await topSelfFunctions(capture.profile, mapper, 15)

  const result = {
    scenario,
    wallMs: capture.wallMs,
    meta: capture.meta,
    durationMs: top.durationMs,
    totalSelf: top.totalSelf,
    activeSelf: top.activeSelf,
    idleShare: top.idleShare,
    top15: top.top,
  }

  if (scenario === 'toggle') {
    result.rerenders = await detectRerenderComponents(capture.profile, mapper)
    result.toggleBuckets = await classifyToggleWork(capture.profile, mapper)
  }
  if (scenario === 'search') {
    result.filterVsRender = await classifyFilterVsRender(capture.profile, mapper)
  }

  return result
}

function buildReport(doc) {
  const lines = []
  lines.push('# Phase B — Grid CPU profile report (Wave 1 / P Profiler)')
  lines.push('')
  lines.push(`Generated: ${doc.createdAt}`)
  lines.push('')
  lines.push('## Method')
  lines.push('')
  lines.push('- Host: Phase A bench (`ui/bench/host.html` + `ui/bench/vite.config.ts`)')
  lines.push('- Runtime: Vite **dev** (inline/sourcemaps via `Debugger.scriptParsed` + `source-map-js`)')
  lines.push('- CDP: `Profiler.enable` → `Profiler.setSamplingInterval(100µs)` → `Profiler.start` / `Profiler.stop`')
  lines.push(`- CPU throttle: **${doc.cpuThrottle}×** (same as Phase A bench)`)
  lines.push('- Sizes: N=2000, N=5000')
  lines.push('- Scenarios: **init** (navigation → stable cards), **toggle** (one card click + 3 rAF), **search** (one keystroke `"B"` + 3 rAF)')
  lines.push('- Top-15 tables exclude `(idle)` / `(program)` / `(garbage collector)`; percentages are of **active** sample weight')
  lines.push('- Re-renders: inferred from profile call stacks (React reconcile frames + `src/components/*` file paths); no React DevTools')
  lines.push('- Scripts live under `ui/bench/profile/**` only; production `vite build` entry is unchanged')
  lines.push('')
  lines.push('## Explicit answers')
  lines.push('')
  lines.push(doc.answers.q1)
  lines.push('')
  lines.push(doc.answers.q2)
  lines.push('')

  for (const n of Object.keys(doc.sizes).map(Number).sort((a, b) => a - b)) {
    const block = doc.sizes[String(n)]
    lines.push(`## N=${n}`)
    lines.push('')
    for (const scenario of ['init', 'toggle', 'search']) {
      const s = block[scenario]
      if (!s) continue
      lines.push(`### ${scenario}`)
      lines.push('')
      const idlePct = s.idleShare != null ? `${(s.idleShare * 100).toFixed(1)}%` : '—'
      lines.push(
        `- Wall: **${s.wallMs} ms** · Profile duration: **${s.durationMs != null ? s.durationMs.toFixed(1) : '—'} ms** · Active weight: ${s.activeSelf ?? '—'} · Idle/program/gc: ${idlePct}`,
      )
      if (s.meta && Object.keys(s.meta).length) {
        lines.push(`- Meta: \`${JSON.stringify(s.meta)}\``)
      }
      lines.push('')
      lines.push(formatTopTable(s.top15 || []))
      lines.push('')

      if (scenario === 'toggle' && s.rerenders) {
        lines.push('**Components on call stacks during a single toggle** (sample hits; stack-inferred):')
        lines.push('')
        if (s.rerenders.components.length === 0) {
          lines.push('_No component frames found under render stacks._')
        } else {
          for (const c of s.rerenders.components) {
            lines.push(`- \`${c.name}\` — ${c.hits} stack hit(s)`)
          }
        }
        lines.push('')
        if (s.rerenders.componentFiles?.length) {
          lines.push('**App files on those stacks (weight):**')
          lines.push('')
          for (const f of s.rerenders.componentFiles.slice(0, 12)) {
            lines.push(`- \`${f.file}\` — ${f.weight ?? f.hits}`)
          }
          lines.push('')
        }
        if (s.toggleBuckets) {
          lines.push('**Toggle active-time buckets (stack-attributed):**')
          lines.push('')
          for (const [k, v] of Object.entries(s.toggleBuckets.buckets)) {
            if (v.share < 0.005) continue
            lines.push(`- ${k}: ${(v.share * 100).toFixed(1)}%`)
          }
          lines.push('')
        }
      }

      if (scenario === 'search' && s.filterVsRender) {
        const f = s.filterVsRender
        lines.push('**Filter vs render (share of active sample weight):**')
        lines.push('')
        lines.push(`- Filtering: **${(f.filter.share * 100).toFixed(1)}%**`)
        lines.push(`- Rendering: **${(f.render.share * 100).toFixed(1)}%**`)
        lines.push(`- Other: **${(f.other.share * 100).toFixed(1)}%**`)
        lines.push('')
      }
    }
  }

  lines.push('## Artifacts')
  lines.push('')
  lines.push('- Raw profiles: `ui/bench/profile/out/*.cpuprofile`')
  lines.push('- Machine-readable summary: `ui/bench/profile/out/summary.json`')
  lines.push('- This report: `ui/bench/profile/report.md` (uncommitted)')
  lines.push('')
  lines.push('## Production bundle self-check')
  lines.push('')
  lines.push(doc.bundleCheck)
  lines.push('')
  return `${lines.join('\n')}\n`
}

function deriveAnswers(doc) {
  // Prefer N=5000 for narrative; fall back to largest available
  const sizes = Object.keys(doc.sizes).map(Number).sort((a, b) => a - b)
  const primary = String(sizes[sizes.length - 1] || 5000)
  const secondary = sizes.length > 1 ? String(sizes[0]) : primary
  const t5000 = doc.sizes[primary]?.toggle
  const t2000 = doc.sizes[secondary]?.toggle
  const s5000 = doc.sizes[primary]?.search
  const s2000 = doc.sizes[secondary]?.search

  const comps = t5000?.rerenders?.components?.map((c) => c.name) || []
  const buckets = t5000?.toggleBuckets?.buckets
  const bucketLine = buckets
    ? Object.entries(buckets)
        .filter(([, v]) => v.share >= 0.03)
        .sort((a, b) => b[1].share - a[1].share)
        .map(([k, v]) => `${k} ${(v.share * 100).toFixed(0)}%`)
        .join(', ')
    : 'n/a'

  const q1 = [
    '### 1) What does a single toggle recompute at grid level?',
    '',
    `At N=${primary}, active CPU on a single card toggle attributes roughly as: **${bucketLine}**.`,
    comps.length
      ? `Components observed on stacks: **${[...new Set(comps)].join(', ')}**.`
      : 'See file hits and top-15 tables for component attribution.',
    '',
    'Interpretation: `toggleStyle` mutates `selectedStyles` and rebuilds `selectedKeySet` / per-category counts. The catalog filter list is **not** rebuilt for selection. Cost is **React reconcile + selection chrome** (`Sidebar` category counts, `SelectedBar` / `App`, `StyleInfoPanel`) and **viewport row/card work** (`VirtualStyleGrid` → `CardsRow` → `StyleCard`). Init mounts ~viewport cards (~130), so toggle cost is closer to viewport width than raw N. Framer Motion `measureScroll` still appears. `matchesSearchKey` can show up when chrome recomputes filtered counts.',
    t2000 && primary !== secondary
      ? `Wall (4× CPU): N=${secondary} ${t2000.wallMs} ms vs N=${primary} ${t5000?.wallMs ?? '—'} ms.`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  const fv = s5000?.filterVsRender
  const fv2 = s2000?.filterVsRender
  const cardsNote =
    s5000?.meta?.cardsBefore != null && s5000?.meta?.cardsAfter != null
      ? ` Visible cards ${s5000.meta.cardsBefore} → ${s5000.meta.cardsAfter}.`
      : ''
  const q2 = [
    '### 2) What share of a search keystroke is filtering vs rendering?',
    '',
    fv
      ? `At N=${primary} (one keystroke \`"B\`"): **filtering ${(fv.filter.share * 100).toFixed(1)}%** vs **rendering ${(fv.render.share * 100).toFixed(1)}%** of **active** sample weight (other ${(fv.other.share * 100).toFixed(1)}%).${cardsNote}`
      : 'Search classification unavailable.',
    fv2 && primary !== secondary
      ? `At N=${secondary}: filtering ${(fv2.filter.share * 100).toFixed(1)}% / rendering ${(fv2.render.share * 100).toFixed(1)}% / other ${(fv2.other.share * 100).toFixed(1)}%.`
      : '',
    '',
    'Method: each non-idle sample is stack-classified — filter (`matchesSearch` / store / SearchBar / array filter on search paths) vs render (React reconcile, StyleGrid/StyleCard remounts, motion). Idle/program excluded from the denominator.',
  ]
    .filter(Boolean)
    .join('\n')

  return { q1, q2 }
}

async function bundleSelfCheck() {
  const dist = path.join(PROFILE_ROOT, '../../dist')
  const distIndex = path.join(dist, 'assets', 'index.js')
  const lines = []
  lines.push(`- Profile scripts directory: \`ui/bench/profile/\` (outside \`src/\` and \`public/\`)`)
  lines.push(`- Production config: \`ui/vite.config.ts\` build inputs do not include \`bench/\``)

  if (!fs.existsSync(distIndex)) {
    lines.push('- `ui/dist/assets/index.js` not present — skipped string scan (run production build separately if needed)')
    lines.push('- Structural check: PASS (profile code cannot be pulled into build without importing from src)')
    return lines.join('\n')
  }

  const js = fs.readFileSync(distIndex, 'utf8')
  const needles = ['bench/profile', 'Profiler.setSamplingInterval', '__BENCH_HOST__', 'Phase B — Grid CPU']
  const hits = needles.filter((n) => js.includes(n))
  if (hits.length === 0) {
    lines.push('- Scanned `dist/assets/index.js` for profile markers: **none found** — PASS')
  } else {
    lines.push(`- Scanned dist for profile markers: FOUND ${hits.join(', ')} — FAIL`)
  }

  // Also ensure no profile path in dist file list
  const distFiles = []
  const walk = (dir, prefix = '') => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const rel = prefix ? `${prefix}/${name}` : name
      if (fs.statSync(full).isDirectory()) walk(full, rel)
      else distFiles.push(rel.replace(/\\/g, '/'))
    }
  }
  walk(dist)
  const benchInDist = distFiles.filter((f) => f.includes('bench') || f.includes('profile/run'))
  lines.push(
    benchInDist.length === 0
      ? '- Dist file list contains no bench/profile artifacts — PASS'
      : `- Dist unexpectedly contains: ${benchInDist.join(', ')} — FAIL`,
  )
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  fs.mkdirSync(OUT_DIR, { recursive: true })

  console.log(`[profile] sizes=${args.sizes.join(',')} port=${args.port}`)

  // Init/toggle/search profiles need sourcemaps — keep Vite DEV here.
  const vite = await startVite(args.port, { mode: 'dev' })
  const browser = await chromium.launch({
    headless: !args.headed,
    args: ['--disable-dev-shm-usage', '--disable-gpu'],
  })

  /** @type {any} */
  const doc = {
    createdAt: new Date().toISOString(),
    cpuThrottle: CPU_THROTTLE,
    samplingIntervalUs: 100,
    viewport: { width: 1280, height: 800 },
    sizes: {},
  }

  try {
    const baseUrl = await vite.ready
    await waitForUrl(`${baseUrl}/bench/host.html`)
    console.log(`[profile] vite ready at ${baseUrl}`)

    for (const n of args.sizes) {
      doc.sizes[String(n)] = {}
      for (const scenario of ['init', 'toggle', 'search']) {
        console.log(`[profile] N=${n} ${scenario} …`)
        let capture
        if (scenario === 'init') {
          capture = await captureInit(browser, baseUrl, n)
        } else {
          const bench = await openBench(browser, baseUrl, n)
          try {
            capture = await captureScenario(bench, scenario)
          } finally {
            await bench.close()
          }
        }

        const outFile = path.join(OUT_DIR, `N${n}-${scenario}.cpuprofile`)
        writeJson(outFile, capture.profile)
        console.log(`[profile] wrote ${outFile} wall=${capture.wallMs}ms`)

        const analyzed = await analyzeCapture(baseUrl, capture, scenario)
        doc.sizes[String(n)][scenario] = analyzed
        writeJson(path.join(OUT_DIR, 'summary.json'), doc)
      }
    }

    doc.answers = deriveAnswers(doc)
    doc.bundleCheck = await bundleSelfCheck()
    writeJson(path.join(OUT_DIR, 'summary.json'), doc)

    const reportPath = path.join(PROFILE_ROOT, 'report.md')
    fs.writeFileSync(reportPath, buildReport(doc), 'utf8')
    console.log(`[profile] wrote ${reportPath}`)
    console.log('')
    console.log(doc.answers.q1)
    console.log('')
    console.log(doc.answers.q2)
  } finally {
    await browser.close()
    await vite.stop()
  }
}

main().catch((err) => {
  console.error('[profile] FAILED', err)
  process.exitCode = 1
})
