"""FastAPI routes for Style Grid."""

import base64
import csv
import hashlib
import json
import logging
import os
import time

from fastapi import Request  # type: ignore[reportMissingImports]
from fastapi.responses import (  # type: ignore[reportMissingImports]
    FileResponse,
    JSONResponse,
    Response,
)

from stylegrid.cache import (
    check_files_changed,
    get_cached_styles,
    invalidate_styles_cache,
    styles_cache_hashes,
)
from stylegrid.config import DATA_DIR, EXT_DIR, THUMBNAILS_DIR
from stylegrid.csv_io import (
    categorize_styles,
    delete_style_from_csv,
    load_all_styles,
    save_style_to_csv,
)
from stylegrid.data_files import (
    backup_csv_files,
    increment_usage,
    load_presets,
    load_usage,
    save_presets,
)
from stylegrid.thumbnails import (
    _thumbnail_hash_input,
    get_thumbnail_path,
    list_thumbnails,
    thumbnail_generation_manager,
)

logger = logging.getLogger(__name__)


def detect_conflicts(style_names):
    styles_map = {s["name"]: s for s in get_cached_styles()}
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


def _register_style_routes(app):
    @app.get("/style_grid/styles")
    async def get_styles(request: Request):
        styles = get_cached_styles()
        categories = categorize_styles(styles)
        etag = hashlib.md5(json.dumps(styles_cache_hashes(), sort_keys=True).encode()).hexdigest()
        if_none_match = request.headers.get("If-None-Match", "").strip().strip('"')
        if if_none_match and if_none_match == etag:
            return Response(status_code=304)
        response = JSONResponse(content={"categories": categories, "usage": load_usage()})
        response.headers["ETag"] = etag
        return response

    @app.post("/style_grid/reload")
    async def reload_styles():
        check_files_changed()
        invalidate_styles_cache()
        styles = get_cached_styles()
        categories = categorize_styles(styles)
        return {"categories": categories, "usage": load_usage()}

    @app.get("/style_grid/check_update")
    async def api_check_update():
        return {"changed": check_files_changed()}

    @app.post("/style_grid/conflicts")
    async def api_conflicts(data: dict):
        return {"conflicts": detect_conflicts(data.get("styles", []))}

    @app.get("/style_grid/export")
    async def api_export():
        return {
            "styles": load_all_styles(),
            "presets": load_presets(),
            "usage": load_usage(),
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }

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
                w.writerow(["name", "prompt", "negative_prompt", "description", "category"])
                for s in data["styles"]:
                    w.writerow([
                        s.get("name", ""),
                        s.get("prompt", ""),
                        s.get("negative_prompt", ""),
                        s.get("description", ""),
                        s.get("category", "") or s.get("category_explicit", ""),
                    ])
            invalidate_styles_cache()
        return {"ok": True}

    @app.post("/style_grid/category_order/save")
    async def api_save_category_order(data: dict):
        order = data.get("order", [])
        if not isinstance(order, list):
            return {"error": "order must be a list"}
        order_file = os.path.join(DATA_DIR, "category_order.json")
        with open(order_file, "w", encoding="utf-8") as f:
            json.dump(order, f, indent=2, ensure_ascii=False)
        return {"ok": True}


def _register_preset_routes(app):
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


def _register_usage_routes(app):
    @app.get("/style_grid/usage")
    async def get_usage_route():
        return load_usage()

    @app.post("/style_grid/usage/increment")
    async def api_increment(data: dict):
        increment_usage(data.get("styles", []))
        return {"ok": True}


def _register_crud_routes(app):
    @app.post("/style_grid/style/save")
    async def api_save_style(data: dict):
        name = data.get("name", "").strip()
        if not name:
            return {"error": "Name required"}
        save_style_to_csv(
            name,
            data.get("prompt", ""),
            data.get("negative_prompt", ""),
            data.get("description", ""),
            data.get("source"),
            category=data.get("category"),
        )
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


def _register_thumbnail_routes(app):
    mgr = thumbnail_generation_manager

    @app.get("/style_grid/thumbnails/list")
    async def api_list_thumbnails():
        return {"has_thumbnail": list(list_thumbnails())}

    @app.get("/style_grid/thumbnail")
    async def api_get_thumbnail(name: str = ""):
        path = get_thumbnail_path(name)
        exists = os.path.isfile(path)
        logger.debug("[Style Grid] GET thumbnail: name=%r, path=%s, exists=%s", name, path, exists)
        if not exists:
            return Response(status_code=404)
        return FileResponse(
            path,
            media_type="image/webp",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
        )

    @app.post("/style_grid/thumbnail/upload")
    async def api_upload_thumbnail(data: dict):
        style_name = data.get("name", "").strip()
        image_data = data.get("image", "")
        if not style_name or not image_data:
            return {"error": "name and image required"}
        try:
            if "," in image_data:
                image_data = image_data.split(",", 1)[1]
            raw = base64.b64decode(image_data)
            if len(raw) > 2 * 1024 * 1024:
                return {"error": "Image too large (max 2MB)"}
            ALLOWED_MAGIC = [
                b'\xff\xd8\xff',
                b'\x89PNG\r\n\x1a\n',
                b'RIFF',
                b'GIF87a',
                b'GIF89a',
            ]
            is_valid_image = any(raw.startswith(m) for m in ALLOWED_MAGIC)
            if raw.startswith(b'RIFF') and raw[8:12] != b'WEBP':
                is_valid_image = False
            if not is_valid_image:
                return {"error": "Invalid image format. Allowed: JPEG, PNG, WEBP, GIF"}
            path = get_thumbnail_path(style_name)
            with open(path, "wb") as f:
                f.write(raw)
            logger.debug("[Style Grid] Thumbnail uploaded: %s", path)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    @app.get("/style_grid/thumbnail/gen_status")
    async def api_gen_status(name: str = ""):
        style_name = name
        return mgr.get_status(style_name)

    @app.post("/style_grid/thumbnail/generate")
    async def api_generate_thumbnail(data: dict):
        style_name = data.get("name", "").strip()
        if not style_name:
            return {"error": "name required"}

        try:
            from modules.shared import state as forge_state  # type: ignore[reportMissingImports]
            if getattr(forge_state, 'job', None):
                return {"error": "SD is busy, try again after current generation finishes"}
        except Exception:
            pass

        if not mgr.try_begin(style_name):
            return {"error": "already generating"}

        mgr.spawn_generate(style_name)
        return {"ok": True, "status": "running"}

    @app.delete("/style_grid/thumbnail")
    async def api_delete_thumbnail(name: str = ""):
        path = get_thumbnail_path(name)
        if os.path.isfile(path):
            os.remove(path)
        return {"ok": True}

    @app.post("/style_grid/thumbnails/cleanup")
    async def api_cleanup_thumbnails():
        """Remove thumbnails for styles that no longer exist in any CSV."""
        if not os.path.isdir(THUMBNAILS_DIR):
            return {"removed": 0}
        valid_hashes = set()
        for s in get_cached_styles():
            h = hashlib.md5(
                _thumbnail_hash_input(s["name"], s.get("source_file") or "").encode("utf-8")
            ).hexdigest()
            valid_hashes.add(h)
        removed = 0
        for fname in os.listdir(THUMBNAILS_DIR):
            if not fname.endswith(".webp"):
                continue
            h = os.path.splitext(fname)[0]
            if h not in valid_hashes:
                try:
                    os.remove(os.path.join(THUMBNAILS_DIR, fname))
                    removed += 1
                except Exception:
                    pass
        logger.debug("[Style Grid] Thumbnail cleanup: removed %s orphaned files", removed)
        return {"removed": removed}


def register_api(demo, app):
    _register_style_routes(app)
    _register_preset_routes(app)
    _register_usage_routes(app)
    _register_crud_routes(app)
    _register_thumbnail_routes(app)
