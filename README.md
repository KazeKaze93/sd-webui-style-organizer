# 🎨 Style Grid — Visual Style Selector for Forge WebUI

A grid/gallery-based style selector extension for [Stable Diffusion WebUI Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge). Replaces the clunky dropdown with a fast, searchable, categorized grid — with multi-select and one-click apply.

![Grid Icon](https://img.shields.io/badge/UI-Grid%20Selector-6366f1?style=flat-square)

## Features

- **Grid/Matrix display** — styles shown as cards in a visual grid, not a scrolling dropdown
- **Auto-categorization** — styles prefixed like `BASE_`, `BODY_`, `THEME_` are grouped automatically
- **Multi-select** — pick as many styles as you want, then apply all at once
- **Instant search** — type to filter across all categories
- **Category collapse** — fold/unfold categories to save space
- **Select All** per category — one click to toggle an entire group
- **Selected tags** — footer shows your picks as removable tags
- **Badge counter** — the trigger button shows how many styles are selected
- **Keyboard support** — Escape to close, search auto-focuses
- **Non-destructive** — does NOT modify Forge's core UI; adds a small button alongside existing tools
- **CSV support** — reads standard `styles.csv` from Forge root + any CSVs in the extension's `styles/` folder
- **Works on both txt2img & img2img tabs**

## Installation

### Option 1: Clone into extensions
```bash
cd /path/to/stable-diffusion-webui-forge/extensions
git clone https://github.com/YOUR_USERNAME/sd-webui-style-grid.git
```

### Option 2: Copy manually
Copy the `sd-webui-style-grid` folder into your Forge `extensions/` directory.

### Option 3: Install from Forge UI
1. Go to **Extensions** → **Install from URL**
2. Paste the repo URL
3. Click **Install**
4. Restart UI

## Usage

1. After install, you'll see a small **grid icon button** (⊞) near the existing tool buttons under the Generate button
2. Click it to open the **Style Grid** modal
3. Browse categories, use search, click cards to select
4. Click **✔ Apply** to inject selected styles into your prompt & negative prompt
5. Press **Escape** or click the backdrop to close

## Style CSV Format

Standard A1111/Forge format:
```csv
name,prompt,negative_prompt
BASE_Illustrious_Quality,"masterpiece, best quality, highres","lowres, bad anatomy, worst quality"
STYLE_Watercolor,"watercolor painting, soft edges, blending",""
SCENE_Cyberpunk_City,"neon lights, futuristic city, rain, reflections",""
```

### Category Prefixes

Styles are auto-grouped by the **UPPERCASE prefix** before the first underscore:

| Prefix | Color | Description |
|--------|-------|-------------|
| `BASE` | Indigo | Quality & model presets |
| `STYLE` | Blue | Art styles |
| `SCENE` | Green | Environments & backgrounds |
| `THEME` | Violet | Scene themes & moods |
| `POSE` | Teal | Character poses |
| `LIGHTING` | Amber | Lighting setups |
| `COLOR` | Pink | Color palettes & schemes |
| `CAMERA` | Orange | Camera angles & lenses |
| `OTHER` | Gray | Uncategorized |

You can add your own categories — just use `YOURCATEGORY_StyleName` format.

## Adding More Styles

1. Create a new `.csv` file with the format above
2. Place it in your Forge root directory (alongside `styles.csv`) or in the extension's `styles/` folder
3. Restart UI or the styles will be loaded on next panel open

## Compatibility

- ✅ Stable Diffusion WebUI Forge (latest)
- ✅ Forge Classic / Neo
- ✅ A1111 WebUI (should work, not fully tested)
- ✅ Dark & Light themes

## Troubleshooting

**Button doesn't appear:**
- Make sure the extension is enabled in Extensions tab
- Try restarting the UI completely
- Check browser console for `[Style Grid]` messages

**Styles not loading:**
- Verify your `styles.csv` is in the Forge root directory
- Check CSV format (must have `name,prompt,negative_prompt` columns)
- Look at the terminal for error messages from `[Style Grid]`

## License

[AGPL-3.0](LICENSE) (GNU Affero General Public License v3.0)
