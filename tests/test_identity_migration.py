"""Server-side favorites/recent/presets source-id migration."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from fastapi import FastAPI
from starlette.testclient import TestClient

from stylegrid import config as sg_config
from stylegrid import data_files as sg_data
from stylegrid import source_ids
from stylegrid.data_files import (
    classify_identity_items,
    migrate_favorites_once,
    migrate_identity_files_once,
    migrate_presets_source_ids_once,
    migrate_recent_once,
    style_row_key,
)
from stylegrid.routes import register_api


def _style(name, source_file, prompt="p", negative=""):
    return {
        "name": name,
        "source_file": source_file,
        "prompt": prompt,
        "negative_prompt": negative,
    }


def test_classify_id_composite_kept_even_if_unloaded():
    """Id composite for an unloaded pack stays; not remapped to another same-leaf pack."""
    styles = [_style("A", "styles/other.csv", "x")]
    entry = "styles/missing.csv\0A"
    result = classify_identity_items([entry], styles, link_identical_to_all=True)
    assert result["keys"] == [entry]
    assert result["stored"] == [entry]
    assert result["ambiguous_names"] == []


def test_classify_catalog_hit_kept():
    styles = [_style("A", "styles/pack.csv")]
    key = style_row_key("styles/pack.csv", "A")
    result = classify_identity_items([key], styles, link_identical_to_all=True)
    assert result["keys"] == [key]
    assert result["stored"] == [key]


def test_classify_abs_maps_via_to_source_id(tmp_path, monkeypatch):
    ext = tmp_path / "ext"
    (ext / "styles").mkdir(parents=True)
    (ext / "samples").mkdir(parents=True)
    monkeypatch.setattr(sg_config, "EXT_DIR", str(ext))
    abs_path = str(ext / "styles" / "pack.csv")
    Path(abs_path).write_text("name,prompt,negative_prompt\nA,p,\n", encoding="utf-8")
    styles = [_style("A", "styles/pack.csv")]
    entry = f"{abs_path}\0A"
    result = classify_identity_items([entry], styles, link_identical_to_all=True)
    assert result["keys"] == ["styles/pack.csv\0A"]
    assert result["stored"] == ["styles/pack.csv\0A"]


def test_classify_abs_unmappable_unique_leaf():
    styles = [
        _style("A", "styles/pack.csv", "same"),
        _style("B", "webui/other.csv", "x"),
    ]
    entry = r"D:\elsewhere\pack.csv" + "\0A"
    result = classify_identity_items([entry], styles, link_identical_to_all=True)
    assert result["keys"] == ["styles/pack.csv\0A"]
    assert result["stored"] == ["styles/pack.csv\0A"]


def test_classify_identical_favorites_all_keys():
    styles = [
        _style("A", "styles/a.csv", "same", "n"),
        _style("A", "webui/a.csv", "same", "n"),
    ]
    entry = "A"
    result = classify_identity_items([entry], styles, link_identical_to_all=True)
    assert result["keys"] == ["styles/a.csv\0A", "webui/a.csv\0A"]
    assert result["stored"] == result["keys"]
    assert result["ambiguous_names"] == []


def test_classify_identical_recent_keeps_stored():
    styles = [
        _style("A", "styles/a.csv", "same", "n"),
        _style("A", "webui/a.csv", "same", "n"),
    ]
    entry = "A"
    result = classify_identity_items([entry], styles, link_identical_to_all=False)
    assert result["keys"] == []
    assert result["stored"] == [entry]
    assert result["ambiguous_names"] == []


def test_classify_diverging_ambiguous_name_only():
    styles = [
        _style("A", "styles/a.csv", "p1", "n1"),
        _style("A", "webui/a.csv", "p2", "n2"),
    ]
    entry = r"D:\old\a.csv" + "\0A"
    result = classify_identity_items([entry], styles, link_identical_to_all=True)
    assert result["keys"] == []
    assert result["stored"] == [entry]
    assert result["ambiguous_names"] == ["A"]


def test_classify_bare_unique_and_missing_and_order_dedupe():
    styles = [_style("Only", "styles/x.csv")]
    items = ["Only", "Ghost", "Only", "styles/x.csv\0Only"]
    result = classify_identity_items(items, styles, link_identical_to_all=True)
    assert result["keys"] == ["styles/x.csv\0Only"]
    assert result["stored"] == ["styles/x.csv\0Only", "Ghost"]
    assert result["ambiguous_names"] == []


def test_classify_abs_composite_identical_multi_favorites():
    styles = [
        _style("A", "styles/a.csv", "same"),
        _style("A", "samples/a.csv", "same"),
    ]
    entry = r"C:\old\a.csv" + "\0A"
    result = classify_identity_items([entry], styles, link_identical_to_all=True)
    assert set(result["keys"]) == {"styles/a.csv\0A", "samples/a.csv\0A"}
    assert result["stored"] == result["keys"]


def _patch_identity_files(monkeypatch, tmp_path):
    fav = tmp_path / "favorites.json"
    recent = tmp_path / "recent.json"
    monkeypatch.setattr(sg_data, "FAVORITES_FILE", str(fav))
    monkeypatch.setattr(sg_data, "RECENT_FILE", str(recent))
    return fav, recent


def test_migrate_identity_writes_only_on_change(tmp_path, monkeypatch):
    fav, _recent = _patch_identity_files(monkeypatch, tmp_path)
    styles = [_style("A", "styles/pack.csv")]
    monkeypatch.setattr(sg_data, "get_cached_styles", lambda: styles)
    abs_path = r"D:\old\pack.csv"
    fav.write_text(
        json.dumps({"items": [f"{abs_path}\0A"]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        source_ids,
        "to_source_id",
        lambda p: "styles/pack.csv" if os.path.basename(p) == "pack.csv" else None,
    )
    writes = {"n": 0}
    real = sg_data.write_json_atomic

    def counting(path, data, **kw):
        writes["n"] += 1
        return real(path, data, **kw)

    monkeypatch.setattr(sg_data, "write_json_atomic", counting)
    migrate_identity_files_once()
    assert writes["n"] == 1
    on_disk = json.loads(fav.read_text(encoding="utf-8"))
    assert on_disk["items"] == ["styles/pack.csv\0A"]
    mtime = fav.stat().st_mtime
    time.sleep(0.02)
    migrate_identity_files_once()
    assert writes["n"] == 1
    assert fav.stat().st_mtime == mtime


def test_migrate_identity_corrupt_untouched(tmp_path, monkeypatch):
    fav, _recent = _patch_identity_files(monkeypatch, tmp_path)
    fav.write_text("{not json", encoding="utf-8")
    before = fav.read_bytes()
    monkeypatch.setattr(
        sg_data, "get_cached_styles", lambda: [_style("A", "styles/a.csv")]
    )
    migrate_identity_files_once()
    assert fav.read_bytes() == before


def test_migrate_identity_empty_catalog_no_write(tmp_path, monkeypatch, caplog):
    fav, _recent = _patch_identity_files(monkeypatch, tmp_path)
    fav.write_text(
        json.dumps({"items": ["Bare"]}),
        encoding="utf-8",
    )
    before = fav.read_bytes()
    monkeypatch.setattr(sg_data, "get_cached_styles", lambda: [])
    with caplog.at_level("INFO"):
        migrate_identity_files_once()
    assert fav.read_bytes() == before
    assert any("empty style catalog" in r.message for r in caplog.records)


def test_migrate_presets_abs_to_id_bak_idempotent(tmp_path, monkeypatch):
    ext = tmp_path / "ext"
    (ext / "styles").mkdir(parents=True)
    (ext / "samples").mkdir(parents=True)
    monkeypatch.setattr(sg_config, "EXT_DIR", str(ext))
    pack = ext / "styles" / "pack.csv"
    pack.write_text("name,prompt\nA,p\n", encoding="utf-8")
    presets_path = tmp_path / "presets.json"
    abs_sf = str(pack.resolve())
    outside = str(tmp_path / "elsewhere" / "gone.csv")
    presets_path.write_text(
        json.dumps(
            {
                "P": {
                    "styles": [
                        {"name": "A", "source_file": abs_sf, "weight": 1.0},
                        {"name": "B", "source_file": outside, "weight": 1.0},
                    ],
                    "wildcards": [],
                    "note": "",
                    "created": "2026-01-01T00:00:00",
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(sg_data, "PRESETS_FILE", str(presets_path))
    n1 = migrate_presets_source_ids_once()
    assert n1 == 1
    assert (presets_path.with_suffix(presets_path.suffix + ".bak")).is_file() or (
        Path(str(presets_path) + ".bak")
    ).is_file()
    disk = json.loads(presets_path.read_text(encoding="utf-8"))
    assert disk["P"]["styles"][0]["source_file"] == "styles/pack.csv"
    assert disk["P"]["styles"][1]["source_file"] == outside
    n2 = migrate_presets_source_ids_once()
    assert n2 == 0


def test_migrate_presets_corrupt_untouched(tmp_path, monkeypatch):
    presets_path = tmp_path / "presets.json"
    presets_path.write_text("{bad", encoding="utf-8")
    before = presets_path.read_bytes()
    monkeypatch.setattr(sg_data, "PRESETS_FILE", str(presets_path))
    assert migrate_presets_source_ids_once() == 0
    assert presets_path.read_bytes() == before


def test_get_favorites_ambiguous_recent_empty(tmp_path, monkeypatch):
    fav = tmp_path / "favorites.json"
    recent = tmp_path / "recent.json"
    monkeypatch.setattr(sg_data, "FAVORITES_FILE", str(fav))
    monkeypatch.setattr(sg_data, "RECENT_FILE", str(recent))
    monkeypatch.setattr(sg_config, "FAVORITES_FILE", str(fav))
    monkeypatch.setattr(sg_config, "RECENT_FILE", str(recent))

    styles = [
        _style("Dup", "styles/a.csv", "p1"),
        _style("Dup", "webui/a.csv", "p2"),
    ]
    fav.write_text(json.dumps({"items": ["Dup"]}), encoding="utf-8")
    recent.write_text(json.dumps({"items": ["Dup"]}), encoding="utf-8")

    from stylegrid import cache as sg_cache
    from stylegrid import routes as sg_routes

    monkeypatch.setattr(sg_cache, "get_cached_styles", lambda: styles)
    monkeypatch.setattr(sg_data, "get_cached_styles", lambda: styles)
    monkeypatch.setattr(sg_routes, "get_cached_styles", lambda: styles)
    # Avoid startup migration rewriting before GET assertions.
    monkeypatch.setattr(sg_routes, "migrate_identity_files_once", lambda: None)
    monkeypatch.setattr(sg_routes, "migrate_presets_source_ids_once", lambda: 0)

    app = FastAPI()
    register_api(None, app)
    with TestClient(app, base_url="http://127.0.0.1:7860") as client:
        rf = client.get("/style_grid/favorites")
        rr = client.get("/style_grid/recent")
    assert rf.status_code == 200
    assert rf.json()["ambiguous"] == ["Dup"]
    assert rr.status_code == 200
    assert rr.json()["ambiguous"] == []


def test_moved_install_links_by_unique_leaf(tmp_path, monkeypatch):
    """Tree-A abs favorites link by unique leaf against tree-B catalog; presets abs->id."""
    tree_a = tmp_path / "install_a" / "ext"
    tree_b = tmp_path / "install_b" / "ext"
    for tree in (tree_a, tree_b):
        (tree / "styles").mkdir(parents=True)
        (tree / "samples").mkdir(parents=True)
        (tree / "styles" / "pack.csv").write_text(
            "name,prompt,negative_prompt\nShared,p,n\n",
            encoding="utf-8",
        )

    abs_a = str((tree_a / "styles" / "pack.csv").resolve())
    abs_b = str((tree_b / "styles" / "pack.csv").resolve())

    monkeypatch.setattr(sg_config, "EXT_DIR", str(tree_b))
    fav, _recent = _patch_identity_files(monkeypatch, tmp_path)
    fav.write_text(
        json.dumps({"items": [f"{abs_a}\0Shared"]}),
        encoding="utf-8",
    )
    styles_b = [_style("Shared", "styles/pack.csv", "p", "n")]
    monkeypatch.setattr(sg_data, "get_cached_styles", lambda: styles_b)

    # Abs from tree A does not map under tree B roots; unique leaf match must link.
    assert source_ids.to_source_id(abs_a) is None
    migrate_identity_files_once()
    on_disk = json.loads(fav.read_text(encoding="utf-8"))
    assert on_disk["items"] == ["styles/pack.csv\0Shared"]

    presets_path = tmp_path / "presets.json"
    presets_path.write_text(
        json.dumps(
            {
                "P": {
                    "styles": [
                        {"name": "Shared", "source_file": abs_b, "weight": 1.0},
                    ],
                    "wildcards": [],
                    "note": "",
                    "created": "2026-01-01T00:00:00",
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(sg_data, "PRESETS_FILE", str(presets_path))
    assert source_ids.to_source_id(abs_b) == "styles/pack.csv"
    n = migrate_presets_source_ids_once()
    assert n == 1
    disk = json.loads(presets_path.read_text(encoding="utf-8"))
    assert disk["P"]["styles"][0]["source_file"] == "styles/pack.csv"


def test_migrate_favorites_once_bare_unique_stores_id(tmp_path, monkeypatch):
    fav, _recent = _patch_identity_files(monkeypatch, tmp_path)
    styles = [_style("Only", "styles/x.csv")]
    monkeypatch.setattr(sg_data, "get_cached_styles", lambda: styles)
    items, migrated = migrate_favorites_once(["Only"])
    assert migrated is True
    assert items == ["styles/x.csv\0Only"]
    assert json.loads(fav.read_text(encoding="utf-8"))["items"] == items


def test_migrate_favorites_once_identical_multi_all_keys(tmp_path, monkeypatch):
    fav, _recent = _patch_identity_files(monkeypatch, tmp_path)
    styles = [
        _style("A", "styles/a.csv", "same", "n"),
        _style("A", "webui/a.csv", "same", "n"),
    ]
    monkeypatch.setattr(sg_data, "get_cached_styles", lambda: styles)
    items, migrated = migrate_favorites_once(["A"])
    assert migrated is True
    assert items == ["styles/a.csv\0A", "webui/a.csv\0A"]
    assert json.loads(fav.read_text(encoding="utf-8"))["items"] == items


def test_migrate_favorites_once_diverging_kept_raw(tmp_path, monkeypatch):
    fav, _recent = _patch_identity_files(monkeypatch, tmp_path)
    styles = [
        _style("A", "styles/a.csv", "p1", "n1"),
        _style("A", "webui/a.csv", "p2", "n2"),
    ]
    monkeypatch.setattr(sg_data, "get_cached_styles", lambda: styles)
    items, migrated = migrate_favorites_once(["A"])
    assert migrated is True
    assert items == ["A"]
    assert json.loads(fav.read_text(encoding="utf-8"))["items"] == ["A"]


def test_migrate_recent_once_identical_kept_raw(tmp_path, monkeypatch):
    _fav, recent = _patch_identity_files(monkeypatch, tmp_path)
    styles = [
        _style("A", "styles/a.csv", "same", "n"),
        _style("A", "webui/a.csv", "same", "n"),
    ]
    monkeypatch.setattr(sg_data, "get_cached_styles", lambda: styles)
    items, migrated = migrate_recent_once(["A"])
    assert migrated is True
    assert items == ["A"]
    assert json.loads(recent.read_text(encoding="utf-8"))["items"] == ["A"]


def test_migrate_favorites_once_existing_file_untouched(tmp_path, monkeypatch):
    fav, _recent = _patch_identity_files(monkeypatch, tmp_path)
    fav.write_text(json.dumps({"items": ["styles/old.csv\0Keep"]}), encoding="utf-8")
    before = fav.read_bytes()
    styles = [_style("Only", "styles/x.csv")]
    monkeypatch.setattr(sg_data, "get_cached_styles", lambda: styles)
    writes = {"n": 0}
    real = sg_data.write_json_atomic

    def counting(path, data, **kw):
        writes["n"] += 1
        return real(path, data, **kw)

    monkeypatch.setattr(sg_data, "write_json_atomic", counting)
    items, migrated = migrate_favorites_once(["Only"])
    assert migrated is False
    assert items == ["styles/old.csv\0Keep"]
    assert writes["n"] == 0
    assert fav.read_bytes() == before


def test_migrate_favorites_once_empty_catalog_writes_raw(tmp_path, monkeypatch):
    fav, _recent = _patch_identity_files(monkeypatch, tmp_path)
    monkeypatch.setattr(sg_data, "get_cached_styles", lambda: [])
    items, migrated = migrate_favorites_once(["Bare"])
    assert migrated is True
    assert items == ["Bare"]
    assert json.loads(fav.read_text(encoding="utf-8"))["items"] == ["Bare"]
