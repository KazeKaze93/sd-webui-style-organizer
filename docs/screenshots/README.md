# Screenshots for `README.md`

The pictures are taken from the real panel, built from `ui/`, on a local test
page. The style library is a neutral demo set (photography and art terms, a
few LoRA cards), previews are placeholder gradients, and the WebUI page around
the panel in `img2img-support.png` is a hand-drawn stand-in: only the panel is
the real code. Dark theme, device scale 1.

## Regenerate

```powershell
cd ui
node bench/screenshots/capture.mjs
```

The script builds the bench preview, serves it, answers every `/style_grid/*`
request from `ui/bench/screenshots/dataset.mjs`, and writes the PNGs here.
`--only name1,name2` retakes some shots; `--no-build` reuses the last build.
The script, the dataset and the two mock host pages are the same files in the
ComfyUI repo (`sd-comfyui-style-organizer`); the platform is the repo they run
in.

Keep the file names: `README.md` links them.

| File | What it shows |
|------|---------------|
| `img2img-support.png` | The panel over the img2img tab, two styles selected |
| `browse-and-filter.png` | A category picked in the sidebar, selected tiles |
| `search-autocomplete.png` | Search with suggestions |
| `apply-and-reorder.png` | Selected styles and a wildcard in the tray |
| `tile-expand.png` | A long name shown whole on hover |
| `lora-view.png` | **🧬 LoRA** view, cards grouped by folder with titles |
| `favorites-view.png` | **Favorites** view |
| `favorites-in-category.png` | Stars on favorited tiles in a category |
| `category-context-wildcard-previews.png` | Sidebar category menu (Random, Shuffle, Pick styles…, Generate previews…) |
| `slice-selection-mode.png` | Pick styles… mode bar and ticked tiles |
| `wildcard-slice-chips.png` | A whole-category chip and a slice chip in the tray |
| `style-card-context-menu.png` | Right-click menu of a style card |
| `fullscreen-mode.png` | The panel in fullscreen |
| `top-bar-icons.png` | The header row and its icon buttons |
| `lora-fetch-titles.png` | Tooltip of the Fetch LoRA titles button |
| `gallery-view.png` | Gallery view with previews |
