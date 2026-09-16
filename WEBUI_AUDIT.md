# WebUI Style Organizer — Feature Audit

**Scope:** `sd-webui-style-organizer` (A1111 / Forge / Reforge) at this repo root.  
**Not** the ComfyUI port.  
**Original sweep:** 2026-08-11 · **Pruned for currency:** 2026-09-16 (`master`)

Severities: **bug** (incorrect behavior / data loss / crash), **pitfall** (easy to misuse / silent wrong result), **gap** (missing capability users/docs imply), **smell** (maintainability / dead code / convention drift).

Paths are relative to this extension root unless noted.

---

## Currency (2026-09-16)

The Aug-11 sweep’s **[bug]** pass and later work closed large clusters that this file no longer presents as open. Notable closed (do not re-open as current):

- Windows Gradio `/` vs Python `abspath` source matching; V2 source persistence is **per-tab** (`sg_v2_last_source_${tab}`); `setStyles` always notifies host including All Sources.
- Favorites / Recent use `styleRowKey(name, source_file)`; LS parse is guarded; silent mode hydrates from `SG_INIT`.
- Presets redesign (Phases A–C): React `SaveSetDialog` / `PresetList` / `PresetRow`; overwrite guard; extended `presets.json` schema; host Package modal / `StyleCard presetName` / `SG_PRESETS` removed.
- Dead `selectFilteredStyles` **`presets`** branch + `presetEntryDedupeKey` removed (2026-09-16). Comfy never had that pattern.
- Clear-all restores user text (unwind applied + strip `{sg:…}`); reorder rebuilds from live text / wrap templates.
- Usage increment posts `{ styles: [] }`; samples CRUD **403**; `get_all_styles_file_paths` `isdir` fixed; thumbnail name+source + generation manager.
- Legacy V1 host card panel / CSS removed — V2 iframe is the UI.

Still-valid findings below. No screenshot checklist lives in this file (see `docs/screenshots/README.md` for README image maintainers).

---

## Summary (remaining)

| Area | Open notes |
|------|------------|
| Source filter | Pitfalls/smells around All-Sources name dedupe and basename-only labels |
| Favorites / Recent | Dual-iframe no live-sync; shared V2 keys across tabs |
| Presets | Dual-tab list refresh; duplicate GET list endpoints |
| Apply / Unapply | Paren/brace-aware split gaps; unapply `indexOf`; JS vs silent Python paths |
| Wildcards | Positive-only UI insert; metadata of picks |
| Chunk-aware BREAK | Still absent (`chunker.py` never shipped) |
| Conflicts | Client-only detect; `/style_grid/conflicts` unused by V2 |
| Dual-tab | Shared vs isolated inconsistency; eager dual iframe mount |
| Cross-cutting | Name identity not fully end-to-end; dual prompt-utils copies |

---

## 1. Source filter

### Pitfalls

#### All Sources name dedupe silently picks first CSV row
**Detail:** First occurrence wins in the grid list. Different prompts under the same name collapse; StyleCard multi-source picker exists on click, but filtered lists do not surface variants.
**Location:** `ui/src/store/stylesStore.ts` (`dedupeStylesByNameForAllSources` / `selectFilteredStyles`); `ui/src/components/StyleCard.tsx`

#### Host style cache can still collapse duplicate names
**Detail:** Host resolve helpers historically preferred first name hit; apply paths now carry `source_file`, but any remaining name-only lookups can still pick the wrong CSV variant.
**Location:** `javascript/style_grid.js` (`findStyleByName` / name+source helpers)

### Smells

#### SourceFilter label-only display for path collision
**Detail:** Options use full `source_file` as value but label is basename only. Two dirs with the same CSV basename look identical.
**Location:** `ui/src/components/SourceFilter.tsx`

---

## 2. Favorites / Recent

### Pitfalls

#### Dual iframes do not live-sync favorites / recent
**Detail:** txt2img and img2img each have their own React/Zustand instance. Writing LS in one iframe does not update the other until reload; no `storage` event listener.
**Location:** `javascript/style_grid.js` (frame setup); `ui/src/store/stylesStore.ts` (`toggleFavorite` / `addToRecent`)

### Gaps

#### Favorites / Recent are shared across txt2img/img2img (V2)
**Detail:** Single keys `sg_v2_favorites` / `sg_v2_recent`, not per-tab. Often acceptable product-wise; documented as shared V2 behavior.
**Location:** `stylesStore.ts`

---

## 3. Presets (post redesign)

Current UI: sidebar **Presets** → `PresetList` / `PresetRow`; save via `SaveSetDialog` on `SelectedBar`. Host Package modal and StyleCard preset tiles are gone.

### Pitfalls

#### Preset list refresh is per-tab
**Detail:** After save/delete/rename, the other Forge tab’s iframe may keep a stale presets map until its own fetch/`SG_INIT`.
**Location:** host postMessage targeting; `ui/src/store/stylesStore.ts` (`fetchPresets` / save paths)

### Smells

#### Duplicate list endpoints
**Detail:** `GET /style_grid/presets` and `GET /style_grid/presets/list` both return the normalized map. Frontend tries `/list` then falls back to `/presets`.
**Location:** `stylegrid/routes.py`; `stylesStore.ts` `fetchPresets`

---

## 4. Apply / Unapply

### Pitfalls

#### Unapply uses first `indexOf` substring match
**Detail:** Removing the recorded substring can delete user-authored duplicate tags and leave style tags.
**Location:** `javascript/style_grid.js` (`removeSubstringFromPrompt`)

#### Stale / empty stored deltas vs applied chrome
**Detail:** Apply stores only tags not already present. Fully covered styles stay “applied” in UI but contribute nothing on rebuild — grid and prompt can disagree by design.
**Location:** documented in `docs/DEVELOPMENT.md` (reorder / apply-state edge cases)

#### JS apply vs Python silent inject diverge
**Detail:** Non-silent mutates Gradio immediately; silent merges in `process()`. Dedup / `{prompt}` / comma splitting can still differ between paths.
**Location:** `javascript/style_grid.js`; `scripts/style_grid.py`

### Gaps

#### `style_grid_selected_*` unused by generation
**Detail:** Hidden selected textbox is still created; generation uses prompt fields + silent JSON (+ source filter), not that channel.
**Location:** `scripts/style_grid.py`

### Smells

#### Two copies of prompt helpers
**Detail:** `javascript/style_grid.js` embeds helpers; `javascript/sg_prompt_utils.js` is Forge-injected. Must stay in sync (`tests/test_js.html` / CI drift check).
**Location:** both JS files; `docs/DEVELOPMENT.md`

---

## 5. Wildcards `{sg:…}`

### Pitfalls

#### UI insert is positive-prompt oriented
**Detail:** Category / slice wildcard actions target the positive prompt path; negative-only workflows need care.
**Location:** host wildcard handlers; `StyleGrid` / sidebar menus

#### Chosen wildcard style not in image metadata
**Detail:** Metadata tends to list requested tokens/names, not the randomly resolved pick.
**Location:** `scripts/style_grid.py`; `stylegrid/wildcards.py`

---

## 6. Chunk-aware BREAK

### Gaps

#### Feature never shipped
**Detail:** No `stylegrid/chunker.py`, no `chunk_packing` config. BREAK is at most exempted in dedup — nothing inserts clip-aware BREAKs.
**Location:** absent module; `scripts/style_grid.py` dedup comments

---

## 7. Conflict detection

### Pitfalls

#### Backend `/style_grid/conflicts` unused by V2
**Detail:** React runs local `detectConflicts()` only. Server route remains for potential callers; algorithms can drift.
**Location:** `stylegrid/routes.py`; `stylesStore.ts`

### Gaps

#### Limited resolver UX
**Detail:** Conflicts surface in UI chrome; no full conflict-resolver workflow.
**Location:** `App.tsx` / store conflict state

---

## 8. Dual-tab state

### Pitfalls

#### Shared vs isolated is inconsistent

| State | Actual |
|-------|--------|
| Prompt apply / selection | Host per-tab — OK |
| Source filter | Per-tab V2 LS key |
| Favorites / recent | Shared `sg_v2_*` |
| Silent toggle | Can affect both tabs |

#### Both iframes mount eagerly
**Detail:** Both txt2img and img2img frames load (two React apps, double fetch/LS) even if the user only uses one tab.
**Location:** `javascript/style_grid.js`

### Gaps

#### No cross-iframe UI sync channel
**Detail:** Favorites/recent/source UI do not live-broadcast between open frames.
**Location:** host + store

---

## Cross-cutting themes (still relevant)

1. **Name-only leftovers** — many paths are name+source now, but any remaining name-only resolve/dedupe can still collapse multi-CSV duplicates.
2. **Dual prompt-utils copies** — keep `style_grid.js` and `sg_prompt_utils.js` aligned.
3. **Missing chunk packing** — planned WebUI-only feature is still absent.
4. **Dual-iframe lifecycle** — shared LS + no live sync + eager mount.

---

*Pruned 2026-09-16 against `master`. Closed Aug-11 bugs and post-redesign preset/V1 items removed rather than left as current.*
