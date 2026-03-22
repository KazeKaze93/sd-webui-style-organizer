# Development Guide

## Project Structure

Current tree in this worktree:

```text
.
├─ .gitignore                  # Ignore rules for repository-local generated files.
├─ LICENSE                     # AGPL-3.0 license text.
├─ README.md                   # User-facing documentation.
├─ install.py                  # Forge extension install hook.
├─ style.css                   # UI styles for Style Grid frontend.
├─ javascript/
│  └─ style_grid.js            # Main frontend logic (IIFE, UI rendering, API calls).
├─ scripts/
│  └─ style_grid.py            # Backend + Forge script entrypoint + API route registration.
├─ config/
│  └─ sources.json.example     # Example source config file (not loaded by current backend code).
└─ docs/
   ├─ API.md                   # Backend endpoint reference.
   ├─ CSV_FORMAT.md            # CSV format specification.
   └─ screenshots/
      └─ .gitkeep             # Keeps screenshots directory tracked.
```

Not present in this snapshot: `tests/`, `package.json`, `pyproject.toml`, `scripts/stylegrid/` package layout.

## Setup

### Python
- No virtualenv required (runs in Forge's Python).
- For tests: `pip install pytest httpx`.

### JavaScript
- `npm install` (installs eslint + globals).
- No build step for current version.

Note: `package.json` is not present in this worktree, so npm scripts are currently unavailable here.

## Running Tests

### Python tests
```bash
cd <extension root>
pytest tests/ -v
```

Expected output: `18 passed`.

Note: PytestConfigWarning from parent `pyproject.toml` is harmless.

Current snapshot note: `tests/` and `pyproject.toml` are not present in this worktree, so this command cannot run here as-is.

### JS tests
- Open `tests/test_js.html` in browser.
- Check console for `✓`/`✗` results.
- Limitation: functions are copied from source — keep in sync manually.

Current snapshot note: `tests/test_js.html` is not present in this worktree.

## Linting

| Command | Description |
|---|---|
| `npm run lint` | both linters |
| `npm run lint:py:fix` | auto-fix import sorting |
| `npm run check` | lint + pytest (run before commit) |

Current snapshot note: these scripts require a `package.json` with matching script entries.

## Architecture Overview

**Python package (`stylegrid/`)**  
Current branch does not yet contain a split `scripts/stylegrid/` package. Backend logic is centralized in `scripts/style_grid.py`, which currently owns CSV loading/saving, category derivation, wildcard resolution, thumbnail workflow, and API route registration.

**`routes.py`**  
A dedicated `routes.py` module is not present in this branch. FastAPI endpoints are currently defined inside `register_api()` in `scripts/style_grid.py`. Error signaling commonly uses JSON `{ "error": ... }` in HTTP 200 responses, with notable exceptions such as `304` (ETag match on `/style_grid/styles`) and `404` (`/style_grid/thumbnail` when file is missing).

**`style_grid.js`**  
Frontend is a single IIFE module (`javascript/style_grid.js`) organized by section headers (state/storage, utility, prompt engine, API layer, conflict detection, UI builders, interactions). Runtime state is tab-scoped via `state[tab]` (`txt2img`, `img2img`) and includes selected styles, order, applied map, categories, source filter, presets, usage, silent mode, and thumbnail flags.

**Bridge between Python and JS**  
JS communicates with backend via `fetch` to FastAPI routes (`/style_grid/...`) and polling endpoints for long-running operations (for example thumbnail generation status). Backend updates are delivered through route responses, while frontend periodically checks for style file changes using `/style_grid/check_update`.

## Known Constraints

- Forge loads JS from `javascript/` alphabetically.
- `dynamic import()` is not available without bundler.
- `sys.path.insert(0, ...)` is required in `style_grid.py` entry point.
- Gradio's `MutationObserver` fires on every DOM change — guard re-injection with `observer.disconnect()`.

Current snapshot note: the last three constraints describe the intended refactor/development rules; they are not all explicitly implemented in the current monolithic files.

## Planned: UI v2

Planned direction: migrate UI to an iframe + React + shadcn architecture, while keeping FastAPI backend endpoints as the integration boundary. Branch link: not created yet in this repository snapshot.
