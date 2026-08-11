# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Name+source identity (PR #67):** favorites, recent, presets, thumbnail files, conflict detection, silent Gradio payloads, and V2 bridge applies all key styles by **`name` + `source_file`** (composite / dual-format). Legacy bare-name favorites/recent/presets are migrated or dual-read on load. `SG_APPLY`, `SG_GENERATE_PREVIEW`, `SG_UPLOAD_PREVIEW`, and `SG_THUMB_DONE` require CSV identity (`source_file` / `source`).
- **Thumbnail job queue:** `ThumbnailGenerationManager` serializes SD preview generation through a FIFO single worker; `POST /thumbnail/generate` returns `job_id`, status is polled by `GET /thumbnail/gen_status?job_id=…`, and `POST /thumbnail/cancel` cancels queued/running jobs. Uploads are converted to real WebP via Pillow before atomic write.
- **Read-only samples pack:** `is_samples_source()`; `POST /style/save` and `POST /style/delete` return **403** when the resolved CSV is under `samples/`. Basename resolve prefers writable paths (`DATA_DIR`, then non-samples) over the demo pack.
- **Import name collisions:** `POST /import` rejects style imports whose names already exist in the non-LoRA library (**400** + `collisions`); the host surfaces the error (including colliding names). Already documented in `docs/API.md`.
- **LoRA as styles:** `stylegrid/lora_scan.py` scans `.safetensors` / `.pt` / `.ckpt` under auto-detected Forge/A1111 LoRA directories plus optional **`config/lora_roots.json`** (gitignored; see `config/lora_roots.json.example`). Roots are merged and deduplicated by **realpath** (junction/symlink-safe). Scan is fully recursive unless `max_depth` is set. Synthetic style rows use `source_file` / source marker `__style_grid_lora__`, apply as `<lora:stem:weight>` (+ activation text from sibling `.json`), and appear under the **🧬 LoRA** sidebar view grouped by relative folder. Previews are sibling image files only (never generated). `get_cached_styles()` appends scanned LoRAs after CSV styles. Read-only: UI hides mutate menu actions; `save_style_to_csv` / `delete_style_from_csv` reject `LORA_SOURCE`.
- **LoRA API:** `POST /style_grid/lora/rescan`, `GET /style_grid/lora/status`, `POST /style_grid/lora/fetch_titles`, `GET /style_grid/lora/fetch_titles/status`. `GET /style_grid/styles` ETag includes `lora_scan_status()` alongside CSV hashes. `GET /style_grid/thumbnail` serves LoRA sibling previews when `source` is `__style_grid_lora__` or `name` starts with `LORA_`; upload/generate endpoints refuse LoRA rows.
- **CivitAI titles (opt-in):** `stylegrid/lora_titles.py` fetches model names from `https://civitai.com/api/v1/models/{modelId}` only when the user clicks **🌐** in the LoRA view. Cache: `data/lora_titles.json`. Sequential requests (`MAX_WORKERS=1`), 1.5s throttle, HTTP 429 retries with `Retry-After` / backoff; error-only cache entries are retried on the next manual run. Successful titles set `display_name` (preserved by `categorize_styles`). Optional Bearer key from `opts.custom_api_key` when present.
- **V2 iframe entry:** `GET /style_grid/ui` (FastAPI in `stylegrid/routes.py`) serves `ui/dist/index.html`. Helper **`_get_ui_html()`** rewrites **every** relative asset URL (`src` / `href` with a `./…` path — scripts, stylesheets, favicon, etc.) to Gradio `/file=extensions/sd-webui-style-organizer/ui/dist/…` with a **fresh** cache-busting `?v=<unix time>` on **each** response so browser caches cannot serve stale chunks after rebuilds. The host sets the iframe `src` to `/style_grid/ui?t=<timestamp>` so the HTML document request stays busted as well.
- **Sidebar Presets (V2):** the **Presets** category in the React grid uses the same **`StyleCard`** tiles as style rows; click sends **`SG_LOAD_PRESET`** to the host. **`ThumbnailPreview`** accepts optional **`presetName`** and skips the hover thumbnail popup for those cards.
- CSV parse/load: optional `_source` field (basename, aligned with `source`) and tests for loading the same filename from different scan directories (`3488b64`).
- React iframe frontend (V2) integrated into Forge panel lifecycle (`dc5f544`, `589ca79`).
- Shadcn-based UI composition and component library (`ui/src/components/ui/*`) with typed frame bridge (`ui/src/bridge.ts`) (`dc5f544`, `e841334`).
- New V2 capabilities: favorites/recent, usage counters, conflict checks, toast notifications, thumbnail progress modal, random/backup/import-export actions (`3f042ba`, `5277f8f`, `c8c9c2b`, `9ffda9c`, `0641448`, `e98ab3b`).
- Category/source UX improvements: source filtering, persisted category ordering, and source-aware style dedup/source selection behavior (`e841334`, `6c2e8e4`, `af23d07`).
- Fullscreen/windowed interactions with outside-click handling and host scroll lock control (`930f6b6`, `fc9d9dc`, `72c77f2`).

### Changed
- **Thumbnails (PR #67):** on-disk files and HTTP routes require **name + source**; legacy name-only hash resolution on GET is removed. `GET /thumbnails/list` returns `{name, source_file}` entries. `GET` / upload / generate / delete all require `source` for CSV styles (**400** if missing). Host + V2 pass style `source_file` on preview messages; `SG_THUMB_DONE` matches cards by name+source.
- **CSV save:** upsert updates **all** same-name rows in the target file (not first-match only). `source_file` paths are normalized to forward-slash abspaths for cross-platform host/JS matching.
- **Presets / silent mode:** preset `styles` normalize to `{name, source_file}` on load/save (disk rewrite only on save). Silent Gradio payload carries the same dual format, ordered by `selectedOrder`; `{sg:…}` wildcards resolve inside silently injected style text. Turning silent **on** converts live applies to silent records; reorder rebuilds from additive/wrap records (including wrap templates) without duplicating prompts.
- **Clear / silent / tab identity:** Clear restores `userPromptBase` / `userPromptBaseNeg` instead of wiping textareas. Every `SG_INIT` includes `silentMode`; V2 hydrates without echoing. Iframe tab identity follows `SG_INIT` only (`SG_HOST_TAB` no longer overwrites per-frame tab). V2 active source persists per tab (`sg_v2_last_source_*`) and always notifies the host (including All Sources).
- **Backup:** zip/folder members use collision-safe relative arcnames so same-basename CSVs from `styles/`, `samples/`, and external WebUI paths do not overwrite each other.
- **Usage:** `increment_usage` is serialized with a `threading.Lock`; silent `process()` increments from successfully resolved style names; V2 live-apply POST payload / reload parsing fixed.
- **Conflict detection (V2 + API):** exact-set token membership (aligned with server/V1); request entries accept bare names or `{name, source_file}`; recomputed after select-all and host-driven `SG_STYLE_APPLIED`.
- **Delete style:** missing CSV row → **404**; omit-source delete that only matches a LoRA raises the same read-only `ValueError` as an explicit LoRA source (**400**). Context menu **Remove preview image** restored with name+source identity.
- **Documentation (PR #67):** README / `docs/API.md` / `docs/DEVELOPMENT.md` / `docs/CSV_FORMAT.md` / `ui/README.md` updated for required thumbnail `source`, job_id queue, samples 403, import collisions, and name+source bridge/presets.
- **V2 React performance (store):** **`selectFilteredStyles(...)`** is a **standalone exported function** in `ui/src/store/stylesStore.ts` (pure filter/dedupe logic). **`StyleGrid`** and **`Sidebar`** use Zustand **`useShallow`** so they do not re-render on unrelated store updates (e.g. selection, toasts, conflicts). **`StyleGrid`** memoizes the filtered style list with **`useMemo`** from subscribed fields.
- **V2 iframe document cache (follow-up):** the floating panel iframe no longer uses `/file=…/ui/dist/index.html` directly; it uses **`/style_grid/ui`** (see **Added**). Older changelog notes about `index.html?sgui=…` refer to the previous host `src` pattern.
- **SG_LOAD_PRESET (host):** if the requested preset is not yet present in `state[tab].presets`, the message handler **`fetch`es `/style_grid/presets/list`**, assigns the result to host state, then runs the same **`loadPreset`** as the modal **Load** button.
- **Forge script `process()` inputs:** `StyleGridScript.ui()` passes hidden `style_grid_silent_*` and `style_grid_source_*` textboxes to the script runner; `process()` reads silent JSON from `args[0]` and active source filter from `args[1]` (wildcard expansion still runs first and respects selected source when present). `styles_data` / `selected_styles` / apply trigger remain in the DOM for the host script only (`a8819d6`).
- **CSV table editor:** **disabled** in the product UI (📋 inactive in React and host toolbars; EN/RU tooltips and native `title` explain temporary unavailability). Full implementation preserved as a **block comment** in `javascript/style_grid.js`; live `openCsvTableEditor` is a no-op stub. `SG_CSV_EDITOR` remains in `ui/src/bridge.ts` for typing; the host responds with an informational **`SG_TOAST`** instead of opening the overlay (legacy handler body left commented beside the active branch). Full-screen editor styles (`.sg-csv-*`, `.sg-csv-editor-btn-disabled`) live in `style.css` for future re-enable. *When previously enabled:* target CSV followed **`getStoredSource(tab)`**; **All Sources** was rejected; iframe-triggered open used the visible `style_grid_wrapper_*` tab (`c0dff77`, `62b083d`).
- **Host toolbar:** icon row vertical alignment; Style Grid trigger button placement follows the target control row structure (`c0dff77`, `6ad888e`).
- **DOM helper `qs`:** optional root element with `gradioApp()` fallback for Gradio-scoped queries (`d0c135b`).
- **Host → iframe:** `SG_HOST_TAB` updates the React store when the visible txt2img/img2img context changes so non-init style pushes keep the correct tab (`c0dff77`).
- **Styles merge (`load_all_styles`):** uniqueness when combining CSVs is `(absolute source_file, style name)` instead of `(basename, name)`, so two `styles.csv` in different folders no longer drop each other’s rows (`3488b64`).
- **V2 deduplication by name** applies only when **All sources** is active: shared helper `dedupeStylesByNameForAllSources` drives **`selectFilteredStyles`** (grid) and search suggestions; a single selected CSV lists every row from that file (`3488b64`).
- **V2 host → iframe:** periodic refresh sends the full merged style list to the frame (no host-side name filter); `postSGInitToFrame` builds the initial list from API `categories` like other init paths (`3488b64`).
- V2 grid and search items use stable React keys from `source_file` + `name` so duplicate names within one CSV do not clash (`3488b64`).
- Production build artifacts under `ui/dist/` updated in-repo for the current V2 bundle (`8a38e31`).
- **V2 bundle:** `ui/dist/` rebuilt for conflict popover and conflict-list store fixes (PR #53, `51e19b8`).
- Style Grid host ↔ frame messaging flow refactored to SG_* postMessage contract and on-demand re-init/update pushes (`589ca79`, `e6276da`).
- Sidebar/category behavior refined for per-source ordering logic and All Sources fallback handling (`6c2e8e4`, `af23d07`).
- `docs/API.md` backend route definitions now originate from modular backend route registration (`stylegrid/routes.py` via `scripts/style_grid.py`) instead of monolithic script split assumptions.
- **Documentation:** README expanded (workflows, wildcards, search, fullscreen, img2img, testing; Quick Start / top-bar table / troubleshooting include the **disabled** CSV table editor); top-bar **Presets** / **Backup** rows note iframe sync and backup toasts; `docs/API.md` § `POST /backup` documents `ok` / `error` and skipped missing files; `docs/DEVELOPMENT.md` adds outside-click exclusions, `SG_BACKUP`, preset Load, and `SG_APPLY` host `selected` state; maintainer re-enable steps for CSV editor, `SG_CSV_EDITOR` toast, screenshots checklist (`docs/screenshots/README.md`); PNG assets under `docs/screenshots/` refreshed for the current UI.
- **Documentation (paths + API):** References to backend modules now use the `stylegrid/` package layout (`stylegrid/routes.py`, `stylegrid/wildcards.py`). Iframe routing notes and thumbnail/`source_file` docs live in `docs/API.md` / `docs/DEVELOPMENT.md` / `docs/CSV_FORMAT.md` (superseded again by **Documentation (PR #67)** above). Root `README.md` and `ui/README.md` wildcards/API paths aligned.
- **Documentation (V2 follow-up):** `README.md`, `ui/README.md`, `docs/API.md` § **GET `/ui`**, and `docs/DEVELOPMENT.md` updated for **`_get_ui_html()`** (per-request `?v=` on all relative assets), exported **`selectFilteredStyles`**, and **`useShallow`** in **StyleGrid** / **Sidebar**; dedupe changelog line now names **`selectFilteredStyles`** instead of the removed store method.
- **Repo hygiene:** `.gitignore` extended for Python virtualenvs, caches, and coverage output (`2a9d7b8`).
- **V2 store (pre–PR #67):** restoring `activeSource` from persistence matches stored values against loaded sources via basename-aware `resolveSourceInList`. **PR #67:** `setStyles` always notifies the host via `SG_SOURCE_CHANGE` (including All Sources / empty) so Gradio clears stale paths; see **Changed** name+source / tab persistence above.

### Removed
- **V2 style cards:** inline favorite star control removed from tiles — add/remove **Favorites** only via the **style card context menu** (right‑click), reducing clutter and freeing space for labels.

### Fixed
- **Discovery / paths (PR #67):** `get_all_styles_file_paths` scans `styles/` when the directory exists (no longer inverted); wildcard source filter in `process()` normalizes Gradio/JS paths against `source_file` so Windows slash mismatches no longer fall back to the full pool.
- **Search (V2):** `matchesSearch` / `matchesNameSearch` replace plain name substring matching — whitespace-separated tokens must all match (AND). Full search includes description after stripping `Combos:` / `Conflicts:` blocks (`COMBOS_CONFLICTS_RE`). Autocomplete uses name-only matching. **Favorites**, **Recent**, and **presets** branches in `selectFilteredStyles` now apply `matchesSearch`, honor `activeSource` via `bySource`, and Favorites dedupes under All Sources like the main grid.
- **Style Grid panel (host):** capture-phase `mousedown` outside the floating frame no longer closes the panel when the user interacts with **host-spawned** UI (e.g. style editor / source picker) — clicks on `.sg-editor-overlay` or `.sg-source-picker` are ignored for auto-close.
- **Backup (`POST /style_grid/backup`):** server wraps `backup_csv_files()` in `try`/`except` and returns JSON `{ "error": "…" }` instead of an unhandled 500; `backup_csv_files()` skips paths that are not existing files (avoids crashes when a listed CSV is missing). Host `SG_BACKUP` fetch treats non-OK HTTP, JSON parse failures, and `{ ok: false }` / `{ error }` with toasts (including “Nothing to backup” when no CSV was copied).
- **Presets (host selection vs save):** `SG_APPLY` in non-silent mode no longer clears `state[tab].selected` to an empty set — it adds the applied style like silent mode, so **Save preset** records the real selection; `SG_UNAPPLY` removes the style from `selected` / `selectedOrder`. **Load preset** clears the iframe selection (`SG_CLEAR_SELECTION`) then posts `SG_STYLE_APPLIED` per loaded name so the **V2 selected bar** stays in sync.
- **Silent mode (V2):** fixed generate-time styles sticking after manual deselect — `SG_UNAPPLY` now clears the same host `selected` set that feeds `style_grid_silent_*` for `process()`, and silent iframe apply keeps `selectedOrder` aligned. Turning silent off clears host silent-only entries and notifies iframes (`SG_CLEAR_SELECTION`); **iframe highlight/chips may still appear selected until interaction** — that is cosmetic; generation follows the cleared host silent input. Follow-up: cross-tab silent toggling, `setSilentGradio`, and `process()` arg indexing aligned with the reduced `ui()` return tuple (`19918f1`, `c8d41d2`, `a8819d6`).
- **Wildcard pass:** positive/negative strings default to empty when null before `{sg:…}` resolution (`d0c135b`).
- Selecting one source (CSV) no longer hides styles that only collide **by name** with another file: backend keeps both rows, and the V2 refresh path no longer re-deduplicates by name before `SG_STYLES_UPDATE` (`3488b64`).
- Improved iframe close/escape behavior and minimized accidental host/page interaction conflicts while V2 panel is open (`930f6b6`, `72c77f2`).
- Fixed several V2 synchronization issues after backend refresh/update flows (`e6276da`, `589ca79`).
- **Search autocomplete:** suggestions respect the active source filter (matches only the selected CSV when one is chosen). With **All Sources**, the list spans loaded styles and **dedupes by style name** like the grid (`b93de7a`, `3488b64`).
- **V2 style conflicts (PR #53, `51e19b8`):** clearing **all** selections or **deselecting an entire category** now resets or recomputes conflicts — `clearAll` also clears `conflicts`, and the bulk-unapply branch in `selectAllInCategory` calls `detectConflicts()` after `SG_UNAPPLY`.
- **V2 conflict popover (PR #53, `51e19b8`):** each row shows a **✕** control to remove the conflicting style (`styleB`) via `toggleStyle`, resolving the `Style` from `selectedStyles` first then the full `styles` list; the panel uses `max-w-[min(20rem,calc(100vw-2.5rem))]`, wrapped text (`min-w-0`, `break-words`), and `pt-1` instead of `mt-1` so the action stays visible and easier to reach under hover.
- **V2 ↔ host (source + batch previews):** category batch thumbnail jobs use the iframe-posted `source` and a fresh `/style_grid/styles` list filtered by category and source; `window` `message` handlers for txt2img/img2img only handle events from their own iframe (`e.source === frame.contentWindow`); redundant `SG_SOURCE_CHANGE` updates with the same path are skipped after the tab state exists. Thumbnail GET/generate/upload/delete identity is name+source (see **Changed** PR #67).

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
