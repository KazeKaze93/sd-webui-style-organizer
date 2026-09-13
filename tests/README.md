# Tests

## Python (pytest)

From the repository root:

```bash
pip install pytest fastapi starlette httpx
python -m pytest tests/ -q
```

Root `npm test` / `npm run check` run this suite (not the UI Vitest suite).

| File | Scope |
|------|--------|
| `conftest.py` | `sys.path` + stub `modules.shared` for Forge-less imports; shared fixtures `tmp_csv`, `patch_styles_dirs`. The fixture name is historical — it patches **`get_all_styles_file_paths`** (csv_io / cache / routes), not the older `get_styles_dirs` entry point. |
| `test_csv_io.py` | `stylegrid.csv_io` parse / save / delete. |
| `test_routes.py` | FastAPI routes registered by `register_api` (HTTP smoke + save/delete flows). |
| `test_wildcards.py` | `parse_sg_token`, `select_slice`, `resolve_sg_wildcards` (`{sg:…}` and slice specs). |
| `test_slice_grammar_parity.py` | Parametrized assertions of `select_slice` against `fixtures/slice_grammar.json`. |
| `fixtures/slice_grammar.json` | Shared grammar fixture (Python + Vitest). Derived from `select_slice` + empty-pool fallback. |

## Manual JS helpers

Open `tests/test_js.html` in a browser (`file://`). It loads helpers from `javascript/sg_prompt_utils.js` (Forge also auto-injects that file) and includes brace-aware `splitTopLevelCommas` cases for slice tokens such as `{sg:cat:A,B}`. The same helper body must stay in sync with the copy inside `javascript/style_grid.js` — both files ship.

## UI (React / Vitest)

From `ui/`:

```bash
cd ui
npm test          # vitest run
npm run test:watch
```

| File | Scope |
|------|--------|
| `src/lib/wildcardSlice.test.ts` | Compact / resolve / chip-count unit tests for `wildcardSlice.ts`. |
| `src/lib/wildcardSlice.parity.test.ts` | Reads `tests/fixtures/slice_grammar.json` via `node:fs` and asserts `resolveSliceNames` matches Python. |

Typecheck app vs tests separately (`tsconfig.app.json` excludes `*.test.ts`; `tsconfig.test.json` includes Node types for the parity file):

```bash
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.test.json
```

From the repo root, `npm run lint` still runs `lint:ui` together with host JS and Python linters.

## CI

There is no GitHub Actions workflow in this repo; run pytest and `cd ui && npm test` locally before merging.
