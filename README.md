# 🎨 Style Grid — Visual Style Selector for Forge WebUI

A grid/gallery-based style selector extension for [Stable Diffusion WebUI Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge). Replaces the default dropdown with a searchable, categorized grid — multi-select, favorites, source filter, instant apply, silent mode, presets, conflict detection, and more.

![UI](https://img.shields.io/badge/UI-Grid%20Selector-6366f1?style=flat-square)

---

## What it does

- **Visual grid** — Styles appear as cards in a categorized grid instead of a long dropdown.
- **Dynamic categories** — Grouping by name: `PREFIX_StyleName` → category **PREFIX**; `name-with-dash` → category from the part before the dash; otherwise from the CSV filename. Colors are generated from category names.
- **Instant apply** — Click a card to select **and** immediately apply its prompt. Click again to deselect and cleanly remove it. No Apply button needed.
- **Multi-select** — Select several styles at once; each is applied independently and can be removed individually.
- **Favorites** — Star any style; a **★ Favorites** section at the top lists them. Favorites update immediately (no reload).
- **Source filter** — Dropdown to show **All Sources** or a single CSV file (e.g. `styles.csv`, `styles_integrated.csv`). Combines with search.
- **Search** — Filter by style name; works together with the source filter. Category names in the search box show only that category.
- **Category view** — Sidebar (when many categories): show **All**, **★ Favorites**, **🕑 Recent**, or one category. Compact bar when there are few categories.
- **Silent mode** — Toggle `👁 Silent` to hide style content from prompt fields. Styles are injected at generation time only and recorded in image metadata as `Style Grid: style1, style2, ...`.
- **Style presets** — Save any combination of selected styles as a named preset (📦). Load or delete presets from the menu. Stored in `data/presets.json`.
- **Conflict detector** — Warns when selected styles contradict each other (e.g. one adds a tag that another negates). Shows a pulsing ⚠ badge with details on hover.
- **Context menu** — Right-click any card: Edit, Duplicate, Delete, Move to category, Copy prompt to clipboard.
- **Built-in style editor** — Create and edit styles directly from the grid (➕ or right-click → Edit). Changes are written to CSV — no manual file editing needed.
- **Recent history** — 🕑 section showing the last 10 used styles for quick re-access.
- **Usage counter** — Tracks how many times each style was used; badge on cards. Stats in `data/usage.json`.
- **Random style** — 🎲 picks a random style (use at your own risk!).
- **Manual backup** — 💾 snapshots all CSV files to `data/backups/` (keeps last 20).
- **Import/Export** — 📥 export all styles, presets, and usage stats as JSON, or import from one.
- **Dynamic refresh** — Auto-detects CSV changes every 5 seconds; manual 🔄 button also available.
- **{prompt} placeholder highlight** — Styles containing `{prompt}` are marked with a ⟳ icon.
- **Collapse / Expand** — Collapse or expand all category blocks. **Compact** mode for a denser layout.
- **Select All** — Per-category "Select All" to toggle the whole group.
- **Selected summary** — Footer shows selected styles as removable tags; the trigger button shows a count badge.
- **Preferences** — Source choice and compact mode are saved in the browser (survive refresh).
- **Both tabs** — Separate state for txt2img and img2img; same behavior on both.
- **Smart tag deduplication** — When applying multiple styles, duplicate tags are automatically skipped. Works in both normal and silent mode.
- **Source-aware randomizer** — The 🎲 button respects the selected CSV source: if a specific file is selected, random picks only from that file.
- **Search clear button** — × button in the search field for quick clear.
- **Drag-and-drop prompt ordering** — Tags of selected styles in the footer can be dragged to change order. The prompt updates in real time; user text stays in place.
- **Category wildcard injection** — Right-click on a category header → "Add as wildcard to prompt" inserts all styles of the category as `__sg_CATEGORY__` into the prompt. Compatible with Dynamic Prompts.

---

## User guide

### Opening the grid

1. Find the **grid icon button** (⊞) next to the other tools under the Generate button (txt2img or img2img).
2. Click it to open the **Style Grid** modal over the page.

<img width="342" height="214" alt="{2B661361-44A2-41D4-A150-C50683B35F1F}" src="https://github.com/user-attachments/assets/fccfbb2b-913d-4c5f-9f2f-b7e3bf952d8a" />


### Browsing and filtering

- **Categories** — Styles are grouped (e.g. BASE, BODY, ★ Favorites, 🕑 Recent). Click a category in the sidebar (or **All** / **★ Favorites** in the compact bar) to show only that group.
- **Source** — Use the dropdown to the left of the search bar: **All Sources** or a specific CSV file. Only styles from that source are shown.
- **Search** — Type in the search box to filter by style name. Search applies on top of the current source and category view.

<img width="1113" height="790" alt="{9F10AF51-46C8-441E-9830-0C838140C05A}" src="https://github.com/user-attachments/assets/2346aa16-113a-4ef2-8196-260ff87a8c46" />



### Selecting and applying styles

- **Click a card** to select and apply it instantly — the style's prompt is added to your prompt fields immediately. Click again to deselect and remove.
- **Select All** on a category header to select or clear all styles in that category.
- **Star (★)** on a card to add or remove it from **★ Favorites**; the Favorites block updates at once.
- **Silent mode** — When `👁 Silent` is active, clicking a card selects it, but prompts are not modified visually. Styles are injected during generation and appear in image metadata.
- You can reorder applied styles by dragging their tags in the Selected footer. The prompt field updates to reflect the new order.

<img width="1110" height="776" alt="{7E6AFE9D-ED25-4B17-8AA1-13CC2CEF3528}" src="https://github.com/user-attachments/assets/f0a8a0d8-564b-4a38-b97a-651d0c2a42c8" />
<img width="921" height="743" alt="{6512EE52-164C-410A-9A19-99EFC3556F05}" src="https://github.com/user-attachments/assets/fb075df3-d3cd-4a10-b36f-f2e2d61da162" />



### Prompt behavior

- Styles without `{prompt}` have their prompt **appended** (comma-separated).
- Styles with `{prompt}` **wrap** your existing prompt (e.g. `masterpiece, {prompt}, highres` inserts your text in place of `{prompt}`). These are marked with a ⟳ icon on the card.

<img width="1082" height="760" alt="{610B4A33-E625-4EF2-A5B9-1F52872855E5}" src="https://github.com/user-attachments/assets/4e020754-0cb4-4140-beb9-a54e8366be0d" />
<img width="1888" height="249" alt="{D3D3176B-838E-4F55-8ED9-381884BD63F5}" src="https://github.com/user-attachments/assets/9c1bbc39-fb7a-45f5-bb99-4b106e3f4904" />



### Header toolbar

| Button | Function |
|--------|----------|
| `👁 Silent` | Toggle silent mode (styles applied at generation time only) |
| `🎲` | Apply a random style |
| `📦` | Presets — save/load/delete style combinations |
| `↕` | Collapse/expand all categories |
| `▪` | Toggle compact mode (saved in browser) |
| `🔄` | Refresh styles from CSV files |
| `➕` | Create a new style |
| `📥` | Import/Export styles as JSON |
| `💾` | Manual backup of all CSV files |
| `Clear` | Deselect and unapply all styles |
| `✕` | Close the Style Grid |

---

## Style CSV format and categories

Use the standard Forge/A1111 CSV format:

```csv
name,prompt,negative_prompt
BASE_Illustrious_Quality,"masterpiece, best quality, highres","lowres, bad anatomy"
STYLE_Watercolor,"watercolor painting, soft edges",""
myfile_My_Custom_Style,"custom prompt here",""
```

### How categories are chosen

| Rule | Example | Category |
|------|---------|----------|
| Name contains `_` | `BODY_Thicc` | **BODY** (uppercase before first `_`) |
| Name contains `-` (no `_`) | `sai-anime` | **sai** (before first `-`) |
| Else | `SomeStyle` | From CSV filename (e.g. **Styles_integrated**) |
| Fallback | — | **OTHER** |

Category colors are generated from the category name (no fixed palette).

---

## Data files

The extension stores its data in the `data/` folder:

| File | Contents |
|------|----------|
| `data/presets.json` | Saved style presets |
| `data/usage.json` | Per-style usage counters and timestamps |
| `data/backups/` | Timestamped CSV backups (up to 20) |

These files are gitignored and created automatically.

---

## Adding more styles

1. Use the CSV format above.
2. Put it in:
   - Forge root (next to `styles.csv`), or
   - The extension's **styles/** folder.
3. The grid auto-refreshes within 5 seconds, or click 🔄 to reload immediately.

You can also create styles directly from the grid using ➕ or right-click → Edit.

---

## Installation

### From URL (Forge Extensions tab)

1. **Extensions** → **Install from URL**
2. Paste the repository URL
3. **Install**, then restart the UI

### Manual

```bash
cd /path/to/stable-diffusion-webui-forge/extensions
git clone <this-repo-url>
```

Then restart the UI.

---

## Compatibility

- Stable Diffusion WebUI Forge (latest)
- Dark and light themes (panel, cards, search, source dropdown)
- txt2img and img2img

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Trigger button not visible | Enable the extension in the Extensions tab; do a full UI restart; check console for `[Style Grid]` messages. |
| Styles not loading | Ensure CSVs are in Forge root or the extension's `styles/` folder; check `name,prompt,negative_prompt` header and encoding (UTF-8). |
| Conflict warning wrong | The detector compares comma-separated tokens. Complex prompts with shared common words may trigger false positives. |
| Silent mode not working | Ensure the extension's `process()` hook is running — check that `Style Grid` appears in your image metadata after generation. |
| Drag-and-drop not working | Ensure you're dragging the style tags in the footer area (bottom of Style Grid panel), not the cards in the grid. |

---

## License

[AGPL-3.0](LICENSE) (GNU Affero General Public License v3.0)
