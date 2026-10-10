/**
 * Synthetic Style[] for grid perf benches.
 * 12 categories, 3 sources, ~10% of names duplicated across sources.
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

  // First pass: unique-name rows until we have enough capacity for ~10% dupes.
  // uniqueBases + floor(uniqueBases * ratio) ~= n  => uniqueBases ~= n / 1.1
  const uniqueTarget = Math.max(1, Math.ceil(n / (1 + DUPLICATE_NAME_RATIO)))
  const uniqueNames = []

  while (styles.length < Math.min(n, uniqueTarget)) {
    const cat = CATEGORIES[i % CATEGORIES.length]
    const source = SOURCES[i % SOURCES.length]
    const name = `${cat}_Bench_${String(i).padStart(5, '0')}`
    uniqueNames.push(name)
    styles.push(makeStyle(name, cat, source, i))
    i += 1
  }

  let dupIdx = 0
  while (styles.length < n) {
    const baseName = uniqueNames[dupIdx % uniqueNames.length]
    const cat = baseName.split('_')[0] || CATEGORIES[0]
    // Pick a different source than the original when possible.
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
 * @param {string} name
 * @param {string} category
 * @param {string} source_file
 * @param {number} seed
 */
function makeStyle(name, category, source_file, seed) {
  return {
    name,
    prompt: `bench prompt ${seed}, detailed, high quality`,
    negative_prompt: `bench neg ${seed}, low quality`,
    description: `Synthetic bench style ${seed} (${category})`,
    category,
    source_file,
    has_thumbnail: false,
  }
}
