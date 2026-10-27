"""CSV parsing, style CRUD, categorization."""

import csv
import io
import logging
import os

from modules import shared

from stylegrid.cache import invalidate_styles_cache
from stylegrid.config import EXT_DIR, get_all_styles_file_paths, is_samples_source
from stylegrid.lora_scan import LORA_SOURCE, get_cached_lora_styles
from stylegrid.safe_persistence import locked_path, write_atomic
from stylegrid.source_ids import is_source_id, resolve_client_source, to_source_id

log = logging.getLogger(__name__)

# Canonical CSV column order used when writing style rows back to disk.
FIELDNAMES = ["name", "prompt", "negative_prompt", "description", "category"]


def _write_csv_atomic(target_path, header, rows):
    buf = io.StringIO(newline="")
    writer = csv.writer(buf)
    writer.writerow(header)
    for row in rows:
        writer.writerow(row)
    write_atomic(target_path, buf.getvalue().encode("utf-8-sig"))


def _sanitize_csv_cell(value):
    """Prevent CSV injection when opening in spreadsheet apps."""
    if isinstance(value, str) and value and value[0] in ('=', '+', '-', '@', '\t', '\r'):
        return "'" + value
    return value


def normalize_source_path(path: str) -> str:
    """Normalize a source path for reliable comparison across OS/JS boundaries."""
    if not path:
        return path
    return os.path.abspath(path).replace("\\", "/")


def _resolve_write_target(source_file):
    """Resolve a client source ref for CSV writes via resolve_client_source.

    Returns an abs path, or None when the ref is refused (samples, ambiguous,
    unmappable). When a bare basename is not yet discovered, falls back to
    creating under ``<EXT_DIR>/styles/`` (legacy save behavior).
    """
    raw = (source_file or "").strip() or "styles.csv"
    resolved = resolve_client_source(raw, for_write=True)
    if resolved:
        return resolved

    norm = raw.replace("\\", "/")
    if is_source_id(raw) or os.path.isabs(raw) or "/" in norm:
        return None

    leaf = os.path.basename(norm)
    if not leaf.lower().endswith(".csv"):
        leaf = leaf + ".csv"
    matches = [
        fp for fp in get_all_styles_file_paths() if os.path.basename(fp) == leaf
    ]
    if len(matches) > 1:
        return None
    if len(matches) == 1 and is_samples_source(matches[0]):
        return None

    ext_styles = os.path.join(EXT_DIR, "styles")
    os.makedirs(ext_styles, exist_ok=True)
    return os.path.join(ext_styles, leaf)


def parse_styles_csv(filepath):
    """
    Parse one styles CSV file as UTF-8/UTF-8-BOM and return normalized style dicts.

    Returns list items with keys: name, prompt, negative_prompt, description,
    category_explicit, source (basename), and source_file (public relative id).
    Files that cannot be mapped to a known root are skipped with a warning.
    """
    styles = []
    if not os.path.isfile(filepath):
        return styles
    source_id = to_source_id(filepath)
    if source_id is None:
        log.warning(
            "[Style Grid] skipping CSV outside known roots: %s",
            filepath,
        )
        return styles
    base = os.path.basename(filepath)
    try:
        with open(filepath, "r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            header = None
            for row in reader:
                if not row or all(c.strip() == "" for c in row):
                    continue
                if header is None and row[0].strip().lower() == "name":
                    header = row
                    continue
                if header is None:
                    header = ["name", "prompt", "negative_prompt"]
                name = row[0].strip() if len(row) > 0 else ""
                prompt = row[1].strip() if len(row) > 1 else ""
                negative = row[2].strip() if len(row) > 2 else ""
                description = row[3].strip() if len(row) > 3 else ""
                category_explicit = row[4].strip() if len(row) > 4 else ""
                if name:
                    styles.append({
                        "name": name,
                        "prompt": prompt,
                        "negative_prompt": negative,
                        "description": description,
                        "category_explicit": category_explicit,
                        "source": base,
                        "_source": base,
                        "source_file": source_id,
                        "read_only": is_samples_source(filepath),
                    })
    except Exception:
        return styles
    return styles


def load_all_styles():
    """Merge CSVs from all style dirs; uniqueness is (source_file id, name), not basename."""
    all_styles = []
    seen_keys = set()
    for filepath in get_all_styles_file_paths():
        for s in parse_styles_csv(filepath):
            key = (s.get("source_file", ""), s["name"])
            if key not in seen_keys:
                seen_keys.add(key)
                all_styles.append(s)
    return all_styles


def _category_from_filename(source):
    if not source or not isinstance(source, str):
        return ""
    base = os.path.splitext(source.strip())[0].strip()
    if not base:
        return ""
    return base[0].upper() + base[1:]


def enrich_style(s: dict) -> dict:
    """Return a shallow copy with category, display_name, and has_placeholder set.

    An existing display_name is kept (LoRA scan pre-sets titles).
    """
    out = dict(s)
    name = out["name"]
    source = out.get("source") or ""
    explicit_cat = (out.get("category_explicit") or "").strip()
    if explicit_cat:
        cat = explicit_cat
        display = name.split("_", 1)[1].replace("_", " ") if "_" in name else name
    elif "_" in name:
        before, rest = name.split("_", 1)
        cat = before.upper()
        display = rest.replace("_", " ")
    elif "-" in name:
        before, rest = name.split("-", 1)
        cat = before
        display = rest.replace("-", " ")
    else:
        cat = _category_from_filename(source)
        if not cat:
            cat = "OTHER"
        display = name.replace("_", " ")
    out["category"] = cat
    if not out.get("display_name"):
        out["display_name"] = display
    out["has_placeholder"] = "{prompt}" in (out.get("prompt") or "") or "{prompt}" in (
        out.get("negative_prompt") or ""
    )
    return out


def categorize_styles(styles):
    categories = {}
    for s in styles:
        row = enrich_style(s)
        cat = row["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(row)
    for cat in categories:
        categories[cat].sort(key=lambda x: (x.get("display_name") or x["name"] or "").lower())
    return categories


def save_style_to_csv(name, prompt, negative_prompt, description="", source_file=None, category=None):
    """
    Upsert a style row in target CSV: replace all matching name rows, or append new row.
    """
    if source_file == LORA_SOURCE:
        raise ValueError("LoRA-sourced styles are read-only and cannot be edited or saved.")
    target_path = _resolve_write_target(source_file)
    if not target_path:
        return False
    with locked_path(target_path):
        rows = []
        header = None
        if os.path.isfile(target_path):
            with open(target_path, "r", encoding="utf-8-sig") as f:
                reader = csv.reader(f)
                for row in reader:
                    if header is None and row and row[0].strip().lower() == "name":
                        header = row
                        continue
                    rows.append(row)
        if not header:
            header = ["name", "prompt", "negative_prompt", "description", "category"]

        def make_row(existing_row=None):
            existing_cat = existing_row[4].strip() if (
                existing_row and len(existing_row) > 4) else ""
            if category is None:
                cat_cell = existing_cat
            else:
                cat_cell = str(category).strip()
                cat_cell = _sanitize_csv_cell(cat_cell) if cat_cell else ""
            base = [name, prompt, negative_prompt, _sanitize_csv_cell(description), cat_cell]
            extra = list(existing_row[5:]) if existing_row and len(existing_row) > 5 else []
            # Pad extras to the file's actual header width so every row stays rectangular.
            while len(base) + len(extra) < len(header):
                extra.append("")
            return base + extra

        found = False
        for i, row in enumerate(rows):
            if row and row[0].strip() == name:
                rows[i] = make_row(rows[i])
                found = True
        if not found:
            rows.append(make_row())
        _write_csv_atomic(target_path, header, rows)
    invalidate_styles_cache()
    shared.prompt_styles.reload()
    return True


def delete_style_from_csv(name, source_file=None):
    """Delete style row by name from selected/inferred source; returns False when not found."""
    if source_file == LORA_SOURCE:
        raise ValueError("LoRA-sourced styles are read-only and cannot be deleted.")
    if not source_file:
        for s in load_all_styles():
            if s["name"] == name:
                source_file = s.get("source_file") or s.get("source", "styles.csv")
                break
    if not source_file:
        for s in get_cached_lora_styles():
            if s.get("name") == name:
                raise ValueError("LoRA-sourced styles are read-only and cannot be deleted.")
        return False
    target_path = resolve_client_source(source_file, for_write=True)
    if not target_path:
        return False
    if not os.path.isfile(target_path):
        return False
    with locked_path(target_path):
        rows = []
        header = None
        removed = False
        with open(target_path, "r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            for row in reader:
                if header is None and row and row[0].strip().lower() == "name":
                    header = row
                    continue
                if row and row[0].strip() == name:
                    removed = True
                    continue
                if row:
                    rows.append(row)
        if not removed:
            return False
        _write_csv_atomic(target_path, header or FIELDNAMES, rows)
    invalidate_styles_cache()
    shared.prompt_styles.reload()
    return True


def rename_style_in_csv(old_name, new_name, source_file=None, **fields):
    """
    Rename a style row in place in the target CSV, optionally updating fields.

    Locates the file via resolve_client_source. Preserves row order. Raises
    ValueError when the row is missing, LoRA-sourced, colliding, or when
    old_name matches more than one row in the file.
    """
    old_name = (old_name or "").strip()
    new_name = (new_name or "").strip()
    if not old_name:
        raise ValueError("old_name is required")
    if not new_name:
        raise ValueError("new_name is required")

    if source_file == LORA_SOURCE:
        raise ValueError("LoRA-sourced styles are read-only and cannot be renamed.")

    if not source_file:
        for s in load_all_styles():
            if s["name"] == old_name:
                source_file = s.get("source_file") or s.get("source", "styles.csv")
                break
    if not source_file:
        for s in get_cached_lora_styles():
            if s.get("name") == old_name:
                raise ValueError("LoRA-sourced styles are read-only and cannot be renamed.")
        raise ValueError(f"Style not found: {old_name}")

    target_path = resolve_client_source(source_file, for_write=True)
    if not target_path or not os.path.isfile(target_path):
        raise ValueError(f"Style not found: {old_name}")

    with locked_path(target_path):
        rows = []
        header = None
        with open(target_path, "r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            for row in reader:
                if header is None and row and row[0].strip().lower() == "name":
                    header = row
                    continue
                rows.append(row)
        if not header:
            header = list(FIELDNAMES)

        match_indices = [
            i for i, row in enumerate(rows)
            if row and row[0].strip() == old_name
        ]
        if not match_indices:
            raise ValueError(f"Style not found: {old_name}")
        if len(match_indices) > 1:
            raise ValueError(
                f"Ambiguous rename: {len(match_indices)} rows named {old_name!r} "
                f"in {os.path.basename(target_path)}; refuse to rename duplicates"
            )

        idx = match_indices[0]
        if old_name != new_name:
            for i, row in enumerate(rows):
                if i == idx:
                    continue
                if row and row[0].strip() == new_name:
                    raise ValueError(
                        f"Name collision: {new_name!r} already exists in "
                        f"{os.path.basename(target_path)}"
                    )

        existing = rows[idx]

        def cell(i, default=""):
            return existing[i].strip() if i < len(existing) and existing[i] is not None else default

        prompt = fields["prompt"] if "prompt" in fields else cell(1)
        negative_prompt = fields["negative_prompt"] if "negative_prompt" in fields else cell(2)
        description = fields["description"] if "description" in fields else cell(3)
        if "category" in fields:
            cat_cell = str(fields["category"]).strip() if fields["category"] is not None else ""
            cat_cell = _sanitize_csv_cell(cat_cell) if cat_cell else ""
        else:
            cat_cell = cell(4)

        # Preserve trailing columns (same contract as save_style_to_csv); only name changes.
        base = [
            new_name,
            prompt,
            negative_prompt,
            _sanitize_csv_cell(description) if description else "",
            cat_cell,
        ]
        extra = list(existing[5:]) if len(existing) > 5 else []
        while len(base) + len(extra) < len(header):
            extra.append("")
        rows[idx] = base + extra

        _write_csv_atomic(target_path, header, rows)
    invalidate_styles_cache()
    shared.prompt_styles.reload()
    return True
