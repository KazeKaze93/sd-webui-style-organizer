"""Stable relative source ids for style CSV packs (no Gradio/FastAPI)."""

from __future__ import annotations

import hashlib
import os
from collections import OrderedDict

from modules import shared  # type: ignore[reportMissingImports]

from stylegrid import config
from stylegrid.config import is_samples_source

_FORBIDDEN_LEAF_CHARS = frozenset({"/", "\\", ":", "\x00"})


def webui_styles_root() -> str:
    """Abs folder that holds the default WebUI styles.csv.

    Forge sets ``shared.styles_filename`` to ``<data_path>/styles.csv``
    (``modules.shared`` / ``modules.paths_internal.data_path``, from ``--data-dir``).
    Prefer ``shared.cmd_opts.data_path``; fall back to ``os.getcwd()`` when unset.
    """
    data_path = config._get_webui_data_path()
    if data_path:
        return os.path.normpath(os.path.abspath(data_path))
    return os.path.normpath(os.path.abspath(os.getcwd()))


def _leaf_ok(leaf: str) -> bool:
    if not leaf or leaf in (".", ".."):
        return False
    if any(ch in leaf for ch in _FORBIDDEN_LEAF_CHARS):
        return False
    if not leaf.lower().endswith(".csv"):
        return False
    return True


def _shared_parent_paths() -> list[str]:
    """Abs parents for shared/ ids: prompt_styles parents and WebUI cwd when needed.

    Excludes styles/, samples/, and webui_styles_root(). When process cwd equals
    the webui root, cwd packs already map to ``webui/<f.csv>``; otherwise cwd is
    included so root-scan packs map to ``shared/<cwd folder>/<f.csv>``.
    """
    fixed = {
        os.path.normcase(os.path.normpath(os.path.abspath(os.path.join(config.EXT_DIR, "styles")))),
        os.path.normcase(os.path.normpath(os.path.abspath(os.path.join(config.EXT_DIR, "samples")))),
        os.path.normcase(webui_styles_root()),
    }
    out: list[str] = []
    seen: set[str] = set()
    try:
        files = list(shared.prompt_styles.all_styles_files)
    except Exception:
        files = []
    for p in files:
        try:
            parent = os.path.normpath(os.path.abspath(str(p.parent)))
        except Exception:
            continue
        key = os.path.normcase(parent)
        if key in fixed or key in seen:
            continue
        seen.add(key)
        out.append(parent)
    try:
        cwd = os.path.normpath(os.path.abspath(os.getcwd()))
        key = os.path.normcase(cwd)
        if key not in fixed and key not in seen:
            seen.add(key)
            out.append(cwd)
    except Exception:
        pass
    out.sort(key=lambda p: os.path.normcase(p))
    return out


def _shared_prefix_for_parent(parent: str, all_shared: list[str]) -> str:
    base = os.path.basename(parent)
    same = [p for p in all_shared if os.path.basename(p) == base]
    if len(same) <= 1:
        return f"shared/{base}"
    digest = hashlib.md5(os.path.normcase(parent).encode("utf-8")).hexdigest()[:6]
    return f"shared/{base}~{digest}"


def source_roots() -> "OrderedDict[str, str]":
    """Ordered id-prefix -> abs root. Read config / shared at call time for monkeypatching."""
    roots: OrderedDict[str, str] = OrderedDict()
    roots["styles"] = os.path.normpath(os.path.abspath(os.path.join(config.EXT_DIR, "styles")))
    roots["samples"] = os.path.normpath(os.path.abspath(os.path.join(config.EXT_DIR, "samples")))
    roots["webui"] = webui_styles_root()
    shared_parents = _shared_parent_paths()
    for parent in shared_parents:
        prefix = _shared_prefix_for_parent(parent, shared_parents)
        roots[prefix] = parent
    return roots


def is_source_id(value: str) -> bool:
    """True when value looks like a public source id with a known prefix form."""
    if not isinstance(value, str) or not value:
        return False
    if "\\" in value or "\x00" in value:
        return False
    parts = value.split("/")
    if len(parts) == 2 and parts[0] in ("styles", "samples", "webui"):
        return _leaf_ok(parts[1])
    if len(parts) == 3 and parts[0] == "shared":
        dir_part, leaf = parts[1], parts[2]
        if not dir_part or any(ch in dir_part for ch in _FORBIDDEN_LEAF_CHARS):
            return False
        return _leaf_ok(leaf)
    return False


def to_source_id(path: str) -> str | None:
    """Map an absolute filesystem path to a public source id, or None."""
    if not path or not isinstance(path, str):
        return None
    abs_path = os.path.normpath(os.path.abspath(path))
    if not abs_path.lower().endswith(".csv"):
        return None
    base = os.path.basename(abs_path)
    parent = os.path.dirname(abs_path)
    parent_key = os.path.normcase(parent)
    for prefix, root in source_roots().items():
        if os.path.normcase(os.path.normpath(os.path.abspath(root))) == parent_key:
            return f"{prefix}/{base}"
    return None


def resolve_source_id(source_id: str) -> str | None:
    """Map a public source id to an abs path under the matching root, or None.

    Existence is not required (save may create a new styles/ file).
    """
    if not is_source_id(source_id):
        return None
    roots = source_roots()
    parts = source_id.split("/")
    if parts[0] in ("styles", "samples", "webui"):
        prefix, leaf = parts[0], parts[1]
    else:
        prefix, leaf = f"{parts[0]}/{parts[1]}", parts[2]
    root = roots.get(prefix)
    if root is None:
        return None
    root_abs = os.path.normpath(os.path.abspath(root))
    joined = os.path.normpath(os.path.join(root_abs, leaf))
    if os.path.normcase(os.path.dirname(joined)) != os.path.normcase(root_abs):
        return None
    return joined


def coerce_source_ref(value: str) -> str | None:
    """Resolve a client or internal source ref to an abs path under a known root.

    Empty -> None. Source ids and absolute paths that map into a root are accepted.
    Bare basenames are left to resolve_client_source (returns None here).
    """
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    if is_source_id(raw):
        return resolve_source_id(raw)
    if os.path.isabs(raw):
        sid = to_source_id(raw)
        if sid is None:
            return None
        return resolve_source_id(sid)
    return None


def resolve_client_source(value: str | None, *, for_write: bool = False) -> str | None:
    """Resolve a client source string to an abs CSV path.

    Accepts source ids and mappable abs paths. Bare basenames only when the leaf
    is unique among discovered files. When for_write is True, samples paths
    return None.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    resolved = coerce_source_ref(raw)
    if resolved is None:
        norm = raw.replace("\\", "/")
        if os.path.isabs(raw) or "/" in norm:
            return None
        leaf = os.path.basename(norm)
        if not leaf.lower().endswith(".csv"):
            leaf = leaf + ".csv"
        if not _leaf_ok(leaf):
            return None
        matches = [
            os.path.normpath(os.path.abspath(fp))
            for fp in config.get_all_styles_file_paths()
            if os.path.basename(fp) == leaf
        ]
        uniq: list[str] = []
        seen: set[str] = set()
        for fp in matches:
            key = os.path.normcase(fp)
            if key in seen:
                continue
            seen.add(key)
            uniq.append(fp)
        if len(uniq) != 1:
            return None
        resolved = uniq[0]
    if for_write and is_samples_source(resolved):
        return None
    return resolved


def source_id_for_compare(value: str | None) -> str | None:
    """Normalize a stored or client source ref to a public id for equality checks."""
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    if is_source_id(raw):
        if resolve_source_id(raw) is not None:
            return raw
        if raw.startswith(("styles/", "samples/", "webui/")):
            return raw
        return None
    coerced = coerce_source_ref(raw)
    if coerced is None:
        return None
    return to_source_id(coerced)
