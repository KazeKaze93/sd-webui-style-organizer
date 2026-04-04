# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `POST /style_grid/thumbnail/generate` accepts an optional `source` field in the JSON body (active CSV path string) so thumbnail generation picks the correct row when the same style `name` exists in more than one file; the host passes `state[tab].selectedSource` from `generateThumbnail`.
- CSV parse/load: optional `_source` field (basename, aligned with `source`) and tests for loading the same filename from different scan directories (`3488b64`).
- React iframe frontend (V2) integrated into Forge panel lifecycle (`dc5f544`, `589ca79`).
- Shadcn-based UI composition and component library (`ui/src/components/ui/*`) with typed frame bridge (`ui/src/bridge.ts`) (`dc5f544`, `e841334`).
- New V2 capabilities: favorites/recent, usage counters, conflict checks, toast notifications, thumbnail progress modal, random/backup/import-export actions (`3f042ba`, `5277f8f`, `c8c9c2b`, `9ffda9c`, `0641448`, `e98ab3b`).
- Category/source UX improvements: source filtering, persisted category ordering, and source-aware style dedup/source selection behavior (`e841334`, `6c2e8e4`, `af23d07`).
- Fullscreen/windowed interactions with outside-click handling and host scroll lock control (`930f6b6`, `fc9d9dc`, `72c77f2`).

### Changed
- **Thumbnails (HTTP):** `GET /style_grid/thumbnail` no longer branches on a `source` query parameter for file resolution. The handler tries `get_thumbnail_path(name)`, then unique `get_thumbnail_path(name, source_file)` candidates from `get_cached_styles()` for that name in **reverse** list order. `POST /style_grid/thumbnail/generate` accepts optional `source` in the JSON body for row disambiguation (see **Added**).
- **Forge script `process()` inputs:** `StyleGridScript.ui()` now returns only the hidden `style_grid_silent_*` textbox to the script runner; `process()` reads silent JSON from `args[0]` (wildcard expansion still runs first). `styles_data` / `selected_styles` / apply trigger remain in the DOM for the host script only (`a8819d6`).
- **CSV table editor:** **disabled** in the product UI (📋 inactive in React and host toolbars; EN/RU tooltips and native `title` explain temporary unavailability). Full implementation preserved as a **block comment** in `javascript/style_grid.js`; live `openCsvTableEditor` is a no-op stub. `SG_CSV_EDITOR` remains in `ui/src/bridge.ts` for typing; the host responds with an informational **`SG_TOAST`** instead of opening the overlay (legacy handler body left commented beside the active branch). Full-screen editor styles (`.sg-csv-*`, `.sg-csv-editor-btn-disabled`) live in `style.css` for future re-enable. *When previously enabled:* target CSV followed **`getStoredSource(tab)`**; **All Sources** was rejected; iframe-triggered open used the visible `style_grid_wrapper_*` tab (`c0dff77`, `62b083d`).
- **V2 iframe document cache:** host sets `frame.src` to `ui/dist/index.html?sgui=…` so users pick up rebuilt `ui/dist` after updating the extension without a stale `index.html` sticking in cache.
- **Host toolbar:** icon row vertical alignment; Style Grid trigger button placement follows the target control row structure (`c0dff77`, `6ad888e`).
- **DOM helper `qs`:** optional root element with `gradioApp()` fallback for Gradio-scoped queries (`d0c135b`).
- **Host → iframe:** `SG_HOST_TAB` updates the React store when the visible txt2img/img2img context changes so non-init style pushes keep the correct tab (`c0dff77`).
- **Styles merge (`load_all_styles`):** uniqueness when combining CSVs is `(absolute source_file, style name)` instead of `(basename, name)`, so two `styles.csv` in different folders no longer drop each other’s rows (`3488b64`).
- **V2 deduplication by name** applies only when **All sources** is active: shared helper `dedupeStylesByNameForAllSources` drives `filteredStyles` and search suggestions; a single selected CSV lists every row from that file (`3488b64`).
- **V2 host → iframe:** periodic refresh sends the full merged style list to the frame (no host-side name filter); `postSGInitToFrame` builds the initial list from API `categories` like other init paths (`3488b64`).
- V2 grid and search items use stable React keys from `source_file` + `name` so duplicate names within one CSV do not clash (`3488b64`).
- Production build artifacts under `ui/dist/` updated in-repo for the current V2 bundle (`8a38e31`).
- **V2 bundle:** `ui/dist/` rebuilt for conflict popover and conflict-list store fixes (PR #53, `51e19b8`).
- Style Grid host ↔ frame messaging flow refactored to SG_* postMessage contract and on-demand re-init/update pushes (`589ca79`, `e6276da`).
- Sidebar/category behavior refined for per-source ordering logic and All Sources fallback handling (`6c2e8e4`, `af23d07`).
- `docs/API.md` backend route definitions now originate from modular backend route registration (`stylegrid/routes.py` via `scripts/style_grid.py`) instead of monolithic script split assumptions.
- **Documentation:** README expanded (workflows, wildcards, search, fullscreen, img2img, testing; Quick Start / top-bar table / troubleshooting include the **disabled** CSV table editor); `docs/DEVELOPMENT.md` documents maintainer re-enable steps, `SG_CSV_EDITOR` toast behavior, and related host/React/CSS layout; `docs/screenshots/README.md` explains screenshot maintenance; PNG assets under `docs/screenshots/` refreshed for the current UI.
- **Documentation (paths + API):** References to backend modules now use the `stylegrid/` package layout (`stylegrid/routes.py`, `stylegrid/wildcards.py`). `docs/API.md` documents `GET /style_grid/thumbnail` resolution (legacy hash, then source-aware paths from the styles cache) and optional `source` on `POST /style_grid/thumbnail/generate`; iframe routing notes; limitations of `DELETE /style_grid/thumbnail`. `docs/DEVELOPMENT.md` covers `SG_SOURCE_CHANGE` / `SG_GENERATE_CATEGORY_PREVIEWS` and thumbnail behavior. `docs/CSV_FORMAT.md` adds thumbnail vs `source_file`. Root `README.md` and `ui/README.md` wildcards/API paths aligned.
- **Repo hygiene:** `.gitignore` extended for Python virtualenvs, caches, and coverage output (`2a9d7b8`).
- **V2 store:** restoring `activeSource` from persistence matches stored values against loaded sources via basename-aware `resolveSourceInList`; `setStyles` sends `SG_SOURCE_CHANGE` to the host only when a non-empty source is active.

### Removed
- **V2 style cards:** inline favorite star control removed from tiles — add/remove **Favorites** only via the **style card context menu** (right‑click), reducing clutter and freeing space for labels.

### Fixed
- **Silent mode (V2):** fixed generate-time styles sticking after manual deselect — `SG_UNAPPLY` now clears the same host `selected` set that feeds `style_grid_silent_*` for `process()`, and silent iframe apply keeps `selectedOrder` aligned. Turning silent off clears host silent-only entries and notifies iframes (`SG_CLEAR_SELECTION`); **iframe highlight/chips may still appear selected until interaction** — that is cosmetic; generation follows the cleared host silent input. Follow-up: cross-tab silent toggling, `setSilentGradio`, and `process()` arg indexing aligned with the reduced `ui()` return tuple (`19918f1`, `c8d41d2`, `a8819d6`).
- **Wildcard pass:** positive/negative strings default to empty when null before `{sg:…}` resolution (`d0c135b`).
- Selecting one source (CSV) no longer hides styles that only collide **by name** with another file: backend keeps both rows, and the V2 refresh path no longer re-deduplicates by name before `SG_STYLES_UPDATE` (`3488b64`).
- Improved iframe close/escape behavior and minimized accidental host/page interaction conflicts while V2 panel is open (`930f6b6`, `72c77f2`).
- Fixed several V2 synchronization issues after backend refresh/update flows (`e6276da`, `589ca79`).
- **Search autocomplete:** suggestions respect the active source filter (matches only the selected CSV when one is chosen). With **All Sources**, the list spans loaded styles and **dedupes by style name** like the grid (`b93de7a`, `3488b64`).
- **V2 style conflicts (PR #53, `51e19b8`):** clearing **all** selections or **deselecting an entire category** now resets or recomputes conflicts — `clearAll` also clears `conflicts`, and the bulk-unapply branch in `selectAllInCategory` calls `detectConflicts()` after `SG_UNAPPLY`.
- **V2 conflict popover (PR #53, `51e19b8`):** each row shows a **✕** control to remove the conflicting style (`styleB`) via `toggleStyle`, resolving the `Style` from `selectedStyles` first then the full `styles` list; the panel uses `max-w-[min(20rem,calc(100vw-2.5rem))]`, wrapped text (`min-w-0`, `break-words`), and `pt-1` instead of `mt-1` so the action stays visible and easier to reach under hover.
- **Thumbnails:** `GET /style_grid/thumbnail` serves the legacy name-only file when present, otherwise walks cached rows with the same `name` in reverse order and returns the first existing source-hashed file; preview URLs may still include `source` / `v` for client cache behavior, but path resolution is server-driven from the cached style list. Per-style **Generate preview (SD)** sends `source` in the **POST** body so generation targets the correct CSV row.
- **V2 ↔ host (source + batch previews):** category batch thumbnail jobs use the iframe-posted `source` and a fresh `/style_grid/styles` list filtered by category and source; `window` `message` handlers for txt2img/img2img only handle events from their own iframe (`e.source === frame.contentWindow`); redundant `SG_SOURCE_CHANGE` updates with the same path are skipped after the tab state exists.

### Security
- None.

## [5.0.0] - 2026-03-17

### Added
- Added smart deduplication in All Sources and source variant picker behavior (`a55c073`, `df7411a`).
- Added drag-and-drop category ordering with persistence to `data/category_order.json` (`c8cc8b5`, `0b29875`).
- Added per-category batch thumbnail generation with progress, skip, and cancel controls (`69e3f60`).
- Added persistent collapsed category state in the UI (`54b66dc`).
- Added extended export/import data handling for style fields (`1bf7864`).

### Changed
- Simplified search behavior to text matching and removed structured operators from active UI flow (`66e0e1d`, `962e430`).

### Fixed
- Improved source variant handling and selection behavior in deduplicated views (`fcb6520`).

### Removed
- None.

### Security
- None.

## [4.0.0] - 2026-03-09

### Added
- Added search autocomplete dropdown behavior for style discovery (`6c68f86`).
- Added thumbnail preview generation, upload, hover preview, and management flows (`dee2782`, `94eda49`, `ec9376f`).
- Added recommended combo parsing and combo chips from description metadata (`28604a4`).
- Added conflict detection and conflict suggestion handling for style tokens (`4ce223e`).
- Added server-side style caching with ETag support (`9b851ba`).
- Added CSV fields `description` and `category` support in style parsing and storage (`4d48c79`).

### Changed
- Improved UI modularity and readability in JavaScript structure and status messaging (`54d8bf0`).

### Fixed
- Fixed thumbnail generation reliability, caching, and error handling in repeated preview operations (`983d414`, `ff89603`, `d57a1cb`, `cf568c1`, `6210052`, `abde035`, `27ceb05`, `7e87b95`, `674c91b`).

### Removed
- None.

### Security
- Added CSV injection prevention when writing CSV cell values (`fd648cf`).
- Hardened style save/delete source-path handling by enforcing `.csv` extension normalization (`e0c78ab`).
- Reduced unsafe HTML assignment patterns in UI rendering paths (`74e973e`, `6003735`).

## [2.1.0] - 2026-02-25

### Added
- Added search clear button behavior (`62e9501`).
- Added source-aware random style selection (`0a51779`).
- Added category wildcard insertion from context menu (`ca4d8a1`).
- Added prompt/tag deduplication improvements for style application (`de4a9fd`).
- Added footer tag drag-and-drop ordering and prompt management improvements (`bbd15fc`).

### Changed
- Updated README to reflect the 2.1 feature set (`70a8cb2`).

### Fixed
- None.

### Removed
- None.

### Security
- None.

## [2.0.0] - 2026-02-20

### Added
- Added silent mode for applying styles at generation time (`5820add`, `6cc7ae6`).
- Added multi-source CSV loading and source switcher support (`2f85938`).
- Added sidebar categories, compact mode, favorites, and broader grid interaction refinements (`b3f8ded`, `151f154`).
- Added style toggle-off behavior for removing already applied styles (`fde52e7`).

### Changed
- Reworked UI away from Tailwind/React into vanilla modal + stylesheet integration (`7815403`).

### Fixed
- Fixed Gradio contract/timing issues around element injection and modal rendering (`eef45b6`).

### Removed
- Removed React/Tailwind frontend path from the active implementation (`7815403`).
- Removed the old `example_styles.csv` artifact from repository styles (`8fab29e`).

### Security
- None.

## [1.0.0] - 2026-02-14

### Added
- Created the initial project structure and extension scaffold (`2b8c25e`, `d571ba4`).
- Added early Style Grid UI and backend integration baseline (`a82679c`, `92755c2`, `0a4b111`).

### Changed
- Refactored repository organization and project layout (`ae1e041`).

### Fixed
- None.

### Removed
- None.

### Security
- None.
