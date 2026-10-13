/**
 * Shared helpers for CDP profiling against the Phase-A bench host.
 * Bench-only — never imported from src/ or production vite entry.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateStyles } from '../generateStyles.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PROFILE_ROOT = __dirname
export const BENCH_ROOT = path.resolve(__dirname, '..')
export const UI_ROOT = path.resolve(__dirname, '../..')
export const OUT_DIR = path.join(__dirname, 'out')

export const VIEWPORT = { width: 1280, height: 800 }
export const PROFILE_SIZES = [2000, 5000]
export const SCENARIOS = Object.freeze(['init', 'toggle', 'search'])

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitForUrl(url, timeoutMs = 60_000) {
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

const PREVIEW_OUT_DIR = path.join(BENCH_ROOT, '.preview-dist')

function viteBin() {
  const viteEntry = path.join(UI_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!fs.existsSync(viteEntry)) {
    throw new Error(`Vite not found at ${viteEntry}; run npm ci in ui/`)
  }
  return viteEntry
}

async function buildBenchPreview() {
  const configPath = path.join(BENCH_ROOT, 'vite.config.ts')
  console.log(`[profile] building production preview → ${PREVIEW_OUT_DIR}`)
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [viteBin(), 'build', '--config', configPath], {
      cwd: UI_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env, BROWSER: 'none', NODE_ENV: 'production' },
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
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`vite build exited ${code}\n${stderr || stdout}`))
    })
  })
}

/**
 * @param {number} [port]
 * @param {{ mode?: 'preview' | 'dev' }} [opts]
 * Default: production preview (matches gate bench). Pass `{ mode: 'dev' }` for sourcemaps.
 */
export async function startVite(port = 5173, opts = {}) {
  const configPath = path.join(BENCH_ROOT, 'vite.config.ts')
  const mode = opts.mode === 'dev' ? 'dev' : 'preview'
  if (mode === 'preview') {
    await buildBenchPreview()
  }
  const args =
    mode === 'preview'
      ? [
          'preview',
          '--config',
          configPath,
          '--host',
          '127.0.0.1',
          '--strictPort',
          '--port',
          String(port),
        ]
      : [
          '--config',
          configPath,
          '--host',
          '127.0.0.1',
          '--strictPort',
          '--port',
          String(port),
        ]
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

  return {
    child,
    ready,
    mode,
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

export async function installRouteStubs(page) {
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

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })
}

/**
 * Open bench host with N styles; return page/context/frame + CDP session on the panel target.
 * @param {import('playwright').Browser} browser
 * @param {string} baseUrl
 * @param {number} n
 * @param {{ profileFromNavigation?: boolean }} [opts]
 */
export async function openBench(browser, baseUrl, n, opts = {}) {
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

  const hostClient = await page.context().newCDPSession(page)
  await hostClient.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  })

  /** @type {Map<string, any>} */
  const sessions = new Map()
  sessions.set('host', hostClient)

  hostClient.on('Target.attachedToTarget', async (event) => {
    const sessionId = event.sessionId
    const info = event.targetInfo
    if (!sessionId || !info) return
    // Flattened sessions share the same CDPSession; track by target id for URL matching.
    sessions.set(info.targetId, { info, sessionId })
  })

  const hostUrl = `${baseUrl}/bench/host.html?n=${n}&profile=1`
  await page.goto(hostUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })

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

  // Prefer a CDP client that can see panel scripts. Same-origin iframe shares the page target
  // in Chromium (non-OOPIF); Profiler on the page session captures both.
  const client = hostClient

  void opts
  return {
    context,
    page,
    frame,
    client,
    iframeHandle,
    n,
    async close() {
      await iframeHandle.dispose().catch(() => {})
      await context.close()
    },
  }
}

/**
 * Wait until enough cards are mounted and the count is stable.
 * @param {import('playwright').Frame} frame
 * @param {number} n
 */
export async function waitForGridStable(frame, n) {
  const expectedMin = Math.min(n, 40)
  await frame.waitForFunction(
    (minCards) => document.querySelectorAll('[data-sg-card="true"]').length >= minCards,
    expectedMin,
    { timeout: 180_000 },
  )

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
  return lastCount
}

/** Prefer a single source so duplicate-name rows do not open the source picker. */
export async function selectFirstSource(frame) {
  await frame.evaluate(() => {
    const select = document.querySelector('select')
    if (!(select instanceof HTMLSelectElement) || select.options.length < 2) return
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    proto?.call(select, select.options[1].value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await frame.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/**
 * Enable Debugger + Profiler; collect script metadata for sourcemap resolution.
 * @param {import('playwright').CDPSession} client
 */
export async function enableProfiling(client) {
  /** @type {Map<string, { url: string, sourceMapURL?: string, scriptId: string }>} */
  const scripts = new Map()

  client.on('Debugger.scriptParsed', (params) => {
    if (!params?.scriptId) return
    scripts.set(params.scriptId, {
      scriptId: params.scriptId,
      url: params.url || '',
      sourceMapURL: params.sourceMapURL || '',
    })
  })

  await client.send('Debugger.enable')
  await client.send('Profiler.enable')
  // 100µs sampling for denser attribution on short interactions
  await client.send('Profiler.setSamplingInterval', { interval: 100 })

  return { scripts }
}
