/**
 * CPU profile analysis: top-N by self time, sourcemap resolve, render/filter buckets.
 * Bench-only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { SourceMapConsumer } from 'source-map-js'
import { UI_ROOT } from './lib.mjs'

/** App / React component names we care about for re-render attribution. */
const KNOWN_COMPONENTS = Object.freeze([
  'StyleCard',
  'StyleGrid',
  'VirtualStyleGrid',
  'CardsRow',
  'CategoryHeaderRow',
  'CategoryHeader',
  'ThumbnailPreview',
  'SearchBar',
  'PresetList',
  'PresetRow',
  'BottomPanel',
  'StyleInfoPanel',
  'SourceFilter',
  'Sidebar',
  'SelectedBar',
  'ComboChips',
  'App',
  'Toast',
  'ThumbProgressModal',
  'SaveSetDialog',
])

const FILTER_HINTS = Object.freeze([
  'matchesSearch',
  'setSearch',
  'filter',
  'filtered',
  'searchStyles',
  'getSuggestions',
  'includes',
  'toLowerCase',
  'split',
  'trim',
])

const RENDER_HINTS = Object.freeze([
  'renderWithHooks',
  'updateFunctionComponent',
  'beginWork',
  'completeWork',
  'commitMutationEffects',
  'commitLayoutEffects',
  'commitRoot',
  'performUnitOfWork',
  'workLoopSync',
  'workLoopConcurrent',
  'flushSyncWork',
  'recursivelyTraverse',
  'reconcileChildren',
  'updateChild',
  'createInstance',
  'setValueForStyles',
  'setProp',
  'diffProperties',
  'StyleCard',
  'StyleGrid',
  'ThumbnailPreview',
  'SearchBar',
  'PresetList',
  'BottomPanel',
  'App',
  'jsx',
  'jsxs',
  'motion',
  'forwardRef',
  'Memo',
])

/**
 * @param {string} url
 */
function isAppUrl(url) {
  if (!url) return false
  if (url.includes('/src/')) return true
  if (url.includes('node_modules')) return false
  return /\/@fs\//.test(url) && url.includes('style-organizer')
}

/**
 * @param {string} url
 */
function toRelPath(url) {
  if (!url) return '(unknown)'
  try {
    const u = new URL(url)
    let p = decodeURIComponent(u.pathname)
    // strip vite query suffixes already removed by URL pathname
    if (p.startsWith('/@fs/')) {
      p = p.slice('/@fs/'.length)
      // Windows: /D:/... → D:/...
      if (/^[A-Za-z]:\//.test(p) || /^[A-Za-z]:\\/.test(p)) {
        /* keep */
      } else if (p.startsWith('/')) {
        p = p.slice(1)
      }
      const rel = path.relative(UI_ROOT, p).replace(/\\/g, '/')
      return rel.startsWith('..') ? p.replace(/\\/g, '/') : rel
    }
    if (p.startsWith('/src/') || p.startsWith('/node_modules/')) {
      return p.replace(/^\//, '')
    }
    return p.replace(/^\//, '') || url
  } catch {
    return url
  }
}

const IDLE_FNS = new Set(['(idle)', '(program)', '(garbage collector)'])

function normalizeAppFile(file) {
  if (!file) return file
  let f = file.replace(/\\/g, '/')
  // sourcemap often yields "/App.tsx" or "../src/App.tsx"
  if (f.startsWith('/src/')) return f.slice(1)
  if (f.startsWith('src/')) return f
  const base = f.replace(/^\//, '')
  if (/^(App|main)\.tsx?$/.test(base)) return `src/${base}`
  if (/^[A-Z][\w.-]+\.tsx?$/.test(base)) return `src/components/${base}`
  // Vite content sources sometimes omit directories for store modules
  if (base === 'stylesStore.ts') return 'src/store/stylesStore.ts'
  if (base === 'styleIdentity.ts') return 'src/lib/styleIdentity.ts'
  const srcIdx = f.indexOf('/src/')
  if (srcIdx >= 0) return f.slice(srcIdx + 1)
  if (f.startsWith('../src/')) return f.replace(/^\.\.\//, '')
  return f
}

/**
 * @param {string} baseUrl Vite origin e.g. http://127.0.0.1:5173
 * @param {Map<string, { url: string, sourceMapURL?: string, scriptId: string }>} scripts
 */
export function createSourceMapper(baseUrl, scripts) {
  /** @type {Map<string, SourceMapConsumer | null>} */
  const consumersByUrl = new Map()
  /** @type {Map<string, string>} scriptId → url */
  const idToUrl = new Map()
  for (const [id, meta] of scripts) {
    idToUrl.set(id, meta.url)
  }

  /**
   * @param {string} scriptUrl
   * @param {string} [sourceMapURL]
   */
  async function loadConsumer(scriptUrl, sourceMapURL) {
    if (consumersByUrl.has(scriptUrl)) return consumersByUrl.get(scriptUrl)

    let mapUrl = sourceMapURL || ''
    if (!mapUrl) {
      // Vite default: adjacent .map
      try {
        mapUrl = new URL(scriptUrl + '.map', baseUrl).href
      } catch {
        consumersByUrl.set(scriptUrl, null)
        return null
      }
    } else if (mapUrl.startsWith('data:')) {
      const idx = mapUrl.indexOf(',')
      const payload = mapUrl.slice(idx + 1)
      const isBase64 = mapUrl.includes(';base64,')
      const json = isBase64
        ? Buffer.from(payload, 'base64').toString('utf8')
        : decodeURIComponent(payload)
      try {
        const consumer = await new SourceMapConsumer(JSON.parse(json))
        consumersByUrl.set(scriptUrl, consumer)
        return consumer
      } catch {
        consumersByUrl.set(scriptUrl, null)
        return null
      }
    } else if (!/^https?:/i.test(mapUrl)) {
      try {
        mapUrl = new URL(mapUrl, scriptUrl).href
      } catch {
        consumersByUrl.set(scriptUrl, null)
        return null
      }
    }

    try {
      const res = await fetch(mapUrl)
      if (!res.ok) {
        consumersByUrl.set(scriptUrl, null)
        return null
      }
      const consumer = await new SourceMapConsumer(await res.json())
      consumersByUrl.set(scriptUrl, consumer)
      return consumer
    } catch {
      consumersByUrl.set(scriptUrl, null)
      return null
    }
  }

  /**
   * Prefetch maps for app scripts.
   */
  async function warm() {
    const tasks = []
    for (const meta of scripts.values()) {
      if (!meta.url || !isAppUrl(meta.url)) continue
      tasks.push(loadConsumer(meta.url, meta.sourceMapURL))
    }
    await Promise.all(tasks)
  }

  /** @type {Map<string, { functionName: string, file: string, line: number, column: number, url: string, isApp: boolean }>} */
  const resolveCache = new Map()

  /**
   * @param {{ functionName?: string, url?: string, lineNumber?: number, columnNumber?: number, scriptId?: string }} cf
   */
  async function resolve(cf) {
    const url = cf.url || (cf.scriptId ? idToUrl.get(cf.scriptId) : '') || ''
    const genLine = (cf.lineNumber ?? 0) + 1 // CDP is 0-based
    const genCol = cf.columnNumber ?? 0
    const cacheKey = `${cf.functionName || ''}|${url}|${genLine}|${genCol}`
    const cached = resolveCache.get(cacheKey)
    if (cached) return cached

    let file = toRelPath(url)
    let line = genLine
    let col = genCol
    let name = cf.functionName || '(anonymous)'

    if (url && isAppUrl(url)) {
      const meta = [...scripts.values()].find((s) => s.url === url)
      const consumer = await loadConsumer(url, meta?.sourceMapURL)
      if (consumer) {
        const orig = consumer.originalPositionFor({ line: genLine, column: genCol })
        if (orig && orig.source != null && orig.line != null) {
          file = toRelPath(orig.source.startsWith('http') ? orig.source : path.posix.normalize(orig.source.replace(/^\/?/, '/')))
          // source-map often returns webpack/vite virtual paths like "/src/..."
          if (orig.source.includes('/src/') || orig.source.startsWith('src/')) {
            const idx = orig.source.indexOf('src/')
            file = orig.source.slice(idx).replace(/\\/g, '/')
          } else if (orig.source.startsWith('../') || orig.source.startsWith('./')) {
            file = orig.source.replace(/\\/g, '/')
          } else if (/^\/?[\w.-]+\.tsx?$/.test(orig.source)) {
            // "/StyleCard.tsx" from vite sources content
            const base = orig.source.replace(/^\//, '')
            file = base === 'App.tsx' || base === 'main.tsx' ? `src/${base}` : `src/components/${base}`
          }
          line = orig.line
          col = orig.column ?? 0
          if (orig.name) name = orig.name
        }
      }
    } else if (url.includes('node_modules')) {
      file = toRelPath(url)
    }

    const out = {
      functionName: name,
      file: normalizeAppFile(file),
      line,
      column: col,
      url,
      isApp: isAppUrl(url) || file.startsWith('src/'),
    }
    resolveCache.set(cacheKey, out)
    return out
  }

  return { warm, resolve, loadConsumer }
}

/**
 * Build parent/child + self hit maps from a Chrome CPU profile.
 * @param {object} profile
 */
export function indexProfile(profile) {
  const nodes = profile.nodes || []
  /** @type {Map<number, any>} */
  const byId = new Map()
  for (const n of nodes) byId.set(n.id, n)

  // Accumulate hit counts onto self; also walk samples if present
  /** @type {Map<number, number>} */
  const selfHits = new Map()
  for (const n of nodes) {
    selfHits.set(n.id, n.hitCount || 0)
  }

  const samples = profile.samples || []
  const timeDeltas = profile.timeDeltas || []
  if (samples.length > 0) {
    // Prefer sample stream (more accurate with setSamplingInterval)
    selfHits.clear()
    for (let i = 0; i < samples.length; i += 1) {
      const id = samples[i]
      const weight = timeDeltas[i] ?? 1
      selfHits.set(id, (selfHits.get(id) || 0) + weight)
    }
  }

  const totalSelf = [...selfHits.values()].reduce((a, b) => a + b, 0)
  const intervalUs = profile.endTime && profile.startTime
    ? undefined
    : undefined

  return { byId, selfHits, totalSelf, samples, timeDeltas, intervalUs, startTime: profile.startTime, endTime: profile.endTime }
}

/**
 * @param {object} profile
 * @param {Awaited<ReturnType<typeof createSourceMapper>>} mapper
 * @param {number} topN
 */
export async function topSelfFunctions(profile, mapper, topN = 15) {
  const { byId, selfHits, totalSelf, startTime, endTime } = indexProfile(profile)
  const durationMs =
    typeof startTime === 'number' && typeof endTime === 'number'
      ? (endTime - startTime) / 1000
      : null

  /** @type {Map<string, { self: number, functionName: string, file: string, line: number, samples: number }>} */
  const agg = new Map()
  let idleSelf = 0

  for (const [id, weight] of selfHits) {
    if (!weight) continue
    const node = byId.get(id)
    if (!node?.callFrame) continue
    const resolved = await mapper.resolve(node.callFrame)
    const functionName = resolved.functionName || '(anonymous)'
    if (IDLE_FNS.has(functionName)) {
      idleSelf += weight
      continue
    }
    const file = normalizeAppFile(resolved.file)
    const key = `${functionName}|${file}|${resolved.line}`
    const prev = agg.get(key)
    if (prev) {
      prev.self += weight
      prev.samples += 1
    } else {
      agg.set(key, {
        self: weight,
        functionName,
        file,
        line: resolved.line,
        samples: 1,
      })
    }
  }

  const activeSelf = Math.max(0, totalSelf - idleSelf)
  const ranked = [...agg.values()].sort((a, b) => b.self - a.self)
  const top = ranked.slice(0, topN).map((row, i) => ({
    rank: i + 1,
    functionName: row.functionName || '(anonymous)',
    location: `${row.file}:${row.line}`,
    file: row.file,
    line: row.line,
    selfWeight: row.self,
    /** Share of *active* (non-idle/program/gc) self time */
    selfShare: activeSelf > 0 ? row.self / activeSelf : 0,
    selfShareOfAll: totalSelf > 0 ? row.self / totalSelf : 0,
    selfMs: durationMs != null && totalSelf > 0 ? (row.self / totalSelf) * durationMs : null,
  }))

  return {
    totalSelf,
    activeSelf,
    idleSelf,
    idleShare: totalSelf > 0 ? idleSelf / totalSelf : 0,
    durationMs,
    top,
    ranked,
  }
}

/**
 * Build parent map once.
 * @param {object} profile
 */
function buildParentMap(profile) {
  /** @type {Map<number, number>} */
  const parent = new Map()
  for (const n of profile.nodes || []) {
    for (const childId of n.children || []) {
      parent.set(childId, n.id)
    }
  }
  return parent
}

/**
 * Resolve a leaf→root stack of call frames for a node id.
 * @param {number} sampleId
 * @param {Map<number, any>} byId
 * @param {Map<number, number>} parent
 * @param {Awaited<ReturnType<typeof createSourceMapper>>} mapper
 */
async function resolveStack(sampleId, byId, parent, mapper) {
  /** @type {{ functionName: string, file: string, line: number }[]} */
  const stack = []
  let id = sampleId
  let guard = 0
  while (id != null && guard++ < 100) {
    const node = byId.get(id)
    if (!node?.callFrame) break
    const resolved = await mapper.resolve(node.callFrame)
    stack.push({
      functionName: resolved.functionName || '(anonymous)',
      file: normalizeAppFile(resolved.file || ''),
      line: resolved.line,
    })
    id = parent.get(id)
  }
  return stack
}

/** Modules that are not React components (hooks/utils/lib). */
const NON_COMPONENT_NAMES = new Set([
  'stylesStore',
  'styleIdentity',
  'styleGridFetch',
  'buildGridRows',
  'useCategorySelectedCount',
  'utils',
  'tooltip',
  'popover',
  'button',
  'dialog',
  'wildcardKey',
  'wildcardSlice',
  'wildcardLabels',
])

function componentNameFromFile(file) {
  const f = normalizeAppFile(file)
  if (f === 'src/App.tsx' || f.endsWith('/App.tsx')) return 'App'
  // Only .tsx under components/ (exclude .ts stores/utils)
  const m = f.match(/src\/components\/([\w.-]+)\.tsx$/)
  if (!m) return null
  const name = m[1]
  if (NON_COMPONENT_NAMES.has(name)) return null
  // Prefer PascalCase component files
  if (!/^[A-Z]/.test(name)) return null
  return name
}

/**
 * Walk sample stacks; find which known components appear under React render work on toggle.
 * @param {object} profile
 * @param {Awaited<ReturnType<typeof createSourceMapper>>} mapper
 */
export async function detectRerenderComponents(profile, mapper) {
  const { byId, samples, selfHits, timeDeltas } = indexProfile(profile)
  const parent = buildParentMap(profile)

  /** @type {Map<string, number>} */
  const componentHits = new Map()
  /** @type {Map<string, number>} */
  const fileHits = new Map()
  /** @type {Map<string, number>} */
  const componentWeight = new Map()

  const useSamples = samples.length > 0
  const sampleList = useSamples ? samples : [...selfHits.keys()]

  for (let i = 0; i < sampleList.length; i += 1) {
    const sampleId = sampleList[i]
    const weight = useSamples ? timeDeltas[i] ?? 1 : selfHits.get(sampleId) || 0
    const leaf = byId.get(sampleId)?.callFrame
    const leafName = leaf?.functionName || ''
    if (IDLE_FNS.has(leafName)) continue

    const stack = await resolveStack(sampleId, byId, parent, mapper)
    const stackStr = stack.map((f) => f.functionName).join('|')
    const inRender =
      /renderWithHooks|updateFunctionComponent|beginWork|performUnitOfWork|commitRoot|flushSyncWork|reconcileChildren|react_stack_bottom_frame|runWithFiberInDEV|completeWork/.test(
        stackStr,
      )

    // Also count app component frames even outside explicit render helper names
    // (Zustand subscriber → setState → render).
    const appFrames = stack.filter(
      (f) =>
        f.file.startsWith('src/components/') ||
        f.file.startsWith('src/App') ||
        KNOWN_COMPONENTS.some((n) => f.functionName === n || f.functionName.includes(n)),
    )
    if (!inRender && appFrames.length === 0) continue

    /** @type {Set<string>} */
    const seen = new Set()
    for (const frame of stack) {
      const fromFile = componentNameFromFile(frame.file)
      const fromName = KNOWN_COMPONENTS.find(
        (n) =>
          (frame.functionName === n || frame.functionName.endsWith(n)) &&
          !NON_COMPONENT_NAMES.has(n),
      )
      const name = fromFile || fromName
      if (name && !seen.has(name)) {
        seen.add(name)
        componentHits.set(name, (componentHits.get(name) || 0) + 1)
        componentWeight.set(name, (componentWeight.get(name) || 0) + weight)
      }
      if (frame.file.startsWith('src/') && /\.tsx$/.test(frame.file)) {
        fileHits.set(frame.file, (fileHits.get(frame.file) || 0) + weight)
      }
    }
  }

  const components = [...componentHits.entries()]
    .sort((a, b) => (componentWeight.get(b[0]) || 0) - (componentWeight.get(a[0]) || 0))
    .map(([name, hits]) => ({ name, hits, weight: componentWeight.get(name) || 0 }))

  const componentFiles = [...fileHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([file, weight]) => ({ file, hits: weight, weight }))

  return { components, componentFiles }
}

/**
 * Classify one sample stack for search work.
 * @param {{ functionName: string, file: string }[]} stack
 */
function classifySearchStack(stack) {
  const names = stack.map((f) => f.functionName)
  const files = stack.map((f) => f.file.toLowerCase())
  const joined = names.join('|').toLowerCase()

  const hasFilterFn = names.some((n) =>
    /matchesSearch|tokensMatch|buildStyleSearch|nameSearch|filter|setSearch|getSuggestions/i.test(n),
  )
  const hasFilterFile = files.some(
    (f) =>
      f.includes('stylesstore') ||
      f.includes('searchbar') ||
      f.includes('wildcard'),
  )
  // Array#filter / string ops on a search-related stack
  const leaf = stack[0]
  const leafIsArrayFilter =
    leaf &&
    (/^filter$|includes|toLowerCase|split|trim|every|some/.test(leaf.functionName) ||
      FILTER_HINTS.some((h) => leaf.functionName.toLowerCase().includes(h.toLowerCase())))

  const isFilter =
    hasFilterFn ||
    (hasFilterFile && (leafIsArrayFilter || /match|search|filter|token|haystack/i.test(joined))) ||
    (files.some((f) => f.includes('stylegrid')) && /match|filter|search/i.test(joined))

  const isRender =
    /renderWithHooks|updateFunctionComponent|beginWork|completeWork|commitRoot|reconcile|react_stack_bottom_frame|jsxDEV|ReactElement|setValueForStyles|flushSync/.test(
      names.join('|'),
    ) ||
    files.some(
      (f) =>
        f.includes('react-dom') ||
        f.includes('react_jsx') ||
        f.includes('framer-motion') ||
        f.includes('scheduler') ||
        f.startsWith('src/components/') ||
        f.startsWith('src/app'),
    )

  if (isFilter && isRender) return 'both'
  if (isFilter) return 'filter'
  if (isRender) return 'render'
  return 'other'
}

/**
 * Split search-keystroke profile into filter vs render vs other.
 * Uses call-stack classification; shares are of *active* (non-idle) sample weight.
 * @param {object} profile
 * @param {Awaited<ReturnType<typeof createSourceMapper>>} mapper
 */
export async function classifyFilterVsRender(profile, mapper) {
  const { byId, samples, selfHits, timeDeltas, totalSelf } = indexProfile(profile)
  const parent = buildParentMap(profile)
  let filterW = 0
  let renderW = 0
  let otherW = 0
  let idleW = 0
  /** @type {{ label: string, self: number }[]} */
  const filterParts = []
  /** @type {{ label: string, self: number }[]} */
  const renderParts = []

  const useSamples = samples.length > 0
  const sampleList = useSamples ? samples : [...selfHits.keys()]

  for (let i = 0; i < sampleList.length; i += 1) {
    const sampleId = sampleList[i]
    const weight = useSamples ? timeDeltas[i] ?? 1 : selfHits.get(sampleId) || 0
    if (!weight) continue
    const leafFn = byId.get(sampleId)?.callFrame?.functionName || ''
    if (IDLE_FNS.has(leafFn)) {
      idleW += weight
      continue
    }
    const stack = await resolveStack(sampleId, byId, parent, mapper)
    const leaf = stack[0]
    const label = leaf
      ? `${leaf.functionName} @ ${leaf.file}:${leaf.line}`
      : '(unknown)'
    const kind = classifySearchStack(stack)

    if (kind === 'filter') {
      filterW += weight
      filterParts.push({ label, self: weight })
    } else if (kind === 'render') {
      renderW += weight
      renderParts.push({ label, self: weight })
    } else if (kind === 'both') {
      // Filter work invoked while rebuilding the list: split
      filterW += weight * 0.5
      renderW += weight * 0.5
      filterParts.push({ label: `${label} (shared)`, self: weight * 0.5 })
      renderParts.push({ label: `${label} (shared)`, self: weight * 0.5 })
    } else {
      otherW += weight
    }
  }

  const active = filterW + renderW + otherW
  const share = (w) => (active > 0 ? w / active : 0)
  const shareAll = (w) => (totalSelf > 0 ? w / totalSelf : 0)
  return {
    totalSelf,
    activeSelf: active,
    idleSelf: idleW,
    filter: {
      weight: filterW,
      share: share(filterW),
      shareOfAll: shareAll(filterW),
      top: filterParts.sort((a, b) => b.self - a.self).slice(0, 8),
    },
    render: {
      weight: renderW,
      share: share(renderW),
      shareOfAll: shareAll(renderW),
      top: renderParts.sort((a, b) => b.self - a.self).slice(0, 8),
    },
    other: { weight: otherW, share: share(otherW), shareOfAll: shareAll(otherW) },
  }
}

/**
 * Summarize what toggle spends time on at grid level (stack-attributed).
 * Shares are of active (non-idle) sample weight.
 * @param {object} profile
 * @param {Awaited<ReturnType<typeof createSourceMapper>>} mapper
 */
export async function classifyToggleWork(profile, mapper) {
  const { byId, samples, selfHits, timeDeltas, totalSelf } = indexProfile(profile)
  const parent = buildParentMap(profile)
  const buckets = {
    selectionStore: 0,
    cardRender: 0,
    gridOrChrome: 0,
    reactReconcile: 0,
    zustandNotify: 0,
    motion: 0,
    otherApp: 0,
    other: 0,
  }
  let idleW = 0

  const useSamples = samples.length > 0
  const sampleList = useSamples ? samples : [...selfHits.keys()]

  for (let i = 0; i < sampleList.length; i += 1) {
    const sampleId = sampleList[i]
    const weight = useSamples ? timeDeltas[i] ?? 1 : selfHits.get(sampleId) || 0
    if (!weight) continue
    const leafFn = byId.get(sampleId)?.callFrame?.functionName || ''
    if (IDLE_FNS.has(leafFn)) {
      idleW += weight
      continue
    }
    const stack = await resolveStack(sampleId, byId, parent, mapper)
    const files = stack.map((f) => f.file.toLowerCase())
    const names = stack.map((f) => f.functionName)
    const joined = names.join('|')

    const onCard = files.some((f) => f.includes('stylecard') || f.includes('thumbnailpreview'))
    const onGrid = files.some((f) => f.includes('stylegrid'))
    const onChrome = files.some(
      (f) =>
        f.includes('sidebar') ||
        f.includes('styleinfopanel') ||
        f.includes('bottompanel') ||
        f.includes('sourcefilter') ||
        f.includes('app.tsx'),
    )
    const onStore = files.some((f) => f.includes('stylesstore')) || /toggleStyle|useIsSelected|selectedKeySet|styleRowKey|selectionDerived/.test(joined)
    const onZustand = files.some((f) => f.includes('zustand'))
    const onMotion = files.some((f) => f.includes('framer-motion')) || /measureScroll|useMotionRef|motion/i.test(joined)
    const onReact =
      files.some((f) => f.includes('react-dom') || f.includes('react_jsx') || f.includes('scheduler')) ||
      /renderWithHooks|beginWork|completeWork|commitRoot|reconcile|react_stack_bottom_frame/.test(joined)

    if (onStore) buckets.selectionStore += weight
    else if (onCard) buckets.cardRender += weight
    else if (onGrid || onChrome) buckets.gridOrChrome += weight
    else if (onZustand) buckets.zustandNotify += weight
    else if (onMotion) buckets.motion += weight
    else if (onReact) buckets.reactReconcile += weight
    else if (files.some((f) => f.startsWith('src/'))) buckets.otherApp += weight
    else buckets.other += weight
  }

  const active = Object.values(buckets).reduce((a, b) => a + b, 0)
  const share = (w) => (active > 0 ? w / active : 0)
  return {
    totalSelf,
    activeSelf: active,
    idleSelf: idleW,
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([k, w]) => [k, { weight: w, share: share(w) }]),
    ),
  }
}

export function formatTopTable(top) {
  const lines = [
    '| # | Function | Location | Self % (active) | Self ms |',
    '|---|----------|----------|-----------------|---------|',
  ]
  for (const row of top) {
    const pct = `${(row.selfShare * 100).toFixed(1)}%`
    const ms = row.selfMs != null ? row.selfMs.toFixed(1) : '—'
    lines.push(`| ${row.rank} | \`${row.functionName}\` | \`${row.location}\` | ${pct} | ${ms} |`)
  }
  return lines.join('\n')
}

export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}
