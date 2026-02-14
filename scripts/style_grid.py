"""
Style Grid - Grid/Gallery style selector for Stable Diffusion WebUI Forge.
Uses StyleScanner (style_matrix) for multi-source CSV loading.
"""

import json
import logging
import gradio as gr
from modules import scripts, script_callbacks

from .style_matrix import StyleScanner, merge_styles_by_priority

logger = logging.getLogger(__name__)


def categorize_styles(styles):
    """
    Group styles by category prefix. Mutates each style with category and display_name.
    Returns dict category -> list of style dicts.
    """
    categories = {}
    for s in styles:
        name = s.get("name", "")
        parts = name.split("_", 1)
        if len(parts) == 2 and parts[0].isupper() and len(parts[0]) >= 2:
            cat = parts[0]
            display = parts[1].replace("_", " ")
        else:
            cat = "OTHER"
            display = name.replace("_", " ")
        s["category"] = cat
        s["display_name"] = display
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(s)
    return categories


def get_styles_data():
    """Return (sources, styles) from StyleScanner. API/UI use this."""
    scanner = StyleScanner()
    return scanner.scan()


def get_merged_styles():
    """Return a single list of styles with duplicates resolved by source priority (for apply logic)."""
    _, styles = get_styles_data()
    return merge_styles_by_priority(styles)


# ---------------------------------------------------------------------------
# API (no arguments; frontend does not call_api these - uses hidden textbox)
# ---------------------------------------------------------------------------

def register_api(_demo, app):
    @app.get("/style_grid/get_styles")
    async def get_styles():
        """Returns style data. Accepts no parameters (GET)."""
        sources, styles = get_styles_data()
        return {"sources": sources, "styles": styles}

    @app.post("/style_grid/reload")
    async def reload_styles():
        """Reload and return style data. Accepts no body (POST)."""
        sources, styles = get_styles_data()
        return {"sources": sources, "styles": styles}


script_callbacks.on_app_started(register_api)


# ---------------------------------------------------------------------------
# Script
# ---------------------------------------------------------------------------

class StyleGridScript(scripts.Script):
    def title(self):
        return "Style Grid"

    def show(self, is_img2img):
        return scripts.AlwaysVisible

    def ui(self, is_img2img):
        tab_prefix = "img2img" if is_img2img else "txt2img"
        sources, raw_styles = get_styles_data()
        payload = {"sources": sources, "styles": raw_styles}
        styles_json = json.dumps(payload, ensure_ascii=False)

        category_order = [
            "BASE", "STYLE", "SCENE", "THEME", "POSE",
            "LIGHTING", "COLOR", "CAMERA", "OTHER",
        ]

        with gr.Group(elem_id=f"style_grid_wrapper_{tab_prefix}", visible=False):
            styles_data = gr.Textbox(
                value=styles_json,
                visible=False,
                elem_id=f"style_grid_data_{tab_prefix}",
            )
            selected_styles = gr.Textbox(
                value="[]",
                visible=False,
                elem_id=f"style_grid_selected_{tab_prefix}",
            )
            apply_trigger = gr.Button(visible=False, elem_id=f"style_grid_apply_trigger_{tab_prefix}")

        with gr.Group(visible=False):
            cat_order = gr.Textbox(
                value=json.dumps(category_order),
                visible=False,
                elem_id=f"style_grid_cat_order_{tab_prefix}",
            )

        def apply_styles(selected_json, prompt, neg_prompt):
            try:
                selected_names = json.loads(selected_json)
            except Exception:
                selected_names = []
            if not selected_names:
                return prompt, neg_prompt
            style_map = {s["name"]: s for s in get_merged_styles()}
            prompts_to_add = []
            neg_prompts_to_add = []
            for name in selected_names:
                if name not in style_map:
                    continue
                s = style_map[name]
                if s.get("prompt"):
                    if "{prompt}" in s["prompt"]:
                        prompt = s["prompt"].replace("{prompt}", prompt)
                    else:
                        prompts_to_add.append(s["prompt"])
                if s.get("negative_prompt"):
                    if "{prompt}" in s["negative_prompt"]:
                        neg_prompt = s["negative_prompt"].replace("{prompt}", neg_prompt)
                    else:
                        neg_prompts_to_add.append(s["negative_prompt"])
            if prompts_to_add:
                sep = ", " if prompt.strip() else ""
                prompt = prompt.rstrip(", ") + sep + ", ".join(prompts_to_add)
            if neg_prompts_to_add:
                sep = ", " if neg_prompt.strip() else ""
                neg_prompt = neg_prompt.rstrip(", ") + sep + ", ".join(neg_prompts_to_add)
            return prompt, neg_prompt

        return [selected_styles]

    def process(self, p, selected_json_str=None):
        if not selected_json_str:
            return
        try:
            selected_names = json.loads(selected_json_str)
        except Exception:
            return
        if not selected_names or not isinstance(selected_names, list):
            return
        style_map = {s["name"]: s for s in get_merged_styles()}
        applied = 0

        def apply_to_text(text, style_text):
            if not style_text:
                return text
            if "{prompt}" in style_text:
                return style_text.replace("{prompt}", text)
            sep = ", " if text.strip() else ""
            return text.rstrip(", ") + sep + style_text

        for name in selected_names:
            if name not in style_map:
                continue
            s = style_map[name]
            applied += 1
            p.prompt = apply_to_text(p.prompt, s.get("prompt", ""))
            p.negative_prompt = apply_to_text(p.negative_prompt, s.get("negative_prompt", ""))

        if applied > 0:
            for attr, key in [("all_prompts", "prompt"), ("all_negative_prompts", "negative_prompt")]:
                prompts = getattr(p, attr, None)
                if not prompts:
                    continue
                for i in range(len(prompts)):
                    for n in selected_names:
                        if n not in style_map:
                            continue
                        prompts[i] = apply_to_text(prompts[i], style_map[n].get(key, ""))
            logger.info("Silent mode: applied %d styles", applied)
