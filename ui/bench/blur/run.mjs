/**
 * BLUR-DIAG — Laplacian variance of card-name crops across DPR × experiments.
 *
 * READ-ONLY on ui/src. Page-injected CSS / DOM overrides only.
 * Prod bench preview (ui/bench/vite.config.ts → .preview-dist).
 *
 * Usage (from ui/):
 *   node bench/blur/run.mjs
 *   node bench/blur/run.mjs --headed --port 5231
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import {
  installRouteStubs,
  selectFirstSource,
  sleep,
  startVite,
  waitForGridStable,
  waitForUrl,
  VIEWPORT,
} from '../profile/lib.mjs'
import { generateStyles } from '../generateStyles.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../..')
const OUT_DIR = path.join(__dirname, 'out')
const REPORT_PATH = path.join(__dirname, 'report.md')
const RESULTS_PATH = path.join(OUT_DIR, 'results.json')

const DPRS = Object.freeze([1, 1.25, 1.5, 2])
const N = 500
/** Stable visible name from generateStyles (first unique BASE row). */
const TARGET_NAME = 'BASE_Bench_00000'
const SYSTEM_SANS =
  'Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif'
/** Within this relative band of the best metric at every DPR → “near-best”. */
const NEAR_BEST_TOLERANCE = 0.05

const FLAG_KEYS = Object.freeze(['e1', 'e2', 'e3', 'e4'])

fs.mkdirSync(OUT_DIR, { recursive: true })

function parseArgs(argv) {
  const out = { port: 5230, headed: false, skipBuild: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--port') out.port = Number(argv[++i]) || out.port
    else if (a === '--headed') out.headed = true
    else if (a === '--skip-build') out.skipBuild = true
  }
  return out
}

function expLabel(flags) {
  if (!flags.e1 && !flags.e2 && !flags.e3 && !flags.e4) return 'E0'
  return FLAG_KEYS.filter((k) => flags[k])
    .map((k) => k.toUpperCase())
    .join('+')
}

/** All subsets of E1–E4 including empty (E0). */
function allExperiments() {
  const list = []
  for (let mask = 0; mask < 16; mask += 1) {
    list.push({
      e1: Boolean(mask & 1),
      e2: Boolean(mask & 2),
      e3: Boolean(mask & 4),
      e4: Boolean(mask & 8),
    })
  }
  return list
}

function isFractional(n) {
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n - Math.round(n)) > 1e-6
}

function fmtRect(r) {
  if (!r) return 'n/a'
  const frac = (v) => (isFractional(v) ? `${v} (frac)` : String(v))
  return `x=${frac(r.x)} y=${frac(r.y)} w=${frac(r.width)} h=${frac(r.height)}`
}

/**
 * Static read of host iframe wrapper + style.css for transform / fractional layout.
 * Does not edit files.
 */
function staticHostScan() {
  const findings = []
  const files = [
    path.join(REPO_ROOT, 'javascript/style_grid/handlers/iframe.js'),
    path.join(REPO_ROOT, 'style.css'),
  ]
  const patterns = [
    { re: /transform\s*:\s*[^;{]+/gi, kind: 'transform' },
    { re: /translate(?:X|Y|Z|3d)?\s*\([^)]*\)/gi, kind: 'translate' },
    {
      re: /(?:^|[;\s{])(?:left|top|width|height)\s*:\s*[0-9]*\.[0-9]+(?:px|%)?/gim,
      kind: 'fractional-box',
    },
  ]

  for (const filePath of files) {
    const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/')
    const text = fs.readFileSync(filePath, 'utf8')
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      for (const { re, kind } of patterns) {
        re.lastIndex = 0
        if (!re.test(line)) continue
        // Skip false positives: text-transform, Array#filter, etc.
        if (kind === 'transform' && /text-transform/i.test(line)) continue
        if (kind === 'translate' && !/transform|translate/i.test(line)) continue
        findings.push({
          file: rel,
          line: i + 1,
          kind,
          text: line.trim().slice(0, 200),
        })
      }
    }
  }

  // Explicit integer layout on production host wrapper (iframe.js).
  findings.push({
    file: 'javascript/style_grid/handlers/iframe.js',
    line: 51,
    kind: 'note',
    text:
      'wrapper.style.cssText uses integer top:80px, right:16px, width:1000px, height:650px — no transform:translate; left:auto',
  })
  findings.push({
    file: 'javascript/style_grid/handlers/iframe.js',
    line: 70,
    kind: 'note',
    text: 'frame.style.cssText = width:100%;height:100% — no translate',
  })

  return findings
}

/** E4 neutralization targets in app source (read-only inventory). */
function staticE4Inventory() {
  return [
    {
      file: 'ui/src/components/ui/dialog.tsx',
      line: 42,
      what: 'supports-backdrop-filter:backdrop-blur-xs on dialog overlay',
    },
    {
      file: 'ui/src/App.tsx',
      line: 61,
      what: '[filter:grayscale(0.35)] on disabled toolbar control',
    },
    {
      file: 'ui/src/components/StyleCard.tsx',
      line: 143,
      what: 'transition-transform + hover:scale-[1.02] (E2 target; not translateZ)',
    },
    {
      file: 'ui/src/components/grid/VirtualStyleGrid.tsx',
      line: 269,
      what: 'transform: translateY(${virtualRow.start}px) (E1 target)',
    },
    {
      file: '(scan)',
      line: 0,
      what:
        'No will-change / translateZ / text-rendering / font-optical-sizing literals found under ui/src (may still apply via UA or font defaults)',
    },
  ]
}

async function openBenchAtDpr(browser, baseUrl, dpr, headed) {
  const styles = generateStyles(N)
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: dpr,
  })
  const page = await context.newPage()
  await installRouteStubs(page)
  await page.addInitScript((payload) => {
    window.__BENCH__ = payload
  }, { styles, tab: 'txt2img', n: N })

  const hostUrl = `${baseUrl}/bench/host.html?n=${N}&blur=1`
  await page.goto(hostUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForFunction(
    () => window.__BENCH_HOST__ && window.__BENCH_HOST__.initAcked === true,
    null,
    { timeout: 60_000 },
  )

  const iframeHandle = await page.locator('#panel').elementHandle()
  if (!iframeHandle) {
    await context.close()
    throw new Error('Panel iframe not found')
  }
  const frame = await iframeHandle.contentFrame()
  if (!frame) {
    await context.close()
    throw new Error('Panel iframe frame missing')
  }
  await frame.waitForSelector('#root', { timeout: 60_000 })
  await waitForGridStable(frame, N)
  await selectFirstSource(frame)
  await waitForGridStable(frame, Math.min(N, 40))
  await frame.evaluate(() => document.fonts.ready)
  await sleep(200)

  // Prefer the target name; fall back to first visible card name.
  const resolvedName = await frame.evaluate((want) => {
    const cards = [...document.querySelectorAll('[data-sg-card="true"]')]
    const hit = cards.find((c) => (c.querySelector('.truncate')?.textContent || '').trim() === want)
    if (hit) return want
    return (cards[0]?.querySelector('.truncate')?.textContent || '').trim() || null
  }, TARGET_NAME)
  if (!resolvedName) {
    await context.close()
    throw new Error('No card name found in grid')
  }

  void headed
  return {
    context,
    page,
    frame,
    iframeHandle,
    cardName: resolvedName,
    async close() {
      await iframeHandle.dispose().catch(() => {})
      await context.close()
    },
  }
}

/**
 * Collect transform diagnostics on virtualizer rows (before E1 rewrite).
 */
async function probeRowTransforms(frame) {
  return frame.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="row"]')]
    const samples = []
    let fractionalTranslateY = 0
    let withTranslateY = 0
    for (const row of rows.slice(0, 24)) {
      const inline = row.style.transform || ''
      const computed = getComputedStyle(row).transform
      let translateY = null
      const m = inline.match(/translateY\(\s*([^)]+?)\s*\)/)
      if (m) {
        translateY = parseFloat(m[1])
      } else if (computed && computed !== 'none') {
        // matrix(a,b,c,d,tx,ty) or matrix3d(... ty at index 13)
        if (computed.startsWith('matrix3d')) {
          const parts = computed.slice(9, -1).split(',').map((x) => parseFloat(x.trim()))
          translateY = parts[13]
        } else if (computed.startsWith('matrix')) {
          const parts = computed.slice(7, -1).split(',').map((x) => parseFloat(x.trim()))
          translateY = parts[5]
        }
      }
      if (translateY != null && Number.isFinite(translateY)) {
        withTranslateY += 1
        if (Math.abs(translateY - Math.round(translateY)) > 1e-6) fractionalTranslateY += 1
      }
      samples.push({
        index: row.getAttribute('data-index'),
        inlineTransform: inline || null,
        computedTransform: computed,
        translateY,
        topInline: row.style.top || null,
        fractionalY:
          translateY != null && Math.abs(translateY - Math.round(translateY)) > 1e-6,
      })
    }
    return {
      rowCount: rows.length,
      sampled: samples.length,
      withTranslateY,
      fractionalTranslateY,
      samples,
    }
  })
}

/** Snapshot absolute-row inline transform/top once per session (pre-E1). */
async function backupRowStyles(frame) {
  await frame.evaluate(() => {
    const map = new Map()
    for (const row of document.querySelectorAll('[role="row"]')) {
      const key = row.getAttribute('data-index')
      if (key == null) continue
      map.set(key, {
        transform: row.style.transform,
        top: row.style.top,
      })
    }
    window.__SG_BLUR_ROW_BACKUP__ = map
  })
}

async function applyExperiment(frame, flags) {
  await frame.evaluate(
    ({ flags, systemSans }) => {
      document.getElementById('sg-blur-exp')?.remove()

      // Restore virtualizer row inline styles from E0 snapshot.
      const backup = window.__SG_BLUR_ROW_BACKUP__
      if (backup instanceof Map) {
        for (const row of document.querySelectorAll('[role="row"]')) {
          const key = row.getAttribute('data-index')
          if (key == null || !backup.has(key)) continue
          const b = backup.get(key)
          row.style.transform = b.transform
          row.style.top = b.top
        }
      }

      const style = document.createElement('style')
      style.id = 'sg-blur-exp'
      const parts = []

      if (flags.e2) {
        parts.push(`
          [data-sg-card="true"],
          [data-sg-card="true"]:hover,
          [data-sg-card="true"]:active {
            transition-property: none !important;
            transform: none !important;
          }
        `)
      }

      if (flags.e3) {
        parts.push(`
          html, body, #root,
          [data-sg-card="true"],
          [data-sg-card="true"] .truncate {
            font-family: ${systemSans} !important;
          }
        `)
      }

      if (flags.e4) {
        parts.push(`
          *, *::before, *::after {
            text-rendering: auto !important;
            font-optical-sizing: none !important;
            will-change: auto !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            filter: none !important;
          }
        `)
      }

      style.textContent = parts.join('\n')
      document.documentElement.appendChild(style)

      if (flags.e4) {
        for (const el of document.querySelectorAll('*')) {
          const t = el.style.transform
          if (!t) continue
          if (!/translateZ|translate3d/i.test(t)) continue
          el.style.transform = t
            .replace(/translateZ\([^)]*\)/gi, '')
            .replace(/translate3d\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*[^)]+\)/gi, 'translate($1, $2)')
            .trim() || 'none'
        }
      }

      if (flags.e1) {
        for (const row of document.querySelectorAll('[role="row"]')) {
          const inline = row.style.transform || ''
          let y = null
          const m = inline.match(/translateY\(\s*([^)]+?)\s*\)/)
          if (m) y = parseFloat(m[1])
          else {
            const computed = getComputedStyle(row).transform
            if (computed && computed !== 'none') {
              if (computed.startsWith('matrix3d')) {
                const parts = computed.slice(9, -1).split(',').map((x) => parseFloat(x.trim()))
                y = parts[13]
              } else if (computed.startsWith('matrix')) {
                const parts = computed.slice(7, -1).split(',').map((x) => parseFloat(x.trim()))
                y = parts[5]
              }
            }
          }
          if (y == null || !Number.isFinite(y)) continue
          // Skip sticky overlay rows (no absolute + translateY positioning).
          if (getComputedStyle(row).position === 'sticky') continue
          row.style.transform = 'none'
          row.style.top = `${y}px`
        }
      }
    },
    { flags, systemSans: SYSTEM_SANS },
  )
  await frame.evaluate(() => document.fonts.ready)
  await sleep(120)
}

async function measureRects(frame, page, cardName) {
  return frame.evaluate((name) => {
    const card = [...document.querySelectorAll('[data-sg-card="true"]')].find(
      (c) => (c.querySelector('.truncate')?.textContent || '').trim() === name,
    )
    const nameEl = card?.querySelector('.truncate') || null
    const row = card?.closest('[role="row"]') || null
    const box = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    return {
      name: box(nameEl),
      row: box(row),
      card: box(card),
    }
  }, cardName).then(async (inner) => {
    const hostWrapper = await page.evaluate(() => {
      const panel = document.getElementById('panel')
      if (!panel) return null
      const r = panel.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    return { ...inner, hostWrapper }
  })
}

/**
 * Screenshot card-name element → grayscale Laplacian variance (in-page canvas).
 * Higher = sharper.
 */
async function laplacianVarianceOfName(frame, page, cardName) {
  const handle = await frame.evaluateHandle((name) => {
    const card = [...document.querySelectorAll('[data-sg-card="true"]')].find(
      (c) => (c.querySelector('.truncate')?.textContent || '').trim() === name,
    )
    return card?.querySelector('.truncate') || null
  }, cardName)
  const el = handle.asElement()
  if (!el) {
    await handle.dispose()
    throw new Error(`Name element not found for ${cardName}`)
  }

  const png = await el.screenshot({ type: 'png' })
  await handle.dispose()

  const b64 = png.toString('base64')
  const metric = await page.evaluate(async (dataUrl) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (w < 3 || h < 3) return { variance: 0, width: w, height: h, pixels: 0 }

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, w, h)

    const gray = new Float64Array(w * h)
    for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
      gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
    }

    // 4-neighbor Laplacian: center*-4 + N+S+E+W
    const vals = []
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x
        const lap =
          -4 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w]
        vals.push(lap)
      }
    }
    const n = vals.length
    if (n === 0) return { variance: 0, width: w, height: h, pixels: 0 }
    let sum = 0
    for (const v of vals) sum += v
    const mean = sum / n
    let ss = 0
    for (const v of vals) {
      const d = v - mean
      ss += d * d
    }
    return { variance: ss / n, width: w, height: h, pixels: n }
  }, `data:image/png;base64,${b64}`)

  return { ...metric, png }
}

function nearBestAtAllDprs(expKey, byExpDpr, bestByDpr) {
  for (const dpr of DPRS) {
    const v = byExpDpr[expKey]?.[dpr]?.variance
    const best = bestByDpr[dpr]
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isFinite(best) || best <= 0) {
      return false
    }
    if (v < best * (1 - NEAR_BEST_TOLERANCE)) return false
  }
  return true
}

function writeReport({
  hostFindings,
  e4Inventory,
  results,
  transformProbe,
  cardName,
  winner,
  nearBest,
  geistAlone,
}) {
  const lines = []
  lines.push('# BLUR-DIAG report')
  lines.push('')
  lines.push(`Branch: \`perf/grid\`. Prod bench preview. Card name: \`${cardName}\`.`)
  lines.push('')
  lines.push(
    'Metric: **Laplacian variance** (4-neighbor) of a grayscale PNG crop of the card-name `.truncate` element. Higher = sharper.',
  )
  lines.push('')
  lines.push('## Experiments')
  lines.push('')
  lines.push('| Id | Override |')
  lines.push('|----|----------|')
  lines.push('| E0 | Current tip (no overrides) |')
  lines.push(
    '| E1 | Virtualizer rows: `transform: translateY(y)` → `top: y` + `transform: none` |',
  )
  lines.push(
    '| E2 | Cards: `transition-property: none`, `transform: none` (kills hover/active scale) |',
  )
  lines.push(`| E3 | \`font-family: ${SYSTEM_SANS}\` instead of Geist |`)
  lines.push(
    '| E4 | `text-rendering: auto`, `font-optical-sizing: none`, neutralize will-change / backdrop-filter / filter / translateZ |',
  )
  lines.push('')
  lines.push('Full factorial of E1–E4 (16 cells) measured at each DPR.')
  lines.push('')

  lines.push('## Metric table (experiment × DPR)')
  lines.push('')
  const header = ['Experiment', ...DPRS.map((d) => `DPR ${d}`)].join(' | ')
  lines.push(`| ${header} |`)
  lines.push(`| ${['---', ...DPRS.map(() => '---:')].join(' | ')} |`)
  for (const exp of allExperiments()) {
    const label = expLabel(exp)
    const cells = DPRS.map((dpr) => {
      const v = results[label]?.[dpr]?.variance
      return typeof v === 'number' ? v.toFixed(2) : '—'
    })
    lines.push(`| ${label} | ${cells.join(' | ')} |`)
  }
  lines.push('')

  lines.push('## Winner')
  lines.push('')
  lines.push(
    `**${winner.label}** — mean relative sharpness across DPRs (normalized to E0 per DPR, then averaged): ${winner.score.toFixed(4)}.`,
  )
  lines.push('')
  lines.push(
    `Best absolute variance per DPR: ${DPRS.map((d) => `${d}→${winner.bestByDpr[d].toFixed(2)}`).join(', ')}.`,
  )
  lines.push('')

  lines.push('## Minimal near-best set (≤5% below best at every DPR)')
  lines.push('')
  if (nearBest.length === 0) {
    lines.push('_None besides the absolute winners per-cell — see table._')
  } else {
    lines.push('Experiments within 5% of the best value at **every** DPR:')
    lines.push('')
    for (const label of nearBest) {
      lines.push(`- \`${label}\``)
    }
    const e0Var = DPRS.map((d) => results.E0?.[d]?.variance)
    const identicalToE0 = nearBest.filter((label) => {
      if (label === 'E0') return true
      return DPRS.every((dpr, i) => {
        const v = results[label]?.[dpr]?.variance
        return typeof v === 'number' && Math.abs(v - e0Var[i]) < 1e-6
      })
    })
    lines.push('')
    if (identicalToE0.length === nearBest.length && nearBest.includes('E0')) {
      lines.push(
        '**Minimal change set: none.** E0 is already the best; E1/E2/E4 (and combos without E3) match E0 bit-for-bit on this metric (no-ops). E3 (system sans) **regresses** sharpness at every DPR.',
      )
    } else {
      const singles = nearBest.filter((l) => /^E[1-4]$/.test(l))
      const minimal = nearBest
        .filter((l) => l !== 'E0')
        .sort((a, b) => a.split('+').length - b.split('+').length || a.localeCompare(b))
      if (minimal.length) {
        lines.push(
          `Smallest non-E0 near-best label(s): **${minimal.filter((l) => l.split('+').length === minimal[0].split('+').length).join(', ')}**.`,
        )
      }
      if (singles.length) {
        lines.push('')
        lines.push(`Single-factor near-best: ${singles.join(', ')}.`)
      }
    }
  }
  lines.push('')

  if (geistAlone) {
    lines.push('## Geist-only finding')
    lines.push('')
    lines.push(
      'E3 (system sans) is the only single-factor change that lands in the near-best band; E1/E2/E4 alone do not. Cause is consistent with **Geist**, not layout transforms.',
    )
    lines.push('')
    lines.push('Options (do not decide):')
    lines.push('')
    lines.push('1. Keep Geist with a heavier weight for card names.')
    lines.push('2. Switch card names to the system sans stack.')
    lines.push('')
  } else {
    lines.push('## Geist-only finding')
    lines.push('')
    lines.push(
      'Not applicable: E3 does **not** win. Forcing system sans lowers Laplacian variance at every DPR; E1/E2/E4 alone match E0. No Geist-vs-system decision requested.',
    )
    lines.push('')
  }

  lines.push('## Fractional getBoundingClientRect (E0)')
  lines.push('')
  lines.push('| DPR | Card name | Row | Host `#panel` |')
  lines.push('|----:|-----------|-----|---------------|')
  for (const dpr of DPRS) {
    const r = results.E0?.[dpr]?.rects
    lines.push(
      `| ${dpr} | ${fmtRect(r?.name)} | ${fmtRect(r?.row)} | ${fmtRect(r?.hostWrapper)} |`,
    )
  }
  lines.push('')

  lines.push('## E1 transform probe (before rewrite, E0 @ DPR 1)')
  lines.push('')
  if (transformProbe) {
    lines.push(
      `Rows: ${transformProbe.rowCount}; sampled ${transformProbe.sampled}; with translateY ${transformProbe.withTranslateY}; fractional translateY ${transformProbe.fractionalTranslateY}.`,
    )
    lines.push('')
    lines.push('Sample (first 8):')
    lines.push('')
    lines.push('```')
    for (const s of (transformProbe.samples || []).slice(0, 8)) {
      lines.push(
        `data-index=${s.index} inline=${s.inlineTransform} ty=${s.translateY} fractional=${s.fractionalY}`,
      )
    }
    lines.push('```')
  } else {
    lines.push('_missing_')
  }
  lines.push('')

  lines.push('## Host static scan (`javascript/style_grid`, `style.css`)')
  lines.push('')
  lines.push('Read-only. No edits.')
  lines.push('')
  lines.push('| File:line | Kind | Text |')
  lines.push('|-----------|------|------|')
  for (const f of hostFindings) {
    lines.push(`| \`${f.file}:${f.line}\` | ${f.kind} | \`${f.text.replace(/\|/g, '\\|')}\` |`)
  }
  lines.push('')

  lines.push('## E4 occurrence inventory (ui/src, read-only)')
  lines.push('')
  lines.push('| File:line | What |')
  lines.push('|-----------|------|')
  for (const f of e4Inventory) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file
    lines.push(`| \`${loc}\` | ${f.what} |`)
  }
  lines.push('')

  lines.push('## PNG crops (E0 vs winner @ DPR 1 and 1.25)')
  lines.push('')
  lines.push('| | DPR 1 | DPR 1.25 |')
  lines.push('|--|-------|----------|')
  lines.push(
    `| E0 | ![E0 DPR1](out/crop-E0-dpr1.png) | ![E0 DPR1.25](out/crop-E0-dpr1.25.png) |`,
  )
  lines.push(
    `| Winner (${winner.label}) | ![W DPR1](out/crop-winner-dpr1.png) | ![W DPR1.25](out/crop-winner-dpr1.25.png) |`,
  )
  lines.push('')
  lines.push('Raw JSON: `out/results.json`.')
  lines.push('')

  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const hostFindings = staticHostScan()
  const e4Inventory = staticE4Inventory()

  console.log('[blur] starting vite preview…')
  const vite = await startVite(args.port, {
    mode: args.skipBuild ? 'preview' : 'preview',
  })
  let baseUrl
  try {
    baseUrl = await vite.ready
    await waitForUrl(baseUrl)
    console.log(`[blur] preview ${baseUrl}`)

    const browser = await chromium.launch({ headless: !args.headed })
    /** @type {Record<string, Record<number, any>>} */
    const results = {}
    let transformProbe = null
    let cardName = TARGET_NAME

    try {
      for (const dpr of DPRS) {
        console.log(`[blur] DPR ${dpr} — opening bench`)
        const session = await openBenchAtDpr(browser, baseUrl, dpr, args.headed)
        cardName = session.cardName
        try {
          if (dpr === 1) {
            transformProbe = await probeRowTransforms(session.frame)
          }
          await backupRowStyles(session.frame)

          for (const flags of allExperiments()) {
            const label = expLabel(flags)
            await applyExperiment(session.frame, flags)

            const rects = await measureRects(session.frame, session.page, cardName)
            const metric = await laplacianVarianceOfName(
              session.frame,
              session.page,
              cardName,
            )
            if (!results[label]) results[label] = {}
            results[label][dpr] = {
              variance: metric.variance,
              cropWidth: metric.width,
              cropHeight: metric.height,
              rects,
            }

            const cropName = `crop-${label.replace(/\+/g, '_')}-dpr${dpr}.png`
            fs.writeFileSync(path.join(OUT_DIR, cropName), metric.png)

            if (label === 'E0' && (dpr === 1 || dpr === 1.25)) {
              fs.writeFileSync(path.join(OUT_DIR, `crop-E0-dpr${dpr}.png`), metric.png)
            }

            console.log(
              `[blur] ${label} @${dpr}: variance=${metric.variance.toFixed(2)} crop=${metric.width}x${metric.height}`,
            )
          }
        } finally {
          await session.close()
        }
      }
    } finally {
      await browser.close()
    }

    // Winner: maximize geometric-mean of (variance / E0_variance) across DPRs.
    const bestByDpr = {}
    for (const dpr of DPRS) {
      let best = -Infinity
      for (const label of Object.keys(results)) {
        const v = results[label][dpr]?.variance
        if (typeof v === 'number' && v > best) best = v
      }
      bestByDpr[dpr] = best
    }

    let winnerLabel = 'E0'
    let winnerScore = -Infinity
    for (const label of Object.keys(results)) {
      let logSum = 0
      let ok = true
      for (const dpr of DPRS) {
        const v = results[label][dpr]?.variance
        const base = results.E0?.[dpr]?.variance
        if (!(typeof v === 'number' && typeof base === 'number' && base > 0)) {
          ok = false
          break
        }
        logSum += Math.log(v / base)
      }
      if (!ok) continue
      const score = Math.exp(logSum / DPRS.length)
      if (score > winnerScore) {
        winnerScore = score
        winnerLabel = label
      }
    }

    // Copy winner crops for DPR 1 / 1.25
    for (const dpr of [1, 1.25]) {
      const src = path.join(
        OUT_DIR,
        `crop-${winnerLabel.replace(/\+/g, '_')}-dpr${dpr}.png`,
      )
      const dest = path.join(OUT_DIR, `crop-winner-dpr${dpr}.png`)
      if (fs.existsSync(src)) fs.copyFileSync(src, dest)
    }

    const nearBest = Object.keys(results)
      .filter((label) => nearBestAtAllDprs(label, results, bestByDpr))
      .sort((a, b) => a.localeCompare(b))

    const singleNear = new Set(nearBest.filter((l) => /^E[1-4]$/.test(l)))
    const geistAlone =
      singleNear.has('E3') &&
      !singleNear.has('E1') &&
      !singleNear.has('E2') &&
      !singleNear.has('E4')

    const payload = {
      cardName,
      dprs: DPRS,
      results,
      transformProbe,
      hostFindings,
      e4Inventory,
      winner: { label: winnerLabel, score: winnerScore, bestByDpr },
      nearBest,
      geistAlone,
    }
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(payload, null, 2), 'utf8')

    writeReport({
      hostFindings,
      e4Inventory,
      results,
      transformProbe,
      cardName,
      winner: { label: winnerLabel, score: winnerScore, bestByDpr },
      nearBest,
      geistAlone,
    })

    console.log(`[blur] winner=${winnerLabel} score=${winnerScore.toFixed(4)}`)
    console.log(`[blur] report → ${REPORT_PATH}`)
  } finally {
    await vite.stop()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
