"""Thumbnail file paths, listing, and background SD preview generation."""

import hashlib
import logging
import os
import threading

from stylegrid.cache import get_cached_styles
from stylegrid.config import THUMBNAILS_DIR, get_styles_dirs

logger = logging.getLogger(__name__)


def _thumbnail_hash_input(style_name, csv_path=""):
    """Stable string for thumbnail filename hash; empty csv_path keeps legacy name-only hash."""
    if not csv_path:
        return style_name
    ap = os.path.normpath(os.path.abspath(csv_path))
    rel = None
    for base in get_styles_dirs():
        try:
            b = os.path.normpath(os.path.abspath(base))
            r = os.path.relpath(ap, b)
            if not r.startswith(".."):
                rel = r.replace("\\", "/")
                break
        except ValueError:
            continue
    if rel is None:
        rel = os.path.basename(ap).replace("\\", "/")
    return f"{style_name}::{rel}"


def get_thumbnail_path(style_name, csv_path=""):
    """Return deterministic thumbnail file path using md5(name + source path) hash naming."""
    safe = hashlib.md5(_thumbnail_hash_input(style_name, csv_path).encode("utf-8")).hexdigest()
    return os.path.join(THUMBNAILS_DIR, safe + ".webp")


def list_thumbnails():
    if not os.path.isdir(THUMBNAILS_DIR):
        return set()
    hashes = {
        os.path.splitext(f)[0]
        for f in os.listdir(THUMBNAILS_DIR)
        if f.endswith(".webp")
    }
    result = set()
    for s in get_cached_styles():
        h = hashlib.md5(
            _thumbnail_hash_input(s["name"], s.get("source_file") or "").encode("utf-8")
        ).hexdigest()
        if h in hashes:
            result.add(s["name"])
    return result


class ThumbnailGenerationManager:
    """Manages async thumbnail jobs: reserve style, run worker, and expose per-style status."""

    def __init__(self):
        self._gen_status = {}
        self._gen_lock = threading.Lock()

    def get_status(self, style_name):
        """Return current generation status dict for a style (idle/running/done/error)."""
        with self._gen_lock:
            return self._gen_status.get(style_name, {"status": "idle"})

    def try_begin(self, style_name):
        """Reserve style generation slot; returns False if same style is already running."""
        with self._gen_lock:
            if self._gen_status.get(style_name, {}).get("status") == "running":
                return False
            self._gen_status[style_name] = {"status": "running"}
            return True

    def spawn_generate(self, style_name):
        """Start background thumbnail generation thread for a style already marked running."""
        t = threading.Thread(target=self._run_generation, args=(style_name,), daemon=True)
        t.start()

    def _run_generation(self, style_name):
        thumb_csv_path = ""
        try:
            style_map = {s["name"]: s for s in get_cached_styles()}
            style = style_map.get(style_name)
            if not style:
                with self._gen_lock:
                    self._gen_status[style_name] = {
                        "status": "error", "message": "Style not found"
                    }
                return

            thumb_csv_path = style.get("source_file") or ""

            old_path = get_thumbnail_path(style_name, thumb_csv_path)
            if os.path.isfile(old_path):
                os.remove(old_path)

            img_path = get_thumbnail_path(style_name, thumb_csv_path)
            tmp_path = img_path + ".tmp"

            prompt = style.get("prompt", "")
            prompt = prompt.replace("{prompt}", "1girl, solo")
            negative = style.get("negative_prompt", "")

            from modules import processing  # type: ignore[reportMissingImports]
            from modules.processing import (
                StableDiffusionProcessingTxt2Img,  # type: ignore[reportMissingImports]
            )
            from modules.shared import sd_model  # type: ignore[reportMissingImports]

            p = StableDiffusionProcessingTxt2Img(
                sd_model=sd_model,
                prompt=prompt,
                negative_prompt=negative,
                seed=-1,
                steps=20,
                cfg_scale=7,
                width=384,
                height=512,
                batch_size=1,
                n_iter=1,
                do_not_save_samples=True,
                do_not_save_grid=True,
                override_settings={"samples_filename_pattern": ""},
            )

            # Empty ScriptRunner — thumbnail generation must not trigger
            # extension scripts (Regional Prompter, ControlNet, etc.)
            # We only need p.scripts to not be None so Reforge's
            # process_images_inner can safely iterate alwayson_scripts.
            try:
                from modules.scripts import ScriptRunner
                p.scripts = ScriptRunner()
                p.scripts.scripts = []
                p.scripts.alwayson_scripts = []
                p.script_args = []
            except Exception:
                pass

            try:
                processed = processing.process_images(p)
            finally:
                p.close()

            if not processed.images:
                raise ValueError("No images returned")

            processed.images[0].save(tmp_path, "WEBP", quality=85)
            if os.path.isfile(img_path):
                os.remove(img_path)
            os.rename(tmp_path, img_path)

            with self._gen_lock:
                self._gen_status[style_name] = {"status": "done"}

        except Exception as e:
            logger.exception("[Style Grid] Thumbnail generation FAILED: %s", e)
            try:
                tmp_path = get_thumbnail_path(style_name, thumb_csv_path) + ".tmp"
                if os.path.isfile(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass
            with self._gen_lock:
                self._gen_status[style_name] = {
                    "status": "error", "message": str(e)
                }


thumbnail_generation_manager = ThumbnailGenerationManager()
