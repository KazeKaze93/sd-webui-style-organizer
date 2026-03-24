# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- CSV parse/load: optional `_source` field (basename, aligned with `source`) and tests for loading the same filename from different scan directories (`3488b64`).
- React iframe frontend (V2) integrated into Forge panel lifecycle (`dc5f544`, `589ca79`).
- Shadcn-based UI composition and component library (`ui/src/components/ui/*`) with typed frame bridge (`ui/src/bridge.ts`) (`dc5f544`, `e841334`).
- New V2 capabilities: favorites/recent, usage counters, conflict checks, toast notifications, thumbnail progress modal, random/backup/import-export actions (`3f042ba`, `5277f8f`, `c8c9c2b`, `9ffda9c`, `0641448`, `e98ab3b`).
- Category/source UX improvements: source filtering, persisted category ordering, and source-aware style dedup/source selection behavior (`e841334`, `6c2e8e4`, `af23d07`).
- Fullscreen/windowed interactions with outside-click handling and host scroll lock control (`930f6b6`, `fc9d9dc`, `72c77f2`).

### Changed
- **Styles merge (`load_all_styles`):** uniqueness when combining CSVs is `(absolute source_file, style name)` instead of `(basename, name)`, so two `styles.csv` in different folders no longer drop each other’s rows (`3488b64`).
- **V2 deduplication by name** applies only when **All sources** is active: shared helper `dedupeStylesByNameForAllSources` drives `filteredStyles` and search suggestions; a single selected CSV lists every row from that file (`3488b64`).
- **V2 host → iframe:** periodic refresh sends the full merged style list to the frame (no host-side name filter); `postSGInitToFrame` builds the initial list from API `categories` like other init paths (`3488b64`).
- V2 grid and search items use stable React keys from `source_file` + `name` so duplicate names within one CSV do not clash (`3488b64`).
- Production build artifacts under `ui/dist/` updated in-repo for the current V2 bundle (`8a38e31`).
- Style Grid host ↔ frame messaging flow refactored to SG_* postMessage contract and on-demand re-init/update pushes (`589ca79`, `e6276da`).
- Sidebar/category behavior refined for per-source ordering logic and All Sources fallback handling (`6c2e8e4`, `af23d07`).
- `docs/API.md` backend route definitions now originate from modular backend route registration (`scripts/stylegrid/routes.py`) instead of monolithic script split assumptions.
- **Documentation:** README expanded (workflows, wildcards compatibility, search, fullscreen, img2img, testing notes); `docs/screenshots/README.md` explains screenshot maintenance; PNG assets under `docs/screenshots/` refreshed for the current UI (no tile stars, img2img, search autocomplete, fullscreen, etc.).
- **Repo hygiene:** `.gitignore` extended for Python virtualenvs, caches, and coverage output (`2a9d7b8`).

### Removed
- **V2 style cards:** inline favorite star control removed from tiles — add/remove **Favorites** only via the **style card context menu** (right‑click), reducing clutter and freeing space for labels.

### Fixed
- Selecting one source (CSV) no longer hides styles that only collide **by name** with another file: backend keeps both rows, and the V2 refresh path no longer re-deduplicates by name before `SG_STYLES_UPDATE` (`3488b64`).
- Improved iframe close/escape behavior and minimized accidental host/page interaction conflicts while V2 panel is open (`930f6b6`, `72c77f2`).
- Fixed several V2 synchronization issues after backend refresh/update flows (`e6276da`, `589ca79`).
- **Search autocomplete:** suggestions respect the active source filter (matches only the selected CSV when one is chosen). With **All Sources**, the list spans loaded styles and **dedupes by style name** like the grid (`b93de7a`, `3488b64`).

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
