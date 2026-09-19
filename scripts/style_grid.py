"""
Style Grid - Grid/Gallery style selector for Stable Diffusion WebUI Forge
Replaces the clunky dropdown with a visual grid organized by categories.

Implementation lives in the `stylegrid` package; this file is the Forge script entry point.
"""

import json
import os

import gradio as gr  # type: ignore[reportMissingImports]
from modules import script_callbacks, scripts  # type: ignore[reportMissingImports]
from modules.processing import StableDiffusionProcessing  # type: ignore[reportMissingImports]

from stylegrid.cache import get_cached_styles
from stylegrid.config import DATA_DIR
from stylegrid.csv_io import categorize_styles, load_all_styles, normalize_source_path
from stylegrid.data_files import load_presets, load_usage
from stylegrid.lora_scan import LORA_SOURCE
from stylegrid.prompt_ops import dedup_prompt
from stylegrid.routes import register_api
from stylegrid.wildcards import resolve_sg_wildcards

script_callbacks.on_app_started(register_api)


class StyleGridScript(scripts.Script):
    def title(self):
        return "Style Grid"

    def show(self, is_img2img):
        return scripts.AlwaysVisible

    def ui(self, is_img2img):
        tab_prefix = "img2img" if is_img2img else "txt2img"
        styles = load_all_styles()
        categories = categorize_styles(styles)
        styles_json = json.dumps({
            "categories": categories,
            "usage": load_usage(),
            "presets": load_presets(),
        }, ensure_ascii=False)
        order_file = os.path.join(DATA_DIR, "category_order.json")
        if os.path.isfile(order_file):
            try:
                with open(order_file, "r", encoding="utf-8") as f:
                    category_order = json.load(f)
            except Exception:
                category_order = sorted(categories.keys())
        else:
            category_order = sorted(categories.keys())
        with gr.Group(elem_id=f"style_grid_wrapper_{tab_prefix}", visible=False):
            # JS-only bridge: Gradio must construct this for elem_id; Python never reads it.
            gr.Textbox(value=styles_json, visible=False, elem_id=f"style_grid_data_{tab_prefix}")
            # JS-only bridge: Gradio must construct this for elem_id; Python never reads it.
            gr.Textbox(value="[]", visible=False, elem_id=f"style_grid_selected_{tab_prefix}")
            source_filter = gr.Textbox(value="", visible=False, elem_id=f"style_grid_source_{tab_prefix}")
            gr.Button(visible=False, elem_id=f"style_grid_apply_trigger_{tab_prefix}")
        with gr.Group(visible=False):
            gr.Textbox(value=json.dumps(category_order), visible=False, elem_id=f"style_grid_cat_order_{tab_prefix}")
        return [source_filter]

    def process(self, p: StableDiffusionProcessing, *args):
        """Resolve {sg:...} wildcards in the prompts at generation time."""
        all_styles = list(get_cached_styles())
        categorize_styles(all_styles)

        # args[0] = active source filter passed from UI ("" means All Sources)
        active_source = (args[0] if len(args) >= 1 else "") or ""
        if active_source:
            wildcard_pool = [
                s for s in all_styles
                if normalize_source_path(s.get("source_file") or "") == normalize_source_path(active_source)
            ]
            if not wildcard_pool:           # unknown source — fall back to all
                wildcard_pool = all_styles
        else:
            wildcard_pool = all_styles      # All Sources selected

        styles_by_cat = {}
        for s in wildcard_pool:
            if s.get("source_file") == LORA_SOURCE:
                continue  # LoRA is source-independent — handled below from all_styles
            key = (s.get("category") or "").lower()
            styles_by_cat.setdefault(key, []).append(s)

        # LoRA: always source-independent. Root-level files use category "LoRA";
        # subfoldered files use their subfolder name as category (set at scan
        # time in lora_scan.py). Both get bucketed here from the full library,
        # plus a "lora" aggregate covering every LoRA regardless of subfolder.
        lora_styles = [s for s in all_styles if s.get("source_file") == LORA_SOURCE]
        for s in lora_styles:
            key = (s.get("category") or "").lower()
            styles_by_cat.setdefault(key, []).append(s)
        if lora_styles:
            styles_by_cat["lora"] = lora_styles

        for i in range(len(p.all_prompts)):
            p.all_prompts[i] = dedup_prompt(resolve_sg_wildcards(p.all_prompts[i], styles_by_cat))
        for i in range(len(p.all_negative_prompts)):
            p.all_negative_prompts[i] = dedup_prompt(resolve_sg_wildcards(p.all_negative_prompts[i], styles_by_cat, field="negative_prompt"))
