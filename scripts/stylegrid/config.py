"""Paths and static config for Style Grid."""

import os

from modules import shared  # type: ignore[reportMissingImports]

# Extension root (parent of scripts/)
EXT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(EXT_DIR, "data")
PRESETS_FILE = os.path.join(DATA_DIR, "presets.json")
USAGE_FILE = os.path.join(DATA_DIR, "usage.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
THUMBNAILS_DIR = os.path.join(DATA_DIR, "thumbnails")

for _d in [DATA_DIR, BACKUP_DIR]:
    os.makedirs(_d, exist_ok=True)
os.makedirs(THUMBNAILS_DIR, exist_ok=True)
print(f"[Style Grid] Thumbnails dir: {os.path.abspath(THUMBNAILS_DIR)}")


def get_styles_dirs():
    ext_styles_dir = os.path.join(EXT_DIR, "styles")
    root_dir = os.path.abspath(
        getattr(shared.cmd_opts, "data_path", None) or os.getcwd()
    )
    return [ext_styles_dir, root_dir]
