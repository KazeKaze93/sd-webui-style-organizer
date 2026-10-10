/**
 * Style Grid Phase-A perf bench (per-card cost).
 *
 * Playwright + Chromium, CDP CPU 4x, N=500/2000/5000, 3 runs → median.
 * Host embeds panel (bench vite config serves /bench/host.html).
 * Stubs /style_grid/** via page.route.
 *
 * Usage:
 *   node bench/run.mjs --label baseline
 *   node bench/run.mjs --label phase-a
 *   node bench/run.mjs --label smoke --sizes 500 --runs 1
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { generateStyles } from './generateStyles.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UI_ROOT = path.resolve(__dirname, '..')
const RESULTS_DIR = path.join(__dirname, 'results')

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

function startVite(port) {
  const configPath = path.join(__dirname, 'vite.config.ts')
  const chosenPort = port > 0 ? port : 5173
  const args = [
    '--config',
    configPath,
    '--host',
    '127.0.0.1',
    '--strictPort',
    '--port',
    String(chosenPort),
  ]

  // Invoke Vite's JS entry directly (avoids npx + shell quirks on Windows).
  const viteEntry = path.join(UI_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!fs.existsSync(viteEntry)) {
    throw new Error(`Vite not found at ${viteEntry}; run npm ci in ui/`)
  }
  const child = spawn(process.execPath, [viteEntry, ...args], {
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

  return {
    child,
    ready,
    async stop() {
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
    },
  }
}

async function installRouteStubs(page) {
  await page.route('**/style_grid/**', async (route) => {
    const req = route.request()
    const url = req.url()
    const method = req.method()

    if (url.includes('/style_grid/usage') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
      return
    }
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

  // Wait until the panel has mounted a substantial card set (all cards in Phase A).
  const expectedMin = Math.min(n, 40)
  await frame.waitForFunction(
    (minCards) => document.querySelectorAll('[data-sg-card="true"]').length >= minCards,
    expectedMin,
    { timeout: 180_000 },
  )

  // Stabilize: card count unchanged across a few frames.
  let lastCount = -1
  let stableHits = 0
  const stableDeadline = Date.now() + 60_000
  while (Date.now() < stableDeadline && stableHits < 4) {
    const count = await frame.locator('[data-sg-card="true"]').count()
    if (count === lastCount && count >= expectedMin) stableHits += 1
    else stableHits = 0
    lastCount = count
    await sleep(50)
  }
  const initMs = Date.now() - initSentAtMs

  // Prefer a single source so duplicate-name rows do not open the source picker.
  await frame.evaluate(() => {
    const select = document.querySelector('select')
    if (!(select instanceof HTMLSelectElement) || select.options.length < 2) return
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    proto?.call(select, select.options[1].value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
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
      obs.observe({ type: 'longtask', buffered: true })
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

  return {
    n,
    initMs,
    toggleP50Ms,
    searchKeyP50Ms,
    scrollTbtMs: scrollMetrics.scrollTbtMs,
    longTasks: scrollMetrics.longTasks,
    cardCount: lastCount,
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
  const styles = generateStyles(n)
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await installRouteStubs(page)

  await page.addInitScript((payload) => {
    window.__BENCH__ = payload
  }, { styles, tab: 'txt2img', n })

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
  } finally {
    await iframeHandle.dispose().catch(() => {})
    await context.close()
  }

  void headed
  return result
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

  console.log(`[bench] label=${args.label} sizes=${args.sizes.join(',')} runs=${args.runs} cpu=${CPU_RATE}x`)

  const vite = startVite(args.port)
  let baseUrl
  try {
    baseUrl = await vite.ready
    await waitForUrl(`${baseUrl}/bench/host.html`)
    console.log(`[bench] vite ready at ${baseUrl}`)

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
    } finally {
      await browser.close()
    }

    const doc = writeDoc()
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
