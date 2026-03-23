# Tests

## Python (pytest)

From the repository root:

```bash
pip install pytest fastapi starlette httpx
python -m pytest tests/ -q
```

| File | Scope |
|------|--------|
| `conftest.py` | `sys.path` + stub `modules.shared` for Forge-less imports; shared fixtures `tmp_csv`, `patch_styles_dirs`. |
| `test_csv_io.py` | `stylegrid.csv_io` parse / save / delete. |
| `test_routes.py` | FastAPI routes registered by `register_api` (HTTP smoke + save/delete flows). |
| `test_wildcards.py` | `resolve_sg_wildcards` (`{sg:…}` tokens). |

## Manual JS helpers

Open `tests/test_js.html` in a browser (`file://`). It exercises helpers from `javascript/sg_prompt_utils.js` (and a small copy from `style_grid.js`). No npm build.

## UI (React)

`ui/package.json` defines `lint` only — there is **no** automated unit/component test suite for the V2 iframe UI yet. From the repo root, `npm run lint` runs `lint:ui` (`npm --prefix ui run lint`) together with host JS and Python linters.

## CI

There is no GitHub Actions workflow in this repo; run pytest locally before merging backend changes.
