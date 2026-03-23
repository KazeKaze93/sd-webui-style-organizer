# Screenshots for `README.md`

Images in this folder are referenced from the root **`README.md`**. After UI changes, replace files here and keep the **same filename** so links stay valid.

## When to refresh (current UI)

**Tiles no longer show a favorite star** — favorites are only toggled from the **style card context menu** (right‑click → Add/Remove Favorites). Any screenshot that still shows `★` on cards is outdated.

| Priority | File | What to capture |
|----------|------|-----------------|
| 1 | `browse-and-filter.png` | Main grid + sidebar + source dropdown — cards **without** stars. |
| 2 | `apply-and-reorder.png` | Selected styles + bottom bar with chips. |
| 3 | `favorites-in-category.png` | A normal category view; cards have **no** stars (favorites are in the sidebar filter / context menu only). |
| 4 | `favorites-view.png` | **Favorites** selected in the sidebar; grid of favorited styles. |
| 5 | `recent-styles.png` | **Recent** in the sidebar. |
| 6 | `img2img-support.png` | Style Grid open on **img2img** tab (if layout differs from txt2img). |
| 7 | `search-autocomplete.png` | Search with autocomplete dropdown open. |
| 8 | `thumbnail-hover-preview.png` | Hover popup with thumb + prompt snippet. |
| 9 | `fullscreen-mode.png` | Fullscreen toggle result — edge‑to‑edge panel. |

**Usually still valid** (no stars on tiles): `style-card-context-menu.png`, `category-context-wildcard-previews*.png`, `top-bar-icons.png` — re-shoot only if those UIs change.

---

**For maintainers:** ask the user to attach new PNGs when README text no longer matches what’s on screen; save under the names above and run `cd ui && npm run build` after code changes (not required for image-only updates).
