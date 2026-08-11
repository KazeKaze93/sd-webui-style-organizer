"""Presets, usage stats, CSV backups (JSON / filesystem under data/)."""

import json
import os
import shutil
import threading
import time
import zipfile

from stylegrid.config import BACKUP_DIR, EXT_DIR, PRESETS_FILE, USAGE_FILE, get_all_styles_file_paths
from stylegrid.csv_io import load_all_styles


def normalize_preset_entry(entry, styles_by_name_first):
    """Return {name, source_file} or None. Accepts bare name str or dict entries."""
    if isinstance(entry, str):
        name = entry.strip()
        if not name:
            return None
        match = styles_by_name_first.get(name)
        if not match:
            return None
        return {"name": match["name"], "source_file": match.get("source_file") or ""}

    if isinstance(entry, dict):
        raw_name = entry.get("name", "")
        if not isinstance(raw_name, str):
            return None
        name = raw_name.strip()
        if not name:
            return None
        raw_source = entry.get("source_file", "")
        source_file = raw_source.strip() if isinstance(raw_source, str) else ""
        if source_file:
            return {"name": name, "source_file": source_file}
        match = styles_by_name_first.get(name)
        if not match:
            return None
        return {"name": match["name"], "source_file": match.get("source_file") or ""}

    return None


def normalize_presets(presets):
    """In-memory upgrade of presets dict: styles entries become {name, source_file}."""
    if not isinstance(presets, dict):
        return {}
    styles_by_name_first = {}
    for s in load_all_styles():
        styles_by_name_first.setdefault(s["name"], s)
    out = {}
    for preset_name, preset in presets.items():
        if not isinstance(preset, dict):
            continue
        new_preset = dict(preset)
        styles_raw = preset.get("styles", [])
        if not isinstance(styles_raw, list):
            styles_raw = []
        normalized_styles = []
        for entry in styles_raw:
            normalized = normalize_preset_entry(entry, styles_by_name_first)
            if normalized is not None:
                normalized_styles.append(normalized)
        new_preset["styles"] = normalized_styles
        out[preset_name] = new_preset
    return out


def load_presets():
    if os.path.isfile(PRESETS_FILE):
        try:
            with open(PRESETS_FILE, "r", encoding="utf-8") as f:
                raw = json.load(f)
            return normalize_presets(raw)
        except Exception:
            pass
    return {}


def save_presets(presets):
    normalized = normalize_presets(presets)
    with open(PRESETS_FILE, "w", encoding="utf-8") as f:
        json.dump(normalized, f, indent=2, ensure_ascii=False)


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


_usage_lock = threading.Lock()


def increment_usage(style_names):
    with _usage_lock:
        usage = load_usage()
        ts = time.strftime("%Y-%m-%dT%H:%M:%S")
        for name in style_names:
            if name not in usage:
                usage[name] = {"count": 0, "last_used": None, "first_used": ts}
            usage[name]["count"] = usage[name].get("count", 0) + 1
            usage[name]["last_used"] = ts
        save_usage(usage)


def _backup_rel_name(fp):
    """Collision-safe relative path for backup zip/folder members."""
    abs_fp = os.path.abspath(fp)
    ext_root = os.path.abspath(EXT_DIR)
    try:
        if os.path.normcase(os.path.commonpath([abs_fp, ext_root])) == os.path.normcase(ext_root):
            return os.path.relpath(abs_fp, ext_root).replace("\\", "/")
    except ValueError:
        pass
    sanitized = abs_fp.replace("\\", "/")
    if len(sanitized) >= 2 and sanitized[1] == ":":
        sanitized = sanitized[2:]
    sanitized = sanitized.lstrip("/")
    return "external/" + sanitized


def backup_csv_files():
    ts = time.strftime("%Y%m%d_%H%M%S")
    backup_subdir = os.path.join(BACKUP_DIR, ts)
    backed_up = False

    for fp in get_all_styles_file_paths():
        if not os.path.isfile(fp):
            continue
        if not backed_up:
            os.makedirs(backup_subdir, exist_ok=True)
            backed_up = True
        rel = _backup_rel_name(fp)
        dest = os.path.join(backup_subdir, *rel.split("/"))
        dest_dir = os.path.dirname(dest)
        if dest_dir:
            os.makedirs(dest_dir, exist_ok=True)
        shutil.copy2(fp, dest)

    if os.path.isfile(PRESETS_FILE):
        if not backed_up:
            os.makedirs(backup_subdir, exist_ok=True)
            backed_up = True
        shutil.copy2(PRESETS_FILE, os.path.join(backup_subdir, "presets.json"))

    if backed_up:
        zip_path = backup_subdir + ".zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for fp in get_all_styles_file_paths():
                if os.path.isfile(fp):
                    zf.write(fp, arcname=_backup_rel_name(fp))
            if os.path.isfile(PRESETS_FILE):
                zf.write(PRESETS_FILE, arcname="presets.json")

    if os.path.isdir(BACKUP_DIR):
        backups = sorted(os.listdir(BACKUP_DIR))
        while len(backups) > 20:
            old_name = backups.pop(0)
            old_path = os.path.join(BACKUP_DIR, old_name)
            if os.path.isdir(old_path):
                shutil.rmtree(old_path, ignore_errors=True)
            elif os.path.isfile(old_path) and old_name.endswith(".zip"):
                try:
                    os.remove(old_path)
                except Exception:
                    pass
    return backed_up
