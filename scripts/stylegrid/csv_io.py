"""CSV parsing, style CRUD, categorization."""

import csv
import os

from stylegrid.cache import invalidate_styles_cache
from stylegrid.config import EXT_DIR, get_styles_dirs

FIELDNAMES = ["name", "prompt", "negative_prompt", "description", "category"]


def _sanitize_csv_cell(value):
    """Prevent CSV injection when opening in spreadsheet apps."""
    if isinstance(value, str) and value and value[0] in ('=', '+', '-', '@', '\t', '\r'):
        return "'" + value
    return value


def parse_styles_csv(filepath):
    styles = []
    if not os.path.isfile(filepath):
        return styles
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
                        "source": os.path.basename(filepath),
                        "source_file": os.path.abspath(filepath),
                    })
    except Exception as e:
        print(f"[Style Grid] Error reading {filepath}: {e}")
    return styles


def load_all_styles():
    all_styles = []
    seen_keys = set()
    for d in get_styles_dirs():
        if not os.path.isdir(d):
            continue
        for fname in sorted(os.listdir(d)):
            if fname.lower().endswith(".csv"):
                filepath = os.path.join(d, fname)
                for s in parse_styles_csv(filepath):
                    key = (s.get("source", ""), s["name"])
                    if key not in seen_keys:
                        seen_keys.add(key)
                        all_styles.append(s)
    root_csv = os.path.join(os.getcwd(), "styles.csv")
    if os.path.isfile(root_csv):
        for s in parse_styles_csv(root_csv):
            key = (s.get("source", ""), s["name"])
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


def categorize_styles(styles):
    categories = {}
    for s in styles:
        name = s["name"]
        source = s.get("source") or ""
        explicit_cat = s.get("category_explicit", "").strip()
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
        s["category"] = cat
        s["display_name"] = display
        s["has_placeholder"] = "{prompt}" in (s.get("prompt") or "") or "{prompt}" in (s.get("negative_prompt") or "")
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(s)
    for cat in categories:
        categories[cat].sort(key=lambda x: (x.get("display_name") or x["name"] or "").lower())
    return categories


def save_style_to_csv(name, prompt, negative_prompt, description="", source_file=None, category=None):
    if source_file:
        source_file = os.path.basename(source_file)
        if not source_file.lower().endswith('.csv'):
            source_file = source_file + '.csv'
    if not source_file:
        source_file = "styles.csv"
    target_path = None
    for d in get_styles_dirs():
        fp = os.path.join(d, source_file)
        if os.path.isfile(fp):
            target_path = fp
            break
    if not target_path:
        ext_styles = os.path.join(EXT_DIR, "styles")
        os.makedirs(ext_styles, exist_ok=True)
        target_path = os.path.join(ext_styles, source_file)
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
        return [
            _sanitize_csv_cell(name),
            _sanitize_csv_cell(prompt),
            _sanitize_csv_cell(negative_prompt),
            _sanitize_csv_cell(description),
            cat_cell,
        ]

    found = False
    for i, row in enumerate(rows):
        if row and row[0].strip() == name:
            rows[i] = make_row(rows[i])
            found = True
            break
    if not found:
        rows.append(make_row())
    with open(target_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        for row in rows:
            writer.writerow(row)
    invalidate_styles_cache()
    return True


def delete_style_from_csv(name, source_file=None):
    if not source_file:
        for s in load_all_styles():
            if s["name"] == name:
                source_file = s.get("source", "styles.csv")
                break
    if not source_file:
        return False
    if source_file:
        source_file = os.path.basename(source_file)
        if not source_file.lower().endswith('.csv'):
            source_file = source_file + '.csv'
    target_path = None
    for d in get_styles_dirs():
        fp = os.path.join(d, source_file)
        if os.path.isfile(fp):
            target_path = fp
            break
    if not target_path:
        return False
    rows = []
    header = None
    with open(target_path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for row in reader:
            if header is None and row and row[0].strip().lower() == "name":
                header = row
                continue
            if row and row[0].strip() != name:
                rows.append(row)
    with open(target_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            row_dict = {
                fn: (row[i].strip() if i < len(row) and row[i] is not None else "")
                for i, fn in enumerate(FIELDNAMES)
            }
            writer.writerow(row_dict)
    invalidate_styles_cache()
    return True
