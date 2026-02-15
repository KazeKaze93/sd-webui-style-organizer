# 🎨 Style Grid — Visual Style Selector for Forge WebUI

A grid/gallery-based style selector extension for [Stable Diffusion WebUI Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge). Replaces the default dropdown with a searchable, categorized grid — multi-select, favorites, source filter, and one-click apply.

![UI](https://img.shields.io/badge/UI-Grid%20Selector-6366f1?style=flat-square)

---

## What it does

- **Visual grid** — Styles appear as cards in a categorized grid instead of a long dropdown.
- **Dynamic categories** — Grouping by name: `PREFIX_StyleName` → category **PREFIX**; `name-with-dash` → category from the part before the dash; otherwise from the CSV filename. Colors are generated from category names.
- **Favorites** — Star any style; a **★ Favorites** section at the top lists them. Favorites update immediately (no reload).
- **Source filter** — Dropdown to show **All Sources** or a single CSV file (e.g. `styles.csv`, `styles_integrated.csv`). Combines with search.
- **Search** — Filter by style name; works together with the source filter. Category names in the search box show only that category.
- **Category view** — Sidebar (when many categories): show **All**, **★ Favorites**, or one category. Compact **All / ★ Favorites** bar when there are few categories.
- **Multi-select** — Select several styles, then **✔ Apply** to merge their prompts into the main prompt and negative prompt.
- **Collapse / Expand** — Collapse or expand all category blocks. **Compact** mode for a denser layout.
- **Select All** — Per-category “Select All” to toggle the whole group.
- **Selected summary** — Footer shows selected styles as removable tags; the trigger button shows a count badge.
- **Preferences** — Source choice and compact mode are saved in the browser (survive refresh).
- **Both tabs** — Separate state for txt2img and img2img; same behavior on both.

---

## User guide

### Opening the grid

1. Find the **grid icon button** (⊞) next to the other tools under the Generate button (txt2img or img2img).
2. Click it to open the **Style Grid** modal over the page.

<img width="342" height="214" alt="{2B661361-44A2-41D4-A150-C50683B35F1F}" src="https://github.com/user-attachments/assets/fccfbb2b-913d-4c5f-9f2f-b7e3bf952d8a" />


### Browsing and filtering

- **Categories** — Styles are grouped (e.g. BASE, BODY, ★ Favorites). Click a category in the sidebar (or **All** / **★ Favorites** in the compact bar) to show only that group.
- **Source** — Use the dropdown to the left of the search bar: **All Sources** or a specific CSV file. Only styles from that source are shown.
- **Search** — Type in the search box to filter by style name. Search applies on top of the current source and category view.

<img width="1113" height="790" alt="{9F10AF51-46C8-441E-9830-0C838140C05A}" src="https://github.com/user-attachments/assets/2346aa16-113a-4ef2-8196-260ff87a8c46" />



### Selecting styles

- **Click a card** to select it (border highlight). Click again to deselect.
- **Select All** on a category header to select or clear all styles in that category.
- **Star (★)** on a card to add or remove it from **★ Favorites**; the Favorites block updates at once.

<img width="1110" height="776" alt="{7E6AFE9D-ED25-4B17-8AA1-13CC2CEF3528}" src="https://github.com/user-attachments/assets/f0a8a0d8-564b-4a38-b97a-651d0c2a42c8" />
<img width="921" height="743" alt="{6512EE52-164C-410A-9A19-99EFC3556F05}" src="https://github.com/user-attachments/assets/fb075df3-d3cd-4a10-b36f-f2e2d61da162" />



### Applying to prompt

1. Select one or more styles.
2. Click **✔ Apply** — their prompts are appended to your current prompt and negative prompt (placeholders like `{prompt}` are replaced as in Forge).
3. The modal can stay open for more selections, or close it with **Escape** or by clicking the dark backdrop.

<img width="1082" height="760" alt="{610B4A33-E625-4EF2-A5B9-1F52872855E5}" src="https://github.com/user-attachments/assets/4e020754-0cb4-4140-beb9-a54e8366be0d" />
<img width="1888" height="249" alt="{D3D3176B-838E-4F55-8ED9-381884BD63F5}" src="https://github.com/user-attachments/assets/9c1bbc39-fb7a-45f5-bb99-4b106e3f4904" />



### Other controls

- **Collapse all / Expand all** — Fold or unfold every category block.
- **Compact** — Toggle a denser layout (saved in the browser).
- **Clear** — Deselect all styles.
- **✕** — Close the Style Grid.

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

Category colors are generated from the category name (no fixed palette). Styles inside each category are sorted alphabetically.

---

## Adding more styles

1. Use the format above in a `.csv` file.
2. Put it in:
   - Forge root (next to `styles.csv`), or  
   - The extension’s **styles/** folder (see repo; contents are typically gitignored).
3. Restart the UI or reopen the Style Grid to load new or changed files.

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
|-------|----------------|
| Trigger button not visible | Enable the extension in the Extensions tab; do a full UI restart; check console for `[Style Grid]` messages. |
| Styles not loading | Ensure CSVs are in Forge root or the extension’s `styles/` folder; check `name,prompt,negative_prompt` header and encoding (UTF-8). |
| Dropdown or list hard to read | Use the latest version (custom dropdown with theme-aware colors). Clear cache or hard-refresh the page. |

---

## License

[AGPL-3.0](LICENSE) (GNU Affero General Public License v3.0)
