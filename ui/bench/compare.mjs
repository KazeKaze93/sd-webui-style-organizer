/**
 * Compare baseline vs phase-a bench JSON; print table + PHASE B GATE at N=5000.
 *
 * Usage:
 *   node bench/compare.mjs
 *   node bench/compare.mjs --baseline results/baseline.json --phase results/phase-a.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = path.join(__dirname, 'results')

const GATE_N = 5000
const GATE = Object.freeze({
  initMs: 1000,
  toggleP50Ms: 100,
  searchKeyP50Ms: 100,
  scrollTbtMs: 300,
})

const METRICS = Object.freeze([
  'initMs',
  'toggleP50Ms',
  'searchKeyP50Ms',
  'scrollTbtMs',
  'longTasks',
])

function parseArgs(argv) {
  const out = {
    baseline: path.join(RESULTS_DIR, 'baseline.json'),
    phase: path.join(RESULTS_DIR, 'phase-a.json'),
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--baseline') out.baseline = path.resolve(argv[++i])
    else if (a === '--phase') out.phase = path.resolve(argv[++i])
  }
  return out
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing results file: ${filePath}`)
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function medianOf(values) {
  const sorted = [...values].filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

/** Prefer top-level medians; fall back to per-run medians. */
function metricAt(doc, n, key) {
  const block = doc?.sizes?.[String(n)]
  if (!block) return null
  if (typeof block[key] === 'number') return block[key]
  if (Array.isArray(block.runs)) {
    return medianOf(block.runs.map((r) => r[key]))
  }
  return null
}

function fmt(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : String(v)
}

function evaluateGate(doc) {
  const reasons = []
  for (const [key, limit] of Object.entries(GATE)) {
    const v = metricAt(doc, GATE_N, key)
    if (v != null && v > limit) {
      reasons.push(`${key}=${fmt(v)}>${limit}`)
    }
  }
  return {
    n: GATE_N,
    virtualization: reasons.length > 0 ? 'VIRTUALIZATION NEEDED' : 'NOT NEEDED',
    reasons,
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseline = loadJson(args.baseline)
  let phase = null
  try {
    phase = loadJson(args.phase)
  } catch {
    phase = null
  }

  const sizes = [500, 2000, 5000]
  const rows = []

  for (const n of sizes) {
    for (const key of METRICS) {
      const b = metricAt(baseline, n, key)
      const p = phase ? metricAt(phase, n, key) : null
      const delta = b != null && p != null ? p - b : null
      rows.push({ n, key, baseline: b, phase: p, delta })
    }
  }

  console.log('')
  console.log('Style Grid bench compare')
  console.log(`baseline: ${args.baseline}`)
  console.log(`phase-a:  ${phase ? args.phase : '(missing — baseline only)'}`)
  console.log('')
  console.log(
    [
      'N'.padStart(6),
      'metric'.padEnd(16),
      'baseline'.padStart(10),
      'phase-a'.padStart(10),
      'delta'.padStart(10),
    ].join('  '),
  )
  console.log('-'.repeat(60))
  for (const row of rows) {
    console.log(
      [
        String(row.n).padStart(6),
        row.key.padEnd(16),
        fmt(row.baseline).padStart(10),
        fmt(row.phase).padStart(10),
        fmt(row.delta).padStart(10),
      ].join('  '),
    )
  }

  const gateTarget = phase ?? baseline
  const gateLabel = phase ? 'phase-a' : 'baseline'
  const gate = evaluateGate(gateTarget)
  console.log('')
  console.log(`PHASE B GATE (N=${GATE_N}, ${gateLabel}): ${gate.virtualization}`)
  if (gate.reasons.length) {
    console.log(`  breaches: ${gate.reasons.join(', ')}`)
  } else {
    console.log(
      `  thresholds: initMs<=${GATE.initMs}, toggleP50Ms<=${GATE.toggleP50Ms}, ` +
        `searchKeyP50Ms<=${GATE.searchKeyP50Ms}, scrollTbtMs<=${GATE.scrollTbtMs}`,
    )
  }
  console.log('')

  if (!phase) {
    process.exitCode = 0
    return
  }
}

main()
