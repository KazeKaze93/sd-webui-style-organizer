/**
 * README screenshots from the real panel on a local test page.
 *
 *   node bench/screenshots/capture.mjs              (from ui/; all shots)
 *   node bench/screenshots/capture.mjs --only presets,edit-dialog
 *   node bench/screenshots/capture.mjs --no-build   (reuse bench/.preview-dist)
 *
 * Builds the bench preview (bench/vite.config.ts), serves it with `vite
 * preview`, and drives it with Playwright. Every /style_grid/* request is
 * answered from dataset.mjs, a neutral demo library (photography and art
 * terms); previews are placeholder gradients. Host pages are the bench host
 * (panel only) or the hand-drawn mocks next to this file (ComfyUI canvas,
 * Forge img2img), served from the same origin so the panel's message checks
 * pass. Shots are Dark theme, device scale 1, written to docs/screenshots/.
 *
 * The same file runs in the ComfyUI and the WebUI repo: the platform is the
 * repo it sits in (web/js/style_grid.js exists only in ComfyUI).
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { parseViteLocalUrl } from '../lib/viteUrl.mjs'
import * as data from './dataset.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UI_ROOT = path.resolve(HERE, '../..')
const REPO = path.resolve(UI_ROOT, '..')
const OUT_DIR = path.join(REPO, 'docs', 'screenshots')
const PLATFORM = fs.existsSync(path.join(REPO, 'web', 'js', 'style_grid.js')) ? 'comfy' : 'webui'
const BENCH_CONFIG = path.join(UI_ROOT, 'bench', 'vite.config.ts')
const VITE_BIN = path.join(UI_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const PORT = 5241

const STYLES = data.buildStyles(PLATFORM)
const LIBRARY = PLATFORM === 'webui' ? [...STYLES, ...data.buildLoras()] : STYLES
const SRC = data.sourceIds(PLATFORM)
const KEY = (name, source = SRC.main) => `${source}\0${name}`

const args = process.argv.slice(2)
const ONLY = (() => {
  const i = args.indexOf('--only')
  return i >= 0 ? new Set(String(args[i + 1] || '').split(',').filter(Boolean)) : null
})()
const NO_BUILD = args.includes('--no-build')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function run(cmdArgs, { waitReady = false } = {}) {
  const child = spawn(process.execPath, [VITE_BIN, ...cmdArgs], {
    cwd: UI_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none', NODE_ENV: 'production' },
    windowsHide: true,
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite timed out\n${log}`)), 180_000)
    const check = () => {
      if (!waitReady) return
      const url = parseViteLocalUrl(log)
      if (url) {
        clearTimeout(timer)
        resolve(url)
      }
    }
    child.stdout.on('data', check)
    child.stderr.on('data', check)
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0 && !waitReady) resolve(null)
      else if (code !== 0) reject(new Error(`vite exited ${code}\n${log}`))
    })
  })
  return { child, done }
}

function stop(child) {
  if (!child || child.exitCode != null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
  } else {
    child.kill('SIGTERM')
  }
}

// ---------------------------------------------------------------- page setup

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

/** Neutral answers for every /style_grid/* route the panel calls. */
async function mockApi(route) {
  const req = route.request()
  const url = new URL(req.url())
  const p = url.pathname
  const get = req.method() === 'GET'
  if (get && p === '/style_grid/favorites') {
    return json(route, { items: data.favoriteKeys(PLATFORM), persisted: true, ambiguous: [] })
  }
  if (get && p === '/style_grid/presets') return json(route, data.presets(PLATFORM))
  if (get && p === '/style_grid/thumbnails/list') {
    return json(route, { has_thumbnail: data.thumbnailKeys(STYLES) })
  }
  if (get && p === '/style_grid/thumbnail') {
    return route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: data.thumbnailSvg(url.searchParams.get('name') || ''),
    })
  }
  if (get && p === '/style_grid/backups') {
    return json(route, {
      backups: [
        { name: 'snapshot_2026-11-20_18-05-12', has_dir: false, has_zip: true, size: 48_213, members: [], has_thumbnails: false },
        { name: 'snapshot_2026-11-14_09-41-03', has_dir: false, has_zip: true, size: 1_204_331, members: [], has_thumbnails: true },
      ],
      thumbnails_bytes: 3_145_728,
      keep_snapshots: 20,
    })
  }
  if (p.startsWith('/style_grid/lora/fetch_titles/status')) {
    return json(route, { status: 'idle', done: 0, total: 0, errors: 0 })
  }
  return json(route, { ok: true })
}

/** Mock host pages and the extension's own web/js modules, from disk, same origin. */
async function serveMock(route) {
  const url = new URL(route.request().url())
  const rel = url.pathname.replace(/^\/sg-mock\//, '')
  const file = rel.startsWith('web-js/')
    ? path.join(REPO, 'web', 'js', rel.slice('web-js/'.length))
    : path.join(HERE, rel)
  if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' })
  const type = file.endsWith('.html') ? 'text/html' : 'text/javascript'
  return route.fulfill({ status: 200, contentType: `${type}; charset=utf-8`, body: fs.readFileSync(file, 'utf8') })
}

/**
 * A fresh page with the panel loaded.
 * @param {import('playwright').Browser} browser
 * @param {string} base
 * @param {{ host?: 'bench' | 'comfy' | 'forge', width?: number, height?: number, mock?: object }} opts
 */
async function openPanel(browser, base, opts = {}) {
  const host = opts.host ?? 'bench'
  const context = await browser.newContext({
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 760 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  })
  const page = await context.newPage()
  await page.route('**/style_grid/**', mockApi)
  await page.route(`${base}/sg-mock/**`, serveMock)
  if (host === 'bench') {
    await page.addInitScript((payload) => {
      window.__BENCH__ = payload
    }, { styles: LIBRARY, tab: 'txt2img' })
    await page.goto(`${base}/bench/host.html`)
  } else {
    await page.addInitScript((payload) => {
      window.__SG_MOCK__ = payload
    }, { styles: LIBRARY, tab: 'img2img', ...opts.mock })
    await page.goto(`${base}/sg-mock/${host === 'comfy' ? 'mock-comfy.html' : 'mock-forge.html'}`)
    await page.waitForFunction(() => window.__SG_MOCK_READY__ === true)
  }
  const frame = page.frameLocator('iframe')
  if (host === 'bench' || opts.mock?.openPanel) {
    await frame.locator('[data-sg-card]').first().waitFor({ timeout: 30_000 })
    await postToPanel(page, { type: 'SG_THEME', mode: 'dark' })
    await settle(page)
  }
  return { context, page, frame }
}

/** Post a host message to the panel, from the host window (as the real host does). */
function postToPanel(page, msg) {
  return page.evaluate((m) => {
    const iframe = document.querySelector('iframe')
    iframe.contentWindow.postMessage(m, location.origin)
  }, msg)
}

async function settle(page, ms = 250) {
  await sleep(ms)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** Grid tile by its shown label. */
function card(frame, label) {
  return frame.locator('[data-sg-card]', { has: frame.locator(`text="${label}"`) }).first()
}

/** Sidebar row (category, Favorites, Presets, LoRA). */
function sidebarRow(frame, label) {
  return frame.locator('[data-sg-sidebar="true"] button').filter({ hasText: new RegExp(`^\\s*${label}\\s*\\d*\\s*$`) }).first()
}

async function selectCards(page, frame, labels) {
  for (const label of labels) {
    const c = card(frame, label)
    await c.scrollIntoViewIfNeeded()
    await c.click()
    await sleep(60)
  }
  await settle(page)
}

async function moveMouseAway(page) {
  await page.mouse.move(2, 2)
  await sleep(60)
}

/** Union of element boxes plus padding, inside the viewport. */
async function clipAround(page, locators, pad = 16) {
  const boxes = []
  for (const l of locators) {
    const b = await l.boundingBox()
    if (b) boxes.push(b)
  }
  if (!boxes.length) throw new Error('nothing to clip around')
  const vp = page.viewportSize()
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad)
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad)
  const x1 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad)
  const y1 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad)
  return { x: Math.floor(x0), y: Math.floor(y0), width: Math.ceil(x1 - x0), height: Math.ceil(y1 - y0) }
}

const menu = (frame) => frame.locator('[role="menu"]').last()

// ---------------------------------------------------------------- shots

const WILDCARD_CHIPS = [
  { category: 'weather', spec: '', kind: 'sg' },
  { category: 'lighting', spec: 'Golden_Hour,Blue_Hour,Moonlight', kind: 'sg' },
]

/** @type {Array<{ name: string, platforms?: string[], run: (env: object) => Promise<object | undefined> }>} */
const SHOTS = [
  // --- panel, both platforms
  {
    name: 'browse-and-filter',
    platforms: ['webui'],
    async run({ page, frame }) {
      await sidebarRow(frame, 'LIGHTING').click()
      await settle(page)
      await selectCards(page, frame, ['Golden Hour', 'Rim Light'])
      await moveMouseAway(page)
    },
  },
  {
    name: 'apply-and-reorder',
    platforms: ['webui'],
    async run({ page, frame }) {
      await selectCards(page, frame, ['Golden Hour', 'Wide Angle', 'Watercolor', 'Coastline'])
      await postToPanel(page, { type: 'SG_WILDCARDS_ACTIVE', categories: WILDCARD_CHIPS.slice(0, 1) })
      await settle(page)
      await moveMouseAway(page)
    },
  },
  {
    name: 'search-autocomplete',
    async run({ page, frame }) {
      const input = frame.locator('[aria-label="Search styles"]')
      await input.click()
      await input.pressSequentially('light', { delay: 30 })
      await settle(page, 400)
      return { clip: { x: 0, y: 0, width: 1280, height: 420 } }
    },
  },
  {
    name: 'style-card-context-menu',
    async run({ page, frame }) {
      const c = card(frame, 'Golden Hour')
      await c.click({ button: 'right' })
      await settle(page)
      return { clip: await clipAround(page, [c, menu(frame)], 20) }
    },
  },
  {
    name: 'edit-dialog',
    platforms: ['comfy'],
    async run({ page, frame }) {
      await card(frame, 'Golden Hour').click({ button: 'right' })
      await settle(page)
      await frame.getByRole('menuitem', { name: /^Edit/ }).click()
      await settle(page, 400)
      return { clip: await clipAround(page, [frame.locator('[role="dialog"]').last()], 12) }
    },
  },
  {
    name: 'move-category-dialog',
    platforms: ['comfy'],
    async run({ page, frame }) {
      await card(frame, 'Golden Hour').click({ button: 'right' })
      await settle(page)
      await frame.getByRole('menuitem', { name: /^Move to category/ }).click()
      await settle(page, 400)
      return { clip: await clipAround(page, [frame.locator('[role="dialog"]').last()], 12) }
    },
  },
  {
    name: 'read-only-samples',
    platforms: ['comfy'],
    async run({ page, frame }) {
      await sidebarRow(frame, 'DEMO').click()
      await settle(page)
      const c = card(frame, 'Soft Portrait')
      await c.click({ button: 'right' })
      await settle(page)
      return { clip: await clipAround(page, [c, menu(frame)], 20) }
    },
  },
  {
    name: 'wildcards',
    platforms: ['comfy'],
    async run({ page, frame }) {
      await postToPanel(page, { type: 'SG_WILDCARDS_ACTIVE', categories: [...WILDCARD_CHIPS, { category: 'mood', spec: '', kind: 'sgd' }] })
      await postToPanel(page, { type: 'SG_DECK_STATE', seed: 52113, index: 3 })
      const row = sidebarRow(frame, 'LIGHTING')
      await row.click({ button: 'right' })
      await settle(page, 350)
    },
  },
  {
    name: 'category-context-wildcard-previews',
    platforms: ['webui'],
    async run({ page, frame }) {
      const row = sidebarRow(frame, 'LIGHTING')
      await row.click({ button: 'right' })
      await settle(page, 350)
      return { clip: await clipAround(page, [frame.locator('[data-sg-sidebar="true"]'), menu(frame)], 12) }
    },
  },
  {
    name: 'slice-selection-mode',
    platforms: ['webui'],
    async run({ page, frame }) {
      await sidebarRow(frame, 'LIGHTING').click({ button: 'right' })
      await settle(page)
      await frame.getByRole('menuitem', { name: /^Pick styles/ }).click()
      await settle(page, 400)
      for (const label of ['Golden Hour', 'Blue Hour', 'Moonlight', 'Candlelight']) {
        // In slice mode a toggle button covers each tile.
        await card(frame, label).click({ force: true })
        await sleep(60)
      }
      await settle(page)
      await moveMouseAway(page)
    },
  },
  {
    name: 'wildcard-slice-chips',
    platforms: ['webui'],
    async run({ page, frame }) {
      await selectCards(page, frame, ['Wide Angle'])
      await postToPanel(page, { type: 'SG_WILDCARDS_ACTIVE', categories: WILDCARD_CHIPS })
      await settle(page, 350)
      await moveMouseAway(page)
      const vp = page.viewportSize()
      return { clip: { x: 0, y: vp.height - 230, width: vp.width, height: 230 } }
    },
  },
  {
    name: 'presets',
    platforms: ['comfy'],
    async run({ page, frame }) {
      await sidebarRow(frame, 'Presets').click()
      await settle(page, 400)
      await moveMouseAway(page)
    },
  },
  {
    name: 'favorites-view',
    platforms: ['webui'],
    async run({ page, frame }) {
      await sidebarRow(frame, 'Favorites').click()
      await settle(page, 400)
      await moveMouseAway(page)
    },
  },
  {
    name: 'favorites-in-category',
    platforms: ['webui'],
    async run({ page, frame }) {
      await sidebarRow(frame, 'LIGHTING').click()
      await settle(page)
      await moveMouseAway(page)
      return { clip: { x: 0, y: 0, width: 1280, height: 420 } }
    },
  },
  {
    name: 'import-export-menu',
    platforms: ['comfy'],
    async run({ page, frame }) {
      const more = frame.locator('[aria-label="More"]')
      await more.click()
      await settle(page)
      return { clip: await clipAround(page, [more, menu(frame)], 16) }
    },
  },
  {
    name: 'top-bar-icons',
    platforms: ['webui'],
    async run({ page, frame }) {
      await moveMouseAway(page)
      const vp = page.viewportSize()
      return { clip: { x: 0, y: 0, width: vp.width, height: 58 } }
    },
  },
  {
    name: 'lora-view',
    platforms: ['webui'],
    async run({ page, frame }) {
      await sidebarRow(frame, 'LoRA').click()
      await settle(page, 400)
      await moveMouseAway(page)
    },
  },
  {
    name: 'lora-fetch-titles',
    platforms: ['webui'],
    async run({ page, frame }) {
      await sidebarRow(frame, 'LoRA').click()
      await settle(page, 400)
      const btn = frame.locator('button[aria-label*="LoRA titles"]').first()
      await btn.hover()
      await settle(page, 700)
      // Radix also renders a 1px visually hidden role=tooltip; measure the visible popper.
      const tip = frame.locator('[data-radix-popper-content-wrapper]').first()
      return { clip: await clipAround(page, [btn, tip], 16) }
    },
  },
  {
    name: 'tile-expand',
    async run({ page, frame }) {
      const c = card(frame, 'Volumetric Light Through Cathedral Windows')
      await c.scrollIntoViewIfNeeded()
      await settle(page)
      await c.hover()
      await settle(page, 300)
      const overlay = frame.locator('[data-sg-tile-expanded]')
      return { clip: await clipAround(page, [c, overlay], 90) }
    },
  },
  {
    name: 'gallery-view',
    async run({ page, frame }) {
      await frame.locator('[data-sg-view-mode="gallery"]').click()
      await settle(page, 600)
      await moveMouseAway(page)
    },
  },

  // --- host mocks
  {
    name: 'grid-overview',
    platforms: ['comfy'],
    host: 'comfy',
    mock: {
      openPanel: true,
      text: 'a lighthouse on a cliff at dusk, {sg:weather}',
      negativeText: 'blurry',
      applied: [KEY('LIGHTING_Golden_Hour'), KEY('CAMERA_Wide_Angle'), KEY('MEDIUM_Watercolor', SRC.art)],
    },
    async run({ page }) {
      await settle(page, 300)
      await moveMouseAway(page)
    },
  },
  {
    name: 'fullscreen-mode',
    host: PLATFORM === 'comfy' ? 'comfy' : 'forge',
    mock: { openPanel: true, text: 'a lighthouse on a cliff at dusk' },
    async run({ page, frame }) {
      await frame.locator('[aria-label="Fullscreen"]').click()
      await settle(page, 500)
      await moveMouseAway(page)
    },
  },
  {
    name: 'node-wiring',
    platforms: ['comfy'],
    host: 'comfy',
    mock: {
      text: 'a lighthouse on a cliff at dusk, {sg:weather}',
      negativeText: 'blurry',
      applied: [KEY('LIGHTING_Golden_Hour'), KEY('CAMERA_Wide_Angle')],
    },
    async run({ page }) {
      await settle(page, 300)
      return { clip: { x: 20, y: 50, width: 880, height: 660 } }
    },
  },
  {
    name: 'node-chips',
    platforms: ['comfy'],
    host: 'comfy',
    mock: {
      text: 'a lighthouse on a cliff at dusk, {sg:weather}, {sgd:mood}',
      negativeText: 'blurry',
      applied: [
        KEY('LIGHTING_Golden_Hour'),
        KEY('CAMERA_Wide_Angle'),
        KEY('MEDIUM_Watercolor', SRC.art),
        KEY('COMPOSITION_Rule_Of_Thirds'),
      ],
    },
    async run({ page }) {
      await settle(page, 300)
      return { clip: await clipAround(page, [page.locator('#sg')], 14) }
    },
  },
  {
    name: 'img2img-support',
    platforms: ['webui'],
    host: 'forge',
    mock: { openPanel: true, tab: 'img2img', text: 'a lighthouse on a cliff at dusk', negativeText: 'blurry' },
    async run({ page, frame }) {
      await selectCards(page, frame, ['Art Deco', 'Wide Angle'])
      await moveMouseAway(page)
    },
  },
]

// ---------------------------------------------------------------- main

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  if (!NO_BUILD) {
    console.log(`[shots] ${PLATFORM}: building bench preview`)
    await run(['build', '--config', BENCH_CONFIG]).done
  }
  const preview = run(
    ['preview', '--config', BENCH_CONFIG, '--host', '127.0.0.1', '--strictPort', '--port', String(PORT)],
    { waitReady: true },
  )
  const base = await preview.done
  console.log(`[shots] preview at ${base}`)
  const browser = await chromium.launch()
  const failures = []
  try {
    for (const shot of SHOTS) {
      if (shot.platforms && !shot.platforms.includes(PLATFORM)) continue
      if (ONLY && !ONLY.has(shot.name)) continue
      const env = await openPanel(browser, base, { host: shot.host, mock: shot.mock })
      try {
        const result = (await shot.run(env)) || {}
        const file = path.join(OUT_DIR, `${shot.name}.png`)
        await env.page.screenshot({ path: file, clip: result.clip })
        console.log(`[shots] ${shot.name}.png`)
      } catch (err) {
        failures.push(shot.name)
        console.error(`[shots] ${shot.name} FAILED: ${err.message.split('\n')[0]}`)
      } finally {
        await env.context.close()
      }
    }
  } finally {
    await browser.close()
    stop(preview.child)
  }
  if (failures.length) {
    console.error(`[shots] failed: ${failures.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
