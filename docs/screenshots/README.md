# Screenshots for `README.md`

Images in this folder are referenced from the root **`README.md`**. After UI changes, replace files here and keep the **same filename** so links stay valid.

## When to refresh (current UI)

Favorites are toggled from the **style card context menu** (not a star on the tile). Re-shoot when the chrome in the table no longer matches the live panel.

| Priority | File | What to capture |
|----------|------|-----------------|
| 1 | `browse-and-filter.png` | Main grid + sidebar + source dropdown. |
| 2 | `apply-and-reorder.png` | Selected styles + bottom bar with chips. |
| 3 | `favorites-in-category.png` | A normal category view (favorites via sidebar / context menu only). |
| 4 | `favorites-view.png` | **Favorites** selected in the sidebar; grid of favorited styles. |
| 5 | `recent-styles.png` | **Recent** in the sidebar. |
| 6 | `img2img-support.png` | Style Grid open on **img2img** tab (if layout differs from txt2img). |
| 7 | `search-autocomplete.png` | Search with autocomplete dropdown open. |
| 8 | `thumbnail-hover-preview.png` | Hover popup with thumb + prompt snippet (CSV thumbs are name+source; generate/upload require `source`). |
| 9 | `fullscreen-mode.png` | Fullscreen toggle result — edge‑to‑edge panel. |
| 10 | `lora-view.png` | **🧬 LoRA** selected in the sidebar; grid grouped by LoRA sub-folder with `display_name` titles (and 🌐 in the top bar when in this view). |
| 11 | `lora-fetch-titles.png` | Hover tooltip on the **🌐** “Fetch LoRA titles from CivitAI” toolbar button (LoRA view only). |
| 12 | `slice-selection-mode.png` | Slice mode bar + per-card checkboxes. |
| 13 | `wildcard-slice-chips.png` | Wildcard chips including a slice chip label. |

`style-card-context-menu.png`, `category-context-wildcard-previews.png`, `top-bar-icons.png` — re-shoot only when those UIs change. Orphan/`cards-star-alignment.png` is not referenced by `README.md`.

- **TODO — silent mode removed:** every shot that includes the top bar still shows the 👁 silent-mode button, which no longer exists. Re-shoot `top-bar-icons.png` first, then the full-panel shots (`browse-and-filter.png`, `apply-and-reorder.png`, `search-autocomplete.png`, `favorites-*.png`, `recent-styles.png`, `lora-*.png`, `fullscreen-mode.png`, `img2img-support.png`, `slice-selection-mode.png`, `wildcard-slice-chips.png`).

---

**For maintainers:** ask the user to attach new PNGs when README text no longer matches what’s on screen; save under the names above and run `cd ui && npm run build` after code changes (not required for image-only updates).
