"""Paths and static config for Style Grid.

User-writable data lives under the WebUI data directory
(``shared.cmd_opts.data_path / style_grid``). Bundled ``samples/`` and
``styles/`` stay inside the extension folder. Legacy ``<ext>/data/`` is
never deleted; on first startup it is copied into the new root when the
new root is empty. ``usage.json`` is never migrated (feature removed).
"""

from __future__ import annotations

import logging
import os
import shutil
from typing import Iterable

from modules import shared  # type: ignore[reportMissingImports]

log = logging.getLogger(__name__)

# Extension root (parent of stylegrid/)
EXT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Pre-user-dir location (never auto-deleted).
LEGACY_DATA_DIR = os.path.join(EXT_DIR, "data")

USER_DATA_DIRNAME = "style_grid"
MIGRATION_MARKER_NAME = ".migrated_from_extension_data"

# Never copy these from legacy data/ (feature removed; leave on disk).
_SKIP_LEGACY_BASENAMES = frozenset({"usage.json"})

_USER_JSON_NAMES = frozenset(
    {
        "presets.json",
        "category_order.json",
        "favorites.json",
        "recent.json",
        "lora_titles.json",
    }
)
_USER_SUBDIR_NAMES = frozenset({"thumbnails", "backups"})

RECENT_MAX = 10


def _get_webui_data_path() -> str | None:
    """Return WebUI ``--data-dir`` path, or None when unavailable / unset."""
    cmd = getattr(shared, "cmd_opts", None)
    if cmd is None:
        return None
    path = getattr(cmd, "data_path", None)
    if isinstance(path, str) and path.strip():
        return path.strip()
    # Some stubs expose a non-str sentinel; treat as missing.
    return None


def resolve_user_data_dir(data_path: str | None = None) -> str:
    """Abs path of the Style Grid user data root.

    Production: ``<WebUI data_path>/style_grid`` (from ``shared.cmd_opts.data_path``).
    Offline / pytest (no data_path): fall back to legacy ``<ext>/data``.
    """
    if data_path is None:
        data_path = _get_webui_data_path()
    if data_path is None:
        return LEGACY_DATA_DIR
    return os.path.join(data_path, USER_DATA_DIRNAME)


def _is_user_content_name(name: str) -> bool:
    if name.startswith("."):
        return False
    if name in _SKIP_LEGACY_BASENAMES:
        return False
    lower = name.lower()
    if lower.endswith(".csv"):
        return True
    if name in _USER_JSON_NAMES:
        return True
    if name in _USER_SUBDIR_NAMES:
        return True
    return False


def _subdir_has_files(dirpath: str) -> bool:
    for _root, _dirs, files in os.walk(dirpath):
        if files:
            return True
    return False


def has_user_data(root: str) -> bool:
    """True when ``root`` contains migratable / meaningful user files."""
    if not os.path.isdir(root):
        return False
    try:
        names = os.listdir(root)
    except OSError:
        return False
    for name in names:
        if not _is_user_content_name(name):
            continue
        path = os.path.join(root, name)
        if name in _USER_SUBDIR_NAMES:
            if os.path.isdir(path) and _subdir_has_files(path):
                return True
            continue
        if os.path.isfile(path):
            return True
    return False


def _iter_legacy_entries(legacy_dir: str) -> Iterable[tuple[str, str]]:
    """Yield (abs_src, relpath) for every file under legacy_dir (files only)."""
    for root, _dirs, files in os.walk(legacy_dir):
        for fname in files:
            if fname in _SKIP_LEGACY_BASENAMES:
                continue
            src = os.path.join(root, fname)
            rel = os.path.relpath(src, legacy_dir)
            yield src, rel


def migrate_legacy_user_data(
    data_dir: str,
    legacy_dir: str,
    *,
    marker_name: str = MIGRATION_MARKER_NAME,
) -> bool:
    """Copy legacy extension ``data/`` into ``data_dir`` when safe.

    Rules:
    - Never move or delete legacy files.
    - Never copy ``usage.json``.
    - Skip when ``data_dir`` and ``legacy_dir`` are the same path.
    - Skip when the destination already has user data (no overwrite).
    - Skip when a migration marker is already present.
    - Skip when legacy has no migratable user data.
    - On success: recursive copy, write marker, log, return True.
    """
    data_abs = os.path.normpath(os.path.abspath(data_dir))
    legacy_abs = os.path.normpath(os.path.abspath(legacy_dir))
    if data_abs == legacy_abs:
        return False

    marker_path = os.path.join(data_abs, marker_name)
    if os.path.isfile(marker_path):
        return False

    if has_user_data(data_abs):
        return False

    if not has_user_data(legacy_abs):
        return False

    os.makedirs(data_abs, exist_ok=True)
    copied = 0
    for src, rel in _iter_legacy_entries(legacy_abs):
        dest = os.path.join(data_abs, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.exists(dest):
            continue
        try:
            shutil.copy2(src, dest)
            copied += 1
        except OSError as exc:
            log.warning(
                "[Style Grid] migration copy failed %s -> %s: %s",
                src,
                dest,
                exc,
            )

    try:
        with open(marker_path, "w", encoding="utf-8") as fh:
            fh.write(f"copied_from={legacy_abs}\n")
            fh.write(f"files_copied={copied}\n")
    except OSError as exc:
        log.warning("[Style Grid] could not write migration marker: %s", exc)

    log.info(
        "[Style Grid] Migrated user data from %s to %s (%s files copied; "
        "legacy folder left in place)",
        legacy_abs,
        data_abs,
        copied,
    )
    return True


def _ensure_data_dirs(data_dir: str) -> None:
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(os.path.join(data_dir, "backups"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "thumbnails"), exist_ok=True)


DATA_DIR = resolve_user_data_dir()
migrate_legacy_user_data(DATA_DIR, LEGACY_DATA_DIR)
_ensure_data_dirs(DATA_DIR)

PRESETS_FILE = os.path.join(DATA_DIR, "presets.json")
CATEGORY_ORDER_FILE = os.path.join(DATA_DIR, "category_order.json")
FAVORITES_FILE = os.path.join(DATA_DIR, "favorites.json")
RECENT_FILE = os.path.join(DATA_DIR, "recent.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
THUMBNAILS_DIR = os.path.join(DATA_DIR, "thumbnails")


def is_samples_source(path: str) -> bool:
    """Return True if the given (possibly relative) path resolves inside
    the read-only samples/ directory."""
    if not path:
        return False
    samples_dir = os.path.join(EXT_DIR, "samples")
    normalized = os.path.abspath(path).replace("\\", "/")
    samples_root = os.path.abspath(samples_dir).replace("\\", "/")
    return normalized == samples_root or normalized.startswith(samples_root + "/")


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
    """Discover style CSVs: extension styles/, samples/, WebUI shared.prompt_styles, then cwd *.csv.

    CivitAI-style packs installed in the WebUI root (next to styles.csv) are
    found by scanning ``os.getcwd()`` for ``*.csv`` after the shared list.
    Paths are deduped by ``normcase(abspath)`` so styles.csv is not listed twice.
    """
    ext_styles_dir = os.path.join(EXT_DIR, "styles")
    all_styles_file_paths = []
    if os.path.isdir(ext_styles_dir):
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
        pass

    seen = {os.path.normcase(os.path.abspath(p)) for p in all_styles_file_paths}
    webui_root = os.getcwd()
    for fname in sorted(os.listdir(webui_root)):
        if fname.lower().endswith(".csv"):
            fp = os.path.join(webui_root, fname)
            key = os.path.normcase(os.path.abspath(fp))
            if key not in seen:
                seen.add(key)
                all_styles_file_paths.append(fp)
    return all_styles_file_paths
