"""enrich_style / categorize_styles purity and single catalog load via cache."""

from __future__ import annotations

import os
from pathlib import Path

from stylegrid import cache as sg_cache
from stylegrid import csv_io
from stylegrid import data_files as sg_data
import stylegrid.lora_scan as lora_scan

# Golden captured with the pre-change process() path
# (list(get_cached_styles()); inject preexisting display_name; categorize_styles(all_styles))
# against the three-pack fixture below. CSV parser never sets display_name; one row is
# injected to exercise the keep-existing-display_name rule (same as LoRA titles).
# Values: (source basename, name, category, display_name, has_placeholder).
GOLDEN_ALL_STYLES = [
    ("pack_a.csv", "BASE_Alpha", "BASE", "Alpha", False),
    ("pack_a.csv", "mood-calm", "mood", "calm", False),
    ("pack_a.csv", "plainone", "Pack_a", "Keep Me", True),
    ("pack_b.csv", "BASE_Beta", "BASE", "Beta", False),
    ("pack_b.csv", "BASE_Alpha", "BASE", "Alpha", False),
    ("pack_b.csv", "plainone", "Pack_b", "plainone", False),
    ("pack_c.csv", "CustomName", "EXPLICIT", "CustomName", False),
    ("pack_c.csv", "BASE_Gamma", "BASE", "Gamma", False),
]


def _write_golden_packs(tmp_path: Path) -> list[str]:
    a = tmp_path / "pack_a.csv"
    b = tmp_path / "pack_b.csv"
    c = tmp_path / "pack_c.csv"
    a.write_text(
        "name,prompt,negative_prompt,description,category\n"
        "BASE_Alpha,p_a1,n_a1,d,BASE\n"
        "mood-calm,p_a2,n_a2,d,\n"
        "plainone,{prompt} x,n_a3,d,\n",
        encoding="utf-8-sig",
    )
    b.write_text(
        "name,prompt,negative_prompt,description,category\n"
        "BASE_Beta,p_b1,n_b1,d,BASE\n"
        "BASE_Alpha,p_b_dup,n_b_dup,d,BASE\n"
        "plainone,p_b3,n_b3,d,\n",
        encoding="utf-8-sig",
    )
    c.write_text(
        "name,prompt,negative_prompt,description,category\n"
        "CustomName,p_c1,n_c1,d,EXPLICIT\n"
        "BASE_Gamma,p_c2,n_c2,d,BASE\n",
        encoding="utf-8-sig",
    )
    return [str(a), str(b), str(c)]


def _patch_style_paths(monkeypatch, paths: list[str]) -> None:
    monkeypatch.setattr(csv_io, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(sg_cache, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(lora_scan, "get_cached_lora_styles", lambda: [])
    sg_cache._file_hashes.clear()
    sg_cache.invalidate_styles_cache()


def _fingerprint(styles: list[dict]) -> list[tuple]:
    return [
        (
            os.path.basename(s.get("source_file") or ""),
            s["name"],
            s.get("category"),
            s.get("display_name"),
            bool(s.get("has_placeholder")),
        )
        for s in styles
    ]


def test_process_path_enriched_order_matches_prechange_golden(tmp_path, monkeypatch):
    paths = _write_golden_packs(tmp_path)
    _patch_style_paths(monkeypatch, paths)

    raw = list(sg_cache.get_cached_styles())
    # CSV parser never sets display_name; inject the same preexisting title used in the golden.
    for s in raw:
        if s["name"] == "plainone" and os.path.basename(s.get("source_file") or "") == "pack_a.csv":
            s["display_name"] = "Keep Me"
            break
    enriched = [csv_io.enrich_style(s) for s in raw]
    assert _fingerprint(enriched) == GOLDEN_ALL_STYLES


def test_enrich_and_categorize_do_not_mutate_input():
    underscore = {
        "name": "BASE_Alpha",
        "prompt": "p",
        "negative_prompt": "",
        "source": "pack.csv",
        "source_file": "/tmp/pack.csv",
        "category_explicit": "",
    }
    hyphen = {
        "name": "mood-calm",
        "prompt": "p",
        "negative_prompt": "",
        "source": "pack.csv",
        "source_file": "/tmp/pack.csv",
        "category_explicit": "",
    }
    plain = {
        "name": "plainone",
        "prompt": "p",
        "negative_prompt": "",
        "source": "pack_a.csv",
        "source_file": "/tmp/pack_a.csv",
        "category_explicit": "",
    }
    explicit = {
        "name": "CustomName",
        "prompt": "{prompt}, x",
        "negative_prompt": "",
        "source": "pack_c.csv",
        "source_file": "/tmp/pack_c.csv",
        "category_explicit": "EXPLICIT",
    }
    kept = {
        "name": "plainone",
        "prompt": "p",
        "negative_prompt": "",
        "source": "pack_a.csv",
        "source_file": "/tmp/pack_a.csv",
        "category_explicit": "",
        "display_name": "Keep Me",
    }
    samples = [underscore, hyphen, plain, explicit, kept]
    snapshots = [dict(s) for s in samples]

    enriched = [csv_io.enrich_style(s) for s in samples]
    categories = csv_io.categorize_styles(samples)

    for original, after in zip(snapshots, samples):
        assert after == original

    assert enriched[0]["category"] == "BASE"
    assert enriched[0]["display_name"] == "Alpha"
    assert enriched[1]["category"] == "mood"
    assert enriched[1]["display_name"] == "calm"
    assert enriched[2]["category"] == "Pack_a"
    assert enriched[2]["display_name"] == "plainone"
    assert enriched[3]["category"] == "EXPLICIT"
    assert enriched[3]["has_placeholder"] is True
    assert enriched[4]["display_name"] == "Keep Me"
    assert enriched[4]["category"] == "Pack_a"

    assert categories["BASE"][0]["name"] == "BASE_Alpha"
    assert categories["mood"][0]["name"] == "mood-calm"
    assert categories["EXPLICIT"][0]["name"] == "CustomName"


def test_normalize_presets_reuses_styles_cache(tmp_path, monkeypatch):
    paths = _write_golden_packs(tmp_path)
    _patch_style_paths(monkeypatch, paths)

    calls = {"n": 0}
    real = csv_io.parse_styles_csv

    def counting(filepath):
        calls["n"] += 1
        return real(filepath)

    monkeypatch.setattr(csv_io, "parse_styles_csv", counting)

    sg_cache.get_cached_styles()
    sg_data.normalize_presets({})
    sg_data.normalize_presets({"P": {"styles": ["BASE_Alpha"], "created": "2026-01-01T00:00:00"}})
    # One full catalog load = one parse per fixture CSV; cache must serve both normalize_presets.
    assert calls["n"] == len(paths)
