"""Presets, usage stats, CSV backups (JSON / filesystem under data/)."""

import json
import os
import shutil
import time
import zipfile

from stylegrid.config import BACKUP_DIR, PRESETS_FILE, USAGE_FILE, get_all_styles_file_paths


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
        fname = os.path.basename(fp)
        shutil.copy2(fp, os.path.join(backup_subdir, fname))

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
                    zf.write(fp, arcname=os.path.basename(fp))
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
