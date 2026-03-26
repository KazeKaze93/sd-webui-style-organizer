"""CSV file hash tracking and styles list cache."""

import hashlib

from stylegrid.config import get_all_styles_file_paths

_file_hashes = {}
_styles_cache = {"data": None, "hashes": {}}


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
    """Re-scan style CSV files and invalidate cached style list on any hash/set change."""
    global _file_hashes
    changed = False
    current = {}
    for fp in get_all_styles_file_paths():
        h = _hash_file(fp)
        current[fp] = h
        if fp not in _file_hashes or _file_hashes[fp] != h:
            changed = True

    if set(_file_hashes.keys()) != set(current.keys()):
        changed = True
    _file_hashes = current
    # Hashes are updated here; without clearing, the next get_cached_styles() would call
    # check_files_changed() again, see no diff, and keep serving stale _styles_cache["data"].
    if changed:
        invalidate_styles_cache()
    return changed


def get_cached_styles():
    """Return cached parsed styles; reload when check_files_changed detects file updates."""
    global _styles_cache

    if check_files_changed() or _styles_cache["data"] is None:
        from stylegrid.csv_io import load_all_styles

        _styles_cache["data"] = load_all_styles()
        _styles_cache["hashes"] = dict(_file_hashes)
    return _styles_cache["data"]


def invalidate_styles_cache():
    """Drop the in-memory parsed styles so the next read forces a reload from CSV files."""
    global _styles_cache
    _styles_cache["data"] = None


def styles_cache_hashes():
    """Return file-hash snapshot used to build ETag and detect stale cache consumers."""
    return _styles_cache["hashes"]
