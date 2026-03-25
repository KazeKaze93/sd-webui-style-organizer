"""
Style Grid - Grid/Gallery style selector for Stable Diffusion WebUI Forge
Replaces the clunky dropdown with a visual grid organized by categories.

Implementation lives in the `stylegrid` package; this file is the Forge script entry point.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import json

import gradio as gr  # type: ignore[reportMissingImports]
from modules import script_callbacks, scripts  # type: ignore[reportMissingImports]
from modules.processing import StableDiffusionProcessing  # type: ignore[reportMissingImports]
from stylegrid.cache import get_cached_styles
from stylegrid.config import DATA_DIR
from stylegrid.csv_io import categorize_styles, load_all_styles
from stylegrid.data_files import increment_usage, load_presets, load_usage
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
            styles_data = gr.Textbox(value=styles_json, visible=False, elem_id=f"style_grid_data_{tab_prefix}")
            selected_styles = gr.Textbox(value="[]", visible=False, elem_id=f"style_grid_selected_{tab_prefix}")
            silent_styles = gr.Textbox(value="[]", visible=False, elem_id=f"style_grid_silent_{tab_prefix}")
            gr.Button(visible=False, elem_id=f"style_grid_apply_trigger_{tab_prefix}")
        with gr.Group(visible=False):
            gr.Textbox(value=json.dumps(category_order), visible=False, elem_id=f"style_grid_cat_order_{tab_prefix}")
        return [silent_styles]

    def process(self, p: StableDiffusionProcessing, *args):
        """Silent mode: inject styles into prompt at generation time."""
        all_styles = list(get_cached_styles())
        categorize_styles(all_styles)
        styles_by_cat = {}
        for s in all_styles:
            key = (s.get("category") or "").lower()
            styles_by_cat.setdefault(key, []).append(s)
        for i in range(len(p.all_prompts)):
            p.all_prompts[i] = resolve_sg_wildcards(p.all_prompts[i], styles_by_cat)
        for i in range(len(p.all_negative_prompts)):
            p.all_negative_prompts[i] = resolve_sg_wildcards(p.all_negative_prompts[i], styles_by_cat)

        if len(args) < 1:
            return
        silent_json = args[0]
        if not silent_json or silent_json == "[]":
            return
        try:
            style_names = json.loads(silent_json)
        except Exception:
            return
        if not style_names or not isinstance(style_names, list):
            return
        style_map = {s["name"]: s for s in all_styles}
        prompts_add = []
        neg_add = []
        for name in style_names:
            s = style_map.get(name)
            if not s:
                continue
            if s["prompt"]:
                if "{prompt}" in s["prompt"]:
                    for i in range(len(p.all_prompts)):
                        p.all_prompts[i] = s["prompt"].replace("{prompt}", p.all_prompts[i])
                else:
                    prompts_add.append(s["prompt"])
            if s["negative_prompt"]:
                if "{prompt}" in s["negative_prompt"]:
                    for i in range(len(p.all_negative_prompts)):
                        p.all_negative_prompts[i] = s["negative_prompt"].replace("{prompt}", p.all_negative_prompts[i])
                else:
                    neg_add.append(s["negative_prompt"])
        if prompts_add:
            style_tags = [t.strip() for s in prompts_add for t in s.split(",") if t.strip()]
            for i in range(len(p.all_prompts)):
                current_tags = [t.strip() for t in p.all_prompts[i].split(",") if t.strip()]
                seen = {t.lower() for t in current_tags}
                result = list(current_tags)
                for t in style_tags:
                    if t.lower() not in seen:
                        result.append(t)
                        seen.add(t.lower())
                p.all_prompts[i] = ", ".join(result)
        if neg_add:
            style_neg_tags = [t.strip() for s in neg_add for t in s.split(",") if t.strip()]
            for i in range(len(p.all_negative_prompts)):
                current_tags = [t.strip() for t in p.all_negative_prompts[i].split(",") if t.strip()]
                seen = {t.lower() for t in current_tags}
                result = list(current_tags)
                for t in style_neg_tags:
                    if t.lower() not in seen:
                        result.append(t)
                        seen.add(t.lower())
                p.all_negative_prompts[i] = ", ".join(result)
        p.extra_generation_params["Style Grid"] = ", ".join(style_names)
        increment_usage(style_names)
