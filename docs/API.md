# Backend API Reference

Base URL: `http://127.0.0.1:7860/style_grid`

Gradio/FastAPI. All endpoints return HTTP 200 even on errors unless otherwise noted. Check response body for `{error}` field.

## Styles

## GET /styles

**Method:** GET  
**Description:** Returns categorized styles and usage counters, with ETag support.

**Parameters:**


| name            | in     | required | type   | description                       |
| --------------- | ------ | -------- | ------ | --------------------------------- |
| `If-None-Match` | header | No       | string | ETag value for conditional fetch. |


**Response:**


| field        | type   | description                                     |
| ------------ | ------ | ----------------------------------------------- |
| `categories` | object | Map of category name -> array of style objects. |
| `usage`      | object | Per-style usage stats map.                      |


Style object fields include:


| field               | type    | description                                                 |
| ------------------- | ------- | ----------------------------------------------------------- |
| `name`              | string  | Style name from CSV.                                        |
| `prompt`            | string  | Positive prompt fragment.                                   |
| `negative_prompt`   | string  | Negative prompt fragment.                                   |
| `description`       | string  | Freeform description.                                       |
| `category_explicit` | string  | Raw category column value from CSV.                         |
| `source`            | string  | Source CSV filename.                                        |
| `category`          | string  | Resolved category.                                          |
| `display_name`      | string  | Display label derived from name.                            |
| `has_placeholder`   | boolean | True if `{prompt}` is present in prompt or negative prompt. |


**Error cases:**


| case                         | behavior                           |
| ---------------------------- | ---------------------------------- |
| Cache hit with matching ETag | Returns HTTP `304` and empty body. |


## POST /reload

**Method:** POST  
**Description:** Forces style cache reload and returns fresh categorized data.

**Parameters:**


| name   | in   | required | type   | description          |
| ------ | ---- | -------- | ------ | -------------------- |
| (none) | body | No       | object | Empty body accepted. |


**Response:**


| field        | type   | description            |
| ------------ | ------ | ---------------------- |
| `categories` | object | Reloaded category map. |
| `usage`      | object | Current usage map.     |


**Error cases:** None explicitly returned as `{error}`.

## GET /check_update

**Method:** GET  
**Description:** Returns whether any tracked CSV files changed.

**Parameters:**


| name   | in    | required | type | description    |
| ------ | ----- | -------- | ---- | -------------- |
| (none) | query | No       | -    | No parameters. |


**Response:**


| field     | type    | description                         |
| --------- | ------- | ----------------------------------- |
| `changed` | boolean | True if CSV set or content changed. |


**Error cases:** None explicitly returned as `{error}`.

## GET /usage

**Method:** GET  
**Description:** Returns usage statistics storage as-is.

**Parameters:**


| name   | in    | required | type | description    |
| ------ | ----- | -------- | ---- | -------------- |
| (none) | query | No       | -    | No parameters. |


**Response:**


| field          | type   | description                                                                     |
| -------------- | ------ | ------------------------------------------------------------------------------- |
| `<style_name>` | object | Dynamic keys; each value typically includes `count`, `last_used`, `first_used`. |


**Error cases:** None explicitly returned as `{error}`.

## POST /usage/increment

**Method:** POST  
**Description:** Increments usage counters for the provided style names.

**Parameters:**


| name     | in   | required | type          | description                                                  |
| -------- | ---- | -------- | ------------- | ------------------------------------------------------------ |
| `styles` | body | No       | array[string] | Style names to increment; defaults to empty list if omitted. |


**Response:**


| field | type    | description                            |
| ----- | ------- | -------------------------------------- |
| `ok`  | boolean | Always `true` after handler execution. |


**Error cases:** None explicitly returned as `{error}`.

## POST /conflicts

**Method:** POST  
**Description:** Computes prompt/negative token conflicts for selected styles.

**Parameters:**


| name     | in   | required | type          | description                                     |
| -------- | ---- | -------- | ------------- | ----------------------------------------------- |
| `styles` | body | No       | array[string] | Style names to analyze; defaults to empty list. |


**Response:**


| field       | type          | description                |
| ----------- | ------------- | -------------------------- |
| `conflicts` | array[object] | Detected conflict entries. |


Conflict item fields:


| field     | type          | description                               |
| --------- | ------------- | ----------------------------------------- |
| `styles`  | array[string] | Two style names involved in the conflict. |
| `type`    | string        | Currently `positive_vs_negative`.         |
| `tokens`  | array[string] | Overlapping token sample (up to 5).       |
| `message` | string        | Human-readable conflict summary.          |


**Error cases:** None explicitly returned as `{error}`.

## Presets

## GET /presets

**Method:** GET  
**Description:** Returns all saved presets.

**Parameters:**


| name   | in    | required | type | description    |
| ------ | ----- | -------- | ---- | -------------- |
| (none) | query | No       | -    | No parameters. |


**Response:**


| field           | type   | description                                    |
| --------------- | ------ | ---------------------------------------------- |
| `<preset_name>` | object | Dynamic keys; each value includes preset data. |


Preset object fields:


| field     | type          | description                        |
| --------- | ------------- | ---------------------------------- |
| `styles`  | array[string] | Selected style names in preset.    |
| `created` | string        | Timestamp (`YYYY-MM-DDTHH:MM:SS`). |


**Error cases:** None explicitly returned as `{error}`.

## POST /presets/save

**Method:** POST  
**Description:** Saves or updates a preset name with a style list.

**Parameters:**


| name     | in   | required | type          | description                 |
| -------- | ---- | -------- | ------------- | --------------------------- |
| `name`   | body | Yes      | string        | Preset name (trimmed).      |
| `styles` | body | No       | array[string] | Styles list for the preset. |


**Response:**

Success:


| field     | type    | description               |
| --------- | ------- | ------------------------- |
| `ok`      | boolean | `true` on success.        |
| `presets` | object  | Full updated presets map. |


**Error cases:**


| case                 | response body                  |
| -------------------- | ------------------------------ |
| Missing/empty `name` | `{ "error": "Name required" }` |


## POST /presets/delete

**Method:** POST  
**Description:** Deletes a preset by name if it exists.

**Parameters:**


| name   | in   | required | type   | description            |
| ------ | ---- | -------- | ------ | ---------------------- |
| `name` | body | No       | string | Preset name to remove. |


**Response:**


| field     | type    | description                              |
| --------- | ------- | ---------------------------------------- |
| `ok`      | boolean | `true` on completion.                    |
| `presets` | object  | Full presets map after deletion attempt. |


**Error cases:** None explicitly returned as `{error}`.

## Thumbnails

## GET /thumbnails/list

**Method:** GET  
**Description:** Returns style names that currently have a thumbnail file.

**Parameters:**


| name   | in    | required | type | description    |
| ------ | ----- | -------- | ---- | -------------- |
| (none) | query | No       | -    | No parameters. |


**Response:**


| field           | type          | description                                |
| --------------- | ------------- | ------------------------------------------ |
| `has_thumbnail` | array[string] | Style names with existing thumbnail files. |


**Error cases:** None explicitly returned as `{error}`.

## GET /thumbnail

**Method:** GET  
**Description:** Returns a single thumbnail image by style name.

**Parameters:**


| name   | in    | required | type   | description                                |
| ------ | ----- | -------- | ------ | ------------------------------------------ |
| `name` | query | No       | string | Style name used to resolve thumbnail path. |


**Response:**


| type                | description                     |
| ------------------- | ------------------------------- |
| `image/webp` binary | Thumbnail file body when found. |


**Error cases:**


| case              | behavior                                 |
| ----------------- | ---------------------------------------- |
| Thumbnail missing | Returns HTTP `404` (not JSON `{error}`). |


## POST /thumbnail/upload

**Method:** POST  
**Description:** Uploads a base64-encoded image as a style thumbnail.

**Parameters:**


| name    | in   | required | type   | description                        |
| ------- | ---- | -------- | ------ | ---------------------------------- |
| `name`  | body | Yes      | string | Style name to attach thumbnail to. |
| `image` | body | Yes      | string | Base64 payload (raw or data URL).  |


**Response:**

Success:


| field | type    | description                    |
| ----- | ------- | ------------------------------ |
| `ok`  | boolean | `true` after successful write. |


**Error cases:**


| case                       | response body                                                        |
| -------------------------- | -------------------------------------------------------------------- |
| Missing `name` or `image`  | `{ "error": "name and image required" }`                             |
| File too large (>2MB)      | `{ "error": "Image too large (max 2MB)" }`                           |
| Unsupported file signature | `{ "error": "Invalid image format. Allowed: JPEG, PNG, WEBP, GIF" }` |
| Unexpected exception       | `{ "error": "<exception message>" }`                                 |


## GET /thumbnail/gen_status

**Method:** GET  
**Description:** Returns generation state for a style thumbnail job.

**Parameters:**


| name   | in    | required | type   | description                              |
| ------ | ----- | -------- | ------ | ---------------------------------------- |
| `name` | query | No       | string | Style name key in generation status map. |


**Response:**


| field     | type   | description                                                 |
| --------- | ------ | ----------------------------------------------------------- |
| `status`  | string | `idle`, `running`, `done`, or `error` (depending on state). |
| `message` | string | Present on `error` states.                                  |


**Error cases:** None explicitly returned as `{error}` by this endpoint.

## POST /thumbnail/generate

**Method:** POST  
**Description:** Starts asynchronous SD thumbnail generation for a style.

**Parameters:**


| name   | in   | required | type   | description                           |
| ------ | ---- | -------- | ------ | ------------------------------------- |
| `name` | body | Yes      | string | Style name to generate thumbnail for. |


**Response:**

Success:


| field    | type    | description                  |
| -------- | ------- | ---------------------------- |
| `ok`     | boolean | `true` when job starts.      |
| `status` | string  | `running` on accepted start. |


**Error cases:**


| case                          | response body                                                            |
| ----------------------------- | ------------------------------------------------------------------------ |
| Missing/empty `name`          | `{ "error": "name required" }`                                           |
| SD busy                       | `{ "error": "SD is busy, try again after current generation finishes" }` |
| Already generating same style | `{ "error": "already generating" }`                                      |


## POST /thumbnails/cleanup

**Method:** POST  
**Description:** Removes orphaned thumbnail files not matching any current style.

**Parameters:**


| name   | in   | required | type   | description          |
| ------ | ---- | -------- | ------ | -------------------- |
| (none) | body | No       | object | Empty body accepted. |


**Response:**


| field     | type    | description                               |
| --------- | ------- | ----------------------------------------- |
| `removed` | integer | Number of deleted orphan thumbnail files. |


**Error cases:** None explicitly returned as `{error}`.

## CRUD

## POST /style/save

**Method:** POST  
**Description:** Creates or updates one style row in a target CSV.

**Parameters:**


| name              | in   | required | type   | description                                   |
| ----------------- | ---- | -------- | ------ | --------------------------------------------- |
| `name`            | body | Yes      | string | Style name (trimmed).                         |
| `prompt`          | body | No       | string | Positive prompt content.                      |
| `negative_prompt` | body | No       | string | Negative prompt content.                      |
| `description`     | body | No       | string | Description text.                             |
| `source`          | body | No       | string | Source CSV filename (with or without `.csv`). |


**Response:**


| field | type    | description        |
| ----- | ------- | ------------------ |
| `ok`  | boolean | `true` after save. |


**Error cases:**


| case                 | response body                  |
| -------------------- | ------------------------------ |
| Missing/empty `name` | `{ "error": "Name required" }` |


## POST /style/delete

**Method:** POST  
**Description:** Deletes one style row by name from the selected source (or inferred source).

**Parameters:**


| name     | in   | required | type   | description               |
| -------- | ---- | -------- | ------ | ------------------------- |
| `name`   | body | Yes      | string | Style name to delete.     |
| `source` | body | No       | string | Source CSV filename hint. |


**Response:**


| field | type    | description                  |
| ----- | ------- | ---------------------------- |
| `ok`  | boolean | `true` after delete attempt. |


**Error cases:**


| case                 | response body                  |
| -------------------- | ------------------------------ |
| Missing/empty `name` | `{ "error": "Name required" }` |


## POST /backup

**Method:** POST  
**Description:** Creates a timestamped backup of all discovered CSV files.

**Parameters:**


| name   | in   | required | type   | description          |
| ------ | ---- | -------- | ------ | -------------------- |
| (none) | body | No       | object | Empty body accepted. |


**Response:**


| field | type    | description                                                  |
| ----- | ------- | ------------------------------------------------------------ |
| `ok`  | boolean | `true` if at least one CSV was backed up, otherwise `false`. |


**Error cases:** None explicitly returned as `{error}`.

## GET /export

**Method:** GET  
**Description:** Exports styles, presets, usage, and export timestamp.

**Parameters:**


| name   | in    | required | type | description    |
| ------ | ----- | -------- | ---- | -------------- |
| (none) | query | No       | -    | No parameters. |


**Response:**


| field         | type          | description                            |
| ------------- | ------------- | -------------------------------------- |
| `styles`      | array[object] | Flat list from all loaded CSV sources. |
| `presets`     | object        | Presets map.                           |
| `usage`       | object        | Usage map.                             |
| `exported_at` | string        | Timestamp (`YYYY-MM-DDTHH:MM:SS`).     |


**Error cases:** None explicitly returned as `{error}`.

## POST /import

**Method:** POST  
**Description:** Imports presets into storage and optionally writes imported styles into a new CSV file.

**Parameters:**


| name      | in   | required | type          | description                                                 |
| --------- | ---- | -------- | ------------- | ----------------------------------------------------------- |
| `presets` | body | No       | object        | Preset map merged into existing presets.                    |
| `styles`  | body | No       | array[object] | Styles to write into `styles/imported_YYYYMMDD_HHMMSS.csv`. |


**Response:**


| field | type    | description           |
| ----- | ------- | --------------------- |
| `ok`  | boolean | `true` on completion. |


**Error cases:** None explicitly returned as `{error}`.

## POST /category_order/save

**Method:** POST  
**Description:** Persists sidebar category order into `data/category_order.json`.

**Parameters:**


| name    | in   | required | type  | description          |
| ------- | ---- | -------- | ----- | -------------------- |
| `order` | body | No       | array | Category order list. |


**Response:**

Success:


| field | type    | description        |
| ----- | ------- | ------------------ |
| `ok`  | boolean | `true` when saved. |


**Error cases:**


| case                  | response body                         |
| --------------------- | ------------------------------------- |
| `order` is not a list | `{ "error": "order must be a list" }` |


