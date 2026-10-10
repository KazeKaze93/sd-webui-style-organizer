/**
 * Permanent gate: host entry `javascript/style_grid.mjs` must link
 * (full import graph including theme.js exports). Uses a native Node
 * subprocess — Vite SSR soft-binds missing named exports to undefined,
 * which would hide real link breaks. ReferenceError for document/window
 * is tolerated (no Gradio host); SyntaxError / missing-export = fail.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const HOST_ENTRY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../javascript/style_grid.mjs',
)

const LINK_OK = 0
const LINK_FAIL = 2

describe('host module graph', () => {
  it('links javascript/style_grid.mjs (export graph resolves)', () => {
    const href = pathToFileURL(HOST_ENTRY).href
    const script = `
import(${JSON.stringify(href)}).then(function () {
  process.exit(${LINK_OK});
}).catch(function (err) {
  var name = err && err.constructor ? err.constructor.name : typeof err;
  var msg = err && err.message ? err.message : String(err);
  if (name === "SyntaxError" || /does not provide an export named/i.test(msg)) {
    console.error("LINK_FAIL", name, msg);
    process.exit(${LINK_FAIL});
  }
  if (name === "ReferenceError" && (/\\bdocument\\b/.test(msg) || /\\bwindow\\b/.test(msg))) {
    process.exit(${LINK_OK});
  }
  console.error("LINK_OTHER", name, msg);
  process.exit(${LINK_FAIL});
});
`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: process.env,
    })
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`
    if (result.status !== LINK_OK) {
      expect.fail(
        `host module graph link failed (exit ${result.status}):\n${out || '(no output)'}`,
      )
    }
    expect(result.status).toBe(LINK_OK)
  })
})
