"""FastAPI routes for Style Grid."""

import base64
import csv
import hashlib
import io
import json
import os
import re
import time
import zipfile
from pathlib import Path

from fastapi import HTTPException, Request  # type: ignore[reportMissingImports]
from fastapi.responses import (  # type: ignore[reportMissingImports]
    FileResponse,
    HTMLResponse,
    JSONResponse,
    Response,
)

from stylegrid.cache import (
    check_files_changed,
    get_cached_styles,
    invalidate_styles_cache,
    styles_cache_hashes,
)
from stylegrid.config import DATA_DIR, EXT_DIR, THUMBNAILS_DIR, get_all_styles_file_paths, is_samples_source
from stylegrid.csv_io import (
    categorize_styles,
    delete_style_from_csv,
    load_all_styles,
    normalize_source_path,
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
from stylegrid.lora_scan import (
    LORA_SOURCE,
    get_cached_lora_styles,
    get_lora_model_ids,
    get_lora_preview_path,
    invalidate_lora_cache,
    lora_scan_status,
)
from stylegrid.lora_titles import title_fetch_manager


def detect_conflicts(style_names):
    all_styles = get_cached_styles()
    # Composite identity — same name from different CSVs must not collapse.
    styles_map = {
        (s["name"], normalize_source_path(s.get("source_file") or "")): s
        for s in all_styles
    }
    # Name-only fallback for legacy bare-string request entries (last match wins).
    styles_by_name = {s["name"]: s for s in all_styles}
    conflicts = []
    style_tokens = {}
    for entry in style_names:
        s = None
        if isinstance(entry, str):
            s = styles_by_name.get(entry)
        elif isinstance(entry, dict):
            name = entry.get("name", "")
            if not isinstance(name, str) or not name:
                continue
            source_file = entry.get("source_file") or ""
            if isinstance(source_file, str) and source_file.strip():
                s = styles_map.get((name, normalize_source_path(source_file)))
                if not s:
                    s = styles_by_name.get(name)
            else:
                s = styles_by_name.get(name)
        else:
            continue
        if not s:
            continue
        key = (s["name"], normalize_source_path(s.get("source_file") or ""))
        if key in style_tokens:
            continue
        label = s["name"]
        style_tokens[key] = {"positive": set(), "negative": set(), "label": label}
        for token in (s.get("prompt") or "").split(","):
            t = token.strip().lower()
            if t and t != "{prompt}":
                style_tokens[key]["positive"].add(t)
        for token in (s.get("negative_prompt") or "").split(","):
            t = token.strip().lower()
            if t and t != "{prompt}":
                style_tokens[key]["negative"].add(t)
    keys = list(style_tokens.keys())
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            ka, kb = keys[i], keys[j]
            a = style_tokens[ka]["label"]
            b = style_tokens[kb]["label"]
            overlap1 = style_tokens[ka]["positive"] & style_tokens[kb]["negative"]
            if overlap1:
                conflicts.append({
                    "styles": [a, b],
                    "type": "positive_vs_negative",
                    "tokens": list(overlap1)[:5],
                    "message": f"'{a}' adds tokens that '{b}' negates: {', '.join(list(overlap1)[:3])}"
                })
            overlap2 = style_tokens[kb]["positive"] & style_tokens[ka]["negative"]
            if overlap2:
                conflicts.append({
                    "styles": [b, a],
                    "type": "positive_vs_negative",
                    "tokens": list(overlap2)[:5],
                    "message": f"'{b}' adds tokens that '{a}' negates: {', '.join(list(overlap2)[:3])}"
                })
    return conflicts


def _register_style_routes(app):
    """Register style list/reload/conflict/export/import/category-order routes."""
    @app.get("/style_grid/styles")
    async def get_styles(request: Request):
        styles = get_cached_styles()
        categories = categorize_styles(styles)
        etag_input = {
            "csv": styles_cache_hashes(),
            "lora": lora_scan_status(),
        }
        etag = hashlib.md5(json.dumps(etag_input, sort_keys=True, default=str).encode()).hexdigest()
        if_none_match = request.headers.get("If-None-Match", "").strip().strip('"')
        if if_none_match and if_none_match == etag:
            return Response(status_code=304)
        response = JSONResponse(content={"categories": categories, "usage": load_usage(), "presets": load_presets()})
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
    async def api_import(request: Request):
        raw = await request.body()
        if not raw:
            return {"ok": True}
        if len(raw) >= 2 and raw[:2] == b"PK":
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                    if "presets.json" in zf.namelist():
                        data = json.loads(zf.read("presets.json").decode("utf-8"))
                        if isinstance(data, dict):
                            save_presets(data)
            except Exception:
                pass
            return {"ok": True}
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            raise HTTPException(status_code=422, detail="Invalid JSON") from None
        if not isinstance(data, dict):
            return {"ok": True}
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
    """Register preset CRUD routes."""
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

    @app.get("/style_grid/presets/list")
    async def api_list_presets():
        return load_presets()


def _register_usage_routes(app):
    """Register usage stats routes."""
    @app.get("/style_grid/usage")
    async def get_usage_route():
        return load_usage()

    @app.post("/style_grid/usage/increment")
    async def api_increment(data: dict):
        increment_usage(data.get("styles", []))
        return {"ok": True}


def _register_crud_routes(app):
    """Register style save/delete and backup routes."""
    @app.post("/style_grid/style/save")
    async def api_save_style(data: dict):
        name = data.get("name", "").strip()
        if not name:
            return {"error": "Name required"}

        # FIX A: reject writes into read-only samples/
        source = data.get("source")
        resolved_path = None
        if source:
            source_base = os.path.basename(source)
            if not source_base.lower().endswith(".csv"):
                source_base = source_base + ".csv"
            for fp in get_all_styles_file_paths():
                if os.path.basename(fp) == source_base:
                    resolved_path = fp
                    break
        if resolved_path and is_samples_source(resolved_path):
            return JSONResponse(
                {"ok": False, "error": "Cannot modify styles from the read-only samples/ pack."},
                status_code=403,
            )

        # FIX B: surface LoRA/validation ValueError as 400
        try:
            save_style_to_csv(
                name,
                data.get("prompt", ""),
                data.get("negative_prompt", ""),
                data.get("description", ""),
                data.get("source"),
                category=data.get("category"),
            )
        except ValueError as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
        return {"ok": True}

    @app.post("/style_grid/style/delete")
    async def api_del_style(data: dict):
        name = data.get("name", "").strip()
        if not name:
            return {"error": "Name required"}

        # FIX A: reject deletes from read-only samples/
        source = data.get("source")
        if not source:
            for s in load_all_styles():
                if s["name"] == name:
                    source = s.get("source", "styles.csv")
                    break
        resolved_path = None
        if source:
            source_base = os.path.basename(source)
            if not source_base.lower().endswith(".csv"):
                source_base = source_base + ".csv"
            for fp in get_all_styles_file_paths():
                if os.path.basename(fp) == source_base:
                    resolved_path = fp
                    break
        if resolved_path and is_samples_source(resolved_path):
            return JSONResponse(
                {"ok": False, "error": "Cannot modify styles from the read-only samples/ pack."},
                status_code=403,
            )

        # FIX B: surface LoRA/validation ValueError as 400
        try:
            delete_style_from_csv(name, data.get("source"))
        except ValueError as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
        return {"ok": True}

    @app.post("/style_grid/backup")
    async def api_backup():
        try:
            return {"ok": backup_csv_files()}
        except Exception as e:
            return {"error": str(e)}


def _register_thumbnail_routes(app):
    """Register thumbnail list/get/upload/generate/delete/cleanup routes."""
    mgr = thumbnail_generation_manager

    @app.get("/style_grid/thumbnails/list")
    async def api_list_thumbnails():
        return {"has_thumbnail": list_thumbnails()}

    @app.get("/style_grid/thumbnail")
    async def api_get_thumbnail(name: str = "", source: str = ""):
        # LoRA cards: serve the literal preview file found next to the model
        # (if any) — never the generated-thumbnail pipeline below.
        if source == LORA_SOURCE or name.startswith("LORA_"):
            lora_preview = get_lora_preview_path(name)
            if lora_preview and os.path.isfile(lora_preview):
                ext = os.path.splitext(lora_preview)[1].lower().lstrip(".")
                media_type = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
                return FileResponse(
                    lora_preview,
                    media_type=media_type,
                    headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
                )
            return Response(status_code=404)

        if not source:
            return JSONResponse(
                {"ok": False, "error": "source is required for CSV thumbnails"},
                status_code=400,
            )

        path = get_thumbnail_path(name, source)
        if os.path.isfile(path):
            return FileResponse(
                path,
                media_type="image/webp",
                headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
            )

        return Response(status_code=404)

    @app.post("/style_grid/thumbnail/upload")
    async def api_upload_thumbnail(data: dict):
        style_name = data.get("name", "").strip()
        image_data = data.get("image", "")
        source = (data.get("source") or "").strip()
        if source == LORA_SOURCE or style_name.startswith("LORA_"):
            return {"error": "LoRA thumbnails come from the model's own preview file and can't be replaced here."}
        if not style_name or not image_data:
            return {"error": "name and image required"}
        if not source:
            return JSONResponse(
                {"ok": False, "error": "source is required for CSV thumbnails"},
                status_code=400,
            )
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
            path = get_thumbnail_path(style_name, source)
            try:
                from PIL import Image  # type: ignore[reportMissingImports]
                img = Image.open(io.BytesIO(raw))
                if getattr(img, "is_animated", False):
                    img.seek(0)
                has_alpha = (
                    img.mode in ("RGBA", "LA")
                    or (img.mode == "P" and "transparency" in img.info)
                )
                img = img.convert("RGBA" if has_alpha else "RGB")
                buf = io.BytesIO()
                img.save(buf, "WEBP", quality=85)
                webp_bytes = buf.getvalue()
            except Exception as e:
                return JSONResponse(
                    {"ok": False, "error": f"Failed to convert image to WebP: {e}"},
                    status_code=400,
                )
            tmp_path = path + ".tmp"
            with open(tmp_path, "wb") as f:
                f.write(webp_bytes)
            os.replace(tmp_path, path)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    @app.get("/style_grid/thumbnail/gen_status")
    async def api_gen_status(job_id: str = ""):
        if not job_id:
            return JSONResponse(
                {"ok": False, "error": "job_id is required"},
                status_code=400,
            )
        return mgr.get_status(job_id)

    @app.post("/style_grid/thumbnail/generate")
    async def api_generate_thumbnail(data: dict):
        style_name = data.get("name", "").strip()
        requested_source = data.get("source", "").strip()
        if requested_source == LORA_SOURCE or style_name.startswith("LORA_"):
            return {"error": "LoRA cards only show their own preview file; SD-generated previews are disabled for them."}
        if not style_name:
            return {"error": "name required"}
        if not requested_source:
            return JSONResponse(
                {"ok": False, "error": "source is required for CSV thumbnails"},
                status_code=400,
            )

        try:
            job_id = mgr.enqueue(style_name, requested_source)
        except ValueError as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
        return {"ok": True, "job_id": job_id, "status": "queued"}

    @app.post("/style_grid/thumbnail/cancel")
    async def api_cancel_thumbnail(data: dict):
        job_id = (data.get("job_id") or "").strip()
        if not job_id:
            return JSONResponse(
                {"ok": False, "error": "job_id is required"},
                status_code=400,
            )
        return {"ok": mgr.cancel(job_id)}

    @app.delete("/style_grid/thumbnail")
    async def api_delete_thumbnail(name: str = "", source: str = ""):
        if not source:
            return JSONResponse(
                {"ok": False, "error": "source is required for CSV thumbnails"},
                status_code=400,
            )
        path = get_thumbnail_path(name, source)
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
        return {"removed": removed}


def _register_lora_routes(app):
    """Register LoRA directory rescan/status routes."""
    @app.post("/style_grid/lora/rescan")
    async def api_lora_rescan():
        invalidate_lora_cache()
        get_cached_lora_styles()
        styles = get_cached_styles()
        categories = categorize_styles(styles)
        return {"categories": categories, "lora": lora_scan_status()}

    @app.get("/style_grid/lora/status")
    async def api_lora_status():
        get_cached_lora_styles()
        return lora_scan_status()

    @app.post("/style_grid/lora/fetch_titles")
    async def api_lora_fetch_titles(data: dict = None):
        force = bool((data or {}).get("force"))
        model_ids = list(get_lora_model_ids().values())
        if not model_ids:
            return {"error": "No LoRAs with a modelId found (metadata missing or LoRA folder not scanned yet)"}
        if not title_fetch_manager.try_begin():
            return {"error": "already running"}
        title_fetch_manager.spawn(model_ids, force=force)
        return {"ok": True, "total_candidates": len(set(model_ids))}

    @app.get("/style_grid/lora/fetch_titles/status")
    async def api_lora_fetch_titles_status():
        return title_fetch_manager.get_status()


def _get_ui_html() -> str:
    """
    Load built UI index.html and rewrite every relative asset URL (src/href="./...")
    to the Gradio file URL with a fresh ?v= cache buster on each call.
    """
    html_path = Path(__file__).parent.parent / "ui" / "dist" / "index.html"
    html = html_path.read_text(encoding="utf-8")
    v = str(int(time.time()))
    base = "/file=extensions/sd-webui-style-organizer/ui/dist"
    pattern = re.compile(
        r'(?P<attr>\b(?:src|href))=(?P<q>["\'])(?P<path>\./[^"\']+)(?P=q)',
        re.IGNORECASE,
    )
    def _sub(m: re.Match) -> str:
        rel = m.group("path")[2:]
        q = m.group("q")
        return f'{m.group("attr")}={q}{base}/{rel}?v={v}{q}'

    return pattern.sub(_sub, html)


def _register_ui_routes(app):
    """Serve V2 React iframe HTML with cache-busted asset URLs."""

    @app.get("/style_grid/ui")
    async def serve_ui():
        return HTMLResponse(content=_get_ui_html())


def register_api(demo, app):
    """
    Register all Style Grid API groups on FastAPI app.

    Most handlers return HTTP 200 with `{ "error": ... }` payloads on logical failures;
    notable exceptions include `/styles` ETag 304 and `/thumbnail` 404.
    """
    _register_style_routes(app)
    _register_preset_routes(app)
    _register_usage_routes(app)
    _register_crud_routes(app)
    _register_thumbnail_routes(app)
    _register_lora_routes(app)
    _register_ui_routes(app)
