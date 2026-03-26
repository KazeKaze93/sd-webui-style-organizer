"""Presets, usage stats, CSV backups (JSON / filesystem under data/)."""

import json
import os
import shutil
import time

from stylegrid.config import BACKUP_DIR, PRESETS_FILE, USAGE_FILE, get_styles_dirs


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
