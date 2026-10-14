/**
 * Style Grid Phase-A/B perf bench (per-card cost).
 *
 * Playwright + Chromium, CDP CPU 4x, N=500/2000/5000, 3 runs → median.
 * Host embeds panel (bench vite config serves /bench/host.html).
 * Stubs /style_grid/** via page.route.
 *
 * Default runtime: production build + `vite preview` (no jsxDEV).
 * Pass `--dev` only for local debugging against Vite transform pipeline.
 *
 * Usage:
 *   node bench/run.mjs --label baseline
 *   node bench/run.mjs --label phase-a
 *   node bench/run.mjs --label smoke --sizes 500 --runs 1
 *   node bench/run.mjs --label phase-b --dev
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { DUPLICATE_NAME_RATIO, buildBenchFixture } from './generateStyles.mjs'
import {
  applySelected,
  runLayoutInvariantsForFrame,
  selectFirstSource as harnessSelectFirstSource,
  sleep as harnessSleep,
} from './lib/layoutHarness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UI_ROOT = path.resolve(__dirname, '..')
const RESULTS_DIR = path.join(__dirname, 'results')
/** Isolated preview output — do not clobber shipped `ui/dist` during benches. */
const PREVIEW_OUT_DIR = path.join(__dirname, '.preview-dist')

const DEFAULT_SIZES = [500, 2000, 5000]
const DEFAULT_RUNS = 3
const CPU_RATE = 4
const VIEWPORT = { width: 1280, height: 800 }

const GATE_N = 5000
const GATE = Object.freeze({
  initMs: 1000,
  toggleP50Ms: 100,
  searchKeyP50Ms: 100,
  scrollTbtMs: 300,
})

function parseArgs(argv) {
  const out = {
    label: 'baseline',
    sizes: [...DEFAULT_SIZES],
    runs: DEFAULT_RUNS,
    port: 0,
    headed: false,
    /** false = vite build + preview (gate); true = vite dev (jsxDEV). */
    dev: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--label') out.label = String(argv[++i])
    else if (a === '--sizes') {
      out.sizes = String(argv[++i])
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    } else if (a === '--runs') out.runs = Math.max(1, Number(argv[++i]) || DEFAULT_RUNS)
    else if (a === '--port') out.port = Number(argv[++i]) || 0
    else if (a === '--headed') out.headed = true
    else if (a === '--dev') out.dev = true
  }
  if (!out.label) throw new Error('--label is required')
  if (out.sizes.length === 0) throw new Error('--sizes produced an empty list')
  return out
}

function median(values) {
  const sorted = [...values].filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return NaN
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function percentile(values, p) {
  const sorted = [...values].filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx]
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(url, (res) => {
          res.resume()
          resolve(res.statusCode != null && res.statusCode < 500)
        })
        req.on('error', () => resolve(false))
        req.setTimeout(1000, () => {
          req.destroy()
          resolve(false)
        })
      })
      if (ok) return
    } catch {
      // retry
    }
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function viteBin() {
  const viteEntry = path.join(UI_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!fs.existsSync(viteEntry)) {
    throw new Error(`Vite not found at ${viteEntry}; run npm ci in ui/`)
  }
  return viteEntry
}

function stopChild(child) {
  return async () => {
    if (child.pid == null || child.exitCode != null) return
    if (process.platform === 'win32') {
      await new Promise((resolve) => {
        const killer = spawn(
          'taskkill',
          ['/pid', String(child.pid), '/T', '/F'],
          { stdio: 'ignore', windowsHide: true },
        )
        killer.on('exit', () => resolve())
        killer.on('error', () => resolve())
      })
    } else {
      child.kill('SIGTERM')
      await sleep(500)
      if (child.exitCode == null) child.kill('SIGKILL')
    }
    await sleep(200)
  }
}

function spawnVite(args) {
  const child = spawn(process.execPath, [viteBin(), ...args], {
    cwd: UI_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, BROWSER: 'none' },
    windowsHide: true,
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => {
    stdout += d.toString()
  })
  child.stderr.on('data', (d) => {
    stderr += d.toString()
  })

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Vite did not become ready.\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, 90_000)

    const onChunk = () => {
      const text = stdout + stderr
      const m = text.match(/Local:\s+(http:\/\/[^\s]+)/i)
      if (m) {
        clearTimeout(timer)
        resolve(m[1].replace(/\/$/, ''))
        return
      }
      if (child.exitCode != null && child.exitCode !== 0) {
        clearTimeout(timer)
        reject(new Error(`Vite exited ${child.exitCode}\n${stderr || stdout}`))
      }
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('exit', (code) => {
      if (code && code !== 0) {
        clearTimeout(timer)
        reject(new Error(`Vite exited ${code}\n${stderr || stdout}`))
      }
    })
  })

  return { child, ready, stop: stopChild(child), getLogs: () => ({ stdout, stderr }) }
}

/** Production bundle for preview (jsx runtime, no jsxDEV). */
async function buildBenchPreview() {
  const configPath = path.join(__dirname, 'vite.config.ts')
  console.log(`[bench] building production preview → ${PREVIEW_OUT_DIR}`)
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [viteBin(), 'build', '--config', configPath],
      {
        cwd: UI_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env: { ...process.env, BROWSER: 'none', NODE_ENV: 'production' },
        windowsHide: true,
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        console.log('[bench] production build ok')
        resolve()
      } else {
        reject(new Error(`vite build exited ${code}\n${stderr || stdout}`))
      }
    })
  })
}

/**
 * @param {number} port
 * @param {{ mode: 'preview' | 'dev' }} opts
 */
async function startVite(port, opts = { mode: 'preview' }) {
  const configPath = path.join(__dirname, 'vite.config.ts')
  const chosenPort = port > 0 ? port : 5173
  const mode = opts.mode === 'dev' ? 'dev' : 'preview'

  if (mode === 'preview') {
    await buildBenchPreview()
    const preview = spawnVite([
      'preview',
      '--config',
      configPath,
      '--host',
      '127.0.0.1',
      '--strictPort',
      '--port',
      String(chosenPort),
    ])
    return { ...preview, mode: 'preview' }
  }

  const dev = spawnVite([
    '--config',
    configPath,
    '--host',
    '127.0.0.1',
    '--strictPort',
    '--port',
    String(chosenPort),
  ])
  return { ...dev, mode: 'dev' }
}

/**
 * @param {import('playwright').Page} page
 * @param {Record<string, unknown>} [fixture]
 */
async function installRouteStubs(page, fixture = {}) {
  await page.route('**/style_grid/**', async (route) => {
    const req = route.request()
    const url = req.url()
    const method = req.method()

    if (url.includes('/style_grid/presets') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
      return
    }
    if (url.includes('/style_grid/thumbnails/list')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ has_thumbnail: [] }),
      })
      return
    }
    if (url.includes('/style_grid/thumbnail') && method === 'GET') {
      await route.fulfill({ status: 404, body: '' })
      return
    }
    if (url.includes('/style_grid/lora/fetch_titles/status')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'idle', done: 0, total: 0, errors: 0 }),
      })
      return
    }

    // POST/DELETE and anything else: minimal valid JSON
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })
}

async function setCpuThrottle(page, rate) {
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate })
  return client
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 * @param {number} n
 */
async function measureRun(page, frame, n) {
  const host = page
  const initSentAtMs = await host.evaluate(() => {
    const h = window.__BENCH_HOST__
    return h && typeof h.initSentAtMs === 'number' ? h.initSentAtMs : null
  })
  if (initSentAtMs == null) {
    throw new Error('Host did not record SG_INIT send time')
  }

  // Virtualized DOM cards ≠ N. All-sources view also dedupes by name (~N/1.1 rows).
  const minCatalog = Math.max(1, Math.floor(n / (1 + DUPLICATE_NAME_RATIO)))
  await frame.waitForFunction(
    ({ min }) => {
      const grid = document.querySelector('[data-sg-item-count]')
      if (!grid) return false
      const items = Number(grid.getAttribute('data-sg-item-count') || '0')
      return items >= min && document.querySelectorAll('[data-sg-card="true"]').length >= 1
    },
    { min: minCatalog },
    { timeout: 180_000 },
  )
  await frame.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const initMs = Date.now() - initSentAtMs

  // Prefer a single source so duplicate-name rows do not open the source picker.
  await frame.evaluate(() => {
    const select = document.querySelector('select')
    if (!(select instanceof HTMLSelectElement) || select.options.length < 2) return
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    proto?.call(select, select.options[1].value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  // Source filter changes catalog size; wait until item-count settles.
  let catalogCount = -1
  {
    let last = -1
    let stableHits = 0
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline && stableHits < 4) {
      const count = await frame.evaluate(() => {
        const grid = document.querySelector('[data-sg-item-count]')
        return grid ? Number(grid.getAttribute('data-sg-item-count') || '0') : -1
      })
      if (count > 0 && count === last) stableHits += 1
      else stableHits = 0
      last = count
      await sleep(50)
    }
    catalogCount = last
  }
  await frame.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

  // ── toggleP50Ms (in-page click + double-rAF; avoid Playwright actionability overhead)
  const toggleSamples = await frame.evaluate(async () => {
    const cards = [...document.querySelectorAll('[data-sg-card="true"]')]
    const samples = []
    const toggleCount = Math.min(21, Math.max(5, Math.floor(cards.length / 10)))
    for (let i = 0; i < toggleCount; i += 1) {
      const card = cards[Math.min(cards.length - 1, i * 2)]
      if (!card) continue
      const t0 = performance.now()
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      samples.push(performance.now() - t0)
    }
    return samples
  })
  const toggleP50Ms = percentile(toggleSamples, 0.5)

  // ── searchKeyP50Ms (per-character input cost inside the panel)
  const keySamples = await frame.evaluate(async () => {
    const input = document.querySelector('input[placeholder="Search styles..."]')
    if (!(input instanceof HTMLInputElement)) return []
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    const commit = (value) => {
      setValue?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    input.focus()
    commit('')
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

    const query = 'Bench_000'
    const samples = []
    let current = ''
    for (const ch of query) {
      const t0 = performance.now()
      current += ch
      commit(current)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      samples.push(performance.now() - t0)
    }
    commit('')
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return samples
  })
  const searchKeyP50Ms = percentile(keySamples, 0.5)

  // Restore full (source-filtered) catalog before scroll — DOM cards ≠ N when virtualized.
  const restoreTarget = catalogCount > 0 ? catalogCount : n
  await frame.waitForFunction(
    ({ count }) => {
      const grid = document.querySelector('[data-sg-item-count]')
      if (!grid) return false
      const items = Number(grid.getAttribute('data-sg-item-count') || '0')
      return items >= count && document.querySelectorAll('[data-sg-card="true"]').length >= 1
    },
    { count: restoreTarget },
    { timeout: 180_000 },
  )
  await frame.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await sleep(50)

  // ── scrollTbtMs + longTasks ─────────────────────────────────
  await frame.evaluate(() => {
    window.__BENCH_LONG_TASKS__ = []
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__BENCH_LONG_TASKS__.push({
            start: entry.startTime,
            duration: entry.duration,
          })
        }
      })
      // buffered:false — do not attribute pre-scroll longtasks (search restore) to scroll TBT
      obs.observe({ type: 'longtask', buffered: false })
      window.__BENCH_LONG_TASK_OBS__ = obs
    } catch {
      window.__BENCH_LONG_TASK_OBS__ = null
    }
    performance.clearMarks?.('sg-bench-scroll-start')
    performance.clearMarks?.('sg-bench-scroll-end')
    performance.mark('sg-bench-scroll-start')
  })

  const scrollMetrics = await frame.evaluate(async () => {
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

    const startTasks = (window.__BENCH_LONG_TASKS__ || []).length
    const scrollStart = performance.now()
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const steps = 24
    for (let i = 1; i <= steps; i += 1) {
      scroller.scrollTop = (maxScroll * i) / steps
      await new Promise((r) => requestAnimationFrame(r))
    }
    // bounce back
    for (let i = steps - 1; i >= 0; i -= 1) {
      scroller.scrollTop = (maxScroll * i) / steps
      await new Promise((r) => requestAnimationFrame(r))
    }
    const scrollEnd = performance.now()
    performance.mark('sg-bench-scroll-end')

    // Allow late longtask delivery
    await new Promise((r) => setTimeout(r, 100))

    const tasks = (window.__BENCH_LONG_TASKS__ || []).filter(
      (t) => t.start >= scrollStart - 16 && t.start <= scrollEnd + 50,
    )
    // Total Blocking Time: sum of (duration - 50) for tasks > 50ms
    let tbt = 0
    for (const t of tasks) {
      if (t.duration > 50) tbt += t.duration - 50
    }

    try {
      window.__BENCH_LONG_TASK_OBS__?.disconnect?.()
    } catch {
      // ignore
    }

    return {
      scrollTbtMs: tbt,
      longTasks: tasks.length,
      scrollWallMs: scrollEnd - scrollStart,
      observedFromIndex: startTasks,
      maxScroll,
    }
  })

  const itemCount = await frame.evaluate(() => {
    const grid = document.querySelector('[data-sg-item-count]')
    return grid ? Number(grid.getAttribute('data-sg-item-count') || '0') : 0
  })

  return {
    n,
    initMs,
    toggleP50Ms,
    searchKeyP50Ms,
    scrollTbtMs: scrollMetrics.scrollTbtMs,
    longTasks: scrollMetrics.longTasks,
    cardCount: itemCount,
    toggleSamples,
    keySamples,
    scrollWallMs: scrollMetrics.scrollWallMs,
  }
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} baseUrl
 * @param {number} n
 * @param {boolean} headed
 */
async function runOne(browser, baseUrl, n, headed) {
  const fixture = buildBenchFixture(n)
  const { styles, favorites, selected } = fixture
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await installRouteStubs(page)

  await page.addInitScript((payload) => {
    window.__BENCH__ = payload
    if (Array.isArray(payload.favorites) && payload.favorites.length > 0) {
      try {
        localStorage.setItem('sg_v2_favorites', JSON.stringify(payload.favorites))
      } catch {
        // ignore
      }
    }
  }, { styles, favorites, selected, tab: 'txt2img', n })

  await setCpuThrottle(page, CPU_RATE)

  const hostUrl = `${baseUrl}/bench/host.html?n=${n}`
  await page.goto(hostUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })

  await page.waitForFunction(
    () => window.__BENCH_HOST__ && window.__BENCH_HOST__.initAcked === true,
    null,
    { timeout: 60_000 },
  )

  // Locator.contentFrame() is a FrameLocator in modern Playwright; get a real Frame.
  const iframeHandle = await page.locator('#panel').elementHandle()
  if (!iframeHandle) {
    await context.close()
    throw new Error('Panel iframe element not found')
  }
  const activeFrame = await iframeHandle.contentFrame()
  if (!activeFrame) {
    await context.close()
    throw new Error('Panel iframe frame not found')
  }

  await activeFrame.waitForSelector('#root', { timeout: 60_000 })

  let result
  try {
    result = await measureRun(page, activeFrame, n)
    // Realistic selection chrome after perf samples (does not affect init/toggle metrics).
    await applySelected(activeFrame, selected)
  } finally {
    await iframeHandle.dispose().catch(() => {})
    await context.close()
  }

  void headed
  return { ...result, fixtureMeta: fixture.meta }
}

/**
 * Layout invariants at N∈{500,5000} — every density × top + scroll3.
 * @param {import('playwright').Browser} browser
 * @param {string} baseUrl
 * @param {number} n
 */
async function runLayoutPass(browser, baseUrl, n) {
  const fixture = buildBenchFixture(n)
  const { styles, favorites, selected } = fixture
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await installRouteStubs(page)
  await page.addInitScript((payload) => {
    window.__BENCH__ = payload
    if (Array.isArray(payload.favorites) && payload.favorites.length > 0) {
      try {
        localStorage.setItem('sg_v2_favorites', JSON.stringify(payload.favorites))
      } catch {
        // ignore
      }
    }
  }, { styles, favorites, selected, tab: 'txt2img', n })

  await page.goto(`${baseUrl}/bench/host.html?n=${n}&layout=1`, {
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
    throw new Error('Panel iframe element not found')
  }
  const frame = await iframeHandle.contentFrame()
  if (!frame) {
    await context.close()
    throw new Error('Panel iframe frame not found')
  }
  await frame.waitForSelector('#root', { timeout: 60_000 })
  await frame.waitForFunction(
    () => document.querySelectorAll('[data-sg-card="true"]').length >= 1,
    null,
    { timeout: 180_000 },
  )
  await harnessSelectFirstSource(frame)
  await harnessSleep(100)
  await applySelected(frame, selected)

  let layout
  try {
    layout = await runLayoutInvariantsForFrame(frame, { n })
  } finally {
    await iframeHandle.dispose().catch(() => {})
    await context.close()
  }
  return layout
}

function evaluateGate(medians) {
  const reasons = []
  for (const [key, limit] of Object.entries(GATE)) {
    const v = medians[key]
    if (typeof v === 'number' && v > limit) {
      reasons.push(`${key}=${v}>${limit}`)
    }
  }
  return {
    n: GATE_N,
    virtualization: reasons.length > 0 ? 'VIRTUALIZATION NEEDED' : 'NOT NEEDED',
    reasons,
  }
}

function printTable(doc) {
  const sizes = Object.keys(doc.sizes).map(Number).sort((a, b) => a - b)
  const keys = ['initMs', 'toggleP50Ms', 'searchKeyP50Ms', 'scrollTbtMs', 'longTasks']
  console.log('')
  console.log(`Bench results — label=${doc.label}`)
  console.log(
    ['N'.padStart(6), ...keys.map((k) => k.padStart(14))].join('  '),
  )
  console.log('-'.repeat(6 + keys.length * 16))
  for (const n of sizes) {
    const block = doc.sizes[String(n)]
    console.log(
      [
        String(n).padStart(6),
        ...keys.map((k) => {
          const v = block[k]
          const s = typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : String(v)
          return s.padStart(14)
        }),
      ].join('  '),
    )
  }
  if (doc.phaseBGate) {
    console.log('')
    console.log(
      `PHASE B GATE (N=${doc.phaseBGate.n}): ${doc.phaseBGate.virtualization}` +
        (doc.phaseBGate.reasons?.length ? ` [${doc.phaseBGate.reasons.join(', ')}]` : ''),
    )
  }
  console.log('')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  fs.mkdirSync(RESULTS_DIR, { recursive: true })

  const viteMode = args.dev ? 'dev' : 'preview'
  console.log(
    `[bench] label=${args.label} sizes=${args.sizes.join(',')} runs=${args.runs} ` +
      `cpu=${CPU_RATE}x vite=${viteMode}`,
  )

  const vite = await startVite(args.port, { mode: viteMode })
  let baseUrl
  try {
    baseUrl = await vite.ready
    await waitForUrl(`${baseUrl}/bench/host.html`)
    console.log(`[bench] vite ${vite.mode} ready at ${baseUrl}`)

    const browser = await chromium.launch({
      headless: !args.headed,
      args: ['--disable-dev-shm-usage', '--disable-gpu'],
    })
    const sizes = {}
    const outPath = path.join(RESULTS_DIR, `${args.label}.json`)

    const writeDoc = () => {
      const gateMedians = sizes[String(GATE_N)] || {}
      const doc = {
        label: args.label,
        createdAt: new Date().toISOString(),
        cpuThrottle: CPU_RATE,
        runsPerN: args.runs,
        viewport: VIEWPORT,
        viteMode: vite.mode,
        sizes,
        phaseBGate: evaluateGate({
          initMs: gateMedians.initMs,
          toggleP50Ms: gateMedians.toggleP50Ms,
          searchKeyP50Ms: gateMedians.searchKeyP50Ms,
          scrollTbtMs: gateMedians.scrollTbtMs,
        }),
      }
      fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
      return doc
    }

    /** @type {Record<string, unknown>} */
    let layoutInvariants = {}

    try {
      for (const n of args.sizes) {
        const runs = []
        for (let r = 1; r <= args.runs; r += 1) {
          console.log(`[bench] N=${n} run ${r}/${args.runs} …`)
          const result = await runOne(browser, baseUrl, n, args.headed)
          console.log(
            `[bench] N=${n} run ${r}: init=${result.initMs}ms toggleP50=${result.toggleP50Ms}ms ` +
              `searchP50=${result.searchKeyP50Ms}ms scrollTbt=${result.scrollTbtMs}ms longTasks=${result.longTasks}`,
          )
          runs.push(result)
        }
        const round1 = (v) => Math.round(v * 10) / 10
        const med = {
          initMs: round1(median(runs.map((x) => x.initMs))),
          toggleP50Ms: round1(median(runs.map((x) => x.toggleP50Ms))),
          searchKeyP50Ms: round1(median(runs.map((x) => x.searchKeyP50Ms))),
          scrollTbtMs: round1(median(runs.map((x) => x.scrollTbtMs))),
          longTasks: round1(median(runs.map((x) => x.longTasks))),
          runs,
        }
        sizes[String(n)] = med
        writeDoc()
        console.log(`[bench] checkpoint wrote ${outPath} (after N=${n})`)
      }

      // Layout invariants (N=500 and 5000 when present in --sizes).
      const layoutNs = args.sizes.filter((n) => n === 500 || n === 5000)
      for (const n of layoutNs) {
        console.log(`[bench] layout invariants N=${n} …`)
        const layout = await runLayoutPass(browser, baseUrl, n)
        layoutInvariants[String(n)] = layout
        if (!layout.ok) {
          console.error(`[bench] layout invariants FAILED at N=${n}`)
          process.exitCode = 1
        }
      }
    } finally {
      await browser.close()
    }

    const doc = writeDoc()
    doc.layoutInvariants = layoutInvariants
    fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
    console.log(`[bench] wrote ${outPath}`)
    printTable(doc)
  } finally {
    await vite.stop()
  }
}

main().catch((err) => {
  console.error('[bench] FAILED', err)
  process.exitCode = 1
})
