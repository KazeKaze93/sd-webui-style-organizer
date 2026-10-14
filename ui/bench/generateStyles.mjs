/**
 * Synthetic Style[] + realism sidecar for grid perf / layout benches.
 * 12 categories, 3 sources, ~10% of names duplicated across sources.
 * favorites ~5%, 10 selected, names ≤40 chars, long descriptions.
 */

export const CATEGORIES = Object.freeze([
  'BASE',
  'CAMERA',
  'LIGHTING',
  'BODY',
  'HAIR',
  'POSE',
  'SCENE',
  'CLOTHES',
  'EXPRESSION',
  'STYLE',
  'THEME',
  'ACTION',
])

export const SOURCES = Object.freeze([
  'pack_alpha.csv',
  'pack_beta.csv',
  'pack_gamma.csv',
])

/** Fraction of unique base names that also appear under a second source. */
export const DUPLICATE_NAME_RATIO = 0.1

/** ~5% of styles marked favorite via styleRowKey. */
export const FAVORITE_RATIO = 0.05

/** Pre-select this many styles after SG_INIT (layout / selection chrome cost). */
export const SELECTED_COUNT = 10

/** Catalog names are capped at this length (matches product display budget). */
export const MAX_NAME_LEN = 40

/**
 * Deterministic PRNG (mulberry32).
 * @param {number} seed
 */
function mulberry32(seed) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Same composite as stylesStore.styleRowKey. */
export function styleRowKey(style) {
  return `${style.source_file}\0${style.name}`
}

/**
 * @param {number} n Total styles to generate (including duplicate-name rows).
 * @returns {import('../src/bridge').Style[]}
 */
export function generateStyles(n) {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`generateStyles: n must be a positive integer, got ${n}`)
  }

  const styles = []
  let i = 0

  // uniqueBases + floor(uniqueBases * ratio) ~= n  => uniqueBases ~= n / 1.1
  const uniqueTarget = Math.max(1, Math.ceil(n / (1 + DUPLICATE_NAME_RATIO)))
  const uniqueNames = []

  while (styles.length < Math.min(n, uniqueTarget)) {
    const cat = CATEGORIES[i % CATEGORIES.length]
    const source = SOURCES[i % SOURCES.length]
    const name = makeName(cat, i)
    uniqueNames.push(name)
    styles.push(makeStyle(name, cat, source, i))
    i += 1
  }

  let dupIdx = 0
  while (styles.length < n) {
    const baseName = uniqueNames[dupIdx % uniqueNames.length]
    const cat = baseName.split('_')[0] || CATEGORIES[0]
    const orig = styles.find((s) => s.name === baseName)
    const origSource = orig?.source_file ?? SOURCES[0]
    const altSource =
      SOURCES.find((s) => s !== origSource) ?? SOURCES[(dupIdx + 1) % SOURCES.length]
    styles.push(makeStyle(baseName, cat, altSource, i))
    dupIdx += 1
    i += 1
  }

  return styles
}

/**
 * Full bench fixture: styles + favorites / selected sidecars.
 * @param {number} n
 */
export function buildBenchFixture(n) {
  const styles = generateStyles(n)
  const rand = mulberry32(0x5e1f ^ n)

  const favorites = []
  const selected = []

  for (let i = 0; i < styles.length; i += 1) {
    const style = styles[i]
    if (rand() < FAVORITE_RATIO) {
      favorites.push(styleRowKey(style))
    }
  }

  // Dedupe favorite keys (duplicate-name rows can collide on rand).
  const favSet = [...new Set(favorites)]

  const pickStride = Math.max(1, Math.floor(styles.length / SELECTED_COUNT))
  for (let i = 0; i < styles.length && selected.length < SELECTED_COUNT; i += pickStride) {
    selected.push(styles[i])
  }
  while (selected.length < SELECTED_COUNT && selected.length < styles.length) {
    selected.push(styles[selected.length])
  }

  return {
    styles,
    favorites: favSet,
    selected,
    meta: {
      n,
      favoriteCount: favSet.length,
      selectedCount: selected.length,
      favoriteRatioTarget: FAVORITE_RATIO,
    },
  }
}

/**
 * @param {string} category
 * @param {number} seed
 */
function makeName(category, seed) {
  // Mix short catalog names with near-max (40) names for truncation realism.
  const short = `${category}_Bench_${String(seed).padStart(5, '0')}`
  if (seed % 4 !== 0) {
    return short.slice(0, MAX_NAME_LEN)
  }
  const pad = '_LongDisplayNameExtra'
  let name = short
  while (name.length < MAX_NAME_LEN) {
    name += pad
  }
  return name.slice(0, MAX_NAME_LEN)
}

/**
 * @param {string} name
 * @param {string} category
 * @param {string} source_file
 * @param {number} seed
 */
function makeStyle(name, category, source_file, seed) {
  const comboA = `${CATEGORIES[(seed + 1) % CATEGORIES.length]}_Bench_${String((seed + 3) % 10000).padStart(5, '0')}`
  const comboB = `${CATEGORIES[(seed + 5) % CATEGORIES.length]}_Bench_${String((seed + 7) % 10000).padStart(5, '0')}`
  return {
    name,
    prompt: `bench prompt ${seed}, detailed, high quality, intricate lighting, sharp focus`,
    negative_prompt: `bench neg ${seed}, low quality, blurry, artifacts`,
    description:
      `Synthetic bench style ${seed} (${category}). ` +
      `Combos: ${comboA}, ${comboB}. Conflicts: none. ` +
      `Long description padding to exercise info-panel wrap, search haystacks, ` +
      `and any future card subtitle paths without affecting fixed card chrome height.`,
    category,
    source_file,
    has_thumbnail: false,
  }
}
