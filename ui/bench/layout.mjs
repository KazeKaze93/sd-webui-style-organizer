/**
 * Layout invariant bench (dev-only — not in prod bundle).
 *
 * Checks every density at N (default 500) × top + after 3 screens:
 *   (1) card height <= CARD_ROW_HEIGHT - ROW_GAP + 0.5
 *   (2) v-gap == ROW_GAP ±0.5 and == h-gap ±0.5
 *   (3) no card overlaps
 *
 * Usage (from ui/):
 *   npm run bench:layout
 *   npm run bench:layout -- --sizes 500,5000
 *   npm run bench:layout -- --prove-fail
 *   npm run bench:layout -- --dev
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import {
  applySelected,
  proveFailPath,
  runLayoutInvariantsForFrame,
  selectFirstSource,
  sleep,
} from './lib/layoutHarness.mjs'
import {
  openBench,
  startVite,
  waitForGridStable,
  waitForUrl,
} from './profile/lib.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = path.join(__dirname, 'results')

function parseArgs(argv) {
  const out = {
    sizes: [500],
    port: 5176,
    headed: false,
    dev: false,
    proveFail: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--sizes') {
      out.sizes = String(argv[++i])
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    } else if (a === '--port') out.port = Number(argv[++i]) || 5176
    else if (a === '--headed') out.headed = true
    else if (a === '--dev') out.dev = true
    else if (a === '--prove-fail') out.proveFail = true
  }
  if (out.sizes.length === 0) throw new Error('--sizes produced an empty list')
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  fs.mkdirSync(RESULTS_DIR, { recursive: true })

  const viteMode = args.dev ? 'dev' : 'preview'
  console.log(
    `[layout] sizes=${args.sizes.join(',')} vite=${viteMode} proveFail=${args.proveFail}`,
  )
  console.log(
    '[layout] tip note: StyleCard usage UI already removed + fixed height on working tree; ' +
      'expect GREEN on live tip. Use --prove-fail to validate the FAIL path via inflated cards.',
  )

  const vite = await startVite(args.port, { mode: viteMode })
  const browser = await chromium.launch({
    headless: !args.headed,
    args: ['--disable-dev-shm-usage', '--disable-gpu'],
  })

  /** @type {object[]} */
  const allResults = []
  let allOk = true
  let failPathOk = true

  try {
    const baseUrl = await vite.ready
    await waitForUrl(`${baseUrl}/bench/host.html`)
    console.log(`[layout] vite ${vite.mode} ready at ${baseUrl}`)

    for (const n of args.sizes) {
      const bench = await openBench(browser, baseUrl, n)
      try {
        await waitForGridStable(bench.frame, n)
        await selectFirstSource(bench.frame)
        await sleep(100)
        await applySelected(bench.frame, bench.fixture?.selected ?? [])
        await sleep(100)

        console.log(
          `[layout] fixture N=${n} usage=${bench.fixture?.meta?.usageKeys ?? 0} ` +
            `favs=${bench.fixture?.meta?.favoriteCount ?? 0} ` +
            `selected=${bench.fixture?.meta?.selectedCount ?? 0}`,
        )

        const run = await runLayoutInvariantsForFrame(bench.frame, { n })
        allResults.push(...run.results)
        if (!run.ok) allOk = false

        if (args.proveFail) {
          const proved = await proveFailPath(bench.frame, { n })
          if (!proved.ok) failPathOk = false
        }
      } finally {
        await bench.close()
      }
    }
  } finally {
    await browser.close()
    await vite.stop()
  }

  const outPath = path.join(RESULTS_DIR, 'layout.json')
  const doc = {
    createdAt: new Date().toISOString(),
    sizes: args.sizes,
    viteMode,
    tipAlreadyFixed:
      'StyleCard usage counter removed + fixed height (CARD wave already on working tree)',
    proveFail: args.proveFail,
    ok: allOk && failPathOk,
    layoutOk: allOk,
    failPathOk: args.proveFail ? failPathOk : null,
    results: allResults,
  }
  fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  console.log(`[layout] wrote ${outPath}`)
  console.log(`[layout] overall ${doc.ok ? 'PASS' : 'FAIL'} (layoutOk=${allOk}` +
    (args.proveFail ? `, failPathOk=${failPathOk}` : '') +
    ')')

  if (!doc.ok) process.exitCode = 1
}

main().catch((err) => {
  console.error('[layout] FAILED', err)
  process.exitCode = 1
})
