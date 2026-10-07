"""Atomic writes and corrupt-data guards for JSON/CSV persistence.

Canonical copy lives here. Keep ComfyUI ``stylegrid/safe_persistence.py`` and
csv-script ``tools/dict/safe_persistence.py`` byte-identical (parity tests pin
the sha256). Sync with ``tools/sync_safe_persistence.py`` in the csv-script repo.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

# Retention: path.bak = newest previous; path.bak.2 / path.bak.3 = older.
BACKUP_GENERATIONS = 3
REPLACE_RETRIES = 3
REPLACE_BACKOFF_SEC = 0.05


class CorruptDataError(Exception):
    """On-disk file exists but cannot be read or parsed safely."""

    def __init__(self, path: str | os.PathLike[str], message: str, cause: BaseException | None = None):
        self.path = str(path)
        self.cause = cause
        detail = f"{message}: {path}"
        if cause is not None:
            detail = f"{detail} ({type(cause).__name__}: {cause})"
        super().__init__(detail)


class UnsafeOutputDirError(ValueError):
    """Output directory is outside the allowed root or would destroy inputs."""


class PersistenceLockedError(OSError):
    """File is locked (antivirus / indexer / Excel); replace failed after retries."""


def load_json_object(path: str | os.PathLike[str]) -> dict[str, Any]:
    """Load a JSON object from *path*.

    Missing file → ``{}``.
    Exists but IO/parse failure or non-object → ``CorruptDataError`` (never ``{}``).
    """
    path_str = str(path)
    if not os.path.isfile(path_str):
        return {}
    try:
        with open(path_str, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError, UnicodeError) as exc:
        raise CorruptDataError(path_str, "unreadable or invalid JSON", cause=exc) from exc
    if not isinstance(data, dict):
        raise CorruptDataError(path_str, "JSON root must be an object")
    return data


def ensure_json_writable(path: str | os.PathLike[str]) -> None:
    """Refuse overwrite when an existing file is corrupt."""
    if os.path.isfile(path):
        load_json_object(path)


def bak_paths(path: str | os.PathLike[str]) -> list[str]:
    """Return backup slot paths: ``.bak``, ``.bak.2``, ``.bak.3`` (newest first)."""
    base = str(path) + ".bak"
    paths = [base]
    for n in range(2, BACKUP_GENERATIONS + 1):
        paths.append(f"{base}.{n}")
    return paths


def cleanup_stale_tmp(path: str | os.PathLike[str]) -> None:
    """Remove an orphaned ``path.tmp`` left by a crashed write."""
    tmp_path = str(path) + ".tmp"
    try:
        if os.path.isfile(tmp_path):
            os.remove(tmp_path)
    except OSError:
        pass


def cleanup_stale_tmp_in_dir(directory: str | os.PathLike[str]) -> int:
    """Remove ``*.tmp`` files directly under *directory*. Returns count removed."""
    removed = 0
    try:
        names = os.listdir(directory)
    except OSError:
        return 0
    for name in names:
        if not name.endswith(".tmp"):
            continue
        full = os.path.join(str(directory), name)
        if not os.path.isfile(full):
            continue
        try:
            os.remove(full)
            removed += 1
        except OSError:
            pass
    return removed


def _replace_with_retry(src: str, dst: str) -> None:
    last_exc: BaseException | None = None
    for attempt in range(REPLACE_RETRIES):
        try:
            os.replace(src, dst)
            return
        except PermissionError as exc:
            last_exc = exc
            if attempt + 1 < REPLACE_RETRIES:
                time.sleep(REPLACE_BACKOFF_SEC * (2**attempt))
    raise PersistenceLockedError(
        f"could not replace {dst!r} with {src!r} after {REPLACE_RETRIES} tries "
        f"(file may be locked by antivirus, indexer, or another app): {last_exc}"
    ) from last_exc


def _rotate_backups(path_str: str) -> None:
    """Shift existing backups: bak.2→bak.3, bak→bak.2, then path will move to bak."""
    slots = bak_paths(path_str)  # [bak, bak.2, bak.3]
    # Drop oldest
    oldest = slots[-1]
    if os.path.isfile(oldest):
        try:
            os.remove(oldest)
        except OSError:
            pass
    # Shift older ← newer (from oldest-1 down to bak)
    for i in range(len(slots) - 1, 0, -1):
        newer = slots[i - 1]
        older = slots[i]
        if os.path.isfile(newer):
            _replace_with_retry(newer, older)


def write_atomic(path: str | os.PathLike[str], data: bytes | str, *, encoding: str = "utf-8") -> None:
    """Write *data* atomically with rotated backups and locked-file retry.

    Sequence: clean stale ``path.tmp`` → write+fsync tmp → rotate ``.bak`` slots →
    move current file to ``.bak`` → ``os.replace(tmp, path)``.
    """
    path_str = str(path)
    directory = os.path.dirname(path_str)
    if directory:
        os.makedirs(directory, exist_ok=True)

    cleanup_stale_tmp(path_str)

    raw = data.encode(encoding) if isinstance(data, str) else data
    tmp_path = path_str + ".tmp"

    try:
        with open(tmp_path, "wb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())

        if os.path.isfile(path_str):
            _rotate_backups(path_str)
            _replace_with_retry(path_str, path_str + ".bak")

        _replace_with_retry(tmp_path, path_str)
    except Exception:
        cleanup_stale_tmp(path_str)
        raise


def write_json_atomic(path: str | os.PathLike[str], obj: Mapping[str, Any], *, indent: int = 2) -> None:
    """Serialize *obj* as UTF-8 JSON and ``write_atomic``."""
    ensure_json_writable(path)
    payload = json.dumps(obj, indent=indent, ensure_ascii=False)
    if not payload.endswith("\n"):
        payload += "\n"
    write_atomic(path, payload, encoding="utf-8")


def _is_strictly_inside(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
    except ValueError:
        return False
    return child != parent


def assert_safe_outdir(
    out_dir: str | os.PathLike[str],
    *,
    allowed_roots: Sequence[str | os.PathLike[str]],
    catalog_dir: str | os.PathLike[str] | None = None,
    repo_root: str | os.PathLike[str] | None = None,
) -> Path:
    """Assert *out_dir* is safe to ``rmtree`` / bulk-overwrite.

    Rules (all path comparisons on ``resolve()``d paths):
    - target must be **strictly inside** one of *allowed_roots*;
    - target must not be *repo_root*;
    - target must not be *catalog_dir* or an ancestor of *catalog_dir*.
    """
    if not allowed_roots:
        raise UnsafeOutputDirError("allowed_roots must be non-empty")

    target = Path(out_dir).resolve()
    roots = [Path(r).resolve() for r in allowed_roots]

    if not any(_is_strictly_inside(target, root) for root in roots):
        raise UnsafeOutputDirError(
            f"out_dir {target} is not strictly inside an allowed root "
            f"({', '.join(str(r) for r in roots)})"
        )

    if repo_root is not None:
        root = Path(repo_root).resolve()
        if target == root:
            raise UnsafeOutputDirError(f"out_dir {target} must not be the repo root")

    if catalog_dir is not None:
        catalog = Path(catalog_dir).resolve()
        if target == catalog:
            raise UnsafeOutputDirError(f"out_dir {target} must not equal catalog_dir")
        if target in catalog.parents:
            raise UnsafeOutputDirError(
                f"out_dir {target} is an ancestor of catalog_dir {catalog}"
            )

    return target


def rmtree_safe(
    out_dir: str | os.PathLike[str],
    *,
    allowed_roots: Iterable[str | os.PathLike[str]],
    catalog_dir: str | os.PathLike[str] | None = None,
    repo_root: str | os.PathLike[str] | None = None,
) -> Path:
    """``assert_safe_outdir`` then ``shutil.rmtree`` when the path exists."""
    import shutil

    target = assert_safe_outdir(
        out_dir,
        allowed_roots=list(allowed_roots),
        catalog_dir=catalog_dir,
        repo_root=repo_root,
    )
    if target.exists():
        shutil.rmtree(target)
    return target
