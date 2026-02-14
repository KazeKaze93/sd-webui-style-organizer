"""
Style Matrix - CSV scanner for Style Grid.
Reads only from the extension's styles/ folder (user puts CSV files there).
"""

import csv
import logging
import os

from modules import scripts

logger = logging.getLogger(__name__)


def _parse_csv(filepath, source_label):
    """Parse a single CSV file. Returns list of style dicts with source (filename)."""
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
                if name:
                    styles.append({
                        "name": name,
                        "prompt": prompt,
                        "negative_prompt": negative,
                        "source": source_label,
                    })
    except Exception as e:
        logger.warning("Failed to read %s: %s", filepath, e)
    return styles


class StyleScanner:
    """
    Scans only the extension's styles/ folder.
    User places CSV files there; each file becomes a selectable source in the UI.
    """

    def __init__(self):
        self._base = scripts.basedir()
        self._styles_dir = os.path.join(self._base, "styles")

    def _ensure_styles_dir(self):
        """Create styles/ folder if it does not exist."""
        if not os.path.isdir(self._styles_dir):
            try:
                os.makedirs(self._styles_dir, exist_ok=True)
                logger.info("[Style Grid] Created folder: %s — put your CSV files here.", self._styles_dir)
            except Exception as e:
                logger.warning("[Style Grid] Could not create styles folder %s: %s", self._styles_dir, e)

    def _csv_paths(self):
        """All .csv files in extension styles/ folder."""
        self._ensure_styles_dir()
        if not os.path.isdir(self._styles_dir):
            return []
        out = []
        for fname in sorted(os.listdir(self._styles_dir)):
            if fname.lower().endswith(".csv"):
                out.append(os.path.join(self._styles_dir, fname))
        return out

    def scan(self):
        """
        Scan extension styles/ folder. Returns (sources, styles).
        - sources: list of CSV filenames (e.g. ["my_styles.csv", "other.csv"]).
        - styles: list of style dicts (name, prompt, negative_prompt, source).
        """
        sources = []
        all_styles = []
        for path in self._csv_paths():
            label = os.path.basename(path)
            for s in _parse_csv(path, label):
                all_styles.append(s)
            sources.append(label)
        return sources, all_styles


def merge_styles_by_priority(styles):
    """
    Deduplicate by name; when duplicates exist, keep first occurrence (order = file order).
    """
    by_name = {}
    for s in styles:
        name = s.get("name")
        if not name:
            continue
        if name not in by_name:
            by_name[name] = s
    return list(by_name.values())
