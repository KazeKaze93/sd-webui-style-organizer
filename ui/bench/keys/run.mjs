/**
 * KEYS-E2E — Playwright keyboard / focus contract against PROD bench preview.
 *
 * Scope: ui/bench/keys/** only (+ npm script wiring). Does not implement app keyboard.
 * Host: ui/bench/vite.config.ts → .preview-dist (same pattern as menu/blur/profile).
 *
 * Usage (from ui/):
 *   npm run bench:keys
 *   node bench/keys/run.mjs
 *   node bench/keys/run.mjs --sizes 500 --headed
 *   node bench/keys/run.mjs --dev
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { buildBenchFixture } from '../generateStyles.mjs'
import {
  installRouteStubs,
  selectFirstSource,
  sleep,
  startVite,
  waitForGridStable,
  waitForUrl,
  VIEWPORT,
} from '../profile/lib.mjs'
import { runKeyAssertions } from './assertions.mjs'
import { installCloseListener } from './focusHelpers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEYS_ROOT = __dirname
const OUT_DIR = path.join(KEYS_ROOT, 'out')
const RAW_JSON = path.join(OUT_DIR, 'keys-e2e.raw.json')
const REPORT_MD = path.join(KEYS_ROOT, 'report.md')

const DEFAULT_SIZES = [500, 5000]

function parseArgs(argv) {
  const out = {
    port: 5191,
    headed: false,
    dev: false,
    sizes: [...DEFAULT_SIZES],
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--port') out.port = Number(argv[++i]) || 5191
    else if (a === '--headed') out.headed = true
    else if (a === '--dev') out.dev = true
    else if (a === '--sizes') {
      out.sizes = String(argv[++i])
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    }
  }
  if (out.sizes.length === 0) out.sizes = [...DEFAULT_SIZES]
  return out
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} baseUrl
 * @param {number} n
 */
async function openKeysBench(browser, baseUrl, n) {
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
    try {
      localStorage.removeItem('sg_v2_last_source')
      localStorage.removeItem('sg_v2_last_source_txt2img')
      localStorage.removeItem('sg_v2_last_source_img2img')
    } catch {
      // ignore
    }
  }, { styles, favorites, selected, tab: 'txt2img', n })

  await page.goto(`${baseUrl}/bench/host.html?n=${n}&keys=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await installCloseListener(page)
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

  return {
    context,
    page,
    frame,
    fixture,
    async close() {
      await iframeHandle.dispose().catch(() => {})
      await context.close()
    },
  }
}

/**
 * @param {Array<{ id: string, name: string, pass: boolean, detail: string }>} assertions
 * @param {number} n
 */
function printTable(assertions, n) {
  console.log('')
  console.log(`KEYS-E2E N=${n}`)
  console.log(`${'ID'.padEnd(22)} ${'PASS'.padEnd(6)} NAME`)
  console.log('-'.repeat(72))
  for (const a of assertions) {
    const mark = a.pass ? 'PASS' : 'FAIL'
    console.log(`${a.id.padEnd(22)} ${mark.padEnd(6)} ${a.name}`)
    if (!a.pass) console.log(`${''.padEnd(22)}        → ${a.detail}`)
  }
  const passN = assertions.filter((a) => a.pass).length
  console.log('-'.repeat(72))
  console.log(`${passN}/${assertions.length} passed`)
  console.log('')
}

/**
 * @param {object} payload
 */
function buildReport(payload) {
  const lines = []
  lines.push('# KEYS-E2E report')
  lines.push('')
  lines.push(`Generated: ${payload.createdAt}`)
  lines.push('')
  lines.push('## Scope')
  lines.push('')
  lines.push('- Target: PROD bench preview (`ui/bench/vite.config.ts` → `.preview-dist`)')
  lines.push('- Data: realistic `buildBenchFixture` at N∈{500,5000}')
  lines.push('- Ownership: `ui/bench/keys/**` only — does **not** implement app keyboard')
  lines.push('- Contract: Tab/arrows/selection/nav/menu/Escape/dialog focus (see assertions)')
  lines.push('')
  lines.push('## Pass / fail')
  lines.push('')

  for (const block of payload.sizes) {
    lines.push(`### N=${block.n}`)
    lines.push('')
    lines.push('| ID | Result | Assertion | Detail |')
    lines.push('|---|---|---|---|')
    for (const a of block.assertions) {
      const mark = a.pass ? 'PASS' : 'FAIL'
      const detail = String(a.detail).replace(/\|/g, '\\|').replace(/\n/g, ' ')
      lines.push(`| \`${a.id}\` | **${mark}** | ${a.name} | ${detail} |`)
    }
    const passN = block.assertions.filter((a) => a.pass).length
    lines.push('')
    lines.push(`**${passN}/${block.assertions.length} passed** at N=${block.n}`)
    lines.push('')
  }

  lines.push('## Gaps (from FAIL details)')
  lines.push('')
  const gapIds = new Set()
  for (const block of payload.sizes) {
    for (const a of block.assertions) {
      if (!a.pass) gapIds.add(a.id)
    }
  }
  if (gapIds.size === 0) {
    lines.push('- None — all assertions passed.')
  } else {
    lines.push('Known Wave-0 gaps (see `docs/plans/KEY_AUDIT.md`) that this harness expects to FAIL until keyboard lands:')
    lines.push('')
    lines.push('- Style cards / category headers are mouse-only (`div`, no `tabIndex` / roving focus)')
    lines.push('- No arrow-key grid navigation')
    lines.push('- Enter/Space do not toggle selection on cards')
    lines.push('- ContextMenu / Shift+F10 do not open card menu')
    lines.push('- `ViewportFixedMenu` has no Escape dismiss / menu keyboard')
    lines.push('- Escape layering incomplete (menu/dialog can fall through to `SG_CLOSE_REQUEST`)')
    lines.push('- Dialog Tab trap / focus restore incomplete for custom `role="dialog"` surfaces')
    lines.push('')
    lines.push(`Failed IDs this run: ${[...gapIds].map((id) => `\`${id}\``).join(', ')}`)
  }
  lines.push('')
  lines.push('Raw JSON: `out/keys-e2e.raw.json`')
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  fs.mkdirSync(OUT_DIR, { recursive: true })

  console.log(
    `[keys] sizes=${args.sizes.join(',')} vite=${args.dev ? 'dev' : 'preview'} port=${args.port}`,
  )

  const vite = await startVite(args.port, { mode: args.dev ? 'dev' : 'preview' })
  const browser = await chromium.launch({
    headless: !args.headed,
    args: ['--disable-dev-shm-usage', '--disable-gpu'],
  })

  /** @type {Array<{ n: number, assertions: object[], passCount: number, total: number }>} */
  const sizeBlocks = []
  let anyFail = false

  try {
    const baseUrl = await vite.ready
    await waitForUrl(`${baseUrl}/bench/host.html`)
    console.log(`[keys] vite ready at ${baseUrl}`)

    for (const n of args.sizes) {
      console.log(`[keys] N=${n} opening bench…`)
      const bench = await openKeysBench(browser, baseUrl, n)
      try {
        await waitForGridStable(bench.frame, n)
        await selectFirstSource(bench.frame)
        await sleep(150)

        console.log(`[keys] N=${n} running assertions…`)
        const assertions = await runKeyAssertions(bench.page, bench.frame, n)
        printTable(assertions, n)

        const passCount = assertions.filter((a) => a.pass).length
        if (passCount < assertions.length) anyFail = true
        sizeBlocks.push({
          n,
          assertions,
          passCount,
          total: assertions.length,
        })
      } finally {
        await bench.close()
      }
    }

    const payload = {
      createdAt: new Date().toISOString(),
      viewport: VIEWPORT,
      viteMode: args.dev ? 'dev' : 'preview',
      sizes: sizeBlocks,
    }
    fs.writeFileSync(RAW_JSON, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    const md = buildReport(payload)
    fs.writeFileSync(REPORT_MD, md, 'utf8')
    console.log(`[keys] wrote ${REPORT_MD}`)
    console.log(`[keys] wrote ${RAW_JSON}`)

    if (anyFail) process.exitCode = 1
  } finally {
    await browser.close()
    await vite.stop()
  }
}

main().catch((err) => {
  console.error('[keys] FAILED', err)
  process.exitCode = 1
})
