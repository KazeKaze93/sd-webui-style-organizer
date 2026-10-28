"""Relative source ids: resolver, csv emit, writes, active_source pool."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from stylegrid import config as sg_config
from stylegrid import csv_io, source_ids
from stylegrid import thumbnails as sg_thumbs
from stylegrid.routes import register_api


def _write_csv(path: Path, name: str = "S1", prompt: str = "p") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "name,prompt,negative_prompt,description,category\n"
        f"{name},{prompt},n,d,BASE\n",
        encoding="utf-8-sig",
    )


def _patch_ext(monkeypatch, ext: Path, webui: Path | None = None) -> None:
    ext.mkdir(parents=True, exist_ok=True)
    (ext / "styles").mkdir(parents=True, exist_ok=True)
    (ext / "samples").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(sg_config, "EXT_DIR", str(ext))
    monkeypatch.setattr(csv_io, "EXT_DIR", str(ext))
    if webui is not None:
        webui.mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr(source_ids, "webui_styles_root", lambda: str(webui))
        monkeypatch.setattr(
            sg_config,
            "_get_webui_data_path",
            lambda: str(webui),
        )


def test_round_trip_styles_samples_webui(tmp_path, monkeypatch):
    ext = tmp_path / "ext"
    webui = tmp_path / "webui_data"
    _patch_ext(monkeypatch, ext, webui)
    styles_csv = ext / "styles" / "a.csv"
    samples_csv = ext / "samples" / "a.csv"
    webui_csv = webui / "a.csv"
    _write_csv(styles_csv)
    _write_csv(samples_csv)
    _write_csv(webui_csv)

    assert source_ids.to_source_id(str(styles_csv)) == "styles/a.csv"
    assert source_ids.to_source_id(str(samples_csv)) == "samples/a.csv"
    assert source_ids.to_source_id(str(webui_csv)) == "webui/a.csv"

    assert source_ids.resolve_source_id("styles/a.csv") == os.path.normpath(
        os.path.abspath(str(styles_csv))
    )
    assert source_ids.resolve_source_id("samples/a.csv") == os.path.normpath(
        os.path.abspath(str(samples_csv))
    )
    assert source_ids.resolve_source_id("webui/a.csv") == os.path.normpath(
        os.path.abspath(str(webui_csv))
    )


def test_shared_dir_prefix_and_collision_suffix(tmp_path, monkeypatch):
    ext = tmp_path / "ext"
    webui = tmp_path / "webui_data"
    _patch_ext(monkeypatch, ext, webui)
    # Keep cwd inside webui so the root-scan parent is not an extra shared/ entry.
    monkeypatch.chdir(webui)

    parent_a = tmp_path / "packs" / "alpha" / "shared_name"
    parent_b = tmp_path / "packs" / "beta" / "shared_name"
    parent_a.mkdir(parents=True)
    parent_b.mkdir(parents=True)
    csv_a = parent_a / "pack.csv"
    csv_b = parent_b / "pack.csv"
    _write_csv(csv_a, "A")
    _write_csv(csv_b, "B")

    from modules import shared

    shared.prompt_styles.all_styles_files = [Path(csv_a), Path(csv_b)]

    roots = source_ids.source_roots()
    prefixes = [k for k in roots if k.startswith("shared/")]
    assert len(prefixes) == 2
    assert all("~" in p for p in prefixes)
    ids = {
        source_ids.to_source_id(str(csv_a)),
        source_ids.to_source_id(str(csv_b)),
    }
    assert None not in ids
    assert len(ids) == 2
    for sid in ids:
        assert sid.startswith("shared/shared_name~")
        assert sid.endswith("/pack.csv")
        assert source_ids.resolve_source_id(sid) is not None

    # Single shared parent: no hash suffix
    shared.prompt_styles.all_styles_files = [Path(csv_a)]
    sid = source_ids.to_source_id(str(csv_a))
    assert sid == "shared/shared_name/pack.csv"


@pytest.mark.parametrize(
    "bad_id",
    [
        "../x.csv",
        "styles/../x.csv",
        "styles/sub/x.csv",
        "styles\\x.csv",
        "C:/x.csv",
        "other/x.csv",
        "styles/x.txt",
        "styles/.",
        "styles/..",
        "styles/x.csv/extra",
        "unknown/x.csv",
    ],
)
def test_resolve_rejects_bad_ids(bad_id, tmp_path, monkeypatch):
    _patch_ext(monkeypatch, tmp_path / "ext", tmp_path / "webui")
    assert source_ids.resolve_source_id(bad_id) is None


def test_coerce_abs_inside_outside(tmp_path, monkeypatch):
    ext = tmp_path / "ext"
    webui = tmp_path / "webui"
    _patch_ext(monkeypatch, ext, webui)
    inside = ext / "styles" / "in.csv"
    outside = tmp_path / "elsewhere" / "out.csv"
    _write_csv(inside)
    _write_csv(outside)
    assert source_ids.coerce_source_ref(str(inside)) == os.path.normpath(
        os.path.abspath(str(inside))
    )
    assert source_ids.coerce_source_ref(str(outside)) is None
    assert source_ids.coerce_source_ref("styles/in.csv") == os.path.normpath(
        os.path.abspath(str(inside))
    )


def test_moved_install_same_ids_and_thumb_hash(tmp_path, monkeypatch):
    """Two install trees with identical files yield the same ids and thumb hashes."""
    name = "BASE_Look"

    def setup_tree(root: Path):
        ext = root / "ext"
        webui = root / "webui"
        _write_csv(ext / "styles" / "pack.csv", name)
        _write_csv(ext / "samples" / "demo.csv", name)
        _write_csv(webui / "styles.csv", name)
        return ext, webui

    tree_a = tmp_path / "install_a"
    tree_b = tmp_path / "install_b"
    ext_a, webui_a = setup_tree(tree_a)
    ext_b, webui_b = setup_tree(tree_b)

    def ids_and_hash(ext, webui):
        _patch_ext(monkeypatch, ext, webui)
        monkeypatch.setattr(
            sg_thumbs,
            "get_styles_dirs",
            lambda: [
                str(ext / "styles"),
                str(ext / "samples"),
                str(webui),
            ],
        )
        paths = [
            ext / "styles" / "pack.csv",
            ext / "samples" / "demo.csv",
            webui / "styles.csv",
        ]
        out_ids = [source_ids.to_source_id(str(p)) for p in paths]
        # Old abs-based hash (pre-coerce): same relative formula under get_styles_dirs
        old_hashes = []
        new_hashes = []
        for p, sid in zip(paths, out_ids):
            abs_p = os.path.normpath(os.path.abspath(str(p)))
            # Simulate legacy: hash with abs path under same dir list
            old_hashes.append(sg_thumbs.thumbnail_hash_key(name, abs_p))
            new_hashes.append(sg_thumbs.thumbnail_hash_key(name, sid))
        return out_ids, old_hashes, new_hashes

    ids_a, old_a, new_a = ids_and_hash(ext_a, webui_a)
    ids_b, old_b, new_b = ids_and_hash(ext_b, webui_b)

    assert ids_a == ["styles/pack.csv", "samples/demo.csv", "webui/styles.csv"]
    assert ids_a == ids_b
    assert new_a == old_a
    assert new_b == old_b
    assert new_a == new_b


def test_parse_emits_ids_not_abs(tmp_path, monkeypatch):
    ext = tmp_path / "ext"
    _patch_ext(monkeypatch, ext, tmp_path / "webui")
    path = ext / "styles" / "pack.csv"
    _write_csv(path, "Row")
    styles = csv_io.parse_styles_csv(str(path))
    assert len(styles) == 1
    sf = styles[0]["source_file"]
    assert sf == "styles/pack.csv"
    assert "\\" not in sf
    assert not os.path.isabs(sf)
    assert styles[0]["source"] == styles[0]["_source"] == "pack.csv"


def test_get_styles_payload_has_no_abs_paths(tmp_path, monkeypatch):
    ext = tmp_path / "ext"
    webui = tmp_path / "webui"
    _patch_ext(monkeypatch, ext, webui)
    path = ext / "styles" / "pack.csv"
    _write_csv(path, "Row")

    from stylegrid import cache as sg_cache

    monkeypatch.setattr(
        sg_config, "get_all_styles_file_paths", lambda: [str(path)]
    )
    monkeypatch.setattr(csv_io, "get_all_styles_file_paths", lambda: [str(path)])
    monkeypatch.setattr(sg_cache, "get_all_styles_file_paths", lambda: [str(path)])
    sg_cache.invalidate_styles_cache()

    app = FastAPI()
    register_api(None, app)
    with TestClient(app, base_url="http://127.0.0.1:7860") as client:
        r = client.get("/style_grid/styles")
    assert r.status_code == 200
    payload = r.json()
    for cat_styles in (payload.get("categories") or {}).values():
        for s in cat_styles or []:
            sf = s.get("source_file") or ""
            if sf.startswith("__"):
                continue
            assert str(tmp_path) not in sf
            assert "\\" not in sf
            assert not (len(sf) >= 2 and sf[1] == ":")
            assert sf == "styles/pack.csv"


def test_save_delete_rename_by_id_hit_right_pack(tmp_path, monkeypatch):
    ext = tmp_path / "ext"
    webui = tmp_path / "webui"
    _patch_ext(monkeypatch, ext, webui)
    styles_a = ext / "styles" / "a.csv"
    webui_a = webui / "a.csv"
    _write_csv(styles_a, "Shared", "from_styles")
    _write_csv(webui_a, "Shared", "from_webui")

    from modules import shared

    shared.prompt_styles.all_styles_files = [Path(webui_a)]
    paths = [str(styles_a), str(webui_a)]
    monkeypatch.setattr(sg_config, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(csv_io, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)
    shared.prompt_styles.reload = MagicMock()

    assert csv_io.save_style_to_csv(
        "Shared", "upd_styles", "n", "d", source_file="styles/a.csv", category="BASE"
    )
    styles_rows = csv_io.parse_styles_csv(str(styles_a))
    webui_rows = csv_io.parse_styles_csv(str(webui_a))
    assert styles_rows[0]["prompt"] == "upd_styles"
    assert webui_rows[0]["prompt"] == "from_webui"

    assert csv_io.rename_style_in_csv(
        "Shared", "Shared2", source_file="webui/a.csv"
    )
    assert [s["name"] for s in csv_io.parse_styles_csv(str(webui_a))] == ["Shared2"]
    assert [s["name"] for s in csv_io.parse_styles_csv(str(styles_a))] == ["Shared"]

    assert csv_io.delete_style_from_csv("Shared", source_file="styles/a.csv") is True
    assert csv_io.parse_styles_csv(str(styles_a)) == []
    assert [s["name"] for s in csv_io.parse_styles_csv(str(webui_a))] == ["Shared2"]


def test_bare_basename_ambiguous_refused(tmp_path, monkeypatch):
    ext = tmp_path / "ext"
    webui = tmp_path / "webui"
    _patch_ext(monkeypatch, ext, webui)
    styles_a = ext / "styles" / "a.csv"
    webui_a = webui / "a.csv"
    _write_csv(styles_a)
    _write_csv(webui_a)
    from modules import shared

    shared.prompt_styles.all_styles_files = [Path(webui_a)]
    paths = [str(styles_a), str(webui_a)]
    monkeypatch.setattr(sg_config, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(csv_io, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)

    assert source_ids.resolve_client_source("a.csv", for_write=True) is None
    assert csv_io.save_style_to_csv("X", "p", "n", source_file="a.csv") is False


def test_samples_refused_for_write(tmp_path, monkeypatch):
    ext = tmp_path / "ext"
    _patch_ext(monkeypatch, ext, tmp_path / "webui")
    samples = ext / "samples" / "demo.csv"
    _write_csv(samples)
    monkeypatch.setattr(
        sg_config, "get_all_styles_file_paths", lambda: [str(samples)]
    )
    monkeypatch.setattr(csv_io, "get_all_styles_file_paths", lambda: [str(samples)])
    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)

    assert source_ids.resolve_client_source("samples/demo.csv", for_write=True) is None
    assert csv_io.save_style_to_csv(
        "X", "p", "n", source_file="samples/demo.csv"
    ) is False
    assert csv_io.delete_style_from_csv("S1", source_file="samples/demo.csv") is False


def test_delete_false_when_missing_target_or_no_row(tmp_path, monkeypatch):
    ext = tmp_path / "ext"
    _patch_ext(monkeypatch, ext, tmp_path / "webui")
    path = ext / "styles" / "pack.csv"
    _write_csv(path, "Keep")
    monkeypatch.setattr(sg_config, "get_all_styles_file_paths", lambda: [str(path)])
    monkeypatch.setattr(csv_io, "get_all_styles_file_paths", lambda: [str(path)])
    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)

    assert csv_io.delete_style_from_csv("Nope", source_file="styles/pack.csv") is False
    assert csv_io.delete_style_from_csv(
        "Keep", source_file="styles/missing.csv"
    ) is False


def test_webui_root_csv_discovery_and_ids(tmp_path, monkeypatch):
    """CivitAI packs in the WebUI root are discovered once and mapped to ids."""
    import json

    from stylegrid import cache as sg_cache
    from stylegrid import data_files as sg_data
    from stylegrid.data_files import (
        migrate_identity_files_once,
        migrate_presets_source_ids_once,
    )

    ext = tmp_path / "ext"
    webui_root = tmp_path / "webui_root"
    _patch_ext(monkeypatch, ext, webui_root)
    monkeypatch.chdir(webui_root)

    styles_csv = webui_root / "styles.csv"
    nsfw = webui_root / "styles_nsfw_core.csv"
    yuri = webui_root / "styles_yuri.csv"
    _write_csv(styles_csv, "Default")
    _write_csv(nsfw, "Nsfw")
    _write_csv(yuri, "X")

    from modules import shared

    shared.prompt_styles.all_styles_files = [Path(styles_csv)]

    paths = sg_config.get_all_styles_file_paths()
    basenames = sorted(os.path.basename(p) for p in paths)
    assert basenames.count("styles.csv") == 1
    assert basenames.count("styles_nsfw_core.csv") == 1
    assert basenames.count("styles_yuri.csv") == 1
    assert source_ids.to_source_id(str(nsfw)) == "webui/styles_nsfw_core.csv"
    assert source_ids.to_source_id(str(yuri)) == "webui/styles_yuri.csv"
    assert source_ids.to_source_id(str(styles_csv)) == "webui/styles.csv"

    # data_path differs from cwd -> shared/<cwd folder>/...
    data_dir = tmp_path / "data_dir"
    data_dir.mkdir()
    monkeypatch.setattr(source_ids, "webui_styles_root", lambda: str(data_dir))
    monkeypatch.setattr(sg_config, "_get_webui_data_path", lambda: str(data_dir))
    cwd_name = os.path.basename(os.path.normpath(str(webui_root)))
    assert source_ids.to_source_id(str(yuri)) == f"shared/{cwd_name}/styles_yuri.csv"
    assert source_ids.to_source_id(str(nsfw)) == f"shared/{cwd_name}/styles_nsfw_core.csv"

    # Restore cwd == data root for catalog / migration / GET checks.
    monkeypatch.setattr(source_ids, "webui_styles_root", lambda: str(webui_root))
    monkeypatch.setattr(sg_config, "_get_webui_data_path", lambda: str(webui_root))

    monkeypatch.setattr(sg_config, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(csv_io, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(sg_cache, "get_all_styles_file_paths", lambda: paths)
    sg_cache.invalidate_styles_cache()

    fav = tmp_path / "favorites.json"
    recent = tmp_path / "recent.json"
    presets_path = tmp_path / "presets.json"
    monkeypatch.setattr(sg_data, "FAVORITES_FILE", str(fav))
    monkeypatch.setattr(sg_data, "RECENT_FILE", str(recent))
    monkeypatch.setattr(sg_data, "PRESETS_FILE", str(presets_path))
    monkeypatch.setattr(sg_config, "FAVORITES_FILE", str(fav))
    monkeypatch.setattr(sg_config, "RECENT_FILE", str(recent))

    abs_yuri = os.path.normpath(os.path.abspath(str(yuri)))
    fav.write_text(
        json.dumps({"items": [f"{abs_yuri}\0X"]}),
        encoding="utf-8",
    )
    catalog = [csv_io.enrich_style(s) for s in csv_io.load_all_styles()]
    monkeypatch.setattr(sg_data, "get_cached_styles", lambda: catalog)
    monkeypatch.setattr(sg_cache, "get_cached_styles", lambda: catalog)
    migrate_identity_files_once()
    assert json.loads(fav.read_text(encoding="utf-8"))["items"] == [
        "webui/styles_yuri.csv\0X"
    ]

    presets_path.write_text(
        json.dumps(
            {
                "P": {
                    "styles": [
                        {"name": "X", "source_file": abs_yuri, "weight": 1.0},
                    ],
                    "wildcards": [],
                    "note": "",
                    "created": "2026-01-01T00:00:00",
                }
            }
        ),
        encoding="utf-8",
    )
    assert migrate_presets_source_ids_once() == 1
    disk = json.loads(presets_path.read_text(encoding="utf-8"))
    assert disk["P"]["styles"][0]["source_file"] == "webui/styles_yuri.csv"

    from stylegrid import routes as sg_routes

    monkeypatch.setattr(sg_routes, "get_cached_styles", lambda: catalog)
    monkeypatch.setattr(sg_routes, "migrate_identity_files_once", lambda: None)
    monkeypatch.setattr(sg_routes, "migrate_presets_source_ids_once", lambda: 0)
    app = FastAPI()
    register_api(None, app)
    with TestClient(app, base_url="http://127.0.0.1:7860") as client:
        r = client.get("/style_grid/styles")
    assert r.status_code == 200
    payload_ids = {
        s.get("source_file")
        for cat in r.json()["categories"].values()
        for s in cat
    }
    assert "webui/styles_nsfw_core.csv" in payload_ids
    assert "webui/styles_yuri.csv" in payload_ids
    assert "webui/styles.csv" in payload_ids


def test_webui_root_moved_install_same_ids(tmp_path, monkeypatch):
    """Two WebUI roots with the same pack filenames yield the same public ids."""
    name = "X"

    def setup(root: Path):
        ext = root / "ext"
        webui = root / "webui"
        _write_csv(webui / "styles.csv", "Default")
        _write_csv(webui / "styles_yuri.csv", name)
        return ext, webui

    ext_a, webui_a = setup(tmp_path / "install_a")
    ext_b, webui_b = setup(tmp_path / "install_b")

    def ids_for(ext, webui):
        _patch_ext(monkeypatch, ext, webui)
        monkeypatch.chdir(webui)
        from modules import shared

        shared.prompt_styles.all_styles_files = [Path(webui / "styles.csv")]
        return [
            source_ids.to_source_id(str(webui / "styles.csv")),
            source_ids.to_source_id(str(webui / "styles_yuri.csv")),
        ]

    assert ids_for(ext_a, webui_a) == [
        "webui/styles.csv",
        "webui/styles_yuri.csv",
    ]
    assert ids_for(ext_b, webui_b) == [
        "webui/styles.csv",
        "webui/styles_yuri.csv",
    ]


def _process_wildcard_pool(all_styles, active_source: str):
    """Same active_source decision as scripts/style_grid.py process()."""
    if not active_source:
        return all_styles
    if source_ids.is_source_id(active_source):
        return [s for s in all_styles if (s.get("source_file") or "") == active_source]
    mapped_id = (
        source_ids.to_source_id(active_source) if os.path.isabs(active_source) else None
    )
    if mapped_id:
        return [s for s in all_styles if (s.get("source_file") or "") == mapped_id]
    want_base = os.path.basename(active_source.replace("\\", "/"))
    ids = sorted({
        sid
        for s in all_styles
        for sid in [(s.get("source_file") or "")]
        if sid and sid.rsplit("/", 1)[-1] == want_base
    })
    if len(ids) == 1:
        return [s for s in all_styles if (s.get("source_file") or "") == ids[0]]
    logging.getLogger("StyleGrid").warning(
        'active_source %r matches %s packs; empty wildcard pool '
        '(no silent fallback to all)',
        active_source,
        len(ids) if ids else 0,
    )
    return []


def test_process_active_source_pool(tmp_path, monkeypatch, caplog):
    """process() pool: id exact, legacy unique leaf, ambiguous -> empty + warning."""
    ext = tmp_path / "ext"
    webui = tmp_path / "webui"
    _patch_ext(monkeypatch, ext, webui)
    styles_a = ext / "styles" / "a.csv"
    webui_a = webui / "a.csv"
    unique = ext / "styles" / "only.csv"
    _write_csv(styles_a, "A1", "sa")
    _write_csv(webui_a, "A2", "wa")
    _write_csv(unique, "U1", "u")
    from modules import shared

    shared.prompt_styles.all_styles_files = [Path(webui_a)]
    paths = [str(styles_a), str(webui_a), str(unique)]
    monkeypatch.setattr(sg_config, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(csv_io, "get_all_styles_file_paths", lambda: paths)

    all_styles = [csv_io.enrich_style(s) for s in csv_io.load_all_styles()]

    exact = _process_wildcard_pool(all_styles, "styles/a.csv")
    assert len(exact) == 1 and exact[0]["prompt"] == "sa"

    uniq = _process_wildcard_pool(all_styles, "only.csv")
    assert len(uniq) == 1 and uniq[0]["prompt"] == "u"

    with caplog.at_level(logging.WARNING, logger="StyleGrid"):
        amb = _process_wildcard_pool(all_styles, "a.csv")
    assert amb == []
    assert any("empty wildcard pool" in r.message for r in caplog.records)

    # Confirm scripts/style_grid.py still contains the same no-fallback policy.
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "style_grid.py"
    text = script_path.read_text(encoding="utf-8")
    assert "no silent fallback to all" in text
    assert "fall back to all" not in text.replace("no silent fallback to all", "")
