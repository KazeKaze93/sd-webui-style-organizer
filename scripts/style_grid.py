"""
Style Grid - Grid/Gallery style selector for Stable Diffusion WebUI Forge
Replaces the clunky dropdown with a visual grid organized by categories.
"""

import os
import csv
import json
import gradio as gr
from modules import scripts, shared, script_callbacks

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_styles_dirs():
    """Return list of directories that may contain style CSV files."""
    base = scripts.basedir()
    ext_styles_dir = os.path.join(base, "styles")
    root_dir = os.path.abspath(os.path.join(shared.cmd_opts.data_path if hasattr(shared.cmd_opts, 'data_path') else os.getcwd()))
    return [root_dir, ext_styles_dir]


def parse_styles_csv(filepath):
    """Parse a single CSV file and return list of style dicts."""
    styles = []
    if not os.path.isfile(filepath):
        return styles
    try:
        with open(filepath, "r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            header = None
            for row in reader:
                if not row or all(c.strip() == "" for c in row):
                    continue
                # Skip header row
                if header is None and row[0].strip().lower() == "name":
                    header = row
                    continue
                if header is None:
                    header = ["name", "prompt", "negative_prompt"]
                name = row[0].strip() if len(row) > 0 else ""
                prompt = row[1].strip() if len(row) > 1 else ""
                negative = row[2].strip() if len(row) > 2 else ""
                if name:
                    styles.append({
                        "name": name,
                        "prompt": prompt,
                        "negative_prompt": negative,
                        "source": os.path.basename(filepath),
                    })
    except Exception as e:
        print(f"[Style Grid] Error reading {filepath}: {e}")
    return styles


def load_all_styles():
    """Load styles from all CSV files in known locations."""
    all_styles = []
    seen_names = set()
    
    # 1. Root styles.csv (Forge default)
    for d in get_styles_dirs():
        if not os.path.isdir(d):
            continue
        for fname in sorted(os.listdir(d)):
            if fname.lower().endswith(".csv"):
                filepath = os.path.join(d, fname)
                for s in parse_styles_csv(filepath):
                    if s["name"] not in seen_names:
                        seen_names.add(s["name"])
                        all_styles.append(s)
    
    # Also try root styles.csv specifically
    root_csv = os.path.join(os.getcwd(), "styles.csv")
    if os.path.isfile(root_csv):
        for s in parse_styles_csv(root_csv):
            if s["name"] not in seen_names:
                seen_names.add(s["name"])
                all_styles.append(s)

    return all_styles


def categorize_styles(styles):
    """
    Group styles by category prefix. 
    E.g. 'BASE_Illustrious_Quality' -> category='BASE', display='Illustrious Quality'
    Styles without underscore prefix go to 'OTHER'.
    """
    categories = {}
    for s in styles:
        name = s["name"]
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


# ---------------------------------------------------------------------------
# API endpoint for fetching styles as JSON
# ---------------------------------------------------------------------------

def register_api(demo, app):
    """Register a FastAPI endpoint to serve styles data."""
    @app.get("/style_grid/styles")
    async def get_styles():
        styles = load_all_styles()
        categories = categorize_styles(styles)
        return {"categories": {k: v for k, v in categories.items()}}

    @app.post("/style_grid/reload")
    async def reload_styles():
        styles = load_all_styles()
        categories = categorize_styles(styles)
        return {"categories": {k: v for k, v in categories.items()}}

script_callbacks.on_app_started(register_api)


# ---------------------------------------------------------------------------
# Main Script class
# ---------------------------------------------------------------------------

class StyleGridScript(scripts.Script):
    def title(self):
        return "Style Grid"

    def show(self, is_img2img):
        return scripts.AlwaysVisible

    def ui(self, is_img2img):
        tab_prefix = "img2img" if is_img2img else "txt2img"

        # Load initial styles data
        styles = load_all_styles()
        categories = categorize_styles(styles)
        styles_json = json.dumps({"categories": categories}, ensure_ascii=False)
        
        # Define preferred category ordering
        category_order = [
            "BASE", "STYLE", "SCENE", "THEME", "POSE",
            "LIGHTING", "COLOR", "CAMERA", "OTHER"
        ]

        with gr.Group(elem_id=f"style_grid_wrapper_{tab_prefix}", visible=False):
            # Hidden components for data exchange with JS
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
            # Action triggers
            apply_trigger = gr.Button(
                visible=False,
                elem_id=f"style_grid_apply_trigger_{tab_prefix}",
            )
            
        # This hidden textbox holds the category order
        with gr.Group(visible=False):
            cat_order = gr.Textbox(
                value=json.dumps(category_order),
                visible=False,
                elem_id=f"style_grid_cat_order_{tab_prefix}",
            )

        # Apply styles: merge selected style prompts into the main prompt
        def apply_styles(selected_json, prompt, neg_prompt):
            try:
                selected_names = json.loads(selected_json)
            except Exception:
                selected_names = []
            
            if not selected_names:
                return prompt, neg_prompt

            style_map = {s["name"]: s for s in load_all_styles()}
            
            prompts_to_add = []
            neg_prompts_to_add = []
            
            for name in selected_names:
                if name in style_map:
                    s = style_map[name]
                    if s["prompt"]:
                        # Handle {prompt} placeholder
                        if "{prompt}" in s["prompt"]:
                            prompt = s["prompt"].replace("{prompt}", prompt)
                        else:
                            prompts_to_add.append(s["prompt"])
                    if s["negative_prompt"]:
                        if "{prompt}" in s["negative_prompt"]:
                            neg_prompt = s["negative_prompt"].replace("{prompt}", neg_prompt)
                        else:
                            neg_prompts_to_add.append(s["negative_prompt"])
            
            if prompts_to_add:
                separator = ", " if prompt.strip() else ""
                prompt = prompt.rstrip(", ") + separator + ", ".join(prompts_to_add)
            
            if neg_prompts_to_add:
                separator = ", " if neg_prompt.strip() else ""
                neg_prompt = neg_prompt.rstrip(", ") + separator + ", ".join(neg_prompts_to_add)
            
            return prompt, neg_prompt

        # Connect apply trigger
        if is_img2img:
            prompt_component = "img2img_prompt"
            neg_component = "img2img_neg_prompt"
        else:
            prompt_component = "txt2img_prompt"
            neg_component = "txt2img_neg_prompt"

        # We'll use JavaScript to handle the apply logic since we need
        # to access components by elem_id across the UI

        return [selected_styles]

    def process(self, p, selected_json_str=None):
        """
        In 'silent' apply mode, styles are applied here during generation.
        The JS frontend stores selected style names in the hidden Gradio component
        (selected_styles), and this method reads them and merges into the prompt
        at generation time. The user's prompt fields stay clean.
        """
        if not selected_json_str:
            return

        try:
            selected_names = json.loads(selected_json_str)
        except Exception:
            return

        if not selected_names or not isinstance(selected_names, list):
            return

        style_map = {s["name"]: s for s in load_all_styles()}
        applied = 0

        def apply_to_text(text, style_text):
            """Merge a style's prompt into existing text."""
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

            p.prompt = apply_to_text(p.prompt, s["prompt"])
            p.negative_prompt = apply_to_text(p.negative_prompt, s["negative_prompt"])

        # Also handle all_prompts / all_negative_prompts for batch processing
        if applied > 0:
            for attr, key in [("all_prompts", "prompt"), ("all_negative_prompts", "negative_prompt")]:
                prompts = getattr(p, attr, None)
                if not prompts:
                    continue
                for i in range(len(prompts)):
                    for name in selected_names:
                        if name not in style_map:
                            continue
                        prompts[i] = apply_to_text(prompts[i], style_map[name][key])

            print(f"[Style Grid] Silent mode: applied {applied} styles")
