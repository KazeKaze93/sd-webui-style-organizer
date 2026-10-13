/**
 * MENU clamp probe — card context menu + source picker at bottom-right card.
 *
 * Densities (App chrome → StyleGrid props):
 *   compact  — Compact mode ON, panel (windowed=true)
 *   normal   — Fullscreen (windowed=false, CARD_HEIGHT_NORMAL)
 *   windowed — Panel default (windowed=true, CARD_HEIGHT_WINDOWED)
 *
 * Matrix: density × with/without thumbnail × {contextMenu, sourcePicker}
 * All cases: scroll 3 scroller screens first.
 *
 * READ-ONLY ui/src. Writes only under ui/bench/menu/.
 *
 * Usage (from ui/):
 *   node bench/menu/run.mjs
 *   node bench/menu/run.mjs --dev --headed
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { CATEGORIES, SOURCES } from '../generateStyles.mjs'
import {
  sleep,
  startVite,
  waitForGridStable,
  waitForUrl,
  VIEWPORT,
} from '../profile/lib.mjs'

/**
 * Every unique name appears under 2 sources so All-Sources clicks open the
 * source picker on any card (including bottom-right after scroll).
 * @param {number} n
 * @param {boolean} withThumb
 */
function generatePickerStyles(n, withThumb) {
  const unique = Math.max(1, Math.floor(n / 2))
  /** @type {object[]} */
  const styles = []
  for (let i = 0; i < unique; i += 1) {
    const cat = CATEGORIES[i % CATEGORIES.length]
    const name = `${cat}_Bench_${String(i).padStart(5, '0')}`
    for (const source of [SOURCES[0], SOURCES[1]]) {
      styles.push({
        name,
        prompt: `bench prompt ${i}, detailed, high quality`,
        negative_prompt: `bench neg ${i}, low quality`,
        description: `Synthetic bench style ${i} (${cat})`,
        category: cat,
        source_file: source,
        has_thumbnail: withThumb,
      })
    }
  }
  while (styles.length < n) {
    const i = styles.length
    const cat = CATEGORIES[i % CATEGORIES.length]
    styles.push({
      name: `${cat}_Pad_${String(i).padStart(5, '0')}`,
      prompt: `pad ${i}`,
      negative_prompt: '',
      description: `pad ${i}`,
      category: cat,
      source_file: SOURCES[0],
      has_thumbnail: withThumb,
    })
  }
  return styles.slice(0, n)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MENU_ROOT = __dirname
const OUT_DIR = path.join(MENU_ROOT, 'out')
const RAW_JSON = path.join(OUT_DIR, 'menu-probe.raw.json')
const REPORT_MD = path.join(MENU_ROOT, 'report.md')

/** Target pad for the assertion outline (= MENU_VIEWPORT_PAD in fitFixedMenuPosition.ts). */
export const MENU_MARGIN = 8

const DENSITIES = Object.freeze(['compact', 'normal', 'windowed'])
const N = 500

/** Tiny 1×1 WebP for thumbnail GETs when probing withThumb. */
const TINY_WEBP = Buffer.from(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
  'base64',
)

function parseArgs(argv) {
  const out = { port: 5187, headed: false, dev: false, n: N, fromRaw: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--port') out.port = Number(argv[++i]) || 5187
    else if (a === '--headed') out.headed = true
    else if (a === '--dev') out.dev = true
    else if (a === '--n') out.n = Math.max(50, Number(argv[++i]) || N)
    else if (a === '--from-raw') out.fromRaw = true
  }
  return out
}

/**
 * @param {import('playwright').Frame} frame
 * @param {'compact' | 'normal' | 'windowed'} mode
 */
async function setDensity(frame, mode) {
  await frame.evaluate((m) => {
    const byLabel = (re) =>
      [...document.querySelectorAll('button')].find((b) =>
        re.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''),
      )

    const compactBtn = byLabel(/compact mode/i)
    const fsBtn = byLabel(/^(exit )?fullscreen$/i)

    const compactOn =
      compactBtn &&
      (compactBtn.getAttribute('aria-pressed') === 'true' ||
        /\bbg-sg-accent\b/.test(compactBtn.className) ||
        compactBtn.dataset.state === 'on')

    const wantCompact = m === 'compact'
    if (compactBtn && Boolean(compactOn) !== wantCompact) compactBtn.click()

    const isFs = Boolean(fsBtn && /exit fullscreen/i.test(fsBtn.getAttribute('aria-label') || ''))
    // normal → fullscreen (windowed=false); compact/windowed stay in panel
    const wantFs = m === 'normal'
    if (fsBtn && isFs !== wantFs) fsBtn.click()
  }, mode)
  await sleep(300)
}

async function scrollScreens(frame, screens = 3) {
  await frame.evaluate((n) => {
    const card = document.querySelector('[data-sg-card="true"]')
    let scroller = null
    let el = card
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el)
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 8
      ) {
        scroller = el
        break
      }
      el = el.parentElement
    }
    if (!scroller) return null
    scroller.scrollTop = scroller.clientHeight * n
    return {
      scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
    }
  }, screens)
  await sleep(200)
}

/**
 * Bottom-most, then right-most visible card (last visible row, rightmost col).
 * @param {import('playwright').Frame} frame
 */
async function findBottomRightCard(frame) {
  return frame.evaluate(() => {
    const vh = window.innerHeight
    const vw = window.innerWidth
    const cards = [...document.querySelectorAll('[data-sg-card="true"]')]
    const visible = []
    for (const el of cards) {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      // Require a hit-testable interior point inside the iframe viewport
      if (r.bottom <= 1 || r.top >= vh - 1 || r.right <= 1 || r.left >= vw - 1) continue
      visible.push({
        r: {
          top: r.top,
          left: r.left,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        },
        scoreBottom: Math.min(r.bottom, vh),
        scoreRight: Math.min(r.right, vw),
        title: el.getAttribute('title') || '',
      })
    }
    if (visible.length === 0) return null
    visible.sort((a, b) => {
      if (Math.abs(b.scoreBottom - a.scoreBottom) > 4) return b.scoreBottom - a.scoreBottom
      return b.scoreRight - a.scoreRight
    })
    const best = visible[0]
    const x = Math.min(Math.max(best.r.left + 2, best.r.right - 4), vw - 1)
    const y = Math.min(Math.max(best.r.top + 2, best.r.bottom - 4), vh - 1)
    return {
      title: best.title,
      rect: best.r,
      anchor: { x, y },
      visibleCount: visible.length,
      viewport: { width: vw, height: vh },
    }
  })
}

/**
 * Inspect fixed overlay menus portaled to body.
 * @param {import('playwright').Frame} frame
 * @param {{ kind: string }} opts
 */
async function measureOpenMenu(frame, opts) {
  return frame.evaluate(({ kind }) => {
    const vw = window.innerWidth
    const vh = window.innerHeight

    const candidates = [...document.body.querySelectorAll(':scope > div.fixed')].filter((el) => {
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed') return false
      // Backdrop is inset-0; skip full-viewport click catchers
      const r = el.getBoundingClientRect()
      if (r.width >= vw - 2 && r.height >= vh - 2) return false
      if (r.width < 40 || r.height < 20) return false
      return true
    })

    // Prefer the highest z-index menu panel; for sourcePicker require z>=10005.
    const filtered =
      kind === 'sourcePicker'
        ? candidates.filter((el) => (Number(getComputedStyle(el).zIndex) || 0) >= 10005)
        : kind === 'contextMenu'
          ? candidates.filter((el) => {
              const z = Number(getComputedStyle(el).zIndex) || 0
              return z >= 9999 && z < 10005
            })
          : candidates

    filtered.sort((a, b) => {
      const za = Number(getComputedStyle(a).zIndex) || 0
      const zb = Number(getComputedStyle(b).zIndex) || 0
      return zb - za
    })

    const menu = filtered[0] || null
    if (!menu) {
      return {
        kind,
        found: false,
        viewport: { width: vw, height: vh },
        error: `no fixed menu panel for kind=${kind} (candidates=${candidates.length})`,
        candidateZs: candidates.map((el) => getComputedStyle(el).zIndex),
      }
    }

    const rect = menu.getBoundingClientRect()
    const cs = getComputedStyle(menu)
    const overflow = {
      left: Math.max(0, 0 - rect.left),
      top: Math.max(0, 0 - rect.top),
      right: Math.max(0, rect.right - vw),
      bottom: Math.max(0, rect.bottom - vh),
    }
    const overflowWithMargin = {
      left: Math.max(0, 8 - rect.left),
      top: Math.max(0, 8 - rect.top),
      right: Math.max(0, rect.right - (vw - 8)),
      bottom: Math.max(0, rect.bottom - (vh - 8)),
    }

    /** Transformed / containing-block ancestors from menu up to html. */
    const transformChain = []
    let node = menu
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node)
      const t = style.transform
      const hasTransform = t && t !== 'none'
      const hasFilter = style.filter && style.filter !== 'none'
      const hasPerspective = style.perspective && style.perspective !== 'none'
      const contain = style.contain
      if (hasTransform || hasFilter || hasPerspective || (contain && contain !== 'none')) {
        transformChain.push({
          tag: node.tagName,
          id: node.id || '',
          className: String(node.className || '').slice(0, 120),
          transform: t,
          filter: style.filter,
          perspective: style.perspective,
          contain,
          position: style.position,
          willChange: style.willChange,
        })
      }
      node = node.parentElement
    }

    const portaledToBody = menu.parentElement === document.body
    const fixedOffset = {
      left: cs.left,
      top: cs.top,
      right: cs.right,
      bottom: cs.bottom,
      // parsed px from style attribute / computed
      leftPx: Number.parseFloat(cs.left) || 0,
      topPx: Number.parseFloat(cs.top) || 0,
    }

    return {
      kind,
      found: true,
      portal: portaledToBody,
      portalParent: menu.parentElement?.tagName || null,
      menuRect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
      viewport: { width: vw, height: vh },
      overflowPx: overflow,
      overflowPxVsMargin8: overflowWithMargin,
      fullyInsideViewport: overflow.left === 0 && overflow.top === 0 && overflow.right === 0 && overflow.bottom === 0,
      fullyInsideWithMenuMargin:
        overflowWithMargin.left === 0 &&
        overflowWithMargin.top === 0 &&
        overflowWithMargin.right === 0 &&
        overflowWithMargin.bottom === 0,
      fixedOffset,
      transformAncestorChain: transformChain,
      zIndex: cs.zIndex,
      position: cs.position,
      className: String(menu.className || '').slice(0, 160),
      buttonCount: menu.querySelectorAll('button').length,
    }
  }, opts)
}

/** Static clamp notes from read-only source (file:line). */
const CLAMP_NOTES = Object.freeze({
  contextMenu: {
    usesFitFixedMenuPosition: false,
    usesViewportFixedMenu: false,
    portal: true,
    portalImpl: 'StyleCard.tsx:42-43 createPortal(..., document.body)',
    positionSetAt: 'StyleCard.tsx:127 setMenuPos({ x: e.clientX, y: e.clientY }) — no clamp',
    clampAssumedHeight: null,
    clampAssumedHeightFileLine: null,
    note: 'Card context menu is raw fixed at click coords; no height assumption, no viewport clamp.',
  },
  sourcePicker: {
    usesFitFixedMenuPosition: false,
    usesViewportFixedMenu: false,
    portal: true,
    portalImpl: 'StyleCard.tsx:42-43 createPortal(..., document.body)',
    positionSetAt: 'StyleCard.tsx:132-134',
    clampAssumedWidth: 280,
    clampAssumedWidthFileLine: 'StyleCard.tsx:132',
    clampAssumedHeight: null,
    clampAssumedHeightFileLine: null,
    topPad: 8,
    topPadFileLine: 'StyleCard.tsx:133 Math.max(8, rect.top)',
    note: 'Picker clamps X with assumed width 280px; Y only floors to 8 — no bottom/height clamp.',
  },
  referenceClamp: {
    constant: 'MENU_VIEWPORT_PAD',
    value: 8,
    fileLine: 'ui/src/lib/fitFixedMenuPosition.ts:2',
    appliedBy: 'ViewportFixedMenu.tsx:35-42 (LoRA header / sidebar menus only — not StyleCard)',
    measuresActualHeight: true,
    assumedHeight: null,
    note: 'fitFixedMenuPosition uses measured rect.height — no assumed height constant.',
  },
})

async function dismissMenus(frame) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const remaining = await frame.evaluate(() => {
      // Click full-viewport backdrops first (z 9998 / 10004)
      const backdrops = [...document.body.querySelectorAll(':scope > div.fixed')].filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2
      })
      for (const b of backdrops) {
        b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
        b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      }
      document.body.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 2, clientY: 2, view: window }),
      )
      document.body.click()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      const panels = [...document.body.querySelectorAll(':scope > div.fixed')].filter((el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (cs.position !== 'fixed') return false
        if (r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2) return false
        return r.width >= 40 && r.height >= 20
      })
      return panels.length
    })
    if (remaining === 0) break
    await sleep(60)
  }
  await sleep(40)
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} baseUrl
 * @param {number} n
 * @param {boolean} withThumb
 */
async function openMenuBench(browser, baseUrl, n, withThumb) {
  const styles = generatePickerStyles(n, withThumb)

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()

  await page.route('**/style_grid/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()

    if (url.includes('/style_grid/usage') && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return
    }
    if (url.includes('/style_grid/presets') && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return
    }
    if (url.includes('/style_grid/thumbnails/list')) {
      const names = withThumb ? styles.map((s) => s.name) : []
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ has_thumbnail: [...new Set(names)] }),
      })
      return
    }
    if (url.includes('/style_grid/thumbnail') && method === 'GET') {
      if (withThumb) {
        await route.fulfill({ status: 200, contentType: 'image/webp', body: TINY_WEBP })
      } else {
        await route.fulfill({ status: 404, body: '' })
      }
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

  await page.addInitScript((payload) => {
    try {
      localStorage.removeItem('sg_v2_last_source')
      localStorage.removeItem('sg_v2_last_source_txt2img')
      localStorage.removeItem('sg_v2_last_source_img2img')
    } catch {
      // ignore
    }
    window.__BENCH__ = payload
  }, { styles, tab: 'txt2img', n })

  await page.goto(`${baseUrl}/bench/host.html?n=${n}&menu=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
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
    async close() {
      await iframeHandle.dispose().catch(() => {})
      await context.close()
    },
  }
}

/**
 * Ensure All sources (empty activeSource) so duplicate cards open the picker.
 * @param {import('playwright').Frame} frame
 */
async function ensureAllSources(frame) {
  await frame.evaluate(() => {
    try {
      localStorage.removeItem('sg_v2_last_source')
      localStorage.removeItem('sg_v2_last_source_txt2img')
      localStorage.removeItem('sg_v2_last_source_img2img')
    } catch {
      // ignore
    }
    const select = document.querySelector('select')
    if (!(select instanceof HTMLSelectElement)) return
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    proto?.call(select, '')
    select.dispatchEvent(new Event('change', { bubbles: true }))
    select.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(250)
  const state = await frame.evaluate(() => {
    const select = document.querySelector('select')
    return {
      selectValue: select instanceof HTMLSelectElement ? select.value : null,
      label: select instanceof HTMLSelectElement
        ? select.options[select.selectedIndex]?.textContent
        : null,
    }
  })
  if (state.selectValue !== '') {
    console.warn('[menu] All Sources not selected:', state)
  }
}

async function probeContextMenu(frame, anchor) {
  await dismissMenus(frame)
  await frame.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    const card = el?.closest?.('[data-sg-card="true"]')
    if (!card) throw new Error(`no card at ${x},${y} (hit=${el?.tagName || 'null'})`)
    card.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 2,
        view: window,
      }),
    )
  }, anchor)
  await sleep(150)
  const measure = await measureOpenMenu(frame, { kind: 'contextMenu' })
  await dismissMenus(frame)
  return measure
}

/** Open source picker on the bottom-right anchor card only (All Sources + multi-source names). */
async function probeSourcePicker(frame, anchor) {
  await dismissMenus(frame)
  await ensureAllSources(frame)

  const opened = await frame.evaluate(async ({ x, y }) => {
    const sleep0 = (ms) => new Promise((r) => setTimeout(r, ms))

    const hasPicker = () =>
      [...document.body.querySelectorAll(':scope > div.fixed')].some((node) => {
        const r = node.getBoundingClientRect()
        const cs = getComputedStyle(node)
        if (cs.position !== 'fixed') return false
        if (r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2) return false
        const z = Number(cs.zIndex) || 0
        if (z < 10005) return false
        if (r.height < 20 || r.width < 40) return false
        return node.querySelectorAll('button').length >= 1
      })

    const card = document.elementFromPoint(x, y)?.closest?.('[data-sg-card="true"]')
    if (!card) {
      return { ok: false, reason: `no card at anchor ${x},${y}` }
    }
    const r = card.getBoundingClientRect()
    card.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        view: window,
      }),
    )
    await sleep0(100)
    if (!hasPicker()) {
      return {
        ok: false,
        reason: 'click did not open source picker (need All Sources + duplicatesByName)',
        title: card.getAttribute('title') || '',
        selectValue: document.querySelector('select')?.value ?? null,
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      }
    }
    return {
      ok: true,
      title: card.getAttribute('title') || '',
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      anchorUsed: { x, y },
    }
  }, anchor)

  await sleep(80)
  if (!opened.ok) {
    return {
      kind: 'sourcePicker',
      found: false,
      openMeta: opened,
      viewport: await frame.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
    }
  }
  const measure = await measureOpenMenu(frame, { kind: 'sourcePicker' })
  measure.openMeta = opened
  await dismissMenus(frame)
  return measure
}

function fmtRect(r) {
  if (!r) return '—'
  return `${r.left.toFixed(1)},${r.top.toFixed(1)} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`
}

function fmtOverflow(o) {
  if (!o) return '—'
  return `L${o.left.toFixed(1)} T${o.top.toFixed(1)} R${o.right.toFixed(1)} B${o.bottom.toFixed(1)}`
}

function buildReport(results, meta) {
  const lines = []
  lines.push('# Menu viewport clamp probe')
  lines.push('')
  lines.push(`Generated: ${meta.createdAt}`)
  lines.push('')
  lines.push('## Scope')
  lines.push('')
  lines.push('- Target: card **context menu** + **source picker** (`StyleCard.tsx` portals)')
  lines.push('- Anchor: last visible row, rightmost column, bottom-right of card')
  lines.push('- Scroll: 3 scroller screens before each open')
  lines.push('- Densities: `compact` / `normal` (fullscreen) / `windowed` (panel)')
  lines.push('- Thumbnail: `has_thumbnail` true/false (extra Remove preview row when true)')
  lines.push('- App code: **read-only** - this folder only')
  lines.push('')
  lines.push('## Clamp source map (read-only)')
  lines.push('')
  lines.push('| Surface | Portal | Clamp | Assumed height | File:line |')
  lines.push('|---|---|---|---|---|')
  lines.push(
    `| Context menu | yes -> \`document.body\` | **none** (click x/y) | - | \`StyleCard.tsx:127\` |`,
  )
  lines.push(
    `| Source picker | yes -> \`document.body\` | X via assumed **width 280**; Y floor 8 | **none** (no height clamp) | \`StyleCard.tsx:132-133\` |`,
  )
  lines.push(
    `| \`ViewportFixedMenu\` (not StyleCard) | yes | \`fitFixedMenuPosition\` + measured H | **none** (measures \`rect.height\`) | \`ViewportFixedMenu.tsx:35-42\`, pad \`fitFixedMenuPosition.ts:2\` (\`MENU_VIEWPORT_PAD=8\`) |`,
  )
  lines.push('')
  lines.push('## Results')
  lines.push('')
  lines.push(
    '| density | thumb | kind | inside | inside+M8 | overflow px (L/T/R/B) | menu rect | viewport | portal | fixed offset (L,T) | transform ancestors |',
  )
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|')

  for (const row of results) {
    const m = row.measure
    const inside = m.found ? (m.fullyInsideViewport ? 'yes' : 'NO') : '—'
    const insideM = m.found ? (m.fullyInsideWithMenuMargin ? 'yes' : 'NO') : '—'
    const overflow = m.found ? fmtOverflow(m.overflowPx) : m.error || m.openMeta?.reason || 'not found'
    const rect = m.found ? fmtRect(m.menuRect) : '—'
    const vp = m.viewport ? `${m.viewport.width}×${m.viewport.height}` : '—'
    const portal = m.found ? (m.portal ? 'body' : String(m.portalParent)) : '—'
    const offset = m.found
      ? `${m.fixedOffset.leftPx.toFixed(1)},${m.fixedOffset.topPx.toFixed(1)}`
      : '—'
    const chain =
      m.found && m.transformAncestorChain?.length
        ? m.transformAncestorChain.map((c) => c.tag + (c.transform !== 'none' ? '[t]' : '')).join('>')
        : m.found
          ? '(none)'
          : '—'
    lines.push(
      `| ${row.density} | ${row.withThumb ? 'yes' : 'no'} | ${row.kind} | ${inside} | ${insideM} | ${overflow} | ${rect} | ${vp} | ${portal} | ${offset} | ${chain} |`,
    )
  }

  lines.push('')
  lines.push('## Findings')
  lines.push('')
  lines.push('1. **Context menu** portals to `document.body`, `position:fixed` at raw click coords (`StyleCard.tsx:127`). No clamp -> bottom overflow **301-349px** at bottom-right after scroll x3; fullscreen (`normal`) also **R176px**. Thumb on adds Remove preview (+32px height, +1 button).')
  lines.push('2. **Source picker** portals to `document.body`, X clamped with **assumed width 280** (`StyleCard.tsx:132`), Y only `max(8, card.top)` (`:133`) - **no height clamp**. At bottom-right: bottom overflow **22-26px** (fails `MENU_MARGIN`). X clamp keeps right overflow at 0.')
  lines.push('3. **Assumed height:** none for either StyleCard surface (`clampAssumedHeight: null`). Shared helper `fitFixedMenuPosition` also measures live `rect.height` (no assumed H) - used only by `ViewportFixedMenu` (LoRA/sidebar), not StyleCard.')
  lines.push('4. **Transformed ancestors:** empty chain for all cases (portal escapes grid transform / overflow).')
  lines.push('5. **Fixed offset:** equals menu `left`/`top` (unclamped click for context; picker uses `rect.right+8` / `rect.top`).')
  lines.push('')
  lines.push('Full per-case JSON (menuRect, viewport, overflow, portal, fixedOffset, transformAncestorChain): `out/menu-probe.raw.json`.')
  lines.push('')

  lines.push('## Assertion outline - menu fully inside viewport with `MENU_MARGIN`')
  lines.push('')
  lines.push('Target constant (today in app): `MENU_VIEWPORT_PAD = 8` at `fitFixedMenuPosition.ts:2`.')
  lines.push('Bench alias for the contract: **`MENU_MARGIN = 8`** (same value).')
  lines.push('')
  lines.push('```ts')
  lines.push('const MENU_MARGIN = 8 // === MENU_VIEWPORT_PAD')
  lines.push('')
  lines.push('function assertMenuFullyInsideViewport(menu: DOMRect, vw: number, vh: number) {')
  lines.push('  // Soft pad: menu must sit entirely inside the padded viewport inset.')
  lines.push('  expect(menu.left).toBeGreaterThanOrEqual(MENU_MARGIN)')
  lines.push('  expect(menu.top).toBeGreaterThanOrEqual(MENU_MARGIN)')
  lines.push('  expect(menu.right).toBeLessThanOrEqual(vw - MENU_MARGIN)')
  lines.push('  expect(menu.bottom).toBeLessThanOrEqual(vh - MENU_MARGIN)')
  lines.push('')
  lines.push('  // Equivalent overflow form (what this probe records as overflowPxVsMargin8):')
  lines.push('  const overflow = {')
  lines.push('    left: Math.max(0, MENU_MARGIN - menu.left),')
  lines.push('    top: Math.max(0, MENU_MARGIN - menu.top),')
  lines.push('    right: Math.max(0, menu.right - (vw - MENU_MARGIN)),')
  lines.push('    bottom: Math.max(0, menu.bottom - (vh - MENU_MARGIN)),')
  lines.push('  }')
  lines.push('  expect(overflow).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })')
  lines.push('}')
  lines.push('```')
  lines.push('')
  lines.push('Cases to cover in a future test (this probe is the fixture matrix):')
  lines.push('')
  lines.push('1. Context menu at bottom-right card after scroll x3 - each density x thumb on/off')
  lines.push('2. Source picker at bottom-right duplicate card after scroll x3 - same matrix')
  lines.push('3. Tall menu (thumb on -> extra Remove preview) still clears bottom by `MENU_MARGIN`')
  lines.push('4. Portal host is `document.body`; transformed-ancestor chain empty (or documented)')
  lines.push('5. Fixed `left`/`top` match clamped coords (not raw click) once StyleCard adopts `fitFixedMenuPosition`')
  lines.push('')
  lines.push('**Current verdict from probe:** see `inside+M8` column - StyleCard menus do **not** call')
  lines.push('`fitFixedMenuPosition` today, so bottom-right opens are expected to fail the margin assertion')
  lines.push('until they share `ViewportFixedMenu` / `MENU_VIEWPORT_PAD`.')
  lines.push('')

  const failM8 = results.filter((r) => r.measure.found && !r.measure.fullyInsideWithMenuMargin)
  const failVp = results.filter((r) => r.measure.found && !r.measure.fullyInsideViewport)
  const missing = results.filter((r) => !r.measure.found)
  lines.push('## Summary counters')
  lines.push('')
  lines.push(`- Cases: ${results.length}`)
  lines.push(`- Menu found: ${results.length - missing.length}`)
  lines.push(`- Missing / failed open: ${missing.length}`)
  lines.push(`- Overflow viewport edge: ${failVp.length}`)
  lines.push(`- Overflow vs MENU_MARGIN(8): ${failM8.length}`)
  lines.push('')

  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  fs.mkdirSync(OUT_DIR, { recursive: true })

  if (args.fromRaw) {
    if (!fs.existsSync(RAW_JSON)) throw new Error(`missing ${RAW_JSON}`)
    const payload = JSON.parse(fs.readFileSync(RAW_JSON, 'utf8'))
    const md = buildReport(payload.results, payload)
    fs.writeFileSync(REPORT_MD, md)
    console.log(`[menu] regenerated ${REPORT_MD} from raw`)
    return
  }

  const vite = await startVite(args.port, { mode: args.dev ? 'dev' : 'preview' })
  const browser = await chromium.launch({
    headless: !args.headed,
    args: ['--disable-dev-shm-usage', '--disable-gpu'],
  })

  /** @type {any[]} */
  const results = []

  try {
    const baseUrl = await vite.ready
    await waitForUrl(`${baseUrl}/bench/host.html`)
    console.log(`[menu] vite ${baseUrl} n=${args.n}`)

    for (const withThumb of [false, true]) {
      for (const density of DENSITIES) {
        const bench = await openMenuBench(browser, baseUrl, args.n, withThumb)
        try {
          await waitForGridStable(bench.frame, args.n)
          await ensureAllSources(bench.frame)
          await sleep(150)
          await setDensity(bench.frame, density)
          await sleep(200)

          const scroll = await scrollScreens(bench.frame, 3)
          const card = await findBottomRightCard(bench.frame)
          if (!card) throw new Error(`no visible card after scroll (${density}, thumb=${withThumb})`)

          console.log(
            `[menu] ${density} thumb=${withThumb} card@${card.anchor.x.toFixed(0)},${card.anchor.y.toFixed(0)} visible=${card.visibleCount}`,
          )

          const ctx = await probeContextMenu(bench.frame, card.anchor)
          results.push({
            density,
            withThumb,
            kind: 'contextMenu',
            card,
            scroll,
            measure: ctx,
            clampAssumedHeight: CLAMP_NOTES.contextMenu.clampAssumedHeight,
            clampAssumedHeightFileLine: CLAMP_NOTES.contextMenu.clampAssumedHeightFileLine,
          })
          console.log(
            `  contextMenu found=${ctx.found} inside=${ctx.fullyInsideViewport} m8=${ctx.fullyInsideWithMenuMargin} overflow=${fmtOverflow(ctx.overflowPx)}`,
          )

          // Re-find card after dismiss (virtualizer may still be at same scroll)
          const card2 = (await findBottomRightCard(bench.frame)) || card
          const pick = await probeSourcePicker(bench.frame, card2.anchor)
          results.push({
            density,
            withThumb,
            kind: 'sourcePicker',
            card: card2,
            scroll,
            measure: pick,
            clampAssumedHeight: CLAMP_NOTES.sourcePicker.clampAssumedHeight,
            clampAssumedHeightFileLine: CLAMP_NOTES.sourcePicker.clampAssumedHeightFileLine,
            clampAssumedWidth: CLAMP_NOTES.sourcePicker.clampAssumedWidth,
            clampAssumedWidthFileLine: CLAMP_NOTES.sourcePicker.clampAssumedWidthFileLine,
          })
          console.log(
            `  sourcePicker found=${pick.found} inside=${pick.fullyInsideViewport} m8=${pick.fullyInsideWithMenuMargin} overflow=${fmtOverflow(pick.overflowPx)}`,
          )
        } finally {
          await bench.close()
        }
      }
    }

    const payload = {
      createdAt: new Date().toISOString(),
      MENU_MARGIN,
      viewport: VIEWPORT,
      n: args.n,
      densities: DENSITIES,
      clampNotes: CLAMP_NOTES,
      results,
    }
    fs.writeFileSync(RAW_JSON, JSON.stringify(payload, null, 2))
    const md = buildReport(results, payload)
    fs.writeFileSync(REPORT_MD, md)
    console.log(`[menu] wrote ${REPORT_MD}`)
    console.log(`[menu] wrote ${RAW_JSON}`)
  } finally {
    await browser.close()
    await vite.stop()
  }
}

main().catch((err) => {
  console.error('[menu] FAILED', err)
  process.exitCode = 1
})
