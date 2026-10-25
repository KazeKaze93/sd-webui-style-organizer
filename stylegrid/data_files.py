"""Presets, favorites/recent, CSV backups (JSON / filesystem under data/)."""

import io
import os
import re
import shutil
import time
import zipfile

from stylegrid.config import (
    BACKUP_DIR,
    CATEGORY_ORDER_FILE,
    EXT_DIR,
    FAVORITES_FILE,
    PRESETS_FILE,
    RECENT_FILE,
    RECENT_MAX,
    THUMBNAILS_DIR,
    get_all_styles_file_paths,
)
from stylegrid.cache import get_cached_styles
from stylegrid.safe_persistence import (
    CorruptDataError,
    cleanup_stale_tmp,
    load_json_object,
    locked_path,
    write_atomic,
    write_json_atomic,
)
from stylegrid.wildcards import TOKEN_SGD

__all__ = [
    "CorruptDataError",
    "load_presets",
    "save_presets",
    "normalize_presets",
    "normalize_preset_entry",
    "normalize_wildcard_entry",
    "preset_styles_payload_ok",
    "update_presets",
    "load_favorites",
    "save_favorites",
    "migrate_favorites_once",
    "load_recent",
    "save_recent",
    "migrate_recent_once",
    "backup_csv_files",
    "list_backups",
    "restore_from_backup",
    "thumbnails_dir_size",
    "metadata_backup_files",
]


def _normalize_string_list(raw_items, *, max_len=None):
    """Return unique non-empty strings preserving first-seen order.

    Favorites/recent keys are ``styleRowKey`` composites (may contain ``\\0``);
    empty strings are dropped, interior whitespace is kept as-is.
    """
    if not isinstance(raw_items, list):
        return []
    out = []
    seen = set()
    for entry in raw_items:
        if not isinstance(entry, str) or not entry:
            continue
        if entry in seen:
            continue
        seen.add(entry)
        out.append(entry)
        if max_len is not None and len(out) >= max_len:
            break
    return out


def _load_items_file(path):
    """Load ``{"items": [...]}``. Missing → ``([], False)``; present → ``(items, True)``."""
    with locked_path(path):
        cleanup_stale_tmp(path)
        if not os.path.isfile(path):
            return [], False
        raw = load_json_object(path)
        items = _normalize_string_list(raw.get("items", []))
        return items, True


def _save_items_file(path, items, *, max_len=None):
    """Atomically write ``{"items": [...]}``."""
    normalized = _normalize_string_list(items, max_len=max_len)
    with locked_path(path):
        write_json_atomic(path, {"items": normalized})
        return normalized


def _migrate_items_once(path, items, *, max_len=None):
    """Write *items* only when *path* is absent. Returns ``(items, migrated)``."""
    normalized = _normalize_string_list(items, max_len=max_len)
    with locked_path(path):
        cleanup_stale_tmp(path)
        if os.path.isfile(path):
            current = load_json_object(path)
            return _normalize_string_list(current.get("items", []), max_len=max_len), False
        write_json_atomic(path, {"items": normalized})
        return normalized, True


def load_favorites():
    """Load favorites.json. Returns ``(items, persisted)``."""
    return _load_items_file(FAVORITES_FILE)


def save_favorites(items):
    """Replace favorites.json contents. Returns the normalized list."""
    return _save_items_file(FAVORITES_FILE, items)


def migrate_favorites_once(items):
    """Push localStorage favorites to server only when favorites.json is absent."""
    return _migrate_items_once(FAVORITES_FILE, items)


def load_recent():
    """Load recent.json. Returns ``(items, persisted)`` (at most ``RECENT_MAX``)."""
    items, persisted = _load_items_file(RECENT_FILE)
    return items[:RECENT_MAX], persisted


def save_recent(items):
    """Replace recent.json contents (capped at ``RECENT_MAX``)."""
    return _save_items_file(RECENT_FILE, items, max_len=RECENT_MAX)


def migrate_recent_once(items):
    """Push localStorage recent to server only when recent.json is absent."""
    return _migrate_items_once(RECENT_FILE, items, max_len=RECENT_MAX)


def _coerce_weight(raw):
    if isinstance(raw, bool) or raw is None:
        return 1.0
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, str):
        try:
            return float(raw.strip())
        except ValueError:
            return 1.0
    return 1.0


def normalize_wildcard_entry(entry):
    """Return {category, spec}[, kind] or None.

    ``kind`` is present only when the raw entry declares deck mode
    (``TOKEN_SGD``); dice / missing / invalid kinds omit the key.
    """
    if not isinstance(entry, dict):
        return None
    raw_cat = entry.get("category", "")
    if not isinstance(raw_cat, str):
        return None
    category = raw_cat.strip()
    if not category:
        return None
    raw_spec = entry.get("spec", "")
    spec = raw_spec if isinstance(raw_spec, str) else ""
    result = {"category": category, "spec": spec}
    raw_kind = entry.get("kind")
    if isinstance(raw_kind, str) and raw_kind.strip().lower() == TOKEN_SGD:
        result["kind"] = TOKEN_SGD
    return result


def normalize_preset_entry(entry, styles_by_name_first):
    """Return {name, source_file, weight} or None.

    Accepts bare name str or dict. Unresolvable names are kept (empty source_file)
    so the UI can show missing members.
    """
    weight = 1.0
    if isinstance(entry, str):
        name = entry.strip()
        if not name:
            return None
        match = styles_by_name_first.get(name)
        source_file = (match.get("source_file") or "") if match else ""
        if match:
            name = match["name"]
        return {"name": name, "source_file": source_file, "weight": weight}

    if isinstance(entry, dict):
        raw_name = entry.get("name", "")
        if not isinstance(raw_name, str):
            return None
        name = raw_name.strip()
        if not name:
            return None
        weight = _coerce_weight(entry.get("weight", 1.0))
        raw_source = entry.get("source_file", "")
        source_file = raw_source.strip() if isinstance(raw_source, str) else ""
        if source_file:
            return {"name": name, "source_file": source_file, "weight": weight}
        match = styles_by_name_first.get(name)
        if match:
            return {
                "name": match["name"],
                "source_file": match.get("source_file") or "",
                "weight": weight,
            }
        return {"name": name, "source_file": "", "weight": weight}

    return None


def normalize_presets(presets):
    """Upgrade presets in memory: styles -> {name, source_file, weight}; wildcards/note defaults.

    Does not write to disk. Callers that persist must use ``save_presets``.
    """
    if not isinstance(presets, dict):
        return {}
    styles_by_name_first = {}
    for s in get_cached_styles():
        styles_by_name_first.setdefault(s["name"], s)
    out = {}
    for preset_name, preset in presets.items():
        if not isinstance(preset_name, str) or not preset_name.strip():
            continue
        if not isinstance(preset, dict):
            continue
        styles_raw = preset.get("styles", [])
        if not isinstance(styles_raw, list):
            styles_raw = []
        normalized_styles = []
        for entry in styles_raw:
            normalized = normalize_preset_entry(entry, styles_by_name_first)
            if normalized is not None:
                normalized_styles.append(normalized)

        wildcards_raw = preset.get("wildcards", [])
        if not isinstance(wildcards_raw, list):
            wildcards_raw = []
        wildcards = []
        for entry in wildcards_raw:
            wc = normalize_wildcard_entry(entry)
            if wc is not None:
                wildcards.append(wc)

        note = preset.get("note", "")
        if not isinstance(note, str):
            note = ""

        created = preset.get("created")
        if not isinstance(created, str) or not created:
            created = time.strftime("%Y-%m-%dT%H:%M:%S")

        new_preset = {
            "styles": normalized_styles,
            "wildcards": wildcards,
            "note": note,
            "created": created,
        }
        last_used = preset.get("last_used")
        if isinstance(last_used, str) and last_used:
            new_preset["last_used"] = last_used
        out[preset_name.strip()] = new_preset
    return out


def _write_presets_file(normalized):
    write_json_atomic(PRESETS_FILE, normalized, require_object_values=True)


def load_presets():
    """Load presets.json. Missing → {}; corrupt/wrong-shape/IO → CorruptDataError.

    Never writes to disk (legacy shapes are normalized only in memory).
    """
    with locked_path(PRESETS_FILE):
        cleanup_stale_tmp(PRESETS_FILE)
        raw = load_json_object(PRESETS_FILE, require_object_values=True)
        return normalize_presets(raw)


def save_presets(presets):
    """Normalize and atomically write presets. Refuses if existing file is corrupt."""
    with locked_path(PRESETS_FILE):
        normalized = normalize_presets(presets)
        _write_presets_file(normalized)
        return normalized


def update_presets(mutator):
    """Load→mutate→save presets under one per-file lock (RMW-safe)."""
    with locked_path(PRESETS_FILE):
        current = load_presets()
        updated = mutator(current)
        return save_presets(updated)


def preset_styles_payload_ok(styles):
    """True if styles is a list of bare names and/or {name, ...} objects."""
    if not isinstance(styles, list):
        return False
    for entry in styles:
        if isinstance(entry, str):
            if not entry.strip():
                return False
            continue
        if isinstance(entry, dict):
            raw_name = entry.get("name", "")
            if not isinstance(raw_name, str) or not raw_name.strip():
                return False
            continue
        return False
    return True


def metadata_backup_files():
    """Basename → absolute path for data/ JSON files included in every backup.

    Resolved at call time so tests can monkeypatch the path constants.
    """
    return (
        ("presets.json", PRESETS_FILE),
        ("category_order.json", CATEGORY_ORDER_FILE),
        ("favorites.json", FAVORITES_FILE),
        ("recent.json", RECENT_FILE),
    )


_SNAPSHOT_NAME_RE = re.compile(r"^\d{8}_\d{6}(_[A-Za-z0-9]+)?$")


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


def thumbnails_dir_size():
    """Total byte size of files under ``data/thumbnails/`` (0 if missing)."""
    total = 0
    if not os.path.isdir(THUMBNAILS_DIR):
        return 0
    for root, _dirs, files in os.walk(THUMBNAILS_DIR):
        for name in files:
            fp = os.path.join(root, name)
            try:
                total += os.path.getsize(fp)
            except OSError:
                continue
    return total


def _copy_into_backup(backup_subdir, src, arcname, members):
    """Copy *src* file into the backup folder; append *arcname* to *members*."""
    dest = os.path.join(backup_subdir, *arcname.split("/"))
    dest_dir = os.path.dirname(dest)
    if dest_dir:
        os.makedirs(dest_dir, exist_ok=True)
    shutil.copy2(src, dest)
    members.append(arcname)


def _prune_old_backups():
    if not os.path.isdir(BACKUP_DIR):
        return
    backups = sorted(os.listdir(BACKUP_DIR))
    while len(backups) > 20:
        old_name = backups.pop(0)
        old_path = os.path.join(BACKUP_DIR, old_name)
        if os.path.isdir(old_path):
            shutil.rmtree(old_path, ignore_errors=True)
        elif os.path.isfile(old_path) and old_name.endswith(".zip"):
            try:
                os.remove(old_path)
            except OSError:
                pass


def backup_csv_files(include_thumbnails=False, *, snapshot_name=None):
    """Create a timestamped backup of CSVs + metadata JSON (+ optional thumbnails).

    Returns ``{"ok": bool, "snapshot": str|None, "members": list[str],
    "thumbnails_bytes": int}``.
    """
    ts = snapshot_name or time.strftime("%Y%m%d_%H%M%S")
    if not _SNAPSHOT_NAME_RE.match(ts):
        raise ValueError(f"invalid snapshot name: {ts!r}")
    backup_subdir = os.path.join(BACKUP_DIR, ts)
    members = []
    thumbnails_bytes = 0

    os.makedirs(BACKUP_DIR, exist_ok=True)

    for fp in get_all_styles_file_paths():
        if not os.path.isfile(fp):
            continue
        if not members:
            os.makedirs(backup_subdir, exist_ok=True)
        _copy_into_backup(backup_subdir, fp, _backup_rel_name(fp), members)

    for arcname, path in metadata_backup_files():
        if not os.path.isfile(path):
            continue
        if not members:
            os.makedirs(backup_subdir, exist_ok=True)
        _copy_into_backup(backup_subdir, path, arcname, members)

    if include_thumbnails and os.path.isdir(THUMBNAILS_DIR):
        for root, _dirs, files in os.walk(THUMBNAILS_DIR):
            for name in files:
                fp = os.path.join(root, name)
                if not os.path.isfile(fp):
                    continue
                rel_inside = os.path.relpath(fp, THUMBNAILS_DIR).replace("\\", "/")
                arcname = f"thumbnails/{rel_inside}"
                if not members:
                    os.makedirs(backup_subdir, exist_ok=True)
                _copy_into_backup(backup_subdir, fp, arcname, members)
                try:
                    thumbnails_bytes += os.path.getsize(fp)
                except OSError:
                    pass

    if members:
        zip_path = backup_subdir + ".zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for arcname in members:
                src = os.path.join(backup_subdir, *arcname.split("/"))
                zf.write(src, arcname=arcname)

    _prune_old_backups()
    return {
        "ok": bool(members),
        "snapshot": ts if members else None,
        "members": members,
        "thumbnails_bytes": thumbnails_bytes,
    }


def list_backups():
    """Return newest-first snapshot descriptors under ``data/backups/``."""
    if not os.path.isdir(BACKUP_DIR):
        return []
    names = set()
    for entry in os.listdir(BACKUP_DIR):
        base = entry[:-4] if entry.endswith(".zip") else entry
        if _SNAPSHOT_NAME_RE.match(base):
            names.add(base)
    out = []
    for name in sorted(names, reverse=True):
        dir_path = os.path.join(BACKUP_DIR, name)
        zip_path = dir_path + ".zip"
        has_dir = os.path.isdir(dir_path)
        has_zip = os.path.isfile(zip_path)
        members = []
        if has_dir:
            for root, _dirs, files in os.walk(dir_path):
                for fname in files:
                    fp = os.path.join(root, fname)
                    members.append(os.path.relpath(fp, dir_path).replace("\\", "/"))
        elif has_zip:
            try:
                with zipfile.ZipFile(zip_path, "r") as zf:
                    members = [i.filename for i in zf.infolist() if not i.is_dir()]
            except (OSError, zipfile.BadZipFile):
                members = []
        size = 0
        if has_dir:
            for root, _dirs, files in os.walk(dir_path):
                for fname in files:
                    try:
                        size += os.path.getsize(os.path.join(root, fname))
                    except OSError:
                        pass
        elif has_zip:
            try:
                size = os.path.getsize(zip_path)
            except OSError:
                size = 0
        out.append(
            {
                "name": name,
                "has_dir": has_dir,
                "has_zip": has_zip,
                "size": size,
                "members": sorted(members),
                "has_thumbnails": any(m.startswith("thumbnails/") for m in members),
            }
        )
    return out


def _safe_snapshot_paths(snapshot_name):
    """Validate *snapshot_name* and return ``(dir_path, zip_path)`` under BACKUP_DIR."""
    if not isinstance(snapshot_name, str) or not _SNAPSHOT_NAME_RE.match(snapshot_name):
        raise ValueError("invalid snapshot name")
    dir_path = os.path.abspath(os.path.join(BACKUP_DIR, snapshot_name))
    backup_root = os.path.abspath(BACKUP_DIR)
    if os.path.normcase(os.path.commonpath([dir_path, backup_root])) != os.path.normcase(
        backup_root
    ):
        raise ValueError("invalid snapshot name")
    if dir_path == backup_root:
        raise ValueError("invalid snapshot name")
    return dir_path, dir_path + ".zip"


def _iter_snapshot_members(snapshot_name):
    """Yield ``(arcname, open_binary_callable)`` for each file in the snapshot."""
    dir_path, zip_path = _safe_snapshot_paths(snapshot_name)
    if os.path.isdir(dir_path):
        for root, _dirs, files in os.walk(dir_path):
            for fname in files:
                fp = os.path.join(root, fname)
                arcname = os.path.relpath(fp, dir_path).replace("\\", "/")

                def _opener(path=fp):
                    return open(path, "rb")

                yield arcname, _opener
        return
    if os.path.isfile(zip_path):
        with zipfile.ZipFile(zip_path, "r") as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                data = zf.read(info.filename)

                def _opener(blob=data):
                    return io.BytesIO(blob)

                yield info.filename, _opener
        return
    raise FileNotFoundError(f"snapshot not found: {snapshot_name}")


def _resolve_restore_dest(arcname):
    """Map a backup member name to an absolute destination path, or None to skip."""
    meta = {name: path for name, path in metadata_backup_files()}
    if arcname in meta:
        return meta[arcname]
    if arcname.startswith("thumbnails/"):
        rel = arcname[len("thumbnails/") :]
        if not rel or ".." in rel.split("/"):
            return None
        return os.path.join(THUMBNAILS_DIR, *rel.split("/"))
    if arcname.startswith("external/"):
        # Drive letter was stripped at backup time — cannot restore safely.
        return None
    # Extension-relative paths (styles/…, samples/…).
    if ".." in arcname.split("/"):
        return None
    return os.path.join(EXT_DIR, *arcname.split("/"))


def restore_from_backup(snapshot_name, *, create_safety=True):
    """Restore CSVs + metadata (+ thumbnails if present) from a backup snapshot.

    Creates an automatic safety backup of the current state first (unless
    *create_safety* is false). Returns a result dict.
    """
    # Ensure snapshot exists before creating a safety backup.
    dir_path, zip_path = _safe_snapshot_paths(snapshot_name)
    if not os.path.isdir(dir_path) and not os.path.isfile(zip_path):
        raise FileNotFoundError(f"snapshot not found: {snapshot_name}")

    safety = None
    if create_safety:
        safety_name = time.strftime("%Y%m%d_%H%M%S") + "_safety"
        # Avoid colliding with the snapshot being restored if names match.
        if safety_name == snapshot_name or safety_name.removesuffix("_safety") == snapshot_name:
            safety_name = time.strftime("%Y%m%d_%H%M%S") + "_safety2"
        safety = backup_csv_files(include_thumbnails=False, snapshot_name=safety_name)

    restored = []
    skipped = []
    # Materialize members first so zip handles stay valid.
    members = list(_iter_snapshot_members(snapshot_name))
    for arcname, opener in members:
        dest = _resolve_restore_dest(arcname)
        if dest is None:
            skipped.append(arcname)
            continue
        dest_dir = os.path.dirname(dest)
        if dest_dir:
            os.makedirs(dest_dir, exist_ok=True)
        with opener() as src_f:
            data = src_f.read()
        write_atomic(dest, data)
        restored.append(arcname)

    return {
        "ok": True,
        "snapshot": snapshot_name,
        "safety_snapshot": (safety or {}).get("snapshot"),
        "restored": restored,
        "skipped": skipped,
    }
