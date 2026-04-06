# Style Grid UI (V2)

React + TypeScript + Vite frontend loaded by Forge inside an iframe.

## Commands

```bash
cd ui
npm install
npm run build
```

`npm run build` outputs `ui/dist/`. The Forge host loads the UI with **`GET /style_grid/ui?t=<timestamp>`** (FastAPI in `stylegrid/routes.py`): that handler reads `ui/dist/index.html` and rewrites asset URLs to Gradio **`/file=extensions/sd-webui-style-organizer/ui/dist/assets/...`** with cache-busting query params. The host script sets the iframe `src` in `javascript/style_grid.js`.

## Key Files

- `src/App.tsx`: top-level layout and toolbar actions.
- `src/store/stylesStore.ts`: state, filters, category order, style toggling.
- `src/bridge.ts`: typed SG_* postMessage contract with host.
- `src/components/StyleGrid.tsx`: main grid; sidebar **Presets** view renders preset names with `StyleCard` (`presetName` + `SG_LOAD_PRESET`).
- `src/components/StyleCard.tsx` / `ThumbnailPreview.tsx`: style tiles; optional `presetName` disables context menu, usage chip, and hover thumbnail preview.
- `src/components/*`: other UI (sidebar, modals, etc.).

## Integration Flow

```mermaid
flowchart LR
  H[javascript/style_grid.js] <-->|SG_* postMessage| UI[src/App.tsx]
  H -->|fetch /style_grid/*| API[stylegrid/routes.py]
```

Thumbnail **images** use `GET /style_grid/thumbnail?name=…` (server resolves paths from the cached style list; see `docs/API.md`). **SD preview generation** from the host uses `POST /style_grid/thumbnail/generate` with optional JSON `source` when a specific CSV row must be targeted.
