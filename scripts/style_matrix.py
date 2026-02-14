"""
Style Matrix - Multi-source CSV scanner for Style Grid.
Scans Forge root, extension styles/, and config/sources.json.
"""

import csv
import json
import logging
import os

from modules import scripts, shared

logger = logging.getLogger(__name__)

SOURCE_PRIORITY_ROOT = 0
SOURCE_PRIORITY_INTERNAL = 1
SOURCE_PRIORITY_USER = 2


def _parse_csv(filepath, source_label, source_priority):
    """Parse a single CSV file. Returns list of style dicts with source and source_priority."""
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
                        "source_priority": source_priority,
                    })
    except Exception as e:
        logger.warning("Failed to read %s: %s", filepath, e)
    return styles


class StyleScanner:
    """
    Scans multiple CSV sources:
    a) Forge root styles.csv
    b) Extension styles/ folder (all .csv)
    c) Paths from config/sources.json
    """

    def __init__(self):
        self._base = scripts.basedir()

    def _root_styles_path(self):
        """Path to Forge root styles.csv."""
        root = getattr(shared.cmd_opts, "data_path", None) or os.getcwd()
        return os.path.abspath(os.path.join(root, "styles.csv"))

    def _internal_paths(self):
        """Paths to all .csv files in extension styles/."""
        styles_dir = os.path.join(self._base, "styles")
        if not os.path.isdir(styles_dir):
            return []
        out = []
        for fname in sorted(os.listdir(styles_dir)):
            if fname.lower().endswith(".csv"):
                out.append(os.path.join(styles_dir, fname))
        return out

    def _config_paths(self):
        """Paths listed in config/sources.json (user-defined)."""
        config_path = os.path.join(self._base, "config", "sources.json")
        if not os.path.isfile(config_path):
            return []
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            logger.warning("Could not load config/sources.json: %s", e)
            return []
        raw = data if isinstance(data, list) else data.get("paths") or data.get("sources") or []
        paths = []
        for p in raw:
            if not isinstance(p, str):
                continue
            path = os.path.normpath(p)
            if not os.path.isabs(path):
                path = os.path.join(self._base, path)
            if os.path.isfile(path) and path.lower().endswith(".csv"):
                paths.append(path)
            elif os.path.isdir(path):
                for fname in sorted(os.listdir(path)):
                    if fname.lower().endswith(".csv"):
                        paths.append(os.path.join(path, fname))
        return paths

    def scan(self):
        """
        Scan all sources. Returns (sources, styles).
        - sources: list of source labels (basenames), unique, order preserved.
        - styles: list of style dicts (name, prompt, negative_prompt, source, source_priority).
        """
        seen_sources = set()
        sources = []
        all_styles = []

        def add_from_path(filepath, priority):
            label = os.path.basename(filepath)
            for s in _parse_csv(filepath, label, priority):
                all_styles.append(s)
            if label not in seen_sources:
                seen_sources.add(label)
                sources.append(label)

        # a) Root styles.csv
        root_csv = self._root_styles_path()
        if os.path.isfile(root_csv):
            add_from_path(root_csv, SOURCE_PRIORITY_ROOT)

        # b) Extension styles/
        for path in self._internal_paths():
            add_from_path(path, SOURCE_PRIORITY_INTERNAL)

        # c) User config
        for path in self._config_paths():
            add_from_path(path, SOURCE_PRIORITY_USER)

        return sources, all_styles


def merge_styles_by_priority(styles):
    """
    Given a list of styles (each with name, source_priority), return a list with no duplicate names.
    For duplicates, keep the style with the highest source_priority (User > Internal > Root).
    """
    by_name = {}
    for s in styles:
        name = s.get("name")
        if not name:
            continue
        existing = by_name.get(name)
        if existing is None or (s.get("source_priority", 0) > existing.get("source_priority", 0)):
            by_name[name] = s
    return list(by_name.values())
