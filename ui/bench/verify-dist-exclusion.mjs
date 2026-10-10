/**
 * Self-check: production vite build inputs must not pull in ui/bench.
 * Compares current dist file list to the known shipped set (no rebuild).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UI_ROOT = path.resolve(__dirname, '..')
const DIST = path.join(UI_ROOT, 'dist')

const EXPECTED = [
  'assets/geist-cyrillic-wght-normal.woff2',
  'assets/geist-latin-ext-wght-normal.woff2',
  'assets/geist-latin-wght-normal.woff2',
  'assets/index.css',
  'assets/index.js',
  'favicon.svg',
  'icons.svg',
  'index.html',
]

function listFiles(dir, prefix = '') {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (fs.statSync(full).isDirectory()) out.push(...listFiles(full, rel))
    else out.push(rel.replace(/\\/g, '/'))
  }
  return out.sort()
}

const actual = listFiles(DIST)
const expectedSorted = [...EXPECTED].sort()
const same =
  actual.length === expectedSorted.length &&
  actual.every((f, i) => f === expectedSorted[i])

console.log('[bench] dist files:', actual.join(', ') || '(missing)')
console.log('[bench] bench path outside src/public:', path.relative(UI_ROOT, __dirname))
console.log('[bench] dist unchanged vs shipped set:', same ? 'YES' : 'NO')

if (!same) {
  console.error('[bench] expected:', expectedSorted.join(', '))
  process.exitCode = 1
}
