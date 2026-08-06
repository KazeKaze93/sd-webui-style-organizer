"""
LoRA directory scanning.

Builds synthetic Style-shaped dicts from .safetensors/.pt/.ckpt files found on
disk, so LoRAs render, search, favorite, and apply/unapply exactly like
ordinary CSV styles (see stylegrid.cache.get_cached_styles, which merges this
module's output into the main styles list).

Read-only by design: LORA_SOURCE-tagged styles are never written to any CSV.
stylegrid.csv_io guards save/delete against this source explicitly.

Directory discovery is best-effort across A1111 / Forge / reForge, which
expose the Lora models directory differently across versions and forks. We
try several known attributes and fall back to <models_path>/Lora. Because
that auto-detection can't cover every fork/setup, config/lora_roots.json
(user-created, gitignored; see config/lora_roots.json.example) lets the user
add or override directories explicitly. Both sets are merged.
"""

import json
import os
import threading
import time

from stylegrid.config import EXT_DIR

LORA_SOURCE = "__style_grid_lora__"
LORA_CATEGORY_ROOT = "LoRA"

MODEL_EXTS = (".safetensors", ".pt", ".ckpt")
PREVIEW_EXTS = (".png", ".jpg", ".jpeg", ".webp")

_ROOTS_CONFIG_PATH = os.path.join(EXT_DIR, "config", "lora_roots.json")

_cache_lock = threading.Lock()
_cache = {"styles": None, "previews": {}, "model_ids": {}, "scanned_at": 0.0, "roots": []}


# ---------------------------------------------------------------------------
# Root directory discovery
# ---------------------------------------------------------------------------

def _load_roots_config():
    """User overrides/additions; config/lora_roots.json (gitignored).
    Schema: {"roots": ["D:/Models/Lora", ...], "max_depth": null}
    Missing/invalid file -> no extra roots, unlimited depth.
    """
    if not os.path.isfile(_ROOTS_CONFIG_PATH):
        return {"roots": [], "max_depth": None}
    try:
        with open(_ROOTS_CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        roots = data.get("roots") if isinstance(data, dict) else None
        roots = [str(r) for r in roots if r] if isinstance(roots, list) else []
        max_depth = data.get("max_depth") if isinstance(data, dict) else None
        max_depth = max_depth if isinstance(max_depth, int) else None
        return {"roots": roots, "max_depth": max_depth}
    except Exception:
        return {"roots": [], "max_depth": None}


def _auto_detected_roots():
    """Best-effort discovery across A1111 / Forge / reForge. Each lookup is
    isolated in its own try/except: forks rename or drop these attributes
    across versions, and one missing attribute must not skip the rest.
    """
    candidates = []

    try:
        from modules import paths_internal  # type: ignore[reportMissingImports]
        models_path = getattr(paths_internal, "models_path", None)
        if models_path:
            candidates.append(os.path.join(models_path, "Lora"))
    except Exception:
        pass

    try:
        from modules import shared  # type: ignore[reportMissingImports]
        cmd_opts = getattr(shared, "cmd_opts", None)
        for attr in ("lora_dir", "lyco_dir"):
            val = getattr(cmd_opts, attr, None) if cmd_opts else None
            if val:
                candidates.append(val)
    except Exception:
        pass

    seen = set()
    result = []
    for r in candidates:
        try:
            ap = os.path.normpath(os.path.abspath(r))
            key = os.path.normcase(os.path.realpath(ap))
        except Exception:
            continue
        if key in seen:
            continue
        seen.add(key)
        if os.path.isdir(ap):
            result.append(ap)
    return result


def get_lora_roots():
    """Merged, de-duplicated, existing-only list of LoRA root directories,
    plus the configured max scan depth (None = unlimited).

    Dedup is by realpath (not just abspath): a junction/symlink pointing at
    the same physical folder as an already-collected root must be dropped,
    or every LoRA under it gets scanned twice and shows up as two cards.
    """
    cfg = _load_roots_config()
    roots = _auto_detected_roots()
    seen = {os.path.normcase(os.path.realpath(r)) for r in roots}
    for r in cfg["roots"]:
        try:
            ap = os.path.normpath(os.path.abspath(r))
            key = os.path.normcase(os.path.realpath(ap))
        except Exception:
            continue
        if key in seen:
            continue
        if os.path.isdir(ap):
            seen.add(key)
            roots.append(ap)
    return roots, cfg["max_depth"]


# ---------------------------------------------------------------------------
# Per-file helpers
# ---------------------------------------------------------------------------

def _find_sibling(path_no_ext, exts, suffix=""):
    for ext in exts:
        candidate = f"{path_no_ext}{suffix}{ext}"
        if os.path.isfile(candidate):
            return candidate
    return None


def _find_preview(path_no_ext):
    """A1111/Forge preview convention: '<stem>.preview.<ext>' takes priority
    over a bare '<stem>.<ext>' (which for some setups is a training sample,
    not a preview). No preview file -> None; caller must not fabricate one.
    """
    return (
        _find_sibling(path_no_ext, PREVIEW_EXTS, suffix=".preview")
        or _find_sibling(path_no_ext, PREVIEW_EXTS)
    )


def _read_user_metadata(path_no_ext):
    """Read '<stem>.json' — the standard A1111/Forge extra-networks user
    metadata file (also written by the built-in metadata editor): keys used
    here are "description", "activation text", "preferred weight",
    "negative text", "notes". Missing/invalid file -> {} (all defaults).
    """
    json_path = path_no_ext + ".json"
    if not os.path.isfile(json_path):
        return {}
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _default_multiplier():
    """Mirrors native Lora click fallback (opts.extra_networks_default_multiplier)."""
    try:
        from modules import shared  # type: ignore[reportMissingImports]
        v = shared.opts.data.get("extra_networks_default_multiplier")
        if isinstance(v, (int, float)) and v:
            return float(v)
    except Exception:
        pass
    return 1.0


def _extract_weight(meta, fallback):
    w = meta.get("preferred weight")
    try:
        w = float(w)
        if w:
            return w
    except (TypeError, ValueError):
        pass
    return fallback


def _walk_root(root, max_depth):
    """Yield (abs_model_path, rel_dir) for every recognized model file under
    root. rel_dir uses forward slashes and is "" for files directly in root.
    max_depth=None means fully recursive (no cap) — required since LoRA
    collections can nest arbitrarily deep and by an arbitrary number of
    sibling folders; never hardcode a folder list or a fixed depth here.
    """
    root = os.path.normpath(root)
    root_depth = root.rstrip(os.sep).count(os.sep)
    for dirpath, dirnames, filenames in os.walk(root):
        if max_depth is not None:
            depth = dirpath.rstrip(os.sep).count(os.sep) - root_depth
            if depth >= max_depth:
                dirnames[:] = []
        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext not in MODEL_EXTS:
                continue
            abs_path = os.path.join(dirpath, fname)
            rel_dir = os.path.relpath(dirpath, root)
            rel_dir = "" if rel_dir == "." else rel_dir.replace(os.sep, "/")
            yield abs_path, rel_dir


# ---------------------------------------------------------------------------
# Scan + cache
# ---------------------------------------------------------------------------

def _scan():
    roots, max_depth = get_lora_roots()
    default_mult = _default_multiplier()

    found = []
    for root in roots:
        for abs_path, rel_dir in _walk_root(root, max_depth):
            path_no_ext = os.path.splitext(abs_path)[0]
            stem = os.path.basename(path_no_ext)
            found.append((path_no_ext, stem, rel_dir))

    stem_counts = {}
    for _, stem, _ in found:
        stem_counts[stem] = stem_counts.get(stem, 0) + 1

    try:
        from stylegrid.lora_titles import get_cached_title
    except Exception:
        def get_cached_title(_model_id):
            return None

    styles = []
    previews = {}
    model_ids = {}
    for path_no_ext, stem, rel_dir in found:
        meta = _read_user_metadata(path_no_ext)
        preview_path = _find_preview(path_no_ext)

        # Style Grid's own bookkeeping key (must be globally unique); the
        # bare `stem` below is what actually goes inside <lora:...> and must
        # stay untouched by this disambiguation, since that's what the SD
        # backend resolves against on disk.
        if stem_counts.get(stem, 0) > 1 and rel_dir:
            style_key = f"LORA_{stem}_{rel_dir.replace('/', '_')}"
        else:
            style_key = f"LORA_{stem}"

        weight = _extract_weight(meta, default_mult)
        weight_str = f"{weight:g}"
        activation = (meta.get("activation text") or "").strip()
        negative_text = (meta.get("negative text") or "").strip()
        description = (meta.get("description") or meta.get("notes") or "").strip()
        model_id = meta.get("modelId")

        prompt = f"<lora:{stem}:{weight_str}>"
        if activation:
            prompt += f", {activation}"

        negative_prompt = f"({negative_text}:{weight_str})" if negative_text else ""

        style = {
            "name": style_key,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "description": description,
            "category_explicit": rel_dir or LORA_CATEGORY_ROOT,
            "source": LORA_SOURCE,
            "_source": LORA_SOURCE,
            "source_file": LORA_SOURCE,
        }

        if model_id:
            model_ids[style_key] = model_id
            title = get_cached_title(model_id)
            if title:
                # Pre-set display_name so categorize_styles() (which only
                # fills it in when absent) shows the real CivitAI title
                # instead of the derived-from-filename fallback.
                style["display_name"] = title

        styles.append(style)
        if preview_path:
            previews[style_key] = preview_path

    return styles, previews, model_ids, roots


def get_cached_lora_styles():
    with _cache_lock:
        if _cache["styles"] is None:
            styles, previews, model_ids, roots = _scan()
            _cache["styles"] = styles
            _cache["previews"] = previews
            _cache["model_ids"] = model_ids
            _cache["roots"] = roots
            _cache["scanned_at"] = time.time()
        return _cache["styles"]


def get_lora_preview_path(style_key):
    """Absolute path to the literal preview image for a LoRA style key, or
    None. Never generates a thumbnail — only returns a file that already
    exists on disk next to the model.
    """
    get_cached_lora_styles()  # ensures _cache is populated (no-op if already scanned)
    with _cache_lock:
        return _cache["previews"].get(style_key)


def get_lora_model_ids():
    """style_key -> CivitAI modelId, for every scanned LoRA that has one
    (i.e. its local .json metadata includes it). Used by lora_titles to know
    which models to fetch titles for.
    """
    get_cached_lora_styles()
    with _cache_lock:
        return dict(_cache["model_ids"])


def invalidate_lora_cache():
    with _cache_lock:
        _cache["styles"] = None
        _cache["previews"] = {}
        _cache["model_ids"] = {}
        _cache["roots"] = []


def lora_scan_status():
    with _cache_lock:
        return {
            "count": len(_cache["styles"] or []),
            "roots": list(_cache["roots"]),
            "scanned_at": _cache["scanned_at"],
        }
