"""
Style Grid - Grid/Gallery style selector for Stable Diffusion WebUI Forge
Replaces the clunky dropdown with a visual grid organized by categories.
"""

import os
import csv
import json
import time
import shutil
import hashlib
import gradio as gr
from modules import scripts, shared, script_callbacks
from modules.processing import StableDiffusionProcessing

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
EXT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(EXT_DIR, "data")
PRESETS_FILE = os.path.join(DATA_DIR, "presets.json")
USAGE_FILE = os.path.join(DATA_DIR, "usage.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
THUMBNAILS_DIR = os.path.join(EXT_DIR, "thumbnails")

for _d in [DATA_DIR, BACKUP_DIR, THUMBNAILS_DIR]:
    os.makedirs(_d, exist_ok=True)

# ---------------------------------------------------------------------------
# File hash tracking for dynamic updates
# ---------------------------------------------------------------------------
_file_hashes = {}

def _hash_file(path):
    try:
        h = hashlib.md5()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None

def check_files_changed():
    global _file_hashes
    changed = False
    current = {}
    for d in get_styles_dirs():
        if not os.path.isdir(d):
            continue
        for fname in os.listdir(d):
            if fname.lower().endswith(".csv"):
                fp = os.path.join(d, fname)
                h = _hash_file(fp)
                current[fp] = h
                if fp not in _file_hashes or _file_hashes[fp] != h:
                    changed = True
    if set(_file_hashes.keys()) != set(current.keys()):
        changed = True
    _file_hashes = current
    return changed


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_styles_dirs():
    ext_styles_dir = os.path.join(EXT_DIR, "styles")
    root_dir = os.path.abspath(
        getattr(shared.cmd_opts, "data_path", None) or os.getcwd()
    )
    return [ext_styles_dir, root_dir]


def parse_styles_csv(filepath):
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
    all_styles = []
    seen_names = set()
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
    root_csv = os.path.join(os.getcwd(), "styles.csv")
    if os.path.isfile(root_csv):
        for s in parse_styles_csv(root_csv):
            if s["name"] not in seen_names:
                seen_names.add(s["name"])
                all_styles.append(s)
    return all_styles


def _category_from_filename(source):
    if not source or not isinstance(source, str):
        return ""
    base = os.path.splitext(source.strip())[0].strip()
    if not base:
        return ""
    return base[0].upper() + base[1:]


def categorize_styles(styles):
    categories = {}
    for s in styles:
        name = s["name"]
        source = s.get("source") or ""
        if "_" in name:
            before, rest = name.split("_", 1)
            cat = before.upper()
            display = rest.replace("_", " ")
        elif "-" in name:
            before, rest = name.split("-", 1)
            cat = before
            display = rest.replace("-", " ")
        else:
            cat = _category_from_filename(source)
            if not cat:
                cat = "OTHER"
            display = name.replace("_", " ")
        s["category"] = cat
        s["display_name"] = display
        s["has_placeholder"] = "{prompt}" in (s.get("prompt") or "") or "{prompt}" in (s.get("negative_prompt") or "")
        # Check thumbnail
        thumb_name = name.replace(" ", "_").replace("/", "_").replace("\\", "_")
        for ext in [".png", ".jpg", ".jpeg", ".webp"]:
            thumb_path = os.path.join(THUMBNAILS_DIR, thumb_name + ext)
            if os.path.isfile(thumb_path):
                s["thumbnail"] = f"/file={thumb_path}"
                break
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(s)
    for cat in categories:
        categories[cat].sort(key=lambda x: (x.get("display_name") or x["name"] or "").lower())
    return categories


# ---------------------------------------------------------------------------
# Presets
# ---------------------------------------------------------------------------
def load_presets():
    if os.path.isfile(PRESETS_FILE):
        try:
            with open(PRESETS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_presets(presets):
    with open(PRESETS_FILE, "w", encoding="utf-8") as f:
        json.dump(presets, f, indent=2, ensure_ascii=False)

# ---------------------------------------------------------------------------
# Usage stats
# ---------------------------------------------------------------------------
def load_usage():
    if os.path.isfile(USAGE_FILE):
        try:
            with open(USAGE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_usage(usage):
    with open(USAGE_FILE, "w", encoding="utf-8") as f:
        json.dump(usage, f, indent=2, ensure_ascii=False)

def increment_usage(style_names):
    usage = load_usage()
    ts = time.strftime("%Y-%m-%dT%H:%M:%S")
    for name in style_names:
        if name not in usage:
            usage[name] = {"count": 0, "last_used": None, "first_used": ts}
        usage[name]["count"] = usage[name].get("count", 0) + 1
        usage[name]["last_used"] = ts
    save_usage(usage)

# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------
def backup_csv_files():
    ts = time.strftime("%Y%m%d_%H%M%S")
    backup_subdir = os.path.join(BACKUP_DIR, ts)
    backed_up = False
    for d in get_styles_dirs():
        if not os.path.isdir(d):
            continue
        for fname in os.listdir(d):
            if fname.lower().endswith(".csv"):
                if not backed_up:
                    os.makedirs(backup_subdir, exist_ok=True)
                    backed_up = True
                shutil.copy2(os.path.join(d, fname), os.path.join(backup_subdir, fname))
    if os.path.isdir(BACKUP_DIR):
        backups = sorted(os.listdir(BACKUP_DIR))
        while len(backups) > 20:
            old_path = os.path.join(BACKUP_DIR, backups.pop(0))
            if os.path.isdir(old_path):
                shutil.rmtree(old_path, ignore_errors=True)
    return backed_up

# ---------------------------------------------------------------------------
# Conflict detection
# ---------------------------------------------------------------------------
def detect_conflicts(style_names):
    styles_map = {s["name"]: s for s in load_all_styles()}
    conflicts = []
    style_tokens = {}
    for name in style_names:
        s = styles_map.get(name)
        if not s:
            continue
        style_tokens[name] = {"positive": set(), "negative": set()}
        for token in (s.get("prompt") or "").split(","):
            t = token.strip().lower()
            if t and t != "{prompt}":
                style_tokens[name]["positive"].add(t)
        for token in (s.get("negative_prompt") or "").split(","):
            t = token.strip().lower()
            if t and t != "{prompt}":
                style_tokens[name]["negative"].add(t)
    names = list(style_tokens.keys())
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            overlap1 = style_tokens[a]["positive"] & style_tokens[b]["negative"]
            if overlap1:
                conflicts.append({
                    "styles": [a, b],
                    "type": "positive_vs_negative",
                    "tokens": list(overlap1)[:5],
                    "message": f"'{a}' adds tokens that '{b}' negates: {', '.join(list(overlap1)[:3])}"
                })
            overlap2 = style_tokens[b]["positive"] & style_tokens[a]["negative"]
            if overlap2:
                conflicts.append({
                    "styles": [b, a],
                    "type": "positive_vs_negative",
                    "tokens": list(overlap2)[:5],
                    "message": f"'{b}' adds tokens that '{a}' negates: {', '.join(list(overlap2)[:3])}"
                })
    return conflicts

# ---------------------------------------------------------------------------
# Style CRUD
# ---------------------------------------------------------------------------
def save_style_to_csv(name, prompt, negative_prompt, source_file=None):
    if not source_file:
        source_file = "styles.csv"
    target_path = None
    for d in get_styles_dirs():
        fp = os.path.join(d, source_file)
        if os.path.isfile(fp):
            target_path = fp
            break
    if not target_path:
        ext_styles = os.path.join(EXT_DIR, "styles")
        os.makedirs(ext_styles, exist_ok=True)
        target_path = os.path.join(ext_styles, source_file)
    backup_csv_files()
    rows = []
    header = None
    if os.path.isfile(target_path):
        with open(target_path, "r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            for row in reader:
                if header is None and row and row[0].strip().lower() == "name":
                    header = row
                    continue
                rows.append(row)
    if not header:
        header = ["name", "prompt", "negative_prompt"]
    found = False
    for i, row in enumerate(rows):
        if row and row[0].strip() == name:
            rows[i] = [name, prompt, negative_prompt]
            found = True
            break
    if not found:
        rows.append([name, prompt, negative_prompt])
    with open(target_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        for row in rows:
            writer.writerow(row)
    return True

def delete_style_from_csv(name, source_file=None):
    if not source_file:
        for s in load_all_styles():
            if s["name"] == name:
                source_file = s.get("source", "styles.csv")
                break
    if not source_file:
        return False
    target_path = None
    for d in get_styles_dirs():
        fp = os.path.join(d, source_file)
        if os.path.isfile(fp):
            target_path = fp
            break
    if not target_path:
        return False
    backup_csv_files()
    rows = []
    header = None
    with open(target_path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for row in reader:
            if header is None and row and row[0].strip().lower() == "name":
                header = row
                continue
            if row and row[0].strip() != name:
                rows.append(row)
    if not header:
        header = ["name", "prompt", "negative_prompt"]
    with open(target_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        for row in rows:
            writer.writerow(row)
    return True


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
def register_api(demo, app):
    @app.get("/style_grid/styles")
    async def get_styles():
        styles = load_all_styles()
        categories = categorize_styles(styles)
        return {"categories": categories, "usage": load_usage()}

    @app.post("/style_grid/reload")
    async def reload_styles():
        styles = load_all_styles()
        categories = categorize_styles(styles)
        return {"categories": categories, "usage": load_usage()}

    @app.get("/style_grid/check_update")
    async def api_check_update():
        return {"changed": check_files_changed()}

    @app.get("/style_grid/presets")
    async def get_presets():
        return load_presets()

    @app.post("/style_grid/presets/save")
    async def api_save_preset(data: dict):
        presets = load_presets()
        name = data.get("name", "").strip()
        styles = data.get("styles", [])
        if not name:
            return {"error": "Name required"}
        presets[name] = {"styles": styles, "created": time.strftime("%Y-%m-%dT%H:%M:%S")}
        save_presets(presets)
        return {"ok": True, "presets": presets}

    @app.post("/style_grid/presets/delete")
    async def api_delete_preset(data: dict):
        presets = load_presets()
        name = data.get("name", "")
        if name in presets:
            del presets[name]
            save_presets(presets)
        return {"ok": True, "presets": presets}

    @app.get("/style_grid/usage")
    async def get_usage():
        return load_usage()

    @app.post("/style_grid/usage/increment")
    async def api_increment(data: dict):
        increment_usage(data.get("styles", []))
        return {"ok": True}

    @app.post("/style_grid/conflicts")
    async def api_conflicts(data: dict):
        return {"conflicts": detect_conflicts(data.get("styles", []))}

    @app.post("/style_grid/style/save")
    async def api_save_style(data: dict):
        name = data.get("name", "").strip()
        if not name:
            return {"error": "Name required"}
        save_style_to_csv(name, data.get("prompt", ""), data.get("negative_prompt", ""), data.get("source"))
        return {"ok": True}

    @app.post("/style_grid/style/delete")
    async def api_del_style(data: dict):
        name = data.get("name", "").strip()
        if not name:
            return {"error": "Name required"}
        delete_style_from_csv(name, data.get("source"))
        return {"ok": True}

    @app.post("/style_grid/backup")
    async def api_backup():
        return {"ok": backup_csv_files()}

    @app.get("/style_grid/export")
    async def api_export():
        return {"styles": load_all_styles(), "presets": load_presets(), "usage": load_usage(), "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S")}

    @app.post("/style_grid/import")
    async def api_import(data: dict):
        if "presets" in data:
            p = load_presets()
            p.update(data["presets"])
            save_presets(p)
        if "styles" in data and data["styles"]:
            ext_styles = os.path.join(EXT_DIR, "styles")
            os.makedirs(ext_styles, exist_ok=True)
            target = os.path.join(ext_styles, f"imported_{time.strftime('%Y%m%d_%H%M%S')}.csv")
            with open(target, "w", encoding="utf-8", newline="") as f:
                w = csv.writer(f)
                w.writerow(["name", "prompt", "negative_prompt"])
                for s in data["styles"]:
                    w.writerow([s.get("name", ""), s.get("prompt", ""), s.get("negative_prompt", "")])
        return {"ok": True}

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
        styles = load_all_styles()
        categories = categorize_styles(styles)
        styles_json = json.dumps({
            "categories": categories,
            "usage": load_usage(),
            "presets": load_presets(),
        }, ensure_ascii=False)
        category_order = [
            "BASE", "BODY", "GENITALS", "BREASTS", "THEME",
            "RESTRAINTS", "POSE", "SCENE", "STYLE", "OTHER"
        ]
        with gr.Group(elem_id=f"style_grid_wrapper_{tab_prefix}", visible=False):
            styles_data = gr.Textbox(value=styles_json, visible=False, elem_id=f"style_grid_data_{tab_prefix}")
            selected_styles = gr.Textbox(value="[]", visible=False, elem_id=f"style_grid_selected_{tab_prefix}")
            silent_styles = gr.Textbox(value="[]", visible=False, elem_id=f"style_grid_silent_{tab_prefix}")
            apply_trigger = gr.Button(visible=False, elem_id=f"style_grid_apply_trigger_{tab_prefix}")
        with gr.Group(visible=False):
            cat_order = gr.Textbox(value=json.dumps(category_order), visible=False, elem_id=f"style_grid_cat_order_{tab_prefix}")
        return [styles_data, selected_styles, silent_styles]

    def process(self, p: StableDiffusionProcessing, *args):
        """Silent mode: inject styles into prompt at generation time."""
        if len(args) < 3:
            return
        silent_json = args[2]
        if not silent_json or silent_json == "[]":
            return
        try:
            style_names = json.loads(silent_json)
        except Exception:
            return
        if not style_names or not isinstance(style_names, list):
            return
        style_map = {s["name"]: s for s in load_all_styles()}
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
            addition = ", ".join(prompts_add)
            for i in range(len(p.all_prompts)):
                sep = ", " if p.all_prompts[i].strip() else ""
                p.all_prompts[i] = p.all_prompts[i].rstrip(", ") + sep + addition
        if neg_add:
            addition = ", ".join(neg_add)
            for i in range(len(p.all_negative_prompts)):
                sep = ", " if p.all_negative_prompts[i].strip() else ""
                p.all_negative_prompts[i] = p.all_negative_prompts[i].rstrip(", ") + sep + addition
        p.extra_generation_params["Style Grid"] = ", ".join(style_names)
        increment_usage(style_names)
