# CSV Format Specification

## File Location

CSV discovery and save behavior are implemented in `scripts/style_grid.py`:

| Aspect | Behavior in code |
|---|---|
| Read directories (`get_styles_dirs`) | 1) `<extension_root>/styles` 2) `shared.cmd_opts.data_path` (or current process directory if not set). |
| Read order | Directories are scanned in the order above; inside each directory, `*.csv` files are processed in sorted filename order. |
| Extra fallback read | `styles.csv` from `os.getcwd()` is also parsed after directory scan (if present). |
| Duplicate key handling during load | Dedup key is `(source_filename, style_name)`; first seen entry wins. |
| Save target selection | For `save_style_to_csv(..., source_file)`: choose first existing `source_file` found by `get_styles_dirs()` order; if not found, create it in `<extension_root>/styles`. |
| `source_file` normalization | Basename only; `.csv` extension auto-appended if missing. |

### `sources.json` config

No `sources.json` reader is present in the current codebase. Source lists are derived from loaded style rows (`style.source`) in `javascript/style_grid.js`.

## Column Reference

Parser and writer logic come from `parse_styles_csv` and `save_style_to_csv` in `scripts/style_grid.py`.

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

## Category System

Category derivation is implemented in `categorize_styles` (`scripts/style_grid.py`):

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
| Resolution | At generation time, `resolve_sg_wildcards` in `scripts/style_grid.py` replaces `{sg:...}` tokens using regex `\{sg:([^}]+)\}`. |
| Match key | Token is lowercased and looked up in `styles_by_category` (also keyed by lowercased category). |
| Replacement value | One random style from that category; replaced with that style's `prompt`. |
| No matches | Token is left unchanged. |

Note: `{CATEGORY_NAME}` (without `sg:`) is not handled by this resolver.

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
| Duplicate names in same source CSV | Load dedup key is `(source, name)`, so first occurrence is kept. Save update also rewrites first matching row and stops (first match wins). |
| Spaces in category names | Not rejected. Category strings are used as-is; only DOM IDs replace spaces with `_`. |
| Weights above `2.0` in prompts | No numeric validation exists in CSV parser/saver; values pass through unchanged. |
| Missing third column delimiter for `negative_prompt` | If a row has fewer than 3 columns, `negative_prompt` becomes empty string; parser does not raise an error for this case. |
