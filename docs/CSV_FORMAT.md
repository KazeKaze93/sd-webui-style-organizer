# CSV Format Specification

## File Location

CSV discovery and save behavior are implemented in `stylegrid/config.py` + `stylegrid/csv_io.py`:

| Aspect | Behavior in code |
|---|---|
| Read paths (`get_all_styles_file_paths`) | 1) `<extension_root>/styles/*.csv` (if the directory exists) 2) `<extension_root>/samples/*.csv` (demo pack; **read-only** for save/delete) 3) Forge `shared.prompt_styles.all_styles_files` 4) `*.csv` in the WebUI cwd. |
| Parent dirs (`get_styles_dirs`) | Extension `styles/` plus unique parents from Forge’s `all_styles_files` list. |
| Duplicate key handling during load | Dedup key is `(absolute source_file, style_name)`; first seen entry wins within a merge. |
| Save target selection | Basename resolve via `_resolve_target_csv_path`: prefer paths under `DATA_DIR`, then any non-`samples/` match, then samples (reads only; routes refuse writes). If none found, create under `<extension_root>/styles`. |
| `source` API param normalization | Basename only for resolve; `.csv` extension auto-appended if missing. Loaded rows expose `source_file` as forward-slash **abspath**. |
| Read-only samples | `is_samples_source(path)`; `POST /style/save` and `POST /style/delete` return **403** for CSVs under `samples/`. |

### `sources.json` config

No `sources.json` reader is present in the current codebase. Source lists are derived from loaded style rows (`style.source` / `source_file`) in the host and V2 UI.

## Column Reference

Parser and writer logic come from `parse_styles_csv` and `save_style_to_csv` in `stylegrid/csv_io.py`.

| Column | Required | Max length | Description | Example |
|---|---|---|---|---|
| `name` | Yes (for loading) | Not enforced in code | Primary style identifier. Parsed as `row[0].strip()`. Rows with empty `name` are skipped. Save API also rejects empty name. | `BODY_Furry` |
| `prompt` | No | Not enforced in code | Positive prompt fragment. Parsed as `row[1].strip()` if present, otherwise `""`. | `masterpiece, highres` |
| `negative_prompt` | No | Not enforced in code | Negative prompt fragment. Parsed as `row[2].strip()` if present, otherwise `""`. | `lowres, blurry` |
| `description` | No | Not enforced in code | Free text used for combo/conflict chips parsing in UI. Parsed as `row[3].strip()` if present, otherwise `""`. | `Painterly look. Combos: LIGHTING_SOFT; COLOR_PASTEL.` |
| `category` | No | Not enforced in code | Explicit category override (`category_explicit`). Parsed as `row[4].strip()` if present, otherwise `""`. If empty, category is derived from name/filename rules. | `BODY` |

### Parsing and sanitization details

| Rule | Behavior |
|---|---|
| Encoding | CSV is read with `utf-8-sig` (BOM-safe). |
| Blank lines | Completely empty rows are ignored. |
| Header handling | If first non-empty row starts with `name` (case-insensitive), it is treated as header and skipped from data rows. If no header exists, parser assumes first row is data. |
| Trimming | `name`, `prompt`, `negative_prompt`, `description`, `category` are all `.strip()`-trimmed on parse. |
| Save-time cell sanitization | On write, if a string starts with one of `=`, `+`, `-`, `@`, tab, or carriage return, a leading `'` is added to prevent CSV formula injection in spreadsheet tools. |
| Upsert same-name rows | `save_style_to_csv` rewrites **every** row whose `name` matches in the target file (not first-match only), then appends if none matched. |

## Category System

Category derivation is implemented in `categorize_styles` (`stylegrid/csv_io.py`):

| Priority | Condition | Result category |
|---|---|---|
| 1 | `category` column is non-empty | Use it exactly as provided (trimmed). |
| 2 | `name` contains `_` | Prefix before first `_`, converted to uppercase. |
| 3 | `name` contains `-` (and no `_` path matched) | Prefix before first `-`, kept as-is. |
| 4 | Otherwise | CSV filename stem (`source`) with first letter uppercased. |
| 5 | Fallback | `OTHER` if filename-based category is empty. |

### Naming conventions from current implementation

| Topic | What code indicates |
|---|---|
| Canonical style naming pattern | `CATEGORY_StyleName` is the primary pattern recognized for automatic category extraction. |
| Case behavior | Underscore-prefix categories are uppercased automatically; explicit `category` values are not case-normalized. |
| Spaces in category names | Allowed (no validator blocks them), but UI IDs normalize spaces to `_` for DOM IDs. |
| Standard category list | No hardcoded recommended category vocabulary is defined in code. |

## Wildcard Syntax

Category wildcard insertion and resolution:

| Step | Behavior |
|---|---|
| Injection from UI | Right-click category header -> inserts `{sg:<category_lowercase>}` into prompt (example: `{sg:furry_body}`). |
| Resolution | At generation time, `resolve_sg_wildcards` in `stylegrid/wildcards.py` (via `scripts/style_grid.py`) replaces `{sg:...}` tokens using regex `\{sg:([^}]+)\}`. Also runs over **silently injected** style text. |
| Match key | Token is lowercased and looked up in `styles_by_category` (also keyed by lowercased category). |
| Source filter | When an active CSV source is set, the pool is filtered with `normalize_source_path` against each style’s `source_file`. |
| Replacement value | One random style from that category; replaced with that style's `prompt`. |
| No matches | Token is left unchanged. |

Note: `{CATEGORY_NAME}` (without `sg:`) is not handled by this resolver.

## Thumbnail cache vs. `source_file`

Preview images for **CSV styles** are stored under `data/thumbnails/` with filenames from **`thumbnail_hash_key(name, source_file)`** (`md5` of `name::relative_or_basename`). **Every** thumbnail HTTP route for CSV styles requires `source` (`GET` / upload / generate / delete). There is no legacy name-only GET fallback. See `docs/API.md` § Thumbnails. Generation is queued by `job_id` (FIFO single worker).

### LoRA styles (not CSV)

LoRAs are **not** stored in style CSVs. `stylegrid/lora_scan.py` builds synthetic rows with `source_file` / source marker `__style_grid_lora__`. Sibling `<stem>.json` metadata (preferred weight, activation / negative text, description/notes, `modelId`) feeds the prompt and optional CivitAI title cache. `categorize_styles` only fills `display_name` when it is **absent**, so a pre-set CivitAI title is kept. `save_style_to_csv` / `delete_style_from_csv` raise `ValueError` if `source_file == "__style_grid_lora__"` (also when delete omits source but the only match is a LoRA). See README **LoRA support** and `docs/API.md` § LoRA.

### Compatibility with other wildcard extensions

- Extensions such as **stable-diffusion-webui-wildcards** or **Dynamic Prompts** usually recognize **`__name__`** (or other grammar), not `{sg:…}`.
- Style Grid expands **only** `{sg:…}` via `resolve_sg_wildcards`; other extensions do not interpret that pattern by default, so the syntaxes **do not overlap**.
- You **do not need** those third-party extensions for Style Grid’s `{sg:…}` feature — it is implemented in this extension (Python resolver + categories derived from loaded CSV rows).

## Recommended Combos

"Works with" chips are rendered in UI by parsing the `description` field (`javascript/style_grid.js`).

| Item | Actual behavior |
|---|---|
| UI label | Chips are shown under the label `Works with:`. |
| Description syntax parsed | `Combos: ...` (not `Works with:` in raw CSV text). |
| Combo block capture | Regex: `Combos:\s*([^.]+)` (text up to first period). |
| Token splitting | Split by `;` or `or` (case-insensitive). |
| Style token resolution | Exact style name -> fallback with first two underscore segments swapped -> case-insensitive variants of both. |
| Wildcard combo token | Token ending with `_*` is treated as wildcard chip and applies a search prefix filter. |
| Unresolvable token | Rendered as gray hint text (non-clickable). |

Example description format that current parser supports:

`Short desc. Combos: TOKEN1; TOKEN2; CATEGORY_*.`

## Example CSV

Minimal valid file demonstrating header, explicit category, combo text, and wildcard combo token:

```csv
name,prompt,negative_prompt,description,category
FURRY_BODY_Muscular,"muscular build, detailed fur","lowres, blurry","Athletic body style. Combos: FURRY_FACE_Sharp; LIGHTING_SOFT; COLOR_*. Conflicts: avoid realistic skin.",""
FURRY_FACE_Sharp,"sharp eyes, defined muzzle","","Face detail style.","FURRY_FACE"
Painterly-Soft,"painterly strokes, soft brushwork","","Painterly look. Combos: FURRY_BODY_Muscular.",""
```

## Common Mistakes

| Mistake | What actually happens in current code |
|---|---|
| Duplicate names in same source CSV | Load keeps first `(source_file, name)`; **save updates all matching name rows** in that file. Prefer unique names per CSV. |
| Same `name` in **different** CSV files | Both rows can load; thumbnails, favorites, presets, and applies key by `source_file`. Thumbnail APIs require `source`. |
| Editing / deleting a `samples/` style via API | **403** — demo pack is read-only; copy to `styles/` (or another writable CSV) first. |
| Importing styles whose names already exist | `POST /import` returns **400** with `collisions` and writes no CSV. |
| Spaces in category names | Not rejected. Category strings are used as-is; only DOM IDs replace spaces with `_`. |
| Weights above `2.0` in prompts | No numeric validation exists in CSV parser/saver; values pass through unchanged. |
| Missing third column delimiter for `negative_prompt` | If a row has fewer than 3 columns, `negative_prompt` becomes empty string; parser does not raise an error for this case. |
