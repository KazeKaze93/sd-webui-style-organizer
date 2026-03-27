"""Paths and static config for Style Grid."""

import os

from modules import shared  # type: ignore[reportMissingImports]

# Extension root (parent of scripts/)
EXT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(EXT_DIR, "data")
PRESETS_FILE = os.path.join(DATA_DIR, "presets.json")
USAGE_FILE = os.path.join(DATA_DIR, "usage.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
THUMBNAILS_DIR = os.path.join(DATA_DIR, "thumbnails")

for _d in [DATA_DIR, BACKUP_DIR]:
    os.makedirs(_d, exist_ok=True)
os.makedirs(THUMBNAILS_DIR, exist_ok=True)


def get_styles_dirs():
    ext_styles_dir = os.path.join(EXT_DIR, "styles")
    all_styles_parent_dirs_paths = [ext_styles_dir]
    seen = {ext_styles_dir}
    for p in shared.prompt_styles.all_styles_files:
        p_abs_str = str(p.parent.absolute())
        if p_abs_str not in seen:
            all_styles_parent_dirs_paths.append(p_abs_str)
            seen.add(p_abs_str)
    return all_styles_parent_dirs_paths


def get_all_styles_file_paths():
    ext_styles_dir = os.path.join(EXT_DIR, "styles")
    all_styles_file_paths = []
    if not os.path.isdir(ext_styles_dir):
        for fname in sorted(os.listdir(ext_styles_dir)):
            if fname.lower().endswith(".csv"):
                filepath = os.path.join(ext_styles_dir, fname)
                all_styles_file_paths.append(filepath)

    samples_dir = os.path.join(EXT_DIR, "samples")
    if os.path.isdir(samples_dir):
        for fname in sorted(os.listdir(samples_dir)):
            if fname.lower().endswith(".csv"):
                filepath = os.path.join(samples_dir, fname)
                all_styles_file_paths.append(filepath)

    try:
        shared_paths = [str(p.absolute()) for p in shared.prompt_styles.all_styles_files]
        all_styles_file_paths.extend(shared_paths)
    except Exception:
        shared_paths = []
    webui_root = os.getcwd()
    for fname in sorted(os.listdir(webui_root)):
        if fname.lower().endswith(".csv"):
            fp = os.path.join(webui_root, fname)
            if fp not in all_styles_file_paths:
                all_styles_file_paths.append(fp)
    return all_styles_file_paths
