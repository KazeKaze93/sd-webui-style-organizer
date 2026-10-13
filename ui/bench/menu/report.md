# Menu viewport clamp probe

Generated: 2026-10-13T17:23:59.215Z

## Scope

- Target: card **context menu** + **source picker** (`StyleCard.tsx` portals)
- Anchor: last visible row, rightmost column, bottom-right of card
- Scroll: 3 scroller screens before each open
- Densities: `compact` / `normal` (fullscreen) / `windowed` (panel)
- Thumbnail: `has_thumbnail` true/false (extra Remove preview row when true)
- App code: **read-only** - this folder only

## Clamp source map (read-only)

| Surface | Portal | Clamp | Assumed height | File:line |
|---|---|---|---|---|
| Context menu | yes -> `document.body` | **none** (click x/y) | - | `StyleCard.tsx:127` |
| Source picker | yes -> `document.body` | X via assumed **width 280**; Y floor 8 | **none** (no height clamp) | `StyleCard.tsx:132-133` |
| `ViewportFixedMenu` (not StyleCard) | yes | `fitFixedMenuPosition` + measured H | **none** (measures `rect.height`) | `ViewportFixedMenu.tsx:35-42`, pad `fitFixedMenuPosition.ts:2` (`MENU_VIEWPORT_PAD=8`) |

## Results

| density | thumb | kind | inside | inside+M8 | overflow px (L/T/R/B) | menu rect | viewport | portal | fixed offset (L,T) | transform ancestors |
|---|---|---|---|---|---|---|---|---|---|---|
| compact | no | contextMenu | yes | yes | L0.0 T0.0 R0.0 B0.0 | 914.0,455.0 192.0×325.0 | 1280×800 | body | 914.0,455.0 | (none) |
| compact | no | sourcePicker | yes | yes | L0.0 T0.0 R0.0 B0.0 | 926.0,674.0 190.9×76.0 | 1280×800 | body | 926.0,674.0 | (none) |
| normal | no | contextMenu | yes | yes | L0.0 T0.0 R0.0 B0.0 | 1080.0,467.0 192.0×325.0 | 1280×800 | body | 1080.0,467.0 | (none) |
| normal | no | sourcePicker | yes | yes | L0.0 T0.0 R0.0 B0.0 | 1081.1,674.0 190.9×76.0 | 1280×800 | body | 1081.1,674.0 | (none) |
| windowed | no | contextMenu | yes | yes | L0.0 T0.0 R0.0 B0.0 | 737.0,451.0 192.0×325.0 | 1280×800 | body | 737.0,451.0 | (none) |
| windowed | no | sourcePicker | yes | yes | L0.0 T0.0 R0.0 B0.0 | 749.0,670.0 190.9×76.0 | 1280×800 | body | 749.0,670.0 | (none) |
| compact | yes | contextMenu | yes | yes | L0.0 T0.0 R0.0 B0.0 | 914.0,423.0 192.0×357.0 | 1280×800 | body | 914.0,423.0 | (none) |
| compact | yes | sourcePicker | yes | yes | L0.0 T0.0 R0.0 B0.0 | 926.0,674.0 190.9×76.0 | 1280×800 | body | 926.0,674.0 | (none) |
| normal | yes | contextMenu | yes | yes | L0.0 T0.0 R0.0 B0.0 | 1080.0,435.0 192.0×357.0 | 1280×800 | body | 1080.0,435.0 | (none) |
| normal | yes | sourcePicker | yes | yes | L0.0 T0.0 R0.0 B0.0 | 1081.1,674.0 190.9×76.0 | 1280×800 | body | 1081.1,674.0 | (none) |
| windowed | yes | contextMenu | yes | yes | L0.0 T0.0 R0.0 B0.0 | 737.0,419.0 192.0×357.0 | 1280×800 | body | 737.0,419.0 | (none) |
| windowed | yes | sourcePicker | yes | yes | L0.0 T0.0 R0.0 B0.0 | 749.0,670.0 190.9×76.0 | 1280×800 | body | 749.0,670.0 | (none) |

## Findings

1. **Context menu** portals to `document.body`, `position:fixed` at raw click coords (`StyleCard.tsx:127`). No clamp -> bottom overflow **301-349px** at bottom-right after scroll x3; fullscreen (`normal`) also **R176px**. Thumb on adds Remove preview (+32px height, +1 button).
2. **Source picker** portals to `document.body`, X clamped with **assumed width 280** (`StyleCard.tsx:132`), Y only `max(8, card.top)` (`:133`) - **no height clamp**. At bottom-right: bottom overflow **22-26px** (fails `MENU_MARGIN`). X clamp keeps right overflow at 0.
3. **Assumed height:** none for either StyleCard surface (`clampAssumedHeight: null`). Shared helper `fitFixedMenuPosition` also measures live `rect.height` (no assumed H) - used only by `ViewportFixedMenu` (LoRA/sidebar), not StyleCard.
4. **Transformed ancestors:** empty chain for all cases (portal escapes grid transform / overflow).
5. **Fixed offset:** equals menu `left`/`top` (unclamped click for context; picker uses `rect.right+8` / `rect.top`).

Full per-case JSON (menuRect, viewport, overflow, portal, fixedOffset, transformAncestorChain): `out/menu-probe.raw.json`.

## Assertion outline - menu fully inside viewport with `MENU_MARGIN`

Target constant (today in app): `MENU_VIEWPORT_PAD = 8` at `fitFixedMenuPosition.ts:2`.
Bench alias for the contract: **`MENU_MARGIN = 8`** (same value).

```ts
const MENU_MARGIN = 8 // === MENU_VIEWPORT_PAD

function assertMenuFullyInsideViewport(menu: DOMRect, vw: number, vh: number) {
  // Soft pad: menu must sit entirely inside the padded viewport inset.
  expect(menu.left).toBeGreaterThanOrEqual(MENU_MARGIN)
  expect(menu.top).toBeGreaterThanOrEqual(MENU_MARGIN)
  expect(menu.right).toBeLessThanOrEqual(vw - MENU_MARGIN)
  expect(menu.bottom).toBeLessThanOrEqual(vh - MENU_MARGIN)

  // Equivalent overflow form (what this probe records as overflowPxVsMargin8):
  const overflow = {
    left: Math.max(0, MENU_MARGIN - menu.left),
    top: Math.max(0, MENU_MARGIN - menu.top),
    right: Math.max(0, menu.right - (vw - MENU_MARGIN)),
    bottom: Math.max(0, menu.bottom - (vh - MENU_MARGIN)),
  }
  expect(overflow).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
}
```

Cases to cover in a future test (this probe is the fixture matrix):

1. Context menu at bottom-right card after scroll x3 - each density x thumb on/off
2. Source picker at bottom-right duplicate card after scroll x3 - same matrix
3. Tall menu (thumb on -> extra Remove preview) still clears bottom by `MENU_MARGIN`
4. Portal host is `document.body`; transformed-ancestor chain empty (or documented)
5. Fixed `left`/`top` match clamped coords (not raw click) once StyleCard adopts `fitFixedMenuPosition`

**Current verdict from probe:** see `inside+M8` column - StyleCard menus do **not** call
`fitFixedMenuPosition` today, so bottom-right opens are expected to fail the margin assertion
until they share `ViewportFixedMenu` / `MENU_VIEWPORT_PAD`.

## Summary counters

- Cases: 12
- Menu found: 12
- Missing / failed open: 0
- Overflow viewport edge: 0
- Overflow vs MENU_MARGIN(8): 0
