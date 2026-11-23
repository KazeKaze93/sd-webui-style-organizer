/**
 * Neutral demo library for the README screenshots: photography and art terms
 * only, so the pictures show the interface and not anyone's style packs.
 * The same file is used by the ComfyUI and the WebUI repo; only the source
 * ids differ (see sourceIds).
 */

/** Category → style suffixes. Underscores become spaces on the tiles. */
const LIBRARY = {
  LIGHTING: [
    'Golden_Hour', 'Blue_Hour', 'Soft_Box', 'Rim_Light', 'Backlit', 'Candlelight', 'Neon_Glow',
    'Overcast', 'Studio_Three_Point', 'Volumetric_Light_Through_Cathedral_Windows', 'Moonlight',
    'Dappled_Sunlight', 'Chiaroscuro', 'High_Key', 'Low_Key',
  ],
  CAMERA: [
    'Wide_Angle', 'Telephoto', 'Macro', 'Tilt_Shift', 'Fisheye', 'Drone_View', 'Eye_Level',
    'Low_Angle', 'Dutch_Angle', 'Over_The_Shoulder', 'Shallow_Depth_Of_Field_With_Creamy_Bokeh',
    'Long_Exposure',
  ],
  MEDIUM: [
    'Watercolor', 'Oil_Paint', 'Gouache', 'Charcoal', 'Ink_Wash', 'Pastel', 'Linocut',
    'Pencil_Sketch', 'Digital_Painting', 'Collage', 'Risograph', 'Cyanotype',
  ],
  PALETTE: [
    'Pastel_Tones', 'Earth_Tones', 'Monochrome', 'Duotone', 'Teal_And_Orange', 'Muted',
    'Vibrant', 'Sepia', 'Cool_Blues',
  ],
  COMPOSITION: [
    'Rule_Of_Thirds', 'Centered', 'Symmetry', 'Leading_Lines', 'Negative_Space', 'Frame_In_Frame',
    'Golden_Ratio_Spiral', 'Diagonal',
  ],
  ENVIRONMENT: [
    'Forest', 'Desert', 'Coastline', 'Mountain_Pass', 'City_Street', 'Rooftop', 'Library',
    'Greenhouse', 'Train_Station', 'Lighthouse_On_A_Rocky_Cliff_Above_The_Sea', 'Harbor',
    'Old_Town_Square', 'Botanical_Garden', 'Snowfield',
  ],
  WEATHER: ['Fog', 'Light_Rain', 'Snowfall', 'Storm_Clouds', 'Clear_Sky', 'Heat_Haze', 'Drizzle'],
  ARCHITECTURE: [
    'Gothic', 'Brutalist', 'Art_Deco', 'Bauhaus', 'Victorian', 'Japanese_Wooden', 'Glass_And_Steel',
    'Mediterranean',
  ],
  MOOD: ['Serene', 'Cozy', 'Mysterious', 'Nostalgic', 'Playful', 'Melancholic', 'Hopeful'],
  TEXTURE: ['Film_Grain', 'Paper_Texture', 'Canvas_Weave', 'Matte', 'Glossy', 'Weathered_Wood'],
  SEASON: ['Spring_Bloom', 'Midsummer', 'Autumn_Leaves', 'Deep_Winter'],
  QUALITY: ['Highly_Detailed', 'Sharp_Focus', 'Clean_Lines', 'Balanced_Exposure', 'Subtle_Gradients'],
}

const NEGATIVES = {
  LIGHTING: 'flat lighting, harsh shadows',
  CAMERA: 'distorted perspective',
  MEDIUM: 'photograph, 3d render',
  PALETTE: 'oversaturated',
  COMPOSITION: 'cluttered composition',
  QUALITY: 'blurry, low detail, jpeg artifacts',
}

/** A short plain-English prompt for a style suffix. */
function promptFor(category, suffix) {
  const words = suffix.split('_').join(' ').toLowerCase()
  switch (category) {
    case 'LIGHTING':
      return `${words}, soft light falloff`
    case 'CAMERA':
      return `${words} shot, photographic framing`
    case 'MEDIUM':
      return `${words}, visible texture, traditional media`
    case 'PALETTE':
      return `${words} color palette`
    case 'COMPOSITION':
      return `${words} composition`
    case 'ENVIRONMENT':
      return `${words} setting, environmental detail`
    case 'WEATHER':
      return `${words}, atmospheric`
    case 'ARCHITECTURE':
      return `${words} architecture`
    case 'MOOD':
      return `${words} mood`
    case 'SEASON':
      return `${words}, seasonal colors`
    default:
      return words
  }
}

/**
 * Source ids per platform: two writable packs and the read-only demo pack.
 * @param {'comfy' | 'webui'} platform
 */
export function sourceIds(platform) {
  return platform === 'comfy'
    ? { main: 'data/photography.csv', art: 'data/art_styles.csv', demo: 'samples/demo.csv' }
    : { main: 'webui/photography.csv', art: 'styles/art_styles.csv', demo: 'samples/demo.csv' }
}

const ART_CATEGORIES = new Set(['MEDIUM', 'PALETTE', 'TEXTURE'])

/**
 * The demo library as the host sends it in SG_INIT.
 * @param {'comfy' | 'webui'} platform
 */
export function buildStyles(platform) {
  const src = sourceIds(platform)
  const styles = []
  for (const [category, suffixes] of Object.entries(LIBRARY)) {
    for (const suffix of suffixes) {
      const name = `${category}_${suffix}`
      styles.push({
        name,
        prompt: promptFor(category, suffix),
        negative_prompt: NEGATIVES[category] ?? '',
        description: '',
        category,
        source_file: ART_CATEGORIES.has(category) ? src.art : src.main,
      })
    }
  }
  // Combos: "Works with" chips on a card and in the editor.
  const golden = styles.find((s) => s.name === 'LIGHTING_Golden_Hour')
  golden.description = 'Warm, low sun. Combos: COMPOSITION_Leading_Lines, PALETTE_Earth_Tones'
  // The read-only demo pack that ships with the extension.
  for (const [category, suffix, prompt] of [
    ['DEMO', 'Soft_Portrait', 'soft portrait lighting, gentle shadows'],
    ['DEMO', 'Cinematic', 'cinematic still, anamorphic lens'],
    ['DEMO', 'Sketchbook', 'pencil sketch, sketchbook page'],
    ['DEMO', 'Landscape', 'wide landscape, distant mountains'],
  ]) {
    styles.push({
      name: `${category}_${suffix}`,
      prompt,
      negative_prompt: '',
      description: 'Bundled demo style.',
      category,
      source_file: src.demo,
      read_only: true,
    })
  }
  return styles
}

/** LoRA cards (WebUI only): synthetic styles from the LoRA scan. */
export function buildLoras() {
  const LORA_SOURCE = '__style_grid_lora__'
  return [
    ['STYLE', 'ink_wash_v2', 'Ink Wash Illustration'],
    ['STYLE', 'paper_cutout', 'Paper Cutout Craft'],
    ['STYLE', 'retro_poster', 'Retro Travel Poster'],
    ['STYLE', 'watercolor_soft', 'Soft Watercolor'],
    ['CONCEPT', 'isometric_rooms', 'Isometric Rooms'],
    ['CONCEPT', 'miniature_world', 'Miniature World'],
    ['CONCEPT', 'botanical_plate', 'Botanical Plate'],
    ['DETAIL', 'detail_tweaker', 'Detail Tweaker'],
    ['DETAIL', 'film_grain_xl', 'Film Grain XL'],
    ['DETAIL', 'sharp_edges', 'Sharp Edges'],
  ].map(([folder, stem, title]) => ({
    name: `LORA_${stem}`,
    display_name: title,
    prompt: `<lora:${stem}:0.8>`,
    negative_prompt: '',
    description: '',
    category: folder,
    source_file: LORA_SOURCE,
    read_only: true,
  }))
}

/** Favorites as GET /style_grid/favorites returns them ("<source>\0<name>"). */
export function favoriteKeys(platform) {
  const src = sourceIds(platform)
  return [
    [src.main, 'LIGHTING_Golden_Hour'],
    [src.main, 'LIGHTING_Rim_Light'],
    [src.main, 'CAMERA_Macro'],
    [src.art, 'MEDIUM_Watercolor'],
    [src.art, 'PALETTE_Earth_Tones'],
    [src.main, 'ENVIRONMENT_Coastline'],
    [src.main, 'MOOD_Serene'],
  ].map(([source, name]) => `${source}\0${name}`)
}

/** Presets as GET /style_grid/presets returns them. */
export function presets(platform) {
  const src = sourceIds(platform)
  const entry = (name, source) => ({ name, source_file: source })
  return {
    'Quiet landscape': {
      created: '2026-11-02T10:00:00',
      styles: [
        entry('ENVIRONMENT_Coastline', src.main),
        entry('WEATHER_Fog', src.main),
        entry('PALETTE_Muted', src.art),
        entry('COMPOSITION_Negative_Space', src.main),
      ],
      note: 'Calm wide shots with lots of air.',
    },
    'Studio portrait': {
      created: '2026-11-05T12:30:00',
      styles: [
        entry('LIGHTING_Studio_Three_Point', src.main),
        entry('CAMERA_Eye_Level', src.main),
        entry('QUALITY_Sharp_Focus', src.main),
      ],
    },
    'Watercolor travel sketch': {
      created: '2026-11-09T08:15:00',
      styles: [entry('MEDIUM_Watercolor', src.art), entry('ENVIRONMENT_Old_Town_Square', src.main)],
      wildcards: [{ category: 'weather', spec: '', kind: 'sg' }],
    },
    'Night city': {
      created: '2026-11-12T21:40:00',
      styles: [
        entry('ENVIRONMENT_City_Street', src.main),
        entry('LIGHTING_Neon_Glow', src.main),
        entry('WEATHER_Light_Rain', src.main),
        entry('CAMERA_Long_Exposure', src.main),
        entry('MOOD_Missing_Style', src.main),
      ],
    },
  }
}

/** Styles that have an uploaded preview (gallery view). */
export function thumbnailKeys(styles) {
  return styles
    .filter((s) => !s.read_only && s.source_file && !s.source_file.startsWith('__'))
    .map((s) => ({ name: s.name, source_file: s.source_file }))
}

/**
 * Preview image for a style: a neutral gradient "landscape" drawn from a hash
 * of its name, in place of a real picture.
 * @param {string} name
 */
export function thumbnailSvg(name) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const hue = h % 360
  const hue2 = (hue + 40 + (h % 60)) % 360
  const sun = 20 + (h % 60)
  const hill = 55 + (h % 20)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="hsl(${hue} 45% 62%)"/><stop offset="1" stop-color="hsl(${hue2} 40% 30%)"/>
</linearGradient></defs>
<rect width="256" height="256" fill="url(#g)"/>
<circle cx="${sun * 2.56}" cy="70" r="26" fill="hsl(${hue} 70% 88%)" opacity="0.85"/>
<path d="M0 ${hill * 2.56} Q 80 ${hill * 2.56 - 40} 140 ${hill * 2.56 - 10} T 256 ${hill * 2.56 - 20} V256 H0Z" fill="hsl(${hue2} 30% 22%)" opacity="0.9"/>
</svg>`
}
