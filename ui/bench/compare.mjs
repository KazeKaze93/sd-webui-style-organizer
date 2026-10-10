/**
 * Compare baseline / phase-a / phase-b bench JSON; print table + PERFORMANCE GATE at N=5000.
 *
 * Usage:
 *   node bench/compare.mjs
 *   node bench/compare.mjs --baseline results/baseline.json --phase-a results/phase-a.json --phase-b results/phase-b.json
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
    phaseA: path.join(RESULTS_DIR, 'phase-a.json'),
    phaseB: path.join(RESULTS_DIR, 'phase-b.json'),
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--baseline') out.baseline = path.resolve(argv[++i])
    else if (a === '--phase-a' || a === '--phase') out.phaseA = path.resolve(argv[++i])
    else if (a === '--phase-b') out.phaseB = path.resolve(argv[++i])
  }
  return out
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing results file: ${filePath}`)
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function tryLoadJson(filePath) {
  try {
    return loadJson(filePath)
  } catch {
    return null
  }
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
  const results = []
  for (const [key, limit] of Object.entries(GATE)) {
    const v = metricAt(doc, GATE_N, key)
    const pass = v != null && v <= limit
    results.push({
      key,
      value: v,
      limit,
      pass: v == null ? null : pass,
    })
  }
  const known = results.filter((r) => r.pass != null)
  const allPass = known.length > 0 && known.every((r) => r.pass)
  return { n: GATE_N, results, allPass }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseline = loadJson(args.baseline)
  const phaseA = tryLoadJson(args.phaseA)
  const phaseB = tryLoadJson(args.phaseB)

  const sizes = [500, 2000, 5000]
  const rows = []

  for (const n of sizes) {
    for (const key of METRICS) {
      const b = metricAt(baseline, n, key)
      const a = phaseA ? metricAt(phaseA, n, key) : null
      const p = phaseB ? metricAt(phaseB, n, key) : null
      rows.push({ n, key, baseline: b, phaseA: a, phaseB: p })
    }
  }

  console.log('')
  console.log('Style Grid bench compare (3-way)')
  console.log(`baseline: ${args.baseline}`)
  console.log(`phase-a:  ${phaseA ? args.phaseA : '(missing)'}`)
  console.log(`phase-b:  ${phaseB ? args.phaseB : '(missing)'}`)
  console.log('')
  console.log(
    [
      'N'.padStart(6),
      'metric'.padEnd(16),
      'baseline'.padStart(10),
      'phase-a'.padStart(10),
      'phase-b'.padStart(10),
      'Δa-base'.padStart(10),
      'Δb-a'.padStart(10),
    ].join('  '),
  )
  console.log('-'.repeat(88))
  for (const row of rows) {
    const dAB = row.baseline != null && row.phaseA != null ? row.phaseA - row.baseline : null
    const dBA = row.phaseA != null && row.phaseB != null ? row.phaseB - row.phaseA : null
    console.log(
      [
        String(row.n).padStart(6),
        row.key.padEnd(16),
        fmt(row.baseline).padStart(10),
        fmt(row.phaseA).padStart(10),
        fmt(row.phaseB).padStart(10),
        fmt(dAB).padStart(10),
        fmt(dBA).padStart(10),
      ].join('  '),
    )
  }

  const gateTarget = phaseB ?? phaseA ?? baseline
  const gateLabel = phaseB ? 'phase-b' : phaseA ? 'phase-a' : 'baseline'
  const gate = evaluateGate(gateTarget)
  console.log('')
  console.log(`PERFORMANCE GATE (N=${GATE_N}, 4x CPU, ${gateLabel}): ${gate.allPass ? 'PASS' : 'FAIL'}`)
  for (const r of gate.results) {
    const status = r.pass == null ? 'MISSING' : r.pass ? 'PASS' : 'FAIL'
    console.log(`  ${r.key}: ${fmt(r.value)} (limit <=${r.limit}) → ${status}`)
  }
  console.log('')

  if (!gate.allPass) {
    process.exitCode = 1
  }
}

main()
