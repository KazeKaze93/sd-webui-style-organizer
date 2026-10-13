# BLUR-DIAG report

Branch: `perf/grid`. Prod bench preview. Card name: `Bench 00011` (display form of `BASE_Bench_00011`).

Metric: **Laplacian variance** (4-neighbor) of a grayscale PNG crop of the card-name `.truncate` element. Higher = sharper.

## Experiments

| Id | Override |
|----|----------|
| E0 | Current tip (no overrides) |
| E1 | Virtualizer rows: `transform: translateY(y)` → `top: y` + `transform: none` |
| E2 | Cards: `transition-property: none`, `transform: none` (kills hover/active scale) |
| E3 | `font-family: Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif` instead of Geist |
| E4 | `text-rendering: auto`, `font-optical-sizing: none`, neutralize will-change / backdrop-filter / filter / translateZ |

Full factorial of E1–E4 (16 cells) measured at each DPR.

## Metric table (experiment × DPR)

| Experiment | DPR 1 | DPR 1.25 | DPR 1.5 | DPR 2 |
| --- | ---: | ---: | ---: | ---: |
| E0 | 16384.48 | 11826.75 | 7575.49 | 5038.52 |
| E1 | 16384.48 | 11826.75 | 7575.49 | 5038.52 |
| E2 | 16384.48 | 11826.75 | 7575.49 | 5038.52 |
| E1+E2 | 16384.48 | 11826.75 | 7575.49 | 5038.52 |
| E3 | 16103.17 | 11004.57 | 7204.49 | 4571.87 |
| E1+E3 | 16103.17 | 11004.57 | 7204.49 | 4571.87 |
| E2+E3 | 16103.17 | 11004.57 | 7204.49 | 4571.87 |
| E1+E2+E3 | 16103.17 | 11004.57 | 7204.49 | 4571.87 |
| E4 | 16384.48 | 11826.75 | 7575.49 | 5038.52 |
| E1+E4 | 16384.48 | 11826.75 | 7575.49 | 5038.52 |
| E2+E4 | 16384.48 | 11826.75 | 7575.49 | 5038.52 |
| E1+E2+E4 | 16384.48 | 11826.75 | 7575.49 | 5038.52 |
| E3+E4 | 16103.17 | 11004.57 | 7204.49 | 4571.87 |
| E1+E3+E4 | 16103.17 | 11004.57 | 7204.49 | 4571.87 |
| E2+E3+E4 | 16103.17 | 11004.57 | 7204.49 | 4571.87 |
| E1+E2+E3+E4 | 16103.17 | 11004.57 | 7204.49 | 4571.87 |

## Winner

**E0** — mean relative sharpness across DPRs (normalized to E0 per DPR, then averaged): 1.0000.

Best absolute variance per DPR: 1→16384.48, 1.25→11826.75, 1.5→7575.49, 2→5038.52.

## Minimal near-best set (≤5% below best at every DPR)

Experiments within 5% of the best value at **every** DPR:

- `E0`
- `E1`
- `E1+E2`
- `E1+E2+E4`
- `E1+E4`
- `E2`
- `E2+E4`
- `E4`

**Minimal change set: none.** E0 is already the best; E1/E2/E4 (and combos without E3) match E0 bit-for-bit on this metric (no-ops). E3 (system sans) **regresses** sharpness at every DPR (~2–9% lower).

## Geist-only finding

Not applicable: E3 does **not** win. Forcing system sans lowers Laplacian variance at every DPR; E1/E2/E4 alone match E0. No Geist-vs-system decision requested.

## Fractional getBoundingClientRect (E0)

| DPR | Card name | Row | Host `#panel` |
|----:|-----------|-----|---------------|
| 1 | x=231 y=118 w=105.75 (frac) h=16 | x=222 y=109 w=1046 h=42 | x=0 y=0 w=1280 h=800 |
| 1.25 | x=231 y=118 w=105.75 (frac) h=16 | x=222 y=109 w=1046 h=42 | x=0 y=0 w=1280 h=800 |
| 1.5 | x=231 y=118 w=105.75 (frac) h=16 | x=222 y=109 w=1046 h=42 | x=0 y=0 w=1280 h=800 |
| 2 | x=231 y=118 w=105.75 (frac) h=16 | x=222 y=109 w=1046 h=42 | x=0 y=0 w=1280 h=800 |

Note: card-name **width is fractional** (105.75) at every DPR; x/y are integers. Row and host wrapper boxes are integer. E1 did not change name sharpness (row `translateY` values were already integers).

## E1 transform probe (before rewrite, E0 @ DPR 1)

Rows: 22; sampled 22; with translateY 21; fractional translateY 0.

Sample (first 8):

```
data-index=0 inline=null ty=null fractional=false
data-index=1 inline=translateY(40px) ty=40 fractional=false
data-index=2 inline=translateY(82px) ty=82 fractional=false
data-index=3 inline=translateY(122px) ty=122 fractional=false
data-index=4 inline=translateY(164px) ty=164 fractional=false
data-index=5 inline=translateY(206px) ty=206 fractional=false
data-index=6 inline=translateY(248px) ty=248 fractional=false
data-index=7 inline=translateY(290px) ty=290 fractional=false
```

## Host static scan (`javascript/style_grid`, `style.css`)

Read-only. No edits.

| File:line | Kind | Text |
|-----------|------|------|
| `style.css:82` | transform | `@keyframes sg-fade-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }` |
| `javascript/style_grid/handlers/iframe.js:51` | note | `wrapper.style.cssText uses integer top:80px, right:16px, width:1000px, height:650px — no transform:translate; left:auto` |
| `javascript/style_grid/handlers/iframe.js:53` | layout | `top:80px` (integer) |
| `javascript/style_grid/handlers/iframe.js:56` | layout | `width:1000px` (integer) |
| `javascript/style_grid/handlers/iframe.js:57` | layout | `height:650px` (integer) |
| `javascript/style_grid/handlers/iframe.js:70` | note | `frame.style.cssText = width:100%;height:100% — no translate` |

No `transform: translate` / fractional `left`/`top`/`width`/`height` on the production host panel wrapper. Bench host uses full-viewport `#panel` iframe (`ui/bench/host.html`).

## E4 occurrence inventory (ui/src, read-only)

| File:line | What |
|-----------|------|
| `ui/src/components/ui/dialog.tsx:42` | `supports-backdrop-filter:backdrop-blur-xs` on dialog overlay |
| `ui/src/App.tsx:61` | `[filter:grayscale(0.35)]` on disabled toolbar control |
| `ui/src/components/StyleCard.tsx:143` | `transition-transform` + `hover:scale-[1.02]` (E2 target; not translateZ) |
| `ui/src/components/grid/VirtualStyleGrid.tsx:269` | `transform: translateY(${virtualRow.start}px)` (E1 target) |
| `(scan)` | No `will-change` / `translateZ` / `text-rendering` / `font-optical-sizing` literals found under `ui/src` (may still apply via UA or font defaults) |

## PNG crops (E0 vs winner @ DPR 1 and 1.25)

Winner is E0, so crops are identical (kept as required pair).

| | DPR 1 | DPR 1.25 |
|--|-------|----------|
| E0 | ![E0 DPR1](out/crop-E0-dpr1.png) | ![E0 DPR1.25](out/crop-E0-dpr1.25.png) |
| Winner (E0) | ![W DPR1](out/crop-winner-dpr1.png) | ![W DPR1.25](out/crop-winner-dpr1.25.png) |

For contrast, E3 (system sans) crops are also on disk: `out/crop-E3-dpr1.png`, `out/crop-E3-dpr1.25.png`.

Raw JSON: `out/results.json`. Harness: `run.mjs`.
