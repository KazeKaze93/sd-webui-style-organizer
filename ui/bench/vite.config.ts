/**
 * Bench-only Vite config: same app as ui/vite.config.ts, plus /bench/host.html.
 * Production `vite build` (root config) is unchanged — bench stays out of dist.
 * Bench build/preview writes to `.preview-dist` so gate runs do not clobber `ui/dist`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Connect, Plugin } from 'vite'
import { defineConfig, mergeConfig } from 'vite'
import rootConfig from '../vite.config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOST_HTML = fs.readFileSync(path.join(__dirname, 'host.html'), 'utf8')
const PREVIEW_OUT_DIR = path.resolve(__dirname, '.preview-dist')

function benchHostPlugin(): Plugin {
  const attach = (middlewares: Connect.Server) => {
    middlewares.use((req, res, next) => {
      const url = (req.url ?? '').split('?')[0]
      if (url !== '/bench/host.html') {
        next()
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(HOST_HTML)
    })
  }

  return {
    name: 'sg-bench-host',
    configureServer(server) {
      attach(server.middlewares)
    },
    configurePreviewServer(server) {
      attach(server.middlewares)
    },
  }
}

export default mergeConfig(
  rootConfig,
  defineConfig({
    plugins: [benchHostPlugin()],
    build: {
      outDir: PREVIEW_OUT_DIR,
      emptyOutDir: true,
    },
  }),
)
